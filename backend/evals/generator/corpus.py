"""The RAG corpus (purchase orders, vendor contracts, an expense policy per user) with planted facts, and
the retrieval and generation question sets drawn from it.

Labels come from construction, not judgement: each fact is written verbatim into exactly one section, and
its questions are labelled with that section's id. Section ids (`<doc id>#sNN`) are the contract with the
retriever (SPEC-RAG): a retrieved chunk counts as the section it came from, so chunks must not span sections.
"""
from __future__ import annotations

import io
import random
from datetime import date

from evals.generator.splits import assign_splits
from evals.generator.world import CURRENCY

COMPANIES = {
    "u1": ("Acme Design Studio", "2nd Floor, 14 Brigade Road, Bengaluru"),
    "u2": ("Bluebird Logistics", "Plot 9, Peenya Industrial Area, Bengaluru"),
}
CONTRACT_VENDORS = ("NetLink Broadband", "TechHub Electronics", "OfficeNeeds Stationers")

CONFIDENTIALITY = (
    "Each party shall keep the other party's business information confidential and use it only to perform "
    "this agreement. This obligation survives termination."
)
GOVERNING_LAW = "This agreement is governed by the laws of India. Courts in Bengaluru have exclusive jurisdiction."
GENERAL = (
    "The vendor shall supply goods that match the description, quantity and quality stated above. The buyer "
    "may reject goods that are damaged or not as ordered."
)


def _money(value: float) -> str:
    return f"{CURRENCY} {value:,.2f}"


def _doc(doc_id, user, kind, title, sections):
    return {
        "id": doc_id, "user": user, "kind": kind, "title": title,
        "sections": [{"id": f"{doc_id}#s{n:02d}", "heading": h, "text": t} for n, (h, t) in enumerate(sections, 1)],
    }


def _fact(facts, doc, section_no, key, answer, questions):
    facts.append({
        "id": f"{doc['id']}:{key}", "user": doc["user"], "kind": doc["kind"], "doc_id": doc["id"],
        "section_id": f"{doc['id']}#s{section_no:02d}", "answer": answer, "questions": questions,
    })


def _purchase_order(rng, po, user, facts):
    company, address = COMPANIES[user]
    days = rng.choice((7, 10, 14, 21))
    penalty = rng.choice(("0.5", "1", "1.5", "2"))
    lines = "; ".join(f"{l['item']}: {l['quantity']} at {_money(l['unit_price'])}" for l in po["lines"])
    num, vendor = po["po_number"], po["vendor_name"]
    doc = _doc(f"po-{num.lower()}", user, "purchase_order", f"Purchase Order {num}", [
        ("Order details", f"Purchase order {num} was issued on {po['issue_date']} by {company} to {vendor}."),
        ("Order lines", f"{lines}. Order total: {_money(po['total'])}."),
        ("Payment terms", f"Payment is due {po['payment_terms']} from receipt of a valid invoice. "
                          f"Every invoice must quote {num}."),
        ("Delivery", f"Goods must be delivered within {days} calendar days of the order date to {address}. "
                     f"Late delivery incurs a penalty of {penalty}% of the order value per week."),
        ("General conditions", GENERAL),
    ])
    _fact(facts, doc, 2, "order_total", _money(po["total"]), [
        f"What is the order total on purchase order {num}?",
        f"How much is {num} worth in total?",
    ])
    _fact(facts, doc, 3, "payment_terms", po["payment_terms"], [
        f"What are the payment terms on purchase order {num}?",
        f"When is payment due for {num}?",
        f"How long do we have to pay {vendor} under {num}?",
    ])
    _fact(facts, doc, 4, "delivery_days", f"{days} calendar days", [
        f"Within how many days must {vendor} deliver the goods on {num}?",
        f"What is the delivery deadline on purchase order {num}?",
    ])
    return doc


