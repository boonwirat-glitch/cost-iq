-- DIAG: transfer_in detail — outlet / account / gmv / staff_owner / pre-Mar owner / TL
WITH
params AS (
  SELECT
    DATE('2026-03-01') AS base_start, DATE('2026-03-31') AS base_end,
    DATE('2026-04-01') AS apr_start,  DATE('2026-04-30') AS apr_end,
    DATE('2026-05-01') AS may_start,  DATE('2026-05-31') AS may_end,
    DATE('2026-06-01') AS jun_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS jun_end
),
-- Mar cohort: commercial_owner = KAM (ไม่ JOIN roster)
mar_cohort_ids AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
    AND o.gmv_ex_vat > 0
    AND (DATE(o.new_user_exp_date) IS NULL
         OR FORMAT_DATE('%Y-%m', DATE(o.new_user_exp_date)) != '2026-03')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
-- pre-Mar owner
pre_mar AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS pre_mar_commercial_owner,
    TRIM(o.staff_owner)             AS pre_mar_staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
-- outlet_first_dollar
ofd AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
-- Q ownership per month
apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         CAST(o.account_id AS STRING) AS account_id,
         o.account_name, o.account_type,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
         TRIM(o.staff_owner) AS staff_owner,
         ROUND(SUM(o.gmv_ex_vat) OVER (PARTITION BY o.user_id), 0) AS curr_gmv,
         DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         CAST(o.account_id AS STRING) AS account_id,
         o.account_name, o.account_type,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
         TRIM(o.staff_owner) AS staff_owner,
         ROUND(SUM(o.gmv_ex_vat) OVER (PARTITION BY o.user_id), 0) AS curr_gmv,
         DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         CAST(o.account_id AS STRING) AS account_id,
         o.account_name, o.account_type,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
         TRIM(o.staff_owner) AS staff_owner,
         ROUND(SUM(o.gmv_ex_vat) OVER (PARTITION BY o.user_id), 0) AS curr_gmv,
         DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
