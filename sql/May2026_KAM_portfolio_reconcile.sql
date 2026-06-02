-- ══════════════════════════════════════════════════════════════════════════
-- May 2026 KAM Portfolio Movement & NRR Reconcile
-- ══════════════════════════════════════════════════════════════════════════
--
-- วัตถุประสงค์: แสดงทุก outlet ใน portfolio ของ KAM แต่ละคน
--   พร้อม movement_type ที่ชัดเจน เพื่อ reconcile และคำนวณ commission
--
-- Grain: 1 row ต่อ outlet_id (user_id)
--
-- movement_type:
--   core_nrr     — อยู่ใน portfolio ก่อน May, มี GMV ใน Apr (cohort)
--   core_nrr_churn — อยู่ใน portfolio ก่อน May, ไม่มี GMV ใน May (churn ออก)
--   comeback     — ไม่มี GMV ใน Apr แต่เคยซื้อก่อน May และกลับมา May
--   expansion    — ไม่เคยปรากฏใน history เลย → ร้านใหม่แท้ (1.5%)
--   new_sales    — รับโอนจาก Sales ใน May (Q11 logic: prev_owner=SALE)
--   transfer_in  — รับโอนจาก KAM/PM อื่น ใน May
--   transfer_out — ออกจาก portfolio ใน May (แสดงใน KAM เดิม)
--
-- Commission components ที่คำนวณได้จาก SQL นี้:
--   NRR%     → จาก core_nrr rows (apr_gmv vs may_gmv daily-rate)
--   Expansion → จาก expansion rows (may_gmv × 1.5%)
--   Handover  → จาก new_sales rows (retention% vs baseline Apr GMV)
--
-- NRR summary per KAM อยู่ที่ section 2 ท้าย SQL (GROUP BY)
-- ══════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchor (May 2026 backfill) ────────────────────────────────────
params AS (
  SELECT
    DATE('2026-05-01') AS cur_start,   -- May 1
    DATE('2026-05-31') AS cur_end,     -- May 31
    31                 AS cur_days,    -- วันในเดือน May
    DATE('2026-04-01') AS prev_start,  -- Apr 1
    DATE('2026-04-30') AS prev_end,    -- Apr 30
    30                 AS prev_days,   -- วันในเดือน Apr
    -- History lookback สำหรับ everSeen (แยก comeback vs expansion)
    DATE('2024-11-01') AS history_start  -- 18 เดือนก่อน May
),

-- ── 2. KAM roster ──────────────────────────────────────────────────────────
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

-- ── 3. Current ownership (user_master snapshot) ────────────────────────────
user_master_snap AS (
  SELECT
    CAST(um.res_id AS STRING)        AS outlet_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.account_type,
    k.kam_email,
    k.tl_email,
    k.kam_name,
    DATE(um.first_dollar_date)       AS first_dollar_date,
    DATE(um.new_user_exp_date)       AS new_user_exp_date,
    DATE(um.lasted_order_date)       AS lasted_order_date
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY um.res_id
    ORDER BY
      CASE WHEN um.staff_owner_email IS NOT NULL
                AND TRIM(um.staff_owner_email) != '' THEN 0 ELSE 1 END,
      um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── 4. GMV April (baseline) per outlet ────────────────────────────────────
apr_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)         AS apr_gmv,
    COUNT(DISTINCT o.order_id) AS apr_orders,
    MAX(o.delivery_date)      AS apr_last_order
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  -- ใช้ account_id join เพื่อให้ครอบคลุมทุก outlet ของ KAM accounts
  JOIN user_master_snap um ON CAST(o.user_id AS STRING) = um.outlet_id
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.gmv_ex_vat > 0
  GROUP BY 1
),

