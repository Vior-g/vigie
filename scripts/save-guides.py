#!/usr/bin/env python3
"""Enregistre un lot de guides : stdin = {"slug-dpln": {"dj": "Nom du donjon", ...}}.
Chaque guide va dans src/data/guides/<slug>.json avec sa source."""
import json, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'data', 'guides')
os.makedirs(root, exist_ok=True)
batch = json.loads(sys.stdin.read())
for slug, g in batch.items():
    g['src'] = f'https://www.dofuspourlesnoobs.com/{slug}.html'
    with open(os.path.join(root, f'{slug}.json'), 'w', encoding='utf-8') as f:
        json.dump(g, f, ensure_ascii=False, indent=1)
    print('ok', slug, g.get('dj'), '|', g.get('boss'))
