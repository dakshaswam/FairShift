// Minimal user store backed by a JSON file. Swap these functions for your team's
// database when backends are merged; the rest of the server only calls these.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const DATA_FILE = process.env.USERS_FILE || path.resolve(import.meta.dirname, "../data/users.json")

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

export async function getUser(id) {
  return (await load())[id] ?? null
}

export async function upsertGoogleUser({ id, email, name, picture }) {
  const all = await load()
  const now = new Date().toISOString()
  all[id] = {
    profile: null,
    createdAt: now,
    ...all[id],
    id,
    email,
    name,
    picture,
    lastLoginAt: now,
  }
  await save()
  return all[id]
}

export async function updateProfile(id, profile) {
  const all = await load()
  if (!all[id]) return null
  all[id].profile = { ...all[id].profile, ...profile, updatedAt: new Date().toISOString() }
  await save()
  return all[id]
}
