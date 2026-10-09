"""kb_agent's catalog tools and the kb_agent node, against a small catalog loaded through the real sync code."""

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

import pytest

from src.agents.tools import catalog_tools
from src.agents.tools.catalog_tools import (
    ToolCall,
    ToolPlan,
    fallback_plan,
    parse_plan,
    run_catalog_tools,
    shortcut_plan,
)
from src.services.catalog.matcher import invalidate_catalog_index, match_message
from src.services.catalog.sync import sync_catalog
from tests.test_catalog_sync import clear_catalog, epa_row

SUV = "Standard Sport Utility Vehicle 4WD"
ROWS = [
    epa_row(id="1", model="M3 Sedan", trany="Manual 6-spd"),
    epa_row(id="2", model="M3 Competition Sedan"),
    epa_row(id="3", model="M3 Competition M xDrive Sedan", drive="All-Wheel Drive", comb08="18"),
    epa_row(
        id="4",
        model="X5 xDrive40i",
        baseModel="X5",
        VClass=SUV,
        drive="All-Wheel Drive",
        atvType="Hybrid",
        eng_dscr="Mild Hybrid",
        comb08="25",
    ),
    epa_row(
        id="5",
        model="X5 xDrive50e",
        baseModel="X5",
        VClass=SUV,
        drive="All-Wheel Drive",
        atvType="Plug-in Hybrid",
        comb08="22",
        rangeA="39",
    ),
    epa_row(
        id="6",
        model="iX xDrive50",
        baseModel="iX",
        VClass=SUV,
        drive="All-Wheel Drive",
        atvType="EV",
        cylinders="",
        displ="",
        tCharger="",
        comb08="86",
        range="307",
    ),
    epa_row(
        id="7",
        make="Toyota",
        model="RAV4 Hybrid AWD",
        baseModel="RAV4",
        VClass=SUV,
        drive="All-Wheel Drive",
        atvType="Hybrid",
        eng_dscr="HEV",
        cylinders="4",
        displ="2.5",
        tCharger="",
        comb08="39",
    ),
    epa_row(
        id="8",
        year="2024",
        make="Toyota",
        model="RAV4 FWD",
        baseModel="RAV4",
        VClass=SUV,
        drive="Front-Wheel Drive",
        cylinders="4",
        displ="2.5",
        tCharger="",
        comb08="30",
    ),
    epa_row(
        id="9",
        make="Toyota",
        model="RAV4 FWD",
        baseModel="RAV4",
        VClass=SUV,
        drive="Front-Wheel Drive",
        cylinders="4",
        displ="2.5",
        tCharger="",
        comb08="30",
    ),
    epa_row(
        id="10",
        make="Audi",
        model="Q7 quattro",
        baseModel="Q7",
        VClass=SUV,
        drive="All-Wheel Drive",
        cylinders="4",
        displ="2.0",
        comb08="22",
    ),
]


@pytest.fixture
async def catalog():
    from src.database import SessionFactory, dispose_engine

    await clear_catalog()
    async with SessionFactory() as session:
        await sync_catalog(session, iter(ROWS), [2024, 2025], run_validation=False)
        await session.commit()
    invalidate_catalog_index()
    yield SessionFactory
    await clear_catalog()
    await dispose_engine()


async def run(session_factory, *calls: ToolCall):
    async with session_factory() as session:
        return await run_catalog_tools(session, ToolPlan(calls=list(calls)))


async def test_find_vehicles_filters_sorts_and_keeps_the_newest_year(catalog) -> None:
    [suvs] = await run(catalog, ToolCall(tool="find_vehicles", args={"body_style": "SUV", "sort_by": "mpg"}))
    mpg = [row["mpg_combined"] for row in suvs.rows]
    assert mpg == sorted(mpg, reverse=True)
    assert suvs.rows[0]["model"] == "iX"  # electric MPGe sorts first
    rav4_fwd = [row for row in suvs.rows if row["model"] == "RAV4" and row["drive"] == "FWD"]
    assert [row["year"] for row in rav4_fwd] == [2025]  # 2024 duplicate configuration collapsed

    [hybrids] = await run(catalog, ToolCall(tool="find_vehicles", args={"fuel_type": "Hybrid"}))
    assert [(row["make"], row["model"]) for row in hybrids.rows] == [("Toyota", "RAV4")]

    [older] = await run(
        catalog, ToolCall(tool="find_vehicles", args={"model": "RAV4", "make": "Toyota", "year_max": 2024})
    )
    assert [row["year"] for row in older.rows] == [2024]


async def test_get_model_details_resolves_names_and_lists_every_version(catalog) -> None:
    [m3] = await run(catalog, ToolCall(tool="get_model_details", args={"make": "bmw", "model": "BMW M3"}))
    details = m3.rows[0]
    assert (details["make"], details["model"], details["year_shown"]) == ("BMW", "M3", 2025)
    assert {version["transmission"] for version in details["versions"]} == {"Manual", "Automatic"}
    assert len(details["versions"]) == 3


async def test_list_models_and_list_makes(catalog) -> None:
    [models] = await run(catalog, ToolCall(tool="list_models", args={"make": "bimmer", "body_style": "SUV"}))
    assert [row["model"] for row in models.rows] == ["iX", "X5"]
    assert set(models.rows[1]["fuel_types"]) == {"Mild hybrid", "Plug-in hybrid"}

    [makes] = await run(catalog, ToolCall(tool="list_makes", args={"body_style": "SUV"}))
    assert {row["make"] for row in makes.rows} == {"Audi", "BMW", "Toyota"}
    assert all(isinstance(row["in_dealer_network"], bool) for row in makes.rows)


