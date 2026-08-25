"""Add search_fold for cross-script (Georgian/Latin) search.

Revision ID: 4f2d8c1b7e90
Revises: c1e2f3a4b5d6
Create Date: 2026-07-20

Adds the phonetic-skeleton column (see backend/translit.py) and backfills it
for every existing listing, so cross-script search works on day one instead
of only for listings created after this ships.
"""
from typing import Union

import sqlalchemy as sa
from alembic import op

from translit import fold

revision: str = "4f2d8c1b7e90"
down_revision: Union[str, None] = "c1e2f3a4b5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listings", sa.Column("search_fold", sa.String(), server_default="", nullable=False))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, title, description FROM listings")).fetchall()
    for row_id, title, description in rows:
        conn.execute(
            sa.text("UPDATE listings SET search_fold = :f WHERE id = :id"),
            {"f": fold(f"{title or ''} {description or ''}"), "id": row_id},
        )


def downgrade() -> None:
    op.drop_column("listings", "search_fold")
