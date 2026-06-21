-- ════════════════════════════════════════════════════════════════════════
-- QNRR Q2 2026 — Movement Verification Table
-- master_v3 + dwh.order history สำหรับ manual reconcile
-- ════════════════════════════════════════════════════════════════════════
WITH

-- ── 0. target outlets ────────────────────────────────────────────────────
target_outlets AS (
  SELECT outlet_id FROM (
    SELECT CAST(id AS STRING) AS outlet_id
    FROM UNNEST(ARRAY<INT64>[
      242420, 225572, 243763, 241729, 242622,
      241311, 241417, 235555, 242111, 244799,
      230550, 210507, 219412, 163833, 202124,
      177740, 149073, 175814,
      8265, 241840, 11824, 225152, 237164,
      247381, 246822, 246880, 246469, 246866,
      241389, 246653, 244116, 243255, 247624, 244651,
      236896, 185691, 185690,
      203893, 161173, 63298,
      167918, 171090
    ]) AS id
  )
),

-- ── 1–13. master_v3 CTEs ─────────────────────────────────────────────────
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
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.first_dollar_date IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- ── 3. base_gmv: Mar GMV filter เฉพาะ KAM+PM+ADMIN (NRR denominator) ─────────
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),

-- ── 4. Period GMV (ทุก B2B ไม่ filter portfolio) ──────────────────────────────
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

-- ── 5. Ownership snapshots — last order per outlet per month ──────────────────
mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
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
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
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
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
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
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.account_name, o.res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6. pre_period_own: last B2B order ก่อนแต่ละ period ───────────────────────
-- pre_mar_own : new_sales check (pre_mar = SALE?)
-- pre_may_own : expansion + handover_fallback ใน May
-- pre_jun_own : expansion + handover_fallback ใน Jun
pre_mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_apr_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-04-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_may_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-05-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
pre_jun_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-06-01'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6b. mar_handover_outlets: outlets ที่มี any order ใน Mar ที่ new_user_exp=Mar ─────────
-- ใช้แทน mar_own.new_user_exp_date เพราะ last order ของ Mar อาจเป็น KAM (ไม่มี exp=Mar)
-- แต่ SALE order ก่อนหน้าใน Mar อาจมี new_user_exp=Mar → ต้องจับจาก any order
mar_handover_outlets AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND FORMAT_DATE('%Y-%m', DATE(o.new_user_exp_date)) = '2026-03'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
),

-- ── 7. mar_cohort: fixed denominator ทั้ง Q ──────────────────────────────────
mar_cohort AS (
  SELECT
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner  AS base_portfolio,
    mo.staff_owner       AS base_staff_owner,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    COALESCE(bg.gmv, 0)  AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(bg.gmv, 0) > 0
    AND (mo.new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date) != '2026-03')
),

-- ── 8. Helper: classify movement label ───────────────────────────────────────
-- ใช้เป็น inline CASE ใน apr_labels + fallback blocks
-- Priority:
--   [1] expansion  : first_dollar >= Apr AND current owner != SALE
--   [2] handover   : new_user_exp_date=Mar  OR  (no exp_date AND pre_mar=SALE AND period=Mar)
--   [3] new_sales  : new_user_exp_date ใน Q + pre_mar=SALE/NULL
--                    OR (no exp_date + pre_period=SALE + period != Mar)
--   [4] core       : mar_cohort + same portfolio
--   [5] transfer_in: mar_cohort + diff portfolio
--   [6] comeback   : no mar_cohort + first_dollar<Apr + no Q exp_date
--   [7] transfer_in: ELSE

