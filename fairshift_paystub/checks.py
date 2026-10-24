"""Arithmetic review flags only. Never infer missing amounts or legal wages."""

import re
from decimal import Decimal

from .schema import Paystub, Reconciliation

REVIEW_WARNING = "User review is required. Extracted values are not verified."
EXTRACTION_SCOPE_WARNING = "This extractor cannot determine legally owed wages or legal violations."
_CENT = Decimal("0.01")
_WAGE_CONCLUSION = re.compile(
    r"\b(?:owed|owes|owing|unpaid|underpaid|underpayment|illegal|illegally|"
    r"violation|violations|violated|entitled|entitlement)\b|\bwage\s+theft\b|"
    r"\b(?:employer|company)\s+must\s+pay\b",
    re.IGNORECASE,
)
_OVERTIME_ABSENCE = re.compile(
    r"\b(?:no|zero)\s+overtime(?:\s+(?:pay|payment|compensation))?\s*"
    r"(?:(?:was|is|has\s+been)\s+)?(?:paid|added|found|recorded|listed)\b|"
    r"\bovertime(?:\s+(?:pay|payment|compensation))?\s+"
    r"(?:(?:was|is|has\s+been)\s+)?(?:not|never)\s+(?:paid|added|found|recorded|listed)\b|"
    r"\b(?:no|zero)\s+overtime\s+(?:pay|payment|compensation)\s*(?:[.!?]|$)",
    re.IGNORECASE,
)
_TOTAL_LINE = re.compile(
    r"(?im)^\s*(?:total\s+current\s+deductions|current\s+total\s+deductions|"
    r"total\s+deductions\s*\(current\))\s*[:=]\s*(?:[A-Z]{3}\s*)?"
    r"[$€£]?\s*([0-9][0-9,]*(?:\.[0-9]{1,8})?)\s*$"
)


def _model_review_notes(stub: Paystub) -> list[str]:
    """Keep extraction notes without promoting model wage/legal conclusions.

    These English rules are a conservative semantic guard, not a legal analysis
    or a complete prompt-injection defense. The pipeline screens every original
    model string for PII before this filter runs.
    """
    notes = []
    for warning in stub.warnings:
        if _OVERTIME_ABSENCE.search(warning):
            if stub.overtime_pay is not None and stub.overtime_pay > 0:
                continue
            if stub.overtime_pay is None:
                notes.append("Overtime pay is unknown because the extracted amount is unavailable.")
                continue
        if _WAGE_CONCLUSION.search(warning):
            notes.append(EXTRACTION_SCOPE_WARNING)
        else:
            notes.append(warning)
    return notes


def review_checks(stub: Paystub, evidence: Reconciliation, approved_text: str) -> Paystub:
    """Check net only for a complete, explicitly supported simple payroll."""
    warnings = _model_review_notes(stub)
    warnings.append(REVIEW_WARNING)
    if (stub.pay_period_start is not None and stub.pay_period_end is not None
            and stub.pay_period_start > stub.pay_period_end):
        warnings.append("Pay-period dates are out of order; review the source document.")
    for title, hours, rate, amount in (
        ("Regular", stub.regular_hours, stub.regular_hourly_rate, stub.regular_pay),
        ("Overtime", stub.overtime_hours, stub.overtime_hourly_rate, stub.overtime_pay),
    ):
        if hours is not None and rate is not None and amount is not None:
            if abs(hours * rate - amount) > _CENT:
                warnings.append(f"{title} hours × rate differs from the listed pay; review rounding and payroll details.")

    total = evidence.current_deductions_total
    # A model boolean alone cannot establish completeness. Require an explicit,
    # current-period total in approved local text and a matching itemized sum.
    source_totals = [Decimal(m.group(1).replace(",", "")) for m in _TOTAL_LINE.finditer(approved_text)]
    can_compare = (
        evidence.all_current_deductions_listed
        and evidence.gross_minus_deductions_only
        and stub.gross_pay is not None
        and stub.net_pay is not None
        and total is not None
        and any(abs(v - total) <= _CENT for v in source_totals)
        and all(d.amount is not None and d.amount >= 0 for d in stub.deductions)
    )
    if can_compare:
        listed_total = sum((d.amount for d in stub.deductions), Decimal("0"))
        if abs(listed_total - total) > _CENT:
            warnings.append("Listed deductions do not match the current deduction total; net comparison was skipped.")
        elif abs(stub.gross_pay - total - stub.net_pay) > _CENT:
            warnings.append("Gross minus listed current deductions differs from net pay. This is a review flag, not proof of underpayment.")
    else:
        warnings.append("Gross/deductions/net comparison was skipped because the payroll structure or complete current amounts were not established.")
    return stub.model_copy(update={"warnings": list(dict.fromkeys(warnings))})
