from fastapi.testclient import TestClient


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_meta_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/meta/dictionaries")

    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHENTICATED"


def test_meta_returns_confirmed_dictionary(client: TestClient, demo_user) -> None:
    login = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})
    access_token = login.json()["data"]["access_token"]
    response = client.get(
        "/api/v1/meta/dictionaries",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["currency"] == ["CNY"]
    assert "READY_TO_CONFIRM" in response.json()["data"]["import_batch_status"]

