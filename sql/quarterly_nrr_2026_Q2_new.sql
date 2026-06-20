-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2_new.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- PURPOSE: Portfolio-level NRR สำหรับ TL และ Admin scope
--          ใช้ร่วมกับ v5 (rep scope) ใน CSV เดียวกัน
--
-- KEY DIFFERENCES vs v5:
--   1. mar_cohort ใช้ commercial_owner = 'KAM' เป็น anchor
--      ไม่ JOIN roster → จับ KAM ลาออก (Fang/May/Snow/Max/Nitipat) ได้ครบ
--   2. handover = new_user_exp_date = Mar 2026 เท่านั้น
--      NULL new_user_exp_date = existing KAM account → นับเป็น core
--   3. Q ownership check ใช้ commercial_owner = 'KAM' ไม่ต้อง match staff_owner
--      → KAM ลาออก outlet ถูก reassign ให้ KAM ใหม่ = ยังเป็น core
--   4. transfer_out = outlet หลุดออกจาก KAM pool ทั้งหมด (ไป SALE/PM/AD/ไม่มี)
--      ไม่นับ KAM A → KAM B ภายใน pool
--   5. base_tl_email มาจาก LEFT JOIN roster (ไม่บังคับ match)
--      KAM ลาออก → base_tl_email = NULL → JS handle แยก
--
-- GROUND TRUTH (verified 2026-06-20):
--   Mar KAM cohort = 2,721 outlets ฿137.2M (commercial_owner = 'KAM')
--   handover (exp_date = Mar) = 25 outlets ฿0.4M
--   core cohort target = 2,696 outlets ฿136.8M
--   left_roster (KAM ลาออก) = 496 outlets ฿17.8M → นับเป็น core
--
-- Movement definitions:
--   core_nrr       — Mar cohort + Q owner commercial_owner = KAM + GMV > 0
--   core_nrr_churn — Mar cohort + Q owner commercial_owner = KAM + GMV = 0
--   handover       — new_user_exp_date = Mar 2026 + pre-Mar owner = SALE
--   new_sales      — sales_handover_month = Apr/May/Jun + pre owner = SALE
--   expansion      — first_dollar_date >= 2026-04-01
--   comeback       — ไม่มี GMV Mar + pre-Mar owner = KAM (ไม่สน staff_owner)
--   transfer_in    — เข้ามาจากนอก KAM pool (SALE/PM/AD → KAM)
--   transfer_out   — Mar cohort → ออกจาก KAM pool (KAM → SALE/PM/AD/silent)
--
-- NRR formula (เหมือน v5):
--   denominator = SUM(base_gmv / base_days) for core cohort excl. handover & transfer_out
--   numerator   = SUM(curr_gmv / curr_days) for core_nrr outlets
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

-- ── 2. KAM roster — ใช้สำหรับ lookup tl_email เท่านั้น ──────────────────────
-- ไม่ใช้เป็น filter หลัก (เพื่อจับ KAM ลาออกได้)
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
    -- KAM ลาออก — ยังคง tl_email เดิมเพื่อ attribute base_tl_email ให้ถูก
    STRUCT('Nutkamol (Fang) Siladam'              AS kam_name, 'nutkamol.s@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Sojirat (May) Charoensuk'             AS kam_name, 'sojirat.c@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Supasuta (Snow) Wongwiwut'            AS kam_name, 'supasuta.w@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Mongkonkrid (Max) Piyapongsak'        AS kam_name, 'mongkonkrid.p@freshket.co'   AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nitipat (Name) Suparattanasilp'       AS kam_name, 'nitipat.su@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email)
  ])
),

-- ── 3. outlet_first_dollar ────────────────────────────────────────────────────
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

-- ── 4. GMV per outlet per month ───────────────────────────────────────────────
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

