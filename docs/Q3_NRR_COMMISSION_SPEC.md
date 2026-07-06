# Q3 2026 Quarterly NRR & Commission — SPEC (ต้นทางเดียว)

**อัปเดตล่าสุด:** 2026-07-04
**Branch:** `preview/q3-commission-build`
**สถานะ:** Logic + data pipeline ยืนยันถูกต้องแล้วด้วยการรันจริง (ดู HANDOFF.md) — รอ CSV upload จริง + browser test

> เอกสารนี้แทนที่ `NOT_USE_handoff-2026-06-30-q3-commission-spec.md` และ `NOT_USE_qnrr_master_movement_design_v3-v7.md` ทั้งหมด
> `qnrr_master_movement_design_v8.md` ยังใช้เป็น reference ของ SQL movement classification ได้ (ไม่ล้าสมัย) — เอกสารนี้อ้างอิงจาก v8 ต่อ

---

## 1. Business Goal

ตั้งแต่ Q3 2026 (ก.ค.–ก.ย.) เป็นต้นไป **NRR, Expansion, Upsell P1/P3** เปลี่ยนจากเทียบเดือนต่อเดือน (Rolling MoM) เป็นเทียบกับ **เดือนฐานคงที่ (Fixed base) = เดือนสุดท้ายของไตรมาสก่อน**

| Component | Monthly (เดิม) | Quarterly (Q3 เป็นต้นไป) |
|---|---|---|
| NRR | เทียบเดือนก่อนหน้า (เลื่อนทุกเดือน) | เทียบ **มิ.ย. คงที่** ตลอด ก.ค./ส.ค./ก.ย. |
| Expansion | Rolling MoM | Fixed base มิ.ย. เช่นกัน |
| Upsell P1/P3 | 3M lookback เลื่อนตามเดือนปัจจุบัน | 3M lookback **คงที่ = มิ.ย./พ.ค./เม.ย.** ตลอด Q3 |
| **Handover & new_sales** | MoM | **ไม่เปลี่ยน — MoM ตลอดไป (by design)** |

**เหตุผลที่ Handover ไม่เปลี่ยน:** วัดผลระยะสั้น (M+1 หลังโอนจาก Sales) ไม่เหมาะกับ fixed-base ระยะไตรมาส

**หลักการล็อค:** MoM engine เดิม (`_tgtComputeKamNRR`, `_commComputeHandoverRetention`) ต้องทำงานได้ปกติ 100% ไม่ถูกแตะ — ของใหม่ (`_qnrrComputeForCommission`) เป็น layer คู่ขนานที่ `_commBuildKamPayout`/`_commBuildTlPayout` เลือกใช้ตาม `policy.commission_mode`

---

## 2. Data Architecture

```
BigQuery (auto-derive ไตรมาสเอง — ไม่ hardcode วันที่)
   ├─ sql/q3_2026_movement_rep_view.sql   → sense_qnrr_2026q3.csv   ★ ไฟล์เดียวที่แอปโหลดจริง
   └─ sql/q3c_upsell_team_summary_v4.sql  → sense_upsell_team.csv  ★ ไฟล์เดียวที่แอปโหลดจริง (fast-path)
                                                 ↓
                                    window.bulkQnrrData / bulkUpsellTeamData
                                                 ↓
                        _commBuildKamPayout(email, periodOverride)
                        _commBuildTlPayout(email, periodOverride)
```

**⚠️ ไม่ต้อง export/อัปโหลด:**
- `q3_2026_movement_{kam,pm,admin,tl}_view.sql` — SQL scoped variant สำหรับ reporting แยก ไม่ถูกแอป consume
- `q3c_upsell_bulk_all_kams_v4.sql` → `sense_upsell_bulk.csv` — โค้ด comment ระบุชัด "[legacy, not used in Option B]"
- `sql/quarterly_nrr_2026_Q2_v5-v8.sql` — draft ที่ถูกแทนที่ด้วย `q2_2026_movement_rep_view.sql` → `q3_2026_movement_rep_view.sql` แล้ว (ดู commit timeline ใน HANDOFF.md)

