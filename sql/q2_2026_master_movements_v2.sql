-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Master Movement Table  (v2)
-- q2_2026_master_movements_v2.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Goal: เห็น movement ทุก outlet ใน Freshket (ยกเว้น B2C/Enduser) ตลอด Q2 2026
--       ใช้เป็น single source of truth สำหรับ NRR ทุก portfolio ทุก scope
--
-- Grain: 1 row ต่อ outlet ต่อเดือน (Apr/May/Jun)
--        base period = March (fixed ทั้ง Q)
--
-- Portfolios:
--   KAM   — commercial_owner = 'KAM'
--   PM    — commercial_owner = 'PM'
--   ADMIN — commercial_owner = 'ADMIN' (unmanaged B2B)
--   SALE  — commercial_owner = 'SALE'
--
-- Mar cohort per portfolio (denominator ของ NRR):
--   commercial_owner = X + gmv > 0 in Mar + new_user_exp_date != Mar
--   ไม่ filter staff_owner — รวม departed KAM, blank, ทุกคน
--   handover_in_mar (new_user_exp_date = Mar) ไม่นับเป็น core cohort
--
-- Movement priority (ตามลำดับใน CASE):
--   [1] expansion    — first_dollar >= Apr + ไม่เคยมี order ก่อน Apr
--   [2] handover_perf — new_user_exp_date = Mar + pre_mar_owner = SALE
--   [3] new_sales    — new_user_exp_date ใน Q + pre_mar_owner = SALE
--   [4] core_nrr     — อยู่ mar_cohort + same portfolio + GMV > 0
--   [5] core_nrr_churn — อยู่ mar_cohort + same portfolio + GMV = 0
--   [6] transfer_out — อยู่ mar_cohort + เปลี่ยน portfolio ออก
--   [7] comeback     — ไม่อยู่ mar_cohort + pre_mar = same portfolio + GMV > 0
--   [8] transfer_in  — อื่นๆ ทั้งหมด
--
-- Reconcile check (curr_gmv > 0):
--   Apr = 187.674M / May = 192.425M / Jun = 122.291M (1-19 มิ.ย.)
--
-- KAM ground truth Apr:
--   core_nrr = 2,455 outlets / 126.688M
--   core_nrr_churn = 241 outlets
--   total core cohort = 2,696 outlets / 136.937M
--
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ───────────────────────────────────────────────────────
params AS (
  SELECT
    DATE('2026-03-01') AS base_start, DATE('2026-03-31') AS base_end, 31 AS base_days,
    DATE('2026-04-01') AS apr_start,  DATE('2026-04-30') AS apr_end,  30 AS apr_days,
    DATE('2026-05-01') AS may_start,  DATE('2026-05-31') AS may_end,  31 AS may_days,
    DATE('2026-06-01') AS jun_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS jun_end,
    DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), DATE('2026-06-01'), DAY) + 1 AS jun_days
),

-- ── 2. first_dollar per outlet (global — no date filter) ─────────────────
-- ไม่ filter commercial_owner เพื่อให้ได้ first_dollar ที่แท้จริง
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.first_dollar_date IS NOT NULL
  GROUP BY 1
),

-- ── 3. GMV per outlet per month (ทุก portfolio) ───────────────────────────
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
apr_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- ── 4. Ownership snapshot per outlet per month ────────────────────────────
-- ใช้ order ล่าสุดในเดือนนั้น ไม่ filter commercial_owner
mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 5. pre_period ownership — last order ก่อนแต่ละเดือน ──────────────────
-- ใช้หา: handover_perf/new_sales (pre_mar = SALE), comeback (pre_period = same portfolio)
pre_mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-04-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_may_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-05-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_jun_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-06-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6. Mar cohort — fixed denominator ทั้ง Q ─────────────────────────────
-- ทุก portfolio: commercial_owner = X + gmv > 0 + new_user_exp_date != Mar
-- ไม่ filter staff_owner — รวม departed, blank ทุกคน
-- handover_in_mar (new_user_exp_date = Mar) ไม่นับเป็น core cohort ของ receiving portfolio
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.commercial_owner             AS base_portfolio,
    mo.staff_owner                  AS base_staff_owner,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    COALESCE(bg.gmv, 0)             AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE COALESCE(bg.gmv, 0) > 0
    -- ไม่นับ outlet ที่รับโอนมาใน Mar (new_user_exp_date = Mar)
    -- เพราะ GMV ใน Mar ส่วนใหญ่ยังเป็นของ previous owner
    AND (mo.new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date) != '2026-03')
),

