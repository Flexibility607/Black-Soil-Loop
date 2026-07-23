from fastapi.testclient import TestClient

from app.models.user import User


def headers(client: TestClient) -> dict[str, str]:
    login = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})
    access_token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


def test_dashboard_calculation_missing_data_and_public_read(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    overview = client.get("/api/v1/dashboard/overview", headers=auth)
    material_demand = client.get("/api/v1/analytics/material-demand", headers=auth)
    freezer_summary = client.get("/api/v1/freezers/summary", headers=auth)
    route_estimate = client.post("/api/v1/routes/estimate", headers=auth, json={})
    public_overview = client.get("/api/v1/public/dashboard/overview")
    public_capacity = client.get("/api/v1/public/dashboard/capacity")

    assert overview.status_code == 200
    assert overview.json()["data"]["enterprise_count"] == 0
    assert material_demand.status_code == 200
    assert material_demand.json()["data"]["calculation_status"] == "DATA_MISSING"
    assert freezer_summary.json()["data"]["calculation_status"] == "DATA_MISSING"
    assert route_estimate.json()["data"]["calculation_status"] == "DATA_MISSING"
    assert public_overview.status_code == 200
    assert public_capacity.status_code == 200
    assert isinstance(public_capacity.json()["data"], list)
