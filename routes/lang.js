// ==============================
// routes/lang.js - 言語設定API
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { User } = require("../models");
const { requireLogin } = require("../middleware/auth");

const SUPPORTED = ["ja", "en", "vi", "ko", "zh"];

// セッション＋DBにユーザー言語を保存するAPI
router.post("/api/lang", async (req, res) => {
  const { lang } = req.body;
  if (!SUPPORTED.includes(lang))
    return res.status(400).json({ error: "Unsupported language" });
  req.session.lang = lang;
  // ログイン中ならDBにも保存
  if (req.session.userId) {
    try {
      await User.findByIdAndUpdate(req.session.userId, { preferredLang: lang });
    } catch (e) {
      console.warn("[lang] DB保存エラー:", e.message);
    }
  }
  res.json({ ok: true, lang });
});

// 現在の言語を返すAPI
router.get("/api/lang", (req, res) => {
  res.json({ lang: req.session.lang || "ja" });
});

// 言語辞書JSONを返すAPI（クライアントから最新辞書を取得したい場合用）
router.get("/api/lang/:code.json", (req, res) => {
  const code = req.params.code;
  if (!SUPPORTED.includes(code))
    return res.status(404).json({ error: "Not found" });
  const filePath = path.join(__dirname, "../locales", code + ".json");
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(filePath);
});

module.exports = router;
