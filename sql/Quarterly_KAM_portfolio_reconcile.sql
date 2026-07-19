-- ══════════════════════════════════════════════════════════════════════════
-- Quarterly KAM Portfolio Movement & NRR Reconcile
-- sql/Quarterly_KAM_portfolio_reconcile.sql
--
-- Quarterly successor to sql/May2026_KAM_portfolio_reconcile.sql (a one-off
-- May-2026 Month-over-Month backfill, left untouched — see docs/INDEX.md).
-- Matches the fixed quarterly-base-month design already live in Sense/
-- /nrr's commission engine (commission_mode='quarterly'): NRR/Expansion
-- compare a FROZEN base month (the calendar month right before the quarter
-- starts) against the CUMULATIVE total of however many months of the
-- quarter have elapsed so far — not a rolling prior-month comparison.
-- Handover retention stays a strict base-month-vs-next-month (M+1) pair,
-- same as before, per production's explicit "Handover never changes" design
-- (docs/Q3_NRR_COMMISSION_SPEC.md: "วัดผลระยะสั้น ไม่เหมาะกับ fixed-base").
--
-- Ownership resolution (per outlet): same 3-step priority as the original
-- file, just re-anchored to base/latest-elapsed-quarter-month instead of
-- April/May:
--   1. staff_owner จาก order ที่ delivery_date อยู่ใน target month (order ล่าสุด)
--   2. ถ้าไม่มี order ใน current period → staff_owner จาก base-month orders
--      (outlet silent แต่ยังอยู่พอร์ต)
--   3. Fallback user_master เฉพาะ outlet ที่ไม่มี order ทั้ง 2 ฝั่งเลย
--
-- Grain: 1 row ต่อ outlet_id (user_id) — same as original, UNION ALL of 4 legs.
--
-- COLUMN SCHEMA: the 22 output columns are byte-identical in name/order to
-- the original May2026 file (Google Sheet compatibility — see docs/INDEX.md
-- and the plan file this was built from). Only their *meaning* changes:
--   apr_gmv  → frozen base-month GMV (raw, unnormalized — same as before)
--   may_gmv  → CUMULATIVE quarter-to-date GMV, raw, summed across every
--              elapsed quarter month (was: single next-month GMV)
--   (same for apr_orders/may_orders, nrr_base_apr_gmv/nrr_curr_may_gmv)
-- 3 new columns are APPENDED after column 22 (q_m1_gmv/q_m2_gmv/q_m3_gmv,
-- raw per-quarter-month GMV, NULL if that month hasn't started yet) so the
-- whole quarter is visible in one row without touching any existing column.
--
-- Commission-rate constants (expansion 1.5%, handover tiers ≥120%→฿5,000/
-- ≥100%→฿2,500) are carried forward UNCHANGED from the original file — not
-- "corrected" against the app's Supabase config, per explicit decision: the
-- Google Sheet's own "Parameters" tab is what actually governs real payout,
-- not these columns. See the plan context for the reasoning.
--
-- movement_type (same 8 types, same priority order as original):
--   core_nrr       — same KAM base→now, has base GMV (cohort), has curr GMV
--   core_nrr_churn — same KAM base→now, has base GMV (cohort), no curr GMV
--   comeback       — no base GMV แต่เคยซื้อก่อนไตรมาสนี้ + ยังอยู่พอร์ต KAM นี้
--   expansion      — ไม่เคยปรากฏใน history เลย (ร้านใหม่แท้) + first dollar
--                    อยู่ในช่วงไตรมาสนี้ + อยู่พอร์ต KAM นี้
--   handover_perf  — รับจาก Sales ใน "base month" วัด retention ที่เดือนถัดไป (m1)
--   new_sales      — รับจาก Sales ในเดือนใดก็ตามของไตรมาสนี้ (m1/m2/m3) รอวัดเดือนหน้า
--   transfer_in    — รับโอนจาก KAM/PM อื่น
--   transfer_out   — ออกจากพอร์ต KAM นี้ (แสดงใน KAM เดิม)
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- Quarter anchors AUTO-DERIVE from CURRENT_DATE — no manual edit needed each
-- quarter. Corrected two-variable split (matches the v8 fix in
-- sql/q3c_upsell_team_summary_v4.sql, NOT the buggy pattern still present in
-- sql/q3_2026_movement_{rep,pm,admin,vp}_view.sql): quarter IDENTITY is a
-- pure DATE_TRUNC with no lag, so day 1 of a new quarter correctly resolves
-- to that new quarter — a separate lag-adjusted value is used only to
-- decide "which month has data yet."
--
-- v_override_base_month: set to a 'YYYY-MM' string to bypass auto-derivation
-- and pin the base month manually (retroactive rerun, or reproducing a past
-- comparison for verification — e.g. '2026-04' reproduces the exact base/
-- current pairing the original May2026 file used, with only m1 = elapsed).
-- Leave NULL for normal auto-derived production use.
-- ══════════════════════════════════════════════════════════════════════════
DECLARE v_override_base_month STRING DEFAULT NULL;

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
DECLARE v_latest_start DATE;
DECLARE v_latest_end   DATE;
DECLARE v_base_str STRING;
DECLARE v_m1_str   STRING;
DECLARE v_m2_str   STRING;
DECLARE v_m3_str   STRING;
DECLARE v_history_start DATE;

-- Quarter identity: pure truncation, NO lag — day 1 of a new quarter must
-- resolve to that new quarter, never the prior one.
SET v_m1_start = IF(v_override_base_month IS NOT NULL,
  DATE_ADD(PARSE_DATE('%Y-%m', v_override_base_month), INTERVAL 1 MONTH),
  DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), QUARTER));

SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_base_days  = DATE_DIFF(v_base_end, v_base_start, DAY) + 1;

SET v_m2_start = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end   = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end   = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end   = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);

-- "Which month has data yet" — lag-adjusted, separate from quarter identity
-- above. When v_override_base_month is set, treat only m1 as elapsed (this
-- reproduces the original file's single-current-month behavior exactly,
-- for Verification Track A).
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

-- "Latest" elapsed quarter month — the single most-current snapshot used for
-- ownership/classification (who owns the outlet right now), as opposed to
-- the cumulative GMV total (how much they sold across the whole
-- quarter-to-date). Falls back to m1 (always >0 once the quarter itself has
-- started, matching the same clamp already proven in
-- sql/q3_2026_movement_rep_view.sql).
SET v_latest_start = CASE WHEN v_m3_days > 0 THEN v_m3_start WHEN v_m2_days > 0 THEN v_m2_start ELSE v_m1_start END;
SET v_latest_end   = CASE WHEN v_m3_days > 0 THEN v_m3_end   WHEN v_m2_days > 0 THEN v_m2_end   ELSE v_m1_end   END;

SET v_base_str = FORMAT_DATE('%Y-%m', v_base_start);
SET v_m1_str   = FORMAT_DATE('%Y-%m', v_m1_start);
SET v_m2_str   = FORMAT_DATE('%Y-%m', v_m2_start);
SET v_m3_str   = FORMAT_DATE('%Y-%m', v_m3_start);

SET v_history_start = DATE_SUB(v_base_start, INTERVAL 18 MONTH);

WITH

-- ── 1. Date anchors (surfaced as a CROSS JOIN-able CTE, same convention as
--       sql/q3_2026_movement_rep_view.sql) ──────────────────────────────────
params AS (
  SELECT
    v_base_start AS base_start, v_base_end AS base_end, v_base_days AS base_days,
    v_m1_start AS m1_start, v_m1_end AS m1_end, v_m1_days AS m1_days,
    v_m2_start AS m2_start, v_m2_end AS m2_end, v_m2_days AS m2_days,
    v_m3_start AS m3_start, v_m3_end AS m3_end, v_m3_days AS m3_days,
    v_latest_start AS latest_start, v_latest_end AS latest_end,
    v_history_start AS history_start
),

-- ── 2. Roster — 14 KAM + 4 PM/AD (added 2026-07-19). `expected_owner` is the
--       robust mechanism (NOT a blanket `IN ('KAM','PM')`) that lets the 4 new
--       people's PM-tagged outlets match without leaking existing KAMs'
--       incidental PM-tagged orders into their own numbers — same pattern
--       already proven in tools/add_pm_portfolio_phase1.js for the 11
--       view-layer files. For the 14 KAM rows expected_owner='KAM', literally
--       identical to the old bare `= 'KAM'` check, so their output is
--       byte-for-byte unchanged. The 3 PMs have no TL; Ornpreya (Ice, an AD
--       mislabeled "PM" in the underlying data tag) keeps her real TL so
--       Ploy's team view includes her. ─────────────────────────────────────
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

-- ── 3. Outlet ownership ณ "latest" elapsed quarter month — จาก dwh.order ──
-- ใช้ order ล่าสุดใน current period เพื่อระบุว่า outlet นั้นอยู่ใน KAM ใด "ตอนนี้"
latest_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    o.delivery_date,
    DATE(o.new_user_exp_date) AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.latest_start AND p.latest_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4. Outlet ownership ณ base month — จาก dwh.order ──────────────────────
base_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    o.delivery_date,
    DATE(o.new_user_exp_date) AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4b. Last SALE order per outlet (PATH B fallback for handover_perf vs new_sales)
