// FairShift assistant: a chat on Meta's Muse model that explains pay stubs, checks
// pay with the deterministic rules engine, and finds real help and jobs nearby via
// SerpApi. Replies stream to the browser as server-sent events.
//
// Muse is called through Meta's OpenAI-compatible Chat Completions API. History
// lives on the server and only grows by whole turns; the browser never resends it.

import { randomUUID } from "node:crypto"
import express, { Router } from "express"
import { requireUser } from "./auth.js"
import { museModels } from "./muse-models.js"
import { CATEGORIES, findHelp } from "./help.js"
import { comparePay } from "./jobs.js"
import { detectMessageLanguage, looksLikeWrongLanguage } from "./language-detect.js"
import { LANGUAGES, resolveLanguage } from "./languages.js"
import { checkPay } from "./payrules.js"

const MUSE_URL = "https://api.meta.ai/v1/chat/completions"
const model = () => museModels()[0]
// Muse reasons before it answers; "Fast" keeps that short, "Careful" lets it think more.
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

const SYSTEM_PROMPT = `You are the FairShift assistant, inside an app that helps immigrant and limited-English workers in the United States make sure they are paid fairly. You help workers understand pay stubs, hours, overtime, minimum wage and tipped-worker pay, and what to do next.

STYLE
- Write every reply entirely in the reply language named in the latest app note, in that language's own writing system (Devanagari for Hindi, Hangul for Korean, Arabic script for Arabic and Urdu, and so on). Many workers read little or no English, so never answer in English unless the reply language is English, never write a language in Latin letters (no romanized Hindi), and don't mix in English words. The only exceptions are names of places and organizations, dollar amounts and phone numbers. Don't announce or explain which language you are using; just answer.
- Use plain, everyday words, short sentences and a warm, respectful tone. Aim for a reading level a 12-year-old could follow. Avoid legal jargon; when you must use a term (for example "overtime" or "gross pay"), explain it in a few words of the reply language.
- Keep replies short. Ask at most one question at a time. Use short lists when explaining several items.
- If the worker asks to use a different language (for example "speak Korean" or "en español"), or writes in a language other than the reply language that isn't English, call the set_language tool with the language name in English, then write your whole reply in that language.

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
  stub: "MODE: Pay stub. The worker wants a pay stub explained. If the app note has no pay stub fields, ask them in one short sentence to tap the camera button to upload one. When fields are present, explain every line, then list what is worth checking (compare the hourly rate with their saved hourly pay if both are known), then offer to check the pay with the check_pay tool.",
  pay: "MODE: Check my pay. Guide the worker step by step to collect what check_pay needs, one question at a time, starting with whether they are paid hourly and whether they receive tips. Use the pay stub fields and saved hourly pay when present instead of asking again. Then call check_pay and explain the result in words. If money is owed, offer to build a wage claim.",
  rights:
    "MODE: My rights. Explain wage rights in simple words with short examples. Cover whichever of minimum wage, overtime, tipped pay, deductions, retaliation and protection regardless of immigration status the worker asks about, and what to do if they are afraid to speak up (the confidential helpline, a worker center, legal aid). Offer to call find_help.",
  claim:
    "MODE: Build a claim. Help the worker prepare a wage claim to file with their state labor office or the U.S. Department of Labor. Interview them one short question at a time, in this order, skipping anything already known from the profile, the pay stub fields or earlier answers: (1) the employer's business name, address and phone, and the owner or manager's name; (2) their job title, start date, and last day worked or whether they still work there; (3) how they are paid (hourly, salary, by the day, by the piece, tips), the rate, and whether by check, cash, direct deposit or an app; (4) usual days per week and hours per day; (5) what pay is missing and for which dates (unpaid hours, overtime, pay below minimum wage, tips kept by the employer, deductions, final paycheck); (6) hours worked and gross amount paid in each affected week, then call check_pay; (7) what evidence they have; (8) whether any of this money was paid another way (insurance, workers' compensation, unemployment); (9) whether they fear retaliation. Never ask for the worker's own name, address, phone, Social Security number, bank details, passport or immigration status: those are written on the form by hand. Accept 'I don't know' and move on. When you know at least the employer, the job and what is owed, call prepare_wage_claim. Then, in a few short sentences: ask them to check every line, write their name and contact details in the blank spaces, sign and date it, and bring it with copies of their evidence to their state labor office, the U.S. Department of Labor Wage and Hour Division (1-866-487-9243), or a worker center that can review it first. Say claims have time limits, so they shouldn't wait, and offer find_help.",
  offer:
    "MODE: Job offer check. Ask the worker to describe or paste the offer (pay, hours, overtime, tips, fees, how and when they will be paid). Look for the warning signs listed above, compare any stated hourly pay with the federal minimum wage (and say their state or city may require more), and give a short list of questions to ask the employer in writing. Offer find_jobs to see what similar jobs pay nearby.",
}

const TOOLS = [
  {
    name: "check_pay",
    description:
      "Deterministic wage calculator using federal minimum wage and overtime rules, including the tipped-worker cash wage and tip credit. Returns, for each workweek, what should have been paid, what was actually paid (gross, before taxes) and the shortfall in dollars, plus the total underpayment. Always use this instead of doing wage math yourself.",
    parameters: {
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
    parameters: {
      type: "object",
      properties: { language: { type: "string", description: "Language name in English." } },
      required: ["language"],
    },
  },
  {
    name: "find_help",
    description:
      "Find real places near the worker on Google Maps: free legal aid and employment lawyers, worker centers, and the worker's consulate. Returns names, phone numbers, addresses, ratings, whether each looks free or nonprofit, and whether it mentions the worker's language. The app shows them as cards.",
    parameters: {
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
    parameters: {
      type: "object",
      properties: {
        job_type: { type: "string", description: "Kind of work in English, such as 'line cook', 'house cleaner', 'warehouse'. Omit to use the worker's saved job." },
        location: { type: "string", description: "City or ZIP code. Omit to use the worker's saved city." },
        hourly_wage: { type: "number", description: "The worker's current hourly pay, if known and different from what they saved." },
      },
    },
  },
  {
    name: "prepare_wage_claim",
    description:
      "Fill in a printable wage claim form from what the worker told you. The app shows it as a form the worker can check, print, sign and bring to their state labor office, the U.S. Department of Labor or a worker center. Leave out anything you don't know; never include the worker's own name, address, phone, Social Security number, bank details or immigration status (they write those by hand). Free-text fields in the worker's language, except what_happened_english.",
    parameters: {
      type: "object",
      properties: {
        employer: {
          type: "object",
          properties: {
            name: { type: "string" }, address: { type: "string" }, phone: { type: "string" },
            manager: { type: "string", description: "Owner or manager's name." },
            business_type: { type: "string", description: "For example restaurant, construction, cleaning." },
          },
        },
        job: {
          type: "object",
          properties: {
            title: { type: "string" },
            start_date: { type: "string", description: "YYYY-MM-DD if known, else as the worker said it." },
            last_day: { type: "string", description: "Last day worked, if they no longer work there." },
            still_working: { type: "boolean" },
            pay_type: { type: "string", enum: ["hourly", "salary", "daily", "piece", "tips", "other"] },
            pay_rate: { type: "string", description: "For example '$15.00 per hour' or '$120 per day'." },
            paid_by: { type: "string", enum: ["check", "cash", "direct_deposit", "app", "other"] },
            days_per_week: { type: "number" },
            hours_per_day: { type: "number" },
          },
        },
        period: {
          type: "object",
          description: "Dates the unpaid wages cover.",
          properties: { from: { type: "string" }, to: { type: "string" } },
        },
        wages_owed: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["unpaid_wages", "overtime", "minimum_wage", "tips", "deductions", "final_pay", "other"] },
              description: { type: "string" },
              amount: { type: "number", description: "Dollars owed; use check_pay results." },
            },
            required: ["type", "amount"],
          },
        },
        total_owed: { type: "number" },
        what_happened: { type: "string", description: "Short factual account in the worker's language." },
        what_happened_english: { type: "string", description: "The same account in English, for the agency." },
        evidence: { type: "array", items: { type: "string" }, description: "Pay stubs, FairShift shift log, messages, witnesses." },
        other_payments: { type: "string", description: "Any of this money paid another way (insurance, workers' compensation, unemployment)." },
        retaliation_concern: { type: "boolean" },
        retaliation_details: { type: "string" },
      },
      required: ["wages_owed"],
    },
  },
].map((spec) => ({ type: "function", function: spec }))

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

// A language name as the model should read it: "Español" → "Spanish", "Korean" stays "Korean".
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
async function runTool(name, input, { profile, replyLanguage, emit, onLanguage }) {
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
      // Every language in LANGUAGES is also in the app's language picker, under its
      // native name; any other language changes the replies only.
      const appLanguage = LANGUAGES[code]?.name === name ? LANGUAGES[code].native : null
      emit({ type: "language", language: name, appLanguage })
      onLanguage?.(name)
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

    case "prepare_wage_claim": {
      const claim = cleanClaim(input)
      if (!claim.wages_owed.length) throw new ToolInputError("wages_owed needs at least one amount")
      emit({ type: "card", card: { kind: "wage_claim", data: { ...claim, language: replyLanguage } } })
      return { shown: true, note: "The form is on screen. Tell the worker to check it, fill in the blanks by hand, sign it and where to bring it." }
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

// Keeps only the claim fields the form shows, as short strings and numbers.
const WAGE_TYPES = ["unpaid_wages", "overtime", "minimum_wage", "tips", "deductions", "final_pay", "other"]
// Models sometimes send "Overtime" or a type in the worker's language; read it
// from the type or the description rather than dropping it to "other".
const WAGE_TYPE_HINTS = [
  ["overtime", /overtime|over_time|extra|sobretiempo|ओवरटाइम|초과|加班/i],
  ["minimum_wage", /minimum|mínimo|minimo/i],
  ["tips", /tip|propina|gorjeta/i],
  ["deductions", /deduct|descuento|dedução/i],
  ["final_pay", /final|last_?pay|último/i],
  ["unpaid_wages", /unpaid|no pagad|not paid|wages/i],
]
function wageType(type, description) {
  const key = String(type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (WAGE_TYPES.includes(key) && key !== "other") return key
  const hint = `${key} ${description ?? ""}`
  return WAGE_TYPE_HINTS.find(([, pattern]) => pattern.test(hint))?.[0] ?? "other"
}

function cleanClaim(input) {
  const text = (value, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "")
  const number = (value) => (isNumber(value) && value >= 0 && value < 10_000_000 ? Math.round(value * 100) / 100 : null)
  const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, text(object?.[key])]))
  const job = input.job ?? {}
  const wages = (Array.isArray(input.wages_owed) ? input.wages_owed : [])
    .slice(0, 20)
    .map((row) => ({
      type: wageType(row?.type, row?.description),
      description: text(row?.description),
      amount: number(row?.amount),
    }))
    .filter((row) => row.amount !== null)
  return {
    employer: pick(input.employer, ["name", "address", "phone", "manager", "business_type"]),
    job: {
      ...pick(job, ["title", "start_date", "last_day", "pay_type", "pay_rate", "paid_by"]),
      still_working: job.still_working === true,
      days_per_week: number(job.days_per_week),
      hours_per_day: number(job.hours_per_day),
    },
    period: pick(input.period, ["from", "to"]),
    wages_owed: wages,
    total_owed: number(input.total_owed) ?? Math.round(wages.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    what_happened: text(input.what_happened, 2000),
    what_happened_english: text(input.what_happened_english, 2000),
    evidence: (Array.isArray(input.evidence) ? input.evidence : []).slice(0, 15).map((item) => text(item)).filter(Boolean),
    other_payments: text(input.other_payments, 600),
    retaliation_concern: input.retaliation_concern === true,
    retaliation_details: text(input.retaliation_details, 600),
  }
}

// --- per-turn context note (sent as a mid-conversation system message) ---

function contextNote({ replyLanguage, profile, mode, paystub }) {
  const known = resolveLanguage(replyLanguage)
  const native = known.name === replyLanguage && known.native !== replyLanguage ? known.native : null
  const saved = []
  if (profile?.occupation) saved.push(`job: ${profile.occupation}`)
  if (profile?.location) saved.push(`city: ${profile.location}`)
  if (profile?.hourlyWage) saved.push(`hourly pay: $${profile.hourlyWage}`)
  return [
    `Reply language: ${replyLanguage}${native ? ` (${native})` : ""}. Write your whole reply in ${replyLanguage}, in its own script. No English.`,
    saved.length ? `Saved in the worker's FairShift profile: ${saved.join("; ")}.` : "The worker has not saved a job or city yet.",
    paystub
      ? `Pay stub fields the worker approved (extracted from their upload, personal details removed): ${JSON.stringify(paystub)}`
      : "No pay stub has been uploaded in this session.",
    MODE_INSTRUCTIONS[mode] ?? "",
  ]
    .filter(Boolean)
    .join("\n")
}

