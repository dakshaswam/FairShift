import { uploadFileUrl } from "../api"
import { EnteredWage } from "../components/EnteredWage"
import { UploadHistory } from "../components/UploadHistory"
import { useT } from "../i18n"
import { amount, dollars, type PaystubResult, type ProcessedPaystub, type UploadSummary } from "../paystub-api"
import type { Page } from "../route"
import { Button, Card, CountUp, Icon, PageHeader, Pill } from "../ui"

const num = (value: string | null | undefined) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-3.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function PayRecordsPage({
  result,
  uploads,
  currentUploadId,
  language,
  hourlyWage,
  go,
  onOpenUpload,
  onDeletedUpload,
  onEditWage,
  onAsk,
}: {
  result: PaystubResult | null
  uploads: UploadSummary[]
  currentUploadId: string | null
  language: string
  hourlyWage?: number | null
  go: (page: Page) => void
  onOpenUpload: (id: string) => void
  onDeletedUpload: (id: string) => void
  onEditWage: () => void
  onAsk: (question: string) => void
}) {
  const t = useT()
  const stub = result?.paystub ?? null
  const history = (
    <UploadHistory uploads={uploads} currentId={currentUploadId} language={language} onOpen={onOpenUpload} onDeleted={onDeletedUpload} />
  )

  if (!stub) {
    return (
      <>
        <PageHeader title={t("Your pay records start here.")} subtitle={t("Upload a pay stub to see its hours, rates, deductions and pay.")} />
        <Card className="animate-rise py-14 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-mist text-pine">
            <Icon name="file" className="size-7" />
          </span>
          <h2 className="mt-5 text-2xl font-bold">{t("No pay stub yet")}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{t("Upload a document to see its actual hours, rates, deductions and pay.")}</p>
          <Button size="lg" className="mt-6" onClick={() => go("upload")}>
            {t("Upload a pay stub")}
          </Button>
        </Card>
        {uploads.length > 0 && history}
      </>
    )
  }

  const money = (value: string | null) => amount(value, stub.currency)
  // "Regular · 80.00 hrs × $18.00"
  const hoursLabel = (name: string, hours: string | null, rate: string | null) =>
    [name, [hours && `${hours} ${t("hrs")}`, rate && money(rate)].filter(Boolean).join(" × ")].filter(Boolean).join(" · ")
  const deductionTotal = stub.deductions.reduce((sum, row) => sum + (num(row.amount) ?? 0), 0)
  const stats = [
    { label: t("Gross pay"), value: num(stub.gross_pay) },
    { label: t("Deductions"), value: stub.deductions.length ? deductionTotal : null },
    { label: t("Take-home pay"), value: num(stub.net_pay) },
  ]
  const upload = (result as ProcessedPaystub).upload
  const notes = (result as ProcessedPaystub).warnings_display ?? stub.warnings

  return (
    <>
      <PageHeader
        title={t("Your paycheck, line by line.")}
        subtitle={[stub.employer_name ?? t("Employer not provided"), stub.pay_date && t("Pay date {date}", { date: stub.pay_date })].filter(Boolean).join(" · ")}
        action={
          <Button onClick={() => go("upload")}>
            <Icon name="upload" className="size-4" /> {t("Check a new pay stub")}
          </Button>
        }
      />

      <div className="stagger grid gap-5 sm:grid-cols-3">
        {stats.map((stat, index) => (
          <Card key={stat.label} dark={index === 2} className={`p-5 sm:p-6 ${index === 2 ? "order-first sm:order-none" : ""}`}>
            <p className={`text-sm ${index === 2 ? "text-lime-text" : "text-muted"}`}>{stat.label}</p>
            <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">
              {stat.value == null ? "—" : <CountUp value={stat.value} format={dollars} />}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="stagger space-y-5">
          <Card>
            <h2 className="text-xl font-bold">{t("Earnings")}</h2>
            <p className="mt-1 text-sm text-muted">{t("Amounts listed on this document")}</p>
            <div className="mt-3">
              <Line
                label={hoursLabel(t("Regular"), stub.regular_hours, stub.regular_hourly_rate)}
                value={money(stub.regular_pay)}
              />
              {(stub.overtime_hours || stub.overtime_pay) && (
                <Line
                  label={hoursLabel(t("Overtime"), stub.overtime_hours, stub.overtime_hourly_rate)}
                  value={money(stub.overtime_pay)}
                />
              )}
              {stub.tips && <Line label={t("Tips")} value={money(stub.tips)} />}
              {stub.other_earnings.map((row, index) => (
                <Line key={index} label={row.label ?? t("Other")} value={money(row.amount)} />
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-bold">{t("Deductions")}</h2>
            <p className="mt-1 text-sm text-muted">{t("Withheld from gross pay")}</p>
            <div className="mt-3">
              {stub.deductions.length ? (
                stub.deductions.map((row, index) => <Line key={index} label={row.label ?? t("Other")} value={money(row.amount)} />)
              ) : (
                <p className="py-3 text-muted">{t("No readable deduction lines were found.")}</p>
              )}
            </div>
          </Card>
        </div>

        <div className="stagger space-y-5">
          <Card>
            <h2 className="text-xl font-bold">{t("What does this mean?")}</h2>
            <p className="mt-2 text-muted">
              {t("Gross pay is the amount before deductions. Net pay is what remains after deductions.")}
            </p>
            <Button className="mt-5 w-full" onClick={() => onAsk(t("Explain my pay stub."))}>
              <Icon name="chat" className="size-4" /> {t("Ask about this pay stub")}
            </Button>
          </Card>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{t("Review extracted values")}</h2>
              <Pill>{t("Review needed")}</Pill>
            </div>
            <p className="mt-2 text-muted">{t("Compare these numbers with the original document. Reading a pay stub does not decide unpaid wages.")}</p>
            {notes.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-forest/80">
                {notes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            )}
            <EnteredWage hourlyWage={hourlyWage} stub={stub} onEdit={onEditWage} className="mt-4 bg-paper" />
            {upload && (
              <a href={uploadFileUrl(upload.id)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-pine hover:underline">
                {t("View original file")} <Icon name="arrow" className="size-4" />
              </a>
            )}
          </Card>
        </div>
      </div>

      {history}
    </>
  )
}
