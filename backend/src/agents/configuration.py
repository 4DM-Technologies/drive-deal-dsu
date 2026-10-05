"""Safe, declarative configuration for Serra's administrator-managed workflow."""

from copy import deepcopy
from typing import Any

from src.settings import ADMIN_THEME_KEY as THEME_KEY
from src.settings import ADMIN_WORKFLOW_KEY as WORKFLOW_KEY
from src.settings import AI_REASONING_EFFORTS as REASONING_EFFORTS

__all__ = [
    "MODEL_CATALOG",
    "NODE_CATALOG",
    "PROMPT_CATALOG",
    "REASONING_EFFORTS",
    "THEME_KEY",
    "WORKFLOW_KEY",
    "default_theme",
    "default_workflow",
    "prompt_file_for",
]

MODEL_CATALOG: tuple[dict[str, str], ...] = (
    {"id": "gpt-6.1-sol", "label": "GPT-6.1 Sol", "description": "Latest workhorse model for production agent tasks."},
    {
        "id": "gpt-6-astra",
        "label": "GPT-6 Astra",
        "description": "Frontier model for the most demanding reasoning tasks.",
    },
    {"id": "gpt-6-sol", "label": "GPT-6 Sol", "description": "Previous-generation workhorse model."},
    {
        "id": "gpt-6-luna",
        "label": "GPT-6 Luna",
        "description": "Fast model for lightweight routing and direct replies.",
    },
    {"id": "gpt-5.6-sol", "label": "GPT-5.6 Sol", "description": "Reliable workhorse model."},
    {"id": "gpt-5.6-terra", "label": "GPT-5.6 Terra", "description": "Balanced model for straightforward tasks."},
    {"id": "gpt-5.6-luna", "label": "GPT-5.6 Luna", "description": "Fast and efficient model."},
    {"id": "gpt-5.5", "label": "GPT-5.5", "description": "Legacy coding and reasoning model."},
)

NODE_CATALOG: tuple[dict[str, Any], ...] = (
    {"id": "triage", "type": "router", "label": "Triage", "description": "Fast deterministic safety and intent gate."},
    {
        "id": "classifier",
        "type": "agent",
        "label": "Classifier",
        "description": "Classifies advice, comparison, request, and off-topic messages.",
    },
    {
        "id": "orchestrator",
        "type": "agent",
        "label": "Orchestrator",
        "description": "Selects the lowest-cost safe execution plan.",
    },
    {
        "id": "kb_agent",
        "type": "tool",
        "label": "Deal&Drive knowledge",
        "description": "Retrieves marketplace knowledge and preferences.",
    },
    {
        "id": "web_search_agent",
        "type": "tool",
        "label": "Trusted web search",
        "description": "Researches allow-listed vehicle sources.",
    },
    {
        "id": "persist_cars",
        "type": "action",
        "label": "Persist verified cars",
        "description": "Stores complete researched vehicles for reuse.",
    },
    {
        "id": "compose",
        "type": "agent",
        "label": "Compose answer",
        "description": "Produces the final buyer-facing response.",
    },
    {
        "id": "small_talk",
        "type": "agent",
        "label": "Direct reply",
        "description": "Handles greetings and safe direct replies.",
    },
)

PROMPT_CATALOG: tuple[dict[str, str], ...] = (
    {
        "key": "main_agent",
        "file": "main_agent.md",
        "label": "Sera policy",
        "description": "Shared behaviour, safety, and response style.",
    },
    {
        "key": "orchestrator",
        "file": "orchestrator.md",
        "label": "Orchestrator",
        "description": "Chooses knowledge and research tools.",
    },
    {
        "key": "kb_agent",
        "file": "kb_agent.md",
        "label": "Knowledge agent",
        "description": "Retrieval and preference extraction guidance.",
    },
    {
        "key": "web_search_agent",
        "file": "web_search_agent.md",
        "label": "Web search agent",
        "description": "Trusted-source extraction rules.",
    },
    {
        "key": "compose",
        "file": "compose.md",
        "label": "Response composer",
        "description": "Final answer structure and evidence policy.",
    },
    {
        "key": "compare",
        "file": "compare.md",
        "label": "Offer comparison",
        "description": "Like-for-like dealer offer comparison.",
    },
    {
        "key": "small_talk",
        "file": "small_talk.md",
        "label": "Direct replies",
        "description": "Greetings, acknowledgements, and off-topic replies.",
    },
    {
        "key": "requirements",
        "file": "requirements.md",
        "label": "Buyer requirements",
        "description": "Structured buyer-request extraction.",
    },
)

