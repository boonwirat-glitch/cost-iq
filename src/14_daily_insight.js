// SECTION:DAILY_INSIGHT
// ═══════════════════════════════════════════════════════════════════════════
// "Olive สรุปให้" — หน้าสรุปพอร์ตรายวันของ KAM (เฟส 1)
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
//     (ยอดเยี่ยมรายไตรมาสเป็นส่วนเสริมที่เติมทีหลัง ไม่มีก็ซ่อนแถวนั้นไปเฉยๆ)
//   · z-index 9300-9500 — เหนือแถบล่าง (170) และปุ่ม Olive (199)
//     แต่ใต้ Echo sheet (9999) และ toast (10500)
//
// เฟส 1 ทำแค่: sheet รายวัน · ประตูวันละครั้ง · ปัดปิด · ปุ่มใน nav
// ยังไม่มี: หน้าเต็ม · แตะค้างว่าทักแล้ว · การ์ด "ได้ผลแล้ว" · confetti · รอบสัปดาห์/เดือน
// ═══════════════════════════════════════════════════════════════════════════

// ── ค่าคงที่ที่ปรับได้ ──────────────────────────────────────────────────────
const DI_STORE_KEY   = 'sense_daily_v1';
const DI_GOOD_MIN    = 5000;   // ของใหม่ต้องมีมูลค่าอย่างน้อยเท่านี้ถึงจะขึ้นเป็นพาดหัวข่าวดี
const DI_MAX_ACCOUNTS= 400;    // พอร์ตใหญ่กว่านี้ (admin) ยังไม่รองรับในเฟส 1 — ไม่เด้ง
const DI_BOOT_MS     = 1100;   // บรรทัด "กำลังไล่ดู…" แสดงนานแค่ไหนก่อนเผยเนื้อหา
const DI_ROLES       = ['rep','tl','ad','pm','ad_tl','admin'];

