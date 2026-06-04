-- ══════════════════════════════════════════════════════════════
-- Q3C Team Summary v5: sense_upsell_team.csv
-- v4 fixes (2 bugs from v3):
--   Bug A: Expansion outlets (new) were classified as P1 (3%) — fixed to outlet_gmv (1.5% flat)
--   Bug B: Comeback outlets were included in outlet_gmv — fixed to expansion-only
-- Logic now matches app detail path (_commComputeUpsellOutlet + _commComputeUpsellSku):
--   expansion (new)  → outlet_gmv only, at 1.5%
--   comeback         → excluded from all commission
--   existing         → P1 / P3 rules apply
-- Output columns (unchanged):
--   kam_email, p1_gmv, p3_incremental, outlet_gmv, tl_upsell_base
-- ══════════════════════════════════════════════════════════════

WITH
dates AS (
  SELECT
    -- lag_date anchor: day-1 ensures month boundary (Jun 1) sees May as current, not empty June
    DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH) AS baseline_mo,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)                              AS current_mo,
    DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 3 MONTH), MONTH) AS lookback_start
),

-- Active KAM whitelist (อัปเดตเมื่อมีการเปลี่ยนทีม)
kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

-- KAM→account mapping (Q8E logic)
user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at   DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_accounts AS (
  SELECT account_id, kam_email
  FROM master_kam_accounts
),

-- ── NRR Core ownership: same KAM baseline_mo → current_mo ──────────────
-- v5: align upsell scope with NRR core definition (May backfill pattern)
-- Excludes: transfer_in (apr_kam ≠ may_kam) + handover_perf (new_user_exp_date in baseline_mo)
apr_outlet_ownership AS (
  -- Owner ณ baseline month (last order in month)
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
  -- Owner ณ current month (last order in month)
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
-- NRR core outlet list: same KAM both months, no handover
nrr_core_outlets AS (
  SELECT m.outlet_id
  FROM may_outlet_ownership m
  JOIN apr_outlet_ownership a ON m.outlet_id = a.outlet_id
  JOIN kam_list k_may ON m.commercial_owner = 'KAM'
    AND TRIM(m.staff_owner) = TRIM(k_may.kam_name)
  JOIN kam_list k_apr ON a.commercial_owner = 'KAM'
    AND TRIM(a.staff_owner) = TRIM(k_apr.kam_name)
    AND k_apr.kam_email = k_may.kam_email   -- same KAM both months
  WHERE (
    a.new_user_exp_date IS NULL
    OR a.new_user_exp_date < (SELECT baseline_mo FROM dates)  -- not handover in baseline month
  )
),

-- Outlet status: existing / expansion (new) / comeback
-- expansion = first_seen this month (never ordered before in full window)
-- comeback  = ordered before, not in baseline month, back this month
-- existing  = ordered in baseline month AND in nrr_core_outlets
outlet_history AS (
  SELECT
    o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date) AS first_seen,
    MAX(CASE WHEN o.delivery_date >= d.baseline_mo
              AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
             THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= d.current_mo THEN 1 ELSE 0 END) AS in_current
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= DATE_SUB((SELECT baseline_mo FROM dates), INTERVAL 5 MONTH)
    AND o.delivery_date <  DATE_ADD((SELECT current_mo FROM dates), INTERVAL 1 MONTH)
  GROUP BY 1, 2
),
outlet_status AS (
  SELECT oh.account_id, oh.outlet_id,
    CASE
      -- existing: in baseline month AND same KAM both months (NRR core)
      WHEN oh.in_baseline = 1 AND nc.outlet_id IS NOT NULL             THEN 'existing'
      WHEN oh.in_current  = 1 AND oh.first_seen >= (SELECT current_mo FROM dates) THEN 'expansion'
      WHEN oh.in_current  = 1 AND oh.first_seen <  (SELECT current_mo FROM dates) THEN 'comeback'
    END AS outlet_type
  FROM outlet_history oh
  LEFT JOIN nrr_core_outlets nc ON oh.outlet_id = nc.outlet_id
  WHERE oh.in_current = 1
),

