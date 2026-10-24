import { useState } from "react"
import type { WageClaim } from "../api"
import { tk, useT, type Translate } from "../i18n"
import { dollars } from "../paystub-api"

// A filled-in wage claim the worker checks, prints, signs and brings to their
// state labor office, the U.S. Department of Labor or a worker center. Labels are
// in the worker's language with the English label underneath for the agency.
// The worker's own name, address and phone are blank lines, written by hand.

const PAY_TYPES: Record<string, string> = {
  hourly: tk("Hourly"),
  salary: tk("Salary"),
  daily: tk("By the day"),
  piece: tk("By the piece"),
  tips: tk("Tips"),
  other: tk("Other"),
}
const PAID_BY: Record<string, string> = {
  check: tk("Check"),
  cash: tk("Cash"),
  direct_deposit: tk("Direct deposit"),
  app: tk("Payment app"),
  other: tk("Other"),
}
const WAGE_TYPES: Record<string, string> = {
  unpaid_wages: tk("Unpaid hours"),
  overtime: tk("Unpaid overtime"),
  minimum_wage: tk("Paid below minimum wage"),
  tips: tk("Tips kept by the employer"),
  deductions: tk("Illegal deductions"),
  final_pay: tk("Final paycheck not paid"),
  other: tk("Other"),
}
const BLANK = "______________________"

type Row = { label: string; value: string }
type Section = { title: string; rows: Row[]; note?: string; text?: string[] }

// The form's content as data, so the card, the printout and the copied text match.
function claimSections(claim: WageClaim, t: Translate): Section[] {
  const { employer, job } = claim
  const or = (value: string | null | undefined) => (value ? value : BLANK)
  const schedule =
    job.days_per_week || job.hours_per_day
      ? t("{days} days a week, {hours} hours a day", {
          days: job.days_per_week ?? "?",
          hours: job.hours_per_day ?? "?",
        })
      : ""
  return [
    {
      title: tk("1. About you"),
      note: tk("Write these by hand."),
      rows: [
        { label: tk("Your name"), value: BLANK },
        { label: tk("Address"), value: BLANK },
        { label: tk("Phone"), value: BLANK },
        { label: tk("Preferred language"), value: claim.language },
      ],
    },
    {
      title: tk("2. Employer"),
      rows: [
        { label: tk("Business name"), value: or(employer.name) },
        { label: tk("Address"), value: or(employer.address) },
        { label: tk("Phone"), value: or(employer.phone) },
        { label: tk("Owner or manager"), value: or(employer.manager) },
        { label: tk("Type of business"), value: or(employer.business_type) },
      ],
    },
    {
      title: tk("3. Your job"),
      rows: [
        { label: tk("Job title"), value: or(job.title) },
        { label: tk("Start date"), value: or(job.start_date) },
        { label: tk("Last day worked"), value: job.still_working ? t("I still work there") : or(job.last_day) },
        { label: tk("How you were paid"), value: job.pay_type ? t(PAY_TYPES[job.pay_type] ?? job.pay_type) : BLANK },
        { label: tk("Pay rate"), value: or(job.pay_rate) },
        { label: tk("Paid by"), value: job.paid_by ? t(PAID_BY[job.paid_by] ?? job.paid_by) : BLANK },
        { label: tk("Usual schedule"), value: or(schedule) },
      ],
    },
    {
      title: tk("4. Wages owed"),
      rows: [
        { label: tk("Dates"), value: claim.period.from || claim.period.to ? `${or(claim.period.from)} – ${or(claim.period.to)}` : BLANK },
        ...claim.wages_owed.map((row) => ({
          label: WAGE_TYPES[row.type] ?? WAGE_TYPES.other,
          value: `${dollars(row.amount)}${row.description ? ` — ${row.description}` : ""}`,
        })),
        { label: tk("Total owed"), value: dollars(claim.total_owed) },
      ],
    },
    {
      title: tk("5. What happened"),
      rows: [],
      text: [claim.what_happened || BLANK, ...(claim.what_happened_english && claim.language !== "English" ? [`${t("In English, for the agency:")} ${claim.what_happened_english}`] : [])],
    },
    {
      title: tk("6. Evidence you have"),
      rows: [],
      text: claim.evidence.length ? claim.evidence.map((item) => `• ${item}`) : [BLANK],
    },
    {
      title: tk("7. Money received another way"),
      rows: [{ label: tk("Insurance, workers' compensation, unemployment or other"), value: claim.other_payments || t("None mentioned") }],
    },
    {
      title: tk("8. Retaliation"),
      rows: [
        { label: tk("Are you afraid your employer will punish you for this claim?"), value: claim.retaliation_concern ? t("Yes") : t("No") },
        ...(claim.retaliation_details ? [{ label: tk("Details"), value: claim.retaliation_details }] : []),
      ],
    },
  ]
}

const both = (t: Translate, english: string) => {
  const local = t(english)
  return local === english ? english : `${local} / ${english}`
}

