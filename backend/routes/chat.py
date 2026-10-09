# routes/chat.py
import logging
import uuid

from flask import Blueprint, g, request, jsonify

from models import ChatMessage
from models.database import db
from utils.auth import require_auth
from utils.errors import api_error, llm_api_error
from utils.limiter import limiter
from utils.llm import LLMError

logger = logging.getLogger(__name__)

chat_bp = Blueprint("chat", __name__)

def _ask(question: str, user_id: str) -> dict:
    """Ask Lumen is the agent (SPEC-AGENT, switched after AGT-07 passed its gates on 2026-10-09): it picks its tools
    (SQL, documents, anomalies, forecast, invoices), cites evidence and only proposes changes."""
    from datetime import date

    from agent.graph import run_agent
    from agent.tools import ToolContext
    from api.agent import get_agent_deps
    from utils.files import document_key

    deps = get_agent_deps()
    ctx = ToolContext(user_id=user_id, engine=deps.engine, sql_agent=deps.sql_agent, rag=deps.rag,
                      today=deps.today or date.today())
    out = run_agent(question, ctx, complete=deps.complete)
    # Evidence for the UI (passages, the original file, timings, SQL); built after the run, so prompts don't change.
    return {"query": question, "query_type": "agent", "response": out["answer"],
            "row_count": len(out["rows"]) if out["rows"] is not None else None,
            "sources": [{**{k: s[k] for k in ("chunk_id", "title", "section", "text")},
                         "file_key": document_key(user_id, s["chunk_id"].split("#")[0])} for s in out["sources"]],
            "steps": [{"tool": s["tool"], "summary": s.get("summary"), "latency_ms": s.get("latency_ms")}
                      for s in out["steps"]],
            "sql": out["sql"], "stopped": out["stopped"],
            "proposals": out["proposals"]}


def _save_exchange(user_id: str, question: str, answer: str) -> None:
    for role, content in (("user", question), ("assistant", answer)):
        db.session.add(
            ChatMessage(
                id=str(uuid.uuid4()),
                user_id=user_id,
                role=role,
                content=content,
            )
        )
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
    data = request.json or {}
    query = (data.get("query") or "").strip()

    if not query:
        return jsonify({"error": "Query is required"}), 400

    user_id = str(g.user_id)

    from api.agent import DEMO_QUESTIONS_PER_DAY, count_demo_question

    if not count_demo_question(g.jwt_claims, request.headers.get("Authorization", ""), request.remote_addr or ""):
        return api_error(f"The demo allows {DEMO_QUESTIONS_PER_DAY} questions a day. Sign up to keep going.",
                         status=429, code="demo_limit")

    try:
        logger.info("Processing chat query for user=%s", user_id)
        result = _ask(query, user_id)
    except LLMError as e:
        return llm_api_error(e, _LLM_MESSAGES, context=f"Chat failed for user={user_id}")
    except Exception as e:
        return api_error("Chat request failed", code="chat_failed", log=e)

    try:
        _save_exchange(user_id, query, result["response"])
    except Exception as e:
        # Losing history shouldn't cost the user their answer.
        db.session.rollback()
        logger.exception("Failed to save chat history for user=%s: %s", user_id, e)

    return jsonify({"success": True, "data": result}), 200


@chat_bp.route("/chat/history", methods=["GET"])
@require_auth
def chat_history():
    """Return recent chat messages for the authenticated user."""
    limit = min(int(request.args.get("limit", 50)), 200)
    user_id = str(g.user_id)

    rows = (
        ChatMessage.query.filter_by(user_id=user_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
        .all()
    )

    return jsonify(
        {
            "success": True,
            "messages": [
                {
                    "id": row.id,
                    "role": row.role,
                    "content": row.content,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ],
        }
    ), 200


@chat_bp.route("/chat/history", methods=["DELETE"])
@require_auth
def clear_chat_history():
    """Clear chat history for the authenticated user."""
    user_id = str(g.user_id)
    ChatMessage.query.filter_by(user_id=user_id).delete()
    db.session.commit()
    return jsonify({"success": True, "message": "Chat history cleared"}), 200


@chat_bp.route("/chat/suggestions", methods=["GET"])
@require_auth
def get_suggestions():
    suggestions = [
        "Which vendor did I spend the most with?",
        "What is my average electricity bill?",
        "What's the notice period in the TechHub contract?",
        "Invoice FM-202606-U10223 looks miscategorised; propose Shopping.",
    ]
    return jsonify({"suggestions": suggestions}), 200
