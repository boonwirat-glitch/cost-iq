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
    portviewSelectAccount: () => { sandbox._drilled = true; },
  };
  sandbox.window = sandbox;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.window.DataRegistry = { onReady() {} };
  vm.createContext(sandbox);
  vm.runInContext(DI, sandbox);
  return sandbox;
}

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
console.log('\n' + (fail === 0
  ? `✅ ผ่านทั้งหมด ${pass} ข้อ`
  : `❌ ตก ${fail} ข้อ (ผ่าน ${pass})`));
process.exit(fail === 0 ? 0 : 1);
