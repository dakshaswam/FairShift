// Google sign-in: the browser gets an ID token from "Sign in with Google", we verify
// it with Google, then keep the user signed in with an HMAC-signed, httpOnly cookie.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { Router } from "express"
import { OAuth2Client } from "google-auth-library"
import { getUser, updateProfile, upsertGoogleUser } from "./users.js"

const COOKIE_NAME = "fairshift_session"
const SESSION_DAYS = 30

const clientId = process.env.GOOGLE_CLIENT_ID
const googleClient = new OAuth2Client(clientId)
const secret =
  process.env.SESSION_SECRET ||
  (console.warn("Warning: SESSION_SECRET is not set — sessions will reset when the server restarts."),
  randomBytes(32).toString("hex"))

const sign = (value) => createHmac("sha256", secret).update(value).digest("base64url")

function createSessionToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 86_400_000 }),
  ).toString("base64url")
  return `${payload}.${sign(payload)}`
}

function readSessionToken(token) {
  const [payload, signature] = token?.split(".") ?? []
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString())
    return exp > Date.now() ? uid : null
  } catch {
    return null
  }
}

function getCookie(req, name) {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

function setSessionCookie(req, res, value, maxAgeMs) {
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    maxAge: maxAgeMs,
    path: "/",
  })
}

// Use on any route that needs a signed-in user; sets req.user.
export async function requireUser(req, res, next) {
  try {
    const userId = readSessionToken(getCookie(req, COOKIE_NAME))
    const user = userId && (await getUser(userId))
    if (!user) return res.status(401).json({ error: "Please sign in" })
    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

const publicUser = ({ id, email, name, picture, profile }) => ({ id, email, name, picture, profile })

export const authRouter = Router()

authRouter.get("/auth/config", (_req, res) => {
  res.json({ googleClientId: clientId ?? null })
})

// POST /api/auth/google  { credential: "<Google ID token>" }
authRouter.post("/auth/google", async (req, res, next) => {
  try {
    if (!clientId) return res.status(500).json({ error: "GOOGLE_CLIENT_ID is not set on the server" })
    const credential = req.body?.credential
    if (typeof credential !== "string") return res.status(400).json({ error: "Missing Google credential" })

    let payload
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
      payload = ticket.getPayload()
    } catch {
      return res.status(401).json({ error: "Google sign-in could not be verified. Please try again." })
    }
    if (!payload?.sub || payload.email_verified === false) {
      return res.status(401).json({ error: "Your Google account email is not verified." })
    }

    const user = await upsertGoogleUser({
      id: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      picture: payload.picture ?? null,
    })
    setSessionCookie(req, res, createSessionToken(user.id), SESSION_DAYS * 86_400_000)
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.get("/auth/me", requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

authRouter.post("/auth/logout", (req, res) => {
  setSessionCookie(req, res, "", 0)
  res.json({ ok: true })
})

// PUT /api/profile  { occupation, location, hourlyWage, language }
authRouter.put("/profile", requireUser, async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const profile = {}
    for (const field of ["occupation", "location", "language"]) {
      if (body[field] === undefined) continue
      const value = typeof body[field] === "string" ? body[field].trim() : ""
      if (value.length > 120) return res.status(400).json({ error: `"${field}" is too long` })
      profile[field] = value
    }
    if (body.hourlyWage !== undefined) {
      const wage = body.hourlyWage === null || body.hourlyWage === "" ? null : Number(body.hourlyWage)
      if (wage !== null && !(wage > 0 && wage < 1000)) {
        return res.status(400).json({ error: '"hourlyWage" must be a positive number' })
      }
      profile.hourlyWage = wage
    }
    if (profile.occupation === "") return res.status(400).json({ error: "Please tell us your job" })

    const user = await updateProfile(req.user.id, profile)
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})
