-- ══════════════════════════════════════════════════════════════════════════
-- Upsell Gap Diagnostic v1 (2026-07-21) — "ยอดโตแต่ P1/P3 ต่ำ เงินโตไปอยู่ไหน?"
-- sql/upsell_gap_diagnostic_v1.sql
--
-- Context: July MTD (20 days) team P1+P3 GMV = ~1.73M pace ~2.7M/เดือน,
-- vs June's 5.08M — while the KAM-portfolio cohort's own GMV GREW +7M
-- (normalized) vs the June base. This query decomposes, per KAM + total,
-- where existing-outlet growth actually lands relative to the P1/P3 gates:
--
--   p1_captured               = กลุ่มใหม่ ≥ ฿5,000 → ได้คอมฯ P1
--   p3_captured               = กลุ่มเดิม โต >2.00× ของ max เดือน baseline
--                               และ incremental ≥ ฿8,000 → ได้คอมฯ P3
--   p1_new_below_5000         = กลุ่มใหม่แต่ยอดไม่ถึงเกต ฿5,000 (ไม่ได้คอมฯ)
--   growth_below_2x_gate      = ★ กลุ่มเดิมที่ "โตจริง" แต่ไม่เกิน 2× baseline
--                               — โตแบบกระจาย NRR เห็น แต่ P3 ไม่จ่าย (by design)
--   growth_above_2x_but_small = เกิน 2× แล้วแต่ incremental < ฿8,000
--   decline_in_existing_groups= กลุ่มเดิมที่ยังซื้ออยู่แต่ยอดลด (ติดลบ, ไว้ดูบริบท)
--                               หมายเหตุ: กลุ่มที่หยุดซื้อสนิทไม่โผล่ในรายงานนี้
--   existing_gmv_total        = ยอดเดือนนี้ทั้งหมดของ outlet ประเภท existing
--   baseline_total            = ผลรวม max-baseline (normalized 30 วัน) ของกลุ่มที่ active
--
-- ⚠️ การตีความกลางเดือน: existing_gmv คือยอด MTD จริง (20 วัน) แต่ max_bl เป็น
-- ค่า normalized เต็มเดือน — เกต 2× จึงผ่านยากขึ้นเรื่อยๆ จนปลายเดือน ตัวเลข
-- p3_captured จะไต่ขึ้นแบบไม่เชิงเส้นช่วงท้ายเดือน อย่าเทียบ MTD ตรงๆ กับเดือนที่จบแล้ว
--
-- CTE ทั้งหมด (บรรทัดแรกจนถึง commission_items) copy แบบคำต่อคำจาก
-- q3c_upsell_team_summary_v4.sql (เวอร์ชัน v880-fix ในแพ็ก handoff_sql_2026-07-19)
-- เปลี่ยนเฉพาะ SELECT สุดท้าย — ถ้าไฟล์นั้นถูกแก้ ให้ regenerate ไฟล์นี้ด้วย
-- ══════════════════════════════════════════════════════════════════════════
DECLARE v_p3_min_incremental FLOAT64 DEFAULT 8000;

-- Explicit per-month date variables (mirrors q3_2026_movement_rep_view.sql's
-- v_base/v_m1/v_m2/v_m3 pattern) — every "baseline" query below is bound by
-- v_base_start/v_base_end/v_lookback_start ONLY, never by whichever month is
-- currently being reported, so it genuinely cannot drift mid-quarter.
DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_lookback_start DATE;
DECLARE v_m1_start DATE; DECLARE v_m1_end DATE;
DECLARE v_m2_start DATE; DECLARE v_m2_end DATE;
DECLARE v_m3_start DATE; DECLARE v_m3_end DATE;
DECLARE v_current_mo_start DATE;

