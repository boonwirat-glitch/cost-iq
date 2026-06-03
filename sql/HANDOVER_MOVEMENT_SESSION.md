# Freshket Sense — Commission Backfill Handoff
**Session date:** June 3, 2026  
**Prepared for:** Next Claude session  
**Repo:** github.com/boonwirat-glitch/cost-iq (branch: main)

---

## 1. Project context

**Freshket Sense** = Internal PWA สำหรับ KAM team (~14 คน แบ่งเป็น Squad A / Squad B)  
**Stack:** Supabase Auth + PostgreSQL · Cloudflare Pages (auto-deploy from GitHub main) · Cloudflare R2 (CSV bulk data) · BigQuery (DWH)  
**Build:** `python3 build.py v[version]` → `dist/sense_v[version].html` → copy to `index.html` → push

**Bucci** = VP Revenue, owns ทุก product/data/business decision  
**Working style:** surgical patches, verify before changing, read code before proposing — ไม่ rewrite working code โดยไม่จำเป็น

---

## 2. วิธีทำงาน (สำคัญมาก — อ่านก่อนเสมอ)

### GitHub API pattern
```python
import urllib.request, json, base64

TOKEN = "[GITHUB_TOKEN]"
REPO  = "boonwirat-glitch/cost-iq"

def fetch_blob(path):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"token {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    if data.get('encoding') == 'base64':
        return base64.b64decode(data['content'].replace('\n','')).decode('utf-8', errors='replace'), data['sha']
    # Large file: use blob API
    sha_file = data['sha']
    url2 = f"https://api.github.com/repos/{REPO}/git/blobs/{sha_file}"
    req2 = urllib.request.Request(url2, headers={"Authorization": f"token {TOKEN}"})
    with urllib.request.urlopen(req2) as r2:
        data2 = json.loads(r2.read())
    return base64.b64decode(data2['content'].replace('\n','')).decode('utf-8', errors='replace'), data['sha']

def push_file(path, content, sha, message):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    payload = {"message": message, "content": base64.b64encode(content.encode()).decode(), "sha": sha, "branch": "main"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
        headers={"Authorization": f"token {TOKEN}", "Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['content']['sha']
```

**Multi-file commit** (index.html + sw.js พร้อมกัน) ใช้ blob+tree+commit API แทน PUT ทีละไฟล์

### Deploy workflow
```bash
# ใน /home/claude/build_tmp (clone repo ไว้แล้ว)
git fetch origin main && git reset --hard origin/main
python3 build.py v[version]          # → dist/sense_v[version].html
cp dist/sense_v[version].html index.html
sed -i "s/freshket-sense-v[old]/freshket-sense-v[new]/" sw.js
# verify: grep "CACHE_NAME" sw.js
# push index.html + sw.js ด้วย multi-file commit
```

### Patch workflow (surgical)
1. `fetch_blob(path)` → ได้ content + sha
2. grep/search หา OLD string ที่จะแก้ → ยืนยัน `OLD in content`
3. `content.replace(OLD, NEW, 1)` → ยืนยัน `NEW in patched` และ `OLD not in patched`
4. `push_file(path, patched, sha, message)`
5. ถ้าแก้ JS: rebuild index.html + bump SW cache name ทุกครั้ง

### JS syntax check ก่อน push เสมอ
```bash
node --check /tmp/filename.js && echo "✓ OK"
```

### ข้อผิดพลาดที่เคยเจอ
- Template literals ใน JS ห้าม nested backtick — ถ้าต้องการ ternary ใน `body.innerHTML = \`...\`` ให้ split เป็น string concatenation แทน
- BigQuery CTE ต้องเรียงตาม dependency — forward reference ไม่ได้
- CTE ชื่อชนกับ reserved/system table ใน BigQuery → rename เพิ่ม suffix `_per_outlet` หรือ `_agg`
- openpyxl read_only mode: trailing empty cells ถูกตัดออก → ใช้ `make_row()` แบบ index-safe เสมอ

---

## 3. สถานะปัจจุบัน

### App
- **Deployed:** v290 · SW: `freshket-sense-v290` · commit: `28c864964f8f`
- **Snapshot branch:** `snapshot/pre-commission-lock-v287`

### Commission architecture (v288–v290)
- `computeCommissionDraft(periodOverride)` — save status='draft', รองรับ period override สำหรับ backfill
- `lockCommissionSnapshot(period)` — draft→final, ไม่ recompute
- `exportCommissionSnapshotCsv(period)` — อ่านจาก stored rows
- Cockpit Step 5: subtab `[เดือนนี้] [Retroactive]`
  - Retroactive: dropdown 12 เดือน, Compute draft / Export CSV / Lock Final
  - `_commRenderRetroactiveSection()` ใน `src/07b_commission_cockpit.js`
