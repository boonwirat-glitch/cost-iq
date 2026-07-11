-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Quarter NRR Health — quarterly_nrr_2026_Q2_v8.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Design: Rep-level KAM view — grain = outlet × period_month
-- Scope:  KAM portfolio เท่านั้น (commercial_owner = 'KAM')
--
-- v8 redesign (vs v5-v7):
--   FIXED A: mar_cohort ไม่ join kam_list — capture ทุก outlet Mar KAM รวม resigned
--   FIXED B: kam_list = active 15 + Fang + May (email null) — TL mapping เท่านั้น
--   FIXED C: apr_labels ใช้ staff_owner เป็น key (ไม่ใช่ email) — รองรับ email null
--   FIXED D: LEG B transfer_out ใช้ base_kam_name (staff_owner) ไม่ใช่ email
--   FIXED E: May/Jun re-evaluate classification จาก mar_cohort โดยตรง
--            ไม่ depend on apr_labels สำหรับ movement_type
--   FIXED F: Resigned KAM outlet → transfer_out (resigned) + transfer_in ของคนใหม่
--   FIXED G: No-Owner entries (Name/Max/Snow) ไม่อยู่ใน kam_list
--
-- Movement definitions (confirmed final):
--   core_nrr       — outlet อยู่ใน mar_cohort ของ KAM คนนี้ + GMV > 0 ใน period
--   core_nrr_churn — outlet อยู่ใน mar_cohort ของ KAM คนนี้ + GMV = 0 ใน period
--   handover       — pre-KAM owner = SALE + new_user_exp_date = Mar 2026
--   new_sales      — pre-KAM owner = SALE + new_user_exp_date = Apr/May/Jun 2026
--                    หรือ first_kam_date ใน Q + pre-KAM = SALE (fallback)
--   expansion      — first_dollar_date >= 2026-04-01 (outlet ใหม่แท้)
--   comeback       — ไม่มี GMV Mar global + first_dollar < Apr + pre-Mar owner = KAM คนนี้
--   transfer_in    — outlet มาจาก KAM อื่น (รวม resigned)
--   transfer_out   — mar_cohort ของ KAM นี้ → owner เปลี่ยนใน period นั้น
--
-- NRR%:
--   denominator = base_gmv outlet ใน mar_cohort (fixed)
--   numerator   = curr_gmv ของ core_nrr + core_nrr_churn outlets
--   NRR% = numerator / denominator × 100
--
-- Reconcile target: sum ทุก KAM ควร reconcile กับ KAM portfolio view
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

-- ── 2. KAM roster — active + resigned (email null), no No-Owner/TL entries ──
-- ใช้สำหรับ TL mapping + period_kam_email เท่านั้น
-- mar_cohort ใช้ staff_owner โดยตรง (ไม่ require join ที่นี่)
kam_list AS (
  SELECT kam_name, kam_email, tl_email, tl_name FROM UNNEST([
    -- Squad A (Name / nitipat.s@freshket.co)
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    -- Resigned Squad A (email null — TL mapping only)
    STRUCT('Nutkamol (Fang) Siladam'              AS kam_name, CAST(NULL AS STRING)         AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    -- Squad B (Ploy / pavarisa.mu@freshket.co)
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Treerak (May) Sangjua'                AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    -- Resigned Squad B (email null — TL mapping only)
    STRUCT('Sojirat (May) Charoensuk'             AS kam_name, CAST(NULL AS STRING)         AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name)
  ])
),

-- ── 3. outlet_first_dollar ────────────────────────────────────────────────────
-- first_dollar_date = first order global (ทุก owner)
-- first_kam_date    = first order ที่ commercial_owner = 'KAM'
-- first_dollar_owner = owner ของ first order จริง
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MIN(o.first_dollar_date)) AS first_dollar_date,
    MIN(CASE WHEN UPPER(TRIM(o.commercial_owner)) = 'KAM'
             THEN DATE(o.delivery_date) END) AS first_kam_date,
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 4. pre_kam_owner — owner ล่าสุดก่อน first KAM order ────────────────────
-- ใช้ detect handover/new_sales (prev_owner = SALE)
pre_kam_owner AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS pre_kam_commercial_owner,
    TRIM(o.staff_owner)             AS pre_kam_staff_owner
  FROM `freshket-rn.dwh.order` o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_kam_date
  WHERE o.user_id IS NOT NULL
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 5. outlet_exp_date — max exp_date ที่ valid ──────────────────────────────
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- ── 6. GMV per outlet per month ───────────────────────────────────────────────
-- base_gmv = Mar GMV ทุก order (ไม่ filter owner)
-- curr_gmv = KAM order เท่านั้น (commercial_owner = 'KAM')
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
apr_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),

