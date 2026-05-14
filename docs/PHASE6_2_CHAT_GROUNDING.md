# Phase 6.2 — Chat Grounding Patch

Goal: fix Olive account-detail chat hallucination without making Olive rigid or less intelligent.

## What changed

1. Chat no longer falls back to SAMPLE data for account context.
2. Account chat context now includes explicit data availability and grounding limits.
3. Olive can still interpret broadly, but must label supplier/menu/promotion/churn explanations as hypotheses unless the context proves them.
4. Monthly data cannot be converted into weekly claims.
5. Added a narrow Thai cleanup/grounding guard for awkward phrases and over-certain diagnoses.
6. Output contract explicitly says not to force a rigid template every time.

## Design intent

This is not a lock that makes Olive repeat only fields. It is an evidence contract:

- Facts: only from loaded context.
- Interpretation: allowed when supported.
- Hypotheses: allowed, but labeled as questions to verify.
- Action: still practical for KAM.

## What was intentionally not changed

- Loader runtime
- Service worker strategy except cache bump
- KAM / Team / Portfolio views
- Olive persona
- AI proxy architecture
