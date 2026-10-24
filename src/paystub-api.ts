// Paystub requests stay separate from the jobs/help service. No upload data is persisted.
export type Paystub = {
  employer_name: string | null
  pay_period_start: string | null
  pay_period_end: string | null
  pay_date: string | null
  currency: string | null
  regular_hours: string | null
  regular_hourly_rate: string | null
  regular_pay: string | null
  overtime_hours: string | null
  overtime_hourly_rate: string | null
  overtime_pay: string | null
  tips: string | null
  gross_pay: string | null
  deductions: { label: string | null; amount: string | null }[]
  net_pay: string | null
  other_earnings: { label: string | null; amount: string | null; hours: string | null; hourly_rate: string | null }[]
  warnings: string[]
}

export type TraceStage = { stage: string; status: string; mode?: string }
export type PreparedPaystub = {
  upload_id: string
  approval_token: string
  redacted_text: string
  trace: TraceStage[]
}
export type PaystubResult = {
  upload_id: string
  paystub: Paystub
  assistant_message: string
  trace: TraceStage[]
  source: "gemini_live" | "mocked"
}

const HEADERS = { "X-FairShift-Client": "paystub-ui" }

export class PaystubRequestError extends Error {
  stage: string
  constructor(message: string, stage: string) {
    super(message)
    this.stage = stage
  }
}

async function responseData(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const knownStages = ["request", "approval", "local_text_extraction", "redaction", "gemini", "validation"]
    const stage = knownStages.includes(data?.stage) ? data.stage : "request"
    throw new PaystubRequestError(typeof data?.error === "string" ? data.error : "Paystub processing failed. Check the local paystub service and try again.", stage)
  }
  if (!data || typeof data !== "object") throw new Error("The paystub service returned an unreadable response.")
  return data
}

export async function preparePaystub(file: File, signal: AbortSignal): Promise<PreparedPaystub> {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  if (![".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"].includes(extension)) {
    throw new Error("Choose a PDF, PNG, JPEG, TIFF, BMP or WebP paystub.")
  }
  const data = await responseData(await fetch("/api/paystubs/prepare", {
    method: "POST",
    credentials: "same-origin",
    headers: { ...HEADERS, "Content-Type": file.type || "application/octet-stream", "X-Document-Type": extension },
    body: file,
    signal,
  }))
  if (typeof data.upload_id !== "string" || typeof data.approval_token !== "string" || typeof data.redacted_text !== "string" || !Array.isArray(data.trace)) {
    throw new Error("The local preview was incomplete. Choose the document again.")
  }
  return data as PreparedPaystub
}

export async function extractPaystub(prepared: PreparedPaystub, approvedText: string, signal: AbortSignal): Promise<PaystubResult> {
  const data = await responseData(await fetch("/api/paystubs/extract", {
    method: "POST",
    credentials: "same-origin",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_id: prepared.upload_id,
      approval_token: prepared.approval_token,
      approved_text: approvedText,
      approved: true,
    }),
    signal,
  }))
  if (data.upload_id !== prepared.upload_id || !["gemini_live", "mocked"].includes(data.source) || !data.paystub || typeof data.assistant_message !== "string" || !Array.isArray(data.trace)) {
    throw new Error("The result did not match the current upload. Choose the document again.")
  }
  return data as PaystubResult
}

export function amount(value: string | null | undefined, currency: string | null): string {
  if (value === null || value === undefined) return "Not provided"
  return currency ? `${currency} ${value}` : `${value} (currency not provided)`
}

// Job pay comparisons are in US dollars, so only a dollar paystub rate can be compared.
export const isUsd = (currency: string | null) => currency !== null && ["USD", "US$", "$"].includes(currency.trim().toUpperCase())

export function extractionSourceLabel(source: PaystubResult["source"]): string {
  return source === "gemini_live" ? "Real Gemini request · checked locally" : "Mocked extraction · test data, not a live Gemini response"
}

const quantity = (value: string | null) => value ?? "not provided"

export function paystubSummary(stub: Paystub): string {
  const money = (value: string | null) => amount(value, stub.currency)
  const lines = [
    `Employer: ${stub.employer_name ?? "not provided"}.`,
    `Pay period: ${stub.pay_period_start ?? "not provided"} to ${stub.pay_period_end ?? "not provided"}. Pay date: ${stub.pay_date ?? "not provided"}.`,
    `Regular hours: ${quantity(stub.regular_hours)}; hourly rate: ${money(stub.regular_hourly_rate)}; regular pay: ${money(stub.regular_pay)}.`,
    `Overtime hours: ${quantity(stub.overtime_hours)}; overtime hourly rate: ${money(stub.overtime_hourly_rate)}; overtime pay listed: ${money(stub.overtime_pay)}.`,
    `Gross pay: ${money(stub.gross_pay)}. Net pay: ${money(stub.net_pay)}.`,
    stub.deductions.length ? `Deductions: ${stub.deductions.map((line) => `${line.label ?? "Unlabeled"}: ${money(line.amount)}`).join("; ")}.` : "No readable deduction lines were extracted; that does not mean deductions were zero.",
    "These are extracted document values and need your review. This document alone does not establish legally owed wages.",
  ]
  return lines.join("\n")
}

export function answerPaystubQuestion(stub: Paystub | null, question: string): string {
  if (!stub) return "Upload a paystub and approve its redacted preview first. I do not have a current validated document to answer from."
  const text = question.toLowerCase()
  const money = (value: string | null) => amount(value, stub.currency)
  if (/owed|underpa|unpaid|illegal|viola|claim|missing pay/.test(text)) {
    return `The current document lists overtime pay as ${money(stub.overtime_pay)} for ${quantity(stub.overtime_hours)} overtime hours. Missing fields remain unknown. I cannot determine unpaid wages or a legal violation from this paystub alone. You would need the relevant work records, pay agreement and applicable rules reviewed separately.`
  }
  if (/overtime|extra hours/.test(text)) {
    const note = stub.overtime_pay === null ? "No readable overtime payment amount was extracted; it remains unknown." : "The document reports an overtime payment amount."
    return `The current document lists ${quantity(stub.overtime_hours)} overtime hours, an overtime hourly rate of ${money(stub.overtime_hourly_rate)}, and overtime pay of ${money(stub.overtime_pay)}. ${note} Whether all legally required pay was made needs additional evidence.`
  }
  if (/deduct|tax/.test(text)) {
    return stub.deductions.length ? `The current document's extracted deductions are: ${stub.deductions.map((line) => `${line.label ?? "Unlabeled"}: ${money(line.amount)}`).join("; ")}. An incomplete line remains unknown; no deduction is invented to balance totals.` : "No readable deduction lines were extracted from the current document. I cannot assume the deductions are zero."
  }
  if (/employer|company|cafe|name/.test(text)) return `The current document's employer is ${stub.employer_name ?? "not provided"}.`
  if (/gross|net|take.home|total pay/.test(text)) return `The current document lists gross pay of ${money(stub.gross_pay)} and net pay of ${money(stub.net_pay)}. Review the original document to confirm these extracted amounts.`
  if (/regular|hour|rate/.test(text)) return `The current document lists ${quantity(stub.regular_hours)} regular hours, a regular hourly rate of ${money(stub.regular_hourly_rate)}, and regular pay of ${money(stub.regular_pay)}. Overtime pay field: ${money(stub.overtime_pay)}.`
  return paystubSummary(stub)
}
