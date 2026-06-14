# Freshket Commercial OS — Design System
`design/DESIGN_SYSTEM.md` · v1.0

> **For AI coding agents:** Read this file before writing any CSS or HTML component.
> Every color, spacing, radius, and motion value must reference a token from `tokens.css`.
> No hardcoded hex values. No emoji. No shadow when a border suffices.

---

## 1. What this system is

Design system for Freshket Commercial OS — a suite of internal tools for commercial teams:
- **Sense** — mobile PWA for KAM, Sales, AD reps in the field
- **TL Dashboard** — desktop web app for Team Leads and Admins

Both products share this token system. Sense uses `[data-theme="dark"]`. TL Dashboard uses light theme (default).

---

## 2. Core principles

**Numbers do the work.**
Hero metrics use `--text-display` or `--text-hero` in IBM Plex Mono at `--weight-bold` or `--weight-extrabold`. A large, well-set number communicates faster than any icon or badge. Let it.

**White canvas, not boxes.**
Default to `--bg` (#FFFFFF) with hairline borders (`--hair`) and typography hierarchy. Avoid boxing every element in a card with a shadow. Use cards only when grouping is semantically meaningful.

**Red is signal, not decoration.**
`--ac` (Rausch #FF385C) appears on: active nav, primary CTA, top accent line on hero card, selected state, link text. Nowhere else. Do not use red as a background color except on primary buttons.

**Mono for data, Thai for prose.**
IBM Plex Mono: all numbers, percentages, dates, codes, labels in ALLCAPS, table headers. Noto Sans Thai: all body copy, button labels, nav labels, Thai text.

**No emoji.**
Use SVG icons only. Stroke-based, `stroke-width: 1.5`, sized via `--c-icon-*` tokens, colored via `currentColor`.

---

## 3. Token usage rules

### Colors
```css
/* CORRECT */
color: var(--ink-1);
background: var(--surface);
border: 1px solid var(--hair);

/* WRONG */
color: #222222;
background: #F7F7F7;
border: 1px solid #EBEBEB;
```

### Status colors
| Signal   | Color token    | Dim token       | Use case |
|----------|---------------|-----------------|----------|
| OK/positive | `--ok`     | `--ok-dim`      | Growth, on-target, pass |
| Warning  | `--warn`      | `--warn-dim`    | At risk, needs attention |
| Danger   | `--danger`    | `--danger-dim`  | Critical, below threshold |
| Accent   | `--ac`        | `--ac-dim`      | Active, selected, CTA |
| Info     | `--info`      | `--info-dim`    | Neutral info, new items |

Always use both: the base color for text/icon + the dim for background fill.
Example: `color: var(--ok); background: var(--ok-dim);`

### Segment colors
```
SA (ซา)    → --sa   (#1D57D8 light / #5B9CF6 dark)
MC         → --mc   (#047A57 light / #4CD4A0 dark)
Chain      → --ch   (#C97000 light / #FBBF24 dark)
End User   → --eu   (#6D30D4 light / #C4A3FC dark)
```

---

## 4. Typography rules

### Scale usage
| Token           | Size  | Use |
|----------------|-------|-----|
| `--text-display` | 48px | Single hero metric per screen |
| `--text-hero`    | 36px | Dashboard KPI card |
| `--text-h1`      | 28px | Page title (mobile portview) |
| `--text-h2`      | 22px | Section heading |
| `--text-h3`      | 18px | Card heading |
| `--text-lg`      | 16px | Prominent body |
| `--text-body`    | 14px | Default body, list items |
| `--text-sm`      | 13px | Secondary meta |
| `--text-xs`      | 12px | Table data, timestamps |
| `--text-2xs`     | 11px | Labels, badges |
| `--text-3xs`     | 10px | MONO labels, eyebrows |
| `--text-micro`    | 9px  | Minimum — legend, chart axis |

### Eyebrow pattern
Section labels above titles use this exact treatment:
```css
font-family: var(--font-mono);
font-size: var(--text-3xs);
font-weight: var(--weight-semibold);
letter-spacing: var(--ls-wider);
text-transform: uppercase;
color: var(--ink-3);         /* or var(--ac) for active sections */
```

### Number pattern (KPI, metrics)
```css
font-family: var(--font-mono);
font-size: var(--text-hero);    /* or --text-display for hero */
font-weight: var(--weight-bold);
letter-spacing: var(--ls-tight);
line-height: var(--lh-tight);
color: var(--ink-1);
```

---

## 5. Spacing rules

Base grid: **4px**. All spacing must be a multiple of 4px.
Use `--space-*` tokens, never arbitrary values.

**Page margins:**
- Mobile: `--pad-page-x` (20px) horizontal
- Desktop: `--pad-page-x-md` (32px) horizontal

**Component internal padding:**
- Card: `--pad-card` (16px) all sides
- Row: `--c-row-pad-x` (16px) horizontal, 0 vertical (height set by `--c-row-h`)
- Section header: `--space-3` top, `--space-2` bottom

---

## 6. Component patterns

### Hero card
Every screen has at most **one** hero card. Structure:
```
top accent line (2.5px, --ac)
eyebrow (MONO, --ink-3, uppercase)
hero number (MONO, --text-hero or display, --ink-1)
unit (body size, --ink-2)
subline (--text-sm, --ink-3) + status badge
target bar (optional, --c-bar-h-md, --c-bar-track)
```
Background: `--surface`. Border radius: `--r-lg`. No shadow.

### List row
```
height: --c-row-h (44px)
padding-left/right: --c-row-pad-x
border-bottom: --c-row-border
hover: background --c-row-hover
selected: background --c-row-selected + 2px left border --ac
```
Never use alternating row colors. Use hairline dividers only.

### Status chip / badge
```
small text: --text-micro, --weight-semibold
padding: 2px 6px (badge) or 3px 9px (pill)
radius: --r-xs (badge) or --r-full (pill)
color pattern: text = status color, bg = status-dim
```

### Section divider
```
padding-top: --space-6
eyebrow label + hairline line extending to edge
border-bottom: 1px solid --hair
```
Pattern:
```html
<div class="section-hd">
  <span class="eyebrow">SECTION LABEL</span>
  <span class="section-count">N</span>  <!-- optional -->
</div>
```

### Empty state
Structure: context-relevant icon (SVG, `--c-icon-xl`, `--ink-4`) + title (`--text-h3`, `--ink-2`) + description (`--text-body`, `--ink-3`) + optional CTA button.
Never use emoji. Copy must be actionable, not apologetic.

---

## 7. Responsive rules

### Breakpoints
```
< 640px   mobile   (default, mobile-first)
≥ 640px   sm       tablet portrait
≥ 1024px  md       desktop
≥ 1440px  lg       wide desktop
```

### Component behavior per breakpoint

| Component         | Mobile                           | Desktop (md+)                      |
|-------------------|----------------------------------|------------------------------------|
| Navigation        | Bottom nav bar, 72px             | Left sidebar, `--sidebar-width`    |
| Page layout       | Single column, scroll            | 3-panel: sidebar + main + detail   |
| Hero card         | Full width, 16px margin          | Inline in panel, constrained width |
| Detail view       | Full-screen push navigation      | Right drawer, `--detail-width`     |
| Modal             | Bottom sheet, slide up           | Center dialog, max-width 520px     |
| Table             | Collapsed to list rows           | Full table with column headers     |
| Chart             | Simplified, fewer data points    | Full chart with axis labels        |
| Topbar height     | `--topbar-height-mob` (48px)     | `--topbar-height` (52px)           |
| Padding horizontal| `--pad-page-x` (20px)            | `--pad-page-x-md` (32px)           |

### Sidebar on mobile
Never render the desktop sidebar on mobile. Instead:
- Left panel content → route to separate screen (drill-down navigation)
- Use `showScreen()` / push navigation pattern
- Bottom nav is the primary navigation on mobile

### Bottom sheet (mobile modal)
```css
border-radius: var(--r-xl) var(--r-xl) 0 0;
padding-top: var(--space-4);   /* handle area */
padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
```

---

## 8. Map components

Choropleth polygon fill: use `--choro-0` through `--choro-5` as a D3 scale:
```js
d3.scaleSequential()
  .domain([min, max])
  .interpolator(d3.interpolateRgb(
    getComputedStyle(document.documentElement).getPropertyValue('--choro-0'),
    getComputedStyle(document.documentElement).getPropertyValue('--choro-5')
  ))
```

Polygon states:
- Default: choropleth fill, `--c-poly-stroke` (white), `--c-poly-stroke-w` (1px)
- Hover: opacity .80, stroke-width `--c-poly-stroke-hover`
- Selected: stroke `--c-poly-stroke-selected`, width `--c-poly-stroke-selected-w`
- Muted (other province): fill `--c-poly-muted-fill`, opacity `--c-poly-muted-opacity`

---

## 9. Icon guidelines

- Size: always use `--c-icon-sm/md/lg/xl` tokens
- Stroke: `stroke-width: 1.5`, `fill: none`, `stroke: currentColor`
- Alignment: `vertical-align: middle` or flexbox `align-items: center`
- Never use `<img>` for icons — inline SVG or SVG sprite only
- Never use emoji as icons or decorative elements

**Approved icon sizes by context:**
- Button (sm): `--c-icon-sm` (14px)
- Button (default): `--c-icon-md` (18px)
- Nav item: `--c-icon-lg` (22px)
- Empty state: `--c-icon-xl` (28px)

---

## 10. Dark mode implementation

Apply `data-theme="dark"` to the `<html>` or root container element.
All semantic tokens update automatically — no component-level overrides needed.

```js
// Toggle
document.documentElement.setAttribute('data-theme', 'dark');
document.documentElement.removeAttribute('data-theme');  // revert to light

// Sense app: always dark
document.documentElement.setAttribute('data-theme', 'dark');

// TL Dashboard: always light (default, no attribute needed)
```

---

## 11. Do / Don't

| Do | Don't |
|----|-------|
| Use `var(--token)` for every value | Hardcode hex colors |
| Use SVG icons with `currentColor` | Use emoji as icons or UI elements |
| Use hairline borders as primary dividers | Add shadow to every card |
| Let numbers be the hero | Add decorative gradients |
| One accent element per section | Use red for anything non-actionable |
| `--font-mono` for all numeric data | Mix fonts randomly |
| Test at 375px and 1440px | Design only for one viewport |
| Write empty states with a next action | Show generic "No data" |
| Match status text + dim background | Use only status color as bg |

---

## 12. File structure

```
design/
  DESIGN_SYSTEM.md    ← this file (AI reads before every session)
  tokens.css          ← single source of truth for all values
  components.html     ← living reference, all components rendered
  RESPONSIVE.md       ← breakpoint rules, component behavior
  CHANGELOG.md        ← version history

src/
  styles_tokens.css   ← symlink or copy of design/tokens.css
  styles_base.css     ← reset, body, typography defaults
  styles_layout.css   ← topbar, sidebar, page grid
  styles_components.css ← shared component classes (ds- prefix)
  styles_sales.css    ← Sales/TL specific overrides (sv- prefix)
  styles_dashboard.css ← TL Dashboard specific (td- prefix)
```

**CSS class prefixes:**
- `ds-` → design system base components (shared across all products)
- `sv-` → Sales View components (Sense sales module)
- `tv-` → Team View components (Sense teamview)
- `td-` → TL Dashboard components (desktop)
- `ci-` → Conversation Intelligence / Echo components