- History tab: แถวเดือนนี้ live ที่บนสุด (v289)

### SQL files ที่เกี่ยวข้อง
| File | Purpose | Status |
|---|---|---|
| `sql/May2026_KAM_portfolio_reconcile.sql` | Outlet-level movement + commission components | **v8 — validated** |
| `sql/NRR_backfill_May2026.sql` | NRR per KAM summary (เก่ากว่า ใช้ reconcile แทนได้) | Done |
| `sql/q3c_upsell_team_summary_v4.sql` | P1/P3 upsell per KAM (current month) | ต้อง override May |
| `sql/Q10_commission_handover_final.sql` | Handover portview (current month) | ต้อง override May |
| `sql/Q11_current_movements_v2.sql` | Movement classification (current month) | ใช้ user_master — ระวัง May backfill |

---

## 4. Commission logic — validated แล้ว (อย่า re-derive)

### Movement classification (SQL v8 — ground truth)
| movement_type | เงื่อนไข | commission |
|---|---|---|
| `core_nrr` | same KAM Apr=May + apr_gmv>0 + may_gmv>0 | นับใน NRR base |
| `core_nrr_churn` | same KAM + apr_gmv>0 + may_gmv=0 | ทำ NRR ลด |
| `expansion` | `first_dollar_date` ใน May 2026 + commercial_owner=KAM | GMV × 1.5% |
| `comeback` | `first_dollar_date` ก่อน May + apr_gmv=0 + apr_commercial≠KAM | ไม่นับ |
| `handover_perf` | จาก SALE + `sales_handover_month`='2026-04' | retention% → tier |
| `new_sales` | จาก SALE + `sales_handover_month`='2026-05' | รอวัด June |
| `transfer_in` | apr_staff_owner มีค่า หรือ apr_commercial=KAM แต่ staff_owner ว่าง | ไม่นับ NRR |
| `transfer_out` | user_master ปัจจุบัน เปลี่ยน KAM | แสดงใน KAM เดิม |

**Key decisions ที่ lock แล้ว:**
- Ownership ดึงจาก `dwh.order` โดยตรง ไม่ใช่ `user_master` (handle mid-month transfer)
- `handover_perf` vs `new_sales` แยกด้วย `sales_handover_month` = FORMAT_DATE('%Y-%m', `new_user_exp_date`)
  - PATH B fallback (243439): ถ้าไม่มี `new_user_exp_date` → ดู MAX(delivery_date WHERE commercial_owner='SALE') ใน Apr/May
- `transfer_in` รวม KAM ที่ลาออก (Fang → 170447): `apr_commercial_owner='KAM'` แม้ staff_owner ว่าง
- `comeback` guard: `apr_commercial_owner != 'KAM'` (ถ้า Apr มี KAM ดูแลแต่ไม่รู้ชื่อ → transfer_in ไม่ใช่ comeback)

### NRR calculation
```
cohort = outlet ที่มี GMV > 0 ใน April (prev_month)
NRR%   = (Σ May GMV ÷ 31) ÷ (Σ Apr GMV ÷ 30) × 100
```
- transfer_in, handover_perf, comeback, expansion **ไม่เข้า NRR base** — ตรงกับ app
- App ใช้ `daysWithCurrentKam` แยก coreAccounts vs transferInAccounts ก่อนเรียก `_groupNRR()`

### Commission tiers (default — อาจ override ใน Supabase)
```
NRR:      <99%→฿0 / 99–101.9%→฿5,000 / ≥102%→฿7,500
Gate cap: <90%→0.35× / 90–94.9%→0.70× / ≥95%→1.0×
Handover: <100%→฿0 / 100–119.9%→฿2,500 / ≥120%→฿5,000
Expansion: GMV × 1.5%
```
**⚠️ Squad A/B tier ต่างกันใน Supabase — ดึงจาก `commission_rule_tiers` ก่อนใช้**

### Handover aggregation (สำคัญ)
```
Handover commission ของ KAM = รวม GMV ทุก outlet (handover_perf) ก่อน
→ retention% = (Σ may_gmv ÷ 31) ÷ (Σ apr_gmv ÷ 30) × 100
→ apply tier ครั้งเดียว (ไม่ใช่ per outlet)
```