-- ── 9. apr_labels: lock classification Apr ────────────────────────────────────
apr_labels AS (
  SELECT
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    ao.commercial_owner  AS current_portfolio,
    ao.staff_owner       AS current_staff_owner,
    ao.new_user_exp_date,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.base_gmv,
    ofd.first_dollar_date,
    pmo.commercial_owner AS pre_mar_portfolio,

    CASE
      -- [1] expansion: fd ใน Q + owner ไม่ใช่ SALE
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND ao.commercial_owner != 'SALE'
        THEN 'expansion'
      -- [2] handover: any Mar order มี new_user_exp=Mar
      -- เช็คว่า current portfolio ตรงกับ last Mar owner (ป้องกัน SALE→PM→KAM ถูก classify ผิด)
      WHEN mho.outlet_id IS NOT NULL
        AND ao.commercial_owner = mo_last.commercial_owner
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- [2b] handover fallback: ไม่มี exp_date + pre_apr=SALE
      WHEN ao.new_user_exp_date IS NULL
        AND papr.commercial_owner = 'SALE'
        THEN 'handover'
      -- [3] new_sales: exp_date ใน Q + pre_mar=SALE/NULL
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = ao.commercial_owner
        THEN 'core'
      -- [5] transfer_in from cohort (inter-portfolio)
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
        THEN 'transfer_in'
      -- [6] comeback: เคยเป็น B2B customer ก่อน Q + ไม่ใช่ SALE channel
      -- pre_apr_own NOT SALE = เคยถูกดูแลโดย KAM/PM/ADMIN มาก่อน (consistent กับ validated SQL)
      WHEN mc.outlet_id IS NULL
        AND ofd.first_dollar_date < '2026-04-01'
        AND papr.commercial_owner NOT IN ('SALE')
        AND papr.outlet_id IS NOT NULL
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      -- [7] transfer_in: ELSE
      ELSE 'transfer_in'
    END AS fixed_label,

    -- transfer metadata (inter-portfolio only, intra handled separately)
    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN mc.base_portfolio ELSE NULL END AS from_portfolio,
    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN ao.commercial_owner ELSE NULL END AS to_portfolio,
    CASE WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
      THEN CASE
        WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
          AND ao.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
        ELSE 'external'
      END ELSE NULL END AS transfer_scope

  FROM apr_own ao
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN pre_apr_own papr           ON ao.outlet_id = papr.outlet_id
  LEFT JOIN mar_handover_outlets mho   ON ao.outlet_id = mho.outlet_id
  LEFT JOIN mar_own mo_last            ON ao.outlet_id = mo_last.outlet_id
  WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 10. may_labels: lock classification May (Jun inherit) ─────────────────────
may_labels AS (
  SELECT
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner  AS current_portfolio,
    mo.staff_owner       AS current_staff_owner,
    mo.new_user_exp_date,
    COALESCE(al.base_portfolio, mc.base_portfolio)         AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner)     AS base_staff_owner,
    COALESCE(al.base_gmv, mc.base_gmv, 0)                  AS base_gmv,
    COALESCE(al.first_dollar_date, ofd.first_dollar_date)  AS first_dollar_date,
    COALESCE(al.pre_mar_portfolio, pmo.commercial_owner)   AS pre_mar_portfolio,

    CASE
      -- inherit Apr ถ้า portfolio ไม่เปลี่ยน
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.fixed_label
      -- portfolio เปลี่ยนหรือเป็น outlet ใหม่ใน May → classify ใหม่
      -- [1] expansion
      WHEN ofd.first_dollar_date >= '2026-04-01' AND mo.commercial_owner != 'SALE'
        AND pmay.outlet_id IS NULL
        THEN 'expansion'
      -- [2] handover: any Mar order มี new_user_exp=Mar + portfolio ตรงกับ Mar last owner
      WHEN mho.outlet_id IS NOT NULL
        AND mo.commercial_owner = mo_last.commercial_owner
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- [2b] handover fallback
      WHEN mo.new_user_exp_date IS NULL AND pmay.commercial_owner = 'SALE'
        THEN 'handover'
      -- [3] new_sales
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'
      -- [3b] new_sales fallback
      WHEN mo.new_user_exp_date IS NULL
        AND pmay.commercial_owner = 'SALE'
        AND (pmo.commercial_owner != 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = mo.commercial_owner
        THEN 'core'
      -- [5] transfer_in
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN 'transfer_in'
      -- [6] comeback: เคยเป็น B2B customer ก่อน Q + ไม่ใช่ SALE channel
      WHEN mc.outlet_id IS NULL
        AND ofd.first_dollar_date < '2026-04-01'
        AND pmay.commercial_owner NOT IN ('SALE')
        AND pmay.outlet_id IS NOT NULL
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      ELSE 'transfer_in'
    END AS fixed_label,

    -- transfer metadata (inter only)
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
        THEN CASE
          WHEN COALESCE(al.current_portfolio, mc.base_portfolio) IN ('KAM','PM','ADMIN')
            AND mo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
          ELSE 'external'
        END
      ELSE NULL
    END AS transfer_scope

  FROM may_own mo
  LEFT JOIN apr_labels al              ON mo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc              ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON mo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_may_own pmay           ON mo.outlet_id = pmay.outlet_id
  LEFT JOIN mar_handover_outlets mho   ON mo.outlet_id = mho.outlet_id
  LEFT JOIN mar_own mo_last            ON mo.outlet_id = mo_last.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 11. APRIL rows ────────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlets ที่มี Apr order (portfolio scope) — core movement row
  SELECT
    '2026-04' AS period_month,
    al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.current_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.pre_mar_portfolio,
    al.base_gmv, COALESCE(ag.gmv,0) AS curr_gmv,
    CASE
      WHEN al.fixed_label='core'      AND COALESCE(ag.gmv,0)>0 THEN 'core_nrr'
      WHEN al.fixed_label='core'      AND COALESCE(ag.gmv,0)=0 THEN 'core_nrr_churn'
      WHEN al.fixed_label='expansion' AND COALESCE(ag.gmv,0)>0 THEN 'expansion'
      WHEN al.fixed_label='expansion' AND COALESCE(ag.gmv,0)=0 THEN 'transfer_in'
      WHEN al.fixed_label='comeback'  AND COALESCE(ag.gmv,0)>0 THEN 'comeback'
      WHEN al.fixed_label='comeback'  AND COALESCE(ag.gmv,0)=0 THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type,
    al.from_portfolio, al.to_portfolio, al.transfer_scope,
    -- staff transfer columns (NULL for non-intra)
    NULL AS from_staff_owner, NULL AS to_staff_owner

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG A-INTRA: intra-portfolio staff transfer rows
  -- outlet ที่ core แต่ staff_owner เปลี่ยน → เพิ่ม transfer_out + transfer_in
  -- transfer_out row (from base_staff perspective)
  SELECT
    '2026-04', al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.base_staff_owner AS current_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.pre_mar_portfolio,
    al.base_gmv, 0 AS curr_gmv,
    'transfer_out' AS movement_type,
    al.current_portfolio AS from_portfolio,
    al.current_portfolio AS to_portfolio,
    'intra'              AS transfer_scope,
    al.base_staff_owner  AS from_staff_owner,
    al.current_staff_owner AS to_staff_owner

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id
  WHERE al.fixed_label = 'core'
    AND TRIM(COALESCE(al.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(al.current_staff_owner,'')) != ''
    AND al.base_staff_owner != al.current_staff_owner

  UNION ALL

  -- transfer_in row (from current_staff perspective)
  SELECT
    '2026-04', al.outlet_id, al.account_id, al.account_name, al.res_name, al.account_type,
    al.current_portfolio, al.current_staff_owner,
    al.base_portfolio, al.base_staff_owner,
    al.first_dollar_date, al.new_user_exp_date, al.pre_mar_portfolio,
    al.base_gmv, 0 AS curr_gmv,
    'transfer_in' AS movement_type,
    al.current_portfolio AS from_portfolio,
    al.current_portfolio AS to_portfolio,
    'intra'              AS transfer_scope,
    al.base_staff_owner  AS from_staff_owner,
    al.current_staff_owner AS to_staff_owner

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id
  WHERE al.fixed_label = 'core'
    AND TRIM(COALESCE(al.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(al.current_staff_owner,'')) != ''
    AND al.base_staff_owner != al.current_staff_owner

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี Apr order ใน portfolio เดิม
  SELECT
    '2026-04', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio AS current_portfolio, mc.base_staff_owner AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, NULL AS pre_mar_portfolio,
    mc.base_gmv, 0 AS curr_gmv,
    CASE WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN ao_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    ao_any.commercial_owner,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
      ELSE 'external'
    END,
    NULL AS from_staff_owner, NULL AS to_staff_owner

  FROM mar_cohort mc
  LEFT JOIN apr_own ao_same ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN apr_own ao_any  ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 12. MAY rows ──────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A: core movement
  SELECT
    '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.current_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.pre_mar_portfolio,
    ml.base_gmv, COALESCE(mg.gmv,0) AS curr_gmv,
    CASE
      WHEN ml.fixed_label='core'      AND COALESCE(mg.gmv,0)>0 THEN 'core_nrr'
      WHEN ml.fixed_label='core'      AND COALESCE(mg.gmv,0)=0 THEN 'core_nrr_churn'
      WHEN ml.fixed_label='expansion' AND COALESCE(mg.gmv,0)>0 THEN 'expansion'
      WHEN ml.fixed_label='expansion' AND COALESCE(mg.gmv,0)=0 THEN 'transfer_in'
      WHEN ml.fixed_label='comeback'  AND COALESCE(mg.gmv,0)>0 THEN 'comeback'
      WHEN ml.fixed_label='comeback'  AND COALESCE(mg.gmv,0)=0 THEN 'transfer_in'
      ELSE ml.fixed_label
    END AS movement_type,
    ml.from_portfolio, ml.to_portfolio, ml.transfer_scope,
    NULL AS from_staff_owner, NULL AS to_staff_owner

  FROM may_labels ml
  LEFT JOIN may_gmv mg ON ml.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG A-INTRA: intra staff transfer May
  SELECT
    '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.base_staff_owner AS current_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.pre_mar_portfolio,
    ml.base_gmv, 0, 'transfer_out',
    ml.current_portfolio, ml.current_portfolio, 'intra',
    ml.base_staff_owner, ml.current_staff_owner
  FROM may_labels ml
  WHERE ml.fixed_label = 'core'
    AND TRIM(COALESCE(ml.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(ml.current_staff_owner,'')) != ''
    AND ml.base_staff_owner != ml.current_staff_owner

  UNION ALL

  SELECT
    '2026-05', ml.outlet_id, ml.account_id, ml.account_name, ml.res_name, ml.account_type,
    ml.current_portfolio, ml.current_staff_owner,
    ml.base_portfolio, ml.base_staff_owner,
    ml.first_dollar_date, ml.new_user_exp_date, ml.pre_mar_portfolio,
    ml.base_gmv, 0, 'transfer_in',
    ml.current_portfolio, ml.current_portfolio, 'intra',
    ml.base_staff_owner, ml.current_staff_owner
  FROM may_labels ml
  WHERE ml.fixed_label = 'core'
    AND TRIM(COALESCE(ml.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(ml.current_staff_owner,'')) != ''
    AND ml.base_staff_owner != ml.current_staff_owner

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี May order ใน portfolio เดิม
  SELECT
    '2026-05', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, NULL,
    mc.base_gmv, 0,
    CASE WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN ao_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    ao_any.commercial_owner,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
      ELSE 'external'
    END,
    NULL, NULL

  FROM mar_cohort mc
  LEFT JOIN may_own ao_same ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN may_own ao_any  ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 13. JUNE rows ─────────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A: core movement
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(al.account_id, ml.account_id, jo.account_id)          AS account_id,
    COALESCE(al.account_name, ml.account_name, jo.account_name)    AS account_name,
    COALESCE(al.res_name, ml.res_name, jo.res_name)                AS res_name,
    COALESCE(al.account_type, ml.account_type, jo.account_type)    AS account_type,
    jo.commercial_owner AS current_portfolio,
    jo.staff_owner      AS current_staff_owner,
    COALESCE(al.base_portfolio, ml.base_portfolio, mc.base_portfolio)               AS base_portfolio,
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner)         AS base_staff_owner,
    COALESCE(al.first_dollar_date, ml.first_dollar_date, ofd.first_dollar_date)     AS first_dollar_date,
    COALESCE(al.new_user_exp_date, ml.new_user_exp_date, jo.new_user_exp_date)      AS new_user_exp_date,
    COALESCE(al.pre_mar_portfolio, ml.pre_mar_portfolio, pmo.commercial_owner)      AS pre_mar_portfolio,
    COALESCE(al.base_gmv, ml.base_gmv, mc.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0) AS curr_gmv,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner THEN
        CASE
          WHEN al.fixed_label='core'      AND COALESCE(jg.gmv,0)>0 THEN 'core_nrr'
          WHEN al.fixed_label='core'      AND COALESCE(jg.gmv,0)=0 THEN 'core_nrr_churn'
          WHEN al.fixed_label='expansion' AND COALESCE(jg.gmv,0)>0 THEN 'expansion'
          WHEN al.fixed_label='expansion' AND COALESCE(jg.gmv,0)=0 THEN 'transfer_in'
          WHEN al.fixed_label='comeback'  AND COALESCE(jg.gmv,0)>0 THEN 'comeback'
          WHEN al.fixed_label='comeback'  AND COALESCE(jg.gmv,0)=0 THEN 'transfer_in'
          ELSE al.fixed_label
        END
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner THEN
        CASE
          WHEN ml.fixed_label='core'      AND COALESCE(jg.gmv,0)>0 THEN 'core_nrr'
          WHEN ml.fixed_label='core'      AND COALESCE(jg.gmv,0)=0 THEN 'core_nrr_churn'
          WHEN ml.fixed_label='expansion' AND COALESCE(jg.gmv,0)>0 THEN 'expansion'
          WHEN ml.fixed_label='expansion' AND COALESCE(jg.gmv,0)=0 THEN 'transfer_in'
          WHEN ml.fixed_label='comeback'  AND COALESCE(jg.gmv,0)>0 THEN 'comeback'
          WHEN ml.fixed_label='comeback'  AND COALESCE(jg.gmv,0)=0 THEN 'transfer_in'
          ELSE ml.fixed_label
        END
      -- Jun-only outlets
      WHEN ofd.first_dollar_date >= '2026-04-01' AND jo.commercial_owner != 'SALE'
        AND pjun.outlet_id IS NULL THEN 'expansion'
      WHEN mho2.outlet_id IS NOT NULL
        AND jo.commercial_owner = mo_last2.commercial_owner THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03' THEN 'handover'
      WHEN jo.new_user_exp_date IS NULL AND pjun.commercial_owner = 'SALE' THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL) THEN 'new_sales'
      WHEN jo.new_user_exp_date IS NULL AND pjun.commercial_owner = 'SALE'
        AND (pmo.commercial_owner != 'SALE' OR pmo.outlet_id IS NULL) THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = jo.commercial_owner
        THEN CASE WHEN COALESCE(jg.gmv,0)>0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN 'transfer_in'
      WHEN mc.outlet_id IS NULL AND ofd.first_dollar_date < '2026-04-01'
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN CASE WHEN COALESCE(jg.gmv,0)>0 THEN 'comeback' ELSE 'transfer_in' END
      ELSE 'transfer_in'
    END AS movement_type,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner THEN al.from_portfolio
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN al.current_portfolio
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner THEN ml.from_portfolio
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN ml.current_portfolio
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN mc.base_portfolio
      ELSE NULL
    END AS from_portfolio,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner THEN al.to_portfolio
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN jo.commercial_owner
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner THEN ml.to_portfolio
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN jo.commercial_owner
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN jo.commercial_owner
      ELSE NULL
    END AS to_portfolio,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner THEN al.transfer_scope
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN
          CASE WHEN al.current_portfolio IN ('KAM','PM','ADMIN')
               AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter' ELSE 'external' END
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner THEN ml.transfer_scope
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN
          CASE WHEN ml.current_portfolio IN ('KAM','PM','ADMIN')
               AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter' ELSE 'external' END
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner THEN
          CASE WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
               AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter' ELSE 'external' END
      ELSE NULL
    END AS transfer_scope,

    NULL AS from_staff_owner, NULL AS to_staff_owner

  FROM jun_own jo
  LEFT JOIN apr_labels al           ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml           ON jo.outlet_id = ml.outlet_id
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_jun_own pjun        ON jo.outlet_id = pjun.outlet_id
  LEFT JOIN jun_gmv jg                ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_handover_outlets mho2 ON jo.outlet_id = mho2.outlet_id
  LEFT JOIN mar_own mo_last2           ON jo.outlet_id = mo_last2.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG A-INTRA Jun
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(al.account_id, ml.account_id, jo.account_id),
    COALESCE(al.account_name, ml.account_name, jo.account_name),
    COALESCE(al.res_name, ml.res_name, jo.res_name),
    COALESCE(al.account_type, ml.account_type, jo.account_type),
    jo.commercial_owner,
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner) AS current_staff_owner,
    COALESCE(al.base_portfolio, ml.base_portfolio, mc.base_portfolio),
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner),
    COALESCE(al.first_dollar_date, ml.first_dollar_date, ofd.first_dollar_date),
    COALESCE(al.new_user_exp_date, ml.new_user_exp_date, jo.new_user_exp_date),
    COALESCE(al.pre_mar_portfolio, ml.pre_mar_portfolio, pmo.commercial_owner),
    COALESCE(al.base_gmv, ml.base_gmv, mc.base_gmv, 0),
    0, 'transfer_out',
    jo.commercial_owner, jo.commercial_owner, 'intra',
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner),
    jo.staff_owner
  FROM jun_own jo
  LEFT JOIN apr_labels al ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml ON jo.outlet_id = ml.outlet_id
  LEFT JOIN mar_cohort mc ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_jun_own pjun ON jo.outlet_id = pjun.outlet_id
  LEFT JOIN jun_gmv jg ON jo.outlet_id = jg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(al.fixed_label, ml.fixed_label) = 'core'
    AND TRIM(COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(jo.staff_owner,'')) != ''
    AND COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner) != jo.staff_owner

  UNION ALL

  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(al.account_id, ml.account_id, jo.account_id),
    COALESCE(al.account_name, ml.account_name, jo.account_name),
    COALESCE(al.res_name, ml.res_name, jo.res_name),
    COALESCE(al.account_type, ml.account_type, jo.account_type),
    jo.commercial_owner, jo.staff_owner,
    COALESCE(al.base_portfolio, ml.base_portfolio, mc.base_portfolio),
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner),
    COALESCE(al.first_dollar_date, ml.first_dollar_date, ofd.first_dollar_date),
    COALESCE(al.new_user_exp_date, ml.new_user_exp_date, jo.new_user_exp_date),
    COALESCE(al.pre_mar_portfolio, ml.pre_mar_portfolio, pmo.commercial_owner),
    COALESCE(al.base_gmv, ml.base_gmv, mc.base_gmv, 0),
    0, 'transfer_in',
    jo.commercial_owner, jo.commercial_owner, 'intra',
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner),
    jo.staff_owner
  FROM jun_own jo
  LEFT JOIN apr_labels al ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml ON jo.outlet_id = ml.outlet_id
  LEFT JOIN mar_cohort mc ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN pre_jun_own pjun ON jo.outlet_id = pjun.outlet_id
  LEFT JOIN jun_gmv jg ON jo.outlet_id = jg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(al.fixed_label, ml.fixed_label) = 'core'
    AND TRIM(COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner,'')) != ''
    AND TRIM(COALESCE(jo.staff_owner,'')) != ''
    AND COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner) != jo.staff_owner

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี Jun order ใน portfolio เดิม
  SELECT
    '2026-06', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.base_portfolio, mc.base_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.new_user_exp_date, NULL,
    mc.base_gmv, 0,
    CASE WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    CASE WHEN ao_any.outlet_id IS NOT NULL THEN mc.base_portfolio ELSE NULL END,
    ao_any.commercial_owner,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'inter'
      ELSE 'external'
    END,
    NULL, NULL

  FROM mar_cohort mc
  LEFT JOIN jun_own ao_same ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN jun_own ao_any  ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 14. Union ─────────────────────────────────────────────────────────────────

