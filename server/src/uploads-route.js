// Pay stub uploads for the signed-in worker. The file is read in this server
// (OCR, redaction, Muse extraction; see ./paystub) and then saved, with its
// results, to the worker's history. Set PAYSTUB_SERVICE_URL to use the Python
// paystub service instead.
//
//   POST   /api/uploads             raw file body → processed result + saved entry
//                                    (with Accept: application/x-ndjson, one JSON line per
//                                    step, {"stage"}, then {"result"} or {"error"})
//   GET    /api/uploads             the worker's uploads, newest first
//   GET    /api/uploads/:id         one upload with all extracted fields
//   GET    /api/uploads/:id/file    the original photo or PDF
//   DELETE /api/uploads/:id         delete the file and the record

import express, { Router } from "express"
import { requireUser } from "./auth.js"
import { FairShiftError } from "./paystub/errors.js"
import { processDocument } from "./paystub/pipeline.js"
import { deleteUpload, getUpload, listUploads, saveUpload, uploadFile } from "./uploads.js"

const PAYSTUB_URL = process.env.PAYSTUB_SERVICE_URL
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
    let streaming = false
    try {
      const extension = String(req.headers["x-document-type"] ?? "").toLowerCase()
      const contentType = TYPES[extension]
      if (!contentType || !Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: "Choose a PDF, PNG, JPEG, TIFF, BMP or WebP paystub.", stage: "request" })
      }
      const language = String(req.headers["x-fairshift-language"] ?? "English")

      // Live progress: the status line is sent now, so any later error goes in the body.
      streaming = String(req.headers.accept ?? "").includes("application/x-ndjson")
      const send = (event) => res.write(`${JSON.stringify(event)}\n`)
      if (streaming) {
        res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
        res.setHeader("Cache-Control", "no-store")
        res.flushHeaders()
      }
      const fail = (status, body) => (streaming ? res.end(`${JSON.stringify({ ...body, status })}\n`) : res.status(status).json(body))

      let result
      if (PAYSTUB_URL) {
        const forwarded = await forwardToPython(req.body, contentType, extension, language)
        if (!forwarded.ok) return fail(forwarded.status, forwarded.body)
        result = forwarded.body
      } else {
        try {
          result = await processDocument(req.body, extension, language, (stage) => streaming && send({ stage }))
        } catch (error) {
          if (!(error instanceof FairShiftError)) throw error
          return fail(error.status, { error: error.message, stage: error.stage })
        }
      }

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
      if (streaming) res.end(`${JSON.stringify({ result: { ...result, upload } })}\n`)
      else res.json({ ...result, upload })
    } catch (error) {
      if (!streaming || !res.headersSent) return next(error)
      console.error(error)
      res.end(`${JSON.stringify({ error: "Paystub processing failed. Try the upload again.", stage: "request", status: 500 })}\n`)
    }
  },
)

async function forwardToPython(body, contentType, extension, language) {
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
      body,
      signal: AbortSignal.timeout(5 * 60 * 1000),
    })
  } catch {
    return { ok: false, status: 502, body: { error: "The Python paystub service isn't running. Start it with `npm run dev:paystub`, or unset PAYSTUB_SERVICE_URL.", stage: "request" } }
  }
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) return { ok: false, status: response.status || 502, body: result ?? { error: "Paystub processing failed.", stage: "request" } }
  return { ok: true, body: result }
}

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
