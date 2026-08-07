-- ══════════════════════════════════════════════════════════════
-- Q3C Upsell Bulk ALL KAMs — v4
-- v4: Remove new_gmv and comeback_gmv columns (dead fields not used by app)
--   → reduces CSV file size ~22% (7 cols instead of 9)
--   → app parser updated to match (02_data_pipeline.js v4)
-- v3 fix retained: KAM→account mapping ใช้ logic เดียวกับ Q8E
--
-- Columns (7): kam_email, account_id, outlet_id, month_label, group_key,
--              existing_gmv, total_gmv
-- ══════════════════════════════════════════════════════════════

WITH
dates AS (
  SELECT
    -- v827-auto: baseline_mo + lookback_start AUTO-DERIVE from current_mo's own quarter —
    -- no manual date edit needed each new quarter (Q3→Q4→Q1... all self-adjust).
    -- current_mo = the month being reported (day-1 lag, e.g. run Aug-1 → reports Jul).
    -- baseline_mo = 1 month before the START of current_mo's quarter
    --   (Jul/Aug/Sep all → Jun; Oct/Nov/Dec all → Sep; etc.)
    -- lookback_start = 2 months before baseline_mo, giving a fixed 3-month pool
    --   (baseline_mo, baseline_mo-1, baseline_mo-2) that stays constant across the whole quarter,
    --   matching the app's _commBaseMonthLabels(base_month, 3) window.
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)                                       AS current_mo,
    DATE_SUB(DATE_TRUNC(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), QUARTER),
             INTERVAL 1 MONTH)                                                                        AS baseline_mo,
    DATE_SUB(DATE_SUB(DATE_TRUNC(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), QUARTER),
             INTERVAL 1 MONTH), INTERVAL 2 MONTH)                                                     AS lookback_start
),

-- Active KAM whitelist
kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email),
    STRUCT('Treerak (May) Sangjua'             AS kam_name, 'treerak.s@freshket.co'      AS kam_email)
  ])
),

-- KAM→account mapping (Q8E logic)
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    k.kam_email
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

-- ── NRR Core ownership CTEs (same KAM baseline→current, no handover) ───
-- v5: align upsell scope with NRR core (same as May backfill + q3c_team_v5)
apr_outlet_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  WHERE o.delivery_date >= d.baseline_mo
    AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
-- v_splitallmonths (2026-08-08): generalize "current month" → ทุกเดือนของ
-- ไตรมาสที่ผ่านมาแล้ว เพื่อให้ existing/new split มีจริงทุกเดือน ไม่ใช่แค่เดือน
-- ล่าสุดของไฟล์ · ต้นเหตุ: lookback arm เดิม hardcode `0.0 AS existing_gmv`
-- → พอไฟล์ขยับเข้าเดือนใหม่ P3 "สด" ของเดือนก่อนหน้าคำนวณไม่ได้เลย (เป็น ฿0
-- เชิงโครงสร้าง — เจอจริงตอน reconcile ก.ค. บนไฟล์ของ ส.ค.: live P3 = 0 ทั้ง
-- 14 KAM) · นิยาม "existing" ต่อเดือน M = อยู่เดือนฐาน + KAM เดิมทั้งเดือนฐาน
-- และเดือน M (สแนปช็อตความเป็นเจ้าของ "ณ เดือนนั้น" ไม่ใช่ ณ วันนี้) — เดือน
-- ล่าสุดของไฟล์ได้ค่าตรงกับนิยามเดิมเป๊ะ (month_ownership(current_mo) ≡
-- may_outlet_ownership เดิม) แถวเดือนปัจจุบันจึงไม่ขยับแม้แต่แถวเดียว
quarter_months AS (
  SELECT month_start
  FROM dates d,
       UNNEST(GENERATE_DATE_ARRAY(DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH),
                                  d.current_mo, INTERVAL 1 MONTH)) AS month_start
),
month_ownership AS (
  SELECT
    qm.month_start,
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  JOIN quarter_months qm
    ON o.delivery_date >= qm.month_start
   AND o.delivery_date <  DATE_ADD(qm.month_start, INTERVAL 1 MONTH)
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY qm.month_start, o.user_id ORDER BY o.delivery_date DESC) = 1
),
-- NRR-core ต่อเดือน: KAM คนเดียวกันทั้งเดือนฐานและเดือนนั้นๆ + ไม่ใช่ new user
-- ณ เดือนฐาน — logic เดียวกับ nrr_core_outlets เดิมทุกเงื่อนไข แค่เพิ่มมิติเดือน
nrr_core_by_month AS (
  SELECT mo.month_start, mo.outlet_id
  FROM month_ownership mo
  JOIN apr_outlet_ownership a ON mo.outlet_id = a.outlet_id
  JOIN kam_list k_m ON mo.commercial_owner = 'KAM'
    AND TRIM(mo.staff_owner) = TRIM(k_m.kam_name)
  JOIN kam_list k_a ON a.commercial_owner = 'KAM'
    AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)
    AND k_a.kam_email = k_m.kam_email
  WHERE (
    a.new_user_exp_date IS NULL
    OR a.new_user_exp_date < (SELECT baseline_mo FROM dates)
  )
),

