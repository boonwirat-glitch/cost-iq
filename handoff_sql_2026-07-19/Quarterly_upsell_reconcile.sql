-- ══════════════════════════════════════════════════════════════════════════
-- Quarterly KAM Upsell Commission (P1/P3)
-- sql/Quarterly_upsell_reconcile.sql
--
-- Quarterly successor to sql/upsell_May2026_v1.sql (a one-off May-2026
-- backfill, left untouched — see docs/INDEX.md). Matches the fixed
-- quarterly-base-month design already live in Sense/`/nrr`'s commission
-- engine: the "never purchased before" (P1) and max-baseline (P3) lookback
-- windows are FROZEN to the 3 months ending at the base month (base,
-- base−1, base−2) for the whole quarter — they do not roll forward as the
-- quarter progresses. Current-side GMV is CUMULATIVE across however many
-- quarter months have elapsed so far, same as the portfolio reconcile file.
--
-- Scope: core_nrr outlets only (base owner AND latest owner each match SOME
--   roster member — not necessarily the SAME person, per the v880-fix
--   whole-outlet-handoff model — + base_gmv>0 + cumulative curr_gmv>0) —
--   ownership ดึงจาก dwh.order ตรงๆ เหมือน sql/Quarterly_KAM_portfolio_reconcile.sql,
--   ไม่ใช้ user_master เป็น primary source. This independently re-derives that
--   file's `core_nrr` condition (same as the original file did) rather than
--   joining to its real output — matches existing repo convention.
--
-- P1 = existing outlet × group_key ที่ไม่เคยซื้อในหน้าต่าง 3 เดือนก่อน (frozen:
--      base, base-1, base-2 — ไม่ขยับตามไตรมาส)
--      เงื่อนไข: cumulative curr_gmv (สะสมทั้งไตรมาส) ≥ ฿2,500
--      commission: cumulative curr_gmv × 3%
--
-- P3 = existing outlet × group_key ที่เคยซื้อในหน้าต่าง 3 เดือนก่อน (เดียวกับ P1)
--      เงื่อนไข: cumulative curr_gmv > max_baseline × 200% AND ส่วนเกิน ≥ ฿5,000
--      commission: (cumulative curr_gmv - max_baseline) × 3%
--
-- Commission-rate constants (3% for both P1 and P3, ฿2,500/฿5,000 thresholds,
-- 200% growth gate) are carried forward UNCHANGED from the original file —
-- not "corrected" against the app's Supabase config, per explicit decision:
-- the Google Sheet's own "Parameters" tab is what actually governs real
-- payout, not these columns.
--
-- COLUMN SCHEMA: the 22 output columns are byte-identical in name/order to
-- the original May2026 file (Google Sheet compatibility). Only `may_gmv`'s
-- *meaning* changes: cumulative quarter-to-date GMV for that outlet×group
-- (was: single next-month GMV). 3 new columns are APPENDED after column 22
-- (q_m1_gmv/q_m2_gmv/q_m3_gmv, raw per-quarter-month GMV for that outlet×
-- group, NULL if that month hasn't started yet).
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- Quarter anchors — identical DECLARE/SET block to
-- sql/Quarterly_KAM_portfolio_reconcile.sql (kept in sync deliberately, same
-- as how the original 2 files shared the same date-anchor shape). See that
-- file's header comment for the full rationale.
-- ══════════════════════════════════════════════════════════════════════════
DECLARE v_override_base_month STRING DEFAULT NULL;

DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_m1_start DATE;
DECLARE v_m1_end   DATE;
DECLARE v_m1_days  INT64;
DECLARE v_m2_start DATE;
DECLARE v_m2_end   DATE;
DECLARE v_m2_days  INT64;
DECLARE v_m3_start DATE;
DECLARE v_m3_end   DATE;
DECLARE v_m3_days  INT64;
DECLARE v_latest_start DATE;
DECLARE v_latest_end   DATE;
DECLARE v_lookback_start DATE;

SET v_m1_start = IF(v_override_base_month IS NOT NULL,
  DATE_ADD(PARSE_DATE('%Y-%m', v_override_base_month), INTERVAL 1 MONTH),
  DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), QUARTER));

SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);

SET v_m2_start = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end   = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end   = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end   = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);

SET v_m1_days = IF(v_override_base_month IS NOT NULL,
  DATE_DIFF(v_m1_end, v_m1_start, DAY) + 1,
  LEAST(DATE_DIFF(v_m1_end, v_m1_start, DAY) + 1,
        GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m1_start, DAY) + 1, 0)));
