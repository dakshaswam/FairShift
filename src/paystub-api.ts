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
  source: "muse_live" | "mocked"
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
  // The dev proxy answers 502/504 without JSON when the Python service isn't running.
  if (!data && [502, 503, 504].includes(response.status)) {
    throw new PaystubRequestError("The paystub service isn't running. Start it with `npm run dev:paystub`, then try again.", "request")
  }
  if (!response.ok) {
    const knownStages = ["request", "approval", "local_text_extraction", "redaction", "model", "validation"]
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
  if (data.upload_id !== prepared.upload_id || !["muse_live", "mocked"].includes(data.source) || !data.paystub || typeof data.assistant_message !== "string" || !Array.isArray(data.trace)) {
    throw new Error("The result did not match the current upload. Choose the document again.")
  }
  return data as PaystubResult
}

// Job pay comparisons are in US dollars, so only a dollar paystub rate can be compared.
// One saved upload, as listed in the history.
export type UploadSummary = {
  id: string
  created_at: string
  file_name: string | null
  content_type: string | null
  employer_name: string | null
  pay_period_start: string | null
  pay_period_end: string | null
  pay_date: string | null
  currency: string | null
  gross_pay: number | null
  net_pay: number | null
  regular_hourly_rate: number | null
  hourly_wage_entered: number | null
}

export type ProcessedPaystub = PaystubResult & {
  // The saved history entry, or null if saving failed (the result is still shown).
  upload?: UploadSummary | null
  // Summary (assistant_message) and review notes in the worker's language.
  warnings_display: string[]
  sent_text: string
  redaction_retries: number
  forced: boolean
}

// Hosted functions (Vercel) accept request bodies up to 4.5 MB, and phone photos
// are often bigger. Large photos are re-encoded as JPEG with the long side capped
// at 3000 px, which is all OCR needs (it enlarges smaller photos to that size).
const MAX_UPLOAD_BYTES = 4_300_000
const MAX_LONG_SIDE = 3000

async function shrinkForUpload(file: File, extension: string): Promise<{ body: Blob; extension: string; name: string }> {
  const decodable = [".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(extension)
  if (!decodable || typeof createImageBitmap !== "function") {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(extension === ".pdf"
        ? "This PDF is larger than 4 MB. Take a photo of the pay stub instead."
        : "This file is larger than 4 MB. Take a JPEG or PNG photo of the pay stub instead.")
    }
    return { body: file, extension, name: file.name }
  }
  const image = await createImageBitmap(file, { imageOrientation: "from-image" })
  const longSide = Math.max(image.width, image.height)
  if (file.size <= MAX_UPLOAD_BYTES && longSide <= MAX_LONG_SIDE) {
    image.close()
    return { body: file, extension, name: file.name }
  }
  let blob: Blob | null = null
  for (const [side, quality] of [[MAX_LONG_SIDE, 0.9], [MAX_LONG_SIDE, 0.8], [2400, 0.8], [2000, 0.75]] as const) {
    const scale = Math.min(1, side / longSide)
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext("2d")!
    context.fillStyle = "#fff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    if (blob && blob.size <= MAX_UPLOAD_BYTES) break
  }
  image.close()
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error("This photo is too large to upload. Try a smaller photo.")
  return { body: blob, extension: ".jpg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" }
}

// One request to the FairShift server: it reads the document (OCR and redaction),
// sends the redacted text to Muse, and saves the file and the result to the
// worker's upload history. The response includes the exact text sent.
export async function processPaystub(file: File, signal: AbortSignal, language = "English"): Promise<ProcessedPaystub> {
  const original = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  if (![".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"].includes(original)) {
    throw new Error("Choose a PDF, PNG, JPEG, TIFF, BMP or WebP paystub.")
  }
  const { body, extension, name } = await shrinkForUpload(file, original)
  const data = await responseData(await fetch("/api/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...HEADERS,
      "Content-Type": body.type || file.type || "application/octet-stream",
      "X-Document-Type": extension,
      "X-FairShift-Language": language,
      "X-File-Name": encodeURIComponent(name.slice(0, 200)),
    },
    body,
    signal,
  }))
  if (!["muse_live", "mocked"].includes(data.source) || !data.paystub || typeof data.assistant_message !== "string"
      || typeof data.sent_text !== "string" || !Array.isArray(data.trace)) {
    throw new Error("The paystub result was incomplete. Choose the document again.")
  }
  return data as ProcessedPaystub
}

export const isUsd = (currency: string | null) => currency !== null && ["USD", "US$", "$"].includes(currency.trim().toUpperCase())

export const dollars = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function amount(value: string | null | undefined, currency: string | null): string {
  if (value === null || value === undefined) return "Not provided"
  if (isUsd(currency) && Number.isFinite(Number(value))) return dollars(Number(value))
  return currency ? `${currency} ${value}` : `${value} (currency not provided)`
}

export function extractionSourceLabel(source: PaystubResult["source"]): string {
  return source === "muse_live" ? "Real Muse request · checked locally" : "Mocked extraction · test data, not a live Muse response"
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
