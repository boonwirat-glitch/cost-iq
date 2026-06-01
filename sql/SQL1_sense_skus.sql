-- ════════════════════════════════════════════════════════════════════════════
-- SQL-1 v207g: Per-KAM Sense SKU Bundle Source (download_skus.csv → splitter → sense_skus_[safe_email].csv)
-- Download: BigQuery → Save Results → CSV → ตั้งชื่อ "download_skus.csv"
-- splitter uses first column kam_email and removes it before uploading each bundle
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
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
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email
  FROM master_kam_accounts
),
raw AS (
  SELECT
    o.account_id,
    km.kam_email,
    DATE_TRUNC(o.delivery_date, MONTH)             AS month_date,
    CAST(i.item_id AS STRING)                      AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '') AS dept,
    COALESCE(i.subclass_name, '')                  AS subclass,
    COALESCE(i.temperature, '')                    AS temperature,
    COALESCE(i.pack_size, '')                      AS pack_size,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat,
    o.order_id,
    o.user_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map km ON o.account_id = km.account_id
  WHERE o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)  -- day-1 lag guard
    AND i.item_id IS NOT NULL
),
monthly_total AS (
  SELECT account_id, month_date, SUM(gmv_ex_vat) AS total_gmv
  FROM raw GROUP BY account_id, month_date
),
agg AS (
  SELECT
    r.account_id, r.kam_email, r.month_date, r.item_id,
    ANY_VALUE(r.item_name_th)                                          AS item_name_th,
    ANY_VALUE(r.dept)                                                  AS dept,
    ANY_VALUE(r.subclass)                                              AS subclass,
    ANY_VALUE(r.temperature)                                           AS temperature,
    ANY_VALUE(r.pack_size)                                             AS pack_size,
    ROUND(SUM(r.gmv_ex_vat), 2)                                        AS gmv_ex_vat,
    ROUND(SUM(r.qty), 3)                                               AS qty_kg,
    ROUND(SAFE_DIVIDE(SUM(r.gmv_ex_vat), NULLIF(SUM(r.qty),0)), 2)    AS unit_price,
    COUNT(DISTINCT r.order_id)                                         AS order_count,
    ROUND(AVG(r.price_ex_vat), 2)                                      AS avg_piece_price,
    COUNT(DISTINCT r.user_id)                                          AS outlet_count_sku
  FROM raw r GROUP BY r.account_id, r.kam_email, r.month_date, r.item_id
)

-- kam_email อยู่ใน column แรก — splitter.py จะใช้ split แล้วตัดออกก่อน upload
SELECT
  a.kam_email,   -- ← splitter ใช้ column นี้, ไม่อยู่ใน output file
  a.account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM a.month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END, ' ', CAST(EXTRACT(YEAR FROM a.month_date)+543 AS STRING)
  )                                                                    AS month_label,
  a.item_id,
  a.item_name_th,
  a.dept,
  a.subclass,
  a.temperature,
  a.pack_size,
  a.gmv_ex_vat,
  ROUND(SAFE_DIVIDE(a.gmv_ex_vat, t.total_gmv)*100, 1)                AS pct,
  a.qty_kg,
  a.unit_price,
  a.order_count,
  a.avg_piece_price,
  a.outlet_count_sku,
  COALESCE(m.default_unit_group, '')  AS default_unit_group,
  COALESCE(m.ea_unit_name, '')        AS ea_unit_name,
  COALESCE(m.universal_ea_value, 0)   AS universal_ea_value
FROM agg a
JOIN monthly_total t USING (account_id, month_date)
LEFT JOIN (
  SELECT item_id,
         ANY_VALUE(default_unit_group) AS default_unit_group,
         ANY_VALUE(ea_unit_name)       AS ea_unit_name,
         ANY_VALUE(universal_ea_value) AS universal_ea_value
  FROM `freshket-rn.bi_source.item_master_merchandise`
  GROUP BY item_id
) m ON CAST(m.item_id AS STRING) = a.item_id
ORDER BY a.kam_email, a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;
