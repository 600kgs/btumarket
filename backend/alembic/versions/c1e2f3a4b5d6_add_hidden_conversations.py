"""add hidden_conversations table

Revision ID: c1e2f3a4b5d6
Revises: a3731eda387e
Create Date: 2026-07-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1e2f3a4b5d6'
down_revision: Union[str, None] = 'a3731eda387e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'hidden_conversations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=True),
        sa.Column('listing_id', sa.Integer(), nullable=True),
        sa.Column('peer', sa.String(), nullable=True),
        sa.Column('hidden_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username', 'listing_id', 'peer', name='uq_hidden_convo'),
    )
    op.create_index(op.f('ix_hidden_conversations_id'), 'hidden_conversations', ['id'], unique=False)
    op.create_index(op.f('ix_hidden_conversations_username'), 'hidden_conversations', ['username'], unique=False)
    op.create_index(op.f('ix_hidden_conversations_listing_id'), 'hidden_conversations', ['listing_id'], unique=False)
    op.create_index(op.f('ix_hidden_conversations_peer'), 'hidden_conversations', ['peer'], unique=False)


def downgrade() -> None:
    op.drop_table('hidden_conversations')
