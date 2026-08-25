"""add sold_at to listings

Revision ID: a3731eda387e
Revises: 7c41d9a02b5e
Create Date: 2026-07-14 22:10:51.337224

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3731eda387e'
down_revision: Union[str, None] = '7c41d9a02b5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('listings', sa.Column('sold_at', sa.DateTime(), nullable=True))
    op.create_index(op.f('ix_listings_sold_at'), 'listings', ['sold_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_listings_sold_at'), table_name='listings')
    op.drop_column('listings', 'sold_at')
