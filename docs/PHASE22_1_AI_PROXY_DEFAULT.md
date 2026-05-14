# Phase 22.1 — AI Proxy Default Hotfix

## Purpose

Phase 22 Olive Chat v2 worked on the MacBook because `freshket_ai_proxy_url` had been set in that browser's localStorage.

Mobile/new devices did not have that localStorage value, so AI features had no proxy endpoint and failed.

## Fix

The app config now includes a public default Cloudflare Worker proxy URL:

```text
https://freshket-sense-ai-proxy.boonwirat-t.workers.dev
```

This is safe to expose. The Worker URL is not a secret. Claude/Gemini API keys remain only in Cloudflare Worker Secrets.

## Resolution order

`getAiProxyUrl()` now resolves in this order:

1. `window.FRESHKET_AI_PROXY_URL`
2. `localStorage.freshket_ai_proxy_url`
3. `FreshketSenseConfig.ai.defaultProxyUrl`

This preserves local override while making mobile/PWA/new browsers work by default.

## Not changed

- No Claude/Gemini key added to browser.
- AI proxy-only production remains.
- Olive Chat v2 behavior remains.
- No loader/auth/navigation/view behavior changed.
