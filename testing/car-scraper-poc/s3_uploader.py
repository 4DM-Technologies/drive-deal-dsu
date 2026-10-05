"""Uploads a local JSON file (e.g. a trace_run.py output) to the backend's S3 bucket.

Reuses the backend's existing AWS credentials/settings (same pattern as llm_client.py
reusing the ChatGPT OAuth credential) instead of needing its own AWS config.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_SRC = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

import boto3  # noqa: E402

from src.settings import get_settings  # noqa: E402

S3_PREFIX = "car-scraper-poc/traces"


def _client():
    settings = get_settings()
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        raise RuntimeError("AWS credentials not configured in backend/.env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)")
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    ), settings.s3_bucket


def upload_json_file(file_path: str, key: str | None = None) -> str:
    """Uploads the given local JSON file to S3 and returns the object key used."""
    client, bucket = _client()
    path = Path(file_path)

    if key is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        key = f"{S3_PREFIX}/{timestamp}_{path.name}"

    client.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": "application/json"})
    return key


def upload_json_data(data: dict, key: str) -> str:
    """Uploads an in-memory dict as a JSON object to S3 (no local file needed)."""
    client, bucket = _client()
    client.put_object(Bucket=bucket, Key=key, Body=json.dumps(data, indent=2).encode("utf-8"), ContentType="application/json")
    return key


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python s3_uploader.py <path-to-json-file>")
        sys.exit(1)

    uploaded_key = upload_json_file(sys.argv[1])
    print(f"Uploaded to s3://{get_settings().s3_bucket}/{uploaded_key}")
