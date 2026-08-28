// SECTION:DAILY_INSIGHT
// ═══════════════════════════════════════════════════════════════════════════
// "Olive สรุปให้" — หน้าสรุปพอร์ตรายวันของ KAM
//
// เจตนา: เปิดแอปเช้าปุ๊บ รู้ภายใน 30 วินาทีว่าพอร์ตตัวเองมีอะไรเปลี่ยน คิดเป็นเงินเท่าไหร่
// และควรทำอะไรก่อน โดยไม่ต้องไล่กดดูทีละร้าน
//
// กติกาที่ตกลงกับบุชแล้ว และห้ามหลุด:
//   · จอนี้ให้ insight ไม่ใช่แจ้งข่าวร้าย ⇒ หัวเรื่องเลือกข่าวดีก่อนเสมอ
//     เรื่องที่ต้องรีบยังอยู่ครบ แต่อยู่ในสามบรรทัดสรุป ไม่ใช่พาดหัว
//   · ไม่สร้างนิยามใหม่ — ทุกตัวเลขมาจากฟังก์ชันเดิมของ Sense
//     (computeChurnRowsForAccount / computeSkuMovementForAccount / paceSignal)
//   · ห้ามเรียก AI ตอนเปิด — ช้า มีค่าใช้จ่าย และมีโอกาสมั่ว
//   · ข้อมูลหลักมาจาก R2 ⇒ Supabase ล่มจอนี้ต้องยังทำงาน
//     (ยอดการไปเยี่ยมรายไตรมาสเป็นส่วนเสริมที่เติมทีหลัง ไม่มีก็ซ่อนแถวนั้นไปเฉยๆ)
//   · z-index 9300-9500 — เหนือแถบล่าง (170) และปุ่ม Olive (199)
//     แต่ใต้ Echo sheet (9999) / login overlay (9999) และ toast (10500)
//
// เฟส 1 (v284): sheet รายวัน · ประตูวันละครั้ง · ปัดปิด · ปุ่มใน nav
// เฟส 2 (v285): หน้ารายการเต็ม · แตะค้าง = ทักแล้ว · ป้าย "ใหม่" ·
//                การ์ด "ได้ผลแล้ว" ที่ปิดวงจร · ฉลองแบบกำหนดตำแหน่งตายตัว
// เฟส 3 (v287): บล็อกสรุปสัปดาห์ (วันจันทร์) · สรุปเดือนแบบสไลด์ (ครั้งแรกของเดือน)
// ยังไม่มี: TL-Admin · ปุ่มตอนเช็คอิน Echo
// ═══════════════════════════════════════════════════════════════════════════

// ── ค่าคงที่ที่ปรับได้ ──────────────────────────────────────────────────────
const DI_STORE_KEY   = 'sense_daily_v1';
const DI_GOOD_MIN    = 5000;   // ข่าวดีต้องมีมูลค่าอย่างน้อยเท่านี้ถึงจะขึ้นเป็นพาดหัว
const DI_MAX_ACCOUNTS= 400;    // พอร์ตใหญ่กว่านี้ (admin ทั้งฐาน) ยังไม่รองรับ — ไม่เด้ง
const DI_BOOT_MS     = 1100;   // บรรทัด "กำลังไล่ดู…" แสดงนานแค่ไหนก่อนเผยเนื้อหา
const DI_ROLES       = ['rep','tl','ad','pm','ad_tl'];   // admin ยังไม่รองรับ (บุช 2026-08-28)
const DI_TEAM_ROLES  = ['tl','ad_tl'];                   // role ที่เห็น "คนในทีม" แทน "ร้าน" 
const DI_HOLD_MS     = 420;    // แตะค้างนานเท่าไหร่ถึงนับว่า "ทักแล้ว"
const DI_MARK_KEEP   = 14;     // เก็บประวัติการทักย้อนหลังกี่วัน
const DI_SIGNAL_KEEP = 600;    // จำ id สัญญาณที่เคยเห็นได้กี่ตัว (ไว้ติดป้าย "ใหม่")
const DI_WEEK_DAY    = 1;      // วันจันทร์ = วันที่โชว์บล็อกสรุปสัปดาห์
const DI_TIER_WAIT_MS= 8000;   // รอข้อมูลชั้น 3 นานสุดเท่าไหร่ก่อนยอมเปิดเท่าที่มี

// ── สถานะที่จำในเครื่อง ────────────────────────────────────────────────────
// จงใจไม่เก็บฝั่ง Supabase: ถ้าเก็บที่นั่น พอโดน 402 จอนี้จะพังพร้อมกับสิ่งที่มันควรทำงานแทน
// แลกกับข้อจำกัดที่ยอมรับแล้ว — เปลี่ยนเครื่องแล้ววงจร "ได้ผลแล้ว" จะขาด
//
// รูปร่าง: { seen, celebrated, seeded, seenSignals:[…], marks:{ 'YYYY-MM-DD':[…] } }
function _diToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _diLoadState(){
  try{ return JSON.parse(localStorage.getItem(DI_STORE_KEY)||'{}')||{}; }catch(e){ return {}; }
}
function _diSaveState(patch){
  try{
    const st=Object.assign(_diLoadState(),patch||{});
    localStorage.setItem(DI_STORE_KEY,JSON.stringify(st));
    return st;
  }catch(e){ return {}; }
}
function _diSeenToday(){ return _diLoadState().seen===_diToday(); }
function _diMarkSeen(){ _diSaveState({seen:_diToday()}); _diSyncNavButton(); }

