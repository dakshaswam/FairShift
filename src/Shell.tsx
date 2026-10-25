// App frame: sidebar (desktop), top bar with breadcrumb, language and profile
// menu, footer, and a bottom tab bar on phones.
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { User } from "./api"
import { LanguagePicker } from "./components/LanguagePicker"
import { tk, useT } from "./i18n"
import { dollars } from "./paystub-api"
import type { Page } from "./route"
import { Icon, type IconName } from "./ui"

const NAV: { page: Page; label: string; short: string; icon: IconName }[] = [
  { page: "home", label: tk("Home"), short: tk("Home"), icon: "home" },
  { page: "pay", label: tk("Pay records"), short: tk("Pay"), icon: "file" },
  { page: "help", label: tk("Get help"), short: tk("Help"), icon: "help" },
  { page: "assistant", label: tk("Ask FairShift"), short: tk("Ask"), icon: "chat" },
]

const section = (page: Page) => (page.startsWith("help") ? "help" : page === "upload" ? "pay" : page)

function Wordmark({ light = false }: { light?: boolean }) {
  const t = useT()
  return (
    <div>
      <p className={`text-2xl font-bold tracking-tight ${light ? "text-white" : "text-forest"}`}>FairShift</p>
      <p className={`mt-0.5 text-[10px] font-semibold uppercase tracking-wider ${light ? "text-lime-text" : "text-muted"}`}>
        {t("Work with confidence")}
      </p>
    </div>
  )
}

function ProfileMenu({ user, onEditJob, onSignOut }: { user: User; onEditJob: () => void; onSignOut: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const profile = user.profile
  const first = user.name.split(" ")[0]

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t("Profile")}
        className="flex items-center gap-2 rounded-full py-1 pe-3 ps-1 text-sm font-semibold hover:bg-mist"
      >
        <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-lime text-xs font-bold text-forest">
          {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : first.slice(0, 1)}
        </span>
        <span className="hidden sm:inline">{first}</span>
      </button>
      {open && (
        <div className="absolute end-0 top-12 z-40 w-72 animate-rise rounded-2xl border border-line bg-white p-2 shadow-xl">
          <div className="p-3">
            <p className="font-bold">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
            {profile?.occupation && (
              <p className="mt-2 text-sm">
                {profile.occupation}
                {profile.location ? ` · ${profile.location}` : ""}
                {profile.hourlyWage ? ` · ${dollars(profile.hourlyWage)}/${t("hr")}` : ""}
              </p>
            )}
          </div>
          <button onClick={() => { setOpen(false); onEditJob() }} className="w-full rounded-xl px-3 py-2.5 text-start text-sm font-semibold hover:bg-mist">
            {t("Edit my job")}
          </button>
          <button onClick={() => { setOpen(false); onSignOut() }} className="w-full rounded-xl px-3 py-2.5 text-start text-sm font-semibold text-rose-700 hover:bg-rose-50">
            {t("Sign out")}
          </button>
        </div>
      )}
    </div>
  )
}

export function Shell({
  page,
  go,
  breadcrumb,
  user,
  language,
  onLanguage,
  onEditJob,
  onSignOut,
  askLanguage,
  floating,
  children,
}: {
  page: Page
  go: (page: Page) => void
  breadcrumb: string
  user: User
  language: string
  onLanguage: (language: string) => void
  onEditJob: () => void
  onSignOut: () => void
  askLanguage?: boolean
  floating?: ReactNode
  children: ReactNode
}) {
  const t = useT()
  const active = section(page)
  const profile = user.profile

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-e border-line bg-white px-4 py-8 lg:flex">
        <button onClick={() => go("home")} className="px-3 text-start">
          <Wordmark />
        </button>
        <nav className="mt-14 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.page}
              onClick={() => go(item.page)}
              aria-current={active === item.page ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start text-[15px] transition ${
                active === item.page ? "bg-mist font-semibold text-forest" : "text-forest/80 hover:bg-paper"
              }`}
            >
              <Icon name={item.icon} className="size-[18px] opacity-70" />
              {t(item.label)}
            </button>
          ))}
        </nav>
        <div className="mx-3 mt-8 border-t border-line pt-8">
          <p className="text-sm font-bold uppercase leading-snug tracking-wide">
            {t("Your records.")}
            <br />
            {t("Your control.")}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {t("Your pay stubs are saved privately to your account. You can delete them anytime.")}
          </p>
        </div>
        <div className="mt-auto px-3">
          <p className="text-xs font-semibold uppercase tracking-wide">{user.name}</p>
          {profile?.occupation && (
            <p className="text-xs text-muted">
              {profile.occupation}
              {profile.location ? ` · ${profile.location}` : ""}
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 lg:px-12">
            <button onClick={() => go("home")} className="lg:hidden">
              <span className="text-xl font-bold tracking-tight">FairShift</span>
            </button>
            <p className="hidden truncate text-sm text-muted lg:block">{breadcrumb}</p>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="hidden items-center gap-1.5 rounded-md bg-mist px-3 py-1.5 text-xs font-bold text-pine md:inline-flex">
                <Icon name="shield" className="size-3.5" />
                {t("Saved to your account")}
              </span>
              <LanguagePicker language={language} onChange={onLanguage} openOnMount={askLanguage} />
              <ProfileMenu user={user} onEditJob={onEditJob} onSignOut={onSignOut} />
            </div>
          </div>
        </header>

        <main key={page} className="w-full max-w-6xl flex-1 px-5 pb-28 pt-8 lg:px-12 lg:pb-12 lg:pt-12">
          {children}
        </main>

        <footer className="hidden px-12 pb-8 text-[11px] font-semibold uppercase tracking-wide text-muted lg:block">
          FairShift / {t("Your work. Your pay. Your voice.")}
        </footer>
      </div>

      {floating}

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {NAV.map((item) => (
          <button
            key={item.page}
            onClick={() => go(item.page)}
            aria-current={active === item.page ? "page" : undefined}
            className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition ${
              active === item.page ? "bg-mist text-forest" : "text-muted"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            {t(item.short)}
          </button>
        ))}
      </nav>
    </div>
  )
}
