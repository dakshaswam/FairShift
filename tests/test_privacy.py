"""Fictional identifiers only; regex tests stub NER and never call Gemini."""

import logging
import json
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

import pytest

from fairshift_paystub import privacy
from fairshift_paystub.errors import RedactionError


@pytest.fixture
def regex_only(monkeypatch):
    """Exercise payroll rules deterministically without a downloaded NER model."""
    monkeypatch.setattr(privacy, "_presidio_spans", lambda _: [])


def test_masks_all_identifier_types_and_preserves_payroll_values(regex_only):
    fictional = """Employer: Example Fiction Bakery LLC
Employee Name: Ada Imaginary SSN: XXX-XX-6789
Employee ID: EMP-7788
Employee Address: 123 Fictional Street
Apt 4
Austin, TX 78701
Email: ada@example.test
Phone: (202) 555-0198
Routing number: 021000021
Bank Account: 444455556666
Account ending in: 4321
Pay Period: 2026-10-01 to 2026-10-15
Pay Date: 2026-10-20
Regular Hours: 80.00
Regular rate: 15.00
Gross pay: 1200.00
Social Security Tax: 74.40
Net pay: 1100.00
"""
    result = privacy.redact_text(fictional)
    for identifier in (
        "Ada Imaginary", "6789", "EMP-7788", "123 Fictional", "Apt 4",
        "78701", "ada@example.test", "555-0198", "021000021", "444455556666", "4321",
    ):
        assert identifier not in result
    for kind in ("NAME", "SSN", "EMPLOYEE_ID", "ADDRESS", "EMAIL", "PHONE", "ROUTING", "ACCOUNT"):
        assert f"[{kind}_" in result
    for financial in ("2026-10-01", "2026-10-15", "2026-10-20", "80.00", "15.00", "1200.00", "74.40", "1100.00"):
        assert financial in result
    assert "Example Fiction Bakery LLC" in result
    assert "Social Security Tax: 74.40" in result
    privacy.assert_no_pii(result)


@pytest.mark.parametrize("original", [
    "SSN: 987-65-4321",
    "SSN: 987654321",
    "SSN last four: 5678",
    "SSN (last 4): 5678",
    "SSN ending: 5678",
    "SSN last4: 5678",
    "SSN 5678",
    "SSN\n5678",
    "***-**-5678",
    "Employee ID\nFAKE-9999",
    "Employee #1234",
    "Employee#FAKE1234",
    "Employee Ada Imaginary",
    "bank account 4321",
    "Routing\n021000021",
    "Account: XXXX1234",
    "GB82 WEST 1234 5698 7654 32",
    "DE89370400440532013000",
])
def test_partial_identifiers_and_ocr_label_layouts(original, regex_only):
    assert privacy.redact_text(original) != original
    with pytest.raises(RedactionError):
        privacy.assert_no_pii(original)


def test_repeated_values_are_all_removed_without_a_value_mapping(regex_only):
    result = privacy.redact_text("Employee: Ada Imaginary\nEmployee: Ada Imaginary\nEmail: ada@example.test\nada@example.test")
    assert "Ada Imaginary" not in result
    assert "ada@example.test" not in result
    assert "[NAME_1]" in result
    assert "[NAME_2]" in result
    assert "[EMAIL_1]" in result
    assert "[EMAIL_2]" in result


def test_existing_placeholders_and_payroll_warning_strings_are_idempotent(regex_only):
    approved = """Employee: [NAME_1]
Example Fiction Bakery LLC
SSN: [SSN_1]
Account: [ACCOUNT_1]
Gross pay: 1200.00
The employee name is redacted.
The account number is unavailable.
Employee ID is not needed.
"""
    assert privacy.redact_text(approved) == approved
    privacy.assert_no_pii(approved)
    result = privacy.redact_text(approved + "\nEmployee: Ada Imaginary")
    assert "[NAME_2]" in result
    assert "[NAME_1]" in result


