-- ============================================================
-- แก้ค่าคอมฯ ก.ค. 2569  —  ทำทีละบล็อก ห้ามข้าม ห้ามสลับ
--
-- วิธีใช้: copy ทีละบล็อก (ตั้งแต่บรรทัด "บล็อก N" จนถึงเส้นคั่นถัดไป)
--          ไปแปะใน Supabase SQL Editor แล้วกด Run
--          ดูผลว่าตรงกับ "ต้องเห็น" มั้ย ถ้าไม่ตรง → หยุด อย่าทำบล็อกถัดไป
--
-- รวมทั้งหมด 6 บล็อก · บล็อก 1-2 ปลอดภัย ไม่แก้อะไร · บล็อก 3-4 คือของจริง
-- ============================================================




-- ============================================================
-- บล็อก 1 — สำรองข้อมูลเดิมไว้ก่อน
-- (แค่ copy ไปแปะแล้วกด Run เดี๋ยว Supabase สร้างตารางให้เอง
--  ไม่ต้องไปกดสร้างตารางที่ไหน)
--
-- ต้องเห็น: เลข 44
-- ============================================================

create table if not exists snap_jul_backup as
select * from commission_payout_snapshots where period_month = '2026-07';

select count(*) as ต้องได้44 from snap_jul_backup;




-- ============================================================
-- บล็อก 2 — ดูก่อนว่าใครจะเปลี่ยนเท่าไหร่ (ยังไม่แก้อะไรทั้งนั้น)
--
-- ต้องเห็น: 43 แถว · คอลัมน์ "ส่วนต่าง" เป็นบวกทุกแถว ไม่มีติดลบ
--           แถวบนสุดคือ nitipat +7500
-- ============================================================

select 'TL' as ประเภท, t.beneficiary_email as ใคร,
       t.payout_amount as เดิม, 75000 as ใหม่, 75000 - t.payout_amount as ส่วนต่าง
from commission_payout_snapshots t
where t.period_month = '2026-07' and t.beneficiary_role = 'tl'
  and t.beneficiary_email = 'nitipat.s@freshket.co'
union all
select j.beneficiary_role, j.beneficiary_email,
       j.payout_amount,
       round(((j.breakdown->>'nrr_payout')::numeric
            + (a.breakdown->'upsell_sku'->>'total_commission')::numeric
            + (a.breakdown->'upsell_outlet'->>'commission')::numeric
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
            * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)),
       round(((j.breakdown->>'nrr_payout')::numeric
            + (a.breakdown->'upsell_sku'->>'total_commission')::numeric
            + (a.breakdown->'upsell_outlet'->>'commission')::numeric
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
            * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)) - j.payout_amount
from commission_payout_snapshots j
join commission_payout_snapshots a
  on a.beneficiary_email = j.beneficiary_email and a.period_month = '2026-08'
where j.period_month = '2026-07' and j.beneficiary_role <> 'tl'
order by ส่วนต่าง desc;




-- ============================================================
-- บล็อก 3 — แก้ทุกคนที่ไม่ใช่ TL  (KAM / PM / AD / Sales / Admin)
-- ⚠ บล็อกนี้แก้ข้อมูลจริงแล้ว
--
-- ต้องเห็น: Success. 42 rows
-- ============================================================

with a as (
  select beneficiary_email,
         breakdown->'upsell_sku'    as sku,
         breakdown->'upsell_outlet' as outlet,
         (breakdown->'upsell_sku'->>'total_commission')::numeric as sku_comm,
         (breakdown->'upsell_outlet'->>'commission')::numeric    as outlet_comm
  from commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role <> 'tl'
),
calc as (
  select j.id, a.sku, a.outlet, j.payout_amount as เดิม,
         round(((j.breakdown->>'nrr_payout')::numeric + a.sku_comm + a.outlet_comm
              + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
              * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)) as ใหม่,
         ((j.breakdown->>'nrr_payout')::numeric + a.sku_comm + a.outlet_comm
              + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))          as subtotal
  from commission_payout_snapshots j
  join a on a.beneficiary_email = j.beneficiary_email
  where j.period_month = '2026-07' and j.beneficiary_role <> 'tl'
)
update commission_payout_snapshots s
set payout_amount = c.ใหม่,
    breakdown = s.breakdown
      || jsonb_build_object('upsell_sku', c.sku)
      || jsonb_build_object('upsell_outlet', c.outlet)
      || jsonb_build_object('components_subtotal', c.subtotal)
      || jsonb_build_object('final_payout', c.ใหม่)
      || jsonb_build_object('revisions',
           coalesce(s.breakdown->'revisions','[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', 'boonwirat.t@freshket.co',
             'kind', 'upsell_recovery',
             'reason', 'กู้ upsell ที่หายเพราะ auto-compute คำนวณตอนข้อมูลโหลดไม่ครบ (1 ส.ค. 00:25 UTC)',
             'prev_payout', c.เดิม, 'new_payout', c.ใหม่))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
