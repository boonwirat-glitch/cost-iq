// SECTION:CSV_PARSERS
function parseCSVRow(row){
  const fields=[];let cur='';let inQ=false;
  for(let i=0;i<row.length;i++){
    const c=row[i];
    if(inQ){
      if(c==='"'&&row[i+1]==='"'){cur+='"';i++;}  // escaped quote ""
      else if(c==='"'){inQ=false;}
      else{cur+=c;}
    } else {
      if(c==='"'){inQ=true;}
      else if(c===','){fields.push(cur.trim());cur='';}
      else{cur+=c;}
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parsePortviewBulk(csv){
  // Format: account_id, account_name, last_month_gmv, gmv_to_date, days_elapsed, days_in_month, runrate_gmv
  // Columns 10 (top_churned_names) and 12 (missing_cats) may contain commas → use parseCSVRow
  try{
    const lines=csv.trim().split('\n').slice(1).filter(l=>l.trim());
    return lines.map(l=>{
      const p=parseCSVRow(l);
      const accountId=(p[0]||'').trim().replace(/^"|"$/g,'');
      const accountName=(p[1]||'').trim().replace(/^"|"$/g,'');
      const lastGmv=parseFloat(p[2])||0;
      const gmvToDate=parseFloat(p[3])||0;
      const daysElapsed=parseInt(p[4])||1;
      const daysInMonth=parseInt(p[5])||30;
      const runrate=parseFloat(p[6])||0;
      // Normalized expected: use last month's DAILY RATE × days elapsed this month
      // avoids inflation when months have different lengths (e.g. Apr 30d vs May 31d)
      const _now=new Date();const _lagD=new Date(_now);_lagD.setDate(_lagD.getDate()-1);
      const lastMonthDays=new Date(_lagD.getFullYear(),_lagD.getMonth(),0).getDate(); // day-1 lag: ensures correct prev-month days on month boundary
      const dailyRate=lastMonthDays>0?lastGmv/lastMonthDays:lastGmv/30;
      const expected=dailyRate*daysElapsed;
      const pct=expected>0?Math.round(gmvToDate/expected*100):0;
      let cls='',label='';
      if(pct>=100){cls='great';label='ดีเยี่ยม';}
      else if(pct>=95){cls='safe';label='ปลอดภัย';}
      else if(pct>=90){cls='warn';label='MONITOR';}
      else{cls='danger';label='AT RISK';}
      const accountType=(p[7]||'').trim().replace(/^"|"$/g,'');
      // Enriched columns (Q8 enriched)
      const churnedSkuCount=parseInt(p[8])||0;
      const churnedGmv=parseFloat(p[9])||0;
      const topChurnedNames=(p[10]||'').trim().replace(/^"|"$/g,'');
      const missingCatCount=parseInt(p[11])||0;
      const missingCats=(p[12]||'').trim().replace(/^"|"$/g,'');
      const lastMonthSkuCount=parseInt(p[13])||0;
      const curSkuCount=parseInt(p[14])||0;
      const ordersToDate=parseInt(p[15])||0;
      const kamName=(p[16]||'').trim();     // Q8E v2: kam_name
      const kamEmail=(p[17]||'').trim();    // Q8E v2: kam_email
      const tlEmail=(p[18]||'').trim();     // Q8E v2: tl_email
      const daysWithCurrentKam=p[19]!==undefined&&p[19].trim()!==''?parseInt(p[19])||null:null; // Q8E v3: days since handoff (null = ≥12mo)
      return{id:accountId,name:accountName,lastGmv,gmvToDate,daysElapsed,daysInMonth,runrate,accountType,
        churnedSkuCount,churnedGmv,topChurnedNames,missingCatCount,missingCats,
        lastMonthSkuCount,curSkuCount,ordersToDate,kamName,kamEmail,tlEmail,daysWithCurrentKam,
        paceSignal:{cls,pct,label,expected,lastGmv,gmvToDate,runrate,
          histMonths:1,confidence:'low',isNew:lastGmv===0,
          baselineDaily:Math.round(dailyRate),baselineGmv:Math.round(dailyRate*daysInMonth)},churnCount:0};
    }).filter(r=>r.id);
  }catch(e){console.warn('parsePortviewBulk error',e);return[];}
}

function parseCurrentMonth(csv){
  try{
    const lines=csv.trim().split('\n').slice(1).filter(l=>l.trim());
    if(!lines.length)return null;
    // Expected: account_id?, month_label, gmv_to_date, orders_to_date, days_elapsed, days_in_month, runrate_gmv
    const p=lines[0].split(',');
    // Support both with and without account_id column
    const offset=p.length>=7?1:0;
    return{
      month_label:(p[0+offset]||'').trim(),
      gmv_to_date:parseFloat(p[1+offset])||0,
      orders_to_date:parseInt(p[2+offset])||0,
      days_elapsed:parseInt(p[3+offset])||0,
      days_in_month:parseInt(p[4+offset])||0,
      runrate_gmv:parseFloat(p[5+offset])||0
    };
  }catch(e){return null;}
}

function parseSkuCurrent(csv){
  try{
    const lines=csv.trim().split('\n').slice(1).filter(l=>l.trim());
    return lines.map(l=>{
      const p=l.split(',');
      // account_id?, item_id, orders_this_month, gmv_to_date
      const offset=p.length>=4?1:0;
      return{
        item_id:String((p[0+offset]||'').trim()),
        orders_this_month:parseInt(p[1+offset])||0,
        gmv_to_date:parseFloat(p[2+offset])||0
      };
    }).filter(r=>r.item_id);
  }catch(e){return[];}
}

// ════════════════════════════════════════
// BULK ALTERNATIVES (Q4B) — v52
// ════════════════════════════════════════
// Q4B output format (18 cols): account_id, then same 17 cols as Q4 matcher_input
// Splits per account, converts raw candidates → D.alts unverified format,
// merges with existing verified alts (smart delta) per account.
// SECTION:BULK_ALTERNATIVES
function processBulkAlternatives(csv){
  const lines=csv.trim().split('\n').slice(1).filter(l=>l.trim());
  // Group rows per account
  const byAccount={};
  lines.forEach(l=>{
    const p=parseCSVRow(l);
    const aid=(p[0]||'').trim();
    if(!aid)return;
    const row={
      account_item_id:(p[1]||'').trim(),
      account_item_name:(p[2]||'').trim(),
      account_core_name:(p[3]||'').trim(),
      account_price:parseFloat(p[4])||0,
      subclass_name:(p[5]||'').trim(),
      catalog_item_id:(p[6]||'').trim(),
      catalog_item_name:(p[7]||'').trim(),
      catalog_brand:(p[8]||'').trim(),
      grading:(p[9]||'').trim(),
      pack_size:(p[10]||'').trim(),
      catalog_price:parseFloat(p[11])||0,
      price_diff:parseFloat(p[12])||0,
      account_unit_price:p[13]?parseFloat(p[13]):null,
      account_pack_size:(p[14]||'').trim(),
      catalog_unit_price:parseFloat(p[15])||0,
      monthly_qty:parseFloat(p[16])||0,
      monthly_gmv:parseFloat(p[17])||0,
      price_basis:(p[18]||'per_kg').trim()||'per_kg'  // v3: 'per_kg' or 'per_liter'
    };
    if(!row.account_item_id||!row.catalog_item_id)return;
    if(!byAccount[aid])byAccount[aid]=[];
    byAccount[aid].push(row);
  });

  // For each account: convert to D.alts format with smart delta merge
  let totalPairs=0;
  const accountIds=new Set();
  Object.entries(byAccount).forEach(([aid,rows])=>{
    accountIds.add(aid);
    // Group rows by source SKU to compute price_basis
    const groupMap=new Map();
    rows.forEach(r=>{
      if(!groupMap.has(r.account_item_id)){
        groupMap.set(r.account_item_id,{
          id:r.account_item_id,name:r.account_item_name,
          price:r.account_price,unit_price:r.account_unit_price,
          pack_size:r.account_pack_size,subclass:r.subclass_name,
          monthly_qty:r.monthly_qty,monthly_gmv:r.monthly_gmv,
          price_basis:r.price_basis||'per_kg',  // v3: read from SQL
          alts:[]
        });
      }
      groupMap.get(r.account_item_id).alts.push(r);
    });

    // Build new candidate pairs (unverified)
    const newPairs=[];
    groupMap.forEach(g=>{
      const _basis=g.price_basis||'per_kg';
      const _unitLabel=_basis==='per_liter'?'ลิตร':'กก.';
      g.alts.forEach(a=>{
        newPairs.push({
          source_item_id:parseInt(g.id),source_item_name:g.name,
          source_price:g.price,source_pack_size:g.pack_size||'',
          alt_item_id:parseInt(a.catalog_item_id),alt_item_name:a.catalog_item_name,
          alt_price:a.catalog_price,price_diff:a.price_diff,
          pack_size:a.pack_size||'',
          confidence:'unverified',note_th:'',caveat_th:'',
          subclass:g.subclass,
          price_basis:_basis,price_unit_label:_unitLabel,
          source_display_price:g.price,
          alt_display_price:Math.max(0,g.price-a.price_diff),
          price_diff_display:a.price_diff,
          source_unit_price:g.unit_price||null,    // ฿/pack (for per-egg calc)
          alt_unit_price:a.catalog_unit_price||0,  // ฿/pack (for per-egg calc)
          monthly_qty_commercial:g.monthly_qty||0
        });
      });
    });

    // ── v52 localStorage fix: store unverified candidates in-memory only ──
    // loadFromStorage merges these with verified alts from localStorage on account open
    bulkAltsUnverified[aid]=newPairs;  // raw unverified candidates
    totalPairs+=newPairs.length;
    accountIds.add(aid);
  });
  return{accounts:Object.keys(byAccount).length,totalPairs,accountIds};
}

// ════════════════════════════════════════
// BUILD GROUPS FROM D.alts UNVERIFIED — for in-app Verify (no matcher_input.csv needed)
// ════════════════════════════════════════
// Returns groups in the same shape as parseMatcherInput, sorted by monthly_gmv DESC.
// Used when bulk_alternatives is loaded and KAM clicks Verify.
function buildGroupsFromAlts(){
  if(!D.alts||!D.alts.length)return[];
  const skuMap={};(D.skus||[]).forEach(s=>{skuMap[s.id]=s;});
  const map=new Map();
  D.alts.forEach(p=>{
    if(p.confidence&&p.confidence!=='unverified')return;  // skip already-verified
    const sid=String(p.source_item_id);
    if(!map.has(sid)){
      const sku=skuMap[sid];
      map.set(sid,{
        id:sid,
        name:p.source_item_name||sku?.n||'',
        core_name:'',
        price:p.source_price||sku?.unit_price||0,
        unit_price:p.source_unit_price||sku?.unit_price||null,
        display_unit_price:p.source_display_price||null,
        pack_size:p.source_pack_size||'',
        subclass:p.subclass||sku?.subclass||'',
        price_basis:p.price_basis||'per_kg',
        price_unit_label:p.price_unit_label||(p.price_basis==='per_liter'?'ลิตร':(p.price_basis==='per_egg'?'ฟอง':'กก.')),
        monthly_gmv:p.monthly_qty_commercial?(p.monthly_qty_commercial*(p.source_unit_price||p.source_display_price||p.source_price||0)):(sku?.gmv||0),
        monthly_qty:p.monthly_qty_commercial||sku?.qty_kg||0,
        alternatives:[],
        status:'pending'
      });
    }
    map.get(sid).alternatives.push({
      catalog_item_id:String(p.alt_item_id),
      catalog_item_name:p.alt_item_name,
      catalog_brand:'',
      grading:'',
      pack_size:p.pack_size||'',
      catalog_price:p.alt_price||0,
      price_diff:p.price_diff||0,
      catalog_unit_price:p.alt_unit_price||null,
      display_unit_price:p.alt_display_price||null,
      price_basis:p.price_basis||'per_kg'
    });
  });
  // Use SKU's actual monthly_gmv from D.skus where available (more accurate)
  map.forEach(g=>{
    const sku=skuMap[g.id];
    if(sku&&sku.gmv)g.monthly_gmv=sku.gmv;
  });
  return Array.from(map.values()).sort((a,b)=>b.monthly_gmv-a.monthly_gmv);
}

// SECTION:OPP_ENGINE
function computeOPPS(){
  if(!D.alts.length||!D.skus.length)return;
  const skuMap={};D.skus.forEach(s=>{skuMap[s.id]=s;});
  const grouped={};
  D.alts.forEach(p=>{const sid=String(p.source_item_id);if(!grouped[sid])grouped[sid]={pairs:[],sku:skuMap[sid]};grouped[sid].pairs.push(p);});
  const confOrder={high:0,medium:1,low:2,unverified:3};
  const newOpps=[];let oppId=1;
  Object.entries(grouped).forEach(([sid,{pairs,sku}])=>{
    if(!sku)return;
    // ── Include all pairs with positive savings — unverified (Q4B bulk) are shown but not auto-selected ──
    const verifiedPairs=pairs.filter(p=>p.confidence&&(p.price_diff||0)>0);
    if(!verifiedPairs.length)return;
    const p0=verifiedPairs[0];
    // ── Detect natural trade unit: per_egg (eggs), per_liter (liquids), per_kg (default) ──
    const _displayMode=detectDisplayMode(sku.subclass||sku.d||'',p0.source_pack_size||'');
    const unitLabel=_displayMode==='per_egg'?'ฟอง':_displayMode==='per_liter'?'ลิตร':'กก.';
    const qu=_displayMode==='per_egg'?'ฟอง/เดือน':_displayMode==='per_liter'?'ลิตร/เดือน':'kg/เดือน';

    const alts=verifiedPairs.map(p=>{
      let save,srcDisplay,altDisplay,diffDisplay,pct;

      if(_displayMode==='per_egg'){
        // Per-egg: use unit prices / egg count per pack
        const srcEggs=extractEggCount(p.source_pack_size)||1;
        const altEggs=extractEggCount(p.pack_size)||srcEggs;
        const srcUP=p.source_unit_price||0;
        const altUP=p.alt_unit_price||0;
        if(srcUP>0&&altUP>0&&srcEggs>0&&altEggs>0){
          srcDisplay=parseFloat((srcUP/srcEggs).toFixed(2));
          altDisplay=parseFloat((altUP/altEggs).toFixed(2));
          diffDisplay=parseFloat((srcDisplay-altDisplay).toFixed(2));
          pct=srcDisplay>0?parseFloat(((diffDisplay/srcDisplay)*100).toFixed(1)):0;
          const eggsPerMonth=(p.monthly_qty_commercial||0)*srcEggs;
          save=Math.round(diffDisplay*eggsPerMonth);
        } else {
          // fallback per_kg
          srcDisplay=p.source_price;diffDisplay=p.price_diff;
          altDisplay=Math.max(0,srcDisplay-diffDisplay);
          pct=srcDisplay>0?parseFloat(((diffDisplay/srcDisplay)*100).toFixed(1)):0;
          const estQty=sku.qty_kg||(p.source_price>0?sku.gmv/p.source_price:0);
          save=Math.round(p.price_diff*(estQty||0));
        }
      } else {
        // per_liter OR per_kg — calculation identical (Q4B uses weight, label changes for liquids)
        srcDisplay=p.source_price;
        diffDisplay=p.price_diff;
        altDisplay=Math.max(0,srcDisplay-diffDisplay);
        pct=srcDisplay>0?parseFloat(((diffDisplay/srcDisplay)*100).toFixed(1)):0;
        const estQty=sku.qty_kg||(p.source_price>0?sku.gmv/p.source_price:0);
        save=Math.round(p.price_diff*(estQty||0));
      }

      return{
        altId:p.alt_item_id,altName:p.alt_item_name,
        altSpec:p.pack_size||'',  // pack_size as context
        altP:altDisplay,altU:unitLabel,
        save,pct,
        note:p.note_th||'',caveat:p.caveat_th||'',
        conf:p.confidence||'medium',recommended:false
      };
    }).filter(a=>a.save>0).sort((a,b)=>{const cd=(confOrder[a.conf]??1)-(confOrder[b.conf]??1);return cd!==0?cd:b.save-a.save;});
    if(!alts.length)return;
    alts[0].recommended=true;
    // ── curSpec and curP use display unit ──
    const srcPack=p0.source_pack_size||'';
    const curSpec=srcPack||'';  // pack_size context only
    // curP in natural trade unit
    let _curP=p0.source_price;
    if(_displayMode==='per_egg'){
      const _srcE=extractEggCount(p0.source_pack_size)||1;
      _curP=p0.source_unit_price>0?parseFloat((p0.source_unit_price/_srcE).toFixed(2)):p0.source_price;
    }
    newOpps.push({
      id:oppId++,cat:sku.subclass||sku.d||'สินค้า',
      curId:parseInt(sid),curName:sku.n,curSpec,
      curP:_curP,curU:unitLabel,
      priceBasis:_displayMode,priceUnitLabel:unitLabel,
      monthlyGmv:sku.gmv,monthlyQty:sku.qty_kg,qu,alts
    });
  });
  newOpps.sort((a,b)=>b.monthlyGmv-a.monthlyGmv);
  OPPS.length=0;newOpps.forEach(o=>OPPS.push(o));
  // Auto-select only if sel is empty or has no valid ids (preserve user's custom plan)
  const validSel=OPPS.filter(o=>sel.has(o.id));
  if(validSel.length===0){
    selAlt={};
    // ── v52 C2 fix: auto-select VERIFIED opps only — never silently include unverified into plan ──
    const verifiedOpps=OPPS.filter(o=>{const c=o.alts[0]?.conf;return c==='high'||c==='medium'||c==='low';});
    const highConf=verifiedOpps.filter(o=>o.alts[0]?.conf==='high');
    if(highConf.length>0){highConf.forEach(o=>sel.add(o.id));currentPlanMode='high';}
    else if(verifiedOpps.length>0){verifiedOpps.forEach(o=>sel.add(o.id));currentPlanMode='all';}
    else{sel.clear();currentPlanMode='none';}
  }
}

// ════════════════════════════════════════
// DATA LOADING
// ════════════════════════════════════════


// ── File upload handlers (bulk only) ──
function handleFileUpload(type,input){
  const file=input.files[0];if(!file)return;
  const _done=(input&&typeof input._ciqDone==='function')?input._ciqDone:function(){};
  if(type==='bulk-categories'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const byAccount={};
      lines.forEach(l=>{
        const p=parseCSVRow(l);
        const aid=(p[0]||'').trim();const mo=(p[1]||'').trim();const cat=(p[2]||'').trim();const gmv=parseFloat(p[3])||0;
        if(!aid||!mo||!cat)return;
        if(!byAccount[aid])byAccount[aid]={};if(!byAccount[aid][mo])byAccount[aid][mo]=[];
        byAccount[aid][mo].push({n:cat,s:gmv,p:0,c:''});
      });
      const colors=['#00d070','#2266cc','#e8a000','#cc4444','#8855cc','#00aabb','#ff6633','#446644','#aa5599','#667788'];
      Object.entries(byAccount).forEach(([aid,months])=>{
        Object.entries(months).forEach(([mo,cats])=>{
          const total=cats.reduce((s,c)=>s+c.s,0);
          cats.forEach((c,i)=>{c.p=total>0?parseFloat((c.s/total*100).toFixed(1)):0;c.c=colors[i%colors.length];});
          cats.sort((a,b)=>b.s-a.s);
        });
        bulkCatsData[aid]=months;
      });
      const cnt=Object.keys(byAccount).length;
      if(currentAccountId&&bulkCatsData[currentAccountId]){
        D.cats_monthly=bulkCatsData[currentAccountId];
        const moSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
        const mk=Object.keys(D.cats_monthly).sort((a,b)=>moSort(b)-moSort(a));
        D.cats=mk.length?D.cats_monthly[mk[0]]:[];fileStatus.categories=true;if(window.RenderBus)window.RenderBus.signal('categories'); // v223
      }
      // toast removed v205b — bulk ingest noise
      if(typeof window._splashProgress==='function')window._splashProgress(30,'กำลังโหลดหมวดหมู่...');
      const b=document.getElementById('badge-bulk-cats');if(b){b.textContent='✓ '+cnt;b.className='dp-slot-badge ok';}
      _done();
    };reader.readAsText(file);return;
  }
  if(type==='bulk-skus'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const totalLines=lines.length;

      // ── Shared parse helper ──
      function _parseSKULine(l){
        const p=parseCSVRow(l);
        const aid=(p[0]||'').trim();const mo=(p[1]||'').trim();const itemId=(p[2]||'').trim();const name=(p[3]||'').trim();
        const dept=(p[4]||'').trim();const subclass=(p[5]||'').trim();const temp=(p[6]||'').trim();
        const hasPackSize=p.length>=14||isNaN(parseFloat(p[7]));
        const packSize=hasPackSize?(p[7]||'').trim():'';const off=hasPackSize?1:0;
        const gmv=parseFloat(p[7+off])||0;const pct=parseFloat(p[8+off])||0;const qtyKg=parseFloat(p[9+off])||0;
        const unitPrice=parseFloat(p[10+off])||0;const orderCount=parseInt(p[11+off])||0;
        const avgPiecePrice=parseFloat(p[12+off])||0;const outletCountSku=parseInt(p[13+off])||1;
        // v159: bi_source unit fields (cols 14-16, offset-adjusted)
        const defaultUnitGroup=(p[14+off]||'').trim().toUpperCase();
        const eaUnitName=(p[15+off]||'').trim();
        const universalEaValue=parseFloat(p[16+off])||0;
        if(!aid||!mo||!itemId)return null;

        // ── 4-tier display_price logic ──────────────────────────────────────
        // Priority: Weight group → range_kg → pack_size units → ea count → fallback
        const _rangeKgMax=extractRangeKgMax(packSize);
        const _packUnits=(defaultUnitGroup!=='WEIGHT')?parsePackSizeUnits(packSize):null;
        let _displayPrice,_displayUnit;
        let _q6bFactor=null; // conversion divisor for Q6B unit_price → same display unit

        if(defaultUnitGroup==='WEIGHT'){
          // Tier 1: Weight group — unit_price is already per-kg from BigQuery
          _displayPrice=unitPrice;
          _displayUnit='กก.';
          _q6bFactor={type:'per_kg',divisor:1};
        } else if(_rangeKgMax&&avgPiecePrice>0){
          // Tier 2: variable-weight items (e.g. 3-6 kg/ตัว)
          _displayPrice=Math.round(avgPiecePrice/_rangeKgMax*100)/100;
          _displayUnit='กก.';
          _q6bFactor={type:'per_kg',divisor:_rangeKgMax};
        } else if(_packUnits&&_packUnits.kg>0){
          // Tier 3a: pack_size has explicit kg/g content → ฿/กก.
          _displayPrice=Math.round((unitPrice/_packUnits.kg)*100)/100;
          _displayUnit='กก.';
          _q6bFactor={type:'per_kg',divisor:_packUnits.kg};
        } else if(_packUnits&&_packUnits.liter>0){
          // Tier 3b: pack_size has explicit L/ml/cc content → ฿/ลิตร
          _displayPrice=Math.round((unitPrice/_packUnits.liter)*100)/100;
          _displayUnit='ลิตร';
          _q6bFactor={type:'per_liter',divisor:_packUnits.liter};
        } else if(eaUnitName==='แกลลอน'&&universalEaValue>0){
          // Tier 3c: gallon → ฿/ลิตร (1 gallon = 3.785 L)
          const totalL=universalEaValue*3.785;
          _displayPrice=Math.round((unitPrice/totalL)*100)/100;
          _displayUnit='ลิตร';
          _q6bFactor={type:'per_liter',divisor:totalL};
        } else if(eaUnitName==='ปี๊บ'&&universalEaValue>0){
          // Tier 3d: ปี๊บ → ฿/ลิตร (1 ปี๊บ = 16 L)
          const totalL=universalEaValue*16;
          _displayPrice=Math.round((unitPrice/totalL)*100)/100;
          _displayUnit='ลิตร';
          _q6bFactor={type:'per_liter',divisor:totalL};
        } else if((defaultUnitGroup==='EACH'||defaultUnitGroup==='VOLUME')&&eaUnitName&&universalEaValue>0){
          // Tier 4: bundle/count (eggs, fruit, bottles, rolls, etc.) — leave as per-unit
          const base=avgPiecePrice>0?avgPiecePrice:unitPrice;
          _displayPrice=Math.round(base/universalEaValue*100)/100;
          _displayUnit=eaUnitName;
          _q6bFactor={type:'per_ea',divisor:universalEaValue};
        } else {
          // Tier 5: standard weight / fallback → existing detection
          const _detectStr=packSize||subclass+' '+name;
          const _basis=detectPriceBasis(_detectStr,avgPiecePrice,unitPrice);
          const _ul=getUnitLabel(_detectStr,_basis);
          const _hasUp=_basis!=='per_kg'&&avgPiecePrice>0;
          _displayPrice=_hasUp?avgPiecePrice:unitPrice;
          _displayUnit=_hasUp?_ul:'กก.';
          _q6bFactor={type:'per_kg',divisor:1};
        }
        // Guard: if conversion produced 0 or nonsense, fall back to unit_price/กก.
        if(!_displayPrice||_displayPrice<=0){_displayPrice=unitPrice;_displayUnit='กก.';_q6bFactor={type:'per_kg',divisor:1};}
        // ───────────────────────────────────────────────────────────────────
        return{aid,mo,row:{
          id:itemId,n:name,d:dept,subclass,temperature:temp,pack_size:packSize,
          gmv,s:gmv,p:pct,qty_kg:qtyKg,unit_price:unitPrice,u:unitPrice,q:qtyKg,
          order_count:orderCount,avg_piece_price:avgPiecePrice,outlet_count_sku:outletCountSku,
          display_price:_displayPrice,display_unit:_displayUnit,
          range_kg_max:_rangeKgMax||null,
          ea_unit_value:universalEaValue||null,
          q6b_factor:_q6bFactor,
          // legacy compat: keep q6b_ea_divide for any code still reading it
          q6b_ea_divide: _q6bFactor&&_q6bFactor.type==='per_ea'&&_q6bFactor.divisor>1
        }};
      }

      // ── Pass 1: parse current account first → render portfolio immediately ──
      const pri=currentAccountId||'';
      const remaining=[];
      if(pri){
        lines.forEach(l=>{
          const firstComma=l.indexOf(',');
          const lineAid=firstComma>0?l.substring(0,firstComma).replace(/"/g,'').trim():'';
          if(lineAid===pri){
            const r=_parseSKULine(l);
            if(r){
              if(!bulkSkusData[r.aid])bulkSkusData[r.aid]={};
              if(!bulkSkusData[r.aid][r.mo])bulkSkusData[r.aid][r.mo]=[];
              if(!_bulkSkusSeen[r.aid])_bulkSkusSeen[r.aid]={};
              if(!_bulkSkusSeen[r.aid][r.mo])_bulkSkusSeen[r.aid][r.mo]=new Set();
              if(!_bulkSkusSeen[r.aid][r.mo].has(r.row.id)){_bulkSkusSeen[r.aid][r.mo].add(r.row.id);bulkSkusData[r.aid][r.mo].push(r.row);}
            }
          }else{remaining.push(l);}
        });
        // render portfolio immediately with current account data
        if(bulkSkusData[pri]){
          D.skus_monthly=bulkSkusData[pri];
          const _ms=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
          const mk=Object.keys(D.skus_monthly).sort((a,b)=>_ms(b)-_ms(a));
          D.skus=mk.length?D.skus_monthly[mk[0]]:[];fileStatus.skus=true;
          if(D.alts.length&&D.skus.length)computeOPPS();
          if(!_sgRunning&&!_bundlePreWarming){if(window.RenderBus)window.RenderBus.signal('skus');} // v223
        }
      }else{
        // no currentAccountId (TL view) — all lines go to remaining
        lines.forEach(l=>remaining.push(l));
      }

      // ── Pass 2: parse remaining accounts in idle chunks (500 rows/chunk) ──
      const CHUNK=500;
      let idx=0;
      const idle=typeof requestIdleCallback==='function'?requestIdleCallback:cb=>setTimeout(cb,0);
      let totalAccounts=Object.keys(bulkSkusData).length;

      function processChunk(deadline){
        const hasTime=()=>typeof deadline?.timeRemaining==='function'?deadline.timeRemaining()>2:true;
        while(idx<remaining.length&&hasTime()){
          const end=Math.min(idx+CHUNK,remaining.length);
          for(let i=idx;i<end;i++){
            const r=_parseSKULine(remaining[i]);
            if(r){
              if(!bulkSkusData[r.aid])bulkSkusData[r.aid]={};
              if(!bulkSkusData[r.aid][r.mo])bulkSkusData[r.aid][r.mo]=[];
              if(!_bulkSkusSeen[r.aid])_bulkSkusSeen[r.aid]={};
              if(!_bulkSkusSeen[r.aid][r.mo])_bulkSkusSeen[r.aid][r.mo]=new Set();
              if(!_bulkSkusSeen[r.aid][r.mo].has(r.row.id)){_bulkSkusSeen[r.aid][r.mo].add(r.row.id);bulkSkusData[r.aid][r.mo].push(r.row);}
            }
          }
          idx=end;
        }
        totalAccounts=Object.keys(bulkSkusData).length;
        if(idx<remaining.length){
          idle(processChunk);
        }else{
          // all done — refresh portview badges now that bulkSkusData is fully populated
          const b=document.getElementById('badge-bulk-skus');if(b){b.textContent='✓ '+totalAccounts;b.className='dp-slot-badge ok';}
          // toast removed v205a — bulk ingest noise
          if(!_bundlePreWarming){
            if(typeof _senseHydrateVisiblePortfolio==='function')_senseHydrateVisiblePortfolio('bulk-skus-ready',{delay:420});
            else {
              if(document.getElementById('scr-portview')?.classList.contains('on')&&typeof renderPortviewList==='function')renderPortviewList();
              if(document.getElementById('scr-teamview')?.classList.contains('on')&&typeof renderTeamviewKamList==='function')renderTeamviewKamList();
            }
          }
          _done();
        }
      }

      // kick off pass 2
      if(remaining.length>0){idle(processChunk);}
      else{
        const b=document.getElementById('badge-bulk-skus');if(b){b.textContent='✓ '+totalAccounts;b.className='dp-slot-badge ok';}
        // toast removed v205a — bulk ingest noise
        if(!_bundlePreWarming){
          if(document.getElementById('scr-portview')?.classList.contains('on')&&typeof renderPortviewList==='function')renderPortviewList();
          if(document.getElementById('scr-teamview')?.classList.contains('on')&&typeof renderTeamviewKamList==='function')renderTeamviewKamList();
        }
        _done();
      }
    };reader.readAsText(file);return;
  }
  if(type==='bulk-price'){
    // Q6B: 6-month price history (GMV ≥ 100) for sparkline historical range normalization
    // Priority parse: current account first → sparklines upgrade immediately
    // Then chunked idle parse for remaining accounts
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const totalLines=lines.length;
      const pri=currentAccountId||'';
      const remaining=[];

      // ── Pass 1: current account first ──
      if(pri){
        lines.forEach(l=>{
          const firstComma=l.indexOf(',');
          const lineAid=firstComma>0?l.substring(0,firstComma).replace(/"/g,'').trim():'';
          if(lineAid===pri){
            const p=parseCSVRow(l);
            const aid=(p[0]||'').trim();const mo=(p[1]||'').trim();const itemId=(p[2]||'').trim();
            const unitPrice=parseFloat(p[3])||0;const avgPiecePrice=parseFloat(p[4])||0;
            if(aid&&mo&&itemId&&(unitPrice||avgPiecePrice)){
              if(!bulkPriceData[aid])bulkPriceData[aid]={};
              if(!bulkPriceData[aid][itemId])bulkPriceData[aid][itemId]=[];
              bulkPriceData[aid][itemId].push({mo,unit_price:unitPrice,avg_piece_price:avgPiecePrice});
            }
          }else{remaining.push(l);}
        });
        if(bulkPriceData[pri]&&window.RenderBus)window.RenderBus.signal('price'); // v223
      }else{
        lines.forEach(l=>remaining.push(l));
      }

      // ── Pass 2: remaining in idle chunks ──
      const CHUNK=1000;
      let idx=0;
      const idle=typeof requestIdleCallback==='function'?requestIdleCallback:cb=>setTimeout(cb,0);

      function processChunk(deadline){
        const hasTime=()=>typeof deadline?.timeRemaining==='function'?deadline.timeRemaining()>2:true;
        while(idx<remaining.length&&hasTime()){
          const end=Math.min(idx+CHUNK,remaining.length);
          for(let i=idx;i<end;i++){
            const p=parseCSVRow(remaining[i]);
            const aid=(p[0]||'').trim();const mo=(p[1]||'').trim();const itemId=(p[2]||'').trim();
            const unitPrice=parseFloat(p[3])||0;const avgPiecePrice=parseFloat(p[4])||0;
            if(!aid||!mo||!itemId||(!unitPrice&&!avgPiecePrice))continue;
            if(!bulkPriceData[aid])bulkPriceData[aid]={};
            if(!bulkPriceData[aid][itemId])bulkPriceData[aid][itemId]=[];
            bulkPriceData[aid][itemId].push({mo,unit_price:unitPrice,avg_piece_price:avgPiecePrice});
          }
          idx=end;
        }
        if(idx<remaining.length){idle(processChunk);}
        else{
          const accounts=Object.keys(bulkPriceData).length;
          const b=document.getElementById('badge-bulk-price');if(b){b.textContent='✓ '+accounts;b.className='dp-slot-badge ok';}
          // toast removed v205b — bulk ingest noise
          _done();
        }
      }

      if(remaining.length>0){idle(processChunk);}
      else{
        const accounts=Object.keys(bulkPriceData).length;
        const b=document.getElementById('badge-bulk-price');if(b){b.textContent='✓ '+accounts;b.className='dp-slot-badge ok';}
        // toast removed v205b — bulk ingest noise
        _done();
      }
    };reader.readAsText(file);return;
  }
  if(type==='bulk-data'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const byAccount={};
      lines.forEach(l=>{
        const p=parseCSVRow(l);const aid=(p[0]||'').trim();const aname=(p[1]||'').trim();const mo=(p[2]||'').trim();const gmv=parseFloat(p[3])||0;const orders=parseInt(p[4])||0;
        if(!aid||!mo)return;if(!byAccount[aid])byAccount[aid]={name:aname,history:[]};byAccount[aid].history.push({m:mo,s:gmv,orders});
      });
      const count=Object.keys(byAccount).length;
      const idxRaw=JSON.parse(localStorage.getItem('ciq_index')||'[]');const idxMap=new Map(idxRaw.map(x=>[x.id,x]));
      Object.entries(byAccount).forEach(([aid,data])=>{
        bulkHistoryData[aid]=data.history;if(data.name)bulkAccountNames[aid]=data.name;
        if(idxMap.has(aid)){if(data.name)idxMap.get(aid).name=data.name;}
        else{idxMap.set(aid,{id:aid,name:data.name||'',ts:new Date().toISOString()});}
      });
      try{localStorage.setItem('ciq_index',JSON.stringify(Array.from(idxMap.values())));}catch(e){}
      if(currentAccountId&&bulkHistoryData[currentAccountId]){
        const _moSrtBD=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
        D.history=(bulkHistoryData[currentAccountId]||[]).slice().sort((a,b)=>_moSrtBD(a.m)-_moSrtBD(b.m));
        if(!D.meta.accountName&&bulkAccountNames[currentAccountId])D.meta.accountName=bulkAccountNames[currentAccountId];
        fileStatus.history=true;if(window.RenderBus)window.RenderBus.signal('history'); // v223
      }
      // History load summary log
      const _histMonths=new Set();
      Object.values(bulkHistoryData).forEach(arr=>(arr||[]).forEach(h=>{if(h.m)_histMonths.add(h.m);}));
      const _mo2=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      const _moS=m=>{const p=(m||'').split(' ');return(parseInt(p[1]||0)*12)+_mo2.indexOf(p[0]);};
      const _sortedHM=Array.from(_histMonths).sort((a,b)=>_moS(a)-_moS(b));
      const _latestHM=_sortedHM[_sortedHM.length-1]||'—';
      console.log('%c[Sense] history loaded','color:#4ddc97',
        {accounts:count, months:_sortedHM.length, latest_month:_latestHM,
         all_months:_sortedHM.join(', '),
         note:_latestHM==='พ.ค. 2569'?'⚠️ May in history — NRR gate will FAIL if current=May':'✓'});
      // toast removed v205b — bulk ingest noise
      const b=document.getElementById('badge-bulk-data');if(b){b.textContent='✓ '+count+' ร้าน';b.className='dp-slot-badge ok';}
      // Smart Splash: history = 80% progress; signal ready if portview also loaded
      if(typeof window._splashProgress==='function')
        window._splashProgress(80,'คำนวณ baseline 3 เดือน...');
      // v218: splash signal now fires from _fetchCloudflareFile when ALL 6 FOREGROUND files ready.
      // Old 3-file check removed — was causing early splash fade before categories/sku_current/outlets loaded.
      if(portviewBulkData&&portviewBulkData.length>0 && bulkHandoverData && Object.keys(bulkHandoverData.byAccountId||{}).length>0){
        // intentionally no-op — _fetchCloudflareFile owns _splashDataReady signal
      }
      _done();
    };reader.readAsText(file);return;
  }
  if(type==='portview-bulk'){
    const reader=new FileReader();
    reader.onload=e=>{
      portviewBulkData=parsePortviewBulk(e.target.result);
      const _pvSample=portviewBulkData.length?portviewBulkData[0].kamEmail:'(none)';
      _senseLog('%c[v206d debug] portviewBulkData ready:','color:#00d070',portviewBulkData.length,'accounts | sample kamEmail:',_pvSample);
      const _pvNonZero=portviewBulkData.filter(a=>a.gmvToDate>0).length;
      console.log('%c[Sense] portview loaded','color:#4ddc97',
        {accounts:portviewBulkData.length, gmv_to_date_nonzero:_pvNonZero,
         days_elapsed:(portviewBulkData[0]&&portviewBulkData[0].daysElapsed)||0,
         days_in_month:(portviewBulkData[0]&&portviewBulkData[0].daysInMonth)||0,
         warn:_pvNonZero===0?'⚠️ ALL gmv_to_date=0':'✓'});
      const b=document.getElementById('badge-portview-bulk');
      if(b){b.textContent=portviewBulkData.length?'✓ '+portviewBulkData.length+' ร้าน':'error';b.className='dp-slot-badge '+(portviewBulkData.length?'ok':'na');}
      const sl=document.getElementById('slot-portview-bulk');if(sl&&portviewBulkData.length)sl.style.borderColor='var(--g500)';
      const moNames=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      const _now=new Date();const _lagNow=new Date(_now);_lagNow.setDate(_lagNow.getDate()-1);const _curMonthLabel=moNames[_lagNow.getMonth()]+' '+(_lagNow.getFullYear()+543); // day-1 lag: label matches CSV data month
      const idxRaw=JSON.parse(localStorage.getItem('ciq_index')||'[]');const idxMap=new Map(idxRaw.map(x=>[x.id,x]));
      portviewBulkData.forEach(row=>{
        if(!row.id)return;
        bulkCurrentMonthData[row.id]={month_label:_curMonthLabel,gmv_to_date:row.gmvToDate||0,orders_to_date:row.ordersToDate||0,days_elapsed:row.daysElapsed||0,days_in_month:row.daysInMonth||0,runrate_gmv:row.runrate||0};
        if(row.name)bulkAccountNames[row.id]=row.name;if(row.kamName)bulkKamNames[row.id]=row.kamName;
        if(idxMap.has(row.id)){if(row.name)idxMap.get(row.id).name=row.name;}
        else{idxMap.set(row.id,{id:row.id,name:row.name||'',ts:new Date().toISOString()});}
      });
      try{localStorage.setItem('ciq_index',JSON.stringify(Array.from(idxMap.values())));}catch(e){}
      if(currentAccountId&&bulkCurrentMonthData[currentAccountId]){
        D.current_month=bulkCurrentMonthData[currentAccountId];
        if(!D.meta.accountName&&bulkAccountNames[currentAccountId])D.meta.accountName=bulkAccountNames[currentAccountId];
        fileStatus['current-month']=true;
        if(typeof updateKamSubtabVisibility==='function')updateKamSubtabVisibility();
        // v203: skip refreshAll if restaurant sheet is open — avoids D.current_month bleed when portview reloads mid-browse
        // v221b: debounced — portview ETag 200 re-ingest was causing a standalone visible re-render
        // v221b debounced, v223 through RenderBus
        if(window.RenderBus&&!document.body.classList.contains('restaurant-sheet'))window.RenderBus.signal('portview');
      }
      const atRisk=portviewBulkData.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')).length;
      const nb=document.getElementById('port-nav-badge');if(nb){nb.textContent=atRisk;nb.style.display=atRisk>0?'flex':'none';}
      if(_senseDebugOn())showToast('portview.csv โหลดแล้ว — '+portviewBulkData.length+' accounts','✓');
      // v205b: portviewBulkData now has tlEmail — re-render target bar so Case B can use real tlEmail
      // (init check at t=1500ms may have run before portview was ready → accounts=[] → Case B failed → baseline)
      if(typeof renderPortviewTargetBar==='function'){setTimeout(()=>renderPortviewTargetBar(),150);}
      // ── Smart Splash: drive progress bar (portview = 45%) ──────────────
      if(typeof window._splashProgress==='function')
        window._splashProgress(45,'คำนวณ baseline 3 เดือน...');
      // v218: splash signal now fires from _fetchCloudflareFile when ALL 6 FOREGROUND files ready.
      // Old 3-file check removed — was causing early splash fade before categories/sku_current loaded.
      if(Object.keys(bulkHistoryData).length>0 && bulkHandoverData && Object.keys(bulkHandoverData.byAccountId||{}).length>0){
        // intentionally no-op — _fetchCloudflareFile owns _splashDataReady signal
      }
      // ── Render: v223 RenderBus handles portview update when history arrives ──
      if(document.getElementById('scr-portview')?.classList.contains('on')){
        if(Object.keys(bulkHistoryData).length>0){
          if(window.RenderBus) window.RenderBus.signal('history_portview');
        }
      }
      _done();
    };reader.readAsText(file);return;
  }
  if(type==='bulk-sku-current'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const byAccount={};let totalRows=0;
      lines.forEach(l=>{
        const p=parseCSVRow(l);const aid=(p[0]||'').trim();const itemId=String((p[1]||'').trim());
        if(!aid||!itemId)return;
        const itemNameTh=(p[2]||'').trim();const orderCountMtd=parseInt(p[3])||0;const gmvMtd=parseFloat(p[4])||0;const lastOrderDate=(p[5]||'').trim();
        if(!byAccount[aid])byAccount[aid]=[];
        byAccount[aid].push({item_id:itemId,orders_this_month:orderCountMtd,gmv_to_date:gmvMtd,item_name_th:itemNameTh,last_order_date:lastOrderDate});
        totalRows++;
      });
      bulkSkuCurrentData=byAccount;const cnt=Object.keys(byAccount).length;
      const b=document.getElementById('badge-bulk-sku-current');if(b){b.textContent=cnt?'✓ '+cnt+' ร้าน':'error';b.className='dp-slot-badge '+(cnt?'ok':'na');}
      const sl=document.getElementById('slot-bulk-sku-current');if(sl&&cnt)sl.style.borderColor='var(--g500)';
      if(currentAccountId&&bulkSkuCurrentData[currentAccountId]){D.sku_current=bulkSkuCurrentData[currentAccountId];if(window.RenderBus)window.RenderBus.signal('sku_current');} // v223
      // toast removed v205a — bulk ingest noise
      if(typeof window._splashProgress==='function')window._splashProgress(55,'กำลังโหลด SKU ปัจจุบัน...');
      _done();
    };reader.readAsText(file);return;
  }
  if(type==='bulk-alternatives'){
    const reader=new FileReader();
    reader.onload=e=>{
      const result=processBulkAlternatives(e.target.result);
      const b=document.getElementById('badge-bulk-alternatives');if(b){b.textContent='✓ '+result.accounts+' ร้าน';b.className='dp-slot-badge ok';}
      const sl=document.getElementById('slot-bulk-alternatives');if(sl&&result.accounts)sl.style.borderColor='var(--g500)';
      if(currentAccountId&&result.accountIds.has(currentAccountId)){
        loadFromStorage(currentAccountId);if(D.alts.length&&D.skus.length)computeOPPS();
        // v191: alternatives are the core Sense data — new alternatives = new scan needed
        // v199b: skip reset+refreshAll when _sgRunning=true (gate is lazy-loading this file)
        //        to prevent gate dismissal mid-load; reset only on manual/background reload
        if(!_sgRunning&&!_bundlePreWarming){
          senseActivated=false;_sgRunning=false;
          if(window.RenderBus)window.RenderBus.signal('alternatives');updateDataStatus();if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus(); // v223
        }
      }
      // toast removed v205a — bulk ingest noise
      _done();
    };reader.readAsText(file);return;
  }
  if(type==='bulk-outlets'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const byAccount={};
      lines.forEach(l=>{
        const p=parseCSVRow(l);const aid=(p[0]||'').trim();const mo=(p[1]||'').trim();const outletId=(p[2]||'').trim();const outletName=(p[3]||'').trim();
        const gmv=parseFloat(p[4])||0;const orders=parseInt(p[5])||0;const shipping=parseFloat(p[6])||0;const timeslot=parseFloat(p[7])||0;
        const lastOrderDate=(p[8]||'').trim()||null; // Q5B v2: last_order_date (YYYY-MM-DD), null if old format
        if(!aid||!mo||!outletId||!gmv)return;
        if(!byAccount[aid])byAccount[aid]={};if(!byAccount[aid][mo])byAccount[aid][mo]=[];
        byAccount[aid][mo].push({outlet_id:outletId,outlet_name:outletName,gmv,orders,shipping,timeslot,lastOrderDate});
      });
      Object.entries(byAccount).forEach(([aid,months])=>{bulkOutletsData[aid]=months;});
      const cnt=Object.keys(byAccount).length;
      const b=document.getElementById('badge-bulk-outlets');if(b){b.textContent='✓ '+cnt+' ร้าน';b.className='dp-slot-badge ok';}
      const sl=document.getElementById('slot-bulk-outlets');if(sl&&cnt)sl.style.borderColor='var(--g500)';
      if(currentAccountId&&bulkOutletsData[currentAccountId]){
        D.outlets_monthly=bulkOutletsData[currentAccountId];fileStatus.outlets=true;
        const moKeys=Object.keys(D.outlets_monthly).sort((a,b)=>{const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];const pa=a.split(' '),pb=b.split(' ');return((parseInt(pb[1]||0)*12)+mo.indexOf(pb[0]))-((parseInt(pa[1]||0)*12)+mo.indexOf(pa[0]));});
        D_outlets=(D.outlets_monthly[moKeys[0]]||[]).map(o=>({...o}));
        renderOutletCard();debouncedSave();
      }
      // toast removed v205b — bulk ingest noise
      if(typeof window._splashProgress==='function')window._splashProgress(65,'กำลังโหลด outlet...');
      _done();
    };reader.readAsText(file);return;
  }
  // Unknown type — ignore silently
  
  // ── bulk-current-movements (Q11: portview_current_movements.csv) ──
  // Source for Portview movement cards: new_sales, transfer_in, sales_to_kam, transfer_out
  // Non-critical: Portview shows graceful fallback if not loaded
  if(type==='bulk-current-movements'){
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
        const byAccountId={},byMovementType={},byKamName={},byKamEmail={},rows=[];
        lines.forEach(l=>{
          const p=parseCSVRow(l);
          const movementMonth=(p[0]||'').trim();
          const movementType=(p[1]||'').trim();
          const userId=(p[2]||'').trim();
          const accountId=String(p[3]==null?'':p[3]).trim();
          const accountName=(p[4]||'').trim();
          const accountType=(p[5]||'').trim();
          const kamName=(p[6]||'').trim();
          const kamEmail=(p[7]||'').trim();
          const ownerFromType=(p[8]||'').trim();
          const ownerFromName=(p[9]||'').trim();
          const baselineGmv=parseFloat(p[12])||0;
          const currentGmv=parseFloat(p[13])||0;
          const confidence=(p[18]||'').trim();
          if(!movementType||!accountId) return;
          const row={movementMonth,movementType,userId,accountId,accountName,accountType,
                     kamName,kamEmail,ownerFromType,ownerFromName,baselineGmv,currentGmv,confidence};
          rows.push(row);
          // v252: transfer_in wins — account ที่มีทั้ง transfer_in และ transfer_out outlet
          // ให้ classify เป็น transfer_in เสมอ (รับเข้ามาแล้ว บางส่วนออกไปก็ยังนับว่า transfer_in)
          if(!byAccountId[accountId] || row.movementType==='transfer_in'){byAccountId[accountId]=row;}
          if(!byMovementType[movementType])byMovementType[movementType]=[];
          byMovementType[movementType].push(row);
          if(kamName){if(!byKamName[kamName])byKamName[kamName]=[];byKamName[kamName].push(row);}
          if(kamEmail){if(!byKamEmail[kamEmail])byKamEmail[kamEmail]=[];byKamEmail[kamEmail].push(row);}
        });
        window.bulkCurrentMovementData={rows,byAccountId,byMovementType,byKamName,byKamEmail,
                                        loadedAt:Date.now()};
        const b2=document.getElementById('badge-current_movements');
        if(b2){b2.textContent='✓ '+rows.length+' rows';b2.className='dp-slot-badge ok';}
        const sl2=document.getElementById('slot-current_movements');
        if(sl2)sl2.style.borderColor='var(--g500)';
        const _mvSummary=Object.entries(byMovementType).map(([t,r])=>t+'='+r.length).join(', ');
        console.log('%c[Sense] movements loaded','color:#4ddc97',{total:rows.length, breakdown:_mvSummary,
          transfer_in:(byMovementType.transfer_in||[]).length, new_sales:(byMovementType.new_sales||[]).length,
          sales_to_kam:(byMovementType.sales_to_kam||[]).length});
        // v259: signal RenderBus so NRR cohort split re-classifies with movement data
        if(window.RenderBus) window.RenderBus.signal('current_movements');
        else try{if(typeof _scheduleRefreshAll==='function')_scheduleRefreshAll(200);}catch(e){}
      }catch(err){console.warn('[Freshket Sense] current_movements parse failed',err);}
      _done();
    };reader.readAsText(file);return;
  }
  // ── bulk-handover (Q10: portview_handover.csv) ──
  if(type==='bulk-handover'){
    const reader=new FileReader();
    reader.onload=e=>{
      const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
      const byAccountId={};
      const byKamName={};
      const byNewKamName={}; // commission: index by receiving KAM for Handover retention calc
      lines.forEach(l=>{
        const p=parseCSVRow(l);
        const kamName=(p[0]||'').trim();
        const accountId=(p[1]||'').trim();
        const accountName=(p[2]||'').trim();
        const accountType=(p[3]||'').trim();
        const lastMonthGmv=parseFloat(p[4])||0;
        const curMonthGmv=parseFloat(p[5])||0;
        const newOwnerType=(p[6]||'').trim();
        const newKamName=(p[7]||'').trim();
        if(!kamName||!accountId)return;
        byAccountId[accountId]={kamName,accountName,accountType,lastMonthGmv,curMonthGmv,newOwnerType,newKamName};
        if(!byKamName[kamName])byKamName[kamName]=[];
        byKamName[kamName].push({accountId,accountName,accountType,lastMonthGmv,curMonthGmv,newOwnerType,newKamName});
        // index by NEW KAM name (receiving) for Handover commission
        if(newKamName){
          if(!byNewKamName[newKamName])byNewKamName[newKamName]=[];
          byNewKamName[newKamName].push({accountId,accountName,accountType,lastMonthGmv,curMonthGmv,oldKamName:kamName});
        }
      });
      bulkHandoverData={byAccountId,byKamName,byNewKamName};
      console.log('%c[Sense] handover loaded','color:#4ddc97',{accounts:Object.keys(byAccountId).length,
        kams:Object.keys(byKamName).length});
      const cnt=Object.keys(byKamName).length;
      const b=document.getElementById('badge-bulk-handover');
      if(b){b.textContent='✓ '+Object.keys(byAccountId).length+' accts';b.className='dp-slot-badge ok';}
      const sl=document.getElementById('slot-bulk-handover');if(sl)sl.style.borderColor='var(--g500)';
      // v218: splash signal now fires from _fetchCloudflareFile when ALL 6 FOREGROUND files ready.
      // Old 3-file check removed — was causing early splash fade before categories/sku_current/outlets loaded.
      try{
        if(portviewBulkData && portviewBulkData.length>0 && Object.keys(bulkHistoryData).length>0){
          // intentionally no-op — _fetchCloudflareFile owns _splashDataReady signal
        }
      }catch(e){}
      // toast removed v205b — bulk ingest noise
      _done();
    };
    reader.readAsText(file);return;
  }
  // ── bulk-upsell-team (sense_upsell_team.csv) ──
  // Tiny foreground file: pre-computed P1/P3 totals per KAM for TL multiplier
  // Columns: kam_email, p1_gmv, p3_incremental, outlet_gmv, tl_upsell_base
  if(type==='bulk-upsell-team'){
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
        const team={};
        lines.forEach(l=>{
          const p=parseCSVRow(l);
          const kamEmail=(p[0]||'').trim();
          if(!kamEmail)return;
          team[kamEmail]={
            p1_gmv:      parseFloat(p[1])||0,
            p3_incr:     parseFloat(p[2])||0,
            outlet_gmv:  parseFloat(p[3])||0,
            tl_upsell_base: parseFloat(p[4])||0
          };
        });
        bulkUpsellTeamData=team;
        const cnt=Object.keys(team).length;
        const b=document.getElementById('badge-bulk-upsell-team');
        if(b){b.textContent='✓ '+cnt+' KAMs';b.className='dp-slot-badge ok';}
        // TL multiplier card — only render directly if splash is already gone
        // (if splash active, RenderBus will fire one consolidated render after doFade)
        try{ if(typeof renderTeamview==='function' && !window._senseSplashActive)renderTeamview(); }catch(e){}
      }catch(err){
        console.warn('[Q3C team] parse error',err);
        bulkUpsellTeamData={};
      }
      _done();
    };
    reader.readAsText(file);return;
  }

  // ── bulk-upsell-kam (sense_upsell_{safekey}.csv) ──
  // Per-KAM demand bundle: same 8-column structure, single KAM only
  // ── bulk-upsell (Q3C: sense_upsell_bulk.csv) ──  [legacy, not used in Option B]
  // Grain: kam_email × account_id × month_label × group_key
  // Columns: kam_email, account_id, month_label, group_key,
  //          existing_gmv, new_gmv, comeback_gmv, total_gmv
  // All GMV values = raw actual (no 30d projection) — JS normalizes at compute time
  if(type==='bulk-upsell'){
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const lines=e.target.result.trim().split('\n').slice(1).filter(l=>l.trim());
        // Build two indexes in one pass:
        //   byKam[kamEmail][accountId][group_key][month_label] = {existing_gmv,total_gmv}
        //   baselineGroups[kamEmail][accountId][outletId] = Set<groupKey> (v2: outlet-level, 3-month lookback)
        // v4: 7-col format (new_gmv + comeback_gmv removed — not used by commission engine)
        const byKam={};
        const baselineGroups={};
        const _now=new Date();const _lagU=new Date(_now);_lagU.setDate(_lagU.getDate()-1); // day-1 lag anchor
        const _thMonths=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        const _baselineLabel=_thMonths[new Date(_lagU.getFullYear(),_lagU.getMonth()-1,1).getMonth()]+' '+(new Date(_lagU.getFullYear(),_lagU.getMonth()-1,1).getFullYear()+543);
        // v2: current month label — any row NOT current month = lookback → baseline
        const _currLabel=_thMonths[_lagU.getMonth()]+' '+(_lagU.getFullYear()+543);
        // v233-fix: P1 baseline = exactly 3 months (M-1, M-2, M-3) matching P3 window.
        // Bug: previously used ALL non-current months → ม.ค. (4 months ago) was included
        // → outlet that bought in ม.ค. then stopped 3 months was wrongly classified as existing.
        const _p1BaselineLabels=new Set([1,2,3].map(i=>{const d=new Date(_lagU.getFullYear(),_lagU.getMonth()-i,1);return _thMonths[d.getMonth()]+' '+(d.getFullYear()+543);}));
        // v4: detect CSV format — 7 cols = v4 (outlet_id + no new/comeback), 9 cols = v3, 8 cols = legacy
        const _sampleCols=(lines[0]||'').split(',').length;
        const _hasOutlet=_sampleCols>=7;
        let rowCount=0;
        // v259: per-KAM bundle CSV has NO kam_email column
        // Format: account_id, outlet_id, month_label, group_key, existing_gmv, total_gmv
        // _upsellIngestEmail is set by _fetchUpsellBundle before calling ingestCSVText
        const _bundleEmail = (window._upsellIngestEmail||'').trim();
        // Detect if first column is email (legacy bulk) or UUID (per-KAM bundle)
        const _firstColIsEmail = !_bundleEmail || ((lines[0]||'').split(',')[0]||'').includes('@');
        lines.forEach(l=>{
          const p=parseCSVRow(l);
          let kamEmail, accountId, outletId, monthLabel, groupKey, existingGmv, totalGmv;
          if(_firstColIsEmail){
            // Legacy bulk format: kam_email, account_id, outlet_id, month_label, group_key, existing_gmv, total_gmv
            kamEmail=(p[0]||'').trim();
            accountId=(p[1]||'').trim();
            if(_hasOutlet && _sampleCols<=7){outletId=(p[2]||'').trim();monthLabel=(p[3]||'').trim();groupKey=(p[4]||'').trim();existingGmv=parseFloat(p[5])||0;totalGmv=parseFloat(p[6])||0;}
            else if(_hasOutlet){outletId=(p[2]||'').trim();monthLabel=(p[3]||'').trim();groupKey=(p[4]||'').trim();existingGmv=parseFloat(p[5])||0;totalGmv=parseFloat(p[8])||0;}
            else{outletId='_all';monthLabel=(p[2]||'').trim();groupKey=(p[3]||'').trim();existingGmv=parseFloat(p[4])||0;totalGmv=parseFloat(p[7])||0;}
          } else {
            // Per-KAM bundle: account_id, outlet_id, month_label, group_key, existing_gmv, total_gmv
            kamEmail=_bundleEmail;
            accountId=(p[0]||'').trim();
            outletId=(p[1]||'').trim();
            monthLabel=(p[2]||'').trim();
            groupKey=(p[3]||'').trim();
            existingGmv=parseFloat(p[4])||0;
            totalGmv=parseFloat(p[5])||0;
          }
          if(!kamEmail||!accountId||!monthLabel||!groupKey)return;
          // byKam: kamEmail → accountId → outletId → groupKey → monthLabel
          if(!byKam[kamEmail])byKam[kamEmail]={};
          if(!byKam[kamEmail][accountId])byKam[kamEmail][accountId]={};
          if(!byKam[kamEmail][accountId][outletId])byKam[kamEmail][accountId][outletId]={};
          if(!byKam[kamEmail][accountId][outletId][groupKey])byKam[kamEmail][accountId][outletId][groupKey]={};
          byKam[kamEmail][accountId][outletId][groupKey][monthLabel]={existingGmv,totalGmv};
          // v233-fix: only months within 3-month window qualify as P1 baseline
          if(monthLabel!==_currLabel && totalGmv>0 && _p1BaselineLabels.has(monthLabel)){
            if(!baselineGroups[kamEmail])baselineGroups[kamEmail]={};
            if(!baselineGroups[kamEmail][accountId])baselineGroups[kamEmail][accountId]={};
            if(!baselineGroups[kamEmail][accountId][outletId])baselineGroups[kamEmail][accountId][outletId]=new Set();
            baselineGroups[kamEmail][accountId][outletId].add(groupKey);
          }
          rowCount++;
        });
        bulkUpsellData={byKam,baselineGroups,loaded:true,baselineLabel:_baselineLabel};
        const kamCount=Object.keys(byKam).length;
        const b=document.getElementById('badge-bulk-upsell-kam');
        if(b){b.textContent='✓ '+kamCount+' KAMs / '+rowCount+' rows';b.className='dp-slot-badge ok';}
        const sl=document.getElementById('slot-bulk-upsell-kam');if(sl)sl.style.borderColor='var(--g500)';
        // Clear loading state cache so strip re-renders with real values
        try{ var _s=document.getElementById('pv-commission-strip'); if(_s) _s._lastCommHtml=''; }catch(e){}
        // Trigger commission strip re-render now that upsell data is available
        try{ if(typeof _commRenderKamSelfStrip==='function') _commRenderKamSelfStrip(); }catch(e){}
      }catch(err){
        console.warn('[Q3C] parse error',err);
        bulkUpsellData={byKam:{},baselineGroups:{},loaded:false};
      }
      _done();
    };
    reader.readAsText(file);return;
  }
  _done();
}

