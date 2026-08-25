"""add events table for product analytics

Revision ID: d7f1a2c93be5
Revises: 8b3c5d9e21f4
Create Date: 2026-07-26

Deliberately no foreign key on username: an event describes something that
happened, and deleting the account afterwards should not rewrite the record of
it. The column is a plain string for the same reason the moderation reports
keep theirs.

Written defensively, and not out of superstition. create_tables() runs
Base.metadata.create_all at every startup so the SQLite dev path needs no
migration step, and create_all creates any table it finds missing. A container
that boots before this migration runs therefore already has `events` - with the
single-column indexes the model declares, but without the composite one below.
So each object is created only if it is absent, which makes this migration
correct whether it runs before or after the app first started.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7f1a2c93be5"
down_revision: Union[str, None] = "8b3c5d9e21f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ("ix_events_name", ["name"]),
    ("ix_events_username", ["username"]),
    ("ix_events_created_at", ["created_at"]),
    # the funnel query always filters by name within a time window
    ("ix_events_name_created", ["name", "created_at"]),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("events"):
        op.create_table(
            "events",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("username", sa.String(), nullable=True),
            sa.Column("detail", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        existing = set()
    else:
        existing = {ix["name"] for ix in inspector.get_indexes("events")}

    for name, columns in INDEXES:
        if name not in existing:
            op.create_index(name, "events", columns)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("events"):
        return
    existing = {ix["name"] for ix in inspector.get_indexes("events")}
    for name, _ in reversed(INDEXES):
        if name in existing:
            op.drop_index(name, table_name="events")
    op.drop_table("events")
