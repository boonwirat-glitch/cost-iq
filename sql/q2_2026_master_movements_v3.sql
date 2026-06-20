-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Master Movement Table  (v3)
-- sql/q2_2026_master_movements_v3.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Design spec : docs/qnrr_master_movement_design_v3.md
-- Test spec   : docs/qnrr_master_movement_test_spec.md
--
-- Scope       : KAM / PM / ADMIN — existing B2B portfolios
--               SALE นับแยกจาก dwh.order เพื่อ reconcile เท่านั้น
--               B2C/Enduser ออกทั้งหมด
--
-- Grain       : 1 row ต่อ outlet ต่อ period_month ต่อ portfolio
--               + transfer_out row (curr_gmv=0) สำหรับ portfolio ต้นทาง
--
-- Transfer layers:
--   Layer 1 (intra)  : KAM→KAM = core_nrr เสมอ ไม่เป็น transfer
--   Layer 2 (inter)  : KAM→PM = transfer_in/out, transfer_scope='internal'
--   Layer 3 (agg)    : filter transfer_scope='external' = net outflow จริงๆ
--
-- Reconcile:
--   SUM(curr_gmv excl. transfer_out) per portfolio per month
--   = SUM(gmv_ex_vat FROM dwh.order WHERE commercial_owner=portfolio)
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

-- ── 2. First dollar per outlet (global B2B, ไม่ filter portfolio) ────────────
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

-- ── 3. base_gmv: Mar GMV — filter เฉพาะ portfolio scope ──────────────────────
-- filter commercial_owner IN scope เพื่อ ignore SALE orders ใน Mar
-- base_gmv = NRR denominator → ควรสะท้อนเฉพาะ GMV ที่ portfolio ดูแลจริง
base_gmv AS (
  SELECT
    CAST(o.user_id AS STRING)    AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),

