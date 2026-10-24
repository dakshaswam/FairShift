// Express router for the SerpApi-powered features. Mount it in any Express app:
//   app.use("/api", serpRouter)

import { Router } from "express"
import { CATEGORIES, findHelp } from "./help.js"
import { comparePay } from "./jobs.js"
import { LANGUAGES, resolveLanguage } from "./languages.js"

export const serpRouter = Router()

class BadRequest extends Error {
  status = 400
}

const optionalNumber = (value) => (value === undefined || value === "" ? NaN : Number(value))

function requireText(value, name) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new BadRequest(`"${name}" is required`)
  if (text.length > 120) throw new BadRequest(`"${name}" is too long`)
  return text
}

serpRouter.get("/meta", (_req, res) => {
  res.json({
    categories: CATEGORIES,
    languages: Object.entries(LANGUAGES).map(([code, lang]) => ({
      code,
      name: lang.name,
      native: lang.native,
      defaultCountry: lang.defaultCountry,
    })),
  })
})

// GET /api/help?location=Queens, NY&language=es&category=legal_aid,worker_center&country=Mexico&lat=&lng=
serpRouter.get("/help", async (req, res, next) => {
  try {
    const lat = optionalNumber(req.query.lat)
    const lng = optionalNumber(req.query.lng)
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
    const location = hasCoords && !req.query.location ? "" : requireText(req.query.location, "location")
    const language = resolveLanguage(req.query.language)
    const country = (req.query.country ?? "").trim() || language.defaultCountry
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20)

    const requested = !req.query.category || req.query.category === "all" ? CATEGORIES : String(req.query.category).split(",")
    const unknown = requested.filter((category) => !CATEGORIES.includes(category))
    if (unknown.length) throw new BadRequest(`Unknown category: ${unknown.join(", ")}`)

    const lists = await Promise.all(
      requested.map((category) => findHelp({ category, location, lat, lng, language, country, limit })),
    )

    res.json({
      location,
      language: language.code,
      country,
      // Consulate search needs the worker's home country; tell the UI to ask for it.
      needsCountry: requested.includes("consulate") && !country,
      results: Object.fromEntries(requested.map((category, i) => [category, lists[i]])),
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/jobs/compare?jobTitle=line cook&location=Houston, TX&hourlyWage=12&language=es
serpRouter.get("/jobs/compare", async (req, res, next) => {
  try {
    const jobTitle = requireText(req.query.jobTitle, "jobTitle")
    const location = requireText(req.query.location, "location")
    const hourlyWage = optionalNumber(req.query.hourlyWage)
    if (req.query.hourlyWage !== undefined && req.query.hourlyWage !== "" && !(hourlyWage > 0)) {
      throw new BadRequest('"hourlyWage" must be a positive number')
    }
    const pages = Math.min(Math.max(Number(req.query.pages) || 2, 1), 3)
    const language = resolveLanguage(req.query.language)

    const result = await comparePay({ jobTitle, location, hourlyWage, language, pages })
    res.json({ jobTitle, location, language: language.code, ...result })
  } catch (error) {
    next(error)
  }
})
