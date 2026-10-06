"""Ask Lumen's chat path: the SQL agent fetches the user's data, then the model writes the answer.

Document questions go to the documents API (`/api/documents/ask`, SPEC-RAG) until the agent (SPEC-AGENT)
chooses between SQL and document search itself. The old Chroma path and its classifier were removed in RAG-09;
production had them switched off.
"""
import json
import logging
from typing import Any, Dict

from config import Config
from utils.llm import chat_completion

from .sql_agent import SQLAgent

logger = logging.getLogger(__name__)


class HybridQueryEngine:
    """Answers spend questions from the user's transactions."""

    def __init__(self, db_path: str | None = None):
        # db_path=None -> the app database (Postgres on Render, SQLite locally).
        self.sql_agent = SQLAgent(db_path)

    def query(self, user_query: str, user_id: str) -> Dict[str, Any]:
        """Fetch matching data with SQL and write the answer.

        Raises utils.llm.LLMError when the LLM provider can't be used (bad key,
        no credits, rate limit, outage, retired model); the route turns that
        into a user-facing error rather than a fake answer.
        """
        results = self.sql_agent.query(user_query, user_id)
        response = self._synthesize_response(user_query=user_query, results=results, context_type="sql")
        return {
            "query": user_query,
            "query_type": "ANALYTICAL",  # kept for API compatibility
            "raw_results": results,
            "response": response,
        }

    def _synthesize_response(self,
                            user_query: str,
                            results: Dict,
                            context_type: str) -> str:
        """Generate natural language response from results"""

        synthesis_prompt = f"""
        You are a financial assistant explaining query results to a user.
        Amounts are in {Config.DEFAULT_CURRENCY} unless the data says otherwise.

        User asked: "{user_query}"

        Query type: {context_type}

        Results:
        {json.dumps(results, default=str, ensure_ascii=False, separators=(",", ":"))}

        Generate a clear, concise answer:
        1. Directly answer the question
        2. Include key numbers/facts
        3. Add brief insight if relevant
        4. Keep it conversational
        5. If the results are empty, say you found no matching transactions and
           suggest uploading invoices; do not invent data

        Answer:
        """

        # SQL (30s, no retry) + this (30s, one retry) is about 90s at worst, inside the 100s request deadline.
        return chat_completion(synthesis_prompt, temperature=0.7, max_tokens=500, timeout=30)
