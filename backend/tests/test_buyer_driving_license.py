import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.database import SessionFactory
from src.repositories.auth_repository import AuthRepository
from src.repositories.schema import BuyerDocument
from src.services.driving_license import display_file_name, driving_license_key, sniff_content_type
from src.services.storage import StorageError, StorageObject
from src.services.storage.s3_storage import S3Storage
from src.settings import DRIVING_LICENSE_MAX_BYTES, get_settings
from tests.demo_data import IDS, PNG_BYTES

SIGNUP_URL = "/api/v1/auth/signup/buyer"
PASSWORD = "secure-demo-password"


def expected_key(profile_id: str, extension: str) -> str:
    """The documented layout, spelled out literally so a change to the key builder cannot go unnoticed."""
    return f"buyer/{profile_id}/personal-details/driving-licence/driving-licence{extension}"


def signup_fields(email: str, overrides: dict[str, str] | None = None) -> dict[str, str]:
    return {
        "full_name": "Licence Buyer",
        "email": email,
        "phone": "+12145550999",
        "password": PASSWORD,
        "state_id": IDS["tx"],
        "address": "Dallas, TX",
        "terms_accepted": "true",
        "terms_version": "2026-09-30",
        **(overrides or {}),
    }


def new_email() -> str:
    return f"licence-{uuid4().hex[:8]}@example.com"


def stored_files(root: Path) -> list[Path]:
    return [path for path in root.rglob("*") if path.is_file()]


def buyer_documents(profile_id: str) -> list[BuyerDocument]:
    async def _fetch() -> list[BuyerDocument]:
        async with SessionFactory() as session:
            return list(
                (await session.execute(select(BuyerDocument).where(BuyerDocument.profile_id == profile_id))).scalars()
            )

    return asyncio.run(_fetch())


def can_sign_in(client: TestClient, email: str) -> bool:
    return client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 200


def test_signup_stores_the_driving_license_under_the_buyer_folder(local_uploads: Path) -> None:
    email = new_email()
    with TestClient(app) as client:
        response = client.post(
            SIGNUP_URL,
            data=signup_fields(email),
            files={"driving_license": ("my licence.png", PNG_BYTES, "image/png")},
        )
        assert response.status_code == 201, response.text
        profile_id = response.json()["profile"]["id"]

    key = expected_key(profile_id, ".png")
    assert (local_uploads / key).read_bytes() == PNG_BYTES
    [document] = buyer_documents(profile_id)
    assert document.object_key == key
    assert document.document_type == "driving_license"
    assert document.file_name == "my licence.png"
    assert document.content_type == "image/png"
    assert document.size_bytes == len(PNG_BYTES)


def test_signup_accepts_pdf_and_names_it_by_content_not_by_upload_name(local_uploads: Path) -> None:
    with TestClient(app) as client:
        response = client.post(
            SIGNUP_URL,
            data=signup_fields(new_email()),
            files={"driving_license": ("scan.bin", b"%PDF-1.7\n%%EOF", "application/octet-stream")},
        )
        assert response.status_code == 201, response.text
        profile_id = response.json()["profile"]["id"]
    assert (local_uploads / expected_key(profile_id, ".pdf")).is_file()
    assert buyer_documents(profile_id)[0].content_type == "application/pdf"


def test_signup_without_a_driving_license_is_rejected_and_creates_no_account(local_uploads: Path) -> None:
    email = new_email()
    with TestClient(app) as client:
        response = client.post(SIGNUP_URL, data=signup_fields(email))
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        assert "driving licence" in response.json()["error"]["message"]
        assert not can_sign_in(client, email)
    assert stored_files(local_uploads) == []


