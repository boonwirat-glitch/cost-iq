-- ============================================================
-- ชุด B — ล้างค่าคอมฯ ของ sales / admin / sales_tl ที่ไม่ควรมี
--
-- ยอดที่จะหายไป: −฿214,896  (24 คน)
--   sales     15 คน × ฿8,954 = ฿134,310
--   admin      7 คน × ฿8,954 = ฿62,678
--   sales_tl   2 คน × ฿8,954 = ฿17,908
--
-- ทำไมถึงผิด
--   ทั้ง 24 คนได้ยอดเท่ากันเป๊ะ และ outlet GMV ที่ใช้คิดคือ ฿1,790,879.38 ตัวเดียวกันหมด
--   = ก้อน expansion ของทั้งบริษัท ถูกยกไปคิดให้ทุกคนเต็มก้อน ไม่ได้แบ่งตามผลงานใคร
--   เทียบกับ KAM ที่ outlet GMV เป็นของใครของมัน (14 คน 14 ค่า)
--   สาเหตุ: เปิด role พวกนี้เข้าระบบไว้ (Phase 9) แต่ยังไม่ได้ตั้งกติกาจริง
--   → ตกไปใช้ค่า default Expansion 0.5% แล้วหา outlet เฉพาะคนไม่เจอ เลยใช้ก้อนรวม
--
-- ตรวจย้อนหลังแล้ว: พ.ค. กับ มิ.ย. **ไม่มีปัญหานี้** — role พวกนี้เพิ่งโผล่เดือน ก.ค.
--
-- วิธีที่ใช้: ตั้งยอดเป็น ฿0 แต่ **เก็บแถวไว้** (ไม่ลบ)
--   เพราะย้อนกลับง่ายกว่า และยังเห็นร่องรอยว่าเคยมีอะไรเกิดขึ้น
--   ถ้าบุชอยากลบแถวทิ้งเลย ใช้บล็อก B3 แทน B2 (อ่านคำเตือนก่อน)
-- ============================================================




-- ============================================================
-- B1 — ดูก่อนว่าใครโดนบ้าง (ไม่แก้อะไร)
--
-- ต้องเห็น: 24 แถว · ทุกคน "เดิม" = 8954.00 เหมือนกันหมด
-- ============================================================

select beneficiary_role as ตำแหน่ง, beneficiary_email as ใคร,
       payout_amount as เดิม, 0 as ใหม่,
       (breakdown->'upsell_outlet'->>'outlet_gmv')::numeric as outlet_gmv_ที่ใช้คิด
from commission_payout_snapshots
where period_month = '2026-07'
  and beneficiary_role in ('sales','admin','sales_tl')
order by beneficiary_role, beneficiary_email;




-- ============================================================
-- B2 — ตั้งยอดเป็น ฿0 (เก็บแถวไว้)   ← แนะนำใช้อันนี้
-- ⚠ แก้ข้อมูลจริง
--
-- ต้องเห็น: Success. 24 rows
-- ============================================================

update commission_payout_snapshots
set payout_amount = 0,
    breakdown = breakdown
      || jsonb_build_object('upsell_outlet',
           (breakdown->'upsell_outlet') || jsonb_build_object('commission', 0))
      || jsonb_build_object('components_subtotal', 0)
      || jsonb_build_object('final_payout', 0)
      || jsonb_build_object('revisions',
           coalesce(breakdown->'revisions','[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', 'boonwirat.t@freshket.co',
             'kind', 'void_unconfigured_role',
             'reason', 'role นี้ยังไม่ได้ตั้งกติกาค่าคอมฯ — ยอดเดิมมาจาก default Expansion 0.5% ที่เอาก้อน outlet GMV รวมทั้งบริษัทมาคิดให้ทุกคนเต็มก้อน จึงไม่ถูกต้อง',
             'prev_payout', payout_amount, 'new_payout', 0))),
    updated_at = now(),
    updated_by = 'boonwirat.t@freshket.co'
where period_month = '2026-07'
  and beneficiary_role in ('sales','admin','sales_tl')
  and payout_amount <> 0;




-- ============================================================
-- B3 — ทางเลือก: ลบแถวทิ้งเลย (ใช้แทน B2 ถ้าบุชอยากให้หายไปจากระบบ)
--
-- ⚠ อ่านก่อน: ถ้าลบ ยอดล็อกของ ก.ค. จะเหลือ 20 แถว ไม่ใช่ 44
--    รายงานย้อนหลังจะไม่มีร่องรอยว่าเคยมี 24 แถวนี้อยู่
--    ผมแนะนำ B2 มากกว่า แต่ถ้าจะลบจริง ให้ลบ -- ข้างหน้าออก
-- ============================================================

-- delete from commission_payout_snapshots
-- where period_month = '2026-07'
--   and beneficiary_role in ('sales','admin','sales_tl');




-- ============================================================
-- B4 — ตรวจ (ไม่แก้อะไร)
--
-- ต้องเห็น 3 แถว:
--   ยอดกลุ่มนี้เหลือ      | 0      | ต้องได้ 0
--   จำนวนแถวที่ยังอยู่     | 24     | ต้องได้ 24  (ถ้าใช้ B3 ลบ จะเป็น 0)
--   ยอดรวม ก.ค. ทั้งเดือน | 309197 | = 504,092 + 20,001(ชุด A) − 214,896(ชุด B)
--
-- หมายเหตุ: ชุด A ได้ +20,001 ไม่ใช่ 19,911 ที่เขียนไว้ตอนแรก (ผมบวกเลขผิดเอง)
--   แยกตามตำแหน่ง: KAM +11,948 · TL +7,500 · PM +553 · AD 0  = 20,001
-- ============================================================

select 'ยอดกลุ่มนี้เหลือ' as รายการ,
       coalesce(sum(payout_amount),0) as ค่าที่ได้, 0 as ต้องได้
from commission_payout_snapshots
where period_month='2026-07' and beneficiary_role in ('sales','admin','sales_tl')
union all
select 'จำนวนแถวที่ยังอยู่', count(*), 24
from commission_payout_snapshots
where period_month='2026-07' and beneficiary_role in ('sales','admin','sales_tl')
union all
select 'ยอดรวม ก.ค. ทั้งเดือน',
       (select sum(payout_amount) from commission_payout_snapshots where period_month='2026-07'),
       309197;




-- ============================================================
-- ย้อนกลับเฉพาะชุด B (ปกติไม่ต้องรัน — ใช้ได้เฉพาะถ้าเลือก B2 ไม่ใช่ B3)
-- ============================================================
-- update commission_payout_snapshots s
-- set payout_amount = b.payout_amount, breakdown = b.breakdown,
--     updated_at = b.updated_at, updated_by = b.updated_by
-- from snap_jul_backup b
-- where s.id = b.id and s.beneficiary_role in ('sales','admin','sales_tl');
