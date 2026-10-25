import { useEffect, useState } from "react"
import { getCurrentUser, getUpload, listUploads, saveProfile, savedToResult, signOut, type User } from "./api"
import { Assistant } from "./components/Assistant"
import type { AssistantMode } from "./components/assistantStrings"
import { GoogleSignIn } from "./components/GoogleSignIn"
import { LanguagePicker } from "./components/LanguagePicker"
import { OccupationStep } from "./components/OccupationStep"
import { I18nProvider, languageDir, speechLang, tk, translator, useT } from "./i18n"
import { AssistantPage } from "./pages/AssistantPage"
import { ClaimPage, HelpPage, JobsPage, LocalHelpPage } from "./pages/HelpPages"
import { HomePage } from "./pages/HomePage"
import { PayRecordsPage } from "./pages/PayRecordsPage"
import { UploadPage } from "./pages/UploadPage"
import type { PaystubResult, ProcessedPaystub, UploadSummary } from "./paystub-api"
import { useRoute, type Page } from "./route"
import { Shell } from "./Shell"
import { Icon } from "./ui"

// What the assistant should do when it next opens.
export type AssistantRequest = { mode: AssistantMode; question?: string; upload?: boolean; id: number }

const BREADCRUMBS: Record<Page, string[]> = {
  home: [tk("Home")],
  pay: [tk("Pay records"), tk("Current pay stub")],
  upload: [tk("Pay records"), tk("Upload")],
  assistant: [tk("FairShift assistant")],
  help: [tk("Get help")],
  "help/local": [tk("Get help"), tk("Local help")],
  "help/jobs": [tk("Get help"), tk("Job pay")],
  "help/claim": [tk("Get help"), tk("Wage claim")],
}

function LoginScreen({ language, onLanguage, onSignedIn }: { language: string; onLanguage: (value: string) => void; onSignedIn: (user: User) => void }) {
  const t = useT()
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative flex flex-col justify-between overflow-hidden bg-forest p-8 text-white sm:p-14">
        <p className="text-2xl font-bold tracking-tight">FairShift</p>
        <div className="stagger my-14 space-y-2">
          {[t("Your work."), t("Your pay."), t("Your voice.")].map((line) => (
            <p key={line} className="text-5xl font-bold tracking-tight sm:text-7xl">{line}</p>
          ))}
          <p className="pt-8 text-lg text-lime-text sm:text-xl">
            {t("Clarity for every paycheck.")}
            <br />
            {t("Support for your next step.")}
          </p>
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-lime-text">{t("Work with confidence")}</p>
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full bg-pine/40 blur-3xl" />
      </section>
      <section className="relative flex items-center bg-paper px-8 py-16 sm:px-16">
        <div className="absolute end-6 top-6">
          <LanguagePicker language={language} onChange={onLanguage} openOnMount />
        </div>
        <div className="w-full max-w-md animate-rise">
          <p className="text-xs font-bold uppercase tracking-wide text-pine">{t("WELCOME TO FAIRSHIFT")}</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight">
            {t("Know your hours.")}
            <br />
            {t("Keep what you earn.")}
          </h1>
          <p className="mt-5 text-lg text-muted">{t("Understand every paycheck and get help when something feels wrong.")}</p>
          <div className="mt-10">
            <GoogleSignIn key={language} onSignedIn={onSignedIn} />
          </div>
          <p className="mt-6 text-sm text-muted">
            {t("We only use your name and email to keep your records safe. We never share them with your employer.")}
          </p>
        </div>
      </section>
    </div>
  )
}

