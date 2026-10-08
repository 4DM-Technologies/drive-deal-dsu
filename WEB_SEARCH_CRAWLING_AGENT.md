# Vehicle web research architecture

The production vehicle-research path is intentionally small and bounded:

1. `kb_agent` searches Deal&Drive inventory and cached `learned_web_knowledge` first.
2. A KB miss, or an explicit “latest/search” request, calls the OpenAI Responses API hosted `web_search` tool.
3. The search response supplies URL citations. The answer and citations are cached by normalized query for later KB hits.
4. Structured extraction uses a short static HTML request only when the hosted answer is not enough. No browser crawler or scraped search-engine provider is used.
5. Image requests use the same hosted search tool to find official/reputable source pages, read their declared `og:image`/Twitter image metadata, and return at most two attributed image URLs. Image results are cached too.

The graph keeps small talk on a direct one-call path. Vehicle image and explicit live-search requests bypass the
requirements graph, which avoids unnecessary planner/requirements latency. All other vehicle questions follow the
KB-first path and escalate dynamically only when the local answer is missing or irrelevant.

The frontend renders image cards with source links. A complete buyer-request draft is shown as an editable preview;
the buyer can use the button or say “post it”. Both paths create a draft through the existing marketplace API and
publish it only after explicit confirmation.

For a trace of the hosted path, run `backend/scripts/trace_web_search.py` with a configured OpenAI/Codex credential.
