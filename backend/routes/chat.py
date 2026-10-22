# routes/chat.py
import logging
import uuid
from datetime import datetime

from flask import Blueprint, abort, g, request, jsonify
from sqlalchemy import func

from models import ChatMessage, ChatThread
from models.database import db
from utils.auth import require_auth
from utils.errors import KEY_MESSAGES, api_error, llm_api_error
from utils.limiter import limiter
from utils.llm import LLMError

logger = logging.getLogger(__name__)

chat_bp = Blueprint("chat", __name__)

def _attach(file, user_id: str) -> dict:
    """Read and check an invoice attached in Ask Lumen and file a save_invoice proposal; saves nothing."""
    import json as _json

    from sqlalchemy.orm import Session

    from api.agent import get_agent_deps
    from api.review import check_invoice
    from models import AuditEvent, Proposal
    from routes.ocr import UploadError, read_uploaded_invoice

    engine = get_agent_deps().engine
    try:
        invoice = read_uploaded_invoice(engine, user_id, file.filename or "", file.read())
    except UploadError as e:
        return {"error": e.message, "code": e.code}
    checks = check_invoice(engine, user_id, invoice)
    proposal_id = str(uuid.uuid4())
    target = invoice.get("invoice_number") or invoice.get("vendor_name") or "attached invoice"
    proposal = Proposal(id=proposal_id, user_id=user_id, type="save_invoice",
                        target=target,
                        payload=_json.dumps(invoice, default=str), risk="low",
                        reason="Save the invoice you attached in chat.", evidence="[]", status="pending")
    with Session(engine) as session, session.begin():
        session.add(proposal)
        session.add(AuditEvent(user_id=user_id, actor="user", action="proposal_created", proposal_id=proposal_id,
                               detail=_json.dumps({"type": "save_invoice", "target": target})))
    return {"invoice": invoice, **checks, "proposal_id": proposal_id}


def _ask(question: str, user_id: str, attachment: dict | None = None, history: list[dict] | None = None) -> dict:
    """Ask Lumen is the agent (SPEC-AGENT, switched after AGT-07 passed its gates on 2026-10-09): it picks its tools
    (SQL, documents, anomalies, forecast, invoices), cites evidence and only proposes changes."""
    from datetime import date

    from agent.graph import run_agent
    from agent.tools import ToolContext
    from api.agent import get_agent_deps
    from api.profile import profile_for
    from utils.files import document_key

    deps = get_agent_deps()
    ctx = ToolContext(user_id=user_id, engine=deps.engine, sql_agent=deps.sql_agent, rag=deps.rag,
                      today=deps.today or date.today(), profile=profile_for(deps.engine, user_id), question=question)
    out = run_agent(question, ctx, complete=deps.complete, attachment=attachment, history=history)
    # Evidence for the UI (passages, the original file, timings); built after the run, so prompts don't change.
    # The SQL stays server-side: it's an internal detail, not something to show users.
    return {"query": question, "query_type": "agent", "response": out["answer"], "follow_up": out["follow_up"],
            "row_count": len(out["rows"]) if out["rows"] is not None else None,
            "sources": [s if "url" in s else {**s, "file_key": document_key(user_id, s["chunk_id"].split("#")[0])}
                        for s in out["sources"]],  # web sources link out; documents open the stored file
            "steps": [{"tool": s["tool"], "summary": s.get("summary"), "latency_ms": s.get("latency_ms")}
                      for s in out["steps"]],
            "stopped": out["stopped"],
            "proposals": out["proposals"], "attachment": attachment}


TITLE_CHARS = 60


def _title(question: str) -> str:
    """The first question, cut at a word boundary (no LLM-written titles)."""
    q = " ".join(question.split())
    if len(q) <= TITLE_CHARS:
        return q
    cut = q[: TITLE_CHARS - 1].rsplit(" ", 1)[0] or q[: TITLE_CHARS - 1]
    return cut.rstrip(" ,.;:-") + "\u2026"


