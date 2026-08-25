from sqlalchemy import create_engine, Column, ForeignKey, Integer, String, Float, DateTime, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

from config import DATABASE_URL

# check_same_thread only exists for SQLite, which by default refuses to use
# a connection from a thread other than its creator; FastAPI's threadpool
# would trip that constantly.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Listing(Base):
    __tablename__ = "listings"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(String)
    price = Column(Float, index=True)
    category = Column(String, index=True)
    status = Column(String, default="available", index=True)
    seller = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    seller_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    photo_url = Column(String, nullable=True)
    views = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    # null until marked sold
    sold_at = Column(DateTime, nullable=True, index=True)
    # Phonetic skeleton of title+description (see translit.py) so a
    # Latin-typed search finds Georgian-script listings and vice versa.
    # Maintained on create/update; backfilled by migration 4f2d8c1b7e90.
    search_fold = Column(String, default="")


class Photo(Base):
    __tablename__ = "photos"
    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    file_path = Column(String)


class EmailCode(Base):
    """One-time 6-digit codes for email verification and password reset.
    Short-lived, single-use, replaced when re-requested."""
    __tablename__ = "email_codes"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True)
    code = Column(String)
    purpose = Column(String)   # "verify" | "reset"
    used = Column(Integer, default=0)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class Message(Base):
    """One chat message, always tied to a listing. Conversations are keyed
    by (listing_id, peer) so the same buyer can ask a seller about two
    different items without the threads merging."""
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    # listing_id has no foreign key on purpose: a conversation outlives the
    # listing it was about, and the UI shows "deleted listing" in its place.
    listing_id = Column(Integer, index=True)
    sender = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    recipient = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    body = Column(String)
    is_read = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Report(Base):
    """A user flagging a listing; admins resolve or dismiss from /admin.

    Deliberately carries no foreign keys: a report is a moderation record
    and has to survive the listing or the account it was about being
    deleted, which is exactly what admins delete them for.
    """
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, index=True)
    reporter = Column(String)          # username
    reason = Column(String)
    status = Column(String, default="open", index=True)   # "open" | "resolved"
    created_at = Column(DateTime, default=datetime.utcnow)


class Favorite(Base):
    """(username, listing_id) unique; favoriting twice toggles back off."""
    __tablename__ = "favorites"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    listing_id = Column(Integer, ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("username", "listing_id", name="uq_favorite_user_listing"),)


class Block(Base):
    """`username` blocks `blocked_username`. Checked in both directions on
    message send; both sides get the same neutral error."""
    __tablename__ = "blocks"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    blocked_username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("username", "blocked_username", name="uq_block_pair"),)


class SavedSearch(Base):
    """Alert subscription: notify when a new listing matches the query or
    category. last_notified_at throttles the emails."""
    __tablename__ = "saved_searches"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    query = Column(String, default="")
    category = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_notified_at = Column(DateTime, nullable=True)


class Notification(Base):
    """Bell feed items. type: "message" | "favorite" | "saved_search"."""
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)  # who sees it
    type = Column(String)
    listing_id = Column(Integer, nullable=True)
    actor = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)   # who caused it
    is_read = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class HiddenConversation(Base):
    """A conversation the user removed from their own inbox. Only a marker:
    the messages stay, the other side keeps the thread, and it reappears
    here if a newer message arrives after hidden_at."""
    __tablename__ = "hidden_conversations"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    listing_id = Column(Integer, index=True)
    peer = Column(String, ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"), index=True)
    hidden_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("username", "listing_id", "peer", name="uq_hidden_convo"),)


class Event(Base):
    """A product event, for answering "where do people fall out?".

    Recorded on the server rather than from the browser on purpose: no third
    party, nothing for an ad blocker to remove, no cookie banner owed, and
    nothing here identifies a person beyond the username already stored
    elsewhere. It answers questions the crash reporter and the uptime check
    cannot - how many finish registration, what people search for and find
    nothing, whether anyone messages a seller.

    name examples: register_started, register_verified, listing_created,
    search_empty, message_sent. detail is small free text (e.g. the query that
    returned nothing), never a whole request body.
    """
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    username = Column(String, nullable=True, index=True)
    detail = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


def create_tables():
    # importing models registers User on Base.metadata
    import models  # noqa: F401
    # create_all only creates missing tables (never ALTERs), so this stays a
    # no-op against a migrated Postgres while giving the SQLite dev path a
    # working schema with no extra steps. Schema changes go through Alembic.
    Base.metadata.create_all(bind=engine)


def get_db():
    """Yields a session and guarantees it closes, even if the route raises."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
