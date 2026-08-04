import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite://")

from app.core.config import Settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.user import User  # noqa: E402


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with session_factory() as session:
        yield session
    engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    settings = Settings(database_url="sqlite+pysqlite://", jwt_secret="test-secret-with-at-least-32-bytes", environment="test")
    app = create_app(settings)

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture()
def demo_user(db_session: Session) -> User:
    user = User(
        user_id="USER-001",
        username="demo_admin",
        password_hash=hash_password("demo-password"),
        role="park_admin",
        park_id="PARK-001",
        enterprise_ids=["ENT-001"],
    )
    db_session.add(user)
    db_session.commit()
    return user
