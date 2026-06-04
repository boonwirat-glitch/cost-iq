// SECTION:NRR_COMPUTE
function _tgtComputeKamNRR(kamEmail, tlEmail) {
  if (typeof bulkHistoryData === 'undefined' || !bulkHistoryData) return null;
  const allAccounts = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    .filter(a => {
      if (kamEmail) return a.kamEmail === kamEmail;
      if (tlEmail)  return a.tlEmail  === tlEmail;
      return true;
    });
  if (!allAccounts.length) return null;

  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const moSort = m => { const p=(m||'').split(' '); return (parseInt(p[1]||0)*12)+mo.indexOf(p[0]); };

  // prevMonth from Q9 history
  const allMonths = new Set();
  allAccounts.forEach(a => (bulkHistoryData[a.id]||[]).forEach(h => { if(h.m) allMonths.add(h.m); }));
  const sortedMonths = Array.from(allMonths).sort((a,b) => moSort(a)-moSort(b));
  if (!sortedMonths.length) return null;
  const prevMonth = sortedMonths[sortedMonths.length - 1];

  // daysElapsed + currentMonthLabel from bulkCurrentMonthData
  let currentMonthLabel = '';
  let daysElapsed = 0;
  const hasCM = typeof bulkCurrentMonthData !== 'undefined' && bulkCurrentMonthData;
  if (hasCM) {
    for (const a of allAccounts) {
      const cm = bulkCurrentMonthData[a.id];
      if (cm && cm.month_label && cm.days_elapsed > 0) {
        currentMonthLabel = cm.month_label;
        daysElapsed = cm.days_elapsed;
        break;
      }
    }
  }
  // Fallback: compute currentMonthLabel from today's date (match history year format)
  if (!daysElapsed && allAccounts.length) {
    daysElapsed = allAccounts.find(a => a.daysElapsed > 0)?.daysElapsed || 0;
    if (daysElapsed && !currentMonthLabel) {
      const _nd = new Date();
      const _moN = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      // Detect year format from history data (CE ~2024 vs Thai ~2567)
      const _sampleYr = parseInt((Array.from(allMonths)[0]||'').split(' ')[1]||'0');
      const _yr = _sampleYr > 2500 ? _nd.getFullYear() + 543 : _nd.getFullYear();
      currentMonthLabel = _moN[_nd.getMonth()] + ' ' + _yr;
    }
  }
  if (!currentMonthLabel || !daysElapsed) {
    console.warn('%c[Sense NRR] ⚠️ no label/days','color:#f08000',{kamEmail,tlEmail,currentMonthLabel,daysElapsed});
    return null;
  }
  const _nrrGatePass = moSort(currentMonthLabel) > moSort(prevMonth);
  console.log('%c[Sense NRR] gate','color:'+(_nrrGatePass?'#4ddc97':'#ff6b6b')+';font-weight:bold',
    {scope:kamEmail||('TL:'+tlEmail), currentMonth:currentMonthLabel, prevMonth,
     gate:_nrrGatePass?'✓ PASS':'✗ FAIL — NRR=null', daysElapsed, accounts:allAccounts.length});
  if (!_nrrGatePass) return null;

  const prevDays = getThaiMonthDays(prevMonth);
  const hasOutlets = typeof bulkOutletsData !== 'undefined' && bulkOutletsData;
  const hd = (typeof bulkHandoverData !== 'undefined' && bulkHandoverData) ? bulkHandoverData : { byAccountId:{}, byKamName:{} };
  // v251: ใช้ Q11 current movements สำหรับ classify transfer_in vs new_sales
  const cm = (typeof bulkCurrentMovementData !== 'undefined' && bulkCurrentMovementData) ? bulkCurrentMovementData : null;

  // ── Classify accounts into cohorts ─────────────────────────────
  // Core NRR: account อยู่กับ KAM นี้ก่อนเดือนปัจจุบัน
  // Transfer In:    ใหม่เดือนนี้ + มาจาก KAM/PM/ADMIN (Q11 transfer_in)
  // New from Sales: ใหม่เดือนนี้ + มาจาก SALE (Q11 new_sales)
  // v298: OUTLET-LEVEL classification.
  // Q11 (cm) is outlet-grain: each row = ONE outlet that moved. byOutletId keeps every
  // outlet row (vs byAccountId which collapsed to 1 row/account and dragged whole
  // multi-outlet accounts into new_sales). Build per-movement OUTLET SETS, then each
  // account can appear in MULTIPLE groups — e.g. account with 2 core outlets + 1 handover
  // outlet shows correctly as core(2) + handover(1), not all-3 in one bucket.
  const coreAccounts=[], transferInAccounts=[], newFromSalesAccounts=[];
  const transferInOutlets=new Set(), newFromSalesOutlets=new Set(), movedOutlets=new Set();
  const cmByOutlet = (cm && cm.byOutletId) ? cm.byOutletId : null;

  // Build per-account membership from Q11 outlet rows (one pass over Q11)
  const acctMoves = {}; // acctId → {ti:bool, ns:bool}
  if (cmByOutlet) {
    Object.keys(cmByOutlet).forEach(oid => {
      const row = cmByOutlet[oid];
      const mvType = (row.movementType || '').toLowerCase();
      if (mvType === 'transfer_out') return; // not a current-cohort movement
      const key = String(oid);
      movedOutlets.add(key);
      const aid = String(row.accountId==null?'':row.accountId).trim();
      if (!acctMoves[aid]) acctMoves[aid] = {ti:false, ns:false};
      if (mvType === 'transfer_in') { transferInOutlets.add(key); acctMoves[aid].ti=true; }
      else { newFromSalesOutlets.add(key); acctMoves[aid].ns=true; }
    });
  }

  allAccounts.forEach(a => {
    const acctId = String(a.id==null?'':a.id).trim();
    const mv = acctMoves[acctId];
    const hasTI = !!(mv && mv.ti);
    const hasNS = !!(mv && mv.ns);

    // [2] Q10 explicit handover (account-level) — only if account has NO Q11 movement at all
    let hoPrevOwner = null;
    if (!hasTI && !hasNS) {
      const hoRow = hd.byAccountId && hd.byAccountId[a.id];
      if (hoRow) hoPrevOwner = (hoRow.prevOwner || '').toUpperCase();
    }

    if (hasTI) transferInAccounts.push(a);
    if (hasNS) newFromSalesAccounts.push(a);
    if (hoPrevOwner !== null) {
      if (hoPrevOwner === 'SALE') newFromSalesAccounts.push(a);
      else transferInAccounts.push(a);
    }
    // Every account is a core candidate — its non-moved outlets count as core
    // (core path uses a negative filter = exclude movedOutlets).
    coreAccounts.push(a);
  });

  // ── Helper: compute NRR for a group of accounts ─────────────────
  // v298: outletFilter (optional Set of outlet_ids) — when provided, only outlets in the
  // set are included. Used for outlet-level movement groups (new_sales/transfer_in/handover)
  // where Q11 says only SPECIFIC outlets of an account moved, not the whole account.
  // When omitted (core path), all outlets of each account are included as before.
  function _groupNRR(group, outletFilter) {
    if (!group.length) return null;
    const _useFilter = outletFilter instanceof Set && outletFilter.size > 0;
    const _passFilter = oid => !_useFilter || outletFilter.has(String(oid));
    let prevGmvByOutlet={}, currGmvByOutlet={};
    // v_fdd: firstDollarMap tracks all-time first purchase date per outlet_id
    // Used for comeback vs expansion: comeback = first_dollar_date exists AND < prevMonthStart
    // Falls back to everSeen (6-month window) if firstDollarDate not present in CSV (old format)
    const firstDollarMap={}, everSeen=new Set(); // everSeen kept as fallback for old CSV format
    // v206: track outlet→account mapping for drill-down detail
    const outletToAcct={}, outletName={};
    group.forEach(a => {
      const acctName=(typeof bulkAccountNames!=='undefined'&&bulkAccountNames[a.id])||a.name||a.id;
      const outletMonths = hasOutlets ? bulkOutletsData[a.id] : null;
      if (outletMonths && typeof outletMonths === 'object' && !Array.isArray(outletMonths)) {
        Object.entries(outletMonths).forEach(([mLabel,entries]) => {
          if (moSort(mLabel) >= moSort(prevMonth)) return;
          (entries||[]).forEach(o => {
            const oid=o.outlet_id||o.outletId||o.id;
            if(oid) {
              everSeen.add(oid);
              // store first_dollar_date if available (Q5B v3+)
              if(o.firstDollarDate && !firstDollarMap[oid]) firstDollarMap[oid]=o.firstDollarDate;
            }
          });
        });
        (outletMonths[prevMonth]||[]).forEach(o => {
          const oid=o.outlet_id||o.outletId||o.id;
          if(oid && o.gmv>0 && _passFilter(oid)){
            prevGmvByOutlet[oid]=(prevGmvByOutlet[oid]||0)+o.gmv;
            outletToAcct[oid]={acctId:a.id,acctName};
            if(!outletName[oid])outletName[oid]=o.outlet_name||o.outletName||oid;
          }
        });
        (outletMonths[currentMonthLabel]||[]).forEach(o => {
          const oid=o.outlet_id||o.outletId||o.id;
          if(oid && o.gmv>0 && _passFilter(oid)){
            currGmvByOutlet[oid]=(currGmvByOutlet[oid]||0)+o.gmv;
            if(!outletToAcct[oid])outletToAcct[oid]={acctId:a.id,acctName};
            if(!outletName[oid])outletName[oid]=o.outlet_name||o.outletName||oid;
          }
        });
      } else {
        const hist=bulkHistoryData[a.id]||[];
        hist.filter(h=>moSort(h.m)<moSort(prevMonth)).forEach(()=>everSeen.add(a.id));
        const prevRow=hist.find(h=>h.m===prevMonth);
        if(prevRow&&(prevRow.gmv||prevRow.s||0)>0){
          prevGmvByOutlet[a.id]=prevRow.gmv||prevRow.s||0;
          outletToAcct[a.id]={acctId:a.id,acctName};
          outletName[a.id]=acctName;
        }
        const cm=hasCM?bulkCurrentMonthData[a.id]:null;
        if(cm&&cm.gmv_to_date>0){
          currGmvByOutlet[a.id]=cm.gmv_to_date;
          if(!outletToAcct[a.id])outletToAcct[a.id]={acctId:a.id,acctName};
          if(!outletName[a.id])outletName[a.id]=acctName;
        }
      }
    });
    const cohort=Object.keys(prevGmvByOutlet);
    const currentIds=Object.keys(currGmvByOutlet);
    // v207h: comeback/expansion can exist even when there is no prev-month NRR cohort.
    // Do not return null just because cohort is empty; otherwise transfer-in/new-sales current GMV
    // gets hidden and may look like 0 even when the account already purchased this month.
    if(!cohort.length && !currentIds.length) return null;
    const baselinePrevGmv=cohort.reduce((s,id)=>s+(prevGmvByOutlet[id]||0),0);
    const baseCurrGmv=cohort.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0);
    const prevDailyRate=prevDays>0?baselinePrevGmv/prevDays:0;
    const currDailyRate=daysElapsed>0?baseCurrGmv/daysElapsed:0;
    const nrr=prevDailyRate>0?currDailyRate/prevDailyRate:null;
    // v241-fix: rawRetention = actual MTD ÷ baseline (no day-normalization)
    // used for handover/new-sales display to be consistent with _commComputeHandoverRetention
    const rawRetention=baselinePrevGmv>0?baseCurrGmv/baselinePrevGmv:null;
    const nonCohortIds=currentIds.filter(id=>!prevGmvByOutlet[id]);
    // v_fdd: use first_dollar_date for comeback vs expansion when available (all-time history)
    // prevMonthStart = YYYY-MM-01 derived from prevMonth label e.g. 'พ.ค. 2569'
    const _mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const _pmParts=(prevMonth||'').split(' ');
    const _pmMonthIdx=_mo.indexOf(_pmParts[0])+1; // 1-12
    const _pmYear=parseInt(_pmParts[1]||'0');
    const _pmYearCE=_pmYear>2500?_pmYear-543:_pmYear;
    const _pmM=String(_pmMonthIdx).padStart(2,'0');
    const prevMonthStart=(_pmMonthIdx>0&&_pmYearCE>0)?(_pmYearCE+'-'+_pmM+'-01'):null;
    const hasFddData=Object.keys(firstDollarMap).length>0;
    const comebackIds=nonCohortIds.filter(function(id){
      if(hasFddData){
        var fdd=firstDollarMap[id];
        // comeback = has all-time purchase history before prevMonth
        return fdd && prevMonthStart && fdd < prevMonthStart;
      }
      return everSeen.has(id); // fallback: old CSV without firstDollarDate
    });
    const expansionIds=nonCohortIds.filter(function(id){
      if(hasFddData){
        var fdd=firstDollarMap[id];
        // expansion = no purchase history before prevMonth (true new customer)
        return !fdd || !prevMonthStart || fdd >= prevMonthStart;
      }
      return !everSeen.has(id); // fallback: old CSV without firstDollarDate
    });
    // ── v206: build grouped detail arrays ────────────────────────
    function _buildDetail(ids,type){
      // group by account, sort each account's outlets by delta (NRR) or currGmv (CB/EX)
      const byAcct={};
      ids.forEach(oid=>{
        const info=outletToAcct[oid]||{acctId:oid,acctName:oid};
        if(!byAcct[info.acctId])byAcct[info.acctId]={acctId:info.acctId,acctName:info.acctName,outlets:[],prevTotal:0,currTotal:0};
        const prev=prevGmvByOutlet[oid]||0;
        const curr=currGmvByOutlet[oid]||0;
        const delta=prev>0?Math.round((curr-prev)/prev*100):null;
        byAcct[info.acctId].outlets.push({outletId:oid,outletName:outletName[oid]||oid,prevGmv:prev,currGmv:curr,delta});
        byAcct[info.acctId].prevTotal+=prev;
        byAcct[info.acctId].currTotal+=curr;
      });
      return Object.values(byAcct).map(g=>{
        // sort outlets: NRR → delta% asc (worst first); CB/EX → currGmv desc
        g.outlets.sort((a,b)=>type==='nrr'?(a.delta??0)-(b.delta??0):b.currGmv-a.currGmv);
        g.delta=g.prevTotal>0?Math.round((g.currTotal-g.prevTotal)/g.prevTotal*100):null;
        return g;
      }).sort((a,b)=>type==='nrr'?(a.delta??0)-(b.delta??0):b.currTotal-a.currTotal);
    }
    const cohortDetail=_buildDetail(cohort,'nrr');
    const comebackDetail=_buildDetail(comebackIds,'cb');
    const expansionDetail=_buildDetail(expansionIds,'ex');
    return {
      nrr, rawRetention, cohortCount:cohort.length, cohortGmv:baseCurrGmv, baselinePrevGmv,
      comebackGmv:comebackIds.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0),
      comebackCount:comebackIds.length,
      expansionGmv:expansionIds.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0),
      expansionCount:expansionIds.length,
      cohortDetail, comebackDetail, expansionDetail
    };
  }

  console.log('%c[Sense NRR] cohort split','color:#4ddc97',
    {scope:kamEmail||('TL:'+tlEmail), core:coreAccounts.length,
     transfer_in:transferInAccounts.length, new_sales:newFromSalesAccounts.length,
     prevMonth, currentMonth:currentMonthLabel, daysElapsed});
  // v298: outlet filters per group. Core EXCLUDES moved outlets (negative filter);
  // transfer_in / new_sales INCLUDE only their moved outlets (positive filter).
  const coreResult = _groupNRR(coreAccounts, null, movedOutlets);
  const transferInResult = _groupNRR(transferInAccounts, transferInOutlets);
  const newFromSalesResult = _groupNRR(newFromSalesAccounts, newFromSalesOutlets);

  // ── Transfer out: Q11 current_movements (fallback Q10) ──────────
  // v251: ใช้ Q11 transfer_out rows แทน Q10 Apr handover
  let transferOutList = [];
  if (cm && cm.byMovementType && cm.byMovementType['transfer_out']) {
    const allToRows = cm.byMovementType['transfer_out'] || [];
    if (kamEmail) {
      transferOutList = allToRows.filter(r => r.kamEmail === kamEmail || r.kamName === (allAccounts.find(a=>a.kamName)?.kamName||''));
    } else if (tlEmail) {
      const teamKamNames = new Set(allAccounts.map(a => a.kamName).filter(Boolean));
      transferOutList = allToRows.filter(r => teamKamNames.has(r.kamName));
    } else {
      transferOutList = allToRows;
    }
    // map Q11 fields → Q10-compatible shape for downstream rendering
    // v293: keep ownerToType + ownerToName for breakdown display
    transferOutList = transferOutList.map(r => ({
      accountId:    r.accountId,
      accountName:  r.accountName,
      accountType:  r.accountType,
      kamName:      r.ownerFromName,
      newKamName:   r.ownerToName,
      ownerToType:  r.ownerToType || '',
      lastMonthGmv: r.baselineGmv || 0,
      prevOwner:    'KAM',
      transferMonth: r.movementMonth,
    }));
  } else {
    // fallback Q10 Apr
    if (kamEmail) {
      const kamName = allAccounts.find(a => a.kamName)?.kamName || '';
      transferOutList = kamName ? (hd.byKamName[kamName] || []) : [];
    } else if (tlEmail) {
      const teamKamNames = new Set(allAccounts.map(a => a.kamName).filter(Boolean));
      teamKamNames.forEach(n => { (hd.byKamName[n] || []).forEach(r => transferOutList.push(r)); });
    } else {
      const allKamNames = new Set(allAccounts.map(a => a.kamName).filter(Boolean));
      allKamNames.forEach(n => { (hd.byKamName[n] || []).forEach(r => transferOutList.push(r)); });
    }
  }
  // v207h: dedupe transfer-out rows defensively. Q10 should be unique, but TL/Admin aggregation
  // can otherwise double-count if the CSV is regenerated with overlapping old-owner rows.
  const _seenTransferOut = new Set();
  transferOutList = transferOutList.filter(r=>{
    const key=(r.accountId||'')+'|'+(r.kamName||'')+'|'+(r.newKamName||'');
    if(_seenTransferOut.has(key)) return false;
    _seenTransferOut.add(key); return true;
  });
  const transferOutGmv = transferOutList.reduce((s,a)=>s+(a.lastMonthGmv||0),0);
  if (transferOutList.length > 0) {
    console.log('%c[Sense NRR] transfer_out','color:#ff9f7f',
      {scope:kamEmail||('TL:'+tlEmail), count:transferOutList.length,
       total_gmv:Math.round(transferOutGmv),
       accounts:transferOutList.map(a=>a.accountName||a.accountId).slice(0,5).join(', ')
                +(transferOutList.length>5?' …+'+( transferOutList.length-5):'')});
  }
  const _movementGmv = r => (r ? ((r.cohortGmv||0)+(r.comebackGmv||0)+(r.expansionGmv||0)) : 0);

  // ── Build return value (core fields stay backward-compatible) ───
  const core = coreResult || {};
  const _nrrFinalPct = core.nrr!==null&&core.nrr!==undefined ? Math.round(core.nrr*100) : null;
  console.log(
    '%c[Sense NRR] ✓ result', 'color:'+(_nrrFinalPct===null?'#f08000':_nrrFinalPct>=95?'#4ddc97':'#ffb347')+';font-weight:bold',
    { scope: kamEmail||('TL:'+tlEmail),
      nrr: _nrrFinalPct!==null ? _nrrFinalPct+'%' : 'null',
      cohort_gmv:    Math.round(core.cohortGmv||0),
      comeback_gmv:  Math.round(core.comebackGmv||0),
      expansion_gmv: Math.round(core.expansionGmv||0),
      transfer_in_gmv: Math.round(_movementGmv(transferInResult)),
      new_sales_gmv:   Math.round(_movementGmv(newFromSalesResult)),
      cohort_accounts: core.cohortCount||0,
      prevMonth, currentMonth: currentMonthLabel });
  return {
    // Core NRR (backward-compatible fields)
    nrr: core.nrr ?? null,
    daysElapsed, prevDays, prevMonth, currentMonthLabel,
    cohortCount:   core.cohortCount   || 0,
    cohortGmv:     core.cohortGmv     || 0,
    baselinePrevGmv: core.baselinePrevGmv || 0,
    comebackGmv:   core.comebackGmv   || 0,
    comebackCount: core.comebackCount || 0,
    expansionGmv:  core.expansionGmv  || 0,
    expansionCount:core.expansionCount|| 0,
    // v206: drill-down detail arrays (account-grouped, sorted)
    cohortDetail:    core.cohortDetail    || [],
    comebackDetail:  core.comebackDetail  || [],
    expansionDetail: core.expansionDetail || [],
    // Movement groups (v198)
    transferIn: {
      count: transferInAccounts.length,
      // v207h: movement GMV = all current-month GMV in this movement group, not only NRR cohort GMV.
      // This keeps transfer-in with no prev-month cohort from showing as ฿0 when it has CB/EX current GMV.
      gmv:   _movementGmv(transferInResult),
      nrr:   transferInResult?.nrr ?? null,
      cohortGmv: transferInResult?.cohortGmv || 0,
      comebackGmv: transferInResult?.comebackGmv || 0,
      expansionGmv: transferInResult?.expansionGmv || 0,
      cohortDetail: transferInResult?.cohortDetail || [],
      comebackDetail: transferInResult?.comebackDetail || [],
      expansionDetail: transferInResult?.expansionDetail || []
    },
    newFromSales: {
      count: newFromSalesAccounts.length,
      gmv:   _movementGmv(newFromSalesResult),
      nrr:   newFromSalesResult?.rawRetention ?? null,
      cohortGmv: newFromSalesResult?.cohortGmv || 0,
      comebackGmv: newFromSalesResult?.comebackGmv || 0,
      expansionGmv: newFromSalesResult?.expansionGmv || 0,
      cohortDetail: newFromSalesResult?.cohortDetail || [],
      comebackDetail: newFromSalesResult?.comebackDetail || [],
      expansionDetail: newFromSalesResult?.expansionDetail || []
    },
    transferOut: {
      count: transferOutList.length,
      gmv:   transferOutGmv,
      detail: transferOutList
    }
  };
}


