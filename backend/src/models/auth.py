from typing import Literal

from pydantic import BaseModel, EmailStr, HttpUrl, field_validator


class SignupBase(BaseModel):
    full_name: str
    email: EmailStr
    phone: str
    password: str
    state_id: str
    address: str | None = None
    terms_accepted: bool
    terms_version: str

    @field_validator("full_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name is required")
        return value

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


class BuyerSignup(SignupBase):
    pass


class DealerSignup(SignupBase):
    dealership_name: str
    branch_name: str
    dealer_license: str
    website: HttpUrl
    supported_brand_ids: list[str]


class SupportSignup(SignupBase):
    extra_information: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class SessionProfile(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone: str
    role: Literal["buyer", "dealer", "support", "admin"]
    is_active: bool


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    profile: SessionProfile
