"""Stage 4: extract structured car data (specs, colors, price) from crawled markdown."""

import asyncio

from llm_client import complete_json
from models import CarSpecs

SYSTEM_PROMPT = f"""You extract structured car data from a web page's cleaned markdown content.
Only fill fields you can find evidence for in the text; leave everything else null.
Put any specs that don't map to a known field into extra_specs as key/value strings.
JSON schema to follow:
{CarSpecs.model_json_schema()}
"""


MAX_MARKDOWN_CHARS = 45000


async def extract_specs_async(source_url: str, markdown: str) -> CarSpecs:
    user_prompt = f"Source URL: {source_url}\n\nPage content:\n{markdown[:MAX_MARKDOWN_CHARS]}"
    data = await complete_json(SYSTEM_PROMPT, user_prompt)
    data["source_url"] = source_url
    return CarSpecs.model_validate(data)


def extract_specs(source_url: str, markdown: str) -> CarSpecs:
    return asyncio.run(extract_specs_async(source_url, markdown))


if __name__ == "__main__":
    sample_markdown = "Model 3 starts at $38,990. Available colors: Pearl White, Solid Black, Deep Blue."
    specs = extract_specs("https://www.tesla.com/model3", sample_markdown)
    print(specs.model_dump_json(indent=2))
