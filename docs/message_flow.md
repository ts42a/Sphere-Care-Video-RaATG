# Messaging flow (simple overview)

How Sphere Care messaging works end-to-end: HTTP for data you keep, WebSocket for live updates.

---

## 1. Logging in

The user signs in and gets a **JWT** (access token). That token tells the server **who they are** (admin, staff, client) and which **organization (`admin_id`)** they belong to.

Without a valid token, message APIs and the socket will **reject** or **close** the connection.

---

## 2. Opening the message list

The app asks the server for **conversations**: something like “give me all chats I’m allowed to see.”

That’s a normal **HTTP GET** to the messages API (**not** the WebSocket).

The server only returns conversations where you’re a **participant** and the conversation belongs to your **center/admin**.

---

## 3. Opening a chat

The app loads **past messages** with another **HTTP GET** (messages for that conversation).

It may also mark the thread as **read** (**PATCH**) so unread counts drop.

---

## 4. Staying live (WebSocket)

Separately, the client opens a **WebSocket** to the same backend, with the **token in the query string**.

That connection is used for **live updates**: new messages, conversation list refreshes, schedule/booking events on the client app, and so on.

If the connection drops, the client **reconnects** and can **catch up** using a **delta API** (“messages newer than ID X”) so nothing obvious is missing.

---

## 5. Sending a message

1. User types and hits send.
2. The client sends **HTTP POST** “create message” with the text (and optionally a **client-generated id** so retries don’t create duplicates).
3. The server checks you’re **allowed** in that conversation, applies a **rate limit**, then **saves the message** in the database.
4. It creates **delivery receipt** rows for other participants (for tracking delivered/read).
5. Instead of only pushing on the socket immediately, it writes an **outbox** row: “fan this message out to everyone who should see it.”
6. A small **processor** sends those outbox jobs over the WebSocket to the right users (and **retries** if needed).
7. The server also notifies others that the **conversation list** changed (e.g. preview text), often via the same socket layer.

**So:** **HTTP = source of truth for sending**; **WebSocket = how others (and sometimes you) hear about it in real time.**

---

## 6. Receiving a message

When someone else sends a message, your WebSocket gets a **`new_message`** event with the payload (including nested `message` details in the newer shape).

The UI **merges** that into the thread and **dedupes** by message id so you don’t show the same line twice.

The client can send a **`message.receipt`** over the socket (“delivered”) so the backend can update receipt timestamps.

---

## 7. Staff web vs mobile app

**Same backend** (same REST + same `/ws` idea).

Staff pages use **fetch** + their own socket helper; the Expo app uses **shared TypeScript helpers** (API + `wsClient`), but the idea is the same: **REST to load/send**, **WebSocket for live updates**.

---

## One-line summary

You load history and lists over **normal HTTP**; you send new messages over **HTTP** so they’re safely stored; the server then pushes updates to everyone’s **WebSocket** (with **outbox + retries**), and clients can catch up after disconnects with **delta fetches**.


## Where messages are saved in the database
Sphere Care uses **one PostgreSQL database** (`DATABASE_URL` in backend config). Chat content is stored in SQL, not in the WebSocket layer.
| Table | What it stores |
|--------|----------------|
| **`messages`** | One row per message. The **body** is **`content`**. Also `conversation_id`, `admin_id`, sender fields, `message_type`, optional `client_message_id`, `fanout_event_id`, timestamps. |
| **`conversations`** | One row per thread (name, category, last preview, etc.). |
| **`conversation_participants`** | Who is in each thread; access and read state. |
| **`message_delivery_receipts`** | Optional per-recipient **delivered/read** timestamps for a `messages.id` and a participant row. |
| **`message_outbox`** | Queue for **WebSocket fan-out** (JSON payload), not a second copy of the chat text. |




## Deomo Class
class Message(Base):
    __tablename__ = "messages"

    id = Column(BigInteger, primary_key=True, index=True)
    admin_id = Column(BigInteger, nullable=False, index=True)
    conversation_id = Column(BigInteger, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id = Column(BigInteger, nullable=True, index=True)
    sender_participant_type = Column(String(20), nullable=False, default="user")
    sender_name = Column(String(255), nullable=False)
    sender_role = Column(String(80), nullable=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(30), nullable=False, default="text")
    is_self = Column(Boolean, nullable=False, default=False)
    client_message_id = Column(String(64), nullable=True, index=True)
    fanout_event_id = Column(String(40), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    conversation = relationship("Conversation", back_populates="messages")