-- ── 7. Ownership snapshots per month (last KAM order per outlet) ──────────────
-- NOTE: ownership = last order ใน period นั้น (ทุก owner ไม่ filter KAM)
--       เพื่อ detect transfer_out (outlet เปลี่ยนไป non-KAM)
apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
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
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
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
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 8. mar_cohort ─────────────────────────────────────────────────────────────
-- FIXED A: ไม่ join kam_list — capture ทุก outlet Mar KAM (รวม Fang/May)
-- Criteria:
--   last Mar order commercial_owner = 'KAM' + base_gmv > 0
--   หรือ last Mar = SALE spot แต่ first_kam_date < Apr (เคยมี KAM owner ก่อน Mar)
-- Exclude: handover outlets (exp_date = Mar + pre_kam = SALE)
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.account_type,
    mo.staff_owner       AS base_kam_name,  -- staff_owner จริง (key สำหรับ transfer detection)
    COALESCE(kl.kam_email, NULL) AS base_kam_email,  -- NULL ถ้า resigned
    COALESCE(kl.tl_email, NULL)  AS base_tl_email,
    COALESCE(kl.tl_name,  NULL)  AS base_tl_name,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0)  AS base_gmv
  FROM (
    SELECT
      CAST(o.user_id AS STRING)       AS outlet_id,
      CAST(o.account_id AS STRING)    AS account_id,
      o.account_name,
      o.account_type,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
      TRIM(o.staff_owner)             AS staff_owner
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type IN ('SA','MC','Chain','Unknown')
      AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON mo.outlet_id = oed.outlet_id
  LEFT JOIN pre_kam_owner pko       ON mo.outlet_id = pko.outlet_id
  -- FIXED B: LEFT JOIN kam_list สำหรับ email/TL info เท่านั้น
  LEFT JOIN kam_list kl             ON TRIM(mo.staff_owner) = TRIM(kl.kam_name)
  WHERE (
    mo.commercial_owner = 'KAM'
    OR (
      mo.commercial_owner = 'SALE'
      AND ofd.first_kam_date IS NOT NULL
      AND ofd.first_kam_date < '2026-04-01'
    )
  )
    AND COALESCE(bg.gmv, 0) > 0
    -- Exclude handover: exp_date = Mar + pre_kam = SALE (หรือไม่มี pre_kam = outlet ใหม่ที่ KAM รับโดยตรง)
    AND NOT (
      FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
      AND COALESCE(pko.pre_kam_commercial_owner, 'SALE') = 'SALE'
    )
),

-- ── 9. Helper: effective_pre_kam_owner ───────────────────────────────────────
-- รวม logic: ถ้า first_dollar_owner = SALE → ถือว่า pre_kam = SALE
-- ไม่ต้องซ้ำใน CASE ทุกที่
-- ค่า: 'SALE' | 'KAM' | 'PM' | 'ADMIN' | NULL
effective_prev AS (
  SELECT
    ofd.outlet_id,
    COALESCE(
      CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE pko.pre_kam_commercial_owner END,
      'SALE'  -- ถ้าไม่มี pre_kam = outlet เก่าที่ไม่มี order ก่อน KAM → assume SALE
    ) AS eff_prev
  FROM outlet_first_dollar ofd
  LEFT JOIN pre_kam_owner pko ON ofd.outlet_id = pko.outlet_id
),

