// Phase 2 extraction target: Olive chat FAB open/close + draggable position behavior.
// Keep fs_aifab_pos_v1 storage key to preserve user muscle memory.

function toggleChat(){if(window.__aifabDragSuppress){window.__aifabDragSuppress=false;return;}chatOpen?closeChat():openChat();}
function openChat(){
  chatOpen=true;
  document.getElementById('aipanel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('aifab').classList.add('open');
  // F2: Update suggestions dynamically
  const suggs=buildChatSuggestions();
  const suggEl=document.getElementById('aisugg');
  if(suggEl){
    suggEl.style.display='flex';
    suggEl.innerHTML=suggs.map(s=>`<button class="sgbtn" onclick="askQ(${JSON.stringify(s.q)})">${s.label}</button>`).join('');
  }
  // F3: Update subtitle based on mode (header name is always Olive)
  const aist=document.getElementById('aist-sub')||document.querySelector('.aist');
  if(aist)aist.textContent=isKAM?'● ผู้ช่วย KAM · วิเคราะห์บัญชีลูกค้า':'● ผู้ช่วยวิเคราะห์ต้นทุนร้านคุณ';
  // F4: Update Olive intro message with current account context
  const introMsg=document.getElementById('chat-intro-msg');
  if(introMsg){
    const _an=(D&&D.meta&&D.meta.accountName&&
      currentAccountId&&currentAccountId!=='default'&&!currentAccountId.startsWith('sample_'))
      ? D.meta.accountName : '';
    const txt=isKAM&&_an
      ?`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์บัญชีลูกค้า <strong>${_an}</strong><br><br>วันนี้อยากให้ช่วยดูประเด็นไหนเป็นพิเศษคะ`
      :isKAM
      ?`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์บัญชีลูกค้าจาก Freshket<br><br>เลือกร้านที่พอร์ตก่อน แล้ว Olive จะวิเคราะห์ให้เลยค่ะ`
      :`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์ต้นทุนจาก Freshket<br><br>วิเคราะห์ข้อมูลต้นทุนร้านคุณ และช่วยวางแผนลดต้นทุนได้เลยค่ะ`;
    introMsg.querySelector('.mb').innerHTML=txt;
  }
}
function closeChat(){chatOpen=false;document.getElementById('aipanel').classList.remove('open');document.getElementById('overlay').classList.remove('on');document.getElementById('aifab').classList.remove('open');}

function initChatFabDrag(){
  const fab=document.getElementById('aifab');
  if(!fab||fab.dataset.dragInit==='1')return;
  fab.dataset.dragInit='1';
  const key='fs_aifab_pos_v1';
  function clamp(x,y){
    const pad=10;
    const r=fab.getBoundingClientRect();
    const w=r.width||54,h=r.height||54;
    const vw=window.innerWidth||440,vh=window.innerHeight||700;
    return {x:Math.max(pad,Math.min(x,vw-w-pad)),y:Math.max(pad,Math.min(y,vh-h-pad))};
  }
  function setPos(x,y,persist){
    const p=clamp(x,y);
    fab.style.left=p.x+'px';
    fab.style.top=p.y+'px';
    fab.style.right='auto';
    fab.style.bottom='auto';
    fab.classList.add('moved');
    if(persist){try{localStorage.setItem(key,JSON.stringify(p));}catch(e){}}
  }
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))setPos(saved.x,saved.y,false);
  }catch(e){}
  let startX=0,startY=0,origX=0,origY=0,dragging=false,moved=false,pid=null;
  fab.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=fab.getBoundingClientRect();
    startX=e.clientX;startY=e.clientY;origX=r.left;origY=r.top;
    dragging=true;moved=false;pid=e.pointerId;
    if(fab.setPointerCapture)fab.setPointerCapture(pid);
    fab.classList.add('dragging');
  },{passive:false});
  fab.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)+Math.abs(dy)>6)moved=true;
    if(moved){e.preventDefault();setPos(origX+dx,origY+dy,false);}
  },{passive:false});
  function endDrag(){
    if(!dragging)return;
    dragging=false;fab.classList.remove('dragging');
    try{if(fab.releasePointerCapture&&pid!==null)fab.releasePointerCapture(pid);}catch(e){}
    if(moved){
      const r=fab.getBoundingClientRect();
      setPos(r.left,r.top,true);
      window.__aifabDragSuppress=true;
      setTimeout(()=>{window.__aifabDragSuppress=false;},260);
    }
  }
  fab.addEventListener('pointerup',endDrag);
  fab.addEventListener('pointercancel',endDrag);
  window.addEventListener('resize',()=>{
    if(!fab.classList.contains('moved'))return;
    const r=fab.getBoundingClientRect();
    setPos(r.left,r.top,true);
  });
}

