from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app
from src.services.storage import StorageError, StorageObject
from tests.demo_data import PNG_BYTES

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def login(client: TestClient, email: str) -> tuple[dict[str, str], str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, response.json()["profile"]["id"]


def open_ticket(client: TestClient, headers: dict[str, str]) -> dict:
    created = client.post(
        "/api/v1/support/tickets",
        headers=headers,
        json={
            "issue_summary": "Quote totals are not updating",
            "issue_description": "See screenshot",
            "page_context": "/home",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()


def attach(client: TestClient, headers: dict[str, str], ticket_id: str, *files: tuple[str, bytes, str]):
    return client.post(
        f"/api/v1/support/tickets/{ticket_id}/attachments",
        headers=headers,
        files=[("files", file) for file in files],
    )


def stored(root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())


@pytest.mark.parametrize(
    ("email", "folder"), [("rahul@drivedeal.demo", "buyer-support"), ("naveen@naveemotors.demo", "dealer-support")]
)
def test_attachments_are_stored_under_help_support_by_audience_profile_and_ticket(
    local_uploads: Path, email: str, folder: str
) -> None:
    with TestClient(app) as client:
        headers, profile_id = login(client, email)
        ticket = open_ticket(client, headers)
        response = attach(
            client,
            headers,
            ticket["id"],
            ("screen.png", PNG_BYTES, "image/png"),
            ("invoice.pdf", PDF_BYTES, "application/pdf"),
        )
        assert response.status_code == 201, response.text
        assert [item["file_name"] for item in response.json()["attachments"]] == ["screen.png", "invoice.pdf"]

        base = f"help-support/{folder}/{profile_id}/{ticket['ticket_id']}"
        assert stored(local_uploads) == [f"{base}/attachment-01.png", f"{base}/attachment-02.pdf"]
        # Storage keys never leave the server; the ticket only lists display metadata.
        assert "object_key" not in response.json()["attachments"][0]


def test_support_sees_the_attachments_and_gets_a_download_link_but_other_users_do_not() -> None:
    with TestClient(app) as client:
        buyer, _ = login(client, "rahul@drivedeal.demo")
        ticket = open_ticket(client, buyer)
        attachment = attach(client, buyer, ticket["id"], ("screen.png", PNG_BYTES, "image/png")).json()["attachments"][
            0
        ]

        support, _ = login(client, "priya@drivedeal.demo")
        queue = client.get("/api/v1/support/queue/tickets", headers=support).json()
        listed = next(row for row in queue if row["id"] == ticket["id"])
        assert [item["file_name"] for item in listed["attachments"]] == ["screen.png"]

        url = f"/api/v1/support/tickets/{ticket['id']}/attachments/{attachment['id']}/download"
        download = client.get(url, headers=support)
        assert download.status_code == 200, download.text
        assert download.json()["file_name"] == "screen.png" and download.json()["url"]
        assert client.get(url, headers=buyer).status_code == 200

        other_dealer, _ = login(client, "naveen@naveemotors.demo")
        assert client.get(url, headers=other_dealer).status_code == 404
        assert attach(client, other_dealer, ticket["id"], ("x.png", PNG_BYTES, "image/png")).status_code == 404


def test_attachments_are_checked_by_content_size_and_count(local_uploads: Path) -> None:
    with TestClient(app) as client:
        buyer, _ = login(client, "rahul@drivedeal.demo")
        ticket = open_ticket(client, buyer)

        assert attach(client, buyer, ticket["id"], ("fake.png", b"not really a png", "image/png")).status_code == 422
        too_big = PNG_BYTES + b"\x00" * (10 * 1024 * 1024)
        assert attach(client, buyer, ticket["id"], ("big.png", too_big, "image/png")).status_code == 422
        four = [(f"s{index}.png", PNG_BYTES, "image/png") for index in range(4)]
        assert attach(client, buyer, ticket["id"], *four).status_code == 422
        # A rejected batch stores nothing.
        assert stored(local_uploads) == []

        assert attach(client, buyer, ticket["id"], *four[:3]).status_code == 201
        assert attach(client, buyer, ticket["id"], ("one-more.png", PNG_BYTES, "image/png")).status_code == 422


def test_a_storage_outage_stores_nothing_and_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenStorage:
        def put_object(self, item: StorageObject) -> None:
            raise StorageError("bucket unreachable")

        def delete_object(self, key: str) -> None:
            return None

    with TestClient(app) as client:
        buyer, _ = login(client, "rahul@drivedeal.demo")
        ticket = open_ticket(client, buyer)
        with monkeypatch.context() as patched:
            patched.setattr("src.services.support_service.get_storage", lambda: BrokenStorage())
            failed = attach(client, buyer, ticket["id"], ("screen.png", PNG_BYTES, "image/png"))
        assert failed.status_code == 503
        assert failed.json()["error"]["code"] == "STORAGE_UNAVAILABLE"
        mine = client.get("/api/v1/support/tickets", headers=buyer).json()
        assert next(row for row in mine if row["id"] == ticket["id"])["attachments"] == []