SET v_m2_days = IF(v_override_base_month IS NOT NULL, 0,
  LEAST(DATE_DIFF(v_m2_end, v_m2_start, DAY) + 1,
        GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m2_start, DAY) + 1, 0)));
SET v_m3_days = IF(v_override_base_month IS NOT NULL, 0,
  LEAST(DATE_DIFF(v_m3_end, v_m3_start, DAY) + 1,
        GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m3_start, DAY) + 1, 0)));

SET v_latest_start = CASE WHEN v_m3_days > 0 THEN v_m3_start WHEN v_m2_days > 0 THEN v_m2_start ELSE v_m1_start END;
SET v_latest_end   = CASE WHEN v_m3_days > 0 THEN v_m3_end   WHEN v_m2_days > 0 THEN v_m2_end   ELSE v_m1_end   END;

-- Frozen 3-month lookback window for P1/P3 baseline: base, base-1, base-2 —
-- matches the original file's window exactly (it was Feb/Mar/Apr when
-- base=Apr, i.e. base-2/base-1/base), just anchored to `base` explicitly
-- instead of implicitly via "cur - 3 months" (which happened to be the same
-- thing only because the original file was pure MoM).
SET v_lookback_start = DATE_TRUNC(DATE_SUB(v_base_start, INTERVAL 2 MONTH), MONTH);

WITH

-- ── 1. Date anchors ────────────────────────────────────────────────────────
params AS (
  SELECT
    v_base_start AS base_start, v_base_end AS base_end,
    v_m1_start AS m1_start, v_m1_end AS m1_end, v_m1_days AS m1_days,
    v_m2_start AS m2_start, v_m2_end AS m2_end, v_m2_days AS m2_days,
    v_m3_start AS m3_start, v_m3_end AS m3_end, v_m3_days AS m3_days,
    v_latest_start AS latest_start, v_latest_end AS latest_end,
    v_lookback_start AS lookback_start
),

-- ── 2. Roster — 14 KAM + 4 PM/AD (added 2026-07-19). Same expected_owner
--       mechanism and rationale as Quarterly_KAM_portfolio_reconcile.sql's
--       kam_list — kept in sync deliberately. Ice (AD) is the only one of
--       the 4 who currently earns real Upsell P1/P3 commission; the 3 PMs
--       have none, but are included for portfolio-visibility parity. ───────
kam_list AS (
  SELECT kam_name, kam_email, tl_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta'                 AS kam_name, 'panitan.p@freshket.co'      AS kam_email, CAST(NULL AS STRING)      AS tl_email, 'PM'  AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao'               AS kam_name, 'sarawoot.k@freshket.co'     AS kam_email, CAST(NULL AS STRING)      AS tl_email, 'PM'  AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae'             AS kam_name, 'nichamon.k@freshket.co'     AS kam_email, CAST(NULL AS STRING)      AS tl_email, 'PM'  AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM'  AS expected_owner)
  ])
),

-- ── 3. Ownership ณ "latest" elapsed quarter month — จาก dwh.order ─────────
latest_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.latest_start AND p.latest_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 4. Ownership ณ base month — จาก dwh.order ──────────────────────────────
base_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 5. GMV base month per outlet ───────────────────────────────────────────
base_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)          AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 5b. GMV per quarter month per outlet (whole-outlet total, used only for
--        the core_nrr_outlets scope test — NOT the group-level GMV used for
--        P1/P3, which is computed separately below at outlet×group_key
--        grain) ───────────────────────────────────────────────────────────
m1_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m1_days > 0 AND o.delivery_date BETWEEN p.m1_start AND p.m1_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
m2_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m2_days > 0 AND o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
m3_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m3_days > 0 AND o.delivery_date BETWEEN p.m3_start AND p.m3_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
curr_gmv AS (
  SELECT outlet_id, SUM(gmv) AS gmv
  FROM (
    SELECT outlet_id, gmv FROM m1_gmv
    UNION ALL SELECT outlet_id, gmv FROM m2_gmv
    UNION ALL SELECT outlet_id, gmv FROM m3_gmv
  )
  GROUP BY 1
),

