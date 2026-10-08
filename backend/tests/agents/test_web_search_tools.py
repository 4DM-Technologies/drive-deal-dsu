"""Behaviour of the hosted web-search tool helpers: image search, source filtering, retries and static fetching.

HTTP is served by ``httpx.MockTransport`` so nothing here touches the network.
"""

import json
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.agents.tools import web_search
from src.agents.tools.web_search import (
    _crawl_browser_page,
    _domain_of,
    _fetch_static_page,
    _hosted_get_urls,
    _infer_make,
    _parse_json_object,
    _retry,
    _trace_step,
    get_urls,
    process_url,
    search_vehicle_images,
)


def _mock_http(handler: Callable[[httpx.Request], httpx.Response]):
    """Route every ``httpx.AsyncClient`` the module creates through ``handler``."""
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    return patch.object(web_search.httpx, "AsyncClient", side_effect=factory)


def _llm_returning(text: str = "", sources: list[dict[str, str]] | None = None) -> SimpleNamespace:
    return SimpleNamespace(generate=AsyncMock(return_value=SimpleNamespace(text=text, sources=sources)))


def _html_page(image: str | None) -> httpx.Response:
    meta = f'<meta property="og:image" content="{image}">' if image else ""
    return httpx.Response(200, headers={"content-type": "text/html"}, text=f"<html><head>{meta}</head></html>")


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://www.example.com")
    return httpx.HTTPStatusError("boom", request=request, response=httpx.Response(status_code, request=request))


# --- search_vehicle_images -------------------------------------------------------------------------------------


async def test_image_search_accepts_sources_without_market_url_filtering() -> None:
    llm = _llm_returning(sources=[{"url": "https://www.kia.co.in/seltos", "title": "Kia India"}])

    with _mock_http(lambda request: _html_page("https://cdn.example.com/seltos.jpg")):
        images = await search_vehicle_images(llm, "Kia Seltos")

    assert images[0]["source_url"] == "https://www.kia.co.in/seltos"


async def test_image_search_returns_nothing_when_the_model_cites_no_sources() -> None:
    assert await search_vehicle_images(_llm_returning(sources=None), "Kia Seltos") == []


