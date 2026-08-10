-- ============================================================================
-- แก้ค่าคอมฯ ก.ค. 2569 ที่ล็อกไว้ — upsell ขาดหายจาก load race
-- เขียนโดย Claude 2026-08-02 · ให้ Bucci ตรวจก่อนรัน
-- ============================================================================
--
-- ปัญหา
--   draft ของ ก.ค. ถูกสร้างโดย auto-compute ตอนบูตวันที่ 1 ส.ค. เวลา 00:25:08 UTC
--   ตอนนั้นข้อมูล upsell ยังโหลดไม่ครบ → ตัวเลขต่ำกว่าจริง
--   อีก 2 นาที 21 วินาทีต่อมา (00:27:29) auto-compute รอบที่สองสร้าง draft ของ ส.ค.
--   จากไฟล์ R2 ก้อนเดียวกัน (วันที่ 1 ส.ค. ไฟล์ยังเป็นของ ก.ค. เพราะ SQL ยึด day-1)
--   แต่คราวนี้โหลดครบกว่า → ตัวเลขสูงกว่าทุกคน
--   บุชกดล็อก ก.ค. ทับ draft ก้อนแรกเมื่อ 2 ส.ค. 00:00:46 UTC
--
-- หลักฐานว่าเป็น load race ไม่ใช่ความต่างของเดือน
--   1. policy ของ ก.ค./ส.ค. เหมือนกันทุกช่อง (quarterly · base_month 2026-06 · Q3)
--   2. q3c_upsell_bulk_all_kams_v4.sql รายงานเดือนเดียว → 1 ส.ค. = ข้อมูล ก.ค. ทั้งคู่
--   3. KAM ทั้ง 14/14 คน รอบหลังสูงกว่ารอบแรก **ไม่มีใครต่ำลงเลย**
--      ถ้าเป็นความต่างของเดือนหรือของนิยาม ต้องมีทั้งขึ้นและลง
--   4. ร่องรอยในตัวข้อมูลเอง: P1 groups เท่ากัน (21 = 21) แต่ P3 groups ต่างกัน 11 → 17
--      คือรอบหลังมีกลุ่มผ่านเกณฑ์มากกว่าเพราะข้อมูลฐานโหลดมาครบกว่า
--
-- ⚠ ข้อจำกัดที่ต้องรับทราบก่อนรัน
--   ไฟล์ sense_upsell_team.csv ถูกทับไปแล้วเมื่อ 2 ส.ค. 07:05 น. (4 นาทีหลังบุชล็อก)
--   ตอนนี้เหลือ P1+P3 ทั้งองค์กรแค่ ฿40,783 (1 วันของ ส.ค.) → **คำนวณ ก.ค. ใหม่จาก R2 ไม่ได้แล้ว**
--   สคริปต์นี้จึงใช้แถว draft ของ ส.ค. เป็นแหล่งข้อมูล เพราะเป็นสำเนาที่โหลดครบที่สุดของ ก.ค.
--   ที่ยังเหลืออยู่
--
--   สิ่งที่ยืนยันได้: ตัวเลข ส.ค. **ครบกว่า** ของ ก.ค. แน่นอน
--   สิ่งที่ยืนยันไม่ได้: ตัวเลข ส.ค. **ครบ 100% หรือยัง** — อาจจะยังขาดอยู่บ้าง
--
--   ทางที่ชัวร์กว่า ถ้าบุชอยากได้ความมั่นใจสูงสุด:
--     ให้ทีม data แก้ q3c_upsell_bulk_all_kams_v4.sql บรรทัด 23 ชั่วคราวเป็น
--       DATE('2026-07-01') AS current_mo
--     รันใหม่ อัปไฟล์ แล้วค่อยกด Compute + Lock ก.ค. ในแอป (แม่นกว่าสคริปต์นี้)
--
-- ผลรวมที่จะเปลี่ยน: +฿51,273  (44 แถว)
--   TL         +7,500   (นิติพัฒน์เท่านั้น · ปวริศาไม่ขยับ)
--   KAM + PM   +12,501  (17 คน)
--   Sales/Admin +31,272 (24 คน × ฿1,303 — คนละ ฿1,303 เท่ากันหมดเพราะใช้ pool expansion ก้อนเดียวกัน)
--
-- ไม่แตะ: %NRR · nrr_payout · handover · gate — ทั้งหมดถูกต้องอยู่แล้ว
-- ============================================================================


-- ── STEP 0 · สำรองก่อนเสมอ (ห้ามข้าม) ──────────────────────────────────────
create table if not exists commission_payout_snapshots_bak_20260802 as
select * from public.commission_payout_snapshots where period_month = '2026-07';

