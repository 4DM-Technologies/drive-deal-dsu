from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from main import app
from src.services.storage.s3_storage import S3Storage
from src.settings import get_settings
from tests.demo_data import IDS


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_and_reference_data() -> None:
    with TestClient(app) as client:
        assert client.get("/api/v1/").json()["name"] == "Deal&Drive API"
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert client.get("/api/v1/health/ready").status_code == 200
        assert len(client.get("/api/v1/reference/states").json()) == 51
        assert len(client.get("/api/v1/reference/brands").json()) >= 12
        assert client.get("/api/v1/reference/states/TX/tax-rate").json()["rate"] == "0.06250"


def test_auth_profile_and_preferences() -> None:
    with TestClient(app) as client:
        assert (
            client.post("/api/v1/auth/login", json={"email": "rahul@drivedeal.demo", "password": "wrong"}).status_code
            == 401
        )
        headers = login(client, "rahul@drivedeal.demo")
        assert client.get("/api/v1/auth/me", headers=headers).json()["role"] == "buyer"
        updated = client.patch("/api/v1/profiles/me", headers=headers, json={"phone": "+14695550142"})
        assert updated.status_code == 200
        preferences = client.put(
            "/api/v1/profiles/me/preferences",
            headers=headers,
            json={"brand_id": IDS["ford"], "body_type": "SUV", "budget_max": 72000, "must_have_features": ["4WD"]},
        )
        assert preferences.status_code == 200
        assert client.get("/api/v1/profiles/me/preferences", headers=headers).json()["body_type"] == "SUV"
        assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204


def test_buyer_marketplace_and_serra() -> None:
    with TestClient(app) as client:
        headers = login(client, "rahul@drivedeal.demo")
        requests = client.get("/api/v1/requests", headers=headers)
        assert requests.status_code == 200 and len(requests.json()) >= 4
        detail = client.get(f"/api/v1/requests/{IDS['bronco']}", headers=headers)
        assert detail.json()["model"] == "Bronco"
        quotes = client.get(f"/api/v1/requests/{IDS['bronco']}/quotes", headers=headers)
        assert len(quotes.json()) == 3
        assert client.get(f"/api/v1/quotes/{IDS['q1']}/dealer-contact", headers=headers).status_code == 403
        compare = client.post(
            "/api/v1/ai/compare", headers=headers, json={"quote_ids": [IDS["q1"], quotes.json()[1]["id"]]}
        )
        assert compare.status_code == 200
        assert len(compare.json()["rows"]) == 2
        request_compare = client.post(
            "/api/v1/ai/compare",
            headers=headers,
            json={"request_ids": [IDS["bronco"], IDS["jazz"]]},
        )
        assert request_compare.status_code == 200
        assert len(request_compare.json()["rows"]) == 2
        chat = client.post(
            "/api/v1/ai/chat",
            headers=headers,
            json={
                "message": "I want a Ford Bronco under $70000 within 2 weeks",
                "agent": "sera-agent",
                "quote_ids": [],
            },
        )
        assert chat.status_code == 200
        assert "event: done" in chat.text
        request_preview = client.post(
            "/api/v1/ai/chat",
            headers=headers,
            json={"message": "Build my car request", "agent": "sera-agent", "quote_ids": []},
        )
        assert '"kind": "requestPreview"' in request_preview.text
        compare_stream = client.post(
            "/api/v1/ai/chat",
            headers=headers,
            json={
                "message": "Compare these requests",
                "agent": "compare-agent",
                "request_ids": [IDS["bronco"], IDS["jazz"]],
            },
        )
        assert '"kind": "compare"' in compare_stream.text
        assert client.get("/api/v1/ai/threads", headers=headers).status_code == 200
        assert client.get("/api/v1/ai/threads/missing-thread", headers=headers).status_code == 404


def test_dealer_inventory_feed_and_quote() -> None:
    with TestClient(app) as client:
        headers = login(client, "naveen@naveemotors.demo")
        assert len(client.get("/api/v1/feed/requests", headers=headers).json()) >= 1
        cars = client.get("/api/v1/cars", headers=headers)
        assert cars.status_code == 200 and len(cars.json()) >= 10
        car_id = cars.json()[0]["id"]
        assert client.get(f"/api/v1/cars/{car_id}", headers=headers).status_code == 200
        assert (
            client.patch(f"/api/v1/cars/{car_id}/status", headers=headers, json={"status": "reserved"}).status_code
            == 200
        )
        assert (
            client.patch(f"/api/v1/cars/{car_id}/status", headers=headers, json={"status": "available"}).status_code
            == 200
        )
        assert client.get("/api/v1/chats/requests", headers=headers).status_code == 200


