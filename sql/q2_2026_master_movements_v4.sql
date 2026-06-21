-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Master Movement Table  (v4)
-- sql/q2_2026_master_movements_v4.sql
-- Design spec: docs/qnrr_master_movement_design_v3.md (2026-06-21)
--
-- หลักการ:
--   1. base_gmv / curr_gmv = GMV ทุก order ของร้าน ไม่ filter commercial_owner
--   2. Label lock — ทุก movement ยกเว้น transfer lock ตั้งแต่เดือนแรก
--   3. transfer_out curr_gmv = 0 เสมอ
--   4. Ownership = last order ของแต่ละเดือน (last order wins)
--   5. ห้ามใช้ dim.user_master
--   6. Handover vs new_sales fallback (ไม่มี new_user_exp_date):
--      ดู pre_period_own = SALE (last order ก่อน period)
--      แยกด้วย pre_mar_own:
--        pre_period=SALE + pre_mar=SALE/NULL → handover (โอนมาก่อน/ใน Mar)
--        pre_period=SALE + pre_mar≠SALE      → new_sales (โอนมาระหว่าง Q)
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ──────────────────────────────────────────────────────────
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

-- ── 2. First dollar per outlet (global B2B) ───────────────────────────────────
outlet_first_dollar AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.first_dollar_date IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- ── 3. GMV per outlet per month — ไม่ filter commercial_owner ─────────────────
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

-- ── 4. Ownership snapshots — last order per outlet per month ──────────────────
mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner,
    DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner,
    DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner,
    DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner) AS staff_owner,
    DATE(o.new_user_exp_date) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 5. Pre-period ownership ───────────────────────────────────────────────────
-- ใช้ตรวจ handover/new_sales fallback เมื่อไม่มี new_user_exp_date
-- ดูแค่ last order ก่อน period — ไม่ย้อนไกลกว่านี้
-- แยก handover vs new_sales ด้วย pre_mar:
--   pre_period=SALE + pre_mar=SALE/NULL → handover
--   pre_period=SALE + pre_mar≠SALE      → new_sales (โอนมาระหว่าง Q)
pre_mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
         TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-04-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-05-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-06-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6. Mar handover outlets ───────────────────────────────────────────────────
mar_handover_outlets AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND FORMAT_DATE('%Y-%m', DATE(o.new_user_exp_date)) = '2026-03'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
),

-- ── 7. Mar cohort — fixed denominator ────────────────────────────────────────
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner AS base_portfolio,
    mo.staff_owner      AS base_staff_owner,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── 8. Apr labels — lock classification ──────────────────────────────────────
-- Fallback [2b]: pre_apr=SALE → handover
--   (ถ้าก่อน Apr เป็น SALE แสดงว่าโอนมาก่อนหรือใน Mar = handover)
-- Fallback Apr ไม่มี [3b] เพราะ new_sales Apr ต้องมี exp_date=Apr เท่านั้น
apr_labels AS (
  SELECT
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    ao.commercial_owner AS current_portfolio,
    ao.staff_owner      AS current_staff_owner,
    ao.new_user_exp_date,
    mc.base_portfolio, mc.base_staff_owner, mc.base_gmv,
    COALESCE(ofd.first_dollar_date, mc.first_dollar_date) AS first_dollar_date,
    pmo.commercial_owner AS pre_mar_portfolio,

    CASE
      -- [1] expansion
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01'
        AND ao.commercial_owner != 'SALE' THEN 'expansion'
      -- [2] handover: exp_date = Mar
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03' THEN 'handover'
      -- [2b] handover fallback: ไม่มี exp_date + pre_apr=SALE
      --   (ก่อน Apr เป็น SALE = โอนมาก่อนหรือใน Mar)
      WHEN ao.new_user_exp_date IS NULL
        AND papr.commercial_owner = 'SALE' THEN 'handover'
      -- [3] new_sales: exp_date ใน Q
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = ao.commercial_owner THEN 'core'
      -- [5] transfer_in from cohort
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner THEN 'transfer_in'
      -- [6] comeback
      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, mc.first_dollar_date) < '2026-04-01'
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      -- [7] transfer_in: ELSE
      ELSE 'transfer_in'
    END AS fixed_label,

    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN mc.base_portfolio ELSE NULL END AS from_portfolio,
    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN ao.commercial_owner ELSE NULL END AS to_portfolio,
    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN CASE WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
                 AND ao.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
           ELSE 'external' END ELSE NULL END AS transfer_scope,

    CASE
      WHEN COALESCE(ofd.first_dollar_date, mc.first_dollar_date) >= '2026-04-01'
        AND ao.commercial_owner != 'SALE' THEN '2026-04'
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03' THEN '2026-03'
      WHEN ao.new_user_exp_date IS NULL AND papr.commercial_owner = 'SALE' THEN '2026-03'
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
      WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
      ELSE NULL
    END AS cohort_month

  FROM apr_own ao
  LEFT JOIN mar_cohort mc           ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN pre_apr_own papr        ON ao.outlet_id = papr.outlet_id
  WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 9. May labels ─────────────────────────────────────────────────────────────