def _own_thread(user_id: str, thread_id) -> ChatThread:
    """The caller's thread, or a 404 (another user's id looks exactly like a missing one; so does a non-string id
    from a hand-made request, which Postgres would otherwise reject with a 500)."""
    if not isinstance(thread_id, str):
        abort(404)
    thread = db.session.get(ChatThread, thread_id)
    if thread is None or thread.user_id != user_id:
        abort(404)
    return thread


def _thread_for(user_id: str, thread_id: str | None, question: str) -> ChatThread:
    """The thread to save into. A new one is only added to the session: _save_exchange commits it together with its
    messages, so a failed save leaves no empty titled thread behind."""
    if thread_id:
        return _own_thread(user_id, thread_id)
    thread = ChatThread(id=str(uuid.uuid4()), user_id=user_id, title=_title(question) or "New chat")
    db.session.add(thread)
    return thread


def _save_exchange(user_id: str, thread_id: str, question: str, answer: str) -> None:
    for role, content in (("user", question), ("assistant", answer)):
        db.session.add(ChatMessage(id=str(uuid.uuid4()), user_id=user_id, thread_id=thread_id, role=role,
                                   content=content))
    thread = db.session.get(ChatThread, thread_id)
    if thread is not None:
        thread.updated_at = datetime.utcnow()
    db.session.commit()


def _thread_history(user_id: str, thread_id: str | None) -> list[dict]:
    """The thread's messages so far, oldest first, for the agent's memory (it trims to the last few turns)."""
    if not thread_id:
        return []
    rows = ChatMessage.query.filter_by(user_id=user_id, thread_id=thread_id).order_by(
        ChatMessage.created_at.asc(), ChatMessage.role.desc()).all()
    return [{"role": r.role, "content": r.content} for r in rows]


def _has_legacy(user_id: str) -> bool:
    return ChatMessage.query.filter_by(user_id=user_id, thread_id=None).first() is not None


def _fold_legacy(user_id: str) -> None:
    """Messages saved before threads existed become one "Earlier chats" thread, once. Two first lists at the same
    time (two tabs) both see legacy rows, but only one UPDATE moves them; the other keeps no thread."""
    if not _has_legacy(user_id):
        return
    newest = db.session.query(func.max(ChatMessage.created_at)).filter(
        ChatMessage.user_id == user_id, ChatMessage.thread_id.is_(None)).scalar() or datetime.utcnow()
    thread_id = str(uuid.uuid4())
    moved = ChatMessage.query.filter_by(user_id=user_id, thread_id=None).update({"thread_id": thread_id})
    if not moved:
        db.session.rollback()
        return
    db.session.add(ChatThread(id=thread_id, user_id=user_id, title="Earlier chats", created_at=newest, updated_at=newest))
    db.session.commit()


# What the user sees for each provider failure (status codes: utils.errors.llm_api_error).
_LLM_MESSAGES = {
    "rate_limited": "Lumen's assistant is handling too many requests right now. Please try again in a minute.",
    "bad_response": "The assistant didn't return an answer. Please try again.",
    "unavailable": "Lumen's assistant is unavailable right now. Please try again shortly.",
}


@chat_bp.route("/chat", methods=["POST"])
@limiter.limit("30 per minute")
@require_auth
def chat():
    """Natural language query interface. Identity from JWT only."""
    file = request.files.get("file")
    if file:
        query = (request.form.get("query") or "").strip()
    else:
        query = ((request.get_json(silent=True) or {}).get("query") or "").strip()

    if not query:
        return jsonify({"error": "Query is required"}), 400

    user_id = str(g.user_id)
    body = request.form if file else (request.get_json(silent=True) or {})
    thread_id = body.get("thread_id") or None
    if thread_id:
        _own_thread(user_id, thread_id)  # 404 before anything is spent or saved

    from api.agent import count_platform_question

    if not count_platform_question(g.jwt_claims, request.headers.get("Authorization", ""), request.remote_addr or ""):
        return api_error(KEY_MESSAGES["needs_key"], status=402, code="needs_key")

    try:
        logger.info("Processing chat query for user=%s", user_id)
        attachment = _attach(file, user_id) if file else None
        result = _ask(query, user_id, attachment, _thread_history(user_id, thread_id))
    except LLMError as e:
        return llm_api_error(e, _LLM_MESSAGES, context=f"Chat failed for user={user_id}")
    except Exception as e:
        return api_error("Chat request failed", code="chat_failed", log=e)

    try:
        thread = _thread_for(user_id, thread_id, query)
        result["thread_id"] = thread.id
        _save_exchange(user_id, thread.id, f"{query} [attached: {file.filename}]" if file else query,
                       result["response"])
    except Exception as e:
        # Losing history shouldn't cost the user their answer. A new thread was rolled back with it: don't hand out its id.
        db.session.rollback()
        if not thread_id:
            result.pop("thread_id", None)
        logger.exception("Failed to save chat history for user=%s: %s", user_id, e)

    return jsonify({"success": True, "data": result}), 200


