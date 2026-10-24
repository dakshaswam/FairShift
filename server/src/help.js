// Finds nearby legal aid, worker centers and consulates on Google Maps (SerpApi),
// searching in the worker's language and ranking places that may speak it first.

import { serpSearch } from "./serpapi.js"

export const CATEGORIES = ["legal_aid", "worker_center", "consulate"]

// Looks like free / nonprofit help rather than a private firm. ("Free consultation" doesn't count.)
const FREE_HELP_PATTERN =
  /legal aid|legal services|legal assistance|volunteer lawyers|pro bono|non-?profit|sin (fines|ánimo) de lucro|workers?'? (center|centre|rights)|centro (de|del) trabajador|union|sindicato|coalition|alliance|community|comunidad|empowerment/i

// Place types that keep showing up but can't help with unpaid wages.
const OFF_TOPIC_PATTERN = {
  legal_aid:
    /personal injury|lesiones personales|accident|accidente|criminal|penal|hình sự|divorce|divorcio|real estate|bienes ra[ií]ces|bankruptcy|quiebra|bancarrota|dui|traffic|tránsito|estate (law|planning)|notar/i,
  worker_center: /academ|language (school|center)|school of english|escuela|insurance|seguros|real estate|tax prep/i,
  consulate: /mission|misi[oó]n|embassy|embajada|travel|visa services/i,
}

// "Consulate" in the languages we search in, since titles can come back localized.
const CONSULATE_PATTERN = /consul|lãnh sự|领事|領事|영사|दूतावास|قنصلية|konsil/i

function queriesFor(category, language, country) {
  const speaking = language.code === "en" ? null : `${language.name}-speaking`
  switch (category) {
    case "legal_aid":
      return [
        "legal aid wage theft",
        speaking ? `${speaking} employment lawyer` : "employment lawyer unpaid wages",
      ]
    case "worker_center":
      return [
        "worker center workers rights",
        speaking ? `${speaking} immigrant worker center` : "immigrant workers rights organization",
      ]
    case "consulate":
      return country ? [`Consulate General of ${country}`] : []
    default:
      return []
  }
}

export async function findHelp({ category, location, lat, lng, language, country, limit = 8 }) {
  const queries = queriesFor(category, language, country)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  const responses = await Promise.all(
    queries.map((q, index) =>
      serpSearch({
        engine: "google_maps",
        type: "search",
        q: hasCoords ? q : `${q} near ${location}`,
        ll: hasCoords ? `@${lat},${lng},13z` : undefined,
        hl: language.hl,
        gl: "us",
      }).then((data) => ({ data, languageSearch: index > 0 && language.code !== "en" })),
    ),
  )

  const places = new Map()
  for (const { data, languageSearch } of responses) {
    const results = data.local_results ?? (data.place_results ? [data.place_results] : [])
    for (const raw of results) {
      const place = normalizePlace(raw, { category, language, lat, lng, hasCoords })
      place.offTopic = OFF_TOPIC_PATTERN[category].test(`${place.name} ${place.type ?? ""}`)
      if (category === "consulate") place.isConsulate = CONSULATE_PATTERN.test(place.name)
      const existing = places.get(place.id)
      if (existing) {
        existing.foundInLanguageSearch ||= languageSearch
      } else {
        places.set(place.id, { ...place, foundInLanguageSearch: languageSearch })
      }
    }
  }

  return [...places.values()]
    .map((place) => ({ ...place, score: scorePlace(place) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, offTopic, isConsulate, ...place }) => place)
}

function normalizePlace(raw, { category, language, lat, lng, hasCoords }) {
  const coords = raw.gps_coordinates
  const text = [raw.title, raw.type, ...(raw.types ?? []), raw.description, JSON.stringify(raw.extensions ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  const mapsQuery = encodeURIComponent([raw.title, raw.address].filter(Boolean).join(" "))
  return {
    id: raw.place_id ?? raw.data_id ?? `${raw.title}|${raw.address}`,
    category,
    name: raw.title,
    type: raw.type ?? raw.types?.[0] ?? null,
    address: raw.address ?? null,
    phone: raw.phone ?? null,
    website: raw.website ?? null,
    rating: raw.rating ?? null,
    reviews: raw.reviews ?? 0,
    hours: raw.open_state ?? raw.hours ?? null,
    description: raw.description ?? null,
    thumbnail: raw.thumbnail ?? null,
    coordinates: coords ? { lat: coords.latitude, lng: coords.longitude } : null,
    distanceMiles:
      hasCoords && coords ? round1(haversineMiles(lat, lng, coords.latitude, coords.longitude)) : null,
    mentionsLanguage: language.keywords.some((keyword) => text.includes(keyword)),
    likelyFree: FREE_HELP_PATTERN.test([raw.title, raw.type, raw.description].join(" ")),
    mapsUrl: raw.place_id
      ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}&query_place_id=${raw.place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery}${
      raw.place_id ? `&destination_place_id=${raw.place_id}` : ""
    }`,
  }
}

function scorePlace(place) {
  let score = 0
  if (place.offTopic) score -= 8
  if (place.isConsulate) score += 6
  if (place.mentionsLanguage) score += 3
  if (place.foundInLanguageSearch) score += 1
  if (place.category !== "consulate" && place.likelyFree) score += 5
  // Ratings break ties; capped so a heavily reviewed private firm can't outrank free help.
  if (place.rating) score += Math.min(Math.max(place.rating - 3.5, 0) * Math.log10(place.reviews + 1), 4)
  if (place.distanceMiles !== null) score -= place.distanceMiles / 5
  return score
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(a))
}

const round1 = (n) => Math.round(n * 10) / 10
