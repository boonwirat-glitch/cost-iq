-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Purpose: classify every outlet per Q2 month (Apr/May/Jun) relative to
--          a FIXED base month (Mar 2026). Powers the Quarter Health Screen
--          in Freshket Sense.
--
-- Base month: Mar 2026 — "who owned what in Mar, and how much GMV"
-- Target months: Apr, May, Jun 2026
--
-- Ownership resolution: dwh.order.staff_owner ณ เดือนที่วัด
--   (same as May2026_KAM_portfolio_reconcile.sql — ground truth for commission)
--   ไม่ใช้ dim.user_master เป็น primary เพราะ snapshot ล่าสุดเท่านั้น
--   ทำให้ ownership ย้อนหลังผิดได้ถ้า KAM โอน outlet หลัง run SQL
--
-- Classification: outlet ถูก classify ครั้งเดียวจาก Mar base
--   label คง fixed ตลอด Q ยกเว้น core_nrr vs core_nrr_churn (dynamic per month)
--
-- Movement labels:
--   core_nrr       — Mar cohort + ยังอยู่กับ KAM เดิม + มี GMV เดือนนั้น
--   core_nrr_churn — Mar cohort + ยังอยู่กับ KAM เดิม + ไม่มี GMV เดือนนั้น
--   handover       — รับจาก Sales ใน Mar (new_user_exp_date=2026-03) → fixed ทั้ง Q
--   new_sales      — รับจาก Sales ใน Apr (new_user_exp_date=2026-04) → fixed May/Jun
--   expansion      — ไม่มีใน Mar cohort + first_dollar ใน Q → fixed
--   transfer_in    — ไม่มีใน Mar cohort + มาจาก KAM อื่น/ลาออก → fixed
--   transfer_out   — Mar cohort + โอนออก → fixed (may_gmv=0)
--
-- NRR computation:
--   denominator = SUM(base_gmv) ของ core_nrr cohort (Mar GMV, fixed)
--   numerator   = SUM(curr_gmv) ของ core_nrr + core_nrr_churn (per month)
--   NRR%        = normalize by days (curr/curr_days) / (base/mar_days) × 100
--
-- Output grain: 1 row per outlet × period_month
-- R2 file: sense_qnrr_2026q2_${kam_safe_key}.csv (split per KAM downstream)
--
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ──────────────────────────────────────────────────────────
params AS (
  SELECT
    -- Base month (fixed denominator)
    DATE('2026-03-01') AS base_start,
    DATE('2026-03-31') AS base_end,
    31                  AS base_days,

    -- Q2 target months
    DATE('2026-04-01') AS apr_start,
    DATE('2026-04-30') AS apr_end,
    30                  AS apr_days,

    DATE('2026-05-01') AS may_start,
    DATE('2026-05-31') AS may_end,
    31                  AS may_days,

    DATE('2026-06-01') AS jun_start,
    DATE('2026-06-30') AS jun_end,  -- adjust if running mid-month
    30                  AS jun_days,

    -- ever_seen lookback (comeback vs expansion)
    DATE('2024-09-01') AS history_start
),

-- ── 2. KAM roster ────────────────────────────────────────────────────────────
-- Source of truth: same list as portview + commission SQLs
-- Add/remove KAMs here when roster changes
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

-- ── 3. Ownership per outlet per month (dwh.order — last order ณ เดือนนั้น) ──
-- Pattern: เหมือน May2026_KAM_portfolio_reconcile.sql
-- ใช้ QUALIFY ROW_NUMBER() เพื่อเอา order ล่าสุดต่อ outlet ต่อเดือน
-- → ownership ตรงกับ commission ground truth

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
    DATE(o.new_user_exp_date)       AS new_user_exp_date,
    DATE(o.first_dollar_date)       AS first_dollar_date
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
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
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
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4. GMV per outlet per month ───────────────────────────────────────────────
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

-- ── 5. ever_seen — เคยมี order ก่อน Apr (แยก expansion vs comeback) ──────────
ever_seen AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date >= p.history_start
    AND o.delivery_date <  p.apr_start
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
),

-- ── 6a. current_kam_snapshot — user_master ณ ขณะ run SQL ─────────────────────
-- ใช้แยก core_nrr_churn (ยังอยู่กับ KAM เดิม) vs transfer_out (โอนออกแล้ว)
-- สำหรับ outlet ที่ "เงียบ" ไม่มี order เดือนนั้นเลย
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

-- ── 6. Mar KAM cohort — core set ที่ใช้เป็น Q2 base ──────────────────────────
-- outlet ที่ Mar ownership = KAM ใน roster + มี GMV Mar
-- นี่คือ denominator ของ NRR ตลอด Q
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    mo.first_dollar_date,
    k.kam_email  AS base_kam_email,
    k.kam_name   AS base_kam_name,
    k.tl_email   AS base_tl_email,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg ON mo.outlet_id = bg.outlet_id
  -- กรอง: ต้องมี GMV Mar (เป็น active outlet ใน Mar)
  WHERE COALESCE(bg.gmv, 0) > 0
),

