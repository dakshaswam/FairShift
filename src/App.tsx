import { useEffect, useState } from "react"
import { speakIn } from "./api"
import { JobPay } from "./components/JobPay"
import { LocalHelp } from "./components/LocalHelp"
import { LanguagePicker } from "./components/LanguagePicker"
import { I18nProvider, LANGUAGE_OPTIONS, languageDir, speechLang, translator } from "./i18n"

type IconName = "home" | "clock" | "file" | "help" | "shield" | "camera" | "chevron" | "briefcase" | "map" | "volume" | "check"

function Icon({
  name,
  className = "size-5",
}: {
  name: IconName
  className?: string
}) {
  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v11h14V9M9 20v-6h6v6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
    help: (
      <>
        <path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z" />
        <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 15.5h.01" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    camera: (
      <>
        <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2" />
      </>
    ),
    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />
      </>
    ),
    volume: (
      <>
        <path d="M5 10h3l4-3v10l-4-3H5zM15 9c1.5 1.7 1.5 4.3 0 6M18 7c2.7 2.8 2.7 7.2 0 10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  }
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

const navItems: { id: string; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "pay", label: "Pay records", icon: "file" },
  { id: "help", label: "Get help", icon: "help" },
]

type Msg = { role: "bot" | "user"; text: string }

