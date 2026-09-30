from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.schema import Profile, User


class AuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def profile_by_email(self, email: str) -> Profile | None:
        result = await self.session.execute(select(Profile).options(selectinload(Profile.user)).where(Profile.email == email.lower()))
        return result.scalar_one_or_none()

    async def profile_with_user(self, profile_id: str) -> Profile | None:
        result = await self.session.execute(select(Profile).options(selectinload(Profile.user)).where(Profile.id == profile_id))
        return result.scalar_one_or_none()

    async def add_profile(self, profile: Profile, user: User) -> None:
        self.session.add_all([profile, user])
        await self.session.flush()

    async def commit(self) -> None:
        await self.session.commit()
