"""Exercise the real SDK request types with a fake client; never call Gemini."""

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from google import genai
from google.genai import errors, types
from pydantic import TypeAdapter, ValidationError

from fairshift_paystub.errors import GeminiError
from fairshift_paystub.gemini import SYSTEM_INSTRUCTION, request_extraction
from fairshift_paystub.quiet import sensitive_operation
from fairshift_paystub.schema import Extraction, Nonnegative, extraction_json_schema


APPROVED_TEXT = (
    "FICTIONAL PAYSTUB\nEmployee: [NAME_1]\nSSN: [SSN_1]\n"
    "Bank account: [ACCOUNT_1]\nRegular hours: 80\nGross pay: 1615.00\n"
)
SECRET_DETAIL = "Avery Example 000-12-3456 C:/private/employee/paystub.pdf secret-api-key"


def test_local_validation_schema_uses_standard_minimum_for_nonnegative_decimals():
    schema = Extraction.model_json_schema()

    def check_keywords(value):
        if isinstance(value, dict):
            assert "ge" not in value
            for item in value.values():
                check_keywords(item)
        elif isinstance(value, list):
            for item in value:
                check_keywords(item)

    check_keywords(schema)
    for model, fields in (
        ("Paystub", ("regular_hours", "regular_hourly_rate", "overtime_hours", "overtime_hourly_rate")),
        ("Earning", ("hours", "hourly_rate")),
    ):
        for field in fields:
            alternatives = schema["$defs"][model]["properties"][field]["anyOf"]
            assert {"minimum": 0.0, "type": "number"} in alternatives
            assert {"type": "null"} in alternatives


def test_provider_schema_requests_nullable_decimal_strings_without_complex_bounds():
    schema = extraction_json_schema()

    def check_compact(value):
        if isinstance(value, dict):
            assert not {"maxItems", "maxLength", "title", "ge"}.intersection(value)
            for item in value.values():
                check_compact(item)
        elif isinstance(value, list):
            for item in value:
                check_compact(item)

    check_compact(schema)
    for model, fields in (
        ("Paystub", ("regular_hours", "regular_hourly_rate", "regular_pay", "overtime_hours",
                     "overtime_hourly_rate", "overtime_pay", "tips", "gross_pay", "net_pay")),
        ("Earning", ("hours", "hourly_rate", "amount")),
        ("Deduction", ("amount",)),
        ("Reconciliation", ("current_deductions_total",)),
    ):
        for field in fields:
            assert schema["$defs"][model]["properties"][field]["anyOf"] == [
                {"type": "string"}, {"type": "null"},
            ]
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["is_paystub", "paystub", "reconciliation"]
    local_schema = Extraction.model_json_schema()
    for model in schema["$defs"]:
        assert schema["$defs"][model]["required"] == local_schema["$defs"][model]["required"]
        assert schema["$defs"][model]["additionalProperties"] is False
    dates = schema["$defs"]["Paystub"]["properties"]["pay_date"]["anyOf"]
    assert dates[0]["pattern"] == r"^\d{4}-\d{2}-\d{2}$"
    assert local_schema["$defs"]["Paystub"]["properties"]["deductions"]["maxItems"] == 150


@pytest.mark.parametrize("value", ["-0.01", 0.1, True, "NaN", "1000000000001", "0.000000001"])
def test_compact_provider_schema_does_not_weaken_local_decimal_validation(value):
    with pytest.raises(ValidationError):
        TypeAdapter(Nonnegative).validate_python(value, strict=True)
    assert TypeAdapter(Nonnegative).validate_python("0.10", strict=True) == Decimal("0.10")