sale_dates_per_outlet AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MAX(CASE WHEN o.delivery_date BETWEEN p.base_start AND p.base_end
              AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
             THEN o.delivery_date END) AS last_sale_in_base,
    MAX(CASE WHEN o.delivery_date BETWEEN p.latest_start AND p.latest_end
              AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
             THEN o.delivery_date END) AS last_sale_in_latest
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.latest_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  GROUP BY 1
),

-- ── 5. Determine each outlet's KAM "now" (latest) and at base (for movement) ──
-- Priority: latest order owner → base order owner (outlet อาจ silent ใน current period)
outlet_ownership AS (
  SELECT
    COALESCE(m.outlet_id, a.outlet_id)   AS outlet_id,
    COALESCE(m.account_id, a.account_id) AS account_id,
    COALESCE(m.account_name, a.account_name) AS account_name,
    COALESCE(m.account_type, a.account_type) AS account_type,

    -- Latest ownership (from order)
    m.commercial_owner  AS latest_commercial_owner,
    m.staff_owner       AS latest_staff_owner,

    -- Base ownership (from order)
    a.commercial_owner  AS base_commercial_owner,
    a.staff_owner       AS base_staff_owner,

    -- KAM ที่ "เป็นเจ้าของ" outlet นี้ ณ ตอนนี้ (latest)
    k_latest.kam_email     AS latest_kam_email,
    k_latest.tl_email      AS latest_tl_email,
    k_latest.kam_name      AS latest_kam_name,

    -- KAM ที่เป็นเจ้าของที่ base
    k_base.kam_email     AS base_kam_email,
    k_base.kam_name      AS base_kam_name,
    COALESCE(m.new_user_exp_date, a.new_user_exp_date)                       AS new_user_exp_date,
    FORMAT_DATE('%Y-%m', COALESCE(m.new_user_exp_date, a.new_user_exp_date)) AS sales_handover_month,
    COALESCE(m.first_dollar_date, a.first_dollar_date)  AS first_dollar_date

  FROM latest_ownership m
  FULL OUTER JOIN base_ownership   a   ON m.outlet_id = a.outlet_id
  LEFT JOIN       sale_dates_per_outlet lso ON COALESCE(m.outlet_id, a.outlet_id) = lso.outlet_id

  -- Match latest owner to kam_list (expected_owner-bound — see roster note above)
  LEFT JOIN kam_list k_latest
    ON m.commercial_owner = k_latest.expected_owner
   AND TRIM(m.staff_owner) = TRIM(k_latest.kam_name)

  -- Match base owner to kam_list (expected_owner-bound — see roster note above)
  LEFT JOIN kam_list k_base
    ON a.commercial_owner = k_base.expected_owner
   AND TRIM(a.staff_owner) = TRIM(k_base.kam_name)
),

-- ── 6. GMV base month per outlet ───────────────────────────────────────────
base_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)          AS gmv,
    COUNT(DISTINCT o.order_id) AS orders
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 7. GMV per quarter month per outlet — each conditional on that month
--       having actually started (v_mN_days > 0), so an unelapsed month
--       simply returns no rows rather than a bogus zero-window scan ────────
m1_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv, COUNT(DISTINCT o.order_id) AS orders
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m1_days > 0 AND o.delivery_date BETWEEN p.m1_start AND p.m1_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
m2_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv, COUNT(DISTINCT o.order_id) AS orders
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m2_days > 0 AND o.delivery_date BETWEEN p.m2_start AND p.m2_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),
m3_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, SUM(o.gmv_ex_vat) AS gmv, COUNT(DISTINCT o.order_id) AS orders
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE p.m3_days > 0 AND o.delivery_date BETWEEN p.m3_start AND p.m3_end
    AND o.gmv_ex_vat > 0 AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 8. Cumulative quarter-to-date GMV per outlet — raw sum across every
--       elapsed quarter month (feeds the `may_gmv`/`nrr_curr_may_gmv`
--       output columns; day-normalization, if the Sheet wants it, happens
--       downstream against q_m1_gmv/q_m2_gmv/q_m3_gmv, same as how the
--       Sheet already normalizes apr_gmv/may_gmv itself today) ────────────
curr_gmv AS (
  SELECT
    outlet_id,
    SUM(gmv)    AS gmv,
    SUM(orders) AS orders
  FROM (
    SELECT outlet_id, gmv, orders FROM m1_gmv
    UNION ALL SELECT outlet_id, gmv, orders FROM m2_gmv
    UNION ALL SELECT outlet_id, gmv, orders FROM m3_gmv
  )
  GROUP BY 1
),