-- ── 5. GMV May (current) per outlet ───────────────────────────────────────
may_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)         AS may_gmv,
    COUNT(DISTINCT o.order_id) AS may_orders,
    MAX(o.delivery_date)      AS may_last_order
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  JOIN user_master_snap um ON CAST(o.user_id AS STRING) = um.outlet_id
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND o.gmv_ex_vat > 0
  GROUP BY 1
),

-- ── 6. everSeen — เคยสั่งก่อน May ────────────────────────────────────────
ever_seen AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  JOIN user_master_snap um ON CAST(o.user_id AS STRING) = um.outlet_id
  WHERE o.delivery_date >= p.history_start
    AND o.delivery_date <  p.cur_start  -- ก่อน May เท่านั้น
    AND o.gmv_ex_vat > 0
),

-- ── 7. Transfer Out — outlet ที่ออกจาก portfolio ใน May ──────────────────
-- ใช้ dwh.order เปรียบเทียบ: Apr=KAM เดิม → May=owner อื่น
-- grain: account_id (ตรงกับ Q11 transfer_out ที่ใช้ account grain)
apr_owner AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    -- owner ที่มี order ล่าสุดใน Apr
    ARRAY_AGG(
      STRUCT(
        UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
        TRIM(COALESCE(o.staff_owner,'')) AS staff_owner
      )
      ORDER BY o.delivery_date DESC LIMIT 1
    )[OFFSET(0)] AS apr_owner_info
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.gmv_ex_vat > 0
  GROUP BY 1
),
may_owner AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    ARRAY_AGG(
      STRUCT(
        UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
        TRIM(COALESCE(o.staff_owner,'')) AS staff_owner
      )
      ORDER BY o.delivery_date DESC LIMIT 1
    )[OFFSET(0)] AS may_owner_info,
    SUM(o.gmv_ex_vat) AS may_acct_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.gmv_ex_vat > 0
  GROUP BY 1
),
transfer_out_accounts AS (
  SELECT
    a.account_id,
    a.apr_owner_info.commercial_owner AS apr_commercial_owner,
    a.apr_owner_info.staff_owner      AS apr_staff_owner,
    m.may_owner_info.commercial_owner AS may_commercial_owner,
    m.may_owner_info.staff_owner      AS may_staff_owner
  FROM apr_owner a
  JOIN may_owner m ON a.account_id = m.account_id
  -- เป็น KAM ใน Apr แต่เปลี่ยน owner ใน May
  WHERE a.apr_owner_info.commercial_owner = 'KAM'
    AND (
      m.may_owner_info.commercial_owner != 'KAM'
      OR m.may_owner_info.staff_owner != a.apr_owner_info.staff_owner
    )
),

-- ── 8. New Sales — รับจาก Sales ใน May (Q10/Q11 logic) ───────────────────
-- outlet ที่: new_user_exp_date = '2026-05' OR first_kam_order ใน May
new_sales_outlets AS (
  SELECT
    um.outlet_id,
    um.account_id,
    um.account_name,
    um.account_type,
    um.kam_email,
    um.tl_email,
    um.kam_name,
    um.new_user_exp_date,
    um.first_dollar_date
  FROM user_master_snap um
  CROSS JOIN params p
  WHERE
    -- PATH A: new_user_exp_date ตรงกับ May
    (um.new_user_exp_date BETWEEN p.cur_start AND p.cur_end)
    OR
    -- PATH B: first_dollar_date ใน May (ซื้อครั้งแรกกับ KAM ใน May)
    (
      um.new_user_exp_date IS NULL
      AND um.first_dollar_date BETWEEN p.cur_start AND p.cur_end
    )
),

