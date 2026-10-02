"""Private S3 persistence for Codex OAuth state.

OAuth credentials are server secrets, so they are written directly by the backend rather than
through a browser-facing presigned URL. S3 "folders" are key prefixes; writing the first object
creates the configured prefix in the bucket console.
"""

from __future__ import annotations

from dataclasses import dataclass

import boto3
from botocore.exceptions import ClientError

from src.settings import get_settings


@dataclass(slots=True)
class CodexOAuthS3Store:
    bucket: str
    prefix: str
    client: object

    @classmethod
    def from_settings(cls) -> CodexOAuthS3Store:
        settings = get_settings()
        client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        return cls(settings.s3_bucket, settings.codex_oauth_s3_prefix.strip("/"), client)

    def key(self, name: str) -> str:
        safe_name = name.removeprefix("/")
        prefix = self.prefix.strip("/")
        return f"{prefix}/{safe_name}" if prefix else safe_name

    def read_text(self, name: str) -> str | None:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self.key(name))
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise RuntimeError("Could not read Codex OAuth state from S3.") from exc
        body = response["Body"]
        try:
            return body.read().decode("utf-8")
        finally:
            close = getattr(body, "close", None)
            if close:
                close()

    def write_text(self, name: str, value: str, content_type: str = "text/plain") -> None:
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=self.key(name),
                Body=value.encode("utf-8"),
                ContentType=content_type,
                CacheControl="no-store",
                ServerSideEncryption="AES256",
            )
        except ClientError as exc:
            raise RuntimeError("Could not persist Codex OAuth state to S3.") from exc
