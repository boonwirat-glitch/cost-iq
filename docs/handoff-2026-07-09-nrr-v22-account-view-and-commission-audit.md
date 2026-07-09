# Handoff — /nrr Phase C (Account view) + Round 4/5 polish + commission audit · 2026-07-09

หนึ่ง session ยาว ครอบคลุมตั้งแต่ build หน้า Account view ใหม่ทั้งหน้า (Phase C) ไปจนถึง 2 รอบ
polish หลังเปิดดูจริง, บั๊กคำนวณค่าคอมฯ 1 ตัวที่แก้ไปแล้ว, และ audit เรื่อง source ของ commission
config + transfer_in/out ที่จบด้วยผลลัพธ์ "ถูกต้องอยู่แล้ว ไม่ต้องแก้" ทั้งคู่

## สถานะ deploy ปัจจุบัน

| Commit | เนื้อหา | Push แล้ว? |
|---|---|---|
| `7c056be` | Phase C v18 — หน้า Account view ใหม่ทั้งหน้า | ✅ push แล้ว, live |
| `fe69115` | v22 — แก้บั๊ก handover gate + polish 8 เรื่อง | ✅ push แล้ว, live |
| `664cae8` | v22 cleanup — ลบ dead code, แก้ comment ผิด | ⚠️ **commit แล้ว ยังไม่ push** |

**ถ้า session หน้าต้องทำอะไรก่อนอื่น: เช็คกับ user ว่าจะ push `664cae8` ขึ้น `main` ไหม** (เป็น
cleanup ล้วนๆ ไม่เปลี่ยน behavior ยืนยันด้วย `verify_nrr_formula.js` PASS + preview เทียบก่อน/หลังแล้ว
— แค่ยังไม่ได้รับคำสั่ง push ชัดเจนในรอบนี้ user บอกแค่ "commit ได้เลย")

Live URL: `https://freshket-sense.pages.dev/nrr` (deploy อัตโนมัติผ่าน Cloudflare Pages ทุกครั้งที่
push `main` — ไม่ต้องทำอะไรเพิ่ม)

## Phase C — หน้า Account view ใหม่ (`#/account/:id`, v18)

เข้าถึงได้จากการกดร้านในรายการ Portfolio โครงหน้า:
1. **Header + Hero** — ชื่อร้าน/KAM/ประเภท + กราฟแท่ง 6 เดือน (คลิกเลือกเดือนได้) + pace bar
2. **Stat row 4 ช่อง** — AOV (สี threshold + sparkline), สาขา (dot-grid ≤15 / stacked-bar >15),
   หมวดสินค้า (10 สีคงที่, จาง=ยังไม่ซื้อ), ราคาสินค้า (net impact) — กดเปิด `#nrr-slideover` เดิม
