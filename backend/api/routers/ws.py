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

            # call signaling events
            elif msg_type == "call_join":
                call_id = str(msg_payload.get("call_id") or "")
                mode = msg_payload.get("mode") or "audio"
                local_user_id = msg_payload.get("local_user_id")
                remote_user_id = msg_payload.get("remote_user_id")

                if not call_id:
                    continue

                await ws_manager.join_call(call_id, websocket)

                # ack caller / room members
                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_joined",
                        "payload": {
                            "call_id": call_id,
                            "mode": mode,
                            "local_user_id": local_user_id,
                            "remote_user_id": remote_user_id,
                        },
                    },
                )

                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_connection_state",
                        "payload": {
                            "call_id": call_id,
                            "state": "connected",
                        },
                    },
                )

            elif msg_type == "call_leave":
                call_id = str(msg_payload.get("call_id") or "")
                local_user_id = msg_payload.get("local_user_id")

                if not call_id:
                    continue

                await ws_manager.broadcast_call_except(
                    call_id,
                    {
                        "type": "call_ended",
                        "payload": {
                            "call_id": call_id,
                            "local_user_id": local_user_id,
                        },
                    },
                    exclude=websocket,
                )

                ws_manager.leave_call(call_id, websocket)

            elif msg_type == "call_local_media_updated":
                call_id = str(msg_payload.get("call_id") or "")
                local_user_id = msg_payload.get("local_user_id")

                if not call_id:
                    continue

                await ws_manager.broadcast_call_except(
                    call_id,
                    {
                        "type": "call_remote_media_updated",
                        "payload": {
                            "call_id": call_id,
                            "local_user_id": local_user_id,
                            "audio_enabled": msg_payload.get("audio_enabled", True),
                            "video_enabled": msg_payload.get("video_enabled", True),
                            "camera_facing": msg_payload.get("camera_facing", "front"),
                        },
                    },
                    exclude=websocket,
                )

            elif msg_type == "call_connection_state":
                call_id = str(msg_payload.get("call_id") or "")
                state = msg_payload.get("state")

                if not call_id or not state:
                    continue

                await ws_manager.broadcast_call(
                    call_id,
                    {
                        "type": "call_connection_state",
                        "payload": {
                            "call_id": call_id,
                            "state": state,
                        },
                    },
                )

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, admin_id, actor_key)