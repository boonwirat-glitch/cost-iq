-- ══════════════════════════════════════════════════════════════════════════
-- NRR May 2026 Backfill — commission calculation
-- ══════════════════════════════════════════════════════════════════════════
--
-- วัตถุประสงค์:
--   คำนวณ NRR% ของ KAM แต่ละคน สำหรับเดือน May 2026 (เดือนที่ปิดแล้ว)
--   เพื่อใช้ backfill เข้า commission_payout_snapshots ใน Supabase
--
-- Logic (ตรงกับ _groupNRR() + _tgtComputeKamNRR() ใน app):
--   cohort       = outlet_id ที่มี GMV > 0 ใน April 2026
--   NRR%         = (Σ May GMV ของ cohort ÷ 31) ÷ (Σ Apr GMV ของ cohort ÷ 30)
--   daysElapsed  = 31  (May เต็มเดือน — ใช้ days_in_month ไม่ใช่ days elapsed)
--   prevDays     = 30  (April มี 30 วัน)
--
-- Ownership:
--   ใช้ user_master snapshot ปัจจุบัน (รับรู้ว่า May ownership อาจเปลี่ยนไปบ้าง
--   เพราะ user_master ไม่เก็บ history — known limitation, document ไว้ใน lock_note)
--
-- หมายเหตุ: ไม่รวม comeback/expansion ใน NRR%
--   comeback  = outlet ที่ไม่ได้อยู่ใน cohort Apr แต่กลับมาซื้อ May
--   expansion = outlet ที่ไม่เคยปรากฏใน history เลยก่อน May
--   ทั้งคู่แสดงแยก เพื่อ reconcile ได้
--
-- Output columns:
--   kam_email, tl_email,
--   apr_cohort_gmv, may_cohort_gmv,
--   apr_daily_rate, may_daily_rate,
--   raw_nrr_pct,
--   cohort_outlet_count,
--   comeback_gmv, expansion_gmv,
--   nrr_payout  (apply default tier: <99→0, 99-101.9→5000, ≥102→7500)
-- ══════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchor (May backfill) ────────────────────────────────────────
params AS (
  SELECT
    DATE('2026-05-31')                         AS lag_date,         -- สิ้นสุด May (วันสุดท้ายที่มีข้อมูล)
    DATE('2026-05-01')                         AS cur_month_start,  -- May 2026
    DATE('2026-05-31')                         AS cur_month_end,
    31                                         AS days_elapsed,     -- May เต็มเดือน 31 วัน
    DATE('2026-04-01')                         AS prev_month_start, -- April 2026 (base)
    DATE('2026-04-30')                         AS prev_month_end,
    30                                         AS prev_days,        -- April มี 30 วัน
    DATE('2026-01-01')                         AS ytd_start,        -- YTD filter (ตรงกับ Q8E)
    '2026'                                     AS year_label
),

-- ── 2. KAM roster (ตรงกับ Q8E v3) ────────────────────────────────────────
kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── 3. Ownership snapshot (user_master current) ───────────────────────────
-- NOTE: user_master ไม่เก็บ history ดังนั้น ownership ที่ได้คือ ณ วันที่รัน SQL นี้
-- ถ้า KAM บางคนรับ/โอน account ระหว่าง Apr–Jun จะ attribute ตาม owner ปัจจุบัน
-- ให้ manual review ถ้าพบ discrepancy กับที่จ่ายจริง
user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at   DESC NULLS LAST
  ) = 1
),
kam_accounts AS (
  SELECT
    um.account_guid  AS account_id,
    CAST(um.res_id AS STRING) AS res_id,
    k.kam_email,
    k.tl_email,
    k.kam_name
  FROM user_master_current um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),

-- ── 4. Outlet GMV — April (baseline) ─────────────────────────────────────
-- cohort = outlet_id ที่มี GMV > 0 ในเดือน April
apr_gmv AS (
  SELECT
    ka.kam_email,
    ka.tl_email,
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat) AS apr_gmv
  FROM `freshket-rn.dwh.order` o
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  CROSS JOIN params p
  WHERE o.delivery_date >= p.prev_month_start
    AND o.delivery_date <= p.prev_month_end
    AND o.gmv_ex_vat  > 0
  GROUP BY 1, 2, 3
  HAVING SUM(o.gmv_ex_vat) > 0  -- cohort = GMV > 0 เท่านั้น
),

-- ── 5. Outlet GMV — May (current) ────────────────────────────────────────
may_gmv AS (
  SELECT
    ka.kam_email,
    ka.tl_email,
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat) AS may_gmv
  FROM `freshket-rn.dwh.order` o
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  CROSS JOIN params p
  WHERE o.delivery_date >= p.cur_month_start
    AND o.delivery_date <= p.cur_month_end
    AND o.gmv_ex_vat  > 0
  GROUP BY 1, 2, 3
),

-- ── 6. everSeen — outlet ที่เคยสั่งก่อน May (สำหรับแยก comeback vs expansion) ──
ever_seen_before_may AS (
  SELECT DISTINCT
    ka.kam_email,
    CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  CROSS JOIN params p
  WHERE o.delivery_date >= DATE_SUB(p.prev_month_start, INTERVAL 18 MONTH)
    AND o.delivery_date <  p.cur_month_start  -- ก่อน May เท่านั้น
    AND o.gmv_ex_vat > 0
),

