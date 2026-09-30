---
title: LLM API Usage Standards
inclusion: auto
name: llm-api-usage-standards
description: Apply when building API endpoints that invoke LLM models for task execution, focusing on guardrails, reliability, cost controls, and security for production LLM-backed APIs.
---

# LLM API Usage Standards

## Scope and Boundaries
- Applies to API endpoints that call an LLM to complete one or more predefined tasks.
- Focuses only on API-layer LLM task execution and runtime guardrails.
- Prompt design standards are covered in prompt-engineering standards.
- Agent orchestration standards are covered in agent standards.
- Python and security implementation standards are covered in python/development/security standards.


## Model Invocation
- Configure primary and fallback model per task in config, not hardcoded in route handlers.
- Set explicit invocation parameters per task: `temperature`, `max_tokens`, `timeout`, `retry_cap`.
- Model and provider overrides from end users must not be accepted unless explicitly whitelisted.
- Enforce per-task token budget before request dispatch.

## Input Guardrails
- Validate request shape, size, and encoding before prompt assembly.
- Redact or mask sensitive data not required for task completion.
- Reject out-of-scope or policy-violating requests before LLM call.
- Isolate tenant/session context to prevent cross-tenant data leakage into prompts.
- Run input moderation with explicit category thresholds before LLM call.

## Output Guardrails
- Validate LLM output against typed schema before returning API response.
- Run safety and policy checks on output before response serialization.
- Retry on validation failure within cap; return task-specific fallback on repeated failure.
- Raw model errors, hidden prompts, and internal traces must not be returned to clients.
- Run output moderation and PII/secret egress checks before returning to client.

## Instruction Hierarchy and Injection Defense
- Enforce instruction precedence: platform policy > task policy > system/developer instructions > user input > retrieved/tool text.
- Treat instructions in user content and tool output as untrusted data unless explicitly allowed by task policy.
- Block override attempts such as "ignore previous instructions", "reveal system prompt", or equivalent jailbreak patterns.
- Log a guardrail event with reason code on any policy conflict.

## Reliability and Cost Controls
- Apply endpoint-level rate limits and concurrency limits for LLM calls.
- Use circuit breaker or fail-fast behavior when provider latency/error rate breaches thresholds.
- Track per-task token and cost budgets with hard limits.
- Cache deterministic results only where task semantics allow it.
- Propagate request deadlines to LLM providers and cancel upstream calls on client disconnect/timeout.
- Use fail-closed behavior for high-risk tasks when moderation or policy checks are unavailable.

## Observability and Audit
- Log `correlation_id`, `task_id`, model, prompt version, latency, token usage, and outcome status.
- Record guardrail decisions (`blocked`, `retried`, `fallback`) with reason codes.
- Keep logs privacy-safe; avoid storing raw sensitive prompts/responses unless explicitly approved.
- Capture security events for prompt-injection attempts and policy override attempts.

## Testing Requirements
- Unit tests must mock LLM calls and validate task routing plus schema enforcement.
- Add contract tests for every task output schema and fallback path.
- Add adversarial tests for prompt injection, malformed inputs, and policy violations.
- Add load tests for rate-limit and timeout behavior on LLM-backed endpoints.
- Add explicit tests for instruction override attacks.