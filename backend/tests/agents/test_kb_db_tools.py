import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.agents.tools.kb_db import describe_schema, query_data, update_preferences, write_car
from src.database import SessionFactory
from src.repositories.schema import Brand, BuyerPreference, Car
from tests.demo_data import IDS


@pytest.fixture
def seeded_app() -> TestClient:
    with TestClient(app) as client:
        yield client


async def test_describe_schema_lists_tables_without_hardcoding(seeded_app: TestClient) -> None:
    schema = describe_schema()
    assert "cars" in schema
    assert "buyer_preference" in schema
    assert "price" in schema["cars"]
    assert "preferences" in schema["buyer_preference"]


async def test_preference_fields_round_trip_through_the_json_column(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        row = await session.get(BuyerPreference, IDS["buyer"])
        row.budget_max = 91000
        row.must_have_features = ["Adaptive cruise", "Tow package"]
        row.source = "advisor"
        await session.commit()

    async with SessionFactory() as session:
        reloaded = await session.get(BuyerPreference, IDS["buyer"])
        assert reloaded.budget_max == 91000
        assert reloaded.must_have_features == ["Adaptive cruise", "Tow package"]
        assert reloaded.preferences["budget_max"] == 91000


async def test_legacy_preference_array_reads_back_as_must_have_features() -> None:
    row = BuyerPreference(profile_id="buyer-legacy", created_by="buyer-legacy", updated_by="buyer-legacy")
    row.preferences = ["Third-row seating", "Roof rack"]  # shape written before the granular fields existed
    assert row.must_have_features == ["Third-row seating", "Roof rack"]
    assert row.body_type is None
    assert row.source == "advisor"


async def test_query_data_is_read_only_and_returns_rows(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        before = len((await session.execute(select(Car))).scalars().all())
        rows = await query_data(session, "cars", {"status": "available"}, limit=5)
        after = len((await session.execute(select(Car))).scalars().all())
        assert after == before  # no write path reachable
        assert isinstance(rows, list)
        assert all(row["status"] == "available" for row in rows)


async def test_query_data_rejects_unknown_table() -> None:
    async with SessionFactory() as session:
        with pytest.raises(ValueError):
            await query_data(session, "users; DROP TABLE users;--", {}, limit=5)


async def test_query_data_rejects_unknown_column() -> None:
    async with SessionFactory() as session:
        with pytest.raises(ValueError):
            await query_data(session, "cars", {"price = 0 OR 1=1": "x"}, limit=5)


async def test_update_preferences_only_touches_must_have_features(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        before = await session.get(BuyerPreference, IDS["buyer"])
        budget_before, brand_before = before.budget_max, before.brand_id

        await update_preferences(session, IDS["buyer"], ["Sunroof", "Heated seats"])
        await session.commit()

    async with SessionFactory() as session:
        after = await session.get(BuyerPreference, IDS["buyer"])
        assert after.must_have_features == ["Sunroof", "Heated seats"]
        assert after.budget_max == budget_before
        assert after.brand_id == brand_before


async def test_update_preferences_does_not_affect_other_profiles(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        other_before = await session.get(BuyerPreference, IDS["adithyaa"])
        other_features_before = list(other_before.must_have_features)

        await update_preferences(session, IDS["buyer"], ["4WD"])
        await session.commit()

    async with SessionFactory() as session:
        other_after = await session.get(BuyerPreference, IDS["adithyaa"])
        assert other_after.must_have_features == other_features_before  # untouched by the other profile's write


async def test_write_car_only_touches_cars_table(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        brand_count_before = len((await session.execute(select(Brand))).scalars().all())
        car_count_before = len((await session.execute(select(Car))).scalars().all())

        result = await write_car(
            session, created_by=IDS["buyer"], brand_id=IDS["ford"], state_id=IDS["tx"],
            model="F-150 Lightning", model_year=2026, price=54999.0,
        )
        await session.commit()

        brand_count_after = len((await session.execute(select(Brand))).scalars().all())
        car_count_after = len((await session.execute(select(Car))).scalars().all())

        assert brand_count_after == brand_count_before  # brands table untouched
        assert car_count_after == car_count_before + 1
        assert result["upserted"] == "created"


async def test_write_car_upserts_same_vehicle_instead_of_duplicating(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        first = await write_car(session, created_by=IDS["buyer"], brand_id=IDS["ford"], state_id=IDS["tx"], model="Mach-E", model_year=2026, price=45000.0)
        await session.commit()
    async with SessionFactory() as session:
        second = await write_car(session, created_by=IDS["buyer"], brand_id=IDS["ford"], state_id=IDS["tx"], model="Mach-E", model_year=2026, price=43000.0)
        await session.commit()
        car = await session.get(Car, first["id"])
        assert float(car.price) == 43000.0
    assert second["upserted"] == "updated"
    assert first["id"] == second["id"]
