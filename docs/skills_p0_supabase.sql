
-- ══════════════════════════════════════════════════════════════
-- Freshket Sense — Skills Feature
-- P0: Create tables + RLS + seed 14 skill definitions
-- Run in Supabase SQL Editor (supabase.com → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════

-- ── 1. skill_definitions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skill_definitions (
  id            SERIAL PRIMARY KEY,
  module        CHAR(1)      NOT NULL CHECK (module IN ('A','B','C','D')),
  skill_code    TEXT         NOT NULL UNIQUE,
  skill_name_en TEXT         NOT NULL,
  skill_name_th TEXT,
  principle_th  TEXT,
  practice_th   TEXT,
  pass_test_th  TEXT,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE public.skill_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skill_defs_read" ON public.skill_definitions;
CREATE POLICY "skill_defs_read" ON public.skill_definitions FOR SELECT USING (true);

-- ── 2. user_skill_progress ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_skill_progress (
  id            SERIAL PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id      INT          NOT NULL REFERENCES public.skill_definitions(id) ON DELETE CASCADE,
  state         TEXT         NOT NULL DEFAULT 'locked'
                             CHECK (state IN ('locked','training','unlocked','mastered')),
  evaluated_by  UUID         REFERENCES auth.users(id),
  evaluated_at  TIMESTAMPTZ,
  notes         TEXT,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, skill_id)
);
ALTER TABLE public.user_skill_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "progress_rep_read"  ON public.user_skill_progress;
DROP POLICY IF EXISTS "progress_rep_write" ON public.user_skill_progress;
DROP POLICY IF EXISTS "progress_tl_read"  ON public.user_skill_progress;
DROP POLICY IF EXISTS "progress_tl_write" ON public.user_skill_progress;
CREATE POLICY "progress_rep_read"  ON public.user_skill_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "progress_rep_write" ON public.user_skill_progress FOR ALL    USING (auth.uid() = user_id);
CREATE POLICY "progress_tl_read"   ON public.user_skill_progress FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('sales_tl','tl','admin')));
CREATE POLICY "progress_tl_write"  ON public.user_skill_progress FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('sales_tl','tl','admin')));

-- ── 3. skill_eval_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skill_eval_log (
  id            SERIAL PRIMARY KEY,
  progress_id   INT          NOT NULL REFERENCES public.user_skill_progress(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id      INT          NOT NULL REFERENCES public.skill_definitions(id),
  old_state     TEXT         NOT NULL,
  new_state     TEXT         NOT NULL,
  changed_by    UUID         NOT NULL REFERENCES auth.users(id),
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  comment       TEXT
);
ALTER TABLE public.skill_eval_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "log_rep_read" ON public.skill_eval_log;
DROP POLICY IF EXISTS "log_insert"   ON public.skill_eval_log;
DROP POLICY IF EXISTS "log_tl_read"  ON public.skill_eval_log;
CREATE POLICY "log_rep_read" ON public.skill_eval_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "log_insert"   ON public.skill_eval_log FOR INSERT WITH CHECK (auth.uid() = changed_by);
CREATE POLICY "log_tl_read"  ON public.skill_eval_log FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('sales_tl','tl','admin')));

