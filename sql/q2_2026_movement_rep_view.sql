-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Movement — KAM Rep View (v2)
-- sql/q2_2026_movement_rep_view.sql
--
-- Goal: ดู health ของ KAM แต่ละคน — วัดจากลูกค้าที่อยู่ในมือตอนนี้
--
-- ต่างจาก TL/KAM portfolio view:
--   LEG B ตรวจ staff_owner เปลี่ยนจาก Mar ไหม (ไม่ใช่แค่ NOT EXISTS KAM order)
--   → internal transfer (Foam→May) จะขึ้นเป็น transfer_out + transfer_in
--
-- Reconcile:
--   GROUP BY base_staff_owner → ต้องตรงกับ KAM portfolio view
--   (ยกเว้น internal transfer ที่ split ออก — expected diff)
--
-- mar_cohort: Mar last order = 'KAM' + base_gmv > 0 + ไม่ใช่ handover
--   ไม่ hardcode ชื่อ KAM — ดูจาก staff_owner ใน data โดยตรง
--
-- staff_email_map: ใช้แค่ท้าย final SELECT เพื่อ map email/tl
--   ไม่ได้ใช้ filter mar_cohort
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Email/TL map — final SELECT เท่านั้น ──────────────────────────────────
staff_email_map AS (
  SELECT kam_name, kam_email, tl_email, tl_name FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Treerak (May) Sangjua'                AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name),
    STRUCT('Nutkamol (Fang) Siladam'              AS kam_name, CAST(NULL AS STRING)         AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'Name' AS tl_name),
    STRUCT('Sojirat (May) Charoensuk'             AS kam_name, CAST(NULL AS STRING)         AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name)
  ])
),

-- ── 2. Date anchors ──────────────────────────────────────────────────────────
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

-- ── 3. First order info per outlet ───────────────────────────────────────────
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

-- ── 4. Last owner ก่อน first KAM order (handover/new_sales detection) ────────
outlet_prev_owner AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
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

-- ── 5. exp_date per outlet ────────────────────────────────────────────────────
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING)  AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- ── 6. GMV per outlet per month ───────────────────────────────────────────────
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
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
may_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
jun_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),

-- ── 7. Last order per outlet per month (ownership snapshot) ──────────────────
mar_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.cdp_account_name              AS account_name,
    o.cdp_res_name                  AS res_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
apr_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.cdp_account_name              AS account_name,
    o.cdp_res_name                  AS res_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.apr_start AND p.apr_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.cdp_account_name              AS account_name,
    o.cdp_res_name                  AS res_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.may_start AND p.may_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jun_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.cdp_account_name              AS account_name,
    o.cdp_res_name                  AS res_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jun_start AND p.jun_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 8. Handover outlets — exclude จาก mar_cohort ─────────────────────────────
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

-- ── 9. mar_cohort ─────────────────────────────────────────────────────────────
-- ดูจาก Mar last order โดยตรง ไม่ hardcode ชื่อ KAM
-- base_staff_owner = staff_owner ใน Mar order → denominator ของ KAM คนนั้น
mar_cohort AS (
  SELECT
    mo.outlet_id,
    mo.account_id,
    mo.account_name,
    mo.res_name,
    mo.account_type,
    mo.staff_owner   AS base_staff_owner,  -- KAM ที่ดูแลใน Mar
    ofd.first_dollar_date,
    ofd.first_kam_date,
    ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE mo.commercial_owner = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── 10. SALE staff ใน Mar (สำหรับ base_staff_owner ของ handover/new_sales) ────
mar_sale_owner AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS sale_staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 11. PM/ADMIN mar cohort (transfer_in detection) ───────────────────────────
pm_admin_mar_cohort AS (
  SELECT mo.outlet_id, mo.commercial_owner AS mar_portfolio
  FROM mar_own mo
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    mo.commercial_owner IN ('PM','ADMIN')
    OR (
      mo.commercial_owner = 'SALE'
      AND ofd.first_kam_date IS NOT NULL
      AND ofd.first_kam_date < '2026-04-01'
      AND UPPER(TRIM(ofd.first_dollar_owner)) IN ('PM','ADMIN')
    )
  )
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_cohort)
),

