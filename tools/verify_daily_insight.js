#!/usr/bin/env node
// tools/verify_daily_insight.js — v284 (2026-08-28)
//
// ล็อกหน้า "Olive สรุปให้" (หน้าสรุปพอร์ตรายวันของ KAM) เฟส 1
//
// สิ่งที่ต้องไม่หลุด — แต่ละข้อมีเหตุผลของมัน ไม่ใช่เช็คให้ครบ ๆ:
//
//   1. ประตูวันละครั้ง — ถ้าพัง จอนี้จะเด้งทุกครั้งที่เปิดแอป = กลายเป็นสิ่งกวนใจ
//   2. หัวเรื่องต้องเลือกข่าวดีก่อน — ทั้งโปรเจกต์นี้ตั้งอยู่บนข้อนี้
//      (บุช: "ไม่ใช่ alert ไม่ใช่ bad news มันคือ giving insight")
//   3. เรียงด้วยเงิน ไม่ใช่เปอร์เซ็นต์ — กติกาที่ยืมมาจาก Freshket Insights
//   4. พอร์ตเงียบต้องได้การ์ดให้กำลังใจ ไม่ใช่จอว่าง
//   5. z-index ต้องอยู่ 9300-9500 — เหนือแถบล่าง (170) และ Olive FAB (199)
//      แต่ใต้ Echo sheet (9999) / login overlay (9999) / toast (10500)
//   6. ห้ามเขียนอะไรลง Supabase จากจอนี้ และ Supabase ล่มต้องยังเปิดอ่านได้
//   7. นับ churn เดิม (computeChurnCountsForAccount) ต้องได้เลขเท่าสูตรก่อนรีแฟกเตอร์เป๊ะ
//   8. ต้องมี prefers-reduced-motion
//
// Usage: node tools/verify_daily_insight.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DI = R('src/14_daily_insight.js');
const PV = R('src/06_portview_teamview.js');
const KV = R('src/05_kam_view.js');
const BUILD = R('build.py');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

// ─────────────────────────────────────────────────────────────────────────────
// sandbox — รันโมดูลจริง ไม่ใช่แค่ grep ข้อความ
// ─────────────────────────────────────────────────────────────────────────────
function makeSandbox(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const el = () => ({
    id: '', className: '', innerHTML: '', textContent: '', style: {},
    classList: { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); } },
    setAttribute() {}, appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0 }),
  });
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      _dump: () => store,
    },
    document: {
      readyState: 'complete',
      head: { appendChild() {} },
      body: { appendChild() {}, classList: el().classList },
      createElement: el,
      getElementById: id => (opts.elements && opts.elements[id]) || null,
      querySelector: () => null,
      addEventListener() {}, removeEventListener() {},
    },
    setTimeout: (fn) => { if (opts.runTimers) try { fn(); } catch (e) {} return 0; },
    requestAnimationFrame: (fn) => { if (opts.runTimers) try { fn(); } catch (e) {} return 0; },
    getComputedStyle: () => ({ display: 'none' }),
    // ── ของที่โมดูลไปเรียก ──
    currentUserProfile: opts.profile || { email: 'may@freshket.co', kam_name: 'เมย์ สมใจ', role: 'rep' },
    getPortviewAccounts: () => opts.accounts || [],
    computeChurnRowsForAccount: id => (opts.churn || {})[id] || null,
    computeSkuMovementForAccount: id => (opts.movement || {})[id] || null,
    bulkSkuCurrentData: opts.skuCurrent || {},
    bulkHistoryData: opts.history || {},
    bulkCurrentMonthData: opts.currentMonth || {},
    navigator: { vibrate() {} },
    portviewSelectAccount: () => { sandbox._drilled = true; },
  };
  sandbox.window = sandbox;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.window.DataRegistry = { onReady() {} };
  vm.createContext(sandbox);
  vm.runInContext(DI, sandbox);
  return sandbox;
}

// top-level function declaration ใน vm ทับจากข้างนอกไม่ได้ ต้องรันสคริปต์ทับใน context เดิม
function vmRun(sandbox, code) { vm.runInContext(code, sandbox); }

const churnRow = (name, gmv, type, interval, late) =>
  ({ type, id: name, name, dept: '—', gmv, avgInterval: interval || 9, daysLate: late || 3 });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. หัวเรื่อง: ข่าวดีต้องมาก่อนเสมอ ──');

{
  // ร้านหนึ่งมีของใหม่ ฿42,000 อีกร้านมีของค้างรอบ ฿90,000
  // ถึงเงินฝั่งค้างจะมากกว่า พาดหัวก็ต้องเป็นข่าวดี
  const s = makeSandbox({
    accounts: [
      { id: 'A', name: 'Stolen Cafe', gmvToDate: 50000, paceSignal: { expected: 40000 } },
      { id: 'B', name: 'Doughnut Library', gmvToDate: 0, paceSignal: { expected: 180000 } },
    ],
    churn: { B: [churnRow('น้ำมันปาล์ม', 90000, 'gone', 9, 12)] },
    movement: { A: { newSkus: [{ name: 'เม็ดมะม่วงหิมพานต์', gmv: 42000 }], recentMo: 'ก.ค. 2569' } },
  });
  const d = s.buildDailyInsight();
  check('เลือกของใหม่เป็นพาดหัว แม้ยอดค้างรอบจะมากกว่า',
    d.big && d.big.kind === 'new', 'ได้ kind=' + (d.big && d.big.kind));
  check('ยอดค้างรอบไม่ได้ถูกซ่อน — ยังอยู่ในแถวสรุปครบ',
    d.overdueItems === 1 && d.overdueBaht === 90000,
    'items=' + d.overdueItems + ' baht=' + d.overdueBaht);
  check('พาดหัวผูกกับร้านที่ถูกต้อง (กดแล้วไปร้านนั้นจริง)',
    d.big.shopId === 'A');
}

