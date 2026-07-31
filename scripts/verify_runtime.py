from pathlib import Path
import sys

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    expected_heads = set(ScriptDirectory.from_config(config).get_heads())
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        current_heads = set(MigrationContext.configure(connection).get_current_heads())
    require(current_heads == expected_heads, f"Database migration mismatch: current={current_heads}, expected={expected_heads}")

    public_paths = [
        "/api/v1/public/dashboard/overview",
        "/api/v1/public/dashboard/capacity",
        "/api/v1/public/dashboard/preorders",
        "/api/v1/public/dashboard/transport",
        "/api/v1/public/dashboard/policies",
        "/api/v1/public/dashboard/news",
    ]
    with TestClient(app) as client:
        health = client.get("/healthz")
        require(health.status_code == 200 and health.json().get("status") == "ok", "Health check failed.")
        openapi = client.get("/openapi.json")
        require(openapi.status_code == 200, "OpenAPI document is unavailable.")
        require(public_paths[-1] in openapi.json().get("paths", {}), "The public news endpoint is missing from OpenAPI.")
        for path in public_paths:
            response = client.get(path)
            payload = response.json()
            require(response.status_code == 200, f"{path} returned HTTP {response.status_code}.")
            require(payload.get("code") == "OK" and "data" in payload, f"{path} returned an invalid envelope.")
        unauthorized = client.get("/api/v1/auth/me")
        require(unauthorized.status_code == 401, "Protected E01 endpoints must reject unauthenticated requests.")
        preflight = client.options(
            public_paths[0],
            headers={"Origin": "http://localhost:8080", "Access-Control-Request-Method": "GET"},
        )
        require(preflight.status_code == 200, "Local frontend CORS preflight failed.")
        require(preflight.headers.get("access-control-allow-origin") == "http://localhost:8080", "Local frontend origin is not allowed.")

    print(f"Local runtime verification passed: PostgreSQL head={','.join(sorted(expected_heads))}, {len(public_paths)} public endpoints.")


if __name__ == "__main__":
    main()
