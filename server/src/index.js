import app from "./app.js"
import { supabase } from "./db.js"

const port = Number(process.env.PORT) || 8787

app.listen(port, () => {
  console.log(`FairShift SerpApi service listening on http://localhost:${port}`)
  if (!process.env.SERPAPI_KEY) console.warn("Warning: SERPAPI_KEY is not set — searches will fail.")
  console.log(supabase ? "Saving users and uploads to Supabase." : "Supabase is not configured; saving users and uploads to server/data.")
})
