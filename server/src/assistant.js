// FairShift assistant: a Claude-powered chat that explains pay stubs, checks pay
// with the deterministic rules engine, and finds real help and jobs nearby via
// SerpApi. Replies stream to the browser as server-sent events.
//
// Conversations live on the server and are append-only: Claude Opus 5.5 ties its
// thinking blocks to the exact history that produced them, so the browser never
// resends or edits past turns.

import { randomUUID } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import express, { Router } from "express"
import { requireUser } from "./auth.js"
import { CATEGORIES, findHelp } from "./help.js"
import { comparePay } from "./jobs.js"
import { LANGUAGES, resolveLanguage } from "./languages.js"
import { checkPay } from "./payrules.js"

const MODEL = "claude-opus-5-5"
const EFFORT = { fast: "low", careful: "high" }
const MAX_TOOL_ROUNDS = 8
const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000
const MAX_TURNS = 40
const RATE_LIMIT = { messages: 40, windowMs: 15 * 60 * 1000 }
const PAYSTUB_TEXT_FIELDS = [
  "employer_name", "pay_period_start", "pay_period_end", "pay_date", "currency",
  "regular_hours", "regular_hourly_rate", "regular_pay", "overtime_hours", "overtime_hourly_rate",
  "overtime_pay", "tips", "gross_pay", "net_pay",
]

let client = null
const getClient = () => (client ??= new Anthropic())

