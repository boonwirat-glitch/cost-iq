#!/usr/bin/env python3
"""
Freshket NRR Quarterly Notebook (/nrr) build script
Usage: python3 build_nrr.py [version]
Example: python3 build_nrr.py v9

VERSION DISCIPLINE (go-live convention, 2026-07):
  /nrr runs its own monotonic nrr_vN series, independent of Sense's vNNN —
  the two apps release on separate cadences (sw.js whitelists only the
  Sense shell, so /nrr is never served from Sense's SW cache). Every
  deploy = bump N, never reuse. Output dist/nrr_vN.html is committed
  alongside nrr.html (the file Cloudflare Pages actually serves via
  _redirects). Deploy = merge to main + push → CF Pages auto-deploys.

Mirrors build_dashboard.py exactly (same string-concat pattern, no
bundler). Modules (inject order matters — dependencies before dependents):
  nrr_logic.js       ported _qnrrCompute (source of truth: src/07c_qnrr_view.js)
  nrr_data.js        R2 CSV fetch/parse, builds window.bulkQnrrData
  nrr_core.js        Supabase auth, role gate (tl/admin/rep), fmt helpers, CountUp
  nrr_router.js      hash router (#/ dashboard · #/portfolio · #/account) + role guards
  nrr_aggregate.js   org/team/KAM/outlet rollups on top of nrr_logic
  nrr_commission.js  reads commission_payout_snapshots (no re-derivation)
  nrr_portfolio.js   Portfolio layer pace/filter logic over window.bulkPortviewData (Phase B)
  nrr_notes.js       outlet notes (nrr_outlet_notes table — requires manual DB migration, degrades gracefully if missing)
  nrr_components.js  render helpers (stat tiles, movement chart, tags)
  nrr_view.js        page controller — wires fetch -> compute -> render
"""
import os, sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v1'

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

shell            = read('src/nrr/shell_nrr.html')
nrr_tokens       = read('src/nrr/nrr_tokens.css')
nrr_base         = read('src/nrr/nrr_base.css')
nrr_components_css = read('src/nrr/nrr_components.css')
nrr_logic        = read('src/nrr/nrr_logic.js')
nrr_data         = read('src/nrr/nrr_data.js')
nrr_core         = read('src/nrr/nrr_core.js')
nrr_router       = read('src/nrr/nrr_router.js')
nrr_aggregate    = read('src/nrr/nrr_aggregate.js')
nrr_commission   = read('src/nrr/nrr_commission.js')
nrr_portfolio    = read('src/nrr/nrr_portfolio.js')
nrr_notes        = read('src/nrr/nrr_notes.js')
nrr_components_js= read('src/nrr/nrr_components.js')
nrr_view         = read('src/nrr/nrr_view.js')

SLOTS = [
    ('<!-- INJECT_TOKENS -->',         nrr_tokens,          'style'),
    ('<!-- INJECT_BASE -->',           nrr_base,            'style'),
    ('<!-- INJECT_COMPONENTS -->',     nrr_components_css,  'style'),
    ('<!-- INJECT_LOGIC -->',          nrr_logic,           'script'),
    ('<!-- INJECT_DATA -->',           nrr_data,            'script'),
    ('<!-- INJECT_CORE -->',           nrr_core,            'script'),
    ('<!-- INJECT_ROUTER -->',         nrr_router,          'script'),
    ('<!-- INJECT_AGGREGATE -->',      nrr_aggregate,       'script'),
    ('<!-- INJECT_COMMISSION -->',     nrr_commission,      'script'),
    ('<!-- INJECT_PORTFOLIO -->',      nrr_portfolio,       'script'),
    ('<!-- INJECT_NOTES -->',          nrr_notes,           'script'),
    ('<!-- INJECT_COMPONENTS_JS -->',  nrr_components_js,   'script'),
    ('<!-- INJECT_VIEW -->',           nrr_view,            'script'),
]

out = shell
for placeholder, content, kind in SLOTS:
    tag_open  = '<style>' if kind == 'style' else '<script>'
    tag_close = '</style>' if kind == 'style' else '</script>'
    old = f'{tag_open}\n{placeholder}\n{tag_close}'
    new = f'{tag_open}\n{content}{tag_close}'
    out = out.replace(old, new)

unresolved = [p for p, _, _ in SLOTS if p in out]
if unresolved:
    for p in unresolved:
        print(f'WARNING: unresolved placeholder: {p}', file=sys.stderr)

os.makedirs('dist', exist_ok=True)
path = f'dist/nrr_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

# Also write to repo root as nrr.html — served directly by Cloudflare Pages
# via the /nrr and /nrr/* rewrites in _redirects (same pattern as
# dashboard.html at the root).
with open('nrr.html', 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb    = len(out.encode()) // 1024
print(f'Built {path} and nrr.html  ({lines:,}L · {kb:,}KB)')
