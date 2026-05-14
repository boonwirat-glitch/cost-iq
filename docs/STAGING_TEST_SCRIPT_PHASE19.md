# Staging Test Script — Phase 19

Recommended checks when back-testing this phase:

1. Login/relogin.
2. Restaurant mode: bottom nav to Overview / Portfolio / Sense / Report.
3. Restaurant swipe: Overview ↔ Portfolio and Sense ↔ Report.
4. KAM mode: toggle from restaurant to KAM and back.
5. KAM overview account state still renders.
6. Portfolio View opens.
7. Team View opens for TL/admin.
8. `พอร์ต` home button routes correctly.
9. Sense gate still opens when entering opportunities before scan.
10. Olive panel still opens.

Console diagnostics:

```js
FreshketSenseDebug.printNavigationDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
```
