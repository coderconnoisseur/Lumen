"""EVAL-02: the RAG corpus with planted facts, and the retrieval and generation sets (SPEC-EVAL, "Data")."""
from collections import Counter

import pytest


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(seed=42)


@pytest.fixture(scope="module")
def corpus(world):
    from evals.generator.corpus import build_corpus

    return build_corpus(world, seed=42)


def _sections(corpus):
    return {s["id"]: (doc, s) for doc in corpus["documents"] for s in doc["sections"]}


def test_corpus_is_deterministic_and_has_every_document_kind(corpus, world):
    from evals.generator.corpus import build_corpus

    assert build_corpus(world, seed=42) == corpus
    kinds = Counter((d["user"], d["kind"]) for d in corpus["documents"])
    for user in ("u1", "u2"):
        assert kinds[(user, "purchase_order")] == sum(
            po["user_id"] == world["users"][0 if user == "u1" else 1]["id"] for po in world["purchase_orders"]
        )
        assert kinds[(user, "contract")] == 3
        assert kinds[(user, "policy")] == 1


def test_section_ids_are_unique_and_stable(corpus):
    ids = [s["id"] for d in corpus["documents"] for s in d["sections"]]
    assert len(ids) == len(set(ids))
    for doc in corpus["documents"]:
        for n, section in enumerate(doc["sections"], start=1):
            assert section["id"] == f"{doc['id']}#s{n:02d}"


def test_every_fact_is_planted_verbatim_in_its_section_only(corpus):
    sections = _sections(corpus)
    for fact in corpus["facts"]:
        doc, section = sections[fact["section_id"]]
        assert fact["answer"] in section["text"], fact["id"]
        assert doc["user"] == fact["user"]
        others = [s for s in doc["sections"] if s["id"] != fact["section_id"]]
        assert not any(fact["answer"] in s["text"] for s in others), fact["id"]


def test_retrieval_rows_are_labelled_by_construction(corpus):
    from evals.generator.corpus import retrieval_rows

    rows = retrieval_rows(corpus, seed=42)
    sections = _sections(corpus)
    facts = {f["id"]: f for f in corpus["facts"]}
    assert len({r["id"] for r in rows}) == len(rows)
    per_fact = Counter(r["fact_id"] for r in rows)
    assert set(per_fact) == set(facts)
    assert all(2 <= n <= 3 for n in per_fact.values())  # the question plus 1-2 paraphrases
    splits_per_fact = {}
    for r in rows:
        assert set(r) >= {"id", "question", "relevant_chunk_ids", "user", "split", "source"}
        assert r["source"] == "template"
        assert r["relevant_chunk_ids"] == [facts[r["fact_id"]]["section_id"]]
        assert sections[r["relevant_chunk_ids"][0]][0]["user"] == r["user"]
        splits_per_fact.setdefault(r["fact_id"], set()).add(r["split"])
    assert all(len(s) == 1 for s in splits_per_fact.values())


def test_generation_rows_mix_answerable_unanswerable_and_other_tenant_questions(corpus):
    from evals.generator.corpus import generation_rows

    rows = generation_rows(corpus, seed=42)
    assert len({r["id"] for r in rows}) == len(rows)
    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [r for r in rows if not r["answerable"]]
    assert len(answerable) == 24 and len(unanswerable) == 12
    facts_by_answer = {(f["user"], f["answer"]) for f in corpus["facts"]}
    for r in answerable:
        assert all((r["user"], fact) in facts_by_answer for fact in r["required_facts"])
    assert Counter(r["reason"] for r in unanswerable) == {"not_in_corpus": 6, "other_tenant": 6}
    for r in unanswerable:
        assert r["required_facts"] == []
    own_text = {u: " ".join(s["text"] for d in corpus["documents"] if d["user"] == u for s in d["sections"])
                for u in ("u1", "u2")}
    for r in (r for r in unanswerable if r["reason"] == "other_tenant"):
        other = "u2" if r["user"] == "u1" else "u1"
        assert r["must_not"] and all(v in own_text[other] and v not in own_text[r["user"]] for v in r["must_not"])
    assert {r["split"] for r in rows} == {"dev", "test"}


def test_documents_render_to_text_pdfs_deterministically(corpus):
    import pypdfium2

    from evals.generator.corpus import render_pdf

    doc = corpus["documents"][0]
    pdf = render_pdf(doc)
    assert pdf == render_pdf(doc)
    assert pdf.startswith(b"%PDF")
    page_text = "".join(page.get_textpage().get_text_range() for page in pypdfium2.PdfDocument(pdf))
    first_fact = doc["sections"][0]["text"].split(".")[0]
    assert " ".join(first_fact.split()) in " ".join(page_text.split())