// ── NRR Cohort Drill-down Sheet (v206) ──────────────────────────
// _tgtShowCohortSheet(tab, kamLabel)
// tab: 'nrr' | 'cb' | 'ex'
// reads window._ncsLastNrrResult set by renderPortviewTargetBar
function _tgtShowCohortSheet(tab) {
  const nr = window._ncsLastNrrResult;
  const kamLabel = window._ncsKamLabel || '';
  if (!nr) {
    if (typeof showToast === 'function') showToast('\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 NRR \u2014 \u0e42\u0e2b\u0e25\u0e14 portview.csv \u0e01\u0e48\u0e2d\u0e19', '!');
    return;
  }

  // ── Formatting helpers ─────────────────────────────────────────
  const _fmtK = function(v) {
    if (!v) return '\u0e3f0';
    const av = Math.abs(v);
    if (av >= 1000000) return '\u0e3f' + (v / 1000000).toFixed(1) + 'M';
    if (av >= 1000)    return '\u0e3f' + Math.round(v / 1000) + 'K';
    return '\u0e3f' + Math.round(v);
  };

  // ── Days in current month (for run-rate) ─────────────────────
  const _moNames = ['\u0e21.\u0e04.','\u0e01.\u0e1e.','\u0e21\u0e35.\u0e04.','\u0e40\u0e21.\u0e22.','\u0e1e.\u0e04.','\u0e21\u0e34.\u0e22.','\u0e01.\u0e04.','\u0e2a.\u0e04.','\u0e01.\u0e22.','\u0e15.\u0e04.','\u0e1e.\u0e22.','\u0e18.\u0e04.'];
  const _cp = (nr.currentMonthLabel || '').split(' ');
  const _mi = _moNames.indexOf(_cp[0]);
  const _yr = parseInt(_cp[1] || '0') - 543;
  const daysInCurrMonth = (_mi >= 0 && _yr > 1900) ? new Date(_yr, _mi + 1, 0).getDate() : 30;
  const _rr = function(v) { return nr.daysElapsed > 0 ? Math.round(v / nr.daysElapsed * daysInCurrMonth) : v; };

  // ── Ensure overlay + sheet DOM ─────────────────────────────────
  let overlay = document.getElementById('ncs-overlay');
  let sheet   = document.getElementById('ncs-sheet');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'ncs-overlay'; overlay.className = 'ncs-overlay'; overlay.setAttribute('onclick', '_ncsClose()'); document.body.appendChild(overlay); }
  if (!sheet)   { sheet   = document.createElement('div'); sheet.id = 'ncs-sheet'; sheet.className = 'ncs-sheet'; document.body.appendChild(sheet); }

  // ── State ──────────────────────────────────────────────────────
  let activeTab = tab || 'nrr';
  const tabs = [
    {key:'nrr', label:'NRR',       count:nr.cohortCount,    gmv:nr.cohortGmv,    data:nr.cohortDetail,    color:'#1AE87B'},
    {key:'cb',  label:'Comeback',  count:nr.comebackCount,  gmv:nr.comebackGmv,  data:nr.comebackDetail,  color:'#64a0ff'},
    {key:'ex',  label:'Expansion', count:nr.expansionCount, gmv:nr.expansionGmv, data:nr.expansionDetail, color:'#00c8b0'}
  ];

  // ── Tab meta line ─────────────────────────────────────────────
  function _tabMeta(t) {
    if (t.key === 'nrr') return t.count + ' outlets \u00b7 ' + _fmtK(t.gmv) + ' MTD \u00b7 \u0e10\u0e32\u0e19 ' + nr.prevMonth;
    if (t.key === 'cb')  return t.count + ' outlets \u0e01\u0e25\u0e31\u0e1a\u0e21\u0e32\u0e0b\u0e37\u0e49\u0e2d \u00b7 \u0e44\u0e21\u0e48\u0e21\u0e35\u0e22\u0e2d\u0e14 ' + nr.prevMonth;
    return t.count + ' outlets \u0e43\u0e2b\u0e21\u0e48 \u00b7 \u0e44\u0e21\u0e48\u0e40\u0e04\u0e22\u0e0b\u0e37\u0e49\u0e2d\u0e21\u0e32\u0e01\u0e48\u0e2d\u0e19';
  }

  // ── Render account groups (Option B: chip separator + flat outlet rows) ───
  function _renderRows(t) {
    if (!t.data || !t.data.length) return '<div class="ncs-empty">\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25</div>';
    const isNrr = t.key === 'nrr';
    const colCls = isNrr ? 'nrr-cols' : 'simple-cols';
    const cbColor = t.key === 'cb' ? '#64a0ff' : '#00c8b0';

    return t.data.map(function(g, gi) {
      const autoOpen = gi < 4;
      // ── Chip row ────────────────────────────────────────────────
      const chipRR = isNrr ? _fmtK(_rr(g.currTotal)) : _fmtK(g.currTotal);
      const chipColor = isNrr ? 'rgba(26,232,123,.7)' : (t.key === 'cb' ? 'rgba(100,160,255,.8)' : 'rgba(0,200,176,.8)');
      const chip = '<div class="ncs-chip' + (autoOpen ? ' open' : '') + '" onclick="_ncsChipToggle(this)">'
        + '<span class="ncs-chip-chev">&#8250;</span>'
        + '<span class="ncs-chip-name">' + g.acctName + '</span>'
        + '<span class="ncs-chip-rr" style="color:' + chipColor + '">' + chipRR + '</span>'
        + '</div>';

      // ── Outlet rows ─────────────────────────────────────────────
      const outletRows = g.outlets.map(function(o) {
        const nameStr = (o.outletName || '\u2014').slice(0, 38);
        if (isNrr) {
          const rrVal = _rr(o.currGmv);
          const rrCls = rrVal >= o.prevGmv ? 'ncs-gmv rr-up' : 'ncs-gmv rr-dn';
          return '<div class="ncs-outlet-row nrr-cols">'
            + '<div class="ncs-outlet-name">' + nameStr + '</div>'
            + '<div class="ncs-gmv base">' + (o.prevGmv > 0 ? _fmtK(o.prevGmv) : '\u2014') + '</div>'
            + '<div class="' + rrCls + '">' + _fmtK(rrVal) + '</div>'
            + '<div class="ncs-gmv mtd">' + _fmtK(o.currGmv) + '</div>'
            + '</div>';
        } else {
          return '<div class="ncs-outlet-row simple-cols">'
            + '<div class="ncs-outlet-name">' + nameStr + '</div>'
            + '<div class="ncs-gmv" style="text-align:right;color:' + cbColor + '">' + _fmtK(o.currGmv) + '</div>'
            + '</div>';
        }
      }).join('');

      return chip + '<div class="ncs-outlet-rows' + (autoOpen ? ' open' : '') + '">' + outletRows + '</div>';
    }).join('');
  }

  // ── Main render ───────────────────────────────────────────────
  function _render() {
    const t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    const isNrr = t.key === 'nrr';

    const tabStrip = tabs.map(function(x) {
      return '<button class="ncs-tab t-' + x.key + (x.key === activeTab ? ' on' : '') + '" onclick="_ncsSetTab(\'' + x.key + '\')">'
        + x.label + '<br><span style="font-size:9px;opacity:.7">' + x.count + ' outlets</span></button>';
    }).join('');

    const thRow = isNrr
      ? '<div class="ncs-th">Outlet</div>'
        + '<div class="ncs-th r">\u0e10\u0e32\u0e19</div>'
        + '<div class="ncs-th r" style="color:rgba(26,232,123,.65)">Run Rate</div>'
        + '<div class="ncs-th r">MTD</div>'
      : '<div class="ncs-th">Outlet / Account</div>'
        + '<div class="ncs-th r">MTD</div>';

    const colCls = isNrr ? 'nrr-cols' : 'simple-cols';
    const totalColor = t.key === 'nrr' ? '#1AE87B' : t.key === 'cb' ? '#64a0ff' : '#00c8b0';
    const totalPrefix = t.key === 'nrr' ? '' : '+';

    sheet.innerHTML =
      '<div class="ncs-handle"><div></div></div>'
      + '<div class="ncs-header">'
        + '<div class="ncs-title">\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14 GMV \u2014 ' + kamLabel + '</div>'
        + '<div class="ncs-tabs">' + tabStrip + '</div>'
      + '</div>'
      + '<div class="ncs-meta">'
        + '<span class="ncs-meta-text">' + _tabMeta(t) + '</span>'
        + '<button id="ncs-toggle-btn" class="ncs-sort-btn" onclick="_ncsToggleAll()">\u0e22\u0e48\u0e2d\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14</button>'
      + '</div>'
      + '<div class="ncs-tbl-head ' + colCls + '">' + thRow + '</div>'
      + '<div class="ncs-body" id="ncs-body">' + _renderRows(t) + '</div>'
      + '<div class="ncs-total">'
        + '<span class="ncs-total-lbl">\u0e23\u0e27\u0e21 ' + t.label + '</span>'
        + '<span class="ncs-total-val" style="color:' + totalColor + '">' + totalPrefix + _fmtK(t.gmv) + '</span>'
      + '</div>'
      + '<div class="ncs-footer">'
        + '<button class="ncs-btn primary" onclick="_ncsExportCSV()">&#8595; \u0e14\u0e32\u0e27\u0e19\u0e4c\u0e42\u0e2b\u0e25\u0e14 CSV</button>'
        + '<button class="ncs-btn secondary" onclick="_ncsCopyTSV()">&#9112; Copy TSV</button>'
      + '</div>';
  }

  // ── Chip toggle (single account group) ───────────────────────
  window._ncsChipToggle = function(chip) {
    chip.classList.toggle('open');
    var r = chip.nextElementSibling;
    if (r) r.classList.toggle('open');
  };

  // ── Toggle all expand / collapse ─────────────────────────────
  window._ncsToggleAll = function() {
    var body = document.getElementById('ncs-body');
    if (!body) return;
    var chips   = Array.from(body.querySelectorAll('.ncs-chip'));
    var outlets = Array.from(body.querySelectorAll('.ncs-outlet-rows'));
    var anyOpen = outlets.some(function(r) { return r.classList.contains('open'); });
    chips.forEach(function(r)   { r.classList.toggle('open', !anyOpen); });
    outlets.forEach(function(r) { r.classList.toggle('open', !anyOpen); });
    var btn = document.getElementById('ncs-toggle-btn');
    if (btn) btn.textContent = anyOpen ? '\u0e02\u0e22\u0e32\u0e22\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14' : '\u0e22\u0e48\u0e2d\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14';
  };

  // ── Tab switch ───────────────────────────────────────────────
  window._ncsSetTab = function(key) {
    activeTab = key;
    _render();
    var body = document.getElementById('ncs-body');
    if (body) body.scrollTop = 0;
  };

  // ── Export helpers ────────────────────────────────────────────
  function _buildRows(t) {
    const isNrr = t.key === 'nrr';
    const rows = [];
    const hdr = isNrr
      ? ['Account', 'Outlet', 'GMV \u0e10\u0e32\u0e19 (' + nr.prevMonth + ')', 'Run Rate', 'GMV MTD']
      : ['Account', 'Outlet', 'GMV MTD'];
    rows.push(hdr);
    (t.data || []).forEach(function(g) {
      g.outlets.forEach(function(o) {
        if (isNrr) rows.push([g.acctName, o.outletName || o.outletId, Math.round(o.prevGmv), Math.round(_rr(o.currGmv)), Math.round(o.currGmv)]);
        else       rows.push([g.acctName, o.outletName || o.outletId, Math.round(o.currGmv)]);
      });
    });
    return rows;
  }

  window._ncsExportCSV = function() {
    var t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    var rows = _buildRows(t);
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var mo = (nr.currentMonthLabel || '').replace(/\s/g, '_');
    a.href = url; a.download = 'freshket_' + t.label + '_' + kamLabel + '_' + mo + '.csv';
    a.click(); URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('\u0e14\u0e32\u0e27\u0e19\u0e4c\u0e42\u0e2b\u0e25\u0e14 CSV \u0e41\u0e25\u0e49\u0e27', '\u2193');
  };

  window._ncsCopyTSV = function() {
    var t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    var rows = _buildRows(t);
    var tsv = rows.map(function(r) { return r.join('\t'); }).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(function() {
        if (typeof showToast === 'function') showToast('Copy \u0e41\u0e25\u0e49\u0e27 \u2014 paste \u0e25\u0e07 Sheets \u0e44\u0e14\u0e49\u0e40\u0e25\u0e22', '\u2713');
      }).catch(function() {
        if (typeof showToast === 'function') showToast('Copy \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 \u2014 \u0e25\u0e2d\u0e07 CSV \u0e41\u0e17\u0e19', '!');
      });
    }
  };

  window._ncsClose = function() {
    var o = document.getElementById('ncs-overlay');
    var s = document.getElementById('ncs-sheet');
    if (o) o.classList.remove('on');
    if (s) s.classList.remove('on');
  };

  // ── Show ──────────────────────────────────────────────────────
  try {
    _render();
    overlay.classList.remove('on'); sheet.classList.remove('on');
    void overlay.offsetHeight;
    overlay.classList.add('on');
    sheet.classList.add('on');
  } catch(err) {
    if (typeof showToast === 'function') showToast('Sheet error: ' + err.message, '!');
    console.error('[NCS]', err);
  }
}


