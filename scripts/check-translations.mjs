// Usage: node scripts/check-translations.mjs
// Finds every literal t("...") or tk("...") in src/ and reports keys missing from any locale file.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const used = new Set()
for (const file of walk("src").filter((f) => /\.tsx?$/.test(f) && !f.includes("locales"))) {
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(/\btk?\(\s*("(?:[^"\\]|\\.)*")/g)) used.add(JSON.parse(match[1]))
}

let failed = false
for (const code of ["es", "zh", "vi", "tl", "ar", "fr", "ko", "ru", "ht", "hi", "pt", "bn", "ur", "pl", "it", "de", "ja"]) {
  const text = readFileSync(`src/locales/${code}.ts`, "utf8")
  const keys = new Set([...text.matchAll(/^\s*("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])))
  const missing = [...used].filter((key) => !keys.has(key))
  if (missing.length) {
    failed = true
    console.log(`\n${code}: ${missing.length} missing`)
    missing.forEach((key) => console.log("  -", key))
  } else {
    console.log(`${code}: all ${used.size} literal keys translated`)
  }
}
process.exit(failed ? 1 : 0)
