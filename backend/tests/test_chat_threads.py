"""UI revamp Phase 4: Ask Lumen chat threads (routes/chat.py). The agent call is stubbed; no LLM."""
import jwt
import pytest

A = "7a1c0000-0000-4000-8000-0000000000aa"
B = "7a1c0000-0000-4000-8000-0000000000bb"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


@pytest.fixture
def chat(monkeypatch):
    import api.agent
    import routes.chat as chat_routes
    import utils.auth
    from app import app
    from models import ChatMessage, ChatThread
    from models.database import db

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(api.agent, "count_platform_question", lambda *a: True)
    asked = []

    def fake_ask(question, user_id, attachment=None, history=None):
        asked.append({"question": question, "user_id": user_id, "history": history})
        return {"response": f"Answer to: {question}", "follow_up": None, "sources": [], "steps": [], "proposals": []}

    monkeypatch.setattr(chat_routes, "_ask", fake_ask)
    with app.app_context():
        ChatMessage.query.delete()
        ChatThread.query.delete()
        db.session.commit()
    client = app.test_client()

    def post(user, query, thread_id=None):
        body = {"query": query, **({"thread_id": thread_id} if thread_id else {})}
        return client.post("/chat", json=body, headers=bearer(user))

    return client, post, asked, app


def test_post_without_thread_creates_one_titled_from_question(chat):
    client, post, _, _ = chat
    q = "How much did I spend on food delivery and groceries across the last three months altogether?"
    data = post(A, q).get_json()["data"]
    [thread] = client.get("/chat/threads", headers=bearer(A)).get_json()["threads"]
    assert data["thread_id"] == thread["id"]
    assert len(thread["title"]) <= 60 and q.startswith(thread["title"].rstrip("…").rstrip())
    assert not thread["title"].rstrip("…").endswith(" ")


def test_post_with_thread_appends(chat):
    client, post, _, _ = chat
    tid = post(A, "First").get_json()["data"]["thread_id"]
    assert post(A, "Second", tid).get_json()["data"]["thread_id"] == tid
    body = client.get(f"/chat/threads/{tid}", headers=bearer(A)).get_json()
    assert [m["content"] for m in body["messages"]] == ["First", "Answer to: First", "Second", "Answer to: Second"]


def test_list_threads_newest_first_with_counts(chat):
    client, post, _, _ = chat
    old = post(A, "Old question").get_json()["data"]["thread_id"]
    new = post(A, "New question").get_json()["data"]["thread_id"]
    post(A, "More on old", old)
    threads = client.get("/chat/threads", headers=bearer(A)).get_json()["threads"]
    assert [t["id"] for t in threads] == [old, new]
    assert [t["message_count"] for t in threads] == [4, 2]


def test_get_thread_messages_oldest_first(chat):
    client, post, _, _ = chat
    tid = post(A, "One").get_json()["data"]["thread_id"]
    post(A, "Two", tid)
    msgs = client.get(f"/chat/threads/{tid}", headers=bearer(A)).get_json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]


def test_delete_thread_removes_messages(chat):
    client, post, _, app = chat
    from models import ChatMessage

    tid = post(A, "Bye").get_json()["data"]["thread_id"]
    assert client.delete(f"/chat/threads/{tid}", headers=bearer(A)).status_code == 200
    assert client.get("/chat/threads", headers=bearer(A)).get_json()["threads"] == []
    with app.app_context():
        assert ChatMessage.query.filter_by(user_id=A).count() == 0


def test_threads_are_per_user(chat):
    client, post, asked, app = chat
    from models import ChatMessage

    tid = post(A, "Mine").get_json()["data"]["thread_id"]
    assert client.get(f"/chat/threads/{tid}", headers=bearer(B)).status_code == 404
    assert client.delete(f"/chat/threads/{tid}", headers=bearer(B)).status_code == 404
    assert post(B, "Sneaky", tid).status_code == 404
    assert len(asked) == 1  # B's question never reached the agent
    with app.app_context():
        assert ChatMessage.query.filter_by(thread_id=tid).count() == 2
    assert client.get("/chat/threads", headers=bearer(B)).get_json()["threads"] == []


def test_legacy_messages_fold_once(chat):
    client, _, _, app = chat
    from models import ChatMessage
    from models.database import db

    with app.app_context():
        for i, role in enumerate(["user", "assistant", "user", "assistant"]):
            db.session.add(ChatMessage(user_id=A, role=role, content=f"old {i}"))
        db.session.commit()
    first = client.get("/chat/threads", headers=bearer(A)).get_json()["threads"]
    second = client.get("/chat/threads", headers=bearer(A)).get_json()["threads"]
    assert [(t["title"], t["message_count"]) for t in first] == [("Earlier chats", 4)]
    assert [t["id"] for t in second] == [first[0]["id"]]


def test_history_endpoints_are_gone(chat):
    client, *_ = chat
    assert client.get("/chat/history", headers=bearer(A)).status_code in (404, 405)
    assert client.delete("/chat/history", headers=bearer(A)).status_code in (404, 405)


def test_agent_history_is_this_thread_only(chat):
    _, post, asked, _ = chat
    a = post(A, "Thread A first").get_json()["data"]["thread_id"]
    post(A, "Thread A second", a)
    b = post(A, "Thread B first").get_json()["data"]["thread_id"]
    post(A, "Thread B second", b)
    assert asked[0]["history"] == [] and asked[2]["history"] == []  # new threads start empty
    assert asked[3]["history"] == [{"role": "user", "content": "Thread B first"},
                                   {"role": "assistant", "content": "Answer to: Thread B first"}]


def test_legacy_fold_that_loses_a_race_leaves_no_empty_thread(chat, monkeypatch):
    """Two concurrent first lists: the loser saw legacy rows but the winner already moved them (its UPDATE hits 0
    rows). Simulated by forcing the 'has legacy rows' check true with nothing left to fold."""
    import routes.chat as chat_routes

    client, *_ = chat
    monkeypatch.setattr(chat_routes, "_has_legacy", lambda user_id: True)
    assert client.get("/chat/threads", headers=bearer(A)).get_json()["threads"] == []


@pytest.mark.parametrize("bad", [{"x": 1}, ["t"], 123])
def test_non_string_thread_id_is_404_not_500(chat, bad):
    client, *_ = chat
    r = client.post("/chat", json={"query": "hi", "thread_id": bad}, headers=bearer(A))
    assert r.status_code == 404
