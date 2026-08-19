// tools/verify_echo_visit.js — standing assertions on ECHO GOAL 1
// (check-in-writes-DB-immediately + visit dashboard + quarterly homework).
//
// Two layers:
//   A. BEHAVIORAL — extracts the pure quarter/period helpers from source and
//      runs them under a shimmed Date for every month of the year (the ส.ค.
//      commission bug class: a period helper that is right in 11 months and
//      wrong in the 12th).
//   B. SOURCE LOCKS — greps for the load-bearing code shapes that a refactor
//      could silently undo: idempotent check-in sync, UPDATE-not-INSERT on
//      both save paths, covisit != null checks, admin scope without
//      self-fallback, ai_score enum validation, distinct-account counting,
//      detail select carrying transcript/summary_data.
//
// Usage: node tools/verify_echo_visit.js

const fs = require('fs');
const path = require('path');

const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ci    = SRC('09_conv_intel.js');
const pv    = SRC('06_portview_teamview.js');
const sk    = SRC('11_skills.js');
const core  = SRC('01_core.js');
const worker = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── helper: extract a top-level function by name and eval it with a fake Date ──
function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = src.match(re);
  if (!m) throw new Error('function ' + name + ' not found');
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}
function withFakeNow(fnSrc, fnName, nowIso, extraSrc) {
  const RealDate = Date;
  const fixed = new RealDate(nowIso).getTime();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  }
  const factory = new Function('Date', (extraSrc || '') + '\n' + fnSrc + '\nreturn ' + fnName + ';');
  return factory(FakeDate);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[A] quarter-start helpers — every month of the year');
// expected: calendar quarter = commission quarter (Q3 = Jul 1)
const QS = { 0:0, 1:0, 2:0, 3:3, 4:3, 5:3, 6:6, 7:6, 8:6, 9:9, 10:9, 11:9 };

const qFnSrc = extractFn(pv, '_visitQuarterStartMs');
for (let m = 0; m < 12; m++) {
  const nowIso = new Date(Date.UTC(2026, m, 15, 5, 0, 0)).toISOString();
  const fn = withFakeNow(qFnSrc, '_visitQuarterStartMs', nowIso);
  const got = new Date(fn());
  const exp = new Date(2026, QS[new Date(nowIso).getMonth()], 1);
  check(`06 _visitQuarterStartMs month=${m + 1} → ${exp.getMonth() + 1}/1`,
    got.getTime() === exp.getTime(), `got ${got.toISOString()}`);
}

// quarter start must be day 1 at midnight — the "วันที่ 1" class of bug
{
  const fn = withFakeNow(qFnSrc, '_visitQuarterStartMs', new Date(2026, 6, 1, 0, 0, 1).toISOString());
  const d = new Date(fn());
  check('06 quarter start on day-1 00:00:01 is still Jul 1 00:00',
    d.getDate() === 1 && d.getHours() === 0 && d.getMonth() === 6, d.toISOString());
}

// _visitFetchSinceIso must never be later than quarter start (92-day quarters
// vs 90-day TTL — the fetch bound has to widen, not clip)
{
  const bothSrc = extractFn(pv, '_visitQuarterStartMs');
  const fSrc = extractFn(pv, '_visitFetchSinceIso');
  // day 91 of Q3 (Sep 29): quarter start is >90d ago
  const fn = withFakeNow(fSrc, '_visitFetchSinceIso', '2026-09-29T12:00:00+07:00',
    'const _VISIT_TTL=90*24*60*60*1000;\n' + bothSrc);
  const qfn = withFakeNow(bothSrc, '_visitQuarterStartMs', '2026-09-29T12:00:00+07:00');
  check('06 _visitFetchSinceIso ≤ quarter start even on quarter day 91',
    new Date(fn()).getTime() <= qfn(), fn());
}

console.log('\n[A] 09 _histSince — ช่วงเวลาแท็บประวัติ (เดิมชื่อ _vdSince ของหน้า dashboard ที่ถูกยุบ)');
const vdSrc = extractFn(ci, '_histSince');
{
  // Wednesday 2026-08-05 (local): week starts Monday 2026-08-03
  const fn = withFakeNow(vdSrc, '_histSince', '2026-08-05T10:00:00+07:00');
  const wk = fn('week');
  check('week starts Monday', wk.getDay() === 1 && wk.getHours() === 0, wk.toString());
  const today = fn('today');
  check('today is midnight today', today.getHours() === 0 && today.getDate() === new Date('2026-08-05T10:00:00+07:00').getDate(), today.toString());
  const mo = fn('month');
  check('month starts day 1', mo.getDate() === 1 && mo.getMonth() === 7, mo.toString());
  const q = fn('quarter');
  check('quarter = Jul 1 in August', q.getMonth() === 6 && q.getDate() === 1, q.toString());
}
{
  // Sunday: Monday-of-week must be 6 days back, not tomorrow
  const fn = withFakeNow(vdSrc, '_histSince', '2026-08-09T10:00:00+07:00'); // Sunday
  const wk = fn('week');
  check('week on Sunday goes back to previous Monday', wk.getDay() === 1 && wk.getDate() === 3, wk.toString());
}

console.log('\n[A] distinct-account quarterly counting (11_skills shape)');
{
  // replicate the exact counting expression the source uses, then assert on data
  const rows = [
    { owner_email: 'A@x.co', visited_at: '2026-08-01', account_id: 'r1' },
    { owner_email: 'a@x.co', visited_at: '2026-08-02', account_id: 'r1' },  // same store twice
    { owner_email: 'a@x.co', visited_at: '2026-08-03', account_id: 'r2' },
    { owner_email: 'a@x.co', visited_at: '2026-06-30', account_id: 'r3' },  // last quarter
    { owner_email: 'a@x.co', visited_at: '2026-08-04', account_id: null },  // lead, no guid
    { owner_email: 'b@x.co', visited_at: '2026-08-04', account_id: 'r9' },
  ];
  const qStart = new Date(2026, 6, 1);
  const count = e => new Set(
    rows.filter(r => (r.owner_email || '').toLowerCase() === e && new Date(r.visited_at) >= qStart)
        .map(r => r.account_id).filter(Boolean)
  ).size;
  check('same store visited twice counts once', count('a@x.co') === 2, 'got ' + count('a@x.co'));
  check('other rep unaffected', count('b@x.co') === 1);
}

console.log('\n[A] checked_in vs recorded separation (dashboard counting rule)');
{
  const sessions = [
    { id: 1, pipeline_stage: 'checked_in', covisit_verified: false },
    { id: 2, pipeline_stage: 'transcribed', covisit_verified: false },
    { id: 3, pipeline_stage: 'analyzed', covisit_verified: true },
    { id: 4, pipeline_stage: null, covisit_verified: false },        // legacy row
  ];
  const cvBySession = new Set([2]);
  const isCk = s => s.pipeline_stage === 'checked_in';
  const isCv = s => !!(s.covisit_verified || cvBySession.has(s.id));
  check('total counts everything', sessions.length === 4);
  check('recorded excludes only checked_in (legacy null = recorded)',
    sessions.filter(s => !isCk(s)).length === 3);
  check('covisit merges flag + events table', sessions.filter(isCv).length === 2);
}

