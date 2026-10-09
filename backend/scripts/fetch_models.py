"""Download and load the retrieval models once, at build time (Render buildCommand), so the first question
doesn't wait for them. Also run at server start to load them into memory before anyone asks.

    python -m scripts.fetch_models
"""
from rag.embed import FastEmbedder
from rag.rerank import FlashReranker


def warm(embedder=None, reranker=None):
    (embedder or FastEmbedder()).embed_query("warm up")
    (reranker or FlashReranker()).score("warm up", ["warm up"])


if __name__ == "__main__":
    warm()
    print("retrieval models ready")