-- ── 6. Core NRR outlet list ────────────────────────────────────────────────
-- v880-fix: was requiring base owner = latest owner (same specific person).
-- Confirmed against the real app (kam_rep_view.csv + q3_2026_movement_rep_view.sql)
-- that a mid-quarter roster-to-roster handoff (KAM->KAM, KAM->PM, PM->KAM) is
-- NOT split into transfer legs — the whole outlet just follows whoever holds
-- it now. Loosened to: base owner matches SOME roster member AND latest
-- owner matches SOME roster member (any two, not necessarily the same
-- person) + base_gmv>0 + cumulative curr_gmv>0. Kept in sync with
-- Quarterly_KAM_portfolio_reconcile.sql's Core NRR rule.
core_nrr_outlets AS (
  SELECT
    m.outlet_id,
    k_latest.kam_email,
    k_latest.tl_email
  FROM latest_ownership m
  JOIN base_ownership   a   ON m.outlet_id = a.outlet_id
  JOIN base_gmv         bg  ON m.outlet_id = bg.outlet_id  -- base_gmv > 0
  JOIN curr_gmv         cg  ON m.outlet_id = cg.outlet_id  -- cumulative curr_gmv > 0
  JOIN kam_list       k_latest
    ON m.commercial_owner = k_latest.expected_owner
   AND TRIM(m.staff_owner) = TRIM(k_latest.kam_name)
  -- base owner ต้อง match roster member คนใดก็ได้ (ไม่ต้องเป็นคนเดียวกับ latest)
  JOIN kam_list       k_base
    ON a.commercial_owner = k_base.expected_owner
   AND TRIM(a.staff_owner) = TRIM(k_base.kam_name)
  -- ⚠ ตัด handover_perf outlets ออก:
  --   outlet ที่มี new_user_exp_date ในช่วง base month หรือใหม่กว่า = โอนมาจาก SALE
  --   ระหว่างรอบ reconcile นี้เอง แม้ base order ล่าสุดจะเป็น KAM แล้ว ก็ไม่ควรนับใน P1/P3
  WHERE (
    a.new_user_exp_date IS NULL
    OR DATE(a.new_user_exp_date) < v_base_start  -- โอนก่อน base month = core_nrr จริง
  )
),

-- ── 7. GMV per outlet × group_key per quarter month — เฉพาะ core_nrr outlets,
--       each conditional on that month having started ──────────────────────
m1_group_gmv AS (
  SELECT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END                        AS group_key,
    SUM(i.gmv_ex_vat)          AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE p.m1_days > 0 AND o.delivery_date BETWEEN p.m1_start AND p.m1_end
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3
),
m2_group_gmv AS (
  SELECT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END                        AS group_key,
    SUM(i.gmv_ex_vat)          AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE p.m2_days > 0 AND o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3
),
m3_group_gmv AS (
  SELECT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END                        AS group_key,
    SUM(i.gmv_ex_vat)          AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE p.m3_days > 0 AND o.delivery_date BETWEEN p.m3_start AND p.m3_end
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3
),

-- ── 8. Cumulative quarter-to-date GMV per outlet × group_key — เฉพาะ
--       core_nrr outlets (feeds the `may_gmv` output column + P1/P3 tests) ─
current_gmv_by_group AS (
  SELECT kam_email, outlet_id, group_key, SUM(gmv) AS may_gmv
  FROM (
    SELECT kam_email, outlet_id, group_key, gmv FROM m1_group_gmv
    UNION ALL SELECT kam_email, outlet_id, group_key, gmv FROM m2_group_gmv
    UNION ALL SELECT kam_email, outlet_id, group_key, gmv FROM m3_group_gmv
  )
  GROUP BY 1, 2, 3
),

-- ── 8b. group_key → category_high_level lookup (v_catbonus, 2026-07-19) ─────
-- category is 1:1 with group_key, so a single deduped lookup joined at the
-- final SELECT gives the Google Sheet a category dimension to apply
-- per-category bonus rates via its Parameters tab — without threading
-- category through every group-gmv CTE. QUALIFY picks one category per
-- group_key defensively (should already be 1:1; guards against a stray
-- subclass_name string reused across categories duplicating output rows).
group_category AS (
  SELECT group_key, category FROM (
    SELECT
      CASE
        WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
             AND TRIM(COALESCE(i.item_family,'')) != ''
        THEN i.item_family ELSE i.subclass_name
      END AS group_key,
      i.category_high_level AS category,
      SUM(i.gmv_ex_vat) AS _gmv
    FROM `freshket-rn.dwh.order` o
    CROSS JOIN UNNEST(o.item) AS i
    CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.m1_start AND p.m3_end
      AND i.gmv_ex_vat > 0
    GROUP BY 1, 2
    QUALIFY ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY _gmv DESC) = 1
  )
),

