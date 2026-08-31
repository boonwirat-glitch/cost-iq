#!/usr/bin/env node
// tools/verify_churn_age_filter.js — v_churnage (2026-08-31)
//
// เลข churn ของแต่ละเดือนวัดเทียบเดือนฐานอย่างเป็นอิสระ ⇒ ร้านที่เงียบสองเดือนติด
// ถูกนับซ้ำทั้งสองเดือน · ส.ค. 2026: 517 ร้าน = เงียบต่อเนื่องจาก ก.ค. ~263
// + เพิ่งหลุดเดือนนี้ ~251 · สองกลุ่มนี้ต้องทำคนละอย่าง แต่เดิมปนกันในลิสต์เดียว
// จนไล่ไม่ไหว — บุชขอปุ่มแยก 2026-08-31
//
// ล็อกไว้ 3 อย่าง:
//   1. แยกครบ ไม่ตกหล่น (เพิ่งหลุด + ต่อเนื่อง = ทั้งหมดเสมอ)
//   2. ปุ่มขึ้นเฉพาะตอนที่มีความหมาย — เดือนแรกของไตรมาสไม่มีเดือนก่อนให้เทียบ
//      และแผงที่มีหลายประเภทปนกันก็ตีความปุ่มนี้ไม่ได้
//   3. ตัวกรองผูกกับ nrrSlideoverVisibleOutlets ตัวเดียวกับที่ export ใช้ —
//      ไม่งั้นไฟล์ที่ได้จะไม่ตรงกับที่ตาเห็น (กติกาเดิมจาก v_slideexport)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const V = fs.readFileSync(path.join(__dirname, '..', 'src', 'nrr', 'nrr_view.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + (d || ''))); };

function grab(name) {
  const i = V.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('ไม่เจอ ' + name);
  let d = 0, j = V.indexOf('{', i);
  for (let k = j; k < V.length; k++) {
    if (V[k] === '{') d++;
    else if (V[k] === '}') { d--; if (!d) return V.slice(i, k + 1); }
  }
}

