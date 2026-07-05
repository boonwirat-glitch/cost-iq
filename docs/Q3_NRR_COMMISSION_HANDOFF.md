# Q3 2026 Quarterly Commission — HANDOFF

**อัปเดตล่าสุด:** 2026-07-05 (Session 3 — test spec, hardcode audit, live data + browser testing, 10 fixes pushed)
**Branch:** `preview/q3-commission-build`
**Snapshot กันไว้ก่อนแก้:** `snapshot/pre-threshold-fix-20260705-1410`
**สถานะ:** 🔴 **ยังไม่พร้อม merge** — เจอบั๊กจริงเพิ่มอีกหลายตัวจาก Session 2 (บางตัวกระทบเงินจริง) แก้ไปแล้ว 10 จุด ยังเหลือ 4 จุดที่ต้องตัดสินใจ/ทดสอบเพิ่มก่อน

> อ่านคู่กับ `docs/Q3_NRR_COMMISSION_SPEC.md` — **แต่ Session 3 พบว่า spec doc เองมีค่าที่ผิด** (ดู section 6.4) อย่าเชื่อค่าตัวเลขใน spec 100% จนกว่าจะ verify กับ Supabase จริงอีกที
> Session 1-2 สรุปอยู่ section 1-2 ด้านล่าง (ประวัติเดิม ไม่แก้ไข)

---

## 1. Session 1 (2026-07-04) — สรุปย่อ

ทำ static code work ทั้งหมดก่อนมีการทดสอบจริงครั้งแรก: reconcile main→preview, SQL auto-derive, CSV parser เขียนใหม่ (29 คอลัมน์), แก้ 18 จุด quarterly-awareness, retroactive lock, **เจอ+แก้ syntax error จริงตัวแรกที่ `07b_commission_cockpit.js`** (missing `}).join('')}`), ทำ Node.js integration test (core QNRR + full E2E `_commBuildKamPayout` chain) — ผ่านหมด 100% แต่ **เป็นการรันจำลอง ไม่ใช่เบราว์เซอร์จริง**

---

## 2. Session 2 (2026-07-05) — รอบทดสอบจริงกับ BigQuery + เบราว์เซอร์จริง

นี่คือรอบที่ **เจอบั๊กเยอะที่สุด** เพราะเป็นครั้งแรกที่รันกับข้อมูลจริงและเปิดแอปจริงดู — ยืนยันชัดว่า static analysis + unit test อย่างเดียวไม่พอ ต้องรันจริงถึงจะเจอ

### บั๊กที่เจอและแก้ (เรียงตามลำดับที่เจอ)

| # | บั๊ก | ต้นตอ | ผลกระทบ |
|---|---|---|---|
| 1 | SQL syntax error `Expected SELECT but got INTERVAL` | เศษโค้ดเก่าหลงเหลือจากตอน auto-derive params CTE (ลบไม่หมด) | SQL รันไม่ได้เลยทั้ง 5 ไฟล์ |
| 2 | `curr_days=31` สำหรับเดือนที่ยังไม่จบ (ควรเป็น MTD) | ออกแบบ auto-derive สมมติว่ารันตอน**ปลายไตรมาส**เท่านั้น แต่จริงรันตอน**ต้นไตรมาส** | GMV normalize ผิด (หารด้วยวันเต็มเดือนทั้งที่มีข้อมูลแค่ไม่กี่วัน) |
| 3 | เม.ย./พ.ค. หลุดเข้ามาใน output | CTE ย่อยมี literal `'2026-03/04/05'` หลงเหลือ | ข้อมูลผิดไตรมาสทั้งชุด |
| 4 | Browser/GitHub cache confusion | ผู้ใช้ copy SQL จากแท็บเก่าที่เปิดค้าง | เสียเวลาสืบเป็นบั๊กใหม่ทั้งที่จริงๆ แก้แล้ว |
| 5 | `INTERVAL 1 MONTH - 1 DAY` — invalid BigQuery syntax | เขียนลบ interval 2 หน่วยในตัวเดียว | SQL รันไม่ได้อีกรอบ |
| 6 | 🔴 `jun_classified` mislabel เป็น `v_base_str` (มิ.ย.) ทั้งที่ข้อมูลจริงมาจาก `sep_own`/`sep_gmv` (ก.ย.) | ตอนแปลง Q2→Q3 label ผิดตัวแปร | กิจกรรมจริงของ ก.ย.ถูกฝังอยู่ใต้ label "มิ.ย." |
| 7 | Churn ปลอม 100% สำหรับเดือนที่ยังไม่เริ่ม | "silent outlets" fallback ไม่มี guard กันเดือนที่ยังไม่เริ่ม | Churn ปลอมทั้งที่ "0 สาขา" |
| 8 | Label "cohort มี.ค." hardcode ค้างจาก Q2 | ไม่ได้ดึงจาก `QNRR_CFG.months_th` แบบไดนามิก | UI โชว์เดือนผิด |
| 9 | ลืม rebuild `index.html` หลังแก้ JS source | แก้แค่ src ไม่ได้รัน build | แอป deploy จริงยังเป็นโค้ดเก่า |
| 10 | Commission Cockpit "พิมพ์ % ไม่ได้" | หายเองไม่ทราบสาเหตุ | ไม่ใช่ code bug |

