# Staging Test Script — Phase 16

Use the generated files:

```text
dist/index.html → index.html
dist/sw.js → sw.js
```

Hard refresh after deploy.

## Core smoke

1. Open app
2. Login / relogin
3. Splash appears and hides normally
4. Data pill appears and hides normally
5. Account data loads
6. Restaurant mode swipe works
7. KAM mode opens
8. Portfolio / Team view still opens
9. Olive panel opens and AI proxy still works

## Overview-specific smoke

1. Open an account in Restaurant mode
2. Confirm hero shows current month / latest spend correctly
3. Confirm trend bars render
4. Tap a past month bar and confirm hero/chart selected info behave normally
5. Confirm category bars render and expand/collapse works
6. Confirm overview stats render
7. Confirm interpretation strip appears when relevant
8. Confirm price variance strip appears/hides normally
9. Run Sense preview / gate if available and confirm reset behavior is normal after reload/account switch
10. Use browser console:

```js
FreshketSenseDebug.printOverviewRendererDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
```

## Expected result

Overview should look and behave the same as before Phase 16. If overview rendering fails, the legacy fallback should still render the page.
