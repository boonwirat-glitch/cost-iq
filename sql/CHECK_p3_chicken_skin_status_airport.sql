-- ══════════════════════════════════════════════════════════════════════════
-- ตรวจยอด P3 "หนัง /ไขมันไก่" ของร้าน Status Airport (outlet 223070)
-- งวด ก.ค. 2569 · เขียน 2026-08-08
--
-- ⚠ BigQuery ไม่รับชื่อคอลัมน์ภาษาไทย (Illegal input character "\340")
--   ชื่อคอลัมน์ทั้งหมดจึงเป็นอังกฤษ · คำอธิบายไทยอยู่ในคอมเมนต์เหนือแต่ละส่วน
--   ภาษาไทยที่อยู่ใน '...' (ค่าข้อมูล เช่น 'หนัง /ไขมันไก่') ใช้ได้ปกติ
--
-- อาการที่บุชเจอ:
--   Looker (dwh.order, item.gmv_ex_vat, item_name_th = 'หนังไก่')
--     ก.พ. 3,200 · มี.ค. 3,115 · เม.ย. 4,440 · พ.ค. 7,360 · มิ.ย. 14,080
--     ก.ค. 20,510 · ส.ค. 9,800
--   หน้า NRR / ชีท Commission KAM - July บอกว่า
--     ยอดเดือนนี้ (ก.ค.) = 20,510  ← ตรงกับ Looker เป๊ะ
--     ฐานสูงสุด        =  8,320  ← ไม่ตรง! มิ.ย. ใน Looker คือ 14,080
--     เดือนฐานสูง      = มิ.ย. 2569
--     ส่วนเพิ่ม 12,190 × rate 0.015 = ค่าคอมฯ 182.85
--
-- เบาะแส: 8,320 + 5,760 = 14,080 พอดี — ยอด มิ.ย. เหมือนถูก "หั่น" ไม่ใช่คิดคนละสูตร
--         และเดือน ก.ค. ตรงกันเป๊ะ → สูตรถูก แต่ข้อมูลฐานถูกทำหาย
--
-- สมมติฐานที่ SQL ชุดนี้ออกแบบมาแยกให้ขาด (เรียงตามที่น่าจะเป็นที่สุด):
--   A) คีย์ซ้ำจาก category — ก่อน v_dupfix (2026-08-08) q3c เอา category_high_level
--      ไว้ใน GROUP BY ด้วย · ถ้าของกลุ่มเดียวกันถูกตีเป็นคนละ category จะได้ 2 แถว
--      ต่อ (ร้าน,กลุ่ม,เดือน) เดียวกัน แล้ว parser ฝั่งแอปเขียนทับ เก็บแค่แถวสุดท้าย
--      → ฐานต่ำกว่าความจริง = ผ่านเกณฑ์ง่ายเกิน = เสี่ยงจ่ายเกิน
--      ถ้าใช่ → ไฟล์ที่ใช้อยู่รันก่อนแก้ ต้องรัน q3c ใหม่ ไม่ใช่บั๊กของสูตร
--   B) 'หนังไก่' ไม่ได้อยู่กลุ่ม 'หนัง /ไขมันไก่' ทุกเดือน (item_family ต้นทางไม่นิ่ง)
--   C) Looker นับคนละฐานวันที่ (เช่น order date) ส่วน q3c ใช้ delivery_date เสมอ
--   D) ตัวกรอง gmv_ex_vat > 0 ตัดบรรทัดติดลบ/คืนของออก ทำให้ยอดสองฝั่งต่างกัน
--
-- วิธีใช้: ไฮไลต์ทีละส่วนแล้วกด Run (แต่ละส่วนรันเดี่ยวได้ ไม่ต้องพึ่งกัน)
-- ตัวเลขงวดถูกตรึงเป็น Q3 2569 ไว้แล้ว จะรันวันไหนก็ได้ผลเดิม
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 1 · ความจริงระดับรายการสินค้า — ของชิ้นไหนอยู่กลุ่มไหน เดือนไหน
-- ตอบสมมติฐาน B และ D
--
-- ชื่อคอลัมน์:
--   mo                  = เดือน (นับตาม delivery_date)
--   item_name           = ชื่อสินค้า
--   q3c_group_key       = กลุ่มที่ q3c จะจัดให้ (นิยามเดียวกันเป๊ะ)
--   gmv_all_lines       = ยอดรวมทุกบรรทัด (รวมติดลบ)
--   gmv_positive_q3c    = ยอดเฉพาะบรรทัดบวก = ตัวที่ q3c ใช้จริง
--   gmv_filtered_out    = ยอดติดลบที่ถูกกรองทิ้ง (คืนของ/ปรับปรุง)
--
-- อ่านยังไง: ดู q3c_group_key ของแถว 'หนังไก่' ทุกเดือน ต้องเป็น 'หนัง /ไขมันไก่'
--            เหมือนกันหมด · ถ้าเดือนไหนต่าง = เจอต้นเหตุ (สมมติฐาน B)
--            ถ้า gmv_filtered_out มิ.ย. ประมาณ -5,760 = สมมติฐาน D
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  DATE_TRUNC(o.delivery_date, MONTH)            AS mo,
  i.item_name_th                                AS item_name,
  i.category_high_level                         AS category_high_level,
  i.item_family                                 AS item_family,
  i.subclass_name                               AS subclass_name,
  -- นิยาม group_key ของ q3c เป๊ะๆ (Meat/Vegetable/Fruit ใช้ item_family ที่เหลือใช้ subclass)
  CASE
    WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
         AND TRIM(COALESCE(i.item_family,'')) != ''
    THEN i.item_family ELSE i.subclass_name
  END                                           AS q3c_group_key,
  COUNT(*)                                      AS n_lines,
  ROUND(SUM(i.gmv_ex_vat), 2)                   AS gmv_all_lines,
  ROUND(SUM(IF(i.gmv_ex_vat > 0, i.gmv_ex_vat, 0)), 2)  AS gmv_positive_q3c,
  ROUND(SUM(IF(i.gmv_ex_vat <= 0, i.gmv_ex_vat, 0)), 2) AS gmv_filtered_out