const SYSTEM_PROMPT = `You are the FairShift assistant, inside an app that helps immigrant and limited-English workers in the United States make sure they are paid fairly. You help workers understand pay stubs, hours, overtime, minimum wage and tipped-worker pay, and what to do next.

STYLE
- Reply in the language named in the latest "Reply language" note, even if the worker writes in another. Use plain, everyday words, short sentences and a warm, respectful tone. Aim for a reading level a 12-year-old could follow. Avoid legal jargon; when you must use a term (for example "overtime" or "gross pay"), explain it in a few words.
- Keep replies short. Ask at most one question at a time. Use short lists when explaining several items.
- If the worker asks to use a different language (for example "speak Korean" or "en español"), or writes in a language other than the current reply language and seems to want it, call the set_language tool with the language name in English, then continue your reply in the new language.

PAY STUBS
- You never see the pay stub itself. When the worker has uploaded one, the app note includes the fields FairShift extracted from it after the worker removed personal details and approved the text. A null field means it could not be read, not that it was zero.
- Explain the fields in order, in plain words: pay period and pay date, regular hours and rate, overtime hours, rate and pay, tips, gross pay, each deduction (federal income tax, Social Security, Medicare, state or local tax, insurance and so on), and net pay. Mention any extraction warnings.
- Then point out anything worth checking, such as no overtime pay when hours exceed 40 in a week, an overtime rate below 1.5 times the regular rate, a rate below the minimum wage, deductions for uniforms, tools, breakage or cash shortages, or totals that don't add up. Say "worth checking" rather than accusing the employer, and remind the worker to compare with the original document.
- If no pay stub is in the note and the worker wants one explained, ask them to upload it with the camera button. It is read privately on FairShift's side, and they approve the text before anything is shared. Don't guess values that aren't in the fields.

MONEY MATH
- Don't calculate an underpayment yourself. When the worker gives enough information, call the check_pay tool. You need: whether they are paid hourly (hourly rate), whether they are a tipped worker (and the cash hourly wage and tips if so), hours worked in each workweek, and the gross amount paid for each week (before taxes). Ask for any missing piece one at a time. If the worker is paid a flat day or salary rate, ask how many hours they really worked and divide to get the hourly rate, and say you did so.
- Pass the state or city minimum wage in applicable_min_wage only if the worker tells you a figure higher than $7.25 or you are sure of it; otherwise leave it out, and tell them their state or city may require more than the federal amount, so they should confirm it.
- After the tool returns, explain the result in words. The app already shows a summary card, so don't repeat every number in a table; give the total and the one or two most important points.

FEDERAL RULES YOU CAN STATE (verified)
- Federal minimum wage is $7.25 per hour for most workers. Many states and cities set a higher minimum, and the higher one applies.
- Most workers must be paid at least 1.5 times their regular hourly rate for hours over 40 in one workweek. Each week is counted separately; you cannot average weeks together. Paying "straight time" for extra hours, or paying cash off the record, is not allowed.
- Tipped workers: an employer may pay a cash wage as low as $2.13 per hour only if tips bring the worker up to at least the full minimum wage; if not, the employer must make up the difference. Many states require a higher cash wage. Tipped workers still get overtime, based on the full minimum wage minus the tip credit.
- Employers generally may not take deductions that push pay below minimum wage, and may not keep workers' tips.
- Wage laws protect workers no matter their immigration status. Retaliation (threats, firing, reporting to immigration) for asking about pay is illegal. Don't ask about the worker's immigration status and don't give immigration advice; for that, refer them to a legal aid clinic or an accredited immigration attorney.
- Time limits apply to wage claims (federally often about two to three years), so tell the worker not to wait.
- Don't state any other specific legal figure, state rule or deadline from memory. If asked about something outside the list above, give the general idea, say rules differ by state and city, and point to the helplines below.

HELP RESOURCES
- U.S. Department of Labor Wage and Hour Division: 1-866-487-9243 (1-866-4-US-WAGE). Free and confidential, help in more than 200 languages, protects workers regardless of immigration status.
- For local worker centers, legal aid clinics, and the worker's consulate, call the find_help tool. Only name organizations that find_help returned; never invent names, addresses or phone numbers.
- If the worker describes threats, a boss holding their passport or documents, being unable to leave, or violence, take it seriously: give the National Human Trafficking Hotline, 1-888-373-7888 (free, 24 hours, many languages), and 911 if in immediate danger.

BUILDING EVIDENCE
- Encourage them to log every shift the same day in FairShift, keep photos of every pay stub, save texts or messages about schedules and pay, and note who worked with them. Explain that a record made at the time carries more weight.
- If they want a wage claim, offer to write a short, factual summary they can bring to the Labor Department or a worker center: employer name, dates, hours, rate, amounts paid, amount they believe is owed, and how it was calculated. Say clearly that you are drafting a summary, not filing anything, and that a worker center or legal aid can review it.

MODES AND CONTEXT
- Each worker message is followed by a short app note with the reply language, what the worker saved in their FairShift profile (job, city, hourly pay), and sometimes a MODE that sets the current task. Follow it, while keeping every other rule here. If the worker clearly changes the subject, help with the new subject.

FINDING HELP AND JOBS
- find_help returns real places from Google Maps near the worker: free legal aid, worker centers and their consulate, with phone numbers. The app shows them as cards the worker can call or get directions to. After calling it, briefly say which places look most useful (free or nonprofit help first, and any that mention the worker's language) and why. Don't read out every address or phone number; the cards have them.
- find_jobs returns real job posts near the worker and what similar jobs pay, compared with the worker's own hourly pay when known. The app shows a pay range card and the best-paying posts. Summarize in one or two sentences. Pay figures come from what employers posted; say they are typical posted pay, not a promise.
- Use the worker's saved city and job when they don't name others. If the city is missing, ask for a city or ZIP code before calling a tool. For the consulate, you need the worker's home country; ask for it if it is missing.
- When a worker is considering a job offer, mention these warning signs when relevant: asking for money to get the job, an application fee or a visa fee; no written statement of the pay rate; pay only in cash with no pay stub; vague pay such as "we'll see"; holding a passport or documents; pay below the minimum wage; a tipped job with no cash hourly wage. Suggest asking in writing how pay, overtime and tips work and keeping a copy.
- If a worker asks which employers hire without work authorization, don't point to specific employers; explain that wage laws protect all workers and refer them to a legal aid clinic for immigration questions.

LIMITS
- You are not a lawyer and this is general information, not legal advice. Say so briefly when giving conclusions, not in every message.
- Don't tell anyone to confront their employer or quit. Suggest the safest next step and let the worker decide.
- Never ask for or repeat Social Security numbers, bank account numbers, or passport numbers. If they appear in a photo, don't repeat them.`

