#!/usr/bin/env node
// tools/verify_key_sku_export.js — v_keyexport (2026-08-16)
//
// Phase 2 ของฟีเจอร์ Key SKU: ส่งออกรายชื่อ SKU ที่ยืนยันแล้วไป Google Sheets
// ให้ทีม supply planning ดู ผ่าน worker/freshket-sense-ai-proxy-v2.js
//
// สิ่งที่ล็อกไว้ (ตามที่บุชขอ 2026-08-16):
//   1. อัปเดตแค่ 4 รอบ/วันตามเวลาไทยที่กำหนด (12/15/17/20 น.) ไม่ถี่กว่านั้น
//   2. เกาะ cron ที่มีอยู่แล้ว (ทุก 5 นาที 2-15 UTC) ไม่เพิ่ม cron trigger ใหม่
//      ใน wrangler.toml เลย — กันบทเรียนเดิมเรื่องประกาศ cron ไม่ตรงกับ dashboard
//   3. ไม่เพิ่มตาราง/คอลัมน์ Supabase ใหม่ — ใช้ key_skus_export_state ที่มีอยู่
//      แล้ว (แถวเดียว, id=1) เท่านั้น กันกิน storage เพิ่มบน free plan
//
// Usage: node tools/verify_key_sku_export.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WK_PATH = path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js');
const TOML_PATH = path.join(__dirname, '..', 'wrangler.toml');
const WK = fs.readFileSync(WK_PATH, 'utf8');
const TOML = fs.readFileSync(TOML_PATH, 'utf8');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
function grab(src, header, close) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const e = src.indexOf(close, i);
  return e < 0 ? null : src.slice(i, e + close.length);
}

console.log('── Key SKU export — cadence + footprint (ROUND นี้) ──');

// ── 1. ไม่แตะ wrangler.toml cron trigger เลย ──────────────────────────────
check('wrangler.toml ยังมี cron เดิม (ทุก 5 นาที 2-15 UTC) ไม่ถูกแก้',
  /crons\s*=\s*\[\s*"\*\/5 2-15 \* \* \*"\s*\]/.test(TOML));
check('worker ไม่ประกาศ cron ใหม่ (คำว่า crons ไม่ปรากฏนอก wrangler.toml)',
  !/crons\s*=/.test(WK));

// ── 2. เวลา export ต้องตรงกับที่บุชขอ (12/15/17/20 น.ไทย) ─────────────────
const hoursSrc = grab(WK, 'const KEY_EXPORT_UTC_HOURS', ';');
check('มี KEY_EXPORT_UTC_HOURS ประกาศอยู่', !!hoursSrc);
if (hoursSrc) {
  const ctx = {}; vm.createContext(ctx);
  // vm ไม่ผูก top-level const เข้ากับ context object (แค่ var/function ผูก) —
  // แปลงเป็น var เฉพาะตอนรันทดสอบ ไม่แตะไฟล์จริง
  vm.runInContext(hoursSrc.replace(/^const /, 'var '), ctx);
  const hours = ctx.KEY_EXPORT_UTC_HOURS;
  check('เป็น UTC 4 ค่า [5,8,10,13]', Array.isArray(hours) && hours.join(',') === '5,8,10,13',
    JSON.stringify(hours));
  const thaiHours = (hours || []).map(h => (h + 7) % 24);
  check('แปลงเป็นเวลาไทยได้ตรง 12:00/15:00/17:00/20:00 พอดี',
    thaiHours.join(',') === '12,15,17,20', JSON.stringify(thaiHours));
  check('ทุกชั่วโมงอยู่ในช่วง cron เดิม 2-15 UTC (ไม่ต้องเพิ่ม trigger ใหม่)',
    hours.every(h => h >= 2 && h <= 15));
}
check('scheduled() เช็ค KEY_EXPORT_UTC_HOURS.includes(...) ก่อนยิง export',
  /KEY_EXPORT_UTC_HOURS\.includes\(at\.getUTCHours\(\)\)/.test(WK));
check('ใช้ gate เดียวกับ sweepExpiredAudio (นาที < 5 กันยิงซ้ำในหน้าต่างเดิม)',
  /KEY_EXPORT_UTC_HOURS\.includes\(at\.getUTCHours\(\)\)\s*&&\s*at\.getUTCMinutes\(\)\s*<\s*5/.test(WK));