// SECTION:DATA_LOADER
function applyMeta(){
  const name=D.meta.accountName||'';
  const el=document.getElementById('h-acct-name');if(el)el.textContent=name||'ร้านอาหารของคุณ';
  const rn=document.getElementById('rpt-acct-name');if(rn)rn.textContent=name||'ร้านอาหารของคุณ';
  const inp=document.getElementById('acct-name-input');if(inp&&name)inp.value=name;
  const hid=document.getElementById('hid');
  if(hid)hid.textContent=[D.meta.accountId?'Account '+D.meta.accountId.slice(0,8):'',D.meta.kamName?'KAM: '+D.meta.kamName:''].filter(Boolean).join(' · ');
}

// ════════════════════════════════════════
// CLOUDFLARE R2 DATA LOADER
// ════════════════════════════════════════
// ════════════════════════════════════════
// LEGACY SHEETS CONFIG (kept for backward compatibility; R2 is current source)
// ── no longer used by Cloudflare loader ──
// ════════════════════════════════════════
const FRESHKET_SHEETS_ID     = (FRESHKET_APP_CONFIG.legacySheets && FRESHKET_APP_CONFIG.legacySheets.accountWorkbookId) || '2PACX-1vRQyqbsY1hB0iTpoeqReg3079_HpQLO59T4zF0d1OZR2Tb4KQVIb7wbkbiSyQld_3EAcEmXOcD4HLEQ';
const FRESHKET_SHEETS_SKU_ID = (FRESHKET_APP_CONFIG.legacySheets && FRESHKET_APP_CONFIG.legacySheets.skuWorkbookId) || '2PACX-1vTnQjbsX-Ff-bv2lCdqY8r6oFbTjBlwV3GPd9QJ9ngqWvi77RW8GUtUTzrmRiF87LhL3zFLPtgd4-ZV';
const CLAUDE_API_KEY = ''; // Phase 2: no production AI secret in browser. Use AI proxy.
// ── OLIVE AVATAR ──────────────────────────────────────
// Paste your Supabase public image URL here.
// Leave empty ('') to keep the default star icon.
const OLIVE_AVATAR_URL=(FRESHKET_APP_CONFIG.assets && FRESHKET_APP_CONFIG.assets.oliveAvatarUrl) || 'https://menslbnyyvpxiyvjywcm.supabase.co/storage/v1/object/public/assets/olive-avatar.png';

