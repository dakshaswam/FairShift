// Pay stub upload history: the original file plus the extracted results, per user.
// Supabase (private "paystubs" bucket + paystub_uploads table) when configured,
// otherwise files and a JSON index in server/data.

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { check, PAYSTUB_BUCKET, supabase } from "./db.js"

const DATA_DIR = process.env.UPLOADS_DIR || path.resolve(import.meta.dirname, "../data/uploads")
const EXTENSIONS = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/tiff": "tif", "image/bmp": "bmp" }

const num = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
const date = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null)

// The columns shown in lists, taken from the extracted paystub.
function columnsFor(stub) {
  return {
    employer_name: stub.employer_name ?? null,
    pay_period_start: date(stub.pay_period_start),
    pay_period_end: date(stub.pay_period_end),
    pay_date: date(stub.pay_date),
    currency: stub.currency ?? null,
    gross_pay: num(stub.gross_pay),
    net_pay: num(stub.net_pay),
    regular_hours: num(stub.regular_hours),
    regular_hourly_rate: num(stub.regular_hourly_rate),
    overtime_hours: num(stub.overtime_hours),
    overtime_pay: num(stub.overtime_pay),
  }
}

const LIST_COLUMNS = ["id", "created_at", "file_name", "content_type", "employer_name", "pay_period_start", "pay_period_end", "pay_date", "currency", "gross_pay", "net_pay", "regular_hourly_rate", "hourly_wage_entered"]
const pickList = (row) => Object.fromEntries(LIST_COLUMNS.map((column) => [column, row[column] ?? null]))

// --- Supabase ---

const db = {
  async save(record, file) {
    const filePath = `${record.user_id}/${record.id}.${EXTENSIONS[record.content_type] ?? "bin"}`
    check(await supabase.storage.from(PAYSTUB_BUCKET).upload(filePath, file, { contentType: record.content_type, upsert: false }))
    try {
      return check(await supabase.from("paystub_uploads").insert({ ...record, file_path: filePath }).select(LIST_COLUMNS.join(",")).single())
    } catch (error) {
      await supabase.storage.from(PAYSTUB_BUCKET).remove([filePath])
      throw error
    }
  },
  async list(userId) {
    return check(
      await supabase.from("paystub_uploads").select(LIST_COLUMNS.join(",")).eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    )
  },
  async get(userId, id) {
    return check(await supabase.from("paystub_uploads").select("*").eq("user_id", userId).eq("id", id).maybeSingle())
  },
  async file(row) {
    const blob = check(await supabase.storage.from(PAYSTUB_BUCKET).download(row.file_path))
    return Buffer.from(await blob.arrayBuffer())
  },
  async remove(userId, id) {
    const row = await db.get(userId, id)
    if (!row) return false
    if (row.file_path) await supabase.storage.from(PAYSTUB_BUCKET).remove([row.file_path])
    check(await supabase.from("paystub_uploads").delete().eq("user_id", userId).eq("id", id))
    return true
  },
}

// --- local files ---

const indexFile = path.join(DATA_DIR, "index.json")
let rows = null
let writing = Promise.resolve()
async function loadRows() {
  if (rows) return rows
  try {
    rows = JSON.parse(await readFile(indexFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    rows = []
  }
  return rows
}
function saveRows() {
  writing = writing.then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(`${indexFile}.tmp`, JSON.stringify(rows, null, 2))
    await rename(`${indexFile}.tmp`, indexFile)
  })
  return writing
}

const local = {
  async save(record, file) {
    const filePath = path.join(record.user_id.replace(/[^\w-]/g, "_"), `${record.id}.${EXTENSIONS[record.content_type] ?? "bin"}`)
    await mkdir(path.join(DATA_DIR, path.dirname(filePath)), { recursive: true })
    await writeFile(path.join(DATA_DIR, filePath), file)
    const row = { ...record, file_path: filePath, created_at: new Date().toISOString() }
    ;(await loadRows()).push(row)
    await saveRows()
    return pickList(row)
  },
  async list(userId) {
    return (await loadRows()).filter((row) => row.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(pickList)
  },
  async get(userId, id) {
    return (await loadRows()).find((row) => row.user_id === userId && row.id === id) ?? null
  },
  async file(row) {
    return readFile(path.join(DATA_DIR, row.file_path))
  },
  async remove(userId, id) {
    const all = await loadRows()
    const index = all.findIndex((row) => row.user_id === userId && row.id === id)
    if (index < 0) return false
    const [row] = all.splice(index, 1)
    await rm(path.join(DATA_DIR, row.file_path), { force: true })
    await saveRows()
    return true
  },
}

const store = supabase ? db : local

// Saves the original file and the processed result. Returns the list entry.
export function saveUpload({ userId, file, fileName, contentType, result, hourlyWage }) {
  const record = {
    id: randomUUID(),
    user_id: userId,
    file_name: fileName?.slice(0, 200) || null,
    content_type: contentType,
    file_size: file.length,
    ...columnsFor(result.paystub),
    hourly_wage_entered: num(hourlyWage),
    paystub: result.paystub,
    summary: result.assistant_message ?? null,
    warnings: result.warnings_display ?? result.paystub.warnings ?? [],
    sent_text: result.sent_text ?? null,
    language: result.language ?? null,
  }
  return store.save(record, file)
}

export const listUploads = (userId) => store.list(userId)
export const getUpload = (userId, id) => store.get(userId, id)
export const uploadFile = (row) => store.file(row)
export const deleteUpload = (userId, id) => store.remove(userId, id)
