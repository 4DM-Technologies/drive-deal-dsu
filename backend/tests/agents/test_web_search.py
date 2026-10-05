from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from src.agents.tools.web_search import _ReadableHtmlParser, get_urls, process_url


async def test_brand_search_uses_official_site_when_search_providers_fail() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_request_timeout_seconds=2,
    )
    duckduckgo = MagicMock(side_effect=RuntimeError('Invalid impersonate: "edge_131"'))

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(side_effect=RuntimeError("not configured"))),
        patch("src.agents.tools.web_search._search_duckduckgo", new=duckduckgo),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("Can you search Tesla cars tell me about it.")

    assert results == [
        {
            "url": "https://www.tesla.com/",
            "title": "Tesla official site",
            "source_domain": "tesla.com",
        }
    ]


async def test_unknown_brand_returns_no_candidates_instead_of_raising() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_request_timeout_seconds=2,
    )

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(side_effect=RuntimeError("not configured"))),
        patch(
            "src.agents.tools.web_search._search_duckduckgo", new=MagicMock(side_effect=RuntimeError("provider failed"))
        ),
    ):
        assert await get_urls("search current electric cars") == []


async def test_search_snippet_is_preserved_as_compose_evidence() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_request_timeout_seconds=2,
    )
    raw = [
        {
            "url": "https://www.tesla.com/model3",
            "title": "Model 3 | Tesla",
            "snippet": "Model 3 is a compact electric sedan with configurable range and performance options.",
        }
    ]

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(return_value=raw)),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("search Tesla Model 3")

    assert results[0]["snippet"].startswith("Model 3 is a compact electric sedan")


def test_static_html_parser_keeps_visible_content_only() -> None:
    parser = _ReadableHtmlParser()
    parser.feed("<main><h1>Model 3</h1><script>ignore me</script><p>Up to 363 miles of range.</p></main>")

    assert "Model 3" in parser.text()
    assert "363 miles" in parser.text()
    assert "ignore me" not in parser.text()


async def test_process_url_uses_static_page_without_playwright() -> None:
    llm = SimpleNamespace(
        generate=AsyncMock(
            return_value=SimpleNamespace(text='{"make":"Tesla","model":"Model 3","year":2026,"price_usd":42490}')
        )
    )
    browser_crawl = AsyncMock()

    with (
        patch(
            "src.agents.tools.web_search._fetch_static_page",
            new=AsyncMock(return_value="Model 3. EPA-estimated range and pricing are shown here."),
        ),
        patch("src.agents.tools.web_search._crawl_browser_page", new=browser_crawl),
    ):
        result = await process_url(llm, "https://www.tesla.com/model3", "thread-1")

    assert result is not None
    assert result.make == "Tesla"
    assert result.model == "Model 3"
    assert result.source_url == "https://www.tesla.com/model3"
    browser_crawl.assert_not_awaited()
