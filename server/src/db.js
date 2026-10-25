// Supabase client for the server. Uses the service_role key, which bypasses row
// level security, so it must never reach the browser. When SUPABASE_URL or
// SUPABASE_SERVICE_ROLE_KEY is missing, the stores fall back to local files in
// server/data (fine for development, not for production).

import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
export const PAYSTUB_BUCKET = "paystubs"

// Supabase returns { data, error }; turn errors into exceptions.
export function check({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`)
  return data
}
