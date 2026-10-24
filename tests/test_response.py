"""Response composition uses fictional validated paystubs and no API or state."""

from decimal import Decimal

import pytest

from fairshift_paystub.response import build_response
from fairshift_paystub.schema import Paystub


@pytest.fixture
def stub():
    return Paystub.model_validate({
        "employer_name": "FICTIONAL RIVER CAFE LLC",
        "pay_period_start": "2026-10-01",
        "pay_period_end": "2026-10-07",
        "pay_date": "2026-10-09",
        "currency": "USD",
        "regular_hours": "40",
        "regular_hourly_rate": "15",
        "regular_pay": "600",
        "overtime_hours": "4",
        "overtime_hourly_rate": "22.5",
        "overtime_pay": "90",
        "tips": None,
        "gross_pay": "690",
        "deductions": [
            {"label": "Federal withholding", "amount": "55.21"},
            {"label": "Social Security", "amount": "42.78"},
            {"label": "Medicare", "amount": "4.80"},
        ],
        "net_pay": "587.21",
        "other_earnings": [],
        "warnings": ["User review is required. Extracted values are not verified."],
    })


def test_actual_overtime_and_itemized_values_are_explained(stub):
    response = build_response(stub)
    for expected in (
        "FICTIONAL RIVER CAFE LLC", "2026-10-01", "2026-10-07", "2026-10-09",
        "Regular pay listed: USD 600.00; hours: 40; hourly rate: USD 15.00",
        "Overtime pay listed: USD 90.00; hours: 4; hourly rate: USD 22.50",
        "Gross pay listed: USD 690.00", "Net pay listed: USD 587.21",
        "Federal withholding: USD 55.21", "Social Security: USD 42.78", "Medicare: USD 4.80",
        "Sum of extracted deduction lines: USD 102.79",
        "does not establish that every deduction was captured",
        "Tips listed: unknown", stub.warnings[0],
    ):
        assert expected in response
    for invented_claim in ("Sunbright", "$86.40", "unpaid overtime", "you are owed", "law violation"):
        assert invented_claim not in response


def test_new_paystub_changes_response_and_cannot_reuse_previous_values(stub):
    first = build_response(stub)
    data = stub.model_dump(mode="json")
    data.update(
        employer_name="FICTIONAL HARBOR BAKERY LLC", currency="CAD",
        regular_hours="32", regular_hourly_rate="20", regular_pay="640",
        overtime_hours=None, overtime_hourly_rate=None, overtime_pay=None,
        tips="15", gross_pay="655", net_pay="625",
        deductions=[{"label": "Current tax", "amount": "30"}], warnings=[],
    )
    second = build_response(Paystub.model_validate(data))
    assert first != second
    for expected in ("FICTIONAL HARBOR BAKERY LLC", "CAD 640.00", "hours: 32",
                     "CAD 20.00", "Tips listed: CAD 15.00", "CAD 655.00", "CAD 625.00"):
        assert expected in second
    for previous_value in ("FICTIONAL RIVER CAFE LLC", "USD 90.00", "587.21", "102.79", "Sunbright", "$86.40"):
        assert previous_value not in second
    assert "Overtime pay: unknown" in second
    assert "unpaid overtime" not in second
    assert "Review notes from extraction" not in second


def test_missing_fields_stay_unknown_without_default_currency_or_zeroes(stub):
    data = stub.model_dump(mode="json")
    for field, value in list(data.items()):
        if not isinstance(value, list):
            data[field] = None
    data.update(deductions=[], other_earnings=[], warnings=[])
    response = build_response(Paystub.model_validate(data))
    for expected in ("Employer: unknown", "Pay period: unknown to unknown", "Pay date: unknown",
                     "Currency: unknown", "Regular pay listed: unknown", "Overtime pay: unknown",
                     "Tips listed: unknown", "Gross pay listed: unknown", "Net pay listed: unknown",
                     "total deductions are unknown"):
        assert expected in response
    assert "USD" not in response and "$" not in response
    assert "0.00" not in response
    assert "Sum of extracted deduction lines" not in response


def test_known_amount_with_unknown_currency_is_not_assumed_usd(stub):
    response = build_response(stub.model_copy(update={"currency": None}))
    assert "Overtime pay listed: 90.00 (currency unknown)" in response
    assert "Net pay listed: 587.21 (currency unknown)" in response
    assert "USD" not in response and "$" not in response


def test_missing_deduction_never_invents_balancing_total(stub):
    missing = stub.deductions[0].model_copy(update={"amount": None})
    changed = stub.model_copy(update={"deductions": [missing, *stub.deductions[1:]]})
    response = build_response(changed)
    assert "Federal withholding: unknown" in response
    assert "Deduction total: unknown" in response
    assert "Sum of extracted deduction lines" not in response
    assert "102.79" not in response
    assert "Net pay listed: USD 587.21" in response


def test_negative_deduction_sign_prevents_unqualified_total(stub):
    refund = stub.deductions[0].model_copy(update={"amount": Decimal("-4.50")})
    changed = stub.model_copy(update={"deductions": [refund, *stub.deductions[1:]]})
    response = build_response(changed)
    assert "Federal withholding: USD -4.50" in response
    assert "negative amounts may be refunds or adjustments" in response
    assert "Sum of extracted deduction lines" not in response
    assert "Net pay listed: USD 587.21" in response


def test_decimal_precision_and_other_earning_fields_are_preserved(stub):
    data = stub.model_dump(mode="json")
    data.update(
        deductions=[{"label": "Test A", "amount": "0.10"}, {"label": "Test B", "amount": "0.20"}],
        other_earnings=[{"label": "Shift premium", "amount": "12.3456", "hours": "1.5", "hourly_rate": "8.2304"}],
    )
    response = build_response(Paystub.model_validate(data))
    assert "Sum of extracted deduction lines: USD 0.30" in response
    assert "Shift premium: USD 12.3456; hours: 1.5; hourly rate: USD 8.2304" in response
    assert "0.30000000000000004" not in response


def test_zero_overtime_amount_is_reported_without_claiming_missing_wages(stub):
    response = build_response(stub.model_copy(update={"overtime_pay": Decimal("0")}))
    assert "Overtime pay listed: USD 0.00" in response
    assert "Overtime pay: unknown" not in response
    assert "unpaid overtime" not in response and "you are owed" not in response


def test_only_existing_warnings_are_shown_and_object_is_not_mutated(stub):
    warning = "Regular hours and rate need review against the document."
    changed = stub.model_copy(update={"warnings": [warning], "net_pay": Decimal("1.00")})
    snapshot = changed.model_dump_json()
    response = build_response(changed)
    assert response.count(warning) == 1
    assert "differs from net pay" not in response
    assert "underpayment" not in response
    assert changed.model_dump_json() == snapshot
