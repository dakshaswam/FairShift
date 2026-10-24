import { useEffect, useRef, useState } from "react"
import {
  chatWithAssistant,
  speechLang,
  type AssistantCard,
  type AssistantEvent,
  type HelpCategory,
  type PayCheckResult,
} from "../api"
import type { Paystub } from "../paystub-api"
import {
  assistantStrings,
  type AssistantMode,
  type AssistantStrings,
} from "./assistantStrings"
import { JobCard, PayRange } from "./JobPay"
import { PlaceCard, languageNames } from "./LocalHelp"

type Item =
  | { id: string; role: "user"; text: string }
  | {
      id: string
      role: "bot"
      text: string
      cards: AssistantCard[]
      status: "streaming" | "done" | "error"
      error?: string
      retry?: string
    }

type BotItem = Extract<Item, { role: "bot" }>

const MODES: AssistantMode[] = ["ask", "stub", "pay", "rights", "claim", "offer"]

// Kept outside the component so closing the drawer doesn't lose the chat.
const saved: {
  conversationId?: string
  items: Item[]
  replyOverride: string | null
} = { items: [], replyOverride: null }

let nextId = 0
const uid = () => `m${++nextId}`

function readSpeed(): "fast" | "careful" {
  try {
    return localStorage.getItem("fs-speed") === "careful" ? "careful" : "fast"
  } catch {
    return "fast"
  }
}

// Tiny Markdown renderer (paragraphs, lists, bold, italics, code). Escapes first.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1 text-[0.9em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")

