-- Waived Account (NRR Exclusion) feature — schema + RLS fix for nrr_exclusions
-- Run manually in the Supabase SQL editor (or via Supabase MCP) against the
-- freshket-costiq project. Idempotent — safe to re-run.
--
-- Fixes, relative to the table as originally shipped (never actually used —
-- 0 rows in production as of this migration):
--   1. reason_code CHECK replaced with the 4 real waiver reasons (was a
--      generic closed_business/bad_debt/fraud/force_majeure/other set).
--   2. applies_to column dropped — always 'both' in practice, never branched
--      on anywhere in the app; dead weight.
--   3. UNIQUE(account_id, period_month) — one active waiver decision per
--      account per month (app-level fixed the missing period_month filter
--      bug in _nrrExclusionApprovedForScope; this is the DB-level backstop).
--   4. Partial index serving the "approved rows for this period" read path
--      every NRR compute function will now make.
--   5. UPDATE RLS tightened — a TL could previously flip status to
--      'approved'/'rejected' on their own team's rows (app_can_manage_team
--      grants updated with no status-transition restriction). Only an admin
--      write may move a row out of 'submitted'.

begin;

-- 1. reason_code: replace the check constraint
alter table public.nrr_exclusions
  drop constraint if exists nrr_exclusions_reason_code_check;

-- Any pre-existing rows using the old codes would violate the new
-- constraint — table is confirmed empty (0 rows) as of this migration, so
-- no backfill/reconciliation is needed. If this is ever re-run against a
-- populated table, reconcile old codes before proceeding.
alter table public.nrr_exclusions
  add constraint nrr_exclusions_reason_code_check
  check (reason_code in ('renovation_closed', 'school_term_break', 'business_closed', 'overdue_debt'));

-- 2. Drop the unused applies_to column
alter table public.nrr_exclusions
  drop column if exists applies_to;

-- 3. One active decision per account per month
alter table public.nrr_exclusions
  drop constraint if exists nrr_exclusions_account_period_unique;
alter table public.nrr_exclusions
  add constraint nrr_exclusions_account_period_unique unique (account_id, period_month);

-- 4. Partial index for the "approved rows for this period" read path
drop index if exists idx_nrr_exclusions_period_account;
create index idx_nrr_exclusions_period_account
  on public.nrr_exclusions (period_month, account_id)
  where status = 'approved';

-- 5. Tighten UPDATE RLS: a TL may only touch their own team's rows while
-- the row is 'submitted', and USING+WITH CHECK together mean the row must
-- STAY 'submitted' after their update — a TL cannot flip status to
-- 'approved'/'rejected' via a direct API call. Only app_is_admin() may
-- move a row out of 'submitted'. No DELETE policy is added (no withdrawal
-- feature in this round — not part of the requirement); a TL who needs to
-- correct a pending request should ask an admin to reject it and submit a
-- fresh one.
drop policy if exists "update exclusions own team" on public.nrr_exclusions;
create policy "update exclusions own team" on public.nrr_exclusions
  for update
  using (app_is_admin() or (app_can_manage_team(target_tl_email) and status = 'submitted'))
  with check (app_is_admin() or (app_can_manage_team(target_tl_email) and status = 'submitted'));

commit;

-- Verification
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.nrr_exclusions'::regclass
order by conname;

select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'nrr_exclusions'
order by policyname;
