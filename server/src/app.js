// The FairShift API as an Express app. index.js serves it locally; on Vercel,
// api/index.js exports it as the serverless function.

import express from "express"
import { assistantRouter } from "./assistant.js"
import { authRouter } from "./auth.js"
import { serpRouter } from "./routes.js"
import { supabase } from "./db.js"
import { ocrSelfTest } from "./paystub/documents.js"
import { uploadsRouter } from "./uploads-route.js"

const app = express()

// Allow the Vite frontend (or teammates' apps) to call this API from another origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
  if (req.method === "OPTIONS") return res.sendStatus(204)
  next()
})

// Mounted before the small global body limit: chat bodies carry pay stub fields.
app.use("/api", assistantRouter)
// Before the JSON body limit too: it receives pay stub files.
app.use("/api", uploadsRouter)
app.use(express.json({ limit: "20kb" }))

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    serpApiConfigured: Boolean(process.env.SERPAPI_KEY),
    googleSignInConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    assistantConfigured: Boolean(process.env.MUSE_API_KEY),
    database: supabase ? "supabase" : "local files",
  })
})

// How fast OCR starts and reads on this machine (e.g. a cold Vercel function).
app.get("/api/health/ocr", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await ocrSelfTest()) })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.use("/api", authRouter)
app.use("/api", serpRouter)

app.use((error, _req, res, _next) => {
  const status = error.status ?? 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: error.message ?? "Something went wrong" })
})

export default app
