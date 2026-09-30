from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


def new_uuid() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class AuditMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    updated_by: Mapped[str] = mapped_column(String(64), default="system", nullable=False)


class State(AuditMixin, Base):
    __tablename__ = "states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(2), unique=True, nullable=False)
    sales_tax_rate: Mapped[Decimal] = mapped_column(Numeric(7, 5), default=Decimal("0"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Brand(AuditMixin, Base):
    __tablename__ = "brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Profile(AuditMixin, Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("role IN ('buyer','dealer','support','admin')", name="ck_profiles_role"),
        UniqueConstraint("dealer_license", name="uq_profiles_dealer_license"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    state_id: Mapped[str | None] = mapped_column(ForeignKey("states.id"), nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    phone: Mapped[str] = mapped_column(String(24), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    dealership_name: Mapped[str | None] = mapped_column(String(180))
    branch_name: Mapped[str | None] = mapped_column(String(120))
    dealer_license: Mapped[str | None] = mapped_column(String(100))
    website: Mapped[str | None] = mapped_column(String(500))
    coordinates: Mapped[dict | None] = mapped_column(JSON)
    supported_brands: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    terms_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    terms_version: Mapped[str | None] = mapped_column(String(40))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user: Mapped["User"] = relationship(back_populates="profile", uselist=False)


class User(AuditMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token_hash: Mapped[str | None] = mapped_column(String(128))
    profile: Mapped[Profile] = relationship(back_populates="user")


class Car(AuditMixin, Base):
    __tablename__ = "cars"
    __table_args__ = (CheckConstraint("status IN ('available','reserved','sold','inactive')", name="ck_cars_status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    seller_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"), nullable=False, index=True)
    state_id: Mapped[str] = mapped_column(ForeignKey("states.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    model_year: Mapped[int] = mapped_column(Integer, nullable=False)
    body_type: Mapped[str | None] = mapped_column(String(60))
    seating_capacity: Mapped[int | None] = mapped_column(Integer)
    condition: Mapped[str] = mapped_column(String(30), default="new", nullable=False)
    mileage: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fuel: Mapped[str | None] = mapped_column(String(40))
    transmission: Mapped[str | None] = mapped_column(String(40))
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    reviews: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    image_paths: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="available", nullable=False)


class ConversationHistory(AuditMixin, Base):
    __tablename__ = "conversation_history"
    thread_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    checkpoint_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    parent_checkpoint_id: Mapped[str | None] = mapped_column(String(80))
    user_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    thread_type: Mapped[str] = mapped_column(String(30), nullable=False)
    checkpoint: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class BuyerPreference(AuditMixin, Base):
    __tablename__ = "buyer_preference"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    brand_id: Mapped[str | None] = mapped_column(ForeignKey("brands.id"))
    other_brand_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    model_preference: Mapped[str | None] = mapped_column(String(160))
    body_type: Mapped[str | None] = mapped_column(String(60))
    seater_count: Mapped[int | None] = mapped_column(Integer)
    transmission: Mapped[str | None] = mapped_column(String(40))
    drivetrain: Mapped[str | None] = mapped_column(String(30))
    fuel_type: Mapped[str | None] = mapped_column(String(30))
    condition: Mapped[str | None] = mapped_column(String(30))
    exterior_color: Mapped[str | None] = mapped_column(String(50))
    min_year: Mapped[int | None] = mapped_column(Integer)
    max_mileage: Mapped[int | None] = mapped_column(Integer)
    budget_min: Mapped[int | None] = mapped_column(Integer)
    budget_max: Mapped[int | None] = mapped_column(Integer)
    must_have_features: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    never_want_features: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(40), default="advisor", nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(4, 3), default=Decimal("0"), nullable=False)


class BuyerRequest(AuditMixin, Base):
    __tablename__ = "buyer_requests"
    __table_args__ = (
        CheckConstraint("status IN ('draft','open','closed','expired','fulfilled')", name="ck_buyer_requests_status"),
        CheckConstraint("year_max IS NULL OR year_min IS NULL OR year_max >= year_min", name="ck_buyer_requests_years"),
        CheckConstraint("search_radius_miles > 0", name="ck_buyer_requests_radius"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    buyer_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"), nullable=False, index=True)
    buyer_area_state_id: Mapped[str] = mapped_column(ForeignKey("states.id"), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    body_type: Mapped[str | None] = mapped_column(String(60))
    fuel_type: Mapped[str | None] = mapped_column(String(40))
    year_min: Mapped[int | None] = mapped_column(Integer)
    year_max: Mapped[int | None] = mapped_column(Integer)
    trim: Mapped[str | None] = mapped_column(String(80))
    drivetrain: Mapped[str | None] = mapped_column(String(30))
    transmission: Mapped[str | None] = mapped_column(String(40))
    color: Mapped[str | None] = mapped_column(String(40))
    budget_min: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    budget_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    target_otd_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    buyer_area: Mapped[str] = mapped_column(String(180), nullable=False)
    coordinates: Mapped[dict | None] = mapped_column(JSON)
    search_radius_miles: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    timeline: Mapped[str] = mapped_column(String(40), nullable=False)
    condition: Mapped[str | None] = mapped_column(String(30))
    must_haves: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    trade_in: Mapped[dict | None] = mapped_column(JSON)
    paying_with: Mapped[str | None] = mapped_column(String(40))
    additional_information: Mapped[str | None] = mapped_column(Text)
    request_expire: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    market_brief: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False, index=True)


class DealQuote(AuditMixin, Base):
    __tablename__ = "deal_quotes"
    __table_args__ = (
        UniqueConstraint("buyer_request_id", "dealer_id", name="uq_quote_request_dealer"),
        CheckConstraint("status IN ('pending','negotiating','accepted','declined','withdrawn','expired')", name="ck_quotes_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    buyer_request_id: Mapped[str] = mapped_column(ForeignKey("buyer_requests.id"), nullable=False, index=True)
    buyer_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    dealer_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    vehicle_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    doc_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    sales_tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    title_reg: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    trade_in_credit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    final_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), Computed("vehicle_price + doc_fee + sales_tax + title_reg - trade_in_credit"))
    message: Mapped[str | None] = mapped_column(Text)
    read_by_buyer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    deal_status: Mapped[str | None] = mapped_column(String(40))
    deal_history: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    chat_request_status: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    chat_request_message: Mapped[str | None] = mapped_column(Text)
    chat_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    chat_decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DealChat(AuditMixin, Base):
    __tablename__ = "deal_chats"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quote_id: Mapped[str] = mapped_column(ForeignKey("deal_quotes.id"), nullable=False, index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    client_message_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_for: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)


class DealDocument(AuditMixin, Base):
    __tablename__ = "deal_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quote_id: Mapped[str] = mapped_column(ForeignKey("deal_quotes.id"), nullable=False, index=True)
    dealer_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False)
    document_type: Mapped[str] = mapped_column(String(60), nullable=False)
    image_paths: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    document_path: Mapped[str | None] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)


class SupportTicket(AuditMixin, Base):
    __tablename__ = "support_tickets"
    __table_args__ = (UniqueConstraint("category", "ticket_id", name="uq_support_ticket_category_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    ticket_id: Mapped[str] = mapped_column(String(40), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    caller_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    issue_summary: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="open", nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    notes: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    rca: Mapped[str | None] = mapped_column(Text)


class SupportVerification(AuditMixin, Base):
    __tablename__ = "support_verifications"
    ticket_id: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), nullable=False, index=True)
    proof_docs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    notes: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LlmAudit(AuditMixin, Base):
    __tablename__ = "llm_audits"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=new_uuid, nullable=False)
    task_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model_name: Mapped[str] = mapped_column(String(80), nullable=False)
    thread_id: Mapped[str | None] = mapped_column(String(80), index=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(40), default="v1", nullable=False)


class ErrorLog(AuditMixin, Base):
    __tablename__ = "error_logs"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=new_uuid, nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    error_code: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(120), nullable=False)
    endpoint: Mapped[str | None] = mapped_column(String(240))
    thread_id: Mapped[str | None] = mapped_column(String(80))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    error_context: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
