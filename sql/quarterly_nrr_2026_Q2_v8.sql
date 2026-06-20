-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2.sql (v8)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ground truth (verified 2026-06-20):
--   Mar KAM universe  = 2,721 outlets ฿137.3M (commercial_owner='KAM')
--   handover_in_mar   =    25 outlets ฿3.5M   (new_user_exp_date = Mar 2026
--                                               + mar_commercial_owner = SALE)
--   core cohort       = 2,696 outlets ฿133.8M
--   KAM ที่ลาออก 5 คน = 496 outlets — outlet ยัง commercial_owner='KAM'
--                       → นับเป็น core cohort (ไม่ใช่ transfer_in)
--
-- Logic adopt มาจาก May2026_KAM_portfolio_reconcile.sql:
--   handover = mar_commercial_owner='SALE' + new_user_exp_date = Mar
--   new_sales = apr/may/jun_commercial_owner='SALE' + new_user_exp_date = Apr/May/Jun
--   ไม่มี Path B fallback — new_user_exp_date เป็น source of truth เดียว
--
-- Movement definitions:
--   core_nrr       — commercial_owner='KAM' ใน Mar + GMV > 0 + ไม่ใช่ handover
--                    + KAM เดิมยังดูแลอยู่ (ระดับ rep) หรือ commercial_owner='KAM' (ระดับ TL/Admin)
--   core_nrr_churn — core cohort + GMV = 0 ใน period month
--   handover       — mar_commercial_owner='SALE' + new_user_exp_date = Mar 2026
--   new_sales      — period_commercial_owner='SALE' + new_user_exp_date = Apr/May/Jun 2026
--   expansion      — first_dollar_date >= Apr 2026 (ร้านใหม่แท้ใน Q)
--   comeback       — first_dollar < Apr + ไม่อยู่ Mar cohort ของใครเลย + GMV > 0
--   transfer_in    — ระดับ rep: อยู่ Mar cohort KAM อื่น → KAM นี้
--                    ระดับ TL/Admin: commercial_owner เปลี่ยนจาก non-KAM → KAM
--   transfer_out   — ระดับ rep: Mar cohort KAM นี้ → KAM อื่น
--                    ระดับ TL/Admin: commercial_owner เปลี่ยนจาก KAM → non-KAM
--
-- NRR formula: SUM(curr_gmv/curr_days) / SUM(base_gmv/base_days) × 100
--   denominator = Mar cohort (core_nrr + core_nrr_churn), excl. handover
--   numerator   = core_nrr outlets ใน period month
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

-- ── 4. Ownership per outlet per month (order-based, last order wins) ──────────
-- ใช้ order ล่าสุดในแต่ละเดือน — ไม่ filter commercial_owner ที่นี่
-- เพื่อให้เห็น SALE→KAM transition ได้ครบ
mar_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date,
    DATE(o.first_dollar_date)       AS first_dollar_date
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