DEFAULT_WORKFLOW: dict[str, Any] = {
    "name": "Sera buyer advisor",
    "description": "Production workflow for buyer advice, marketplace knowledge, and trusted web research.",
    "nodes": [
        {**NODE_CATALOG[0], "position": {"x": 220, "y": 235}},
        {**NODE_CATALOG[1], "position": {"x": 440, "y": 85}},
        {**NODE_CATALOG[2], "position": {"x": 660, "y": 85}},
        {**NODE_CATALOG[3], "position": {"x": 880, "y": 35}},
        {**NODE_CATALOG[4], "position": {"x": 880, "y": 285}},
        {**NODE_CATALOG[5], "position": {"x": 1100, "y": 285}},
        {**NODE_CATALOG[6], "position": {"x": 1320, "y": 160}},
        {**NODE_CATALOG[7], "position": {"x": 440, "y": 405}},
    ],
    "edges": [
        {"id": "start-triage", "source": "start", "target": "triage", "condition": "always"},
        {"id": "triage-small", "source": "triage", "target": "small_talk", "condition": "small_talk"},
        {"id": "triage-web", "source": "triage", "target": "web_search_agent", "condition": "web_search"},
        {"id": "triage-classifier", "source": "triage", "target": "classifier", "condition": "default"},
        {"id": "classifier-small", "source": "classifier", "target": "small_talk", "condition": "off_topic"},
        {"id": "classifier-orchestrator", "source": "classifier", "target": "orchestrator", "condition": "default"},
        {"id": "orchestrator-compose", "source": "orchestrator", "target": "compose", "condition": "compare"},
        {"id": "orchestrator-web", "source": "orchestrator", "target": "web_search_agent", "condition": "web_direct"},
        {"id": "orchestrator-kb", "source": "orchestrator", "target": "kb_agent", "condition": "default"},
        {"id": "kb-web", "source": "kb_agent", "target": "web_search_agent", "condition": "web_per_car"},
        {"id": "kb-compose", "source": "kb_agent", "target": "compose", "condition": "default"},
        {"id": "web-persist", "source": "web_search_agent", "target": "persist_cars", "condition": "always"},
        {"id": "persist-compose", "source": "persist_cars", "target": "compose", "condition": "always"},
        {"id": "compose-end", "source": "compose", "target": "end", "condition": "always"},
        {"id": "small-end", "source": "small_talk", "target": "end", "condition": "always"},
    ],
}

DEFAULT_THEME: dict[str, Any] = {
    "name": "Deal&Drive blue",
    "primary_rgb": [20, 86, 184],
    "background_rgb": [250, 249, 246],
    "surface_rgb": [255, 255, 255],
    "text_rgb": [31, 30, 27],
    "navigation_rgb": [255, 255, 255],
}

CONDITIONS_BY_SOURCE: dict[str, set[str]] = {
    "triage": {"small_talk", "web_search", "default"},
    "classifier": {"off_topic", "default"},
    "orchestrator": {"compare", "web_direct", "default"},
    "kb_agent": {"web_per_car", "default"},
    "web_search_agent": {"always"},
    "persist_cars": {"always"},
    "compose": {"always"},
    "small_talk": {"always"},
    "start": {"always"},
}


def default_workflow() -> dict[str, Any]:
    return deepcopy(DEFAULT_WORKFLOW)


def default_theme() -> dict[str, Any]:
    return deepcopy(DEFAULT_THEME)


def prompt_file_for(key: str) -> str | None:
    return next((item["file"] for item in PROMPT_CATALOG if item["key"] == key), None)