// Thin wrapper: CSV text → File → existing handleFileUpload (no parse logic duplication)
// v148: Promise-based with timeout/fail-safe so Sense gates never wait forever.
function ingestCSVText(type,text,{timeoutMs=120000}={}){
  return new Promise(resolve=>{
    let settled=false;
    const finish=(ok)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(!!ok);};
    const timer=setTimeout(()=>{
      console.warn('[Cloudflare ingest timeout]',type);
      finish(false);
    },timeoutMs);
    try{
      const blob=new Blob([text],{type:'text/csv'});
      const file=new File([blob],type+'.csv',{type:'text/csv'});
      handleFileUpload(type,{files:[file],_ciqDone:()=>finish(true)});
    }catch(e){console.warn('[Cloudflare ingest]',type,e);finish(false);}
  });
}

// Background fetch flags — true once big files arrive
let bulkSkusReady = false;
let bulkAltsReady = false;
let sheetsLoadStarted = false; // guard: prevent double-fetch if login completes after prefetch
let _cloudInitialPromise = null;
let _cloudBackgroundPromise = null;
let _cloudLoadToken = 0;
const _kamBundleLoaded = new Set();   // v202: safeEmail → bundle fully loaded to memory
let _bundlePreWarming = false;         // v225: always false — suppress flag removed (never set to true)
const _kamBundleInFlight = {};        // v202: safeEmail → Promise (dedup concurrent fetches)

