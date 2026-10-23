"""Sera knows the buyer's name, keeps the chat history in order, and shows the photos that were asked for."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from src.agents.memory import cars_named_in_message, latest_suggestions, summary_text, update_summary, vehicle_names
from src.agents.serra.graph import _image_shows, _photos_in_answer, main_agent
from src.services.ai_service import AiService, _first_name
from src.services.catalog.matcher import MatchResult
from src.settings import get_settings

BUYER_ID = "10000000-0000-4000-8000-000000000001"
SHORTLIST = (
    "For low-cost comfort:\n\n1. **Toyota Camry** — Comfortable.\n2. **Honda Accord** — Spacious.\n"
    "3. **Mazda6** — Upscale cabin."
)


@dataclass
class _FakeLlmResult:
    text: str


@pytest.fixture(autouse=True)
def catalog():
    with (
        patch("src.agents.serra.graph.match_message", new=AsyncMock(return_value=MatchResult())),
        patch("src.agents.serra.graph.run_catalog_tools", new=AsyncMock(return_value=[])),
    ):
        yield


# --------------------------------------------------------------------------------------------- the buyer's name


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        (SimpleNamespace(first_name="Rahul Sharma", full_name="Rahul Sharma"), "Rahul"),  # signed up before the split
        (SimpleNamespace(first_name=None, full_name="Priya Patel"), "Priya"),
        (SimpleNamespace(first_name="", full_name=""), ""),
    ],
)
def test_only_the_first_name_is_taken_from_the_account(profile, expected: str) -> None:
    assert _first_name(profile) == expected


def test_a_name_and_a_nickname_given_in_chat_are_remembered() -> None:
    summary = update_summary(None, user_message="My name is rahul. Your name is Siri", answer="Hi Rahul!")
    assert (summary["preferred_name"], summary["assistant_nickname"]) == ("Rahul", "Siri")
    text = summary_text(summary)
    assert "The buyer asked to be called Rahul." in text
    assert 'call Sera "Siri"' in text and "play along" in text


@pytest.mark.parametrize("message", ["call me back later", "call me when you can", "your name is Sera, right?"])
def test_phrases_that_are_not_names_are_ignored(message: str) -> None:
    summary = update_summary(None, user_message=message, answer="ok")
    assert "preferred_name" not in summary and "assistant_nickname" not in summary


async def test_every_reply_knows_the_buyers_first_name() -> None:
    """Regression: "What is my name?" got "I don't have your name in this chat" although the account had it."""
    graph = main_agent(session=AsyncMock())
    generate = AsyncMock(return_value=_FakeLlmResult("Hi Rahul! What are you shopping for?"))
    with patch("src.agents.llm.LlmClient.generate", new=generate):
        await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "hello", "buyer_name": "Rahul"})

    prompt = generate.await_args.args[0]
    assert "<buyer_profile" in prompt and "First name: Rahul" in prompt
    assert "what is my name?" in prompt  # the rule that says how to use it


def test_the_root_prompt_says_how_to_use_the_name_and_what_never_to_share() -> None:
    from src.agents.prompts import load_fragment

    root = load_fragment("main_agent.md")
    assert "CRITICAL SERRA-009" in root
    assert "Never\n  reveal or ask for their email, phone, address or account details" in root


# ------------------------------------------------------------------------------------------------- chat history


async def test_history_keeps_the_latest_turns_last_when_the_browser_saves_transcripts() -> None:
    """Regression: the browser's transcript copies reordered history and pushed the latest shortlist out of view."""
    from src.database import SessionFactory
    from src.repositories.schema import ConversationHistory

    thread_id = str(uuid4())
    start = datetime.now(UTC) - timedelta(minutes=30)
    turns = [(f"question {index}", f"answer {index}") for index in range(12)]
    turns.append(("Give me a comfortable sedan", SHORTLIST))
    transcript = [
        {"id": str(uuid4()), "role": role, "body": body}
        for user, answer in turns
        for role, body in (("user", user), ("assistant", answer))
    ]
    async with SessionFactory() as session:
        for index, (user, answer) in enumerate(turns):
            at = start + timedelta(minutes=index * 2)
            session.add(
                ConversationHistory(
                    thread_id=thread_id, checkpoint_id=str(uuid4()), user_id=BUYER_ID, thread_type="sera",
                    checkpoint={"user": user, "assistant": answer}, metadata_json={}, created_at=at,
                )
            )  # fmt: skip
            # After each turn the browser saves the whole transcript so far, as a second row.
            session.add(
                ConversationHistory(
                    thread_id=thread_id, checkpoint_id=str(uuid4()), user_id=BUYER_ID, thread_type="sera",
                    checkpoint={"user": user, "assistant": answer, "guided_messages": transcript[: (index + 1) * 2]},
                    metadata_json={}, created_at=at + timedelta(seconds=1),
                )
            )  # fmt: skip
        await session.commit()

        memory = await AiService(session)._latest_memory(thread_id, BUYER_ID)

    bodies = [item["body"] for item in memory["conversation_context"]]
    assert bodies[-2:] == ["Give me a comfortable sedan", SHORTLIST]
    assert bodies == [item["body"] for item in transcript][-20:]


