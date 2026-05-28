-- Q10_V2: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- V2 Changes (Handover Commission — Tactic B):
--   - ขยาย window เป็น 2 เดือน (เดือนนี้ + เดือนก่อน) เพื่อให้เดือนนี้ยังเห็นร้านที่โอนเดือนก่อน
--   - เพิ่ม column: transfer_month (YYYY-MM) — เดือนที่เกิดการโอน
--   - เพิ่ม column: baseline_gmv — GMV เต็มเดือนที่โอน (= last_month_gmv ของเดือนนั้น)
--   - เพิ่ม column: perf_gmv — GMV เดือนถัดจาก transfer_month (เดือนที่วัด performance)
--   - เพิ่ม column: perf_days_in_month — จำนวนวันในเดือนที่วัด (สำหรับ normalize)
--   - Logic commission: วัด performance เดือน M+1 เทียบกับ baseline เดือน M (normalize ทั้งคู่ ÷ days × 30)
--
-- Output schema (11 columns):
--   kam_name, account_id, account_name, account_type,
--   last_month_gmv, cur_month_gmv,
--   new_owner_type, new_kam_name,
--   transfer_basis, last_order_date,
--   transfer_month, baseline_gmv, perf_gmv, perf_days_in_month

WITH params AS (
  SELECT
    -- เดือนนี้ (current month = performance month M)
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                        AS cm_start,
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                        AS cm_month_start,
    (
      SELECT MAX(delivery_date)
      FROM `freshket-rn.dwh.order`
      WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
    )                                                                         AS cm_max_date,
    DATE_DIFF(
      DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH),
      DATE_TRUNC(CURRENT_DATE(), MONTH),
      DAY
    )                                                                         AS cm_days_in_month,

    -- เดือนก่อน (last month = transfer month M-1 = baseline)
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)            AS lm_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)              AS lm_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))         AS lm_label,

    -- 2 เดือนก่อน (two months ago = transfer month M-2 → performance วัดเดือนก่อน)
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH), MONTH)            AS mm_start,
    DATE_SUB(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH), INTERVAL 1 DAY) AS mm_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH))         AS mm_label,

    FORMAT_DATE('%Y-%m', CURRENT_DATE())                                      AS cm_label
),

current_kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Pavarisa (Ploiiy) Muangtaeng'           AS kam_name, 'pavarisa.mu@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE
        WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0
        ELSE 1
      END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),

current_master_owner AS (
  SELECT
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name AS master_account_name,
    um.account_type AS master_account_type,
    um.commercial_owner AS current_owner_type,
    um.staff_owner AS master_staff_owner,
    LOWER(TRIM(um.staff_owner_email)) AS master_staff_owner_email,
    k.kam_name AS mapped_kam_name,
    k.kam_email AS mapped_kam_email
  FROM user_master_current um
  LEFT JOIN current_kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
),

-- ── GMV รายเดือนสำหรับ 3 เดือน (M-2, M-1, M) ──────────────────────────────
gmv_by_month AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    DATE_TRUNC(o.delivery_date, MONTH) AS order_month,
    o.ka_owner,
    SUM(o.gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date >= p.mm_start   -- ครอบ 3 เดือน: M-2, M-1, M
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1, 2, 3
),

-- ── ร้านที่เปลี่ยน owner เดือน M-1 (โอน last month) ──────────────────────
-- baseline = GMV เดือน M-1 ทั้งเดือน, performance = GMV เดือน M (current)
transfers_last_month AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_type,
    o.ka_owner AS old_kam_name,
    SUM(o.gmv_ex_vat) AS last_month_gmv,
    MAX(o.delivery_date) AS last_order_date_in_lm,
    'last_month_kam' AS transfer_basis,
    p.lm_label AS transfer_month,
    DATE_DIFF(
      DATE_ADD(p.lm_start, INTERVAL 1 MONTH),
      p.lm_start,
      DAY
    ) AS baseline_days_in_month
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.lm_start AND p.lm_end
    AND o.commercial_owner = 'KAM'
    AND o.ka_owner IS NOT NULL AND TRIM(o.ka_owner) != ''
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY CAST(o.account_id AS STRING), o.ka_owner, p.lm_label, p.lm_start
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY SUM(o.gmv_ex_vat) DESC, MAX(o.delivery_date) DESC
  ) = 1
),

-- ── ร้านที่เปลี่ยน owner เดือน M-2 (โอน 2 เดือนก่อน) ───────────────────
-- baseline = GMV เดือน M-2 ทั้งเดือน, performance = GMV เดือน M-1
transfers_two_months_ago AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_type,
    o.ka_owner AS old_kam_name,
    SUM(o.gmv_ex_vat) AS last_month_gmv,
    MAX(o.delivery_date) AS last_order_date_in_mm,
    'last_month_kam' AS transfer_basis,
    p.mm_label AS transfer_month,
    DATE_DIFF(
      DATE_ADD(p.mm_start, INTERVAL 1 MONTH),
      p.mm_start,
      DAY
    ) AS baseline_days_in_month
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.mm_start AND p.mm_end
    AND o.commercial_owner = 'KAM'
    AND o.ka_owner IS NOT NULL AND TRIM(o.ka_owner) != ''
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY CAST(o.account_id AS STRING), o.ka_owner, p.mm_label, p.mm_start
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY SUM(o.gmv_ex_vat) DESC, MAX(o.delivery_date) DESC
  ) = 1
),

