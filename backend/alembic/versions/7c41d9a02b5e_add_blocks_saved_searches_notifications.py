"""add blocks, saved_searches, notifications tables

Revision ID: 7c41d9a02b5e
Revises: 15e06ecb3ac9
Create Date: 2026-07-13 22:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c41d9a02b5e'
down_revision: Union[str, None] = '15e06ecb3ac9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'blocks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=True),
        sa.Column('blocked_username', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username', 'blocked_username', name='uq_block_pair'),
    )
    op.create_index(op.f('ix_blocks_id'), 'blocks', ['id'], unique=False)
    op.create_index(op.f('ix_blocks_username'), 'blocks', ['username'], unique=False)
    op.create_index(op.f('ix_blocks_blocked_username'), 'blocks', ['blocked_username'], unique=False)

    op.create_table(
        'saved_searches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=True),
        sa.Column('query', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('last_notified_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_saved_searches_id'), 'saved_searches', ['id'], unique=False)
    op.create_index(op.f('ix_saved_searches_username'), 'saved_searches', ['username'], unique=False)

    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=True),
        sa.Column('type', sa.String(), nullable=True),
        sa.Column('listing_id', sa.Integer(), nullable=True),
        sa.Column('actor', sa.String(), nullable=True),
        sa.Column('is_read', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_notifications_id'), 'notifications', ['id'], unique=False)
    op.create_index(op.f('ix_notifications_username'), 'notifications', ['username'], unique=False)
    op.create_index(op.f('ix_notifications_is_read'), 'notifications', ['is_read'], unique=False)
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_table('notifications')
    op.drop_table('saved_searches')
    op.drop_table('blocks')
