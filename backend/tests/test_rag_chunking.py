"""RAG-01: documents become section-aligned chunks with stable ids (SPEC-RAG)."""
import json

import pytest

from evals.suites.common import DATA_DIR


def test_short_sections_become_one_chunk_each_with_stable_ids():
    from rag.chunking import Section, chunk_sections

    chunks = chunk_sections("doc-1", [Section("Fees", "You pay INR 999.00 per month."), Section("Term", "Two years.")])
    assert [c.id for c in chunks] == ["doc-1#s01", "doc-1#s02"]
    assert [(c.section_no, c.piece_no, c.heading) for c in chunks] == [(1, 0, "Fees"), (2, 0, "Term")]
    assert chunks[0].content_hash != chunks[1].content_hash
    assert chunk_sections("doc-1", [Section("Fees", "You pay INR 999.00 per month.")])[0] == chunks[0]


def test_long_sections_split_into_overlapping_pieces_that_never_cross_sections():
    from rag.chunking import Section, chunk_sections

    sentences = [f"Sentence number {i} talks about clause {i} in some detail." for i in range(120)]
    chunks = chunk_sections("doc-2", [Section("Long", " ".join(sentences)), Section("Short", "Done.")],
                            max_words=100, overlap_words=15)
    long = [c for c in chunks if c.section_no == 1]
    assert len(long) > 3
    assert [c.id for c in long[:2]] == ["doc-2#s01-0", "doc-2#s01-1"]
    assert all(len(c.text.split()) <= 100 for c in long)
    for a, b in zip(long, long[1:]):  # consecutive pieces share some text
        assert set(a.text.split()[-15:]) & set(b.text.split()[:20])
    assert chunks[-1].id == "doc-2#s02" and chunks[-1].text == "Done."
    joined = " ".join(c.text for c in long)
    assert all(s.split()[2] in joined for s in sentences)  # nothing dropped


def test_section_id_of_a_piece_is_its_section():
    from rag.chunking import section_id

    assert section_id("doc-2#s01-3") == "doc-2#s01"
    assert section_id("doc-2#s07") == "doc-2#s07"


def test_pdf_text_splits_on_numbered_headings_and_keeps_the_title():
    from rag.chunking import sections_from_text

    text = "Big Contract\r\nTitle line two\r\n1. Parties\r\nA and B agree\r\nto this.\r\n2. Fees\r\nINR 5.00 monthly."
    title, sections = sections_from_text(text)
    assert title == "Big Contract Title line two"
    assert [(s.heading, s.text) for s in sections] == [("Parties", "A and B agree to this."), ("Fees", "INR 5.00 monthly.")]


def test_text_without_headings_falls_back_to_paragraphs():
    from rag.chunking import sections_from_text

    title, sections = sections_from_text("Memo\n\nFirst paragraph here.\n\nSecond one\ncontinues.")
    assert title == "Memo"
    assert [s.text for s in sections] == ["First paragraph here.", "Second one continues."]


@pytest.mark.parametrize("doc", [json.loads(l) for l in (DATA_DIR / "corpus.jsonl").read_text(encoding="utf-8").splitlines()],
                         ids=lambda d: d["id"])
def test_every_corpus_pdf_splits_back_into_its_generated_sections(doc):
    """The ingest path reads real PDFs; their sections must line up with EVAL-02's labels."""
    from rag.chunking import sections_from_pdf

    title, sections = sections_from_pdf((DATA_DIR / doc["file"]).read_bytes())
    assert title == doc["title"]
    assert [(s.heading, s.text) for s in sections] == [(s["heading"], " ".join(s["text"].split())) for s in doc["sections"]]