// ── สถานะที่จำในเครื่อง ────────────────────────────────────────────────────
// จงใจไม่เก็บฝั่ง Supabase: ถ้าเก็บที่นั่น พอโดน 402 จอนี้จะพังพร้อมกับสิ่งที่มันควรทำงานแทน
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. รวบรวมสัญญาณ — เรียกของเดิมล้วนๆ ไม่มีสูตรใหม่
// ═══════════════════════════════════════════════════════════════════════════
function buildDailyInsight(){
  if(typeof getPortviewAccounts!=='function')return null;
  const accounts=getPortviewAccounts()||[];
  if(!accounts.length||accounts.length>DI_MAX_ACCOUNTS)return null;

  let overdueItems=0, overdueShops=0, overdueBaht=0;
  let aheadShops=0, aheadBaht=0;
  let newSkuBaht=0;
  const overdueTop=[];   // ร้านที่มีของเลยรอบ เรียงตามเงิน
  const newFinds=[];     // ร้านที่เริ่มซื้อของที่ไม่เคยซื้อ

  accounts.forEach(a=>{
    if(!a||!a.id)return;

    // ── ถึงรอบสั่งแล้วแต่ยังไม่สั่ง (นิยามของ Sense: gone + near) ──
    let rows=null;
    try{ rows=(typeof computeChurnRowsForAccount==='function')?computeChurnRowsForAccount(a.id):null; }catch(e){ rows=null; }
    if(rows){
      const late=rows.filter(r=>r.type==='gone'||r.type==='near');
      if(late.length){
        late.sort((x,y)=>(y.gmv||0)-(x.gmv||0));
        const baht=late.reduce((t,r)=>t+(r.gmv||0),0);
        overdueItems+=late.length; overdueShops++; overdueBaht+=baht;
        overdueTop.push({id:a.id,name:a.name||'—',count:late.length,baht,top:late[0]});
      }
    }

    // ── ซื้อเร็วกว่าเดือนที่แล้ว (เทียบวันต่อวัน ไม่ใช่เทียบยอดเต็มเดือน) ──
    // paceSignal.expected = อัตราต่อวันของเดือนที่แล้ว × จำนวนวันที่ผ่านไปของเดือนนี้
    const ps=a.paceSignal||{};
    const expected=ps.expected||0;
    if(expected>0&&(a.gmvToDate||0)>expected){
      aheadShops++; aheadBaht+=((a.gmvToDate||0)-expected);
    }

    // ── ของที่ร้านไม่เคยซื้อมาก่อน (นิยามของ Sense: newSkus) ──
    let sm=null;
    try{ sm=(typeof computeSkuMovementForAccount==='function')?computeSkuMovementForAccount(a.id):null; }catch(e){ sm=null; }
    if(sm&&sm.newSkus&&sm.newSkus.length){
      const v=sm.newSkus.reduce((t,s)=>t+(s.gmv||0),0);
      newSkuBaht+=v;
      newFinds.push({id:a.id,name:a.name||'—',sku:sm.newSkus[0].name,gmv:sm.newSkus[0].gmv||0,total:v,mo:sm.recentMo});
    }
  });

  overdueTop.sort((x,y)=>y.baht-x.baht);
  newFinds.sort((x,y)=>y.gmv-x.gmv);

  // ── เลือก "เรื่องใหญ่ของวันนี้" — ข่าวดีมาก่อนเสมอ ──
  // เรื่องที่ต้องรีบไม่ได้ถูกซ่อน มันอยู่ในแถวสรุปข้างล่างครบทุกวัน
  let big=null;
  if(newFinds.length&&newFinds[0].gmv>=DI_GOOD_MIN){
    const f=newFinds[0];
    big={kind:'new',shopId:f.id,
      tag:'Olive เจอมาให้',
      head:_diEsc(f.name)+'<br>เริ่มซื้อของที่ไม่เคยซื้อ',
      value:f.gmv,
      body:'เดือน '+_diEsc(f.mo||'')+' '+_diEsc(f.name)+' เริ่มสั่ง <b>'+_diEsc(f.sku)+'</b> '
          +'ซึ่งไม่เคยซื้อกับเรามาก่อนเลย',
      cta:'เปิดดู '+f.name};
  } else if(aheadShops>0&&aheadBaht>=DI_GOOD_MIN){
    big={kind:'ahead',shopId:null,
      tag:'Olive เจอมาให้',
      head:'เดือนนี้พอร์ตคุณ<br>ซื้อเร็วกว่าเดือนที่แล้ว',
      value:aheadBaht,
      body:'<b>'+aheadShops+' ร้าน</b> จากทั้งหมด '+accounts.length+' ร้าน ซื้อมากกว่าจังหวะของเดือนที่แล้ว '
          +'เมื่อเทียบถึงวันเดียวกัน',
      cta:null};
  } else if(overdueTop.length){
    const s=overdueTop[0];
    big={kind:'overdue',shopId:s.id,
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
    overdueTop, newFinds,
    big,
    quiet:!big&&overdueItems===0
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. การไปเยี่ยมร้านรายไตรมาส — ส่วนเสริม เติมทีหลัง ไม่มีก็ไม่เป็นไร
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
    if(!notVisited.length){
      el.remove();
      return;
    }
    // ในนั้นมีกี่ร้านที่มีของถึงรอบแล้วด้วย — ทำให้แถวนี้บอกลำดับความสำคัญได้ ไม่ใช่แค่จำนวน
    const ins=new Set((window._diLastData&&window._diLastData.overdueTop||[]).map(s=>String(s.id)));
    const both=notVisited.filter(a=>ins.has(String(a.id))).length;
    const qLabel='Q'+(Math.floor(now.getMonth()/3)+1);
    el.querySelector('.di-row-sub').textContent=
      notVisited.length+' ร้าน'+(both?' · ใน '+both+' ร้านมีของที่ถึงรอบสั่งแล้วด้วย':'');
    el.querySelector('.di-row-title').textContent='ยังไม่ได้ไปเยี่ยมใน '+qLabel;
    el.style.display='';
  }catch(e){ /* เงียบไว้ — แถวนี้เป็นของแถม ไม่ใช่เนื้อหาหลัก */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. หน้าตา — ระบุสีตรงๆ ทุกจุด
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
#di-sheet .di-close{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;z-index:2;border:none;cursor:pointer;
  background:#F4F8F6;color:#48696A;font-family:inherit;font-size:13px;font-weight:600;
  border-radius:999px;padding:7px 14px}
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

#di-boot{position:absolute;inset:0;z-index:3;background:#FFFFFF;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 40px;text-align:center}
#di-boot.di-gone{opacity:0;pointer-events:none;transition:opacity .45s ease}
#di-boot .di-av{width:46px;height:46px;font-size:18px;animation:di-pulse 1.6s ease-in-out infinite}
#di-boot p{font-size:15px;color:#48696A;line-height:1.6}
@keyframes di-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.07);opacity:.86}}

