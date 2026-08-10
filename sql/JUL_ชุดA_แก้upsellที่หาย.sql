-- ============================================================
-- ชุด A — แก้ upsell ที่หายไป (KAM / PM / AD / TL)
--
-- ยอดรวมที่เปลี่ยน: +฿19,911
--   KAM 14 คน + PM 3 คน + AD 1 คน  = +฿12,501
--   TL (นิติพัฒน์)                    = +฿7,500
--
-- ⚠ ornpreya (ad) รวมอยู่ในชุดนี้ตามที่บุชสั่ง แต่ **ยอดจ่ายจะยังเป็น ฿0 เหมือนเดิม**
--    เพราะ %NRR ของเธอคือ 92.51% ต่ำกว่าเส้น 95% → GMV Gate คูณ 0 ทั้งก้อน
--    (ยอดก่อนโดน gate จะขยับจาก ฿582.89 เป็น ฿611.22 — ตัวเลขใน breakdown จะถูกต้องขึ้น
--     แต่ถ้าอยากให้เธอได้เงินจริง ต้องไปแก้กติกา gate หรือ waive ร้าน ซึ่งเป็นคนละเรื่อง)
--
-- ไม่แตะ: sales / admin / sales_tl → อยู่ในชุด B
-- ต้องรันบล็อก 1 (สำรอง) จากไฟล์เดิมไปแล้ว — ถ้ายังไม่ได้ทำ กลับไปทำก่อน
-- ============================================================




-- ============================================================
-- A1 — ดูก่อนว่าใครเปลี่ยนเท่าไหร่ (ไม่แก้อะไร)
--
-- ต้องเห็น: 20 แถว · รวมส่วนต่าง = 19911
--           ornpreya อยู่ในลิสต์ ส่วนต่าง 0 (ถูกต้องแล้ว)
-- ============================================================

select j.beneficiary_role as ตำแหน่ง, j.beneficiary_email as ใคร,
       j.payout_amount as เดิม,
       round(((j.breakdown->>'nrr_payout')::numeric
            + (a.breakdown->'upsell_sku'->>'total_commission')::numeric
            + (a.breakdown->'upsell_outlet'->>'commission')::numeric
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
            * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)) as ใหม่,
       round(((j.breakdown->>'nrr_payout')::numeric
            + (a.breakdown->'upsell_sku'->>'total_commission')::numeric
            + (a.breakdown->'upsell_outlet'->>'commission')::numeric
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
            * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)) - j.payout_amount as ส่วนต่าง
from commission_payout_snapshots j
join commission_payout_snapshots a
  on a.beneficiary_email = j.beneficiary_email and a.period_month = '2026-08'
where j.period_month = '2026-07' and j.beneficiary_role in ('kam','pm','ad')
union all
select 'tl', 'nitipat.s@freshket.co', 67500, 75000, 7500
union all
select 'tl', 'pavarisa.mu@freshket.co', 36000, 36000, 0
order by ส่วนต่าง desc;




-- ============================================================
-- A2 — แก้ KAM / PM / AD
-- ⚠ แก้ข้อมูลจริง
--
-- ต้องเห็น: Success. 18 rows
--   (18 ไม่ใช่ 17 เพราะรวม ornpreya ด้วย ตัวเลขใน breakdown เธอเปลี่ยน
--    แม้ยอดจ่ายจะยังเป็น 0)
-- ============================================================

with a as (
  select beneficiary_email,
         breakdown->'upsell_sku'    as sku,
         breakdown->'upsell_outlet' as outlet,
         (breakdown->'upsell_sku'->>'total_commission')::numeric as sku_comm,
         (breakdown->'upsell_outlet'->>'commission')::numeric    as outlet_comm
  from commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role in ('kam','pm','ad')
),
calc as (
  select j.id, a.sku, a.outlet, j.payout_amount as เดิม,
         ((j.breakdown->>'nrr_payout')::numeric + a.sku_comm + a.outlet_comm
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0)) as subtotal,
         round(((j.breakdown->>'nrr_payout')::numeric + a.sku_comm + a.outlet_comm
            + coalesce((j.breakdown->'handover'->>'payout')::numeric,0))
            * coalesce((j.breakdown->'gmv_gate'->>'cap_multiplier')::numeric,1)) as ใหม่
  from commission_payout_snapshots j
  join a on a.beneficiary_email = j.beneficiary_email
  where j.period_month = '2026-07' and j.beneficiary_role in ('kam','pm','ad')
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
where s.id = c.id;




