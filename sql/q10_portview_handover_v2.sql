-- Q10_V3: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- V3 Changes:
--   - เพิ่ม prev_owner (SALE/PM/ADMIN/KAM/NEW) — บอกว่าร้านมาจาก owner ไหนก่อนโอน
--   - ขยาย window เป็น 2 เดือน เพื่อให้เห็นร้านที่โอนเดือนก่อน (commission tactic B)
--   - เพิ่ม transfer_month (YYYY-MM), baseline_gmv, perf_gmv, perf_days_in_month, baseline_days_in_month
--   - backward compatible — columns เดิม 10 ตัวยังอยู่ครบ เพิ่มท้าย
--
-- Output schema (16 columns):
--   [0]  kam_name           — old KAM (ผู้ส่งออก)
--   [1]  account_id
--   [2]  account_name
--   [3]  account_type
--   [4]  last_month_gmv     — GMV เดือนก่อน (backward compat)
--   [5]  cur_month_gmv      — GMV เดือนนี้ MTD (backward compat)
--   [6]  new_owner_type     — owner ปัจจุบัน (KAM/SALE/PM/ADMIN)
--   [7]  new_kam_name       — KAM ที่รับ
--   [8]  transfer_basis
--   [9]  last_order_date
--   [10] prev_owner         — *** NEW *** SALE/PM/ADMIN/KAM/NEW
--   [11] transfer_month     — *** NEW *** YYYY-MM เดือนที่โอน
--   [12] baseline_gmv       — *** NEW *** GMV เต็มเดือนที่โอน (normalize base)
--   [13] perf_gmv           — *** NEW *** GMV เดือนถัดไป (วัด performance)
--   [14] perf_days_in_month — *** NEW *** จำนวนวันเดือนที่วัด
--   [15] baseline_days_in_month — *** NEW *** จำนวนวันเดือน baseline

WITH params AS (
  SELECT
    -- เดือนนี้ (M) = performance month สำหรับร้านที่โอนเดือนก่อน
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                              AS cm_start,
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))                    AS cm_max_date,
    DATE_DIFF(DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH),
              DATE_TRUNC(CURRENT_DATE(), MONTH), DAY)                              AS cm_days,
    FORMAT_DATE('%Y-%m', CURRENT_DATE())                                           AS cm_label,

    -- เดือนก่อน (M-1) = transfer month สำหรับ window หลัก
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)                 AS lm_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)                   AS lm_end,
    DATE_DIFF(DATE_TRUNC(CURRENT_DATE(), MONTH),
              DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH), DAY) AS lm_days,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))              AS lm_label,

    -- 2 เดือนก่อน (M-2) = transfer month สำหรับ window ขยาย
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

user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),

current_master_owner AS (
  SELECT
    CAST(um.account_guid AS STRING)    AS account_id,
    um.account_name                    AS master_account_name,
    um.account_type                    AS master_account_type,
    um.commercial_owner                AS current_owner_type,
    um.staff_owner                     AS master_staff_owner,
    LOWER(TRIM(um.staff_owner_email))  AS master_staff_owner_email,
    k.kam_name                         AS mapped_kam_name,
    k.kam_email                        AS mapped_kam_email
  FROM user_master_current um
  LEFT JOIN current_kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
),

