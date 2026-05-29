-- ============================================================
-- Q8E v2 — Portview Enriched (Simplified)
-- ============================================================
-- Purpose : portview.csv — account/outlet list per KAM
-- Grain   : outlet level (res_id) — 1 row per res_id
-- Key change from Q8E v1:
--   - Source of truth: dim.user_master (staff_owner_email + commercial_owner)
--   - No order fallback — user_master is kept up-to-date daily
--   - JOIN to dwh.order via res_id (not account_guid) to handle
--     account_id changes after account renames/merges
--   - days_with_current_kam removed from portview — kept in Q11
--   - GMV columns computed from dwh.order (no status filter)
-- ============================================================

WITH

params AS (
  SELECT
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                        AS cur_month_start,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)            AS last_month_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)             AS last_month_end,
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))               AS max_delivery_date
),

params_derived AS (
  SELECT *,
    DATE_DIFF(max_delivery_date, cur_month_start, DAY) + 1                  AS days_elapsed,
    EXTRACT(DAY FROM DATE_SUB(
      DATE_TRUNC(DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH),
      INTERVAL 1 DAY))                                                       AS days_in_month
  FROM params
),

-- ── KAM list (source of truth for ownership) ─────────────────
-- Filter: commercial_owner = KAM + has staff_owner_email
-- Dedup: 1 row per res_id (outlet), latest lasted_order_date wins
kam_outlets AS (
  SELECT
    CAST(um.res_id       AS STRING)        AS res_id,
    CAST(um.account_guid AS STRING)        AS account_id,
    um.account_name,
    um.res_name,
    um.account_type,
    TRIM(COALESCE(
      NULLIF(um.staff_owner, ''),
      NULLIF(um.kam_owner, ''),
      NULLIF(um.ka_owner, ''), ''
    ))                                     AS kam_name,
    LOWER(TRIM(um.staff_owner_email))      AS kam_email,
    um.account_class,
    DATE(um.new_user_exp_date)             AS new_user_exp_date,
    DATE(um.lasted_order_date)             AS lasted_order_date,
    DATE(um.first_dollar_date)             AS first_dollar_date
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA', 'MC', 'Chain')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
    AND um.staff_owner_email IS NOT NULL
    AND TRIM(um.staff_owner_email) != ''
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── TL mapping (from user_master or separate TL table) ────────
-- ใช้ staff_owner_email prefix เพื่อ map TL (ถ้ามี tl_email field ให้เปลี่ยนตรงนี้)
-- ปัจจุบัน map จาก kam_email → tl_email ผ่าน logic ที่รู้
tl_map AS (
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
    STRUCT('Pavarisa (Ploiiy) Muangtaeng'         AS kam_name, 'pavarisa.mu@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── GMV current month (JOIN via res_id) ───────────────────────
gmv_cur AS (
  SELECT
    CAST(o.user_id AS STRING)  AS res_id,
    SUM(o.gmv_ex_vat)          AS cur_gmv,
    MAX(o.delivery_date)       AS cur_last_order
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.account_type IN ('SA', 'MC', 'Chain')
    AND o.delivery_date BETWEEN p.cur_month_start AND p.max_delivery_date
  GROUP BY 1
),

-- ── GMV last month (JOIN via res_id) ──────────────────────────
gmv_last AS (
  SELECT
    CAST(o.user_id AS STRING)  AS res_id,
    SUM(o.gmv_ex_vat)          AS last_gmv,
    MAX(o.delivery_date)       AS last_last_order
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.account_type IN ('SA', 'MC', 'Chain')
    AND o.delivery_date BETWEEN p.last_month_start AND p.last_month_end
  GROUP BY 1
),

-- ── Baseline 3-month average (via res_id) ────────────────────
gmv_baseline AS (
  SELECT
    CAST(o.user_id AS STRING)  AS res_id,
    SUM(o.gmv_ex_vat) / 3      AS baseline_gmv_avg
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.account_type IN ('SA', 'MC', 'Chain')
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH)
    AND o.delivery_date < p.cur_month_start
  GROUP BY 1
)

-- ── Final output ──────────────────────────────────────────────
SELECT
  ko.res_id,
  ko.account_id,
  ko.account_name,
  ko.res_name,
  ko.account_type,
  ko.account_class,
  ko.kam_name,
  ko.kam_email,
  COALESCE(tm.tl_email, '')                          AS tl_email,
  COALESCE(tm.tl_name, '')                           AS tl_name,

  -- GMV
  ROUND(COALESCE(gc.cur_gmv, 0), 2)                 AS cur_month_gmv,
  ROUND(COALESCE(gl.last_gmv, 0), 2)                AS last_month_gmv,
  ROUND(COALESCE(gb.baseline_gmv_avg, 0), 2)        AS baseline_3mo_avg,

  -- Last order dates
  gc.cur_last_order,
  gl.last_last_order,
  ko.lasted_order_date                               AS master_last_order,
  ko.first_dollar_date,

  -- Run rate (current MTD vs last month)
  CASE
    WHEN COALESCE(gl.last_gmv, 0) > 0 AND p.days_in_month > 0
    THEN ROUND(
      (COALESCE(gc.cur_gmv, 0) / GREATEST(p.days_elapsed, 1))
      / (gl.last_gmv / p.days_in_month) * 100, 1)
    ELSE NULL
  END                                                AS run_rate_pct,

  -- Metadata
  ko.new_user_exp_date,
  p.days_elapsed,
  p.days_in_month,
  FORMAT_DATE('%Y-%m', CURRENT_DATE())               AS perf_month

FROM kam_outlets ko
CROSS JOIN params_derived p
LEFT JOIN tl_map      tm ON tm.kam_email  = ko.kam_email
LEFT JOIN gmv_cur     gc ON gc.res_id     = ko.res_id
LEFT JOIN gmv_last    gl ON gl.res_id     = ko.res_id
LEFT JOIN gmv_baseline gb ON gb.res_id   = ko.res_id

ORDER BY ko.kam_email, ko.account_name, ko.res_name;
