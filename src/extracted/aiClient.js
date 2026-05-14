// Freshket Sense AI client — Phase 1 extraction target.
// In Phase 2, the monolith's callAI() should import this module directly.

export function getAiProxyUrl() {
  return (window.FRESHKET_AI_PROXY_URL || localStorage.getItem('freshket_ai_proxy_url') || '').trim();
}

export async function callAI({ provider = 'claude', modelKey = 'haiku', system = '', messages = [], maxTokens = 2000 }) {
  const proxyUrl = getAiProxyUrl();
  if (!proxyUrl) {
    throw new Error('AI proxy is not configured. Set localStorage.freshket_ai_proxy_url or window.FRESHKET_AI_PROXY_URL.');
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, modelKey, system, messages, maxTokens })
  });

  if (!response.ok) {
    throw new Error('AI proxy ' + response.status + ': ' + await response.text());
  }

  const payload = await response.json();
  return payload.text || '';
}
