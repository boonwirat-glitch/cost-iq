-- docs/supabase-migration-key-skus-2026-08-16.sql
--
-- v_key: Key SKU feature — rep marks which SKUs, per account, must never run
-- out of stock. Feeds a future Google Sheets export for supply planning.
--
-- Design: saved_plans-style (rep decides, no approval gate — this is
-- operational and needs to move fast) + nrr_exclusions-style audit trail
-- (set_by/set_at/removed_by/removed_at) so a stock-out incident can be
-- traced back to who flagged/unflagged a SKU and when.
--
-- Why denormalized names (account_name/outlet_name/sku_name) instead of a
-- join at export time: the worker that will export to Google Sheets (a
-- separate scheduled() job in freshket-sense-ai-proxy-v2.js) has no access
-- to the R2 CSV bundles the browser uses to resolve those names — they only
-- ever live in browser memory. Denormalizing at write time is the only way
-- the export worker can produce a human-readable sheet.
--
-- v1 is account-level only. outlet_id/outlet_name are nullable and NOT
-- exposed in the UI yet (bulkSkusData has no outlet-level purchase grain to
-- recommend from) — kept for a future per-outlet expansion.

-- ── 1. key_skus — the actual list ──────────────────────────────────────────
create table if not exists public.key_skus (
  id           uuid primary key default gen_random_uuid(),
  account_id   text not null,
  account_name text not null default '',
  outlet_id    text,              -- nullable — v1 doesn't use this, reserved for later
  outlet_name  text,
  sku_id       text not null,
  sku_name     text not null default '',
  status       text not null default 'active' check (status in ('active','removed')),
  set_by       text,              -- rep email who marked it Key SKU
  set_at       timestamptz not null default now(),
  removed_by   text,
  removed_at   timestamptz
);

comment on table public.key_skus is
  'Rep-curated list of SKUs that must never go out of stock, per account. '
  'No approval workflow — rep decides directly, matching how saved_plans works. '
  'Soft-delete only (status flip) so the audit trail survives a removal.';

-- One active Key SKU per (account, sku) at a time — re-adding after removal
-- creates a fresh row (new set_at) rather than reviving the old one, so the
-- audit trail shows the gap.
create unique index if not exists key_skus_active_uidx
  on public.key_skus (account_id, sku_id)
  where status = 'active';

create index if not exists key_skus_account_idx on public.key_skus (account_id) where status = 'active';
create index if not exists key_skus_set_by_idx   on public.key_skus (set_by)     where status = 'active';

alter table public.key_skus enable row level security;

-- Reps read/write only their own confirmations; TL/admin read across the org
-- for the read-only rollup (matches the "no approval" design — TL sees
-- progress, never edits).
--
-- v2 (2026-08-16, self-review fix): case-fold every email comparison. Confirmed
-- against the real table that at least one admin (salmon@freshket.co in
-- app_user_roles vs Salmon@freshket.co in profiles) has a casing mismatch —
-- an exact `=` comparison here would make this RLS policy silently return zero
-- rows for that admin (no error, just an empty result), the same failure class
-- as the profiles.role / app_user_roles divergence recorded in past incidents.
create policy key_skus_select_own on public.key_skus
  for select using (
    lower(set_by) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1 from public.profiles p
      where lower(p.email) = lower(auth.jwt() ->> 'email') and p.role in ('tl','admin','ad_tl')
    )
  );

create policy key_skus_insert_own on public.key_skus
  for insert with check (lower(set_by) = lower(auth.jwt() ->> 'email'));

create policy key_skus_update_own on public.key_skus
  for update using (lower(set_by) = lower(auth.jwt() ->> 'email'));

-- ── 2. key_skus_export_state — dirty flag for the (later) Sheets export ────
-- Single-row control table. A DB trigger marks it dirty on every key_skus
-- write so no code path can forget to flip the flag by hand.
create table if not exists public.key_skus_export_state (
  id               int primary key default 1,
  dirty            boolean not null default true,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz,
  last_exported_at timestamptz,
  constraint key_skus_export_state_singleton check (id = 1)
);

insert into public.key_skus_export_state (id, dirty)
  values (1, true)
  on conflict (id) do nothing;

create or replace function public._key_skus_mark_export_dirty()
returns trigger as $$
begin
  update public.key_skus_export_state set dirty = true where id = 1;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists key_skus_mark_export_dirty on public.key_skus;
create trigger key_skus_mark_export_dirty
  after insert or update on public.key_skus
  for each statement execute function public._key_skus_mark_export_dirty();

alter table public.key_skus_export_state enable row level security;
create policy key_skus_export_state_select on public.key_skus_export_state for select using (true);

-- ── 3. verify (run manually after applying) ────────────────────────────────
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='key_skus' order by ordinal_position;
-- select * from public.key_skus_export_state;
