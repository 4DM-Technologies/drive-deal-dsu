from abc import ABC, abstractmethod


class Storage(ABC):
    @abstractmethod
    def create_upload(self, key: str, content_type: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def create_download(self, key: str) -> str:
        raise NotImplementedError
