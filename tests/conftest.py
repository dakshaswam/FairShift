"""Fictional fixtures only; unit tests never contact Muse."""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def expected():
    return json.loads((ROOT / "samples/expected_paystub.json").read_text(encoding="utf-8"))


@pytest.fixture
def envelope(expected):
    return {
        "is_paystub": True,
        "paystub": expected,
        "reconciliation": {
            "all_current_deductions_listed": True,
            "gross_minus_deductions_only": True,
            "current_deductions_total": "273.42",
        },
    }


@pytest.fixture
def fake_ner(monkeypatch):
    """Unit-test regex layers only; real local NER has separate integration tests."""
    from fairshift_paystub import privacy
    monkeypatch.setattr(privacy, "_presidio_spans", lambda text: [])
