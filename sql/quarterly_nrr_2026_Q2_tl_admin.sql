-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR — TL & Admin scope
-- quarterly_nrr_2026_Q2_tl_admin.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- SQL นี้ใช้สำหรับ TL และ Admin scope เท่านั้น
-- ระดับ rep ใช้ quarterly_nrr_2026_Q2_v5.sql แยกต่างหาก
--
-- หลักการ:
--   - ดู commercial_owner เป็นหลัก ไม่ใช่ staff_owner
--   - Mar cohort = commercial_owner='KAM' + GMV > 0 + ไม่ใช่ handover
--   - Movement ดูจาก commercial_owner เปลี่ยนยังไงใน Q
--   - staff_owner / kam_list ใช้แค่ lookup email สำหรับ attribution เท่านั้น
--
-- Movement definitions (TL/Admin scope):
--   core_nrr       — commercial_owner='KAM' ใน Mar + ยัง commercial_owner='KAM' ใน period
--   core_nrr_churn — core cohort + ไม่มี GMV ใน period
--   handover       — commercial_owner='SALE' ใน Mar + new_user_exp_date=Mar + GMV>0 ใน period
--   new_sales      — commercial_owner='SALE' ใน Apr/May/Jun + new_user_exp_date=Apr/May/Jun
--   expansion      — first_dollar >= Apr 2026
--   comeback       — ไม่อยู่ Mar cohort + first_dollar < Apr + commercial_owner='KAM' ใน period
--   transfer_in    — commercial_owner เปลี่ยนจาก non-KAM (PM/ADMIN) → KAM ใน period
--   transfer_out   — commercial_owner เปลี่ยนจาก KAM → non-KAM ใน period
--
-- NRR formula: SUM(curr_gmv/curr_days) / SUM(base_gmv/base_days) × 100
--   denominator = Mar cohort excl. handover
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ──────────────────────────────────────────────────────────
params AS (
  SELECT
    DATE('2026-03-01') AS base_start,
    DATE('2026-03-31') AS base_end,
    31                  AS base_days,
    DATE('2026-04-01') AS apr_start,
    DATE('2026-04-30') AS apr_end,
    30                  AS apr_days,
    DATE('2026-05-01') AS may_start,
    DATE('2026-05-31') AS may_end,
    31                  AS may_days,
    DATE('2026-06-01') AS jun_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS jun_end,
    DATE_DIFF(
      DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY),
      DATE('2026-06-01'), DAY
    ) + 1 AS jun_days
),

-- ── 2. KAM roster — ใช้แค่ lookup email/tl ──────────────────────────────────
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
    STRUCT('Treerak (May) Sangjua'                AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── 3. outlet_first_dollar ────────────────────────────────────────────────────
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.first_dollar_date IS NOT NULL
  GROUP BY 1
),

-- ── 4. Ownership per month — last order wins ──────────────────────────────────
-- ไม่ filter commercial_owner — ดู raw เพื่อเห็น transition ได้ครบ
mar_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

apr_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

may_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

