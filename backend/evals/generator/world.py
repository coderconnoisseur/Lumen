"""The synthetic world every dataset is drawn from: users, vendors, a year of transactions with line
items, and purchase orders. Pure and deterministic: `build_world(seed)` returns plain dicts and the same
seed always gives the same world (string seeds to `random.Random` don't depend on PYTHONHASHSEED).

Dates run from START to AS_OF. Questions with relative dates ("last month") are relative to AS_OF, and the
eval suites pin the pipeline's "today" to it.
"""
from __future__ import annotations

import calendar
import random
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

START = date(2025, 7, 1)
AS_OF = date(2026, 6, 30)
CURRENCY = "INR"


@dataclass(frozen=True)
class Vendor:
    name: str
    category: str
    address: str
    tax_rate: float
    items: tuple[tuple[str, float, float], ...]  # (item, min unit price, max unit price)
    prefix: str  # invoice-number prefix
    monthly: bool = False  # one bill a month instead of random visits
    po_vendor: bool = False  # buys from it go through purchase orders


VENDORS = (
    Vendor("FreshMart Supermarket", "Groceries", "12 MG Road, Bengaluru", 0.05,
           (("Rice 5kg", 320, 420), ("Toor Dal 1kg", 140, 180), ("Milk 1L", 54, 62), ("Eggs (12)", 78, 96),
            ("Olive Oil 1L", 690, 820), ("Bananas 1kg", 48, 70)), "FM"),
    Vendor("Green Basket Organics", "Groceries", "4 Lavelle Road, Bengaluru", 0.05,
           (("Organic Spinach", 40, 60), ("Brown Rice 1kg", 150, 190), ("Almonds 500g", 480, 560)), "GB"),
    Vendor("Spice Route Kitchen", "Restaurant", "88 Church Street, Bengaluru", 0.05,
           (("Paneer Tikka", 260, 320), ("Butter Naan", 55, 70), ("Biryani", 340, 420), ("Lassi", 90, 120)), "SR"),
    Vendor("Cafe Aroma", "Restaurant", "21 Indiranagar 100ft Road, Bengaluru", 0.05,
           (("Cappuccino", 160, 210), ("Croissant", 140, 180), ("Club Sandwich", 260, 320)), "CA"),
    Vendor("City Power Ltd", "Utilities", "Shakti Bhavan, Bengaluru", 0.0,
           (("Electricity bill", 1800, 3200),), "CP", monthly=True),
    Vendor("AquaWorks Water Board", "Utilities", "Cauvery Bhavan, Bengaluru", 0.0,
           (("Water bill", 350, 650),), "AW", monthly=True),
    Vendor("NetLink Broadband", "Utilities", "9 Residency Road, Bengaluru", 0.18,
           (("Fibre 300 Mbps plan", 999, 999),), "NL", monthly=True),
    Vendor("MetroCab", "Transport", "Koramangala 5th Block, Bengaluru", 0.05,
           (("City ride", 180, 520), ("Airport transfer", 850, 1250)), "MC"),
    Vendor("FuelPoint Petroleum", "Transport", "Hosur Road, Bengaluru", 0.0,
           (("Petrol (litres)", 101, 106),), "FP"),
    Vendor("CarePlus Pharmacy", "Healthcare", "3 Jayanagar 4th Block, Bengaluru", 0.12,
           (("Paracetamol 500mg", 25, 35), ("Vitamin D3", 180, 240), ("Cough Syrup", 110, 140)), "CPH"),
    Vendor("UrbanWear Apparel", "Shopping", "Phoenix Mall, Whitefield, Bengaluru", 0.12,
           (("Cotton Shirt", 1199, 1799), ("Denim Jeans", 1999, 2899), ("Sneakers", 2999, 4499)), "UW"),
    Vendor("TechHub Electronics", "Shopping", "SP Road, Bengaluru", 0.18,
           (("USB-C Cable", 399, 599), ("Wireless Mouse", 899, 1299), ("Keyboard", 1499, 2499),
            ("Monitor 24in", 9999, 12999)), "TH", po_vendor=True),
    Vendor("OfficeNeeds Stationers", "Other", "Avenue Road, Bengaluru", 0.12,
           (("A4 Paper Ream", 260, 320), ("Printer Toner", 2400, 3100), ("Notebooks (10)", 450, 600)),
           "ON", po_vendor=True),
    Vendor("CineMax Theatres", "Entertainment", "Orion Mall, Bengaluru", 0.18,
           (("Movie ticket", 220, 420), ("Popcorn Combo", 280, 360)), "CM"),
    Vendor("StreamFlix", "Entertainment", "Online", 0.18,
           (("Monthly subscription", 649, 649),), "SF", monthly=True),
    Vendor("Lotus Yoga Studio", "Healthcare", "17 HSR Layout, Bengaluru", 0.18,
           (("Monthly membership", 2500, 2500),), "LY", monthly=True),
    Vendor("PetPals Clinic", "Healthcare", "Sarjapur Road, Bengaluru", 0.18,
           (("Consultation", 600, 900), ("Vaccination", 1200, 1800)), "PP"),
)
VENDORS_BY_NAME = {v.name: v for v in VENDORS}

PAYMENT_METHODS = ("Credit Card", "Debit Card", "UPI", "Cash")

