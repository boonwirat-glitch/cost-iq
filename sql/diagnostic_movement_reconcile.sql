-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNOSTIC: Movement Classification Reconcile
-- เป้าหมาย: ดู ground truth ราย outlet ของ account ที่สงสัย
--   - Gallery Pizza Co., LTD (Monet) — handover_perf หาย, โผล่ใน new_sales
--   - Choongman (Dent) — ยกทั้ง account มาเป็น new_sales
-- ════════════════════════════════════════════════════════════════════════════
--
-- รันแล้วส่ง CSV กลับมา — จะบอกได้ว่าแต่ละ outlet ควรเป็น movement ประเภทไหน
-- เทียบกับสิ่งที่ app แสดง
--
-- วิธีใช้: แก้ TARGET_ACCOUNT_NAMES ด้านล่างถ้าต้องการดู account อื่น
-- ════════════════════════════════════════════════════════════════════════════

WITH params AS (
  SELECT
    DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)                                AS lag_date,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)             AS perf_start,
    DATE_SUB(DATE_TRUNC(DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH), INTERVAL 1 DAY) AS perf_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))          AS perf_label,
    DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH) AS prev_start,
    DATE_SUB(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), INTERVAL 1 DAY)   AS prev_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH)) AS prev_label
),

-- ปรับชื่อ account ที่ต้องการตรวจตรงนี้
target_accounts AS (
  SELECT name FROM UNNEST([
    'Gallery Pizza Co., LTD',
    'ANZALONEPIZZA',
    'Choongman'        -- partial match — ครอบคลุมทุก Choongman
  ]) AS name
),

-- account_guid ที่ match ชื่อเป้าหมาย
target_guids AS (
  SELECT DISTINCT um.account_guid, um.account_name
  FROM `freshket-rn.dim.user_master` um
  CROSS JOIN target_accounts ta
  WHERE um.account_name LIKE '%' || ta.name || '%'
    AND um.account_guid IS NOT NULL
),

-- ── outlet-level ownership snapshot จาก user_master (current) ──
um_current AS (
  SELECT
    CAST(um.res_id AS STRING)        AS outlet_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.account_type,
    UPPER(TRIM(COALESCE(um.commercial_owner,''))) AS current_commercial_owner,
    TRIM(COALESCE(NULLIF(um.staff_owner,''), NULLIF(um.kam_owner,''), NULLIF(um.ka_owner,''),'')) AS current_kam_name,
    TRIM(COALESCE(um.sales_owner,''))             AS sales_owner,
    DATE(um.new_user_exp_date)       AS new_user_exp_date,
    DATE(um.first_dollar_date)       AS first_dollar_date,
    DATE(um.lasted_order_date)       AS lasted_order_date
  FROM `freshket-rn.dim.user_master` um
  WHERE um.res_id IS NOT NULL
    AND CAST(um.account_guid AS STRING) IN (SELECT account_id FROM target_guids)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CAST(um.res_id AS STRING) ORDER BY DATE(um.lasted_order_date) DESC NULLS LAST) = 1
),

