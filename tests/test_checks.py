"""Payroll arithmetic tests use fictional values, never legal wage conclusions."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from fairshift_paystub.checks import EXTRACTION_SCOPE_WARNING, REVIEW_WARNING, review_checks
from fairshift_paystub.schema import Paystub, Reconciliation


SAMPLES = Path(__file__).resolve().parents[1] / "samples"


@pytest.fixture
def stub():
    data = json.loads((SAMPLES / "expected_paystub.json").read_text(encoding="utf-8"))
    data["warnings"] = []
    return Paystub.model_validate(data)


@pytest.fixture
def evidence():
    return Reconciliation(
        all_current_deductions_listed=True,
        gross_minus_deductions_only=True,
        current_deductions_total=Decimal("273.42"),
    )


def test_fictional_complete_sample_matches_expected_and_does_not_mutate(stub, evidence):
    text = (SAMPLES / "sample_paystub.txt").read_text(encoding="utf-8")
    result = review_checks(stub, evidence, text)
    expected = json.loads((SAMPLES / "expected_paystub.json").read_text(encoding="utf-8"))
    assert result.model_dump(mode="json") == expected
    assert stub.warnings == []
    assert isinstance(result.gross_pay, Decimal)
    assert result.net_pay == Decimal("1341.58")


def test_decimal_arithmetic_avoids_binary_float_rounding(stub):
    data = stub.model_dump(mode="json")
    data.update(
        regular_hours="0.1", regular_hourly_rate="0.2", regular_pay="0.02",
        gross_pay="0.30", net_pay="0.00",
        deductions=[{"label": "Test deduction A", "amount": "0.10"},
                    {"label": "Test deduction B", "amount": "0.20"}],
    )
    decimal_stub = Paystub.model_validate(data)
    evidence = Reconciliation(
        all_current_deductions_listed=True,
        gross_minus_deductions_only=True,
        current_deductions_total="0.30",
    )
    result = review_checks(decimal_stub, evidence, "Total current deductions: 0.30")
    assert result.warnings == [REVIEW_WARNING]
    assert result.regular_hours * result.regular_hourly_rate == Decimal("0.02")
    assert sum((entry.amount for entry in result.deductions), Decimal("0")) == Decimal("0.30")


@pytest.mark.parametrize(
    "field",
    ["gross_pay", "net_pay", "regular_hours", "regular_hourly_rate", "regular_pay",
     "overtime_hours", "overtime_hourly_rate", "overtime_pay", "tips"],
)
def test_unknown_values_remain_null(stub, evidence, field):
    changed = stub.model_copy(update={field: None})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert getattr(result, field) is None
    assert result.model_dump(mode="json")[field] is None
    assert result.deductions == stub.deductions
    if field in ("gross_pay", "net_pay"):
        assert any("comparison was skipped" in warning for warning in result.warnings)


@pytest.mark.parametrize(
    "changes",
    [{"all_current_deductions_listed": False},
     {"gross_minus_deductions_only": False},
     {"current_deductions_total": None}],
)
def test_incomplete_or_unsupported_structure_skips_net_comparison(stub, evidence, changes):
    changed = stub.model_copy(update={"net_pay": Decimal("1.00")})
    result = review_checks(changed, evidence.model_copy(update=changes),
                           "Total current deductions: 273.42")
    assert any("comparison was skipped" in warning for warning in result.warnings)
    assert not any("differs from net pay" in warning for warning in result.warnings)
    assert result.net_pay == Decimal("1.00")


@pytest.mark.parametrize(
    "text",
    ["", "YTD Total deductions: 273.42", "Year to date deductions: 273.42",
     "YTD Total current deductions: 273.42", "Total current deductions: 999.99",
     "Unclear payroll total: 273.42"],
)
def test_missing_ytd_or_nonmatching_source_total_cannot_enable_comparison(stub, evidence, text):
    changed = stub.model_copy(update={"net_pay": Decimal("1.00")})
    result = review_checks(changed, evidence, text)
    assert any("comparison was skipped" in warning for warning in result.warnings)
    assert not any("differs from net pay" in warning for warning in result.warnings)


@pytest.mark.parametrize("amount", [None, Decimal("-150.00")])
def test_missing_or_ambiguous_deduction_amount_skips_comparison(stub, evidence, amount):
    deductions = [stub.deductions[0].model_copy(update={"amount": amount}), *stub.deductions[1:]]
    changed = stub.model_copy(update={"deductions": deductions, "net_pay": Decimal("1.00")})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert any("comparison was skipped" in warning for warning in result.warnings)
    assert not any("differs from net pay" in warning for warning in result.warnings)
    assert result.deductions[0].amount == amount


def test_itemized_deduction_mismatch_is_flagged_and_net_check_skipped(stub, evidence):
    deductions = [stub.deductions[0].model_copy(update={"amount": Decimal("149.00")}),
                  *stub.deductions[1:]]
    changed = stub.model_copy(update={"deductions": deductions, "net_pay": Decimal("1.00")})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert any("Listed deductions do not match" in warning for warning in result.warnings)
    assert not any("differs from net pay" in warning for warning in result.warnings)
    assert result.deductions[0].amount == Decimal("149.00")
    assert result.net_pay == Decimal("1.00")


def test_supported_mismatch_is_review_flag_not_underpayment_conclusion(stub, evidence):
    changed = stub.model_copy(update={"net_pay": Decimal("1300.00")})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    flags = [warning for warning in result.warnings if "differs from net pay" in warning]
    assert len(flags) == 1
    assert "review flag" in flags[0]
    assert "not proof of underpayment" in flags[0]
    assert result.net_pay == Decimal("1300.00")
    assert result.gross_pay == Decimal("1615.00")


def test_rate_mismatch_and_date_order_warn_without_changing_values(stub, evidence):
    changed = stub.model_copy(update={
        "regular_pay": Decimal("1400.00"),
        "pay_period_start": "2026-09-14", "pay_period_end": "2026-09-01",
    })
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert any("Regular hours" in warning for warning in result.warnings)
    assert any("dates are out of order" in warning for warning in result.warnings)
    assert result.regular_pay == Decimal("1400.00")
    assert result.pay_period_start == "2026-09-14"


def test_repeated_review_warning_is_deduplicated(stub, evidence):
    changed = stub.model_copy(update={"warnings": [REVIEW_WARNING]})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert result.warnings.count(REVIEW_WARNING) == 1


@pytest.mark.parametrize(
    "claim",
    ["You are owed $86.40.", "Your overtime is unpaid.", "You were underpaid.",
     "This is wage theft.", "The employer acted illegally.", "This is an overtime violation.",
     "You are entitled to another payment.", "Your employer must pay another amount."],
)
def test_model_wage_or_legal_conclusions_are_replaced_without_changing_fields(stub, evidence, claim):
    changed = stub.model_copy(update={
        "overtime_hours": Decimal("4"), "overtime_hourly_rate": Decimal("22.50"),
        "overtime_pay": Decimal("90.00"), "warnings": [claim],
    })
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert EXTRACTION_SCOPE_WARNING in result.warnings
    assert claim not in result.warnings
    assert "86.40" not in " ".join(result.warnings)
    assert result.model_dump(exclude={"warnings"}) == changed.model_dump(exclude={"warnings"})


@pytest.mark.parametrize(
    "contradiction",
    ["No overtime was paid.", "Overtime was not added.", "Overtime pay was never paid.",
     "No overtime pay.", "No overtime pay was found."],
)
def test_positive_overtime_amount_drops_contradictory_absence_warning(stub, evidence, contradiction):
    changed = stub.model_copy(update={
        "overtime_hours": Decimal("4"), "overtime_hourly_rate": Decimal("22.50"),
        "overtime_pay": Decimal("90.00"), "warnings": [contradiction],
    })
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert contradiction not in result.warnings
    assert result.overtime_pay == Decimal("90.00")
    assert not any("unpaid" in warning.lower() for warning in result.warnings)


def test_null_overtime_preserves_unreadable_note_without_turning_it_into_nonpayment(stub, evidence):
    missing_note = "The overtime amount is unreadable and could not be extracted."
    changed = stub.model_copy(update={
        "overtime_pay": None, "warnings": [missing_note, "No overtime was paid."],
    })
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert missing_note in result.warnings
    assert "Overtime pay is unknown because the extracted amount is unavailable." in result.warnings
    assert "No overtime was paid." not in result.warnings
    assert result.overtime_pay is None
    assert "86.40" not in " ".join(result.warnings)


def test_safe_model_notes_are_preserved_and_not_confused_with_overtime_absence(stub, evidence):
    notes = ["The pay date is ambiguous.", "No overtime pay rate could be read.",
             "Overtime is not included in gross pay; check the separate payment line."]
    changed = stub.model_copy(update={"warnings": notes})
    result = review_checks(changed, evidence, "Total current deductions: 273.42")
    assert all(note in result.warnings for note in notes)
    assert changed.warnings == notes
