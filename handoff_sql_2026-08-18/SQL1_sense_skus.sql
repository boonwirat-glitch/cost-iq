-- ════════════════════════════════════════════════════════════════════════════
-- SQL-1 v207g: Per-KAM Sense SKU Bundle Source (download_skus.csv → splitter → sense_skus_[safe_email].csv)
-- Download: BigQuery → Save Results → CSV → ตั้งชื่อ "download_skus.csv"
-- splitter uses first column kam_email and removes it before uploading each bundle
--
-- v_gp (2026-07-31): + TWO trailing columns, margin_ex_vat (p[19]) and
-- gmv_with_margin (p[20]). The second one is not optional — it is the GMV of
-- only those rows that actually carried a margin value, which is the only way
-- the client can tell "GP is genuinely low" from "margin data is missing".
-- Without it a half-populated month renders a confidently wrong %GP.
--
-- This is Sense's Gross Profit source, chosen over the q3c upsell bundle
-- for four reasons that all matter:
--   1. This file is already FOREGROUND-loaded and already read by the account
--      view (D.skus_monthly) — no fetch race, no missing repaint hook.
--   2. The q3c bundle is skipped entirely for role tl/admin, who drill into
--      accounts constantly; this file is not.
--   3. The q3c bundle is keyed byKam[<my email>], so it has no rows for an
--      account outside your own portfolio. This file is per-account.
--   4. ROSTER MATCH — the kam_list above uses `um.commercial_owner =
--      k.expected_owner` including 4 PMs, identical to Q9B_bulk_history, which
--      is where the GMV shown next to GP comes from. q3c uses a flat
--      commercial_owner='KAM' + a 15-name list, so PM-owned accounts would
--      show GP ฿0 against a real GMV. Numerator and denominator must share a
--      roster or the ratio lies.
--
-- Grain is unchanged: account_id × month_label × item_id. Summing margin over
-- an account's rows gives account-level GP; per row it gives per-SKU GP, which
-- pairs with the existing qty_kg / unit_price for a per-unit figure.
--
-- DO NOT add a `margin_ex_vat > 0` filter. Margin is legitimately NEGATIVE on
-- loss-leaders; copying the gmv_ex_vat > 0 idiom onto it would silently delete
-- the loss side and overstate %GP.
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Treerak (May) Sangjua'               AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta' AS kam_name, 'panitan.p@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao' AS kam_name, 'sarawoot.k@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae' AS kam_name, 'nichamon.k@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Chanitsara (Koi)' AS kam_name, 'chanitsara.d@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Kritkanok (Wanmai)' AS kam_name, 'kritkanok.k@freshket.co' AS kam_email, 'PM' AS expected_owner)
  ])
),
-- v4: join via res_id (เหมือน Q8E) รองรับ account rename
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    k.kam_name,
    k.kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = k.expected_owner
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),
raw AS (
  SELECT
    ko.account_id,
    ko.kam_email,
    DATE_TRUNC(o.delivery_date, MONTH)             AS month_date,
    CAST(i.item_id AS STRING)                      AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '') AS dept,
    COALESCE(i.subclass_name, '')                  AS subclass,
    COALESCE(i.temperature, '')                    AS temperature,
    COALESCE(i.pack_size, '')                      AS pack_size,
    i.gmv_ex_vat,
    i.margin_ex_vat,   -- v_gp: sits on the same unnested item row as gmv_ex_vat
    i.qty,
    i.price_ex_vat,
    o.order_id,
    o.user_id,
    o.delivery_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ko ON CAST(o.user_id AS STRING) = ko.res_id
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
    -- v_gp: SUM, not SUM(IF(>0)) — negative margin must survive. NULL-safe so a
    -- row with no margin data contributes 0 to GP rather than nulling the whole
    -- account's sum; the client separately measures how much GMV actually had
    -- margin data (coverage) and hides GP below 70%.
    ROUND(SUM(COALESCE(r.margin_ex_vat, 0)), 2)                        AS margin_ex_vat,
    -- v_gp: GMV of the rows that DID carry margin — the client divides this by
    -- gmv_ex_vat to get coverage. Without it, missing margin is invisible and
    -- %GP silently reads low.
    ROUND(SUM(IF(r.margin_ex_vat IS NULL, 0, r.gmv_ex_vat)), 2)        AS gmv_with_margin,
    ROUND(SUM(r.qty), 3)                                               AS qty_kg,
    ROUND(SAFE_DIVIDE(SUM(r.gmv_ex_vat), NULLIF(SUM(r.qty),0)), 2)    AS unit_price,
    COUNT(DISTINCT r.order_id)                                         AS order_count,
    ROUND(AVG(r.price_ex_vat), 2)                                      AS avg_piece_price,
    COUNT(DISTINCT r.user_id)                                          AS outlet_count_sku,
    -- v207h: วันสั่งล่าสุดของ SKU นี้ในเดือนนั้น — ใช้สำหรับ approaching signal (order_count=1)
    FORMAT_DATE('%Y-%m-%d', MAX(r.delivery_date))                      AS last_order_date,
    -- v_key: วันสั่งครั้งแรกของ SKU นี้ในเดือนนั้น — ใช้แยก "เพิ่งเริ่มสั่งใหม่" (criterion ค)
    -- จาก SKU ที่สั่งมานานแล้วแต่บังเอิญ order_count=1 ในเดือนนี้
    FORMAT_DATE('%Y-%m-%d', MIN(r.delivery_date))                      AS first_order_date
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
  COALESCE(m.universal_ea_value, 0)   AS universal_ea_value,
  a.last_order_date,                   -- v207h: YYYY-MM-DD, ใช้คำนวณ approaching signal
  -- v_gp: appended LAST so every existing position p[0..18] stays byte-stable
  -- and the client's legacy pack_size offset trick (hasPackSize, 02_data_pipeline.js
  -- :413) is unaffected. Reads as p[19] / p[20] in the per-KAM file.
  a.margin_ex_vat,
  a.gmv_with_margin,
  a.first_order_date  -- v_key: appended LAST, reads as p[21]; see docs/supabase-migration-key-skus-2026-08-16.sql
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
