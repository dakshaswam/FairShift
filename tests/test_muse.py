"""Muse client with a mocked HTTP transport; no network request is made."""

import json

import httpx
import pytest

from fairshift_paystub import muse
from fairshift_paystub.errors import ModelError
from fairshift_paystub.quiet import sensitive_operation

KEY = "LLM_123_fake-test-key"


def reply(content='{"is_paystub": false}', finish="stop", status=200):
    body = {"choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}]}
    return httpx.Response(status, json=body if status < 400 else {"error": {"message": "nope " + KEY}})


def client_for(*responses, seen=None):
    queue = list(responses)

    def handler(request):
        if seen is not None:
            seen.append(request)
        result = queue.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(muse.time, "sleep", lambda seconds: None)


def test_sends_text_only_structured_request_to_meta():
    seen = []
    result = muse.request_extraction("Gross Pay: 10.00", api_key=KEY, model="muse-test",
                                     client=client_for(reply('{"ok": true}'), seen=seen))
    assert result == '{"ok": true}'
    request = seen[0]
    assert str(request.url) == "https://api.meta.ai/v1/chat/completions"
    assert request.headers["Authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "muse-test"
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1] == {"role": "user", "content": "Gross Pay: 10.00"}
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert "tools" not in body


def test_default_model_and_env_key(monkeypatch):
    seen = []
    monkeypatch.setenv("MUSE_API_KEY", KEY)
    monkeypatch.delenv("MUSE_MODEL", raising=False)
    muse.request_extraction("x", client=client_for(reply(), seen=seen))
    assert json.loads(seen[0].content)["model"] == muse.DEFAULT_MODEL


def test_missing_key_is_a_safe_error(monkeypatch):
    monkeypatch.delenv("MUSE_API_KEY", raising=False)
    with pytest.raises(ModelError, match="MUSE_API_KEY"):
        muse.request_extraction("x")


def test_diagnostics_never_log_the_text_or_key(caplog):
    with caplog.at_level("INFO"), sensitive_operation():
        muse.request_extraction("안녕 Gross Pay 99.00", api_key=KEY, client=client_for(reply()))
    assert '"status_code": 200' in caplog.text
    assert '"request_body_bytes": ' in caplog.text
    assert "안녕" not in caplog.text and "99.00" not in caplog.text
    assert KEY not in caplog.text


def test_retries_busy_and_timeout_then_succeeds():
    seen = []
    client = client_for(httpx.Response(504), httpx.ConnectTimeout("slow"), reply('{"ok": 1}'), seen=seen)
    assert muse.request_extraction("x", api_key=KEY, client=client) == '{"ok": 1}'
    assert len(seen) == 3


@pytest.mark.parametrize(("status", "hint"), [(401, "API key"), (403, "API key"), (404, "MUSE_MODEL"),
                                             (429, "rate limit"), (400, "rejected"), (503, "busy")])
def test_errors_are_safe_and_specific(status, hint, caplog):
    responses = [reply(status=status)] * muse.ATTEMPTS
    with caplog.at_level("ERROR"), pytest.raises(ModelError) as raised:
        muse.request_extraction("x", api_key=KEY, client=client_for(*responses))
    assert hint in str(raised.value)
    assert KEY not in str(raised.value) and "nope" not in str(raised.value)
    assert KEY not in caplog.text


def test_client_errors_are_not_retried():
    seen = []
    with pytest.raises(ModelError):
        muse.request_extraction("x", api_key=KEY, client=client_for(reply(status=401), seen=seen))
    assert len(seen) == 1


def test_truncated_or_empty_answers_fail_safely():
    with pytest.raises(ModelError, match="ran out of room"):
        muse.request_extraction("x", api_key=KEY, client=client_for(reply('{"partial', finish="length")))
    with pytest.raises(ModelError, match="no JSON"):
        muse.request_extraction("x", api_key=KEY, client=client_for(reply(None)))