function askQ(q){document.getElementById('aiinput').value=q;sendChat();}
function addMsg(role,txt,loading=false){const msgs=document.getElementById('aimsgs');const d=document.createElement('div');d.className=`msg ${role}`;d.innerHTML=`<div class="mb ${loading?'ld':''}">${txt}</div>`;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}

// ── AI CHAT SCOPE + CONTEXT ROUTER ───────────────────
function getActiveScreenName(){
  const el=document.querySelector('.scr.on');
  return el&&el.id?el.id.replace(/^scr-/,''):'overview';
}

function detectChatScope(q){
  const text=String(q||'').toLowerCase();
  if(/ทีม|team|standup|สแตนด์อัพ|หัวหน้าทีม|tl|team lead|kam แต่ละคน|แต่ละ kam|เซลล์แต่ละคน|sales แต่ละคน|โค้ช|coach|support/.test(text))return 'team';
  if(/พอร์ต|portfolio|ภาพรวมทั้งหมด|ร้านทั้งหมด|ลูกค้าทั้งหมด|บัญชีทั้งหมด|account ทั้งหมด|accounts ทั้งหมด|ใครก่อน|โทรหาใคร|priority|prioritize|จัดลำดับ|at[- ]?risk|เสี่ยงทั้งหมด/.test(text))return 'portfolio';
  if(/ร้านนี้|บัญชีนี้|ลูกค้ารายนี้|account นี้|sku|สินค้า|ยอดซื้อ|ต้นทุน|ประหยัด|หมวด|category|สั่งซื้อ|ออเดอร์|สเปค|ราคา/.test(text))return 'account';
  const screen=getActiveScreenName();
  if(screen==='teamview')return 'team';
  if(screen==='portview')return 'portfolio';
  return 'account';
}

function fmtChatK(n){return n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+Math.round(n/1000)+'K':'฿'+Math.round(n).toLocaleString('th-TH');}

