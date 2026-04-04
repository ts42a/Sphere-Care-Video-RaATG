# backend/api/routers/ws.py
# NEW FILE — WebSocket endpoint, matches your exact router style

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from backend.ws.ws_manager import ws_manager
from backend.core.security import decode_access_token

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    try:
        payload = decode_access_token(token)
        admin_id = int(payload.get("admin_id") or 0)
    except Exception:
        await websocket.close(code=4001)
        return

    await ws_manager.connect(websocket, admin_id)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except Exception:
                continue

            msg_type = message.get("type")
            msg_payload = message.get("payload", {})

            if msg_type == "schedule.watch":
                doctor_id = msg_payload.get("doctorId")
                date = msg_payload.get("date")
                if doctor_id and date:
                    await ws_manager.watch_schedule(admin_id, doctor_id, date, websocket)

            elif msg_type == "schedule.unwatch":
                doctor_id = msg_payload.get("doctorId")
                date = msg_payload.get("date")
                if doctor_id and date:
                    ws_manager.unwatch_schedule(admin_id, doctor_id, date, websocket)

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, admin_id)