const MODE_INSTRUCTIONS = {
  stub: "MODE: Pay stub. The worker wants a pay stub explained. If the app note has no pay stub fields, ask them in one short sentence to upload one with the camera button. When fields are present, explain every line, then list what is worth checking, then offer to check the pay with the check_pay tool.",
  pay: "MODE: Check my pay. Guide the worker step by step to collect what check_pay needs, one question at a time, starting with whether they are paid hourly and whether they receive tips. Then call check_pay and explain the result in words.",
  rights:
    "MODE: My rights. Explain wage rights in simple words with short examples. Cover whichever of minimum wage, overtime, tipped pay, deductions, retaliation and protection regardless of immigration status the worker asks about, and what to do if they are afraid to speak up (the confidential helpline, a worker center, legal aid). Offer to call find_help.",
  claim:
    "MODE: Build a claim. Interview the worker, one question at a time, for: employer name and address, job and dates, pay rate, hours worked each week, amounts paid, tips, deductions, how hours and pay were recorded, what evidence they have (pay stubs, messages, FairShift log), and whether they fear retaliation. Use check_pay for the amount. When you have enough, write a clear, factual summary in the worker's language, followed by a short English version for the agency. Say it is a summary to bring to the Labor Department or a worker center, not a filed claim; mention time limits; offer find_help.",
  offer:
    "MODE: Job offer check. Ask the worker to describe or paste the offer (pay, hours, overtime, tips, fees, how and when they will be paid). Look for the warning signs listed above, compare any stated hourly pay with the federal minimum wage (and say their state or city may require more), and give a short list of questions to ask the employer in writing. Offer find_jobs to see what similar jobs pay nearby.",
}

const TOOLS = [
  {
    name: "check_pay",
    description:
      "Deterministic wage calculator using federal minimum wage and overtime rules, including the tipped-worker cash wage and tip credit. Returns, for each workweek, what should have been paid, what was actually paid (gross, before taxes) and the shortfall in dollars, plus the total underpayment. Always use this instead of doing wage math yourself.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        tipped: { type: "boolean", description: "True if the worker is a tipped worker (server, bartender, delivery and similar)." },
        hourly_rate: { type: "number", description: "Hourly rate the employer pays. For tipped workers this is the cash hourly wage before tips." },
        applicable_min_wage: { type: "number", description: "Optional state or city minimum wage per hour, only if higher than 7.25 and known. Omit to use the federal 7.25." },
        weeks: {
          type: "array",
          description: "One entry per workweek (a fixed 7-day period).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Week label, such as 'Mar 3–9'." },
              hours_worked: { type: "number", description: "Total hours actually worked that week." },
              amount_paid_before_tax: { type: "number", description: "Gross dollars paid for that week, before taxes, not counting tips." },
              tips_received: { type: "number", description: "Tips received that week, if tipped worker." },
            },
            required: ["hours_worked", "amount_paid_before_tax"],
          },
        },
      },
      required: ["hourly_rate", "weeks"],
    },
  },
  {
    name: "set_language",
    description:
      "Switch the language of your replies (and the app's display language when the app supports it). Call this when the worker asks to use a different language, then continue your reply in that language. Pass the language name in English, such as Korean, Amharic or Portuguese.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { language: { type: "string", description: "Language name in English." } },
      required: ["language"],
    },
  },
  {
    name: "find_help",
    description:
      "Find real places near the worker on Google Maps: free legal aid and employment lawyers, worker centers, and the worker's consulate. Returns names, phone numbers, addresses, ratings, whether each looks free or nonprofit, and whether it mentions the worker's language. The app shows them as cards.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City, neighborhood or ZIP code. Omit to use the worker's saved city." },
        kinds: {
          type: "array",
          items: { type: "string", enum: CATEGORIES },
          description: "Which kinds of help to look for. Default: legal_aid and worker_center, plus consulate when consulate_country is known.",
        },
        consulate_country: { type: "string", description: "Worker's home country in English, for the consulate search." },
      },
    },
  },
  {
    name: "find_jobs",
    description:
      "Look up real job posts near the worker and what similar jobs pay (median and typical range per hour), compared with the worker's hourly pay when known. Returns the best-paying posts. The app shows a pay range card and job cards with apply links.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        job_type: { type: "string", description: "Kind of work in English, such as 'line cook', 'house cleaner', 'warehouse'. Omit to use the worker's saved job." },
        location: { type: "string", description: "City or ZIP code. Omit to use the worker's saved city." },
        hourly_wage: { type: "number", description: "The worker's current hourly pay, if known and different from what they saved." },
      },
    },
  },
]

