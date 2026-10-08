from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


class MoneyModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", when_used="json", check_fields=False)
    def serialize_decimal(self, value: object) -> object:
        return f"{value:.2f}" if isinstance(value, Decimal) else value


class RequestCreate(BaseModel):
    brand_id: str
    buyer_area_state_id: str
    model: str
    body_type: str | None = None
    fuel_type: str | None = None
    year_min: int | None = Field(default=None, ge=1990, le=2035)
    year_max: int | None = Field(default=None, ge=1990, le=2035)
    trim: str | None = None
    drivetrain: str | None = None
    transmission: str | None = None
    color: str | None = None
    budget_min: Decimal | None = Field(default=None, ge=0)
    budget_max: Decimal | None = Field(default=None, ge=0)
    target_otd_price: Decimal | None = Field(default=None, ge=0)
    buyer_area: str
    search_radius_miles: int = Field(default=50, gt=0, le=500)
    timeline: Literal["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"]
    condition: str | None = None
    must_haves: list[str] = Field(default_factory=list)
    trade_in: dict | None = None
    paying_with: str | None = None
    additional_information: str | None = None
    request_expire: datetime
    status: Literal["draft", "open"] = "draft"


class QuoteCreate(BaseModel):
    buyer_request_id: str
    vehicle_price: Decimal = Field(gt=0)
    doc_fee: Decimal = Field(default=Decimal("0"), ge=0)
    sales_tax: Decimal = Field(default=Decimal("0"), ge=0)
    title_reg: Decimal = Field(default=Decimal("0"), ge=0)
    trade_in_credit: Decimal = Field(default=Decimal("0"), ge=0)
    message: str | None = None
    expires_at: datetime


class QuoteRevision(BaseModel):
    vehicle_price: Decimal | None = Field(default=None, gt=0)
    doc_fee: Decimal | None = Field(default=None, ge=0)
    sales_tax: Decimal | None = Field(default=None, ge=0)
    title_reg: Decimal | None = Field(default=None, ge=0)
    trade_in_credit: Decimal | None = Field(default=None, ge=0)
    message: str | None = None


class ChatRequestCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class ChatDeclineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ChatSend(BaseModel):
    id: str
    message: str = Field(min_length=1, max_length=4000)


class DealStatusUpdate(BaseModel):
    status: Literal["paperwork_going_on", "funds_arrived", "dispatch", "delivery", "completed", "cancelled"]


class TicketCreate(BaseModel):
    issue_summary: str = Field(min_length=5, max_length=200)
    issue_description: str | None = Field(default=None, max_length=10000)
    issue_type: Literal["bug", "incorrect_data", "account_access", "other"] = "bug"
    page_context: str | None = Field(default=None, max_length=500)
    issue_image_url: str | None = Field(default=None, max_length=2048)
    priority: Literal["low", "medium", "high", "urgent"] = "medium"


class TicketUpdate(BaseModel):
    status: Literal["open", "in_progress", "on_hold", "resolved", "closed"] | None = None
    note: str | None = None
    rca: str | None = None


class VerificationDecision(BaseModel):
    decision: Literal["approved", "denied", "rejected"]
    reason: str = Field(min_length=3, max_length=2000)


class VerificationReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class SupportRoleUpdate(BaseModel):
    role: Literal["support", "support-admin"]


class AiChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    thread_id: str | None = None
    agent: Literal["sera-agent", "compare-agent"] = "sera-agent"
    request_ids: list[str] = Field(default_factory=list, max_length=5)
    quote_ids: list[str] = Field(default_factory=list, max_length=5, exclude=True)
    request_context: dict | None = None


class AiGuidedMessage(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    role: Literal["user", "assistant"]
    body: str = Field(max_length=8000)
    guided_step: str | None = Field(default=None, max_length=40)
    options: list[str] = Field(default_factory=list, max_length=30)


class AiGuidedCheckpoint(BaseModel):
    thread_id: str = Field(min_length=1, max_length=80)
    messages: list[AiGuidedMessage] = Field(min_length=1, max_length=200)
    guided_state: dict = Field(default_factory=dict)
    request_context: dict | None = None


class CompareRequest(BaseModel):
    request_ids: list[str] = Field(default_factory=list, max_length=5)
    quote_ids: list[str] = Field(default_factory=list, max_length=5, exclude=True)

    @model_validator(mode="after")
    def require_selection(self) -> "CompareRequest":
        if len(self.request_ids) < 2 and len(self.quote_ids) < 2:
            raise ValueError("Select at least two buyer requests.")
        return self
