-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR — Reconcile View  (v2)
-- quarterly_nrr_2026_Q2_reconcile.sql
-- ════════════════════════════════════════════════════════════════════════════
-- โครงสร้าง: ไม่ filter commercial_owner ใน CTEs ยกเว้น mar_cohort และ
--            period_ownership WHERE — ทำให้ prev_owner และ first_dollar ถูกต้อง
-- ════════════════════════════════════════════════════════════════════════════

WITH

params AS (
  SELECT
    DATE('2026-03-01') AS base_start, DATE('2026-03-31') AS base_end, 31 AS base_days,
    DATE('2026-04-01') AS apr_start,  DATE('2026-04-30') AS apr_end,  30 AS apr_days,
    DATE('2026-05-01') AS may_start,  DATE('2026-05-31') AS may_end,  31 AS may_days,
    DATE('2026-06-01') AS jun_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS jun_end,
    DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), DATE('2026-06-01'), DAY) + 1 AS jun_days
),

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
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nutkamol (Fang) Siladam'              AS kam_name, 'nutkamol.s@freshket.co'     AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Sojirat (May) Charoensuk'             AS kam_name, 'sojirat.c@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Supasuta (Snow) Wongwiwut'            AS kam_name, 'supasuta.w@freshket.co'     AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Mongkonkrid (Max) Piyapongsak'        AS kam_name, 'mongkonkrid.p@freshket.co'  AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nitipat (Name) Suparattanasilp'       AS kam_name, 'nitipat.su@freshket.co'     AS kam_email, 'nitipat.s@freshket.co'   AS tl_email)
  ])
),

-- ── outlet_first_dollar: ทุก outlet ทุก commercial_owner ─────────────────────
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.first_dollar_date IS NOT NULL
  GROUP BY 1
),

-- ── GMV per outlet per month: ทุก commercial_owner ───────────────────────────
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
apr_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── Ownership per month: ทุก commercial_owner ─────────────────────────────────
mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── pre_period_own: last order ก่อนแต่ละเดือน ทุก commercial_owner ──────────
pre_apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-04-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
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
    AND o.account_type IN ('SA','MC','Chain','Unknown')
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
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── pre_mar_own: ใช้เฉพาะ handover/new_sales classification ────────────────
pre_mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── mar_cohort: filter KAM ตรงนี้เพราะเป็น business logic ───────────────────
mar_cohort AS (
  SELECT
    mo.outlet_id, mo.account_id, mo.account_name, mo.account_type,
    mo.new_user_exp_date, mo.staff_owner AS base_staff_owner,
    ofd.first_dollar_date,
    k.kam_email AS base_kam_email, k.tl_email AS base_tl_email,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_own mo
  LEFT JOIN kam_list k   ON TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg  ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
    AND (mo.new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date) != '2026-03')
),

-- ── apr_labels: lock classification ─────────────────────────────────────────
apr_labels AS (
  SELECT
    ao.outlet_id, ao.account_id, ao.account_name, ao.account_type,
    ao.staff_owner AS current_staff_owner,
    ao.new_user_exp_date,
    k_cur.tl_email AS period_tl_email,
    COALESCE(mc.base_gmv, 0) AS base_gmv,
    mc.base_staff_owner AS prev_staff_owner,
    mc.base_tl_email,
    ofd.first_dollar_date,
    pmo.commercial_owner AS prev_commercial_owner,
    pmo.staff_owner      AS prev_staff_owner_raw,

    CASE
      -- [1] expansion: first_dollar ใน Q + ไม่เคยมี order ก่อน Apr (pmo = NULL)
      WHEN ofd.first_dollar_date >= '2026-04-01'
        AND pmo.outlet_id IS NULL
        THEN 'expansion'

      -- [2] handover: รับจาก Sales ใน Mar — ใช้ pre_mar_own
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        AND pmo_mar.commercial_owner = 'SALE'
        THEN 'handover'

      -- [3] new_sales: รับจาก Sales ใน Q — ใช้ pre_mar_own
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo_mar.commercial_owner = 'SALE' OR pmo_mar.outlet_id IS NULL)
        THEN 'new_sales'

      -- [4] core: Mar cohort + ยังอยู่ใน KAM pool
      WHEN mc.outlet_id IS NOT NULL
        THEN 'core'

      -- [5] comeback: ไม่มี Mar GMV + pre-Mar = KAM + ไม่มี new_user_exp_date ใน Q
      WHEN mc.outlet_id IS NULL AND pmo.commercial_owner = 'KAM'
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'

      -- [6] transfer_in: มาจากนอก KAM pool
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_own ao
  LEFT JOIN mar_cohort mc  ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_apr_own pmo     ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN pre_mar_own pmo_mar ON ao.outlet_id = pmo_mar.outlet_id
  LEFT JOIN kam_list k_cur      ON TRIM(ao.staff_owner) = TRIM(k_cur.kam_name)
  WHERE ao.commercial_owner = 'KAM'
),

