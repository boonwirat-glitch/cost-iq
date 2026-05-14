// Phase 5 extraction target: Cloudflare R2 CSV loader.
// Low-risk helpers now delegate to FreshketSenseRuntime.data; orchestration remains legacy-compatible.

// ════════════════════════════════════════
// CLOUDFLARE R2 DATA LOADER
// ════════════════════════════════════════
// ════════════════════════════════════════
// LEGACY SHEETS CONFIG (kept for backward compatibility; R2 is current source)
// ── no longer used by Cloudflare loader ──
// ════════════════════════════════════════
const FRESHKET_SHEETS_ID     = '2PACX-1vRQyqbsY1hB0iTpoeqReg3079_HpQLO59T4zF0d1OZR2Tb4KQVIb7wbkbiSyQld_3EAcEmXOcD4HLEQ';
const FRESHKET_SHEETS_SKU_ID = '2PACX-1vTnQjbsX-Ff-bv2lCdqY8r6oFbTjBlwV3GPd9QJ9ngqWvi77RW8GUtUTzrmRiF87LhL3zFLPtgd4-ZV';
const CLAUDE_API_KEY = ''; // Phase 2: no production AI secret in browser. Use AI proxy.
// ── OLIVE AVATAR ──────────────────────────────────────
// Paste your Supabase public image URL here.
// Leave empty ('') to keep the default star icon.
const OLIVE_AVATAR_URL='https://menslbnyyvpxiyvjywcm.supabase.co/storage/v1/object/public/assets/olive-avatar.png';

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

// ── CSV Cache (IndexedDB, TTL 6h) — foreground files only ──
const _CSV_DB='ciq-csv-v1';
const _CSV_TTL=6*60*60*1000; // 6 hours
function _csvOpen(){return window.FreshketSenseRuntime.data.csvOpen();}
async function _csvCacheGet(tab){return window.FreshketSenseRuntime.data.csvCacheGet(tab);}
async function _csvCacheSet(tab,text){return window.FreshketSenseRuntime.data.csvCacheSet(tab,text);}
async function _csvCacheClear(){return window.FreshketSenseRuntime.data.csvCacheClear();}

