import { useState } from "react"
import { saveProfile, type User } from "../api"
import { tk, useT } from "../i18n"

const commonJobs = [
  tk("Cook"),
  tk("Dishwasher"),
  tk("Server"),
  tk("Barista"),
  tk("Cashier"),
  tk("Cleaner"),
  tk("Housekeeper"),
  tk("Construction worker"),
  tk("Warehouse worker"),
  tk("Delivery driver"),
  tk("Home health aide"),
  tk("Nanny"),
  tk("Landscaper"),
  tk("Farm worker"),
]

// Asked on first sign-in (and from the profile menu) so job searches match the worker.
export function OccupationStep({
  user,
  language,
  onSaved,
  onCancel,
}: {
  user: User
  language: string
  onSaved: (user: User) => void
  onCancel?: () => void
}) {
  const [occupation, setOccupation] = useState(user.profile?.occupation ?? "")
  const [location, setLocation] = useState(user.profile?.location ?? "")
  const [wage, setWage] = useState(
    user.profile?.hourlyWage ? String(user.profile.hourlyWage) : "",
  )
  const t = useT()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    if (!occupation.trim()) {
      setError(t("Please tell us what kind of work you do."))
      return
    }
    if (wage && !(Number(wage) > 0)) {
      setError(t("Hourly pay should be a number, like 16.50."))
      return
    }
    setSaving(true)
    setError("")
    try {
      onSaved(
        await saveProfile({
          occupation: occupation.trim(),
          location: location.trim(),
          hourlyWage: wage ? Number(wage) : null,
          language,
        }),
      )
    } catch (reason) {
      setError((reason as Error).message)
      setSaving(false)
    }
  }

  const input =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-lg outline-none focus:border-emerald-700"

  return (
    <div className="grid min-h-screen place-items-center bg-stone-50 px-5 py-10">
      <main className="w-full max-w-xl">
        <p className="text-sm font-bold text-emerald-700">
          {onCancel ? t("YOUR WORK") : t("ONE LAST STEP")}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {t("What kind of work do you do?")}
        </h1>
        <p className="mt-3 text-slate-600">
          {t("We use this to show what similar jobs near you pay, and to find better ones. You can change it anytime.")}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="mt-7"
        >
          <label className="block font-bold" htmlFor="occupation">
            {t("My job")}
          </label>
          <input
            id="occupation"
            value={occupation}
            onChange={(event) => setOccupation(event.target.value)}
            placeholder={t("Type your job, or pick one below")}
            autoComplete="organization-title"
            className={input}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {commonJobs.map((job) => (
              <button
                key={job}
                type="button"
                onClick={() => setOccupation(t(job))}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  occupation === t(job)
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                {t(job)}
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="block font-bold">
              {t("Where I work")}
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder={t("City or ZIP code")}
                autoComplete="address-level2"
                className={input}
              />
            </label>
            <label className="block font-bold">
              {t("My pay per hour")}{" "}
              <span className="font-normal text-slate-500">{t("(optional)")}</span>
              <span className="relative block">
                <span className="absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-lg text-slate-500">
                  $
                </span>
                <input
                  value={wage}
                  onChange={(event) => setWage(event.target.value)}
                  inputMode="decimal"
                  placeholder="16.50"
                  className={`${input} pl-8`}
                />
              </span>
            </label>
          </div>

          {error && (
            <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
              {error}
            </p>
          )}

          <button
            disabled={saving}
            className="mt-7 w-full rounded-xl bg-emerald-700 px-6 py-4 font-bold text-white hover:bg-emerald-800 disabled:bg-slate-400"
          >
            {saving ? t("Saving…") : onCancel ? t("Save") : t("Continue")}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="mt-3 w-full rounded-xl border border-slate-300 px-6 py-4 font-bold"
            >
              {t("Cancel")}
            </button>
          )}
        </form>
      </main>
    </div>
  )
}