async def test_image_search_resolves_relative_images_and_drops_unreachable_or_duplicate_sources() -> None:
    llm = _llm_returning(
        sources=[
            {"url": "https://www.kia.com/us/seltos", "title": "Kia Seltos"},
            {"url": "https://cdn-test.example.com/page", "title": ""},
            {"url": "https://www.broken.com/seltos", "title": "Broken"},
            {"url": "https://www.repeat.com/seltos", "title": "Repeat"},
            {"url": "https://www.kia.com/in/seltos", "title": "Kia India"},
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "www.kia.com":
            return _html_page("/images/seltos.jpg")
        if host == "cdn-test.example.com":
            return _html_page("//cdn.example.com/seltos.jpg")
        if host == "www.repeat.com":
            return _html_page("https://www.kia.com/images/seltos.jpg")
        return httpx.Response(500)

    with _mock_http(handler):
        images = await search_vehicle_images(llm, "Kia Seltos", limit=3)

    assert [image["image_url"] for image in images] == [
        "https://www.kia.com/images/seltos.jpg",
        "https://cdn.example.com/seltos.jpg",
    ]
    assert images[0]["source_url"] == "https://www.kia.com/us/seltos"
    assert images[0]["source_name"] == "Kia Seltos"
    assert images[1]["source_name"] == "Vehicle source"
    assert images[0]["alt"] == "Kia Seltos vehicle image"
    assert llm.generate.call_args.kwargs["tool_choice"] == "required"


async def test_image_search_respects_the_result_limit() -> None:
    llm = _llm_returning(
        sources=[
            {"url": "https://www.one.com/a", "title": "One"},
            {"url": "https://www.two.com/a", "title": "Two"},
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return _html_page(f"https://img.example.com/{request.url.host}.jpg")

    with _mock_http(handler):
        images = await search_vehicle_images(llm, "Kia Seltos", limit=1)

    assert len(images) == 1


async def test_image_search_ignores_pages_that_declare_no_image() -> None:
    llm = _llm_returning(
        sources=[
            {"url": "https://www.redirect.com/seltos", "title": "Redirect"},
            {"url": "https://www.plain.com/seltos", "title": "Plain"},
            {"url": "https://www.odd.com/seltos", "title": "Odd"},
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "www.redirect.com":
            return httpx.Response(302, headers={"location": "https://www.kia.co.in/seltos"})
        if host == "www.kia.co.in":
            return _html_page("https://cdn.example.com/indian.jpg")
        if host == "www.odd.com":
            return _html_page("data:image/png;base64,AAAA")
        return _html_page(None)

    with _mock_http(handler):
        images = await search_vehicle_images(llm, "Kia Seltos")

    assert [image["image_url"] for image in images] == ["https://cdn.example.com/indian.jpg"]


async def test_image_search_finds_lazy_loaded_and_structured_vehicle_images() -> None:
    llm = _llm_returning(sources=[{"url": "https://www.kia.com/us/sportage", "title": "Kia Sportage"}])
    html = """<html><head><script type="application/ld+json">
      {"@type":"Product","image":{"url":"/media/sportage.jpg"}}
      </script></head><body><img alt="2026 Kia Sportage" data-src="/media/sportage-gallery.webp"></body></html>"""
    with _mock_http(lambda request: httpx.Response(200, headers={"content-type": "text/html"}, text=html)):
        images = await search_vehicle_images(llm, "Kia Sportage")

    assert images[0]["image_url"] == "https://www.kia.com/media/sportage.jpg"


# --- _hosted_get_urls / get_urls -------------------------------------------------------------------------------


async def test_hosted_urls_skip_unusable_sources_and_attach_the_hosted_answer() -> None:
    llm = _llm_returning(
        text="The Seltos starts at $25,000.",
        sources=[
            {"title": "No URL"},
            {"url": "https://en.wikipedia.org/wiki/Kia_Seltos", "title": "Wikipedia"},
            {"url": "https://www.kia.co.in/seltos", "title": "Kia India"},
            {"url": "https://www.kia.com/us/seltos", "title": "Kia Seltos"},
            {"url": "https://www.edmunds.com/kia/seltos/", "title": ""},
        ],
    )

    candidates = await _hosted_get_urls(llm, "Kia Seltos price", limit=5)

    assert [candidate["source_domain"] for candidate in candidates] == [
        "kia.co.in",
        "kia.com",
        "edmunds.com",
    ]
    assert candidates[2]["title"] == "edmunds.com"
    assert candidates[0]["hosted_answer"] == "The Seltos starts at $25,000."
    assert [source["url"] for source in json.loads(candidates[0]["hosted_sources"])] == [
        "https://www.kia.co.in/seltos",
        "https://www.kia.com/us/seltos",
        "https://www.edmunds.com/kia/seltos/",
    ]
    assert "hosted_answer" not in candidates[1]


async def test_hosted_urls_fall_back_to_links_in_the_answer_text() -> None:
    llm = _llm_returning(
        text=(
            "See https://www.kia.com/us/seltos. Also (https://www.edmunds.com/kia/seltos), "
            "not https://en.wikipedia.org/wiki/Kia or https://www.kia.co.in/seltos."
        ),
        sources=None,
    )

    candidates = await _hosted_get_urls(llm, "Kia Seltos", limit=5)

    assert [candidate["url"] for candidate in candidates] == [
        "https://www.kia.com/us/seltos",
        "https://www.edmunds.com/kia/seltos",
        "https://www.kia.co.in/seltos",
    ]


async def test_hosted_urls_are_empty_when_the_answer_has_no_links() -> None:
    assert await _hosted_get_urls(_llm_returning(text="No links here.", sources=[]), "Kia Seltos", limit=3) == []


async def test_get_urls_records_a_trace_step_and_survives_a_search_failure() -> None:
    settings = SimpleNamespace(ai_enable_web_search=True, web_search_max_crawl_sites=2)
    llm = _llm_returning(text="ok", sources=[{"url": "https://www.kia.com/us/seltos", "title": "Kia"}])
    trace: list[dict] = []

    with patch("src.agents.tools.web_search.get_settings", return_value=settings):
        results = await get_urls("Kia Seltos", llm=llm, trace=trace)
        llm.generate.side_effect = RuntimeError("search backend down")
        assert await get_urls("Kia Seltos", llm=llm) == []

    assert trace[0]["stage"] == "hosted_search"
    assert trace[0]["candidates"] == results


def test_trace_step_is_a_no_op_without_a_trace() -> None:
    trace: list[dict] = []
    _trace_step(None, "ignored", value=1)
    _trace_step(trace, "stage", value=1)

    assert trace == [{"stage": "stage", "value": 1}]


# --- small pure helpers ----------------------------------------------------------------------------------------


def test_domain_is_normalised_and_unparsable_urls_have_none() -> None:
    assert _domain_of("https://WWW.Kia.com/us") == "kia.com"
    assert _domain_of("https://news.kia.com/us") == "news.kia.com"
    assert _domain_of("not a url") is None


def test_make_is_inferred_from_a_natural_language_query() -> None:
    assert _infer_make("What does a Tesla Model 3 cost?") == "tesla"
    assert _infer_make("Which Chevy is best for towing?") == "chevy"
    assert _infer_make("something generic") is None


def test_json_object_is_extracted_from_surrounding_prose() -> None:
    assert _parse_json_object('Here you go: {"make": "Kia"} Hope it helps') == {"make": "Kia"}
    assert _parse_json_object('{"make": "Ford"}') == {"make": "Ford"}
    with pytest.raises(json.JSONDecodeError):
        _parse_json_object("no json at all")


async def test_browser_crawling_is_disabled() -> None:
    assert await _crawl_browser_page("https://www.kia.com/us/seltos") is None


# --- _retry ----------------------------------------------------------------------------------------------------


@pytest.fixture
def three_attempts():
    with (
        patch("src.agents.tools.web_search.get_settings", return_value=SimpleNamespace(web_search_max_retries=3)),
        patch("src.agents.tools.web_search.asyncio.sleep", new=AsyncMock()) as sleep,
    ):
        yield sleep


async def test_retry_recovers_from_transient_network_errors(three_attempts: AsyncMock) -> None:
    attempt = AsyncMock(side_effect=[httpx.ConnectError("down"), httpx.ReadTimeout("slow"), "page text"])

    assert await _retry("static_fetch", "https://www.kia.com", attempt) == "page text"
    assert attempt.await_count == 3
    assert three_attempts.await_count == 2


async def test_retry_retries_server_errors_and_then_raises_the_last_one(three_attempts: AsyncMock) -> None:
    attempt = AsyncMock(side_effect=[_status_error(503), _status_error(502), _status_error(500)])

    with pytest.raises(httpx.HTTPStatusError) as raised:
        await _retry("static_fetch", "https://www.kia.com", attempt)

    assert raised.value.response.status_code == 500
    assert attempt.await_count == 3


async def test_retry_does_not_repeat_client_errors(three_attempts: AsyncMock) -> None:
    attempt = AsyncMock(side_effect=_status_error(404))

    with pytest.raises(httpx.HTTPStatusError):
        await _retry("static_fetch", "https://www.kia.com", attempt)

    assert attempt.await_count == 1
    three_attempts.assert_not_awaited()


async def test_retry_does_not_repeat_a_clean_empty_result(three_attempts: AsyncMock) -> None:
    attempt = AsyncMock(return_value=None)

    assert await _retry("static_fetch", "https://www.kia.com", attempt) is None
    assert attempt.await_count == 1


# --- _fetch_static_page / process_url --------------------------------------------------------------------------


async def test_static_fetch_returns_visible_text_only() -> None:
    page = "<main><h1>Seltos</h1><script>track()</script><p>Starts at $25,000.</p></main>"

    with _mock_http(lambda request: httpx.Response(200, headers={"content-type": "text/html"}, text=page)):
        content = await _fetch_static_page("https://www.kia.com/us/seltos")

    assert content is not None
    assert "Starts at $25,000." in content
    assert "track()" not in content


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"),
        httpx.Response(200, headers={"content-type": "text/html"}, text="<script>only()</script>"),
        httpx.Response(404),
        httpx.Response(302, headers={"location": "https://www.example.com/empty"}),
    ],
    ids=["not-text", "no-visible-content", "http-error", "redirect-to-empty"],
)
async def test_static_fetch_gives_up_quietly_on_unusable_pages(response: httpx.Response) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return response

    with _mock_http(handler):
        assert await _fetch_static_page("https://www.kia.com/us/seltos") is None


async def test_static_fetch_accepts_a_non_us_url_when_the_provider_returns_content() -> None:
    with _mock_http(lambda request: httpx.Response(200, headers={"content-type": "text/html"}, text="<p>Seltos</p>")):
        assert await _fetch_static_page("https://www.kia.co.in/seltos") == "Seltos"


async def test_process_url_skips_pages_that_cannot_be_fetched() -> None:
    trace: list[dict] = []
    llm = SimpleNamespace(generate=AsyncMock())

    with patch("src.agents.tools.web_search._fetch_static_page", new=AsyncMock(return_value=None)):
        assert await process_url(llm, "https://www.kia.com/us/seltos", trace=trace) is None

    llm.generate.assert_not_awaited()
    assert trace[0]["stage"] == "fetch"
    assert trace[0]["method"] is None


async def test_process_url_drops_unparsable_extractions_and_records_why() -> None:
    trace: list[dict] = []
    llm = _llm_returning(text="I could not find any structured data on that page.")

    with patch("src.agents.tools.web_search._fetch_static_page", new=AsyncMock(return_value="Seltos page")):
        assert await process_url(llm, "https://www.kia.com/us/seltos", "thread-1", trace=trace) is None

    assert [step["stage"] for step in trace] == ["fetch", "extract"]
    assert "error" in trace[1]


async def test_process_url_traces_a_successful_extraction() -> None:
    trace: list[dict] = []
    llm = _llm_returning(text='{"make": "Kia", "model": "Seltos", "year": 2026, "price_usd": 25000}')

    with patch("src.agents.tools.web_search._fetch_static_page", new=AsyncMock(return_value="Seltos page")):
        specs = await process_url(llm, "https://www.kia.com/us/seltos", trace=trace, profile={"model": "test-model"})

    assert specs is not None and specs.model == "Seltos"
    assert [step["stage"] for step in trace] == ["fetch", "extract"]
    assert trace[0]["method"] == "static"
    assert llm.generate.call_args.kwargs["model"] == "test-model"
