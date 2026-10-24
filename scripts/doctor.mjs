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
}

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
