"""Local HTTP/upload integration. All Gemini responses in these tests are MOCKED."""

import http.client
import json
import threading
from pathlib import Path
from unittest.mock import Mock

import pytest

from fairshift_paystub import pipeline
from fairshift_paystub.errors import DocumentError, RedactionError
from fairshift_paystub.web import COOKIE, PaystubApplication, create_server

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def local_service(fake_ner, monkeypatch, envelope):
    request = Mock(return_value=json.dumps(envelope))
    monkeypatch.setattr(pipeline, "request_extraction", request)
    app = PaystubApplication(source="mocked")
    server = create_server(("127.0.0.1", 0), application=app)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, app, request
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def send(server, path, body, *, suffix=None, cookie=None, origin="http://localhost:8443"):
    connection = http.client.HTTPConnection(*server.server_address, timeout=10)
    headers = {"X-FairShift-Client": "paystub-ui", "Origin": origin}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if suffix:
        headers["X-Document-Type"] = suffix
    if cookie:
        headers["Cookie"] = cookie
    connection.request("POST", path, body, headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    cookie = response.getheader("Set-Cookie")
    connection.close()
    return response.status, payload, cookie.split(";", 1)[0] if cookie else None


def prepare(server, sample="sample_paystub.pdf", cookie=None):
    return send(server, "/api/paystubs/prepare", (ROOT / "samples" / sample).read_bytes(), suffix=".pdf", cookie=cookie)


def approved(preview):
    return {"upload_id": preview["upload_id"], "approval_token": preview["approval_token"],
            "approved_text": preview["redacted_text"], "approved": True}


def test_current_upload_reaches_validated_response_without_persistence(local_service, tmp_path, monkeypatch, expected):
    server, app, request = local_service
    monkeypatch.chdir(tmp_path)
    status, preview, cookie = prepare(server)
    assert status == 200
    assert "[NAME_1]" in preview["redacted_text"] and "[ACCOUNT_1]" in preview["redacted_text"]
    assert "Avery Example" not in preview["redacted_text"]
    request.assert_not_called()
    status, result, _ = send(server, "/api/paystubs/extract", approved(preview), cookie=cookie)
    assert status == 200
    assert result["upload_id"] == preview["upload_id"]
    assert result["paystub"] == expected
    assert result["source"] == "mocked"
    assert "135.00" in result["assistant_message"]
    assert "Sunbright" not in result["assistant_message"] and "86.40" not in result["assistant_message"]
    assert request.call_args.args[0] == preview["redacted_text"]
    assert not list(tmp_path.iterdir())
    # Application keeps metadata keys/functions, no preview text or document state.
    assert not any(isinstance(v, str) and preview["redacted_text"] in v for v in vars(app).values())


def test_second_distinct_upload_cannot_receive_first_upload_values(local_service, monkeypatch):
    server, _, request = local_service
    first_status, first, cookie = prepare(server)
    assert first_status == 200
    assert send(server, "/api/paystubs/extract", approved(first), cookie=cookie)[0] == 200
    second_expected = json.loads((ROOT / "samples/current_upload_expected.json").read_text())
    request.return_value = json.dumps({"is_paystub": True, "paystub": second_expected,
                                     "reconciliation": {"all_current_deductions_listed": True,
                                                        "gross_minus_deductions_only": True,
                                                        "current_deductions_total": "102.79"}})
    status, preview, _ = prepare(server, "current_upload.pdf", cookie)
    assert status == 200 and preview["upload_id"] != first["upload_id"]
    status, result, _ = send(server, "/api/paystubs/extract", approved(preview), cookie=cookie)
    assert status == 200
    assert result["paystub"]["regular_hours"] == "40.00"
    assert result["paystub"]["overtime_pay"] == "90.00"
    assert result["paystub"]["net_pay"] == "587.21"
    assert "90.00" in result["assistant_message"]
    assert "86.40" not in result["assistant_message"]
    assert "claims unpaid wages" not in result["assistant_message"]
    assert "Hours 40.00" in request.call_args.args[0] and "Hours 80.00" not in request.call_args.args[0]


def test_no_approval_no_model_call(local_service):
    server, _, request = local_service
    _, preview, cookie = prepare(server)
    data = approved(preview)
    data["approved"] = False
    assert send(server, "/api/paystubs/extract", data, cookie=cookie)[0] == 400
    request.assert_not_called()


@pytest.mark.parametrize("change", ["other_browser", "wrong_id", "tampered_ticket", "expired"])
def test_approval_bound_to_upload_and_browser(local_service, change):
    server, app, request = local_service
    _, preview, cookie = prepare(server)
    data = approved(preview)
    if change == "other_browser":
        cookie = COOKIE + "=" + "x" * 32
    elif change == "wrong_id":
        data["upload_id"] = "x" * 32
    elif change == "tampered_ticket":
        data["approval_token"] += "0"
    else:
        now = app.clock()
        app.clock = lambda: now + 901
    status, error, _ = send(server, "/api/paystubs/extract", data, cookie=cookie)
    assert status == 400 and error["stage"] == "approval"
    request.assert_not_called()


def test_edited_pii_prevents_call(local_service):
    server, _, request = local_service
    _, preview, cookie = prepare(server)
    data = approved(preview)
    data["approved_text"] += "\nEmail: fictional.worker@example.invalid"
    status, error, _ = send(server, "/api/paystubs/extract", data, cookie=cookie)
    assert status == 422 and error["stage"] == "redaction"
    request.assert_not_called()


@pytest.mark.parametrize("error", [DocumentError("Local OCR failed; nothing was sent."), RedactionError("Local redaction failed; nothing was sent.")])
def test_prepare_failure_never_calls_model_or_returns_stale_stub(local_service, error):
    server, app, request = local_service
    app.prepare = Mock(side_effect=error)
    status, payload, _ = prepare(server)
    assert status == 422 and "paystub" not in payload and "redacted_text" not in payload
    request.assert_not_called()


def test_cross_origin_blocked(local_service):
    server, _, request = local_service
    status, _, _ = send(server, "/api/paystubs/prepare", b"fictional", suffix=".pdf", origin="https://untrusted.invalid")
    assert status == 403
    request.assert_not_called()


def _app_with(complete):
    from fairshift_paystub.web import PaystubApplication

    return PaystubApplication(prepare=lambda document, suffix: "Gross Pay: 10.00",
                              complete=complete, source="mocked")


def test_approval_ticket_is_single_use_after_success(envelope):
    from fairshift_paystub.errors import ApprovalError
    from fairshift_paystub.schema import Paystub

    stub = Paystub.model_validate(envelope["paystub"])
    complete = Mock(return_value=stub)
    app = _app_with(complete)
    preview = app.prepare_document(b"%PDF", ".pdf", "s" * 32)
    request = {"upload_id": preview["upload_id"], "approval_token": preview["approval_token"],
               "approved_text": "Gross Pay: 10.00", "approved": True}
    app.extract_document(request, "s" * 32)
    with pytest.raises(ApprovalError):
        app.extract_document(request, "s" * 32)
    assert complete.call_count == 1


def test_approval_ticket_can_retry_after_a_failed_extraction(envelope):
    from fairshift_paystub.errors import GeminiError
    from fairshift_paystub.schema import Paystub

    stub = Paystub.model_validate(envelope["paystub"])
    complete = Mock(side_effect=[GeminiError("busy"), stub])
    app = _app_with(complete)
    preview = app.prepare_document(b"%PDF", ".pdf", "s" * 32)
    request = {"upload_id": preview["upload_id"], "approval_token": preview["approval_token"],
               "approved_text": "Gross Pay: 10.00 (edited)", "approved": True}
    with pytest.raises(GeminiError):
        app.extract_document(request, "s" * 32)
    assert app.extract_document(request, "s" * 32)["upload_id"] == preview["upload_id"]
