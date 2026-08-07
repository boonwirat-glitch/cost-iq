-- ============================================================
-- Q10 final — Commission Handover: Sales→KAM
-- ============================================================
-- Purpose : portview_handover.csv สำหรับ commission เท่านั้น
-- Meaning  : Apr Sales→KAM handover → วัด May KAM retention
-- Grain    : 1 row per outlet (res_id)
--
-- Logic: ลอกจาก my_sql ที่ validate แล้ว (44 rows KEEP)
-- PATH A: new_user_exp_date อยู่ใน Apr
-- PATH B: new_user_exp_date = NULL
--         AND last_sale_order_date (MAX SALE จากทุก 6 เดือน) อยู่ใน Apr
-- Exclude: fallback ที่ effective_sales_owner = Admin Freshket
--
-- ★ v_expfix (2026-08-07): new_user_exp_date ต้องอ่านจาก dwh.order (MAX) เหมือน
--   q3_2026_movement_rep_view.sql ไม่ใช่จาก dim.user_master — ดูเหตุผลเต็มที่ CTE
--   outlet_exp_date_by_period ด้านล่าง (ไฟล์นี้กับไฟล์ NRR ต้องนิยาม "เดือนที่
--   รับโอน" ตรงกันเสมอ ไม่งั้นหน้าจอกับค่าคอมฯ พูดคนละเรื่อง)
-- ★ v_expfix2: MAX นั้นผูกรายงวด (≤ สิ้นเดือนก่อนงวด) ไม่ใช่เทียบวันนี้ —
--   งวดที่จบไปแล้วจะได้ผลเท่าเดิมเสมอไม่ว่ารันไฟล์ใหม่กี่ครั้ง
-- ============================================================

WITH

-- v_hofix (2026-08-06): เดิม CTE นี้คืน "แถวเดียว" = เดือนก่อนวันที่รัน ทำให้ไฟล์
-- portview_handover.csv เก็บได้ครั้งละเดือนเดียวและถูกเขียนทับทุกครั้งที่รันใหม่
-- ผลคือ: ตอนล็อกค่าคอมฯ ก.ค. (1 ส.ค.) engine ขอ transfer_month='2026-07' แต่ไฟล์
-- ยังเป็นรอบเก่าที่มี '2026-06' → match 0 แถว → KAM ทั้ง 14 คนล็อกที่ handover ฿0
-- ทั้งที่มีร้าน handover จริง 12 KAM · ตอนนี้คืนหลายแถว (เดือนละแถว) ทุก CTE ที่
-- CROSS JOIN params อยู่แล้วจะ fan out ตามเดือนเอง → ไฟล์เดียวเก็บครบทุกเดือน
-- ย้อนหลังได้ reconcile ได้ และไม่มีเดือนไหนหายอีก
params AS (
  SELECT
    lag.d                                                                    AS lag_date,
    m                                                                        AS perf_month_start,
    LAST_DAY(m, MONTH)                                                       AS perf_month_end,
    FORMAT_DATE('%Y-%m', m)                                                  AS perf_month_label,
    -- v_hofix: เดือนที่ยังไม่จบต้องหารด้วย "จำนวนวันที่ผ่านมาแล้ว" ไม่ใช่วันเต็มเดือน
    -- ของเดิมใช้วันเต็มทุกกรณี → ไฟล์ที่รันวันที่ 6 ได้ retention แค่ ~1/5 ของจริง
    -- ตกทุก tier กลายเป็น ฿0 ทั้งที่ร้านยังซื้อปกติ
    CASE
      WHEN m = DATE_TRUNC(lag.d, MONTH) THEN DATE_DIFF(lag.d, m, DAY) + 1
      ELSE DATE_DIFF(DATE_ADD(m, INTERVAL 1 MONTH), m, DAY)
    END                                                                      AS perf_days_in_month,

    DATE_SUB(m, INTERVAL 1 MONTH)                                            AS prev_month_start,
    LAST_DAY(DATE_SUB(m, INTERVAL 1 MONTH), MONTH)                           AS prev_month_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(m, INTERVAL 1 MONTH))                      AS prev_month_label,
    DATE_DIFF(m, DATE_SUB(m, INTERVAL 1 MONTH), DAY)                         AS prev_days_in_month
  -- lag_date: day-1 anchor (data pipeline lag = 1 day always)
  FROM (SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) AS d) lag
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(
    DATE '2026-05-01',                                   -- ไตรมาสที่ระบบเริ่มใช้จริง
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH),
    INTERVAL 1 MONTH
  )) AS m
),