function AppInner({
  language,
  setLanguage,
}: {
  language: string
  setLanguage: (value: string) => void
}) {
  const [authStep, setAuthStep] = useState<"start" | "language" | "app">("start")
  const [active, setActive] = useState("home")
  const [drawer, setDrawer] =
    useState<"stub" | "claim" | "lawyer" | "jobs" | null>(null)
  const [message, setMessage] = useState("")
  const [listening, setListening] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "bot",
      text: "I found a possible overtime issue. You worked 44 hours, but all 44 were paid at your regular $18 rate.",
    },
  ])
  const t = translator(language)

  // Keep <html lang> and text direction in sync (screen readers, fonts, Arabic right-to-left).
  useEffect(() => {
    document.documentElement.lang = speechLang(language).split("-")[0]
    document.documentElement.dir = languageDir(language)
  }, [language])

  // Demo name until the app has real accounts.
  const firstName = "Maria"
  const workLocation = "Queens, NY"
  const shortLocation = workLocation.split(",")[0]

  const changeLanguage = setLanguage

  const speak = (text: string) => speakIn(language, text)

  const listen = () => {
    const SpeechRecognition = (window as unknown as {
      webkitSpeechRecognition?: new () => any
    }).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setMessage(t("Voice input is not supported in this browser."))
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = speechLang(language)
    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onresult = (event: any) =>
      setMessage(event.results[0][0].transcript)
    recognition.start()
  }

  const sendMessage = () => {
    if (!message.trim()) return
    setMessages((current) => [
      ...current,
      { role: "user", text: message },
      {
        role: "bot",
        text: "Based on this stub, the clearest issue is unpaid overtime. You may be owed $86.40. I can explain the calculation or help you start a claim.",
      },
    ])
    setMessage("")
  }

  if (authStep === "start") {
    return (
      <div className="grid min-h-screen place-items-center bg-emerald-950 px-5">
        <div className="fixed end-4 top-4 z-10">
          <LanguagePicker language={language} onChange={setLanguage} />
        </div>
        <main className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl sm:p-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-700 text-white">
            <Icon name="shield" className="size-7" />
          </span>
          <p className="mt-6 text-sm font-bold text-emerald-700">FAIRSHIFT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {t("Know your hours.")}<br />
            {t("Keep what you earn.")}</h1>
          <p className="mt-4 leading-relaxed text-slate-600">
            {t("Securely track your work, understand every paycheck, and get help when something is wrong.")}</p>
          <button
            onClick={() => setAuthStep("language")}
            className="mt-8 w-full rounded-xl bg-emerald-700 px-6 py-4 font-bold text-white hover:bg-emerald-800"
          >
            {t("Continue")}</button>
        </main>
      </div>
    )
  }

  if (authStep === "language") {
    const languages = LANGUAGE_OPTIONS.map((option) => option.label)
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 px-5">
        <main className="w-full max-w-2xl">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-700 text-white">
            <Icon name="volume" className="size-6" />
          </span>
          <p className="mt-7 text-sm font-bold text-emerald-700">
            {t("WELCOME TO FAIRSHIFT")}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {t("Which language feels best?")}</h1>
          <p className="mt-3 text-slate-600">
            {t("You can change this anytime. Pay explanations and voice input will use this language.")}</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {languages.map((item) => (
              <button
                key={item}
                onClick={() => setLanguage(item)}
                className={`rounded-2xl border p-5 text-start text-lg font-bold transition ${
                  language === item
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                {item}
                <span className="mt-1 block text-sm font-normal text-slate-500">
                  {item === "English" ? "English" : t("Continue in {language}", { language: item })}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setAuthStep("app")
            }}
            className="mt-7 w-full rounded-xl bg-emerald-700 px-6 py-4 font-bold text-white hover:bg-emerald-800"
          >
            {t("Continue")}</button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <button
            className="flex items-center gap-2.5"
            onClick={() => setActive("home")}
          >
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-700 text-white">
              <Icon name="shield" className="size-5" />
            </span>
            <span className="text-lg font-bold tracking-tight">FairShift</span>
          </button>
          <div className="flex items-center gap-3">
            <LanguagePicker language={language} onChange={changeLanguage} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl lg:grid-cols-[220px_1fr]">
        <aside className="hidden border-e border-slate-200 px-4 py-7 lg:block">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start text-sm font-semibold transition ${
                  active === item.id
                    ? "bg-emerald-50 text-emerald-800"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon name={item.icon} />
                {t(item.label)}
              </button>
            ))}
          </nav>
          <div className="mt-10 rounded-2xl bg-slate-900 p-4 text-white">
            <Icon name="shield" className="mb-3 size-6 text-emerald-300" />
            <p className="text-sm font-bold">{t("Your records belong to you.")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {t("Every change is timestamped and securely saved.")}</p>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-7 pb-28 lg:px-10 lg:py-10">
          {active === "home" ? (
            <>
              <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-sm font-semibold text-emerald-700">
                    {t("Tuesday, June 18")}</p>
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {new Date().getHours() < 12
                      ? t("Good morning, {name}", { name: firstName })
                      : new Date().getHours() < 18
                        ? t("Good afternoon, {name}", { name: firstName })
                        : t("Good evening, {name}", { name: firstName })}
                  </h1>
                  <p className="mt-2 text-slate-600">
                    {t("Let’s make sure every hour counts.")}</p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                  <span className="size-2 rounded-full bg-emerald-500" /> {t("All records protected")}</span>
              </div>

              <section className="grid gap-5">
                <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                      {t("Needs attention")}</span>
                    <span className="text-2xl font-bold text-amber-950">
                      $86.40
                    </span>
                  </div>
                  <h2 className="mt-5 text-lg font-bold">
                    {t("Possible missing overtime")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-amber-950/70">
                    {t("Your last check may be short by 4 overtime hours.")}</p>
                  <button
                    onClick={() => setDrawer("claim")}
                    className="mt-5 flex items-center gap-1 text-sm font-bold text-amber-950"
                  >
                    {t("See how we calculated this")}{" "}
                    <Icon name="chevron" className="size-4 rtl:rotate-180" />
                  </button>
                </article>
              </section>

              <section className="mt-9">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">
                    {t("Your pay, made clear")}</h2>
                  <button className="text-sm font-bold text-emerald-700">
                    {t("View all")}</button>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <button
                    onClick={() => setDrawer("stub")}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
                      <Icon name="camera" />
                    </span>
                    <h3 className="mt-5 font-bold">{t("Check a pay stub")}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {t("Take a photo. We’ll explain each line and check the math.")}</p>
                    <span className="mt-5 flex items-center gap-1 text-sm font-bold text-emerald-700">
                      {t("Scan pay stub")}{" "}<Icon name="chevron" className="size-4 rtl:rotate-180" />
                    </span>
                  </button>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-sky-100 text-sky-700">
                        <Icon name="briefcase" />
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                        {t("Matched")}</span>
                    </div>
                    <h3 className="mt-5 font-bold">{t("Latest deposit")}</h3>
                    <div className="mt-2 flex items-end justify-between">
                      <p className="text-sm text-slate-600">
                        {t("Jun 14 · Sunbright Cafe")}</p>
                      <p className="text-lg font-bold">$684.22</p>
                    </div>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-1">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                        <Icon name="volume" />
                      </span>
                      <button
                        onClick={() => speak(t(messages[0].text))}
                        aria-label={t("Play pay explanation")}
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold"
                      >
                        {t("Play")}</button>
                    </div>
                    <h3 className="mt-5 font-bold">{t("Listen in {language}", { language })}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {t("A simple audio summary of your latest paycheck.")}</p>
                  </article>
                </div>
              </section>

              <section className="mt-9 rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
                <div className="flex gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700">
                    <Icon name="map" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">
                      {t("Help near you, in your language")}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                      {t("Find trusted worker centers, legal aid, and your consulate near {place}.", { place: shortLocation })}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <button
                    onClick={() => setDrawer("claim")}
                    className="rounded-xl bg-emerald-700 px-5 py-3 text-center text-sm font-bold text-white hover:bg-emerald-800"
                  >
                    {t("Start wage claim")}
                  </button>
                  <button
                    onClick={() => setDrawer("lawyer")}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-bold text-white hover:bg-slate-800"
                  >
                    {t("Find a lawyer")}
                  </button>
                  <button
                    onClick={() => setDrawer("jobs")}
                    className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold hover:border-slate-400"
                  >
                    {t("Find a better job")}
                  </button>
                </div>
              </section>
            </>
          ) : active === "pay" ? (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-bold text-emerald-700">
                    {t("PAY HISTORY")}</p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">
                    {t("Pay records")}</h1>
                  <p className="mt-2 text-slate-600">
                    {t("Compare hours, pay stubs, and bank deposits in one place.")}</p>
                </div>
                <button
                  onClick={() => setDrawer("stub")}
                  className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white"
                >
                  {t("Check a new pay stub")}</button>
              </div>
              <section className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                      {t("ACTION NEEDED")}</span>
                    <h2 className="mt-4 text-xl font-bold">
                      {t("Possible missing overtime")}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {t("June 1–14 pay period · Estimated amount owed")}</p>
                  </div>
                  <div className="sm:text-end">
                    <p className="text-3xl font-bold">$86.40</p>
                    <button
                      onClick={() => setDrawer("claim")}
                      className="mt-3 text-sm font-bold text-emerald-800"
                    >
                      {t("Start a claim →")}</button>
                  </div>
                </div>
              </section>
              <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-slate-200 p-5">
                  <h2 className="font-bold">{t("Recent paychecks")}</h2>
                  <span className="text-sm text-slate-500">{t("Sunbright Cafe")}</span>
                </div>
                {[
                  ["Jun 14, 2025", "$684.22", "44.0", "Review needed"],
                  ["May 31, 2025", "$720.18", "40.0", "Matched"],
                  ["May 17, 2025", "$698.40", "38.8", "Matched"],
                ].map(([date, amount, hours, status]) => (
                  <button
                    key={date}
                    onClick={() => setDrawer("stub")}
                    className="grid w-full grid-cols-2 gap-3 border-b border-slate-100 p-5 text-start last:border-0 sm:grid-cols-4 sm:items-center"
                  >
                    <span className="font-bold">{t(date)}</span>
                    <span className="text-sm text-slate-600">{t("{n} hours", { n: hours })}</span>
                    <span className="font-bold">{amount}</span>
                    <span
                      className={`text-sm font-bold ${
                        status === "Matched"
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {t(status)}
                    </span>
                  </button>
                ))}
              </section>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-bold text-emerald-700">
                  {t("SUPPORT & OPPORTUNITY")}</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">
                  {t("Get help")}</h1>
                <p className="mt-2 text-slate-600">
                  {t("Take action on missing pay or find a better opportunity nearby.")}</p>
              </div>
              <section className="mt-8 grid gap-5 md:grid-cols-3">
                <button
                  onClick={() => setDrawer("claim")}
                  className="rounded-3xl bg-emerald-800 p-6 text-start text-white"
                >
                  <Icon name="file" className="size-7 text-emerald-200" />
                  <h2 className="mt-8 text-xl font-bold">
                    {t("Request a wage claim")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-emerald-100">
                    {t("Build a ready-to-review packet from your verified records.")}</p>
                  <span className="mt-6 block text-sm font-bold">
                    {t("Start claim →")}</span>
                </button>
                <button
                  onClick={() => setDrawer("lawyer")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-start"
                >
                  <Icon name="shield" className="size-7 text-violet-700" />
                  <h2 className="mt-8 text-xl font-bold">{t("Find a lawyer")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t("Connect with nearby legal aid and worker centers.")}</p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    {t("See local help →")}</span>
                </button>
                <button
                  onClick={() => setDrawer("jobs")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-start"
                >
                  <Icon name="briefcase" className="size-7 text-sky-700" />
                  <h2 className="mt-8 text-xl font-bold">{t("Find a better job")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t("See what similar jobs pay near you.")}
                  </p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    {t("Browse jobs →")}</span>
                </button>
              </section>
              <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-bold">
                  {t("Trusted help near {place}", { place: shortLocation })}
                </h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {[
                    ["Make the Road NY", "Worker center", "0.8"],
                    ["Legal Aid Society", "Legal clinic", "2.1"],
                    ["Mexican Consulate", "Consular help", "4.6"],
                  ].map(([name, kind, miles]) => (
                    <button
                      key={name}
                      onClick={() => setDrawer("lawyer")}
                      className="rounded-2xl bg-slate-50 p-4 text-start"
                    >
                      <span className="font-bold">{name}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {t(kind)} · {miles} {t("mi")}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-slate-200 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={`flex flex-col items-center gap-1 py-1 text-[11px] font-semibold ${
              active === item.id ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            {t(item.label)}
          </button>
        ))}
      </nav>

      {drawer && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-slate-950/40"
          onClick={() => setDrawer(null)}
        >
          <aside
            className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  {t("FairShift assistant")}</p>
                <h2 className="mt-1 text-xl font-bold">
                  {drawer === "stub"
                    ? t("Check your pay stub")
                    : drawer === "claim"
                      ? t("Start a wage claim")
                      : drawer === "lawyer"
                        ? t("Help near you")
                        : t("Jobs that pay more")}
                </h2>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="grid size-10 place-items-center rounded-full bg-slate-100 text-xl"
                aria-label={t("Close")}
              >
                ×
              </button>
            </div>

            {drawer === "stub" && (
              <>
                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <Icon
                      name="camera"
                      className="mx-auto size-7 text-emerald-700"
                    />
                    <span className="mt-2 block font-bold">
                      {t("Upload or take a pay stub photo")}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {t("JPG, PNG or PDF · Demo analysis appears instantly")}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="sr-only"
                      onChange={() =>
                        setMessages([
                          {
                            role: "bot",
                            text: "I read your pay stub from Sunbright Cafe. You worked 44 hours at $18/hour, but overtime was not added.",
                          },
                          {
                            role: "bot",
                            text: "Estimated amount owed: $86.40. Ask me anything about this check.",
                          },
                        ])
                      }
                    />
                  </label>
                  {messages.map((item, index) => (
                    <div
                      key={index}
                      className={`max-w-[90%] rounded-2xl p-4 text-sm leading-relaxed ${
                        item.role === "user"
                          ? "ms-auto bg-emerald-700 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {item.role === "user" ? item.text : t(item.text)}
                      {item.role === "bot" && (
                        <button
                          onClick={() => speak(t(item.text))}
                          className="mt-3 flex items-center gap-1 text-xs font-bold text-emerald-700"
                        >
                          <Icon name="volume" className="size-4" /> {t("Listen")}</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-200 p-4">
                  <div className="flex gap-2">
                    <button
                      onClick={listen}
                      className={`grid size-12 shrink-0 place-items-center rounded-xl font-bold ${
                        listening
                          ? "bg-rose-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                      aria-label={t("Voice input")}
                    >
                      {listening ? "•••" : t("Mic")}
                    </button>
                    <input
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) =>
                        event.key === "Enter" && sendMessage()
                      }
                      placeholder={t("Ask in {language}…", { language })}
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 outline-none focus:border-emerald-700"
                    />
                    <button
                      onClick={sendMessage}
                      className="rounded-xl bg-emerald-700 px-4 font-bold text-white"
                    >
                      {t("Send")}</button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {t("Voice uses your browser’s speech recognition. Translation and analysis are demo responses.")}</p>
                </div>
              </>
            )}

            {drawer === "claim" && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="rounded-2xl bg-amber-50 p-5">
                  <p className="text-sm font-bold text-amber-900">
                    {t("Estimated wages owed")}</p>
                  <p className="mt-1 text-3xl font-bold">$86.40</p>
                  <p className="mt-2 text-sm text-amber-900/70">
                    {t("4 overtime hours missing from your June 14 paycheck.")}</p>
                </div>
                <h3 className="mt-7 font-bold">
                  {t("Your evidence packet is ready")}</h3>
                {[
                  "Timestamped shift records",
                  "Pay stub and deposit match",
                  "Overtime calculation",
                  "Employer details",
                ].map((item) => (
                  <p
                    key={item}
                    className="mt-3 flex items-center gap-2 text-sm text-slate-700"
                  >
                    <span className="grid size-5 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <Icon name="check" className="size-3" />
                    </span>
                    {t(item)}
                  </p>
                ))}
                <button
                  onClick={() =>
                    alert(
                      t("Demo: Your claim packet is ready for review. No data was submitted."),
                    )
                  }
                  className="mt-8 w-full rounded-xl bg-emerald-700 px-5 py-4 font-bold text-white"
                >
                  {t("Review and request claim")}</button>
                <button
                  onClick={() => setDrawer("lawyer")}
                  className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-4 font-bold"
                >
                  {t("Talk to a lawyer first")}</button>
              </div>
            )}

            {drawer === "lawyer" && (
              <LocalHelp language={language} defaultLocation={workLocation} />
            )}

            {drawer === "jobs" && (
              <JobPay
                language={language}
                defaultLocation={workLocation}
                defaultJobTitle=""
              />
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [language, setLanguage] = useState("English")
  return (
    <I18nProvider language={language}>
      <AppInner language={language} setLanguage={setLanguage} />
    </I18nProvider>
  )
}