3. **Net verdict** — สรุปสัญญาณบวก/เสี่ยง (ดีไซน์เปลี่ยนไป 3 รอบ จบที่กล่อง tint คู่ — ดู Round 5)
4. **สัญญาณบวกเดือนนี้ / ต้องดูแล** — SKU signals แบบ live run-rate + interval-aware cycle detection
   (ported จาก Sense's `05_kam_view.js`) พร้อม floating tooltip ดูรายสาขา

Logic ทั้งหมดอยู่ใน `src/nrr/nrr_account.js` (ไฟล์ใหม่) — pure functions, ไม่แตะ compute engine เดิม
(`nrr_logic.js`) เลย

## Round 4/5 — feedback หลังเปิดดูจริง (v19 → v22)

รวมทุกจุดที่แก้ผ่านหลายรอบ feedback สดๆ ระหว่าง preview จริง:

- **AOV sparkline** — เดิม scale จาก min/max ของข้อมูล (ทำให้ decline จริง 77% ดูเหมือนเส้นเรียบๆ)
  → เปลี่ยนเป็น scale จาก 0 เหมือนกราฟอื่นในแอพ
- **Loading skeleton** — เจอ root cause จริง: `.ds-skel`/`.ds-empty` เดิม scope ผิดไว้ใต้
  `.nrr-comm-ds` เท่านั้น ทำให้ทุกจุดที่ใช้นอก commission drawer (Account/Portfolio) render เป็น
  กล่องเปล่าไม่มี shimmer เลย ("จอขาว") — แก้ให้ unscope + สร้าง skeleton ที่มีรูปทรงเหมือนหน้าจริง
- **Net verdict** — ดีไซน์เปลี่ยน 3 รอบ: (1) ประโยคเดียวในกล่อง `.nrr-verdict` → (2) "before→after"
  flow strip พร้อม gradient line → (3) **กล่อง tint เขียว/แดง 2 กล่อง** (จบตรงนี้ตามที่ user เลือก
  — ไม่เอาเลข run-rate ก่อน/หลังแล้ว เอาแค่ยอดบวกรวม/ยอดเสี่ยงรวม)
- **แท่งเดือนฐาน "สูงเกินจริง"** — เจอบั๊กเดียวกัน **2 ที่คนละ component**: หน้า Account (border
  dashed บนแท่งเอง) และ sparkline เล็กในแถว Portfolio (`.nrr-spark-basemark` เป็น element
  แยกต่อท้ายใต้แท่ง ทำให้ column สูงกว่าเพื่อนบ้าน ดันแท่งขึ้น) — แก้ทั้งคู่ให้ใช้ inset marker/ป้าย
  label แทน ไม่เพิ่มความสูงให้ layout
- **Portfolio search bounce** — ล็อค `min-height` ตามความสูง unfiltered ตอน mount ครั้งแรก
- **Dashboard KAM row** — กดเปิด drawer ตรงเลย (เดิม expand inline ก่อนกดปุ่มอีกที)
- **สีแยกประเภทค่าคอมฯ** — เพิ่ม `--comm-nrr/p1/p3/expansion/handover` (+soft) ใน `nrr_tokens.css`
  ตาม pattern เดียวกับ movement/category palette ที่มีอยู่แล้ว

### ⚠️ บั๊กคำนวณค่าคอมฯ จริง — handover ต้องอยู่ใน gate

**เจอจากคำถามของ user เอง** ("handover ไม่อยู่ใน Gate ได้ไง") — เช็คกับ engine ต้นทาง
(`src/07a_commission_engine.js:688-692`, `_commBuildKamPayout` — ตัวที่สร้าง payroll จริง) พบว่า
Sense gate รวม handover เข้าไปในก้อนที่คูณ cap ด้วย (`subtotal = nrr+upsell+handover; final =
subtotal × cap`) — **/nrr เดิมเอา handover บวกนอก gate** (ผิด) comment เก่าอ้างว่า "verify แล้ว"
แต่จริงๆ 2 เคสที่เอามาเช็คบังเอิญเป็นเคสที่สองสูตรได้เลขเท่ากันพอดี (ไม่เคยเจอเคส gate<1 + handover>0
จริง) แก้ให้ `/nrr` ตรงกับ engine แล้ว — **ตรวจแล้วปัจจุบันไม่มี KAM คนไหน handover>0 เลย ยอดที่จ่าย
จริงวันนี้เลยไม่มีใครเปลี่ยน** แต่ถ้าอนาคตมีเคส gate<1+handover>0 จะคำนวณถูกทันที (ก่อนหน้านี้จะ
over-pay)

## Audit ล่าสุด — ยืนยันว่าไม่มีบั๊ก (ไม่ต้องแก้อะไร)

User ถาม 2 เรื่อง ตรวจสอบจนมั่นใจแล้วทั้งคู่ **ไม่พบปัญหา**:

1. **Commission config source** — `/nrr` อ่าน `target_settings` (key `{metric}_params`) และ
   `commission_plans/rules/rule_tiers/plan_assignments` — ตรงกับที่ Cockpit ของ Sense เขียน/อ่าน
   เป๊ะ (ยืนยันจาก comment เล่าประวัติบั๊ก v559 ในโค้ด Sense เอง) ข้อควรรู้: cache ต่อเซสชัน ไม่มี
   auto-refresh — แก้ config แล้วต้องรีเฟรชหน้า /nrr ใหม่ก่อนเลขจะขยับ, เดือนที่ล็อกแล้วไม่ขยับตาม
   config เด็ดขาด (อ่านจาก `commission_payout_snapshots` ตรงๆ)
2. **transfer_in/out vs Core NRR** — ยืนยันว่าร้าน transfer_in ถูกนับเข้า core NRR ของ KAM ที่รับ
   ทั้ง 2 ด้าน (ฐานของเจ้าของเดิม + ยอดปัจจุบันของเจ้าใหม่) โดยตั้งใจ — **เรื่องนี้เพิ่งมีบั๊กจริงและแก้
   ไปแล้วเมื่อวาน** (double-count ฐานตอน transfer เกิดเดือนแรกของไตรมาส, กระทบ 44 ร้าน 10 KAM,
   แก้ทั้ง `/nrr` v10 และ Sense v852 — ดู `docs/handoff-2026-07-08-nrr-transfer-in-fix.md`) ตรวจโค้ด
   ปัจจุบันซ้ำแล้ว ไม่มีร่องรอยบั๊กเดิมหลงเหลือ

รายละเอียดเต็มบันทึกไว้ในหัว plan file แล้ว (`~/.claude/plans/claude-plans-users-
boonwiratthiemwongku-quiet-firefly.md` ส่วน "Investigation closure")

## 🔓 Open item — ยังไม่ตัดสินใจ (ไม่ใช่บั๊กด่วน)

พบระหว่าง tidiness review: `nrrCommDefaultTiers()` (`nrr_commission.js`) ยังมี hardcoded fallback
tier (฿0/5,000/10,000 ฯลฯ) ใช้เมื่อ fetch `commission_rule_tiers` ล้มเหลว — แต่ Sense **เจตนาลบ
fallback แบบนี้ทิ้งไปแล้ว** (`v754f`: "ป้องกัน stale tier เก่าโผล่มาก่อนข้อมูล DB มาจริง" → เปลี่ยน
เป็นโชว์ skeleton ว่างแทนเลขเดา) ถ้า fetch ล้มเหลววันไหน (เน็ตหลุด/RLS ผิด) `/nrr` จะเงียบๆ โชว์เลข
เดาแทนที่จะบอกว่า "โหลดไม่ได้" — ไม่ใช่บั๊กที่เกิดตอนนี้ (fetch สำเร็จปกติทุกวัน) แต่เป็นความเสี่ยงเงียบ
ถามผู้ใช้ไปแล้ว ยังไม่ได้คำตอบ — **ถามซ้ำได้เลยถ้าอยากปิดเรื่องนี้**

## ไฟล์สำคัญ (แผนที่เร็วสำหรับ session หน้า)

- `src/nrr/nrr_account.js` — logic ทั้งหมดของ Account view (ใหม่จาก Phase C)
- `src/nrr/nrr_view.js` — render ทุกหน้า (ใหญ่สุด, ค้นด้วยชื่อฟังก์ชัน `nrrRender*`)
- `src/nrr/nrr_commission.js` — estimate engine (client-side) + snapshot reader — comment หัวไฟล์
  อธิบายชัดว่า **ไม่ recompute ตัวเลขที่ล็อกแล้ว** อ่านจาก DB ตรงๆเสมอ
- `src/nrr/nrr_logic.js` — `_qnrrCompute`, ported verbatim จาก `src/07c_qnrr_view.js` — **ห้ามแก้
  เองตามความเข้าใจ** (มี comment กำกับไว้ชัดว่า asymmetry ทุกจุดคือ business decision ที่ validate
  แล้ว) ถ้าเลขไม่ตรง Sense ให้ diff กับ `07c_qnrr_view.js` ก่อนแก้อะไรในไฟล์นี้
- `src/07a_commission_engine.js` — engine จริงของ Sense ที่สร้าง `commission_payout_snapshots`
  (source of truth สำหรับค่าคอมฯ ที่ล็อกแล้ว)
- `build_nrr.py` — build script, `python3 build_nrr.py vNN` สร้าง `dist/nrr_vNN.html` +
  ทับ `nrr.html` ที่ root (ไฟล์ที่ Cloudflare Pages เสิร์ฟจริง)
- `tools/verify_nrr_formula.js` — standing test ยืนยัน %NRR formula ไม่ regress (รันกับ CSV จริง
  จาก R2 ทุกครั้งก่อน build/push)

## Verify ก่อนทำอะไรต่อ

- `node --check` ทุกไฟล์ที่แตะ
- `node tools/verify_nrr_formula.js <path/to/sense_qnrr.csv>` ต้อง PASS ทั้ง 2 เทส (ดึง CSV สดจาก
  `https://pub-12078d17646340808024e8cc95504995.r2.dev/sense_qnrr_2026q3.csv`)
- ใช้ `preview_start` (config `nrr-app` ใน `.claude/launch.json`, port 4321) แทน `dashboard.html`
  ตรง `/nrr` — ทดสอบ role จริง (rep/tl/admin) ผ่าน Supabase login ปกติ
