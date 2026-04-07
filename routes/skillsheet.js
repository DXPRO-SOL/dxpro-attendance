// ==============================
// routes/skillsheet.js — スキルシート管理
// ==============================
const router    = require('express').Router();
const ExcelJS   = require('exceljs');
const { requireLogin } = require('../middleware/auth');
const { Employee, SkillSheet } = require('../models');
const { renderPage } = require('../lib/renderPage');

// ─── 共通ヘルパー ────────────────────────────────
const LEVEL_LABELS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
const SKILL_CATS = [
    { key: 'languages',  label: 'プログラミング言語' },
    { key: 'frameworks', label: 'FW / ライブラリ' },
    { key: 'databases',  label: 'データベース' },
    { key: 'infra',      label: 'インフラ / クラウド' },
    { key: 'tools',      label: 'ツール' },
];
const TASK_LABELS = [
    { key: 'requirement',  label: '要件定義' },
    { key: 'basicDesign',  label: '基本設計' },
    { key: 'detailDesign', label: '詳細設計' },
    { key: 'development',  label: '開発・実装' },
    { key: 'testing',      label: 'テスト' },
    { key: 'operation',    label: '運用・保守' },
    { key: 'management',   label: 'PM / リーダー' },
];

async function getOrCreate(employeeId, userId) {
    let sheet = await SkillSheet.findOne({ employeeId });
    if (!sheet) {
        sheet = await SkillSheet.create({
            employeeId, userId,
            skills: { languages:[], frameworks:[], databases:[], infra:[], tools:[] },
            certifications: [],
            projects: []
        });
    }
    return sheet;
}

// ─── GET /skillsheet ─────────────────────────────
router.get('/skillsheet', requireLogin, async (req, res) => {
    try {
        // 管理者 → 従業員一覧を表示
        if (req.session.isAdmin) {
            const employees = await Employee.find().sort({ employeeId: 1 });
            // 各従業員のスキルシート有無を確認
            const sheets = await SkillSheet.find({}, { employeeId: 1 });
            const sheetSet = new Set(sheets.map(s => String(s.employeeId)));
            const html = buildAdminListPage(employees, sheetSet);
            return renderPage(req, res, 'スキルシート管理', 'スキルシート管理', html);
        }

        // 一般ユーザー → 自分のシートを表示
        const emp = await Employee.findOne({ userId: req.session.userId });
        if (!emp) return res.redirect('/dashboard');

        const sheet = await getOrCreate(emp._id, req.session.userId);
        const html  = buildEditPage(emp, sheet, req);
        renderPage(req, res, 'スキルシート', 'スキルシート管理', html);
    } catch (e) {
        console.error(e);
        res.status(500).send('エラーが発生しました');
    }
});

// ─── GET /skillsheet/admin/:employeeId ───────────
router.get('/skillsheet/admin/:employeeId', requireLogin, async (req, res) => {
    try {
        if (!req.session.isAdmin) return res.status(403).send('権限がありません');
        const emp = await Employee.findById(req.params.employeeId);
        if (!emp) return res.redirect('/skillsheet');
        const sheet = await getOrCreate(emp._id, emp.userId);
        const html  = buildEditPage(emp, sheet, req, true);
        renderPage(req, res, 'スキルシート編集', 'スキルシート管理', html);
    } catch (e) {
        console.error(e);
        res.status(500).send('エラーが発生しました');
    }
});

// ─── POST /skillsheet/admin/:employeeId/save ─────
router.post('/skillsheet/admin/:employeeId/save', requireLogin, async (req, res) => {
    try {
        if (!req.session.isAdmin) return res.status(403).send('権限がありません');
        const emp = await Employee.findById(req.params.employeeId);
        if (!emp) return res.redirect('/skillsheet');
        await saveSheetFromBody(req.body, emp);
        res.redirect(`/skillsheet/admin/${emp._id}?saved=1`);
    } catch (e) {
        console.error(e);
        res.redirect(`/skillsheet/admin/${req.params.employeeId}?error=1`);
    }
});

