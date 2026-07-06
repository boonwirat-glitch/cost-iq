> ⚠️ **SUPERSEDED 2026-07-06** — เอกสารนี้เป็นประวัติ Session 1-3 ตอนงานยังอยู่บน `preview/q3-commission-build`
> งานถูก merge เข้า `main` เรียบร้อยแล้ว พร้อมแก้บั๊กเพิ่มอีกหลายจุด — **อ่าน `docs/handoff-2026-07-06-v847-q3-merge-complete.md` แทนสำหรับสถานะปัจจุบัน**

---

# Main vs Preview — Divergence Analysis & Merge Plan

**สร้างเมื่อ:** 2026-07-06
**Branches:** `main` vs `preview/q3-commission-build`
**Merge-base (จุดแยกสาขา):** commit `c4b1c4261f` (2026-06-30)
**สถานะ divergence:** `main` นำหน้า 21 commits ที่ preview ไม่มี / `preview` นำหน้า 129 commits ที่ main ไม่มี — **diverged จริง ไม่ใช่ fast-forward**

> วิธีตรวจ: ใช้ GitHub Compare API หา 21 commits ที่อยู่บน main แต่ไม่อยู่ใน preview ancestry แล้ว**อ่านโค้ดจริงทีละจุดเพื่อยืนยัน**ว่าแต่ละ commit สร้าง "gap" จริงในเนื้อโค้ดปัจจุบันของ preview หรือแค่ชื่อ commit ต่างกันแต่ผลลัพธ์เหมือนกัน (บางอันเป็น false alarm — preview แก้ปัญหาเดียวกันเองด้วยวิธีอื่น)

---

## 1. Confirmed Gaps — main มี fix จริงที่ preview ไม่มี (verified จากโค้ดจริง ไม่ใช่แค่ชื่อ commit)

### Gap A — 🔴 Retroactive Lock UI ถูกซ่อนทั้งฟีเจอร์ใน preview
**ไฟล์:** `src/07b_cds.js`

Main (commit `1e04eb68`, v823) ลบ `v211a` override block ที่เคยแอบ redefine `window.renderCommLockStep` / `window.exportCommissionSnapshotCsv` / `window.lockCommissionSnapshot` ทิ้งไปแล้ว — comment ในโค้ด main บอกตรงๆ ว่า **"this was hiding Retroactive Lock feature entirely"**

Preview **ยังมี v211a override ตัวนี้อยู่ครบ** (บรรทัด 2307-2369 ของ `07b_cds.js`) แปลว่า **ฟีเจอร์ Retroactive Lock บน preview ถูกซ่อนอยู่จริงตอนนี้** — ตรงกับ test case G4 ในเอกสาร test spec ที่ยัง "ยังไม่ได้ทดสอบ" เพราะยังไม่เคยเห็นในแอปเลย (ไม่ใช่แค่ยังไม่ได้ทดสอบ — เห็นไม่ได้ตั้งแต่แรก)

### Gap B — 🔴 Retroactive Lock คำนวณเลขผิดถ้าเปิดใช้ได้ (ซ้อนกับ Gap A)
**ไฟล์:** `src/07b_nrr_target.js`

Main (commit `d9940f69`, v827) เพิ่ม parameter `asOfPeriod` ให้ `_tgtComputeKamNRR(kamEmail, tlEmail, asOfPeriod)` เพื่อคำนวณ NRR ของเดือนที่ปิดไปแล้วโดยเทียบกับเดือนปิดก่อนหน้า (เช่น พ.ค. vs มิ.ย.) แทนที่จะเทียบกับ "เดือนปัจจุบันแบบ MTD" — commit message บอกชัด: ถ้าไม่มี fix นี้ "lock เดือน มิ.ย. ไปสองสามวันแรกของ ก.ค. จะเทียบกับข้อมูลแค่ 1-3 วันแรกของ ก.ค. ได้ NRR ใกล้ 0 สำหรับทุกคน"

**Preview's `_tgtComputeKamNRR` มีแค่ 2 parameter (`kamEmail, tlEmail`) — ไม่มี `asOfPeriod` เลย** แต่โค้ดที่เรียกใช้ (`_commBuildKamPayout`, `_commBuildTlPayout` ใน `07a_commission_engine.js`) **เรียกด้วย 3 argument** (`_tgtComputeKamNRR(kamEmail, null, periodOverride)`) เหมือนกับ main ทุกจุด — เพราะ caller ฝั่ง preview สืบทอดมาจาก interface เดียวกัน แต่ function body ไม่เคยถูกอัปเดตให้รองรับ

