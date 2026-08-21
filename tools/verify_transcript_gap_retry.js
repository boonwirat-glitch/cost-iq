#!/usr/bin/env node
// tools/verify_transcript_gap_retry.js — v_transcribegap (2026-08-20)
//
// บุชขอให้เทียบเสียงจริงกับผล analyze ของ session ยาวๆ ("30-40 นาที แต่สรุปเหลือ
// แค่ 1-2 ประเด็น") — ไล่จริงพบว่าไม่ใช่ปัญหาการสรุปสั้นเกินไป แต่เป็นเพราะ
// Groq Whisper บางครั้งตอบ 200 OK แต่ transcript หยุดกลางคันเงียบๆ ก่อนถึงขั้น
// analyze ด้วยซ้ำ — สุ่มดู 20 session ยาว (whisper_fallback) เจอ 3 ใน 20 (15%)
// ที่ท่อนสุดท้ายจบก่อนความยาวคลิปจริงเกิน 10% หนักสุด 37% (2501 วิ เหลือ 1570 วิ)
//
// แก้: เทียบ timestamp ท่อนสุดท้ายกับ duration_secs จริง ถ้าขาดเกินเกณฑ์ ลองใหม่
// "ครั้งเดียว" (ไม่ใช่ 3 — ผูกกับบทเรียน 12 ส.ค. ว่าโควตา Groq คิดเป็นวินาทีเสียง
// ไม่ใช่จำนวนคำขอ ยิงซ้ำเกินจำเป็นเผาโควตาทั้ง batch) แล้วเลือกผลที่ครอบคลุมกว่า
//
// Usage: node tools/verify_transcript_gap_retry.js

const fs = require('fs');
const path = require('path');

const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('── v_transcribegap: จับ transcript ที่ Groq ตัดจบก่อนความยาวคลิปจริง ──');

const fnStart = WK.indexOf('async function runTranscribe(');
// v_gapscore (2026-08-21): ระยะคงที่ 8000 พังทันทีที่เพิ่ม _groqCoverScore เข้าไป
// (จุดที่ต้องเช็คขยับไป ~8600) — เลิกเดาระยะ ใช้จุดสิ้นสุดจริงของบล็อก gap-retry
// เป็นขอบเขตแทน ซึ่งไม่ขยับตามความยาวคอมเมนต์ที่แทรกก่อนหน้า
const _gapEnd = WK.indexOf('// Whisper hallucination guard', fnStart);
const fnBody = fnStart > -1
  ? WK.slice(fnStart, _gapEnd > fnStart ? _gapEnd : fnStart + 12000)
  : '';
check('ดึงเนื้อ runTranscribe ออกมาได้', !!fnBody);

check('มีเกณฑ์ตัดสิน: อย่างน้อย 60 วิ หรือ 10% ของความยาวคลิป แล้วแต่ค่าไหนมากกว่า',
  /GROQ_GAP_FLOOR_SEC = 60/.test(fnBody) && /GROQ_GAP_RATIO = 0\.10/.test(fnBody) &&
  /Math\.max\(GROQ_GAP_FLOOR_SEC, \(duration_secs \|\| 0\) \* GROQ_GAP_RATIO\)/.test(fnBody));

check('เทียบจาก segment สุดท้ายจริง (end time) ไม่ใช่จำนวน segment',
  /function _lastSegEnd\(gd\)/.test(fnBody) &&
  /Math\.max\(\.\.\.segs\.map\(s => s\.end \|\| 0\)\)/.test(fnBody));

