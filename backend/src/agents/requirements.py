import re

from langgraph.graph import END, START, StateGraph

from src.agents.state import AgentState

REQUIRED = ["brand", "model", "buyer_area", "state", "timeline"]


def gather_requirements(state: AgentState) -> AgentState:
    text = state.get("message", "")
    current = dict(state.get("requirements", {}))
    brands = ["Audi", "BMW", "Chevrolet", "Ford", "Honda", "Hyundai", "Kia", "Mahindra", "Mercedes-Benz", "Nissan", "Tesla", "Toyota"]
    for brand in brands:
        if brand.lower() in text.lower():
            current["brand"] = brand
    budget = re.search(r"(?:under|budget|max)\s*\$?([0-9][0-9,]*)", text, re.IGNORECASE)
    if budget:
        current["budget_max"] = budget.group(1).replace(",", "")
    for timeline in ["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"]:
        if timeline.lower() in text.lower():
            current["timeline"] = timeline
    missing = [field for field in REQUIRED if not current.get(field)]
    questions = []
    if "brand" in missing:
        questions.append({"field": "brand", "question": "Which brands are you open to?", "options": brands[:6], "multiple": True})
    if "model" in missing:
        questions.append({"field": "model", "question": "Do you have a model in mind?", "options": [], "multiple": False})
    if "buyer_area" in missing:
        questions.append({"field": "buyer_area", "question": "What city and state should dealers search around?", "options": [], "multiple": False})
    if "timeline" in missing:
        questions.append({"field": "timeline", "question": "When are you hoping to buy?", "options": ["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"], "multiple": False})
    return {"requirements": current, "missing_fields": missing, "suggested_questions": questions[:3]}


def build_requirement_graph():
    graph = StateGraph(AgentState)
    graph.add_node("gather", gather_requirements)
    graph.add_edge(START, "gather")
    graph.add_edge("gather", END)
    return graph.compile()
