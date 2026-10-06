"""RAG-01: the chunk store on SQLite (numpy search) and Postgres (pgvector), with tenant isolation."""
import os

import numpy as np
import pytest
from sqlalchemy import create_engine

PG_URL = os.getenv("LUMEN_TEST_POSTGRES_URL")
U1, U2 = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"


def _engines(tmp_path):
    yield "sqlite", create_engine(f"sqlite:///{tmp_path / 'rag.db'}")
    if PG_URL:
        yield "postgresql", create_engine(PG_URL)


@pytest.fixture(params=["sqlite", "postgresql"])
def store(request, tmp_path):
    from rag.store import ChunkStore

    if request.param == "postgresql" and not PG_URL:
        pytest.skip("set LUMEN_TEST_POSTGRES_URL to run the pgvector store")
    engine = create_engine(PG_URL) if request.param == "postgresql" else create_engine(f"sqlite:///{tmp_path / 'rag.db'}")
    s = ChunkStore(engine)
    s.ensure_schema()
    s.delete_user(U1)
    s.delete_user(U2)
    yield s
    s.delete_user(U1)
    s.delete_user(U2)


def _doc(store, user, doc_id, sections, title="Doc"):
    from rag.chunking import Section, chunk_sections
    from rag.embed import FakeEmbedder

    emb = FakeEmbedder()
    chunks = chunk_sections(doc_id, [Section(h, t) for h, t in sections])
    vectors = emb.embed_passages([f"{title} {c.heading} {c.text}" for c in chunks])
    return store.upsert_document(doc_id=doc_id, user_id=user, title=title, doc_type="contract", filename=f"{doc_id}.pdf",
                                 chunks=chunks, vectors=vectors, embedding_model=emb.model_id)


def test_dense_search_ranks_the_matching_chunk_first(store):
    from rag.embed import FakeEmbedder

    _doc(store, U1, "d1", [("Fees", "monthly fee broadband rupees"), ("Termination", "notice period ninety days")])
    hits = store.dense_search(U1, FakeEmbedder().embed_query("termination notice period"), k=2)
    assert [h.chunk_id for h in hits] == ["d1#s02", "d1#s01"]
    assert hits[0].score > hits[1].score
    assert hits[0].text == "notice period ninety days" and hits[0].heading == "Termination" and hits[0].doc_id == "d1"


def test_search_never_returns_another_users_chunks(store):
    from rag.embed import FakeEmbedder

    _doc(store, U1, "mine", [("Fees", "monthly fee broadband")])
    _doc(store, U2, "theirs", [("Fees", "monthly fee broadband exactly the query")])
    hits = store.dense_search(U1, FakeEmbedder().embed_query("monthly fee broadband exactly the query"), k=10)
    assert {h.doc_id for h in hits} == {"mine"}
    assert {c[0] for c in store.user_chunks(U1)} == {"mine#s01"}


def test_reingesting_the_same_content_is_a_no_op_and_delete_removes_chunks(store):
    first = _doc(store, U1, "d1", [("A", "alpha text"), ("B", "beta text")])
    again = _doc(store, U1, "d1-copy", [("A", "alpha text"), ("B", "beta text")])
    assert again == first == "d1"  # same user, same content -> the existing document
    assert len(store.user_chunks(U1)) == 2
    version = store.user_version(U1)
    assert store.list_documents(U1)[0]["chunk_count"] == 2
    store.delete_document(U1, "d1")
    assert store.user_chunks(U1) == [] and store.list_documents(U1) == []
    assert store.user_version(U1) != version


def test_delete_is_scoped_to_the_owner(store):
    _doc(store, U2, "theirs", [("A", "alpha")])
    assert store.delete_document(U1, "theirs") is False
    assert len(store.user_chunks(U2)) == 1


@pytest.mark.skipif(not PG_URL, reason="set LUMEN_TEST_POSTGRES_URL to compare pgvector with numpy")
def test_postgres_and_sqlite_return_the_same_top_k(tmp_path):
    from rag.embed import FakeEmbedder
    from rag.store import ChunkStore

    sections = [(f"H{i}", f"topic {i} words about item {i % 7} and clause {i % 5}") for i in range(25)]
    results = []
    for _, engine in _engines(tmp_path):
        s = ChunkStore(engine)
        s.ensure_schema()
        s.delete_user(U1)
        _doc(s, U1, "big", sections)
        results.append([h.chunk_id for h in s.dense_search(U1, FakeEmbedder().embed_query("item 3 clause 2"), k=8)])
        s.delete_user(U1)
    assert results[0] == results[1]


def test_fake_embedder_is_normalised_and_deterministic():
    from rag.embed import FakeEmbedder

    v = FakeEmbedder().embed_passages(["a b c", "a b c", "zzz"])
    assert v.shape == (3, 384) and v.dtype == np.float32
    assert np.allclose(np.linalg.norm(v, axis=1), 1.0)
    assert np.array_equal(v[0], v[1]) and not np.array_equal(v[0], v[2])
