-- ════════════════════════════════════════════════════════════════════════════
-- Q3 2026 Movement — VP (All-Portfolio) View  (v1)
-- sql/q3_2026_movement_vp_view.sql
--
-- Generated from q2_2026_movement_vp_view.sql (v7) using the q3
-- rep/pm/admin upgrade pattern (v828-auto anchors + v830 day clamps).
--
-- Purpose: unified pool of ALL THREE portfolios (KAM, PM, ADMIN).
--   Grain = outlet × period_month — NO staff_owner grain.
--   curr_gmv = orders where commercial_owner IN ('KAM','PM','ADMIN')
--   base_gmv = full base-month GMV, no owner filter
--   Quarter anchors auto-derive from CURRENT_DATE('Asia/Bangkok') with
--   day-1 lag (v828-auto) — no manual edit needed each new quarter.
--
-- Classification priority (เหมือนกันทุกเดือน — unchanged from Q2 v7):
--   [1] core_nrr  : อยู่ใน mar_cohort (curr_gmv=0 ก็ยัง core_nrr)
--   [2] expansion : first_portfolio_date >= m1
--   [3] handover  : exp_date = base month AND prev_owner = SALE
--   [4] new_sales : exp_date ใน Q AND prev_owner = SALE
--             หรือ first_portfolio_date ใน Q (fallback ไม่มี exp_date)
--   [5] comeback  : first_dollar_date < m1 + ไม่มี exp_date ใน Q (prev != SALE)
--   [6] unclassified: ELSE
--
-- curr_gmv = เฉพาะ order ที่ commercial_owner IN (KAM,PM,ADMIN)
-- base_gmv = GMV ทุก order ใน base month ไม่ filter
-- ════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- v828-auto: quarter anchors AUTO-DERIVE from CURRENT_DATE — no manual edit
-- needed each new quarter. Run as a BigQuery SCRIPT (DECLARE/SET then SELECT),
-- not pasted as a plain view body. m1/m2/m3 = the 3 months of whichever
-- quarter we're currently in (Jul/Aug/Sep for Q3, Oct/Nov/Dec for Q4, etc.);
-- base = 1 month before the quarter starts (Jun for Q3, Sep for Q4, etc.).
-- Day-1 lag applied before quarter-truncation so day 1 of a new quarter still
-- reports the just-closed quarter until its own data is confirmed complete.
-- ══════════════════════════════════════════════════════════════════════════
DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_base_days  INT64;
DECLARE v_m1_start DATE;
DECLARE v_m1_end   DATE;
DECLARE v_m1_days  INT64;
DECLARE v_m2_start DATE;
DECLARE v_m2_end   DATE;
DECLARE v_m2_days  INT64;
DECLARE v_m3_start DATE;
DECLARE v_m3_end   DATE;
DECLARE v_m3_days  INT64;
DECLARE v_base_str STRING;
DECLARE v_m1_str   STRING;
DECLARE v_m2_str   STRING;
DECLARE v_m3_str   STRING;

SET v_m1_start  = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), QUARTER);
SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_base_days  = DATE_DIFF(v_base_end, v_base_start, DAY) + 1;
SET v_m2_start   = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end     = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start   = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end     = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end     = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);
-- v830: days-elapsed clamped per-month so the export is correct whenever it's run during
-- the quarter (start/mid/end) -- was previously hardcoded to always treat m3 as the only
-- MTD month, which broke completely (inverted date range, zero rows) when run early in
-- the quarter instead of at quarter-end.
SET v_m1_days = LEAST(DATE_DIFF(v_m1_end, v_m1_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m1_start, DAY) + 1, 0));
SET v_m2_days = LEAST(DATE_DIFF(v_m2_end, v_m2_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m2_start, DAY) + 1, 0));
SET v_m3_days = LEAST(DATE_DIFF(v_m3_end, v_m3_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m3_start, DAY) + 1, 0));
SET v_base_str   = FORMAT_DATE('%Y-%m', v_base_start);
SET v_m1_str     = FORMAT_DATE('%Y-%m', v_m1_start);
SET v_m2_str     = FORMAT_DATE('%Y-%m', v_m2_start);
SET v_m3_str     = FORMAT_DATE('%Y-%m', v_m3_start);

