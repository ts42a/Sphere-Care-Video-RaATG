from __future__ import annotations

import json
from collections import defaultdict
from typing import DefaultDict, List

from fastapi import WebSocket


class AiExplainerStreamHub:
    def __init__(self) -> None:
        self._watchers: DefaultDict[str, List[WebSocket]] = defaultdict(list)

    async def subscribe(self, camera_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if websocket not in self._watchers[camera_id]:
            self._watchers[camera_id].append(websocket)

    def unsubscribe(self, camera_id: str, websocket: WebSocket) -> None:
        sockets = self._watchers.get(camera_id, [])
        if not sockets:
            return
        self._watchers[camera_id] = [ws for ws in sockets if ws != websocket]
        if not self._watchers[camera_id]:
            del self._watchers[camera_id]

    async def publish(self, camera_id: str, payload: dict) -> None:
        sockets = list(self._watchers.get(camera_id, []))
        if not sockets:
            return
        data = json.dumps(payload, default=str)
        dead: List[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(camera_id, ws)


ai_explainer_stream_hub = AiExplainerStreamHub()
