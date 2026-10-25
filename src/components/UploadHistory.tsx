import { useState } from "react"
import { deleteUpload, uploadFileUrl } from "../api"
import { speechLang, useT } from "../i18n"
import { dollars, type UploadSummary } from "../paystub-api"

// Every pay stub the worker has uploaded, newest first. "Use this one" makes it the
// current pay stub for the home screen and the assistant.
export function UploadHistory({
  uploads,
  currentId,
  language,
  onOpen,
  onDeleted,
}: {
  uploads: UploadSummary[]
  currentId: string | null
  language: string
  onOpen: (id: string) => void
  onDeleted: (id: string) => void
}) {
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const locale = speechLang(language)
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
  const money = (value: number | null) => (value == null ? "—" : dollars(value))

  const remove = async (id: string) => {
    if (!window.confirm(t("Delete this pay stub and its photo? This can’t be undone."))) return
    setBusyId(id)
    setError("")
    try {
      await deleteUpload(id)
      onDeleted(id)
    } catch {
      setError(t("We couldn’t delete it. Try again."))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">{t("Upload history")}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {t("Every pay stub you upload is saved privately to your account. Only you can see it, and you can delete it anytime.")}
      </p>
      {error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      {uploads.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{t("No uploads yet.")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {uploads.map((upload) => {
            const current = upload.id === currentId
            return (
              <li key={upload.id} className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center ${current ? "rounded-xl bg-emerald-50 px-3" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {upload.employer_name ?? t("Employer not provided")}
                    {current && (
                      <span className="ms-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{t("Current")}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t("Uploaded {date}", { date: when(upload.created_at) })}
                    {upload.pay_date ? ` · ${t("Pay date {date}", { date: upload.pay_date })}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {t("Gross {gross} · Net {net}", { gross: money(upload.gross_pay), net: money(upload.net_pay) })}
                    {upload.regular_hourly_rate != null && ` · ${t("{wage}/hr", { wage: dollars(upload.regular_hourly_rate) })}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!current && (
                    <button onClick={() => onOpen(upload.id)} className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white">
                      {t("Use this one")}
                    </button>
                  )}
                  <a
                    href={uploadFileUrl(upload.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold hover:border-slate-500"
                  >
                    {t("View file")}
                  </a>
                  <button
                    onClick={() => remove(upload.id)}
                    disabled={busyId === upload.id}
                    className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {t("Delete")}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
