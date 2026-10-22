import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from main import app
from src.database import SessionFactory
from src.repositories.schema import UserReport, UserReportAttachment
from tests.demo_data import IDS

BUYER = "rahul@drivedeal.demo"
DEALER = "naveen@naveemotors.demo"
OTHER_DEALER = "elena@lonestar.demo"
SUPPORT = "priya@drivedeal.demo"  # support-admin; other tests change the support-role demo account
QUOTE_ID = IDS["q2"]  # Rahul's accepted Jazz deal with Naveen Motors, with an open conversation.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
DETAILS = "The dealer asked me to wire a deposit to a personal account outside the app."


@pytest.fixture(autouse=True)
def no_reports() -> None:
    """The demo database persists across tests, so each test starts without earlier reports (one open per thread)."""

    async def _clear() -> None:
        async with SessionFactory() as session:
            await session.execute(delete(UserReportAttachment))
            await session.execute(delete(UserReport))
            await session.commit()

    asyncio.run(_clear())


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def report(client: TestClient, headers: dict[str, str], files: list | None = None, **fields: object):
    data = {
        "quote_id": QUOTE_ID,
        "reason": "off_platform_payment",
        "details": DETAILS,
        "include_conversation": "true",
        "confirm_accurate": "true",
        **{key: str(value).lower() if isinstance(value, bool) else value for key, value in fields.items()},
    }
    return client.post("/api/v1/reports", headers=headers, data=data, files=files or [])


def test_buyer_reports_dealer_with_screenshot_stored_under_the_reported_dealer(local_uploads: Path) -> None:
    with TestClient(app) as client:
        created = report(client, login(client, BUYER), files=[("files", ("proof.png", PNG, "image/png"))])
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["report_id"].startswith("RPT-") and body["status"] == "open"
        assert body["evidence_count"] == 1 and body["conversation_attached"] is True
        assert "notes" not in body and "outcome" not in body

        reference = body["report_id"]
        key = f"reports/dealer/{IDS['dealer']}/{reference}/{reference}-evidence-01.png"
        assert (local_uploads / key).read_bytes() == PNG


def test_support_sees_the_report_with_both_people_and_the_conversation() -> None:
    with TestClient(app) as client:
        created = report(client, login(client, BUYER), files=[("files", ("proof.png", PNG, "image/png"))]).json()
        support = login(client, SUPPORT)
        listed = client.get("/api/v1/support/reports", headers=support).json()
        row = next(item for item in listed if item["id"] == created["id"])
        assert "conversation_snapshot" not in row and row["message_count"] > 0

        detail = client.get(f"/api/v1/support/reports/{created['id']}", headers=support).json()
        assert detail["reporter"]["id"] == IDS["buyer"] and detail["reporter"]["role"] == "buyer"
        assert detail["reported"]["id"] == IDS["dealer"] and detail["reported"]["is_active"] is True
        assert detail["vehicle"] and detail["details"] == DETAILS
        assert len(detail["conversation_snapshot"]) == row["message_count"]
        assert "Is delivery to Frisco included?" in [message["message"] for message in detail["conversation_snapshot"]]
        [attachment] = detail["attachments"]
        link = client.get(
            f"/api/v1/support/reports/{created['id']}/attachments/{attachment['id']}/view", headers=support
        )
        assert link.status_code == 200 and link.json()["url"]


def test_dealer_can_report_the_buyer_without_the_conversation() -> None:
    with TestClient(app) as client:
        created = report(client, login(client, DEALER), reason="no_show", include_conversation=False)
        assert created.status_code == 201, created.text
        assert created.json()["reported_role"] == "buyer" and created.json()["conversation_attached"] is False


def test_reason_must_fit_the_reported_role() -> None:
    with TestClient(app) as client:
        assert report(client, login(client, BUYER), reason="fake_buyer").status_code == 422
        assert report(client, login(client, DEALER), reason="misleading_listing").status_code == 422


def test_only_the_people_in_the_conversation_can_report() -> None:
    with TestClient(app) as client:
        assert report(client, login(client, OTHER_DEALER)).status_code == 404
        assert report(client, login(client, SUPPORT)).status_code == 403
        assert report(client, {}).status_code == 401


def test_form_rules_are_enforced_on_the_server() -> None:
    with TestClient(app) as client:
        buyer = login(client, BUYER)
        assert report(client, buyer, confirm_accurate=False).status_code == 422
        assert report(client, buyer, details="too short").status_code == 422
        renamed = [("files", ("proof.png", b"not really an image", "image/png"))]
        assert report(client, buyer, files=renamed).status_code == 422
        pdf = [("files", ("proof.pdf", b"%PDF-1.7 ...", "application/pdf"))]
        assert report(client, buyer, files=pdf).status_code == 422
        four = [("files", (f"proof-{index}.png", PNG, "image/png")) for index in range(4)]
        assert report(client, buyer, files=four).status_code == 422


def test_one_open_report_per_conversation_until_support_closes_it() -> None:
    with TestClient(app) as client:
        buyer, support = login(client, BUYER), login(client, SUPPORT)
        first = report(client, buyer).json()
        duplicate = report(client, buyer)
        assert duplicate.status_code == 409 and first["report_id"] in duplicate.json()["error"]["message"]

        dismissed = client.patch(
            f"/api/v1/support/reports/{first['id']}",
            headers=support,
            json={"status": "dismissed", "note": "Messages show a normal deposit request through the app."},
        )
        assert dismissed.status_code == 200 and dismissed.json()["outcome"] == "no_violation"
        assert report(client, buyer).status_code == 201


def test_support_workflow_requires_an_outcome_and_a_note_to_close() -> None:
    with TestClient(app) as client:
        created = report(client, login(client, BUYER)).json()
        support = login(client, SUPPORT)
        url = f"/api/v1/support/reports/{created['id']}"

        reviewing = client.patch(url, headers=support, json={"status": "under_review", "note": "Checking messages."})
        assert reviewing.status_code == 200 and reviewing.json()["status"] == "under_review"
        assert client.patch(url, headers=support, json={"status": "action_taken", "note": "Warned."}).status_code == 422
        no_note = {"status": "action_taken", "outcome": "warning_issued"}
        assert client.patch(url, headers=support, json=no_note).status_code == 422
        assert client.patch(url, headers=support, json={"outcome": "warning_issued"}).status_code == 422
        assert client.patch(url, headers=support, json={}).status_code == 422

        closed = client.patch(url, headers=support, json={**no_note, "note": "Dealer warned about payments."})
        assert closed.status_code == 200, closed.text
        body = closed.json()
        assert body["status"] == "action_taken" and body["outcome"] == "warning_issued"
        assert [entry.get("status") for entry in body["notes"]] == ["under_review", "action_taken"]
        assert body["notes"][-1]["actor_name"] and body["notes"][-1]["outcome"] == "warning_issued"


def test_only_support_can_read_or_change_reports() -> None:
    with TestClient(app) as client:
        created = report(client, login(client, BUYER)).json()
        buyer = login(client, BUYER)
        assert client.get("/api/v1/support/reports", headers=buyer).status_code == 403
        assert client.get(f"/api/v1/support/reports/{created['id']}", headers=buyer).status_code == 403
        assert client.patch(f"/api/v1/support/reports/{created['id']}", headers=buyer, json={}).status_code == 403
