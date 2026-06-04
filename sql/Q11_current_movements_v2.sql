-- ============================================================
-- Q11 v2 — Current Month Movements (Portview source)
-- ============================================================
-- Purpose : portview_current_movements.csv
-- Grain   :
--   new_sales   = outlet level (Q10 logic ชี้ perf_month)
--   transfer_in = account level (Apr commercial_owner ≠ SALE → May KAM ใหม่)
--   transfer_out= account level (aggregated from outlet grain, baseline_gmv = sum across all outlets)
--
-- Source of truth: commercial_owner + staff_owner จาก dwh.order
-- ka_owner / sales_owner เป็นข้อมูลเสริมเท่านั้น
-- ============================================================

WITH

params AS (
  SELECT
    -- lag_date: day-1 anchor (data pipeline lag = 1 day always)
    -- ensures month boundary (e.g. Jun 1) sees May as perf_month, not empty June
    DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)                                AS lag_date,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)             AS perf_start,
    DATE_SUB(DATE_TRUNC(DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH), INTERVAL 1 DAY)
                                                                             AS perf_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))          AS perf_label,
    DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH)
                                                                             AS prev_start,
    DATE_SUB(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), INTERVAL 1 DAY)
                                                                             AS prev_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH))
                                                                             AS prev_label,
    DATE_DIFF(
      DATE_TRUNC(DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH),
      DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), DAY
    )                                                                        AS perf_days_in_month,
    DATE_DIFF(
      DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH),
      DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH), DAY
    )                                                                        AS prev_days_in_month,
    DATE_DIFF(
      COALESCE(
        (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
         WHERE delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)),
        DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      ),
      DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), DAY
    ) + 1                                                                    AS days_elapsed
),

kam_name_list AS (
  SELECT kam_name FROM UNNEST([
    'Anusorn (Bookbig) Khamphasuk','Chaklid (Dent) Nimraor',
    'Duangruedee (Ning) Bulalom','Guntinun (Monet) Thanoochan',
    'Intuon (Jane) Yanakit','Napat (To) Kaikaew',
    'Natchita (Foam) Bunkong','Niracha (Cream) Sangka',
    'Nuttawan (Kwang) Mahaporn',
    'Ploynitcha (Nitcha) Rujipiromthagoon','Puttipong (Tape) Wanithaweewat',
    'Rinlaphat (Mild) Setthasiriwuti','Siriprapa (Pop) Piapeng',
    'Warissara (Ply) Chanaboon'
  ]) AS kam_name
),

-- ── user_master: current KAM outlets ─────────────────────────
user_master_latest AS (
  SELECT
    CAST(um.res_id AS STRING)        AS user_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.account_type,
    UPPER(TRIM(COALESCE(um.commercial_owner,''))) AS commercial_owner,
    TRIM(COALESCE(um.sales_owner,''))             AS sales_owner,
    TRIM(COALESCE(
      NULLIF(um.staff_owner,''), NULLIF(um.kam_owner,''),
      NULLIF(um.ka_owner,''),''
    ))                                            AS new_kam_name,
    um.staff_owner_email,
    um.kam_owner_email,
    DATE(um.new_user_exp_date)       AS new_user_exp_date,
    DATE(um.lasted_order_date)       AS lasted_order_date,
    DATE(um.first_dollar_date)       AS first_dollar_date,
    FORMAT_DATE('%Y-%m', DATE(um.new_user_exp_date)) AS exp_month
  FROM `freshket-rn.dim.user_master` um
  WHERE um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
    AND um.account_type IN ('SA','MC','Chain','Unknown')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY DATE(um.lasted_order_date) DESC NULLS LAST
  ) = 1
),

user_master_kam AS (
  SELECT uml.*
  FROM user_master_latest uml
  JOIN kam_name_list k ON TRIM(uml.new_kam_name) = TRIM(k.kam_name)
  WHERE uml.commercial_owner = 'KAM'
    AND uml.new_kam_name != ''
),

-- ── Order base ────────────────────────────────────────────────
order_base AS (
  SELECT
    CAST(o.user_id AS STRING)        AS user_id,
    CAST(o.account_id AS STRING)     AS account_id,
    CAST(o.delivery_date AS DATE)    AS delivery_date,
    FORMAT_DATE('%Y-%m', o.month_group) AS month_label,
    UPPER(TRIM(COALESCE(o.commercial_owner,''))) AS commercial_owner,
    TRIM(COALESCE(o.staff_owner,'')) AS staff_owner,
    SAFE_CAST(o.gmv_ex_vat AS FLOAT64) AS gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND o.account_id IS NOT NULL
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH)
),

