import { useEffect, useRef, useState } from "react"
import { languageName, useT } from "../i18n"
import { processPaystub, type PaystubResult, type PaystubStage } from "../paystub-api"
import type { Page } from "../route"
import { Button, Card, Icon, Note, PageHeader, Pill } from "../ui"

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp"

// The server reports each step as it starts it; the list follows along.
const STEP_INDEX: Record<PaystubStage, number> = { read: 0, mask: 1, extract: 2, check: 3 }

export function UploadPage({
  language,
  go,
  onResult,
  onAsk,
}: {
  language: string
  go: (page: Page) => void
  onResult: (result: PaystubResult) => void
  onAsk: () => void
}) {
  const t = useT()
  const [state, setState] = useState<"idle" | "processing" | "error">("idle")
  const [step, setStep] = useState(0)
  const [error, setError] = useState("")
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const steps = [
    { title: t("Read document text"), active: t("Reading the text on this computer"), done: t("Local reading complete") },
    { title: t("Mask personal details"), active: t("Hiding names, numbers and addresses"), done: t("Personal details hidden") },
    { title: t("Extract pay information"), active: t("Finding hours, rates and pay"), done: t("Pay information found") },
    { title: t("Check the math"), active: t("Comparing totals"), done: t("Totals checked") },
  ]

  const upload = async (file: File | undefined) => {
    if (!file) return
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setError("")
    setStep(0)
    setState("processing")
    try {
      const result = await processPaystub(file, active.signal, languageName(language), (stage) => {
        if (!active.signal.aborted) setStep(STEP_INDEX[stage])
      })
      setStep(4)
      onResult(result)
      window.setTimeout(() => go("pay"), 600)
    } catch (reason) {
      if (active.signal.aborted) return setState("idle")
      setError(reason instanceof Error ? reason.message : "")
      setState("error")
    }
  }

  const cancel = () => {
    controller.current?.abort()
    setState("idle")
  }

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ""
        void upload(file)
      }}
    />
  )

  if (state === "processing") {
    return (
      <>
        <PageHeader title={t("Reading your pay stub.")} subtitle={t("We’re turning the document into information you can review.")} />
        <Card className="animate-rise p-6 sm:p-10">
          <Pill className="uppercase">{t("Processing")}</Pill>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">{t("A little clarity is on the way.")}</h2>
          <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-mist">
            <div className="absolute inset-y-0 start-0 rounded-full bg-pine transition-all duration-700" style={{ width: `${Math.max(8, step * 25)}%` }} />
          </div>
          <ol className="mt-6 space-y-3">
            {steps.map((item, index) => {
              const done = index < step
              const current = index === step
              return (
                <li
                  key={item.title}
                  className={`grid grid-cols-[2.5rem_1fr] items-center gap-2 rounded-xl px-4 py-4 transition-colors duration-500 sm:grid-cols-[2.5rem_1fr_1.2fr] ${
                    done ? "bg-mist" : current ? "bg-mist/60" : "bg-paper"
                  }`}
                >
                  <span className={`grid size-7 place-items-center rounded-full text-sm font-bold ${done ? "bg-pine text-white" : "text-pine"}`}>
                    {done ? <Icon name="check" className="size-4" /> : `0${index + 1}`}
                  </span>
                  <span className="font-semibold">{item.title}</span>
                  <span className="col-start-2 flex items-center gap-2 text-sm text-muted sm:col-start-3">
                    {current && <span className="size-2 animate-ping rounded-full bg-pine" />}
                    {done ? item.done : current ? item.active : t("Waiting")}
                  </span>
                </li>
              )
            })}
          </ol>
        </Card>
        <div className="mt-6 flex animate-rise flex-wrap items-center gap-4">
          <Button variant="outline" onClick={cancel}>{t("Cancel")}</Button>
          <p className="text-sm text-muted">{t("Keep this page open while we read the document.")}</p>
        </div>
      </>
    )
  }

  if (state === "error") {
    return (
      <>
        <PageHeader title={t("Let’s try a clearer document.")} subtitle={t("We couldn’t reliably read this pay stub.")} />
        {input}
        <Card className="animate-rise">
          <Pill className="bg-amber-100 uppercase text-amber-900">{t("Upload needs attention")}</Pill>
          <h2 className="mt-5 text-2xl font-bold">{t("Some lines are too hard to read.")}</h2>
          <p className="mt-2 text-muted">{t("Try a sharper photo with the whole page visible, or upload the original PDF.")}</p>
          {error && <p className="mt-3 rounded-xl bg-paper p-3 text-sm text-muted">{error}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => fileRef.current?.click()}>{t("Choose another file")}</Button>
            <Button variant="outline" onClick={onAsk}>{t("Ask for help")}</Button>
          </div>
        </Card>
        <div className="mt-5 animate-rise">
          <Note title={t("No values were invented.")}>{t("When a line can’t be read, FairShift leaves it empty instead of guessing.")}</Note>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title={t("Make sense of your paycheck.")} subtitle={t("Upload a PDF or a clear photo of your pay stub.")} />
      {input}
      <div className="stagger grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void upload(event.dataTransfer.files?.[0])
          }}
          className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all ${
            dragging ? "scale-[1.01] border-pine bg-mist" : "border-line bg-white"
          }`}
        >
          <span className={`grid size-16 place-items-center rounded-2xl bg-mist text-pine transition-transform ${dragging ? "-translate-y-1" : ""}`}>
            <Icon name="camera" className="size-8" />
          </span>
          <h2 className="mt-6 text-2xl font-bold">{t("Drop your pay stub here")}</h2>
          <p className="mt-2 text-muted">{t("A clear photo works too. Keep every line visible.")}</p>
          <Button size="lg" className="mt-7 min-w-56" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" className="size-4" /> {t("Choose a file")}
          </Button>
          <p className="mt-4 text-xs text-muted">PDF, PNG, JPEG, TIFF, BMP, WebP</p>
        </div>
        <div className="space-y-5">
          <Card>
            <h3 className="text-lg font-bold">{t("A clearer photo helps")}</h3>
            <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-muted">
              <li>{t("Use good lighting.")}</li>
              <li>{t("Lay the document flat.")}</li>
              <li>{t("Include all pay and deduction lines.")}</li>
              <li>{t("Avoid glare and blurry text.")}</li>
            </ol>
          </Card>
          <Card>
            <h3 className="text-lg font-bold">{t("What happens next?")}</h3>
            <p className="mt-2 text-muted">
              {t("Your personal details are hidden on this computer first. Then FairShift reads the pay lines and checks the math.")}
            </p>
          </Card>
        </div>
      </div>
      <div className="mt-5 animate-rise">
        <Note title={t("You stay in control")}>
          {t("Your pay stub is saved privately to your account. Compare the results with your original, and delete it anytime.")}
        </Note>
      </div>
    </>
  )
}
