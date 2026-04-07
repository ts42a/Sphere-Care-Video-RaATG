import json
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.core.security import decode_access_token
from backend.ws.ws_manager import ws_manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001)
        return

    admin_id, actor_key = await ws_manager.connect(websocket, payload)

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
        ws_manager.disconnect(websocket, admin_id, actor_key)