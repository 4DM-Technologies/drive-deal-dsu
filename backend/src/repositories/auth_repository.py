from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.schema import Profile, User
from src.utils.log_flow import log_flow


class AuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="repository")
    async def profile_by_email(self, email: str) -> Profile | None:
        result = await self.session.execute(select(Profile).options(selectinload(Profile.user)).where(Profile.email == email.lower()))
        return result.scalar_one_or_none()

    @log_flow(layer="repository")
    async def profile_with_user(self, profile_id: str) -> Profile | None:
        result = await self.session.execute(select(Profile).options(selectinload(Profile.user)).where(Profile.id == profile_id))
        return result.scalar_one_or_none()

    @log_flow(layer="repository")
    async def add_profile(self, profile: Profile, user: User) -> None:
        self.session.add_all([profile, user])
        await self.session.flush()

    @log_flow(layer="repository")
    async def commit(self) -> None:
        await self.session.commit()
