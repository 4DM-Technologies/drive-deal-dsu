from collections import defaultdict

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.sequence = 0

    async def connect(self, profile_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[profile_id].add(websocket)

    def disconnect(self, profile_id: str, websocket: WebSocket) -> None:
        self.connections[profile_id].discard(websocket)
        if not self.connections[profile_id]:
            self.connections.pop(profile_id, None)

    async def send(self, profile_id: str, frame: dict) -> None:
        self.sequence += 1
        payload = {"seq": self.sequence, **frame}
        for socket in list(self.connections.get(profile_id, set())):
            await socket.send_json(payload)


manager = WebSocketManager()
