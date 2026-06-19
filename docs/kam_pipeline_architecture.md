# KAM & AD Pipeline Feature — Architecture & UX Design
**Freshket Sense · Draft v1 · June 2026**

---

## 1. Context: ตำแหน่งของ feature นี้ใน Sense

### Current nav structure (KAM/AD roles)
```
Bottom nav: [พอร์ต] [ร้าน] [Echo] [Save] [Skills]
              portview  restaurant  echo-kam  opportunities  skills
```

KAM/AD มี 5 tab ปัจจุบัน:
- **พอร์ต** (`portview`) — ดู portfolio ทั้งหมด, account health, pace signal
- **ร้าน** (`restaurant`) — account-level detail (เปิดได้ต่อเมื่อเลือก account แล้ว)
- **Echo** (`echo-kam`) — conversation intelligence
- **Save** (`opportunities`) — Sense AI, opty note แบบเดิม (กำลัง rebrand เป็น pipeline)
- **Skills** (`skills`) — skill tracker

### Pipeline feature จะ "นั่ง" ตรงไหน?

**Pipeline ไม่ใช่ tab ใหม่** — มันคือ layer ที่ขยายออกจาก context ที่มีอยู่แล้ว 2 จุด:

```
จุดที่ 1: พอร์ต tab (portview)
  → Account card แต่ละใบ จะมี opty count badge
  → กด account → เข้า account detail → เห็น opty/pipeline ของ account นั้น

จุดที่ 2: Save tab (opportunities) — rename เป็น Pipeline
  → ปัจจุบัน: Sense AI entry point
  → หลัง feature นี้: เป็น Pipeline hub (planning view ส่วนตัวของ KAM)
  → Sense AI ย้ายไปเป็น sub-section ใน pipeline hub
```

---

## 2. User Journey Map — ครบทุก role

### 2A. KAM Rep (daily flow)

```
MORNING: เปิด Sense → พอร์ต tab
  → เห็น account list พร้อม opty badge (e.g. "3 opty · 1 hot")
  → เลือก account ที่จะไปวันนี้ → เข้า ร้าน tab

IN-STORE / ร้าน tab:
  → เห็น account health (GMV, SKU, pace)
  → เห็น opty notes ของ account นี้ (ถ้ามี)
  → หลังจาก conversation → เพิ่ม opty note ใหม่ได้เลย
  → ถ้า note เดิมพร้อม → กด "Turn into pipeline" → set temp + close date

PLANNING: เปิด Pipeline tab (Save)
  → เห็น portfolio pipeline summary (est GMV รวม, # active)
  → เห็น list เรียงตาม urgency (hot → warm → cold)
  → check progress vs planned
```

### 2B. AD Rep (เหมือน KAM แต่ portfolio ต่างกัน)

```
AD ดูแล SA/MC tier ที่ยังไม่ใหญ่พอเป็น KA
Flow เหมือนกันทุกอย่าง — แค่ account type และ portfolio size ต่างกัน
```

### 2C. TL (team management flow)

```
เปิด Sense → พอร์ต tab → กด "Team view" (ถ้า TL)
  → เห็น portfolio rollup ของทีม
  → แต่ละ KAM row มี opty count + est pipeline GMV
  → กด KAM คนใดคนหนึ่ง → drill-down ดู pipeline ของคนนั้น

Pipeline tab (TL view):
  → toggle: ของฉัน | ทีมทั้งหมด
  → team view: เรียงตาม KAM → per account → per opty
  → เห็น win rate ของแต่ละ KAM
  → เห็น accounts ที่ไม่มี opty note เลย (blind spots)
```

### 2D. Admin

```
Pipeline tab:
  → filter by squad / TL / KAM
  → override expire date ได้
  → reassign opty เมื่อ KAM ย้าย account
```

---

## 3. Screen-level UX — ออกแบบแต่ละ screen

### Screen A: พอร์ต tab — เพิ่ม opty signal ลง account card

**ปัจจุบัน:** account card มี pace signal + GMV + SKU count  
**เพิ่ม:** opty badge เล็กๆ บน card

```
[Card: iBerry Group]
  GMV ฿1.2M · Pace 94% WARN
  [1 hot · 2 opty]          ← เพิ่มตรงนี้ (เล็กมาก ไม่รบกวน primary info)
```

