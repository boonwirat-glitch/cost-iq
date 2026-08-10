-- ============================================================
-- หา "ด่าน" ที่ทำให้ 6 ร้านของ Ning หลุดจากไฟล์ KAM ทั้งที่ไฟล์ทีมนับ
-- รันใน BigQuery · อ่านอย่างเดียวทั้ง 2 บล็อก ไม่แก้ข้อมูล
--
-- วิธีสืบ: เอา 6 ร้านที่หาย + 2 ร้านควบคุม (อยู่ในไฟล์ KAM ปกติ) มาเรียงเทียบกัน
--          คอลัมน์ไหนที่กลุ่ม missing_ ต่างจากกลุ่ม control_ = ด่านที่ทำให้หลุด
--
-- ด่านของไฟล์ KAM มี 5 ด่าน (ผ่านครบถึงจะถูกนับ P1/P3):
--   A ทะเบียนปัจจุบัน (user_master) ต้องชี้ว่าร้านเป็นของ Ning และเป็น 'KAM'
--   B ร้านต้องมีออเดอร์ในเดือนฐาน (มิ.ย.)
--   C ออเดอร์ล่าสุดเดือน มิ.ย. ต้องเขียนชื่อ 'Duangruedee (Ning) Bulalom'
--     และ commercial_owner = 'KAM' และ account_type ใน SA/MC/Chain/Unknown
--   D ออเดอร์ล่าสุดเดือน ส.ค. ต้องผ่านเงื่อนไขเดียวกับ C
--   E ไม่ใช่ร้านใหม่ช่วงโปร (new_user_exp_date ว่าง หรือ < 1 มิ.ย.)
-- ============================================================




-- ============================================================
-- บล็อก 1 — รูปถ่ายทะเบียนรายเดือน (เม.ย.–ส.ค.) ของทั้ง 8 ร้าน
--
-- ต้องเห็น: ~30-40 แถว (ร้านละ 1 แถวต่อเดือนที่มีออเดอร์)
--
-- วิธีอ่าน — เทียบแถว missing_ กับ control_ ทีละคอลัมน์:
--   ร้าน missing ไม่มีแถวเดือน 2026-06 เลย   → หลุดด่าน B (ไม่ได้ซื้อเดือนฐาน)
--   last_staff_owner ไม่ใช่ 'Duangruedee (Ning) Bulalom' → หลุดด่าน C/D (ชื่อในออเดอร์)
--   last_commercial_owner ไม่ใช่ 'KAM'       → หลุดด่าน C/D
--   last_account_type ไม่อยู่ใน SA/MC/Chain/Unknown → หลุดด่าน C/D
--   new_user_exp ตั้งแต่ 2026-06-01 ขึ้นไป    → หลุดด่าน E (ร้านใหม่ช่วงโปร)
-- ============================================================

WITH target AS (
  SELECT outlet_id, tag FROM UNNEST([
    STRUCT('250355' AS outlet_id, 'missing_P1_kaiban'  AS tag),
    STRUCT('173144' AS outlet_id, 'missing_P1_som'     AS tag),
    STRUCT('231793' AS outlet_id, 'missing_P3_beer'    AS tag),
    STRUCT('248104' AS outlet_id, 'missing_kaiban2'    AS tag),
    STRUCT('239070' AS outlet_id, 'missing_beer2'      AS tag),
    STRUCT('231668' AS outlet_id, 'missing_beer3'      AS tag),
    STRUCT('180261' AS outlet_id, 'control_in_file_1'  AS tag),
    STRUCT('55864'  AS outlet_id, 'control_in_file_2'  AS tag)
  ])
),
ords AS (
  SELECT
    t.tag,
    t.outlet_id,
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    o.delivery_date,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    o.account_type,
    DATE(o.new_user_exp_date)       AS new_user_exp_date,
    (SELECT SUM(i.gmv_ex_vat) FROM UNNEST(o.item) i) AS order_gmv
  FROM `freshket-rn.dwh.order` o
  JOIN target t ON CAST(o.user_id AS STRING) = t.outlet_id
  WHERE o.delivery_date >= DATE '2026-04-01'
)
SELECT
  tag,
  outlet_id,
  FORMAT_DATE('%Y-%m', mo) AS month,
  COUNT(*)                 AS orders,
  ROUND(SUM(order_gmv), 0) AS gmv,
  ARRAY_AGG(staff_owner       ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS last_staff_owner,
  ARRAY_AGG(commercial_owner  ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS last_commercial_owner,
  ARRAY_AGG(account_type      ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS last_account_type,
  ARRAY_AGG(CAST(new_user_exp_date AS STRING) ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS new_user_exp
FROM ords
GROUP BY tag, outlet_id, mo
ORDER BY tag, outlet_id, mo;




-- ============================================================
-- บล็อก 2 — ทะเบียนปัจจุบัน (ด่าน A) + วันเกิดร้าน (ด่านจัดประเภท)
--
-- ต้องเห็น: 8 แถว (ร้านละแถว)
--
-- วิธีอ่าน:
--   staff_owner_email ไม่ใช่ duangruedee.bu@freshket.co → หลุดด่าน A
--   commercial_owner ไม่ใช่ 'KAM'                       → หลุดด่าน A
--   first_seen_since_jan ตั้งแต่ 2026-07-01 ขึ้นไป      → ร้านเกิดใหม่ในไตรมาส
--     (นี่คือจุดที่สองไฟล์ต่างกันจริง: ไฟล์ทีมนับร้านเกิดตั้งแต่ 1 ก.ค. เป็น
--      Expansion ต่อทั้งไตรมาส แต่ไฟล์ KAM นับเฉพาะร้านเกิดเดือนที่คิด
--      ร้านเกิด ก.ค. เลยโดนไฟล์ KAM ทิ้งตอนคิด ส.ค.)
-- ============================================================

WITH target AS (
  SELECT outlet_id, tag FROM UNNEST([
    STRUCT('250355' AS outlet_id, 'missing_P1_kaiban'  AS tag),
    STRUCT('173144' AS outlet_id, 'missing_P1_som'     AS tag),
    STRUCT('231793' AS outlet_id, 'missing_P3_beer'    AS tag),
    STRUCT('248104' AS outlet_id, 'missing_kaiban2'    AS tag),
    STRUCT('239070' AS outlet_id, 'missing_beer2'      AS tag),
    STRUCT('231668' AS outlet_id, 'missing_beer3'      AS tag),
    STRUCT('180261' AS outlet_id, 'control_in_file_1'  AS tag),
    STRUCT('55864'  AS outlet_id, 'control_in_file_2'  AS tag)
  ])
),
first_seen AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         MIN(o.delivery_date) AS first_seen_since_jan
  FROM `freshket-rn.dwh.order` o
  JOIN target t ON CAST(o.user_id AS STRING) = t.outlet_id
  WHERE o.delivery_date >= DATE '2026-01-01'
  GROUP BY 1
)
SELECT
  t.tag,
  t.outlet_id,
  fs.first_seen_since_jan,
  um.staff_owner_email,
  um.commercial_owner,
  um.account_type,
  CAST(um.lasted_order_date AS STRING) AS lasted_order_date
FROM target t
LEFT JOIN first_seen fs ON fs.outlet_id = t.outlet_id
LEFT JOIN `freshket-rn.dim.user_master` um
  ON CAST(um.res_id AS STRING) = t.outlet_id
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY t.outlet_id
  ORDER BY um.lasted_order_date DESC NULLS LAST
) = 1
ORDER BY t.tag;
