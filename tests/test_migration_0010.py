from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.core.config import get_settings


def test_migration_0010_up_down_and_legacy_compatibility(tmp_path, monkeypatch) -> None:
    database_path = (tmp_path / "migration.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    get_settings.cache_clear()
    config = Config("alembic.ini")

    command.upgrade(config, "head")
    inspector = inspect(create_engine(f"sqlite:///{database_path}"))
    assert {"longitude", "latitude"} <= {column["name"] for column in inspector.get_columns("parks")}
    assert {"park_id", "channel_type", "reporting_authorized", "city"} <= {
        column["name"] for column in inspector.get_columns("stores")
    }
    assert {"b02_inbox_events", "b02_service_nonces", "store_operation_summaries", "assistant_rate_windows"} <= set(
        inspector.get_table_names()
    )

    command.downgrade(config, "0009_single_device_sessions")
    inspector = inspect(create_engine(f"sqlite:///{database_path}"))
    assert "store_operation_summaries" not in inspector.get_table_names()
    command.upgrade(config, "head")
    get_settings.cache_clear()
