# Freshket Sense — Session Handoff
**Date:** 2026-06-13  
**Version deployed:** v643  
**Repo:** `github.com/boonwirat-glitch/cost-iq` · branch `main`

---

## สิ่งที่ทำใน session นี้

### Phase 0E — CSS Scoping (เสร็จสมบูรณ์)
`styles_main.css` ลดจาก **4,625L → 25L** (placeholder comments เท่านั้น)

CSS ถูก migrate ออกเป็นไฟล์ scoped ตาม screen:

| ไฟล์ | Lines | Scope |
|---|---|---|
| `styles_tokens.css` | 203L | Design tokens |
| `styles_base.css` | 117L | html/body + UX Polish globals |
| `styles_layout.css` | 510L | topbar / bnav / screen containers |
| `styles_overview.css` | 293L | #scr-overview, #kam-overview, Hero, Cards |
| `styles_save.css` | 1,371L | #scr-opportunities, Sense Gate, Plan Builder, Sense theme |
| `styles_report.css` | 373L | #scr-report, Report v1/v2 |
| `styles_aichat.css` | 80L | .aifab, .aipanel |
| `styles_portview.css` | 738L | #scr-portview, .pv-*, NRR, Sales visual cascade |
| `styles_commission.css` | 2,279L | Commission + CDS + v210g-v211c patches |
| `styles_teamview.css` | 482L | #scr-teamview, v213a-f patches |
| `styles_nav.css` | 155L | **Visual styles only** — no display logic |
| `styles_restaurant.css` | 163L | Swipe mode + rest-sheet |
| `styles_auth.css` | 140L | Login + Splash |
| `styles_echo.css` | 78L | Echo nav |
| `styles_sales.css` | 1,215L | Sales mode UI |
| `styles_skills.css` | 2,092L | Skills screen |
| `styles_main.css` | 25L | Placeholder comments only ✅ |

**กฎ:** feature ใหม่ = สร้าง `styles_{feature}.css` ใหม่ ไม่ต้องแตะไฟล์เก่า

---

### NavConfig System (เสร็จสมบูรณ์)
**File:** `src/12_nav_config.js` — single source of truth สำหรับ nav

**ก่อน:** CSS display rules 30+ rules กระจาย 4 ไฟล์ + hard code per-role  
**หลัง:** ไฟล์เดียว ไม่มี CSS display logic เหลือ

**Architecture:**
```javascript
// เพิ่ม role ใหม่ → แก้ที่นี่ที่เดียว
NAV_CONFIG['new-role'] = {
  tabs: ['portview', 'echo-kam', 'skills'],
  saveDisabledOn: ['portview', 'skills'],
}

// เพิ่ม tab ใหม่ → แก้ที่นี่ที่เดียว
TABS['new-tab'] = { id: 'nav-new-tab', hideWhen: ['sense-plan-expanded'] }
```

**Nav config ปัจจุบัน:**

| Role | Tabs | saveDisabledOn |
|---|---|---|
| rep (KAM) | พอร์ต · ร้าน · Echo · Save · ทักษะ | portview, teamview, skills |
| tl (KAM TL) | พอร์ต · ร้าน · Echo · Save · ทักษะ | portview, teamview, skills |
| admin | พอร์ต · ร้าน · Echo · Save · ทักษะ | portview, teamview, skills |
| ad | พอร์ต · ร้าน · Echo · Save · ทักษะ | portview, teamview, skills |
| ad_tl | พอร์ต · ร้าน · Echo · Save · ทักษะ | portview, teamview, skills |
| sales | พอร์ต · Pipeline · Echo · Commission · ทักษะ | — |
| sales_tl | พอร์ต · Pipeline · Echo · Commission · ทักษะ · ทีม | — |

**Hook:** `NavConfig.render(role)` ถูกเรียกใน `_autoRouteAfterLogin()` (`src/01_core.js`) ผ่าน `setTimeout(0)` เพื่อรอให้ `12_nav_config.js` load ก่อน

---

## Bug fixes ที่ทำใน session นี้

| Bug | Root cause | Fix |
|---|---|---|
| Save screen เลื่อนขวา | `body.kam-sense-active #swipe-grp-b` ใช้ `left:50%` align กับ viewport ไม่ใช่ body | `left:0; right:0; margin:0 auto` |
| Nav pill 2 ชั้น | `shell.html` หาย `INJECT_NAV_CONFIG` placeholder หลัง revert | เพิ่ม placeholder กลับ |
| Sales icon สีขาว | `body.kam-mode .bnav .ni svg{color:#fff}` ใน portview.css inject ทีหลัง nav.css | ย้าย Sales visual rules ไปท้าย portview.css |
| Sales 2 rows | `grid-template-columns: repeat(4,1fr) !important` ใน sales.css override NavConfig | ลบ rule ออก |
| Update pill ไม่โผล่ | SW `CACHE_NAME` ค้างที่ v637 หลัง revert | แก้เป็น v643 |

