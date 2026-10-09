"""Vehicle catalog normalization rules and database sync (CATALOG_DATA_FINDINGS.md sections 6 and 7)."""

import csv
import io
import zipfile

import pytest
from sqlalchemy import select

from src.services.catalog import normalize
from src.services.catalog.normalize import build_variants, normalize_row
from src.services.catalog.sync import CatalogValidationError, read_epa_rows, sync_catalog, validate


def epa_row(**overrides: str) -> dict[str, str]:
    row = {
        "id": "47977",
        "year": "2025",
        "make": "BMW",
        "model": "M3 Competition Sedan",
        "baseModel": "M",
        "VClass": "Compact Cars",
        "atvType": "",
        "fuelType": "Premium",
        "eng_dscr": "SIDI",
        "trany": "Automatic (S8)",
        "drive": "Rear-Wheel Drive",
        "cylinders": "6",
        "displ": "3.0",
        "tCharger": "T",
        "sCharger": "",
        "city08": "16",
        "highway08": "23",
        "comb08": "19",
        "range": "0",
        "rangeA": "",
    }
    return {**row, **overrides}


def test_bmw_m_models_get_their_own_family_and_a_clean_trim() -> None:
    record = normalize_row(epa_row())
    assert record.family == "M3"
    assert record.name == "M3 Competition Sedan"
    assert record.trim_name == "Competition"
    assert record.body_style == "Sedan"
    assert record.engine == "6 cyl 3.0 L Turbo"
    assert (record.transmission, record.drive_type, record.fuel_type) == ("Automatic", "RWD", "Gasoline")
    assert (record.mpg_city, record.mpg_highway, record.mpg_combined, record.ev_range_miles) == (16, 23, 19, None)


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"atvType": "EV"}, "Electric"),
        ({"atvType": "Plug-in Hybrid"}, "Plug-in hybrid"),
        ({"atvType": "Hybrid", "eng_dscr": "SIDI & PFI; Mild Hybrid"}, "Mild hybrid"),
        ({"atvType": "Hybrid", "eng_dscr": "HEV"}, "Hybrid"),
        ({"atvType": "FCV"}, "Hydrogen"),
        ({"atvType": "Diesel"}, "Diesel"),
        ({"atvType": "", "fuelType": "Diesel"}, "Diesel"),
        ({"atvType": "FFV"}, "Flex fuel"),
        ({"atvType": ""}, "Gasoline"),
    ],
)
def test_fuel_type_comes_from_the_alternative_fuel_flag(overrides: dict, expected: str) -> None:
    assert normalize.fuel_type(epa_row(**overrides)) == expected


@pytest.mark.parametrize(
    ("vehicle_class", "name", "family", "expected"),
    [
        ("Small Sport Utility Vehicle 4WD", "X3 xDrive30i", "X3", "SUV"),
        ("Standard Pickup Trucks 4WD", "F150 Pickup", "F150", "Truck"),
        ("Minivan - 2WD", "Sienna", "Sienna", "Minivan"),
        ("Special Purpose Vehicle 2WD", "Transit Connect Van", "Transit Connect", "Van"),
        ("Special Purpose Vehicle 4WD", "Wrangler", "Wrangler", "SUV"),
        ("Small Station Wagons", "A4 allroad quattro", "A4 allroad", "Wagon"),
        ("Subcompact Cars", "430i Convertible", "4 Series", "Convertible"),
        ("Midsize Cars", "Civic 5Dr", "Civic", "Hatchback"),
        ("Compact Cars", "GTI", "GTI", "Hatchback"),
        ("Subcompact Cars", "430i Coupe", "4 Series", "Coupe"),
        ("Compact Cars", "430i Gran Coupe", "4 Series", "Sedan"),
        ("Two Seaters", "911 Carrera", "911", "Coupe"),
        ("Midsize Cars", "Camry", "Camry", "Sedan"),
    ],
)
def test_body_style_rules(vehicle_class: str, name: str, family: str, expected: str) -> None:
    assert normalize.body_style(vehicle_class, name, family) == expected


def test_names_drop_wheel_sizes_and_drive_words() -> None:
    assert normalize.clean_name("i5 eDrive40 Sedan (19 inch Wheels)") == "i5 eDrive40 Sedan"
    assert normalize.clean_name("F150 Pickup 4WD HEV") == "F150 Pickup HEV"
    assert normalize.clean_name("X5 xDrive40i") == "X5 xDrive40i"


