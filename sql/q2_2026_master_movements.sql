-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Master Movement Table
-- q2_2026_master_movements.sql  (v1)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Goal: เห็น movement ทุก outlet ใน Freshket (ยกเว้น B2C) ตลอด Q2 2026
--       ใช้เป็น single source of truth สำหรับ NRR ทุก portfolio ทุก scope
--
-- Grain: 1 row ต่อ outlet ต่อเดือน (Apr/May/Jun)
--        base period = March (fixed ทั้ง Q)
--
-- Portfolios:
--   KAM   — commercial_owner = 'KAM'
--   PM    — commercial_owner = 'PM'
--   ADMIN — commercial_owner = 'ADMIN' (unmanaged B2B)
--   SALE  — commercial_owner = 'SALE' (no NRR, GMV snapshot only)
--   B2C   — account_type = 'Enduser' (GMV only, no movement)
--
-- Movements (ชื่อเดิมจาก commission file):
--   core_nrr        — Mar cohort + same portfolio + GMV > 0
--   core_nrr_churn  — Mar cohort + same portfolio + GMV = 0
--   expansion       — first_dollar >= Apr 1 (ร้านใหม่แท้)
--   comeback        — ไม่มี Mar GMV + last owner ก่อน Mar = portfolio นี้ + มี GMV
--   handover_perf   — รับจาก SALE ใน Mar (new_user_exp_date = Mar) + วัด retention
--   new_sales       — รับจาก SALE ใน Q (new_user_exp_date = Apr/May/Jun)
--   transfer_in     — รับโอนจาก portfolio อื่น หรือ owner อื่นภายใน portfolio เดิม
--   transfer_out    — โอนออกไป (Mar cohort แต่ owner เปลี่ยน)
--
-- Transfer columns:
--   from_portfolio  — portfolio ต้นทาง (kam/pm/admin/sale)
--   to_portfolio    — portfolio ปลายทาง
--   transfer_scope  — intra (ย้ายมือในพอร์ตเดิม) / inter (ข้ามพอร์ต)
--
-- Reconcile check:
--   SUM(curr_gmv) ทุก row ต้องเท่ากับ total GMV B2B+B2C ของเดือนนั้น
--   Apr = 192.691M / May = 197.782M / Jun = 125.687M (1-19 Jun)
--
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ───────────────────────────────────────────────────────
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

-- ── 2. B2C scope — account_type = Enduser ────────────────────────────────
-- ไม่ต้อง break movement แค่ GMV รวมต่อเดือน
-- จะ UNION เข้า final ทีหลัง

-- ── 3. GMV per outlet per month (B2B only) ───────────────────────────────
base_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
  GROUP BY 1
),

apr_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
  GROUP BY 1
),

may_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
  GROUP BY 1
),

jun_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
  GROUP BY 1
),

-- ── 4. Ownership snapshot per outlet per month ───────────────────────────
-- ใช้ order ล่าสุดในเดือนนั้น — source of truth สำหรับ ownership
-- ไม่ filter commercial_owner เพราะต้องการเห็นทุก portfolio

mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    DATE(o.new_user_exp_date)        AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    DATE(o.new_user_exp_date)        AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

may_own AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    DATE(o.new_user_exp_date)        AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

jun_own AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    DATE(o.new_user_exp_date)        AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 5. first_dollar_date per outlet (global — no date filter) ────────────
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.first_dollar_date IS NOT NULL
  GROUP BY 1
),

-- ── 6. Last owner ก่อน Mar — ใช้สำหรับ comeback classification ──────────
pre_mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type NOT IN ('Consumer', 'Enduser', 'Exclude', 'TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 7. Mar cohort — fixed denominator ทั้ง Q ────────────────────────────
-- ทุก portfolio ที่มี GMV ใน Mar
-- ไม่นับ handover_in Mar (new_user_exp_date = Mar จาก SALE)
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.commercial_owner                              AS base_portfolio,
    mo.staff_owner                                   AS base_staff_owner,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    COALESCE(bg.gmv, 0)                              AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE COALESCE(bg.gmv, 0) > 0
    -- ไม่นับ handover_in Mar (outlet ที่ SALE เพิ่งโอนให้ใน Mar)
    AND NOT (
      mo.commercial_owner != 'SALE'
      AND FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
    )
),

-- ── 8. helper: portfolio label function ──────────────────────────────────
-- commercial_owner → portfolio name (lowercase)
-- KAM → 'kam', PM → 'pm', ADMIN → 'admin', SALE → 'sale'
-- NULL/blank → 'admin' (unmanaged เหมือน ADMIN)

