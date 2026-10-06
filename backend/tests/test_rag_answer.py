"""RAG-06: cited answers, and abstention before any LLM call when the evidence can't answer (SPEC-RAG)."""
import pytest

from rag.store import Hit


def _hit(cid, text, title="Purchase Order PO-U1-202603-05", score=0.99):
    return Hit(cid, cid.split("#")[0], score, "Order lines", text, title, "purchase_order")


def test_document_codes_are_found_in_questions():
    from rag.answer import document_codes

    assert document_codes("What is the total on purchase order PO-U2-202603-05?") == {"PO-U2-202603-05"}
    assert document_codes("Show invoice CP-202606-U1N18 and po-u1-202507-01") == {"CP-202606-U1N18", "PO-U1-202507-01"}
    assert document_codes("Is payment due Net 30 or within 14 days?") == set()


@pytest.mark.parametrize("question, hits, reason", [
    ("What is the warranty on gift cards?", [], "no_evidence"),
    ("What is the order total on PO-U2-202603-05?", [_hit("a#s01", "Order total: INR 10.00")], "unknown_reference"),
])
def test_abstains_without_calling_the_model(question, hits, reason):
    from rag.answer import abstain_reason

    assert abstain_reason(question, hits) == reason


def test_short_generic_questions_are_not_refused_for_a_low_reranker_score():
    """Owner's test, 2026-10-04: "What is the notice period?" retrieved the right section but the cross-encoder
    scored it 0.003, and a score cut-off refused it. The score can't separate short questions from off-topic
    ones (both near 0), so it no longer gates; the model's NOT_FOUND does."""
    from rag.answer import abstain_reason

    assert abstain_reason("What is the notice period?", [_hit("c#s04", "60 days' written notice.", score=0.003)]) is None


def test_answers_when_the_named_document_was_retrieved():
    from rag.answer import abstain_reason

    assert abstain_reason("What is the order total on PO-U1-202603-05?", [_hit("a#s01", "Order total: INR 10.00")]) is None


def test_answer_cites_only_retrieved_chunks_and_skips_the_llm_on_abstain():
    from rag.answer import answer_from_hits

    hits = [_hit("po#s02", "Order total: INR 2,415.79."), _hit("po#s03", "Payment is due Net 30.")]
    calls = []

    def llm(prompt, **_):
        calls.append(prompt)
        return "The order total is INR 2,415.79 [po#s02], payable Net 30 [po#s03] [made-up#s09]."

    out = answer_from_hits("What is the order total on PO-U1-202603-05?", hits, llm=llm)
    assert out["abstained"] is False
    assert out["citations"] == ["po#s02", "po#s03"]  # the invented id is dropped
    assert "[po#s02]" in calls[0] and "Order total: INR 2,415.79." in calls[0]
    out = answer_from_hits("What is the order total on PO-U9-209912-99?", hits, llm=llm)
    assert out["abstained"] is True and out["reason"] == "unknown_reference" and len(calls) == 1


def test_model_saying_it_cannot_find_the_answer_counts_as_abstention():
    from rag.answer import answer_from_hits

    out = answer_from_hits("What is the order total on PO-U1-202603-05?", [_hit("po#s02", "Order total: INR 5.00.")],
                           llm=lambda prompt, **_: "NOT_FOUND")
    assert out["abstained"] is True and out["reason"] == "model_abstained" and out["citations"] == []
