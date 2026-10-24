// Compares a worker's hourly pay with what similar jobs nearby are advertising
// (Google Jobs via SerpApi) and lists the openings that pay more.

import { serpSearch } from "./serpapi.js"
import { parseSalary, percentileOf, round2, summarize } from "./salary.js"

const FULL_TIME_HOURS_PER_YEAR = 2080

export async function comparePay({ jobTitle, location, hourlyWage, language, pages = 2 }) {
  const postings = await fetchPostings({ jobTitle, location, pages })

  const jobs = postings.map(normalizeJob)
  const paid = jobs.filter((job) => job.pay)
  const mids = paid.map((job) => job.pay.hourly.mid)
  const stats = summarize(mids)

  let comparison = null
  if (Number.isFinite(hourlyWage) && stats) {
    const diffPerHour = round2(stats.median - hourlyWage)
    comparison = {
      yourHourlyWage: hourlyWage,
      marketMedian: stats.median,
      percentile: percentileOf(mids, hourlyWage),
      diffPerHour,
      diffPerYearFullTime: Math.round(diffPerHour * FULL_TIME_HOURS_PER_YEAR),
      verdict:
        hourlyWage < Math.min(stats.p25, stats.median * 0.95)
          ? "below_market"
          : hourlyWage > stats.p75
            ? "above_market"
            : "at_market",
    }
  }

  for (const job of jobs) {
    job.paysMoreBy =
      job.pay && Number.isFinite(hourlyWage) ? round2(job.pay.hourly.mid - hourlyWage) : null
  }

  const betterPaying = Number.isFinite(hourlyWage)
    ? paid.filter((job) => job.paysMoreBy > 0).sort((a, b) => b.paysMoreBy - a.paysMoreBy)
    : []

  return {
    stats,
    comparison,
    summary: summaryText({ language, jobTitle, location, stats, comparison }),
    betterPaying,
    jobs,
  }
}

async function fetchPostings({ jobTitle, location, pages }) {
  const postings = []
  const seen = new Set()
  let nextPageToken
  for (let page = 0; page < pages; page++) {
    const data = await serpSearch({
      engine: "google_jobs",
      q: `${jobTitle} in ${location}`,
      // English keeps pay strings consistent for parsing; the summary is translated below.
      hl: "en",
      gl: "us",
      next_page_token: nextPageToken,
    })
    for (const posting of data.jobs_results ?? []) {
      const key = posting.job_id ?? `${posting.title}|${posting.company_name}`
      if (!seen.has(key)) {
        seen.add(key)
        postings.push(posting)
      }
    }
    nextPageToken = data.serpapi_pagination?.next_page_token
    if (!nextPageToken) break
  }
  return postings
}

function normalizeJob(posting) {
  const extensions = posting.extensions ?? []
  const highlights = (posting.job_highlights ?? []).flatMap((section) => section.items ?? [])

  // Prefer Google's structured pay chip, then the posting's own highlights and text.
  let pay = null
  let paySource = null
  for (const [source, candidates] of [
    ["listing", [...extensions, posting.detected_extensions?.salary]],
    ["description", [...highlights, posting.description]],
  ]) {
    for (const candidate of candidates) {
      pay = parseSalary(candidate)
      if (pay) break
    }
    if (pay) {
      paySource = source
      break
    }
  }

  const applyLink = posting.apply_options?.[0]?.link ?? posting.share_link ?? null
  return {
    id: posting.job_id ?? `${posting.title}|${posting.company_name}`,
    title: posting.title,
    company: posting.company_name,
    location: posting.location,
    via: posting.via?.replace(/^via\s+/i, "") ?? null,
    postedAt: posting.detected_extensions?.posted_at ?? extensions.find((e) => /\bago\b/.test(e)) ?? null,
    scheduleType:
      posting.detected_extensions?.schedule_type ?? extensions.find((e) => /time|contract|temporary|intern/i.test(e)) ?? null,
    benefits: extensions.filter((e) => /insurance|paid time off|retirement|401|tips/i.test(e)),
    pay,
    paySource,
    applyUrl: applyLink,
    thumbnail: posting.thumbnail ?? null,
    snippet: posting.description ? posting.description.slice(0, 280).trim() : null,
  }
}

