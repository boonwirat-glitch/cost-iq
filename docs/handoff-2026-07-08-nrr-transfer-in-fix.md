# Handoff — /nrr transfer_in double-count fix (nrr_v10) · 2026-07-08

## บั๊กที่แก้

`_qnrrCompute` นับฐาน มิ.ย. ของร้านที่ `transfer_in` เข้ามา **ซ้ำ 2 ครั้ง** เมื่อ transfer เกิดใน
**เดือนแรกของไตรมาส**:

1. ครั้งที่ 1 — แถว transfer_in (base_gmv > 0 เสมอ = ฐานภายใต้เจ้าของเดิม) หลุดเข้า `baseMap`
   ตอนสร้างฐานคอฮอร์ตจากแถวเดือนแรก (เงื่อนไขเดิมกันแค่ `handover`)
2. ครั้งที่ 2 — symmetric transfer_in adjustment (`base_norm = original − out + in`) บวกซ้ำอีกรอบ

design เดิม (comment v776 ใน `src/07c_qnrr_view.js`) ระบุชัดว่าร้าน transfer_in "**ไม่อยู่ใน
baseMap**" — สมมตินี้พังครั้งแรกใน Q3 2026 เพราะมีการโยกร้าน PM/ADMIN→KAM ล็อตใหญ่
**44 ร้าน ฐานรวม ฿2,344,572** ในเดือน ก.ค. (เดือนแรกของไตรมาสพอดี)

ผู้พบ: Boonwirat สังเกตว่าฐาน 6.8M ของ KAM Tape กับรายการร้านใน drill-down ไม่ reconcile กัน
(~535K หาไม่เจอ) → cross-check กับ CSV จริงยืนยันว่า 466K ในนั้นคือฐานที่ถูกนับซ้ำ ไม่ใช่ร้านไหนเลย

## การแก้ (nrr_v10)

`src/nrr/nrr_logic.js` — 2 จุด + header:

- `_qnrrCompute` baseMap build: เพิ่ม `&& _effectiveMovement(r) !== 'transfer_in'`
  (ใช้ **effective** movement — การย้าย KAM↔KAM ทีมเดียวกันที่ tl/admin scope ถูก reclassify
  เป็น core_nrr และ**ต้องอยู่ใน baseMap ต่อไป** เพราะเป็นร้านของ scope นั้นตั้งแต่เดือนฐานแล้ว)
- `nrrComputeRowsPool` baseMap build: เพิ่ม `&& effMv(r) !== 'transfer_in'` — บั๊กเดียวกัน
  โผล่ใน PM view (pm_view.csv มี transfer_in ขาเข้า 5 ร้าน ฐาน 239,313)
- header: บันทึก intentional divergence จาก `07c_qnrr_view.js` จนกว่าฝั่ง Sense จะแก้ตาม

## ตัวเลขก่อน → หลัง (ยืนยันด้วยการรันโค้ดจริงกับ CSV จริง — PASS ทุกข้อ)

### REP (kam scope) — กระทบ 10 คน
| KAM | TL | ร้าน tin | ฐานเดิม (ผิด) | ฐานใหม่ (ถูก) | NRR% |
|---|---|--:|--:|--:|---|
| Anusorn (Bookbig) | Name | 6 | 10,176,426 | 9,725,947 | 100→**105** |
| Chaklid (Dent) | Name | 2 | 8,842,548 | 8,676,597 | 113→**115** |
| Napat (To) | Name | 8 | 13,186,319 | 12,912,733 | 109→**112** |
| Ploynitcha (Nitcha) | Name | 4 | 9,888,777 | 9,587,608 | 113→**116** |
| Rinlaphat (Mild) | Name | 12 | 9,327,767 | 9,038,963 | 100→**103** |
| Intuon (Jane) | Ploy | 1 | 9,631,629 | 9,561,148 | 105→**106** |
| Niracha (Cream) | Ploy | 2 | 8,446,880 | 8,290,810 | 98→**100** |
| Puttipong (Tape) | Ploy | 7 | 6,793,257 | 6,326,715 | 92→**99** |
| Treerak (May) | Ploy | 1 | 6,424,081 | 6,354,434 | 105→**106** |
| Warissara (Ply) | Ploy | 1 | 10,323,463 | 10,221,620 | 111→**112** |

### TL / Org / VP / PM
| ระดับ | ฐานเดิม | ฐานใหม่ | NRR% |
|---|--:|--:|---|
| TL Name (nitipat.s) | 78,141,099 | 76,661,110 | 107→**109** |
| TL Ploy (pavarisa.mu) | 59,979,797 | 59,115,214 | 103→**105** |
| Org KAM (admin) | 138,275,711 | 135,931,139 | 105→**107** |
| VP (pooled) | — ไม่เปลี่ยน — | | **108** (ไม่มี transfer_in ใน vp_view — sanity check ผ่าน) |
| PM chain | | | 115→**116** |
| PM sa_mc | | | 100→**101** |
| Admin view (chain/sa_mc) | — ไม่เปลี่ยน — | | ไม่มี transfer_in |

KAM ที่ไม่มี transfer_in: เลขไม่ขยับเลย (ตรวจแล้ว เช่น duangruedee.bu tin=0)

### รายชื่อ transfer_in ทั้ง 44 ร้าน (ฐาน มิ.ย. ภายใต้เจ้าของเดิม)

