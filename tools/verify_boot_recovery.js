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

// v_bootauth2 (2026-08-25): ข้อนี้เคยเขียนว่า "ต้องเด้ง login ทันที" ซึ่งตอนนั้นถูก
// (แก้อาการผ้าคลุม boot ค้างถาวร) แต่เร็วเกินไป — หลักฐานจาก auth.refresh_tokens
// ของบุช: token ต่ออายุสำเร็จ แต่แอปเด้ง login ไปแล้วก่อนหน้านั้นเสี้ยววินาที
// เจตนาใหม่: ยังต้อง "จบที่หน้า login เสมอถ้าไม่มี session จริง" แต่ห้ามตัดสินทันที
check('SIGNED_OUT ตอนยังไม่มี currentUser ต้องจบที่หน้า login ถ้ายืนยันแล้วว่าไม่มี session',
  // ยึดจากสาขา SIGNED_OUT แล้วเทียบ "ลำดับ" ไม่ใช่ระยะห่างตัวอักษร —
  // การนับ char พังมาหลายรอบแล้ว และ `if (!currentUser) {` มีหลายที่ในไฟล์
  (() => {
    const so = coreC.indexOf("event === 'SIGNED_OUT'");
    if (so < 0) return false;
    const guard = coreC.indexOf('if (!currentUser) {', so);
    const timer = coreC.indexOf('_bootSignedOutTimer', guard);
    const recheck = coreC.indexOf('getSession(boot-signedout)', timer);
    const login = coreC.indexOf('_showLoginOverlayClean()', recheck);
    return guard > so && timer > guard && recheck > timer && login > recheck;
  })(),
  'ต้องมีทั้งการถามซ้ำ และปลายทางที่เด้ง login จริงเมื่อยืนยันแล้ว');

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

