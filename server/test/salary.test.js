import assert from "node:assert/strict"
import { test } from "node:test"
import { parseSalary, percentileOf, summarize } from "../src/salary.js"

test("parses hourly ranges from Google Jobs chips", () => {
  const pay = parseSalary("17.50–24.00 an hour")
  assert.deepEqual(pay.hourly, { min: 17.5, max: 24, mid: 20.75 })
  assert.equal(pay.unit, "hour")
})

test("parses single hourly values and shorthand units", () => {
  assert.equal(parseSalary("17.75 an hour").hourly.mid, 17.75)
  assert.equal(parseSalary("Pay: $20/hr plus tips").hourly.mid, 20)
  assert.equal(parseSalary("$22 per hour").hourly.mid, 22)
})

test("converts yearly and monthly pay to hourly", () => {
  assert.deepEqual(parseSalary("$41.6K–$52K a year").hourly, { min: 20, max: 25, mid: 22.5 })
  assert.equal(parseSalary("40–50K a year").hourly.min, 19.23)
  assert.equal(parseSalary("$3,466 a month").hourly.mid, 20)
})

test("rejects text without pay or with implausible pay", () => {
  assert.equal(parseSalary("Full-time"), null)
  assert.equal(parseSalary("2 days ago"), null)
  assert.equal(parseSalary("1 a year"), null)
})

test("summarizes and ranks wages", () => {
  const values = [15, 17, 18, 20, 25]
  assert.deepEqual(summarize(values), { count: 5, min: 15, p25: 17, median: 18, p75: 20, max: 25 })
  assert.equal(percentileOf(values, 18), 50)
  assert.equal(percentileOf(values, 14), 0)
})
