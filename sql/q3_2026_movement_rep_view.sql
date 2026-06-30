-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Movement — KAM Rep View (v3)
-- sql/q2_2026_movement_rep_view.sql
--
-- Goal: ดู performance ของ KAM แต่ละคน วัดจาก outlet ที่ถืออยู่ล่าสุด
--
-- Design:
--   grain     = outlet × period_month × latest_staff_owner
--   base_gmv  = Mar GMV ของ outlet — ติดกับ latest_staff_owner
--   curr_gmv  = GMV จริงรายเดือน
--   movement  = classification ตาม TL view (ไม่เปลี่ยน logic)
--
--   Fang ส่ง outlet ให้ Nitcha → outlet ทั้งหมดขึ้นใน Nitcha ไม่ใช่ Fang
--   Fang ออกไปแล้ว → ไม่มีใน output
--
-- Reconcile:
--   GROUP BY latest_staff_owner → base_gmv รวมต้องไม่ซ้ำซ้อน
--   curr_gmv รวมทุก KAM ต้องตรงกับ TL view
-- ════════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Email/TL map ───────────────────────────────────────────────────────────
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
    DATE('2026-06-01') AS base_start, DATE('2026-06-30') AS base_end, 30 AS base_days,
    DATE('2026-07-01') AS jul_start,  DATE('2026-07-31') AS jul_end,  31 AS jul_days,
    DATE('2026-08-01') AS aug_start,  DATE('2026-08-31') AS aug_end,  31 AS aug_days,
    DATE('2026-09-01') AS sep_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS sep_end,
    DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY),
              DATE('2026-09-01'), DAY) + 1 AS sep_days
),

-- current account_type จาก dim.user_master (สถานะล่าสุด ณ วันที่ query)
-- ใช้แทน r.account_type ที่มาจาก per-period order snapshot ซึ่งไม่ consistent
user_account_type AS (
  SELECT
    CAST(res_id AS STRING) AS outlet_id,
    account_type
  FROM `freshket-rn.dim.user_master`
),

-- ── 3. Latest staff owner (ณ วันที่ดึงข้อมูล) ───────────────────────────────
-- Key column สำหรับ grain ของ rep view
-- outlet ทุกตัว assigned ให้ KAM คนนี้คนเดียว ไม่ซ้ำซ้อน
latest_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS latest_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS latest_commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4. First order info per outlet ───────────────────────────────────────────
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

-- ── 5. Last owner ก่อน first KAM order ──────────────────────────────────────
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

-- ── 6. Exp date ──────────────────────────────────────────────────────────────
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- ── 7. GMV per outlet per month ───────────────────────────────────────────────
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
jul_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jul_start AND p.jul_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
aug_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.aug_start AND p.aug_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),
sep_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.sep_start AND p.sep_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),

-- ── 8. Ownership snapshots per month ─────────────────────────────────────────
mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jul_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jul_start AND p.jul_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
aug_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.aug_start AND p.aug_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
sep_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.sep_start AND p.sep_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 9. Handover outlets — exclude จาก mar_cohort ─────────────────────────────
mar_handover_outlets AS (
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed  ON ofd.outlet_id = oed.outlet_id
  JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-06'
    AND po.prev_owner = 'SALE'
  UNION DISTINCT
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed ON ofd.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-06'
    AND po.outlet_id IS NULL
),

-- ── 10. mar_cohort ────────────────────────────────────────────────────────────
-- ไม่ hardcode ชื่อ KAM — capture ทุก outlet ที่ Mar last = KAM
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.staff_owner AS mar_staff_owner,
    ofd.first_dollar_date, ofd.first_kam_date, ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE UPPER(TRIM(mo.commercial_owner)) = 'KAM'
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── 11. SALE staff ใน Mar ─────────────────────────────────────────────────────
mar_sale_owner AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, TRIM(o.staff_owner) AS sale_staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 11b. PM/ADMIN staff ใน Mar ───────────────────────────────────────────────
-- ใช้แสดง base_staff_owner ของ transfer_in จาก PM/ADMIN
mar_pm_admin_staff AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS mar_portfolio,
    TRIM(o.staff_owner)             AS mar_staff
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) IN ('PM','ADMIN')
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 12. PM/ADMIN mar cohort ───────────────────────────────────────────────────
pm_admin_mar_cohort AS (
  SELECT mo.outlet_id, mo.commercial_owner AS mar_portfolio
  FROM mar_own mo
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    mo.commercial_owner IN ('PM','ADMIN')
    OR (
      UPPER(TRIM(mo.commercial_owner)) = 'SALE'
      AND ofd.first_kam_date IS NOT NULL
      AND ofd.first_kam_date < '2026-07-01'
      AND UPPER(TRIM(ofd.first_dollar_owner)) IN ('PM','ADMIN')
    )
  )
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_cohort)
),

