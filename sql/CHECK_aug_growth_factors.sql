-- ============================================================
-- เช็ค growth factor เดือน ส.ค. 2026 (โตพิเศษเหมือน ก.ค. มั้ย?)
-- รันใน BigQuery — 3 บล็อก ไม่มีบล็อกไหนแก้ข้อมูล อ่านอย่างเดียวทั้งหมด ปลอดภัย
--
-- โจทย์: ข้อมูล ส.ค. มีถึงแค่วันที่ 20 → เทียบแบบ "20 วันแรก" ของทุกเดือน
--        (ม.ค.–ส.ค. 2026) ให้เป็นฐานเดียวกัน ไม่ต้อง normalize เป็นเต็มเดือน
--        เหมือนรอบก่อน เพราะเทียบ 20 วัน vs 20 วันตรงๆอยู่แล้ว
--
-- บล็อก 1 — Sales GMV + FD (first dollar = ลูกค้าที่ first_dollar_date ตกอยู่
--           ในเดือนนั้น) พร้อมทั้ง MoM growth% และแถวสรุป "ค่าเฉลี่ยการโตของ
--           เดือนก่อนๆ" ไว้เทียบว่า ส.ค. โตกว่าปกติจริงมั้ย
--           → รันได้ทันที ใช้ dwh.order ตัวเดียว (vocabulary เดียวกับ
--             sales_handover_pipeline.sql / q3_2026_movement_rep_view.sql)
--
-- บล็อก 2/3 — Inbound / Outbound: ผมหา table/field จริงใน cost-iq-nrr/sql
--             ไม่เจอเลย (ไม่ใช่ของ NRR/Sense) เดาโครงสร้างตารางไว้ให้ก่อน
--             ❗ ต้องแก้ชื่อ table + ชื่อคอลัมน์วันที่/ปริมาณให้ตรงของจริงก่อนรัน
--             โครง query เหมือนบล็อก 1 ทุกอย่าง (20 วันแรก + growth% +
--             แถวเฉลี่ย) เพื่อให้เทียบกันได้ตรงๆ
-- ============================================================




-- ============================================================
-- บล็อก 1 — Sales GMV + FD (20 วันแรกของทุกเดือน, ม.ค.–ส.ค. 2026)
-- ============================================================

DECLARE v_cutoff_day   INT64 DEFAULT 20;                                    -- เทียบ 20 วันแรกของทุกเดือน
DECLARE v_start_month  DATE  DEFAULT DATE '2026-01-01';
DECLARE v_data_end     DATE  DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_end_month    DATE  DEFAULT DATE_TRUNC(v_data_end, MONTH);

WITH

-- ปฏิทินเดือน ม.ค. → เดือนปัจจุบัน + หน้าต่าง "วันที่ 1 ถึงวันที่ 20" ของแต่ละเดือน
months AS (
  SELECT
    month_start,
    LEAST(DATE_ADD(month_start, INTERVAL v_cutoff_day - 1 DAY), v_data_end) AS window_end
  FROM UNNEST(GENERATE_DATE_ARRAY(v_start_month, v_end_month, INTERVAL 1 MONTH)) AS month_start
),

-- Sales GMV — locked rules เดิม: gmv_ex_vat only, > 0, ไม่กรอง order status,
-- ตัด account_type ที่ไม่ใช่ยอดขายจริงออก (เหมือนทุกไฟล์ใน repo นี้)
sales_gmv AS (
  SELECT
    m.month_start,
    ROUND(SUM(o.gmv_ex_vat), 0) AS sales_gmv_20d
  FROM months m
  JOIN `freshket-rn.dwh.order` o
    ON o.delivery_date >= m.month_start
   AND o.delivery_date <= m.window_end
  WHERE o.gmv_ex_vat > 0
    AND UPPER(TRIM(IFNULL(o.account_type, ''))) NOT IN ('CONSUMER', 'ENDUSER', 'EXCLUDE', 'TEST')
  GROUP BY 1
),

-- first_dollar_date ต่อร้าน — คำจำกัดความเดียวกับ sales_handover_pipeline.sql
-- และ q3_2026_movement_rep_view.sql ("first order เดียวข้ามทุกเจ้าของ ตลอดกาล")
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND UPPER(TRIM(IFNULL(o.account_type, ''))) NOT IN ('CONSUMER', 'ENDUSER', 'EXCLUDE', 'TEST')
  GROUP BY 1
),

-- FD ต่อเดือน: จำนวนร้านที่ "เกิดใหม่" ในหน้าต่าง 20 วันนั้น + ยอด GMV ของร้าน
-- เหล่านั้นในหน้าต่างเดียวกัน (วัดว่าลูกค้าใหม่ผลักดันยอดโตแค่ไหน)
fd_new AS (
  SELECT
    m.month_start,
    COUNT(DISTINCT ofd.outlet_id) AS fd_new_outlets_20d
  FROM months m
  LEFT JOIN outlet_first_dollar ofd
    ON ofd.first_dollar_date >= m.month_start
   AND ofd.first_dollar_date <= m.window_end
  GROUP BY 1
),

