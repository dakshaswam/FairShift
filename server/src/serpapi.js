// Thin SerpApi client with an in-memory cache so repeat searches don't burn credits.

const SERPAPI_URL = "https://serpapi.com/search.json"
const TIMEOUT_MS = 20_000
const MAX_CACHE_ENTRIES = 500

const cache = new Map()

export class SerpApiError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

// SerpApi reports "no results" as an error string; treat those as empty, not failures.
const EMPTY_RESULT_PATTERN = /hasn't returned any results|no results/i

export async function serpSearch(params) {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) {
    throw new SerpApiError("SERPAPI_KEY is not set on the server", 500)
  }

  const cacheKey = JSON.stringify(Object.entries(params).sort())
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.value

  // Cache the promise itself so identical searches made at the same time share one request.
  const pending = fetchSearch(params, apiKey)
  remember(cacheKey, pending)
  pending.catch(() => cache.delete(cacheKey))
  return pending
}

async function fetchSearch(params, apiKey) {
  const url = new URL(SERPAPI_URL)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  }
  url.searchParams.set("api_key", apiKey)

  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new SerpApiError(`Could not reach SerpApi: ${error.message}`)
  }

  const data = await response.json().catch(() => ({}))
  if (data.error) {
    if (EMPTY_RESULT_PATTERN.test(data.error)) return {}
    throw new SerpApiError(`SerpApi: ${data.error}`, response.status === 401 ? 500 : 502)
  }
  if (!response.ok) {
    throw new SerpApiError(`SerpApi request failed with HTTP ${response.status}`)
  }
  return data
}

function remember(key, value) {
  const ttlMinutes = Number(process.env.CACHE_TTL_MINUTES ?? 360)
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  cache.set(key, { value, expires: Date.now() + ttlMinutes * 60_000 })
}
