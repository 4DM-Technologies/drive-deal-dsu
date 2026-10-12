"""Pure helpers behind the advisor: citation parsing, routing predicates and request publishing."""

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest

from src.agents.llm import _bound_prompt, _extract_image_results, _extract_url_citations
from src.agents.serra.graph import (
    _extract_json,
    _extract_json_array,
    _label_matching_images,
    _previously_found_image_names,
    _shortlist_from_context,
    _trace_snapshot,
    is_contextual_image_followup,
    is_explicit_image_search,
)
from src.agents.tools import web_search as web_search_tools
from src.agents.tools.web_search import _vehicle_image_terms
from src.models.marketplace import AiGuidedMessage
from src.services.ai_service import _compact_conversation_context, _is_publish_confirmation, _money_value

CITATION = {"type": "url_citation", "url": "https://www.kia.com/us/seltos", "title": "Kia Seltos"}


def test_guided_checkpoint_message_keeps_media_and_sources_on_restore() -> None:
    message = AiGuidedMessage.model_validate(
        {
            "id": "assistant-1",
            "role": "assistant",
            "body": "Here are the photos.",
            "media": [{"image_url": "https://img.example/car.jpg", "vehicle_name": "BMW M2"}],
            "sources": [{"url": "https://www.example.com/car", "title": "Vehicle"}],
        }
    )

    assert message.model_dump()["media"][0]["vehicle_name"] == "BMW M2"
    assert message.model_dump()["sources"][0]["url"] == "https://www.example.com/car"


def test_prompt_budget_keeps_the_instructions_and_latest_user_request() -> None:
    prompt = "IMPORTANT INSTRUCTIONS " + ("old context " * 500) + "LATEST BUYER REQUEST: sports cars"

    bounded, truncated = _bound_prompt(prompt, max_input_tokens=1024)

    assert truncated is True
    assert len(bounded) <= 1024 * 3
    assert bounded.startswith("IMPORTANT INSTRUCTIONS")
    assert bounded.endswith("LATEST BUYER REQUEST: sports cars")


def test_conversation_context_is_bounded_but_keeps_the_latest_exchange() -> None:
    context = [
        {"role": "assistant", "body": f"Old answer {index}: " + ("x" * 1800)}
        for index in range(10)
    ]
    context.extend(
        [
            {"role": "assistant", "body": "1. Chevrolet Corvette Stingray — Fast.\n2. Porsche 911 Carrera — Balanced."},
            {"role": "user", "body": "Show me their images."},
        ]
    )

    compacted = _compact_conversation_context(context, max_chars=3000)

    assert compacted[-1]["body"] == "Show me their images."
    assert compacted[-2]["body"].startswith("1. Chevrolet Corvette Stingray")
    assert sum(len(str(item)) for item in compacted) <= 3000


@pytest.mark.asyncio
async def test_snippet_search_sends_compact_evidence_and_matches_vehicle_images(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, bool]] = []

    async def search_items(query: str, *, limit: int, image_search: bool = False) -> list[dict[str, str]]:
        calls.append((query, image_search))
        if image_search:
            return [
                {
                    "title": "BMW M2 Coupe front view",
                    "url": "https://images.example/bmw-m2.jpg",
                    "snippet": "BMW M2 Coupe exterior",
                    "source_url": "https://www.bmwusa.com/vehicles/m-models/m2-coupe.html",
                    "thumbnail_url": "https://images.example/bmw-m2-thumb.jpg",
                }
            ]
        return [
            {
                "title": "Best sports cars",
                "url": "https://www.example.com/sports-cars",
                "snippet": "BMW M2 is a compact, rear-wheel-drive performance coupe.",
                "source_url": "",
                "thumbnail_url": "",
            }
        ]

    class FakeLlm:
        prompt = ""

        async def generate(self, prompt: str, *_args, **_kwargs):
            self.prompt = prompt
            return SimpleNamespace(status="success", text="Top choice:\n\n1. **BMW M2** — A compact performance coupe.")

    monkeypatch.setattr(web_search_tools, "_google_cse_items", search_items)
    monkeypatch.setattr(web_search_tools, "_domain_of", lambda _url: "example.com")
    monkeypatch.setattr(web_search_tools, "_is_excluded_domain", lambda _domain: False)
    llm = FakeLlm()

    result = await web_search_tools._google_cse_get_urls(
        "top sports cars",
        limit=5,
        llm=llm,  # type: ignore[arg-type]
        thread_id="test-thread",
        market="US",
        include_images=True,
    )

    assert len(llm.prompt) < 3000
    assert "BMW M2 is a compact" in llm.prompt
    assert result[0]["search_provider"] == "google_cse_snippets"
    media = json.loads(result[0]["hosted_media"])
    assert [item["vehicle_name"] for item in media] == ["BMW M2"]
    assert any(image_search and '"BMW M2"' in query for query, image_search in calls)


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


