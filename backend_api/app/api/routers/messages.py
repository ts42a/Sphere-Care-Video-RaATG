"""
messages.py — Messages router

GET /messages/conversations         (Team | Resident | Alerts tab)
POST /messages/conversations
GET /messages/conversations/{id}/messages
POST /messages/conversations/{id}/messages
PATCH /messages/conversations/{id}/read
DELETE /messages/conversations/{id}

"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional

from app.api.deps import get_db
from app import models, schemas

router = APIRouter(prefix="/messages", tags=["Messages"])


#helps

def _fmt_conv(c: models.Conversation) -> schemas.ConversationResponse:
    return schemas.ConversationResponse(
        id=c.id,
        name=c.name,
        category=c.category,
        last_message=c.last_message,
        last_message_at=(
            c.last_message_at.strftime("%I:%M %p") if c.last_message_at else None
        ),
        unread_count=c.unread_count,
    )


def _fmt_msg(m: models.Message) -> schemas.MessageResponse:
    return schemas.MessageResponse(
        id=m.id,
        conversation_id=m.conversation_id,
        sender_name=m.sender_name,
        sender_role=m.sender_role,
        content=m.content,
        is_self=m.is_self,
        created_at=m.created_at.strftime("%I:%M %p"),
    )


#Conversations

@router.get("/conversations", response_model=list[schemas.ConversationResponse])
def get_conversations(
    category: Optional[str] = Query(None, description="team | resident | alerts"),
    db: Session = Depends(get_db),
):
    """
    List all conversations, newest activity first.
    - No filter    → all (default 'All' view)
    - category=team      → Team tab
    - category=resident  → Resident tab
    - category=alerts    → Alerts tab
    """
    q = (
        db.query(models.Conversation)
        .order_by(models.Conversation.last_message_at.desc().nullslast())
    )
    if category:
        q = q.filter(models.Conversation.category == category)
    return [_fmt_conv(c) for c in q.all()]


@router.post("/conversations", response_model=schemas.ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(
    conv_in: schemas.ConversationCreate,
    db: Session = Depends(get_db),
):
    """Start a new conversation (New button)."""
    conv = models.Conversation(**conv_in.model_dump())
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _fmt_conv(conv)


@router.patch("/conversations/{conversation_id}/read", response_model=schemas.ConversationResponse)
def mark_conversation_read(conversation_id: int, db: Session = Depends(get_db)):
    """Mark all messages in a conversation as read (reset unread badge)."""
    conv = db.query(models.Conversation).filter(models.Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conv.unread_count = 0
    db.commit()
    db.refresh(conv)
    return _fmt_conv(conv)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    """Delete a conversation and all its messages."""
    conv = db.query(models.Conversation).filter(models.Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.query(models.Message).filter(models.Message.conversation_id == conversation_id).delete()
    db.delete(conv)
    db.commit()


#Messages 

@router.get("/conversations/{conversation_id}/messages", response_model=list[schemas.MessageResponse])
def get_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Fetch all messages in a conversation (chat history panel)."""
    conv = db.query(models.Conversation).filter(models.Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    msgs = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conversation_id)
        .order_by(models.Message.created_at.asc())
        .limit(limit)
        .all()
    )
    return [_fmt_msg(m) for m in msgs]


@router.post("/conversations/{conversation_id}/messages", response_model=schemas.MessageResponse, status_code=status.HTTP_201_CREATED)
def send_message(
    conversation_id: int,
    msg_in: schemas.MessageCreate,
    db: Session = Depends(get_db),
):
    """Send a message in a conversation (Send button)."""
    conv = db.query(models.Conversation).filter(models.Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    if msg_in.conversation_id != conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id mismatch.")

    msg = models.Message(**msg_in.model_dump())
    db.add(msg)

    # Update conversation preview
    conv.last_message = msg_in.content
    conv.last_message_at = datetime.utcnow()
    if msg_in.is_self == "false":
        conv.unread_count = (conv.unread_count or 0) + 1

    db.commit()
    db.refresh(msg)
    return _fmt_msg(msg)
