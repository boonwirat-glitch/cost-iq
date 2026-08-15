# New app: Freshket customer-facing purchase dashboard — context handoff

**Status:** not started. This doc exists so the next session can pick up
design work without re-asking Bush (Boonwirat Thiemwongkul) everything from
scratch. Feature list below is from Bush directly (2026-07-11); he
explicitly wants a **future session to help design the rest** — this is a
context dump, not a spec.

## What this is

A brand-new, **customer-facing** dashboard for Freshket's B2B restaurant
customers to see their own purchase data and buying insights — pulling
reusable pieces (data patterns, UI patterns, one whole feature) from the two
existing **internal** apps in this monorepo (Sense, `/nrr`), but built as
its own thing with its own design system.

This would be the **first outward-facing, customer-authenticated product**
in this monorepo. Everything here today (Sense, `/nrr`) is internal-only —
KAMs, PMs, admins — gated by a coarse role flag (`nrrProfile.role ===
'admin'`, etc.), never by *customer* identity. That distinction matters a
lot for the architecture — see "Biggest open problem" below.

## Hard rule from Bush — non-negotiable

> "กฏเหล็กคือไม่ใช้ design system ของ claude แต่เป็น design system ที่สร้างขึ้นมาใหม่
> และอิงกับ tokens ของ App freshket (freshket.co) ด้วย"

