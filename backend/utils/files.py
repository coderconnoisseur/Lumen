"""Original files (uploaded invoices and documents), so a reviewer can see the invoice and a reference can open the
real PDF. Local folder in development and tests; a private Supabase Storage bucket in production (used when
SUPABASE_SERVICE_ROLE_KEY is set). Files are only ever served through `api/files.py`, which checks the owner.

Keys: `{user_id}/invoices/{sha256}.{ext}` (re-uploads reuse the file) and `{user_id}/docs/{document id}.pdf`.
"""
from __future__ import annotations

import hashlib
import logging
import mimetypes
from functools import lru_cache
from pathlib import Path

import requests

logger = logging.getLogger(__name__)


def invoice_key(user_id: str, data: bytes, ext: str) -> str:
    return f"{user_id}/invoices/{hashlib.sha256(data).hexdigest()}.{ext.lower().lstrip('.')}"


def document_key(user_id: str, doc_id: str) -> str:
    return f"{user_id}/docs/{doc_id}.pdf"


def _type(key: str) -> str:
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


class LocalFiles:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("bad file key")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> tuple[bytes, str] | None:
        path = self._path(key)
        return (path.read_bytes(), _type(key)) if path.is_file() else None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class SupabaseFiles:
    """Supabase Storage REST API with the service-role key (server side only; never sent to browsers)."""

    def __init__(self, url: str, service_key: str, bucket: str = "lumen-files"):
        self.base, self.bucket = f"{url.rstrip('/')}/storage/v1", bucket
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def _call(self, method: str, path: str, **kwargs):
        return requests.request(method, f"{self.base}/{path}", headers={**self.headers, **kwargs.pop("headers", {})},
                                timeout=30, **kwargs)

    def put(self, key: str, data: bytes) -> None:
        upload = lambda: self._call("POST", f"object/{self.bucket}/{key}", data=data,  # noqa: E731
                                    headers={"Content-Type": _type(key), "x-upsert": "true"})
        r = upload()
        if r.status_code in (400, 404) and "bucket" in str(r.json().get("message", "")).lower():
            self._call("POST", "bucket", json={"id": self.bucket, "name": self.bucket, "public": False})
            r = upload()
        if r.status_code >= 300:
            raise RuntimeError(f"storage upload failed: HTTP {r.status_code}")

    def get(self, key: str) -> tuple[bytes, str] | None:
        r = self._call("GET", f"object/{self.bucket}/{key}")
        if r.status_code in (400, 404):
            return None
        if r.status_code >= 300:
            raise RuntimeError(f"storage download failed: HTTP {r.status_code}")
        return r.content, r.headers.get("content-type") or _type(key)

    def delete(self, key: str) -> None:
        self._call("DELETE", f"object/{self.bucket}", json={"prefixes": [key]})


@lru_cache(maxsize=1)
def get_store():
    from config import Config

    if Config.SUPABASE_URL and Config.SUPABASE_SERVICE_ROLE_KEY:
        return SupabaseFiles(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_ROLE_KEY)
    return LocalFiles(Path(__file__).resolve().parents[1] / "instance" / "files")


def keep(key: str, data: bytes) -> str | None:
    """Store a file; a storage outage must not lose the upload, so failures are logged and return None."""
    try:
        get_store().put(key, data)
        return key
    except Exception as e:
        logger.warning("Couldn't keep the original file %s: %s", key.split("/", 1)[-1], e)
        return None
