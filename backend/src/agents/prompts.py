from functools import lru_cache
from pathlib import Path

PROMPT_ROOT = Path(__file__).resolve().parents[1] / "prompt"


@lru_cache(maxsize=16)
def _read(name: str) -> str:
    return (PROMPT_ROOT / name).read_text(encoding="utf-8")


def _override(overrides: dict[str, str] | None, filename: str) -> str:
    key = filename.removesuffix(".md")
    return overrides.get(key, _read(filename)) if overrides else _read(filename)


def load_prompt(fragment: str, overrides: dict[str, str] | None = None) -> str:
    """Root skill (main_agent.md) + one node's fragment, concatenated. Every node's actual prompt is
    always "root skill + its one fragment," never one giant static file."""
    return f"{_override(overrides, 'main_agent.md')}\n\n{_override(overrides, fragment)}"


def load_fragment(fragment: str, overrides: dict[str, str] | None = None) -> str:
    """One node's fragment on its own, with no root skill.

    Used by nodes that answer directly instead of running the pipeline (small_talk). The root skill tells
    the model it orchestrates classifier/kb_agent/web_search_agent/compose nodes, which is both false and
    wasteful for a single-call reply, so those nodes get a self-contained prompt instead."""
    return _override(overrides, fragment)