-- ── may_labels: inherit classification สำหรับ outlet ที่เข้า KAM ใน May ──────
may_labels AS (
  SELECT
    mo.outlet_id,
    CASE
      WHEN ofd_m.first_dollar_date >= '2026-04-01' AND pmo_m.outlet_id IS NULL THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03'
        AND pmo_mar_ml.commercial_owner = 'SALE'                                THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', mo.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo_mar_ml.commercial_owner = 'SALE' OR pmo_mar_ml.outlet_id IS NULL) THEN 'new_sales'
      WHEN al.outlet_id IS NOT NULL                                              THEN al.fixed_label
      WHEN pmo_mar_ml.commercial_owner = 'KAM'
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))                THEN 'comeback'
      ELSE 'transfer_in'
    END AS fixed_label,
    COALESCE(al.base_gmv, 0)                                                     AS base_gmv,
    COALESCE(al.period_tl_email, k_ml.tl_email)                                  AS period_tl_email,
    COALESCE(al.prev_commercial_owner, pmo_m.commercial_owner)                   AS prev_commercial_owner,
    COALESCE(al.prev_staff_owner, al.prev_staff_owner_raw, pmo_m.staff_owner)    AS prev_staff_owner
  FROM may_own mo
  LEFT JOIN apr_labels al          ON mo.outlet_id = al.outlet_id
  LEFT JOIN outlet_first_dollar ofd_m ON mo.outlet_id = ofd_m.outlet_id
  LEFT JOIN pre_may_own pmo_m      ON mo.outlet_id = pmo_m.outlet_id
  LEFT JOIN pre_mar_own pmo_mar_ml ON mo.outlet_id = pmo_mar_ml.outlet_id
  LEFT JOIN kam_list k_ml          ON TRIM(mo.staff_owner) = TRIM(k_ml.kam_name)
  WHERE mo.commercial_owner = 'KAM'
),

