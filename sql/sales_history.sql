-- ════════════════════════════════════════════════════════════
-- SALES_HISTORY v1
-- Output: ส่วน Sales ของ bulk_history.csv
-- รวมกับ Q9B (KAM) เป็นไฟล์เดียวก่อน upload R2
--
-- Logic: dwh.order stamp commercial_owner + staff_owner ต่อ order
--   → นับ GMV เฉพาะช่วงที่ Sales rep เป็น owner จริงๆ
--   → ต่างจาก KAM history ที่นับ GMV ทั้งเดือนเพื่อ baseline
--
-- Ownership: commercial_owner='SALE' + staff_owner IN (sales names)
--   staff_owner names map จาก dim.user_master WHERE commercial_owner='SALE'
-- ════════════════════════════════════════════════════════════

SELECT
  o.account_id,
  MAX(o.res_name)                                                         AS account_name,
  CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
    WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
  END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING)
                                                                          AS month_label,
  ROUND(SUM(o.gmv_ex_vat), 0)                                            AS gmv,
  COUNT(DISTINCT o.order_id)                                              AS orders

FROM `freshket-rn.dwh.order` o
JOIN (
  SELECT DISTINCT staff_owner, staff_owner_email
  FROM `freshket-rn.dim.user_master`
  WHERE commercial_owner = 'SALE'
    AND staff_owner_email IN (
      'malisa.c@freshket.co',
      'nichapa.s@freshket.co',
      'nichita.n@freshket.co',
      'phongsakorn.j@freshket.co',
      'sirinrat.s@freshket.co',
      'wilailak.w@freshket.co',
      'benjawan.a@freshket.co',
      'kanokwan.w@freshket.co',
      'kanthicha.s@freshket.co',
      'nannapas.c@freshket.co',
      'pattama.t@freshket.co',
      'rujira.p@freshket.co',
      'sasaluk.t@freshket.co',
      'supanida.r@freshket.co',
      'thida.p@freshket.co'
    )
) sl ON LOWER(TRIM(o.staff_owner)) = LOWER(TRIM(sl.staff_owner))

WHERE o.commercial_owner = 'SALE'
  AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  AND o.delivery_date <  DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH)
  AND o.gmv_ex_vat > 0

GROUP BY 1, 3
ORDER BY 1, 3;
