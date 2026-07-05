# Q3 2026 Quarterly Commission — HANDOFF

**อัปเดตล่าสุด:** 2026-07-05 (Session 2 — real-world browser testing round)
**Branch:** `preview/q3-commission-build`
**สถานะ:** ✅ ทดสอบจริงในเบราว์เซอร์แล้ว (Admin + Rep) ตัวเลขสอดคล้องกันครบ — ยังมีบางจุดที่ยังไม่ได้ทดสอบ (ดู section 4)

> อ่านคู่กับ `docs/Q3_NRR_COMMISSION_SPEC.md` (ตรรกะ/สูตร/schema) — เอกสารนี้คือ "เกิดอะไรขึ้นบ้าง + เหลืออะไร + พร้อม merge แค่ไหน"
> Session 1 (2026-07-04, งานทำ static build ทั้งหมดก่อนทดสอบจริง) สรุปย่อไว้ที่ section 1 — รายละเอียดเต็มอยู่ใน commit history

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
| 3 | เม.ย./พ.ค. หลุดเข้ามาใน output | CTE ย่อย (`apr_classified`/`may_classified`/`jun_classified`) มี literal `'2026-03/04/05'` หลงเหลือ — grep เดิมหาไม่เจอเพราะ pattern ไม่ครอบคลุม (อยู่ใน UNNEST array, หลัง CASE END) | ข้อมูลผิดไตรมาสทั้งชุด |
| 4 | Browser/GitHub cache confusion | ผู้ใช้ copy SQL จากแท็บเก่าที่เปิดค้าง (ก่อน fix ถูก push) | เสียเวลาสืบเป็นบั๊กใหม่ทั้งที่จริงๆ แก้แล้ว — **บทเรียน: ต้อง fetch สดผ่าน API ยืนยันก่อนสรุปว่าโค้ดผิดจริง** |
| 5 | `INTERVAL 1 MONTH - 1 DAY` — invalid BigQuery syntax | เขียนลบ interval 2 หน่วยในตัวเดียว (BigQuery ไม่รองรับ) ตอนแก้บั๊ก #2 | SQL รันไม่ได้อีกรอบ |
| 6 | 🔴 **`jun_classified` mislabel เป็น `v_base_str` (มิ.ย.) ทั้งที่ข้อมูลจริงมาจาก `sep_own`/`sep_gmv` (ก.ย.)** | ตอนแปลง Q2→Q3 ตั้งชื่อ CTE ตาม "jun" แล้วสับสนไปว่าควร label เป็นเดือนฐาน ทั้งที่จริงควรขนาน apr→v_m1_str/jul_own, may→v_m2_str/aug_own | กิจกรรมจริงของ ก.ย.ถูกฝังอยู่ใต้ label "มิ.ย." ตลอด — grep หา literal ไม่เจอเพราะเป็น**ตัวแปรผิดตัว**ไม่ใช่ literal |
| 7 | Churn ปลอม 100% สำหรับเดือนที่ยังไม่เริ่ม (เช่น ส.ค. ทั้งที่วันนี้ยัง ก.ค.) | "silent outlets" fallback ใน `may_classified`/`jun_classified` fire ให้ทุก outlet กลายเป็น curr_gmv=0 แม้เดือนนั้นจะยังไม่มี order จริงเลยสักใบ | Churn -14.8M ปลอมทั้งที่ "0 สาขา" — เป็น design gap ไม่ใช่ churn จริง |
| 8 | Label "cohort มี.ค." hardcode ค้างจาก Q2 | ไม่ได้ดึงจาก `QNRR_CFG.months_th` แบบไดนามิก (2 จุด: breakdown table + list view header) | UI โชว์เดือนผิดทั้งที่ตัวเลขถูก |
| 9 | ลืม rebuild `index.html` หลังแก้ JS source | แก้แค่ `src/*.js` แต่ไม่ได้รัน build step ให้ครบทุกรอบ | แอป deploy จริงยังเป็นโค้ดเก่า ทั้งที่ GitHub source ถูกแก้แล้ว |
| 10 | Commission Cockpit "พิมพ์ % ไม่ได้" | **หายเองไม่ทราบสาเหตุ** — ไล่โค้ดทั้งสาย (RLS, Auth, event handler, readonly attr) ไม่เจอบั๊กเลย น่าจะเป็น browser cache/session ชั่วคราว | ไม่ใช่ code bug ยืนยันจากการไล่โค้ดจนสุดทาง |