// ── renderPortviewNRRBar: retired — merged into renderPortviewTargetBar ──
function renderPortviewNRRBar() {
  const bar = document.getElementById('tgt-nrr-bar');
  if (bar) bar.innerHTML = '';
}

// ── Portview NRR + Target Widget ────────────────────────────────
// SECTION:NRR_WIDGET
async function renderPortviewTargetBar() {
  const bar = document.getElementById('tgt-portview-bar');
  if (!bar) return;
  // Debounce: skip if rendered within last 300ms AND same KAM context (prevents flicker)
  // v198c: bypass debounce when portviewLevel/portviewRepEmail changes — fixes TL/Admin stuck transfer data
  const _now = Date.now();
  const _ctxKey = `${(typeof portviewLevel!=='undefined'?portviewLevel:'')}|${(typeof portviewRepEmail!=='undefined'?portviewRepEmail:'')}`;
  if (bar._lastRenderMs && _now - bar._lastRenderMs < 300 && bar._lastCtxKey === _ctxKey) return;
  bar._lastRenderMs = _now;
  bar._lastCtxKey = _ctxKey;

  const role  = (currentUserProfile && currentUserProfile.role)  || 'rep';
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const isTL  = role === 'tl' || role === 'admin';

  // Micro-interaction: show calculating state while awaiting Supabase targets
  if (!_tgtLoaded) {
    const _calcEl=document.getElementById('tgt-nrr-bar');
    if(_calcEl&&!_calcEl.innerHTML.trim()){
      _calcEl.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;color:rgba(255,255,255,.35);font-size:11px"><span class="spl-dot-pulse" style="display:inline-flex;gap:3px">'+'<span style="width:4px;height:4px;border-radius:50%;background:rgba(0,208,112,.4);animation:_dotBlink .9s ease-in-out infinite"></span>'.repeat(3)+'</span>กำลังคำนวณ NRR...</div>';
    }
    await loadTargets(_tgtCurrentQuarter());
    if(_calcEl)_calcEl.innerHTML=''; // clear placeholder before real render
    // Reset debounce: targets freshly loaded — allow immediate re-render on next call
    bar._lastRenderMs = 0;
    // v224e: re-render teamview KAM list so each KAM's pace% uses real target, not baseline
    // (fixes "stuck at baseline" case where KAM cards never updated after targets loaded)
    try{
      if(document.getElementById('scr-teamview')?.classList.contains('on')&&typeof renderTeamviewKamList==='function'){
        setTimeout(()=>{try{renderTeamviewKamList();}catch(e){}},50);
      }
    }catch(e){}
  }

  const now    = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Accounts + run-rate ──────────────────────────────────────
  // v182: TL/admin now filter by tlEmail (was incorrectly using all accounts → inflated runRate)
  const _pvData = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
  const _hasEmailCols = _pvData.some(a => a.kamEmail || a.tlEmail);

  // ── rep-detail: TL/admin drilling into a specific KAM's portfolio ──
  const _repDetail = (typeof portviewLevel !== 'undefined' && portviewLevel === 'rep-detail' &&
                      typeof portviewRepEmail !== 'undefined' && portviewRepEmail);
  const _repEmail  = _repDetail ? portviewRepEmail : null;

  // Admin fallback: admin email ≠ any tlEmail in CSV → show all teams combined
  const _tlHasMatch = !_repDetail && isTL && _hasEmailCols && _pvData.some(a => a.tlEmail === email);
  const _showAll = !_repDetail && isTL && !_tlHasMatch; // admin with no tlEmail match → all accounts
  const accounts = _pvData.filter(a => {
      if (_repDetail) return a.kamEmail === _repEmail || a.kamName === _repEmail; // rep-detail: filter to this KAM
      if (!_hasEmailCols || _showAll) return true;
      if (isTL) return a.tlEmail === email;
      return a.kamEmail === email;
    });
  const withPace = accounts.filter(a => a.paceSignal && a.paceSignal.runrate > 0);
  const runRate = withPace.reduce((s,a) => s+(a.paceSignal.runrate||0), 0);

  // Bug fix: daysElapsed lives on account object, not inside paceSignal
  const daysElapsed = withPace.length ? (withPace[0].daysElapsed || withPace[0].paceSignal?.daysElapsed || 0) : 0;
  const daysInMonth = withPace.length ? (withPace[0].daysInMonth || withPace[0].paceSignal?.daysInMonth || 30) : 30;

  // ── Target: Case A → B → C ──────────────────────────────────
  // In rep-detail mode: always treat as KAM-level target for the viewed KAM
  const _targetEmail = _repDetail ? _repEmail : (_showAll ? null : email);
  const level = _showAll ? 'all' : ((isTL && !_repDetail) ? 'team' : 'kam');
  let target = _showAll
    ? Array.from(new Set(accounts.map(a => a.tlEmail).filter(Boolean))).reduce((s,tl)=>s+(_tgtGet(period,'team',tl)||0),0)
    : _tgtGet(period, level, _targetEmail);
  let fbMode = _showAll && target > 0 ? 'team' : null;

  if (!target && (!isTL || _repDetail)) {
    // Primary: tlEmail from portview CSV col 18
    let tlEmail = accounts.length ? (accounts[0].tlEmail||'') : '';
    // v205b fallback: if CSV missing tl_email col, scan _tgtCache for any team-level entry
    // that belongs to a TL whose accounts overlap with this KAM's accounts
    if (!tlEmail) {
      const kamAccountIds = new Set(accounts.map(a => a.id));
      const allPvData = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
      // Find a row from same squad where tlEmail is known
      const sameSqRow = allPvData.find(a => a.tlEmail && accounts.some(b => b.kamEmail === a.kamEmail));
      if (sameSqRow) tlEmail = sameSqRow.tlEmail;
      // Final fallback: pick first team-level entry in _tgtCache for current period
      if (!tlEmail) {
        const teamKey = Object.keys(_tgtCache).find(k => k.startsWith(period + '|team|'));
        if (teamKey) tlEmail = teamKey.split('|')[2] || '';
      }
    }
    const tlTarget = tlEmail ? _tgtGet(period, 'team', tlEmail) : 0;
    if (tlTarget > 0) {
      const kamBaseline  = _tgtKamBaseline3mo(_targetEmail, null, 'kam');
      const teamBaseline = _tgtKamBaseline3mo(null, tlEmail, 'tl');
      const share = teamBaseline > 0 ? kamBaseline/teamBaseline : 1/Math.max(1,accounts.length);
      target = Math.round(tlTarget * share);
      fbMode = 'team';
    }
  }
  // 3mo avg baseline — for parens display when real/allocated target exists
  const _baseline3mo = _showAll
    ? _tgtKamBaseline3mo(null, null, 'all')
    : _tgtKamBaseline3mo(_repDetail ? _repEmail : (isTL ? null : email), _repDetail ? null : (isTL ? email : null), _repDetail ? 'kam' : (isTL ? 'tl' : 'kam'));

  if (!target) {
    target = _baseline3mo;
    if (target > 0) fbMode = 'base';
  }

  if (!target) {
    bar.style.display = 'none';
    // Self-heal: portviewBulkData or targets may still be loading.
    // Schedule one retry — bypasses debounce so widget recovers without kill+reload.
    if (!bar._healPending) {
      bar._healPending = true;
      setTimeout(() => {
        bar._healPending = false;
        bar._lastRenderMs = 0; // bypass debounce for retry
        try { renderPortviewTargetBar(); } catch(e) {}
      }, 2000);
    }
    return;
  }
  bar._healPending = false; // render succeeded — clear retry flag

  // ── Pace % ───────────────────────────────────────────────────
  const pct = Math.round(runRate / target * 100);
  const cls = pct>=105?'great':pct>=100?'safe':pct>=90?'warn':'danger';

  // ── NRR computation ──────────────────────────────────────────
  // v182: pass tlEmail as second arg for TL so NRR is scoped to team only
  // rep-detail: admin/TL viewing a specific KAM → use that KAM's email, not admin email
  //
  // v225g: outlets gate — without bulkOutletsData, _tgtComputeKamNRR gives account-level NRR
  // (not outlet-level), causing wrong NRR%/Comeback%/Expansion% at first render.
  // If outlets not loaded yet: skip NRR computation → nrrPct=null → shimmer shown.
  // When outlets arrive, RenderBus re-renders → key changes ('loading'→actual) → correct values.
  // v225g fix2: check if outlets FILE was ingested, not if it has data.
  // bulkOutletsData = {accountId: months} — empty {} if KAM has no outlet accounts.
  // Object.keys({}).length === 0 → _outletsReady always false → shimmer never resolves.
  // Correct: use _cloudLoadedTabs.has('outlets') (set after ingest, cleared during ETag refresh).
  const _outletsReady = (function(){
    try{ return typeof _cloudLoadedTabs !== 'undefined' && _cloudLoadedTabs.has('outlets'); }
    catch(e){ return typeof bulkOutletsData !== 'undefined' && bulkOutletsData && Object.keys(bulkOutletsData).length > 0; }
  })();

  const nrrResult = _outletsReady
    ? (_repDetail
        ? _tgtComputeKamNRR(_repEmail, null)
        : (_showAll ? _tgtComputeKamNRR(null, null) : _tgtComputeKamNRR(isTL ? null : email, isTL ? email : null)))
    : null;
  let nrrPct=null, cohortGmv=0, cbGmv=0, exGmv=0;
  let cohortCount=0, cbCount=0, exCount=0, baselinePrevGmv=0;

  if (nrrResult && nrrResult.nrr !== null) {
    nrrPct      = Math.round(nrrResult.nrr * 100);
    cohortGmv   = nrrResult.cohortGmv    || 0;
    cbGmv       = nrrResult.comebackGmv  || 0;
    exGmv       = nrrResult.expansionGmv || 0;
    cohortCount = nrrResult.cohortCount  || 0;
    cbCount     = nrrResult.comebackCount  || 0;
    exCount     = nrrResult.expansionCount || 0;
    baselinePrevGmv = nrrResult.baselinePrevGmv || 0;
  }

  // ── Bar: simple proportional segments within min(pct,100)% fill ─
  // Segments color the fill; bar edge = 100% of target (no confusion)
  const barFill = Math.min(pct, 100); // total bar fill %
  const totalSegGmv = cohortGmv + cbGmv + exGmv;
  let nrrBarW, cbBarW, exBarW;
  if (nrrResult && totalSegGmv > 0) {
    nrrBarW = +(barFill * cohortGmv / totalSegGmv).toFixed(2);
    cbBarW  = +(barFill * cbGmv     / totalSegGmv).toFixed(2);
    exBarW  = +(barFill * exGmv     / totalSegGmv).toFixed(2);
    // absorb rounding remainder into nrr
    nrrBarW = +(barFill - cbBarW - exBarW).toFixed(2);
  } else {
    nrrBarW = barFill; cbBarW = 0; exBarW = 0;
  }
  const segFull = nrrBarW > 0 && cbBarW === 0 && exBarW === 0 ? ' seg-full' : '';
  // Store pct + fbMode globally so compact strips can sync — KAM, TL, Admin all use same value
  window._tgtPortviewPct = pct;
  window._tgtFbMode = fbMode; // null=real target, 'team'=allocated, 'base'=baseline avg
  // Refresh compact strips so they show identical % as the full widget
  if (typeof _pvBuildCompactStrip === 'function') setTimeout(_pvBuildCompactStrip, 0);
  if (typeof _tvBuildCompactStrip === 'function') setTimeout(_tvBuildCompactStrip, 0);

  // ── Pct legend (hide if 0; shimmer if outlets not yet loaded) ────
  // v225g: outlets not ready → show shimmer pill instead of wrong NRR%
  const _nrrShimmer = `<span class="tgt-pl-item" style="display:inline-flex;align-items:center;gap:4px"><span class="tgt-pl-dot nrr" style="opacity:.3"></span><span style="display:inline-block;width:52px;height:10px;border-radius:5px;background:rgba(255,255,255,.08);animation:_dotBlink 1.2s ease-in-out infinite"></span></span>`;
  const nrrLeg = !_outletsReady
    ? _nrrShimmer
    : (nrrPct !== null
        ? `<span class="tgt-pl-item"><span class="tgt-pl-dot nrr"></span><span class="tgt-pl-lbl">NRR</span>&thinsp;<span class="tgt-pl-val nrr">${nrrPct}%</span></span>`
        : '');
  const cbPct  = baselinePrevGmv>0&&cbGmv>0 ? '+'+Math.round(cbGmv/baselinePrevGmv*100)+'%' : null;
  const exPct  = baselinePrevGmv>0&&exGmv>0 ? '+'+Math.round(exGmv/baselinePrevGmv*100)+'%' : null;
  const cbLeg  = cbPct ? `<span class="tgt-pl-item"><span class="tgt-pl-dot comeback"></span><span class="tgt-pl-lbl">Comeback</span>&thinsp;<span class="tgt-pl-val comeback">${cbPct}</span></span>` : '';
  const exLeg  = exPct ? `<span class="tgt-pl-item"><span class="tgt-pl-dot expansion"></span><span class="tgt-pl-lbl">Expansion</span>&thinsp;<span class="tgt-pl-val expansion">${exPct}</span></span>` : '';

  // ── Setup button ─────────────────────────────────────────────
  const setupBtn = ''; // removed — Target button now in portview/teamview header

  // ── GMV detail section ────────────────────────────────────────
  window._ncsLastNrrResult = nrrResult;
  window._ncsKamLabel = _repDetail ? (_repEmail||'').split('@')[0] : (isTL ? (accounts[0]?.kamName||'ทีม') : email.split('@')[0]);
  const gmvSection = nrrResult ? `
    <div class="tgt-det-section">
      <div class="tgt-det-stitle">GMV รายประเภท</div>
      <div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('nrr')">
        <div class="tgt-det-dot" style="background:#4ddc97"></div><span class="tgt-det-lbl">NRR</span><span class="tgt-det-val" style="color:#4ddc97">${_tgtFmtM(cohortGmv)}</span><span class="tgt-det-count">${cohortCount} outlets</span><span class="ncs-row-btn">ดู ›</span></div>
      ${cbGmv>0?`<div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('cb')"><div class="tgt-det-dot" style="background:#64a0ff"></div><span class="tgt-det-lbl">Comeback</span><span class="tgt-det-val" style="color:#64a0ff">+${_tgtFmtM(cbGmv)}</span><span class="tgt-det-count">${cbCount} outlets</span><span class="ncs-row-btn" style="color:#64a0ff;border-color:rgba(100,160,255,.3)">ดู ›</span></div>`:''}
      ${exGmv>0?`<div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('ex')"><div class="tgt-det-dot" style="background:#00c8b0"></div><span class="tgt-det-lbl">Expansion</span><span class="tgt-det-val" style="color:#00c8b0">+${_tgtFmtM(exGmv)}</span><span class="tgt-det-count">${exCount} outlets</span><span class="ncs-row-btn" style="color:#00c8b0;border-color:rgba(0,200,176,.3)">ดู ›</span></div>`:''}
    </div>` : '';

  // ── Baseline formula section ──────────────────────────────────
  let baselineSection = '';
  if (typeof bulkHistoryData !== 'undefined' && bulkHistoryData) {
    const _mo2 = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const _ms2 = m => { const p=(m||'').split(' '); return (parseInt(p[1]||0)*12)+_mo2.indexOf(p[0]); };
    const allM2 = new Set();
    accounts.forEach(a => (bulkHistoryData[a.id]||[]).forEach(h => { if(h.m) allM2.add(h.m); }));
    // v205c: exclude current month from baseline (same as _tgtKamBaseline3mo — avoids partial MTD skew)
    const _nowBS = new Date();const _lagBS=new Date(_nowBS);_lagBS.setDate(_lagBS.getDate()-1); // day-1 lag
    const _curMoBS = _mo2[_lagBS.getMonth()] + ' ' + (_lagBS.getFullYear() + 543);
    const last3m = Array.from(allM2).filter(m => m !== _curMoBS).sort((a,b)=>_ms2(a)-_ms2(b)).slice(-3);
    const hasOutlets2 = typeof bulkOutletsData !== 'undefined' && bulkOutletsData;
    if (last3m.length) {
      // v205c: dedup accounts by id — prevents double-counting if portview.csv has duplicate rows
      const _dedupAccts = Array.from(new Map(accounts.map(a=>[a.id,a])).values());
      const rows3 = last3m.map(m => {
        const gmv = _dedupAccts.reduce((s,a) => { const r=(bulkHistoryData[a.id]||[]).find(h=>h.m===m); return s+(r?(r.gmv||r.s||0):0); }, 0);
        const days = getThaiMonthDays(m);
        // Count unique outlets that month
        let outletCount = 0;
        if (hasOutlets2) {
          const seen = new Set();
          accounts.forEach(a => { (((bulkOutletsData[a.id]||{})[m])||[]).forEach(o => { const id=o.outlet_id||o.outletId||o.id; if(id&&o.gmv>0) seen.add(id); }); });
          outletCount = seen.size;
        }
        return { m, gmv, days, daily: days>0?Math.round(gmv/days):0, outletCount };
      });
      const avgDaily = Math.round(rows3.reduce((s,r)=>s+r.daily,0)/rows3.length);
      const fmlRows = rows3.map(r=>`<div class="tgt-fml-row"><span class="tgt-fml-mo">${r.m}</span><span class="tgt-fml-eq">${_tgtFmtM(r.gmv)} ÷ ${r.days}d × ${daysInMonth}d${r.outletCount>0?' · '+r.outletCount+' outlets':''}</span><span class="tgt-fml-res">~${_tgtFmtM(Math.round(r.daily*daysInMonth))}/เดือน</span></div>`).join('');
      baselineSection = `<div class="tgt-det-section">
        <div class="tgt-det-stitle">วิธีคำนวณ Baseline</div>
        ${fmlRows}
        <div class="tgt-fml-total"><span class="tgt-fml-total-lbl">avg ${rows3.length} เดือน (normalized)</span><span class="tgt-fml-total-val">= ${_tgtFmtM(avgDaily*daysInMonth)}/เดือน</span></div>
      </div>`;
    }
  }

  // ── Movement rows (v198) ─────────────────────────────────────
  const fmtK = v => v>=1000000?'฿'+(v/1000000).toFixed(1)+'M':v>=1000?'฿'+(v/1000).toFixed(0)+'K':'฿'+Math.round(v);
  const nrrColor = n => n===null?'rgba(255,255,255,.3)':n>=1?'#4ddc97':n>=0.9?'rgba(240,176,0,.9)':'rgba(255,100,100,.9)';
  const nrrPctStr = n => n===null?'—':Math.round(n*100)+'%';
  const mvRows = [];
  if (nrrResult && nrrResult.transferIn && nrrResult.transferIn.count > 0) {
    const ti = nrrResult.transferIn;
    mvRows.push(`<div class="tgt-mv-row"><span class="tgt-mv-label">Transfer in</span><span class="tgt-mv-count">${ti.count} ร้าน</span><span class="tgt-mv-gmv">${fmtK(ti.gmv)}</span><span class="tgt-mv-nrr" style="color:${nrrColor(ti.nrr)}">${nrrPctStr(ti.nrr)}</span></div>`);
  }
  if (nrrResult && nrrResult.newFromSales && nrrResult.newFromSales.count > 0) {
    const ns = nrrResult.newFromSales;
    mvRows.push(`<div class="tgt-mv-row"><span class="tgt-mv-label">New (Sales)</span><span class="tgt-mv-count">${ns.count} ร้าน</span><span class="tgt-mv-gmv">${fmtK(ns.gmv)}</span><span class="tgt-mv-nrr" style="color:${nrrColor(ns.nrr)}">${nrrPctStr(ns.nrr)}</span></div>`);
  }
  if (nrrResult && nrrResult.transferOut && nrrResult.transferOut.count > 0) {
    const to = nrrResult.transferOut;
    mvRows.push(`<div class="tgt-mv-row tgt-mv-out"><span class="tgt-mv-label">Transfer out</span><span class="tgt-mv-count">${to.count} ร้าน</span><span class="tgt-mv-gmv tgt-mv-neg">−${fmtK(to.gmv)}</span><span class="tgt-mv-nrr" style="color:rgba(255,255,255,.3)">—</span></div>`);
  }
  const mvSection = mvRows.length ? `<div class="tgt-mv-wrap">
    <div class="tgt-mv-header"><span class="tgt-mv-label">การเคลื่อนไหวพอร์ต</span><span class="tgt-mv-count">ร้าน</span><span class="tgt-mv-gmv">GMV</span><span class="tgt-mv-nrr">NRR</span></div>
    ${mvRows.join('')}
  </div>` : '';

  // ── NRR formula + cohort definition for ⓘ panel ──────────────

  let nrrSection = '';
  if (nrrResult && nrrPct !== null) {
    const prevDaily = nrrResult.prevDays>0 ? Math.round(nrrResult.baselinePrevGmv/nrrResult.prevDays) : 0;
    const currDaily = nrrResult.daysElapsed>0 ? Math.round(nrrResult.cohortGmv/nrrResult.daysElapsed) : 0;
    const prevNorm = Math.round(prevDaily * daysInMonth);
    const currNorm = Math.round(currDaily * daysInMonth);
    // Movement summary for ⓘ panel
    const hasMv = nrrResult.transferIn?.count||nrrResult.newFromSales?.count||nrrResult.transferOut?.count;
    const mvDefSection = hasMv ? `<div class="tgt-det-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="tgt-det-stitle" style="margin-bottom:0">นิยาม Portfolio Movement</div>
        <button onclick="var d=this.parentElement.nextElementSibling;d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▾ ดูนิยาม':'▴ ซ่อน'" style="font-size:9px;color:rgba(255,255,255,.4);background:none;border:none;cursor:pointer;padding:0;font-family:'IBM Plex Sans Thai',sans-serif">▾ ดูนิยาม</button>
      </div>
      <div style="display:none">
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:#4ddc97">Core NRR</span><span class="tgt-fml-eq" style="font-size:10px">account ที่อยู่กับ KAM นี้ก่อนเดือนนี้ และไม่อยู่ใน transfer_in/handover list — วัด retention จริง</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(140,180,255,.9)">Transfer in</span><span class="tgt-fml-eq" style="font-size:10px">account ที่โอนมาจาก KAM อื่นในเดือนนี้ — วัด NRR ต่อเนื่องหลังรับโอน</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(0,200,176,.9)">New (Sales)</span><span class="tgt-fml-eq" style="font-size:10px">account ที่ Sales ปิดดีล แล้วโอนมา KAM เดือนนี้ — วัด onboarding success</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(255,140,100,.8)">Transfer out</span><span class="tgt-fml-eq" style="font-size:10px">account ที่ออกจากพอร์ตนี้ไปเดือนนี้ — GMV เดือนก่อนของ account เหล่านั้น</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start;margin-top:4px"><span class="tgt-fml-mo" style="color:rgba(255,255,255,.3)">Graduation</span><span class="tgt-fml-eq" style="font-size:10px">Transfer in / New จะกลายเป็น Core NRR อัตโนมัติเดือนหน้า โดยใช้ GMV เต็มเดือนนี้เป็น baseline</span></div>
      </div>
    </div>` : '';
    nrrSection = `<div class="tgt-det-section">
      <div class="tgt-det-stitle">Core NRR — วิธีคำนวณ</div>
      <div style="font-size:11px;color:rgba(255,255,255,.65);margin-bottom:8px;line-height:1.5">NRR วัดว่าร้านเดิมยังซื้ออยู่มากน้อยแค่ไหนเทียบกับเดือนก่อน — โดยประมาณจากยอด MTD × ${daysInMonth} วัน</div>
      <div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:6px">เฉพาะร้านที่อยู่ในพอร์ตมาตั้งแต่เดือนก่อน</div>
      <div class="tgt-fml-row"><span class="tgt-fml-mo">${nrrResult.prevMonth}</span><span class="tgt-fml-eq">${_tgtFmtM(nrrResult.baselinePrevGmv)} ÷ ${nrrResult.prevDays}d × ${daysInMonth}d · ${nrrResult.cohortCount} outlets</span><span class="tgt-fml-res">~${_tgtFmtM(prevNorm)}/เดือน</span></div>
      <div class="tgt-fml-row"><span class="tgt-fml-mo">${nrrResult.currentMonthLabel} MTD</span><span class="tgt-fml-eq">${_tgtFmtM(nrrResult.cohortGmv)} ÷ ${nrrResult.daysElapsed}d × ${daysInMonth}d · ${nrrResult.cohortCount} outlets</span><span class="tgt-fml-res">~${_tgtFmtM(currNorm)}/เดือน</span></div>
      <div class="tgt-fml-total"><span class="tgt-fml-total-lbl">~${_tgtFmtM(currNorm)} ÷ ~${_tgtFmtM(prevNorm)}</span><span class="tgt-fml-total-val">= Core NRR ${nrrPct}%</span></div>
    </div>${mvDefSection}`;
  }

  // ── IDs ──────────────────────────────────────────────────────
  const detPanelId = 'tgt-dp-'+(isTL?'tl':email.replace(/\W/g,'_'));
  const detHandleId= 'tgt-dh-'+(isTL?'tl':email.replace(/\W/g,'_'));

  // ── Target color code ─────────────────────────────────────────
  const targetCls = fbMode===null ? 'tgt-real' : fbMode==='team' ? 'tgt-alloc' : 'tgt-base';
  const denomTilde = fbMode ? '~' : '';

  bar.className = fbMode==='team'?'fb-team':fbMode==='base'?'fb-base':'';
  // Ensure pace bar is hidden — tgt bar is the single visible widget (v190)
  const oldBar = document.getElementById('portview-pace-bar');
  if (oldBar) oldBar.style.display = 'none';
  bar.style.display = target > 0 ? 'block' : 'none';
  bar.style.opacity = '1';
  bar.classList.remove('tgt-skeleton');
  if (!target) {
    // No target set — reveal legacy pace bar as fallback (v190)
    if (oldBar) oldBar.style.display = 'block';
    return;
  }
  // Value guard: skip re-render only if BOTH pace% AND nrr state are unchanged
  // v224d fix: nrrPct must be part of key — otherwise widget won't update when history.csv loads late
  const _existingPctEl = bar.querySelector('#tgt-pct-num');
  // v225g: include outlets state in key — forces re-render when outlets arrive (shimmer→real)
  const _renderKey = `${pct}|${_outletsReady ? (nrrPct !== null ? nrrPct : 'x') : 'loading'}`;
  if (_existingPctEl && _existingPctEl.dataset.renderKey === _renderKey) return;
  if (_existingPctEl) _existingPctEl.dataset.renderKey = _renderKey;

  void bar.offsetHeight;
  const colorKeySection = `<div class="tgt-det-section">
    <div class="tgt-det-stitle">สีของตัวเลข เป้าหมาย</div>
    <div class="tgt-color-key">
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:#4ddc97"></div><span class="tgt-ck-lbl">สีเขียว = Target จริงที่ TL ตั้ง</span></div>
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:var(--amb,#f0b000)"></div><span class="tgt-ck-lbl">อำพัน = ประมาณการจากโควต้าทีม</span></div>
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.2)"></div><span class="tgt-ck-lbl">ขาวหมอง = baseline avg 3 เดือน (ยังไม่มี Target)</span></div>
    </div>
  </div>`;

  const overflowBadge = pct > 100
    ? `<span class="tgt-overflow-badge">+${pct-100}%</span>`
    : '';

  bar.innerHTML = `
    <div class="tgt-bar-header">
      <div class="tgt-bar-left">
        <span id="tgt-pct-num" class="tgt-bar-pct ${cls}">${pct}%</span>
        ${daysElapsed>0?`<span class="tgt-bar-days-inline">${daysElapsed} / ${daysInMonth} วัน</span>`:''}
      </div>
      <div class="tgt-bar-right">
        <div class="tgt-rr-label">RUN RATE</div>
        <div class="tgt-rr-row">
          <span class="tgt-rr-actual">${_tgtFmtM(runRate)}</span>
          <span class="tgt-rr-sep">/</span>
          <span class="tgt-rr-target ${targetCls}">${denomTilde}${_tgtFmtM(target)}</span>
          ${(fbMode!=='base'&&_baseline3mo>0)?`<span style="font-size:11px;color:rgba(255,255,255,.55);margin-left:3px">(${_tgtFmtM(_baseline3mo)})</span>`:``}
        </div>
      </div>
    </div>
    <div class="tgt-seg-wrap">
      ${nrrBarW>0?`<div class="tgt-seg nrr${segFull}" style="left:0;width:${nrrBarW}%"></div>`:''}
      ${cbBarW>0?`<div class="tgt-seg comeback" style="left:${nrrBarW}%;width:${cbBarW}%"></div>`:''}
      ${exBarW>0?`<div class="tgt-seg expansion" style="left:${nrrBarW+cbBarW}%;width:${exBarW}%"></div>`:''}
    </div>
    <div class="tgt-pct-legend">
      ${nrrLeg}${cbLeg}${exLeg}
      ${overflowBadge}
      ${setupBtn}
      <button class="tgt-info-btn${false?' open':''}" id="${detHandleId}" onclick="_tgtToggleDetail('${detPanelId}','${detHandleId}')">i</button>
    </div>
    ${mvSection}
    <div class="tgt-detail-panel" id="${detPanelId}">
      ${gmvSection}${nrrSection}${baselineSection}${colorKeySection}
    </div>`;

}

function _tgtToggleDetail(panelId, handleId) {
  const p=document.getElementById(panelId);
  const h=document.getElementById(handleId);
  if(!p||!h) return;
  const open=p.classList.toggle('open');
  h.classList.toggle('open',open);
}

// ── Teamview: target rows are now rendered in the main KAM card metrics ───────
function _tgtInjectTeamviewTargetRows() {
  // v207f: no-op by design. Teamview cards already use runRate ÷ target when targets exist,
  // so appending a second target row would create duplicate/conflicting signals.
  return;
}

// ── Utility helpers ─────────────────────────────────────────────
function _tgtSafeId(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function _tgtGetKamsForTL(tlEmail) {
  const kamMap = {};
  if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
    portviewBulkData.filter(r => !tlEmail || r.tlEmail === tlEmail).forEach(r => {
      const email = r.kamEmail || '';
      const name = r.kamName || email;
      if (email && !kamMap[email]) kamMap[email] = { email, name };
    });
  }
  return Object.values(kamMap);
}

function _tgtKamBaseline3mo(kamEmail, tlEmail, mode) {
  // Method C: avg daily rate across last 3 closed months × days in current month
  if (typeof bulkHistoryData === 'undefined') return 0;
  const accounts = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    .filter(a => {
      if (mode === 'kam' && kamEmail) return a.kamEmail === kamEmail;
      if (mode === 'tl' && tlEmail) return a.tlEmail === tlEmail;
      return true;
    });
  if (!accounts.length) return 0;
  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const moSort = m => { const p = (m||'').split(' '); return (parseInt(p[1]||0)*12) + mo.indexOf(p[0]); };
  const allMonths = new Set();
  accounts.forEach(a => (bulkHistoryData[a.id] || []).forEach(h => { if (h.m) allMonths.add(h.m); }));
  // v205c: exclude current month (MTD partial data skews daily rate down)
  const _now3mo = new Date();const _lag3mo=new Date(_now3mo);_lag3mo.setDate(_lag3mo.getDate()-1); // day-1 lag
  const _curMonthLabel3mo = mo[_lag3mo.getMonth()] + ' ' + (_lag3mo.getFullYear() + 543);
  const last3 = Array.from(allMonths)
    .filter(m => m !== _curMonthLabel3mo)
    .sort((a,b) => moSort(a)-moSort(b))
    .slice(-3);
  if (!last3.length) return 0;
  // Sum GMV per month, normalize by days in that month → get avg daily rate
  const dailyRates = last3.map(m => {
    const monthGmv = accounts.reduce((s, a) => {
      const row = (bulkHistoryData[a.id] || []).find(h => h.m === m);
      return s + (row ? (row.gmv || row.s || 0) : 0);
    }, 0);
    const days = getThaiMonthDays(m);
    return days > 0 ? monthGmv / days : 0;
  });
  const avgDailyRate = dailyRates.reduce((s,v) => s+v, 0) / last3.length;
  // × days in current month (from paceSignal or calendar)
  // v205c fix: daysInMonth is top-level on account object, NOT inside paceSignal
  // a.paceSignal.daysInMonth is always undefined → was defaulting to 30 even in 31-day months
  let daysInCurrentMonth = 30;
  for (const a of accounts) {
    const dim = a.daysInMonth || (a.paceSignal && a.paceSignal.daysInMonth) || 0;
    if (dim > 0) { daysInCurrentMonth = dim; break; }
  }
  return Math.round(avgDailyRate * daysInCurrentMonth);
}

// ── Hook into existing render pipeline ─────────────────────────
// Patch renderTeamviewKamList to inject target rows
const _origRenderTeamviewKamList = typeof renderTeamviewKamList === 'function' ? renderTeamviewKamList : null;
if (_origRenderTeamviewKamList) {
  window.renderTeamviewKamList = function() {
    _origRenderTeamviewKamList.apply(this, arguments);
    requestAnimationFrame(()=>setTimeout(() => _tgtInjectTeamviewTargetRows(), 120));
  };
}

// ── Admin button in teamview header ────────────────────────────
// Inject "ตั้ง Target" button into tv-pace-bar area for admin/TL
function _tgtInjectAdminBtn() {
  // v193i: Target button moved to teamview header (tv-target-btn) — no longer injected here
  return;
  const role = (currentUserProfile && currentUserProfile.role) || 'rep';
  if (role !== 'tl' && role !== 'admin') return;
  const tvBar = document.getElementById('tv-pace-bar');
  if (!tvBar) return;
  if (document.getElementById('tgt-tv-admin-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'tgt-tv-admin-btn';
  btn.className = 'tgt-admin-btn';
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> ตั้ง Target`;
  btn.onclick = () => openTargetSetup(role === 'admin' ? 'admin' : 'tl');
  tvBar.parentNode.insertBefore(btn, tvBar);
}

