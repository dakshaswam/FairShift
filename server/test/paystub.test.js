import assert from "node:assert/strict"
import { after, test } from "node:test"
import sharp from "sharp"
import { reviewChecks, REVIEW_WARNING } from "../src/paystub/checks.js"
import { formatDecimal, parseDecimal } from "../src/paystub/decimal.js"
import { closeOcr } from "../src/paystub/documents.js"
import { RedactionError, ResponseError } from "../src/paystub/errors.js"
import { ASSUMED_USD, processDocument } from "../src/paystub/pipeline.js"
import { assertNoPii, redactText } from "../src/paystub/privacy.js"
import { buildResponse } from "../src/paystub/response.js"
import { validateExtraction } from "../src/paystub/schema.js"

const STUB = {
  employer_name: "Demo Cafe LLC", pay_period_start: "2026-10-01", pay_period_end: "2026-10-14", pay_date: "2026-10-16",
  currency: "USD", regular_hours: "40.00", regular_hourly_rate: "15.00", regular_pay: "600.00",
  overtime_hours: "4.00", overtime_hourly_rate: "22.50", overtime_pay: "90.00", tips: "0.00", gross_pay: "690.00",
  deductions: [{ label: "Federal withholding", amount: "50.00" }, { label: "Social Security Tax", amount: "42.78" }, { label: "Medicare", amount: "10.01" }],
  net_pay: "587.21", other_earnings: [], warnings: [],
}
const EXTRACTION = {
  is_paystub: true,
  paystub: STUB,
  reconciliation: { all_current_deductions_listed: true, gross_minus_deductions_only: true, current_deductions_total: "102.79" },
}

test("decimals are exact and print like the Python output", () => {
  assert.equal(formatDecimal(parseDecimal("0.1") + parseDecimal("0.2"), 2), "0.30")
  assert.equal(formatDecimal(parseDecimal("80.00")), "80")
  assert.equal(formatDecimal(parseDecimal("-5.5"), 2), "-5.50")
  assert.equal(parseDecimal("1,440.00"), null)
  assert.equal(parseDecimal("1.123456789"), null)
})

test("redacts identifiers but keeps payroll amounts and labels", () => {
  const redacted = redactText(
    [
      "Employer: Demo Cafe LLC",
      "Employee: Maria Gonzalez",
      "SSN: 123-45-6789",
      "Employee ID: E-48213",
      "Employee Address: 123 Main Street",
      "Brooklyn, NY 11201",
      "Email: maria@example.com",
      "Phone: (718) 555-0142",
      "Bank account: XXXX4321",
      "Social Security: 100.00",
      "Gross Pay: 690.00",
      "Currency: USD",
    ].join("\n"),
  )
  for (const secret of ["Maria", "Gonzalez", "123-45-6789", "48213", "Main Street", "11201", "maria@example.com", "555-0142", "4321"]) {
    assert.ok(!redacted.includes(secret), `${secret} should be redacted`)
  }
  assert.match(redacted, /Employee: \[NAME_1\]/)
  assert.match(redacted, /Social Security: 100\.00/)
  assert.match(redacted, /Gross Pay: 690\.00/)
  assert.match(redacted, /Currency: USD/)
  assert.doesNotThrow(() => assertNoPii(redacted))
  assert.throws(() => assertNoPii("Call me at 718-555-0142"), RedactionError)
})

test("new placeholders don't reuse numbers already in the text", () => {
  assert.equal(redactText("[NAME_1] SSN: 123-45-6789"), "[NAME_1] SSN: [SSN_1]")
  assert.equal(redactText("[SSN_2]\nSSN: 987-65-4321"), "[SSN_2]\nSSN: [SSN_3]")
})