-- ── 7. Apr classification (locked) ───────────────────────────────────────
-- lock ตั้งแต่ Apr → carry forward ไป May/Jun
-- ใช้ pre_mar_own สำหรับ handover/new_sales/comeback classification
apr_labels AS (
  SELECT
    ao.outlet_id,
    ao.account_id,
    ao.account_name,
    ao.account_type,
    ao.commercial_owner             AS current_portfolio,
    ao.staff_owner                  AS current_staff_owner,
    ao.new_user_exp_date,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.base_gmv,
    ofd.first_dollar_date,
    pmo.commercial_owner            AS pre_mar_portfolio,
    pmo.staff_owner                 AS pre_mar_staff_owner,

    CASE
      -- [1] expansion: first_dollar ใน Q + ไม่เคยมี order ก่อน Apr
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND pmo.outlet_id IS NULL
        THEN 'expansion'

      -- [2] handover_perf: รับจาก SALE ใน Mar → วัด retention ใน Apr
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE'
        THEN 'handover_perf'

      -- [3] new_sales: รับจาก SALE ใน Apr
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-04'
        AND pmo.commercial_owner = 'SALE'
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

      -- [6] transfer_in: Mar cohort ของ portfolio อื่น
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio != ao.commercial_owner
        THEN 'transfer_in'

      -- [7] comeback: ไม่อยู่ mar_cohort + pre_mar = same portfolio + มี GMV
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = ao.commercial_owner
        AND COALESCE(ag.gmv, 0) > 0
        THEN 'comeback'

      -- [8] transfer_in: อื่นๆ
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_own ao
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN apr_gmv ag                 ON ao.outlet_id = ag.outlet_id
),

-- ── 8. APRIL rows ─────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlets ที่มี order ใน Apr
  SELECT
    '2026-04'                                         AS period_month,
    ao.outlet_id,
    ao.account_id,
    ao.account_name,
    ao.account_type,
    ao.commercial_owner                               AS current_portfolio,
    ao.staff_owner                                    AS current_staff_owner,
    al.base_portfolio,
    al.base_staff_owner,
    al.first_dollar_date,
    al.new_user_exp_date,
    al.pre_mar_portfolio,
    al.pre_mar_staff_owner,
    COALESCE(al.base_gmv, 0)                          AS base_gmv,
    COALESCE(ag.gmv, 0)                               AS curr_gmv,
    al.fixed_label                                    AS movement_type,
    -- transfer detail
    al.base_portfolio                                 AS from_portfolio,
    ao.commercial_owner                               AS to_portfolio,
    CASE
      WHEN al.base_portfolio = ao.commercial_owner    THEN 'intra'
      WHEN al.base_portfolio IS NULL                  THEN NULL
      ELSE 'inter'
    END                                               AS transfer_scope
  FROM apr_own ao
  LEFT JOIN apr_labels al ON ao.outlet_id = al.outlet_id
  LEFT JOIN apr_gmv ag    ON ao.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน Apr (silent = core_nrr_churn / โอนออก)
  SELECT
    '2026-04',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,  -- current = base (ไม่มี Apr order)
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    NULL, NULL,  -- pre_mar_portfolio, pre_mar_staff_owner
    mc.base_gmv, 0,
    'core_nrr_churn',
    mc.base_portfolio, mc.base_portfolio, 'intra'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_own)
),

