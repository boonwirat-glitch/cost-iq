# Freshket Sense — Handoff v847 (Q3 Commission Merge Complete + Transfer/NRR Fixes)

**อัปเดต:** 2026-07-06
**Branch:** `main` (งานทั้งหมดอยู่บน main แล้ว — ไม่ใช่ preview อีกต่อไป)
**Sense version:** v847
**สถานะ:** ✅ Q3 quarterly commission feature merge เข้า main สำเร็จ + แก้บั๊กจริงเพิ่มอีก 8 จุดหลัง merge

> Superseded: `docs/Q3_NRR_COMMISSION_HANDOFF.md` (Session 1-3, ยังอยู่บน preview branch), `docs/MAIN_VS_PREVIEW_MERGE_ANALYSIS.md` (งานเสร็จแล้ว เก็บไว้เป็นประวัติ) — อ่านไฟล์นี้แทนสำหรับสถานะปัจจุบัน

---

## 1. สรุปสั้นสำหรับ session ใหม่

Feature quarterly commission (Q3 2026) ที่ทำใน `preview/q3-commission-build` ถูก **merge เข้า main แบบ surgical** เรียบร้อยแล้ว (ไม่ใช่เอา preview ทับ main ตรงๆ — สร้าง branch ใหม่จาก main แล้วปลูกถ่ายเฉพาะฟีเจอร์ quarterly เข้าไป เพราะ main มี bug fix จริง 3 ตัวที่ preview ไม่มี) หลัง merge เจอบั๊กจริงเพิ่มอีกหลายจุดจากการทดสอบจริงกับ browser + ข้อมูลจริง แก้ไปทั้งหมดแล้ว ปัจจุบัน deploy อยู่ที่ `main`, version **v847**

**ถ้าจะทำงานต่อ:** อ่านหัวข้อ 6 (Known open items) ก่อน แล้วดู section 7 (สิ่งที่ Bucci บอกว่าจะทำ session หน้า — UX/UI + %NRR)

---

## 2. Merge Analysis (background)

**ปัญหา:** `main` กับ `preview/q3-commission-build` diverge กันจริง (main นำหน้า 21 commits ที่ preview ไม่มี, preview นำหน้า 129 commits ที่ main ไม่มี จากจุดแยกเมื่อ 2026-06-30)

**3 gap ที่ยืนยันแล้วว่า main มี fix จริงที่ preview ขาด:**
| Gap | เรื่อง | ไฟล์ |
|---|---|---|
| A | Retroactive Lock UI ถูกซ่อนทั้งฟีเจอร์ (v211a override เก่าค้างอยู่) | `07b_cds.js` |
| B | Retroactive Lock คำนวณ NRR ผิดถ้าเปิดใช้ได้ (`_tgtComputeKamNRR` ขาด `asOfPeriod` param) | `07b_nrr_target.js` |
| C | Auto-compute draft ต้นเดือนหายไปทั้งฟีเจอร์ | `07b_nrr_target.js` |

**Self-inflicted bug ที่พบใน preview เอง (ไม่เกี่ยวกับ main):** portfolio/team view เรียก `_qnrrComputeForCommission()` สดๆ ไม่มี cache ทุกครั้งที่ re-render (ต้องสงสัยว่าเป็นสาเหตุ "portfolioview ไม่เสถียร" ที่ Bucci สังเกตเห็น) — แก้แล้วด้วย `_getCachedKamNrr()` piggyback บน cache เดิม

**วิธี merge:** สร้าง branch `merge/q3-commission-on-main` จาก main → ย้ายไฟล์ใหม่ล้วนๆ ตรงๆ (`07c_qnrr_view.js`, CSV parser, SQL files) → ไฟล์ที่ทับซ้อนกันเริ่มจาก main's version แล้วเพิ่ม quarterly logic เข้าไป → merge เข้า main จริง

รายละเอียดเต็มอยู่ที่ `docs/MAIN_VS_PREVIEW_MERGE_ANALYSIS.md` (เก็บไว้อ่านประกอบ ไม่ต้องแก้ต่อ)

---

## 3. บั๊กที่เจอ+แก้หลัง merge (v837-v847)