fd_gmv AS (
  SELECT
    m.month_start,
    ROUND(SUM(o.gmv_ex_vat), 0) AS fd_gmv_20d
  FROM months m
  JOIN outlet_first_dollar ofd
    ON ofd.first_dollar_date >= m.month_start
   AND ofd.first_dollar_date <= m.window_end
  JOIN `freshket-rn.dwh.order` o
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND o.delivery_date >= m.month_start
   AND o.delivery_date <= m.window_end
  WHERE o.gmv_ex_vat > 0
    AND UPPER(TRIM(IFNULL(o.account_type, ''))) NOT IN ('CONSUMER', 'ENDUSER', 'EXCLUDE', 'TEST')
  GROUP BY 1
),

joined AS (
  SELECT
    m.month_start,
    FORMAT_DATE('%b %Y', m.month_start) AS month_label,
    IFNULL(sg.sales_gmv_20d, 0)   AS sales_gmv_20d,
    IFNULL(fn.fd_new_outlets_20d, 0) AS fd_new_outlets_20d,
    IFNULL(fg.fd_gmv_20d, 0)      AS fd_gmv_20d
  FROM months m
  LEFT JOIN sales_gmv sg ON sg.month_start = m.month_start
  LEFT JOIN fd_new     fn ON fn.month_start = m.month_start
  LEFT JOIN fd_gmv      fg ON fg.month_start = m.month_start
),

growth_calc AS (
  SELECT
    *,
    ROUND(SAFE_DIVIDE(sales_gmv_20d - LAG(sales_gmv_20d) OVER (ORDER BY month_start),
                       LAG(sales_gmv_20d) OVER (ORDER BY month_start)) * 100, 1) AS sales_gmv_mom_growth_pct,
    ROUND(SAFE_DIVIDE(fd_new_outlets_20d - LAG(fd_new_outlets_20d) OVER (ORDER BY month_start),
                       LAG(fd_new_outlets_20d) OVER (ORDER BY month_start)) * 100, 1) AS fd_new_outlets_mom_growth_pct,
    ROUND(SAFE_DIVIDE(fd_gmv_20d - LAG(fd_gmv_20d) OVER (ORDER BY month_start),
                       LAG(fd_gmv_20d) OVER (ORDER BY month_start)) * 100, 1) AS fd_gmv_mom_growth_pct
  FROM joined
),

-- ค่าเฉลี่ยการโต MoM ของ "เดือนก่อนๆ" ทั้งหมด (ไม่รวมเดือนล่าสุด) — ใช้เทียบว่า
-- เดือนล่าสุดโตกว่าปกติจริงมั้ย เหมือนที่เช็ค ก.ค. รอบก่อน
benchmark AS (
  SELECT
    ROUND(AVG(sales_gmv_mom_growth_pct), 1)     AS avg_prior_sales_gmv_growth_pct,
    ROUND(AVG(fd_new_outlets_mom_growth_pct), 1) AS avg_prior_fd_new_outlets_growth_pct,
    ROUND(AVG(fd_gmv_mom_growth_pct), 1)         AS avg_prior_fd_gmv_growth_pct
  FROM growth_calc
  WHERE month_start < (SELECT MAX(month_start) FROM growth_calc)
)

SELECT
  month_label,
  sales_gmv_20d,
  sales_gmv_mom_growth_pct,
  fd_new_outlets_20d,
  fd_new_outlets_mom_growth_pct,
  fd_gmv_20d,
  fd_gmv_mom_growth_pct,
  month_start
FROM growth_calc

UNION ALL

SELECT
  'AVG โต (ไม่รวมเดือนล่าสุด)' AS month_label,
  NULL, avg_prior_sales_gmv_growth_pct,
  NULL, avg_prior_fd_new_outlets_growth_pct,
  NULL, avg_prior_fd_gmv_growth_pct,
  DATE '9999-12-31' AS month_start
FROM benchmark

ORDER BY month_start;




-- ============================================================
-- บล็อก 2 — Inbound (20 วันแรกของทุกเดือน) ❗ PLACEHOLDER — ยังไม่รู้ตารางจริง
--
-- แก้ 3 จุดที่มี ❗ ให้ตรงกับตารางจริงก่อนรัน โครงที่เหลือ (ปฏิทิน 20 วัน,
-- growth%, แถวเฉลี่ย) เหมือนบล็อก 1 ทุกอย่าง เทียบกันได้ตรงๆ
-- ============================================================

DECLARE v_cutoff_day2  INT64 DEFAULT 20;
DECLARE v_start_month2 DATE  DEFAULT DATE '2026-01-01';
DECLARE v_data_end2    DATE  DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_end_month2   DATE  DEFAULT DATE_TRUNC(v_data_end2, MONTH);