function AppInner({ language, setLanguage }: { language: string; setLanguage: (value: string) => void }) {
  const [authStep, setAuthStep] = useState<"loading" | "login" | "occupation" | "editOccupation" | "app">("loading")
  const [user, setUser] = useState<User | null>(null)
  const [page, go] = useRoute()
  const [paystubResult, setPaystubResult] = useState<PaystubResult | null>(null)
  const [uploads, setUploads] = useState<UploadSummary[]>([])
  const [assistantRequest, setAssistantRequest] = useState<AssistantRequest | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const t = translator(language)

  // Keep <html lang> and text direction in sync (screen readers, fonts, Arabic and Urdu right-to-left).
  useEffect(() => {
    document.documentElement.lang = speechLang(language).split("-")[0]
    document.documentElement.dir = languageDir(language)
  }, [language])

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
  const newResult = (result: PaystubResult | null) => {
    setPaystubResult(result)
    if (result) void refreshUploads(false)
  }

  // A returning worker's saved language (in Supabase) always wins over what was picked on the
  // sign-in screen. A first-time worker keeps the sign-in screen's language; the job step saves it.
  const enterApp = (signedIn: User) => {
    setUser(signedIn)
    const saved = signedIn.profile?.language
    if (saved) setLanguage(saved)
    else if (signedIn.profile?.occupation) saveProfile({ language }).then(setUser).catch(() => {})
    setAuthStep(signedIn.profile?.occupation ? "app" : "occupation")
    void refreshUploads(true)
  }

  useEffect(() => {
    getCurrentUser()
      .then((signedIn) => (signedIn ? enterApp(signedIn) : setAuthStep("login")))
      .catch(() => setAuthStep("login"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeLanguage = (value: string) => {
    setLanguage(value)
    if (user?.profile?.occupation) {
      saveProfile({ language: value }).then(setUser).catch(() => {})
    }
  }

  const logOut = async () => {
    await signOut().catch(() => {})
    window.speechSynthesis?.cancel()
    setUser(null)
    setUploads([])
    setPaystubResult(null)
    setDrawerOpen(false)
    go("home")
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

  // Everything happens in the one assistant chat; this opens its page.
  const openAssistant = (mode: AssistantMode, question?: string, upload = false) => {
    setAssistantRequest({ mode, question, upload, id: Date.now() })
    setDrawerOpen(false)
    go("assistant")
  }

  if (authStep === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <p className="animate-pulse text-3xl font-bold tracking-tight text-forest">FairShift</p>
      </div>
    )
  }
  if (authStep === "login" || !user) {
    return <LoginScreen language={language} onLanguage={setLanguage} onSignedIn={enterApp} />
  }
  if (authStep === "occupation" || authStep === "editOccupation") {
    return (
      <OccupationStep
        user={user}
        language={language}
        onSaved={(saved) => {
          setUser(saved)
          setAuthStep("app")
        }}
        onCancel={authStep === "editOccupation" ? () => setAuthStep("app") : undefined}
      />
    )
  }

  const profile = user.profile
  const editJob = () => setAuthStep("editOccupation")
  const assistantProps = {
    language,
    paystubResult,
    onPaystubResult: newResult,
    hourlyWage: profile?.hourlyWage,
    onEditWage: editJob,
    onLanguageChange: changeLanguage,
  }

  const floating =
    page !== "assistant" ? (
      <>
        {!drawerOpen && (
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label={t("Ask the FairShift assistant")}
            title={t("Ask the FairShift assistant")}
            className="group fixed bottom-8 end-8 z-30 hidden animate-rise items-center gap-2 rounded-full bg-pine p-4 text-white shadow-lg shadow-forest/30 transition hover:bg-forest lg:flex"
          >
            <Icon name="chat" className="size-6" />
            <span className="hidden pe-1 text-sm font-bold group-hover:inline">{t("Ask FairShift")}</span>
          </button>
        )}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex animate-fade justify-end bg-forest/30" onClick={() => setDrawerOpen(false)}>
            <aside
              className="flex h-full w-full max-w-xl animate-slide-in flex-col bg-white shadow-2xl rtl:animate-none"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-pine">{t("FairShift assistant")}</p>
                  <p className="mt-0.5 text-lg font-bold">{t("Ask about your pay")}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setDrawerOpen(false)
                      go("assistant")
                    }}
                    className="rounded-full px-3 py-2 text-xs font-bold text-pine hover:bg-mist"
                  >
                    {t("Open full page")}
                  </button>
                  <button onClick={() => setDrawerOpen(false)} aria-label={t("Close")} className="grid size-10 place-items-center rounded-full bg-paper">
                    <Icon name="x" className="size-4" />
                  </button>
                </div>
              </div>
              <Assistant {...assistantProps} initialMode="ask" />
            </aside>
          </div>
        )}
      </>
    ) : null

  const pages: Record<Page, React.ReactNode> = {
    home: (
      <HomePage
        user={user}
        language={language}
        result={paystubResult}
        go={go}
        speaking={speaking}
        onSpeak={speak}
        onStop={stopSpeaking}
        onEditWage={editJob}
      />
    ),
    pay: (
      <PayRecordsPage
        result={paystubResult}
        uploads={uploads}
        currentUploadId={currentUploadId}
        language={language}
        hourlyWage={profile?.hourlyWage}
        go={go}
        onOpenUpload={openUpload}
        onDeletedUpload={removedUpload}
        onEditWage={editJob}
        onAsk={(question) => openAssistant("stub", question)}
      />
    ),
    upload: <UploadPage language={language} go={go} onResult={newResult} onAsk={() => openAssistant("stub")} />,
    assistant: <AssistantPage request={assistantRequest} result={paystubResult} assistantProps={assistantProps} />,
    help: <HelpPage go={go} onAsk={() => openAssistant("ask")} />,
    "help/local": <LocalHelpPage language={language} location={profile?.location || "Queens, NY"} />,
    "help/jobs": (
      <JobsPage
        language={language}
        location={profile?.location || "Queens, NY"}
        occupation={profile?.occupation}
        hourlyWage={profile?.hourlyWage}
        result={paystubResult}
      />
    ),
    "help/claim": <ClaimPage result={paystubResult} go={go} onWrite={() => openAssistant("claim", t("Help me file a wage claim."))} />,
  }

  return (
    <Shell
      page={page}
      go={go}
      breadcrumb={BREADCRUMBS[page].map((crumb) => t(crumb)).join(" / ")}
      user={user}
      language={language}
      onLanguage={changeLanguage}
      onEditJob={editJob}
      onSignOut={logOut}
      floating={floating}
    >
      {pages[page]}
    </Shell>
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
