-- ══════════════════════════════════════════════════════════════════════════
-- May 2026 KAM Upsell Commission (P1/P3) — v1
-- ══════════════════════════════════════════════════════════════════════════
--
-- Scope: core_nrr outlets เท่านั้น (same KAM Apr=May + apr_gmv>0 + may_gmv>0)
--   ownership ดึงจาก dwh.order ตรงๆ เหมือน May2026_KAM_portfolio_reconcile.sql
--   ไม่ใช้ user_master เป็น primary source
--
-- P1 = existing outlet × group_key ที่ไม่เคยซื้อใน 3 เดือนก่อน (Feb/Mar/Apr)
--      เงื่อนไข: may_gmv ≥ ฿2,500
--      commission: may_gmv × 3%
--
-- P3 = existing outlet × group_key ที่เคยซื้อใน 3 เดือนก่อน
--      เงื่อนไข: may_gmv > max_baseline × 200% ANDส่วนเกิน ≥ ฿5,000
--      commission: (may_gmv - max_baseline) × 3%
--
-- Output: per KAM — p1_gmv, p1_comm, p3_incremental, p3_comm, total_upsell_comm
--         tl_upsell_base = p1_gmv + p3_incremental (ใช้คำนวณ TL multiplier)
-- ══════════════════════════════════════════════════════════════════════════

WITH

-- ── 1. Date anchors ────────────────────────────────────────────────────────
params AS (
  SELECT
    DATE('2026-05-01') AS cur_start,
    DATE('2026-05-31') AS cur_end,
    DATE('2026-04-01') AS prev_start,
    DATE('2026-04-30') AS prev_end,
    DATE('2026-02-01') AS lookback_start   -- 3 เดือนก่อน May: Feb/Mar/Apr
),

-- ── 2. KAM roster ──────────────────────────────────────────────────────────
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

-- ── 3. Ownership ณ May — จาก dwh.order (source of truth) ──────────────────
may_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 4. Ownership ณ April — จาก dwh.order ──────────────────────────────────
apr_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    TRIM(o.staff_owner)             AS staff_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 5. GMV April per outlet ────────────────────────────────────────────────
apr_gmv AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    SUM(o.gmv_ex_vat)          AS apr_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.prev_start AND p.prev_end
    AND o.gmv_ex_vat > 0
    AND o.account_type IN ('SA','MC','Chain','Unknown')
  GROUP BY 1
),

-- ── 6. Core NRR outlet list ────────────────────────────────────────────────
-- same KAM Apr=May + apr_gmv>0 + may_gmv>0
-- นี่คือ universe ของ upsell — ไม่มี outlet นอก list นี้เข้า P1/P3
core_nrr_outlets AS (
  SELECT
    m.outlet_id,
    k_may.kam_email,
    k_may.tl_email
  FROM may_ownership m
  JOIN apr_ownership  a   ON m.outlet_id = a.outlet_id
  JOIN apr_gmv        ag  ON m.outlet_id = ag.outlet_id
  JOIN kam_list       k_may
    ON m.commercial_owner = 'KAM'
   AND TRIM(m.staff_owner) = TRIM(k_may.kam_name)
  -- Apr KAM ต้องเป็นคนเดียวกับ May KAM
  JOIN kam_list       k_apr
    ON a.commercial_owner = 'KAM'
   AND TRIM(a.staff_owner) = TRIM(k_apr.kam_name)
   AND k_apr.kam_email = k_may.kam_email
  -- ต้องมี May GMV ด้วย (join กับ may_gmv ด้านล่างตอน final)
  -- เช็คแค่ว่า outlet มี May order (มี row ใน may_ownership ก็พอ)
  -- May GMV > 0 จะ filter ใน commission_items
),

-- ── 7. May GMV per outlet × group_key — เฉพาะ core_nrr outlets ───────────
current_gmv_by_group AS (
  SELECT
    cn.kam_email,
    cn.outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family
      ELSE i.subclass_name
    END                        AS group_key,
    SUM(i.gmv_ex_vat)          AS may_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN params p
  JOIN core_nrr_outlets cn ON CAST(o.user_id AS STRING) = cn.outlet_id
  WHERE o.delivery_date BETWEEN p.cur_start AND p.cur_end
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3
),