WITH
months AS (
  SELECT
    month_start,
    LEAST(DATE_ADD(month_start, INTERVAL v_cutoff_day2 - 1 DAY), v_data_end2) AS window_end
  FROM UNNEST(GENERATE_DATE_ARRAY(v_start_month2, v_end_month2, INTERVAL 1 MONTH)) AS month_start
),

inbound_20d AS (
  SELECT
    m.month_start,
    FORMAT_DATE('%b %Y', m.month_start) AS month_label,
    -- ❗ 1) แก้ชื่อตารางให้ตรงจริง (เดาไว้: `freshket-rn.dwh.inbound`)
    -- ❗ 2) แก้ชื่อคอลัมน์วันที่รับสินค้าเข้าคลัง (เดาไว้: received_date)
    -- ❗ 3) แก้ SUM(...) เป็นเมตริกที่ต้องการ — qty (จำนวน) หรือ value (มูลค่า)
    ROUND(SUM(ib.qty), 0) AS inbound_qty_20d
  FROM months m
  JOIN `freshket-rn.dwh.inbound` ib                 -- ❗ ตารางจริง
    ON ib.received_date >= m.month_start            -- ❗ คอลัมน์วันที่จริง
   AND ib.received_date <= m.window_end
  GROUP BY 1, 2
),

growth_calc AS (
  SELECT
    *,
    ROUND(SAFE_DIVIDE(inbound_qty_20d - LAG(inbound_qty_20d) OVER (ORDER BY month_start),
                       LAG(inbound_qty_20d) OVER (ORDER BY month_start)) * 100, 1) AS inbound_mom_growth_pct
  FROM inbound_20d
),

benchmark AS (
  SELECT ROUND(AVG(inbound_mom_growth_pct), 1) AS avg_prior_inbound_growth_pct
  FROM growth_calc
  WHERE month_start < (SELECT MAX(month_start) FROM growth_calc)
)

SELECT month_label, inbound_qty_20d, inbound_mom_growth_pct, month_start FROM growth_calc
UNION ALL
SELECT 'AVG โต (ไม่รวมเดือนล่าสุด)', NULL, avg_prior_inbound_growth_pct, DATE '9999-12-31' FROM benchmark
ORDER BY month_start;




-- ============================================================
-- บล็อก 3 — Outbound (20 วันแรกของทุกเดือน) ❗ PLACEHOLDER — ยังไม่รู้ตารางจริง
-- แก้ 3 จุดเดียวกับบล็อก 2
-- ============================================================

DECLARE v_cutoff_day3  INT64 DEFAULT 20;
DECLARE v_start_month3 DATE  DEFAULT DATE '2026-01-01';
DECLARE v_data_end3    DATE  DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_end_month3   DATE  DEFAULT DATE_TRUNC(v_data_end3, MONTH);

WITH
months AS (
  SELECT
    month_start,
    LEAST(DATE_ADD(month_start, INTERVAL v_cutoff_day3 - 1 DAY), v_data_end3) AS window_end
  FROM UNNEST(GENERATE_DATE_ARRAY(v_start_month3, v_end_month3, INTERVAL 1 MONTH)) AS month_start
),

outbound_20d AS (
  SELECT
    m.month_start,
    FORMAT_DATE('%b %Y', m.month_start) AS month_label,
    -- ❗ แก้ทั้ง 3 จุดเหมือนบล็อก 2 (ตาราง / คอลัมน์วันที่ / เมตริก)
    ROUND(SUM(ob.qty), 0) AS outbound_qty_20d
  FROM months m
  JOIN `freshket-rn.dwh.outbound` ob                -- ❗ ตารางจริง
    ON ob.shipped_date >= m.month_start             -- ❗ คอลัมน์วันที่จริง
   AND ob.shipped_date <= m.window_end
  GROUP BY 1, 2
),

growth_calc AS (
  SELECT
    *,
    ROUND(SAFE_DIVIDE(outbound_qty_20d - LAG(outbound_qty_20d) OVER (ORDER BY month_start),
                       LAG(outbound_qty_20d) OVER (ORDER BY month_start)) * 100, 1) AS outbound_mom_growth_pct
  FROM outbound_20d
),

benchmark AS (
  SELECT ROUND(AVG(outbound_mom_growth_pct), 1) AS avg_prior_outbound_growth_pct
  FROM growth_calc
  WHERE month_start < (SELECT MAX(month_start) FROM growth_calc)
)

SELECT month_label, outbound_qty_20d, outbound_mom_growth_pct, month_start FROM growth_calc
UNION ALL
SELECT 'AVG โต (ไม่รวมเดือนล่าสุด)', NULL, avg_prior_outbound_growth_pct, DATE '9999-12-31' FROM benchmark
ORDER BY month_start;
