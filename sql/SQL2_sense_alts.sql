-- ════════════════════════════════════════════════════════════════════════════
-- SQL-2 v207g: Per-KAM Sense Alternatives Bundle Source
-- Download: BigQuery → Save Results → CSV → ตั้งชื่อ "download_alts.csv"
-- splitter uses first column kam_email and removes it before uploading each bundle
-- Output bundle names: sense_alts_[safe_email].csv
-- Owner logic: user_master.staff_owner_email first; order owner fallback only when master has no owner email
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper: extract total liters from pack_size string ──────────────────
-- Mirrors parsePackSizeUnits() in v160 JS. Returns NULL if not a liquid pack.
CREATE TEMP FUNCTION extract_pack_liters(ps STRING) AS ((
  CASE
    -- N x M ml  (e.g. "24 x 320 ml./Carton")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*ml') AS FLOAT64)
           / 1000
    -- N ml  (e.g. "700 ml./bottle")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*ml') AS FLOAT64) / 1000
    -- N x M liter/litre/lt/L
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*(?:liter|litre|lt|L)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*(?:liter|litre|lt|L)') AS FLOAT64)
    -- N liter/litre/lt  (e.g. "18 liter/Tin", "13.75Litre/each", "1 liter/bottle")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*(?:liter|litre|lt)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*(?:liter|litre|lt)') AS FLOAT64)
    -- Single "L" (e.g. "5 L/bottle") — must be preceded by digit to avoid false matches
    WHEN REGEXP_CONTAINS(ps, r'\d+\.?\d*\s*L\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(\d+\.?\d*)\s*L\b') AS FLOAT64)
    ELSE NULL
  END
));

-- ════════════════════════════════════════════════════════════
-- Q4B v2: Bulk Alternatives — KAM accounts × last month
-- ════════════════════════════════════════════════════════════
-- Output: download_alts.csv → split into sense_alts_[safe_email].csv
-- Refresh: Weekly (จันทร์ 6:00 AM)
-- Notes:
--   • Last month only (closed) — stable within month
--   • catalog CTE ยังใช้ทุก account เป็น price reference (ถูกต้อง)
--     เพราะต้องการราคากลางของ catalog ไม่ใช่ราคาของแต่ละ KAM

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),

account_items AS (
  SELECT
    o.account_id,
    km.kam_email,
    item.item_id,
    item.item_name_th,
    item.subclass_name,
    item.temperature,
    item.pack_size AS account_pack_size,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)]) AS core_name,
    -- per_kg: weight items — same as v2
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id)
          / NULLIF(SUM(item.weight_kg) OVER (PARTITION BY o.account_id, item.item_id), 0), 2)
          AS avg_price_per_kg,
    -- per_liter: liquid items (weight_kg=0, pack_size has volume) — new in v3
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id),
                  NULLIF(SUM(item.qty) OVER (PARTITION BY o.account_id, item.item_id), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2) AS avg_price_per_liter,
    -- price_basis: determines which normalized price to use
    CASE
      WHEN SUM(item.weight_kg) OVER (PARTITION BY o.account_id, item.item_id) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END AS price_basis,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id)
          / NULLIF(SUM(item.qty) OVER (PARTITION BY o.account_id, item.item_id), 0), 2)
          AS avg_unit_price,
    ROUND(SUM(item.qty)        OVER (PARTITION BY o.account_id, item.item_id), 2) AS monthly_qty,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id), 2) AS monthly_gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS item
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0                                                -- per_kg path (เดิม)
         OR extract_pack_liters(item.pack_size) IS NOT NULL)               -- per_liter path (ใหม่)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.account_id, item.item_id ORDER BY o.delivery_date DESC) = 1
),

-- catalog ใช้ทุก account เป็น reference ราคากลาง (ไม่ filter KAM)
catalog AS (
  SELECT
    item.item_id,
    item.item_name_th,
    item.brand_name_th,
    item.grading,
    item.pack_size AS catalog_pack_size,
    item.subclass_name,
    item.temperature,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)]) AS core_name,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.weight_kg) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_price_per_kg,
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id),
                  NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2) AS catalog_price_per_liter,
    CASE
      WHEN SUM(item.weight_kg) OVER (PARTITION BY item.item_id) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END AS price_basis,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_unit_price
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS item
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
    AND o.account_type != 'enduser'
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0 OR extract_pack_liters(item.pack_size) IS NOT NULL)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY item.item_id ORDER BY o.delivery_date DESC) = 1
)

SELECT
  a.kam_email,   -- ← splitter ใช้ column นี้, ไม่อยู่ใน output bundle file
  a.account_id,
  a.item_id                                           AS account_item_id,
  a.item_name_th                                      AS account_item_name,
  a.core_name                                         AS account_core_name,
  COALESCE(a.avg_price_per_kg, a.avg_price_per_liter) AS account_price,
  a.subclass_name,
  c.item_id                                           AS catalog_item_id,
  c.item_name_th                                      AS catalog_item_name,
  c.brand_name_th                                     AS catalog_brand,
  c.grading,
  c.catalog_pack_size                                 AS pack_size,
  COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter) AS catalog_price,
  ROUND(COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      - COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 2) AS price_diff,
  a.avg_unit_price                                    AS account_unit_price,
  a.account_pack_size,
  c.catalog_unit_price,
  a.monthly_qty,
  a.monthly_gmv,
  a.price_basis                                       AS price_basis

FROM account_items a
JOIN catalog c
  ON  a.subclass_name  = c.subclass_name
  AND a.temperature    = c.temperature
  AND a.item_id       != c.item_id
  AND a.price_basis    = c.price_basis                                     -- ห้ามเทียบข้าม unit
  AND (c.core_name LIKE CONCAT('%', a.core_name, '%') OR a.core_name LIKE CONCAT('%', c.core_name, '%'))
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter)
      < COALESCE(a.avg_price_per_kg, a.avg_price_per_liter) * 0.97
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter) > 0
  AND COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      / NULLIF(COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 0) <= 10

QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.account_id, a.item_id
  ORDER BY price_diff DESC
) <= 5
ORDER BY a.kam_email, a.account_id, a.monthly_gmv DESC, price_diff DESC;