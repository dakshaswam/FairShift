// Pulls pay out of job-posting text ("17.50–24.00 an hour", "$40K–$50K a year")
// and normalizes it to an hourly rate assuming full-time (40 h/week, 2080 h/year).

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK])?`
const SALARY_PATTERN = new RegExp(
  String.raw`\$?\s*${NUMBER}(?:\s*(?:[–—-]|to)\s*\$?\s*${NUMBER})?\s*(?:an?|per|\/)\s*(hour|hr|year|yr|annum|annually|month|mo|week|wk|day)\b`,
  "i",
)

const HOURS_PER_UNIT = {
  hour: 1,
  year: 2080,
  month: 2080 / 12,
  week: 40,
  day: 8,
}

const UNIT_ALIASES = { hr: "hour", yr: "year", annum: "year", annually: "year", mo: "month", wk: "week" }

const MIN_PLAUSIBLE_HOURLY = 5
const MAX_PLAUSIBLE_HOURLY = 250

export function parseSalary(text) {
  if (!text) return null
  const match = SALARY_PATTERN.exec(text)
  if (!match) return null

  const [, lowRaw, lowK, highRaw, highK, unitRaw] = match
  const unit = UNIT_ALIASES[unitRaw.toLowerCase()] ?? unitRaw.toLowerCase()
  // "40–50K a year": the K on the high end applies to the low end too.
  const low = toNumber(lowRaw, lowK || (highRaw ? highK : undefined))
  const high = highRaw ? toNumber(highRaw, highK) : low

  const hourlyMin = low / HOURS_PER_UNIT[unit]
  const hourlyMax = high / HOURS_PER_UNIT[unit]
  if (hourlyMin < MIN_PLAUSIBLE_HOURLY || hourlyMax > MAX_PLAUSIBLE_HOURLY || hourlyMax < hourlyMin) {
    return null
  }
  return {
    text: match[0].trim(),
    unit,
    min: low,
    max: high,
    hourly: { min: round2(hourlyMin), max: round2(hourlyMax), mid: round2((hourlyMin + hourlyMax) / 2) },
  }
}

function toNumber(raw, k) {
  return Number(raw.replace(/,/g, "")) * (k ? 1000 : 1)
}

export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return {
    count: sorted.length,
    min: sorted[0],
    p25: round2(quantile(sorted, 0.25)),
    median: round2(quantile(sorted, 0.5)),
    p75: round2(quantile(sorted, 0.75)),
    max: sorted[sorted.length - 1],
  }
}

// Share of values strictly below `value` (ties count half), 0–100.
export function percentileOf(values, value) {
  if (values.length === 0) return null
  const below = values.filter((v) => v < value).length
  const equal = values.filter((v) => v === value).length
  return Math.round(((below + equal / 2) / values.length) * 100)
}

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const next = sorted[base + 1] ?? sorted[base]
  return sorted[base] + (position - base) * (next - sorted[base])
}

export const round2 = (n) => Math.round(n * 100) / 100
