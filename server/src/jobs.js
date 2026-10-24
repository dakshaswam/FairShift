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
