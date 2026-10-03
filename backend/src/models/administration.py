from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

ConfigType = Literal["workflow", "prompt", "theme"]


class Position(BaseModel):
    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    type: Literal["router", "agent", "tool", "action"]
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    position: Position


class WorkflowEdge(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    condition: str = Field(min_length=1, max_length=80)


class WorkflowDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    nodes: list[WorkflowNode] = Field(min_length=1, max_length=30)
    edges: list[WorkflowEdge] = Field(min_length=1, max_length=80)


class PromptDefinition(BaseModel):
    content: str = Field(min_length=20, max_length=50_000)
    model: str = Field(min_length=2, max_length=80)
    reasoning_effort: Literal["minimal", "low", "medium", "high", "xhigh"] = "medium"
    max_output_tokens: int = Field(default=4_000, ge=128, le=32_000)


class ThemeDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    primary_rgb: list[int]
    background_rgb: list[int] = [250, 249, 246]
    surface_rgb: list[int] = [255, 255, 255]
    text_rgb: list[int] = [31, 30, 27]
    navigation_rgb: list[int] = [255, 255, 255]

    @field_validator("primary_rgb", "background_rgb", "surface_rgb", "text_rgb", "navigation_rgb")
    @classmethod
    def validate_rgb(cls, value: list[int]) -> list[int]:
        if len(value) != 3 or any(component < 0 or component > 255 for component in value):
            raise ValueError("primary_rgb must contain exactly three values from 0 to 255")
        return value


class DraftSaveRequest(BaseModel):
    payload: dict[str, Any]
    base_version: int | None = Field(default=None, ge=0)


class ValidateConfigRequest(BaseModel):
    payload: dict[str, Any]


class PublishConfigRequest(BaseModel):
    revision_id: str


class WorkflowPreviewRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2_000)
    thread_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    revision_id: str | None = None
    workflow_payload: dict[str, Any] | None = None
    prompt_key: str | None = None
    prompt_payload: dict[str, Any] | None = None


class SetDefaultRequest(BaseModel):
    version: int = Field(ge=0)