---

## 3. ไฟล์ที่แก้เพิ่มใน Session 2

| ไฟล์ | จุดที่แก้ |
|---|---|
| `sql/q3_2026_movement_rep_view.sql` | บั๊ก #1,2,3,5,6,7 |
| `sql/q3_2026_movement_{kam,pm,admin,tl}_view.sql` | บั๊ก #1,2,3,5 (บั๊ก #6 **ยังไม่เช็ค** ตอนนั้น — Session 3 เจอว่ามีจริง ดู section 6) |
| `src/07c_qnrr_view.js` | บั๊ก #8 |
| `index.html` | rebuild หลังบั๊ก #9 |

---

## 4. เดิมเคยเป็น "Merge Readiness Session 2" — ดูฉบับล่าสุดที่ section 7 แทน

(เก็บไว้เป็นประวัติ — คำแนะนำ "อย่าเพิ่ง merge" ของ Session 2 ยังใช้ได้ ตอนนี้แก้ไปแล้วบางส่วน ดูสถานะจริงที่ section 7)

---

## 5. กับดักที่ต้องระวังเพิ่ม (จาก Session 1-2)

- **grep หา literal string ไม่พอ** — บั๊ก #6 เป็นตัวแปรผิดตัว ต้องอ่าน**ความหมาย**ของแต่ละ CTE เทียบกับ data source จริง
- **อย่าเชื่อว่า static SQL "ดูสมเหตุสมผล" = ทำงานถูก** — ต้องรันจริงกับ BigQuery เท่านั้นถึงจะเจอ syntax error
- **ทุกครั้งที่แก้ `src/*.js` ต้อง rebuild+push `index.html` ในขั้นตอนเดียวกันเสมอ**
- **Design gap ≠ bug เสมอไป** — ต้องคิดเผื่อ edge case "เดือนที่ยังไม่เกิดขึ้นจริง" เสมอเวลาออกแบบ fallback logic

---

## 6. Session 3 (2026-07-05, ต่อจาก Session 2 วันเดียวกัน) — Test spec + hardcode audit + live data + browser + fix รอบใหญ่

เป้าหมาย session นี้: สร้าง test spec ให้ครบก่อนตัดสินใจ merge ตามที่ Session 2 แนะนำไว้ แล้วไล่ตรวจจริงทีละจุด **ไม่เชื่อ Session 1-2 ทั้งหมดจนกว่าจะ verify ด้วยโค้ด/ข้อมูล/เบราว์เซอร์จริงเอง**

### 6.1 พบว่า Session 2 ทิ้งช่องโหว่ไว้จริง — บั๊ก #6 มีคู่ขนานจริงในไฟล์ที่ไม่ได้ใช้งาน

ยืนยันด้วยโค้ดจริงว่า `q3_2026_movement_{kam,pm,admin,tl}_view.sql` ทั้ง 4 ไฟล์มีบั๊กเดียวกับ #6 จริง (CTE `sep_rows` LEG A ใช้ `v_base_str` แทน `v_m3_str`) — **และมีอีกจุดที่ซ่อนลึกกว่านั้นคือ LEG B ของ `sep_rows` ก็เป็นบั๊กเดียวกันด้วย ไม่ได้แก้ตอน pass แรก** (แก้ครบทั้ง LEG A+B ในรอบนี้แล้ว — ดู section 6.6)