-- v8 FIX (do not skip): was DATE_TRUNC(lag-1 date, QUARTER) — on the literal
-- first calendar day of a new quarter (e.g. 2026-07-01), lag-1 is still
-- 2026-06-30 (OLD quarter), so DATE_TRUNC(...,QUARTER) resolved to April 1
-- (Q2's start) instead of July 1 — the whole quarter_months/elapsed_months
-- grid silently built for the wrong quarter that one day. Same bug class
-- v854 fixed on the JS side (_commElapsedQuarterLabels comparing real
-- dates, not string labels) — never ported here. Which QUARTER we're in is
-- never a lag/data-availability question (a quarter boundary is a hardcoded
-- calendar fact), so it must NOT use the lag-1 date — only v_current_mo_start
-- below (which decides which MONTH within the quarter is reportable yet)
-- legitimately needs the lag-1 adjustment, and it already has it.
SET v_m1_start   = DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), QUARTER);
SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_lookback_start = DATE_SUB(v_base_start, INTERVAL 2 MONTH);  -- Apr 1 (frozen Apr/May/Jun pool)
SET v_m2_start   = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end     = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start   = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end     = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end     = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);
-- current_mo_start = whichever of m1/m2/m3 is actually being reported (day-1
-- lag, e.g. run Aug-1 → reports Jul → equals v_m1_start).
SET v_current_mo_start = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH);

WITH
-- The 3 months of this quarter, tagged 1/2/3, bounded to only those that
-- have actually elapsed by v_current_mo_start (running in July only
-- evaluates July; running in September evaluates all 3).
quarter_months AS (
  SELECT 1 AS month_no, v_m1_start AS month_start, v_m1_end AS month_end
  UNION ALL SELECT 2, v_m2_start, v_m2_end
  UNION ALL SELECT 3, v_m3_start, v_m3_end
),
elapsed_months AS (
  SELECT * FROM quarter_months WHERE month_start <= v_current_mo_start
),
report_month AS (
  SELECT MAX(month_no) AS n FROM elapsed_months
),

-- Active KAM whitelist (อัปเดตเมื่อมีการเปลี่ยนทีม)
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

-- KAM→account mapping (Q8E logic) — unchanged
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

-- ── NRR core ownership: same KAM in baseline month vs each elapsed month ──
-- v7: per-elapsed-month (was: single "current_mo" ownership check) so a
-- KAM reassignment mid-quarter is still tracked correctly month by month.
apr_outlet_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= v_base_start AND o.delivery_date <= v_base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
month_outlet_ownership AS (
  SELECT
    em.month_no,
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  JOIN elapsed_months em ON o.delivery_date >= em.month_start AND o.delivery_date <= em.month_end
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY em.month_no, o.user_id ORDER BY o.delivery_date DESC) = 1
),
nrr_core_outlets AS (
  SELECT m.month_no, m.outlet_id
  FROM month_outlet_ownership m
  JOIN apr_outlet_ownership a ON m.outlet_id = a.outlet_id
  JOIN kam_list k_m ON m.commercial_owner = 'KAM' AND TRIM(m.staff_owner) = TRIM(k_m.kam_name)
  JOIN kam_list k_a ON a.commercial_owner = 'KAM' AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)
    AND k_a.kam_email = k_m.kam_email
  WHERE (a.new_user_exp_date IS NULL OR a.new_user_exp_date < v_base_start)
),

