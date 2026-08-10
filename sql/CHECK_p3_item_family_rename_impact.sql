-- ══════════════════════════════════════════════════════════════════════════
-- ผลกระทบจากการ "เปลี่ยนชื่อ item_family กลางคัน" ต่อค่าคอมฯ P1/P3
-- เขียน 2026-08-08 · ต่อจาก CHECK_p3_chicken_skin_status_airport.sql
--
-- สิ่งที่พิสูจน์แล้วจากเคส Status Airport (outlet 223070):
--   สินค้า 'หนังไก่' ชิ้นเดียวกัน ถูกเปลี่ยน item_family กลางเดือน มิ.ย. 2569
--     ก.พ.–พ.ค.  item_family = 'หนังไก่'
--     มิ.ย.      แตกเป็นสองค่า: 'หนัง /ไขมันไก่' 8,320 + 'หนังไก่' 5,760 = 14,080
--     ก.ค.–ส.ค.  item_family = 'หนัง /ไขมันไก่' ทั้งหมด
--   q3c ใช้ item_family เป็น group_key โดยตรง → กลุ่ม 'หนัง /ไขมันไก่' จึง
--   "เกิดใหม่" กลางเดือน มิ.ย. และมีฐานแค่ 8,320 แทนที่จะเป็น 14,080
--     ระบบเห็น: 20,510 / 8,320  = 2.47x, โต 12,190 → ผ่าน P3 → จ่าย ฿182.85
--     ความจริง: 20,510 / 14,080 = 1.46x, โต  6,430 → ไม่ผ่านทั้งสองเงื่อนไข
--
-- นี่คนละบั๊กกับ v_dupfix (คีย์ซ้ำจาก category) ที่วัดได้แล้ว 848 คีย์ / ฿1.8M
--   v_dupfix  = group_key เดียวกัน แต่ category ต่าง → 2 แถว → parser เขียนทับ
--   ตัวนี้     = item_family เปลี่ยนชื่อ → group_key คนละตัว → ประวัติขาดตอน
-- อันนี้ v_dupfix แก้ไม่ได้ เพราะ group_key ต่างกันจริงๆ ไม่ใช่คีย์ซ้ำ
--
-- ทิศทางความเสียหาย: ฐานต่ำกว่าจริงเสมอ → ผ่านเกณฑ์ง่ายเกิน → **จ่ายเกิน**
-- และกลุ่มที่ "เกิดใหม่" ยังอาจไปเข้าเงื่อนไข P1 (กลุ่มสินค้าใหม่ ≥ ฿5,000) ด้วย
--
-- ⚠ ชื่อคอลัมน์เป็นอังกฤษ (BigQuery ไม่รับ identifier ภาษาไทย)
-- ⚠ ทั้งสองส่วนสแกน dwh.order 4 เดือนทั้งพอร์ต KAM — ใช้โควตาพอสมควร
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 6 · สำมะโนการเปลี่ยนชื่อ — มีสินค้ากี่ตัวที่ย้าย item_family
-- ในช่วง เม.ย.–ก.ค. 2569 (คลุมทั้ง pool ฐาน P3 และเดือนประเมิน)
--
-- ชื่อคอลัมน์:
--   item_id             = รหัสสินค้า (ตัวเดียวกันตลอด แม้ชื่อกลุ่มจะเปลี่ยน)
--   item_name           = ชื่อสินค้า
--   n_group_keys        = ถูกจัดเข้ากี่กลุ่มในช่วงนี้ (>1 = โดนเปลี่ยนชื่อ)
--   group_keys          = รายชื่อกลุ่มที่เคยอยู่ เรียงตามเวลา
--   first_mo / last_mo  = เดือนแรก/สุดท้ายที่พบ
--   gmv_total           = ยอดรวมทั้งช่วง (ใช้จัดลำดับความสำคัญ)
--
-- อ่านยังไง: แถวบนสุดคือสินค้าที่ยอดใหญ่ที่สุดที่โดนเปลี่ยนชื่อ
--            ถ้าลิสต์ยาว = ปัญหาเชิงระบบของ master data ไม่ใช่เคสเดียว
-- ══════════════════════════════════════════════════════════════════════════
WITH item_month AS (
  SELECT
    i.item_id                          AS item_id,
    ANY_VALUE(i.item_name_th)          AS item_name,
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_key,
    SUM(i.gmv_ex_vat)                  AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= DATE '2026-04-01'
    AND o.delivery_date <  DATE '2026-08-01'
    AND i.gmv_ex_vat > 0
    AND i.item_id IS NOT NULL
  GROUP BY 1,3,4
)
SELECT
  item_id,
  ANY_VALUE(item_name)                                   AS item_name,
  COUNT(DISTINCT group_key)                              AS n_group_keys,
  STRING_AGG(DISTINCT group_key, '  →  ')                AS group_keys,
  MIN(mo)                                                AS first_mo,
  MAX(mo)                                                AS last_mo,
  ROUND(SUM(gmv), 2)                                     AS gmv_total
