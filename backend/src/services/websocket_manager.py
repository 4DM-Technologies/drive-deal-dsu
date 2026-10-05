from collections import defaultdict

from fastapi import WebSocket

from src.utils.log_flow import log_flow


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.sequence = 0

    @log_flow(layer="service")
    async def connect(self, profile_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[profile_id].add(websocket)

    @log_flow(layer="service")
    def disconnect(self, profile_id: str, websocket: WebSocket) -> None:
        self.connections[profile_id].discard(websocket)
        if not self.connections[profile_id]:
            self.connections.pop(profile_id, None)

    @log_flow(layer="service")
    async def send(self, profile_id: str, frame: dict) -> None:
        self.sequence += 1
        payload = {"seq": self.sequence, **frame}
        for socket in list(self.connections.get(profile_id, set())):
            await socket.send_json(payload)


manager = WebSocketManager()
