"""LLM-02 mini-bench: run an eval suite once per candidate model and pick a tier's defaults from the data.

    python -m evals.bench --tier groq --suite sql --models openai/gpt-oss-120b,qwen/qwen3.8-27b --record
    python -m evals.bench --tier groq --suite sql --models ...            # replay (offline)

Each candidate runs alone in the chain (no fallback), so every number is that model's own. Recordings go to
the tier's cassette like any other run (keys include the model). Results: `evals/results/bench-<tier>-<suite>.json`
and a table in `docs/direction/LLM-BENCH.md` between `<!-- bench:<tier>-<suite>:start/end -->` markers.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from unittest import mock

from evals.run import EVALS_DIR, MODEL_OVERRIDES, default_suites
from llm import cassette, client
from llm.registry import Registry, guess_family

BENCH_DOC = EVALS_DIR.parents[1] / "docs" / "direction" / "LLM-BENCH.md"


def _registry_for(tier: str, model: str) -> Registry:
    """Only `model` in the tier's text chain, and no openrouter fallback."""
    return Registry({tier: {"text": [{"model": model, "family": guess_family(model)}]}, "openrouter": {"text": []}})


def bench(tier: str, suite: str, models: list[str], *, split: str = "dev", record: bool = False, suites=None) -> dict:
    run_suite = (suites or default_suites())[suite]
    saved = {k: os.environ.get(k) for k in ("LUMEN_LLM_CACHE", "LUMEN_LLM_TIER", "LUMEN_LLM_PATIENT_S", *MODEL_OVERRIDES)}
    os.environ.update(LUMEN_LLM_CACHE="record" if record else "replay", LUMEN_LLM_TIER=tier)
    if record:
        os.environ["LUMEN_LLM_PATIENT_S"] = "65"
    for key in MODEL_OVERRIDES:
        os.environ[key] = ""
    results = {}
    try:
        for model in models:
            cassette.clear_memory()
            with mock.patch.object(client, "registry", lambda m=model: _registry_for(tier, m)), \
                    cassette.cassette_scope(suite):
                outcome = run_suite(tier, split)
            results[model] = {"metrics": outcome.get("metrics", {}),
                              "hard_gate_failures": outcome.get("hard_gate_failures", [])}
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        cassette.clear_memory()
    return {"tier": tier, "suite": suite, "split": split, "models": results}


def _cell(rate: dict | None) -> str:
    if not rate:
        return "n/a"
    low, high = rate["ci95"]
    return f"{rate['passed']}/{rate['total']} ({low:.0%}-{high:.0%})"


def table(report: dict) -> str:
    lines = ["| Model | Execution accuracy (gated) | Strict | Fallbacks | Errors / misses | p50 / p95 latency | "
             "Tokens per question |", "|---|---|---|---|---|---|---|"]
    for model, r in report["models"].items():
        m, ops = r["metrics"], r["metrics"].get("ops", {})
        lat = ops.get("latency_s_recorded") or {}
        latency = f"{lat['p50']:.1f} s / {lat['p95']:.1f} s" if lat.get("p50") is not None else "n/a"
        problems = len(m.get("provider_errors", [])) + len(r["hard_gate_failures"])
        lines.append(f"| `{model}` | {_cell(m.get('execution_accuracy'))} | {_cell(m.get('strict_execution_accuracy'))} | "
                     f"{_cell(m.get('fallback_rate'))} | {problems} | {latency} | {ops.get('tokens_per_question_mean', 'n/a')} |")
    return "\n".join(lines) + "\n"


def write_doc(report: dict, path: Path = BENCH_DOC) -> None:
    key = f"{report['tier']}-{report['suite']}"
    start, end = f"<!-- bench:{key}:start -->", f"<!-- bench:{key}:end -->"
    block = f"{start}\n{table(report)}{end}"
    text = path.read_text(encoding="utf-8") if path.exists() else "# LLM-02 mini-bench\n"
    if start in text:
        before, rest = text.split(start, 1)
        text = before + block + rest.split(end, 1)[1]
    else:
        text = text.rstrip("\n") + f"\n\n## {report['tier']}: {report['suite']} suite ({report['split']} split)\n\n{block}\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evals.bench", description=__doc__.split("\n\n")[0])
    parser.add_argument("--tier", required=True)
    parser.add_argument("--suite", default="sql")
    parser.add_argument("--models", required=True, help="comma-separated model ids")
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args(argv)
    report = bench(args.tier, args.suite, [m.strip() for m in args.models.split(",") if m.strip()], record=args.record)
    out = EVALS_DIR / "results" / f"bench-{args.tier}-{args.suite}.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    write_doc(report)
    print(table(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