kam_name_list AS (
  SELECT kam_name FROM UNNEST([
    'Anusorn (Bookbig) Khamphasuk',
    'Chaklid (Dent) Nimraor',
    'Duangruedee (Ning) Bulalom',
    'Guntinun (Monet) Thanoochan',
    'Intuon (Jane) Yanakit',
    'Napat (To) Kaikaew',
    'Natchita (Foam) Bunkong',
    'Niracha (Cream) Sangka',
    'Nuttawan (Kwang) Mahaporn',
    'Ploynitcha (Nitcha) Rujipiromthagoon',
    'Puttipong (Tape) Wanithaweewat',
    'Rinlaphat (Mild) Setthasiriwuti',
    'Siriprapa (Pop) Piapeng',
    'Warissara (Ply) Chanaboon',
    'Treerak (May) Sangjua'
  ]) AS kam_name
),

-- ── v_expfix (2026-08-07): แหล่ง new_user_exp_date ที่ถูกต้อง ────────────────
-- ลอกนิยามมาจาก q3_2026_movement_rep_view.sql (CTE outlet_exp_date) ทุกบรรทัด
-- เพื่อให้ "เดือนที่รับโอน" ของไฟล์นี้ = ของหน้า NRR เป๊ะ
--
-- บั๊กที่แก้ (บุชจับได้จาก raw 2026-08-07): user_master_latest เลือกแถวเดียวต่อ
-- res_id ด้วย QUALIFY ... ORDER BY lasted_order_date DESC แล้วหยิบ exp date จาก
-- แถวนั้น — ซึ่งบ่อยครั้งเป็นค่าเก่าหรือ NULL ทั้งที่ตารางออเดอร์มีค่าใหม่กว่า
-- ผลที่เกิดจริงกับงวด ก.ค.:
--   · Lake Park (Cream): raw exp = 30 มิ.ย. แต่ master ให้ พ.ค. → ไปโผล่งวด มิ.ย.
--     แทนที่จะเป็น ก.ค. (หน้า NRR จัดเป็น cohort มิ.ย. ถูกแล้ว)
--   · ปิโตรเลียมไทย (Ning): master ให้ NULL → ตกไป PATH B ที่เดาเดือนจาก
--     last_sale_order_date รายสาขา → บัญชีเดียวถูกนับเป็น handover ซ้ำ 4 เดือนติด
--     (พ.ค./มิ.ย./ก.ค./ส.ค. คนละชุดสาขา) ทั้งที่ raw บอกว่ารับโอนครั้งเดียว 30 มิ.ย.
-- MAX() ตรงกับ rep_view และแก้ทั้งสองอาการ · ใช้เป็นค่าหลัก ถ้าออเดอร์ไม่มีค่าเลย
-- ค่อยถอยไปใช้ของ user_master (พฤติกรรมเดิม ไม่ทำให้เคสที่เคยถูกอยู่แล้วหาย)
--
-- ★ v_expfix2 (2026-08-07, บุชถามเอง "ดู exp date ล่าสุดอันเดียวใช่มั้ย"):
-- MAX ต้องเทียบกับ "สิ้นเดือนก่อนงวดที่กำลังคิด" ไม่ใช่ "วันนี้" — ไม่งั้นร้านที่
-- โอนสองครั้ง (เช่น มิ.ย. แล้วโอนอีกที ก.ย.) พอรันไฟล์เดือน ต.ค. ระบบจะเห็นแค่
-- ก.ย. แล้วแถวของงวด ก.ค. หายไปทั้งที่ตอนล็อกเคยมี = งวดที่จบแล้วขยับได้ทุกครั้ง
-- ที่รันไฟล์ · หลักเดียวกับที่บุชเคาะเรื่อง transfer เช้าวันเดียวกัน ("เดือนที่จบ
-- แล้วห้ามขยับเพราะเหตุการณ์ในอนาคต") · ร้านที่มี exp date ค่าเดียว (เกือบทั้งหมด)
-- ได้ผลเท่าเดิมเป๊ะ ไม่มีอะไรเปลี่ยน
outlet_exp_date_by_period AS (
  SELECT
    p.perf_month_label,
    CAST(o.user_id AS STRING)      AS user_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    -- รู้ได้แค่ถึงสิ้นเดือนก่อนงวดนี้: วันที่หลังจากนั้น = ยังไม่เกิด ณ ตอนประเมิน
    AND DATE(o.new_user_exp_date) <= p.prev_month_end
  GROUP BY 1, 2
),

-- QUALIFY ก่อน filter commercial_owner (ตรงกับ my_sql)
user_master_latest AS (
  SELECT
    CAST(um.res_id AS STRING)        AS user_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.account_type,
    UPPER(TRIM(COALESCE(um.commercial_owner, ''))) AS commercial_owner,
    TRIM(COALESCE(um.sales_owner, ''))             AS sales_owner,
    TRIM(COALESCE(
      NULLIF(um.staff_owner, ''),
      NULLIF(um.kam_owner,   ''),
      NULLIF(um.ka_owner,    ''),
      ''
    ))                                             AS new_kam_name,
    DATE(um.first_dollar_date)       AS first_dollar_date,
    -- v_expfix2: ค่าจาก master เป็น "ตัวสำรอง" เท่านั้น — ตัวจริงผูกรายงวดที่
    -- CTE umk_by_period ด้านล่าง (ที่นี่ไม่มี params ให้อ้างอิงเดือน)
    DATE(um.new_user_exp_date)       AS new_user_exp_date,
    DATE(um.lasted_order_date)       AS lasted_order_date,
    FORMAT_DATE('%Y-%m', DATE(um.new_user_exp_date)) AS exp_month,
    um.sales_owner                   AS raw_sales_owner,
    um.staff_owner                   AS raw_staff_owner,
    um.kam_owner                     AS raw_kam_owner,
    um.ka_owner                      AS raw_ka_owner
  FROM `freshket-rn.dim.user_master` um
  WHERE um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
    AND um.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY DATE(um.lasted_order_date) DESC NULLS LAST
  ) = 1
),

