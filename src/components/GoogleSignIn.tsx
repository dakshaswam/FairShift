import { useEffect, useRef, useState } from "react"
import { getAuthConfig, signInWithGoogle, type User } from "../api"
import { useT } from "../i18n"

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (response: { credential: string }) => void
        ux_mode?: "popup"
      }) => void
      renderButton: (
        element: HTMLElement,
        options: Record<string, string | number>,
      ) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

let scriptPromise: Promise<GoogleIdentity> | null = null

function loadGoogleScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.onload = () =>
      window.google ? resolve(window.google) : reject(new Error("no google"))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error("Google sign-in could not load"))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

// The official "Sign in with Google" button. Calls onSignedIn once the
// FairShift server has verified the Google account and started a session.
export function GoogleSignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const t = useT()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState("")
  const [signingIn, setSigningIn] = useState(false)
  const onSignedInRef = useRef(onSignedIn)
  onSignedInRef.current = onSignedIn

  useEffect(() => {
    let cancelled = false
    Promise.all([getAuthConfig(), loadGoogleScript()])
      .then(([config, google]) => {
        if (cancelled || !buttonRef.current) return
        if (!config.googleClientId) {
          setError(t("Google sign-in isn't set up on the server yet."))
          return
        }
        google.accounts.id.initialize({
          client_id: config.googleClientId,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            setSigningIn(true)
            setError("")
            try {
              onSignedInRef.current(await signInWithGoogle(credential))
            } catch (reason) {
              setError((reason as Error).message)
              setSigningIn(false)
            }
          },
        })
        google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          // Google writes the button in the page's language (set from the language picker).
          locale: document.documentElement.lang || "en",
          width: Math.min(buttonRef.current.offsetWidth || 360, 400),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("We couldn't load Google sign-in. Check your connection and refresh."))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <div
        ref={buttonRef}
        className={`flex min-h-11 w-full justify-center ${signingIn ? "pointer-events-none opacity-50" : ""}`}
      />
      {signingIn && (
        <p className="mt-3 text-center text-sm font-semibold text-emerald-700">
          {t("Signing you in…")}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-center text-sm text-rose-900">
          {error}
        </p>
      )}
    </div>
  )
}
