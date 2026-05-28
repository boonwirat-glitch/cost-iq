-- Q10_V5: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- V5 Changes (rewrite จาก V4):
--   - ใช้ ka_owner จาก order table เป็น key หลัก
--     เพราะ ka_owner บอกว่า KAM คนไหนรับผิดชอบ order นั้น
--     โดยไม่สนว่า commercial_owner เป็นอะไร (แก้ปัญหา SALE/KAM ปนกันใน transfer month)
--   - Transfer detect: ka_owner ใน M-1 ต่างจาก ka_owner/commercial_owner ใน M-2
--   - prev_owner = commercial_owner ของ order ล่าสุดก่อน transfer month
--   - window 2 เดือน: M-1 + M-2
--
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

-- ── ka_owner หลักของแต่ละร้านในแต่ละเดือน (เอา KAM ที่มี GMV มากสุด) ────
ka_owner_lm AS (
  SELECT
    CAST(account_id AS STRING)                                                     AS account_id,
    ARRAY_AGG(account_name ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]           AS account_name,
    ARRAY_AGG(account_type ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]           AS account_type,
    ARRAY_AGG(ka_owner    ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]            AS ka_owner,
    ARRAY_AGG(commercial_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS commercial_owner,
    MAX(delivery_date)                                                             AS last_order_date
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN lm_start AND lm_end
    AND account_type IN ('SA', 'MC', 'Chain')
    AND ka_owner IS NOT NULL AND TRIM(ka_owner) != ''
  GROUP BY 1
),
ka_owner_m2 AS (
  SELECT
    CAST(account_id AS STRING)                                                     AS account_id,
    ARRAY_AGG(ka_owner    ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]            AS ka_owner,
    ARRAY_AGG(commercial_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]       AS commercial_owner
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN m2_start AND m2_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── prev_owner: order ล่าสุดก่อนเดือนที่โอน ──────────────────────────────
prev_owner_for_lm AS (
  SELECT
    CAST(account_id AS STRING) AS account_id,
    commercial_owner           AS prev_owner,
    ka_owner                   AS prev_kam
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND delivery_date < (SELECT lm_start FROM params)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(account_id AS STRING)
    ORDER BY delivery_date DESC
  ) = 1
),
prev_owner_for_m2 AS (
  SELECT
    CAST(account_id AS STRING) AS account_id,
    commercial_owner           AS prev_owner,
    ka_owner                   AS prev_kam
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND delivery_date < (SELECT m2_start FROM params)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(account_id AS STRING)
    ORDER BY delivery_date DESC
  ) = 1
),

-- ── user_master: current owner สำหรับ new_kam_name field ─────────────────
user_master_current AS (
  SELECT
    CAST(account_guid AS STRING)       AS account_id,
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
      lasted_order_date DESC NULLS LAST
  ) = 1
),
current_with_kam AS (
  SELECT
    um.account_id,
    um.current_owner_type,
    COALESCE(k.kam_name, um.current_staff_owner) AS mapped_kam_name
  FROM user_master_current um
  LEFT JOIN current_kam_list k ON um.current_staff_owner_email = k.kam_email
),

-- ── M-1 transfers: ka_owner ใน M-1 ต่างจาก M-2 ──────────────────────────
transfers_lm AS (
  SELECT
    lm.account_id,
    lm.account_name,
    lm.account_type,
    lm.ka_owner                                    AS new_kam_name,  -- KAM ที่รับใน M-1
    COALESCE(m2.ka_owner, po.prev_kam, 'NEW')      AS old_kam_name,  -- KAM เดิม
    COALESCE(po.prev_owner, 'NEW')                 AS prev_owner,    -- commercial_owner ก่อนโอน
    lm.last_order_date,
    p.lm_label                                     AS transfer_month,
    p.lm_days                                      AS baseline_days
  FROM ka_owner_lm lm, params p
  LEFT JOIN ka_owner_m2 m2    USING (account_id)
  LEFT JOIN prev_owner_for_lm po USING (account_id)
  -- เฉพาะ KAM ใน active list
  JOIN current_kam_list k ON LOWER(TRIM(lm.ka_owner)) = LOWER(TRIM(k.kam_name))
  WHERE
    -- ka_owner เปลี่ยนจาก M-2
    LOWER(TRIM(lm.ka_owner)) != LOWER(TRIM(COALESCE(m2.ka_owner, '')))
    OR m2.account_id IS NULL  -- ไม่มีใน M-2 = ร้านใหม่/ไม่มี order ก่อนหน้า
),

-- ── M-2 transfers: ka_owner ใน M-2 ต่างจาก M-3 ──────────────────────────
transfers_m2 AS (
  SELECT
    m2.account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]   AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]   AS account_type,
    m2.ka_owner                                    AS new_kam_name,
    COALESCE(po.prev_kam, po.prev_owner, 'NEW')    AS old_kam_name,
    COALESCE(po.prev_owner, 'NEW')                 AS prev_owner,
    MAX(o.delivery_date)                           AS last_order_date,
    p.m2_label                                     AS transfer_month,
    p.m2_days                                      AS baseline_days
  FROM ka_owner_m2 m2, params p
  JOIN `freshket-rn.dwh.order` o
    ON CAST(o.account_id AS STRING) = m2.account_id
    AND o.delivery_date BETWEEN p.m2_start AND p.m2_end
  LEFT JOIN prev_owner_for_m2 po USING (account_id)
  JOIN current_kam_list k ON LOWER(TRIM(m2.ka_owner)) = LOWER(TRIM(k.kam_name))
  WHERE
    LOWER(TRIM(m2.ka_owner)) != LOWER(TRIM(COALESCE(po.prev_kam, '')))
    OR po.prev_owner != 'KAM'
    OR po.account_id IS NULL
  GROUP BY m2.account_id, m2.ka_owner, po.prev_owner, po.prev_kam,
           p.m2_label, p.m2_days
),

-- ── รวม + เพิ่ม GMV fields ────────────────────────────────────────────────
combined AS (
  -- M-1 window
  SELECT
    t.old_kam_name                                        AS kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(lm.gmv, 0)) AS INT64)             AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)             AS cur_month_gmv,
    COALESCE(cw.current_owner_type, 'KAM')                AS new_owner_type,
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
  LEFT JOIN current_with_kam cw USING (account_id)

  UNION ALL

  -- M-2 window
  SELECT
    t.old_kam_name                                        AS kam_name,
    t.account_id,
    t.account_name,
    t.account_type,
    CAST(ROUND(COALESCE(m2.gmv, 0)) AS INT64)             AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)             AS cur_month_gmv,
    COALESCE(cw.current_owner_type, 'KAM')                AS new_owner_type,
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
  LEFT JOIN current_with_kam cw USING (account_id)
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
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY account_id, transfer_month
  ORDER BY last_order_date DESC
) = 1
ORDER BY transfer_month DESC, new_kam_name, last_month_gmv DESC