FROM `freshket-rn.dwh.order` o
CROSS JOIN UNNEST(o.item) AS i
WHERE CAST(o.user_id AS STRING) = '223070'
  AND o.delivery_date >= DATE '2026-02-01'
  AND o.delivery_date <  DATE '2026-09-01'
  AND (
    i.item_name_th LIKE '%หนัง%'
    OR CASE
         WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
              AND TRIM(COALESCE(i.item_family,'')) != ''
         THEN i.item_family ELSE i.subclass_name
       END = 'หนัง /ไขมันไก่'
  )
GROUP BY 1,2,3,4,5,6
ORDER BY 1, gmv_all_lines DESC;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 2 · ยอดระดับ "กลุ่มสินค้า" รายเดือน ตามนิยาม q3c เป๊ะ
-- นี่คือตัวเลขที่ควรจะโผล่ในไฟล์ bundle → คือฐานที่หน้า NRR ใช้
--
-- ชื่อคอลัมน์:
--   n_items_in_group    = มีสินค้ากี่ชนิดในกลุ่มนี้เดือนนั้น
--   categories_found    = กลุ่มนี้ถูกตีเป็นหมวดอะไรบ้าง (ถ้ามีมากกว่า 1 = เข้าข่ายคีย์ซ้ำ)
--   total_gmv_expected  = ยอดกลุ่มที่ควรอยู่ในไฟล์
--
-- อ่านยังไง: แถว 2026-06-01 ได้เท่าไหร่?
--   ได้ 14,080 → ไฟล์ที่ใช้อยู่ผิด (ต้องรัน q3c ใหม่) ไปดูส่วนที่ 3 ต่อ
--   ได้  8,320 → สูตรให้ 8,320 จริง แปลว่า Looker นับคนละอย่าง ย้อนไปดูส่วนที่ 1
-- ══════════════════════════════════════════════════════════════════════════
WITH kam_outlets AS (
  -- mapping outlet→account→KAM ชุดเดียวกับ q3c (Q8E logic)
  SELECT
    CAST(um.res_id AS STRING)         AS res_id,
    CAST(um.account_guid AS STRING)   AS account_id,
    LOWER(TRIM(um.staff_owner_email)) AS kam_email
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
)
SELECT
  DATE_TRUNC(o.delivery_date, MONTH) AS mo,
  ka.account_id                      AS account_id,
  ka.kam_email                       AS kam_email,
  CASE
    WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
         AND TRIM(COALESCE(i.item_family,'')) != ''
    THEN i.item_family ELSE i.subclass_name
  END                                AS group_key,
  COUNT(DISTINCT i.item_name_th)     AS n_items_in_group,
  STRING_AGG(DISTINCT i.category_high_level ORDER BY i.category_high_level) AS categories_found,
  ROUND(SUM(i.gmv_ex_vat), 2)        AS total_gmv_expected
