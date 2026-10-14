"""SPEC-ONBOARD: Ask Lumen's suggested questions follow the user's goals."""


def test_suggestions_follow_goals(authed_client, monkeypatch):
    import routes.chat as chat

    monkeypatch.setattr(chat, "_profile_for", lambda uid: {"goals": ["cut_subscriptions"], "use_case": "personal"})
    s = authed_client.get("/chat/suggestions", headers={"Authorization": "Bearer x"}).get_json()["suggestions"]
    assert s[0] == "Which subscriptions haven't I used lately?" and len(s) == 4 and len(set(s)) == 4


def test_suggestions_without_a_profile_are_the_defaults(authed_client, monkeypatch):
    import routes.chat as chat

    monkeypatch.setattr(chat, "_profile_for", lambda uid: None)
    s = authed_client.get("/chat/suggestions", headers={"Authorization": "Bearer x"}).get_json()["suggestions"]
    assert s == chat.DEFAULT_SUGGESTIONS
