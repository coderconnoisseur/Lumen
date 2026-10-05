"""The agent loop (SPEC-AGENT, AGT-02): a LangGraph state machine around our own LLM client.

    agent ──(tool calls?)──▶ tools ──▶ agent ──(answer)──▶ END
                └── at MAX_TOOL_CALLS the next agent turn gets no tools and must answer.

Why LangGraph: explicit, testable states and a hard bound on steps. The LLM call inside the node is
`llm.client.complete`, so model failover, the request deadline and record/replay cassettes all still apply, and
evals replay agent runs offline like any other suite.

Context management: the conversation is the system prompt, the question, and each tool exchange. Tool results
are truncated to MAX_TOOL_RESULT_CHARS before they go back to the model, and the tool-call cap bounds the number
of exchanges, so a run's context can't grow without limit.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Callable, TypedDict

from agent.prompts import FORCE_ANSWER, system_prompt
from agent.tools import ToolContext, run_tool, tool_schemas

MAX_TOOL_CALLS = 6
MAX_TOOL_RESULT_CHARS = 3000
_CITATION = re.compile(r"\[([^\[\]\s]+#s\d{2}(?:-\d+)?)\]")


class AgentState(TypedDict):
    messages: list[dict]
    steps: list[dict]
    tool_calls: int
    answer: str | None
    stopped: str | None
    llm_calls: int


def _summary(name: str, result: dict) -> str:
    if "error" in result:
        return f"error: {str(result['error'])[:120]}"
    if name == "run_sql":
        return f"{result.get('row_count', 0)} row(s)"
    if name == "search_documents":
        return f"{len(result.get('passages', []))} passage(s)"
    if name == "lookup_vendors":
        return ", ".join(v["vendor"] for v in result.get("vendors", [])[:3]) or "no match"
    if name == "propose_action":
        return f"proposal {result.get('status')}"
    return "ok"


def build_graph(ctx: ToolContext, *, complete: Callable[..., Any], max_tool_calls: int = MAX_TOOL_CALLS):
    from langgraph.graph import END, StateGraph  # imported on first use: ~2 s

    schemas = tool_schemas()

    def agent(state: AgentState) -> dict:
        messages = list(state["messages"])
        out_of_calls = state["tool_calls"] >= max_tool_calls
        if out_of_calls:
            messages.append({"role": "user", "content": FORCE_ANSWER})
        result = complete(messages, tools=None if out_of_calls else schemas, temperature=0, max_tokens=900,
                          timeout=40, retries=1)
        calls = [] if out_of_calls else (result.tool_calls or [])
        for call in calls:
            call.setdefault("id", f"call_{uuid.uuid4().hex[:12]}")
            call.setdefault("type", "function")
        reply = {"role": "assistant", "content": result.text or None}
        if calls:
            reply["tool_calls"] = calls
        update = {"messages": messages + [reply], "llm_calls": state["llm_calls"] + 1}
        if not calls:
            update["answer"] = result.text
            update["stopped"] = "tool_limit" if out_of_calls else "answered"
        return update

    def tools(state: AgentState) -> dict:
        messages, steps, used = list(state["messages"]), list(state["steps"]), state["tool_calls"]
        for call in messages[-1].get("tool_calls", []):
            fn = call.get("function", {})
            name, raw = fn.get("name", ""), fn.get("arguments") or "{}"
            if used >= max_tool_calls:
                result = {"error": "tool call limit reached"}
            else:
                start = time.perf_counter()
                result = run_tool(ctx, name, raw)
                used += 1
                try:
                    args = json.loads(raw) if isinstance(raw, str) else raw
                except json.JSONDecodeError:
                    args = {"raw": str(raw)[:200]}
                steps.append({"tool": name, "args": args, "summary": _summary(name, result),
                              "latency_ms": round((time.perf_counter() - start) * 1000), "result": result})
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": json.dumps(result, default=str)[:MAX_TOOL_RESULT_CHARS]})
        return {"messages": messages, "steps": steps, "tool_calls": used}

    def route(state: AgentState) -> str:
        return END if state.get("answer") is not None else "tools"

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent)
    graph.add_node("tools", tools)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")
    return graph.compile()


def run_agent(question: str, ctx: ToolContext, *, complete: Callable[..., Any] | None = None,
              max_tool_calls: int = MAX_TOOL_CALLS) -> dict:
    """Answer one question. Returns the answer, citations, the tool steps (for "show your work"), the SQL that ran,
    any proposals filed, and why the loop stopped."""
    if complete is None:
        from llm.client import complete
    graph = build_graph(ctx, complete=complete, max_tool_calls=max_tool_calls)
    state: AgentState = {
        "messages": [{"role": "system", "content": system_prompt(ctx.today)},
                     {"role": "user", "content": question}],
        "steps": [], "tool_calls": 0, "answer": None, "stopped": None, "llm_calls": 0,
    }
    final = graph.invoke(state, {"recursion_limit": 2 * max_tool_calls + 6})
    retrieved = {p["chunk_id"]: p for s in final["steps"] if s["tool"] == "search_documents"
                 for p in s["result"].get("passages", [])}
    answer = final["answer"] or ""
    citations = list(dict.fromkeys(c for c in _CITATION.findall(answer) if c in retrieved))
    return {
        "answer": answer,
        "citations": citations,
        "steps": [{k: v for k, v in s.items() if k != "result"} for s in final["steps"]],
        "sql": [s["args"].get("sql") for s in final["steps"] if s["tool"] == "run_sql" and isinstance(s["args"], dict)],
        "proposals": [s["result"]["proposal_id"] for s in final["steps"]
                      if s["tool"] == "propose_action" and "proposal_id" in s["result"]],
        "sources": [{"chunk_id": c, "title": retrieved[c]["title"], "section": retrieved[c]["section"],
                     "text": retrieved[c]["text"]} for c in citations],
        "rows": next((s["result"]["rows"] for s in reversed(final["steps"])
                      if s["tool"] == "run_sql" and "rows" in s["result"]), None),  # last successful query's rows
        "stopped": final["stopped"],
        "llm_calls": final["llm_calls"],
        "tools_used": [s["tool"] for s in final["steps"]],
    }
