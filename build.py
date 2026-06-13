#!/usr/bin/env python3
"""
Freshket Sense build script
Usage: python build.py [version]
Example: python build.py v255
"""
import os, sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v255'

MAIN_MODULES = [
    '01_core',
    '02_data_pipeline',
    '03_rendering',
    '04_sku_matcher',
    '05_kam_view',
    '06_portview_teamview',
]

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

shell         = read('src/shell.html')
main_js       = ''.join(read(f'src/{m}.js') for m in MAIN_MODULES)
commission_js = (
    read('src/07a_commission_engine.js') +
    read('src/07b_commission_cockpit.js') +
    read('src/07b_nrr_target.js') +
    read('src/07b_cds.js') +
    read('src/07b_commission_history.js')
)
patches_js    = read('src/08_patches.js')
conv_intel_js = read('src/09_conv_intel.js')
sales_js     = read('src/10_sales_view.js')
skills_js    = read('src/11_skills.js')
styles_skills = read('src/styles_skills.css')
styles_rest   = read('src/styles_restaurant.css')
styles_echo   = read('src/styles_echo.css')
styles_auth   = read('src/styles_auth.css')
styles_nav    = read('src/styles_nav.css')
styles_pv     = read('src/styles_portview.css')
styles_tv       = read('src/styles_teamview.css')
styles_overview = read('src/styles_overview.css')
styles_save     = read('src/styles_save.css')
styles_report   = read('src/styles_report.css')
styles_aichat   = read('src/styles_aichat.css')
styles_sales = read('src/styles_sales.css')
styles_tokens  = read('src/styles_tokens.css')
styles_base    = read('src/styles_base.css')
styles_layout  = read('src/styles_layout.css')
styles_main    = read('src/styles_main.css')
styles_comm   = read('src/styles_commission.css')

out = (shell
    # ── CSS injections ──
    .replace('<style>\n<!-- INJECT_STYLES_TOKENS -->\n</style>',
             f'<style>\n{styles_tokens}</style>')
    .replace('<style>\n<!-- INJECT_STYLES_BASE -->\n</style>',
             f'<style>\n{styles_base}</style>')
    .replace('<style>\n<!-- INJECT_STYLES_LAYOUT -->\n</style>',
             f'<style>\n{styles_layout}</style>')
    .replace('<style>\n<!-- INJECT_STYLES_MAIN -->\n</style>',
             f'<style>\n{styles_main}</style>')
    .replace('<style id="target-module-css">\n<!-- INJECT_STYLES_COMMISSION -->\n</style>',
             f'<style id="target-module-css">\n{styles_comm}</style>')
    # ── JS injections ──
    .replace('<script>\n<!-- INJECT_MAIN_SCRIPT -->\n</script>\n',
             f'<script>\n{main_js}</script>\n')
    .replace('<script id="target-module-js">\n<!-- INJECT_COMMISSION -->\n</script>\n',
             f'<script id="target-module-js">\n{commission_js}</script>\n')
    .replace('<script id="freshket-patches-consolidated">\n<!-- INJECT_PATCHES -->\n</script>\n',
             f'<script id="freshket-patches-consolidated">\n{patches_js}</script>\n')
    .replace('<script id="freshket-conv-intel">\n<!-- INJECT_CONV_INTEL -->\n</script>\n',
             f'<script id="freshket-conv-intel">\n{conv_intel_js}</script>\n')
    .replace('<script id="freshket-sales">\n<!-- INJECT_SALES -->\n</script>\n',
             f'<script id="freshket-sales">\n{sales_js}</script>\n')
    .replace('<script id="freshket-skills">\n<!-- INJECT_SKILLS -->\n</script>\n',
             f'<script id="freshket-skills">\n{skills_js}</script>\n')
    .replace('<style id="restaurant-module-css">\n<!-- INJECT_STYLES_RESTAURANT -->\n</style>',
             f'<style id="restaurant-module-css">\n{styles_rest}</style>') \
             .replace('<style id="echo-module-css">\n<!-- INJECT_STYLES_ECHO -->\n</style>',
             f'<style id="echo-module-css">\n{styles_echo}</style>') \
             .replace('<style id="auth-module-css">\n<!-- INJECT_STYLES_AUTH -->\n</style>',
             f'<style id="auth-module-css">\n{styles_auth}</style>') \
             .replace('<style id="nav-module-css">\n<!-- INJECT_STYLES_NAV -->\n</style>',
             f'<style id="nav-module-css">\n{styles_nav}</style>') \
             .replace('<style id="portview-module-css">\n<!-- INJECT_STYLES_PORTVIEW -->\n</style>',
             f'<style id="portview-module-css">\n{styles_pv}</style>') \
             .replace('<style id="tv-module-css">\n<!-- INJECT_STYLES_TV -->\n</style>',
             f'<style id="tv-module-css">\n{styles_tv}</style>') \
             .replace('<style id="overview-module-css">\n<!-- INJECT_STYLES_OVERVIEW -->\n</style>',
             f'<style id="overview-module-css">\n{styles_overview}</style>') \
             .replace('<style id="save-module-css">\n<!-- INJECT_STYLES_SAVE -->\n</style>',
             f'<style id="save-module-css">\n{styles_save}</style>') \
             .replace('<style id="report-module-css">\n<!-- INJECT_STYLES_REPORT -->\n</style>',
             f'<style id="report-module-css">\n{styles_report}</style>') \
             .replace('<style id="aichat-module-css">\n<!-- INJECT_STYLES_AICHAT -->\n</style>',
             f'<style id="aichat-module-css">\n{styles_aichat}</style>') \
             .replace('<style id="skills-module-css">\n<!-- INJECT_STYLES_SKILLS -->\n</style>',
             f'<style id="skills-module-css">\n{styles_skills}</style>')
    .replace('<style id="sales-module-css">\n<!-- INJECT_STYLES_SALES -->\n</style>',
             f'<style id="sales-module-css">\n{styles_sales}</style>')
    # ── Build version ──
    .replace("version: 'v212c-diagnostics-counter-fix'",
             f"version: '{VERSION}'")
    .replace('<!-- Freshket Sense v224d:',
             f'<!-- Freshket Sense {VERSION}:')
)

# Verify no unresolved placeholders remain
for p in ['INJECT_STYLES_TOKENS', 'INJECT_STYLES_MAIN', 'INJECT_STYLES_COMMISSION', 'INJECT_SKILLS', 'INJECT_STYLES_SKILLS',
          'INJECT_MAIN_SCRIPT', 'INJECT_COMMISSION', 'INJECT_PATCHES', 'INJECT_SALES',
          'INJECT_STYLES_RESTAURANT', 'INJECT_STYLES_ECHO', 'INJECT_STYLES_AUTH', 'INJECT_STYLES_NAV', 'INJECT_STYLES_PORTVIEW', 'INJECT_STYLES_TV', 'INJECT_STYLES_OVERVIEW', 'INJECT_STYLES_SAVE', 'INJECT_STYLES_REPORT', 'INJECT_STYLES_AICHAT']:
    if p in out:
        print(f'WARNING: unresolved placeholder {p}', file=sys.stderr)

os.makedirs('dist', exist_ok=True)
path = f'dist/sense_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb    = len(out.encode()) // 1024
print(f'Built {path}  ({lines:,}L · {kb:,}KB)')
