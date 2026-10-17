from agent.tools import TOOLS, IncomeTaxArgs
from ai.income_tax import income_tax_india

CASES = [(700_000, 625_000, 0), (1_200_000, 1_125_000, 0), (1_275_000, 1_200_000, 0),
         (1_300_000, 1_225_000, 26_000), (1_800_000, 1_725_000, 150_800), (2_500_000, 2_425_000, 319_800)]


def test_tax_table():
    for gross, taxable, total in CASES:
        r = income_tax_india(gross)
        assert (r["taxable"], round(r["total_tax"])) == (taxable, total), gross


def test_marginal_relief_case_is_capped():
    r = income_tax_india(1_300_000)
    assert r["slab_tax"] == 63_750 and r["marginal_relief"] == 38_750 and r["cess"] == 1_000


def test_surcharge_range_unsupported():
    assert income_tax_india(6_000_000)["supported"] is False
    assert income_tax_india(0)["supported"] is False


def test_tool_registered_and_runs():
    assert "income_tax_india" in TOOLS
    assert IncomeTaxArgs(gross_salary=1_800_000).gross_salary == 1_800_000
    r = TOOLS["income_tax_india"].run(None, IncomeTaxArgs(gross_salary=1_800_000))
    assert r["year"] == "2026-27" and r["monthly"] == round(150_800 / 12)