Design decision:
- ถ้า 0 opty → ไม่แสดงอะไร (ไม่ judge ให้เห็น clearly)
- ถ้ามี opty → badge เล็ก สี neutral
- ถ้ามี pipeline active hot → badge highlight สี warn/danger เพื่อบอกว่า "ต้องติดตาม"
- ถ้า pipeline expired → badge สีแดงบอก "missed"

### Screen B: ร้าน tab (account detail) — เพิ่ม Opty section

**ปัจจุบัน:** account detail มี GMV chart, SKU movement, Sense AI, churn signals  
**เพิ่ม:** "Opportunity Pipeline" section ใหม่ ต่อท้าย (ไม่ disrupt existing)

```
[Account: iBerry Group]
─── GMV / SKU / Pace ─── (existing)
─── Churn signals ─────── (existing)
─── Sense AI ──────────── (existing)

─── OPPORTUNITY PIPELINE ─── (ใหม่)
  [+ Add opty note]
  
  กุ้งขาว · est ฿120K/mo
  HOT · Close 30 Jun · 87 วันคงเหลือ
  
  อาโวคาโด · est ฿85K/mo  
  NOTE (ยังไม่ turn into pipeline)
```

Design decision:
- Section นี้ collapse ได้ (ถ้า 0 opty → แสดง empty state "ยังไม่มี opty note")
- "Add opty note" FAB-like button — ไม่ใช่ fixed FAB แต่อยู่ใน section
- แต่ละ opty row กด expand → เห็น reason note + actual vs est (ถ้า pipeline)
- ไม่เปิด sheet ใหม่ — expand inline เพื่อ keep context

### Screen C: Pipeline tab (Save → rename "Pipeline")

**โครงสร้างหลักของ tab นี้:**

```
[Pipeline tab]
  
  ─ Hero KPI strip ─
    Est. GMV    Active    Hot    Win rate Q2
    ฿680K         7        3      62%
  
  ─ My pipeline ─
    [sub-toggle: WIP | Notes | History]
    
    WIP view: (เรียง hot → warm → cold → expiring soon)
      Row: iBerry — กุ้งขาว — HOT — Close 30 Jun — ฿120K
      Row: Sarnies — อาโวคาโด — HOT — Close 20 Jun [!expire 12 Jul]
      ...
    
    Notes view: (opty ที่ยังไม่ turn into pipeline)
      Row: Breakfast Story — นมสด — ฿40K
      ...
    
    History view: (win/loss/expired — trailing 90 days)
      Row: [WIN] Sarnies — ปลาแซลมอน — 97% attainment
      Row: [EXP] Hotpot Man — Wagyu — expired
  
  ─ Planning vs Actual (Month summary) ─
    เดือน Jun 2026:
    Pipeline est: ฿280K | Actual match: ฿210K | 75%
    [bar chart หรือ inline row — ยังไม่ตัดสินใจ]
  
  ─ Sense AI (ย้ายมาเป็น sub-section ─
    [คล้ายกับ existing Save tab แต่ context = pipeline]
```

### Screen D: TL view — pipeline rollup

**TL เห็นใน Pipeline tab (toggle "ทีมทั้งหมด"):**

```
[Pipeline tab — TL mode]
  
  ─ Team KPI ─
    Team est GMV: ฿3.2M | Active: 42 | Blind spots: 8 accounts (0 opty)
  
  ─ Per KAM summary ─
    [Monet] 7 active · ฿680K est · 62% win rate · 0 blind spots
    [Jane]  4 active · ฿340K est · 58% win rate · 3 blind spots ⚠
    [Pop]   5 active · ฿520K est · 70% win rate · 1 blind spot
    ...
  
  ─ กด KAM → ดู pipeline detail ของคนนั้น (drill-down) ─
```

---

## 4. Component Inventory — อะไรต้องสร้างใหม่

### 4A. Components ที่เพิ่มลง existing screens

| Component | Screen | Complexity |
|-----------|--------|-----------|
| Opty badge บน portview account card | พอร์ต | Low |
| Opty section ใน account detail | ร้าน | Medium |
| Opty inline form (add note) | ร้าน | Medium |
| Turn-into-pipeline sheet | ร้าน → overlay | Medium |

### 4B. Pipeline tab (ใหม่ทั้ง tab)

