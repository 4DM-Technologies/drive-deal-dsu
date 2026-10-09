import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.agents.tools import kb_db
from src.agents.tools.kb_db import write_car
from src.database import SessionFactory
from src.repositories.schema import Brand, BuyerPreference, Car
from tests.demo_data import IDS


@pytest.fixture
def seeded_app() -> TestClient:
    with TestClient(app) as client:
        yield client


def test_unrestricted_table_reader_is_gone() -> None:
    """kb_agent used to hold query_data, which could read any table (users, payments). It now reads the vehicle
    catalog only, through catalog_tools.py, and kb_db keeps nothing but the cars-table writer."""
    assert not hasattr(kb_db, "query_data")
    assert not hasattr(kb_db, "describe_schema")
    assert not hasattr(kb_db, "update_preferences")


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


async def test_write_car_only_touches_cars_table(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        brand_count_before = len((await session.execute(select(Brand))).scalars().all())
        car_count_before = len((await session.execute(select(Car))).scalars().all())

        result = await write_car(
            session,
            created_by=IDS["buyer"],
            brand_id=IDS["ford"],
            state_id=IDS["tx"],
            model="F-150 Lightning",
            model_year=2026,
            price=54999.0,
        )
        await session.commit()

        brand_count_after = len((await session.execute(select(Brand))).scalars().all())
        car_count_after = len((await session.execute(select(Car))).scalars().all())

        assert brand_count_after == brand_count_before  # brands table untouched
        assert car_count_after == car_count_before + 1
        assert result["upserted"] == "created"


async def test_write_car_upserts_same_vehicle_instead_of_duplicating(seeded_app: TestClient) -> None:
    async with SessionFactory() as session:
        first = await write_car(
            session,
            created_by=IDS["buyer"],
            brand_id=IDS["ford"],
            state_id=IDS["tx"],
            model="Mach-E",
            model_year=2026,
            price=45000.0,
        )
        await session.commit()
    async with SessionFactory() as session:
        second = await write_car(
            session,
            created_by=IDS["buyer"],
            brand_id=IDS["ford"],
            state_id=IDS["tx"],
            model="Mach-E",
            model_year=2026,
            price=43000.0,
        )
        await session.commit()
        car = await session.get(Car, first["id"])
        assert float(car.price) == 43000.0
    assert second["upserted"] == "updated"
    assert first["id"] == second["id"]
