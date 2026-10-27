"""Generate the public Vite environment file for a frontend build.

Usage:
    python scripts/generate_env.py frontend --out <path>

The frontend receives only public URLs at build time. Backend credentials are
injected into ECS containers from AWS Secrets Manager by the task definition;
they must never be serialized into a CI-generated .env file or frontend bundle.
"""

import argparse
import os
import re
import sys
from pathlib import Path

import yaml

_TASK_DEFINITIONS = Path(__file__).resolve().parent.parent / "deploy" / "task-definition"
_SAFE_VALUE = re.compile(r"^[A-Za-z0-9_./:@+=\-?&,;~!*|{}%\[\]()]+$")


def _quote(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise SystemExit("error: value for env key contains a newline and cannot be exported safely")
    if _SAFE_VALUE.match(value) and not value.startswith("#") and value.strip() == value:
        return value
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", choices=["frontend"])
    parser.add_argument("--out", required=True, help="output env file path")
    args = parser.parse_args()

    template_path = _TASK_DEFINITIONS / f"{args.app}.yml"
    if not template_path.is_file():
        print(f"error: task definition not found: {template_path}", file=sys.stderr)
        return 1

    with open(template_path, "r", encoding="utf-8") as handle:
        template = yaml.safe_load(handle) or {}

    lines: list[str] = []
    missing: list[str] = []

    for entry in template.get("env", []):
        key = entry.get("key")
        if not key:
            continue

        value = os.environ.get(key)
        if value == "":
            value = None
        if value is None:
            default = entry.get("default")
            if default is None:
                if entry.get("required"):
                    missing.append(key)
                continue
            value = str(default)

        lines.append(f"{key}={_quote(value)}")

    if missing:
        print(
            "error: no value found for required env keys."
            + os.linesep
            + "Set them as GitHub repository variables (public configuration only): "
            + ", ".join(sorted(set(missing))),
            file=sys.stderr,
        )
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(lines) + ("\n" if lines else "")
    out.write_text(content, encoding="utf-8")
    print(f"generated {out} ({len(lines)} env entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
