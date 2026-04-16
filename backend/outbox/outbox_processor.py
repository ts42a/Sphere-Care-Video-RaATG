"""
Message outbox processor.
Runs as a background asyncio task — started in main.py lifespan.
Polls the message_outbox table every 0.5s, sends unprocessed jobs via WS.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.db.session import SessionLocal
from backend.models.message import MessageOutbox
from backend.ws.ws_manager import ws_manager

logger = logging.getLogger("outbox_processor")


async def process_outbox_once(db: Session) -> int:
    """Process one batch of pending outbox jobs. Returns count processed."""
    pending = (
        db.query(MessageOutbox)
        .filter(
            MessageOutbox.processed == False,
            MessageOutbox.failed == False,
            MessageOutbox.attempts < MessageOutbox.max_attempts,
        )
        .order_by(MessageOutbox.created_at.asc())
        .limit(50)
        .all()
    )

    if not pending:
        return 0

    count = 0
    for job in pending:
        job.attempts += 1
        try:
            payload = json.loads(job.payload)
            # Send to recipient via WS actor key
            await ws_manager.broadcast_actor(job.actor_key, payload)
            job.processed = True
            job.processed_at = datetime.now(timezone.utc)
            count += 1
        except Exception as e:
            job.error = str(e)
            if job.attempts >= job.max_attempts:
                job.failed = True
                logger.warning(f"Outbox job {job.id} failed after {job.attempts} attempts: {e}")

    db.commit()
    return count


async def run_outbox_processor(interval: float = 0.5):
    """Main loop — runs forever, polls every `interval` seconds."""
    logger.info("Outbox processor started")
    while True:
        try:
            db = SessionLocal()
            try:
                count = await process_outbox_once(db)
                if count:
                    logger.debug(f"Processed {count} outbox jobs")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Outbox processor error: {e}")
        await asyncio.sleep(interval)