-- ── 10. Classification helper macro ──────────────────────────────────────────
-- ใช้กำหนด movement_type ของ outlet ที่ KAM ถือใน period นั้น
-- Input: mc.outlet_id (mar_cohort), ofd, oed, ep, curr_gmv
-- Priority:
--   [1] core        — อยู่ใน mar_cohort ของ KAM คนนี้
--   [2] expansion   — first_dollar >= Apr + first_kam >= Apr + eff_prev != SALE + ไม่มี exp_date Q
--   [3] handover    — exp_date = Mar + eff_prev = SALE
--   [4] new_sales   — exp_date ใน Q + eff_prev = SALE
--   [5] new_sales   — first_kam ใน Q + eff_prev = SALE (fallback)
--   [6] transfer_in — เคยอยู่กับ KAM อื่น (ไม่อยู่ใน mar_cohort ของคนนี้)
--   [7] comeback    — first_dollar < Apr + ไม่มี Mar GMV + eff_prev = KAM คนนี้
--   [8] transfer_in — ELSE
--
-- NOTE: macro นี้ใช้ใน LEG A ของทุกเดือน — สร้าง CTE classify_outlet ที่รับ period parameter

-- ── 11. Apr — LEG A: KAM active outlets ──────────────────────────────────────
apr_leg_a AS (
  SELECT
    '2026-04'           AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)   AS account_id,
    COALESCE(mc.account_name, ao.account_name) AS account_name,
    COALESCE(mc.account_type, ao.account_type) AS account_type,
    -- Period KAM = KAM ที่ถือ outlet ใน period นี้
    TRIM(ao.staff_owner)             AS period_kam_name,
    kl.kam_email                     AS period_kam_email,
    kl.tl_email                      AS period_tl_email,
    kl.tl_name                       AS period_tl_name,
    -- Base = Mar cohort info
    mc.base_kam_name,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_tl_name,
    COALESCE(mc.base_gmv, 0)         AS base_gmv,
    COALESCE(ag.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    ep.eff_prev,
    -- Classification
    CASE
      -- [1] core: อยู่ใน mar_cohort ของ KAM คนนี้
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) = TRIM(ao.staff_owner)
        THEN 'core'

      -- [2] expansion: outlet ใหม่แท้ใน Q
      -- first_dollar >= Apr + first_kam >= Apr + ไม่ได้มาจาก SALE + ไม่มี exp_date Q
      -- ใช้ first_dollar_owner แทน eff_prev เพราะ outlet ใหม่ไม่มี pre_kam_owner
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner, 'KAM') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'expansion'

      -- [3] handover: exp_date = Mar + eff_prev = SALE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND ep.eff_prev = 'SALE'
        THEN 'handover'

      -- [4] new_sales: exp_date ใน Q (Apr/May/Jun) + eff_prev = SALE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-04','2026-05','2026-06')
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'

      -- [5] new_sales fallback: first_kam ใน Q + eff_prev = SALE
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'

      -- [6] new_sales: first_dollar >= Apr + eff_prev = SALE + ไม่มี exp_date (Foodium case)
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
       AND oed.new_user_exp_date IS NULL
        THEN 'new_sales'

      -- [7] transfer_in จาก KAM อื่น (อยู่ใน mar_cohort แต่เป็นคน outlet เดิมของคนอื่น)
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) != TRIM(ao.staff_owner)
        THEN 'transfer_in'

      -- [8] comeback: first_dollar < Apr + ไม่มี Mar GMV + last pre-Mar KAM = KAM คนนี้
      -- (base_gmv IS NULL หมายถึง ไม่มี GMV Mar)
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND mc.outlet_id IS NULL   -- ไม่อยู่ใน mar_cohort ของใคร
        THEN 'comeback'

      -- [9] transfer_in: อื่นๆ
      ELSE 'transfer_in'
    END AS fixed_label

  FROM apr_own ao
  -- JOIN kam_list เพื่อ filter เฉพาะ active KAM (ไม่รวม resigned ที่ไม่มี active outlet)
  JOIN kam_list kl
    ON ao.commercial_owner = 'KAM'
   AND TRIM(ao.staff_owner) = TRIM(kl.kam_name)
   AND kl.kam_email IS NOT NULL  -- active KAM เท่านั้น (resigned ไม่มี outlet ใน period)
  LEFT JOIN mar_cohort mc         ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed   ON ao.outlet_id = oed.outlet_id
  LEFT JOIN effective_prev ep     ON ao.outlet_id = ep.outlet_id
  LEFT JOIN apr_gmv ag            ON ao.outlet_id = ag.outlet_id
),