WITH
params AS (
  SELECT
    v_base_start AS base_start, v_base_end AS base_end, v_base_days AS base_days,
    v_m1_start   AS m1_start,   v_m1_end   AS m1_end,   v_m1_days   AS m1_days,
    v_m2_start   AS m2_start,   v_m2_end   AS m2_end,   v_m2_days   AS m2_days,
    v_m3_start   AS m3_start,   v_m3_end   AS m3_end,   v_m3_days   AS m3_days
),

-- current account_type จาก dim.user_master (สถานะล่าสุด ณ วันที่ query)
-- ใช้แทน r.account_type ที่มาจาก per-period order snapshot ซึ่งไม่ consistent
user_account_type AS (
  SELECT
    CAST(res_id AS STRING) AS outlet_id,
    account_type
  FROM `freshket-rn.dim.user_master`
),

-- outlet_first_dollar:
--   first_dollar_date    = first order date (global, ทุก owner)
--   first_portfolio_date = first order date ที่ owner IN (KAM,PM,ADMIN)
--   first_portfolio_owner = owner (KAM/PM/ADMIN) ณ first_portfolio_date
--   first_dollar_owner   = owner ของ first order จริงๆ (ทุก owner รวม SALE) — คนละความหมายกับ first_portfolio_owner
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    MIN(CASE WHEN UPPER(TRIM(o.commercial_owner)) IN ('KAM','PM','ADMIN')
             THEN DATE(o.delivery_date) END) AS first_portfolio_date,
    -- v851-fix: first_portfolio_owner = ซึ่ง portfolio (KAM/PM/ADMIN) ที่ outlet ถูก
    -- onboard เข้ามาครั้งแรก (owner ของออเดอร์ที่ตรงกับ first_portfolio_date) —
    -- เพิ่มเพราะ mar_cohort เคยใช้ first_dollar_owner (owner ของออเดอร์แรกสุดในชีวิต
    -- ร้าน ซึ่งมักเป็น SALE/AM) แทนคำถามนี้ผิด ทำให้ร้านที่ order ล่าสุดใน base month
    -- ผ่าน SALE หลุดจาก portfolio ที่แท้จริงไปเป็น SALE/AM (ดู mar_cohort ด้านล่าง)
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      -- BigQuery ไม่รองรับ "ASC NULLS LAST" ใน aggregate ORDER BY เลยดัน non-KAM/PM/ADMIN
      -- ไปท้ายแถวด้วย flag ตัวแรกแทน แล้วค่อย sort ตามวันที่จริงในกลุ่มที่ match
      ORDER BY
        CASE WHEN UPPER(TRIM(o.commercial_owner)) IN ('KAM','PM','ADMIN') THEN 0 ELSE 1 END ASC,
        CASE WHEN UPPER(TRIM(o.commercial_owner)) IN ('KAM','PM','ADMIN')
             THEN DATE(o.delivery_date) END ASC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS first_portfolio_owner,
    -- first_dollar_owner = owner ของ first order จริงๆ (ทุก owner รวม SALE)
    -- ถ้า first order เป็น SALE → expansion check ไม่ผ่าน → ตกไป new_sales
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- outlet_exp_date: exp_date ของ outlet — ดึงครั้งเดียวใช้ทั้งไตรมาส
-- cap ที่ yesterday ป้องกัน future exp_date ปน
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- outlet_prev_owner: last order ก่อน first KAM/PM/ADMIN order ของ outlet
-- ใช้ verify handover/new_sales ว่ามาจาก SALE จริง
-- ข้ามเดือนได้ — ไม่จำกัดแค่ base month
outlet_prev_owner AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS prev_owner
  FROM `freshket-rn.dwh.order` o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_portfolio_date
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
m1_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m1_start AND p.m1_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
m2_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
m3_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m3_start AND p.m3_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.commercial_owner IN ('KAM','PM','ADMIN')
  GROUP BY 1
),
m1_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m1_start AND p.m1_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
m2_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
m3_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.m3_start AND p.m3_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- mar_handover_outlets: outlet ที่ exp_date = base month AND prev_owner = SALE
-- ถ้า prev_owner != SALE → ไม่ exclude ออกจาก mar_cohort (จะเป็น core_nrr แทน)
-- mar_handover_outlets: exclude outlet ที่มี exp_date ใน Q (base/m1/m2/m3) + prev = SALE
-- ออกจาก mar_cohort → classify เป็น handover/new_sales แทน core_nrr
-- ครอบ Q ทั้งหมด ไม่ใช่แค่ base month
mar_handover_outlets AS (
  -- exp_date ใน Q + prev = SALE
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed  ON ofd.outlet_id = oed.outlet_id
  JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
        IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
    AND po.prev_owner = 'SALE'
  UNION DISTINCT
  -- exp_date ใน Q + ไม่มี prev order (outlet ใหม่มาก)
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed ON ofd.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
        IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
    AND po.outlet_id IS NULL
),

