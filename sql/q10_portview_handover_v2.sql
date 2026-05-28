-- Q10_V4: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- V4 Changes (rewrite จาก V3):
--   - ใช้ user_master เป็น base (source of truth ว่าร้านอยู่กับใครตอนนี้)
--   - ไม่ใช้ commercial_owner จาก order table เป็น filter หลักอีกต่อไป
--     เพราะ 1 ร้าน 1 เดือน มี commercial_owner ปนกันได้ (ช่วงโอน)
--   - prev_owner = commercial_owner ของ order ล่าสุดก่อน transfer month
--   - window 2 เดือน: M-1 (commission เดือนนี้) + M-2 (commission เดือนที่แล้ว)
--
-- Output schema (16 columns) — backward compatible:
--   [0]  kam_name               old KAM (ผู้ส่งออก / last KAM ก่อนโอน)
--   [1]  account_id
--   [2]  account_name
--   [3]  account_type
--   [4]  last_month_gmv         GMV เดือน M-1 (backward compat)
--   [5]  cur_month_gmv          GMV เดือน M MTD (backward compat)
--   [6]  new_owner_type         owner ปัจจุบัน จาก user_master
--   [7]  new_kam_name           KAM ปัจจุบัน จาก user_master
--   [8]  transfer_basis
--   [9]  last_order_date
--   [10] prev_owner             SALE/PM/ADMIN/KAM/NEW (order ล่าสุดก่อนโอน)
--   [11] transfer_month         YYYY-MM เดือนที่โอน
--   [12] baseline_gmv           GMV เต็มเดือน transfer_month
--   [13] perf_gmv               GMV เดือนถัดจาก transfer_month
--   [14] perf_days_in_month     จำนวนวันเดือนที่วัด performance
--   [15] baseline_days_in_month จำนวนวันเดือน baseline

WITH params AS (
  SELECT
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                              AS cm_start,
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))                    AS cm_max_date,
    DATE_DIFF(DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH),
              DATE_TRUNC(CURRENT_DATE(), MONTH), DAY)                              AS cm_days,
    FORMAT_DATE('%Y-%m', CURRENT_DATE())                                           AS cm_label,

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
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH))              AS m2_label,

    -- M-3 start สำหรับ prev_owner ของ M-2 window
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH)                 AS m3_start
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

-- ── user_master: source of truth ว่าตอนนี้ร้านอยู่กับใคร ─────────────────
user_master_current AS (
  SELECT
    CAST(account_guid AS STRING)       AS account_id,
    account_name,
    account_type,
    commercial_owner                   AS current_owner_type,
    staff_owner                        AS current_staff_owner,
    LOWER(TRIM(staff_owner_email))     AS current_staff_owner_email
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
    AND account_type IN ('SA', 'MC', 'Chain')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL
                AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),

-- join กับ KAM list เพื่อได้ mapped_kam_name
current_with_kam AS (
  SELECT
    um.*,
    k.kam_name  AS mapped_kam_name,
    k.kam_email AS mapped_kam_email
  FROM user_master_current um
  LEFT JOIN current_kam_list k
    ON um.current_staff_owner_email = k.kam_email
),

-- ── GMV รายเดือน ──────────────────────────────────────────────────────────
gmv_lm AS (
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN lm_start AND lm_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),
gmv_m2 AS (
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN m2_start AND m2_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),
gmv_cm AS (
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN cm_start AND cm_max_date
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── prev_owner: order ล่าสุดก่อนเดือนที่โอน ──────────────────────────────
-- M-1 window: ดู order ก่อน lm_start
prev_owner_for_lm AS (
  SELECT
    CAST(account_id AS STRING) AS account_id,
    commercial_owner           AS prev_owner,
    ka_owner                   AS prev_kam,
    delivery_date              AS prev_order_date
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND delivery_date < (SELECT lm_start FROM params)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(account_id AS STRING)
    ORDER BY delivery_date DESC
  ) = 1
),
-- M-2 window: ดู order ก่อน m2_start
prev_owner_for_m2 AS (
  SELECT
    CAST(account_id AS STRING) AS account_id,
    commercial_owner           AS prev_owner,
    ka_owner                   AS prev_kam,
    delivery_date              AS prev_order_date
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND delivery_date < (SELECT m2_start FROM params)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(account_id AS STRING)
    ORDER BY delivery_date DESC
  ) = 1
),

