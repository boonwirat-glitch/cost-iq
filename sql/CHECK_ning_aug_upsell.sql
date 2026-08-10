-- ============================================================
-- ตรวจ upsell เดือน ส.ค. ของ Ning (duangruedee.bu@freshket.co)
-- รันใน BigQuery
--
-- ⚠ แก้จากรอบแรก: BigQuery ไม่รับชื่อคอลัมน์ภาษาไทย (Postgres รับ ผมเลยพลาด)
--   เปลี่ยนชื่อคอลัมน์เป็นอังกฤษหมดแล้ว ส่วนภาษาไทยเหลือแค่ในคอมเมนต์กับค่าที่ค้นหา
--
-- ปัญหา: ไฟล์ทีม (ที่ dashboard แสดง) บอกว่า ส.ค. Ning ได้
--          P1  ส้ม        ฿5,900
--          P1  ไก่บ้าน     ฿7,140
--          P3  LAGER BEER +฿11,836
--        แต่ไฟล์รายละเอียดรายสาขาของ Ning เอง ไม่มียอด ส.ค. ของทั้ง 3 กลุ่มเลย
--        (และ ไก่บ้าน ยังมียอดครบทั้ง เม.ย./พ.ค./มิ.ย. ซึ่งแปลว่าไม่ควรนับเป็น P1 ด้วยซ้ำ)
--
-- 3 บล็อก ไม่มีบล็อกไหนแก้ข้อมูล อ่านอย่างเดียวทั้งหมด ปลอดภัย
-- ============================================================




-- ============================================================
-- บล็อก 1 — ยอดขายจริงรายวันของ 3 กลุ่มนี้ ตั้งแต่ 1 ส.ค.
--
-- คอลัมน์:  delivery_date = วันที่ · group_key = กลุ่มสินค้า
--           outlet = สาขา · gmv = ยอดขาย
--
-- นี่คือบล็อกที่ตัดสิน:
--   ได้ยอดใกล้ 5,900 / 7,140 → ไฟล์ทีมถูก ไฟล์รายละเอียดตกข้อมูล
--   ได้ 0 หรือหลักร้อย       → ไฟล์ทีมนับผิด ต้องแก้ SQL ก่อน 1 ก.ย.
--   ไม่มีผลลัพธ์เลย (0 rows) → ไม่มีการขาย 3 กลุ่มนี้ใน ส.ค. จริงๆ
-- ============================================================

WITH kam_outlets AS (
  SELECT CAST(um.res_id AS STRING) AS outlet_id
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND LOWER(TRIM(um.staff_owner_email)) = 'duangruedee.bu@freshket.co'
)
SELECT
  o.delivery_date,
  CASE
    WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
         AND TRIM(COALESCE(i.item_family,'')) != ''
    THEN i.item_family ELSE i.subclass_name
  END AS group_key,
  CAST(o.user_id AS STRING) AS outlet,
  ROUND(SUM(i.gmv_ex_vat), 2) AS gmv
FROM `freshket-rn.dwh.order` o
CROSS JOIN UNNEST(o.item) AS i
JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.outlet_id
WHERE o.delivery_date >= DATE '2026-08-01'
  AND i.gmv_ex_vat > 0
  AND CASE
        WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
             AND TRIM(COALESCE(i.item_family,'')) != ''
        THEN i.item_family ELSE i.subclass_name
      END IN ('ส้ม', 'ไก่บ้าน', 'LAGER BEER')
GROUP BY 1, 2, 3
ORDER BY group_key, delivery_date, gmv DESC;




-- ============================================================
-- บล็อก 2 — คำนวณ P1/P3 ของ ส.ค. ใหม่ทั้งหมด ด้วยกติกาเดียวกับระบบเป๊ะ
--
--   ฐาน  = 1 เม.ย. – 30 มิ.ย. 2026
--   P1   = กลุ่มที่สาขานั้นไม่เคยซื้อเลยใน 3 เดือนฐาน และ ส.ค. >= 5,000
--   P3   = เคยซื้อแล้ว และ ส.ค. > (ฐานสูงสุดปรับ 30 วัน) x 2 และส่วนเพิ่ม >= 8,000
--   นับแยกทุกสาขา ไม่รวมข้ามสาขา
--
-- คอลัมน์:  kind = ประเภท · aug_gmv = ยอด ส.ค. · max_baseline = ฐานสูงสุด
--           uplift = ส่วนเพิ่ม
--
-- ต้องเห็น: รายการที่ผ่านเกณฑ์จริงของ ส.ค. — เอาไปเทียบกับ 13,040 / 11,836
--           ถ้าออกมา 0 rows แปลว่า ส.ค. ไม่มีอะไรผ่านเกณฑ์เลย
-- ============================================================