function claimText(claim: WageClaim, t: Translate) {
  const lines = [both(t, "Wage claim"), ""]
  for (const section of claimSections(claim, t)) {
    lines.push(both(t, section.title))
    for (const row of section.rows) lines.push(`  ${both(t, row.label)}: ${row.value}`)
    for (const text of section.text ?? []) lines.push(`  ${text}`)
    lines.push("")
  }
  lines.push(both(t, "I declare that the information above is true to the best of my knowledge."))
  lines.push(`${both(t, "Signature")}: ${BLANK}    ${both(t, "Date")}: ${BLANK}`)
  return lines.join("\n")
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function printClaim(claim: WageClaim, t: Translate, dir: string) {
  const win = window.open("", "_blank", "width=820,height=1000")
  if (!win) return
  const label = (english: string) => {
    const local = t(english)
    return local === english ? escapeHtml(english) : `${escapeHtml(local)}<small>${escapeHtml(english)}</small>`
  }
  const sections = claimSections(claim, t)
    .map(
      (section) =>
        `<section><h2>${label(section.title)}</h2>${section.note ? `<p class="note">${label(section.note)}</p>` : ""}${section.rows
          .map((row) => `<div class="row"><div class="k">${label(row.label)}</div><div class="v">${escapeHtml(row.value)}</div></div>`)
          .join("")}${(section.text ?? []).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</section>`,
    )
    .join("")
  win.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(t("Wage claim"))}</title><style>
    body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:32px}h1{font-size:22px;margin:0 0 4px;border-bottom:3px solid #111;padding-bottom:6px}
    h2{font-size:14px;background:#111;color:#fff;padding:4px 8px;margin:18px 0 8px}small{display:block;font-size:10px;color:#555;font-weight:400}
    .row{display:flex;gap:12px;border-bottom:1px solid #ccc;padding:5px 0}.k{width:45%;font-weight:600}.v{flex:1}.note{font-style:italic;color:#444}
    .sign{margin-top:28px}.sign div{display:inline-block;width:45%;border-top:1px solid #111;margin-top:36px;padding-top:4px}
  </style></head><body><h1>${label("Wage claim")}</h1><p class="note">${label("Prepared with FairShift. Check every line before you sign.")}</p>${sections}
  <p class="sign">${label("I declare that the information above is true to the best of my knowledge.")}</p>
  <div class="sign"><div>${label("Signature")}</div> <div>${label("Date")}</div></div>
  <p class="note">${label("Bring this form and copies of your evidence to your state labor office, the U.S. Department of Labor Wage and Hour Division (1-866-487-9243), or a worker center.")}</p>
  </body></html>`)
  win.document.close()
  win.focus()
  win.print()
}

function Label({ text }: { text: string }) {
  const t = useT()
  const local = t(text)
  return (
    <span className="text-xs font-semibold text-slate-600">
      {local}
      {local !== text && <span className="block text-[10px] font-normal text-slate-400">{text}</span>}
    </span>
  )
}

export function WageClaimCard({ claim }: { claim: WageClaim }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const button =
    "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold hover:border-slate-500"

  return (
    <section className="mb-3 max-w-[68ch] overflow-hidden rounded-2xl border-2 border-slate-900 bg-white">
      <header className="bg-slate-900 px-4 py-3 text-white">
        <h4 className="text-base font-extrabold tracking-wide">{t("Wage claim")}</h4>
        <p className="text-xs text-slate-300">{t("Prepared with FairShift. Check every line before you sign.")}</p>
      </header>
      <div className="space-y-4 p-4">
        {claimSections(claim, t).map((section) => (
          <div key={section.title}>
            <h5 className="mb-1 border-b-2 border-slate-900 pb-1 text-sm font-extrabold">{t(section.title)}</h5>
            {section.note && <p className="mb-1 text-xs italic text-slate-500">{t(section.note)}</p>}
            <dl>
              {section.rows.map((row, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 border-b border-slate-100 py-1.5 text-sm">
                  <dt><Label text={row.label} /></dt>
                  <dd className={row.label === "Total owed" ? "text-lg font-extrabold text-amber-700" : "text-slate-900"}>{row.value}</dd>
                </div>
              ))}
            </dl>
            {section.text?.map((text, index) => (
              <p key={index} className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{text}</p>
            ))}
          </div>
        ))}
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{t("I declare that the information above is true to the best of my knowledge.")}</p>
          <div className="mt-6 grid grid-cols-2 gap-6 text-xs text-slate-500">
            <span className="border-t border-slate-400 pt-1">{t("Signature")}</span>
            <span className="border-t border-slate-400 pt-1">{t("Date")}</span>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          {t("Bring this form and copies of your evidence to your state labor office, the U.S. Department of Labor Wage and Hour Division (1-866-487-9243), or a worker center.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={() => printClaim(claim, t, document.documentElement.dir || "ltr")}>
            🖨 {t("Print or save as PDF")}
          </button>
          <button
            className={button}
            onClick={() =>
              navigator.clipboard?.writeText(claimText(claim, t)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? t("Copied") : t("Copy text")}
          </button>
        </div>
      </div>
    </section>
  )
}
