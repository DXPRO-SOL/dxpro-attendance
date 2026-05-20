// ==============================
// routes/skillsheet.js — スキルシート管理
// ==============================
const router = require("express").Router();
const ExcelJS = require("exceljs");
const { requireLogin } = require("../middleware/auth");
const { Employee, SkillSheet } = require("../models");
const { renderPage } = require("../lib/renderPage");
const { t } = require("../lib/i18n");

// ─── 共通ヘルパー ────────────────────────────────
const LEVEL_LABELS = ["", "★", "★★", "★★★", "★★★★", "★★★★★"];
const SKILL_CATS = [
  { key: "languages", label: "プログラミング言語" },
  { key: "frameworks", label: "FW / ライブラリ" },
  { key: "databases", label: "データベース" },
  { key: "infra", label: "インフラ / クラウド" },
  { key: "tools", label: "ツール" },
];
const TASK_LABELS = [
  { key: "requirement", label: "要件定義" },
  { key: "basicDesign", label: "基本設計" },
  { key: "detailDesign", label: "詳細設計" },
  { key: "development", label: "開発・実装" },
  { key: "testing", label: "テスト" },
  { key: "operation", label: "運用・保守" },
  { key: "management", label: "PM / リーダー" },
];

async function getOrCreate(employeeId, userId) {
  let sheet = await SkillSheet.findOne({ employeeId });
  if (!sheet) {
    sheet = await SkillSheet.create({
      employeeId,
      userId,
      skills: {
        languages: [],
        frameworks: [],
        databases: [],
        infra: [],
        tools: [],
      },
      certifications: [],
      projects: [],
    });
  }
  return sheet;
}