check('ลองใหม่ "ครั้งเดียว" เท่านั้น — ไม่มีลูป ไม่เรียกซ้ำเกิน 1 ครั้ง',
  (() => {
    // ต้องมี fetch สำหรับรอบ retry อีกแค่ 1 ครั้ง (รวมของเดิมในฟังก์ชันนี้ = 2 จุด
    // fetch ทั้งหมด: รอบแรกใน withRetry + รอบสองตรงนี้ — ไม่ใช่ลูป while/for)
    const retrySection = fnBody.slice(fnBody.indexOf('_firstGap > _gapThreshold'));
    return !/while\s*\(|for\s*\(/.test(retrySection.slice(0, 800)) &&
           (retrySection.match(/fetch\('https:\/\/api\.groq\.com/g) || []).length === 1;
  })());

// v_gapscore (2026-08-21): เกณฑ์เดิม `_retryGap < _firstGap` เทียบแค่ timestamp ท่อน
// สุดท้าย → รอบสองที่ "ไปถึงท้ายกว่าแต่บางกว่า" ทับรอบแรกที่ละเอียดกว่าได้ · เจอจริง
// กับ session ของ Dent: 21 ส.ค. 12:54 (47.6 นาที) ครอบคลุมเพิ่ม 8% แต่จำนวนท่อนหาย
// ไป 49% เทียบกับคลิปยาวเท่ากันของคนเดียวกันเมื่อ 19 ส.ค. (224 → 115 ท่อน)
check('เลือกผลจากคะแนนรวม (ครอบคลุม × ความละเอียด) ไม่ใช่แค่ไปถึงนาทีท้ายกว่า',
  /function _groqCoverScore\(gd\)/.test(fnBody) &&
  /const _s1 = _groqCoverScore\(groqData\), _s2 = _groqCoverScore\(retryData\);/.test(fnBody) &&
  /if \(_s2 > _s1\) \{/.test(fnBody) && /groqData = retryData;/.test(fnBody) &&
  !/if \(_retryGap < _firstGap\) \{/.test(fnBody));

check('คะแนนใช้สูตรเดียวกับป้ายเตือนในแอป (เพดานความละเอียดตัวเดียวกัน)',
  /density \/ USABILITY_TARGET_SEG_PER_MIN/.test(fnBody));

check('log บอกทั้งคะแนนและจำนวนท่อน — ตรวจย้อนได้ว่าทำไมเลือกผลไหน',
  /ท่อน \$\{_n2\} จาก \$\{_n1\}/.test(fnBody) && /ท่อน \$\{_n2\} เทียบ \$\{_n1\}/.test(fnBody));

check('รอบสอง fetch ล้มเหลว/เครือข่ายพัง ต้องไม่ทำให้ทั้ง session พัง (ใช้ผลรอบแรกต่อ)',
  /catch \(e\) \{\s*\n\s*console\.warn\('\[transcribe\] ลองใหม่รอบสองล้มเหลว/.test(fnBody));

// รันจริง: สูตรต้องปฏิเสธผลที่ "ยาวกว่าแต่บางกว่า" ตามเคสจริงของ Dent
{
  const vm = require('vm');
  const c = { USABILITY_TARGET_SEG_PER_MIN: 6 };
  vm.createContext(c);
  vm.runInContext(`
    function _lastSegEnd(gd){const s=(gd&&gd.segments)||[];return s.length?Math.max(...s.map(x=>x.end||0)):0;}
    function mkScore(duration_secs){
      return function(gd){
        const segs=(gd&&gd.segments)||[]; if(!segs.length||!duration_secs) return 0;
        const end=_lastSegEnd(gd); if(!end) return 0;
        const coverage=Math.max(0,Math.min(1,end/duration_secs));
        const density=(end/60)>0?segs.length/(end/60):0;
        return coverage*Math.max(0,Math.min(1,density/USABILITY_TARGET_SEG_PER_MIN));
      };
    }
    this.mkScore=mkScore;`, c);
  const score = c.mkScore(2857);
  const mk = (n, end) => ({ segments: Array.from({ length: n }, (_, i) => ({ end: ((i + 1) / n) * end })) });
  const dense  = mk(224, 2070);   // รอบแรกแบบ 19 ส.ค. — สั้นกว่าแต่ละเอียด
  const sparse = mk(115, 2322);   // รอบสองแบบ 21 ส.ค. — ยาวกว่าแต่บาง
  check('รันจริง: ผล "ยาวกว่าแต่บางกว่า" ต้องแพ้ผลที่ละเอียดกว่า (เกณฑ์เดิมเลือกผิดข้อนี้)',
    score(sparse) < score(dense) && (2857 - 2322) < (2857 - 2070),
    `บาง ${score(sparse).toFixed(3)} · ละเอียด ${score(dense).toFixed(3)} — gap ของตัวบางน้อยกว่าจริง จึงเคยชนะด้วยเกณฑ์เดิม`);
  check('รันจริง: ผลที่ทั้งยาวกว่าและแน่นกว่า ยังชนะตามปกติ',
    score(mk(300, 2800)) > score(dense));
}

console.log('\n' + (fail ? `❌ verify_transcript_gap_retry: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_transcript_gap_retry: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
