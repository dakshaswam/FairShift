// Local, fail-closed redaction; no original-value lookup table is constructed.
// Port of fairshift_paystub/privacy.py. The payroll label rules and identifier
// patterns are the same; Presidio + spaCy name/place detection is replaced by
// compromise, which runs anywhere Node does (including a Vercel function).
// Detection is imperfect, particularly with OCR errors and non-English addresses.

import nlp from "compromise"
import { RedactionError } from "./errors.js"

const PLACEHOLDER = /\[(?:NAME|SSN|EMPLOYEE_ID|ADDRESS|EMAIL|PHONE|ACCOUNT|ROUTING|PII)_\d+\]/g
// NER can mistake a currency code such as USD for a location; these must survive.
const CURRENCY_CODES = new Set(
  ("USD EUR GBP CAD AUD NZD MXN BRL CNY JPY KRW INR PHP VND CHF HKD SGD TWD THB " +
    "IDR MYR BDT PKR LKR NPR AED SAR QAR KWD BHD OMR ILS TRY UAH PLN CZK HUF RON " +
    "BGN DKK NOK SEK ISK ZAR NGN KES GHS EGP MAD ETB TZS UGX XOF XAF CLP COP PEN " +
    "ARS UYU DOP GTQ HNL NIO CRC PAB BOB PYG HTG JMD TTD BZD BBD BSD XCD").split(" "),
)

// Python's re.I covers the labels while NAME's value check stays case-sensitive
// ((?-i:[A-Z])). JS regex modifiers aren't available on Node 22, so the label
// part spells out both cases ("name" → "[nN][aA][mM][eE]") and the regex runs
// without the i flag. Escapes and character classes are left as written.
function anyCase(pattern) {
  let out = ""
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "\\") {
      out += c + pattern[++i]
    } else if (inClass) {
      if (c === "]") inClass = false
      out += c
    } else if (c === "[") {
      inClass = true
      out += c
    } else if (/[a-z]/i.test(c)) {
      out += `[${c.toLowerCase()}${c.toUpperCase()}]`
    } else {
      out += c
    }
  }
  return out
}