function markdown(text: string) {
  const out: string[] = []
  text.split(/```/).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        `<pre class="my-2 overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm"><code>${esc(part.replace(/^[^\n]*\n/, "").replace(/\n$/, ""))}</code></pre>`,
      )
      return
    }
    let para: string[] = []
    let list: { tag: "ul" | "ol"; items: string[] } | null = null
    const flushPara = () => {
      if (para.length) out.push(`<p class="mb-3 last:mb-0">${inline(para.join(" "))}</p>`)
      para = []
    }
    const flushList = () => {
      if (list) {
        const cls = list.tag === "ul" ? "list-disc" : "list-decimal"
        out.push(
          `<${list.tag} class="mb-3 ${cls} space-y-1 ps-5 last:mb-0">${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`,
        )
      }
      list = null
    }
    for (const line of part.split("\n")) {
      const ul = line.match(/^\s*[-*•]\s+(.*)/)
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/)
      if (ul || ol) {
        flushPara()
        const tag = ul ? "ul" : "ol"
        if (list && list.tag !== tag) flushList()
        list ??= { tag, items: [] }
        list.items.push((ul ?? ol)![1])
      } else if (/^\s*$/.test(line)) {
        flushPara()
        flushList()
      } else {
        flushList()
        para.push(line.replace(/^#+\s*/, ""))
      }
    }
    flushPara()
    flushList()
  })
  return out.join("")
}

const plain = (s: string) =>
  s.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#]/g, "").replace(/\s+/g, " ")

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onerror: (event: { error: string }) => void
  onend: () => void
}

// Pay stubs reach the assistant only as the fields the worker approved in the
// private upload flow (PaystubPanel); the original photo or PDF is never sent here.
export function Assistant({
  language,
  initialMode = "ask",
  paystub,
  onLanguageChange,
  onUploadPaystub,
}: {
  language: string
  initialMode?: AssistantMode
  paystub: Paystub | null
  onLanguageChange: (language: string) => void
  onUploadPaystub: () => void
}) {
  const t = assistantStrings(language)
  const [items, setItems] = useState<Item[]>(saved.items)
  const [mode, setMode] = useState<AssistantMode>(initialMode)
  const [speed, setSpeed] = useState(readSpeed)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [voiceNote, setVoiceNote] = useState("")
  const [replyOverride, setReplyOverride] = useState(saved.replyOverride)

  const controllerRef = useRef<AbortController | null>(null)
  const pendingRef = useRef<string[]>([])
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastLanguage = useRef(language)

  useEffect(() => {
    saved.items = items
  }, [items])
  useEffect(() => {
    saved.replyOverride = replyOverride
  }, [replyOverride])

  // Picking a language in the header replaces any language set from the chat.
  useEffect(() => {
    if (lastLanguage.current !== language) {
      lastLanguage.current = language
      setReplyOverride(null)
    }
  }, [language])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [items])

  // Closing the drawer mid-answer cancels it; the server drops that turn too.
  useEffect(
    () => () => {
      controllerRef.current?.abort()
      recognizerRef.current?.stop()
      window.speechSynthesis?.cancel()
      if (pendingRef.current.length) {
        saved.items = saved.items.filter((item) => !pendingRef.current.includes(item.id))
      }
    },
    [],
  )

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel()
    setSpeakingId(null)
  }

  const toggleSpeak = (item: BotItem) => {
    if (speakingId === item.id) return stopSpeaking()
    stopSpeaking()
    if (!("speechSynthesis" in window)) return
    const utterance = new SpeechSynthesisUtterance(plain(item.text))
    utterance.lang = speechLang(language)
    utterance.rate = 0.95
    utterance.onend = utterance.onerror = () =>
      setSpeakingId((current) => (current === item.id ? null : current))
    setSpeakingId(item.id)
    window.speechSynthesis.speak(utterance)
  }

  const copy = (item: BotItem) => {
    navigator.clipboard?.writeText(item.text).then(() => {
      setCopiedId(item.id)
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500)
    })
  }

  const toggleMic = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Recognition) return setVoiceNote(t.voice.unsupported)
    if (recognizerRef.current) return recognizerRef.current.stop()

    stopSpeaking()
    const recognizer = new Recognition()
    recognizer.lang = speechLang(language)
    recognizer.interimResults = true
    recognizer.continuous = true
    const base = input ? `${input.replace(/\s+$/, "")} ` : ""
    let heard = false
    let errored = false
    recognizer.onresult = (event) => {
      let text = ""
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript
      heard = true
      setInput(base + text)
    }
    recognizer.onerror = (event) => {
      if (event.error === "aborted") return
      errored = true
      setVoiceNote(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? t.voice.blocked
          : t.voice.nospeech,
      )
    }
    recognizer.onend = () => {
      recognizerRef.current = null
      setMicOn(false)
      if (!errored) setVoiceNote(heard ? "" : t.voice.nospeech)
      inputRef.current?.focus()
    }
    recognizerRef.current = recognizer
    setMicOn(true)
    setVoiceNote(t.voice.listening)
    try {
      recognizer.start()
    } catch {
      recognizerRef.current = null
      setMicOn(false)
      setVoiceNote(t.voice.blocked)
    }
  }

  const errorText = (event: Extract<AssistantEvent, { type: "error" }>) =>
    event.message ??
    {
      refusal: t.errRefusal,
      rate_limited: t.errRate,
      not_configured: t.errNotConfigured,
      unavailable: t.errGeneric,
      error: t.errGeneric,
    }[event.code]

  const send = async (raw: string) => {
    if (busy) return
    const text = raw.trim()
    if (!text) return

    stopSpeaking()
    recognizerRef.current?.stop()
    setVoiceNote("")

    const userId = uid()
    const botId = uid()
    pendingRef.current = [userId, botId]
    setItems((current) => [
      ...current,
      { id: userId, role: "user", text },
      { id: botId, role: "bot", text: "", cards: [], status: "streaming" },
    ])
    setInput("")

    const updateBot = (change: (bot: BotItem) => BotItem) =>
      setItems((current) =>
        current.map((item) =>
          item.id === botId && item.role === "bot" ? change(item) : item,
        ),
      )
    const fail = (error: string) =>
      updateBot((bot) => ({
        ...bot,
        status: "error",
        error,
        retry: text,
      }))

    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    let finished = false
    try {
      await chatWithAssistant(
        {
          conversationId: saved.conversationId,
          message: text,
          paystub: paystub ?? undefined,
          mode,
          replyLanguage: replyOverride ?? language,
          speed,
        },
        (event) => {
          switch (event.type) {
            case "conversation":
              saved.conversationId = event.id
              break
            case "text":
              updateBot((bot) => ({ ...bot, text: event.text }))
              break
            case "card":
              updateBot((bot) => ({ ...bot, cards: [...bot.cards, event.card] }))
              break
            case "language":
              if (event.appLanguage) onLanguageChange(event.appLanguage)
              else setReplyOverride(event.language)
              break
            case "done":
              finished = true
              updateBot((bot) => ({ ...bot, status: "done" }))
              break
            case "error":
              finished = true
              fail(errorText(event))
              break
          }
        },
        controller.signal,
      )
      if (!finished) fail(t.errGeneric)
    } catch {
      if (controller.signal.aborted) {
        // Stopped: the server forgets this turn, so put the message back to edit.
        setItems((current) =>
          current.filter((item) => item.id !== userId && item.id !== botId),
        )
        setInput(text)
      } else {
        fail(t.errGeneric)
      }
    } finally {
      pendingRef.current = []
      controllerRef.current = null
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const retry = (item: BotItem) => {
    if (!item.retry) return
    const index = items.findIndex((i) => i.id === item.id)
    setItems((current) => current.filter((_, i) => i !== index && i !== index - 1))
    send(item.retry)
  }

  const newChat = () => {
    controllerRef.current?.abort()
    stopSpeaking()
    setItems([])
    saved.conversationId = undefined
  }

  const changeSpeed = (value: "fast" | "careful") => {
    setSpeed(value)
    try {
      localStorage.setItem("fs-speed", value)
    } catch {
      // Speed preference just won't be remembered.
    }
  }

  const pill =
    "inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-100 px-5 pb-3 pt-3">
        <div
          role="group"
          aria-label={t.modes.ask}
          className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
        >
          {MODES.map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-bold transition ${
                mode === m
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
              }`}
            >
              {t.modes[m]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500">{t.hints[mode]}</p>
        {paystub && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
            {t.usingStub}: {paystub.employer_name ?? "—"}
            {paystub.pay_date ? ` · ${paystub.pay_date}` : ""}
          </p>
        )}
      </div>

      <div
        ref={logRef}
        aria-live="polite"
        className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5"
      >
        {items.length === 0 ? (
          <div className="my-auto">
            <h3 className="max-w-[18ch] text-2xl font-extrabold leading-tight tracking-tight">
              {t.welcomeH}
            </h3>
            <p className="mt-2 max-w-md text-slate-600">{t.welcomeP}</p>
            <div className="mt-5 flex flex-col items-start gap-2">
              {t.starters.map((starter, i) => (
                <button
                  key={starter}
                  onClick={() => (i === 0 && !paystub ? onUploadPaystub() : send(starter))}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm font-semibold hover:border-emerald-600"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          items.map((item) =>
            item.role === "user" ? (
              <div
                key={item.id}
                className="max-w-[86%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 leading-relaxed text-white [overflow-wrap:anywhere]"
              >
                {item.text}
              </div>
            ) : (
              <div key={item.id} className="w-full">
                {item.cards.map((card, i) => (
                  <ChatCard key={i} card={card} t={t} language={language} />
                ))}
                {item.status === "error" ? (
                  <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900">
                    <p>{item.error}</p>
                    {item.retry && (
                      <button
                        onClick={() => retry(item)}
                        disabled={busy}
                        className="mt-2 font-bold underline"
                      >
                        {t.retry}
                      </button>
                    )}
                  </div>
                ) : item.text ? (
                  <div
                    className="max-w-[68ch] leading-relaxed text-slate-800 [overflow-wrap:anywhere]"
                    dangerouslySetInnerHTML={{ __html: markdown(item.text) }}
                  />
                ) : (
                  <p className="flex items-center gap-2 text-slate-500">
                    {t.thinking}
                    <span className="size-2 animate-ping rounded-full bg-emerald-600" />
                  </p>
                )}
                {item.status === "done" && item.text && (
                  <div className="mt-2 flex gap-1.5">
                    {"speechSynthesis" in window && (
                      <button
                        aria-pressed={speakingId === item.id}
                        onClick={() => toggleSpeak(item)}
                        className={`${pill} ${speakingId === item.id ? "border-emerald-600 bg-emerald-50 text-emerald-800" : ""}`}
                      >
                        🔊 {speakingId === item.id ? t.stopListen : t.listen}
                      </button>
                    )}
                    <button onClick={() => copy(item)} className={pill}>
                      {copiedId === item.id ? t.copied : t.copy}
                    </button>
                  </div>
                )}
              </div>
            ),
          )
        )}
      </div>

      <div className="border-t border-slate-200 px-4 pb-3 pt-3">
        {voiceNote && <p className="mb-2 text-sm text-slate-500">{voiceNote}</p>}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(input)
          }}
          className="flex items-end gap-2"
        >
          <button
            type="button"
            onClick={onUploadPaystub}
            aria-label={t.photo}
            title={t.photo}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-slate-200 hover:border-slate-400"
          >
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleMic}
            aria-label={t.mic}
            aria-pressed={micOn}
            title={t.mic}
            className={`grid size-11 shrink-0 place-items-center rounded-full border ${
              micOn
                ? "animate-pulse border-emerald-600 bg-emerald-50 text-emerald-700"
                : "border-slate-200 hover:border-slate-400"
            }`}
          >
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send(input)
              }
            }}
            placeholder={replyOverride ? `${t.placeholder} (${replyOverride})` : t.placeholder}
            className="max-h-40 min-w-0 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-2.5 outline-none focus:border-emerald-700"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => controllerRef.current?.abort()}
              className="h-11 shrink-0 rounded-2xl bg-slate-900 px-4 font-bold text-white"
            >
              {t.stop}
            </button>
          ) : (
            <button className="h-11 shrink-0 rounded-2xl bg-emerald-700 px-4 font-bold text-white hover:bg-emerald-800">
              {t.send}
            </button>
          )}
        </form>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div role="group" aria-label={t.speedLabel} className="flex gap-1">
            {(["fast", "careful"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={speed === value}
                onClick={() => changeSpeed(value)}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  speed === value
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                {t[value]}
              </button>
            ))}
          </div>
          <button
            onClick={newChat}
            className="text-xs font-semibold text-slate-500 underline"
          >
            {t.clear}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          {t.disclaimer}{" "}
          <a href="tel:18664879243" className="font-bold text-slate-800">
            1-866-487-9243
          </a>
        </p>
      </div>
    </div>
  )
}

