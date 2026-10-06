from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from src.agents.tools.web_search import _ReadableHtmlParser, get_urls, has_official_domain, process_url


async def test_brand_search_uses_official_site_when_search_providers_fail() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=5,
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


async def test_explicit_capitalized_make_still_resolves_the_official_domain() -> None:
    """_resolve_one (graph.py) passes `make` as a car name's first word, e.g. "Tesla" - MAKE_DOMAIN_MAP keys
    are lowercase, so this must be normalized or the scoped search/fallback silently never triggers."""
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=5,
        web_search_request_timeout_seconds=2,
        web_search_candidate_pool_size=8,
    )
    google = AsyncMock(side_effect=RuntimeError("not configured"))
    duckduckgo = MagicMock(side_effect=RuntimeError("provider failed"))

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=google),
        patch("src.agents.tools.web_search._search_duckduckgo", new=duckduckgo),
    ):
        results = await get_urls("Tesla Model X", make="Tesla")

    assert results == [{"url": "https://www.tesla.com/", "title": "Tesla official site", "source_domain": "tesla.com"}]
    assert has_official_domain("Tesla Model X", make="Tesla") is True
    assert has_official_domain("some generic query", make=None) is False


async def test_unknown_brand_returns_no_candidates_instead_of_raising() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=5,
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


async def test_known_make_is_searched_with_a_site_scoped_query_first() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=2,
        web_search_request_timeout_seconds=2,
        web_search_candidate_pool_size=8,
    )
    google = AsyncMock(
        return_value=[{"url": "https://www.bmwusa.com/vehicles/x-models/x3.html", "title": "BMW X3 | BMW USA"}]
    )

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=google),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("what is the bmw x3 car's specialty")

    assert results == [
        {
            "url": "https://www.bmwusa.com/vehicles/x-models/x3.html",
            "title": "BMW X3 | BMW USA",
            "source_domain": "bmwusa.com",
        }
    ]
    scoped_query = google.call_args_list[0].args[1]
    assert "site:bmwusa.com" in scoped_query


async def test_wikipedia_is_excluded_even_when_ranked_first() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=2,
        web_search_request_timeout_seconds=2,
        web_search_candidate_pool_size=8,
    )
    raw = [
        {"url": "https://en.wikipedia.org/wiki/BMW_X3", "title": "BMW X3 - Wikipedia"},
        {"url": "https://www.bmwusa.com/vehicles/x-models/x3.html", "title": "BMW X3 | BMW USA"},
    ]

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(return_value=raw)),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("search current electric cars")

    assert [r["source_domain"] for r in results] == ["bmwusa.com"]


async def test_scoring_reorders_candidates_and_drops_low_scores() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=2,
        web_search_request_timeout_seconds=2,
        web_search_candidate_pool_size=8,
        web_search_min_score=0.5,
    )
    raw = [
        {"url": "https://www.truedelta.com/BMW-X3/features-28", "title": "BMW X3 features"},
        {"url": "https://www.bmwusa.com/vehicles/x-models/x3.html", "title": "BMW X3 | BMW USA"},
    ]
    llm = SimpleNamespace(generate=AsyncMock(return_value=SimpleNamespace(text='{"scores": [0.2, 0.95]}')))

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(return_value=raw)),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("search current electric cars", llm=llm)

    assert [r["source_domain"] for r in results] == ["bmwusa.com"]


async def test_malformed_scoring_response_falls_back_to_search_engine_order() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=2,
        web_search_request_timeout_seconds=2,
        web_search_candidate_pool_size=8,
        web_search_min_score=0.5,
    )
    raw = [
        {"url": "https://www.truedelta.com/BMW-X3/features-28", "title": "BMW X3 features"},
        {"url": "https://www.bmwusa.com/vehicles/x-models/x3.html", "title": "BMW X3 | BMW USA"},
    ]
    llm = SimpleNamespace(generate=AsyncMock(return_value=SimpleNamespace(text="not json")))

    with (
        patch("src.agents.tools.web_search.get_settings", return_value=settings),
        patch("src.agents.tools.web_search._search_google", new=AsyncMock(return_value=raw)),
        patch("src.agents.tools.web_search._robots_allows", new=AsyncMock(return_value=True)),
    ):
        results = await get_urls("search current electric cars", llm=llm)

    assert len(results) == 2
    assert results[0]["source_domain"] == "truedelta.com"


async def test_search_snippet_is_preserved_as_compose_evidence() -> None:
    settings = SimpleNamespace(
        web_search_max_results=5,
        web_search_max_crawl_sites=5,
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