-- ── 9. Fallback: last SALE order date per outlet (Q10 PATH B) ───────────
-- ใช้แยก handover_perf vs new_sales เมื่อ new_user_exp_date IS NULL
-- ── current_kam_snapshot: user_master ณ ขณะรัน SQL ───────────────────────
-- แยก transfer_out (owner เปลี่ยนแล้ว) vs core_nrr_churn (เงียบแต่ยังอยู่พอร์ต)
-- ⚠ Known limitation (carried from original): outlet ที่โอนหลังจาก latest
--   elapsed month จะถูก flag เป็น transfer_out ก่อนที่ curr_gmv จะสะท้อนจริง —
--   แต่ commission ไม่กระทบ เพราะ curr_gmv=0 ไม่เข้า NRR numerator อยู่แล้ว
current_kam_snapshot AS (
  SELECT
    CAST(um.res_id AS STRING) AS outlet_id,
    k.kam_email               AS current_kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
                  AND um.commercial_owner = k.expected_owner
  WHERE um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── 10. everSeen — เคยมี order ก่อนไตรมาสนี้ (แยก comeback vs expansion) ───
-- NOTE: carried forward from the original file for parity, but — same as in
-- the original — this CTE is not actually referenced by the active query
-- below (first_dollar_date, read directly off dwh.order, already carries
-- each outlet's true all-time-first-purchase date, so this lookback isn't
-- needed for the comeback/expansion classification). Left in place, dates
-- updated, in case a future change starts relying on it.
ever_seen AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date >= p.history_start
    AND o.delivery_date <  p.m1_start
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
)

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 1: Outlet-level detail (UNION ALL of 4 legs)
--
-- v880-fix (2026-07-19): rewritten to match the app's real, verified
-- transfer model (production `q3_2026_movement_rep_view.sql` +
-- `07c_qnrr_view.js`, confirmed against real `kam_rep_view.csv` data) —
-- was previously a dual-leg design that split ANY base≠latest owner change
-- into a transfer_out leg (old owner) + transfer_in leg (new owner). The
-- real app does something different: it attributes the WHOLE outlet — base
-- GMV and current GMV both — to whoever holds it NOW, tagged plain
-- core_nrr, as long as base and latest owner are BOTH some roster member
-- (KAM or PM/AD) — regardless of whether it's the SAME person. The old
-- owner's row for that outlet simply stops existing (clean, symmetric, no
-- partial-base pollution on either side). transfer_in/transfer_out as real
-- classifications are now reserved for genuine portfolio-TYPE boundary
-- crossings (arrived from / departed to something outside the roster
-- entirely — PM/Admin/Sale not tracked here, or unclassifiable) — confirmed
-- empirically: every real transfer_in row in production is PM→KAM or
-- Admin→KAM, zero are KAM↔KAM.
--
-- LEG A: มุมมอง "latest" owner (คนที่ถือ outlet อยู่ตอนนี้) — core_nrr ครอบคลุม
--   ทั้ง "ไม่เปลี่ยนมือ" และ "เปลี่ยนมือระหว่าง roster ด้วยกันเอง" เหมือนกันหมด
-- LEG B: transfer_out — เฉพาะ outlet ที่ไม่มี roster member ถือเลยตอนนี้ (ออกจาก
--   roster ไปจริงๆ ไม่ใช่แค่เปลี่ยนมือให้คนอื่นใน roster)
-- LEG C: core_nrr_churn (เงียบทั้งไตรมาส) — attribute ให้ใครก็ตามที่ user_master
--   ยืนยันว่าถืออยู่ตอนนี้ (อาจเป็นคนละคนกับ base ก็ได้ ถ้าเงียบแต่ถูกโอนไปแล้ว)
-- LEG D: handover_perf churn — ไม่เปลี่ยน (attribute ตาม current_kam_snapshot
--   อยู่แล้วตั้งแต่เดิม)
-- ══════════════════════════════════════════════════════════════════════════

