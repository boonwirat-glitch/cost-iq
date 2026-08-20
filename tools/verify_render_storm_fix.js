#!/usr/bin/env node
// tools/verify_render_storm_fix.js — v_renderstorm (2026-08-20)
//
// บุชรายงาน: PWA ปิดตัวเองทันทีตอนเปิดหน้า Portfolio — เฉพาะ account admin
// (boonwirat.t@freshket.co, เห็นทุกบัญชีทั้งบริษัท) ตรวจ app_errors table เจอ
// diagnostic 'render_storm' ที่มีอยู่แล้วในโค้ด (v561, ไม่เคยเปลี่ยนพฤติกรรม แค่
// นับ) รายงานว่า renderPortviewTargetBar / renderTeamviewKamList ถูกเรียกซ้ำ
// ≥7 ครั้งภายใน 10 วิ — เกิดซ้ำทุกวันตั้งแต่ 13 ส.ค. ถึง 20 ส.ค. (v257→v272)
// เฉพาะ role admin เท่านั้น บนทั้ง iPhone และ Mac Chrome
//
// สาเหตุ: มีอย่างน้อย 6 ไฟล์ (data pipeline, commission engine/cockpit/history,
// qnrr view, nrr target) ต่างคนต่างเรียกวาดสองฟังก์ชันนี้ตรงๆ ทันทีที่ข้อมูล
// ของตัวเองโหลดเสร็จ ไม่มีใครรวมคำสั่งกัน ตอนบูตครั้งแรกของ admin ซึ่งต้องรอ
// ข้อมูลมากกว่า KAM ทั่วไปมาก (ทุกทีมทุกบัญชี) หลายระบบจึงโหลดเสร็จไล่เลี่ยกัน
// วาดซ้ำซ้อนกันหลายรอบ แต่ละรอบคำนวณ pace/GMV/target ของทุกบัญชีทั้งบริษัท
// จน CPU/memory พุ่งจน iOS ฆ่า WKWebView ทิ้ง
//
// แก้: เพิ่ม scheduleRenderPortviewTargetBar / scheduleRenderTeamviewKamList
// (06_portview_teamview.js) — ตัวรวมคำสั่งแบบเดียวกับ schedulePortviewListRender
// ที่มีอยู่แล้ว (clearTimeout เดิม + ตั้งใหม่ ทำให้หลายคำสั่งที่มาไล่เลี่ยกันยุบ
// เหลือการวาดจริงแค่ครั้งเดียว) แล้วสลับจุดเรียก "เพราะข้อมูลพื้นหลังโหลดเสร็จ"
// ให้ผ่านตัวนี้แทนเรียกตรง — จุดที่ผู้ใช้กดเอง (ล้างช่องค้นหา/สลับมุมมอง/เปิดจอ
// ครั้งแรก) ยังคงเรียกตรงเหมือนเดิม เพราะต้องวาดทันทีไม่ควรหน่วง
//
// ⚠ นี่คือการลดโอกาสจากหลักฐานจริง (app_errors) ไม่ใช่การพิสูจน์ว่าเป็นสาเหตุ
// เดียวของการปิดตัว — ตัว render_storm detector ยังอยู่ ใช้เช็คต่อว่ายังเกิดซ้ำ
// กับ admin ไหมหลัง deploy (แจ้งครั้งเดียวต่อฟังก์ชันต่อ session ใน app_errors)
//
// Usage: node tools/verify_render_storm_fix.js

const fs = require('fs');
const path = require('path');