// R2 file map — Cloudflare R2 bucket (freshket-data)
const R2_BASE='https://pub-12078d17646340808024e8cc95504995.r2.dev';
const R2_FILES={portview:'portview.csv',history:'bulk_history.csv',categories:'bulk_categories.csv',sku_current:'bulk_sku_current.csv',outlets:'bulk_outlets.csv',skus:'bulk_skus.csv',alternatives:'bulk_alternatives.csv'};
const R2_SPECS={
  // Foreground 5 files are intentionally cached: small enough and needed at app start.
  portview:{type:'portview-bulk',tab:'portview',cache:true},
  history:{type:'bulk-data',tab:'history',cache:true},
  categories:{type:'bulk-categories',tab:'categories',cache:true},
  sku_current:{type:'bulk-sku-current',tab:'sku_current',cache:true},
  outlets:{type:'bulk-outlets',tab:'outlets',cache:true},
  // Heavy files stay session-memory only to avoid iOS IndexedDB/raw-text duplication.
  skus:{type:'bulk-skus',tab:'skus',cache:false,heavy:true},
  alternatives:{type:'bulk-alternatives',tab:'alternatives',cache:false,heavy:true},
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
    const dot=document.getElementById('sp-'+tab);
    if(dot)dot.style.background='rgba(38,96,200,.12)';
    try{
      let text=null;
      const useCache=(cacheOverride!==undefined)?cacheOverride:!!spec.cache;
      if(useCache){
        const cached=await _csvCacheGet(tab);
        if(cached&&cached.ts&&(Date.now()-cached.ts)<_CSV_TTL)text=cached.text;
      }
      if(!text){
        const url=`${R2_BASE}/${R2_FILES[tab]||tab+'.csv'}`;
        text=await _fetchTextWithTimeout(url,_specFetchTimeout(spec));
        // Cache only the 5 lightweight/core CSVs. Heavy files are intentionally not cached.
        if(useCache)_csvCacheSet(tab,text);
      }
      const ok=await ingestCSVText(spec.type,text,{timeoutMs:_specIngestTimeout(spec)});
      if(ok){
        _cloudLoadedTabs.add(tab);
        if(tab==='skus')bulkSkusReady=true;
        if(tab==='alternatives')bulkAltsReady=true;
        if(dot){dot.style.background='rgba(0,208,112,.18)';dot.style.color='var(--g700)';}
      }else{
        if(dot){dot.style.background='rgba(240,80,0,.12)';dot.style.color='var(--org)';}
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
function _startCloudBackgroundLoad({token,fgLoaded=0,total=7}={}){
  const BACKGROUND=['skus','alternatives'];
  if(_cloudBackgroundPromise)return _cloudBackgroundPromise;
  const counter=document.getElementById('sheets-loaded-count');
  const bgDots=document.getElementById('dlp-bg-dots');
  const readyIcon=document.getElementById('dlp-ready-icon');
  const dots=document.getElementById('dlp-dots');
  if(dots)dots.style.display='none';
  if(readyIcon)readyIcon.style.display='none';
  if(bgDots)bgDots.style.display='flex';
  _setDataPillText('SKU + ทางเลือก','');

  let pillReleased=false;
  let finished=false;
  const releaseTimer=setTimeout(()=>{
    if(finished||token!==_cloudLoadToken)return;
    pillReleased=true;
    _finishDataPill('โหลดต่อเบื้องหลัง',1000);
    showToast('กำลังโหลด SKU + ทางเลือกต่อเบื้องหลัง','⟳');
  },18000);

  _cloudBackgroundPromise=Promise.all(BACKGROUND.map(async key=>{
    const spec=R2_SPECS[key];
    const bgDot=document.getElementById(key==='skus'?'dlp-bg-skus':'dlp-bg-alts');
    const ok=await _fetchCloudflareFile(spec,{force:false,cacheOverride:false});
    if(token!==_cloudLoadToken)return ok;
    if(ok){
      if(bgDot)bgDot.classList.add('done');
    }else{
      if(bgDot)bgDot.style.background='rgba(240,80,0,.7)';
    }
    const loadedNow=fgLoaded+BACKGROUND.filter(k=>_cloudLoadedTabs.has(R2_SPECS[k].tab)).length;
    if(counter)counter.textContent=loadedNow+'/'+total;
    return ok;
  })).then(results=>{
    if(token!==_cloudLoadToken)return results;
    finished=true;clearTimeout(releaseTimer);
    const okCount=results.filter(Boolean).length;
    if(okCount===BACKGROUND.length){
      if(!pillReleased)_finishDataPill('ข้อมูลครบแล้ว',1000);
      showToast('ข้อมูล Sense พร้อมแล้ว','✓');
    }else{
      if(!pillReleased)_finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
      showToast('ข้อมูลหลักพร้อม แต่ SKU/ทางเลือกยังไม่ครบ — กด Refresh data ได้','⚠');
    }
    if(typeof updateDataStatus==='function')updateDataStatus();
    if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
    return results;
  }).catch(err=>{
    if(token===_cloudLoadToken){
      finished=true;clearTimeout(releaseTimer);
      if(!pillReleased)_finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
      showToast('โหลด SKU/ทางเลือกไม่สำเร็จ — กด Refresh data','⚠');
      console.warn('[Cloudflare background]',err);
    }
    return [false,false];
  }).finally(()=>{
    if(token===_cloudLoadToken)_cloudBackgroundPromise=null;
  });
  return _cloudBackgroundPromise;
}

async function loadFromCloudflareR2(){
  if(sheetsLoadStarted&&_cloudInitialPromise)return _cloudInitialPromise;
  if(sheetsLoadStarted)return;
  sheetsLoadStarted=true;
  const token=++_cloudLoadToken;

  // v148 loading strategy:
  // 1) Load the 5 lightweight operational files at app start, in parallel.
  // 2) Make the app usable immediately after those 5 resolve.
  // 3) Start skus + alternatives immediately after, in parallel, non-blocking.
  // 4) Heavy files are not cached in IndexedDB; foreground 5 files are cached.
  const FOREGROUND=['portview','history','categories','sku_current','outlets'];
  const BACKGROUND=['skus','alternatives'];
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
      const ok=await _fetchCloudflareFile(R2_SPECS[key],{force:false});
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
      if(typeof renderPortview==='function')renderPortview();
      if(typeof renderTeamview==='function'&&document.getElementById('scr-teamview')?.classList.contains('on'))renderTeamview();
    }else{
      showToast('โหลดข้อมูลหลักไม่สำเร็จ — กด Refresh data','⚠');
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

async function ensureSenseData(accountId){
  if(!accountId)return false;
  const needed=[];
  if(!bulkSkusData[accountId])needed.push('skus');
  if(!bulkAltsReady&&!bulkAltsUnverified[accountId])needed.push('alternatives');
  if(!needed.length)return true;
  showToast('กำลังโหลด SKU + ทางเลือก...','⟳');
  const ok=await ensureCloudflareFiles(needed,{label:'SKU + ทางเลือก'});
  loadFromStorage(accountId);
  if(D.alts.length&&D.skus.length)computeOPPS();
  refreshAll();updateDataStatus();
  if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
  return ok;
}

// Legacy alias — existing button onclick='loadFromSupabaseStorage()' still works
async function loadFromSupabaseStorage(){
  return loadFromGoogleSheets();
}

function _initSheetsInput(){} // no-op — UI inputs removed, using constants
