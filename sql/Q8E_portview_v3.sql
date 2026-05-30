-- ════════════════════════════════════════════════════════════
-- Q8E v3: Portview Enriched + KAM Mapping
-- ════════════════════════════════════════════════════════════
-- Output: portview.csv  (20 columns, account-level, 1 row / account_guid)
--
-- เปลี่ยนจาก v207h:
--   1. OWNERSHIP = user_master เท่านั้น (ตัด order_fallback ทิ้ง)
--      → กัน false-positive (ร้านที่ KAM ไม่ได้ถือจริงแต่เคยมี order)
--   2. JOIN GMV/SKU ผ่าน res_id (ไม่ใช่ account_guid)
--      → กัน account rename ที่ทำให้ account_guid เปลี่ยนแล้ว GMV หาย
--   3. ROLL-UP กลับเป็น account_guid (1 row/account) ก่อน output
--      → ตรงกับ parser (byAccountId) + dataset อื่นที่ key ด้วย account_guid
--   4. YTD FILTER: เก็บเฉพาะ account ที่มี order ≥1 ครั้งตั้งแต่ 1 Jan ปีนี้
--      → ตัดร้านตาย/closed, เก็บร้านที่เพิ่งเงียบ (ตรง ground truth)
--
-- เก็บเหมือน v207h: schema 20 คอลัมน์, churn/cat/sku/days logic
--
-- ROLL-UP rules (account มีหลาย outlet):
--   • GMV / sku_count / orders          → SUM ทุก outlet
--   • days_with_current_kam             → MAX (outlet ที่อยู่กับ KAM นานสุด)
--   • res_name / account_class / type   → ค่าจาก outlet ที่ lasted_order_date ใหม่สุด
--   • churn / missing_cat               → compute ที่ account level (หลัง roll-up)
-- ════════════════════════════════════════════════════════════

WITH params AS (
  SELECT
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                AS cur_month_start,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)    AS last_month_start,
    DATE_TRUNC(CURRENT_DATE(), YEAR)                                 AS ytd_start,   -- 1 Jan ปีนี้
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))       AS max_date,
    EXTRACT(DAY FROM DATE_SUB(
      DATE_TRUNC(DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH),
      INTERVAL 1 DAY))                                               AS days_in_month
),
params_derived AS (
  SELECT *, DATE_DIFF(max_date, DATE_TRUNC(max_date, MONTH), DAY) + 1 AS days_elapsed
  FROM params
),

kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── OWNERSHIP: user_master เท่านั้น, grain = outlet (res_id) ──
-- 1 row / res_id; dedup ด้วย lasted_order_date ใหม่สุด
-- กรอง: commercial_owner=KAM + staff_owner_email ตรง kam_list
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)        AS res_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.res_name,
    um.account_type,
    um.account_class,
    k.kam_name, k.kam_email, k.tl_email,
    DATE(um.lasted_order_date)       AS lasted_order_date
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── GMV per outlet (JOIN via res_id = user_id ใน order) ──
-- last month
gmv_last_outlet AS (
  SELECT CAST(o.user_id AS STRING) AS res_id,
         ROUND(SUM(i.gmv_ex_vat),0) AS last_gmv,
         COUNT(DISTINCT i.item_id)  AS last_sku_count
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),
-- current month MTD
gmv_cur_outlet AS (
  SELECT CAST(o.user_id AS STRING) AS res_id,
         ROUND(SUM(i.gmv_ex_vat),0) AS cur_gmv,
         COUNT(DISTINCT o.order_id) AS orders_to_date,
         COUNT(DISTINCT i.item_id)  AS cur_sku_count
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),
-- YTD activity (1 Jan → now) — ใช้กรองร้านตาย
ytd_active_outlet AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS res_id
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.delivery_date >= p.ytd_start
    AND o.delivery_date <= p.max_date
),

