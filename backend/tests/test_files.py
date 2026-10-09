"""Original files (invoices, documents) are kept and served only to their owner (SPEC-EXTRACT review screen)."""
import io

import jwt
import pytest
from fastapi.testclient import TestClient

ALICE, BOB = "a11ce000-0000-4000-8000-000000000001", "b0b00000-0000-4000-8000-000000000002"
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 20


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


@pytest.fixture
def store(tmp_path, monkeypatch):
    import utils.files as files

    local = files.LocalFiles(tmp_path / "files")
    monkeypatch.setattr(files, "get_store", lambda: local)
    return local


def test_local_files_round_trip_and_keys_are_content_addressed(store):
    from utils.files import invoice_key

    key = invoice_key(ALICE, PNG, "png")
    assert key.startswith(f"{ALICE}/invoices/") and key.endswith(".png") and key == invoice_key(ALICE, PNG, "png")
    store.put(key, PNG)
    assert store.get(key) == (PNG, "image/png")
    store.delete(key)
    assert store.get(key) is None


def test_files_are_served_only_to_their_owner(store, monkeypatch):
    import utils.auth
    from api import files
    from asgi import create_app
    from utils.files import invoice_key
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda token: jwt.decode(token, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    key = invoice_key(ALICE, PNG, "png")
    store.put(key, PNG)
    client = TestClient(create_app(files.router))
    r = client.get(f"/api/files/{key}", headers=bearer(ALICE))
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
    assert client.get(f"/api/files/{key}", headers=bearer(BOB)).status_code == 404  # not hers: looks absent
    assert client.get(f"/api/files/{ALICE}/../{BOB}/x.png", headers=bearer(ALICE)).status_code == 404
    assert client.get(f"/api/files/{ALICE}/invoices/missing.png", headers=bearer(ALICE)).status_code == 404


def test_supabase_store_talks_to_the_storage_api(monkeypatch):
    """No network: the requests are captured. A missing bucket is created (private) once, then the upload retried."""
    from utils import files

    calls = []

    class R:
        def __init__(self, status, body=b"", ctype="image/png"):
            self.status_code, self.content, self.headers = status, body, {"content-type": ctype}

        def json(self):
            return {"message": "Bucket not found"} if self.status_code == 404 else {}

    responses = iter([R(404), R(200), R(200), R(200, PNG), R(200)])

    def fake(method, url, **kwargs):
        calls.append((method, url.split("/storage/v1/")[1], kwargs.get("json")))
        return next(responses)

    monkeypatch.setattr(files.requests, "request", fake)
    s = files.SupabaseFiles("https://x.supabase.co", "service-key", bucket="lumen-files")
    s.put(f"{ALICE}/invoices/a.png", PNG)
    assert s.get(f"{ALICE}/invoices/a.png") == (PNG, "image/png")
    s.delete(f"{ALICE}/invoices/a.png")
    assert [c[:2] for c in calls] == [
        ("POST", f"object/lumen-files/{ALICE}/invoices/a.png"), ("POST", "bucket"),
        ("POST", f"object/lumen-files/{ALICE}/invoices/a.png"), ("GET", f"object/lumen-files/{ALICE}/invoices/a.png"),
        ("DELETE", "object/lumen-files")]
    assert calls[1][2] == {"id": "lumen-files", "name": "lumen-files", "public": False}
