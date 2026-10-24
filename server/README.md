# FairShift SerpApi service

Backend for two features powered by [SerpApi](https://serpapi.com):

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
PORT=8787
CACHE_TTL_MINUTES=360      # identical searches are cached in memory to save credits
CORS_ORIGIN=*              # optional
```

The Vite dev server proxies `/api` to `http://localhost:8787`. Set `FAIRSHIFT_API_URL` to point it somewhere else, or set `VITE_API_URL` in the frontend to call the API directly.

## Merging into another Express backend

```js
import { serpRouter } from "./server/src/routes.js"
app.use(express.json())
app.use("/api", serpRouter)   // /api/help, /api/jobs/compare, /api/meta
```
