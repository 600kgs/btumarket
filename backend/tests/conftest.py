import os
import uuid

# Must happen before `main` (or anything it imports) is loaded - config.py,
# database.py, and redis_client.py all read these env vars once, at import
# time, to build the DB engine / Redis client. Real values (CI service
# containers, or a local Postgres/Redis you started yourself - see the repo
# README) are expected to already be set when running for real; these
# os.environ.setdefault calls only kick in for a bare `pytest` with nothing
# configured, so the suite fails with a clear connection error instead of a
# confusing import-time crash.
os.environ.setdefault("MARKETPLACE_DEV", "1")
os.environ.setdefault("MARKETPLACE_REQUIRE_EMAIL_VERIFICATION", "0")
os.environ.setdefault("MARKETPLACE_ALLOWED_EMAIL_DOMAINS", "")
os.environ.setdefault("MARKETPLACE_DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/postgres")
# db 1, not dev's default db 0 - flushing this per test must never touch a
# developer's real local Redis data.
os.environ.setdefault("MARKETPLACE_REDIS_URL", "redis://localhost:6379/1")

import pytest
from fastapi.testclient import TestClient

from main import app
from redis_client import redis_client


@pytest.fixture(autouse=True)
def clean_redis():
    """Rate-limit/dedupe state starts clean each test. Postgres rows are
    handled by unique usernames/emails per test instead (see unique_suffix),
    which avoids per-test transaction plumbing."""
    redis_client.flushdb()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def unique_suffix():
    return uuid.uuid4().hex[:8]
