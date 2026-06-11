# Echo State Spec — Single Source of Truth
**สร้าง:** Session 6 (v552) | **กติกา:** แก้ behavior ของ Echo ต้องแก้ spec นี้ก่อน แล้ว implement ให้ตรง spec

---

## State Dimensions

```
isTL    = _canDebrief()            → true: TL/AD_TL/Sales_TL/Admin | false: KAM/Sales/AD rep
_mainTab = 'record' | 'history'
_phase   = 'idle' | 'recording' | 'processing' | 'result'
_showPicker = true | false         (rep เท่านั้น — TL ไม่มี picker เด็ดขาด)
checkin  = none | checked-in(<90min) | expired
```

`_phase` processing/result อยู่คนละ screen (`ci-s-proc`, `ci-s-result`) — ตารางนี้คุมเฉพาะ sections ใน `ci-s-record`

## Table 1 — Section Visibility (implement ตรงตัวใน `_renderEchoState()`)

| Section | แสดงเมื่อ (AND ทุกเงื่อนไข) |
|---|---|
| `ci-chip-wrap` | record · !isTL · !picker · phase≠recording |
| `ci-visit-hero` | record · !picker · phase≠recording |
| `ci-picker-sec` | record · !isTL · picker · phase=idle |
| `ci-rec-center` (orb) | record · !isTL · !picker · phase=idle |
| `ci-covisit-panel` | record · isTL · phase≠recording |
| `ci-rec-active` | record · phase=recording |
| `ci-rec-bottom` | record · phase=recording |
| `ci-inline-hist` | history (ทุก role ทุก phase) |

**ห้าม** toggle display ของ sections เหล่านี้ที่อื่นนอกจาก `_renderEchoState()` — ฟังก์ชันอื่นเปลี่ยน state แล้วเรียก renderer

## Table 2 — Data Scope Matrix

| Role | Picker เห็นร้าน | History เห็น session | Co-visit |
|---|---|---|---|
| KAM rep | เฉพาะ `kamEmail == me` | ของตัวเอง (filter week/month/all) | เช็คอินได้ |
| Sales rep | hybrid: พอร์ตตัวเอง (`kamEmail == me`) + Lead free-text | ของตัวเอง group by ร้าน | เช็คอินได้ |
| AD rep | เฉพาะ `kamEmail == me` | ของตัวเอง group by เดือน | เช็คอินได้ |
| TL ทุกแบบ | **ไม่มี picker** (ไม่ record) | ทีมทั้งหมด (จาก tlEmail/tl_email) | verify ได้ |
| Admin | ไม่มี picker | ทีมทั้งหมด | verify ได้ |

หมายเหตุ field จริงของ `portviewBulkData`: `{id, name, accountType, kamEmail, tlEmail, gmvToDate, paceSignal, ...}` — **ไม่ใช่** `res_name`/`account_guid`/`account_type`

## Table 3 — Entry / Exit Points

| ทางเข้า | State ที่ต้อง land |
|---|---|
| `open(guid)` จาก account view | record · picker=closed · chip=ร้านนั้น · checkin restore ถ้า <90min |
| `open(null)` rep | record · picker=open |
| `open(null)` TL | record · covisit panel · picker=closed เสมอ |
| `echoHistory(id)` | history tab |
| `echoExpand()` จาก float pill | คืน state เดิมก่อน minimize |
| กลับเข้า Echo หลัง TL verify | row ที่ verify แล้วต้องเป็น Verified (อ่าน covisit_events + local cache — ห้ามพึ่ง ci_sessions flag เดียว) |

## Co-visit Verified — Source of Truth (ลำดับความเชื่อ)

1. `covisit_events.verified=true` (TL insert เอง — ผ่าน RLS เสมอ)
2. localStorage `ci_covisit_done` (kept 24h — กัน DB replication lag)
3. `ci_sessions.covisit_verified` (best-effort — TL update row คนอื่นอาจโดน RLS block)

Verified row: badge Verified · ไม่ clickable · ไม่มีปุ่ม verify ที่ไหนอีก (ปุ่มเดียว = covisit panel)

## Check-in Lifecycle

- กด orb (pin) → snapping state (pulse + "กำลังระบุตำแหน่ง...") → success: green flash + toast + pill "เช็คอิน HH:MM · ถึง HH:MM(+90นาที)"
- Persist: localStorage `ci_checkin_cache` ผูก account_guid · อายุ **90 นาที** · clear หลัง save session สำเร็จ
- เลือกร้านเดิมภายใน 90 นาที → restore pill + mic orb อัตโนมัติ (ไม่ต้องเช็คอินซ้ำ)

## CSS Contract

- **ห้าม** selector ภายนอก (styles_sales.css / styles_main.css) แตะ element ใน `#ci-fullsheet` ด้วย `!important` อีก
- Sales-mode rules ที่ครอบ `.scr`/`.topbar` ต้องมี `:not(#ci-fullsheet *)` guard เสมอ
- Echo จัดการ dark/light เองผ่าน inline style + transition ใน CSS ของตัวเอง (`09_conv_intel.js` `_CSS`)
