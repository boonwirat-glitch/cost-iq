-- ══════════════════════════════════════════════════════════════════════════
-- May 2026 KAM Portfolio Movement & NRR Reconcile  (v2 — order-based ownership)
-- ══════════════════════════════════════════════════════════════════════════
--
-- v2 fix: ownership derived from dwh.order.staff_owner ณ เดือนที่วัด
--   ไม่ใช้ user_master เป็น primary source (เก็บแค่ snapshot ล่าสุด)
--   เช่น outlet ที่โอนจาก May→Dent ใน June จะ attribute ให้ May ใน May backfill ถูกต้อง
--
-- Ownership resolution (per outlet, per month):
--   1. staff_owner จาก order ที่ delivery_date อยู่ใน target month (order ล่าสุด)
--   2. ถ้าไม่มี order ใน May → staff_owner จาก April orders (outlet silent แต่ยังอยู่พอร์ต)
--   3. Fallback user_master เฉพาะ outlet ที่ไม่มี order ทั้ง Apr และ May เลย
--
-- Grain: 1 row ต่อ outlet_id (user_id)
--
-- movement_type:
--   core_nrr       — อยู่พอร์ต KAM นี้, มี GMV Apr (cohort), มี GMV May
--   core_nrr_churn — อยู่พอร์ต KAM นี้, มี GMV Apr (cohort), ไม่มี GMV May
--   comeback       — ไม่มี Apr GMV แต่เคยซื้อก่อน May + ยังอยู่พอร์ต KAM นี้
--   expansion      — ไม่เคยปรากฏใน history เลย (ร้านใหม่แท้) + อยู่พอร์ต KAM นี้
--   new_sales      — รับโอนจาก Sales ใน May (prev commercial_owner=SALE)
--   transfer_in    — รับโอนจาก KAM/PM อื่น ใน May
--   transfer_out   — ออกจากพอร์ต KAM นี้ใน May (แสดงใน KAM เดิม)
-- ══════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchor ────────────────────────────────────────────────────────
params AS (
  SELECT
    DATE('2026-05-01') AS cur_start,
    DATE('2026-05-31') AS cur_end,
    31                  AS cur_days,
    DATE('2026-04-01') AS prev_start,
    DATE('2026-04-30') AS prev_end,
    30                  AS prev_days,
    DATE('2024-11-01') AS history_start   -- 18 เดือนก่อน May สำหรับ everSeen
),

-- ── 2. KAM roster ─────────────────────────────────────────────────────────
kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),

-- ── 3. Outlet ownership ณ May — จาก dwh.order (source of truth) ──────────
-- ใช้ order ล่าสุดใน May เพื่อระบุว่า outlet นั้นอยู่ใน KAM ใด
-- commercial_owner = 'KAM' + staff_owner match kam_list
may_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    o.delivery_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4. Outlet ownership ณ April — จาก dwh.order ──────────────────────────
apr_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)        AS outlet_id,
    CAST(o.account_id AS STRING)     AS account_id,
    o.account_name,
    o.account_type,
    UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
    TRIM(o.staff_owner)              AS staff_owner,
    o.delivery_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id
    ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 5. Determine each outlet's KAM in May (primary) and April (for movement) ──
-- Priority: May order owner → Apr order owner (outlet อาจ silent ใน May)
-- "belongs_to_kam_in_may" = outlet ที่นับอยู่ใน portfolio ของ KAM ใน May
outlet_ownership AS (
  SELECT
    COALESCE(m.outlet_id, a.outlet_id)   AS outlet_id,
    COALESCE(m.account_id, a.account_id) AS account_id,
    COALESCE(m.account_name, a.account_name) AS account_name,
    COALESCE(m.account_type, a.account_type) AS account_type,

    -- May ownership (from order)
    m.commercial_owner  AS may_commercial_owner,
    m.staff_owner       AS may_staff_owner,

    -- April ownership (from order)
    a.commercial_owner  AS apr_commercial_owner,
    a.staff_owner       AS apr_staff_owner,

    -- KAM ที่ "เป็นเจ้าของ" outlet นี้ใน May
    -- ใช้ May order ก่อน fallback Apr
    k_may.kam_email     AS may_kam_email,
    k_may.tl_email      AS may_tl_email,
    k_may.kam_name      AS may_kam_name,

    -- KAM ที่เป็นเจ้าของใน April
    k_apr.kam_email     AS apr_kam_email,
    k_apr.kam_name      AS apr_kam_name

  FROM may_ownership m
  FULL OUTER JOIN apr_ownership a ON m.outlet_id = a.outlet_id

  -- Match May owner to kam_list
  LEFT JOIN kam_list k_may
    ON m.commercial_owner = 'KAM'
   AND TRIM(m.staff_owner) = TRIM(k_may.kam_name)

  -- Match Apr owner to kam_list
  LEFT JOIN kam_list k_apr
    ON a.commercial_owner = 'KAM'
   AND TRIM(a.staff_owner) = TRIM(k_apr.kam_name)
),

