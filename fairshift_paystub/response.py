"""Compose a paystub explanation without another model call or conversation state."""

from decimal import Decimal

from .schema import Paystub


def _number(value: Decimal | None, minimum_places: int = 0) -> str:
    if value is None:
        return "unknown"
    integer, separator, fraction = format(value, "f").partition(".")
    fraction = fraction.rstrip("0").ljust(minimum_places, "0")
    return integer + ("." + fraction if fraction else "")


def _money(value: Decimal | None, currency: str | None) -> str:
    if value is None:
        return "unknown"
    amount = _number(value, minimum_places=2)
    return f"{currency} {amount}" if currency else f"{amount} (currency unknown)"


def build_response(stub: Paystub) -> str:
    """Explain only this validated, privacy-checked Paystub's current-period values.

    This function does not infer missing amounts, perform wage-law calculations,
    decide underpayment, or compare net pay with gross pay. Review flags come
    from the existing warnings. A deduction sum is only the sum of readable
    nonnegative extracted lines, never proof that the deduction list is complete.
    """
    money = lambda value: _money(value, stub.currency)
    lines = [
        "Here is the current-period information extracted from your paystub. "
        "Please review it against the original document.",
        f"Employer: {stub.employer_name or 'unknown'}.",
        f"Pay period: {stub.pay_period_start or 'unknown'} to {stub.pay_period_end or 'unknown'}. "
        f"Pay date: {stub.pay_date or 'unknown'}.",
        f"Currency: {stub.currency or 'unknown'}.",
        f"Regular pay listed: {money(stub.regular_pay)}; "
        f"hours: {_number(stub.regular_hours)}; hourly rate: {money(stub.regular_hourly_rate)}.",
    ]
    if stub.overtime_pay is None:
        lines.append(
            "Overtime pay: unknown; "
            f"hours: {_number(stub.overtime_hours)}; hourly rate: {money(stub.overtime_hourly_rate)}. "
            "Overtime payment cannot be determined from the missing amount."
        )
    else:
        lines.append(
            f"Overtime pay listed: {money(stub.overtime_pay)}; "
            f"hours: {_number(stub.overtime_hours)}; hourly rate: {money(stub.overtime_hourly_rate)}."
        )
    lines.append(f"Tips listed: {money(stub.tips)}.")

    if stub.other_earnings:
        lines.append("Other earning lines extracted:")
        for earning in stub.other_earnings:
            lines.append(
                f"- {earning.label or 'Unlabeled earning'}: {money(earning.amount)}; "
                f"hours: {_number(earning.hours)}; hourly rate: {money(earning.hourly_rate)}."
            )
    else:
        lines.append("No other earning lines were extracted; this does not establish a zero amount.")
    lines.append(f"Gross pay listed: {money(stub.gross_pay)}.")

    if stub.deductions:
        lines.append("Deduction lines extracted:")
        for deduction in stub.deductions:
            lines.append(f"- {deduction.label or 'Unlabeled deduction'}: {money(deduction.amount)}.")
        if any(deduction.amount is None for deduction in stub.deductions):
            lines.append("Deduction total: unknown because one or more extracted amounts are missing.")
        elif any(deduction.amount < 0 for deduction in stub.deductions):
            lines.append("Deduction total: unknown because negative amounts may be refunds or adjustments.")
        else:
            total = sum((deduction.amount for deduction in stub.deductions), Decimal("0"))
            lines.append(
                f"Sum of extracted deduction lines: {money(total)}. "
                "This does not establish that every deduction was captured."
            )
    else:
        lines.append("No readable deduction lines were extracted; total deductions are unknown.")
    lines.append(f"Net pay listed: {money(stub.net_pay)}.")

    if stub.warnings:
        lines.append("Review notes from extraction:")
        lines.extend(f"- {warning}" for warning in stub.warnings)
    return "\n".join(lines)
