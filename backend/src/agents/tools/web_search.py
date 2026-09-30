from src.settings import get_settings


async def web_search(query: str) -> list[dict[str, str]]:
    settings = get_settings()
    if not settings.ai_enable_web_search:
        return []
    try:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
    except ImportError:
        return []
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=f"https://www.google.com/search?q={query}", config=CrawlerRunConfig(word_count_threshold=40))
        if not result.success:
            return []
        return [{"title": f"Web research for {query}", "url": result.url, "content": result.markdown[:6000]}]
