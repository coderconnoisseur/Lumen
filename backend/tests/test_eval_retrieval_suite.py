"""RAG-07: the retrieval suite runs the real ingest + search path and scores it per mode (fake embedder)."""


def test_retrieval_suite_scores_every_dev_question_per_mode():
    from evals.suites import retrieval
    from rag.embed import FakeEmbedder
    from rag.retrieve import MODES

    out = retrieval.run("openrouter", "dev", emb=FakeEmbedder())
    assert len(out["cases"]) == 104 and out["hard_gate_failures"] == []
    modes = out["metrics"]["modes"]
    assert set(modes) == set(MODES)
    for m in modes.values():
        assert 0 <= m["recall_at_5"] <= m["recall_at_10"] <= 1
        assert 0 < m["mrr"] <= 1
    # Bag-of-words still finds most planted facts: the pipeline and labels line up end to end.
    assert modes["dense"]["recall_at_10"] > 0.5
    assert retrieval.run("openrouter", "dev", emb=FakeEmbedder()) == out


def test_ingest_is_idempotent_and_search_is_tenant_scoped(tmp_path):
    from sqlalchemy import create_engine

    from evals.suites.common import DATA_DIR
    from rag.embed import FakeEmbedder
    from rag.ingest import ingest_pdf
    from rag.retrieve import search_documents
    from rag.store import ChunkStore

    store = ChunkStore(create_engine(f"sqlite:///{tmp_path / 'r.db'}"))
    store.ensure_schema()
    pdf = (DATA_DIR / "corpus" / "contract-u1-netlink.pdf").read_bytes()
    first = ingest_pdf(store, FakeEmbedder(), user_id="u-a", data=pdf, filename="c.pdf", doc_id="c1")
    assert ingest_pdf(store, FakeEmbedder(), user_id="u-a", data=pdf, filename="c.pdf", doc_id="c2") == first
    assert search_documents(store, FakeEmbedder(), "u-b", "monthly fee NetLink") == []
    hits = search_documents(store, FakeEmbedder(), "u-a", "termination notice period NetLink", k=3)
    assert hits[0].chunk_id == "c1#s04" and hits[0].title.startswith("NetLink")