@pytest.fixture
def captured_client(monkeypatch):
    """Keep SDK config validation real while replacing all network capability."""
    captured = {"calls": [], "entered": 0, "exited": 0, "response": '{"mock":true}'}

    def generate_content(**kwargs):
        captured["calls"].append(kwargs)
        hooks = captured["client_options"]["http_options"].client_args["event_hooks"]
        request_body = json.dumps(
            {
                "contents": [{"parts": [{"text": kwargs["contents"]}]}],
                "generationConfig": kwargs["config"].model_dump(exclude_none=True),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        for callback in hooks["request"]:
            callback(SimpleNamespace(content=request_body))
        if captured.get("error") is not None:
            error = captured["error"]
            if getattr(error, "code", None) is not None:
                error_body = getattr(error, "details", None)
                if not isinstance(error_body, dict):
                    error_body = {"error": {"message": "Synthetic error"}}
                response = SimpleNamespace(
                    status_code=error.code,
                    content=json.dumps(
                        {**error_body, "candidates": [{"finishReason": "STOP"}]},
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    read=lambda: None,
                )
                for callback in hooks["response"]:
                    callback(response)
            raise captured["error"]
        response = SimpleNamespace(
            status_code=200,
            content=b'{"candidates":[{"finishReason":"STOP"}]}',
            read=lambda: None,
        )
        for callback in hooks["response"]:
            callback(response)
        return SimpleNamespace(text=captured["response"])

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client_options"] = kwargs
            self.models = SimpleNamespace(generate_content=generate_content)

        def __enter__(self):
            captured["entered"] += 1
            return self

        def __exit__(self, *args):
            captured["exited"] += 1

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    return captured


def test_sdk_request_contains_exact_approved_text_and_privacy_controls(captured_client):
    result = request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")

    assert result == '{"mock":true}'
    assert captured_client["entered"] == captured_client["exited"] == 1
    assert len(captured_client["calls"]) == 1
    request = captured_client["calls"][0]
    assert set(request) == {"model", "contents", "config"}
    assert request["contents"] == APPROVED_TEXT
    assert isinstance(request["contents"], str)
    assert "[NAME_1]" in request["contents"] and "[ACCOUNT_1]" in request["contents"]
    for identifier in ("Avery Example", "000-12-3456", "000123456789", "paystub.pdf"):
        assert identifier not in request["contents"]

    config = request["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.store is False
    assert config.tools == []
    assert config.automatic_function_calling.disable is True
    assert config.cached_content is None
    assert config.tool_config is None
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == extraction_json_schema()
    assert config.system_instruction == SYSTEM_INSTRUCTION
    assert "UNTRUSTED" in config.system_instruction
    assert APPROVED_TEXT not in config.system_instruction
    serialized_config = config.model_dump(exclude_none=True)
    assert set(serialized_config) == {
        "system_instruction", "response_mime_type", "response_json_schema", "tools",
        "automatic_function_calling", "store", "max_output_tokens",
    }

    options = captured_client["client_options"]
    assert set(options) == {"api_key", "vertexai", "http_options"}
    assert options["api_key"] == "fake-test-key"
    assert options["vertexai"] is False
    http = options["http_options"]
    assert isinstance(http, types.HttpOptions)
    assert http.base_url == "https://generativelanguage.googleapis.com"
    assert http.api_version == "v1beta"
    assert http.retry_options.attempts == 1
    assert http.timeout == 60000
    assert config.temperature is None
    assert config.top_p is None
    assert config.top_k is None


def test_gemini_diagnostics_record_utf8_json_and_never_the_api_key(captured_client, caplog):
    with caplog.at_level("INFO"), sensitive_operation():
        request_extraction("안녕", api_key="fake-test-key", model="fake-test-model")

    assert '"status_code": 200' in caplog.text
    assert '"finish_reason": "STOP"' in caplog.text
    assert '"request_body_utf8_json": true' in caplog.text
    assert '"request_body_bytes": ' in caplog.text
    # The request body is the worker's approved paystub text; it is never logged.
    assert "안녕" not in caplog.text
    assert "fake-test-key" not in caplog.text


class FakeAPIError(Exception):
    def __init__(self, code):
        super().__init__(SECRET_DETAIL)
        self.code = code


@pytest.mark.parametrize(
    ("code", "safe_hint"),
    [(401, "authentication/access"), (403, "authentication/access"),
     (429, "rate or quota"), (404, "model is unavailable"), (400, "rejected the request")],
)
def test_api_failures_show_safe_specific_errors(captured_client, caplog, code, safe_hint):
    captured_client["error"] = FakeAPIError(code)
    captured_client["api_key"] = "fake-test-key"
    with pytest.raises(GeminiError) as raised:
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")

    assert safe_hint in str(raised.value)
    assert SECRET_DETAIL not in str(raised.value)
    assert raised.value.__suppress_context__ is True
    assert captured_client["exited"] == 1
    assert len(captured_client["calls"]) == 1
    assert SECRET_DETAIL not in caplog.text
    assert '"status_code": ' + str(code) in caplog.text
    assert '"request_body_utf8_json": true' in caplog.text
    assert "fake-test-key" not in caplog.text


@pytest.mark.parametrize(
    ("code", "reason", "provider_message", "safe_hint"),
    [
        (400, "API_KEY_INVALID", "Invalid credential.", "API key as invalid"),
        (400, "API_KEY_INVALID", "API key expired. Please renew the API key.", "expired API key"),
        (400, None, "API key not valid. Please pass a valid API key.", "API key as invalid"),
        (403, None, "Your API key was reported as leaked. Please use another API key.", "leaked or blocked"),
        (403, None, "Your API key has been blocked.", "leaked or blocked"),
        (403, "SERVICE_DISABLED", "Service disabled.", "API is disabled"),
        (403, "BILLING_DISABLED", "Billing disabled.", "billing needs attention"),
        (402, None, "Credit payment required.", "billing needs attention"),
        (403, "API_KEY_SERVICE_BLOCKED", "Requests blocked.", "restrictions block"),
        (403, "API_KEY_IP_ADDRESS_BLOCKED", "Origin blocked.", "restrictions block"),
        (400, None, 'Invalid JSON payload. Unknown name "store".', "required store=False control"),
        (400, None, "response_json_schema produces too many states.", "extraction schema"),
        (400, "UNRECOGNIZED_REASON", "Some provider failure.", "rejected the request"),
    ],
)
def test_actual_sdk_error_body_is_logged_but_api_key_is_redacted(
    captured_client, caplog, code, reason, provider_message, safe_hint,
):
    error_info = {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "domain": "googleapis.com",
        "reason": reason,
        "metadata": {"private": SECRET_DETAIL},
    }
    # SDK stores this object as .details, not .response_json.
    captured_client["error"] = errors.ClientError(code, {"error": {
        "code": code, "status": "INVALID_ARGUMENT",
        "message": provider_message + " " + SECRET_DETAIL + " fake-test-key",
        "details": [error_info],
    }})
    captured_client["api_key"] = "fake-test-key"
    with pytest.raises(GeminiError) as raised:
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")
    assert safe_hint in str(raised.value)
    assert provider_message not in str(raised.value)
    assert SECRET_DETAIL not in str(raised.value)
    record = json.loads(caplog.records[-1].message.removeprefix("Gemini request diagnostics: "))
    response_body = json.loads(record["error_response_body"])
    assert provider_message in response_body["error"]["message"]
    assert "[REDACTED]" in response_body["error"]["message"]
    assert "fake-test-key" not in json.dumps(record)
    assert '"error_response_body":' in caplog.text
    assert record["finish_reason"] == "STOP"
    assert raised.value.__suppress_context__ is True
    assert len(captured_client["calls"]) == 1


@pytest.mark.parametrize("raw_details", [None, [], "unexpected body", {"error": []}, {"details": "unexpected"}])
def test_malformed_provider_details_fall_back_without_leaking(captured_client, raw_details):
    provider_error = FakeAPIError(400)
    provider_error.details = raw_details
    captured_client["error"] = provider_error
    with pytest.raises(GeminiError, match="rejected the request") as raised:
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")
    assert SECRET_DETAIL not in str(raised.value)


def test_network_error_does_not_expose_details_or_retry(captured_client, caplog):
    captured_client["error"] = ConnectionError(SECRET_DETAIL)
    with pytest.raises(GeminiError, match="Check your connection") as raised:
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")
    assert SECRET_DETAIL not in str(raised.value)
    assert SECRET_DETAIL not in caplog.text
    assert len(captured_client["calls"]) == 1
    assert '"status_code": null' in caplog.text


@pytest.mark.parametrize("response", [None, "", " \n "])
def test_missing_response_text_has_safe_error(captured_client, response):
    captured_client["response"] = response
    with pytest.raises(GeminiError, match="no readable JSON"):
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")


@pytest.mark.parametrize("key", [None, "", "  "])
def test_missing_key_prevents_client_creation(captured_client, key):
    with pytest.raises(GeminiError, match="GEMINI_API_KEY"):
        request_extraction(APPROVED_TEXT, api_key=key, model="fake-test-model")
    assert "client_options" not in captured_client
    assert captured_client["calls"] == []


@pytest.mark.parametrize("model", [None, "", "  "])
def test_missing_model_prevents_client_creation(captured_client, model):
    with pytest.raises(GeminiError, match="GEMINI_MODEL"):
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model=model)
    assert "client_options" not in captured_client
    assert captured_client["calls"] == []


def test_environment_settings_are_used_without_changing_request_content(captured_client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-env-key")
    monkeypatch.setenv("GEMINI_MODEL", "fake-env-model")
    request_extraction(APPROVED_TEXT)
    assert captured_client["client_options"]["api_key"] == "fake-env-key"
    assert captured_client["calls"][0]["model"] == "fake-env-model"
    assert captured_client["calls"][0]["contents"] == APPROVED_TEXT


def test_old_sdk_without_logging_control_fails_closed(captured_client, monkeypatch):
    monkeypatch.setattr(types, "GenerateContentConfig", SimpleNamespace(model_fields={}))
    with pytest.raises(GeminiError, match="store=False privacy control"):
        request_extraction(APPROVED_TEXT, api_key="fake-test-key", model="fake-test-model")
    assert "client_options" not in captured_client
    assert captured_client["calls"] == []