### Gate cap — pending decision
- **App:** NRR=NULL → cap=1.0× (ไม่ penalty)
- **SQL/Excel:** NRR=NULL → cap=0.35× (penalty)
- กระทบ **Nitcha** โดยตรง (รับพอร์ตจาก Fang มาทั้งชุด ไม่มี core_nrr cohort ใน May)
- **ต้องให้ Bucci ตัดสินใจก่อน lock**

---

## 5. May 2026 backfill — ผลลัพธ์ที่ได้แล้ว

### Excel: `Commission_May2026_Freshket_v2.xlsx`
- **Sheet: Parameters** — tier settings แยก Squad A/B, gate, handover, expansion rate — ปรับได้เอง
- **Sheet: Commission Summary** — SUMIFS จาก Raw Data, Expansion GMV แยกก่อนคิดเป็นเงิน, สูตรผูกกับ Parameters
- **Sheet: Raw Data (SQL)** — outlet-level 2,839 rows, color-coded by movement_type

### ตัวเลข May (ยังไม่รวม P1/P3 และ TL)
| KAM | NRR% | Final Payout (฿) |
|---|---|---|
| Bookbig | 92.68% | 86 |
| Dent | 95.22% | 23 |
| Ning | 105.21% | 19,610 |
| Monet | 101.81% | 7,500 |
| Jane | 102.86% | 14,182 |
| To | 100.85% | 5,598 |
| Foam | 109.01% | 7,554 |
| Cream | 98.19% | 1,241 |
| Kwang | 93.68% | 150 |
| Nitcha | NULL | 72 (gate=0.35×) |
| Tape | 106.54% | 8,194 |
| Mild | 90.08% | 371 |
| Pop | 98.81% | 10,026 |
| Ply | 98.03% | 210 |
| **Total** | | **74,817** |

---

## 6. งานที่เหลือ — ลำดับแนะนำ

### Phase 1: ให้ May backfill เสร็จ (urgent)

**Task 1: P1/P3 Upsell override May**
```sql
-- q3c_upsell_team_summary_v4.sql — เปลี่ยน dates CTE:
dates AS (
  SELECT
    DATE_TRUNC(DATE('2026-04-30'), MONTH) AS baseline_mo,  -- Apr
    DATE_TRUNC(DATE('2026-05-31'), MONTH) AS current_mo,   -- May
    DATE_TRUNC(DATE('2026-02-28'), MONTH) AS lookback_start -- 3 เดือนก่อน May
)
```
Output: `p1_gmv`, `p3_incremental`, `outlet_gmv`, `tl_upsell_base` per KAM  
Commission: `p1_gmv × 3%` + `p3_incremental × 3%` + `outlet_gmv × 1.5%` (expansion via q3c)

**Task 2: TL commission SQL (ยังไม่มี)**
- NRR ทีม = aggregate outlet-level GMV ของ KAM ทุกคนใน squad
- TL payout = NRR_payout × upsell_multiplier
- TL NRR tiers (จาก app `_commDefaultTiers('tl')`):
  ```
  <98.5%→฿0 / 98.5–99%→฿5,000 / 99–100%→฿8,000
  100–102%→฿12,000 / 102–103%→฿30,000 / ≥103%→฿50,000
  ```
- TL Upsell multiplier tiers:
  ```
  <2%→1.0× / 2–2.9%→1.2× / 3–3.9%→1.35× / 4–4.9%→1.5× / ≥5%→1.8×
  ```

**Task 3: Lock เข้า Supabase**
- Cockpit → Step 5 → Retroactive tab → period `2026-05`
- Compute draft → verify → Lock Final
- Table: `commission_payout_snapshots` (lock_note='retroactive')

### Phase 2: Going Forward (App alignment)

**A. Align comeback/expansion ใน app ให้ใช้ first_dollar_date**
- ปัจจุบัน app ใช้ `everSeen` จาก Q5B ~6 เดือน → SQL ใช้ `first_dollar_date` all-time
- ไม่กระทบ NRR% (ทั้งคู่ไม่เข้า cohort) แต่ทำให้ตัวเลข category count ต่างกัน
- File: `src/07b_nrr_target.js` ใน `_groupNRR()` L163-165

**B. Double-check movement classification ทุกจุด**
- เทียบ app `_tgtComputeKamNRR()` vs `May2026_KAM_portfolio_reconcile.sql` ทีละ type
- ต้อง validate per KAM ด้วยข้อมูลจริง (export จาก app console log vs SQL result)

