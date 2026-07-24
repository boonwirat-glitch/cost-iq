-- ══════════════════════════════════════════════════════════════
-- Q3C Upsell Bulk ALL KAMs — v4
-- v4: Remove new_gmv and comeback_gmv columns (dead fields not used by app)
--   → reduces CSV file size ~22% (7 cols instead of 9)
--   → app parser updated to match (02_data_pipeline.js v4)
-- v3 fix retained: KAM→account mapping ใช้ logic เดียวกับ Q8E
--
-- Columns (7): kam_email, account_id, outlet_id, month_label, group_key,
--              existing_gmv, total_gmv
-- ══════════════════════════════════════════════════════════════

WITH
dates AS (
  SELECT
    -- v827-auto: baseline_mo + lookback_start AUTO-DERIVE from current_mo's own quarter —
    -- no manual date edit needed each new quarter (Q3→Q4→Q1... all self-adjust).
    -- current_mo = the month being reported (day-1 lag, e.g. run Aug-1 → reports Jul).
    -- baseline_mo = 1 month before the START of current_mo's quarter
    --   (Jul/Aug/Sep all → Jun; Oct/Nov/Dec all → Sep; etc.)
    -- lookback_start = 2 months before baseline_mo, giving a fixed 3-month pool
    --   (baseline_mo, baseline_mo-1, baseline_mo-2) that stays constant across the whole quarter,
    --   matching the app's _commBaseMonthLabels(base_month, 3) window.
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)                                       AS current_mo,
    DATE_SUB(DATE_TRUNC(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), QUARTER),
             INTERVAL 1 MONTH)                                                                        AS baseline_mo,
    DATE_SUB(DATE_SUB(DATE_TRUNC(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), QUARTER),
             INTERVAL 1 MONTH), INTERVAL 2 MONTH)                                                     AS lookback_start
),

-- Active KAM whitelist
-- 2026-07-24: เพิ่ม PM/AD 4 คน + คอลัมน์ expected_owner (แพทเทิร์นเดียวกับ
-- Q8E_portview_v3.sql) — เดิมไม่มี 4 คนนี้ + filter commercial_owner='KAM'
-- ตายตัว ทำให้ splitter ไม่เคยได้ไฟล์ sense_upsell_*.csv ของ PM/AD เลย
kam_list AS (
  SELECT kam_name, kam_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Treerak (May) Sangjua'             AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta'                 AS kam_name, 'panitan.p@freshket.co'      AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao'               AS kam_name, 'sarawoot.k@freshket.co'     AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae'             AS kam_name, 'nichamon.k@freshket.co'     AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'PM'  AS expected_owner)
  ])
),

-- KAM→account mapping (Q8E logic)
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    k.kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = k.expected_owner  -- 2026-07-24: was ='KAM'; PM/AD outlets carry commercial_owner='PM' (Q8E pattern)
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── NRR Core ownership CTEs (same KAM baseline→current, no handover) ───
-- v5: align upsell scope with NRR core (same as May backfill + q3c_team_v5)
apr_outlet_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  WHERE o.delivery_date >= d.baseline_mo
    AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
may_outlet_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  WHERE o.delivery_date >= d.current_mo
    AND o.delivery_date <  DATE_ADD(d.current_mo, INTERVAL 1 MONTH)
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
nrr_core_outlets AS (
  SELECT m.outlet_id
  FROM may_outlet_ownership m
  JOIN apr_outlet_ownership a ON m.outlet_id = a.outlet_id
  JOIN kam_list k_may ON m.commercial_owner = k_may.expected_owner  -- 2026-07-24: was ='KAM' (Q8E pattern)
    AND TRIM(m.staff_owner) = TRIM(k_may.kam_name)
  JOIN kam_list k_apr ON a.commercial_owner = k_apr.expected_owner  -- 2026-07-24: was ='KAM'
    AND TRIM(a.staff_owner) = TRIM(k_apr.kam_name)
    AND k_apr.kam_email = k_may.kam_email
  WHERE (
    a.new_user_exp_date IS NULL
    OR a.new_user_exp_date < (SELECT baseline_mo FROM dates)
  )
),

-- Outlet status (existing / expansion / comeback)
-- existing = in baseline month AND same KAM both months (NRR core)
outlet_history AS (
  SELECT
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date)      AS first_seen,
    MAX(CASE WHEN o.delivery_date >= d.baseline_mo
              AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
             THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= d.current_mo THEN 1 ELSE 0 END) AS in_current
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE_SUB((SELECT baseline_mo FROM dates), INTERVAL 5 MONTH)
    AND o.delivery_date <  DATE_ADD((SELECT current_mo FROM dates), INTERVAL 1 MONTH)
  GROUP BY 1, 2
),
outlet_status AS (
  SELECT oh.account_id, oh.outlet_id,
    CASE
      WHEN oh.in_baseline = 1 AND nc.outlet_id IS NOT NULL                    THEN 'existing'
      WHEN oh.in_current  = 1 AND oh.first_seen >= (SELECT current_mo FROM dates)  THEN 'expansion'
      WHEN oh.in_current  = 1 AND oh.first_seen <  (SELECT current_mo FROM dates)  THEN 'comeback'
    END AS outlet_type
  FROM outlet_history oh
  LEFT JOIN nrr_core_outlets nc ON oh.outlet_id = nc.outlet_id
  WHERE oh.in_current = 1
),

-- Current month: outlet × group_key
-- existing_gmv: GMV from existing outlets (used for P3)
-- total_gmv: all GMV for this outlet × group_key (used for P1)
current_items AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    i.category_high_level AS category,  -- v_catbonus: kept for per-category rate lookup (was discarded)
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= d.current_mo
    AND o.delivery_date <  DATE_ADD(d.current_mo, INTERVAL 1 MONTH)
    AND i.gmv_ex_vat > 0
),
current_split AS (
  SELECT
    ci.kam_email, ci.account_id, ci.outlet_id, ci.month_label, ci.group_key,
    ANY_VALUE(ci.category) AS category,  -- v_catbonus: 1:1 with group_key, ANY_VALUE is safe
    SUM(CASE WHEN os.outlet_type = 'existing' THEN ci.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(ci.gmv_ex_vat) AS total_gmv
  FROM current_items ci
  LEFT JOIN outlet_status os ON ci.account_id = os.account_id AND ci.outlet_id = os.outlet_id
  GROUP BY 1,2,3,4,5
),

-- Lookback 3 months: total_gmv for max_baseline calculation (P3)
lookback AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    i.category_high_level AS category,  -- v_catbonus: 1:1 with group_key, safe to group by
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    0.0 AS existing_gmv,
    SUM(i.gmv_ex_vat) AS total_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= d.lookback_start
    AND o.delivery_date <  d.current_mo
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3,4,5,6
)

-- v_catbonus: 8 columns now — `category` appended as the TRAILING column
-- (position 8 full-file / position 7 in the per-KAM split file after
-- kam_email is dropped by splitter.py). Trailing keeps the existing 6
-- per-KAM positions (account_id..total_gmv = p[0]..p[5]) byte-stable so the
-- ingestion parser's per-KAM branch is unaffected; the parser reads the new
-- category at p[6]. See src/02_data_pipeline.js bulk-upsell handler.
SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  ROUND(existing_gmv, 2) AS existing_gmv,
  ROUND(total_gmv,    2) AS total_gmv,
  category
FROM current_split

UNION ALL

SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  existing_gmv,
  ROUND(total_gmv, 2) AS total_gmv,
  category
FROM lookback

ORDER BY kam_email, account_id, outlet_id, month_label, total_gmv DESC