**ผลลัพธ์จริง:** `periodOverride` ที่ preview ส่งเข้าไปถูก**เพิกเฉยเงียบๆ** ทุกครั้ง — ถ้า Gap A ถูกแก้แล้วเปิดใช้ Retroactive Lock ได้ การคำนวณ NRR สำหรับโหมด **monthly** (ไม่ใช่ quarterly) จะยังคำนวณผิดอยู่ดี เพราะเทียบกับข้อมูล MTD ปัจจุบันแทนที่จะเป็นเดือนปิดที่ถูกต้อง

**หมายเหตุ:** โหมด quarterly ไม่กระทบ — `_qnrrComputeForCommission(email, scope, asOfPeriod)` ของ preview มี `asOfPeriod` ของตัวเองอยู่แล้วและทำงานถูกต้อง (คนละกลไกกับ `_tgtComputeKamNRR`) นี่คือบั๊กเฉพาะ **monthly commission mode** เท่านั้น

### Gap C — 🟡 Auto-compute draft ต้นเดือนหายไปทั้งฟีเจอร์
**ไฟล์:** `src/07b_nrr_target.js`

Main (commit `b6691e3c`, v826) เพิ่มฟีเจอร์: เมื่อ Admin เปิดแอปวันที่ 1-3 ของเดือนใหม่ และเดือนก่อนหน้ายังไม่ได้ lock ระบบจะ auto-compute draft ให้เองแบบเงียบๆ (ยังต้องกด Lock manual เหมือนเดิม) — โค้ดทั้งบล็อกนี้ **ไม่มีอยู่ใน preview เลย** (หายไปทั้งหมด ไม่ใช่แค่ปิดใช้งาน)

ผลกระทบ: ต่ำกว่า A/B เพราะเป็น convenience feature ไม่ใช่ correctness bug — Admin ยังกด compute เองได้ปกติ

---

## 2. False Alarms — ดูเหมือน gap จากชื่อ commit แต่ตรวจโค้ดแล้วไม่ใช่

ตรวจสอบ 3 commit ที่เหลือในลิสต์ 21 ตัว ด้วยการอ่านโค้ดจริงทั้งสองฝั่งเทียบกัน:

| Commit | เรื่อง | ผลตรวจ |
|---|---|---|
| `6149f21e` (v824) | `lock_note` 400 error — ต้องย้ายเข้า `breakdown` jsonb | ✅ **ไม่ใช่ gap** — preview มี fix เดียวกันอยู่แล้ว (นอกจากนี้ preview ยังมี audit trail เพิ่มเติมที่ main ไม่มี: `unlock_overwrite_at`/`unlock_overwrite_by`) |
| `3a7cb419` (v825) | DOM target ผิดหลัง compute/lock (`#tgt-sheet-body` vs `#commission-cockpit-body`) | ✅ **ไม่ใช่ gap** — โค้ดเหมือนกันทุกตัวอักษรทั้งสองฝั่ง |
| `bf13991b`/`2f776264` (v821-822) | Retroactive subtab ตำแหน่ง HTML ผิด | ✅ **ไม่ใช่ gap** — โครงสร้าง HTML เหมือนกันทั้งสองฝั่ง |

**บทเรียน:** รายชื่อ commit ที่ต่างกันไม่ได้แปลว่าโค้ดต่างกันเสมอไป — preview แก้ปัญหาเดียวกันมาเองคนละทางในบางจุด ต้อง diff เนื้อโค้ดจริงยืนยันทุกครั้ง (ตรงกับหลักการที่ยึดมาตลอด session นี้)

---

## 3. Self-inflicted Regression ใน Preview — ไม่เกี่ยวกับ main เลย แต่เป็นสาเหตุที่เป็นไปได้สูงสุดของ "portfolioview ไม่เสถียร"

**ไฟล์:** `src/06_portview_teamview.js`, ฟังก์ชัน `fullCard(g)` / `chipRow(g)` / `starCard(g)` (เรียกจาก `sorted.map(_renderCard)` — วนทุก KAM ในทีม/พอร์ต)

Main (ของเดิม): `const _nrr = _tgtComputeKamNRR(g.kamEmail, null);` — เรียกฟังก์ชันเบาๆ ตรงๆ

Preview (ของใหม่):
```js
const _nrr=(function(){
  try{
    var _p=_nrrGovResolveForVisibleScope();
    if(_p&&_p.commission_mode==='quarterly'&&window._qnrrComputeForCommission)
      return window._qnrrComputeForCommission(g.kamEmail,'kam')||_tgtComputeKamNRR(g.kamEmail,null);
  }catch(e){}
  return _tgtComputeKamNRR(g.kamEmail, null);
})();
```