FROM `freshket-rn.dwh.order` o
CROSS JOIN UNNEST(o.item) AS i
JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
WHERE CAST(o.user_id AS STRING) = '223070'
  AND o.delivery_date >= DATE '2026-02-01'
  AND o.delivery_date <  DATE '2026-09-01'
  AND i.gmv_ex_vat > 0                      -- ตัวกรองเดียวกับ q3c ห้ามถอด
  AND CASE
        WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
             AND TRIM(COALESCE(i.item_family,'')) != ''
        THEN i.item_family ELSE i.subclass_name
      END = 'หนัง /ไขมันไก่'
GROUP BY 1,2,3,4
ORDER BY 1;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 3 · ตรวจ "คีย์ซ้ำ" — สมมติฐาน A (ตัวที่สงสัยที่สุด)
-- ก่อน v_dupfix ไฟล์ q3c จัดกลุ่มโดยเอา category_high_level ร่วมด้วย
-- ถ้ากลุ่มเดียวกันถูกตีเป็น 2 หมวด จะได้ 2 แถวต่อ (ร้าน,กลุ่ม,เดือน) เดียวกัน
-- แล้ว parser ของแอปเขียนทับกัน เก็บแค่แถวสุดท้าย → ฐานหายไปส่วนหนึ่ง
--
-- ชื่อคอลัมน์:
--   n_categories        = กลุ่มนี้ถูกแตกเป็นกี่หมวด (>1 = คีย์ซ้ำ)
--   categories_clashing = หมวดที่ชนกัน
--   gmv_true            = ยอดจริงรวมทุกหมวด
--   gmv_app_sees        = ยอดที่แอปเห็นจริง (แถวสุดท้ายชนะ = ตัวน้อยสุด
--                         เพราะไฟล์เรียง total_gmv DESC)
--   base_lost           = ฐานที่หายไป
--
-- อ่านยังไง: ถ้า mo = 2026-06-01 โผล่มาพร้อม n_categories > 1
--            และ gmv_app_sees = 8,320 → **ยืนยัน 100% ปิดเคสได้เลย**
--            ถ้าไม่มีแถวไหนโผล่เลย = สมมติฐาน A ตก ไปดูส่วนที่ 1/2 แทน
-- หมายเหตุ: สแกนทุกกลุ่มของร้านนี้ ไม่ใช่แค่หนังไก่ จะได้เห็นว่ากระทบกี่กลุ่ม
-- ══════════════════════════════════════════════════════════════════════════
WITH rows_raw AS (
  SELECT
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_key,
    i.category_high_level              AS category,
    SUM(i.gmv_ex_vat)                  AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE CAST(o.user_id AS STRING) = '223070'
    AND o.delivery_date >= DATE '2026-04-01'   -- คลุม pool ฐาน P3 (เม.ย.–มิ.ย.)
    AND o.delivery_date <  DATE '2026-08-01'
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3
)
SELECT
  mo,
  group_key,
  COUNT(*)                                      AS n_categories,
  STRING_AGG(category, ' | ' ORDER BY category) AS categories_clashing,
  ROUND(SUM(gmv), 2)                            AS gmv_true,
  ROUND(MIN(gmv), 2)                            AS gmv_app_sees,
  ROUND(SUM(gmv) - MIN(gmv), 2)                 AS base_lost