**CSV Parser:** `src/02_data_pipeline.js` type `'bulk-qnrr-single'` — ต้อง parse 29 columns ตามลำดับที่ `rep_view` SELECT จริง (ไม่ใช่ column ที่ "ดูน่าจะเป็น") ดู field list เต็มใน SPEC section 6

---

## 3. Movement Type Classification (จาก rep_view SQL — v8 design)

CASE priority (mutually exclusive, ทุกแถวได้ 1 ค่า):
```
[1] core_nrr    : outlet_id พบใน matched cohort (mc.outlet_id IS NOT NULL)
[2] expansion   : first_dollar_owner != 'SALE' AND first purchase อยู่ใน quarter นี้
[3] handover    : cohort_month = เดือนแรกสุดของ tracking (มี.ค. สำหรับ Q2/Q3) AND effective_prev = SALE
[4] new_sales   : cohort_month ใน quarter ปัจจุบัน (ไม่ใช่เดือนแรกสุด) AND effective_prev = SALE
[5] comeback    : first_dollar < ช่วงต้น AND ฐานก่อนหน้า GMV=0 (ทุก owner) AND ไม่ผ่าน [1]-[4]
[6] transfer_in / transfer_out : ย้ายข้าม portfolio
```

**🔴 สำคัญ — core_nrr ไม่ได้แยก churn ใน SQL:** ทั้งร้าน "ยังซื้ออยู่" และร้าน "หลุดไปเป็น 0" ถูกจัดเป็น `movement_type='core_nrr'` เหมือนกันหมด (ยืนยันจากข้อมูลจริง `rep_kam_as_of_29_jun.xlsx`) การแยก **Churn vs Up/Down** ต้องทำฝั่ง JS เอง โดยเช็ค `curr_gmv`:

```
Churn    : movement_type='core_nrr' AND curr_gmv = 0        → value = -base_gmv (normalized)
Up       : movement_type='core_nrr' AND curr_gmv > base_gmv → value = curr-base (normalized), เฉพาะที่เป็นบวก
Down     : movement_type='core_nrr' AND curr_gmv < base_gmv → value = curr-base (normalized), เฉพาะที่เป็นลบ
(ไม่นับ) : curr_gmv = base_gmv เป๊ะ
```

