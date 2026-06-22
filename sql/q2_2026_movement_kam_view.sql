-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Movement — KAM Portfolio View  (v1)
-- sql/q2_2026_movement_kam_view.sql
--
-- Scope: KAM portfolio เท่านั้น (commercial_owner = 'KAM')
--
-- ต่างจาก VP view:
--   [1] mar_cohort  : last Mar order = 'KAM' เท่านั้น
--   [2] curr_gmv    : filter commercial_owner = 'KAM' เท่านั้น
--   [3] LEG A       : WHERE commercial_owner = 'KAM'
--   [4] LEG B       : mar_cohort ที่ไม่มี order 'KAM' เดือนนั้น
--                     → ถ้า last order = PM/ADMIN → transfer_out (inter)
--                     → ถ้า last order = SALE/ไม่มี → transfer_out (external) หรือ core_nrr
--
-- Classification priority:
--   [1] core_nrr    : อยู่ใน KAM mar_cohort
--   [2] expansion   : first_portfolio_date >= Apr + first KAM order >= Apr
--   [3] handover    : exp_date = March AND prev_owner = SALE
--   [4] new_sales   : exp_date ใน Q AND prev_owner = SALE
--                     หรือ first_kam_date ใน Q (fallback)
--   [5] comeback    : first_dollar < Apr + ไม่มี Mar GMV global + ไม่มี exp_date ใน Q
--   [6] transfer_in : last order = KAM แต่ Mar cohort อยู่ portfolio อื่น (PM/ADMIN)
--   [7] unclassified: ELSE
--
-- Transfer scope:
--   inter    = ย้ายข้าม portfolio (KAM↔PM↔ADMIN)
--   external = ออกไป SALE
--
-- curr_gmv = order ที่ commercial_owner = 'KAM' เท่านั้น
-- base_gmv = GMV ทุก order ใน March ไม่ filter owner
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

-- first_dollar_date  = first order global (ทุก owner)
-- first_kam_date     = first order ที่ commercial_owner = 'KAM'
-- first_dollar_date  = first order global (ทุก owner)
-- first_kam_date      = first order ที่ commercial_owner = 'KAM'
-- first_dollar_owner  = owner ของ first order จริงๆ (ทุก owner รวม SALE)
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    MIN(CASE WHEN UPPER(TRIM(o.commercial_owner)) = 'KAM'
             THEN DATE(o.delivery_date) END) AS first_kam_date,
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- prev_owner = last order ก่อน first KAM order
outlet_prev_owner AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS prev_owner
  FROM `freshket-rn.dwh.order` o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_kam_date
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- base_gmv = Mar GMV ทุก order ไม่ filter owner
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- curr_gmv = KAM order เท่านั้น
apr_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner = 'KAM'
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner = 'KAM'
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner = 'KAM'
  GROUP BY 1
),

-- ownership snapshot per month (last order wins, ทุก owner)
apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- mar_handover_outlets: exp_date = March AND prev_owner = SALE (หรือไม่มี prev)
-- exclude ออกจาก KAM mar_cohort
mar_handover_outlets AS (
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed  ON ofd.outlet_id = oed.outlet_id
  JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
    AND po.prev_owner = 'SALE'
  UNION DISTINCT
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed ON ofd.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
    AND po.outlet_id IS NULL
),

