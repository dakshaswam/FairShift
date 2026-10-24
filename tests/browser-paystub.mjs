// Synthetic browser regression tests. DEFAULT MODE MOCKS ALL PAYSTUB HTTP CALLS.
// --live uses actual OCR/redaction/Muse and waits for approval on stdin first.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { chromium } from 'playwright-core'

const root = process.cwd()
const live = process.argv.includes('--live')
const base = process.env.FAIRSHIFT_TEST_URL || 'http://localhost:8443'
const executable = process.env.PLAYWRIGHT_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(file => fs.existsSync(file))
assert(executable, 'Set PLAYWRIGHT_CHROME to an installed Chrome/Edge executable.')
const current = JSON.parse(fs.readFileSync(path.join(root, 'samples/current_upload_expected.json'), 'utf8'))
const original = JSON.parse(fs.readFileSync(path.join(root, 'samples/expected_paystub.json'), 'utf8'))
const currentFile = fs.readFileSync(path.join(root, 'samples/current_upload.png'))
const originalFile = fs.readFileSync(path.join(root, 'samples/sample_paystub.png'))
const browser = await chromium.launch({ executablePath: executable, headless: true })

async function openPanel(page) {
  await page.route('**/api/auth/me', route => route.fulfill({
    json: {
      user: {
        id: 'synthetic-worker',
        email: 'synthetic@example.test',
        name: 'Synthetic Worker',
        picture: null,
        profile: { occupation: 'Barista', location: 'Queens, NY', hourlyWage: 15, language: 'English' },
      },
    },
  }))
  await page.goto(base)
  await page.getByRole('button', { name: /Scan pay stub/ }).click()
  await page.getByLabel('Upload paystub', { exact: true }).waitFor()
}

const upload = (page, bytes, name = 'fictional.png') => page.getByLabel('Upload paystub', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: bytes })
const editor = page => page.getByLabel('Redacted text to approve', { exact: true })
const approve = page => page.getByRole('button', { name: 'Approve this text and extract', exact: true }).click()
const waitForCurrent = page => page.getByText(`Current upload: ${current.employer_name}`, { exact: true }).waitFor()