# Visits per month for each user's non-monthly vendors. Each user also has vendors the other never uses,
# so tenant-isolation questions have something to leak.
PROFILES = {
    "u1": {
        "monthly": ("City Power Ltd", "AquaWorks Water Board", "NetLink Broadband", "StreamFlix"),
        "visits": {"FreshMart Supermarket": 5, "Spice Route Kitchen": 2, "Cafe Aroma": 3, "MetroCab": 2,
                   "CarePlus Pharmacy": 1, "UrbanWear Apparel": 0.4, "TechHub Electronics": 0.3,
                   "OfficeNeeds Stationers": 0.4, "CineMax Theatres": 1},
    },
    "u2": {
        "monthly": ("City Power Ltd", "AquaWorks Water Board", "NetLink Broadband", "Lotus Yoga Studio"),
        "visits": {"Green Basket Organics": 4, "FreshMart Supermarket": 1, "Spice Route Kitchen": 1,
                   "FuelPoint Petroleum": 3, "MetroCab": 1, "PetPals Clinic": 0.4, "TechHub Electronics": 0.5,
                   "OfficeNeeds Stationers": 0.3, "UrbanWear Apparel": 0.6},
    },
}


def user_id(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://lumen.test/eval/{key}"))


def _months():
    year, month = START.year, START.month
    while (year, month) <= (AS_OF.year, AS_OF.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def _visits(rng: random.Random, per_month: float) -> int:
    """A whole number of visits averaging `per_month`."""
    whole = int(per_month)
    return whole + (1 if rng.random() < per_month - whole else 0)


def _items(rng: random.Random, vendor: Vendor, monthly: bool) -> list[tuple[str, int, float]]:
    if monthly:
        name, low, high = vendor.items[0]
        return [(name, 1, round(rng.uniform(low, high), 2))]
    if vendor.name == "FuelPoint Petroleum":
        name, low, high = vendor.items[0]
        return [(name, rng.randint(15, 40), round(rng.uniform(low, high), 2))]
    picks = rng.sample(vendor.items, k=min(len(vendor.items), rng.randint(1, 3)))
    return [(name, rng.randint(1, 3), round(rng.uniform(low, high), 2)) for name, low, high in picks]


def _transaction(user: dict, n: int, vendor: Vendor, day: date, items, payment: str) -> tuple[dict, list[dict]]:
    txn_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://lumen.test/eval/{user['key']}/txn/{n}"))
    lines = [
        {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{txn_id}/item/{i}")),
            "transaction_id": txn_id,
            "item_name": name,
            "quantity": qty,
            "unit_price": price,
            "total_price": round(qty * price, 2),
        }
        for i, (name, qty, price) in enumerate(items)
    ]
    subtotal = round(sum(line["total_price"] for line in lines), 2)
    tax = round(subtotal * vendor.tax_rate, 2)
    txn = {
        "id": txn_id,
        "user_id": user["id"],
        "vendor_name": vendor.name,
        "invoice_number": f"{vendor.prefix}-{day:%Y%m}-{user['key'].upper()}{n:04d}",
        "date": day.isoformat(),
        "total_amount": round(subtotal + tax, 2),
        "tax_amount": tax,
        "payment_method": payment,
        "address": vendor.address,
        "category": vendor.category,
        "created_at": f"{day.isoformat()} 12:00:00",
    }
    return txn, lines


def _purchase_orders(rng: random.Random, user: dict) -> list[dict]:
    """A few POs per user with the vendors bought from on purchase orders (EXT-02 vendor/PO match)."""
    pos = []
    for n, (year, month) in enumerate(list(_months())[::2]):
        vendor = VENDORS_BY_NAME[rng.choice(("TechHub Electronics", "OfficeNeeds Stationers"))]
        picks = rng.sample(vendor.items, k=min(2, len(vendor.items)))
        lines = [{"item": name, "quantity": rng.randint(2, 10), "unit_price": round(rng.uniform(low, high), 2)}
                 for name, low, high in picks]
        pos.append({
            "po_number": f"PO-{user['key'].upper()}-{year}{month:02d}-{n + 1:02d}",
            "user_id": user["id"],
            "vendor_name": vendor.name,
            "issue_date": date(year, month, rng.randint(1, 10)).isoformat(),
            "payment_terms": rng.choice(("Net 15", "Net 30", "Net 45")),
            "lines": lines,
            "total": round(sum(round(l["quantity"] * l["unit_price"], 2) for l in lines), 2),
            "currency": CURRENCY,
        })
    return pos


def build_world(seed: int = 42) -> dict:
    users, transactions, items, purchase_orders = [], [], [], []
    for key, profile in PROFILES.items():
        user = {"key": key, "id": user_id(key), "email": f"{key}@eval.lumen.test"}
        users.append(user)
        rng = random.Random(f"lumen-eval:{seed}:{key}")
        visits = []
        for year, month in _months():
            last_day = calendar.monthrange(year, month)[1]
            for name in profile["monthly"]:
                visits.append((date(year, month, min(5 + len(name) % 20, last_day)), VENDORS_BY_NAME[name], True))
            for name, per_month in profile["visits"].items():
                for _ in range(_visits(rng, per_month)):
                    visits.append((date(year, month, rng.randint(1, last_day)), VENDORS_BY_NAME[name], False))
        visits.sort(key=lambda v: (v[0], v[1].name))
        for n, (day, vendor, monthly) in enumerate(visits):
            payment = "UPI" if monthly else rng.choice(PAYMENT_METHODS)
            txn, lines = _transaction(user, n, vendor, day, _items(rng, vendor, monthly), payment)
            transactions.append(txn)
            items.extend(lines)
        purchase_orders.extend(_purchase_orders(rng, user))

    return {
        "seed": seed,
        "as_of": AS_OF.isoformat(),
        "currency": CURRENCY,
        "users": users,
        "vendors": [{"name": v.name, "category": v.category, "address": v.address} for v in VENDORS],
        "transactions": transactions,
        "transaction_items": items,
        "purchase_orders": purchase_orders,
    }
