-- ══════════════════════════════════════════════
-- SKILLS FEATURE — Seed 14 skill_definitions
-- Run AFTER schema SQL, via service role
-- ══════════════════════════════════════════════

INSERT INTO skill_definitions
  (module, skill_code, skill_name_th, skill_name_en, principle_th, practice_th, pass_test_th, card_image_url, sort_order)
VALUES

-- ── MODULE A ──
('A','A01_PIPC','PIPC','PIPC',
 'ทุกการสนทนากับลูกค้าต้องเป็นไปตามลำดับ Prepare → Identify → Probe → Close นี่ไม่ใช่บทพูด แต่เป็นเครื่องมือวินิจฉัย',
 'Prepare: Hero Product, Ref ลูกค้า FKT, Sale Kits, 4 Role คุยกับใคร | Identify: FKT คือใคร, core value, need/pain | Probe: Need และ Pain | Close: provide solution, จังหวะปิด, framework เทียบซัพ',
 'อธิบาย benchmark ได้, นำ value ตอบโจทย์ได้, redirect จาก price→value ได้, มี context ราคาสินค้าในหัว',
 '/skills/A01_navigator_pipc.webp', 1),

('A','A05_VALUE_USP','Freshket Value & USP','Freshket Value & USP',
 'เปลี่ยนมุมมองลูกค้าจาก "ซัพอีกเจ้า" ให้กลายเป็น "พันธมิตรที่ช่วยขจัดความเสี่ยงในการดำเนินงาน" ร้านอาหารไม่ได้เปลี่ยนซัพแค่เรื่องราคา',
 'FKT Value 3 ระดับ: สิ่งที่ซัพทุกเจ้ามี / สิ่งที่ FKT ทำได้ดีกว่า / สิ่งที่ FKT เท่านั้นมีให้',
 'อธิบาย 3-tier logic ได้ / เชื่อมโยง value เข้ากับบริบทร้านนั้นๆ ได้ ไม่ใช่แค่ร่าย feature ทั่วไป',
 '/skills/A02_navigator_value.webp', 2),

('A','A09_PLANNING','Planning & Target Tracking','Planning & Target Tracking',
 'การวางแผนคือเครื่องมือในการคิด ไม่ใช่แค่แบบฟอร์มธุรการ ถ้ามองว่ามันคืองานเอกสาร ต้องแก้ทัศนคติก่อนสอนวิธีการ',
 'Goal & Target / Sales Funnel & Activities / Forecast / Action Plan | 1-1 Action Plan รายสัปดาห์ / Monitor midweek',
 'แผนรายสัปดาห์มีตรรกะรองรับตัวเลข ไม่ใช่แค่บอกว่าจะทำมากขึ้น / อธิบายได้ว่าทำไม Top 3 Accounts ถึงจะมีความเคลื่อนไหวสัปดาห์นี้',
 '/skills/A03_navigator_planning.webp', 3),

('A','A10_PIPELINE','Pipeline Management','Pipeline Management',
 'Lead ดีมีชัยไปกว่าครึ่ง การรู้กลุ่มเป้าหมายที่ matching ทำให้โอกาสปิดขายสูงขึ้น',
 'Set Standard %CVR: Appointment / Visit(F2F) / FD | Target Visit: Chain New-FD 5/wk, SA/MC New-FD 10/wk | Weekly Action Plan / Check-in/Check-out',
 'รู้ stage + จำนวนลูกค้าตัวเองในแต่ละ funnel / อธิบาย hot warm cold ได้ / วิเคราะห์ว่าต้อง visit เพิ่มเท่าไหร่',
 '/skills/A04_navigator_pipeline.webp', 4),

-- ── MODULE B ──
('B','B01_LEAD','Lead Finding','Lead Finding',
 'Pipeline คือลมหายใจ: การปิดขายที่ดีจะไร้ความหมายถ้าไม่มี lead เข้ามาเติมต่อเนื่อง ร้านที่กำลังเปิดใหม่คือโอกาสทองที่มีคู่แข่งน้อยที่สุด',
 'Google ค้นหาร้านอาหารใกล้ฉัน / เดินหาตาม street / ค้นหาตามเพจ FD รับสมัครพนักงาน / สังเกตป้ายร้านที่กำลัง renovate',
 'ระบุ Lead คุณภาพสูง 5 ราย พร้อมอธิบายว่าทำไมถึงเลือก — ต้องมีอย่างน้อย 2 รายที่เป็นร้านเปิดใหม่หรือไม่มีใน App พื้นฐาน',
 '/skills/B01_scout_lead.webp', 5),

