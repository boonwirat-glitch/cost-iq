-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2.sql  (v3)
-- ════════════════════════════════════════════════════════════════════════════
--
-- v3 fixes (vs v2):
--   FIX 1: outlet_first_dollar CTE แยกต่างหาก — ไม่ดึง first_dollar_date
--           ผ่าน delivery_date filter ป้องกัน NULL ที่ไม่ควรมี
--   FIX 2: comeback เพิ่มเงื่อนไข mar_any.outlet_id IS NULL — กันร้านที่
--           อยู่กับ KAM อื่นใน Mar ไม่ให้ misclassify เป็น comeback
--   FIX 3: apr_labels CTE — lock movement label ของทุก outlet ตั้งแต่ Apr
--           May/Jun inherit label จาก apr_labels แทนการ re-classify ใหม่
--           ทำให้ core cohort fixed ตลอด Q (handover/new_sales ไม่กลายเป็น core)
--
-- Movement definitions (confirmed with Bucci 2026-06-17):
--   core_nrr       — Mar cohort (active Mar) + KAM เดิม + GMV > 0
--   core_nrr_churn — Mar cohort + KAM เดิม + GMV = 0 (dynamic per month)
--   handover       — new_user_exp_date = Mar 2026 → fixed ทั้ง Q
--   new_sales      — new_user_exp_date = Apr/May/Jun 2026 → fixed ทั้ง Q
--   expansion      — first_dollar >= 2026-04-01 (ร้านใหม่แท้ใน Q) + GMV > 0
--   comeback       — first_dollar < 2026-04-01 + ไม่อยู่ Mar cohort ของ KAM ใดเลย + GMV > 0
--   transfer_in    — ย้ายมาจาก KAM/AD/PM/Admin อื่น → KAM คนนี้
--   transfer_out   — Mar cohort ของ KAM นี้ → เปลี่ยน owner ออกไป
--
-- NRR computation:
--   denominator = SUM(base_gmv / base_days) per unique outlet in Mar cohort (fixed)
--   numerator   = SUM(curr_gmv / curr_days) for core_nrr + core_nrr_churn outlets
--   NRR%        = numerator / denominator × 100
--
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
    ) + 1               AS jun_days
),

-- ── 2. KAM roster ────────────────────────────────────────────────────────────
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

-- ── 3. FIX 1: outlet_first_dollar — ไม่มี date range filter ─────────────────
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

-- ── 4. Ownership per outlet per month ────────────────────────────────────────
-- ไม่ดึง first_dollar_date จาก ownership CTEs อีกต่อไป — ใช้ outlet_first_dollar แทน
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
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
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
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

may_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
    -- ไม่ดึง new_user_exp_date จาก May — ใช้จาก apr_labels แทน (FIX 3)
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

jun_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
    -- ไม่ดึง new_user_exp_date จาก Jun — ใช้จาก apr_labels แทน (FIX 3)
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
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
    k.kam_email               AS current_kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── 7. Mar KAM cohort ─────────────────────────────────────────────────────────
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    k.kam_email  AS base_kam_email,
    k.kam_name   AS base_kam_name,
    k.tl_email   AS base_tl_email,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE COALESCE(bg.gmv, 0) > 0
),

-- ── 8. FIX 3: apr_labels — lock classification ของทุก outlet ตั้งแต่ Apr ──────
-- May/Jun จะ inherit label จาก CTE นี้แทนการ re-classify ใหม่
-- ทำให้ handover/new_sales ไม่กลายเป็น core ใน May/Jun
-- core_nrr vs core_nrr_churn ยังคง dynamic (ขึ้นกับ curr_gmv แต่ละเดือน)
-- แต่ label หลัก (handover/new_sales/expansion/comeback/transfer_in) = fixed
apr_labels AS (
  SELECT
    ao.outlet_id,
    k.kam_email AS period_kam_email,
    COALESCE(mc.account_id, ao.account_id, ao.outlet_id) AS account_id,
    COALESCE(mc.account_name, ao.account_name, '')        AS account_name,
    COALESCE(mc.account_type, ao.account_type, '')        AS account_type,
    k.kam_name  AS period_kam_name,
    k.tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,

    -- Fixed label — ใช้ตลอด Q สำหรับ non-core movements
    CASE
      -- handover: new_user_exp_date = Mar
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- new_sales: new_user_exp_date = Apr/May/Jun
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      -- core: อยู่ Mar cohort + KAM เดิม (dynamic per month ใน final select)
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email = k.kam_email
        THEN 'core'
      -- transfer_in: อยู่ Mar cohort ของ KAM อื่น
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'
      -- expansion: first_dollar ใน Q
      WHEN mc.base_kam_email IS NULL
        AND ofd.first_dollar_date >= '2026-04-01'
        THEN 'expansion'
      -- comeback: FIX 2 — ต้องไม่อยู่ Mar cohort ของ KAM ใดเลย
      WHEN mc.base_kam_email IS NULL
        AND mar_any.outlet_id IS NULL
        AND ofd.first_dollar_date < '2026-04-01'
        THEN 'comeback'
      -- transfer_in: อยู่กับ KAM อื่นใน Mar
      WHEN mc.base_kam_email IS NULL
        AND mar_any.outlet_id IS NOT NULL
        THEN 'transfer_in'
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_ownership ao
  JOIN kam_list k
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc           ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN (SELECT DISTINCT outlet_id FROM mar_cohort) mar_any
    ON ao.outlet_id = mar_any.outlet_id
),

