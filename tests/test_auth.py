from fastapi.testclient import TestClient

from app.models.user import User


def auth_headers(response) -> dict[str, str]:
    access_token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


def test_login_and_me(client: TestClient, demo_user: User) -> None:
    login = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})

    assert login.status_code == 200
    assert login.json()["code"] == "OK"
    assert login.json()["data"]["token_type"] == "bearer"

    me = client.get("/api/v1/auth/me", headers=auth_headers(login))

    assert me.status_code == 200
    assert me.json()["data"] == {
        "user_id": "USER-001",
        "username": "demo_admin",
        "role": "park_admin",
        "park_id": "PARK-001",
        "enterprise_ids": ["ENT-001"],
    }


def test_invalid_login_is_unified_error(client: TestClient, demo_user: User) -> None:
    response = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "wrong"})

    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHENTICATED"
    assert response.json()["data"] is None
    assert response.json()["errors"] == []


def test_logout_revokes_refresh_token(client: TestClient, demo_user: User) -> None:
    login = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})
    refresh_token = login.json()["data"]["refresh_token"]

    logout = client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refresh_token},
        headers=auth_headers(login),
    )
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    me = client.get("/api/v1/auth/me", headers=auth_headers(login))

    assert logout.status_code == 200
    assert logout.json()["data"] == {"logged_out": True}
    assert refreshed.status_code == 401
    assert refreshed.json()["code"] == "UNAUTHENTICATED"
    assert me.status_code == 401


def test_new_login_invalidates_previous_device(client: TestClient, demo_user: User) -> None:
    first = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})
    second = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})

    old_me = client.get("/api/v1/auth/me", headers=auth_headers(first))
    old_refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": first.json()["data"]["refresh_token"]})
    current_me = client.get("/api/v1/auth/me", headers=auth_headers(second))

    assert old_me.status_code == 401
    assert old_refresh.status_code == 401
    assert current_me.status_code == 200
