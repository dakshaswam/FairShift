# FairShift

FairShift helps hourly workers understand their pay. A worker signs in with Google, uploads a photo or PDF of a pay stub, and gets every line explained in their own language (18 languages). The assistant chat answers pay questions, checks hours and overtime, drafts a wage claim summary, finds free legal aid and worker centers nearby, and compares local job pay. FairShift does not decide whether wage laws were broken or what wages are legally owed.

- **Frontend:** React 19, Vite and Tailwind CSS v4 (`src/`).
- **Server:** Node and Express (`server/`). It handles Google sign-in, the assistant chat (Meta Muse), local help and job search (SerpApi), and pay stub reading. It saves profiles and uploads to Supabase.
- **Pay stub reading** runs inside the server (`server/src/paystub/`): local text extraction (tesseract.js OCR, PDF text), personal-information redaction, Muse extraction, validation and arithmetic checks. Only redacted text is sent to Muse.
- **Optional Python module** (`fairshift_paystub/`, `paystub.py`): the original stand-alone extractor and command-line tool, described below. The app uses it only when `PAYSTUB_SERVICE_URL` is set.

## Run the app locally

```bash
pnpm install
(cd server && npm install)
cp server/.env.example server/.env   # then fill in the keys
(cd server && npm start)             # API on http://localhost:8787
pnpm dev                             # app on http://localhost:8443
npm run doctor                       # checks keys and services
```

See `server/.env.example` for every setting. Run `server/supabase/schema.sql` once in the Supabase SQL editor before you use Supabase.

## Deploy on Vercel

`vercel.json` deploys the repository as one Vercel project with two services:

- `app` (Vite) serves the website at `/`.
- `server` (Express) serves the API at `/api/*`.

1. Import the repository in Vercel and deploy.
2. In **Settings → Environment Variables**, add the values from `server/.env`: `SERPAPI_KEY`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `MUSE_API_KEY`, `MUSE_MODEL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Then redeploy.
3. In Google Cloud, add the production address (for example `https://hactx.vercel.app`) to the OAuth client's **Authorized JavaScript origins**.

`GET /api/health` shows which keys the server has, and `GET /api/health/ocr` shows whether OCR starts.

## Tests

```bash
(cd server && npm test)                # server, including the pay stub pipeline
npm run test:upload                    # frontend upload helpers
npm run i18n:check                     # every UI string is translated
./.venv/bin/python -m pytest -q        # optional Python module
```

---

# FairShift pay stub extraction module (Python)

This is a stand-alone Python module that pulls pay information out of images and PDFs. It leaves the React app and the SerpApi service in `server/` unchanged. It does not decide whether wage laws were broken or what wages are legally owed.

The steps are **local text extraction → personal-information redaction → user review, editing and approval → Muse structured extraction → Pydantic validation → Decimal arithmetic checks → result**. The original image or PDF is never sent to Muse or to any outside OCR service.

## First-time setup

Python 3.12 is recommended. Run these commands from the project root (the folder that contains `paystub.py`). Downloads happen only while you install the packages and the spaCy model; nothing is downloaded automatically while a document is being read.

Windows PowerShell:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\HacTX"
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m spacy download en_core_web_lg
```

The Python path above is where Python was found on the development PC. On another PC you can replace the line that creates the virtual environment with `py -3.12 -m venv .venv`. You don't need to activate the virtual environment for the later commands.

macOS / Linux:

```bash
cd /path/to/HacTX
python3.12 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements-dev.txt
./.venv/bin/python -m spacy download en_core_web_lg
```

`en_core_web_lg` is required for local personal-information detection. If the model is missing or Presidio fails, nothing is sent. For installation details, see the Presidio documentation.

Photos and scanned PDFs also need the Tesseract program and its English language data, in addition to the Python packages. On Windows, install it with the command below or use the Windows installer linked from Tesseract's installation guide.

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact
tesseract --version
```

If a new terminal still can't find `tesseract` after installation, set `TESSERACT_CMD` in `.env` (see below). On macOS run `brew install tesseract`; on Ubuntu/Debian run `sudo apt install tesseract-ocr tesseract-ocr-eng`. Digital PDFs are read with pdfplumber and scanned pages are rendered with pypdfium2, so Poppler is not needed.

To help read small text and decimal points, photo OCR converts the image to grayscale, enlarges it up to 3×, within the existing pixel limit, and converts it to black and white. This happens only in memory and creates no intermediate image files.

