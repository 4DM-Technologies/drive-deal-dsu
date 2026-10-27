import asyncio
import uuid
from collections import defaultdict

from fastapi import WebSocket

from src.repositories.websocket_repository import WebSocketNotificationRepository
from src.utils.log_flow import log_flow
from src.utils.logger import logger


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.sequence = 0
        self.instance_id = str(uuid.uuid4())
        self._notification_repository = WebSocketNotificationRepository()

    @log_flow(layer="service")
    async def start(self, database_url: str) -> None:
        """Start the shared notification transport used by this task's local sockets."""
        await self._notification_repository.start(database_url, self._on_notification)

    @log_flow(layer="service")
    async def stop(self) -> None:
        await self._notification_repository.stop()

    def _on_notification(self, origin: str, profile_id: str, frame: dict) -> None:
        if origin != self.instance_id:
            self._send_local(profile_id, frame)

    def _send_local(self, profile_id: str, payload: dict) -> None:
        """Schedule writes to this task's sockets from the asyncpg notification callback."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._send_local_async(profile_id, payload))
        except RuntimeError:
            logger.warning("websocket_notification_without_event_loop", profile_id=profile_id)

    async def _send_local_async(self, profile_id: str, payload: dict) -> None:
        for socket in list(self.connections.get(profile_id, set())):
            try:
                await socket.send_json(payload)
            except Exception as exc:  # noqa: BLE001
                logger.warning("websocket_send_failed", profile_id=profile_id, error=str(exc))
                self.disconnect(profile_id, socket)

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
        # Deliver immediately to sockets on this task, then use PostgreSQL to reach
        # sockets owned by other tasks. The origin id prevents duplicate local delivery.
        await self._send_local_async(profile_id, payload)
        await self._notification_repository.publish(self.instance_id, profile_id, payload)


manager = WebSocketManager()