FROM item_month
GROUP BY item_id
HAVING COUNT(DISTINCT group_key) > 1
ORDER BY gmv_total DESC
LIMIT 200;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 7 · เทียบคำตัดสิน P3 "ตามที่ระบบเห็น" กับ "ถ้าชื่อกลุ่มนิ่ง"
-- วิธีทำให้นิ่ง: ยึด item_family ล่าสุดของสินค้าแต่ละตัว (ตาม item_id) แล้ว
-- ย้อนไปจัดกลุ่มประวัติทุกเดือนใหม่ด้วยชื่อนั้น — เหมือนที่ควรเป็นตั้งแต่แรก
--
-- แสดงเฉพาะแถวที่ "คำตัดสินเปลี่ยน" เท่านั้น (as_is ≠ stable)
--
-- ชื่อคอลัมน์:
--   verdict_as_is / verdict_stable = ผลตามที่ระบบเห็น / ผลถ้าชื่อกลุ่มนิ่ง
--   base_as_is / base_stable       = ฐานสูงสุด (เม.ย.–มิ.ย.) ของแต่ละแบบ
--   jul_as_is / jul_stable         = ยอด ก.ค. (เฉพาะร้านใน NRR core = ที่ P3 ใช้)
--   growth_as_is / growth_stable   = ส่วนที่โต
--   baht_impact                    = ค่าคอมฯ ที่คลาดเคลื่อน ที่ rate 0.015
--                                    (บวก = จ่ายเกิน · ลบ = จ่ายขาด)
--                                    ⚠ rate จริงตั้งใน Cockpit และมี category
--                                    bonus รายหมวด — เลขนี้เป็นค่าประมาณ
--
-- อ่านยังไง: ผลรวมของ baht_impact = ขนาดความคลาดเคลื่อนของค่าคอมฯ P3 งวด ก.ค.
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
-- NRR core: KAM คนเดียวกันทั้งเดือนฐาน (มิ.ย.) และเดือนประเมิน (ก.ค.) + ไม่ใช่ร้านใหม่
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
nrr_core AS (
  SELECT ob.outlet_id
  FROM own_base ob
  JOIN own_cur oc ON oc.outlet_id = ob.outlet_id
  WHERE ob.commercial_owner = 'KAM' AND oc.commercial_owner = 'KAM'
    AND TRIM(ob.staff_owner) = TRIM(oc.staff_owner)
    AND (ob.exp_date IS NULL OR ob.exp_date < DATE '2026-06-01')
),
-- บรรทัดสินค้าดิบ พร้อม group_key สองแบบ
lines AS (
  SELECT
    ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING)          AS outlet_id,
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    i.item_id                          AS item_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_as_is,
    -- ชื่อกลุ่ม "ล่าสุด" ของสินค้าตัวนี้ในช่วงที่ดู → ใช้ย้อนจัดประวัติทั้งหมด
    LAST_VALUE(
      CASE
        WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
             AND TRIM(COALESCE(i.item_family,'')) != ''
        THEN i.item_family ELSE i.subclass_name
      END
    ) OVER (PARTITION BY i.item_id ORDER BY o.delivery_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS group_stable,
    i.gmv_ex_vat                       AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE '2026-04-01'
    AND o.delivery_date <  DATE '2026-08-01'
    AND i.gmv_ex_vat > 0
    AND i.item_id IS NOT NULL
),
-- สรุปสองแบบ แล้วเอามาเทียบกันที่ระดับ (kam, account, outlet, กลุ่ม-แบบนิ่ง)
agg_as_is AS (
  SELECT kam_email, account_id, outlet_id, group_as_is AS grp,
    MAX(IF(mo <  DATE '2026-07-01', gmv_mo, 0)) AS base_mo,
    MAX(IF(mo =  DATE '2026-07-01', gmv_mo, 0)) AS jul_mo
  FROM (
    SELECT kam_email, account_id, outlet_id, group_as_is, mo, SUM(gmv) AS gmv_mo
    FROM lines GROUP BY 1,2,3,4,5
  )
  GROUP BY 1,2,3,4
),
agg_stable AS (
  SELECT kam_email, account_id, outlet_id, group_stable AS grp,
    MAX(IF(mo <  DATE '2026-07-01', gmv_mo, 0)) AS base_mo,
    MAX(IF(mo =  DATE '2026-07-01', gmv_mo, 0)) AS jul_mo
  FROM (
    SELECT kam_email, account_id, outlet_id, group_stable, mo, SUM(gmv) AS gmv_mo
    FROM lines GROUP BY 1,2,3,4,5
  )
  GROUP BY 1,2,3,4
),
joined AS (
  SELECT
    COALESCE(s.kam_email, a.kam_email)   AS kam_email,
    COALESCE(s.account_id, a.account_id) AS account_id,
    COALESCE(s.outlet_id, a.outlet_id)   AS outlet_id,
    COALESCE(s.grp, a.grp)               AS grp,
    COALESCE(a.base_mo, 0)               AS base_as_is,
    COALESCE(a.jul_mo, 0)                AS jul_as_is,
    COALESCE(s.base_mo, 0)               AS base_stable,
    COALESCE(s.jul_mo, 0)                AS jul_stable
  FROM agg_stable s
  FULL OUTER JOIN agg_as_is a
    ON  s.kam_email  = a.kam_email
    AND s.account_id = a.account_id
    AND s.outlet_id  = a.outlet_id
    AND s.grp        = a.grp
)
SELECT
  j.kam_email,
  j.account_id,
  j.outlet_id,
  j.grp                                       AS group_key,
  ROUND(j.base_as_is,  2)                     AS base_as_is,
  ROUND(j.jul_as_is,   2)                     AS jul_as_is,
  ROUND(j.jul_as_is - j.base_as_is, 2)        AS growth_as_is,
  IF(j.jul_as_is > 2 * j.base_as_is
     AND j.jul_as_is - j.base_as_is >= 8000, 'PASS', 'FAIL')   AS verdict_as_is,
  ROUND(j.base_stable, 2)                     AS base_stable,
  ROUND(j.jul_stable,  2)                     AS jul_stable,
  ROUND(j.jul_stable - j.base_stable, 2)      AS growth_stable,
  IF(j.jul_stable > 2 * j.base_stable
     AND j.jul_stable - j.base_stable >= 8000, 'PASS', 'FAIL') AS verdict_stable,
  ROUND(
    (IF(j.jul_as_is  > 2 * j.base_as_is
        AND j.jul_as_is  - j.base_as_is  >= 8000, j.jul_as_is  - j.base_as_is,  0)
   - IF(j.jul_stable > 2 * j.base_stable
        AND j.jul_stable - j.base_stable >= 8000, j.jul_stable - j.base_stable, 0)
    ) * 0.015, 2)                             AS baht_impact