### ผลลัพธ์สุดท้ายหลังแก้ครบ — ยืนยันด้วยภาพจริงจากแอป

- Admin + Rep (Ning) เห็นตัวเลขตรงกัน: NRR 108%, baseGmv=14,783,790 (มิ.ย.), curr=16.0M (ก.ค. MTD 4 วัน)
- Churn/Up-Down โชว์ค่าสมเหตุสมผล (ไม่ใช่ค่าปลอมจากเดือนที่ยังไม่ถึง)
- Label "cohort มิ.ย." ถูกต้อง
- CSV validate ครบ 8 จุด (column structure, period_month, movement_type, cohort_month, curr_days, no fake churn, no June-mislabel, per-KAM cross-check)

---

## 3. ไฟล์ที่แก้เพิ่มใน Session 2

| ไฟล์ | จุดที่แก้ |
|---|---|
| `sql/q3_2026_movement_rep_view.sql` | บั๊ก #1,2,3,5,6,7 ทั้งหมด (ไฟล์หลักที่แอปใช้จริง) |
| `sql/q3_2026_movement_{kam,pm,admin,tl}_view.sql` | บั๊ก #1,2,3,5 (⚠️ **บั๊ก #6 ยังไม่เช็ค — ไฟล์เหล่านี้ไม่มี CTE ชื่อ `jun_classified` เลย โครงสร้างภายในต่างจาก rep_view สิ้นเชิง ไม่รู้ว่ามีบั๊กคู่ขนานหรือไม่ และไฟล์เหล่านี้ไม่ได้ถูกแอป consume อยู่แล้วจึงไม่ได้ priority สูง**) |
| `src/07c_qnrr_view.js` | บั๊ก #8 (2 จุด hardcode label) |
| `index.html` | rebuild หลังบั๊ก #9 |

---

## 4. 🎯 Merge Readiness Assessment — สำหรับ session หน้าประเมินต่อ

### ✅ พร้อมแล้ว (ยืนยันด้วยการทดสอบจริง)
- [x] SQL รันได้จริงบน BigQuery ไม่ error
- [x] CSV export ออกมาถูก format (29 columns, ยืนยัน 8 จุด)
- [x] Portfolio Health sheet โชว์ถูกต้องทั้ง Admin + Rep scope
- [x] NRR%, GMV, Churn/Up-Down ตรงกันข้าม role
- [x] Commission calculation logic ผ่าน unit test เต็มสาย (synthetic data)
- [x] Supabase migration (`nrr_policies.commission_mode`/`quarter_id`) รันสำเร็จแล้ว
- [x] Config values (`target_settings`) ตรงกับที่โค้ดคาดหวัง

### ⚠️ ยังไม่ได้ทดสอบ — ต้องทำก่อนตัดสินใจ merge
- [ ] **Commission ตัวเลข ฿ จริงในแอป (ไม่ใช่แค่ QNRR sheet)** — ยังไม่เห็นภาพ Commission panel ของ Ning จริงๆ ว่า ฿ ที่คำนวณออกมาตรงกับที่ควรได้ไหม (แค่ synthetic test ผ่าน ไม่ได้แปลว่า production data จะให้ผลถูกด้วย)
- [ ] **TL role** — ทดสอบแค่ Admin กับ Rep(KAM) ยังไม่เห็นภาพจริงของ TL scope เลย
- [ ] **Commission Cockpit Step 5 (Preview & Lock)** — flow การ lock snapshot จริงยังไม่ได้ทดสอบกับข้อมูล Q3 จริง
- [ ] **Upsell CSV (`sense_upsell_team.csv`)** — ยังไม่เคยเห็นการอัปโหลด/ทดสอบไฟล์นี้เลยใน session 2 ทั้งที่จำเป็นสำหรับ P1/P3 — commission ที่เห็นตอนนี้อาจจะ N/A ส่วน upsell อยู่
- [ ] **`sql/q3_2026_movement_{kam,pm,admin,tl}_view.sql` ทั้ง 4 ไฟล์** — ยังไม่ได้ตรวจว่ามีบั๊กคู่ขนานกับบั๊ก #6 (jun_classified mislabel) หรือไม่ เพราะโครงสร้างภายในต่างจาก rep_view (ไม่มี apr/may/jun_classified naming) — **ถ้าไฟล์เหล่านี้ไม่ได้ใช้งานจริงที่ไหนเลย ควรพิจารณาลบทิ้งหรือ mark ว่า not-use แทนที่จะปล่อยให้เป็นความเสี่ยงเงียบๆ**
- [ ] **ทดสอบข้าม 1 เดือนเต็ม** — ตอนนี้เห็นแค่ ก.ค. แบบ MTD (4 วัน) ยังไม่เคยเห็นเดือนที่ปิดสมบูรณ์ในโหมด quarterly เลยสักเดือน (ต้องรอถึงต้น ส.ค.เพื่อดู ก.ค.แบบเต็มเดือน)
- [ ] **Retroactive Lock ข้ามไตรมาส** — logic เขียนไว้และ unit test ผ่านแล้ว (session 1) แต่ยังไม่เคยกดใช้งานจริงในแอป
- [ ] **Auto-compute-at-month-start** — ยังไม่เคยเห็นการทำงานจริง (ต้องรอถึงวันที่ 1-3 ของเดือนถัดไปจริงๆ ถึงจะ trigger)