user_master_kam AS (
  SELECT uml.*
  FROM user_master_latest uml
  JOIN kam_name_list k ON TRIM(uml.new_kam_name) = TRIM(k.kam_name)
  WHERE uml.commercial_owner = 'KAM'
    AND uml.sales_owner IS NOT NULL
    AND uml.sales_owner != ''
    AND uml.new_kam_name IS NOT NULL
    AND uml.new_kam_name != ''
),

-- v_expfix2: ผูก exp date "เท่าที่รู้ได้ ณ สิ้นเดือนก่อนงวดนั้น" เข้ากับทุกงวด
-- ตั้งแต่ตรงนี้ new_user_exp_date / exp_month = ค่ารายงวด (ไม่ใช่ค่าเดียวจาก
-- master อีกต่อไป) · CTE candidate ด้านล่างใช้ชื่อคอลัมน์เดิมทุกจุด ไม่ต้องแก้
-- EXCEPT() ตัดเฉพาะตอนกาง * เท่านั้น — ยังอ้าง umk.new_user_exp_date เป็น
-- ตัวสำรองในนิพจน์ได้ตามปกติ
umk_by_period AS (
  SELECT
    umk.* EXCEPT (new_user_exp_date, exp_month),
    p.perf_month_label,
    COALESCE(oed.new_user_exp_date, umk.new_user_exp_date)                   AS new_user_exp_date,
    FORMAT_DATE('%Y-%m',
      COALESCE(oed.new_user_exp_date, umk.new_user_exp_date))                AS exp_month
  FROM user_master_kam umk
  CROSS JOIN params p
  LEFT JOIN outlet_exp_date_by_period oed
    ON oed.user_id = umk.user_id
   AND oed.perf_month_label = p.perf_month_label
),

order_base AS (
  SELECT
    CAST(user_id AS STRING)          AS user_id,
    CAST(account_id AS STRING)       AS account_id,
    account_name,
    account_type,
    CAST(delivery_date AS DATE)      AS delivery_date,
    FORMAT_DATE('%Y-%m', CAST(delivery_date AS DATE)) AS month_label,
    UPPER(TRIM(COALESCE(commercial_owner, ''))) AS commercial_owner,
    TRIM(COALESCE(staff_owner, ''))  AS staff_owner,
    SAFE_CAST(gmv_ex_vat AS FLOAT64) AS gmv_ex_vat
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain', 'Unknown')
    AND user_id    IS NOT NULL
    AND account_id IS NOT NULL
    AND delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
),