def test_electric_and_plug_in_ranges_use_the_right_columns() -> None:
    ev = normalize_row(epa_row(atvType="EV", range="300", cylinders="", displ=""))
    plug_in = normalize_row(epa_row(atvType="Plug-in Hybrid", range="360", rangeA="33"))
    assert (ev.engine, ev.ev_range_miles) == ("Electric motor", 300)
    assert plug_in.ev_range_miles == 33


def test_wheel_sizes_and_test_configurations_merge_into_one_variant() -> None:
    rows = [
        epa_row(id="2", model="i5 eDrive40 Sedan (20 inch Wheels)", baseModel="i5", atvType="EV", comb08="98"),
        epa_row(id="1", model="i5 eDrive40 Sedan (19 inch Wheels)", baseModel="i5", atvType="EV", comb08="105"),
        epa_row(id="10", model="Mustang", baseModel="Mustang", make="Ford", eng_dscr="with Stop-Start", comb08="18"),
        epa_row(id="11", model="Mustang", baseModel="Mustang", make="Ford", eng_dscr="", comb08="17"),
        epa_row(id="99", model="Silverado Cab Chassis 2WD", baseModel="Silverado", make="Chevrolet"),
    ]
    report = build_variants(rows, {2025})
    by_name = {record.name: record for record in report.variants}
    assert set(by_name) == {"i5 eDrive40 Sedan", "Mustang"}
    assert by_name["i5 eDrive40 Sedan"].epa_vehicle_ids == ["1", "2"]
    assert by_name["i5 eDrive40 Sedan"].mpg_combined == 105
    assert by_name["Mustang"].epa_vehicle_ids == ["10", "11"]
    assert by_name["Mustang"].mpg_combined == 17  # the record without "Stop-Start" is the representative
    assert (report.excluded_rows, report.merged_groups) == (1, 2)


def test_validation_rejects_a_wrong_m3_lineup() -> None:
    report = build_variants([epa_row()], {2025})
    with pytest.raises(CatalogValidationError, match="M3"):
        validate(report, [2025])


async def clear_catalog() -> None:
    """Empty the three catalog tables, so catalog tests never see each other's rows."""
    from sqlalchemy import delete

    from src.database import SessionFactory
    from src.repositories.schema import CatalogMake, CatalogModel, CatalogVariant
    from src.services.catalog.matcher import invalidate_catalog_index

    async with SessionFactory() as session:
        for table in (CatalogVariant, CatalogModel, CatalogMake):
            await session.execute(delete(table))
        await session.commit()
    invalidate_catalog_index()


def write_zip(path, rows: list[dict[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("vehicles.csv", buffer.getvalue())


async def test_sync_is_idempotent_links_brands_and_deactivates_removed_variants(tmp_path) -> None:
    from src.database import SessionFactory, dispose_engine
    from src.repositories.schema import Brand, CatalogMake, CatalogModel, CatalogVariant

    rows = [
        epa_row(id="1", model="M3 Sedan", trany="Manual 6-spd"),
        epa_row(id="2"),
        epa_row(
            id="3",
            model="X5 xDrive40i",
            baseModel="X5",
            VClass="Standard Sport Utility Vehicle 4WD",
            drive="All-Wheel Drive",
        ),
    ]
    archive = tmp_path / "vehicles.csv.zip"
    write_zip(archive, rows)
    await clear_catalog()
    try:
        async with SessionFactory() as session:
            first = await sync_catalog(session, read_epa_rows(archive), [2025], run_validation=False)
            await session.commit()
            assert (first.makes_inserted, first.models_inserted, first.variants_inserted) == (1, 2, 3)

            second = await sync_catalog(session, read_epa_rows(archive), [2025], run_validation=False)
            await session.commit()
            assert not second.changed

            make = (await session.scalars(select(CatalogMake).where(CatalogMake.slug == "bmw"))).one()
            bmw_brand = (await session.scalars(select(Brand).where(Brand.name == "BMW"))).one_or_none()
            assert make.brand_id == (bmw_brand.id if bmw_brand else None)

            write_zip(archive, rows[:2])  # the X5 disappears from the source file
            third = await sync_catalog(session, read_epa_rows(archive), [2025], run_validation=False)
            await session.commit()
            assert third.variants_deactivated == 1
            x5 = (await session.scalars(select(CatalogModel).where(CatalogModel.slug == "x5"))).one()
            assert x5.is_active is False
            active = (await session.scalars(select(CatalogVariant).where(CatalogVariant.is_active.is_(True)))).all()
            assert sorted(variant.name for variant in active) == ["M3 Competition Sedan", "M3 Sedan"]
    finally:
        await dispose_engine()