-- ── combined: Apr/May/Jun rows ───────────────────────────────────────────────
combined AS (

  -- APR LEG A
  SELECT '2026-04' AS period_month,
    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(ag.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(ag.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv,0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(ag.gmv,0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(ag.gmv,0) = 0 THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type,
    al.outlet_id, al.account_id, al.account_name, al.account_type,
    COALESCE(ag.gmv,0) AS curr_gmv, al.base_gmv,
    al.first_dollar_date, al.new_user_exp_date,
    al.prev_commercial_owner, COALESCE(al.prev_staff_owner, al.prev_staff_owner_raw) AS prev_staff_owner,
    'KAM' AS current_commercial_owner, al.current_staff_owner,
    al.period_tl_email
  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- APR LEG B: Mar cohort silent/transfer_out
  SELECT '2026-04',
    CASE WHEN ao.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    0, mc.base_gmv, mc.first_dollar_date, mc.new_user_exp_date,
    ao.commercial_owner, mc.base_staff_owner,
    ao.commercial_owner, ao.staff_owner,
    mc.base_tl_email
  FROM mar_cohort mc
  LEFT JOIN apr_own ao ON mc.outlet_id = ao.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_own WHERE commercial_owner = 'KAM')

  UNION ALL

  -- MAY LEG A
  SELECT '2026-05',
    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv,0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv,0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NULL AND ofd_m.first_dollar_date >= '2026-04-01'
           AND pmo_m.outlet_id IS NULL                                THEN 'expansion'
      WHEN al.outlet_id IS NULL AND pmo_m.commercial_owner = 'SALE'  THEN 'new_sales'
      WHEN al.outlet_id IS NULL AND pmo_m.commercial_owner = 'KAM'   THEN 'comeback'
      WHEN al.outlet_id IS NULL THEN 'transfer_in'
      ELSE al.fixed_label
    END,
    mo.outlet_id,
    COALESCE(al.account_id, mo.account_id),
    COALESCE(al.account_name, mo.account_name),
    COALESCE(al.account_type, mo.account_type),
    COALESCE(mg.gmv,0), COALESCE(al.base_gmv,0),
    COALESCE(al.first_dollar_date, ofd_m.first_dollar_date),
    COALESCE(al.new_user_exp_date, mo.new_user_exp_date),
    COALESCE(al.prev_commercial_owner, pmo_m.commercial_owner),
    COALESCE(al.prev_staff_owner, al.prev_staff_owner_raw, pmo_m.staff_owner),
    'KAM', mo.staff_owner,
    COALESCE(al.period_tl_email, k_m.tl_email)
  FROM may_own mo
  LEFT JOIN apr_labels al ON mo.outlet_id = al.outlet_id
  LEFT JOIN may_gmv mg ON mo.outlet_id = mg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_m ON mo.outlet_id = ofd_m.outlet_id
  LEFT JOIN pre_may_own pmo_m ON mo.outlet_id = pmo_m.outlet_id
  LEFT JOIN kam_list k_m ON TRIM(mo.staff_owner) = TRIM(k_m.kam_name)
  WHERE mo.commercial_owner = 'KAM'

  UNION ALL

  -- MAY LEG B
  SELECT '2026-05',
    CASE WHEN mo.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    0, mc.base_gmv, mc.first_dollar_date, mc.new_user_exp_date,
    mo.commercial_owner, mc.base_staff_owner,
    mo.commercial_owner, mo.staff_owner,
    mc.base_tl_email
  FROM mar_cohort mc
  LEFT JOIN may_own mo ON mc.outlet_id = mo.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_own WHERE commercial_owner = 'KAM')

  UNION ALL

  -- JUN LEG A
  SELECT '2026-06',
    CASE
      -- อยู่ใน apr_labels → inherit จาก Apr
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core'      AND COALESCE(jg.gmv,0) > 0 THEN 'core_nrr'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'core'      AND COALESCE(jg.gmv,0) = 0 THEN 'core_nrr_churn'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) > 0 THEN 'expansion'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
      WHEN al.outlet_id IS NOT NULL AND al.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NOT NULL THEN al.fixed_label
      -- ไม่อยู่ใน apr_labels → inherit จาก may_labels
      WHEN ml.outlet_id IS NOT NULL AND ml.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) > 0 THEN 'expansion'
      WHEN ml.outlet_id IS NOT NULL AND ml.fixed_label = 'expansion' AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN ml.outlet_id IS NOT NULL AND ml.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) > 0 THEN 'comeback'
      WHEN ml.outlet_id IS NOT NULL AND ml.fixed_label = 'comeback'  AND COALESCE(jg.gmv,0) = 0 THEN 'transfer_in'
      WHEN ml.outlet_id IS NOT NULL THEN ml.fixed_label
      -- outlet ใหม่ใน Jun (ไม่อยู่ทั้ง apr และ may)
      WHEN ofd_j.first_dollar_date >= '2026-04-01' AND pmo_j.outlet_id IS NULL THEN 'expansion'
      WHEN pmo_j.commercial_owner = 'SALE'                                      THEN 'new_sales'
      WHEN pmo_mar_j.commercial_owner = 'KAM'
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))               THEN 'comeback'
      ELSE 'transfer_in'
    END,
    jo.outlet_id,
    COALESCE(al.account_id, jo.account_id),
    COALESCE(al.account_name, jo.account_name),
    COALESCE(al.account_type, jo.account_type),
    COALESCE(jg.gmv,0), COALESCE(al.base_gmv, ml.base_gmv, 0),
    COALESCE(al.first_dollar_date, ofd_j.first_dollar_date),
    COALESCE(al.new_user_exp_date, jo.new_user_exp_date),
    COALESCE(al.prev_commercial_owner, ml.prev_commercial_owner, pmo_j.commercial_owner),
    COALESCE(al.prev_staff_owner, al.prev_staff_owner_raw, ml.prev_staff_owner, pmo_j.staff_owner),
    'KAM', jo.staff_owner,
    COALESCE(al.period_tl_email, ml.period_tl_email, k_j.tl_email)
  FROM jun_own jo
  LEFT JOIN apr_labels al    ON jo.outlet_id = al.outlet_id
  LEFT JOIN may_labels ml    ON jo.outlet_id = ml.outlet_id
  LEFT JOIN jun_gmv jg       ON jo.outlet_id = jg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_j  ON jo.outlet_id = ofd_j.outlet_id
  LEFT JOIN pre_jun_own pmo_j          ON jo.outlet_id = pmo_j.outlet_id
  LEFT JOIN pre_mar_own pmo_mar_j      ON jo.outlet_id = pmo_mar_j.outlet_id
  LEFT JOIN kam_list k_j               ON TRIM(jo.staff_owner) = TRIM(k_j.kam_name)
  WHERE jo.commercial_owner = 'KAM'

  UNION ALL

  -- JUN LEG B
  SELECT '2026-06',
    CASE WHEN jo.outlet_id IS NULL THEN 'core_nrr_churn' ELSE 'transfer_out' END,
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    0, mc.base_gmv, mc.first_dollar_date, mc.new_user_exp_date,
    jo.commercial_owner, mc.base_staff_owner,
    jo.commercial_owner, jo.staff_owner,
    mc.base_tl_email
  FROM mar_cohort mc
  LEFT JOIN jun_own jo ON mc.outlet_id = jo.outlet_id
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_own WHERE commercial_owner = 'KAM')
)

SELECT
  c.period_month,
  c.movement_type,
  c.outlet_id,
  um.res_name                    AS outlet_name,
  c.account_id,
  c.account_name,
  c.account_type,
  ROUND(c.curr_gmv, 0)           AS curr_gmv,
  ROUND(c.base_gmv, 0)           AS base_gmv,
  c.first_dollar_date,
  c.new_user_exp_date,
  c.prev_commercial_owner,
  c.prev_staff_owner,
  c.current_commercial_owner,
  c.current_staff_owner,
  c.period_tl_email

FROM combined c
LEFT JOIN `freshket-rn.dim.user_master` um
  ON CAST(um.res_id AS STRING) = c.outlet_id

WHERE c.movement_type NOT IN ('core_nrr', 'core_nrr_churn')

ORDER BY
  c.period_month,
  c.movement_type,
  c.curr_gmv DESC
