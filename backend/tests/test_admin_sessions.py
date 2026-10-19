import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from src.auth.security import hash_password
from src.database import SessionFactory
from src.repositories.schema import AiTrace, ConversationHistory, Profile, User
from src.services.administration_service import reply_preview
from tests.demo_data import IDS

PASSWORD = "secure-test-password"
START = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def create_account(role: str) -> Profile:
    email = f"{role}-{uuid4().hex[:8]}@example.com"

    async def _create() -> Profile:
        async with SessionFactory() as session:
            profile = Profile(
                state_id=IDS["tx"], full_name=f"Test {role}", email=email, role=role, phone="+12145550100"
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


def trace(thread_id: str, user_id: str, query: str, minutes: int, **extra) -> AiTrace:
    return AiTrace(
        id=str(uuid4()),
        thread_id=thread_id,
        user_id=user_id,
        query=query,
        status=extra.pop("status", "success"),
        route=extra.pop("route", "advice"),
        model_name="gpt-test",
        input_tokens=extra.pop("input_tokens", 100),
        output_tokens=extra.pop("output_tokens", 50),
        duration_ms=extra.pop("duration_ms", 1000),
        created_at=START + timedelta(minutes=minutes),
        **extra,
    )


def turn(thread_id: str, user_id: str, user: str, assistant: str, minutes: int, **metadata) -> ConversationHistory:
    return ConversationHistory(
        thread_id=thread_id,
        checkpoint_id=str(uuid4()),
        user_id=user_id,
        thread_type="sera",
        checkpoint={"user": user, "assistant": assistant},
        metadata_json={"title": metadata.pop("title", user[:72]), **metadata},
        created_at=START + timedelta(minutes=minutes, seconds=5),
    )


def save(*rows) -> None:
    async def _save() -> None:
        async with SessionFactory() as session:
            session.add_all(rows)
            await session.commit()

    asyncio.run(_save())


def test_session_lists_every_turn_in_order_with_replies_user_and_totals() -> None:
    admin, buyer = create_account("support-admin"), create_account("buyer")
    thread_id = f"thread-{uuid4().hex[:10]}"
    first = trace(thread_id, buyer.id, "show me 5 best sedan cars", 0, input_tokens=300, output_tokens=200)
    second = trace(thread_id, buyer.id, "fine i want camry", 2, status="error", duration_ms=3000)
    # A trace from another conversation must never leak into this session.
    other = trace(f"thread-{uuid4().hex[:10]}", buyer.id, "unrelated", 1)
    save(
        first,
        second,
        other,
        # The newer turn carries its trace id; the older one is matched by query and time.
        turn(thread_id, buyer.id, "show me 5 best sedan cars", "## Top sedans\nCamry, Accord and Civic.", 0),
        turn(
            thread_id,
            buyer.id,
            "fine i want camry",
            "Great choice.",
            2,
            title="Buying request: Camry",
            trace_id=second.id,
        ),
    )

    with TestClient(app) as client:
        response = client.get(f"/api/v1/administration/sessions/{thread_id}", headers=signed_in(client, admin))
    assert response.status_code == 200, response.text
    session = response.json()

    assert session["thread_id"] == thread_id
    assert session["title"] == "Buying request: Camry"
    assert session["type"] == "sera" and session["type_label"] == "Ask Sera"
    assert session["user"] == {"id": buyer.id, "name": buyer.full_name, "email": buyer.email, "role": "buyer"}
    assert [item["id"] for item in session["traces"]] == [first.id, second.id]
    assert [item["reply_preview"] for item in session["traces"]] == [
        "Top sedans Camry, Accord and Civic.",
        "Great choice.",
    ]
    assert session["totals"] == {
        "turns": 2,
        "input_tokens": 400,
        "output_tokens": 250,
        "average_duration_ms": 2000,
        "failed": 1,
    }


def test_trace_detail_names_its_session() -> None:
    admin, buyer = create_account("support-admin"), create_account("buyer")
    thread_id = f"thread-{uuid4().hex[:10]}"
    item = trace(thread_id, buyer.id, "hey", 0)
    save(item, turn(thread_id, buyer.id, "hey", "Hi!", 0, title="Hello Sera"))

    with TestClient(app) as client:
        detail = client.get(f"/api/v1/administration/traces/{item.id}", headers=signed_in(client, admin)).json()
    assert detail["session"] == {"thread_id": thread_id, "title": "Hello Sera"}


def test_preview_sessions_without_saved_turns_get_a_readable_name() -> None:
    admin = create_account("support-admin")
    thread_id = f"preview-{uuid4().hex[:10]}"
    save(trace(thread_id, admin.id, "test the workflow", 0, is_test=True))

    with TestClient(app) as client:
        session = client.get(f"/api/v1/administration/sessions/{thread_id}", headers=signed_in(client, admin)).json()
    assert session["title"] == "Workflow preview"
    assert session["type"] == "preview"
    assert session["traces"][0]["reply_preview"] is None


def test_unknown_session_is_404_and_only_administrators_can_read_sessions() -> None:
    admin, buyer = create_account("support-admin"), create_account("buyer")
    with TestClient(app) as client:
        missing = client.get("/api/v1/administration/sessions/no-such-thread", headers=signed_in(client, admin))
        forbidden = client.get("/api/v1/administration/sessions/no-such-thread", headers=signed_in(client, buyer))
    assert missing.status_code == 404
    assert forbidden.status_code == 403


def test_reply_preview_is_one_short_line() -> None:
    assert reply_preview(None) is None
    assert reply_preview("## Heading\n\nSome   text") == "Heading Some text"
    long = reply_preview("word " * 200)
    assert long is not None and len(long) == 280 and long.endswith("…")
