"""Vehicle catalog: makes, model families and per-year variants.

Revision ID: 20261009_0008
Revises: 20261006_0007
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261009_0008"
down_revision: str | None = "20261006_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copies of the allowed values so this migration never changes when application code does.
BODY_STYLES = ("SUV", "Sedan", "Coupe", "Convertible", "Hatchback", "Wagon", "Truck", "Minivan", "Van")
FUEL_TYPES = ("Gasoline", "Mild hybrid", "Hybrid", "Plug-in hybrid", "Electric", "Diesel", "Flex fuel", "Hydrogen")
TRANSMISSIONS = ("Automatic", "Manual")
DRIVE_TYPES = ("AWD", "4WD", "FWD", "RWD")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
    ]


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Development startup runs Base.metadata.create_all, so the tables may already exist there.
    if not _table_exists("catalog_makes"):
        op.create_table(
            "catalog_makes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("slug", sa.String(length=80), nullable=False),
            sa.Column("brand_id", sa.String(length=36), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            *_audit_columns(),
            sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
            sa.UniqueConstraint("slug"),
        )
        op.create_index("ix_catalog_makes_brand_id", "catalog_makes", ["brand_id"])

    if not _table_exists("catalog_models"):
        op.create_table(
            "catalog_models",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("make_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            *_audit_columns(),
            sa.ForeignKeyConstraint(["make_id"], ["catalog_makes.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("make_id", "slug", name="uq_catalog_models_make_slug"),
        )
        op.create_index("ix_catalog_models_make_id", "catalog_models", ["make_id"])

    if not _table_exists("catalog_variants"):
        op.create_table(
            "catalog_variants",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("model_id", sa.String(length=36), nullable=False),
            sa.Column("model_year", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("trim_name", sa.String(length=120), nullable=True),
            sa.Column("body_style", sa.String(length=30), nullable=False),
            sa.Column("engine", sa.String(length=120), nullable=False),
            sa.Column("transmission", sa.String(length=20), nullable=False),
            sa.Column("drive_type", sa.String(length=10), nullable=False),
            sa.Column("fuel_type", sa.String(length=20), nullable=False),
            sa.Column("mpg_city", sa.Integer(), nullable=True),
            sa.Column("mpg_highway", sa.Integer(), nullable=True),
            sa.Column("mpg_combined", sa.Integer(), nullable=True),
            sa.Column("ev_range_miles", sa.Integer(), nullable=True),
            sa.Column("epa_vehicle_ids", sa.JSON(), nullable=False),
            sa.Column("source_payload", sa.JSON(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            *_audit_columns(),
            sa.ForeignKeyConstraint(["model_id"], ["catalog_models.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "model_id",
                "model_year",
                "name",
                "engine",
                "transmission",
                "drive_type",
                "fuel_type",
                name="uq_catalog_variants_configuration",
            ),
            sa.CheckConstraint(_in_list("body_style", BODY_STYLES), name="ck_catalog_variants_body_style"),
            sa.CheckConstraint(_in_list("fuel_type", FUEL_TYPES), name="ck_catalog_variants_fuel_type"),
            sa.CheckConstraint(_in_list("transmission", TRANSMISSIONS), name="ck_catalog_variants_transmission"),
            sa.CheckConstraint(_in_list("drive_type", DRIVE_TYPES), name="ck_catalog_variants_drive_type"),
            sa.CheckConstraint("model_year BETWEEN 1984 AND 2100", name="ck_catalog_variants_model_year"),
        )
        op.create_index("ix_catalog_variants_model_year", "catalog_variants", ["model_id", "model_year"])
        op.create_index("ix_catalog_variants_body_style", "catalog_variants", ["body_style"])


def downgrade() -> None:
    op.drop_table("catalog_variants")
    op.drop_table("catalog_models")
    op.drop_table("catalog_makes")
