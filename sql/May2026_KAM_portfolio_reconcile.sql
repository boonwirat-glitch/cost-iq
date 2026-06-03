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
--   handover_perf  — รับจาก Sales ใน April, วัด retention ใน May (sales_handover_month=2026-04)
--   new_sales      — รับจาก Sales ใน May (sales_handover_month=2026-05, รอวัด June)
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
    o.delivery_date,
    DATE(o.new_user_exp_date) AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
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
    o.delivery_date,
    DATE(o.new_user_exp_date) AS new_user_exp_date,
    DATE(o.first_dollar_date)        AS first_dollar_date
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

-- ── 4b. Last SALE order per outlet (PATH B fallback for handover_perf vs new_sales)
sale_dates_per_outlet AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MAX(CASE WHEN o.delivery_date BETWEEN p.prev_start AND p.prev_end
              AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
             THEN o.delivery_date END) AS last_sale_in_apr,
    MAX(CASE WHEN o.delivery_date BETWEEN p.cur_start AND p.cur_end
              AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
             THEN o.delivery_date END) AS last_sale_in_may
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.cur_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  GROUP BY 1
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
    k_apr.kam_name      AS apr_kam_name,
    COALESCE(m.new_user_exp_date, a.new_user_exp_date)                       AS new_user_exp_date,
    FORMAT_DATE('%Y-%m', COALESCE(m.new_user_exp_date, a.new_user_exp_date)) AS sales_handover_month,
    COALESCE(m.first_dollar_date, a.first_dollar_date)  AS first_dollar_date

  FROM may_ownership m
  FULL OUTER JOIN apr_ownership   a   ON m.outlet_id = a.outlet_id
  LEFT JOIN       sale_dates_per_outlet lso ON COALESCE(m.outlet_id, a.outlet_id) = lso.outlet_id

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
),

