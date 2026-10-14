"""SPEC-STATEMENTS: reading bank/card CSV statements."""
import pytest

from statements import read, vendor

HDFC = """HDFC BANK Ltd.,,,,,,
Statement of account,,,,,,
Account No : 50100123456789,,,,,,
,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI/NETFLIX.COM/9876543210/Payment,0000123,01/10/26,649.00,,50351.00
02/10/26,NEFT-ACME CORP SALARY,0000124,02/10/26,,85000.00,135351.00
05/10/26,POS 4111XXXXXXXX1234 SWIGGY BANGALORE,0000125,05/10/26,"1,234.50",,134116.50
,,,,,,
"""
CARD = """Transaction Date,Description,Amount
2026-10-03,AMAZON.IN MARKETPLACE,-2499.00
2026-10-04,PAYMENT RECEIVED - THANK YOU,15000.00
2026-10-06,UBER *TRIP,-312.40
"""
SEMI = """Datum;Beschreibung;Betrag;Typ
07.10.2026;SPOTIFY AB;12,99;Dr
08.10.2026;Refund SPOTIFY;12,99;Cr
"""


def _parse(text):
    rows = read.rows(text)
    h = read.find_header(rows)
    return read.parse(rows, h, read.guess_mapping(rows[h]))


def test_hdfc_style_preamble_withdrawal_deposit_and_day_first_dates():
    rows = read.rows(HDFC)
    h = read.find_header(rows)
    assert rows[h][0] == "Date"
    m = read.guess_mapping(rows[h])
    assert (m["date"], m["description"], m["debit"], m["credit"]) == (0, 1, 4, 5)
    lines = _parse(HDFC)
    assert [(l.date, l.amount, l.kind) for l in lines] == [
        ("2026-10-01", 649.0, "debit"), ("2026-10-02", 85000.0, "credit"), ("2026-10-05", 1234.5, "debit")]


def test_card_export_signed_amount_negative_is_spend():
    lines = _parse(CARD)
    assert [(l.amount, l.kind) for l in lines] == [(2499.0, "debit"), (15000.0, "credit"), (312.4, "debit")]


def test_semicolon_with_dr_cr_marker_and_decimal_comma():
    rows = read.rows(SEMI)
    h = read.find_header(rows)
    m = read.guess_mapping(rows[h])
    assert m["amount"] == 2 and m["drcr"] == 3
    lines = read.parse(rows, h, m)
    assert [(l.date, l.amount, l.kind) for l in lines] == [("2026-10-07", 12.99, "debit"), ("2026-10-08", 12.99, "credit")]


@pytest.mark.parametrize("raw, value, kind", [
    ("1,234.50 Dr", 1234.5, "debit"), ("1,234.50 Cr", 1234.5, "credit"), ("(499.00)", 499.0, "debit"), ("-499", 499.0, "debit"),
    ("1,234.50Dr", 1234.5, "debit"), ("1,234.50Cr", 1234.5, "credit"),
])
def test_amount_signs_in_a_single_amount_column(raw, value, kind):
    rows = [["Date", "Description", "Amount"], ["01/10/2026", "X", raw]]
    (line,) = read.parse(rows, 0, read.guess_mapping(rows[0]))
    assert (line.amount, line.kind) == (value, kind)


def test_unreadable_rows_keep_their_file_line_number():
    rows = read.rows("Date,Description,Amount\nnot a date,X,-5\n01/10/2026,Y,abc\n")
    lines = read.parse(rows, 0, read.guess_mapping(rows[0]))
    assert [(l.line, l.date, l.amount) for l in lines] == [(2, None, 5.0), (3, "2026-10-01", None)]


def test_no_header_found():
    assert read.find_header(read.rows("foo,bar\n1,2\n")) is None


def test_decode_bom_and_latin1():
    assert read.decode("﻿Date,Amount\n".encode("utf-8")).startswith("Date")
    assert "é" in read.decode("Caf\xe9".encode("latin-1"))


@pytest.mark.parametrize("raw, clean, cat", [
    ("UPI/NETFLIX.COM/9876543210/Payment", "Netflix.com", "Subscriptions"),
    ("POS 4111XXXXXXXX1234 SWIGGY BANGALORE", "Swiggy Bangalore", "Food"),
    ("UBER *TRIP", "Uber Trip", "Transport"),
    ("AMAZON.IN MARKETPLACE", "Amazon.in Marketplace", "Shopping"),
    ("NEFT-TATA POWER ELECTRICITY 12345", "Tata Power Electricity", "Utilities"),
    ("IMPS/P2A/123456/RAHUL", "Rahul", "Other"),
])
def test_vendor_cleaning_and_category(raw, clean, cat):
    assert vendor.clean(raw) == clean
    assert vendor.category(raw) == cat


def test_semicolon_statement_with_preamble_and_decimal_comma():
    text = ("Konto;DE123;\nZeitraum;Oktober 2026;\n\nDatum;Beschreibung;Betrag\n"
            "07.10.2026;SPOTIFY AB;-12,99\n08.10.2026;Gehalt;1.500,00\n")
    assert [(l.date, l.amount, l.kind) for l in _parse(text)] == [
        ("2026-10-07", 12.99, "debit"), ("2026-10-08", 1500.0, "credit")]


def test_tab_statement_with_preamble_and_debit_credit_columns():
    text = ("Bank X\tStatement\nAccount\t123\nDate\tDescription\tDebit\tCredit\n"
            "01/10/2026\tRent\t500.00\t\n02/10/2026\tPay\t\t900.00\n")
    assert [(l.date, l.amount, l.kind) for l in _parse(text)] == [
        ("2026-10-01", 500.0, "debit"), ("2026-10-02", 900.0, "credit")]


@pytest.mark.parametrize("raw, cat", [
    ("JioMart", "Groceries"), ("Metro Cash & Carry", "Groceries"), ("Coca Cola", "Other"),
    ("Motorola", "Other"), ("Bholaram Sweets", "Other"), ("Uber Eats", "Food"),
    ("Amazon Prime", "Subscriptions"), ("Indian Oil", "Transport"),
    ("GOOGLE *PLAY", "Subscriptions"), ("APPLE.COM/BILL", "Subscriptions"), ("JIO RECHARGE", "Utilities"),
])
def test_category_matches_whole_words_and_specific_first(raw, cat):
    assert vendor.category(raw) == cat


def test_upi_handle_is_not_part_of_vendor_name():
    assert vendor.clean("UPI/SWIGGY/swiggy8@ybl/123456") == "Swiggy"


def test_single_letter_d_c_markers():
    rows = [["Date", "Description", "Amount", "Type"], ["01/10/2026", "X", "499.00", "D"],
            ["02/10/2026", "Y", "10.00", "C"]]
    lines = read.parse(rows, 0, read.guess_mapping(rows[0]))
    assert [(l.amount, l.kind) for l in lines] == [(499.0, "debit"), (10.0, "credit")]


def test_card_number_column_is_not_a_credit_column():
    m = read.guess_mapping(["Date", "Description", "Credit Card No", "Amount"])
    assert m["credit"] is None and m["amount"] == 3


def test_unclosed_quote_past_field_limit_is_no_header():
    rows = read.rows('Date,Amount\n"' + "a" * 200000)
    assert read.find_header(rows) is None