-- mar_cohort: outlet ที่ "อยู่ในพอร์ต" ตอนสิ้น base month
-- เงื่อนไข:
--   [A] base last order = KAM/PM/ADMIN (ดูแลอยู่ใน base month ตรงๆ)
--   [B] base last order = SALE แต่ first_portfolio_date < m1
--       (อยู่ในพอร์ตมาก่อนแล้ว SALE แค่สั่ง spot — ถือว่ายังอยู่ในพอร์ต)
-- ทั้งสองเงื่อนไข: base_gmv > 0 + ไม่ใช่ handover outlet
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    CASE
      WHEN mo.commercial_owner IN ('KAM','PM','ADMIN') THEN mo.commercial_owner
      -- v851-fix: เดิมใช้ ofd.first_dollar_owner (owner ของออเดอร์แรกสุดในชีวิตร้าน
      -- มักเป็น SALE/AM) ผิด ที่ถูกต้องคือ first_portfolio_owner (owner ตอนถูก
      -- onboard เข้า KAM/PM/ADMIN ครั้งแรก) — บั๊กเดิมทำให้ร้านที่ order ล่าสุดใน
      -- base month ผ่าน SALE หลุดจาก PM/ADMIN ไปเป็น SALE/AM ในภาพรวม (vp_view)
      ELSE ofd.first_portfolio_owner
    END AS base_portfolio,
    mo.staff_owner AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_portfolio_date, ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM (
    SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
      o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    mo.commercial_owner IN ('KAM','PM','ADMIN')
    OR (
      UPPER(TRIM(mo.commercial_owner)) = 'SALE'
      AND ofd.first_portfolio_date IS NOT NULL
      AND ofd.first_portfolio_date < v_m1_start
    )
  )
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── Classification (ใช้ร่วมกัน 3 เดือน) ──────────────────────────────────────
-- [1] core_nrr     : mar_cohort
-- [2] expansion    : first_portfolio_date >= m1
-- [3] handover     : exp_date = base month AND prev_owner = SALE
-- [4] new_sales    : exp_date ใน Q AND prev_owner = SALE
--                    หรือ first_portfolio_date ใน Q (fallback ไม่มี exp_date)
-- [5] comeback     : first_dollar < m1 + ไม่มี exp_date valid ใน Q
-- [6] unclassified : ELSE

-- mar_sale_owner: SALE staff ที่ดูแล outlet ใน base month
-- ใช้สำหรับ base_staff_owner ของ new_sales fallback
mar_sale_owner AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    TRIM(o.staff_owner) AS sale_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS sale_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

