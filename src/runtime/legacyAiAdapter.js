// ── PHASE 3 LEGACY AI ADAPTERS ──────────────────────
// Keep the original global names alive while delegating to FreshketSenseRuntime.
// This lets inline handlers and legacy call sites continue to work during modular migration.
window.FreshketSenseRuntime = window.FreshketSenseRuntime || { ai:{ OLIVE_BASE:'', oliveToneClean:function(t){return String(t||'').trim();} }, aiClient:{} };
var OLIVE_BASE = window.FreshketSenseRuntime.ai && window.FreshketSenseRuntime.ai.OLIVE_BASE || '';
function oliveToneClean(t){ return window.FreshketSenseRuntime.ai && window.FreshketSenseRuntime.ai.oliveToneClean ? window.FreshketSenseRuntime.ai.oliveToneClean(t) : String(t||'').trim(); }
function getAiProxyUrl(){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.getAiProxyUrl ? window.FreshketSenseRuntime.aiClient.getAiProxyUrl() : ''; }
function setAiProxyUrl(url){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.setAiProxyUrl ? window.FreshketSenseRuntime.aiClient.setAiProxyUrl(url) : undefined; }
function directAiKeyModeAllowed(){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.directAiKeyModeAllowed ? window.FreshketSenseRuntime.aiClient.directAiKeyModeAllowed() : false; }
async function callAI(modelKey,sys,messages,maxTok){
  if(!window.FreshketSenseRuntime.aiClient || !window.FreshketSenseRuntime.aiClient.callAI) throw new Error('AI runtime unavailable');
  return window.FreshketSenseRuntime.aiClient.callAI({
    modelKey, sys, messages, maxTok,
    provider: aiProvider,
    geminiApiKey,
    claudeApiKey: CLAUDE_API_KEY
  });
}
function setAiProvider(p){
  if(!window.FreshketSenseRuntime.aiClient || !window.FreshketSenseRuntime.aiClient.setAiProvider){ aiProvider=p; localStorage.setItem('ai_provider',p); return; }
  return window.FreshketSenseRuntime.aiClient.setAiProvider(p, {
    setProvider: (nextProvider)=>{ aiProvider=nextProvider; }
  });
}
// ─────────────────────────────────────────────────────
