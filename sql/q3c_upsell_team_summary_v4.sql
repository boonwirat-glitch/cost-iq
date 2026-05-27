-- ══════════════════════════════════════════════════════════════
-- Q3C Team Summary v4: sense_upsell_team.csv
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
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AS baseline_mo,
    DATE_TRUNC(CURRENT_DATE(), MONTH)                              AS current_mo,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH) AS lookback_start
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
    STRUCT('Pavarisa (Ploiiy) Muangtaeng'         AS kam_name, 'pavarisa.mu@freshket.co'    AS kam_email),
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
    AND um.account_type IN ('SA','MC','Chain')
),
order_fallback_accounts AS (
  SELECT o.account_id, k.kam_email, 2 AS _pri
  FROM `freshket-rn.dwh.order` o
  JOIN kam_list k ON o.ka_owner = k.kam_name
  LEFT JOIN user_master_current um ON um.account_guid = o.account_id
  WHERE o.account_type IN ('SA','MC','Chain')
    AND o.commercial_owner = 'KAM'
    AND o.delivery_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND (um.account_guid IS NULL
         OR um.staff_owner_email IS NULL
         OR TRIM(um.staff_owner_email) = '')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.account_id ORDER BY o.delivery_date DESC) = 1
),
kam_accounts AS (
  SELECT account_id, kam_email
  FROM (
    SELECT * FROM master_kam_accounts
    UNION ALL
    SELECT * FROM order_fallback_accounts
  )
  QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY _pri ASC) = 1
),

-- Outlet status: existing / expansion (new) / comeback
-- expansion = first_seen this month (never ordered before in full window)
-- comeback  = ordered before, not in baseline month, back this month
-- existing  = ordered in baseline month
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
  SELECT account_id, outlet_id,
    CASE
      WHEN in_baseline = 1                                              THEN 'existing'
      WHEN in_current  = 1 AND first_seen >= (SELECT current_mo FROM dates) THEN 'expansion'
      WHEN in_current  = 1 AND first_seen <  (SELECT current_mo FROM dates) THEN 'comeback'
    END AS outlet_type
  FROM outlet_history WHERE in_current = 1
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
lookback_agg AS (
  SELECT
    ka.kam_email, o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    MAX(
      SUM(i.gmv_ex_vat) /
      DATE_DIFF(DATE_TRUNC(DATE_ADD(o.delivery_date, INTERVAL 1 MONTH), MONTH),
                DATE_TRUNC(o.delivery_date, MONTH), DAY) * 30
    ) OVER (PARTITION BY ka.kam_email, o.account_id, CAST(o.user_id AS STRING),
      CASE WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
                AND TRIM(COALESCE(i.item_family,'')) != ''
           THEN i.item_family ELSE i.subclass_name END
    ) AS max_baseline_30d
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.lookback_start
    AND o.delivery_date <  d.current_mo
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3, 4, DATE_TRUNC(o.delivery_date, MONTH)
),
max_baseline AS (
  SELECT kam_email, account_id, outlet_id, group_key, MAX(max_baseline_30d) AS max_bl
  FROM lookback_agg
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
        AND c.existing_gmv > COALESCE(mb.max_bl, 0) * 1.50
        AND c.existing_gmv - COALESCE(mb.max_bl, 0) >= 2500
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
  ROUND(SUM(CASE WHEN is_p1 = 1 AND total_gmv >= 2500 THEN existing_gmv ELSE 0 END), 2) AS p1_gmv,
  ROUND(SUM(CASE WHEN is_p3 = 1 THEN existing_gmv - max_bl               ELSE 0 END), 2) AS p3_incremental,
  ROUND(SUM(CASE WHEN outlet_type = 'expansion'       THEN expansion_gmv  ELSE 0 END), 2) AS outlet_gmv,
  ROUND(
    SUM(CASE WHEN is_p1 = 1 AND total_gmv >= 2500 THEN existing_gmv ELSE 0 END) +
    SUM(CASE WHEN is_p3 = 1 THEN existing_gmv - max_bl               ELSE 0 END),
  2) AS tl_upsell_base
FROM commission_items
GROUP BY 1
ORDER BY tl_upsell_base DESC
