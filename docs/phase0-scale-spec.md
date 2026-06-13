# Freshket Sense — UX/UI Ready-to-Scale Specification
**วันที่:** มิถุนายน 2026  
**เป้าหมาย:** เพิ่ม feature ใหม่ได้โดยไม่พังของเก่า + รองรับ screen size ใหม่ได้

---

## ภาพรวม: สภาพจริงตอนนี้

| ตัวชี้วัด | วันนี้ | เป้าหมาย |
|---|---|---|
| !important | **1,495 ครั้ง** | < 20 ครั้ง |
| Hardcoded hex ใน CSS | **835 จุด** | 0 |
| CSS unscoped selectors | **1,299 class** | 0 |
| body.X-mode selectors | 15 classes, 473 rules | ≤ 4 classes |
| Breakpoints | 360/370/380/420/430/431/601px (กระจัด) | 3 จุดชัดเจน |
| Layout zone contract | padding-bottom hardcode 4 ค่า | 1 token |
| Component pattern | innerHTML string ทุกไฟล์ | render fn มี interface |

---

## เป้าหมายจริง

### เพิ่ม feature ใหม่ได้โดยไม่พังของเก่า
Feature ใหม่เขียน CSS/JS ของตัวเองได้เลย โดยไม่ต้องกลัวชนกับ feature อื่น และไม่ต้องใช้ !important เพื่อชนะ

### รองรับ screen size ใหม่ได้
Layout reflow อัตโนมัติเมื่อ screen กว้างขึ้น (tablet 768px, desktop 1024px) โดยไม่ต้องแก้โค้ดเป็น feature-by-feature

---

## Phase ที่เหลือ

---

### Phase 0D — Layout Zone Contract
**"กำหนด zone ที่ชัด ไม่มีใคร hardcode px อีก"**

#### ปัญหาตอนนี้
- `padding-bottom: 104px` เกิดขึ้น 8 ครั้งในหลายไฟล์แยกกัน
- `--topbar-h: 44px` และ `--nav-h: 56px` มีอยู่แต่ไม่มีใครใช้
- content area height คำนวณผิดตำแหน่งในบางหน้า

#### งานที่ต้องทำ
1. เพิ่มใน `styles_tokens.css`:
   ```css
   --chrome-top:    var(--topbar-h);          /* 44px */
   --chrome-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px));
   --content-h:     calc(100dvh - var(--chrome-top) - var(--chrome-bottom));
   ```
2. แทนที่ `padding-bottom: 104px` ทุกจุดด้วย `padding-bottom: var(--chrome-bottom)`
3. แทนที่ hardcode `calc(104px + env(...))` ทุกจุดด้วย token เดียว

#### Verify Criteria
- [ ] ค้นหา `104px` ในทุก CSS file → ต้องได้ 0 ผล
- [ ] ค้นหา `padding-bottom` ใน screen CSS → ต้องใช้ token ทุกจุด
- [ ] ทุก screen scroll ถึง content ล่างสุดได้ ไม่โดน bnav บัง (ทดสอบบน iOS)

---

### Phase 0E — CSS Scoping Rule
**"feature แต่ละตัวเป็นเจ้าของ CSS ของตัวเอง"**

#### ปัญหาตอนนี้
- 1,299 unscoped selectors ใน main.css — `.tgt-bar-header`, `.comm-badge` ฯลฯ เป็น global
- เพิ่ม feature ใหม่ที่มี class ชื่อเดียวกัน → พังทันที
- !important 1,495 ครั้งเป็นผลจากปัญหานี้

#### กฎที่ต้องบังคับใช้ตั้งแต่นี้เป็นต้นไป
```
ทุก CSS rule ต้องมี scope prefix อย่างใดอย่างหนึ่ง:
  #scr-{name} .xxx        → scoped to screen
  #scr-{name} .xxx        → commission, portview, teamview
  [data-feature="xxx"]    → สำหรับ overlay / sheet
  body.{role}-mode .xxx   → role-specific override เท่านั้น (ลดจาก 473 rules)
```

#### งานที่ต้องทำ
1. **ไม่ทำ rewrite ทีเดียว** — กฎนี้บังคับใช้กับโค้ดใหม่ทุกชิ้น
2. เพิ่ม comment guard ใน `styles_layout.css` และ `styles_main.css`:
   ```css
   /* ⚠️ NEW RULES: ต้องมี scope prefix เสมอ ห้าม flat selector */
   ```
