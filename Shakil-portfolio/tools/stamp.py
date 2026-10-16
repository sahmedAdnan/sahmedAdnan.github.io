"""Adds a content fingerprint to every local script and stylesheet in index.html
(js/main.js -> js/main.js?v=3f9a1c2e), so browsers fetch a file again whenever it
changes instead of reusing an old cached copy. Run after editing any JS or CSS file:
    python tools/stamp.py"""
import hashlib
import os
import re

site = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
page = os.path.join(site, 'index.html')
html = open(page, encoding='utf-8').read()


def stamp(m):
    attr, path = m.group(1), m.group(2)
    with open(os.path.join(site, path), 'rb') as f:
        digest = hashlib.md5(f.read()).hexdigest()[:8]
    return f'{attr}="{path}?v={digest}"'


new = re.sub(r'(src|href)="((?:js|css)/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, html)
if new != html:
    open(page, 'w', encoding='utf-8').write(new)
print('\n'.join(re.findall(r'(?:js|css)/[^"]+\?v=[0-9a-f]+', new)))
