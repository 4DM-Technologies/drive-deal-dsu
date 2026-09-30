import os
import tempfile
from pathlib import Path
from uuid import uuid4

test_database = Path(tempfile.gettempdir()) / f"drivedeal-tests-{uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_database.as_posix()}"
os.environ["AUTO_SEED_DEMO"] = "true"
os.environ["STORAGE_DRIVER"] = "local"
os.environ["AI_DISABLED"] = "true"
