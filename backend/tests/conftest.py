import asyncio
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest

test_database = Path(tempfile.gettempdir()) / f"drivedeal-tests-{uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_database.as_posix()}"
os.environ["JWT_SECRET_KEY"] = "test-only-secret-that-is-long-enough-for-validation"
os.environ["CORS_ORIGINS"] = '["http://testserver"]'
os.environ["STORAGE_DRIVER"] = "local"
os.environ["AI_DISABLED"] = "true"
# Function-flow logging is asserted by tests/utils, so silence it here to keep test output readable.
os.environ["LOG_LEVEL"] = "WARNING"


@pytest.fixture(autouse=True)
def seeded_database() -> Iterator[None]:
    """Installs the demo dataset before every test.

    The application has no seeding code path, so this fixture owns it. The application imports are
    deliberately inside the function: importing ``src.database`` at module scope would create the
    engine from the real ``DATABASE_URL`` above, before these environment variables are set.
    """
    from src.database import dispose_engine
    from tests.demo_data import seed_database

    asyncio.run(seed_database())
    asyncio.run(dispose_engine())
    yield


@pytest.fixture(autouse=True)
def local_uploads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Points local file storage at a per-test directory so uploads never land in ``backend/uploads``."""
    import src.services.storage.local_storage as local_storage

    monkeypatch.setattr(local_storage, "UPLOAD_DIRECTORY", tmp_path)
    return tmp_path
