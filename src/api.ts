// Client for the FairShift API in server/. In dev, Vite proxies /api to it.
const API_BASE = import.meta.env.VITE_API_URL ?? ""

export type HelpCategory = "legal_aid" | "worker_center" | "consulate"

export type Place = {
  id: string
  category: HelpCategory
  name: string
  type: string | null
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  reviews: number
  hours: string | null
  description: string | null
  thumbnail: string | null
  coordinates: { lat: number; lng: number } | null
  distanceMiles: number | null
  mentionsLanguage: boolean
  foundInLanguageSearch: boolean
  likelyFree: boolean
  mapsUrl: string
  directionsUrl: string
}

export type HelpResponse = {
  location: string
  language: string
  country: string | null
  needsCountry: boolean
  results: Partial<Record<HelpCategory, Place[]>>
}

export type Pay = {
  text: string
  unit: string
  min: number
  max: number
  hourly: { min: number; max: number; mid: number }
}

export type Job = {
  id: string
  title: string
  company: string
  location: string
  via: string | null
  postedAt: string | null
  scheduleType: string | null
  benefits: string[]
  pay: Pay | null
  paySource: "listing" | "description" | null
  applyUrl: string | null
  thumbnail: string | null
  snippet: string | null
  paysMoreBy: number | null
}

export type PayStats = {
  count: number
  min: number
  p25: number
  median: number
  p75: number
  max: number
}

export type JobsResponse = {
  jobTitle: string
  location: string
  language: string
  stats: PayStats | null
  comparison: {
    yourHourlyWage: number
    marketMedian: number
    percentile: number
    diffPerHour: number
    diffPerYearFullTime: number
    verdict: "below_market" | "at_market" | "above_market"
  } | null
  summary: string
  betterPaying: Job[]
  jobs: Job[]
}

async function get<T>(path: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const response = await fetch(`${API_BASE}/api${path}?${query}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error ?? "We couldn't reach FairShift. Please try again.")
  }
  return data as T
}

export function findHelp(params: {
  category: HelpCategory
  language: string
  location?: string
  lat?: number
  lng?: number
  country?: string
}) {
  return get<HelpResponse>("/help", params)
}

export function compareJobPay(params: {
  jobTitle: string
  location: string
  hourlyWage?: number
  language: string
}) {
  return get<JobsResponse>("/jobs/compare", params)
}

const SPEECH_LANG: Record<string, string> = {
  English: "en-US",
  Español: "es-US",
  हिन्दी: "hi-IN",
  "Tiếng Việt": "vi-VN",
}

export function speakIn(language: string, text: string) {
  if (!("speechSynthesis" in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = SPEECH_LANG[language] ?? "en-US"
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
