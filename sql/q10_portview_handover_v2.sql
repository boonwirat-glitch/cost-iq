-- Q10_FINAL: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- Logic:
--   Sales→KAM = outlet ที่มี commercial_owner=SALE ใน 3 เดือนที่แล้ว
--               แล้ว commercial_owner=KAM ในเดือนนี้
--   Source 1:  order table (outlet ที่มี SALE order ใน Mar-Apr)
--   Source 2:  user_master (outlet ที่เป็น KAM แล้ว + มี SALE order ใน 3 เดือนย้อนหลัง
--              แต่ไม่มีใน Mar-Apr เพราะโอนก่อนหน้า)
--   gmv_apr:   GMV เดือน Apr ของ outlet นั้น (ไม่สน owner)
--              อาจเป็น 0 ถ้า outlet ยังไม่มี order ใน Apr
--
-- Output columns:
--   user_id, account_id, account_name, sales_owner, new_kam_name, gmv_apr

WITH kam_list AS (
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
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

-- SALE orders เฉพาะ 3 เดือนย้อนหลังนับจากเดือนปัจจุบัน
last_sale_order AS (
  SELECT
    CAST(user_id AS STRING)    AS user_id,
    CAST(account_id AS STRING) AS account_id,
    MAX(account_name)          AS account_name,
    ARRAY_AGG(staff_owner ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS sales_owner
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND commercial_owner = 'SALE'
    AND delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH)
    AND delivery_date < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY 1, 2
),

-- Source 1: outlet ที่มี SALE order ใน M-2 หรือ M-1
apr_from_orders AS (
  SELECT
    CAST(user_id AS STRING)    AS user_id,
    CAST(account_id AS STRING) AS account_id,
    MAX(account_name)          AS account_name,
    ARRAY_AGG(staff_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS sales_owner,
    SUM(CASE WHEN delivery_date BETWEEN
          DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
          AND DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)
        THEN gmv_ex_vat ELSE 0 END) AS gmv_apr
  FROM `freshket-rn.dwh.order`
  WHERE delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH), MONTH)
    AND delivery_date < DATE_TRUNC(CURRENT_DATE(), MONTH)
    AND commercial_owner = 'SALE'
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1, 2
),

-- Source 2: outlet ที่ user_master=KAM แล้ว + มี SALE order ใน 3 เดือนย้อนหลัง
--           แต่ไม่อยู่ใน Source 1 (SALE order เกิดก่อน M-2)
apr_from_master AS (
  SELECT
    CAST(um.res_id AS STRING)       AS user_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    ls.sales_owner,
    0                               AS gmv_apr
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  JOIN last_sale_order ls ON CAST(um.res_id AS STRING) = ls.user_id
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
    AND um.commercial_owner = 'KAM'
    AND um.res_id IS NOT NULL
    AND CAST(um.res_id AS STRING) NOT IN (SELECT user_id FROM apr_from_orders)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

apr AS (
  SELECT * FROM apr_from_orders
  UNION ALL
  SELECT * FROM apr_from_master
),

-- KAM ที่รับใน M (เดือนนี้) จาก order
may_orders AS (
  SELECT
    CAST(user_id AS STRING) AS user_id,
    ARRAY_AGG(staff_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS new_kam_name
  FROM `freshket-rn.dwh.order`
  WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
    AND commercial_owner = 'KAM'
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- KAM จาก user_master สำหรับ outlet ที่ยังไม่มี order เดือนนี้
user_master_kam AS (
  SELECT
    CAST(um.res_id AS STRING) AS user_id,
    k.kam_name                AS new_kam_name
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
    AND um.commercial_owner = 'KAM'
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
)

SELECT
  a.user_id,
  a.account_id,
  a.account_name,
  a.sales_owner,
  COALESCE(mo.new_kam_name, um.new_kam_name) AS new_kam_name,
  ROUND(a.gmv_apr)                           AS gmv_apr
FROM apr a
LEFT JOIN may_orders mo      ON a.user_id = mo.user_id
LEFT JOIN user_master_kam um ON a.user_id = um.user_id
WHERE COALESCE(mo.new_kam_name, um.new_kam_name) IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.user_id
  ORDER BY a.gmv_apr DESC
) = 1
ORDER BY COALESCE(mo.new_kam_name, um.new_kam_name), a.gmv_apr DESC
