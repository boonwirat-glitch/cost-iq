// Freshket Sense view registry — Phase 13.
// Source-of-truth registry for screens, DOM anchors, renderer inventory, and extraction notes.
// Diagnostic only: this file must not mutate app state or override render functions.
(function(global){
  'use strict';

  const VERSION = 'phase13-view-registry-inventory';

  function freezeDeep(value){
    if(!value || typeof value !== 'object') return value;
    Object.keys(value).forEach(function(key){ freezeDeep(value[key]); });
    try{ return Object.freeze(value); }catch(e){ return value; }
  }

  const screens = {
    overview: {
      id: 'scr-overview',
      navId: 'nav-overview',
      group: 'restaurantA',
      mode: 'restaurant',
      label: 'Restaurant Overview',
      primaryRenderers: ['renderOverview','renderHeroKAM','renderHeroMoM','renderOverviewStats','renderCatBars','renderOutletCard','renderQuickWins','renderOverviewPaceAndStrip','renderInterpretation'],
      domAnchors: ['h-acct-name','hero-spend','cat-bars','outlet-card','overview-stats'],
      stateReads: ['D.history','D.current_month','D.categories','D.outlets','OPPS','selectedOpps'],
      extractionRisk: 'medium',
      notes: 'Restaurant landing screen. Must preserve swipe behavior and fixed bottom nav spacing.'
    },
    portfolio: {
      id: 'scr-portfolio',
      navId: 'nav-portfolio',
      group: 'restaurantA',
      mode: 'restaurant',
      label: 'Portfolio / SKU',
      primaryRenderers: ['renderPortfolio','renderSKUList','filterSKUs','renderPortMoMInsight','setPortfolioMonth','setSkuFilter','setSkuView'],
      domAnchors: ['sku-list','sku-panel','portfolio-sticky-wrap','port-top'],
      stateReads: ['D.skus','D.history','D.current_month','skuFilter','skuView'],
      extractionRisk: 'medium-high',
      notes: 'SKU screen has inner scroll and filtering. Do not extract before state boundary is stable.'
    },
    opportunities: {
      id: 'scr-opportunities',
      navId: 'nav-opportunities',
      group: 'restaurantB',
      mode: 'restaurant',
      label: 'Sense / Opportunities',
      primaryRenderers: ['computeOPPS','renderOpps','renderOppCards','renderOppTable','renderPlanBuilder','getFilteredOpps','toggleOpp','setOppFilter','scheduleOppReveal'],
      domAnchors: ['opplist','pb-groups','pb-footer','sense-gate'],
      stateReads: ['OPPS','selectedOpps','D.alts','D.skus','D.current_month','senseScore'],
      extractionRisk: 'high',
      notes: 'Most coupled restaurant screen: Sense gate, plan builder, alternatives, selection state.'
    },
    report: {
      id: 'scr-report',
      navId: 'nav-report',
      group: 'restaurantB',
      mode: 'restaurant',
      label: 'Report',
      primaryRenderers: ['renderReport'],
      domAnchors: ['rpt','report-wrap','scr-report'],
      stateReads: ['D','OPPS','selectedOpps'],
      extractionRisk: 'medium',
      notes: 'Report is mostly generated output; likely safer to extract before opportunity planner internals.'
    },
    kamOverview: {
      id: 'kam-overview',
      navId: 'nav-kam-overview',
      group: 'kam',
      mode: 'kam',
      label: 'KAM Account Overview',
      primaryRenderers: ['renderKamOverview','renderKamThisMonth','renderKamLastMonth','renderKamSignalBar','renderSkuMovementHtml','renderHeroKAM','generateKamBriefing'],
      domAnchors: ['kam-overview','kam-acct-name2','kam-this-month','kam-last-month'],
      stateReads: ['currentUserProfile','D.history','D.skus','D.current_month','bulkHistoryData','bulkSkusData'],
      extractionRisk: 'high',
      notes: 'Dark KAM screen with account context and AI insight entry points. Keep after lighter renderer extraction.'
    },
    portview: {
      id: 'scr-portview',
      navId: 'nav-portview',
      group: 'kam',
      mode: 'kam',
      label: 'Portfolio View',
      primaryRenderers: ['renderPortview','renderPortviewSummary','renderPortviewList','getPortviewAccounts','setPortviewFilter','generatePortviewInsight'],
      domAnchors: ['scr-portview','portview-list','portview-summary','pv-sort-row'],
      stateReads: ['bulkHistoryData','currentUserProfile','portviewFilter','portviewSort','isTeamLead'],
      extractionRisk: 'high',
      notes: 'Portfolio-level KAM/TL intelligence. Cross-account state; extract after registry and state selectors exist.'
    },
    teamview: {
      id: 'scr-teamview',
      navId: 'nav-teamview',
      group: 'kam',
      mode: 'kam',
      label: 'Team View',
      primaryRenderers: ['renderTeamview','renderTeamviewSummary','renderTeamviewKamList','teamviewDrillKam','teamviewGoBack','generateTeamviewInsight'],
      domAnchors: ['scr-teamview','teamview-list','teamview-summary'],
      stateReads: ['bulkHistoryData','currentUserProfile','teamviewScope','teamviewSelectedKam'],
      extractionRisk: 'high',
      notes: 'Team lead screen. Do not conflate with portfolio collapse behavior.'
    }
  };

  const groups = {
    restaurantA: { id:'swipe-grp-a', mode:'restaurant', screens:['overview','portfolio'], behavior:'horizontal-swipe' },
    restaurantB: { id:'swipe-grp-b', mode:'restaurant', screens:['opportunities','report'], behavior:'horizontal-swipe' },
    kam: { id:'kam-main', mode:'kam', screens:['kamOverview','portview','teamview'], behavior:'bottom-nav' }
  };

  const extractionOrder = [
    { phase:'view-registry', status:'done-in-phase13', screens:['all'], note:'Inventory only, no renderer rewiring.' },
    { phase:'low-risk-renderer-extract', status:'future', screens:['report'], note:'Candidate first extraction because it is generated output with fewer user interactions.' },
    { phase:'restaurant-overview-extract', status:'future', screens:['overview'], note:'Only after hero/category/outlet DOM anchors are protected.' },
    { phase:'portfolio-sku-extract', status:'future', screens:['portfolio'], note:'Requires stable SKU filter/state selectors.' },
    { phase:'opportunity-planner-extract', status:'future', screens:['opportunities'], note:'High risk due to Sense gate + selectedOpps + alternatives.' },
    { phase:'kam-views-extract', status:'future', screens:['kamOverview','portview','teamview'], note:'High risk; wait until shared account/portfolio selectors exist.' }
  ];

  function unique(arr){ const out=[]; (arr||[]).forEach(function(v){ if(v && out.indexOf(v)<0) out.push(v); }); return out; }
  const rendererNames = unique(Object.keys(screens).reduce(function(acc,key){ return acc.concat(screens[key].primaryRenderers || []); }, [])).sort();
  const domAnchors = unique(Object.keys(screens).reduce(function(acc,key){ return acc.concat(screens[key].domAnchors || []); }, [])).sort();
  const stateReads = unique(Object.keys(screens).reduce(function(acc,key){ return acc.concat(screens[key].stateReads || []); }, [])).sort();

  const registry = freezeDeep({
    version: VERSION,
    generatedAt: 'build-time',
    behaviorChanged: false,
    screens: screens,
    groups: groups,
    rendererNames: rendererNames,
    domAnchors: domAnchors,
    stateReads: stateReads,
    extractionOrder: extractionOrder
  });

  global.FreshketSenseViewRegistry = registry;
})(window);