async def test_bad_calls_are_reported_not_run(catalog) -> None:
    results = await run(
        catalog,
        ToolCall(tool="find_vehicles", args={"body_style": "Saloon"}),
        ToolCall(tool="get_model_details", args={"make": "BMW", "model": "Model Z"}),
        ToolCall(tool="drop_table", args={"name": "users"}),
    )
    assert [bool(result.error) for result in results] == [True, True, True]
    assert all(result.rows == [] for result in results)
    assert "unknown tool" in results[2].error


def test_tools_can_only_reach_the_three_catalog_tables() -> None:
    from src.database import Base

    mapped = {
        name for name, value in vars(catalog_tools).items() if isinstance(value, type) and issubclass(value, Base)
    }
    assert mapped == {"CatalogMake", "CatalogModel", "CatalogVariant"}


def test_parse_plan_accepts_json_inside_text_and_caps_the_number_of_calls() -> None:
    plan = parse_plan('Here you go: {"calls": [' + ",".join(['{"tool": "list_makes", "args": {}}'] * 5) + "]}")
    assert len(plan.calls) == 3
    with pytest.raises(ValueError):
        parse_plan("I think you should look at the BMW X5")


async def test_shortcut_and_fallback_plans(catalog) -> None:
    async with catalog() as session:
        named = await match_message(session, "Does the BMW M3 come in manual?")
        both = await match_message(session, "X5 vs Audi Q7")
        broader = await match_message(session, "cars like the RAV4 but cheaper")
        brand_only = await match_message(session, "what BMW SUVs are there")

    assert [call.args for call in shortcut_plan("Does the BMW M3 come in manual?", named).calls] == [
        {"make": "BMW", "model": "M3"}
    ]
    assert {call.args["model"] for call in shortcut_plan("X5 vs Audi Q7", both).calls} == {"X5", "Q7"}
    assert shortcut_plan("cars like the RAV4 but cheaper", broader) is None
    assert fallback_plan("what BMW SUVs are there", brand_only).calls[0].model_dump() == {
        "tool": "list_models",
        "args": {"make": "BMW", "body_style": "SUV"},
    }
    assert fallback_plan("how does leasing work", await _no_hints(catalog)).calls == []


async def _no_hints(session_factory):
    async with session_factory() as session:
        return await match_message(session, "how does leasing work")


# --- kb_agent inside the Sera graph ---------------------------------------------------------------------------


@dataclass
class _Llm:
    text: str


async def _run_graph(session_factory, message: str, responses: list[str]):
    from src.agents.serra.graph import main_agent

    generate = AsyncMock(side_effect=[_Llm(text) for text in responses])
    async with session_factory() as session:
        graph = main_agent(session)
        with (
            patch("src.agents.llm.LlmClient.generate", new=generate),
            patch("src.agents.serra.graph.get_urls", new=AsyncMock()) as get_urls,
        ):
            result = await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": message})
    return result, generate, get_urls


async def test_kb_agent_runs_the_llm_tool_plan_and_compose_sees_the_rows(catalog) -> None:
    plan = '{"calls": [{"tool": "find_vehicles", "args": {"body_style": "SUV", "fuel_type": "Hybrid"}}]}'
    result, generate, get_urls = await _run_graph(
        catalog, "what are the most efficient hybrid SUVs?", ["advice", '{"mode": "kb_only"}', plan, "The RAV4."]
    )
    assert result["tool_plan_source"] == "llm"
    assert result["catalog_results"][0]["rows"][0]["model"] == "RAV4"
    assert generate.await_args_list[2].args[1] == "catalog_tool_plan"
    compose_prompt = generate.await_args_list[-1].args[0]
    assert '<catalog_data trust="internal">' in compose_prompt and "RAV4" in compose_prompt
    assert result["answer"] == "The RAV4."
    get_urls.assert_not_called()


async def test_kb_agent_skips_the_llm_plan_when_a_model_is_named(catalog) -> None:
    result, generate, _ = await _run_graph(
        catalog, "Does the BMW M3 come in manual?", ["advice", '{"mode": "kb_only"}', "Yes, the M3 Sedan."]
    )
    assert generate.await_count == 3  # classifier, orchestrator, compose
    assert result["tool_plan_source"] == "shortcut"
    assert result["catalog_results"][0]["tool"] == "get_model_details"


async def test_unparsable_plan_falls_back_to_the_matcher_hints(catalog) -> None:
    result, _, _ = await _run_graph(
        catalog, "what BMW SUVs are there", ["advice", '{"mode": "kb_only"}', "no idea, sorry", "BMW has the X5."]
    )
    assert result["tool_plan_source"] == "fallback"
    assert {row["model"] for row in result["catalog_results"][0]["rows"]} == {"iX", "X5"}


async def test_general_advice_gets_an_empty_plan(catalog) -> None:
    result, generate, _ = await _run_graph(
        catalog, "how does leasing work?", ["advice", '{"mode": "kb_only"}', '{"calls": []}', "Leasing is renting."]
    )
    assert result["catalog_results"] == []
    assert generate.await_count == 4


@pytest.mark.parametrize(("web_enabled", "searched_online"), [(False, False), (True, True)])
async def test_web_direct_only_reaches_the_internet_when_web_search_is_on(
    catalog, monkeypatch, web_enabled: bool, searched_online: bool
) -> None:
    from src.settings import get_settings

    monkeypatch.setattr(get_settings(), "ai_enable_web_search", web_enabled)
    responses = (
        ["advice", '{"mode": "web_direct"}', '{"calls": []}', "answer"]
        if not web_enabled
        else [
            "advice",
            '{"mode": "web_direct"}',
            "answer",
        ]
    )
    result, _, get_urls = await _run_graph(catalog, "what's new in the electric SUV market", responses)
    assert get_urls.called is searched_online
    assert ("catalog_results" in result) is not searched_online
