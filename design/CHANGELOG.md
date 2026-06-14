# CHANGELOG
`design/CHANGELOG.md`

All design system changes are documented here.
Format: `## v{version} — {date} — {summary}`

---

## v1.0 — 2026-06-14 — Initial system

**Established:**
- Full 3-layer token architecture (Primitive → Semantic → Component)
- Light theme default + Dark theme via `[data-theme="dark"]`
- Typography: IBM Plex Mono (data) + Noto Sans Thai (UI)
- 7-level type scale (display 48px → micro 9px)
- 4px base spacing grid, 10-stop scale
- 5-level radius system
- 2-level shadow system (prefer border over shadow)
- Motion: 5 durations + 5 easing curves + prefers-reduced-motion support
- Z-index stack (8 levels)
- Status colors: ok/warn/danger/info (base + dim + border + text per status)
- Segment colors: SA/MC/Chain/EU (light + dark variants)
- Choropleth scale: 6-stop red scale for map density
- Map polygon component tokens
- Desktop layout tokens: sidebar, detail panel, topbar heights
- Component tokens: Button (4 variants), Input, Card, Badge/Chip, Row, Bar, Tooltip, Avatar, Icon, Segmented control, Toast

**Responsive:**
- 3 breakpoints: 640 / 1024 / 1440
- Full component behavior matrix per breakpoint
- Safe-area-inset pattern documented
- Bottom sheet ↔ modal transformation documented

**Spec:**
- 11 design rules in DESIGN_SYSTEM.md
- Do/Don't table
- File structure + CSS class prefix conventions (ds-, sv-, tv-, td-, ci-)

**Reference:**
- Extracted from: Sense Sales UI (styles_sales.css 175 components), Sense tokens (styles_tokens.css), TL Dashboard prototype
- Aligned with: Airbnb DLS × Revolut aesthetic
- Accent: Rausch #FF385C (same as existing Sales UI)

---

## Pending

- `components.html` — living reference page (next)
- Migrate `styles_sales.css` hardcodes to CSS variables
- Add `styles_dashboard.css` td- prefix component set