### 3.1 Ghost bar UX (กราฟ QNRR เดือนปัจจุบันทะลุกรอบ/มองไม่เห็น)

| v | ปัญหา | แก้ |
|---|---|---|
| v837 | Ghost bar (เส้นประ run-rate projection) สูงเกินกรอบกราฟ โดน `overflow:hidden` ตัดหัว | Cap ความสูง ไม่ให้เกิน chart area |
| v838 | Cap แล้วแต่ยังมองไม่เห็น — opacity จริงเหลือแค่ ~18% (animation floor .45 × border alpha .40) | เพิ่ม opacity ทุกจุด, ย้าย low-confidence indicator จาก opacity (ไม่มีผลเพราะ animation ทับอยู่) ไปใช้สีขอบแทน |
| v839 | ยังชิดขอบ (hardcode `chartH=112` vs ของจริงที่ render `109.5px` ต่างกัน 2.5px) + ดีไซน์ดูแยกจาก bar จริง | เพิ่ม buffer 4→10px, ทำมุมบนของ bar จริงให้เหลี่ยมเวลามี ghost ต่อด้านบน (ไม่ให้ดูเป็นคนละก้อน) |
| v840 | เพิ่มพื้นที่กราฟทั้งหมดตามคำขอ | `.qnrr-bars-row` 178px→208px, `chartH` 112→142px (สัดส่วนเดิม) |

**บทเรียน:** `chartH` เป็น magic number ที่ผูกกับ CSS แบบเปราะบาง — ถ้าแก้ CSS เมื่อไหร่ต้องเช็คเลขนี้ด้วยเสมอ ยังไม่ได้ทำเป็น dynamic measurement

### 3.2 VP/TL scope ไม่ควรเห็น KAM↔KAM transfer (แต่เห็น) — ระบบ QNRR

| v | ปัญหา | แก้ |
|---|---|---|
| v840 | VP scope (`scope='admin'` และ `scope='tl'` แบบไม่มี squad) ไม่เคย neutralize transfer เลย เพราะเช็ค "same squad" ด้วย `myTlEmail` ที่ว่างเปล่าสำหรับ Admin ตัวจริง | เพิ่ม `isOrgWideView` check + neutralize เฉพาะ KAM↔KAM ล้วนๆ (เช็ค `base_portfolio`/`current_portfolio`) |
| v841 | บั๊กเดียวกันเกิดที่ TL-squad scope ด้วย (`sameTeam` เช็คแค่ TL email ตรงกัน ไม่เช็ค portfolio type) — ทำให้ ADMIN→KAM transfer ถูกกลืนเข้า core_nrr ผิดๆ ที่ TL ปลายทาง | เพิ่มเงื่อนไข `isPureKamMove` แบบเดียวกัน |
| v842 | เพิ่มความชัวร์ | ใช้ `transfer_scope` field เป็น signal สำรองคู่กับ portfolio field |
| v844 | List view ของ QNRR ไม่มีตัวกรอง "Transfer in" เลย (มีแค่ Transfer out ที่ inject ไว้ตั้งแต่ v776) | เพิ่ม chip "Transfer in" คู่กัน |

### 3.3 "พอร์ตของฉัน" การ์ดหลัก โชว์ Transfer out ผิด — ระบบเก่าคนละตัว (สำคัญที่สุด — ใช้เวลานานสุด)

**นี่คือคนละระบบกับ QNRR (`bulkQnrrData`) เลย** — การ์ด "พอร์ตของฉัน" ใช้ฟังก์ชันเก่า `_tgtComputeKamNRR()` (`07b_nrr_target.js`) อ่านข้อมูลจาก `window.bulkCurrentMovementData` (มาจากไฟล์ CSV **คนละไฟล์** ชื่อ `portview_current_movements.csv`) แก้ QNRR ไปเท่าไหร่ก็ไม่กระทบระบบนี้เลย

