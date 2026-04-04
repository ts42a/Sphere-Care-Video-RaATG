from typing import Dict, List, Tuple
from fastapi import WebSocket
import json


class WSManager:
    def __init__(self):
        self.connections: Dict[int, List[WebSocket]] = {}
        self.schedule_watchers: Dict[Tuple[int, str, str], List[WebSocket]] = {}

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

        for key in list(self.schedule_watchers.keys()):
            self.schedule_watchers[key] = [
                ws for ws in self.schedule_watchers[key] if ws != websocket
            ]
            if not self.schedule_watchers[key]:
                del self.schedule_watchers[key]

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

    async def watch_schedule(self, admin_id: int, doctor_id: str, date: str, websocket: WebSocket):
        key = (admin_id, doctor_id, date)
        if key not in self.schedule_watchers:
            self.schedule_watchers[key] = []
        if websocket not in self.schedule_watchers[key]:
            self.schedule_watchers[key].append(websocket)

    def unwatch_schedule(self, admin_id: int, doctor_id: str, date: str, websocket: WebSocket):
        key = (admin_id, doctor_id, date)
        if key not in self.schedule_watchers:
            return
        self.schedule_watchers[key] = [
            ws for ws in self.schedule_watchers[key] if ws != websocket
        ]
        if not self.schedule_watchers[key]:
            del self.schedule_watchers[key]

    async def broadcast_schedule_update(self, admin_id: int, doctor_id: str, date: str, data: dict):
        key = (admin_id, doctor_id, date)
        payload = json.dumps(data, default=str)
        watchers = self.schedule_watchers.get(key, [])
        dead = []

        for ws in watchers:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.unwatch_schedule(admin_id, doctor_id, date, ws)


ws_manager = WSManager()