-- ── 9. MAY rows ───────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A: outlets ที่มี order ใน May
  SELECT
    '2026-05'                                         AS period_month,
    mo.outlet_id,
    COALESCE(al.account_id, mo.account_id)            AS account_id,
    COALESCE(al.account_name, mo.account_name)        AS account_name,
    COALESCE(al.account_type, mo.account_type)        AS account_type,
    mo.commercial_owner                               AS current_portfolio,
    mo.staff_owner                                    AS current_staff_owner,
    COALESCE(al.base_portfolio, mc.base_portfolio)    AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,
    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, mo.new_user_exp_date)  AS new_user_exp_date,
    COALESCE(al.pre_mar_portfolio, pmo.commercial_owner)  AS pre_mar_portfolio,
    COALESCE(al.pre_mar_staff_owner, pmo.staff_owner)     AS pre_mar_staff_owner,
    COALESCE(al.base_gmv, mc.base_gmv, 0)             AS base_gmv,
    COALESCE(mg.gmv, 0)                               AS curr_gmv,

    CASE
      -- inherit จาก Apr label
      WHEN al.outlet_id IS NOT NULL THEN
        CASE al.fixed_label
          WHEN 'core_nrr'      THEN IF(COALESCE(mg.gmv,0) > 0, 'core_nrr', 'core_nrr_churn')
          WHEN 'core_nrr_churn' THEN 'core_nrr_churn'
          WHEN 'expansion'     THEN IF(COALESCE(mg.gmv,0) > 0, 'expansion', 'transfer_in')
          WHEN 'comeback'      THEN IF(COALESCE(mg.gmv,0) > 0, 'comeback', 'transfer_in')
          ELSE al.fixed_label
        END

      -- outlet ใหม่ใน May (ไม่เคยเห็นใน Apr)
      WHEN ofd.first_dollar_date >= '2026-04-01' AND pmo.outlet_id IS NULL THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE' THEN 'handover_perf'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05')
        AND pmo.commercial_owner = 'SALE' THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = mo.commercial_owner
        THEN IF(COALESCE(mg.gmv,0) > 0, 'core_nrr', 'core_nrr_churn')
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN 'transfer_in'
      WHEN pmo.commercial_owner = mo.commercial_owner AND COALESCE(mg.gmv,0) > 0
        THEN 'comeback'
      ELSE 'transfer_in'
    END                                               AS movement_type,

    COALESCE(al.from_portfolio, al.base_portfolio, mc.base_portfolio) AS from_portfolio,
    mo.commercial_owner                               AS to_portfolio,
    CASE
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) = mo.commercial_owner THEN 'intra'
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) IS NULL               THEN NULL
      ELSE 'inter'
    END                                               AS transfer_scope

  FROM may_own mo
  LEFT JOIN apr_labels al           ON mo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON mo.outlet_id = pmo.outlet_id
  LEFT JOIN may_gmv mg              ON mo.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน May
  SELECT
    '2026-05',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    NULL, NULL,
    mc.base_gmv, 0,
    'core_nrr_churn',
    mc.base_portfolio, mc.base_portfolio, 'intra'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_own)
),

-- ── 10. JUN rows ──────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A: outlets ที่มี order ใน Jun
  SELECT
    '2026-06'                                         AS period_month,
    jo.outlet_id,
    COALESCE(al.account_id, jo.account_id)            AS account_id,
    COALESCE(al.account_name, jo.account_name)        AS account_name,
    COALESCE(al.account_type, jo.account_type)        AS account_type,
    jo.commercial_owner                               AS current_portfolio,
    jo.staff_owner                                    AS current_staff_owner,
    COALESCE(al.base_portfolio, mc.base_portfolio)    AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,
    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, jo.new_user_exp_date)  AS new_user_exp_date,
    COALESCE(al.pre_mar_portfolio, pmo.commercial_owner)  AS pre_mar_portfolio,
    COALESCE(al.pre_mar_staff_owner, pmo.staff_owner)     AS pre_mar_staff_owner,
    COALESCE(al.base_gmv, mc.base_gmv, 0)             AS base_gmv,
    COALESCE(jg.gmv, 0)                               AS curr_gmv,

    CASE
      -- inherit จาก Apr label
      WHEN al.outlet_id IS NOT NULL THEN
        CASE al.fixed_label
          WHEN 'core_nrr'      THEN IF(COALESCE(jg.gmv,0) > 0, 'core_nrr', 'core_nrr_churn')
          WHEN 'core_nrr_churn' THEN 'core_nrr_churn'
          WHEN 'expansion'     THEN IF(COALESCE(jg.gmv,0) > 0, 'expansion', 'transfer_in')
          WHEN 'comeback'      THEN IF(COALESCE(jg.gmv,0) > 0, 'comeback', 'transfer_in')
          ELSE al.fixed_label
        END

      -- outlet ใหม่ใน Jun
      WHEN ofd.first_dollar_date >= '2026-04-01' AND pmo.outlet_id IS NULL THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE' THEN 'handover_perf'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND pmo.commercial_owner = 'SALE' THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = jo.commercial_owner
        THEN IF(COALESCE(jg.gmv,0) > 0, 'core_nrr', 'core_nrr_churn')
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN 'transfer_in'
      WHEN pmo.commercial_owner = jo.commercial_owner AND COALESCE(jg.gmv,0) > 0
        THEN 'comeback'
      ELSE 'transfer_in'
    END                                               AS movement_type,

    COALESCE(al.from_portfolio, al.base_portfolio, mc.base_portfolio) AS from_portfolio,
    jo.commercial_owner                               AS to_portfolio,
    CASE
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) = jo.commercial_owner THEN 'intra'
      WHEN COALESCE(al.base_portfolio, mc.base_portfolio) IS NULL               THEN NULL
      ELSE 'inter'
    END                                               AS transfer_scope

  FROM jun_own jo
  LEFT JOIN apr_labels al           ON jo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน Jun
  SELECT
    '2026-06',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    NULL, NULL,
    mc.base_gmv, 0,
    'core_nrr_churn',
    mc.base_portfolio, mc.base_portfolio, 'intra'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_own)
),

