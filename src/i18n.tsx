// Tiny i18n layer. The English text is the key: t("Get help").
// - English (or any missing key) falls back to the key itself.
// - Placeholders look like {name} and are filled from the second argument.
// - To add a language: create src/locales/xx.ts, import it below, and add one row to
//   LANGUAGE_OPTIONS (and to LANGUAGES in server/src/languages.js for searches).
import { createContext, useContext, type ReactNode } from "react"
import ar from "./locales/ar"
import bn from "./locales/bn"
import de from "./locales/de"
import es from "./locales/es"
import fr from "./locales/fr"
import hi from "./locales/hi"
import ht from "./locales/ht"
import it from "./locales/it"
import ja from "./locales/ja"
import ko from "./locales/ko"
import pl from "./locales/pl"
import pt from "./locales/pt"
import ru from "./locales/ru"
import tl from "./locales/tl"
import ur from "./locales/ur"
import vi from "./locales/vi"
import zh from "./locales/zh"

export type Translate = (
  text: string,
  vars?: Record<string, string | number>,
) => string

type LanguageOption = {
  label: string // each language written in itself; this is also what we store in the profile
  name: string // English name, used for search badges
  speech: string // BCP-47 tag for speech synthesis and voice input
  dir: "ltr" | "rtl"
}

// English plus the 17 languages the server can search in (see server/src/languages.js).
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { label: "English", name: "English", speech: "en-US", dir: "ltr" },
  { label: "Español", name: "Spanish", speech: "es-US", dir: "ltr" },
  { label: "中文", name: "Chinese", speech: "zh-CN", dir: "ltr" },
  { label: "Tiếng Việt", name: "Vietnamese", speech: "vi-VN", dir: "ltr" },
  { label: "Tagalog", name: "Tagalog", speech: "fil-PH", dir: "ltr" },
  { label: "العربية", name: "Arabic", speech: "ar-SA", dir: "rtl" },
  { label: "Français", name: "French", speech: "fr-FR", dir: "ltr" },
  { label: "한국어", name: "Korean", speech: "ko-KR", dir: "ltr" },
  { label: "Русский", name: "Russian", speech: "ru-RU", dir: "ltr" },
  { label: "Kreyòl", name: "Haitian Creole", speech: "ht-HT", dir: "ltr" },
  { label: "हिन्दी", name: "Hindi", speech: "hi-IN", dir: "ltr" },
  { label: "Português", name: "Portuguese", speech: "pt-BR", dir: "ltr" },
  { label: "বাংলা", name: "Bengali", speech: "bn-BD", dir: "ltr" },
  { label: "اردو", name: "Urdu", speech: "ur-PK", dir: "rtl" },
  { label: "Polski", name: "Polish", speech: "pl-PL", dir: "ltr" },
  { label: "Italiano", name: "Italian", speech: "it-IT", dir: "ltr" },
  { label: "Deutsch", name: "German", speech: "de-DE", dir: "ltr" },
  { label: "日本語", name: "Japanese", speech: "ja-JP", dir: "ltr" },
]

const dictionaries: Record<string, Record<string, string>> = {
  Español: es,
  中文: zh,
  "Tiếng Việt": vi,
  Tagalog: tl,
  العربية: ar,
  한국어: ko,
  Kreyòl: ht,
  हिन्दी: hi,
  Português: pt,
  বাংলা: bn,
  Français: fr,
  Русский: ru,
  اردو: ur,
  Polski: pl,
  Italiano: it,
  Deutsch: de,
  日本語: ja,
}

const optionFor = (language: string) =>
  LANGUAGE_OPTIONS.find((option) => option.label === language)

export const speechLang = (language: string) =>
  optionFor(language)?.speech ?? "en-US"

export const languageDir = (language: string) =>
  optionFor(language)?.dir ?? "ltr"

export function translator(language: string): Translate {
  const dictionary = dictionaries[language]
  return (text, vars) => {
    let out = dictionary?.[text] ?? text
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{${name}}`).join(String(value))
      }
    }
    return out
  }
}

const I18nContext = createContext<Translate>(translator("English"))

export function I18nProvider({
  language,
  children,
}: {
  language: string
  children: ReactNode
}) {
  return (
    <I18nContext.Provider value={translator(language)}>
      {children}
    </I18nContext.Provider>
  )
}

export const useT = () => useContext(I18nContext)

// Marks text that is translated later through a variable, e.g. t(item.label), so
// scripts/check-translations.mjs can still find it. Returns the text unchanged.
export const tk = (text: string) => text
