# Q3 2026 Quarterly NRR — Test Spec & Product Spec (Merge Gate)

**สร้างเมื่อ:** 2026-07-06
**Branch:** `preview/q3-commission-build`
**อ้างอิงคู่กับ:** `docs/Q3_NRR_COMMISSION_SPEC.md`, `docs/Q3_NRR_COMMISSION_HANDOFF.md` (Session 1-3), `docs/qnrr_master_movement_design_v8.md`
**แทนที่:** `NOT_USE_qnrr_master_movement_test_spec.md` (เดิมสั้นเกินไป ไม่ครอบคลุม commission governance/UX)
**สถานะ:** 🔴 Draft — รอรัน test case จริงตาม checklist นี้ก่อนอนุมัติ merge

> **กฎการอ่านเอกสารนี้:** ห้ามเชื่อว่า checkbox ที่ติ๊กไว้ = ถูกต้องเสมอไป จนกว่าจะมีวันที่+หลักฐาน (commit/screenshot/query result) กำกับ — บทเรียนจาก Session 3 คือ spec doc เขียนว่า "ยืนยันแล้ว" ทั้งที่ 3/4 ค่าใน Supabase เปลี่ยนไปแล้วโดยไม่มีใครมา re-verify

---

## 0. Merge Gate — เงื่อนไขที่ต้องผ่านครบก่อน merge เข้า main

ห้าม merge จนกว่า:
1. ทุก test case ในหมวด 1-7 ด้านล่างมีสถานะ ✅ (หรือ ⚠️ พร้อมเหตุผลรับความเสี่ยงที่ Bucci เซ็นรับทราบ)
2. Open items (M-1, C-3) ถูกบันทึกใน commit/PR description ว่าเป็น known limitation ไม่ใช่ bug ที่ลืมแก้
3. M-3 verify แล้วว่าโค้ดปัจจุบันทำตามมติ (KAM เห็น transfer_out เต็มจำนวน) — ถ้าไม่ตรง ต้องแก้ก่อน merge เพราะกระทบเงินจริง
4. L-4 ทำ decision-as-code แล้ว: เพิ่มคอมเมนต์หัวไฟล์ทั้ง 4 ไฟล์ระบุชัดว่าเป็น reporting variant ที่ยัง maintain อยู่ (ไม่ใช่ dead code) และเพิ่มเข้า test rotation หมวด 1
5. หมวด 8 (full-quarter-close) **ไม่บังคับก่อน merge** เพราะทดสอบไม่ได้จนกว่าจะถึงต้น ส.ค. — ระบุเป็นเงื่อนไข post-merge monitoring แทน

---