-- ── LEG A: มุมมอง latest_kam ─────────────────────────────────────────────
SELECT
  oo.latest_kam_name   AS kam_name,
  oo.latest_kam_email  AS kam_email,
  oo.latest_tl_email   AS tl_email,

  oo.account_id,
  oo.account_name,
  oo.account_type,
  oo.outlet_id,

  oo.base_staff_owner   AS apr_staff_owner,
  oo.latest_staff_owner AS may_staff_owner,

  ROUND(COALESCE(bg.gmv, 0), 0) AS apr_gmv,
  ROUND(COALESCE(cg.gmv, 0), 0) AS may_gmv,
  COALESCE(bg.orders, 0)        AS apr_orders,
  COALESCE(cg.orders, 0)        AS may_orders,

  -- Movement classification (ตัด transfer_out ออก — ให้ LEG B จัดการ)
  CASE
    -- [2] Expansion — first purchase อยู่ในช่วงไตรมาสนี้ (m1 ถึง latest elapsed)
    -- IN ('KAM','PM') so a genuinely-new outlet for a roster PM/AD (Ice etc.)
    -- also classifies as expansion, not falling through to the transfer_in
    -- residual — safe: the LEG A WHERE clause below already restricts to
    -- oo.latest_kam_email IS NOT NULL, which only true roster matches get.
    WHEN oo.latest_commercial_owner IN ('KAM', 'PM')
      AND oo.first_dollar_date BETWEEN v_m1_start AND v_latest_end
      AND COALESCE(cg.gmv, 0) > 0
      THEN 'expansion'

    -- [3] Handover perf: โอนมาจาก SALE ใน base month → วัด retention ที่ m1
    WHEN oo.sales_handover_month = v_base_str
      AND oo.latest_kam_email IS NOT NULL
      THEN 'handover_perf'

    -- [4] New Sales: โอนมาจาก SALE ในเดือนใดก็ตามของไตรมาสนี้ → รอวัดเดือนหน้า
    WHEN oo.sales_handover_month IN (v_m1_str, v_m2_str, v_m3_str)
      AND oo.latest_kam_email IS NOT NULL
      THEN 'new_sales'

    -- [5] Comeback — ไม่เคยซื้อ (หรือไม่มี GMV ที่ base) แต่เคยซื้อก่อนไตรมาสนี้
    --     v880-fix: base_kam_email IS NULL (ไม่ match roster ที่ base เลย)
    --     แทนการเช็ค commercial_owner ตรงๆ — สอดคล้องกับโมเดล roster รวม
    --     KAM+PM/AD ที่ใช้ทั้งไฟล์
    WHEN oo.first_dollar_date IS NOT NULL
      AND oo.first_dollar_date < v_m1_start
      AND COALESCE(bg.gmv, 0) = 0
      AND COALESCE(cg.gmv, 0) > 0
      AND oo.base_kam_email IS NULL
      THEN 'comeback'

    -- [6] Core NRR — v880-fix: roster member (KAM หรือ PM/AD) ใดก็ได้ที่ถือ
    --     outlet นี้อยู่ที่ base ถือว่าเป็น core_nrr เสมอ ไม่ว่าตอนนี้จะยังเป็นคน
    --     เดิมหรือโอนไปให้ roster member คนอื่นแล้วก็ตาม — ตรงกับที่แอปจริงทำ
    --     (ยืนยันจาก kam_rep_view.csv จริง: KAM↔KAM/PM ไม่เคยติดป้าย transfer)
    WHEN oo.base_kam_email IS NOT NULL
      AND COALESCE(bg.gmv, 0) > 0
      AND COALESCE(cg.gmv, 0) > 0
      THEN 'core_nrr'

    -- [7] Core churn (roster member ใดก็ได้ที่ base ไม่มียอดสะสมทั้งไตรมาส)
    WHEN oo.base_kam_email IS NOT NULL
      AND COALESCE(bg.gmv, 0) > 0
      AND COALESCE(cg.gmv, 0) = 0
      THEN 'core_nrr_churn'

    -- [8] Transfer In — v880-fix: เฉพาะ outlet ที่มาจากนอก roster จริงๆ (ไม่ match
    --     ใครใน roster เลยที่ base) — ย้ายภายใน roster ด้วยกันเองกลายเป็น core_nrr
    --     ข้างบนแล้ว ไม่ตกมาถึงกฎนี้
    WHEN oo.base_kam_email IS NULL
      AND (oo.base_commercial_owner IS NULL OR oo.base_commercial_owner != 'SALE')
      AND (
        (oo.base_staff_owner IS NOT NULL AND TRIM(oo.base_staff_owner) != '')
        OR oo.base_commercial_owner = 'KAM'
      )
      THEN 'transfer_in'

    -- [9] Residual → transfer_in
    ELSE 'transfer_in'
  END AS movement_type,

  -- Commission components (rate constants unchanged from original — see
  -- header note; Sheet Parameters govern real payout, not these)
  -- v880-fix: dropped the "= latest_kam_email" requirement, matching the
  -- Core NRR classification above — any roster-base outlet with GMV>0
  -- counts toward the NRR ratio regardless of who holds it now.
  CASE
    WHEN oo.base_kam_email IS NOT NULL
      AND COALESCE(bg.gmv,0) > 0
    THEN COALESCE(bg.gmv,0)
  END AS nrr_base_apr_gmv,
  CASE
    WHEN oo.base_kam_email IS NOT NULL
      AND COALESCE(bg.gmv,0) > 0
    THEN COALESCE(cg.gmv,0)
  END AS nrr_curr_may_gmv,

  -- Handover retention: ALWAYS base month vs m1 specifically (fixed M+1
  -- window) — never drifts to "latest" as the quarter progresses, matching
  -- production's explicit "Handover stays MoM forever" design.
  CASE
    WHEN oo.base_commercial_owner = 'SALE'
      AND COALESCE(bg.gmv, 0) > 0
    THEN ROUND((COALESCE(m1g.gmv,0)/NULLIF(v_m1_days,0))/(bg.gmv/v_base_days)*100, 2)
  END AS handover_retention_pct,

  CASE
    WHEN oo.latest_commercial_owner IN ('KAM', 'PM')
      AND oo.first_dollar_date BETWEEN v_m1_start AND v_latest_end
      AND COALESCE(cg.gmv, 0) > 0
    THEN ROUND(cg.gmv * 0.015, 0)
  END AS expansion_commission,

  CASE
    WHEN oo.base_commercial_owner = 'SALE'
      AND oo.sales_handover_month = v_base_str
      AND COALESCE(bg.gmv, 0) > 0
    THEN CASE
      WHEN ROUND((COALESCE(m1g.gmv,0)/NULLIF(v_m1_days,0))/(bg.gmv/v_base_days)*100,2) >= 120 THEN 5000
      WHEN ROUND((COALESCE(m1g.gmv,0)/NULLIF(v_m1_days,0))/(bg.gmv/v_base_days)*100,2) >= 100 THEN 2500
      ELSE 0
    END
  END AS handover_commission,

  oo.sales_handover_month,
  CAST(oo.new_user_exp_date AS STRING) AS new_user_exp_date,
  FORMAT_DATE('%Y-%m', oo.first_dollar_date) AS first_order_month,

  -- ── Appended (position 23+) — per-quarter-month breakdown, raw GMV,
  --    NULL for any month that hasn't started yet. Existing columns 1-22
  --    above are completely untouched by this addition. ───────────────────
  ROUND(m1g.gmv, 0) AS q_m1_gmv,
  CASE WHEN v_m2_days > 0 THEN ROUND(m2g.gmv, 0) END AS q_m2_gmv,
  CASE WHEN v_m3_days > 0 THEN ROUND(m3g.gmv, 0) END AS q_m3_gmv

