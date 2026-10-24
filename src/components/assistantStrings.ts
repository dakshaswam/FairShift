// Interface text for the FairShift assistant. Every string goes through the app's
// translator, so it follows the language picker; translations live in src/locales.
// The assistant's replies can be in any language (see set_language on the server).
import type { Translate } from "../i18n"

export type AssistantMode = "ask" | "stub" | "pay" | "rights" | "claim" | "offer"

export function assistantStrings(t: Translate) {
  return {
    placeholder: t("Ask about your pay, hours or rights"),
    send: t("Send"),
    stop: t("Stop"),
    listen: t("Listen"),
    stopListen: t("Stop audio"),
    copy: t("Copy"),
    copied: t("Copied"),
    photo: t("Add pay stub photo"),
    usingStub: t("Using your uploaded pay stub"),
    mic: t("Speak"),
    clear: t("New chat"),
    disclaimer: t("General information, not legal advice. Rules can differ by state and city. Free U.S. Labor Dept. helpline:"),
    welcomeH: t("Let’s check that you were paid fairly."),
    welcomeP: t("Ask in your language. You can also add a photo of your pay stub and every line will be explained."),
    starters: [
      t("Explain my pay stub"),
      t("Did I get paid the right overtime?"),
      t("I work for tips. Is my pay legal?"),
      t("Who can help me near me?"),
    ],
    thinking: t("Thinking"),
    errGeneric: t("That message didn’t go through. Send it again."),
    retry: t("Try again"),
    errBusy: t("Wait for the current answer to finish."),
    errRate: t("Too many requests. Wait a moment and try again."),
    errNotConfigured: t("The assistant isn’t set up yet. Ask the app team to add the AI key."),
    errRefusal: t("I can’t help with that one. Try asking another way, or call the free helpline below."),
    estimateTitle: t("Estimated underpayment"),
    colWeek: t("Week"),
    colHours: t("Hours"),
    colOwed: t("Should be paid"),
    colPaid: t("You were paid"),
    colDiff: t("Difference"),
    total: t("Total owed"),
    estNote: t("Estimate using federal rules. Your state may require more."),
    ok: t("No underpayment found"),
    helpTitle: t("Help near you"),
    jobsTitle: t("Jobs near you"),
    categories: {
      legal_aid: t("Free legal aid"),
      worker_center: t("Worker centers"),
      consulate: t("Your consulate"),
    },
    fast: t("Fast"),
    careful: t("Careful"),
    speedLabel: t("Answer speed"),
    modes: {
      ask: t("Ask anything"),
      stub: t("Pay stub"),
      pay: t("Check my pay"),
      rights: t("My rights"),
      claim: t("Build a claim"),
      offer: t("Job offer"),
    },
    hints: {
      ask: t("Ask about pay, hours, rights or jobs."),
      stub: t("Add a photo of your pay stub. I’ll explain every line and point out what to check."),
      pay: t("Tell me your hours and pay. I’ll work out if you were underpaid."),
      rights: t("Learn your wage rights in simple words, including what to do if you’re afraid to speak up."),
      claim: t("I’ll ask a few questions and write a summary you can bring to the Labor Department or a worker center."),
      offer: t("Tell me about a job offer. I’ll look for warning signs and questions to ask."),
    },
    voice: {
      listening: t("Listening… speak now. Tap the microphone to stop."),
      unsupported: t("Voice typing isn’t supported in this browser. Try Chrome or Safari, or use the microphone on your keyboard."),
      blocked: t("The microphone is blocked. Allow microphone access in your browser, or use the microphone on your keyboard."),
      nospeech: t("I didn’t hear anything. Tap the microphone and try again."),
    },
  }
}

export type AssistantStrings = ReturnType<typeof assistantStrings>