const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const PV  = SRC('06_portview_teamview.js');
const DP  = SRC('02_data_pipeline.js');
const CH  = SRC('07b_commission_history.js');
const CE  = SRC('07a_commission_engine.js');
const QV  = SRC('07c_qnrr_view.js');
const NT  = SRC('07b_nrr_target.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('── render storm: ตัวรวมคำสั่งมีอยู่จริง ──');

check('scheduleRenderPortviewTargetBar ใช้ shared timer (clearTimeout ตัวเดิมก่อนตั้งใหม่)',
  /let _tgtBarRenderTimer=null/.test(PV) &&
  /function scheduleRenderPortviewTargetBar\(delay\)\{\s*\n\s*clearTimeout\(_tgtBarRenderTimer\)/.test(PV));
check('scheduleRenderTeamviewKamList ใช้ shared timer เช่นกัน',
  /let .*_tvKamListRenderTimer=null/.test(PV) &&
  /function scheduleRenderTeamviewKamList\(delay\)\{\s*\n\s*clearTimeout\(_tvKamListRenderTimer\)/.test(PV));
check('ดีเลย์พื้นฐาน 500ms (นานกว่า schedulePortviewListRender ของเดิมเพราะฟังก์ชันหนักกว่า)',
  /delay==null\?500:delay/.test(PV));

console.log('\n── จุดที่ "ข้อมูลพื้นหลังโหลดเสร็จ" ต้องผ่านตัวรวมคำสั่ง (ไม่เรียกตรง) ──');

check('data_pipeline.js: 3 จุด callback ใช้ scheduler แทนเรียกตรง',
  (DP.match(/scheduleRenderPortviewTargetBar\(/g) || []).length >= 1 &&
  (DP.match(/schedulePortviewListRender\(/g) || []).length >= 2 &&
  (DP.match(/scheduleRenderTeamviewKamList\(/g) || []).length >= 2);
check('commission_history.js: schedulePortviewRefresh ใช้ scheduler ทั้งสองตัว',
  /scheduleRenderPortviewTargetBar\(/.test(CH) && /schedulePortviewListRender\(/.test(CH));
check('commission_engine.js: closeTargetSetup ใช้ scheduler ทั้งสองตัว',
  /scheduleRenderPortviewTargetBar\(/.test(CE) && /scheduleRenderTeamviewKamList\(/.test(CE));
check('qnrr_view.js: self-heal after refetch ใช้ scheduler ทั้งสองตัว',
  /scheduleRenderPortviewTargetBar\(/.test(QV) && /scheduleRenderTeamviewKamList\(/.test(QV));
check('nrr_target.js: boot IIFE (_waitAndRenderBars) ใช้ scheduler ทั้งสองตัว',
  /if\(typeof scheduleRenderPortviewTargetBar==='function'\) scheduleRenderPortviewTargetBar\(\)/.test(NT) &&
  /if\(typeof scheduleRenderTeamviewKamList==='function'\) scheduleRenderTeamviewKamList\(\)/.test(NT));
check('nrr_target.js: targets-loaded branch (ภายใน renderPortviewTargetBar เอง) ใช้ scheduler',
  /typeof scheduleRenderTeamviewKamList==='function'\)\{\s*\n\s*scheduleRenderTeamviewKamList\(\);/.test(NT));

console.log('\n── จุดที่ผู้ใช้กดเอง ต้องยังเรียกตรง (ห้ามหน่วง) ──');

check('renderTeamview() ตอนเปิดหน้าจอครั้งแรก ยังเรียก renderTeamviewKamList() ตรง',
  /renderTeamviewSummary\(\);\s*\n\s*renderTeamviewKamList\(\);/.test(PV));
check('setTvView() ตอนผู้ใช้สลับมุมมอง ยังเรียก renderTeamviewKamList() ตรง',
  /function setTvView\(mode\)\{\s*\n\s*tvViewMode=mode;\s*\n\s*renderTeamviewKamList\(\);/.test(PV));
check('ปุ่มล้างช่องค้นหา (search-collapsed) ยังเรียก renderTeamviewKamList() ตรง',
  /ts\.value='';renderTeamviewKamList\(\);/.test(PV));
check('renderPortviewList hook ภายใน (ตอบสนองพิมพ์ค้นหา) ยังใช้ setTimeout ตรงของตัวเอง 80ms',
  /window\.renderPortviewList = function\(\) \{[\s\S]{0,600}setTimeout\(\(\) => \{ renderPortviewTargetBar\(\); renderPortviewNRRBar\(\); \}, 80\);/.test(NT));

console.log('\n' + (fail ? `❌ verify_render_storm_fix: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_render_storm_fix: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