### 6.2 พบบั๊กใหม่จากการวิเคราะห์ไฟล์ CSV จริง (`sense_qnrr_2026q3.csv`, `sense_upsell_team.csv`)

| # | บั๊ก | หลักฐาน | สถานะ |
|---|---|---|---|
| A | 11 ร้าน "Admin Freshket" มองไม่เห็นทั้ง KAM และ TL scope | `latest_kam_email`/`latest_tl_email` เป็น NULL ทั้งคู่ ฿337,112 base GMV ไม่มีใครรับผิดชอบ | ⬜ Ops task รอ Bucci reassign |
| B | Churn แบบนับหัวร้าน (ไม่ถ่วง GMV) เข้าใจผิดง่ายมากช่วงต้นเดือน | KAM `anusorn.k`: churn นับหัว 57.9% แต่ถ่วง GMV จริงแค่ 14.2% | ⬜ ต้องตัดสินใจว่าจะใส่ label เตือนใน UI ไหม |
| C | P3 min incremental hardcode 5000 ใน SQL ทั้งที่ Cockpit ตั้งไว้ 8000 | `q3c_upsell_team_summary_v4.sql` อ่าน Supabase ไม่ได้ (คนละระบบกับ BigQuery) | ✅ **แก้แล้ว** |

### 6.3 พบว่า TL/Admin กับ KAM เจ้าของพอร์ตเห็นตัวเลข P1/P3 คนละตัวกัน (fast/slow path)

ไล่โค้ดจนสุดสาย: `_fetchUpsellBundle(currentUser.email)` โหลดไฟล์ per-KAM ละเอียดเฉพาะของคนที่ login เท่านั้น ส่วน TL/Admin (ไม่มีไฟล์ของตัวเอง) จะตกไปใช้ `sense_upsell_team.csv` (fast path) เสมอ — ยืนยันว่าเคยเป็นบั๊กมาก่อนแล้ว 2 รอบ (`v232-fix`, `v829-fix` comment ในโค้ด) เป็น pattern ที่เกิดซ้ำ ยังไม่ได้แก้ทางสถาปัตยกรรม แค่ทำให้ตัวเลขตรงกันชั่วคราว (item C ด้านบน)

### 6.4 🔴 สำคัญมาก — Spec doc เองมีค่าผิด ไม่ใช่แค่โค้ด

Query Supabase `target_settings` จริงเทียบกับที่ `Q3_NRR_COMMISSION_SPEC.md` อ้างว่า "ยืนยันแล้ว":

| Parameter | Spec doc อ้าง | ค่าจริงใน Supabase | |
|---|---|---|---|
| `gmv_gate.cap_1` | 0.70 | **0.3** | ❌ |
| `upsell_outlet.rate` | 0.015 | **0.005** | ❌ |
| `upsell_sku.p1_rate` / `p3_rate` | 0.03 / 0.03 | **0.01 / 0.01** | ❌ |
| `upsell_sku.p3_min_incremental` | 8000 | 8000 | ✅ |

Rate พวกนี้ถูกเปลี่ยนใน Supabase เมื่อ 2026-06-11 (ลดลงราว 1/3 ทุกตัว) แต่ spec doc เขียนวันที่ 2026-07-04 ยังอ้างค่าเก่า — **แปลว่า spec ไม่ได้ query สดตอนเขียน หรือ query แล้วพลาด บทเรียน: ห้ามเชื่อตัวเลขใน doc โดยไม่ query DB จริงอีกที**

### 6.5 พบบั๊กสดจาก browser จริง — การ์ดสรุปโชว์เลขผิดค้าง

KAM `anusorn.k` เปิดพอร์ตตัวเอง การ์ดสรุปโชว์ "฿85" (NRR ฿0 · Uplift ฿85) แต่กดเข้า detail sheet โชว์ "฿10,085" (NRR ฿10,000 ถูกต้อง) — root cause: `_qnrrComputeForCommission()` return `null` ระหว่างรอ `bulkQnrrData` โหลด (มี background prefetch ดีเลย์ ~2 วิ) → tier lookup ไม่ match null → default เป็น ฿0 แบบมั่นใจ แทนที่จะโชว่ loading — ไม่มี trigger ให้ re-render ตอนข้อมูลมาถึงด้วย **✅ แก้แล้ว** (ดู section 6.6)