-- ── 13. Classification per outlet per month ───────────────────────────────────
-- เหมือน TL view ทุกอย่าง — ไม่เปลี่ยน logic
-- KEY: ไม่ join mar_cohort ด้วย staff_owner
--      → outlet ที่ย้าย KAM ยังได้ core_nrr (เหมือน TL view)
--      base_staff_owner และ latest_staff_owner จะต่างกันสำหรับ outlet ที่ย้าย

apr_classified AS (
  SELECT
    '2026-07' AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)     AS account_id,
    COALESCE(mc.account_name, ao.account_name) AS account_name,
    COALESCE(mc.res_name, ao.res_name)         AS res_name,
    COALESCE(mc.account_type, ao.account_type) AS account_type,
    ao.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-06','2026-07','2026-08','2026-09')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, ao.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_kam_date,
    oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-06'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-06','2026-07','2026-08','2026-09')
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND ofd.first_kam_date    >= '2026-07-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-06'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-07-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM jul_own ao
  LEFT JOIN mar_cohort mc            ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON ao.outlet_id = po.outlet_id
  LEFT JOIN jul_gmv ag               ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_sale_owner mso       ON ao.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON ao.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON ao.outlet_id = pamc.outlet_id
  LEFT JOIN mar_pm_admin_staff mpas  ON ao.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(ao.commercial_owner)) = 'KAM'

  UNION ALL

  -- Silent outlets (ไม่มี order ใน Apr)
  SELECT
    '2026-04', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner AS period_staff_owner,
    mc.mar_staff_owner AS base_staff_owner,
    mc.base_gmv, 0.0,
    mc.first_dollar_date, mc.first_kam_date, CAST(NULL AS DATE) AS new_user_exp_date,
    CAST(NULL AS STRING) AS first_dollar_owner, '2026-03' AS cohort_month, CAST(NULL AS STRING) AS transfer_scope,
    CAST(NULL AS STRING) AS mar_portfolio,
    'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jul_own)
),

may_classified AS (
  SELECT
    '2026-08',
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id)     AS account_id,
    COALESCE(mc.account_name, mo.account_name) AS account_name,
    COALESCE(mc.res_name, mo.res_name)         AS res_name,
    COALESCE(mc.account_type, mo.account_type) AS account_type,
    mo.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-06','2026-07','2026-08','2026-09')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, mo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date, ofd.first_kam_date, oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-06'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-06','2026-07','2026-08','2026-09')
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND ofd.first_kam_date    >= '2026-07-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-06'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-07-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM aug_own mo
  LEFT JOIN mar_cohort mc            ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON mo.outlet_id = po.outlet_id
  LEFT JOIN aug_gmv mg               ON mo.outlet_id = mg.outlet_id
  LEFT JOIN mar_sale_owner mso       ON mo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON mo.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON mo.outlet_id = pamc.outlet_id
  LEFT JOIN mar_pm_admin_staff mpas  ON mo.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(mo.commercial_owner)) = 'KAM'

  UNION ALL

  SELECT
    '2026-05', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner, mc.mar_staff_owner,
    mc.base_gmv, 0.0, mc.first_dollar_date, mc.first_kam_date, CAST(NULL AS DATE),
    CAST(NULL AS STRING), '2026-03', CAST(NULL AS STRING), CAST(NULL AS STRING), 'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM aug_own)
),

jun_classified AS (
  SELECT
    '2026-06',
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id)     AS account_id,
    COALESCE(mc.account_name, jo.account_name) AS account_name,
    COALESCE(mc.res_name, jo.res_name)         AS res_name,
    COALESCE(mc.account_type, jo.account_type) AS account_type,
    jo.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-06','2026-07','2026-08','2026-09')
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, jo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date, ofd.first_kam_date, oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN '2026-06'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN ('2026-06','2026-07','2026-08','2026-09')
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_kam_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_kam_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND ofd.first_kam_date    >= '2026-07-01'
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-06'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN ('2026-07','2026-08','2026-09')                             THEN 'new_sales'
      WHEN ofd.first_kam_date >= '2026-07-01'
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN ('2026-06','2026-07','2026-08','2026-09'))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= '2026-07-01'
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < '2026-07-01'
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM sep_own jo
  LEFT JOIN mar_cohort mc            ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON jo.outlet_id = po.outlet_id
  LEFT JOIN sep_gmv jg               ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_sale_owner mso       ON jo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON jo.outlet_id = bg.outlet_id
  LEFT JOIN pm_admin_mar_cohort pamc ON jo.outlet_id = pamc.outlet_id
  LEFT JOIN mar_pm_admin_staff mpas  ON jo.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(jo.commercial_owner)) = 'KAM'

  UNION ALL

  SELECT
    '2026-06', mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner, mc.mar_staff_owner,
    mc.base_gmv, 0.0, mc.first_dollar_date, mc.first_kam_date, CAST(NULL AS DATE),
    CAST(NULL AS STRING), '2026-03', CAST(NULL AS STRING), CAST(NULL AS STRING), 'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM sep_own)
),


