// Pay stub uploads for the signed-in worker. The file goes to the Python paystub
// service (local OCR, redaction, Muse extraction) and is then saved, with its
// results, to the worker's history.
//
//   POST   /api/uploads             raw file body → processed result + saved entry
//   GET    /api/uploads             the worker's uploads, newest first
//   GET    /api/uploads/:id         one upload with all extracted fields
//   GET    /api/uploads/:id/file    the original photo or PDF
//   DELETE /api/uploads/:id         delete the file and the record

import express, { Router } from "express"
import { requireUser } from "./auth.js"
import { deleteUpload, getUpload, listUploads, saveUpload, uploadFile } from "./uploads.js"

const PAYSTUB_URL = process.env.PAYSTUB_SERVICE_URL || "http://127.0.0.1:8790"
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp",
}

export const uploadsRouter = Router()

uploadsRouter.post(
  "/uploads",
  requireUser,
  express.raw({ type: () => true, limit: "30mb" }),
  async (req, res, next) => {
    try {
      const extension = String(req.headers["x-document-type"] ?? "").toLowerCase()
      const contentType = TYPES[extension]
      if (!contentType || !Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: "Choose a PDF, PNG, JPEG, TIFF, BMP or WebP paystub.", stage: "request" })
      }
      const language = String(req.headers["x-fairshift-language"] ?? "English")

      let response
      try {
        response = await fetch(`${PAYSTUB_URL}/api/paystubs/process`, {
          method: "POST",
          headers: {
            "X-FairShift-Client": "paystub-ui",
            "Content-Type": contentType,
            "X-Document-Type": extension,
            "X-FairShift-Language": language,
          },
          body: req.body,
          signal: AbortSignal.timeout(5 * 60 * 1000),
        })
      } catch {
        return res.status(502).json({ error: "The paystub service isn't running. Start it with `npm run dev:paystub`, then try again.", stage: "request" })
      }
      const result = await response.json().catch(() => null)
      if (!response.ok || !result) return res.status(response.status || 502).json(result ?? { error: "Paystub processing failed.", stage: "request" })

      let upload = null
      try {
        let fileName = null
        try {
          fileName = decodeURIComponent(String(req.headers["x-file-name"] ?? "")) || null
        } catch {
          // Keep it unnamed.
        }
        upload = await saveUpload({
          userId: req.user.id,
          file: req.body,
          fileName,
          contentType,
          result: { ...result, language },
          hourlyWage: req.user.profile?.hourlyWage,
        })
      } catch (error) {
        // The worker still gets their result; it just isn't in the history.
        console.error("Saving upload failed:", error.message)
      }
      res.json({ ...result, upload })
    } catch (error) {
      next(error)
    }
  },
)

uploadsRouter.get("/uploads", requireUser, async (req, res, next) => {
  try {
    res.json({ uploads: await listUploads(req.user.id) })
  } catch (error) {
    next(error)
  }
})

uploadsRouter.get("/uploads/:id", requireUser, async (req, res, next) => {
  try {
    if (!ID.test(req.params.id)) return res.status(404).json({ error: "Upload not found" })
    const row = await getUpload(req.user.id, req.params.id)
    if (!row) return res.status(404).json({ error: "Upload not found" })
    const { file_path: _path, user_id: _user, ...upload } = row
    res.json({ upload })
  } catch (error) {
    next(error)
  }
})

uploadsRouter.get("/uploads/:id/file", requireUser, async (req, res, next) => {
  try {
    if (!ID.test(req.params.id)) return res.status(404).end()
    const row = await getUpload(req.user.id, req.params.id)
    if (!row?.file_path) return res.status(404).end()
    const file = await uploadFile(row)
    res.setHeader("Content-Type", row.content_type || "application/octet-stream")
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("Content-Disposition", "inline")
    res.send(file)
  } catch (error) {
    next(error)
  }
})

uploadsRouter.delete("/uploads/:id", requireUser, async (req, res, next) => {
  try {
    if (!ID.test(req.params.id)) return res.status(404).json({ error: "Upload not found" })
    const removed = await deleteUpload(req.user.id, req.params.id)
    res.status(removed ? 200 : 404).json({ ok: removed })
  } catch (error) {
    next(error)
  }
})