### 6.6 สิ่งที่แก้ไปแล้วใน Session 3 (10 จุด, push ครบ + rebuild index.html 2 รอบ)

| # | บั๊ก | ไฟล์ | Commit message |
|---|---|---|---|
| 1 | Lock/Compute ทับ snapshot ที่ lock แล้วไม่มี guard | `src/07a_commission_engine.js` | เพิ่ม `confirm()` ก่อนเขียนทับ locked row + audit trail ใน breakdown jsonb |
| 2 | การ์ดสรุปโชว์ ฿0 ผิดระหว่าง QNRR ยังโหลดไม่เสร็จ | `src/07a_commission_engine.js`, `src/02_data_pipeline.js` | เพิ่ม loading-state guard (มี shimmer) + re-render trigger ตอน QNRR โหลดเสร็จ + timeout 15s กันค้างตลอดไป |
| 3 | P3 min incremental hardcode 5000 (ควร 8000) | `sql/q3c_upsell_team_summary_v4.sql` | เปลี่ยนเป็น `DECLARE v_p3_min_incremental FLOAT64 DEFAULT 8000` พร้อม comment เตือนเช็ค Cockpit ก่อนรัน |
| 4 | บั๊ก #6 คู่ขนาน LEG A (v_base_str→v_m3_str) | `kam/pm/admin/tl_view.sql` ×4 | fix ตรงจุด sep_rows LEG A |
| 5 | บั๊ก #6 คู่ขนาน **LEG B** (จุดที่หลุดจาก pass แรก) | `kam/pm/admin/tl_view.sql` ×4 | fix จุด sep_rows LEG B (v_base_str→v_m3_str) |
| 6 | Guard เดือน 1 ขาดใน `rep_view.sql` | `rep_view.sql` | เพิ่ม `AND v_m1_days > 0` ให้ครบเหมือนเดือน 2,3 |
| 7 | Guard ขาดทั้ง 3 เดือนใน 4 ไฟล์ไม่ใช้งาน | `kam/pm/admin/tl_view.sql` ×4 | เพิ่ม guard ให้ครบ 3 เดือน (คนละ pattern ต่อไฟล์ — kam/tl ใช้ `NOT EXISTS`, pm/admin ใช้ `IS NULL`) |
| 8 | Audit trail default ผิด (2500 ควร 5000) | `src/07a_commission_engine.js` | แก้ `_commGetConfig('upsell_sku','p1_min_gmv',2500)` → `5000` |
| 9 | Comment หัวไฟล์ยังเขียน "Q2 2026" | `rep_view.sql` | แก้เป็น "Q3 2026" (cosmetic เท่านั้น ไม่กระทบผลลัพธ์) |
| 10 | `QNRR_CFG` ประกาศซ้ำ 2 รอบในไฟล์เดียวกัน | `src/07c_qnrr_view.js` | ลบตัวซ้ำออก เหลือแค่จุดเดียวที่หัวไฟล์ |

`index.html` rebuild 2 รอบ (v833, v834) + `sw.js` bump ตามครบทุกครั้ง

### 6.7 พบแล้วแต่ **ยังไม่แก้** — ต้องคุย/ตัดสินใจก่อน