-- ── 9. APRIL rows ─────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlets ที่มี order ใน Apr (ทุก portfolio)
  SELECT
    '2026-04'                                        AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)           AS account_id,
    COALESCE(mc.account_name, ao.account_name)       AS account_name,
    COALESCE(mc.account_type, ao.account_type)       AS account_type,

    -- Current ownership
    ao.commercial_owner                              AS current_portfolio,
    ao.staff_owner                                   AS current_staff_owner,

    -- Base ownership (Mar)
    mc.base_portfolio,
    mc.base_staff_owner,

    -- Dates
    COALESCE(ofd.first_dollar_date, ao.first_dollar_date) AS first_dollar_date,
    ao.new_user_exp_date,

    -- GMV
    COALESCE(mc.base_gmv, 0)                         AS base_gmv,
    COALESCE(ag.gmv, 0)                              AS curr_gmv,

    -- Movement classification
    CASE
      -- [1] expansion: ร้านใหม่แท้ — first_dollar ใน Q
      WHEN ofd.first_dollar_date >= '2026-04-01'
        THEN 'expansion'

      -- [2] handover_perf: รับจาก SALE ใน Mar → วัด retention ใน Apr
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        AND (pmo.commercial_owner = 'SALE' OR mc.outlet_id IS NULL)
        THEN 'handover_perf'

      -- [3] new_sales: รับจาก SALE ใน Apr
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-04'
        AND (pmo.commercial_owner = 'SALE' OR mc.outlet_id IS NULL)
        THEN 'new_sales'

      -- [4] core_nrr: Mar cohort + same portfolio + มี GMV
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = ao.commercial_owner
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'core_nrr'

      -- [5] core_nrr_churn: Mar cohort + same portfolio + ไม่มี GMV
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = ao.commercial_owner
        AND COALESCE(ag.gmv, 0) = 0
        THEN 'core_nrr_churn'

      -- [6] transfer_in: Mar cohort ของ portfolio อื่น มาอยู่ที่นี่
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio != ao.commercial_owner
        THEN 'transfer_in'

      -- [7] comeback: ไม่มี Mar GMV + last owner ก่อน Mar = portfolio นี้
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = ao.commercial_owner
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'comeback'

      -- [8] transfer_in: มาจาก portfolio อื่น (ไม่มี Mar GMV ด้วย)
      ELSE 'transfer_in'
    END                                              AS movement_type,

    -- Transfer detail
    mc.base_portfolio                                AS from_portfolio,
    ao.commercial_owner                              AS to_portfolio,
    CASE
      WHEN mc.base_portfolio = ao.commercial_owner   THEN 'intra'
      WHEN mc.base_portfolio IS NULL                 THEN NULL
      ELSE 'inter'
    END                                              AS transfer_scope

  FROM apr_own ao
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN apr_gmv ag                 ON ao.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน Apr (silent / transferred out)
  SELECT
    '2026-04'                 AS period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,

    -- ไม่มี Apr order — ใช้ base เป็น current
    mc.base_portfolio         AS current_portfolio,
    mc.base_staff_owner       AS current_staff_owner,
    mc.base_portfolio,
    mc.base_staff_owner,

    mc.first_dollar_date,
    mc.new_user_exp_date,
    mc.base_gmv,
    0                         AS curr_gmv,

    'core_nrr_churn'          AS movement_type,
    mc.base_portfolio         AS from_portfolio,
    mc.base_portfolio         AS to_portfolio,
    'intra'                   AS transfer_scope

  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_own)
),

-- ── 10. APRIL labels — lock classification ────────────────────────────────
-- ใช้ carry forward ไป May/Jun
apr_labels AS (
  SELECT
    outlet_id,
    current_portfolio,
    current_staff_owner,
    base_portfolio,
    base_staff_owner,
    first_dollar_date,
    new_user_exp_date,
    base_gmv,
    movement_type              AS fixed_label,
    from_portfolio,
    to_portfolio,
    transfer_scope
  FROM apr_rows
  -- เอาเฉพาะ LEG A (มี Apr order) เพื่อ lock classification
  WHERE curr_gmv > 0
     OR movement_type IN ('handover_perf','new_sales','expansion','comeback','transfer_in','transfer_out')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY outlet_id ORDER BY curr_gmv DESC) = 1
),