-- ── last order date per account (สำหรับ last_order_date field) ────────────
last_order AS (
  SELECT
    CAST(account_id AS STRING) AS account_id,
    MAX(delivery_date)         AS last_order_date
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── ร้านที่โอนเข้า KAM ใน M-1 ────────────────────────────────────────────
-- Base: user_master บอกว่าตอนนี้เป็น KAM แล้ว
-- Detect transfer: prev_owner (ก่อน lm_start) ไม่ใช่ KAM เดิม
-- หรือ prev_owner เป็น KAM แต่ ka_owner ต่างกัน (KAM→KAM transfer)
transfers_lm AS (
  SELECT
    cw.account_id,
    cw.account_name,
    cw.account_type,
    COALESCE(cw.mapped_kam_name, cw.current_staff_owner) AS new_kam_name,
    cw.current_owner_type                                AS new_owner_type,
    COALESCE(po.prev_kam, po.prev_owner, 'NEW')          AS old_kam_name,
    COALESCE(po.prev_owner, 'NEW')                       AS prev_owner,
    lo.last_order_date,
    p.lm_label                                           AS transfer_month,
    p.lm_days                                            AS baseline_days
  FROM current_with_kam cw, params p
  LEFT JOIN prev_owner_for_lm po USING (account_id)
  LEFT JOIN last_order lo        USING (account_id)
  -- เฉพาะร้านที่ตอนนี้เป็น KAM
  WHERE cw.current_owner_type = 'KAM'
    AND cw.mapped_kam_name IS NOT NULL  -- อยู่ใน active KAM list
    AND (
      -- โอนมาจาก non-KAM
      COALESCE(po.prev_owner, 'NEW') != 'KAM'
      OR (
        -- KAM→KAM: prev_kam ต่างจาก new_kam
        po.prev_owner = 'KAM'
        AND LOWER(TRIM(COALESCE(po.prev_kam, '')))
            != LOWER(TRIM(COALESCE(cw.mapped_kam_name, '')))
      )
    )
    -- มี activity ใน M-1 หรือ M (ไม่ใช่ร้าน dormant นานมาก)
    AND (
      lo.last_order_date >= p.m2_start
      OR lo.last_order_date IS NULL
    )
),

-- ── ร้านที่โอนเข้า KAM ใน M-2 ────────────────────────────────────────────
-- ต้องดูว่า M-2 เป็น KAM แต่ M-3 ไม่ใช่ — ใช้ snapshot จาก order table
-- เพราะ user_master บอกแค่ current state ไม่ใช่ historical
transfers_m2 AS (
  SELECT
    CAST(o_lm.account_id AS STRING)                                 AS account_id,
    MAX(o_lm.account_name)                                          AS account_name,
    MAX(o_lm.account_type)                                          AS account_type,
    -- new_kam ณ M-2 = ka_owner ที่มี GMV มากสุดใน M-2
    ARRAY_AGG(o_lm.ka_owner
              ORDER BY o_lm.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]    AS new_kam_name,
    'KAM'                                                           AS new_owner_type,
    COALESCE(po.prev_kam, po.prev_owner, 'NEW')                     AS old_kam_name,
    COALESCE(po.prev_owner, 'NEW')                                  AS prev_owner,
    MAX(o_lm.delivery_date)                                         AS last_order_date,
    p.m2_label                                                      AS transfer_month,
    p.m2_days                                                       AS baseline_days
  FROM `freshket-rn.dwh.order` o_lm, params p
  LEFT JOIN prev_owner_for_m2 po
    ON CAST(o_lm.account_id AS STRING) = po.account_id
  WHERE o_lm.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o_lm.commercial_owner = 'KAM'
    AND o_lm.ka_owner IS NOT NULL AND TRIM(o_lm.ka_owner) != ''
    AND o_lm.account_type IN ('SA', 'MC', 'Chain')
    AND (
      COALESCE(po.prev_owner, 'NEW') != 'KAM'
      OR (
        po.prev_owner = 'KAM'
        AND LOWER(TRIM(COALESCE(po.prev_kam, '')))
            != LOWER(TRIM(o_lm.ka_owner))
      )
    )
  GROUP BY CAST(o_lm.account_id AS STRING), po.prev_owner, po.prev_kam,
           p.m2_label, p.m2_days
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(o_lm.account_id AS STRING)
    ORDER BY SUM(o_lm.gmv_ex_vat) DESC
  ) = 1
),

-- ── รวม 2 windows ─────────────────────────────────────────────────────────
combined AS (
  -- M-1 window
  SELECT
    t.old_kam_name                                        AS kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)             AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)             AS cur_month_gmv,
    t.new_owner_type,
    t.new_kam_name,
    'transfer_lm'                                         AS transfer_basis,
    CAST(t.last_order_date AS STRING)                     AS last_order_date,
    t.prev_owner,
    t.transfer_month,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)             AS baseline_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)             AS perf_gmv,
    p.cm_days                                             AS perf_days_in_month,
    t.baseline_days                                       AS baseline_days_in_month
  FROM transfers_lm t, params p
  LEFT JOIN gmv_lm lm USING (account_id)
  LEFT JOIN gmv_cm cm USING (account_id)

  UNION ALL

  -- M-2 window
  SELECT
    t.old_kam_name                                        AS kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(m2.gmv, 0)) AS INT64)             AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)             AS cur_month_gmv,
    t.new_owner_type,
    t.new_kam_name,
    'transfer_m2'                                         AS transfer_basis,
    CAST(t.last_order_date AS STRING)                     AS last_order_date,
    t.prev_owner,
    t.transfer_month,
    CAST(ROUND(COALESCE(m2.gmv, 0)) AS INT64)             AS baseline_gmv,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)             AS perf_gmv,
    p.lm_days                                             AS perf_days_in_month,
    t.baseline_days                                       AS baseline_days_in_month
  FROM transfers_m2 t, params p
  LEFT JOIN gmv_m2 m2 USING (account_id)
  LEFT JOIN gmv_lm lm USING (account_id)
  LEFT JOIN gmv_cm cm USING (account_id)
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
-- dedupe: ถ้าร้านเดียวกันอยู่ใน 2 windows ให้เอาแค่ record ล่าสุด
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY account_id, transfer_month
  ORDER BY last_order_date DESC
) = 1
ORDER BY transfer_month DESC, kam_name, last_month_gmv DESC