| # | เรื่อง | ทำไมค้าง |
|---|---|---|
| M-1 | ELSE fallback ไม่ตรงกัน (`rep_view.sql`='transfer_in' vs อีก 4 ไฟล์='unclassified') | เช็คแล้วพบว่า JS มีลิสต์ `MOVEMENTS` ตายตัวที่ใช้คำนวณ Total GMV — ถ้าเปลี่ยน SQL เป็น 'unclassified' โดยไม่แก้ JS ด้วย ร้านกลุ่มนี้จะ**หายจาก Total GMV เงียบๆ** ต้องแก้ทั้ง SQL+JS พร้อมกัน ไม่ใช่บรรทัดเดียวจบ |
| C-3 | Fast/slow path (TL/Admin เห็นเลขคนละตัวกับ KAม เอง) | วันนี้แค่ตัวเลขบังเอิญตรงกันเพราะ threshold ทั้งคู่=8000 พอดี ยังไม่ได้แก้สถาปัตยกรรมจริง ต้องเลือกทาง (ให้ TL/Admin โหลด bundle ละเอียดของทุกคนแทน / ทำให้ SQL อ่าน Supabase ได้จริง) |
| M-3 | Same-squad transfer neutralization ทำแค่ TL scope ไม่ทำ KAM scope | เป็นคำถามเชิงธุรกิจว่าตั้งใจให้ KAM เห็น transfer_out เต็มจำนวนตอนโดนย้าย outlet ในทีมเดียวกันหรือไม่ |
| L-4 | ชะตากรรม 4 ไฟล์ SQL ไม่ได้ใช้งาน (kam/pm/admin/tl_view.sql) | มีบั๊กจริงซ้อนอยู่ (แก้ไปแล้วรอบนี้) แต่ยังไม่มีใครตัดสินใจว่าจะเก็บ/ลบ/mark not-use |

---

## 7. 🎯 Merge Readiness Assessment — ฉบับล่าสุด (Session 3)

### ✅ พร้อมแล้ว (ยืนยันด้วยโค้ด/ข้อมูล/เบราว์เซอร์จริง)
- [x] SQL รันได้จริงบน BigQuery (rep_view.sql)
- [x] CSV export ถูก format ยืนยันจากไฟล์จริง 2,916 แถว
- [x] NRR% sanity check ตรงกับที่ Session 2 รายงานไว้ (Ning 107.9% ≈ 108%)
- [x] Grain สะอาด ไม่มี outlet ซ้ำ, ไม่มี GMV ติดลบ, comeback invariant ถูกต้อง
- [x] Guard เดือนครบทุกเดือนแล้วทั้ง rep_view.sql และ 4 ไฟล์ไม่ใช้งาน (fix รอบนี้)
- [x] บั๊ก #6 คู่ขนาน (LEG A+B) แก้ครบทั้ง 4 ไฟล์แล้ว
- [x] Lock-overwrite มี guard แล้ว (ยังไม่เคยทดสอบกดจริงในแอป — โค้ดพร้อมแล้ว)
- [x] Commission card loading-state แก้แล้ว (ยังไม่เคยเห็นผลจริงหลัง deploy — โค้ดพร้อมแล้ว)
- [x] P3 threshold ตรงกับ Cockpit แล้ว (5000→8000)
- [x] TL role UX/UI ผ่านการทดสอบ browser จริงแล้ว (NRR 109%, compute สำเร็จ ไม่ error)
- [x] White Shrimp P1 case ตรวจแล้วถูกต้อง (rate 1% ตรง Supabase, GMV≥5000 ผ่านเกณฑ์)

### ⚠️ ยังไม่ได้ทดสอบ/ตัดสินใจ — ต้องทำก่อน merge
- [ ] **ทดสอบ fix ทั้ง 10 จุดของ Session 3 ผ่าน browser จริงอีกรอบ** — เพิ่งแก้ยังไม่เคย verify ผลจริงหลัง deploy เลย (โดยเฉพาะ lock-guard กับ commission-card-shimmer)
- [ ] M-1 (ELSE fallback) — ต้องแก้ SQL+JS พร้อมกัน ยังไม่ได้ทำ
- [ ] C-3 (fast/slow path) — ต้องตัดสินใจสถาปัตยกรรมก่อนแก้ถาวร
- [ ] M-3 (same-squad transfer) — รอคำตอบเชิงธุรกิจ
- [ ] L-4 (ชะตากรรม 4 ไฟล์ไม่ใช้งาน) — รอ Bucci ตัดสินใจ
- [ ] 11 ร้าน "Admin Freshket" — รอ reassign เป็น ops task
- [ ] B3 (Handover MoM regression), B8 (TL multiplier tier boundary), B9 (rounding) — ยังไม่ได้ตรวจเลย
- [ ] D3-D6 ที่เหลือ (Admin/Rep/TL เห็นตรงกันทุก tab, MTD badge, Preview&Lock เต็ม flow, พิมพ์ % ซ้ำ)
- [ ] F ทั้งหมด — Auto-compute-at-month-start, เดือนปิดสมบูรณ์ (รอถึง ส.ค.), Retroactive lock ข้ามไตรมาสจริง
- [ ] Verify ค่า Supabase อีกรอบก่อน merge (เผื่อมีคนแก้ Cockpit อีกระหว่างนี้ — ดู section 6.4 เรื่อง spec doc เคยผิดมาก่อน)

