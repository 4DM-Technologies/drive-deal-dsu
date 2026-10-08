from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.agents.tools.web_search import (
    _ImageMetaParser,
    _ReadableHtmlParser,
    get_urls,
    has_official_domain,
    process_url,
)


async def test_hosted_search_is_the_only_url_provider() -> None:
    settings = SimpleNamespace(ai_enable_web_search=True, web_search_max_crawl_sites=2)
    llm = SimpleNamespace(
        generate=AsyncMock(
            return_value=SimpleNamespace(
                text="The latest Seltos is available in several trims.",
                sources=[{"url": "https://www.kia.com/us/en/vehicles/seltos", "title": "Kia Seltos"}],
            )
        )
    )

    with patch("src.agents.tools.web_search.get_settings", return_value=settings):
        results = await get_urls("latest Kia Seltos", llm=llm)

    assert results[0]["source_domain"] == "kia.com"
    assert results[0]["hosted_answer"].startswith("The latest Seltos")
    call = llm.generate.call_args.kwargs
    assert call["reasoning_effort"] == "low"
    assert call["tools"] == [{"type": "web_search", "search_context_size": "low"}]
    assert call["tool_choice"] == "required"


async def test_hosted_search_can_be_disabled_without_network_fallback() -> None:
    settings = SimpleNamespace(ai_enable_web_search=False, web_search_max_crawl_sites=2)
    llm = SimpleNamespace(generate=AsyncMock())

    with patch("src.agents.tools.web_search.get_settings", return_value=settings):
        assert await get_urls("latest Kia Seltos", llm=llm) == []

    llm.generate.assert_not_awaited()


def test_supported_make_detection_is_retained_for_graph_compatibility() -> None:
    assert has_official_domain("Tesla Model X", make="Tesla") is True
    assert has_official_domain("some generic query", make=None) is False


def test_static_html_parser_keeps_visible_content_only() -> None:
    parser = _ReadableHtmlParser()
    parser.feed("<main><h1>Model 3</h1><script>ignore me</script><p>Up to 363 miles of range.</p></main>")

    assert "Model 3" in parser.text()
    assert "363 miles" in parser.text()
    assert "ignore me" not in parser.text()


def test_image_metadata_parser_extracts_open_graph_image() -> None:
    parser = _ImageMetaParser()
    parser.feed('<meta property="og:image" content="https://cdn.example.com/seltos.jpg">')
    assert parser.images == ["https://cdn.example.com/seltos.jpg"]


async def test_process_url_uses_bounded_static_fetch() -> None:
    llm = SimpleNamespace(
        generate=AsyncMock(
            return_value=SimpleNamespace(text='{"make":"Tesla","model":"Model 3","year":2026,"price_usd":42490}')
        )
    )

    with patch(
        "src.agents.tools.web_search._fetch_static_page",
        new=AsyncMock(return_value="Model 3. EPA-estimated range and pricing are shown here."),
    ):
        result = await process_url(llm, "https://www.tesla.com/model3", "thread-1")

    assert result is not None
    assert result.make == "Tesla"
    assert result.model == "Model 3"
    assert result.source_url == "https://www.tesla.com/model3"
