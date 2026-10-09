"""Stage 3: cheap, deterministic relevance scoring from title/domain/snippet alone - no
page fetch, no LLM (parent doc, section 9/24/39: "don't use an LLM for ranking if math can
do it"). Picks which candidates are worth the cost of an actual crawl.
"""

import time

from config import MAKE_DOMAIN_MAP, settings
from models import CandidateUrl, StageTiming


def _score(query: str, candidate: CandidateUrl) -> float:
    query_terms = {t for t in query.lower().split() if len(t) > 2}
    haystack = f"{candidate.title} {candidate.snippet}".lower()

    score = sum(2.0 for term in query_terms if term in haystack)
    score += 1.0 if candidate.source_domain in MAKE_DOMAIN_MAP.values() else 0.0
    score += 0.5 * len(candidate.providers)  # found by both search providers -> more likely relevant
    score += 0.5 if any(kw in candidate.source_domain for kw in ("cars", "autotrader", "cargurus", "truecar", "carmax")) else 0.0
    return score


def rank_candidates(query: str, candidates: list[CandidateUrl]) -> tuple[list[CandidateUrl], StageTiming]:
    start = time.perf_counter()
    for candidate in candidates:
        candidate.relevance_score = _score(query, candidate)
    ranked = sorted(candidates, key=lambda c: c.relevance_score, reverse=True)
    selected = ranked[: settings.max_crawl_candidates]
    duration_ms = (time.perf_counter() - start) * 1000
    timing = StageTiming(
        stage="rank_candidates",
        method="deterministic_keyword_score",
        duration_ms=duration_ms,
        detail={
            "total_candidates": len(candidates),
            "selected_for_crawl": len(selected),
            "scores": [{"url": c.url, "score": c.relevance_score} for c in ranked],
        },
    )
    return selected, timing
