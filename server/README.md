# FairShift SerpApi service

Backend for Google sign-in and worker profiles, plus two features powered by [SerpApi](https://serpapi.com):

1. **Help near you**: legal aid, worker centers and the worker's consulate (Google Maps), searched in the worker's language.
2. **Know your worth**: what similar jobs nearby pay, compared with the worker's hourly wage (Google Jobs).

## Run it

```bash
cd server
npm install
npm start          # http://localhost:8787  (npm run dev to auto-restart on changes)
npm test           # salary parser tests
```

Config lives in `server/.env`, which git ignores:

```
SERPAPI_KEY=...            # required
GOOGLE_CLIENT_ID=...       # required for sign-in (Google Cloud → Credentials → OAuth client ID, type "Web application")
SESSION_SECRET=...         # long random string that signs session cookies
PORT=8787
CACHE_TTL_MINUTES=360      # identical searches are cached in memory to save credits
CORS_ORIGIN=*              # optional
```

The Vite dev server proxies `/api` to `http://localhost:8787`. Set `FAIRSHIFT_API_URL` to point it somewhere else, or set `VITE_API_URL` in the frontend to call the API directly.

## Merging into another Express backend

```js
import { authRouter, requireUser } from "./server/src/auth.js"
import { serpRouter } from "./server/src/routes.js"
app.use(express.json())
app.use("/api", authRouter)   // /api/auth/*, /api/profile
app.use("/api", serpRouter)   // /api/help, /api/jobs/compare, /api/meta
app.get("/api/shifts", requireUser, (req, res) => { /* req.user is the signed-in worker */ })
```

User profiles are stored in `server/data/users.json`, which git ignores. To use a real database, replace the three functions in `src/users.js`.

## Sign-in

The frontend shows Google's "Sign in with Google" button and sends the resulting ID token to the server. The server verifies the token with Google and sets a signed, httpOnly `fairshift_session` cookie that lasts 30 days. No client secret is needed.

In Google Cloud, every URL the app is opened from must be listed under **Authorized JavaScript origins**: `http://localhost:8443` now, and the demo or deploy URL later. While the consent screen is in Testing mode, only accounts listed as **Test users** can sign in.

| endpoint | |
|---|---|
| `GET /api/auth/config` | `{ googleClientId }` for the frontend |
| `POST /api/auth/google` | body `{ credential }` (Google ID token) → `{ user }` and sets the session cookie |
| `GET /api/auth/me` | `{ user }`, or 401 if not signed in |
| `POST /api/auth/logout` | clears the cookie |
| `PUT /api/profile` | body `{ occupation, location, hourlyWage, language }` (any subset) → `{ user }` |

```jsonc
{ "user": { "id": "<google sub>", "email": "...", "name": "...", "picture": "...",
  "profile": { "occupation": "Line cook", "location": "Houston, TX", "hourlyWage": 13.5, "language": "Español" } } }
```

`profile` is `null` until the worker finishes onboarding. The app asks for their occupation on first sign-in, and "Find a better job" uses it automatically.

## Endpoints

`language` accepts a code (`es`, `hi`, `vi`, `zh`, `tl`, `ko`, `ar`, `ht`, `pt`, `bn`) or the name the app shows (`Español`, `हिन्दी`, `Tiếng Việt`). It defaults to English.

### `GET /api/help`

| param | | |
|---|---|---|
| `location` | required unless `lat`/`lng` are given | `"Queens, NY"`, a ZIP code, etc. |
| `lat`, `lng` | optional | Browser geolocation. Adds `distanceMiles` to each result. |
| `category` | optional | `legal_aid`, `worker_center`, `consulate`, a comma-separated list, or `all` (the default) |
| `language` | optional | Results come back localized, and a second "<Language>-speaking …" search is run. |
| `country` | optional | Home country, used for the consulate search. Defaults from language (es→Mexico, vi→Vietnam, hi→India…). |
| `limit` | optional | 1–20, default 8 |

```jsonc
{
  "location": "Queens, NY", "language": "es", "country": "Mexico",
  "needsCountry": false,          // true → ask the worker for their home country
  "results": {
    "legal_aid": [{
      "name": "The Legal Aid Society", "type": "Servicios legales",
      "address": "...", "phone": "...", "website": "...", "rating": 4.1, "reviews": 210,
      "hours": "Abierto · Cierra a las 5 p.m.", "distanceMiles": 2.3,
      "likelyFree": true,              // legal aid or nonprofit, not a private firm
      "mentionsLanguage": false,       // listing mentions Spanish
      "foundInLanguageSearch": true,   // came up in the "Spanish-speaking …" search
      "mapsUrl": "...", "directionsUrl": "..."
    }],
    "worker_center": [ ... ], "consulate": [ ... ]
  }
}
```

Results are ranked as follows: free or nonprofit help first, then places that mention the worker's language, then rating and distance. Personal-injury, criminal and similar firms are pushed down.

### `GET /api/jobs/compare`

| param | | |
|---|---|---|
| `jobTitle` | required | `"line cook"` |
| `location` | required | `"Houston, TX"` |
| `hourlyWage` | optional | The worker's current rate. Enables `comparison` and `betterPaying`. |
| `language` | optional | Language of the `summary` sentence (en, es, hi, vi; others fall back to English) |
| `pages` | optional | 1–3 pages of Google Jobs, default 2. Each page costs one SerpApi search. |

```jsonc
{
  "stats": { "count": 12, "min": 17.75, "p25": 18.35, "median": 18.95, "p75": 18.95, "max": 20.75 },
  "comparison": {
    "yourHourlyWage": 17, "marketMedian": 18.95, "percentile": 0,
    "diffPerHour": 1.95, "diffPerYearFullTime": 4056,
    "verdict": "below_market"          // below_market | at_market | above_market
  },
  "summary": "Usted gana $17/hora. Trabajos similares de barista cerca de Queens, NY pagan alrededor de $18.95/hora…",
  "betterPaying": [ /* jobs paying more than hourlyWage, highest first */ ],
  "jobs": [{
    "title": "Barista", "company": "Starbucks", "location": "Queens, NY", "via": "Indeed",
    "pay": { "text": "17.75–20.15 an hour", "unit": "hour", "hourly": { "min": 17.75, "max": 20.15, "mid": 18.95 } },
    "paySource": "listing",            // listing chip, or parsed from the description
    "paysMoreBy": 1.95, "scheduleType": "Full-time", "postedAt": "2 days ago",
    "benefits": ["Health insurance"], "applyUrl": "..."
  }]
}
```

Yearly, monthly, weekly and daily pay are converted to hourly at 40 hours a week. The `summary` sentence is written to be read aloud with the browser's speech synthesis.

### `GET /api/meta`, `GET /api/health`

`/api/meta` lists the supported languages and categories. `/api/health` reports whether the SerpApi key is configured.

## Credit usage (Free plan: 250 searches/month)

- Help: 2 searches each for legal aid and worker centers, and 1 for the consulate. The frontend only loads the tab the worker opens.
- Jobs: 1 search per page (2 by default).
- Repeat searches are cached for 6 hours, and identical searches made at the same time share one request.

Errors come back as `{ "error": "message" }`, with status 400 for bad input and 502 if SerpApi fails.