FROM outlet_ownership      oo
LEFT JOIN base_gmv         bg  ON oo.outlet_id = bg.outlet_id
LEFT JOIN curr_gmv         cg  ON oo.outlet_id = cg.outlet_id
LEFT JOIN m1_gmv           m1g ON oo.outlet_id = m1g.outlet_id
LEFT JOIN m2_gmv           m2g ON oo.outlet_id = m2g.outlet_id
LEFT JOIN m3_gmv           m3g ON oo.outlet_id = m3g.outlet_id
LEFT JOIN current_kam_snapshot cks ON oo.outlet_id = cks.outlet_id

-- LEG A: เฉพาะ outlet ที่มี latest_kam
WHERE oo.latest_kam_email IS NOT NULL

UNION ALL

-- ── LEG B: transfer_out — มุมมอง KAM เดิม (base_kam) ────────────────────
-- v880-fix: เฉพาะ outlet ที่ออกจาก roster ไปจริงๆ (ไม่มี roster member คนไหน
-- ถืออยู่เลยตอนนี้ ทั้งจาก order และจาก user_master) — โอนให้ roster member
-- คนอื่นกลายเป็น core_nrr ใน LEG A แล้ว ไม่ตกมาที่นี่
-- แสดง apr_gmv = GMV ที่ KAM เดิมเคยมี (base), may_gmv = 0
SELECT
  oo.base_kam_name   AS kam_name,
  oo.base_kam_email  AS kam_email,
  (SELECT tl_email FROM kam_list WHERE kam_email = oo.base_kam_email LIMIT 1) AS tl_email,

  oo.account_id,
  oo.account_name,
  oo.account_type,
  oo.outlet_id,

  oo.base_staff_owner   AS apr_staff_owner,
  oo.latest_staff_owner AS may_staff_owner,

  ROUND(COALESCE(bg.gmv, 0), 0) AS apr_gmv,
  0                              AS may_gmv,   -- KAM เดิมไม่มียอดสะสมของไตรมาสนี้แล้ว
  COALESCE(bg.orders, 0)        AS apr_orders,
  0                              AS may_orders,

  'transfer_out' AS movement_type,

  -- ไม่มี commission ใดๆ สำหรับ transfer_out
  NULL AS nrr_base_apr_gmv,
  NULL AS nrr_curr_may_gmv,
  NULL AS handover_retention_pct,
  NULL AS expansion_commission,
  NULL AS handover_commission,

  oo.sales_handover_month,
  CAST(oo.new_user_exp_date AS STRING) AS new_user_exp_date,
  FORMAT_DATE('%Y-%m', oo.first_dollar_date) AS first_order_month,

  ROUND(m1g.gmv, 0) AS q_m1_gmv,
  CASE WHEN v_m2_days > 0 THEN ROUND(m2g.gmv, 0) END AS q_m2_gmv,
  CASE WHEN v_m3_days > 0 THEN ROUND(m3g.gmv, 0) END AS q_m3_gmv

