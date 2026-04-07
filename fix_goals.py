#!/usr/bin/env python3
import re

src = '/Users/user/dxpro-attendance/dxpro-attendance/routes/goals.js.backup'
dst = '/Users/user/dxpro-attendance/dxpro-attendance/routes/goals.js'

content = open(src, encoding='utf-8').read()

# Find the end of the new /goals route
new_end_marker = "renderPage(req, res, '目標設定管理', '目標管理', html);\n});"
new_end_idx = content.find(new_end_marker)
if new_end_idx == -1:
    print("ERROR: could not find new /goals route end marker")
    exit(1)
print(f"New /goals route ends at index {new_end_idx}")

# Find the start of the AI suggestions route (which comes after the orphan)
ai_route_marker = "\n// 疑似AIレスポンス"
ai_idx = content.find(ai_route_marker, new_end_idx)
if ai_idx == -1:
    print("ERROR: could not find AI route marker")
    exit(1)
print(f"AI route starts at index {ai_idx}")

# The orphaned code is between (new_end_idx + len(new_end_marker)) and ai_idx
orphan_start = new_end_idx + len(new_end_marker)
orphan = content[orphan_start:ai_idx]
print(f"Orphaned code ({len(orphan)} chars):\n{repr(orphan[:300])}")

# Remove the orphaned code
new_content = content[:orphan_start] + content[ai_idx:]
print(f"\nOriginal length: {len(content)}, New length: {len(new_content)}")

# Also find and remove the duplicate POST /goals/evaluate/:id
# The first one ends with res.redirect('/goals');\n}); and is followed by \n\n// 2次承認
# The second one is a duplicate
dup_marker = "\n// 2次承認\n// 二次差し戻し入力フォーム\nrouter.post('/goals/evaluate/:id',"
dup_idx = new_content.find(dup_marker)
if dup_idx == -1:
    print("No duplicate POST evaluate found (may have already been removed)")
else:
    # Find where this duplicate ends
    # It ends before router.get('/goals/reject2/:id',
    next_after_dup = new_content.find("\n// 2次承認\n// 二次差し戻し入力フォーム\nrouter.get('/goals/reject2/", dup_idx)
    if next_after_dup == -1:
        print("ERROR: could not find end of duplicate")
    else:
        dup_block = new_content[dup_idx:next_after_dup]
        print(f"\nDuplicate block ({len(dup_block)} chars):\n{repr(dup_block[:200])}")
        new_content = new_content[:dup_idx] + new_content[next_after_dup:]
        print("Duplicate removed")

open(dst, 'w', encoding='utf-8').write(new_content)
print(f"\nWritten to {dst}")