-- ── 11. transfer_out rows ─────────────────────────────────────────────────
-- Mar cohort ที่โอนออกจาก portfolio ไปอยู่ portfolio อื่นใน period นั้น
-- แสดงใน base_portfolio เดิม (มุมมองคนส่งออก)
-- curr_gmv = 0 เสมอ (ออกไปแล้ว)
transfer_out_apr AS (
  SELECT
    '2026-04' AS period_month,
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio                                 AS current_portfolio,
    mc.base_staff_owner                               AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    ao.commercial_owner                               AS pre_mar_portfolio,
    ao.staff_owner                                    AS pre_mar_staff_owner,
    mc.base_gmv, 0                                    AS curr_gmv,
    'transfer_out'                                    AS movement_type,
    mc.base_portfolio                                 AS from_portfolio,
    ao.commercial_owner                               AS to_portfolio,
    'inter'                                           AS transfer_scope
  FROM mar_cohort mc
  JOIN apr_own ao ON mc.outlet_id = ao.outlet_id
  WHERE ao.commercial_owner != mc.base_portfolio
),
transfer_out_may AS (
  SELECT
    '2026-05',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mo.commercial_owner, mo.staff_owner,
    mc.base_gmv, 0,
    'transfer_out',
    mc.base_portfolio, mo.commercial_owner, 'inter'
  FROM mar_cohort mc
  JOIN may_own mo ON mc.outlet_id = mo.outlet_id
  WHERE mo.commercial_owner != mc.base_portfolio
),
transfer_out_jun AS (
  SELECT
    '2026-06',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    jo.commercial_owner, jo.staff_owner,
    mc.base_gmv, 0,
    'transfer_out',
    mc.base_portfolio, jo.commercial_owner, 'inter'
  FROM mar_cohort mc
  JOIN jun_own jo ON mc.outlet_id = jo.outlet_id
  WHERE jo.commercial_owner != mc.base_portfolio
),

-- ── 12. Union all ─────────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL
  SELECT * FROM may_rows
  UNION ALL
  SELECT * FROM jun_rows
  UNION ALL
  SELECT * FROM transfer_out_apr
  UNION ALL
  SELECT * FROM transfer_out_may
  UNION ALL
  SELECT * FROM transfer_out_jun
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────
SELECT
  r.period_month,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.account_type,

  -- Ownership
  r.current_portfolio,
  r.current_staff_owner,
  r.base_portfolio,
  r.base_staff_owner,

  -- Movement
  r.movement_type,
  r.from_portfolio,
  r.to_portfolio,
  r.transfer_scope,

  -- Reconcile helpers
  r.first_dollar_date,
  r.new_user_exp_date,
  r.pre_mar_portfolio,
  r.pre_mar_staff_owner,

  -- GMV
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
  r.period_month,
  r.current_portfolio,
  r.movement_type,
  r.curr_gmv DESC
