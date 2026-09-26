import io
import uuid

from PIL import Image

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


def make_listing_payload(client_token=None, **overrides):
    payload = {
        "title": "Test Textbook",
        "description": "A textbook for testing.",
        "price": 25.0,
        "category": "textbooks",
    }
    if client_token is not None:
        payload["client_token"] = client_token
    payload.update(overrides)
    return payload


def publish(client, token, **overrides):
    """Create a listing and make it public.

    The first listing from an account waits for review, so tests that need a
    listing a stranger can see approve it the way an admin would rather than
    standing up an admin account each time.
    """
    res = client.post(
        "/listings",
        json=make_listing_payload(client_token=str(uuid.uuid4()), **overrides),
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    listing_id = res.json()["listing_id"]
    if res.json().get("pending_review"):
        from database import Listing, SessionLocal

        db = SessionLocal()
        db.query(Listing).filter(Listing.id == listing_id).update({"status": "available"})
        db.commit()
        db.close()
    return listing_id


def make_test_image_bytes(fmt="JPEG", size=(100, 100)):
    buf = io.BytesIO()
    Image.new("RGB", size, color=(255, 0, 0)).save(buf, fmt)
    buf.seek(0)
    return buf.read()


def test_create_listing_client_token_idempotent(client, unique_suffix):
    """Repeat-submitting the same create request (spam-clicked button,
    retried flaky connection) must return the same listing, not create a
    duplicate."""
    _, token = register_and_login(client, unique_suffix)
    token_val = str(uuid.uuid4())
    payload = make_listing_payload(client_token=token_val)

    res1 = client.post("/listings", json=payload, headers=auth_headers(token))
    assert res1.status_code == 200
    listing_id_1 = res1.json()["listing_id"]

    res2 = client.post("/listings", json=payload, headers=auth_headers(token))
    assert res2.status_code == 200
    listing_id_2 = res2.json()["listing_id"]

    assert listing_id_1 == listing_id_2

    res = client.get("/my-listings", headers=auth_headers(token))
    assert len(res.json()["listings"]) == 1


def test_create_listing_rejects_unknown_category(client, unique_suffix):
    """The category column is a plain string - this validator is the only
    thing keeping arbitrary values out of the database."""
    _, token = register_and_login(client, unique_suffix)
    payload = make_listing_payload(client_token=str(uuid.uuid4()), category="not-a-real-category")
    res = client.post("/listings", json=payload, headers=auth_headers(token))
    assert res.status_code == 422


def test_create_listing_accepts_new_categories(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    for category in ["dorm", "bikes", "sports", "tickets"]:
        res = client.post(
            "/listings",
            json=make_listing_payload(client_token=str(uuid.uuid4()), category=category),
            headers=auth_headers(token),
        )
        assert res.status_code == 200, category


def test_create_listing_different_tokens_creates_separate_listings(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)

    res1 = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    res2 = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))

    assert res1.json()["listing_id"] != res2.json()["listing_id"]

    res = client.get("/my-listings", headers=auth_headers(token))
    assert len(res.json()["listings"]) == 2


