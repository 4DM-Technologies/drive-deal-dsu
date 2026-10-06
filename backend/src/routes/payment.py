from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile
from src.models.payment import PaymentCreate
from src.repositories.schema import Profile
from src.services.billing_service import BillingService
from src.utils.log_flow import log_flow

router = APIRouter(prefix="/payment", tags=["Payment"])


@router.post("")
@log_flow(layer="route")
async def create_payment(
    payload: PaymentCreate,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Simulated checkout: any well-formed card details succeed and activate premium for one year."""
    return await BillingService(session).process_payment(profile, payload)