3. Feature ใหม่ทุกชิ้นต้อง scope ด้วย screen ID ก่อน ship

#### Verify Criteria
- [ ] CSS ใหม่ทุก rule ที่เพิ่มหลัง Phase 0E มี scope prefix
- [ ] !important ใน CSS ใหม่ = 0
- [ ] Run grep `.` บน CSS ใหม่ → ไม่มี flat selector

---

### Phase 0F — Responsive Foundation
**"layout รู้จักขนาดหน้าจอ และ reflow ได้"**

#### ปัญหาตอนนี้
- `body { max-width: 440px }` fixed — tablet/desktop ได้แค่คอลัมน์กลางแคบ
- Breakpoints กระจัด 7 ค่า ไม่มีระบบ
- ไม่มี grid system — layout แต่ละหน้าเขียน flex เองตามใจ

#### Breakpoint System ใหม่ (3 จุด)
```css
/* ใน styles_tokens.css */
--bp-mobile:  430px;   /* ≤ 430px = mobile (ปัจจุบัน) */
--bp-tablet:  768px;   /* 431-768px = tablet */
--bp-desktop: 1024px;  /* > 768px = desktop */
```

#### Layout Grid
```css
/* Mobile: 1 column, max 440px */
/* Tablet: body max-width 768px, content 2-column optional */
/* Desktop: body max-width 1200px, sidebar + main content */
```

#### งานที่ต้องทำ
1. เปลี่ยน `body { max-width: 440px }` → responsive ด้วย `clamp()`
2. กำหนด breakpoint variables ใน tokens
3. เขียน base responsive rules ใน `styles_layout.css`
4. แทนที่ breakpoints กระจัด 7 ค่าด้วย 3 ค่ามาตรฐาน

#### Verify Criteria
- [ ] เปิดบน iPad (768px) → layout ไม่แตก ไม่มีแถบขาวข้าง
- [ ] เปิดบน desktop Chrome → content reflow ได้ ไม่ใช่แค่คอลัมน์กลาง
- [ ] ทุก @media ใน CSS ใหม่ใช้ token variable ไม่ใช่ hardcode px
- [ ] Breakpoints ใน codebase ≤ 3 ค่า

---

## สรุป Phase Roadmap

```
Phase 0 (Foundation)
├── 0A ✅ Token system
├── 0B ✅ CSS layer split  
├── 0C ✅ data-theme system
├── 0D 🔲 Layout zone contract    (~1 วัน)
├── 0E 🔲 CSS scoping rule        (~2 วัน)
└── 0F 🔲 Responsive foundation   (~3 วัน)

Phase 1 (TL Web Dashboard)
└── เริ่มได้หลัง 0D+0E+0F เสร็จ
    → สร้างบน responsive grid ที่พร้อมแล้ว
    → scoped CSS ตั้งแต่วันแรก
    → ไม่มี !important ใหม่เลย

Phase 2 (Responsive All Roles)
└── เริ่มได้หลัง Phase 1
    → mobile screens reflow เป็น tablet/desktop อัตโนมัติ
    → ไม่ต้อง rewrite per-role
```

---

## ผลลัพธ์ที่คาดหวังหลังจาก Phase 0 สมบูรณ์

**Developer เพิ่ม feature ใหม่:**
1. สร้างไฟล์ CSS ใหม่ scope ด้วย screen ID → ไม่ชนใคร
2. ใช้ token จาก `styles_tokens.css` → สีและ spacing ถูกต้องอัตโนมัติ
3. ไม่ต้องเขียน `!important` แม้แต่ครั้งเดียว
4. Layout responsive อัตโนมัติบน mobile/tablet/desktop

**ผลลัพธ์ที่วัดได้:**
- !important ใน CSS ใหม่ = **0** (เก่ายังมี แต่ไม่เพิ่ม)
- Feature ใหม่แต่ละชิ้น CSS < **200 บรรทัด** (scoped ไม่บวม)
- Layout ทำงานบน mobile + tablet + desktop **โดยไม่แก้โค้ดเพิ่ม**
- ลบ feature ออก = ลบไฟล์ CSS ออก 1 ไฟล์ ไม่พังอะไร

