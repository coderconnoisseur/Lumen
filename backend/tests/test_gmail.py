"""SPEC-EMAIL-INGEST: Gmail sign-in (OAuth) and the Gmail API client. `requests` is faked; no network."""
import base64
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pytest
from itsdangerous import URLSafeTimedSerializer

from tests.test_invoice_upload import AUTH, client  # noqa: F401  (fixture: signed in as user-1)

URL = "/api/v1/email-config/gmail"


class Resp:
    def __init__(self, status=200, body=None):
        self.status_code, self._body = status, body or {}
        self.ok = status < 400

    def json(self):
        return self._body


def b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


@pytest.fixture
def gmail(client, monkeypatch):  # noqa: F811
    from config import Config
    from models import EmailConfig
    from models.database import db
    from app import app

    monkeypatch.setattr(Config, "GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(Config, "GOOGLE_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(Config, "GOOGLE_REDIRECT_URI", "http://localhost:3000/oauth/gmail")
    with app.app_context():
        EmailConfig.query.delete()
        db.session.commit()
    return client


def state_for(user_id="user-1"):
    from config import Config
    return URLSafeTimedSerializer(Config.SECRET_KEY).dumps(user_id)


def fake_google(monkeypatch, token_status=200):
    import inbox.gmail as g
    calls = []

    def post(url, data=None, **kw):
        calls.append((url, data))
        if token_status != 200:
            return Resp(token_status, {"error": "invalid_grant"})
        return Resp(200, {"access_token": "at", "refresh_token": "rt-secret", "expires_in": 3600})

    def get(url, params=None, headers=None, **kw):
        calls.append((url, params))
        return Resp(200, {"emailAddress": "me@gmail.com"})

    monkeypatch.setattr(g.requests, "post", post)
    monkeypatch.setattr(g.requests, "get", get)
    return calls


def test_auth_url_has_client_scope_offline_and_signed_state(gmail):
    r = gmail.get(f"{URL}/auth-url", headers=AUTH)
    assert r.status_code == 200
    q = parse_qs(urlparse(r.get_json()["auth_url"]).query)
    assert q["client_id"] == ["cid.apps.googleusercontent.com"]
    assert "https://www.googleapis.com/auth/gmail.readonly" in q["scope"][0]
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
    assert q["state"] == [r.get_json()["state"]]
    from inbox.gmail import verify_state
    assert verify_state(r.get_json()["state"]) == "user-1"


def test_missing_env_gives_503(gmail, monkeypatch):
    from config import Config
    monkeypatch.setattr(Config, "GOOGLE_CLIENT_ID", None)
    assert gmail.get(f"{URL}/auth-url", headers=AUTH).status_code == 503
    r = gmail.post(f"{URL}/callback", json={"code": "c", "state": "s"}, headers=AUTH)
    assert r.status_code == 503 and "isn't configured" in r.get_json()["error"]


def test_callback_wrong_user_or_bad_state_is_400(gmail, monkeypatch):
    fake_google(monkeypatch)
    for state in (state_for("someone-else"), "garbage"):
        assert gmail.post(f"{URL}/callback", json={"code": "c", "state": state}, headers=AUTH).status_code == 400


def test_callback_expired_state_is_400(gmail, monkeypatch):
    fake_google(monkeypatch)
    import inbox.gmail as g
    state = state_for()
    monkeypatch.setattr(g, "STATE_MAX_AGE", -1)
    assert gmail.post(f"{URL}/callback", json={"code": "c", "state": state}, headers=AUTH).status_code == 400


def test_good_callback_stores_encrypted_token_and_disconnect_deletes(gmail, monkeypatch):
    fake_google(monkeypatch)
    r = gmail.post(f"{URL}/callback", json={"code": "c", "state": state_for()}, headers=AUTH)
    assert r.status_code == 200 and r.get_json()["email_address"] == "me@gmail.com"
    from app import app
    from models import EmailConfig
    from utils.crypto import decrypt_secret
    with app.app_context():
        cfg = EmailConfig.query.filter_by(user_id="user-1").one()
        assert cfg.oauth_refresh_token != "rt-secret"
        assert decrypt_secret(cfg.oauth_refresh_token) == "rt-secret"
        assert (cfg.provider, cfg.imap_server, cfg.polling_enabled) == ("gmail", "gmail-api", True)
        assert cfg.email_address == "me@gmail.com"
    assert gmail.post(f"{URL}/disconnect", headers=AUTH).status_code == 200
    with app.app_context():
        assert EmailConfig.query.count() == 0


def test_callback_token_exchange_failure_is_400(gmail, monkeypatch):
    fake_google(monkeypatch, token_status=400)
    assert gmail.post(f"{URL}/callback", json={"code": "c", "state": state_for()}, headers=AUTH).status_code == 400


def test_client_maps_gmail_messages_to_the_imap_shape(gmail, monkeypatch):
    import inbox.gmail as g
    plain = {"id": "m1", "payload": {"mimeType": "multipart/mixed", "headers": [
        {"name": "Subject", "value": "Receipt"}, {"name": "From", "value": "bank@x.com"},
        {"name": "Date", "value": "Sat, 10 Oct 2026 10:00:00 +0000"}, {"name": "Message-ID", "value": "<abc@x>"}],
        "parts": [
            {"mimeType": "text/plain", "body": {"data": b64("Rs 499 debited")}},
            {"mimeType": "application/pdf", "filename": "inv.pdf", "body": {"attachmentId": "att1"}},
            {"mimeType": "text/calendar", "filename": "x.ics", "body": {"attachmentId": "att2"}}]}}
    html = {"id": "m2", "payload": {"mimeType": "text/html", "headers": [{"name": "Subject", "value": "Order"}],
                                    "body": {"data": b64("<p>Paid <b>Rs 5</b></p>")}}}
    calls = []

    def post(url, data=None, **kw):
        return Resp(200, {"access_token": "at"})

    def get(url, params=None, headers=None, **kw):
        calls.append((url, params))
        assert headers == {"Authorization": "Bearer at"}
        if url.endswith("/messages"):
            return Resp(200, {"messages": [{"id": "m1"}, {"id": "m2"}]})
        if url.endswith("/m1"):
            return Resp(200, plain)
        if url.endswith("/m2"):
            return Resp(200, html)
        assert url.endswith("/m1/attachments/att1")
        return Resp(200, {"data": b64("PDFBYTES")})

    monkeypatch.setattr(g.requests, "post", post)
    monkeypatch.setattr(g.requests, "get", get)
    out = g.GmailClient("rt").fetch_new_emails(datetime(2026, 10, 1))
    a, b = out
    assert a["id"] == "m1" and a["message_id"] == "<abc@x>" and a["subject"] == "Receipt"
    assert a["from"] == "bank@x.com" and a["text"] == "Rs 499 debited"
    assert a["attachments"] == [{"filename": "inv.pdf", "content": b"PDFBYTES"}]
    assert a["has_invoice_attachment"] is True
    assert b["text"] == "Paid Rs 5" and b["attachments"] == [] and b["has_invoice_attachment"] is False
    assert b["message_id"]  # falls back to a hash when there is no Message-ID header
    q = calls[0][1]["q"]
    assert "has:attachment" in q and f"after:{int(datetime(2026, 10, 1).timestamp())}" in q
    assert not any("att2" in c[0] for c in calls)


def test_token_refresh_failure_is_recorded_by_the_poller(gmail, monkeypatch):
    fake_google(monkeypatch)
    gmail.post(f"{URL}/callback", json={"code": "c", "state": state_for()}, headers=AUTH)
    fake_google(monkeypatch, token_status=400)
    from app import app
    from models import EmailConfig
    from utils import email_poller
    with app.app_context():
        cfg = EmailConfig.query.filter_by(user_id="user-1").one()
        r = email_poller.process_user_emails(cfg)
        assert r["success"] is False
        assert "Gmail" in cfg.last_error and "rt-secret" not in cfg.last_error