FROM joined j
JOIN nrr_core nc ON nc.outlet_id = j.outlet_id     -- P3 นับเฉพาะร้านใน NRR core
WHERE IF(j.jul_as_is  > 2 * j.base_as_is
         AND j.jul_as_is  - j.base_as_is  >= 8000, 'PASS', 'FAIL')
   != IF(j.jul_stable > 2 * j.base_stable
         AND j.jul_stable - j.base_stable >= 8000, 'PASS', 'FAIL')
ORDER BY ABS(
  (IF(j.jul_as_is  > 2 * j.base_as_is
      AND j.jul_as_is  - j.base_as_is  >= 8000, j.jul_as_is  - j.base_as_is,  0)
 - IF(j.jul_stable > 2 * j.base_stable
      AND j.jul_stable - j.base_stable >= 8000, j.jul_stable - j.base_stable, 0))
) DESC;


-- ══════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 6B · แก้ข้อบกพร่องของส่วนที่ 6 + วัดขนาดจริง
--
-- ⚠ ส่วนที่ 6 มีข้อผิดพลาด: STRING_AGG(DISTINCT ...) เรียงลำดับเองไม่ได้
--   คอลัมน์ group_keys จึง **ไม่ใช่ลำดับเวลา** อ่านลูกศรเป็น "ก่อน → หลัง" ไม่ได้
--   และผลติด LIMIT 200 จึงไม่รู้ขนาดจริง
--
-- ตัวนี้แก้ทั้งสองเรื่อง: บอกกลุ่มของเดือนแรกกับเดือนสุดท้ายจริงๆ และไม่ตัด LIMIT
--
-- ชื่อคอลัมน์:
--   grp_first / grp_last = กลุ่มในเดือนแรก / เดือนสุดท้ายที่พบสินค้าตัวนั้น
--   direction            = ย้ายจากอะไรไปอะไร (อ่านได้ตรงๆ)
-- ══════════════════════════════════════════════════════════════════════════
WITH item_month AS (
  SELECT
    i.item_id                          AS item_id,
    ANY_VALUE(i.item_name_th)          AS item_name,
    DATE_TRUNC(o.delivery_date, MONTH) AS mo,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END                                AS group_key,
    SUM(i.gmv_ex_vat)                  AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= DATE '2026-04-01'
    AND o.delivery_date <  DATE '2026-08-01'
    AND i.gmv_ex_vat > 0
    AND i.item_id IS NOT NULL
  GROUP BY 1,3,4
),
moved AS (
  SELECT
    item_id,
    ANY_VALUE(item_name)                                            AS item_name,
    COUNT(DISTINCT group_key)                                       AS n_group_keys,
    ARRAY_AGG(group_key ORDER BY mo ASC  LIMIT 1)[OFFSET(0)]        AS grp_first,
    ARRAY_AGG(group_key ORDER BY mo DESC LIMIT 1)[OFFSET(0)]        AS grp_last,
    SUM(gmv)                                                        AS gmv_total
  FROM item_month
  GROUP BY item_id
  HAVING COUNT(DISTINCT group_key) > 1
)
-- สรุปภาพรวมก่อน (แถวเดียว) — เอาไว้ตอบว่า "ใหญ่แค่ไหน"
SELECT
  'สรุปภาพรวม'                       AS row_type,
  CAST(COUNT(*) AS STRING)           AS item_id,
  CAST(NULL AS STRING)               AS item_name,
  CAST(NULL AS STRING)               AS grp_first,
  CAST(NULL AS STRING)               AS grp_last,
  ROUND(SUM(gmv_total), 2)           AS gmv_total
FROM moved
UNION ALL
SELECT
  'รายตัว'                            AS row_type,
  CAST(item_id AS STRING)            AS item_id,
  item_name,
  grp_first,
  grp_last,
  ROUND(gmv_total, 2)                AS gmv_total
FROM moved
ORDER BY row_type, gmv_total DESC;
