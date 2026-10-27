"""Generate the public Vite environment file for a local frontend build.

Usage:
    python scripts/generate_env.py frontend --out <path>

The CI/CD workflow supplies public URLs directly from AWS Secrets Manager and
does not call this script. Backend credentials are injected into ECS from the
single backend secret by its task definition; never serialize those values into
an .env file or the frontend bundle.
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
            + "Set them in the local shell (public configuration only): "
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
