#!/usr/bin/env node
// tools/verify_pwa_fixes.js — v260 (2026-08-14)
//
// ล็อกการแก้ 3 บั๊ก PWA (บั๊กที่ 4 คือ auto-logout อยู่ใน verify_boot_recovery.js):
//
//   1. จอขาว Echo — showScreen กวาด .scr ทั้ง document รวมถึงจอภายใน
//      #ci-fullsheet → boot route ที่หน่วงเวลา (fallbackTimer 3.2s) ถอด .on
//      ของ ci-s-record ตอน user เพิ่งเปิด Echo = overlay ขาวเปล่าค้างถาวร
//      (back ไม่ได้เพราะแอปไม่มี history เลย)
//   2. เช็คอินเงียบ — toast อยู่ z-index 500 ใต้ sheet 9999 = error ทุกตัว
//      มองไม่เห็น + geolocation ค้างได้ไม่มี watchdog + กดรัวยิงซ้อนได้
//   3. pill บังปุ่ม Echo — #data-load-pill ตัวเดียวในแอปที่ไม่บวก
//      env(safe-area-inset-bottom) → ทับแถบเมนู ~24px บน iPhone มี notch
//
// Usage: node tools/verify_pwa_fixes.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KV = fs.readFileSync(path.join(__dirname, '..', 'src', '05_kam_view.js'), 'utf8');
const CI = fs.readFileSync(path.join(__dirname, '..', 'src', '09_conv_intel.js'), 'utf8');
const CSS_BASE = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles_base.css'), 'utf8');
const CSS_LAYOUT = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles_layout.css'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('\n── 1. จอขาว Echo: sweep ต้องไม่แตะจอใน #ci-fullsheet ──');

const GUARDED = "document.querySelectorAll('.scr').forEach(s=>{if(!s.closest('#ci-fullsheet'))s.classList.remove('on');});";
const BARE = "document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));";

check('sweep แบบมี guard มีครบทั้ง 2 จุด (KAM-sense route + จุดหลัก)',
  KV.split(GUARDED).length - 1 === 2,
  'เจอ ' + (KV.split(GUARDED).length - 1) + ' จุด');

check('ไม่เหลือ sweep แบบเปลือย (กวาดทั้ง document) แม้แต่จุดเดียว',
  !KV.includes(BARE),
  'sweep เปลือยแม้จุดเดียวก็พาจอขาวกลับมา');

// รันของจริง: จำลอง element 3 ตัว — จอแอปหลัก 2, จอใน Echo sheet 1
{
  const mk = (insideSheet) => ({
    closest: (sel) => (sel === '#ci-fullsheet' && insideSheet) ? {} : null,
    classList: { on: true, remove() { this.on = false; } },
  });
  const els = [mk(false), mk(false), mk(true)];
  const ctx = { document: { querySelectorAll: () => els } };
  vm.createContext(ctx);
  vm.runInContext(GUARDED, ctx);
  check('รัน: จอแอปหลักโดนกวาด (พฤติกรรมเดิมคงอยู่)',
    !els[0].classList.on && !els[1].classList.on);
  check('รัน: จอใน Echo sheet รอด (.on ยังอยู่)',
    els[2].classList.on === true,
    'ถ้าโดนกวาด = จอขาวกลับมา');
}

console.log('\n── 2. เช็คอินเงียบ: error ต้องมองเห็น + ไม่ค้าง + ไม่ยิงซ้อน ──');

// toast ต้องลอยเหนือ Echo sheet (9999) และ session detail (10001)
{
  const m = CSS_BASE.match(/\.toast\{[^}]*z-index:(\d+)/);
  check('.toast z-index สูงกว่า overlay ทุกตัวของ Echo (>10001)',
    !!m && parseInt(m[1], 10) > 10001,
    'ได้ ' + (m ? m[1] : 'ไม่เจอ') + ' — ต่ำกว่านี้ = error ถูกบังเหมือนเดิม');
}

check('มี in-flight guard กันกดรัว (_checkinBusy) และปลดใน finally',
  /let _checkinBusy = false/.test(CI)
  && /if \(_checkinBusy\) return;/.test(CI)
  && /finally \{\s*_checkinBusy = false;\s*\}/.test(CI));

check('มี watchdog ครอบ geolocation (Promise.race + 25000ms)',
  /Promise\.race\(/.test(CI) && /reject\(\{ code: 'stuck' \}\), 25000\)/.test(CI),
  'timeout:10000 ของ geolocation ไม่นับช่วง permission prompt — ไม่มี watchdog = ค้างเงียบ');

check('มีข้อความเฉพาะสำหรับเคส watchdog (stuck)',
  /e\.code === 'stuck'/.test(CI));

