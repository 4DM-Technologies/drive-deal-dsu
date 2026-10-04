import boto3

from src.services.storage.storage import Storage
from src.settings import S3_PRESIGNED_URL_TTL_SECONDS, get_settings
from src.utils.log_flow import log_flow


class S3Storage(Storage):
    def __init__(self) -> None:
        settings = get_settings()
        region, self.bucket = settings.require_s3_location()
        self.client = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    @log_flow(layer="service")
    def create_upload(self, key: str, content_type: str) -> dict:
        url = self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=S3_PRESIGNED_URL_TTL_SECONDS,
        )
        return {"driver": "s3", "method": "PUT", "url": url, "key": key, "headers": {"content-type": content_type}}

    @log_flow(layer="service")
    def create_download(self, key: str, *, as_attachment: bool = False, filename: str | None = None) -> str:
        params = {"Bucket": self.bucket, "Key": key}
        if as_attachment:
            safe_name = (filename or key.rsplit("/", 1)[-1]).replace('"', "")
            params["ResponseContentDisposition"] = f'attachment; filename="{safe_name}"'
        return self.client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=S3_PRESIGNED_URL_TTL_SECONDS,
        )
