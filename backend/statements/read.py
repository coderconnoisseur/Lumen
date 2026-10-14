"""Read a bank/card CSV statement into dated, signed lines (SPEC-STATEMENTS)."""
import csv
import io
import re
from dataclasses import dataclass

from utils.normalize import clean_amount, parse_date

# Header synonyms, compared after lowercasing and dropping non-alphanumerics.
# Exact match, or startswith for synonyms of 4+ characters ("withdrawalamt").
_SYNONYMS = {
    "drcr": ["drcr", "crdr", "dc", "type", "typ", "debitcredit", "creditdebit", "transactiontype"],
    "date": ["date", "transactiondate", "txndate", "trandate", "postingdate", "postdate", "bookingdate",
             "valuedate", "datum"],
    "debit": ["withdrawal", "debit", "dr", "paidout", "moneyout", "ausgabe"],
    "credit": ["deposit", "credit", "cr", "paidin", "moneyin", "einnahme"],
    "amount": ["amount", "amt", "betrag", "transactionamount"],
    "description": ["description", "narration", "details", "particulars", "remarks", "memo", "payee",
                    "beschreibung", "transactiondetails"],
}
_ORDER = ["drcr", "date", "debit", "credit", "amount", "description"]
_MARKER = re.compile(r"\b(dr|cr|debit|credit)\b\.?", re.I)
_DECIMAL_COMMA = re.compile(r"^[\d.' ]*,\d{2}$")


@dataclass
class Line:
    line: int  # 1-based line in the file
    date: str | None
    description: str
    amount: float | None  # always positive
    kind: str | None  # "debit" | "credit"


def decode(data):
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def rows(text):
    # ponytail: blank rows are kept as [] so Line.line stays the real file line; parse skips them
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[c.strip() for c in r] for r in csv.reader(io.StringIO(text), dialect)]


def _norm(cell):
    return re.sub(r"[^a-z0-9]", "", cell.lower())


def guess_mapping(header):
    names = [_norm(c) for c in header]
    mapping = dict.fromkeys(_ORDER)
    claimed = set()
    for key in _ORDER:
        for i, name in enumerate(names):
            if i in claimed or not name:
                continue
            if any(name == s or (len(s) >= 4 and name.startswith(s)) for s in _SYNONYMS[key]):
                mapping[key] = i
                claimed.add(i)
                break
    return mapping


def find_header(rows):
    for i, row in enumerate(rows[:30]):
        m = guess_mapping(row)
        if m["date"] is not None and any(m[k] is not None for k in ("debit", "credit", "amount")):
            return i
    return None


def _cell(row, index):
    return row[index] if index is not None and index < len(row) else ""


def _number(text):
    """Absolute value of an amount string, or None. Signs are the caller's job."""
    text = _MARKER.sub("", text).replace("(", "").replace(")", "").replace("-", "").strip()
    if _DECIMAL_COMMA.match(text):
        text = text.replace(".", "").replace("'", "").replace(" ", "").replace(",", ".")
    return clean_amount(text)


def _signed(text):
    """(amount, kind) from one amount cell: minus/parentheses = debit, Dr/Cr suffix overrides."""
    amount = _number(text)
    if amount is None:
        return None, None
    marker = _MARKER.search(text)
    if marker:
        return amount, "debit" if marker.group(1).lower() in ("dr", "debit") else "credit"
    negative = text.lstrip().startswith("-") or "(" in text or text.rstrip().endswith("-")
    return amount, "debit" if negative else "credit"


def parse(rows, header_index, mapping):
    lines = []
    for i, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        if not any(row):
            continue
        amount = kind = None
        if mapping["debit"] is not None or mapping["credit"] is not None:
            debit = _number(_cell(row, mapping["debit"]))
            credit = _number(_cell(row, mapping["credit"]))
            if debit and debit > 0:
                amount, kind = debit, "debit"
            elif credit and credit > 0:
                amount, kind = credit, "credit"
        elif mapping["amount"] is not None:
            amount, kind = _signed(_cell(row, mapping["amount"]))
            marker = _cell(row, mapping["drcr"]).lower()
            if amount is not None and marker:
                if marker.startswith(("dr", "debit")):
                    kind = "debit"
                elif marker.startswith(("cr", "credit")):
                    kind = "credit"
        lines.append(Line(i, parse_date(_cell(row, mapping["date"])), _cell(row, mapping["description"]), amount, kind))
    return lines
