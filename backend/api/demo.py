"""One-click demo (SPEC-DEPLOY): a visitor signs in anonymously (Supabase) and gets their own copy of the demo data,
so no one can break the demo for the next person."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from api.deps import current_user, rate_limit
from rag.service import RagService, get_service

router = APIRouter(prefix="/api/demo", tags=["demo"])

# ponytail: one lock per process (one uvicorn worker), so a double-click can't seed twice at once.
_seeding = threading.Lock()


@router.post("/start", dependencies=[Depends(rate_limit("5 per minute"))])
def start(claims: dict = Depends(current_user), rag: RagService = Depends(get_service)):
    if not claims.get("is_anonymous"):
        raise HTTPException(403, "Demo data is only for demo accounts.")
    from scripts.seed_demo_data import seed

    user_id, engine = claims["sub"], rag.store.engine
    with _seeding:
        with engine.connect() as conn:
            has_data = conn.execute(text("SELECT 1 FROM transactions WHERE user_id = :u LIMIT 1"),
                                    {"u": user_id}).first() is not None
        if not has_data:
            seed(engine, rag.store, rag.embedder, user_id)
    return {"success": True, "seeded": not has_data}
