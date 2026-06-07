from sqlalchemy import text
from sqlalchemy.engine import Engine


def run_runtime_migrations(engine: Engine) -> None:
    """Apply additive schema changes that create_all cannot backfill on existing DBs."""
    statements = [
        # ── Existing migrations (unchanged) ──────────────────────────────────
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

        # ── NEW: Message soft-delete + edit tracking ──────────────────────────
        """
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE
        """,
        """
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL
        """,

        # ── NEW: MessageRead table — per-message read receipts ────────────────
        """
        CREATE TABLE IF NOT EXISTS message_reads (
            id          BIGSERIAL PRIMARY KEY,
            message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id     BIGINT NOT NULL,
            participant_type VARCHAR(20) NOT NULL DEFAULT 'user',
            display_name VARCHAR(255) NOT NULL DEFAULT '',
            read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_unique
        ON message_reads (message_id, user_id, participant_type)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_message_reads_conversation
        ON message_reads (conversation_id, user_id)
        """,

        # ── NEW: NotificationPreference table ────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS notification_preferences (
            id               BIGSERIAL PRIMARY KEY,
            user_id          BIGINT NOT NULL,
            participant_type VARCHAR(20) NOT NULL DEFAULT 'user',
            conversation_id  BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
            muted            BOOLEAN NOT NULL DEFAULT FALSE,
            mute_until       TIMESTAMPTZ NULL,
            mention_only     BOOLEAN NOT NULL DEFAULT FALSE,
            push_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_preferences_unique
        ON notification_preferences (user_id, participant_type, conversation_id)
        WHERE conversation_id IS NOT NULL
        """,
    ]

    statements.append("""
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(64) NULL
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_messages_client_message_id
        ON messages (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL
    """)

    # ── NEW: message_delivery_receipts table ─────────────────────────────
    statements.append("""
        CREATE TABLE IF NOT EXISTS message_delivery_receipts (
            id                BIGSERIAL PRIMARY KEY,
            message_id        BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            conversation_id   BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            recipient_user_id BIGINT NOT NULL,
            participant_type  VARCHAR(20) NOT NULL DEFAULT 'user',
            display_name      VARCHAR(255) NOT NULL DEFAULT '',
            delivered_at      TIMESTAMPTZ NULL,
            read_at           TIMESTAMPTZ NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    statements.append("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_delivery_unique
        ON message_delivery_receipts (message_id, recipient_user_id, participant_type)
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_msg_delivery_conversation
        ON message_delivery_receipts (conversation_id, recipient_user_id)
    """)

    # ── NEW: client_message_id on messages ────────────────────────────────
    statements.append("""
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(64) NULL
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_messages_client_msg_id
        ON messages (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL
    """)

    # ── message_outbox table ─────────────────────────────────────────────
    statements.append("""
        CREATE TABLE IF NOT EXISTS message_outbox (
            id              BIGSERIAL PRIMARY KEY,
            message_id      BIGINT NOT NULL,
            conversation_id BIGINT NOT NULL,
            admin_id        BIGINT NOT NULL,
            actor_key       VARCHAR(80) NOT NULL,
            payload         TEXT NOT NULL,
            attempts        INTEGER NOT NULL DEFAULT 0,
            max_attempts    INTEGER NOT NULL DEFAULT 3,
            processed       BOOLEAN NOT NULL DEFAULT FALSE,
            failed          BOOLEAN NOT NULL DEFAULT FALSE,
            error           TEXT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            processed_at    TIMESTAMPTZ NULL
        )
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_outbox_pending
        ON message_outbox (processed, failed, attempts, created_at)
        WHERE processed = FALSE AND failed = FALSE
    """)

    # ── AI Explainer narration timeline table ─────────────────────────────
    statements.append("""
        CREATE TABLE IF NOT EXISTS ai_explainer_chunks (
            id BIGSERIAL PRIMARY KEY,
            admin_id BIGINT NOT NULL,
            camera_id VARCHAR(120) NOT NULL,
            chunk_id VARCHAR(120) NOT NULL UNIQUE,
            zone VARCHAR(80) NOT NULL DEFAULT 'unknown',
            start_ts DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            end_ts DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            headline VARCHAR(255) NOT NULL,
            summary TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '[]',
            severity VARCHAR(30) NOT NULL DEFAULT 'routine',
            confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            source_video VARCHAR(255) NULL,
            run_id VARCHAR(80) NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_ai_explainer_chunks_admin_camera_created
        ON ai_explainer_chunks (admin_id, camera_id, created_at DESC)
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_ai_explainer_chunks_run_id
        ON ai_explainer_chunks (run_id)
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_ai_explainer_chunks_summary_fts
        ON ai_explainer_chunks
        USING GIN (to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(zone, '')))
    """)

    # ── SCVAM job queue + record status ─────────────────────────────────────
    statements.append("""
        ALTER TABLE records
        ADD COLUMN IF NOT EXISTS scvam_status VARCHAR(30) NOT NULL DEFAULT 'none'
    """)
    statements.append("""
        ALTER TABLE records
        ADD COLUMN IF NOT EXISTS scvam_output_path VARCHAR(512) NULL
    """)
    statements.append("""
        CREATE TABLE IF NOT EXISTS scvam_jobs (
            id BIGSERIAL PRIMARY KEY,
            organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
            vault_record_id VARCHAR(120) NOT NULL,
            db_record_id BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
            enc_relative_path VARCHAR(512) NOT NULL,
            segment_index INTEGER NOT NULL DEFAULT 1,
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            staging_path VARCHAR(512) NULL,
            work_path VARCHAR(512) NULL,
            error_message TEXT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            duration_sec INTEGER NULL,
            camera_id VARCHAR(120) NULL,
            resident_name VARCHAR(255) NULL,
            room VARCHAR(120) NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at TIMESTAMPTZ NULL,
            finished_at TIMESTAMPTZ NULL
        )
    """)
    statements.append("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scvam_jobs_vault_segment
        ON scvam_jobs (vault_record_id, segment_index)
    """)
    statements.append("""
        CREATE INDEX IF NOT EXISTS idx_scvam_jobs_status_created
        ON scvam_jobs (status, created_at)
    """)

    # ── AI summary columns on calls ───────────────────────────────────────────
    statements.append("""
        ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript TEXT NULL
    """)
    statements.append("""
        ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_summary TEXT NULL
    """)

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))