-- Outlet status (existing / expansion / comeback)
-- existing = in baseline month AND same KAM both months (NRR core)
outlet_history AS (
  SELECT
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date)      AS first_seen,
    MAX(CASE WHEN o.delivery_date >= d.baseline_mo
              AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
             THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= d.current_mo THEN 1 ELSE 0 END) AS in_current
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE_SUB((SELECT baseline_mo FROM dates), INTERVAL 5 MONTH)
    AND o.delivery_date <  DATE_ADD((SELECT current_mo FROM dates), INTERVAL 1 MONTH)
  GROUP BY 1, 2
),
-- v_splitallmonths: outlet_status เดิม (สแนปช็อตเดือนเดียว) ถูกแทนด้วย
-- nrr_core_by_month + oh.in_baseline ตรงใน current_split — เงื่อนไข 'existing'
-- เดิมคือ in_baseline=1 AND อยู่ใน NRR core ซึ่งย้ายไปเทียบต่อเดือนแล้ว
-- ('expansion'/'comeback' ของ CTE เดิมไม่เคยถูก consumer ไหนใช้)

-- Current month: outlet × group_key
-- existing_gmv: GMV from existing outlets (used for P3)
-- total_gmv: all GMV for this outlet × group_key (used for P1)
current_items AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    i.category_high_level AS category,  -- v_catbonus: kept for per-category rate lookup (was discarded)
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    i.gmv_ex_vat,
    i.margin_ex_vat,  -- v_gp: same unnested item row, no extra join needed
    -- v_splitallmonths: คีย์เดือนสำหรับ join สถานะ existing "ณ เดือนนั้น"
    DATE_TRUNC(o.delivery_date, MONTH) AS month_start
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  -- v_splitallmonths: จากเดิมเฉพาะ current_mo → ทุกเดือนของไตรมาสที่มาถึงแล้ว
  WHERE o.delivery_date >= DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
    AND o.delivery_date <  DATE_ADD(d.current_mo, INTERVAL 1 MONTH)
    -- v_gp: this gmv_ex_vat > 0 filter is PRE-EXISTING and stays exactly as is.
    -- Removing it would change total_gmv and therefore move real commission
    -- payouts. It also happens to be the right thing for %GP: margin is summed
    -- over precisely the same rows as the GMV it will be divided by, so the
    -- ratio is internally consistent. Do NOT add a margin_ex_vat > 0 filter
    -- alongside it — negative margin on loss-leaders must survive.
    AND i.gmv_ex_vat > 0
),
current_split AS (
  SELECT
    ci.kam_email, ci.account_id, ci.outlet_id, ci.month_label, ci.group_key,
    ANY_VALUE(ci.category) AS category,  -- v_catbonus: 1:1 with group_key, ANY_VALUE is safe
    -- v_splitallmonths: 'existing ณ เดือนนั้น' = อยู่เดือนฐาน (oh.in_baseline)
    -- + อยู่ NRR core ของเดือนนั้น (ncm) — เงื่อนไขเดียวกับ outlet_status เดิม
    -- แต่เทียบด้วยความเป็นเจ้าของของเดือนที่แถวนั้นสังกัด ไม่ใช่เดือนล่าสุดของไฟล์
    SUM(CASE WHEN oh.in_baseline = 1 AND ncm.outlet_id IS NOT NULL THEN ci.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(ci.gmv_ex_vat) AS total_gmv,
    -- v_gp: margin split EXACTLY the same two ways as GMV above. Both splits are
    -- needed, not just the total: the BREAKDOWN table's P1 rows read total_gmv
    -- while its P3 rows read existing_gmv, so a GP lens with only one of them
    -- would silently pair a P3 row's existing-outlet GMV with whole-group GP.
    SUM(CASE WHEN oh.in_baseline = 1 AND ncm.outlet_id IS NOT NULL THEN COALESCE(ci.margin_ex_vat, 0) ELSE 0 END) AS existing_margin,
    SUM(COALESCE(ci.margin_ex_vat, 0)) AS total_margin,
    -- v_gp: GMV of the rows that actually carried a margin value → coverage.
    -- Lets the client tell "GP really is thin" from "margin data is missing".
    SUM(IF(ci.margin_ex_vat IS NULL, 0, ci.gmv_ex_vat)) AS gmv_with_margin
  FROM current_items ci
  LEFT JOIN outlet_history oh
    ON ci.account_id = oh.account_id AND ci.outlet_id = oh.outlet_id
  LEFT JOIN nrr_core_by_month ncm
    ON ci.outlet_id = ncm.outlet_id AND ci.month_start = ncm.month_start
  GROUP BY 1,2,3,4,5
),

-- Lookback 3 months: total_gmv for max_baseline calculation (P3)
lookback AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    -- v_dupfix (2026-08-08): เดิม category อยู่ใน GROUP BY → ถ้า group_key เดียวกัน
    -- ถูกตีเป็นคนละ category (ข้อมูลต้นทางไม่นิ่ง เช่น JUICE เป็นทั้ง Beverage
    -- Non-alcohol และ Processed Food) จะได้ 2 แถวต่อ (ร้าน,เดือน,กลุ่ม) เดียวกัน
    -- · parser ทั้งสองฝั่งเขียนทับ (data[acc][outlet][group][month] = {...})
    -- เก็บแค่แถวสุดท้าย → max_baseline ของ P3 ต่ำกว่าความจริง = ผ่านเกณฑ์ง่ายเกิน
    -- = เสี่ยงจ่ายเกิน (วัดจากไฟล์จริง 847 คีย์ ฐานหายรวม ฿1.8M)
    -- แก้ให้ตรงกับ current_split ที่ใช้ ANY_VALUE มาตลอด → 1 คีย์ 1 แถวเสมอ
    ANY_VALUE(i.category_high_level) AS category,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    0.0 AS existing_gmv,
    SUM(i.gmv_ex_vat) AS total_gmv,
    -- v_gp: mirrors existing_gmv's 0.0 literal — the lookback CTE exists only to
    -- supply max_baseline (a total_gmv figure), so it has no existing/new split
    -- to carry. Keeping the column present and zero keeps both UNION ALL arms
    -- the same shape.
    -- v_splitallmonths: 0.0 ตรงนี้ "ถูกต้องถาวร" แล้ว — arm นี้เหลือเฉพาะเดือน
    -- ก่อนไตรมาส (pool ฐาน P3: เม.ย.–มิ.ย.) ซึ่ง app ไม่เคยใช้เป็นเดือนประเมิน
    -- ส่วนเดือนในไตรมาสย้ายไปอยู่ current_split ที่มี split จริงทุกเดือนแล้ว
    0.0 AS existing_margin,
    SUM(COALESCE(i.margin_ex_vat, 0)) AS total_margin,
    SUM(IF(i.margin_ex_vat IS NULL, 0, i.gmv_ex_vat)) AS gmv_with_margin
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= d.lookback_start
    -- v_splitallmonths: เดิมกินถึง current_mo (ทับเดือนในไตรมาส) → ตัดที่ต้นไตรมาส
    AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
    AND i.gmv_ex_vat > 0
  -- v_dupfix: ข้ามตำแหน่ง 4 (category กลายเป็น ANY_VALUE แล้ว) — เหลือ
  -- kam_email, account_id, outlet_id, group_key, month_label เป็นคีย์จริง
  GROUP BY 1,2,3,5,6
)