// Longer labels must precede their shorter alternatives. Only values are masked;
// keeping labels lets the extraction model understand the remaining payroll text.
const LABELS = [
  ["SSN", String.raw`(?:social[ \t]+security(?:[ \t]+(?:number|no\.?))?|ssn|ss[ \t]*#)(?![ \t]+(?:tax|withheld|deduction|wages))(?:[ \t]+\(?[ \t]*(?:last[ \t]*(?:four|4)(?:[ \t]+digits)?|ending(?:[ \t]+in)?)[ \t]*\)?)?`],
  ["EMPLOYEE_ID", String.raw`(?:employee|emp\.?|worker|payroll)[ \t]*(?:id|number|no\.?|#)(?:[ \t]+number)?`],
  ["NAME", String.raw`(?:employee|worker)(?:[ \t]+name)?(?![ \t]+(?:id|number|no\.?|#|address|tax|contributions?|deductions?|benefits?))|payee(?:[ \t]+name)?|(?:paid|pay)[ \t]+to(?:[ \t]+the[ \t]+order[ \t]+of)?|name`],
  ["ADDRESS", String.raw`(?:(?:employee|worker|personal|home|mailing|residential)[ \t]+)?address`],
  ["EMAIL", String.raw`(?:e-?mail)(?:[ \t]+address)?`],
  ["PHONE", String.raw`(?:phone|telephone|mobile|cell)(?:[ \t]+(?:number|no\.?))?`],
  ["ROUTING", String.raw`(?:aba[ \t]+)?(?:routing|transit)(?:[ \t]+(?:number|no\.?|#))?`],
  ["ACCOUNT", String.raw`(?:(?:bank|checking|savings)[ \t]+)?(?:account|acct\.?)(?:[ \t]+(?:number|no\.?|#))?(?:[ \t]+\(?[ \t]*(?:ending(?:[ \t]+in)?|last[ \t]*(?:four|4)(?:[ \t]+digits)?)[ \t]*\)?)?`],
]
const SEPARATOR = String.raw`(?:[ \t]*(?::|=|#)[ \t]*|[ \t]{2,}|(?<=#)(?=\w)|$)`
const UNPUNCTUATED_VALUE = {
  NAME: "[A-Z]",
  SSN: "[\\dXx*•]",
  EMPLOYEE_ID: "[A-Za-z0-9*-]*\\d",
  ADDRESS: "(?:\\d|[Pp]\\.?[ \\t]*[Oo]\\.?)",
  EMAIL: "\\S+@",
  PHONE: "[\\d+(]",
  ACCOUNT: "[\\dXx*•]",
  ROUTING: "[\\dXx*•]",
}
const LABEL_PATTERNS = LABELS.map(([kind, pattern]) => [
  kind,
  new RegExp(String.raw`(?<!\w)(?:${anyCase(pattern)})(?:${SEPARATOR}|[ \t]+(?=${UNPUNCTUATED_VALUE[kind]}))`, "g"),
])
const BOUNDARY = new RegExp(
  String.raw`(?<!\w)(?:employee(?:[ \t]+(?:name|id|address|number))?|emp[ \t]*id|worker(?:[ \t]+(?:name|id))?|` +
    String.raw`ssn|social[ \t]+security(?:[ \t]+number)?|(?:bank[ \t]+)?(?:account|acct\.?)(?:[ \t]+(?:number|no\.?))?|` +
    String.raw`routing(?:[ \t]+number)?|(?:home[ \t]+)?address|e-?mail|phone|telephone|` +
    String.raw`pay[ \t]+period(?:[ \t]+(?:start|end))?|pay[ \t]+date|currency|gross(?:[ \t]+pay)?|` +
    String.raw`net(?:[ \t]+pay)?|regular(?:[ \t]+(?:hours|pay|rate))?|overtime(?:[ \t]+(?:hours|pay|rate))?|` +
    String.raw`tips|deductions?|earnings|ytd|year.to.date)[ \t]*[:=#]`,
  "gi",
)
const PAYROLL_LINE = new RegExp(
  String.raw`^[ \t]*(?:pay[ \t]+(?:period|date)|employer|currency|regular|overtime|gross|net|` +
    String.raw`earnings|deductions?|hours|rate|tips|tax|federal|state|fica|medicare|social[ \t]+security[ \t]+tax|` +
    String.raw`current|year.to.date|ytd|total|bonus|reimbursement)\b`,
  "i",
)
const CITY_STATE_ZIP = /^[ \t]*[A-Za-z.'’ \-]{2,60},?[ \t]+[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?[ \t]*$/i
const STREET = new RegExp(
  String.raw`\b(?:\d{1,6}[ \t]+[A-Za-z0-9.'’# \-]{1,70}[ \t]+` +
    String.raw`(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|terrace|ter|place|pl)\b` +
    String.raw`|p\.?[ \t]*o\.?[ \t]+box[ \t]+\d+)\.?[^\r\n|]*`,
  "i",
)
const UNIT = /^[ \t]*(?:apt\.?|apartment|unit|suite|#)[ \t]*[A-Za-z0-9-]+[ \t]*$/i
const FINANCIAL_PREFIX = new RegExp(
  String.raw`(?:\b(?:gross(?:[ \t]+pay)?|net(?:[ \t]+pay)?|regular(?:[ \t]+(?:pay|hours|rate))?|` +
    String.raw`overtime(?:[ \t]+(?:pay|hours|rate))?|tips|hours|rate|amount|tax|deductions?|ytd|year.to.date)` +
    String.raw`[ \t]*[:=]?[ \t]*(?:[A-Z]{3}[ \t]+)?(?:[$€£¥][ \t]*)?|[$€£¥][ \t]*)$`,
  "i",
)
const PATTERNS = [
  ["EMAIL", /(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gi],
  ["SSN", /(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)/g],
  ["PII", /(?<![\w.$])\d{9,17}(?![\d.])/g],
  ["SSN", /(?<!\w)[xX*•]{3}[- ]?[xX*•]{2}[- ]?\d{4}(?!\d)/g],
  ["ACCOUNT", /(?<!\w)[xX*•]{2,}[- ]?\d{3,4}(?!\d)/g],
  ["ACCOUNT", /\b(?:[A-Z]{2}\d{2}[A-Z0-9]{11,30}|[A-Z]{2}\d{2}(?:[ ][A-Z0-9]{4}){2,7}(?:[ ][A-Z0-9]{1,4})?)\b/g],
  ["PHONE", /(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]\d{4}(?!\d)/g],
]

const span = (start, end, kind) => ({ start, end, kind })

// Keep offsets while making known placeholders invisible to the detectors.
// Underscores also stop a label from looking onto the next line when its value
// is already redacted; whitespace would incorrectly look empty.
const withoutPlaceholders = (text) => text.replace(PLACEHOLDER, (match) => "_".repeat(match.length))

function trimValue(line, start) {
  let end = line.length
  BOUNDARY.lastIndex = start
  const boundary = BOUNDARY.exec(line)
  if (boundary) end = boundary.index
  const column = /[\t|]/.exec(line.slice(start, end))
  if (column) end = start + column.index
  while (start < end && /\s/.test(line[start])) start++
  while (end > start && /\s/.test(line[end - 1])) end--
  return [start, end]
}

// "Social Security: 100.00" on a deduction list is money, while
// "Social Security number: 1234" remains sensitive.
const socialSecurityAmount = (label, value) =>
  /^social[ \t]+security[ \t]*[:=]?[ \t]*$/i.test(label) && /^(?:[$€£¥][ \t]*)?-?\d[\d,]*\.\d{1,4}$/.test(value.trim())

const rstripNewline = (line) => line.replace(/[\r\n]+$/, "")

// Identifiers that often evade generic PII detection.
function regexSpans(text) {
  const spans = []
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (kind === "PII") {
        const lineStart = text.lastIndexOf("\n", match.index - 1) + 1
        if (FINANCIAL_PREFIX.test(text.slice(lineStart, match.index))) continue
      }
      spans.push(span(match.index, match.index + match[0].length, kind))
    }
  }

  const lines = text.split(/(?<=\n)/)
  const offsets = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length
  }
  lines.forEach((fullLine, index) => {
    const line = rstripNewline(fullLine)
    const lineOffset = offsets[index]
    for (const [kind, pattern] of LABEL_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        const [start, end] = trimValue(line, match.index + match[0].length)
        if (end > start) {
          if (kind !== "SSN" || !socialSecurityAmount(match[0], line.slice(start, end))) spans.push(span(lineOffset + start, lineOffset + end, kind))
        } else if (index + 1 < lines.length) {
          // A separate name/address line is a common PDF/OCR layout.
          const following = rstripNewline(lines[index + 1])
          const plausible = kind === "NAME" || kind === "ADDRESS" || /\d|@/.test(following)
          BOUNDARY.lastIndex = 0
          if (plausible && following.trim() && !PAYROLL_LINE.test(following) && !BOUNDARY.test(following)) {
            const begin = following.length - following.trimStart().length
            const finish = following.trimEnd().length
            if (kind !== "SSN" || !socialSecurityAmount(match[0], following.slice(begin, finish))) {
              spans.push(span(offsets[index + 1] + begin, offsets[index + 1] + finish, kind))
            }
          }
        }
        if (kind === "ADDRESS") {
          for (let extra = index + 1; extra < Math.min(index + 4, lines.length); extra++) {
            const following = rstripNewline(lines[extra])
            if (!(STREET.test(following) || CITY_STATE_ZIP.test(following) || UNIT.test(following))) break
            spans.push(span(offsets[extra], offsets[extra] + following.length, "ADDRESS"))
          }
        }
      }
    }
    const street = STREET.exec(line)
    if (street) {
      const [start, end] = trimValue(line, street.index)
      spans.push(span(lineOffset + start, lineOffset + end, "ADDRESS"))
    } else if (CITY_STATE_ZIP.test(line) || UNIT.test(line)) {
      spans.push(span(lineOffset, lineOffset + line.length, "ADDRESS"))
    }
  })
  return spans
}