## 1. Data Integrity (BigQuery / SQL)

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด | หลักฐาน |
|---|---|---|---|---|
| D1 | Movement classification 11 ประเภทตรง priority order (v8 design) | สุ่ม outlet 20 ร้านต่อ movement type เทียบ manual trace | ✅ (ยืนยัน rep_view) | HANDOFF §7 |
| D2 | `unclassified` ต้อง = 0 แถวเสมอ | `SELECT COUNT(*) WHERE movement_type NOT IN (known list)` = 0 | ⬜ ยังไม่ได้รันตรวจหลัง fix รอบ Session 3 | — |
| D3 | Guard เดือนที่ยังไม่เริ่ม (`v_mX_days > 0`) ครบทุกเดือน ทั้ง rep_view + 4 ไฟล์ reporting | ไม่มี fake churn 100% สำหรับเดือนที่ 0 order | ✅ แก้แล้วทั้ง 5 ไฟล์ | HANDOFF #6 item 6-7 |
| D4 | บั๊ก #6 (LEG A + LEG B, `v_base_str`→`v_m3_str`) แก้ครบทุก occurrence | grep + manual read ทั้ง 5 ไฟล์ ไม่มี `v_base_str` หลงเหลือในบริบทเดือนที่ 3 | ✅ แก้ครบ Session 3 | HANDOFF §6.1, §6.6 |
| D5 | CSV export 29 คอลัมน์ตรง `rep_view` SELECT เป๊ะ (ลำดับ+ชื่อ) | Diff schema กับ parser ใน `02_data_pipeline.js` | ✅ ยืนยันจาก `sense_qnrr_2026q3.csv` จริง 2,916 แถว | HANDOFF §7 |
| D6 | GMV รวมของแต่ละ movement type reconcile กับ ground truth GMV รายเดือน (ล็อคไว้ใน memory) | ผลรวม curr_gmv ทุก movement + ผลรวม No-Owner ต้องเท่า ground truth เดือนนั้น (Jul/Aug/Sep 2026 เมื่อมีข้อมูล) | ⬜ ยังทำไม่ได้ — Jul 2026 ยังไม่จบเดือน (MTD only) | — |
| D7 | 11 ร้าน "Admin Freshket" (฿337,112) ไม่มี KAM/TL owner | ไม่ใช่ bug — เป็น ops task รอ reassign | ⬜ Ops task ค้าง | HANDOFF §6.2-A |
| D8 (ใหม่) | L-4: 4 ไฟล์ reporting variant มีบั๊กเดียวกับ rep_view ไหม (D2-D4 ต้องรันซ้ำกับ 4 ไฟล์นี้ด้วย เพราะตอนนี้เป็น "เก็บไว้ maintain ต่อ" ไม่ใช่ dead code) | รัน D2-D4 กับ `kam/pm/admin/tl_view.sql` ทั้ง 4 | ⬜ ยังไม่เคยรันแยกหลัง fix รอบ Session 3 | ต้องทำก่อน merge (Merge Gate #4) |

---

## 2. Calculation Correctness (Commission Engine)

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| C1 | NRR fixed-base = มิ.ย. คงที่ตลอด Q3 (ก.ค./ส.ค./ก.ย.) ไม่เลื่อนตามเดือน | `_qnrrComputeForCommission()` ใช้ `base_month='2026-06'` ทุกเดือนใน Q3 | ✅ ยืนยันจาก `nrr_policies` config | 
| C2 | Churn/Up/Down split ผ่าน `curr_gmv` check ใน `_effectiveMovement()` | KAM ที่มี outlet `curr_gmv=0` ต้อง reclassify เป็น `core_nrr_churn` ไม่ค้างเป็น `core_nrr` เฉยๆ | ✅ แก้แล้ว บั๊ก #8 |
| C3 | Normalize `÷days_in_period×30` ก่อนเทียบทุกครั้ง ไม่เอา raw บาทลบกันข้ามเดือน day-count ต่างกัน | สุ่มเช็ค 5 เดือนที่ day count ต่าง (28/30/31) | ⬜ ยังไม่ได้สุ่มตรวจเฉพาะจุดนี้ |
| C4 | Handover/new_sales ยังเป็น MoM 100% ไม่ถูกแตะโดย quarterly mode | `_commComputeHandoverRetention()` ไม่อ่าน `nrr_policies.commission_mode` เลย | ⬜ ต้อง code-read ยืนยัน ไม่ใช่แค่เชื่อ spec doc (บทเรียน §6.4) |
| C5 | Expansion rate ใช้ค่า **live จาก Supabase** ไม่ hardcode/ไม่อ้างจาก spec doc ที่เคยผิด | Query `target_settings.upsell_outlet_params.rate` สดแล้วเทียบกับที่โค้ดใช้จริง | ✅ **Live value ยืนยันแล้ว = 0.005** (Bucci query 2026-07-06) — default fallback แก้จาก 0.015→0.005 แล้ว, deploy v835 |
| C6 | Upsell P1/P3 rate/threshold/min GMV ใช้ค่า live Supabase | เช่นเดียวกับ C5 — `p1_rate`/`p3_rate` จริง = 0.01 ไม่ใช่ 0.03 ตาม spec doc | ✅ **Live value ยืนยันแล้ว = 0.01/0.01/8000** — default fallback แก้ครบ (p1_rate, p3_rate, p3_min_incremental), deploy v835 |
| C7 | P3 min incremental = 8000 ตรงทั้ง Cockpit และ SQL | `q3c_upsell_team_summary_v4.sql` hardcode 8000 ตรงแล้ว | ✅ แก้แล้ว Session 3 item #3 |
| C8 | GMV Gate cap tier ใช้ค่า live (`cap_1` จริง = 0.3 ไม่ใช่ 0.70 ตาม spec doc) | Query `target_settings.gmv_gate_params` สดเทียบกับโค้ด | ✅ **Live value ยืนยันแล้ว = threshold 98/95, cap 0.3/0** — default fallback แก้ครบ 4 ค่า, deploy v835 |
| C9 | TL Upsell Multiplier tier boundary (B8, ค้างจาก HANDOFF §7) | ทดสอบค่า % upsell ที่ tier boundary พอดี (2%, 3%, 4%, 5%) ไม่ปัดผิด tier | ⬜ ยังไม่ได้ตรวจ |
| C10 | Rounding (B9, ค้างจาก HANDOFF §7) | `ROUND(subtotal × gate.cap_multiplier)` ปัดถูกทิศทาง ไม่มี off-by-1-satang | ⬜ ยังไม่ได้ตรวจ |

**หมายเหตุสำคัญ C5/C6/C8 (อัปเดต 2026-07-06):** แก้แล้วที่ต้นตอ ไม่ใช่แค่ default — พบว่า `loadTargets()` มี fail-silent bug คู่ขนาน: ถ้า query `target_settings` พัง ระบบตั้ง `_tgtLoaded=true` แบบไม่มีเงื่อนไข และ**cache สถานะที่พังนั้นไว้ใช้ต่อ**จนกว่า TTL หมดอายุ (รวมถึง persist ลง localStorage ข้าม session ด้วย) แก้ทั้ง 3 ชั้นพร้อมกันใน commit เดียว (v835): (1) default fallback ตรงกับ Supabase ปัจจุบันแล้ว (2) เพิ่ม `window._tgtSettingsLoadFailed` + `console.error` ให้เห็นชัดตอนโหลดพัง (3) ไม่ cache/persist state ที่โหลดพัง — **ยังไม่เคย verify ผ่าน browser จริงหลัง deploy** ต้องทดสอบตามกฎ "ทดสอบ commission UI ทุก tab หลัง deploy ก่อนไปต่อ"

---

## 3. Commission Governance

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| G1 | Lock-guard ป้องกันเขียนทับ snapshot ที่ lock แล้ว | กด Compute/Lock ซ้ำบน row ที่ lock แล้ว ต้องมี `confirm()` เตือนก่อนเขียนทับ + audit trail ใน breakdown jsonb | ⬜ โค้ดพร้อมแล้ว (Session 3 fix #1) แต่ **ยังไม่เคยกดทดสอบจริงในแอป** |
| G2 | Audit trail default ถูกต้อง (`p1_min_gmv` = 5000 ไม่ใช่ 2500) | ตรวจ jsonb breakdown ของ payout ที่เพิ่งคำนวณ | ✅ แก้แล้ว Session 3 item #8 |
| G3 | Config drift BigQuery ↔ Supabase — ไม่มี auto-sync (structural risk) | มี checklist/reminder ให้ manual sync ทุกครั้งที่แก้ business rule constant | ⬜ ยังไม่มี process ป้องกัน แนะนำเพิ่ม script ตรวจ drift อัตโนมัติ (ดู §9 Recommendation) |
| G4 | Retroactive lock ข้ามไตรมาสจริง | ทดสอบ lock เดือน มิ.ย. (Q2, monthly mode) หลังเข้า Q3 (quarterly mode) แล้ว ไม่กระทบกัน | ⬜ ยังไม่ได้ทดสอบ (อยู่ในรายการ F ของ HANDOFF §7) |
| G5 (ใหม่ จาก M-3) | Same-squad transfer — KAM เห็น `transfer_out` เต็มจำนวน (ไม่ neutralize ที่ KAM scope) | Code-read `_commBuildKamPayout` / SQL ว่าปัจจุบันไม่มี neutralization logic ที่ KAM scope จริง ถ้ามีอยู่ต้องเอาออก | ⬜ **ต้อง verify ก่อน merge — มติแล้วว่าต้องเห็นเต็มจำนวน แต่ยังไม่ยืนยันว่าโค้ดปัจจุบันทำแบบนี้อยู่** |
| G6 (ใหม่) | Fail-loud บน target_settings load failure | จำลอง network fail (DevTools throttle→offline ตอนโหลด) แล้วเช็คว่า `window._tgtSettingsLoadFailed===true`, มี `console.error` สีแดงใน console, และไม่มี state ที่พังถูก cache ต่อ (โหลดใหม่ครั้งถัดไปต้อง retry ไม่ใช่ใช้ค่าที่พังซ้ำ) | ⬜ Code พร้อมแล้ว (deploy v835) ยังไม่เคย verify จริงในเบราว์เซอร์ |

---

## 4. UX/UI

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| U1 | Commission card ไม่โชว์ ฿0 ผิดระหว่างรอ `bulkQnrrData` โหลด | เปิดพอร์ต KAM ที่มี background prefetch delay ~2s ต้องเห็น shimmer ไม่ใช่ ฿0 | ⬜ แก้โค้ดแล้ว (Session 3 fix #2) **ยังไม่เคย verify ผลจริงหลัง deploy** |
| U2 | Re-render trigger ทำงานตอน QNRR โหลดเสร็จ (ไม่ค้าง ฿0) + timeout 15s | รอ 15s โดยไม่มี data ต้องมี fallback state ที่สื่อสารชัดว่าโหลดไม่สำเร็จ ไม่ใช่ค้างเงียบ | ⬜ ยังไม่ verify |
| U3 | Base month label ดึงจาก `QNRR_CFG.months_th` แบบไดนามิก ไม่ hardcode | สลับดู 3 เดือนใน Q3 (ก.ค./ส.ค./ก.ย.) label ต้องเปลี่ยนถูกทุกจุดที่โชว์ "เดือนฐาน" | ✅ แก้แล้ว Session 3 item ในบั๊ก #8 (HANDOFF) |
| U4 | MTD badge แสดงเมื่อเดือนยังไม่จบ | เปิดดูเดือนก.ค. (MTD) ต้องเห็น badge บอกชัดว่าเป็นข้อมูลบางส่วน ไม่ใช่ตัวเลขเดือนเต็ม | ⬜ ค้างใน D3-D6 ของ HANDOFF §7 |
| U5 | Commission Cockpit พิมพ์ % ได้ปกติ (บั๊ก #10 เดิม) | พิมพ์ค่า % ในทุกช่อง config ไม่มีการหายเอง | ⬜ HANDOFF ระบุว่า "หายเองไม่ทราบสาเหตุ ไม่ใช่ code bug" — ต้อง reproduce อีกรอบเพื่อยืนยันว่าไม่เกิดซ้ำ |
| U6 (ใหม่) | M-1/C-3 open items ต้องมี label หรือ tooltip แจ้งผู้ใช้ (ถ้าเป็นไปได้) ว่ามี known limitation | ไม่บังคับก่อน merge แต่แนะนำถ้าเวลาเอื้อ | ⬜ Nice-to-have |

---

## 5. Cross-Role Consistency

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| X1 | KAM self-view = TL view = Admin view สำหรับ outlet/scope เดียวกัน | เปิด 3 role ดู KAM คนเดียวกัน ตัวเลข NRR/Upsell ต้องตรงกัน | 🔴 **รู้อยู่แล้วว่าไม่ตรง (C-3)** — วันนี้บังเอิญตรงเพราะ threshold เท่ากันชั่วคราว ไม่ใช่ fix ถาวร |
| X2 | TL role ผ่าน browser test จริง | NRR 109%, compute สำเร็จไม่ error | ✅ ยืนยันแล้ว Session 3 |
| X3 | VP vs Portfolio expected differences ยังถูกต้องตาม design v8 สำหรับ Q3 (C7/C8 differences) | ตรวจว่า difference ยังอยู่ในช่วงที่ design v8 คาดไว้ (2-4M ต่อเดือนสำหรับ base_gmv, 0.4-0.6M สำหรับ curr_gmv) | ⬜ v8 verify ไว้กับข้อมูล Q2 เท่านั้น ยังไม่ verify กับ Q3 |

---

## 6. Display Correctness

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| P1 | Summary card ตรงกับ detail sheet เสมอ | บั๊กเดิม: การ์ดโชว์ ฿85 แต่ detail โชว์ ฿10,085 — ต้อง verify ไม่เกิดซ้ำหลัง fix U1/U2 | ⬜ รอ verify คู่กับ U1 |
| P2 | Churn % แบบนับหัวร้าน vs ถ่วง GMV ต้องแสดงคู่กันหรือมี label ชัดเจน | กรณี `anusorn.k`: นับหัว 57.9% แต่ถ่วง GMV จริง 14.2% — ต้องไม่ทำให้ผู้ใช้เข้าใจผิดว่า churn รุนแรง | ⬜ ยังไม่ตัดสินใจว่าจะใส่ warning label (HANDOFF §6.2-B) — **แนะนำเป็นเรื่องที่ 5 ที่ควรถาม Bucci เพิ่ม** |

---

## 7. Regression (ของเดิมต้องไม่พัง)

| # | Test case | เกณฑ์ผ่าน | สถานะล่าสุด |
|---|---|---|---|
| R1 | MoM engine (`_tgtComputeKamNRR`) เดือนนอก quarterly mode (เช่น มิ.ย.) ทำงานปกติ 100% | เปิดดูเดือน มิ.ย. ต้องได้ผลเหมือนก่อนมี quarterly layer | ⬜ ยังไม่ได้ regression test เทียบ before/after |
| R2 | B3: Handover MoM regression | Handover ยังคำนวณถูกหลังเพิ่ม quarterly layer | ⬜ ค้างจาก HANDOFF §7 |
| R3 | D3-D6: Admin/Rep/TL เห็นตรงกันทุก tab, Preview&Lock เต็ม flow, พิมพ์ % ซ้ำ | ทดสอบ full flow end-to-end | ⬜ ค้างจาก HANDOFF §7 |

---

## 8. Full-Quarter-Close (Post-merge monitoring, ไม่บังคับก่อน merge)

| # | Test case | เมื่อไหร่ทำได้ |
|---|---|---|
| F1 | Auto-compute-at-month-start ทำงานถูกตอนเข้าเดือนใหม่ในไตรมาส | ต้นเดือน ส.ค. |
| F2 | เดือนปิดสมบูรณ์ครั้งแรกในโหมด quarterly (ก.ค. ปิดเดือน) | ต้นเดือน ส.ค. |
| F3 | Retroactive lock ข้ามไตรมาสจริง (ไม่ใช่จำลอง) | เมื่อมีเหตุต้อง lock ย้อนหลังจริง |

---

## 9. Open Items ที่บันทึกไว้ตามมติ Bucci (2026-07-06)

| # | เรื่อง | มติ | Action |
|---|---|---|---|
| M-1 | ELSE fallback ไม่ตรงกัน (`rep_view`='transfer_in' vs อีก 4 ไฟล์='unclassified') | **Open item — ไม่แก้ตอนนี้** | บันทึกใน PR description ว่าเป็น known inconsistency ที่ตั้งใจไม่แตะ ไม่ใช่ลืมแก้ |
| C-3 | Fast/slow path (TL/Admin เห็น P1/P3 ต่างจาก KAM เจ้าของพอร์ต) | **แก้ไขมติ 2026-07-06: ยอมรับ design ปัจจุบัน ไม่ต้องทำ architecture fix** — (1) ฝั่ง team/TL (fast path, SQL) hardcode เฉพาะ `v_p3_min_incremental` ได้ ต้อง manual sync กับ Cockpit ทุกครั้งก่อนรัน (มี comment เตือนในโค้ดอยู่แล้ว) (2) ฝั่ง rep/KAM เจ้าของพอร์ต (slow path, `_commComputeUpsellSku`) **ต้อง proper ดึงจาก Cockpit config เสมอ — verify แล้ว 2026-07-06 ว่าโค้ดปัจจุบันเรียก `_commGetConfig()` ทุกค่า (p1_rate/p3_rate/p3_threshold_pct/p3_min_incremental/p1_min_gmv) อ่านจาก `_tgtSettings` (Supabase live) จริง ไม่ hardcode** | ✅ **ปิดเป็น resolved-by-design** — ไม่ต้องแก้โค้ดเพิ่ม เหลือแค่ต้องมั่นใจว่า `_tgtSettings` โหลดสำเร็จจริงตอน runtime (ดู C5/C6/C8 — ถ้าโหลด config ล้มเหลว จะ fallback ไปใช้ default ที่ผิดจากของจริง เหมือนที่ spec doc เคยเข้าใจผิด) |
| M-3 | Same-squad transfer neutralization | **ตัดสินใจแล้ว: KAM เห็น transfer_out เต็มจำนวน** | ต้อง verify โค้ดจริง (test case G5) ก่อน merge — ถ้าโค้ดปัจจุบันไม่ตรงมติ ต้องแก้ |
| L-4 | ชะตากรรม 4 ไฟล์ SQL ไม่ได้ใช้งาน | **ตัดสินใจแล้ว: เก็บไว้เป็น reporting variant** | เพิ่มเข้า test rotation หมวด 1 (D8) ทุกรอบที่แก้ rep_view ต่อจากนี้ + คอมเมนต์หัวไฟล์ระบุสถานะให้ชัด |

### ยังไม่ได้ถาม (แนะนำคุยต่อ)
- **P2 churn label:** ควรใส่ warning เตือนไหมเมื่อ churn แบบนับหัวกับถ่วง GMV ต่างกันมาก (เช่น >2 เท่า)
- **B7 (11 ร้าน Admin Freshket):** ต้องการให้ผมช่วย query หา owner ที่เหมาะสมจาก order history ก่อนส่งให้ ops ตัดสินใจไหม หรือปล่อยเป็น ops task ล้วนๆ

---

## 10. Recommendation — ป้องกันปัญหา "spec doc ไม่ตรงของจริง" ไม่ให้เกิดซ้ำ

จาก §6.4 ของ HANDOFF ที่พบว่า spec doc ผิด 3/4 ค่าเพราะไม่ได้ query สดตอนเขียน แนะนำเพิ่ม:
- Script เล็กๆ ที่ query `target_settings` ทุกตัวที่ใช้ในเอกสารนี้ (C5, C6, C8) แล้ว diff กับค่าที่ hardcode ไว้ในโค้ด — รันก่อน merge ทุกครั้งที่แตะ commission logic
- เขียนวันที่ query ล่าสุดกำกับทุกครั้งที่อ้างค่า config ใน doc ไหนก็ตาม (ไม่ใช่แค่เขียนว่า "ยืนยันแล้ว" เฉยๆ)

---

## 11. Completion Roadmap — ลำดับงานเพื่อปิดจบและ merge (วางแผน 2026-07-06)

เรียงตามความเสี่ยงเงินจริง ไม่ใช่ตามความง่าย — ทำ Phase ที่กระทบเงินสุดก่อนเสมอ

### Phase 1 — 🔴 ความเสี่ยงเงินสูงสุด: verify C5/C6/C8 (ยังไม่เริ่ม เพราะไม่มี Supabase access ในเครื่องมือปัจจุบัน — ดู blocker ท้ายตาราง)
| Step | รายละเอียด |
|---|---|
| 1.1 | Query `target_settings` สดสำหรับ `upsell_outlet_params`, `upsell_sku_params`, `gmv_gate_params` |
| 1.2 | Trace โค้ดจุดที่โหลด `_tgtSettings` (บรรทัด ~812 `07a_commission_engine.js`) ว่ารันก่อน `_commGetConfig()` ถูกเรียกใช้จริงเสมอ ไม่มี race condition |
| 1.3 | เปิด browser จริง console.log `_tgtSettings` ตอน KAM/TL login แล้วเทียบกับค่าจาก 1.1 เป๊ะๆ |
| 1.4 | ถ้าไม่ตรง → หา root cause (โหลดไม่ทัน/parse ผิด/key ผิด) แล้วแก้ |

**Blocker:** เครื่องมือตอนนี้ต่อ Supabase (`menslbnyyvpxiyvjywcm.supabase.co`) ไม่ได้โดยตรง (ไม่อยู่ใน allowed network domains และไม่มี Supabase connector โหลดในเซสชันนี้) — ต้องเลือกทางใดทางหนึ่ง: (ก) Bucci รัน query แล้ววาง output ให้ หรือ (ข) ให้ผมใช้ claude-in-chrome เปิด Supabase dashboard ที่ Bucci login ไว้แล้วรัน SELECT ให้ (read-only)

### Phase 2 — G5: verify/fix M-3 (KAM เห็น transfer_out เต็มจำนวน)
Code-read `_commBuildKamPayout` + SQL base_portfolio/base_staff_owner logic (v8 design) หาว่ามี neutralization logic ที่ KAM scope หลงเหลืออยู่ไหม ถ้ามีต้องเอาออก

### Phase 3 — D8: regression 4 ไฟล์ reporting variant (L-4)
รัน D2 (unclassified=0), D3 (guard เดือน), D4 (LEG A+B fix) ซ้ำกับ `kam/pm/admin/tl_view.sql` ทั้ง 4 ไฟล์ + เพิ่ม comment หัวไฟล์ระบุสถานะ "maintained reporting variant"

### Phase 4 — Deploy + browser-verify 10 จุดที่แก้ใน Session 3 (ยังไม่เคย verify จริง)
G1 (lock-guard), U1/U2 (loading shimmer + re-render + timeout), P1 (summary/detail consistency ฿85 vs ฿10,085 case)

### Phase 5 — ที่เหลือที่ยังไม่ตรวจ
C3 (normalize ÷days×30), C4 (handover MoM isolation), C9 (TL multiplier boundary), C10 (rounding), R1-R3 (regression), U4 (MTD badge), U5 (% input reproduce)

### Phase 6 — Non-blocking แต่ต้องตัดสินใจ/ดำเนินการคู่ขนาน
M-1 (คงเป็น open item, บันทึกใน PR), P2 churn label (รอถาม Bucci), D7/B7 11 ร้าน Admin Freshket (ops task)

### Phase 7 — Merge Gate final check
รัน checklist §0 ครบ → Bucci sign-off → merge `preview/q3-commission-build` → `main`

### Phase 8 — Post-merge monitoring (ทำไม่ได้ก่อนต้น ส.ค.)
F1-F3 (full quarter close), G3 recommendation (config-drift check script)