function ctx(rows, outlets, period) {
  const sb = {
    console,
    QNRR_CFG: { q_months: ['2026-07', '2026-08', '2026-09'], months_th: { '2026-07': 'ก.ค.', '2026-08': 'ส.ค.' } },
    nrrEsc: s => String(s == null ? '' : s),
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('var nrrSlideoverOutlets=[], nrrSlideoverState={};' +
    ['_nrrPrevQuarterMonth', '_nrrChurnAge', '_nrrPrevMonthIndex', '_nrrSlideoverChurnSplit',
     'nrrSlideoverVisibleOutlets', '_nrrSlideoverRowMomentum'].map(grab).join('\n'), sb);
  sb.window.bulkQnrrData = { allRows: rows };
  sb.__o = outlets;
  vm.runInContext('nrrSlideoverOutlets=__o; nrrSlideoverState={period:' + JSON.stringify(period) +
    ', movementFilter:"all", momentumFilter:"all", kamFilter:"all", churnAgeFilter:"all", search:""};', sb);
  return sb;
}

const churnRow = (id, month) => ({ outlet_id: id, period_month: month, movement_type: 'core_nrr', curr_gmv: '0', base_gmv: '10000', base_days: '30', account_name: 'ร้าน ' + id });
const activeRow = (id, month) => ({ outlet_id: id, period_month: month, movement_type: 'core_nrr', curr_gmv: '9000', base_gmv: '10000', base_days: '30', account_name: 'ร้าน ' + id });

console.log('\n── แยกกลุ่มถูกไหม ──');
{
  // A เงียบทั้ง ก.ค.+ส.ค. · B ก.ค. ปกติ ส.ค. เงียบ · C ไม่มีแถว ก.ค. เลย
  const rows = [churnRow('A', '2026-07'), activeRow('B', '2026-07'),
                churnRow('A', '2026-08'), churnRow('B', '2026-08'), churnRow('C', '2026-08')];
  const outs = rows.filter(r => r.period_month === '2026-08').map(r => ({ row: r, movement: 'core_nrr_churn' }));
  const sb = ctx(rows, outs, '2026-08');
  const split = vm.runInContext('_nrrSlideoverChurnSplit()', sb);
  check('เงียบสองเดือนติด → ต่อเนื่อง · เพิ่งเงียบ → เพิ่งหลุด',
    split.ongoing === 1 && split.fresh === 2, JSON.stringify(split));
  check('เพิ่งหลุด + ต่อเนื่อง = ทั้งหมด ไม่มีร้านตกหล่น',
    split.fresh + split.ongoing === outs.length);
  check('ร้านที่ไม่มีแถวเดือนก่อนเลย นับเป็นเพิ่งหลุด (ไม่ใช่ปล่อยว่าง)',
    vm.runInContext('_nrrChurnAge({outlet_id:"C"},"2026-08",_nrrPrevMonthIndex("2026-08"))', sb) === 'new');
  check('ป้ายบอกชื่อเดือนก่อนหน้า ไม่ใช่คำลอยๆ', split.prevLabel === 'ก.ค.');
}

console.log('\n── ปุ่มต้องขึ้นเฉพาะตอนที่มีความหมาย ──');
{
  const rows = [churnRow('A', '2026-07')];
  const outs = [{ row: churnRow('A', '2026-07'), movement: 'core_nrr_churn' }];
  check('เดือนแรกของไตรมาส (ไม่มีเดือนก่อนให้เทียบ) → ไม่ขึ้นปุ่ม',
    vm.runInContext('_nrrSlideoverChurnSplit()', ctx(rows, outs, '2026-07')) === null,
    'ปุ่มที่กดแล้วได้เท่าเดิม แย่กว่าไม่มีปุ่ม');
}
{
  const rows = [churnRow('A', '2026-07'), churnRow('A', '2026-08'), activeRow('B', '2026-08')];
  const outs = [{ row: churnRow('A', '2026-08'), movement: 'core_nrr_churn' },
                { row: activeRow('B', '2026-08'), movement: 'core_nrr' }];
  check('แผงที่มีหลายประเภทปนกัน → ไม่ขึ้นปุ่ม (ความหมายจะกำกวม)',
    vm.runInContext('_nrrSlideoverChurnSplit()', ctx(rows, outs, '2026-08')) === null);
}

console.log('\n── ตัวกรองต้องมีผลจริง และผูกกับตัวเดียวกับที่ export ใช้ ──');
{
  const rows = [churnRow('A', '2026-07'), activeRow('B', '2026-07'),
                churnRow('A', '2026-08'), churnRow('B', '2026-08')];
  const outs = rows.filter(r => r.period_month === '2026-08').map(r => ({ row: r, movement: 'core_nrr_churn' }));
  const sb = ctx(rows, outs, '2026-08');
  const n = f => {
    vm.runInContext('nrrSlideoverState.churnAgeFilter=' + JSON.stringify(f) + ';', sb);
    return vm.runInContext('nrrSlideoverVisibleOutlets().length', sb);
  };
  check('เลือก "เพิ่งหลุดเดือนนี้" → เหลือเฉพาะร้านนั้น', n('new') === 1);
  check('เลือก "เงียบต่อเนื่อง" → เหลือเฉพาะร้านนั้น', n('ongoing') === 1);
  check('เลือก "ทั้งหมด" → กลับมาครบ', n('all') === 2);
  check('ตัวกรองอยู่ใน nrrSlideoverVisibleOutlets — ไฟล์ที่ export จึงตรงกับที่เห็น',
    /churnAgeFilter/.test(grab('nrrSlideoverVisibleOutlets')),
    'ถ้าไปกรองตอนวาดจออย่างเดียว ไฟล์จะได้ทั้ง 517 ร้านทั้งที่จอโชว์ 251');
}

console.log('\n── ผูกเข้าหน้าจอแล้วจริง ──');
check('มีที่วางปุ่มในแผง', /id="nrr-slideover-churnage-chips"/.test(V));
check('เปิดแผงใหม่แล้วตัวกรองรีเซ็ตเป็นทั้งหมด', /churnAgeFilter: 'all',\s*\/\/ v_churnage/.test(V));
check('ปิดแผงประเภทอื่นแล้วปุ่มไม่ค้าง', (V.match(/nrr-slideover-churnage-chips'\);\s*\n\s*if \(_caEl\)/g) || []).length >= 1);

console.log('\n' + (fail ? '❌' : '✅') + ' verify_churn_age_filter: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
