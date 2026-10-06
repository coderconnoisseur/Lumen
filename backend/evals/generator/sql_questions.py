"""The 50 text-to-SQL questions with hand-written gold SQL (SPEC-EVAL: sql.jsonl).

Gold SQL is dialect-neutral (no strftime, `::`, ILIKE, ROUND or date functions; `substr` on the
YYYY-MM-DD text date) and must return identical result sets on SQLite and Postgres. `{user_id}` is
replaced with the case's user. Relative dates are relative to world.AS_OF (2026-06-30). Result sets are
compared, never SQL text; a gold query with ORDER BY is compared in order. The first tag is the split's
stratum. Unanswerable questions have no gold SQL.
"""
from __future__ import annotations

U = "user_id = '{user_id}'"
J = "FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id WHERE t.user_id = '{user_id}'"

# (question, gold_sql, tags, user)
QUESTIONS: list[tuple[str, str | None, list[str], str]] = [
    # --- aggregates
    ("How much have I spent in total?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total_spent FROM transactions WHERE {U}", ["agg"], "u1"),
    ("How many transactions do I have?",
     f"SELECT COUNT(*) AS n FROM transactions WHERE {U}", ["agg"], "u1"),
    ("What is my average transaction amount?",
     f"SELECT AVG(total_amount) AS avg_amount FROM transactions WHERE {U}", ["agg"], "u1"),
    ("What was my largest single purchase amount?",
     f"SELECT MAX(total_amount) AS largest FROM transactions WHERE {U}", ["agg"], "u1"),
    ("How much tax have I paid in total?",
     f"SELECT COALESCE(SUM(tax_amount), 0) AS total_tax FROM transactions WHERE {U}", ["agg"], "u1"),
    ("How much have I spent on groceries?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} AND category = 'Groceries'",
     ["agg", "filter"], "u1"),
    ("Show my total spending per category, highest first.",
     f"SELECT category, SUM(total_amount) AS total FROM transactions WHERE {U} "
     "GROUP BY category ORDER BY total DESC", ["agg"], "u1"),
    ("Which vendor have I spent the most money at?",
     f"SELECT vendor_name, SUM(total_amount) AS total FROM transactions WHERE {U} "
     "GROUP BY vendor_name ORDER BY total DESC LIMIT 1", ["agg"], "u1"),
    ("How many different vendors have I bought from?",
     f"SELECT COUNT(DISTINCT vendor_name) AS vendors FROM transactions WHERE {U}", ["agg"], "u1"),
    ("What is my average electricity bill?",
     f"SELECT AVG(total_amount) AS avg_bill FROM transactions WHERE {U} AND vendor_name = 'City Power Ltd'",
     ["agg", "filter"], "u1"),
    ("How many times have I been to Cafe Aroma?",
     f"SELECT COUNT(*) AS visits FROM transactions WHERE {U} AND vendor_name = 'Cafe Aroma'",
     ["agg", "filter"], "u1"),
    ("What is my average transaction amount for each payment method?",
     f"SELECT payment_method, AVG(total_amount) AS avg_amount FROM transactions WHERE {U} "
     "GROUP BY payment_method", ["agg"], "u1"),
    ("How much have I spent on fuel?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND vendor_name = 'FuelPoint Petroleum'", ["agg", "filter"], "u2"),
    ("How much have I paid for my yoga membership in total?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND vendor_name = 'Lotus Yoga Studio'", ["agg", "filter"], "u2"),
    ("What is my total spending per category?",
     f"SELECT category, SUM(total_amount) AS total FROM transactions WHERE {U} GROUP BY category",
     ["agg"], "u2"),
    # --- filters
    ("List my transactions over 5000 rupees.",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} AND total_amount > 5000",
     ["filter"], "u1"),
    ("Show the purchases I paid for in cash.",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} AND payment_method = 'Cash'",
     ["filter"], "u1"),
    ("Which vendors have I paid by UPI?",
     f"SELECT DISTINCT vendor_name FROM transactions WHERE {U} AND payment_method = 'UPI'", ["filter"], "u1"),
    ("List my healthcare expenses.",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} AND category = 'Healthcare'",
     ["filter"], "u1"),
    ("Which of my transactions had no tax?",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} AND tax_amount = 0",
     ["filter"], "u1"),
    ("Show my restaurant bills under 500 rupees.",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} "
     "AND category = 'Restaurant' AND total_amount < 500", ["filter"], "u1"),
    ("Show my entertainment transactions.",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} AND category = 'Entertainment'",
     ["filter"], "u1"),
    ("List my visits to PetPals Clinic.",
     f"SELECT date, total_amount FROM transactions WHERE {U} AND vendor_name = 'PetPals Clinic'",
     ["filter"], "u2"),
    ("Which shopping purchases cost more than 3000 rupees?",
     f"SELECT vendor_name, date, total_amount FROM transactions WHERE {U} "
     "AND category = 'Shopping' AND total_amount > 3000", ["filter"], "u2"),
    ("Which grocery stores have I bought from?",
     f"SELECT DISTINCT vendor_name FROM transactions WHERE {U} AND category = 'Groceries'", ["filter"], "u2"),
    ("List my transactions at Spice Route Kitchen in 2026.",
     f"SELECT date, total_amount FROM transactions WHERE {U} "
     "AND vendor_name = 'Spice Route Kitchen' AND date >= '2026-01-01'", ["filter", "date"], "u1"),
    # --- dates
    ("How much did I spend last month?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND date >= '2026-05-01' AND date <= '2026-05-31'", ["date", "agg"], "u1"),
    ("Show my monthly spending totals for 2026.",
     f"SELECT substr(date, 1, 7) AS month, SUM(total_amount) AS total FROM transactions WHERE {U} "
     "AND date >= '2026-01-01' GROUP BY substr(date, 1, 7) ORDER BY month", ["date", "agg"], "u1"),
    ("In which month did I spend the most?",
     f"SELECT substr(date, 1, 7) AS month, SUM(total_amount) AS total FROM transactions WHERE {U} "
     "GROUP BY substr(date, 1, 7) ORDER BY total DESC LIMIT 1", ["date", "agg"], "u1"),
    ("How much did I spend in December 2025?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND date >= '2025-12-01' AND date <= '2025-12-31'", ["date", "agg"], "u1"),
    ("On what date was my most recent transaction?",
     f"SELECT MAX(date) AS last_date FROM transactions WHERE {U}", ["date"], "u1"),
    ("How much have I spent so far this year?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} AND date >= '2026-01-01'",
     ["date", "agg"], "u1"),
    ("What did I spend in the first quarter of 2026?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND date >= '2026-01-01' AND date <= '2026-03-31'", ["date", "agg"], "u1"),
    ("How many transactions did I make in June 2026?",
     f"SELECT COUNT(*) AS n FROM transactions WHERE {U} AND date >= '2026-06-01' AND date <= '2026-06-30'",
     ["date", "agg"], "u1"),
    ("Show my grocery spending per month for the last six months.",
     f"SELECT substr(date, 1, 7) AS month, SUM(total_amount) AS total FROM transactions WHERE {U} "
     "AND category = 'Groceries' AND date >= '2026-01-01' GROUP BY substr(date, 1, 7) ORDER BY month",
     ["date", "agg"], "u1"),
    ("When did I first shop at UrbanWear Apparel?",
     f"SELECT MIN(date) AS first_date FROM transactions WHERE {U} AND vendor_name = 'UrbanWear Apparel'",
     ["date", "filter"], "u1"),
    ("What was my average electricity bill in 2025?",
     f"SELECT AVG(total_amount) AS avg_bill FROM transactions WHERE {U} "
     "AND vendor_name = 'City Power Ltd' AND date <= '2025-12-31'", ["date", "agg"], "u1"),
    ("How much did I spend on transport in the first half of 2026?",
     f"SELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions WHERE {U} "
     "AND category = 'Transport' AND date >= '2026-01-01' AND date <= '2026-06-30'", ["date", "agg"], "u2"),
    # --- joins with line items
    ("Which item have I spent the most on overall?",
     f"SELECT ti.item_name, SUM(ti.total_price) AS spent {J} "
     "GROUP BY ti.item_name ORDER BY spent DESC LIMIT 1", ["join", "agg"], "u1"),
    ("How much have I spent on cappuccinos?",
     f"SELECT COALESCE(SUM(ti.total_price), 0) AS spent {J} AND ti.item_name = 'Cappuccino'",
     ["join", "agg"], "u1"),
    ("What items have I bought from TechHub Electronics?",
     f"SELECT DISTINCT ti.item_name {J} AND t.vendor_name = 'TechHub Electronics'", ["join", "filter"], "u1"),
    ("How many items have I bought in total?",
     f"SELECT COALESCE(SUM(ti.quantity), 0) AS items {J}", ["join", "agg"], "u1"),
    ("What is the average price I paid for a litre of milk?",
     f"SELECT AVG(ti.unit_price) AS avg_price {J} AND ti.item_name = 'Milk 1L'", ["join", "agg"], "u1"),
    ("How many litres of petrol have I bought?",
     f"SELECT COALESCE(SUM(ti.quantity), 0) AS litres {J} AND ti.item_name = 'Petrol (litres)'",
     ["join", "agg"], "u2"),
    ("Which of my purchases had more than two different items?",
     f"SELECT t.vendor_name, t.date, t.total_amount FROM transactions t WHERE t.{U} AND "
     "(SELECT COUNT(*) FROM transaction_items ti WHERE ti.transaction_id = t.id) > 2", ["join", "filter"], "u2"),
    # --- unanswerable from this schema
    ("What is my current bank balance?", None, ["unanswerable"], "u1"),
    ("What is my credit score?", None, ["unanswerable"], "u1"),
    ("How much interest have I paid on my credit card?", None, ["unanswerable"], "u1"),
    ("Which vendor has the best customer service?", None, ["unanswerable"], "u2"),
    ("What was the USD exchange rate on the day of my last purchase?", None, ["unanswerable"], "u2"),
]


def rows() -> list[dict]:
    return [
        {"id": f"sql-{n:03d}", "question": q, "gold_sql": sql, "tags": tags, "user": user}
        for n, (q, sql, tags, user) in enumerate(QUESTIONS, start=1)
    ]