// --- Muse streaming client ---

class MuseError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Streams one Chat Completions response. Calls onText with the text so far and
// resolves with the assembled assistant message and finish reason.
async function streamMuse({ messages, effort, signal, onText }) {
  let response
  // A "model not found" reply tries the next model (see muse-models.js).
  for (const name of museModels()) {
    response = await fetch(MUSE_URL, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${process.env.MUSE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: name,
        stream: true,
        reasoning_effort: effort,
        max_tokens: 16000,
        tools: TOOLS,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
    })
    if (response.status !== 404) break
    await response.body?.cancel()
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "")
    throw new MuseError(response.status, `Muse request failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  let content = ""
  let refusal = ""
  let finishReason = null
  const toolCalls = []
  let buffer = ""
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue
      const choice = JSON.parse(line.slice(6)).choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}
      if (delta.content) {
        content += delta.content
        onText(content)
      }
      if (delta.refusal) refusal += delta.refusal
      for (const call of delta.tool_calls ?? []) {
        const slot = (toolCalls[call.index ?? 0] ??= { id: "", type: "function", function: { name: "", arguments: "" } })
        if (call.id) slot.id = call.id
        if (call.function?.name) slot.function.name += call.function.name
        if (call.function?.arguments) slot.function.arguments += call.function.arguments
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }
  }

  const message = { role: "assistant", content: content || null }
  if (toolCalls.length) message.tool_calls = toolCalls.filter(Boolean)
  return { message, finishReason, refusal }
}

function parseArguments(call) {
  try {
    const input = JSON.parse(call.function.arguments || "{}")
    if (input && typeof input === "object" && !Array.isArray(input)) return input
  } catch {
    // Fall through to the error below.
  }
  throw new ToolInputError("arguments were not a JSON object")
}

// --- route ---

export const assistantRouter = Router()

// Chat bodies carry the approved pay stub fields, a little over the global limit.
assistantRouter.use("/assistant", express.json({ limit: "100kb" }))

assistantRouter.get("/assistant/status", requireUser, (_req, res) => {
  res.json({ configured: Boolean(process.env.MUSE_API_KEY), model: model() })
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
  // The worker's language is the one they chose (at sign-up or in the picker). If
  // their message is clearly written in another language's script, follow that.
  let replyLanguage = languageName(body.replyLanguage || profile?.language)
  const chosen = resolveLanguage(replyLanguage)
  const detected = detectMessageLanguage(text, chosen.code)
  const switched = detected && detected !== chosen.code && LANGUAGES[detected]
  if (switched) replyLanguage = switched.name
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
  if (switched) emit({ type: "language", language: switched.name, appLanguage: switched.native })

  const controller = new AbortController()
  res.on("close", () => controller.abort())

  // This turn's messages are kept apart and saved to the conversation only when
  // the turn completes, so stored history only ever grows by whole turns.
  const turn = [
    { role: "user", content: text },
    { role: "system", content: contextNote({ replyLanguage, profile, mode: body.mode, paystub }) },
  ]

  let committed = ""
  let rewrites = 0
  try {
    if (!process.env.MUSE_API_KEY) throw new MuseError(401, "MUSE_API_KEY is not set")
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (controller.signal.aborted) throw new Error("aborted")
      const { message, finishReason, refusal } = await streamMuse({
        messages: [...conversation.messages, ...turn],
        effort,
        signal: controller.signal,
        onText: (soFar) => emit({ type: "text", text: [committed, soFar].filter(Boolean).join("\n\n") }),
      })

      if (refusal && !message.content && !message.tool_calls) {
        throw Object.assign(new Error("refusal"), { code: "refusal" })
      }
      const before = committed
      if (message.content) {
        committed = [committed, message.content].filter(Boolean).join("\n\n")
        emit({ type: "text", text: committed })
      }
      turn.push(message)

      const toolCalls = message.tool_calls ?? []
      // A final answer in the wrong language (usually English) is rewritten once.
      const code = resolveLanguage(replyLanguage).code
      if (toolCalls.length === 0 && rewrites === 0 && looksLikeWrongLanguage(message.content, code)) {
        rewrites++
        committed = before
        emit({ type: "text", text: committed })
        turn.push({
          role: "system",
          content: `Your last reply was not written in ${replyLanguage}. Rewrite the same answer completely in ${replyLanguage}, in its own script, with no English. Don't mention the rewrite.`,
        })
        continue
      }
      if (toolCalls.length === 0) {
        if (finishReason === "length" && !message.content) throw new Error("Muse ran out of tokens")
        conversation.messages.push(...turn)
        conversation.updatedAt = Date.now()
        emit({ type: "done" })
        return res.end()
      }
      if (finishReason === "length") throw new Error("tool call truncated")

      // Each tool call gets its own "tool" message, in the order they were made.
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          try {
            const output = await runTool(call.function.name, parseArguments(call), {
              profile,
              replyLanguage,
              emit,
              onLanguage: (name) => (replyLanguage = name),
            })
            return { role: "tool", tool_call_id: call.id, content: JSON.stringify(output) }
          } catch (error) {
            const known = error instanceof ToolInputError
            if (!known) console.error(`Tool ${call.function.name} failed:`, error)
            return {
              role: "tool",
              tool_call_id: call.id,
              content: known ? `Error: invalid input: ${error.message}` : "Error: the lookup failed. Tell the worker it didn't work and offer to try again.",
            }
          }
        }),
      )
      turn.push(...results)
    }
    throw new Error("Too many tool rounds")
  } catch (error) {
    if (controller.signal.aborted) return res.end()

    let code = "error"
    if (error.code === "refusal") code = "refusal"
    else if (error instanceof MuseError && [401, 403].includes(error.status)) code = "not_configured"
    else if (error instanceof MuseError && error.status === 429) code = "rate_limited"
    else if (error instanceof MuseError && error.status >= 500) code = "unavailable"
    if (code === "error" || code === "not_configured") console.error("Assistant error:", error.message)
    emit({ type: "error", code })
    res.end()
  } finally {
    conversation.busy = false
  }
})