def _contract(rng, vendor, user, facts):
    company, _ = COMPANIES[user]
    start = date(2025, rng.randint(1, 12), 1)
    end = date(start.year + 2, start.month, 1)
    fee = {"NetLink Broadband": rng.choice((999.0, 1499.0, 1999.0)),
           "TechHub Electronics": rng.choice((4500.0, 6000.0, 7500.0)),
           "OfficeNeeds Stationers": rng.choice((2200.0, 2800.0, 3400.0))}[vendor]
    notice = rng.choice((30, 45, 60, 90))
    sla = {"NetLink Broadband": f"{rng.choice(('99.5', '99.9'))}% monthly uptime",
           "TechHub Electronics": f"an engineer on site within {rng.choice((4, 8, 24))} business hours",
           "OfficeNeeds Stationers": f"delivery of standard orders within {rng.choice((2, 3, 5))} working days"}[vendor]
    service = {"NetLink Broadband": "business broadband service", "TechHub Electronics": "IT equipment maintenance",
               "OfficeNeeds Stationers": "office supplies"}[vendor]
    slug = vendor.split()[0].lower()
    doc = _doc(f"contract-{user}-{slug}", user, "contract", f"{vendor} {service} agreement", [
        ("Parties", f"This {service} agreement is made between {company} (the customer) and {vendor} (the vendor)."),
        ("Term", f"The agreement runs from {start:%d %B %Y} until {end:%d %B %Y} and then renews for one year "
                 f"at a time unless either party ends it."),
        ("Fees", f"The customer pays {_money(fee)} per month, invoiced on the first day of each month."),
        ("Termination", f"Either party may terminate this agreement by giving {notice} days' written notice."),
        ("Service levels", f"The vendor commits to {sla}. Repeated misses entitle the customer to a service credit."),
        ("Confidentiality", CONFIDENTIALITY),
        ("Governing law", GOVERNING_LAW),
    ])
    _fact(facts, doc, 2, "end_date", f"{end:%d %B %Y}", [
        f"When does our {vendor} agreement end?",
        f"What is the expiry date of the {service} contract with {vendor}?",
    ])
    _fact(facts, doc, 3, "monthly_fee", _money(fee), [
        f"How much do we pay {vendor} each month under the contract?",
        f"What is the monthly fee in the {vendor} agreement?",
        f"What does the {service} contract cost per month?",
    ])
    _fact(facts, doc, 4, "notice_period", f"{notice} days' written notice", [
        f"How much notice do we need to give to terminate the {vendor} contract?",
        f"What is the termination notice period in our agreement with {vendor}?",
    ])
    _fact(facts, doc, 5, "service_level", sla, [
        f"What service level does {vendor} commit to?",
        f"What does the {vendor} contract guarantee in terms of service?",
    ])
    return doc


def _policy(rng, user, facts):
    company, _ = COMPANIES[user]
    meal, taxi = rng.choice((800, 1000, 1200)), rng.choice((600, 750, 900))
    receipt, approval, payout = rng.choice((250, 500)), rng.choice((10000, 15000, 25000)), rng.choice((7, 10, 15))
    doc = _doc(f"policy-{user}-expenses", user, "policy", f"{company} expense policy", [
        ("Purpose", f"This policy sets out which business expenses {company} reimburses and how to claim them."),
        ("Meals", f"Meals during business travel are reimbursed up to {_money(meal)} per person per day."),
        ("Local transport", f"Taxi and ride-hailing fares are reimbursed up to {_money(taxi)} per trip."),
        ("Receipts", f"An itemised receipt is required for any single expense above {_money(receipt)}."),
        ("Approvals", f"Any purchase above {_money(approval)} needs written approval from the finance manager "
                      f"before it is made."),
        ("Reimbursement", f"Approved claims are paid into the employee's salary account within {payout} working days."),
    ])
    _fact(facts, doc, 2, "meal_limit", _money(meal), [
        "What is the daily meal allowance when travelling for work?",
        "How much can I claim for meals per day on a business trip?",
    ])
    _fact(facts, doc, 3, "taxi_limit", _money(taxi), [
        "What is the maximum taxi fare I can claim per trip?",
        "How much of a cab ride gets reimbursed?",
    ])
    _fact(facts, doc, 4, "receipt_threshold", _money(receipt), [
        "Above what amount do I need an itemised receipt?",
        "When is a receipt required for an expense claim?",
    ])
    _fact(facts, doc, 5, "approval_threshold", _money(approval), [
        "Which purchases need the finance manager's approval?",
        "Above what amount does a purchase need written approval?",
    ])
    _fact(facts, doc, 6, "payout_days", f"{payout} working days", [
        "How quickly are approved expense claims paid?",
        "How long does reimbursement take after a claim is approved?",
    ])
    return doc


