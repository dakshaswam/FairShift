// Compose a paystub explanation without another model call or conversation state.
// Port of fairshift_paystub/response.py.

import { formatDecimal, parseDecimal, sum } from "./decimal.js"

const number = (value, minimumPlaces = 0) => (value === null ? "unknown" : formatDecimal(parseDecimal(value), minimumPlaces))

function money(value, currency) {
  if (value === null) return "unknown"
  const amount = number(value, 2)
  return currency ? `${currency} ${amount}` : `${amount} (currency unknown)`
}

// Explains only this validated, privacy-checked stub's current-period values. It
// does not infer missing amounts, do wage-law math, or decide underpayment.
export function buildResponse(stub) {
  const m = (value) => money(value, stub.currency)
  const lines = [
    "Here is the current-period information extracted from your paystub. Please review it against the original document.",
    `Employer: ${stub.employer_name || "unknown"}.`,
    `Pay period: ${stub.pay_period_start || "unknown"} to ${stub.pay_period_end || "unknown"}. Pay date: ${stub.pay_date || "unknown"}.`,
    `Currency: ${stub.currency || "unknown"}.`,
    `Regular pay listed: ${m(stub.regular_pay)}; hours: ${number(stub.regular_hours)}; hourly rate: ${m(stub.regular_hourly_rate)}.`,
  ]
  if (stub.overtime_pay === null) {
    lines.push(
      `Overtime pay: unknown; hours: ${number(stub.overtime_hours)}; hourly rate: ${m(stub.overtime_hourly_rate)}. ` +
        "Overtime payment cannot be determined from the missing amount.",
    )
  } else {
    lines.push(`Overtime pay listed: ${m(stub.overtime_pay)}; hours: ${number(stub.overtime_hours)}; hourly rate: ${m(stub.overtime_hourly_rate)}.`)
  }
  lines.push(`Tips listed: ${m(stub.tips)}.`)

  if (stub.other_earnings.length) {
    lines.push("Other earning lines extracted:")
    for (const earning of stub.other_earnings) {
      lines.push(`- ${earning.label || "Unlabeled earning"}: ${m(earning.amount)}; hours: ${number(earning.hours)}; hourly rate: ${m(earning.hourly_rate)}.`)
    }
  } else {
    lines.push("No other earning lines were extracted; this does not establish a zero amount.")
  }
  lines.push(`Gross pay listed: ${m(stub.gross_pay)}.`)

  if (stub.deductions.length) {
    lines.push("Deduction lines extracted:")
    for (const deduction of stub.deductions) lines.push(`- ${deduction.label || "Unlabeled deduction"}: ${m(deduction.amount)}.`)
    const amounts = stub.deductions.map((deduction) => (deduction.amount === null ? null : parseDecimal(deduction.amount)))
    if (amounts.some((amount) => amount === null)) {
      lines.push("Deduction total: unknown because one or more extracted amounts are missing.")
    } else if (amounts.some((amount) => amount < 0n)) {
      lines.push("Deduction total: unknown because negative amounts may be refunds or adjustments.")
    } else {
      lines.push(`Sum of extracted deduction lines: ${m(formatDecimal(sum(amounts)))}. This does not establish that every deduction was captured.`)
    }
  } else {
    lines.push("No readable deduction lines were extracted; total deductions are unknown.")
  }
  lines.push(`Net pay listed: ${m(stub.net_pay)}.`)

  if (stub.warnings.length) {
    lines.push("Review notes from extraction:")
    for (const warning of stub.warnings) lines.push(`- ${warning}`)
  }
  return lines.join("\n")
}