function ChatCard({
  card,
  t,
  language,
}: {
  card: AssistantCard
  t: AssistantStrings
  language: string
}) {
  if (card.kind === "pay_check") return <PayCheckCard result={card.data} t={t} />

  if (card.kind === "help") {
    const groups = Object.entries(card.data.results) as [HelpCategory, NonNullable<(typeof card.data.results)[HelpCategory]>][]
    return (
      <section className="mb-3 max-w-[68ch] rounded-2xl border border-slate-200 border-s-[6px] border-s-emerald-600 p-4">
        <h4 className="text-sm font-bold text-slate-500">
          {t.helpTitle} · {card.data.location}
        </h4>
        {groups.map(([category, places]) =>
          places.length ? (
            <div key={category} className="mt-3">
              <p className="mb-2 text-sm font-bold">{t.categories[category]}</p>
              <div className="space-y-2">
                {places.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    languageName={languageNames[language]}
                  />
                ))}
              </div>
            </div>
          ) : null,
        )}
      </section>
    )
  }

  return (
    <section className="mb-3 max-w-[68ch] space-y-3 rounded-2xl border border-slate-200 border-s-[6px] border-s-sky-600 p-4">
      <h4 className="text-sm font-bold text-slate-500">
        {t.jobsTitle} · {card.data.jobTitle} · {card.data.location}
      </h4>
      {card.data.stats && (
        <PayRange
          stats={card.data.stats}
          wage={card.data.comparison?.yourHourlyWage}
        />
      )}
      {card.data.jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </section>
  )
}