-- ── 12. Apr — final rows ──────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlet ที่ KAM active ถืออยู่ใน Apr
  SELECT
    '2026-04' AS period_month,
    '2026-03' AS base_month,
    al.outlet_id,
    al.account_id,
    al.account_name,
    al.account_type,
    al.period_kam_name,
    al.period_kam_email,
    al.period_tl_email,
    al.period_tl_name,
    al.base_kam_name,
    al.base_kam_email,
    al.base_tl_email,
    al.base_tl_name,
    al.base_gmv,
    al.curr_gmv,
    CASE
      WHEN al.fixed_label = 'core'     AND al.curr_gmv > 0 THEN 'core_nrr'
      WHEN al.fixed_label = 'core'     AND al.curr_gmv = 0 THEN 'core_nrr_churn'
      WHEN al.fixed_label = 'expansion' AND al.curr_gmv > 0 THEN 'expansion'
      WHEN al.fixed_label = 'expansion' AND al.curr_gmv = 0 THEN 'transfer_in'  -- expansion ที่ไม่ซื้อ
      WHEN al.fixed_label = 'comeback'  AND al.curr_gmv > 0 THEN 'comeback'
      WHEN al.fixed_label = 'comeback'  AND al.curr_gmv = 0 THEN 'transfer_in'
      ELSE al.fixed_label
    END AS movement_type

  FROM apr_leg_a al

  UNION ALL

  -- LEG B: transfer_out — mar_cohort ของ KAM นี้ แต่ Apr owner เปลี่ยนไปคนอื่น
  -- FIXED D: เช็คด้วย base_kam_name (staff_owner) ไม่ใช่ email
  -- ครอบคลุม: resigned KAM outlet ที่ถ่ายโอนไป active KAM คนใหม่
  SELECT
    '2026-04', '2026-03',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name  AS period_kam_name,
    mc.base_kam_email AS period_kam_email,
    mc.base_tl_email  AS period_tl_email,
    mc.base_tl_name   AS period_tl_name,
    mc.base_kam_name,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_tl_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'transfer_out'    AS movement_type

  FROM mar_cohort mc
  JOIN apr_own ao ON mc.outlet_id = ao.outlet_id
  WHERE
    -- Apr owner เป็น KAM แต่ไม่ใช่คนเดิม
    (
      ao.commercial_owner = 'KAM'
      AND TRIM(ao.staff_owner) != TRIM(mc.base_kam_name)
      -- และ KAM เดิมไม่มี order ใน Apr (ถ้า outlet มี 2 KAM order พร้อมกัน ไม่นับ transfer)
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.apr_start AND p.apr_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )
    OR
    -- Apr owner เปลี่ยนไป non-KAM (PM/ADMIN/SALE)
    (
      ao.commercial_owner IN ('PM','ADMIN','SALE')
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.apr_start AND p.apr_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )

  UNION ALL

  -- LEG C: silent outlets — mar_cohort ที่ไม่มี order เลยใน Apr
  -- FIXED E: ทุก silent outlet = core_nrr_churn (ไม่มี dim.user_master)
  SELECT
    '2026-04', '2026-03',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name  AS period_kam_name,
    mc.base_kam_email AS period_kam_email,
    mc.base_tl_email  AS period_tl_email,
    mc.base_tl_name   AS period_tl_name,
    mc.base_kam_name,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_tl_name,
    mc.base_gmv,
    0                 AS curr_gmv,
    'core_nrr_churn'  AS movement_type

  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM apr_own)
),