### 🔴 ความเสี่ยงที่ควรรู้ก่อน merge
1. **Spec doc ไม่น่าเชื่อถือ 100%** (section 6.4) — ต้อง query Supabase สดทุกครั้งก่อนอ้างอิงค่า อย่า copy จาก doc เฉยๆ
2. **บั๊กประเภท "ผิดที่ผิดตำแหน่งแบบเงียบๆ" ยังเกิดซ้ำได้** — เจอ LEG B ที่หลุดจาก pass แรกของ Session 2 (section 6.1) แปลว่าเวลาแก้บั๊กลักษณะนี้ ต้อง grep หาทุก occurrence ให้ครบ ไม่ใช่แก้จุดแรกที่เจอแล้วจบ
3. **Fast/slow path (C-3) เคยเป็นบั๊กมาแล้ว 2 รอบ** (v232-fix, v829-fix) — เป็น recurring risk area ควร prioritize แก้ถาวรก่อน merge ไม่ใช่แค่แก้ตัวเลขให้ตรงกันชั่วคราว
4. **ยังไม่มีใครทดสอบเดือนที่ "ปิดสมบูรณ์" ในโหมด quarterly เลย** — ทุกอย่างที่เห็นเป็น MTD เท่านั้น

### คำแนะนำสำหรับ session หน้า
**อย่าเพิ่ง merge เข้า main** จนกว่าจะ:
1. Deploy fix ทั้ง 10 จุดของ Session 3 แล้วทดสอบผ่าน browser จริงยืนยันผล (โดยเฉพาะ lock-guard + commission-card-shimmer ที่ยังไม่เคยเห็นผลจริง)
2. ตัดสินใจ M-1, C-3, M-3, L-4 (4 เรื่องที่ค้างเพราะต้องคุย ไม่ใช่แค่โค้ด)
3. ทดสอบ B3, B8, B9 และ D3-D6 ที่เหลือ
4. รอทดสอบเดือนปิดสมบูรณ์ต้น ส.ค. อย่างน้อย 1 รอบ

---

## 8. กับดักใหม่ที่เจอใน Session 3 (ต่อยอด section 5)

- **อย่าเชื่อ spec doc เพียงเพราะเขียนว่า "ยืนยันจาก Supabase แล้ว"** — ต้อง query DB สดเองทุกครั้งก่อนใช้อ้างอิง (เจอ 3 ใน 4 ค่าใน spec ผิดจากของจริง)
- **แก้บั๊กที่มีหลาย occurrence ต้องหาให้ครบทุกจุดก่อนประกาศว่าเสร็จ** — บั๊ก #6 มี LEG A กับ LEG B แยกกัน แก้แค่ LEG A แล้วคิดว่าจบ ทั้งที่ LEG B ยังเป็นบั๊กเดิมอยู่
- **BigQuery กับ Supabase เป็นคนละระบบ คุยกันเองไม่ได้** — business rule constant ใดๆ ที่ต้องใช้ทั้งสองฝั่ง (เช่น threshold, rate) จะ sync ไม่อัตโนมัติ ต้อง manual sync เสมอ หรือทำ pipeline sync แยกต่างหาก — เป็นความเสี่ยงเชิงโครงสร้างที่ต้องระวังทุกครั้งที่เพิ่ม business rule ใหม่
- **Live browser testing เจอบั๊กที่ code review เจอไม่ได้** — บั๊กการ์ดค้าง (section 6.5) เป็น race condition ที่ต้องเห็นจริงถึงจะรู้ ไม่มีทางเจอจากอ่านโค้ดอย่างเดียว
- **วิเคราะห์ CSV จริงช่วยเจอ "ความเสี่ยงเชิงตีความ" ที่โค้ดถูกแต่ผลลัพธ์เข้าใจผิดง่าย** — churn แบบนับหัว (section 6.2-B) ไม่ใช่บั๊ก แต่เป็นการนำเสนอข้อมูลที่เสี่ยงตีความผิดถ้าไม่มี GMV กำกับ
