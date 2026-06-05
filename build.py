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
styles_main   = read('src/styles_main.css')
styles_comm   = read('src/styles_commission.css')

out = (shell
    # ── CSS injections ──
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
    # ── Build version ──
    .replace("version: 'v212c-diagnostics-counter-fix'",
             f"version: '{VERSION}'")
    .replace('<!-- Freshket Sense v224d:',
             f'<!-- Freshket Sense {VERSION}:')
)

# Verify no unresolved placeholders remain
for p in ['INJECT_STYLES_MAIN', 'INJECT_STYLES_COMMISSION',
          'INJECT_MAIN_SCRIPT', 'INJECT_COMMISSION', 'INJECT_PATCHES']:
    if p in out:
        print(f'WARNING: unresolved placeholder {p}', file=sys.stderr)

os.makedirs('dist', exist_ok=True)
path = f'dist/sense_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb    = len(out.encode()) // 1024
print(f'Built {path}  ({lines:,}L · {kb:,}KB)')
