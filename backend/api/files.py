"""`GET /api/files/{key}`: the original invoice image or document PDF, for its owner only."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from api.deps import current_user, rate_limit

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("/{key:path}", dependencies=[Depends(rate_limit())])
def get_file(key: str, claims: dict = Depends(current_user)):
    from utils.files import get_store

    # Another user's file, or a path that tries to leave the user's folder, looks absent (404), never forbidden.
    if not key.startswith(f"{claims['sub']}/") or ".." in key.split("/"):
        raise HTTPException(404, "File not found")
    found = get_store().get(key)
    if found is None:
        raise HTTPException(404, "File not found")
    data, content_type = found
    return Response(data, media_type=content_type, headers={"Cache-Control": "private, max-age=3600"})
