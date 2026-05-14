// Cloudflare Worker AI proxy for Freshket Sense.
// Set environment secrets in Cloudflare:
//   ANTHROPIC_API_KEY
//   GEMINI_API_KEY optional, only if Gemini is enabled
// Optional env vars:
//   ALLOWED_ORIGIN=https://your-app-domain
//   ALLOW_GEMINI=true

const MODEL_MAP = {
  claude: {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6'
  },
  gemini: {
    haiku: 'gemini-2.0-flash',
    sonnet: 'gemini-2.0-flash'
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, env);
    }

    const provider = body.provider === 'gemini' ? 'gemini' : 'claude';
    const modelKey = body.modelKey === 'sonnet' ? 'sonnet' : 'haiku';
    const system = typeof body.system === 'string' ? body.system : '';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const maxTokens = Math.min(Number(body.maxTokens || 2000), 6000);

    if (!messages.length) return json({ error: 'messages required' }, 400, env);

    if (provider === 'gemini') {
      if (env.ALLOW_GEMINI !== 'true') return json({ error: 'Gemini is disabled on this proxy' }, 403, env);
      if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500, env);
      return callGemini({ env, model: MODEL_MAP.gemini[modelKey], system, messages, maxTokens });
    }

    if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500, env);
    return callClaude({ env, model: MODEL_MAP.claude[modelKey], system, messages, maxTokens });
  }
};

async function callClaude({ env, model, system, messages, maxTokens }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });

  const text = await response.text();
  if (!response.ok) return json({ error: text }, response.status, env);

  const data = JSON.parse(text);
  return json({ text: data.content?.[0]?.text || '', raw_usage: data.usage || null }, 200, env);
}

async function callGemini({ env, model, system, messages, maxTokens }) {
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }]
  }));

  const payload = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (system) payload.system_instruction = { parts: [{ text: system }] };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );

  const text = await response.text();
  if (!response.ok) return json({ error: text }, response.status, env);

  const data = JSON.parse(text);
  return json({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }, 200, env);
}