function buildAccountChatContext(){
  const _an=D.meta.accountName||document.getElementById('acct-name-input')?.value.trim()||'ร้านอาหารของคุณ';
  const _sp=curSpend()>0?totalAll()/curSpend()*100:0;
  const _sc=Math.min(95,Math.max(50,Math.round(95-_sp*2.5)));
  const _skus=D.skus.length?D.skus:SAMPLE.skus;
  const _cats=D.cats.length?D.cats:SAMPLE.cats;
  const _hist=D.history.length?D.history:SAMPLE.history;

  const _trend=_hist.slice(-6).map(h=>h.m+' '+fmt(h.s)+' ('+h.orders+' ออเดอร์)').join(', ');
  const _catStr=_cats.slice(0,10).map(c=>c.n+' '+fmt(c.s)+' ('+c.p+'%)').join(', ');
  const _skuTop=[..._skus].sort((a,b)=>(b.gmv||b.s)-(a.gmv||a.s)).slice(0,14);
  const _skuStr=_skuTop.map((s,i)=>(i+1)+'. '+s.n+' ['+(s.d||'-')+'] '+fmt(s.gmv||s.s)+'/ด.'+(s.unit_price?' ฿'+s.unit_price+'/kg':'')).join('\n')+(_skus.length>14?'\n(+'+(_skus.length-14)+' รายการ)':'');

  let _skuMovement='ไม่มีข้อมูล SKU trend (ใช้ skus.csv format เดิม)';
  const _skuMonths=D.skus_monthly&&Object.keys(D.skus_monthly);
  if(_skuMonths&&_skuMonths.length>=2){
    const _cSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    const months=[..._skuMonths].sort((a,b)=>_cSort(b)-_cSort(a)).slice(0,6);
    const lastMo=months[0];
    const prevMonths=months.slice(1);
    const lastSet=new Set((D.skus_monthly[lastMo]||[]).map(s=>s.id));
    const prevAllIds=new Set(prevMonths.flatMap(m=>(D.skus_monthly[m]||[]).map(s=>s.id)));
    const newSkus=(D.skus_monthly[lastMo]||[]).filter(s=>!prevAllIds.has(s.id)).sort((a,b)=>(b.gmv||0)-(a.gmv||0)).slice(0,6);
    const prev1Mo=months[1];
    const droppedSkus=(D.skus_monthly[prev1Mo]||[]).filter(s=>!lastSet.has(s.id)).sort((a,b)=>(b.gmv||0)-(a.gmv||0)).slice(0,6);
    const prevAvg={};
    prevMonths.forEach(m=>{(D.skus_monthly[m]||[]).forEach(s=>{if(!prevAvg[s.id])prevAvg[s.id]={sum:0,cnt:0,n:s.n,d:s.d};prevAvg[s.id].sum+=s.qty_kg;prevAvg[s.id].cnt++;});});
    const volChanges=(_skus).filter(s=>prevAvg[s.id]&&prevAvg[s.id].cnt>0).map(s=>{const avg=prevAvg[s.id].sum/prevAvg[s.id].cnt;const chg=avg>0?(s.qty_kg-avg)/avg*100:0;return{...s,avgQty:avg,chgPct:chg};}).filter(s=>Math.abs(s.chgPct)>=30).sort((a,b)=>Math.abs(b.chgPct)-Math.abs(a.chgPct)).slice(0,5);
    const newStr=newSkus.length?newSkus.map(s=>'+ '+s.n+' ['+fmt(s.gmv||0)+'/ด.]').join('\n'):'ไม่มี';
    const dropStr=droppedSkus.length?droppedSkus.map(s=>'- '+s.n+' ['+fmt(s.gmv||0)+'/ด. เดือนก่อน]').join('\n'):'ไม่มี';
    const volStr=volChanges.length?volChanges.map(s=>(s.chgPct>0?'↑':'↓')+' '+s.n+' '+s.chgPct.toFixed(0)+'% ('+(s.qty_kg||0).toFixed(1)+'kg vs avg '+s.avgQty.toFixed(1)+'kg)').join('\n'):'ไม่มี';
    _skuMovement=`ช่วง ${months[months.length-1]} – ${lastMo} (${months.length} เดือน)\nSKU เพิ่งเริ่มซื้อ:\n${newStr}\nSKU หยุดซื้อ MoM:\n${dropStr}\nVolume เปลี่ยนแปลง ≥30%:\n${volStr}`;
  }

  const _ol=OPPS.length
    ?OPPS.slice(0,18).map((o,i)=>{const a=getAlt(o);return(i+1)+'. '+o.curName+' → '+a.altName+': ประหยัด '+fmt(a.save)+'/ด. ('+a.pct+'%, '+(a.conf==='high'?'มั่นใจสูง':'ทดลองก่อน')+')'}).join('\n')+(OPPS.length>18?'\n(+'+(OPPS.length-18)+' opportunities)':'')
    :'ยังไม่มีข้อมูล alternatives';

  return `-- CHAT SCOPE --\naccount\n\n-- ACCOUNT DATA --\nชื่อ: ${_an}\nค่าใช้จ่ายเดือนล่าสุด: ${fmt(curSpend())}\nCost IQ Score: ${_sc}/100\nเลือกแผนแล้ว: ${fmt(totalSel())}/เดือน (${sel.size} รายการ)\nโอกาสเต็มที่: ${fmt(totalAll())}/เดือน\n\n=== Trend 6 เดือน ===\n${_trend}\n\n=== หมวดสินค้า เดือนล่าสุด ===\n${_catStr}\n\n=== Top SKU เดือนล่าสุด ===\n${_skuStr}\n\n=== SKU Movement ===\n${_skuMovement}\n\n=== โอกาสประหยัด ===\n${_ol}`;
}

