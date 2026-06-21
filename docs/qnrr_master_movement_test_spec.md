# QNRR Master Movement Test Spec — DEPRECATED

**วันที่:** 2026-06-21
**สถานะ:** Deprecated — logic ใน test spec นี้ไม่ตรงกับ ground truth

ให้ใช้ `docs/qnrr_master_movement_design_v3.md` แทน

ข้อที่ไม่ถูกต้องใน spec เก่านี้:
- base_gmv filter commercial_owner ผิด
- handover fallback default ผิด
- expansion GMV=0 flip เป็น transfer_in ผิด
- label re-classify ระหว่างเดือน ผิด
- comeback check pre-Mar KAM คนนี้ ผิด (master level ไม่สน)

Reconcile ground truth ที่ถูกต้องอยู่ใน design spec ข้อ Check 1–6