-- ── 4. Period GMV — ทุก B2B (ไม่ filter portfolio) ──────────────────────────
-- ใช้ curr_gmv → ต้องนับ GMV จริงของ period ไม่ว่า portfolio จะเปลี่ยนยังไง
apr_gmv AS (
  SELECT
    CAST(o.user_id AS STRING)    AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
may_gmv AS (
  SELECT
    CAST(o.user_id AS STRING)    AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
jun_gmv AS (
  SELECT
    CAST(o.user_id AS STRING)    AS outlet_id,
    ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- ── 5. Ownership snapshots — last order per outlet per month ──────────────────
-- ไม่ filter commercial_owner → ใช้ทุก CTE รวมถึง LEG B (ao_any)
mar_own AS (
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
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
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
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
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
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6. pre_mar_own: last B2B order ก่อน Mar ──────────────────────────────────
-- ใช้: [3] new_sales (pre_mar=SALE) และ [6] comeback (pre_mar=same portfolio)
-- ต่างจาก pre_period_own — ใช้ทุกเดือนไม่เปลี่ยน
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

-- ── 7. mar_cohort: fixed denominator ทั้ง Q ──────────────────────────────────
-- filter KAM+PM+ADMIN เพราะเป็น business logic
-- ไม่ filter staff_owner → รวม departed KAM, blank ทุกคน
-- exclude handover_in_mar (new_user_exp_date=Mar)
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
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
    AND COALESCE(bg.gmv, 0) > 0
    AND (mo.new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date) != '2026-03')
),

-- ── 8. apr_labels: lock classification ตั้งแต่ Apr ──────────────────────────
-- ครอบ KAM+PM+ADMIN ทั้งหมด (ไม่ filter portfolio เดียว)
-- carry forward ไป May/Jun
-- เก็บ from_portfolio, to_portfolio, transfer_scope สำหรับ Layer 2/3 analysis
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

    CASE
      -- [1] expansion: first_dollar ใน Q + ไม่เคยมี B2B order ก่อน Apr
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND pmo.outlet_id IS NULL
        THEN 'expansion'

      -- [2] handover: new_user_exp_date = Mar (set โดย Sales process)
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'

      -- [3] new_sales: โอนจาก SALE ใน Q
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'

      -- [4] core: Mar cohort + same portfolio
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio = ao.commercial_owner
        THEN 'core'

      -- [5] transfer_in: Mar cohort + เปลี่ยน portfolio เข้า
      WHEN mc.outlet_id IS NOT NULL
        AND mc.base_portfolio != ao.commercial_owner
        THEN 'transfer_in'

      -- [6] comeback: ไม่อยู่ cohort + pre_mar = same portfolio + ไม่มี Q exp_date
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = ao.commercial_owner
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'

      -- [7] transfer_in: ELSE
      ELSE 'transfer_in'
    END AS fixed_label,

    -- transfer metadata: มีค่าเฉพาะ transfer_in [5] เท่านั้น
    -- comeback, expansion, handover, new_sales, core = NULL
    CASE
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
        THEN mc.base_portfolio
      ELSE NULL
    END AS from_portfolio,

    CASE
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
        THEN ao.commercial_owner
      ELSE NULL
    END AS to_portfolio,

    CASE
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != ao.commercial_owner
        THEN CASE
          WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
            AND ao.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      ELSE NULL
    END AS transfer_scope

  FROM apr_own ao
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo            ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN apr_gmv ag                 ON ao.outlet_id = ag.outlet_id
  WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 9. may_labels: lock classification May (สำหรับ Jun inherit) ──────────────
may_labels AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.commercial_owner             AS current_portfolio,
    mo.staff_owner                  AS current_staff_owner,
    mo.new_user_exp_date,
    COALESCE(al.base_portfolio, mc.base_portfolio) AS base_portfolio,
    COALESCE(al.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,
    COALESCE(al.base_gmv, mc.base_gmv, 0)          AS base_gmv,
    COALESCE(al.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.pre_mar_portfolio, pmo.commercial_owner)   AS pre_mar_portfolio,

    CASE
      -- inherit จาก Apr เฉพาะเมื่อ portfolio ไม่เปลี่ยน
      -- ถ้า portfolio เปลี่ยน (เช่น Apr=PM แต่ May=KAM) → re-classify ใหม่
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio = mo.commercial_owner
        THEN al.fixed_label

      -- outlet ใหม่ใน May หรือ portfolio เปลี่ยนจาก Apr — รัน priority เต็ม
      -- [1] expansion
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND pmo.outlet_id IS NULL
        THEN 'expansion'
      -- [2] handover
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      -- [3] new_sales
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'
      -- [4] core
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = mo.commercial_owner
        THEN 'core'
      -- [5] transfer_in (from cohort)
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN 'transfer_in'
      -- [6] comeback
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = mo.commercial_owner
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'
      -- [7] ELSE
      ELSE 'transfer_in'
    END AS fixed_label,

    -- transfer metadata
    -- ถ้า portfolio ยังเดิม: inherit จาก Apr (non-transfer → NULL)
    -- ถ้า portfolio เปลี่ยน: from = Apr portfolio (outlet ออกจาก Apr portfolio มา May)
    CASE
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio = mo.commercial_owner
        THEN al.from_portfolio
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio != mo.commercial_owner
        THEN al.current_portfolio
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN mc.base_portfolio
      WHEN mc.outlet_id IS NULL AND pmo.commercial_owner IS NOT NULL
        THEN pmo.commercial_owner
      ELSE NULL
    END AS from_portfolio,

    -- to_portfolio: มีค่าเฉพาะ transfer_in จาก cohort [5]
    -- ถ้า fixed_label เป็น transfer_in และ base_portfolio != current → set to
    -- อื่นๆ ทั้งหมด NULL
    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = mo.commercial_owner
        THEN al.to_portfolio
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != mo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN mo.commercial_owner
      WHEN al.outlet_id IS NULL
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN mo.commercial_owner
      ELSE NULL
    END AS to_portfolio,

    CASE
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio = mo.commercial_owner
        THEN al.transfer_scope
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio != mo.commercial_owner
        THEN CASE
          WHEN al.current_portfolio IN ('KAM','PM','ADMIN')
            AND mo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != mo.commercial_owner
        THEN CASE
          WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
            AND mo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      WHEN mc.outlet_id IS NULL AND pmo.commercial_owner IS NOT NULL
        THEN CASE
          WHEN pmo.commercial_owner IN ('KAM','PM','ADMIN')
            AND mo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      ELSE NULL
    END AS transfer_scope

  FROM may_own mo
  LEFT JOIN apr_labels al           ON mo.outlet_id = al.outlet_id
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON mo.outlet_id = pmo.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')
),

-- ── 10. APRIL rows ────────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlets ที่มี order ใน Apr (portfolio scope)
  SELECT
    '2026-04'                          AS period_month,
    al.outlet_id,
    al.account_id,
    al.account_name,
    al.account_type,
    al.current_portfolio,
    al.current_staff_owner,
    al.base_portfolio,
    al.base_staff_owner,
    al.first_dollar_date,
    al.new_user_exp_date,
    al.pre_mar_portfolio,
    al.base_gmv,
    COALESCE(ag.gmv, 0)                AS curr_gmv,
    CASE
      WHEN al.fixed_label = 'core'    AND COALESCE(ag.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'    AND COALESCE(ag.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv,0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback' AND COALESCE(ag.gmv,0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback' AND COALESCE(ag.gmv,0) = 0 THEN 'transfer_in'
      ELSE al.fixed_label
    END                                AS movement_type,
    al.from_portfolio,
    al.to_portfolio,
    al.transfer_scope

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน portfolio เดิมใน Apr
  -- ao_same: filter portfolio เดิม → IS NULL = ไม่มี Apr order ใน portfolio เดิม
  -- ao_any:  ไม่ filter → IS NULL = เงียบทุก portfolio = churn
  --                        IS NOT NULL = โอนออกไป portfolio อื่น = transfer_out
  SELECT
    '2026-04',
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_portfolio                  AS current_portfolio,
    mc.base_staff_owner                AS current_staff_owner,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.first_dollar_date,
    mc.new_user_exp_date,
    NULL                               AS pre_mar_portfolio,
    mc.base_gmv,
    0                                  AS curr_gmv,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                                AS movement_type,
    mc.base_portfolio                  AS from_portfolio,
    ao_any.commercial_owner            AS to_portfolio,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
      ELSE 'external'
    END                                AS transfer_scope

  FROM mar_cohort mc
  LEFT JOIN apr_own ao_same
    ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN apr_own ao_any
    ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 11. MAY rows ──────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A: outlets ที่มี order ใน May (portfolio scope)
  SELECT
    '2026-05',
    ml.outlet_id,
    ml.account_id,
    ml.account_name,
    ml.account_type,
    ml.current_portfolio,
    ml.current_staff_owner,
    ml.base_portfolio,
    ml.base_staff_owner,
    ml.first_dollar_date,
    ml.new_user_exp_date,
    ml.pre_mar_portfolio,
    ml.base_gmv,
    COALESCE(mg.gmv, 0)                AS curr_gmv,
    CASE
      WHEN ml.fixed_label = 'core'    AND COALESCE(mg.gmv,0) > 0 THEN 'core_nrr'
      WHEN ml.fixed_label = 'core'    AND COALESCE(mg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN ml.fixed_label = 'expansion' AND COALESCE(mg.gmv,0) > 0 THEN 'expansion'
      WHEN ml.fixed_label = 'expansion' AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      WHEN ml.fixed_label = 'comeback' AND COALESCE(mg.gmv,0) > 0 THEN 'comeback'
      WHEN ml.fixed_label = 'comeback' AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      ELSE ml.fixed_label
    END                                AS movement_type,
    ml.from_portfolio,
    ml.to_portfolio,
    ml.transfer_scope

  FROM may_labels ml
  LEFT JOIN may_gmv mg ON ml.outlet_id = mg.outlet_id

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน portfolio เดิมใน May
  SELECT
    '2026-05',
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.first_dollar_date,
    mc.new_user_exp_date,
    NULL,
    mc.base_gmv,
    0,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END,
    mc.base_portfolio,
    ao_any.commercial_owner,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
      ELSE 'external'
    END

  FROM mar_cohort mc
  LEFT JOIN may_own ao_same
    ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN may_own ao_any
    ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 12. JUNE rows ─────────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A: outlets ที่มี order ใน Jun (portfolio scope)
  -- inherit จาก apr_labels → may_labels → classify ใหม่ถ้าไม่อยู่ทั้งคู่
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(al.account_id, ml.account_id, jo.account_id)      AS account_id,
    COALESCE(al.account_name, ml.account_name, jo.account_name) AS account_name,
    COALESCE(al.account_type, ml.account_type, jo.account_type) AS account_type,
    jo.commercial_owner                                          AS current_portfolio,
    jo.staff_owner                                               AS current_staff_owner,
    COALESCE(al.base_portfolio, ml.base_portfolio, mc.base_portfolio) AS base_portfolio,
    COALESCE(al.base_staff_owner, ml.base_staff_owner, mc.base_staff_owner) AS base_staff_owner,
    COALESCE(al.first_dollar_date, ml.first_dollar_date, ofd.first_dollar_date) AS first_dollar_date,
    COALESCE(al.new_user_exp_date, ml.new_user_exp_date, jo.new_user_exp_date)  AS new_user_exp_date,
    COALESCE(al.pre_mar_portfolio, ml.pre_mar_portfolio, pmo.commercial_owner)  AS pre_mar_portfolio,
    COALESCE(al.base_gmv, ml.base_gmv, mc.base_gmv, 0)          AS base_gmv,
    COALESCE(jg.gmv, 0)                                          AS curr_gmv,

    CASE
      -- inherit จาก apr_labels เฉพาะเมื่อ portfolio ไม่เปลี่ยน
      WHEN al.outlet_id IS NOT NULL
        AND al.current_portfolio = jo.commercial_owner THEN
        CASE
          WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv,0) > 0 THEN 'core_nrr'
          WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv,0) = 0 THEN 'core_nrr_churn'
          WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) > 0 THEN 'expansion'
          WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
          WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
          WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
          ELSE al.fixed_label
        END
      -- inherit จาก may_labels เฉพาะเมื่อ portfolio ไม่เปลี่ยน
      WHEN ml.outlet_id IS NOT NULL
        AND ml.current_portfolio = jo.commercial_owner THEN
        CASE
          WHEN ml.fixed_label = 'core'      AND COALESCE(jg.gmv,0) > 0 THEN 'core_nrr'
          WHEN ml.fixed_label = 'core'      AND COALESCE(jg.gmv,0) = 0 THEN 'core_nrr_churn'
          WHEN ml.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) > 0 THEN 'expansion'
          WHEN ml.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
          WHEN ml.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
          WHEN ml.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
          ELSE ml.fixed_label
        END
      -- outlet ใหม่ใน Jun — รัน priority เต็ม
      WHEN ofd.first_dollar_date >= '2026-04-01' AND pmo.outlet_id IS NULL
        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', jo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio = jo.commercial_owner
        THEN CASE WHEN COALESCE(jg.gmv,0) > 0 THEN 'core_nrr' ELSE 'core_nrr_churn' END
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN 'transfer_in'
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = jo.commercial_owner
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN CASE WHEN COALESCE(jg.gmv,0) > 0 THEN 'comeback' ELSE 'transfer_in' END
      ELSE 'transfer_in'
    END AS movement_type,

    CASE
      -- inherit Apr ถ้า portfolio ไม่เปลี่ยน
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner
        THEN al.from_portfolio
      -- portfolio เปลี่ยนจาก Apr → from = Apr portfolio
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN al.current_portfolio
      -- inherit May ถ้า portfolio ไม่เปลี่ยน
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner
        THEN ml.from_portfolio
      -- portfolio เปลี่ยนจาก May → from = May portfolio
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN ml.current_portfolio
      -- outlet ใหม่ใน Jun
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN mc.base_portfolio
      WHEN mc.outlet_id IS NULL AND pmo.commercial_owner IS NOT NULL
        AND pmo.commercial_owner = jo.commercial_owner
        THEN NULL
      ELSE NULL
    END AS from_portfolio,

    -- to_portfolio: NULL ถ้าไม่ใช่ transfer_in จาก cohort
    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner
        THEN al.to_portfolio
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN jo.commercial_owner
      WHEN al.outlet_id IS NULL AND ml.outlet_id IS NOT NULL
        AND ml.current_portfolio = jo.commercial_owner
        THEN ml.to_portfolio
      WHEN al.outlet_id IS NULL AND ml.outlet_id IS NOT NULL
        AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN jo.commercial_owner
      WHEN al.outlet_id IS NULL AND ml.outlet_id IS NULL
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN jo.commercial_owner
      ELSE NULL
    END AS to_portfolio,

    CASE
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio = jo.commercial_owner
        THEN al.transfer_scope
      WHEN al.outlet_id IS NOT NULL AND al.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN CASE
          WHEN al.current_portfolio IN ('KAM','PM','ADMIN')
            AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio = jo.commercial_owner
        THEN ml.transfer_scope
      WHEN ml.outlet_id IS NOT NULL AND ml.current_portfolio != jo.commercial_owner
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN CASE
          WHEN ml.current_portfolio IN ('KAM','PM','ADMIN')
            AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      WHEN mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN CASE
          WHEN mc.base_portfolio IN ('KAM','PM','ADMIN')
            AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      WHEN mc.outlet_id IS NULL AND pmo.commercial_owner IS NOT NULL
        AND mc.outlet_id IS NOT NULL AND mc.base_portfolio != jo.commercial_owner
        THEN CASE
          WHEN pmo.commercial_owner IN ('KAM','PM','ADMIN')
            AND jo.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
          ELSE 'external'
        END
      ELSE NULL
    END AS transfer_scope

  FROM jun_own jo
  LEFT JOIN apr_labels al           ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml           ON jo.outlet_id = ml.outlet_id
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_own pmo         ON jo.outlet_id = pmo.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  -- LEG B: Mar cohort ที่ไม่มี order ใน portfolio เดิมใน Jun
  SELECT
    '2026-06',
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.base_portfolio,
    mc.base_staff_owner,
    mc.first_dollar_date,
    mc.new_user_exp_date,
    NULL,
    mc.base_gmv,
    0,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END,
    mc.base_portfolio,
    ao_any.commercial_owner,
    CASE
      WHEN ao_any.outlet_id IS NULL THEN NULL
      WHEN ao_any.commercial_owner IN ('KAM','PM','ADMIN') THEN 'internal'
      ELSE 'external'
    END

  FROM mar_cohort mc
  LEFT JOIN jun_own ao_same
    ON mc.outlet_id = ao_same.outlet_id
    AND ao_same.commercial_owner = mc.base_portfolio
  LEFT JOIN jun_own ao_any
    ON mc.outlet_id = ao_any.outlet_id
  WHERE ao_same.outlet_id IS NULL
),

