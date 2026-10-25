import { useEffect, useState, type ComponentProps } from "react"
import type { AssistantRequest } from "../App"
import { Assistant } from "../components/Assistant"
import { useT } from "../i18n"
import { amount, type PaystubResult } from "../paystub-api"
import { Card, PageHeader } from "../ui"

// A request (mode, question, upload) is used once; coming back to the page later
// must not send the same question again.
let consumedRequest = 0

export function AssistantPage({
  request,
  result,
  assistantProps,
}: {
  request: AssistantRequest | null
  result: PaystubResult | null
  assistantProps: Omit<ComponentProps<typeof Assistant>, "initialMode">
}) {
  const t = useT()
  // useState keeps the same value across React's dev-mode double mount.
  const [fresh] = useState(() => (request && request.id !== consumedRequest ? request : null))
  useEffect(() => {
    if (fresh) consumedRequest = fresh.id
  }, [fresh])
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>()

  const stub = result?.paystub
  const suggestions = [
    t("Why are there deductions?"),
    t("What does overtime mean?"),
    t("Was I paid correctly?"),
    t("Who can help me near me?"),
  ]

  return (
    <>
      <PageHeader title={t("Let’s talk about your pay.")} subtitle={t("Ask a question, upload a pay stub, or use your voice.")} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="flex h-[calc(100dvh-16rem)] min-h-[560px] animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <Assistant
            {...assistantProps}
            initialMode={fresh?.mode ?? "ask"}
            initialQuestion={fresh?.question}
            startUpload={fresh?.upload}
            ask={ask}
          />
        </div>
        <div className="stagger space-y-5">
          <Card>
            <h2 className="text-lg font-bold">{t("Your current upload")}</h2>
            {stub ? (
              <ul className="mt-3 space-y-1 text-sm text-muted">
                <li className="font-semibold text-forest">{stub.employer_name ?? t("Employer not provided")}</li>
                {stub.regular_hours && (
                  <li>{t("{hours} regular hours · {rate}/hr", { hours: stub.regular_hours, rate: amount(stub.regular_hourly_rate, stub.currency) })}</li>
                )}
                {stub.overtime_hours && (
                  <li>{t("{hours} overtime hours · {amount} listed", { hours: stub.overtime_hours, amount: amount(stub.overtime_pay, stub.currency) })}</li>
                )}
                <li>{t("Net pay · {amount}", { amount: amount(stub.net_pay, stub.currency) })}</li>
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">{t("No pay stub yet. Tap the camera button in the chat to upload one.")}</p>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-bold">{t("Try asking")}</h2>
            <div className="mt-3 flex flex-col items-start gap-1">
              {suggestions.map((text) => (
                <button
                  key={text}
                  onClick={() => setAsk({ text, id: Date.now() })}
                  className="rounded-lg px-2 py-1.5 text-start text-sm text-muted transition hover:bg-mist hover:text-forest"
                >
                  {text}
                </button>
              ))}
            </div>
          </Card>
          <p className="px-1 text-xs text-muted">
            {t("Explanations use your current pay stub. A pay stub alone does not decide legally owed wages.")}
          </p>
        </div>
      </div>
    </>
  )
}