// Paystub field labels. NER sometimes tags a label as a name or place, especially
// right after a redacted value. A detection made only of these words is a label.
const LABEL_WORDS = new Set(
  `name employee employer email e mail phone telephone tel mobile cell fax address street city
  state zip postal code ssn id number no account routing bank pay date period gross net
  deduction deductions total current ytd hours rate regular overtime tips description summary
  earnings statement deposit direct amount federal social security medicare income tax
  currency usd check stub payroll department dept location emp`.split(/\s+/),
)

const isLabel = (fragment) => {
  const words = fragment.match(/[A-Za-z]+/g)
  return Boolean(words) && words.every((word) => LABEL_WORDS.has(word.toLowerCase()))
}

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu
const keepsWord = (word) => !LABEL_WORDS.has(word.toLowerCase())

// People and places, as Presidio's spaCy recognizer found them. Label words and
// punctuation at either edge are trimmed ("Maria Gonzalez   Emp" → "Maria Gonzalez").
function nerSpans(text) {
  const spans = []
  const doc = nlp(text)
  for (const [kind, matches] of [["NAME", doc.people()], ["ADDRESS", doc.places()]]) {
    for (const { offset } of matches.json({ offset: true })) {
      const words = [...text.slice(offset.start, offset.start + offset.length).matchAll(WORD)]
      const first = words.findIndex((word) => keepsWord(word[0]))
      const last = words.findLastIndex((word) => keepsWord(word[0]))
      if (first === -1) continue
      const start = offset.start + words[first].index
      const end = offset.start + words[last].index + words[last][0].length
      const fragment = text.slice(start, end)
      if (!CURRENCY_CODES.has(fragment) && !isLabel(fragment)) spans.push(span(start, end, kind))
    }
  }
  return spans
}

