import boto3

from src.services.storage.storage import Storage
from src.settings import get_settings


class S3Storage(Storage):
    def __init__(self) -> None:
        settings = get_settings()
        self.bucket = settings.s3_bucket
        self.client = boto3.client("s3", region_name=settings.aws_region, aws_access_key_id=settings.aws_access_key_id, aws_secret_access_key=settings.aws_secret_access_key)

    def create_upload(self, key: str, content_type: str) -> dict:
        url = self.client.generate_presigned_url("put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type}, ExpiresIn=900)
        return {"driver": "s3", "method": "PUT", "url": url, "key": key, "headers": {"content-type": content_type}}
