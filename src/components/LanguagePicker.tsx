import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { LANGUAGE_OPTIONS, useT } from "../i18n"

// A button that opens a centered panel with every language, each written in its own
// language so a worker can find theirs without reading English. The panel is portaled
// to <body> so a blurred sticky header can't trap its fixed positioning.
export function LanguagePicker({
  language,
  onChange,
  openOnMount = false,
}: {
  language: string
  onChange: (language: string) => void
  // Open the panel as soon as it appears, so the first thing a worker does is pick a language.
  openOnMount?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(openOnMount)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("Language")}: ${language}`}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:border-slate-400"
      >
        <svg
          aria-hidden="true"
          className="size-4 text-emerald-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        {language}
        <svg
          aria-hidden="true"
          className="size-3.5 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 grid animate-fade place-items-center bg-slate-950/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Choose your language")}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl animate-rise overflow-y-auto overscroll-contain rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold">{t("Choose your language")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("Close")}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl"
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = option.label === language
                return (
                  <button
                    key={option.label}
                    type="button"
                    lang={option.speech.split("-")[0]}
                    aria-current={selected}
                    onClick={() => {
                      onChange(option.label)
                      setOpen(false)
                    }}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-start transition ${
                      selected
                        ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                        : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <span>
                      <span className="block text-base font-bold sm:text-lg">
                        {option.label}
                      </span>
                      {t(option.name).toLowerCase() !==
                        option.label.toLowerCase() && (
                        <span className="block text-sm font-normal text-slate-500">
                          {t(option.name)}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <svg
                        aria-hidden="true"
                        className="size-5 shrink-0 text-emerald-700"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
