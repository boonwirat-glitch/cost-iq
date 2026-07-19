-- Add 'pm' login role — 4 new staff (3 PM + 1 AD, mislabeled PM)
-- Run manually in the Supabase SQL editor against the freshket-costiq
-- project, AFTER creating each person's Supabase Auth account yourself
-- (Dashboard → Authentication → Users → Add User). Claude cannot create
-- accounts or set passwords — that step is manual, by design (org policy).
--
-- Context: all 4 get role='pm' for now (uniform, simplest — matches how
-- everyone currently refers to them). One of them, Ornpreya (Ice) Sukthai,
-- is really AD (Account Development), and Sense already has a fully-working
-- distinct 'ad' role — if you'd rather she carry the more accurate label,
-- just change her one row below to role='ad' (or run a follow-up UPDATE
-- later; behavior is identical either way, both roles are wired the same
-- in code — see src/01_core.js normalizeRole() and src/nrr/nrr_core.js
-- nrrNormalizeRole()).
--
-- People:
--   Panitan (Aom) Promta        panitan.p@freshket.co    — PM, no TL
--   Sarawoot (Oh) Kaewkhao      sarawoot.k@freshket.co   — PM, no TL
--   Nichamon (Ninew) Kanghae    nichamon.k@freshket.co   — PM, no TL
--   Ornpreya (Ice) Sukthai      ornpreya.s@freshket.co   — AD (mislabeled PM), TL = Pavarisa (Ploiiy) Muangtaeng / pavarisa.mu@freshket.co
--
-- Idempotent — safe to re-run (UPDATE/INSERT ON CONFLICT).

begin;

-- 1. If a profiles row already exists for each email (e.g. an auto-provision
--    trigger on auth.users fires on signup), this brings it up to date.
update public.profiles
set role = 'pm'
where email in (
  'panitan.p@freshket.co',
  'sarawoot.k@freshket.co',
  'nichamon.k@freshket.co',
  'ornpreya.s@freshket.co'
);

-- 2. If no such trigger exists, no row was touched above — insert one per
--    person by joining their new auth.users row on email. Safe to run even
--    if some/all already exist (ON CONFLICT no-ops those).
insert into public.profiles (id, email, role, full_name, kam_name)
select u.id, u.email, 'pm',
  case u.email
    when 'panitan.p@freshket.co'  then 'Panitan (Aom)'
    when 'sarawoot.k@freshket.co' then 'Sarawoot (Oh)'
    when 'nichamon.k@freshket.co' then 'Nichamon (Ninew)'
    when 'ornpreya.s@freshket.co' then 'Ornpreya (Ice)'
  end,
  case u.email
    when 'panitan.p@freshket.co'  then 'Panitan (Aom)'
    when 'sarawoot.k@freshket.co' then 'Sarawoot (Oh)'
    when 'nichamon.k@freshket.co' then 'Nichamon (Ninew)'
    when 'ornpreya.s@freshket.co' then 'Ornpreya (Ice)'
  end
from auth.users u
where u.email in (
  'panitan.p@freshket.co',
  'sarawoot.k@freshket.co',
  'nichamon.k@freshket.co',
  'ornpreya.s@freshket.co'
)
on conflict (id) do update set role = excluded.role;

commit;

-- Verify — should show all 4, role='pm', id matching a real auth.users row:
select p.id, p.email, p.role, p.full_name
from public.profiles p
where p.email in (
  'panitan.p@freshket.co',
  'sarawoot.k@freshket.co',
  'nichamon.k@freshket.co',
  'ornpreya.s@freshket.co'
);

-- If the SELECT above returns fewer than 4 rows, the matching auth.users
-- account doesn't exist yet for the missing email(s) — create it in the
-- Dashboard first, then re-run this whole script (idempotent).