-- v_hofix: params เป็นหลายแถวแล้ว → ต้อง GROUP BY เดือนด้วย ไม่งั้นหน้าต่าง
-- prev_month ของทุกเดือนจะถูกยุบรวมเป็นค่าเดียว (sale_order_count_prev_month
-- และ prev_month_order_sales_owner จะผิดทันที)
sale_evidence AS (
  SELECT
    ob.user_id,
    p.perf_month_label,
    COUNTIF(ob.commercial_owner = 'SALE')                                   AS sale_order_count_all,
    COUNTIF(
      ob.commercial_owner = 'SALE'
      AND ob.delivery_date BETWEEN p.prev_month_start AND p.prev_month_end
    )                                                                        AS sale_order_count_prev_month,
    -- MAX SALE order จากทุก 6 เดือน (ไม่จำกัดเฉพาะ Apr)
    MAX(IF(ob.commercial_owner = 'SALE', ob.delivery_date, NULL))           AS last_sale_order_date,
    ARRAY_AGG(
      IF(ob.commercial_owner = 'SALE', ob.staff_owner, NULL)
      IGNORE NULLS ORDER BY ob.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)]                                                        AS order_sales_owner,
    ARRAY_AGG(
      IF(
        ob.commercial_owner = 'SALE'
        AND ob.delivery_date BETWEEN p.prev_month_start AND p.prev_month_end,
        ob.staff_owner, NULL
      )
      IGNORE NULLS ORDER BY ob.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)]                                                        AS prev_month_order_sales_owner

  FROM order_base ob
  CROSS JOIN params p
  GROUP BY 1, 2
),

gmv_by_user_month AS (
  SELECT
    user_id,
    month_label,
    SUM(gmv_ex_vat)      AS gmv,
    MAX(delivery_date)   AS last_order_date
  FROM order_base
  GROUP BY 1, 2
),

candidate AS (
  SELECT
    umk.*,
    se.sale_order_count_all,
    se.sale_order_count_prev_month,
    se.last_sale_order_date,
    se.order_sales_owner,
    se.prev_month_order_sales_owner,
    COALESCE(se.prev_month_order_sales_owner, se.order_sales_owner, umk.sales_owner)
                                                                             AS effective_sales_owner,
    CASE
      WHEN umk.new_user_exp_date IS NOT NULL
        AND umk.exp_month = p.prev_month_label
        THEN 'explicit_exp_date'
      WHEN umk.new_user_exp_date IS NULL
        AND se.last_sale_order_date BETWEEN p.prev_month_start AND p.prev_month_end
        THEN 'fallback_last_sale_in_prev_month'
      ELSE 'not_eligible'
    END                                                                      AS movement_source,
    CASE
      WHEN LOWER(TRIM(COALESCE(
        se.prev_month_order_sales_owner, se.order_sales_owner, umk.sales_owner, ''
      ))) = 'admin freshket'
        THEN TRUE
      ELSE FALSE
    END                                                                      AS is_admin_freshket_owner,
    FORMAT_DATE('%Y-%m', p.prev_month_start)                                 AS transfer_month,
    -- v_hofix: งวดที่แถวนี้เป็นของ (= เดือนที่วัด retention) พกไปให้ final join ต่อ
    p.perf_month_label                                                       AS period_month,
    CASE
      WHEN umk.new_user_exp_date IS NOT NULL THEN umk.new_user_exp_date
      ELSE se.last_sale_order_date
    END                                                                      AS transfer_date
  -- v_expfix2: umk_by_period fan out ตามงวดไปแล้ว (มี exp date รายงวดติดมาด้วย)
  -- จึง JOIN params ด้วยเดือนแทน CROSS JOIN เดิม — จำนวนแถวเท่าเดิมเป๊ะ
  FROM umk_by_period umk
  JOIN params p ON p.perf_month_label = umk.perf_month_label
  -- v_hofix: join เดือนด้วย ไม่งั้นหยิบ sale_evidence ของเดือนอื่นมาปน
  LEFT JOIN sale_evidence se
    ON se.user_id = umk.user_id AND se.perf_month_label = p.perf_month_label
  WHERE
    (
      umk.new_user_exp_date IS NOT NULL
      AND umk.exp_month = p.prev_month_label
    )
    OR
    (
      umk.new_user_exp_date IS NULL
      AND se.last_sale_order_date BETWEEN p.prev_month_start AND p.prev_month_end
    )
),