**ปัญหา:** `_qnrrComputeForCommission()` **ไม่มี cache เลย** — ทุกครั้งที่เรียกจะ rebuild `baseMap`, `coreTransferOutSet`, ทำ month grouping ใหม่หมด บวก `console.log` ทุกครั้ง (เห็นจาก `07c_qnrr_view.js` บรรทัด 302) โค้ดนี้อยู่ใน**การ์ดที่ render ต่อ 1 KAM 1 ใบ** และถูกเรียกซ้ำ **3 จุด** ในไฟล์เดียวกัน (`fullCard` แบบเต็ม, แบบย่อ, แบบ compact)

เทียบกับข้างๆ กันในฟังก์ชันเดียวกัน — `_getCachedKamPayout(g.kamEmail)` (ใช้คำนวณ payout เต็ม) **มี cache** อยู่แล้ว (cache key รวม `_qnrrLoaded`/`_commMode` ด้วยตาม fix ของ session ก่อน) แต่ตัวเลข NRR% ที่โชว์บน pill เดียวกันนั้น**ไม่ได้ผ่าน cache ตัวเดียวกัน** — เป็นความไม่สอดคล้องภายในโค้ดชุดเดียวกัน (น่าจะเป็นจุดที่ตกหล่นตอนแก้ cache key ในบั๊ก C-3/threshold sync ที่ผ่านมา)

**นี่คือคำอธิบายที่สมเหตุสมผลที่สุดสำหรับที่ Bucci สังเกตว่า "portfolioview loading/fetching ไม่เสถียร"** — ไม่ใช่ network fetching ช้าจริง แต่ main thread ถูกบล็อกด้วยการคำนวณซ้ำซ้อนทุกครั้งที่ list ของทีม re-render (ซึ่งเกิดถี่ตอน initial load เพราะมีหลาย bulk dataset ทยอยมาไม่พร้อมกัน แต่ละ dataset ที่มาถึงจะ trigger re-render ทั้ง list ใหม่)

---

## 4. แผน Merge — ยึด main เป็นฐาน ไม่ใช่ preview

### หลักการ
**ห้าม fast-forward หรือ merge preview → main ตรงๆ** เพราะ:
1. Gap A/B/C จะถูกลบทิ้งไปกับ merge ถ้า preview's version ของไฟล์ชนะทับ main's version
2. Gap B เป็นบั๊กที่ merge ธรรมดา (แม้แต่ 3-way merge อัตโนมัติของ git) **ตรวจจับไม่ได้** เพราะเป็นปัญหาเชิงความหมาย (semantic) — function signature ไม่ตรงกับที่ caller คาดหวัง ไม่ใช่ text conflict ที่ git เห็น

**แนวทางที่ถูกต้อง: สร้าง branch ใหม่จาก `main` ปัจจุบัน แล้ว "ปลูกถ่าย" เฉพาะส่วนที่เป็นฟีเจอร์ quarterly-commission จาก preview เข้าไป** ไม่ใช่เอา preview ทั้งไฟล์มาทับ

### ขั้นตอน

**Step 1 — สร้าง branch ใหม่จาก main**
```
git checkout main
git checkout -b merge/q3-commission-on-main
```
เพื่อให้ Gap A/B/C (fixes จริงที่ยืนยันแล้ว) เป็นฐานตั้งต้น ไม่ต้องมานั่งไล่หาทีหลัง

**Step 2 — ย้ายไฟล์ที่เป็นของใหม่ล้วนๆ (ความเสี่ยงต่ำ ก็อปได้ตรงๆ)**
- `src/07c_qnrr_view.js` (ทั้งไฟล์ — main ไม่มีไฟล์นี้เลย)
- CSV parser rewrite ใน `src/02_data_pipeline.js` (29-column parser, `byKamEmail`/`byTlEmail` grouping) — ส่วนนี้ self-contained ไม่ทับซ้อนกับ fix ฝั่ง main
- `sql/*` ทั้งหมดที่เกี่ยวกับ Q3 (rep_view, pm_view, admin_view, NOT_USE_kam/tl_view)

**Step 3 — ไฟล์ที่ทับซ้อนกัน ต้อง merge มือ ไม่ใช่ copy ทับ**

