"""Cross-encoder rerankers (SPEC-RAG, RAG-05).

A cross-encoder reads the question and a passage together, so it can tell "order total" from "payment
terms" inside the same purchase order, which embeddings (question and passage encoded separately) blur. It is
too slow for thousands of chunks, so it only rescores the fused top candidates: cheap recall, then precision.

- `FlashReranker`: FlashRank's ONNX MiniLM cross-encoder (CPU, tens of MB: fits the 512 MB server).
- `CachedReranker`: committed score cache, so evals run offline in CI with identical numbers.
- `FakeReranker`: word overlap, for unit tests.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Protocol

DEFAULT_MODEL = "ms-marco-MiniLM-L-12-v2"


class Reranker(Protocol):
    model_id: str

    def score(self, query: str, passages: list[str]) -> list[float]: ...


class FakeReranker:
    model_id = "fake-overlap"

    def score(self, query: str, passages: list[str]) -> list[float]:
        words = set(re.findall(r"[a-z0-9]+", query.lower()))
        out = []
        for p in passages:
            tokens = re.findall(r"[a-z0-9]+", p.lower())
            out.append(len(words & set(tokens)) / (1 + len(tokens) ** 0.5))
        return out


class FlashReranker:
    def __init__(self, model_id: str = DEFAULT_MODEL):
        self.model_id = model_id
        self._ranker = None

    def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        from flashrank import Ranker, RerankRequest

        if self._ranker is None:
            self._ranker = Ranker(model_name=self.model_id)
        results = self._ranker.rerank(RerankRequest(query=query, passages=[
            {"id": i, "text": p} for i, p in enumerate(passages)]))
        by_id = {int(r["id"]): float(r["score"]) for r in results}
        return [by_id[i] for i in range(len(passages))]


class RerankMiss(Exception):
    """Replay found no cached score; re-record with the retrieval suite's `--record`."""


class CachedReranker:
    """Scores from a JSONL cache keyed by (model, query, passage); `mode` is replay | record."""

    def __init__(self, path: Path, inner: Reranker | None = None, *, model_id: str = DEFAULT_MODEL,
                 mode: str = "replay"):
        self.path, self.inner, self.mode = Path(path), inner, mode
        self.model_id = inner.model_id if inner else model_id
        self._cache: dict[str, float] = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                self._cache[row["key"]] = row["s"]

    def _key(self, query: str, passage: str) -> str:
        return hashlib.sha256(f"{self.model_id}\x1f{query}\x1f{passage}".encode("utf-8")).hexdigest()

    def score(self, query: str, passages: list[str]) -> list[float]:
        keys = [self._key(query, p) for p in passages]
        missing = [i for i, k in enumerate(keys) if k not in self._cache]
        if missing:
            if self.mode != "record" or self.inner is None:
                raise RerankMiss(f"{len(missing)} passage score(s) for {query[:60]!r} not in {self.path.name}")
            fresh = self.inner.score(query, [passages[i] for i in missing])
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8", newline="\n") as fh:
                for i, s in zip(missing, fresh):
                    self._cache[keys[i]] = round(float(s), 6)
                    fh.write(json.dumps({"key": keys[i], "s": self._cache[keys[i]]}) + "\n")
        return [self._cache[k] for k in keys]