JS ที่ implement เรื่องนี้: `_effectiveMovement()` ใน `07c_qnrr_view.js` — reclassify `core_nrr` → `core_nrr_churn` เมื่อ `curr_gmv===0` (แก้เมื่อ 2026-07-04 หลังพบว่าไม่เคยถูกเขียน — ดู HANDOFF.md บั๊ก #8)

**Normalization:** ทุกค่าต้อง `÷days_in_period × 30` ก่อนเทียบกัน (เดือน 28/29/30/31 วันไม่เท่ากัน) — ห้ามเอา raw บาทมาลบกันตรงๆ ข้ามเดือนที่ day count ต่างกัน

---

## 4. Commission Formula (4 องค์ประกอบ) — ยืนยันตรงกับ Supabase `target_settings` จริงแล้ว

### 4.1 NRR (ก้อนใหญ่สุด)
- **สูตร:** เทียบ GMV normalized ของ `core_nrr` cohort เดือนนี้ (หรือแต่ละเดือนใน Q สำหรับ quarterly) เทียบเดือนฐาน
- **Payout:** ขั้นบันได (tier table) ไม่ใช่ % คงที่ — เก็บใน Supabase `commission_rules` + `commission_rule_tiers` (`metric_code='nrr'`, tier: min_value/max_value/payout_value)
- ตัวอย่างจริงจากระบบ: NRR 100% → ฿5,000, NRR 103% → ฿10,000

### 4.2 Handover & new_sales — **MoM เสมอ ไม่เปลี่ยนตามไตรมาส**
- **สูตร:** `perf_gmv(M+1)/perfDays×30 ÷ baseline_gmv(transfer month)/baselineDays×30`
- Filter: `prevOwner==='SALE'` เท่านั้น, transfer_month = เดือนก่อนหน้า (M-1) เท่านั้น
- Payout: tier table (`target_settings.handover_params`) — จริง: `{tier2_pct:100, tier3_pct:120, tier2_payout:2500, tier3_bonus:2500}`
- ฟังก์ชัน: `_commComputeHandoverRetention(kamEmail)`

### 4.3 Expansion
- **สูตร:** GMV ของ outlet ที่ `movement_type='expansion'` (เปิดใหม่ ไม่ใช่ handover/new_sales) × rate
- **Rate จริง:** `target_settings.upsell_outlet_params.rate = 0.015` (1.5%)
- ฟังก์ชัน: `_commComputeUpsellOutlet(kamEmail, qnrrRaw, periodOverride)`

### 4.4 Upsell P1/P3 — ค่า config จริงยืนยันจาก Supabase (`target_settings.upsell_sku_params`)
```json
{"p1_rate":0.03, "p3_rate":0.03, "p3_threshold_pct":2.00, "p1_min_gmv":5000, "p3_min_incremental":8000}
```
- **P1:** group_key (item family) ที่ outlet ไม่เคยซื้อมาก่อนในเดือนฐาน+lookback 3 เดือน (มิ.ย./พ.ค./เม.ย. สำหรับ Q3) ต้องมียอด ≥ 5,000 → ×3%
- **P3:** group_key เดิม ต้องมียอด current เกิน max(baseline 3 เดือน) × 2.00 เท่า **และ** ส่วนต่าง (incremental) ≥ 8,000 → ×3% ของ incremental
- ฟังก์ชัน: `_commComputeUpsellSku(kamEmail, expansionIds, baseMonthOverride)` — quarterly ส่ง `baseMonthOverride='2026-06'` คงที่

### 4.5 GMV Gate — ยืนยันจริงจาก Supabase (`target_settings.gmv_gate_params`)
```json
{"threshold_1":98, "threshold_2":95, "cap_1":0.70, "cap_2":0}
```
| NRR% | ได้ % ของยอดที่ควรได้ |
|---|---|
| ≥ 98% | 100% |
| 95–97% | 70% |
| < 95% | 0% |

### 4.6 TL Upsell Multiplier (bonus — พบระหว่างตรวจสอบ config)
```json
{"tiers":[{0-1.99%:1.00x},{2-2.99%:1.20x},{3-3.99%:1.35x},{4-4.99%:1.50x},{≥5%:1.80x}]}
```
คูณเข้ากับ TL payout ตาม % upsell รวมของทีม

### สูตรรวม
```
subtotal = nrr_payout + upsell_sku.total_comm + upsell_outlet.commission + handover.payout
final_payout = ROUND(subtotal × gate.cap_multiplier)
```

---

## 5. Policy & Config Tables (Supabase — ยืนยันโครงสร้างจริงแล้ว)

### `nrr_policies` (มี FK ไป `commission_periods.period_month`)
```
id, period_month, scope_type, scope_key, base_mode, base_month,
commission_mode ('monthly'|'quarterly'), quarter_id, status, notes, updated_by, updated_at
```
Q3 rows ที่ backfill แล้ว (2026-07-04):
| period_month | base_mode | base_month | commission_mode | quarter_id |
|---|---|---|---|---|
| 2026-06 | rolling_mom | 2026-05 | monthly | null |
| 2026-07 | fixed_month | 2026-06 | quarterly | 2026-Q3 |
| 2026-08 | fixed_month | 2026-06 | quarterly | 2026-Q3 |
| 2026-09 | fixed_month | 2026-06 | quarterly | 2026-Q3 |

### `target_settings` (key-value, ไม่ใช่ commission_rules!)
```
key (text), value (text = JSON string), updated_by, updated_at
```
**⚠️ กับดักที่เจอ:** `_commGetConfig(category, key, default)` อ่านจาก `target_settings` ผ่าน `_tgtSettings[category+'_params']` **ไม่ได้อ่านจาก `commission_rules`/`commission_rule_tiers`** (ตารางนั้นใช้เก็บ tier ของ NRR/Handover payout amount เท่านั้น — คนละกลไกกัน)

### `commission_payout_snapshots`
เก็บ `breakdown` เป็น jsonb รวม `commission_mode`, `base_month`, `quarter_id`, `nrr_cohort_detail`, `expansion_detail` — ไม่ต้อง migrate column ใหม่ เพราะ metadata อยู่ใน jsonb แล้ว

---

## 6. CSV Field Schema (29 columns — ตรงกับ `rep_view` SELECT เป๊ะ)

```
0  period_month          8  account_id          16 curr_days              24 latest_commercial_owner
1  movement_type         9  account_name        17 first_dollar_date      25 latest_kam_email
2  transfer_scope       10  res_name            18 first_portfolio_date   26 latest_tl_email
3  current_portfolio    11  account_type        19 first_dollar_owner     27 base_kam_email
4  current_staff_owner  12  cohort_month        20 new_user_exp_date      28 base_tl_email
5  base_portfolio       13  curr_gmv            21 latest_tl
6  base_staff_owner     14  base_gmv            22 base_tl
7  outlet_id            15  base_days           23 latest_staff_owner
```

**Grouping key สำหรับ byKamEmail/byTlEmail:** ใช้ `latest_kam_email`/`latest_tl_email` (ไม่ใช่ "period_kam_email" ที่ไม่มีอยู่จริง) — เพราะ grain ของ rep_view คือ "แปะ owner ปัจจุบันบนทุกแถวย้อนหลัง"


---

## 7. Session 2 Addendum (2026-07-05) — ยืนยันจากการทดสอบจริง

**ไม่ต้องมีแถว `period_month=2026-06` (เดือนฐาน) แยกในข้อมูลเลย — by design**

`_qnrrCompute()` (07c_qnrr_view.js) reconstruct ยอดฐานจาก **`base_gmv` column ของเดือนแรกสุดที่มีข้อมูลจริง** (`months[0]` หลัง sort) ไม่ได้มองหา row ที่ label ตรงกับ `QNRR_CFG.base_month` เลย — ทุกจุดใน UI ที่ต้องโชว์แถบ "เดือนฐาน" (`BASE_MONTH`) ใช้ค่าที่คำนวณสำเร็จรูปไว้แล้ว (`cohort_outlets`, `base_gmv_original`, `handover_base_norm`) ไม่เคยทำ `by_month[BASE_MONTH]` lookup ตรงๆ

**ผลกระทบต่อ SQL:** CTE ที่ควรแทนเดือนที่ 3 ของไตรมาส (เช่น `jun_classified` ใน `rep_view.sql`) **ต้อง label เป็น `v_m3_str` เสมอ ไม่ใช่ `v_base_str`** แม้จะรู้สึกว่าชื่อ CTE (jun) ตรงกับชื่อเดือนฐาน (มิ.ย.) ก็ตาม — ให้ยึดตาม **data source จริง** (`FROM sep_own`/`sep_gmv` = เดือนที่ 3 = v_m3_str) ไม่ใช่ยึดตามชื่อ CTE

**Silent-outlets fallback ต้อง guard ด้วย `v_mX_days > 0`** — ถ้าเดือนนั้นยังไม่เริ่มจริง (ไม่มี order เลย) ต้องไม่ generate แถวเลย (ปล่อยว่าง) แทนที่จะให้ทุก outlet กลายเป็น "churn 100%" ปลอม