// --- conversation store (in memory; swap for a database when backends merge) ---

const conversations = new Map()
const recentMessages = new Map()

function pruneConversations() {
  const cutoff = Date.now() - CONVERSATION_TTL_MS
  for (const [id, conversation] of conversations) {
    if (conversation.updatedAt < cutoff) conversations.delete(id)
  }
}

function rateLimited(userId) {
  const now = Date.now()
  const times = (recentMessages.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs)
  const limited = times.length >= RATE_LIMIT.messages
  if (!limited) times.push(now)
  recentMessages.set(userId, times)
  return limited
}

// A language name as Claude should read it: "Español" → "Spanish", "Korean" stays "Korean".
function languageName(input) {
  const requested = typeof input === "string" ? input.trim().slice(0, 40) : ""
  if (!requested) return "English"
  const known = resolveLanguage(requested)
  return known.code !== "en" || /^english$/i.test(requested) ? known.name : requested
}

// --- tool execution ---

class ToolInputError extends Error {}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value)
const optionalString = (value, name) => {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new ToolInputError(`${name} must be a string`)
  return value.trim().slice(0, 120) || undefined
}

function validateCheckPay(input) {
  if (!isNumber(input.hourly_rate)) throw new ToolInputError("hourly_rate must be a number")
  if (!Array.isArray(input.weeks) || input.weeks.length === 0) throw new ToolInputError("weeks must be a non-empty array")
  for (const week of input.weeks) {
    if (!isNumber(week?.hours_worked) || !isNumber(week?.amount_paid_before_tax)) {
      throw new ToolInputError("each week needs hours_worked and amount_paid_before_tax numbers")
    }
  }
  return input
}

const compactPlace = (place) => ({
  name: place.name,
  type: place.type,
  address: place.address,
  phone: place.phone,
  website: place.website,
  rating: place.rating,
  reviews: place.reviews,
  hours: place.hours,
  distance_miles: place.distanceMiles,
  likely_free_or_nonprofit: place.likelyFree,
  mentions_worker_language: place.mentionsLanguage,
})

const compactJob = (job) => ({
  title: job.title,
  company: job.company,
  location: job.location,
  pay: job.pay?.text ?? null,
  hourly_mid: job.pay?.hourly.mid ?? null,
  pays_more_per_hour: job.paysMoreBy,
  schedule: job.scheduleType,
})

// Runs one tool call. `emit` sends a card or app event to the browser.
async function runTool(name, input, { profile, replyLanguage, emit }) {
  switch (name) {
    case "check_pay": {
      const result = checkPay(validateCheckPay(input))
      emit({ type: "card", card: { kind: "pay_check", data: result } })
      return result
    }

    case "set_language": {
      const requested = optionalString(input.language, "language")
      if (!requested) throw new ToolInputError("language is required")
      const name = languageName(requested)
      const { code } = resolveLanguage(name)
      // The app UI only has these four languages; any other language changes replies only.
      const appLanguage = ["en", "es", "hi", "vi"].includes(code) && LANGUAGES[code].name === name ? LANGUAGES[code].native : null
      emit({ type: "language", language: name, appLanguage })
      return { ok: true, reply_language: name, app_display_switched: Boolean(appLanguage) }
    }

    case "find_help": {
      const location = optionalString(input.location, "location") ?? profile?.location
      if (!location) return { error: "No location known. Ask the worker for their city or ZIP code." }
      const country = optionalString(input.consulate_country, "consulate_country")
      let kinds = Array.isArray(input.kinds) ? input.kinds.filter((kind) => CATEGORIES.includes(kind)) : []
      if (kinds.length === 0) kinds = country ? CATEGORIES : ["legal_aid", "worker_center"]
      const language = resolveLanguage(replyLanguage)
      const consulateCountry = country ?? language.defaultCountry

      const lists = await Promise.all(
        kinds.map((category) => findHelp({ category, location, language, country: consulateCountry, limit: 4 })),
      )
      const results = Object.fromEntries(kinds.map((kind, i) => [kind, lists[i]]))
      emit({ type: "card", card: { kind: "help", data: { location, results } } })
      return {
        location,
        consulate_country_used: kinds.includes("consulate") ? consulateCountry ?? null : undefined,
        results: Object.fromEntries(kinds.map((kind, i) => [kind, lists[i].map(compactPlace)])),
      }
    }

    case "find_jobs": {
      const jobTitle = optionalString(input.job_type, "job_type") ?? profile?.occupation
      const location = optionalString(input.location, "location") ?? profile?.location
      if (!jobTitle || !location) return { error: "Need the kind of job and a city or ZIP code. Ask the worker for what is missing." }
      const hourlyWage = isNumber(input.hourly_wage) ? input.hourly_wage : (profile?.hourlyWage ?? NaN)
      const language = resolveLanguage(replyLanguage)

      const result = await comparePay({ jobTitle, location, hourlyWage, language, pages: 1 })
      const topJobs = (result.betterPaying.length ? result.betterPaying : result.jobs).slice(0, 5)
      emit({
        type: "card",
        card: { kind: "jobs", data: { jobTitle, location, stats: result.stats, comparison: result.comparison, jobs: topJobs } },
      })
      return {
        job: jobTitle,
        location,
        posts_found: result.jobs.length,
        hourly_pay_stats: result.stats,
        comparison_with_worker: result.comparison,
        top_posts: topJobs.map(compactJob),
      }
    }

    default:
      throw new ToolInputError(`Unknown tool ${name}`)
  }
}

