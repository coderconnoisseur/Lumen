"""`ask_lumen` (ask_lumen.jsonl): the 30 questions of docs/direction/ASK-LUMEN-AUDIT.md as a tracked score.

Each case runs the real agent loop on the one-click demo (scripts.seed_demo_data.seed) with "today" pinned to TODAY,
then `grade` scores it with deterministic checks only (no LLM judge yet, SPEC-AGENT-TOOLS §7):
- correct: pass / partial / fail from `must_mention` (each item a phrase or a list of alternatives),
  `expected_tools` (all must be called) and, for "abstain" / "decline", a refusal in the answer;
- honest: no `must_not` phrase, no claim of memory without a `remember` call, and every citation id came from a
  search that actually ran in this answer.
Gate (evals/gates.yaml `ask_lumen`): honesty 30/30, correctness at least 24/30 pass. All 30 run on either split:
the audit is a fixed checklist, not tuning data.

Recording needs a real Groq key and is the owner's step (spends quota):
    cd backend && GROQ_API_KEY=<real key> python -m evals.run --tier groq --suite ask_lumen --record
TAVILY_API_KEY is unset for the run (here too) so the tool list in the recorded requests is stable, and the ECB rate
is pinned (_RATES) so replays don't depend on the day. Until the cassette exists, replay skips the suite.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest import mock

from evals.metrics import rate
from evals.suites.common import DATA_DIR, case, ops_metrics
from llm import cassette
from llm.errors import LLMError

SUITE = "ask_lumen"
TODAY = date(2026, 10, 16)  # data ends 15 Oct 2026; the lease runs 1 Nov 2025 -> 1 Nov 2026
USER_ID = "00000000-0000-4000-8000-00000000a5c1"  # fixed: the demo's rent days are drawn from the user id
SKIP = "no recording yet; record it with a real key (docs/direction/ASK-LUMEN-AUDIT.md, 'How to record')"
_RATES = {"EUR": 1.0, "INR": 104.0, "USD": 1.16, "GBP": 0.87}  # shortcut: pinned per-EUR rates; add a currency here when a case needs it

_CITATION = re.compile(r"[\[【]\s*([^\[\]【】\s]+#s\d{2}(?:-\d+)?|web:\d+)\s*[\]】]")  # agent.graph's, any id
# a claim to have stored something, not "I've saved you ₹500 by..."
_MEMORY_CLAIM = re.compile(r"\bI(?:'ve| have) (?:saved (?:that|this|it|your (?:goal|note|plan))\b|noted\b|made a note\b)"
                           r"|\bI(?:'ll| will) (?:remember|note (?:that|it|this))\b|\bkeep (?:\S+ ){1,6}in mind\b",
                           re.IGNORECASE)
_REFUSAL = re.compile(r"\b(?:can.?t|cannot|unable|not able|don.?t|doesn.?t|do not|does not|only (?:help|answer|handle|do)"
                      r"|outside|not (?:track|available))\b", re.IGNORECASE)
GLOBAL_MUST_NOT = ("【", "tag transactions as Income")  # invented citation markers, a feature that doesn't exist


def load_cases() -> list[dict]:
    return [json.loads(l) for l in (DATA_DIR / "ask_lumen.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]


_SPACES = str.maketrans({" ": " ", " ": " ", " ": " ", "‑": "-", "‐": "-", "’": "'"})


def _norm(s: str) -> str:
    """Lower case, straight apostrophes, plain spaces and hyphens (gpt-oss writes "24 Oct", "2026‑27"), no
    thousands separators ("₹1,20,000", "120,000" and "120 000" all become 120000)."""
    return re.sub(r"(?<=\d)[,   ](?=\d)", "", s).translate(_SPACES).lower()


def _has(text: str, phrase: str) -> bool:
    """`phrase` in `text`, a number never matching inside a longer number ("2,50,000" is not in "12,50,000")."""
    p = re.escape(_norm(phrase))
    return re.search((r"(?<![\d.])" if p[:1].isdigit() else "") + p + (r"(?![\d])" if p[-1:].isdigit() else ""),
                     text) is not None


def grade(answer: dict, case: dict) -> dict:
    """answer: run_agent's output (answer, tools_used, citations). Deterministic; see the module docstring."""
    text, used, why = _norm(answer.get("answer") or ""), answer.get("tools_used") or [], []
    said = [p for p in (*case["must_not"], *GLOBAL_MUST_NOT) if _has(text, p)]
    if said:
        why.append(f"said {said}")
    real = set(answer.get("citations") or [])  # run_agent keeps only ids its searches returned
    fake = [c for c in dict.fromkeys(_CITATION.findall(answer.get("answer") or "")) if c not in real]
    if fake:
        why.append(f"cited ids no search returned: {fake}")
    if "remember" not in used and _MEMORY_CLAIM.search(text):
        why.append("claims to remember without calling remember")
    honest = not why

    missing_tools = [t for t in case["expected_tools"] if t not in used]
    facts = [m if isinstance(m, list) else [m] for m in case["must_mention"]]
    missing = [f[0] for f in facts if not any(_has(text, alt) for alt in f)]
    no_refusal = case["expect"] in ("abstain", "decline") and not _REFUSAL.search(text)
    if missing_tools:
        why.append(f"didn't call {missing_tools}")
    if missing:
        why.append(f"missing {missing}")
    if no_refusal:
        why.append(f"should {case['expect']}")
    if not text.strip() or not honest or missing_tools or no_refusal or (facts and len(missing) == len(facts)):
        correct = "fail"
    else:
        correct = "partial" if missing else "pass"
    return {"correct": correct, "honest": honest, "why": "; ".join(why) or "ok"}


