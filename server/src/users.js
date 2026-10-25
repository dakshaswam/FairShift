// User store: the Supabase "profiles" table when configured, otherwise a JSON file
// in server/data. The rest of the server only calls these three functions.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { check, supabase } from "./db.js"

const DATA_FILE = process.env.USERS_FILE || path.resolve(import.meta.dirname, "../data/users.json")

// --- Supabase ---

// A profiles row → the user shape the app uses ({ profile: null } until onboarding).
function fromRow(row) {
  if (!row) return null
  const hasProfile = row.occupation || row.location || row.hourly_wage != null || row.language
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    profile: hasProfile
      ? {
          occupation: row.occupation ?? undefined,
          location: row.location ?? undefined,
          hourlyWage: row.hourly_wage == null ? null : Number(row.hourly_wage),
          language: row.language ?? undefined,
          updatedAt: row.updated_at,
        }
      : null,
  }
}

const PROFILE_COLUMNS = { occupation: "occupation", location: "location", hourlyWage: "hourly_wage", language: "language" }

const db = {
  async getUser(id) {
    return fromRow(check(await supabase.from("profiles").select("*").eq("id", id).maybeSingle()))
  },
  async upsertGoogleUser({ id, email, name, picture }) {
    const row = { id, email, name, picture, last_login_at: new Date().toISOString() }
    return fromRow(check(await supabase.from("profiles").upsert(row).select().single()))
  },
  async updateProfile(id, profile) {
    const changes = { updated_at: new Date().toISOString() }
    for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
      if (profile[field] !== undefined) changes[column] = profile[field]
    }
    return fromRow(check(await supabase.from("profiles").update(changes).eq("id", id).select().maybeSingle()))
  },
}

// --- local JSON file ---

let users = null
let writing = Promise.resolve()

async function load() {
  if (users) return users
  try {
    users = JSON.parse(await readFile(DATA_FILE, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    users = {}
  }
  return users
}

// Writes are serialized and atomic (temp file + rename) so a crash can't corrupt the file.
function save() {
  writing = writing.then(async () => {
    await mkdir(path.dirname(DATA_FILE), { recursive: true })
    const temp = `${DATA_FILE}.tmp`
    await writeFile(temp, JSON.stringify(users, null, 2))
    await rename(temp, DATA_FILE)
  })
  return writing
}

const file = {
  async getUser(id) {
    return (await load())[id] ?? null
  },
  async upsertGoogleUser({ id, email, name, picture }) {
    const all = await load()
    const now = new Date().toISOString()
    all[id] = { profile: null, createdAt: now, ...all[id], id, email, name, picture, lastLoginAt: now }
    await save()
    return all[id]
  },
  async updateProfile(id, profile) {
    const all = await load()
    if (!all[id]) return null
    all[id].profile = { ...all[id].profile, ...profile, updatedAt: new Date().toISOString() }
    await save()
    return all[id]
  },
}

const store = supabase ? db : file
export const getUser = (id) => store.getUser(id)
export const upsertGoogleUser = (user) => store.upsertGoogleUser(user)
export const updateProfile = (id, profile) => store.updateProfile(id, profile)
