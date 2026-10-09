import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright


OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)


def clean_url(url: str) -> str:
    return url.split("#")[0].strip()


def unique(items):
    seen = set()
    result = []

    for item in items:
        if not item:
            continue

        item = item.strip()

        if item and item not in seen:
            seen.add(item)
            result.append(item)

    return result


def extract_vin(url: str, text: str = ""):
    """
    Try to find VIN from URL first, then page text.
    """

    # VIN from CARFAX URL
    match = re.search(
        r"/vehicle/([A-HJ-NPR-Z0-9]{17})",
        url,
        re.IGNORECASE
    )

    if match:
        return match.group(1).upper()

    # VIN from page text
    match = re.search(
        r"\b[A-HJ-NPR-Z0-9]{17}\b",
        text,
        re.IGNORECASE
    )

    if match:
        return match.group(0).upper()

    return None


async def extract_json_ld(page):
    """
    Extract JSON-LD blocks from the webpage.
    """

    scripts = await page.locator(
        'script[type="application/ld+json"]'
    ).all()

    results = []

    for script in scripts:
        try:
            content = await script.text_content()

            if not content:
                continue

            data = json.loads(content)

            if isinstance(data, list):
                results.extend(data)
            else:
                results.append(data)

        except Exception:
            pass

    return results


async def extract_embedded_json(page):
    """
    Look for common embedded JSON script blocks.

    We don't depend on a particular framework.
    """

    return await page.evaluate(
        """
        () => {
            const results = [];

            const scripts = document.querySelectorAll("script");

            for (const script of scripts) {
                const text = script.textContent?.trim();

                if (!text) continue;

                const type = script.getAttribute("type");

                if (
                    type === "application/json" ||
                    type === "application/ld+json"
                ) {
                    try {
                        results.push({
                            type: type,
                            data: JSON.parse(text)
                        });
                    } catch (_) {
                        // Ignore invalid JSON
                    }
                }
            }

            return results;
        }
        """
    )


async def extract_images(page, base_url):
    """
    Extract images from:

    - img.src
    - img.currentSrc
    - lazy-loading attributes
    - srcset
    - picture/source
    - OpenGraph image
    - Twitter image
    """

    images = await page.evaluate(
        """
        () => {
            const images = [];

            function add(value, source) {
                if (!value) return;

                value = value.trim();

                if (!value) return;

                images.push({
                    url: value,
                    source: source
                });
            }

            // img elements
            document.querySelectorAll("img").forEach(img => {

                add(img.currentSrc, "img.currentSrc");
                add(img.src, "img.src");

                add(img.getAttribute("data-src"), "data-src");
                add(img.getAttribute("data-lazy-src"), "data-lazy-src");
                add(img.getAttribute("data-original"), "data-original");

                const srcset =
                    img.getAttribute("srcset") ||
                    img.getAttribute("data-srcset");

                if (srcset) {
                    srcset.split(",").forEach(item => {
                        const url = item.trim().split(" ")[0];

                        if (url) {
                            add(url, "srcset");
                        }
                    });
                }
            });

            // picture/source
            document.querySelectorAll("source").forEach(source => {

                const srcset =
                    source.getAttribute("srcset") ||
                    source.getAttribute("data-srcset");

                if (srcset) {
                    srcset.split(",").forEach(item => {

                        const url = item.trim().split(" ")[0];

                        if (url) {
                            add(url, "picture-srcset");
                        }
                    });
                }
            });

            // OpenGraph
            document
                .querySelectorAll('meta[property="og:image"]')
                .forEach(meta => {
                    add(meta.content, "og:image");
                });

            // Twitter
            document
                .querySelectorAll('meta[name="twitter:image"]')
                .forEach(meta => {
                    add(meta.content, "twitter:image");
                });

            return images;
        }
        """
    )

    final_images = []

    seen = set()

    for item in images:

        image_url = item["url"]

        if image_url.startswith("data:"):
            continue

        image_url = urljoin(base_url, image_url)

        # Remove fragments
        image_url = image_url.split("#")[0]

        if image_url not in seen:

            seen.add(image_url)

            final_images.append({
                "url": image_url,
                "source": item["source"]
            })

    return final_images