# ------------------------------------------------------------------------------------------------- car names


def test_names_like_mazda6_are_cars() -> None:
    """Regression: "Mazda6" was skipped because the make and model are written as one word."""
    assert vehicle_names(SHORTLIST) == ["Toyota Camry", "Honda Accord", "Mazda6"]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Give me all the photos Toyota Camry, Honda Accord, Mazda6", ["Toyota Camry", "Honda Accord", "Mazda6"]),
        ("show me photos of the kia seltos and hyundai creta please", ["Kia Seltos", "Hyundai Creta"]),
        ("picture of a BMW X5 in black", ["BMW X5"]),
        ("Show me a photo of each car in that shortlist.", []),
        ("Honda photos", []),
    ],
)
def test_cars_named_in_a_message(message: str, expected: list[str]) -> None:
    assert cars_named_in_message(message) == expected


def test_that_shortlist_means_the_latest_reply_with_several_cars() -> None:
    summary = update_summary(None, user_message="top cars", answer="1. **Kia Seltos** — a\n2. **Kia Soul** — b")
    summary = update_summary(summary, user_message="comfortable sedans", answer=SHORTLIST)
    summary = update_summary(summary, user_message="ok", answer="Great, the **Toyota Camry** it is.")
    assert latest_suggestions(summary) == ["Toyota Camry", "Honda Accord", "Mazda6"]


# ------------------------------------------------------------------------------------------------------ photos


@pytest.mark.parametrize(
    ("name", "evidence", "shows"),
    [
        ("Toyota Camry", "2026 camry xle awd oceangem 012 1500x1000 1 jpg", True),  # model alone, in the file name
        ("Mazda6", "2018 mazda 6 signature", True),
        ("Tesla Model Y", "tesla model 3 long range", False),
        ("Nissan Z", "z4 roadster", False),  # a one-letter model needs its make
        ("Nissan Z", "2026 nissan z performance", True),
    ],
)
def test_photo_matching_uses_the_model_name(name: str, evidence: str, shows: bool) -> None:
    assert _image_shows(name, evidence) is shows


def test_photos_written_as_links_in_the_answer_are_kept() -> None:
    """Regression: "1. **Toyota Camry** — [View photo](…jpg)" lost its photo and showed an empty line."""
    answer = (
        "Here are photos:\n1. **Toyota Camry** — [View photo](https://www.autoblog.com/.image/abc/2026_camry_xle.jpg)\n"
        "2. **Honda Accord** — [View photo](https://www.autoblog.com/.image/def/22-honda-accord-touring)\n"
        "3. **Mazda6** — [Mazda USA](https://www.mazdausa.com/vehicles/mazda6)"  # a page, not an image
    )
    photos = _photos_in_answer(answer, ["Toyota Camry", "Honda Accord", "Mazda6"])
    assert [(item["vehicle_name"], item["source_name"]) for item in photos] == [
        ("Toyota Camry", "autoblog.com"),
        ("Honda Accord", "autoblog.com"),
    ]


