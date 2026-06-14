# Freshket Commercial OS — Responsive Rules
`design/RESPONSIVE.md` · v1.0

## Breakpoints

```
Base (mobile-first): 0px+    → single column, touch-optimized
sm:                  640px+  → tablet, two-column possible
md:                  1024px+ → desktop, multi-panel layout
lg:                  1440px+ → wide, max content width enforced
```

Apply in CSS:
```css
/* mobile-first — add complexity upward */
.element { padding: var(--pad-page-x); }
@media (min-width: 1024px) { .element { padding: var(--pad-page-x-md); } }
```

---

## Layout per breakpoint

### Mobile (< 1024px)
- Single column, vertical scroll
- Bottom nav bar (72px, fixed, safe-area-inset-bottom)
- Topbar 48px fixed
- Full-width content with 20px horizontal padding
- No sidebar
- Detail views → full-screen push (new screen)
- Modals → bottom sheet (slide up from bottom)
- Tables → list rows (no column headers visible)
- Charts → simplified (fewer labels, touch-friendly)

### Desktop (≥ 1024px)
- 3-panel: sidebar (280px) + main (flex-1) + detail drawer (340px, slide-in)
- Topbar 52px fixed
- Left sidebar replaces bottom nav
- Detail views → right drawer (no navigation change)
- Modals → centered dialog (max-width 520px)
- Tables → full table with column headers
- Charts → full detail with axis labels and legend

---

## Component-level responsive behavior

### Navigation
```
Mobile:  position: fixed; bottom: 0; height: var(--bnav-height);
         items: 4-5 max, icon + label
Desktop: position: fixed; left: 0; width: var(--sidebar-width);
         items: unlimited with section dividers
```

### Hero card
```
Mobile:  margin: 0 var(--pad-page-x); full bleed minus margin
Desktop: constrained within panel, no margin needed
         --text-hero stays same size (numbers are always prominent)
```

### Data table
```
Mobile:  Each row = summary card pattern
         show: name + primary metric + status chip
         hide: all secondary columns
         expand row on tap to reveal detail
Desktop: Full table
         row height: --c-row-h (44px)
         sticky column headers
         sort on click
```

### Bottom sheet → Modal transformation
```css
/* Mobile: bottom sheet */
@media (max-width: 1023px) {
  .ds-modal {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    max-height: 92dvh;
    padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
    animation: slideUp var(--dur-normal) var(--ease-out);
  }
}
/* Desktop: centered dialog */
@media (min-width: 1024px) {
  .ds-modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 520px;
    max-height: 80vh;
    border-radius: var(--r-xl);
    animation: fadeScale var(--dur-normal) var(--ease-out);
  }
}
```

### Detail panel
```
Mobile:  Full-screen overlay (showScreen pattern in Sense)
         Back button top-left
Desktop: Right drawer, var(--detail-width) wide
         Slide in from right: transform translateX(100%) → translateX(0)
         Does not overlay main content — main shrinks or use absolute
```

### Topbar
```
Mobile:  height: var(--topbar-height-mob) [48px]
         title centered or left
         max 2 actions on right
Desktop: height: var(--topbar-height) [52px]
         product name + section + spacer + controls right
         month selector, metric toggle, user avatar
```

### Form inputs
```
Mobile:  Full width, stacked (label above input)
         min-height: 44px (touch target)
Desktop: Inline possible for short forms
         min-height: 40px (--c-input-h)
```

### Charts (sparkline, bar chart, trend)
```
Mobile:  Simplified — hide axis labels, reduce data points to 6
         Touch: show tooltip on tap (not hover)
Desktop: Full — axis labels, all data points, hover tooltips
         Click to drill down
```

---

## Safe area handling (iOS PWA)

Always use `env(safe-area-inset-*)` for fixed elements:
```css
.topbar {
  padding-top: env(safe-area-inset-top, 0px);
}
.bnav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.bottom-sheet {
  padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
}
```

Do not add safe-area-inset to scrollable content containers — only to fixed/sticky elements.

---

## JS breakpoint detection

```js
const isMobile  = () => window.innerWidth < 1024;
const isDesktop = () => window.innerWidth >= 1024;
const isWide    = () => window.innerWidth >= 1440;

// Route to correct layout on load
function initLayout() {
  if (isDesktop() && (role === 'tl' || role === 'admin')) {
    // Redirect to /dashboard
  } else {
    // Use Sense mobile layout
  }
}
```

---

## Text sizing on mobile vs desktop

No font size changes between breakpoints — the type scale is calibrated to work at both.
Exception: `--text-display` (48px) — on screens < 360px width, reduce to `--text-hero` (36px).

```css
.kpi-display {
  font-size: var(--text-hero);
}
@media (min-width: 640px) {
  .kpi-display { font-size: var(--text-display); }
}
```