console.log('\n[A] ai_score enum mapping');
{
  const VALID = ['pass', 'developing', 'not_observed', 'not_applicable'];
  const mapScore = s => VALID.includes(s) ? s : 'not_observed';
  check('valid passes through', mapScore('developing') === 'developing');
  check('off-enum maps to not_observed', mapScore('excellent') === 'not_observed');
  check('undefined maps to not_observed', mapScore(undefined) === 'not_observed');
  // and the source really carries this list (must match live DB CHECK verified 2026-08-04)
  check('09 source carries the exact 4-value enum',
    ci.includes("['pass', 'developing', 'not_observed', 'not_applicable']"));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[B] source locks — 09_conv_intel.js');
check('check-in inserts ci_sessions with pipeline_stage checked_in',
  /pipeline_stage:\s*'checked_in',\s*\n?\s*status:\s*'draft'/.test(ci));
check('_syncCheckinToDb is idempotent (session_id short-circuit)',
  /if \(cache\.session_id\) return true;/.test(ci));
check('startRecording retries the check-in sync',
  /_acquireWakeLock\(\);[\s\S]{0,400}_syncCheckinToDb\(\)\.catch/.test(ci));
check('_saveTranscriptOnly updates the check-in row instead of inserting',
  /ctx\.checkinCache\?\.session_id[\s\S]{0,900}pipeline_stage: 'transcribed'/.test(ci));
check('_saveAnalysisToExistingSession targets checkin row before fallback insert',
  /ctx\.sessionId \|\| ctx\.checkinCache\?\.session_id/.test(ci));
// v951 hotfix locks — เคสจริง 2026-08-04 (แถวกำพร้า analyzed 0 วิ ไม่มีชื่อร้าน)
check('v951: _processBlob pins pipeline context at start',
  /const _ctx = \{[\s\S]{0,400}checkinCache: _checkinCache \|\| null/.test(ci));
check('v951: both saves receive pinned ctx',
  /_saveTranscriptOnly\(segments, transcriptResult\.source \|\| 'unknown', _ctx\)/.test(ci) &&
  /_saveAnalysisToExistingSession\(segments, summaryResult, analysisResult, _ctx\)/.test(ci));
check('v951: transcript save self-heals update→insert',
  /transcript update failed[\s\S]{0,300}self-healing via insert/.test(ci));
check('v951: analysis save self-heals update→insert',
  /analysis update failed[\s\S]{0,300}self-healing via insert/.test(ci));
check('v951: fallback insert reads ctx not globals',
  /account_id:\s+ctx\.accountGuid \|\| null,[\s\S]{0,200}account_name:\s+ctx\.accountName \|\| null/.test(ci));
check('v951: checkin cache cleared only for the same visit',
  /_checkinCache === ctx\.checkinCache/.test(ci));
check('v951: check-in retries once before warning toast',
  /setTimeout\(r, 1200\)[\s\S]{0,80}_syncCheckinToDb\(\)/.test(ci));
check('v951: admin history query has no giant .in()',
  /isAdminRole\(getCurrentRole\(\)\)[\s\S]{0,300}_getTeamEmails\(\);[\s\S]{0,120}q = q\.in\('owner_email', teamEmails\)/.test(ci));
check('v951: covisit list skips .in() for admin',
  /teamEmails\.length && !_adminScope\) cvQ = cvQ\.in/.test(ci));
// v_echor2: หน้า dashboard ถูกยุบเข้าแท็บประวัติแล้ว — การกัน .in() ของ admin
// เหลือจุดเดียวใน _loadInlineHistory (เช็คไปแล้วบรรทัดบน) ที่นี่จึงล็อกแค่ว่า
// ไม่มีใครแอบเปิด query ก้อนที่สองกลับมา
check('v_echor2: ไม่มี query ผลการ visit ก้อนที่สองแล้ว',
  !/_loadVisitDashboard/.test(ci));
check('v951: TL/admin history error shown, not masked as empty',
  /โหลดประวัติไม่สำเร็จ/.test(ci));
check('v951: resume awaits pipeline then refreshes history',
  /await _processBlob\(new Blob\(\[\]\), segments\);[\s\S]{0,80}_loadInlineHistory/.test(ci));
// v952 locks — check-in must not depend on the async profiles fetch or a stale token
check('v952: _authEmail helper exists with JWT fallback',
  /function _authEmail\(\)[\s\S]{0,400}sb-.*auth-token/.test(ci));
check('v952: all three save paths use _authEmail',
  (ci.match(/const email = _authEmail\(\)/g) || []).length >= 3);
check('v952: checkin sync refreshes token before insert',
  /await supa\.auth\.getSession\(\); \} catch\(_\) \{\}[\s\S]{0,600}pipeline_stage: 'checked_in'/.test(ci));
check('v952: retry queue armed when checkin sync fails',
  /if \(!synced\) _armCheckinRetry\(\)/.test(ci));
check('v952: retry queue interval 15s capped at 8 tries',
  /_checkinRetryCount >= 8/.test(ci) && /}, 15000\)/.test(ci));
check('v952: visibilitychange re-syncs pending checkin',
  /visibilitychange[\s\S]{0,300}_checkinCache\.session_id[\s\S]{0,200}_syncCheckinToDb/.test(ci));
check('v952: final failure reports to sentinel',
  /ci_checkin_sync_fail/.test(ci));
// v_checkinretry (2026-08-17): เดิม give-up มีแค่ telemetry เงียบๆ ไม่มีอะไรบอก
// rep เลยว่าเช็คอินยังไม่ขึ้นระบบ — ต้องมี pill ค้างให้เห็น + แตะลองใหม่ได้เอง
// และ restore จาก cache (ออฟไลน์เปิดแอปทีหลัง) ต้องปลุก retry queue ด้วย
check('v_checkinretry: มี pill เตือนค้างไว้เมื่อ retry หมดรอบ (ไม่ใช่ telemetry อย่างเดียว)',
  /id="ci-checkin-warn"/.test(ci) && /_setCheckinWarnVisible\(true\)/.test(ci));
check('v_checkinretry: แตะ pill เตือนแล้วลองซ้ำได้ทันที',
  /async function _retryCheckinSyncNow\(\)/.test(ci) &&
  /onclick="CI\._retryCheckinSyncNow\(\)"/.test(ci));
check('v_checkinretry: pill เตือนหายไปเมื่อ sync สำเร็จ (ทุกเส้นทาง)',
  (ci.match(/_setCheckinWarnVisible\(false\)/g) || []).length >= 3);
check('v_checkinretry: restore เช็คอินจาก cache (ออฟไลน์เปิดแอปทีหลัง) ปลุก retry queue ด้วย',
  /if \(!cached\.session_id\) _armCheckinRetry\(\);\s*\n\s*return true;/.test(ci));

// v_screenlock (2026-08-17): ข้อความระหว่างอัดเสียงเดิมบอกผิดว่า "ทำงานอยู่
// เบื้องหลัง" ได้ ทั้งที่ iOS ตัดไมค์ทันทีที่ล็อกจอจริง (เหตุการณ์ 11 ส.ค.)
check('v_screenlock: ข้อความระหว่างอัดเตือนให้เปิดจอไว้ ไม่ใช่หลอกว่าปิดจอได้',
  /id="ci-rec-hint">เปิดหน้าจอทิ้งไว้ระหว่างคุย/.test(ci) &&
  !/id="ci-rec-hint">echo กำลังรับฟัง/.test(ci));
check('v952: admin empty covisit list reports telemetry',
  /ci_admin_covisit_empty/.test(ci));
check('v952: resume owner-check uses _authEmail',
  /const me = \(_authEmail\(\) \|\| ''\)\.toLowerCase\(\)/.test(ci));
check('covisit haversine uses != null (falsy-zero fix)',
  /target\.rep_lat != null && target\.rep_lng != null/.test(ci));
check('covisit detail path fetches real row before verifying',
  /select\('rep_lat,rep_lng,checked_in_at,owner_email'\)/.test(ci));
check('_getTeamEmails: admin branch returns without self-fallback',
  /_isAdmin[\s\S]{0,600}return \[\.\.\.emails\];/.test(ci));
check('detail select carries transcript + summary_data',
  /,transcript,summary_data,rep_lat,rep_lng,checked_in_at/.test(ci));