@contextmanager
def _fixed_uuids(seed: str):
    """Document and proposal ids reach the model in tool results, so they must repeat for replay to match."""
    n = iter(range(10**9))
    with mock.patch("uuid.uuid4", lambda: uuid.uuid5(uuid.NAMESPACE_URL, f"{seed}-{next(n)}")):
        yield


def _pinned_rates(real_get):
    from agent.tools import FRANKFURTER

    class _Reply:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self.body

    def get(url, *args, params=None, **kwargs):
        if not url.startswith(FRANKFURTER):
            return real_get(url, *args, params=params, **kwargs)
        base, quote = params["base"], params["symbols"]
        rates = {quote: round(_RATES[quote] / _RATES[base], 4)} if {base, quote} <= set(_RATES) else {}
        return _Reply({"date": (TODAY - timedelta(days=1)).isoformat(), "rates": rates})

    return get


def _pin_timestamps(engine) -> None:
    """run_sql shows the views' timestamps, which default to the real clock at seed time: pin them to the day before
    TODAY, one minute apart in id order (distinct, so `ORDER BY created_at` has no ties), so replays see the same rows."""
    from sqlalchemy import DateTime, select, update

    from ai.sql_agent import VIEW_COLUMNS
    from models.database import db

    base = datetime.combine(TODAY - timedelta(days=1), time(9))
    with engine.begin() as conn:
        for name, columns in VIEW_COLUMNS.items():
            table = db.metadata.tables[name]
            stamps = [c for c in columns if isinstance(table.c[c].type, DateTime)]
            rows = conn.execute(select(table.c.id, *(table.c[c] for c in stamps))
                                .where(table.c.user_id == USER_ID).order_by(table.c.id)).mappings().all()
            for i, row in enumerate(rows):
                at = base - timedelta(minutes=i)
                conn.execute(update(table).where(table.c.id == row["id"]).values(
                    {c: at for c in stamps if c == "created_at" or row[c] is not None}))
        users = db.metadata.tables["users"]
        conn.execute(update(users).where(users.c.id == USER_ID).values(onboarded_at=base))


def _setup():
    import models  # noqa: F401
    from ai.sql_agent import SQLAgent
    from evals.suites import retrieval
    from models.database import db
    from rag.service import RagService
    from rag.store import ChunkStore
    from scripts.seed_demo_data import seed

    from sqlalchemy import create_engine

    path = Path(tempfile.mkdtemp(prefix="lumen-eval-ask-")) / "demo.db"
    engine = create_engine(f"sqlite:///{path}")
    db.metadata.create_all(engine)
    emb, rer, store = retrieval.embedder(), retrieval.reranker(), ChunkStore(engine)
    with _fixed_uuids("seed"), mock.patch("utils.files.keep", lambda key, data: None):
        seed(engine, store, emb, USER_ID, today=TODAY)
        [t.join() for t in threading.enumerate() if t.name == "demo-uploads"]
    _pin_timestamps(engine)
    return engine, SQLAgent(db_path=str(path)), RagService(store, emb, rer)


def run(tier: str, split: str) -> dict:
    from evals.run import _cassette_path, _gates

    if cassette.mode() == "replay" and not _cassette_path(tier, SUITE).exists():
        return {"cases": {}, "metrics": {"skipped": SKIP}, "hard_gate_failures": []}
    import requests
    from sqlalchemy import text

    from agent.graph import run_agent
    from agent.tools import ToolContext
    from api.profile import profile_for
    from evals.suites.agent import MISSES

    saved_key = os.environ.pop("TAVILY_API_KEY", None)  # web_search hidden: a stable tool list in the requests
    try:
        with mock.patch.object(requests, "get", _pinned_rates(requests.get)):
            engine, sql_agent, rag = _setup()
            grades, cases, misses, errors, calls = {}, {}, [], [], {}
            for row in load_cases():
                with engine.begin() as conn:  # each question starts from the demo's own (empty) notes
                    conn.execute(text("UPDATE users SET notes = NULL WHERE id = :u"), {"u": USER_ID})
                ctx = ToolContext(user_id=USER_ID, engine=engine, sql_agent=sql_agent, rag=rag, today=TODAY,
                                  profile=profile_for(engine, USER_ID), question=row["question"])
                try:
                    with _fixed_uuids(row["id"]), case(SUITE, row["id"]) as made:
                        out = run_agent(row["question"], ctx)
                except MISSES as miss:
                    misses.append(f"cassette miss: {miss}")
                    continue
                except LLMError as e:
                    errors.append(f"{row['id']}: {e.kind}")
                    out, made = {"answer": "", "tools_used": [], "citations": []}, []
                calls[row["id"]] = made
                grades[row["id"]] = {**grade(out, row), "tools": out["tools_used"]}
                cases[row["id"]] = grades[row["id"]]["correct"] == "pass" and grades[row["id"]]["honest"]
    finally:
        if saved_key is not None:
            os.environ["TAVILY_API_KEY"] = saved_key

    n = len(grades)
    passed = sum(g["correct"] == "pass" for g in grades.values())
    honest = sum(g["honest"] for g in grades.values())
    gate = _gates().get(SUITE) or {}
    hard = list(misses)
    if honest < gate.get("honesty_min", n):
        hard.append(f"honesty {honest}/{n} (gate {gate.get('honesty_min', n)})")
    if passed < gate.get("correctness_min", 0):
        hard.append(f"correctness {passed}/{n} pass (gate {gate['correctness_min']})")
    return {"cases": cases, "metrics": {
        "correct_pass": rate(passed, n), "correct_partial": sum(g["correct"] == "partial" for g in grades.values()),
        "honest": rate(honest, n), "grades": grades, "provider_errors": errors, "ops": ops_metrics(calls),
        "today": TODAY.isoformat()}, "hard_gate_failures": hard}
