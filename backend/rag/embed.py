"""Embedders (SPEC-RAG, RAG-02). All return L2-normalised float32 vectors, so cosine similarity is a dot product.

- `FastEmbedder`: `BAAI/bge-small-en-v1.5` via fastembed (ONNX, CPU, in-process; no API, no quota).
- `CachedEmbedder`: wraps another embedder with a committed cache, like the LLM cassettes, so retrieval
  evals run offline in CI and give identical numbers everywhere.
- `FakeEmbedder`: hashed bag of words, for unit tests (no model download).
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Protocol

import numpy as np

DIM = 384
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
# Model files live inside the project: Render keeps it from build to runtime (unlike /tmp), so
# `python -m scripts.fetch_models` in the build command means no download on the first question.
MODEL_CACHE = str(Path(__file__).resolve().parents[1] / ".models")


class Embedder(Protocol):
    model_id: str

    def embed_passages(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


def _normalise(vectors) -> np.ndarray:
    v = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(norms == 0, 1, norms)


class FakeEmbedder:
    model_id = "fake-hash-bow-384"

    def _one(self, text: str) -> np.ndarray:
        v = np.zeros(DIM, dtype=np.float32)
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 1.0
        return v

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        return _normalise([self._one(t) for t in texts]) if texts else np.zeros((0, DIM), np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_passages([text])[0]


class FastEmbedder:
    """bge-small: queries get the model's retrieval instruction, passages don't (fastembed handles both)."""

    def __init__(self, model_id: str = DEFAULT_MODEL):
        self.model_id = model_id
        self._model = None

    def _load(self):
        if self._model is None:
            from fastembed import TextEmbedding

            self._model = TextEmbedding(model_name=self.model_id, cache_dir=MODEL_CACHE)
        return self._model

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, DIM), np.float32)
        return _normalise(list(self._load().passage_embed(texts)))

    def embed_query(self, text: str) -> np.ndarray:
        return _normalise(list(self._load().query_embed([text])))[0]


class EmbeddingMiss(Exception):
    """Replay found no cached vector; re-record with `python -m rag.embed_cache`."""


class CachedEmbedder:
    """Answer from a JSONL cache keyed by (model, kind, text); `mode` is replay | record."""

    def __init__(self, path: Path, inner: Embedder | None = None, *, model_id: str = DEFAULT_MODEL, mode: str = "replay"):
        self.path, self.inner, self.mode = Path(path), inner, mode
        self.model_id = inner.model_id if inner else model_id
        self._cache: dict[str, np.ndarray] = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                self._cache[row["key"]] = np.frombuffer(base64.b64decode(row["v"]), dtype=np.float32)

    def _key(self, kind: str, text: str) -> str:
        return hashlib.sha256(f"{self.model_id}\x1f{kind}\x1f{text}".encode("utf-8")).hexdigest()

    def _get(self, kind: str, texts: list[str]) -> np.ndarray:
        keys = [self._key(kind, t) for t in texts]
        missing = [(k, t) for k, t in zip(keys, texts) if k not in self._cache]
        if missing:
            if self.mode != "record" or self.inner is None:
                raise EmbeddingMiss(f"{len(missing)} {kind} text(s) not in {self.path.name}, e.g. {missing[0][1][:60]!r}")
            fresh = (self.inner.embed_passages([t for _, t in missing]) if kind == "passage"
                     else np.stack([self.inner.embed_query(t) for _, t in missing]))
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8", newline="\n") as fh:
                for (k, _), vec in zip(missing, fresh):
                    vec = np.asarray(vec, dtype=np.float32)
                    self._cache[k] = vec
                    fh.write(json.dumps({"key": k, "v": base64.b64encode(vec.tobytes()).decode("ascii")}) + "\n")
        return np.stack([self._cache[k] for k in keys]) if keys else np.zeros((0, DIM), np.float32)

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        return self._get("passage", texts)

    def embed_query(self, text: str) -> np.ndarray:
        return self._get("query", [text])[0]