function buildPortfolioChatContext(){
  let accounts=[];
  try{accounts=typeof getPortviewAccounts==='function'?getPortviewAccounts():[];}catch(e){accounts=[];}
  if(!accounts||!accounts.length){
    return `-- CHAT SCOPE --\nportfolio\n\n-- PORTFOLIO DATA --\nยังไม่มีข้อมูลพอร์ตที่โหลดอยู่ใน session นี้ หรือผู้ใช้ไม่มีสิทธิ์เห็นพอร์ตนี้`;
  }
  const withPace=accounts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const portfolioPace=withPace.length?Math.round(withPace.reduce((s,a)=>s+(a.paceSignal.gmvToDate||0),0)/Math.max(1,withPace.reduce((s,a)=>s+(a.paceSignal.expected||0),0))*100):0;
  const atRisk=accounts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn'));
  const shortfall=atRisk.reduce((s,a)=>s+Math.max(0,(a.paceSignal.baselineGmv||a.paceSignal.expected||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0)),0);
  const ranked=[...atRisk].sort((a,b)=>Math.max(0,(b.paceSignal.baselineGmv||0)-(b.paceSignal.runrate||0))-Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0))).slice(0,12);
  const ctxLines=ranked.map(a=>{
    const ps=a.paceSignal||{};
    const gap=Math.max(0,(ps.baselineGmv||ps.expected||0)-(ps.runrate||ps.gmvToDate||0));
    const parts=[`${a.name} [${ps.cls||'n/a'}] pace ${ps.pct||0}% gap ${fmtChatK(gap)}`];
    const cc=a._churnCounts;
    if(cc&&cc.gone>0)parts.push(`SKU หาย ${cc.gone}`);
    else if((a.churnedSkuCount||0)>0)parts.push(`SKU หาย ${a.churnedSkuCount}`);
    if(a.missingCatCount>0)parts.push(`category ขาด ${(a.missingCats||'').split(' | ').filter(Boolean).slice(0,2).join(', ')}`);
    if(a.kamName)parts.push(`KAM ${a.kamName}`);
    return '- '+parts.join(' · ');
  }).join('\n');
  const healthy=accounts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='safe'||a.paceSignal.cls==='great')).length;
  return `-- CHAT SCOPE --\nportfolio\n\n-- PORTFOLIO DATA --\nจำนวนร้าน: ${accounts.length}\nPortfolio pro-rate: ${portfolioPace}%\nAt-risk: ${atRisk.length} ร้าน\nHealthy/Safe: ${healthy} ร้าน\nEstimated shortfall/run-rate gap: ${fmtChatK(shortfall)}\n\n=== At-risk accounts ranked by money impact ===\n${ctxLines||'ไม่มีร้านเสี่ยงจากข้อมูลที่โหลดอยู่'}`;
}

function buildTeamChatContext(){
  let groups=[];
  try{groups=typeof _buildKamGroups==='function'?_buildKamGroups():[];}catch(e){groups=[];}
  if(!groups||!groups.length){
    return `-- CHAT SCOPE --\nteam\n\n-- TEAM DATA --\nยังไม่มีข้อมูลทีมที่โหลดอยู่ใน session นี้ หรือ user ไม่ใช่ TL/admin`;
  }
  const allAccts=groups.flatMap(g=>g.accounts||[]);
  const withPace=allAccts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const teamPace=withPace.length?Math.round(withPace.reduce((s,a)=>s+(a.paceSignal.gmvToDate||0),0)/Math.max(1,withPace.reduce((s,a)=>s+(a.paceSignal.expected||0),0))*100):0;
  const totalShortfall=groups.reduce((s,g)=>s+(g.shortfall||0),0);
  const kamLines=groups.slice(0,16).map(g=>{
    const atRisk=(g.accounts||[]).filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')).slice(0,3).map(a=>`${a.name}(${a.paceSignal?.pct||0}%${(a.churnedSkuCount||0)>0?' +SKUหาย':''})`).join(', ');
    return `- ${g.kamName}: ${g.total} ร้าน · pace ${g.pace}% · เสี่ยง ${g.danger+g.warn} · shortfall ${fmtChatK(g.shortfall||0)}${atRisk?' | top risk: '+atRisk:''}`;
  }).join('\n');
  return `-- CHAT SCOPE --\nteam\n\n-- TEAM DATA --\nจำนวน KAM: ${groups.length}\nจำนวนร้าน: ${allAccts.length}\nTeam pro-rate: ${teamPace}%\nTotal shortfall: ${fmtChatK(totalShortfall)}\n\n=== KAM groups ===\n${kamLines}`;
}

function buildChatContextByScope(scope){
  if(scope==='team')return buildTeamChatContext();
  if(scope==='portfolio')return buildPortfolioChatContext();
  return buildAccountChatContext();
}

async
