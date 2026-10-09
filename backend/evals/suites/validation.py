"""`validation` suite (SPEC-EXTRACT EXT-02): the deterministic invoice checks on the gold invoices. No LLM.

Every labelled invoice (`invoices.jsonl`) is validated as printed, against its user's history in the synthetic
world (known vendors, stored invoice numbers, purchase orders, "today" = AS_OF). This measures the rules on their
own; the end-to-end number (rules on what the vision model read) comes with EXT-01.

Reported: recall per planted fault type, precision per rule, the false-flag rate on clean invoices, and how many
clean invoices would be auto-approved (confidence "high"). A case passes when a faulty invoice is caught by its
rule, or a clean invoice gets no flag.
"""
from __future__ import annotations

import json

from evals.generator.world import AS_OF, build_world
from evals.metrics import rate
from evals.suites.common import DATA_DIR
from extract.validate import Context, confidence, validate

RULE_FOR = {"total_mismatch": "total_mismatch", "duplicate": "duplicate", "unknown_vendor": "unknown_vendor",
            "bad_date": "bad_date", "injection": "possible_injection"}


def _contexts(world: dict) -> dict[str, Context]:
    out = {}
    for user in world["users"]:
        txns = [t for t in world["transactions"] if t["user_id"] == user["id"]]
        out[user["key"]] = Context(
            today=AS_OF,
            known_vendors={t["vendor_name"] for t in txns},
            seen_invoices={(t["vendor_name"].lower(), t["invoice_number"]) for t in txns},
            purchase_orders={p["po_number"]: p for p in world["purchase_orders"] if p["user_id"] == user["id"]})
    return out


def run(tier: str, split: str) -> dict:
    splits = {r["invoice_id"]: r["split"] for r in map(json.loads, (DATA_DIR / "extraction.jsonl").open(encoding="utf-8"))}
    invoices = [inv for inv in map(json.loads, (DATA_DIR / "invoices.jsonl").open(encoding="utf-8"))
                if splits.get(inv["id"]) == split]
    contexts = _contexts(build_world(42))
    cases, caught, planted, fired, fired_right, clean, false_flags, auto = {}, {}, {}, {}, {}, 0, [], 0
    for inv in invoices:
        flags = validate(inv, contexts[inv["user"]])
        rules = {f.rule for f in flags}
        for r in rules:
            fired[r] = fired.get(r, 0) + 1
            fired_right[r] = fired_right.get(r, 0) + any(RULE_FOR[f] == r for f in inv["faults"])
        if inv["faults"]:
            fault = inv["faults"][0]
            planted[fault] = planted.get(fault, 0) + 1
            hit = RULE_FOR[fault] in rules
            caught[fault] = caught.get(fault, 0) + hit
            cases[inv["id"]] = hit
        else:
            clean += 1
            cases[inv["id"]] = not flags
            auto += confidence(flags) == "high"
            if flags:
                false_flags.append(f"{inv['id']}: {sorted(rules)}")
    return {"cases": cases, "metrics": {
        "recall_by_fault": {f: rate(caught[f], planted[f]) for f in sorted(planted)},
        "precision_by_rule": {r: rate(fired_right[r], fired[r]) for r in sorted(fired)},
        "clean_false_flag_rate": rate(len(false_flags), clean),
        "clean_auto_approved": rate(auto, clean),
        "false_flags": false_flags,
        "case_accuracy": rate(sum(cases.values()), len(cases))},
        "hard_gate_failures": []}