-- KAM mar_cohort: last Mar order = 'KAM' + base_gmv > 0 + ไม่ใช่ handover
-- KAM mar_cohort: Mar last = 'KAM' หรือ SALE spot + first_kam_date < Apr
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    CASE
      WHEN mo.commercial_owner = 'KAM' THEN mo.commercial_owner
      ELSE 'KAM'
    END AS base_portfolio,
    mo.staff_owner AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_kam_date,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM (
    SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
      o.account_name, o.res_name, o.account_type,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    mo.commercial_owner = 'KAM'
    OR (
      mo.commercial_owner = 'SALE'
      AND ofd.first_kam_date IS NOT NULL
      AND ofd.first_kam_date < '2026-04-01'
    )
  )
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── Apr rows ─────────────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlet มี order KAM ใน Apr
  SELECT
    '2026-04' AS period_month,
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    'KAM' AS current_portfolio, ao.staff_owner AS current_staff_owner,
    COALESCE(mc.base_portfolio, 'KAM') AS base_portfolio,
    COALESCE(mc.base_staff_owner, ao.staff_owner) AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_kam_date,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND ofd.first_kam_date   >= '2026-04-01'
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') = 'SALE'                        THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'new_sales'
      -- transfer_in: first_kam_date ใน Q + prev = PM/ADMIN (ย้ายข้ามพอร์ตมา)
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') IN ('PM','ADMIN')               THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06')
             OR COALESCE(po.prev_owner,'') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END AS movement_type,
    CASE
      WHEN mc.outlet_id IS NOT NULL              THEN '2026-03'
      WHEN oed.new_user_exp_date IS NOT NULL     THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL        THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END AS cohort_month,
    -- transfer_in จาก portfolio อื่น
    CASE
      WHEN mc.outlet_id IS NULL
        AND EXISTS (
          SELECT 1 FROM mar_cohort mc2
          WHERE mc2.outlet_id = ao.outlet_id
            AND mc2.base_portfolio != 'KAM'
        ) THEN 'inter'
      ELSE NULL
    END AS transfer_scope
  FROM apr_own ao
  LEFT JOIN mar_cohort mc            ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON ao.outlet_id = po.outlet_id
  LEFT JOIN apr_gmv ag               ON ao.outlet_id = ag.outlet_id
  LEFT JOIN base_gmv bg              ON ao.outlet_id = bg.outlet_id
  WHERE ao.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B: KAM mar_cohort ที่ไม่มี KAM order ใน Apr
  SELECT
    '2026-04',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(ao_port.commercial_owner, ao_sale.commercial_owner, 'KAM') AS current_portfolio,
    COALESCE(ao_port.staff_owner, ao_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'KAM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_kam_date,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN ao_port.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN ao_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    '2026-03',
    CASE
      WHEN ao_port.commercial_owner IN ('PM','ADMIN') THEN 'inter'
      WHEN ao_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN apr_own ao_kam  ON mc.outlet_id = ao_kam.outlet_id
    AND ao_kam.commercial_owner = 'KAM'
  LEFT JOIN apr_own ao_port ON mc.outlet_id = ao_port.outlet_id
    AND ao_port.commercial_owner IN ('PM','ADMIN')
  LEFT JOIN apr_own ao_sale ON mc.outlet_id = ao_sale.outlet_id
    AND ao_sale.commercial_owner = 'SALE'
  WHERE ao_kam.outlet_id IS NULL
),

-- ── May rows ─────────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A
  SELECT
    '2026-05',
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    'KAM', mo.staff_owner,
    COALESCE(mc.base_portfolio, 'KAM'),
    COALESCE(mc.base_staff_owner, mo.staff_owner),
    ofd.first_dollar_date, ofd.first_kam_date,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(mg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND ofd.first_kam_date   >= '2026-04-01'
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') = 'SALE'                        THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'new_sales'
      -- transfer_in: first_kam_date ใน Q + prev = PM/ADMIN (ย้ายข้ามพอร์ตมา)
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') IN ('PM','ADMIN')               THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06')
             OR COALESCE(po.prev_owner,'') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL              THEN '2026-03'
      WHEN oed.new_user_exp_date IS NOT NULL     THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL        THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END,
    CASE
      WHEN mc.outlet_id IS NULL
        AND EXISTS (
          SELECT 1 FROM mar_cohort mc2
          WHERE mc2.outlet_id = mo.outlet_id
            AND mc2.base_portfolio != 'KAM'
        ) THEN 'inter'
      ELSE NULL
    END
  FROM may_own mo
  LEFT JOIN mar_cohort mc            ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON mo.outlet_id = po.outlet_id
  LEFT JOIN may_gmv mg               ON mo.outlet_id = mg.outlet_id
  LEFT JOIN base_gmv bg              ON mo.outlet_id = bg.outlet_id
  WHERE mo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B
  SELECT
    '2026-05',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(mo_port.commercial_owner, mo_sale.commercial_owner, 'KAM') AS current_portfolio,
    COALESCE(mo_port.staff_owner, mo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'KAM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_kam_date,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN mo_port.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN mo_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    '2026-03',
    CASE
      WHEN mo_port.commercial_owner IN ('PM','ADMIN') THEN 'inter'
      WHEN mo_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN may_own mo_kam  ON mc.outlet_id = mo_kam.outlet_id
    AND mo_kam.commercial_owner = 'KAM'
  LEFT JOIN may_own mo_port ON mc.outlet_id = mo_port.outlet_id
    AND mo_port.commercial_owner IN ('PM','ADMIN')
  LEFT JOIN may_own mo_sale ON mc.outlet_id = mo_sale.outlet_id
    AND mo_sale.commercial_owner = 'SALE'
  WHERE mo_kam.outlet_id IS NULL
),