| v | สมมติฐาน (ผิด) | สิ่งที่เจอจริง (ยืนยันด้วย console + CSV) |
|---|---|---|
| v843 | คิดว่า `allAccounts.length===0` สำหรับ Admin แล้วโค้ดไปเดาชื่อ KAM ผิด | ยืนยันว่า `_hasRealOwnAccounts` ที่เพิ่มถูกต้อง แต่ premise ผิด — Admin มี `allAccounts.length>0` จริง (เหตุผลไม่ทราบแน่ชัด) |
| v845 | เพิ่ม `_hasRealOwnAccounts` แยกจาก v_stab1 fallback pollution | Logic นี้ถูก แต่ยังไม่ตัดปัญหาเพราะ code ไปเข้า path การเดาชื่อ (name fallback) อยู่ดี |
| v846 | ตัดการเดาชื่อทิ้ง เหลือ match ด้วย email ตรงๆ เท่านั้น | ยืนยันด้วย console ว่า raw row `kamEmail` **ไม่ใช่** admin เลย (เป็น `napat.k@freshket.co`) — แปลว่าปัญหาไม่ได้อยู่ที่การ match แล้ว |
| v847 ✅ | **สาเหตุจริง:** เมื่อ Admin ดูภาพรวม เรียกฟังก์ชันแบบ `kamEmail=null, tlEmail=null` (org-wide) ซึ่งตกไปที่ branch `else { transferOutList = allToRows; }` — **โชว์ทุกแถวไม่กรองอะไรเลย** เพราะระบบนี้ไม่เคยมี concept "VP ไม่ควรเห็น KAM↔KAM" ตั้งแต่ต้น (คนละเรื่องกับ QNRR ที่มี concept นี้อยู่แล้ว) | เพิ่ม filter เดียวกับ QNRR: ซ่อนเฉพาะ pure KAM↔KAM (`ownerFromType==='KAM' && ownerToType==='KAM'`) ตอน org-wide scope |

**บทเรียนสำคัญที่สุดของ session นี้:** เดาจากอ่านโค้ดอย่างเดียวผิดมา 4 รอบติด (v843-v846) กว่าจะเจอ v847 ที่ถูกจริง เพราะมี**หลาย fallback ซ้อนกัน** (v_stab1, Q10 Apr fallback, name-based matching) ทำให้ไล่ตาม logic ด้วยตาเปล่ายาก — **พอ Bucci ช่วยรัน `console.log` 2-3 คำสั่งกับส่ง CSV จริงมาให้ดู ถึงเจอคำตอบทันที** ครั้งหน้าถ้าเจอบั๊กที่ "แก้แล้วยังไม่หาย" เกิน 1-2 รอบ ควรขอดูค่าจริงจาก console/ไฟล์ทันที ไม่ควรเดาต่อ

### 3.4 NRR formula — transfer_in ทำให้สมมาตรกับ transfer_out (v845, ตัดสินใจโดย Bucci)

**ก่อนแก้:** transfer_out หักฐาน (denominator) ออก แต่ transfer_in ไม่กระทบทั้งตัวเศษและตัวหารเลย — แค่โชว์เป็นยอดแยกใน "Total GMV" เฉยๆ ทำให้พอร์ตที่ได้รับ transfer_in ก้อนใหญ่ "หลุด" การติดตามผลงาน (ได้ GMV เพิ่มแต่ NRR% ไม่ขยับ)

**หลังแก้:** transfer_in บวกเข้าฐาน (denominator) **และ** นับ curr_gmv เข้าตัวเศษด้วย — สมมาตรกับ transfer_out ทุกประการ (คำนวณระดับไตรมาส ไม่แยกเดือน เหมือนกับ transfer_out เดิม)

โค้ด: `src/07c_qnrr_view.js` — เพิ่ม `coreTransferInSet`/`transfer_in_base_norm`/`transfer_in_base_gmv`, แก้ `base_norm = base_norm_original - transfer_out_base_norm + transfer_in_base_norm`, แก้เงื่อนไขตัวเศษให้รวม `mv === 'transfer_in'`

---

## 4. Design decision ที่ตัดสินใจไปแล้ว session นี้ (ไม่ต้องถามซ้ำ)

