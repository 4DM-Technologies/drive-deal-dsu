from functools import lru_cache
from pathlib import Path

PROMPT_ROOT = Path(__file__).resolve().parents[1] / "prompt"


@lru_cache(maxsize=16)
def _read(name: str) -> str:
    return (PROMPT_ROOT / name).read_text(encoding="utf-8")


def load_prompt(fragment: str) -> str:
    """Root skill (main_agent.md) + one node's fragment, concatenated. Every node's actual prompt is
    always "root skill + its one fragment," never one giant static file."""
    return f"{_read('main_agent.md')}\n\n{_read(fragment)}"
