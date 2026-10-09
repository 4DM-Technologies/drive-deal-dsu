from src.services.storage.storage import Storage, StorageError, StorageObject
from src.settings import UPLOAD_DIRECTORY
from src.utils.log_flow import log_flow


class LocalStorage(Storage):
    @log_flow(layer="service")
    def create_upload(self, key: str, content_type: str) -> dict:
        return {
            "driver": "local",
            "method": "PUT",
            "url": f"/api/v1/documents/local/{key}",
            "key": key,
            "headers": {"content-type": content_type},
        }

    @log_flow(layer="service")
    def create_download(self, key: str, *, as_attachment: bool = False, filename: str | None = None) -> str:
        if as_attachment:
            safe_name = (filename or key.rsplit("/", 1)[-1]).replace('"', "")
            return f"/api/v1/documents/local/{key}?download=true&filename={safe_name}"
        return f"/api/v1/documents/local/{key}"

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
