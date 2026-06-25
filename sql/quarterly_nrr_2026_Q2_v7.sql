-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2.sql  (v7)
-- ════════════════════════════════════════════════════════════════════════════
--
-- v7 fixes (vs v6):
--   FIX A: apr_labels core/transfer_in detection — ใช้ base_kam_name แทน base_kam_email
--           รองรับ KAM ที่ลาออก (Fang/May) ที่ base_kam_email = null
--   FIX B: LEG 1B/2B/3B transfer_out — ใช้ base_kam_name แทน base_kam_email
--           NULL != x = NULL ทำให้ transfer_out ไม่ถูก detect → แก้ด้วย name compare
--
-- v6 fixes (vs v5):
--   FIX 8: mar_cohort LEFT JOIN — outlet ของ KAM ที่ลาออก (Fang/May) ไม่หลุด
--   FIX 9: ลบ current_kam_snapshot (dim.user_master) — LEG C = core_nrr_churn
--
-- v5 fixes (vs v4):
--   FIX 7: เพิ่ม base_tl_email ใน FINAL SELECT และทุก LEG A
--           ทำให้ JS detect transfer ภายใน squad ได้ถูก → TL/Admin NRR ถูกต้อง
--
-- v4 fixes (vs v3):
--   FIX 4: expansion ตรวจ first_dollar_date >= Apr ก่อน handover/new_sales
--           ป้องกันสาขาใหม่ถูก misclassify เป็น new_sales เพราะ new_user_exp_date
--   FIX 5: handover/new_sales ต้องมี pre-Mar owner เป็น SALE เท่านั้น
--           เพิ่ม CTE pre_mar_ownership เพื่อเช็ค commercial_owner ก่อน Mar
--   FIX 6: comeback ต้องเคยอยู่ในมือ KAM คนนี้ก่อน (last owner ก่อน Mar)
--           เพิ่ม CTE kam_last_owner_pre_mar เพื่อเช็ค ownership ล่าสุดก่อน Mar
--           ถ้า last owner ก่อน Mar เป็น KAM อื่น → transfer_in (ไม่ใช่ comeback)
--
-- Movement definitions (confirmed 2026-06-18):
--   core_nrr       — Mar cohort (active Mar) + KAM เดิม + GMV > 0
--   core_nrr_churn — Mar cohort + KAM เดิม + GMV = 0 (dynamic per month)
--   handover       — pre-Mar owner = SALE + new_user_exp_date = Mar 2026
--   new_sales      — pre-Mar owner = SALE + new_user_exp_date = Apr/May/Jun 2026
--   expansion      — first_dollar >= 2026-04-01 (สาขาใหม่ใน Q) + GMV > 0
--   comeback       — ไม่มี GMV Mar + last pre-Mar owner = KAM คนนี้ + GMV > 0
--   transfer_in    — active outlet ที่ owner เปลี่ยนมาจาก non-Sales (KAM อื่น/AD/PM/Admin)
--   transfer_out   — Mar cohort ของ KAM นี้ → owner เปลี่ยนออกไป
--
-- NRR computation:
--   denominator = SUM(base_gmv / base_days) per unique outlet in Mar cohort (fixed)
--   numerator   = SUM(curr_gmv / curr_days) for core_nrr + core_nrr_churn outlets
--   NRR%        = numerator / denominator × 100
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

-- ── 2. KAM roster ────────────────────────────────────────────────────────────
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
    -- No Owner
    STRUCT('Nitipat (Name) Suparattanasilp'        AS kam_name, CAST(NULL AS STRING)           AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Mongkonkrid (Max) Piyapongsak'         AS kam_name, CAST(NULL AS STRING)           AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Supasuta (Snow) Wongwiwut'             AS kam_name, CAST(NULL AS STRING)           AS kam_email, 'nitipat.s@freshket.co'   AS tl_email)
  ])
),

-- ── 3. outlet_first_dollar — ไม่มี date range filter ────────────────────────
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.first_dollar_date IS NOT NULL
  GROUP BY 1
),

-- ── 4. Ownership per outlet per month ────────────────────────────────────────
mar_ownership AS (
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
    DATE(o.new_user_exp_date)       AS new_user_exp_date
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
    TRIM(o.staff_owner)             AS staff_owner
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

-- ── 5. GMV per outlet per month ───────────────────────────────────────────────
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

-- ── 7. Mar KAM cohort ─────────────────────────────────────────────────────────
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    ofd.first_dollar_date,
    k.kam_email    AS base_kam_email,
    mo.staff_owner AS base_kam_name,
    k.tl_email   AS base_tl_email,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_ownership mo
  LEFT JOIN kam_list k
    ON TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
),