from calc c
where s.id = c.id and c.ใหม่ <> s.payout_amount;




-- ============================================================
-- บล็อก 4 — แก้ TL (นิติพัฒน์คนเดียว · ปวริศาไม่ต้องแก้)
-- ⚠ บล็อกนี้แก้ข้อมูลจริงแล้ว
--
-- ต้องเห็น: Success. 1 row
-- ============================================================

update commission_payout_snapshots
set payout_amount = 75000,
    breakdown = breakdown
      || jsonb_build_object('upsell_mult',
           (breakdown->'upsell_mult')
             || jsonb_build_object('multiplier', 1.5, 'tier', 4,
                                   'team_upsell_gmv', 3202052.93,
                                   'team_upsell_pct', 4.17))
      || jsonb_build_object('final_payout', 75000)
      || jsonb_build_object('revisions',
           coalesce(breakdown->'revisions','[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', 'boonwirat.t@freshket.co',
             'kind', 'upsell_recovery_tl',
             'reason', 'upsell ทีมที่ถูกต้องคือ 4.17% ไม่ใช่ 3.49% จึงขึ้นขั้นจาก 1.35x เป็น 1.50x',
             'prev_payout', 67500, 'new_payout', 75000,
             'prev_pct', 3.49, 'new_pct', 4.17))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
where period_month = '2026-07'
  and beneficiary_role = 'tl'
  and beneficiary_email = 'nitipat.s@freshket.co';




-- ============================================================
-- บล็อก 5 — ตรวจว่าถูกต้อง (ไม่แก้อะไร แค่ดู)
--
-- ต้องเห็น 4 แถวแบบนี้เป๊ะ:
--   1. ผลต่างรวม        | 51273  | ต้องได้ 51273
--   2. nitipat          | 75000  | ต้องได้ 75000
--   3. pavarisa         | 36000  | ต้องได้ 36000
--   4. NRR ที่เพี้ยน     | 0      | ต้องได้ 0
-- ============================================================

select 'ผลต่างรวม' as รายการ,
       (select sum(payout_amount) from commission_payout_snapshots where period_month='2026-07')
     - (select sum(payout_amount) from snap_jul_backup) as ค่าที่ได้, 51273 as ต้องได้
union all
select 'nitipat', payout_amount, 75000 from commission_payout_snapshots
where period_month='2026-07' and beneficiary_email='nitipat.s@freshket.co'
union all
select 'pavarisa', payout_amount, 36000 from commission_payout_snapshots
where period_month='2026-07' and beneficiary_email='pavarisa.mu@freshket.co'
union all
select 'NRR ที่เพี้ยน (ต้องเป็น 0)',
       (select count(*) from commission_payout_snapshots s join snap_jul_backup b on b.id=s.id
        where s.period_month='2026-07' and s.governed_nrr_pct is distinct from b.governed_nrr_pct), 0;




-- ============================================================
-- บล็อก 6 — ใช้เฉพาะตอนอยากย้อนกลับ (ปกติไม่ต้องรัน)
-- รันแล้วทุกอย่างกลับไปเหมือนก่อนแก้ทันที
-- ============================================================

-- update commission_payout_snapshots s
-- set payout_amount = b.payout_amount, breakdown = b.breakdown,
--     updated_at = b.updated_at, updated_by = b.updated_by
-- from snap_jul_backup b
-- where s.id = b.id;
