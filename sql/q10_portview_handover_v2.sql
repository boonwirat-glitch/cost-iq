-- Q10_V6: portview_handover.csv
-- V6: ใช้ staff_owner เป็น source of truth detect transfer
-- Logic:
--   1. หาวันแรกที่ staff_owner เปลี่ยน = วันโอนจริง
--   2. prev_owner = commercial_owner ของ order ล่าสุดก่อนวันโอน
--   3. new_owner  = commercial_owner ของ order วันโอนและหลัง
--   4. Sales→KAM = prev_owner=SALE และ new_owner=KAM
-- Output schema (16 columns) — backward compatible

WITH params AS (
  SELECT
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                              AS cm_start,
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))                    AS cm_max_date,
    DATE_DIFF(DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH),
              DATE_TRUNC(CURRENT_DATE(), MONTH), DAY)                              AS cm_days,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)                 AS lm_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)                   AS lm_end,
    DATE_DIFF(DATE_TRUNC(CURRENT_DATE(), MONTH),
              DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH), DAY) AS lm_days,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))              AS lm_label,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH), MONTH)                 AS m2_start,
    DATE_SUB(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH),
             INTERVAL 1 DAY)                                                       AS m2_end,
    DATE_DIFF(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH),
              DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH), MONTH), DAY) AS m2_days,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH))              AS m2_label
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