try {
  if (live) {
    const page = await browser.newPage()
    await openPanel(page)
    await upload(page, currentFile)
    await editor(page).waitFor({ timeout: 60000 })
    const preview = await editor(page).inputValue()
    console.log('EXACT SYNTHETIC REDACTED TEXT FOR APPROVAL\n' + preview + '\nEND PREVIEW')
    console.log('REAL OCR/REDACTION completed; Muse has NOT been called. Type APPROVED only after user consent.')
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await terminal.question('Approval: ')
    terminal.close()
    assert.equal(answer.trim(), 'APPROVED', 'Cancelled before any Muse call.')
    const pending = page.waitForResponse(response => response.url().endsWith('/api/paystubs/extract'), { timeout: 90000 })
    await approve(page)
    const response = await pending
    const result = await response.json()
    assert(response.ok(), `Real extraction failed at ${result.stage || 'unknown'}: ${result.error || 'the service returned no safe error detail.'}`)
    assert.equal(result.source, 'muse_live')
    for (const field of ['employer_name', 'regular_hours', 'regular_hourly_rate', 'regular_pay', 'overtime_hours', 'overtime_hourly_rate', 'overtime_pay', 'gross_pay', 'net_pay']) {
      if (field === 'employer_name') assert.equal(result.paystub[field], current[field], field)
      else assert.equal(Number(result.paystub[field]), Number(current[field]), field)
    }
    assert.equal(result.paystub.deductions.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0), 10279)
    await waitForCurrent(page)
    await page.getByLabel('Question about current paystub').fill('Was overtime paid? How much am I owed?')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const screen = await page.locator('body').innerText()
    assert(screen.includes('USD 90.00') && screen.includes('USD 587.21'))
    assert(!screen.includes('Sunbright') && !screen.includes('86.40'))
    assert(screen.includes('cannot determine unpaid wages'))
    console.log('PASS LIVE: current synthetic PNG → actual Tesseract → actual redaction → real Muse → validation/checks → current chatbot.')
    console.log('LIVE values matched fixture: 40 regular hours, rate15, regular600, overtime4/rate22.5/pay90, gross690, deductions102.79, net587.21.')
    console.log('LIVE trace: ' + result.trace.map(item => `${item.stage}:${item.status}:${item.mode || ''}`).join(', '))
    await page.close()
  } else {
    const page = await browser.newPage()
    const state = { next: 0, records: new Map(), extractCalls: 0, fail: false, wrongId: false, holdPrepare: false, holdExtract: false, releasePrepare: null, releaseExtract: null }
    await page.route('**/api/paystubs/prepare', async route => {
      const bytes = route.request().postDataBuffer()
      const stub = bytes?.equals(currentFile) ? current : original
      assert(bytes?.equals(currentFile) || bytes?.equals(originalFile), 'Only known synthetic files may be used.')
      assert.equal(route.request().headers()['x-document-type'], '.png')
      const id = `synthetic-upload-${++state.next}`
      const redacted = `Employer: ${stub.employer_name}\nEmployee: [NAME_1]\nRegular hours: ${stub.regular_hours}\nRegular hourly rate: ${stub.regular_hourly_rate}\nOvertime pay: ${stub.overtime_pay}\nGross pay: ${stub.gross_pay}\nNet pay: ${stub.net_pay}`
      state.records.set(id, { stub, redacted })
      if (state.holdPrepare && stub === original) await new Promise(resolve => { state.releasePrepare = resolve })
      if (state.fail) return route.fulfill({ status: 422, json: { error: 'Synthetic OCR failure; nothing was sent.', stage: 'local_text_extraction' } }).catch(() => {})
      await route.fulfill({ json: { upload_id: id, approval_token: 'synthetic-ticket', redacted_text: redacted, trace: [{ stage: 'local_text_extraction', status: 'passed', mode: 'mocked' }, { stage: 'redaction', status: 'passed', mode: 'mocked' }] } }).catch(() => {})
    })
    await page.route('**/api/paystubs/extract', async route => {
      state.extractCalls++
      const data = route.request().postDataJSON()
      assert.equal(data.approved, true)
      const record = state.records.get(data.upload_id)
      assert(record && data.approved_text.startsWith(record.redacted))
      if (state.holdExtract && record.stub === original) await new Promise(resolve => { state.releaseExtract = resolve })
      await route.fulfill({ json: { upload_id: state.wrongId ? 'wrong-upload' : data.upload_id, source: 'mocked', paystub: record.stub, assistant_message: `MOCKED: ${record.stub.employer_name}; regular ${record.stub.regular_hours}; overtime pay ${record.stub.overtime_pay}; net ${record.stub.net_pay}`, trace: [{ stage: 'gemini', status: 'passed', mode: 'mocked' }, { stage: 'pydantic_validation', status: 'passed', mode: 'mocked' }] } }).catch(() => {})
    })
    await openPanel(page)
    await upload(page, originalFile)
    await editor(page).waitFor()
    assert.equal(state.extractCalls, 0, 'Preparing never auto-approves a Muse request.')
    await editor(page).fill((await editor(page).inputValue()) + '\nUser reviewed this exact text.')
    await approve(page)
    await page.getByText(`Current upload: ${original.employer_name}`, { exact: true }).waitFor()
    const mockScreen = await page.locator('body').innerText()
    assert(mockScreen.includes(`MOCKED: ${original.employer_name}`))
    assert(mockScreen.includes('Mocked extraction · test data, not a live Muse response'))
    console.log('PASS MOCK: exact edited approval, current-file request and truthful mock label.')

    await upload(page, currentFile)
    await editor(page).waitFor()
    assert(await page.getByLabel('Question about current paystub').isDisabled())
    assert(!(await page.locator('body').innerText()).includes(`Current upload: ${original.employer_name}`))
    await approve(page)
    await waitForCurrent(page)
    await page.getByLabel('Question about current paystub').fill('Do I have unpaid overtime?')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    let screen = await page.locator('body').innerText()
    assert(screen.includes('USD 90.00') && screen.includes('cannot determine unpaid wages'))
    assert(!screen.includes('Sunbright') && !screen.includes('86.40'))
    console.log('PASS MOCK: a second distinct upload replaces prior values and records paid overtime.')

    state.holdPrepare = true
    await upload(page, originalFile)
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('Extracting text locally'))
    while (!state.releasePrepare) await new Promise(resolve => setTimeout(resolve, 10))
    await upload(page, currentFile)
    await editor(page).waitFor()
    state.releasePrepare()
    assert((await editor(page).inputValue()).includes('Regular hours: 40.00'))
    state.holdPrepare = false
    await approve(page)
    await waitForCurrent(page)
    console.log('PASS MOCK: late preparation for an old upload cannot overwrite the current preview.')

    state.holdExtract = true
    await upload(page, originalFile)
    await editor(page).waitFor()
    await approve(page)
    while (!state.releaseExtract) await new Promise(resolve => setTimeout(resolve, 10))
    await upload(page, currentFile)
    await editor(page).waitFor()
    state.releaseExtract()
    assert((await editor(page).inputValue()).includes('Regular hours: 40.00'))
    state.holdExtract = false
    await approve(page)
    await waitForCurrent(page)
    console.log('PASS MOCK: late extraction for an old upload cannot overwrite the current document.')

    state.fail = true
    await upload(page, originalFile)
    await page.getByRole('alert').waitFor()
    assert(await page.getByLabel('Question about current paystub').isDisabled())
    screen = await page.locator('body').innerText()
    assert(!screen.includes('Current upload:') && !screen.includes('MOCKED:'))
    state.fail = false
    console.log('PASS MOCK: OCR failure clears old result and disables answers; no demo fallback.')

    state.wrongId = true
    await upload(page, currentFile)
    await editor(page).waitFor()
    await approve(page)
    await page.getByRole('alert').waitFor()
    assert(await page.getByLabel('Question about current paystub').isDisabled())
    console.log('PASS MOCK: mismatched upload identity is rejected.')
    await page.close()
  }
} finally {
  await browser.close()
}
