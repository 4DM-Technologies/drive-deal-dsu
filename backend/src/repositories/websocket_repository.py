import asyncio
import json
from collections.abc import Callable
from contextlib import suppress

import asyncpg
from sqlalchemy.engine import make_url

from src.utils.log_flow import log_flow
from src.utils.logger import logger

NotificationHandler = Callable[[str, str, dict], None]


class WebSocketNotificationRepository:
    """PostgreSQL LISTEN/NOTIFY transport for cross-task WebSocket updates."""

    CHANNEL = "drivedeal_chat_updates"

    def __init__(self) -> None:
        self._listener: asyncpg.Connection | None = None
        self._listener_task: asyncio.Task | None = None
        self._stopping = False
        self._listener_ready = asyncio.Event()
        self._publish_lock = asyncio.Lock()
        self._handler: NotificationHandler | None = None

    @log_flow(layer="repository")
    async def start(self, database_url: str, handler: NotificationHandler) -> None:
        if not database_url.startswith(("postgresql+asyncpg://", "postgresql://", "postgres://")):
            logger.info("websocket_cross_task_delivery_disabled", reason="database_is_not_postgresql")
            return
        if self._listener_task and not self._listener_task.done():
            return
        self._handler = handler
        self._stopping = False
        self._listener_ready.clear()
        self._listener_task = asyncio.create_task(self._listen_forever(database_url))
        try:
            await asyncio.wait_for(self._listener_ready.wait(), timeout=5)
        except TimeoutError:
            logger.warning("websocket_cross_task_listener_start_timeout")

    @log_flow(layer="repository")
    async def stop(self) -> None:
        self._stopping = True
        if self._listener_task:
            self._listener_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._listener and not self._listener.is_closed():
            await self._listener.close()
        self._listener = None
        self._handler = None

    @property
    def is_ready(self) -> bool:
        return self._listener is not None and not self._listener.is_closed() and self._listener_ready.is_set()

    def _connect_kwargs(self, database_url: str) -> dict:
        url = make_url(database_url)
        query = dict(url.query)
        kwargs = {
            "host": url.host,
            "port": url.port or 5432,
            "user": url.username,
            "password": url.password,
            "database": url.database,
        }
        sslmode = query.get("sslmode") or query.get("ssl")
        if sslmode:
            kwargs["ssl"] = sslmode
        return kwargs

    async def _listen_forever(self, database_url: str) -> None:
        while not self._stopping:
            try:
                self._listener = await asyncpg.connect(**self._connect_kwargs(database_url))
                await self._listener.add_listener(self.CHANNEL, self._on_notification)
                terminated = asyncio.Event()
                self._listener.add_termination_listener(lambda _connection, event=terminated: event.set())
                self._listener_ready.set()
                logger.info("websocket_cross_task_listener_ready", channel=self.CHANNEL)
                await terminated.wait()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - reconnect while local WebSockets stay available
                logger.warning("websocket_cross_task_listener_failed", error=str(exc))
            finally:
                self._listener_ready.clear()
                if self._listener and not self._listener.is_closed():
                    with suppress(Exception):
                        await self._listener.close()
                self._listener = None
            if not self._stopping:
                await asyncio.sleep(2)

    def _on_notification(self, _connection, _pid: int, _channel: str, payload: str) -> None:
        try:
            message = json.loads(payload)
            handler = self._handler
            if handler is not None:
                handler(message["origin"], message["profile_id"], message["frame"])
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("websocket_notification_invalid", error=str(exc))

    @log_flow(layer="repository")
    async def publish(self, origin: str, profile_id: str, frame: dict) -> None:
        if not self.is_ready:
            return
        notification = json.dumps({"origin": origin, "profile_id": profile_id, "frame": frame})
        try:
            async with self._publish_lock:
                if self.is_ready:
                    await self._listener.execute("SELECT pg_notify($1, $2)", self.CHANNEL, notification)
        except Exception as exc:  # noqa: BLE001 - live delivery is best-effort
            logger.warning("websocket_cross_task_publish_failed", profile_id=profile_id, error=str(exc))
