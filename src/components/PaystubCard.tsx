import { useT } from "../i18n"
import { amount, type ProcessedPaystub } from "../paystub-api"
import { EnteredWage } from "./EnteredWage"

// The result of a pay stub upload, shown inside the assistant chat.
export function PaystubCard({
  result,
  hourlyWage,
  onEditWage,
}: {
  result: ProcessedPaystub
  hourlyWage?: number | null
  onEditWage?: () => void
}) {
  const t = useT()
  const stub = result.paystub
  const money = (value: string | null) => amount(value, stub.currency)
  return (
    <section className="mb-3 max-w-[68ch] rounded-2xl border border-emerald-200 border-s-[6px] border-s-emerald-600 bg-emerald-50 p-4 text-sm">
      <p className="font-bold text-emerald-950">
        {t("Current upload: {employer}", { employer: stub.employer_name ?? t("Employer not provided") })}
      </p>
      {(stub.pay_period_start || stub.pay_date) && (
        <p className="mt-0.5 text-xs text-emerald-900">
          {t("{start} to {end} · Pay date {date}", {
            start: stub.pay_period_start ?? t("Start not provided"),
            end: stub.pay_period_end ?? t("End not provided"),
            date: stub.pay_date ?? t("not provided"),
          })}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-emerald-800">{t("Gross pay")}</dt><dd className="text-lg font-bold">{money(stub.gross_pay)}</dd></div>
        <div><dt className="text-xs text-emerald-800">{t("Net pay")}</dt><dd className="text-lg font-bold">{money(stub.net_pay)}</dd></div>
        <div><dt className="text-xs text-emerald-800">{t("Regular hours / hourly rate")}</dt><dd className="font-bold">{stub.regular_hours ?? t("Not provided")} / {money(stub.regular_hourly_rate)}</dd></div>
        <div><dt className="text-xs text-emerald-800">{t("Overtime hours / pay listed")}</dt><dd className="font-bold">{stub.overtime_hours ?? t("Not provided")} / {money(stub.overtime_pay)}</dd></div>
      </dl>
      {result.warnings_display.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 ps-4 text-xs text-emerald-950">
          {result.warnings_display.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}
      {onEditWage && <EnteredWage hourlyWage={hourlyWage} stub={stub} onEdit={onEditWage} className="mt-3" />}
      <p className="mt-3 text-xs font-bold text-emerald-900">
        {result.source === "muse_live" ? t("Real Muse request · checked locally") : t("Mocked extraction · test data, not a live Muse response")}
      </p>
      <details className="mt-2 text-xs text-emerald-900">
        <summary className="cursor-pointer font-bold">
          {t("Text that was sent to Muse")}
          {result.redaction_retries > 0 ? ` · ${t("re-checked {n}×", { n: result.redaction_retries })}` : ""}
          {result.forced ? ` · ${t("sent after privacy retries")}` : ""}
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px] text-slate-700">{result.sent_text}</pre>
      </details>
    </section>
  )
}
