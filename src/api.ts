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

export type Profile = {
  occupation?: string
  location?: string
  hourlyWage?: number | null
  language?: string
}

export type User = {
  id: string
  email: string
  name: string
  picture: string | null
  profile: Profile | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      data.error ?? "We couldn't reach FairShift. Please try again.",
      response.status,
    )
  }
  return data as T
}

function get<T>(path: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  return request<T>(`${path}?${query}`)
}

export function getAuthConfig() {
  return request<{ googleClientId: string | null }>("/auth/config")
}

// Resolves to null when nobody is signed in.
export async function getCurrentUser() {
  try {
    return (await request<{ user: User }>("/auth/me")).user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function signInWithGoogle(credential: string) {
  return (
    await request<{ user: User }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    })
  ).user
}

export function signOut() {
  return request<{ ok: true }>("/auth/logout", { method: "POST" })
}

export async function saveProfile(profile: Profile) {
  return (
    await request<{ user: User }>("/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    })
  ).user
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

export const speechLang = (language: string) => SPEECH_LANG[language] ?? "en-US"

export function speakIn(language: string, text: string) {
  if (!("speechSynthesis" in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLang(language)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export type PayCheckResult = {
  weeks: {
    week: string
    hours: number
    overtime_hours: number
    should_have_been_paid: number
    actually_paid: number
    difference: number
  }[]
  total_underpayment: number
  minimum_wage_used: number
  notes: string[]
}

export type AssistantCard =
  | { kind: "pay_check"; data: PayCheckResult }
  | {
      kind: "help"
      data: { location: string; results: Partial<Record<HelpCategory, Place[]>> }
    }
  | {
      kind: "jobs"
      data: {
        jobTitle: string
        location: string
        stats: PayStats | null
        comparison: JobsResponse["comparison"]
        jobs: Job[]
      }
    }

export type AssistantEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; text: string }
  | { type: "card"; card: AssistantCard }
  | { type: "language"; language: string; appLanguage: string | null }
  | { type: "done" }
  | {
      type: "error"
      code: "error" | "refusal" | "rate_limited" | "not_configured" | "unavailable"
      message?: string
    }

// Sends one message to the assistant and calls onEvent for each streamed event.
export async function chatWithAssistant(
  body: {
    conversationId?: string
    message: string
    image?: { mediaType: string; data: string }
    mode: string
    replyLanguage: string
    speed: "fast" | "careful"
  },
  onEvent: (event: AssistantEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/api/assistant/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    onEvent({
      type: "error",
      code: response.status === 429 ? "rate_limited" : "error",
      message: data.error,
    })
    return
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "))
      if (line) onEvent(JSON.parse(line.slice(6)) as AssistantEvent)
    }
  }
}
