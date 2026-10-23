import hashlib
import hmac
import time
from urllib.parse import quote, urlencode

from src.services.storage.storage import Storage, StorageError, StorageObject
from src.settings import S3_PRESIGNED_URL_TTL_SECONDS, UPLOAD_DIRECTORY, get_settings
from src.utils.log_flow import log_flow


def local_signature(method: str, key: str, expires: int) -> str:
    """HMAC of the method, key and expiry, so a local storage link works only as issued, and only until it expires.

    Local links play the role of S3 presigned URLs: whoever holds one may use it, nobody else can make one.
    """
    message = f"{method.upper()}\n{key}\n{expires}".encode()
    return hmac.new(get_settings().jwt_secret_key.encode(), message, hashlib.sha256).hexdigest()


def local_link_is_valid(method: str, key: str, expires: int | None, signature: str | None) -> bool:
    if expires is None or not signature or expires < int(time.time()):
        return False
    return hmac.compare_digest(local_signature(method, key, expires), signature)


def _signed_url(method: str, key: str, extra: dict[str, str] | None = None) -> str:
    expires = int(time.time()) + S3_PRESIGNED_URL_TTL_SECONDS
    query = {**(extra or {}), "expires": str(expires), "signature": local_signature(method, key, expires)}
    return f"/api/v1/documents/local/{quote(key)}?{urlencode(query)}"


class LocalStorage(Storage):
    @log_flow(layer="service")
    def create_upload(self, key: str, content_type: str) -> dict:
        return {
            "driver": "local",
            "method": "PUT",
            "url": _signed_url("PUT", key),
            "key": key,
            "headers": {"content-type": content_type},
        }

    @log_flow(layer="service")
    def create_download(self, key: str, *, as_attachment: bool = False, filename: str | None = None) -> str:
        if as_attachment:
            safe_name = (filename or key.rsplit("/", 1)[-1]).replace('"', "")
            return _signed_url("GET", key, {"download": "true", "filename": safe_name})
        return _signed_url("GET", key)

    @log_flow(layer="service")
    def put_object(self, item: StorageObject) -> None:
        path = UPLOAD_DIRECTORY / item.key
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(item.content)
        except OSError as exc:
            raise StorageError("Could not write the object to local storage.") from exc

    @log_flow(layer="service")
    def delete_object(self, key: str) -> None:
        try:
            (UPLOAD_DIRECTORY / key).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError("Could not delete the object from local storage.") from exc
