import hashlib
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import Brand, Car, ConversationHistory
from src.utils.log_flow import log_flow
from src.utils.serialization import model_dict


@log_flow(layer="agent")
async def kb_search(session: AsyncSession, query: str, limit: int = 6) -> list[dict[str, Any]]:
    terms = [term for term in query.replace(",", " ").split() if len(term) > 2][:8]
    statement = select(Car, Brand).join(Brand, Brand.id == Car.brand_id).where(Car.status == "available")
    if terms:
        statement = statement.where(
            or_(*[Car.model.ilike(f"%{term}%") for term in terms], *[Brand.name.ilike(f"%{term}%") for term in terms])
        )
    rows = (await session.execute(statement.limit(limit))).all()
    results = [{**model_dict(car), "brand": brand.name, "source": "inventory"} for car, brand in rows]
    key = hashlib.sha256(query.strip().lower().encode()).hexdigest()[:32]
    learned = (
        (await session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == f"kb:{key}")))
        .scalars()
        .first()
    )
    if learned:
        results.append({"source": "learned_web_knowledge", **learned.checkpoint})
    return results


@log_flow(layer="agent")
async def kb_insert(session: AsyncSession, query: str, findings: list[dict[str, Any]], user_id: str) -> None:
    key = hashlib.sha256(query.strip().lower().encode()).hexdigest()[:32]
    existing = (
        (await session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == f"kb:{key}")))
        .scalars()
        .first()
    )
    payload = {"query": query, "findings": findings}
    if existing:
        existing.checkpoint = payload
    else:
        session.add(
            ConversationHistory(
                thread_id=f"kb:{key}",
                checkpoint_id="latest",
                user_id=user_id,
                thread_type="knowledge",
                checkpoint=payload,
                metadata_json={"source": "web_search"},
            )
        )
    await session.flush()
