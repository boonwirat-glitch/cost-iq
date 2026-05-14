# Known Olive Chat Issues — Parked

These are known issues and are intentionally parked until core refactor is more complete.

## Issues

1. **Too screen-scoped** — chat often answers only from current view context instead of routing across account / portfolio / team context.
2. **Too rigid** — grounding patch reduces hallucination but makes answers structured like copy/paste blocks.
3. **Too long** — responses often include too many sections instead of answering like an analyst.
4. **Thai noise** — some phrasing is still unnatural or semantically wrong.
5. **Weak cross-scope reasoning** — user asks portfolio/account questions and Olive sometimes says the current screen lacks data.
6. **Defensive lens** — too focused on drop / SKU loss / rescue instead of balanced KAM opportunity patterns.

## Decision

Do not keep patching Olive chat during core refactor. Later redesign should be a separate workstream:

```text
Olive Chat v2 — Intelligence Router + Grounded Analyst
```

That redesign should address context routing, answer policy, Thai style, and opportunity lens together.