// ─── GET /skillsheet/admin/:employeeId/export ────
router.get('/skillsheet/admin/:employeeId/export', requireLogin, async (req, res) => {
    try {
        if (!req.session.isAdmin) return res.status(403).send('権限がありません');
        const emp = await Employee.findById(req.params.employeeId);
        if (!emp) return res.redirect('/skillsheet');
        const sheet = await SkillSheet.findOne({ employeeId: emp._id });
        if (!sheet) return res.redirect(`/skillsheet/admin/${emp._id}`);
        await exportExcel(res, emp, sheet);
    } catch (e) {
        console.error(e);
        res.status(500).send('Excel出力中にエラーが発生しました');
    }
});

// ─── POST /skillsheet/save ───────────────────────
router.post('/skillsheet/save', requireLogin, async (req, res) => {
    try {
        const emp = await Employee.findOne({ userId: req.session.userId });
        if (!emp) return res.redirect('/dashboard');
        await saveSheetFromBody(req.body, emp);
        res.redirect('/skillsheet?saved=1');
    } catch (e) {
        console.error(e);
        res.redirect('/skillsheet?error=1');
    }
});

// ─── GET /skillsheet/export ─────────────────────
router.get('/skillsheet/export', requireLogin, async (req, res) => {
    try {
        const emp = await Employee.findOne({ userId: req.session.userId });
        if (!emp) return res.redirect('/dashboard');
        const sheet = await SkillSheet.findOne({ employeeId: emp._id });
        if (!sheet) return res.redirect('/skillsheet');
        await exportExcel(res, emp, sheet);
    } catch (e) {
        console.error(e);
        res.status(500).send('Excel出力中にエラーが発生しました');
    }
});

// ─── 共通：シート保存 ────────────────────────────
async function saveSheetFromBody(b, emp) {
    const parseSkills = (nameArr, levelArr) => {
        const names  = [].concat(nameArr  || []);
        const levels = [].concat(levelArr || []);
        return names
            .map((n, i) => ({ name: n.trim(), level: parseInt(levels[i]||0) }))
            .filter(s => s.name);
    };

    const certNames  = [].concat(b.certName  || []);
    const certDates  = [].concat(b.certDate  || []);
    const certifications = certNames
        .map((n, i) => ({ name: n.trim(), acquiredDate: certDates[i]||'' }))
        .filter(c => c.name);

    const pFrom   = [].concat(b.pFrom   || []);
    const pTo     = [].concat(b.pTo     || []);
    const pName   = [].concat(b.pName   || []);
    const pClient = [].concat(b.pClient || []);
    const pIndust = [].concat(b.pIndust || []);
    const pTeam   = [].concat(b.pTeam   || []);
    const pRole   = [].concat(b.pRole   || []);
    const pDesc   = [].concat(b.pDesc   || []);
    const pTech   = [].concat(b.pTech   || []);

    const projects = pFrom.map((_, i) => {
        const tasks = {};
        TASK_LABELS.forEach(t => {
            const val = [].concat(b[`pTask_${t.key}`] || []);
            tasks[t.key] = val[i] === 'on';
        });
        return {
            periodFrom:  pFrom[i]   || '',
            periodTo:    pTo[i]     || '',
            projectName: pName[i]   || '',
            client:      pClient[i] || '',
            industry:    pIndust[i] || '',
            team:        parseInt(pTeam[i]) || 0,
            role:        pRole[i]   || '',
            description: pDesc[i]  || '',
            techStack:   pTech[i]  || '',
            tasks
        };
    }).filter(p => p.projectName);

    await SkillSheet.findOneAndUpdate(
        { employeeId: emp._id },
        {
            userId: emp.userId,
            nameKana:   b.nameKana   || '',
            birthDate:  b.birthDate  || '',
            gender:     b.gender     || '',
            nearestStation: b.nearestStation || '',
            experience: parseInt(b.experience) || 0,
            selfPR:     b.selfPR     || '',
            certifications,
            skills: {
                languages:  parseSkills(b.skillLangName,  b.skillLangLevel),
                frameworks: parseSkills(b.skillFwName,    b.skillFwLevel),
                databases:  parseSkills(b.skillDbName,    b.skillDbLevel),
                infra:      parseSkills(b.skillInfraName, b.skillInfraLevel),
                tools:      parseSkills(b.skillToolName,  b.skillToolLevel),
            },
            projects
        },
        { upsert: true, new: true }
    );
}

