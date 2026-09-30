from src.services.storage.local_storage import LocalStorage
from src.services.storage.s3_storage import S3Storage
from src.settings import get_settings


def get_storage():
    return S3Storage() if get_settings().storage_driver == "s3" else LocalStorage()


__all__ = ["get_storage"]
