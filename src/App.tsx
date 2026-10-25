import { useEffect, useState } from "react"
import { getCurrentUser, getUpload, listUploads, saveProfile, savedToResult, signOut, type User } from "./api"
import { Assistant } from "./components/Assistant"
import type { AssistantMode } from "./components/assistantStrings"
import { GoogleSignIn } from "./components/GoogleSignIn"
import { UploadHistory } from "./components/UploadHistory"
import { LanguagePicker } from "./components/LanguagePicker"
import { JobPay } from "./components/JobPay"
import { LocalHelp } from "./components/LocalHelp"
import { OccupationStep } from "./components/OccupationStep"
import { EnteredWage } from "./components/EnteredWage"
import { I18nProvider, LANGUAGE_OPTIONS, languageDir, speechLang, tk, translator } from "./i18n"
import { amount, dollars, isUsd, type PaystubResult, type ProcessedPaystub, type UploadSummary } from "./paystub-api"

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
  { id: "home", label: tk("Home"), icon: "home" },
  { id: "pay", label: tk("Pay records"), icon: "file" },
  { id: "help", label: tk("Get help"), icon: "help" },
]

function AppInner({
  language,
  setLanguage,
}: {
  language: string
  setLanguage: (value: string) => void
}) {
  const [authStep, setAuthStep] = useState<
    "loading" | "login" | "language" | "occupation" | "editOccupation" | "app"
  >("loading")
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState("home")
  const [drawer, setDrawer] =
    useState<"assistant" | "claim" | "lawyer" | "jobs" | null>(null)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("stub")
  const [assistantQuestion, setAssistantQuestion] = useState<string | undefined>()
  const [assistantUpload, setAssistantUpload] = useState(false)
  const [paystubResult, setPaystubResult] = useState<PaystubResult | null>(null)
  const currentStub = paystubResult?.paystub ?? null

  const t = translator(language)

  // Keep <html lang> and text direction in sync (screen readers, fonts, Arabic and Urdu right-to-left).
  useEffect(() => {
    document.documentElement.lang = speechLang(language).split("-")[0]
    document.documentElement.dir = languageDir(language)
  }, [language])

  const profile = user?.profile
  const firstName = user?.name.split(" ")[0] ?? ""
  const initials = (user?.name ?? "")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  const workLocation = profile?.location || "Queens, NY"
  const shortLocation = workLocation.split(",")[0]

  // Saved pay stubs. The newest one becomes the current pay stub after sign-in.
  const [uploads, setUploads] = useState<UploadSummary[]>([])
  const currentUploadId = (paystubResult as ProcessedPaystub | null)?.upload?.id ?? null
  const openUpload = async (id: string) => {
    try {
      setPaystubResult(savedToResult(await getUpload(id)))
    } catch {
      // The list still shows it; the worker can try again.
    }
  }
  const refreshUploads = async (openLatest: boolean) => {
    try {
      const list = await listUploads()
      setUploads(list)
      if (openLatest && list[0]) await openUpload(list[0].id)
    } catch {
      // History is optional; the app works without it.
    }
  }
  const removedUpload = (id: string) => {
    setUploads((list) => list.filter((upload) => upload.id !== id))
    if (id === currentUploadId) setPaystubResult(null)
  }

  // Returning workers go straight to the app; new ones pick a language and job first.
  const enterApp = (signedIn: User) => {
    setUser(signedIn)
    if (signedIn.profile?.language) setLanguage(signedIn.profile.language)
    setAuthStep(signedIn.profile?.occupation ? "app" : "language")
    void refreshUploads(true)
  }

  useEffect(() => {
    getCurrentUser()
      .then((signedIn) => (signedIn ? enterApp(signedIn) : setAuthStep("login")))
      .catch(() => setAuthStep("login"))
  }, [])

  const changeLanguage = (value: string) => {
    setLanguage(value)
    if (user?.profile?.occupation) {
      saveProfile({ language: value })
        .then(setUser)
        .catch(() => {})
    }
  }

  const logOut = async () => {
    setMenuOpen(false)
    await signOut().catch(() => {})
    window.speechSynthesis?.cancel()
    setUser(null)
    setUploads([])
    setPaystubResult(null)
    setDrawer(null)
    setActive("home")
    setAuthStep("login")
  }

  // Read-aloud for the pay stub summary. Repeat always starts again from the beginning.
  const [speaking, setSpeaking] = useState(false)
  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = speechLang(language)
    utterance.onend = utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }

  // Everything happens in the one assistant chat, including pay stub uploads.
  const openAssistant = (mode: AssistantMode, question?: string, upload = false) => {
    setAssistantMode(mode)
    setAssistantQuestion(question)
    setAssistantUpload(upload)
    setDrawer("assistant")
  }
  const checkPaystub = () => openAssistant("stub", undefined, !paystubResult)

  if (authStep === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50">
        <span className="grid size-12 animate-pulse place-items-center rounded-2xl bg-emerald-700 text-white">
          <Icon name="shield" className="size-7" />
        </span>
      </div>
    )
  }

  if ((authStep === "occupation" || authStep === "editOccupation") && user) {
    return (
      <OccupationStep
        user={user}
        language={language}
        onSaved={(saved) => {
          setUser(saved)
          setAuthStep("app")
        }}
        onCancel={
          authStep === "editOccupation" ? () => setAuthStep("app") : undefined
        }
      />
    )
  }

  if (authStep === "login" || !user) {
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
            {t("Know your hours.")}
            <br />
            {t("Keep what you earn.")}
          </h1>
          <p className="mt-4 leading-relaxed text-slate-600">
            {t("Securely track your work, understand every paycheck, and get help when something is wrong.")}
          </p>
          <div className="mt-8">
            <GoogleSignIn key={language} onSignedIn={enterApp} />
          </div>
          <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
            {t("We only use your name and email to keep your records safe. We never share them with your employer.")}
          </p>
        </main>
      </div>
    )
  }

  if (authStep === "language") {
    const languages = LANGUAGE_OPTIONS.map((option) => option.label)
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 px-5">
        <main className="w-full max-w-2xl py-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-700 text-white">
            <Icon name="volume" className="size-6" />
          </span>
          <p className="mt-7 text-sm font-bold text-emerald-700">
            {t("WELCOME TO FAIRSHIFT")}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {t("Which language feels best?")}
          </h1>
          <p className="mt-3 text-slate-600">
            {t("You can change this anytime. Pay explanations and voice input will use this language.")}
          </p>
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
                  {item === "English" ? t("English") : t("Continue in {language}", { language: item })}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setAuthStep("occupation")}
            className="mt-7 w-full rounded-xl bg-emerald-700 px-6 py-4 font-bold text-white hover:bg-emerald-800"
          >
            {t("Continue")}
          </button>
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
            <div className="relative">
              <button
                aria-label={t("Profile")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
                className="grid size-10 place-items-center overflow-hidden rounded-full bg-amber-100 text-sm font-bold text-amber-900"
              >
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                ) : (
                  initials
                )}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="p-3">
                    <p className="font-bold">{user.name}</p>
                    <p className="truncate text-sm text-slate-500">
                      {user.email}
                    </p>
                    {profile?.occupation && (
                      <p className="mt-2 text-sm text-slate-700">
                        {profile.occupation}
                        {profile.location ? ` · ${profile.location}` : ""}
                        {profile.hourlyWage ? ` · ${dollars(profile.hourlyWage)}/${t("hr")}` : ""}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setAuthStep("editOccupation")
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-slate-100"
                  >
                    {t("Edit my job")}
                  </button>
                  <button
                    onClick={logOut}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    {t("Sign out")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl lg:grid-cols-[220px_1fr]">
        <aside className="hidden border-r border-slate-200 px-4 py-7 lg:block">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${
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
              {t("Your pay stubs are saved privately to your account. You can delete them anytime.")}
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-7 pb-28 lg:px-10 lg:py-10">
          {active === "home" ? (
            <>
              <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-sm font-semibold text-emerald-700">
                    {t("Current session")}
                  </p>
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {t(
                      new Date().getHours() < 12
                        ? "Good morning, {name}"
                        : new Date().getHours() < 18
                          ? "Good afternoon, {name}"
                          : "Good evening, {name}",
                      { name: firstName },
                    )}
                  </h1>
                  <p className="mt-2 text-slate-600">
                    {t("Let’s make sure every hour counts.")}
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                  <span className="size-2 rounded-full bg-emerald-500" />{" "}
                  {t("All records protected")}
                </span>
              </div>

              <section>
                <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                      {currentStub ? t("Review extracted values") : t("No paystub yet")}
                    </span>
                    <span className="text-2xl font-bold text-amber-950">
                      {currentStub ? amount(currentStub.net_pay, currentStub.currency) : "—"}
                    </span>
                  </div>
                  <h2 className="mt-5 text-lg font-bold">
                    {currentStub ? t("Current paystub") : t("Understand your paycheck")}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-amber-950/70">
                    {currentStub ? t("{employer}. Overtime pay listed: {amount}.", { employer: currentStub.employer_name ?? t("Employer not provided"), amount: amount(currentStub.overtime_pay, currentStub.currency) }) : t("Upload a document to see its actual hours, rates, deductions and pay.")}
                  </p>
                  <EnteredWage
                    hourlyWage={profile?.hourlyWage}
                    stub={currentStub}
                    onEdit={() => setAuthStep("editOccupation")}
                    className="mt-4"
                  />
                  <button
                    onClick={() => checkPaystub()}
                    className="mt-5 flex items-center gap-1 text-sm font-bold text-amber-950"
                  >
                    {currentStub ? t("Review this upload") : t("Check a paystub")}{" "}
                    <Icon name="chevron" className="size-4" />
                  </button>
                </article>
              </section>

              <section className="mt-9">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">
                    {t("Your pay, made clear")}
                  </h2>
                  <button onClick={() => setActive("pay")} className="text-sm font-bold text-emerald-700">
                    {t("View all")}
                  </button>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <button
                    onClick={() => openAssistant("stub", undefined, true)}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
                      <Icon name="camera" />
                    </span>
                    <h3 className="mt-5 font-bold">{t("Check a pay stub")}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {t("Take a photo. We’ll explain each line and check the math.")}
                    </p>
                    <span className="mt-5 flex items-center gap-1 text-sm font-bold text-emerald-700">
                      {t("Scan pay stub")} <Icon name="chevron" className="size-4" />
                    </span>
                  </button>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-sky-100 text-sky-700">
                        <Icon name="briefcase" />
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                        {currentStub ? t("Extracted · review needed") : t("Awaiting upload")}
                      </span>
                    </div>
                    <h3 className="mt-5 font-bold">{t("Current paystub")}</h3>
                    <div className="mt-2 flex items-end justify-between">
                      <p className="text-sm text-slate-600">
                        {currentStub ? `${currentStub.pay_date ?? t("Pay date not provided")} · ${currentStub.employer_name ?? t("Employer not provided")}` : t("No current document")}
                      </p>
                      <p className="text-lg font-bold">{currentStub ? amount(currentStub.net_pay, currentStub.currency) : "—"}</p>
                    </div>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-1">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                        <Icon name="volume" />
                      </span>
                      <div className="flex gap-1.5">
                        {speaking ? (
                          <button
                            onClick={stopSpeaking}
                            className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800"
                          >
                            ■ {t("Stop")}
                          </button>
                        ) : (
                          <button
                            onClick={() => paystubResult && speak(paystubResult.assistant_message)}
                            disabled={!paystubResult}
                            aria-label={t("Play pay explanation")}
                            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                          >
                            ▶ {t("Play")}
                          </button>
                        )}
                        <button
                          onClick={() => paystubResult && speak(paystubResult.assistant_message)}
                          disabled={!paystubResult}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                        >
                          ↺ {t("Repeat")}
                        </button>
                      </div>
                    </div>
                    <h3 className="mt-5 font-bold">{t("Listen in {language}", { language })}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {paystubResult ? t("Listen to this upload’s extracted summary.") : t("Upload a paystub to hear its summary.")}
                    </p>
                  </article>
                </div>
              </section>

              <section className="mt-9 rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
                <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                  <div className="flex gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700">
                      <Icon name="map" />
                    </span>
                    <div>
                      <h2 className="text-lg font-bold">
                        {t("Help near you, in your language")}
                      </h2>
                      <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
                        {t("Find trusted worker centers, legal aid, and your consulate near {place}.", { place: shortLocation })}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => setDrawer("claim")}
                      className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
                    >
                      {t("Start wage claim")}
                    </button>
                    <button
                      onClick={() => setDrawer("lawyer")}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                    >
                      {t("Find a lawyer")}
                    </button>
                    <button
                      onClick={() => setDrawer("jobs")}
                      className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold"
                    >
                      {t("Find a better job")}
                    </button>
                    <button
                      onClick={() => openAssistant("ask")}
                      className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold"
                    >
                      {t("Ask the assistant")}
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : active === "pay" ? (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-bold text-emerald-700">
                    {t("PAY HISTORY")}
                  </p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">
                    {t("Pay records")}
                  </h1>
                  <p className="mt-2 text-slate-600">
                    {t("Your current pay stub and every pay stub you’ve uploaded.")}
                  </p>
                </div>
                <button
                  onClick={() => openAssistant("stub", undefined, true)}
                  className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white"
                >
                  {t("Check a new pay stub")}
                </button>
              </div>
              <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{t("Current pay stub")}</p>
                <h2 className="mt-3 text-xl font-bold">{currentStub?.employer_name ?? t("No paystub has been extracted")}</h2>
                {currentStub ? <>
                  <p className="mt-2 text-sm text-slate-600">{t("{start} to {end} · Pay date {date}", { start: currentStub.pay_period_start ?? t("Start not provided"), end: currentStub.pay_period_end ?? t("End not provided"), date: currentStub.pay_date ?? t("not provided") })}</p>
                  <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-sm text-slate-500">{t("Gross pay")}</dt><dd className="mt-1 text-2xl font-bold">{amount(currentStub.gross_pay, currentStub.currency)}</dd></div>
                    <div><dt className="text-sm text-slate-500">{t("Net pay")}</dt><dd className="mt-1 text-2xl font-bold">{amount(currentStub.net_pay, currentStub.currency)}</dd></div>
                    <div><dt className="text-sm text-slate-500">{t("Regular hours / hourly rate")}</dt><dd className="mt-1 font-bold">{currentStub.regular_hours ?? t("Not provided")} / {amount(currentStub.regular_hourly_rate, currentStub.currency)}</dd></div>
                    <div><dt className="text-sm text-slate-500">{t("Overtime hours / pay listed")}</dt><dd className="mt-1 font-bold">{currentStub.overtime_hours ?? t("Not provided")} / {amount(currentStub.overtime_pay, currentStub.currency)}</dd></div>
                  </dl>
                  <EnteredWage hourlyWage={profile?.hourlyWage} stub={currentStub} onEdit={() => setAuthStep("editOccupation")} className="mt-5" />
                  <p className="mt-5 text-sm text-slate-600">{t("Extracted values require review. No unpaid-wage amount or legal conclusion is calculated.")}</p>
                </> : <p className="mt-3 text-sm text-slate-600">{t("Upload a paystub to see its hours, rates, deductions and pay here.")}</p>}
                <button onClick={() => checkPaystub()} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white">{currentStub ? t("Review this paystub") : t("Upload a paystub")}</button>
              </section>
              <UploadHistory
                uploads={uploads}
                currentId={currentUploadId}
                language={language}
                onOpen={openUpload}
                onDeleted={removedUpload}
              />
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-bold text-emerald-700">
                  {t("SUPPORT & OPPORTUNITY")}
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">
                  {t("Get help")}
                </h1>
                <p className="mt-2 text-slate-600">
                  {t("Take action on missing pay or find a better opportunity nearby.")}
                </p>
              </div>
              <section className="mt-8 grid gap-5 md:grid-cols-3">
                <button
                  onClick={() => setDrawer("claim")}
                  className="rounded-3xl bg-emerald-800 p-6 text-left text-white"
                >
                  <Icon name="file" className="size-7 text-emerald-200" />
                  <h2 className="mt-8 text-xl font-bold">
                    {t("Request a wage claim")}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-emerald-100">
                    {t("Understand what additional evidence a pay review may need.")}
                  </p>
                  <span className="mt-6 block text-sm font-bold">
                    {t("Start claim →")}
                  </span>
                </button>
                <button
                  onClick={() => setDrawer("lawyer")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-left"
                >
                  <Icon name="shield" className="size-7 text-violet-700" />
                  <h2 className="mt-8 text-xl font-bold">{t("Find a lawyer")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t("Connect with nearby legal aid and worker centers.")}
                  </p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    {t("See local help →")}
                  </span>
                </button>
                <button
                  onClick={() => setDrawer("jobs")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-left"
                >
                  <Icon name="briefcase" className="size-7 text-sky-700" />
                  <h2 className="mt-8 text-xl font-bold">{t("Find a better job")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {profile?.hourlyWage
                      ? t("See nearby {job} jobs paying more than your {wage}/hour.", { job: profile.occupation ?? "", wage: dollars(profile.hourlyWage) })
                      : currentStub?.regular_hourly_rate && isUsd(currentStub.currency)
                        ? t("Compare nearby advertised pay with your pay stub's {rate} hourly rate.", { rate: amount(currentStub.regular_hourly_rate, currentStub.currency) })
                        : t("See what {job} jobs pay near you.", { job: profile?.occupation ?? t("similar") })}
                  </p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    {t("Browse jobs →")}
                  </span>
                </button>
              </section>
              <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-bold">
                  {t("Trusted help near {place}", { place: shortLocation })}
                </h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {[
                    ["Make the Road NY", tk("Worker center · 0.8 mi")],
                    ["Legal Aid Society", tk("Legal clinic · 2.1 mi")],
                    ["Mexican Consulate", tk("Consular help · 4.6 mi")],
                  ].map(([name, detail]) => (
                    <button
                      key={name}
                      onClick={() => setDrawer("lawyer")}
                      className="rounded-2xl bg-slate-50 p-4 text-left"
                    >
                      <span className="font-bold">{name}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {t(detail)}
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

      {/* Floating shortcut to the assistant, on every screen, above the mobile tab bar. */}
      {!drawer && (
        <button
          onClick={() => openAssistant("ask")}
          aria-label={t("Ask the FairShift assistant")}
          title={t("Ask the FairShift assistant")}
          className="group fixed bottom-24 right-5 z-20 flex items-center gap-2 rounded-full bg-emerald-700 p-4 text-white shadow-lg shadow-emerald-900/25 transition hover:bg-emerald-800 lg:bottom-8 lg:right-8"
        >
          <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z" />
            <path d="M8.5 9.5h7M8.5 12.5h4.5" />
          </svg>
          <span className="hidden pr-1 text-sm font-bold group-hover:inline">
            {t("Ask FairShift")}
          </span>
        </button>
      )}

      {drawer && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-slate-950/40"
          onClick={() => setDrawer(null)}
        >
          <aside
            className={`flex h-full w-full flex-col bg-white shadow-2xl ${
              drawer === "assistant" ? "max-w-2xl" : "max-w-lg"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  {t("FairShift assistant")}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {drawer === "assistant"
                      ? t("Ask about your pay")
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

            {drawer === "assistant" && (
              <Assistant
                language={language}
                initialMode={assistantMode}
                initialQuestion={assistantQuestion}
                startUpload={assistantUpload}
                paystubResult={paystubResult}
                onPaystubResult={(result) => {
                  setPaystubResult(result)
                  void refreshUploads(false)
                }}
                hourlyWage={profile?.hourlyWage}
                onEditWage={() => setAuthStep("editOccupation")}
                onLanguageChange={changeLanguage}
              />
            )}

            {drawer === "claim" && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-bold text-slate-900">{t("Unpaid wages: not determined")}</p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("A paystub extraction does not establish a wage violation. A claim needs relevant work records, pay agreements and applicable rules reviewed separately. No evidence packet has been assembled.")}</p>
                </div>
                {currentStub && <p className="mt-5 text-sm leading-relaxed text-slate-600">{t("The current upload lists overtime pay of {amount} for {hours} overtime hours. Missing fields are unknown.", { amount: amount(currentStub.overtime_pay, currentStub.currency), hours: currentStub.overtime_hours ?? t("an unknown number of") })}</p>}
                <button onClick={() => checkPaystub()} className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-4 font-bold text-white">{t("Review current pay information")}</button>
                <button onClick={() => openAssistant("claim")} className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-4 font-bold">{t("Write my claim summary with the assistant")}</button>
                <button onClick={() => setDrawer("lawyer")} className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-4 font-bold">{t("Find independent legal help")}</button>
              </div>
            )}

            {drawer === "lawyer" && (
              <LocalHelp language={language} defaultLocation={workLocation} />
            )}

            {drawer === "jobs" && (
              <JobPay
                language={language}
                defaultLocation={workLocation}
                defaultJobTitle={profile?.occupation ?? "Barista"}
                defaultWage={
                  profile?.hourlyWage ??
                  (currentStub?.regular_hourly_rate && isUsd(currentStub.currency)
                    ? Number(currentStub.regular_hourly_rate)
                    : undefined)
                }
                autoSearch={Boolean(profile?.occupation)}
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
