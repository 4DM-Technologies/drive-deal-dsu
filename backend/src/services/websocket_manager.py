from collections import defaultdict

from fastapi import WebSocket

from src.utils.log_flow import log_flow
from src.utils.logger import logger


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
            try:
                await socket.send_json(payload)
            except Exception as exc:  # noqa: BLE001 - one dead tab must not stop the others or the caller
                logger.warning("websocket_send_failed", profile_id=profile_id, error=str(exc))
                self.disconnect(profile_id, socket)


manager = WebSocketManager()
