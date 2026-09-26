import uuid

VALID_PHONE = "555123456"


def register_and_login(client, suffix):
    res = client.post(
        "/register",
        json={"email": f"user{suffix}@example.com", "phone": VALID_PHONE, "password": "testpass123"},
    )
    data = res.json()
    return data["username"], data["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def create_listing(client, token):
    res = client.post(
        "/listings",
        json={
            "title": "Test Textbook",
            "description": "For messaging tests.",
            "price": 10.0,
            "category": "textbooks",
            "client_token": str(uuid.uuid4()),
        },
        headers=auth_headers(token),
    )
    return res.json()["listing_id"]


def test_send_message_and_appears_in_conversation(client, unique_suffix):
    seller, seller_token = register_and_login(client, unique_suffix + "s")
    buyer, buyer_token = register_and_login(client, unique_suffix + "b")
    listing_id = create_listing(client, seller_token)

    res = client.post(
        "/messages",
        json={"listing_id": listing_id, "recipient": seller, "body": "Is this still available?"},
        headers=auth_headers(buyer_token),
    )
    assert res.status_code == 200

    res = client.get("/conversations", headers=auth_headers(seller_token))
    assert res.status_code == 200
    conversations = res.json()["conversations"]
    assert len(conversations) == 1
    assert conversations[0]["peer"] == buyer
    assert conversations[0]["listing_id"] == listing_id
    assert conversations[0]["last_message"] == "Is this still available?"
    assert conversations[0]["unread"] == 1


def test_cannot_message_self(client, unique_suffix):
    username, token = register_and_login(client, unique_suffix)
    listing_id = create_listing(client, token)

    res = client.post(
        "/messages",
        json={"listing_id": listing_id, "recipient": username, "body": "hello me"},
        headers=auth_headers(token),
    )
    assert res.status_code == 400


def test_cannot_message_nonexistent_recipient(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    listing_id = create_listing(client, token)

    res = client.post(
        "/messages",
        json={"listing_id": listing_id, "recipient": "NoSuchUser12345", "body": "hi"},
        headers=auth_headers(token),
    )
    assert res.status_code == 404


def test_report_listing(client, unique_suffix):
    _, seller_token = register_and_login(client, unique_suffix + "s")
    listing_id = create_listing(client, seller_token)

    _, reporter_token = register_and_login(client, unique_suffix + "r")
    res = client.post(
        f"/listings/{listing_id}/report",
        json={"reason": "Scam listing"},
        headers=auth_headers(reporter_token),
    )
    assert res.status_code == 200


def test_deleting_a_conversation_hides_its_messages(client, unique_suffix):
    """Deleting has to hide the messages themselves, not just the list entry:
    the thread has its own URL, and opening it again brought everything back.
    The other person's copy is untouched, and anything they send afterwards
    is new, so it shows and brings the conversation back."""
    import time

    me, my_token = register_and_login(client, unique_suffix)
    peer, peer_token = register_and_login(client, f"{unique_suffix}p")
    listing_id = create_listing(client, my_token)

    for sender, recipient in ((peer_token, me), (my_token, peer), (peer_token, me)):
        assert client.post(
            "/messages",
            json={"listing_id": listing_id, "recipient": recipient, "body": "something"},
            headers=auth_headers(sender),
        ).status_code == 200

    thread = f"/messages/{listing_id}?peer={peer}"
    assert len(client.get(thread, headers=auth_headers(my_token)).json()["messages"]) == 3

    # the cutoff has whole-second resolution, same as the conversation list
    time.sleep(1.1)
    assert client.delete(
        f"/conversations/{listing_id}?peer={peer}", headers=auth_headers(my_token)
    ).status_code == 200

    assert client.get(thread, headers=auth_headers(my_token)).json()["messages"] == []
    assert client.get("/conversations", headers=auth_headers(my_token)).json()["conversations"] == []
    # their side is untouched
    assert len(
        client.get(f"/messages/{listing_id}?peer={me}", headers=auth_headers(peer_token)).json()["messages"]
    ) == 3

    time.sleep(1.1)
    client.post(
        "/messages",
        json={"listing_id": listing_id, "recipient": me, "body": "written after the delete"},
        headers=auth_headers(peer_token),
    )
    reopened = client.get(thread, headers=auth_headers(my_token)).json()["messages"]
    assert [m["body"] for m in reopened] == ["written after the delete"]
    assert len(client.get("/conversations", headers=auth_headers(my_token)).json()["conversations"]) == 1