def test_does_not_mask_large_payroll_amounts_as_long_identifiers(regex_only):
    document = "Gross pay: 123456789\nYTD: 123456789012\nNet pay: $ 123456789"
    assert privacy.redact_text(document) == document


def test_social_security_deduction_is_money_but_ssn_is_sensitive(regex_only):
    for deduction in ("Social Security: 100.00", "Social Security\n100.00", "Social Security Tax: 100.00"):
        assert privacy.redact_text(deduction) == deduction
        privacy.assert_no_pii(deduction)
    for identifier in ("Social Security: 1234", "Social Security number: 1234", "SSN: 100.00"):
        assert privacy.redact_text(identifier) != identifier


def test_presidio_detections_are_used_and_overlap_collapses(monkeypatch):
    source = "Employee: Ada Imaginary\nBusiness city: Fantasyville"
    name_start = source.index("Ada")
    city_start = source.index("Fantasyville")
    monkeypatch.setattr(privacy, "_presidio_spans", lambda _: [
        privacy._Span(name_start, name_start + len("Ada"), "NAME"),
        privacy._Span(city_start, len(source), "ADDRESS"),
    ])
    result = privacy.redact_text(source)
    assert result == "Employee: [NAME_1]\nBusiness city: [ADDRESS_1]"


@pytest.mark.parametrize("text", ["", " \n\t", None])
def test_empty_or_nontext_documents_fail_closed(text):
    with pytest.raises(RedactionError, match="No readable local text"):
        privacy.redact_text(text)


def test_missing_local_nlp_model_fails_without_download():
    # This uses the real installed packages, but deliberately simulates a missing
    # local model. It does not perform real NER or network access.
    spacy = pytest.importorskip("spacy")
    with patch.object(spacy.util, "is_package", return_value=False), patch.object(spacy.cli, "download") as download:
        with pytest.raises(RedactionError, match="Local PII detection is unavailable") as caught:
            privacy.redact_text("Employee: Ada Imaginary")
        download.assert_not_called()
    assert "Ada" not in str(caught.value)


def test_dependency_log_messages_do_not_include_document_content(monkeypatch, caplog):
    def noisy_dependency(text):
        logging.getLogger("presidio-analyzer").warning("Sensitive test input: %s", text)
        return []

    monkeypatch.setattr(privacy, "_presidio_spans", noisy_dependency)
    with caplog.at_level(logging.DEBUG):
        privacy.redact_text("Employee: Ada Imaginary")
        privacy.assert_no_pii("Gross pay: 1200.00")
    assert "Ada Imaginary" not in caplog.text
    assert "Gross pay: 1200.00" not in caplog.text


@pytest.mark.skipif(find_spec("en_core_web_lg") is None, reason="Optional real local NER model is not installed")
def test_real_local_ner_on_fictional_pdf_and_output_strings():
    """Real local PDF extraction and Presidio; zero model/API requests."""
    from fairshift_paystub.documents import extract_text

    root = Path(__file__).resolve().parents[1]
    original = extract_text(root / "samples" / "sample_paystub.pdf")
    result = privacy.redact_text(original)
    for identifier in ("Avery Example", "000-12-3456", "4321", "FS-DEMO-0042", "123 Fictional Lane", "00000", "avery.example@example.invalid", "202-555-0148", "000123456789", "000000000"):
        assert identifier not in result
    for payroll in ("USD", "80.00", "18.00", "1440.00", "135.00", "1615.00", "100.00", "1341.58", "2026-09-01", "2026-09-14", "2026-09-18"):
        assert payroll in result
    assert privacy.redact_text(result) == result
    privacy.assert_no_pii(result)

    expected = json.loads((root / "samples" / "expected_paystub.json").read_text(encoding="utf-8"))

    def strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for child in value.values():
                yield from strings(child)
        elif isinstance(value, list):
            for child in value:
                yield from strings(child)

    privacy.assert_no_pii("\n\n".join(strings(expected)))