-- ── 13. May — LEG A ───────────────────────────────────────────────────────────
-- FIXED E: ไม่ depend apr_labels — re-classify จาก mar_cohort โดยตรง
may_leg_a AS (
  SELECT
    '2026-05'                                   AS period_month,
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id)      AS account_id,
    COALESCE(mc.account_name, mo.account_name)  AS account_name,
    COALESCE(mc.account_type, mo.account_type)  AS account_type,
    TRIM(mo.staff_owner)                         AS period_kam_name,
    kl.kam_email                                 AS period_kam_email,
    kl.tl_email                                  AS period_tl_email,
    kl.tl_name                                   AS period_tl_name,
    mc.base_kam_name,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_tl_name,
    COALESCE(mc.base_gmv, 0)                    AS base_gmv,
    COALESCE(mg.gmv, 0)                         AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    ep.eff_prev,
    CASE
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) = TRIM(mo.staff_owner)
        THEN 'core'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner, 'KAM') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND ep.eff_prev = 'SALE'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-04','2026-05','2026-06')
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
       AND oed.new_user_exp_date IS NULL
        THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) != TRIM(mo.staff_owner)
        THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND mc.outlet_id IS NULL
        THEN 'comeback'
      ELSE 'transfer_in'
    END AS fixed_label

  FROM may_own mo
  JOIN kam_list kl
    ON mo.commercial_owner = 'KAM'
   AND TRIM(mo.staff_owner) = TRIM(kl.kam_name)
   AND kl.kam_email IS NOT NULL
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON mo.outlet_id = oed.outlet_id
  LEFT JOIN effective_prev ep       ON mo.outlet_id = ep.outlet_id
  LEFT JOIN may_gmv mg              ON mo.outlet_id = mg.outlet_id
),

may_rows AS (
  SELECT
    '2026-05', '2026-03',
    ml.outlet_id, ml.account_id, ml.account_name, ml.account_type,
    ml.period_kam_name, ml.period_kam_email, ml.period_tl_email, ml.period_tl_name,
    ml.base_kam_name, ml.base_kam_email, ml.base_tl_email, ml.base_tl_name,
    ml.base_gmv, ml.curr_gmv,
    CASE
      WHEN ml.fixed_label = 'core'      AND ml.curr_gmv > 0 THEN 'core_nrr'
      WHEN ml.fixed_label = 'core'      AND ml.curr_gmv = 0 THEN 'core_nrr_churn'
      WHEN ml.fixed_label = 'expansion' AND ml.curr_gmv > 0 THEN 'expansion'
      WHEN ml.fixed_label = 'expansion' AND ml.curr_gmv = 0 THEN 'transfer_in'
      WHEN ml.fixed_label = 'comeback'  AND ml.curr_gmv > 0 THEN 'comeback'
      WHEN ml.fixed_label = 'comeback'  AND ml.curr_gmv = 0 THEN 'transfer_in'
      ELSE ml.fixed_label
    END AS movement_type
  FROM may_leg_a ml

  UNION ALL

  SELECT
    '2026-05', '2026-03',
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_gmv, 0, 'transfer_out'
  FROM mar_cohort mc
  JOIN may_own mo ON mc.outlet_id = mo.outlet_id
  WHERE
    (
      mo.commercial_owner = 'KAM'
      AND TRIM(mo.staff_owner) != TRIM(mc.base_kam_name)
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.may_start AND p.may_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )
    OR
    (
      mo.commercial_owner IN ('PM','ADMIN','SALE')
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.may_start AND p.may_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )

  UNION ALL

  SELECT
    '2026-05', '2026-03',
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_gmv, 0, 'core_nrr_churn'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM may_own)
),