def _iso(d):
    return d.isoformat() + "Z" if d else None  # stored as naive UTC


@chat_bp.route("/chat/threads", methods=["GET"])
@require_auth
def list_threads():
    """The caller's conversations, newest first (max 50), with message counts."""
    user_id = str(g.user_id)
    _fold_legacy(user_id)
    counts = dict(db.session.query(ChatMessage.thread_id, func.count()).filter(ChatMessage.user_id == user_id)
                  .group_by(ChatMessage.thread_id).all())
    threads = ChatThread.query.filter_by(user_id=user_id).order_by(ChatThread.updated_at.desc()).limit(50).all()
    return jsonify({"success": True, "threads": [
        {"id": t.id, "title": t.title, "message_count": counts.get(t.id, 0), "updated_at": _iso(t.updated_at)}
        for t in threads]}), 200


@chat_bp.route("/chat/threads/<thread_id>", methods=["GET"])
@require_auth
def get_thread(thread_id):
    user_id = str(g.user_id)
    thread = _own_thread(user_id, thread_id)
    rows = ChatMessage.query.filter_by(user_id=user_id, thread_id=thread.id).order_by(
        ChatMessage.created_at.asc(), ChatMessage.role.desc()).all()  # a question sorts before its same-instant answer
    return jsonify({"success": True, "thread": {"id": thread.id, "title": thread.title}, "messages": [
        {"id": r.id, "role": r.role, "content": r.content, "created_at": _iso(r.created_at)} for r in rows]}), 200


@chat_bp.route("/chat/threads/<thread_id>", methods=["DELETE"])
@require_auth
def delete_thread(thread_id):
    user_id = str(g.user_id)
    thread = _own_thread(user_id, thread_id)
    ChatMessage.query.filter_by(user_id=user_id, thread_id=thread.id).delete()
    db.session.delete(thread)
    db.session.commit()
    return jsonify({"success": True}), 200


DEFAULT_SUGGESTIONS = [
    "Which vendor did I spend the most with?",
    "What is my average electricity bill?",
    "What's the notice period in the TechHub contract?",
    "Invoice FM-202606-U10223 looks miscategorised; propose Shopping.",
]

# One question per onboarding goal (SPEC-ONBOARD); the user's goals' questions come first.
GOAL_QUESTIONS = {
    "save_more": "Where could I save money this month?",
    "cut_subscriptions": "Which subscriptions haven't I used lately?",
    "stay_on_budget": "Will I stay within budget this month?",
    "pay_off_debt": "How much did I spend on loan or card payments this year?",
    "emergency_fund": "How much do I spend in a typical month?",
    "big_purchase": "What could I cut to save for a big purchase?",
    "business_expenses": "Which vendors did my business spend the most with?",
}


def _profile_for(user_id: str) -> dict | None:
    from api.profile import load_profile

    try:
        return load_profile(db.session, user_id)
    except Exception:  # no profile table yet: the default questions
        return None


@chat_bp.route("/chat/suggestions", methods=["GET"])
@require_auth
def get_suggestions():
    profile = _profile_for(str(g.user_id))
    if not profile:
        return jsonify({"suggestions": DEFAULT_SUGGESTIONS}), 200
    ours = [GOAL_QUESTIONS[goal] for goal in profile.get("goals") or [] if goal in GOAL_QUESTIONS]
    suggestions = list(dict.fromkeys(ours + DEFAULT_SUGGESTIONS))[:4]
    return jsonify({"suggestions": suggestions}), 200
