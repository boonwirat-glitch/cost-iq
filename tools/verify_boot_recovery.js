#!/usr/bin/env node
// tools/verify_boot_recovery.js — v_bootnet (2026-08-11)
//
// ล็อกว่า Sense "ไม่มีทางค้างหน้า loading ถาวร" ไม่ว่า auth จะพังแบบไหน
//
// ทำไมต้องมี: บุชเจอ (2026-08-11) เปิด PWA บน iPhone หลังพักจอหลายชั่วโมง/หลายวัน
// แล้วค้างที่หน้าโลโก้ ดาวนิ่งสนิท ต้อง kill app ทุกครั้ง
//   สิ่งที่เห็นคือ "ผ้าคลุม boot" ใน shell.html ที่โชว์ splash แบบ synchronous
//   จากการเจอคีย์ sb-*-auth-token ใน localStorage (โทเคนหมดอายุก็ผ่าน) แล้ว
//   ไม่มีตัวจับเวลาปิดตัวเองเลย · ทางที่จะปิดผ้าคลุมได้ทั้งหมดอยู่หลัง
//   `await supa.auth.getSession()` ซึ่งไม่มี timeout และคืน null ได้ด้วย
//   ตาข่ายที่มีอยู่เดิมติดเงื่อนไขจนไม่ยิงสักอัน (SIGNED_OUT ผูก currentUser,
//   watchdog ผูก error count) → ค้างถาวร
//
// กติกาที่ล็อกไว้ในนี้:
//   1. ผ้าคลุม boot ต้องมี watchdog ปลดตัวเองได้โดยไม่พึ่ง JS หลัก
//   2. ทุก call site ของ getSession()/loadUserProfile() บนเส้นทาง boot ต้องมีเพดานเวลา
//   3. "ไม่มี session" ต้องเด้งหน้า login จริง (ไม่ใช่แค่ถอด class)
//   4. SIGNED_OUT ต้องทำงานตอน cold boot ที่ currentUser ยังเป็น null
//   5. csvOpen ต้องไม่ค้าง ไม่งั้น loadFromCloudflareR2 ไม่เคยถูกเรียก
//
// Usage: node tools/verify_boot_recovery.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const shell = read('src/shell.html');
const core  = read('src/01_core.js');
const sku   = read('src/04_sku_matcher.js');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

// ── ตัดคอมเมนต์ออกก่อนตรวจ ─────────────────────────────────────────────────
// ไฟล์พวกนี้เต็มไปด้วยคอมเมนต์ที่ "เล่า" โค้ดเก่าที่ลบไปแล้ว (เช่น บล็อกอธิบาย
// installServiceWorkerUpdateGuard ที่ถูกถอดออก) ถ้าไม่ตัดทิ้ง regex จะไปเจอ
// ข้อความในคอมเมนต์แล้วรายงานผ่านทั้งที่โค้ดจริงไม่มี
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
const shellC = stripComments(shell);
const coreC  = stripComments(core);
const skuC   = stripComments(sku);

console.log('── Sense boot ต้องไม่ค้างถาวร ──');

// ── 1. ผ้าคลุม boot ต้องปลดตัวเองได้ ────────────────────────────────────────
console.log('\n[src/shell.html] — ผ้าคลุม boot');

check('ผ้าคลุมมี watchdog ปลดตัวเอง (_senseBootCoverWatchdog)',
  /_senseBootCoverWatchdog/.test(shellC),
  'ต้องมี setTimeout ในสคริปต์ผ้าคลุมเอง ไม่พึ่ง JS หลักที่อาจไม่มีวันรัน');

check('watchdog คืนหน้า login + ซ่อน splash เมื่อหมดเวลา',
  /_senseReleaseBootCover/.test(shellC) &&
  /_senseReleaseBootCover[\s\S]{0,900}?login\.style\.display\s*=\s*''/.test(shellC) &&
  /_senseReleaseBootCover[\s\S]{0,900}?splash\.style\.display\s*=\s*'none'/.test(shellC),
  'ฟังก์ชันปลดต้องทั้งคืน login-overlay และซ่อน sense-splash');