jun_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 5. GMV per outlet per month ───────────────────────────────────────────────
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
apr_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 6. current_kam_snapshot ───────────────────────────────────────────────────
current_kam_snapshot AS (
  SELECT
    CAST(um.res_id AS STRING) AS outlet_id,
    UPPER(TRIM(um.commercial_owner)) AS current_commercial_owner,
    k.kam_email  AS current_kam_email,
    k.tl_email   AS current_tl_email
  FROM `freshket-rn.dim.user_master` um
  LEFT JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── 7. Mar cohort ─────────────────────────────────────────────────────────────
-- = commercial_owner='KAM' ใน Mar + GMV > 0 + ไม่ใช่ handover
-- handover = new_user_exp_date = Mar 2026 (รับมาจาก Sales ใน Mar นั่นเอง)
-- LEFT JOIN kam_list เพื่อ lookup email — ไม่ drop outlet ถ้า KAM ลาออก
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    mo.commercial_owner  AS mar_commercial_owner,
    mo.staff_owner       AS mar_staff_owner,
    ofd.first_dollar_date,
    k.kam_email          AS base_kam_email,
    k.kam_name           AS base_kam_name,
    k.tl_email           AS base_tl_email,
    COALESCE(bg.gmv, 0)  AS base_gmv,
    31                   AS base_days
  FROM mar_ownership mo
  LEFT JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
    -- ไม่นับ handover (รับมาจาก Sales ใน Mar)
    AND NOT (FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03')
),

-- ── 8. Classification function (ใช้ซ้ำใน Apr/May/Jun) ───────────────────────
-- ลำดับ priority:
--   1. expansion   — first_dollar >= Apr 2026
--   2. handover    — new_user_exp_date = Mar + อยู่ใน KAM portfolio แล้ว
--   3. new_sales   — new_user_exp_date = Apr/May/Jun
--   4. core_nrr    — อยู่ Mar cohort + commercial_owner='KAM' ใน period + GMV > 0
--   5. core_nrr_churn — อยู่ Mar cohort + commercial_owner='KAM' ใน period + GMV = 0
--   6. transfer_in — commercial_owner เปลี่ยน non-KAM → KAM ใน period
--   7. comeback    — ไม่อยู่ Mar cohort + first_dollar < Apr + GMV > 0
--   8. transfer_out — Mar cohort + commercial_owner เปลี่ยน KAM → non-KAM

-- ── 9. MONTH: April ───────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlet ที่มี Apr order และ commercial_owner='KAM'
  SELECT
    '2026-04'                AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)   AS account_id,
    COALESCE(mc.account_name, ao.account_name) AS account_name,
    COALESCE(mc.account_type, ao.account_type) AS account_type,
    -- period KAM: lookup จาก staff_owner (อาจ NULL ถ้า KAM ลาออก)
    k_per.kam_email          AS period_kam_email,
    k_per.kam_name           AS period_kam_name,
    k_per.tl_email           AS period_tl_email,
    -- base KAM: จาก mar_cohort (อาจ NULL ถ้า KAM ลาออก)
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    31                       AS base_days,
    COALESCE(ag.gmv, 0)      AS curr_gmv,
    p.apr_days               AS curr_days,

    CASE
      -- [1] expansion: ร้านใหม่แท้ใน Q
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'expansion'

      -- [2] handover: new_user_exp_date = Mar
      -- = รับมาจาก Sales ใน Mar แต่มาเริ่มนับใน Apr
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'

      -- [3] new_sales: commercial_owner='SALE' ใน Mar + new_user_exp_date = Apr
      -- outlet ที่ Mar order เป็น SALE แล้วโอนมา KAM ใน Apr
      WHEN mc.outlet_id IS NULL
        AND FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-04'
        THEN 'new_sales'

      -- [4] core_nrr: อยู่ Mar cohort + commercial_owner='KAM' ทั้ง Mar และ Apr
      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'core_nrr'

      -- [5] core_nrr_churn: อยู่ Mar cohort + ไม่มี GMV Apr
      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(ag.gmv, 0) = 0
        THEN 'core_nrr_churn'

      -- [6] comeback: ไม่อยู่ Mar cohort + first_dollar < Apr + GMV > 0
      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'comeback'

      -- [7] transfer_in: อื่นๆ ที่ commercial_owner='KAM' ใน Apr
      -- เช่น PM/ADMIN → KAM
      ELSE 'transfer_in'
    END AS movement_type

  FROM apr_ownership ao
  JOIN params p ON ao.commercial_owner = 'KAM'
  LEFT JOIN kam_list k_per
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k_per.kam_name)
  LEFT JOIN mar_cohort mc           ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN apr_gmv ag              ON ao.outlet_id = ag.outlet_id
  LEFT JOIN current_kam_snapshot cks_a ON ao.outlet_id = cks_a.outlet_id

  UNION ALL

  -- LEG B: Mar cohort outlet ที่ Apr commercial_owner เปลี่ยนออกจาก KAM
  -- = transfer_out (KAM → SALE/PM/ADMIN)
  SELECT
    '2026-04'                AS period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    COALESCE(mc.base_kam_email, cks.current_kam_email) AS period_kam_email,
    COALESCE(mc.base_kam_name, cks.current_kam_email) AS period_kam_name,
    COALESCE(mc.base_tl_email, cks.current_tl_email)  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    31                       AS base_days,
    0                        AS curr_gmv,
    p.apr_days               AS curr_days,
    'transfer_out'           AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  -- outlet นี้มี Apr order แต่ commercial_owner ไม่ใช่ KAM แล้ว
  JOIN apr_ownership ao
    ON mc.outlet_id = ao.outlet_id
   AND ao.commercial_owner != 'KAM'

  UNION ALL

  -- LEG C: Mar cohort outlet ที่ไม่มี Apr order เลย
  -- ดู user_master ว่า commercial_owner ยังเป็น KAM ไหม
  SELECT
    '2026-04'                AS period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email        AS period_kam_email,
    mc.base_kam_name         AS period_kam_name,
    mc.base_tl_email         AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    31                       AS base_days,
    0                        AS curr_gmv,
    p.apr_days               AS curr_days,
    CASE
      WHEN cks.current_commercial_owner = 'KAM' THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                      AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_ownership)
),