check('list select carries pipeline_stage',
  /tl_note,covisit_verified,status,pipeline_stage'/.test(ci));
check('checked_in renders its own card in TL feed',
  /_renderTLTeamFeed[\s\S]{0,900}pipeline_stage === 'checked_in'/.test(ci));
check('v_echor2: สรุปผลการ visit อยู่ในแท็บประวัติ คิดจากชุดเดียวกับรายการ',
  /_histSummaryHtml\(data,/.test(ci) && /HIST_PERIODS\.map/.test(ci));
check('_resumeAnalysis exists and is exported',
  /async function _resumeAnalysis/.test(ci) && /, _resumeAnalysis,/.test(ci));
check('resume guards owner (RLS would zero-row silently otherwise)',
  /วิเคราะห์ต่อได้เฉพาะ session ของตัวเอง/.test(ci));
check('_renderEchoState exported (v715 fix finally live)',
  /_restoreBodyScroll, _renderEchoState/.test(ci));
check('dead _saveToSupabase removed', !/function _saveToSupabase/.test(ci));
check('dead _mountPicker removed', !/function _mountPicker/.test(ci));
check('dead _pickerSearch removed from exports', !/_pickerSearch,/.test(ci));

console.log('\n[B] source locks — RECORD-HANG-DIAG (startRecording telemetry)');
check('startRecording arms an 8s watchdog before getUserMedia',
  /const _gumWatchdog = setTimeout\(\(\) => \{[\s\S]{0,150}ci_record_start_timeout/.test(ci));
check('watchdog is cleared on both settle paths (success + catch)',
  (ci.match(/_gumSettled = true; clearTimeout\(_gumWatchdog\);/g) || []).length >= 2);
check('catch block reports ci_record_start_fail with err name+message',
  /SenseSentinel\?\.report\('ci_record_start_fail', \(err\?\.name \|\| 'Error'\) \+ ':' \+ \(err\?\.message \|\| 'unknown'\)\)/.test(ci));

console.log('\n[B] source locks — 06_portview_teamview.js');
check('homework label carries (ไตรมาสนี้) on all 3 cards',
  (pv.match(/ทำการบ้าน \$\{visited\}\/\$\{g\.total\} \(ไตรมาสนี้\)/g) || []).length === 3);
check('homework count filters by quarter start',
  /lastSeen>=_hwQStart/.test(pv));
check('TL/admin map has no localStorage self-fallback',
  /window\._tvVisitMap\?\(window\._tvVisitMap\[g\.kamEmail\]\|\|\{\}\):getVisitMap/.test(pv));
check('chipRow uses the shared server-map helper',
  /function chipRow\(g\)\{[\s\S]{0,300}_hwVm\(g\)/.test(pv));
check('_isTLAdmin includes sales_tl',
  /role==='sales_tl'\)/.test(pv));
check('echo map fetch uses quarter window (30d hardcode gone)',
  !/30\*24\*60\*60\*1000\).toISOString/.test(pv) && /_visitQuarterStartMs\(\)\).toISOString/.test(pv));
check('echo local map uses quarter window',
  /v\.ts>=qStart/.test(pv));
check('server fetches widened to min(quarterStart, now-TTL)',
  (pv.match(/_visitFetchSinceIso\(\)/g) || []).length >= 3);

console.log('\n[B] source locks — ECHO GOAL 2 Phase R (role-scoped rubric)');
check('skillRoleBucket exists + covers all 4 buckets',
  /function skillRoleBucket\(role\)\{/.test(core) &&
  /sales_tl'\) return 'sales'/.test(core) &&
  /ad_tl'\) return 'ad'/.test(core) &&
  /r === 'pm'\) return 'pm'/.test(core));
check('skillDefMatchesBucket treats null/empty roles as match-all',
  /function skillDefMatchesBucket\(def, bucket\)\{[\s\S]{0,120}if\(!roles \|\| !roles\.length\) return true/.test(core));
check('both new helpers exported to window', /window\.skillRoleBucket = skillRoleBucket/.test(core) && /window\.skillDefMatchesBucket = skillDefMatchesBucket/.test(core));
check('sales_tl/ad_tl debrief branch uses skillRoleBucket (not hardcoded kam)',
  /_ownerType = \(typeof skillRoleBucket === 'function'\) \? skillRoleBucket\(getCurrentRole\(\)\) : 'kam';/.test(ci));
check('own-recording branch uses skillRoleBucket',
  /_ownerType = \(typeof skillRoleBucket === 'function'\) \? skillRoleBucket\(role\)/.test(ci));
check('rubric select carries roles column', /skill_code,skill_name_en,skill_name_th,principle_th,pass_test_th,echo_observable,echo_enabled,roles/.test(ci));
check('_rubricCache is never filtered at load time (stays full set)',
  /_rubricCache = data \|\| \[\];/.test(ci));
check('_rubricForBucket helper filters via skillDefMatchesBucket',
  /function _rubricForBucket\(bucket\) \{[\s\S]{0,200}skillDefMatchesBucket\(def, bucket\)/.test(ci));
check('_callAnalyze filters rubric by ctx.ownerType bucket before sending',
  /const _bucket = \(typeof skillRoleBucket === 'function'\) \? skillRoleBucket\(ctx\?\.ownerType\) : 'kam';/.test(ci) &&
  /rubric: _rubricForSend, role: _bucket/.test(ci));
check('_processBlob passes pinned _ctx into _callAnalyze',
  /_callAnalyze\(segments, summaryResult, _ctx\)/.test(ci));
check('_resumeAnalysis selects owner_type and re-buckets from the real row',
  /pipeline_stage,owner_type/.test(ci) && /_ownerType = row\.owner_type \|\| _ownerType;/.test(ci));
check('analyze response drops skill codes outside the sent rubric',
  /const _sentCodes = new Set\(_rubricForSend\.map\(d => d\.skill_code\)\);/.test(ci) &&
  /const _kept = _skills\.filter\(s => _sentCodes\.has\(s\.code\)\);/.test(ci));

console.log('\n[B] source locks — ECHO GOAL 2 Phase M (Admin Rubric Manager role chips)');
check('list row renders role badges via _admRoleBadges(s.roles)',
  /\$\{s\.skill_name_en\|\|'—'\}\$\{_admRoleBadges\(s\.roles\)\}/.test(ci));
check('modal has adm-f-roles chip container', /id="adm-f-roles"/.test(ci));
check('admToggleRoleChip toggles Set membership + re-renders',
  /window\.admToggleRoleChip = function\(role\) \{[\s\S]{0,150}_admRenderRoleChips\(\);/.test(ci));
check('admOpenModal seeds _admSelectedRoles from the real row (not stale from a prior edit)',
  /_admSelectedRoles = new Set\(Array\.isArray\(s\?\.roles\) \? s\.roles : \[\]\);/.test(ci));
check('admSaveSkill: empty or all-4 selected both collapse to NULL',
  /_admSelectedRoles\.size === 0 \|\| _admSelectedRoles\.size >= ADM_ROLE_ORDER\.length\)\s*\n?\s*\? null : Array\.from\(_admSelectedRoles\)/.test(ci));

console.log('\n[B] source locks — ECHO GOAL 2 Phase S (role-scoped Skills tab)');
check('profiles selects carry role (+id/name for roster-seeding) in all 3 sites',
  /profiles\?select=id,email,role,full_name,kam_name&role=in\.\(sales,rep,sales_tl,tl,ad,ad_tl,pm,kam\)/.test(sk) &&
  /profiles\?select=id,email,role,full_name,kam_name&squad=eq\./.test(sk) &&
  /profiles\?select=id,email,full_name,kam_name,role&id=in\./.test(sk));
check('_tlSquadById (roster id->email/role/name) populated at both squad-load sites',
  /_tlSquadById\[r\.id\] = \{ email: r\.email\.toLowerCase\(\), role: r\.role, name: r\.kam_name \|\| r\.full_name \|\| '' \};/g.test(sk) &&
  (sk.match(/_tlSquadById\[r\.id\] = /g) || []).length >= 2);
check('_skUserBucket/_skUserRoleLabel/_skUserName check roster (_tlSquadById) before progress-sourced _skillUsers',
  /const email = _tlSquadById\[userId\]\?\.email \|\| \(_skillUsers\[userId\]/.test(sk) &&
  (sk.match(/_tlSquadById\[userId\]/g) || []).length >= 3);
check('TL Overview "By Rep" seeds userMap from the roster before overlaying progress rows',
  /Object\.keys\(_tlSquadById\)\.forEach\(uid => \{ userMap\[uid\] = \[\]; \}\);/.test(sk));
check('bucket helpers present (_skBucketForEmail/_skUserBucket/_skOwnBucket/_skDefsForBucket/_skOwnScopedDefs/_skUserRoleLabel)',
  /function _skBucketForEmail\(email\)/.test(sk) && /function _skUserBucket\(userId\)/.test(sk) &&
  /function _skOwnBucket\(\)/.test(sk) && /function _skDefsForBucket\(bucket\)/.test(sk) &&
  /function _skOwnScopedDefs\(\)/.test(sk) && /function _skUserRoleLabel\(userId\)/.test(sk));
check('_skOwnScopedDefs returns full catalogue in TL browse mode',
  /function _skOwnScopedDefs\(\) \{\s*\n\s*if \(_tlBrowseMode\) return _skillDefs;/.test(sk));
check('_renderRepHome uses own-scoped defs (not raw _skillDefs) + skips empty modules',
  /const scopedDefs = _skOwnScopedDefs\(\);/.test(sk) &&
  /const modules = \['A','B','C','D'\]\.filter\(m => scopedDefs\.some/.test(sk));
check('_renderModuleGrid + _doOpenDetail + skillsStartTraining all use own-scoped defs',
  /const defs = _skOwnScopedDefs\(\)\.filter\(d => d\.module === module\);/.test(sk) &&
  /const def   = _skOwnScopedDefs\(\)\.find\(d => d\.id === skillId\);/.test(sk) &&
  /const def = _skOwnScopedDefs\(\)\.find\(d => d\.id === skillId\);/.test(sk));
check('TL browse mode renders a role badge per card',
  /function _skRoleBadgeHtml\(def\) \{\s*\n\s*if \(!_tlBrowseMode\) return '';/.test(sk));
check('TL Overview by-rep uses per-rep bucket for denominator (not global skill count)',
  /const scopedDefs = _skDefsForBucket\(_skUserBucket\(uid\)\);/.test(sk));
check('TL Overview by-skill uses eligible-rep count, skips skills with zero eligible reps',
  /const haveRoster = _tlSquadEmails\.length > 0;/.test(sk) &&
  /if \(haveRoster && eligibleEmails\.length === 0\) return '';/.test(sk));
check('skillsTLOpenEval blocks evaluating a skill outside the viewed rep\'s bucket',
  /if \(typeof skillDefMatchesBucket === 'function' && !skillDefMatchesBucket\(def, _skUserBucket\(userId\)\)\)/.test(sk));
check('rep-detail row builder deduped into one function used by both open + filter',
  /function _skRepDetailRows\(userId, showAll\)/.test(sk) &&
  /list\.innerHTML = _skRepDetailRows\(userId, all\);/.test(sk) &&
  (sk.match(/_skRepDetailRows\(userId, (true|all)\)/g) || []).length >= 2);
check('hardcoded "Sales ·" label replaced with real role label at both sites',
  !/>Sales · /.test(sk) &&
  (sk.match(/_skUserRoleLabel\(userId\)/g) || []).length >= 2);
check('nav pending badge uses the same squad-scoped base as the pending tab',
  /const pending = Object\.values\(window\._tlProgFiltered \|\| _skillProg\)\.filter\(p => p\.state === 'training'\)\.length;/.test(sk));
check('MODULE_META lookups guarded against a module outside A-D',
  (sk.match(/MODULE_META\[(m|module)\] \|\| \{/g) || []).length >= 3);

console.log('\n[B] source locks — 11_skills.js');
check('visits fetch window = quarter start (35d hardcode gone)',
  !/35 \* 86400000/.test(sk) && /const since = qStart.toISOString\(\)/.test(sk));
check('select carries account_id', /account_name,account_id,duration_secs/.test(sk));
check('thisQuarter counts distinct accounts',
  /thisQuarter = new Set\(/.test(sk));
check('cap is surfaced, not silent', /_hitCap/.test(sk) && /ชนเพดาน/.test(sk));
check('admin falls back to org-wide roster',
  /role=in\.\(sales,rep,sales_tl,tl,ad,ad_tl,pm,kam\)/.test(sk));

console.log('\n[B] source locks — ECHO GOAL 2 Phase A0 (transcript quality)');
// v_ears (2026-08-14): prompt เดิมเป็น "ประโยค" ที่ประกอบจาก account_name
// ซึ่งกลายเป็นต้นเหตุให้ Whisper คายมันกลับมาเป็นบทพูด (60 ท่อน / 16 session)
// จึงเปลี่ยนเป็น "รายการคำ" + glossary ชื่อสินค้าจริงของร้าน — ข้อล่างล็อก
// โครงใหม่แทน · รายละเอียดครบใน tools/verify_ears_prompt.js
check('worker: Whisper prompt เป็นรายการคำ ไม่ใช่ประโยค (กัน prompt รั่ว)',
  /const \{ audio_b64, mime_type, duration_secs, account_name, sku_glossary \} = body;/.test(worker) &&
  /const promptParts = \[/.test(worker) &&
  /groqForm\.append\('prompt', dynamicPrompt\);/.test(worker));
// v_audiofix (2026-08-15): ข้อนี้เคยล็อก .slice() ซึ่งนับเป็น "ตัวอักษร"
// — และนั่นคือบรรทัดที่ทำให้การอัดวันที่ 14 ส.ค. ล่ม เพราะ Groq วัดเป็นไบต์
// และภาษาไทยกิน 3 ไบต์ต่อตัว · ล็อกวิธีใหม่ (คุมเป็นไบต์) แทน
check('worker: account_name + glossary ถูกคุมความยาวเป็น "ไบต์" ก่อนใช้',
  /_clampBytes\(String\(account_name \|\| ''\)\.trim\(\), 120\)/.test(worker) &&
  /_clampBytes\(String\(skuGlossary \|\| ''\)\.trim\(\), glossaryBudget\)/.test(worker) &&
  !/String\(skuGlossary \|\| ''\)\.trim\(\)\.slice\(/.test(worker));
check('client: _callTranscript ส่ง account_name + glossary จาก ctx ที่ pin ไว้',
  /await _callTranscript\(blob, transcriptTimeout, _ctx\.accountName, _ctx\.skuGlossary\);/.test(ci) &&
  /async function _callTranscript\(audioBlob, timeoutMs, accountName, skuGlossary\)/.test(ci) &&
  /account_name: accountName \|\| undefined/.test(ci));
check('client: worker confidence fields captured into ctx after transcript call',
  /_ctx\.transcriptConfidence = typeof transcriptResult\.avg_transcript_confidence === 'number'/.test(ci) &&
  /_ctx\.speakerConfidence    = typeof transcriptResult\.avg_speaker_confidence === 'number'/.test(ci));
check('client: _saveTranscriptOnly persists confidence on both UPDATE and INSERT paths',
  (ci.match(/transcript_confidence: ctx\.transcriptConfidence \?\? null,?/g) || []).length >= 2 &&
  (ci.match(/speaker_confidence:\s+ctx\.speakerConfidence \?\? null,?/g) || []).length >= 2);
check('client: session detail select carries transcript_confidence + pipeline_error',
  /pipeline_stage,pipeline_error,transcript,summary_data,rep_lat,rep_lng,checked_in_at,transcript_confidence/.test(ci));
check('client: low-confidence banner renders honest copy (no false claim about replaying audio)',
  /if \(typeof s\.transcript_confidence === 'number' && s\.transcript_confidence < _confThreshold\)/.test(ci) &&
  !/ฟังต้นฉบับ/.test(ci));
// v_confproxy (2026-08-17): 0.6 คงที่ใช้ไม่ได้กับ Gemini — proxy ของมันกระจุกใกล้
// 1.0 เกือบทุกแถวไม่ว่าคุณภาพเสียงจะแย่แค่ไหนจริง (วัดจากข้อมูลจริง) ป้ายเตือนจึง
// ต้องแยกเกณฑ์ตาม transcript_source ไม่งั้นจะไม่มีวันขึ้นเลยสำหรับ Gemini
check('client: session detail select ดึง transcript_source มาด้วย (จำเป็นต่อการแยกเกณฑ์)',
  /transcript_confidence,transcript_source/.test(ci));
check('client: เกณฑ์เตือนแยกตาม transcript_source — gemini เข้มกว่า whisper มาก',
  /const _confThreshold = s\.transcript_source === 'gemini-3\.1-pro' \? 1 : 0\.6;/.test(ci));

// v_recdebounce (2026-08-17): _phase ยังเป็น 'idle' ตลอดช่วงรอ getUserMedia() —
// เดิมกดซ้อนสองครั้งในช่วงนี้ผ่านด่านได้ทั้งคู่ กลายเป็นสอง MediaRecorder ทำงาน
// พร้อมกัน (mirror _checkinBusy pattern ที่มีอยู่แล้วสำหรับเช็คอิน)
check('client: startRecording มี busy-guard กันกดซ้อนระหว่างรอ getUserMedia',
  /let _startRecBusy = false;/.test(ci) &&
  /if \(_phase !== 'idle' \|\| _startRecBusy\) return;/.test(ci) &&
  /_startRecBusy = true;/.test(ci));
check('client: busy-guard ถูกปล่อยทั้งเส้นทางสำเร็จและล้มเหลว',
  /_phase\s+= 'recording';\s*\n\s*_startRecBusy = false;/.test(ci) &&
  /_phase = 'idle';\s*\n\s*_startRecBusy = false;/.test(ci));

console.log('\n[B] source locks — ECHO GOAL 2 Phase A2v2.1 (async pipeline)');
// worker side
check('worker: /process route registered with ctx',
  /if \(url\.pathname === '\/process'\)\s+return handleProcess\(request, env, cfCtx\);/.test(worker) &&
  /async fetch\(request, env, cfCtx\)/.test(worker));
// v_resumefix (2026-08-17): เดิม /process ตอบ 202 เสมอแม้กับ failed_system ที่
// processSession ไม่มี stage ไหนรับเลย — ทำให้ปุ่ม "ลองใหม่" หลอกว่าสำเร็จทั้งที่
// ไม่มีอะไรเกิดขึ้นจริง ตอนนี้ต้องปลุกกลับ transcribed ก่อนจริงๆ
check('worker: handleProcess ปลุก failed_system กลับ transcribed ก่อนยิง processSession จริง (ปุ่ม "ลองใหม่" ต้องลองใหม่จริง)',
  /pipeline_stage === 'failed_system'[\s\S]{0,250}pipeline_stage: 'transcribed', status: 'draft', attempts: 0/.test(worker) &&
  worker.indexOf("pipeline_stage === 'failed_system'") < worker.indexOf('cfCtx.waitUntil(processSession('));
check('worker: cores extracted and reused by legacy endpoints',
  /await runTranscribe\(_b64ToBytes\(audio_b64\)/.test(worker) &&
  /await runSummarize\(segments, env\)/.test(worker) &&
  /await runAnalyze\(segments, summary, rubric, env\)/.test(worker));
check('worker: /process validates session_id as uuid before query interpolation',
  /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(sessionId\)/.test(worker));
check('worker: stage claim is conditional on pipeline_stage + null-or-stale processing_since',
  /pipeline_stage=eq\.\$\{stage\}&or=\(processing_since\.is\.null,processing_since\.lt\./.test(worker) &&
  (worker.match(/if \(!claimed\.length\) return;/g) || []).length >= 2);
// v_cpudiet (2026-08-12): error path ต้องทั้งปล่อย claim และบันทึกสาเหตุลง
// pipeline_error — เดิมปล่อย claim เฉยๆ แบบเงียบ ทำให้ session ที่ล้มซ้ำทั้งวัน
// ไม่มีร่องรอยให้ไล่เลย
check('worker: claim released on stage error (sweep can retry)',
  (worker.match(/processing_since:\s*null,\s*\n\s*pipeline_error:/g) || []).length >= 2);
// v_echor3: กลับด้าน — ห้ามลบเสียงทิ้งตอนถอดเสร็จอีกแล้ว เพราะทำให้คลิปจริง 43
// จาก 44 หายถาวร แล้วพิสูจน์ไม่ได้ว่าการแก้แต่ละครั้งดีขึ้นจริง (= เหตุที่วนไม่จบ)
check('worker: ไม่ลบไฟล์เสียงทิ้งทันทีหลังถอดเสร็จแล้ว',
  !/pipeline_stage:\s+'transcribed'[\s\S]{0,400}sbStorageDelete/.test(worker));
check('worker: มี sweeper ลบเสียงตามอายุแทน + ต่อเข้า cron',
  /async function sweepExpiredAudio\(env\)/.test(worker) &&
  /AUDIO_RETENTION_DAYS/.test(worker) &&
  /waitUntil\(sweepExpiredAudio\(env\)\)/.test(worker));
// v_retention7 (2026-08-17): บุชเคาะ 30→7 หลัง bucket ใช้ไป ~21% ของโควตาฟรี
// จากแค่ 5 วัน pilot — ต้องตรงกันทั้ง JS fallback และ wrangler.toml [vars]
check('worker: ค่า fallback ตอนนี้คือ 7 วัน (ไม่ใช่ 30 เดิม)',
  /const AUDIO_RETENTION_DAYS = 7;/.test(worker));
check('wrangler.toml: AUDIO_RETENTION_DAYS ตั้งเป็น "7" ตรงกับ JS fallback',
  /AUDIO_RETENTION_DAYS = "7"/.test(fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8')));
check('worker: sweeper ลบ storage สำเร็จก่อนค่อย null คอลัมน์ (กันไฟล์กำพร้า)',
  /await sbStorageDelete\(env, r\.audio_path\);\s*\n\s*await sbPatch\(env, 'ci_sessions', `id=eq\.\$\{r\.id\}`, \{ audio_path: null \}\);/.test(worker));
// v_skilllog (2026-08-17): echo_skill_observations/kam_skill_log ไม่มีนโยบายลบ
// มาก่อน — เกาะรอบ 03:00 UTC เดียวกับ sweepExpiredAudio ไม่เพิ่ม cron ใหม่
check('worker: มี sweeper สำหรับ skill logs ทั้งสองตาราง + เกาะ cron รอบเดิม',
  /async function sweepExpiredSkillLogs\(env\)/.test(worker) &&
  /SKILL_LOG_RETENTION_DAYS/.test(worker) &&
  /waitUntil\(sweepExpiredSkillLogs\(env\)\)/.test(worker));
check('worker: ลบ echo_skill_observations ด้วย observed_at (timestamp) และ kam_skill_log ด้วย session_date (date)',
  /sbDelete\(env, 'echo_skill_observations', `observed_at=lt\.\$\{encodeURIComponent\(cutoffIso\)\}`\)/.test(worker) &&
  /sbDelete\(env, 'kam_skill_log', `session_date=lt\.\$\{encodeURIComponent\(cutoffDate\)\}`\)/.test(worker));
check('worker: rubric fetched from DB and role-filtered server-side (Phase R semantics)',
  /skill_definitions\?echo_enabled=eq\.true/.test(worker) &&
  /!d\.roles \|\| !d\.roles\.length \|\| d\.roles\.includes\(bucket\)/.test(worker));
check('worker: out-of-rubric skill codes dropped (v953 guard mirrored)',
  /const sentCodes = new Set\(rubric\.map\(d => d\.skill_code\)\);/.test(worker));
check('worker: side tables written server-side (kam_skill_log + observations + kam_visits)',
  /sbInsert\(env, 'kam_skill_log'/.test(worker) &&
  /sbInsert\(env, 'echo_skill_observations'/.test(worker) &&
  /sbUpsert\(env, 'kam_visits'/.test(worker));
check('worker: self-triggers the next stage via a fresh invocation',
  /await fetch\(`\$\{origin\}\/process`/.test(worker));
check('worker: no_speech recorded honestly instead of leaving the row stuck',
  /pipeline_stage: 'no_speech'/.test(worker));
// client side
check('client: _onStop routes into the async pipeline',
  /_startAsyncPipeline\(blob\);\s*\n\s*\}/.test(ci));
check('client: upload goes to the rep\'s own echo-audio prefix',
  /`echo-audio\/\$\{userId\}\/\$\{rand\}\.\$\{ext\}`/.test(ci) &&
  /supa\.storage\.from\('ciq-data'\)/.test(ci));
check('client: trigger uses keepalive so it survives immediate app close',
  /keepalive: true,\s*\n\s*headers: \{ 'Content-Type': 'application\/json' \},\s*\n\s*body: JSON\.stringify\(\{ session_id: rowId \}\)/.test(ci));
check('client: 404/405 from old worker falls back to the local pipeline on the SAME row',
  /if \(res\.status === 404 \|\| res\.status === 405\) endpointMissing = true;/.test(ci) &&
  /_sessionId = rowId; \/\/ local pipeline's pinned ctx targets this row/.test(ci) &&
  /return _processBlob\(blob\);/.test(ci));
check('client: upload failure falls back to the legacy pipeline entirely',
  /ci_async_upload_fail/.test(ci));
check('client: sweep re-triggers own stuck rows, throttled, never racing a live pipeline',
  /async function _sweepStuckAsyncRows\(force\)/.test(ci) &&
  /if \(_phase !== 'idle'\) return;/.test(ci) &&
  /\.in\('pipeline_stage', \['uploaded', 'transcribed'\]\)/.test(ci));
check('client: sweep registered on visibilitychange + boot',
  /visibilitychange[\s\S]{0,120}setTimeout\(_sweepStuckAsyncRows, 4000\)/.test(ci) &&
  /setTimeout\(_sweepStuckAsyncRows, 9000\);/.test(ci));
check('client: วิเคราะห์ต่อ prefers server-side /process with local fallback',
  /_resumeAnalysis[\s\S]{0,2000}if \(!_asyncEndpointMissing\) \{[\s\S]{0,400}session_id: row\.id/.test(ci));
check('client: history renders uploaded + no_speech cards',
  /กำลังวิเคราะห์เบื้องหลัง/.test(ci) && /ไม่พบเสียงพูด<\/span>|>ไม่พบเสียงพูด</.test(ci));
check('client: session detail handles uploaded/no_speech without empty tabs',
  /s\.pipeline_stage === 'uploaded' \|\| s\.pipeline_stage === 'no_speech'/.test(ci));
check('client: _saveTranscriptOnly prefers ctx.sessionId (fallback path targets the pre-created row)',
  /const _ciSessionId = ctx\.sessionId \|\| ctx\.checkinCache\?\.session_id \|\| null;/.test(ci));

console.log('\n[B] source locks — ECHO GOAL 2 Phase A2v2.2 (brain)');
// v_echor3: chain เดิมมี 'gemini-3.5-pro' บนสุดซึ่งไม่มีรุ่นนี้อยู่จริง → 404 แล้ว
// ตกลงชั้นล่างสุดเงียบๆ 17/18 ครั้ง · lock ว่าชื่อผีตัวนั้นห้ามกลับมา และห้ามใช้
// สาย 2.5 เป็นพื้น (ใกล้ปิดตัว)
check('worker: ชื่อรุ่นผี gemini-3.5-pro ไม่กลับมาเป็น entry ใน chain อีก',
  !/model:\s*'gemini-3\.5-pro'/.test(worker));
check('worker: chain เรียงแรงสุดก่อน และพื้นไม่ใช่สาย 2.5',
  (() => {
    const chain = worker.slice(worker.indexOf('BRAIN_MODEL_CHAIN'), worker.indexOf('async function callBrainModel'));
    return chain.includes("'gemini-3.1-pro-preview'") && chain.includes("'claude-sonnet-5'") &&
      chain.includes("'claude-sonnet-4-6'") && !chain.includes("'gemini-2.5-flash'") &&
      chain.indexOf("'gemini-3.1-pro-preview'") < chain.indexOf("'claude-sonnet-4-6'");
  })());
// v_aifix: trail ยังอยู่ แต่ข้อความมาจาก _callOneModel (r.errMsg) แล้ว
// ไม่ใช่ประกอบเองจาก res.status ในนี้
check('worker: บันทึกร่องรอยการตกชั้นลง DB ไม่ใช่แค่ console',
  /const trail = \[\];/.test(worker) && /trail\.push\(r\.errMsg\)/.test(worker) &&
  /ai_model_trail: aiTrail/.test(worker));
check('worker: มี /models ไว้ถามว่า key เรียกรุ่นไหนได้จริง (เลิกเดาชื่อรุ่น)',
  /async function handleListModels\(env\)/.test(worker) &&
  /pathname === '\/models'/.test(worker));
// v_aifix: กติกาเดิมทุกอย่าง แต่ย้ายไปอ่าน status จากผลของ _callOneModel
// และตอนนี้ใช้ร่วมกันทั้ง brain และช่องทาง AI กลาง (ต้องเจอทั้งสองที่)
check('worker: 4xx model-missing breaks to next model, 429/5xx retries same model',
  (worker.match(/if \(r\.status === 429 \|\| r\.status >= 500\) continue;/g) || []).length >= 2);
check('worker: runBrain replaces summarize+analyze inside /process',
  /await runBrain\(segments, rubric, bucket, priorIntel, env\)/.test(worker) &&
  !/await runSummarize\(segments, env\)\)\.parsed/.test(worker.slice(worker.indexOf('async function processSession'))));
check('worker: brain prompt carries restaurant lens + decision tree + evidence discipline',
  /เลนส์ธุรกิจร้านอาหาร/.test(worker) &&
  /share of wallet/.test(worker) &&
  /not_applicable/.test(worker) &&
  /วินัยหลักฐาน 3 ระดับ/.test(worker) &&
  /ห้ามเดา ให้ข้าม/.test(worker));
// v_echor2: needs ยังต้องมี implication เหมือนเดิม แต่ "สิ่งที่ต้องทำ" ย้ายออก
// ไปอยู่ที่ next_actions ที่เดียว (เดิมเขียนซ้ำสองที่ หน้าจอเลยโชว์ซ้ำ)
check('worker: needs require implication + id, ไม่มี action ซ้อนใน needs',
  /"implication"/.test(worker) && /"id": "n1"/.test(worker) &&
  !/"suggested_action"/.test(worker) &&
  /ต้องบอกว่าแล้วไงต่อ/.test(worker));
check('worker: cross-visit memory read from kam_visits + no-copy rule',
  /kam_visits\?kam_email=eq\.[\s\S]{0,120}ci_customer_signals,ci_next_actions,ci_created_at/.test(worker) &&
  /ห้ามนับเป็นข้อมูลของรอบนี้/.test(worker));
check('worker: ai_model stamped into ci_sessions',
  /ai_model: aiModel \|\| null,/.test(worker));
check('worker: customer_intel gains needs/unknowns/progress_vs_last',
  /needs:\s+Array\.isArray\(parsed\.needs\)/.test(worker) &&
  /unknowns:\s+Array\.isArray\(parsed\.unknowns\)/.test(worker) &&
  /progress_vs_last: Array\.isArray\(parsed\.progress_vs_last\)/.test(worker));
check('worker: ROLE_CONTEXT covers all 4 buckets',
  /BRAIN_ROLE_CONTEXT = \{[\s\S]{0,800}kam:[\s\S]{0,800}sales:[\s\S]{0,800}ad:[\s\S]{0,800}pm:/.test(worker));
// v_echor2: ลำดับใหม่ = สรุป → ทำอะไรต่อ → แถบ OCPB → รายละเอียดพับเก็บ
check('client: customer panel เรียง headline → actions → OCPB → รายละเอียด',
  /return headlineHtml \+ actsHtml \+ stripHtml \+ details;/.test(ci));
check('client: needs card shows source chip (explicit vs implied)',
  /อ่านระหว่างบรรทัด/.test(ci) && /ลูกค้าพูดเอง/.test(ci));
check('client: legacy rows without new fields collapse silently (backward compat)',
  /const arr\s+= v => \(Array\.isArray\(v\) \? v\.filter\(Boolean\) : \[\]\);/.test(ci) &&
  /const fold = \(title, count, inner\) => inner/.test(ci) &&
  /เกมที่ควรเดิน/.test(ci));
// v_needsgemini (2026-08-17): ด่าน A/B ชั่วคราว (sweepAbGemini) ถอดออกแล้ว —
// เคาะโมเดลจบแล้ว (Gemini ชนะ) ตามที่ migration ของมันตั้งใจไว้แต่แรก
check('worker: cron sweep is the real engine (waitUntil ~30s kill found in live test)',
  /async scheduled\(event, env, cfCtx\)/.test(worker) &&
  /cfCtx\.waitUntil\(sweepPending\(env\)\);/.test(worker) &&
  !/async function sweepAbGemini/.test(worker) && !/sweepAbGemini\(env\)/.test(worker) &&
  /and\(pipeline_stage\.eq\.transcribed,status\.eq\.draft\)/.test(worker));
// v_queue (2026-08-12): ข้อเดิมล็อกว่า "cron ต่อ stage ในตัวเอง + limit=3" ซึ่งกลับ
// ด้านแล้วด้วยเหตุผลเชิงตัวเลข: Free plan ให้ 50 subrequest/invocation แต่
// stage1+stage2 ใช้ได้ถึง ~51 และ limit=3 ทำให้ถึง 204 · ตอนนี้ 1 ขั้น/1 tick
// (รายละเอียดการล็อกใหม่อยู่ใน tools/verify_echo_queue.js)
check('worker: หนึ่ง tick ทำหนึ่งขั้นเท่านั้น — ไม่ต่อ stage ในตัวเอง',
  !/\} else \{\s*\n\s*await processSession\(sessionId, null, env\);/.test(worker) &&
  /limit=1/.test(worker));

// v_falseproof (2026-08-19): Bush caught live — same rep checked into the same
// account 3× within ~2hr with zero guard, and one of those 3 was ~19km from
// anywhere that same account had ever been checked into before (a genuinely
// different place). Both are soft warn+confirm, not a hard block (his own
// call — a real "forgot something, went back" visit or a large/multi-building
// account shouldn't get silently blocked).
console.log('\n── 8. v_falseproof: duplicate check-in + location-mismatch warnings ──');
check('มีเช็ค "เช็คอินร้านเดิมซ้ำภายใน 2 ชม." ก่อนถือว่าเช็คอินสำเร็จ',
  /CI_DUPE_CHECKIN_WINDOW_MS = 2 \* 60 \* 60 \* 1000/.test(ci) &&
  /_checkRecentDuplicateCheckin\(_accountGuid, email\)/.test(ci));
check('มีเช็ค "ตำแหน่งห่างจากที่เคยเช็คอินร้านนี้มาก่อน" (ไม่มีที่อยู่จริงเก็บไว้ในระบบ)',
  /CI_LOCATION_MISMATCH_M = 2000/.test(ci) &&
  /_checkLocationMismatch\(_accountGuid, pos\.coords\.latitude, pos\.coords\.longitude\)/.test(ci));
check('บัญชีที่ยังไม่มีประวัติเช็คอิน = ปล่อยผ่าน ไม่ใช่ false positive',
  /if \(!data \|\| !data\.length\) return null;/.test(ci));
check('ทั้งสองเช็คทำก่อนตั้ง _checkinCache/โชว์ UI สำเร็จ (ยกเลิกแล้วต้องไม่ค้าง false success)',
  (() => {
    const iChecks = ci.indexOf('_checkRecentDuplicateCheckin(_accountGuid, email)');
    const iCache = ci.indexOf('_checkinCache = {', iChecks);
    return iChecks > -1 && iCache > iChecks;
  })());
check('ยกเลิกที่เตือน "เช็คอินซ้ำ" → เอา orb-snapping ออก + รีเซ็ต hint + return ทันที',
  /คุณเช็คอินร้านนี้ไปแล้วเมื่อ[\s\S]{0,450}core\.classList\.remove\('orb-snapping'\);\s*if \(hint\) hint\.textContent = 'กดเพื่อเช็คอิน';\s*return;/.test(ci));
check('ยกเลิกที่เตือน "ตำแหน่งไม่ตรง" → เอา orb-snapping ออก + รีเซ็ต hint + return ทันที',
  /ตำแหน่งที่เช็คอินอยู่ห่างจากที่เคยเช็คอินร้านนี้มาก่อน[\s\S]{0,250}core\.classList\.remove\('orb-snapping'\);\s*if \(hint\) hint\.textContent = 'กดเพื่อเช็คอิน';\s*return;/.test(ci));
check('query ล้มเหลว = คืน null เงียบๆ (เช็คพัง ต้องไม่บล็อกเช็คอินจริง)',
  /async function _checkRecentDuplicateCheckin[\s\S]{0,600}catch \(_\) \{ return null; \}/.test(ci) &&
  /async function _checkLocationMismatch[\s\S]{0,900}catch \(_\) \{ return null; \}/.test(ci));

// v_deadcapture (2026-08-20): 5 จาก 20 การอัดยาวได้ไฟล์แทบว่าง (25%) โดยนาฬิกา
// บนจอยังนับครบ · ต้นเหตุ: _recorder.stop() เคยมีแค่ใน stopRecording()/cancel()
// แต่ open() รีเซ็ต _phase='idle' แล้วเรียก _unmount() ที่ไม่เคยหยุด recorder เลย
// → ตัวอัดเก่าค้างจับไมค์ → กดอัดใหม่ได้ตัวอัดซ้อนสองตัว แล้วตัวจริงตายเงียบๆ
// ข้อพวกนี้ล็อกไว้ไม่ให้ "ทางออกที่ไม่ปิดไมค์" กลับมาอีก
console.log('\n── 9. v_deadcapture: ปิดไมค์สนิททุกทางออก + รายงานสาเหตุตรงความจริง ──');
// ผูกกับ "เนื้อในฟังก์ชัน" ไม่ใช่ทั้งไฟล์ — รีวิวชี้ว่าถ้าเช็คทั้งไฟล์ ใครย้าย
// _releaseWakeLock() ออกไปไว้ที่ cancel() แทน เช็คก็ยังเขียวทั้งที่ teardown พังแล้ว
const _tearBody = (() => {
  const i = ci.indexOf('function _teardownRecorder(reason, opts)');
  return i < 0 ? '' : ci.slice(i, i + 1400);
})();
check('มี _teardownRecorder ทางออกเดียวที่ปิด recorder/track/audioCtx/wakelock ครบ',
  !!_tearBody &&
  /r\.stream\?\.getTracks\(\)\.forEach/.test(_tearBody) &&
  /_audioCtx\.close\(\)/.test(_tearBody) &&
  /_releaseWakeLock\(\);/.test(_tearBody));
// ข้อที่รีวิวบอกว่า "ขาดแล้วอันตรายที่สุด": ถ้ากลับเงื่อนไขนี้ stopRecording() จะ
// เลิกยิง pipeline เงียบๆ โดยเช็คอื่นทั้งหมดยังเขียว = บั๊กที่หมวดนี้ตั้งใจกันพอดี
check('teardown ถอด onstop เฉพาะตอนไม่ใช่การกดหยุดเอง (กลับเงื่อนไข = pipeline ตายเงียบ)',
  /if \(!keepOnStop\) r\.onstop = null;/.test(_tearBody));
check('_unmount ไม่ฆ่าไมค์ของ "งานใหม่" ตอน pipeline ของงานเก่าจบ',
  /if \(_phase !== 'recording'\) _teardownRecorder\('unmount'\);/.test(ci));
check('ขอไมค์ได้แล้วแต่ตั้ง recorder ไม่สำเร็จ ต้องปิดสตรีมทิ้ง (ไม่งั้นไมค์ค้างแบบเดิม)',
  /_pendingStream = await navigator\.mediaDevices\.getUserMedia/.test(ci) &&
  /_pendingStream\?\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(ci));
// เทสต์จริงจับได้ว่าเวอร์ชันแรกที่ใช้ document.visibilityState พัง — บางที่รายงาน
// hidden ทั้งที่แอปถูกใช้อยู่ = watchdog เงียบทั้งรอบ · ต้องวัดอาการ ไม่ใช่เชื่อธง
check('watchdog ข้ามรอบที่เพิ่งถูก throttle โดยวัดจากช่วงห่างของทิกเอง (ไม่พึ่ง visibilityState)',
  (() => {
    // ตัดคอมเมนต์ก่อนเทียบ — คอมเมนต์อธิบายว่า "เดิมเคยเขียนแบบไหนแล้วพัง" จะไป
    // ชนกับเงื่อนไขปฏิเสธเอง (โดนกับดักนี้เป็นครั้งที่สองในรอบเดียว)
    const code = ci.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    return /const _tickGap = now - \(_recLastTickAt \|\| now\);/.test(code) &&
           /if \(_tickGap > REC_WATCH_TICK_MS \* 3\)/.test(code) &&
           !/visibilityState === 'hidden'/.test(code);
  })());
check('OS หยุด recorder เอง = ปรับ _phase ให้ตรงก่อนเข้า pipeline',
  /async function _onStop\(\)[\s\S]{0,700}if \(_phase === 'recording'\) \{[\s\S]{0,300}_teardownRecorder\('os-forced'/.test(ci));
check('keep-alive ยังปิดอยู่จนกว่าจะทดสอบบน iPhone จริง (กันทำเสียงทุกคนแย่ลง)',
  /const REC_KEEPALIVE_ENABLED = false;/.test(ci) &&
  /if \(REC_KEEPALIVE_ENABLED\) \{/.test(ci));
check('idempotent: เคลียร์ _recorder = null ก่อนเรียก stop() (กันเข้าซ้อน/เรียกซ้ำ)',
  (() => {
    const i = ci.indexOf('function _teardownRecorder(reason, opts)');
    if (i < 0) return false;
    const iNull = ci.indexOf('_recorder = null;', i);
    const iStop = ci.indexOf('r.stop();', i);
    return iNull > -1 && iStop > iNull;
  })());
check('_unmount() ปิดไมค์ "ก่อน" early-return (นี่คือเส้นที่ open() ใช้)',
  (() => {
    const i = ci.indexOf('function _unmount()');
    if (i < 0) return false;
    const iTear = ci.indexOf('_teardownRecorder(', i);
    const iRet  = ci.indexOf('if (!el) return;', i);
    return iTear > -1 && iRet > iTear;
  })());
check('stopRecording() ส่ง keepOnStop:true — การกดหยุดเองต้องยิง pipeline ต่อ',
  /_teardownRecorder\('user-stop', \{ keepOnStop: true \}\)/.test(ci));
check('cancel() ไม่ส่ง keepOnStop — ยกเลิกแล้วห้ามยิง pipeline',
  /_teardownRecorder\('cancel'\)/.test(ci));
check('startRecording() ปิดไมค์ที่ค้างก่อนขอ getUserMedia ใหม่เสมอ',
  /if \(_recorder\) _teardownRecorder\('stale-before-start'\)/.test(ci));
check('visibility guard ใช้ teardown ตัวเดียวกัน (ไม่หยุด track เองแบบเดิม)',
  /_teardownRecorder\('os-stopped', \{ keepOnStop: true \}\)/.test(ci));
check('จำ _recMime ไว้ เพราะ _recorder ถูกเคลียร์ก่อน _onStop จะอ่าน mimeType',
  /let _recMime\s+= '';/.test(ci) &&
  /_recMime\s+= _recorder\.mimeType \|\| mime \|\| 'audio\/webm';/.test(ci) &&
  /new Blob\(_chunks, \{ type: _recorder\?\.mimeType \|\| _recMime \|\| 'audio\/webm' \}\)/.test(ci));
check('เลข "ได้เสียงกี่นาที" คิดจากขนาดไฟล์จริง ไม่ใช่บิตเรตที่สั่ง (เคยเกินจริง ~49%)',
  /const REC_REAL_BYTES_PER_SEC = 6800;/.test(ci) &&
  /gotMins = Math\.round\(blobSize \/ REC_REAL_BYTES_PER_SEC \/ 60\)/.test(ci));
check('ข้อความเลิกบอกว่า "ไฟล์ถูกตัด" และเลิกโทษ rep เรื่องล็อกจอ',
  (() => {
    // ต้องตัดบรรทัดคอมเมนต์ทิ้งก่อน — คอมเมนต์ v_deadcapture อ้างถึงข้อความเก่า
    // แบบใส่เครื่องหมายคำพูดไว้อธิบายว่าเอาอะไรออก ถ้าเทียบทั้งไฟล์จะจับตัวเองพลาด
    const code = ci.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    return /ไมค์ไม่ได้รับเสียงตลอดการอัด/.test(code) &&
           !/ครั้งหน้าลองไม่ล็อกจอ/.test(code) &&
           !/ไฟล์เสียงไม่สมบูรณ์/.test(code);
  })());

// v_recwatch (2026-08-20): จับ "อัดอยู่แต่ไม่ได้เสียง" ระหว่างอัด ไม่ใช่ตอนกดหยุด
// ค่าคงที่ทุกตัวมาจากการวัดจริงบนเบราว์เซอร์ (สตรีมเงียบ = 0 B/วิ + chunk หยุดส่ง,
// สตรีมมีเสียง = 6,556 B/วิ) ห้ามแก้เป็นค่าที่ "เดาว่าน่าจะพอ" โดยไม่วัดใหม่
console.log('\n── 10. v_recwatch: watchdog + แถบเตือน + keep-alive ตัวจริง ──');
check('ค่าคงที่ watchdog ครบและตรงกับที่วัดมา',
  /REC_WATCH_START_SEC = 45/.test(ci) && /REC_WATCH_WINDOW_MS = 30000/.test(ci) &&
  /REC_DEAD_BPS\s+= 1500/.test(ci) && /REC_NO_CHUNK_MS\s+= 10000/.test(ci));
check('ondataavailable นับทุก chunk "ก่อน" ตัวกรอง size > 0 (ไม่งั้นแยกเงียบ/ตายไม่ออก)',
  (() => {
    const i = ci.indexOf('_recorder.ondataavailable = e => {');
    if (i < 0) return false;
    const seg = ci.slice(i, i + 420);
    return seg.indexOf('_recBytes += sz;') > -1 &&
           seg.indexOf('_recBytes += sz;') < seg.indexOf('if (sz > 0)');
  })());
check('ด่านหลักคือ chunk หยุดส่ง (สัญญาณที่วัดแล้วชัดที่สุด)',
  /if \(now - _recLastDataAt > REC_NO_CHUNK_MS\) \{ _onDeadCapture\('no-chunk'\); return; \}/.test(ci));
check('ด่านรองวัดบิตเรตในหน้าต่างย้อนหลัง ไม่ใช่ค่าเฉลี่ยทั้ง session',
  /const bps = \(_recBytes - oldest\.b\) \/ dt;/.test(ci) &&
  /if \(bps < REC_DEAD_BPS\) _onDeadCapture/.test(ci));
check('ยังไม่ตัดสินก่อน 45 วิ (กัน false positive ตอนไมค์อุ่นเครื่อง)',
  /if \(\(now - _startTime\) \/ 1000 < REC_WATCH_START_SEC\) return;/.test(ci));
check('ฟังสัญญาณตรงจาก OS: track.onended / onmute (มี grace) / onunmute / recorder.onerror',
  /t\.onended\s+= \(\) => _onDeadCapture\('track-ended'\)/.test(ci) &&
  /setTimeout\(\(\) => \{ if \(t\.muted\) _onDeadCapture\('track-muted'\); \}, REC_MUTE_GRACE_MS\)/.test(ci) &&
  /t\.onunmute = \(\) => \{ clearTimeout\(_recMuteTimer\)/.test(ci) &&
  /_recorder\.onerror = ev => _onDeadCapture\('recorder-error:'/.test(ci));
check('เตือนแล้วไม่สแปม: sticky + กด "อัดต่อ" ได้ช่วงพัก 2 นาทีก่อนเตือนซ้ำ',
  /if \(_recDeadFired \|\| _phase !== 'recording'\) return;/.test(ci) &&
  /REC_DEAD_COOLDOWN_MS = 120000/.test(ci) &&
  /if \(_recDeadCooldownUntil && Date\.now\(\) < _recDeadCooldownUntil\) return;/.test(ci) &&
  /function _recDismissDead\(\)[\s\S]{0,500}_recDeadCooldownUntil = Date\.now\(\) \+ REC_DEAD_COOLDOWN_MS;/.test(ci));
check('ไมค์ตายแล้วกดจบ ต้องไม่ขึ้น "บันทึกอย่างน้อย 5 วินาที" ทั้งที่อัดไป 45 นาที',
  /_toast\(_recDeadFired \|\| _secs >= 60\s*\n?\s*\? 'ไมค์ไม่ได้รับเสียง จึงไม่มีอะไรให้วิเคราะห์/.test(ci));
check('แถบเตือนค้างบนจอ + สั่นเครื่อง + ส่ง telemetry (ไม่ใช่ toast ที่หายเอง)',
  /id="ci-rec-dead"/.test(ci) && /navigator\.vibrate\(\[200, 100, 200\]\)/.test(ci) &&
  /SenseSentinel\.report\('echo_dead_capture'/.test(ci));
check('keep-alive เล่นบัฟเฟอร์ศูนย์ล้วนวนลูปจริง ไม่ใช่ context เปล่าแบบเดิม',
  /_audioKeepSrc\.buffer = _buf;/.test(ci) && /_audioKeepSrc\.loop\s+= true;/.test(ci) &&
  /_audioKeepSrc\.connect\(_audioCtx\.destination\);/.test(ci) && /_audioKeepSrc\.start\(\);/.test(ci));
check('watchdog ปลุก AudioContext ที่ถูก iOS พักกลับมาทุกรอบ',
  /if \(_audioCtx && _audioCtx\.state !== 'running'\) _audioCtx\.resume\(\)/.test(ci));
check('teardown เก็บกวาด watchdog + keep-alive + mute timer ครบ (ไม่รั่วข้ามรอบอัด)',
  (() => {
    const i = ci.indexOf('function _teardownRecorder(reason, opts)');
    if (i < 0) return false;
    const seg = ci.slice(i, i + 900);
    return /clearInterval\(_recWatchRef\)/.test(seg) && /clearTimeout\(_recMuteTimer\)/.test(seg) &&
           /_audioKeepSrc\.stop\(\)/.test(seg);
  })());
check('กลับมาจากเบื้องหลัง = ตั้งฐาน watchdog ใหม่ (กัน false positive ที่จะเจอบ่อยสุด)',
  (() => {
    const i = ci.indexOf('function _initVisibilityGuard()');
    if (i < 0) return false;
    const seg = ci.slice(i, i + 2200);
    return /_recorder\.state === 'recording'/.test(seg) &&
           /_recLastDataAt = Date\.now\(\);/.test(seg) &&
           /_recSamples = \[\{ t: Date\.now\(\), b: _recBytes \}\]/.test(seg);
  })());
// v_recwatch (2026-08-20): ช่องโหว่เชิงกระบวนการที่รีวิวจับได้ และอันตรายเงียบที่สุด
// — harness ทั้งไฟล์นี้อ่านแต่ src/ แต่ของที่ผู้ใช้โหลดจริงคือ index.html ที่ build
// มาแล้ว ถ้าลืมรัน build.py จะ commit src ที่ถูกต้องแต่ผู้ใช้ไม่ได้อะไรเลย และ
// harness ก็ยังเขียวสนิท (เคยเกิดจริงในรอบนี้) จึงต้องเทียบของที่ "ส่งจริง" ด้วย
check('index.html ที่ส่งจริง build มาจาก src ล่าสุดแล้ว (ไม่ใช่ของค้างรอบก่อน)',
  (() => {
    const built = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const markers = [
      'function _teardownRecorder(reason, opts)',
      "if (_phase !== 'recording') _teardownRecorder('unmount');",
      "if (document.visibilityState === 'hidden') return;",
      'const REC_KEEPALIVE_ENABLED = false;',
      'REC_DEAD_COOLDOWN_MS = 120000',
      '_pendingStream = await navigator.mediaDevices.getUserMedia'
    ];
    const missing = markers.filter(m => built.indexOf(m) < 0);
    if (missing.length) console.log('      ↳ index.html ขาด: ' + missing[0]);
    return missing.length === 0;
  })());
check('ห้ามกลับไปใช้ createMediaStreamSource กับสตรีมไมค์ (เคยทำสัญญาณเพี้ยน)',
  !/createMediaStreamSource/.test(ci.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n')));

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
