"""CLI entry point.

Usage:
    python main.py "I want a Tesla"
    python main.py "top 10 cars under 40000"
"""

import asyncio
import json
import sys

from pipeline import run_pipeline


def main() -> None:
    if len(sys.argv) < 2:
        print('Usage: python main.py "your query here"')
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    results = asyncio.run(run_pipeline(query))

    print("\n=== Results ===")
    print(json.dumps([r.model_dump() for r in results], indent=2))


if __name__ == "__main__":
    main()