| เรื่อง | มติ |
|---|---|
| Pace/Run-rate (%, ON TRACK/MONITOR/AT RISK) ใช้ baseline คนละตัวกับ NRR (rolling 3 เดือน vs เดือนฐานไตรมาส) | **ปล่อยไว้แบบเดิม ไม่แก้** — เป็นคนละ metric กันโดยตั้งใจ |
| Transfer in ต้องกระทบ NRR เหมือน transfer out | **ทำแล้ว (v845)** — สมมาตรกันแล้ว |
| Transfer ที่เกี่ยวกับ PM/ADMIN/SALE (ไม่ใช่ KAM↔KAM ล้วนๆ) ที่ VP scope | **ยังไม่ตัดสินใจ** — ตอนนี้ยังคงแสดงที่ VP scope (ไม่ neutralize) เพราะถือเป็นการเปลี่ยนประเภทพอร์ตจริง ไม่ใช่แค่ย้าย KAM — ถ้าอยากให้ซ่อนด้วยต้องบอกเพิ่ม |
| Churn วัดแบบ GMV-weighted เท่านั้น | (ตัดสินใจไปนานแล้วจาก session ก่อนหน้า) ไม่ใช้ head-count % |
| 11 ร้าน staff_owner="Admin Freshket" | ปิดถาวร เป็นเรื่อง Commercial Ops ไม่ต้องหยิบมาถามอีก |

---

## 5. ไฟล์ที่แก้ทั้งหมดใน session นี้ (v835-v847, บน `main`)

| ไฟล์ | แก้เรื่องอะไรบ้าง |
|---|---|
| `src/07a_commission_engine.js` | v835: config default fixes + fail-loud target_settings load |
| `src/07c_qnrr_view.js` | v837-842, v844, v845: ghost bar, VP/TL transfer neutralization, transfer_in symmetric NRR, list view chip |
| `src/styles_qnrr.css` | v837-840: ghost bar visual fixes, chart height |
| `src/07b_nrr_target.js` | v843, v845-847: legacy "การเคลื่อนไหวพอร์ต" transfer attribution bug |
| `sql/*` | Session ก่อนหน้า (merge เข้ามาแล้ว ไม่ได้แก้เพิ่ม session นี้) |

**ทุกครั้งที่แก้:** push src → rebuild `index.html` ผ่าน `build.py` → bump `sw.js` CACHE_NAME → verify ผ่าน git blob API (ไม่ใช่ raw.githubusercontent หรือ Contents API เพราะไฟล์ >1MB จะโดนตัด content เงียบๆ)

---

## 6. Known open items (ยังไม่ได้ทำ ไม่ใช่ลืม)

- **G1 (lock-guard browser test):** waived โดย Bucci — ไม่ major พอที่จะบล็อกอะไร
- **M-1 (ELSE fallback ไม่ตรงกันระหว่าง rep_view.sql กับอีก 4 ไฟล์):** ตั้งใจปล่อยเป็น known limitation
- **PM/ADMIN/SALE transfer ที่ VP scope:** ยังไม่ neutralize (ดู section 4)
- **`chartH` ยังเป็น hardcode ผูกกับ CSS:** ยังไม่ได้ทำเป็น dynamic measurement (เสี่ยงเกิดปัญหาเดิมถ้า CSS เปลี่ยนอีก)
- **Full-quarter-close test:** ยังทำไม่ได้จนกว่าจะถึงเดือนปิดสมบูรณ์เดือนแรก (ต้นเดือน ส.ค. 2026)

---

## 7. Session หน้า (ตามที่ Bucci บอกไว้)

Bucci จะเก็บงาน 2 เรื่องต่อ:
1. **UX/UI** — น่าจะต่อจากงาน ghost bar (chartH dynamic measurement เป็นตัวเลือกที่ค้างไว้), หรือจุดอื่นที่เจอระหว่างใช้งานจริง
2. **การคำนวณ %NRR** — เดาว่าอาจต่อยอดจากที่เพิ่งทำ (transfer_in symmetric) หรือรีวิวสูตรทั้งหมดอีกรอบ

**แนะนำให้ session หน้าเริ่มจาก:** อ่าน handoff นี้ทั้งไฟล์ก่อน โดยเฉพาะ section 3.3 (บทเรียนเรื่องการเดา vs ขอข้อมูลจริง) — ถ้าเจอบั๊กที่ซับซ้อน/แก้แล้วไม่หาย ให้ขอ live console value หรือไฟล์ข้อมูลจริงเร็วๆ แทนการไล่อ่านโค้ดเดาต่อเนื่องยาวๆ