-- ── 11. MAY rows ──────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A: outlets ที่มี order ใน May
  SELECT
    '2026-05'                                        AS period_month,
    mo.outlet_id,
    COALESCE(al.account_id, mc.account_id, mo.account_id)    AS account_id,
    COALESCE(al.account_name, mc.account_name, mo.account_name) AS account_name,
    COALESCE(al.account_type, mc.account_type, mo.account_type) AS account_type,

    mo.commercial_owner                              AS current_portfolio,
    mo.staff_owner                                   AS current_staff_owner,
    COALESCE(al.base_portfolio, mc.base_portfolio)   AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,

    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, mo.new_user_exp_date)  AS new_user_exp_date,

    COALESCE(al.base_gmv, mc.base_gmv, 0)            AS base_gmv,
    COALESCE(mg.gmv, 0)                              AS curr_gmv,

    CASE
      -- inherit จาก Apr label ถ้ามี
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion'    AND COALESCE(mg.gmv,0) > 0 THEN 'expansion'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion'    AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'     AND COALESCE(mg.gmv,0) > 0 THEN 'comeback'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'     AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr'     AND COALESCE(mg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr'     AND COALESCE(mg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr_churn' THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NOT NULL THEN al.fixed_label

      -- outlet ใหม่ใน May (ไม่เคยเห็นใน Apr)
      WHEN al.outlet_id IS NULL AND ofd.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE' THEN 'handover_perf'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05')
        AND pmo.commercial_owner = 'SALE' THEN 'new_sales'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = mo.commercial_owner
        AND COALESCE(mg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = mo.commercial_owner
        AND COALESCE(mg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio != mo.commercial_owner THEN 'transfer_in'
      WHEN al.outlet_id IS NULL AND pmo.commercial_owner = mo.commercial_owner
        AND COALESCE(mg.gmv,0) > 0 THEN 'comeback'
      ELSE 'transfer_in'
    END                                              AS movement_type,

    COALESCE(al.from_portfolio, mc.base_portfolio)   AS from_portfolio,
    mo.commercial_owner                              AS to_portfolio,
    CASE
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) = mo.commercial_owner THEN 'intra'
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) IS NULL               THEN NULL
      ELSE 'inter'
    END                                              AS transfer_scope

  FROM may_own mo
  LEFT JOIN apr_labels al              ON mo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc              ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON mo.outlet_id = pmo.outlet_id
  LEFT JOIN may_gmv mg                 ON mo.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน May
  SELECT
    '2026-05',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mc.base_gmv,
    0,
    'core_nrr_churn',
    mc.base_portfolio, mc.base_portfolio, 'intra'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_own)
),

-- ── 12. JUN rows ──────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A: outlets ที่มี order ใน Jun
  SELECT
    '2026-06'                                        AS period_month,
    jo.outlet_id,
    COALESCE(al.account_id, mc.account_id, jo.account_id)    AS account_id,
    COALESCE(al.account_name, mc.account_name, jo.account_name) AS account_name,
    COALESCE(al.account_type, mc.account_type, jo.account_type) AS account_type,

    jo.commercial_owner                              AS current_portfolio,
    jo.staff_owner                                   AS current_staff_owner,
    COALESCE(al.base_portfolio, mc.base_portfolio)   AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,

    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, jo.new_user_exp_date)  AS new_user_exp_date,

    COALESCE(al.base_gmv, mc.base_gmv, 0)            AS base_gmv,
    COALESCE(jg.gmv, 0)                              AS curr_gmv,

    CASE
      -- inherit จาก Apr label
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion'    AND COALESCE(jg.gmv,0) > 0 THEN 'expansion'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion'    AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'     AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'     AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr'     AND COALESCE(jg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr'     AND COALESCE(jg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core_nrr_churn' THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NOT NULL THEN al.fixed_label

      -- outlet ใหม่ใน Jun
      WHEN al.outlet_id IS NULL AND ofd.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE' THEN 'handover_perf'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND pmo.commercial_owner = 'SALE' THEN 'new_sales'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = jo.commercial_owner
        AND COALESCE(jg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = jo.commercial_owner
        AND COALESCE(jg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NULL AND mc.outlet_id IS NOT NULL
        AND mc.base_portfolio != jo.commercial_owner THEN 'transfer_in'
      WHEN al.outlet_id IS NULL AND pmo.commercial_owner = jo.commercial_owner
        AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
      ELSE 'transfer_in'
    END                                              AS movement_type,

    COALESCE(al.from_portfolio, mc.base_portfolio)   AS from_portfolio,
    jo.commercial_owner                              AS to_portfolio,
    CASE
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) = jo.commercial_owner THEN 'intra'
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) IS NULL               THEN NULL
      ELSE 'inter'
    END                                              AS transfer_scope

  FROM jun_own jo
  LEFT JOIN apr_labels al              ON jo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc              ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN jun_gmv jg                 ON jo.outlet_id = jg.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน Jun
  SELECT
    '2026-06',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mc.base_gmv,
    0,
    'core_nrr_churn',
    mc.base_portfolio, mc.base_portfolio, 'intra'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_own)
),

-- ── 13. Union all months ──────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL
  SELECT * FROM may_rows
  UNION ALL
  SELECT * FROM jun_rows
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────
SELECT
  r.period_month,
  r.outlet_id,
  um.res_name                                        AS outlet_name,
  r.account_id,
  r.account_name,
  r.account_type,

  -- Portfolio & ownership
  r.current_portfolio,
  r.current_staff_owner,
  r.base_portfolio,
  r.base_staff_owner,

  -- Movement
  r.movement_type,
  r.from_portfolio,
  r.to_portfolio,
  r.transfer_scope,

  -- Dates (reconcile helpers)
  r.first_dollar_date,
  r.new_user_exp_date,

  -- GMV
  r.base_gmv,
  r.curr_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END                                                AS curr_days

FROM all_rows r
CROSS JOIN params p
LEFT JOIN `freshket-rn.dim.user_master` um
  ON CAST(um.res_id AS STRING) = r.outlet_id

ORDER BY
  r.period_month,
  r.current_portfolio,
  r.movement_type,
  r.curr_gmv DESC
