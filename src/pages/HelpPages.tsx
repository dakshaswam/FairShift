import { JobPay } from "../components/JobPay"
import { LocalHelp } from "../components/LocalHelp"
import { useT } from "../i18n"
import { amount, isUsd, type PaystubResult } from "../paystub-api"
import type { Page } from "../route"
import { Button, Card, Eyebrow, Icon, Note, PageHeader, Panel, type IconName } from "../ui"

export function HelpPage({ go, onAsk }: { go: (page: Page) => void; onAsk: () => void }) {
  const t = useT()
  const options: { title: string; text: string; button: string; icon: IconName; page: Page }[] = [
    { title: t("Review a pay concern"), text: t("Understand what evidence a pay review may need before starting a claim."), button: t("Start a wage claim"), icon: "file", page: "help/claim" },
    { title: t("Find independent help"), text: t("Explore nearby legal aid, worker centers and consular support."), button: t("See local help"), icon: "help", page: "help/local" },
    { title: t("Find a better opportunity"), text: t("Compare advertised pay for similar work near you."), button: t("Browse jobs"), icon: "briefcase", page: "help/jobs" },
  ]
  return (
    <>
      <PageHeader title={t("You don’t have to figure it out alone.")} subtitle={t("Find the next step that feels right for you.")} />
      <div className="stagger grid gap-5 md:grid-cols-3">
        {options.map((option) => (
          <Card key={option.page} className="lift flex flex-col">
            <h2 className="text-xl font-bold">{option.title}</h2>
            <p className="mt-2 text-muted">{option.text}</p>
            <span className="mt-8 grid size-11 place-items-center rounded-xl bg-mist text-pine">
              <Icon name={option.icon} className="size-6" />
            </span>
            <div className="flex-1" />
            <Button className="mt-6 w-full" onClick={() => go(option.page)}>
              {option.button}
            </Button>
          </Card>
        ))}
      </div>
      <Panel className="mt-6 flex animate-rise flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold">{t("Not sure where to start?")}</h2>
          <p className="mt-2 text-white/85">{t("Ask a question in the language you feel most comfortable with.")}</p>
        </div>
        <Button variant="lime" size="lg" className="sm:min-w-56" onClick={onAsk}>
          <Icon name="chat" className="size-5" /> {t("Ask FairShift")}
        </Button>
      </Panel>
      <p className="mt-6 text-sm text-muted">{t("Support searches use your chosen location. Contact each organization to confirm availability.")}</p>
    </>
  )
}

export function LocalHelpPage({ language, location }: { language: string; location: string }) {
  const t = useT()
  return (
    <>
      <PageHeader title={t("Find support near you.")} subtitle={t("Search independent services by city or ZIP code.")} />
      <div className="animate-rise">
        <LocalHelp language={language} defaultLocation={location} embedded />
      </div>
    </>
  )
}

export function JobsPage({
  language,
  location,
  occupation,
  hourlyWage,
  result,
}: {
  language: string
  location: string
  occupation?: string
  hourlyWage?: number | null
  result: PaystubResult | null
}) {
  const t = useT()
  const stub = result?.paystub
  const stubRate = stub?.regular_hourly_rate && isUsd(stub.currency) ? Number(stub.regular_hourly_rate) : undefined
  return (
    <>
      <PageHeader title={t("Know what your work is worth.")} subtitle={t("Compare advertised pay for similar jobs near you.")} />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card className="animate-rise">
          <h2 className="mb-4 text-xl font-bold">{t("Tell us about your work")}</h2>
          <JobPay
            language={language}
            defaultLocation={location}
            defaultJobTitle={occupation ?? ""}
            defaultWage={hourlyWage ?? stubRate}
            autoSearch={Boolean(occupation)}
            embedded
          />
        </Card>
        <Panel className="h-fit animate-rise">
          <h2 className="text-2xl font-bold leading-tight">{t("A clearer view of your options.")}</h2>
          <p className="mt-4 text-white/85">
            {t("FairShift looks at real job posts near you and compares their advertised pay with yours.")}
          </p>
          <p className="mt-6 text-sm text-lime-text">
            {t("Pay ranges come from what employers posted. Confirm pay and conditions with each employer.")}
          </p>
        </Panel>
      </div>
    </>
  )
}

export function ClaimPage({ result, go, onWrite }: { result: PaystubResult | null; go: (page: Page) => void; onWrite: () => void }) {
  const t = useT()
  const stub = result?.paystub
  const needs = [
    { label: t("Pay stubs and deposits"), value: stub ? t("1 pay stub saved") : t("Your documents") },
    { label: t("Hours and schedules"), value: t("Your records") },
    { label: t("Pay agreement and messages"), value: t("Your agreement") },
  ]
  return (
    <>
      <PageHeader title={t("Start with what you know.")} subtitle={t("A pay stub is one piece of a bigger picture.")} />
      <Panel className="animate-rise">
        <Eyebrow dark>{t("Unpaid wages")}</Eyebrow>
        <h2 className="mt-4 text-4xl font-bold tracking-tight">{t("Not determined")}</h2>
        <p className="mt-3 text-white/85">
          {stub?.overtime_pay
            ? t("Your pay stub lists {amount} of overtime pay. A pay stub alone does not establish a wage violation.", { amount: amount(stub.overtime_pay, stub.currency) })
            : t("A pay stub alone does not establish a wage violation.")}
        </p>
      </Panel>
      <div className="stagger mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="text-xl font-bold">{t("What a review may need")}</h2>
          <p className="mt-1 text-muted">{t("Gather relevant documents before deciding what to do.")}</p>
          <div className="mt-4">
            {needs.map((need) => (
              <div key={need.label} className="flex items-center justify-between gap-4 border-b border-line/70 py-3.5 last:border-0">
                <span className="text-muted">{need.label}</span>
                <span className="font-semibold">{need.value}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col">
          <h2 className="text-xl font-bold">{t("Talk it through")}</h2>
          <p className="mt-2 flex-1 text-muted">
            {t("The assistant asks a few simple questions and fills in a wage claim form you can print, sign and bring to the labor office.")}
          </p>
          <Button className="mt-6 w-full" onClick={onWrite}>
            <Icon name="chat" className="size-4" /> {t("Write my claim summary")}
          </Button>
        </Card>
      </div>
      <div className="mt-5 flex animate-rise flex-wrap items-center gap-4">
        <Button variant="outline" onClick={() => go("help/local")}>{t("Find independent legal help")}</Button>
      </div>
      <div className="mt-5 animate-rise">
        <Note title={t("Before you contact a service")}>
          {t("Bring pay stubs, pay agreements, messages and any work records you have.")}
        </Note>
      </div>
    </>
  )
}