-- ── Outlet status per elapsed month: existing / expansion / comeback ──
-- v7 fix: expansion window widened from "first_seen in THIS month only" to
-- "first_seen anywhere in the quarter up to and including this month" — an
-- outlet first seen in July is still 'expansion' when August/September are
-- evaluated, not silently 'comeback' (which is excluded from all commission).
-- in_baseline/first_seen are now properties of the FROZEN baseline window
-- only (never depend on which month is being evaluated).
outlet_history AS (
  SELECT
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date) AS first_seen,
    MAX(CASE WHEN o.delivery_date >= v_base_start AND o.delivery_date <= v_base_end THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= v_m1_start AND o.delivery_date <= v_m1_end THEN 1 ELSE 0 END) AS in_m1,
    MAX(CASE WHEN o.delivery_date >= v_m2_start AND o.delivery_date <= v_m2_end THEN 1 ELSE 0 END) AS in_m2,
    MAX(CASE WHEN o.delivery_date >= v_m3_start AND o.delivery_date <= v_m3_end THEN 1 ELSE 0 END) AS in_m3
  FROM `freshket-rn.dwh.order` o
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE_SUB(v_base_start, INTERVAL 5 MONTH)
    AND o.delivery_date <= v_m3_end
  GROUP BY 1, 2
),
outlet_status AS (
  SELECT
    em.month_no, oh.account_id, oh.outlet_id,
    CASE
      WHEN oh.in_baseline = 1 AND nc.outlet_id IS NOT NULL THEN 'existing'
      WHEN oh.first_seen >= v_m1_start AND oh.first_seen <= em.month_end THEN 'expansion'
      ELSE 'comeback'
    END AS outlet_type
  FROM elapsed_months em
  CROSS JOIN outlet_history oh
  LEFT JOIN nrr_core_outlets nc ON oh.outlet_id = nc.outlet_id AND nc.month_no = em.month_no
  WHERE (em.month_no = 1 AND oh.in_m1 = 1)
     OR (em.month_no = 2 AND oh.in_m2 = 1)
     OR (em.month_no = 3 AND oh.in_m3 = 1)
),

-- GMV at outlet × group_key, PER elapsed month, split by outlet type
group_key_def AS (
  SELECT
    em.month_no, ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN elapsed_months em ON o.delivery_date >= em.month_start AND o.delivery_date <= em.month_end
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE i.gmv_ex_vat > 0
),
current_agg AS (
  SELECT
    gk.month_no, gk.kam_email, gk.account_id, gk.outlet_id, gk.group_key,
    os.outlet_type,
    SUM(gk.gmv_ex_vat) AS total_gmv,
    SUM(CASE WHEN os.outlet_type = 'existing'  THEN gk.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(CASE WHEN os.outlet_type = 'expansion' THEN gk.gmv_ex_vat ELSE 0 END) AS expansion_gmv
    -- comeback excluded from all commission (no column needed)
  FROM group_key_def gk
  LEFT JOIN outlet_status os
    ON gk.month_no = os.month_no AND gk.account_id = os.account_id AND gk.outlet_id = os.outlet_id
  GROUP BY 1, 2, 3, 4, 5, 6
),

-- ── FROZEN baseline (Apr/May/Jun only, computed ONCE — not per elapsed
-- month, and never bounded by current_mo). This is the v7 bug fix: these
-- two CTEs used to be bounded `< current_mo` (drifting); now bounded
-- `<= v_base_end` (fixed) so July/August's own purchases can never leak
-- into "have they ever bought this before" or "max baseline" ──
baseline_groups AS (
  SELECT DISTINCT
    ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= v_lookback_start AND o.delivery_date <= v_base_end
    AND i.gmv_ex_vat > 0
),
lookback_monthly AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    DATE_TRUNC(o.delivery_date, MONTH) AS month_start,
    SUM(i.gmv_ex_vat) AS monthly_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= v_lookback_start AND o.delivery_date <= v_base_end
    AND i.gmv_ex_vat > 0
  GROUP BY
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING),
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END,
    DATE_TRUNC(o.delivery_date, MONTH)
),
max_baseline AS (
  SELECT
    kam_email, account_id, outlet_id, group_key,
    MAX(
      monthly_gmv / DATE_DIFF(DATE_ADD(month_start, INTERVAL 1 MONTH), month_start, DAY) * 30
    ) AS max_bl
  FROM lookback_monthly
  GROUP BY 1, 2, 3, 4
),

