-- ════════════════════════════════════════════════════════════════════════════
-- COMPANY_GMV v1 — Company Overview by Segment (/nrr dashboard)
-- Output:  company_gmv.csv  (upload to R2 root, same bucket as portview.csv)
-- Refresh: manual BigQuery run + manual R2 upload (suggested: daily with the
--          other /nrr files, or at minimum weekly)
-- Columns (8): month_key, month_label, owner_group, kam_email, tl_email,
--              bucket, gmv, orders
-- Window:  2026-01-01 → yesterday (day-1 lag, Asia/Bangkok). Calendar-year
--          framing matches the "Target & Plan 2H 2026" sheet — do NOT switch to
--          a rolling window or Jan will drop out mid-plan-year and the sheet
--          reconcile breaks.
-- Locked rules: gmv_ex_vat only, gmv_ex_vat > 0, no order-status filter.
--
-- owner_group (disjoint by construction — rows sum to company total):
--   1. account_type IN ('Exclude','TEST')      → dropped entirely
--   2. account_type IN ('Consumer','Enduser')  → 'b2c'   (regardless of owner)
--   3. else commercial_owner KAM/PM/ADMIN/SALE → 'kam'/'pm'/'admin'/'sale'
--   4. else                                    → 'other' (reconcile bucket)
--
-- bucket: account_type Chain → 'chain'; SA|MC → 'sa_mc'; else 'other'.
--   b2c rows carry bucket '' (not meaningful there).
--   NOTE: kam rows carry bucket too (the account's own type) but the /nrr app
--   classifies KAM GMV into squads by tl_email → squad_params (Supabase), NOT
--   by bucket — bucket on kam rows only powers a future cross-portfolio view.
--
-- Sales scope: ALL commercial_owner='SALE' rows — deliberately NOT limited to
--   the 15-rep email list used by sales_history.sql etc., because this export
--   must reconcile to DWH total GMV like the sheet's Reconcile row.
--
-- KAM attribution: current-ownership snapshot (order.user_id →
--   dim.user_master.res_id → staff_owner_email → kam_directory below).
--   Order-time attribution rejected: dwh.order only carries staff_owner NAME.
--   Unmatched KAM GMV lands on kam_email='unassigned' — never dropped.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_window_start DATE DEFAULT DATE('2026-01-01');
DECLARE v_data_end     DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);

WITH

-- ── KAM roster + TL mapping ──────────────────────────────────────────────────
-- Copied from quarterly_nrr_2026_Q2_v8.sql kam_list (active 15 only — resigned
-- entries there have NULL email and can't match staff_owner_email anyway).
-- KEEP IN SYNC with that file when the roster changes.
kam_directory AS (
  SELECT kam_email, tl_email FROM UNNEST([
    -- Squad A (Name / nitipat.s@freshket.co)
    STRUCT('anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    -- Squad B (Ploy / pavarisa.mu@freshket.co)
    STRUCT('guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('treerak.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── Current ownership snapshot: outlet → staff email ─────────────────────────
-- GROUP BY res_id (not just DISTINCT): guarantees 1 row per outlet so the join
-- in `classified` can never fan out and inflate GMV, even if user_master ever
-- carries duplicate res_id rows with different emails.
ownership AS (
  SELECT
    CAST(res_id AS STRING)                    AS res_id,
    MAX(LOWER(TRIM(staff_owner_email)))       AS staff_owner_email
  FROM `freshket-rn.dim.user_master`
  WHERE res_id IS NOT NULL
    AND staff_owner_email IS NOT NULL
  GROUP BY res_id
),

-- ── Base orders: window + filters + segment classification ──────────────────
base_orders AS (
  SELECT
    FORMAT_DATE('%Y-%m', o.delivery_date) AS month_key,
    CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
      WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
      WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
      WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
    END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING)
                                          AS month_label,
    -- Disjoint owner_group (precedence: b2c before commercial_owner)
    CASE
      WHEN IFNULL(o.account_type, '') IN ('Consumer', 'Enduser') THEN 'b2c'
      WHEN UPPER(TRIM(IFNULL(o.commercial_owner, ''))) = 'KAM'   THEN 'kam'
      WHEN UPPER(TRIM(IFNULL(o.commercial_owner, ''))) = 'PM'    THEN 'pm'
      WHEN UPPER(TRIM(IFNULL(o.commercial_owner, ''))) = 'ADMIN' THEN 'admin'
      WHEN UPPER(TRIM(IFNULL(o.commercial_owner, ''))) = 'SALE'  THEN 'sale'
      ELSE 'other'
    END                                   AS owner_group,
    CASE
      WHEN IFNULL(o.account_type, '') IN ('Consumer', 'Enduser') THEN ''
      WHEN IFNULL(o.account_type, '') = 'Chain'                  THEN 'chain'
      WHEN IFNULL(o.account_type, '') IN ('SA', 'MC')            THEN 'sa_mc'
      ELSE 'other'
    END                                   AS bucket,
    CAST(o.user_id AS STRING)             AS outlet_res_id,
    o.gmv_ex_vat                          AS gmv_ex_vat,
    o.order_id                            AS order_id
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= v_window_start
    AND o.delivery_date <= v_data_end
    AND o.gmv_ex_vat > 0
    -- IFNULL: plain NOT IN would silently drop NULL account_type rows
    AND IFNULL(o.account_type, 'Unknown') NOT IN ('Exclude', 'TEST')
),

-- ── Attach KAM emails (kam rows only) ────────────────────────────────────────
classified AS (
  SELECT
    b.month_key,
    b.month_label,
    b.owner_group,
    CASE WHEN b.owner_group = 'kam'
         THEN IFNULL(kd.kam_email, 'unassigned') ELSE '' END AS kam_email,
    CASE WHEN b.owner_group = 'kam'
         THEN IFNULL(kd.tl_email, '')            ELSE '' END AS tl_email,
    b.bucket,
    b.gmv_ex_vat,
    b.order_id
  FROM base_orders b
  LEFT JOIN ownership     ow ON b.outlet_res_id = ow.res_id
  LEFT JOIN kam_directory kd ON ow.staff_owner_email = LOWER(TRIM(kd.kam_email))
)

SELECT
  month_key,
  month_label,
  owner_group,
  kam_email,
  tl_email,
  bucket,
  ROUND(SUM(gmv_ex_vat), 0)      AS gmv,
  COUNT(DISTINCT order_id)       AS orders
FROM classified
GROUP BY month_key, month_label, owner_group, kam_email, tl_email, bucket
ORDER BY month_key, owner_group, bucket, kam_email;
