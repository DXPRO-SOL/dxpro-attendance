#!/usr/bin/env python3
# /pretest ルートを /pretest/common へリダイレクトに置き換える

path = '/Users/user/dxpro-attendance/dxpro-attendance/routes/pretest.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 開始マーカー
start_marker = "router.get('/pretest', (req, res) => {"
# 終了マーカー（このハンドラの最後の行）
end_marker = "<script src=\"/pretest-ui.js\"></script>\n    `);\n});"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("ERROR: start_marker not found")
    exit(1)
if end_idx == -1:
    print("ERROR: end_marker not found")
    exit(1)

end_idx += len(end_marker)

new_handler = """router.get('/pretest', (req, res) => {
    // 共通テスト（IT基礎）に統合 → /pretest/common にリダイレクト
    return res.redirect('/pretest/common');
});"""

new_content = content[:start_idx] + new_handler + content[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Done.")
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
print(f"Total lines: {len(lines)}")