// v206d: performance guardrails for mobile/PWA.
// Default console is quiet; turn on with localStorage.setItem('senseDebug','1').
function _senseDebugOn(){
  try{return localStorage.getItem('senseDebug')==='1'||localStorage.getItem('freshket_debug')==='1';}catch(e){return false;}
}
function _senseLog(){try{if(_senseDebugOn())console.log.apply(console,arguments);}catch(e){}}
function _senseInfo(){try{if(_senseDebugOn())console.info.apply(console,arguments);}catch(e){}}
function _senseSleep(ms){return new Promise(r=>setTimeout(r,ms));}
let _senseUserActiveUntil=0;
let _tlPrewarmTimer=null;
let _tlPrewarmRunId=0;
function _senseMarkUserActive(){_senseUserActiveUntil=Date.now()+1800;}
function _senseIsUserActive(){return Date.now()<_senseUserActiveUntil;}
try{
  ['scroll','touchstart','pointerdown','keydown','input'].forEach(evt=>{
    window.addEventListener(evt,_senseMarkUserActive,{passive:true,capture:true});
  });
}catch(e){}
function _senseGetTlPrewarmEmails(maxCount){
  maxCount=maxCount||5;
  const role=(currentUserProfile&&currentUserProfile.role)||'rep';
  if(role!=='tl'&&role!=='admin')return[];
  const myEmail=(currentUserProfile&&currentUserProfile.email)||'';
  let rows=(portviewBulkData||[]).filter(r=>r&&r.kamEmail);
  if(myEmail&&rows.some(r=>r.tlEmail===myEmail))rows=rows.filter(r=>r.tlEmail===myEmail);
  const agg={};
  rows.forEach(r=>{
    const email=r.kamEmail;if(!email)return;
    const safe=_kamSafeKey(email);
    if(_kamBundleLoaded.has(safe)||_kamBundleInFlight[safe])return;
    if(!agg[email])agg[email]={email,gmv:0,n:0};
    const ps=r.paceSignal||{};
    agg[email].gmv+=Number(ps.runrate||r.runrate||r.gmvToDate||0);
    agg[email].n++;
  });
  return Object.values(agg).sort((a,b)=>b.gmv-a.gmv||b.n-a.n).slice(0,maxCount).map(x=>x.email);
}
function _startTlBundlePrewarm(){
  const role=(currentUserProfile&&currentUserProfile.role)||'rep';
  if(role!=='tl'&&role!=='admin')return;
  if(_tlPrewarmTimer)clearTimeout(_tlPrewarmTimer);
  const runId=++_tlPrewarmRunId;
  _tlPrewarmTimer=setTimeout(async()=>{
    const emails=_senseGetTlPrewarmEmails(8);
    if(!emails.length)return;
    _senseLog('%c[v225d bundle] TL prewarm:', 'color:#00d070', emails.length, 'KAMs', emails);
    // v225d: restore _bundlePreWarming=true during prewarm to suppress Path 1/2 internal renders.
    // Without this flag, _fetchKamBundle completion and ingestCSVText bulk-skus both fire
    // direct renderPortviewList/renderTeamviewKamList calls per bundle → N renders during prewarm.
    // Flag suppresses those; single RenderBus signal at end gives exactly 1 render.
    _bundlePreWarming=true;
    for(const e of emails){
      if(runId!==_tlPrewarmRunId)break;
      await _fetchKamBundle(e).catch(()=>{});
      await _senseSleep(200);
    }
    _bundlePreWarming=false;
    if(runId!==_tlPrewarmRunId)return;
    try{ if(window.RenderBus) window.RenderBus.signal('bundle:prewarm-complete'); }catch(_){}
    _senseLog('%c[v225d bundle] TL prewarm complete — 1 render signal','color:#00d070');
  },2000);
}