('B','B02_DM','Finding Decision Maker','Finding Decision Maker',
 'การเจอคนตัดสินใจทำให้โอกาสปิดขาย + Sales Cycle เร็วขึ้นมาก',
 'Gatekeeper / Decision Maker / User | Owner / Chef / จัดซื้อ / บัญชี / ผู้จัดการร้าน | Role play: TL สวมบทบาท 3 ประเภทผู้ประสานงาน',
 'อธิบายได้ว่า stakeholder ที่คุยอยู่คือใคร ทำหน้าที่อะไร และมีวิธีคุยในแต่ละ stakeholder อย่างไร',
 '/skills/B02_scout_dm.webp', 6),

('B','B03_APPT','Making Appointment','Making Appointment',
 'เป้าหมายของการโทรนัด ไม่ใช่เพื่อขาย Freshket แต่คือการขาย "เวลา 20 นาที" ของเจ้าของร้าน',
 'Mindset: เราจะเอา benefit ไปให้ / คุยกับใคร: SA→Staff→Owner, Chain→จัดซื้อ / ให้ value ถ้ามีซัพประจำ: จัดส่งทุกวัน / objection handling',
 'มีความมั่นใจ + รู้ว่า FKT คือใคร / objection handle ได้ใน 3 สถานการณ์ / ระบุ Role ลูกค้า + Timeline ที่ทำนัดได้',
 '/skills/B03_scout_appt.webp', 7),

('B','B04_PREP','Pre-Visit Preparation','Pre-Visit Preparation',
 'Sales ที่เตรียมมาดีไม่เพียงรู้ข้อมูลมากขึ้น แต่จะถามคำถามได้ดีกว่า เพราะรู้แล้วว่าคำถามไหนสำคัญสำหรับร้านนั้นๆ',
 'Hero Product / Ref ลูกค้าที่ใช้ FKT / Sale Kits / Role: คุยกับใคร | นำเสนอ homework 10 นาที: DM hypothesis + menu analysis + Top 3 SKUs',
 'ระบุได้ว่าใครน่าจะเป็น DM และเพราะอะไร / เมนูบอกอะไรเกี่ยวกับ ingredient ที่ต้องการ / 3 SKUs ที่จะนำเสนอพร้อมเหตุผล',
 '/skills/B04_scout_prep.webp', 8),

-- ── MODULE C ──
('C','C00_RAPPORT','Rapport & Reading the Room','Rapport & Reading the Room',
 'คุณไม่สามารถขายของให้กับคนที่ยังไม่เชื่อใจคุณได้ ก่อนจะเริ่มนำเสนอ หน้าที่คือต้องอ่านให้ออกว่าลูกค้าเริ่มต้นด้วยทัศนคติอย่างไรและปรับตัวตามนั้น',
 'Framework B.A.N.K: Blueprint / Action / Nurturing / Knowledge | วิธี Break the Ice ในแต่ละแบบ | Role play 3 สถานการณ์: ไม่เคยได้ยิน FKT / เคยมีประสบการณ์แย่ / ไม่มีอำนาจตัดสินใจ',
 'วิเคราะห์ได้ว่า user ที่คุยเป็นบุคลิกแบบไหน / วิธีเปิดใจลูกค้าในกลุ่มต่างๆ / รับมือ Perception ลูกค้าครั้งแรกได้',
 '/skills/C00_consultant_rapport.webp', 9),

('C','C01_DISCOVERY','Discovery','Discovery — Asking the Right Questions',
 'ทุกคำถามควร unlock insight เฉพาะ ถ้าอธิบายไม่ได้ว่าถามทำไม ไม่จำเป็นต้องถาม discovery ที่ดีทำให้ลูกค้ารู้สึกว่าถูกเข้าใจ ไม่ใช่ถูกสัมภาษณ์',
 'Framework OCPB: Operation ของร้าน / Competitor+service+price / Payment+Billing / Business Plan | Active listening debrief ทันทีหลัง visit',
 'สรุปข้อมูลได้อย่างลึกซึ้งและระบุช่องโหว่ข้อมูลของตัวเองได้ ภายใต้ OCPB ทั้ง 4 หัวข้อ',
 '/skills/C01_consultant_discovery.webp', 10),