- Do **not** reach for a generic/default AI-generated look.
- Do **not** reuse `design/tokens.css` (Sense's tokens) or
  `src/nrr/nrr_tokens.css` ("Fresh Canvas", built for `/nrr` only, explicitly
  scoped there — see the file's own header comment). Both are internal-tool
  visual languages, not meant for a customer-facing surface.
- Build a **new** token set, and it must be **anchored to Freshket's real
  consumer/customer-facing brand** (freshket.co — the actual live site/app),
  not invented from scratch. Next session should pull real brand assets
  (colors, type, logo, tone) from freshket.co first — ask Bush for brand
  guidelines/assets directly if a fetch isn't enough, don't guess.
- This repo currently has **no existing freshket.co brand token file** —
  confirmed by search, nothing to inherit here. This is genuinely net-new.

## Requested features (verbatim from Bush, organized)

Audience: **restaurant customers** (B2B), viewing their *own* account only.

1. Monthly purchase history, viewable going back over time.
2. Drill down by branch/outlet (สาขา).
3. Drill down by item/SKU — what they actually ordered.
4. Price movement & trend, per item.
5. Price change tracking, per item (how much a specific item's price has
   moved).
6. Category-level analytics — which product groups they buy more/less of.
7. **Bring the "SAVE" feature over from Sense** — surface alternative items
   (brand swap / spec swap / pack-size swap) that could save the customer
   money, with a projected ฿/month and ฿/year savings estimate. See "Reuse
   from Sense" below for exactly where this lives today.
8. Exportable reports, same idea as Sense's report screen — so the customer
   can send something to a partner or their boss.
9. **General seasonal commodity price trend** — not just items *this*
   customer buys, but broader seasonal patterns (lime, vegetables/fruit,
   pork, chicken, eggs) that go up/down with the season. Bush's own words:
   "ต้องทำ data เพิ่ม แต่ใช้ data จาก freshket ได้" — needs new data
   engineering, but the underlying data can come from Freshket's own
   transaction history (i.e. aggregate market-wide price series, not
   per-customer).
10. Open-ended: more restaurant-relevant use cases likely exist — explicitly
    deferred to a future design session with Bush.

## Reuse from the existing codebase — concrete pointers

These are real file/function references confirmed by grep this session, not
guesses — verify current line numbers before quoting them, code has moved
before.

- **SAVE / alternative-item matching engine**: `src/04_sku_matcher.js` —
  matches a customer's current SKU against catalog alternatives, AI-assisted
  verification prompt classifies each candidate by `grading` (A/B/C-ish
  confidence), `pack_size`, and an explicit `reason_code` enum when
  excluded: `wrong_type | pack_size | grade | spec | premium_breed |
  size_variant | flavor_variant | acid_type | beverage_brand`. This *is*
  the brand/spec/pack-size-swap logic Bush is asking for — don't
  reimplement, adapt/reuse.
- **Savings math + opportunity list UI**: `src/03_rendering.js` — opportunity
  rows sorted by *actionable monthly savings*, not raw spend size (see the
  `v207a` comment there). Per-row savings shown as `a.save` (monthly) and
  `a.save*12` (yearly) with a "−N%" reduction badge. This is the exact
  ฿/month + ฿/year pattern Bush wants.
- **Report/export screen**: `renderReport()` in `src/03_rendering.js`
  (search `function renderReport(){`), wired up as a `showScreen('report')`
  target alongside `'opportunities'` across `src/05_kam_view.js` and
  `src/06_portview_teamview.js`. This is the "ส่งรายงาน" (send report)
  pattern Bush means by "ดึง report ออกมาได้เหมือนใน sense."
- **Price movement/trend UI, per item**: `src/nrr/nrr_account.js` — `/nrr`'s
  Account-page price feature (built earlier this same week): normalized
  ฿/unit chart, 1-row filter, net price-effect hero stat cell, ฿-vs-sparkline
  row toggle, chart-dot hover tooltips, and a "creep" indicator for items
  whose MoM change is small but whose full-history drift is significant.
  This is the closest existing analog to requested features #4/#5 — worth
  studying the interaction design even though the visual language must
  change.
- **Category-level breakdown pattern**: `/nrr`'s Portfolio/Account views
  already group spend by category for KAM audiences — a reasonable starting
  point for feature #6, though the audience and framing are different
  (internal analysis vs. "here's what you bought more/less of this month").
- **CSV-from-BigQuery-to-R2 data pipeline pattern**: manual SQL rerun in
  BigQuery console → manual CSV upload to Cloudflare R2 → app fetches with
  404-graceful degrade, day-1 lag convention (`CURRENT_DATE - 1`) throughout.
  This *engineering pattern* is reusable, but see the next section — it is
  NOT sufficient as-is for a customer-facing surface.

## Biggest open problem: this repo has no per-customer auth/scoping model

Every data flow in this monorepo today is either (a) fully internal/portfolio-
wide (KAM/PM/admin can see everything), or (b) gated by a coarse role flag.
Nothing here scopes data to "this specific restaurant customer, and only
their own outlets/orders." A customer dashboard needs that as a hard
prerequisite — Customer A must never be able to see Customer B's purchase
history, prices, or savings opportunities. This is a different problem from
anything solved in this repo so far and should be one of the first things
the next session designs, not an afterthought bolted on at the end.

Related open questions Bush hasn't answered yet (don't guess, ask before
building):
- Does this live in the **same monorepo** as a new module, or is it a
  **separate repo/project**? (Given the design-system split requirement and
  the different auth model, a separate project may be cleaner — but that's
  Bush's call.)
- What's the actual **customer login mechanism**? Existing Freshket customer
  account system? New Supabase auth? Magic link? Something else?
- Data engineering for feature #9 (seasonal commodity trends) doesn't exist
  yet anywhere in this repo — will need new SQL against
  `freshket-rn.dwh.order` (or wherever the right source table is) at a
  market/category grain, not per-customer.

## Repo orientation (for whoever picks this up)

- Monorepo: `/Users/boonwiratthiemwongkul/Desktop/cost-iq-nrr`
  (`github.com/boonwirat-glitch/cost-iq`, branch `main`).
- **Sense** — internal KAM commission/opportunity-matching platform. Entry
  `index.html`, built via `build.py` (writes only `dist/sense_vN.html`,
  needs a manual `cp` to `index.html` to actually deploy).
- **`/nrr`** — NRR/commission dashboard, entry `nrr.html`, built via
  `build_nrr.py [version]` (reads `src/nrr/*.js|css` + `shell_nrr.html`,
  writes both `dist/nrr_vN.html` and overwrites `nrr.html` directly).
- Deploy = commit + push to `main` → Cloudflare Pages auto-deploys within
  ~10-20s.
- This new customer app would be neither of the above — a third,
  differently-audienced product that happens to start from ideas proven out
  in the first two.