FROM outlet_ownership      oo
LEFT JOIN base_gmv         bg  ON oo.outlet_id = bg.outlet_id
LEFT JOIN m1_gmv           m1g ON oo.outlet_id = m1g.outlet_id
LEFT JOIN m2_gmv           m2g ON oo.outlet_id = m2g.outlet_id
LEFT JOIN m3_gmv           m3g ON oo.outlet_id = m3g.outlet_id
LEFT JOIN current_kam_snapshot cks ON oo.outlet_id = cks.outlet_id

-- LEG B: outlet ที่ base_kam มีค่า แต่ไม่มี roster member คนไหนถืออยู่เลยตอนนี้
-- (ไม่มี order ใน latest elapsed month ด้วย AND user_master ก็ไม่ยืนยัน roster
-- member คนไหนด้วย) = ออกจาก roster ไปจริงๆ (ไปเป็น PM ที่ไม่อยู่ใน roster,
-- Admin, Sale, หรือ resigned)
--
-- ⚠ ไม่รวม core_nrr_churn หรือ core_nrr (โอนให้ roster member คนอื่น):
--    ทั้งสองกรณีนี้มี roster member คนใดคนหนึ่งยืนยันความเป็นเจ้าของอยู่ (ไม่ว่าจาก
--    order หรือ user_master) จึงไปอยู่ LEG A/LEG C แทน
WHERE oo.base_kam_email IS NOT NULL
  AND oo.latest_kam_email IS NULL
  AND cks.current_kam_email IS NULL

UNION ALL

-- ── LEG C: core_nrr_churn silent ทั้งไตรมาส ──────────────────────────────
-- outlet ที่ไม่มี order เลยตลอดไตรมาสนี้ แต่ user_master ยืนยันว่ายังมี roster
-- member คนใดคนหนึ่งถืออยู่ (ร้านเงียบ ไม่ได้ออกจาก roster) → core_nrr_churn
-- v880-fix: attribute ให้คนที่ user_master ยืนยัน ณ ตอนนี้ (cks.current_kam_email)
-- ไม่ใช่ oo.base_kam_email ตรงๆ — เผื่อกรณีร้านเงียบแต่ถูกโอน (silent reassignment)
-- ให้ roster member คนอื่นระหว่างไตรมาส ยังถือเป็น churn ของเจ้าของใหม่ ไม่ใช่
-- transfer_out ของเจ้าของเดิม (สอดคล้องกับโมเดลรวมของทั้งไฟล์)
SELECT
  k.kam_name             AS kam_name,
  cks.current_kam_email AS kam_email,
  k.tl_email             AS tl_email,

  oo.account_id,
  oo.account_name,
  oo.account_type,
  oo.outlet_id,

  oo.base_staff_owner   AS apr_staff_owner,
  oo.latest_staff_owner AS may_staff_owner,

  ROUND(COALESCE(bg.gmv, 0), 0) AS apr_gmv,
  0                              AS may_gmv,
  COALESCE(bg.orders, 0)        AS apr_orders,
  0                              AS may_orders,

  'core_nrr_churn' AS movement_type,

  -- NRR base: นับ base gmv เป็น cohort base (ร้านยังอยู่ แต่ไม่ซื้อทั้งไตรมาส)
  COALESCE(bg.gmv, 0) AS nrr_base_apr_gmv,
  0                    AS nrr_curr_may_gmv,  -- curr_gmv=0 ทำให้ NRR ลด

  NULL AS handover_retention_pct,
  NULL AS expansion_commission,
  NULL AS handover_commission,

  oo.sales_handover_month,
  CAST(oo.new_user_exp_date AS STRING) AS new_user_exp_date,
  FORMAT_DATE('%Y-%m', oo.first_dollar_date) AS first_order_month,

  NULL AS q_m1_gmv,
  NULL AS q_m2_gmv,
  NULL AS q_m3_gmv

FROM outlet_ownership      oo
LEFT JOIN base_gmv         bg  ON oo.outlet_id = bg.outlet_id
LEFT JOIN current_kam_snapshot cks ON oo.outlet_id = cks.outlet_id
JOIN kam_list k ON cks.current_kam_email = k.kam_email

WHERE oo.base_kam_email IS NOT NULL
  AND oo.latest_kam_email IS NULL           -- ไม่มี order ใน latest elapsed month
  AND COALESCE(bg.gmv, 0) > 0                -- มียอด base (cohort)
  AND cks.current_kam_email IS NOT NULL      -- v880-fix: roster member คนใดก็ได้ตอนนี้ (ไม่ต้องเป็นคนเดิม)