-- ── 6. current_kam_snapshot — user_master ณ ขณะรัน ──────────────────────────
-- ใช้แยก core_nrr_churn (outlet เงียบแต่ยังอยู่กับ KAM เดิม)
-- vs transfer_out (outlet เงียบและโอนออกไปแล้ว)
current_kam_snapshot AS (
  SELECT
    CAST(um.res_id AS STRING) AS outlet_id,
    k.kam_email               AS current_kam_email,
    k.tl_email                AS current_tl_email
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

-- ── 7. Mar cohort ─────────────────────────────────────────────────────────────
-- = commercial_owner='KAM' ใน Mar + GMV > 0 + ไม่ใช่ handover
-- handover = mar_commercial_owner='SALE' ใน Mar order ก่อนหน้า + new_user_exp_date = Mar
-- ข้อสำคัญ: LEFT JOIN kam_list — outlet ของ KAM ที่ลาออกยังอยู่ใน cohort
--            base_kam_email = NULL ถ้า KAM ลาออก แต่ยังนับเป็น core
mar_cohort AS (
  SELECT
    mo.outlet_id,
    COALESCE(mo.account_id, ofd.outlet_id)  AS account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    mo.commercial_owner                      AS mar_commercial_owner,
    mo.staff_owner                           AS mar_staff_owner,
    ofd.first_dollar_date,
    k.kam_email   AS base_kam_email,
    k.kam_name    AS base_kam_name,
    k.tl_email    AS base_tl_email,
    COALESCE(bg.gmv, 0) AS base_gmv,
    31                  AS base_days
  FROM mar_ownership mo
  LEFT JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'   -- ดู commercial_owner ระดับ portfolio
    AND COALESCE(bg.gmv, 0) > 0       -- มี GMV ใน Mar
    -- ไม่นับ handover: order ล่าสุดใน Mar เป็น KAM แต่ new_user_exp_date = Mar
    -- แปลว่าเพิ่งรับมาจาก Sales ใน Mar นั่นเอง
    AND NOT (FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03')
),

-- ── 8. MONTH: April ───────────────────────────────────────────────────────────
-- LEG A: outlet ที่มี order ใน Apr (commercial_owner='KAM')
-- LEG B: transfer_out — Mar cohort แต่ Apr KAM เปลี่ยน
-- LEG C: core_nrr_churn silent — Mar cohort, ไม่มี Apr order, ยังอยู่กับ KAM เดิม
apr_rows AS (

  -- LEG A: Apr KAM ownership
  SELECT
    '2026-04'         AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id, ao.outlet_id) AS account_id,
    COALESCE(mc.account_name, ao.account_name, '')        AS account_name,
    COALESCE(mc.account_type, ao.account_type, '')        AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0)    AS base_gmv,
    p.base_days,
    COALESCE(ag.gmv, 0)         AS curr_gmv,
    p.apr_days                  AS curr_days,

    CASE
      -- [1] expansion: ร้านใหม่แท้ใน Q (first_dollar >= Apr)
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'expansion'

      -- [2] handover: รับมาจาก Sales ใน Mar
      -- ดู new_user_exp_date จาก Apr order (อาจ carry มาจาก Mar)
      -- หรือจาก mar_ownership โดยตรง
      WHEN FORMAT_DATE('%Y-%m', COALESCE(ao.new_user_exp_date, mo_ref.new_user_exp_date)) = '2026-03'
        AND (ao.commercial_owner = 'KAM' OR mo_ref.commercial_owner = 'SALE')
        THEN 'handover'

      -- [3] new_sales: รับมาจาก Sales ใน Apr
      WHEN ao.commercial_owner = 'KAM'
        AND mc.outlet_id IS NULL   -- ไม่อยู่ใน Mar cohort
        AND FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-04'
        THEN 'new_sales'

      -- [4] core_nrr: อยู่ Mar cohort + commercial_owner='KAM' ตลอด
      -- ระดับ rep: base_kam_email = period_kam_email
      -- ระดับ TL/Admin: _effectiveMovement() จะ neutralize transfer ภายในทีม
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email = k.kam_email
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email = k.kam_email
        AND COALESCE(ag.gmv, 0) = 0
        THEN 'core_nrr_churn'

      -- [5] core_nrr: outlet ของ KAM ที่ลาออก (base_kam_email IS NULL)
      -- commercial_owner='KAM' ทั้งใน Mar และ Apr → นับเป็น core
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NULL   -- KAM ลาออก
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NULL
        AND COALESCE(ag.gmv, 0) = 0
        THEN 'core_nrr_churn'

      -- [6] transfer_in: อยู่ Mar cohort ของ KAM อื่น → KAM นี้
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'

      -- [7] comeback: first_dollar < Apr + ไม่อยู่ Mar cohort + GMV > 0
      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'comeback'

      -- [8] transfer_in: อื่นๆ (commercial_owner เปลี่ยนจาก non-KAM มาเป็น KAM)
      ELSE 'transfer_in'
    END AS movement_type

  FROM apr_ownership ao
  JOIN kam_list k
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN apr_gmv ag                 ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_ownership mo_ref       ON ao.outlet_id = mo_ref.outlet_id
  CROSS JOIN params p

  UNION ALL

  -- LEG B: transfer_out — Mar cohort outlet ที่ Apr เปลี่ยน KAM
  SELECT
    '2026-04' AS period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    p.base_days,
    0 AS curr_gmv,
    p.apr_days AS curr_days,
    'transfer_out' AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  JOIN apr_ownership ao ON mc.outlet_id = ao.outlet_id
  JOIN kam_list k_apr
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k_apr.kam_name)
   AND k_apr.kam_email != mc.base_kam_email
  WHERE mc.base_kam_email IS NOT NULL  -- เฉพาะ outlet ที่รู้ base_kam
    AND mc.outlet_id NOT IN (
      SELECT ao2.outlet_id FROM apr_ownership ao2
      JOIN kam_list k2
        ON ao2.commercial_owner = 'KAM'
       AND TRIM(ao2.staff_owner) = TRIM(k2.kam_name)
       AND k2.kam_email = mc.base_kam_email
    )

  UNION ALL

  -- LEG C: core_nrr_churn silent — ไม่มี Apr order แต่ยังอยู่กับ KAM เดิม
  SELECT
    '2026-04' AS period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    p.base_days,
    0 AS curr_gmv,
    p.apr_days AS curr_days,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.base_kam_email IS NOT NULL
    AND mc.outlet_id NOT IN (SELECT outlet_id FROM apr_ownership)
),