// ── CSV Cache (IndexedDB, TTL 6h) — foreground files only ──
const _CSV_DB=(FRESHKET_APP_CONFIG.storage && FRESHKET_APP_CONFIG.storage.csvDbName) || 'ciq-csv-v1';
const _CSV_TTL=(FRESHKET_APP_CONFIG.storage && FRESHKET_APP_CONFIG.storage.csvCacheTtlMs) || 6*60*60*1000; // 6 hours
function _csvOpen(){return window.FreshketSenseRuntime.data.csvOpen();}
async function _csvCacheGet(tab){return window.FreshketSenseRuntime.data.csvCacheGet(tab);}
async function _csvCacheSet(tab,text,etag){return window.FreshketSenseRuntime.data.csvCacheSet(tab,text,etag);}
async function _csvCacheClear(){return window.FreshketSenseRuntime.data.csvCacheClear();}

// R2 file map — Cloudflare R2 bucket (freshket-data)
const R2_BASE=(FRESHKET_APP_CONFIG.data && FRESHKET_APP_CONFIG.data.r2Base) || 'https://pub-12078d17646340808024e8cc95504995.r2.dev';
const R2_FILES=(FRESHKET_APP_CONFIG.data && FRESHKET_APP_CONFIG.data.r2Files) || {portview:'portview.csv',history:'bulk_history.csv',categories:'bulk_categories.csv',sku_current:'bulk_sku_current.csv',outlets:'bulk_outlets.csv',skus:'bulk_skus.csv',alternatives:'bulk_alternatives.csv',price:'bulk_price.csv',handover:'portview_handover.csv',upsell_team:'sense_upsell_team.csv',current_movements:'portview_current_movements.csv'};
const R2_SPECS=(FRESHKET_APP_CONFIG.data && FRESHKET_APP_CONFIG.data.r2Specs) || {
  // Foreground 5 files are intentionally cached: small enough and needed at app start.
  portview:{type:'portview-bulk',tab:'portview',cache:false}, // Level 3: always fetch — changes daily
  history:{type:'bulk-data',tab:'history',cache:true},
  categories:{type:'bulk-categories',tab:'categories',cache:true},
  sku_current:{type:'bulk-sku-current',tab:'sku_current',cache:true},
  outlets:{type:'bulk-outlets',tab:'outlets',cache:true},
  // Heavy files stay session-memory only to avoid iOS IndexedDB/raw-text duplication.
  skus:{type:'bulk-skus',tab:'skus',cache:false,heavy:true},
  alternatives:{type:'bulk-alternatives',tab:'alternatives',cache:false,heavy:true},
  // Price history for sparkline Y-axis normalization (6 months, GMV ≥ 100, 5 cols)
  price:{type:'bulk-price',tab:'price',cache:false,heavy:false},
  // Q10: transfer-out per KAM
  handover:{type:'bulk-handover',tab:'handover',cache:true},
  current_movements:{type:'bulk-current-movements',tab:'current_movements',cache:true},
  // Q3C team summary: pre-computed P1/P3 totals per KAM for TL multiplier
  upsell_team:{type:'bulk-upsell-team',tab:'upsell_team',cache:true},
};
const _cloudLoadedTabs=new Set();
const _cloudInFlight={};
let _dataPillTimers=[];

function _clearDataPillTimers(){return window.FreshketSenseRuntime.data.clearPillTimers();}
function _clearCloudInFlight(){Object.keys(_cloudInFlight).forEach(k=>delete _cloudInFlight[k]);}
function _specFetchTimeout(spec){return spec&&spec.heavy?240000:90000;}
function _specIngestTimeout(spec){return spec&&spec.heavy?240000:90000;}

function _resetDataPill(){return window.FreshketSenseRuntime.data.resetDataPill();}
function _setDataPillText(text,count){return window.FreshketSenseRuntime.data.setDataPillText(text,count);}
function _finishDataPill(text,hideMs=1200){return window.FreshketSenseRuntime.data.finishDataPill(text,hideMs);}

async function _fetchTextWithTimeout(url,timeoutMs){return window.FreshketSenseRuntime.data.fetchTextWithTimeout(url,timeoutMs);}

async function _fetchCloudflareFile(spec,{force=false,cacheOverride}={}){
  if(!spec||!spec.tab)return false;
  const tab=spec.tab;
  if(!force&&_cloudLoadedTabs.has(tab))return true;
  if(!force&&_cloudInFlight[tab])return _cloudInFlight[tab];
  const p=(async()=>{
    const _ft0=performance.now(); // v218b timing
    let _src='R2-full';           // v218b: track data source for debug log
    const dot=document.getElementById('sp-'+tab);
    if(dot)dot.style.background='rgba(38,96,200,.12)';
    try{
      let text=null;
      const useCache=(cacheOverride!==undefined)?cacheOverride:!!spec.cache;
      if(useCache){
        const cached=await _csvCacheGet(tab);
        if(cached&&cached.ts&&(Date.now()-cached.ts)<_CSV_TTL){
          // v205c: Conditional GET (ETag-based) — replaces HEAD+GET double-trip
          // R2 returns 304 Not Modified if file unchanged → use cache; 200 → fresh data
          try{
            const _url=`${R2_BASE}/${R2_FILES[tab]||tab+'.csv'}`;
            const _res=await window.FreshketSenseRuntime.data.fetchWithEtag(_url,cached.etag||null,_specFetchTimeout(spec));
            if(_res.notModified){
              _src='IDB→ETag304'; // v218b: cache hit, unchanged
              text=cached.text;  // 304: file unchanged, extend cache life
              _csvCacheSet(tab,text,_res.etag);
              // v221c: 304 + already in memory = skip re-ingest entirely → no callback → no render
              if(_cloudLoadedTabs.has(tab)){
                _senseDataLog(tab,'⚡ 304 skip-reingest — data current, no render needed');
                if(dot){dot.style.background='rgba(0,208,112,.18)';dot.style.color='var(--g700)';} // mark done
                return true;
              }
            } else if(_res.text){
              _src='IDB→ETag200(UPDATED)'; // v218b: cache hit, server has new data
              text=_res.text;    // 200: new file → store below with new ETag
              _csvCacheSet(tab,text,_res.etag);
            }
            // else: fetch threw → fall through to re-fetch (handled by catch below)
          }catch(e){
            // Network error: use cache as offline fallback (better than nothing)
            _src='IDB-offline-fallback'; // v218b
            if(cached.text){text=cached.text;console.warn('[cache] conditional GET failed, using cache:',tab,e&&e.message);}
          }
        } else {
          _src=cached?'IDB-expired→R2':'IDB-miss→R2'; // v218b
        }
      }
      if(!text){
        const url=`${R2_BASE}/${R2_FILES[tab]||tab+'.csv'}`;
        const _fr=await window.FreshketSenseRuntime.data.fetchWithEtag(url,null,_specFetchTimeout(spec)).catch(async()=>{
          // fetchWithEtag failed → fallback to plain fetch (handles edge cases)
          const t=await _fetchTextWithTimeout(url,_specFetchTimeout(spec));
          return{text:t,etag:null,notModified:false};
        });
        text=_fr.text;
        // Cache only the lightweight/core CSVs. Heavy files are intentionally not cached.
        if(useCache&&text)_csvCacheSet(tab,text,_fr.etag);
      }
      const ok=await ingestCSVText(spec.type,text,{timeoutMs:_specIngestTimeout(spec)});
      if(ok){
        _cloudLoadedTabs.add(tab);
        if(tab==='skus')bulkSkusReady=true;
        if(tab==='alternatives')bulkAltsReady=true;
        if(dot){dot.style.background='rgba(0,208,112,.18)';dot.style.color='var(--g700)';}
        // v218b: log file completion — source tells you IndexedDB vs R2, ETag 304 vs 200
        _senseDataLog(tab,'✅',_src,(text?Math.round(text.length/1024):0)+'KB',Math.round(performance.now()-_ft0)+'ms');
        // v218a DATA GATE: when portview+history+handover all complete, fire ONE consolidated render.
        // categories/sku_current/outlets are background files — their arrival doesn't need to
        // block the portfolio render or hold the splash.
        try{
          if(_cloudLoadedTabs.has('portview') &&
             _cloudLoadedTabs.has('history') &&
             _cloudLoadedTabs.has('handover')){
            // Signal splash to start fading (critical data ready)
            if(typeof window._splashDataReady==='function') window._splashDataReady();
            _senseDataLog('🚪 GATE ✅','portview+history+handover ready → splash fade');
            // v223: route through RenderBus instead of direct setTimeout(refreshAll)
            if(window.RenderBus){ window.RenderBus.signal(tab); }
            else if(window._pendingRefreshAll){
              window._pendingRefreshAll=false;
              setTimeout(function(){if(typeof refreshAll==='function')refreshAll();},30);
            }
          } else {
            // Non-critical file — signal RenderBus; it'll fire after critical gate opens
            if(window.RenderBus) window.RenderBus.signal(tab);
          }
        }catch(e){}
      }else{
        if(dot){dot.style.background='rgba(240,80,0,.12)';dot.style.color='var(--org)';}
        _senseDataLog(tab,'❌ INGEST FAILED — check R2 file format'); // v218b
      }
      return !!ok;
    }catch(err){
      if(dot){dot.style.background='rgba(240,80,0,.12)';dot.style.color='var(--org)';}
      console.warn('[Cloudflare R2]',tab,err&&err.message?err.message:err);
      return false;
    }finally{
      delete _cloudInFlight[tab];
    }
  })();
  _cloudInFlight[tab]=p;
  return p;
}

async function ensureCloudflareFiles(keys,{label='กำลังโหลดข้อมูล',force=false}={}){
  const specs=keys.map(k=>R2_SPECS[k]).filter(Boolean);
  if(!specs.length)return true;
  let done=0;
  _setDataPillText(label,'0/'+specs.length);
  const results=await Promise.all(specs.map(spec=>_fetchCloudflareFile(spec,{force,cacheOverride:spec.heavy?false:undefined}).then(ok=>{
    done++;
    _setDataPillText(label,done+'/'+specs.length);
    return ok;
  })));
  const ok=results.every(Boolean);
  _finishDataPill(ok?(label+' พร้อมแล้ว'):(label+' โหลดไม่ครบ'),ok?900:1400);
  return ok;
}

function _markForegroundPillDot(idx){return window.FreshketSenseRuntime.data.markForegroundPillDot(idx);}
function _prepareProgressChips(keys,totalCount){return window.FreshketSenseRuntime.data.prepareProgressChips(keys,totalCount,R2_SPECS);}

// ════════════════════════════════════════
// v202: PER-KAM BUNDLE LOADER
// ════════════════════════════════════════
// Derive safe filename key from KAM email
// e.g. duangruedee.bu@freshket.co → duangruedee_bu_freshket_co
function _kamSafeKey(email){
  if(!email)return'';
  return email.toLowerCase().replace(/[^a-z0-9]/g,'_');
}

// Lookup kamEmail for an accountId from portviewBulkData (col 17, camelCase)
function _getKamEmailForAccount(accountId){
  if(!accountId)return null;
  if(!portviewBulkData||!portviewBulkData.length){
    console.warn('[v202 debug] _getKamEmailForAccount: portviewBulkData not loaded yet for',accountId);
    return null;
  }
  const row=portviewBulkData.find(r=>r.id===accountId);
  const email=(row&&row.kamEmail)||null;
  if(!email)console.warn('[v202 debug] _getKamEmailForAccount: no kamEmail for account',accountId,'(row found:',!!row,')');
  return email;
}

// Fetch one bundle file: IndexedDB cache (6h TTL) → R2 → ingest
async function _fetchKamFile({url,type,tab}){
  try{
    const cached=await _csvCacheGet(tab);
    if(cached&&cached.ts&&(Date.now()-cached.ts)<_CSV_TTL){
      const ageMin=Math.round((Date.now()-cached.ts)/60000);
      _senseLog('%c[v206d bundle] IndexedDB cache hit:','color:#adf',tab,'age:',ageMin,'min');
      const ok=await ingestCSVText(type,cached.text,{timeoutMs:90000});
      if(ok)return true;
      console.warn('[v202 bundle] cache ingest failed, retrying from R2:',tab);
    }
  }catch(e){}
  try{
    const _t0=Date.now();
    const text=await _fetchTextWithTimeout(url,90000);
    if(!text){console.warn('[v202 bundle] empty response:',url);return false;}
    console.log('%c[Sense] R2 fetch','color:#4ddc97',{tab, kb:Math.round(text.length/1024), url:url.split('/').pop()});
    const _kb=Math.round(text.length/1024);
    const _ms=Date.now()-_t0;
    _senseLog('%c[v206d bundle] R2 fetch OK:','color:#00d070',tab,_kb+'KB in '+_ms+'ms');
    await _csvCacheSet(tab,text);
    const ok=await ingestCSVText(type,text,{timeoutMs:90000});
    if(!ok)console.warn('[v202 bundle] ingest failed after fetch:',tab);
    return!!ok;
  }catch(e){
    console.warn('%c[v202 bundle] ❌ fetch error:','color:red',url,e&&e.message?e.message:e);
    return false;
  }
}

// Fetch both bundle files for a KAM (parallel, dedup via _kamBundleInFlight)
// Silent: no pill, no toast — caller never awaits unless it needs the data
async function _fetchKamBundle(kamEmail){
  if(!kamEmail)return false;
  const safeKey=_kamSafeKey(kamEmail);
  if(_kamBundleLoaded.has(safeKey))return true;
  if(_kamBundleInFlight[safeKey])return _kamBundleInFlight[safeKey];
  const p=(async()=>{
    try{
      const skusUrl=`${R2_BASE}/sense_skus_${safeKey}.csv`;
      const altsUrl=`${R2_BASE}/sense_alts_${safeKey}.csv`;
      _senseLog('%c[v206d bundle] fetching:', 'color:#00d070;font-weight:bold', skusUrl);
      _senseLog('%c[v206d bundle] fetching:', 'color:#00d070;font-weight:bold', altsUrl);
      const[okSkus,okAlts]=await Promise.all([
        _fetchKamFile({url:skusUrl,type:'bulk-skus',tab:`bundle-skus-${safeKey}`}),
        _fetchKamFile({url:altsUrl,type:'bulk-alternatives',tab:`bundle-alts-${safeKey}`}),
      ]);
      if(okSkus&&okAlts){
        _kamBundleLoaded.add(safeKey);
        _senseLog('%c[v206d bundle] LOADED FROM BUNDLE (not bulk):', 'color:#00d070;font-weight:bold', kamEmail);
        // v224e: set bulkSkusReady so _skuSnap changes from '0s'→'1s' → portview value guard passes → _churnCounts rendered
        try{bulkSkusReady=true;}catch(e){}
        // v225d: guard with _bundlePreWarming — suppress during TL prewarm, allow on direct/KAM loads
        if(!_bundlePreWarming){setTimeout(()=>{try{if(document.getElementById('scr-portview')?.classList.contains('on')&&typeof renderPortviewList==='function')renderPortviewList();}catch(e){}},150);}
      }else{
        console.warn('[v202 bundle] ⚠️ incomplete:', kamEmail, 'skus:', okSkus, 'alts:', okAlts);
      }
      return okSkus&&okAlts;
    }catch(e){
      console.warn('[v202 bundle] ❌ error:', kamEmail, e&&e.message?e.message:e);
      return false;
    }finally{
      delete _kamBundleInFlight[safeKey];
    }
  })();
  _kamBundleInFlight[safeKey]=p;
  return p;
}

