#!/usr/bin/env python3
"""
Freshket TL Dashboard build script
Usage: python build_dashboard.py [version]
Example: python build_dashboard.py v702
"""
import os, sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v702'

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

shell = read('src/dashboard/shell_dashboard.html')

# CSS
styles_tokens  = read('design/tokens.css')
styles_dash    = read('src/dashboard/styles_dashboard.css')

# JS
dash_core      = read('src/dashboard/dash_core.js')
dash_data      = read('src/dashboard/dash_data.js')
dash_layout    = read('src/dashboard/dash_layout.js')
dash_teamview  = read('src/dashboard/dash_teamview.js')
dash_map       = read('src/dashboard/dash_map.js')

out = (shell
    .replace('<style>\n<!-- INJECT_TOKENS -->\n</style>',
             f'<style>\n{styles_tokens}</style>')
    .replace('<style>\n<!-- INJECT_STYLES_DASHBOARD -->\n</style>',
             f'<style>\n{styles_dash}</style>')
    .replace('<script>\n<!-- INJECT_DASH_CORE -->\n</script>',
             f'<script>\n{dash_core}</script>')
    .replace('<script>\n<!-- INJECT_DASH_DATA -->\n</script>',
             f'<script>\n{dash_data}</script>')
    .replace('<script>\n<!-- INJECT_DASH_LAYOUT -->\n</script>',
             f'<script>\n{dash_layout}</script>')
    .replace('<script>\n<!-- INJECT_DASH_TEAMVIEW -->\n</script>',
             f'<script>\n{dash_teamview}</script>')
    .replace('<script>\n<!-- INJECT_DASH_MAP -->\n</script>',
             f'<script>\n{dash_map}</script>')
    .replace("'DASHBOARD_VERSION'", f"'{VERSION}'")
)

for p in ['INJECT_TOKENS','INJECT_STYLES_DASHBOARD','INJECT_DASH_CORE',
          'INJECT_DASH_DATA','INJECT_DASH_LAYOUT','INJECT_DASH_TEAMVIEW','INJECT_DASH_MAP']:
    if p in out:
        print(f'WARNING: unresolved {p}', file=sys.stderr)

os.makedirs('dist', exist_ok=True)
path = f'dist/dashboard_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb = len(out.encode()) // 1024
print(f'Built {path}  ({lines:,}L · {kb:,}KB)')
