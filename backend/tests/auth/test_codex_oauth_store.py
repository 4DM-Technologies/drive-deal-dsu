from io import BytesIO
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from src.auth import codex_oauth
from src.auth.codex_oauth_store import CodexOAuthS3Store


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.last_put: dict | None = None

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        value = self.objects.get((Bucket, Key))
        if value is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        return {"Body": BytesIO(value)}

    def put_object(self, **kwargs: object) -> None:
        self.last_put = kwargs
        self.objects[(str(kwargs["Bucket"]), str(kwargs["Key"]))] = kwargs["Body"]


def test_oauth_state_is_encrypted_and_round_trips_through_s3() -> None:
    client = FakeS3()
    store = CodexOAuthS3Store("private-bucket", "/private/codex-oauth/", client)

    assert store.read_text("tokens.json") is None
    store.write_text("tokens.json", '{"access_token":"secret"}', "application/json")

    assert store.read_text("tokens.json") == '{"access_token":"secret"}'
    assert client.last_put["Key"] == "private/codex-oauth/tokens.json"
    assert client.last_put["ServerSideEncryption"] == "AES256"
    assert client.last_put["CacheControl"] == "no-store"


def test_legacy_token_is_removed_only_after_successful_s3_migration(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    legacy_dir = tmp_path / ".codex_oauth_state"
    legacy_dir.mkdir()
    legacy_file = legacy_dir / "tokens.json"
    legacy_file.write_text('{"access_token":"secret"}', encoding="utf-8")
    writes: list[tuple[str, str, str]] = []
    store = SimpleNamespace(read_text=lambda _name: None, write_text=lambda *args: writes.append(args))
    monkeypatch.setattr(codex_oauth, "LEGACY_STATE_DIR", legacy_dir)
    monkeypatch.setattr(codex_oauth, "_state_store", lambda: store)

    assert codex_oauth._read_state("tokens.json") == '{"access_token":"secret"}'
    assert writes == [("tokens.json", '{"access_token":"secret"}', "application/json")]
    assert not legacy_file.exists()


def test_failed_s3_migration_preserves_the_legacy_token(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    legacy_dir = tmp_path / ".codex_oauth_state"
    legacy_dir.mkdir()
    legacy_file = legacy_dir / "tokens.json"
    legacy_file.write_text('{"access_token":"secret"}', encoding="utf-8")

    def fail_write(*_args: object) -> None:
        raise RuntimeError("S3 unavailable")

    store = SimpleNamespace(read_text=lambda _name: None, write_text=fail_write)
    monkeypatch.setattr(codex_oauth, "LEGACY_STATE_DIR", legacy_dir)
    monkeypatch.setattr(codex_oauth, "_state_store", lambda: store)

    with pytest.raises(RuntimeError, match="S3 unavailable"):
        codex_oauth._read_state("tokens.json")
    assert legacy_file.exists()
