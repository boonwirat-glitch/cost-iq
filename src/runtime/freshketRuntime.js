// Phase 3 runtime boundary for Freshket Sense.
// This file is classic-script compatible by design because the legacy app still relies on global names.
// It gives the monolith a real runtime module seam without forcing an ES-module migration yet.
(function(global){
  'use strict';

  const RUNTIME_VERSION = 'v155-phase5.1-audit-patch';
  const PROXY_ONLY_PRODUCTION = true;

  // ── Olive identity source of truth ───────────────────
  const OLIVE_BASE = `You are Olive, Freshket Sense's female-coded internal intelligence partner for Freshket's Sales and KAM teams.

Olive helps users understand what is really happening across accounts, portfolios, teams, and customer purchasing behavior — then turns that diagnosis into practical next actions.

Voice:
- Smart, calm, warm, concise, practical, and lightly playful when the moment fits.
- Friendly without being childish. Playful without being silly. Honest without sounding cold. Sharp without sounding arrogant.
- Accuracy and usefulness matter more than sounding confident. Signature behavior: เก่งแบบไม่มั่ว.
- Do not force jokes. Do not over-soften serious business risks.

Thai identity and language rules:
- If the user writes Thai or mixed Thai-English, reply in Thai. Use English only for metric names, field names, product terms, or if the user explicitly asks for English.
- Refer to yourself only as "Olive".
- Never use "หนู", "ฉัน", "ดิฉัน", "ผม", "เรา" as Olive's self-reference.
- Never call the user "อาจารย์".
- Do not use "ครับ".
- Use feminine Thai particles like "ค่ะ/นะคะ" naturally and lightly. Do not put a particle at the end of every sentence.

Currency rules:
- All monetary values in this product are Thai Baht (THB).
- Use "บาท" or "฿" only.
- Never use เยน, JPY, ¥, dollar, USD, or any other currency unless the user explicitly asks about foreign currency.

Analysis behavior:
- Answer first.
- Then give key evidence, interpretation, recommendation, and next step when useful.
- Never invent data. If the loaded context is not enough, say exactly what is missing and give the safest next step.
- Separate facts, assumptions, and interpretation.
- For summaries or action plans only, identify Decision, Owner, Deadline, Next step, and Risk when that structure helps.

Restaurant reasoning lens:
- Diagnose purchasing signals like someone who understands restaurant operations: menu design, ingredient specs, food cost pressure, ordering cycles, supplier switching, prep burden, waste, branch dynamics, and chef/menu changes.
- A missing SKU may indicate menu change, ordering cycle, supplier switch, branch behavior, or prep/waste pressure — not automatically churn.
- A new SKU may indicate menu change, chef change, spec change, promotion, or substitution.
- Getting the diagnosis right changes how a KAM should approach the conversation.

Outreach behavior:
- When recommending customer contact, assume LINE is the default channel in Thailand. Mention LINE only when it naturally helps the action; do not force the word LINE into every recommendation.

On cost-saving alternatives:
- The system surfaces potential substitutions from a database, but these have not been spec-verified against the customer's actual requirements.
- Frame alternatives as options to explore, not confirmed recommendations, because the customer may have brand, spec, menu, or contract reasons for their current choice that the data does not show.`;

  function oliveToneClean(t){
  // Last-mile guard for Olive's Thai voice. Keep this narrow enough to avoid rewriting business meaning.
  let s=String(t||'');
  s=s
    .replace(/\u0e14\u0e34\u0e09\u0e31\u0e19/g,'Olive')
    .replace(/(^|[\n\r\t \u00A0])\u0e09\u0e31\u0e19(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])หนู(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])ผม(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])เรา(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/อาจารย์/g,'คุณ')
    .replace(/นะครับ/g,'นะคะ')
    .replace(/ครับผม/g,'ค่ะ')
    .replace(/ครับ/g,'ค่ะ')
    .replace(/เยน|JPY|¥/gi,'บาท')
    .replace(/ดอลลาร์|USD/gi,'บาท')
    .replace(/ค่ะค่ะ/g,'ค่ะ')
    .replace(/คะค่ะ/g,'ค่ะ')
    .replace(/ค่ะนะคะ/g,'นะคะ')
    .replace(/นะคะค่ะ/g,'นะคะ')
    .replace(/[ \t]+\n/g,'\n')
    .trim();
  return s;
  }

  // ── AI provider/runtime boundary ─────────────────────
  function getAiProxyUrl(){
    const cfgKey=(global.FreshketSenseConfig&&global.FreshketSenseConfig.ai&&global.FreshketSenseConfig.ai.proxyStorageKey)||'freshket_ai_proxy_url';
    const configDefault=(global.FreshketSenseConfig&&global.FreshketSenseConfig.ai&&global.FreshketSenseConfig.ai.defaultProxyUrl)||'';
    return (global.FRESHKET_AI_PROXY_URL||global.localStorage?.getItem(cfgKey)||configDefault||'').trim();
  }

  function setAiProxyUrl(url){
    if(url) global.localStorage?.setItem('freshket_ai_proxy_url', String(url).trim());
    else global.localStorage?.removeItem('freshket_ai_proxy_url');
  }

  function directAiKeyModeAllowed(){
    return false;
  }

  async function callAI(opts){
    const {modelKey, sys, messages, maxTok, provider, geminiApiKey, claudeApiKey} = opts || {};
    const activeProvider = provider || 'claude';
    const proxyUrl=getAiProxyUrl();

    if(proxyUrl){
      const res=await fetch(proxyUrl,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({provider:activeProvider,modelKey,system:sys,messages,maxTokens:maxTok})
      });
      if(!res.ok)throw new Error('AI proxy '+res.status+': '+await res.text());
      const d=await res.json();
      return d.text||'';
    }

    // Phase 5.1: production is proxy-only. No browser-held Claude/Gemini keys and no direct model endpoints.
    throw new Error('AI proxy ยังไม่ถูกตั้งค่า — ตั้งค่า freshket_ai_proxy_url ก่อนใช้งาน Olive AI');
  }


  function setAiProvider(p, deps){
    const d=deps||{};
    d.setProvider?.(p);
    global.localStorage?.setItem('ai_provider',p);

    const cBtn=document.getElementById('aip-claude');
    const gBtn=document.getElementById('aip-gemini');
    const gKeyRow=document.getElementById('aip-gemini-key-row');
    const claudeSection=document.getElementById('aip-claude-section');
    const badge=document.getElementById('aip-badge');

    if(cBtn){
      cBtn.style.background=p==='claude'?'var(--g900)':'var(--n50)';
      cBtn.style.borderColor=p==='claude'?'var(--g500)':'var(--n200)';
      const label=cBtn.querySelector('div');
      if(label) label.style.color=p==='claude'?'#fff':'var(--n700)';
    }
    if(gBtn){
      gBtn.style.background=p==='gemini'?'#2d1b5e':'var(--n50)';
      gBtn.style.borderColor=p==='gemini'?'#7c3aed':'var(--n200)';
      const label=gBtn.querySelector('div');
      if(label) label.style.color=p==='gemini'?'#fff':'var(--n700)';
    }
    if(gKeyRow)gKeyRow.style.display='none';
    const matcherKeyRow=document.getElementById('matcher-api-key-row');
    if(matcherKeyRow)matcherKeyRow.style.display='none';
    if(claudeSection)claudeSection.style.opacity=p==='gemini'?'.4':'1';
    if(claudeSection)claudeSection.style.pointerEvents=p==='gemini'?'none':'auto';
    if(badge){
      badge.textContent=p==='gemini'?'Gemini':'Claude';
      badge.style.background=p==='gemini'?'rgba(124,58,237,.15)':'rgba(0,204,106,.12)';
      badge.style.color=p==='gemini'?'#7c3aed':'var(--g700)';
      badge.style.borderColor=p==='gemini'?'rgba(124,58,237,.3)':'rgba(0,204,106,.25)';
    }
  }

  const previousRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime = Object.freeze({
    version:RUNTIME_VERSION,
    ai:Object.freeze({OLIVE_BASE,oliveToneClean}),
    aiClient:Object.freeze({proxyOnlyProduction:PROXY_ONLY_PRODUCTION,getAiProxyUrl,setAiProxyUrl,directAiKeyModeAllowed,callAI,setAiProvider}),
    data: previousRuntime.data
  });
})(window);
