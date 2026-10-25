// Tiny hash router: #/pay, #/help/local and so on, so the browser's back and
// forward buttons move between pages.
import { useEffect, useState } from "react"

export type Page =
  | "home" | "pay" | "upload" | "assistant"
  | "help" | "help/local" | "help/jobs" | "help/claim"

const PAGES: Page[] = ["home", "pay", "upload", "assistant", "help", "help/local", "help/jobs", "help/claim"]

const read = (): Page => {
  const path = window.location.hash.replace(/^#\/?/, "") as Page
  return PAGES.includes(path) ? path : "home"
}

export function useRoute() {
  const [page, setPage] = useState<Page>(read)
  useEffect(() => {
    const onChange = () => {
      setPage(read())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  const go = (next: Page) => {
    if (next === read()) return window.scrollTo({ top: 0, behavior: "smooth" })
    window.location.hash = `/${next}`
  }
  return [page, go] as const
}
