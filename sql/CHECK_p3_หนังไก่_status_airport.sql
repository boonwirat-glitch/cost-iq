-- ══════════════════════════════════════════════════════════════════════════
-- ตรวจยอด P3 "หนัง /ไขมันไก่" ของร้าน Status Airport (outlet 223070)
-- งวด ก.ค. 2569 · เขียน 2026-08-08
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
-- คำถามเดียวที่ต้องตอบ: ทำไมฐาน มิ.ย. ถึงเป็น 8,320 ไม่ใช่ 14,080
--
-- สมมติฐานที่ SQL ชุดนี้ออกแบบมาแยกให้ขาด (เรียงตามที่ผมคิดว่าน่าจะเป็นที่สุด):
--   A) คีย์ซ้ำจาก category — ก่อน v_dupfix (2026-08-08) q3c เอา category_high_level
--      ไว้ใน GROUP BY ด้วย · ถ้าของกลุ่มเดียวกันถูกตีเป็นคนละ category จะได้ 2 แถว
--      ต่อ (ร้าน,กลุ่ม,เดือน) เดียวกัน แล้ว parser ฝั่งแอปเขียนทับ เก็บแค่แถวสุดท้าย
--      → ฐานต่ำกว่าความจริง (14,080 แตกเป็น 8,320 + 5,760 = ตรงกับส่วนต่างพอดี)
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
-- ตอบสมมติฐาน B: 'หนังไก่' ย้ายกลุ่มระหว่างเดือนไหม
-- อ่านยังไง: ดูคอลัมน์ group_key ของแถว 'หนังไก่' ทุกเดือน ต้องเป็น
--            'หนัง /ไขมันไก่' เหมือนกันหมด · ถ้าเดือนไหนต่าง = เจอต้นเหตุ
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  DATE_TRUNC(o.delivery_date, MONTH)            AS เดือน,
  i.item_name_th                                AS ชื่อสินค้า,
  i.category_high_level                         AS หมวดใหญ่,
  i.item_family                                 AS item_family,
  i.subclass_name                               AS subclass_name,
  -- นิยาม group_key ของ q3c เป๊ะๆ (Meat/Vegetable/Fruit ใช้ item_family ที่เหลือใช้ subclass)
  CASE
    WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
         AND TRIM(COALESCE(i.item_family,'')) != ''
    THEN i.item_family ELSE i.subclass_name
  END                                           AS group_key_ที่q3cใช้,
  COUNT(*)                                      AS จำนวนบรรทัด,
  ROUND(SUM(i.gmv_ex_vat), 2)                   AS gmv_ทุกบรรทัด,
  -- q3c กรอง gmv_ex_vat > 0 ทิ้งบรรทัดคืนของ/ติดลบ — แยกให้เห็นว่าต่างกันแค่ไหน
  ROUND(SUM(IF(i.gmv_ex_vat > 0, i.gmv_ex_vat, 0)), 2) AS gmv_เฉพาะบวก_แบบq3c,
  ROUND(SUM(IF(i.gmv_ex_vat <= 0, i.gmv_ex_vat, 0)), 2) AS gmv_ที่ถูกกรองทิ้ง
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
ORDER BY 1, gmv_ทุกบรรทัด DESC;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 2 · ยอดระดับ "กลุ่มสินค้า" รายเดือน ตามนิยาม q3c เป๊ะ
-- นี่คือตัวเลขที่ควรจะโผล่ในไฟล์ bundle → คือฐานที่หน้า NRR ใช้
-- อ่านยังไง: แถว มิ.ย. 2026 ควรได้เท่าไหร่?
--            ถ้าได้ 14,080 → ไฟล์ที่ใช้อยู่ผิด (ต้องรัน q3c ใหม่) ไปดูส่วนที่ 3 ต่อ
--            ถ้าได้  8,320 → สูตรให้ 8,320 จริง แปลว่า Looker นับคนละอย่าง ดูส่วนที่ 1
-- ══════════════════════════════════════════════════════════════════════════
WITH kam_outlets AS (
  -- mapping outlet→account→KAM ชุดเดียวกับ q3c (Q8E logic)
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
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
  DATE_TRUNC(o.delivery_date, MONTH) AS เดือน,
  ka.account_id                      AS account_id,
  ka.kam_email                       AS kam,
  CASE
    WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
         AND TRIM(COALESCE(i.item_family,'')) != ''
    THEN i.item_family ELSE i.subclass_name
  END                                AS group_key,
  COUNT(DISTINCT i.item_name_th)     AS จำนวนสินค้าในกลุ่ม,
  STRING_AGG(DISTINCT i.category_high_level ORDER BY i.category_high_level) AS หมวดที่พบ,
  ROUND(SUM(i.gmv_ex_vat), 2)        AS total_gmv_ที่ควรเป็น
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
-- ส่วนที่ 3 · ตรวจ "คีย์ซ้ำ" — สมมติฐาน A (ตัวที่ผมสงสัยที่สุด)
-- ก่อน v_dupfix ไฟล์ q3c จัดกลุ่มโดยเอา category_high_level ร่วมด้วย
-- ถ้ากลุ่มเดียวกันถูกตีเป็น 2 หมวด จะได้ 2 แถวต่อ (ร้าน,กลุ่ม,เดือน) เดียวกัน
-- แล้ว parser ของแอปเขียนทับกัน เก็บแค่แถวสุดท้าย → ฐานหายไปครึ่งหนึ่ง
--
-- อ่านยังไง: ถ้าคอลัมน์ จำนวนหมวด > 1 ในเดือน มิ.ย. → **เจอต้นเหตุแล้ว**
--            เทียบ gmv_รวมจริง กับ gmv_ถ้าเก็บแค่แถวสุดท้าย
--            ถ้า gmv_ถ้าเก็บแค่แถวสุดท้าย ออกมา 8,320 = ยืนยัน 100%
-- หมายเหตุ: สแกนทุกกลุ่มของร้านนี้ ไม่ใช่แค่หนังไก่ จะได้เห็นว่ากระทบกี่กลุ่ม
-- ══════════════════════════════════════════════════════════════════════════
WITH rows_raw AS (
  SELECT
    DATE_TRUNC(o.delivery_date, MONTH) AS เดือน,
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
  เดือน,
  group_key,
  COUNT(*)                                   AS จำนวนหมวด,       -- >1 = คีย์ซ้ำ
  STRING_AGG(category, ' | ' ORDER BY category) AS หมวดที่ชนกัน,
  ROUND(SUM(gmv), 2)                         AS gmv_รวมจริง,
  -- parser เขียนทับตามลำดับแถวใน CSV ซึ่งเรียง total_gmv DESC → แถวสุดท้าย = ตัวน้อยสุด
  ROUND(MIN(gmv), 2)                         AS gmv_ถ้าเก็บแค่แถวสุดท้าย,
  ROUND(SUM(gmv) - MIN(gmv), 2)              AS ฐานที่หายไป
FROM rows_raw
GROUP BY 1,2
HAVING COUNT(*) > 1          -- เอาเฉพาะคีย์ที่ซ้ำจริง · ถ้าไม่มีแถวเลย = สมมติฐาน A ตก
ORDER BY ฐานที่หายไป DESC;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 4 · จำลองการคิด P3 ทั้งก้อน — ฐานสูงสุด / ยอดเดือนนี้ / ผ่านเกณฑ์ไหม
-- กติกา P3 (ต้องผ่านพร้อมกันทั้งสองข้อ):
--   ยอดเดือนนี้ > 2 × ฐานสูงสุด   และ   ส่วนที่โต ≥ ฿8,000
-- ฐานสูงสุด = MAX(total_gmv) ของ 3 เดือน เม.ย./พ.ค./มิ.ย. 2569
-- ยอดเดือนนี้ = existing_gmv ของ ก.ค. (เฉพาะร้านที่อยู่ NRR core เท่านั้น)
--
-- อ่านยังไง: เทียบกับที่หน้าจอบอก — ฐาน 8,320 · ยอด 20,510 · โต 12,190 · ผ่านแล้ว
-- ══════════════════════════════════════════════════════════════════════════
WITH
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
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
  g.group_key                                                        AS กลุ่มสินค้า,
  ROUND(MAX(IF(g.mo = DATE '2026-04-01', g.gmv, 0)), 2)              AS เมย,
  ROUND(MAX(IF(g.mo = DATE '2026-05-01', g.gmv, 0)), 2)              AS พค,
  ROUND(MAX(IF(g.mo = DATE '2026-06-01', g.gmv, 0)), 2)              AS มิย,
  ROUND(MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)), 2)              AS ฐานสูงสุด,
  ROUND(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0)), 2)              AS ยอดกค,
  ROUND(SAFE_DIVIDE(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0)),
                    MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0))), 2) AS กี่เท่า,
  ROUND(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
        - MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)), 2)            AS ส่วนที่โต,
  -- ร้านนี้อยู่ใน NRR core ของ ก.ค. ไหม (ถ้าไม่อยู่ existing_gmv = 0 → P3 ไม่นับเลย)
  IF(ob.outlet_id IS NOT NULL AND oc.outlet_id IS NOT NULL
     AND ob.commercial_owner = 'KAM' AND oc.commercial_owner = 'KAM'
     AND TRIM(ob.staff_owner) = TRIM(oc.staff_owner)
     AND (ob.exp_date IS NULL OR ob.exp_date < DATE '2026-06-01'),
     'อยู่ใน NRR core', 'ไม่อยู่ — P3 ไม่ควรนับ')                     AS สถานะ_nrr_core,
  IF(MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
       > 2 * MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0))
     AND MAX(IF(g.mo = DATE '2026-07-01', g.gmv, 0))
           - MAX(IF(g.mo < DATE '2026-07-01', g.gmv, 0)) >= 8000,
     'ผ่าน P3', 'ไม่ผ่าน')                                            AS ผลตามกติกา
