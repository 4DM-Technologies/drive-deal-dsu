"""Pure helpers behind the advisor: citation parsing, routing predicates and request publishing."""

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest

from src.agents.llm import _extract_url_citations
from src.agents.serra.graph import (
    _extract_json,
    _extract_json_array,
    _trace_snapshot,
    is_explicit_image_search,
)
from src.services.ai_service import _is_publish_confirmation, _money_value

CITATION = {"type": "url_citation", "url": "https://www.kia.com/us/seltos", "title": "Kia Seltos"}


# --- _extract_url_citations ------------------------------------------------------------------------------------


def test_citations_are_found_in_nested_sdk_payloads() -> None:
    event = {"item": {"annotations": [CITATION, {"type": "file_citation"}], "other": ["text", 1]}}

    assert _extract_url_citations(event) == [{"url": "https://www.kia.com/us/seltos", "title": "Kia Seltos"}]


def test_citation_without_a_title_gets_a_generic_one() -> None:
    assert _extract_url_citations({"type": "url_citation", "url": "https://a.com"}) == [
        {"url": "https://a.com", "title": "Web source"}
    ]


def test_citations_are_read_from_sdk_objects_and_tuples() -> None:
    class Annotated:
        def model_dump(self) -> dict:
            return {"annotations": [CITATION]}

    plain_object = SimpleNamespace(annotations=({"type": "url_citation", "url": "https://b.com", "title": "B"},))

    assert _extract_url_citations(Annotated())[0]["url"] == "https://www.kia.com/us/seltos"
    assert _extract_url_citations(plain_object) == [{"url": "https://b.com", "title": "B"}]


def test_citation_parsing_never_raises_on_unexpected_input() -> None:
    class Broken:
        def model_dump(self) -> dict:
            raise RuntimeError("not serialisable")

    cyclic: dict = {}
    cyclic["self"] = cyclic
    too_deep: dict = {"a": {"b": {"c": {"d": {"e": {"f": {"g": CITATION}}}}}}}

    assert _extract_url_citations(None) == []
    assert _extract_url_citations("just text") == []
    assert _extract_url_citations(42) == []
    assert _extract_url_citations(Broken()) == []
    assert _extract_url_citations(cyclic) == []
    assert _extract_url_citations(too_deep) == []


# --- is_explicit_image_search ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Show me photos of the Kia Seltos", True),
        ("What does the BMW X3 interior look like?", True),
        ("Any pictures of a Tesla Model 3?", True),
        ("Show me a good deal", False),
        ("What is the price of a Toyota Camry?", False),
        ("Hello there", False),
    ],
)
def test_image_search_needs_both_an_image_word_and_a_vehicle(message: str, expected: bool) -> None:
    assert is_explicit_image_search(message) is expected


# --- JSON extraction and trace snapshots -----------------------------------------------------------------------


def test_json_is_extracted_from_model_replies_with_surrounding_text() -> None:
    assert _extract_json('Sure: {"route": "kb"} done') == {"route": "kb"}
    assert _extract_json('{"route": "advice"}') == {"route": "advice"}
    assert _extract_json_array('Here: ["a", "b"] ok') == ["a", "b"]
    assert _extract_json_array("[1, 2]") == [1, 2]


def test_trace_snapshot_keeps_only_the_keys_for_the_requested_side() -> None:
    state = {"message": "hi", "route": "kb", "answer": "hello", "sources": None, "requirements": {"brand": "Kia"}}

    assert _trace_snapshot(None) == {}
    assert _trace_snapshot({}) == {}
    assert _trace_snapshot(state) == {"message": "hi", "route": "kb", "requirements": {"brand": "Kia"}}
    assert _trace_snapshot(state, output=True) == {"route": "kb", "answer": "hello"}


def test_trace_snapshot_truncates_oversized_values() -> None:
    snapshot = _trace_snapshot({"answer": "a" * 20_000}, output=True)

    assert isinstance(snapshot["answer"], str)
    assert snapshot["answer"].endswith("…")
    assert len(snapshot["answer"]) < 13_000
    assert json.dumps(_trace_snapshot({"answer": "short"}, output=True)) == '{"answer": "short"}'


# --- ai_service helpers ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("post it", True),
        ("Yes, please publish this!", True),
        ("send my request.", True),
        ("  publish the request  ", True),
        ("post it tomorrow", False),
        ("should I post it?", False),
        ("hello", False),
    ],
)
def test_publish_confirmation_must_be_an_explicit_short_instruction(message: str, expected: bool) -> None:
    assert _is_publish_confirmation(message) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("negotiable", None),
        (35000, Decimal(35000)),
        ("30,000", Decimal(30000)),
        ("$45k", Decimal(45000)),
        ("1.2m", Decimal(1_200_000)),
    ],
)
def test_budget_text_is_converted_to_a_dollar_amount(value: object, expected: Decimal | None) -> None:
    assert _money_value(value) == expected