-- ── 9. Transfer In — รับจาก KAM อื่น ใน May ──────────────────────────────
-- outlet ที่ Apr owner = KAM คนอื่น, May owner = KAM ใน kam_list
transfer_in_outlets AS (
  SELECT
    um.outlet_id,
    um.account_id,
    ao.apr_owner_info.staff_owner AS prev_kam_name,  -- fixed: flatten STRUCT field
    um.kam_email                  AS new_kam_email,
    um.kam_name                   AS new_kam_name,
    um.tl_email
  FROM user_master_snap um
  JOIN apr_owner ao ON um.account_id = ao.account_id
  -- Apr owner เป็น KAM แต่ไม่ใช่คนเดิม
  WHERE ao.apr_owner_info.commercial_owner = 'KAM'
    AND ao.apr_owner_info.staff_owner != um.kam_name
    AND ao.apr_owner_info.staff_owner NOT IN (
      SELECT kam_name FROM kam_list
      WHERE kam_email = um.kam_email
    )
),

-- ── 10. Master outlet list — รวมทุก outlet ที่ active ──────────────────────
-- Active = มี GMV ใน Apr หรือ May (หรือทั้งคู่)
all_active_outlets AS (
  SELECT
    COALESCE(a.outlet_id, m.outlet_id) AS outlet_id,
    COALESCE(a.apr_gmv, 0)             AS apr_gmv,
    COALESCE(m.may_gmv, 0)             AS may_gmv,
    COALESCE(a.apr_orders, 0)          AS apr_orders,
    COALESCE(m.may_orders, 0)          AS may_orders,
    a.apr_last_order,
    m.may_last_order
  FROM apr_gmv a
  FULL OUTER JOIN may_gmv m ON a.outlet_id = m.outlet_id
)

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 1: Outlet-level detail (1 row / outlet)
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  -- Identity
  um.kam_name,
  um.kam_email,
  um.tl_email,
  um.account_id,
  um.account_name,
  um.account_type,
  um.outlet_id,

  -- GMV
  ROUND(ao.apr_gmv, 0)  AS apr_gmv,
  ROUND(ao.may_gmv, 0)  AS may_gmv,
  ao.apr_orders,
  ao.may_orders,

  -- Movement classification
  CASE
    -- Transfer Out: outlet เป็น KAM Apr แต่เปลี่ยน owner May
    WHEN toa.account_id IS NOT NULL
      AND um.account_id = toa.account_id
      THEN 'transfer_out'
    -- New Sales (Handover): รับจาก Sales ใน May
    WHEN ns.outlet_id IS NOT NULL
      THEN 'new_sales'
    -- Transfer In: รับจาก KAM อื่น ใน May
    WHEN ti.outlet_id IS NOT NULL
      THEN 'transfer_in'
    -- Core NRR Cohort: อยู่ portfolio ก่อน May + มี GMV Apr
    WHEN ao.apr_gmv > 0 AND ao.may_gmv > 0
      THEN 'core_nrr'
    -- Core Churn: อยู่ portfolio ก่อน May + มี GMV Apr + ไม่มี May GMV
    WHEN ao.apr_gmv > 0 AND ao.may_gmv = 0
      THEN 'core_nrr_churn'
    -- Expansion: ไม่เคยปรากฏใน history เลย
    WHEN ao.may_gmv > 0 AND es.outlet_id IS NULL
      THEN 'expansion'
    -- Comeback: ไม่มี Apr GMV แต่เคยซื้อก่อน May
    WHEN ao.may_gmv > 0 AND es.outlet_id IS NOT NULL AND ao.apr_gmv = 0
      THEN 'comeback'
    ELSE 'other'
  END AS movement_type,

  -- NRR component (เฉพาะ core_nrr)
  CASE WHEN ao.apr_gmv > 0 THEN ao.apr_gmv ELSE NULL END AS nrr_base_apr_gmv,
  CASE WHEN ao.apr_gmv > 0 THEN ao.may_gmv ELSE NULL END AS nrr_curr_may_gmv,

  -- Handover commission component (เฉพาะ new_sales)
  -- baseline = Apr GMV ของ outlet นี้ (ก่อนโอน)
  -- retention% = (may_gmv ÷ 31) ÷ (apr_gmv ÷ 30)
  CASE
    WHEN ns.outlet_id IS NOT NULL AND ao.apr_gmv > 0
    THEN ROUND((ao.may_gmv / 31.0) / (ao.apr_gmv / 30.0) * 100, 2)
  END AS handover_retention_pct,

  -- Expansion commission component
  CASE
    WHEN ao.may_gmv > 0 AND es.outlet_id IS NULL
    THEN ROUND(ao.may_gmv * 0.015, 0)
  END AS expansion_commission,

  -- Source info
  ns.new_user_exp_date,
  toa.apr_staff_owner  AS transfer_out_to,
  ti.prev_kam_name     AS transfer_in_from

