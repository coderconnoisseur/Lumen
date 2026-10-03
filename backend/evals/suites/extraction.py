"""Extraction suite: the current invoice reader (one vision call, then the upload route's normaliser) on the
labelled invoices (SPEC-EVAL, EVAL-03). Field-level P/R/F1 overall, per field and per variant (clean vs
degraded); a case passes when all seven gold fields come back right.
"""
from __future__ import annotations

import base64

from evals.metrics import extraction_prf, normalise_field, rate
from evals.suites.common import DATA_DIR, case, load_rows, ops_metrics
from llm.cassette import CassetteMiss
from llm.errors import LLMError

SUITE = "extraction"
MEDIA_TYPES = {"png": "image/png", "jpg": "image/jpeg"}


def read_invoice(path) -> dict:
    """What `/extract` stores for an image upload, minus the save."""
    from utils.normalize import normalize_transaction
    from utils.openrouter import extract_and_structure_with_openrouter

    data = path.read_bytes()
    structured = extract_and_structure_with_openrouter(base64.b64encode(data).decode("ascii"),
                                                       MEDIA_TYPES[path.suffix.lstrip(".")])
    normalized = normalize_transaction(structured)
    if normalized.get("payment_method") == "Unknown":  # the normaliser's placeholder for "not found"
        normalized["payment_method"] = None
    return normalized


def run(tier: str, split: str) -> dict:
    rows = load_rows(SUITE, split)
    cases, pairs, errors, misses, calls = {}, [], [], [], {}
    by_variant: dict[str, list] = {}
    for row in rows:
        try:
            with case(SUITE, row["id"]) as made:
                pred = read_invoice(DATA_DIR / row["file"])
        except CassetteMiss as miss:
            misses.append(f"cassette miss: {miss}")
            continue
        except LLMError as e:  # the user would have seen an error: every field is missing
            pred = {}
            errors.append(f"{row['id']}: {e.kind}")
        calls[row["id"]] = made
        pred = {field: pred.get(field) for field in row["gold"]}
        pairs.append((row["gold"], pred))
        group = "clean" if row["variant"] == "clean" else "degraded"
        by_variant.setdefault(group, []).append((row["gold"], pred))
        by_variant.setdefault(row["variant"], []).append((row["gold"], pred))
        cases[row["id"]] = all(
            normalise_field(f, row["gold"][f]) == normalise_field(f, pred[f]) for f in row["gold"]
        )

    prf = extraction_prf(pairs)
    return {
        "cases": cases,
        "metrics": {
            "field_f1": round(prf["overall"]["f1"], 4),
            "overall": prf["overall"],
            "per_field": prf["per_field"],
            "f1_by_variant": {v: round(extraction_prf(p)["overall"]["f1"], 4) for v, p in sorted(by_variant.items())},
            "all_fields_correct": rate(sum(cases.values()), len(cases)),
            "provider_errors": errors,
            "ops": ops_metrics(calls),
        },
        "hard_gate_failures": misses,
    }
