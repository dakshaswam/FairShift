// Usage: npm run doctor
// Checks everything the searches need, and says exactly what is missing.
import { existsSync, readFileSync } from "node:fs"

const problems = []
const ok = (message) => console.log(`  ✓ ${message}`)
const bad = (message, fix) => {
  problems.push(message)
  console.log(`  ✗ ${message}`)
  if (fix) console.log(`      → ${fix}`)
}

console.log("\nNode")
const [major, minor] = process.versions.node.split(".").map(Number)
if (major > 22 || (major === 22 && minor >= 9)) ok(`Node ${process.versions.node}`)
else bad(`Node ${process.versions.node} is too old (the server needs 22.9 or newer)`, "Install Node 22 (the repo's .mise.toml pins it)")

console.log("\nServer packages")
for (const name of ["express"]) {
  if (existsSync(`server/node_modules/${name}`)) ok(name)
  else bad(`${name} is not installed`, "cd server && npm install")
}

console.log("\nserver/.env")
const env = {}
if (!existsSync("server/.env")) {
  bad("server/.env does not exist", "copy server/.env.example to server/.env and fill it in")
} else {
  for (const line of readFileSync("server/.env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/)
    if (match) env[match[1]] = match[2]
  }
  if ((env.SERPAPI_KEY ?? "").trim()) ok("SERPAPI_KEY is set")
  else bad("SERPAPI_KEY is empty (searches will fail)", "get a key at https://serpapi.com")
  if ((env.GOOGLE_CLIENT_ID ?? "").trim()) ok("GOOGLE_CLIENT_ID is set")
  else bad("GOOGLE_CLIENT_ID is empty (sign-in will not work)", "create an OAuth client ID in Google Cloud; see server/.env.example")
  if ((env.SESSION_SECRET ?? "").trim().length >= 32) ok("SESSION_SECRET is set")
  else bad("SESSION_SECRET is missing or short (logins reset on every restart)", "set it to a long random string")
  if ((env.MUSE_API_KEY ?? "").trim()) ok("MUSE_API_KEY is set")
  else bad("MUSE_API_KEY is empty (the assistant chat will not answer)", "add your Meta Model API key")
}

console.log("\n.env (paystub service)")
const rootEnv = existsSync(".env") ? readFileSync(".env", "utf8") : ""
if (/^\s*MUSE_API_KEY\s*=\s*\S+/m.test(rootEnv)) ok("MUSE_API_KEY is set")
else bad("MUSE_API_KEY is missing from .env (paystub uploads will fail)", "copy .env.example to .env and add your Meta Model API key")

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return { ok: response.ok, body: await response.json().catch(() => null) }
  } catch {
    return null
  }
}

console.log("\nRunning server (http://localhost:8787)")
const health = await get("http://localhost:8787/api/health")
if (!health) bad("the server is not running", "cd server && npm start   (keep it running in its own terminal)")
else {
  ok("server is running")
  if (health.body?.serpApiConfigured) ok("server has SERPAPI_KEY loaded")
  else bad("server is running but has no SERPAPI_KEY", "fill in server/.env, then restart the server (it only reads .env at start)")
  if (health.body?.googleSignInConfigured) ok("server has Google sign-in configured")
  else bad("server is running without GOOGLE_CLIENT_ID", "fill in server/.env, then restart the server")
  if (health.body?.assistantConfigured) ok("server has MUSE_API_KEY loaded for the assistant")
  else bad("server is running without MUSE_API_KEY", "fill in server/.env, then restart the server")
}

console.log("\nPaystub service (http://127.0.0.1:8790)")
const paystub = await get("http://127.0.0.1:8790/api/paystubs/health")
if (!paystub) bad("the paystub service is not running", "npm run dev:paystub   (needs .venv; see README)")
else {
  ok("paystub service is running")
  if (paystub.body?.ocr_available) ok("Tesseract OCR found")
  else bad("Tesseract OCR is missing (photos and scans will fail)", "brew install tesseract")
  if (paystub.body?.api_configured) ok("paystub service has MUSE_API_KEY loaded")
  else bad("paystub service has no MUSE_API_KEY", "add it to .env, then restart npm run dev:paystub")
}

console.log("\nFrontend proxy (http://localhost:8443/api → server)")
const proxied = await get("http://localhost:8443/api/health")
if (!proxied) console.log("  – frontend is not running here (start it with: pnpm dev). Skipping.")
else if (proxied.body?.ok) ok("the app can reach the server")
else bad("the app reached something, but not the server", "make sure the server is running on port 8787")

if (problems.length) {
  console.log(`${problems.length} thing${problems.length === 1 ? "" : "s"} to fix.\n`)
  process.exit(1)
}
console.log("All good.\n")