### 🔴 ความเสี่ยงที่ควรรู้ก่อน merge
1. **Pattern ของบั๊กที่เจอรอบนี้ (#3, #6) คือ "ตัวแปร/literal ผิดที่ผิดตำแหน่งแบบเงียบๆ"** — grep หา pattern เดิมไม่เจอเพราะไม่ใช่ syntax error แต่เป็น logic ผิด สิ่งนี้บอกว่า **อาจมีบั๊กแบบเดียวกันซ่อนอยู่อีกในจุดที่ยังไม่ได้ทดสอบ** (โดยเฉพาะ 4 ไฟล์ SQL ที่ไม่ได้ใช้งานจริงแต่ไม่ได้ตรวจละเอียดขนาดนี้)
2. **ยังไม่มีใครทดสอบเดือนที่ "ปิดสมบูรณ์" ในโหมด quarterly เลย** — สิ่งที่เห็นทั้งหมดคือ MTD (partial month) เท่านั้น พฤติกรรมตอนเดือนปิดสนิท (เช่น curr_days=31 เต็ม) ยังไม่เคยเห็นจริง
3. **โค้ด "พิมพ์ % ไม่ได้" ที่หายเอง** — ไม่พบสาเหตุจริง แนะนำให้ session หน้าลองทำซ้ำอีกครั้งเพื่อยืนยันว่าหายจริงถาวร ไม่ใช่ intermittent bug ที่จะกลับมา

### คำแนะนำสำหรับ session หน้า
**อย่าเพิ่ง merge เข้า main** จนกว่าจะ:
1. ทดสอบ Commission ฿ จริงกับข้อมูล production (ไม่ใช่แค่ QNRR sheet)
2. อัปโหลด + ทดสอบ `sense_upsell_team.csv`
3. ทดสอบ TL role อย่างน้อย 1 คน
4. ตัดสินใจชะตากรรมของ SQL 4 ไฟล์ที่ไม่ได้ใช้ (ลบ/mark not-use/หรือแก้ให้ตรงกัน)

---

## 5. กับดักที่ต้องระวังเพิ่ม (ต่อยอดจาก Session 1)

- **grep หา literal string ไม่พอ** — บั๊ก #6 เป็นตัวแปรผิดตัว (`v_base_str` แทน `v_m3_str`) ไม่ใช่ hardcode literal ต้องอ่าน**ความหมาย**ของแต่ละ CTE เทียบกับ data source จริง (FROM/JOIN clause) ไม่ใช่แค่หา string
- **อย่าเชื่อว่า static SQL "ดูสมเหตุสมผล" = ทำงานถูก** — ต้องรันจริงกับ BigQuery เท่านั้นถึงจะเจอ syntax error (`node --check` ใช้กับ SQL ไม่ได้)
- **เตือนผู้ใช้ให้เปิดแท็บใหม่ทุกครั้งที่ดึง SQL ไปรัน** — browser cache ทำให้เสียเวลาสืบบั๊กที่ไม่มีจริงไปรอบหนึ่งแล้ว
- **ทุกครั้งที่แก้ `src/*.js` ต้อง rebuild+push `index.html` ในขั้นตอนเดียวกันเสมอ** — อย่าแยกเป็นคนละรอบ (เคยพลาดมาแล้ว)
- **Design gap ≠ bug เสมอไป** — บั๊ก #7 (churn ปลอมสำหรับเดือนอนาคต) เป็นพฤติกรรมที่ "ทำงานตามที่เขียนไว้" แต่ผิดเจตนา ต้องคิดเผื่อ edge case "เดือนที่ยังไม่เกิดขึ้นจริง" เสมอเวลาออกแบบ fallback logic