-- ── days_with_current_kam per outlet (ผ่าน res_id) ──
-- first order ใต้ KAM คนปัจจุบัน (proxy handoff date)
kam_since_outlet AS (
  SELECT CAST(user_id AS STRING) AS res_id,
         ka_owner,
         MIN(delivery_date) AS first_order_date
  FROM `freshket-rn.dwh.order`
  WHERE ka_owner IS NOT NULL
    AND ka_owner NOT IN ('ka.sa.admin','Admin Freshket')
    AND delivery_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
  GROUP BY 1, 2
),
last_order_owner_outlet AS (
  SELECT CAST(user_id AS STRING) AS res_id,
         ka_owner AS last_order_kam
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA','MC','Chain','Unknown')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CAST(user_id AS STRING) ORDER BY delivery_date DESC) = 1
),

-- ── join ทุกอย่างที่ outlet level ──
outlet_enriched AS (
  SELECT
    ko.res_id, ko.account_id, ko.account_name, ko.res_name,
    ko.account_type, ko.account_class,
    ko.kam_name, ko.kam_email, ko.tl_email, ko.lasted_order_date,
    COALESCE(gl.last_gmv,0)       AS last_gmv,
    COALESCE(gl.last_sku_count,0) AS last_sku_count,
    COALESCE(gc.cur_gmv,0)        AS cur_gmv,
    COALESCE(gc.orders_to_date,0) AS orders_to_date,
    COALESCE(gc.cur_sku_count,0)  AS cur_sku_count,
    -- days_with_current_kam ต่อ outlet (v207h logic: transfer pending = 0)
    CASE
      WHEN loo.last_order_kam IS NOT NULL
        AND LOWER(TRIM(loo.last_order_kam)) != LOWER(TRIM(ko.kam_name)) THEN 0
      WHEN ks.first_order_date IS NOT NULL
        THEN DATE_DIFF(CURRENT_DATE(), ks.first_order_date, DAY)
      ELSE NULL
    END AS days_with_current_kam
  FROM kam_outlets ko
  JOIN ytd_active_outlet ya       ON ya.res_id = ko.res_id       -- YTD filter (ตัดร้านตาย)
  LEFT JOIN gmv_last_outlet gl    ON gl.res_id = ko.res_id
  LEFT JOIN gmv_cur_outlet  gc    ON gc.res_id = ko.res_id
  LEFT JOIN kam_since_outlet ks   ON ks.res_id = ko.res_id AND ks.ka_owner = ko.kam_name
  LEFT JOIN last_order_owner_outlet loo ON loo.res_id = ko.res_id
),

-- ── ROLL-UP: outlet → account (1 row/account_guid) ──
-- non-additive fields (res_name, class, type) เอาจาก outlet ที่ lasted_order ใหม่สุด
account_latest_outlet AS (
  SELECT account_id, res_name, account_class, account_type, kam_name, kam_email, tl_email
  FROM outlet_enriched
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY lasted_order_date DESC NULLS LAST
  ) = 1
),
account_rolled AS (
  SELECT
    oe.account_id,
    MAX(oe.account_name)              AS account_name,
    SUM(oe.last_gmv)                  AS last_month_gmv,
    SUM(oe.cur_gmv)                   AS gmv_to_date,
    SUM(oe.last_sku_count)            AS last_month_sku_count,
    SUM(oe.cur_sku_count)             AS cur_sku_count,
    SUM(oe.orders_to_date)            AS orders_to_date,
    MAX(oe.days_with_current_kam)     AS days_with_current_kam,  -- outlet ที่อยู่นานสุด
    COUNT(*)                          AS outlet_count
  FROM outlet_enriched oe
  GROUP BY 1
),