-- ── 14. all_rows ──────────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
),

-- ── 15. master filtered ───────────────────────────────────────────────────
master AS (
  SELECT r.*
  FROM all_rows r
  CROSS JOIN params p
  WHERE r.outlet_id IN (SELECT outlet_id FROM target_outlets)
    AND r.transfer_scope != 'intra'
),

-- ── 16. order history ─────────────────────────────────────────────────────
monthly_raw AS (
  SELECT
    CAST(o.user_id AS STRING)                           AS outlet_id,
    FORMAT_DATE('%Y-%m', o.delivery_date)               AS order_month,
    UPPER(TRIM(o.commercial_owner))                     AS commercial_owner,
    TRIM(o.staff_owner)                                 AS staff_owner,
    o.gmv_ex_vat,
    DATE(o.first_dollar_date)                           AS first_dollar_date,
    DATE(o.new_user_exp_date)                           AS new_user_exp_date,
    o.account_name,
    o.res_name
  FROM `freshket-rn.dwh.order` o
  WHERE CAST(o.user_id AS STRING) IN (SELECT outlet_id FROM target_outlets)
    AND o.delivery_date BETWEEN '2025-12-01'
        AND DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
),

outlet_history AS (
  SELECT
    outlet_id,
    MAX(account_name)                                                   AS account_name,
    MAX(res_name)                                                       AS res_name,
    MAX(first_dollar_date)                                              AS first_dollar_date,
    MAX(new_user_exp_date)                                              AS new_user_exp_date,
    ROUND(SUM(CASE WHEN order_month='2025-12' THEN gmv_ex_vat END),0)  AS gmv_dec25,
    ROUND(SUM(CASE WHEN order_month='2026-01' THEN gmv_ex_vat END),0)  AS gmv_jan26,
    ROUND(SUM(CASE WHEN order_month='2026-02' THEN gmv_ex_vat END),0)  AS gmv_feb26,
    ROUND(SUM(CASE WHEN order_month='2026-03' THEN gmv_ex_vat END),0)  AS gmv_mar26,
    ROUND(SUM(CASE WHEN order_month='2026-04' THEN gmv_ex_vat END),0)  AS gmv_apr26,
    ROUND(SUM(CASE WHEN order_month='2026-05' THEN gmv_ex_vat END),0)  AS gmv_may26,
    ROUND(SUM(CASE WHEN order_month='2026-06' THEN gmv_ex_vat END),0)  AS gmv_jun26,
    MAX(CASE WHEN order_month='2026-02' THEN commercial_owner END)      AS owner_feb26,
    MAX(CASE WHEN order_month='2026-03' THEN commercial_owner END)      AS owner_mar26,
    MAX(CASE WHEN order_month='2026-04' THEN commercial_owner END)      AS owner_apr26,
    MAX(CASE WHEN order_month='2026-05' THEN commercial_owner END)      AS owner_may26,
    MAX(CASE WHEN order_month='2026-06' THEN commercial_owner END)      AS owner_jun26
  FROM monthly_raw
  GROUP BY 1
),

