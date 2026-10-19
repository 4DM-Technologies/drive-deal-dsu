import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from src.auth.security import hash_password
from src.database import SessionFactory
from src.repositories.schema import Profile, User
from tests.demo_data import IDS

PASSWORD = "secure-test-password"


def create_account(role: str, name: str) -> Profile:
    async def _create() -> Profile:
        async with SessionFactory() as session:
            profile = Profile(
                state_id=IDS["tx"],
                full_name=name,
                email=f"{role}-{uuid4().hex[:8]}@example.com",
                role=role,
                phone="+12145550100",
            )
            session.add(profile)
            await session.flush()
            session.add(User(profile_id=profile.id, password_hash=hash_password(PASSWORD), is_active=True))
            await session.commit()
            return profile

    return asyncio.run(_create())


def signed_in(client: TestClient, profile: Profile) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": profile.email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_case_notes_name_the_support_user_who_wrote_them() -> None:
    buyer = create_account("buyer", "Rahul Buyer")
    agent = create_account("support", "Maya Agent")
    with TestClient(app) as client:
        buyer_headers, agent_headers = signed_in(client, buyer), signed_in(client, agent)
        ticket = client.post(
            "/api/v1/support/tickets", headers=buyer_headers, json={"issue_summary": "Cannot upload my licence"}
        ).json()

        updated = client.patch(
            f"/api/v1/support/queue/tickets/{ticket['id']}",
            headers=agent_headers,
            json={"status": "in_progress", "note": "Checked the upload logs."},
        )
        assert updated.status_code == 200, updated.text
        [note] = [entry for entry in updated.json()["notes"] if entry.get("note") == "Checked the upload logs."]
        assert note["actor_id"] == agent.id
        assert note["actor_name"] == "Maya Agent"

        # The queue list and the single ticket name the author too, not only the update response.
        queue = client.get("/api/v1/support/queue/tickets", headers=agent_headers).json()
        listed = next(item for item in queue if item["id"] == ticket["id"])
        assert listed["notes"][-1]["actor_name"] == "Maya Agent"
        single = client.get(f"/api/v1/support/tickets/{ticket['id']}", headers=buyer_headers).json()
        assert single["notes"][-1]["actor_name"] == "Maya Agent"
