import assert from "node:assert/strict"
import { test } from "node:test"
import { checkPay } from "../src/payrules.js"

test("flags overtime paid at straight time", () => {
  const result = checkPay({ hourly_rate: 18, weeks: [{ hours_worked: 44, amount_paid_before_tax: 792 }] })
  // 40 × 18 + 4 × 27 = 828; paid 792 → short 36
  assert.equal(result.weeks[0].should_have_been_paid, 828)
  assert.equal(result.total_underpayment, 36)
})

test("raises a rate below minimum wage to the minimum", () => {
  const result = checkPay({ hourly_rate: 6, applicable_min_wage: 15, weeks: [{ hours_worked: 10, amount_paid_before_tax: 60 }] })
  assert.equal(result.minimum_wage_used, 15)
  assert.equal(result.total_underpayment, 90)
})

test("tipped worker whose tips cover minimum wage is not short", () => {
  const result = checkPay({
    tipped: true,
    hourly_rate: 2.13,
    weeks: [{ hours_worked: 40, amount_paid_before_tax: 85.2, tips_received: 300 }],
  })
  assert.equal(result.total_underpayment, 0)
})

test("tipped worker with low tips is owed the difference", () => {
  const result = checkPay({
    tipped: true,
    hourly_rate: 2.13,
    weeks: [{ hours_worked: 40, amount_paid_before_tax: 85.2, tips_received: 100 }],
  })
  // must reach 40 × 7.25 = 290; got 185.20 → short 104.80
  assert.equal(result.total_underpayment, 104.8)
})
