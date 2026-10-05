from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.auth.security import decode_token
from src.services.websocket_manager import manager
from src.utils.log_flow import log_flow

router = APIRouter(tags=["Realtime"])


@router.websocket("/ws")
@log_flow(layer="route")
async def websocket_endpoint(websocket: WebSocket, token: str):
    try:
        payload = decode_token(token)
    except jwt.InvalidTokenError:
        await websocket.close(code=4401)
        return
    profile_id = payload["sub"]
    await manager.connect(profile_id, websocket)
    try:
        await websocket.send_json({"type": "connection", "state": "live"})
        while True:
            frame = await websocket.receive_json()
            if frame.get("type") == "ping":
                await websocket.send_json(
                    {"type": "heartbeat", "seq": manager.sequence, "at": datetime.now(UTC).isoformat()}
                )
            elif frame.get("type") == "chat.send":
                await websocket.send_json({"type": "ack", "id": frame.get("id"), "status": 201})
    except WebSocketDisconnect:
        manager.disconnect(profile_id, websocket)
