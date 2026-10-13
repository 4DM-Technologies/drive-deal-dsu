import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.auth.security import hash_password
from src.database import SessionFactory
from src.repositories.auth_repository import AuthRepository
from src.repositories.schema import DealerDocument, Profile, SupportVerification, User
from src.services.dealer_license import dealer_license_key
from src.services.storage import StorageError, StorageObject
from src.settings import DEALER_LICENSE_MAX_BYTES
from tests.demo_data import IDS, PDF_BYTES, PNG_BYTES

SIGNUP_URL = "/api/v1/auth/signup/dealer"
FIELD = "motor_vehicle_dealer_license"
STAFF_PASSWORD = "secure-test-password"


def expected_key(profile_id: str) -> str:
    """The documented layout, spelled out literally so a change to the key builder cannot go unnoticed."""
    return f"dealer/{profile_id}/personal-details/dealer-documents/motor-vehicle-dealer-license.pdf"


def dealer_fields(email: str, overrides: dict[str, str] | None = None) -> dict:
    return {
        "full_name": "Licence Dealer",
        "email": email,
        "phone": "+12145550999",
        "password": "secure-demo-password",
        "state_id": IDS["tx"],
        "address": "100 Main St, Dallas, TX",
        "terms_accepted": "true",
        "terms_version": "2026-09-30",
        "dealership_name": "Licence Motors",
        "branch_name": "Dallas",
        "dealer_license": f"TX-{uuid4().hex[:8]}",
        "supported_brand_ids": [IDS["ford"]],
        **(overrides or {}),
    }


def new_email() -> str:
    return f"dealer-licence-{uuid4().hex[:8]}@example.com"


def licence_file(content: bytes = PDF_BYTES, name: str = "MVD License.pdf", content_type: str = "application/pdf"):
    return {FIELD: (name, content, content_type)}


def stored_files(root: Path) -> list[Path]:
    return [path for path in root.rglob("*") if path.is_file()]


def applicant(email: str) -> tuple[Profile | None, list[DealerDocument], SupportVerification | None]:
    async def _fetch():
        async with SessionFactory() as session:
            profile = await session.scalar(select(Profile).where(Profile.email == email))
            if profile is None:
                return None, [], None
            documents = list(
                (await session.execute(select(DealerDocument).where(DealerDocument.profile_id == profile.id))).scalars()
            )
            verification = await session.scalar(
                select(SupportVerification).where(SupportVerification.profile_id == profile.id)
            )
            return profile, documents, verification

    return asyncio.run(_fetch())


