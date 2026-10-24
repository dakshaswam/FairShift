import express from "express"
import { serpRouter } from "./routes.js"

const app = express()
const port = Number(process.env.PORT) || 8787

// Allow the Vite frontend (or teammates' apps) to call this API from another origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.sendStatus(204)
  next()
})

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, serpApiConfigured: Boolean(process.env.SERPAPI_KEY) })
})

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
