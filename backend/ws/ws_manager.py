# backend/ws/ws_manager.py
# NEW FILE — also create an empty backend/ws/__init__.py

from typing import Dict, List
from fastapi import WebSocket
import json


class WSManager:
    def __init__(self):
        self.connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, admin_id: int):
        await websocket.accept()
        if admin_id not in self.connections:
            self.connections[admin_id] = []
        self.connections[admin_id].append(websocket)

    def disconnect(self, websocket: WebSocket, admin_id: int):
        if admin_id in self.connections:
            self.connections[admin_id] = [
                ws for ws in self.connections[admin_id] if ws != websocket
            ]

    async def broadcast(self, admin_id: int, data: dict):
        if admin_id not in self.connections:
            return
        payload = json.dumps(data, default=str)
        dead = []
        for ws in self.connections[admin_id]:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections[admin_id].remove(ws)


ws_manager = WSManager()