-- ── 7. Universe per target month — รวม mar_cohort + ร้านใหม่ที่เข้ามาใน Q ──
-- ใช้ UNION ALL 3 เดือน แล้ว classify movement per row

-- ────────────────────────────────────────────────────────────────────────────
-- MONTH: April
-- ────────────────────────────────────────────────────────────────────────────
apr_rows AS (
  -- LEG 1A: outlets ที่ Apr ownership = KAM ใน roster
  -- classify: core_nrr, core_nrr_churn, handover, new_sales, expansion, transfer_in
  SELECT
    '2026-04'                    AS period_month,
    '2026-03'                    AS base_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id, ao.outlet_id) AS account_id,
    COALESCE(mc.account_name, ao.account_name, '')        AS account_name,
    COALESCE(mc.account_type, ao.account_type, '')        AS account_type,
    k.kam_email                  AS period_kam_email,
    k.kam_name                   AS period_kam_name,
    k.tl_email                   AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0)     AS base_gmv,
    COALESCE(ag.gmv, 0)          AS curr_gmv,

    CASE
      -- [1] Handover: รับจาก Sales ใน Mar → fixed label ทั้ง Q
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'

      -- [2] New Sales: รับจาก Sales ใน Apr → fixed May/Jun (ใน Apr นี้ยังเป็น new_sales)
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-04'
        THEN 'new_sales'

      -- [3] Core NRR: อยู่ใน Mar cohort, KAM เดิม, มี GMV
      WHEN mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email = k.kam_email
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'core_nrr'

      -- [4] Core NRR Churn: อยู่ใน Mar cohort, KAM เดิม, ไม่มี GMV
      WHEN mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email = k.kam_email
        AND COALESCE(ag.gmv, 0) = 0
        THEN 'core_nrr_churn'

      -- [5] Transfer In: รับจาก KAM อื่น (มีใน Mar cohort ของคนอื่น)
      WHEN mc.base_kam_email IS NOT NULL
        AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'

      -- [6] Expansion: ไม่มีใน Mar cohort ของใครเลย, first_dollar ใน Q
      WHEN mc.base_kam_email IS NULL
        AND (es.outlet_id IS NULL)   -- ไม่เคยมี order ก่อน Apr
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'expansion'

      -- [7] Transfer In: ไม่มีใน Mar cohort แต่เคยมีประวัติ
      WHEN mc.base_kam_email IS NULL
        AND es.outlet_id IS NOT NULL
        THEN 'transfer_in'

      ELSE 'transfer_in'
    END AS movement_type

  FROM apr_ownership ao
  JOIN kam_list k
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc ON ao.outlet_id = mc.outlet_id
  LEFT JOIN apr_gmv    ag ON ao.outlet_id = ag.outlet_id
  LEFT JOIN ever_seen  es ON ao.outlet_id = es.outlet_id

  UNION ALL

  -- LEG 1B: transfer_out — อยู่ใน Mar cohort แต่ Apr ownership เปลี่ยน KAM
  SELECT
    '2026-04'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    'transfer_out'          AS movement_type

  FROM mar_cohort mc
  -- Apr owner เป็น KAM คนอื่นใน roster
  JOIN apr_ownership ao ON mc.outlet_id = ao.outlet_id
  JOIN kam_list k_apr
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k_apr.kam_name)
   AND k_apr.kam_email != mc.base_kam_email

  -- ไม่ต้องการ outlet ที่ยังอยู่กับ KAM เดิม (จัดการโดย LEG 1A แล้ว)
  WHERE mc.outlet_id NOT IN (
    SELECT ao2.outlet_id FROM apr_ownership ao2
    JOIN kam_list k2
      ON ao2.commercial_owner = 'KAM'
     AND TRIM(ao2.staff_owner) = TRIM(k2.kam_name)
     AND k2.kam_email = mc.base_kam_email
  )

  UNION ALL

  -- ── LEG 1C: silent outlets — อยู่ใน Mar cohort แต่ไม่มี order Apr เลย ──────
  -- ไม่ปรากฏใน apr_ownership → LEG 1A จับไม่ได้
  -- แยก: ยังอยู่กับ KAM เดิม (user_master) = core_nrr_churn
  --       เปลี่ยน KAM แล้ว (user_master) = transfer_out
  SELECT
    '2026-04'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                     AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id

  -- ไม่มี order Apr เลย (ไม่ปรากฏใน apr_ownership ไม่ว่า KAM ใด)
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_ownership)
),

