-- FairShift database. Run once in your Supabase project: SQL Editor → New query →
-- paste this file → Run. Safe to run again.

-- One row per worker (Google account).
create table if not exists public.profiles (
  id text primary key,                    -- Google account id ("sub")
  email text not null,
  name text,
  picture text,
  occupation text,
  location text,                          -- city or ZIP code
  hourly_wage numeric(10, 2),
  language text,                          -- app language, e.g. "Español"
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  updated_at timestamptz
);

-- One row per pay stub upload. Key numbers have their own columns for lists and
-- reports; `paystub` keeps every extracted field.
create table if not exists public.paystub_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  file_path text,                         -- path in the private "paystubs" bucket
  file_name text,
  content_type text,
  file_size integer,
  employer_name text,
  pay_period_start date,
  pay_period_end date,
  pay_date date,
  currency text,
  gross_pay numeric(12, 2),
  net_pay numeric(12, 2),
  regular_hours numeric(8, 2),
  regular_hourly_rate numeric(10, 2),
  overtime_hours numeric(8, 2),
  overtime_pay numeric(12, 2),
  hourly_wage_entered numeric(10, 2),     -- the worker's saved wage when they uploaded
  paystub jsonb not null,                 -- every extracted field
  summary text,                           -- explanation in the worker's language
  warnings jsonb,                         -- review notes in the worker's language
  sent_text text,                         -- the redacted text that was sent to Muse
  language text
);
create index if not exists paystub_uploads_user_created
  on public.paystub_uploads (user_id, created_at desc);

-- Row level security on, with no policies: the browser can't read these tables.
-- Only the FairShift server, using the service_role key, can.
alter table public.profiles enable row level security;
alter table public.paystub_uploads enable row level security;

-- Private bucket for the original photos and PDFs (30 MB each).
insert into storage.buckets (id, name, public, file_size_limit)
values ('paystubs', 'paystubs', false, 31457280)
on conflict (id) do nothing;
