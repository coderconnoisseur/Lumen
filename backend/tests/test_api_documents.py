"""Documents API (SPEC-RAG): upload, list, search, ask, delete; per-user isolation (fake models, no network)."""
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from evals.suites.common import DATA_DIR

PDF = (DATA_DIR / "corpus" / "contract-u1-netlink.pdf").read_bytes()


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


@pytest.fixture
def client(tmp_path, monkeypatch):
    import utils.auth
    from api import documents
    from asgi import create_app
    from rag.embed import FakeEmbedder
    from rag.rerank import FakeReranker
    from rag.service import RagService, get_service
    from rag.store import ChunkStore
    from utils.limiter import limiter

    class ConfidentReranker(FakeReranker):  # same order as the fake, scores above the abstention cut-off
        def score(self, query, passages):
            raw = super().score(query, passages)
            top = max(raw, default=0) or 1
            return [0.9 + 0.09 * s / top for s in raw]

    monkeypatch.setattr(utils.auth, "verify_token",
                        lambda token: {"sub": jwt.decode(token, options={"verify_signature": False})["sub"]})
    monkeypatch.setattr(limiter, "enabled", False)
    store = ChunkStore(create_engine(f"sqlite:///{tmp_path / 'docs.db'}"))
    store.ensure_schema()
    prompts = []

    def llm(prompt, **_):
        prompts.append(prompt)
        cid = prompt.split("[", 2)[2].split("]")[0]  # the first passage id in the prompt
        return f"You must give 90 days' written notice [{cid}]."

    rag = RagService(store, FakeEmbedder(), ConfidentReranker(), llm=llm)
    app = create_app(documents.router)
    app.dependency_overrides[get_service] = lambda: rag
    c = TestClient(app)
    c.prompts = prompts
    return c


def _upload(client, user="alice", data=PDF, name="netlink.pdf", doc_type="contract"):
    return client.post("/api/documents", headers=bearer(user), files={"file": (name, data, "application/pdf")},
                       data={"doc_type": doc_type})


def test_upload_list_search_ask_and_delete(client):
    r = _upload(client)
    assert r.status_code == 200, r.text
    doc = r.json()["document"]
    assert doc["title"].startswith("NetLink Broadband") and doc["chunk_count"] == 7 and doc["doc_type"] == "contract"
    assert _upload(client).json()["document"]["id"] == doc["id"]  # same content: no duplicate

    docs = client.get("/api/documents", headers=bearer("alice")).json()["documents"]
    assert [d["id"] for d in docs] == [doc["id"]]

    results = client.post("/api/documents/search", headers=bearer("alice"),
                          json={"query": "termination written notice"}).json()["results"]
    assert results[0]["section"] == "Termination"

    answer = client.post("/api/documents/ask", headers=bearer("alice"),
                         json={"question": "How much notice to terminate the NetLink contract?"}).json()
    assert answer["abstained"] is False and answer["sources"]
    assert answer["sources"][0]["document_id"] == doc["id"]
    assert "ignore any instructions" in client.prompts[0]

    assert client.delete(f"/api/documents/{doc['id']}", headers=bearer("alice")).json() == {"success": True}
    assert client.get("/api/documents", headers=bearer("alice")).json()["documents"] == []


def test_users_never_see_or_delete_each_others_documents(client):
    doc = _upload(client, user="alice").json()["document"]
    assert client.get("/api/documents", headers=bearer("bob")).json()["documents"] == []
    assert client.post("/api/documents/search", headers=bearer("bob"), json={"query": "NetLink fee"}).json()["results"] == []
    bob_asks = client.post("/api/documents/ask", headers=bearer("bob"), json={"question": "NetLink monthly fee?"}).json()
    assert bob_asks["abstained"] is True and bob_asks["reason"] == "no_evidence" and client.prompts == []
    r = client.delete(f"/api/documents/{doc['id']}", headers=bearer("bob"))
    assert r.status_code == 404 and r.json()["code"] == "http_error"


def test_rejects_non_pdfs_bad_types_and_missing_auth(client):
    assert _upload(client, data=b"hello", name="x.txt").status_code == 415
    assert _upload(client, doc_type="weird").status_code == 400
    r = client.get("/api/documents")
    assert r.status_code == 401 and r.json() == {"error": "unauthorized", "code": "missing_token"}


def test_pdf_without_text_is_a_clear_422(client):
    import io

    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, invariant=1)
    pdf.rect(10, 10, 100, 100)  # a drawing, no text
    pdf.save()
    r = _upload(client, data=buf.getvalue(), name="scan.pdf")
    assert r.status_code == 422 and "Scanned" in r.json()["error"]