last_known_owner AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    o.account_name,
    o.account_type,
    o.commercial_owner           AS last_owner,
    o.ka_owner                   AS last_ka_owner,
    o.delivery_date              AS last_order_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA', 'MC', 'Chain')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(o.account_id AS STRING)
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── GMV รายเดือนสำหรับทุก window ──────────────────────────────────────────
gmv_m2 AS (   -- M-2 ทั้งเดือน (baseline สำหรับร้านที่โอน M-2)
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN m2_start AND m2_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

gmv_lm AS (   -- M-1 ทั้งเดือน (baseline สำหรับร้านที่โอน M-1 / perf สำหรับร้านที่โอน M-2)
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN lm_start AND lm_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

gmv_cm AS (   -- M MTD (perf สำหรับร้านที่โอน M-1 / cur_month_gmv backward compat)
  SELECT CAST(account_id AS STRING) AS account_id, SUM(gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN cm_start AND cm_max_date
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── prev_owner: owner ก่อนโอน ─────────────────────────────────────────────
-- ดูจาก commercial_owner ใน M-2 (สำหรับร้านที่โอน M-1)
-- และ commercial_owner ใน M-3 (สำหรับร้านที่โอน M-2) — ใช้ last_known_owner แทนได้
prev_owner_lm AS (
  -- prev owner สำหรับร้านที่เดือน M-1 เพิ่งเปลี่ยน: ดูจาก M-2
  SELECT
    CAST(account_id AS STRING) AS account_id,
    ARRAY_AGG(commercial_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS prev_owner
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN m2_start AND m2_end
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- ── ร้านที่ old KAM มี GMV ใน M-1 (transfer month = M-1) ─────────────────
transfer_lm AS (
  SELECT
    CAST(o.account_id AS STRING)                                                  AS account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]      AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]      AS account_type,
    o.ka_owner                                                                     AS old_kam_name,
    SUM(o.gmv_ex_vat)                                                              AS last_month_gmv,
    MAX(o.delivery_date)                                                           AS last_order_date,
    'last_month_kam'                                                               AS transfer_basis,
    p.lm_label                                                                     AS transfer_month,
    p.lm_days                                                                      AS baseline_days
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.lm_start AND p.lm_end
    AND o.commercial_owner = 'KAM'
    AND o.ka_owner IS NOT NULL AND TRIM(o.ka_owner) != ''
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY CAST(o.account_id AS STRING), o.ka_owner, p.lm_label, p.lm_days
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY SUM(o.gmv_ex_vat) DESC, MAX(o.delivery_date) DESC
  ) = 1
),

-- ── ร้านที่ old KAM มี GMV ใน M-2 (transfer month = M-2) ─────────────────
transfer_m2 AS (
  SELECT
    CAST(o.account_id AS STRING)                                                  AS account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]      AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)]      AS account_type,
    o.ka_owner                                                                     AS old_kam_name,
    SUM(o.gmv_ex_vat)                                                              AS last_month_gmv,
    MAX(o.delivery_date)                                                           AS last_order_date,
    'last_month_kam'                                                               AS transfer_basis,
    p.m2_label                                                                     AS transfer_month,
    p.m2_days                                                                      AS baseline_days
  FROM `freshket-rn.dwh.order` o, params p
  WHERE o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o.commercial_owner = 'KAM'
    AND o.ka_owner IS NOT NULL AND TRIM(o.ka_owner) != ''
    AND o.account_type IN ('SA', 'MC', 'Chain')
  GROUP BY CAST(o.account_id AS STRING), o.ka_owner, p.m2_label, p.m2_days
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY SUM(o.gmv_ex_vat) DESC, MAX(o.delivery_date) DESC
  ) = 1
),

-- ── Dormant: ร้านที่ไม่มี GMV ใน M-1 แต่ last known = KAM ──────────────
dormant AS (
  SELECT
    lko.account_id,
    COALESCE(cmo.master_account_name, lko.account_name)  AS account_name,
    COALESCE(cmo.master_account_type, lko.account_type)  AS account_type,
    lko.last_ka_owner                                     AS old_kam_name,
    0                                                     AS last_month_gmv,
    lko.last_order_date,
    'dormant_last_known_kam'                              AS transfer_basis,
    p.lm_label                                            AS transfer_month,
    p.lm_days                                             AS baseline_days
  FROM last_known_owner lko, params p
  LEFT JOIN transfer_lm tlm USING (account_id)
  LEFT JOIN current_master_owner cmo USING (account_id)
  WHERE tlm.account_id IS NULL
    AND lko.last_owner = 'KAM'
    AND lko.last_ka_owner IS NOT NULL
    AND TRIM(lko.last_ka_owner) != ''
),

-- ── รวม transfers ทั้งหมด ─────────────────────────────────────────────────
transfer_all AS (
  SELECT *, 'lm' AS window_tag FROM transfer_lm
  UNION ALL
  SELECT *, 'm2' AS window_tag FROM transfer_m2
  UNION ALL
  SELECT *, 'dormant' AS window_tag FROM dormant
),