-- ── churn / missing_cat: compute ที่ account level (join via res_id ของ KAM outlets) ──
-- last month SKUs (ordered ≥3x) ที่หายใน cur month
acct_res AS (  -- mapping res_id → account ของ KAM เท่านั้น
  SELECT res_id, account_id FROM kam_outlets
),
last_month_skus AS (
  SELECT ar.account_id, i.item_id, i.item_name_th,
         COUNT(DISTINCT o.order_id) AS order_count,
         ROUND(SUM(i.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  JOIN acct_res ar ON ar.res_id = CAST(o.user_id AS STRING)
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3
  HAVING order_count >= 3
),
current_month_skus AS (
  SELECT DISTINCT ar.account_id, i.item_id
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  JOIN acct_res ar ON ar.res_id = CAST(o.user_id AS STRING)
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date
    AND i.gmv_ex_vat > 0
),
churn_summary AS (
  SELECT lm.account_id,
         COUNT(*) AS churned_sku_count,
         ROUND(SUM(lm.gmv),0) AS churned_gmv,
         STRING_AGG(lm.item_name_th, ' | ' ORDER BY lm.gmv DESC LIMIT 5) AS top_churned_names
  FROM last_month_skus lm
  LEFT JOIN current_month_skus cm ON lm.account_id=cm.account_id AND lm.item_id=cm.item_id
  WHERE cm.item_id IS NULL
  GROUP BY 1
),
last_month_cats AS (
  SELECT ar.account_id, i.category_high_level AS cat, ROUND(SUM(i.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  JOIN acct_res ar ON ar.res_id = CAST(o.user_id AS STRING)
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2
  HAVING gmv >= 3000
),
current_month_cats AS (
  SELECT DISTINCT ar.account_id, i.category_high_level AS cat
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  JOIN acct_res ar ON ar.res_id = CAST(o.user_id AS STRING)
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date
    AND i.gmv_ex_vat > 0
),
cat_gap_summary AS (
  SELECT lc.account_id,
         COUNT(*) AS missing_cat_count,
         STRING_AGG(lc.cat || ' (' || CAST(lc.gmv AS STRING) || ')', ' | ' ORDER BY lc.gmv DESC) AS missing_cats
  FROM last_month_cats lc
  LEFT JOIN current_month_cats cc ON lc.account_id=cc.account_id AND lc.cat=cc.cat
  WHERE cc.cat IS NULL
  GROUP BY 1
)

-- ── FINAL: 20 columns ตรง parser (portview_original) ──
SELECT
  ar.account_id,                                                            -- [0]
  ar.account_name,                                                          -- [1]
  ar.last_month_gmv,                                                        -- [2]
  ar.gmv_to_date,                                                           -- [3]
  p.days_elapsed,                                                           -- [4]
  p.days_in_month,                                                          -- [5]
  ROUND(ar.gmv_to_date / NULLIF(p.days_elapsed,0) * p.days_in_month, 0)     -- [6] runrate_gmv
                                                                AS runrate_gmv,
  alo.account_type,                                                         -- [7]
  COALESCE(ch.churned_sku_count, 0)             AS churned_sku_count,       -- [8]
  COALESCE(ch.churned_gmv, 0)                   AS churned_gmv,             -- [9]
  ch.top_churned_names,                                                     -- [10]
  COALESCE(cg.missing_cat_count, 0)             AS missing_cat_count,       -- [11]
  cg.missing_cats,                                                          -- [12]
  ar.last_month_sku_count,                                                  -- [13]
  ar.cur_sku_count,                                                         -- [14]
  ar.orders_to_date,                                                        -- [15]
  alo.kam_name,                                                             -- [16]
  alo.kam_email,                                                            -- [17]
  alo.tl_email,                                                             -- [18]
  ar.days_with_current_kam                                                  -- [19]
FROM account_rolled ar
JOIN account_latest_outlet alo ON alo.account_id = ar.account_id
LEFT JOIN churn_summary ch     ON ch.account_id  = ar.account_id
LEFT JOIN cat_gap_summary cg   ON cg.account_id  = ar.account_id
CROSS JOIN params_derived p
ORDER BY alo.kam_name, ar.gmv_to_date DESC;