('C','C03_ANALYZE','Analyze & Connect Pain to Solution','Analyze & Connect Pain to Solution',
 'วิเคราะห์ได้ถูกมีโอกาสเปลี่ยนเกมได้ไว การปิดช่องว่างระหว่างสิ่งที่ได้ยินมากับสิ่งที่ FKT แก้ได้ โดยใช้คำพูดของลูกค้าเอง',
 'ต้องแม่นเรื่อง Value + OPS FKT / จดบันทึก สรุป pain เป็น bullet / กำหนดสถานการณ์: ระบุประเภทลูกค้า / จับคู่ pain 2 จุดกับ FKT value / ระบุสิ่งที่ยังขาดก่อนเสนอ',
 'ระบุ Pain Point ได้ว่าคืออะไร / บอก Value FKT ที่ตอบโจทย์ Pain ได้โดยไม่เล่าแต่ feature / จับประเด็นจากคำตอบลูกค้ามาเชื่อมกับ Value ได้ถูกต้อง',
 '/skills/C03_consultant_analyze.webp', 11),

('C','C04_OBJECTION','Objection Handling','Objection Handling',
 'คำคัดค้านไม่ใช่การปฏิเสธ มันคือสัญญาณว่าลูกค้ายังอยู่ในขั้นตอนการประเมิน ข้อผิดพลาดที่พบบ่อย: รีบตอบโต้ก่อนเข้าใจ',
 'Framework: รับทราบ → ถามให้ชัด → ปรับมุมมอง → ยืนยัน | Outward Mindset | 4 หัวข้อหลัก: Quality / Price / Completeness / Logistics | Role play: TL ยิง objection 7 ประเภทต่อเนื่อง',
 'รับมือข้อโต้แย้งได้ใน 4 หัวข้อ: Quality / Price / Completeness / Logistics',
 '/skills/C04_consultant_objection.webp', 12),

('C','C05_CLOSE','Close & Next Step','Close & Next Step',
 'การปิดขายที่มี Next Step ชัดเจน ว่า Benefit/Action อะไรที่จะทำให้ลูกค้ามีการสั่งซื้อได้เลย',
 'SA: รู้ Benefit ครบ สนใจ 50% / ของหมดพอดี / มีรอบสั่งทุกวัน | MC/Chain: โอกาส 40%→80%→100% ตาม Credit/Price/Value | Next Step per meeting',
 'ปิดขายโดยมี: ทวน pain ลูกค้า / ยืนยันวันที่แน่นอน / อย่างน้อย 1 action item ที่ลูกค้าตกลง | สรุป Benefit + Next Action + Timeline',
 '/skills/C05_consultant_close.webp', 13),

-- ── MODULE D ──
('D','D01_WALLET','Wallet Size & Prioritization','Estimating Wallet Size & Prioritizing',
 'ช่วยจัดลำดับหรือให้น้ำหนัก Potential Customer/Opty ในการขายสินค้า ช่วยตัดสินใจว่าควรติดตามผลหนักแค่ไหน',
 'Wallet Size (ประเมิน Opty) / Category Mix + Competitor (ประเมิน Wallet Share) / จัดลำดับ Potential: Hot Warm Cold → Timeline ของ Action items | TL สุ่ม 5 accounts ถามเหตุผล',
 'จัดลำดับ Hot/Warm/Cold พร้อม logic / ประเมิน Wallet Size และ Share ว่า Opty ที่ขายได้เพิ่มคืออะไร / ตอบพร้อมหลักฐานและตรรกะสอดคล้อง',
 '/skills/D01_growth_wallet.webp', 14),

('D','D02_FOLLOWUP','Follow-Up with Purpose','Follow-Up with Purpose',
 'การติดตามผลต้องมีวัตถุประสงค์ชัดเจน และหา option/solution ใหม่เสมอ',
 'แบ่ง activity 3 กลุ่ม: ยังไม่สั่ง / Potential (ถ้าปิดไม่ได้ควร escalate) / สั่งแล้วหายหรือสั่งน้อยลง | แผนแก้ไข: ราคา / คุณภาพ / เวลาสั่ง / operation / Role ของ user',
 'อธิบายแผนติดตามใน 3 กรณี พร้อม Actions และ Timeline เฉพาะเจาะจง / มีกลยุทธ์ที่แตกต่างกันชัดเจนทั้ง 3 แบบ พร้อมตรรกะรองรับ',
 '/skills/D02_growth_followup.webp', 15);

-- Verify
SELECT module, skill_code, skill_name_en, sort_order FROM skill_definitions ORDER BY sort_order;
