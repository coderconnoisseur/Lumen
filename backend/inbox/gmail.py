"""Gmail sign-in (OAuth) and a Gmail API client that returns the same email dicts as utils.email_service.EmailService."""
from __future__ import annotations

import base64
import hashlib
import logging
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests
from itsdangerous import BadData, URLSafeTimedSerializer

from config import Config
from inbox.filter import html_to_text, is_candidate

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/gmail.readonly openid email"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
STATE_MAX_AGE = 600  # seconds
_TIMEOUT = 20
_EXTENSIONS = ('.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp', '.gif')
_MONEY_WORDS = ("debited spent charged paid payment receipt invoice order renewal renewed "
                "subscription upi txn transaction").split()


class GmailError(Exception):
    """A Gmail sign-in or API failure, worded for the user (never carries tokens or mail content)."""


def configured() -> bool:
    return bool(Config.GOOGLE_CLIENT_ID and Config.GOOGLE_CLIENT_SECRET and Config.GOOGLE_REDIRECT_URI)


def _signer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(Config.SECRET_KEY, salt="gmail-oauth")


def auth_url(user_id: str) -> tuple[str, str]:
    state = _signer().dumps(user_id)
    query = urlencode({
        "client_id": Config.GOOGLE_CLIENT_ID, "redirect_uri": Config.GOOGLE_REDIRECT_URI,
        "response_type": "code", "scope": SCOPE, "access_type": "offline", "prompt": "consent", "state": state,
    })
    return f"{AUTH_URL}?{query}", state


def verify_state(state: str) -> str | None:
    """The user id the state was signed for, or None when it is forged or older than 10 minutes."""
    try:
        return _signer().loads(state, max_age=STATE_MAX_AGE)
    except BadData:
        return None


def _token_request(**fields) -> dict:
    resp = requests.post(TOKEN_URL, data={
        "client_id": Config.GOOGLE_CLIENT_ID, "client_secret": Config.GOOGLE_CLIENT_SECRET, **fields}, timeout=_TIMEOUT)
    if not resp.ok:
        raise GmailError(f"Gmail rejected the sign-in (HTTP {resp.status_code}); reconnect Gmail")
    return resp.json()


def exchange_code(code: str) -> dict:
    """Trade the OAuth code for a refresh token and the mailbox address."""
    tokens = _token_request(code=code, grant_type="authorization_code", redirect_uri=Config.GOOGLE_REDIRECT_URI)
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise GmailError("Google did not return offline access; reconnect Gmail and approve all permissions")
    resp = requests.get(f"{API}/profile", headers={"Authorization": f"Bearer {tokens['access_token']}"},
                        timeout=_TIMEOUT)
    if not resp.ok or not resp.json().get("emailAddress"):
        raise GmailError("Could not read the Gmail address; reconnect Gmail")
    return {"refresh_token": refresh, "email": resp.json()["emailAddress"]}


def revoke(token: str) -> None:
    """Best effort: tell Google to forget the grant. Never raises."""
    try:
        requests.post(REVOKE_URL, data={"token": token}, timeout=_TIMEOUT)
    except requests.RequestException as e:
        logger.warning(f"Gmail token revoke failed ({type(e).__name__})")


def _decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class GmailClient:
    """Same surface the poller uses on EmailService; there is nothing to connect to."""

    def __init__(self, refresh_token: str):
        self.refresh_token = refresh_token
        self._access = None

    def connect(self):
        self._headers()  # refresh an access token now, so a revoked sign-in fails loudly

    def disconnect(self):
        pass

    def mark_as_read(self, _id):
        pass  # gmail.readonly cannot change labels

    def _headers(self) -> dict:
        if self._access is None:
            self._access = _token_request(refresh_token=self.refresh_token, grant_type="refresh_token")["access_token"]
        return {"Authorization": f"Bearer {self._access}"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        resp = requests.get(f"{API}/{path}", params=params, headers=self._headers(), timeout=_TIMEOUT)
        if not resp.ok:
            raise GmailError(f"Gmail API error (HTTP {resp.status_code})")
        return resp.json()

    def fetch_new_emails(self, since: datetime):
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)  # the poller passes naive UTC
        q = f"({' OR '.join(['has:attachment', *_MONEY_WORDS])}) after:{int(since.timestamp())}"
        self._headers()  # a bad token fails here, loudly, before any listing
        ids, page = [], None
        while True:
            listing = self._get("messages", {"q": q, "maxResults": 100, **({"pageToken": page} if page else {})})
            ids += [m["id"] for m in listing.get("messages", [])]
            page = listing.get("nextPageToken")
            if not page:
                break
        for mid in ids:  # one message at a time, so a big backfill never sits in memory
            try:
                mail = self._email(self._get(f"messages/{mid}", {"format": "full"}))
            except Exception as e:
                logger.error(f"Error processing Gmail message {mid}: {type(e).__name__}")
                continue
            if mail['has_invoice_attachment'] or is_candidate(mail['subject'], mail['text'], False):
                yield mail

    def _email(self, msg: dict) -> dict:
        payload = msg["payload"]
        h = {x["name"].lower(): x["value"] for x in payload.get("headers", [])}
        subject, sender, date = h.get("subject", ""), h.get("from", ""), h.get("date", "")
        message_id = h.get("message-id", "").strip() or hashlib.sha1(f"{sender}{date}{subject}".encode()).hexdigest()

        attachments, plain, html, stack = [], None, None, [payload]
        while stack:
            part = stack.pop(0)
            stack = part.get("parts", []) + stack
            body, name, kind = part.get("body", {}), part.get("filename"), part.get("mimeType", "")
            if name:
                disp = next((x["value"] for x in part.get("headers", []) if x["name"].lower() == "content-disposition"), "")
                # inline images (logos, signatures) are not invoices
                if disp.lower().startswith("attachment") and name.lower().endswith(_EXTENSIONS) and body.get("attachmentId"):
                    data = self._get(f"messages/{msg['id']}/attachments/{body['attachmentId']}")["data"]
                    attachments.append({'filename': name, 'content': _decode(data)})
            elif kind in ("text/plain", "text/html") and body.get("data"):
                text = _decode(body["data"]).decode("utf-8", errors="replace")
                if kind == "text/plain" and plain is None:
                    plain = text
                elif kind == "text/html" and html is None:
                    html = text
        return {
            'id': msg["id"], 'message_id': message_id, 'subject': subject, 'from': sender, 'date': date,
            'text': plain if plain is not None else html_to_text(html or ''),
            'attachments': attachments, 'has_invoice_attachment': bool(attachments),
        }
