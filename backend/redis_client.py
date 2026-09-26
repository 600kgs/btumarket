"""Shared Redis client for the rate limiter, dedupe caches, and RQ queue.

Timeouts are tight because callers fail open when Redis is unavailable;
a healthy same-network Redis responds in a few milliseconds.
"""
import time

import redis

from config import REDIS_URL

redis_client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=0.3,
    socket_timeout=0.3,
)

# A stopped Redis container fails on DNS resolution, which takes seconds and
# happens before socket_connect_timeout applies. This breaker makes only the
# first request after an outage pay that cost.
_down_until = 0.0
_DOWN_COOLDOWN_SECONDS = 5


def _mark_down() -> None:
    global _down_until
    _down_until = time.time() + _DOWN_COOLDOWN_SECONDS


def redis_or_none(fn, *args, **kwargs):
    """Run a Redis call, returning None if Redis is down or recently failed.

    Only use where a successful response is never falsy in a way the caller
    must distinguish from "skipped" (TTL, pipeline execute, etc.). For
    SET NX use try_set_nx, where a falsy response has a distinct meaning.
    """
    if time.time() < _down_until:
        return None
    try:
        return fn(*args, **kwargs)
    except Exception:
        _mark_down()
        return None


def try_set_nx(key: str, value, ex: int) -> bool:
    """SET key EX NX for dedupe checks. True = proceed (key was unset, or
    Redis is unreachable and this check fails open). False only when Redis
    confirmed the key already exists.
    """
    if time.time() < _down_until:
        return True
    try:
        return bool(redis_client.set(key, value, ex=ex, nx=True))
    except Exception:
        _mark_down()
        return True