check('เรียกผ่าน cfCtx.waitUntil (ไม่บล็อก response ปกติของ worker)',
  /cfCtx\.waitUntil\(exportKeySkusToSheet\(env\)/.test(WK));
check('มี .catch กันพังทั้ง scheduled() ถ้า export ล้ม',
  /exportKeySkusToSheet\(env\)\.catch\(/.test(WK));

// ── 3. ไม่เพิ่ม storage ใน Supabase — reuse key_skus_export_state แถวเดียว ──
check('ไม่มี sbInsert เข้า key_skus_export_state (ต้องไม่มี event log โต)',
  !/sbInsert\(env,\s*['"]key_skus_export_state['"]/.test(WK));
check('อัปเดตแถว id=1 เดิมด้วย sbPatch เท่านั้น (ไม่สร้างแถวใหม่)',
  /sbPatch\(env,\s*['"]key_skus_export_state['"],\s*['"]id=eq\.1['"]/.test(WK));
check('เขียนแค่คอลัมน์ last_exported_at (ไม่แตะ dirty/attempts ที่ไม่จำเป็นแล้ว)',
  /\{\s*last_exported_at:\s*now\.toISOString\(\)\s*\}/.test(WK));

// ── 4. อ่าน key_skus แบบมี cap (กันดึงมาไม่จำกัดถ้าข้อมูลโตในอนาคต) ────────
check('query key_skus มี limit ป้องกันไม่ให้โตไม่จำกัด',
  /key_skus\?status=eq\.active[\s\S]{0,200}limit=\d+/.test(WK));
check('filter เฉพาะ status=active (ไม่ดึงแถว removed ที่เก็บไว้เป็น audit trail)',
  /key_skus\?status=eq\.active/.test(WK));

// ── 5. secrets ใหม่ต้อง optional-guard ไม่ทำ endpoint อื่นพัง ─────────────
check('exportKeySkusToSheet guard 3 secret ใหม่ก่อนทำงาน (ข้ามเงียบถ้ายังไม่ตั้ง)',
  /!env\.GOOGLE_SA_CLIENT_EMAIL\s*\|\|\s*!env\.GOOGLE_SA_PRIVATE_KEY\s*\|\|\s*!env\.GOOGLE_SHEETS_SPREADSHEET_ID/.test(WK));
check('wrangler.toml comment อัปเดตแล้วว่ามี 3 secret ใหม่ (กันบุชงงตอน secret put)',
  /GOOGLE_SA_CLIENT_EMAIL/.test(TOML) && /GOOGLE_SA_PRIVATE_KEY/.test(TOML) &&
  /GOOGLE_SHEETS_SPREADSHEET_ID/.test(TOML));

console.log('── JWT/Sheets helper — ฟังก์ชันล้วน (ทดสอบด้วยค่าจริงได้ไม่ต้องมีเน็ต) ──');

// ── 6. ดึงฟังก์ชัน pure มารันทดสอบจริงใน vm (ไม่ต้องมี secret/เน็ตจริง) ────
const helperSrc = [
  grab(WK, 'function _b64urlFromBytes', '\n}\n'),
  grab(WK, 'function _b64urlJson', '\n}\n'),
  grab(WK, 'function _pemToDer', '\n}\n'),
  grab(WK, 'function _keyExportThaiStamp', '\n}\n')
].filter(Boolean).join('\n');
check('ดึง helper ครบทั้ง 4 ฟังก์ชัน', helperSrc.split('function ').length - 1 === 4);

if (helperSrc.split('function ').length - 1 === 4) {
  const ctx = { btoa: b => Buffer.from(b, 'binary').toString('base64'), atob: b => Buffer.from(b, 'base64').toString('binary') };
  vm.createContext(ctx);
  vm.runInContext(helperSrc, ctx);

  // _b64urlJson: ต้องไม่มี +, /, = เหลือ (URL-safe จริง) และ decode กลับได้ค่าเดิม
  const encoded = ctx._b64urlJson({ alg: 'RS256', typ: 'JWT' });
  check('_b64urlJson ให้ base64url จริง (ไม่มี +, /, =)', !/[+/=]/.test(encoded), encoded);
  const decoded = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  check('_b64urlJson decode กลับได้ object เดิม', decoded.alg === 'RS256' && decoded.typ === 'JWT');

  // _b64urlFromBytes: เช่นกัน ต้อง URL-safe และ round-trip ได้
  const bytes = new Uint8Array([0xff, 0x00, 0x10, 0x3e, 0x3f]); // ค่าที่ทำให้เกิด +,/,= ใน base64 มาตรฐานแน่ๆ
  const encB = ctx._b64urlFromBytes(bytes);
  check('_b64urlFromBytes ไม่มี +, /, = หลงเหลือ', !/[+/=]/.test(encB), encB);

  // _pemToDer: ต้องตัด header/footer/newline แล้ว decode เป็น bytes ได้ยาวตรง
  const fakeDer = Buffer.from('hello-der-bytes-1234567890');
  const fakePem = `-----BEGIN PRIVATE KEY-----\n${fakeDer.toString('base64')}\n-----END PRIVATE KEY-----\n`;
  const der = ctx._pemToDer(fakePem);
  check('_pemToDer ตัด PEM header/footer ออกและ decode ความยาวตรง',
    der.length === fakeDer.length, `ได้ ${der.length} ต้องการ ${fakeDer.length}`);
  check('_pemToDer decode เนื้อหาตรง byte-ต่อ-byte',
    Buffer.from(der).equals(fakeDer));

  // _keyExportThaiStamp: 05:00 UTC ต้องกลายเป็น 12:00 น.ไทย (offset +7 คงที่)
  const stamp = ctx._keyExportThaiStamp(new Date('2026-08-16T05:00:00Z'));
  check('_keyExportThaiStamp บวก 7 ชม.ถูกต้อง (05:00 UTC → 12:00 น.)',
    stamp === '16/08/2026 12:00 น.', stamp);
  const stampWrap = ctx._keyExportThaiStamp(new Date('2026-08-16T20:00:00Z')); // ข้ามเที่ยงคืนไทย
  check('_keyExportThaiStamp ข้ามวันถูกต้อง (20:00 UTC → 03:00 น. วันถัดไป)',
    stampWrap === '17/08/2026 03:00 น.', stampWrap);
}

console.log(`\n${pass} ผ่าน, ${fail} ล้มเหลว`);
process.exit(fail ? 1 : 0);