## Add your API key on your computer

Create a Muse API key (in the form `LLM|...` or `LLM_...`) in the Meta Model API dashboard. Then copy `.env.example` in the project root to `.env`, once. If you already have a `.env`, don't overwrite it; just add the settings below.

Windows:

```powershell
Copy-Item .env.example .env
notepad .env
```

macOS / Linux:

```bash
cp -n .env.example .env
```

Open `.env` in VS Code or another editor and set these values. Never post the key in a chat, in Git or in a screenshot.

```dotenv
MUSE_API_KEY=your_actual_key
# Optional: the default is muse-spark-1.3.
MUSE_MODEL=muse-spark-1.3
# Only if Windows can't find Tesseract:
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
# Optional: installed OCR language codes. The default is eng.
# TESSERACT_LANGUAGE=eng+spa
```

Muse is called through the Meta Model API (`https://api.meta.ai/v1`, OpenAI-compatible Chat Completions). The default model is `muse-spark-1.3`; change it with `MUSE_MODEL` in `.env` or with `--model`. The command-line tool reads the root `.env`. A server that imports the module should set the environment variables itself or call `load_dotenv()`.

## Run a fictional sample

The PDF and PNG below have the same content, and every identifier in them, including names, addresses and account numbers, is fake.

Windows:

```powershell
.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.pdf
.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.png --output result.json
```

macOS / Linux:

```bash
./.venv/bin/python paystub.py samples/sample_paystub.pdf
./.venv/bin/python paystub.py samples/sample_paystub.png --output result.json
```

The tool first prints the full redacted text that will actually be sent. Check that no personal information is left, then type `SEND` to send it. To change it, type `EDIT`, paste the full text and finish with `.END`. The edited text is shown again, and you must type `SEND` again. `CANCEL` cancels. Without approval, the API is never called. If personal information is still detected after editing, sending is blocked. There is no automatic-approval option.

To check the local redaction without a key, run `.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.pdf --preview-only` (macOS/Linux: `./.venv/bin/python`). This option makes no API call and saves no result file.

On success the tool prints JSON. It saves the result JSON only when you pass `--output`, and it never overwrites an existing file or the original input. If OCR or redaction fails, it never falls back to sending the original.

The sample's main expected values are: regular 80 × 18 = 1440, overtime 5 × 27 = 135, tips 40, gross pay 1615, total deductions 273.42 and net pay 1341.58. Year-to-date (YTD) totals are not used as current-period values. The full expected JSON was written by a person as a test reference; it is not a real Muse response. The real model's warning text may differ.

## Use it from your own code

```python
from dotenv import load_dotenv
from fairshift_paystub import extract_paystub

load_dotenv(".env")

def approve_in_terminal(redacted_text: str) -> str | None:
    from fairshift_paystub.cli import terminal_review
    return terminal_review(redacted_text)  # Preview, editing and explicit approval.

result = extract_paystub(
    "samples/sample_paystub.pdf",
    review=approve_in_terminal,
)
print(result.model_dump_json(indent=2))
```

The `review` callback receives only the redacted text. A future UI should show a preview and an editor, and return the edited string only after the user explicitly approves it. Return `None` to cancel. A callback that always returns a string would not meet the user-approval requirement. Never share one user's approved text or results with another user.

In an asynchronous UI, you can create the local preview with `prepare_paystub(file_path)` and then pass the exact string that user edited and approved to `complete_paystub(approved_text, approved=True)`. The backend must tie the preview and the consent to the same user. This module does not handle sign-in or user sessions.

The return value is a Pydantic `Paystub` object. `model_dump(mode="json")` returns a JSON-ready dict, and `model_dump_json()` returns a JSON string. It keeps the original fields: employer name, period and pay date, currency, hours, rates and pay, tips, gross pay, `deductions`, net pay, `other_earnings` and `warnings`. Deductions have the shape `{label, amount}`, and extra earnings or earnings at more than one rate have the shape `{label, amount, hours, hourly_rate}`. If an original label contains personal information, it stays redacted.

Amounts and hours are `Decimal` internally and strings such as `"1615.00"` in JSON. Unknown values are `null`, and missing tips or overtime are never turned into 0. When there are several rates, they are kept as separate lines instead of being merged. SSNs, addresses, account numbers and similar identifiers are not part of the returned schema, and original personal information is never put back in.