function PayCheckCard({ result, t }: { result: PayCheckResult; t: AssistantStrings }) {
  const ok = result.total_underpayment <= 0
  const accent = ok ? "text-emerald-700" : "text-amber-700"
  return (
    <section
      className={`mb-3 max-w-[68ch] rounded-2xl border border-slate-200 border-s-[6px] p-4 ${
        ok ? "border-s-emerald-600" : "border-s-amber-500"
      }`}
    >
      <h4 className="mb-2 text-sm font-bold text-slate-500">
        {ok ? t.ok : t.estimateTitle}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              {[t.colWeek, t.colHours, t.colOwed, t.colPaid, t.colDiff].map((c, i) => (
                <th
                  key={c}
                  className={`whitespace-nowrap px-2 py-1 font-semibold ${i === 0 ? "ps-0 text-start" : "text-end"}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.weeks.map((week) => (
              <tr key={week.week} className="border-b border-slate-100">
                <td className="whitespace-nowrap py-1.5 pe-2">{week.week}</td>
                <td className="px-2 text-end">{week.hours}</td>
                <td className="px-2 text-end">{money(week.should_have_been_paid)}</td>
                <td className="px-2 text-end">{money(week.actually_paid)}</td>
                <td className={`px-2 text-end font-bold ${accent}`}>
                  {money(week.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{t.total}</span>
        <strong className={`text-3xl font-extrabold tracking-tight ${accent}`}>
          {money(result.total_underpayment)}
        </strong>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t.estNote}</p>
    </section>
  )
}
