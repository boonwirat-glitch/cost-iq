-- Waived Account feature v3 — outlet-level scoping + admin revoke
-- Run manually in the Supabase SQL editor (or via Supabase MCP) against the
-- freshket-costiq project. Idempotent — safe to re-run.
--
-- 1. Replace the single UNIQUE(account_id, period_month) constraint with two
--    partial unique indexes so BOTH a whole-account waiver (outlet_id IS
--    NULL) and one or more outlet-scoped waivers (outlet_id set) can coexist
--    for the same account+month without colliding.
-- 2. Add 'revoked' to the status CHECK constraint — lets an Admin undo an
--    already-approved waiver (distinct from 'rejected', which only applies
--    to a still-pending request never put into effect).

begin;

alter table public.nrr_exclusions
  drop constraint if exists nrr_exclusions_account_period_unique;

drop index if exists nrr_excl_account_scope_uniq;
create unique index nrr_excl_account_scope_uniq
  on public.nrr_exclusions (account_id, period_month)
  where outlet_id is null;

drop index if exists nrr_excl_outlet_scope_uniq;
create unique index nrr_excl_outlet_scope_uniq
  on public.nrr_exclusions (outlet_id, period_month)
  where outlet_id is not null;

alter table public.nrr_exclusions
  drop constraint if exists nrr_exclusions_status_check;
alter table public.nrr_exclusions
  add constraint nrr_exclusions_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'revoked'));

commit;

-- Verification
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.nrr_exclusions'::regclass
order by conname;

select indexname, indexdef
from pg_indexes
where tablename = 'nrr_exclusions'
order by indexname;
