"""RAG-05: cross-encoder reranking of the fused candidates, with a cache for offline evals (SPEC-RAG)."""
import pytest
from sqlalchemy import create_engine


def test_fake_reranker_prefers_passages_sharing_more_query_words():
    from rag.rerank import FakeReranker

    scores = FakeReranker().score("order total", ["payment is due net 30", "order total INR 5,000", "order lines"])
    assert scores[1] > scores[2] > scores[0]


def test_cached_reranker_records_then_replays_without_the_model(tmp_path):
    from rag.rerank import CachedReranker, FakeReranker, RerankMiss

    path = tmp_path / "rerank.jsonl"
    live = CachedReranker(path, FakeReranker(), mode="record").score("q words", ["a q", "b words q"])
    replayed = CachedReranker(path, model_id=FakeReranker.model_id).score("q words", ["a q", "b words q"])
    assert replayed == pytest.approx(live)
    with pytest.raises(RerankMiss):
        CachedReranker(path, model_id=FakeReranker.model_id).score("new query", ["a q"])


def test_hybrid_rerank_mode_reorders_by_the_reranker(tmp_path):
    from rag.chunking import Section
    from rag.embed import FakeEmbedder
    from rag.ingest import ingest_sections
    from rag.rerank import FakeReranker
    from rag.retrieve import search_documents
    from rag.store import ChunkStore

    store = ChunkStore(create_engine(f"sqlite:///{tmp_path / 'r.db'}"))
    store.ensure_schema()
    ingest_sections(store, FakeEmbedder(), user_id="u1", title="Purchase Order PO-1",
                    sections=[Section("Payment terms", "Payment is due Net 30."),
                              Section("Order lines", "Order total: INR 5,000.00.")], doc_id="po1")
    hits = search_documents(store, FakeEmbedder(), "u1", "order total PO-1", mode="hybrid_rerank", k=2,
                            reranker=FakeReranker())
    assert [h.chunk_id for h in hits] == ["po1#s02", "po1#s01"]
    assert hits[0].score > hits[1].score  # reranker scores, used for abstention
    with pytest.raises(ValueError, match="reranker"):
        search_documents(store, FakeEmbedder(), "u1", "x", mode="hybrid_rerank")