-- v_catbonus: 8 columns now — `category` appended as the TRAILING column
-- (position 8 full-file / position 7 in the per-KAM split file after
-- kam_email is dropped by splitter.py). Trailing keeps the existing 6
-- per-KAM positions (account_id..total_gmv = p[0]..p[5]) byte-stable so the
-- ingestion parser's per-KAM branch is unaffected; the parser reads the new
-- category at p[6]. See src/02_data_pipeline.js bulk-upsell handler.
--
-- v_gp: 11 columns now — existing_margin / total_margin / gmv_with_margin
-- appended after `category`, same trailing-only rule for the same reason.
-- Per-KAM positions: p[7] existing_margin, p[8] total_margin, p[9] gmv_with_margin.
-- A pre-GP CSV yields '' at those positions, which both parsers coerce to 0 and
-- then report as "no GP data" rather than ฿0 — so old and new files coexist.
-- Read by src/nrr/nrr_data.js nrrFetchUpsellBundle and the bulk-upsell handler
-- in src/02_data_pipeline.js.
SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  ROUND(existing_gmv, 2) AS existing_gmv,
  ROUND(total_gmv,    2) AS total_gmv,
  category,
  ROUND(existing_margin,  2) AS existing_margin,
  ROUND(total_margin,     2) AS total_margin,
  ROUND(gmv_with_margin,  2) AS gmv_with_margin
FROM current_split

UNION ALL

SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  existing_gmv,
  ROUND(total_gmv, 2) AS total_gmv,
  category,
  existing_margin,
  ROUND(total_margin,    2) AS total_margin,
  ROUND(gmv_with_margin, 2) AS gmv_with_margin
FROM lookback

ORDER BY kam_email, account_id, outlet_id, month_label, total_gmv DESC