final AS (
  SELECT
    c.user_id,
    c.account_id,
    c.account_name,
    c.account_type,
    c.effective_sales_owner          AS prev_owner_name,
    c.sales_owner,
    c.new_kam_name,
    c.transfer_month,
    c.transfer_date,
    COALESCE(base.gmv, 0)            AS baseline_gmv,
    COALESCE(perf.gmv, 0)            AS perf_gmv,
    c.movement_source,
    c.is_admin_freshket_owner,
    CASE
      WHEN c.movement_source = 'fallback_last_sale_in_prev_month'
        AND c.is_admin_freshket_owner = TRUE
        THEN 'EXCLUDE_ADMIN_FALLBACK'
      ELSE 'KEEP'
    END                              AS admin_filter_decision,
    c.sale_order_count_all,
    c.sale_order_count_prev_month,
    c.last_sale_order_date,
    c.first_dollar_date,
    c.new_user_exp_date,
    c.lasted_order_date,
    c.raw_sales_owner,
    c.raw_staff_owner,
    c.raw_kam_owner,
    c.raw_ka_owner,
    p.perf_days_in_month,
    p.prev_days_in_month,
    c.period_month
  FROM candidate c
  -- v_hofix: เดิมเป็น CROSS JOIN ได้เพราะ params มีแถวเดียว · ตอนนี้หลายแถวแล้ว
  -- ถ้ายัง CROSS JOIN อยู่จะได้ (แถว × จำนวนเดือน) ซ้ำทั้งหมด — ต้อง join ตรงเดือน
  JOIN params p ON p.perf_month_label = c.period_month
  LEFT JOIN gmv_by_user_month base
    ON base.user_id = c.user_id AND base.month_label = c.transfer_month
  LEFT JOIN gmv_by_user_month perf
    ON perf.user_id = c.user_id AND perf.month_label = p.perf_month_label
  WHERE c.movement_source IN ('explicit_exp_date', 'fallback_last_sale_in_prev_month')
    AND NOT (
      c.movement_source = 'fallback_last_sale_in_prev_month'
      AND c.is_admin_freshket_owner = TRUE
    )
)

-- 16 backward-compatible cols + debug
SELECT
  -- [0]  kam_name = Sales owner ก่อนโอน
  f.prev_owner_name                                     AS kam_name,
  -- [1]  account_id
  f.account_id,
  -- [2]  account_name
  f.account_name,
  -- [3]  account_type
  f.account_type,
  -- [4]  last_month_gmv
  CAST(ROUND(f.baseline_gmv) AS INT64)                  AS last_month_gmv,
  -- [5]  cur_month_gmv
  CAST(ROUND(f.perf_gmv) AS INT64)                      AS cur_month_gmv,
  -- [6]  new_owner_type
  'KAM'                                                 AS new_owner_type,
  -- [7]  new_kam_name
  f.new_kam_name,
  -- [8]  transfer_basis
  'sales_to_kam'                                        AS transfer_basis,
  -- [9]  last_order_date
  CAST(f.last_sale_order_date AS STRING)                AS last_order_date,
  -- [10] prev_owner
  'SALE'                                                AS prev_owner,
  -- [11] transfer_month = "2026-04"
  f.transfer_month,
  -- [12] baseline_gmv
  CAST(ROUND(f.baseline_gmv) AS INT64)                  AS baseline_gmv,
  -- [13] perf_gmv
  CAST(ROUND(f.perf_gmv) AS INT64)                      AS perf_gmv,
  -- [14] perf_days_in_month
  f.perf_days_in_month,
  -- [15] baseline_days_in_month
  f.prev_days_in_month                                  AS baseline_days_in_month,

  -- debug cols
  f.user_id,
  f.movement_source                                     AS confidence,
  f.movement_source                                     AS handover_path,
  CAST(f.new_user_exp_date AS STRING)                   AS new_user_exp_date,
  CAST(f.last_sale_order_date AS STRING)                AS last_sale_order_date,
  f.sales_owner,
  'KAM'                                                 AS commercial_owner,
  f.raw_staff_owner                                     AS staff_owner,
  f.raw_kam_owner                                       AS kam_owner,
  f.raw_ka_owner                                        AS ka_owner,
  f.is_admin_freshket_owner,
  'KEEP'                                                AS exclude_reason,
  -- v_hofix: งวดที่แถวนี้เป็นของ (= เดือนที่วัด retention = transfer_month + 1)
  -- ต่อท้ายเป็นคอลัมน์สุดท้ายเสมอ เพราะ parser ฝั่ง Sense อ่านด้วยตำแหน่ง p[0..16]
  -- การแทรกกลางจะทำให้ทุกคอลัมน์เลื่อนและพังเงียบๆ · ฝั่ง /nrr อ่านด้วยชื่อหัวคอลัมน์
  -- จึงรับตัวนี้ได้ฟรี · ตัว filter จริงยังใช้ transfer_month เหมือนเดิม ไม่เปลี่ยนความหมาย
  f.period_month

FROM final f

ORDER BY
  f.period_month,
  f.new_kam_name,
  f.baseline_gmv DESC,
  f.account_name;
