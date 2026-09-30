from pathlib import Path

from langgraph.graph import END, START, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.llm import LlmClient
from src.agents.state import AgentState
from src.agents.tools.kb import kb_insert, kb_search
from src.agents.tools.web_search import web_search

PROMPT_ROOT = Path(__file__).resolve().parents[2] / "prompt"


def build_serra_graph(session: AsyncSession, compare: bool = False):
    llm = LlmClient(session)
    system_prompt = (PROMPT_ROOT / ("compare.md" if compare else "serra_main.md")).read_text(encoding="utf-8")

    async def classify(state: AgentState) -> AgentState:
        result = await llm.generate(f"Classify as advice, compare, or requirements.\nUSER: {state['message']}", "classifier", state.get("thread_id"))
        return {"route": "compare" if compare else result.text.strip().lower()}

    async def knowledge(state: AgentState) -> AgentState:
        return {"kb_results": await kb_search(session, state["message"])}

    def need_web(state: AgentState) -> str:
        return "web" if not state.get("kb_results") else "compose"

    async def search_web(state: AgentState) -> AgentState:
        results = await web_search(state["message"])
        if results:
            await kb_insert(session, state["message"], results, state["user_id"])
        return {"web_results": results, "sources": [{"title": item["title"], "url": item["url"]} for item in results]}

    async def compose(state: AgentState) -> AgentState:
        evidence = state.get("kb_results") or state.get("web_results") or []
        task = "compare" if compare or state.get("route") == "compare" else "advisor"
        prompt = f"{system_prompt}\n\nUSER QUESTION:\n{state['message']}\n\nTRUSTED EVIDENCE:\n{evidence}"
        result = await llm.generate(prompt, task, state.get("thread_id"))
        return {"answer": result.text}

    graph = StateGraph(AgentState)
    graph.add_node("classifier", classify)
    graph.add_node("kb_agent", knowledge)
    graph.add_node("web_search_agent", search_web)
    graph.add_node("compose", compose)
    graph.add_edge(START, "classifier")
    graph.add_edge("classifier", "kb_agent")
    graph.add_conditional_edges("kb_agent", need_web, {"web": "web_search_agent", "compose": "compose"})
    graph.add_edge("web_search_agent", "compose")
    graph.add_edge("compose", END)
    return graph.compile()