-- ── 6. GMV April per outlet ────────────────────────────────────────────────
apr_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)          AS apr_gmv,
    COUNT(DISTINCT o.order_id) AS apr_orders
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 7. GMV May per outlet ──────────────────────────────────────────────────
may_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)          AS may_gmv,
    COUNT(DISTINCT o.order_id) AS may_orders
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 8. everSeen — เคยมี order ก่อน May (แยก comeback vs expansion) ────────
ever_seen AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS outlet_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date >= p.history_start
    AND o.delivery_date <  p.cur_start
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
)

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 1: Outlet-level detail
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  -- KAM identity (May owner เป็นหลัก)
  COALESCE(oo.may_kam_name, oo.apr_kam_name)   AS kam_name,
  COALESCE(oo.may_kam_email, oo.apr_kam_email) AS kam_email,
  COALESCE(oo.may_tl_email,
    (SELECT tl_email FROM kam_list WHERE kam_email = oo.apr_kam_email LIMIT 1)
  )                                             AS tl_email,

  -- Outlet info
  oo.account_id,
  oo.account_name,
  oo.account_type,
  oo.outlet_id,

  -- Ownership snapshot
  oo.apr_staff_owner,   -- owner ใน Apr (จาก order จริง)
  oo.may_staff_owner,   -- owner ใน May (จาก order จริง)

  -- GMV
  ROUND(COALESCE(ag.apr_gmv, 0), 0) AS apr_gmv,
  ROUND(COALESCE(mg.may_gmv, 0), 0) AS may_gmv,
  COALESCE(ag.apr_orders, 0)        AS apr_orders,
  COALESCE(mg.may_orders, 0)        AS may_orders,

  -- ── Movement classification ───────────────────────────────────────────
  -- Priority order สำคัญมาก: movement types ต้องมาก่อน core_nrr เสมอ
  -- เพราะ transfer_in อาจมี apr_gmv > 0 (outlet เคยมียอดแต่ไม่มี KAM owner)
  -- ถ้า core_nrr มาก่อน outlet เช่น 205038 จะถูกนับผิดเป็น NRR cohort
  CASE
    -- [1] Transfer Out: Apr เป็น KAM นี้ แต่ May เปลี่ยน KAM
    WHEN oo.apr_kam_email IS NOT NULL
      AND (oo.may_kam_email IS NULL OR oo.apr_kam_email != oo.may_kam_email)
      THEN 'transfer_out'

    -- [2] New Sales: Apr เป็น SALE (หรือไม่มี KAM owner) → May เป็น KAM นี้
    -- ครอบคลุม outlet ที่ Apr ไม่มี owner (limbo) แล้วโอนมาให้ KAM ใน May
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NULL
      AND oo.apr_commercial_owner = 'SALE'
      THEN 'new_sales'

    -- [3] Transfer In: Apr เป็น KAM อื่น → May เป็น KAM นี้
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email != oo.may_kam_email
      THEN 'transfer_in'

    -- [4] Limbo Transfer In: Apr ไม่มี KAM owner เลย (ไม่ใช่ SALE) → May เป็น KAM นี้
    -- เช่น outlet ที่อยู่ระหว่างรอโอน, self-order, no owner
    -- ไม่นับใน NRR cohort เพราะ KAM เพิ่งรับมา ทำอะไรใน Apr ไม่ได้
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NULL
      AND (oo.apr_commercial_owner IS NULL OR oo.apr_commercial_owner != 'SALE')
      AND oo.may_commercial_owner = 'KAM'
      THEN 'transfer_in'  -- นับรวมกับ transfer_in ไม่นับ NRR base

    -- [5] Expansion: ไม่เคยปรากฏใน history 18 เดือนเลย → ร้านใหม่แท้
    WHEN oo.may_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) = 0
      AND es.outlet_id IS NULL
      AND COALESCE(mg.may_gmv, 0) > 0
      THEN 'expansion'

    -- [6] Comeback: ไม่มี Apr GMV แต่เคยซื้อใน history → กลับมา
    WHEN oo.may_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) = 0
      AND es.outlet_id IS NOT NULL
      AND COALESCE(mg.may_gmv, 0) > 0
      THEN 'comeback'

    -- [7] Core NRR cohort: อยู่กับ KAM คนเดียวกันทั้ง Apr AND May + มี GMV ทั้งคู่
    -- เงื่อนไขสำคัญ: apr_kam_email = may_kam_email (same KAM ทั้งสองเดือน)
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email = oo.may_kam_email
      AND COALESCE(ag.apr_gmv, 0) > 0
      AND COALESCE(mg.may_gmv, 0) > 0
      THEN 'core_nrr'

    -- [8] Core churn: อยู่กับ KAM คนเดียวกันทั้ง Apr AND May + มี Apr GMV + ไม่มี May GMV
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email = oo.may_kam_email
      AND COALESCE(ag.apr_gmv, 0) > 0
      AND COALESCE(mg.may_gmv, 0) = 0
      THEN 'core_nrr_churn'

    ELSE 'other'
  END AS movement_type,

  -- ── Commission components ─────────────────────────────────────────────
  -- NRR base: เฉพาะ core_nrr เท่านั้น (same KAM Apr+May, มี Apr GMV)
  -- transfer_in ไม่นับ ตรงกับ app logic (coreResult only, ไม่รวม transferInResult)
  CASE
    WHEN oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email = oo.may_kam_email
      AND COALESCE(ag.apr_gmv,0) > 0
    THEN COALESCE(ag.apr_gmv,0)
  END AS nrr_base_apr_gmv,
  CASE
    WHEN oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email = oo.may_kam_email
      AND COALESCE(ag.apr_gmv,0) > 0
    THEN COALESCE(mg.may_gmv,0)
  END AS nrr_curr_may_gmv,

  -- Handover retention: เฉพาะ new_sales (Apr baseline vs May perf, daily-rate)
  CASE
    WHEN oo.apr_commercial_owner = 'SALE'
      AND oo.may_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) > 0
    THEN ROUND(
      (COALESCE(mg.may_gmv,0) / 31.0) / (ag.apr_gmv / 30.0) * 100
    , 2)
  END AS handover_retention_pct,

  -- Expansion commission (1.5% flat)
  CASE
    WHEN oo.may_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) = 0
      AND es.outlet_id IS NULL
      AND COALESCE(mg.may_gmv, 0) > 0
    THEN ROUND(mg.may_gmv * 0.015, 0)
  END AS expansion_commission

