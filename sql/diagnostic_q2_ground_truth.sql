-- ══════════════════════════════════════════════════════════════════════════
-- Q2 2026 Ground Truth Diagnostic
-- รัน 3 queries แยกกัน เพื่อ verify ก่อนเขียน quarterly NRR SQL
-- ══════════════════════════════════════════════════════════════════════════

-- ── QUERY 1: Mar cohort universe ─────────────────────────────────────────
-- "outlet ทั้งหมดที่ควรนับเป็น core cohort Q2"
-- = commercial_owner = 'KAM' ใน Mar + มี GMV > 0
-- ไม่ filter ด้วย kam_list เลย — ดู raw ownership จาก order
SELECT
  UPPER(TRIM(o.commercial_owner))  AS commercial_owner,
  TRIM(o.staff_owner)              AS staff_owner,
  COUNT(DISTINCT CAST(o.user_id AS STRING)) AS outlet_count,
  ROUND(SUM(o.gmv_ex_vat), 0)     AS total_gmv
FROM `freshket-rn.dwh.order` o
WHERE o.delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
  AND o.account_type IN ('SA','MC','Chain','Unknown')
  AND o.gmv_ex_vat > 0
  AND o.user_id IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 4 DESC;

-- ── QUERY 2: KAM staff_owner ที่ไม่อยู่ใน roster ปัจจุบัน ───────────────
-- outlet เหล่านี้คือ "KAM ลาออก" — ต้องรู้ว่าตอนนี้อยู่กับใคร
WITH mar_kams AS (
  SELECT DISTINCT
    TRIM(o.staff_owner) AS staff_owner,
    COUNT(DISTINCT CAST(o.user_id AS STRING)) AS outlet_count,
    ROUND(SUM(o.gmv_ex_vat), 0) AS mar_gmv
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.gmv_ex_vat > 0
    AND o.user_id IS NOT NULL
  GROUP BY 1
),
current_roster AS (
  SELECT DISTINCT TRIM(staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 30 DAY)
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
)
SELECT
  mk.staff_owner,
  mk.outlet_count,
  mk.mar_gmv,
  CASE WHEN cr.staff_owner IS NOT NULL THEN 'in_roster' ELSE 'left_roster' END AS status
FROM mar_kams mk
LEFT JOIN current_roster cr ON mk.staff_owner = cr.staff_owner
ORDER BY 4, 3 DESC;

-- ── QUERY 3: outlet ที่ "KAM ลาออก" ดูแลใน Mar — ตอนนี้อยู่กับใคร ──────
-- ดูจาก user_master (snapshot ล่าสุด) ว่า staff_owner ปัจจุบันเป็นใคร
WITH left_kams AS (
  SELECT DISTINCT TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND TRIM(o.staff_owner) NOT IN (
      -- roster ปัจจุบัน (ใส่ชื่อจาก kam_list)
      'Anusorn (Bookbig) Khamphasuk',
      'Chaklid (Dent) Nimraor',
      'Duangruedee (Ning) Bulalom',
      'Guntinun (Monet) Thanoochan',
      'Intuon (Jane) Yanakit',
      'Napat (To) Kaikaew',
      'Natchita (Foam) Bunkong',
      'Niracha (Cream) Sangka',
      'Nuttawan (Kwang) Mahaporn',
      'Ploynitcha (Nitcha) Rujipiromthagoon',
      'Puttipong (Tape) Wanithaweewat',
      'Rinlaphat (Mild) Setthasiriwuti',
      'Siriprapa (Pop) Piapeng',
      'Treerak (May) Sangjua',
      'Warissara (Ply) Chanaboon'
    )
),
mar_outlets_of_left_kams AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    TRIM(o.staff_owner)       AS old_staff_owner,
    ROUND(SUM(o.gmv_ex_vat), 0) AS mar_gmv
  FROM `freshket-rn.dwh.order` o
  JOIN left_kams lk ON TRIM(o.staff_owner) = lk.staff_owner
  WHERE o.delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
    AND UPPER(TRIM(o.commercial_owner)) = 'KAM'
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.gmv_ex_vat > 0
  GROUP BY 1, 2
)
SELECT
  mo.old_staff_owner,
  um.staff_owner    AS current_staff_owner,
  um.staff_owner_email AS current_staff_email,
  um.commercial_owner  AS current_commercial_owner,
  COUNT(DISTINCT mo.outlet_id) AS outlet_count,
  ROUND(SUM(mo.mar_gmv), 0)   AS mar_gmv
FROM mar_outlets_of_left_kams mo
LEFT JOIN `freshket-rn.dim.user_master` um
  ON CAST(um.res_id AS STRING) = mo.outlet_id
  AND um.commercial_owner = 'KAM'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 6 DESC;
