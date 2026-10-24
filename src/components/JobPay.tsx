import { useEffect, useState } from "react"
import { compareJobPay, speakIn, type Job, type JobsResponse } from "../api"
import { useT } from "../i18n"

const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`

const verdictStyle = {
  below_market: "border-amber-200 bg-amber-50 text-amber-950",
  at_market: "border-slate-200 bg-slate-50 text-slate-900",
  above_market: "border-emerald-200 bg-emerald-50 text-emerald-950",
}

const verdictLabel = {
  below_market: "You may be underpaid",
  at_market: "Your pay is typical",
  above_market: "You're paid above most",
}

export function JobPay({
  language,
  defaultLocation,
  defaultJobTitle,
  defaultWage,
  autoSearch = false,
}: {
  language: string
  defaultLocation: string
  defaultJobTitle: string
  defaultWage?: number
  // Run the search on open, e.g. when the job comes from the worker's profile.
  autoSearch?: boolean
}) {
  const t = useT()
  const [jobTitle, setJobTitle] = useState(defaultJobTitle)
  const [location, setLocation] = useState(defaultLocation)
  const [wage, setWage] = useState(defaultWage ? String(defaultWage) : "")
  const [data, setData] = useState<JobsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showAll, setShowAll] = useState(false)

  const search = async () => {
    if (!jobTitle.trim() || !location.trim()) {
      setError(t("Enter your job and city to compare pay."))
      return
    }
    setLoading(true)
    setError("")
    try {
      const hourlyWage = Number(wage)
      setData(
        await compareJobPay({
          jobTitle: jobTitle.trim(),
          location: location.trim(),
          hourlyWage: hourlyWage > 0 ? hourlyWage : undefined,
          language,
        }),
      )
      setShowAll(false)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoSearch && defaultJobTitle && defaultLocation) search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const input =
    "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-700"
  const list = data
    ? showAll || data.betterPaying.length === 0
      ? data.jobs
      : data.betterPaying
    : []

  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          search()
        }}
        className="grid grid-cols-2 gap-3"
      >
        <label className="col-span-2 text-sm font-semibold">
          {t("My job")}<input
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder={t("e.g. line cook, cleaner, cashier")}
            className={input}
          />
        </label>
        <label className="text-sm font-semibold">
          {t("City or ZIP")}<input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className={input}
          />
        </label>
        <label className="text-sm font-semibold">
          {t("My pay per hour")}<span className="relative block">
            <span className="absolute start-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500">
              $
            </span>
            <input
              value={wage}
              onChange={(event) => setWage(event.target.value)}
              inputMode="decimal"
              className={`${input} ps-7`}
            />
          </span>
        </label>
        <button
          disabled={loading}
          className="col-span-2 rounded-xl bg-emerald-700 py-3.5 font-bold text-white hover:bg-emerald-800 disabled:bg-slate-400"
        >
          {loading ? t("Checking jobs near you…") : t("Compare my pay")}
        </button>
      </form>

      <div className="mt-6 space-y-4" aria-live="polite">
        {error && (
          <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </p>
        )}

        {loading &&
          [0, 1, 2].map((n) => (
            <div
              key={n}
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}

        {!loading && !data && !error && (
          <p className="rounded-2xl bg-sky-50 p-4 text-sm leading-relaxed text-sky-950">
            {t("We look at real job posts near you to show what similar work pays, so you know your worth.")}</p>
        )}

        {!loading && data && (
          <>
            <section
              className={`rounded-2xl border p-5 ${
                data.comparison
                  ? verdictStyle[data.comparison.verdict]
                  : verdictStyle.at_market
              }`}
            >
              {data.comparison && (
                <p className="text-xs font-bold uppercase tracking-wider">
                  {t(verdictLabel[data.comparison.verdict])}
                </p>
              )}
              <p className="mt-1 leading-relaxed">{data.summary}</p>
              <button
                onClick={() => speakIn(language, data.summary)}
                className="mt-3 text-sm font-bold underline"
              >
                {t("🔊 Listen")}</button>
            </section>

            {data.stats && (
              <PayRange
                stats={data.stats}
                wage={data.comparison?.yourHourlyWage}
              />
            )}

            <div className="flex items-center justify-between pt-2">
              <h3 className="font-bold">
                {showAll || data.betterPaying.length === 0
                  ? t("All {n} jobs found", { n: data.jobs.length })
                  : t("{n} jobs that pay more", { n: data.betterPaying.length })}
              </h3>
              {data.betterPaying.length > 0 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="text-sm font-bold text-emerald-700"
                >
                  {showAll ? t("Only higher pay") : t("Show all")}
                </button>
              )}
            </div>
            {list.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function PayRange({
  stats,
  wage,
}: {
  stats: NonNullable<JobsResponse["stats"]>
  wage?: number
}) {
  const t = useT()
  const low = Math.min(stats.min, wage ?? stats.min)
  const high = Math.max(stats.max, wage ?? stats.max)
  const at = (n: number) =>
    high === low ? 50 : ((n - low) / (high - low)) * 100

  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{t("Typical hourly pay nearby")}</span>
        <strong>{money(stats.median)}{t("/hr")}</strong>
      </div>
      <div
        className="relative mt-8 h-3 rounded-full bg-slate-100"
        role="img"
        aria-label={`${t("Most jobs pay {low} to {high} per hour", {
          low: money(stats.p25),
          high: money(stats.p75),
        })}${wage ? `; ${t("you earn {wage}", { wage: money(wage) })}` : ""}`}
      >
        <div
          className="absolute inset-y-0 rounded-full bg-emerald-200"
          style={{
            left: `${at(stats.p25)}%`,
            width: `${Math.max(at(stats.p75) - at(stats.p25), 1.5)}%`,
          }}
        />
        <div
          className="absolute -inset-y-1 w-0.5 bg-emerald-800"
          style={{ left: `${at(stats.median)}%` }}
        />
        {wage !== undefined && (
          <div
            className="absolute -top-7 -translate-x-1/2 text-center"
            style={{ left: `${at(wage)}%` }}
          >
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-xs font-bold text-white">
              {t("You")}</span>
            <span className="mx-auto mt-1 block size-3 rounded-full border-2 border-white bg-slate-900" />
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{money(low)}</span>
        <span>
          {t("Most pay {low}–{high}", { low: money(stats.p25), high: money(stats.p75) })}
        </span>
        <span>{money(high)}</span>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {t("Based on {count} job posts that list pay. Yearly salaries are converted at 40 hours a week.", { count: stats.count })}
      </p>
    </section>
  )
}

function JobCard({ job }: { job: Job }) {
  const t = useT()
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold leading-snug">{job.title}</h4>
          <p className="mt-0.5 text-sm text-slate-600">
            {job.company} · {job.location}
          </p>
        </div>
        {job.paysMoreBy !== null && job.paysMoreBy > 0 && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
            +{money(job.paysMoreBy)}{t("/hr")}</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {[job.scheduleType, job.postedAt, ...job.benefits.slice(0, 2)]
          .filter(Boolean)
          .map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"
            >
              {tag}
            </span>
          ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <strong className={job.pay ? "text-emerald-700" : "text-slate-400"}>
          {job.pay
            ? job.pay.unit === "hour"
              ? `${money(job.pay.hourly.min)}${
                  job.pay.hourly.max > job.pay.hourly.min
                    ? `–${money(job.pay.hourly.max)}`
                    : ""
                }${t("/hr")}`
              : `≈ ${money(job.pay.hourly.mid)}${t("/hr")} (${job.pay.text})`
            : t("Pay not listed")}
        </strong>
        {job.applyUrl && (
          <span className="text-sm font-bold">
            {job.via ? t("Apply on {via} →", { via: job.via }) : t("Apply →")}
          </span>
        )}
      </div>
    </>
  )
  const card =
    "block w-full rounded-2xl border border-slate-200 p-4 text-start hover:border-emerald-600 sm:p-5"
  return job.applyUrl ? (
    <a href={job.applyUrl} target="_blank" rel="noreferrer" className={card}>
      {body}
    </a>
  ) : (
    <article className={card}>{body}</article>
  )
}
