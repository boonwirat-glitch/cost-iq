#!/usr/bin/env python3
"""
Freshket TL Dashboard build script
Usage: python build_dashboard.py [version]
Example: python build_dashboard.py v707

Modules (inject order matters — dependencies must come before dependents):
  dash_core.js       auth, DashLog, format utils
  dash_data.js       R2 CSV pipeline, buildKamGroups
  dash_layout.js     view routing, topbar, DashState
  dash_teamview.js   team summary, rep list, team table
  dash_commission.js commission snapshots + estimate
  dash_skills.js     skill matrix, pending, echo tab
  dash_echo.js       Echo feed, TL note, mark reviewed
  dash_map.js        D3 choropleth + GeoJSON
"""
import os, sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v707'

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

shell          = read('src/dashboard/shell_dashboard.html')
styles_tokens  = read('design/tokens.css')
styles_dash    = read('src/dashboard/styles_dashboard.css')
dash_core      = read('src/dashboard/dash_core.js')
dash_data      = read('src/dashboard/dash_data.js')
dash_layout    = read('src/dashboard/dash_layout.js')
dash_teamview  = read('src/dashboard/dash_teamview.js')
dash_commission= read('src/dashboard/dash_commission.js')
dash_skills    = read('src/dashboard/dash_skills.js')
dash_echo      = read('src/dashboard/dash_echo.js')
dash_map       = read('src/dashboard/dash_map.js')

SLOTS = [
    ('<!-- INJECT_TOKENS -->',           styles_tokens,  'style'),
    ('<!-- INJECT_STYLES_DASHBOARD -->',  styles_dash,    'style'),
    ('<!-- INJECT_DASH_CORE -->',         dash_core,      'script'),
    ('<!-- INJECT_DASH_DATA -->',         dash_data,      'script'),
    ('<!-- INJECT_DASH_LAYOUT -->',       dash_layout,    'script'),
    ('<!-- INJECT_DASH_TEAMVIEW -->',     dash_teamview,  'script'),
    ('<!-- INJECT_DASH_COMMISSION -->',   dash_commission,'script'),
    ('<!-- INJECT_DASH_SKILLS -->',       dash_skills,    'script'),
    ('<!-- INJECT_DASH_ECHO -->',         dash_echo,      'script'),
    ('<!-- INJECT_DASH_MAP -->',          dash_map,       'script'),
]

out = shell
for placeholder, content, kind in SLOTS:
    tag_open  = '<style>' if kind == 'style' else '<script>'
    tag_close = '</style>' if kind == 'style' else '</script>'
    old = f'{tag_open}\n{placeholder}\n{tag_close}'
    new = f'{tag_open}\n{content}{tag_close}'
    out = out.replace(old, new)

out = out.replace("'DASHBOARD_VERSION'", f"'{VERSION}'")

# Verify
unresolved = [p for p, _, _ in SLOTS if p in out]
if unresolved:
    for p in unresolved:
        print(f'WARNING: unresolved placeholder: {p}', file=sys.stderr)

os.makedirs('dist', exist_ok=True)
path = f'dist/dashboard_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb    = len(out.encode()) // 1024
print(f'Built {path}  ({lines:,}L · {kb:,}KB)')
