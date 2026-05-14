# Prompt to give Claude / another AI when continuing Freshket Sense

Copy this at the start of a new Claude Sonnet chat.

```text
You are helping me continue Freshket Sense, an internal KAM intelligence app.

Current baseline:
- v155 Phase 21.1 Debug Snapshot Fix.
- Product baseline is Phase 6.2 Chat Grounding.
- Core refactor to Phase 21 is complete enough to continue repo-based work.
- AI proxy via Cloudflare Worker works.
- Production AI must remain proxy-only. Never put Claude/Gemini keys in browser code, GitHub, or localStorage.

Important repo model:
- Browser still deploys from root index.html and sw.js.
- Active source is in src/.
- For app behavior changes, edit source files first, then return synced deploy outputs index.html and dist/index.html.
- For service worker changes, also sync src/app/sw.js, sw.js, dist/sw.js.
- Do not edit only generated index.html unless it is an emergency hotfix.

Known parked issue:
- Olive Chat quality is not final: too screen-scoped, too rigid, too long, Thai noise, weak cross-scope context, too defensive. Do not patch Olive chat unless I explicitly ask.

Before coding:
1. Tell me the smallest file set you need.
2. Do not ask me for the full ZIP unless necessary.
3. Keep changes scoped.
4. Return patch-only output and list exactly what to upload.
5. Preserve existing loader/auth/navigation behavior unless the task is specifically about it.
```
