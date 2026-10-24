"""Actual local PDF/regex pipeline with mocked NER and mocked Gemini."""

import json
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock

import pytest

from fairshift_paystub import complete_paystub, extract_paystub, prepare_paystub
from fairshift_paystub import pipeline
from fairshift_paystub.errors import ApprovalError, DocumentError, RedactionError, ResponseError

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "samples/sample_paystub.pdf"
FAKE_IDENTIFIERS = (
    "Avery Example", "000-12-3456", "4321", "FS-DEMO-0042", "123 Fictional Lane",
    "Fabletown", "avery.example@example.invalid", "202-555-0148", "000123456789", "000000000",
)


def test_outbound_exact_approved_text_has_placeholders_no_known_fake_identifiers(fake_ner, envelope, expected, monkeypatch, tmp_path):
    # Local PDF parsing and supplemental regex are real. Presidio NER and Gemini
    # are mocked here; tests/test_privacy.py covers actual local NER separately.
    request = Mock(return_value=json.dumps(envelope))
    monkeypatch.setattr(pipeline, "request_extraction", request)
    previews = []

    def review(preview):
        previews.append(preview)
        return preview + "\nUser reviewed the redaction."

    original = SAMPLE.read_bytes()
    monkeypatch.chdir(tmp_path)
    result = extract_paystub(SAMPLE, review=review)
    sent = request.call_args.args[0]
    assert sent == previews[0] + "\nUser reviewed the redaction."
    assert "[NAME_1]" in sent and "[ACCOUNT_1]" in sent
    for fake_identifier in FAKE_IDENTIFIERS:
        assert fake_identifier not in sent
    assert result.model_dump(mode="json") == expected
    assert isinstance(result.gross_pay, Decimal)
    assert list(tmp_path.iterdir()) == []  # No implicit outputs/raw/temp files.
    assert SAMPLE.read_bytes() == original


@pytest.mark.parametrize("stage,error_type", [("extract_text", DocumentError), ("redact_text", RedactionError)])
def test_local_failure_prevents_api(stage, error_type, monkeypatch):
    monkeypatch.setattr(pipeline, "extract_text", Mock(return_value="Gross Pay: 42"))
    monkeypatch.setattr(pipeline, "redact_text", Mock(return_value="Gross Pay: 42"))
    monkeypatch.setattr(pipeline, stage, Mock(side_effect=error_type("Local processing failed; nothing was sent.")))
    request = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)
    with pytest.raises(error_type):
        extract_paystub(SAMPLE, review=lambda text: text)
    request.assert_not_called()


def test_approval_required_and_cancellation_prevent_api(fake_ner, monkeypatch):
    request = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)
    with pytest.raises(ApprovalError):
        extract_paystub(SAMPLE)
    with pytest.raises(ApprovalError, match="cancelled"):
        extract_paystub(SAMPLE, review=lambda text: None)
    with pytest.raises(ApprovalError):
        complete_paystub("Gross Pay: 42")
    request.assert_not_called()


def test_pii_reintroduced_during_edit_prevents_api(fake_ner, monkeypatch):
    request = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)
    with pytest.raises(RedactionError):
        extract_paystub(SAMPLE, review=lambda text: text + "\nEmail: avery.example@example.invalid")
    request.assert_not_called()


def test_review_exception_sanitized_and_prevents_api(fake_ner, monkeypatch):
    request = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)

    def broken_review(text):
        raise RuntimeError("Avery Example /private/real-file.pdf")

    with pytest.raises(ApprovalError) as caught:
        extract_paystub(SAMPLE, review=broken_review)
    assert "Avery" not in str(caught.value) and "/private" not in str(caught.value)
    request.assert_not_called()


def test_model_output_personal_info_blocked(fake_ner, envelope, monkeypatch):
    envelope["paystub"]["warnings"] = ["Contact avery.example@example.invalid"]
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    with pytest.raises(ResponseError, match="privacy") as caught:
        complete_paystub("Gross Pay: 1615.00", approved=True)
    assert "avery" not in str(caught.value)


@pytest.mark.parametrize("response", ['not JSON', '{"is_paystub":true,"is_paystub":false}', '{"secret":"Avery Example"}', '[]'])
def test_invalid_json_or_schema_sanitized(fake_ner, monkeypatch, response):
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=response))
    with pytest.raises(ResponseError, match="invalid JSON") as caught:
        complete_paystub("Gross Pay: 42.00", approved=True)
    assert "Avery" not in str(caught.value)


