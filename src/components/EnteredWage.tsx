import { useT } from "../i18n"
import { dollars, isUsd, type Paystub } from "../paystub-api"

// Shows the hourly pay the worker entered in their profile, next to the rate on
// their uploaded pay stub, and points out when the two don't match.
export function EnteredWage({
  hourlyWage,
  stub,
  onEdit,
  className = "",
}: {
  hourlyWage: number | null | undefined
  stub: Paystub | null
  onEdit: () => void
  className?: string
}) {
  const t = useT()
  const stubRate =
    stub?.regular_hourly_rate && isUsd(stub.currency)
      ? Number(stub.regular_hourly_rate)
      : null
  const differs =
    hourlyWage != null && stubRate != null && Math.abs(stubRate - hourlyWage) >= 0.01

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-3 text-sm ${className}`}>
      {hourlyWage != null ? (
        <p>
          {t("Hourly pay you entered:")}{" "}
          <strong>{t("{wage}/hr", { wage: dollars(hourlyWage) })}</strong>
          {stubRate != null && !differs && (
            <span className="text-emerald-700"> · {t("matches this pay stub")}</span>
          )}
        </p>
      ) : (
        <p className="text-slate-600">{t("You haven’t entered your hourly pay yet.")}</p>
      )}
      {differs && (
        <p className="mt-1 text-amber-800">
          {t("This pay stub shows {rate}/hr. If that’s your pay now, update your profile so job comparisons use it.", { rate: dollars(stubRate) })}
        </p>
      )}
      <button onClick={onEdit} className="mt-1 font-bold text-emerald-700 underline">
        {hourlyWage != null ? t("Update my pay") : t("Add my hourly pay")}
      </button>
    </div>
  )
}
