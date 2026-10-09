import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from apify_client import ApifyClient
from dotenv import load_dotenv

ACTOR_ID = "lexis-solutions/carfax-com"
OUTPUT_DIR = Path(__file__).parent / "output"
# Actor returns 344x258 thumbnails; the CDN serves up to 1024x768 (1600x1200 is 403).
THUMB_SIZE_RE = re.compile(r"/\d+x\d+$")
IMAGE_SIZE = "1024x768"


def full_size_urls(item):
    return [THUMB_SIZE_RE.sub(f"/{IMAGE_SIZE}", url) for url in item.get("images") or []]


def download_images(urls, dest):
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, url in enumerate(urls, 1):
        path = dest / f"{i:03d}.jpg"
        try:
            resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            path.write_bytes(resp.content)
            saved.append(str(path.relative_to(OUTPUT_DIR)))
        except requests.RequestException as e:
            print(f"  image failed: {url} ({e})")
    return saved


def main(vins):
    load_dotenv(Path(__file__).parent / ".env")
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("APIFY_TOKEN not set (put it in testing/carfax-poc/.env)")

    client = ApifyClient(token)
    print(f"Running {ACTOR_ID} for {len(vins)} VIN(s)...")
    # Actor start fee is $0.005 per GB of memory; the 4 GB default quadruples it for no benefit.
    run = client.actor(ACTOR_ID).call(
        run_input={"VINs": vins, "maxItems": len(vins)}, memory_mbytes=1024
    )
    if run is None:
        sys.exit("Actor run failed to start")

    items = list(client.dataset(run.default_dataset_id).iterate_items())
    print(f"Run {run.id} finished with status {run.status}, {len(items)} item(s)")
    # Charges settle a few seconds after the run ends.
    time.sleep(5)
    print(f"Run cost: ${client.run(run.id).get().usage_total_usd or 0:.4f}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    for idx, item in enumerate(items):
        vin = item.get("vin") or item.get("VIN") or (vins[idx] if idx < len(vins) else f"item{idx}")
        image_urls = full_size_urls(item)
        print(f"{vin}: {len(image_urls)} image(s) found")
        item["imagesFullSize"] = image_urls
        item["_local_images"] = download_images(image_urls, OUTPUT_DIR / vin / "images")
        out = OUTPUT_DIR / f"{vin}.json"
        out.write_text(json.dumps(item, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  saved {out}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["1FAGP8FF9T5117173"])