// ── Inject target bar placeholder into portview HTML ──────────
function _injectPortviewBarEl() {
  const ref = document.getElementById('portview-pace-bar');
  if (ref) {
    if (!document.getElementById('tgt-portview-bar')) {
      const div = document.createElement('div');
      div.id = 'tgt-portview-bar';
      div.style.display = 'none';
      ref.parentNode.insertBefore(div, ref);
    }
    if (!document.getElementById('tgt-nrr-bar')) {
      const nrrDiv = document.createElement('div');
      nrrDiv.id = 'tgt-nrr-bar';
      ref.parentNode.insertBefore(nrrDiv, ref);
    }
  }
}
// Run immediately + on DOM ready (portview may not exist yet at parse time)
_injectPortviewBarEl();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectPortviewBarEl);
} else {
  setTimeout(_injectPortviewBarEl, 500);
}

// ── v224e: Pre-load targets from localStorage at module parse time ──
// Runs synchronously before first refreshAll — _tgtLoaded=true means first render uses real target,
// not 3-month baseline fallback. Eliminates baseline→target flash on TL teamview.
(function _tgtPreloadFromLocalStorage(){
  try{
    const _q=_tgtCurrentQuarter();
    const _raw=localStorage.getItem('sense_tgt_ls_'+_q);
    if(!_raw)return;
    const _obj=JSON.parse(_raw);
    if(!_obj||!_obj.ts||!_obj.data)return;
    if(Date.now()-_obj.ts>24*60*60*1000)return; // stale after 24h
    const d=_obj.data;
    _tgtCache={...(d.cache||{})};
    _tgtSettings={...(d.settings||{nrr_threshold:98})};
    _nrrGovPolicies={...(d.nrrPolicies||{})};
    _commRuleConfig=JSON.parse(JSON.stringify(d.commRules||{plans:{},rules:{},tiers:{}}));
    _nrrExclusions=JSON.parse(JSON.stringify(d.nrrExclusions||[]));
    _commissionSnapshots=JSON.parse(JSON.stringify(d.commissionSnapshots||[]));
    _tgtQuarterCache[_q]={cache:{..._tgtCache},settings:{..._tgtSettings},nrrPolicies:{..._nrrGovPolicies},
      commRules:JSON.parse(JSON.stringify(_commRuleConfig)),nrrExclusions:JSON.parse(JSON.stringify(_nrrExclusions)),
      commissionSnapshots:JSON.parse(JSON.stringify(_commissionSnapshots)),ts:_obj.ts};
    _tgtLoaded=true;
  }catch(e){}
})();