const money = (n) => `$${n.toFixed(2).replace(/\.00$/, "")}`
const moneyWhole = (n) => `$${Math.round(n).toLocaleString("en-US")}`

const SUMMARIES = {
  en: {
    below: (v) =>
      `You earn ${v.you}/hr. Similar ${v.job} jobs near ${v.loc} pay about ${v.median}/hr — about ${v.diff}/hr more (≈ ${v.annual} a year full-time).`,
    at: (v) => `Your pay of ${v.you}/hr is in line with similar ${v.job} jobs near ${v.loc} (typical: ${v.median}/hr).`,
    above: (v) => `Your pay of ${v.you}/hr is above most similar ${v.job} jobs near ${v.loc} (typical: ${v.median}/hr).`,
    market: (v) => `${v.job} jobs near ${v.loc} pay about ${v.median}/hr (most between ${v.p25} and ${v.p75}).`,
    none: (v) => `We couldn't find enough posted pay for ${v.job} jobs near ${v.loc}.`,
  },
  es: {
    below: (v) =>
      `Usted gana ${v.you}/hora. Trabajos similares de ${v.job} cerca de ${v.loc} pagan alrededor de ${v.median}/hora: unos ${v.diff}/hora más (≈ ${v.annual} al año a tiempo completo).`,
    at: (v) => `Su pago de ${v.you}/hora está en línea con trabajos similares de ${v.job} cerca de ${v.loc} (lo típico: ${v.median}/hora).`,
    above: (v) => `Su pago de ${v.you}/hora está por encima de la mayoría de trabajos similares de ${v.job} cerca de ${v.loc} (lo típico: ${v.median}/hora).`,
    market: (v) => `Los trabajos de ${v.job} cerca de ${v.loc} pagan alrededor de ${v.median}/hora (la mayoría entre ${v.p25} y ${v.p75}).`,
    none: (v) => `No encontramos suficientes salarios publicados para ${v.job} cerca de ${v.loc}.`,
  },
  hi: {
    below: (v) =>
      `आप ${v.you}/घंटा कमाते हैं। ${v.loc} के पास ${v.job} जैसी नौकरियाँ लगभग ${v.median}/घंटा देती हैं — यानी लगभग ${v.diff}/घंटा ज़्यादा (पूरे समय काम पर ≈ ${v.annual} प्रति वर्ष)।`,
    at: (v) => `आपका ${v.you}/घंटा वेतन ${v.loc} के पास ${v.job} जैसी नौकरियों के बराबर है (आम तौर पर ${v.median}/घंटा)।`,
    above: (v) => `आपका ${v.you}/घंटा वेतन ${v.loc} के पास ज़्यादातर ${v.job} जैसी नौकरियों से अधिक है (आम तौर पर ${v.median}/घंटा)।`,
    market: (v) => `${v.loc} के पास ${v.job} की नौकरियाँ लगभग ${v.median}/घंटा देती हैं (ज़्यादातर ${v.p25} से ${v.p75} के बीच)।`,
    none: (v) => `${v.loc} के पास ${v.job} के लिए पर्याप्त वेतन जानकारी नहीं मिली।`,
  },
  vi: {
    below: (v) =>
      `Bạn kiếm được ${v.you}/giờ. Các công việc ${v.job} tương tự gần ${v.loc} trả khoảng ${v.median}/giờ — nhiều hơn khoảng ${v.diff}/giờ (≈ ${v.annual} mỗi năm nếu làm toàn thời gian).`,
    at: (v) => `Mức lương ${v.you}/giờ của bạn tương đương các công việc ${v.job} tương tự gần ${v.loc} (thông thường: ${v.median}/giờ).`,
    above: (v) => `Mức lương ${v.you}/giờ của bạn cao hơn hầu hết các công việc ${v.job} tương tự gần ${v.loc} (thông thường: ${v.median}/giờ).`,
    market: (v) => `Các công việc ${v.job} gần ${v.loc} trả khoảng ${v.median}/giờ (phần lớn từ ${v.p25} đến ${v.p75}).`,
    none: (v) => `Chúng tôi không tìm thấy đủ thông tin lương cho ${v.job} gần ${v.loc}.`,
  },
  zh: {
    below: (v) =>
      `您的时薪是 ${v.you}。${v.loc} 附近类似的${v.job}工作时薪约 ${v.median}，比您高约 ${v.diff}/小时（全职每年约 ${v.annual}）。`,
    at: (v) => `您的时薪 ${v.you} 与 ${v.loc} 附近类似的${v.job}工作相当（常见水平：${v.median}/小时）。`,
    above: (v) => `您的时薪 ${v.you} 高于 ${v.loc} 附近大多数类似的${v.job}工作（常见水平：${v.median}/小时）。`,
    market: (v) => `${v.loc} 附近的${v.job}工作时薪约 ${v.median}（多数在 ${v.p25} 至 ${v.p75} 之间）。`,
    none: (v) => `我们没有找到足够的薪资信息（${v.loc} 附近的${v.job}工作）。`,
  },
  tl: {
    below: (v) =>
      `Kumikita ka ng ${v.you}/oras. Ang mga katulad na trabahong ${v.job} malapit sa ${v.loc} ay may sahod na humigit-kumulang ${v.median}/oras — mga ${v.diff}/oras na mas mataas (≈ ${v.annual} kada taon kung full-time).`,
    at: (v) => `Ang sahod mong ${v.you}/oras ay kapantay ng mga katulad na trabahong ${v.job} malapit sa ${v.loc} (karaniwan: ${v.median}/oras).`,
    above: (v) => `Mas mataas ang sahod mong ${v.you}/oras kaysa sa karamihan ng katulad na trabahong ${v.job} malapit sa ${v.loc} (karaniwan: ${v.median}/oras).`,
    market: (v) => `Ang mga trabahong ${v.job} malapit sa ${v.loc} ay may sahod na humigit-kumulang ${v.median}/oras (karamihan ay nasa pagitan ng ${v.p25} at ${v.p75}).`,
    none: (v) => `Hindi kami nakahanap ng sapat na nakalistang sahod para sa mga trabahong ${v.job} malapit sa ${v.loc}.`,
  },
  ko: {
    below: (v) =>
      `시급은 ${v.you}입니다. ${v.loc} 근처의 비슷한 ${v.job} 일자리는 시급이 약 ${v.median}로, 시간당 약 ${v.diff} 더 많습니다(풀타임 기준 연 ≈ ${v.annual}).`,
    at: (v) => `시급 ${v.you}은 ${v.loc} 근처의 비슷한 ${v.job} 일자리와 비슷한 수준입니다(일반적: ${v.median}/시간).`,
    above: (v) => `시급 ${v.you}은 ${v.loc} 근처의 비슷한 ${v.job} 일자리 대부분보다 높습니다(일반적: ${v.median}/시간).`,
    market: (v) => `${v.loc} 근처의 ${v.job} 일자리는 시급이 약 ${v.median}입니다(대부분 ${v.p25}에서 ${v.p75} 사이).`,
    none: (v) => `${v.loc} 근처의 ${v.job} 일자리에 대한 급여 정보가 충분하지 않습니다.`,
  },
  ar: {
    below: (v) =>
      `أنت تكسب ${v.you} في الساعة. تدفع وظائف ${v.job} المشابهة بالقرب من ${v.loc} نحو ${v.median} في الساعة، أي أكثر بنحو ${v.diff} في الساعة (≈ ${v.annual} سنويًا بدوام كامل).`,
    at: (v) => `أجرك البالغ ${v.you} في الساعة يتوافق مع وظائف ${v.job} المشابهة بالقرب من ${v.loc} (المعتاد: ${v.median} في الساعة).`,
    above: (v) => `أجرك البالغ ${v.you} في الساعة أعلى من معظم وظائف ${v.job} المشابهة بالقرب من ${v.loc} (المعتاد: ${v.median} في الساعة).`,
    market: (v) => `تدفع وظائف ${v.job} بالقرب من ${v.loc} نحو ${v.median} في الساعة (معظمها بين ${v.p25} و${v.p75}).`,
    none: (v) => `لم نجد معلومات كافية عن الأجور المعلنة لوظائف ${v.job} بالقرب من ${v.loc}.`,
  },
  ht: {
    below: (v) =>
      `Ou touche ${v.you}/èdtan. Travay ${v.job} ki sanble tou pre ${v.loc} peye apeprè ${v.median}/èdtan — apeprè ${v.diff}/èdtan plis (≈ ${v.annual} pa ane si w travay tan plen).`,
    at: (v) => `Peman ou a, ${v.you}/èdtan, sanble ak travay ${v.job} ki sanble tou pre ${v.loc} (òdinè: ${v.median}/èdtan).`,
    above: (v) => `Peman ou a, ${v.you}/èdtan, pi wo pase pifò travay ${v.job} ki sanble tou pre ${v.loc} (òdinè: ${v.median}/èdtan).`,
    market: (v) => `Travay ${v.job} tou pre ${v.loc} peye apeprè ${v.median}/èdtan (pifò ant ${v.p25} ak ${v.p75}).`,
    none: (v) => `Nou pa t jwenn ase enfòmasyon sou peman pou travay ${v.job} tou pre ${v.loc}.`,
  },
  pt: {
    below: (v) =>
      `Você ganha ${v.you}/hora. Empregos de ${v.job} semelhantes perto de ${v.loc} pagam cerca de ${v.median}/hora — cerca de ${v.diff}/hora a mais (≈ ${v.annual} por ano em tempo integral).`,
    at: (v) => `Seu pagamento de ${v.you}/hora está de acordo com empregos de ${v.job} semelhantes perto de ${v.loc} (típico: ${v.median}/hora).`,
    above: (v) => `Seu pagamento de ${v.you}/hora está acima da maioria dos empregos de ${v.job} semelhantes perto de ${v.loc} (típico: ${v.median}/hora).`,
    market: (v) => `Empregos de ${v.job} perto de ${v.loc} pagam cerca de ${v.median}/hora (a maioria entre ${v.p25} e ${v.p75}).`,
    none: (v) => `Não encontramos informações suficientes sobre pagamento para empregos de ${v.job} perto de ${v.loc}.`,
  },
  bn: {
    below: (v) =>
      `আপনি ঘণ্টায় ${v.you} পান। ${v.loc}-এর কাছে একই ধরনের ${v.job} কাজে ঘণ্টায় প্রায় ${v.median} দেওয়া হয় — ঘণ্টায় প্রায় ${v.diff} বেশি (পূর্ণ সময় কাজ করলে বছরে ≈ ${v.annual})।`,
    at: (v) => `ঘণ্টায় ${v.you} বেতন ${v.loc}-এর কাছে একই ধরনের ${v.job} কাজের সমান (সাধারণত ঘণ্টায় ${v.median})।`,
    above: (v) => `ঘণ্টায় ${v.you} বেতন ${v.loc}-এর কাছে একই ধরনের বেশিরভাগ ${v.job} কাজের চেয়ে বেশি (সাধারণত ঘণ্টায় ${v.median})।`,
    market: (v) => `${v.loc}-এর কাছে ${v.job} কাজে ঘণ্টায় প্রায় ${v.median} দেওয়া হয় (বেশিরভাগ ${v.p25} থেকে ${v.p75}-এর মধ্যে)।`,
    none: (v) => `${v.loc}-এর কাছে ${v.job} কাজের জন্য যথেষ্ট বেতনের তথ্য পাওয়া যায়নি।`,
  },
  fr: {
    below: (v) =>
      `Vous gagnez ${v.you}/h. Les emplois de ${v.job} similaires près de ${v.loc} paient environ ${v.median}/h, soit environ ${v.diff}/h de plus (≈ ${v.annual} par an à temps plein).`,
    at: (v) => `Votre salaire de ${v.you}/h est comparable à celui des emplois de ${v.job} similaires près de ${v.loc} (habituel : ${v.median}/h).`,
    above: (v) => `Votre salaire de ${v.you}/h est supérieur à celui de la plupart des emplois de ${v.job} similaires près de ${v.loc} (habituel : ${v.median}/h).`,
    market: (v) => `Les emplois de ${v.job} près de ${v.loc} paient environ ${v.median}/h (la plupart entre ${v.p25} et ${v.p75}).`,
    none: (v) => `Nous n’avons pas trouvé assez de salaires publiés pour les emplois de ${v.job} près de ${v.loc}.`,
  },
  ru: {
    below: (v) =>
      `Вы зарабатываете ${v.you} в час. Похожие вакансии «${v.job}» рядом с ${v.loc} платят около ${v.median} в час — примерно на ${v.diff} в час больше (≈ ${v.annual} в год при полной занятости).`,
    at: (v) => `Ваша ставка ${v.you} в час соответствует похожим вакансиям «${v.job}» рядом с ${v.loc} (обычно: ${v.median} в час).`,
    above: (v) => `Ваша ставка ${v.you} в час выше, чем в большинстве похожих вакансий «${v.job}» рядом с ${v.loc} (обычно: ${v.median} в час).`,
    market: (v) => `Вакансии «${v.job}» рядом с ${v.loc} платят около ${v.median} в час (чаще всего от ${v.p25} до ${v.p75}).`,
    none: (v) => `Мы не нашли достаточно данных об оплате для вакансий «${v.job}» рядом с ${v.loc}.`,
  },
  ur: {
    below: (v) =>
      `آپ فی گھنٹہ ${v.you} کماتے ہیں۔ ${v.loc} کے قریب ${v.job} جیسی ملازمتیں تقریباً ${v.median} فی گھنٹہ دیتی ہیں — یعنی تقریباً ${v.diff} فی گھنٹہ زیادہ (کل وقتی کام پر ≈ ${v.annual} سالانہ)۔`,
    at: (v) => `آپ کی ${v.you} فی گھنٹہ اجرت ${v.loc} کے قریب ${v.job} جیسی ملازمتوں کے برابر ہے (عام طور پر ${v.median} فی گھنٹہ)۔`,
    above: (v) => `آپ کی ${v.you} فی گھنٹہ اجرت ${v.loc} کے قریب ${v.job} جیسی زیادہ تر ملازمتوں سے زیادہ ہے (عام طور پر ${v.median} فی گھنٹہ)۔`,
    market: (v) => `${v.loc} کے قریب ${v.job} کی ملازمتیں تقریباً ${v.median} فی گھنٹہ دیتی ہیں (زیادہ تر ${v.p25} سے ${v.p75} کے درمیان)۔`,
    none: (v) => `${v.loc} کے قریب ${v.job} کی ملازمتوں کے لیے ہمیں اجرت کی کافی معلومات نہیں ملیں۔`,
  },
  pl: {
    below: (v) =>
      `Zarabiasz ${v.you}/godz. Podobne oferty pracy (${v.job}) w pobliżu ${v.loc} płacą około ${v.median}/godz. — mniej więcej o ${v.diff}/godz. więcej (≈ ${v.annual} rocznie przy pełnym etacie).`,
    at: (v) => `Twoja stawka ${v.you}/godz. jest zbliżona do podobnych ofert (${v.job}) w pobliżu ${v.loc} (typowo: ${v.median}/godz.).`,
    above: (v) => `Twoja stawka ${v.you}/godz. jest wyższa niż w większości podobnych ofert (${v.job}) w pobliżu ${v.loc} (typowo: ${v.median}/godz.).`,
    market: (v) => `Oferty pracy (${v.job}) w pobliżu ${v.loc} płacą około ${v.median}/godz. (zwykle od ${v.p25} do ${v.p75}).`,
    none: (v) => `Nie znaleźliśmy wystarczającej liczby ofert z podaną stawką (${v.job}) w pobliżu ${v.loc}.`,
  },
  it: {
    below: (v) =>
      `Guadagni ${v.you}/ora. Lavori simili come ${v.job} vicino a ${v.loc} pagano circa ${v.median}/ora, cioè circa ${v.diff}/ora in più (≈ ${v.annual} all’anno a tempo pieno).`,
    at: (v) => `La tua paga di ${v.you}/ora è in linea con lavori simili come ${v.job} vicino a ${v.loc} (tipico: ${v.median}/ora).`,
    above: (v) => `La tua paga di ${v.you}/ora è superiore a quella della maggior parte dei lavori simili come ${v.job} vicino a ${v.loc} (tipico: ${v.median}/ora).`,
    market: (v) => `I lavori come ${v.job} vicino a ${v.loc} pagano circa ${v.median}/ora (per lo più tra ${v.p25} e ${v.p75}).`,
    none: (v) => `Non abbiamo trovato abbastanza paghe pubblicate per lavori come ${v.job} vicino a ${v.loc}.`,
  },
  de: {
    below: (v) =>
      `Sie verdienen ${v.you}/Std. Ähnliche Stellen als ${v.job} in der Nähe von ${v.loc} zahlen etwa ${v.median}/Std. – rund ${v.diff}/Std. mehr (≈ ${v.annual} pro Jahr bei Vollzeit).`,
    at: (v) => `Ihr Lohn von ${v.you}/Std. entspricht ähnlichen Stellen als ${v.job} in der Nähe von ${v.loc} (üblich: ${v.median}/Std.).`,
    above: (v) => `Ihr Lohn von ${v.you}/Std. liegt über dem der meisten ähnlichen Stellen als ${v.job} in der Nähe von ${v.loc} (üblich: ${v.median}/Std.).`,
    market: (v) => `Stellen als ${v.job} in der Nähe von ${v.loc} zahlen etwa ${v.median}/Std. (meist zwischen ${v.p25} und ${v.p75}).`,
    none: (v) => `Wir haben nicht genügend veröffentlichte Löhne für Stellen als ${v.job} in der Nähe von ${v.loc} gefunden.`,
  },
  ja: {
    below: (v) =>
      `あなたの時給は${v.you}です。${v.loc}の近くにある同様の${v.job}の仕事は時給約${v.median}で、1時間あたり約${v.diff}高くなっています（フルタイムで年間約${v.annual}）。`,
    at: (v) => `あなたの時給${v.you}は、${v.loc}の近くにある同様の${v.job}の仕事と同程度です（一般的な時給：${v.median}）。`,
    above: (v) => `あなたの時給${v.you}は、${v.loc}の近くにある同様の${v.job}の仕事の大半より高い水準です（一般的な時給：${v.median}）。`,
    market: (v) => `${v.loc}の近くにある${v.job}の仕事は時給約${v.median}です（多くは${v.p25}から${v.p75}）。`,
    none: (v) => `${v.loc}の近くの${v.job}の仕事について、十分な給与情報が見つかりませんでした。`,
  },
}

function summaryText({ language, jobTitle, location, stats, comparison }) {
  const templates = SUMMARIES[language.code] ?? SUMMARIES.en
  const values = { job: jobTitle, loc: location }
  if (!stats) return templates.none(values)
  Object.assign(values, { median: money(stats.median), p25: money(stats.p25), p75: money(stats.p75) })
  if (!comparison) return templates.market(values)
  Object.assign(values, {
    you: money(comparison.yourHourlyWage),
    diff: money(Math.abs(comparison.diffPerHour)),
    annual: moneyWhole(Math.abs(comparison.diffPerYearFullTime)),
  })
  return templates[comparison.verdict.replace("_market", "")](values)
}
