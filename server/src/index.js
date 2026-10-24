import express from "express"
import { assistantRouter } from "./assistant.js"
import { authRouter } from "./auth.js"
import { serpRouter } from "./routes.js"

const app = express()
const port = Number(process.env.PORT) || 8787

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
app.use(express.json({ limit: "20kb" }))

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    serpApiConfigured: Boolean(process.env.SERPAPI_KEY),
    googleSignInConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    assistantConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  })
})

app.use("/api", authRouter)
app.use("/api", serpRouter)

app.use((error, _req, res, _next) => {
  const status = error.status ?? 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: error.message ?? "Something went wrong" })
})

app.listen(port, () => {
  console.log(`FairShift SerpApi service listening on http://localhost:${port}`)
  if (!process.env.SERPAPI_KEY) console.warn("Warning: SERPAPI_KEY is not set — searches will fail.")
})