FROM user_master_snap um
JOIN all_active_outlets ao ON um.outlet_id = ao.outlet_id
LEFT JOIN ever_seen        es  ON ao.outlet_id = es.outlet_id
LEFT JOIN new_sales_outlets ns ON ao.outlet_id = ns.outlet_id
LEFT JOIN transfer_in_outlets ti ON ao.outlet_id = ti.outlet_id
LEFT JOIN transfer_out_accounts toa ON um.account_id = toa.account_id

ORDER BY
  um.tl_email,
  um.kam_email,
  movement_type,
  ao.may_gmv DESC NULLS LAST

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 2: KAM Summary (uncomment เพื่อดู per-KAM aggregation)
-- ══════════════════════════════════════════════════════════════════════════
-- ;
-- SELECT
--   kam_email,
--   tl_email,
--   '2026-05'                                      AS period_month,
--   COUNT(*)                                        AS total_active_outlets,
--   COUNT(CASE WHEN movement_type = 'core_nrr'      THEN 1 END) AS cohort_outlets,
--   COUNT(CASE WHEN movement_type = 'core_nrr_churn' THEN 1 END) AS churn_outlets,
--   COUNT(CASE WHEN movement_type = 'comeback'      THEN 1 END) AS comeback_outlets,
--   COUNT(CASE WHEN movement_type = 'expansion'     THEN 1 END) AS expansion_outlets,
--   COUNT(CASE WHEN movement_type = 'new_sales'     THEN 1 END) AS new_sales_outlets,
--   COUNT(CASE WHEN movement_type = 'transfer_in'   THEN 1 END) AS transfer_in_outlets,
--   COUNT(CASE WHEN movement_type = 'transfer_out'  THEN 1 END) AS transfer_out_outlets,
--   -- NRR inputs
--   ROUND(SUM(CASE WHEN movement_type = 'core_nrr' THEN apr_gmv ELSE 0 END)) AS nrr_base_apr,
--   ROUND(SUM(CASE WHEN movement_type = 'core_nrr' THEN may_gmv ELSE 0 END)) AS nrr_curr_may,
--   -- NRR% (daily-rate normalized)
--   ROUND(
--     SAFE_DIVIDE(
--       SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END) / 31.0,
--       SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END) / 30.0
--     ) * 100
--   , 2)                                            AS raw_nrr_pct,
--   -- NRR payout (default tier)
--   CASE
--     WHEN ROUND(SAFE_DIVIDE(
--       SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END)/31.0,
--       SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END)/30.0
--     )*100, 2) >= 102 THEN 7500
--     WHEN ROUND(SAFE_DIVIDE(
--       SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END)/31.0,
--       SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END)/30.0
--     )*100, 2) >= 99  THEN 5000
--     ELSE 0
--   END                                             AS nrr_payout,
--   -- Expansion commission
--   ROUND(SUM(COALESCE(expansion_commission, 0)))   AS expansion_commission_total,
--   -- Handover: ต้อง aggregate ที่ account level ก่อน (ดู Section 3)
--   '-- see handover section --'                    AS handover_note
-- FROM <above_query_as_subquery>
-- GROUP BY 1, 2, 3
-- ORDER BY tl_email, raw_nrr_pct DESC;
;