-- ── Jun rows ─────────────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A
  SELECT
    '2026-06',
    jo.outlet_id, jo.account_id, jo.account_name, jo.res_name, jo.account_type,
    'KAM', jo.staff_owner,
    COALESCE(mc.base_portfolio, 'KAM'),
    COALESCE(mc.base_staff_owner, jo.staff_owner),
    ofd.first_dollar_date, ofd.first_kam_date,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(jg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND ofd.first_kam_date   >= '2026-04-01'
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND COALESCE(po.prev_owner, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') = 'SALE'                        THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))        THEN 'new_sales'
      -- transfer_in: first_kam_date ใน Q + prev = PM/ADMIN (ย้ายข้ามพอร์ตมา)
      WHEN ofd.first_kam_date IS NOT NULL
        AND ofd.first_kam_date >= '2026-04-01'
        AND COALESCE(po.prev_owner, '') IN ('PM','ADMIN')               THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06')
             OR COALESCE(po.prev_owner,'') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL              THEN '2026-03'
      WHEN oed.new_user_exp_date IS NOT NULL     THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL        THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END,
    CASE
      WHEN mc.outlet_id IS NULL
        AND EXISTS (
          SELECT 1 FROM mar_cohort mc2
          WHERE mc2.outlet_id = jo.outlet_id
            AND mc2.base_portfolio != 'KAM'
        ) THEN 'inter'
      ELSE NULL
    END
  FROM jun_own jo
  LEFT JOIN mar_cohort mc            ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON jo.outlet_id = po.outlet_id
  LEFT JOIN jun_gmv jg               ON jo.outlet_id = jg.outlet_id
  LEFT JOIN base_gmv bg              ON jo.outlet_id = bg.outlet_id
  WHERE jo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B
  SELECT
    '2026-06',
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(jo_port.commercial_owner, jo_sale.commercial_owner, 'KAM') AS current_portfolio,
    COALESCE(jo_port.staff_owner, jo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'KAM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_kam_date,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN jo_port.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN jo_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    '2026-03',
    CASE
      WHEN jo_port.commercial_owner IN ('PM','ADMIN') THEN 'inter'
      WHEN jo_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN jun_own jo_kam  ON mc.outlet_id = jo_kam.outlet_id
    AND jo_kam.commercial_owner = 'KAM'
  LEFT JOIN jun_own jo_port ON mc.outlet_id = jo_port.outlet_id
    AND jo_port.commercial_owner IN ('PM','ADMIN')
  LEFT JOIN jun_own jo_sale ON mc.outlet_id = jo_sale.outlet_id
    AND jo_sale.commercial_owner = 'SALE'
  WHERE jo_kam.outlet_id IS NULL
),

all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
)

SELECT
  r.period_month,
  r.movement_type,
  r.transfer_scope,
  r.current_portfolio,
  r.current_staff_owner,
  r.base_portfolio,
  r.base_staff_owner,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.res_name,
  r.account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0) AS curr_gmv,
  ROUND(r.base_gmv, 0) AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END AS curr_days,
  r.first_dollar_date,
  r.first_kam_date,
  r.new_user_exp_date
FROM all_rows r
CROSS JOIN params p
ORDER BY r.period_month, r.movement_type, r.curr_gmv DESC