-- KAM roster for tl_email lookup
kam_list AS (
  SELECT kam_name, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk' AS kam_name, 'nitipat.s@freshket.co' AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor', 'nitipat.s@freshket.co'),
    STRUCT('Duangruedee (Ning) Bulalom', 'nitipat.s@freshket.co'),
    STRUCT('Guntinun (Monet) Thanoochan', 'pavarisa.mu@freshket.co'),
    STRUCT('Intuon (Jane) Yanakit', 'pavarisa.mu@freshket.co'),
    STRUCT('Napat (To) Kaikaew', 'nitipat.s@freshket.co'),
    STRUCT('Natchita (Foam) Bunkong', 'pavarisa.mu@freshket.co'),
    STRUCT('Niracha (Cream) Sangka', 'pavarisa.mu@freshket.co'),
    STRUCT('Nuttawan (Kwang) Mahaporn', 'nitipat.s@freshket.co'),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon', 'nitipat.s@freshket.co'),
    STRUCT('Puttipong (Tape) Wanithaweewat', 'pavarisa.mu@freshket.co'),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti', 'nitipat.s@freshket.co'),
    STRUCT('Siriprapa (Pop) Piapeng', 'pavarisa.mu@freshket.co'),
    STRUCT('Treerak (May) Sangjua', 'pavarisa.mu@freshket.co'),
    STRUCT('Warissara (Ply) Chanaboon', 'pavarisa.mu@freshket.co'),
    STRUCT('Nutkamol (Fang) Siladam', 'nitipat.s@freshket.co'),
    STRUCT('Sojirat (May) Charoensuk', 'pavarisa.mu@freshket.co'),
    STRUCT('Supasuta (Snow) Wongwiwut', 'nitipat.s@freshket.co'),
    STRUCT('Mongkonkrid (Max) Piyapongsak', 'pavarisa.mu@freshket.co'),
    STRUCT('Nitipat (Name) Suparattanasilp', 'nitipat.s@freshket.co')
  ])
),
-- combine all months
combined AS (
  -- Apr: prev owner = Mar owner
  SELECT '2026-04' AS period_month, o.outlet_id, o.account_id, o.account_name,
         o.account_type, o.commercial_owner, o.staff_owner, o.curr_gmv,
         o.new_user_exp_date, pm.pre_mar_commercial_owner, pm.pre_mar_staff_owner,
         k.tl_email AS period_tl_email, fd.first_dollar_date,
         -- prev month before transfer = Mar
         COALESCE(mar.commercial_owner, pm.pre_mar_commercial_owner) AS prev_commercial_owner,
         COALESCE(mar.staff_owner, pm.pre_mar_staff_owner)           AS prev_staff_owner
  FROM apr_own o
  LEFT JOIN mar_cohort_ids mc ON o.outlet_id = mc.outlet_id
  LEFT JOIN pre_mar pm ON o.outlet_id = pm.outlet_id
  LEFT JOIN kam_list k ON TRIM(o.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN ofd fd ON o.outlet_id = fd.outlet_id
  -- Mar ownership (prev month before Apr)
  LEFT JOIN (
    SELECT CAST(o2.user_id AS STRING) AS outlet_id,
           UPPER(TRIM(o2.commercial_owner)) AS commercial_owner,
           TRIM(o2.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o2 CROSS JOIN params p
    WHERE o2.delivery_date BETWEEN p.base_start AND p.base_end
      AND o2.account_type IN ('SA','MC','Chain','Unknown')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o2.user_id ORDER BY o2.delivery_date DESC) = 1
  ) mar ON o.outlet_id = mar.outlet_id
  WHERE o.commercial_owner = 'KAM'
    AND mc.outlet_id IS NULL
    AND fd.first_dollar_date < '2026-04-01'
    AND NOT (FORMAT_DATE('%Y-%m', o.new_user_exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
             AND pm.pre_mar_commercial_owner = 'SALE')
    AND pm.pre_mar_commercial_owner != 'SALE'
    AND o.curr_gmv > 0

  UNION ALL

  -- May: prev owner = Apr owner
  SELECT '2026-05', o.outlet_id, o.account_id, o.account_name,
         o.account_type, o.commercial_owner, o.staff_owner, o.curr_gmv,
         o.new_user_exp_date, pm.pre_mar_commercial_owner, pm.pre_mar_staff_owner,
         k.tl_email, fd.first_dollar_date,
         COALESCE(prev_apr.commercial_owner, pm.pre_mar_commercial_owner) AS prev_commercial_owner,
         COALESCE(prev_apr.staff_owner, pm.pre_mar_staff_owner)           AS prev_staff_owner
  FROM may_own o
  LEFT JOIN mar_cohort_ids mc ON o.outlet_id = mc.outlet_id
  LEFT JOIN pre_mar pm ON o.outlet_id = pm.outlet_id
  LEFT JOIN kam_list k ON TRIM(o.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN ofd fd ON o.outlet_id = fd.outlet_id
  LEFT JOIN (
    SELECT CAST(o2.user_id AS STRING) AS outlet_id,
           UPPER(TRIM(o2.commercial_owner)) AS commercial_owner,
           TRIM(o2.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o2 CROSS JOIN params p
    WHERE o2.delivery_date BETWEEN p.apr_start AND p.apr_end
      AND o2.account_type IN ('SA','MC','Chain','Unknown')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o2.user_id ORDER BY o2.delivery_date DESC) = 1
  ) prev_apr ON o.outlet_id = prev_apr.outlet_id
  WHERE o.commercial_owner = 'KAM'
    AND mc.outlet_id IS NULL
    AND fd.first_dollar_date < '2026-04-01'
    AND NOT (FORMAT_DATE('%Y-%m', o.new_user_exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
             AND pm.pre_mar_commercial_owner = 'SALE')
    AND pm.pre_mar_commercial_owner != 'SALE'
    AND o.curr_gmv > 0

  UNION ALL

  -- Jun: prev owner = May owner
  SELECT '2026-06', o.outlet_id, o.account_id, o.account_name,
         o.account_type, o.commercial_owner, o.staff_owner, o.curr_gmv,
         o.new_user_exp_date, pm.pre_mar_commercial_owner, pm.pre_mar_staff_owner,
         k.tl_email, fd.first_dollar_date,
         COALESCE(prev_may.commercial_owner, pm.pre_mar_commercial_owner) AS prev_commercial_owner,
         COALESCE(prev_may.staff_owner, pm.pre_mar_staff_owner)           AS prev_staff_owner
  FROM jun_own o
  LEFT JOIN mar_cohort_ids mc ON o.outlet_id = mc.outlet_id
  LEFT JOIN pre_mar pm ON o.outlet_id = pm.outlet_id
  LEFT JOIN kam_list k ON TRIM(o.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN ofd fd ON o.outlet_id = fd.outlet_id
  LEFT JOIN (
    SELECT CAST(o2.user_id AS STRING) AS outlet_id,
           UPPER(TRIM(o2.commercial_owner)) AS commercial_owner,
           TRIM(o2.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o2 CROSS JOIN params p
    WHERE o2.delivery_date BETWEEN p.may_start AND p.may_end
      AND o2.account_type IN ('SA','MC','Chain','Unknown')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o2.user_id ORDER BY o2.delivery_date DESC) = 1
  ) prev_may ON o.outlet_id = prev_may.outlet_id
  WHERE o.commercial_owner = 'KAM'
    AND mc.outlet_id IS NULL
    AND fd.first_dollar_date < '2026-04-01'
    AND NOT (FORMAT_DATE('%Y-%m', o.new_user_exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
             AND pm.pre_mar_commercial_owner = 'SALE')
    AND pm.pre_mar_commercial_owner != 'SALE'
    AND o.curr_gmv > 0
)

SELECT
  c.period_month,
  c.outlet_id,
  um.res_name                  AS outlet_name,
  c.account_name,
  c.account_type,
  ROUND(c.curr_gmv, 0)         AS curr_gmv,
  c.staff_owner                AS current_staff_owner,
  c.prev_commercial_owner      AS from_commercial_owner,
  c.prev_staff_owner           AS from_staff_owner,
  c.pre_mar_commercial_owner,
  c.period_tl_email
FROM combined c
LEFT JOIN `freshket-rn.dim.user_master` um
  ON CAST(um.res_id AS STRING) = c.outlet_id
ORDER BY c.period_month, c.curr_gmv DESC