// ─── GET /skillsheet ─────────────────────────────
router.get("/skillsheet", requireLogin, async (req, res) => {
  try {
    // 管理者 → 従業員一覧を表示
    if (req.session.isAdmin) {
      const employees = await Employee.find().sort({ employeeId: 1 });
      // 各従業員のスキルシート有無を確認
      const sheets = await SkillSheet.find({}, { employeeId: 1 });
      const sheetSet = new Set(sheets.map((s) => String(s.employeeId)));
      const lang = req.lang || req.session?.lang || "ja";
      const html = buildAdminListPage(employees, sheetSet, lang);
      return renderPage(req, res, "スキルシート管理", "スキルシート管理", html);
    }

    // 一般ユーザー → 自分のシートを表示
    const emp = await Employee.findOne({ userId: req.session.userId });
    if (!emp) return res.redirect("/dashboard");

    const sheet = await getOrCreate(emp._id, req.session.userId);
    const lang = req.lang || req.session?.lang || "ja";
    const html = buildEditPage(emp, sheet, req, false, lang);
    renderPage(req, res, "スキルシート", "スキルシート管理", html);
  } catch (e) {
    console.error(e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── GET /skillsheet/admin/:employeeId ───────────
router.get("/skillsheet/admin/:employeeId", requireLogin, async (req, res) => {
  try {
    if (!req.session.isAdmin) return res.status(403).send("権限がありません");
    const emp = await Employee.findById(req.params.employeeId);
    if (!emp) return res.redirect("/skillsheet");
    const sheet = await getOrCreate(emp._id, emp.userId);
    const lang = req.lang || req.session?.lang || "ja";
    const html = buildEditPage(emp, sheet, req, true, lang);
    renderPage(
      req,
      res,
      t("skillsheet.edit_title", lang),
      t("skillsheet.admin_title", lang),
      html,
    );
  } catch (e) {
    console.error(e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /skillsheet/admin/:employeeId/save ─────
router.post(
  "/skillsheet/admin/:employeeId/save",
  requireLogin,
  async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).send("権限がありません");
      const emp = await Employee.findById(req.params.employeeId);
      if (!emp) return res.redirect("/skillsheet");
      await saveSheetFromBody(req.body, emp);
      res.redirect(`/skillsheet/admin/${emp._id}?saved=1`);
    } catch (e) {
      console.error(e);
      res.redirect(`/skillsheet/admin/${req.params.employeeId}?error=1`);
    }
  },
);

// ─── GET /skillsheet/admin/:employeeId/export ────
router.get(
  "/skillsheet/admin/:employeeId/export",
  requireLogin,
  async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).send("権限がありません");
      const emp = await Employee.findById(req.params.employeeId);
      if (!emp) return res.redirect("/skillsheet");
      const sheet = await SkillSheet.findOne({ employeeId: emp._id });
      if (!sheet) return res.redirect(`/skillsheet/admin/${emp._id}`);
      await exportExcel(res, emp, sheet);
    } catch (e) {
      console.error(e);
      res.status(500).send("Excel出力中にエラーが発生しました");
    }
  },
);

// ─── POST /skillsheet/save ───────────────────────
router.post("/skillsheet/save", requireLogin, async (req, res) => {
  try {
    const emp = await Employee.findOne({ userId: req.session.userId });
    if (!emp) return res.redirect("/dashboard");
    await saveSheetFromBody(req.body, emp);
    res.redirect("/skillsheet?saved=1");
  } catch (e) {
    console.error(e);
    res.redirect("/skillsheet?error=1");
  }
});

// ─── GET /skillsheet/export ─────────────────────
router.get("/skillsheet/export", requireLogin, async (req, res) => {
  try {
    const emp = await Employee.findOne({ userId: req.session.userId });
    if (!emp) return res.redirect("/dashboard");
    const sheet = await SkillSheet.findOne({ employeeId: emp._id });
    if (!sheet) return res.redirect("/skillsheet");
    await exportExcel(res, emp, sheet);
  } catch (e) {
    console.error(e);
    res.status(500).send("Excel出力中にエラーが発生しました");
  }
});

// ─── 共通：シート保存 ────────────────────────────
async function saveSheetFromBody(b, emp) {
  const parseSkills = (nameArr, levelArr) => {
    const names = [].concat(nameArr || []);
    const levels = [].concat(levelArr || []);
    return names
      .map((n, i) => ({ name: n.trim(), level: parseInt(levels[i] || 0) }))
      .filter((s) => s.name);
  };

  const certNames = [].concat(b.certName || []);
  const certDates = [].concat(b.certDate || []);
  const certifications = certNames
    .map((n, i) => ({ name: n.trim(), acquiredDate: certDates[i] || "" }))
    .filter((c) => c.name);

  const pFrom = [].concat(b.pFrom || []);
  const pTo = [].concat(b.pTo || []);
  const pName = [].concat(b.pName || []);
  const pClient = [].concat(b.pClient || []);
  const pIndust = [].concat(b.pIndust || []);
  const pTeam = [].concat(b.pTeam || []);
  const pRole = [].concat(b.pRole || []);
  const pDesc = [].concat(b.pDesc || []);
  const pTech = [].concat(b.pTech || []);

  const projects = pFrom
    .map((_, i) => {
      const tasks = {};
      TASK_LABELS.forEach((t) => {
        const val = [].concat(b[`pTask_${t.key}`] || []);
        tasks[t.key] = val[i] === "on";
      });
      return {
        periodFrom: pFrom[i] || "",
        periodTo: pTo[i] || "",
        projectName: pName[i] || "",
        client: pClient[i] || "",
        industry: pIndust[i] || "",
        team: parseInt(pTeam[i]) || 0,
        role: pRole[i] || "",
        description: pDesc[i] || "",
        techStack: pTech[i] || "",
        tasks,
      };
    })
    .filter((p) => p.projectName);

  await SkillSheet.findOneAndUpdate(
    { employeeId: emp._id },
    {
      userId: emp.userId,
      nameKana: b.nameKana || "",
      birthDate: b.birthDate || "",
      gender: b.gender || "",
      nearestStation: b.nearestStation || "",
      experience: parseInt(b.experience) || 0,
      selfPR: b.selfPR || "",
      certifications,
      skills: {
        languages: parseSkills(b.skillLangName, b.skillLangLevel),
        frameworks: parseSkills(b.skillFwName, b.skillFwLevel),
        databases: parseSkills(b.skillDbName, b.skillDbLevel),
        infra: parseSkills(b.skillInfraName, b.skillInfraLevel),
        tools: parseSkills(b.skillToolName, b.skillToolLevel),
      },
      projects,
    },
    { upsert: true, new: true },
  );
}

// ─── 共通：Excel出力 ─────────────────────────────
async function exportExcel(res, emp, sheet) {
  // ── Workbook / Worksheet 初期化 ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "DXPro Attendance";
  wb.created = new Date();
  const ws = wb.addWorksheet("スキルシート", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
    },
    views: [{ showGridLines: false }],
  });

  // ── 列幅設定 ──
  ws.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  // ── スタイル定義 ──
  const hFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  const sh1Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  const sh2Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF3B82F6" },
  };
  const sh3Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0EAFF" },
  };
  const altFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF8FAFC" },
  };
  const whtFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFFFF" },
  };
  const thin = { style: "thin", color: { argb: "FFD1D5DB" } };
  const med = { style: "medium", color: { argb: "FF94A3B8" } };
  const bold = { style: "medium", color: { argb: "FF1E3A5F" } };
  const brd = (b) => ({ top: b, bottom: b, left: b, right: b });
  const whtTxt = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const navTxt = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  const bodyTxt = { color: { argb: "FF1E293B" }, size: 10 };
  const center = { horizontal: "center", vertical: "middle", wrapText: true };
  const left = { horizontal: "left", vertical: "middle", wrapText: true };

  const cell = (r, c, v, font, align, fill, border) => {
    const cl = ws.getCell(r, c);
    cl.value = v;
    if (font) cl.font = font;
    if (align) cl.alignment = align;
    if (fill) cl.fill = fill;
    if (border) cl.border = border;
    return cl;
  };
  const merge = (r1, c1, r2, c2) => ws.mergeCells(r1, c1, r2, c2);

  let row = 1;

  // ═══════════════════════════════════════
  // タイトルバー
  // ═══════════════════════════════════════
  ws.getRow(row).height = 36;
  merge(row, 1, row, 12);
  cell(
    row,
    1,
    "スキルシート",
    { bold: true, color: { argb: "FFFFFFFF" }, size: 16 },
    center,
    hFill,
    brd(bold),
  );
  row++;

  // ═══════════════════════════════════════
  // 基本情報
  // ═══════════════════════════════════════
  ws.getRow(row).height = 22;
  merge(row, 1, row, 12);
  cell(row, 1, "■ 基本情報", navTxt, left, sh1Fill, brd(bold));
  row++;

  const info = [
    ["氏名", emp.name, "氏名（カナ）", sheet.nameKana],
    ["部署", emp.department, "職位", emp.position],
    ["生年月日", sheet.birthDate || "", "性別", sheet.gender || ""],
    [
      "最寄り駅",
      sheet.nearestStation || "",
      "IT経験年数",
      (sheet.experience || 0) + "年",
    ],
  ];
  info.forEach(([l1, v1, l2, v2]) => {
    ws.getRow(row).height = 20;
    merge(row, 1, row, 2);
    cell(
      row,
      1,
      l1,
      { bold: true, color: { argb: "FF475569" }, size: 10 },
      center,
      sh3Fill,
      brd(thin),
    );
    merge(row, 3, row, 6);
    cell(row, 3, v1, bodyTxt, left, whtFill, brd(thin));
    merge(row, 7, row, 8);
    cell(
      row,
      7,
      l2,
      { bold: true, color: { argb: "FF475569" }, size: 10 },
      center,
      sh3Fill,
      brd(thin),
    );
    merge(row, 9, row, 12);
    cell(row, 9, v2, bodyTxt, left, whtFill, brd(thin));
    row++;
  });

  // ═══════════════════════════════════════
  // 資格・免許
  // ═══════════════════════════════════════
  ws.getRow(row).height = 22;
  merge(row, 1, row, 12);
  cell(row, 1, "■ 資格・免許", navTxt, left, sh1Fill, brd(bold));
  row++;

  if (sheet.certifications && sheet.certifications.length > 0) {
    ws.getRow(row).height = 18;
    merge(row, 1, row, 6);
    cell(
      row,
      1,
      "資格名",
      { bold: true, color: { argb: "FF475569" }, size: 10 },
      center,
      sh3Fill,
      brd(thin),
    );
    merge(row, 7, row, 12);
    cell(
      row,
      7,
      "取得年月",
      { bold: true, color: { argb: "FF475569" }, size: 10 },
      center,
      sh3Fill,
      brd(thin),
    );
    row++;
    sheet.certifications.forEach((c, i) => {
      ws.getRow(row).height = 18;
      merge(row, 1, row, 6);
      cell(
        row,
        1,
        c.name || "",
        bodyTxt,
        left,
        i % 2 ? altFill : whtFill,
        brd(thin),
      );
      merge(row, 7, row, 12);
      cell(
        row,
        7,
        c.acquiredDate || "",
        bodyTxt,
        center,
        i % 2 ? altFill : whtFill,
        brd(thin),
      );
      row++;
    });
  } else {
    ws.getRow(row).height = 18;
    merge(row, 1, row, 12);
    cell(
      row,
      1,
      "（なし）",
      { color: { argb: "FF94A3B8" }, size: 10 },
      center,
      whtFill,
      brd(thin),
    );
    row++;
  }

  // ═══════════════════════════════════════
  // スキルマップ
  // ═══════════════════════════════════════
  ws.getRow(row).height = 22;
  merge(row, 1, row, 12);
  cell(row, 1, "■ スキルマップ", navTxt, left, sh1Fill, brd(bold));
  row++;

  SKILL_CATS.forEach((cat) => {
    const items = (sheet.skills && sheet.skills[cat.key]) || [];
    if (items.length === 0) return;

    ws.getRow(row).height = 18;
    merge(row, 1, row, 12);
    cell(
      row,
      1,
      cat.label,
      { bold: true, color: { argb: "FF1E3A5F" }, size: 10 },
      left,
      sh2Fill,
      brd(thin),
    );
    row++;

    // ヘッダ行
    ws.getRow(row).height = 16;
    merge(row, 1, row, 6);
    cell(
      row,
      1,
      "名称",
      { bold: true, color: { argb: "FF475569" }, size: 9 },
      center,
      sh3Fill,
      brd(thin),
    );
    merge(row, 7, row, 12);
    cell(
      row,
      7,
      "レベル（★1〜5）",
      { bold: true, color: { argb: "FF475569" }, size: 9 },
      center,
      sh3Fill,
      brd(thin),
    );
    row++;

    items.forEach((sk, i) => {
      ws.getRow(row).height = 17;
      merge(row, 1, row, 6);
      cell(
        row,
        1,
        sk.name || "",
        bodyTxt,
        left,
        i % 2 ? altFill : whtFill,
        brd(thin),
      );
      merge(row, 7, row, 12);
      cell(
        row,
        7,
        LEVEL_LABELS[sk.level] || "",
        { size: 12, color: { argb: "FFD97706" } },
        center,
        i % 2 ? altFill : whtFill,
        brd(thin),
      );
      row++;
    });
  });

  // ═══════════════════════════════════════
  // 自己PR
  // ═══════════════════════════════════════
  ws.getRow(row).height = 22;
  merge(row, 1, row, 12);
  cell(row, 1, "■ 自己PR・強み", navTxt, left, sh1Fill, brd(bold));
  row++;

  ws.getRow(row).height = 60;
  merge(row, 1, row, 12);
  cell(row, 1, sheet.selfPR || "", bodyTxt, left, whtFill, brd(thin));
  row++;

  // ═══════════════════════════════════════
  // 職務経歴
  // ═══════════════════════════════════════
  ws.getRow(row).height = 22;
  merge(row, 1, row, 12);
  cell(row, 1, "■ 職務経歴", navTxt, left, sh1Fill, brd(bold));
  row++;

  if (!sheet.projects || sheet.projects.length === 0) {
    merge(row, 1, row, 12);
    cell(
      row,
      1,
      "（なし）",
      { color: { argb: "FF94A3B8" }, size: 10 },
      center,
      whtFill,
      brd(thin),
    );
    row++;
  } else {
    sheet.projects.forEach((p, idx) => {
      // プロジェクトヘッダ
      ws.getRow(row).height = 20;
      merge(row, 1, row, 12);
      cell(
        row,
        1,
        `No.${idx + 1}　${p.projectName || ""}`,
        { bold: true, color: { argb: "FFFFFFFF" }, size: 10 },
        left,
        sh2Fill,
        brd(med),
      );
      row++;

      // 期間・クライアント・チーム規模
      ws.getRow(row).height = 18;
      ["期間", "顧客・業界", "チーム規模", "役割"].forEach((lbl, ci) => {
        cell(
          row,
          ci * 3 + 1,
          lbl,
          { bold: true, color: { argb: "FF475569" }, size: 9 },
          center,
          sh3Fill,
          brd(thin),
        );
        if (ci < 3) merge(row, ci * 3 + 1, row, ci * 3 + 1);
      });
      row++;

      ws.getRow(row).height = 18;
      const period = `${p.periodFrom || ""} 〜 ${p.periodTo || ""}`;
      const client = `${p.client || ""} ／ ${p.industry || ""}`;
      const team = p.team ? `${p.team}名` : "-";
      [period, client, team, p.role || ""].forEach((v, ci) => {
        merge(row, ci * 3 + 1, row, ci * 3 + 3);
        cell(row, ci * 3 + 1, v, bodyTxt, center, whtFill, brd(thin));
      });
      row++;

      // 担当工程
      ws.getRow(row).height = 18;
      merge(row, 1, row, 1);
      cell(
        row,
        1,
        "担当工程",
        { bold: true, color: { argb: "FF475569" }, size: 9 },
        center,
        sh3Fill,
        brd(thin),
      );
      TASK_LABELS.forEach((t, ci) => {
        cell(
          row,
          ci + 2,
          t.label,
          { size: 8, color: { argb: "FF475569" }, bold: true },
          center,
          sh3Fill,
          brd(thin),
        );
      });
      row++;

      ws.getRow(row).height = 18;
      merge(row, 1, row, 1);
      cell(row, 1, "", bodyTxt, center, whtFill, brd(thin));
      TASK_LABELS.forEach((t, ci) => {
        const checked = p.tasks && p.tasks[t.key];
        cell(
          row,
          ci + 2,
          checked ? "✓" : "",
          {
            size: 12,
            color: { argb: checked ? "FF2563EB" : "FFCBD5E1" },
            bold: checked,
          },
          center,
          checked
            ? {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFDBEAFE" },
              }
            : whtFill,
          brd(thin),
        );
      });
      row++;

      // 案件概要
      ws.getRow(row).height = 18;
      merge(row, 1, row, 12);
      cell(
        row,
        1,
        "案件概要",
        { bold: true, color: { argb: "FF475569" }, size: 9 },
        left,
        sh3Fill,
        brd(thin),
      );
      row++;
      ws.getRow(row).height = 50;
      merge(row, 1, row, 12);
      cell(row, 1, p.description || "", bodyTxt, left, whtFill, brd(thin));
      row++;

      // 使用技術
      ws.getRow(row).height = 18;
      merge(row, 1, row, 12);
      cell(
        row,
        1,
        "使用技術・環境",
        { bold: true, color: { argb: "FF475569" }, size: 9 },
        left,
        sh3Fill,
        brd(thin),
      );
      row++;
      ws.getRow(row).height = 30;
      merge(row, 1, row, 12);
      cell(row, 1, p.techStack || "", bodyTxt, left, whtFill, brd(thin));
      row++;

      // プロジェクト間スペース
      ws.getRow(row).height = 6;
      row++;
    });
  }

  // ── ダウンロード ──
  const filename = encodeURIComponent(`スキルシート_${emp.name}.xlsx`);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${filename}`,
  );
  await wb.xlsx.write(res);
  res.end();
}

// ─── 管理者：従業員一覧ページ ─────────────────────
function buildAdminListPage(employees, sheetSet, lang = "ja") {
  const rows = employees
    .map((emp) => {
      const hasSheet = sheetSet.has(String(emp._id));
      return `
        <tr>
            <td class="ss-adm-td ss-adm-id">${emp.employeeId}</td>
            <td class="ss-adm-td ss-adm-name">${emp.name}</td>
            <td class="ss-adm-td ss-adm-dept">${emp.department || "—"}</td>
            <td class="ss-adm-td ss-adm-pos">${emp.position || "—"}</td>
            <td class="ss-adm-td ss-adm-status">
                ${
                  hasSheet
                    ? `<span class="ss-badge ss-badge-ok">✅ ${t("skillsheet.status_created", lang)}</span>`
                    : `<span class="ss-badge ss-badge-none">${t("skillsheet.status_not_created", lang)}</span>`
                }
            </td>
            <td class="ss-adm-td ss-adm-action">
                <div style="display:flex;gap:6px;justify-content:center">
                    <a href="/skillsheet/admin/${emp._id}" class="ss-adm-btn ss-adm-btn-edit">
                        <i class="fa-solid fa-pen-to-square"></i> ${t("common.edit", lang)}
                    </a>
                    ${
                      hasSheet
                        ? `
                    <a href="/skillsheet/admin/${emp._id}/export" class="ss-adm-btn ss-adm-btn-export">
                        <i class="fa-solid fa-file-excel"></i> Excel
                    </a>`
                        : ""
                    }
                </div>
            </td>
        </tr>`;
    })
    .join("");

  return `