-- Classify P1 / P3 PER elapsed month — same test as before, but now against
-- the genuinely-frozen baseline, so an item that just MAINTAINS (doesn't
-- need to grow further) its qualifying level keeps re-passing every month.
commission_items AS (
  SELECT
    c.month_no, c.kam_email, c.account_id, c.outlet_id, c.group_key,
    c.outlet_type, c.existing_gmv, c.expansion_gmv, c.total_gmv,
    COALESCE(mb.max_bl, 0) AS max_bl,
    CASE WHEN c.outlet_type = 'existing' AND bg.group_key IS NULL THEN 1 ELSE 0 END AS is_p1,
    CASE
      WHEN c.outlet_type = 'existing'
        AND bg.group_key IS NOT NULL
        AND c.existing_gmv > COALESCE(mb.max_bl, 0) * 2.00
        AND c.existing_gmv - COALESCE(mb.max_bl, 0) >= v_p3_min_incremental
      THEN 1 ELSE 0
    END AS is_p3
  FROM current_agg c
  LEFT JOIN baseline_groups bg
    ON c.kam_email = bg.kam_email AND c.account_id = bg.account_id
   AND c.outlet_id = bg.outlet_id AND c.group_key = bg.group_key
  LEFT JOIN max_baseline mb
    ON c.kam_email = mb.kam_email AND c.account_id = mb.account_id
   AND c.outlet_id = mb.outlet_id AND c.group_key = mb.group_key
),

-- ── DIAGNOSTIC final select (replaces the payout rollup) ──────────────────
diag AS (
  SELECT
    c.kam_email,
    SUM(CASE WHEN c.is_p1 = 1 AND c.total_gmv >= 5000 THEN c.existing_gmv ELSE 0 END) AS p1_captured,
    SUM(CASE WHEN c.is_p3 = 1 THEN c.existing_gmv - c.max_bl ELSE 0 END)              AS p3_captured,
    SUM(CASE WHEN c.is_p1 = 1 AND c.total_gmv < 5000 THEN c.existing_gmv ELSE 0 END)  AS p1_new_below_5000,
    SUM(CASE WHEN c.is_p1 = 0 AND c.is_p3 = 0 AND c.max_bl > 0
              AND c.existing_gmv > c.max_bl AND c.existing_gmv <= c.max_bl * 2.00
             THEN c.existing_gmv - c.max_bl ELSE 0 END)                               AS growth_below_2x_gate,
    SUM(CASE WHEN c.is_p1 = 0 AND c.is_p3 = 0 AND c.max_bl > 0
              AND c.existing_gmv > c.max_bl * 2.00
              AND c.existing_gmv - c.max_bl < v_p3_min_incremental
             THEN c.existing_gmv - c.max_bl ELSE 0 END)                               AS growth_above_2x_but_small,
    SUM(CASE WHEN c.max_bl > 0 AND c.existing_gmv < c.max_bl
             THEN c.existing_gmv - c.max_bl ELSE 0 END)                               AS decline_in_existing_groups,
    SUM(c.existing_gmv)                                                               AS existing_gmv_total,
    SUM(c.max_bl)                                                                     AS baseline_total,
    COUNT(*)                                                                          AS group_rows
  FROM commission_items c
  WHERE c.month_no = (SELECT n FROM report_month)
    AND c.outlet_type = 'existing'
  GROUP BY ROLLUP(c.kam_email)
)

SELECT
  COALESCE(kam_email, '★ GRAND TOTAL') AS kam_email,
  DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m1_start, DAY) + 1 AS days_elapsed,
  ROUND(p1_captured, 0)                AS p1_captured,
  ROUND(p3_captured, 0)                AS p3_captured,
  ROUND(p1_new_below_5000, 0)          AS p1_new_below_5000,
  ROUND(growth_below_2x_gate, 0)       AS growth_below_2x_gate,
  ROUND(growth_above_2x_but_small, 0)  AS growth_above_2x_but_small,
  ROUND(decline_in_existing_groups, 0) AS decline_in_existing_groups,
  ROUND(existing_gmv_total, 0)         AS existing_gmv_total,
  ROUND(baseline_total, 0)             AS baseline_total,
  group_rows
FROM diag
ORDER BY (kam_email IS NULL) DESC, p3_captured + p1_captured DESC;