// ── Init: poll for portview visibility on startup ──────────────
setTimeout(async function _tgtInitCheck() {
  const role = (currentUserProfile && currentUserProfile.role) || '';
  if (!role) { setTimeout(_tgtInitCheck, 600); return; }
  // v224e render-gate: wait for portview+history data before NRR render
  // prevents NRR bar rendering with ฿0 then re-rendering with real value
  if (typeof allCriticalReady === 'function' && !allCriticalReady()) {
    setTimeout(_tgtInitCheck, 400); return;
  }
  _injectPortviewBarEl();
  await loadTargets(_tgtCurrentQuarter());
  renderPortviewTargetBar();
  renderPortviewNRRBar();
  _tgtInjectAdminBtn();
  try{
    const tv=document.getElementById('scr-teamview');
    if(tv && tv.classList.contains('on')){
      if(typeof renderTeamviewSummary==='function') renderTeamviewSummary();
      if(typeof renderTeamviewKamList==='function') renderTeamviewKamList();
    }
  }catch(e){ console.warn('[target init] teamview refresh', e); }
  _tgtInjectTeamviewTargetRows();
}, 1500);

// Also hook into portview renders directly
const _origRPL_tgt = typeof renderPortviewList === 'function' ? renderPortviewList : null;
if (_origRPL_tgt && !window._tgtPortviewHooked) {
  window._tgtPortviewHooked = true;
  const _prev = window.renderPortviewList;
  window.renderPortviewList = function() {
    _prev && _prev.apply(this, arguments);
    _injectPortviewBarEl(); setTimeout(() => { renderPortviewTargetBar(); renderPortviewNRRBar(); }, 80);
  };
}