-- ตรวจว่าสำรองครบ 44 แถว
select count(*) as backed_up from commission_payout_snapshots_bak_20260802;


-- ── STEP 1 · ดูตารางเทียบก่อน/หลัง (รันดูเฉยๆ ยังไม่แก้อะไร) ─────────────────
with j as (
  select id, beneficiary_email, beneficiary_role, payout_amount,
         (breakdown->>'nrr_payout')::numeric                             as nrr_payout,
         (breakdown->'handover'->>'payout')::numeric                     as ho,
         coalesce((breakdown->'gmv_gate'->>'cap_multiplier')::numeric, 1) as gate
  from public.commission_payout_snapshots
  where period_month = '2026-07' and beneficiary_role <> 'tl'),
a as (
  select beneficiary_email,
         (breakdown->'upsell_sku'->>'total_commission')::numeric as sku_comm,
         (breakdown->'upsell_outlet'->>'commission')::numeric    as outlet_comm
  from public.commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role <> 'tl')
select j.beneficiary_role, j.beneficiary_email,
       j.payout_amount as payout_เดิม,
       round((j.nrr_payout + a.sku_comm + a.outlet_comm + j.ho) * j.gate) as payout_ใหม่,
       round((j.nrr_payout + a.sku_comm + a.outlet_comm + j.ho) * j.gate) - j.payout_amount as ส่วนต่าง
from j join a using (beneficiary_email)
order by ส่วนต่าง desc;


-- ── STEP 2 · แก้แถวที่ไม่ใช่ TL (KAM / PM / AD / Sales / Admin) ────────────
-- เอา upsell_sku กับ upsell_outlet จากแถว ส.ค. มาแทน แล้วคิดยอดใหม่ตามสูตรเดิม:
--   subtotal = nrr_payout + upsell_sku + upsell_outlet + handover
--   final    = round(subtotal × gate)
with a as (
  select beneficiary_email,
         breakdown->'upsell_sku'                                 as sku,
         breakdown->'upsell_outlet'                              as outlet,
         (breakdown->'upsell_sku'->>'total_commission')::numeric as sku_comm,
         (breakdown->'upsell_outlet'->>'commission')::numeric    as outlet_comm
  from public.commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role <> 'tl'),
calc as (
  select j.id, a.sku, a.outlet,
         (j.breakdown->>'nrr_payout')::numeric
           + a.sku_comm + a.outlet_comm
           + coalesce((j.breakdown->'handover'->>'payout')::numeric, 0)      as subtotal,
         coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric, 1)  as gate,
         j.payout_amount                                                     as old_payout
  from public.commission_payout_snapshots j
  join a on a.beneficiary_email = j.beneficiary_email
  where j.period_month = '2026-07' and j.beneficiary_role <> 'tl')
update public.commission_payout_snapshots s
set payout_amount = round(c.subtotal * c.gate),
    breakdown = s.breakdown
      || jsonb_build_object('upsell_sku',          c.sku)
      || jsonb_build_object('upsell_outlet',       c.outlet)
      || jsonb_build_object('components_subtotal', c.subtotal)
      || jsonb_build_object('final_payout',        round(c.subtotal * c.gate))
      || jsonb_build_object('revisions',
           coalesce(s.breakdown->'revisions', '[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at',           now(),
             'by',           'boonwirat.t@freshket.co',
             'kind',         'upsell_recovery',
             'reason',       'กู้ upsell ที่หายจาก load race ของ auto-compute 2026-08-01 00:25 UTC',
             'source',       'snapshot 2026-08 draft (computed 00:27 UTC จากไฟล์ ก.ค. ก้อนเดียวกัน)',
             'prev_payout',  c.old_payout,
             'new_payout',   round(c.subtotal * c.gate)))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
from calc c
where s.id = c.id
  and round(c.subtotal * c.gate) <> s.payout_amount;   -- แก้เฉพาะแถวที่เปลี่ยนจริง


-- ── STEP 3 · แก้แถว TL ────────────────────────────────────────────────────
-- ตัวคูณคิดจาก upsell ทีมใหม่ ÷ baseline **ของ ก.ค. เดิม** (baseline เป็นของเดือน ก.ค. ห้ามเอาของ ส.ค. มา)
--   นิติพัฒน์  3.4867% → 4.1687%  → ขั้น 4–5% → 1.50×  → ฿75,000  (เดิม ฿67,500)
--   ปวริศา     2.2663% → 2.6320%  → ขั้น 2–3% → 1.20×  → ฿36,000  (ไม่เปลี่ยน)
with agg as (
  select team_lead_email,
         sum((breakdown->'upsell_sku'->'p1'->>'gmv')::numeric
           + (breakdown->'upsell_sku'->'p3'->>'gmv_incremental')::numeric) as new_upsell
  from public.commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role = 'kam' and team_lead_email is not null
  group by 1),