-- ── 13. Union all months ──────────────────────────────────────────────────────
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
  r.movement_type,
  r.current_portfolio,
  r.current_staff_owner,
  r.base_portfolio,
  r.base_staff_owner,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.account_type,
  ROUND(r.curr_gmv, 0)   AS curr_gmv,
  ROUND(r.base_gmv, 0)   AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END                    AS curr_days,
  r.first_dollar_date,
  r.new_user_exp_date,
  r.pre_mar_portfolio,
  -- transfer layer metadata
  r.from_portfolio,
  r.to_portfolio,
  r.transfer_scope

FROM all_rows r
CROSS JOIN params p

ORDER BY
  r.period_month,
  r.current_portfolio,
  r.movement_type,
  r.curr_gmv DESC

-- ════════════════════════════════════════════════════════════════════════════
-- RECONCILE CHECK QUERIES (uncomment และรันแยกเพื่อ verify)
-- ════════════════════════════════════════════════════════════════════════════

-- [CHECK 1] Layer 1: GMV per portfolio per month ตรงกับ dwh.order
-- ; SELECT period_month, current_portfolio, SUM(curr_gmv) AS master_gmv
-- FROM (-- paste main query above --)
-- WHERE movement_type != 'transfer_out'
-- GROUP BY 1,2
-- ORDER BY 1,2;

-- [CHECK 2] Layer 2: transfer symmetry
-- ; SELECT period_month, from_portfolio, to_portfolio,
--          COUNT(*) AS cnt, SUM(base_gmv) AS base_total
-- FROM (-- paste main query --)
-- WHERE movement_type IN ('transfer_in','transfer_out')
--   AND transfer_scope = 'internal'
-- GROUP BY 1,2,3 ORDER BY 1,2,3;

-- [CHECK 3] Layer 3: net external outflow
-- ; SELECT period_month, from_portfolio, to_portfolio,
--          COUNT(*) AS outlets, SUM(base_gmv) AS base_gmv
-- FROM (-- paste main query --)
-- WHERE movement_type = 'transfer_out' AND transfer_scope = 'external'
-- GROUP BY 1,2,3;

-- [CHECK 4] No duplicate outlet per period (excl. transfer_out)
-- ; SELECT period_month, outlet_id, COUNT(*) AS cnt
-- FROM (-- paste main query --)
-- WHERE movement_type != 'transfer_out'
-- GROUP BY 1,2 HAVING COUNT(*) > 1;