**C. Resolve gate cap NULL policy**
- ตัดสินใจก่อน → แก้ใน app `_commComputeGmvGate()` L439-441 (ถ้าเลือก 0.35×)
- และ/หรือ แก้ SQL สำหรับ future months

**D. Review cockpit end-to-end**
- `computeCommissionDraft()` — ครอบคลุม expansion commission ไหม (ปัจจุบันอาจไม่มี)
- History tab — period, status, amount ถูกต้องไหม
- Retroactive tab — ใช้งานได้จริง May backfill ไหม

---

## 7. KAM Roster (สำหรับ SQL)

```sql
-- Squad A (TL: nitipat.s@freshket.co)
('Anusorn (Bookbig) Khamphasuk', 'anusorn.k@freshket.co')
('Chaklid (Dent) Nimraor',       'chaklid.n@freshket.co')
('Duangruedee (Ning) Bulalom',   'duangruedee.bu@freshket.co')
('Napat (To) Kaikaew',           'napat.k@freshket.co')
('Nuttawan (Kwang) Mahaporn',    'nuttawan.ma@freshket.co')
('Ploynitcha (Nitcha) Rujipiromthagoon', 'ploynitcha.r@freshket.co')
('Rinlaphat (Mild) Setthasiriwuti', 'rinlaphat.s@freshket.co')

-- Squad B (TL: pavarisa.mu@freshket.co)
('Guntinun (Monet) Thanoochan',  'guntinun.t@freshket.co')
('Intuon (Jane) Yanakit',        'intuon.y@freshket.co')
('Natchita (Foam) Bunkong',      'natchita.b@freshket.co')
('Niracha (Cream) Sangka',       'niracha.s@freshket.co')
('Puttipong (Tape) Wanithaweewat', 'puttipong.w@freshket.co')
('Siriprapa (Pop) Piapeng',      'siriprapa.p@freshket.co')
('Warissara (Ply) Chanaboon',    'warissara.c@freshket.co')
```

---

## 8. BigQuery patterns

```sql
-- Ownership จาก order (source of truth — ไม่ใช่ user_master)
SELECT
  CAST(o.user_id AS STRING)       AS outlet_id,
  UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
  TRIM(o.staff_owner)             AS staff_owner,
  DATE(o.first_dollar_date)       AS first_dollar_date,
  DATE(o.new_user_exp_date)       AS new_user_exp_date
FROM `freshket-rn.dwh.order` o
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1

-- GMV ex VAT (ไม่ใช้ gmv ธรรมดา)
SUM(o.gmv_ex_vat)

-- Item-level (upsell)
FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i

-- QUALIFY dedup pattern
QUALIFY ROW_NUMBER() OVER (PARTITION BY col ORDER BY date DESC NULLS LAST) = 1

-- account_type filter (ทุก SQL ใช้แบบนี้)
WHERE o.account_type IN ('SA','MC','Chain','Unknown')
```

---

## 9. Edge cases ที่ validate แล้ว (อย่าแก้โดยไม่ตรวจ)

| Outlet | สถานการณ์ | Classification ที่ถูก |
|---|---|---|
| 205038 | Apr ไม่มี owner (limbo) → May=Dent | `transfer_in` |
| 211997 | May=May(KAM), Jun=Dent → SQL ใช้ May order | May owner ถูกต้อง |
| 243439 | ไม่มี new_user_exp_date → PATH B (last SALE Apr) | `handover_perf` |
| 243819 | exp_month='2026-05' | `new_sales` |
| 170447 | Fang ลาออก, Apr ไม่มี order | `comeback` (verified BigQuery: Apr GMV=0) |

---

## 10. Starter prompt สำหรับ session ใหม่

```
Repo: github.com/boonwirat-glitch/cost-iq  branch: main
Token: [GITHUB_TOKEN]

อ่าน HANDOFF_commission_backfill.md จาก repo (sql/ หรือ docs/) ก่อนเริ่มทำอะไร

งาน session นี้: [ระบุ Task 1/2/3 หรือ Phase 2 A/B/C/D]

กฎการทำงาน:
1. fetch_blob ทุก file ก่อนแก้ — ห้ามแก้จากความจำ
2. ยืนยัน OLD string อยู่ใน content ก่อน replace เสมอ
3. node --check ทุก JS ก่อน push
4. rebuild index.html + bump SW cache ทุก deploy
5. BigQuery CTE ต้องเรียง dependency ถูกต้อง — ไม่มี forward reference
6. อ่าน HANDOFF ให้ครบก่อนตอบ — อย่า re-derive logic ที่ validate แล้ว
```
