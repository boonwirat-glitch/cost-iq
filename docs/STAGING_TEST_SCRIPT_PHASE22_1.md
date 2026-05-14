# Staging Test Script — Phase 22.1

1. Deploy patch to GitHub / Cloudflare Pages.
2. Hard refresh desktop browser.
3. Open console and run:

```js
FreshketSenseDebug.snapshot()
```

4. Run:

```js
localStorage.removeItem('freshket_ai_proxy_url');
location.reload();
```

5. After reload, ask Olive a short question. AI should still work because the default proxy URL comes from config.
6. Test on mobile / PWA without manually setting localStorage. Olive AI should work.
7. Confirm no API keys appear in GitHub/browser code.
