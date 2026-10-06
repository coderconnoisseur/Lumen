"""Write every EVAL-02 dataset to evals/data/ (or --out), deterministically from --seed.

    python -m evals.generator              # seed 42, rewrites evals/data/
    python -m evals.generator --check      # regenerate the JSONL in memory and diff it with evals/data/

Leaves hand-made files (LABELLING.md, judge_gold.jsonl) alone.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from evals.generator.cases import agent_rows, safety_rows
from evals.generator.corpus import build_corpus, generation_rows, render_pdf, retrieval_rows
from evals.generator.invoices import build_invoices, degrade, degraded_variant, extraction_rows, render_png
from evals.generator.splits import assign_splits
from evals.generator.sql_questions import rows as sql_rows
from evals.generator.world import build_world

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def _jsonl(rows: list[dict]) -> str:
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def datasets(seed: int = 42) -> tuple[dict[str, str], dict]:
    """{file name: JSONL text} plus the objects the binary files are rendered from."""
    world = build_world(seed)
    invoices = build_invoices(world, seed)
    corpus = build_corpus(world, seed)
    files = {
        "sql.jsonl": assign_splits(sql_rows(), lambda r: r["tags"][0], seed=seed, name="sql"),
        "extraction.jsonl": extraction_rows(invoices, seed),
        "retrieval.jsonl": retrieval_rows(corpus, seed),
        "generation.jsonl": generation_rows(corpus, seed),
        "agent.jsonl": agent_rows(world, invoices, corpus, seed),
        "safety.jsonl": safety_rows(world, invoices, corpus, seed),
        "invoices.jsonl": invoices,
        "corpus.jsonl": [{**doc, "file": f"corpus/{doc['id']}.pdf"} for doc in corpus["documents"]],
        "facts.jsonl": corpus["facts"],
        "purchase_orders.jsonl": world["purchase_orders"],
    }
    return {name: _jsonl(rows) for name, rows in files.items()}, {"invoices": invoices, "corpus": corpus}


def generate(out: Path = DATA_DIR, seed: int = 42, *, render: bool = True) -> dict[str, int]:
    """Write the datasets (and, with `render`, the invoice images and corpus PDFs); return row counts."""
    texts, sources = datasets(seed)
    out.mkdir(parents=True, exist_ok=True)
    for name, text in texts.items():
        (out / name).write_bytes(text.encode("utf-8"))
    if render:
        for sub in ("invoices", "corpus"):
            shutil.rmtree(out / sub, ignore_errors=True)
            (out / sub).mkdir()
        for index, inv in enumerate(sources["invoices"]):
            png = render_png(inv)
            (out / "invoices" / f"{inv['id']}-clean.png").write_bytes(png)
            variant = degraded_variant(index)
            data, ext = degrade(png, variant, seed=seed, key=inv["id"])
            (out / "invoices" / f"{inv['id']}-{variant}.{ext}").write_bytes(data)
        for doc in sources["corpus"]["documents"]:
            (out / "corpus" / f"{doc['id']}.pdf").write_bytes(render_pdf(doc))
    return {name: text.count("\n") for name, text in texts.items()}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evals.generator", description=__doc__.split("\n\n")[0])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=DATA_DIR)
    parser.add_argument("--check", action="store_true", help="diff the JSONL with --out instead of writing")
    args = parser.parse_args(argv)
    if args.check:
        stale = [name for name, text in datasets(args.seed)[0].items()
                 if not (args.out / name).exists() or (args.out / name).read_bytes() != text.encode("utf-8")]
        print("stale: " + ", ".join(stale) if stale else "evals/data is up to date")
        return 1 if stale else 0
    for name, count in generate(args.out, args.seed).items():
        print(f"{name}: {count} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