// ── Commission Render Gate (v224e) ─────────────────────────────────────
// Single entry point for all commission UI renders on startup.
// Renders ONCE when role AND allCriticalReady() are both true.
// Deduplicates: skips re-render if underlying data hasn't changed.
// Eliminates the 7-render cascade (DOMContentLoaded × 3 timers + setInterval)
// that caused commission numbers to flicker on every login.
(function(){
  'use strict';
  var _lastCommKey = '';
  var _hooked = false;

  function _dataKey(){
    try{
      var ph = (typeof portviewBulkData!=='undefined' && portviewBulkData) ? portviewBulkData.length : -1;
      var hh = (typeof bulkHistoryData!=='undefined' && bulkHistoryData) ? Object.keys(bulkHistoryData).length : -1;
      var r  = (typeof getCurrentRole==='function') ? getCurrentRole()
                : ((window.currentUserProfile&&window.currentUserProfile.role)||'');
      return r + ':' + ph + ':' + hh;
    }catch(e){ return ''; }
  }

  function _commGatedRender(){
    var r = (typeof getCurrentRole==='function') ? getCurrentRole()
            : ((window.currentUserProfile&&window.currentUserProfile.role)||'');
    if (!r) return;
    if (typeof allCriticalReady==='function' && !allCriticalReady()) return;
    var key = _dataKey();
    if (!key || key === _lastCommKey) return;
    _lastCommKey = key;
    try{ if(typeof syncCommissionAdminVisibility==='function') syncCommissionAdminVisibility(); }catch(e){}
    try{ if(typeof ensureKamCommissionCard==='function') ensureKamCommissionCard(); }catch(e){}
  }

  window._commGatedRender = _commGatedRender;

  // Reset key on each refreshAll so commission re-renders after data refresh
  function _hookRefreshAll(){
    if(_hooked) return;
    if(typeof refreshAll !== 'function') return;
    _hooked = true;
    var _orig = refreshAll;
    var _hooked_fn = function(){
      var res = _orig.apply(this, arguments);
      _lastCommKey = ''; // allow re-render with new data
      _commGatedRender();
      return res;
    };
    window.refreshAll = _hooked_fn;
    try{ refreshAll = _hooked_fn; }catch(e){}
  }

  // Hook immediately if refreshAll already defined, else retry
  _hookRefreshAll();
  if(!_hooked){
    var _hookTimer = setInterval(function(){
      _hookRefreshAll();
      if(_hooked) clearInterval(_hookTimer);
    }, 200);
    setTimeout(function(){ clearInterval(_hookTimer); }, 5000);
  }
})();

// ══════════════════════════════════════════════════════════════════
