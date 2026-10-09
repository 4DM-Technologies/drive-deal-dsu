"""Stage 5: LLM EXTRACTION (parent doc, section 12-13) - the one stage in this pipeline
where the LLM is unavoidable (page structure is unknown/unprofiled). Every call is tagged
with its token usage and latency so test_queries.py can total up "how much did answering
this query actually cost."
"""

from config import settings
from llm_client import complete_json
from models import CarSpecs, StageTiming, TokenUsage

SYSTEM_PROMPT = f"""You extract structured car data from a web page's cleaned markdown content.
Only fill fields you can find evidence for in the text; leave everything else null.
Put any specs that don't map to a known field into extra_specs as key/value strings.
JSON schema to follow:
{CarSpecs.model_json_schema()}
"""

MAX_CONTENT_CHARS = 45_000


async def extract_specs(url: str, content: str) -> tuple[CarSpecs | None, StageTiming]:
    user_prompt = f"Source URL: {url}\n\nPage content:\n{content[:MAX_CONTENT_CHARS]}"
    try:
        data, usage, duration_ms = await complete_json(SYSTEM_PROMPT, user_prompt)
        data["source_url"] = url
        specs = CarSpecs.model_validate(data)
        timing = StageTiming(
            stage="llm_extract",
            method=f"llm:{settings.openai_model}",
            duration_ms=duration_ms,
            tokens=usage,
            detail={"url": url, "content_chars_sent": min(len(content), MAX_CONTENT_CHARS), "success": True},
        )
        return specs, timing
    except Exception as exc:  # noqa: BLE001 - POC: log and continue, don't fail the whole query
        timing = StageTiming(
            stage="llm_extract",
            method=f"llm:{settings.openai_model}",
            tokens=TokenUsage(),
            detail={"url": url, "success": False, "error": str(exc)[:300]},
        )
        return None, timing


async def extract_many(pages: dict[str, str]) -> tuple[list[CarSpecs], list[StageTiming]]:
    import asyncio

    outcomes = await asyncio.gather(*[extract_specs(url, content) for url, content in pages.items()])
    specs = [s for s, _ in outcomes if s]
    timings = [t for _, t in outcomes]
    return specs, timings