-- ── 5. Ownership per outlet per month ─────────────────────────────────────────
-- grain: outlet × month (last order ของเดือนนั้น)
mar_ownership AS (
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
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
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
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_ownership AS (
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
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_ownership AS (
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
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 6. pre_mar_ownership — เช็ค handover/new_sales/comeback ──────────────────
pre_mar_ownership AS (
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

-- ── 7. Mar cohort — anchor หลัก ──────────────────────────────────────────────
-- ใช้ commercial_owner = 'KAM' เท่านั้น ไม่ JOIN roster
-- handover = new_user_exp_date = Mar 2026 (NULL = existing account = core)
-- LEFT JOIN kam_list เพื่อ lookup tl_email เท่านั้น
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.new_user_exp_date,
    mo.staff_owner        AS base_staff_owner,
    ofd.first_dollar_date,
    k.kam_email           AS base_kam_email,   -- NULL ถ้า KAM ลาออก
    k.kam_name            AS base_kam_name,
    k.tl_email            AS base_tl_email,    -- NULL ถ้า KAM ลาออก
    COALESCE(bg.gmv, 0)   AS base_gmv
  FROM mar_ownership mo
  LEFT JOIN kam_list k
    ON TRIM(mo.staff_owner) = TRIM(k.kam_name)
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
    -- ตัด handover ออกจาก core cohort (NULL = existing = core)
    AND (mo.new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date) != '2026-03')
),

-- ── 8. apr_labels — lock classification ตั้งแต่ Apr ─────────────────────────
-- Priority:
--   1. expansion   — first_dollar >= Apr (สาขาใหม่แท้)
--   2. handover    — new_user_exp_date = Mar + pre-Mar owner = SALE
--   3. new_sales   — new_user_exp_date = Apr/May/Jun + pre owner = SALE
--   4. core        — Mar cohort (commercial_owner = KAM) + Q owner ยัง KAM
--   5. transfer_in — ไม่ใช่ Mar cohort + Q owner = KAM + ไม่ใช่ expansion/handover/new_sales
--   6. comeback    — ไม่มี GMV Mar + pre-Mar owner = KAM (ไม่สน staff_owner ว่าใคร)
apr_labels AS (
  SELECT
    ao.outlet_id,
    ao.account_id,
    ao.account_name,
    ao.account_type,
    ao.staff_owner        AS period_staff_owner,
    -- lookup tl_email จาก Q owner (KAM ปัจจุบัน)
    k_cur.kam_email       AS period_kam_email,
    k_cur.tl_email        AS period_tl_email,
    -- base info จาก Mar cohort (NULL ถ้า KAM ลาออกและ outlet ไม่อยู่ Mar cohort)
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_kam_name,
    mc.base_staff_owner,
    COALESCE(mc.base_gmv, 0) AS base_gmv,

    CASE
      -- [1] expansion: สาขาใหม่แท้ใน Q
      WHEN ofd.first_dollar_date >= '2026-04-01'
        THEN 'expansion'

      -- [2] handover: รับจาก Sales ใน Mar
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        AND pmo.commercial_owner = 'SALE'
        THEN 'handover'

      -- [3] new_sales: รับจาก Sales ใน Apr/May/Jun
      -- pmo IS NULL = ไม่มี order ก่อน Mar เลย + new_user_exp_date ใน Q = new_sales
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) IN ('2026-04','2026-05','2026-06')
        AND (pmo.commercial_owner = 'SALE' OR pmo.outlet_id IS NULL)
        THEN 'new_sales'

      -- [4] core: Mar cohort + Q owner ยัง commercial_owner = KAM
      -- ไม่สน staff_owner ว่าเปลี่ยนมือหรือเปล่า — ยังอยู่ใน KAM pool = core
      WHEN mc.outlet_id IS NOT NULL
        THEN 'core'

      -- [4.5] handover: new_user_exp_date = Mar → handover เสมอ
      WHEN FORMAT_DATE('%Y-%m', ao.new_user_exp_date) = '2026-03'
        THEN 'handover'

      -- [5] comeback: ไม่มี GMV Mar + pre-Mar = KAM + ไม่มี new_user_exp_date ใน Q
      WHEN mc.outlet_id IS NULL
        AND pmo.commercial_owner = 'KAM'
        AND (ao.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', ao.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'comeback'

      -- [6] transfer_in: เข้ามาจากนอก KAM pool
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_ownership ao
  LEFT JOIN mar_cohort mc              ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd    ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN pre_mar_ownership pmo      ON ao.outlet_id = pmo.outlet_id
  LEFT JOIN kam_list k_cur
    ON TRIM(ao.staff_owner) = TRIM(k_cur.kam_name)
  -- Q owner ต้องเป็น KAM (commercial_owner = 'KAM')
  WHERE ao.commercial_owner = 'KAM'
),

-- ── 9. MONTH: April ───────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG 1A: outlets ที่ Apr commercial_owner = KAM
  SELECT
    '2026-04'              AS period_month,
    '2026-03'              AS base_month,
    al.outlet_id,
    al.account_id,
    al.account_name,
    al.account_type,
    al.period_kam_email,
    al.period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_staff_owner,
    al.base_gmv,
    COALESCE(ag.gmv, 0)    AS curr_gmv,

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

  -- LEG 1B: Mar cohort ที่ไม่อยู่ใน Apr KAM ownership
  -- silent (ไม่มี order ใน Apr) → core_nrr_churn (ยังอยู่ใน pool)
  -- มี order แต่ commercial_owner ≠ KAM → transfer_out จริง
  SELECT
    '2026-04'              AS period_month,
    '2026-03'              AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email      AS period_kam_email,
    mc.base_tl_email       AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_staff_owner,
    mc.base_gmv,
    0                      AS curr_gmv,
    CASE
      WHEN ao.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                    AS movement_type

  FROM mar_cohort mc
  LEFT JOIN apr_ownership ao ON mc.outlet_id = ao.outlet_id
  WHERE mc.outlet_id NOT IN (
    SELECT outlet_id FROM apr_ownership
    WHERE commercial_owner = 'KAM'
  )
),

-- ── 10. MONTH: May ────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG 2A: outlets ที่ May commercial_owner = KAM
  SELECT
    '2026-05'              AS period_month,
    '2026-03'              AS base_month,
    mo.outlet_id,
    COALESCE(al.account_id, mo.account_id) AS account_id,
    COALESCE(al.account_name, mo.account_name) AS account_name,
    COALESCE(al.account_type, mo.account_type) AS account_type,
    k_cur.kam_email        AS period_kam_email,
    k_cur.tl_email         AS period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_staff_owner,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)    AS curr_gmv,

    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(mg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(mg.gmv, 0) = 0 THEN 'transfer_in'
      -- outlet ใหม่ที่เข้ามาใน May (ไม่มีใน apr_labels)
      WHEN al.outlet_id IS NULL AND ofd_may.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL AND pmo_may.commercial_owner = 'SALE'         THEN 'new_sales'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', mo.new_user_exp_date) = '2026-03' THEN 'handover'
      WHEN al.outlet_id IS NULL AND pmo_may.commercial_owner = 'KAM'
        AND (mo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', mo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))               THEN 'comeback'
      WHEN al.outlet_id IS NULL THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type

  FROM may_ownership mo
  LEFT JOIN apr_labels al
    ON mo.outlet_id = al.outlet_id
  LEFT JOIN may_gmv mg ON mo.outlet_id = mg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_may ON mo.outlet_id = ofd_may.outlet_id
  LEFT JOIN pre_mar_ownership pmo_may   ON mo.outlet_id = pmo_may.outlet_id
  LEFT JOIN kam_list k_cur
    ON TRIM(mo.staff_owner) = TRIM(k_cur.kam_name)
  WHERE mo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG 2B: Mar cohort ที่ไม่อยู่ใน May KAM ownership
  -- silent → core_nrr_churn, มี order แต่ ≠ KAM → transfer_out
  SELECT
    '2026-05'              AS period_month,
    '2026-03'              AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email      AS period_kam_email,
    mc.base_tl_email       AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_staff_owner,
    mc.base_gmv,
    0                      AS curr_gmv,
    CASE
      WHEN mo.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                    AS movement_type

  FROM mar_cohort mc
  LEFT JOIN may_ownership mo ON mc.outlet_id = mo.outlet_id
  WHERE mc.outlet_id NOT IN (
    SELECT outlet_id FROM may_ownership
    WHERE commercial_owner = 'KAM'
  )
),

-- ── 11. MONTH: June ───────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG 3A: outlets ที่ Jun commercial_owner = KAM
  SELECT
    '2026-06'              AS period_month,
    '2026-03'              AS base_month,
    jo.outlet_id,
    COALESCE(al.account_id, jo.account_id) AS account_id,
    COALESCE(al.account_name, jo.account_name) AS account_name,
    COALESCE(al.account_type, jo.account_type) AS account_type,
    k_cur.kam_email        AS period_kam_email,
    k_cur.tl_email         AS period_tl_email,
    al.base_kam_email,
    al.base_tl_email,
    al.base_staff_owner,
    COALESCE(al.base_gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)    AS curr_gmv,

    CASE
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'      AND COALESCE(jg.gmv, 0) = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND COALESCE(jg.gmv, 0) = 0 THEN 'transfer_in'
      -- outlet ใหม่ที่เข้ามาใน Jun (ไม่มีใน apr_labels)
      WHEN al.outlet_id IS NULL AND ofd_jun.first_dollar_date >= '2026-04-01' THEN 'expansion'
      WHEN al.outlet_id IS NULL AND pmo_jun.commercial_owner = 'SALE'         THEN 'new_sales'
      WHEN al.outlet_id IS NULL AND FORMAT_DATE('%Y-%m', jo.new_user_exp_date) = '2026-03' THEN 'handover'
      WHEN al.outlet_id IS NULL AND pmo_jun.commercial_owner = 'KAM'
        AND (jo.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', jo.new_user_exp_date)
                NOT IN ('2026-03','2026-04','2026-05','2026-06'))               THEN 'comeback'
      WHEN al.outlet_id IS NULL THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type

  FROM jun_ownership jo
  LEFT JOIN apr_labels al
    ON jo.outlet_id = al.outlet_id
  LEFT JOIN jun_gmv jg ON jo.outlet_id = jg.outlet_id
  LEFT JOIN outlet_first_dollar ofd_jun ON jo.outlet_id = ofd_jun.outlet_id
  LEFT JOIN pre_mar_ownership pmo_jun   ON jo.outlet_id = pmo_jun.outlet_id
  LEFT JOIN kam_list k_cur
    ON TRIM(jo.staff_owner) = TRIM(k_cur.kam_name)
  WHERE jo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG 3B: Mar cohort ที่ไม่อยู่ใน Jun KAM ownership
  -- silent → core_nrr_churn, มี order แต่ ≠ KAM → transfer_out
  SELECT
    '2026-06'              AS period_month,
    '2026-03'              AS base_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.account_type,
    mc.base_kam_email      AS period_kam_email,
    mc.base_tl_email       AS period_tl_email,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_staff_owner,
    mc.base_gmv,
    0                      AS curr_gmv,
    CASE
      WHEN jo.outlet_id IS NULL THEN 'core_nrr_churn'
      ELSE 'transfer_out'
    END                    AS movement_type

  FROM mar_cohort mc
  LEFT JOIN jun_ownership jo ON mc.outlet_id = jo.outlet_id
  WHERE mc.outlet_id NOT IN (
    SELECT outlet_id FROM jun_ownership
    WHERE commercial_owner = 'KAM'
  )
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
-- columns ต้องตรงกับ JS parser index ใน 02_data_pipeline.js:
-- 0:period_month 1:base_month 2:movement_type 3:period_kam_email 4:period_kam_name(NULL)
-- 5:period_tl_email 6:base_kam_email 7:base_tl_email 8:account_id 9:account_name
-- 10:account_type 11:outlet_id 12:base_gmv 13:curr_gmv 14:base_days 15:curr_days
SELECT
  r.period_month,
  r.base_month,
  r.movement_type,
  r.period_kam_email,
  NULL               AS period_kam_name,   -- portfolio level ไม่ใช้
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
  r.period_month,
  r.movement_type,
  r.curr_gmv DESC