-- ── Fallback: last SALE order date per outlet (Q10 PATH B) ───────────────
-- ใช้แยก handover_perf vs new_sales เมื่อ new_user_exp_date IS NULL
-- 243439 = outlet ที่ไม่มี new_user_exp_date แต่ handover Apr (last SALE ใน Apr)
-- ── current_kam_snapshot: user_master ณ ขณะรัน SQL ───────────────────────
-- แยก transfer_out (owner เปลี่ยนแล้ว) vs core_nrr_churn (เงียบแต่ยังอยู่พอร์ต)
-- ⚠ Known limitation: outlet โอนใน June จะถูก flag เป็น transfer_out ใน May backfill
--   แต่ commission ไม่กระทบ เพราะ may_gmv=0 ไม่เข้า NRR numerator อยู่แล้ว
current_kam_snapshot AS (
  SELECT
    CAST(um.res_id AS STRING) AS outlet_id,
    k.kam_email               AS current_kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
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
  -- นิยาม:
  --   expansion   = first_dollar_date ใน May 2026 + commercial_owner=KAM
  --   comeback    = first_dollar_date ก่อน May + apr_gmv=0 + may_gmv>0
  --   transfer_in = apr_staff_owner มีค่า (มี KAM เดิม) → May เป็น KAM นี้
  CASE

    -- [1] Transfer Out A: ไม่มี order May + user_master เปลี่ยน KAM
    WHEN oo.apr_kam_email IS NOT NULL
      AND oo.may_kam_email IS NULL
      AND COALESCE(mg.may_gmv, 0) = 0
      AND (cks.current_kam_email IS NULL OR cks.current_kam_email != oo.apr_kam_email)
      THEN 'transfer_out'

    -- [1b] Transfer Out B: มี order May แต่ KAM เปลี่ยน
    WHEN oo.apr_kam_email IS NOT NULL
      AND oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email != oo.may_kam_email
      THEN 'transfer_out'

    -- [2] Expansion: first_dollar_date อยู่ใน May 2026 + commercial_owner=KAM
    --     ร้านเปิดสาขาใหม่ ซื้อ Freshket ครั้งแรกเดือน May ภายใต้ KAM
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.may_commercial_owner = 'KAM'
      AND oo.first_dollar_date BETWEEN '2026-05-01' AND '2026-05-31'
      AND COALESCE(mg.may_gmv, 0) > 0
      THEN 'expansion'

    -- [3] Handover perf: Sales→KAM ใน April, วัด retention ใน May
    --     sales_handover_month='2026-04' | 243439 = ตัวอย่าง
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NULL
      AND oo.apr_commercial_owner = 'SALE'
      AND oo.sales_handover_month = '2026-04'
      THEN 'handover_perf'

    -- [4] New Sales: Sales→KAM ใน May, รอวัด June | 243819 = ตัวอย่าง
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NULL
      AND oo.apr_commercial_owner = 'SALE'
      AND (oo.sales_handover_month IS NULL OR oo.sales_handover_month != '2026-04')
      THEN 'new_sales'

    -- [5] Transfer In: Apr เป็น KAM อื่น (apr_staff_owner มีค่า) → May เป็น KAM นี้
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email != oo.may_kam_email
      THEN 'transfer_in'

    -- [6] Transfer In (no prev KAM in list): apr_staff_owner มีค่า (KAM อาจลาออกแล้ว)
    --     หรือ apr_commercial_owner=KAM แม้ staff_owner จะว่าง (เช่น Fang กรณี 170447)
    --     ทั้งสองกรณี = เคยมี KAM ดูแล แค่ระบบไม่รู้ว่าใคร → transfer_in ไม่ใช่ comeback
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NULL
      AND (oo.apr_commercial_owner IS NULL OR oo.apr_commercial_owner != 'SALE')
      AND (
        -- มี staff_owner จริง (KAM ลาออกแต่ยังมีชื่อใน order)
        (oo.apr_staff_owner IS NOT NULL AND TRIM(oo.apr_staff_owner) != '')
        OR
        -- apr_commercial_owner=KAM แม้ staff_owner ว่าง → มี KAM ดูแลแต่ไม่รู้ชื่อ
        oo.apr_commercial_owner = 'KAM'
      )
      THEN 'transfer_in'

    -- [7] Comeback: ร้านเคยซื้อ (first_dollar_date ก่อน May) + ไม่มี Apr GMV
    --     ต้องไม่มี KAM ดูแลใน Apr เลย (apr_commercial_owner != KAM)
    --     ถ้า Apr มี commercial_owner=KAM แม้ staff_owner ว่าง → CASE [6] transfer_in แทน
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.first_dollar_date IS NOT NULL
      AND oo.first_dollar_date < '2026-05-01'
      AND COALESCE(ag.apr_gmv, 0) = 0
      AND COALESCE(mg.may_gmv, 0) > 0
      AND (oo.apr_commercial_owner IS NULL OR oo.apr_commercial_owner != 'KAM')
      THEN 'comeback'

    -- [8] Core NRR cohort: same KAM Apr=May + มี GMV ทั้งคู่
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_kam_email IS NOT NULL
      AND oo.apr_kam_email = oo.may_kam_email
      AND COALESCE(ag.apr_gmv, 0) > 0
      AND COALESCE(mg.may_gmv, 0) > 0
      THEN 'core_nrr'

    -- [9] Core churn: same KAM Apr=May + มี Apr GMV + ไม่มี May GMV
    WHEN oo.apr_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) > 0
      AND COALESCE(mg.may_gmv, 0) = 0
      AND (
        (oo.may_kam_email IS NOT NULL AND oo.apr_kam_email = oo.may_kam_email)
        OR (oo.may_kam_email IS NULL AND cks.current_kam_email = oo.apr_kam_email)
      )
      THEN 'core_nrr_churn'

    -- [10] Residual: May อยู่กับ KAM นี้แต่ไม่มี apr_staff_owner
    --      เช่น outlet ที่ไม่เคยมี order มาก่อนเลย แต่ถูก assign ให้ KAM
    --      นับเป็น transfer_in เพราะ KAM เพิ่งรับมา ไม่นับ NRR
    ELSE 'transfer_in'
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

  -- Handover retention%: เฉพาะ handover_perf (sales_handover_month=2026-04 = โอนใน Apr, วัด May)
  --   243439=handover_perf | 243819=new_sales (exp=May, ยังไม่วัด)
  CASE
    WHEN oo.apr_commercial_owner = 'SALE'
      AND oo.may_kam_email IS NOT NULL
      AND COALESCE(ag.apr_gmv, 0) > 0
    THEN ROUND(
      (COALESCE(mg.may_gmv,0) / 31.0) / (ag.apr_gmv / 30.0) * 100
    , 2)
  END AS handover_retention_pct,

  -- Expansion commission (1.5% flat)
  -- Expansion commission (1.5%)
  CASE
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.may_commercial_owner = 'KAM'
      AND oo.first_dollar_date BETWEEN '2026-05-01' AND '2026-05-31'
      AND COALESCE(mg.may_gmv, 0) > 0
    THEN ROUND(mg.may_gmv * 0.015, 0)
  END AS expansion_commission,

  -- Handover commission (default tiers: <100%→0, 100-119%→฿2,500, ≥120%→฿5,000)
  CASE
    WHEN oo.may_kam_email IS NOT NULL
      AND oo.apr_commercial_owner = 'SALE'
      AND oo.sales_handover_month = '2026-04'
      AND COALESCE(ag.apr_gmv, 0) > 0
    THEN CASE
      WHEN ROUND((COALESCE(mg.may_gmv,0)/31.0)/(ag.apr_gmv/30.0)*100, 2) >= 120 THEN 5000
      WHEN ROUND((COALESCE(mg.may_gmv,0)/31.0)/(ag.apr_gmv/30.0)*100, 2) >= 100 THEN 2500
      ELSE 0
    END
  END AS handover_commission,

  -- Audit trail
  oo.sales_handover_month,
  CAST(oo.new_user_exp_date AS STRING) AS new_user_exp_date,
  -- first_order_month: ดูง่ายด้วยตา — expansion=May2026, comeback=ก่อน May
  FORMAT_DATE('%Y-%m', oo.first_dollar_date) AS first_order_month

FROM outlet_ownership      oo
LEFT JOIN apr_gmv          ag  ON oo.outlet_id = ag.outlet_id
LEFT JOIN may_gmv          mg  ON oo.outlet_id = mg.outlet_id
LEFT JOIN current_kam_snapshot cks ON oo.outlet_id = cks.outlet_id

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
