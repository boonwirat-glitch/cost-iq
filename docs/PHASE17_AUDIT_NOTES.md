# Phase 17 Audit Notes

Phase 17 is the first renderer extraction after Report and Overview that touches a more interactive screen. Risk is higher because Portfolio includes month pills, SKU category filters, price filters, search, SKU list rows, and SKU detail entry points.

Controls:

- legacy fallback retained
- no navigation/swipe changes
- no state mutation beyond existing portfolioMonth sync
- renderer diagnostics exposed
- service worker cache bumped
- proxy-only AI retained
