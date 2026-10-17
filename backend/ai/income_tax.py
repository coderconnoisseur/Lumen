"""India income tax, new regime, for a resident salaried individual. Constants are for the tax year below."""
YEAR = "2026-27"
STANDARD_DEDUCTION = 75_000
# (slab upper limit, rate) on taxable income
SLABS = [(400_000, 0), (800_000, 0.05), (1_200_000, 0.10), (1_600_000, 0.15), (2_000_000, 0.20),
         (2_400_000, 0.25), (float("inf"), 0.30)]
REBATE_LIMIT, REBATE_MAX = 1_200_000, 60_000  # section 87A: no tax up to this taxable income
CESS = 0.04
MAX_TAXABLE = 5_000_000  # shortcut: surcharge not modelled, extend when asked above this
SOURCES = ["https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1",
           "https://www.indiabudget.gov.in"]


def income_tax_india(gross_salary: float) -> dict:
    taxable = max(0, gross_salary - STANDARD_DEDUCTION)
    if gross_salary <= 0 or taxable > MAX_TAXABLE:
        return {"supported": False, "reason": "Only salaries with taxable income up to ₹50 lakh are supported "
                                              "(surcharge is not modelled)."}
    slab_tax, low = 0.0, 0
    for high, rate in SLABS:
        slab_tax += max(0, min(taxable, high) - low) * rate
        low = high
    rebate = min(slab_tax, REBATE_MAX) if taxable <= REBATE_LIMIT else 0
    tax = slab_tax - rebate
    # just above the limit, tax can't exceed the income above it
    relief = max(0, tax - (taxable - REBATE_LIMIT)) if taxable > REBATE_LIMIT else 0
    tax -= relief
    cess = round(tax * CESS, 2)
    total = tax + cess
    return {"year": YEAR, "regime": "new", "gross": gross_salary, "standard_deduction": STANDARD_DEDUCTION,
            "taxable": taxable, "slab_tax": round(slab_tax, 2), "rebate": round(rebate, 2),
            "marginal_relief": round(relief, 2), "cess": cess, "total_tax": round(total, 2),
            "monthly": round(total / 12), "effective_rate_pct": round(total / gross_salary * 100, 2),
            "sources": SOURCES,
            "note": "Estimate for a resident salaried individual under the new regime; not the old regime, "
                    "capital gains or business income."}