FROM outlet_ownership oo
LEFT JOIN apr_gmv   ag ON oo.outlet_id = ag.outlet_id
LEFT JOIN may_gmv   mg ON oo.outlet_id = mg.outlet_id
LEFT JOIN ever_seen es ON oo.outlet_id = es.outlet_id

-- เก็บเฉพาะ outlet ที่มี KAM owner ใน May หรือ April (กรอง noise)
WHERE oo.may_kam_email IS NOT NULL OR oo.apr_kam_email IS NOT NULL

ORDER BY
  COALESCE(oo.may_tl_email,
    (SELECT tl_email FROM kam_list WHERE kam_email = oo.apr_kam_email LIMIT 1)
  ),
  COALESCE(oo.may_kam_email, oo.apr_kam_email),
  movement_type,
  COALESCE(mg.may_gmv, 0) DESC NULLS LAST

-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 2: KAM Summary — uncomment `;` บรรทัดก่อน แล้ว uncomment block นี้
-- ══════════════════════════════════════════════════════════════════════════
-- ; SELECT
--   kam_email, tl_email, '2026-05' AS period_month,
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
--     SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END) / 31.0,
--     SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END) / 30.0
--   ) * 100, 2)                                                     AS raw_nrr_pct,
--   CASE WHEN ROUND(SAFE_DIVIDE(
--     SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END)/31.0,
--     SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END)/30.0
--   )*100,2) >= 102 THEN 7500
--   WHEN ROUND(SAFE_DIVIDE(
--     SUM(CASE WHEN movement_type='core_nrr' THEN may_gmv ELSE 0 END)/31.0,
--     SUM(CASE WHEN movement_type='core_nrr' THEN apr_gmv ELSE 0 END)/30.0
--   )*100,2) >= 99 THEN 5000
--   ELSE 0 END                                                      AS nrr_payout,
--   ROUND(SUM(COALESCE(expansion_commission,0)))                    AS expansion_commission_total
-- FROM (-- paste Section 1 query here --)
-- GROUP BY 1,2,3
-- ORDER BY tl_email, raw_nrr_pct DESC;
;