/* ปุ่มใน nav — ขยับเฉพาะตอนยังไม่อ่าน อนิเมชันเป็นข้อมูล ไม่ใช่ของประดับ */
#nav-restaurant.di-live{color:#00CE7C}
#nav-restaurant.di-live .di-pip{position:absolute;top:2px;right:calc(50% - 16px);width:7px;height:7px;
  border-radius:50%;background:#FF6600}
#nav-restaurant.di-live.di-unread svg{animation:di-breathe 3.4s ease-in-out infinite}
@keyframes di-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}

@media (prefers-reduced-motion:reduce){
  #di-sheet,#di-sheet.di-in .di-rise,#di-boot{transition:none}
  #di-sheet .di-rise{opacity:1;transform:none}
  #di-boot .di-av,#nav-restaurant.di-live.di-unread svg{animation:none}
}
`;
  document.head.appendChild(st);
}

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

  h+='<div class="di-find di-rise di-d2">';
  if(d.big){
    h+='<span class="di-tag">'+_diEsc(d.big.tag)+'</span>';
    h+='<p class="di-head">'+d.big.head+'</p>';
    h+='<p class="di-value" id="di-value">'+_diBaht(d.big.value)+'</p>';
    h+='<p class="di-p">'+d.big.body+'</p>';
    if(d.big.cta&&d.big.shopId){
      h+='<button class="di-cta" id="di-cta">'+_diEsc(d.big.cta)+'</button>';
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
      d.overdueItems+' รายการ ใน '+d.overdueShops+' ร้าน',
      d.overdueItems?_diBaht(d.overdueBaht):'', 'di-neg', d.overdueItems===0);
  h+=_diRowHtml('di-row-ahead','ซื้อเพิ่มขึ้น',
      d.aheadShops+' ร้าน · เทียบวันต่อวันกับเดือนที่แล้ว'
        +(d.newSkuBaht?' · ในนั้นเป็นของที่ไม่เคยซื้อ '+_diBaht(d.newSkuBaht):''),
      d.aheadShops?'+'+_diBaht(d.aheadBaht):'', 'di-pos', d.aheadShops===0);
  // แถวการไปเยี่ยม: ซ่อนไว้ก่อน แล้วให้ _diFillVisitRow เปิดถ้า Supabase ตอบ
  h+=_diRowHtml('di-row-visit','ยังไม่ได้ไปเยี่ยมไตรมาสนี้','', '', '', true);
  h+='</div>';

  h+='<div class="di-olive di-rise di-d4"><span class="di-av">O</span><p>'
    +_diOliveLine(d)+'</p></div>';

  h+='<p class="di-method di-rise di-d4">'
    +'"ถึงรอบแต่ยังไม่สั่ง" ดูจากรอบสั่งจริงของเดือนนี้ · "ซื้อเพิ่มขึ้น" เทียบถึงวันเดียวกันของเดือนที่แล้ว · '
    +'"ของที่ไม่เคยซื้อ" เทียบเดือนที่ปิดแล้วสองเดือน</p>';
  return h;
}

// เสียง Olive — ข้อความเขียนตายตัวจากตัวเลขจริง ไม่ได้เรียก AI
function _diOliveLine(d){
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
// 4. เปิด / ปิด
// ═══════════════════════════════════════════════════════════════════════════
let _diOpening=false;

function openDailyInsight(){
  if(_diOpening)return;
  if(document.getElementById('di-sheet'))return;   // เปิดอยู่แล้ว
  // ด่านสิทธิ์อยู่ตรงนี้ด้วย ไม่ใช่แค่ที่ทางเข้า — กันโค้ดในอนาคตเรียกตรงแล้วหลุด role
  if(!_diEligible())return;
  let d=null;
  try{ d=buildDailyInsight(); }catch(e){ console.warn('buildDailyInsight failed',e); return; }
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
    +'<div id="di-body">'+_diRenderBody(d)+'</div>'
    +'<div id="di-boot"><span class="di-av">O</span><p>กำลังไล่ดู '+d.accountCount+' ร้านของคุณ'+_diEsc(_diMyName())+'...</p></div>';
  document.body.appendChild(sheet);

  // เปิดขึ้นมา
  requestAnimationFrame(()=>sheet.classList.add('di-on'));

  const reveal=()=>{
    const boot=document.getElementById('di-boot');
    if(boot)boot.classList.add('di-gone');
    sheet.classList.add('di-in');
    setTimeout(()=>{ const b=document.getElementById('di-boot'); if(b)b.remove(); },600);
    _diFillVisitRow();
    _diOpening=false;
  };
  setTimeout(reveal,_diReduceMotion()?60:DI_BOOT_MS);

  // ── ปุ่ม ──
  const close=document.getElementById('di-close');
  if(close)close.addEventListener('click',()=>closeDailyInsight());
  const cta=document.getElementById('di-cta');
  if(cta&&d.big&&d.big.shopId)cta.addEventListener('click',()=>_diGoToAccount(d.big.shopId));
  const ovr=document.getElementById('di-row-overdue');
  if(ovr)ovr.addEventListener('click',()=>{
    // เฟส 1 ยังไม่มีหน้าเต็ม — พาไปร้านที่มีของค้างมากที่สุดก่อน
    if(d.overdueTop.length)_diGoToAccount(d.overdueTop[0].id);
  });
  const ahd=document.getElementById('di-row-ahead');
  if(ahd)ahd.addEventListener('click',()=>{
    if(d.newFinds.length)_diGoToAccount(d.newFinds[0].id);
    else closeDailyInsight();
  });

  // ── ปัดลงเพื่อปิด — ทำงานเมื่อเลื่อนอยู่บนสุดเท่านั้น ──
  const body=document.getElementById('di-body');
  if(body){
    let sy=0,tracking=false;
    body.addEventListener('touchstart',e=>{
      sy=e.touches[0].clientY; tracking=(body.scrollTop<=2);
    },{passive:true});
    body.addEventListener('touchmove',e=>{
      if(!tracking)return;
      const dy=e.touches[0].clientY-sy;
      if(dy>70){ tracking=false; closeDailyInsight(); }
    },{passive:true});
  }
  document.addEventListener('keydown',_diEscKey);

  _diMarkSeen();
}

function _diEscKey(e){ if(e.key==='Escape')closeDailyInsight(); }

function closeDailyInsight(){
  const sheet=document.getElementById('di-sheet');
  document.removeEventListener('keydown',_diEscKey);
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
// 5. ปุ่มใน nav — ยึดช่อง Profile ตอนอยู่หน้า portview
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
  const onPortview=/portview/.test(name);
  const eligible=onPortview&&_diEligible();

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
// 6. ตัวกระตุ้นตอนบูต
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
    if(!_diEligible()){ return; }
    openDailyInsight();
  }catch(e){ console.warn('daily insight boot failed',e); }
}

(function _diInit(){
  const arm=()=>{
    if(!window.DataRegistry||typeof window.DataRegistry.onReady!=='function'){
      setTimeout(arm,400);
      return;
    }
    window.DataRegistry.onReady(1,()=>{
      // หน่วงอีกนิดให้ splash ปิดและ portview วาดเสร็จก่อน แล้วค่อยเด้ง
      setTimeout(_diMaybeOpenOnBoot,700);
    });
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);
  else arm();
})();