staff_history AS (
  SELECT
    outlet_id,
    MAX(CASE WHEN order_month='2026-03' THEN last_staff END)            AS staff_mar26,
    MAX(CASE WHEN order_month='2026-04' THEN first_staff END)           AS staff_apr26_start,
    MAX(CASE WHEN order_month='2026-04' THEN last_staff END)            AS staff_apr26_end,
    MAX(CASE WHEN order_month='2026-05' THEN first_staff END)           AS staff_may26_start,
    MAX(CASE WHEN order_month='2026-05' THEN last_staff END)            AS staff_may26_end,
    MAX(CASE WHEN order_month='2026-06' THEN last_staff END)            AS staff_jun26
  FROM (
    SELECT
      CAST(o.user_id AS STRING)              AS outlet_id,
      FORMAT_DATE('%Y-%m', o.delivery_date)  AS order_month,
      FIRST_VALUE(TRIM(o.staff_owner)) OVER (
        PARTITION BY o.user_id, FORMAT_DATE('%Y-%m', o.delivery_date)
        ORDER BY o.delivery_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      )                                      AS first_staff,
      LAST_VALUE(TRIM(o.staff_owner)) OVER (
        PARTITION BY o.user_id, FORMAT_DATE('%Y-%m', o.delivery_date)
        ORDER BY o.delivery_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      )                                      AS last_staff
    FROM `freshket-rn.dwh.order` o
    WHERE CAST(o.user_id AS STRING) IN (SELECT outlet_id FROM target_outlets)
      AND o.delivery_date BETWEEN '2026-03-01'
          AND DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
      AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY o.user_id, FORMAT_DATE('%Y-%m', o.delivery_date)
      ORDER BY o.delivery_date DESC
    ) = 1
  )
  GROUP BY 1
)

