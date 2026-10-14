import json

import pytest

from inbox.filter import html_to_text, is_candidate
from inbox.parse import parse_money_email


@pytest.mark.parametrize("subject,expected", [
    ("₹649.00 debited from your account for NETFLIX", True),
    ("Your Zomato order #123 — ₹420", True),
    ("Netflix: your membership renewed", True),
    ("MEGA SALE 50% off — now ₹499", False),
    ("Weekly newsletter", False),
    ("Meeting tomorrow", False),
])
def test_is_candidate(subject, expected):
    assert is_candidate(subject, "", False) is expected


def test_invoice_attachment_always_candidate():
    assert is_candidate("Meeting tomorrow", "", True) is True
    assert is_candidate("MEGA SALE", "", True) is True


def test_promo_with_debit_word_is_candidate():
    assert is_candidate("Sale ends soon", "Payment of ₹499 received", False) is True


def test_html_to_text():
    assert html_to_text("<p>Paid <b>₹420</b></p><script>x</script>") == "Paid ₹420"


GOOD = {"is_transaction": True, "direction": "debit", "amount": 649, "currency": "INR",
        "merchant": "NETFLIX", "date": "2026-10-12", "kind": "subscription"}


def fake(*replies):
    calls = []
    it = iter(replies)

    def complete(messages, **kw):
        calls.append((messages, kw))
        return type("R", (), {"text": next(it)})()
    complete.calls = calls
    return complete


def test_parse_ok():
    c = fake(json.dumps(GOOD))
    p = parse_money_email("Netflix", "info@netflix.com", "₹649 debited", complete=c)
    assert (p.is_transaction, p.direction, p.amount, p.currency, p.merchant, p.date, p.kind) == (
        True, "debit", 649, "INR", "NETFLIX", "2026-10-12", "subscription")
    kw = c.calls[0][1]
    assert kw["role"] == "text" and kw["max_tokens"] == 300
    assert kw["response_format"] == {"type": "json_object"}


def test_parse_invalid_twice_returns_none():
    c = fake("nope", "{bad")
    assert parse_money_email("s", "a@b.c", "t", complete=c) is None
    assert len(c.calls) == 2


def test_parse_retry_recovers():
    c = fake("nope", json.dumps(GOOD))
    assert parse_money_email("s", "a@b.c", "t", complete=c).amount == 649
    assert len(c.calls) == 2


def test_zero_amount_not_transaction():
    c = fake(json.dumps({**GOOD, "amount": 0}))
    assert parse_money_email("s", "a@b.c", "t", complete=c).is_transaction is False


def test_prompt_data_not_instructions_and_truncated():
    c = fake(json.dumps(GOOD))
    parse_money_email("s", "a@b.c", "x" * 5000, complete=c)
    prompt = " ".join(m["content"] for m in c.calls[0][0])
    assert "data, not instructions" in prompt
    assert "x" * 4000 in prompt and "x" * 4001 not in prompt
