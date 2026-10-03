"""RAG-03/04: per-user BM25 and Reciprocal Rank Fusion (SPEC-RAG)."""
import pytest
from sqlalchemy import create_engine


def test_tokenizer_keeps_document_codes_whole_and_adds_their_parts():
    from rag.bm25 import tokenize

    tokens = tokenize("What's the total on PO-U1-202507-01? Invoice CP-202606-U1N18, INR 2,415.79")
    assert "po-u1-202507-01" in tokens and "202507" in tokens
    assert "cp-202606-u1n18" in tokens
    assert "total" in tokens and "the" not in tokens and "on" not in tokens  # stopwords dropped


def test_rrf_matches_a_hand_computed_example():
    from rag.retrieve import rrf

    # a: ranks 1 and 3 -> 1/61 + 1/63; b: rank 2 in both -> 2/62; c: rank 3 then 1 -> 1/63 + 1/61
    fused = rrf([["a", "b", "c"], ["c", "b", "a"]], k=60)
    scores = dict(fused)
    assert scores["a"] == pytest.approx(1 / 61 + 1 / 63)
    assert scores["b"] == pytest.approx(2 / 62)
    assert [cid for cid, _ in fused] == ["a", "c", "b"]  # a and c tie; ties break by id
    assert rrf([["x"], []]) == [("x", pytest.approx(1 / 61))]


@pytest.fixture
def store(tmp_path):
    from rag.chunking import Section
    from rag.embed import FakeEmbedder
    from rag.ingest import ingest_sections
    from rag.store import ChunkStore

    s = ChunkStore(create_engine(f"sqlite:///{tmp_path / 'h.db'}"))
    s.ensure_schema()
    for n in range(1, 6):
        ingest_sections(s, FakeEmbedder(), user_id="u1", title=f"Purchase Order PO-U1-2026{n:02d}-0{n}",
                        sections=[Section("Order lines", f"Order total: INR {n},000.00."),
                                  Section("Payment terms", "Payment is due Net 30.")], doc_id=f"po{n}")
    ingest_sections(s, FakeEmbedder(), user_id="u2", title="Purchase Order PO-U2-202603-03",
                    sections=[Section("Order lines", "Order total: INR 9,999.00.")], doc_id="other")
    return s


def test_bm25_finds_the_exact_document_code(store):
    from rag.bm25 import bm25_search

    hits = bm25_search(store, "u1", "order total on PO-U1-202603-03", k=5)
    assert hits[0][0] == "po3#s01"
    assert all(not cid.startswith("other") for cid, _ in hits)  # per-user index


def test_bm25_index_is_rebuilt_when_the_users_documents_change(store):
    from rag.bm25 import bm25_search
    from rag.chunking import Section
    from rag.embed import FakeEmbedder
    from rag.ingest import ingest_sections

    assert bm25_search(store, "u1", "warranty clause zebra", k=3) == []
    ingest_sections(store, FakeEmbedder(), user_id="u1", title="Warranty", sections=[Section("Zebra", "warranty clause zebra")],
                    doc_id="w")
    assert bm25_search(store, "u1", "warranty clause zebra", k=3)[0][0] == "w#s01"
    store.delete_document("u1", "w")
    assert bm25_search(store, "u1", "warranty clause zebra", k=3) == []


def test_hybrid_mode_puts_the_exact_po_first(store):
    from rag.embed import FakeEmbedder
    from rag.retrieve import search_documents

    hits = search_documents(store, FakeEmbedder(), "u1", "order total on PO-U1-202604-04", mode="hybrid", k=3)
    assert hits[0].chunk_id == "po4#s01" and hits[0].title == "Purchase Order PO-U1-202604-04"
    assert search_documents(store, FakeEmbedder(), "u3", "order total", mode="hybrid") == []
