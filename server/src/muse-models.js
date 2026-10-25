// Which Muse models to ask, in order. Muse sometimes answers "404 model_not_found"
// for a model it lists as available (most requests failed that way for
// muse-spark-1.3 while its siblings answered every time), so a 404 moves on to
// the next model instead of failing the request.
// Override with MUSE_MODEL and MUSE_FALLBACK_MODELS (comma-separated).

const DEFAULT_MODEL = "muse-spark-1.3"
const DEFAULT_FALLBACKS = "muse-spark-1.3-contributor,muse-spark-1.2"

export function museModels() {
  const primary = process.env.MUSE_MODEL || DEFAULT_MODEL
  const fallbacks = (process.env.MUSE_FALLBACK_MODELS ?? DEFAULT_FALLBACKS).split(",").map((name) => name.trim()).filter(Boolean)
  return [...new Set([primary, ...fallbacks])]
}
