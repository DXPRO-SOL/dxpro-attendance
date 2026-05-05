#!/bin/zsh
# サーバー再起動スクリプト
# 使い方: ./restart.sh

echo "🔄 ポート 10000 を解放中..."
lsof -ti :10000 | xargs kill -9 2>/dev/null
sleep 1

echo "🚀 サーバーを起動中..."
node server.js