// ── v_quotaguard (2026-08-21): 402 (เกินโควตา) ต้องไม่ถูกอ่านว่า "ไม่มีสิทธิ์" ──
// AUTH_UNKNOWN เดิมครอบแค่ความเงียบ (reject/timeout) · 402 ตอบเร็วและครบรูปแบบ
// getSession() จึง resolve เป็น {data:{session:null},error} ⇒ เด้งผู้ใช้ออกทั้ง 3 ทาง
// แล้วล็อกอินกลับก็ 402 อีก = ทั้งบริษัทเข้าไม่ได้
console.log('\n[v_quotaguard] 402/429/5xx = "ตอบไม่ได้" ไม่ใช่ "ไม่มีสิทธิ์"');
{
  const vm = require('vm');
  const i = core.indexOf('function _authUnknown(v){');
  let d = 0, started = false, j = i;
  for (; j < core.length; j++) {
    if (core[j] === '{') { d++; started = true; }
    else if (core[j] === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(core.slice(i, j) + '\nthis.f = _authUnknown;', ctx);
  const u = ctx.f;
  const res = (status) => u({ data: { session: null }, error: { status, message: 'x' } });

  check('402 (เกินโควตา) = ไม่รู้ → เก็บ session ไว้ ไม่เด้งออก', res(402) === true);
  check('429 (ถูกจำกัดอัตรา) = ไม่รู้', res(429) === true);
  check('500/503 (ฝั่งเขาล่ม) = ไม่รู้', res(500) === true && res(503) === true);
  check('408 (timeout) = ไม่รู้', res(408) === true);
  check('⚠ 401/403 = ยืนยันว่าไม่มีสิทธิ์จริง → ต้องเด้งออกตามปกติ',
    res(401) === false && res(403) === false,
    'ถ้าเหมารวมด้วย จะไม่มีวันเด้งผู้ใช้ออกเลยแม้ session หมดอายุจริง');
  check('400 (invalid refresh token) = ยืนยันจริง → เด้งออก', res(400) === false);
  check('ไม่มี error เลย = ยืนยันว่าไม่มี session → เด้งออกตามปกติ',
    u({ data: { session: null }, error: null }) === false);
  check('sentinel AUTH_UNKNOWN เดิมยังทำงาน', u({ __authUnknown: true, data: null }) === true);
  check('ข้อความแบบ network error ก็ถือว่าไม่รู้',
    u({ error: { message: 'Failed to fetch' } }) === true);
}

console.log('\n[v_quotaguard] เข้าโหมดดูอย่างเดียวแทนการปิดประตูใส่หน้า');
// v_quotaguard2 (2026-08-21): 24 ชม. → 7 วัน · ถ้าถูกตัดจริง 22 ส.ค. ถึงโควตารีเซ็ต
// 2 ก.ย. คือ 11 วัน — 24 ชม. ทำให้เสาร์-อาทิตย์เดียวก็เข้าไม่ได้แล้ว
check('กุญแจสำรองหมดอายุ 7 วัน (ครอบช่วงที่ถูกตัดจนโควตารีเซ็ต) และเช็ค TTL จริง',
  /const _LAST_ID_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000;/.test(core) &&
  /Date\.now\(\) - o\.savedAt > _LAST_ID_TTL_MS/.test(core));

// ── /nrr ต้องรอดด้วย — เดิมไม่มีทางถอยเลย และ signOut() ทิ้งเมื่ออ่าน profiles ไม่ได้
console.log('\n[v_quotaguard] /nrr ก็ต้องเข้าได้แบบดูอย่างเดียว');
{
  const nrrCore = read('src/nrr/nrr_core.js');
  check('/nrr แยก 402/429/5xx ออกจาก "ไม่มีสิทธิ์" เหมือน Sense',
    /function nrrAuthUnknown\(resp\)/.test(nrrCore) &&
    /st === 402 \|\| st === 408 \|\| st === 429 \|\| \(st >= 500 && st <= 599\)/.test(nrrCore));
  check('/nrr จำสิทธิ์ล่าสุด 7 วัน และรับแต่ role ที่มีสิทธิ์จริง',
    /NRR_LAST_ID_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(nrrCore) &&
    /if \(!NRR_ALLOWED_ROLES\.includes\(o\.role\)\) return null;/.test(nrrCore));
  check('/nrr: getSession ไม่ได้เพราะตอบไม่ได้ → ลองโหมดดูอย่างเดียวก่อนปิดประตู',
    /else if \(!\(nrrAuthUnknown\(sessionResp\) && nrrEnterReadOnly\('getSession'\)\)\) nrrShowAuth\(\);/.test(nrrCore));
  check('/nrr: อ่าน profiles ไม่ได้ ต้องไม่ signOut ทิ้ง (เดิมล็อกอินกลับไม่ได้เลย)',
    (() => {
      const iGuard = nrrCore.indexOf('if (!profile && nrrAuthUnknown(profResp))');
      const iSignOut = nrrCore.indexOf('await supa.auth.signOut();', iGuard);
      return iGuard > -1 && iSignOut > iGuard;
    })(), 'การ์ดต้องมาก่อน signOut ไม่งั้น 402 จะถูกอ่านเป็น "ไม่มีสิทธิ์"');
  check('/nrr: ไม่มีสิทธิ์จริง = ล้างสิทธิ์ที่จำไว้ด้วย (ไม่เหลือทางเข้า)',
    /nrrLastIdentityClear\(\);   \/\/ ไม่มีสิทธิ์จริง/.test(nrrCore));
  check('/nrr: มีแถบบอกผู้ใช้ว่าอยู่โหมดดูอย่างเดียว ไม่เงียบ',
    /โหมดดูอย่างเดียว/.test(nrrCore) && /window\.NRR_READONLY = true;/.test(nrrCore));
  check('/nrr: nrr.html ที่ส่งจริง build มาแล้ว (ไม่ใช่แก้แต่ src)',
    /function nrrEnterReadOnly\(/.test(fs.readFileSync(path.join(__dirname, '..', 'nrr.html'), 'utf8')));
}
check('บันทึกกุญแจสำรองตอนโหลด profile สำเร็จ',
  /_lastIdentitySave\(currentUser, currentUserProfile\);/.test(core));
check('กดออกจากระบบเองแล้วต้องล้างกุญแจสำรองทิ้ง (ไม่เหลือทางเข้า)',
  /_lastIdentityClear\(\); \/\/ v_quotaguard/.test(core));
check('checkSession: ตอบไม่ได้ 2 รอบ + มีกุญแจสำรอง → เข้าโหมดดูอย่างเดียว ไม่เด้ง login',
  (() => {
    const a = core.indexOf("getSession(boot-2)");
    const bLast = core.indexOf('const _lastId = _lastIdentityGet();', a);
    const bBanner = core.indexOf('_showReadOnlyBanner();', bLast);
    const bLogin = core.indexOf('_showLoginOverlayClean()', bLast);
    return bLast > a && bBanner > bLast && (bLogin === -1 || bBanner < bLogin);
  })());
check('ไม่มีกุญแจสำรอง (เครื่องใหม่/ไม่เคยล็อกอิน) → ยังเด้ง login ตามปกติ',
  /ไม่มีตัวตนที่จำไว้ — เด้ง login/.test(core));
check('แถบเตือนบอกตรงๆ ว่าบันทึกอะไรไม่ได้ ไม่ปล่อยให้เงียบ',
  /โหมดดูอย่างเดียว/.test(core) && /บันทึกอะไรไม่ได้/.test(core) &&
  /window\.SENSE_READONLY = true;/.test(core));

// ── v_offlinecfg: ตั้งค่าคอมต้องรอดตอนหลังบ้านตอบ 402 ──
// ตัวที่จับได้จริงรอบนี้: supabase-js ไม่ throw เวลา 402 มันคืน data:null
// ⇒ `resp.data || []` ทำให้ cache ถูกปั๊ม loaded:true ด้วยตารางเปล่า
// = หน้าคอมโชว์ ฿0 หน้าตาเหมือนเลขจริง · ข้อแรกล็อกไว้ว่าต้องเช็ค error ก่อน
const nrrComm = read('src/nrr/nrr_commission.js');

check('402 ไม่ throw ⇒ ต้องเช็ค resp.error เอง ไม่เชื่อแค่ว่ามี data',
  /if \(resp\.error\) throw new Error\('target_settings/.test(nrrComm) &&
  /if \(respErr\) throw new Error\('commission_plans/.test(nrrComm));

check('โหลดตั้งค่าสำเร็จ = เก็บสำเนาลงเครื่องทั้ง 2 ตาราง',
  /nrrCfgSave\('rates', byKey\);/.test(nrrComm) &&
  /nrrCfgSave\('plans', \{/.test(nrrComm));

check('โหลดไม่ได้ + มีสำเนา → ใช้สำเนา และติดป้าย fromCache',
  /var cached = nrrCfgLoad\('rates'\);/.test(nrrComm) &&
  /var cachedPlans = nrrCfgLoad\('plans'\);/.test(nrrComm) &&
  (nrrComm.match(/fromCache: true/g) || []).length === 2);

check('โหลดไม่ได้ + ไม่มีสำเนา → loaded:false (ห้ามคืน ฿0 เป็นเลขจริง)',
  // เช็คด้วยลำดับ index ไม่ใช่ระยะห่างตัวอักษร — regex แบบนับ char พังมาหลายรอบแล้ว
  (() => {
    const ratesNoCache = nrrComm.includes('{ byKey: {}, loaded: false, error: e.message }');
    const plansNoCache = nrrComm.includes('{ tiersByPlan: {}, assignments: {}, loaded: false, error: e.message }');
    // และขา "ไม่มีสำเนา" ต้องอยู่หลังการลองอ่านสำเนา (คือเป็น fallback จริง)
    const tryRates = nrrComm.indexOf("nrrCfgLoad('rates')");
    const tryPlans = nrrComm.indexOf("nrrCfgLoad('plans')");
    return ratesNoCache && plansNoCache && tryRates > 0 && tryPlans > tryRates &&
      nrrComm.indexOf('{ byKey: {}, loaded: false, error: e.message }') > tryRates &&
      nrrComm.indexOf('{ tiersByPlan: {}, assignments: {}, loaded: false, error: e.message }') > tryPlans;
  })());

check('สำเนามีอายุ ไม่ใช้ของเก่าค้างปี',
  /NRR_CFG_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(nrrComm) &&
  /Date\.now\(\) - o\.at > NRR_CFG_TTL_MS\) return null/.test(nrrComm));

check('บอกผู้ใช้ครั้งเดียวว่าเครื่องนี้จำสิทธิ์ไว้แล้ว (จะได้รู้ว่า arm สำเร็จ)',
  (() => {
    const c = read('src/nrr/nrr_core.js');
    // ต้องประกาศหลังบันทึก identity สำเร็จ ไม่ใช่ก่อน
    const save = c.indexOf('nrrLastIdentitySave(nrrProfile.email');
    const announce = c.indexOf('nrrAnnounceOfflineArmed();', save);
    return save > 0 && announce > save &&
      /localStorage\.setItem\(NRR_ARMED_KEY/.test(c) &&
      // storage ใช้ไม่ได้ = จำไม่ได้ ห้ามโฆษณาว่าพร้อม
      /\} catch \(e\) \{ return; \}/.test(c);
  })());

// ── v_stormfix / v_bootauth2 (2026-08-25) ──────────────────────────────────
// บุช: admin ใช้แล้วค้าง+เด้งออก และ PWA มือถือ logout เองถ้าทิ้งไว้
// app_errors ยืนยัน render_storm ยังเกิดบน v281 (17 คน) ทั้งที่ v273 แก้ไปแล้ว
const tgt = read('src/07b_nrr_target.js');
const eng = read('src/07a_commission_engine.js');

check('ตัววาด target bar ทำงานทีละชุด (async เดิมเรียกซ้อนกันได้ ตัวกันรัว 300ms จึงไร้ผล)',
  /let _tgtBarRunning = false, _tgtBarRerunWanted = false;/.test(tgt) &&
  /if \(_tgtBarRunning\) \{ _tgtBarRerunWanted = true; return; \}/.test(tgt) &&
  /async function _renderPortviewTargetBarInner\(\)/.test(tgt));

check('คนที่ขอวาดระหว่างทำงานอยู่ ยุบเหลือรอบเดียว และผ่านตัวรวมคำสั่ง',
  (() => {
    const i = tgt.indexOf('_tgtBarRerunWanted = false;\n      // ผ่านตัวรวมคำสั่ง');
    return i > -1 && tgt.indexOf('scheduleRenderPortviewTargetBar(120)', i) > i;
  })());

check('ทางกู้ตัวเองมีเพดาน ไม่วนไม่จำกัด (สภาพปกติของ admin ตอนบูตคือข้อมูลยังไม่มา)',
  (tgt.match(/if \(bar\._healTries > 3\) return;/g) || []).length === 2 &&
  /bar\._healTries = 0;/.test(tgt));

check('loadTargets กันยิงซ้ำระหว่างยังโหลดไม่เสร็จ (cache เดิมกันได้แค่หลังเสร็จ)',
  /const _tgtInFlight = \{\};/.test(eng) &&
  /if \(_tgtInFlight\[quarter\]\) return _tgtInFlight\[quarter\];/.test(eng) &&
  /async function _loadTargetsInner\(quarter\)/.test(eng));

check('SIGNED_OUT ตอน cold boot ต้องถามซ้ำก่อน ไม่เด้ง login ทันที',
  (() => {
    const i = core.indexOf("if (!currentUser) {");
    const j = core.indexOf('window._bootSignedOutTimer = setTimeout', i);
    const k = core.indexOf("getSession(boot-signedout)", j);
    return i > 0 && j > i && k > j;
  })());

check('ถามซ้ำแล้วมี session → เข้าแอปเลย ไม่ต้องล็อกอินใหม่',
  /SIGNED_OUT ตอนบูตเป็นของชั่วคราว/.test(core) &&
  (() => {
    const i = core.indexOf('SIGNED_OUT ตอนบูตเป็นของชั่วคราว');
    return core.indexOf('hideLoginOverlay();', i) > i;
  })());

check('ถามซ้ำแล้วตอบไม่ได้ (เน็ตล่ม) → ห้ามเด้งออก',
  (() => {
    const i = core.indexOf('SIGNED_OUT ตอนบูต แต่เช็คซ้ำตอบไม่ได้');
    const j = core.indexOf('return;', i);
    const k = core.indexOf('_showLoginOverlayClean();', i);
    return i > 0 && j > i && (k === -1 || j < k);
  })());

check('ยืนยันแล้วว่าไม่มี session จริง → ยังต้องเด้ง login (ห้ามถอย v_bootnet ที่แก้จอค้าง)',
  /SIGNED_OUT ตอนบูต ยืนยันแล้วว่าไม่มี session/.test(core));

process.exit(fail ? 1 : 0);
