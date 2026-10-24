// All API responses below are mocked. No network request or Muse call is made.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { amount, answerPaystubQuestion, extractionSourceLabel, extractPaystub, paystubSummary, preparePaystub, type Paystub, type PreparedPaystub } from "../src/paystub-api.ts"

const source = new URL("../samples/expected_paystub.json", import.meta.url)
const original = JSON.parse(await readFile(source, "utf8")) as Paystub
const changed: Paystub = { ...original, employer_name: "SECOND FICTIONAL EMPLOYER", regular_hours: "12", regular_hourly_rate: "9.50", regular_pay: "114.00", overtime_hours: null, overtime_hourly_rate: null, overtime_pay: null, gross_pay: "114.00", net_pay: "99.00", deductions: [] }
const prepared: PreparedPaystub = { upload_id: "fictional-upload", approval_token: "fictional-approval", redacted_text: "Employee: [NAME_1]\nGross Pay: 114.00", trace: [{ stage: "redaction", status: "complete" }] }

test("answers derive amounts and employer from whichever validated stub is current", () => {
  const first = paystubSummary(original)
  const second = paystubSummary(changed)
  assert.match(first, /FAIRSHIFT DEMO CAFE LLC/)
  assert.match(second, /SECOND FICTIONAL EMPLOYER/)
  assert.match(second, /114\.00/)
  assert.doesNotMatch(second, /1615|Sunbright|86\.40|USD 18/)
  assert.match(answerPaystubQuestion(changed, "What is my regular rate?"), /9\.50/)
})

test("listed overtime is reported without invented unpaid wage amounts", () => {
  const answer = answerPaystubQuestion(original, "Did the document include overtime?")
  assert.match(answer, /135\.00/)
  assert.match(answer, /27\.00/)
  assert.doesNotMatch(answer, /no overtime|not added|86\.40|you are owed|you may be owed/i)
  const legal = answerPaystubQuestion(original, "How much am I owed?")
  assert.match(legal, /cannot determine unpaid wages/)
  assert.match(legal, /135\.00/)
})

test("missing overtime and deductions stay unknown", () => {
  assert.match(answerPaystubQuestion(changed, "overtime"), /remains unknown/)
  assert.doesNotMatch(answerPaystubQuestion(changed, "overtime"), /reports an overtime payment amount/)
  assert.match(answerPaystubQuestion(changed, "deductions"), /cannot assume.*zero/)
  assert.match(answerPaystubQuestion(null, "how much do I earn?"), /do not have a current validated/)
  assert.equal(amount(null, "USD"), "Not provided")
})

test("prepare sends the current file bytes to local OCR without filename or a Muse call", async () => {
  const prior = globalThis.fetch
  const file = new File(["fictional image bytes"], "fake-sensitive-name.png", { type: "image/png" })
  const calls: { path: string; init: RequestInit }[] = []
  globalThis.fetch = (async (path, init) => {
    calls.push({ path: String(path), init: init! })
    return new Response(JSON.stringify(prepared), { status: 200 })
  }) as typeof fetch
  try {
    assert.deepEqual(await preparePaystub(file, new AbortController().signal), prepared)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, "/api/paystubs/prepare")
    assert.equal(calls[0].init.body, file)
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Document-Type"], ".png")
    assert.doesNotMatch(JSON.stringify(calls[0].init.headers), /fake-sensitive-name/)
  } finally { globalThis.fetch = prior }
})

test("extract sends the exact edited approved text and binds the upload ID", async () => {
  const prior = globalThis.fetch
  const edited = "Employee: [NAME_2]\nGross Pay: 114.00"
  let request: Record<string, unknown> | undefined
  globalThis.fetch = (async (path, init) => {
    assert.equal(String(path), "/api/paystubs/extract")
    request = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ upload_id: prepared.upload_id, paystub: changed, assistant_message: "Validated fictional result", trace: [], source: "muse_live" }), { status: 200 })
  }) as typeof fetch
  try {
    const result = await extractPaystub(prepared, edited, new AbortController().signal)
    assert.equal(result.paystub.employer_name, changed.employer_name)
    assert.deepEqual(request, { upload_id: prepared.upload_id, approval_token: prepared.approval_token, approved_text: edited, approved: true })
  } finally { globalThis.fetch = prior }
})

test("a stale upload result or unknown source is rejected", async () => {
  const prior = globalThis.fetch
  try {
    for (const overrides of [{ upload_id: "older-upload", source: "muse_live" }, { upload_id: prepared.upload_id, source: "unknown" }]) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ paystub: original, assistant_message: "stale", trace: [], ...overrides }), { status: 200 })) as typeof fetch
      await assert.rejects(() => extractPaystub(prepared, prepared.redacted_text, new AbortController().signal), /did not match/)
    }
  } finally { globalThis.fetch = prior }
})

test("injected mock extraction is explicitly labeled instead of presented as live", async () => {
  const prior = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ upload_id: prepared.upload_id, paystub: changed, assistant_message: "Mocked fictional result", trace: [], source: "mocked" }), { status: 200 })) as typeof fetch
  try {
    const result = await extractPaystub(prepared, prepared.redacted_text, new AbortController().signal)
    assert.match(extractionSourceLabel(result.source), /Mocked extraction.*not a live Muse response/)
    assert.match(extractionSourceLabel("muse_live"), /Real Muse request/)
  } finally { globalThis.fetch = prior }
})

test("local preparation failures surface an error instead of a sample result", async () => {
  const prior = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Local OCR is unavailable.", stage: "local_extraction" }), { status: 422 })) as typeof fetch
  try {
    await assert.rejects(() => preparePaystub(new File(["fake"], "fictional.png", { type: "image/png" }), new AbortController().signal), /Local OCR is unavailable/)
  } finally { globalThis.fetch = prior }
})
