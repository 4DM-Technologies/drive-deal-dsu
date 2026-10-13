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


def test_trace_summary_totals_every_trace_not_just_the_listed_page() -> None:
    import asyncio

    from sqlalchemy import delete

    from src.database import SessionFactory
    from src.repositories.schema import AiTrace

    async def reset_and_seed() -> None:
        async with SessionFactory() as session:
            await session.execute(delete(AiTrace))
            session.add_all(
                AiTrace(
                    query=f"q{index}",
                    status=status,
                    is_test=is_test,
                    input_tokens=100 + index,
                    output_tokens=10 * index,
                    duration_ms=1000 * (index + 1),
                )
                for index, (status, is_test) in enumerate(
                    [("success", False), ("success", True), ("error", False), ("running", False)]
                )
            )
            await session.commit()

    asyncio.run(reset_and_seed())
    with TestClient(app) as client:
        administrator = login(client, "priya@drivedeal.demo")
        summary = client.get("/api/v1/administration/traces/summary", headers=administrator)
        assert summary.status_code == 200, summary.text
        assert summary.json() == {
            "total_traces": 4,
            "test_runs": 1,
            "input_tokens": 100 + 101 + 102 + 103,
            "output_tokens": 0 + 10 + 20 + 30,
            "average_duration_ms": 2500,
            "failed": 1,  # the running trace is in progress, not failed
        }
        # Only administrators may read it, and "summary" is not mistaken for a trace id.
        assert (
            client.get(
                "/api/v1/administration/traces/summary", headers=login(client, "rahul@drivedeal.demo")
            ).status_code
            == 403
        )
        assert len(client.get("/api/v1/administration/traces", headers=administrator).json()) == 4