@pytest.mark.parametrize("field,value", [("pay_date", "2026-02-30"), ("regular_hours", True), ("net_pay", "NaN"), ("currency", "dollars")])
def test_invalid_scalar_values_rejected(fake_ner, envelope, monkeypatch, field, value):
    envelope["paystub"][field] = value
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    with pytest.raises(ResponseError, match="schema"):
        complete_paystub("Gross Pay: 42.00", approved=True)


def test_unrelated_document_rejected(fake_ner, envelope, monkeypatch):
    envelope["is_paystub"] = False
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    with pytest.raises(ResponseError, match="not a recognizable paystub"):
        complete_paystub("Shopping list: bread and milk", approved=True)


def test_missing_values_stay_null_not_zero(fake_ner, envelope, monkeypatch):
    for key in ("overtime_hours", "overtime_hourly_rate", "overtime_pay", "tips", "net_pay"):
        envelope["paystub"][key] = None
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    stub = complete_paystub("Gross Pay: 1615.00", approved=True)
    assert stub.tips is None and stub.overtime_pay is None and stub.net_pay is None
    assert "skipped" in " ".join(stub.warnings)


def test_multiple_rates_preserved_as_lines(fake_ner, envelope, monkeypatch):
    data = envelope["paystub"]
    data["regular_hours"] = data["regular_hourly_rate"] = data["regular_pay"] = None
    data["other_earnings"] = [
        {"label": "Regular - station A", "amount": "180.00", "hours": "10", "hourly_rate": "18"},
        {"label": "Regular - station B", "amount": "200.00", "hours": "10", "hourly_rate": "20"},
    ]
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    stub = complete_paystub("Regular earnings at multiple rates", approved=True)
    assert stub.regular_hourly_rate is None
    assert [line.hourly_rate for line in stub.other_earnings] == [Decimal("18"), Decimal("20")]


def test_prepare_is_local_only(fake_ner, monkeypatch):
    request = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)
    assert "[NAME_1]" in prepare_paystub(SAMPLE)
    request.assert_not_called()


def test_requests_do_not_reuse_text_or_history(fake_ner, envelope, monkeypatch):
    request = Mock(return_value=json.dumps(envelope))
    monkeypatch.setattr(pipeline, "request_extraction", request)
    complete_paystub("Gross Pay: 1615.00\nDocument A", approved=True)
    complete_paystub("Gross Pay: 1615.00\nDocument B", approved=True)
    assert "Document A" not in request.call_args_list[1].args[0]


@pytest.mark.parametrize("control", ["\x1b", "\x9b", "\u202e", "\u2066"])
def test_unsafe_control_codes_prevent_preview_and_request(monkeypatch, control):
    request = Mock()
    redact = Mock()
    monkeypatch.setattr(pipeline, "request_extraction", request)
    monkeypatch.setattr(pipeline, "redact_text", redact)
    monkeypatch.setattr(pipeline, "extract_text", Mock(return_value="Gross Pay: 42" + control + "[31m"))
    with pytest.raises(RedactionError, match="control"):
        extract_paystub(SAMPLE, review=lambda text: text)
    request.assert_not_called()
    redact.assert_not_called()


@pytest.mark.parametrize("control", ["\x1b", "\x9b", "\u202e"])
def test_output_display_controls_blocked(fake_ner, envelope, monkeypatch, control):
    envelope["paystub"]["warnings"] = ["Review " + control + "concealed text"]
    monkeypatch.setattr(pipeline, "request_extraction", Mock(return_value=json.dumps(envelope)))
    with pytest.raises(ResponseError, match="privacy"):
        complete_paystub("Gross Pay: 1615.00", approved=True)


def test_real_local_ner_pipeline_with_mocked_gemini(envelope, expected, monkeypatch):
    """Actual PDF/Presidio/spaCy; the Gemini response is still entirely mocked."""
    import importlib.util
    if importlib.util.find_spec("en_core_web_lg") is None:
        pytest.skip("Install en_core_web_lg for real local NER integration; no API call is used.")
    request = Mock(return_value=json.dumps(envelope))
    monkeypatch.setattr(pipeline, "request_extraction", request)
    stub = extract_paystub(SAMPLE, review=lambda text: text)
    sent = request.call_args.args[0]
    assert "Currency: USD" in sent
    assert "Social Security: 100.00" in sent
    for fake_identifier in FAKE_IDENTIFIERS:
        assert fake_identifier not in sent
    assert stub.model_dump(mode="json") == expected