-- ── 14. Jun — LEG A ───────────────────────────────────────────────────────────
jun_leg_a AS (
  SELECT
    '2026-06'                                   AS period_month,
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id)      AS account_id,
    COALESCE(mc.account_name, jo.account_name)  AS account_name,
    COALESCE(mc.account_type, jo.account_type)  AS account_type,
    TRIM(jo.staff_owner)                         AS period_kam_name,
    kl.kam_email                                 AS period_kam_email,
    kl.tl_email                                  AS period_tl_email,
    kl.tl_name                                   AS period_tl_name,
    mc.base_kam_name,
    mc.base_kam_email,
    mc.base_tl_email,
    mc.base_tl_name,
    COALESCE(mc.base_gmv, 0)                    AS base_gmv,
    COALESCE(jg.gmv, 0)                         AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    ep.eff_prev,
    CASE
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) = TRIM(jo.staff_owner)
        THEN 'core'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner, 'KAM') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))
        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND ep.eff_prev = 'SALE'
        THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-04','2026-05','2026-06')
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
        THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ep.eff_prev = 'SALE'
       AND oed.new_user_exp_date IS NULL
        THEN 'new_sales'
      WHEN mc.outlet_id IS NOT NULL
       AND TRIM(mc.base_kam_name) != TRIM(jo.staff_owner)
        THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND mc.outlet_id IS NULL
        THEN 'comeback'
      ELSE 'transfer_in'
    END AS fixed_label

  FROM jun_own jo
  JOIN kam_list kl
    ON jo.commercial_owner = 'KAM'
   AND TRIM(jo.staff_owner) = TRIM(kl.kam_name)
   AND kl.kam_email IS NOT NULL
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON jo.outlet_id = oed.outlet_id
  LEFT JOIN effective_prev ep       ON jo.outlet_id = ep.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
),

jun_rows AS (
  SELECT
    '2026-06', '2026-03',
    jl.outlet_id, jl.account_id, jl.account_name, jl.account_type,
    jl.period_kam_name, jl.period_kam_email, jl.period_tl_email, jl.period_tl_name,
    jl.base_kam_name, jl.base_kam_email, jl.base_tl_email, jl.base_tl_name,
    jl.base_gmv, jl.curr_gmv,
    CASE
      WHEN jl.fixed_label = 'core'      AND jl.curr_gmv > 0 THEN 'core_nrr'
      WHEN jl.fixed_label = 'core'      AND jl.curr_gmv = 0 THEN 'core_nrr_churn'
      WHEN jl.fixed_label = 'expansion' AND jl.curr_gmv > 0 THEN 'expansion'
      WHEN jl.fixed_label = 'expansion' AND jl.curr_gmv = 0 THEN 'transfer_in'
      WHEN jl.fixed_label = 'comeback'  AND jl.curr_gmv > 0 THEN 'comeback'
      WHEN jl.fixed_label = 'comeback'  AND jl.curr_gmv = 0 THEN 'transfer_in'
      ELSE jl.fixed_label
    END AS movement_type
  FROM jun_leg_a jl

  UNION ALL

  SELECT
    '2026-06', '2026-03',
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_gmv, 0, 'transfer_out'
  FROM mar_cohort mc
  JOIN jun_own jo ON mc.outlet_id = jo.outlet_id
  WHERE
    (
      jo.commercial_owner = 'KAM'
      AND TRIM(jo.staff_owner) != TRIM(mc.base_kam_name)
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.jun_start AND p.jun_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )
    OR
    (
      jo.commercial_owner IN ('PM','ADMIN','SALE')
      AND NOT EXISTS (
        SELECT 1 FROM `freshket-rn.dwh.order` o2
        CROSS JOIN params p
        WHERE CAST(o2.user_id AS STRING) = mc.outlet_id
          AND DATE(o2.delivery_date) BETWEEN p.jun_start AND p.jun_end
          AND UPPER(TRIM(o2.commercial_owner)) = 'KAM'
          AND TRIM(o2.staff_owner) = TRIM(mc.base_kam_name)
          AND o2.account_type IN ('SA','MC','Chain','Unknown')
      )
    )

  UNION ALL

  SELECT
    '2026-06', '2026-03',
    mc.outlet_id, mc.account_id, mc.account_name, mc.account_type,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_kam_name, mc.base_kam_email, mc.base_tl_email, mc.base_tl_name,
    mc.base_gmv, 0, 'core_nrr_churn'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jun_own)
),

-- ── 15. Union all months ──────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL
  SELECT * FROM may_rows
  UNION ALL
  SELECT * FROM jun_rows
)

-- ── FINAL SELECT ──────────────────────────────────────────────────────────────
SELECT
  r.period_month,
  r.base_month,
  r.movement_type,
  r.period_kam_name,
  r.period_kam_email,
  r.period_tl_email,
  r.period_tl_name,
  r.base_kam_name,
  r.base_kam_email,
  r.base_tl_email,
  r.base_tl_name,
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

