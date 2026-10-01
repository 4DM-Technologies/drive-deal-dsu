class OrchestratorPlanError(RuntimeError):
    """Raised when the orchestrator node's LLM output does not parse against OrchestratorPlan.

    Deliberately not caught/swallowed anywhere in the graph - an unparsable plan means the agent
    cannot safely decide what to do next, so the request fails loudly rather than silently falling
    back to old deterministic behavior.
    """
