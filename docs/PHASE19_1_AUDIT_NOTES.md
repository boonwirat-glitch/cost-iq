# Phase 19.1 Audit Notes

## Audit stance

The user asked whether Phase 19 works **100%** compared with the starting/baseline version.

The honest answer is:

- Static/source comparison: **passes**.
- Production/browser behavior: **cannot be guaranteed 100% without real browser smoke testing**.

## Baseline fixture

Fixture file:

```text
scripts/fixtures/phase6_2_navigation_baseline.json
```

Generated from:

```text
v155-phase6.2-chat-grounding/dist/index.html
```

## Baseline function hashes

```json
{
  "showScreen": {
    "normalizedSha256": "878be3f7b42bd7f4c5f408cf04a9c713a10a6dda6ef8c0895473267257134b66",
    "normalizedBytes": 4436,
    "normalizedLines": 88
  },
  "setMode": {
    "normalizedSha256": "d81c1416734c2c0d007a9ce261b5eae59bd68f7a49917b1b40858f0fb59cee83",
    "normalizedBytes": 5177,
    "normalizedLines": 100
  },
  "navPortHome": {
    "normalizedSha256": "fa5096ad13e30e4466690486775a860924de1429bba42081ead0ec8c79dcff3f",
    "normalizedBytes": 345,
    "normalizedLines": 11
  }
}
```

## What passed

- `__legacyShowScreenFallback` matches Phase 6.2 `showScreen` after normalization.
- `__legacySetModeFallback` matches Phase 6.2 `setMode` after normalization.
- `__legacyNavPortHomeFallback` matches Phase 6.2 `navPortHome` after normalization.
- Navigation runtime delegates to legacy only.
- `behaviorChanged=false` remains true.
- Renderer extractions from Phases 15–18 are retained.
- AI remains proxy-only.
- No hardcoded Claude/Gemini secrets are present.

## Remaining risk

The only meaningful remaining risk is runtime integration, not source drift:

- The wrapper could call the runtime first, then fallback if runtime fails.
- The runtime currently delegates to the legacy fallback, so behavior should be equivalent.
- But browser runtime should still be smoke-tested after Phase 19/19.1 because navigation touches visible app behavior.
