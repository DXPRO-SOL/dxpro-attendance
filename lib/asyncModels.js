/**
 * lib/asyncModels.js
 *
 * AsyncLocalStorage を使って、リクエストごとに「使うモデル」を切り替える仕組み。
 * デモユーザーのリクエストでは、専用デモDBのモデルが透過的に使われる。
 * 既存のルートファイルは一切変更不要。
 */
"use strict";

const { AsyncLocalStorage } = require("async_hooks");

// リクエストスコープで有効なモデルマップを保持する
const als = new AsyncLocalStorage();

/**
 * fn() の実行中、AsyncLocalStorage に demoModels を注入する。
 * server.js のミドルウェアから呼ぶ。
 *
 * @param {Object} demoModels  - { ModelName: MongooseModel, ... }
 * @param {Function} fn        - next() など
 */
function runWithDemoModels(demoModels, fn) {
  return als.run(demoModels, fn);
}

/**
 * 現在のコンテキストのデモモデルを取得する。
 * models/index.js の Proxy が内部で使う。
 *
 * @returns {Object|null}
 */
function getContextModels() {
  return als.getStore() || null;
}

module.exports = { runWithDemoModels, getContextModels };
