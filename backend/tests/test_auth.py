from auth import create_access_token, decode_token
from fastapi import HTTPException
from jose import jwt
from datetime import datetime, timedelta
import pytest

from config import SECRET_KEY, ALGORITHM

VALID_PHONE = "555123456"


def register(client, suffix, password="testpass123"):
    return client.post(
        "/register",
        json={"email": f"user{suffix}@example.com", "phone": VALID_PHONE, "password": password},
    )


def test_register_and_login_round_trip(client, unique_suffix):
    res = register(client, unique_suffix)
    assert res.status_code == 200
    data = res.json()
    assert data["verification_required"] is False
    assert "access_token" in data
    username = data["username"]

    res = client.post("/login", json={"username": username, "password": "testpass123"})
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_register_duplicate_email_rejected(client, unique_suffix):
    res1 = register(client, unique_suffix)
    assert res1.status_code == 200

    res2 = register(client, unique_suffix)
    assert res2.status_code == 400


def test_login_wrong_password_rejected(client, unique_suffix):
    res = register(client, unique_suffix)
    username = res.json()["username"]

    res = client.post("/login", json={"username": username, "password": "wrongpassword"})
    assert res.status_code == 401


def test_login_rate_limit_lockout(client, unique_suffix):
    res = register(client, unique_suffix)
    username = res.json()["username"]

    # LOGIN_MAX_ATTEMPTS is 5 - the 6th attempt (whether right or wrong)
    # should be locked out, not just repeatedly rejected.
    for _ in range(5):
        res = client.post("/login", json={"username": username, "password": "wrongpassword"})
        assert res.status_code == 401

    res = client.post("/login", json={"username": username, "password": "wrongpassword"})
    assert res.status_code == 429

    # Even the CORRECT password is blocked during lockout - proves this is
    # a real lockout, not just five rejected wrong guesses in a row.
    res = client.post("/login", json={"username": username, "password": "testpass123"})
    assert res.status_code == 429


def test_login_succeeds_again_once_lockout_key_expires(client, unique_suffix):
    """Same lockout as above, but simulates the 15-minute window passing by
    deleting the Redis lockout key directly, rather than a real-time sleep -
    confirms unlocking actually restores normal login, not just that the
    lockout fires."""
    from redis_client import redis_client

    res = register(client, unique_suffix)
    username = res.json()["username"]

    for _ in range(6):
        client.post("/login", json={"username": username, "password": "wrongpassword"})

    res = client.post("/login", json={"username": username, "password": "testpass123"})
    assert res.status_code == 429

    # TestClient's requests all come from the same fake client IP - find and
    # clear every lockout key rather than reconstructing the exact key
    # format, so this test doesn't silently rot if that format ever changes.
    for key in redis_client.scan_iter(f"lockout:login:*{username.lower()}*"):
        redis_client.delete(key)

    res = client.post("/login", json={"username": username, "password": "testpass123"})
    assert res.status_code == 200


def test_decode_token_rejects_expired_token():
    expired = jwt.encode(
        {"sub": "someone", "iat": datetime.utcnow() - timedelta(days=10), "exp": datetime.utcnow() - timedelta(days=3)},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(expired)
    assert exc_info.value.status_code == 401


def test_decode_token_accepts_fresh_token():
    token = create_access_token({"sub": "someone"})
    payload = decode_token(token)
    assert payload["sub"] == "someone"


def test_same_derived_name_gets_a_distinct_username(client, unique_suffix):
    """Usernames come from the email's local part, so two students called the
    same thing derive the same name. The second must be given a distinct one
    rather than colliding on the unique index."""
    first = client.post(
        "/register",
        json={"email": f"giorgi.beridze.{unique_suffix}@example.com", "phone": VALID_PHONE, "password": "testpass123"},
    )
    second = client.post(
        "/register",
        json={"email": f"giorgi.beridze.{unique_suffix}.2@example.com", "phone": VALID_PHONE, "password": "testpass123"},
    )
    assert first.status_code == 200
    assert second.status_code == 200, second.text
    assert first.json()["username"] != second.json()["username"]
