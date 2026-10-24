// Works out which language a worker is writing in from the script they use, and
// checks that an answer is really in the language it should be. Only languages
// with a distinctive script (or, for Vietnamese, distinctive accents) are
// detected; Latin-script languages such as Spanish are left to the model.

const SCRIPTS = {
  ko: /[가-힯ᄀ-ᇿ㄰-㆏]/gu,
  kana: /[぀-ヿ]/gu,
  han: /[一-鿿]/gu,
  hi: /[ऀ-ॿ]/gu,
  bn: /[ঀ-৿]/gu,
  arabic: /[؀-ۿݐ-ݿ]/gu,
  ru: /[Ѐ-ӿ]/gu,
}
// Letters Urdu uses that Arabic does not.
const URDU_ONLY = /[ٹڈڑںےھۓ]/u
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/giu
const LETTER = /\p{L}/gu

const count = (text, pattern) => text.match(pattern)?.length ?? 0

// Returns a language code ("hi", "ko", ...) when the message is clearly written
// in a script that identifies the language, otherwise null.
export function detectMessageLanguage(text, chosenCode = "en") {
  const letters = count(text, LETTER)
  if (letters < 2) return null
  const share = (pattern) => count(text, pattern) / letters

  if (share(SCRIPTS.ko) > 0.3) return "ko"
  if (share(SCRIPTS.kana) > 0.1) return "ja"
  if (share(SCRIPTS.han) > 0.3) return chosenCode === "ja" ? "ja" : "zh"
  if (share(SCRIPTS.hi) > 0.3) return "hi"
  if (share(SCRIPTS.bn) > 0.3) return "bn"
  if (share(SCRIPTS.arabic) > 0.3) {
    if (chosenCode === "ur" || URDU_ONLY.test(text)) return "ur"
    return "ar"
  }
  if (share(SCRIPTS.ru) > 0.3) return "ru"
  if (count(text, VIETNAMESE) >= 2) return "vi"
  return null
}

const SCRIPT_OF = {
  ko: SCRIPTS.ko,
  ja: /[぀-ヿ一-鿿]/gu,
  zh: SCRIPTS.han,
  hi: SCRIPTS.hi,
  bn: SCRIPTS.bn,
  ar: SCRIPTS.arabic,
  ur: SCRIPTS.arabic,
  ru: SCRIPTS.ru,
}
const ENGLISH_WORDS = new Set(
  "the and you your is are to of for in it this that with be will can have not if on or what how".split(" "),
)

// True when an answer that should be in `code` is mostly English (or, for a
// non-Latin language, mostly not in that language's script).
export function looksLikeWrongLanguage(text, code) {
  if (!text || code === "en") return false
  // Ignore amounts, phone numbers, URLs and markdown before measuring.
  const body = text.replace(/https?:\/\/\S+/g, " ").replace(/[$\d*_#`[\]()|.,:;!?%/-]+/g, " ")
  const letters = count(body, LETTER)
  if (letters < 20) return false
  const script = SCRIPT_OF[code]
  if (script) return count(body, script) / letters < 0.5
  const words = body.toLowerCase().match(/\p{L}+/gu) ?? []
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length
  return words.length >= 8 && english / words.length > 0.2
}
