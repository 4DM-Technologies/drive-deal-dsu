from uuid import uuid4

from fastapi.testclient import TestClient

from main import app


def login(client: TestClient, email: str) -> tuple[str, dict[str, str]]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return token, {"Authorization": f"Bearer {token}"}


def test_a_new_message_is_pushed_live_to_the_other_party() -> None:
    with TestClient(app) as client:
        buyer_token, _ = login(client, "rahul@drivedeal.demo")
        _, dealer = login(client, "naveen@naveemotors.demo")
        open_chat = next(
            row
            for row in client.get("/api/v1/quotes", headers=dealer).json()
            if row["status"] == "accepted" or row["chat_request_status"] == "accepted"
        )
        quote_id = open_chat["id"]

        with client.websocket_connect(f"/api/v1/ws?token={buyer_token}") as buyer_socket:
            assert buyer_socket.receive_json()["type"] == "connection"
            sent = client.post(
                f"/api/v1/chats/{quote_id}", headers=dealer, json={"id": str(uuid4()), "message": "How is it"}
            )
            assert sent.status_code == 201, sent.text

            frame = buyer_socket.receive_json()
            # Only a "this conversation changed" signal: the content is fetched through the normal, checked API.
            assert (frame["type"], frame["quote_id"], frame["event"]) == ("chat.updated", quote_id, "message_sent")
            assert "message" not in frame and "body" not in frame

            refreshed = client.get(f"/api/v1/chats/{quote_id}", headers=dealer).json()
            assert any(row.get("message") == "How is it" or row.get("body") == "How is it" for row in refreshed)


def test_a_dealer_outside_the_conversation_gets_nothing() -> None:
    with TestClient(app) as client:
        _, dealer = login(client, "naveen@naveemotors.demo")
        outsider_token, _ = login(client, "elena@lonestar.demo")
        quote_id = next(
            row
            for row in client.get("/api/v1/quotes", headers=dealer).json()
            if row["status"] == "accepted" or row["chat_request_status"] == "accepted"
        )["id"]

        with client.websocket_connect(f"/api/v1/ws?token={outsider_token}") as outsider_socket:
            assert outsider_socket.receive_json()["type"] == "connection"
            assert (
                client.post(
                    f"/api/v1/chats/{quote_id}", headers=dealer, json={"id": str(uuid4()), "message": "Private"}
                ).status_code
                == 201
            )
            outsider_socket.send_json({"type": "ping"})
            # The next frame is the reply to the ping, so no chat event was queued for this dealer.
            assert outsider_socket.receive_json()["type"] == "heartbeat"


def test_the_socket_refuses_a_missing_or_bad_token() -> None:
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/api/v1/ws?token=not-a-token") as socket:
                socket.receive_json()
            raise AssertionError("The socket should have been closed")
        except Exception as exc:  # noqa: BLE001 - Starlette raises WebSocketDisconnect on the close
            assert getattr(exc, "code", None) == 4401