-- Current month GMV at outlet × group_key, split by outlet type
group_key_def AS (
  SELECT
    ka.kam_email, o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.current_mo
    AND o.delivery_date <  DATE_ADD(d.current_mo, INTERVAL 1 MONTH)
    AND i.gmv_ex_vat > 0
),
current_agg AS (
  SELECT
    gk.kam_email, gk.account_id, gk.outlet_id, gk.group_key,
    os.outlet_type,
    SUM(gk.gmv_ex_vat) AS total_gmv,
    SUM(CASE WHEN os.outlet_type = 'existing'  THEN gk.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(CASE WHEN os.outlet_type = 'expansion' THEN gk.gmv_ex_vat ELSE 0 END) AS expansion_gmv
    -- comeback excluded from all commission (no column needed)
  FROM group_key_def gk
  LEFT JOIN outlet_status os ON gk.account_id = os.account_id AND gk.outlet_id = os.outlet_id
  GROUP BY 1, 2, 3, 4, 5
),

-- Baseline: outlet × group_key bought in any of 3 lookback months (for P1/P3 on existing outlets)
baseline_groups AS (
  SELECT DISTINCT
    ka.kam_email, o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.lookback_start
    AND o.delivery_date <  d.current_mo
    AND i.gmv_ex_vat > 0
),

-- Max baseline 3 months normalize 30 days (for P3 on existing outlets)
-- Split into 2 CTEs to avoid referencing o.delivery_date outside GROUP BY
lookback_monthly AS (
  SELECT
    ka.kam_email,
    o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    DATE_TRUNC(o.delivery_date, MONTH) AS month_start,
    SUM(i.gmv_ex_vat) AS monthly_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.lookback_start
    AND o.delivery_date <  d.current_mo
    AND i.gmv_ex_vat > 0
  GROUP BY
    ka.kam_email,
    o.account_id,
    CAST(o.user_id AS STRING),
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END,
    DATE_TRUNC(o.delivery_date, MONTH)
),
max_baseline AS (
  SELECT
    kam_email, account_id, outlet_id, group_key,
    MAX(
      monthly_gmv / DATE_DIFF(DATE_ADD(month_start, INTERVAL 1 MONTH), month_start, DAY) * 30
    ) AS max_bl
  FROM lookback_monthly
  GROUP BY 1, 2, 3, 4
),

-- Classify P1 / P3 — EXISTING outlets only
-- expansion outlets go directly to outlet_gmv (1.5% flat, handled in final SELECT)
-- comeback outlets are excluded entirely
commission_items AS (
  SELECT
    c.kam_email, c.account_id, c.outlet_id, c.group_key,
    c.outlet_type,
    c.existing_gmv,
    c.expansion_gmv,
    c.total_gmv,
    COALESCE(mb.max_bl, 0) AS max_bl,
    -- P1: existing outlet, group_key not in 3-month baseline
    CASE
      WHEN c.outlet_type = 'existing' AND bg.group_key IS NULL THEN 1
      ELSE 0
    END AS is_p1,
    -- P3: existing outlet, group_key in baseline, existing_gmv > 150% of max_bl
    CASE
      WHEN c.outlet_type = 'existing'
        AND bg.group_key IS NOT NULL
        AND c.existing_gmv > COALESCE(mb.max_bl, 0) * 2.00
        AND c.existing_gmv - COALESCE(mb.max_bl, 0) >= 5000
      THEN 1 ELSE 0
    END AS is_p3
  FROM current_agg c
  LEFT JOIN baseline_groups bg
    ON c.kam_email  = bg.kam_email
    AND c.account_id = bg.account_id
    AND c.outlet_id  = bg.outlet_id
    AND c.group_key  = bg.group_key
  LEFT JOIN max_baseline mb
    ON c.kam_email  = mb.kam_email
    AND c.account_id = mb.account_id
    AND c.outlet_id  = mb.outlet_id
    AND c.group_key  = mb.group_key
)

-- Output per KAM
-- outlet_gmv = expansion outlets total GMV (1.5% flat, no P1/P3)
-- p1_gmv     = P1-eligible GMV at existing outlets only (≥฿2,500)
-- p3_incr    = incremental GMV at P3-eligible existing outlets
-- tl_upsell_base = p1_gmv + p3_incremental (used for TL multiplier)
SELECT
  kam_email,
  ROUND(SUM(CASE WHEN is_p1 = 1 AND total_gmv >= 5000 THEN existing_gmv ELSE 0 END), 2) AS p1_gmv,
  ROUND(SUM(CASE WHEN is_p3 = 1 THEN existing_gmv - max_bl               ELSE 0 END), 2) AS p3_incremental,
  ROUND(SUM(CASE WHEN outlet_type = 'expansion'       THEN expansion_gmv  ELSE 0 END), 2) AS outlet_gmv,
  ROUND(
    SUM(CASE WHEN is_p1 = 1 AND total_gmv >= 5000 THEN existing_gmv ELSE 0 END) +
    SUM(CASE WHEN is_p3 = 1 THEN existing_gmv - max_bl               ELSE 0 END),
  2) AS tl_upsell_base
FROM commission_items
GROUP BY 1
ORDER BY tl_upsell_base DESC
