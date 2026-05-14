# Phase 6.2 Staging Test Script

## Basic regression

Use the same Phase 6.1 checklist:

1. App opens
2. Login / relogin works
3. Splash appears/disappears normally
4. Data pill appears/disappears
5. Account data loads
6. Restaurant swipe works
7. KAM mode opens
8. Portfolio / Team view do not break
9. Olive panel opens
10. AI responds through proxy

## Chat grounding tests

Ask Olive in account scope:

- “ตอนนี้ร้านนี้มี signal อะไรเด่นบ้าง”
- “ลงรายละเอียด account นี้ให้หน่อย”
- “SKU ที่หายไปหมายความว่าอะไร”
- “ควรโทรไปคุยเรื่องอะไร”

Expected behavior:

- No invented week-level claims such as “15 weeks” unless weekly data exists.
- No unsupported certainty that customer changed supplier/menu/promotions.
- If mentioning supplier/menu, Olive says it is a hypothesis to verify.
- No awkward Thai phrases like “ฟอกประมาณ”, “โทรตอบรับเสียว”, “หลังคาให้ยัง”.
- Answer remains practical, not overly rigid.