FROM rows_raw
GROUP BY 1,2
HAVING COUNT(*) > 1          -- เอาเฉพาะคีย์ที่ซ้ำจริง
ORDER BY base_lost DESC;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 4 · จำลองการคิด P3 ทั้งก้อน — ฐานสูงสุด / ยอดเดือนนี้ / ผ่านเกณฑ์ไหม
-- กติกา P3 (ต้องผ่านพร้อมกันทั้งสองข้อ):
--   ยอดเดือนนี้ > 2 × ฐานสูงสุด   และ   ส่วนที่โต ≥ ฿8,000
-- ฐานสูงสุด = MAX(total_gmv) ของ เม.ย./พ.ค./มิ.ย. 2569
-- ยอดเดือนนี้ = ยอด ก.ค. (P3 จริงใช้ existing_gmv = เฉพาะร้านที่อยู่ NRR core)
--
-- ชื่อคอลัมน์:
--   apr/may/jun/jul     = ยอดรายเดือน
--   max_baseline        = ฐานสูงสุดจาก 3 เดือน
--   growth_x            = โตกี่เท่า
--   growth_baht         = ส่วนที่โต (บาท)
--   nrr_core_status     = ร้านอยู่ NRR core ของ ก.ค. ไหม (ถ้าไม่อยู่ P3 ไม่ควรนับเลย)
--   rule_result         = ผลตามกติกา
--
-- อ่านยังไง: เทียบกับที่หน้าจอบอก — ฐาน 8,320 · ยอด 20,510 · โต 12,190 · ผ่านแล้ว
-- ══════════════════════════════════════════════════════════════════════════
WITH
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)         AS res_id,
    CAST(um.account_guid AS STRING)   AS account_id,
    LOWER(TRIM(um.staff_owner_email)) AS kam_email
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CAST(um.res_id AS STRING)
                             ORDER BY um.lasted_order_date DESC NULLS LAST) = 1
),
-- ความเป็นเจ้าของ ณ เดือนฐาน (มิ.ย.) และ ณ เดือนประเมิน (ก.ค.) — ต้องเป็น KAM คนเดียวกัน
own_base AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, TRIM(o.staff_owner) AS staff_owner,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner, DATE(o.new_user_exp_date) AS exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= DATE '2026-06-01' AND o.delivery_date < DATE '2026-07-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
own_cur AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, TRIM(o.staff_owner) AS staff_owner,
         UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= DATE '2026-07-01' AND o.delivery_date < DATE '2026-08-01'
    AND o.account_type IN ('SA','MC','Chain','Unknown') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