movement_rows AS (
  SELECT
    ta.old_kam_name                                        AS kam_name,
    ta.account_id,
    ta.account_name,
    ta.account_type,
    -- [4] backward compat
    CAST(ROUND(ta.last_month_gmv) AS INT64)                AS last_month_gmv,
    -- [5] backward compat: cur_month_gmv = MTD เดือนนี้
    CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)              AS cur_month_gmv,
    -- [6][7] new owner
    COALESCE(cmo.current_owner_type, lko.last_owner, 'none') AS new_owner_type,
    CASE
      WHEN cmo.mapped_kam_name IS NOT NULL
        THEN cmo.mapped_kam_name
      WHEN cmo.account_id IS NOT NULL
        THEN COALESCE(cmo.master_staff_owner, cmo.master_staff_owner_email, 'none')
      ELSE COALESCE(lko.last_ka_owner, 'none')
    END                                                    AS new_kam_name,
    -- [8][9] backward compat
    ta.transfer_basis,
    CAST(ta.last_order_date AS STRING)                     AS last_order_date,
    -- [10] *** NEW *** prev_owner: SALE/PM/ADMIN/KAM/NEW
    COALESCE(pol.prev_owner, 'NEW')                        AS prev_owner,
    -- [11] *** NEW *** transfer_month
    ta.transfer_month,
    -- [12] *** NEW *** baseline_gmv = GMV เต็มเดือนที่โอน
    CASE
      WHEN ta.window_tag = 'lm' THEN CAST(ROUND(ta.last_month_gmv) AS INT64)
      WHEN ta.window_tag = 'm2' THEN CAST(ROUND(COALESCE(m2g.gmv, 0)) AS INT64)
      ELSE 0
    END                                                    AS baseline_gmv,
    -- [13] *** NEW *** perf_gmv = GMV เดือนถัดจาก transfer_month
    CASE
      WHEN ta.window_tag = 'lm'     THEN CAST(ROUND(COALESCE(cm.gmv, 0)) AS INT64)
      WHEN ta.window_tag = 'm2'     THEN CAST(ROUND(COALESCE(lmg.gmv, 0)) AS INT64)
      ELSE 0
    END                                                    AS perf_gmv,
    -- [14] *** NEW *** perf_days_in_month
    CASE
      WHEN ta.window_tag = 'lm'     THEN p.cm_days
      WHEN ta.window_tag = 'm2'     THEN p.lm_days
      ELSE p.cm_days
    END                                                    AS perf_days_in_month,
    -- [15] *** NEW *** baseline_days_in_month
    ta.baseline_days                                       AS baseline_days_in_month
  FROM transfer_all ta, params p
  LEFT JOIN gmv_cm  cm  USING (account_id)
  LEFT JOIN gmv_lm  lmg USING (account_id)
  LEFT JOIN gmv_m2  m2g USING (account_id)
  LEFT JOIN current_master_owner cmo USING (account_id)
  LEFT JOIN last_known_owner lko     USING (account_id)
  LEFT JOIN prev_owner_lm pol        USING (account_id)
  WHERE
    (cmo.mapped_kam_name IS NOT NULL
      AND LOWER(TRIM(cmo.mapped_kam_name)) != LOWER(TRIM(ta.old_kam_name)))
    OR (cmo.account_id IS NOT NULL
      AND (cmo.mapped_kam_name IS NULL OR cmo.current_owner_type != 'KAM'))
    OR (cmo.account_id IS NULL AND lko.last_owner = 'KAM'
      AND LOWER(TRIM(lko.last_ka_owner)) != LOWER(TRIM(ta.old_kam_name)))
    OR (cmo.account_id IS NULL AND lko.last_owner IN ('SALE', 'PM', 'ADMIN'))
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY ta.account_id, ta.old_kam_name, ta.transfer_month
    ORDER BY ta.last_month_gmv DESC, ta.last_order_date DESC
  ) = 1
),

cleaned AS (
  SELECT * FROM movement_rows
  WHERE NOT (
    transfer_basis = 'dormant_last_known_kam'
    AND COALESCE(last_month_gmv, 0) = 0
    AND COALESCE(cur_month_gmv, 0) = 0
  )
)

SELECT
  kam_name, account_id, account_name, account_type,
  last_month_gmv, cur_month_gmv,
  new_owner_type, new_kam_name,
  transfer_basis, last_order_date,
  prev_owner, transfer_month,
  baseline_gmv, perf_gmv,
  perf_days_in_month, baseline_days_in_month
FROM cleaned
ORDER BY transfer_month DESC, kam_name, last_month_gmv DESC
