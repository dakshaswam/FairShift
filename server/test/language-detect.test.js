import assert from "node:assert/strict"
import { test } from "node:test"
import { detectMessageLanguage, looksLikeWrongLanguage } from "../src/language-detect.js"

test("detects languages by script", () => {
  assert.equal(detectMessageLanguage("ओवरटाइम क्या होता है?"), "hi")
  assert.equal(detectMessageLanguage("초과근무 수당은 어떻게 계산하나요?"), "ko")
  assert.equal(detectMessageLanguage("残業代はいくらですか"), "ja")
  assert.equal(detectMessageLanguage("加班费怎么算"), "zh")
  assert.equal(detectMessageLanguage("ওভারটাইম কী?"), "bn")
  assert.equal(detectMessageLanguage("ما هو العمل الإضافي؟"), "ar")
  assert.equal(detectMessageLanguage("اوور ٹائم کیا ہے؟"), "ur")
  assert.equal(detectMessageLanguage("Что такое сверхурочные?"), "ru")
  assert.equal(detectMessageLanguage("Tôi chưa được trả tiền làm thêm giờ"), "vi")
})

test("leaves Latin-script and mixed messages to the chosen language", () => {
  assert.equal(detectMessageLanguage("What is overtime?"), null)
  assert.equal(detectMessageLanguage("¿Qué son las horas extra?"), null)
  assert.equal(detectMessageLanguage("I earn $15 at 加 Cafe"), null)
  assert.equal(detectMessageLanguage("$720"), null)
})

test("uses the chosen language to tell Japanese kanji from Chinese", () => {
  assert.equal(detectMessageLanguage("残業代", "ja"), "ja")
})

test("flags English or romanized answers for a non-English language", () => {
  assert.equal(looksLikeWrongLanguage("Minimum wage ka matlab hai sabse kam hourly pay jo boss ko dena hi hoga.", "hi"), true)
  assert.equal(looksLikeWrongLanguage("Overtime is the hours you work over 40 in one week, and you get 1.5 times your pay.", "es"), true)
  assert.equal(looksLikeWrongLanguage("ओवरटाइम का मतलब है — एक हफ़्ते में 40 घंटे से ज़्यादा काम। आपको $27 प्रति घंटा मिलना चाहिए।", "hi"), false)
  assert.equal(looksLikeWrongLanguage("Las horas extra son las horas que trabaja después de 40 en una semana.", "es"), false)
  assert.equal(looksLikeWrongLanguage("Anything at all in English is fine here.", "en"), false)
})