grp AS (
  SELECT
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    CAST(o.user_id AS STRING)          AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_key,
    SUM(i.gmv_ex_vat)                  AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE CAST(o.user_id AS STRING) = '223070'
    AND o.delivery_date >= DATE '2026-04-01'
    AND o.delivery_date <  DATE '2026-08-01'
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3
)
SELECT
  g.group_key                                                        AS group_key,
  ROUND(MAX(IF(g.mo = DATE '2026-04-01', g.gmv, 0)), 2)              AS apr,
  ROUND(MAX(IF(g.mo = DATE '2026-05-01', g.gmv, 0)), 2)              AS may,
  ROUND(MAX(IF(g.mo = DATE '2026-06-01', g.gmv, 0)), 2)              AS jun,
  ROUND(MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)), 2)              AS max_baseline,
  ROUND(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0)), 2)              AS jul,
  ROUND(SAFE_DIVIDE(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0)),
                    MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0))), 2) AS growth_x,
  ROUND(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
        - MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)), 2)            AS growth_baht,
  IF(ob.outlet_id IS NOT NULL AND oc.outlet_id IS NOT NULL
     AND ob.commercial_owner = 'KAM' AND oc.commercial_owner = 'KAM'
     AND TRIM(ob.staff_owner) = TRIM(oc.staff_owner)
     AND (ob.exp_date IS NULL OR ob.exp_date < DATE '2026-06-01'),
     'in_nrr_core', 'NOT_in_core_P3_should_be_zero')                 AS nrr_core_status,
  IF(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
       > 2 * MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0))
     AND MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
           - MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)) >= 8000,
     'PASS_P3', 'FAIL')                                              AS rule_result
FROM grp g
LEFT JOIN own_base ob ON ob.outlet_id = g.outlet_id
LEFT JOIN own_cur  oc ON oc.outlet_id = g.outlet_id
WHERE g.group_key = 'หนัง /ไขมันไก่'
GROUP BY g.group_key, ob.outlet_id, oc.outlet_id, ob.commercial_owner,
         oc.commercial_owner, ob.staff_owner, oc.staff_owner, ob.exp_date;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 5 (รันถ้าส่วนที่ 3 เจอคีย์ซ้ำ) · กระทบทั้งบริษัทแค่ไหน
-- นับว่ามีกี่คีย์ที่ฐานหายไป และรวมเป็นเงินเท่าไหร่ ทั่วทั้งพอร์ต KAM
-- ใช้ประเมินว่าต้องคิดค่าคอมฯ ก.ค. ใหม่ทั้งงวดหรือแค่แก้รายเคส
--
-- ชื่อคอลัมน์:
--   n_keys_affected     = จำนวนคีย์ (ร้าน×กลุ่ม×เดือน) ที่ฐานหาย
--   n_outlets_affected  = จำนวนร้านที่กระทบ
--   total_base_lost     = ฐานที่หายรวม (บาท)
--   worst_single_key    = คีย์เดียวที่หายมากสุด
--
-- ⚠ สแกน dwh.order 3 เดือนทั้งพอร์ต — ใช้โควตาพอสมควร รันตอนที่พร้อม
-- ══════════════════════════════════════════════════════════════════════════
WITH kam_outlets AS (
  SELECT CAST(um.res_id AS STRING) AS res_id, CAST(um.account_guid AS STRING) AS account_id
  FROM `freshket-rn.dim.user_master` um
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CAST(um.res_id AS STRING)
                             ORDER BY um.lasted_order_date DESC NULLS LAST) = 1
),
rows_raw AS (
  SELECT
    ka.account_id                      AS account_id,
    CAST(o.user_id AS STRING)          AS outlet_id,
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_key,
    i.category_high_level              AS category,
    SUM(i.gmv_ex_vat)                  AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE '2026-04-01'
    AND o.delivery_date <  DATE '2026-07-01'      -- เฉพาะ pool ฐาน P3
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3,4,5
),
dup AS (
  SELECT account_id, outlet_id, mo, group_key,
         COUNT(*)  AS n_cat,
         SUM(gmv)  AS gmv_true,
         MIN(gmv)  AS gmv_app_sees
  FROM rows_raw
  GROUP BY 1,2,3,4
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)                                         AS n_keys_affected,
  COUNT(DISTINCT outlet_id)                        AS n_outlets_affected,
  ROUND(SUM(gmv_true - gmv_app_sees), 2)           AS total_base_lost,
  ROUND(MAX(gmv_true - gmv_app_sees), 2)           AS worst_single_key
FROM dup;
