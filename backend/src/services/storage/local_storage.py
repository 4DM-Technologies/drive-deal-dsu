from src.services.storage.storage import Storage


class LocalStorage(Storage):
    def create_upload(self, key: str, content_type: str) -> dict:
        return {"driver": "local", "method": "PUT", "url": f"/api/v1/documents/local/{key}", "key": key, "headers": {"content-type": content_type}}
