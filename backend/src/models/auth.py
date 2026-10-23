from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, HttpUrl, ValidationInfo, field_validator, model_validator

# Each part stays short enough that "first last" always fits the 160-character profiles.full_name column.
NAME_PART_MAX_LENGTH = 75


def clean_name_part(value: str, label: str) -> str:
    """A trimmed first or last name; required and at most ``NAME_PART_MAX_LENGTH`` characters."""
    value = value.strip()
    if not value:
        raise ValueError(f"{label} is required")
    if len(value) > NAME_PART_MAX_LENGTH:
        raise ValueError(f"{label} must be at most {NAME_PART_MAX_LENGTH} characters")
    return value


class SignupBase(BaseModel):
    email: EmailStr
    phone: str
    password: str
    state_id: str
    address: str | None = None
    terms_accepted: bool
    terms_version: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Password must contain at least 8 characters")
        return value

    @field_validator("terms_accepted")
    @classmethod
    def require_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Terms must be accepted")
        return value


class FullNameSignup(SignupBase):
    """Dealer and support applications still give one full name."""

    full_name: str

    @field_validator("full_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name is required")
        return value


class BuyerSignup(SignupBase):
    """Buyers give a first and last name; ``full_name`` (the display name used everywhere else) is built from them."""

    first_name: str
    last_name: str

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_name_part(cls, value: str, info: ValidationInfo) -> str:
        return clean_name_part(value, "First name" if info.field_name == "first_name" else "Last name")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


# Brands a dealer types under "Other" (see services/dealer_brands.py).
MAX_OTHER_BRANDS = 10
OTHER_BRAND_MIN_LENGTH = 2
OTHER_BRAND_MAX_LENGTH = 60


def clean_other_brands(values: Iterable[str]) -> list[str]:
    """Trims and de-duplicates typed brand names (ignoring case), keeping the first spelling. Raises ValueError."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        name = " ".join(str(value).split())
        if not name:
            continue
        if not OTHER_BRAND_MIN_LENGTH <= len(name) <= OTHER_BRAND_MAX_LENGTH:
            raise ValueError(
                f"Brand names must be {OTHER_BRAND_MIN_LENGTH} to {OTHER_BRAND_MAX_LENGTH} characters: “{name[:60]}”."
            )
        if name.casefold() not in seen:
            seen.add(name.casefold())
            cleaned.append(name)
    if len(cleaned) > MAX_OTHER_BRANDS:
        raise ValueError(f"Add up to {MAX_OTHER_BRANDS} other brands.")
    return cleaned


class DealerSignup(FullNameSignup):
    dealership_name: str
    branch_name: str
    dealer_license: str
    website: HttpUrl | None = None

    @field_validator("website", mode="before")
    @classmethod
    def blank_website_is_none(cls, value: object) -> object:
        # The website is optional; an empty field means the dealership has none.
        return None if isinstance(value, str) and not value.strip() else value

    supported_brand_ids: list[str] = Field(default_factory=list, max_length=60)
    other_brands: list[str] = Field(default_factory=list)

    @field_validator("other_brands")
    @classmethod
    def validate_other_brands(cls, value: list[str]) -> list[str]:
        return clean_other_brands(value)

    @model_validator(mode="after")
    def require_a_brand(self) -> "DealerSignup":
        if not self.supported_brand_ids and not self.other_brands:
            raise ValueError("Choose at least one brand your dealership sells.")
        return self


class SupportSignup(FullNameSignup):
    extra_information: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class SessionProfile(BaseModel):
    id: str
    full_name: str
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr
    phone: str
    role: Literal["buyer", "dealer", "support", "support-admin", "admin"]
    is_active: bool


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    profile: SessionProfile
