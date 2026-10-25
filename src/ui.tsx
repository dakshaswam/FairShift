// Shared building blocks for the FairShift look: buttons, cards, page headers,
// notes, icons and an animated money counter.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react"

export type IconName =
  | "home" | "file" | "help" | "shield" | "camera" | "chevron" | "briefcase" | "map"
  | "volume" | "check" | "chat" | "upload" | "clock" | "scale" | "globe" | "x" | "arrow"

const ICONS: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  help: <><path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 15.5h.01" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-5" /></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2" /></>,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />,
  volume: <path d="M5 10h3l4-3v10l-4-3H5zM15 9c1.5 1.7 1.5 4.3 0 6M18 7c2.7 2.8 2.7 7.2 0 10" />,
  check: <path d="m5 12 4 4L19 6" />,
  chat: <><path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z" /><path d="M8.5 9.5h7M8.5 12.5h4.5" /></>,
  upload: <><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  scale: <><path d="M12 4v16M5 20h14M6 8h12" /><path d="m6 8-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
}

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${className} rtl:-scale-x-100`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  )
}

const BUTTON = {
  primary: "bg-pine text-white hover:bg-forest",
  lime: "bg-lime text-forest hover:bg-[#cfe48a]",
  outline: "border border-line bg-white text-pine hover:border-pine",
  ghost: "text-pine hover:bg-mist",
  danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "px-3.5 py-2 text-xs", md: "px-5 py-3 text-sm", lg: "px-6 py-3.5 text-base" }
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-bold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${sizes[size]} ${BUTTON[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({ className = "", dark = false, children }: { className?: string; dark?: boolean; children: ReactNode }) {
  const tone = dark ? "border-forest bg-forest text-white" : "border-line bg-white"
  return <div className={`rounded-2xl border p-6 ${tone} ${className}`}>{children}</div>
}

// A dark forest panel, as used for the main message on a page.
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl bg-forest p-6 text-white sm:p-8 ${className}`}>{children}</div>
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`text-xs font-bold uppercase tracking-wide ${dark ? "text-lime-text" : "text-pine"}`}>{children}</p>
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-md bg-mist px-2.5 py-1 text-xs font-bold text-pine ${className}`}>{children}</span>
}

export function Note({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-mist p-5">
      {title && <p className="font-bold text-forest">{title}</p>}
      <div className={`text-sm text-muted ${title ? "mt-1" : ""}`}>{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex animate-rise flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-forest sm:text-[2.6rem] sm:leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// Counts up to a dollar amount once, when it first appears (skipped for reduced motion).
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value)
  const previous = useRef<number | null>(null)
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const from = previous.current ?? 0
    previous.current = value
    if (reduced || from === value) return setShown(value)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700)
      const eased = 1 - (1 - progress) ** 3
      setShown(from + (value - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{format(shown)}</>
}