-- ── 12. Classification macro ──────────────────────────────────────────────────
-- ใช้ใน LEG A ทุกเดือน — priority ตาม spec v7
-- effective_prev = COALESCE(first_dollar_owner=SALE → SALE, prev_owner, SALE)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 13. Apr ──────────────────────────────────────────────────────────────────
apr_rows AS (

  -- LEG A: outlet ที่ period staff_owner = KAM คนนั้น (ถือออเดอร์ใน Apr)
  SELECT
    '2026-04'   AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)     AS account_id,
    COALESCE(mc.account_name, ao.account_name) AS account_name,
    COALESCE(mc.res_name, ao.res_name)         AS res_name,
    COALESCE(mc.account_type, ao.account_type) AS account_type,
    ao.staff_owner                             AS current_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-03','2026-04','2026-05','2026-06')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN 'SALE'
      ELSE COALESCE(mc.base_staff_owner, ao.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM apr_own ao
  LEFT JOIN mar_cohort mc           ON ao.outlet_id = mc.outlet_id
                                   AND mc.base_staff_owner = ao.staff_owner
  LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po    ON ao.outlet_id = po.outlet_id
  LEFT JOIN apr_gmv ag              ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_sale_owner mso      ON ao.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg             ON ao.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON ao.outlet_id = pamc.outlet_id
  WHERE ao.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B: mar_cohort ของ KAM คนนี้ แต่ Apr staff_owner เปลี่ยนไปแล้ว
  -- KEY DIFF vs TL view: ตรวจ staff_owner เปลี่ยน ไม่ใช่แค่ NOT EXISTS KAM
  -- ครอบคลุม: ย้ายไป KAM อื่น, ย้ายไป PM/ADMIN, ไม่มี order เลยใน Apr
  SELECT
    '2026-04',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(ao.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_staff_owner,
    mc.base_gmv, 0.0,
    mc.first_dollar_date, mc.first_kam_date, NULL AS new_user_exp_date,
    CASE
      WHEN ao.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN ao.commercial_owner = 'SALE'          THEN 'transfer_out'
      WHEN ao.commercial_owner = 'KAM'
       AND ao.staff_owner != mc.base_staff_owner  THEN 'transfer_out'
      ELSE 'core_nrr'  -- ไม่มี order เลยใน Apr (silent) → core_nrr curr=0
    END AS movement_type
  FROM mar_cohort mc
  LEFT JOIN apr_own ao ON mc.outlet_id = ao.outlet_id
  -- เอาเฉพาะ outlet ที่ base_staff_owner ไม่ได้ถือใน Apr อีกแล้ว
  WHERE NOT (ao.commercial_owner = 'KAM' AND ao.staff_owner = mc.base_staff_owner)
),

-- ── 14. May ──────────────────────────────────────────────────────────────────
may_rows AS (

  -- LEG A
  SELECT
    '2026-05',
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id)     AS account_id,
    COALESCE(mc.account_name, mo.account_name) AS account_name,
    COALESCE(mc.res_name, mo.res_name)         AS res_name,
    COALESCE(mc.account_type, mo.account_type) AS account_type,
    mo.staff_owner                             AS current_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-03','2026-04','2026-05','2026-06')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN 'SALE'
      ELSE COALESCE(mc.base_staff_owner, mo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM may_own mo
  LEFT JOIN mar_cohort mc           ON mo.outlet_id = mc.outlet_id
                                   AND mc.base_staff_owner = mo.staff_owner
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po    ON mo.outlet_id = po.outlet_id
  LEFT JOIN may_gmv mg              ON mo.outlet_id = mg.outlet_id
  LEFT JOIN mar_sale_owner mso      ON mo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON mo.outlet_id = pamc.outlet_id
  WHERE mo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B
  SELECT
    '2026-05',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(mo.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_staff_owner,
    mc.base_gmv, 0.0,
    mc.first_dollar_date, mc.first_kam_date, NULL,
    CASE
      WHEN mo.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN mo.commercial_owner = 'SALE'          THEN 'transfer_out'
      WHEN mo.commercial_owner = 'KAM'
       AND mo.staff_owner != mc.base_staff_owner  THEN 'transfer_out'
      ELSE 'core_nrr'
    END
  FROM mar_cohort mc
  LEFT JOIN may_own mo ON mc.outlet_id = mo.outlet_id
  WHERE NOT (mo.commercial_owner = 'KAM' AND mo.staff_owner = mc.base_staff_owner)
),

-- ── 15. Jun ──────────────────────────────────────────────────────────────────
jun_rows AS (

  -- LEG A
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id)     AS account_id,
    COALESCE(mc.account_name, jo.account_name) AS account_name,
    COALESCE(mc.res_name, jo.res_name)         AS res_name,
    COALESCE(mc.account_type, jo.account_type) AS account_type,
    jo.staff_owner                             AS current_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-03','2026-04','2026-05','2026-06')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN 'SALE'
      ELSE COALESCE(mc.base_staff_owner, jo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND ofd.first_kam_date    >= '2026-04-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-04','2026-05','2026-06')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-04-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-03','2026-04','2026-05','2026-06'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-04-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-04-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM jun_own jo
  LEFT JOIN mar_cohort mc           ON jo.outlet_id = mc.outlet_id
                                   AND mc.base_staff_owner = jo.staff_owner
  LEFT JOIN outlet_first_dollar ofd ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed     ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po    ON jo.outlet_id = po.outlet_id
  LEFT JOIN jun_gmv jg              ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_sale_owner mso      ON jo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg             ON jo.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON jo.outlet_id = pamc.outlet_id
  WHERE jo.commercial_owner = 'KAM'

  UNION ALL

  -- LEG B
  SELECT
    '2026-06',
    mc.outlet_id,
    mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(jo.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_staff_owner,
    mc.base_gmv, 0.0,
    mc.first_dollar_date, mc.first_kam_date, NULL,
    CASE
      WHEN jo.commercial_owner IN ('PM','ADMIN') THEN 'transfer_out'
      WHEN jo.commercial_owner = 'SALE'          THEN 'transfer_out'
      WHEN jo.commercial_owner = 'KAM'
       AND jo.staff_owner != mc.base_staff_owner  THEN 'transfer_out'
      ELSE 'core_nrr'
    END
  FROM mar_cohort mc
  LEFT JOIN jun_own jo ON mc.outlet_id = jo.outlet_id
  WHERE NOT (jo.commercial_owner = 'KAM' AND jo.staff_owner = mc.base_staff_owner)
),

-- ── 16. Union ────────────────────────────────────────────────────────────────
all_rows AS (
  SELECT * FROM apr_rows
  UNION ALL SELECT * FROM may_rows
  UNION ALL SELECT * FROM jun_rows
)

-- ── FINAL SELECT ──────────────────────────────────────────────────────────────
SELECT
  r.period_month,
  r.movement_type,
  r.current_staff_owner,
  r.base_staff_owner,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.res_name,
  r.account_type,
  ROUND(r.curr_gmv, 0) AS curr_gmv,
  ROUND(r.base_gmv, 0) AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-04' THEN p.apr_days
    WHEN '2026-05' THEN p.may_days
    WHEN '2026-06' THEN p.jun_days
  END                  AS curr_days,
  r.first_dollar_date,
  r.first_kam_date     AS first_portfolio_date,
  r.new_user_exp_date,
  em_base.tl_name      AS base_tl,
  em_curr.tl_name      AS current_tl,
  COALESCE(
    CASE WHEN r.movement_type IN ('handover','new_sales')
         THEN em_curr.tl_name ELSE em_base.tl_name END,
    em_curr.tl_name
  )                    AS tl_pivot,
  em_base.kam_email    AS base_kam_email,
  em_base.tl_email     AS base_tl_email,
  em_curr.kam_email    AS current_kam_email,
  em_curr.tl_email     AS current_tl_email

FROM all_rows r
CROSS JOIN params p
LEFT JOIN staff_email_map em_base ON r.base_staff_owner    = em_base.kam_name
LEFT JOIN staff_email_map em_curr ON r.current_staff_owner = em_curr.kam_name

ORDER BY
  r.period_month,
  em_base.tl_name,
  r.base_staff_owner,
  r.movement_type,
  r.curr_gmv DESC
