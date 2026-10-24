// Deterministic federal wage check (minimum wage, overtime after 40 h/week,
// tipped-worker cash wage and tip credit). The assistant must use this instead
// of doing wage math itself.

const FEDERAL_MIN_WAGE = 7.25
const TIPPED_CASH_MIN = 2.13

const round2 = (n) => Math.round(n * 100) / 100

export function checkPay(input) {
  let minWage = Number(input.applicable_min_wage) || FEDERAL_MIN_WAGE
  if (minWage < FEDERAL_MIN_WAGE) minWage = FEDERAL_MIN_WAGE
  const rate = Number(input.hourly_rate) || 0
  const tipped = Boolean(input.tipped)

  const weeks = (input.weeks ?? []).map((week, i) => {
    const hours = Number(week.hours_worked) || 0
    const paid = Number(week.amount_paid_before_tax) || 0
    const tips = Number(week.tips_received) || 0
    const regular = Math.min(hours, 40)
    const overtime = Math.max(0, hours - 40)

    let expected
    let shortfall
    if (!tipped) {
      const effectiveRate = Math.max(rate, minWage)
      expected = regular * effectiveRate + overtime * effectiveRate * 1.5
      shortfall = Math.max(0, expected - paid)
    } else {
      const cash = Math.max(rate, TIPPED_CASH_MIN)
      const credit = Math.max(0, minWage - cash)
      const dueCash = regular * cash + overtime * (1.5 * minWage - credit)
      const requiredTotal = regular * minWage + overtime * 1.5 * minWage
      shortfall = Math.max(Math.max(0, dueCash - paid), Math.max(0, requiredTotal - (paid + tips)))
      expected = Math.max(dueCash, requiredTotal - tips)
    }
    return {
      week: week.label || String(i + 1),
      hours,
      overtime_hours: overtime,
      should_have_been_paid: round2(expected),
      actually_paid: round2(paid),
      difference: round2(shortfall),
    }
  })

  return {
    weeks,
    total_underpayment: round2(weeks.reduce((sum, week) => sum + week.difference, 0)),
    minimum_wage_used: minWage,
    notes: [
      `Estimate under federal rules only: $${minWage.toFixed(2)} minimum wage and 1.5x pay after 40 hours in a workweek.`,
      "Not included: daily overtime or higher tipped-wage rules some states have, unpaid breaks, deductions, or exempt jobs. Amounts are gross (before taxes).",
      "This is an estimate to bring to the Labor Department or a worker center, not a legal finding.",
    ],
  }
}