def signed_in_as(client: TestClient, role: str) -> dict[str, str]:
    """A fresh, active account of ``role``. Other tests deactivate demo staff, so this one makes its own."""
    email = f"{role}-{uuid4().hex[:8]}@example.com"

    async def _create() -> None:
        async with SessionFactory() as session:
            profile = Profile(
                state_id=IDS["tx"], full_name=f"Test {role}", email=email, role=role, phone="+12145550100"
            )
            session.add(profile)
            await session.flush()
            session.add(User(profile_id=profile.id, password_hash=hash_password(STAFF_PASSWORD), is_active=True))
            await session.commit()

    asyncio.run(_create())
    response = client.post("/api/v1/auth/login", json={"email": email, "password": STAFF_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_dealer_signup_stores_the_licence_under_the_dealer_folder(local_uploads: Path) -> None:
    email = new_email()
    with TestClient(app) as client:
        response = client.post(SIGNUP_URL, data=dealer_fields(email), files=licence_file())
    assert response.status_code == 202, response.text

    profile, documents, verification = applicant(email)
    assert profile is not None and verification is not None
    key = expected_key(profile.id)
    assert (local_uploads / key).read_bytes() == PDF_BYTES
    assert [
        (doc.document_type, doc.object_key, doc.file_name, doc.content_type, doc.size_bytes) for doc in documents
    ] == [("motor_vehicle_dealer_license", key, "MVD License.pdf", "application/pdf", len(PDF_BYTES))]
    assert verification.proof_docs == [key]


def test_dealer_signup_without_a_licence_is_rejected_and_creates_no_account(local_uploads: Path) -> None:
    email = new_email()
    with TestClient(app) as client:
        response = client.post(
            SIGNUP_URL, data=dealer_fields(email), files={"unrelated": ("x.txt", b"x", "text/plain")}
        )
    assert response.status_code == 422
    assert "Motor Vehicle Dealer License" in response.json()["error"]["message"]
    assert applicant(email)[0] is None
    assert stored_files(local_uploads) == []


@pytest.mark.parametrize(
    ("content", "message_part"),
    [
        (b"", "empty"),
        (PNG_BYTES, "must be a PDF"),
        (b"not really a pdf", "must be a PDF"),
        (b"%PDF-" + b"0" * DEALER_LICENSE_MAX_BYTES, "too large"),
    ],
    ids=["empty", "png", "not-a-pdf", "too-large"],
)
def test_dealer_signup_rejects_unusable_licence_files(local_uploads: Path, content: bytes, message_part: str) -> None:
    email = new_email()
    with TestClient(app) as client:
        # The declared type says PDF every time: only the file's own signature is trusted.
        response = client.post(SIGNUP_URL, data=dealer_fields(email), files=licence_file(content))
    assert response.status_code == 422
    assert message_part in response.json()["error"]["message"]
    assert applicant(email)[0] is None
    assert stored_files(local_uploads) == []


def test_dealer_licence_storage_outage_fails_the_application(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenStorage:
        def put_object(self, item: StorageObject) -> None:
            raise StorageError("bucket unreachable")

    email = new_email()
    with TestClient(app) as client:
        with monkeypatch.context() as patched:
            patched.setattr("src.services.auth_service.get_storage", lambda: BrokenStorage())
            failed = client.post(SIGNUP_URL, data=dealer_fields(email), files=licence_file())
        assert failed.status_code == 503
        assert "Motor Vehicle Dealer License" in failed.json()["error"]["message"]
        assert applicant(email)[0] is None


def test_failed_application_save_removes_the_uploaded_licence(
    local_uploads: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def failing_commit(self: AuthRepository) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(AuthRepository, "commit", failing_commit)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(SIGNUP_URL, data=dealer_fields(new_email()), files=licence_file())
    assert response.status_code == 500
    assert stored_files(local_uploads) == []


def test_support_sees_and_opens_the_dealer_licence_on_the_verification(
    local_uploads: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The local download route reads from its own upload directory, so point it at the same per-test folder.
    monkeypatch.setattr("src.routes.documents.UPLOAD_DIRECTORY", local_uploads)
    email = new_email()
    with TestClient(app) as client:
        assert client.post(SIGNUP_URL, data=dealer_fields(email), files=licence_file()).status_code == 202
        support = signed_in_as(client, "support")
        rows = client.get("/api/v1/verifications", headers=support).json()
        row = next(item for item in rows if item["email"] == email)

        [document] = row["documents"]
        assert document["label"] == "Motor Vehicle Dealer License"
        assert document["file_name"] == "MVD License.pdf"
        assert "object_key" not in document

        link = client.get(f"/api/v1/verifications/{row['id']}/documents/{document['id']}/download", headers=support)
        assert link.status_code == 200
        opened = client.get(link.json()["url"])
        assert opened.status_code == 200 and opened.content == PDF_BYTES

        # A document can only be opened through the verification it belongs to, and only by support staff.
        other = next(item for item in rows if item["id"] != row["id"])
        mismatched = client.get(
            f"/api/v1/verifications/{other['id']}/documents/{document['id']}/download", headers=support
        )
        assert mismatched.status_code == 404
        buyer = signed_in_as(client, "buyer")
        forbidden = client.get(f"/api/v1/verifications/{row['id']}/documents/{document['id']}/download", headers=buyer)
        assert forbidden.status_code == 403


def test_dealer_license_key_layout() -> None:
    assert dealer_license_key("dealer-1") == expected_key("dealer-1")