-- ── FIX 5: pre_mar_ownership — owner ล่าสุดของแต่ละ outlet ก่อน Mar ──────────
-- ใช้เช็คว่า handover/new_sales มาจาก SALE จริง
-- ถ้า pre-Mar owner ไม่ใช่ SALE → ไม่ใช่ handover/new_sales
pre_mar_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── FIX 6: kam_last_owner_pre_mar — เช็ค comeback ───────────────────────────
-- comeback = outlet ที่ last owner ก่อน Mar คือ KAM คนนี้
-- ถ้า last owner เป็นคนอื่น → transfer_in
kam_last_owner_pre_mar AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS last_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS last_commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date < '2026-03-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 8. apr_labels — lock classification ตั้งแต่ Apr (v4) ─────────────────────
-- Priority CASE (สำคัญ — ลำดับนี้กำหนด classification):
--   1. expansion    — first_dollar >= Apr (ก่อนเพื่อน — สาขาใหม่แท้ไม่มีทางเป็นอย่างอื่น)
--   2. handover     — pre-Mar owner = SALE + new_user_exp_date = Mar
--   3. new_sales    — pre-Mar owner = SALE + new_user_exp_date = Apr/May/Jun
--   4. core         — Mar cohort + KAM เดิม
--   5. transfer_in  — Mar cohort ของ KAM อื่น
--   6. comeback     — last pre-Mar owner = KAM คนนี้ + ไม่มี GMV Mar
--   7. transfer_in  — ELSE (active outlet มาจากคนอื่นที่ไม่ใช่ Sales)
apr_labels AS (
  SELECT
    ao.outlet_id,
    k.kam_email AS period_kam_email,
    COALESCE(mc.account_id, ao.account_id, ao.outlet_id) AS account_id,
    COALESCE(mc.account_name, ao.account_name, '')        AS account_name,
    COALESCE(mc.account_type, ao.account_type, '')        AS account_type,
    k.kam_name  AS period_kam_name,
    k.tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    COALESCE(mc.base_gmv, 0) AS base_gmv,

    CASE
      -- [1] expansion: first_dollar ใน Q — สาขาใหม่แท้ (ตรวจก่อนเพื่อน)
      -- ป้องกันสาขาใหม่ที่มี new_user_exp_date ใน Q ถูก misclassify เป็น new_sales
      WHEN ofd.first_dollar_date >= '2026-04-01'
        THEN 'expansion'

      -- [2] handover: รับมาจาก Sales ใน Mar
      -- ต้องเช็ค pre-Mar owner เป็น SALE (FIX 5)
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE'
        THEN 'handover'

      -- [3] new_sales: รับมาจาก Sales ใน Apr/May/Jun
      -- ต้องเช็ค pre-Mar owner เป็น SALE (FIX 5)
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND pmo.commercial_owner = 'SALE'
        THEN 'new_sales'

      -- [4] core: อยู่ Mar cohort + KAM เดิม (ใช้ name เพราะ Fang/May base_kam_email = null)
      WHEN mc.base_kam_name IS NOT NULL AND TRIM(mc.base_kam_name) = TRIM(k.kam_name)
        THEN 'core'

      -- [5] transfer_in: อยู่ Mar cohort ของ KAM อื่น (ใช้ name)
      WHEN mc.base_kam_name IS NOT NULL AND TRIM(mc.base_kam_name) != TRIM(k.kam_name)
        THEN 'transfer_in'

      -- [6] comeback: ไม่มี GMV Mar + last pre-Mar owner คือ KAM คนนี้ (FIX 6)
      -- ถ้า last owner เป็น KAM อื่น → ตกไป [7] transfer_in
      WHEN mc.base_kam_email IS NULL
        AND klop.last_commercial_owner = 'KAM'
        AND TRIM(klop.last_staff_owner) = TRIM(k.kam_name)
        THEN 'comeback'

      -- [7] transfer_in: อื่นๆ ทั้งหมด
      -- รวม: อยู่กับ KAM อื่นก่อน Mar, มาจาก AD/PM/Admin, new_user_exp_date ไม่ตรง SALE
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_ownership ao
  JOIN kam_list k
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_ownership pmo      ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN kam_last_owner_pre_mar klop ON ao.outlet_id = klop.outlet_id
),