WITH kam_outlets AS (
  SELECT CAST(um.res_id AS STRING) AS outlet_id
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND LOWER(TRIM(um.staff_owner_email)) = 'duangruedee.bu@freshket.co'
),
lines AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    o.delivery_date,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.outlet_id
  WHERE o.delivery_date >= DATE '2026-04-01'
    AND i.gmv_ex_vat > 0
),
aug AS (
  SELECT outlet_id, group_key, SUM(gmv_ex_vat) AS aug_gmv
  FROM lines
  WHERE delivery_date >= DATE '2026-08-01'
  GROUP BY 1, 2
),
base_monthly AS (
  SELECT outlet_id, group_key,
         DATE_TRUNC(delivery_date, MONTH) AS mo,
         SUM(gmv_ex_vat) AS gmv
  FROM lines
  WHERE delivery_date BETWEEN DATE '2026-04-01' AND DATE '2026-06-30'
  GROUP BY 1, 2, 3
),
base AS (
  SELECT outlet_id, group_key,
         MAX(gmv / DATE_DIFF(DATE_ADD(mo, INTERVAL 1 MONTH), mo, DAY) * 30) AS max_bl
  FROM base_monthly
  GROUP BY 1, 2
)
SELECT
  CASE WHEN b.group_key IS NULL THEN 'P1_new' ELSE 'P3_growth' END AS kind,
  a.group_key,
  a.outlet_id AS outlet,
  ROUND(a.aug_gmv, 2) AS aug_gmv,
  ROUND(COALESCE(b.max_bl, 0), 2) AS max_baseline,
  ROUND(a.aug_gmv - COALESCE(b.max_bl, 0), 2) AS uplift
FROM aug a
LEFT JOIN base b
  ON a.outlet_id = b.outlet_id AND a.group_key = b.group_key
WHERE (b.group_key IS NULL AND a.aug_gmv >= 5000)
   OR (b.group_key IS NOT NULL
       AND a.aug_gmv > b.max_bl * 2.00
       AND a.aug_gmv - b.max_bl >= 8000)
ORDER BY kind, uplift DESC;




-- ============================================================
-- บล็อก 3 — สรุปเป็นตัวเลขเดียว เอาไปเทียบหน้าจอได้เลย
--
-- ต้องเห็น 2 แถว เทียบคอลัมน์ actual กับ dashboard_shows:
--   P1_total  →  dashboard แสดง 13,040
--   P3_total  →  dashboard แสดง 11,836.45
-- ตรงกันมั้ย?
-- ============================================================

WITH kam_outlets AS (
  SELECT CAST(um.res_id AS STRING) AS outlet_id
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND LOWER(TRIM(um.staff_owner_email)) = 'duangruedee.bu@freshket.co'
),
lines AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    o.delivery_date, i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.outlet_id
  WHERE o.delivery_date >= DATE '2026-04-01' AND i.gmv_ex_vat > 0
),
aug AS (
  SELECT outlet_id, group_key, SUM(gmv_ex_vat) AS aug_gmv
  FROM lines WHERE delivery_date >= DATE '2026-08-01' GROUP BY 1, 2
),
base_monthly AS (
  SELECT outlet_id, group_key, DATE_TRUNC(delivery_date, MONTH) AS mo, SUM(gmv_ex_vat) AS gmv
  FROM lines WHERE delivery_date BETWEEN DATE '2026-04-01' AND DATE '2026-06-30'
  GROUP BY 1, 2, 3
),
base AS (
  SELECT outlet_id, group_key,
         MAX(gmv / DATE_DIFF(DATE_ADD(mo, INTERVAL 1 MONTH), mo, DAY) * 30) AS max_bl
  FROM base_monthly GROUP BY 1, 2
),
j AS (
  SELECT a.outlet_id, a.group_key, a.aug_gmv, b.max_bl,
         (b.group_key IS NULL) AS is_new
  FROM aug a
  LEFT JOIN base b ON a.outlet_id = b.outlet_id AND a.group_key = b.group_key
)
SELECT 'P1_total' AS item,
       ROUND(SUM(CASE WHEN is_new AND aug_gmv >= 5000 THEN aug_gmv ELSE 0 END), 2) AS actual,
       13040.00 AS dashboard_shows
FROM j
UNION ALL
SELECT 'P3_total',
       ROUND(SUM(CASE WHEN NOT is_new
                       AND aug_gmv > max_bl * 2.00
                       AND aug_gmv - max_bl >= 8000
                      THEN aug_gmv - max_bl ELSE 0 END), 2),
       11836.45
FROM j;
