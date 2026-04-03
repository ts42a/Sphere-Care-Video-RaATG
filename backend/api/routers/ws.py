# backend/api/routers/ws.py
# NEW FILE — WebSocket endpoint, matches your exact router style

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from backend.ws.ws_manager import ws_manager
from backend.core.security import decode_access_token

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    """
    Frontend connects to:  ws://host/ws?token=<access_token>
    Token is the same JWT stored in sessionStorage as 'access_token'.
    """
    try:
        payload = decode_access_token(token)
        # Change "admin_id" below if your JWT uses a different key e.g. "sub" or "id"
        admin_id = int(payload.get("admin_id") or payload.get("sub") or payload.get("id"))
    except Exception:
        await websocket.close(code=4001)
        return

    await ws_manager.connect(websocket, admin_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, admin_id)