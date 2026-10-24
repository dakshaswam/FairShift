import { useEffect, useRef, useState } from "react"
import { amount, answerPaystubQuestion, extractionSourceLabel, extractPaystub, PaystubRequestError, preparePaystub, type PaystubResult, type PreparedPaystub, type TraceStage } from "../paystub-api"

type Message = { role: "assistant" | "user"; text: string }

export function PaystubPanel({ result, onResult, onAskAssistant }: { result: PaystubResult | null; onResult: (result: PaystubResult | null) => void; onAskAssistant?: () => void }) {
  const [prepared, setPrepared] = useState<PreparedPaystub | null>(null)
  const [preview, setPreview] = useState("")
  const [status, setStatus] = useState<"idle" | "preparing" | "review" | "extracting" | "done">(result ? "done" : "idle")
  const [trace, setTrace] = useState<TraceStage[]>(result?.trace ?? [])
  const [error, setError] = useState("")
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState<Message[]>(result ? [{ role: "assistant", text: result.assistant_message }] : [])
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => () => { sequence.current += 1; controller.current?.abort() }, [])

  const reset = () => {
    sequence.current += 1
    controller.current?.abort()
    controller.current = null
    setPrepared(null)
    setPreview("")
    setTrace([])
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
    setStatus("preparing")
    try {
      const local = await preparePaystub(file, activeController.signal)
      if (sequence.current !== current) return
      setPrepared(local)
      setPreview(local.redacted_text)
      setTrace(local.trace)
      setStatus("review")
    } catch (reason) {
      if (sequence.current !== current) return
      setError(reason instanceof PaystubRequestError ? `${reason.stage}: ${reason.message}` : reason instanceof Error ? reason.message : "Local document preparation failed. Nothing was sent to Gemini.")
      setStatus("idle")
      onResult(null)
    }
  }

  const approve = async () => {
    if (!prepared || status !== "review" || !preview.trim()) return
    const current = sequence.current
    const local = prepared
    const approvedText = preview
    const activeController = new AbortController()
    controller.current = activeController
    setError("")
    setStatus("extracting")
    setMessages([])
    onResult(null)
    try {
      const extracted = await extractPaystub(local, approvedText, activeController.signal)
      if (sequence.current !== current || extracted.upload_id !== local.upload_id) return
      const completed = { ...extracted, trace: [...local.trace.filter((stage) => stage.status !== "pending"), ...extracted.trace] }
      setPrepared(null)
      setPreview("")
      setTrace(completed.trace)
      setStatus("done")
      setMessages([{ role: "assistant", text: completed.assistant_message }])
      onResult(completed)
    } catch (reason) {
      if (sequence.current !== current) return
      setMessages([])
      onResult(null)
      setError(reason instanceof PaystubRequestError ? `${reason.stage}: ${reason.message}` : reason instanceof Error ? reason.message : "Extraction failed. No result is available; choose the document again.")
      // An expired or rejected approval needs a fresh upload; anything else (a Gemini
      // hiccup, a network error) keeps the reviewed text so the worker can retry.
      if (reason instanceof PaystubRequestError && reason.stage === "approval") {
        setPrepared(null)
        setPreview("")
        setTrace([])
        setStatus("idle")
      } else {
        setStatus("review")
      }
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
        <span className="mt-2 block text-xs leading-relaxed text-slate-600">Local OCR first. Review the redacted text before anything goes to Gemini.</span>
        <input ref={input} type="file" aria-label="Upload paystub" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" className="mt-4 block w-full text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void selectFile(file) }} />
      </label>
      <p className="text-xs leading-relaxed text-slate-500">The original file goes to the machine running the Python service for local extraction. Only text you review and approve is sent to Gemini. No raw file or chat history is saved by this workflow.</p>
      {status === "preparing" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Extracting text locally and redacting personal information… Gemini has not been called.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {status === "review" && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="font-bold text-amber-950">Review the exact text to send</h3>
        <p className="mt-2 text-sm text-amber-950/80">Check every line. Replace any remaining personal information with placeholders such as [NAME_1]. Payroll amounts will remain visible to Google after approval.</p>
        <textarea aria-label="Redacted text to approve" value={preview} onChange={(event) => setPreview(event.target.value)} rows={15} className="mt-4 w-full rounded-xl border border-amber-300 bg-white p-3 font-mono text-xs text-slate-900" spellCheck={false} />
        <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void approve()} disabled={!preview.trim()} className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Approve this text and extract</button><button onClick={reset} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold">Cancel and clear</button></div>
      </section>}
      {status === "extracting" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Extracting the approved text with Gemini, then validating the result and checking arithmetic…</p>}
      {(status === "preparing" || status === "extracting" || status === "done") && <button onClick={reset} className="text-sm font-bold text-slate-600 underline">Cancel and clear this upload</button>}
      {trace.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"><summary className="cursor-pointer font-bold">Processing stages · {result ? extractionSourceLabel(result.source) : "local preparation"}</summary><ol className="mt-2 space-y-1">{trace.map((item, index) => <li key={`${item.stage}-${index}`}>{item.stage}: {item.status}{item.mode ? ` (${item.mode})` : ""}</li>)}</ol></details>}
      {result && status === "done" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><p className="font-bold text-emerald-950">Current upload: {result.paystub.employer_name ?? "Employer not provided"}</p><p className="mt-1 text-emerald-900">Gross {amount(result.paystub.gross_pay, result.paystub.currency)} · Net {amount(result.paystub.net_pay, result.paystub.currency)}</p><p className="mt-2 text-xs font-bold text-emerald-900">{extractionSourceLabel(result.source)}</p><p className="mt-2 text-xs text-emerald-900">Review the source document; extraction is not a wage-law determination.</p>{result.paystub.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-emerald-950">{result.paystub.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}{onAskAssistant && <button onClick={onAskAssistant} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white">Ask the assistant about this pay stub</button>}</div>}
      {messages.map((item, index) => <div key={index} className={`max-w-[95%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed ${item.role === "user" ? "ml-auto bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>{item.text}</div>)}
      {!result && status === "idle" && !error && <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600">Choose a document to begin. There is no current paystub result.</p>}
    </div>
    <form className="border-t border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); ask() }}>
      <div className="flex gap-2"><input aria-label="Question about current paystub" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!result || status !== "done"} placeholder={result ? "Ask about hours, rates, overtime or deductions" : "Extract a current paystub first"} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-emerald-700 disabled:bg-slate-100" /><button disabled={!result || status !== "done" || !question.trim()} className="rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">Send</button></div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">Answers use this upload’s validated fields. Questions are handled locally without another Gemini request.</p>
    </form>
  </div>
}