def test_search_filters_by_category(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    publish(client, token, title="A Book", category="textbooks")
    publish(client, token, title="A Laptop", category="electronics")

    res = client.get("/search", params={"category": "electronics", "q": "", "page": 1, "sort": "newest"})
    assert res.status_code == 200
    results = res.json()["results"]
    assert all(r["category"] == "electronics" for r in results)
    assert any(r["title"] == "A Laptop" for r in results)
    assert not any(r["title"] == "A Book" for r in results)


def test_search_filters_by_price_range(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    publish(client, token, title="Cheap Item", price=5)
    publish(client, token, title="Pricey Item", price=500)

    res = client.get("/search", params={"q": "", "page": 1, "sort": "newest", "min_price": 100, "max_price": 1000})
    assert res.status_code == 200
    titles = [r["title"] for r in res.json()["results"]]
    assert "Pricey Item" in titles
    assert "Cheap Item" not in titles


def test_edit_listing_forbidden_for_non_owner(client, unique_suffix):
    _, owner_token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(owner_token))
    listing_id = res.json()["listing_id"]

    _, other_token = register_and_login(client, unique_suffix + "b")
    res = client.put(
        f"/listings/{listing_id}",
        json=make_listing_payload(client_token=None, title="Hijacked"),
        headers=auth_headers(other_token),
    )
    assert res.status_code == 403


def test_owner_can_edit_own_listing(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    listing_id = publish(client, token)

    res = client.put(
        f"/listings/{listing_id}",
        json=make_listing_payload(client_token=None, title="Updated Title"),
        headers=auth_headers(token),
    )
    assert res.status_code == 200

    res = client.get(f"/listings/{listing_id}")
    assert res.json()["title"] == "Updated Title"


def test_upload_photo_rejects_non_image(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    res = client.post(
        f"/listings/{listing_id}/photos",
        files={"file": ("not-a-photo.txt", b"just some text", "text/plain")},
        headers=auth_headers(token),
    )
    assert res.status_code == 400


def test_upload_photo_rejects_oversized(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    oversized = b"\xff" * (11 * 1024 * 1024)  # over the 10MB cap
    res = client.post(
        f"/listings/{listing_id}/photos",
        files={"file": ("huge.jpg", oversized, "image/jpeg")},
        headers=auth_headers(token),
    )
    assert res.status_code == 413


def test_upload_photo_accepts_real_image(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    res = client.post(
        f"/listings/{listing_id}/photos",
        files={"file": ("photo.jpg", make_test_image_bytes(), "image/jpeg")},
        headers=auth_headers(token),
    )
    assert res.status_code == 200


def test_upload_photo_writes_jpeg_and_webp_variants_to_disk(client, unique_suffix):
    import os
    from images import thumb_path_for, webp_path_for

    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    res = client.post(
        f"/listings/{listing_id}/photos",
        files={"file": ("photo.jpg", make_test_image_bytes(), "image/jpeg")},
        headers=auth_headers(token),
    )
    file_path = res.json()["url"].lstrip("/")

    assert os.path.exists(file_path)
    assert os.path.exists(thumb_path_for(file_path))
    assert os.path.exists(webp_path_for(file_path))
    assert os.path.exists(webp_path_for(thumb_path_for(file_path)))


def test_view_dedupe_only_counts_first_view(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    # Viewer must be logged out (or a different account than the seller) -
    # the endpoint doesn't count a seller viewing their own listing.
    res1 = client.post(f"/listings/{listing_id}/view")
    assert res1.json()["counted"] is True

    res2 = client.post(f"/listings/{listing_id}/view")
    assert res2.json()["counted"] is False


def test_mark_sold_and_back_to_available(client, unique_suffix):
    """Mark-as-sold must be reversible via /unsold."""
    _, token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(token))
    listing_id = res.json()["listing_id"]

    res = client.patch(f"/listings/{listing_id}/sold", headers=auth_headers(token))
    assert res.status_code == 200
    assert client.get(f"/listings/{listing_id}").json()["status"] == "sold"

    res = client.patch(f"/listings/{listing_id}/unsold", headers=auth_headers(token))
    assert res.status_code == 200
    assert client.get(f"/listings/{listing_id}").json()["status"] == "available"


def test_unsold_rejects_non_owner(client, unique_suffix):
    _, seller_token = register_and_login(client, unique_suffix)
    res = client.post("/listings", json=make_listing_payload(client_token=str(uuid.uuid4())), headers=auth_headers(seller_token))
    listing_id = res.json()["listing_id"]
    client.patch(f"/listings/{listing_id}/sold", headers=auth_headers(seller_token))

    _, other_token = register_and_login(client, f"{unique_suffix}b")
    res = client.patch(f"/listings/{listing_id}/unsold", headers=auth_headers(other_token))
    assert res.status_code == 403


def test_stale_token_reads_as_anonymous_on_public_endpoints(client, unique_suffix):
    """After a password change, an old token on a public endpoint must read
    as anonymous (is_favorited goes dark), same as require_user paths."""
    import time

    _, token = register_and_login(client, unique_suffix)
    listing_id = publish(client, token)
    client.post(f"/listings/{listing_id}/favorite", headers=auth_headers(token))
    assert client.get(f"/listings/{listing_id}", headers=auth_headers(token)).json()["is_favorited"] is True

    # JWT iat has whole-second precision - the change must land in a LATER
    # second than the token's issue time to count as "after" it.
    time.sleep(1.1)
    res = client.post(
        "/me/change-password",
        json={"current_password": "testpass123", "new_password": "testpass456"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200

    assert client.get(f"/listings/{listing_id}", headers=auth_headers(token)).json()["is_favorited"] is False


def test_first_listing_waits_for_review(client, unique_suffix):
    """A new seller's first listing is not public until an admin approves
    it - the only thing standing between an anonymous signup and a photo on
    the front page."""
    _, token = register_and_login(client, unique_suffix)
    res = client.post(
        "/listings",
        json=make_listing_payload(client_token=str(uuid.uuid4())),
        headers=auth_headers(token),
    )
    assert res.json()["pending_review"] is True
    listing_id = res.json()["listing_id"]

    # absent from browse, and invisible to anyone but the seller
    assert all(r["id"] != listing_id for r in client.get("/search").json()["results"])
    assert client.get(f"/listings/{listing_id}").status_code == 404
    assert client.get(f"/listings/{listing_id}", headers=auth_headers(token)).status_code == 200


def test_seller_publishes_freely_once_they_have_a_track_record(client, unique_suffix, monkeypatch):
    """Listings wait for review until the seller has TRUSTED_AFTER_APPROVED
    approved, then publish immediately."""
    import services

    _, token = register_and_login(client, unique_suffix)
    admin_name, admin_token = register_and_login(client, f"{unique_suffix}adm")
    monkeypatch.setattr(services, "ADMIN_USERNAMES", {admin_name.lower()})

    approved = 0
    while approved < services.TRUSTED_AFTER_APPROVED:
        res = client.post(
            "/listings",
            json=make_listing_payload(client_token=str(uuid.uuid4()), title=f"Item {approved}"),
            headers=auth_headers(token),
        ).json()
        # every one of these needs a moderator until the threshold is met
        assert res["pending_review"] is True, f"listing {approved} should have waited"
        assert client.post(
            f"/admin/listings/{res['listing_id']}/approve", headers=auth_headers(admin_token)
        ).status_code == 200
        approved += 1

    # with a track record behind them, the next one goes straight up
    nxt = client.post(
        "/listings",
        json=make_listing_payload(client_token=str(uuid.uuid4()), title="Trusted"),
        headers=auth_headers(token),
    ).json()
    assert nxt["pending_review"] is False
    assert any(r["id"] == nxt["listing_id"] for r in client.get("/search").json()["results"])


def test_pending_queue_is_admins_only(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    assert client.get("/admin/pending", headers=auth_headers(token)).status_code == 403


def test_search_accepts_several_categories(client, unique_suffix):
    """The category filter takes a comma-separated list, so a shopper can
    look at textbooks and notes at once. A single value still behaves as it
    always did - that is what the homepage tiles and older shared links send."""
    _, token = register_and_login(client, unique_suffix)
    publish(client, token, title="A textbook", category="textbooks")
    publish(client, token, title="Some notes", category="notes")
    publish(client, token, title="A bike", category="bikes")

    def categories_in(params):
        res = client.get("/search", params=params)
        assert res.status_code == 200
        return {r["category"] for r in res.json()["results"]}

    assert categories_in({"category": "textbooks"}) == {"textbooks"}
    assert categories_in({"category": "textbooks,notes"}) == {"textbooks", "notes"}
    # an unknown value is ignored rather than returning nothing
    assert categories_in({"category": "not-a-category,notes"}) == {"notes"}
    assert categories_in({"category": ""}) >= {"textbooks", "notes", "bikes"}