-- ── 10. MONTH: May ────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A
  SELECT
    '2026-05'                AS period_month,
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id)   AS account_id,
    COALESCE(mc.account_name, mo.account_name) AS account_name,
    COALESCE(mc.account_type, mo.account_type) AS account_type,
    COALESCE(k_per.kam_email, cks_m.current_kam_email) AS period_kam_email,
    COALESCE(k_per.kam_name, cks_m.current_kam_email) AS period_kam_name,
    COALESCE(k_per.tl_email, cks_m.current_tl_email)  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    31                       AS base_days,
    COALESCE(mg.gmv, 0)      AS curr_gmv,
    p.may_days               AS curr_days,

    CASE
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'expansion'

      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        THEN 'handover'

      WHEN mc.outlet_id IS NULL
        AND FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05')
        THEN 'new_sales'

      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(mg.gmv, 0) = 0
        THEN 'core_nrr_churn'

      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'comeback'

      ELSE 'transfer_in'
    END AS movement_type

  FROM may_ownership mo
  JOIN params p ON mo.commercial_owner = 'KAM'
  LEFT JOIN kam_list k_per
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k_per.kam_name)
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN may_gmv mg              ON mo.outlet_id = mg.outlet_id
  LEFT JOIN current_kam_snapshot cks_m ON mo.outlet_id = cks_m.outlet_id

  UNION ALL

  -- LEG B: transfer_out May
  SELECT
    '2026-05' AS period_month,
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email, mc.base_tl_email, mc.base_kam_name,
    mc.base_gmv, 31 AS base_days,
    0 AS curr_gmv, p.may_days AS curr_days,
    'transfer_out' AS movement_type
  FROM mar_cohort mc
  CROSS JOIN params p
  JOIN may_ownership mo
    ON mc.outlet_id = mo.outlet_id
   AND mo.commercial_owner != 'KAM'

  UNION ALL

  -- LEG C: core_nrr_churn silent May
  SELECT
    '2026-05' AS period_month,
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email, mc.base_tl_email, mc.base_kam_name,
    mc.base_gmv, 31 AS base_days,
    0 AS curr_gmv, p.may_days AS curr_days,
    CASE
      WHEN cks.current_commercial_owner = 'KAM' THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END AS movement_type
  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_ownership)
),

-- ── 11. MONTH: June ───────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A
  SELECT
    '2026-06'                AS period_month,
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id)   AS account_id,
    COALESCE(mc.account_name, jo.account_name) AS account_name,
    COALESCE(mc.account_type, jo.account_type) AS account_type,
    COALESCE(k_per.kam_email, cks_j.current_kam_email) AS period_kam_email,
    COALESCE(k_per.kam_name, cks_j.current_kam_email) AS period_kam_name,
    COALESCE(k_per.tl_email, cks_j.current_tl_email)  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    31                       AS base_days,
    COALESCE(jg.gmv, 0)      AS curr_gmv,
    p.jun_days               AS curr_days,

    CASE
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'expansion'

      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03'
        THEN 'handover'

      WHEN mc.outlet_id IS NULL
        AND FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'

      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND COALESCE(jg.gmv, 0) = 0
        THEN 'core_nrr_churn'

      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'comeback'

      ELSE 'transfer_in'
    END AS movement_type

  FROM jun_ownership jo
  JOIN params p ON jo.commercial_owner = 'KAM'
  LEFT JOIN kam_list k_per
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k_per.kam_name)
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
  LEFT JOIN current_kam_snapshot cks_j ON jo.outlet_id = cks_j.outlet_id

  UNION ALL

  -- LEG B: transfer_out Jun
  SELECT
    '2026-06' AS period_month,
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email, mc.base_tl_email, mc.base_kam_name,
    mc.base_gmv, 31 AS base_days,
    0 AS curr_gmv, p.jun_days AS curr_days,
    'transfer_out' AS movement_type
  FROM mar_cohort mc
  CROSS JOIN params p
  JOIN jun_ownership jo
    ON mc.outlet_id = jo.outlet_id
   AND jo.commercial_owner != 'KAM'

  UNION ALL

  -- LEG C: core_nrr_churn silent Jun
  SELECT
    '2026-06' AS period_month,
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email, mc.base_tl_email, mc.base_kam_name,
    mc.base_gmv, 31 AS base_days,
    0 AS curr_gmv, p.jun_days AS curr_days,
    CASE
      WHEN cks.current_commercial_owner = 'KAM' THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END AS movement_type
  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_ownership)
),

-- ── 12. Union all months ──────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────────
-- Columns เหมือนกับ v5 ทุก column เพื่อให้ JS ใช้ได้เหมือนกัน
SELECT
  r.period_month,
  '2026-03'           AS base_month,
  r.movement_type,
  r.period_kam_email,
  r.period_kam_name,
  r.period_tl_email,
  r.base_kam_email,
  r.base_tl_email,
  r.account_id,
  r.account_name,
  r.account_type,
  r.outlet_id,
  r.base_gmv,
  r.curr_gmv,
  r.base_days,
  r.curr_days

FROM all_rows r

ORDER BY
  r.period_tl_email,
  r.period_kam_email,
  r.period_month,
  r.movement_type,
  r.curr_gmv DESC
