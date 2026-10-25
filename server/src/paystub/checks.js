// Arithmetic review flags only. Never infer missing amounts or legal wages.
// Port of fairshift_paystub/checks.py.

import { abs, CENT, multiply, parseDecimal, sum } from "./decimal.js"

export const REVIEW_WARNING = "User review is required. Extracted values are not verified."
export const EXTRACTION_SCOPE_WARNING = "This extractor cannot determine legally owed wages or legal violations."
const WAGE_CONCLUSION =
  /\b(?:owed|owes|owing|unpaid|underpaid|underpayment|illegal|illegally|violation|violations|violated|entitled|entitlement)\b|\bwage\s+theft\b|\b(?:employer|company)\s+must\s+pay\b/i
const OVERTIME_ABSENCE = new RegExp(
  String.raw`\b(?:no|zero)\s+overtime(?:\s+(?:pay|payment|compensation))?\s*(?:(?:was|is|has\s+been)\s+)?(?:paid|added|found|recorded|listed)\b|` +
    String.raw`\bovertime(?:\s+(?:pay|payment|compensation))?\s+(?:(?:was|is|has\s+been)\s+)?(?:not|never)\s+(?:paid|added|found|recorded|listed)\b|` +
    String.raw`\b(?:no|zero)\s+overtime\s+(?:pay|payment|compensation)\s*(?:[.!?]|$)`,
  "i",
)
const TOTAL_LINE =
  /^\s*(?:total\s+current\s+deductions|current\s+total\s+deductions|total\s+deductions\s*\(current\))\s*[:=]\s*(?:[A-Z]{3}\s*)?[$€£]?\s*([0-9][0-9,]*(?:\.[0-9]{1,8})?)\s*$/gim

// Keep extraction notes without promoting model wage/legal conclusions.
function modelReviewNotes(stub, exact) {
  const notes = []
  for (const warning of stub.warnings) {
    if (OVERTIME_ABSENCE.test(warning)) {
      if (exact.overtime_pay !== null && exact.overtime_pay > 0n) continue
      if (exact.overtime_pay === null) {
        notes.push("Overtime pay is unknown because the extracted amount is unavailable.")
        continue
      }
    }
    notes.push(WAGE_CONCLUSION.test(warning) ? EXTRACTION_SCOPE_WARNING : warning)
  }
  return notes
}

// Check net only for a complete, explicitly supported simple payroll. Returns new warnings.
export function reviewChecks(stub, exact, evidence, approvedText) {
  const warnings = modelReviewNotes(stub, exact)
  warnings.push(REVIEW_WARNING)
  if (stub.pay_period_start !== null && stub.pay_period_end !== null && stub.pay_period_start > stub.pay_period_end) {
    warnings.push("Pay-period dates are out of order; review the source document.")
  }
  for (const [title, hours, rate, amount] of [
    ["Regular", exact.regular_hours, exact.regular_hourly_rate, exact.regular_pay],
    ["Overtime", exact.overtime_hours, exact.overtime_hourly_rate, exact.overtime_pay],
  ]) {
    if (hours !== null && rate !== null && amount !== null && abs(multiply(hours, rate) - amount) > CENT) {
      warnings.push(`${title} hours × rate differs from the listed pay; review rounding and payroll details.`)
    }
  }

  const total = evidence.current_deductions_total
  // A model boolean alone cannot establish completeness. Require an explicit,
  // current-period total in the sent text and a matching itemized sum.
  const sourceTotals = [...approvedText.matchAll(TOTAL_LINE)].map((match) => parseDecimal(match[1].replaceAll(",", "")))
  const canCompare =
    evidence.all_current_deductions_listed &&
    evidence.gross_minus_deductions_only &&
    exact.gross_pay !== null &&
    exact.net_pay !== null &&
    total !== null &&
    sourceTotals.some((value) => value !== null && abs(value - total) <= CENT) &&
    exact.deductions.every((amount) => amount !== null && amount >= 0n)
  if (canCompare) {
    const listedTotal = sum(exact.deductions)
    if (abs(listedTotal - total) > CENT) {
      warnings.push("Listed deductions do not match the current deduction total; net comparison was skipped.")
    } else if (abs(exact.gross_pay - total - exact.net_pay) > CENT) {
      warnings.push("Gross minus listed current deductions differs from net pay. This is a review flag, not proof of underpayment.")
    }
  } else {
    warnings.push("Gross/deductions/net comparison was skipped because the payroll structure or complete current amounts were not established.")
  }
  return [...new Set(warnings)]
}
