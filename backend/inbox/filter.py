"""Cheap pre-filter for inbox mail (SPEC-EMAIL-INGEST): decide which emails are worth an LLM call."""
from __future__ import annotations

import re
from html.parser import HTMLParser

_MONEY = re.compile(
    r"\b(debited|spent|charged|paid|payment|receipt|invoice|order|renewal|renewed|subscription|upi|txn|transaction)\b",
    re.I)
_PROMO = re.compile(r"\b(offer|sale|deal|newsletter|discount)\b|% off", re.I)
# Rule: a promo word in the subject disqualifies the email unless a debit-style word (a real charge happened)
# appears in subject or body. "order"/"subscription"/"renewal" alone are not enough: promos use them too.
_DEBIT = re.compile(r"\b(debited|charged|paid|payment|receipt|invoice|renewed|txn|transaction)\b", re.I)


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _Text()
    p.feed(html or "")
    p.close()
    return " ".join("".join(p.parts).split())


def is_candidate(subject: str, text: str, has_invoice_attachment: bool) -> bool:
    if has_invoice_attachment:
        return True
    subject, text = subject or "", text or ""
    both = f"{subject}\n{text}"
    if _PROMO.search(subject):
        return bool(_DEBIT.search(both))
    return bool(_MONEY.search(both))