The schema sent to Muse also asks for Decimal fields as strings or null. To keep the model request simple, the length and array-size limits are left out of the schema that is sent; they are all applied afterwards by local Pydantic validation. Local validation was not loosened to allow negative hours, invalid numbers, excessive lengths and so on.

## Validation and tests

Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

macOS / Linux:

```bash
./.venv/bin/python -m pytest -q
```

The automated tests use fictional documents and mocked Muse responses and never call the real API. They check:

- requests contain redaction markers such as `[NAME_1]` and `[ACCOUNT_1]` and none of the known fake identifiers
- OCR or redaction failures, and refused approvals, block sending
- temporary files and the original input are handled correctly
- the output schema and the arithmetic

Passing the mocked tests does not prove the quality of real Muse extraction. In an environment without the Tesseract program or the spaCy model, the real OCR and detection steps must be checked separately.

Results in the development environment on 2026-10-24: 197 automated tests passed. Real local Tesseract OCR and redaction were run on the current synthetic PNG, and the pay figures were confirmed. The browser regression test mocks the API and checks that mocked results are labeled differently from real Muse results. Separate real Muse calls are labeled in each request's result; don't confuse them with mocked test results.

Tesseract was installed in this environment and real photo OCR was confirmed. In another environment without the OCR program or the spaCy model, those local steps fail, and the module never substitutes an outside OCR service or a sample response.

The arithmetic checks never invent missing deductions or amounts to make totals match. Gross pay − deductions = net pay is compared only when the current-period deduction total, the line-item amounts and a simple pay structure are all established. Otherwise a warning says the check was skipped. A mismatch is a flag for review, not evidence of unpaid wages or a legal violation. The result always includes a warning that the user must review it.

## What happens to personal information, and the limits

Here, "local" means the computer that runs the Python module. If you run it on your PC, the PC reads the original. If it moves to a server later, the server receives the original. To keep the original from ever leaving the user's device, the OCR, redaction and approval screen would have to run on that device.

Presidio is combined with pay stub specific regular expressions and context rules to redact names, full and partial SSNs, employee IDs, personal addresses, email addresses, phone numbers and account and routing numbers. Dates, hours, rates and amounts are kept. The module does not rely on a generic detector alone, but English-centered rules, OCR misreads, unfamiliar layouts or languages, and unlabeled identifiers can cause missed or excessive redaction. That is why the user must check and correct the text before it is sent.

The app never stores a copy of the original, the raw OCR text, or a table mapping redaction markers back to the original values. PDF rendering and Tesseract input and output use memory and pipes, so no sensitive temporary files are created. The user's original file is never deleted. The Muse diagnostic log records only the status code, the number of attempts, the request body size and, on failure, the provider's error response. Approved document text is never logged. The API key is sent only in the request header and is never written to the diagnostic log. A result file is created only when `--output` is given, and no conversation history or cross-user request context is kept. This does not guarantee complete overwriting of Python memory, or cover operating-system swap or dumps, terminal history, or outside logging by a server operator.

Only the approved text is sent to Muse, as one independent request. No tools, search, grounding, outside search results, file uploads or explicit context caching are used. Instructions inside the document are treated as untrusted data. After schema validation, the response strings are also checked for personal information. Pydantic checks only the format; it does not guarantee that the extraction is accurate or that every prompt injection is blocked. Inaccurate numbers, missing values and misreadings must be checked by a person against the original.

## How Muse handles your data

The approved text is sent to the Meta Model API (`https://api.meta.ai/v1`). The app not storing files does not mean Meta keeps no request data. Check the Meta Model API terms and your dashboard settings for data retention, training use and logging. The approved text includes pay amounts, so always make sure no personal information is left before sending.

## Files

- `paystub.py`: command-line entry point.
- `fairshift_paystub/`: local extraction, redaction, Muse requests, schema validation, arithmetic checks and reusable functions.
- `tests/`: mocked tests, including privacy boundaries and failure paths.
- `samples/`: fictional source text, a digital PDF, a PNG for OCR, the expected JSON and a script to regenerate them locally.
- `requirements*.txt`, `.env.example`, `.gitignore`: installation, local settings and keeping sensitive files out of Git.

To regenerate the samples, run `python samples/generate_samples.py` with the virtual environment's Python. Never commit real pay stubs or results to Git; keep them in the local input and output folders listed in `.gitignore`.