-- ── 8. Baseline: group_key ที่เคยซื้อใน Feb/Mar/Apr (lookback 3 เดือน) ────
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
    AND o.delivery_date <  p.cur_start
    AND i.gmv_ex_vat > 0
),

-- ── 9. Max baseline GMV (normalize 30 วัน) per outlet × group_key ─────────
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
    AND o.delivery_date <  p.cur_start
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

-- ── 10. Classify P1 / P3 ──────────────────────────────────────────────────
commission_items AS (
  SELECT
    c.kam_email,
    c.outlet_id,
    c.group_key,
    c.may_gmv,
    COALESCE(mb.max_bl, 0) AS max_bl,
    -- P1: group_key ไม่เคยซื้อใน 3 เดือนก่อน + may_gmv ≥ 2,500
    CASE
      WHEN bg.group_key IS NULL AND c.may_gmv >= 2500 THEN 1
      ELSE 0
    END AS is_p1,
    -- P3: group_key เคยซื้อ + may_gmv > max_bl × 200% + ส่วนเกิน ≥ 5,000
    CASE
      WHEN bg.group_key IS NOT NULL
        AND c.may_gmv > COALESCE(mb.max_bl, 0) * 2.00
        AND c.may_gmv - COALESCE(mb.max_bl, 0) >= 5000
      THEN 1
      ELSE 0
    END AS is_p3
  FROM current_gmv_by_group c
  -- เช็คว่า may_gmv > 0 (กรอง outlet ที่ silent ใน May)
  WHERE c.may_gmv > 0
  LEFT JOIN baseline_groups bg
    ON c.kam_email = bg.kam_email
   AND c.outlet_id = bg.outlet_id
   AND c.group_key = bg.group_key
  LEFT JOIN max_baseline mb
    ON c.kam_email = mb.kam_email
   AND c.outlet_id = mb.outlet_id
   AND c.group_key = mb.group_key
)

-- ── Final: per KAM summary ────────────────────────────────────────────────
SELECT
  ci.kam_email,
  kl.tl_email,
  kl.kam_name,

  -- P1
  ROUND(SUM(CASE WHEN ci.is_p1 = 1 THEN ci.may_gmv   ELSE 0 END), 0) AS p1_gmv,
  ROUND(SUM(CASE WHEN ci.is_p1 = 1 THEN ci.may_gmv   ELSE 0 END) * 0.03, 0) AS p1_comm,

  -- P3
  ROUND(SUM(CASE WHEN ci.is_p3 = 1 THEN ci.may_gmv - ci.max_bl ELSE 0 END), 0) AS p3_incremental,
  ROUND(SUM(CASE WHEN ci.is_p3 = 1 THEN ci.may_gmv - ci.max_bl ELSE 0 END) * 0.03, 0) AS p3_comm,

  -- Total upsell commission
  ROUND(
    SUM(CASE WHEN ci.is_p1 = 1 THEN ci.may_gmv ELSE 0 END) * 0.03 +
    SUM(CASE WHEN ci.is_p3 = 1 THEN ci.may_gmv - ci.max_bl ELSE 0 END) * 0.03
  , 0) AS total_upsell_comm,

  -- TL upsell base (ไม่คูณ rate — ใช้เป็นฐานคำนวณ multiplier ของ TL)
  ROUND(
    SUM(CASE WHEN ci.is_p1 = 1 THEN ci.may_gmv ELSE 0 END) +
    SUM(CASE WHEN ci.is_p3 = 1 THEN ci.may_gmv - ci.max_bl ELSE 0 END)
  , 0) AS tl_upsell_base

FROM commission_items ci
JOIN kam_list kl ON ci.kam_email = kl.kam_email
GROUP BY 1, 2, 3
ORDER BY kl.tl_email, total_upsell_comm DESC