-- ── 4. Seed 14 skills ────────────────────────────────────────
INSERT INTO public.skill_definitions (module,skill_code,skill_name_en,skill_name_th,principle_th,practice_th,pass_test_th,sort_order) VALUES
('A','A01_PIPC','PIPC','PIPC — กระบวนการขาย','ทุกการสนทนากับลูกค้าต้องเป็นไปตามลำดับ Prepare → Identify → Probe → Close นี่ไม่ใช่บทพูด แต่เป็นเครื่องมือวินิจฉัย','Hero Product / Ref ลูกค้าที่ใช้ FKT / Sale Kits|Identify: FKT คือใคร, core value, need pain|Probe: Need & Pain ของลูกค้า|Close: Provide solution, จังหวะปิด, Framework สามเหลี่ยม','อธิบาย benchmark คู่แข่งได้ / นำ value ไปตอบโจทย์ได้เหมาะสม / redirect จาก price ไป value ได้ / มี context ในหัว เช่น hidden cost, operation, การเทียบราคา',10),
('A','A05_VALUE','Freshket Value & USP','Freshket Value & USP — จุดขาย','เปลี่ยนมุมมองลูกค้าจากแค่ซัพพลายเออร์อีกเจ้า ให้กลายเป็นพันธมิตรที่ช่วยขจัดความเสี่ยงในการดำเนินงานทุกวัน','FKT Value 3 ระดับ: สิ่งที่ซัพทุกเจ้ามี / สิ่งที่ FKT ทำได้ดีกว่า / สิ่งที่ FKT เท่านั้นมี','อธิบาย 3-tier logic ได้ / เชื่อมโยง value เข้ากับบริบทเฉพาะของร้านนั้นๆ ได้ ไม่ใช่แค่ร่าย feature',20),
('A','A09_PLANNING','Planning & Target Tracking','วางแผนและติดตามเป้าหมาย','การวางแผนคือเครื่องมือในการคิด ไม่ใช่แค่แบบฟอร์มธุรการ ถามว่า แผนนี้ช่วยให้ตัดสินใจเรื่องอะไรได้บ้าง','Goal & Target / Sales Funnel & Activities / Forecast / Action Plan รายสัปดาห์','แผนรายสัปดาห์มีตรรกะรองรับตัวเลข ไม่ใช่แค่บอกว่าจะทำมากขึ้น / อธิบายได้ว่าทำไม Top 3 Accounts ถึงจะมีการเคลื่อนไหวในสัปดาห์นี้',30),
('A','A10_PIPELINE','Pipeline Management','จัดการ Pipeline','Lead ดีมีชัยไปกว่าครึ่ง การรู้กลุ่มเป้าหมายที่ match ทำให้โอกาสปิดขายสูงขึ้น','Set Standard %CVR / Target Visit: Chain 5/wk, SA-MC 10/wk / Weekly Action Plan / Check-in/Check-out','รู้ stage + จำนวนลูกค้าในแต่ละ funnel / อธิบายกระบวนการ + activity ของแต่ละ stage ได้ / แยก Hot/Warm/Cold ได้พร้อมเหตุผล',40),
('B','B01_LEAD','Lead Finding','หา Lead','Pipeline คือลมหายใจ ความเร็วคือความได้เปรียบ ร้านที่กำลังจะเปิดใหม่คือโอกาสทองที่มีคู่แข่งน้อยที่สุด','Google Maps ค้นหาร้านอาหาร / เดินหาตาม street / ค้นหาตาม FD / เพจรับสมัครพนักงานร้านอาหาร','ระบุ Lead คุณภาพสูงมาได้ 5 ราย พร้อมอธิบายว่าทำไมถึงเลือก / มีอย่างน้อย 2 รายที่เป็นร้านเปิดใหม่หรือร้านที่ไม่มีใน App พื้นฐาน',50),
('B','B02_DM','Finding Decision Maker','หาคนตัดสินใจ','การเจอคนตัดสินใจทำให้โอกาสปิดขาย + Sales Cycle เร็วขึ้นมาก','รู้จัก Gatekeeper / Decision Maker / User / คุยกับ owner, chef, จัดซื้อ, บัญชี, ผู้จัดการได้ถูกคน','อธิบายได้ว่า Sales ที่ Pitch อยู่ใน stakeholder ส่วนไหน และมีวิธีคุยในแต่ละ role อย่างไร',60),
('B','B03_APPT','Making Appointment','การนัดหมาย','เป้าหมายของการโทรนัดไม่ใช่เพื่อขาย FKT แต่คือการขาย เวลา 20 นาที ของเจ้าของร้าน','สร้าง Mindset: เราจะเอา benefit ไปให้ / Frame การทำการบ้านก่อน / รู้ว่าคุยกับใครใน SA/MC/Chain','มีความมั่นใจ รู้ว่า FKT คือใคร / handle objection ได้ใน 3 สถานการณ์ / ระบุ Role ลูกค้า + Timeline ที่ทำนัด',70),
('B','B04_PREVISIT','Pre-Visit Preparation','เตรียมตัวก่อนเยี่ยม','พนักงานขายที่เตรียมตัวดีจะถามคำถามได้ดีกว่า เพราะรู้แล้วว่าคำถามไหนสำคัญสำหรับร้านนี้โดยเฉพาะ','Hero Product / Ref ลูกค้าที่ใช้ FKT / Sale Kits ความพร้อมของข้อมูล / รู้ว่าจะคุยกับ Role ไหน','ระบุได้ว่าใครน่าจะเป็น DM และเพราะอะไร / เมนูบอกอะไรเกี่ยวกับความต้องการวัตถุดิบ / SKU 3 รายการที่จะนำเสนอพร้อมเหตุผล',80),
('C','C00_RAPPORT','Rapport & Reading the Room','Rapport และการอ่านห้อง','คุณไม่สามารถขายของให้กับคนที่ยังไม่เชื่อใจคุณได้ ก่อนจะเริ่ม Pitch ต้องอ่านให้ออกว่าลูกค้าเริ่มต้นด้วยทัศนคติอย่างไร','Framework B.A.N.K — ระบุบุคลิกลูกค้า / วิธี Break the Ice ในแต่ละแบบ / Role play 3 สถานการณ์กับ TL','วิเคราะห์ได้ว่า user ที่คุยเป็นบุคลิกแบบไหน / วิธีเปิดใจลูกค้าในกลุ่มต่างๆ / รับมือกับ Perception ครั้งแรกได้',90),
('C','C01_DISCOVERY','Discovery','การค้นหาข้อมูลลูกค้า','ทุกคำถามต้องเปิดเผย insight เฉพาะอะไรบางอย่าง ถ้าอธิบายไม่ได้ว่าถามไปทำไม ก็ไม่ต้องถาม','Framework OCPB: Operation / Competitor+price / Payment+Billing / Business Plan / Active listening debrief หลังเยี่ยม','สรุปข้อมูลได้อย่างลึกซึ้ง / ระบุช่องว่างข้อมูลของตัวเองได้ / ครอบคลุม OCPB ได้อย่างน้อย 3 มิติ',100),
('C','C03_ANALYZE','Analyze & Connect Pain','วิเคราะห์และเชื่อม Pain กับ Solution','Discovery data ไม่มีประโยชน์ถ้าเชื่อม solution ไม่ได้ งานหลัง discovery คือปิดช่องว่างระหว่างที่ได้ยินกับสิ่งที่ FKT แก้ได้','วิเคราะห์ buyer type (Price/Relationship/Value/Convenience) / จดบันทึกสรุปปัญหาเป็น bullet / เชื่อม pain กับ FKT value','ระบุ Pain Point ได้ / บอก Value ของ FKT ที่ตอบโจทย์ Pain โดยไม่เล่าแต่ Feature / จับประเด็นจากคำตอบลูกค้ามาเชื่อมกับ Value ได้ถูกต้อง',110),
('C','C04_OBJECTION','Objection Handling','การรับมือข้อโต้แย้ง','คำคัดค้านไม่ใช่การปฏิเสธ มันคือสัญญาณว่าลูกค้ายังอยู่ในขั้นตอนการประเมิน','Framework: รับทราบ → ถามให้ชัด → ปรับมุมมอง → ยืนยัน / 4 ข้อใหญ่: Quality / Price / Completeness / Logis','รับมือข้อโต้แย้งได้ครบ 4 หัวข้อ: Quality / Price / Completeness / Logis',120),
('C','C05_CLOSE','Close & Next Step','การปิดและ Next Step','การปิดขายที่มี Next Step ชัดเจนว่า Benefit/Action อะไรที่จะทำให้ลูกค้ามีการสั่งซื้อได้เลย','จับจังหวะปิดตาม Opty % / Next Step แต่ละ Meeting ชัดเจน / 1st Meeting: เข้าใจปัญหา + ได้ List / 2nd Meeting: Sent Price / Clear Spec','ปิดขายโดยมี: ทวนปัญหาลูกค้า / ยืนยันวันที่แน่นอน / สรุป Benefit + Next Action + Timeline สั่งซื้อ',130),
('D','D01_WALLET','Wallet Size & Prioritization','ประเมิน Wallet Size และจัดลำดับ','ช่วยจัดลำดับและให้น้ำหนัก Potential ลูกค้า เพื่อตัดสินใจว่าควรติดตามผลหนักแค่ไหน','Wallet Size ประเมิน Opty / Category Mix + Competitor ประเมิน Wallet Share / จัดลำดับ Hot/Warm/Cold + Timeline','จัดลำดับ Hot/Warm/Cold พร้อม logic / ประเมิน Wallet Size และ Wallet Share ว่า Opty ที่ขายเพิ่มได้มีอะไรบ้าง',140),
('D','D02_FOLLOWUP','Follow-Up with Purpose','ติดตามผลอย่างมีจุดประสงค์','การติดตามผลต้องมีวัตถุประสงค์ชัดเจน + หา option/solution ใหม่เสมอ','แบ่ง 3 กลุ่ม: ยังไม่สั่ง / Potential ปิดไม่ได้ / สั่งแล้วหายหรือน้อยลง / แผนแก้ไข + Timeline','อธิบายแผนติดตามในแต่ละกรณีได้ / มี Actions + Timeline เฉพาะเจาะจง / กลยุทธ์แตกต่างกันชัดเจนทั้ง 3 แบบ',150)
ON CONFLICT (skill_code) DO UPDATE SET
  skill_name_en=EXCLUDED.skill_name_en, skill_name_th=EXCLUDED.skill_name_th,
  principle_th=EXCLUDED.principle_th, practice_th=EXCLUDED.practice_th,
  pass_test_th=EXCLUDED.pass_test_th, sort_order=EXCLUDED.sort_order;

-- ── 5. Verify ────────────────────────────────────────────────
SELECT module, skill_code, skill_name_en, sort_order FROM public.skill_definitions ORDER BY sort_order;
