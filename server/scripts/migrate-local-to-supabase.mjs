// Usage: cd server && node --env-file=.env scripts/migrate-local-to-supabase.mjs
// Copies users and pay stub uploads saved in local files (server/data) into
// Supabase. Safe to run more than once: users are upserted and uploads that are
// already in Supabase are skipped. Local files are left in place.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { check, PAYSTUB_BUCKET, supabase } from "../src/db.js"

if (!supabase) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env first.")
  process.exit(1)
}
const DATA = path.resolve(import.meta.dirname, "../data")
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw error
  }
}

const users = Object.values(await readJson(path.join(DATA, "users.json"), {}))
for (const user of users) {
  const profile = user.profile ?? {}
  check(
    await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      occupation: profile.occupation ?? null,
      location: profile.location ?? null,
      hourly_wage: profile.hourlyWage ?? null,
      language: profile.language ?? null,
      created_at: user.createdAt ?? new Date().toISOString(),
      last_login_at: user.lastLoginAt ?? null,
      updated_at: profile.updatedAt ?? null,
    }),
  )
}
console.log(`users: ${users.length} copied`)

const uploads = await readJson(path.join(DATA, "uploads", "index.json"), [])
let copied = 0
for (const row of uploads) {
  const existing = check(await supabase.from("paystub_uploads").select("id").eq("id", row.id).maybeSingle())
  if (existing) continue
  const filePath = `${row.user_id}/${path.basename(row.file_path)}`
  const file = await readFile(path.join(DATA, "uploads", row.file_path))
  check(await supabase.storage.from(PAYSTUB_BUCKET).upload(filePath, file, { contentType: row.content_type, upsert: true }))
  check(await supabase.from("paystub_uploads").insert({ ...row, file_path: filePath }))
  copied++
}
console.log(`uploads: ${copied} copied, ${uploads.length - copied} already there`)
