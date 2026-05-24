#!/usr/bin/env python3
"""
Freshket Sense build script
Usage: python build.py [version]
Example: python build.py v225
"""
import os, sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v225'

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
commission_js = read('src/07a_commission_engine.js') + read('src/07b_commission_ui.js')
patches_js    = read('src/08_patches.js')

out = (shell
    .replace('<script>\n<!-- INJECT_MAIN_SCRIPT -->\n</script>\n',
             f'<script>\n{main_js}</script>\n')
    .replace('<script id="target-module-js">\n<!-- INJECT_COMMISSION -->\n</script>\n',
             f'<script id="target-module-js">\n{commission_js}</script>\n')
    .replace('<script id="freshket-patches-consolidated">\n<!-- INJECT_PATCHES -->\n</script>\n',
             f'<script id="freshket-patches-consolidated">\n{patches_js}</script>\n')
)

os.makedirs('dist', exist_ok=True)
path = f'dist/sense_{VERSION}.html'
with open(path, 'w', encoding='utf-8') as f:
    f.write(out)

lines = out.count('\n')
kb    = len(out.encode()) // 1024
print(f'Built {path}  ({lines:,}L · {kb:,}KB)')
