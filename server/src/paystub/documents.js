// Read a pay stub's text on the server, in memory. No temporary files.
// Port of fairshift_paystub/documents.py: text PDFs are read directly, photos and
// scanned PDF pages go through OCR. Tesseract runs as WebAssembly (tesseract.js-core)
// in this process, with the English data shipped in node_modules, so it runs the
// same way in a Vercel function as on a laptop.

import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import sharp from "sharp"
import { getDocumentProxy, renderPageAsImage } from "unpdf"
import { DocumentError } from "./errors.js"

export const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_PAGES = 20
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_TEXT_CHARACTERS = 200_000
const OCR_UPSCALE_MAX = 3
// Small photos are enlarged until their long side reaches this; larger ones are left alone.
const OCR_TARGET_LONG_SIDE = 3000
const PDF_RENDER_SCALE = 300 / 72
const IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"])

const require = createRequire(import.meta.url)

// The engine loads its .wasm file from its own folder at run time, which file
// tracing (Vercel) can't see, so both engine files and the language data are
// named here with require.resolve, which it does follow.
const OCR_FILES = {
  engine: require.resolve("tesseract.js-core/tesseract-core-simd-lstm.js"),
  wasm: require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm"),
  english: require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
}

function checkTextSize(text) {
  if (text.length > MAX_TEXT_CHARACTERS) throw new DocumentError("The extracted text is too large. Use a shorter paystub.")
  return text
}

// One Tesseract engine per warm server instance, run directly in this process
// (no worker thread). Recognition is synchronous and takes about a second.
let enginePromise = null
function ocrEngine() {
  enginePromise ??= (async () => {
    const missing = Object.values(OCR_FILES).filter((file) => !existsSync(file))
    if (missing.length) throw new DocumentError("The OCR engine is missing from this server. Try a PDF instead.")
    const Core = require(OCR_FILES.engine)
    const tesseract = await Core({ TesseractProgress() {} })
    tesseract.FS.writeFile("/eng.traineddata", gunzipSync(readFileSync(OCR_FILES.english)))
    const api = new tesseract.TessBaseAPI()
    // OEM 1 = LSTM only, the model in this language data.
    if (api.Init(null, "eng", 1) === -1) throw new DocumentError("The OCR engine could not start.")
    api.SetVariable("tessedit_pageseg_mode", "3")
    api.SetVariable("user_defined_dpi", "300")
    return { tesseract, api }
  })()
  enginePromise.catch(() => {
    enginePromise = null
  })
  return enginePromise
}

// Reads a PNG (or BMP) image's text.
async function recognize(image) {
  const { tesseract, api } = await ocrEngine()
  tesseract.FS.writeFile("/input", image)
  try {
    if (api.SetImageFile(1, 0) === 1) throw new DocumentError("The image could not be read. Try a clearer photo.")
    api.Recognize(null)
    return api.GetUTF8Text()
  } finally {
    tesseract.FS.unlink("/input")
  }
}

// For GET /api/health/ocr: whether this server has the OCR files, and how long the
// engine takes to start and read a small blank page. No document is involved.
export async function ocrSelfTest() {
  const missing = Object.entries(OCR_FILES).filter(([, file]) => !existsSync(file)).map(([name]) => name)
  const started = Date.now()
  try {
    await ocrEngine()
    const ready = Date.now()
    await recognize(await sharp({ create: { width: 400, height: 120, channels: 3, background: "#ffffff" } }).png().toBuffer())
    return { ok: true, missing, startMs: ready - started, readMs: Date.now() - ready }
  } catch (error) {
    return { ok: false, missing, error: error.message, afterMs: Date.now() - started }
  }
}

// Kept for scripts and tests; the in-process engine needs no shutdown.
export const closeOcr = async () => {}

// Gray level that best separates ink from paper (Otsu, 1979).
function otsuThreshold(histogram) {
  const total = histogram.reduce((a, b) => a + b, 0)
  const weightedTotal = histogram.reduce((sum, count, level) => sum + level * count, 0)
  let background = 0
  let backgroundSum = 0
  let bestLevel = 127
  let bestVariance = -1
  for (let level = 0; level < 256; level++) {
    const count = histogram[level]
    background += count
    if (background === 0) continue
    const foreground = total - background
    if (foreground === 0) break
    backgroundSum += level * count
    const meanBack = backgroundSum / background
    const meanFore = (weightedTotal - backgroundSum) / foreground
    const variance = background * foreground * (meanBack - meanFore) ** 2
    if (variance > bestVariance) {
      bestLevel = level
      bestVariance = variance
    }
  }
  return bestLevel
}

// Grayscale, contrast-stretched black/white PNG for Tesseract, enlarged only when
// small. Transparency is flattened onto white first; otherwise it turns black. The
// black/white cutoff is chosen per image (Otsu) because photographed paper is gray.
async function prepareForOcr(image) {
  const { data, info } = await image
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  if (width * height > MAX_IMAGE_PIXELS) throw new DocumentError("The image is too large. Resize it before trying again.")
  const scale = Math.min(OCR_UPSCALE_MAX, Math.max(1, OCR_TARGET_LONG_SIDE / Math.max(width, height)), Math.sqrt(MAX_IMAGE_PIXELS / (width * height)))
  let pipeline = sharp(data, { raw: { width, height, channels: info.channels } })
  if (scale > 1) pipeline = pipeline.resize(Math.round(width * scale), Math.round(height * scale), { kernel: "lanczos3" })
  const stretched = await pipeline.normalise({ lower: 1, upper: 99 }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true })
  const pixels = stretched.data
  const histogram = new Array(256).fill(0)
  for (const pixel of pixels) histogram[pixel]++
  const cutoff = otsuThreshold(histogram)
  for (let i = 0; i < pixels.length; i++) pixels[i] = pixels[i] > cutoff ? 255 : 0
  return sharp(pixels, { raw: { width: stretched.info.width, height: stretched.info.height, channels: 1 } }).png().toBuffer()
}