| Component | Note |
|-----------|------|
| Pipeline KPI strip (inline, no cards) | ใช้ `.sv-ki` pattern |
| Pipeline list (WIP/Notes/History sub-toggle) | ใช้ `.sv-ol-row` + `.sv-ol-ind` pattern |
| Pipeline row expand (inline detail) | ไม่ใช่ sheet — expand in-place |
| Planning vs Actual month bar | Simple inline bar |
| TL team view (per-KAM rows) | ใช้ teamview pattern |
| Add opty note bottom sheet | ใช้ `.sv-sheet` pattern |
| Turn into pipeline bottom sheet | ใช้ `.sv-sheet` pattern |

---

## 5. Data Flow & Entry Points

### จาก user action → ถึง database

```
User กด "+ opty note" (จากที่ไหนก็ได้)
  → bottom sheet: เลือก item family + subclass + est GMV + reason
  → save → INSERT kam_opportunities (state='note')
  → badge บน portview card อัพเดท

User กด "Turn into pipeline" 
  → bottom sheet: set temperature + expected_close
  → save → INSERT kam_pipelines (state='wip'), UPDATE opty state='active'
  → row ปรากฏใน Pipeline tab WIP view

Background (nightly batch):
  → BigQuery → match actual order GMV ต่อ item family/subclass
  → UPDATE kam_pipeline_outcomes
  → ถ้า actual ≥ 80% est → auto-mark WIN
  → ถ้า expire_date ผ่าน → auto-mark EXPIRED

User กด "Mark loss":
  → UPDATE pipeline state='loss', closed_at=now
  → ย้ายไป History view
```

---

## 6. UX Decisions ที่ต้องตัดสินใจ (Open questions)

### Q1: Pipeline tab เป็น tab ใหม่ หรือ rename Save?
- Option A: Rename "Save" → "Pipeline" — ง่าย แต่ Sense AI หายไปจาก nav label
- Option B: Save tab = Pipeline hub, Sense AI เป็น sub-section ใน tab นั้น
- Option C: Pipeline เป็น tab ใหม่ (tab 6) → nav แน่นขึ้น
- **แนะนำ: Option B** — Save tab กลายเป็น "Plan" หรือ "Pipeline" ที่ Sense AI อยู่ใน

### Q2: Opty note ใน ร้าน tab — แสดงแค่ของ account นั้น หรือ cross-account?
- เฉพาะ account context เท่านั้น (ตาม account detail screen)

### Q3: TL drill-down — push new screen หรือ overlay?
- ใช้ existing portview drill-down pattern (push screen, ไม่ใช่ overlay)

### Q4: Blind spot alert — active push หรือ passive display?
- Phase 1: passive display ใน TL pipeline view
- Phase 2: Echo integration แจ้ง TL ระหว่าง conversation

### Q5: Item catalog source
- Phase 1: hardcoded dropdown (top 20 family + subclass ที่ใช้บ่อย)
- Phase 2: load จาก R2 CSV (sync จาก BigQuery)

### Q6: "Turn into pipeline" — ต้อง set close date ก่อนเสมอ?
- ต้อง — close date บังคับ เพราะ expire date = close date + 90 วัน
- ถ้าไม่รู้ → default = end of current quarter

---

## 7. What We're NOT Building (Phase 1 scope)

- ❌ Auto-suggestion opty จาก AI (เพิ่ม phase 2)
- ❌ Push notification เมื่อ pipeline ใกล้ expire
- ❌ Cross-KAM opty visibility (rep เห็นแค่ของตัวเอง)
- ❌ Opty ที่ granularity ต่ำกว่า subclass (เช่น specific SKU)
- ❌ Pipeline GMV forecast ที่ aggregate ระดับ portfolio manager

---

## 8. Touch Points กับ Feature อื่นใน Sense

| Feature ปัจจุบัน | Touchpoint กับ Pipeline |
|------------------|------------------------|
| Commission (upsell P1/P3) | Pipeline WIN = potential upsell commission. same item family/subclass grain |
| QNRR | Pipeline est GMV ช่วยคาดการณ์ NRR ไตรมาสหน้า |
| Echo (conversation intel) | After Echo session → suggest opty note ตาม keywords ที่ detect ได้ |
| Portview account card | Opty badge สะท้อนความ active ของ KAM ต่อ account นั้น |
| Teamview | TL เห็น pipeline health ของทีมใน teamview |
| Skills | Pipeline win rate เป็น signal สำหรับ skill assessment ด้าน expansion |

