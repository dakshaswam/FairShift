// Exact decimal arithmetic for pay amounts, as BigInt fixed point with 8 places
// (the most the schema accepts). Floats would turn 0.1 + 0.2 into 0.30000000000000004.

const PLACES = 8n
const ONE = 10n ** PLACES
const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

export const CENT = ONE / 100n

// "1,440.00" is not accepted here; Muse is asked for plain decimal strings.
export function parseDecimal(text) {
  const value = String(text).trim()
  if (!PLAIN.test(value)) return null
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".")
  if (fraction.length > Number(PLACES)) return null
  const scaled = BigInt(whole || "0") * ONE + BigInt((fraction + "0".repeat(Number(PLACES))).slice(0, Number(PLACES)) || "0")
  return negative ? -scaled : scaled
}

export const abs = (value) => (value < 0n ? -value : value)

// The product of two scaled values, back at the same scale (truncated, like the
// comparisons need: anything within a cent is treated as equal anyway).
export const multiply = (a, b) => (a * b) / ONE

export const sum = (values) => values.reduce((total, value) => total + value, 0n)

// Shortest plain form with at least `minimumPlaces` decimals: 1440 → "1440.00".
export function formatDecimal(value, minimumPlaces = 0) {
  const negative = value < 0n
  const digits = abs(value).toString().padStart(Number(PLACES) + 1, "0")
  const whole = digits.slice(0, -Number(PLACES))
  const fraction = digits.slice(-Number(PLACES)).replace(/0+$/, "").padEnd(minimumPlaces, "0")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}
