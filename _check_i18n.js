#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const langs = ["en", "ko", "vi", "zh"];
const ja = JSON.parse(fs.readFileSync("locales/ja.json", "utf8"));

function getKeys(obj, prefix) {
  prefix = prefix || "";
  let keys = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? prefix + "." + k : k;
    if (typeof obj[k] === "object" && obj[k] !== null) {
      keys = keys.concat(getKeys(obj[k], full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function getVal(obj, keyPath) {
  const parts = keyPath.split(".");
  let v = obj;
  for (const p of parts) {
    if (v == null || typeof v !== "object") return undefined;
    v = v[p];
  }
  return v;
}

function setVal(obj, keyPath, val) {
  const parts = keyPath.split(".");
  let v = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (v[parts[i]] == null) v[parts[i]] = {};
    v = v[parts[i]];
  }
  v[parts[parts.length - 1]] = val;
}

const jaKeys = getKeys(ja);
const jaVals = {};
for (const k of jaKeys) jaVals[k] = getVal(ja, k);

for (const lang of langs) {
  const filePath = "locales/" + lang + ".json";
  const d = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const dKeys = new Set(getKeys(d));
  const missing = jaKeys.filter(function(k) { return !dKeys.has(k); });
  console.log(lang + ": missing " + missing.length + " keys");
  missing.forEach(function(k) { console.log("  " + k); });
}
