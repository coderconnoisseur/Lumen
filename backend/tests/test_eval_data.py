"""EVAL-02: the committed datasets match the generator, and LABELLING.md matches the data (SPEC-EVAL AC 5)."""
import json
import re
from collections import Counter

import pytest

from evals.generator.__main__ import DATA_DIR, datasets, generate

SPLIT_FILES = ("sql", "extraction", "retrieval", "generation", "agent", "safety")


@pytest.fixture(scope="module")
def texts():
    return datasets(seed=42)[0]


def _rows(name):
    return [json.loads(line) for line in (DATA_DIR / name).read_text(encoding="utf-8").splitlines()]


def test_committed_jsonl_matches_the_generator(texts):
    for name, text in texts.items():
        assert (DATA_DIR / name).read_bytes() == text.encode("utf-8"), f"{name} is stale: run python -m evals.generator"


def test_every_referenced_file_is_committed():
    for name in ("extraction.jsonl", "safety.jsonl", "corpus.jsonl"):
        for row in _rows(name):
            if row.get("file"):
                assert (DATA_DIR / row["file"]).is_file(), row["file"]
    invoices = {p.name for p in (DATA_DIR / "invoices").iterdir()}
    assert invoices == {row["file"].split("/")[1] for row in _rows("extraction.jsonl")}


def test_labelling_md_row_counts_match_the_data():
    text = (DATA_DIR / "LABELLING.md").read_text(encoding="utf-8")
    table = text.split("<!-- counts:start -->")[1].split("<!-- counts:end -->")[0]
    documented = {m[0]: tuple(map(int, m[1:])) for m in re.findall(r"\| (\w+)\.jsonl \| (\d+) \| (\d+) \| (\d+) \|", table)}
    actual = {}
    for name in SPLIT_FILES:
        splits = Counter(row["split"] for row in _rows(f"{name}.jsonl"))
        actual[name] = (sum(splits.values()), splits["dev"], splits["test"])
    assert documented == actual


def test_same_seed_writes_identical_files(tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    assert generate(first, seed=42) == generate(second, seed=42)
    files = sorted(p.relative_to(first) for p in first.rglob("*") if p.is_file())
    assert files == sorted(p.relative_to(second) for p in second.rglob("*") if p.is_file())
    for rel in files:
        assert (first / rel).read_bytes() == (second / rel).read_bytes(), rel
