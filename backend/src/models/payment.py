from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PaymentCreate(BaseModel):
    """Simulated card payment for a premium subscription.

    Card details are validated for shape only and are never persisted beyond the brand and the
    last four digits - the payment always succeeds, matching the frontend's mock checkout flow.
    """

    model_config = ConfigDict(extra="forbid")

    payment_method: Literal["credit_card", "debit_card"]
    card_number: str = Field(min_length=12, max_length=25)
    cardholder_name: str = Field(min_length=2, max_length=120)
    expiry_month: int = Field(ge=1, le=12)
    expiry_year: int = Field(ge=2020, le=2100)
    cvv: str = Field(min_length=3, max_length=4)

    @field_validator("card_number")
    @classmethod
    def digits_only(cls, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) < 12:
            raise ValueError("Card number must contain at least 12 digits")
        return digits

    @field_validator("cvv")
    @classmethod
    def cvv_digits(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Security code must be numeric")
        return value