-- Fallback handover vs new_sales (ไม่มี exp_date):
--   pmay=SALE + pmo=SALE/NULL → handover (โอนมาก่อนหรือใน Mar)
--   pmay=SALE + pmo≠SALE      → new_sales (โอนมาระหว่าง Apr–May)
may_labels AS (
  SELECT
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner AS current_portfolio,
    mo.staff_owner      AS current_staff_owner,
    mo.new_user_exp_date,
    COALESCE(al.base_portfolio, mc.base_portfolio)     AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,
    COALESCE(al.base_gmv, mc.base_gmv, 0)              AS base_gmv,
    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.pre_mar_portfolio, pmo.commercial_owner)  AS pre_mar_portfolio,

    CASE
      -- inherit Apr ถ้า portfolio ไม่เปลี่ยน
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.fixed_label
      -- [1] expansion
      WHEN COALESCE(ofd.first_dollar_date, al.first_dollar_date) >= '2026-04-01'
        AND mo.commercial_owner != 'SALE' THEN 'expansion'
      -- [2] handover: exp_date = Mar
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03' THEN 'handover'
      -- [2b] handover fallback: pmay=SALE + pmo=SALE/NULL (โอนมาก่อน/ใน Mar)
      WHEN mo.new_user_exp_date IS NULL
        AND pmay.commercial_owner = 'SALE'
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'handover'
      -- [3] new_sales: exp_date ใน Q
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      -- [3b] new_sales fallback: pmay=SALE + pmo≠SALE (โอนมาระหว่าง Apr–May)
      WHEN mo.new_user_exp_date IS NULL
        AND pmay.commercial_owner = 'SALE'
        AND pmo.commercial_owner IS NOT NULL
        AND pmo.commercial_owner != 'SALE'
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = mo.commercial_owner THEN 'core'
      -- [5] transfer_in
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner THEN 'transfer_in'
      -- [6] comeback
      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date, al.first_dollar_date) < '2026-04-01'
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      -- [7] transfer_in: ELSE
      ELSE 'transfer_in'
    END AS fixed_label,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.from_portfolio
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN COALESCE(al.current_portfolio, mc.base_portfolio)
      ELSE NULL
    END AS from_portfolio,
    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.to_portfolio
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN mo.commercial_owner
      ELSE NULL
    END AS to_portfolio,
    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.transfer_scope
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN CASE WHEN COALESCE(al.current_portfolio, mc.base_portfolio) IN ('KAM','PM','ADMIN')
                   AND mo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
             ELSE 'external' END
      ELSE NULL
    END AS transfer_scope,

    COALESCE(al.cohort_month,
      CASE
        WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-05' THEN '2026-05'
        WHEN mo.new_user_exp_date IS NULL
          AND pmay.commercial_owner = 'SALE'
          AND pmo.commercial_owner IS NOT NULL
          AND pmo.commercial_owner != 'SALE'
          THEN '2026-05'
        ELSE NULL
      END
    ) AS cohort_month

  FROM may_own mo
  LEFT JOIN apr_labels al           ON mo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON mo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_may_own pmay        ON mo.outlet_id = pmay.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 10. APRIL rows ────────────────────────────────────────────────────────────
