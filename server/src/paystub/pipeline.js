// Upload → text extraction → redaction → Muse → validation → checks → summary.
// Port of fairshift_paystub/pipeline.py and web.py's process_document, so the
// server can read pay stubs itself (no separate Python service, e.g. on Vercel).

import { randomBytes } from "node:crypto"
import { reviewChecks } from "./checks.js"
import { extractBytes } from "./documents.js"
import { FairShiftError, RedactionError, ResponseError } from "./errors.js"
import { requestExtraction, translateTexts } from "./muse.js"
import { assertNoPii, redactText } from "./privacy.js"
import { buildResponse } from "./response.js"
import { validateExtraction } from "./schema.js"

const MAX_TEXT = 200_000
const AUTO_REDACTION_RETRIES = 2
export const ASSUMED_USD = "The paystub doesn't show a currency, so FairShift assumes US dollars (USD)."
// English language names only, e.g. "Hindi", "Haitian Creole".
const LANGUAGE = /^[A-Za-z][A-Za-z ()-]{1,39}$/

// C1 terminal controls and bidi overrides can conceal PII in a preview.
// Ordinary Unicode letters, natural RTL text, ZWJ and ZWNJ are kept.
const BIDI_CONTROLS = new Set("؜‎‏‪‫‬‭‮⁦⁧⁨⁩")
const isUnsafeControl = (c) => (/\p{Cc}/u.test(c) && c !== "\n" && c !== "\t") || BIDI_CONTROLS.has(c)

function checkControls(text) {
  if ([...text].some(isUnsafeControl)) throw new RedactionError("Text contains unsafe display control characters. Try the upload again.")
}

// Normalize newlines and drop stray controls that PDF/OCR text often carries.
function cleanExtracted(text) {
  text = text.replace(/\r\n/g, "\n").replace(/[\r\f\v]/g, "\n")
  return [...text].map((c) => (isUnsafeControl(c) ? " " : c)).join("")
}

function safeText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) {
    throw new RedactionError("The redacted text is empty or too long. Review the input document.")
  }
  checkControls(text)
}

function* strings(value) {
  if (typeof value === "string") yield value
  else if (Array.isArray(value)) for (const child of value) yield* strings(child)
  else if (value && typeof value === "object") for (const child of Object.values(value)) yield* strings(child)
}

// Muse's reply → a validated, privacy-screened, checked public stub.
function validateResponse(response, sentText) {
  let data
  let extracted
  try {
    if (typeof response !== "string" || response.length > MAX_TEXT) throw new Error()
    data = JSON.parse(response)
    extracted = validateExtraction(data)
  } catch {
    throw new ResponseError("Muse returned invalid JSON or values that do not match the paystub schema. Nothing was saved.")
  }
  try {
    const all = [...strings(data)]
    for (const value of all) checkControls(value)
    // Text already screened before sending needs no second look; only new model
    // text (a reconstructed value, an invented name) does. Screening sent values
    // out of context misfires: "Brooklyn Bagels LLC" reads as a place on its own.
    const sent = sentText.toLowerCase()
    const fresh = all.filter((value) => !sent.includes(value.trim().toLowerCase()))
    // A blank separator keeps unrelated fields from forming a label/value pair.
    if (fresh.length) assertNoPii(fresh.join("\n\n"))
  } catch (error) {
    if (error instanceof RedactionError) throw new ResponseError("The model result failed local privacy screening. It was blocked and was not printed or saved.")
    throw error
  }
  const { isPaystub, stub, exact, reconciliation } = extracted
  const hasPayrollData =
    ["regular_hours", "regular_pay", "overtime_hours", "overtime_pay", "tips", "gross_pay", "net_pay"].some((key) => stub[key] !== null) ||
    stub.deductions.length > 0 ||
    stub.other_earnings.length > 0
  if (!isPaystub || !hasPayrollData) {
    throw new ResponseError("This is not a recognizable paystub, or there is insufficient readable payroll data. Try a clearer paystub.")
  }
  stub.warnings = reviewChecks(stub, exact, reconciliation, sentText)
  return assumeUsd(stub)
}

// FairShift serves workers in the United States, so a paystub that prints no
// currency is in dollars. An explicit currency (for example CAD) is kept.
function assumeUsd(stub) {
  if (stub.currency !== null) return stub
  const notes = stub.warnings.filter((note) => !note.toLowerCase().includes("currency"))
  return { ...stub, currency: "USD", warnings: [ASSUMED_USD, ...notes] }
}

async function prepare(bytes, suffix) {
  try {
    const raw = cleanExtracted(await extractBytes(bytes, suffix))
    safeText(raw)
    const redacted = redactText(raw)
    safeText(redacted)
    return redacted
  } catch (error) {
    if (error instanceof FairShiftError) throw error
    throw new RedactionError("Upload preparation failed; nothing was sent to Muse. Try the upload again.")
  }
}

// Send redacted text to Muse with no manual approval step. If the outbound
// privacy check still finds a possible identifier, the text is redacted again
// and re-checked, up to twice; after that it is sent anyway ("forced"), since by
// then what remains is almost always a false alarm such as a field label.
async function autoSend(redacted) {
  let text = redacted
  safeText(text)
  let retries = 0
  let forced = false
  for (;;) {
    try {
      assertNoPii(text)
      break
    } catch (error) {
      if (!(error instanceof RedactionError)) throw error
      if (retries === AUTO_REDACTION_RETRIES) {
        forced = true
        break
      }
      retries++
      text = redactText(text)
      safeText(text)
    }
  }
  const response = await requestExtraction(text)
  return { stub: validateResponse(response, text), sent: text, retries, forced }
}

// Same JSON as the Python service's POST /api/paystubs/process.
export async function processDocument(bytes, suffix, language = "English") {
  try {
    const redacted = await prepare(bytes, suffix)
    const { stub, sent, retries, forced } = await autoSend(redacted)
    let message = buildResponse(stub)
    // Checks ran on English text; the worker reads it in their own language.
    let notes = [...stub.warnings]
    if (language && language !== "English" && LANGUAGE.test(language)) {
      try {
        ;[message, ...notes] = await translateTexts([message, ...notes], language)
      } catch (error) {
        if (!(error instanceof FairShiftError)) throw error
        console.warn("Display translation failed; showing English.")
      }
    }
    const mode = forced ? "forced" : retries ? "re-redacted" : "clean"
    return {
      upload_id: randomBytes(24).toString("base64url"),
      paystub: stub,
      assistant_message: message,
      warnings_display: notes,
      source: "muse_live",
      sent_text: sent,
      redaction_retries: retries,
      forced,
      trace: [
        { stage: "local_text_extraction", status: "passed", mode: "local" },
        { stage: "redaction", status: "passed", mode: "local" },
        { stage: "automatic_send", status: "passed", mode },
        { stage: "muse", status: "passed", mode: "muse_live" },
        { stage: "schema_validation", status: "passed", mode: "local" },
        { stage: "deterministic_checks", status: "passed", mode: "local" },
        { stage: "chatbot_response", status: "passed", mode: "validated_data" },
      ],
    }
  } catch (error) {
    if (error instanceof FairShiftError) throw error
    throw new ResponseError("Processing failed safely. Try the upload again.")
  }
}