def test_image_results_keep_the_direct_url_and_attribution_page() -> None:
    result = {
        "type": "web_search_call",
        "results": [
            {
                "type": "image_result",
                "image_url": "https://media.audi.com/a3.jpg",
                "source_website_url": "https://www.audiusa.com/a3",
                "thumbnail_url": "https://media.audi.com/a3-thumb.jpg",
                "caption": "Audi A3 sedan exterior",
            }
        ],
    }

    assert _extract_image_results(result) == [
        {
            "image_url": "https://media.audi.com/a3.jpg",
            "source_url": "https://www.audiusa.com/a3",
            "thumbnail_url": "https://media.audi.com/a3-thumb.jpg",
            "caption": "Audi A3 sedan exterior",
        }
    ]


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


def test_contextual_image_followup_uses_the_last_vehicle_shortlist() -> None:
    context = [
        {
            "role": "assistant",
            "body": "Top choices:\n1. **Chevrolet Corvette Stingray** — quick.\n2. **Porsche 911 Carrera** — balanced.\n3. **Mazda MX-5 Miata** — light.",
        }
    ]

    assert is_contextual_image_followup("with the images give me", context)
    assert _shortlist_from_context(context) == [
        "Chevrolet Corvette Stingray",
        "Porsche 911 Carrera",
        "Mazda MX-5 Miata",
    ]


def test_image_labels_require_full_identity_and_deduplicate_each_vehicle() -> None:
    names = ["Chevrolet Corvette Stingray", "Ford Mustang Dark Horse"]
    media = [
        {"image_url": "https://img.example/1.jpg", "source_url": "https://media.example/corvette-stingray", "alt": "Chevrolet Corvette Stingray exterior"},
        {"image_url": "https://img.example/2.jpg", "source_url": "https://media.example/corvette-stingray", "alt": "Chevrolet Corvette Stingray front"},
        {"image_url": "https://img.example/3.jpg", "source_url": "https://nissanzclub.com/mustang", "alt": "Ford Mustang GT"},
        {"image_url": "https://img.example/4.jpg", "source_url": "https://media.example/dark-horse", "alt": "Ford Mustang Dark Horse"},
    ]

    result = _label_matching_images(media, names)

    assert [item["vehicle_name"] for item in result] == names
    assert result[0]["alt"] == "Chevrolet Corvette Stingray exterior"


def test_image_search_identity_keeps_vehicle_variant_words() -> None:
    assert _vehicle_image_terms("Find photos of the 2026 Ford Mustang Dark Horse sports car") == [
        "ford",
        "mustang",
        "dark",
        "horse",
    ]


def test_other_image_followup_targets_only_models_without_a_verified_photo() -> None:
    names = ["Chevrolet Corvette Stingray", "Porsche 911 Carrera", "Mazda MX-5 Miata"]
    context = [
        {
            "role": "assistant",
            "body": "I found images for Chevrolet Corvette Stingray. I couldn’t verify photos for Porsche 911 Carrera, Mazda MX-5 Miata yet.",
            "media": [{"vehicle_name": "Chevrolet Corvette Stingray"}],
        }
    ]

    assert _previously_found_image_names(context, names) == ["Chevrolet Corvette Stingray"]


def test_retry_photo_followup_recognizes_new_friendly_single_photo_copy() -> None:
    names = ["Chevrolet Corvette Stingray", "Nissan Z"]
    context = [
        {
            "role": "assistant",
            "body": "I found a matching photo for **Nissan Z**. I’m still missing photos for Chevrolet Corvette Stingray.",
        }
    ]

    assert _previously_found_image_names(context, names) == ["Nissan Z"]


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
