-- Onboard 3 new staff (2 AD, 1 Admin) — Koi, Wanmai, Bank
-- Run manually in the Supabase SQL editor against the freshket-costiq
-- project, AFTER creating each person's Supabase Auth account yourself
-- (Dashboard → Authentication → Users → Add User). Claude cannot create
-- accounts or set passwords — that step is manual, by design (org policy).
--
-- Context: Oh (sarawoot.k@freshket.co) and Ninew (nichamon.k@freshket.co)
-- from this same hiring round already have role='pm' from the 2026-07-17
-- rollout — no action needed for them, not included below.
--
-- People:
--   Chanitsara (Koi) Damrongchai     chanitsara.d@freshket.co  — AD, no TL
--   Kritkanok (Wanmai) Kaewkham      kritkanok.k@freshket.co   — AD, no TL
--   Jirawat (Bank) Thongsuk          jirawat.t@freshket.co     — Admin (same tier as existing Admins)
--
-- Idempotent — safe to re-run (UPDATE/INSERT ON CONFLICT).

begin;

-- 1. If a profiles row already exists for each email (e.g. an auto-provision
--    trigger on auth.users fires on signup), this brings it up to date.
update public.profiles
set role = 'ad'
where email in (
  'chanitsara.d@freshket.co',
  'kritkanok.k@freshket.co'
);

update public.profiles
set role = 'admin'
where email = 'jirawat.t@freshket.co';

-- 2. If no such trigger exists, no row was touched above — insert one per
--    person by joining their new auth.users row on email. Safe to run even
--    if some/all already exist (ON CONFLICT no-ops those).
insert into public.profiles (id, email, role, full_name, kam_name)
select u.id, u.email,
  case u.email
    when 'jirawat.t@freshket.co' then 'admin'
    else 'ad'
  end,
  case u.email
    when 'chanitsara.d@freshket.co' then 'Chanitsara (Koi)'
    when 'kritkanok.k@freshket.co'  then 'Kritkanok (Wanmai)'
    when 'jirawat.t@freshket.co'    then 'Jirawat (Bank)'
  end,
  case u.email
    when 'chanitsara.d@freshket.co' then 'Chanitsara (Koi)'
    when 'kritkanok.k@freshket.co'  then 'Kritkanok (Wanmai)'
    when 'jirawat.t@freshket.co'    then 'Jirawat (Bank)'
  end
from auth.users u
where u.email in (
  'chanitsara.d@freshket.co',
  'kritkanok.k@freshket.co',
  'jirawat.t@freshket.co'
)
on conflict (id) do update set role = excluded.role;

commit;

-- Verify — should show all 3, correct roles, id matching a real auth.users row:
select p.id, p.email, p.role, p.full_name
from public.profiles p
where p.email in (
  'chanitsara.d@freshket.co',
  'kritkanok.k@freshket.co',
  'jirawat.t@freshket.co'
);

-- If the SELECT above returns fewer than 3 rows, the matching auth.users
-- account doesn't exist yet for the missing email(s) — create it in the
-- Dashboard first, then re-run this whole script (idempotent).
--
-- NOT included here (deliberately, per Bush's decision 2026-08-18):
-- app_user_roles rows for anyone. That table's own CHECK constraint doesn't
-- even accept 'ad', and none of the existing 3 PMs have a row there either
-- — everything works fine without it. profiles.role='admin' alone already
-- puts Bank on the same tier as every other Admin. Revisit only if he hits
-- an actual "no permission" screen tied to team-management features.
