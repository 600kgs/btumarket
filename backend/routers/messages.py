"""Chat: sending messages, the live websocket, threads, and unread counts."""
import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

import ws_manager
from auth import check_rate_limit, record_attempt, require_user, username_for_ws_token
from database import HiddenConversation, Listing, Message, Notification, SessionLocal, get_db
from models import User
from schemas import MessageRequest
from services import (
    MESSAGE_LOCKOUT_SECONDS,
    MESSAGE_MAX_ATTEMPTS,
    MESSAGE_WINDOW_SECONDS,
    get_listing_or_404,
    is_blocked_either_way,
    maybe_send_message_email,
    track,
)

router = APIRouter()


@router.post("/messages")
def send_message(body: MessageRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    key = f"send_message:{username}"
    check_rate_limit(key)
    record_attempt(key, MESSAGE_MAX_ATTEMPTS, MESSAGE_WINDOW_SECONDS, MESSAGE_LOCKOUT_SECONDS)

    if body.recipient == username:
        raise HTTPException(status_code=400, detail="cant_message_self")

    recipient = db.query(User).filter(User.username == body.recipient).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="recipient_not_found")

    # one neutral error for both directions; revealing who blocked whom
    # invites retaliation
    if is_blocked_either_way(db, username, body.recipient):
        raise HTTPException(status_code=403, detail="messaging_unavailable")

    listing = get_listing_or_404(db, body.listing_id)

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="message_empty")

    msg = Message(
        listing_id=body.listing_id,
        sender=username,
        recipient=body.recipient,
        body=text,
    )
    db.add(msg)
    db.add(Notification(username=body.recipient, type="message", listing_id=body.listing_id, actor=username))
    # the point of the whole site: a student actually reaching a seller
    track(db, "message_sent", username)
    db.commit()

    maybe_send_message_email(recipient, username, listing.title)
    ws_manager.notify(recipient.username)

    return {"message": "Sent"}


@router.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket):
    """One connection per session, not per conversation: the server pushes a
    wake-up for any message addressed to this user, and the client refetches
    through the normal REST endpoints.

    Auth is a first-message handshake rather than a query-param token, which
    would land in proxy access logs and browser history.
    """
    await websocket.accept()

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "auth":
            raise ValueError("first message must be an auth message")
        # session scoped to the handshake; holding one open per socket would
        # pin a DB connection for the socket's whole lifetime
        db = SessionLocal()
        try:
            username = username_for_ws_token(auth_msg["token"], db)
        finally:
            db.close()
    except Exception:
        await websocket.close(code=4401)
        return

    ws_manager.register(username, websocket)
    try:
        while True:
            # no client->server messages are expected after auth; this blocks
            # until the client disconnects
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.unregister(username, websocket)


@router.get("/conversations")
def get_conversations(username: str = Depends(require_user), db: Session = Depends(get_db)):
    """The current user's conversations, newest activity first, with the
    listing title, last message preview, and unread count each."""

    msgs = (
        db.query(Message)
        .filter((Message.sender == username) | (Message.recipient == username))
        .order_by(Message.created_at.desc(), Message.id.desc())
        .all()
    )

    convos: dict = {}
    for m in msgs:  # newest first, so the first message per key is the latest
        peer = m.recipient if m.sender == username else m.sender
        key = (m.listing_id, peer)
        if key not in convos:
            convos[key] = {
                "listing_id": m.listing_id,
                "peer": peer,
                "last_message": m.body,
                "last_at": m.created_at,
                "unread": 0,
            }
        if m.recipient == username and not m.is_read:
            convos[key]["unread"] += 1

    # deleted-from-inbox conversations stay hidden until a newer message
    # arrives
    hidden = {
        (h.listing_id, h.peer): h.hidden_at
        for h in db.query(HiddenConversation).filter(HiddenConversation.username == username).all()
    }

    listing_ids = {c["listing_id"] for c in convos.values()}
    titles = {}
    if listing_ids:
        for l in db.query(Listing).filter(Listing.id.in_(listing_ids)).all():
            titles[l.id] = l.title

    out = []
    for key, c in convos.items():
        hidden_at = hidden.get(key)
        if hidden_at is not None and c["last_at"] is not None and hidden_at >= c["last_at"]:
            continue
        # None for a deleted listing; the frontend shows a translated label
        c["listing_title"] = titles.get(c["listing_id"])
        out.append(c)
    return {"conversations": out}


@router.delete("/conversations/{listing_id}")
def hide_conversation(listing_id: int, peer: str, username: str = Depends(require_user), db: Session = Depends(get_db)):
    """Remove a conversation from the current user's inbox only. Stores a
    marker rather than deleting messages, so the other side keeps the thread
    and it reappears here if the peer writes again."""
    existing = (
        db.query(HiddenConversation)
        .filter(
            HiddenConversation.username == username,
            HiddenConversation.listing_id == listing_id,
            HiddenConversation.peer == peer,
        )
        .first()
    )
    if existing:
        existing.hidden_at = datetime.utcnow()
    else:
        db.add(HiddenConversation(username=username, listing_id=listing_id, peer=peer))
    db.commit()
    return {"hidden": True}


@router.get("/messages/{listing_id}")
def get_thread(listing_id: int, peer: str, username: str = Depends(require_user), db: Session = Depends(get_db)):
    """The thread between the current user and peer about one listing.
    Fetching marks the incoming messages as read."""

    query = (
        db.query(Message)
        .filter(Message.listing_id == listing_id)
        .filter(
            ((Message.sender == username) & (Message.recipient == peer))
            | ((Message.sender == peer) & (Message.recipient == username))
        )
    )

    # Whatever was there when this reader deleted the conversation stays gone
    # for them, even if they open the thread by its own URL - the same cutoff
    # the conversation list uses. Anything the peer sends afterwards is new,
    # so it shows here and brings the conversation back into their list.
    hidden = (
        db.query(HiddenConversation)
        .filter(
            HiddenConversation.username == username,
            HiddenConversation.listing_id == listing_id,
            HiddenConversation.peer == peer,
        )
        .first()
    )
    if hidden and hidden.hidden_at:
        query = query.filter(Message.created_at > hidden.hidden_at)

    msgs = query.order_by(Message.created_at.asc(), Message.id.asc()).all()

    changed = False
    for m in msgs:
        if m.recipient == username and not m.is_read:
            m.is_read = 1
            changed = True
    if changed:
        db.commit()

    return {
        "messages": [
            {"id": m.id, "sender": m.sender, "body": m.body, "created_at": m.created_at}
            for m in msgs
        ]
    }


@router.get("/messages-unread-count")
def unread_count(username: str = Depends(require_user), db: Session = Depends(get_db)):
    """Unread total for the nav badge."""
    count = (
        db.query(Message)
        .filter(Message.recipient == username, Message.is_read == 0)
        .count()
    )
    return {"unread": count}