// ── ตัวช่วยเล็กๆ ───────────────────────────────────────────────────────────
function _diEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _diBaht(n){
  const v=Math.round(Math.abs(n||0));
  if(v>=1000000)return '฿'+(v/1000000).toFixed(2).replace(/\.?0+$/,'')+'M';
  return '฿'+v.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
}
function _diDateLabel(){
  const wd=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const mo=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const d=new Date();
  return wd[d.getDay()]+' '+d.getDate()+' '+mo[d.getMonth()];
}
function _diGreeting(){
  const h=new Date().getHours();
  if(h<11)return 'สวัสดีตอนเช้าค่ะ';
  if(h<17)return 'สวัสดีตอนบ่ายค่ะ';
  return 'สวัสดีตอนเย็นค่ะ';
}
function _diMyName(){
  const p=(typeof currentUserProfile!=='undefined'&&currentUserProfile)||{};
  return (p.kam_name||p.full_name||'').split(' ')[0]||'';
}
function _diReduceMotion(){
  try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; }
}
function _diSkuOrderedNow(accountId,skuId){
  if(typeof bulkSkuCurrentData==='undefined')return false;
  const arr=bulkSkuCurrentData[accountId]||[];
  for(const s of arr){
    if(String(s.item_id||s.id)===String(skuId))return (s.orders_this_month||0)>0;
  }
  return false;
}
function _diDayAgo(ymd){
  try{
    const p=ymd.split('-').map(Number);
    const then=new Date(p[0],p[1]-1,p[2]), now=new Date();
    const days=Math.round((new Date(now.getFullYear(),now.getMonth(),now.getDate())-then)/86400000);
    if(days<=1)return 'เมื่อวาน';
    if(days<=6)return days+' วันก่อน';
    return 'สัปดาห์ก่อน';   // ประวัติเก็บแค่ 14 วัน จึงไม่มีทางไกลกว่านี้
  }catch(e){ return 'ก่อนหน้านี้'; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. วงจรปิด — "ที่ทักไปเมื่อวาน ได้ผลไหม"
// ═══════════════════════════════════════════════════════════════════════════
// นี่คือหัวใจของจอนี้ทั้งจอ: มันเอาสิ่งที่ KAM ลงมือทำ ไปผูกกับผลที่เกิดจริง
// ถ้าไม่มีท่อนนี้ จอที่เหลือก็เป็นแค่รายงานสถานะ ไม่ใช่ insight
function _diLoopClosure(){
  const st=_diLoadState();
  const marks=st.marks||{};
  const today=_diToday();
  const past=Object.keys(marks).filter(d=>d<today).sort();
  if(!past.length)return null;

  // เรื่องของ "วันนี้" = ผลของครั้งล่าสุดที่ทักไป
  const lastDay=past[past.length-1];
  const recovered=[], quiet=[];
  (marks[lastDay]||[]).forEach(m=>{
    (_diSkuOrderedNow(m.aid,m.sku)?recovered:quiet).push(m);
  });

  // สรุปทั้งเดือน — ตัดซ้ำด้วย ร้าน+สินค้า ไม่งั้นทักสองวันจะถูกนับสองรอบ
  const mo=today.slice(0,7);
  const seen=new Set(), shops=new Set(), backShops=new Set();
  let backBaht=0;
  Object.keys(marks).forEach(d=>{
    if(d.slice(0,7)!==mo)return;
    (marks[d]||[]).forEach(m=>{
      const k=m.aid+'::'+m.sku;
      if(seen.has(k))return;
      seen.add(k); shops.add(m.aid);
      if(_diSkuOrderedNow(m.aid,m.sku)){ backShops.add(m.aid); backBaht+=(m.gmv||0); }
    });
  });

  if(!recovered.length&&!backShops.size)return null;
  return {
    lastDay, recovered, quiet,
    monthShops:shops.size, monthBackShops:backShops.size, monthBackBaht:backBaht,
    baht:recovered.reduce((t,m)=>t+(m.gmv||0),0),
    shopName:(recovered[0]||{}).name||''
  };
}

// ── ป้าย "ใหม่" — อันไหนเพิ่งโผล่ตั้งแต่ครั้งก่อนที่เปิดดู ────────────────────
// เครื่องใหม่ต้อง seed เงียบๆ ครั้งแรก ไม่งั้นจะติดป้าย "ใหม่" ทั้งจอจนอ่านไม่รู้เรื่อง
function _diFlagNew(ids){
  const st=_diLoadState();
  const known=new Set(st.seenSignals||[]);
  const firstRun=!st.seeded;
  const fresh=firstRun?new Set():new Set(ids.filter(id=>!known.has(id)));
  const keep=Array.from(new Set(ids.concat(Array.from(known)))).slice(0,DI_SIGNAL_KEEP);
  _diSaveState({seeded:true,seenSignals:keep});
  return fresh;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1b. รอบสัปดาห์ (วันจันทร์) — สรุปสิ่งที่ "คุณทำ" ไม่ใช่สิ่งที่ "ระบบเห็น"
// ═══════════════════════════════════════════════════════════════════════════
// ข้อมูลยอดขายในเครื่องเป็นรายเดือน ทำ delta รายสัปดาห์จริงๆ ไม่ได้ และไม่ควรเดา
// สิ่งที่เป็นรายสัปดาห์จริงคือประวัติการทักของ KAM เอง ⇒ บล็อกนี้จึงเล่าเรื่องนั้น
// บวกกับของที่เพิ่งถึงรอบตั้งแต่ครั้งก่อนที่เปิดดู (ซึ่งวันจันทร์ = ครอบเสาร์อาทิตย์พอดี)
function _diIsWeeklyDay(){ return new Date().getDay()===DI_WEEK_DAY; }

function _diWeekly(newCount){
  if(!_diIsWeeklyDay())return null;
  const marks=(_diLoadState().marks)||{};
  const today=_diToday();
  const from=new Date(); from.setDate(from.getDate()-7);
  const cut=from.getFullYear()+'-'+String(from.getMonth()+1).padStart(2,'0')+'-'+String(from.getDate()).padStart(2,'0');

  const seen=new Set(), shops=new Set(), backShops=new Set();
  let items=0, backBaht=0;
  Object.keys(marks).forEach(d=>{
    if(d<cut||d>=today)return;
    (marks[d]||[]).forEach(m=>{
      const k=m.aid+'::'+m.sku;
      if(seen.has(k))return;
      seen.add(k); items++; shops.add(m.aid);
      if(_diSkuOrderedNow(m.aid,m.sku)){ backShops.add(m.aid); backBaht+=(m.gmv||0); }
    });
  });
  if(!items&&!newCount)return null;
  return {items,shops:shops.size,backShops:backShops.size,backBaht,newCount:newCount||0};
}

// ═══════════════════════════════════════════════════════════════════════════
// 1c. สรุปเดือน — โชว์ครั้งแรกที่เปิดแอปในเดือนใหม่ (ไม่จำเป็นต้องวันที่ 1)
// ═══════════════════════════════════════════════════════════════════════════
const DI_MONTHS=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function _diMonthKey(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function _diMonthSortKey(label){
  const p=String(label||'').split(' ');
  return (parseInt(p[1]||0)*12)+DI_MONTHS.indexOf(p[0]);
}

// เดือนที่สรุปคือ "เดือนที่ปิดแล้วล่าสุด" ไม่ใช่เดือนปัจจุบันที่ยังเดินอยู่
function _diMonthlyWrap(accounts){
  if(typeof bulkHistoryData==='undefined')return null;
  const curLabel=((typeof bulkCurrentMonthData!=='undefined'&&accounts.length
    &&bulkCurrentMonthData[accounts[0].id])||{}).month_label||'';

  let lastLabel='', prevLabel='';
  for(const a of accounts){
    const h=(bulkHistoryData[a.id]||[]).filter(r=>r.m&&r.m!==curLabel);
    if(h.length<2)continue;
    h.sort((x,y)=>_diMonthSortKey(y.m)-_diMonthSortKey(x.m));
    lastLabel=h[0].m; prevLabel=h[1].m; break;
  }
  if(!lastLabel||!prevLabel)return null;

  let lastTotal=0, prevTotal=0, grew=0, shrank=0;
  const risers=[];
  accounts.forEach(a=>{
    const h=bulkHistoryData[a.id]||[];
    let l=0,pv=0;
    h.forEach(r=>{ if(r.m===lastLabel)l=r.s||r.gmv||0; else if(r.m===prevLabel)pv=r.s||r.gmv||0; });
    lastTotal+=l; prevTotal+=pv;
    if(pv>0&&l>pv){ grew++; risers.push({id:a.id,name:a.name||'—',diff:l-pv,now:l}); }
    else if(pv>0&&l<pv)shrank++;
  });
  risers.sort((x,y)=>y.diff-x.diff);

  // ของใหม่ที่เข้าพอร์ตเดือนนั้น — ใช้ computeSkuMovementForAccount ตัวเดิม
  let newSkus=0, newBaht=0; const newTop=[];
  accounts.forEach(a=>{
    let sm=null;
    try{ sm=(typeof computeSkuMovementForAccount==='function')?computeSkuMovementForAccount(a.id):null; }catch(e){ sm=null; }
    if(sm&&sm.newSkus&&sm.newSkus.length){
      newSkus+=sm.newSkus.length;
      const v=sm.newSkus.reduce((t,x)=>t+(x.gmv||0),0);
      newBaht+=v;
      newTop.push({name:a.name||'—',sku:sm.newSkus[0].name,gmv:sm.newSkus[0].gmv||0});
    }
  });
  newTop.sort((x,y)=>y.gmv-x.gmv);

  // ที่ทักไปเดือนก่อน กลับมากี่ร้าน
  const marks=(_diLoadState().marks)||{};
  const d=new Date(); d.setMonth(d.getMonth()-1);
  const pm=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const seen=new Set(), mShops=new Set(), mBack=new Set();
  Object.keys(marks).forEach(k=>{
    if(k.slice(0,7)!==pm)return;
    (marks[k]||[]).forEach(m=>{
      const key=m.aid+'::'+m.sku;
      if(seen.has(key))return;
      seen.add(key); mShops.add(m.aid);
      if(_diSkuOrderedNow(m.aid,m.sku))mBack.add(m.aid);
    });
  });

  return {
    label:lastLabel, prevLabel:prevLabel,
    total:lastTotal, prevTotal:prevTotal,
    diff:lastTotal-prevTotal,
    pct:prevTotal>0?Math.round((lastTotal-prevTotal)/prevTotal*100):null,
    shops:accounts.length, grew:grew, shrank:shrank,
    risers:risers.slice(0,3),
    newSkus:newSkus, newBaht:newBaht, newTop:newTop.slice(0,2),
    markedShops:mShops.size, backShops:mBack.size
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. รวบรวมสัญญาณ — เรียกของเดิมล้วนๆ ไม่มีสูตรใหม่
// ═══════════════════════════════════════════════════════════════════════════
// ข้อมูลที่จอนี้ต้องใช้อยู่คนละชั้นกับตัวกระตุ้น:
//   bulkSkuCurrentData = tier 2 · bulkSkusData = tier 3 · portview/paceSignal = tier 1
// ถ้าเปิดตอนชั้น 3 ยังไม่มา ของค้างกับของใหม่จะหายเงียบๆ ทั้งที่มีจริง
// ⇒ ต้องรู้ตัวว่าข้อมูลยังไม่ครบ แล้วห้ามปั๊มว่า "อ่านแล้ววันนี้"
function _diDataComplete(){
  try{
    if(window.DataRegistry&&typeof window.DataRegistry.isReady==='function')
      return !!window.DataRegistry.isReady(3);
  }catch(e){}
  // ไม่มี DataRegistry (เช่นในเทสต์) — ดูจากของจริงว่ามีข้อมูลไหม
  return typeof bulkSkusData!=='undefined'&&Object.keys(bulkSkusData||{}).length>0;
}

function buildDailyInsight(){
  if(typeof getPortviewAccounts!=='function')return null;
  const accounts=getPortviewAccounts()||[];
  if(!accounts.length||accounts.length>DI_MAX_ACCOUNTS)return null;

  let overdueItems=0, overdueShops=0, overdueBaht=0;
  let aheadShops=0, aheadBaht=0, newSkuBaht=0;
  const overdueTop=[];   // ร้านที่มีของเลยรอบ เรียงตามเงิน
  const aheadTop=[];     // ร้านที่ซื้อเร็วกว่าเดือนก่อน (พร้อมของใหม่ถ้ามี)
  const newFinds=[];     // ร้านที่เริ่มซื้อของที่ไม่เคยซื้อ
  const signalIds=[];

  accounts.forEach(a=>{
    if(!a||!a.id)return;

    // ── ถึงรอบสั่งแล้วแต่ยังไม่สั่ง (นิยามของ Sense: gone + near) ──
    let rows=null;
    try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(a.id):null; }catch(e){ rows=null; }
    if(rows){
      const late=rows.filter(r=>r.type==='gone'||r.type==='near');
      if(late.length){
        late.sort((x,y)=>(y.gmv||0)-(x.gmv||0));
        late.forEach(r=>signalIds.push(a.id+'::'+r.id));
        const baht=late.reduce((t,r)=>t+(r.gmv||0),0);
        overdueItems+=late.length; overdueShops++; overdueBaht+=baht;
        overdueTop.push({id:a.id,name:a.name||'—',count:late.length,baht,items:late,top:late[0],
          worstLate:late.reduce((m,r)=>Math.max(m,r.daysLate||0),0)});
      }
    }

    // ── ซื้อเร็วกว่าเดือนที่แล้ว (เทียบวันต่อวัน ไม่ใช่เทียบยอดเต็มเดือน) ──
    // paceSignal.expected = อัตราต่อวันของเดือนที่แล้ว × จำนวนวันที่ผ่านไปของเดือนนี้
    const expected=(a.paceSignal||{}).expected||0;
    const ahead=expected>0?((a.gmvToDate||0)-expected):0;
    if(ahead>0){ aheadShops++; aheadBaht+=ahead; }

    // ── ของที่ร้านไม่เคยซื้อมาก่อน (นิยามของ Sense: newSkus) ──
    let sm=null;
    try{ sm=(typeof computeSkuMovementForAccount==='function')?computeSkuMovementForAccount(a.id):null; }catch(e){ sm=null; }
    const news=(sm&&sm.newSkus&&sm.newSkus.length)?sm.newSkus:null;
    if(news){
      newSkuBaht+=news.reduce((t,s)=>t+(s.gmv||0),0);
      newFinds.push({id:a.id,name:a.name||'—',sku:news[0].name,gmv:news[0].gmv||0,mo:sm.recentMo});
    }
    if(ahead>0||news){
      aheadTop.push({id:a.id,name:a.name||'—',baht:ahead,items:news||[],mo:(sm&&sm.recentMo)||''});
    }
  });

  overdueTop.sort((x,y)=>y.baht-x.baht);
  aheadTop.sort((x,y)=>y.baht-x.baht);
  newFinds.sort((x,y)=>y.gmv-x.gmv);

  const fresh=_diFlagNew(signalIds);
  overdueTop.forEach(s=>{ s.items.forEach(r=>{ r.isNew=fresh.has(s.id+'::'+r.id); }); });

  const won=_diLoopClosure();
  const weekly=_diWeekly(fresh.size);

  // ── เลือก "เรื่องใหญ่ของวันนี้" ──
  // ลำดับนี้ไม่ใช่เรื่องรสนิยม: วงจรปิดมาก่อนเพราะมันบอกว่า "สิ่งที่คุณทำได้ผล"
  // ตามด้วยข่าวดีอื่น · ของค้างขึ้นพาดหัวได้ต่อเมื่อไม่มีข่าวดีจริงๆ เท่านั้น
  let big=null;
  if(won&&won.recovered.length){
    const r=won.recovered;
    big={kind:'won',shopId:r[0].aid,celebrate:'big',won:won,
      tag:'ได้ผลแล้ว',
      head:_diEsc(won.shopName)+'<br>กลับมาสั่งแล้ว',
      value:won.baht,
      body:_diEsc(_diDayAgo(won.lastDay))+'คุณทักไป วันนี้เขาสั่ง <b>'
          +r.slice(0,2).map(m=>_diEsc(m.skuName)).join('</b> กับ <b>')+'</b> กลับมาแล้วค่ะ'
          +(won.quiet.length?'<br>เหลืออีก '+won.quiet.length+' รายการที่ยังไม่ได้สั่ง':''),
      cta:'เปิดดู '+r[0].name};
  } else if(newFinds.length&&newFinds[0].gmv>=DI_GOOD_MIN){
    const f=newFinds[0];
    big={kind:'new',shopId:f.id,celebrate:'small',
      tag:'Olive เจอมาให้',
      head:_diEsc(f.name)+'<br>เริ่มซื้อของที่ไม่เคยซื้อ',
      value:f.gmv,
      body:'เดือน '+_diEsc(f.mo||'')+' '+_diEsc(f.name)+' เริ่มสั่ง <b>'+_diEsc(f.sku)+'</b> '
          +'ซึ่งไม่เคยซื้อกับเรามาก่อนเลย',
      cta:'เปิดดู '+f.name};
  } else if(aheadShops>0&&aheadBaht>=DI_GOOD_MIN){
    big={kind:'ahead',shopId:null,celebrate:null,
      tag:'Olive เจอมาให้',
      head:'เดือนนี้พอร์ตคุณ<br>ซื้อเร็วกว่าเดือนที่แล้ว',
      value:aheadBaht,
      body:'<b>'+aheadShops+' ร้าน</b> จากทั้งหมด '+accounts.length+' ร้าน ซื้อมากกว่าจังหวะของเดือนที่แล้ว '
          +'เมื่อเทียบถึงวันเดียวกัน',
      cta:null};
  } else if(overdueTop.length){
    const s=overdueTop[0];
    big={kind:'overdue',shopId:s.id,celebrate:null,
      tag:'ทักวันนี้ยังทัน',
      head:_diEsc(s.name)+'<br>มีของถึงรอบสั่งแล้ว',
      value:s.baht,
      body:'<b>'+_diEsc(s.top.name)+'</b> ปกติสั่งทุก '+s.top.avgInterval+' วัน '
          +'เลยรอบมา '+s.top.daysLate+' วันแล้ว'+(s.count>1?' · รวมทั้งร้าน '+s.count+' รายการ':''),
      cta:'เปิดดู '+s.name};
  }

  return {
    accountCount:accounts.length,
    overdueItems, overdueShops, overdueBaht,
    aheadShops, aheadBaht, newSkuBaht,
    overdueTop, aheadTop, newFinds,
    newCount:fresh.size,
    partial:!_diDataComplete(),
    won, weekly, big,
    quiet:!big&&overdueItems===0
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2b. จอของ TL — เห็นคนในทีม แล้วเห็นว่าร้านไหนของคนนั้นที่ควรพูดถึง
// ═══════════════════════════════════════════════════════════════════════════
// TL ดูแลคน ไม่ได้ดูแลร้าน ⇒ พาดหัวเป็น "คนหนึ่งคน + ร้านหนึ่งร้านของเขา"
// ไม่ใช่กองตัวเลขรวมของทั้งทีม ซึ่งบอกไม่ได้ว่าเช้านี้ควรไปคุยกับใคร
function _diIsTeamMode(){
  const p=(typeof currentUserProfile!=='undefined'&&currentUserProfile)||null;
  return !!(p&&DI_TEAM_ROLES.indexOf(p.role)>=0);
}

// "ร้านที่ควรพูดถึง" ของ KAM หนึ่งคน — บันไดเดียวกับจอ KAM ข่าวดีมาก่อนเสมอ
function _diPickShopWorthMention(accounts){
  let bestNew=null, bestLate=null, bestAhead=null;
  accounts.forEach(a=>{
    if(!a||!a.id)return;

    let sm=null;
    try{ sm=(typeof computeSkuMovementForAccount==='function')?computeSkuMovementForAccount(a.id):null; }catch(e){ sm=null; }
    if(sm&&sm.newSkus&&sm.newSkus.length){
      const top=sm.newSkus[0];
      if(!bestNew||(top.gmv||0)>bestNew.baht)
        bestNew={kind:'new',id:a.id,name:a.name||'—',baht:top.gmv||0,
          why:'เริ่มซื้อ '+(top.name||'ของที่ไม่เคยซื้อ')};
    }

    let rows=null;
    try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(a.id):null; }catch(e){ rows=null; }
    if(rows){
      const late=rows.filter(r=>r.type==='gone'||r.type==='near');
      if(late.length){
        late.sort((x,y)=>(y.gmv||0)-(x.gmv||0));
        const baht=late.reduce((t,r)=>t+(r.gmv||0),0);
        if(!bestLate||baht>bestLate.baht)
          bestLate={kind:'late',id:a.id,name:a.name||'—',baht:baht,count:late.length,
            why:'ของถึงรอบแล้วยังไม่สั่ง '+late.length+' รายการ'};
      }
    }

    const expected=(a.paceSignal||{}).expected||0;
    const ahead=expected>0?((a.gmvToDate||0)-expected):0;
    if(ahead>0&&(!bestAhead||ahead>bestAhead.baht))
      bestAhead={kind:'ahead',id:a.id,name:a.name||'—',baht:ahead,
        why:'ซื้อเร็วกว่าเดือนที่แล้ว'};
  });

  if(bestNew&&bestNew.baht>=DI_GOOD_MIN)return bestNew;
  if(bestLate)return bestLate;
  if(bestAhead&&bestAhead.baht>=DI_GOOD_MIN)return bestAhead;
  if(bestNew)return bestNew;
  return null;   // พอร์ตนิ่ง — ไม่ต้องยกร้านไหนเลย
}

function buildTeamInsight(){
  if(typeof _buildKamGroups!=='function')return null;
  let groups=[];
  try{ groups=_buildKamGroups()||[]; }catch(e){ return null; }
  if(!groups.length)return null;

  let overdueItems=0, overdueShops=0, overdueBaht=0, aheadShops=0, aheadBaht=0, shops=0;
  const people=groups.map(g=>{
    const accts=g.accounts||[];
    shops+=accts.length;
    let lateItems=0, lateShops=0, lateBaht=0, upShops=0, upBaht=0;
    accts.forEach(a=>{
      let rows=null;
      try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(a.id):null; }catch(e){ rows=null; }
      if(rows){
        const late=rows.filter(r=>r.type==='gone'||r.type==='near');
        if(late.length){ lateItems+=late.length; lateShops++; lateBaht+=late.reduce((t,r)=>t+(r.gmv||0),0); }
      }
      const expected=(a.paceSignal||{}).expected||0;
      const ahead=expected>0?((a.gmvToDate||0)-expected):0;
      if(ahead>0){ upShops++; upBaht+=ahead; }
    });
    overdueItems+=lateItems; overdueShops+=lateShops; overdueBaht+=lateBaht;
    aheadShops+=upShops; aheadBaht+=upBaht;
    return {
      email:g.kamEmail||'', name:g.kamName||'—', total:accts.length,
      pace:g.pace||0, paceCls:g.paceCls||'',
      lateItems, lateShops, lateBaht, upShops, upBaht,
      mention:_diPickShopWorthMention(accts),
      accounts:accts
    };
  });

  // เรียงคนด้วยเงินของเรื่องที่ควรพูดถึง ไม่ใช่ตามชื่อ · คนที่ไม่มีเรื่องอยู่ท้ายสุด
  people.sort((x,y)=>((y.mention&&y.mention.baht)||0)-((x.mention&&x.mention.baht)||0));

  // พาดหัว = คนที่มีเรื่องคุ้มค่าพูดถึงที่สุด ข่าวดีมาก่อน
  const good=people.filter(p=>p.mention&&(p.mention.kind==='new'||p.mention.kind==='ahead'));
  const bad=people.filter(p=>p.mention&&p.mention.kind==='late');
  const lead=good[0]||bad[0]||null;
  let big=null;
  if(lead){
    const m=lead.mention;
    const isGood=(m.kind!=='late');
    big={kind:'team-'+m.kind,shopId:m.id,celebrate:m.kind==='new'?'small':null,
      tag:isGood?'Olive เจอมาให้':'คุยกับทีมวันนี้ยังทัน',
      head:_diEsc(lead.name)+'<br>'+_diEsc(m.name)+' '+(m.kind==='new'?'เริ่มซื้อของที่ไม่เคยซื้อ'
        :m.kind==='late'?'มีของถึงรอบสั่งแล้ว':'ซื้อเร็วกว่าเดือนที่แล้ว'),
      value:m.baht,
      body:'<b>'+_diEsc(lead.name)+'</b> ดูแล '+lead.total+' ร้าน · '+_diEsc(m.why),
      cta:'เปิดดู '+m.name};
  }

  return {
    team:true, people, shops, peopleCount:people.length,
    overdueItems, overdueShops, overdueBaht, aheadShops, aheadBaht,
    quietPeople:people.filter(p=>!p.mention).length,
    partial:!_diDataComplete(),
    big
  };
}

function _diRenderTeamBody(d){
  const name=_diMyName();
  let h='';
  h+='<p class="di-eyebrow di-rise di-d1">'+_diEsc(_diDateLabel())+'</p>';
  h+='<p class="di-greet di-rise di-d1">'+_diEsc(_diGreeting())+(name?' คุณ'+_diEsc(name):'')+'</p>';

  h+='<div class="di-find di-rise di-d2">';
  if(d.big){
    h+='<span class="di-tag'+(d.big.kind==='team-late'?' di-calm':'')+'">'+_diEsc(d.big.tag)+'</span>';
    h+='<p class="di-head">'+d.big.head+'</p>';
    h+='<p class="di-value" id="di-value">'+_diBaht(d.big.value)+'</p>';
    h+='<p class="di-p">'+d.big.body+'</p>';
    if(d.big.shopId)h+='<button class="di-cta" id="di-cta">'+_diEsc(d.big.cta)+'</button>';
  }else{
    h+='<span class="di-tag di-calm">วันนี้ยังไม่มีอะไรใหม่</span>';
    h+='<p class="di-head">ทีมนิ่งดีค่ะ</p>';
    h+='<p class="di-value"><span id="di-value">'+d.peopleCount+'</span><small> คน · '+d.shops+' ร้าน</small></p>';
    h+='<p class="di-p">ไม่มีใครในทีมที่มีเรื่องต้องรีบคุยวันนี้ค่ะ</p>';
  }
  h+='</div>';

  // รายชื่อคน — อยู่ในจอเดียวกัน ไม่ต้องกดเข้าไปอีกหน้า
  h+='<div class="di-rest di-rise di-d3"><p class="di-rest-k">คนในทีม '+d.peopleCount+' คน</p>';
  d.people.forEach((p,i)=>{
    const m=p.mention;
    const sub=m?(_diEsc(m.name)+' · '+_diEsc(m.why))
              :'พอร์ตนิ่ง ไม่มีอะไรต้องคุย';
    h+='<button class="di-row di-person di-c'+(i%4)+'" data-kam="'+_diEsc(p.email||p.name)+'">'
      +'<span class="di-row-m">'
      +'<span class="di-row-title"><i></i>'+_diEsc(p.name)+' <em>'+p.total+' ร้าน</em></span>'
      +'<span class="di-row-sub">'+sub+'</span></span>'
      +(m?'<span class="di-row-v '+(m.kind==='late'?'di-neg':'di-pos')+'">'
          +(m.kind==='late'?'':'+')+_diBaht(m.baht)+'</span>':'')
      +'<svg class="di-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
      +'</button>';
  });
  h+='</div>';

  h+='<div class="di-rest di-rise di-d4"><p class="di-rest-k">รวมทั้งทีม</p>';
  h+=_diRowHtml('di-row-overdue','ถึงรอบสั่งแล้วแต่ยังไม่สั่ง',
      d.overdueItems+' รายการ ใน '+d.overdueShops+' ร้าน',
      d.overdueItems?_diBaht(d.overdueBaht):'', 'di-neg', d.overdueItems===0);
  h+=_diRowHtml('di-row-ahead','ซื้อเพิ่มขึ้น',
      d.aheadShops+' ร้าน · เทียบวันต่อวันกับเดือนที่แล้ว',
      d.aheadShops?'+'+_diBaht(d.aheadBaht):'', 'di-pos', d.aheadShops===0);
  h+='</div>';

  h+='<p class="di-method di-rise di-d4">'
    +'"ร้านที่ควรพูดถึง" เลือกให้คนละหนึ่งร้าน — ของที่ร้านเพิ่งเริ่มซื้อมาก่อน '
    +'ถ้าไม่มีจึงเป็นร้านที่ของค้างมากที่สุด · แตะชื่อคนเพื่อดูร้านที่เหลือ</p>';
  return h;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. การไปเยี่ยมร้านรายไตรมาส — ส่วนเสริม เติมทีหลัง ไม่มีก็ไม่เป็นไร
// ═══════════════════════════════════════════════════════════════════════════
// จงใจไม่ให้อยู่ในเส้นทางหลัก: ยิง Supabase หนึ่งครั้ง ถ้าไม่ตอบก็ซ่อนแถวนั้นทิ้ง
// จอที่เหลือมาจาก R2 ทั้งหมด ⇒ Supabase ล่มก็ยังเปิดอ่านได้
async function _diFillVisitRow(){
  const el=document.getElementById('di-row-visit');
  if(!el)return;
  try{
    if(typeof supa==='undefined'||!supa)return;
    const p=(typeof currentUserProfile!=='undefined'&&currentUserProfile)||{};
    const email=(p.email||'').toLowerCase();
    if(!email)return;
    const accounts=(typeof getPortviewAccounts==='function'?getPortviewAccounts():[])||[];
    if(!accounts.length)return;

    const now=new Date();
    const qStart=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);
    const resp=await supa.from('ci_sessions')
      .select('account_id')
      .eq('owner_email',email)
      .gte('visited_at',qStart.toISOString());
    // supabase-js ไม่ throw บน 402/5xx — มันคืน {data:null,error} เงียบๆ
    // ⇒ ต้องเช็ค error เอง ห้ามอนุมานจากการมี data
    if(!resp||resp.error||!Array.isArray(resp.data))return;

    const visited=new Set(resp.data.map(r=>String(r.account_id||'')).filter(Boolean));
    const notVisited=accounts.filter(a=>!visited.has(String(a.id)));
    if(!notVisited.length){ el.remove(); return; }

    // ในนั้นมีกี่ร้านที่มีของถึงรอบแล้วด้วย — ทำให้แถวนี้บอกลำดับความสำคัญได้ ไม่ใช่แค่จำนวน
    const d=window._diLastData||{};
    const bahtBy={};
    (d.overdueTop||[]).forEach(s=>{ bahtBy[String(s.id)]=s.baht; });
    const both=notVisited.filter(a=>bahtBy[String(a.id)]>0).length;
    d.visitList=notVisited
      .map(a=>({id:a.id,name:a.name||'—',baht:bahtBy[String(a.id)]||0,items:[]}))
      .sort((x,y)=>y.baht-x.baht);
    const qLabel='Q'+(Math.floor(now.getMonth()/3)+1);
    el.querySelector('.di-row-title').textContent='ยังไม่ได้ไปเยี่ยมใน '+qLabel;
    el.querySelector('.di-row-sub').textContent=
      notVisited.length+' ร้าน'+(both?' · ใน '+both+' ร้านมีของที่ถึงรอบสั่งแล้วด้วย':'');
    el.style.display='';
  }catch(e){ /* เงียบไว้ — แถวนี้เป็นของแถม ไม่ใช่เนื้อหาหลัก */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. หน้าตา — ระบุสีตรงๆ ทุกจุด
// ═══════════════════════════════════════════════════════════════════════════
// บทเรียนจาก pill อัปเดตเวอร์ชัน (v283): sheet นี้อยู่คนละบริบทกับ token ของแอป
// ถ้าใช้ var(--…) มันจะไม่ resolve แล้วได้ขาวบนขาว · ค่าสีทั้งหมดคัดจาก
// freshket-insights/design/tokens.css ซึ่งเป็นชุดที่บุชเลือก
function _diInjectStyles(){
  if(document.getElementById('di-style'))return;
  const st=document.createElement('style');
  st.id='di-style';
  st.textContent=`
#di-sheet{position:fixed;inset:0;z-index:9400;background:#FFFFFF;color:#1D4849;
  display:flex;flex-direction:column;font-family:'Noto Sans Thai',-apple-system,BlinkMacSystemFont,sans-serif;
  transform:translateY(100%);transition:transform .34s cubic-bezier(.32,.72,0,1);
  overscroll-behavior:contain;
  /* iPhone มีติ่ง: ไม่กันไว้ บรรทัดวันที่จะไปนอนใต้แถบสถานะ */
  padding-top:env(safe-area-inset-top)}
#di-sheet.di-on{transform:translateY(0)}
#di-sheet .di-grab{flex:0 0 auto;height:26px;display:flex;align-items:center;justify-content:center}
#di-sheet .di-grab i{display:block;width:38px;height:4px;border-radius:2px;background:#E4ECEA}
#di-sheet .di-close{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;z-index:2;
  border:none;cursor:pointer;background:#F4F8F6;color:#48696A;font-family:inherit;
  font-size:13px;font-weight:600;border-radius:999px;padding:7px 14px}
#di-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  padding:6px 22px calc(40px + env(safe-area-inset-bottom))}
#di-body::-webkit-scrollbar{display:none}

#di-sheet .di-eyebrow{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#7D9494}
#di-sheet .di-greet{font-size:15px;color:#48696A;margin-top:8px}
#di-sheet .di-rise{opacity:0;transform:translateY(14px)}
#di-sheet.di-in .di-rise{opacity:1;transform:none;
  transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .5s cubic-bezier(.16,1,.3,1)}
#di-sheet.di-in .di-d1{transition-delay:.05s}
#di-sheet.di-in .di-d2{transition-delay:.15s}
#di-sheet.di-in .di-d3{transition-delay:.25s}
#di-sheet.di-in .di-d4{transition-delay:.35s}

#di-sheet .di-find{margin-top:18px}
#di-sheet .di-tag{display:inline-block;font-size:12.5px;font-weight:600;color:#006650;
  background:#E9FFF6;border-radius:999px;padding:5px 12px}
#di-sheet .di-tag.di-calm{color:#BA8500;background:#FFFBD6}
#di-sheet .di-head{font-size:26px;font-weight:700;letter-spacing:-.03em;line-height:1.32;margin-top:14px}
#di-sheet .di-value{font-size:46px;font-weight:700;color:#008065;letter-spacing:-.035em;
  line-height:1;margin-top:14px;font-variant-numeric:tabular-nums}
#di-sheet .di-value small{font-size:21px;font-weight:600;color:#48696A;letter-spacing:0}
#di-sheet .di-p{font-size:15px;color:#48696A;margin-top:12px;line-height:1.6}
#di-sheet .di-p b{color:#1D4849;font-weight:600}
#di-sheet .di-cta{margin-top:16px;background:#008065;color:#fff;border:none;border-radius:12px;
  font-family:inherit;font-size:14.5px;font-weight:600;padding:11px 18px;cursor:pointer}
#di-sheet .di-cta:active{transform:scale(.96)}

/* การ์ดสรุปผลสะสมของเดือน — ใต้พาดหัว "ได้ผลแล้ว" */
#di-sheet .di-won{background:#E9FFF6;border-radius:16px;padding:14px 16px;margin-top:16px;
  display:flex;gap:11px;align-items:flex-start}
#di-sheet .di-won-ic{width:24px;height:24px;border-radius:50%;background:#008065;flex:0 0 auto;
  display:flex;align-items:center;justify-content:center;margin-top:1px;color:#fff}
#di-sheet .di-won-ic svg{width:14px;height:14px}
#di-sheet .di-won b{display:block;font-size:14.5px;font-weight:600;line-height:1.45}
#di-sheet .di-won span.s{display:block;font-size:13.5px;color:#48696A;margin-top:2px;line-height:1.5}

#di-sheet .di-rest{margin-top:30px;border-top:1px solid #E4ECEA}
#di-sheet .di-rest-k{font-size:13px;color:#7D9494;margin:16px 0 2px}
#di-sheet .di-row{display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;
  font-family:inherit;text-align:left;padding:15px 0;cursor:pointer;color:#1D4849;
  border-bottom:1px solid #E4ECEA}
#di-sheet .di-row:last-of-type{border-bottom:none}
#di-sheet .di-row:active{transform:scale(.985)}
#di-sheet .di-row-m{flex:1;min-width:0}
#di-sheet .di-row-title{display:block;font-size:15px;font-weight:600;line-height:1.4}
#di-sheet .di-row-sub{display:block;font-size:13.5px;color:#48696A;margin-top:2px;line-height:1.45}
#di-sheet .di-row-v{flex:0 0 auto;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
#di-sheet .di-row-v.di-neg{color:#B3261E}
#di-sheet .di-row-v.di-pos{color:#008065}
#di-sheet .di-chev{flex:0 0 auto;width:15px;height:15px;color:#7D9494}

#di-sheet .di-olive{display:flex;gap:12px;align-items:flex-start;margin-top:26px;padding-top:20px;
  border-top:1px solid #E4ECEA}
#di-sheet .di-av{width:30px;height:30px;border-radius:50%;flex:0 0 auto;color:#fff;
  background:linear-gradient(140deg,#00CE7C,#008065);
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
#di-sheet .di-olive p{font-size:14.5px;color:#48696A;line-height:1.6}
#di-sheet .di-olive p b{color:#1D4849;font-weight:600}
#di-sheet .di-method{font-size:12.5px;color:#7D9494;margin-top:20px;line-height:1.55}

#di-boot{position:absolute;inset:0;z-index:5;background:#FFFFFF;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 40px;text-align:center}
#di-boot.di-gone{opacity:0;pointer-events:none;transition:opacity .45s ease}
#di-boot .di-av{width:46px;height:46px;font-size:18px;animation:di-pulse 1.6s ease-in-out infinite}
#di-boot p{font-size:15px;color:#48696A;line-height:1.6}
@keyframes di-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.07);opacity:.86}}

/* ── หน้ารายการเต็ม — เลื่อนเข้ามาจากขวาทับจอสรุป ─────────────────────── */
#di-list{position:absolute;inset:0;z-index:4;background:#FFFFFF;display:flex;flex-direction:column;
  padding-top:env(safe-area-inset-top);
  transform:translateX(100%);transition:transform .32s cubic-bezier(.32,.72,0,1)}
#di-list.di-on{transform:translateX(0)}
#di-list .di-top{flex:0 0 auto;display:flex;align-items:flex-end;gap:10px;padding:26px 16px 12px;
  border-bottom:1px solid #E4ECEA}
#di-list .di-back{background:none;border:none;padding:6px;cursor:pointer;color:#1D4849;display:flex}
#di-list .di-back svg{width:22px;height:22px}
#di-list .di-top-t{flex:1;min-width:0}
#di-list .di-top-t b{display:block;font-size:15.5px;font-weight:700;letter-spacing:-.01em}
#di-list .di-top-t span{display:block;font-size:12.5px;color:#48696A;margin-top:1px}
#di-list-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  padding:4px 22px calc(40px + env(safe-area-inset-bottom))}
#di-list-body::-webkit-scrollbar{display:none}

#di-sheet .di-tools{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 2px}
#di-sheet .di-tools button{background:#F4F8F6;border:1px solid #E4ECEA;border-radius:999px;
  color:#48696A;font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 13px;cursor:pointer}
#di-sheet .di-tools button.on{background:#008065;border-color:#008065;color:#fff}
#di-sheet .di-hint{font-size:12.5px;color:#7D9494;margin-top:10px;line-height:1.5}

#di-sheet .di-grp{display:flex;align-items:center;gap:9px;padding:22px 0 8px}
#di-sheet .di-grp i{width:9px;height:9px;border-radius:3px;flex:0 0 auto;font-style:normal}
#di-sheet .di-grp b{font-size:15.5px;font-weight:700;letter-spacing:-.015em;line-height:1.35;
  min-width:0;overflow-wrap:anywhere}
#di-sheet .di-grp span{font-size:12.5px;color:#7D9494;flex:0 0 auto;margin-left:auto;white-space:nowrap}
/* สีชื่อร้าน = สีประจำร้าน ให้จำร้านได้จากสี ไม่ใช่สีบอกดี/ร้าย
   ตัวเลขในลิสต์เลยเป็นสีหมึก ไม่งั้นสองระบบสีจะตีกัน */
#di-sheet .di-c0 b{color:#CC5200} #di-sheet .di-c0 i{background:#FF6600}
#di-sheet .di-c1 b{color:#C43E74} #di-sheet .di-c1 i{background:#C43E74}
#di-sheet .di-c2 b{color:#BA8500} #di-sheet .di-c2 i{background:#BA8500}
#di-sheet .di-c3 b{color:#B3261E} #di-sheet .di-c3 i{background:#B3261E}

#di-sheet .di-item{display:flex;align-items:flex-start;gap:12px;width:100%;background:none;border:none;
  font-family:inherit;text-align:left;padding:14px 0;cursor:pointer;color:#1D4849;
  border-bottom:1px solid #E4ECEA;
  transition:opacity .3s ease,transform .12s ease;-webkit-touch-callout:none;user-select:none}
#di-sheet .di-item:active{transform:scale(.985)}
#di-sheet .di-item.di-done{opacity:.5}
#di-sheet .di-item-m{flex:1;min-width:0}
#di-sheet .di-item-n{display:block;font-size:14.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
#di-sheet .di-item-s{display:block;font-size:13px;color:#48696A;margin-top:3px;line-height:1.45}
#di-sheet .di-item-v{flex:0 0 auto;font-size:14.5px;font-weight:700;color:#1D4849;
  font-variant-numeric:tabular-nums}
#di-sheet .di-badge{display:inline-block;font-size:11px;font-weight:700;color:#CC5200;
  background:#FFEEE1;border-radius:999px;padding:1px 7px;margin-left:6px}
#di-sheet .di-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;
  color:#006650;background:#E9FFF6;border-radius:999px;padding:2px 8px;margin-top:5px}

/* ── แถวรายชื่อคนในทีม (จอ TL) ───────────────────────────────────────── */
#di-sheet .di-person .di-row-title{display:flex;align-items:center;gap:8px}
#di-sheet .di-person .di-row-title i{width:9px;height:9px;border-radius:3px;flex:0 0 auto;font-style:normal}
#di-sheet .di-person .di-row-title em{font-style:normal;font-size:12.5px;font-weight:500;color:#7D9494}
#di-sheet .di-person.di-c0 .di-row-title{color:#CC5200} #di-sheet .di-person.di-c0 i{background:#FF6600}
#di-sheet .di-person.di-c1 .di-row-title{color:#C43E74} #di-sheet .di-person.di-c1 i{background:#C43E74}
#di-sheet .di-person.di-c2 .di-row-title{color:#BA8500} #di-sheet .di-person.di-c2 i{background:#BA8500}
#di-sheet .di-person.di-c3 .di-row-title{color:#B3261E} #di-sheet .di-person.di-c3 i{background:#B3261E}

/* ── บล็อกสรุปสัปดาห์ (วันจันทร์) วางบนสุดของจอ ─────────────────────── */
#di-sheet .di-week{background:#F4F8F6;border:1px solid #E4ECEA;border-radius:16px;
  padding:13px 15px;margin-top:16px}
#di-sheet .di-week-k{font-size:11.5px;font-weight:700;letter-spacing:.07em;
  text-transform:uppercase;color:#7D9494}
#di-sheet .di-week p{font-size:14.5px;line-height:1.55;color:#48696A;margin-top:6px}
#di-sheet .di-week p b{color:#1D4849;font-weight:700}

/* ── สรุปเดือนแบบสไลด์ ──────────────────────────────────────────────── */
#di-wrap{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;
  padding:env(safe-area-inset-top) 0 0;color:#fff;
  background:linear-gradient(155deg,#0F2E27,#00443A 62%,#063A32);
  opacity:0;pointer-events:none;transition:opacity .3s ease}
#di-wrap.di-on{opacity:1;pointer-events:auto}
#di-wrap .di-bars{display:flex;gap:4px;padding:12px 16px 0}
#di-wrap .di-bars i{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.24)}
#di-wrap .di-bars i.on{background:#00CE7C}
#di-wrap .di-wclose{position:absolute;top:calc(10px + env(safe-area-inset-top));right:12px;
  z-index:2;background:rgba(255,255,255,.14);border:none;color:#fff;font-family:inherit;
  font-size:12.5px;font-weight:600;border-radius:999px;padding:6px 13px;cursor:pointer}
#di-wrap .di-slide{flex:1;display:flex;flex-direction:column;justify-content:center;
  padding:0 26px 70px;text-align:left}
#di-wrap .di-wk{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
  color:rgba(199,255,231,.62)}
#di-wrap .di-wh{font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1.3;margin-top:12px}
#di-wrap .di-wv{font-size:48px;font-weight:700;letter-spacing:-.04em;line-height:1;
  margin-top:16px;color:#00CE7C;font-variant-numeric:tabular-nums}
#di-wrap .di-wp{font-size:15px;line-height:1.62;color:rgba(214,245,232,.8);margin-top:14px}
#di-wrap .di-wp b{color:#fff;font-weight:600}
#di-wrap .di-wlist{margin-top:16px;display:flex;flex-direction:column;gap:9px}
#di-wrap .di-wrow{display:flex;align-items:baseline;gap:10px;font-size:14.5px}
#di-wrap .di-wrow span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#di-wrap .di-wrow b{flex:0 0 auto;color:#00CE7C;font-weight:700;font-variant-numeric:tabular-nums}
#di-wrap .di-wgo{margin-top:24px;align-self:flex-start;background:#00CE7C;color:#04352C;
  border:none;border-radius:12px;font-family:inherit;font-size:14.5px;font-weight:700;
  padding:12px 20px;cursor:pointer}
#di-wrap .di-wtap{position:absolute;bottom:26px;left:0;right:0;text-align:center;
  font-size:12px;color:rgba(199,255,231,.5)}

/* ── ฉลอง: ตำแหน่งกำหนดตายตัว ทดสอบซ้ำได้ผลเดิม ห้ามใช้ Math.random ── */
#di-spark{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
#di-spark i{position:absolute;width:7px;height:7px;border-radius:2px;opacity:0;
  animation:di-pop 1.15s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes di-pop{0%{opacity:0;transform:translateY(0) scale(.4)}
  18%{opacity:1}100%{opacity:0;transform:translateY(-96px) scale(1)}}

/* ปุ่มใน nav — ขยับเฉพาะตอนยังไม่อ่าน อนิเมชันเป็นข้อมูล ไม่ใช่ของประดับ */
#nav-restaurant.di-live{color:#00CE7C}
#nav-restaurant.di-live .di-pip{position:absolute;top:2px;right:calc(50% - 16px);width:7px;height:7px;
  border-radius:50%;background:#FF6600}
#nav-restaurant.di-live.di-unread svg{animation:di-breathe 3.4s ease-in-out infinite}
@keyframes di-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}

@media (prefers-reduced-motion:reduce){
  #di-sheet,#di-list,#di-wrap,#di-sheet.di-in .di-rise,#di-boot{transition:none}
  #di-sheet .di-rise{opacity:1;transform:none}
  #di-boot .di-av,#nav-restaurant.di-live.di-unread svg,#di-spark i{animation:none}
  #di-spark{display:none}
}
`;
  document.head.appendChild(st);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. ฉลอง — ขนาดแปรตามขนาดข่าว และจุดครั้งเดียวต่อวัน
// ═══════════════════════════════════════════════════════════════════════════
const DI_SPARK_COLORS=['#00CE7C','#FF6600','#FFF53E','#C43E74'];
function _diCelebrate(level){
  if(!level||_diReduceMotion())return false;
  if(_diLoadState().celebrated===_diToday())return false;   // วันละครั้งพอ
  const host=document.getElementById('di-spark');
  if(!host)return false;
  const n=level==='big'?16:8;
  let html='';
  for(let i=0;i<n;i++){
    // ตำแหน่งคำนวณจาก index ล้วนๆ — เปิดกี่ครั้งก็ได้ภาพเดิม เทสต์ซ้ำได้
    const left=12+((i*37)%72);
    const delay=((i%5)*0.06).toFixed(2);
    const dur=(0.95+((i%4)*0.12)).toFixed(2);
    html+='<i style="left:'+left+'%;top:'+(level==='big'?38:44)+'%;'
        +'background:'+DI_SPARK_COLORS[i%4]+';animation-delay:'+delay+'s;'
        +'animation-duration:'+dur+'s"></i>';
  }
  host.innerHTML=html;
  _diSaveState({celebrated:_diToday()});
  setTimeout(()=>{ const h=document.getElementById('di-spark'); if(h)h.innerHTML=''; },2400);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. เนื้อหาจอสรุป
// ═══════════════════════════════════════════════════════════════════════════
function _diRowHtml(id,title,sub,value,cls,hidden){
  return '<button class="di-row" id="'+id+'"'+(hidden?' style="display:none"':'')+'>'
    +'<span class="di-row-m"><span class="di-row-title">'+_diEsc(title)+'</span>'
    +'<span class="di-row-sub">'+_diEsc(sub)+'</span></span>'
    +(value?'<span class="di-row-v '+(cls||'')+'">'+_diEsc(value)+'</span>':'')
    +'<svg class="di-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
    +'</button>';
}

function _diRenderBody(d){
  const name=_diMyName();
  let h='';
  h+='<p class="di-eyebrow di-rise di-d1">'+_diEsc(_diDateLabel())+'</p>';
  h+='<p class="di-greet di-rise di-d1">'+_diEsc(_diGreeting())+(name?' คุณ'+_diEsc(name):'')+'</p>';

  // วันจันทร์: วางสรุปสัปดาห์ไว้บนสุด เพราะเป็นสิ่งที่ต่างจากทุกวัน
  if(d.weekly){
    const w=d.weekly;
    let line='';
    if(w.items){
      line='สัปดาห์ที่แล้วคุณทักไป <b>'+w.items+' รายการ</b> ใน <b>'+w.shops+' ร้าน</b>'
          +(w.backShops?' · กลับมาสั่งแล้ว <b>'+w.backShops+' ร้าน</b> '+_diBaht(w.backBaht)
                       :' · ยังไม่มีร้านไหนกลับมาสั่ง');
    }
    if(w.newCount){
      line+=(line?'<br>':'')+'ตั้งแต่ครั้งก่อนที่เปิดดู มีของถึงรอบเพิ่มอีก <b>'+w.newCount+' รายการ</b>';
    }
    h+='<div class="di-week di-rise di-d1"><p class="di-week-k">สัปดาห์ที่ผ่านมา</p><p>'+line+'</p></div>';
  }

  h+='<div class="di-find di-rise di-d2">';
  if(d.big){
    h+='<span class="di-tag">'+_diEsc(d.big.tag)+'</span>';
    h+='<p class="di-head">'+d.big.head+'</p>';
    h+='<p class="di-value" id="di-value">'+_diBaht(d.big.value)+'</p>';
    h+='<p class="di-p">'+d.big.body+'</p>';
    if(d.big.cta&&d.big.shopId)h+='<button class="di-cta" id="di-cta">'+_diEsc(d.big.cta)+'</button>';
    if(d.big.won&&d.big.won.monthBackShops){
      const w=d.big.won;
      h+='<div class="di-won"><span class="di-won-ic">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
        +'</span><span><b>เดือนนี้ทักไป '+w.monthShops+' ร้าน กลับมาสั่ง '+w.monthBackShops+' ร้าน</b>'
        +'<span class="s">คิดเป็นเงินที่ดึงกลับได้ '+_diBaht(w.monthBackBaht)+'</span></span></div>';
    }
  }else{
    // พอร์ตนิ่ง — ยังเด้งเหมือนเดิม แต่ให้กำลังใจ ไม่ใช่จอว่างและไม่ใช่ขุดเรื่องเล็กมาทำให้ดูมีปัญหา
    h+='<span class="di-tag di-calm">วันนี้ยังไม่มีอะไรใหม่</span>';
    h+='<p class="di-head">วันนี้ไม่มีอะไรต้องรีบค่ะ</p>';
    h+='<p class="di-value"><span id="di-value">'+d.aheadShops+'</span><small> จาก '+d.accountCount+' ร้าน</small></p>';
    h+='<p class="di-p">ซื้อเร็วกว่าจังหวะของเดือนที่แล้ว เมื่อเทียบถึงวันเดียวกัน<br>'
      +'พอร์ตอยู่ในทรงที่ดี ที่ทำอยู่มาถูกทางแล้วค่ะ</p>';
  }
  h+='</div>';

  h+='<div class="di-rest di-rise di-d3"><p class="di-rest-k">วันนี้ยังมี</p>';
  h+=_diRowHtml('di-row-overdue','ถึงรอบสั่งแล้วแต่ยังไม่สั่ง',
      d.overdueItems+' รายการ ใน '+d.overdueShops+' ร้าน'+(d.newCount?' · เพิ่งโผล่ '+d.newCount:''),
      d.overdueItems?_diBaht(d.overdueBaht):'', 'di-neg', d.overdueItems===0);
  h+=_diRowHtml('di-row-ahead','ซื้อเพิ่มขึ้น',
      d.aheadShops+' ร้าน · เทียบวันต่อวันกับเดือนที่แล้ว'
        +(d.newSkuBaht?' · ในนั้นเป็นของที่ไม่เคยซื้อ '+_diBaht(d.newSkuBaht):''),
      d.aheadShops?'+'+_diBaht(d.aheadBaht):'', 'di-pos', d.aheadShops===0);
  // แถวการไปเยี่ยม: ซ่อนไว้ก่อน แล้วให้ _diFillVisitRow เปิดถ้า Supabase ตอบ
  h+=_diRowHtml('di-row-visit','ยังไม่ได้ไปเยี่ยมไตรมาสนี้','', '', '', true);
  h+='</div>';

  h+='<div class="di-olive di-rise di-d4"><span class="di-av">O</span><p>'+_diOliveLine(d)+'</p></div>';
  h+='<p class="di-method di-rise di-d4">'
    +'"ถึงรอบแต่ยังไม่สั่ง" ดูจากรอบสั่งจริงของเดือนนี้ · "ซื้อเพิ่มขึ้น" เทียบถึงวันเดียวกันของเดือนที่แล้ว · '
    +'"ของที่ไม่เคยซื้อ" เทียบเดือนที่ปิดแล้วสองเดือน</p>';
  return h;
}

// เสียง Olive — ข้อความเขียนตายตัวจากตัวเลขจริง ไม่ได้เรียก AI
function _diOliveLine(d){
  if(d.won&&d.won.monthBackShops)
    return 'ที่ทักไปเดือนนี้ได้ผล <b>'+d.won.monthBackShops+' จาก '+d.won.monthShops+' ร้าน</b>นะคะ'
      +(d.overdueShops?' เหลืออีก <b>'+d.overdueShops+' ร้าน</b>ที่ยังมีของค้างรอบอยู่':'');
  // ทักข้ามเดือน: ยอดสะสมของเดือนนี้ยังเป็นศูนย์ แต่ของกลับมาสั่งแล้วจริง
  if(d.won&&d.won.recovered.length)
    return 'ที่ทักไปได้ผลแล้ว <b>'+d.won.recovered.length+' รายการ</b>กลับมาสั่งค่ะ'
      +(d.overdueShops?' เหลืออีก <b>'+d.overdueShops+' ร้าน</b>ที่ยังมีของค้างรอบอยู่':'');
  if(d.overdueItems===0&&d.aheadShops>0)
    return 'วันนี้ไม่มีของค้างรอบเลยสักร้านนะคะ <b>'+d.aheadShops+' ร้าน</b>ซื้อเร็วกว่าเดือนที่แล้วด้วย';
  if(d.overdueShops>0&&d.aheadShops>0)
    return '<b>'+d.aheadShops+' ร้าน</b>ซื้อเร็วกว่าเดือนที่แล้ว ส่วนอีก <b>'+d.overdueShops+' ร้าน</b>'
      +'มีของถึงรอบแล้วยังไม่สั่ง ทักวันนี้ยังทันค่ะ';
  if(d.overdueShops>0)
    return 'มี <b>'+d.overdueShops+' ร้าน</b>ที่ของถึงรอบแล้วยังไม่สั่ง รวม '+_diBaht(d.overdueBaht)+' ค่ะ';
  return 'พอร์ต '+d.accountCount+' ร้านของคุณวันนี้เรียบร้อยดีค่ะ';
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. หน้ารายการเต็ม
// ═══════════════════════════════════════════════════════════════════════════
// จงใจทำเป็นชั้นที่สองในจอเดียวกัน ไม่ใช่ scr- ใหม่ในเชลล์ — ได้ประสบการณ์เดียวกัน
// (เลื่อนเข้ามาจากขวา กดย้อนกลับ) โดยไม่ต้องแตะ NAV_CONFIG หรือ showScreen ของทุก role
let _diListSort='baht';
let _diListKind='overdue';

function _diSetListSort(v){ _diListSort=v; }
function _diDoneKey(aid,sku){ return aid+'::'+sku; }
function _diDoneToday(){
  const m=(_diLoadState().marks||{})[_diToday()]||[];
  return new Set(m.map(x=>_diDoneKey(x.aid,x.sku)));
}
function _diMarkHandled(aid,name,sku,skuName,gmv){
  const st=_diLoadState();
  const marks=st.marks||{};
  const today=_diToday();
  const day=marks[today]||[];
  if(day.some(x=>x.aid===aid&&String(x.sku)===String(sku)))return false;
  day.push({aid:aid,name:name,sku:String(sku),skuName:skuName,gmv:gmv||0});
  marks[today]=day;
  // ตัดของเก่าทิ้ง ไม่ให้ localStorage โตไม่มีที่สิ้นสุด
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-DI_MARK_KEEP);
  const cut=cutoff.getFullYear()+'-'+String(cutoff.getMonth()+1).padStart(2,'0')+'-'+String(cutoff.getDate()).padStart(2,'0');
  Object.keys(marks).forEach(k=>{ if(k<cut)delete marks[k]; });
  _diSaveState({marks:marks});
  return true;
}

function _diListTitle(kind,d){
  if(d.team&&kind.indexOf('kam:')===0){
    const who=kind.slice(4);
    const p=(d.people||[]).find(x=>(x.email||x.name)===who);
    return {t:(p&&p.name)||'ร้านของ KAM',
      s:((p&&p.total)||0)+' ร้าน'+(p&&p.lateBaht?' · ของค้าง '+_diBaht(p.lateBaht):'')};
  }
  if(kind==='ahead')return {t:'ซื้อเพิ่มขึ้น',s:d.aheadShops+' ร้าน · +'+_diBaht(d.aheadBaht)};
  if(kind==='visit')return {t:'ยังไม่ได้ไปเยี่ยมไตรมาสนี้',s:((d.visitList||[]).length)+' ร้าน'};
  return {t:'ถึงรอบสั่งแล้วแต่ยังไม่สั่ง',
    s:d.overdueItems+' รายการ · '+d.overdueShops+' ร้าน · '+_diBaht(d.overdueBaht)};
}

function _diListGroups(kind,d){
  // จอ TL: 'kam:<email>' = ร้านของคนคนนั้น · overdue/ahead = ทั้งทีม
  if(d.team){
    let accts=[];
    if(kind.indexOf('kam:')===0){
      const who=kind.slice(4);
      const p=(d.people||[]).find(x=>(x.email||x.name)===who);
      accts=(p&&p.accounts)||[];
    }else{
      (d.people||[]).forEach(p=>{ accts=accts.concat(p.accounts||[]); });
    }
    const out=[];
    accts.forEach(a=>{
      let rows=null;
      try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(a.id):null; }catch(e){ rows=null; }
      const late=rows?rows.filter(r=>r.type==='gone'||r.type==='near'):[];
      if(kind==='ahead'){
        const expected=(a.paceSignal||{}).expected||0;
        const ahead=expected>0?((a.gmvToDate||0)-expected):0;
        if(ahead>0)out.push({id:a.id,name:a.name||'—',baht:ahead,items:[],count:0});
        return;
      }
      if(!late.length&&kind.indexOf('kam:')!==0)return;
      late.sort((x,y)=>(y.gmv||0)-(x.gmv||0));
      out.push({id:a.id,name:a.name||'—',count:late.length,items:late,
        baht:late.reduce((t,r)=>t+(r.gmv||0),0)});
    });
    return out.sort((x,y)=>y.baht-x.baht);
  }
  if(kind==='ahead')return (d.aheadTop||[]).slice();
  if(kind==='visit')return (d.visitList||[]).slice();
  const g=(d.overdueTop||[]).slice();
  if(_diListSort==='name')g.sort((x,y)=>String(x.name).localeCompare(String(y.name),'th'));
  else if(_diListSort==='late')g.sort((x,y)=>(y.worstLate||0)-(x.worstLate||0));
  else g.sort((x,y)=>y.baht-x.baht);
  return g;
}

function _diRenderList(kind,d){
  const done=_diDoneToday();
  const groups=_diListGroups(kind,d);
  let h='';

  if(kind==='overdue'&&!d.team){
    h+='<div class="di-tools">'
      +'<button data-sort="baht" class="'+(_diListSort==='baht'?'on':'')+'">เรียงตามเงิน</button>'
      +'<button data-sort="name" class="'+(_diListSort==='name'?'on':'')+'">เรียงตามร้าน</button>'
      +'<button data-sort="late" class="'+(_diListSort==='late'?'on':'')+'">ค้างนานสุด</button>'
      +'</div>'
      +'<p class="di-hint">แตะเพื่อเข้าหน้าร้าน · แตะค้างเพื่อทำเครื่องหมายว่าทักแล้ว</p>';
  }
  if(!groups.length){
    h+='<p class="di-hint" style="margin-top:24px">ไม่มีรายการในกลุ่มนี้ค่ะ</p>';
    return h;
  }

  groups.forEach((g,gi)=>{
    const items=g.items||[];
    const cnt=kind==='overdue'
      ? g.count+' รายการ · '+_diBaht(g.baht)
      : (kind==='ahead'
          ? ((g.baht>0?'+'+_diBaht(g.baht):'')+(items.length?' · ของใหม่ '+items.length:''))
          : (g.baht>0?'มีของค้าง '+_diBaht(g.baht):''));
    h+='<p class="di-grp di-c'+(gi%4)+'" data-shop="'+_diEsc(g.id)+'">'
      +'<i></i><b>'+_diEsc(g.name)+'</b><span>'+_diEsc(cnt)+'</span></p>';

    if(!items.length){
      h+='<button class="di-item" data-shop="'+_diEsc(g.id)+'">'
        +'<span class="di-item-m"><span class="di-item-s">เปิดหน้าร้านเพื่อดูรายละเอียด</span></span>'
        +'<svg class="di-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
        +'</button>';
      return;
    }

    items.forEach(it=>{
      const skuId=(it.id!==undefined&&it.id!==null)?it.id:it.name;
      const isDone=kind==='overdue'&&done.has(_diDoneKey(g.id,skuId));
      const sub=(kind==='overdue'||d.team)
        ? 'ปกติสั่งทุก '+it.avgInterval+' วัน · เลยรอบมา '+it.daysLate+' วัน'
        : 'เดือน '+(g.mo||'')+' · ไม่เคยซื้อมาก่อน';
      h+='<button class="di-item'+(isDone?' di-done':'')+'"'
        +' data-shop="'+_diEsc(g.id)+'" data-shopname="'+_diEsc(g.name)+'"'
        +' data-sku="'+_diEsc(skuId)+'" data-skuname="'+_diEsc(it.name)+'"'
        +' data-gmv="'+(it.gmv||0)+'"'+((kind==='overdue'&&!d.team)?' data-markable="1"':'')+'>'
        +'<span class="di-item-m">'
        +'<span class="di-item-n">'+_diEsc(it.name)+(it.isNew?'<span class="di-badge">ใหม่</span>':'')+'</span>'
        +'<span class="di-item-s">'+_diEsc(sub)+'</span>'
        +(isDone?'<span class="di-chip">✓ ทักแล้ววันนี้</span>':'')
        +'</span>'
        +'<span class="di-item-v">'+_diBaht(it.gmv||0)+'</span>'
        +'<svg class="di-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
        +'</button>';
    });
  });
  return h;
}

function _diPaintList(){
  const d=window._diLastData;
  const body=document.getElementById('di-list-body');
  if(!d||!body)return;
  const t=_diListTitle(_diListKind,d);
  const head=document.getElementById('di-list-title');
  const sub=document.getElementById('di-list-sub');
  if(head)head.textContent=t.t;
  if(sub)sub.textContent=t.s;
  body.innerHTML=_diRenderList(_diListKind,d);

  body.querySelectorAll('.di-tools button').forEach(b=>{
    b.addEventListener('click',()=>{ _diSetListSort(b.dataset.sort); _diPaintList(); });
  });
  body.querySelectorAll('.di-item').forEach(_diBindItem);
  body.querySelectorAll('.di-grp[data-shop]').forEach(p=>{
    p.style.cursor='pointer';
    p.addEventListener('click',()=>_diGoToAccount(p.dataset.shop));
  });
}

// แตะสั้น = เข้าหน้าร้าน · แตะค้าง = ทำเครื่องหมายว่าทักแล้ว
// เลือกแตะค้างแทนการปัด เพราะการปัดชนกับการเลื่อนหน้าจอ และหน้านี้ปัดขวาเพื่อย้อนกลับอยู่แล้ว
function _diBindItem(b){
  if(b._diBound)return;
  b._diBound=true;
  let timer=null;
  b.addEventListener('pointerdown',()=>{
    if(!b.dataset.markable)return;
    b._held=false;
    timer=setTimeout(()=>{ timer=null; b._held=true; _diItemHandled(b); },DI_HOLD_MS);
  });
  ['pointerup','pointerleave','pointercancel'].forEach(e=>{
    b.addEventListener(e,()=>{ if(timer){ clearTimeout(timer); timer=null; } });
  });
  b.addEventListener('click',()=>{
    if(b._held){ b._held=false; return; }   // เพิ่งแตะค้างไป อย่าเด้งเข้าร้าน
    _diGoToAccount(b.dataset.shop);
  });
  b.addEventListener('contextmenu',e=>{ if(b.dataset.markable)e.preventDefault(); });
}

function _diItemHandled(b){
  if(b.classList.contains('di-done'))return;
  const added=_diMarkHandled(b.dataset.shop,b.dataset.shopname,b.dataset.sku,
    b.dataset.skuname,parseFloat(b.dataset.gmv)||0);
  if(!added)return;
  b.classList.add('di-done');
  const m=b.querySelector('.di-item-m');
  if(m&&!b.querySelector('.di-chip')){
    const c=document.createElement('span');
    c.className='di-chip';
    c.textContent='✓ ทักแล้ววันนี้';
    m.appendChild(c);
  }
  if(navigator.vibrate)try{ navigator.vibrate(12); }catch(e){}
}

function _diOpenList(kind){
  _diListKind=kind;
  _diSetListSort('baht');
  const el=document.getElementById('di-list');
  if(!el)return;
  _diPaintList();
  const body=document.getElementById('di-list-body');
  if(body)body.scrollTop=0;
  el.classList.add('di-on');
}
function _diCloseList(){
  const el=document.getElementById('di-list');
  if(el)el.classList.remove('di-on');
}
function _diListOpen(){
  const el=document.getElementById('di-list');
  return !!(el&&el.classList.contains('di-on'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 7b. สรุปเดือนแบบสไลด์ — ครั้งแรกที่เปิดแอปในเดือนใหม่
// ═══════════════════════════════════════════════════════════════════════════
// ตรงนี้ทำเป็นสไลด์ (ต่างจากจอรายวันที่จงใจไม่ทำ) เพราะเป็นโมเมนต์พิธีการ
// ไม่ใช่ของที่ต้องกวาดตาให้จบใน 30 วินาที · ดูปีละ 12 ครั้ง ไม่ใช่ทุกเช้า
let _diWrapSlides=[], _diWrapAt=0;

function _diWrapSeen(){ return _diLoadState().wrapped===_diMonthKey(); }

function _diBuildWrapSlides(w){
  const up=w.diff>=0;
  const out=[];
  out.push({
    k:'สรุปเดือน '+w.label,
    h:'เดือน '+w.label+'<br>พอร์ตคุณทำได้',
    v:_diBaht(w.total),
    p:(w.pct===null?'':'<b>'+(up?'+':'−')+_diBaht(Math.abs(w.diff))+'</b> จากเดือน '+w.prevLabel
        +' ('+(up?'+':'')+w.pct+'%)<br>')+'จากทั้งหมด <b>'+w.shops+' ร้าน</b>ที่คุณดูแล'
  });
  if(w.grew){
    out.push({
      k:'ร้านที่โตขึ้น',
      h:'<b>'+w.grew+' ร้าน</b> ซื้อมากกว่า<br>เดือนก่อนหน้า',
      v:'',
      p:'อีก '+w.shrank+' ร้านซื้อน้อยลง',
      list:w.risers.map(r=>({n:r.name,v:'+'+_diBaht(r.diff)}))
    });
  }
  if(w.newSkus){
    out.push({
      k:'ของที่ไม่เคยซื้อ',
      h:'มีของใหม่เข้าพอร์ต<br><b>'+w.newSkus+' รายการ</b>',
      v:_diBaht(w.newBaht),
      p:w.newTop.length?('ก้อนใหญ่ที่สุดคือ <b>'+_diEsc(w.newTop[0].sku)+'</b><br>ที่ '
        +_diEsc(w.newTop[0].name)):''
    });
  }
  if(w.markedShops){
    out.push({
      k:'สิ่งที่คุณลงมือทำ',
      h:'เดือนที่แล้วคุณทักไป<br><b>'+w.markedShops+' ร้าน</b>',
      v:w.backShops?w.backShops+' ร้าน':'',
      p:w.backShops?'กลับมาสั่งแล้วค่ะ':'ยังไม่มีร้านไหนกลับมาสั่ง แต่ยังไม่สายค่ะ'
    });
  }
  out.push({
    k:'เดือนใหม่',
    h:'เริ่มเดือนใหม่กันค่ะ',
    v:'',
    p:'Olive จะคอยดูพอร์ต '+w.shops+' ร้านของคุณให้ทุกเช้าเหมือนเดิมนะคะ',
    cta:'ดูของวันนี้'
  });
  return out;
}

function _diPaintWrap(){
  const host=document.getElementById('di-wrap');
  if(!host||!_diWrapSlides.length)return;
  const sl=_diWrapSlides[_diWrapAt];
  host.querySelector('.di-bars').innerHTML=
    _diWrapSlides.map((x,i)=>'<i class="'+(i<=_diWrapAt?'on':'')+'"></i>').join('');
  const body=host.querySelector('.di-slide');
  body.innerHTML=
     '<p class="di-wk">'+_diEsc(sl.k)+'</p>'
    +'<p class="di-wh">'+sl.h+'</p>'
    +(sl.v?'<p class="di-wv">'+_diEsc(sl.v)+'</p>':'')
    +(sl.p?'<p class="di-wp">'+sl.p+'</p>':'')
    +(sl.list?('<div class="di-wlist">'+sl.list.map(r=>
        '<span class="di-wrow"><span>'+_diEsc(r.n)+'</span><b>'+_diEsc(r.v)+'</b></span>').join('')+'</div>'):'')
    +(sl.cta?'<button class="di-wgo" id="di-wrap-go">'+_diEsc(sl.cta)+'</button>':'');
  const go=document.getElementById('di-wrap-go');
  if(go)go.addEventListener('click',function(ev){ ev.stopPropagation(); _diCloseWrap(); });
}

function _diWrapStep(dir){
  const n=_diWrapAt+dir;
  if(n<0)return;
  if(n>=_diWrapSlides.length){ _diCloseWrap(); return; }
  _diWrapAt=n;
  _diPaintWrap();
}

function _diOpenWrap(w){
  const host=document.getElementById('di-wrap');
  if(!host)return;
  _diWrapSlides=_diBuildWrapSlides(w);
  _diWrapAt=0;
  _diPaintWrap();
  host.classList.add('di-on');
  _diSaveState({wrapped:_diMonthKey()});
}
function _diCloseWrap(){
  const host=document.getElementById('di-wrap');
  if(host)host.classList.remove('di-on');
}
function _diWrapOpen(){
  const host=document.getElementById('di-wrap');
  return !!(host&&host.classList.contains('di-on'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. เปิด / ปิด
// ═══════════════════════════════════════════════════════════════════════════
let _diOpening=false;

function _diBindBody(d){
  const cta=document.getElementById('di-cta');
  if(cta&&d.big&&d.big.shopId)cta.addEventListener('click',()=>_diGoToAccount(d.big.shopId));
  const bind=(id,kind)=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener('click',()=>_diOpenList(kind));
  };
  bind('di-row-overdue','overdue');
  bind('di-row-ahead','ahead');
  bind('di-row-visit','visit');
  // แตะชื่อคน = เปิดรายการร้านของคนนั้น
  document.querySelectorAll('#di-body .di-person').forEach(b=>{
    b.addEventListener('click',()=>_diOpenList('kam:'+b.dataset.kam));
  });
}

// ข้อมูลชั้น 3 มาทีหลัง ⇒ วาดเนื้อจอใหม่ทั้งก้อนแทนที่จะปล่อยให้ค้างเลขไม่ครบ
function _diRefreshBody(){
  const body=document.getElementById('di-body');
  if(!body)return false;
  const team=_diIsTeamMode();
  let d=null;
  try{ d=team?buildTeamInsight():buildDailyInsight(); }catch(e){ return false; }
  if(!d)return false;
  window._diLastData=d;
  body.innerHTML=team?_diRenderTeamBody(d):_diRenderBody(d);
  _diBindBody(d);
  _diFillVisitRow();
  if(!d.partial)_diMarkSeen();
  return true;
}

function openDailyInsight(){
  if(_diOpening)return;
  if(document.getElementById('di-sheet'))return;   // เปิดอยู่แล้ว
  // ด่านสิทธิ์อยู่ตรงนี้ด้วย ไม่ใช่แค่ที่ทางเข้า — กันโค้ดในอนาคตเรียกตรงแล้วหลุด role
  if(!_diEligible())return;
  const team=_diIsTeamMode();
  let d=null;
  try{ d=team?buildTeamInsight():buildDailyInsight(); }
  catch(e){ console.warn('build daily insight failed',e); return; }
  if(!d)return;
  window._diLastData=d;

  _diOpening=true;
  _diInjectStyles();

  const sheet=document.createElement('div');
  sheet.id='di-sheet';
  sheet.setAttribute('role','dialog');
  sheet.setAttribute('aria-modal','true');
  sheet.setAttribute('aria-label','Olive สรุปให้');
  sheet.innerHTML=
     '<div class="di-grab"><i></i></div>'
    +'<button class="di-close" id="di-close" aria-label="ปิด">ปิด</button>'
    +'<div id="di-body">'+(team?_diRenderTeamBody(d):_diRenderBody(d))+'</div>'
    +'<div id="di-list">'
      +'<div class="di-top">'
        +'<button class="di-back" id="di-list-back" aria-label="ย้อนกลับ">'
        +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
        +'</button>'
        +'<span class="di-top-t"><b id="di-list-title"></b><span id="di-list-sub"></span></span>'
      +'</div>'
      +'<div id="di-list-body"></div>'
    +'</div>'
    +'<div id="di-wrap">'
      +'<div class="di-bars"></div>'
      +'<button class="di-wclose" id="di-wrap-close" type="button">ข้าม</button>'
      +'<div class="di-slide"></div>'
      +'<p class="di-wtap">แตะขวาเพื่อไปต่อ · แตะซ้ายเพื่อย้อน</p>'
    +'</div>'
    +'<div id="di-spark"></div>'
    +'<div id="di-boot"><span class="di-av">O</span><p>'
      +(team?('กำลังไล่ดูทีม '+d.peopleCount+' คน '+d.shops+' ร้าน...')
            :('กำลังไล่ดู '+d.accountCount+' ร้านของคุณ'+_diEsc(_diMyName())+'...'))
    +'</p></div>';
  document.body.appendChild(sheet);

  requestAnimationFrame(()=>sheet.classList.add('di-on'));

  const reveal=()=>{
    const boot=document.getElementById('di-boot');
    if(boot)boot.classList.add('di-gone');
    sheet.classList.add('di-in');
    setTimeout(()=>{ const b=document.getElementById('di-boot'); if(b)b.remove(); },600);
    _diFillVisitRow();
    // จอ TL: _buildKamGroups ใช้ target ในการคิด pace — target โหลดแบบ async
    // ถ้ายังไม่มาตอนวาด denominator จะกลายเป็น baseline ค้างถาวร ⇒ โหลดแล้ววาดใหม่
    if(team&&typeof _tgtLoaded!=='undefined'&&!_tgtLoaded
       &&typeof loadTargets==='function'&&typeof _tgtCurrentQuarter==='function'){
      try{ loadTargets(_tgtCurrentQuarter()).then(()=>{ _diRefreshBody(); }).catch(()=>{}); }catch(e){}
    }
    // สรุปเดือนขึ้นก่อนจอรายวัน แล้วปิดแล้วเจอจอรายวันข้างล่าง — เดือนละครั้ง
    let wrapped=false;
    if(!_diWrapSeen()){
      try{
        const w=_diMonthlyWrap((typeof getPortviewAccounts==='function'?getPortviewAccounts():[])||[]);
        if(w&&w.prevTotal>0){ _diOpenWrap(w); wrapped=true; }
      }catch(e){ console.warn('monthly wrap failed',e); }
    }
    if(!wrapped&&d.big&&d.big.celebrate)setTimeout(()=>_diCelebrate(d.big.celebrate),260);
    _diOpening=false;
  };
  setTimeout(reveal,_diReduceMotion()?60:DI_BOOT_MS);

  // ── ปุ่ม ──
  const close=document.getElementById('di-close');
  if(close)close.addEventListener('click',()=>closeDailyInsight());
  const back=document.getElementById('di-list-back');
  if(back)back.addEventListener('click',()=>_diCloseList());
  const wclose=document.getElementById('di-wrap-close');
  if(wclose)wclose.addEventListener('click',ev=>{ ev.stopPropagation(); _diCloseWrap(); });
  const wrap=document.getElementById('di-wrap');
  if(wrap)wrap.addEventListener('click',ev=>{
    const r=wrap.getBoundingClientRect();
    _diWrapStep(ev.clientX-r.left < r.width*0.32 ? -1 : 1);
  });
  _diBindBody(d);

  // ── ปัดลงเพื่อปิด — ทำงานเมื่อเลื่อนอยู่บนสุดและไม่ได้เปิดหน้ารายการอยู่ ──
  const body=document.getElementById('di-body');
  if(body){
    let sy=0,tracking=false;
    body.addEventListener('touchstart',e=>{
      sy=e.touches[0].clientY; tracking=(body.scrollTop<=2);
    },{passive:true});
    body.addEventListener('touchmove',e=>{
      if(!tracking||_diListOpen()||_diWrapOpen())return;
      if(e.touches[0].clientY-sy>70){ tracking=false; closeDailyInsight(); }
    },{passive:true});
  }
  // ── ปัดขวาในหน้ารายการ = ย้อนกลับ ──
  const lb=document.getElementById('di-list-body');
  if(lb){
    let sx=0,sy2=0,fired=false;
    lb.addEventListener('touchstart',e=>{ sx=e.touches[0].clientX; sy2=e.touches[0].clientY; fired=false; },{passive:true});
    lb.addEventListener('touchmove',e=>{
      if(fired)return;
      const dx=e.touches[0].clientX-sx, dy=Math.abs(e.touches[0].clientY-sy2);
      if(dx>70&&dy<40){ fired=true; _diCloseList(); }
    },{passive:true});
  }
  document.addEventListener('keydown',_diEscKey);
  _diToggleLoadPill(true);

  // ข้อมูลยังไม่ครบ = ยังไม่นับว่าอ่านแล้ว จะได้เด้งใหม่ให้ครบเมื่อข้อมูลมา
  if(!d.partial)_diMarkSeen();
  else _diSyncNavButton();
}

// #data-load-pill ของแอปอยู่ z-index 9999 = สูงกว่า sheet นี้ (9400)
// เราเปิดจอตอน tier 3 ซึ่งช้ากว่าเดิม ⇒ แถบโหลดมีสิทธิ์ยังค้างอยู่แล้วมาทับเนื้อจอ
// ขึ้นไปสูงกว่านี้ไม่ได้ เพราะ 9999 เป็นของ login overlay กับ Echo sheet ด้วย
// ⇒ ซ่อนไว้ระหว่างจอนี้เปิด แล้วคืนค่าเดิมตอนปิด
function _diToggleLoadPill(hide){
  const el=document.getElementById('data-load-pill');
  if(!el)return;
  if(hide){
    if(el._diPrev===undefined)el._diPrev=el.style.display;
    el.style.display='none';
  }else if(el._diPrev!==undefined){
    el.style.display=el._diPrev;
    delete el._diPrev;
  }
}

function _diEscKey(e){
  if(e.key!=='Escape')return;
  if(_diWrapOpen())_diCloseWrap();
  else if(_diListOpen())_diCloseList();
  else closeDailyInsight();
}

function closeDailyInsight(){
  const sheet=document.getElementById('di-sheet');
  document.removeEventListener('keydown',_diEscKey);
  _diToggleLoadPill(false);
  _diOpening=false;
  if(!sheet)return;
  sheet.classList.remove('di-on');
  setTimeout(()=>{ if(sheet&&sheet.parentNode)sheet.parentNode.removeChild(sheet); },360);
  _diSyncNavButton();
}

function _diGoToAccount(accountId){
  closeDailyInsight();
  // รอให้ sheet ปิดสนิทก่อนค่อยพาไป ไม่งั้นจะเห็นสองจอซ้อนกันตอนเปลี่ยน
  setTimeout(()=>{
    try{
      if(accountId&&typeof portviewSelectAccount==='function')portviewSelectAccount(accountId);
    }catch(e){ console.warn('di: open account failed',e); }
  },220);
}

// ═══════════════════════════════════════════════════════════════════════════
// 8b. โผล่ตอนเช็คอิน Echo — ข้อมูลชุดเดิม แค่มาโผล่ตอนที่ยืนอยู่หน้าร้านจริง
// ═══════════════════════════════════════════════════════════════════════════
// อ่านอย่างเดียว ไม่มีปุ่ม ไม่แตะค้าง — จอ Echo มีงานของมันอยู่แล้ว อย่าไปแย่ง
// ไม่มีของค้าง = ไม่โชว์การ์ด · ข้อมูลยังไม่มา = ไม่โชว์เช่นกัน ไม่โชว์ศูนย์
function renderCheckinOverdue(accountId){
  try{
    const host=document.getElementById('ci-visit-hero');
    const old=document.getElementById('di-checkin-card');
    if(old)old.remove();
    if(!host||!accountId)return false;
    if(!_diDataComplete())return false;

    let rows=null;
    try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(accountId):null; }catch(e){ rows=null; }
    if(!rows)return false;
    const late=rows.filter(r=>r.type==='gone'||r.type==='near');
    if(!late.length)return false;
    late.sort((x,y)=>(y.gmv||0)-(x.gmv||0));
    const baht=late.reduce((t,r)=>t+(r.gmv||0),0);

    if(!document.getElementById('di-checkin-css')){
      const st=document.createElement('style');
      st.id='di-checkin-css';
      st.textContent=
        '#di-checkin-card{margin-bottom:10px;border-radius:14px;padding:12px 14px;'
       +'background:rgba(255,102,0,.07);border:0.5px solid rgba(255,102,0,.24);'
       +"font-family:'Noto Sans Thai',-apple-system,sans-serif}"
       +'#di-checkin-card .t{font-size:13.5px;font-weight:700;color:#B34700;line-height:1.45}'
       +'#di-checkin-card .l{font-size:12.5px;color:#8A6A55;margin-top:5px;line-height:1.55}';
      document.head.appendChild(st);
    }

    const card=document.createElement('div');
    card.id='di-checkin-card';
    card.innerHTML='<div class="t">ร้านนี้มีของถึงรอบสั่งแล้ว '+late.length+' รายการ · '+_diBaht(baht)+'</div>'
      +'<div class="l">'+late.slice(0,3).map(r=>_diEsc(r.name)).join(' · ')
      +(late.length>3?' และอีก '+(late.length-3):'')+'</div>';
    host.insertBefore(card,host.firstChild);
    return true;
  }catch(e){ return false; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. ปุ่มใน nav — ยึดช่อง Profile ตอนอยู่หน้า portview
// ═══════════════════════════════════════════════════════════════════════════
// ช่องนี้ถูกปิดตายอยู่แล้วทุกครั้งที่เข้า portview (05_kam_view.js) = พื้นที่ตายพอดี
// เลือกวิธีนี้เพราะไม่ต้องรื้อ NAV_CONFIG ของทุก role และถอยกลับง่าย
const DI_NAV_ICON='<svg fill="none" height="22" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="22"><path d="M12 3l1.9 4.7 4.7 1.9-4.7 1.9L12 16.2l-1.9-4.7L5.4 9.6l4.7-1.9L12 3z"></path><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"></path></svg>';

function _diSyncNavButton(screenName){
  const btn=document.getElementById('nav-restaurant');
  if(!btn)return;
  const wrap=btn.querySelector('.nwrap');
  const lbl=document.getElementById('nav-restaurant-label');
  if(!wrap||!lbl)return;

  const name=screenName||(document.querySelector('.scr.on')||{}).id||'';
  const eligible=/portview/.test(name)&&_diEligible();

  if(eligible){
    if(!btn._diOrig){ btn._diOrig={icon:wrap.innerHTML,label:lbl.textContent}; }
    if(!btn._diHooked){
      btn._diHooked=true;
      // capture: ต้องกัน onclick เดิม (toggleRestaurantSheet) ไม่ให้ทำงานตอนอยู่โหมดนี้
      btn.addEventListener('click',ev=>{
        if(!btn.classList.contains('di-live'))return;
        ev.preventDefault(); ev.stopPropagation();
        if(document.getElementById('di-sheet'))closeDailyInsight();
        else openDailyInsight();
      },true);
    }
    wrap.innerHTML=DI_NAV_ICON+(_diSeenToday()?'':'<span class="di-pip"></span>');
    lbl.textContent='สรุปให้';
    btn.classList.remove('nav-disabled');
    btn.classList.add('di-live');
    btn.classList.toggle('di-unread',!_diSeenToday());
  }else if(btn._diOrig){
    wrap.innerHTML=btn._diOrig.icon;
    lbl.textContent=btn._diOrig.label;
    btn.classList.remove('di-live','di-unread');
  }
}

function _diEligible(){
  const p=(typeof currentUserProfile!=='undefined'&&currentUserProfile)||null;
  if(!p||DI_ROLES.indexOf(p.role)<0)return false;
  if(typeof getPortviewAccounts!=='function')return false;
  const n=(getPortviewAccounts()||[]).length;
  return n>0&&n<=DI_MAX_ACCOUNTS;
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. ตัวกระตุ้นตอนบูต
// ═══════════════════════════════════════════════════════════════════════════
// ต้องรอ tier 1 จริงๆ — ถ้าเด้งก่อนข้อมูลมา ตัวเลขจะเป็นศูนย์ทั้งจอ
// และต้องไม่ชนกับ splash / จอล็อกอิน / sheet อื่นที่เปิดค้างอยู่
function _diBootBlocked(){
  if(window._senseSplashActive)return true;
  if(_diSeenToday())return true;
  if(document.body.classList.contains('restaurant-sheet'))return true;
  const fs=document.getElementById('ci-fullsheet');
  if(fs&&getComputedStyle(fs).display!=='none')return true;
  const lo=document.getElementById('login-overlay');
  if(lo&&getComputedStyle(lo).display!=='none')return true;
  // splash อยู่ z-index 10000 = สูงกว่า sheet นี้ ⇒ ถ้ามันยังไม่หายจริง
  // เราจะเปิดจอไปนอนอยู่ข้างหลังโดยไม่มีใครเห็น (ธง _senseSplashActive ปิดก่อน element หาย)
  const sp=document.getElementById('sense-splash');
  if(sp&&getComputedStyle(sp).display!=='none')return true;
  return false;
}

function _diMaybeOpenOnBoot(){
  try{
    if(_diBootBlocked()){ _diSyncNavButton(); return; }
    if(!_diEligible())return;
    openDailyInsight();
  }catch(e){ console.warn('daily insight boot failed',e); }
}

(function _diInit(){
  let opened=false;
  const openOnce=()=>{
    if(opened)return;
    // เปิดไปแล้วแบบข้อมูลไม่ครบ → วาดใหม่ทับ ไม่ต้องเปิดซ้ำ
    if(document.getElementById('di-sheet')){
      if(_diDataComplete()&&(window._diLastData||{}).partial){ _diRefreshBody(); opened=true; }
      return;
    }
    if(_diDataComplete())opened=true;
    _diMaybeOpenOnBoot();
  };
  const arm=()=>{
    if(!window.DataRegistry||typeof window.DataRegistry.onReady!=='function'){
      setTimeout(arm,400);
      return;
    }
    // ต้องรอชั้น 3 — ชั้น 1 มีแค่ portview/history ซึ่งไม่พอกับสิ่งที่จอนี้พูด
    window.DataRegistry.onReady(3,()=>{ setTimeout(openOnce,700); });
    // เพดานเวลา: ชั้น 3 อาจไม่มาเลย (เน็ตล่ม/ไฟล์พัง) — ยอมเปิดเท่าที่มี
    // แต่ buildDailyInsight จะติดธง partial ให้เอง แล้วจะไม่ปั๊มว่าอ่านแล้ว
    window.DataRegistry.onReady(1,()=>{ setTimeout(openOnce,DI_TIER_WAIT_MS); });
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);
  else arm();
})();
