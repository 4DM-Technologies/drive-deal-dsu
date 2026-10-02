from src.services.storage.storage import Storage
from src.utils.log_flow import log_flow


class LocalStorage(Storage):
    @log_flow(layer="service")
    def create_upload(self, key: str, content_type: str) -> dict:
        return {"driver": "local", "method": "PUT", "url": f"/api/v1/documents/local/{key}", "key": key, "headers": {"content-type": content_type}}

    @log_flow(layer="service")
    def create_download(self, key: str) -> str:
        return f"/api/v1/documents/local/{key}"
