import { useEffect, useState } from "react"
import { getCurrentUser, saveProfile, signOut, type User } from "./api"
import { GoogleSignIn } from "./components/GoogleSignIn"
import { JobPay } from "./components/JobPay"
import { LocalHelp } from "./components/LocalHelp"
import { OccupationStep } from "./components/OccupationStep"

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
  { id: "shifts", label: "My shifts", icon: "clock" },
  { id: "pay", label: "Pay records", icon: "file" },
  { id: "help", label: "Get help", icon: "help" },
]

export default function App() {
  const [authStep, setAuthStep] = useState<
    "loading" | "login" | "language" | "occupation" | "editOccupation" | "app"
  >("loading")
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState("home")
  const [language, setLanguage] = useState("English")
  const [clockedIn, setClockedIn] = useState(false)
  const [drawer, setDrawer] =
    useState<"stub" | "claim" | "lawyer" | "jobs" | null>(null)
  const [message, setMessage] = useState("")
  const [listening, setListening] = useState(false)
  const [messages, setMessages] = useState([
    "I found a possible overtime issue. You worked 44 hours, but all 44 were paid at your regular $18 rate.",
  ])

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

  // Returning workers go straight to the app; new ones pick a language and job first.
  const enterApp = (signedIn: User) => {
    setUser(signedIn)
    if (signedIn.profile?.language) setLanguage(signedIn.profile.language)
    setAuthStep(signedIn.profile?.occupation ? "app" : "language")
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
    setUser(null)
    setDrawer(null)
    setActive("home")
    setAuthStep("login")
  }

  const speak = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
    }
  }

  const listen = () => {
    const SpeechRecognition = (window as unknown as {
      webkitSpeechRecognition?: new () => any
    }).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setMessage("Voice input is not supported in this browser.")
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang =
      language === "Español"
        ? "es-US"
        : language === "हिन्दी"
          ? "hi-IN"
          : language === "Tiếng Việt"
            ? "vi-VN"
            : "en-US"
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
      `You: ${message}`,
      "FairShift: Based on this stub, the clearest issue is unpaid overtime. You may be owed $86.40. I can explain the calculation or help you start a claim.",
    ])
    setMessage("")
  }

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
        <main className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl sm:p-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-700 text-white">
            <Icon name="shield" className="size-7" />
          </span>
          <p className="mt-6 text-sm font-bold text-emerald-700">FAIRSHIFT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Know your hours.
            <br />
            Keep what you earn.
          </h1>
          <p className="mt-4 leading-relaxed text-slate-600">
            Securely track your work, understand every paycheck, and get help
            when something is wrong.
          </p>
          <div className="mt-8">
            <GoogleSignIn onSignedIn={enterApp} />
          </div>
          <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
            We only use your name and email to keep your records safe. We never
            share them with your employer.
          </p>
        </main>
      </div>
    )
  }

  if (authStep === "language") {
    const languages = ["English", "Español", "हिन्दी", "Tiếng Việt"]
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 px-5">
        <main className="w-full max-w-xl">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-700 text-white">
            <Icon name="volume" className="size-6" />
          </span>
          <p className="mt-7 text-sm font-bold text-emerald-700">
            WELCOME TO FAIRSHIFT
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Which language feels best?
          </h1>
          <p className="mt-3 text-slate-600">
            You can change this anytime. Pay explanations and voice input will
            use this language.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {languages.map((item) => (
              <button
                key={item}
                onClick={() => setLanguage(item)}
                className={`rounded-2xl border p-5 text-left text-lg font-bold transition ${
                  language === item
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                {item}
                <span className="mt-1 block text-sm font-normal text-slate-500">
                  {item === "English" ? "English" : `Continue in ${item}`}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setAuthStep("occupation")}
            className="mt-7 w-full rounded-xl bg-emerald-700 px-6 py-4 font-bold text-white hover:bg-emerald-800"
          >
            Continue
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
            <label className="sr-only" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              value={language}
              onChange={(event) => changeLanguage(event.target.value)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold outline-none focus:border-emerald-700"
            >
              <option>English</option>
              <option>Español</option>
              <option>हिन्दी</option>
              <option>Tiếng Việt</option>
            </select>
            <div className="relative">
              <button
                aria-label="Profile"
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
                        {profile.hourlyWage ? ` · $${profile.hourlyWage}/hr` : ""}
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
                    Edit my job
                  </button>
                  <button
                    onClick={logOut}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Sign out
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
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-10 rounded-2xl bg-slate-900 p-4 text-white">
            <Icon name="shield" className="mb-3 size-6 text-emerald-300" />
            <p className="text-sm font-bold">Your records belong to you.</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Every change is timestamped and securely saved.
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-7 pb-28 lg:px-10 lg:py-10">
          {active === "home" ? (
            <>
              <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-sm font-semibold text-emerald-700">
                    Tuesday, June 18
                  </p>
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {new Date().getHours() < 12
                      ? "Good morning"
                      : new Date().getHours() < 18
                        ? "Good afternoon"
                        : "Good evening"}
                    , {firstName}
                  </h1>
                  <p className="mt-2 text-slate-600">
                    Let’s make sure every hour counts.
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                  <span className="size-2 rounded-full bg-emerald-500" /> All
                  records protected
                </span>
              </div>

              <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
                <article className="overflow-hidden rounded-3xl bg-emerald-800 p-6 text-white shadow-sm sm:p-8">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-sm font-semibold text-emerald-200">
                        Today’s shift
                      </p>
                      <h2 className="mt-1 text-2xl font-bold">
                        {clockedIn ? "Shift in progress" : "Ready to start?"}
                      </h2>
                      <p className="mt-2 max-w-md text-sm leading-relaxed text-emerald-100">
                        {clockedIn
                          ? "Your start time and location are securely recorded."
                          : "Clock in when you arrive. We’ll keep a verified record, even if your employer edits theirs."}
                      </p>
                    </div>
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10">
                      <Icon name="clock" className="size-6" />
                    </span>
                  </div>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      onClick={() => setClockedIn(!clockedIn)}
                      className="rounded-xl bg-amber-300 px-6 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-amber-200"
                    >
                      {clockedIn ? "End shift" : "Clock in now"}
                    </button>
                    <p className="text-xs text-emerald-100">
                      {clockedIn
                        ? "Started at 8:04 AM · Queens, NY"
                        : "Location is added only when you clock in"}
                    </p>
                  </div>
                </article>

                <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                      Needs attention
                    </span>
                    <span className="text-2xl font-bold text-amber-950">
                      $86.40
                    </span>
                  </div>
                  <h2 className="mt-5 text-lg font-bold">
                    Possible missing overtime
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-amber-950/70">
                    Your last check may be short by 4 overtime hours.
                  </p>
                  <button
                    onClick={() => setDrawer("claim")}
                    className="mt-5 flex items-center gap-1 text-sm font-bold text-amber-950"
                  >
                    See how we calculated this{" "}
                    <Icon name="chevron" className="size-4" />
                  </button>
                </article>
              </section>

              <section className="mt-9">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">
                    Your pay, made clear
                  </h2>
                  <button className="text-sm font-bold text-emerald-700">
                    View all
                  </button>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <button
                    onClick={() => setDrawer("stub")}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
                      <Icon name="camera" />
                    </span>
                    <h3 className="mt-5 font-bold">Check a pay stub</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      Take a photo. We’ll explain each line and check the math.
                    </p>
                    <span className="mt-5 flex items-center gap-1 text-sm font-bold text-emerald-700">
                      Scan pay stub <Icon name="chevron" className="size-4" />
                    </span>
                  </button>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-sky-100 text-sky-700">
                        <Icon name="briefcase" />
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                        Matched
                      </span>
                    </div>
                    <h3 className="mt-5 font-bold">Latest deposit</h3>
                    <div className="mt-2 flex items-end justify-between">
                      <p className="text-sm text-slate-600">
                        Jun 14 · Sunbright Cafe
                      </p>
                      <p className="text-lg font-bold">$684.22</p>
                    </div>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-1">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                        <Icon name="volume" />
                      </span>
                      <button
                        onClick={() => speak(messages[0])}
                        aria-label="Play pay explanation"
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold"
                      >
                        Play
                      </button>
                    </div>
                    <h3 className="mt-5 font-bold">Listen in {language}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      A simple audio summary of your latest paycheck.
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
                        Help near you, in your language
                      </h2>
                      <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
                        Find trusted worker centers, legal aid, and your
                        consulate near {shortLocation}.
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => setDrawer("claim")}
                      className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
                    >
                      Start wage claim
                    </button>
                    <button
                      onClick={() => setDrawer("lawyer")}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                    >
                      Find a lawyer
                    </button>
                    <button
                      onClick={() => setDrawer("jobs")}
                      className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold"
                    >
                      Find a better job
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : active === "shifts" ? (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-bold text-emerald-700">
                    VERIFIED WORK LOG
                  </p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">
                    My shifts
                  </h1>
                  <p className="mt-2 text-slate-600">
                    A timestamped record of every hour you worked.
                  </p>
                </div>
                <button
                  onClick={() => setClockedIn(!clockedIn)}
                  className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white"
                >
                  {clockedIn ? "End current shift" : "Clock in now"}
                </button>
              </div>
              <section className="mt-8 grid gap-5 sm:grid-cols-3">
                {[
                  ["This week", "44.0 hrs"],
                  ["Regular", "40.0 hrs"],
                  ["Overtime", "4.0 hrs"],
                ].map(([label, value]) => (
                  <article
                    key={label}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold">{value}</p>
                  </article>
                ))}
              </section>
              <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-lg font-bold">June 10–16</h2>
                </div>
                {[
                  [
                    "Friday, Jun 14",
                    "8:04 AM – 6:12 PM",
                    "10h 08m",
                    "Edited by employer",
                  ],
                  [
                    "Thursday, Jun 13",
                    "8:02 AM – 4:34 PM",
                    "8h 32m",
                    "Verified",
                  ],
                  [
                    "Wednesday, Jun 12",
                    "7:58 AM – 4:21 PM",
                    "8h 23m",
                    "Verified",
                  ],
                  [
                    "Tuesday, Jun 11",
                    "8:07 AM – 5:02 PM",
                    "8h 55m",
                    "Verified",
                  ],
                  ["Monday, Jun 10", "8:01 AM – 4:03 PM", "8h 02m", "Verified"],
                ].map(([day, time, total, status]) => (
                  <button
                    key={day}
                    onClick={() =>
                      alert(
                        `${day}: full timestamp and edit history would open here.`,
                      )
                    }
                    className="grid w-full gap-2 border-b border-slate-100 p-5 text-left last:border-0 sm:grid-cols-[1.2fr_1.4fr_.6fr_.9fr] sm:items-center"
                  >
                    <span className="font-bold">{day}</span>
                    <span className="text-sm text-slate-600">{time}</span>
                    <span className="text-sm font-bold">{total}</span>
                    <span
                      className={`text-sm font-bold ${
                        status === "Verified"
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {status}
                    </span>
                  </button>
                ))}
              </section>
            </>
          ) : active === "pay" ? (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-bold text-emerald-700">
                    PAY HISTORY
                  </p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">
                    Pay records
                  </h1>
                  <p className="mt-2 text-slate-600">
                    Compare hours, pay stubs, and bank deposits in one place.
                  </p>
                </div>
                <button
                  onClick={() => setDrawer("stub")}
                  className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white"
                >
                  Check a new pay stub
                </button>
              </div>
              <section className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                      ACTION NEEDED
                    </span>
                    <h2 className="mt-4 text-xl font-bold">
                      Possible missing overtime
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      June 1–14 pay period · Estimated amount owed
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-3xl font-bold">$86.40</p>
                    <button
                      onClick={() => setDrawer("claim")}
                      className="mt-3 text-sm font-bold text-emerald-800"
                    >
                      Start a claim →
                    </button>
                  </div>
                </div>
              </section>
              <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-slate-200 p-5">
                  <h2 className="font-bold">Recent paychecks</h2>
                  <span className="text-sm text-slate-500">Sunbright Cafe</span>
                </div>
                {[
                  ["Jun 14, 2025", "$684.22", "44.0 hours", "Review needed"],
                  ["May 31, 2025", "$720.18", "40.0 hours", "Matched"],
                  ["May 17, 2025", "$698.40", "38.8 hours", "Matched"],
                ].map(([date, amount, hours, status]) => (
                  <button
                    key={date}
                    onClick={() => setDrawer("stub")}
                    className="grid w-full grid-cols-2 gap-3 border-b border-slate-100 p-5 text-left last:border-0 sm:grid-cols-4 sm:items-center"
                  >
                    <span className="font-bold">{date}</span>
                    <span className="text-sm text-slate-600">{hours}</span>
                    <span className="font-bold">{amount}</span>
                    <span
                      className={`text-sm font-bold ${
                        status === "Matched"
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {status}
                    </span>
                  </button>
                ))}
              </section>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-bold text-emerald-700">
                  SUPPORT & OPPORTUNITY
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">
                  Get help
                </h1>
                <p className="mt-2 text-slate-600">
                  Take action on missing pay or find a better opportunity
                  nearby.
                </p>
              </div>
              <section className="mt-8 grid gap-5 md:grid-cols-3">
                <button
                  onClick={() => setDrawer("claim")}
                  className="rounded-3xl bg-emerald-800 p-6 text-left text-white"
                >
                  <Icon name="file" className="size-7 text-emerald-200" />
                  <h2 className="mt-8 text-xl font-bold">
                    Request a wage claim
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-emerald-100">
                    Build a ready-to-review packet from your verified records.
                  </p>
                  <span className="mt-6 block text-sm font-bold">
                    Start claim →
                  </span>
                </button>
                <button
                  onClick={() => setDrawer("lawyer")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-left"
                >
                  <Icon name="shield" className="size-7 text-violet-700" />
                  <h2 className="mt-8 text-xl font-bold">Find a lawyer</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Connect with nearby legal aid and worker centers.
                  </p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    See local help →
                  </span>
                </button>
                <button
                  onClick={() => setDrawer("jobs")}
                  className="rounded-3xl border border-slate-200 bg-white p-6 text-left"
                >
                  <Icon name="briefcase" className="size-7 text-sky-700" />
                  <h2 className="mt-8 text-xl font-bold">Find a better job</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {profile?.hourlyWage
                      ? `See nearby ${profile.occupation} jobs paying more than your $${profile.hourlyWage}/hour.`
                      : `See what ${profile?.occupation ?? "similar"} jobs pay near you.`}
                  </p>
                  <span className="mt-6 block text-sm font-bold text-emerald-700">
                    Browse jobs →
                  </span>
                </button>
              </section>
              <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-bold">
                  Trusted help near {shortLocation}
                </h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {[
                    ["Make the Road NY", "Worker center · 0.8 mi"],
                    ["Legal Aid Society", "Legal clinic · 2.1 mi"],
                    ["Mexican Consulate", "Consular help · 4.6 mi"],
                  ].map(([name, detail]) => (
                    <button
                      key={name}
                      onClick={() => setDrawer("lawyer")}
                      className="rounded-2xl bg-slate-50 p-4 text-left"
                    >
                      <span className="font-bold">{name}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {detail}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-slate-200 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={`flex flex-col items-center gap-1 py-1 text-[11px] font-semibold ${
              active === item.id ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            {item.label}
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
                  FairShift assistant
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {drawer === "stub"
                    ? "Check your pay stub"
                    : drawer === "claim"
                      ? "Start a wage claim"
                      : drawer === "lawyer"
                        ? "Help near you"
                        : "Jobs that pay more"}
                </h2>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="grid size-10 place-items-center rounded-full bg-slate-100 text-xl"
                aria-label="Close"
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
                      Upload or take a pay stub photo
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      JPG, PNG or PDF · Demo analysis appears instantly
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="sr-only"
                      onChange={() =>
                        setMessages([
                          "I read your pay stub from Sunbright Cafe. You worked 44 hours at $18/hour, but overtime was not added.",
                          "FairShift: Estimated amount owed: $86.40. Ask me anything about this check.",
                        ])
                      }
                    />
                  </label>
                  {messages.map((item, index) => (
                    <div
                      key={index}
                      className={`max-w-[90%] rounded-2xl p-4 text-sm leading-relaxed ${
                        item.startsWith("You:")
                          ? "ml-auto bg-emerald-700 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {item}
                      {!item.startsWith("You:") && (
                        <button
                          onClick={() => speak(item)}
                          className="mt-3 flex items-center gap-1 text-xs font-bold text-emerald-700"
                        >
                          <Icon name="volume" className="size-4" /> Listen
                        </button>
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
                      aria-label="Voice input"
                    >
                      {listening ? "•••" : "Mic"}
                    </button>
                    <input
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) =>
                        event.key === "Enter" && sendMessage()
                      }
                      placeholder={`Ask in ${language}…`}
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 outline-none focus:border-emerald-700"
                    />
                    <button
                      onClick={sendMessage}
                      className="rounded-xl bg-emerald-700 px-4 font-bold text-white"
                    >
                      Send
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Voice uses your browser’s speech recognition. Translation
                    and analysis are demo responses.
                  </p>
                </div>
              </>
            )}

            {drawer === "claim" && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="rounded-2xl bg-amber-50 p-5">
                  <p className="text-sm font-bold text-amber-900">
                    Estimated wages owed
                  </p>
                  <p className="mt-1 text-3xl font-bold">$86.40</p>
                  <p className="mt-2 text-sm text-amber-900/70">
                    4 overtime hours missing from your June 14 paycheck.
                  </p>
                </div>
                <h3 className="mt-7 font-bold">
                  Your evidence packet is ready
                </h3>
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
                    {item}
                  </p>
                ))}
                <button
                  onClick={() =>
                    alert(
                      "Demo: Your claim packet is ready for review. No data was submitted.",
                    )
                  }
                  className="mt-8 w-full rounded-xl bg-emerald-700 px-5 py-4 font-bold text-white"
                >
                  Review and request claim
                </button>
                <button
                  onClick={() => setDrawer("lawyer")}
                  className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-4 font-bold"
                >
                  Talk to a lawyer first
                </button>
              </div>
            )}

            {drawer === "lawyer" && (
              <LocalHelp language={language} defaultLocation={workLocation} />
            )}

            {drawer === "jobs" && (
              <JobPay
                language={language}
                defaultLocation={workLocation}
                defaultJobTitle={profile?.occupation ?? ""}
                defaultWage={profile?.hourlyWage ?? undefined}
                autoSearch
              />
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