m1_rows AS (
  SELECT
    v_m1_str AS period_month,
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    ao.commercial_owner AS current_portfolio, ao.staff_owner AS current_staff_owner,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
               ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'SALE'
      ELSE COALESCE(mc.base_portfolio, ao.commercial_owner)
    END AS base_portfolio,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
               ELSE po.prev_owner END, 'SALE') = 'SALE' THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, ao.staff_owner)
    END AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_portfolio_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str, v_m2_str, v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'new_sales'
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str, v_m2_str, v_m3_str)               THEN 'new_sales'
      -- Scenario D: base GMV มี + first_portfolio ใน Q + prev=SALE
      -- exp_date ก่อน Q หรือไม่มีเลย → new_sales fallback (รอยต่อ SALE→KAM)
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'new_sales'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
             OR COALESCE(po.prev_owner,'') != 'SALE')
        THEN 'comeback'
      ELSE 'unclassified'
    END AS movement_type,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      -- handover/new_sales ปกติ: exp_date อยู่ใน Q
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      -- new_sales fallback: exp_date ก่อน Q หรือไม่มี → ใช้ first_portfolio_date
      WHEN ofd.first_portfolio_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_portfolio_date)
      ELSE NULL
    END AS cohort_month,
    CAST(NULL AS STRING) AS transfer_scope
  FROM m1_own ao
  LEFT JOIN mar_cohort mc            ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON ao.outlet_id = po.outlet_id
  LEFT JOIN m1_gmv ag                ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_sale_owner mso        ON ao.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON ao.outlet_id = bg.outlet_id
  WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  SELECT v_m1_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(ao_sale.commercial_owner, mc.base_portfolio) AS current_portfolio,
    COALESCE(ao_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.first_portfolio_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN ao_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr' END,
    v_base_str,
    CASE WHEN ao_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed ON mc.outlet_id = oed.outlet_id
  LEFT JOIN m1_own ao_port ON mc.outlet_id = ao_port.outlet_id
    AND ao_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN m1_own ao_sale ON mc.outlet_id = ao_sale.outlet_id
    AND ao_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE ao_port.outlet_id IS NULL
    AND v_m1_days > 0  -- v6-fix: skip silent-outlet fallback if month 1 hasn't started yet
),

m2_rows AS (
  SELECT v_m2_str,
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner, mo.staff_owner,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
               ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'SALE'
      ELSE COALESCE(mc.base_portfolio, mo.commercial_owner)
    END AS base_portfolio,
    CASE
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str, v_m2_str, v_m3_str) THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, mo.staff_owner)
    END,
    ofd.first_dollar_date, ofd.first_portfolio_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(mg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str, v_m2_str, v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'new_sales'
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str, v_m2_str, v_m3_str)               THEN 'new_sales'
      -- Scenario D: base GMV มี + first_portfolio ใน Q + prev=SALE
      -- exp_date ก่อน Q หรือไม่มีเลย → new_sales fallback (รอยต่อ SALE→KAM)
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'new_sales'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
             OR COALESCE(po.prev_owner,'') != 'SALE')
        THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_portfolio_date IS NOT NULL
        THEN FORMAT_DATE('%Y-%m', ofd.first_portfolio_date)
      ELSE NULL
    END,
    CAST(NULL AS STRING)
  FROM m2_own mo
  LEFT JOIN mar_cohort mc            ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON mo.outlet_id = po.outlet_id
  LEFT JOIN m2_gmv mg                ON mo.outlet_id = mg.outlet_id
  LEFT JOIN mar_sale_owner mso        ON mo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON mo.outlet_id = bg.outlet_id
  WHERE mo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  SELECT v_m2_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(mo_sale.commercial_owner, mc.base_portfolio) AS current_portfolio,
    COALESCE(mo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.first_portfolio_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN mo_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr' END,
    v_base_str,
    CASE WHEN mo_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed ON mc.outlet_id = oed.outlet_id
  LEFT JOIN m2_own mo_port ON mc.outlet_id = mo_port.outlet_id
    AND mo_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN m2_own mo_sale ON mc.outlet_id = mo_sale.outlet_id
    AND mo_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE mo_port.outlet_id IS NULL
    AND v_m2_days > 0  -- v6-fix: skip silent-outlet fallback if month 2 hasn't started yet
),

