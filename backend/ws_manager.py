"""Websocket connection manager for live chat delivery.

Cross-worker safe via Redis pub/sub: each worker tracks only the sockets
attached to itself, and a message reaches its recipient regardless of which
worker holds their connection, because every worker's subscriber loop relays
published notifications to its own matching sockets.

notify() stays synchronous and reuses the fail-open redis_client, since the
routes that call it are sync (their blocking DB I/O belongs on FastAPI's
threadpool, not the event loop). Only the subscriber loop needs
redis.asyncio: it's a long-lived streaming listen() running as a background
task.

The socket carries no data, only a wake-up signal - the client refetches
through the normal REST endpoints, which stay the single source of truth for
what gets rendered.
"""
import asyncio
import json
import logging

import redis.asyncio as aioredis

from config import REDIS_URL
from redis_client import redis_client, redis_or_none

logger = logging.getLogger("btumarket")

CHANNEL_PREFIX = "chat:"

# sockets attached to this process only; cross-worker delivery goes through
# the Redis channel
_local_connections: dict = {}


def _channel_for(username: str) -> str:
    return f"{CHANNEL_PREFIX}{username}"


def register(username: str, ws) -> None:
    _local_connections.setdefault(username, set()).add(ws)


def unregister(username: str, ws) -> None:
    conns = _local_connections.get(username)
    if conns:
        conns.discard(ws)
        if not conns:
            del _local_connections[username]


def notify(username: str) -> None:
    """Called after a message commits: wakes the recipient's connected
    browser(s) to refetch. Fails open - the message is already in the
    database, and the frontend's polling fallback covers a missed push."""
    redis_or_none(redis_client.publish, _channel_for(username), json.dumps({"type": "new_message"}))


async def subscriber_loop() -> None:
    """Started once per worker at startup. Reconnects with a short backoff if
    the Redis connection drops; a dead subscriber would otherwise silently
    break live delivery for this worker until restart."""
    while True:
        try:
            redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            pubsub = redis.pubsub()
            await pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
            logger.info("Chat pub/sub subscriber connected")
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                username = message["channel"][len(CHANNEL_PREFIX):]
                conns = _local_connections.get(username)
                if not conns:
                    continue
                for ws in list(conns):
                    try:
                        await ws.send_text(message["data"])
                    except Exception:
                        pass  # that socket's own receive loop cleans it up
        except Exception as e:
            logger.warning("Chat pub/sub subscriber dropped, reconnecting in 5s: %s", e)
            await asyncio.sleep(5)