-- ── 7. Outlet classification ──────────────────────────────────────────────
-- cohort    = อยู่ใน apr_gmv  → นับใน NRR%
-- comeback  = ไม่อยู่ apr_gmv แต่เคยซื้อก่อน May  → แสดงแยก ไม่นับใน NRR%
-- expansion = ไม่อยู่ apr_gmv และไม่เคยซื้อก่อน May → แสดงแยก ไม่นับใน NRR%
outlet_status AS (
  SELECT
    COALESCE(a.kam_email, m.kam_email)   AS kam_email,
    COALESCE(a.tl_email,  m.tl_email)    AS tl_email,
    COALESCE(a.outlet_id, m.outlet_id)   AS outlet_id,
    COALESCE(a.apr_gmv, 0)               AS apr_gmv,
    COALESCE(m.may_gmv, 0)               AS may_gmv,
    CASE
      WHEN a.outlet_id IS NOT NULL                          THEN 'cohort'
      WHEN a.outlet_id IS NULL AND ev.outlet_id IS NOT NULL THEN 'comeback'
      ELSE                                                       'expansion'
    END AS outlet_type
  FROM apr_gmv a
  FULL OUTER JOIN may_gmv m
    ON a.kam_email  = m.kam_email
   AND a.outlet_id  = m.outlet_id
  LEFT JOIN ever_seen_before_may ev
    ON COALESCE(a.kam_email, m.kam_email) = ev.kam_email
   AND COALESCE(a.outlet_id, m.outlet_id) = ev.outlet_id
),

-- ── 8. NRR per KAM ───────────────────────────────────────────────────────
nrr_per_kam AS (
  SELECT
    kam_email,
    tl_email,
    -- Cohort aggregates (NRR inputs)
    SUM(CASE WHEN outlet_type = 'cohort' THEN apr_gmv ELSE 0 END) AS apr_cohort_gmv,
    SUM(CASE WHEN outlet_type = 'cohort' THEN may_gmv ELSE 0 END) AS may_cohort_gmv,
    COUNT(CASE WHEN outlet_type = 'cohort' THEN 1 END)             AS cohort_outlet_count,
    -- Non-cohort (for transparency)
    SUM(CASE WHEN outlet_type = 'comeback'  THEN may_gmv ELSE 0 END) AS comeback_gmv,
    SUM(CASE WHEN outlet_type = 'expansion' THEN may_gmv ELSE 0 END) AS expansion_gmv,
    COUNT(CASE WHEN outlet_type = 'comeback' THEN 1 END)              AS comeback_outlet_count,
    COUNT(CASE WHEN outlet_type = 'expansion' THEN 1 END)             AS expansion_outlet_count
  FROM outlet_status
  GROUP BY 1, 2
),

-- ── 9. Compute NRR% (daily rate normalized) ───────────────────────────────
nrr_computed AS (
  SELECT
    n.*,
    p.prev_days,
    p.days_elapsed,
    -- Daily rates
    ROUND(apr_cohort_gmv / p.prev_days, 4) AS apr_daily_rate,
    ROUND(may_cohort_gmv / p.days_elapsed, 4) AS may_daily_rate,
    -- NRR%: (May daily rate) ÷ (Apr daily rate) × 100
    CASE
      WHEN apr_cohort_gmv > 0
      THEN ROUND(
        (may_cohort_gmv / p.days_elapsed) / (apr_cohort_gmv / p.prev_days) * 100
      , 2)
      ELSE NULL
    END AS raw_nrr_pct
  FROM nrr_per_kam n
  CROSS JOIN params p
)

-- ── 10. Final output with NRR payout tier ────────────────────────────────
-- Default tiers (ตรงกับ commission_rule_plans defaults):
--   raw_nrr_pct < 99   → ฿0
--   99 ≤ pct < 102     → ฿5,000
--   pct ≥ 102          → ฿7,500
--
-- ⚠️  ถ้ามีการ override tier ใน Supabase (cockpit) ให้ปรับตรงนี้ก่อน lock
--
SELECT
  nc.kam_email,
  nc.tl_email,
  '2026-05'                                              AS period_month,
  nc.apr_cohort_gmv,
  nc.may_cohort_gmv,
  nc.prev_days,
  nc.days_elapsed,
  nc.apr_daily_rate,
  nc.may_daily_rate,
  nc.raw_nrr_pct,
  nc.cohort_outlet_count,
  nc.comeback_gmv,
  nc.comeback_outlet_count,
  nc.expansion_gmv,
  nc.expansion_outlet_count,
  -- NRR payout (default tiers — ปรับถ้ามี custom plan ใน Supabase)
  CASE
    WHEN nc.raw_nrr_pct IS NULL THEN 0
    WHEN nc.raw_nrr_pct < 99    THEN 0
    WHEN nc.raw_nrr_pct < 102   THEN 5000
    ELSE                              7500
  END AS nrr_payout,
  -- Gate cap (NRR% เป็น proxy ของ Total Portfolio GMV ตาม app logic)
  -- ปรับ final_payout = nrr_payout × gate_cap ภายหลังรวม P1/P3/Expansion/Handover แล้ว
  CASE
    WHEN nc.raw_nrr_pct IS NULL OR nc.raw_nrr_pct < 90 THEN 0.35
    WHEN nc.raw_nrr_pct < 95                            THEN 0.70
    ELSE                                                     1.00
  END AS gate_cap,
  -- Sanity check cols
  ROUND(nc.apr_cohort_gmv + nc.comeback_gmv + nc.expansion_gmv, 0) AS total_may_gmv_all_types

FROM nrr_computed nc
ORDER BY nc.tl_email, nc.raw_nrr_pct DESC NULLS LAST
;