| ไฟล์ | วิธี merge |
|---|---|
| `07a_commission_engine.js` | เริ่มจาก main's version → เพิ่ม quarterly-mode branching (`_nrrGovResolveForVisibleScope`, `_qnrrComputeForCommission` calls) จาก preview เข้าไปทีละจุด |
| `07b_nrr_target.js` | เริ่มจาก main's version (**ต้องมี** `asOfPeriod` param — Gap B) → เพิ่ม `_nrrBarSource()`/quarterly baseline section จาก preview |
| `07b_commission_cockpit.js` | เริ่มจาก main's version → เพิ่ม Quarterly Mode toggle UI (`_nrrGovGetQuarterlyMode`, `onNrrPolicyChangeMode`) จาก preview |
| `07b_cds.js` | เริ่มจาก main's version (**ไม่มี** v211a override — Gap A) → ยืนยันว่า audit trail เพิ่มเติมของ preview (`unlock_overwrite_at`) ยังอยู่ครบ |
| `06_portview_teamview.js` | เริ่มจาก main's version → เพิ่ม cache-key fix (`_qnrrLoaded`/`_commMode`) จาก preview **พร้อมแก้ Gap ข้อ 3 ไปด้วย**: ห่อ `_qnrrComputeForCommission()` ใน `fullCard`/`chipRow`/`starCard` ด้วย cache เดียวกับ `_getCachedKamPayout` แทนที่จะเรียกสดทุก render |

**Step 4 — จุดที่ต้องแก้เพิ่ม ไม่ใช่แค่ copy-paste (สำคัญที่สุด)**

แก้ `_tgtComputeKamNRR` ให้มีทั้ง 2 อย่างพร้อมกัน (ไม่ขัดกัน เป็นคนละ path):
```
function _tgtComputeKamNRR(kamEmail, tlEmail, asOfPeriod) {
  // ... main's frozen-month logic (Gap B fix) คงไว้ทั้งหมด
}
```
แล้วให้ quarterly-mode caller (`_nrrBarSource`, `_commBuildKamPayout` เมื่อ mode='quarterly') เรียก `_qnrrComputeForCommission(email, scope, asOfPeriod)` เหมือนเดิม — สอง path นี้ทำงานคู่ขนานกันได้ไม่ชนกัน เพราะ mode ตัดสินใจว่าจะใช้ path ไหนอยู่แล้ว

**Step 5 — ทดสอบซ้ำตาม test spec เดิม + เพิ่มเคสใหม่**
- รัน `docs/Q3_NRR_TEST_SPEC.md` ทั้งหมดซ้ำบน branch ใหม่นี้ (ฐานเปลี่ยนจาก preview เป็น main+quarterly แล้ว ผลอาจต่างจากที่เคย verify ไว้)
- เพิ่ม test case ใหม่: **Retroactive Lock ในโหมด monthly** (Gap B) — ต้อง verify ว่าเทียบเดือนปิดกับเดือนปิด ไม่ใช่เดือนปิดกับ MTD
- เพิ่ม test case ใหม่: **Retroactive Lock UI มองเห็นได้จริง** (Gap A) — เปิด Cockpit step 5 แล้วต้องเห็นแท็บ Retroactive
- เพิ่ม test case ใหม่: **Portfolio view render performance** — เปิด team view ที่มี KAM 10+ คน เช็คว่าไม่มี console.log spam และไม่มี jank ตอน scroll/re-render (แก้ตาม Step 3 ข้อสุดท้าย)

**Step 6 — merge `merge/q3-commission-on-main` เข้า `main` แทนที่จะ merge preview เข้า main โดยตรง**

---

## 5. สรุปสั้น

| | |
|---|---|
| ยึดอะไรเป็นฐาน | **main** (มี fix จริง 3 ตัวที่ preview ไม่มี — Gap A/B/C) |
| เอาอะไรจาก preview มาเสริม | ฟีเจอร์ quarterly commission ทั้งหมด (`07c_qnrr_view.js`, CSV parser, quarterly toggle UI, `nrr_policies` wiring) |
| จุดที่ห้ามลืมแก้เพิ่ม (ไม่ใช่แค่ copy) | `_tgtComputeKamNRR` ต้องมี `asOfPeriod` + quarterly path ต้องอยู่ร่วมกันได้ (Step 4), cache สำหรับ NRR% ใน portfolio view (Step 3 แถวสุดท้าย) |
| ทำไมห้าม merge preview → main ตรงๆ | จะลบ Gap A/B/C ที่ main แก้ไปแล้วทิ้ง + บั๊กเชิงความหมาย (Gap B) ที่ git merge อัตโนมัติตรวจไม่เจอ |
