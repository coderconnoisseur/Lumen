"""EVAL-02: labelled invoices with planted faults, rendered and degraded (SPEC-EVAL, "Data")."""
import io
from collections import Counter

import pytest
from PIL import Image

FAULTS = {"total_mismatch": 2, "duplicate": 2, "unknown_vendor": 2, "bad_date": 1, "injection": 1}
GOLD_FIELDS = {"vendor_name", "invoice_number", "date", "total_amount", "tax_amount", "payment_method", "address"}


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(seed=42)


@pytest.fixture(scope="module")
def invoices(world):
    from evals.generator.invoices import build_invoices

    return build_invoices(world, seed=42)


def test_twenty_invoices_per_user_with_the_planted_faults(invoices, world):
    from evals.generator.invoices import build_invoices

    assert build_invoices(world, seed=42) == invoices
    for key in ("u1", "u2"):
        mine = [inv for inv in invoices if inv["user"] == key]
        assert len(mine) == 20
        faults = Counter(f for inv in mine for f in inv["faults"])
        assert dict(faults) == FAULTS
        assert sum(not inv["faults"] for inv in mine) == 12


def test_totals_add_up_unless_the_total_mismatch_fault_is_planted(invoices):
    for inv in invoices:
        subtotal = round(sum(line["total"] for line in inv["items"]), 2)
        assert inv["subtotal"] == subtotal
        adds_up = inv["total_amount"] == round(subtotal + inv["tax_amount"], 2)
        assert adds_up == ("total_mismatch" not in inv["faults"]), inv["id"]


def test_duplicates_copy_a_stored_transaction_and_new_invoices_do_not(invoices, world):
    stored = {(t["user_id"], t["vendor_name"], t["invoice_number"]) for t in world["transactions"]}
    user_ids = {u["key"]: u["id"] for u in world["users"]}
    for inv in invoices:
        key = (user_ids[inv["user"]], inv["vendor_name"], inv["invoice_number"])
        assert (key in stored) == ("duplicate" in inv["faults"]), inv["id"]


def test_unknown_vendors_bad_dates_and_injections(invoices, world):
    from evals.generator.world import AS_OF

    known = {v["name"] for v in world["vendors"]}
    for inv in invoices:
        assert (inv["vendor_name"] not in known) == ("unknown_vendor" in inv["faults"]), inv["id"]
        assert (inv["date"] > AS_OF.isoformat()) == ("bad_date" in inv["faults"]), inv["id"]
        assert bool(inv["notes"]) == ("injection" in inv["faults"]), inv["id"]
        if inv["notes"]:
            assert "ignore" in inv["notes"].lower()


def test_po_vendor_invoices_quote_a_purchase_order(invoices, world):
    pos = {po["po_number"]: po for po in world["purchase_orders"]}
    quoted = [inv for inv in invoices if inv["po_number"]]
    assert quoted
    for inv in quoted:
        assert pos[inv["po_number"]]["vendor_name"] == inv["vendor_name"]


def test_rendered_and_degraded_images_are_deterministic_and_small(invoices):
    from evals.generator.invoices import VARIANTS, degrade, render_png

    inv = invoices[0]
    png = render_png(inv)
    assert png == render_png(inv)
    assert Image.open(io.BytesIO(png)).size[0] >= 800
    for variant in VARIANTS[1:]:
        data, ext = degrade(png, variant, seed=42, key=inv["id"])
        assert (data, ext) == degrade(png, variant, seed=42, key=inv["id"])
        assert data != png and ext in {"png", "jpg"}
        Image.open(io.BytesIO(data)).verify()
        assert len(data) < 200_000


def test_extraction_rows_keep_both_variants_of_an_invoice_in_one_split(invoices):
    from evals.generator.invoices import extraction_rows

    rows = extraction_rows(invoices, seed=42)
    assert len(rows) == 2 * len(invoices)
    by_invoice = {}
    for row in rows:
        assert set(row["gold"]) == GOLD_FIELDS
        assert row["variant"] in {"clean", "skew", "blur", "jpeg"}
        by_invoice.setdefault(row["invoice_id"], set()).add(row["split"])
    assert all(len(splits) == 1 for splits in by_invoice.values())
    assert Counter(r["variant"] for r in rows)["clean"] == len(invoices)
    test_invoices = sum(splits == {"test"} for splits in by_invoice.values())
    assert 10 <= test_invoices <= 14
