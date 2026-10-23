"""Password reset codes, signed local storage links, and document ownership on confirm."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.auth.security import _reset_signature, hash_password, issue_reset_code, reset_code_is_valid
from src.database import SessionFactory
from src.repositories.schema import DealDocument, Profile, User
from src.services.storage.local_storage import LocalStorage, local_signature
from src.settings import get_settings
from tests.demo_data import IDS


def login(client: TestClient, email: str, password: str = "demo1234") -> dict[str, str]:  # noqa: S107
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _new_buyer(password: str = "old-password-1") -> tuple[str, User]:  # noqa: S107
    """A throwaway account, so changing its password never affects the seeded demo users."""
    email = f"reset-{uuid4().hex[:10]}@example.com"
    async with SessionFactory() as session:
        profile = Profile(full_name="Reset Tester", email=email, role="buyer", phone="5550100100")
        session.add(profile)
        await session.flush()
        user = User(profile_id=profile.id, password_hash=hash_password(password), is_active=True)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return email, user


async def _user(email: str) -> User:
    async with SessionFactory() as session:
        return (await session.execute(select(User).join(Profile).where(Profile.email == email))).scalar_one()


# ------------------------------------------------------------------------------------------ 1. password reset


def test_the_fixed_demo_reset_code_no_longer_resets_any_account() -> None:
    """Regression: "DEMO-RESET" reset the password of any email address."""
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/reset-password",
            json={"email": "rahul@drivedeal.demo", "reset_code": "DEMO-RESET", "new_password": "taken-over-1"},
        )
        assert response.status_code == 400
        login(client, "rahul@drivedeal.demo")  # the demo password still works


def test_an_issued_code_resets_the_password_once() -> None:
    email, user = asyncio.run(_new_buyer())
    code = issue_reset_code(user)
    with TestClient(app) as client:
        reset = {"email": email, "reset_code": code, "new_password": "new-password-2"}
        assert client.post("/api/v1/auth/reset-password", json=reset).status_code == 200
        login(client, email, "new-password-2")
        # The code is tied to the old password, so it cannot be used again.
        again = {**reset, "new_password": "another-password-3"}
        assert client.post("/api/v1/auth/reset-password", json=again).status_code == 400


def test_a_code_works_only_for_its_own_account_and_before_it_expires() -> None:
    email, user = asyncio.run(_new_buyer())
    other_email, other = asyncio.run(_new_buyer())
    code = issue_reset_code(user)
    assert reset_code_is_valid(user, code)
    assert not reset_code_is_valid(other, code)
    expired_at = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())
    expired = f"{expired_at}-{_reset_signature(user.id, user.password_hash, expired_at)}"
    assert not reset_code_is_valid(user, expired)
    for forged in ("DEMO-RESET", "", "123-abc", f"{int(time.time()) + 999}-{'0' * 40}"):
        assert not reset_code_is_valid(user, forged)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/reset-password",
            json={"email": other_email, "reset_code": code, "new_password": "taken-over-1"},
        )
        assert response.status_code == 400


def test_forgot_password_answers_the_same_for_unknown_emails_and_never_returns_the_code() -> None:
    email, _ = asyncio.run(_new_buyer())
    with TestClient(app) as client:
        known = client.post("/api/v1/auth/forgot-password", json={"email": email})
        unknown = client.post("/api/v1/auth/forgot-password", json={"email": "nobody-here@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()


# ---------------------------------------------------------------------------------- 2. local storage links


def test_local_files_cannot_be_read_or_written_without_a_signed_link(local_uploads) -> None:
    """Regression: anyone could download a buyer's driving licence or overwrite any stored file."""
    (local_uploads / "buyer").mkdir()
    (local_uploads / "buyer" / "licence.pdf").write_bytes(b"%PDF secret")
    with TestClient(app) as client:
        assert client.get("/api/v1/documents/local/buyer/licence.pdf").status_code == 403
        assert client.put("/api/v1/documents/local/buyer/licence.pdf", content=b"overwritten").status_code == 403
    assert (local_uploads / "buyer" / "licence.pdf").read_bytes() == b"%PDF secret"


def test_signed_links_work_as_issued_and_only_as_issued(local_uploads) -> None:
    storage = LocalStorage()
    upload = storage.create_upload("deals/q/d/photo.png", "image/png")
    download = storage.create_download("deals/q/d/photo.png", as_attachment=True, filename="photo.png")
    with TestClient(app) as client:
        assert client.put(upload["url"], content=b"png-bytes").status_code == 204
        got = client.get(download)
        assert got.status_code == 200 and got.content == b"png-bytes"
        # A download link cannot be used to upload, and a link for one file cannot open another.
        assert client.put(download, content=b"x").status_code == 403
        assert client.get(download.replace("photo.png?", "other.png?", 1)).status_code == 403
        expired = int(time.time()) - 5
        stale = f"/api/v1/documents/local/deals/q/d/photo.png?expires={expired}&signature={local_signature('GET', 'deals/q/d/photo.png', expired)}"
        assert client.get(stale).status_code == 403


def test_local_file_routes_are_off_when_storage_is_s3(local_uploads, monkeypatch) -> None:
    link = LocalStorage().create_download("deals/q/d/photo.png")
    monkeypatch.setattr(get_settings(), "storage_driver", "s3")
    with TestClient(app) as client:
        assert client.get(link).status_code == 404


# --------------------------------------------------------------------------------- 3. document ownership


async def _add_document(quote_id: str, dealer_id: str, document_type: str = "quote_document") -> str:
    async with SessionFactory() as session:
        row = DealDocument(
            quote_id=quote_id,
            dealer_id=dealer_id,
            document_type=document_type,
            document_path=f"deals/{quote_id}/{dealer_id}/original--offer.pdf",
            status="confirmed",
        )
        session.add(row)
        await session.commit()
        return row.id


async def _document_path(document_id: str) -> str:
    async with SessionFactory() as session:
        return (await session.get(DealDocument, document_id)).document_path


def test_a_dealer_cannot_take_over_another_dealers_document() -> None:
    """Regression: confirm() updated any document id it was given, so a dealer could repoint a rival's document."""
    victim_id = asyncio.run(_add_document(IDS["q1"], IDS["dealer"]))
    with TestClient(app) as client:
        attacker = login(client, "elena@lonestar.demo")
        own_quote = next(
            q for q in client.get("/api/v1/quotes", headers=attacker).json() if q["dealer_id"] == IDS["dealer2"]
        )
        response = client.post(
            f"/api/v1/documents/{victim_id}/confirm",
            headers=attacker,
            json={
                "quote_id": own_quote["id"],
                "document_type": "quote_document",
                "object_key": f"deals/{own_quote['id']}/{IDS['dealer2']}/{uuid4()}--fake.pdf",
            },
        )
    assert response.status_code == 404
    assert asyncio.run(_document_path(victim_id)) == f"deals/{IDS['q1']}/{IDS['dealer']}/original--offer.pdf"


def test_the_owner_can_still_replace_their_own_document() -> None:
    document_id = asyncio.run(_add_document(IDS["q1"], IDS["dealer"], "vehicle_image"))
    new_key = f"deals/{IDS['q1']}/{IDS['dealer']}/{uuid4()}--revised.png"
    with TestClient(app) as client:
        owner = login(client, "naveen@naveemotors.demo")
        response = client.post(
            f"/api/v1/documents/{document_id}/confirm",
            headers=owner,
            json={"quote_id": IDS["q1"], "document_type": "vehicle_image", "object_key": new_key},
        )
    assert response.status_code == 200, response.text
    assert asyncio.run(_document_path(document_id)) == new_key
