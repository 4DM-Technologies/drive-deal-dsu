import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

from src.settings import get_settings


def create_configured_database() -> None:
    """Create the configured PostgreSQL database when the RDS instance is empty."""
    url = make_url(get_settings().database_url)
    database_name = url.database
    if url.get_backend_name() != "postgresql" or not database_name:
        raise RuntimeError("DATABASE_URL must point to a named PostgreSQL database.")
    with psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname="postgres",
        sslmode="require",
        autocommit=True,
    ) as connection:
        exists = connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,)).fetchone()
        if exists:
            print(f"Database {database_name!r} already exists.")
            return
        connection.execute(sql.SQL("CREATE DATABASE {} ENCODING 'UTF8'").format(sql.Identifier(database_name)))
        print(f"Database {database_name!r} created.")


if __name__ == "__main__":
    create_configured_database()
