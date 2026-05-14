# Phase 17 — Portfolio / SKU Renderer Extraction

Baseline: Phase 16, built on Phase 6.2 chat grounding.

## Scope

Extracted Restaurant Portfolio / SKU rendering behind a legacy-safe adapter.

New source:

```text
src/views/portfolioRenderer.js
```

Delegated legacy functions:

```js
renderPortfolio()
renderSKUList(passedSkus)
```

Both retain fallback functions:

```js
__legacyRenderPortfolioFallback()
__legacyRenderSKUListFallback(passedSkus)
```

## Explicit non-goals

No changes to loader, auth, splash, navigation, swipe, AI proxy, Olive chat, KAM views, Team views, or CSS/layout.

## Expected behavior

Behavior should match Phase 16. Renderer extraction is adapter-first and fallback-safe.