apr_rows AS (
  -- LEG A
  SELECT
    '2026-04' AS period_month,
    al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.current_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.cohort_month,
    al.base_gmv, COALESCE(ag.gmv, 0) AS curr_gmv,
    CASE WHEN al.fixed_label='core' AND COALESCE(ag.gmv,0)>0 THEN 'core_nrr'
         WHEN al.fixed_label='core' AND COALESCE(ag.gmv,0)=0 THEN 'core_nrr_churn'
         ELSE al.fixed_label END AS movement_type,
    al.from_portfolio, al.to_portfolio, al.transfer_scope,
    CAST(NULL AS STRING) AS from_staff_owner, CAST(NULL AS STRING) AS to_staff_owner
  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG A-INTRA: transfer_out (from base_staff)
  SELECT '2026-04', al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.base_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.cohort_month,
    al.base_gmv, 0.0, 'transfer_out',
    al.current_portfolio, al.current_portfolio, 'intra',
    al.base_staff_owner, al.current_staff_owner
  FROM apr_labels al
  WHERE al.fixed_label = 'core'
    AND TRIM(COALESCE(al.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(al.current_staff_owner,'')) != ''
    AND al.base_staff_owner != al.current_staff_owner

  UNION ALL

  -- LEG A-INTRA: transfer_in (from current_staff)
  SELECT '2026-04', al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.current_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.cohort_month,
    al.base_gmv, 0.0, 'transfer_in',
    al.current_portfolio, al.current_portfolio, 'intra',
    al.base_staff_owner, al.current_staff_owner
  FROM apr_labels al
  WHERE al.fixed_label = 'core'
    AND TRIM(COALESCE(al.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(al.current_staff_owner,'')) != ''
    AND al.base_staff_owner != al.current_staff_owner

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี Apr order ใน portfolio เดิม
  SELECT '2026-04', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, '2026-03',
    mc.base_gmv, 0.0,
    CASE WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN ao_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    ao_any.commercial_owner,
    CASE WHEN ao_any.outlet_id IS NULL THEN NULL
         WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
         ELSE 'external' END,
    CAST(NULL AS STRING), CAST(NULL AS STRING)
  FROM mar_cohort mc
  LEFT JOIN apr_own ao_same ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN apr_own ao_any  ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 11. MAY rows ──────────────────────────────────────────────────────────────
may_rows AS (
  -- LEG A
  SELECT '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.current_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.cohort_month,
    ml.base_gmv, COALESCE(mg.gmv,0) AS curr_gmv,
    CASE WHEN ml.fixed_label='core' AND COALESCE(mg.gmv,0)>0 THEN 'core_nrr'
         WHEN ml.fixed_label='core' AND COALESCE(mg.gmv,0)=0 THEN 'core_nrr_churn'
         ELSE ml.fixed_label END,
    ml.from_portfolio, ml.to_portfolio, ml.transfer_scope,
    CAST(NULL AS STRING), CAST(NULL AS STRING)
  FROM may_labels ml
  LEFT JOIN may_gmv mg ON ml.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG A-INTRA May: transfer_out
  SELECT '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.base_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.cohort_month,
    ml.base_gmv, 0.0, 'transfer_out',
    ml.current_portfolio, ml.current_portfolio, 'intra',
    ml.base_staff_owner, ml.current_staff_owner
  FROM may_labels ml
  WHERE ml.fixed_label = 'core'
    AND TRIM(COALESCE(ml.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(ml.current_staff_owner,'')) != ''
    AND ml.base_staff_owner != ml.current_staff_owner

  UNION ALL

  -- LEG A-INTRA May: transfer_in
  SELECT '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.current_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.cohort_month,
    ml.base_gmv, 0.0, 'transfer_in',
    ml.current_portfolio, ml.current_portfolio, 'intra',
    ml.base_staff_owner, ml.current_staff_owner
  FROM may_labels ml
  WHERE ml.fixed_label = 'core'
    AND TRIM(COALESCE(ml.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(ml.current_staff_owner,'')) != ''
    AND ml.base_staff_owner != ml.current_staff_owner

  UNION ALL

  -- LEG B May
  SELECT '2026-05', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, '2026-03',
    mc.base_gmv, 0.0,
    CASE WHEN mo_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN mo_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    mo_any.commercial_owner,
    CASE WHEN mo_any.outlet_id IS NULL THEN NULL
         WHEN mo_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
         ELSE 'external' END,
    CAST(NULL AS STRING), CAST(NULL AS STRING)
  FROM mar_cohort mc
  LEFT JOIN may_own mo_same ON mc.outlet_id = mo_same.outlet_id
    AND mo_same.commercial_owner = mc.base_portfolio
  LEFT JOIN may_own mo_any  ON mc.outlet_id = mo_any.outlet_id
  WHERE mo_same.outlet_id IS NULL
),

-- ── 12. JUNE rows ─────────────────────────────────────────────────────────────
-- Fallback Jun-only (ไม่มี exp_date):
--   pjun=SALE + pmo=SALE/NULL → handover
--   pjun=SALE + pmo≠SALE      → new_sales
jun_rows AS (
  -- LEG A
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(al.account_id, ml.account_id, jo.account_id)       AS account_id,
    COALESCE(al.account_name, ml.account_name, jo.account_name) AS account_name,
    COALESCE(al.res_name, ml.res_name, jo.res_name)             AS res_name,
    COALESCE(al.account_type, ml.account_type, jo.account_type) AS account_type,
    jo.commercial_owner AS current_portfolio,
    jo.staff_owner      AS current_staff_owner,
    COALESCE(al.base_portfolio, ml.base_portfolio, mc.base_portfolio)           AS base_portfolio,
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner)     AS base_staff_owner,
    COALESCE(al.first_dollar_date, ml.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, ml.new_user_exp_date, jo.new_user_exp_date)  AS new_user_exp_date,
    COALESCE(al.cohort_month, ml.cohort_month,
      CASE
        WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-06' THEN '2026-06'
        WHEN jo.new_user_exp_date IS NULL
          AND pjun.commercial_owner = 'SALE'
          AND pmo.commercial_owner IS NOT NULL
          AND pmo.commercial_owner != 'SALE'
          THEN '2026-06'
        ELSE NULL
      END
    ) AS cohort_month,
    COALESCE(al.base_gmv, ml.base_gmv, mc.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0) AS curr_gmv,

    CASE
      -- inherit Apr
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner THEN
        CASE WHEN al.fixed_label='core' AND COALESCE(jg.gmv,0)>0 THEN 'core_nrr'
             WHEN al.fixed_label='core' AND COALESCE(jg.gmv,0)=0 THEN 'core_nrr_churn'
             ELSE al.fixed_label END
      -- inherit May
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner THEN
        CASE WHEN ml.fixed_label='core' AND COALESCE(jg.gmv,0)>0 THEN 'core_nrr'
             WHEN ml.fixed_label='core' AND COALESCE(jg.gmv,0)=0 THEN 'core_nrr_churn'
             ELSE ml.fixed_label END
      -- Jun-only outlets
      WHEN COALESCE(ofd.first_dollar_date, al.first_dollar_date) >= '2026-04-01'
        AND jo.commercial_owner != 'SALE' THEN 'expansion'
      -- [2] handover: exp_date = Mar
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03' THEN 'handover'
      -- [2b] handover fallback: pjun=SALE + pmo=SALE/NULL
      WHEN jo.new_user_exp_date IS NULL
        AND pjun.commercial_owner = 'SALE'
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'handover'
      -- [3] new_sales: exp_date ใน Q
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        THEN 'new_sales'
      -- [3b] new_sales fallback: pjun=SALE + pmo≠SALE
      WHEN jo.new_user_exp_date IS NULL
        AND pjun.commercial_owner = 'SALE'
        AND pmo.commercial_owner IS NOT NULL
        AND pmo.commercial_owner != 'SALE'
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = jo.commercial_owner
        THEN CASE WHEN COALESCE(jg.gmv,0)>0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      -- [5] transfer_in
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN 'transfer_in'
      -- [6] comeback
      WHEN mc.outlet_id IS NULL
        AND COALESCE(ofd.first_dollar_date) < '2026-04-01'
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type,

    COALESCE(al.from_portfolio, ml.from_portfolio,
      CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN mc.base_portfolio ELSE NULL END) AS from_portfolio,
    COALESCE(al.to_portfolio, ml.to_portfolio,
      CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN jo.commercial_owner ELSE NULL END) AS to_portfolio,
    COALESCE(al.transfer_scope, ml.transfer_scope,
      CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN CASE WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
                   AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
             ELSE 'external' END
        ELSE NULL END) AS transfer_scope,
    CAST(NULL AS STRING) AS from_staff_owner,
    CAST(NULL AS STRING) AS to_staff_owner

  FROM jun_own jo
  CROSS JOIN params p
  LEFT JOIN apr_labels al           ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml           ON jo.outlet_id = ml.outlet_id
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_jun_own pjun        ON jo.outlet_id = pjun.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG B Jun
  SELECT '2026-06', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, '2026-03',
    mc.base_gmv, 0.0,
    CASE WHEN jo_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN jo_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    jo_any.commercial_owner,
    CASE WHEN jo_any.outlet_id IS NULL THEN NULL
         WHEN jo_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
         ELSE 'external' END,
    CAST(NULL AS STRING), CAST(NULL AS STRING)
  FROM mar_cohort mc
  LEFT JOIN jun_own jo_same ON mc.outlet_id = jo_same.outlet_id
    AND jo_same.commercial_owner = mc.base_portfolio
  LEFT JOIN jun_own jo_any  ON mc.outlet_id = jo_any.outlet_id
  WHERE jo_same.outlet_id IS NULL
),

-- ── 13. Union ─────────────────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
)

-- ── FINAL OUTPUT ──────────────────────────────────────────────────────────────
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
  r.first_dollar_date, r.new_user_exp_date,
  r.from_portfolio, r.to_portfolio,
  r.from_staff_owner, r.to_staff_owner
FROM all_rows r
CROSS JOIN params p
ORDER BY r.period_month, r.current_portfolio, r.movement_type, r.curr_gmv DESC

-- ════════════════════════════════════════════════════════════════════════════
-- RECONCILE CHECKS (รันแยก)
-- C1: SUM(curr_gmv excl transfer_out) per portfolio per month = dwh.order GMV
-- C2: COUNT(transfer_out from=A to=B) = COUNT(transfer_in from=A to=B) per period
-- C3: intra out = intra in per staff pair per period
-- C4: outlet 1 แถวต่อเดือน (excl transfer) → HAVING COUNT(*)>1 = 0 rows
-- C5: label lock → COUNT(DISTINCT movement excl transfer/core) per outlet ≤ 1
-- C6: mar_cohort ตรง dwh.order ทั้ง count และ base_gmv