-- ── 9. Baseline: group_key ที่เคยซื้อในหน้าต่าง 3 เดือนก่อน (FROZEN: base,
--       base-1, base-2 — ไม่ขยับตามไตรมาส แม้รันเดือนหลังๆ ของไตรมาส) ───────
baseline_groups AS (
  SELECT DISTINCT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END AS group_key
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE o.delivery_date >= p.lookback_start
    AND o.delivery_date <  p.m1_start
    AND i.gmv_ex_vat > 0
),

-- ── 10. Max baseline GMV (normalize 30 วัน) per outlet × group_key ────────
-- แยกเป็น 2 CTE เพื่อหลีกเลี่ยง forward reference ใน BigQuery
lookback_monthly AS (
  SELECT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END                                  AS group_key,
    DATE_TRUNC(o.delivery_date, MONTH)   AS month_start,
    SUM(i.gmv_ex_vat)                    AS monthly_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE o.delivery_date >= p.lookback_start
    AND o.delivery_date <  p.m1_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3, 4
),
max_baseline AS (
  SELECT
    kam_email, outlet_id, group_key,
    MAX(
      monthly_gmv / DATE_DIFF(DATE_ADD(month_start, INTERVAL 1 MONTH), month_start, DAY) * 30
    ) AS max_bl
  FROM lookback_monthly
  GROUP BY 1, 2, 3
),

-- ── 11. Classify P1 / P3 ──────────────────────────────────────────────────
commission_items AS (
  SELECT
    c.kam_email,
    c.outlet_id,
    c.group_key,
    c.may_gmv,
    COALESCE(mb.max_bl, 0) AS max_bl,
    -- P1: group_key ไม่เคยซื้อในหน้าต่าง 3 เดือนก่อน (frozen) + cumulative may_gmv ≥ 2,500
    CASE
      WHEN bg.group_key IS NULL AND c.may_gmv >= 2500 THEN 1
      ELSE 0
    END AS is_p1,
    -- P3: group_key เคยซื้อ + cumulative may_gmv > max_bl × 200% + ส่วนเกิน ≥ 5,000
    CASE
      WHEN bg.group_key IS NOT NULL
        AND c.may_gmv > COALESCE(mb.max_bl, 0) * 2.00
        AND c.may_gmv - COALESCE(mb.max_bl, 0) >= 5000
      THEN 1
      ELSE 0
    END AS is_p3
  FROM current_gmv_by_group c
  LEFT JOIN baseline_groups bg
    ON c.kam_email = bg.kam_email
   AND c.outlet_id = bg.outlet_id
   AND c.group_key = bg.group_key
  LEFT JOIN max_baseline mb
    ON c.kam_email = mb.kam_email
   AND c.outlet_id = mb.outlet_id
   AND c.group_key = mb.group_key
  WHERE c.may_gmv > 0
)