// ─── 共通：Excel出力 ─────────────────────────────
async function exportExcel(res, emp, sheet) {

        // ── 列幅設定 ──
        ws.columns = [
            { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 },
            { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
            { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
        ];

        // ── スタイル定義 ──
        const hFill  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1E3A5F' } };
        const sh1Fill= { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2563EB' } };
        const sh2Fill= { type:'pattern', pattern:'solid', fgColor:{ argb:'FF3B82F6' } };
        const sh3Fill= { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE0EAFF' } };
        const altFill= { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF8FAFC' } };
        const whtFill= { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
        const thin   = { style:'thin',  color:{ argb:'FFD1D5DB' } };
        const med    = { style:'medium', color:{ argb:'FF94A3B8' } };
        const bold   = { style:'medium', color:{ argb:'FF1E3A5F' } };
        const brd    = b => ({ top:b, bottom:b, left:b, right:b });
        const whtTxt = { bold:true,  color:{ argb:'FFFFFFFF' }, size:11 };
        const navTxt = { bold:true,  color:{ argb:'FFFFFFFF' }, size:10 };
        const bodyTxt= { color:{ argb:'FF1E293B' }, size:10 };
        const center = { horizontal:'center', vertical:'middle', wrapText:true };
        const left   = { horizontal:'left',   vertical:'middle', wrapText:true };

        const cell = (r,c,v,font,align,fill,border) => {
            const cl = ws.getCell(r,c);
            cl.value  = v;
            if (font)   cl.font      = font;
            if (align)  cl.alignment = align;
            if (fill)   cl.fill      = fill;
            if (border) cl.border    = border;
            return cl;
        };
        const merge = (r1,c1,r2,c2) => ws.mergeCells(r1,c1,r2,c2);

        let row = 1;

        // ═══════════════════════════════════════
        // タイトルバー
        // ═══════════════════════════════════════
        ws.getRow(row).height = 36;
        merge(row,1, row,12);
        cell(row,1,'スキルシート',
            { bold:true, color:{ argb:'FFFFFFFF' }, size:16 },
            center, hFill, brd(bold));
        row++;

        // ═══════════════════════════════════════
        // 基本情報
        // ═══════════════════════════════════════
        ws.getRow(row).height = 22;
        merge(row,1, row,12);
        cell(row,1,'■ 基本情報', navTxt, left, sh1Fill, brd(bold));
        row++;

        const info = [
            ['氏名',       emp.name,               '氏名（カナ）', sheet.nameKana],
            ['部署',       emp.department,          '職位',         emp.position],
            ['生年月日',   sheet.birthDate||'',     '性別',         sheet.gender||''],
            ['最寄り駅',   sheet.nearestStation||'','IT経験年数',   (sheet.experience||0)+'年'],
        ];
        info.forEach(([l1,v1,l2,v2]) => {
            ws.getRow(row).height = 20;
            merge(row,1, row,2); cell(row,1,l1,{bold:true,color:{argb:'FF475569'},size:10}, center, sh3Fill, brd(thin));
            merge(row,3, row,6); cell(row,3,v1, bodyTxt, left, whtFill, brd(thin));
            merge(row,7, row,8); cell(row,7,l2, {bold:true,color:{argb:'FF475569'},size:10}, center, sh3Fill, brd(thin));
            merge(row,9, row,12);cell(row,9,v2, bodyTxt, left, whtFill, brd(thin));
            row++;
        });

        // ═══════════════════════════════════════
        // 資格・免許
        // ═══════════════════════════════════════
        ws.getRow(row).height = 22;
        merge(row,1, row,12);
        cell(row,1,'■ 資格・免許', navTxt, left, sh1Fill, brd(bold));
        row++;

        if (sheet.certifications && sheet.certifications.length > 0) {
            ws.getRow(row).height = 18;
            merge(row,1, row,6); cell(row,1,'資格名', {bold:true,color:{argb:'FF475569'},size:10}, center, sh3Fill, brd(thin));
            merge(row,7, row,12);cell(row,7,'取得年月', {bold:true,color:{argb:'FF475569'},size:10}, center, sh3Fill, brd(thin));
            row++;
            sheet.certifications.forEach((c, i) => {
                ws.getRow(row).height = 18;
                merge(row,1, row,6); cell(row,1,c.name||'', bodyTxt, left, i%2?altFill:whtFill, brd(thin));
                merge(row,7, row,12);cell(row,7,c.acquiredDate||'', bodyTxt, center, i%2?altFill:whtFill, brd(thin));
                row++;
            });
        } else {
            ws.getRow(row).height = 18;
            merge(row,1, row,12); cell(row,1,'（なし）', {color:{argb:'FF94A3B8'},size:10}, center, whtFill, brd(thin));
            row++;
        }

        // ═══════════════════════════════════════
        // スキルマップ
        // ═══════════════════════════════════════
        ws.getRow(row).height = 22;
        merge(row,1, row,12);
        cell(row,1,'■ スキルマップ', navTxt, left, sh1Fill, brd(bold));
        row++;

        SKILL_CATS.forEach(cat => {
            const items = (sheet.skills && sheet.skills[cat.key]) || [];
            if (items.length === 0) return;

            ws.getRow(row).height = 18;
            merge(row,1, row,12);
            cell(row,1, cat.label, {bold:true,color:{argb:'FF1E3A5F'},size:10}, left, sh2Fill, brd(thin));
            row++;

            // ヘッダ行
            ws.getRow(row).height = 16;
            merge(row,1, row,6); cell(row,1,'名称', {bold:true,color:{argb:'FF475569'},size:9}, center, sh3Fill, brd(thin));
            merge(row,7, row,12);cell(row,7,'レベル（★1〜5）', {bold:true,color:{argb:'FF475569'},size:9}, center, sh3Fill, brd(thin));
            row++;

            items.forEach((sk, i) => {
                ws.getRow(row).height = 17;
                merge(row,1, row,6); cell(row,1, sk.name||'', bodyTxt, left, i%2?altFill:whtFill, brd(thin));
                merge(row,7, row,12);cell(row,7, LEVEL_LABELS[sk.level]||'', {size:12,color:{argb:'FFD97706'}}, center, i%2?altFill:whtFill, brd(thin));
                row++;
            });
        });

        // ═══════════════════════════════════════
        // 自己PR
        // ═══════════════════════════════════════
        ws.getRow(row).height = 22;
        merge(row,1, row,12);
        cell(row,1,'■ 自己PR・強み', navTxt, left, sh1Fill, brd(bold));
        row++;

        ws.getRow(row).height = 60;
        merge(row,1, row,12);
        cell(row,1, sheet.selfPR||'', bodyTxt, left, whtFill, brd(thin));
        row++;

        // ═══════════════════════════════════════
        // 職務経歴
        // ═══════════════════════════════════════
        ws.getRow(row).height = 22;
        merge(row,1, row,12);
        cell(row,1,'■ 職務経歴', navTxt, left, sh1Fill, brd(bold));
        row++;

        if (!sheet.projects || sheet.projects.length === 0) {
            merge(row,1, row,12); cell(row,1,'（なし）', {color:{argb:'FF94A3B8'},size:10}, center, whtFill, brd(thin));
            row++;
        } else {
            sheet.projects.forEach((p, idx) => {
                // プロジェクトヘッダ
                ws.getRow(row).height = 20;
                merge(row,1, row,12);
                cell(row,1, `No.${idx+1}　${p.projectName||''}`,
                    {bold:true, color:{argb:'FFFFFFFF'}, size:10}, left, sh2Fill, brd(med));
                row++;

                // 期間・クライアント・チーム規模
                ws.getRow(row).height = 18;
                ['期間','顧客・業界','チーム規模','役割'].forEach((lbl, ci) => {
                    cell(row, ci*3+1, lbl, {bold:true,color:{argb:'FF475569'},size:9}, center, sh3Fill, brd(thin));
                    if (ci < 3) merge(row, ci*3+1, row, ci*3+1);
                });
                row++;

                ws.getRow(row).height = 18;
                const period = `${p.periodFrom||''} 〜 ${p.periodTo||''}`;
                const client = `${p.client||''} ／ ${p.industry||''}`;
                const team   = p.team ? `${p.team}名` : '-';
                [period, client, team, p.role||''].forEach((v, ci) => {
                    merge(row, ci*3+1, row, ci*3+3);
                    cell(row, ci*3+1, v, bodyTxt, center, whtFill, brd(thin));
                });
                row++;

                // 担当工程
                ws.getRow(row).height = 18;
                merge(row,1, row,1);
                cell(row,1,'担当工程', {bold:true,color:{argb:'FF475569'},size:9}, center, sh3Fill, brd(thin));
                TASK_LABELS.forEach((t, ci) => {
                    cell(row, ci+2, t.label, {size:8,color:{argb:'FF475569'},bold:true}, center, sh3Fill, brd(thin));
                });
                row++;

                ws.getRow(row).height = 18;
                merge(row,1, row,1); cell(row,1,'', bodyTxt, center, whtFill, brd(thin));
                TASK_LABELS.forEach((t, ci) => {
                    const checked = p.tasks && p.tasks[t.key];
                    cell(row, ci+2, checked ? '✓' : '', {size:12, color:{argb: checked ? 'FF2563EB':'FFCBD5E1'}, bold:checked}, center, checked?{type:'pattern',pattern:'solid',fgColor:{argb:'FFDBEAFE'}}:whtFill, brd(thin));
                });
                row++;

                // 案件概要
                ws.getRow(row).height = 18;
                merge(row,1, row,12); cell(row,1,'案件概要', {bold:true,color:{argb:'FF475569'},size:9}, left, sh3Fill, brd(thin));
                row++;
                ws.getRow(row).height = 50;
                merge(row,1, row,12); cell(row,1, p.description||'', bodyTxt, left, whtFill, brd(thin));
                row++;

                // 使用技術
                ws.getRow(row).height = 18;
                merge(row,1, row,12); cell(row,1,'使用技術・環境', {bold:true,color:{argb:'FF475569'},size:9}, left, sh3Fill, brd(thin));
                row++;
                ws.getRow(row).height = 30;
                merge(row,1, row,12); cell(row,1, p.techStack||'', bodyTxt, left, whtFill, brd(thin));
                row++;

                // プロジェクト間スペース
                ws.getRow(row).height = 6;
                row++;
            });
        }

        // ── ダウンロード ──
        const filename = encodeURIComponent(`スキルシート_${emp.name}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
        await wb.xlsx.write(res);
        res.end();
}

// ─── 管理者：従業員一覧ページ ─────────────────────
function buildAdminListPage(employees, sheetSet) {
    const rows = employees.map(emp => {
        const hasSheet = sheetSet.has(String(emp._id));
        return `
        <tr>
            <td style="padding:10px 14px;font-weight:600;color:#1e293b;">${emp.employeeId}</td>
            <td style="padding:10px 14px;">${emp.name}</td>
            <td style="padding:10px 14px;color:#64748b;">${emp.department}</td>
            <td style="padding:10px 14px;color:#64748b;">${emp.position}</td>
            <td style="padding:10px 14px;text-align:center;">
                ${hasSheet
                    ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:600;padding:2px 10px;border-radius:20px;">作成済み</span>`
                    : `<span style="background:#f1f5f9;color:#94a3b8;font-size:11px;padding:2px 10px;border-radius:20px;">未作成</span>`}
            </td>
            <td style="padding:10px 14px;text-align:center;">
                <a href="/skillsheet/admin/${emp._id}"
                   style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:6px;padding:5px 14px;font-size:12.5px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:5px;">
                   <i class="fa-solid fa-pen-to-square"></i> 編集
                </a>
                ${hasSheet ? `
                <a href="/skillsheet/admin/${emp._id}/export"
                   style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac;border-radius:6px;padding:5px 14px;font-size:12.5px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:5px;margin-left:6px;">
                   <i class="fa-solid fa-file-excel"></i> Excel
                </a>` : ''}
            </td>
        </tr>`;
    }).join('');

    return `
<style>
.adm-table { width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06); }
.adm-table thead th { background:#1e3a5f;color:#fff;padding:11px 14px;font-size:12.5px;font-weight:700;text-align:left; }
.adm-table tbody tr { border-bottom:1px solid #f1f5f9;transition:background .12s; }
.adm-table tbody tr:hover { background:#f8faff; }
.adm-table tbody td { font-size:13px; }
</style>

<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
    <div style="font-size:13px;color:#64748b;">全 <strong style="color:#1e293b;">${employees.length}</strong> 名の従業員スキルシートを管理します。</div>
</div>

<div style="overflow-x:auto;">
<table class="adm-table">
    <thead>
        <tr>
            <th>社員番号</th>
            <th>氏名</th>
            <th>部署</th>
            <th>職位</th>
            <th style="text-align:center;">ステータス</th>
            <th style="text-align:center;">操作</th>
        </tr>
    </thead>
    <tbody>
        ${rows || '<tr><td colspan="6" style="text-align:center;padding:30px;color:#94a3b8;">従業員が登録されていません</td></tr>'}
    </tbody>
</table>
</div>`;
}

// ─── ページHTML構築 ──────────────────────────────
function buildEditPage(emp, sheet, req, isAdminView = false) {
    const saved = req && req.query && req.query.saved;
    const saveAction  = isAdminView ? `/skillsheet/admin/${emp._id}/save` : '/skillsheet/save';
    const exportHref  = isAdminView ? `/skillsheet/admin/${emp._id}/export` : '/skillsheet/export';
    const backHref    = isAdminView ? '/skillsheet' : null;
    const skills = sheet.skills || {};

    // スキルカテゴリのレンダー
    const renderSkillCat = (catKey, inputNameBase, items) => {
        const rows = [...(items||[]), { name:'', level:0 }]; // 末尾に空行を1つ
        return rows.map((sk, i) => `
        <tr class="skill-row">
            <td><input type="text" name="${inputNameBase}Name" value="${sk.name||''}"
                placeholder="例: JavaScript" class="ss-input"></td>
            <td style="width:160px;">
                <select name="${inputNameBase}Level" class="ss-select">
                    ${[0,1,2,3,4,5].map(n=>`<option value="${n}" ${sk.level===n?'selected':''}>${n===0?'—':LEVEL_LABELS[n]}</option>`).join('')}
                </select>
            </td>
            <td style="width:36px;">
                ${i < rows.length-1 ? `<button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button>` : ''}
            </td>
        </tr>`).join('');
    };

    // プロジェクト行のレンダー
    const renderProject = (p, idx) => `
    <div class="ss-proj-card" data-idx="${idx}">
        <div class="ss-proj-header">
            <span class="ss-proj-num">案件 ${idx+1}</span>
            <button type="button" class="ss-del-proj" onclick="delProj(this)">削除</button>
        </div>
        <div class="ss-grid4">
            <div>
                <label class="ss-label">開始年月</label>
                <input type="month" name="pFrom" value="${p.periodFrom||''}" class="ss-input">
            </div>
            <div>
                <label class="ss-label">終了年月</label>
                <input type="month" name="pTo" value="${p.periodTo&&p.periodTo!=='現在'?p.periodTo:''}" class="ss-input">
                <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;margin-left:6px;cursor:pointer;vertical-align:middle;">
                    <input type="checkbox" onchange="setCurrentProj(this)" ${p.periodTo==='現在'?'checked':''} style="margin:0;cursor:pointer;"> 現在
                </label>
            </div>
            <div style="grid-column:3/5;">
                <label class="ss-label">案件名</label>
                <input type="text" name="pName" value="${p.projectName||''}" placeholder="案件名" class="ss-input">
            </div>
            <div>
                <label class="ss-label">顧客名</label>
                <input type="text" name="pClient" value="${p.client||''}" placeholder="顧客名" class="ss-input">
            </div>
            <div>
                <label class="ss-label">業種</label>
                <input type="text" name="pIndust" value="${p.industry||''}" placeholder="IT / 金融 等" class="ss-input">
            </div>
            <div>
                <label class="ss-label">チーム規模</label>
                <input type="number" name="pTeam" value="${p.team||''}" placeholder="人数" class="ss-input" min="1">
            </div>
            <div>
                <label class="ss-label">役割</label>
                <input type="text" name="pRole" value="${p.role||''}" placeholder="PL / 開発 等" class="ss-input">
            </div>
        </div>
        <div style="margin-top:12px;">
            <label class="ss-label">担当工程</label>
            <div class="ss-tasks">
                ${TASK_LABELS.map(t => `
                <label class="ss-task-chk">
                    <input type="checkbox" name="pTask_${t.key}" ${p.tasks&&p.tasks[t.key]?'checked':''}>
                    ${t.label}
                </label>`).join('')}
            </div>
        </div>
        <div style="margin-top:12px;">
            <label class="ss-label">案件概要</label>
            <textarea name="pDesc" rows="3" class="ss-textarea" placeholder="システム概要・担当業務など">${p.description||''}</textarea>
        </div>
        <div style="margin-top:10px;">
            <label class="ss-label">使用技術・環境</label>
            <textarea name="pTech" rows="2" class="ss-textarea" placeholder="Java, Spring Boot, MySQL, AWS 等">${p.techStack||''}</textarea>
        </div>
    </div>`;

    const certs = [...(sheet.certifications||[]), { name:'', acquiredDate:'' }];

    return `
<style>
.ss-card   { background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px 28px;margin-bottom:20px; }
.ss-sec    { font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e0eaff;display:flex;align-items:center;gap:8px; }
.ss-sec i  { color:#3b82f6; }
.ss-label  { display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px; }
.ss-input  { width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none;transition:border .15s; }
.ss-input:focus  { border-color:#3b82f6; }
.ss-select { width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;outline:none; }
.ss-textarea { width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;outline:none;transition:border .15s; }
.ss-textarea:focus { border-color:#3b82f6; }
.ss-grid2  { display:grid;grid-template-columns:1fr 1fr;gap:14px 20px; }
.ss-grid3  { display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 20px; }
.ss-grid4  { display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px 20px; }
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
.ss-task-chk { display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#374151;cursor:pointer;line-height:1; }
.ss-task-chk input[type="checkbox"] { margin:0;flex-shrink:0;cursor:pointer;vertical-align:middle; }
.ss-save-bar { position:sticky;bottom:0;background:#fff;border-top:1px solid #e2e8f0;padding:14px 0;margin-top:10px;display:flex;gap:12px;z-index:10; }
</style>

<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        ${backHref ? `
        <a href="${backHref}"
           style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
           <i class="fa-solid fa-arrow-left"></i> 一覧に戻る
        </a>` : ''}
        <div style="font-size:13px;color:#64748b;">氏名：<strong style="color:#1e293b;">${emp.name}</strong>　部署：<strong style="color:#1e293b;">${emp.department}</strong></div>
    </div>
    <a href="${exportHref}"
        style="background:linear-gradient(90deg,#16a34a,#22c55e);color:#fff;border:none;padding:10px 20px;border-radius:7px;font-size:13.5px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:7px;box-shadow:0 2px 6px rgba(22,163,74,.25);"
        onmouseover="this.style.opacity='.88'" onmouseout="this.style.opacity='1'">
        <i class="fa-solid fa-file-excel"></i> Excelで出力
    </a>
</div>

${saved ? `
<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:11px 16px;margin-bottom:16px;display:flex;align-items:center;gap:9px;color:#166534;font-size:13.5px;">
    <i class="fa-solid fa-circle-check"></i> 保存しました。
</div>` : ''}

<form method="POST" action="${saveAction}" id="ssForm">

<!-- 基本情報 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-id-card"></i>基本情報</div>
    <div class="ss-grid3" style="margin-bottom:14px;">
        <div>
            <label class="ss-label">氏名（カナ）</label>
            <input type="text" name="nameKana" value="${sheet.nameKana||''}" placeholder="ヤマダ タロウ" class="ss-input">
        </div>
        <div>
            <label class="ss-label">生年月日</label>
            <input type="date" name="birthDate" value="${sheet.birthDate||''}" class="ss-input">
        </div>
        <div>
            <label class="ss-label">性別</label>
            <select name="gender" class="ss-select">
                <option value="">—</option>
                ${['男性','女性','その他'].map(g=>`<option value="${g}" ${sheet.gender===g?'selected':''}>${g}</option>`).join('')}
            </select>
        </div>
        <div>
            <label class="ss-label">最寄り駅</label>
            <input type="text" name="nearestStation" value="${sheet.nearestStation||''}" placeholder="渋谷駅" class="ss-input">
        </div>
        <div>
            <label class="ss-label">IT経験年数</label>
            <input type="number" name="experience" value="${sheet.experience||0}" min="0" max="50" class="ss-input">
        </div>
    </div>
</div>

<!-- 資格・免許 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-certificate"></i>資格・免許</div>
    <table class="ss-skill-table" id="certTable">
        <thead><tr><th style="width:60%">資格名</th><th>取得年月</th><th style="width:36px;"></th></tr></thead>
        <tbody>
            ${certs.map((c,i)=>`
            <tr class="cert-row">
                <td><input type="text" name="certName" value="${c.name||''}" placeholder="基本情報技術者 等" class="ss-input"></td>
                <td><input type="month" name="certDate" value="${c.acquiredDate||''}" class="ss-input"></td>
                <td>${i<certs.length-1?`<button type="button" class="ss-del-btn" onclick="delRow(this)">✕</button>`:''}</td>
            </tr>`).join('')}
        </tbody>
    </table>
    <button type="button" class="ss-add-btn" style="margin-top:10px;" onclick="addCertRow()">
        <i class="fa-solid fa-plus"></i> 追加
    </button>
</div>

<!-- スキルマップ -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-code"></i>スキルマップ</div>
    ${SKILL_CATS.map(cat => {
        const nameBase = { languages:'skillLangName', frameworks:'skillFwName', databases:'skillDbName', infra:'skillInfraName', tools:'skillToolName' }[cat.key] + '/' + { languages:'skillLangLevel', frameworks:'skillFwLevel', databases:'skillDbLevel', infra:'skillInfraLevel', tools:'skillToolLevel' }[cat.key];
        const [nameKey, levelKey] = nameBase.split('/');
        return `
    <div style="margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:#2563eb;margin-bottom:6px;">${cat.label}</div>
        <table class="ss-skill-table" data-cat="${cat.key}">
            <thead><tr><th>名称</th><th style="width:160px;">レベル</th><th style="width:36px;"></th></tr></thead>
            <tbody>
                ${renderSkillCat(cat.key, nameKey.replace('Name',''), skills[cat.key])}
            </tbody>
        </table>
        <button type="button" class="ss-add-btn" style="margin-top:8px;"
            onclick="addSkillRow(this,'${nameKey}','${levelKey}')">
            <i class="fa-solid fa-plus"></i> 追加
        </button>
    </div>`;
    }).join('')}
</div>

<!-- 自己PR -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-star"></i>自己PR・強み</div>
    <textarea name="selfPR" rows="5" class="ss-textarea" placeholder="自己PRや強みを自由に記述してください">${sheet.selfPR||''}</textarea>
</div>

<!-- 職務経歴 -->
<div class="ss-card">
    <div class="ss-sec"><i class="fa-solid fa-briefcase"></i>職務経歴</div>
    <div id="projContainer">
        ${(sheet.projects||[]).map((p, i) => renderProject(p, i)).join('')}
    </div>
    <button type="button" class="ss-add-btn" onclick="addProject()">
        <i class="fa-solid fa-plus"></i> 案件を追加
    </button>
</div>

<!-- 保存バー -->
<div class="ss-save-bar">
    <button type="submit" form="ssForm"
        style="background:#3b82f6;color:#fff;border:none;padding:10px 28px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(59,130,246,.3);"
        onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
        <i class="fa-solid fa-floppy-disk" style="margin-right:6px;"></i>保存する
    </button>
    <a href="/skillsheet/export"
        style="background:#16a34a;color:#fff;padding:10px 22px;border-radius:7px;font-size:14px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:7px;"
        onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        <i class="fa-solid fa-file-excel"></i>Excelで出力
    </a>
</div>
</form>

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
    const taskChks = ${JSON.stringify(TASK_LABELS.map(t=>t.key))}.map(k => \`
        <label class="ss-task-chk">
            <input type="checkbox" name="pTask_\${k}"> \${{'requirement':'要件定義','basicDesign':'基本設計','detailDesign':'詳細設計','development':'開発・実装','testing':'テスト','operation':'運用・保守','management':'PM / リーダー'}[k]}
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
            <input type="month" name="pTo" class="ss-input">
            <label style="font-size:11px;margin-left:4px;"><input type="checkbox" onchange="setCurrentProj(this)"> 現在</label>
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

module.exports = router;