-- ── order evidence: Apr/May/June ราย outlet ──
order_ev AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    -- Apr (prev_month)
    SUM(CASE WHEN o.delivery_date BETWEEN p.prev_start AND p.prev_end THEN o.gmv_ex_vat ELSE 0 END) AS prev_gmv,
    MAX(CASE WHEN o.delivery_date BETWEEN p.prev_start AND p.prev_end THEN o.delivery_date END)     AS prev_last_order,
    -- current month
    SUM(CASE WHEN o.delivery_date BETWEEN p.perf_start AND p.perf_end THEN o.gmv_ex_vat ELSE 0 END) AS curr_gmv,
    MAX(CASE WHEN o.delivery_date BETWEEN p.perf_start AND p.perf_end THEN o.delivery_date END)     AS curr_last_order,
    -- Apr owner (last order in prev month)
    ARRAY_AGG(
      CASE WHEN o.delivery_date BETWEEN p.prev_start AND p.prev_end
           THEN STRUCT(UPPER(TRIM(o.commercial_owner)) AS co, TRIM(o.staff_owner) AS so, o.delivery_date AS dt) END
      IGNORE NULLS ORDER BY o.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS prev_owner,
    -- current owner (last order in current month)
    ARRAY_AGG(
      CASE WHEN o.delivery_date BETWEEN p.perf_start AND p.perf_end
           THEN STRUCT(UPPER(TRIM(o.commercial_owner)) AS co, TRIM(o.staff_owner) AS so, o.delivery_date AS dt) END
      IGNORE NULLS ORDER BY o.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS curr_owner,
    -- first KAM order date (all time)
    MIN(CASE WHEN UPPER(TRIM(o.commercial_owner))='KAM' THEN o.delivery_date END) AS first_kam_order,
    -- first any order (all time)
    MIN(o.delivery_date) AS first_any_order,
    -- current month: SALE vs KAM order timing
    MAX(CASE WHEN o.delivery_date BETWEEN p.perf_start AND p.perf_end AND UPPER(TRIM(o.commercial_owner))='SALE' THEN o.delivery_date END) AS curr_last_sale,
    MAX(CASE WHEN o.delivery_date BETWEEN p.perf_start AND p.perf_end AND UPPER(TRIM(o.commercial_owner))='KAM'  THEN o.delivery_date END) AS curr_last_kam
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND CAST(o.account_id AS STRING) IN (SELECT account_id FROM target_guids)
    AND o.delivery_date >= DATE_SUB(p.prev_start, INTERVAL 6 MONTH)
  GROUP BY 1
)

SELECT
  c.account_name,
  c.account_id,
  c.outlet_id,
  -- ownership
  c.current_commercial_owner,
  c.current_kam_name,
  c.sales_owner,
  CAST(c.new_user_exp_date AS STRING)  AS new_user_exp_date,
  CAST(c.first_dollar_date AS STRING)  AS first_dollar_date,
  -- Apr
  e.prev_owner.co  AS apr_commercial_owner,
  e.prev_owner.so  AS apr_staff_owner,
  ROUND(e.prev_gmv) AS apr_gmv,
  -- current
  e.curr_owner.co  AS curr_commercial_owner,
  e.curr_owner.so  AS curr_staff_owner,
  ROUND(e.curr_gmv) AS curr_gmv,
  -- timing signals
  CAST(e.first_kam_order AS STRING)  AS first_kam_order,
  CAST(e.first_any_order AS STRING)  AS first_any_order,
  CAST(e.curr_last_sale AS STRING)   AS curr_last_sale,
  CAST(e.curr_last_kam AS STRING)    AS curr_last_kam,
  -- ── EXPECTED CLASSIFICATION (ground truth logic) ──
  (SELECT prev_label FROM params)  AS prev_month,
  (SELECT perf_label FROM params)  AS curr_month,
  CASE
    -- handover_perf: โอนจาก SALE เดือนก่อน (new_user_exp_date ใน prev month)
    WHEN c.new_user_exp_date IS NOT NULL
         AND FORMAT_DATE('%Y-%m', c.new_user_exp_date) = (SELECT prev_label FROM params)
      THEN 'handover_perf (Sales→KAM prev month)'
    -- new_sales: โอนจาก SALE เดือนนี้ (new_user_exp_date ใน curr month)
    WHEN c.new_user_exp_date IS NOT NULL
         AND FORMAT_DATE('%Y-%m', c.new_user_exp_date) = (SELECT perf_label FROM params)
      THEN 'new_sales (Sales→KAM curr month, exp_date)'
    -- new_sales PATH B: SALE order before KAM order in curr month
    WHEN e.curr_last_sale IS NOT NULL AND e.curr_last_kam IS NOT NULL
         AND e.curr_last_sale < e.curr_last_kam
      THEN 'new_sales (PATH B: SALE before KAM)'
    -- core: same KAM both months + gmv both
    WHEN e.prev_owner.co = 'KAM' AND e.curr_owner.co = 'KAM'
         AND e.prev_owner.so = e.curr_owner.so
         AND e.prev_gmv > 0 AND e.curr_gmv > 0
      THEN 'core_nrr (same KAM both months)'
    -- transfer_in: Apr KAM/PM/ADMIN, curr KAM different
    WHEN e.prev_owner.co IN ('KAM','PM','ADMIN') AND e.curr_owner.co = 'KAM'
         AND e.prev_owner.so != e.curr_owner.so
      THEN 'transfer_in (KAM→KAM)'
    WHEN e.curr_gmv = 0 AND e.prev_gmv > 0
      THEN 'churned / transferred out'
    WHEN e.prev_gmv = 0 AND e.curr_gmv > 0 AND e.first_any_order >= (SELECT perf_start FROM params)
      THEN 'expansion (brand new outlet)'
    WHEN e.prev_gmv = 0 AND e.curr_gmv > 0
      THEN 'comeback (was inactive)'
    ELSE 'unclassified'
  END AS expected_classification
FROM um_current c
LEFT JOIN order_ev e ON e.outlet_id = c.outlet_id
ORDER BY c.account_name, expected_classification, e.curr_gmv DESC;