UNION ALL

-- ── LEG D: handover_perf ที่ churn ตลอดไตรมาส (ไม่มี order เลย) ─────────
-- outlet โอนจาก SALE ใน base month (sales_handover_month=base)
-- แต่ไม่มี order เลยทั้งไตรมาส → churn → retention=0% → commission=฿0
SELECT
  k.kam_name,
  cks.current_kam_email                          AS kam_email,
  k.tl_email,

  oo.account_id,
  oo.account_name,
  oo.account_type,
  oo.outlet_id,

  oo.base_staff_owner                            AS apr_staff_owner,
  NULL                                           AS may_staff_owner,

  ROUND(COALESCE(bg.gmv, 0), 0)                 AS apr_gmv,
  0                                              AS may_gmv,
  COALESCE(bg.orders, 0)                        AS apr_orders,
  0                                              AS may_orders,

  'handover_perf'                                AS movement_type,

  NULL AS nrr_base_apr_gmv,
  NULL AS nrr_curr_may_gmv,

  -- retention = 0% (churn — no order at all this quarter)
  ROUND((0.0 / NULLIF(v_m1_days,0)) / (bg.gmv / v_base_days) * 100, 2) AS handover_retention_pct,

  NULL AS expansion_commission,

  -- commission = ฿0 (retention < 100%)
  0 AS handover_commission,

  oo.sales_handover_month,
  CAST(oo.new_user_exp_date AS STRING) AS new_user_exp_date,
  FORMAT_DATE('%Y-%m', oo.first_dollar_date) AS first_order_month,

  NULL AS q_m1_gmv,
  NULL AS q_m2_gmv,
  NULL AS q_m3_gmv

FROM outlet_ownership      oo
LEFT JOIN base_gmv         bg  ON oo.outlet_id = bg.outlet_id
LEFT JOIN current_kam_snapshot cks ON oo.outlet_id = cks.outlet_id
JOIN kam_list k ON cks.current_kam_email = k.kam_email

WHERE oo.latest_kam_email IS NULL                -- ไม่มี order ใน latest elapsed month
  AND oo.base_kam_email IS NULL                  -- base ไม่ใช่ KAM (เป็น SALE)
  AND oo.base_commercial_owner = 'SALE'          -- base เป็น SALE
  AND oo.sales_handover_month = v_base_str        -- โอนใน base month
  AND cks.current_kam_email IS NOT NULL          -- user_master มี KAM ปัจจุบัน
  AND COALESCE(bg.gmv, 0) > 0                    -- มียอด base (cohort base)

ORDER BY
  tl_email,
  kam_email,
  movement_type,
  may_gmv DESC NULLS LAST

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 2: KAM Summary — uncomment `;` บรรทัดก่อน แล้ว uncomment block นี้
-- ⚠ NOT updated for quarterly logic (dead code, doesn't run today) — if this
--   is ever revived, it needs the same base/curr generalization as Section 1
--   above (currently still hardcodes '2026-05' + 31.0/30.0 day constants).
-- ══════════════════════════════════════════════════════════════════════════
-- ; SELECT
--   kam_email, tl_email, v_m1_str AS period_month,
--   COUNT(*)                                                        AS total_outlets,
--   COUNT(CASE WHEN movement_type='core_nrr'       THEN 1 END)    AS cohort_outlets,
--   COUNT(CASE WHEN movement_type='core_nrr_churn' THEN 1 END)    AS churn_outlets,
--   COUNT(CASE WHEN movement_type='comeback'       THEN 1 END)    AS comeback_outlets,
--   COUNT(CASE WHEN movement_type='expansion'      THEN 1 END)    AS expansion_outlets,
--   COUNT(CASE WHEN movement_type='new_sales'      THEN 1 END)    AS new_sales_outlets,
--   COUNT(CASE WHEN movement_type='transfer_in'    THEN 1 END)    AS transfer_in_outlets,
--   COUNT(CASE WHEN movement_type='transfer_out'   THEN 1 END)    AS transfer_out_outlets,
--   ROUND(SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END)) AS nrr_base_apr,
--   ROUND(SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END)) AS nrr_curr_may,
--   ROUND(SAFE_DIVIDE(
--     SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END) / v_base_days,
--     SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END) / v_base_days
--   ) * 100, 2)                                                     AS raw_nrr_pct,
--   0                                                                AS nrr_payout,  -- TODO: re-derive tiers if revived
--   ROUND(SUM(COALESCE(expansion_commission,0)))                    AS expansion_commission_total
-- FROM (-- paste Section 1 query here --)
-- GROUP BY 1,2,3
-- ORDER BY tl_email, raw_nrr_pct DESC;
;