-- ── FINAL ────────────────────────────────────────────────────────────────
SELECT
  m.period_month,
  m.movement_type,
  m.transfer_scope,
  m.current_portfolio,
  m.current_staff_owner,
  m.base_portfolio,
  m.base_staff_owner,
  m.from_portfolio,
  m.to_portfolio,
  ROUND(m.curr_gmv, 0)        AS curr_gmv,
  ROUND(m.base_gmv, 0)        AS base_gmv,
  m.outlet_id,
  h.account_name,
  h.res_name,
  m.first_dollar_date,
  m.new_user_exp_date,
  m.pre_mar_portfolio,
  h.owner_feb26,
  h.owner_mar26,
  h.owner_apr26,
  h.owner_may26,
  h.owner_jun26,
  s.staff_mar26,
  s.staff_apr26_start,
  s.staff_apr26_end,
  s.staff_may26_start,
  s.staff_may26_end,
  s.staff_jun26,
  h.gmv_dec25,
  h.gmv_jan26,
  h.gmv_feb26,
  h.gmv_mar26,
  h.gmv_apr26,
  h.gmv_may26,
  h.gmv_jun26

FROM master m
LEFT JOIN outlet_history h  ON m.outlet_id = h.outlet_id
LEFT JOIN staff_history s   ON m.outlet_id = s.outlet_id

ORDER BY
  m.outlet_id,
  m.period_month,
  m.movement_type