-- ── 9. MONTH: May ─────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A: May KAM ownership
  SELECT
    '2026-05'         AS period_month,
    mo.outlet_id,
    COALESCE(mc.account_id, ao_ref.account_id, mo.account_id, mo.outlet_id) AS account_id,
    COALESCE(mc.account_name, ao_ref.account_name, mo.account_name, '')     AS account_name,
    COALESCE(mc.account_type, ao_ref.account_type, mo.account_type, '')     AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0)    AS base_gmv,
    p.base_days,
    COALESCE(mg.gmv, 0)         AS curr_gmv,
    p.may_days                  AS curr_days,

    CASE
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'expansion'

      WHEN FORMAT_DATE('%Y-%m', COALESCE(mo.new_user_exp_date, ao_ref.new_user_exp_date)) = '2026-03'
        THEN 'handover'

      WHEN FORMAT_DATE('%Y-%m', COALESCE(mo.new_user_exp_date, ao_ref.new_user_exp_date)) IN ('2026-04','2026-05')
        AND (mo.commercial_owner = 'SALE'
          OR ao_ref.commercial_owner = 'SALE'
          OR (mc.outlet_id IS NULL AND COALESCE(ao_ref.commercial_owner,'') != 'KAM'))
        THEN 'new_sales'

      WHEN mc.outlet_id IS NOT NULL
        AND (mc.base_kam_email IS NULL OR mc.base_kam_email = k.kam_email)
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND (mc.base_kam_email IS NULL OR mc.base_kam_email = k.kam_email)
        AND COALESCE(mg.gmv, 0) = 0
        THEN 'core_nrr_churn'

      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'

      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'comeback'

      ELSE 'transfer_in'
    END AS movement_type

  FROM may_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc              ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN may_gmv mg                 ON mo.outlet_id = mg.outlet_id
  LEFT JOIN apr_ownership ao_ref       ON mo.outlet_id = ao_ref.outlet_id
  CROSS JOIN params p

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
    mc.base_gmv, p.base_days,
    0 AS curr_gmv, p.may_days AS curr_days,
    'transfer_out' AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  JOIN may_ownership mo ON mc.outlet_id = mo.outlet_id
  JOIN kam_list k_may
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k_may.kam_name)
   AND k_may.kam_email != mc.base_kam_email
  WHERE mc.base_kam_email IS NOT NULL
    AND mc.outlet_id NOT IN (
      SELECT mo2.outlet_id FROM may_ownership mo2
      JOIN kam_list k2
        ON mo2.commercial_owner = 'KAM'
       AND TRIM(mo2.staff_owner) = TRIM(k2.kam_name)
       AND k2.kam_email = mc.base_kam_email
    )

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
    mc.base_gmv, p.base_days,
    0 AS curr_gmv, p.may_days AS curr_days,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.base_kam_email IS NOT NULL
    AND mc.outlet_id NOT IN (SELECT outlet_id FROM may_ownership)
),