async def scroll_page(page):
    """
    Scroll through the page so lazy-loaded content/images
    have a chance to load.
    """

    previous_height = 0

    for _ in range(10):

        height = await page.evaluate(
            "document.body.scrollHeight"
        )

        await page.evaluate(
            "window.scrollTo(0, document.body.scrollHeight)"
        )

        await page.wait_for_timeout(1200)

        if height == previous_height:
            break

        previous_height = height

    # Return to top
    await page.evaluate(
        "window.scrollTo(0, 0)"
    )

    await page.wait_for_timeout(500)


async def extract_page_content(page):
    """
    Extract the visible webpage content.
    """

    return await page.evaluate(
        """
        () => {

            function getMeta(name) {

                const element =
                    document.querySelector(`meta[name="${name}"]`);

                return element?.content || null;
            }

            function getProperty(property) {

                const element =
                    document.querySelector(
                        `meta[property="${property}"]`
                    );

                return element?.content || null;
            }

            return {

                title: document.title,

                url: window.location.href,

                text: document.body?.innerText || "",

                html: document.documentElement?.outerHTML || "",

                meta: {

                    description:
                        getMeta("description"),

                    keywords:
                        getMeta("keywords"),

                    og_title:
                        getProperty("og:title"),

                    og_description:
                        getProperty("og:description"),

                    og_image:
                        getProperty("og:image")
                }

            };
        }
        """
    )


async def capture_network_json(page):
    """
    Capture JSON responses generated while loading the page.

    This is only used as additional data.
    The crawler does NOT depend on a specific CARFAX API.
    """

    responses = []

    async def handle_response(response):

        try:

            content_type = (
                response.headers.get("content-type", "")
                .lower()
            )

            if "application/json" not in content_type:
                return

            # Don't download huge resources
            if response.status != 200:
                return

            data = await response.json()

            responses.append({
                "url": response.url,
                "status": response.status,
                "data": data
            })

        except Exception:
            pass

    page.on("response", handle_response)

    return responses


async def crawl(url: str):

    url = clean_url(url)

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            headless=False
        )

        context = await browser.new_context(
            viewport={
                "width": 1440,
                "height": 1000
            },

            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/154.0.0.0 Safari/537.36"
            )
        )

        page = await context.new_page()

        network_responses = []

        async def handle_response(response):

            try:

                content_type = (
                    response.headers
                    .get("content-type", "")
                    .lower()
                )

                if (
                    "application/json" in content_type
                    and response.status == 200
                ):

                    data = await response.json()

                    network_responses.append({
                        "url": response.url,
                        "status": response.status,
                        "data": data
                    })

            except Exception:
                pass

        page.on("response", handle_response)

        print(f"Opening: {url}")

        response = await page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=60000
        )

        print(
            f"HTTP status: "
            f"{response.status if response else 'unknown'}"
        )

        # Allow JS application to render
        await page.wait_for_timeout(5000)

        # Trigger lazy loading
        print("Scrolling page...")

        await scroll_page(page)

        # Give late requests time to finish
        await page.wait_for_timeout(3000)

        print("Extracting page data...")

        page_data = await extract_page_content(page)

        json_ld = await extract_json_ld(page)

        embedded_json = await extract_embedded_json(page)

        images = await extract_images(
            page,
            page.url
        )

        vin = extract_vin(
            url,
            page_data["text"]
        )

        parsed_url = urlparse(page.url)

        result = {

            "source": {
                "url": url,
                "final_url": page.url,
                "domain": parsed_url.netloc,
                "scraped_at": datetime.now(
                    timezone.utc
                ).isoformat()
            },

            "vehicle": {
                "vin": vin
            },

            "page": {
                "title": page_data["title"],
                "meta": page_data["meta"]
            },

            "images": images,

            "json_ld": json_ld,

            "embedded_json": embedded_json,

            "network_json": network_responses,

            "raw_text": page_data["text"]

        }

        await browser.close()

        return result


async def main(url):

    result = await crawl(url)

    vin = result["vehicle"]["vin"] or "unknown"

    output_file = OUTPUT_DIR / f"{vin}.json"

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            result,
            f,
            indent=2,
            ensure_ascii=False
        )

    print()
    print("=" * 60)
    print("CRAWL COMPLETE")
    print("=" * 60)

    print(f"VIN: {vin}")
    print(
        f"Images found: "
        f"{len(result['images'])}"
    )

    print(
        f"JSON-LD blocks: "
        f"{len(result['json_ld'])}"
    )

    print(
        f"Embedded JSON blocks: "
        f"{len(result['embedded_json'])}"
    )

    print(
        f"Network JSON responses: "
        f"{len(result['network_json'])}"
    )

    print(f"Output: {output_file}")

    return result