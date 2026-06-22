-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Movement VP View  (v3)
-- sql/q2_2026_movement_vp_view.sql
--
-- Scope: VP / Freshket-wide (KAM + PM + ADMIN รวมกัน)
--
-- Classification priority (เหมือนกันทุกเดือน ไม่ต้องมี label CTE):
--   [1] core_nrr/churn : อยู่ใน mar_cohort
--   [2] expansion      : first_dollar >= Apr 1
--   [3] handover       : new_user_exp_date = March เท่านั้น
--   [4] new_sales      : new_user_exp_date ใน Apr/May/Jun
--   [5] comeback       : fd < Apr + ไม่มี exp_date ใน Q (รวมกรณี exp_date ก่อน Mar)
--   [6] unclassified   : ELSE (ตรวจสอบด้วยมือ)
--
-- หลักการ:
--   - curr_gmv = GMV เฉพาะ order ที่ commercial_owner IN (KAM,PM,ADMIN)
--   - base_gmv = GMV ทุก order ใน March ไม่ filter (denominator NRR)
--   - ไม่มี transfer ภายใน KAM/PM/ADMIN เลย
--   - transfer_out = ออกไป SALE เท่านั้น (LEG B)
--
-- Reconcile:
--   C1: SUM(curr_gmv excl transfer_out) = dwh.order KAM/PM/ADMIN รวม
--   C2: ไม่มี transfer_in
--   C3: transfer_out external เท่านั้น
--   C4: outlet 1 แถวต่อเดือน → 0 duplicates
--   C5: label lock → ไม่มี outlet ที่มีมากกว่า 1 label (excl core)
--   C6: unclassified = 0
-- ════════════════════════════════════════════════════════════════════════════

