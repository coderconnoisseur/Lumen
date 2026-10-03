"""Run eval suites offline and gate on paired regressions (SPEC-EVAL).

    python -m evals.run --tier groq                     # dev split, replay from cassettes
    python -m evals.run --tier groq --suite sql --record --only-missing
    python -m evals.run --tier groq --split test --release 1

Defaults: dev split, replay mode (a cassette miss raises; nothing calls a
model). `--record` is the only way to make live calls and is run by hand.
Results go to evals/results/: `dev-<tier>-<split>.json` (local, gitignored) or
`release-<n>-<tier>-<split>.json` (committed). Each run is compared case by
case with the latest committed release for the same tier and split.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Callable, Mapping

import yaml

from evals.metrics import gate_regressions, paired_changes
from llm import cassette

EVALS_DIR = Path(__file__).resolve().parent
RESULTS_DIR = EVALS_DIR / "results"
GATES_PATH = EVALS_DIR / "gates.yaml"
TIERS = ("openrouter", "groq", "ollama")

SuiteFn = Callable[[str, str], dict]


def default_suites() -> dict[str, SuiteFn]:
    from evals.suites import extraction, safety, selftest, sql

    return {"selftest": selftest.run, "sql": sql.run, "safety": safety.run, "extraction": extraction.run}


def _parse(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m evals.run", description=__doc__.split("\n\n")[0])
    parser.add_argument("--tier", choices=TIERS, required=True)
    parser.add_argument("--suite", default="all", help="suite name, or 'all'")
    parser.add_argument("--split", choices=("dev", "test"), default="dev")
    parser.add_argument("--release", type=int, help="write release-<n>; required for --split test")
    parser.add_argument("--record", action="store_true", help="call models for missing cases (spends quota)")
    parser.add_argument("--only-missing", action="store_true", help="with --record: keep existing recordings")
    args = parser.parse_args(argv)
    if args.split == "test" and args.release is None:
        parser.error("--split test is only for release runs; add --release N (never tune against test)")
    if args.only_missing and not args.record:
        parser.error("--only-missing needs --record")
    return args


def _gates() -> dict:
    if GATES_PATH.exists():
        return yaml.safe_load(GATES_PATH.read_text(encoding="utf-8")) or {}
    return {}


def _latest_release(results_dir: Path, tier: str, split: str, before: int | None) -> dict | None:
    pattern = re.compile(rf"release-(\d+)-{re.escape(tier)}-{re.escape(split)}\.json$")
    found = []
    for path in results_dir.glob(f"release-*-{tier}-{split}.json"):
        match = pattern.search(path.name)
        if match and (before is None or int(match.group(1)) < before):
            found.append((int(match.group(1)), path))
    if not found:
        return None
    return json.loads(max(found)[1].read_text(encoding="utf-8"))


def _cassette_path(tier: str, suite: str) -> Path:
    root = Path(os.getenv("LUMEN_CASSETTE_DIR") or EVALS_DIR / "cassettes")
    return root / tier / f"{suite}.jsonl"


def main(argv=None, *, suites: Mapping[str, SuiteFn] | None = None, results_dir: Path | None = None) -> int:
    args = _parse(argv)
    suites = dict(suites if suites is not None else default_suites())
    results_dir = Path(results_dir or RESULTS_DIR)
    selected = list(suites) if args.suite == "all" else [args.suite]
    unknown = [s for s in selected if s not in suites]
    if unknown:
        print(f"unknown suite(s): {', '.join(unknown)}; available: {', '.join(suites)}", file=sys.stderr)
        return 2

    gates = _gates()
    reference = _latest_release(results_dir, args.tier, args.split, before=args.release)
    saved_env = {k: os.environ.get(k) for k in ("LUMEN_LLM_CACHE", "LUMEN_LLM_TIER")}
    os.environ["LUMEN_LLM_CACHE"] = "record" if args.record else "replay"
    os.environ["LUMEN_LLM_TIER"] = args.tier
    report: dict = {"tier": args.tier, "split": args.split, "release": args.release, "suites": {}}
    failures: list[str] = []
    try:
        for name in selected:
            if args.record and not args.only_missing:
                _cassette_path(args.tier, name).unlink(missing_ok=True)
            cassette.clear_memory()
            with cassette.cassette_scope(name):
                outcome = suites[name](args.tier, args.split)
            cases = {str(k): bool(v) for k, v in sorted(outcome.get("cases", {}).items())}
            previous = ((reference or {}).get("suites", {}).get(name) or {}).get("cases", {})
            changes = paired_changes(previous, cases)
            min_regressed = (gates.get("min_regressed") or {}).get(name, (gates.get("min_regressed") or {}).get("default", 2))
            hard = list(outcome.get("hard_gate_failures", []))
            if not gate_regressions(changes, min_regressed=min_regressed):
                failures.append(f"{name}: {len(changes['regressed'])} regressed (gate {min_regressed})")
            failures.extend(f"{name}: hard gate: {h}" for h in hard)
            report["suites"][name] = {
                "metrics": outcome.get("metrics", {}),
                "cases": cases,
                "hard_gate_failures": hard,
                "changes": changes,
            }
            _print_suite(name, report["suites"][name])
    finally:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        cassette.clear_memory()

    report["gate"] = {"passed": not failures, "failures": failures}
    results_dir.mkdir(parents=True, exist_ok=True)
    stem = f"release-{args.release}" if args.release is not None else "dev"
    out = results_dir / f"{stem}-{args.tier}-{args.split}.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n{'PASS' if not failures else 'FAIL'}  -> {out}")
    for failure in failures:
        print(f"  {failure}")
    return 0 if not failures else 1


def _print_suite(name: str, result: dict) -> None:
    print(f"\n== {name} ==")
    for metric, value in result["metrics"].items():
        if isinstance(value, dict) and "passed" in value:
            low, high = value.get("ci95", [None, None])
            ci = f" (95% CI {low:.2f}-{high:.2f})" if low is not None else ""
            print(f"  {metric}: {value['passed']}/{value['total']}{ci}")
        else:
            print(f"  {metric}: {value}")
    changes = result["changes"]
    if changes["regressed"]:
        print(f"  regressed: {', '.join(changes['regressed'])}")
    if changes["fixed"]:
        print(f"  fixed: {', '.join(changes['fixed'])}")


if __name__ == "__main__":
    sys.exit(main())