calc as (
  select t.id, t.payout_amount as old_payout,
         (t.breakdown->>'nrr_payout')::numeric                       as nrr_payout,
         agg.new_upsell,
         (t.breakdown->'upsell_mult'->>'team_baseline_gmv')::numeric as baseline,
         agg.new_upsell / (t.breakdown->'upsell_mult'->>'team_baseline_gmv')::numeric * 100 as pct
  from public.commission_payout_snapshots t
  join agg on agg.team_lead_email = t.beneficiary_email
  where t.period_month = '2026-07' and t.beneficiary_role = 'tl'),
tiered as (   -- ขั้นตัวคูณตามที่ตั้งไว้ใน commission_rule_tiers (team_upsell_pct)
  select c.*, case when c.pct >= 5 then 1.80
                   when c.pct >= 4 then 1.50
                   when c.pct >= 3 then 1.35
                   when c.pct >= 2 then 1.20
                   else 1.00 end as mult,
              case when c.pct >= 5 then 5 when c.pct >= 4 then 4
                   when c.pct >= 3 then 3 when c.pct >= 2 then 2 else 1 end as tier
  from calc c)
update public.commission_payout_snapshots s
set payout_amount = round(t.nrr_payout * t.mult),
    breakdown = s.breakdown
      || jsonb_build_object('upsell_mult',
           (s.breakdown->'upsell_mult')
             || jsonb_build_object('multiplier',      t.mult,
                                   'tier',            t.tier,
                                   'team_upsell_gmv', t.new_upsell,
                                   'team_upsell_pct', round(t.pct, 2)))
      || jsonb_build_object('final_payout', round(t.nrr_payout * t.mult))
      || jsonb_build_object('revisions',
           coalesce(s.breakdown->'revisions', '[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at',           now(),
             'by',           'boonwirat.t@freshket.co',
             'kind',         'upsell_recovery_tl',
             'reason',       'กู้ upsell ทีมที่หายจาก load race — ตัวคูณคิดใหม่จาก baseline ก.ค. เดิม',
             'prev_payout',  t.old_payout,
             'new_payout',   round(t.nrr_payout * t.mult),
             'prev_pct',     round((s.breakdown->'upsell_mult'->>'team_upsell_pct')::numeric, 2),
             'new_pct',      round(t.pct, 2)))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
from tiered t
where s.id = t.id
  and round(t.nrr_payout * t.mult) <> s.payout_amount;


-- ── STEP 4 · ตรวจหลังแก้ ──────────────────────────────────────────────────
-- 4.1 ยอดรวมต้องเพิ่มขึ้น 51,273 พอดี
select (select sum(payout_amount) from public.commission_payout_snapshots where period_month='2026-07')
     - (select sum(payout_amount) from commission_payout_snapshots_bak_20260802) as ผลต่างรวม;

-- 4.2 TL ต้องได้ตามนี้
select beneficiary_email, payout_amount,
       breakdown->'upsell_mult'->>'multiplier'      as mult,
       breakdown->'upsell_mult'->>'team_upsell_pct' as pct
from public.commission_payout_snapshots
where period_month='2026-07' and beneficiary_role='tl';
-- คาดหวัง: nitipat ฿75,000 · 1.50 · 4.17   |   pavarisa ฿36,000 · 1.20 · 2.63

-- 4.3 %NRR ต้องไม่ขยับเลยสักแถว (ต้องได้ 0 แถว)
select s.beneficiary_email, b.governed_nrr_pct as เดิม, s.governed_nrr_pct as ใหม่
from public.commission_payout_snapshots s
join commission_payout_snapshots_bak_20260802 b on b.id = s.id
where s.period_month='2026-07' and s.governed_nrr_pct is distinct from b.governed_nrr_pct;

-- 4.4 ทุกแถวยังเป็น final และยังมีครบ 44 แถว
select snapshot_status, count(*) from public.commission_payout_snapshots
where period_month='2026-07' group by 1;


-- ── ถ้าต้องการย้อนกลับ ────────────────────────────────────────────────────
-- update public.commission_payout_snapshots s
-- set payout_amount = b.payout_amount, breakdown = b.breakdown,
--     updated_at = b.updated_at, updated_by = b.updated_by
-- from commission_payout_snapshots_bak_20260802 b
-- where s.id = b.id;