-- ── 10. MONTH: June ───────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A: Jun KAM ownership
  SELECT
    '2026-06'         AS period_month,
    jo.outlet_id,
    COALESCE(mc.account_id, mo_ref.account_id, jo.account_id, jo.outlet_id) AS account_id,
    COALESCE(mc.account_name, mo_ref.account_name, jo.account_name, '')     AS account_name,
    COALESCE(mc.account_type, mo_ref.account_type, jo.account_type, '')     AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0)    AS base_gmv,
    p.base_days,
    COALESCE(jg.gmv, 0)         AS curr_gmv,
    p.jun_days                  AS curr_days,

    CASE
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'expansion'

      WHEN FORMAT_DATE('%Y-%m', COALESCE(jo.new_user_exp_date, mo_ref.new_user_exp_date)) = '2026-03'
        THEN 'handover'

      WHEN FORMAT_DATE('%Y-%m', COALESCE(jo.new_user_exp_date, mo_ref.new_user_exp_date)) IN ('2026-04','2026-05','2026-06')
        AND (jo.commercial_owner = 'SALE'
          OR mo_ref.commercial_owner = 'SALE'
          OR (mc.outlet_id IS NULL AND COALESCE(mo_ref.commercial_owner,'') != 'KAM'))
        THEN 'new_sales'

      WHEN mc.outlet_id IS NOT NULL
        AND (mc.base_kam_email IS NULL OR mc.base_kam_email = k.kam_email)
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'core_nrr'

      WHEN mc.outlet_id IS NOT NULL
        AND (mc.base_kam_email IS NULL OR mc.base_kam_email = k.kam_email)
        AND COALESCE(jg.gmv, 0) = 0
        THEN 'core_nrr_churn'

      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'

      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, '2099-01-01') < '2026-04-01'
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'comeback'

      ELSE 'transfer_in'
    END AS movement_type

  FROM jun_ownership jo
  JOIN kam_list k
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc              ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN jun_gmv jg                 ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_ownership mo_ref       ON jo.outlet_id = mo_ref.outlet_id
  CROSS JOIN params p

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
    mc.base_gmv, p.base_days,
    0 AS curr_gmv, p.jun_days AS curr_days,
    'transfer_out' AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  JOIN jun_ownership jo ON mc.outlet_id = jo.outlet_id
  JOIN kam_list k_jun
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k_jun.kam_name)
   AND k_jun.kam_email != mc.base_kam_email
  WHERE mc.base_kam_email IS NOT NULL
    AND mc.outlet_id NOT IN (
      SELECT jo2.outlet_id FROM jun_ownership jo2
      JOIN kam_list k2
        ON jo2.commercial_owner = 'KAM'
       AND TRIM(jo2.staff_owner) = TRIM(k2.kam_name)
       AND k2.kam_email = mc.base_kam_email
    )

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
    mc.base_gmv, p.base_days,
    0 AS curr_gmv, p.jun_days AS curr_days,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END AS movement_type

  FROM mar_cohort mc
  CROSS JOIN params p
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id
  WHERE mc.base_kam_email IS NOT NULL
    AND mc.outlet_id NOT IN (SELECT outlet_id FROM jun_ownership)
),

-- ── 11. Union all months ──────────────────────────────────────────────────────
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
