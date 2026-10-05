from src.agents.state import AgentState
from src.utils.logger import logger


def log_agent_step(graph: str, agent: str, state: AgentState, **fields) -> int:
    """Logs one node's execution with an incrementing per-thread sequence number so a thread_id's
    agent_step log lines, read in order, show the path taken through the graph."""
    sequence = state.get("step", 0) + 1
    logger.info("agent_step", graph=graph, agent=agent, thread_id=state.get("thread_id"), sequence=sequence, **fields)
    return sequence
