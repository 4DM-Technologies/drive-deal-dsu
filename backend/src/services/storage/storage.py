from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class StorageError(RuntimeError):
    """The storage backend could not complete a write or delete."""


@dataclass(frozen=True)
class StorageObject:
    """Bytes bound for storage. ``content`` is kept out of ``repr`` so function-flow logging never renders file bytes."""

    key: str
    content: bytes = field(repr=False)
    content_type: str


class Storage(ABC):
    @abstractmethod
    def create_upload(self, key: str, content_type: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def create_download(self, key: str, *, as_attachment: bool = False, filename: str | None = None) -> str:
        raise NotImplementedError

    @abstractmethod
    def put_object(self, item: StorageObject) -> None:
        """Writes ``item`` server-side; raises ``StorageError`` when the backend refuses it."""
        raise NotImplementedError

    @abstractmethod
    def delete_object(self, key: str) -> None:
        """Removes ``key``; deleting a key that does not exist is not an error."""
        raise NotImplementedError