-- ============================================================
-- A3 — แก้ TL ทั้ง 2 คน
-- ⚠ แก้ข้อมูลจริง
--
-- ต้องเห็น: Success. 2 rows
--   นิติพัฒน์ ฿67,500 → ฿75,000  (3.49% → 4.17% ขึ้นขั้น 1.35x → 1.50x)
--   ปวริศา    ฿36,000 → ฿36,000  (2.27% → 2.63% ยังขั้นเดิม 1.20x — แก้แค่ตัวเลขใน breakdown)
-- ============================================================

with agg as (
  select team_lead_email,
         sum((breakdown->'upsell_sku'->'p1'->>'gmv')::numeric
           + (breakdown->'upsell_sku'->'p3'->>'gmv_incremental')::numeric) as new_upsell
  from commission_payout_snapshots
  where period_month = '2026-08' and beneficiary_role = 'kam' and team_lead_email is not null
  group by 1
),
t as (
  select x.id, x.payout_amount as เดิม,
         (x.breakdown->>'nrr_payout')::numeric as nrr,
         agg.new_upsell,
         agg.new_upsell / (x.breakdown->'upsell_mult'->>'team_baseline_gmv')::numeric * 100 as pct
  from commission_payout_snapshots x
  join agg on agg.team_lead_email = x.beneficiary_email
  where x.period_month = '2026-07' and x.beneficiary_role = 'tl'
),
tiered as (
  select t.*,
         case when pct >= 5 then 1.80 when pct >= 4 then 1.50
              when pct >= 3 then 1.35 when pct >= 2 then 1.20 else 1.00 end as mult,
         case when pct >= 5 then 5 when pct >= 4 then 4
              when pct >= 3 then 3 when pct >= 2 then 2 else 1 end as tier
  from t
)
update commission_payout_snapshots s
set payout_amount = round(k.nrr * k.mult),
    breakdown = s.breakdown
      || jsonb_build_object('upsell_mult',
           (s.breakdown->'upsell_mult')
             || jsonb_build_object('multiplier', k.mult, 'tier', k.tier,
                                   'team_upsell_gmv', k.new_upsell,
                                   'team_upsell_pct', round(k.pct, 2)))
      || jsonb_build_object('final_payout', round(k.nrr * k.mult))
      || jsonb_build_object('revisions',
           coalesce(s.breakdown->'revisions','[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', 'boonwirat.t@freshket.co',
             'kind', 'upsell_recovery_tl',
             'reason', 'กู้ upsell ทีมที่หาย — ตัวคูณคิดใหม่จาก baseline ก.ค. เดิม',
             'prev_payout', k.เดิม, 'new_payout', round(k.nrr * k.mult),
             'new_pct', round(k.pct, 2)))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
from tiered k
where s.id = k.id;




-- ============================================================
-- A4 — ตรวจ (ไม่แก้อะไร)
--
-- ต้องเห็น 5 แถว:
--   ผลต่างรวมชุด A       | 19911 | ต้องได้ 19911
--   nitipat              | 75000 | ต้องได้ 75000
--   pavarisa             | 36000 | ต้องได้ 36000
--   ornpreya             | 0     | ต้องได้ 0
--   NRR ที่เพี้ยน         | 0     | ต้องได้ 0
-- ============================================================

select 'ผลต่างรวมชุด A' as รายการ,
       (select sum(payout_amount) from commission_payout_snapshots
        where period_month='2026-07' and beneficiary_role in ('kam','pm','ad','tl'))
     - (select sum(payout_amount) from snap_jul_backup
        where beneficiary_role in ('kam','pm','ad','tl')) as ค่าที่ได้, 19911 as ต้องได้
union all
select 'nitipat', payout_amount, 75000 from commission_payout_snapshots
where period_month='2026-07' and beneficiary_email='nitipat.s@freshket.co'
union all
select 'pavarisa', payout_amount, 36000 from commission_payout_snapshots
where period_month='2026-07' and beneficiary_email='pavarisa.mu@freshket.co'
union all
select 'ornpreya (ต้องยัง 0)', payout_amount, 0 from commission_payout_snapshots
where period_month='2026-07' and beneficiary_email='ornpreya.s@freshket.co'
union all
select 'NRR ที่เพี้ยน (ต้อง 0)',
       (select count(*) from commission_payout_snapshots s join snap_jul_backup b on b.id=s.id
        where s.period_month='2026-07' and s.governed_nrr_pct is distinct from b.governed_nrr_pct), 0;




-- ============================================================
-- ย้อนกลับเฉพาะชุด A (ปกติไม่ต้องรัน — ลบ -- ข้างหน้าก่อนถึงจะทำงาน)
-- ============================================================
-- update commission_payout_snapshots s
-- set payout_amount = b.payout_amount, breakdown = b.breakdown,
--     updated_at = b.updated_at, updated_by = b.updated_by
-- from snap_jul_backup b
-- where s.id = b.id and s.beneficiary_role in ('kam','pm','ad','tl');
