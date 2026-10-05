import argparse
import asyncio
import os
import sys

import uvicorn


def main() -> None:
    # psycopg's async mode (used by LangGraph's AsyncPostgresSaver) can't run on Windows' default
    # ProactorEventLoop. uvicorn's own event loop is created before it lazily imports "main:app", so
    # this has to be set here - before uvicorn.run() - not inside main.py, which runs too late.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    parser = argparse.ArgumentParser(description="Run the Deal&Drive API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--no-ai", action="store_true", help="Disable LangGraph/OpenAI and stream deterministic Serra demo responses")
    args = parser.parse_args()
    if args.no_ai:
        os.environ["AI_DISABLED"] = "true"
    uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
