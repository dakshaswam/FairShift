// Languages FairShift searches in. `hl` is the Google interface language, so place
// types, hours and descriptions come back in the worker's language.
// `keywords` are what we look for in a listing to flag "may speak your language".
// `defaultCountry` is a starting guess for the consulate search; the worker can override it.

export const LANGUAGES = {
  en: { name: "English", native: "English", hl: "en", keywords: [], defaultCountry: null },
  es: {
    name: "Spanish",
    native: "Español",
    hl: "es",
    keywords: ["spanish", "español", "espanol", "hablamos", "hispan", "latin"],
    defaultCountry: "Mexico",
  },
  hi: {
    name: "Hindi",
    native: "हिन्दी",
    hl: "hi",
    keywords: ["hindi", "हिन्दी", "south asian", "desi", "indian"],
    defaultCountry: "India",
  },
  vi: {
    name: "Vietnamese",
    native: "Tiếng Việt",
    hl: "vi",
    keywords: ["vietnam", "tiếng việt"],
    defaultCountry: "Vietnam",
  },
  zh: {
    name: "Chinese",
    native: "中文",
    hl: "zh-CN",
    keywords: ["chinese", "mandarin", "cantonese", "中文", "华人", "華人"],
    defaultCountry: "China",
  },
  tl: {
    name: "Tagalog",
    native: "Tagalog",
    hl: "tl",
    keywords: ["tagalog", "filipino", "pilipino"],
    defaultCountry: "Philippines",
  },
  ko: {
    name: "Korean",
    native: "한국어",
    hl: "ko",
    keywords: ["korean", "한국"],
    defaultCountry: "South Korea",
  },
  ar: {
    name: "Arabic",
    native: "العربية",
    hl: "ar",
    keywords: ["arabic", "arab", "عربي"],
    defaultCountry: null,
  },
  ht: {
    name: "Haitian Creole",
    native: "Kreyòl",
    hl: "ht",
    keywords: ["haitian", "creole", "kreyòl", "kreyol"],
    defaultCountry: "Haiti",
  },
  pt: {
    name: "Portuguese",
    native: "Português",
    hl: "pt",
    keywords: ["portuguese", "português", "brazil", "brasil"],
    defaultCountry: "Brazil",
  },
  bn: {
    name: "Bengali",
    native: "বাংলা",
    hl: "bn",
    keywords: ["bengali", "bangla", "বাংলা", "bangladesh"],
    defaultCountry: "Bangladesh",
  },
  fr: {
    name: "French",
    native: "Français",
    hl: "fr",
    keywords: ["french", "français", "francais", "francophone", "parlons français"],
    defaultCountry: null,
  },
  ru: {
    name: "Russian",
    native: "Русский",
    hl: "ru",
    keywords: ["russian", "русский", "русскоязычн", "по-русски"],
    defaultCountry: "Russia",
  },
  ur: {
    name: "Urdu",
    native: "اردو",
    hl: "ur",
    keywords: ["urdu", "اردو", "pakistani"],
    defaultCountry: "Pakistan",
  },
  pl: {
    name: "Polish",
    native: "Polski",
    hl: "pl",
    keywords: ["polish", "polski", "po polsku"],
    defaultCountry: "Poland",
  },
  it: {
    name: "Italian",
    native: "Italiano",
    hl: "it",
    keywords: ["italian", "italiano", "parliamo italiano"],
    defaultCountry: "Italy",
  },
  de: {
    name: "German",
    native: "Deutsch",
    hl: "de",
    keywords: ["german", "deutsch", "wir sprechen deutsch"],
    defaultCountry: "Germany",
  },
  ja: {
    name: "Japanese",
    native: "日本語",
    hl: "ja",
    keywords: ["japanese", "日本語", "日系"],
    defaultCountry: "Japan",
  },
}

// Accept codes ("es", "es-US") as well as the names the app shows ("Español").
export function resolveLanguage(input) {
  if (!input) return { code: "en", ...LANGUAGES.en }
  const value = String(input).trim().toLowerCase()
  const code = value.split(/[-_]/)[0]
  if (LANGUAGES[code]) return { code, ...LANGUAGES[code] }
  for (const [key, lang] of Object.entries(LANGUAGES)) {
    if (lang.native.toLowerCase() === value || lang.name.toLowerCase() === value) {
      return { code: key, ...lang }
    }
  }
  return { code: "en", ...LANGUAGES.en }
}
