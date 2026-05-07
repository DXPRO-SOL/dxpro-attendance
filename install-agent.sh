#!/bin/bash
# NOKORI 遠隔操作エージェント 自動起動インストーラー
# 使い方: bash install-agent.sh <ユーザーID> <サーバーURL>
# 例: bash install-agent.sh 682b506daf1cbc2ca149bd57 https://dxpro-attendance.onrender.com

set -e

USER_ID="$1"
SERVER_URL="${2:-https://dxpro-attendance.onrender.com}"
AGENT_PATH="$(cd "$(dirname "$0")" && pwd)/remote-agent.js"
PLIST_FILE="$HOME/Library/LaunchAgents/com.nokori.remote-agent.plist"

if [ -z "$USER_ID" ]; then
  echo "使い方: bash install-agent.sh <ユーザーID> [サーバーURL]"
  exit 1
fi

# LaunchAgent plist を作成（macOS ログイン時に自動起動）
cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nokori.remote-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>${AGENT_PATH}</string>
        <string>${USER_ID}</string>
        <string>${SERVER_URL}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/nokori-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/nokori-agent-error.log</string>
</dict>
</plist>
EOF

# macOS アクセシビリティ許可の案内
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✔ 自動起動の設定が完了しました"
echo ""
echo "【重要】macOS のアクセシビリティ許可が必要です："
echo "  システム設定 → プライバシーとセキュリティ → アクセシビリティ"
echo "  → ターミナル（またはNode）を追加して許可"
echo ""

# 今すぐ起動
launchctl load "$PLIST_FILE" 2>/dev/null || true
launchctl start com.nokori.remote-agent 2>/dev/null || true

echo "✔ エージェントを起動しました"
echo "  ログ: tail -f /tmp/nokori-agent.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
