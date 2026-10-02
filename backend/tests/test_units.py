from src.agents.llm import LlmClient
from src.models.response import DataResponse, MessageResponse
from src.services.storage import get_storage
from src.services.storage.local_storage import LocalStorage
from src.utils.exceptions.error_responses import ErrorBody, ErrorResponse


def test_deterministic_llm_routes_and_response_models() -> None:
    assert LlmClient._fallback("compare A versus B", "classifier") == "compare"
    assert LlmClient._fallback("I want a request", "classifier") == "requirements"
    assert LlmClient._fallback("hello", "classifier") == "advice"
    assert "out-the-door" in LlmClient._fallback("compare", "compare")
    assert "narrow" in LlmClient._fallback("hello", "advisor")

    assert DataResponse[str](data="ok").data == "ok"
    assert MessageResponse(message="ready").message == "ready"
    error = ErrorResponse(error=ErrorBody(code="TEST", message="Example", request_id="req-1"))
    assert error.error.details is None


def test_advisor_web_fallback_preserves_trusted_sources() -> None:
    prompt = (
        '<web_sources trust="untrusted">'
        '[{"title":"Tesla official site","url":"https://www.tesla.com/"}]'
        '</web_sources>'
    )

    answer = LlmClient._fallback(prompt, "advisor")

    assert "temporarily unavailable" in answer
    assert "[Tesla official site](https://www.tesla.com/)" in answer
    assert "won’t guess" in answer


def test_local_storage_factory_and_upload_shape() -> None:
    storage = get_storage()
    assert isinstance(storage, LocalStorage)
    upload = storage.create_upload("deals/example.pdf", "application/pdf")
    assert upload["driver"] == "local"
    assert upload["headers"] == {"content-type": "application/pdf"}
