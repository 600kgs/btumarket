"""Product-event tracking.

Two things worth guarding: that the funnel actually records, and that it can
never take a request down with it. The second matters more - analytics that
breaks registration is worse than no analytics.
"""
import services
from database import Event, SessionLocal

from tests.test_listings import (
    auth_headers,
    make_listing_payload,
    publish,
    register_and_login,
)


def events_named(name, username=None):
    db = SessionLocal()
    try:
        q = db.query(Event).filter(Event.name == name)
        if username:
            q = q.filter(Event.username == username)
        return q.all()
    finally:
        db.close()


def test_registration_records_the_start_of_the_funnel(client, unique_suffix):
    username, _ = register_and_login(client, unique_suffix)
    assert len(events_named("register_started", username)) == 1


def test_creating_a_listing_records_its_review_status(client, unique_suffix):
    username, token = register_and_login(client, unique_suffix)
    client.post("/listings", json=make_listing_payload(), headers=auth_headers(token))

    events = events_named("listing_created", username)
    assert len(events) == 1
    # a first-time seller's listing waits for review, and the event says so
    assert events[0].detail == "pending"


def test_a_search_with_no_results_records_the_query(client, unique_suffix):
    term = f"nothingmatchesthis{unique_suffix}"
    res = client.get("/search", params={"q": term})
    assert res.status_code == 200
    assert res.json()["count"] == 0

    events = events_named("search_empty")
    assert term in [e.detail for e in events]


def test_a_search_with_results_records_nothing(client, unique_suffix):
    """publish(), not a bare POST: a first seller's listing waits for review
    and so isn't searchable, which would make the search legitimately empty
    and defeat the point of this test."""
    _, token = register_and_login(client, unique_suffix)
    title = f"Findable{unique_suffix}"
    publish(client, token, title=title)

    before = len(events_named("search_empty"))
    res = client.get("/search", params={"q": title})
    assert res.json()["count"] >= 1, "listing should be searchable once public"
    assert len(events_named("search_empty")) == before


def test_tracking_failure_cannot_break_the_request(client, unique_suffix, monkeypatch):
    """The whole point of track() failing open: a broken events table must
    still leave a working marketplace."""
    def explode(*args, **kwargs):
        raise RuntimeError("events table is on fire")

    monkeypatch.setattr(services, "Event", explode)

    res = client.post(
        "/register",
        json={
            "email": f"resilient{unique_suffix}@example.com",
            "phone": "555123456",
            "password": "testpass123",
        },
    )
    assert res.status_code == 200
    assert res.json()["username"]
