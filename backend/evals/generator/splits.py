"""Seeded, stratified dev/test split (SPEC-EVAL: ~30% test, stratified by tag and fault type)."""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Callable

TEST_SHARE = 0.3


def assign_splits(rows: list[dict], stratum: Callable[[dict], str], *, seed: int, name: str) -> list[dict]:
    """Return copies of `rows` with `split` set; round(30%) of each stratum goes to test."""
    by_stratum = defaultdict(list)
    for row in rows:
        by_stratum[stratum(row)].append(row["id"])
    test_ids = set()
    for key in sorted(by_stratum):
        ids = sorted(by_stratum[key])
        random.Random(f"lumen-split:{seed}:{name}:{key}").shuffle(ids)
        test_ids.update(ids[: round(len(ids) * TEST_SHARE)])
    return [{**row, "split": "test" if row["id"] in test_ids else "dev"} for row in rows]