@pytest.mark.parametrize(
    ("content", "message_part"),
    [
        pytest.param(b"this is plain text, not a licence", "Unsupported", id="not-an-image"),
        pytest.param(b"", "empty", id="empty-file"),
        pytest.param(PNG_BYTES + b"\x00" * DRIVING_LICENSE_MAX_BYTES, "too large", id="too-large"),
    ],
)
def test_signup_rejects_unusable_driving_license_files(local_uploads: Path, content: bytes, message_part: str) -> None:
    email = new_email()
    with TestClient(app) as client:
        # The declared type says PNG in every case: the file's own signature is what is checked.
        response = client.post(
            SIGNUP_URL, data=signup_fields(email), files={"driving_license": ("licence.png", content, "image/png")}
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        assert message_part in response.json()["error"]["message"]
        assert not can_sign_in(client, email)
    assert stored_files(local_uploads) == []


def test_signup_field_errors_use_the_standard_validation_envelope(local_uploads: Path) -> None:
    with TestClient(app) as client:
        response = client.post(
            SIGNUP_URL,
            data=signup_fields(new_email(), {"password": "short"}),
            files={"driving_license": ("licence.png", PNG_BYTES, "image/png")},
        )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["loc"] == ["body", "password"]
    assert stored_files(local_uploads) == []


def test_duplicate_email_is_refused_before_anything_is_stored(local_uploads: Path) -> None:
    email = new_email()
    licence = {"driving_license": ("licence.png", PNG_BYTES, "image/png")}
    with TestClient(app) as client:
        assert client.post(SIGNUP_URL, data=signup_fields(email), files=licence).status_code == 201
        duplicate = client.post(SIGNUP_URL, data=signup_fields(email), files=licence)
    assert duplicate.status_code == 409
    assert len(stored_files(local_uploads)) == 1


def test_storage_outage_fails_the_signup_and_leaves_no_account(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenStorage:
        def put_object(self, item: StorageObject) -> None:
            raise StorageError("bucket unreachable")

    email = new_email()
    licence = {"driving_license": ("licence.png", PNG_BYTES, "image/png")}
    with TestClient(app) as client:
        with monkeypatch.context() as patched:
            patched.setattr("src.services.auth_service.get_storage", lambda: BrokenStorage())
            failed = client.post(SIGNUP_URL, data=signup_fields(email), files=licence)
        assert failed.status_code == 503
        assert failed.json()["error"]["code"] == "STORAGE_UNAVAILABLE"
        assert not can_sign_in(client, email)
        # Nothing was committed, so the same email can sign up once storage is back.
        assert client.post(SIGNUP_URL, data=signup_fields(email), files=licence).status_code == 201


def test_failed_account_save_removes_the_uploaded_file(local_uploads: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_commit(self: AuthRepository) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(AuthRepository, "commit", failing_commit)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            SIGNUP_URL,
            data=signup_fields(new_email()),
            files={"driving_license": ("licence.png", PNG_BYTES, "image/png")},
        )
    assert response.status_code == 500
    assert stored_files(local_uploads) == []


class FakeS3:
    def __init__(self, failure: ClientError | None = None) -> None:
        self.failure = failure
        self.put_calls: list[dict] = []
        self.delete_calls: list[dict] = []

    def put_object(self, **kwargs: object) -> None:
        if self.failure:
            raise self.failure
        self.put_calls.append(kwargs)

    def delete_object(self, **kwargs: object) -> None:
        if self.failure:
            raise self.failure
        self.delete_calls.append(kwargs)


def s3_storage_with(monkeypatch: pytest.MonkeyPatch, fake: FakeS3) -> S3Storage:
    settings = get_settings()
    monkeypatch.setattr(settings, "aws_region", "ap-south-1")
    monkeypatch.setattr(settings, "s3_bucket", "test-bucket")
    monkeypatch.setattr("src.services.storage.s3_storage.boto3.client", lambda *_args, **_kwargs: fake)
    return S3Storage()


def test_s3_put_writes_encrypted_private_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeS3()
    storage = s3_storage_with(monkeypatch, fake)
    key = driving_license_key("profile-1", ".jpg")
    storage.put_object(StorageObject(key=key, content=b"bytes", content_type="image/jpeg"))
    storage.delete_object(key)

    assert key == "buyer/profile-1/personal-details/driving-licence/driving-licence.jpg"
    assert fake.put_calls == [
        {
            "Bucket": "test-bucket",
            "Key": key,
            "Body": b"bytes",
            "ContentType": "image/jpeg",
            "CacheControl": "no-store",
            "ServerSideEncryption": "AES256",
        }
    ]
    assert fake.delete_calls == [{"Bucket": "test-bucket", "Key": key}]


def test_s3_failures_surface_as_storage_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    denied = ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, "PutObject")
    storage = s3_storage_with(monkeypatch, FakeS3(failure=denied))
    with pytest.raises(StorageError):
        storage.put_object(StorageObject(key="k", content=b"x", content_type="image/png"))
    with pytest.raises(StorageError):
        storage.delete_object("k")


def test_storage_object_repr_never_includes_file_bytes() -> None:
    item = StorageObject(key="k", content=b"SECRET-LICENCE-BYTES", content_type="image/png")
    assert "SECRET" not in repr(item)


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (b"\xff\xd8\xff\xe0rest", "image/jpeg"),
        (PNG_BYTES, "image/png"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"%PDF-1.4", "application/pdf"),
        (b"RIFF\x00\x00\x00\x00WAVEfmt ", None),
        (b"GIF89a", None),
        (b"", None),
    ],
)
def test_content_type_comes_from_the_file_signature(content: bytes, expected: str | None) -> None:
    assert sniff_content_type(content) == expected


def test_display_file_name_drops_paths_and_control_characters() -> None:
    assert display_file_name("C:\\fakepath\\licence.jpg", ".jpg") == "licence.jpg"
    assert display_file_name("../../etc/pass\x00wd.png", ".png") == "passwd.png"
    assert display_file_name("  ", ".pdf") == "driving-licence.pdf"
    assert len(display_file_name("a" * 400 + ".png", ".png")) == 255
