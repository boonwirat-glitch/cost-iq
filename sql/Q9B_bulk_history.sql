-- ════════════════════════════════════════════════════════════
-- Q9B v3: Bulk History — KAM accounts × 6 months
-- ════════════════════════════════════════════════════════════
-- Output: bulk_history.csv
-- Refresh: Weekly (จันทร์ 6:00 AM)
--
-- v3 fix: join GMV ผ่าน res_id (user_id ใน order) เหมือน Q8E
--   เพื่อรองรับ account ที่ rename แล้ว account_guid เปลี่ยน
--   แต่ res_id ยังคงเดิม → ไม่ drop ออกจาก bulk_history อีก
-- ════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Treerak (May) Sangjua'               AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta' AS kam_name, 'panitan.p@freshket.co' AS kam_email, CAST(NULL AS STRING) AS tl_email, 'PM' AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao' AS kam_name, 'sarawoot.k@freshket.co' AS kam_email, CAST(NULL AS STRING) AS tl_email, 'PM' AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae' AS kam_name, 'nichamon.k@freshket.co' AS kam_email, CAST(NULL AS STRING) AS tl_email, 'PM' AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM' AS expected_owner)
  ])
),

-- OWNERSHIP: user_master grain = outlet (res_id), 1 row/res_id
-- เหมือน Q8E — join GMV ผ่าน res_id ไม่ใช่ account_guid
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
)

SELECT
  ko.account_id,
  MAX(ko.account_name)                                                    AS account_name,
  CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
    WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
  END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING)
                                                                          AS month_label,
  ROUND(SUM(i.gmv_ex_vat), 0)                                            AS gmv,
  COUNT(DISTINCT o.order_id)                                              AS orders

FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i
INNER JOIN kam_outlets ko
  ON CAST(o.user_id AS STRING) = ko.res_id          -- join via res_id เหมือน Q8E

WHERE o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  AND o.delivery_date <  DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH)
  AND i.gmv_ex_vat > 0

GROUP BY 1, 3
ORDER BY 1, 3;
