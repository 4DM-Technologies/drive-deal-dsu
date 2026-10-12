from typing import Literal

from pydantic import BaseModel, EmailStr, HttpUrl, ValidationInfo, field_validator

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

    supported_brand_ids: list[str]


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