def test_dealer_can_decline_chat_request_with_reason() -> None:
    with TestClient(app) as client:
        headers = login(client, "elena@lonestar.demo")
        pending = client.get("/api/v1/chats/requests", headers=headers)
        assert pending.status_code == 200 and pending.json()
        declined = client.post(
            f"/api/v1/chats/requests/{pending.json()[0]['id']}/decline",
            headers=headers,
            json={"reason": "The requested delivery slot is no longer available."},
        )
        assert declined.status_code == 200
        assert declined.json()["chat_request_status"] == "declined"


def test_support_workflows_and_error_envelope() -> None:
    with TestClient(app) as client:
        support_headers = login(client, "maya@drivedeal.demo")
        assert client.get("/api/v1/support/queue/tickets", headers=support_headers).status_code == 200
        verifications = client.get("/api/v1/verifications", headers=support_headers)
        assert verifications.status_code == 200 and len(verifications.json()) >= 3
        rejectable = next(item for item in verifications.json() if item["status"] == "pending")
        rejected = client.post(
            f"/api/v1/verifications/{rejectable['id']}/reject",
            headers=support_headers,
            json={"reason": "Submitted evidence could not be validated."},
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"
        another_pending = next(
            item for item in verifications.json() if item["status"] == "pending" and item["id"] != rejectable["id"]
        )
        denied_verification = client.post(
            f"/api/v1/verifications/{another_pending['id']}/deny",
            headers=support_headers,
            json={"reason": "The submitted record does not match the applicant."},
        )
        assert denied_verification.status_code == 200
        assert denied_verification.json()["status"] == "denied"
        assert client.get("/api/v1/members", headers=support_headers).status_code == 200
        denied = client.get("/api/v1/requests", headers=support_headers)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_support_admin_read_only_workspace_views_and_enriched_reviews() -> None:
    with TestClient(app) as client:
        support = login(client, "maya@drivedeal.demo")
        administrator = login(client, "priya@drivedeal.demo")

        assert client.get("/api/v1/support/workspaces/buyer/requests", headers=support).status_code == 403
        assert (
            client.get("/api/v1/support/workspaces/not-a-workspace/requests", headers=administrator).status_code == 404
        )

        requests = client.get("/api/v1/support/workspaces/buyer/requests", headers=administrator)
        quotes = client.get("/api/v1/support/workspaces/dealer/quotes", headers=administrator)
        assert requests.status_code == 200 and requests.json()
        assert quotes.status_code == 200 and quotes.json()
        quote_id = quotes.json()[0]["id"]
        assert (
            client.post(
                f"/api/v1/chats/{quote_id}",
                headers=administrator,
                json={"id": str(uuid4()), "message": "This must remain read-only."},
            ).status_code
            == 403
        )
        assert (
            client.patch(
                f"/api/v1/deals/{quote_id}/status",
                headers=administrator,
                json={"status": "dispatch"},
            ).status_code
            == 403
        )

        reviews = client.get("/api/v1/verifications", headers=administrator)
        assert reviews.status_code == 200 and reviews.json()
        review = reviews.json()[0]
        assert {"profile_name", "email", "phone", "role", "proof_docs", "notes"} <= review.keys()


def test_complete_request_quote_chat_and_deal_flow() -> None:
    with TestClient(app) as client:
        buyer = login(client, "rahul@drivedeal.demo")
        request_payload = {
            "brand_id": IDS["ford"],
            "buyer_area_state_id": IDS["tx"],
            "model": "Explorer",
            "body_type": "SUV",
            "year_min": 2025,
            "year_max": 2026,
            "budget_max": "62000",
            "target_otd_price": "60000",
            "buyer_area": "Frisco, TX",
            "search_radius_miles": 50,
            "timeline": "Within 2 weeks",
            "condition": "new",
            "must_haves": ["AWD"],
            "request_expire": (datetime.now(UTC) + timedelta(days=10)).isoformat(),
            "status": "draft",
        }
        created_request = client.post("/api/v1/requests", headers=buyer, json=request_payload)
        assert created_request.status_code == 201, created_request.text
        request_id = created_request.json()["id"]
        assert client.post(f"/api/v1/requests/{request_id}/publish", headers=buyer).json()["status"] == "open"

        dealer = login(client, "naveen@naveemotors.demo")
        first_view = client.get(f"/api/v1/feed/requests/{request_id}", headers=dealer)
        repeated_view = client.get(f"/api/v1/feed/requests/{request_id}", headers=dealer)
        assert first_view.status_code == 200
        assert repeated_view.json()["view_count"] == 1
        second_dealer = login(client, "elena@lonestar.demo")
        assert client.get(f"/api/v1/feed/requests/{request_id}", headers=second_dealer).json()["view_count"] == 2
        assert client.get(f"/api/v1/requests/{request_id}", headers=buyer).json()["view_count"] == 2
        quote = client.post(
            "/api/v1/quotes",
            headers=dealer,
            json={
                "buyer_request_id": request_id,
                "vehicle_price": "56000",
                "doc_fee": "500",
                "sales_tax": "3500",
                "title_reg": "225",
                "trade_in_credit": "0",
                "message": "Available now",
                "expires_at": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
            },
        )
        assert quote.status_code == 201, quote.text
        quote_id = quote.json()["id"]
        assert client.get(f"/api/v1/requests/{request_id}", headers=buyer).json()["quote_count"] == 1
        assert (
            client.patch(
                f"/api/v1/quotes/{quote_id}/revise", headers=dealer, json={"vehicle_price": "55500"}
            ).status_code
            == 200
        )

        assert (
            client.post(
                f"/api/v1/chats/{quote_id}/request-access", headers=buyer, json={"message": "Can we discuss pickup?"}
            ).status_code
            == 200
        )
        assert client.post(f"/api/v1/chats/requests/{quote_id}/accept", headers=dealer).status_code == 200
        assert (
            client.post(
                f"/api/v1/chats/{quote_id}", headers=buyer, json={"id": str(uuid4()), "message": "Thank you"}
            ).status_code
            == 201
        )
        buyer_messages = client.get(f"/api/v1/chats/{quote_id}", headers=dealer).json()
        assert len(buyer_messages) == 2
        assert all(message["sender_name"] == "Rahul Sharma" for message in buyer_messages)
        dealer_message = client.post(
            f"/api/v1/chats/{quote_id}", headers=dealer, json={"id": str(uuid4()), "message": "Pickup is available."}
        )
        assert dealer_message.status_code == 201
        assert dealer_message.json()["sender_name"] == "Navee Motors"
        assert client.post(f"/api/v1/chats/{quote_id}/read", headers=dealer).status_code == 200
        assert client.get(f"/api/v1/quotes/{quote_id}/dealer-contact", headers=buyer).status_code == 200

        accepted = client.post(f"/api/v1/quotes/{quote_id}/accept", headers=buyer)
        assert accepted.status_code == 200 and accepted.json()["deal_status"] == "paperwork_going_on"
        assert (
            client.patch(
                f"/api/v1/deals/{quote_id}/status", headers=dealer, json={"status": "funds_arrived"}
            ).status_code
            == 200
        )
        upload = client.post(
            "/api/v1/documents/presign",
            headers=dealer,
            json={
                "filename": "buyer-order.pdf",
                "content_type": "application/pdf",
                "quote_id": quote_id,
                "document_type": "quote_document",
                "size_bytes": 2048,
            },
        )
        assert upload.status_code == 200
        document_id = str(uuid4())
        confirmed = client.post(
            f"/api/v1/documents/{document_id}/confirm",
            headers=dealer,
            json={"quote_id": quote_id, "document_type": "quote_document", "object_key": upload.json()["key"]},
        )
        assert confirmed.status_code == 200
        documents = client.get(f"/api/v1/documents/{quote_id}", headers=buyer).json()
        assert len(documents) == 1
        assert documents[0]["file_name"] == "buyer-order.pdf"
        duplicate = client.post(
            "/api/v1/documents/presign",
            headers=dealer,
            json={
                "filename": "duplicate.pdf",
                "content_type": "application/pdf",
                "quote_id": quote_id,
                "document_type": "quote_document",
                "size_bytes": 1024,
            },
        )
        assert duplicate.status_code == 409
        assert client.delete(f"/api/v1/documents/{quote_id}/{document_id}", headers=dealer).status_code == 204


def test_ticket_creation_update_and_password_reset_contract() -> None:
    with TestClient(app) as client:
        buyer = login(client, "adithyaa@drivedeal.demo")
        created = client.post(
            "/api/v1/support/tickets",
            headers=buyer,
            json={
                "issue_summary": "I need help understanding a quote",
                "issue_description": "The total shown on the request does not match the quote detail.",
                "issue_type": "incorrect_data",
                "page_context": "/requests/demo",
                "priority": "medium",
            },
        )
        assert created.status_code == 201
        assert created.json()["category"] == "customer"
        assert created.json()["issue_type"] == "incorrect_data"
        assert created.json()["page_context"] == "/requests/demo"
        ticket_id = created.json()["id"]
        assert client.get(f"/api/v1/support/tickets/{ticket_id}", headers=buyer).status_code == 200
        assert (
            client.patch(
                f"/api/v1/support/tickets/{ticket_id}", headers=buyer, json={"status": "closed", "note": "Resolved"}
            ).status_code
            == 200
        )
        dealer = login(client, "naveen@naveemotors.demo")
        dealer_ticket = client.post(
            "/api/v1/support/tickets",
            headers=dealer,
            json={
                "issue_summary": "Buyer feed is showing stale request data",
                "issue_type": "incorrect_data",
                "page_context": "/feed",
                "priority": "high",
            },
        )
        assert dealer_ticket.status_code == 201
        assert dealer_ticket.json()["category"] == "dealer"
        assert dealer_ticket.json()["ticket_id"].startswith("DS")
        assert client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"}).status_code == 202
        assert (
            client.post(
                "/api/v1/auth/reset-password",
                json={"email": "nobody@example.com", "reset_code": "invalid", "new_password": "new-password"},
            ).status_code
            == 400
        )


def test_signup_refresh_and_pending_account_flows() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        common = {
            "full_name": "Fresh Buyer",
            "email": f"buyer-{suffix}@example.com",
            "phone": "+12145550999",
            "password": "secure-demo-password",
            "state_id": IDS["tx"],
            "address": "Dallas, TX",
            "terms_accepted": True,
            "terms_version": "2026-09-30",
        }
        signup = client.post("/api/v1/auth/signup/buyer", json=common)
        assert signup.status_code == 201, signup.text
        tokens = signup.json()
        refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert refreshed.status_code == 200

        dealer = client.post(
            "/api/v1/auth/signup/dealer",
            json={
                **common,
                "email": f"dealer-{suffix}@example.com",
                "dealership_name": "Fresh Motors",
                "branch_name": "Dallas",
                "dealer_license": f"TX-{suffix}",
                "website": "https://fresh-motors.example",
                "supported_brand_ids": [IDS["ford"]],
            },
        )
        assert dealer.status_code == 202
        pending_login = client.post(
            "/api/v1/auth/login", json={"email": f"dealer-{suffix}@example.com", "password": "secure-demo-password"}
        )
        assert pending_login.status_code == 403

        support = client.post(
            "/api/v1/auth/signup/support",
            json={
                **common,
                "email": f"support-{suffix}@example.com",
                "extra_information": "Automotive support background",
            },
        )
        assert support.status_code == 202


def test_support_decision_and_inventory_crud() -> None:
    with TestClient(app) as client:
        support = login(client, "maya@drivedeal.demo")
        pending = next(
            item
            for item in client.get("/api/v1/verifications", headers=support).json()
            if item["status"] == "pending" and item["category"] == "dealer"
        )
        decision = client.post(
            f"/api/v1/verifications/{pending['id']}/approve",
            headers=support,
            json={"decision": "approved", "reason": "Documents and license verified"},
        )
        assert decision.status_code == 200

        dealer = login(client, "naveen@naveemotors.demo")
        payload = {
            "brand_id": IDS["ford"],
            "state_id": IDS["tx"],
            "title": "2026 Ford Explorer",
            "model": "Explorer",
            "model_year": 2026,
            "body_type": "SUV",
            "seating_capacity": 7,
            "condition": "new",
            "mileage": 9,
            "fuel": "Gasoline",
            "transmission": "Automatic",
            "price": "54500",
            "image_paths": [],
        }
        created = client.post("/api/v1/cars", headers=dealer, json=payload)
        assert created.status_code == 201, created.text
        car_id = created.json()["id"]
        updated = client.patch(f"/api/v1/cars/{car_id}", headers=dealer, json={**payload, "price": "53900"})
        assert updated.status_code == 200 and updated.json()["price"] == "53900.00"


def test_realtime_connection_and_acknowledgement() -> None:
    with TestClient(app) as client:
        auth = client.post("/api/v1/auth/login", json={"email": "rahul@drivedeal.demo", "password": "demo1234"}).json()
        with client.websocket_connect(f"/api/v1/ws?token={auth['access_token']}") as socket:
            assert socket.receive_json()["state"] == "live"
            socket.send_json({"type": "ping"})
            assert socket.receive_json()["type"] == "heartbeat"
            socket.send_json({"type": "chat.send", "id": "client-message-1"})
            acknowledgement = socket.receive_json()
            assert acknowledgement == {"type": "ack", "id": "client-message-1", "status": 201}
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/v1/ws?token=invalid") as socket:
                socket.receive_json()


def test_support_admin_can_provision_role_and_force_new_sign_in() -> None:
    with TestClient(app) as client:
        maya_login = client.post("/api/v1/auth/login", json={"email": "maya@drivedeal.demo", "password": "demo1234"})
        assert maya_login.status_code == 200
        support = {"Authorization": f"Bearer {maya_login.json()['access_token']}"}
        support_admin_login = client.post(
            "/api/v1/auth/login", json={"email": "priya@drivedeal.demo", "password": "demo1234"}
        )
        assert support_admin_login.status_code == 200
        support_admin = {"Authorization": f"Bearer {support_admin_login.json()['access_token']}"}
        assert client.get("/api/v1/auth/me", headers=support_admin).json()["role"] == "support-admin"
        members = client.get("/api/v1/members", headers=support_admin)
        assert members.status_code == 200
        maya = next(item for item in members.json() if item["email"] == "maya@drivedeal.demo")
        priya = next(item for item in members.json() if item["email"] == "priya@drivedeal.demo")
        member_detail = client.get(f"/api/v1/members/{maya['id']}", headers=support_admin)
        assert member_detail.status_code == 200
        assert member_detail.json()["email"] == "maya@drivedeal.demo"
        assert member_detail.json()["role"] == "support"
        assert member_detail.json()["is_active"] is True
        assert client.get(f"/api/v1/members/{uuid4()}", headers=support_admin).status_code == 404
        assert (
            client.patch(
                f"/api/v1/members/{priya['id']}/support-role",
                headers=support_admin,
                json={"role": "support"},
            ).status_code
            == 409
        )
        assert (
            client.patch(
                f"/api/v1/members/{uuid4()}/support-role",
                headers=support_admin,
                json={"role": "support-admin"},
            ).status_code
            == 404
        )
        denied = client.patch(
            f"/api/v1/members/{maya['id']}/support-role",
            headers=support,
            json={"role": "support-admin"},
        )
        assert denied.status_code == 403
        promoted = client.patch(
            f"/api/v1/members/{maya['id']}/support-role",
            headers=support_admin,
            json={"role": "support-admin"},
        )
        assert promoted.status_code == 200
        assert promoted.json() == {"profile_id": maya["id"], "role": "support-admin", "requires_sign_in": True}
        assert client.get("/api/v1/support/queue/tickets", headers=support).status_code == 401
        assert (
            client.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": maya_login.json()["refresh_token"]},
            ).status_code
            == 401
        )
        queue = client.get("/api/v1/support/queue/tickets", headers=support_admin).json()
        assert (
            client.patch(
                f"/api/v1/support/queue/tickets/{queue[0]['id']}",
                headers=support_admin,
                json={"status": "in_progress", "note": "Assigned during support-admin validation."},
            ).status_code
            == 200
        )
        assert client.get(f"/api/v1/support/tickets/{uuid4()}", headers=support_admin).status_code == 404

        admin = login(client, "alex@drivedeal.demo")
        alex = client.get("/api/v1/auth/me", headers=admin).json()
        assert client.post(f"/api/v1/members/{alex['id']}/suspend", headers=admin).status_code == 409
        assert client.post(f"/api/v1/members/{uuid4()}/suspend", headers=admin).status_code == 404
        suspended = client.post(f"/api/v1/members/{maya['id']}/suspend", headers=admin)
        assert suspended.status_code == 200
        assert suspended.json()["is_active"] is False


def test_s3_storage_creates_scoped_upload_and_download_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeS3:
        def generate_presigned_url(self, operation: str, **_: object) -> str:
            return f"https://s3.example/{operation}"

    # S3Storage() reads the cached settings singleton, so the bucket location has
    # to be injected explicitly. Relying on it being present in a developer's
    # local backend/.env made this test pass on a workstation and fail in CI.
    settings = get_settings()
    monkeypatch.setattr(settings, "aws_region", "ap-south-1")
    monkeypatch.setattr(settings, "s3_bucket", "test-bucket")

    monkeypatch.setattr("src.services.storage.s3_storage.boto3.client", lambda *_args, **_kwargs: FakeS3())
    storage = S3Storage()
    upload = storage.create_upload("quote/image.webp", "image/webp")
    assert upload["method"] == "PUT"
    assert upload["headers"] == {"content-type": "image/webp"}
    assert storage.create_download("quote/image.webp") == "https://s3.example/get_object"