def build_corpus(world: dict, seed: int = 42) -> dict:
    keys = {u["id"]: u["key"] for u in world["users"]}
    documents, facts = [], []
    for user in COMPANIES:
        rng = random.Random(f"lumen-corpus:{seed}:{user}")
        for po in world["purchase_orders"]:
            if keys[po["user_id"]] == user:
                documents.append(_purchase_order(rng, po, user, facts))
        for vendor in CONTRACT_VENDORS:
            documents.append(_contract(rng, vendor, user, facts))
        documents.append(_policy(rng, user, facts))
    return {"documents": documents, "facts": facts}


# --- question sets ---------------------------------------------------------------------------------------

def retrieval_rows(corpus: dict, seed: int = 42) -> list[dict]:
    """Each fact's question plus 1-2 templated paraphrases, split together by document kind."""
    split = {f["id"]: f["split"] for f in assign_splits(
        corpus["facts"], lambda f: f["kind"], seed=seed, name="retrieval")}
    rows = []
    for fact in corpus["facts"]:
        rng = random.Random(f"lumen-paraphrase:{seed}:{fact['id']}")
        extra = fact["questions"][1:]
        asked = [fact["questions"][0], *rng.sample(extra, k=min(len(extra), rng.randint(1, 2)))]
        for n, question in enumerate(asked):
            rows.append({
                "id": f"ret-{fact['id']}-{n}", "question": question, "relevant_chunk_ids": [fact["section_id"]],
                "user": fact["user"], "fact_id": fact["id"], "source": "template", "split": split[fact["id"]],
            })
    return rows


NOT_IN_CORPUS = (
    ("u1", "What is the cancellation fee in our StreamFlix subscription contract?"),
    ("u1", "What warranty period does CineMax Theatres offer on gift cards?"),
    ("u1", "What are the payment terms on purchase order PO-U1-209912-99?"),
    ("u2", "How many days of paid leave does the expense policy allow?"),
    ("u2", "What is the late payment interest rate in our Lotus Yoga Studio agreement?"),
    ("u2", "What discount does FuelPoint Petroleum give under our fuel card contract?"),
)


def generation_rows(corpus: dict, seed: int = 42) -> list[dict]:
    """24 answerable questions (8 per document kind), 6 about things not in the corpus and 6 about another
    user's purchase orders (unanswerable for the asker: tenant isolation)."""
    rng = random.Random(f"lumen-generation:{seed}")
    rows = []
    for kind in ("purchase_order", "contract", "policy"):
        for fact in rng.sample([f for f in corpus["facts"] if f["kind"] == kind], k=8):
            rows.append({"id": f"gen-{fact['id']}", "question": fact["questions"][0], "user": fact["user"],
                         "answerable": True, "required_facts": [fact["answer"]], "kind": kind})
    for n, (user, question) in enumerate(NOT_IN_CORPUS, start=1):
        rows.append({"id": f"gen-none-{n:02d}", "question": question, "user": user, "answerable": False,
                     "required_facts": [], "reason": "not_in_corpus", "kind": "unanswerable"})
    # Order totals are unique, so an answer that contains one leaked the other user's document.
    totals = [f for f in corpus["facts"] if f["id"].endswith(":order_total")]
    for n, fact in enumerate(rng.sample(totals, k=6), start=1):
        asker = "u2" if fact["user"] == "u1" else "u1"
        rows.append({"id": f"gen-tenant-{n:02d}", "question": fact["questions"][0], "user": asker,
                     "answerable": False, "required_facts": [], "reason": "other_tenant", "kind": "unanswerable",
                     "must_not": [fact["answer"].removeprefix(f"{CURRENCY} ")]})  # "₹2,415.79" must match
    return assign_splits(rows, lambda r: r["kind"], seed=seed, name="generation")


# --- rendering -------------------------------------------------------------------------------------------

def render_pdf(doc: dict) -> bytes:
    """A text PDF of the document (one heading and paragraph per section). `invariant` keeps it byte-stable."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    styles = getSampleStyleSheet()
    out = io.BytesIO()
    pdf = SimpleDocTemplate(out, pagesize=A4, title=doc["title"], author="Lumen eval generator",
                            invariant=1, leftMargin=56, rightMargin=56, topMargin=56, bottomMargin=56)
    story = [Paragraph(doc["title"], styles["Title"]), Spacer(1, 12)]
    for n, section in enumerate(doc["sections"], start=1):
        story += [Paragraph(f"{n}. {section['heading']}", styles["Heading3"]),
                  Paragraph(section["text"], styles["BodyText"]), Spacer(1, 6)]
    pdf.build(story)
    return out.getvalue()
