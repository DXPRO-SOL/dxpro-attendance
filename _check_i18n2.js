#!/usr/bin/env node
"use strict";
const fs = require("fs");
const langs = ["en","ko","vi","zh"];
function getVal(obj, keyPath) {
  const parts = keyPath.split(".");
  let v = obj;
  for (const p of parts) {
    if (v == null || typeof v !== "object") return undefined;
    v = v[p];
  }
  return v;
}
const keys = [
  "hr.add_employee_title","hr.edit_employee_title","hr.stats_title","hr.payroll_title",
  "board.title","overtime.title","admin_page.title","rules.title","chat_page.stamp_management",
  "audit_log.title","audit_log.filter_search"
];
for (const l of langs) {
  const d = JSON.parse(fs.readFileSync("locales/"+l+".json","utf8"));
  const miss = keys.filter(function(k) { return getVal(d,k) == null; });
  console.log(l+" missing: " + (miss.join(", ") || "none"));
}