check('เคสโดนปฏิเสธสิทธิ์ (code 1) บอกวิธีเปิดสิทธิ์ในตั้งค่ามือถือ',
  /มือถือไม่ให้สิทธิ์ตำแหน่ง/.test(CI) && /อนุญาตตำแหน่ง/.test(CI));

check('error เขียนลง hint ใต้ปุ่ม (ไม่พึ่ง toast อย่างเดียว) และคาไว้ให้อ่านทัน',
  /hint\.textContent = msg;\s*\n\s*hint\.dataset\.mode = 'checkin';/.test(CI) &&
  /\}, 8000\);/.test(CI),
  'เดิม catch รีเซ็ต hint เป็น "กดเพื่อเช็คอิน" ทันที = เหมือนไม่มีอะไรเกิดขึ้น');

console.log('\n── 3. pill บังปุ่ม Echo: #data-load-pill ต้องเผื่อ notch ──');

{
  const m = CSS_LAYOUT.match(/#data-load-pill\{[^}]*bottom:([^;]+);/);
  check('#data-load-pill bottom บวก env(safe-area-inset-bottom)',
    !!m && m[1].includes('env(safe-area-inset-bottom'),
    'ได้ ' + (m ? m[1] : 'ไม่เจอ'));
  check('ระยะฐาน ≥ 96px (พ้นแถบเมนูทั้งเครื่องมี/ไม่มี notch)',
    !!m && /\+\s*9[6-9]px|\+\s*1\d\dpx/.test(m[1]));
}

// ── v_updatepill (2026-08-25): การ์ดชวนอัปเดต ───────────────────────────────
// บุชขอให้ "น่ากด" และ "น้องๆ ต้องรู้สึกปลอดภัยพอที่จะกด"
// ของเดิมเป็นแถบเล็กเขียนแค่ "แตะเพื่ออัปเดต" ซึ่งไม่ตอบสิ่งที่คนลังเลจริง 3 ข้อ
// ข้อความบนการ์ดคือ "สัญญา" กับผู้ใช้ — ถ้าโค้ดเปลี่ยนจนไม่จริง ต้องแก้ข้อความด้วย
const sh = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell.html'), 'utf8');
const pillFn = (sh.match(/function _showUpdatePill\(\)\{[\s\S]*?\n          \}/) || [''])[0];

check('การ์ดตอบครบ 3 ข้อที่คนลังเลก่อนกด (เร็ว · ไม่หลุดล็อกอิน · ข้อมูลไม่หาย)',
  /2 วินาที/.test(pillFn) && /ไม่ต้องล็อกอินใหม่/.test(pillFn) && /ข้อมูลไม่หาย/.test(pillFn));

check('สัญญา "ไม่ต้องล็อกอินใหม่/ข้อมูลไม่หาย" เป็นจริง — ทางกดอัปเดตห้ามล้าง storage/signOut',
  !/signOut|localStorage\.clear|sessionStorage\.clear|caches\.delete/.test(pillFn));

check('ยังปักธงผู้ใช้กดเอง ก่อนส่ง SKIP_WAITING (ไม่งั้น controllerchange ไม่ reload)',
  (() => {
    const f = pillFn.indexOf('_senseUserRequestedUpdate = true');
    const m = pillFn.indexOf("postMessage('SKIP_WAITING')", f);
    return f > -1 && m > f;
  })());

check('กดแล้วมีสถานะกำลังทำ ไม่ปล่อยให้กดรัว',
  /go\.disabled\s*=\s*true/.test(pillFn) && /กำลังอัปเดต/.test(pillFn));

check('มีตาข่ายถ้าอัปเดตไม่คืบใน 6 วิ — ไม่ปล่อยวงหมุนค้างตลอดกาล',
  /},6000\);/.test(pillFn) && /location\.reload\(\)/.test(pillFn));

check('ปฏิเสธด้วยปุ่มข้อความ ไม่ใช่กากบาทเล็กที่กดพลาดง่าย',
  /sense-update-later/.test(pillFn) && /ไว้ทีหลัง/.test(pillFn) &&
  !/sense-update-x/.test(pillFn));

check('การ์ดระบุสีเองทั้งหมด ไม่ยืม token ของแอป (เคยออกมาขาวโพลนบนแอปสีเขียวเข้ม)',
  !/var\(--surface|var\(--ink-1|var\(--ok-dim|var\(--border/.test(pillFn));

check('เคารพ prefers-reduced-motion',
  /prefers-reduced-motion/.test(pillFn));


console.log('\n' + (fail ? `❌ verify_pwa_fixes: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_pwa_fixes: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