// Keeps only the known extracted fields, as short strings, from the worker's approved
// pay stub. Anything else the browser sends is dropped.
function cleanPaystub(input) {
  if (!input || typeof input !== "object") return null
  const text = (value) => (typeof value === "string" || typeof value === "number" ? String(value).slice(0, 80) : null)
  const rows = (value, keys) =>
    Array.isArray(value)
      ? value.slice(0, 30).map((row) => Object.fromEntries(keys.map((key) => [key, text(row?.[key])])))
      : []
  const stub = Object.fromEntries(PAYSTUB_TEXT_FIELDS.map((key) => [key, text(input[key])]))
  stub.deductions = rows(input.deductions, ["label", "amount"])
  stub.other_earnings = rows(input.other_earnings, ["label", "amount", "hours", "hourly_rate"])
  stub.warnings = Array.isArray(input.warnings) ? input.warnings.slice(0, 10).map(text).filter(Boolean) : []
  return stub
}

// --- per-turn context note (sent as a mid-conversation system message) ---

function contextNote({ replyLanguage, profile, mode, paystub }) {
  const saved = []
  if (profile?.occupation) saved.push(`job: ${profile.occupation}`)
  if (profile?.location) saved.push(`city: ${profile.location}`)
  if (profile?.hourlyWage) saved.push(`hourly pay: $${profile.hourlyWage}`)
  return [
    `Reply language: ${replyLanguage}.`,
    saved.length ? `Saved in the worker's FairShift profile: ${saved.join("; ")}.` : "The worker has not saved a job or city yet.",
    paystub
      ? `Pay stub fields the worker approved (extracted from their upload, personal details removed): ${JSON.stringify(paystub)}`
      : "No pay stub has been uploaded in this session.",
    MODE_INSTRUCTIONS[mode] ?? "",
  ]
    .filter(Boolean)
    .join("\n")
}

const finalText = (content) => {
  // After a mid-stream fallback, only the blocks after the last fallback block are the answer.
  const lastFallback = content.map((block) => block.type).lastIndexOf("fallback")
  return content
    .slice(lastFallback + 1)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
}

// --- route ---

export const assistantRouter = Router()

// Chat bodies carry the approved pay stub fields, a little over the global limit.
assistantRouter.use("/assistant", express.json({ limit: "100kb" }))

assistantRouter.get("/assistant/status", requireUser, (_req, res) => {
  res.json({ configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), model: MODEL })
})