---

## Build Pipeline

```bash
python3 build.py vN        # → dist/sense_vN.html
# แก้ sw.js: CACHE_NAME = 'sense-vN' + comment บรรทัดแรก
# push src files + sw.js
# push index.html ผ่าน Git Tree API (large file)
```

**JS load order (สำคัญ):**
```
01_core.js → 02_data → 03_rendering → 04_sku_matcher → 05_kam_view
→ 06_portview_teamview → 07a_commission → 07b_cds → 07b_nrr_target
→ 07b_commission_cockpit → 07b_commission_history → 08_patches
→ 09_conv_intel → 10_sales_view → 11_skills → 12_nav_config (last)
```

**CSS inject order (สำคัญสำหรับ cascade):**
```
tokens → base → layout → main → [sales, skills, restaurant, echo, auth]
→ nav → portview → tv → overview → save → report → aichat
→ target-module (commission)
```

**กฎ cascade:** Sales visual rules ต้องอยู่ใน `portview.css` หรือ module ที่ inject หลัง `portview` เพราะ `body.kam-mode .bnav .ni svg{color:#fff}` อยู่ใน portview.css

---

## Lesson Learned — สำคัญสำหรับ session ต่อไป

### 1. NavConfig เป็น sole controller
CSS ไม่มีสิทธิ์ตัดสินว่า nav button ไหน display:flex/none  
**ถ้าเจอ CSS rule ที่ทำ display บน .ni หรือ #nav-* → ลบออก**

### 2. Cascade rule
```
styles_nav.css (inject ก่อน) < styles_portview.css (inject ทีหลัง)
```
Sales visual ต้องอยู่ใน portview.css ท้ายสุดเสมอ

### 3. SW CACHE_NAME
ต้องแก้ทั้ง comment บรรทัดแรก **และ** `const CACHE_NAME` ทุกครั้ง  
ถ้า CACHE_NAME ไม่เปลี่ยน → update pill ไม่โผล่

### 4. shell.html placeholder
`INJECT_NAV_CONFIG` ต้องอยู่หลัง `INJECT_SKILLS` ใน shell.html  
ถ้าทำ revert → ตรวจ shell.html ก่อนเสมอ

### 5. gridTemplateColumns
NavConfig set `bnav.style.gridTemplateColumns` โดยตรง (inline style)  
ห้ามใช้ CSS `grid-template-columns: repeat(N,1fr) !important` บน bnav — จะ override

---

## งานที่ค้างและยังต้องทำ

### ✅ Phase 0E — CSS Scoping (เสร็จแล้ว)
### ✅ NavConfig System (เสร็จแล้ว)

### 🔲 Phase 0F — Responsive Foundation
- `body { max-width: clamp(390px, 100%, 480px) }` แทน fixed 440px
- Breakpoint tokens: `--bp-mobile`, `--bp-tablet`, `--bp-desktop`
- Base responsive rules ใน `styles_layout.css`
- **Note:** ทุก fixed/absolute positioned element ต้องใช้ `left:0; right:0; margin:0 auto` ไม่ใช่ `left:50%; transform:translateX(-50%)`

### 🔲 Phase 1 — TL Web Dashboard (`/dashboard` route)
- Blocked on Phase 0F
- Option B: separate route

### 🔲 SQL2 Fix
- Re-run `SQL2_sense_alts.sql` กับ `PARTITION BY ko.account_id` (account_guid level)
- Re-export all KAM bundle CSVs to R2

### 🔲 SmartSelect regression (52→41)
- Matcher confidence-update strategy หลัง SQL2 fix

---

## Key files changed this session

```
src/12_nav_config.js      ← NEW: NavConfig system
src/styles_main.css       ← 4625L → 25L (placeholder only)
src/styles_overview.css   ← NEW
src/styles_save.css       ← NEW
src/styles_report.css     ← NEW
src/styles_aichat.css     ← NEW
src/styles_portview.css   ← updated (Sales visual cascade + sense-active)
src/styles_nav.css        ← visual only (no display rules)
src/styles_sales.css      ← removed grid-template-columns
src/styles_portview.css   ← removed nav-portview hide rule
src/01_core.js            ← NavConfig.render() call at _autoRouteAfterLogin
src/05_kam_view.js        ← nav-disabled for teamview/skills screens
src/07b_cds.js            ← normalizeProfileAndBody sets data-role all roles
src/shell.html            ← INJECT_NAV_CONFIG placeholder added
build.py                  ← all new CSS modules wired
sw.js                     ← CACHE_NAME = sense-v643
```
