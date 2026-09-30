from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    user_id: str
    thread_id: str
    message: str
    route: str
    kb_results: list[dict[str, Any]]
    web_results: list[dict[str, str]]
    requirements: dict[str, Any]
    missing_fields: list[str]
    suggested_questions: list[dict[str, Any]]
    answer: str
    sources: list[dict[str, str]]
