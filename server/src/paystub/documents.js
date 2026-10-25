// Read a pay stub's text on the server, in memory. No temporary files.
// Port of fairshift_paystub/documents.py: text PDFs are read directly, photos and
// scanned PDF pages go through OCR. Tesseract runs as WebAssembly (tesseract.js)
// with the English data shipped in node_modules, so it runs on Vercel too.

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { createWorker } from "tesseract.js"
import { getDocumentProxy, renderPageAsImage } from "unpdf"
import { DocumentError } from "./errors.js"

export const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_PAGES = 20
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_TEXT_CHARACTERS = 200_000
const OCR_TIMEOUT_MS = 60_000
const OCR_UPSCALE_MAX = 3
// Small photos are enlarged until their long side reaches this; larger ones are left alone.
const OCR_TARGET_LONG_SIDE = 3000
const PDF_RENDER_SCALE = 300 / 72
const IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"])

const require = createRequire(import.meta.url)

// tesseract.js starts its engine from a separate worker file, and that worker
// loads the WebAssembly engine and the language data by paths built at run time.
// Deployment bundlers (Vercel's file tracing) can't see those, so every file is
// named here with require.resolve, which they do follow. All three engine builds
// are listed because the worker picks one by the CPU's WebAssembly features.
const OCR_FILES = {
  worker: require.resolve("tesseract.js/src/worker-script/node/index.js"),
  engines: [
    require.resolve("tesseract.js-core/tesseract-core-relaxedsimd-lstm.js"),
    require.resolve("tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm"),
    require.resolve("tesseract.js-core/tesseract-core-simd-lstm.js"),
    require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm"),
    require.resolve("tesseract.js-core/tesseract-core-lstm.js"),
    require.resolve("tesseract.js-core/tesseract-core-lstm.wasm"),
  ],
  english: require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
}
const missingOcrFiles = () => [OCR_FILES.worker, ...OCR_FILES.engines, OCR_FILES.english].filter((file) => !existsSync(file))
// If the bundled English data is missing anyway, tesseract.js downloads the same
// file once into /tmp (the only writable place in a serverless function).
const LANGUAGE_OPTIONS = existsSync(OCR_FILES.english)
  ? { langPath: path.dirname(OCR_FILES.english), gzip: true, cacheMethod: "none" }
  : { cachePath: path.join(os.tmpdir(), "fairshift-tesseract") }

function checkTextSize(text) {
  if (text.length > MAX_TEXT_CHARACTERS) throw new DocumentError("The extracted text is too large. Use a shorter paystub.")
  return text
}

// One OCR worker per warm server instance; recreated if a job fails or times out.
// tesseract.js doesn't surface a worker that fails to start in Node (it would
// just wait), so the worker file is checked first.
let workerPromise = null
function ocrWorker() {
  workerPromise ??= (async () => {
    if (!existsSync(OCR_FILES.worker)) throw new DocumentError("The OCR engine is missing from this server. Try a PDF instead.")
    const worker = await createWorker("eng", 1, { ...LANGUAGE_OPTIONS, workerPath: OCR_FILES.worker })
    await worker.setParameters({ tessedit_pageseg_mode: "3", user_defined_dpi: "300" })
    return worker
  })()
  workerPromise.catch(() => {
    workerPromise = null
  })
  return workerPromise
}
// Stops the OCR worker thread so a script or test process can exit.
export const closeOcr = () => resetWorker()

// For GET /api/health/ocr: which OCR files this server has, and how long the
// engine takes to start and read a small blank page. No document is involved.
export async function ocrSelfTest() {
  const missing = missingOcrFiles().map((file) => path.relative(process.cwd(), file))
  const started = Date.now()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("OCR engine did not start within 25 s")), 25_000)
  })
  try {
    const worker = await Promise.race([ocrWorker(), timeout])
    const ready = Date.now()
    const blank = await sharp({ create: { width: 400, height: 120, channels: 3, background: "#ffffff" } }).png().toBuffer()
    await Promise.race([worker.recognize(blank), timeout])
    return { ok: true, missing, languageDataBundled: LANGUAGE_OPTIONS.langPath !== undefined, startMs: ready - started, readMs: Date.now() - ready }
  } catch (error) {
    await resetWorker()
    return { ok: false, missing, error: error.message, afterMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

async function resetWorker() {
  const pending = workerPromise
  workerPromise = null
  await pending?.then((worker) => worker.terminate()).catch(() => {})
}

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
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DocumentError("OCR timed out. Try a smaller, clearer image.")), OCR_TIMEOUT_MS)
    })
    // Starting the OCR engine is inside the time limit too, so a stalled start fails fast.
    const { data } = await Promise.race([ocrWorker().then((worker) => worker.recognize(png)), timeout])
    const text = data.text.trim()
    if (!text) throw new DocumentError("OCR found no readable text. Try a clearer image.")
    return checkTextSize(text)
  } catch (error) {
    await resetWorker()
    if (error instanceof DocumentError) throw error
    throw new DocumentError("OCR could not read the image. Try a clearer photo.")
  } finally {
    clearTimeout(timer)
  }
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

async function extractBmp(bytes) {
  if (bytes.subarray(0, 2).toString("latin1") !== "BM") {
    throw new DocumentError("The image could not be read. Use a valid PNG, JPEG, TIFF, BMP, or WebP image.")
  }
  try {
    const worker = await ocrWorker()
    const text = (await worker.recognize(bytes)).data.text.trim()
    if (!text) throw new DocumentError("OCR found no readable text. Try a clearer image.")
    return checkTextSize(text)
  } catch (error) {
    await resetWorker()
    if (error instanceof DocumentError) throw error
    throw new DocumentError("The image could not be read. Try a PNG or JPEG photo instead.")
  }
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