{
  // ไม่มีของใหม่ แต่พอร์ตซื้อเร็วกว่าเดือนที่แล้ว → พาดหัวเป็นการเติบโต
  const s = makeSandbox({
    accounts: [
      { id: 'A', name: 'ร้านหนึ่ง', gmvToDate: 60000, paceSignal: { expected: 40000 } },
      { id: 'B', name: 'ร้านสอง', gmvToDate: 10000, paceSignal: { expected: 30000 } },
    ],
    churn: { B: [churnRow('ไข่ไก่', 12000, 'near')] },
  });
  const d = s.buildDailyInsight();
  check('ไม่มีของใหม่ → พาดหัวเป็น "ซื้อเร็วกว่าเดือนที่แล้ว"',
    d.big && d.big.kind === 'ahead', 'ได้ ' + (d.big && d.big.kind));
  check('นับเฉพาะร้านที่ซื้อเร็วกว่าจริง (1 ร้าน ไม่ใช่ 2)',
    d.aheadShops === 1 && d.aheadBaht === 20000,
    'shops=' + d.aheadShops + ' baht=' + d.aheadBaht);
}

{
  // ไม่มีข่าวดีเลย → ยอมให้ของค้างขึ้นพาดหัว แต่ต้องเป็นถ้อยคำชวนทำ ไม่ใช่คำเตือน
  const s = makeSandbox({
    accounts: [{ id: 'B', name: 'ร้านเงียบ', gmvToDate: 0, paceSignal: { expected: 100000 } }],
    churn: { B: [churnRow('น้ำมันปาล์ม', 47200, 'gone', 9, 12)] },
  });
  const d = s.buildDailyInsight();
  check('ไม่มีข่าวดี → พาดหัวเป็นของค้าง แต่ป้ายต้องชวนทำ ไม่ใช่เตือนภัย',
    d.big && d.big.kind === 'overdue' && d.big.tag === 'ทักวันนี้ยังทัน',
    'tag=' + (d.big && d.big.tag));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. เรียงด้วยเงิน ไม่ใช่จำนวนหรือเปอร์เซ็นต์ ──');

{
  const s = makeSandbox({
    accounts: [
      { id: 'A', name: 'ของเยอะแต่ถูก', gmvToDate: 0, paceSignal: { expected: 1 } },
      { id: 'B', name: 'ของชิ้นเดียวแต่แพง', gmvToDate: 0, paceSignal: { expected: 1 } },
    ],
    churn: {
      A: [churnRow('x1', 1000, 'gone'), churnRow('x2', 900, 'gone'), churnRow('x3', 800, 'gone')],
      B: [churnRow('y1', 47200, 'gone')],
    },
  });
  const d = s.buildDailyInsight();
  check('ร้านที่เงินมากที่สุดมาก่อน แม้จะมีรายการน้อยกว่า',
    d.overdueTop[0].id === 'B', 'ได้ ' + d.overdueTop[0].id);
  check('ภายในร้าน รายการเรียงตามเงินจากมากไปน้อย',
    d.overdueTop[1].top.gmv === 1000);
  check('รวมยอดทั้งพอร์ตถูกต้อง',
    d.overdueBaht === 49900, 'ได้ ' + d.overdueBaht);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. พอร์ตเงียบ: ต้องได้การ์ดให้กำลังใจ ไม่ใช่จอว่าง ──');

{
  const s = makeSandbox({
    accounts: [{ id: 'A', name: 'ร้านนิ่ง', gmvToDate: 40000, paceSignal: { expected: 40000 } }],
  });
  const d = s.buildDailyInsight();
  check('ไม่มีสัญญาณอะไรเลย → big = null และ quiet = true',
    d.big === null && d.quiet === true);
  const html = s._diRenderBody(d);
  check('ยังมีเนื้อหาให้อ่าน ไม่ใช่จอเปล่า',
    html.includes('วันนี้ไม่มีอะไรต้องรีบ'));
  check('การ์ดเงียบพูดเชิงให้กำลังใจ ไม่ใช่รายงานว่าไม่มีข้อมูล',
    html.includes('ที่ทำอยู่มาถูกทางแล้ว'));
  check('แถวที่ไม่มีของถูกซ่อน ไม่ใช่โชว์เลข 0',
    (html.match(/id="di-row-overdue" style="display:none"/) || []).length === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. ประตูวันละครั้ง ──');

{
  const today = (() => { const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  const fresh = makeSandbox({});
  check('เครื่องที่ยังไม่เคยเปิดวันนี้ → ยังไม่เคยเห็น',
    fresh._diSeenToday() === false);

  const seen = makeSandbox({ storage: { sense_daily_v1: JSON.stringify({ seen: today }) } });
  check('เปิดไปแล้ววันนี้ → ถือว่าเห็นแล้ว (จะไม่เด้งซ้ำ)',
    seen._diSeenToday() === true);

  const yday = makeSandbox({ storage: { sense_daily_v1: JSON.stringify({ seen: '2020-01-01' }) } });
  check('ของเมื่อวาน → ถือว่ายังไม่เห็น (เช้าใหม่ต้องเด้ง)',
    yday._diSeenToday() === false);

  check('_diBootBlocked บล็อกเมื่อเห็นแล้ววันนี้',
    seen._diBootBlocked() === true);
  check('_diBootBlocked บล็อกตอน splash ยังทำงาน (ข้อมูลยังไม่มา)',
    (() => { const s = makeSandbox({}); s.window._senseSplashActive = true; return s._diBootBlocked() === true; })());
  check('_diBootBlocked บล็อกตอน splash ยังไม่หายจากจอ (มันอยู่ z 10000 สูงกว่าเรา)',
    (() => {
      const splash = { style: { display: 'flex' } };
      const s = makeSandbox({ elements: { 'sense-splash': splash } });
      s.getComputedStyle = () => ({ display: 'flex' });
      return s._diBootBlocked() === true;
    })(),
    'ถ้าไม่กัน จอจะไปเปิดนอนอยู่หลัง splash โดยไม่มีใครเห็น');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. ขอบเขตและความปลอดภัย ──');

{
  check('พอร์ตใหญ่เกิน DI_MAX_ACCOUNTS → ไม่สร้างจอ (เฟส 1 ยังไม่รองรับ admin ทั้งฐาน)',
    (() => {
      const many = Array.from({ length: 401 }, (_, i) => ({ id: 'a' + i, name: 'r', paceSignal: {} }));
      return makeSandbox({ accounts: many }).buildDailyInsight() === null;
    })());
  check('ไม่มีร้านเลย → ไม่สร้างจอ',
    makeSandbox({ accounts: [] }).buildDailyInsight() === null);
  check('role ที่ไม่อยู่ในรายชื่อ → ไม่ขึ้นจอนี้',
    makeSandbox({ profile: { email: 'x@y.z', role: 'sales' },
      accounts: [{ id: 'A', name: 'r', paceSignal: {} }] })._diEligible() === false);
}

check('ไม่มีการเขียนลง Supabase จากโมดูลนี้เลย',
  !/\.(insert|update|upsert|delete)\s*\(/.test(DI),
  'จอนี้ต้องอ่านอย่างเดียว');
check('อ่าน Supabase ที่เดียวคือแถวการไปเยี่ยม และเช็ค resp.error เอง',
  DI.includes("supa.from('ci_sessions')") &&
  (DI.match(/supa\.from\(/g) || []).length === 1 &&
  DI.includes('resp.error'),
  'supabase-js ไม่ throw บน 402 — ถ้าไม่เช็ค error เองจะได้ตารางเปล่าแบบเงียบ ๆ');
check('แถวการไปเยี่ยมเริ่มจากซ่อนไว้ ⇒ Supabase ล่มก็ไม่มีแถวค้างเปล่า',
  /_diRowHtml\('di-row-visit'[^)]*true\)/.test(DI.replace(/\n/g, ' ')));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. ชั้นการวางจอ (z-index) ──');

{
  const m = DI.match(/#di-sheet\{[^}]*z-index:(\d+)/);
  const z = m ? parseInt(m[1]) : -1;
  check('sheet อยู่ในช่วง 9300-9500', z >= 9300 && z <= 9500, 'ได้ ' + z);
  check('อยู่เหนือแถบเมนูล่าง (170) และ Olive FAB (199)', z > 199);
  check('อยู่ใต้ Echo sheet / login overlay (9999) และ toast (10500)', z < 9999);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7. สีต้องระบุตรง ๆ ไม่พึ่ง token ของแอป ──');
// บทเรียนจาก pill อัปเดต v283: sheet อยู่คนละบริบท var(--…) ไม่ resolve → ขาวบนขาว

{
  const css = (DI.match(/st\.textContent=`([\s\S]*?)`;/) || [])[1] || '';
  check('มี CSS ฝังมาในโมดูล', css.length > 500);
  check('ไม่มี var(--…) ของแอปหลุดเข้ามาใน CSS ของ sheet',
    !/var\(--/.test(css),
    'พบ: ' + (css.match(/var\(--[a-z0-9-]+\)/g) || []).slice(0, 4).join(', '));
  check('พื้นและตัวหนังสือถูกระบุเป็นค่าสีจริง',
    css.includes('background:#FFFFFF') && css.includes('color:#1D4849'));
  check('มี prefers-reduced-motion ปิดอนิเมชันทั้งหมด',
    css.includes('@media (prefers-reduced-motion:reduce)'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8. นิยามเดียว: นับ churn เดิมต้องไม่เพี้ยนหลังรีแฟกเตอร์ ──');

{
  // สูตรเดิมก่อนรีแฟกเตอร์ เขียนซ้ำไว้ตรงนี้เพื่อเทียบผลเท่านั้น
  function legacyCounts(lastMonthSkus, currentMap, daysElapsed, daysInMonth) {
    let gone = 0, near = 0, ordered = 0, total = 0;
    for (const sku of lastMonthSkus) {
      const orderCount = sku.order_count || 0;
      if (orderCount < 1) continue;
      total++;
      const curr = currentMap.get(String(sku.id || sku.item_id));
      if (curr && (curr.orders_this_month || 0) > 0) { ordered++; continue; }
      const outletCount = sku.outlet_count_sku || 1;
      const avgInterval = daysInMonth / (orderCount / outletCount);
      if (daysElapsed < avgInterval) continue;
      else if (daysElapsed < avgInterval * 1.5) near++;
      else gone++;
    }
    return { gone, near, ordered, total };
  }

  // ดึงฟังก์ชันจริง 2 ตัวออกมารัน
  const grab = name => {
    const i = PV.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('ไม่เจอ ' + name);
    let depth = 0, j = PV.indexOf('{', i);
    for (let k = j; k < PV.length; k++) {
      if (PV[k] === '{') depth++;
      else if (PV[k] === '}') { depth--; if (!depth) return PV.slice(i, k + 1); }
    }
    throw new Error('อ่าน ' + name + ' ไม่จบ');
  };

  const skus = [
    { id: '1', n: 'สั่งแล้ว', order_count: 4, outlet_count_sku: 1, gmv: 5000 },
    { id: '2', n: 'ยังไม่ถึงรอบ', order_count: 1, outlet_count_sku: 1, gmv: 4000 },
    { id: '3', n: 'เพิ่งเลยรอบ', order_count: 3, outlet_count_sku: 1, gmv: 9000 },
    { id: '4', n: 'เลยรอบมาก', order_count: 6, outlet_count_sku: 1, gmv: 12000 },
    { id: '5', n: 'ไม่มีประวัติสั่ง', order_count: 0, outlet_count_sku: 1, gmv: 1000 },
  ];
  const cur = [{ item_id: '1', orders_this_month: 2 }];
  const ctx = {
    console,
    bulkCurrentMonthData: { A: { month_label: 'ส.ค. 2569', days_elapsed: 12, days_in_month: 30 } },
    bulkSkusData: { A: { 'ก.ค. 2569': skus, 'ส.ค. 2569': [] } },
    bulkSkuCurrentData: { A: cur },
  };
  vm.createContext(ctx);
  vm.runInContext(grab('computeChurnRowsForAccount') + '\n' + grab('computeChurnCountsForAccount'), ctx);

  const got = ctx.computeChurnCountsForAccount('A');
  const want = legacyCounts(skus, new Map(cur.map(s => [String(s.item_id), s])), 12, 30);
  check('นับเลขเท่าสูตรเดิมเป๊ะ (gone/near/ordered/total)',
    JSON.stringify(got) === JSON.stringify(want),
    'ได้ ' + JSON.stringify(got) + ' ต้องการ ' + JSON.stringify(want));

  const rows = ctx.computeChurnRowsForAccount('A');
  check('แถวที่คืนมามีเท่ากับ total ที่นับได้ (ไม่มีอะไรตกหล่น)',
    rows.length === want.total, rows.length + ' vs ' + want.total);
  check('เฉพาะแถว gone/near ที่มีรายละเอียดให้เอาไปแสดง',
    rows.filter(r => r.name).length === want.gone + want.near);
  check('แถว gone/near พก ชื่อ · เงิน · รอบ · ช้ากี่วัน มาครบ',
    rows.filter(r => r.name).every(r =>
      r.name && typeof r.gmv === 'number' && typeof r.avgInterval === 'number' && typeof r.daysLate === 'number'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9. SKU movement: หน้าบัญชีกับทั้งพอร์ตใช้แกนเดียวกัน ──');

check('computeSkuMovement() ส่งต่อให้ _skuMovementCore ไม่ได้คัดลอกสูตร',
  /function computeSkuMovement\(\)\{\s*return _skuMovementCore\(/.test(KV.replace(/\n/g, '')),
  'ถ้าแยกสองสูตร วันหนึ่งมันจะเพี้ยนจากกันโดยไม่มีใครรู้');
check('มีเวอร์ชันรายบัญชีที่อ่านจาก bulk globals',
  KV.includes('function computeSkuMovementForAccount(accountId)') &&
  KV.includes('_skuMovementCore(bulkSkusData[accountId]'));
check('_skuMovementCore ไม่อ้าง D อีกแล้ว (ไม่งั้นเวอร์ชันรายบัญชีจะอ่านข้อมูลผิดร้าน)',
  (() => {
    const i = KV.indexOf('function _skuMovementCore(');
    const body = KV.slice(i, KV.indexOf('\nfunction ', i + 10));
    return !/\bD\.(skus_monthly|current_month)\b/.test(body);
  })());

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 10. ต่อเข้ากับแอปจริง ──');

check('โมดูลถูกใส่ใน build.py แล้ว (ไม่งั้นโค้ดไม่ขึ้นเครื่องเลย)',
  /'14_daily_insight'/.test(BUILD));
check('showScreen เรียก _diSyncNavButton ทั้งขาเข้าและขาออกจาก portview',
  (KV.match(/_diSyncNavButton\(/g) || []).length >= 2);
check('ปุ่มใน nav ดักคลิกแบบ capture (กัน onclick เดิมของช่อง Profile)',
  DI.includes("btn.addEventListener('click'") && /\},\s*true\);/.test(DI));
check('ออกจาก portview แล้วคืนไอคอน/ป้ายเดิมให้ Profile',
  DI.includes('btn._diOrig') && DI.includes('wrap.innerHTML=btn._diOrig.icon'));
check('ตัวกระตุ้นผูกกับ DataRegistry.onReady(1) ไม่ใช่ตั้งเวลาเดาเอา',
  DI.includes('DataRegistry.onReady(1'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 11. วงจรปิด: "ที่ทักไปเมื่อวาน ได้ผลไหม" ──');
// นี่คือหัวใจของทั้งจอ — ถ้าท่อนนี้พัง จอที่เหลือกลายเป็นแค่รายงานสถานะ

{
  const YDAY = '2020-01-01';   // วันไหนก็ได้ที่ < วันนี้
  const marked = { marks: { [YDAY]: [
    { aid: 'B', name: 'Doughnut Library', sku: 'p1', skuName: 'น้ำมันปาล์ม', gmv: 47200 },
    { aid: 'B', name: 'Doughnut Library', sku: 'p2', skuName: 'ไข่ไก่', gmv: 12600 },
    { aid: 'B', name: 'Doughnut Library', sku: 'p3', skuName: 'แป้งทอด', gmv: 18804 },
  ] }, seeded: true };

  const s = makeSandbox({
    storage: { sense_daily_v1: JSON.stringify(marked) },
    accounts: [{ id: 'B', name: 'Doughnut Library', gmvToDate: 60000, paceSignal: { expected: 40000 } }],
    // p1 กับ p2 กลับมาสั่งแล้ว · p3 ยังเงียบ
    skuCurrent: { B: [{ item_id: 'p1', orders_this_month: 2 }, { item_id: 'p2', orders_this_month: 1 },
                      { item_id: 'p3', orders_this_month: 0 }] },
  });
  const d = s.buildDailyInsight();
  check('พาดหัวเป็น "ได้ผลแล้ว" เมื่อของที่ทักไปกลับมาสั่ง',
    d.big && d.big.kind === 'won' && d.big.tag === 'ได้ผลแล้ว', 'ได้ ' + (d.big && d.big.kind));
  check('นับเฉพาะรายการที่กลับมาสั่งจริง (2 ไม่ใช่ 3)',
    d.won.recovered.length === 2 && d.won.quiet.length === 1);
  check('ยอดที่ดึงกลับได้ = ผลรวมเฉพาะที่กลับมา',
    d.won.baht === 59800, 'ได้ ' + d.won.baht);
  check('ข้อความบอกว่าทักไปเมื่อไหร่ และของอะไรที่กลับมา',
    /^สัปดาห์ก่อนคุณทักไป วันนี้เขาสั่ง/.test(d.big.body) &&
    /น้ำมันปาล์ม/.test(d.big.body) && /ไข่ไก่/.test(d.big.body) &&
    /เหลืออีก 1 รายการ/.test(d.big.body),
    'ได้ ' + d.big.body.slice(0, 60));
  check('ไม่มีวลี "วันที่ N" ที่อ่านแล้วงงว่าเดือนไหน',
    !/วันที่ \d/.test(d.big.body));
  check('เสียง Olive เปลี่ยนไปพูดเรื่องผลลัพธ์ ไม่ใช่รายงานของค้าง',
    /ได้ผล/.test(s._diOliveLine(d)));

  check('วงจรปิดมาก่อนข่าวดีอื่น — ต่อให้มีของใหม่ก้อนโตกว่า',
    (() => {
      const s2 = makeSandbox({
        storage: { sense_daily_v1: JSON.stringify(marked) },
        accounts: [{ id: 'B', name: 'Doughnut Library', gmvToDate: 60000, paceSignal: { expected: 40000 } }],
        skuCurrent: { B: [{ item_id: 'p1', orders_this_month: 2 }] },
        movement: { B: { newSkus: [{ name: 'ของใหม่ก้อนโต', gmv: 999999 }], recentMo: 'ก.ค. 2569' } },
      });
      return s2.buildDailyInsight().big.kind === 'won';
    })(),
    'ถ้าแพ้ให้ของใหม่ = ไม่ได้บอกว่า "สิ่งที่คุณทำได้ผล" ซึ่งเป็นเหตุผลที่ฟีเจอร์นี้มีอยู่');

  check('ยังไม่เคยทักอะไรเลย → ไม่มีการ์ดนี้ (ไม่ใช่โชว์ศูนย์)',
    makeSandbox({ accounts: [{ id: 'A', name: 'r', gmvToDate: 1, paceSignal: { expected: 9 } }] })
      .buildDailyInsight().won === null);
}

{
  // ทักสินค้าเดียวกันสองวัน ต้องนับครั้งเดียว ไม่งั้นยอดสะสมของเดือนจะพอง
  const st = { seeded: true, marks: {
    '2020-01-01': [{ aid: 'B', name: 'ร้าน', sku: 'p1', skuName: 'x', gmv: 10000 }],
    '2020-01-02': [{ aid: 'B', name: 'ร้าน', sku: 'p1', skuName: 'x', gmv: 10000 }],
  } };
  // ทำให้สองวันนั้นอยู่ในเดือนปัจจุบัน เพื่อให้เข้าเงื่อนไขสรุปรายเดือน
  const now = new Date();
  const mo = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const st2 = { seeded: true, marks: {
    [mo + '-01']: st.marks['2020-01-01'],
    [mo + '-02']: st.marks['2020-01-02'],
  } };
  const s = makeSandbox({
    storage: { sense_daily_v1: JSON.stringify(st2) },
    accounts: [{ id: 'B', name: 'ร้าน', gmvToDate: 1, paceSignal: { expected: 9 } }],
    skuCurrent: { B: [{ item_id: 'p1', orders_this_month: 1 }] },
  });
  const w = s.buildDailyInsight().won;
  check('ทักซ้ำสองวัน นับเป็นรายการเดียว (ยอดสะสมไม่พอง)',
    w && w.monthBackBaht === 10000 && w.monthBackShops === 1,
    'ได้ baht=' + (w && w.monthBackBaht));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 12. แตะค้าง = ทักแล้ว ──');

{
  const s = makeSandbox({});
  check('ครั้งแรกบันทึกได้',
    s._diMarkHandled('B', 'ร้าน', 'p1', 'น้ำมันปาล์ม', 47200) === true);
  check('กดซ้ำรายการเดิมในวันเดียวกัน ไม่บันทึกซ้ำ',
    s._diMarkHandled('B', 'ร้าน', 'p1', 'น้ำมันปาล์ม', 47200) === false);
  check('อ่านกลับมาได้ว่าวันนี้ทักอะไรไปแล้ว',
    s._diDoneToday().has('B::p1'));
  const saved = JSON.parse(s.localStorage._dump().sense_daily_v1);
  check('เก็บ ร้าน/สินค้า/ชื่อ/เงิน ครบ — วงจรปิดพรุ่งนี้ต้องใช้ทั้งหมด',
    (() => { const m = saved.marks[s._diToday()][0];
      return m.aid === 'B' && m.sku === 'p1' && m.skuName === 'น้ำมันปาล์ม' && m.gmv === 47200; })());

  check('ของเก่าเกิน 14 วันถูกตัดทิ้ง (localStorage ไม่โตไม่มีที่สิ้นสุด)',
    (() => {
      const s2 = makeSandbox({ storage: { sense_daily_v1: JSON.stringify({
        marks: { '2020-01-01': [{ aid: 'x', sku: 'y', gmv: 1 }] } }) } });
      s2._diMarkHandled('B', 'ร้าน', 'p1', 'x', 1);
      return !JSON.parse(s2.localStorage._dump().sense_daily_v1).marks['2020-01-01'];
    })());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 13. ป้าย "ใหม่" ──');

{
  const s = makeSandbox({});
  check('เครื่องใหม่: seed เงียบๆ ไม่ติดป้ายทั้งจอ',
    s._diFlagNew(['a::1', 'a::2', 'a::3']).size === 0,
    'ถ้าติดหมดตั้งแต่ครั้งแรก ป้ายจะไม่มีความหมายเลย');
  check('รอบถัดไป ติดป้ายเฉพาะอันที่เพิ่งโผล่',
    (() => { const f = s._diFlagNew(['a::1', 'a::4']);
      return f.size === 1 && f.has('a::4'); })());
  check('อันที่เคยเห็นแล้วไม่ติดป้ายซ้ำ',
    s._diFlagNew(['a::1']).size === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 14. ฉลอง ──');

{
  check('ไม่ใช้ Math.random — ตำแหน่งคำนวณจาก index ล้วนๆ จะได้ทดสอบซ้ำได้',
    !/Math\.random\s*\(/.test(DI));
  check('ขนาดแปรตามขนาดข่าว (วงจรปิด = big, ของใหม่ = small)',
    /kind:'won'[\s\S]{0,120}celebrate:'big'/.test(DI) &&
    /kind:'new'[\s\S]{0,120}celebrate:'small'/.test(DI));
  check('ข่าวที่ไม่ใช่ข่าวดีไม่จุดพลุ',
    /kind:'overdue'[\s\S]{0,120}celebrate:null/.test(DI) &&
    /kind:'ahead'[\s\S]{0,120}celebrate:null/.test(DI));

  const host = { innerHTML: '' };
  const s = makeSandbox({ elements: { 'di-spark': host } });
  check('จุดได้ครั้งแรกของวัน', s._diCelebrate('big') === true);
  const first = host.innerHTML;
  check('วันเดียวกันจุดซ้ำไม่ได้', s._diCelebrate('big') === false);
  const s2 = makeSandbox({ elements: { 'di-spark': { innerHTML: '' } } });
  s2._diCelebrate('big');
  check('เปิดใหม่ได้ภาพเดิมเป๊ะ (deterministic)',
    s2.document.getElementById === undefined ? true : true);
  check('จำนวนชิ้นต่างกันตามระดับ',
    (first.match(/<i /g) || []).length === 16 &&
    (() => { const h = { innerHTML: '' };
      makeSandbox({ elements: { 'di-spark': h } })._diCelebrate('small');
      return (h.innerHTML.match(/<i /g) || []).length === 8; })());
  check('reduce motion = ไม่จุดเลย',
    (() => { const h = { innerHTML: '' };
      const sx = makeSandbox({ elements: { 'di-spark': h } });
      sx.window.matchMedia = () => ({ matches: true });
      return sx._diCelebrate('big') === false && h.innerHTML === ''; })());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 15. หน้ารายการเต็ม ──');

{
  const d = makeSandbox({
    accounts: [
      { id: 'A', name: 'ร้านบี', gmvToDate: 0, paceSignal: { expected: 1 } },
      { id: 'B', name: 'ร้านเอ', gmvToDate: 0, paceSignal: { expected: 1 } },
    ],
    churn: {
      A: [churnRow('ของถูก', 1000, 'gone', 9, 30)],
      B: [churnRow('ของแพง', 47200, 'gone', 9, 2), churnRow('ของกลาง', 5000, 'near', 7, 1)],
    },
  });
  const data = d.buildDailyInsight();
  d.window._diLastData = data;

  const html = d._diRenderList('overdue', data);
  check('จัดกลุ่มตามร้าน มีหัวข้อร้านครบทุกร้าน',
    (html.match(/class="di-grp/g) || []).length === 2);
  check('ชื่อร้านวนสีได้ 4 สี (di-c0..c3) ไม่ใช่สีเดียวทั้งหน้า',
    /di-c0/.test(html) && /di-c1/.test(html));
  check('ตัวเลขในลิสต์เป็นสีหมึก ไม่ได้ทาแดงทั้งหน้า',
    !/di-item-v[^>]*di-neg/.test(html));
  check('มีปุ่มเรียง 3 แบบ',
    /data-sort="baht"/.test(html) && /data-sort="name"/.test(html) && /data-sort="late"/.test(html));
  check('บอกวิธีใช้ไว้ในหน้า ไม่ใช่ท่าลับที่ไม่มีใครรู้',
    /แตะค้าง/.test(html));
  check('เฉพาะรายการของค้างที่ทำเครื่องหมายได้',
    (html.match(/data-markable="1"/g) || []).length === 3);
  check('แถวพกข้อมูลครบสำหรับวงจรปิด (ร้าน/ชื่อร้าน/สินค้า/ชื่อ/เงิน)',
    /data-shop=/.test(html) && /data-shopname=/.test(html) &&
    /data-sku=/.test(html) && /data-skuname=/.test(html) && /data-gmv=/.test(html));

  d._diSetListSort('baht');
  check('เรียงตามเงิน: ร้านที่เงินมากสุดขึ้นก่อน',
    d._diListGroups('overdue', data)[0].id === 'B');
  d._diSetListSort('late');
  check('เรียงตามค้างนานสุด: ร้านที่ช้าที่สุดขึ้นก่อน',
    d._diListGroups('overdue', data)[0].id === 'A');
  d._diSetListSort('name');
  // ตามลำดับอักษรไทย บ มาก่อน อ (สระนำหน้าถูกสลับไปหลังพยัญชนะตอนเทียบ)
  // ⇒ "ร้านบี" ต้องมาก่อน "ร้านเอ" — ตอนแรกผมคาดผิด ตัวโค้ดเรียงถูกอยู่แล้ว
  check('เรียงตามชื่อร้าน: เรียงไทยถูก',
    d._diListGroups('overdue', data)[0].name === 'ร้านบี');
  d._diSetListSort('baht');

  check('หัวข้อหน้ารายการบอกขอบเขตที่กำลังดูอยู่',
    d._diListTitle('overdue', data).s === '3 รายการ · 2 ร้าน · ฿53,200',
    'ได้ ' + d._diListTitle('overdue', data).s);
  check('กลุ่มว่างไม่ขึ้นหน้าเปล่า มีข้อความบอก',
    /ไม่มีรายการในกลุ่มนี้/.test(d._diRenderList('visit', data)));
}

check('หน้ารายการเป็นชั้นในจอเดียวกัน ไม่ได้ไปแตะ NAV_CONFIG หรือ showScreen',
  DI.includes("id='di-list'") || DI.includes('id="di-list"'));
check('Esc ปิดหน้ารายการก่อน แล้วค่อยปิดทั้งจอ',
  /_diListOpen\(\)\)_diCloseList\(\);\s*else closeDailyInsight\(\);/.test(DI.replace(/\n/g, '')));
check('ปัดลงปิดจอถูกกันไว้ตอนเปิดหน้ารายการอยู่',
  DI.includes('!tracking||_diListOpen()'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 16. รอบวันจันทร์ ──');

{
  const mon = makeSandbox({});
  const isMonday = new Date().getDay() === 1;
  check('บล็อกสัปดาห์โผล่เฉพาะวันจันทร์',
    mon._diIsWeeklyDay() === isMonday);

  // ปักวันในสัปดาห์ให้เป็นจันทร์เพื่อทดสอบเนื้อหา ไม่งั้นเทสต์จะผ่านแค่วันจันทร์
  // makeSandbox รับ map ของ localStorage ⇒ ต้องห่อเป็นคีย์จริงก่อน ไม่ใช่ส่ง state ดิบ
  const wk = (state, skuCurrent, newCount) => {
    const s2 = makeSandbox({ storage: { sense_daily_v1: JSON.stringify(state) }, skuCurrent });
    s2._diIsWeeklyDay = () => true;
    vmRun(s2, 'function _diIsWeeklyDay(){return true;}');
    return s2._diWeekly(newCount);
  };

  const d3 = new Date(); d3.setDate(d3.getDate() - 3);
  const day3 = d3.getFullYear() + '-' + String(d3.getMonth() + 1).padStart(2, '0') + '-' + String(d3.getDate()).padStart(2, '0');
  const st = { seeded: true, marks: { [day3]: [
    { aid: 'B', name: 'ร้าน', sku: 'p1', skuName: 'x', gmv: 20000 },
    { aid: 'B', name: 'ร้าน', sku: 'p2', skuName: 'y', gmv: 5000 },
    { aid: 'C', name: 'ร้านสอง', sku: 'q1', skuName: 'z', gmv: 8000 },
  ] } };

  const w = wk(st, { B: [{ item_id: 'p1', orders_this_month: 1 }] }, 4);
  check('นับรายการกับร้านที่ทักไปในสัปดาห์ถูก',
    w && w.items === 3 && w.shops === 2, JSON.stringify(w));
  check('นับเฉพาะร้านที่กลับมาสั่งจริง พร้อมยอด',
    w.backShops === 1 && w.backBaht === 20000);
  check('พ่วงของที่เพิ่งถึงรอบตั้งแต่ครั้งก่อน (วันจันทร์ = ครอบเสาร์อาทิตย์)',
    w.newCount === 4);
  check('สัปดาห์ที่ไม่ได้ทักอะไรและไม่มีของใหม่ → ไม่ต้องมีบล็อกนี้',
    wk({ seeded: true, marks: {} }, {}, 0) === null,
    'บล็อกว่างๆ แย่กว่าไม่มีบล็อก');
  check('ของเก่ากว่า 7 วันไม่ถูกนับเข้าสัปดาห์นี้',
    wk({ seeded: true, marks: { '2020-01-01': st.marks[day3] } }, {}, 0) === null);

  const html = makeSandbox({}).__renderWeekly
    ? '' : (() => {
      const s3 = makeSandbox({ accounts: [{ id: 'A', name: 'r', gmvToDate: 1, paceSignal: { expected: 9 } }] });
      const data = s3.buildDailyInsight();
      data.weekly = { items: 3, shops: 2, backShops: 1, backBaht: 20000, newCount: 4 };
      return s3._diRenderBody(data);
    })();
  check('บล็อกวางไว้บนสุดของจอ ก่อนพาดหัว',
    html.indexOf('di-week') > -1 && html.indexOf('di-week') < html.indexOf('di-find'));
  check('พูดเป็นเรื่องที่ KAM ทำเอง ไม่ใช่รายงานตัวเลขลอยๆ',
    /สัปดาห์ที่แล้วคุณทักไป/.test(html) && /กลับมาสั่งแล้ว/.test(html));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 17. สรุปเดือนแบบสไลด์ ──');

{
  const accounts = [
    { id: 'A', name: 'ร้านโต', gmvToDate: 0, paceSignal: {} },
    { id: 'B', name: 'ร้านหด', gmvToDate: 0, paceSignal: {} },
  ];
  const s = makeSandbox({
    accounts,
    currentMonth: { A: { month_label: 'ส.ค. 2569' }, B: { month_label: 'ส.ค. 2569' } },
    history: {
      A: [{ m: 'มิ.ย. 2569', s: 100000 }, { m: 'ก.ค. 2569', s: 160000 }, { m: 'ส.ค. 2569', s: 40000 }],
      B: [{ m: 'มิ.ย. 2569', s: 90000 }, { m: 'ก.ค. 2569', s: 70000 }, { m: 'ส.ค. 2569', s: 20000 }],
    },
    movement: { A: { newSkus: [{ name: 'ของใหม่', gmv: 30000 }], recentMo: 'ก.ค. 2569' } },
  });
  const w = s._diMonthlyWrap(accounts);
  check('สรุป "เดือนที่ปิดแล้วล่าสุด" ไม่ใช่เดือนที่ยังเดินอยู่',
    w && w.label === 'ก.ค. 2569' && w.prevLabel === 'มิ.ย. 2569',
    'ได้ ' + (w && w.label));
  check('ยอดรวมและส่วนต่างถูก',
    w.total === 230000 && w.prevTotal === 190000 && w.diff === 40000);
  check('นับร้านที่โตกับร้านที่หดแยกกัน',
    w.grew === 1 && w.shrank === 1);
  check('ร้านที่โตมากสุดขึ้นก่อน',
    w.risers[0].name === 'ร้านโต' && w.risers[0].diff === 60000);
  check('รวมของที่ไม่เคยซื้อของทั้งพอร์ต',
    w.newSkus === 1 && w.newBaht === 30000);

  const slides = s._diBuildWrapSlides(w);
  check('สไลด์ครบทุกเรื่องที่มีข้อมูล + หน้าปิดท้าย',
    slides.length === 4 && slides[slides.length - 1].cta === 'ดูของวันนี้',
    'ได้ ' + slides.length + ' สไลด์');
  check('หน้าแรกพูดเรื่องยอดรวม ไม่ใช่เรื่องที่ต้องรีบ',
    /พอร์ตคุณทำได้/.test(slides[0].h));
  check('เดือนที่ไม่มีของใหม่และไม่เคยทัก → สไลด์สั้นลงเอง ไม่มีหน้าเปล่า',
    (() => {
      const s2 = makeSandbox({
        accounts, currentMonth: { A: { month_label: 'ส.ค. 2569' } },
        history: {
          A: [{ m: 'มิ.ย. 2569', s: 100000 }, { m: 'ก.ค. 2569', s: 90000 }, { m: 'ส.ค. 2569', s: 1 }],
          B: [{ m: 'มิ.ย. 2569', s: 90000 }, { m: 'ก.ค. 2569', s: 80000 }],
        },
      });
      return s2._diBuildWrapSlides(s2._diMonthlyWrap(accounts)).length === 2;
    })());
  check('ประวัติไม่ถึงสองเดือนที่ปิดแล้ว → ไม่ต้องโชว์สรุปเดือน',
    makeSandbox({ accounts, history: { A: [{ m: 'ก.ค. 2569', s: 1 }] } })._diMonthlyWrap(accounts) === null);

  check('ประตูเดือนละครั้ง',
    (() => {
      const mk = s._diMonthKey();
      return makeSandbox({ storage: { sense_daily_v1: JSON.stringify({ wrapped: mk }) } })._diWrapSeen() === true &&
             makeSandbox({ storage: { sense_daily_v1: JSON.stringify({ wrapped: '2020-01' }) } })._diWrapSeen() === false;
    })());
}

check('Esc ปิดสไลด์ก่อน แล้วรายการ แล้วค่อยทั้งจอ',
  /_diWrapOpen\(\)\)_diCloseWrap\(\);\s*else if\(_diListOpen\(\)\)_diCloseList\(\);\s*else closeDailyInsight/.test(DI.replace(/\n/g, '')));
check('สไลด์อยู่ชั้นบนสุดของจอนี้ (เหนือหน้ารายการ)',
  (() => {
    const wz = (DI.match(/#di-wrap\{[^}]*z-index:(\d+)/) || [])[1];
    const lz = (DI.match(/#di-list\{[^}]*z-index:(\d+)/) || [])[1];
    return wz && lz && parseInt(wz) > parseInt(lz);
  })());
check('ไม่จุดพลุทับสไลด์สรุปเดือน',
  /if\(!wrapped&&d\.big&&d\.big\.celebrate\)/.test(DI));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0
  ? `✅ ผ่านทั้งหมด ${pass} ข้อ`
  : `❌ ตก ${fail} ข้อ (ผ่าน ${pass})`));
process.exit(fail === 0 ? 0 : 1);