m3_rows AS (
  SELECT v_m3_str,
    jo.outlet_id, jo.account_id, jo.account_name, jo.res_name, jo.account_type,
    jo.commercial_owner, jo.staff_owner,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
               ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'SALE'
      ELSE COALESCE(mc.base_portfolio, jo.commercial_owner)
    END AS base_portfolio,
    CASE
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str, v_m2_str, v_m3_str) THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, jo.staff_owner)
    END,
    ofd.first_dollar_date, ofd.first_portfolio_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(jg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str, v_m2_str, v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE' THEN 'new_sales'
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str, v_m2_str, v_m3_str)               THEN 'new_sales'
      -- Scenario D: base GMV มี + first_portfolio ใน Q + prev=SALE
      -- exp_date ก่อน Q หรือไม่มีเลย → new_sales fallback (รอยต่อ SALE→KAM)
      WHEN ofd.first_portfolio_date IS NOT NULL
        AND ofd.first_portfolio_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)) THEN 'new_sales'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
             OR COALESCE(po.prev_owner,'') != 'SALE')
        THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str, v_m1_str, v_m2_str, v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_portfolio_date IS NOT NULL
        THEN FORMAT_DATE('%Y-%m', ofd.first_portfolio_date)
      ELSE NULL
    END,
    CAST(NULL AS STRING)
  FROM m3_own jo
  LEFT JOIN mar_cohort mc            ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON jo.outlet_id = po.outlet_id
  LEFT JOIN m3_gmv jg                ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_sale_owner mso        ON jo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON jo.outlet_id = bg.outlet_id
  WHERE jo.commercial_owner IN ('KAM','PM','ADMIN')

  UNION ALL

  SELECT v_m3_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(jo_sale.commercial_owner, mc.base_portfolio) AS current_portfolio,
    COALESCE(jo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    mc.base_portfolio, mc.base_staff_owner,
    mc.first_dollar_date, mc.first_portfolio_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE WHEN jo_sale.outlet_id IS NOT NULL THEN 'transfer_out' ELSE 'core_nrr' END,
    v_base_str,
    CASE WHEN jo_sale.outlet_id IS NOT NULL THEN 'external' ELSE NULL END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed ON mc.outlet_id = oed.outlet_id
  LEFT JOIN m3_own jo_port ON mc.outlet_id = jo_port.outlet_id
    AND jo_port.commercial_owner IN ('KAM','PM','ADMIN')
  LEFT JOIN m3_own jo_sale ON mc.outlet_id = jo_sale.outlet_id
    AND jo_sale.commercial_owner NOT IN ('KAM','PM','ADMIN')
  WHERE jo_port.outlet_id IS NULL
    AND v_m3_days > 0  -- v6-fix: skip silent-outlet fallback if month 3 hasn't started yet
),

all_rows AS (
  SELECT * FROM m1_rows
  UNION ALL SELECT * FROM m2_rows
  UNION ALL SELECT * FROM m3_rows
)

SELECT
  r.period_month, r.movement_type, r.transfer_scope,
  r.current_portfolio, r.current_staff_owner,
  r.base_portfolio, r.base_staff_owner,
  r.outlet_id, r.account_id, r.account_name, r.res_name, COALESCE(um.account_type, r.account_type) AS account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0) AS curr_gmv,
  ROUND(r.base_gmv, 0) AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN v_m1_str THEN p.m1_days
    WHEN v_m2_str THEN p.m2_days
    WHEN v_m3_str THEN p.m3_days
  END AS curr_days,
  r.first_dollar_date,
  r.first_portfolio_date,
  r.first_dollar_owner,
  r.new_user_exp_date
FROM all_rows r
CROSS JOIN params p
LEFT JOIN user_account_type um ON r.outlet_id = um.outlet_id
ORDER BY r.period_month, r.current_portfolio, r.movement_type, r.curr_gmv DESC
