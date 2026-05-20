// ==============================
// lib/i18n.js - サーバーサイド多言語対応ヘルパー
// ==============================
"use strict";
const fs = require("fs");
const path = require("path");

const SUPPORTED = ["ja", "en", "vi", "ko", "zh"];
const DEFAULT_LANG = "ja";
const LOCALES_DIR = path.join(__dirname, "../locales");

// 辞書キャッシュ（ファイル変更時に自動クリア）
const _cache = {};
const _mtime = {};
// ファイル変更検知でキャッシュを無効化
function invalidateIfChanged(lang) {
  const code = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  const filePath = path.join(LOCALES_DIR, code + ".json");
  try {
    const mtime = fs.statSync(filePath).mtimeMs;
    if (_mtime[code] && _mtime[code] !== mtime) {
      delete _cache[code];
    }
    _mtime[code] = mtime;
  } catch (e) {
    /* ignore */
  }
}

/**
 * 指定言語の辞書を取得（キャッシュ付き）
 * @param {string} lang
 * @returns {object}
 */
function loadDict(lang) {
  const code = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  invalidateIfChanged(code);
  if (_cache[code]) return _cache[code];
  try {
    const filePath = path.join(LOCALES_DIR, code + ".json");
    _cache[code] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    _cache[code] = {};
  }
  return _cache[code];
}

/**
 * キーを翻訳する
 * @param {string} key   ドット区切りキー (例: "notification.leave_approved_subject")
 * @param {string} lang  言語コード
 * @param {object} [vars]  プレースホルダー変数 { name: '田中' }
 * @returns {string}
 */
function t(key, lang, vars) {
  const dict = loadDict(lang);
  const parts = key.split(".");
  let val = dict;
  for (const p of parts) {
    if (val == null || typeof val !== "object") {
      val = null;
      break;
    }
    val = val[p];
  }
  // フォールバック: ja
  if (val == null && lang !== DEFAULT_LANG) {
    return t(key, DEFAULT_LANG, vars);
  }
  let str = typeof val === "string" ? val : key;
  // 変数置換 {{name}} 形式
  if (vars && typeof vars === "object") {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] != null ? vars[k] : "",
    );
  }
  return str;
}

/**
 * セッションまたはデフォルトから言語を取得するミドルウェア
 * req.lang に言語コードをセット
 */
function langMiddleware(req, res, next) {
  const lang = req.session && req.session.lang;
  req.lang = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  next();
}

module.exports = { t, loadDict, langMiddleware, SUPPORTED, DEFAULT_LANG };
