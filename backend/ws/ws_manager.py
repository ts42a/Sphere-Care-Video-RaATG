import json
from typing import Dict, List, Optional, Set, Tuple

from fastapi import WebSocket


class WSManager:
    def __init__(self):
        self.connections: Dict[int, List[WebSocket]] = {}
        self.actor_connections: Dict[str, List[WebSocket]] = {}
        self.socket_index: Dict[int, tuple[int, Optional[str]]] = {}
        self.schedule_watchers: Dict[Tuple[int, str, str], List[WebSocket]] = {}

        # call rooms
        self.call_watchers: Dict[str, List[WebSocket]] = {}

    def _actor_key_from_payload(self, payload: dict) -> Optional[str]:
        role = payload.get("role")
        user_id = payload.get("user_id")

        if role == "admin" and user_id:
            return f"admin:{int(user_id)}"
        if user_id:
            return f"user:{int(user_id)}"
        return None

    async def connect(self, websocket: WebSocket, auth_payload: dict):
        await websocket.accept()
        admin_id = int(auth_payload.get("admin_id") or 0)
        actor_key = self._actor_key_from_payload(auth_payload)

        if admin_id not in self.connections:
            self.connections[admin_id] = []
        self.connections[admin_id].append(websocket)

        if actor_key:
            if actor_key not in self.actor_connections:
                self.actor_connections[actor_key] = []
            self.actor_connections[actor_key].append(websocket)

        self.socket_index[id(websocket)] = (admin_id, actor_key)
        return admin_id, actor_key

    def disconnect(
        self,
        websocket: WebSocket,
        admin_id: Optional[int] = None,
        actor_key: Optional[str] = None,
    ):
        if admin_id is None or actor_key is None:
          admin_id, actor_key = self.socket_index.pop(
              id(websocket), (admin_id or 0, actor_key)
          )
        else:
          self.socket_index.pop(id(websocket), None)

        if admin_id in self.connections:
            self.connections[admin_id] = [
                ws for ws in self.connections[admin_id] if ws != websocket
            ]
            if not self.connections[admin_id]:
                del self.connections[admin_id]

        if actor_key and actor_key in self.actor_connections:
            self.actor_connections[actor_key] = [
                ws for ws in self.actor_connections[actor_key] if ws != websocket
            ]
            if not self.actor_connections[actor_key]:
                del self.actor_connections[actor_key]

        for key in list(self.schedule_watchers.keys()):
            self.schedule_watchers[key] = [
                ws for ws in self.schedule_watchers[key] if ws != websocket
            ]
            if not self.schedule_watchers[key]:
                del self.schedule_watchers[key]

        for call_id in list(self.call_watchers.keys()):
            self.call_watchers[call_id] = [
                ws for ws in self.call_watchers[call_id] if ws != websocket
            ]
            if not self.call_watchers[call_id]:
                del self.call_watchers[call_id]

    async def _broadcast_to_sockets(self, sockets: List[WebSocket], data: dict):
        payload = json.dumps(data, default=str)
        dead: List[WebSocket] = []

        for ws in list(sockets):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)

    async def send_to_socket(self, websocket: WebSocket, data: dict):
        await self._broadcast_to_sockets([websocket], data)

    async def broadcast(self, admin_id: int, data: dict):
        sockets = self.connections.get(admin_id, [])
        if not sockets:
            return
        await self._broadcast_to_sockets(sockets, data)

    async def broadcast_actor(self, actor_key: str, data: dict):
        sockets = self.actor_connections.get(actor_key, [])
        if not sockets:
            return
        await self._broadcast_to_sockets(sockets, data)

    async def broadcast_many(self, deliveries: dict[str, dict]):
        sent_to_socket_ids: Set[int] = set()

        for actor_key, data in deliveries.items():
            sockets = self.actor_connections.get(actor_key, [])
            unique_sockets = [ws for ws in sockets if id(ws) not in sent_to_socket_ids]
            if not unique_sockets:
                continue

            await self._broadcast_to_sockets(unique_sockets, data)
            sent_to_socket_ids.update(id(ws) for ws in unique_sockets)

    async def watch_schedule(
        self, admin_id: int, doctor_id: str, date: str, websocket: WebSocket
    ):
        key = (admin_id, doctor_id, date)
        if key not in self.schedule_watchers:
            self.schedule_watchers[key] = []
        if websocket not in self.schedule_watchers[key]:
            self.schedule_watchers[key].append(websocket)

    def unwatch_schedule(
        self, admin_id: int, doctor_id: str, date: str, websocket: WebSocket
    ):
        key = (admin_id, doctor_id, date)
        if key not in self.schedule_watchers:
            return

        self.schedule_watchers[key] = [
            ws for ws in self.schedule_watchers[key] if ws != websocket
        ]
        if not self.schedule_watchers[key]:
            del self.schedule_watchers[key]

    async def broadcast_schedule_update(
        self, admin_id: int, doctor_id: str, date: str, data: dict
    ):
        key = (admin_id, doctor_id, date)
        watchers = self.schedule_watchers.get(key, [])
        if not watchers:
            return
        await self._broadcast_to_sockets(list(watchers), data)

    # call room support
    async def join_call(self, call_id: str, websocket: WebSocket):
        if call_id not in self.call_watchers:
            self.call_watchers[call_id] = []

        if websocket not in self.call_watchers[call_id]:
            self.call_watchers[call_id].append(websocket)

    def leave_call(self, call_id: str, websocket: WebSocket):
        if call_id not in self.call_watchers:
            return

        self.call_watchers[call_id] = [
            ws for ws in self.call_watchers[call_id] if ws != websocket
        ]
        if not self.call_watchers[call_id]:
            del self.call_watchers[call_id]

    async def broadcast_call(self, call_id: str, data: dict):
        watchers = self.call_watchers.get(call_id, [])
        if not watchers:
            return
        await self._broadcast_to_sockets(list(watchers), data)

    async def broadcast_call_except(self, call_id: str, data: dict, exclude: WebSocket):
        watchers = self.call_watchers.get(call_id, [])
        if not watchers:
            return

        filtered = [ws for ws in watchers if ws != exclude]
        if not filtered:
            return

        await self._broadcast_to_sockets(filtered, data)


ws_manager = WSManager()