// POST /api/assistant/chat
// { conversationId?, message, paystub?, mode?, replyLanguage?, speed?: "fast" | "careful" }
assistantRouter.post("/assistant/chat", requireUser, async (req, res) => {
  const body = req.body ?? {}
  const text = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : ""
  if (!text) return res.status(400).json({ error: "Write a message first." })
  const paystub = cleanPaystub(body.paystub)
  if (rateLimited(req.user.id)) {
    return res.status(429).json({ error: "You've sent a lot of messages. Wait a few minutes and try again." })
  }

  pruneConversations()
  let conversation = conversations.get(body.conversationId)
  if (!conversation || conversation.userId !== req.user.id) {
    conversation = { id: randomUUID(), userId: req.user.id, messages: [], updatedAt: Date.now() }
    conversations.set(conversation.id, conversation)
  }
  // One system note is added per turn, so this counts turns.
  if (conversation.messages.filter((m) => m.role === "system").length >= MAX_TURNS) {
    return res.status(400).json({ error: "This chat is very long. Start a new chat to keep going." })
  }
  if (conversation.busy) {
    return res.status(409).json({ error: "Wait for the current answer to finish." })
  }
  conversation.busy = true

  const profile = req.user.profile
  const replyLanguage = languageName(body.replyLanguage || profile?.language)
  const effort = EFFORT[body.speed] ?? EFFORT.fast

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })
  const emit = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  emit({ type: "conversation", id: conversation.id })

  const controller = new AbortController()
  res.on("close", () => controller.abort())

  // This turn's messages are kept apart and saved to the conversation only when
  // the turn completes, so stored history only ever grows by whole turns.
  const turn = [
    { role: "user", content: [{ type: "text", text }] },
    { role: "system", content: contextNote({ replyLanguage, profile, mode: body.mode, paystub }) },
  ]

  let committed = ""
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (controller.signal.aborted) throw new Error("aborted")
      const stream = getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort },
          cache_control: { type: "ephemeral" },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: [...conversation.messages, ...turn],
        },
        { signal: controller.signal },
      )

      let roundText = ""
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "fallback") {
          roundText = "" // a backup model took over; drop the declined partial
          emit({ type: "text", text: committed })
        }
      })
      stream.on("text", (delta) => {
        roundText += delta
        emit({ type: "text", text: committed + roundText })
      })

      let message
      try {
        message = await stream.finalMessage()
      } catch (error) {
        // With eager input streaming a tool input can arrive unparseable; re-issue the round once or twice.
        if (error instanceof Anthropic.APIError || controller.signal.aborted || round >= 2) throw error
        continue
      }

      if (message.stop_reason === "refusal") {
        throw Object.assign(new Error("refusal"), { code: "refusal" })
      }

      const answer = finalText(message.content)
      committed = [committed, answer].filter(Boolean).join("\n\n")
      emit({ type: "text", text: committed })
      turn.push({ role: "assistant", content: message.content })

      const toolCalls = message.content.filter((block) => block.type === "tool_use")
      if (message.stop_reason !== "tool_use" || toolCalls.length === 0) {
        if (message.stop_reason === "max_tokens" && toolCalls.length) throw new Error("tool input truncated")
        conversation.messages.push(...turn)
        conversation.updatedAt = Date.now()
        emit({ type: "done" })
        return res.end()
      }

      const results = await Promise.all(
        toolCalls.map(async (call) => {
          try {
            const output = await runTool(call.name, call.input ?? {}, { profile, replyLanguage, emit })
            return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output) }
          } catch (error) {
            const known = error instanceof ToolInputError
            if (!known) console.error(`Tool ${call.name} failed:`, error)
            return {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content: known ? `Invalid input: ${error.message}` : "The lookup failed. Tell the worker it didn't work and offer to try again.",
            }
          }
        }),
      )
      turn.push({ role: "user", content: results })
    }
    throw new Error("Too many tool rounds")
  } catch (error) {
    if (controller.signal.aborted) return res.end()

    let code = "error"
    if (error.code === "refusal") code = "refusal"
    else if (error instanceof Anthropic.AuthenticationError) code = "not_configured"
    else if (error instanceof Anthropic.RateLimitError) code = "rate_limited"
    else if (error instanceof Anthropic.APIError && error.status >= 500) code = "unavailable"
    if (code === "error" || code === "not_configured") console.error("Assistant error:", error)
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) code = "not_configured"
    emit({ type: "error", code })
    res.end()
  } finally {
    conversation.busy = false
  }
})