-- ── 9. MONTH: April ───────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG 1A: outlets ที่ Apr ownership = KAM ใน roster
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    al.outlet_id,
    al.account_id,
    al.account_name,
    al.account_type,
    al.period_kam_email,
    al.period_kam_name,
    al.period_tl_email,
    al.base_kam_email,
    al.base_kam_name,
    al.base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,

    -- Apr: resolve core → core_nrr or core_nrr_churn based on GMV
    CASE
      WHEN al.fixed_label = 'core' AND COALESCE(ag.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core' AND COALESCE(ag.gmv, 0) = 0 THEN 'core_nrr_churn'
      -- expansion ต้องมี GMV ถึงจะนับ
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv, 0) = 0 THEN 'transfer_in'
      -- comeback ต้องมี GMV
      WHEN al.fixed_label = 'comeback' AND COALESCE(ag.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback' AND COALESCE(ag.gmv, 0) = 0 THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG 1B: transfer_out — Mar cohort แต่ Apr ownership เปลี่ยน KAM
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN apr_ownership ao ON mc.outlet_id = ao.outlet_id
  JOIN kam_list k_apr
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k_apr.kam_name)
   AND k_apr.kam_email != mc.base_kam_email
  WHERE mc.outlet_id NOT IN (
    SELECT ao2.outlet_id FROM apr_ownership ao2
    JOIN kam_list k2
      ON ao2.commercial_owner = 'KAM'
     AND TRIM(ao2.staff_owner) = TRIM(k2.kam_name)
     AND k2.kam_email = mc.base_kam_email
  )

  UNION ALL

  -- LEG 1C: silent outlets
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END               AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_ownership)
),

-- ── 10. MONTH: May ────────────────────────────────────────────────────────────
-- FIX 3: ใช้ apr_labels เป็น source of truth ไม่ re-classify ใหม่
may_rows AS (

  -- LEG 2A
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mo.outlet_id,
    COALESCE(al.account_id, mo.account_id, mo.outlet_id) AS account_id,
    COALESCE(al.account_name, mo.account_name, '')        AS account_name,
    COALESCE(al.account_type, mo.account_type, '')        AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    al.base_kam_email,
    al.base_kam_name,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)      AS curr_gmv,

    -- May: inherit fixed_label จาก apr_labels, resolve core → nrr/churn
    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      -- outlet ใหม่ที่เข้ามาใน May แต่ไม่มีใน apr_labels = new_sales
      WHEN al.outlet_id IS NULL THEN 'new_sales'
      ELSE al.fixed_label
    END AS movement_type

  FROM may_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  -- FIX 3: JOIN apr_labels แทนการ re-classify
  LEFT JOIN apr_labels al
    ON mo.outlet_id = al.outlet_id
   AND al.period_kam_email = k.kam_email
  LEFT JOIN may_gmv mg ON mo.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG 2B: transfer_out ของ May
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN may_ownership mo ON mc.outlet_id = mo.outlet_id
  JOIN kam_list k_may
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k_may.kam_name)
   AND k_may.kam_email != mc.base_kam_email
  WHERE mc.outlet_id NOT IN (
    SELECT mo2.outlet_id FROM may_ownership mo2
    JOIN kam_list k2
      ON mo2.commercial_owner = 'KAM'
     AND TRIM(mo2.staff_owner) = TRIM(k2.kam_name)
     AND k2.kam_email = mc.base_kam_email
  )

  UNION ALL

  -- LEG 2C: silent outlets May
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END               AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_ownership)
),

-- ── 11. MONTH: June ───────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG 3A
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    jo.outlet_id,
    COALESCE(al.account_id, jo.account_id, jo.outlet_id) AS account_id,
    COALESCE(al.account_name, jo.account_name, '')        AS account_name,
    COALESCE(al.account_type, jo.account_type, '')        AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    al.base_kam_email,
    al.base_kam_name,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)      AS curr_gmv,

    -- Jun: inherit fixed_label จาก apr_labels
    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NULL THEN 'new_sales'
      ELSE al.fixed_label
    END AS movement_type

  FROM jun_ownership jo
  JOIN kam_list k
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN apr_labels al
    ON jo.outlet_id = al.outlet_id
   AND al.period_kam_email = k.kam_email
  LEFT JOIN jun_gmv jg ON jo.outlet_id = jg.outlet_id

  UNION ALL

  -- LEG 3B: transfer_out ของ Jun
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN jun_ownership jo ON mc.outlet_id = jo.outlet_id
  JOIN kam_list k_jun
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k_jun.kam_name)
   AND k_jun.kam_email != mc.base_kam_email
  WHERE mc.outlet_id NOT IN (
    SELECT jo2.outlet_id FROM jun_ownership jo2
    JOIN kam_list k2
      ON jo2.commercial_owner = 'KAM'
     AND TRIM(jo2.staff_owner) = TRIM(k2.kam_name)
     AND k2.kam_email = mc.base_kam_email
  )

  UNION ALL

  -- LEG 3C: silent outlets Jun
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END               AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_ownership)
),

-- ── 12. Union all months ──────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL
  SELECT * FROM may_rows
  UNION ALL
  SELECT * FROM jun_rows
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────────
SELECT
  r.period_month,
  r.base_month,
  r.movement_type,
  r.period_kam_email,
  r.period_kam_name,
  r.period_tl_email,
  r.base_kam_email,
  r.account_id,
  r.account_name,
  r.account_type,
  r.outlet_id,
  r.base_gmv,
  r.curr_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END AS curr_days

FROM all_rows r
CROSS JOIN params p

ORDER BY
  r.period_tl_email,
  r.period_kam_email,
  r.period_month,
  r.movement_type,
  r.curr_gmv DESC