// Fetch per-KAM upsell bundle on demand (like SKU bundles)
const _upsellBundleLoaded=new Set();
const _upsellBundleInFlight={};

async function _fetchUpsellBundle(kamEmail){
  if(!kamEmail)return false;
  const safeKey=_kamSafeKey(kamEmail);
  if(_upsellBundleLoaded.has(safeKey))return true;
  if(_upsellBundleInFlight[safeKey])return _upsellBundleInFlight[safeKey];
  const p=(async()=>{
    try{
      const url=`${R2_BASE}/sense_upsell_${safeKey}.csv`;
      console.log('%c[Sense] upsell bundle fetch','color:#f0b000','→',kamEmail);
      window._upsellIngestEmail = kamEmail; // v259: parser injects this as byKam key
      const ok=await _fetchKamFile({url,type:'bulk-upsell',tab:`bundle-upsell-${safeKey}`});
      window._upsellIngestEmail = '';
      if(ok){
        _upsellBundleLoaded.add(safeKey);
        console.log('%c[Sense] upsell bundle ✓','color:#4ddc97',kamEmail);
        // Clear strip cache and force full re-render pipeline
        setTimeout(()=>{
          try{ const s=document.getElementById('pv-commission-strip'); if(s)s._lastCommHtml=''; }catch(e){}
          try{ if(typeof _commGatedRender==='function') _commGatedRender(); }catch(e){}
          try{ if(typeof _commRenderKamSelfStrip==='function') _commRenderKamSelfStrip(); }catch(e){}
        }, 100);
      }
      return ok;
    }catch(e){
      console.warn('[upsell bundle] error',kamEmail,e&&e.message);
      return false;
    }finally{
      delete _upsellBundleInFlight[safeKey];
    }
  })();
  _upsellBundleInFlight[safeKey]=p;
  return p;
}
window._fetchUpsellBundle=_fetchUpsellBundle;

function _startCloudBackgroundLoad({token,fgLoaded=0,total=8}={}){
  const BACKGROUND=[];  // v207b: disable global bulk SKU background load; use per-KAM bundle on demand
  // v202: KAM role — fire per-KAM bundle in parallel (silent, no pill, no toast)
  const _bgRole=currentUserProfile&&currentUserProfile.role||'rep';
  if(_bgRole!=='tl'&&_bgRole!=='admin'&&currentUser&&currentUser.email){
    _fetchKamBundle(currentUser.email).catch(()=>{});
    _fetchUpsellBundle(currentUser.email).catch(()=>{});  // Q3C per-KAM upsell bundle
  }
  if(_cloudBackgroundPromise)return _cloudBackgroundPromise;
  const counter=document.getElementById('sheets-loaded-count');
  const bgDots=document.getElementById('dlp-bg-dots');
  const readyIcon=document.getElementById('dlp-ready-icon');
  const dots=document.getElementById('dlp-dots');
  if(dots)dots.style.display='none';
  if(readyIcon)readyIcon.style.display='none';
  if(bgDots)bgDots.style.display='flex';
  _setDataPillText('SKU','');

  let pillReleased=false;
  let finished=false;
  const releaseTimer=setTimeout(()=>{
    if(finished||token!==_cloudLoadToken)return;
    pillReleased=true;
    _finishDataPill('โหลดต่อเบื้องหลัง',1000);
    showToast('กำลังโหลด SKU ต่อเบื้องหลัง','⟳');
  },18000);

  // iOS memory fix: sequential fetch loop (previously skus+alternatives, now skus only)
  async function _loadBgSequential(){
    const results=[];
    for(const key of BACKGROUND){
      if(token!==_cloudLoadToken)break;
      const spec=R2_SPECS[key];
      const bgDot=document.getElementById(key==='skus'?'dlp-bg-skus':'dlp-bg-alts');
      const ok=await _fetchCloudflareFile(spec,{force:false,cacheOverride:false});
      if(token!==_cloudLoadToken){results.push(ok);break;}
      if(ok){
        if(bgDot)bgDot.classList.add('done');
        if(key==='skus'){
          if(typeof renderPortviewList==='function'&&document.getElementById('scr-portview')?.classList.contains('on')){
            renderPortviewList();
          }
        }
      }else{
        if(bgDot)bgDot.style.background='rgba(240,80,0,.7)';
      }
      const loadedNow=fgLoaded+BACKGROUND.filter(k=>_cloudLoadedTabs.has(R2_SPECS[k].tab)).length;
      if(counter)counter.textContent=loadedNow+'/'+total;
      results.push(ok);
      // Brief yield between large files — lets iOS GC run before next file
      if(key==='skus'){
        // cold start (no IndexedDB cache) → yield longer for GC before alternatives
        const _isCached=await _csvCacheGet('alternatives').catch(()=>null);
        const _yieldMs=(_isCached&&_isCached.ts&&(Date.now()-_isCached.ts)<_CSV_TTL)?500:2000;
        await new Promise(r=>setTimeout(r,_yieldMs));
      }
    }
    return results;
  }
  _cloudBackgroundPromise=_loadBgSequential().then(results=>{
    if(token!==_cloudLoadToken)return results;
    finished=true;clearTimeout(releaseTimer);
    const okCount=results.filter(Boolean).length;
    if(okCount===BACKGROUND.length){
      if(!pillReleased)_finishDataPill('ข้อมูลครบแล้ว',1000);
      showToast('ข้อมูล SKU พร้อมแล้ว','✓');
    }else{
      if(!pillReleased)_finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
      showToast('ข้อมูลหลักพร้อม แต่ SKU ยังไม่ครบ — กด Refresh data ได้','⚠');
    }
    if(typeof updateDataStatus==='function')updateDataStatus();
    if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
    return results;
  }).catch(err=>{
    if(token===_cloudLoadToken){
      finished=true;clearTimeout(releaseTimer);
      if(!pillReleased)_finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
      showToast('โหลด SKU ไม่สำเร็จ — กด Refresh data','⚠');
      console.warn('[Cloudflare background]',err);
    }
    return [false,false];
  }).finally(()=>{
    if(token!==_cloudLoadToken)return;
    _cloudBackgroundPromise=null;
    // ── Tier 3: v198d fix — moved from .then() to .finally() ──
    // v221: bulk_price auto-load disabled — load on-demand only (call _startDeferredPriceLoad() when sparklines needed)
    // Was: setTimeout(()=>_startDeferredPriceLoad(_priceToken),3000);
    _senseDataLog('BACKGROUND','bulk_price deferred — call _startDeferredPriceLoad() when sparklines needed');
  });
  return _cloudBackgroundPromise;
}

// ── Tier 3: Deferred price load — silent, after background completes ──
// bulk_price.csv (~35-40MB) loads quietly after skus are ready.
// Sparklines show local-normalize until this resolves, then upgrade automatically.
async function _startDeferredPriceLoad(token){
  // v198e: token check ลบออก — stale token จาก auth events ทำให้ price ไม่โหลด
  // _cloudLoadedTabs.has('price') + _cloudInFlight guard เพียงพอสำหรับ dedup
  if(_cloudLoadedTabs.has('price'))return; // already loaded
  const spec=R2_SPECS['price'];
  if(!spec)return;
  // mark badge as loading
  const b=document.getElementById('badge-bulk-price');
  const dot=document.getElementById('dlp-bg-price');
  if(b&&b.textContent==='upload'){b.textContent='⟳';b.className='dp-slot-badge';}
  if(dot)dot.style.opacity='1';
  try{
    await _fetchCloudflareFile(spec,{force:false,cacheOverride:false});
    if(dot)dot.classList.add('done');
  }catch(e){
    console.warn('[Deferred price load]',e);
    if(dot)dot.style.background='rgba(240,80,0,.7)';
    if(b){b.textContent='⚠';b.className='dp-slot-badge';}
  }
}

async function loadFromCloudflareR2(){
  if(sheetsLoadStarted&&_cloudInitialPromise)return _cloudInitialPromise;
  if(sheetsLoadStarted)return;
  sheetsLoadStarted=true;
  const token=++_cloudLoadToken;

  // v201c loading strategy:
  // Tier 1 (FOREGROUND): 6 lightweight files → app usable
  // Tier 2 (BACKGROUND): skus → alternatives (sequential, heavy) → Sense ready
  // Tier 3 (DEFERRED): price → sparkline baseline upgrade (silent, after tier 2)
  const FOREGROUND=['portview','history','categories','sku_current','outlets','handover','upsell_team','current_movements'];
  const BACKGROUND=[];  // v207b: disable global bulk SKU background load; use per-KAM bundle on demand
  const ALL=[...FOREGROUND,...BACKGROUND];
  const btn=document.getElementById('sheets-load-btn');
  const counter=document.getElementById('sheets-loaded-count');
  if(btn){btn.disabled=true;btn.textContent='กำลังโหลด...';}
  _resetDataPill();
  _prepareProgressChips(ALL,ALL.length);
  _setDataPillText('โหลดข้อมูลหลัก','0/'+FOREGROUND.length);

  _cloudInitialPromise=(async()=>{
    let loaded=0;
    const fgResults=await Promise.all(FOREGROUND.map(async(key,idx)=>{
      let ok=await _fetchCloudflareFile(R2_SPECS[key],{force:false});
      // v195 Step 3: 1 retry after 2s if fail — handles momentary R2 / network hiccup
      if(!ok&&token===_cloudLoadToken){
        await new Promise(r=>setTimeout(r,2000));
        if(token===_cloudLoadToken)ok=await _fetchCloudflareFile(R2_SPECS[key],{force:true});
      }
      if(token!==_cloudLoadToken)return ok;
      if(ok){loaded++;_markForegroundPillDot(idx);}
      if(counter)counter.textContent=loaded+'/'+ALL.length;
      _setDataPillText('โหลดข้อมูลหลัก',loaded+'/'+FOREGROUND.length);
      return ok;
    }));
    if(token!==_cloudLoadToken)return;
    const fgOk=fgResults.filter(Boolean).length;
    if(btn){btn.disabled=false;btn.textContent='Refresh data';}
    if(fgOk>0){
      showToast('พร้อมใช้งาน — ข้อมูลหลัก '+fgOk+'/'+FOREGROUND.length+' ไฟล์','✓');
      // QC-06: if upsell file failed, release commission strip from loading state after 15s
      setTimeout(function(){
        try{
          if(typeof bulkUpsellData!=='undefined' && !bulkUpsellData.loaded){
            bulkUpsellData.loaded=false; // keep false but allow NRR-only render
            var _s=document.getElementById('pv-commission-strip'); if(_s) _s._lastCommHtml='';
            if(typeof _commRenderKamSelfStrip==='function') _commRenderKamSelfStrip();
          }
        }catch(e){}
      }, 15000);
      // Reset scroll to top if portview is active — prevents scroll-anchoring from
      // triggering collapse observer when header grows during data re-render
      if(document.getElementById('scr-portview')?.classList.contains('on')){
        window.scrollTo({top:0,left:0,behavior:'instant'});
        document.body.scrollTop=0;document.documentElement.scrollTop=0;
      }
      // v224e fix: render portview/teamview when data is available.
      // Guard: suppress ONLY when portviewBulkData is empty (prevents 0% red bar flash).
      // allCriticalReady() check removed from here — it was blocking renders via
      // non-existent schedulePortviewListRender() → silent no-op → empty sparkline bars.
      const _pvHasData = typeof portviewBulkData !== 'undefined' && portviewBulkData && portviewBulkData.length > 0;
      if(_pvHasData){
        if(typeof renderPortview==='function')renderPortview();
        if(typeof renderTeamview==='function'&&document.getElementById('scr-teamview')?.classList.contains('on'))renderTeamview();
      }
    }else{
      // v195 Step 3: persistent offline banner (not just toast) when all 5 foreground files fail
      showToast('โหลดข้อมูลหลักไม่สำเร็จ — กด Refresh data','⚠');
      const _existingBanner=document.getElementById('offline-banner');
      if(!_existingBanner){
        const _b=document.createElement('div');
        _b.id='offline-banner';
        _b.style.cssText='position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:440px;z-index:9998;background:rgba(220,60,0,.92);color:#fff;font-size:12px;font-family:"IBM Plex Sans Thai",sans-serif;text-align:center;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;backdrop-filter:blur(8px)';
        _b.innerHTML='<span>⚠ ไม่สามารถโหลดข้อมูลได้ — ตรวจสอบการเชื่อมต่อ</span><button onclick="document.getElementById(\x27offline-banner\x27)?.remove();reloadFromGoogleSheets();" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit">Retry</button>';
        document.body.appendChild(_b);
        // Auto-dismiss banner when next successful load fires
        const _origRender=typeof renderPortview==='function'?renderPortview:null;
        if(_origRender)window._offlineBannerRenderGuard=()=>{document.getElementById('offline-banner')?.remove();window._offlineBannerRenderGuard=null;};
      }
    }
    if(typeof updateDataStatus==='function')updateDataStatus();
    if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();

    // Fire-and-forget background load. Do not await this; Sense can await the same in-flight promise only when needed.
    _startCloudBackgroundLoad({token,fgLoaded:fgOk,total:ALL.length});
  })().finally(()=>{if(token===_cloudLoadToken)_cloudInitialPromise=null;});
  return _cloudInitialPromise;
}
async function reloadFromCloudflareR2(){
  await _csvCacheClear();
  sheetsLoadStarted=false;
  bulkSkusReady=false;bulkAltsReady=false;
  _cloudLoadedTabs.clear();
  _clearCloudInFlight();
  _cloudInitialPromise=null;
  _cloudBackgroundPromise=null;
  _cloudLoadToken++;
  try{if(typeof _scheduleRefreshAllLastFired!=='undefined') _scheduleRefreshAllLastFired=0;}catch(e){} // v221c: reset settle window
  if(window.RenderBus) window.RenderBus.reset(); // v223
  // v202: clear per-KAM bundle state so reload fetches fresh bundles
  _kamBundleLoaded.clear();
  Object.keys(_kamBundleInFlight).forEach(k=>delete _kamBundleInFlight[k]);
  // v203: clear SKU dedup guard so fresh reload doesn't hit false "already seen"
  Object.keys(_bulkSkusSeen).forEach(k=>delete _bulkSkusSeen[k]);
  return loadFromCloudflareR2();
}

// Backward-compatible aliases. Name kept so old onclick/flows do not break.
async function reloadFromGoogleSheets(){return reloadFromCloudflareR2();}
async function loadFromGoogleSheets(){return loadFromCloudflareR2();}

async function ensureAccountDetailData(accountId){
  if(!accountId)return false;
  const needed=[];
  if(!bulkCatsData[accountId])needed.push('categories');
  if(!bulkSkuCurrentData[accountId])needed.push('sku_current');
  if(!bulkOutletsData[accountId])needed.push('outlets');
  if(!bulkSkusData[accountId])needed.push('skus');
  if(!needed.length)return true;
  showToast('กำลังโหลด account intelligence...','⟳');
  const ok=await ensureCloudflareFiles(needed,{label:'Account intelligence'});
  loadFromStorage(accountId);
  refreshAll();updateDataStatus();
  if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
  if(isKAM&&document.getElementById('scr-kam-overview')?.classList.contains('on'))renderKamOverview();
  return ok;
}

