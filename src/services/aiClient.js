// Phase 2 extraction target: AI provider boundary.
// Production rule: browser calls AI proxy; Claude/Gemini secrets stay in Worker/Edge only.

// ── AI PROVIDER ROUTER ────────────────────────────────
// Phase 2 AI boundary:
// - Preferred: send all AI traffic to a Cloudflare Worker / backend proxy.
// - No production AI secret should live in this browser HTML.
// - Direct browser-key mode is disabled by default. For local testing only, set:
//   localStorage.setItem('freshket_allow_direct_ai_keys','1')
// - Proxy URL can be configured by either:
//   window.FRESHKET_AI_PROXY_URL = 'https://...'
//   or localStorage.setItem('freshket_ai_proxy_url','https://...')
function getAiProxyUrl(){
  return (window.FRESHKET_AI_PROXY_URL||localStorage.getItem('freshket_ai_proxy_url')||'').trim();
}
function setAiProxyUrl(url){
  if(url) localStorage.setItem('freshket_ai_proxy_url', String(url).trim());
  else localStorage.removeItem('freshket_ai_proxy_url');
}
function directAiKeyModeAllowed(){
  return localStorage.getItem('freshket_allow_direct_ai_keys')==='1';
}

// Single entry point for all AI calls. modelKey: 'haiku'|'sonnet'
// messages: Claude-format array [{role,content}]
async function callAI(modelKey,sys,messages,maxTok){
  const proxyUrl=getAiProxyUrl();
  if(proxyUrl){
    const res=await fetch(proxyUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({provider:aiProvider,modelKey,system:sys,messages,maxTokens:maxTok})
    });
    if(!res.ok)throw new Error('AI proxy '+res.status+': '+await res.text());
    const d=await res.json();
    return d.text||'';
  }

  if(!directAiKeyModeAllowed()){
    throw new Error('ยังไม่ได้ตั้งค่า AI proxy — ตั้งค่า localStorage freshket_ai_proxy_url ก่อนใช้งาน Olive AI');
  }

  if(aiProvider==='gemini'){
    const key=(document.getElementById('gemini-api-key')?.value||geminiApiKey||'').trim();
    if(!key)throw new Error('ใส่ Gemini API Key ใน Settings ก่อน');
    const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const gemMsgs=messages.map(m=>({
      role:m.role==='assistant'?'model':'user',
      parts:[{text:typeof m.content==='string'?m.content:JSON.stringify(m.content)}]
    }));
    const bodyObj={contents:gemMsgs,generationConfig:{maxOutputTokens:maxTok}};
    if(sys)bodyObj.system_instruction={parts:[{text:sys}]};
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bodyObj)});
    if(!res.ok)throw new Error('Gemini API '+res.status+': '+await res.text());
    const d=await res.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text||'';
  } else {
    const apiKey=(document.getElementById('matcher-api-key')?.value||CLAUDE_API_KEY).trim();
    if(!apiKey)throw new Error('Claude API key missing. Use AI proxy for production.');
    const hdrs={'Content-Type':'application/json','anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
    hdrs['x-api-key']=apiKey;
    const claudeModel=modelKey==='sonnet'?'claude-sonnet-4-6':'claude-haiku-4-5-20251001';
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:hdrs,body:JSON.stringify({model:claudeModel,max_tokens:maxTok,system:sys,messages})});
    if(!res.ok)throw new Error('Claude API '+res.status+': '+await res.text());
    const d=await res.json();
    return d.content?.[0]?.text||'';
  }
}

function setAiProvider(p){
  aiProvider=p;
  localStorage.setItem('ai_provider',p);
  // Update toggle UI
  const cBtn=document.getElementById('aip-claude');
  const gBtn=document.getElementById('aip-gemini');
  const gKeyRow=document.getElementById('aip-gemini-key-row');
  const claudeSection=document.getElementById('aip-claude-section');
  const badge=document.getElementById('aip-badge');
  if(cBtn){
    cBtn.style.background=p==='claude'?'var(--g900)':'var(--n50)';
    cBtn.style.borderColor=p==='claude'?'var(--g500)':'var(--n200)';
    cBtn.querySelector('div').style.color=p==='claude'?'#fff':'var(--n700)';
  }
  if(gBtn){
    gBtn.style.background=p==='gemini'?'#2d1b5e':'var(--n50)';
    gBtn.style.borderColor=p==='gemini'?'#7c3aed':'var(--n200)';
    gBtn.querySelector('div').style.color=p==='gemini'?'#fff':'var(--n700)';
  }
  if(gKeyRow)gKeyRow.style.display=(p==='gemini'&&directAiKeyModeAllowed())?'block':'none';
  const matcherKeyRow=document.getElementById('matcher-api-key-row');
  if(matcherKeyRow)matcherKeyRow.style.display=directAiKeyModeAllowed()?'block':'none';
  if(claudeSection)claudeSection.style.opacity=p==='gemini'?'.4':'1';
  if(claudeSection)claudeSection.style.pointerEvents=p==='gemini'?'none':'auto';
  if(badge){
    badge.textContent=p==='gemini'?'Gemini':'Claude';
    badge.style.background=p==='gemini'?'rgba(124,58,237,.15)':'rgba(0,204,106,.12)';
    badge.style.color=p==='gemini'?'#7c3aed':'var(--g700)';
    badge.style.borderColor=p==='gemini'?'rgba(124,58,237,.3)':'rgba(0,204,106,.25)';
  }
}

export { getAiProxyUrl, setAiProxyUrl, directAiKeyModeAllowed, callAI, setAiProvider };
