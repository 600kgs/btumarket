"""Add foreign keys between the tables that reference users and listings.

Revision ID: 8b3c5d9e21f4
Revises: 4f2d8c1b7e90
Create Date: 2026-07-25

Until now every relationship was held together by application code alone, so
a delete path that forgot a table left rows pointing at nothing - deleting a
listing did exactly that to its favourites. The database now enforces it.

ON DELETE CASCADE matches what the delete paths already do by hand, and is
kept as the belt to their braces rather than a replacement: the code still
removes photo *files*, which no constraint can do.

ON UPDATE CASCADE is what makes a username change a single UPDATE instead of
a script that rewrites twelve columns.

Two tables are deliberately left without keys:
  - messages.listing_id, because a conversation outlives the listing it was
    about and the UI shows "deleted listing" in its place.
  - reports, because a moderation record has to survive the listing and the
    account it was about being deleted.
"""
from typing import Union

from alembic import op

revision: str = "8b3c5d9e21f4"
down_revision: Union[str, None] = "4f2d8c1b7e90"
branch_labels = None
depends_on = None

# (name, table, columns, target table, target columns, ondelete, onupdate)
USER_FKS = [
    ("fk_listings_seller_users", "listings", ["seller"]),
    ("fk_messages_sender_users", "messages", ["sender"]),
    ("fk_messages_recipient_users", "messages", ["recipient"]),
    ("fk_favorites_username_users", "favorites", ["username"]),
    ("fk_blocks_username_users", "blocks", ["username"]),
    ("fk_blocks_blocked_username_users", "blocks", ["blocked_username"]),
    ("fk_saved_searches_username_users", "saved_searches", ["username"]),
    ("fk_notifications_username_users", "notifications", ["username"]),
    ("fk_notifications_actor_users", "notifications", ["actor"]),
    ("fk_hidden_conversations_username_users", "hidden_conversations", ["username"]),
    ("fk_hidden_conversations_peer_users", "hidden_conversations", ["peer"]),
]

LISTING_FKS = [
    ("fk_photos_listing_id_listings", "photos", ["listing_id"]),
    ("fk_favorites_listing_id_listings", "favorites", ["listing_id"]),
]

ORPHAN_CLEANUP = [
    "delete from photos where listing_id is not null and listing_id not in (select id from listings)",
    "delete from favorites where listing_id is not null and listing_id not in (select id from listings)",
    "delete from favorites where username is not null and username not in (select username from users)",
    "delete from listings where seller is not null and seller not in (select username from users)",
    "delete from messages where sender is not null and sender not in (select username from users)",
    "delete from messages where recipient is not null and recipient not in (select username from users)",
    "delete from blocks where username not in (select username from users) or blocked_username not in (select username from users)",
    "delete from saved_searches where username is not null and username not in (select username from users)",
    "delete from notifications where username is not null and username not in (select username from users)",
    "update notifications set actor = null where actor is not null and actor not in (select username from users)",
    "delete from hidden_conversations where username not in (select username from users) or peer not in (select username from users)",
]


def upgrade() -> None:
    # Rows orphaned before the constraints existed would block them.
    for statement in ORPHAN_CLEANUP:
        op.execute(statement)

    for name, table, columns in USER_FKS:
        op.create_foreign_key(
            name, table, "users", columns, ["username"],
            ondelete="CASCADE", onupdate="CASCADE",
        )
    for name, table, columns in LISTING_FKS:
        op.create_foreign_key(
            name, table, "listings", columns, ["id"], ondelete="CASCADE",
        )
    op.create_foreign_key(
        "fk_listings_seller_id_users", "listings", "users", ["seller_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_listings_seller_id_users", "listings", type_="foreignkey")
    for name, table, _ in LISTING_FKS + USER_FKS:
        op.drop_constraint(name, table, type_="foreignkey")