test("schema validation is strict", () => {
  assert.doesNotThrow(() => validateExtraction(structuredClone(EXTRACTION)))
  const bad = [
    (e) => (e.paystub.extra = 1),
    (e) => (e.paystub.pay_date = "2026-02-30"),
    (e) => (e.paystub.regular_hours = "-1"),
    (e) => (e.paystub.currency = "usd"),
    (e) => (e.paystub.gross_pay = "1.123456789"),
    (e) => delete e.reconciliation.current_deductions_total,
    (e) => (e.is_paystub = "yes"),
  ]
  for (const change of bad) {
    const copy = structuredClone(EXTRACTION)
    change(copy)
    assert.throws(() => validateExtraction(copy))
  }
})

test("checks compare totals only when the document establishes them", () => {
  const { stub, exact, reconciliation } = validateExtraction(structuredClone(EXTRACTION))
  const text = "Total current deductions: 102.79"
  assert.deepEqual(reviewChecks(stub, exact, reconciliation, text), [REVIEW_WARNING])
  const wrong = validateExtraction({ ...structuredClone(EXTRACTION), paystub: { ...STUB, regular_pay: "650.00", net_pay: "500.00" } })
  const warnings = reviewChecks(wrong.stub, wrong.exact, wrong.reconciliation, text)
  assert.ok(warnings.some((w) => w.startsWith("Regular hours × rate differs")))
  assert.ok(warnings.some((w) => w.startsWith("Gross minus listed current deductions differs")))
  const noTotal = reviewChecks(stub, exact, reconciliation, "no total line here")
  assert.ok(noTotal.some((w) => w.startsWith("Gross/deductions/net comparison was skipped")))
})

test("the summary lists the validated values", () => {
  const message = buildResponse({ ...STUB, warnings: [REVIEW_WARNING] })
  assert.match(message, /Regular pay listed: USD 600\.00; hours: 40; hourly rate: USD 15\.00\./)
  assert.match(message, /Sum of extracted deduction lines: USD 102\.79\./)
  assert.match(message, /Net pay listed: USD 587\.21\./)
})

// A pay stub photo rendered from text, read by real OCR; Muse is stubbed.
async function stubPhoto() {
  const lines = [
    "Employer: Demo Cafe LLC",
    "Employee: Maria Gonzalez",
    "SSN: 123-45-6789",
    "Pay Date: 2026-10-16",
    "Regular: Hours 40.00 | Hourly Rate 15.00 | Pay 600.00",
    "Gross Pay: 690.00",
    "Total current deductions: 102.79",
    "Net Pay: 587.21",
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${lines.length * 70 + 60}"><rect width="100%" height="100%" fill="white"/>${lines
    .map((line, i) => `<text x="40" y="${i * 70 + 80}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="black">${line}</text>`)
    .join("")}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const realFetch = globalThis.fetch
after(async () => {
  globalThis.fetch = realFetch
  await closeOcr()
})

test("processes a photo end to end without sending identifiers", { timeout: 60_000 }, async () => {
  process.env.MUSE_API_KEY ||= "test-key"
  let sent = ""
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body).messages[1].content
    const reply = structuredClone(EXTRACTION)
    reply.paystub.currency = null
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] }))
  }
  const result = await processDocument(await stubPhoto(), ".png")
  assert.ok(sent.includes("Gross Pay: 690.00"), "OCR text reaches Muse")
  for (const secret of ["Maria", "Gonzalez", "123-45-6789"]) assert.ok(!sent.includes(secret), `${secret} must not be sent`)
  assert.equal(result.paystub.net_pay, "587.21")
  assert.equal(result.paystub.currency, "USD")
  assert.equal(result.paystub.warnings[0], ASSUMED_USD)
  assert.equal(result.forced, false)
  assert.match(result.assistant_message, /Net pay listed: USD 587\.21/)
})

test("rejects a model reply that isn't a pay stub", { timeout: 60_000 }, async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...EXTRACTION, is_paystub: false }) } }] }))
  await assert.rejects(processDocument(await stubPhoto(), ".png"), ResponseError)
})
