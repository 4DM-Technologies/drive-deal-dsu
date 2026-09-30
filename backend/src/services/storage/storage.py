from abc import ABC, abstractmethod


class Storage(ABC):
    @abstractmethod
    def create_upload(self, key: str, content_type: str) -> dict:
        raise NotImplementedError
