import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the DriveDeal API")
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
