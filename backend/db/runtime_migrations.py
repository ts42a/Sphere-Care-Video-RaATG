from sqlalchemy import text
from sqlalchemy.engine import Engine


def run_runtime_migrations(engine: Engine) -> None:
    """Apply additive schema changes that create_all cannot backfill on existing DBs."""
    statements = [
        """
        ALTER TABLE conversation_participants
        ADD COLUMN IF NOT EXISTS participant_type VARCHAR(20) NOT NULL DEFAULT 'user'
        """,
        """
        ALTER TABLE conversation_participants
        ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ NULL
        """,
        """
        ALTER TABLE conversation_participants
        ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE
        """,
        """
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS sender_participant_type VARCHAR(20) NOT NULL DEFAULT 'user'
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_actor
        ON conversation_participants (conversation_id, participant_type, user_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
        ON messages (conversation_id, created_at)
        """,
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))