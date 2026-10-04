from src.services.storage.storage import Storage
from src.utils.log_flow import log_flow


class LocalStorage(Storage):
    @log_flow(layer="service")
    def create_upload(self, key: str, content_type: str) -> dict:
        return {"driver": "local", "method": "PUT", "url": f"/api/v1/documents/local/{key}", "key": key, "headers": {"content-type": content_type}}

    @log_flow(layer="service")
    def create_download(self, key: str, *, as_attachment: bool = False, filename: str | None = None) -> str:
        if as_attachment:
            safe_name = (filename or key.rsplit("/", 1)[-1]).replace('"', "")
            return f"/api/v1/documents/local/{key}?download=true&filename={safe_name}"
        return f"/api/v1/documents/local/{key}"
