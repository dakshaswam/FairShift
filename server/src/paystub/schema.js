// Public paystub fields and a private extraction envelope for review checks.
// Mirrors the Pydantic models in fairshift_paystub/schema.py: strict types, no
// extra keys, stripped strings, bounded lengths. Decimal values stay strings in
// the public JSON; validation also returns their exact BigInt values for checks.

import { readFileSync } from "node:fs"
import { abs, parseDecimal } from "./decimal.js"

const MAX_NUMBER = parseDecimal("1000000000000")

// The compact JSON schema sent to Muse, exported from the Python models.
export const EXTRACTION_SCHEMA = JSON.parse(readFileSync(new URL("./extraction-schema.json", import.meta.url), "utf8"))

class Invalid extends Error {}

function object(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Invalid()
  const actual = Object.keys(value)
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) throw new Invalid()
  return value
}

function text(value, maxLength, pattern) {
  if (value === null) return null
  if (typeof value !== "string") throw new Invalid()
  const trimmed = value.trim()
  if (trimmed.length > maxLength || (pattern && !pattern.test(trimmed))) throw new Invalid()
  return trimmed
}

function date(value) {
  const result = text(value, 10, /^\d{4}-\d{2}-\d{2}$/)
  if (result !== null) {
    const [year, month, day] = result.split("-").map(Number)
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (year < 1 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Invalid()
  }
  return result
}

// Returns [public string, exact value]. JSON numbers are accepted, like the Python
// parser's parse_float=Decimal; Muse is asked for strings.
function number(value, nonnegative = false) {
  if (value === null) return [null, null]
  if (typeof value === "number" && Number.isFinite(value)) value = String(value)
  if (typeof value !== "string") throw new Invalid()
  const exact = parseDecimal(value)
  if (exact === null || abs(exact) > MAX_NUMBER || (nonnegative && exact < 0n)) throw new Invalid()
  return [value.trim(), exact]
}

function list(value, maxLength, item) {
  if (!Array.isArray(value) || value.length > maxLength) throw new Invalid()
  return value.map(item)
}

function bool(value) {
  if (typeof value !== "boolean") throw new Invalid()
  return value
}

const PAYSTUB_KEYS = [
  "employer_name", "pay_period_start", "pay_period_end", "pay_date", "currency",
  "regular_hours", "regular_hourly_rate", "regular_pay", "overtime_hours", "overtime_hourly_rate",
  "overtime_pay", "tips", "gross_pay", "deductions", "net_pay", "other_earnings", "warnings",
]
const NONNEGATIVE = new Set(["regular_hours", "regular_hourly_rate", "overtime_hours", "overtime_hourly_rate"])
const NUMBERS = ["regular_hours", "regular_hourly_rate", "regular_pay", "overtime_hours", "overtime_hourly_rate", "overtime_pay", "tips", "gross_pay", "net_pay"]

// stub: the public JSON (decimals as strings). exact: BigInt values for the same fields.
function paystub(value) {
  object(value, PAYSTUB_KEYS)
  const stub = {}
  const exact = {}
  stub.employer_name = text(value.employer_name, 240)
  for (const key of ["pay_period_start", "pay_period_end", "pay_date"]) stub[key] = date(value[key])
  stub.currency = text(value.currency, 3, /^[A-Z]{3}$/)
  for (const key of NUMBERS) [stub[key], exact[key]] = number(value[key], NONNEGATIVE.has(key))
  exact.deductions = []
  stub.deductions = list(value.deductions, 150, (row) => {
    object(row, ["label", "amount"])
    const [amount, amountExact] = number(row.amount)
    exact.deductions.push(amountExact)
    return { label: text(row.label, 240), amount }
  })
  stub.other_earnings = list(value.other_earnings, 150, (row) => {
    object(row, ["label", "amount", "hours", "hourly_rate"])
    return { label: text(row.label, 240), amount: number(row.amount)[0], hours: number(row.hours, true)[0], hourly_rate: number(row.hourly_rate, true)[0] }
  })
  stub.warnings = list(value.warnings, 100, (warning) => {
    if (typeof warning !== "string") throw new Invalid()
    return text(warning, 600)
  })
  // Keep the public key order identical to the Python output.
  return { stub: Object.fromEntries(PAYSTUB_KEYS.map((key) => [key, stub[key]])), exact }
}

// Returns { isPaystub, stub, exact, reconciliation } or throws Invalid.
export function validateExtraction(data) {
  object(data, ["is_paystub", "paystub", "reconciliation"])
  const isPaystub = bool(data.is_paystub)
  const { stub, exact } = paystub(data.paystub)
  const evidence = object(data.reconciliation, ["all_current_deductions_listed", "gross_minus_deductions_only", "current_deductions_total"])
  const reconciliation = {
    all_current_deductions_listed: bool(evidence.all_current_deductions_listed),
    gross_minus_deductions_only: bool(evidence.gross_minus_deductions_only),
    current_deductions_total: number(evidence.current_deductions_total)[1],
  }
  return { isPaystub, stub, exact, reconciliation }
}

export { Invalid }
