// Freshket Sense app config boundary — Phase 14.
// Classic-script compatible on purpose: this file is inlined into index.html by scripts/build.js.
// Public values only. Do not place Claude/Gemini secrets here.
(function(global){
  'use strict';

  const ICON_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co/storage/v1/object/public/assets/sense-icon_2.png';
  const OLIVE_AVATAR_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co/storage/v1/object/public/assets/olive-avatar.png';
  const R2_BASE = 'https://pub-12078d17646340808024e8cc95504995.r2.dev';

  const config = Object.freeze({
    app: Object.freeze({
      name: 'Freshket Sense',
      shortName: 'Freshket',
      version: 'v155-phase21-final-audit-regression',
      workingBaseline: 'v155-phase6.2-chat-grounding',
      themeColor: '#006050',
      backgroundColor: '#006050',
      serviceWorkerUrl: '/sw.js',
      manifestStartUrl: '/',
      manifestDisplay: 'standalone'
    }),
    assets: Object.freeze({
      iconUrl: ICON_URL,
      oliveAvatarUrl: OLIVE_AVATAR_URL
    }),
    supabase: Object.freeze({
      url: 'https://menslbnyyvpxiyvjywcm.supabase.co',
      publishableKey: 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG'
    }),
    ai: Object.freeze({
      proxyStorageKey: 'freshket_ai_proxy_url',
      providerStorageKey: 'ai_provider',
      proxyOnlyProduction: true,
      defaultProvider: 'claude'
    }),
    storage: Object.freeze({
      chatFabPositionKey: 'fs_aifab_pos_v1',
      loaderRuntimeDisabledKey: 'freshket_loader_runtime_disabled',
      authRuntimeDisabledKey: 'freshket_auth_runtime_disabled',
      stateRuntimeDisabledKey: 'freshket_state_runtime_disabled',
      viewRuntimeDisabledKey: 'freshket_view_runtime_disabled',
      accountIndexKey: 'ciq_index',
      localAccountPrefix: 'ciq_acct_',
      visitedKey: 'ciq_visited',
      restaurantSwipeLearnedKey: 'ciq_rest_swipe_learned',
      csvDbName: 'ciq-csv-v1',
      csvCacheTtlMs: 6 * 60 * 60 * 1000
    }),
    data: Object.freeze({
      r2Base: R2_BASE,
      foregroundKeys: Object.freeze(['portview','history','categories','sku_current','outlets']),
      backgroundKeys: Object.freeze(['skus','alternatives']),
      r2Files: Object.freeze({
        portview: 'portview.csv',
        history: 'bulk_history.csv',
        categories: 'bulk_categories.csv',
        sku_current: 'bulk_sku_current.csv',
        outlets: 'bulk_outlets.csv',
        skus: 'bulk_skus.csv',
        alternatives: 'bulk_alternatives.csv'
      }),
      r2Specs: Object.freeze({
        portview: Object.freeze({type:'portview-bulk',tab:'portview',cache:true}),
        history: Object.freeze({type:'bulk-data',tab:'history',cache:true}),
        categories: Object.freeze({type:'bulk-categories',tab:'categories',cache:true}),
        sku_current: Object.freeze({type:'bulk-sku-current',tab:'sku_current',cache:true}),
        outlets: Object.freeze({type:'bulk-outlets',tab:'outlets',cache:true}),
        skus: Object.freeze({type:'bulk-skus',tab:'skus',cache:false,heavy:true}),
        alternatives: Object.freeze({type:'bulk-alternatives',tab:'alternatives',cache:false,heavy:true})
      })
    }),
    legacySheets: Object.freeze({
      accountWorkbookId: '2PACX-1vRQyqbsY1hB0iTpoeqReg3079_HpQLO59T4zF0d1OZR2Tb4KQVIb7wbkbiSyQld_3EAcEmXOcD4HLEQ',
      skuWorkbookId: '2PACX-1vTnQjbsX-Ff-bv2lCdqY8r6oFbTjBlwV3GPd9QJ9ngqWvi77RW8GUtUTzrmRiF87LhL3zFLPtgd4-ZV'
    })
  });

  global.FreshketSenseConfig = config;
})(window);
