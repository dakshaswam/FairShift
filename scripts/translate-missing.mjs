// Usage: node --env-file=.env scripts/translate-missing.mjs [es fr ...]
// Fills keys that scripts/check-translations.mjs reports as missing, using Muse
// (MUSE_API_KEY). New lines are added under a "machine-translated" comment in each
// src/locales/xx.ts so a native speaker knows what to review.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const LANGUAGES = {
  es: "Spanish", zh: "Simplified Chinese", vi: "Vietnamese", tl: "Tagalog", ar: "Arabic",
  fr: "French", ko: "Korean", ru: "Russian", ht: "Haitian Creole", hi: "Hindi",
  pt: "Portuguese (Brazil)", bn: "Bengali", ur: "Urdu", pl: "Polish", it: "Italian",
  de: "German", ja: "Japanese",
}
const KEY = process.env.MUSE_API_KEY
const MODEL = process.env.MUSE_MODEL || "muse-spark-1.3"
if (!KEY) {
  console.error("Set MUSE_API_KEY (for example: node --env-file=.env scripts/translate-missing.mjs)")
  process.exit(1)
}

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

async function translate(language, texts) {
  const response = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      max_tokens: 32000,
      messages: [
        {
          role: "system",
          content: `Translate user-interface text for FairShift, an app that helps immigrant and limited-English workers in the United States check their pay. Translate into ${language}.
- Use plain, everyday words a person with limited schooling understands, and a warm, respectful tone. Keep button labels short.
- Keep every {placeholder} exactly as written, for example {name} or {amount}. Keep $ amounts, numbers, phone numbers, "→", "·", "×", emoji and the names FairShift, Muse, Google, CareerOneStop and Indeed unchanged.
- "Pay stub" means a printed or digital payslip. "Overtime" means hours over 40 in a week.
- Return one translation for every item, using its index.`,
        },
        { role: "user", content: JSON.stringify(texts.map((text, i) => ({ i, text }))) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: { i: { type: "integer" }, text: { type: "string" } },
                  required: ["i", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`Muse HTTP ${response.status}`)
  const content = (await response.json()).choices?.[0]?.message?.content
  const out = new Map()
  for (const { i, text } of JSON.parse(content).items) {
    const source = texts[i]
    if (source === undefined || typeof text !== "string" || !text.trim()) continue
    // Placeholders must survive translation exactly, or the UI would show raw braces.
    const want = (source.match(/\{\w+\}/g) ?? []).sort().join()
    const got = (text.match(/\{\w+\}/g) ?? []).sort().join()
    if (want === got) out.set(source, text)
  }
  return out
}

const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LANGUAGES)
let failures = 0
await Promise.all(
  codes.map(async (code) => {
    const path = `src/locales/${code}.ts`
    let text = readFileSync(path, "utf8")
    const keys = new Set([...text.matchAll(/^\s*("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])))
    const missing = [...used].filter((key) => !keys.has(key))
    if (!missing.length) return console.log(`${code}: nothing missing`)
    try {
      const done = await translate(LANGUAGES[code], missing)
      const lines = missing.filter((key) => done.has(key)).map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(done.get(key))},`)
      const block = `  // Machine-translated with Muse; have a native speaker review.\n${lines.join("\n")}\n`
      const end = text.lastIndexOf("}\n\nexport default")
      text = text.slice(0, end) + block + text.slice(end)
      writeFileSync(path, text)
      console.log(`${code}: added ${lines.length} of ${missing.length}`)
      if (lines.length < missing.length) failures++
    } catch (error) {
      failures++
      console.log(`${code}: failed (${error.message})`)
    }
  }),
)
process.exit(failures ? 1 : 0)
