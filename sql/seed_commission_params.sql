-- ═══════════════════════════════════════════════════════════════════
-- v562 — Seed commission params ให้ครบทุก field (รันครั้งเดียว)
--
-- ที่มา: cockpit save เดิมบันทึกเฉพาะ field ที่ถูกแตะ (บั๊ก แก้แล้วใน v562)
-- ทำให้ rows ใน target_settings แหว่ง — engine จึง fallback ไป default ในโค้ด
--
-- ค่าด้านล่าง = ค่าที่ engine ใช้จริงอยู่ตอนนี้ (ค่าที่คุณตั้ง + default ที่เหลือ)
-- ⚠ ตรวจเลขก่อนรัน — โดยเฉพาะ:
--    cap_1 = 0.70        (ไม่เคยถูก persist — ถ้าตั้งใจเป็นค่าอื่น แก้ก่อนรัน)
--    p1_rate = 0.03      (3%)
--    p3_rate = 0.03      (3%)
--    p3_threshold_pct = 2.00   (ยอดเกิน 2 เท่า baseline)
--    p1_min_gmv = 5000
-- ═══════════════════════════════════════════════════════════════════

-- upsell_sku: เก็บ p3_min_incremental=8000 ของเดิมไว้ + เติม field ที่ขาด
UPDATE target_settings SET
  value      = '{"p1_rate":0.03,"p3_rate":0.03,"p3_threshold_pct":2.00,"p1_min_gmv":5000,"p3_min_incremental":8000}',
  updated_by = 'boonwirat.t@freshket.co',
  updated_at = NOW()
WHERE key = 'upsell_sku_params';

-- gmv_gate: เก็บ 98/95/cap_2=0 ของเดิมไว้ + เติม cap_1 ที่หาย
UPDATE target_settings SET
  value      = '{"threshold_1":98,"threshold_2":95,"cap_1":0.70,"cap_2":0}',
  updated_by = 'boonwirat.t@freshket.co',
  updated_at = NOW()
WHERE key = 'gmv_gate_params';

-- upsell_outlet_params, handover_params, tl_upsell_mult_params: ครบอยู่แล้ว ไม่แตะ

-- ตรวจผลหลังรัน:
SELECT key, value FROM target_settings WHERE key LIKE '%\_params' ORDER BY key;
