-- ═══════════════════════════════════════════════════════════════════
-- v566 — เปิดสิทธิ์ TL รีวิว session ใน ci_sessions (รันครั้งเดียว)
--
-- อาการ: TL กด "บันทึก + รีวิว" → ปุ่มขึ้น ✓ แต่สถานะใน DB ไม่เปลี่ยน
-- สาเหตุ: RLS กรองแถวออก → UPDATE สำเร็จแบบ 0 แถว ไม่มี error (fake success)
-- ฝั่งแอพ v566 ตรวจจับ 0 แถวแล้ว — SQL นี้คือส่วนเปิดสิทธิ์ให้เขียนได้จริง
-- ═══════════════════════════════════════════════════════════════════

-- 1) ดู policy ปัจจุบันก่อน (เก็บผลไว้เผื่อ rollback)
SELECT policyname, cmd, qual, with_check
FROM pg_policies WHERE tablename = 'ci_sessions';

-- 2) เปิด UPDATE: เจ้าของ session (rep) หรือ role TL/admin
DROP POLICY IF EXISTS ci_sessions_tl_review ON ci_sessions;
CREATE POLICY ci_sessions_tl_review ON ci_sessions
  FOR UPDATE TO authenticated
  USING (
    owner_email = (SELECT email FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND lower(p.role) IN ('tl','sales_tl','admin','ad_tl')
    )
  )
  WITH CHECK (true);

-- 3) ตรวจผล: ต้องเห็น policy ci_sessions_tl_review ในรายการ
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ci_sessions';
