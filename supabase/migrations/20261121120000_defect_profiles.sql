-- Phase 3 of the flip rating: defect profiles per model ("Modell-Akte") from the Dutch vehicle
-- authority RDW (open data, CC0) and a risk buffer per listing. See src/core/defects.ts and
-- src/ingest/defects.

-- RDW's list of defect codes with their Dutch names and the component group they belong to
-- (classifyDefect). Null component: a defect in no group (seat belt, number plate, ...).
create table rdw_defect_codes (
  code        text primary key,
  description text not null,
  component   text,
  fetched_at  timestamptz not null default now()
);

-- One row per model and age group (index into AGE_BUCKETS): how many cars were sampled from the
-- Dutch register, how many of them had any defect at the periodic inspection in the window, and
-- per component group how many had one there. sample = 0 means the model is too rare in the
-- Netherlands at that age; such rows are kept so the next run does not ask again right away.
create table model_defect_profiles (
  make_slug     text not null,
  model_slug    text not null,
  age_bucket    smallint not null,
  sample        integer not null,
  any_defect    integer not null,
  components    jsonb not null default '{}',
  window_months smallint not null,
  -- The RDW trade names (handelsbenaming) the sample was drawn from, for checking the mapping.
  rdw_names     text[] not null default '{}',
  refreshed_at  timestamptz not null default now(),
  primary key (make_slug, model_slug, age_bucket)
);

-- Each refresh run, for the status line on /reparaturen and for finding errors.
create table defect_profile_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  profiles    integer not null default 0,
  requests    integer not null default 0,
  error       text
);

-- The risk buffer of a listing's flip (src/ingest/repairs.ts), in euros: defects the next
-- inspection usually finds on such a car (from its model's profile, else the average car of its
-- age), and a worse damage than the title names when the price is far below market. Null until
-- computed or when nothing is known.
alter table listings add column repair_risk_hidden_eur integer;
alter table listings add column repair_risk_unclear_eur integer;