async function ensureSenseData(accountId, {silent=false}={}){
  if(!accountId)return false;
  const needed=[];
  if(!bulkSkusData[accountId])needed.push('skus');
  if(!bulkAltsReady&&!bulkAltsUnverified[accountId])needed.push('alternatives');
  // v202 debug: full state snapshot on every Sense Gate tap
  console.log('%c[v202 debug] ensureSenseData entry:','color:#6cf',{
    accountId, needed,
    pvReady: portviewBulkData&&portviewBulkData.length>0,
    pvCount: portviewBulkData?portviewBulkData.length:0,
    bundleLoaded: [..._kamBundleLoaded],
    inFlight: Object.keys(_kamBundleInFlight),
    role: currentUserProfile&&currentUserProfile.role,
    userEmail: currentUser&&currentUser.email
  });
  if(!needed.length){console.log('[v202 debug] ensureSenseData: data already in memory — instant');return true;}
  // v202: try per-KAM bundle first (~4MB) before falling back to bulk (~120MB)
  // Fix 2: if portviewBulkData not loaded yet, use currentUser.email for KAM role
  const _role=currentUserProfile&&currentUserProfile.role||'rep';
  const _kamEmail=_getKamEmailForAccount(accountId)||
    (_role!=='tl'&&_role!=='admin'&&currentUser&&currentUser.email?currentUser.email:null);
  if(_kamEmail){
    const _safeKey=_kamSafeKey(_kamEmail);
    let _bundleOk=false;
    if(_kamBundleLoaded.has(_safeKey)){
      _bundleOk=true; // already in memory
      _senseLog('%c[v206d bundle] SERVED FROM MEMORY:', 'color:#00d070', _kamEmail);
    }else if(_kamBundleInFlight[_safeKey]){
      // await in-flight — bundle ~4MB completes well within 30s
      _bundleOk=await Promise.race([
        _kamBundleInFlight[_safeKey],
        new Promise(r=>setTimeout(()=>r(false),30000))
      ]);
    }else{
      // cold fetch — not pre-warmed yet (TL direct nav)
      // bundle ~4MB << bulk 135MB: even cold fetch beats bulk load time
      _senseLog('%c[v206d bundle] cold fetch for TL:', 'color:#f0b000', _kamEmail);
      _bundleOk=await Promise.race([
        _fetchKamBundle(_kamEmail),
        new Promise(r=>setTimeout(()=>r(false),30000))
      ]);
    }
    if(_bundleOk){
      loadFromStorage(accountId);
      if(D.alts.length&&D.skus.length)computeOPPS();
      if(!silent){refreshAll();updateDataStatus();}
      if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
      return true;
    }
    // bundle 404 / timeout → fall through to bulk
    console.warn('%c[v202 bundle] ⚠️ FALLBACK → loading bulk (bundle 404/timeout) for:', 'color:#f0b000;font-weight:bold', _kamEmail);
  }
  // Bulk fallback: v201c path — deduplicates via _cloudInFlight
  showToast('กำลังโหลด SKU + ทางเลือก...','⟳');
  const ok=await ensureCloudflareFiles(needed,{label:'SKU + ทางเลือก'});
  loadFromStorage(accountId);
  if(D.alts.length&&D.skus.length)computeOPPS();
  if(!silent){refreshAll();updateDataStatus();}
  if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
  return ok;
}

// Legacy alias — existing button onclick='loadFromSupabaseStorage()' still works
async function loadFromSupabaseStorage(){
  return loadFromGoogleSheets();
}

function _initSheetsInput(){} // no-op — UI inputs removed, using constants

// ════════════════════════════════════════
// DATA PANEL UI
// ════════════════════════════════════════
function openDataPanel(){
  _injectSenseThemePicker();
  setDpMode('quick');
  document.getElementById('dataPanel').classList.add('open');
  document.getElementById('dataOverlay').classList.add('on');
  updateDpAccountCard();renderAccountLibrary();
  _initSheetsInput();
}

function setDpMode(mode){
  const quick=document.getElementById('dp-quick');
  const bulk=document.getElementById('dp-bulk');
  const tabQ=document.getElementById('dp-tab-quick');
  const tabB=document.getElementById('dp-tab-bulk');
  if(quick)quick.style.display=mode==='quick'?'block':'none';
  if(bulk)bulk.style.display=mode==='bulk'?'block':'none';
  if(tabQ)tabQ.classList.toggle('on',mode==='quick');
  if(tabB)tabB.classList.toggle('on',mode==='bulk');
}

function useSampleData(){
  D={history:[...SAMPLE.history],cats:[...SAMPLE.cats],cats_monthly:{},skus:[...SAMPLE.skus.map(s=>({...s}))],alts:[],alts_meta:{status:'none',verified_count:0,total_count:0,verified_at:null,bulk_loaded_at:null},outlets_monthly:{...SAMPLE.outlets_monthly},current_month:null,sku_current:[],meta:{accountName:'[ตัวอย่าง] บ.ลีฟ ทู อีท จำกัด',accountId:'sample_741a4cb1abcd',kamName:'Guntinun (Monet)'}};
  const lastMonth=SAMPLE.history[SAMPLE.history.length-1]?.m;
  D_outlets=(SAMPLE.outlets_monthly[lastMonth]||[]).map(o=>({...o}));
  OPPS.length=0;OPPS_SAMPLE.forEach(o=>OPPS.push({...o,alts:o.alts.map(a=>({...a}))}));
  sel=new Set([1,2,3]);selAlt={};
  fileStatus={history:true,categories:true,skus:true,alternatives:true};
  currentAccountId='sample_741a4cb1abcd';
  saveToStorage();applyMeta();refreshAll();updateDataStatus();updateDpAccountCard();renderAccountLibrary();closeDataPanel();
}

// ── Gap 8: Cross-month warning ──
function checkCrossMonthWarning(){
  if(!D.skus_monthly||!D.history.length)return null;
  const _smSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const skuMonths=Object.keys(D.skus_monthly).sort((a,b)=>_smSort(b)-_smSort(a));
  if(!skuMonths.length)return null;
  const lastHistMo=D.history[D.history.length-1].m;
  const _cmLabel=(D.current_month||{}).month_label||'';
  // v156: skip current-month MTD entry when checking mismatch — Q3B intentionally includes it
  const lastSkuMo=skuMonths.find(m=>m!==_cmLabel)||skuMonths[0];
  if(lastHistMo&&lastSkuMo&&lastHistMo!==lastSkuMo){
    return`SKU data จาก ${lastSkuMo} · ประวัติล่าสุดคือ ${lastHistMo} — ยอดประหยัดอาจคลาดเคลื่อน`;
  }
  return null;
}

function closeDataPanel(){document.getElementById('dataPanel').classList.remove('open');document.getElementById('dataOverlay').classList.remove('on');}

function updateDataStatus(){
  // Update bulk upload badges (bulk slots still exist)
  const allLoaded=fileStatus.history&&fileStatus.categories&&fileStatus.skus;
  document.getElementById('dataBtnTop').classList.toggle('loaded',allLoaded);
}

// ════════════════════════════════════════
// RENDER — OVERVIEW
// ════════════════════════════════════════
// v218a DATA GATE: 3 FOREGROUND files needed for portfolio screen (พอร์ตของฉัน / ภาพรวมทีม).
// portview → account list, run rate, สั่ง/หาย/SKU counts (all from portview.csv Q8E)
// history  → NRR/Comeback/Expansion movement, ON TRACK/MONITOR/AT RISK classification
// handover → Handover badge per account
// categories/sku_current/outlets load in BACKGROUND after splash — they serve account DETAIL
// not the portfolio list, so their arrival doesn't cause visible flash on the portfolio screen.

// v218b: data load performance logger — filter '[Sense⚡]' in DevTools console (Info level).
// What it shows: IndexedDB hit/miss, ETag 304/200, gate events, render calls, splash timing.
// To silence: window._senseLoadDebug = false  |  To re-enable: window._senseLoadDebug = true
function _senseDataLog(){
  try{
    if(window._senseLoadDebug===false)return;
    var args=Array.prototype.slice.call(arguments);
    var tag=String(args[0]);
    var rest=args.slice(1);
    var t=typeof performance!=='undefined'?Math.round(performance.now())+'ms':'';
    console.info.apply(console,
      ['%c[Sense⚡ '+t+'] '+tag,'color:#00CC6A;font-weight:600;font-family:monospace'].concat(rest));
  }catch(e){}
}

// v219 STRATEGY B + v222 PHASE 2: Read up to 6 files from IndexedDB — no network, no ETag wait.
// v222 expansion: also preload categories, sku_current, outlets (cache:true files).
// On warm boot: all 6 files load from IDB in ~150ms → NO R2 downloads needed at all.
// _idbPreloaded=true fires when critical 3 ready (portview+history+handover).
// Extra 3 are a bonus — eliminate the post-splash debounced batch render on warm boot.
async function _preloadFromIndexedDB(){
  var CRITICAL=['portview','history','handover'];
  var EXTRA=['categories','sku_current','outlets','upsell_team','current_movements']; // v222+v226+v259: also preload — cache:true in IDB
  var TABS=[...CRITICAL,...EXTRA];
  var loaded=0; var criticalLoaded=0;
  try{
    var tasks=TABS.map(async function(tab){
      try{
        var cached=await _csvCacheGet(tab);
        if(!cached||!cached.text||!cached.ts) return; // not in IndexedDB
        if((Date.now()-cached.ts)>=_CSV_TTL) return;  // expired (> 6h)
        var spec=R2_SPECS[tab];
        if(!spec) return;
        var ok=await ingestCSVText(spec.type,cached.text,{timeoutMs:30000});
        if(ok){
          _cloudLoadedTabs.add(tab);
          loaded++;
          if(CRITICAL.indexOf(tab)>=0) criticalLoaded++;
          var kb=Math.round(cached.text.length/1024);
          var age=Math.round((Date.now()-cached.ts)/60000);
          _senseDataLog(tab,'⚡ IDB-DIRECT (no ETag)',kb+'KB',age+'min old');
          // v223: signal RenderBus — it'll wait for critical gate, then render
          if(window.RenderBus) window.RenderBus.signal(tab);
        }
      }catch(e){}
    });
    await Promise.all(tasks);
    if(criticalLoaded===3){
      window._idbPreloaded=true;
      _senseDataLog('⚡ IDB-PRELOAD','critical 3 ready ('+loaded+'/'+TABS.length+' total) — splash fast path, R2 skipped');
      if(allCriticalReady()){
        if(typeof window._splashDataReady==='function') window._splashDataReady();
        // v223: RenderBus already has signals from per-file loads above — no extra flush needed
      }
    }else{
      _senseDataLog('⚡ IDB-PRELOAD',criticalLoaded+'/3 critical found ('+loaded+'/6 total) — falling back to ETag');
    }
  }catch(e){}
  return loaded;
}

// SECTION:REFRESH_GATE
function allCriticalReady(){
  try{
    return _cloudLoadedTabs.has('portview') &&
           _cloudLoadedTabs.has('history') &&
           _cloudLoadedTabs.has('handover');
  }catch(e){return false;}
}

// v221 DEBOUNCE + v221c SETTLE WINDOW
// background file callbacks batch into ONE render per 1000ms window.
// Prevents double-render when files arrive in two waves (e.g. resume/ETag check).
var _scheduleRefreshAllTimer=null;
var _scheduleRefreshAllLastFired=0;
var _SETTLE_WINDOW=1000; // ms — renders can't fire faster than once per 1s
function _scheduleRefreshAll(delayMs){
  const now=Date.now();
  const sinceLastRender=_scheduleRefreshAllLastFired?now-_scheduleRefreshAllLastFired:Infinity;
  const waitForSettle=_scheduleRefreshAllLastFired&&sinceLastRender<_SETTLE_WINDOW?_SETTLE_WINDOW-sinceLastRender+50:0;
  const wait=Math.max(delayMs||400,waitForSettle);
  clearTimeout(_scheduleRefreshAllTimer);
  _scheduleRefreshAllTimer=setTimeout(function(){
    _scheduleRefreshAllTimer=null;
    _scheduleRefreshAllLastFired=Date.now();
    _senseDataLog('RENDER','_scheduleRefreshAll ✅ debounced render fired');
    if(typeof refreshAll==='function') refreshAll();
  }, wait);
}

// ─────────────────────────────────────────────────────────────────────────────
// v223 RENDERBUS — single owner of all data-driven screen renders.
//
// Architecture: data loaders call RenderBus.signal(source) when their data
// is ready. RenderBus decides WHEN to render — never immediately, always
// after checking: (1) splash gone? (2) critical data ready? (3) settle window.
//
// Result: ONE render per data-arrival burst, regardless of how many files
// arrive concurrently. Eliminates the N-files = N-flashes pattern.
//
// Cases handled:
//   cold boot    → files arrive during splash → queued → doFade fires first render
//                  → background files batch into ONE post-splash render
//   warm boot    → IDB loads all 6 in ~150ms → doFade fires → done (no R2 needed)
//   resume       → validateUnifiedFreshness calls reset() → files re-arrive → one render
//   manual reload → reloadFromCloudflareR2 calls reset() → one render when done
//   data update  → ETag 200 → signal() → settle window → one render
//
// Interactive actions (account switch, button taps) bypass RenderBus and call
// renderXxx() directly — they need immediate response.
// ─────────────────────────────────────────────────────────────────────────────
window.RenderBus = (function(){
  var _timer = null;
  var _lastRender = 0;
  var _ready = new Set();
  var SETTLE_MS = 2000; // ms — increased from 800ms: batches signals that arrive within 2s of each other

  function _flush(){
    _timer = null;
    _lastRender = Date.now();
    _senseDataLog('RENDERBUS','🎯 RENDER ['+Array.from(_ready).join(',')+']');
    // v224e: clear shimmer right before render — ETag check done, real data incoming
    try{
      if(window._pwaShimmerActive && typeof window._deactivatePortviewShimmer==='function'){
        window._deactivatePortviewShimmer();
      }
    }catch(e){}
    // Primary: KAM account detail screen
    if(typeof refreshAll === 'function') refreshAll();
    // Portfolio list screen (not covered by refreshAll)
    try{
      if(document.getElementById('scr-portview')?.classList.contains('on') &&
         typeof renderPortview === 'function') renderPortview();
    }catch(e){}
    // Team view screen
    try{
      if(document.getElementById('scr-teamview')?.classList.contains('on') &&
         typeof renderTeamview === 'function') renderTeamview();
    }catch(e){}
  }

  function signal(source){
    _ready.add(source);
    // Blocked by splash
    if(window._senseSplashActive){
      window._pendingRefreshAll = true;
      _senseDataLog('RENDERBUS','⏳ '+source+' — queued (splash)');
      return;
    }
    // Blocked until critical files ready
    if(typeof allCriticalReady === 'function' && !allCriticalReady()){
      window._pendingRefreshAll = true;
      _senseDataLog('RENDERBUS','⏳ '+source+' — queued (waiting portview+history+handover)');
      return;
    }
    // Settle window: batch concurrent arrivals
    var now = Date.now();
    var sinceLastRender = _lastRender ? now - _lastRender : Infinity;
    var wait = sinceLastRender < SETTLE_MS ? SETTLE_MS - sinceLastRender + 50 : 50;
    clearTimeout(_timer);
    _timer = setTimeout(_flush, wait);
    _senseDataLog('RENDERBUS','📡 '+source+' — render in '+wait+'ms (settle: '+(sinceLastRender<SETTLE_MS?sinceLastRender+'ms since last':'fresh')+')');
  }

  // Call after doFade fires its first render — stamps settle window so
  // subsequent signals don't fire too close to the main render.
  function markRender(){
    _lastRender = Date.now();
    _senseDataLog('RENDERBUS','🕐 render stamped');
  }

  // Call on manual reload or resume re-fetch — clears ready set and timers.
  // Does NOT reset _lastRender (avoids render bursting right after reset).
  function reset(){
    _ready.clear();
    clearTimeout(_timer);
    _timer = null;
    _senseDataLog('RENDERBUS','🔄 reset (reload/resume)');
  }

  return { signal: signal, markRender: markRender, reset: reset };
})();