async function ocrImage(image) {
  let png
  try {
    png = await prepareForOcr(image)
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError("The image could not be read. Use a valid PNG, JPEG, TIFF, BMP, or WebP image.")
  }
  let text
  try {
    text = (await recognize(png)).trim()
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError("OCR could not read the image. Try a clearer photo.")
  }
  if (!text) throw new DocumentError("OCR found no readable text. Try a clearer image.")
  return checkTextSize(text)
}

async function extractImage(bytes) {
  let pages
  try {
    pages = (await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()).pages ?? 1
  } catch {
    // sharp can't decode BMP; Tesseract can read it as-is.
    return extractBmp(bytes)
  }
  if (!(pages >= 1 && pages <= MAX_PAGES)) throw new DocumentError("Use an image containing between 1 and 20 frames.")
  const parts = []
  for (let page = 0; page < pages; page++) {
    parts.push(await ocrImage(sharp(bytes, { page, limitInputPixels: MAX_IMAGE_PIXELS })))
    checkTextSize(parts.join("\n\n"))
  }
  return parts.join("\n\n")
}

// sharp can't decode BMP; Tesseract's image library reads it as-is.
async function extractBmp(bytes) {
  if (bytes.subarray(0, 2).toString("latin1") !== "BM") {
    throw new DocumentError("The image could not be read. Use a valid PNG, JPEG, TIFF, BMP, or WebP image.")
  }
  let text
  try {
    text = (await recognize(bytes)).trim()
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError("The image could not be read. Try a PNG or JPEG photo instead.")
  }
  if (!text) throw new DocumentError("OCR found no readable text. Try a clearer image.")
  return checkTextSize(text)
}

// A page's text in reading order: items grouped into lines by position, like
// pdfplumber's extract_text(layout=False).
async function pageText(page) {
  const { items } = await page.getTextContent()
  const pieces = items
    .filter((item) => typeof item.str === "string" && item.str.trim())
    .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, size: Math.abs(item.transform[3]) || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const piece of pieces) {
    const line = lines.at(-1)
    if (line && Math.abs(line.y - piece.y) <= Math.max(3, piece.size * 0.4)) line.pieces.push(piece)
    else lines.push({ y: piece.y, pieces: [piece] })
  }
  return lines
    .map(({ pieces: row }) => {
      row.sort((a, b) => a.x - b.x)
      let text = ""
      let end = null
      for (const piece of row) {
        if (end !== null && piece.x - end > 1.5) text += " "
        text += piece.text
        end = piece.x + piece.width
      }
      return text.replace(/[ \t]+/g, " ").trim()
    })
    .join("\n")
}

const needsOcr = (text) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length < 30

async function extractPdf(bytes) {
  let pdf
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch {
    throw new DocumentError("The PDF could not be read. Check that it is valid and not password-protected.")
  }
  try {
    if (!(pdf.numPages >= 1 && pdf.numPages <= MAX_PAGES)) throw new DocumentError("Use a PDF containing between 1 and 20 pages.")
    const parts = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      let text = (await pageText(page)).trim()
      if (needsOcr(text)) {
        const { width, height } = page.getViewport({ scale: PDF_RENDER_SCALE })
        if (width * height > MAX_IMAGE_PIXELS) throw new DocumentError("A PDF page is too large to render. Resize it before trying again.")
        let rendered
        try {
          rendered = await renderPageAsImage(pdf, number, { canvasImport: () => import("@napi-rs/canvas"), scale: PDF_RENDER_SCALE })
        } catch {
          throw new DocumentError("This scanned PDF could not be rendered. Try a photo of the pay stub instead.")
        }
        text = await ocrImage(sharp(Buffer.from(rendered)))
      }
      parts.push(text)
      checkTextSize(parts.join("\n\n"))
    }
    return parts.join("\n\n")
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError("The PDF could not be read. Check that it is valid and not password-protected.")
  } finally {
    await Promise.resolve(pdf.cleanup?.()).catch(() => {})
  }
}

// Extract an uploaded document in memory. Never saves the upload, OCR text, or rendered pages.
export async function extractBytes(bytes, suffix) {
  if (!Buffer.isBuffer(bytes) || !(bytes.length > 0 && bytes.length <= MAX_FILE_BYTES)) {
    throw new DocumentError("Use a nonempty document smaller than 30 MiB.")
  }
  suffix = String(suffix).toLowerCase()
  if (suffix !== ".pdf" && !IMAGE_SUFFIXES.has(suffix)) throw new DocumentError("Unsupported input. Use a PDF, PNG, JPEG, TIFF, BMP, or WebP file.")
  const text = suffix === ".pdf" ? await extractPdf(bytes) : await extractImage(bytes)
  if (!text.trim()) throw new DocumentError("No readable text was found. Try a clearer copy.")
  return checkTextSize(text)
}
