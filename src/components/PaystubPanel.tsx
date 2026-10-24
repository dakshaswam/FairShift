import { useEffect, useRef, useState } from "react"
import { EnteredWage } from "./EnteredWage"
import { amount, answerPaystubQuestion, extractionSourceLabel, PaystubRequestError, processPaystub, type PaystubResult, type ProcessedPaystub } from "../paystub-api"

type Message = { role: "assistant" | "user"; text: string }

const isProcessed = (result: PaystubResult | null): result is ProcessedPaystub => Boolean(result && "sent_text" in result)

// Upload → local OCR and redaction → automatic send to Muse. No approval click:
// the backend re-redacts and retries if its privacy check objects, and the text
// that was actually sent is shown afterwards.
export function PaystubPanel({ result, onResult, onAskAssistant, hourlyWage, onEditWage }: { result: PaystubResult | null; onResult: (result: PaystubResult | null) => void; onAskAssistant?: () => void; hourlyWage?: number | null; onEditWage?: () => void }) {
  const [status, setStatus] = useState<"idle" | "processing" | "done">(result ? "done" : "idle")
  const [error, setError] = useState("")
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState<Message[]>(result ? [{ role: "assistant", text: result.assistant_message }] : [])
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { sequence.current += 1; controller.current?.abort() }, [])

  const reset = () => {
    sequence.current += 1
    controller.current?.abort()
    controller.current = null
    setMessages([])
    setQuestion("")
    setError("")
    setStatus("idle")
    onResult(null)
  }

  const selectFile = async (file: File | undefined) => {
    if (!file) return
    reset()
    const current = sequence.current
    const activeController = new AbortController()
    controller.current = activeController
    setStatus("processing")
    try {
      const processed = await processPaystub(file, activeController.signal)
      if (sequence.current !== current) return
      setStatus("done")
      setMessages([{ role: "assistant", text: processed.assistant_message }])
      onResult(processed)
    } catch (reason) {
      if (sequence.current !== current) return
      setError(reason instanceof PaystubRequestError ? `${reason.stage}: ${reason.message}` : reason instanceof Error ? reason.message : "Processing failed. Choose the document again.")
      setStatus("idle")
      onResult(null)
    }
  }

  const ask = () => {
    if (!question.trim() || !result || status !== "done") return
    const text = question.trim()
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: answerPaystubQuestion(result.paystub, text) }])
    setQuestion("")
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-4 overflow-y-auto p-5">
      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <span className="block font-bold">Upload a paystub photo or PDF</span>
        <span className="mt-2 block text-xs leading-relaxed text-slate-600">We read it on this computer, hide your personal details, then send only that cleaned text to Muse.</span>
        <input type="file" aria-label="Upload paystub" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" className="mt-4 block w-full text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void selectFile(file) }} />
      </label>
      {status === "processing" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Reading your paystub, hiding personal details and checking the numbers… This usually takes a few seconds.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {(status === "processing" || status === "done") && <button onClick={reset} className="text-sm font-bold text-slate-600 underline">{status === "processing" ? "Cancel" : "Clear this upload"}</button>}
      {result && status === "done" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><p className="font-bold text-emerald-950">Current upload: {result.paystub.employer_name ?? "Employer not provided"}</p><p className="mt-1 text-emerald-900">Gross {amount(result.paystub.gross_pay, result.paystub.currency)} · Net {amount(result.paystub.net_pay, result.paystub.currency)}</p><p className="mt-2 text-xs font-bold text-emerald-900">{extractionSourceLabel(result.source)}</p><p className="mt-2 text-xs text-emerald-900">Compare these numbers with your paystub; reading it is not a wage-law determination.</p>{result.paystub.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-emerald-950">{result.paystub.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}{onEditWage && <EnteredWage hourlyWage={hourlyWage} stub={result.paystub} onEdit={onEditWage} className="mt-3" />}{onAskAssistant && <button onClick={onAskAssistant} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white">Ask the assistant about this pay stub</button>}</div>}
      {isProcessed(result) && status === "done" && <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"><summary className="cursor-pointer font-bold">Text that was sent to Muse{result.redaction_retries > 0 ? ` · re-checked ${result.redaction_retries}×` : ""}{result.forced ? " · sent after privacy retries" : ""}</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-700">{result.sent_text}</pre></details>}
      {messages.map((item, index) => <div key={index} className={`max-w-[95%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed ${item.role === "user" ? "ml-auto bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>{item.text}</div>)}
      {!result && status === "idle" && !error && <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600">Choose a document to begin. There is no current paystub result.</p>}
    </div>
    <form className="border-t border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); ask() }}>
      <div className="flex gap-2"><input aria-label="Question about current paystub" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!result || status !== "done"} placeholder={result ? "Ask about hours, rates, overtime or deductions" : "Upload a paystub first"} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-emerald-700 disabled:bg-slate-100" /><button disabled={!result || status !== "done" || !question.trim()} className="rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">Send</button></div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">Quick answers use this upload’s numbers, without another Muse request.</p>
    </form>
  </div>
}