-- ── transfer_out_rows ─────────────────────────────────────────────────────────
-- outlet ที่ Mar staff = KAM X แต่ latest_staff ≠ KAM X
-- ขึ้นใน output ของ KAM เดิม (Mar staff) เป็น transfer_out
-- curr_gmv = 0, base_gmv = Mar GMV → adjust denominator ของ KAM เดิม
transfer_out_rows AS (
  SELECT
    period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.res_name,
    mc.account_type,
    mc.mar_staff_owner              AS period_staff_owner,
    mc.mar_staff_owner              AS base_staff_owner,
    mc.base_gmv,
    0.0                             AS curr_gmv,
    mc.first_dollar_date,
    mc.first_kam_date,
    CAST(NULL AS DATE)              AS new_user_exp_date,
    CAST(NULL AS STRING)            AS first_dollar_owner,
    '2026-03'                       AS cohort_month,
    CAST(NULL AS STRING)            AS transfer_scope,
    CAST(NULL AS STRING)            AS mar_portfolio,
    'transfer_out'         AS movement_type
  FROM mar_cohort mc
  JOIN latest_own lo ON mc.outlet_id = lo.outlet_id
  CROSS JOIN UNNEST(['2026-04','2026-05','2026-06']) AS period_month
  -- เฉพาะ outlet ที่ latest_staff ≠ Mar staff
  WHERE lo.latest_commercial_owner != 'KAM'
),

all_classified AS (
  SELECT * FROM apr_classified
  UNION ALL SELECT * FROM may_classified
  UNION ALL SELECT * FROM jun_classified
  UNION ALL SELECT * FROM transfer_out_rows
)

-- ── FINAL SELECT ──────────────────────────────────────────────────────────────
-- ใช้ latest_staff_owner เป็น grain หลัก
-- base_gmv ติดกับ latest_staff_owner — ไม่ซ้ำซ้อน
SELECT
  r.period_month,
  r.movement_type,
  r.transfer_scope,
  lo.latest_commercial_owner        AS current_portfolio,
  r.period_staff_owner               AS current_staff_owner,
  COALESCE(r.mar_portfolio, 'KAM')  AS base_portfolio,
  r.base_staff_owner,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.res_name,
  COALESCE(um.account_type, r.account_type) AS account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0)              AS curr_gmv,
  ROUND(r.base_gmv, 0)              AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN '2026-07' THEN p.jul_days
    WHEN '2026-08' THEN p.aug_days
    WHEN '2026-09' THEN p.sep_days
  END                               AS curr_days,
  ofd2.first_dollar_date,
  ofd2.first_kam_date               AS first_portfolio_date,
  ofd2.first_dollar_owner,
  oed2.new_user_exp_date,
  -- rep-specific columns ต่อท้าย
  em_latest.tl_name                 AS latest_tl,
  em_base.tl_name                   AS base_tl,
  lo.latest_staff_owner,
  lo.latest_commercial_owner,
  em_latest.kam_email               AS latest_kam_email,
  em_latest.tl_email                AS latest_tl_email,
  em_base.kam_email                 AS base_kam_email,
  em_base.tl_email                  AS base_tl_email

FROM all_classified r
CROSS JOIN params p
JOIN latest_own lo                  ON r.outlet_id            = lo.outlet_id
LEFT JOIN staff_email_map em_latest ON lo.latest_staff_owner  = em_latest.kam_name
LEFT JOIN staff_email_map em_base   ON r.base_staff_owner     = em_base.kam_name
LEFT JOIN outlet_first_dollar ofd2  ON r.outlet_id            = ofd2.outlet_id
LEFT JOIN outlet_exp_date oed2      ON r.outlet_id            = oed2.outlet_id
LEFT JOIN user_account_type um       ON r.outlet_id            = um.outlet_id
-- filter เฉพาะ outlet ที่ latest owner เป็น KAM
-- (ออก PM/ADMIN/SALE/resigned ออกจาก output อัตโนมัติ)
WHERE lo.latest_commercial_owner = 'KAM'
   OR r.movement_type = 'transfer_out'

ORDER BY
  r.period_month,
  em_latest.tl_name,
  lo.latest_staff_owner,
  r.movement_type,
  r.curr_gmv DESC

