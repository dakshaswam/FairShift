import type { User } from "../api"
import { EnteredWage } from "../components/EnteredWage"
import { useT } from "../i18n"
import { dollars, type PaystubResult } from "../paystub-api"
import type { Page } from "../route"
import { Button, Card, CountUp, Eyebrow, Icon, Note, PageHeader, Panel, type IconName } from "../ui"

export function HomePage({
  user,
  language,
  result,
  go,
  speaking,
  onSpeak,
  onStop,
  onEditWage,
}: {
  user: User
  language: string
  result: PaystubResult | null
  go: (page: Page) => void
  speaking: boolean
  onSpeak: (text: string) => void
  onStop: () => void
  onEditWage: () => void
}) {
  const t = useT()
  const stub = result?.paystub ?? null
  const hour = new Date().getHours()
  const name = user.name.split(" ")[0]
  const greeting =
    hour < 12 ? t("Good morning, {name}.", { name }) : hour < 18 ? t("Good afternoon, {name}.", { name }) : t("Good evening, {name}.", { name })
  const net = stub?.net_pay != null ? Number(stub.net_pay) : null

  const actions: { title: string; text: string; button: string; icon: IconName; page: Page }[] = [
    { title: t("Understand your pay"), text: t("Take a photo or upload a PDF. See each line in plain language."), button: t("Check a pay stub"), icon: "file", page: "upload" },
    { title: t("Compare local pay"), text: t("See what similar jobs advertise near your work location."), button: t("Compare my pay"), icon: "briefcase", page: "help/jobs" },
    { title: t("Find support nearby"), text: t("Explore worker centers and independent legal help."), button: t("Find local help"), icon: "map", page: "help/local" },
  ]

  return (
    <>
      <PageHeader title={greeting} subtitle={t("Your work, your pay, all in one place.")} />

      <div className="stagger grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <Panel className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-pine/50 blur-3xl" />
          <Eyebrow dark>{t("Your paycheck, made clear")}</Eyebrow>
          <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {t("Every line.")}
            <br />
            {t("A little more clarity.")}
          </h2>
          <p className="mt-4 text-white/85">{t("Understand your hours, rates and deductions.")}</p>
          <Button variant="lime" size="lg" className="mt-6" onClick={() => go("upload")}>
            {t("Check a pay stub")}
          </Button>
        </Panel>

        <div className="flex flex-col gap-4">
          <Card className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {stub ? `${t("Current upload")} · ${stub.employer_name ?? t("Employer not provided")}` : t("No pay stub yet")}
            </p>
            <p className="mt-3 text-4xl font-bold tracking-tight">
              {net != null ? <CountUp value={net} format={dollars} /> : "—"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {stub ? t("Net pay from your latest pay stub") : t("Upload a pay stub to see your take-home pay here.")}
            </p>
          </Card>
          <Button variant="outline" onClick={() => go(stub ? "pay" : "upload")}>
            {stub ? t("Review this upload") : t("Upload a pay stub")}
          </Button>
        </div>
      </div>

      <div className="stagger mt-5 grid gap-5 md:grid-cols-3">
        {actions.map((action) => (
          <Card key={action.page} className="lift flex flex-col">
            <span className="grid size-10 place-items-center rounded-xl bg-mist text-pine">
              <Icon name={action.icon} />
            </span>
            <h3 className="mt-4 text-xl font-bold">{action.title}</h3>
            <p className="mt-2 flex-1 text-muted">{action.text}</p>
            <Button variant="outline" className="mt-6 w-full" onClick={() => go(action.page)}>
              {action.button}
            </Button>
          </Card>
        ))}
      </div>

      <div className="stagger mt-5 grid gap-5 md:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <span className="grid size-10 place-items-center rounded-xl bg-mist text-pine">
              <Icon name="volume" />
            </span>
            <div className="flex gap-2">
              {speaking ? (
                <Button variant="danger" size="sm" onClick={onStop}>■ {t("Stop")}</Button>
              ) : (
                <Button variant="outline" size="sm" disabled={!result} onClick={() => result && onSpeak(result.assistant_message)} aria-label={t("Play pay explanation")}>
                  ▶ {t("Play")}
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={!result} onClick={() => result && onSpeak(result.assistant_message)}>
                ↺ {t("Repeat")}
              </Button>
            </div>
          </div>
          <h3 className="mt-4 text-xl font-bold">{t("Listen in {language}", { language })}</h3>
          <p className="mt-2 text-muted">
            {result ? t("Listen to this upload’s extracted summary.") : t("Upload a paystub to hear its summary.")}
          </p>
          {speaking && (
            <div className="mt-4 flex h-6 items-end gap-1" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6].map((bar) => (
                <span key={bar} className="w-1.5 animate-pulse rounded-full bg-pine" style={{ height: `${30 + ((bar * 37) % 70)}%`, animationDelay: `${bar * 90}ms` }} />
              ))}
            </div>
          )}
        </Card>
        <Card>
          <span className="grid size-10 place-items-center rounded-xl bg-mist text-pine">
            <Icon name="scale" />
          </span>
          <h3 className="mt-4 text-xl font-bold">{t("Your pay")}</h3>
          <EnteredWage hourlyWage={user.profile?.hourlyWage} stub={stub} onEdit={onEditWage} className="mt-3 border-0 bg-paper" />
        </Card>
      </div>

      <div className="mt-5 animate-rise">
        <Note title={t("Your records belong to you.")}>
          {t("Your pay stubs are saved privately to your account. You can delete them anytime.")}
        </Note>
      </div>
    </>
  )
}
