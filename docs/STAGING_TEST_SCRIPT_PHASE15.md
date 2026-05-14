# Staging Test Script — Phase 15

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

## Report-specific smoke

1. Open an account with opportunities
2. Go to Sense / Opportunities
3. Select at least one cost-saving item
4. Open Report tab
5. Check account name, KAM name, date
6. Check selected item count
7. Check monthly and annual savings summary
8. Check table rows render correctly
9. Deselect all items and reopen Report — should show empty selected-item message
10. Use browser console:

```js
FreshketSenseDebug.printReportRendererDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
```

## Expected result

Report output should look the same as before Phase 15. If report rendering fails, the legacy fallback should still render the report.