check('watchdog ยอมถอยเมื่อ JS หลักรับช่วงต่อแล้ว (__senseBootTookOver)',
  /__senseBootTookOver/.test(shellC),
  'ไม่งั้นจะไปแทรกกลางทางตอนแอปกำลังเข้าปกติ');

// ── 2. watchdog ของ Sentinel ต้องยิงได้โดยไม่ต้องรอ error ──────────────────
// ของเดิม: if(_count>0 && currentUser && !allCriticalReady()) — promise ที่ค้าง
// ไม่โยน error (_count=0) และ currentUser ก็ยัง null → เงื่อนไขไม่มีวันเป็นจริง
const sentinelBlock = (shellC.match(/boot watchdog[\s\S]{0,1400}/) || [''])[0];
check('boot watchdog ไม่ผูกกับจำนวน error อีกต่อไป',
  !/_count\s*>\s*0\s*&&[\s\S]{0,200}currentUser/.test(shellC),
  'promise ที่ค้างไม่โยน error → เงื่อนไข _count>0 ทำให้ watchdog ตายสนิท');

check('boot watchdog ดูจาก "จอค้างอยู่จริงไหม" แทน',
  /sense-splash[\s\S]{0,400}lgi-checking|lgi-checking[\s\S]{0,400}sense-splash/.test(
    (shellC.match(/window\.addEventListener\('load'[\s\S]{0,1500}/) || [''])[0]),
  'ต้องเช็คว่า splash หรือ lgi-checking ยังโชว์อยู่ตอนหมดเวลา');

// ── 3. ทุก await ที่กั้น boot ต้องมีเพดานเวลา ───────────────────────────────
console.log('\n[src/01_core.js] — เพดานเวลาของ auth');

check('มี helper _withTimeout',
  /function _withTimeout\s*\(/.test(coreC),
  'ต้องคืนค่า sentinel แทน reject — กัน unhandled rejection');

// ทุกบรรทัดที่เรียก getSession() ต้องถูกครอบ ไม่เว้นสักจุด
const gsLines = coreC.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(o => /supa\.auth\.getSession\(\)/.test(o.l));
const gsBare = gsLines.filter(o => !/_withTimeout\s*\(/.test(o.l));
check('getSession() ทุก call site ถูกครอบ timeout (' + gsLines.length + ' จุด)',
  gsLines.length >= 5 && gsBare.length === 0,
  gsBare.length
    ? 'ยังเปลือยอยู่ที่บรรทัด ' + gsBare.map(o => o.n).join(', ')
    : 'หา call site ไม่เจอ — regex อาจล้าสมัย');

// loadUserProfile ที่ "กั้นหน้าจอ" = ตัวที่ await หรือ .then แล้วค่อย hideLoginOverlay
// (การเรียกแบบ fire-and-forget เพื่อ revalidate เบื้องหลังไม่กั้นอะไร ไม่ต้องครอบ)
const lupBare = coreC.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(o => /await\s+loadUserProfile\(\)|loadUserProfile\(\)\s*\.then/.test(o.l));
const lupWrapped = (coreC.match(/_withTimeout\(\s*loadUserProfile\(\)/g) || []).length;
check('loadUserProfile() ที่กั้นหน้าจอถูกครอบ timeout (ครอบ ' + lupWrapped + ' จุด)',
  lupBare.length === 0 && lupWrapped >= 3,
  lupBare.length
    ? 'ยังเปลือยอยู่ที่บรรทัด ' + lupBare.map(o => o.n).join(', ')
    : 'ต้องครอบอย่างน้อย 3 จุด: checkSession · onAuthStateChange · doLogin');

// คิวรี profiles ข้างในต้องมีเพดานของตัวเอง ไม่งั้น currentUserProfile ค้างเป็น null
check('คิวรี profiles มีเพดานเวลาชั้นใน (fallback profile จึงถูกสร้าง)',
  /_withTimeout\([\s\S]{0,200}from\('profiles'\)/.test(coreC),
  'เพดานชั้นนอกอย่างเดียวไม่พอ — จะข้าม branch ที่ปั้น profile ขั้นต่ำไป');

// ── 4. "ไม่มี session" ต้องเด้งหน้า login จริง ──────────────────────────────
console.log('\n[src/01_core.js] — เส้นทางพัง');

const csBlock = (coreC.match(/async function checkSession\(\)[\s\S]*?\n\}/) || [''])[0];
check('checkSession: เส้นทาง "ไม่มี session" เรียก _showLoginOverlayClean',
  /_showLoginOverlayClean\(\)/.test(csBlock),
  'ov.classList.remove(\'lgi-checking\') เฉยๆ เอาชนะ inline display:none ของผ้าคลุมไม่ได้');

check('checkSession: บล็อก catch ก็ต้องเด้งหน้า login',
  (csBlock.match(/_showLoginOverlayClean\(\)/g) || []).length >= 2,
  'ต้องมีทั้ง branch ปกติและ catch');

check('SIGNED_OUT ไม่ผูกกับ currentUser อีกต่อไป',
  !/event === 'SIGNED_OUT' && currentUser/.test(coreC) &&
  !/event\s*===\s*'SIGNED_OUT'\s*&&\s*currentUser/.test(coreC),
  'cold boot มี currentUser = null เสมอ → สาขานี้ถูกข้าม → ไม่มีใครปิดผ้าคลุม');

check('SIGNED_OUT ตอนยังไม่มี currentUser ต้องเด้งหน้า login ทันที',
  /SIGNED_OUT[\s\S]{0,700}?!currentUser[\s\S]{0,300}?_showLoginOverlayClean\(\)/.test(coreC),
  'ไม่มี session ให้กู้ = ไม่ต้องรอ grace');

// ── 5. ธงบอกว่า JS หลักรับช่วงต่อแล้ว ต้องปักครบทุกจุดที่ปิด splash ได้ ────
console.log('\n[src/01_core.js] — ธงรับช่วงต่อ');

const tookOver = (coreC.match(/__senseBootTookOver\s*=\s*true/g) || []).length;
check('ปัก __senseBootTookOver ครบ 4 จุดที่ปิด splash ได้จริง (เจอ ' + tookOver + ')',
  tookOver >= 4,
  'showSenseSplash · _showLoginOverlayClean · skip-splash branch · showPasswordResetForm');

// ── 6. IndexedDB ต้องไม่ค้างเงียบ ───────────────────────────────────────────
console.log('\n[src/04_sku_matcher.js] — IndexedDB');

const csvOpenBlock = (skuC.match(/function csvOpen\(\)[\s\S]*?\n  \}/) || [''])[0];
check('csvOpen มี onblocked',
  /onblocked/.test(csvOpenBlock),
  'IDB ที่ถูก block จะไม่ resolve และไม่ reject — เงียบสนิท');

check('csvOpen มีเพดานเวลา',
  /setTimeout/.test(csvOpenBlock),
  'ถ้าค้าง _preloadFromIndexedDB ไม่ resolve → loadFromCloudflareR2() ไม่เคยถูกเรียก');

console.log('\n' + (fail ? '❌' : '✅') +
  ' verify_boot_recovery: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);

// ── v_authfix (2026-08-14): "ไม่รู้" ≠ "ล็อกเอาต์" ──────────────────────────
// v256 ทำ auto-logout ทุกครั้งที่พักจอ: timeout/error ของ getSession ถูกแปลง
// เป็น null ซึ่งเป็นค่าเดียวกับ "ยืนยันว่าไม่มี session" · เส้น resume จึงเดิน
// เข้า branch "confirmed session lost" ทั้งที่ Supabase ไม่เคยตอบอะไรเลย
console.log('\n[v_authfix] แยก "ไม่รู้" ออกจาก "ล็อกเอาต์แล้ว"');
{
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', '01_core.js'), 'utf8');
  check('มี AUTH_UNKNOWN sentinel ที่ data เป็น null (caller เดิมอ่านเป็น falsy เหมือน null)',
    /const AUTH_UNKNOWN = Object\.freeze\(\{ __authUnknown: true, data: null \}\)/.test(core));
  check('_withTimeout คืน AUTH_UNKNOWN ทั้งกรณี error และ timeout (ไม่ใช่ null)',
    (core.match(/return AUTH_UNKNOWN|resolve\(AUTH_UNKNOWN\)/g) || []).length === 2);
  check('resume check: รอบแรกตอบไม่ได้ → return true (ไม่รบกวนผู้ใช้)',
    /_authUnknown\(first\)[\s\S]{0,200}return true/.test(core));
  check('resume check: รอบสองตอบไม่ได้ → return true เช่นกัน',
    /_authUnknown\(second\)[\s\S]{0,200}return true/.test(core));
  check('branch "confirmed session lost" อยู่หลังการเช็ค unknown ทั้งสองรอบ',
    core.indexOf("'[pwa:v206a] confirmed session lost") > core.indexOf('_authUnknown(second)'));
  check('SIGNED_OUT recovery: unknown → ไม่เด้งผู้ใช้ออก',
    /_authUnknown\(_sr\)[\s\S]{0,300}return;/.test(core));

  // รันจริง: AUTH_UNKNOWN ต้อง falsy เมื่ออ่านแบบ caller เดิม
  const vm2 = require('vm');
  const ctx2 = {};
  vm2.createContext(ctx2);
  vm2.runInContext(core.slice(core.indexOf('const AUTH_UNKNOWN'), core.indexOf('function _withTimeout')) + '\nthis.U=AUTH_UNKNOWN;this.f=_authUnknown;', ctx2);
  check('รัน: U && U.data && U.data.session ประเมินเป็น falsy (caller เดิมไม่พัง)',
    !(ctx2.U && ctx2.U.data && ctx2.U.data.session));
  check('รัน: _authUnknown แยกได้ถูก (true กับ sentinel, false กับ null และ response จริง)',
    ctx2.f(ctx2.U) === true && ctx2.f(null) === false && ctx2.f({ data: { session: null } }) === false);
}

// ── v_bootauth (2026-08-20): checkSession() (cold boot) ก็ต้องแยก "ไม่รู้" ด้วย ──
// v_authfix ข้างบนแก้แค่ _pwaSilentSessionCheck (แอปยังไม่ถูกฆ่า แค่พักจอ) —
// checkSession() คือเส้น "เปิด PWA ใหม่หลังถูกฆ่า" ซึ่งเกิดบ่อยกว่ามาก (iOS ฆ่า
// WKWebView เบื้องหลังได้ทุกเมื่อ) เดิม timeout ครั้งแรกแปลงเป็น null แล้วเด้ง
// login ทันที ทั้งที่ token ใน localStorage อาจยังดีอยู่ครบ
console.log('\n[v_bootauth] checkSession() (cold boot) ก็ต้องลองซ้ำก่อนเด้ง login');
{
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', '01_core.js'), 'utf8');
  const csBlock2 = (core.match(/async function checkSession\(\)[\s\S]*?\n\}/) || [''])[0];
  check('checkSession: รอบแรกตอบไม่ได้ (unknown) → ลองรอบสองก่อน ไม่เด้ง login ทันที',
    /let _cs = await _withTimeout\(supa\.auth\.getSession\(\), SENSE_AUTH_TIMEOUT_MS, 'getSession\(boot-1\)'\);\s*\n\s*if \(_authUnknown\(_cs\)\) \{/.test(csBlock2));
  check('checkSession: รอบสองมี grace delay ก่อนยิงซ้ำ (ให้เวลาวิทยุมือถือตื่น)',
    /setTimeout\(r, 2500\)/.test(csBlock2) && /getSession\(boot-2\)/.test(csBlock2));
  check('checkSession: unknown ทั้งสองรอบแล้วค่อยตกไปเส้นทาง login (ไม่ใช่รอบแรกรอบเดียว)',
    csBlock2.indexOf("getSession(boot-2)") > csBlock2.indexOf("getSession(boot-1)") &&
    csBlock2.indexOf('_showLoginOverlayClean()') > csBlock2.indexOf("getSession(boot-2)"));
}

process.exit(fail ? 1 : 0);