-- ── Final: outlet × group_key level (raw สำหรับ Google Sheet) ───────────
SELECT
  kl.tl_email,
  kl.kam_name,
  ci.kam_email,
  ci.outlet_id,
  ci.group_key,

  -- GMV
  ROUND(ci.may_gmv, 0)  AS may_gmv,
  ROUND(ci.max_bl, 0)   AS max_baseline_30d,

  -- ── P1 เงื่อนไขแต่ละข้อ ──────────────────────────────────────────────────
  ci.is_p1,
  CASE WHEN ci.max_bl = 0 THEN 'ใช่' ELSE 'ไม่' END           AS p1_new_group,      -- ไม่เคยซื้อในหน้าต่าง 3 เดือนก่อน?
  ROUND(ci.may_gmv, 0)                                          AS p1_check_gmv,      -- GMV สะสมที่ต้องการ >= 2,500
  CASE WHEN ci.may_gmv >= 2500 THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS p1_gmv_threshold,  -- ผ่าน 2,500 ไหม?

  -- ── P3 เงื่อนไขแต่ละข้อ ──────────────────────────────────────────────────
  ci.is_p3,
  CASE WHEN ci.max_bl > 0 THEN 'ใช่' ELSE 'ไม่' END            AS p3_existing_group,  -- เคยซื้อในหน้าต่าง 3 เดือนก่อน?
  ROUND(ci.max_bl, 0)                                            AS p3_baseline,        -- baseline (max 30d)
  ROUND(ci.max_bl * 2.0, 0)                                     AS p3_threshold_200pct, -- เกณฑ์ 200% = baseline × 2
  ROUND(ci.may_gmv / NULLIF(ci.max_bl, 0) * 100, 1)            AS p3_growth_pct,       -- โตจริง (%) สะสมทั้งไตรมาส
  CASE WHEN ci.may_gmv > ci.max_bl * 2.0
       THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END                          AS p3_200pct_check,    -- ผ่าน 200% ไหม?
  ROUND(ci.may_gmv - ci.max_bl, 0)                              AS p3_incremental,      -- ส่วนเกินจริง (฿) สะสม
  CASE WHEN (ci.may_gmv - ci.max_bl) >= 5000
       THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END                          AS p3_5000_check,      -- ส่วนเกิน >= 5,000 ไหม?

  -- ── Commission per row (rate constants unchanged — see header note) ─────
  ROUND(CASE WHEN ci.is_p1 = 1 THEN ci.may_gmv * 0.03 ELSE 0 END, 0)              AS p1_comm,
  ROUND(CASE WHEN ci.is_p3 = 1 THEN (ci.may_gmv - ci.max_bl) * 0.03 ELSE 0 END, 0) AS p3_comm,

  -- ── สรุปผล ───────────────────────────────────────────────────────────────
  CASE
    WHEN ci.is_p1 = 1 THEN 'P1 ✓'
    WHEN ci.is_p3 = 1 THEN 'P3 ✓'
    WHEN ci.max_bl = 0 AND ci.may_gmv < 2500
      THEN CONCAT('P1 ✗ GMV=', CAST(ROUND(ci.may_gmv,0) AS STRING), ' (ต้องการ ≥2,500)')
    WHEN ci.max_bl > 0 AND ci.may_gmv <= ci.max_bl * 2.0
      THEN CONCAT('P3 ✗ โต=', CAST(ROUND(ci.may_gmv/ci.max_bl*100,1) AS STRING), '% (ต้องการ >200%)')
    WHEN ci.max_bl > 0 AND ci.may_gmv > ci.max_bl * 2.0 AND (ci.may_gmv - ci.max_bl) < 5000
      THEN CONCAT('P3 ✗ ส่วนเกิน=', CAST(ROUND(ci.may_gmv-ci.max_bl,0) AS STRING), ' (ต้องการ ≥5,000)')
    ELSE 'ไม่ผ่านเงื่อนไขใด'
  END AS result,

  -- ── Appended (position 23+) — per-quarter-month breakdown, raw GMV,
  --    NULL for any month that hasn't started yet. Existing columns 1-22
  --    above are completely untouched by this addition. Joined (not
  --    correlated-subquery'd) — BigQuery rejects correlated subqueries that
  --    reference other tables ("Query error: Correlated subqueries that
  --    reference other tables are not supported..."), so this must be a
  --    real JOIN. ─────────────────────────────────────────────────────────
  ROUND(g1.gmv, 0) AS q_m1_gmv,
  CASE WHEN v_m2_days > 0 THEN ROUND(g2.gmv, 0) END AS q_m2_gmv,
  CASE WHEN v_m3_days > 0 THEN ROUND(g3.gmv, 0) END AS q_m3_gmv,

  -- ── v_catbonus (position 26): category_high_level of this group_key, so
  --    the Google Sheet can apply per-category bonus rates via Parameters.
  --    Appended strictly after existing columns — Sheet formulas keyed to
  --    columns 1-25 are unaffected. ──────────────────────────────────────
  gc.category AS category
FROM commission_items ci
JOIN kam_list kl ON ci.kam_email = kl.kam_email
LEFT JOIN m1_group_gmv g1 ON ci.outlet_id = g1.outlet_id AND ci.group_key = g1.group_key
LEFT JOIN m2_group_gmv g2 ON ci.outlet_id = g2.outlet_id AND ci.group_key = g2.group_key
LEFT JOIN m3_group_gmv g3 ON ci.outlet_id = g3.outlet_id AND ci.group_key = g3.group_key
LEFT JOIN group_category gc ON ci.group_key = gc.group_key
ORDER BY kl.tl_email, kl.kam_name, ci.outlet_id, ci.group_key
