import { useEffect, useState } from "react"
import { findHelp, type HelpCategory, type Place } from "../api"
import { LANGUAGE_OPTIONS, tk, useT } from "../i18n"

const tabs: { id: HelpCategory; label: string; hint: string }[] = [
  {
    id: "legal_aid",
    label: tk("Legal aid"),
    hint: tk("Free lawyers and legal clinics that handle unpaid wages."),
  },
  {
    id: "worker_center",
    label: tk("Worker centers"),
    hint: tk("Community groups that help workers recover pay."),
  },
  {
    id: "consulate",
    label: tk("My consulate"),
    hint: tk("Your consulate can help with ID documents and labor problems."),
  },
]

export const languageNames: Record<string, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.filter((option) => option.label !== "English").map(
    (option) => [option.label, option.name],
  ),
)

type Origin = { label: string; lat?: number; lng?: number }

export function LocalHelp({
  language,
  defaultLocation,
}: {
  language: string
  defaultLocation: string
}) {
  const t = useT()
  const [category, setCategory] = useState<HelpCategory>("legal_aid")
  const [locationInput, setLocationInput] = useState(defaultLocation)
  const [origin, setOrigin] = useState<Origin>({ label: defaultLocation })
  const [country, setCountry] = useState("")
  const [countryInput, setCountryInput] = useState("")
  const [results, setResults] = useState<Record<string, Place[]>>({})
  const [error, setError] = useState("")
  const [locating, setLocating] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const key = [
    category,
    language,
    origin.label,
    origin.lat,
    origin.lng,
    category === "consulate" ? country : "",
  ].join("|")
  const places = results[key]
  const loading = !places && !error
  const languageName = languageNames[language]

  useEffect(() => {
    if (results[key]) return
    let cancelled = false
    setError("")
    findHelp({
      category,
      language,
      location: origin.lat === undefined ? origin.label : undefined,
      lat: origin.lat,
      lng: origin.lng,
      country: category === "consulate" ? country : undefined,
    })
      .then((data) => {
        if (cancelled) return
        if (category === "consulate" && !country) {
          setCountryInput(data.country ?? "")
        }
        setResults((current) => ({
          ...current,
          [key]: data.results[category] ?? [],
        }))
      })
      .catch((reason: Error) => !cancelled && setError(reason.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError(t("Your browser can't share your location. Type a city instead."))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        setLocationInput(t("My location"))
        setOrigin({
          label: t("My location"),
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      () => {
        setLocating(false)
        setError(t("We couldn't get your location. Type a city or ZIP code."))
      },
    )
  }

  const active = tabs.find((tab) => tab.id === category)!

  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const label = locationInput.trim()
          if (label && label !== origin.label) setOrigin({ label })
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="help-location">
          {t("City or ZIP code")}</label>
        <input
          id="help-location"
          value={locationInput}
          onChange={(event) => setLocationInput(event.target.value)}
          placeholder={t("City or ZIP code")}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-700"
        />
        <button className="rounded-xl bg-emerald-700 px-4 font-bold text-white hover:bg-emerald-800">
          {t("Search")}</button>
      </form>
      <button
        onClick={useMyLocation}
        disabled={locating}
        className="mt-2 text-sm font-bold text-emerald-700 disabled:text-slate-400"
      >
        {locating ? t("Finding you…") : t("📍 Use my current location")}
      </button>

      <div
        role="tablist"
        aria-label={t("Kind of help")}
        className="mt-5 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={category === tab.id}
            onClick={() => setCategory(tab.id)}
            className={`rounded-xl px-2 py-2.5 text-sm font-bold transition ${
              category === tab.id
                ? "bg-white text-emerald-800 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600">{t(active.hint)}</p>

      {category === "consulate" && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setCountry(countryInput.trim())
          }}
          className="mt-3 flex items-center gap-2"
        >
          <label htmlFor="help-country" className="text-sm font-semibold">
            {t("Home country")}</label>
          <input
            id="help-country"
            value={countryInput}
            onChange={(event) => setCountryInput(event.target.value)}
            placeholder={t("e.g. Mexico")}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
          />
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold">
            {t("Update")}</button>
        </form>
      )}

      <div className="mt-5 space-y-3" aria-live="polite">
        {error ? (
          <div className="rounded-2xl bg-rose-50 p-5 text-sm text-rose-900">
            <p className="font-bold">{t("Something went wrong")}</p>
            <p className="mt-1">{error}</p>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 font-bold underline"
            >
              {t("Try again")}</button>
          </div>
        ) : loading ? (
          [0, 1, 2].map((n) => (
            <div
              key={n}
              className="h-36 animate-pulse rounded-2xl bg-slate-100"
            />
          ))
        ) : places.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
            {category === "consulate" && !countryInput
              ? t("Tell us your home country to find your consulate.")
              : t("We didn't find any places here. Try a nearby city or ZIP code.")}
          </div>
        ) : (
          places.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              languageName={languageName}
            />
          ))
        )}
      </div>

      <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
        <strong>{t("Before you call:")}</strong> {t("have your FairShift shift log, pay stubs and bank deposits ready. Legal aid and worker centers help workers regardless of immigration status.")}</p>
    </div>
  )
}

export function PlaceCard({
  place,
  languageName,
}: {
  place: Place
  languageName?: string
}) {
  const t = useT()
  const link =
    "flex items-center justify-center rounded-xl border border-slate-200 py-2.5 text-sm font-bold hover:border-emerald-600 hover:text-emerald-800"
  return (
    <article className="rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold leading-snug">{place.name}</h3>
          <p className="mt-0.5 text-sm text-slate-600">
            {[
              place.type,
              place.distanceMiles !== null && `${place.distanceMiles} ${t("mi")}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {place.rating !== null && (
          <span className="shrink-0 text-sm font-bold">
            ★ {place.rating}
            <span className="font-normal text-slate-500">
              {" "}
              ({place.reviews})
            </span>
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {place.likelyFree && place.category !== "consulate" && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
            {t("Free / nonprofit")}</span>
        )}
        {languageName && place.mentionsLanguage && (
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">
            {t("Mentions {language}", { language: t(languageName) })}
          </span>
        )}
        {languageName && !place.mentionsLanguage && place.foundInLanguageSearch && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            {t("Found in {language} search", { language: t(languageName) })}
          </span>
        )}
      </div>

      {place.address && (
        <p className="mt-3 text-sm text-slate-700">{place.address}</p>
      )}
      {place.hours && (
        <p className="mt-1 text-xs text-slate-500">{place.hours}</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {place.phone ? (
          <a href={`tel:${place.phone}`} className={link}>
            {t("Call")}</a>
        ) : (
          <span className={`${link} cursor-not-allowed text-slate-400`}>
            {t("No phone")}</span>
        )}
        <a
          href={place.directionsUrl}
          target="_blank"
          rel="noreferrer"
          className={link}
        >
          {t("Directions")}</a>
        <a
          href={place.website ?? place.mapsUrl}
          target="_blank"
          rel="noreferrer"
          className={link}
        >
          {place.website ? t("Website") : t("Map")}
        </a>
      </div>
    </article>
  )
}