FROM grp g
LEFT JOIN own_base ob ON ob.outlet_id = g.outlet_id
LEFT JOIN own_cur  oc ON oc.outlet_id = g.outlet_id
WHERE g.group_key = 'หนัง /ไขมันไก่'
GROUP BY g.group_key, ob.outlet_id, oc.outlet_id, ob.commercial_owner,
         oc.commercial_owner, ob.staff_owner, oc.staff_owner, ob.exp_date;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 5 (ถ้าส่วนที่ 3 เจอคีย์ซ้ำ) · กระทบทั้งบริษัทแค่ไหน
-- นับว่ามีกี่คีย์ที่ฐานหายไป และรวมเป็นเงินเท่าไหร่ ทั่วทั้งพอร์ต KAM
-- ใช้ประเมินว่าต้องคิดค่าคอมฯ ก.ค. ใหม่ทั้งงวดหรือแค่แก้ไฟล์
-- ⚠ สแกนทั้ง dwh.order 4 เดือน — ใช้โควตาพอสมควร รันตอนที่พร้อม
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
    ka.account_id,
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
         COUNT(*) AS n_cat, SUM(gmv) AS gmv_จริง, MIN(gmv) AS gmv_ที่แอปเห็น
  FROM rows_raw
  GROUP BY 1,2,3,4
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)                                        AS จำนวนคีย์ที่ฐานหาย,
  COUNT(DISTINCT outlet_id)                       AS จำนวนร้านที่กระทบ,
  ROUND(SUM(gmv_จริง - gmv_ที่แอปเห็น), 2)         AS ฐานที่หายรวมบาท,
  ROUND(MAX(gmv_จริง - gmv_ที่แอปเห็น), 2)         AS หายมากสุดคีย์เดียว
FROM dup;