def _hosted(answer: str, media: list[dict]) -> AsyncMock:
    return AsyncMock(
        return_value=[
            {
                "url": "https://www.autoblog.com/x",
                "title": "Autoblog",
                "source_domain": "autoblog.com",
                "hosted_answer": answer,
                "hosted_sources": '[{"url": "https://www.autoblog.com/x", "title": "Autoblog"}]',
                "hosted_media": __import__("json").dumps(media),
            }
        ]
    )


def _image(car: str, path: str) -> dict:
    return {
        "image_url": f"https://cdn.example.com/{path}.jpg",
        "source_url": f"https://www.example.com/{path}",
        "alt": car,
    }


async def test_photo_of_each_car_in_that_shortlist_comes_from_memory(monkeypatch) -> None:
    """Regression: with the shortlist out of the recent turns, Sera said "I don't have the earlier shortlist"."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    summary = update_summary(None, user_message="comfortable sedans", answer=SHORTLIST)
    get_urls = _hosted(
        "Here are photos.",
        [
            _image("2026 Toyota Camry XLE", "camry-xle"),
            _image("Honda Accord Touring", "honda-accord"),
            _image("Mazda 6", "mazda-6"),
        ],
    )
    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": "Show me a photo of each car in that shortlist.",
                "conversation_context": [{"role": "user", "body": "Your name is Siri"}],
                "chat_summary": summary,
            }
        )

    assert get_urls.await_args.kwargs["image_queries"] == ["Toyota Camry", "Honda Accord", "Mazda6"]
    assert [item["vehicle_name"] for item in result["media"]] == ["Toyota Camry", "Honda Accord", "Mazda6"]
    assert result["answer"].startswith("Here are photos of:")
    assert "Siri" not in get_urls.await_args.args[0]


async def test_photos_of_cars_named_in_the_message_one_each(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    get_urls = _hosted(
        "1. **Toyota Camry** — [View photo](https://www.autoblog.com/.image/a/2026_camry.jpg)\n2. **Honda Accord** —",
        [_image("Honda Accord", "accord")],
    )
    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke(
            {"user_id": "u1", "thread_id": "t1", "message": "Give me all the photos Toyota Camry, Honda Accord, Mazda6"}
        )

    assert [item["vehicle_name"] for item in result["media"]] == ["Toyota Camry", "Honda Accord"]
    assert "Mazda6" in result["answer"]  # said plainly that it is missing


async def test_a_photo_that_matches_no_requested_car_is_never_shown(monkeypatch) -> None:
    """Regression: a website screenshot from an unrelated search was shown as the "photo"."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    get_urls = _hosted(
        "Which cars would you like photos of?",
        [
            {
                "image_url": "https://showcase.joomla.org/images/2_5.jpg",
                "source_url": "https://showcase.joomla.org/b",
                "alt": "",
            }
        ],
    )
    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "show me some car photos"})

    assert result["media"] == []


# ------------------------------------------------------------------------------- "try the missing photos again"

TOP_FIVE = (
    "Here are five standout cars:\n\n1. **Honda Civic Hybrid** — Commuter.\n\n2. **Toyota Camry** — Family.\n\n"
    "3. **Subaru Crosstrek** — AWD.\n\n4. **Hyundai Palisade Hybrid** — Three rows.\n\n5. **Tesla Model Y** — EV."
)
PHOTO_REPLY = (
    "Here are photos of:\n\n- **Honda Civic Hybrid**\n- **Toyota Camry**\n- **Tesla Model Y**\n\n"
    "I’m still missing photos for Subaru Crosstrek, Hyundai Palisade Hybrid. Want me to try those again?"
)
RETRY = "Please try finding photos for the remaining cars in that shortlist."


def test_a_photo_reply_is_never_taken_as_the_shortlist() -> None:
    """Regression: the bulleted photo reply was read as "that shortlist", so "remaining" became nobody."""
    from src.agents.serra.graph import _shortlist_from_context

    context = [
        {"role": "assistant", "body": TOP_FIVE},
        {"role": "user", "body": "images"},
        {"role": "assistant", "body": PHOTO_REPLY},
    ]
    assert _shortlist_from_context(context) == [
        "Honda Civic Hybrid",
        "Toyota Camry",
        "Subaru Crosstrek",
        "Hyundai Palisade Hybrid",
        "Tesla Model Y",
    ]