-- ────────────────────────────────────────────────────────────────────────────
-- MONTH: May
-- Same logic แต่ inherit fixed classification จาก Apr rows (handover/new_sales/expansion/transfer_in)
-- ────────────────────────────────────────────────────────────────────────────
may_rows AS (
  -- LEG 2A: May ownership = KAM ใน roster
  SELECT
    '2026-05'               AS period_month,
    '2026-03'               AS base_month,
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id, mo.outlet_id) AS account_id,
    COALESCE(mc.account_name, mo.account_name, '')        AS account_name,
    COALESCE(mc.account_type, mo.account_type, '')        AS account_type,
    k.kam_email             AS period_kam_email,
    k.kam_name              AS period_kam_name,
    k.tl_email              AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)      AS curr_gmv,

    CASE
      -- Fixed labels จาก Q classification (handover/new_sales inherit ตลอด Q)
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05')
        THEN 'new_sales'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email = k.kam_email
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'core_nrr'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email = k.kam_email
        AND COALESCE(mg.gmv, 0) = 0
        THEN 'core_nrr_churn'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'
      WHEN mc.base_kam_email IS NULL AND es.outlet_id IS NULL
        AND COALESCE(mg.gmv, 0) > 0
        THEN 'expansion'
      ELSE 'transfer_in'
    END AS movement_type

  FROM may_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc ON mo.outlet_id = mc.outlet_id
  LEFT JOIN may_gmv    mg ON mo.outlet_id = mg.outlet_id
  LEFT JOIN ever_seen  es ON mo.outlet_id = es.outlet_id

  UNION ALL

  -- LEG 2B: transfer_out ของ May
  SELECT
    '2026-05'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    'transfer_out'          AS movement_type

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

  -- ── LEG 2C: silent outlets — อยู่ใน Mar cohort แต่ไม่มี order May เลย ──────
  SELECT
    '2026-05'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                     AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id

  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_ownership)
),

-- ────────────────────────────────────────────────────────────────────────────
-- MONTH: June
-- ────────────────────────────────────────────────────────────────────────────
jun_rows AS (
  -- LEG 3A
  SELECT
    '2026-06'               AS period_month,
    '2026-03'               AS base_month,
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id, jo.outlet_id) AS account_id,
    COALESCE(mc.account_name, jo.account_name, '')        AS account_name,
    COALESCE(mc.account_type, jo.account_type, '')        AS account_type,
    k.kam_email             AS period_kam_email,
    k.kam_name              AS period_kam_name,
    k.tl_email              AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)      AS curr_gmv,

    CASE
      -- handover: new_user_exp_date = Mar (fixed for whole Q — use Apr ownership as proxy)
      WHEN FORMAT_DATE('%Y-%m', ao_jun.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- new_sales: new_user_exp_date = Apr or May (rับจาก Sales ใน Q, fixed)
      WHEN FORMAT_DATE('%Y-%m', ao_jun.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email = k.kam_email
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'core_nrr'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email = k.kam_email
        AND COALESCE(jg.gmv, 0) = 0
        THEN 'core_nrr_churn'
      WHEN mc.base_kam_email IS NOT NULL AND mc.base_kam_email != k.kam_email
        THEN 'transfer_in'
      WHEN mc.base_kam_email IS NULL AND es.outlet_id IS NULL
        AND COALESCE(jg.gmv, 0) > 0
        THEN 'expansion'
      ELSE 'transfer_in'
    END AS movement_type

  FROM jun_ownership jo
  JOIN kam_list k
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort   mc     ON jo.outlet_id = mc.outlet_id
  LEFT JOIN apr_ownership ao_jun ON jo.outlet_id = ao_jun.outlet_id  -- for handover/new_sales new_user_exp_date
  LEFT JOIN jun_gmv      jg     ON jo.outlet_id = jg.outlet_id
  LEFT JOIN ever_seen    es     ON jo.outlet_id = es.outlet_id

  UNION ALL

  -- LEG 3B: transfer_out ของ Jun
  SELECT
    '2026-06'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    'transfer_out'          AS movement_type

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

  -- ── LEG 3C: silent outlets — อยู่ใน Mar cohort แต่ไม่มี order Jun เลย ──────
  SELECT
    '2026-06'               AS period_month,
    '2026-03'               AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email       AS period_kam_email,
    mc.base_kam_name        AS period_kam_name,
    mc.base_tl_email        AS period_tl_email,
    mc.base_kam_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                       AS curr_gmv,
    CASE
      WHEN cks.current_kam_email = mc.base_kam_email THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                     AS movement_type

  FROM mar_cohort mc
  LEFT JOIN current_kam_snapshot cks ON mc.outlet_id = cks.outlet_id

  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_ownership)
),

-- ── 8. Union all months ───────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL
  SELECT * FROM may_rows
  UNION ALL
  SELECT * FROM jun_rows
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────────
-- grain: 1 row per outlet × period_month
-- downstream: split per KAM by period_kam_email → upload to R2 per KAM
SELECT
  r.period_month,                      -- '2026-04' / '2026-05' / '2026-06'
  r.base_month,                        -- '2026-03' (fixed)
  r.movement_type,                     -- classification
  r.period_kam_email,                  -- KAM ที่ถือ outlet ใน period นั้น
  r.period_kam_name,
  r.period_tl_email,
  r.base_kam_email,                    -- KAM ที่ถือ outlet ใน Mar (null = ไม่อยู่ใน Mar cohort)
  r.account_id,
  r.account_name,
  r.account_type,
  r.outlet_id,
  r.base_gmv,                          -- Mar GMV (fixed denominator)
  r.curr_gmv,                          -- GMV ของ period_month
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