| TL | KAM | outlet | ร้าน | จาก | ฐาน มิ.ย. |
|---|---|---|---|---|--:|
| Name | Bookbig | 161173 | Anantasila | PM | 164,919 |
| Name | Bookbig | 176873 | เลอ เพร็ฟ กรุ๊ป | PM | 157,031 |
| Name | Bookbig | 183226 | Gaysorn Urban Resort | PM | 61,331 |
| Name | Bookbig | 208390 | SKY LOBBY | PM | 46,599 |
| Name | Bookbig | 183145 | 1823 Tea Lounge by Ronnefeldt | PM | 12,005 |
| Name | Bookbig | 183214 | Riedel | PM | 8,594 |
| Name | Dent | 186887 | กะพริบ - ครัวกลาง | PM | 96,436 |
| Name | Dent | 234129 | KOFUKU | ADMIN | 69,515 |
| Name | To | 225758 | GINGER FARM - Central Kitchen | PM | 53,602 |
| Name | To | 240107 | SHU DAXIA - Ship to FA | PM | 45,385 |
| Name | To | 239141 | The house 94 | PM | 38,134 |
| Name | To | 159421 | สวัสดี สาขากาญจนาภิเษก | PM | 33,907 |
| Name | To | 203425 | SHU DAXIA สาขา MBK | PM | 32,441 |
| Name | To | 226658 | GINGER FARM kitchen (Central Kitchen) | PM | 25,460 |
| Name | To | 162965 | SHU DAXIA TH - Office | PM | 22,567 |
| Name | To | 159093 | สวัสดีคาเฟ่เดอะปากเกร็ด | PM | 22,090 |
| Name | Nitcha | 145842 | Holiday Inn Resort Vana Nava Hua Hin | PM | 100,543 |
| Name | Nitcha | 229887 | InterContinental Huahin | PM | 99,208 |
| Name | Nitcha | 198532 | Fuwang Hotpot - Store | PM | 72,595 |
| Name | Nitcha | 248420 | Vana Nava Water Jungle Hua Hin | PM | 28,823 |
| Name | Mild | 229687 | โรงแรมเซินเจิ้น ทาวเวอร์ กรุงเทพฯ | PM | 124,711 |
| Name | Mild | 243847 | RAMEN ICHIBAN KEN พาร์คสีลม | PM | 31,866 |
| Name | Mild | 209102 | Scoozi Urban Pizza | PM | 22,474 |
| Name | Mild | 242994 | Yakiniki Ozawa Horumon บางแค | PM | 22,108 |
| Name | Mild | 211724 | Gyuzanmai | PM | 22,084 |
| Name | Mild | 222207 | KachaKacha Teppanyaki | PM | 19,294 |
| Name | Mild | 51313 | โอซาว่า ราเมน | PM | 17,510 |
| Name | Mild | 246377 | Big Boy Restaurant | PM | 12,771 |
| Name | Mild | 234912 | OZAWA GO โรงแรมเอเชียกรุงเทพ | PM | 5,310 |
| Name | Mild | 238515 | OZAWA x KYOUDAI โลตัสบ่อวิน | PM | 5,140 |
| Name | Mild | 237542 | OZAWA GO โลตัส สุขาภิบาล 1 | PM | 3,648 |
| Name | Mild | 208427 | OZAWA RAMEN x KARAAGE KYOUDAI พระราม | PM | 1,888 |
| Ploy | Jane | 240865 | Fav.Bangkok (Not Use) | PM | 70,481 |
| Ploy | Cream | 231597 | ชามเอก | PM | 113,825 |
| Ploy | Cream | 221870 | Shining Taste สีลมเอจ | PM | 42,245 |
| Ploy | Tape | 184151 | Carmina Restaurant | PM | 109,687 |
| Ploy | Tape | 176080 | The Spicy House Siam | PM | 87,519 |
| Ploy | Tape | 241617 | Griddle | PM | 75,893 |
| Ploy | Tape | 196938 | Taro Group8 - ครัวกลาง | PM | 75,718 |
| Ploy | Tape | 236645 | สักกะวา Sakkwa | PM | 46,616 |
| Ploy | Tape | 157318 | Taro yokocho8 | PM | 42,858 |
| Ploy | Tape | 155706 | Izakaya taro | PM | 28,251 |
| Ploy | May | 1573 | Greenmine | PM | 69,647 |
| Ploy | Ply | 235268 | Hard Rock Cafe Bangkok | ADMIN | 101,843 |

**รวม 44 ร้าน · ฐาน มิ.ย. 2,344,572 · ยอดจริง ก.ค. (7 วันแรก) 257,194**

## การ verify ที่ทำ

รันไฟล์ `src/nrr/nrr_logic.js` ตัวจริง (หลังแก้) ใน Node กับ CSV จริงจาก R2
(`sense_qnrr_2026q3.csv`, `pm_view.csv`, `vp_view.csv`) — assert 9 จุด PASS ทั้งหมด:
Tape/Bookbig/Mild (kam) · TL Ploy/Name (tl) · Org (admin) · PM chain/sa_mc · VP ไม่เปลี่ยน

## ⚠️ งานค้างฝั่ง Sense (ทำรอบถัดไป — ตกลงกับ Boonwirat แล้ว)

`src/07c_qnrr_view.js` (สูตรต้นฉบับที่ Sense ใช้) **ยังมีบั๊กนี้อยู่** — ต้องเพิ่มเงื่อนไขเดียวกัน
ที่ baseMap build (`_effectiveMovement(r) !== 'transfer_in'`) แล้ว rebuild + deploy Sense
จากนั้นลบ divergence note ใน header ของ `nrr_logic.js`

จนกว่าจะแก้: Sense จะโชว์เลขเก่า (เช่น Tape 92%) ส่วน /nrr โชว์เลขถูก (99%) —
**ให้ถือ /nrr เป็นเลขที่ถูกต้อง** สำหรับ scope ที่มี month-1 transfer_in

## Rollback

`git revert <commit นี้>` → push — CF Pages กลับ state เดิมอัตโนมัติ (read-only ทั้งหน้า ข้อมูลไม่กระทบ)