const PRIORITY = Object.fromEntries(["SSN", "EMPLOYEE_ID", "ACCOUNT", "ROUTING", "EMAIL", "PHONE", "ADDRESS", "NAME"].map((kind, index) => [kind, index]))
const priority = (kind) => PRIORITY[kind] ?? 99

function findSpans(text) {
  const masked = withoutPlaceholders(text)
  let spans
  try {
    spans = [...regexSpans(masked), ...nerSpans(masked)]
  } catch {
    throw new RedactionError("Local PII detection failed. No document was sent.")
  }
  // Collapse overlapping detections. Only offsets and a type are kept; there is
  // deliberately no dictionary of original identifiers.
  const result = []
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  for (const item of spans) {
    if (item.start >= item.end || !masked.slice(item.start, item.end).replace(/[_ \t\r\n]/g, "")) continue
    const previous = result.at(-1)
    if (previous && item.start < previous.end) {
      result.pop()
      const kind = priority(item.kind) < priority(previous.kind) ? item.kind : previous.kind
      result.push(span(previous.start, Math.max(previous.end, item.end), kind))
    } else {
      result.push(item)
    }
  }
  return result
}

// Return locally redacted text. Never writes the input, result, or a mapping.
export function redactText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new RedactionError("No readable local text is available for PII redaction. No document was sent.")
  }
  const spans = findSpans(text)
  const counters = {}
  // Avoid duplicate placeholder numbers if the input already contains some.
  for (const match of text.matchAll(PLACEHOLDER)) {
    const inner = match[0].slice(1, -1)
    const split = inner.lastIndexOf("_")
    const kind = inner.slice(0, split)
    counters[kind] = Math.max(counters[kind] ?? 0, Number(inner.slice(split + 1)))
  }
  const parts = []
  let previous = 0
  for (const item of spans) {
    counters[item.kind] = (counters[item.kind] ?? 0) + 1
    parts.push(text.slice(previous, item.start), `[${item.kind}_${counters[item.kind]}]`)
    previous = item.end
  }
  parts.push(text.slice(previous))
  return parts.join("")
}

// Reject detected residual/new PII without altering the text.
export function assertNoPii(text) {
  if (typeof text !== "string") throw new RedactionError("The privacy check requires text. No document was sent.")
  if (findSpans(text).length) {
    throw new RedactionError(
      "The local privacy check found a possible personal identifier. Review the redacted text or model result locally; no further request was sent.",
    )
  }
}

// For the parity test against the Python rules.
export const _regexSpans = regexSpans