-- ── GMV เดือนปัจจุบัน (M) — สำหรับร้านที่โอนเดือน M-1 ──────────────────
cur_month_gmv AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    SUM(o.gmv_ex_vat) AS perf_gmv
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.cm_start AND p.cm_max_date
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── GMV เดือน M-1 — สำหรับร้านที่โอนเดือน M-2 ───────────────────────────
last_month_gmv_for_perf AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    SUM(o.gmv_ex_vat) AS perf_gmv
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.lm_start AND p.lm_end
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

last_known_owner AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    o.account_name,
    o.account_type,
    o.commercial_owner AS last_owner,
    o.ka_owner AS last_ka_owner,
    o.delivery_date AS last_order_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA', 'MC', 'Chain')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(o.account_id AS STRING)
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── รวม transfers ทั้ง 2 เดือน ────────────────────────────────────────────
transfer_combined AS (
  -- ร้านที่โอนเดือน M-1 → วัด performance เดือน M
  SELECT
    t.old_kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    ROUND(t.last_month_gmv) AS last_month_gmv,  -- GMV เดือนโอน (baseline)
    t.last_order_date_in_lm AS last_order_date,
    t.transfer_basis,
    t.transfer_month,
    ROUND(t.last_month_gmv) AS baseline_gmv,
    t.baseline_days_in_month,
    COALESCE(cm.perf_gmv, 0) AS perf_gmv,
    p.cm_days_in_month AS perf_days_in_month
  FROM transfers_last_month t, params p
  LEFT JOIN cur_month_gmv cm USING (account_id)

  UNION ALL

  -- ร้านที่โอนเดือน M-2 → วัด performance เดือน M-1
  SELECT
    t.old_kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    ROUND(t.last_month_gmv) AS last_month_gmv,  -- GMV เดือนโอน (baseline)
    t.last_order_date_in_mm AS last_order_date,
    t.transfer_basis,
    t.transfer_month,
    ROUND(t.last_month_gmv) AS baseline_gmv,
    t.baseline_days_in_month,
    COALESCE(lm.perf_gmv, 0) AS perf_gmv,
    DATE_DIFF(
      DATE_ADD(p.lm_start, INTERVAL 1 MONTH),
      p.lm_start,
      DAY
    ) AS perf_days_in_month
  FROM transfers_two_months_ago t, params p
  LEFT JOIN last_month_gmv_for_perf lm USING (account_id)
),

movement_rows AS (
  SELECT
    tc.old_kam_name AS kam_name,
    tc.account_id,
    tc.account_name,
    tc.account_type,
    CAST(tc.last_month_gmv AS INT64) AS last_month_gmv,
    -- cur_month_gmv = perf_gmv ของ transfer เดือน M-1 (current window เท่านั้น)
    CAST(ROUND(COALESCE(cm.perf_gmv, 0)) AS INT64) AS cur_month_gmv,
    COALESCE(cmo.current_owner_type, lko.last_owner, 'none') AS new_owner_type,
    CASE
      WHEN cmo.mapped_kam_name IS NOT NULL
        THEN cmo.mapped_kam_name
      WHEN cmo.account_id IS NOT NULL
        THEN COALESCE(cmo.master_staff_owner, cmo.master_staff_owner_email, 'none')
      ELSE COALESCE(lko.last_ka_owner, 'none')
    END AS new_kam_name,
    tc.transfer_basis,
    CAST(tc.last_order_date AS STRING) AS last_order_date,
    -- V2: commission columns
    tc.transfer_month,
    CAST(tc.baseline_gmv AS INT64) AS baseline_gmv,
    CAST(ROUND(tc.perf_gmv) AS INT64) AS perf_gmv,
    tc.perf_days_in_month,
    tc.baseline_days_in_month
  FROM transfer_combined tc
  LEFT JOIN cur_month_gmv cm ON cm.account_id = tc.account_id  -- for cur_month_gmv backward compat
  LEFT JOIN current_master_owner cmo ON cmo.account_id = tc.account_id
  LEFT JOIN last_known_owner lko ON lko.account_id = tc.account_id
  WHERE
    (
      cmo.mapped_kam_name IS NOT NULL
      AND LOWER(TRIM(cmo.mapped_kam_name)) != LOWER(TRIM(tc.old_kam_name))
    )
    OR (
      cmo.account_id IS NOT NULL
      AND (
        cmo.mapped_kam_name IS NULL
        OR cmo.current_owner_type != 'KAM'
      )
    )
    OR (
      cmo.account_id IS NULL
      AND lko.last_owner = 'KAM'
      AND LOWER(TRIM(lko.last_ka_owner)) != LOWER(TRIM(tc.old_kam_name))
    )
    OR (
      cmo.account_id IS NULL
      AND lko.last_owner IN ('SALE', 'PM', 'ADMIN')
    )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY tc.account_id, tc.old_kam_name, tc.transfer_month
    ORDER BY tc.last_month_gmv DESC, tc.last_order_date DESC
  ) = 1
),

cleaned AS (
  SELECT *
  FROM movement_rows
  WHERE NOT (
    transfer_basis = 'dormant_last_known_kam'
    AND COALESCE(last_month_gmv, 0) = 0
    AND COALESCE(cur_month_gmv, 0) = 0
  )
)

SELECT
  kam_name,
  account_id,
  account_name,
  account_type,
  last_month_gmv,
  cur_month_gmv,
  new_owner_type,
  new_kam_name,
  transfer_basis,
  last_order_date,
  -- V2: commission fields
  transfer_month,
  baseline_gmv,
  perf_gmv,
  perf_days_in_month,
  baseline_days_in_month
FROM cleaned
ORDER BY
  transfer_month DESC,
  kam_name,
  last_month_gmv DESC,
  last_order_date DESC
