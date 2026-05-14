# Freshket Sense v155 — Phase 5.1 Staging Test Script

## 0. Deploy to staging/branch

Copy:

```text
freshket-sense-v155-phase5-1-audit-patch/dist/index.html -> index.html
freshket-sense-v155-phase5-1-audit-patch/dist/sw.js -> sw.js
```

Do not test on production first.

## 1. Hard refresh / service worker reset

In Chrome DevTools:

1. Application -> Service Workers -> Unregister existing worker.
2. Application -> Storage -> Clear site data for staging URL.
3. Reload.

Expected:

- New service worker cache includes `freshket-sense-v155-phase5-1`.
- App shell loads normally.

## 2. Configure AI proxy

In console:

```js
localStorage.setItem('freshket_ai_proxy_url', 'https://YOUR-WORKER-DOMAIN.workers.dev')
location.reload()
```

Expected:

- `FreshketSenseDebug.snapshot().proxyUrl` returns the Worker URL.
- No browser API key field is visible.

## 3. Static smoke check

In console:

```js
FreshketSenseDebug.printStaticSmokeChecklist()
```

Expected:

- All core runtime / DOM / legacy function checks pass.
- `AI proxy configured` passes after Step 2.

## 4. Login / relogin

Check:

- normal login
- relogin after refresh
- splash transition appears normally
- app does not loop reload

## 5. Data loading

Check:

- data pill appears
- foreground files load
- pill hides smoothly
- app remains usable while heavy files load in background
- `FreshketSenseDebug.snapshot().data` shows recent operations

## 6. Restaurant mode

Check:

- overview renders
- portfolio renders
- opportunities renders
- swipe cue appears and disappears smoothly
- outlet panel does not sink behind bottom nav

## 7. KAM / Team mode

Check:

- KAM mode loads
- Team view does not collapse unintentionally
- Portfolio collapse behavior remains isolated
- KAM briefing button still appears

## 8. Olive / AI

Check after proxy is configured:

- open Olive chat
- ask a Thai question
- response is Thai
- no `ครับ`
- no invented data when context is missing
- no browser request is sent directly to Anthropic/Gemini endpoints

## 9. Regression stop criteria

Stop and do not proceed to Phase 6 if any of these happen:

- login/relogin loops
- data pill stuck visible
- Sense gate stuck
- Team view collapse regression
- direct browser AI endpoint appears in Network tab
- Olive fails entirely after proxy is configured