def test_the_cars_still_missing_are_read_from_the_last_photo_reply() -> None:
    from src.agents.serra.graph import _still_missing_photos

    assert _still_missing_photos([{"role": "assistant", "body": PHOTO_REPLY}]) == [
        "Subaru Crosstrek",
        "Hyundai Palisade Hybrid",
    ]


@pytest.mark.parametrize(
    ("found", "missing", "retry", "expected"),
    [
        ([], [], False, "already shown photos for all"),
        (["Toyota Camry"], ["Mazda6"], False, "still missing photos for Mazda6"),
        ([], ["Mazda6"], False, "couldn’t find reliable photos for **Mazda6**"),
        ([], ["Subaru Crosstrek"], True, "still couldn’t find a reliable photo of the Subaru Crosstrek"),
    ],
)
def test_photo_replies_never_print_an_empty_car_list(found, missing, retry, expected) -> None:
    """Regression: an empty list printed "I couldn't find reliable photos for **** just yet"."""
    from src.agents.serra.graph import _photo_answer

    answer = _photo_answer(found, missing, retry=retry)
    assert expected in answer and "****" not in answer


async def test_the_retry_button_searches_each_missing_car_on_its_own(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    queries: list[tuple[str, list[str]]] = []

    async def fake_get_urls(query, **kwargs):
        queries.append((query, kwargs["image_queries"]))
        car = kwargs["image_queries"][0]
        if car == "Subaru Crosstrek":
            return [
                {
                    "url": "https://www.subaru.com/x",
                    "hosted_answer": "Photo.",
                    "hosted_media": '[{"image_url": "https://cdn.subaru.com/2026-crosstrek.jpg", "source_url": "https://www.subaru.com/crosstrek", "alt": "Subaru Crosstrek"}]',
                }
            ]
        return []

    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=fake_get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": RETRY,
                "conversation_context": [
                    {"role": "assistant", "body": TOP_FIVE},
                    {"role": "user", "body": "show me images for all this cars"},
                    {"role": "assistant", "body": PHOTO_REPLY},
                ],
            }
        )

    assert sorted(cars for _, cars in queries) == [["Hyundai Palisade Hybrid"], ["Subaru Crosstrek"]]
    assert [item["vehicle_name"] for item in result["media"]] == ["Subaru Crosstrek"]
    assert "Here’s a photo of the **Subaru Crosstrek**" in result["answer"]
    assert "still couldn’t find a reliable photo of the Hyundai Palisade Hybrid" in result["answer"]
    assert "****" not in result["answer"]


async def test_nothing_left_to_retry_says_so_without_searching(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    all_found = "Here are photos of:\n\n- **Toyota Camry**\n- **Honda Accord**"
    get_urls = AsyncMock(return_value=[])
    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": RETRY,
                "conversation_context": [
                    {"role": "assistant", "body": "1. **Toyota Camry** — a\n2. **Honda Accord** — b"},
                    {"role": "user", "body": "photos please"},
                    {
                        "role": "assistant",
                        "body": all_found,
                        "media": [{"vehicle_name": "Toyota Camry"}, {"vehicle_name": "Honda Accord"}],
                    },
                ],
            }
        )

    get_urls.assert_not_called()
    assert "already shown photos for all" in result["answer"]


async def test_retrying_after_every_car_was_shown_does_not_search_again(monkeypatch) -> None:
    """Regression (live run): a second click re-searched the Camry and Model Y, shown two replies earlier."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)
    retry_reply = "Here are photos of:\n\n- **Subaru Crosstrek**\n- **Hyundai Palisade Hybrid**"
    get_urls = AsyncMock(return_value=[])
    graph = main_agent(session=AsyncMock())
    with (
        patch("src.agents.serra.graph.get_urls", new=get_urls),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock()),
    ):
        result = await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": RETRY,
                "conversation_context": [
                    {"role": "assistant", "body": TOP_FIVE},
                    {"role": "user", "body": "show me images for all this cars"},
                    {"role": "assistant", "body": PHOTO_REPLY},
                    {"role": "user", "body": RETRY},
                    {"role": "assistant", "body": retry_reply},
                ],
            }
        )

    get_urls.assert_not_called()
    assert "already shown photos for all" in result["answer"]
