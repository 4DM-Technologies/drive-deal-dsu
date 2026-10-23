from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    user_id: str
    thread_id: str
    trace_id: str
    message: str
    conversation_context: list[dict[str, Any]]
    chat_summary: dict[str, Any]
    buyer_name: str
    route: str
    mode: str
    search_query: str
    include_images: bool
    preferences: dict[str, Any]
    preferences_pending: bool
    chat_preferences: str
    car_names: list[str]
    car_specs: list[dict[str, Any]]
    kb_results: list[dict[str, Any]]
    catalog_results: list[dict[str, Any]]
    tool_plan_source: str
    kb_searched: bool
    kb_results_relevant: bool
    web_results: list[dict[str, str]]
    search_provider: str
    requirements: dict[str, Any]
    missing_fields: list[str]
    suggested_questions: list[dict[str, Any]]
    vehicle_selection: bool
    named_model_missing: str
    comparison_rows: list[dict[str, Any]]
    answer: str
    direct_web_answer: bool
    sources: list[dict[str, str]]
    media: list[dict[str, str]]
    preview: bool
    step: int
