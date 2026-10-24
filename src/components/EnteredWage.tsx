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
          Hourly pay you entered: <strong>{dollars(hourlyWage)}/hr</strong>
          {stubRate != null && !differs && (
            <span className="text-emerald-700"> · matches this pay stub</span>
          )}
        </p>
      ) : (
        <p className="text-slate-600">You haven’t entered your hourly pay yet.</p>
      )}
      {differs && (
        <p className="mt-1 text-amber-800">
          This pay stub shows <strong>{dollars(stubRate)}/hr</strong>. If that’s your
          pay now, update your profile so job comparisons use it.
        </p>
      )}
      <button onClick={onEdit} className="mt-1 font-bold text-emerald-700 underline">
        {hourlyWage != null ? "Update my pay" : "Add my hourly pay"}
      </button>
    </div>
  )
}