<style>
.ss-adm-page{max-width:1100px;margin:0 auto}
.ss-adm-header{margin-bottom:22px}
.ss-adm-title{font-size:20px;font-weight:800;color:#0b2540;margin:0 0 4px}
.ss-adm-sub{font-size:13px;color:#6b7280;margin:0}
.ss-adm-wrap{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(11,36,48,.06);overflow:hidden}
.ss-adm-table{width:100%;border-collapse:collapse}
.ss-adm-table thead th{padding:11px 16px;background:#1e3a5f;color:#fff;font-weight:700;font-size:12px;text-align:left;white-space:nowrap}
.ss-adm-table thead th:last-child{text-align:center}
.ss-adm-table tbody tr{border-bottom:1px solid #f1f5f9;transition:background .12s}
.ss-adm-table tbody tr:last-child{border-bottom:none}
.ss-adm-table tbody tr:hover{background:#f8faff}
.ss-adm-td{padding:11px 16px;font-size:13px;vertical-align:middle}
.ss-adm-id{font-family:monospace;font-size:12px;color:#6b7280}
.ss-adm-name{font-weight:700;color:#0b2540}
.ss-adm-dept,.ss-adm-pos{color:#4b5563}
.ss-adm-status{text-align:center}
.ss-adm-action{text-align:center;white-space:nowrap;width:1%}
.ss-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
.ss-badge-ok{background:#dcfce7;color:#166534}
.ss-badge-none{background:#f1f5f9;color:#94a3b8}
.ss-adm-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 13px;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;transition:opacity .15s}
.ss-adm-btn:hover{opacity:.82}
.ss-adm-btn-edit{background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe}
.ss-adm-btn-export{background:#f0fdf4;color:#16a34a;border:1px solid #86efac}
@media(max-width:640px){
  .ss-adm-page{padding:0 8px}
  .tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px}
  .ss-adm-table{min-width:560px}
}
</style>

<div class="ss-adm-page">
    <div class="ss-adm-header">
        <div class="ss-adm-title">📋 ${t("skillsheet.admin_title", lang)}</div>
        <div class="ss-adm-sub">${t("skillsheet.admin_subtitle", lang, { n: employees.length })}</div>
    </div>
    <div class="ss-adm-wrap tbl-scroll">
        <table class="ss-adm-table">
            <thead>
                <tr>
                    <th>${t("skillsheet.col_emp_id", lang)}</th>
                    <th>${t("skillsheet.col_name", lang)}</th>
                    <th>${t("skillsheet.col_dept", lang)}</th>
                    <th>${t("skillsheet.col_position", lang)}</th>
                    <th style="text-align:center">${t("skillsheet.col_status", lang)}</th>
                    <th style="text-align:center">${t("skillsheet.col_action", lang)}</th>
                </tr>
            </thead>
            <tbody>
                ${rows || `<tr><td colspan="6" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">${t("skillsheet.no_employees", lang)}</td></tr>`}
            </tbody>
        </table>
    </div>
</div>`;
}

// ─── ページHTML構築 ──────────────────────────────
function buildEditPage(emp, sheet, req, isAdminView = false, lang = "ja") {
  const saved = req && req.query && req.query.saved;
  const saveAction = isAdminView
    ? `/skillsheet/admin/${emp._id}/save`
    : "/skillsheet/save";
  const exportHref = isAdminView
    ? `/skillsheet/admin/${emp._id}/export`
    : "/skillsheet/export";
  const backHref = isAdminView ? "/skillsheet" : null;
  const skills = sheet.skills || {};

  // スキルカテゴリのレンダー
  const renderSkillCat = (catKey, inputNameBase, items) => {
    const rows = [...(items || []), { name: "", level: 0 }]; // 末尾に空行を1つ
    return rows
      .map(
        (sk, i) => `
        <tr class="skill-row">
            <td><input type="text" name="${inputNameBase}Name" value="${sk.name || ""}"
                placeholder="例: JavaScript" class="ss-input"></td>
            <td style="width:160px;">
                <select name="${inputNameBase}Level" class="ss-select">
                    ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${sk.level === n ? "selected" : ""}>${n === 0 ? "—" : LEVEL_LABELS[n]}</option>`).join("")}
                </select>
            </td>
            <td style="width:36px;">
                ${i < rows.length - 1 ? `<button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button>` : ""}
            </td>
        </tr>`,
      )
      .join("");
  };

  // プロジェクト行のレンダー
  const renderProject = (p, idx) => `
    <div class="ss-proj-card" data-idx="${idx}">
        <div class="ss-proj-header">
            <span class="ss-proj-num">${t("skillsheet.project_num", lang)} ${idx + 1}</span>
            <button type="button" class="ss-del-proj" onclick="delProj(this)">${t("common.delete", lang)}</button>
        </div>
        <div class="ss-grid4">
            <div>
                <label class="ss-label">${t("skillsheet.proj_from", lang)}</label>
                <input type="month" name="pFrom" value="${p.periodFrom || ""}" class="ss-input">
            </div>
            <div>
                <label class="ss-label">${t("skillsheet.proj_to", lang)}</label>
                <div style="display:flex;align-items:flex-start;gap:6px;">
                  <input type="month" name="pTo" value="${p.periodTo && p.periodTo !== "現在" ? p.periodTo : ""}" class="ss-input" style="flex:1;">
                  <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;cursor:pointer;padding-top:9px;">
                      <input type="checkbox" onchange="setCurrentProj(this)" ${p.periodTo === "現在" ? "checked" : ""} style="margin:0;cursor:pointer;"> ${t("skillsheet.proj_current", lang)}
                  </label>
                </div>
            </div>
            <div style="grid-column:3/5;">
                <label class="ss-label">${t("skillsheet.proj_name", lang)}</label>
                <input type="text" name="pName" value="${p.projectName || ""}" placeholder="${t("skillsheet.proj_name", lang)}" class="ss-input">
            </div>
            <div>
                <label class="ss-label">${t("skillsheet.proj_client", lang)}</label>
                <input type="text" name="pClient" value="${p.client || ""}" placeholder="${t("skillsheet.proj_client", lang)}" class="ss-input">
            </div>
            <div>
                <label class="ss-label">${t("skillsheet.proj_industry", lang)}</label>
                <input type="text" name="pIndust" value="${p.industry || ""}" placeholder="IT / 金融 等" class="ss-input">
            </div>
            <div>
                <label class="ss-label">${t("skillsheet.proj_team", lang)}</label>
                <input type="number" name="pTeam" value="${p.team || ""}" placeholder="${t("skillsheet.proj_team_placeholder", lang)}" class="ss-input" min="1">
            </div>
            <div>
                <label class="ss-label">${t("skillsheet.proj_role", lang)}</label>
                <input type="text" name="pRole" value="${p.role || ""}" placeholder="PL / 開発 等" class="ss-input">
            </div>
        </div>
        <div style="margin-top:12px;">
            <label class="ss-label">${t("skillsheet.proj_tasks", lang)}</label>
            <div class="ss-tasks">
                ${TASK_LABELS.map(
                  (tl) => `
                <label class="ss-task-chk">
                    <span>${t("skillsheet.task_" + tl.key, lang)}</span><input type="checkbox" name="pTask_${tl.key}" ${p.tasks && p.tasks[tl.key] ? "checked" : ""}>
                </label>`,
                ).join("")}
            </div>
        </div>
        <div style="margin-top:12px;">
            <label class="ss-label">${t("skillsheet.proj_desc", lang)}</label>
            <textarea name="pDesc" rows="3" class="ss-textarea" placeholder="${t("skillsheet.proj_desc_placeholder", lang)}">${p.description || ""}</textarea>
        </div>
        <div style="margin-top:10px;">
            <label class="ss-label">${t("skillsheet.proj_tech", lang)}</label>
            <textarea name="pTech" rows="2" class="ss-textarea" placeholder="Java, Spring Boot, MySQL, AWS 等">${p.techStack || ""}</textarea>
        </div>
    </div>`;

  const certs = [
    ...(sheet.certifications || []),
    { name: "", acquiredDate: "" },
  ];

  return `
<style>
.ss-card   { background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px 28px;margin-bottom:20px; }
.ss-sec    { font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e0eaff;display:flex;align-items:center;gap:8px; }
.ss-sec i  { color:#3b82f6; }
.ss-label  { display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px; }
.ss-input  { width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none;transition:border .15s;max-width:100%; }
.ss-input:focus  { border-color:#3b82f6; }
.ss-select { width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;outline:none;box-sizing:border-box;max-width:100%; }
.ss-textarea { width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;outline:none;transition:border .15s;max-width:100%; }
.ss-textarea:focus { border-color:#3b82f6; }
.ss-grid2  { display:grid;grid-template-columns:1fr 1fr;gap:14px 20px; }
.ss-grid3  { display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 20px; }
.ss-grid4  { display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px 20px;align-items:start; }
.ss-skill-table { width:100%;border-collapse:collapse; }
.ss-skill-table th { background:#f8fafc;padding:7px 10px;font-size:11.5px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:left; }
.ss-skill-table td { padding:5px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle; }
.ss-add-btn { background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:6px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s; }
.ss-add-btn:hover { background:#dbeafe; }
.ss-del-btn { background:#fef2f2;color:#ef4444;border:1px solid #fecaca;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer; }
.ss-proj-card { border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:14px;background:#fdfdff; }
.ss-proj-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:14px; }
.ss-proj-num { font-size:13px;font-weight:700;color:#1e3a5f; }
.ss-del-proj { background:#fef2f2;color:#ef4444;border:1px solid #fecaca;border-radius:5px;padding:4px 12px;font-size:12px;cursor:pointer; }
.ss-tasks { display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:6px; }
.ss-task-chk { display:inline-flex !important;flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:5px;font-size:12.5px;color:#374151;cursor:pointer;line-height:1.4;margin-bottom:0;white-space:nowrap;writing-mode:horizontal-tb !important; }
.ss-task-chk input[type="checkbox"] { display:inline-block !important;width:auto !important;flex-shrink:0;margin:0;cursor:pointer; }
.ss-task-chk span, .ss-task-chk > *:not(input) { white-space:nowrap;writing-mode:horizontal-tb; }
.ss-save-bar { position:sticky;bottom:0;background:#fff;border-top:1px solid #e2e8f0;padding:14px 0;margin-top:10px;display:flex;gap:12px;z-index:10; }
.ss-page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:12px}
.ss-page-header-left{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ss-page-title{font-size:20px;font-weight:800;color:#0b2540;margin:0}
.ss-page-meta{font-size:13px;color:#6b7280;margin:0;display:flex;gap:12px;flex-wrap:wrap}
.ss-page-meta span{display:inline-flex;align-items:center;gap:5px}
.ss-back-btn{display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none;transition:background .12s}
.ss-back-btn:hover{background:#e2e8f0}
.ss-export-btn{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(90deg,#16a34a,#22c55e);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:13.5px;font-weight:600;text-decoration:none;box-shadow:0 2px 6px rgba(22,163,74,.25);transition:opacity .15s}
.ss-export-btn:hover{opacity:.88}
.ss-alert-ok{background:#f0fdf4;border:1px solid #86efac;border-radius:9px;padding:11px 16px;margin-bottom:16px;display:flex;align-items:center;gap:9px;color:#166534;font-size:13.5px}
@media(max-width:640px){
  .ss-card{padding:14px 12px}
  .ss-grid2,.ss-grid3,.ss-grid4{grid-template-columns:1fr}
  .ss-proj-card{padding:12px 10px}
  .ss-save-bar{flex-direction:column;gap:8px}
  .ss-save-bar button,.ss-save-bar a{width:100%;text-align:center;box-sizing:border-box}
  .ss-page-header{flex-direction:column;align-items:flex-start}
  .ss-skill-table{min-width:420px}
  .ss-skill-tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .ss-form-wrap{padding:0 4px;box-sizing:border-box}
}
</style>

<div class="ss-form-wrap">
<div class="ss-page-header">
    <div class="ss-page-header-left">
        ${backHref ? `<a href="${backHref}" class="ss-back-btn"><i class="fa-solid fa-arrow-left"></i> 一覧に戻る</a>` : ""}
        <div>
            <p class="ss-page-title">📄 ${t("skillsheet.edit_title", lang)}</p>
            <p class="ss-page-meta">
                <span><i class="fa-solid fa-user" style="color:#3b82f6"></i><strong>${emp.name}</strong></span>
                <span><i class="fa-solid fa-building" style="color:#6b7280"></i>${emp.department || "—"}</span>
                <span><i class="fa-solid fa-briefcase" style="color:#6b7280"></i>${emp.position || "—"}</span>
            </p>
        </div>
    </div>
    <a href="${exportHref}" class="ss-export-btn">
        <i class="fa-solid fa-file-excel"></i> ${t("skillsheet.export_excel", lang)}
    </a>
</div>

${saved ? `<div class="ss-alert-ok"><i class="fa-solid fa-circle-check"></i> ${t("skillsheet.saved_ok", lang)}</div>` : ""}

<form method="POST" action="${saveAction}" id="ssForm">

<!-- 基本情報 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-id-card"></i>${t("skillsheet.basic_info", lang)}</div>
    <div class="ss-grid3" style="margin-bottom:14px;">
        <div>
            <label class="ss-label">${t("skillsheet.field_name_kana", lang)}</label>
            <input type="text" name="nameKana" value="${sheet.nameKana || ""}" placeholder="ヤマダ タロウ" class="ss-input">
        </div>
        <div>
            <label class="ss-label">${t("skillsheet.field_birth_date", lang)}</label>
            <input type="date" name="birthDate" value="${sheet.birthDate || ""}" class="ss-input">
        </div>
        <div>
            <label class="ss-label">${t("skillsheet.field_gender", lang)}</label>
            <select name="gender" class="ss-select">
                <option value="">—</option>
                ${["男性", "女性", "その他"].map((g) => `<option value="${g}" ${sheet.gender === g ? "selected" : ""}>${g}</option>`).join("")}
            </select>
        </div>
        <div>
            <label class="ss-label">${t("skillsheet.field_nearest_station", lang)}</label>
            <input type="text" name="nearestStation" value="${sheet.nearestStation || ""}" placeholder="渋谷駅" class="ss-input">
        </div>
        <div>
            <label class="ss-label">${t("skillsheet.field_experience", lang)}</label>
            <input type="number" name="experience" value="${sheet.experience || 0}" min="0" max="50" class="ss-input">
        </div>
    </div>
</div>

<!-- 資格・免許 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-certificate"></i>${t("skillsheet.certifications", lang)}</div>
    <div class="ss-skill-tbl-wrap"><table class="ss-skill-table" id="certTable">
        <thead><tr><th style="width:60%">${t("skillsheet.cert_name", lang)}</th><th>${t("skillsheet.cert_date", lang)}</th><th style="width:36px;"></th></tr></thead>
        <tbody>
            ${certs
              .map(
                (c, i) => `
            <tr class="cert-row">
                <td><input type="text" name="certName" value="${c.name || ""}" placeholder="基本情報技術者 等" class="ss-input"></td>
                <td><input type="month" name="certDate" value="${c.acquiredDate || ""}" class="ss-input"></td>
                <td>${i < certs.length - 1 ? `<button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button>` : ""}</td>
            </tr>`,
              )
              .join("")}
        </tbody>
    </table></div>
    <button type="button" class="ss-add-btn" style="margin-top:10px;" onclick="addCertRow()">
        <i class="fa-solid fa-plus"></i> ${t("common.add", lang)}
    </button>
</div>

<!-- スキルマップ -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-code"></i>${t("skillsheet.skill_map", lang)}</div>
    ${SKILL_CATS.map((cat) => {
      const nameBase =
        {
          languages: "skillLangName",
          frameworks: "skillFwName",
          databases: "skillDbName",
          infra: "skillInfraName",
          tools: "skillToolName",
        }[cat.key] +
        "/" +
        {
          languages: "skillLangLevel",
          frameworks: "skillFwLevel",
          databases: "skillDbLevel",
          infra: "skillInfraLevel",
          tools: "skillToolLevel",
        }[cat.key];
      const [nameKey, levelKey] = nameBase.split("/");
      return `
    <div style="margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:#2563eb;margin-bottom:6px;">${t("skillsheet.cat_" + cat.key, lang)}</div>
        <table class="ss-skill-table" data-cat="${cat.key}">
            <thead><tr><th>${t("skillsheet.skill_name", lang)}</th><th style="width:160px;">${t("skillsheet.skill_level", lang)}</th><th style="width:36px;"></th></tr></thead>
            <tbody>
                ${renderSkillCat(cat.key, nameKey.replace("Name", ""), skills[cat.key])}
            </tbody>
        </table>
        <button type="button" class="ss-add-btn" style="margin-top:8px;"
            onclick="addSkillRow(this,'${nameKey}','${levelKey}')">
            <i class="fa-solid fa-plus"></i> ${t("common.add", lang)}
        </button>
    </div>`;
    }).join("")}
</div>

<!-- 自己PR -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-star"></i>${t("skillsheet.self_pr", lang)}</div>
    <textarea name="selfPR" rows="5" class="ss-textarea" placeholder="${t("skillsheet.self_pr_placeholder", lang)}">${sheet.selfPR || ""}</textarea>
</div>

<!-- 職務経歴 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-briefcase"></i>${t("skillsheet.career", lang)}</div>
    <div id="projContainer">
        ${(sheet.projects || []).map((p, i) => renderProject(p, i)).join("")}
    </div>
    <button type="button" class="ss-add-btn" onclick="addProject()">
        <i class="fa-solid fa-plus"></i> ${t("skillsheet.add_project", lang)}
    </button>
</div>

<!-- 保存バー -->
<div class="ss-save-bar">
    <button type="submit" form="ssForm"
        style="background:#3b82f6;color:#fff;border:none;padding:10px 28px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(59,130,246,.3);"
        onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
        <i class="fa-solid fa-floppy-disk" style="margin-right:6px;"></i>${t("skillsheet.save_btn", lang)}
    </button>
    <a href="/skillsheet/export"
        style="background:#16a34a;color:#fff;padding:10px 22px;border-radius:7px;font-size:14px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:7px;"
        onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        <i class="fa-solid fa-file-excel"></i>${t("skillsheet.export_excel", lang)}
    </a>
</div>
</form>
</div><!-- /ss-form-wrap -->

<script>
// ── 行削除 ──
function delRow(btn) { btn.closest('tr').remove(); }

// ── 資格行追加 ──
function addCertRow() {
    const tbody = document.querySelector('#certTable tbody');
    const tr = document.createElement('tr');
    tr.className = 'cert-row';
    tr.innerHTML = \`
        <td><input type="text" name="certName" placeholder="資格名" class="ss-input"></td>
        <td><input type="month" name="certDate" class="ss-input"></td>
        <td><button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button></td>\`;
    tbody.appendChild(tr);
}

// ── スキル行追加 ──
function addSkillRow(btn, nameKey, levelKey) {
    const tbody = btn.previousElementSibling.querySelector('tbody');
    const tr = document.createElement('tr');
    tr.className = 'skill-row';
    const opts = [0,1,2,3,4,5].map(n=>\`<option value="\${n}">\${n===0?'—':'★'.repeat(n)}</option>\`).join('');
    tr.innerHTML = \`
        <td><input type="text" name="\${nameKey}Name" placeholder="名称" class="ss-input"></td>
        <td><select name="\${levelKey}Level" class="ss-select">\${opts}</select></td>
        <td><button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button></td>\`;
    tbody.appendChild(tr);
}

// ── プロジェクト削除 ──
function delProj(btn) {
    btn.closest('.ss-proj-card').remove();
    renumberProjects();
}
function renumberProjects() {
    document.querySelectorAll('.ss-proj-card').forEach((el, i) => {
        el.querySelector('.ss-proj-num').textContent = '案件 ' + (i+1);
    });
}

// ── 現在チェック ──
function setCurrentProj(chk) {
    const card = chk.closest('.ss-proj-card');
    const toInput = card.querySelector('input[name="pTo"]');
    if (chk.checked) {
        toInput._prev = toInput.value;
        toInput.value = '';
        toInput.disabled = true;
    } else {
        toInput.disabled = false;
        toInput.value = toInput._prev || '';
    }
}

// ── プロジェクト追加 ──
function addProject() {
    const container = document.getElementById('projContainer');
    const idx = container.querySelectorAll('.ss-proj-card').length;
    const taskChks = ${JSON.stringify(TASK_LABELS.map((t) => t.key))}.map(k => \`
        <label class="ss-task-chk">
            <span>\${{'requirement':'要件定義','basicDesign':'基本設計','detailDesign':'詳細設計','development':'開発・実装','testing':'テスト','operation':'運用・保守','management':'PM / リーダー'}[k]}</span><input type="checkbox" name="pTask_\${k}">
        </label>\`).join('');
    const div = document.createElement('div');
    div.className = 'ss-proj-card';
    div.innerHTML = \`
    <div class="ss-proj-header">
        <span class="ss-proj-num">案件 \${idx+1}</span>
        <button type="button" class="ss-del-proj" onclick="delProj(this)">削除</button>
    </div>
    <div class="ss-grid4">
        <div><label class="ss-label">開始年月</label><input type="month" name="pFrom" class="ss-input"></div>
        <div>
            <label class="ss-label">終了年月</label>
            <div style="display:flex;align-items:flex-start;gap:6px;">
              <input type="month" name="pTo" class="ss-input" style="flex:1;">
              <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;cursor:pointer;padding-top:9px;"><input type="checkbox" onchange="setCurrentProj(this)" style="margin:0;cursor:pointer;"> 現在</label>
            </div>
        </div>
        <div style="grid-column:3/5;"><label class="ss-label">案件名</label><input type="text" name="pName" placeholder="案件名" class="ss-input"></div>
        <div><label class="ss-label">顧客名</label><input type="text" name="pClient" placeholder="顧客名" class="ss-input"></div>
        <div><label class="ss-label">業種</label><input type="text" name="pIndust" placeholder="IT / 金融 等" class="ss-input"></div>
        <div><label class="ss-label">チーム規模</label><input type="number" name="pTeam" placeholder="人数" class="ss-input" min="1"></div>
        <div><label class="ss-label">役割</label><input type="text" name="pRole" placeholder="PL / 開発 等" class="ss-input"></div>
    </div>
    <div style="margin-top:12px;">
        <label class="ss-label">担当工程</label>
        <div class="ss-tasks">\${taskChks}</div>
    </div>
    <div style="margin-top:12px;">
        <label class="ss-label">案件概要</label>
        <textarea name="pDesc" rows="3" class="ss-textarea" placeholder="システム概要・担当業務など"></textarea>
    </div>
    <div style="margin-top:10px;">
        <label class="ss-label">使用技術・環境</label>
        <textarea name="pTech" rows="2" class="ss-textarea" placeholder="Java, Spring Boot, MySQL, AWS 等"></textarea>
    </div>\`;
    container.appendChild(div);
}
</script>`;
}

// ── スキルマップ集計API ────────────────────────────────────────────────────
// GET /skillsheet/api/map?employeeId=xxx  個人レーダー用データ
// GET /skillsheet/api/map/team            チーム全体バブルチャート用データ

router.get("/skillsheet/api/map", requireLogin, async (req, res) => {
  try {
    const { employeeId } = req.query;
    const targetId = employeeId || req.session.employeeId;
    const sheet = await SkillSheet.findOne({ employeeId: targetId }).lean();
    if (!sheet) return res.json({ labels: [], datasets: [] });

    // カテゴリ別の平均レベルをレーダーチャート用に整形
    const catAverages = SKILL_CATS.map((cat) => {
      const items = (sheet.skills && sheet.skills[cat.key]) || [];
      if (items.length === 0) return { cat: cat.label, avg: 0, items };
      const avg = items.reduce((s, i) => s + (i.level || 0), 0) / items.length;
      return { cat: cat.label, avg: Math.round(avg * 10) / 10, items };
    });

    // 工程スキル（task実績カウント）
    const taskCounts = TASK_LABELS.map((t) => {
      const count = (sheet.projects || []).filter(
        (p) => p.tasks && p.tasks[t.key],
      ).length;
      return { label: t.label, count };
    });

    res.json({
      name: sheet.nameKana || "",
      experience: sheet.experience || 0,
      radar: {
        labels: catAverages.map((c) => c.cat),
        data: catAverages.map((c) => c.avg),
        max: 5,
      },
      tasks: taskCounts,
      topSkills: SKILL_CATS.flatMap((cat) =>
        ((sheet.skills && sheet.skills[cat.key]) || []).map((s) => ({
          ...s,
          cat: cat.label,
        })),
      )
        .sort((a, b) => b.level - a.level)
        .slice(0, 10),
      certifications: sheet.certifications || [],
      projectCount: (sheet.projects || []).length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/skillsheet/api/map/team", requireLogin, async (req, res) => {
  try {
    const sheets = await SkillSheet.find().lean();
    const { Employee: Emp } = require("../models");
    const employees = await Emp.find().lean();
    const empMap = Object.fromEntries(
      employees.map((e) => [e._id.toString(), e]),
    );

    const bubbleData = sheets.map((sheet) => {
      const emp = empMap[sheet.employeeId.toString()] || {};
      // 全スキルの平均レベル
      const allItems = SKILL_CATS.flatMap(
        (cat) => (sheet.skills && sheet.skills[cat.key]) || [],
      );
      const avgLevel =
        allItems.length > 0
          ? Math.round(
              (allItems.reduce((s, i) => s + (i.level || 0), 0) /
                allItems.length) *
                10,
            ) / 10
          : 0;
      const skillCount = allItems.length;

      // 担当工程の幅（バブルサイズ）
      const taskScore = TASK_LABELS.filter((t) =>
        (sheet.projects || []).some((p) => p.tasks && p.tasks[t.key]),
      ).length;

      return {
        name: emp.name || sheet.nameKana || "不明",
        department: emp.department || "-",
        experience: sheet.experience || 0,
        avgLevel,
        skillCount,
        taskScore,
        projectCount: (sheet.projects || []).length,
      };
    });

    // カテゴリ別スキル保有者数（棒グラフ用）
    const catStats = SKILL_CATS.map((cat) => {
      const holders = sheets.filter(
        (s) => ((s.skills && s.skills[cat.key]) || []).length > 0,
      ).length;
      const avgLv = (() => {
        const all = sheets.flatMap(
          (s) => (s.skills && s.skills[cat.key]) || [],
        );
        return all.length > 0
          ? Math.round(
              (all.reduce((a, i) => a + (i.level || 0), 0) / all.length) * 10,
            ) / 10
          : 0;
      })();
      return { cat: cat.label, holders, avgLv };
    });

    // スキル別ランキング（全員のスキルを集計）
    const skillRank = {};
    for (const sheet of sheets) {
      for (const cat of SKILL_CATS) {
        for (const item of (sheet.skills && sheet.skills[cat.key]) || []) {
          if (!skillRank[item.name])
            skillRank[item.name] = { count: 0, totalLevel: 0, cat: cat.label };
          skillRank[item.name].count++;
          skillRank[item.name].totalLevel += item.level || 0;
        }
      }
    }
    const topSkills = Object.entries(skillRank)
      .map(([name, d]) => ({
        name,
        count: d.count,
        avgLevel: Math.round((d.totalLevel / d.count) * 10) / 10,
        cat: d.cat,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json({ bubbleData, catStats, topSkills, total: sheets.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── スキルマップ表示ページ ──────────────────────────────────────────────────
router.get("/skillsheet/map", requireLogin, async (req, res) => {
  try {
    const isAdmin = !!req.session.isAdmin;
    const employee = req.session.employee;
    const lang = req.lang || req.session?.lang || "ja";

    const content = `
<div style="max-width:100%;margin:0 auto">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <h2 style="margin:0;font-size:22px;font-weight:800">
        <i class="fa fa-chart-radar" style="color:#0f6fff"></i> スキルマップ
    </h2>
    <div style="display:flex;gap:8px">
        <button id="btnPersonal" class="tab-btn active" onclick="switchTab('personal')">個人レーダー</button>
        ${isAdmin ? '<button id="btnTeam" class="tab-btn" onclick="switchTab(\'team\')">チーム全体</button>' : ""}
        <a href="/skillsheet" class="tab-btn" style="text-decoration:none">${t("skillsheet.edit_title", lang)}</a>
    </div>
</div>

<!-- 個人レーダーチャートタブ -->
<div id="tabPersonal">
    ${
      isAdmin
        ? `
    <div style="margin-bottom:16px">
        <label style="font-weight:600;margin-right:8px">社員を選択：</label>
        <select id="empSelect" onchange="loadPersonal(this.value)"
                style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px">
            <option value="">-- 選択してください --</option>
        </select>
    </div>`
        : ""
    }
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px 60px" id="personalGrid">
        <div class="sk-card">
            <h4>カテゴリ別スキルレベル（レーダー）</h4>
            <canvas id="radarChart" width="500" height="500"></canvas>
        </div>
        <div class="sk-card">
            <h4>担当工程実績</h4>
            <canvas id="taskChart" width="500" height="500"></canvas>
        </div>
        <div class="sk-card" style="grid-column:1/-1">
            <h4>スキルTop10</h4>
            <div id="topSkillsBar"></div>
        </div>
    </div>
    <div id="personalEmpty" style="display:none;text-align:center;padding:60px;color:#94a3b8">
        スキルシートにデータがありません
    </div>
</div>

<!-- チーム全体タブ（管理者のみ） -->
${
  isAdmin
    ? `
<div id="tabTeam" style="display:none">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="sk-card" style="grid-column:1/-1">
            <h4>カテゴリ別スキル保有者数 ＆ 平均レベル</h4>
            <canvas id="catBarChart" height="200"></canvas>
        </div>
        <div class="sk-card" style="grid-column:1/-1">
            <h4>スキル人気ランキング Top20（バブル＝保有者数）</h4>
            <canvas id="bubbleChart" height="300"></canvas>
        </div>
        <div class="sk-card" style="grid-column:1/-1">
            <h4>メンバー別 スキル概要</h4>
            <div id="memberTable"></div>
        </div>
    </div>
</div>`
    : ""
}
</div>

<style>
.sk-card{background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:20px}
.sk-card h4{margin:0 0 16px;font-size:15px;color:#334155}
.tab-btn{background:#f1f5f9;color:#334155;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}
.tab-btn.active{background:#0f6fff;color:#fff}
.skill-bar-wrap{margin-bottom:8px}
.skill-bar-label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px}
.skill-bar-bg{background:#f1f5f9;border-radius:6px;height:10px}
.skill-bar-fill{height:10px;border-radius:6px;background:linear-gradient(90deg,#0f6fff,#38bdf8);transition:width .4s}
.member-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #f1f5f9}
.member-row:hover{background:#f8fafc}
@media(max-width:640px){
  .sk-card{padding:18px 12px}
  #personalGrid{grid-template-columns:1fr!important}
  .member-row{flex-wrap:wrap}
}
@media(max-width:700px){#personalGrid{grid-template-columns:1fr!important}}
</style>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
let radarChart, taskChart, catBarChart, bubbleChart;

function switchTab(tab) {
    document.getElementById('tabPersonal').style.display = tab === 'personal' ? '' : 'none';
    const teamEl = document.getElementById('tabTeam');
    if (teamEl) teamEl.style.display = tab === 'team' ? '' : 'none';
    document.getElementById('btnPersonal').className = 'tab-btn' + (tab === 'personal' ? ' active' : '');
    const btnTeam = document.getElementById('btnTeam');
    if (btnTeam) btnTeam.className = 'tab-btn' + (tab === 'team' ? ' active' : '');
    if (tab === 'team') loadTeam();
}

// ── 個人レーダー ──
async function loadPersonal(empId) {
    const url = '/skillsheet/api/map' + (empId ? '?employeeId=' + empId : '');
    const d = await fetch(url).then(r => r.json());

    const hasData = d.radar && d.radar.data.some(v => v > 0);
    document.getElementById('personalEmpty').style.display = hasData ? 'none' : '';
    document.getElementById('personalGrid').style.display = hasData ? '' : 'none';
    if (!hasData) return;

    // レーダーチャート
    if (radarChart) radarChart.destroy();
    radarChart = new Chart(document.getElementById('radarChart'), {
        type: 'radar',
        data: {
            labels: d.radar.labels,
            datasets: [{ label: d.name || 'スキル', data: d.radar.data,
                backgroundColor: 'rgba(15,111,255,0.15)', borderColor: '#0f6fff',
                pointBackgroundColor: '#0f6fff', borderWidth: 2 }]
        },
        options: { scales: { r: { min: 0, max: 5, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
    });

    // 工程棒グラフ
    if (taskChart) taskChart.destroy();
    taskChart = new Chart(document.getElementById('taskChart'), {
        type: 'bar',
        data: {
            labels: d.tasks.map(t => t.label),
            datasets: [{ label: '担当案件数', data: d.tasks.map(t => t.count),
                backgroundColor: '#0f6fff', borderRadius: 6 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } },
                   scales: { x: { ticks: { stepSize: 1 } } } }
    });

    // Top10スキルバー
    const container = document.getElementById('topSkillsBar');
    container.innerHTML = d.topSkills.map(s => {
        const pct = Math.round(s.level / 5 * 100);
        return '<div class="skill-bar-wrap">' +
               '<div class="skill-bar-label"><span>' + s.name + ' <small style="color:#94a3b8">(' + s.cat + ')</small></span><span>' + s.level + '/5</span></div>' +
               '<div class="skill-bar-bg"><div class="skill-bar-fill" style="width:' + pct + '%"></div></div></div>';
    }).join('');
}

// ── チーム全体 ──
let teamLoaded = false;
async function loadTeam() {
    if (teamLoaded) return;
    teamLoaded = true;
    const d = await fetch('/skillsheet/api/map/team').then(r => r.json());

    // カテゴリ別棒グラフ
    if (catBarChart) catBarChart.destroy();
    catBarChart = new Chart(document.getElementById('catBarChart'), {
        type: 'bar',
        data: {
            labels: d.catStats.map(c => c.cat),
            datasets: [
                { label: '保有者数（人）', data: d.catStats.map(c => c.holders),
                  backgroundColor: 'rgba(15,111,255,0.7)', borderRadius: 4, yAxisID: 'y' },
                { label: '平均レベル', data: d.catStats.map(c => c.avgLv),
                  type: 'line', borderColor: '#f59e0b', pointBackgroundColor: '#f59e0b',
                  tension: 0.3, yAxisID: 'y1' }
            ]
        },
        options: { scales: {
            y: { beginAtZero: true, title: { display: true, text: '保有者数' } },
            y1: { beginAtZero: true, max: 5, position: 'right', title: { display: true, text: '平均レベル' }, grid: { drawOnChartArea: false } }
        }}
    });

    // スキルバブルチャート（横棒で代替）
    if (bubbleChart) bubbleChart.destroy();
    bubbleChart = new Chart(document.getElementById('bubbleChart'), {
        type: 'bar',
        data: {
            labels: d.topSkills.map(s => s.name),
            datasets: [
                { label: '保有者数', data: d.topSkills.map(s => s.count),
                  backgroundColor: 'rgba(15,111,255,0.7)', borderRadius: 4, yAxisID: 'y' },
                { label: '平均レベル', data: d.topSkills.map(s => s.avgLevel),
                  type: 'line', borderColor: '#10b981', pointBackgroundColor: '#10b981',
                  tension: 0.3, yAxisID: 'y1' }
            ]
        },
        options: { indexAxis: 'y', scales: {
            y: { ticks: { font: { size: 11 } } },
            y1: { beginAtZero: true, max: 5, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '平均レベル' } }
        }}
    });

    // メンバーテーブル
    const tbl = document.getElementById('memberTable');
    tbl.innerHTML = d.bubbleData.sort((a, b) => b.avgLevel - a.avgLevel).map(m =>
        '<div class="member-row">' +
        '<div style="min-width:120px;font-weight:600">' + m.name + '</div>' +
        '<div style="min-width:100px;color:#64748b;font-size:13px">' + m.department + '</div>' +
        '<div style="min-width:80px;font-size:13px">経験 <b>' + m.experience + '</b>年</div>' +
        '<div style="min-width:80px;font-size:13px">平均 <b>' + m.avgLevel + '</b>/5</div>' +
        '<div style="min-width:80px;font-size:13px">スキル <b>' + m.skillCount + '</b>件</div>' +
        '<div style="font-size:13px">案件 <b>' + m.projectCount + '</b>件</div>' +
        '</div>'
    ).join('');
}

// ── 管理者：社員一覧を取得してセレクト生成 ──
${
  isAdmin
    ? `
(async () => {
    const sel = document.getElementById('empSelect');
    if (!sel) return;
    const emps = await fetch('/admin/api/employees').then(r => r.json()).catch(() => []);
    emps.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e._id; opt.textContent = e.name + ' (' + e.department + ')';
        sel.appendChild(opt);
    });
    // デフォルトで最初の社員を表示
    if (emps.length > 0) { sel.value = emps[0]._id; loadPersonal(emps[0]._id); }
})();`
    : `loadPersonal();`
}
</script>
`;
    const { buildPageShell, pageFooter } = require("../lib/renderPage");
    res.send(
      buildPageShell({
        title: "スキルマップ",
        currentPath: "/skillsheet/map",
        employee,
        isAdmin,
        lang,
      }) +
        content +
        pageFooter(),
    );
  } catch (e) {
    console.error(e);
    res.status(500).send("エラー: " + e.message);
  }
});

module.exports = router;
