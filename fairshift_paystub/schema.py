"""Public paystub fields and a private extraction envelope for review checks."""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator


def _decimal(value: object) -> Decimal:
    # Reject floats in Python callers; JSON is parsed with parse_float=Decimal.
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("Expected a decimal string or JSON number.")
    try:
        number = Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError("Expected a finite decimal.") from None
    if not number.is_finite() or abs(number) > Decimal("1000000000000"):
        raise ValueError("Decimal is outside the supported range.")
    if number.as_tuple().exponent < -8:
        raise ValueError("Too many decimal places.")
    return number


Number = Annotated[Decimal, BeforeValidator(_decimal)]
# Apply the Decimal constraint before wrapping the input converter, so Pydantic
# emits JSON Schema's standard `minimum` instead of a custom `ge` keyword.
Nonnegative = Annotated[Decimal, Field(ge=0), BeforeValidator(_decimal)]
ShortText = Annotated[str, Field(max_length=240)]
DateText = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class Deduction(StrictModel):
    label: ShortText | None
    amount: Number | None


class Earning(StrictModel):
    label: ShortText | None
    amount: Number | None
    hours: Nonnegative | None
    hourly_rate: Nonnegative | None


class Paystub(StrictModel):
    """Missing scalar values stay None. Decimal values serialize as strings."""

    employer_name: ShortText | None
    pay_period_start: DateText | None
    pay_period_end: DateText | None
    pay_date: DateText | None
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None
    regular_hours: Nonnegative | None
    regular_hourly_rate: Nonnegative | None
    regular_pay: Number | None
    overtime_hours: Nonnegative | None
    overtime_hourly_rate: Nonnegative | None
    overtime_pay: Number | None
    tips: Number | None
    gross_pay: Number | None
    deductions: Annotated[list[Deduction], Field(max_length=150)]
    net_pay: Number | None
    other_earnings: Annotated[list[Earning], Field(max_length=150)]
    warnings: Annotated[list[Annotated[str, Field(max_length=600)]], Field(max_length=100)]

    @field_validator("pay_period_start", "pay_period_end", "pay_date")
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if value is not None:
            date.fromisoformat(value)
        return value


class Reconciliation(StrictModel):
    """Internal evidence only; these fields are not part of the public JSON."""

    all_current_deductions_listed: bool
    gross_minus_deductions_only: bool
    current_deductions_total: Number | None


class Extraction(StrictModel):
    is_paystub: bool
    paystub: Paystub
    reconciliation: Reconciliation


def extraction_json_schema() -> dict:
    """Compact provider schema; all stricter bounds still apply locally.

    Decimal values are requested as strings, matching our public JSON format.
    Omitting array/length bounds avoids unnecessary constrained-decoding states;
    Pydantic still rejects oversized arrays and strings after the API responds.
    """
    def compact(value):
        if isinstance(value, dict):
            return {
                key: compact(item) for key, item in value.items()
                if key not in {"maxItems", "maxLength", "title"}
            }
        if isinstance(value, list):
            return [compact(item) for item in value]
        return value

    return compact(Extraction.model_json_schema(mode="serialization"))