function refreshAll(){
  // v217 FIX B: splash guard (belt-and-suspenders — data gate below is the primary guard now)
  if(window._senseSplashActive){
    _senseDataLog('RENDER','refreshAll() ⏳ QUEUED — splash active');
    window._pendingRefreshAll=true; return;
  }
  // v218 DATA GATE: block render until portview+history+handover all loaded.
  if(!allCriticalReady()){
    var _pending=[];
    try{ if(!_cloudLoadedTabs.has('portview'))_pending.push('portview');
         if(!_cloudLoadedTabs.has('history')) _pending.push('history');
         if(!_cloudLoadedTabs.has('handover'))_pending.push('handover'); }catch(e){}
    _senseDataLog('RENDER','refreshAll() ⏳ QUEUED — waiting for: '+(_pending.join('+') || 'unknown'));
    window._pendingRefreshAll=true; return;
  }
  _senseDataLog('RENDER','refreshAll() ✅ FIRED');
  renderOverview();renderPortfolio();renderOpps();renderReport();
  activeMonth=D.history.length-1;selectMonth(activeMonth,true);
  // Update sub-tab visibility
  updateKamSubtabVisibility();
  // ── Score: based on verified OPPS only (unverified filtered out at computeOPPS) ──
  const hasAnalysis=OPPS.length>0;
  animN(document.getElementById('hsav'),totalAll()*12,1500);
  document.getElementById('hsav-mo').textContent=fmt(totalAll())+' / เดือน';
  // Group A: hero additions
  renderHeroKAM();
  renderHeroMoM();
  const senseMetrics=getSenseScoreMetrics();
  const savPct=senseMetrics.savPct;
  const score=hasAnalysis?senseMetrics.score:0;
  const scoreLabel=!hasAnalysis?'รอวิเคราะห์':score>=85?'บริหารต้นทุนดีมาก':score>=72?'บริหารดี ยังมีช่อง':score>=58?'มีช่องประหยัดได้':'Sense เจอราคาคุ้มกว่ามาก';
  const scoreDesc=!hasAnalysis?'รัน Verify เพื่อวิเคราะห์ SKU':OPPS.length>0?`Sense เจอวัตถุดิบที่ราคาคุ้มกว่า ${OPPS.length} รายการ · ประหยัดได้ ${savPct.toFixed(1)}%`:'Sense ไม่พบช่องปรับเพิ่มเติม';
  const circ=2*Math.PI*42;
  document.getElementById('darc').style.strokeDashoffset=hasAnalysis&&senseActivated?circ-(score/100)*circ:circ;
  document.getElementById('dtxt').textContent=hasAnalysis&&senseActivated?score:'';
  document.getElementById('dlb').textContent=senseActivated?scoreLabel:'Freshket Sense';
  document.getElementById('dval').textContent=hasAnalysis&&senseActivated?score:'';
  const sColor=!hasAnalysis||!senseActivated?'var(--n400)':score>=85?'var(--g700)':score>=70?'var(--g700)':score>=55?'var(--amb)':'var(--org)';
  document.getElementById('dval').style.color=sColor;
  document.getElementById('dlb').style.color=sColor;
  document.getElementById('darc').style.stroke=!hasAnalysis||!senseActivated?'var(--n200)':score>=85?'var(--g500)':score>=70?'var(--g500)':score>=55?'var(--amb)':'var(--org)';
  const scoreDescEl=document.getElementById('score-desc');if(scoreDescEl)scoreDescEl.textContent=senseActivated?scoreDesc:'แตะเพื่อให้ Sense เช็คราคาวัตถุดิบของร้าน';
  // Standby overlay: show when not yet activated (use display not opacity)
  const _dialOvR=document.getElementById('dial-standby-overlay');
  const _doneWrapR=document.getElementById('sense-done-wrap');
  if(_dialOvR)_dialOvR.style.display=senseActivated?'none':'flex';
  if(_doneWrapR)_doneWrapR.style.display=senseActivated?'block':'none';
  const _dClickR=document.getElementById('dial-clickwrap');if(_dClickR)_dClickR.classList.toggle('sense-done',senseActivated);
  const acctName=D.meta.accountName||'ร้านอาหารของคุณ';
  const el=document.getElementById('h-acct-name');if(el)el.textContent=acctName;
  // Data freshness indicator
  const freshEl=document.getElementById('data-freshness');
  if(freshEl){
    const lastMo=D.history.length?D.history[D.history.length-1].m:'';
    const latestMo=(D.current_month&&D.current_month.month_label&&D.current_month.gmv_to_date>0)?D.current_month.month_label:lastMo;
    freshEl.textContent=latestMo?'ข้อมูล: '+latestMo:'';
    freshEl.style.display=latestMo?'block':'none';
  }
  const badge=document.getElementById('opp-nav-badge');if(badge){badge.textContent=OPPS.length;badge.style.display=senseActivated&&OPPS.length>0?'flex':'none';}
  updatePbFooter();renderOutletCard();
  // ── KAM mode: update account header whenever data refreshes ──
  // (header only re-renders if kamStateCache is stale, i.e. different account or no cache)
  if(isKAM&&!(kamStateCache.accountId===currentAccountId&&kamStateCache.html)){
    renderKamOverview();
  }
  // "What changed" check — compare key metrics with previous session
  try{
    const prevKey='_prev_'+(_acctKey());
    const prev=JSON.parse(localStorage.getItem(prevKey)||'null');
    const cur={gmv:D.history.length?D.history[D.history.length-1].s:0,opps:OPPS.length,skus:D.skus.length};
    if(prev&&(prev.opps!==cur.opps||prev.skus!==cur.skus)){
      const parts=[];
      if(cur.opps>prev.opps)parts.push('+'+(cur.opps-prev.opps)+' โอกาสใหม่');
      if(cur.skus!==prev.skus)parts.push('SKU '+(cur.skus>prev.skus?'+':'')+((cur.skus-prev.skus))+' รายการ');
      if(parts.length)setTimeout(()=>showToast('เปลี่ยนแปลง: '+parts.join(' · ')),800);
    }
    localStorage.setItem(prevKey,JSON.stringify(cur));
  }catch(e){}
}

/* ── P2: Rest AI Button ── */
async function triggerRestAI(){
  if(senseActivated)return; // already ran this session
  if((!D.alts.length||!D.skus.length)&&typeof ensureSenseData==='function'){
    await ensureSenseData(currentAccountId);
  }
  const loadWrap=document.getElementById('rest-ai-load');
  const preview=document.getElementById('rest-ai-preview');
  const dialWrap=document.getElementById('dial-clickwrap');
  const dsvg=document.getElementById('dial-svg');
  const standbyOv=document.getElementById('dial-standby-overlay');
  if(!loadWrap||!preview)return;
  if(OPPS.length===0){
    if(standbyOv){
      const orig=standbyOv.innerHTML;
      standbyOv.innerHTML='<span style="font-size:7.5px;color:var(--org);text-align:center;font-family:\'IBM Plex Sans Thai\',sans-serif;font-weight:700;line-height:1.5">ยังไม่มีข้อมูล<br>อัปโหลดก่อน</span>';
      setTimeout(()=>{standbyOv.innerHTML=orig;},2200);
    }
    return;
  }
  // ── Start loading ──
  if(dialWrap)dialWrap.style.pointerEvents='none';
  if(standbyOv)standbyOv.style.display='none';
  // Spinning arc
  const darcEl=document.getElementById('darc');
  if(darcEl){darcEl.style.transition='none';darcEl.style.strokeDasharray='70 193.9';darcEl.style.strokeDashoffset='0';darcEl.style.stroke='var(--g500)';}
  if(dsvg)dsvg.classList.add('sense-loading');
  loadWrap.style.display='block';
  // Steps: stagger 4 steps over ~3.8s
  [{id:'ras-1',t:150},{id:'ras-2',t:1050},{id:'ras-3',t:2000},{id:'ras-4',t:2900}].forEach(({id,t})=>{
    setTimeout(()=>{const el=document.getElementById(id);if(el)el.classList.add('vis');},t);
  });
  // Dots on step 4
  let _dc=0;
  const _di=setInterval(()=>{const d=document.getElementById('ras-dots');if(d){_dc=(_dc+1)%4;d.textContent='.'.repeat(_dc||1);}},380);
  setTimeout(()=>{
    clearInterval(_di);
    if(dsvg)dsvg.classList.remove('sense-loading');
    loadWrap.style.display='none';
    if(dialWrap)dialWrap.style.pointerEvents='';
    // ── Unlock ──
    senseActivated=true;
    const _senseNavBtn=document.getElementById('nav-opportunities');
    if(_senseNavBtn)_senseNavBtn.classList.add('sense-lit');
    aiCameFromPreview=true;
    _unlockScore();
    // Preview card: SKU count first, savings as footnote
    const oppsEl=document.getElementById('rap-opps');
    const subEl=document.getElementById('rap-sub');
    const savAmt=totalAll();
    if(oppsEl)oppsEl.textContent='Sense เจอ '+OPPS.length+' รายการที่ราคาคุ้มกว่า';
    if(subEl)subEl.textContent='ประหยัดได้ถึง '+fmt(savAmt*12)+' / ปี ถ้าเลือกทั้งหมด';
    preview.style.display='block';
  },4000);
}
// Unlock score dial after Sense runs
function _unlockScore(){
  const hasAnalysis=OPPS.length>0;if(!hasAnalysis)return;
  const senseMetrics=getSenseScoreMetrics();
  const savPct=senseMetrics.savPct;
  const score=senseMetrics.score;
  const circ=2*Math.PI*42;
  const sColor=score>=85?'var(--g700)':score>=70?'var(--g700)':score>=55?'var(--amb)':'var(--org)';
  const scoreLabel=score>=85?'บริหารต้นทุนดีมาก':score>=72?'บริหารดี ยังมีช่อง':score>=58?'มีช่องประหยัดได้':'Sense เจอราคาคุ้มกว่ามาก';
  const scoreDesc=`Sense เจอวัตถุดิบที่ราคาคุ้มกว่า ${OPPS.length} รายการ · ประหยัดได้ ${savPct.toFixed(1)}%`;
  const darcEl=document.getElementById('darc');
  const dtxtEl=document.getElementById('dtxt');
  const dlbEl=document.getElementById('dlb');
  const dvalEl=document.getElementById('dval');
  const descEl=document.getElementById('score-desc');
  const dialWrap=document.getElementById('dial-clickwrap');
  if(dialWrap)dialWrap.classList.add('sense-done');
  // Hide standby, show done
  const standby=document.getElementById('dial-standby-overlay');
  if(standby)standby.style.display='none';
  const doneWrap=document.getElementById('sense-done-wrap');
  if(doneWrap)doneWrap.style.display='block';
  if(darcEl){
    darcEl.style.strokeDasharray='263.9';darcEl.style.strokeDashoffset=String(circ);
    darcEl.style.stroke=score>=85?'var(--g500)':score>=55?'var(--amb)':'var(--org)';
    setTimeout(()=>{darcEl.style.transition='stroke-dashoffset 1.3s ease';darcEl.style.strokeDashoffset=String(circ-(score/100)*circ);},80);
  }
  if(dtxtEl)setTimeout(()=>{
    // Count up without fmt to avoid ฿ symbol
    const _s=Date.now();
    (function _t(){const _p=Math.min((Date.now()-_s)/1200,1);const _e=1-Math.pow(1-_p,3);if(dtxtEl)dtxtEl.textContent=String(Math.round(score*_e));if(_p<1)requestAnimationFrame(_t);})();
  },300);
  if(dlbEl){dlbEl.style.color=sColor;setTimeout(()=>{dlbEl.textContent=scoreLabel;},600);}
  if(dvalEl){dvalEl.style.color=sColor;setTimeout(()=>{
    const _s2=Date.now();
    (function _t2(){const _p=Math.min((Date.now()-_s2)/1200,1);const _e=1-Math.pow(1-_p,3);if(dvalEl)dvalEl.textContent=String(Math.round(score*_e));if(_p<1)requestAnimationFrame(_t2);})();
  },300);}
  if(descEl)setTimeout(()=>{descEl.textContent=scoreDesc;},600);
}
// ── Category bars with tonal palette + expand/collapse ──────────────────
let _catExpanded=false;
function renderCatBars(cats,defaultShow){
  if(!cats||!cats.length)return'';
  const show=_catExpanded?cats.length:Math.min(defaultShow,cats.length);
  const maxP=Math.max(...cats.slice(0,show).map(x=>x.p),1);
  const rows=cats.slice(0,show).map((c,i)=>`<div class="cbi" style="--cat-i:${i}"><div class="cbn">${c.n}</div><div class="cbt"><div class="cbf" style="width:${Math.min(c.p/maxP*100,100)}%;background:${catColor(i)}"></div></div><div style="display:grid;grid-template-columns:62px 28px;flex-shrink:0"><span class="cbv" style="text-align:right">${fmt(c.s)}</span><span class="cbp" style="text-align:right;padding-left:2px">${c.p}%</span></div></div>`).join('');
  const btn=cats.length>defaultShow?`<button class="cat-expand-btn" onclick="toggleCatExpand()">${_catExpanded?'ย่อ':'ดูอีก '+(cats.length-defaultShow)+' หมวด'}</button>`:'';
  return rows+btn;
}
function toggleCatExpand(){
  _catExpanded=!_catExpanded;
  const hist=D.history.length?D.history:SAMPLE.history;
  const h=hist[activeMonth]||{};
  const cats=(D.cats_monthly&&D.cats_monthly[h.m])||(D.cats&&D.cats.length?D.cats:SAMPLE.cats);
  const el=document.getElementById('catbars');if(el)el.innerHTML=renderCatBars(cats,3);
}

function _renderOverviewPaceAndStrip(){
  // ── Pace bar ──
  const cm=D.current_month;
  const hist=D.history.length?D.history:SAMPLE.history;
  const paceWrap=document.getElementById('hero-pace-wrap');
  const fcWrap=document.getElementById('hero-forecast');
  if(cm&&cm.days_elapsed>0&&cm.days_in_month>0){
    const dayPct=Math.round(cm.days_elapsed/cm.days_in_month*100);
    const fill=document.getElementById('hero-pace-fill');
    const daysLbl=document.getElementById('hero-pace-days');
    const pcLbl=document.getElementById('hero-pace-pct');
    if(fill)setTimeout(()=>{fill.style.width=dayPct+'%';},80);
    if(daysLbl)daysLbl.textContent=`วันที่ ${cm.days_elapsed} จาก ${cm.days_in_month} วัน`;
    if(pcLbl){pcLbl.textContent='';pcLbl.className='hero-pace-pct';}
    if(paceWrap)paceWrap.style.display='';
    // Forecast
    if(cm.runrate_gmv>0&&fcWrap){
      const fcNum=document.getElementById('hero-fc-num');
      const fcBase=document.getElementById('hero-fc-base');
      const lastMo=hist[hist.length-1];
      const _baseDaily=lastMo?lastMo.s/30:0;
      const baseMonthly=Math.round(_baseDaily*cm.days_in_month);
      if(fcNum)fcNum.textContent=fmt(cm.runrate_gmv);
      if(fcBase&&baseMonthly>0)fcBase.textContent='baseline '+fmt(baseMonthly);
      fcWrap.style.display='';
    }
  } else {
    if(paceWrap)paceWrap.style.display='none';
    if(fcWrap)fcWrap.style.display='none';
  }
  // ── Price variance strip ──
  const stripWrap=document.getElementById('ov-price-strip-wrap');
  if(!stripWrap)return;
  const lastMoKey=hist.length>=2?hist[hist.length-2].m:'';
  const currMoKey=hist.length?hist[hist.length-1].m:'';
  const currSkus=D.skus_monthly&&currMoKey?D.skus_monthly[currMoKey]||[]:[];
  const prevSkus=D.skus_monthly&&lastMoKey?D.skus_monthly[lastMoKey]||[]:[];
  if(!currSkus.length||!prevSkus.length){stripWrap.style.display='none';return;}
  const prevMap={};prevSkus.forEach(s=>{prevMap[String(s.id)]={p:s.unit_price||s.u||0,q:s.qty_kg||0};});
  let priceUp=0,priceDn=0,netImpact=0;
  const catImpact={};
  currSkus.forEach(s=>{
    const id=String(s.id);const pv=prevMap[id];
    if(!pv||!pv.p||(s.unit_price||s.u||0)===0)return;
    const cp=s.unit_price||s.u||0;const diff=(pv.q||s.qty_kg||0)*(cp-pv.p);
    const pct=(cp-pv.p)/pv.p*100;
    if(pct>=1)priceUp++;else if(pct<=-1)priceDn++;
    netImpact+=diff;
    const cat=s.d||'อื่นๆ';
    catImpact[cat]=(catImpact[cat]||0)+diff;
  });
  if(priceUp+priceDn===0){stripWrap.style.display='none';return;}
  const netAbs=Math.abs(Math.round(netImpact));
  const netUp=netImpact>0;
  const chips=document.getElementById('ov-ps-chips');
  const varEl=document.getElementById('ov-ps-var');
  const catsEl=document.getElementById('ov-price-cats');
  const netEl=document.getElementById('ov-price-net');
  if(chips)chips.innerHTML=(priceUp>0?`<span class="ov-ps-chip up">▲ ${priceUp}</span>`:'')+
    (priceDn>0?`<span class="ov-ps-chip dn">▼ ${priceDn}</span>`:'');
  if(varEl)varEl.textContent=netAbs>0?`ผลกระทบราคา ${netUp?'+':'-'}${fmt(netAbs)}`:'ราคาทรงตัว';
  if(catsEl){
    const top=Object.entries(catImpact).filter(([,v])=>Math.abs(v)>0).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,4);
    catsEl.innerHTML=top.map(([n,v])=>`<div class="ov-price-cat-row"><span class="ov-price-cat-name">${n}</span><span class="ov-price-cat-val ${v>0?'up':'dn'}">${v>0?'+':''}${fmt(Math.round(v))}</span></div>`).join('');
  }
  if(netEl)netEl.innerHTML=`<span>สุทธิ</span><span class="ov-price-cat-val ${netUp?'up':'dn'}">${netUp?'+':'-'}${fmt(netAbs)}/เดือน</span>`;
  stripWrap.style.display='';
}

