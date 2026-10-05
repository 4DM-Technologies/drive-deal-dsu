from fastapi.testclient import TestClient

from main import app


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_administration_rbac_publish_and_public_theme() -> None:
    with TestClient(app) as client:
        buyer = login(client, "rahul@drivedeal.demo")
        assert client.get("/api/v1/administration/catalog", headers=buyer).status_code == 403

        administrator = login(client, "priya@drivedeal.demo")
        catalog = client.get("/api/v1/administration/catalog", headers=administrator)
        assert catalog.status_code == 200
        assert {node["id"] for node in catalog.json()["nodes"]} >= {"triage", "compose", "web_search_agent"}

        current = client.get("/api/v1/administration/config/theme/global", headers=administrator)
        assert current.status_code == 200
        active_version = current.json()["active"]["version"]

        draft = client.post(
            "/api/v1/administration/config/theme/global/draft",
            headers=administrator,
            json={
                "base_version": active_version,
                "payload": {"name": "Accessible cobalt", "primary_rgb": [18, 78, 168]},
            },
        )
        assert draft.status_code == 200, draft.text
        published = client.post(
            "/api/v1/administration/config/theme/global/publish",
            headers=administrator,
            json={"revision_id": draft.json()["id"]},
        )
        assert published.status_code == 200, published.text

        active = client.get("/api/v1/theme/active")
        assert active.status_code == 200
        assert active.json()["name"] == "Accessible cobalt"
        assert active.json()["version"] == published.json()["version"]
        assert len(client.get("/api/v1/administration/audit", headers=administrator).json()) >= 2

        exported = client.get("/api/v1/administration/export?format=yaml", headers=administrator)
        assert exported.status_code == 200
        assert "attachment;" in exported.headers["content-disposition"]
        assert "agents_and_prompts:" in exported.text
        assert "Sera" in exported.text
        assert "api_key" not in exported.text.lower()
