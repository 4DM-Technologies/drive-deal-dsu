"""Stage 1: turn a free-text query into a structured CarQueryIntent via LLM."""

import asyncio

from llm_client import complete_json
from models import CarQueryIntent

SYSTEM_PROMPT = f"""You extract car-shopping intent from a user's message.
This application only covers the US car market (US manufacturers, US dealers, US pricing in USD).
If the user asks about a market outside the US, still fill the fields as best you can but
leave country_market as "US" since that's the only market this app supports.
Return only the fields you can confidently infer; leave others null.
JSON schema to follow:
{CarQueryIntent.model_json_schema()}
"""


async def parse_query_async(user_query: str) -> CarQueryIntent:
    data = await complete_json(SYSTEM_PROMPT, user_query)
    return CarQueryIntent.model_validate(data)


def parse_query(user_query: str) -> CarQueryIntent:
    return asyncio.run(parse_query_async(user_query))


if __name__ == "__main__":
    intent = parse_query("I want to see the top 10 cars, something like a Tesla under 50000")
    print(intent.model_dump_json(indent=2))