-- ── 9. MONTH: April ───────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG 1A: outlets ที่ Apr ownership = KAM ใน roster
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    al.outlet_id,
    al.account_id,
    al.account_name,
    al.account_type,
    al.period_kam_email,
    al.period_kam_name,
    al.period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_kam_name,
    al.base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,

    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(ag.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(ag.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(ag.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(ag.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(ag.gmv, 0) = 0 THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type

  FROM apr_labels al
  LEFT JOIN apr_gmv ag ON al.outlet_id = ag.outlet_id

  UNION ALL

  -- LEG 1B: transfer_out — Mar cohort แต่ Apr ownership เปลี่ยน KAM
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN apr_ownership ao ON mc.outlet_id = ao.outlet_id
  JOIN kam_list k_apr
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(k_apr.kam_name)
   AND TRIM(k_apr.kam_name) != TRIM(mc.base_kam_name)
  WHERE mc.outlet_id NOT IN (
    SELECT ao2.outlet_id FROM apr_ownership ao2
    JOIN kam_list k2
      ON ao2.commercial_owner = 'KAM'
     AND TRIM(ao2.staff_owner) = TRIM(k2.kam_name)
     AND TRIM(k2.kam_name) = TRIM(mc.base_kam_name)
  )

  UNION ALL

  -- LEG 1C: silent outlets
  SELECT
    '2026-04'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'core_nrr_churn'  AS movement_type

  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_ownership)
),

-- ── 10. MONTH: May ────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG 2A
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mo.outlet_id,
    COALESCE(al.account_id, mo.account_id, mo.outlet_id) AS account_id,
    COALESCE(al.account_name, mo.account_name, '')        AS account_name,
    COALESCE(al.account_type, mo.account_type, '')        AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_kam_name,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)      AS curr_gmv,

    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      -- outlet ใหม่ที่เข้ามาใน May แต่ไม่มีใน apr_labels:
      -- ต้องเช็ค first_dollar ก่อน — อาจเป็น expansion ไม่ใช่ new_sales
      WHEN al.outlet_id IS NULL AND ofd_may.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL THEN 'new_sales'
      ELSE al.fixed_label
    END AS movement_type

  FROM may_ownership mo
  JOIN kam_list k
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN apr_labels al
    ON mo.outlet_id = al.outlet_id
   AND al.period_kam_email = k.kam_email
  LEFT JOIN may_gmv mg ON mo.outlet_id = mg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_may ON mo.outlet_id = ofd_may.outlet_id

  UNION ALL

  -- LEG 2B: transfer_out ของ May
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN may_ownership mo ON mc.outlet_id = mo.outlet_id
  JOIN kam_list k_may
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(k_may.kam_name)
   AND TRIM(k_may.kam_name) != TRIM(mc.base_kam_name)
  WHERE mc.outlet_id NOT IN (
    SELECT mo2.outlet_id FROM may_ownership mo2
    JOIN kam_list k2
      ON mo2.commercial_owner = 'KAM'
     AND TRIM(mo2.staff_owner) = TRIM(k2.kam_name)
     AND TRIM(k2.kam_name) = TRIM(mc.base_kam_name)
  )

  UNION ALL

  -- LEG 2C: silent outlets May
  SELECT
    '2026-05'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'core_nrr_churn'  AS movement_type

  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_ownership)
),

-- ── 11. MONTH: June ───────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG 3A
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    jo.outlet_id,
    COALESCE(al.account_id, jo.account_id, jo.outlet_id) AS account_id,
    COALESCE(al.account_name, jo.account_name, '')        AS account_name,
    COALESCE(al.account_type, jo.account_type, '')        AS account_type,
    k.kam_email       AS period_kam_email,
    k.kam_name        AS period_kam_name,
    k.tl_email        AS period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_kam_name,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)      AS curr_gmv,

    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.outlet_id IS NULL AND ofd_jun.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL THEN 'new_sales'
      ELSE al.fixed_label
    END AS movement_type

  FROM jun_ownership jo
  JOIN kam_list k
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN apr_labels al
    ON jo.outlet_id = al.outlet_id
   AND al.period_kam_email = k.kam_email
  LEFT JOIN jun_gmv jg ON jo.outlet_id = jg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_jun ON jo.outlet_id = ofd_jun.outlet_id

  UNION ALL

  -- LEG 3B: transfer_out ของ Jun
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN jun_ownership jo ON mc.outlet_id = jo.outlet_id
  JOIN kam_list k_jun
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(k_jun.kam_name)
   AND TRIM(k_jun.kam_name) != TRIM(mc.base_kam_name)
  WHERE mc.outlet_id NOT IN (
    SELECT jo2.outlet_id FROM jun_ownership jo2
    JOIN kam_list k2
      ON jo2.commercial_owner = 'KAM'
     AND TRIM(jo2.staff_owner) = TRIM(k2.kam_name)
     AND TRIM(k2.kam_name) = TRIM(mc.base_kam_name)
  )

  UNION ALL

  -- LEG 3C: silent outlets Jun
  SELECT
    '2026-06'         AS period_month,
    '2026-03'         AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email AS period_kam_email,
    mc.base_kam_name  AS period_kam_name,
    mc.base_tl_email  AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email  AS base_tl_email,
    mc.base_kam_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'core_nrr_churn'  AS movement_type

  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_ownership)
),

-- ── 12. Union all months ──────────────────────────────────────────────────────
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
  r.base_month,
  r.movement_type,
  r.period_kam_email,
  r.period_kam_name,
  r.period_tl_email,
  r.base_kam_email,
  r.base_tl_email,
  r.account_id,
  r.account_name,
  r.account_type,
  r.outlet_id,
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
  r.period_tl_email,
  r.period_kam_email,
  r.period_month,
  r.movement_type,
  r.curr_gmv DESC