WITH
params AS (
  SELECT
    DATE('2026-03-01') AS base_start, DATE('2026-03-31') AS base_end, 31 AS base_days,
    DATE('2026-04-01') AS apr_start,  DATE('2026-04-30') AS apr_end,  30 AS apr_days,
    DATE('2026-05-01') AS may_start,  DATE('2026-05-31') AS may_end,  31 AS may_days,
    DATE('2026-06-01') AS jun_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS jun_end,
    DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY),
              DATE('2026-06-01'), DAY) + 1 AS jun_days
),
outlet_first_dollar AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL AND o.first_dollar_date IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
base_gmv AS (
  -- base_gmv = GMV ทุก order ใน March ไม่ filter commercial_owner
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
apr_gmv AS (
  -- curr_gmv = เฉพาะ order ที่ KAM/PM/ADMIN
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner, DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner, DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner, DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
mar_handover_outlets AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND FORMAT_DATE('%Y-%m', DATE(o.new_user_exp_date)) = '2026-03'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
),
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner AS base_portfolio, mo.staff_owner AS base_staff_owner,
    mo.new_user_exp_date, ofd.first_dollar_date, COALESCE(bg.gmv, 0) AS base_gmv
  FROM (
    SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
      o.account_name, o.res_name, o.account_type,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
      TRIM(o.staff_owner) AS staff_owner, DATE(o.new_user_exp_date) AS new_user_exp_date
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── Classification macro ──────────────────────────────────────────────────────
-- ใช้ร่วมกันทุกเดือน — priority เดียวกันทุกครั้ง ไม่ต้องมี label CTE
-- [1] core     : อยู่ใน mar_cohort (ไม่สนว่าโอน portfolio ไหน)
-- [2] expansion: first_dollar >= Apr 1
-- [3] handover : new_user_exp_date = March เท่านั้น
-- [4] new_sales: new_user_exp_date ใน Apr/May/Jun
-- [5] comeback : fd < Apr + (ไม่มี exp_date ใน Q หรือ exp_date ก่อน Mar)
-- [6] unclassified: ELSE

apr_rows AS (
  -- LEG A
  SELECT
    '2026-04' AS period_month,
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    ao.commercial_owner AS current_portfolio, ao.staff_owner AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    COALESCE(ofd.first_dollar_date, mc.first_dollar_date) AS first_dollar_date,
    ao.new_user_exp_date,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,
    CASE
      -- [1] core
      WHEN mc.outlet_id IS NOT NULL THEN
        CASE WHEN COALESCE(ag.gmv,0) > 0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      -- [2] expansion
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01'
        THEN 'expansion'
      -- [3] handover: exp_date = March เท่านั้น
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- [4] new_sales: exp_date ใน Q
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      -- [5] comeback: fd < Apr + ไม่มี exp_date ใน Q (รวม exp_date ก่อน Mar)
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) < '2026-04-01'
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      -- [6] unclassified
      ELSE 'unclassified'
    END AS movement_type,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01' THEN '2026-04'
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03' THEN '2026-03'
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
      ELSE NULL
    END AS cohort_month,
    CAST(NULL AS STRING) AS transfer_scope
  FROM apr_own ao
  LEFT JOIN mar_cohort mc           ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN apr_gmv ag              ON ao.outlet_id = ag.outlet_id
  WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี Apr order ใน KAM/PM/ADMIN
  SELECT '2026-04',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN ao_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr_churn' END,
    '2026-03',
    CASE WHEN ao_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN apr_own ao_port ON mc.outlet_id = ao_port.outlet_id
    AND ao_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN apr_own ao_sale ON mc.outlet_id = ao_sale.outlet_id
    AND ao_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE ao_port.outlet_id IS NULL
),

may_rows AS (
  -- LEG A
  SELECT '2026-05',
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner, mo.staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    COALESCE(ofd.first_dollar_date, mc.first_dollar_date),
    mo.new_user_exp_date,
    COALESCE(mc.base_gmv, 0), COALESCE(mg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN
        CASE WHEN COALESCE(mg.gmv,0) > 0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01'
        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) < '2026-04-01'
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01' THEN '2026-04'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03' THEN '2026-03'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
      ELSE NULL
    END,
    CAST(NULL AS STRING)
  FROM may_own mo
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN may_gmv mg              ON mo.outlet_id = mg.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG B May
  SELECT '2026-05',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN mo_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr_churn' END,
    '2026-03',
    CASE WHEN mo_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN may_own mo_port ON mc.outlet_id = mo_port.outlet_id
    AND mo_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN may_own mo_sale ON mc.outlet_id = mo_sale.outlet_id
    AND mo_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE mo_port.outlet_id IS NULL
),

jun_rows AS (
  -- LEG A
  SELECT '2026-06',
    jo.outlet_id, jo.account_id, jo.account_name, jo.res_name, jo.account_type,
    jo.commercial_owner, jo.staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    COALESCE(ofd.first_dollar_date, mc.first_dollar_date),
    jo.new_user_exp_date,
    COALESCE(mc.base_gmv, 0), COALESCE(jg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN
        CASE WHEN COALESCE(jg.gmv,0) > 0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01'
        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) < '2026-04-01'
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01' THEN '2026-04'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03' THEN '2026-03'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
      ELSE NULL
    END,
    CAST(NULL AS STRING)
  FROM jun_own jo
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG B Jun
  SELECT '2026-06',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN jo_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr_churn' END,
    '2026-03',
    CASE WHEN jo_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN jun_own jo_port ON mc.outlet_id = jo_port.outlet_id
    AND jo_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN jun_own jo_sale ON mc.outlet_id = jo_sale.outlet_id
    AND jo_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE jo_port.outlet_id IS NULL
),

all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
)

SELECT
  r.period_month, r.movement_type, r.transfer_scope,
  r.current_portfolio, r.current_staff_owner,
  r.base_portfolio, r.base_staff_owner,
  r.outlet_id, r.account_id, r.account_name, r.res_name, r.account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0) AS curr_gmv,
  ROUND(r.base_gmv, 0) AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END AS curr_days,
  r.first_dollar_date, r.new_user_exp_date
FROM all_rows r
CROSS JOIN params p
ORDER BY r.period_month, r.current_portfolio, r.movement_type, r.curr_gmv DESC
