#!/usr/bin/env python3
import re

def check_file(path):
    with open(path, encoding='utf-8') as f:
        lines = f.readlines()
    results = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            continue
        if re.search(r'[\u3040-\u9FFF\u30A0-\u30FF]', line):
            results.append((i, line.rstrip()))
    return results

files = [
    'routes/contracts.js',
    'routes/leave.js',
    'routes/workflow.js',
    'routes/hr.js',
    'routes/overtime.js',
    'routes/admin.js',
]

for f in files:
    try:
        hits = check_file(f)
        unique = list({ln: text for ln, text in hits}.items())
        print(f"\n=== {f}: {len(unique)} unique non-comment JP lines ===")
        for ln, text in unique[:20]:
            print(f"  L{ln}: {text[:100]}")
    except Exception as e:
        print(f"\n=== {f}: ERROR {e} ===")