-- ── Apr commercial_owner ระดับ account ───────────────────────
-- source of truth สำหรับ transfer_in vs new_sales
-- ถ้า account มีทั้ง KAM และ SALE ใน Apr → KAM นำ (priority)
apr_account_owner AS (
  SELECT
    account_id,
    -- commercial_owner หลักใน Apr: KAM/PM/ADMIN > SALE
    CASE
      WHEN COUNTIF(commercial_owner IN ('KAM','PM','ADMIN')) > 0
        THEN 'KAM_PM_ADMIN'
      WHEN COUNTIF(commercial_owner = 'SALE') > 0
        THEN 'SALE'
      ELSE 'OTHER'
    END AS apr_primary_owner_type,

    -- staff ที่ดูแลใน Apr (last KAM order wins, fallback to last SALE)
    ARRAY_AGG(
      CASE WHEN commercial_owner IN ('KAM','PM','ADMIN')
           THEN staff_owner END
      IGNORE NULLS ORDER BY delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS apr_kam_staff,

    ARRAY_AGG(
      CASE WHEN commercial_owner = 'SALE'
           THEN staff_owner END
      IGNORE NULLS ORDER BY delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS apr_sale_staff

  FROM order_base ob
  CROSS JOIN params p
  WHERE ob.delivery_date BETWEEN p.prev_start AND p.prev_end
  GROUP BY 1
),

-- ── outlet evidence ใน May ───────────────────────────────────
-- ใช้สำหรับ new_sales PATH B และ transfer_out
outlet_may_ev AS (
  SELECT
    user_id,
    MAX(CASE WHEN commercial_owner = 'SALE'
            THEN delivery_date END)   AS may_last_sale,
    MAX(CASE WHEN commercial_owner = 'KAM'
            THEN delivery_date END)   AS may_last_kam
  FROM order_base ob
  CROSS JOIN params p
  WHERE ob.delivery_date BETWEEN p.perf_start AND p.perf_end
  GROUP BY 1
),

-- ── First KAM order date per outlet ─────────────────────────
first_kam_order AS (
  SELECT
    CAST(o.user_id AS STRING) AS user_id,
    MIN(o.delivery_date)      AS first_kam_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
  GROUP BY 1
),

-- order แรกสุดของ outlet (ทุก commercial_owner)
-- ใช้กรอง PATH C: ถ้า first_any_order ไม่ใช่ May = outlet เก่า = expansion ไม่ใช่ new_sales
first_any_order AS (
  SELECT
    CAST(o.user_id AS STRING) AS user_id,
    MIN(o.delivery_date)      AS first_any_order_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  GROUP BY 1
),

-- ── GMV ──────────────────────────────────────────────────────
gmv_by_outlet AS (
  SELECT
    user_id,
    month_label,
    SUM(gmv_ex_vat)    AS gmv,
    MAX(delivery_date) AS last_order_date
  FROM order_base
  GROUP BY 1, 2
),

-- ── 1. NEW SALES: Sales→KAM handover May ─────────────────────
-- Q10 logic ชี้ perf_month
-- เงื่อนไขเพิ่ม: Apr account owner = SALE เท่านั้น
new_sales_candidates AS (
  SELECT
    umk.*,
    oe.may_last_sale,
    oe.may_last_kam,
    aao.apr_primary_owner_type,
    aao.apr_sale_staff,
    TRIM(COALESCE(
      NULLIF(aao.apr_sale_staff,''),
      NULLIF(umk.sales_owner,''),''
    )) AS effective_sales_owner,
    CASE
      WHEN umk.new_user_exp_date IS NOT NULL
        AND umk.exp_month = p.perf_label
        THEN 'explicit_exp_date'
      WHEN umk.new_user_exp_date IS NULL
        AND oe.may_last_sale IS NOT NULL
        AND oe.may_last_kam IS NOT NULL
        AND oe.may_last_sale < oe.may_last_kam
        THEN 'fallback_sale_before_kam'
      WHEN umk.new_user_exp_date IS NULL
        AND TRIM(COALESCE(umk.sales_owner,'')) != ''
        AND fk.first_kam_date BETWEEN p.perf_start AND p.perf_end
        AND fao.first_any_order_date < p.perf_start
        AND oe.may_last_sale IS NOT NULL  -- v2b: must have an actual SALE order in prev month (Gallery=ADMIN, CMC=PM had none → were false new_sales)
        THEN 'path_c_first_kam_in_may'
      ELSE NULL
    END AS handover_path,
    p.perf_label AS movement_month,
    p.perf_days_in_month, p.prev_days_in_month,
    p.days_elapsed, p.perf_label, p.prev_label,
    -- PATH C flag
    CASE
      WHEN fk.first_kam_date BETWEEN p.perf_start AND p.perf_end
        THEN TRUE
      ELSE FALSE
    END AS first_kam_in_perf_month
  FROM user_master_kam umk
  CROSS JOIN params p
  LEFT JOIN outlet_may_ev oe ON oe.user_id = umk.user_id
  LEFT JOIN apr_account_owner aao ON aao.account_id = umk.account_id
  LEFT JOIN first_kam_order fk  ON fk.user_id  = umk.user_id
  LEFT JOIN first_any_order fao ON fao.user_id = umk.user_id
  WHERE
    -- PATH A: exp_date ใน May + sales_owner
    (umk.new_user_exp_date IS NOT NULL
      AND umk.exp_month = p.perf_label
      AND umk.sales_owner != '')
    OR
    -- PATH B: SALE < KAM ใน May
    (umk.new_user_exp_date IS NULL
      AND oe.may_last_sale IS NOT NULL
      AND oe.may_last_kam IS NOT NULL
      AND oe.may_last_sale < oe.may_last_kam
      AND umk.sales_owner != '')
    OR
    -- PATH C: first KAM order ใน May + first order เลยใน May (outlet ใหม่แท้)
    -- กรอง expansion: outlet เก่าที่เพิ่ง active = first_any_order ก่อน May
    (umk.new_user_exp_date IS NULL
      AND umk.sales_owner != ''
      AND fk.first_kam_date BETWEEN p.perf_start AND p.perf_end
      AND fao.first_any_order_date < p.perf_start
      AND oe.may_last_sale IS NOT NULL)  -- v2b: require real SALE order in prev month
),

new_sales_filtered AS (
  SELECT nsc.*
  FROM new_sales_candidates nsc
  WHERE nsc.handover_path IS NOT NULL
    AND (
      -- PATH A: explicit exp_date ใน May → ผ่านเสมอ
      nsc.handover_path = 'explicit_exp_date'
      OR
      -- PATH B: SALE order มาก่อน KAM order ใน May → ผ่านเสมอ
      (nsc.handover_path = 'fallback_sale_before_kam'
        AND NOT LOWER(TRIM(nsc.effective_sales_owner)) LIKE '%admin freshket%')
      OR
      -- PATH C: ไม่เคยมี KAM order เลยก่อน May + sales_owner มีค่า
      -- first_kam_date อยู่ใน May = KAM เพิ่งเริ่ม order ครั้งแรกเดือนนี้
      -- กรอง false positive: ร้านที่ KAM ดูแลมานานแล้ว first_kam จะไม่ใช่ May
      (nsc.handover_path = 'path_c_first_kam_in_may'
        AND NOT LOWER(TRIM(nsc.sales_owner)) LIKE '%admin freshket%')
    )
),

-- ── 2. TRANSFER IN: KAM/PM/ADMIN → KAM ──────────────────────
-- Account level: Apr commercial_owner = KAM/PM/ADMIN
-- แล้ว May KAM ≠ Apr staff
-- ทุก outlet ของ account นั้น = transfer_in
new_sales_account_ids AS (
  SELECT DISTINCT account_id FROM new_sales_filtered
),

transfer_in_accounts AS (
  SELECT DISTINCT
    aao.account_id,
    aao.apr_kam_staff       AS from_staff,
    aao.apr_primary_owner_type
  FROM apr_account_owner aao
  JOIN user_master_kam umk ON umk.account_id = aao.account_id
  LEFT JOIN new_sales_account_ids nsai ON nsai.account_id = aao.account_id
  WHERE
    aao.apr_primary_owner_type = 'KAM_PM_ADMIN'
    AND COALESCE(TRIM(aao.apr_kam_staff),'') != TRIM(umk.new_kam_name)
    AND nsai.account_id IS NULL
),

transfer_in_outlets AS (
  SELECT
    umk.*,
    tia.from_staff,
    p.perf_label AS movement_month,
    p.perf_days_in_month, p.prev_days_in_month,
    p.days_elapsed, p.perf_label, p.prev_label
  FROM user_master_kam umk
  JOIN transfer_in_accounts tia ON tia.account_id = umk.account_id
  CROSS JOIN params p
),

-- ── 3. TRANSFER OUT ───────────────────────────────────────────
-- outlet level: Apr KAM order อยู่กับ KAM ในทีม
-- แต่ปัจจุบัน staff_owner เปลี่ยนไปแล้ว
transfer_out_raw AS (
  SELECT
    ob.user_id,
    ob.account_id,
    MAX(ob.delivery_date)  AS last_order_date,
    TRIM(ob.staff_owner)   AS prev_kam_name,
    SUM(ob.gmv_ex_vat)     AS baseline_gmv
  FROM order_base ob
  CROSS JOIN params p
  JOIN kam_name_list k ON TRIM(ob.staff_owner) = TRIM(k.kam_name)
  WHERE ob.commercial_owner = 'KAM'
    AND ob.delivery_date BETWEEN p.prev_start AND p.prev_end
  GROUP BY 1, 2, 4
),

transfer_out_filtered AS (
  SELECT
    tor.*,
    uml.account_name,
    uml.account_type,
    uml.new_kam_name      AS current_kam_name,
    uml.commercial_owner  AS current_commercial_owner,
    p.perf_label, p.perf_days_in_month,
    p.prev_days_in_month, p.days_elapsed, p.prev_label
  FROM transfer_out_raw tor
  CROSS JOIN params p
  LEFT JOIN user_master_latest uml ON uml.user_id = tor.user_id
  WHERE COALESCE(TRIM(uml.new_kam_name),'') != tor.prev_kam_name
     OR uml.user_id IS NULL
),

-- ── GMV join ─────────────────────────────────────────────────
new_sales_gmv AS (
  SELECT nsf.*,
    COALESCE(prev.gmv,0) AS baseline_gmv, COALESCE(curr.gmv,0) AS current_gmv,
    prev.last_order_date AS prev_last, curr.last_order_date AS curr_last
  FROM new_sales_filtered nsf
  LEFT JOIN gmv_by_outlet prev ON prev.user_id=nsf.user_id AND prev.month_label=nsf.prev_label
  LEFT JOIN gmv_by_outlet curr ON curr.user_id=nsf.user_id AND curr.month_label=nsf.perf_label
),

transfer_in_gmv AS (
  SELECT tio.*,
    COALESCE(prev.gmv,0) AS baseline_gmv, COALESCE(curr.gmv,0) AS current_gmv,
    prev.last_order_date AS prev_last, curr.last_order_date AS curr_last
  FROM transfer_in_outlets tio
  LEFT JOIN gmv_by_outlet prev ON prev.user_id=tio.user_id AND prev.month_label=tio.prev_label
  LEFT JOIN gmv_by_outlet curr ON curr.user_id=tio.user_id AND curr.month_label=tio.perf_label
),

transfer_out_account AS (
  -- Aggregate outlet-grain transfer_out_filtered → account grain
  -- baseline_gmv = SUM across all outlets of the account
  -- email joined from user_master dim (prev KAM name lookup)
  SELECT
    tof.perf_label,
    tof.account_id,
    MAX(tof.account_name)                                AS account_name,
    MAX(tof.account_type)                                AS account_type,
    tof.prev_kam_name,
    COALESCE(MAX(umk_prev.staff_owner_email),
             MAX(umk_prev.kam_owner_email), '')          AS kam_email,
    MAX(tof.current_commercial_owner)                    AS current_commercial_owner,
    MAX(tof.current_kam_name)                            AS current_kam_name,
    CAST(ROUND(SUM(tof.baseline_gmv)) AS INT64)          AS baseline_gmv,
    MAX(tof.last_order_date)                             AS last_order_date,
    MAX(tof.perf_days_in_month)                          AS perf_days_in_month,
    MAX(tof.prev_days_in_month)                          AS prev_days_in_month,
    MAX(tof.days_elapsed)                                AS days_elapsed,
    MAX(tof.prev_label)                                  AS prev_label
  FROM transfer_out_filtered tof
  LEFT JOIN (
    SELECT DISTINCT
      TRIM(COALESCE(NULLIF(um.staff_owner,''), NULLIF(um.kam_owner,''), NULLIF(um.ka_owner,''))) AS kam_name,
      NULLIF(um.staff_owner_email,'')  AS staff_owner_email,
      NULLIF(um.kam_owner_email,'')    AS kam_owner_email
    FROM `freshket-rn.dim.user_master` um
    WHERE um.res_id IS NOT NULL
  ) umk_prev ON TRIM(umk_prev.kam_name) = tof.prev_kam_name
  GROUP BY tof.account_id, tof.prev_kam_name, tof.perf_label
)

-- ── Final output ──────────────────────────────────────────────
SELECT
  movement_month,
  'new_sales'                                          AS movement_type,
  user_id,
  account_id,
  account_name,
  account_type,
  new_kam_name                                         AS kam_name,
  TRIM(COALESCE(NULLIF(staff_owner_email,''),NULLIF(kam_owner_email,''),''))
                                                       AS kam_email,
  'SALE'                                               AS owner_from_type,
  effective_sales_owner                                AS owner_from_name,
  'KAM'                                                AS owner_to_type,
  new_kam_name                                         AS owner_to_name,
  CAST(ROUND(baseline_gmv) AS INT64)                   AS baseline_gmv,
  CAST(ROUND(current_gmv) AS INT64)                    AS current_gmv,
  perf_days_in_month                                   AS current_days_in_month,
  prev_days_in_month                                   AS baseline_days_in_month,
  days_elapsed,
  CAST(COALESCE(curr_last, prev_last) AS STRING)       AS last_order_date,
  handover_path                                        AS confidence,
  CAST(new_user_exp_date AS STRING)                    AS new_user_exp_date,
  CAST(first_dollar_date AS STRING)                    AS first_dollar_date
FROM new_sales_gmv

UNION ALL

SELECT
  movement_month,
  'transfer_in'                                        AS movement_type,
  user_id,
  account_id,
  account_name,
  account_type,
  new_kam_name                                         AS kam_name,
  TRIM(COALESCE(NULLIF(staff_owner_email,''),NULLIF(kam_owner_email,''),''))
                                                       AS kam_email,
  'KAM'                                                AS owner_from_type,
  from_staff                                           AS owner_from_name,
  'KAM'                                                AS owner_to_type,
  new_kam_name                                         AS owner_to_name,
  CAST(ROUND(baseline_gmv) AS INT64)                   AS baseline_gmv,
  CAST(ROUND(current_gmv) AS INT64)                    AS current_gmv,
  perf_days_in_month                                   AS current_days_in_month,
  prev_days_in_month                                   AS baseline_days_in_month,
  days_elapsed,
  CAST(COALESCE(curr_last, prev_last) AS STRING)       AS last_order_date,
  'account_level'                                      AS confidence,
  CAST(new_user_exp_date AS STRING)                    AS new_user_exp_date,
  CAST(first_dollar_date AS STRING)                    AS first_dollar_date
FROM transfer_in_gmv

UNION ALL

SELECT
  perf_label                                           AS movement_month,
  'transfer_out'                                       AS movement_type,
  NULL                                                 AS user_id,
  account_id,
  account_name,
  account_type,
  prev_kam_name                                        AS kam_name,
  kam_email,
  'KAM'                                                AS owner_from_type,
  prev_kam_name                                        AS owner_from_name,
  COALESCE(current_commercial_owner,'')                AS owner_to_type,
  COALESCE(current_kam_name,'')                        AS owner_to_name,
  baseline_gmv,
  0                                                    AS current_gmv,
  perf_days_in_month                                   AS current_days_in_month,
  prev_days_in_month                                   AS baseline_days_in_month,
  days_elapsed,
  CAST(last_order_date AS STRING)                      AS last_order_date,
  'high'                                               AS confidence,
  NULL                                                 AS new_user_exp_date,
  NULL                                                 AS first_dollar_date
FROM transfer_out_account

ORDER BY movement_type, kam_name, baseline_gmv DESC;