-- ── daily staff_owner per account ─────────────────────────────────────────
-- เอา staff_owner ที่มี GMV มากสุดในแต่ละวัน
daily AS (
  SELECT
    CAST(account_id AS STRING)                                                     AS aid,
    delivery_date,
    ARRAY_AGG(account_name     ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS account_name,
    ARRAY_AGG(account_type     ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS account_type,
    ARRAY_AGG(staff_owner      ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS staff_owner,
    ARRAY_AGG(commercial_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS commercial_owner
  FROM `freshket-rn.dwh.order`, params
  -- ดึง 3 เดือน ครอบทั้ง M-2 และ M
  WHERE delivery_date BETWEEN m2_start AND cm_max_date
    AND account_type IN ('SA', 'MC', 'Chain')
    AND staff_owner IS NOT NULL AND TRIM(staff_owner) != ''
  GROUP BY 1, 2
),

-- ── detect วันที่ staff_owner เปลี่ยน ────────────────────────────────────
with_prev AS (
  SELECT
    aid,
    delivery_date,
    account_name,
    account_type,
    staff_owner,
    commercial_owner,
    LAG(staff_owner)      OVER (PARTITION BY aid ORDER BY delivery_date) AS prev_staff_owner,
    LAG(commercial_owner) OVER (PARTITION BY aid ORDER BY delivery_date) AS prev_commercial_owner
  FROM daily
),

-- ── วันโอน = วันแรกที่ staff_owner เปลี่ยน ───────────────────────────────
transfer_days AS (
  SELECT
    aid,
    delivery_date                                    AS transfer_date,
    account_name,
    account_type,
    staff_owner                                      AS new_staff_owner,    -- KAM ใหม่ที่รับ
    commercial_owner                                 AS new_commercial_owner,
    prev_staff_owner                                 AS old_staff_owner,    -- KAM เดิม
    prev_commercial_owner                            AS prev_commercial_owner -- owner ก่อนโอน
  FROM with_prev
  WHERE staff_owner != prev_staff_owner              -- เปลี่ยน staff = โอน
    AND prev_staff_owner IS NOT NULL                 -- ไม่ใช่ order แรก
),

-- ── filter เฉพาะ KAM ที่อยู่ใน active list ───────────────────────────────
transfer_to_active_kam AS (
  SELECT
    t.aid,
    t.transfer_date,
    t.account_name,
    t.account_type,
    t.new_staff_owner                                AS new_kam_name,
    t.new_commercial_owner,
    t.old_staff_owner                                AS old_kam_name,
    t.prev_commercial_owner                          AS prev_owner,
    FORMAT_DATE('%Y-%m', t.transfer_date)            AS transfer_month
  FROM transfer_days t
  JOIN current_kam_list k
    ON LOWER(TRIM(t.new_staff_owner)) = LOWER(TRIM(k.kam_name))
  -- เฉพาะ transfer ใน window 2 เดือน (M-1 และ M-2)
  WHERE FORMAT_DATE('%Y-%m', t.transfer_date) IN (
    (SELECT lm_label FROM params),
    (SELECT m2_label FROM params)
  )
  -- เอา transfer แรกของแต่ละ account ต่อ KAM ต่อเดือน
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY t.aid, FORMAT_DATE('%Y-%m', t.transfer_date)
    ORDER BY t.transfer_date ASC
  ) = 1
),

-- ── GMV รายเดือน ──────────────────────────────────────────────────────────
gmv_lm AS (
  SELECT CAST(account_id AS STRING) AS aid, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN lm_start AND lm_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),
gmv_m2 AS (
  SELECT CAST(account_id AS STRING) AS aid, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN m2_start AND m2_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),
gmv_cm AS (
  SELECT CAST(account_id AS STRING) AS aid, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN cm_start AND cm_max_date
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── current owner จาก user_master ────────────────────────────────────────
cur_owner AS (
  SELECT
    CAST(account_guid AS STRING)      AS aid,
    commercial_owner                  AS current_owner_type,
    COALESCE(k.kam_name, staff_owner) AS mapped_kam_name
  FROM `freshket-rn.dim.user_master` um
  LEFT JOIN current_kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE account_guid IS NOT NULL
    AND account_type IN ('SA', 'MC', 'Chain')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL
                AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── รวม output ────────────────────────────────────────────────────────────
combined AS (
  -- M-1 window: โอนเดือน M-1 → baseline=GMV M-1, perf=GMV M
  SELECT
    t.old_kam_name                                    AS kam_name,
    t.aid                                             AS account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)         AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)         AS cur_month_gmv,
    COALESCE(co.current_owner_type, t.new_commercial_owner) AS new_owner_type,
    t.new_kam_name,
    'transfer_lm'                                     AS transfer_basis,
    CAST(t.transfer_date AS STRING)                   AS last_order_date,
    t.prev_owner,
    t.transfer_month,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)         AS baseline_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)         AS perf_gmv,
    p.cm_days                                         AS perf_days_in_month,
    p.lm_days                                         AS baseline_days_in_month
  FROM transfer_to_active_kam t
  CROSS JOIN params p
  LEFT JOIN gmv_lm lm ON t.aid = lm.aid
  LEFT JOIN gmv_cm cm ON t.aid = cm.aid
  LEFT JOIN cur_owner co ON t.aid = co.aid
  WHERE t.transfer_month = p.lm_label

  UNION ALL

  -- M-2 window: โอนเดือน M-2 → baseline=GMV M-2, perf=GMV M-1
  SELECT
    t.old_kam_name                                    AS kam_name,
    t.aid                                             AS account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(m2.gmv, 0)) AS INT64)         AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)         AS cur_month_gmv,
    COALESCE(co.current_owner_type, t.new_commercial_owner) AS new_owner_type,
    t.new_kam_name,
    'transfer_m2'                                     AS transfer_basis,
    CAST(t.transfer_date AS STRING)                   AS last_order_date,
    t.prev_owner,
    t.transfer_month,
    CAST(ROUND(COALESCE(m2.gmv, 0)) AS INT64)         AS baseline_gmv,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)         AS perf_gmv,
    p.lm_days                                         AS perf_days_in_month,
    p.m2_days                                         AS baseline_days_in_month
  FROM transfer_to_active_kam t
  CROSS JOIN params p
  LEFT JOIN gmv_m2 m2 ON t.aid = m2.aid
  LEFT JOIN gmv_lm lm ON t.aid = lm.aid
  LEFT JOIN gmv_cm cm ON t.aid = cm.aid
  LEFT JOIN cur_owner co ON t.aid = co.aid
  WHERE t.transfer_month = p.m2_label
)

SELECT
  kam_name, account_id, account_name, account_type,
  last_month_gmv, cur_month_gmv,
  new_owner_type, new_kam_name,
  transfer_basis, last_order_date,
  prev_owner, transfer_month,
  baseline_gmv, perf_gmv,
  perf_days_in_month, baseline_days_in_month
FROM combined
ORDER BY transfer_month DESC, new_kam_name, last_month_gmv DESC
