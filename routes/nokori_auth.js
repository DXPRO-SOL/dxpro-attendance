// routes/nokori_auth.js  – NOKORIサイト認証（会員登録・ログイン・PW再設定）
"use strict";
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { getDemoModels, seedDemoData } = require("../lib/demoDb");
const {
  NokoriMember, NokoriPlan, NokoriOption,
  NokoriApplication, NokoriPasswordReset, NokoriDemoAccount,
  User, Employee,
} = require("../models");
const { sendMail } = require("../config/mailer");
const { page } = require("../lib/nokoriLayout");

// ── ヘルパー ──────────────────────────────────────────────────
function getMember(req) {
  return req.session && req.session.nokoriMember ? req.session.nokoriMember : null;
}

// ══════════════════════════════════════════════════════════════
// 7. ログイン
// ══════════════════════════════════════════════════════════════
router.get("/nokori/login", (req, res) => {
  if (getMember(req)) return res.redirect("/nokori/mypage");
  const err = req.query.err;
  const errMsg = {
    invalid: "メールアドレスまたはパスワードが正しくありません。",
    suspended: "このアカウントは停止されています。",
  }[err] || "";
  const body = `
<div class="nk-form-page">
  <div class="nk-form-box">
    <h1>ログイン</h1>
    <p class="nk-form-sub">NOKORIマイページへアクセス</p>
    ${errMsg ? `<div class="nk-alert nk-alert-error">${errMsg}</div>` : ""}
    ${req.query.registered === "1" ? '<div class="nk-alert nk-alert-success">✅ 会員登録が完了しました！ログインしてご利用ください。</div>' : ""}
    ${req.query.reset === "1" ? '<div class="nk-alert nk-alert-success">✅ パスワードを再設定しました。ログインしてください。</div>' : ""}
    <form method="POST" action="/nokori/login">
      <div class="nk-field"><label>メールアドレス</label><input type="email" name="email" required placeholder="you@company.com" autofocus></div>
      <div class="nk-field"><label>パスワード</label><input type="password" name="password" required placeholder="••••••••"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
        <input type="checkbox" name="remember" id="remember" value="1">
        <label for="remember" style="font-size:14px;color:#64748b;cursor:pointer;">ログイン状態を保持する</label>
      </div>
      <button type="submit" class="nk-submit-btn">ログイン</button>
    </form>
    <div class="nk-divider"><span>または</span></div>
    <div style="text-align:center;font-size:14px;color:#64748b;">
      <a href="/nokori/password-reset" style="color:#0f4c81;">パスワードをお忘れの方</a>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:14px;color:#64748b;">
      アカウントをお持ちでない方は
      <a href="/nokori/register" style="color:#0f4c81;font-weight:600;">無料会員登録</a>
    </div>
  </div>
</div>`;
  res.send(page("ログイン", body));
});

router.post("/nokori/login", async (req, res) => {
  try {
    const { email, password, remember } = req.body;
    const member = await NokoriMember.findOne({ email: email.toLowerCase().trim() }).lean();
    if (!member) return res.redirect("/nokori/login?err=invalid");
    if (member.status === "suspended") return res.redirect("/nokori/login?err=suspended");
    const ok = await bcrypt.compare(password, member.password);
    if (!ok) return res.redirect("/nokori/login?err=invalid");
    req.session.nokoriMember = {
      _id: member._id.toString(),
      email: member.email,
      name: member.name,
      company: member.company,
      department: member.department,
      phone: member.phone,
      status: member.status,
    };
    if (remember === "1") req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    res.redirect("/nokori/mypage");
  } catch (e) {
    console.error("nokori login error:", e);
    res.redirect("/nokori/login?err=invalid");
  }
});

// ══════════════════════════════════════════════════════════════
// ログアウト
// ══════════════════════════════════════════════════════════════
router.get("/nokori/logout", (req, res) => {
  delete req.session.nokoriMember;
  res.redirect("/nokori/login");
});

// ══════════════════════════════════════════════════════════════
// 6. 会員登録（4ステップ）
// ══════════════════════════════════════════════════════════════
function stepsHtml(active) {
  const steps = ["利用規約同意", "会員情報入力", "サービス選択", "申請完了"];
  return `<div class="nk-steps">
    ${steps.map((s, i) => `<div class="nk-step ${i + 1 === active ? "active" : i + 1 < active ? "done" : ""}">
      <div class="nk-step-num">${i + 1 < active ? "✓" : i + 1}</div>
      <div class="nk-step-label">STEP${i + 1}<br>${s}</div>
    </div>`).join("")}
  </div>`;
}

// STEP1: 利用規約
router.get("/nokori/register", (req, res) => {
  if (getMember(req)) return res.redirect("/nokori/mypage");
  const body = `
<div class="nk-form-page" style="align-items:flex-start;padding-top:60px;">
  <div class="nk-form-box" style="max-width:640px;">
    <h1>会員登録</h1>
    <p class="nk-form-sub">NOKORIを無料でお試しください</p>
    ${stepsHtml(1)}
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;">利用規約をご確認ください</h3>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;height:240px;overflow-y:auto;font-size:13px;color:#374151;line-height:1.8;margin-bottom:20px;">
      <p><strong>第1条（適用）</strong><br>本規約は、NOKORIサービスの利用条件を定めるものです。</p>
      <p style="margin-top:12px;"><strong>第2条（利用登録）</strong><br>登録希望者は、本規約に同意の上、当社の定める方法により利用登録の申請を行うものとします。</p>
      <p style="margin-top:12px;"><strong>第3条（禁止事項）</strong><br>利用者は、法令または公序良俗に違反する行為、犯罪行為に関連する行為、その他当社サービスの運営を妨害するおそれのある行為をしてはなりません。</p>
      <p style="margin-top:12px;"><strong>第4条（免責事項）</strong><br>当社は、本サービスに事実上または法律上の瑕疵がないことを保証しておりません。</p>
      <p style="margin-top:12px;"><strong>第5条（準拠法・裁判管轄）</strong><br>本規約の解釈にあたっては、日本法を準拠法とします。</p>
    </div>
    <form method="POST" action="/nokori/register/step1">
      <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;margin-bottom:24px;">
        <input type="checkbox" name="agreed" required>
        <span>利用規約に同意します</span>
      </label>
      <button type="submit" class="nk-submit-btn">同意して次へ →</button>
    </form>
    <div style="text-align:center;margin-top:20px;font-size:14px;color:#64748b;">
      すでにアカウントをお持ちの方は <a href="/nokori/login" style="color:#0f4c81;font-weight:600;">ログイン</a>
    </div>
  </div>
</div>`;
  res.send(page("会員登録", body));
});

router.post("/nokori/register/step1", (req, res) => {
  if (!req.body.agreed) return res.redirect("/nokori/register");
  req.session.nokoriRegStep1 = { agreedAt: new Date().toISOString() };
  res.redirect("/nokori/register/step2");
});

// STEP2: 会員情報入力
router.get("/nokori/register/step2", (req, res) => {
  if (!req.session.nokoriRegStep1) return res.redirect("/nokori/register");
  const err = req.query.err;
  const errMsg = { dup: "このメールアドレスは既に登録されています。", pw: "パスワードが一致しません。" }[err] || "";
  const prev = req.session.nokoriRegStep2 || {};
  const body = `
<div class="nk-form-page" style="align-items:flex-start;padding-top:60px;">
  <div class="nk-form-box" style="max-width:560px;">
    <h1>会員登録</h1>
    <p class="nk-form-sub">会員情報を入力してください</p>
    ${stepsHtml(2)}
    ${errMsg ? `<div class="nk-alert nk-alert-error">${errMsg}</div>` : ""}
    <form method="POST" action="/nokori/register/step2">
      <div class="nk-field"><label>お名前 <span style="color:red">*</span></label><input type="text" name="name" required value="${prev.name||""}" placeholder="山田 太郎"></div>
      <div class="nk-field"><label>会社名</label><input type="text" name="company" value="${prev.company||""}" placeholder="株式会社〇〇"></div>
      <div class="nk-field"><label>部署名</label><input type="text" name="department" value="${prev.department||""}" placeholder="人事部"></div>
      <div class="nk-field"><label>メールアドレス <span style="color:red">*</span></label><input type="email" name="email" required value="${prev.email||""}" placeholder="you@company.com"></div>
      <div class="nk-field"><label>電話番号</label><input type="tel" name="phone" value="${prev.phone||""}" placeholder="03-1234-5678"></div>
      <div class="nk-field"><label>パスワード <span style="color:red">*</span></label><input type="password" name="password" required minlength="8" placeholder="8文字以上"></div>
      <div class="nk-field"><label>パスワード（確認） <span style="color:red">*</span></label><input type="password" name="passwordConfirm" required minlength="8" placeholder="同じパスワードを入力"></div>
      <button type="submit" class="nk-submit-btn">次へ →</button>
    </form>
  </div>
</div>`;
  res.send(page("会員登録 - 情報入力", body));
});

router.post("/nokori/register/step2", async (req, res) => {
  const { name, company, department, email, phone, password, passwordConfirm } = req.body;
  if (password !== passwordConfirm) {
    req.session.nokoriRegStep2 = { name, company, department, email, phone };
    return res.redirect("/nokori/register/step2?err=pw");
  }
  const exists = await NokoriMember.findOne({ email: email.toLowerCase().trim() }).lean();
  if (exists) {
    req.session.nokoriRegStep2 = { name, company, department, email, phone };
    return res.redirect("/nokori/register/step2?err=dup");
  }
  req.session.nokoriRegStep2 = { name, company, department, email, phone, password };
  res.redirect("/nokori/register/step3");
});

// STEP3: サービス選択
router.get("/nokori/register/step3", async (req, res) => {
  if (!req.session.nokoriRegStep2) return res.redirect("/nokori/register");
  let plans = await NokoriPlan.find({ isActive: true }).sort({ order: 1 }).lean();
  const options = await NokoriOption.find({ isActive: true }).sort({ order: 1 }).lean();
  if (plans.length === 0) {
    plans = [
      { _id: null, name: "スタータープラン（10名まで）", monthlyFee: 3980, initialFee: 0, description: "小規模チーム向け", isPopular: false },
      { _id: null, name: "スタンダードプラン（50名まで）", monthlyFee: 9800, initialFee: 50000, description: "中規模企業向け", isPopular: true },
      { _id: null, name: "プロフェッショナル（無制限）", monthlyFee: 29800, initialFee: 100000, description: "大規模企業向け", isPopular: false },
    ];
  }
  const body = `
<div class="nk-form-page" style="align-items:flex-start;padding-top:60px;">
  <div class="nk-form-box" style="max-width:640px;">
    <h1>会員登録</h1>
    <p class="nk-form-sub">ご利用サービスを選択してください</p>
    ${stepsHtml(3)}
    <form method="POST" action="/nokori/register/step3">
      <div class="nk-field">
        <label>プラン選択 <span style="color:red">*</span></label>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;">
          ${plans.map((p, i) => `
            <label style="border:1.5px solid #d1d5db;border-radius:10px;padding:16px;cursor:pointer;display:flex;align-items:flex-start;gap:12px;transition:border-color .2s;" class="plan-opt">
              <input type="radio" name="planId" value="${p._id||""}" ${i===0?"checked":""} style="margin-top:3px;">
              <div>
                <div style="font-weight:700;font-size:15px;">${p.name}${p.isPopular?' <span style="background:#0f4c81;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;vertical-align:middle;">人気</span>':""}</div>
                <div style="font-size:13px;color:#64748b;margin-top:2px;">${p.description} | 月額 ¥${Number(p.monthlyFee).toLocaleString()}</div>
              </div>
            </label>`).join("")}
        </div>
      </div>
      ${options.length > 0 ? `
      <div class="nk-field" style="margin-top:20px;">
        <label>オプション（任意）</label>
        <div style="border:1.5px solid #d1d5db;border-radius:8px;padding:12px 16px;margin-top:8px;">
          ${options.map(o=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;"><input type="checkbox" name="optionIds" value="${o._id}"><span style="font-size:14px;">${o.name} <span style="color:#64748b;font-size:13px;">(+¥${Number(o.monthlyFee).toLocaleString()}/月)</span></span></label>`).join("")}
        </div>
      </div>` : ""}
      <button type="submit" class="nk-submit-btn" style="margin-top:24px;">申請する →</button>
    </form>
  </div>
</div>
<style>.plan-opt:has(input:checked){border-color:#0f4c81;background:#f0f7ff;}</style>`;
  res.send(page("会員登録 - サービス選択", body));
});

router.post("/nokori/register/step3", async (req, res) => {
  try {
    const step2 = req.session.nokoriRegStep2;
    const step1 = req.session.nokoriRegStep1;
    if (!step2 || !step1) return res.redirect("/nokori/register");

    const { name, company, department, email, phone, password } = step2;
    const { planId, optionIds } = req.body;
    const optIds = optionIds ? (Array.isArray(optionIds) ? optionIds : [optionIds]) : [];

    const hashedPassword = await bcrypt.hash(password, 10);
    const member = await NokoriMember.create({
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      name, company, department, phone,
      status: "pending",
      agreedToTermsAt: new Date(step1.agreedAt),
      selectedPlanId: planId || null,
      selectedOptions: optIds.filter(Boolean),
    });

    // 申請レコード作成
    await NokoriApplication.create({
      memberId: member._id,
      planId: planId || null,
      optionIds: optIds.filter(Boolean),
    });

    // メール送信
    try {
      await sendMail({
        to: email,
        subject: "【NOKORI】会員登録・加入申請を受け付けました",
        text: `${name} 様\n\nNOKORIへの会員登録ありがとうございます。\n\n加入申請を受け付けました。\n担当者が内容を確認し、3営業日以内にご連絡いたします。\n\nご登録情報:\n氏名: ${name}\n会社名: ${company}\nメール: ${email}\n\n--\nNOKORI チーム`,
      });
      if (process.env.ADMIN_EMAIL) {
        await sendMail({
          to: process.env.ADMIN_EMAIL,
          subject: `【NOKORI管理】新規会員登録: ${name} (${company})`,
          text: `新しい会員登録がありました。\n\n氏名: ${name}\n会社: ${company}\n部署: ${department}\nメール: ${email}\n電話: ${phone}\nプランID: ${planId}`,
        });
      }
    } catch (mailErr) { console.error("register mail error:", mailErr.message); }

    // セッションクリア
    delete req.session.nokoriRegStep1;
    delete req.session.nokoriRegStep2;

    // ログイン状態にする
    req.session.nokoriMember = {
      _id: member._id.toString(),
      email: member.email,
      name: member.name,
      company: member.company,
      department: member.department,
      phone: member.phone,
      status: member.status,
    };

    res.redirect("/nokori/register/complete");
  } catch (e) {
    console.error("register step3 error:", e);
    res.redirect("/nokori/register?err=1");
  }
});

// STEP4: 申請完了
router.get("/nokori/register/complete", (req, res) => {
  const member = getMember(req);
  const body = `
<div class="nk-form-page">
  <div class="nk-form-box" style="max-width:560px;text-align:center;">
    <h1>会員登録</h1>
    <p class="nk-form-sub">申請が完了しました</p>
    ${stepsHtml(4)}
    <div style="font-size:64px;margin:16px 0;">🎉</div>
    <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:12px;">加入申請が完了しました！</h2>
    <p style="color:#64748b;line-height:1.8;margin-bottom:24px;">ご登録のメールアドレスへ確認メールをお送りしました。<br>担当者が内容を確認し、3営業日以内にご連絡いたします。</p>
    ${member ? `<a href="/nokori/mypage" class="nk-submit-btn" style="display:block;text-align:center;padding:13px;">マイページへ →</a>` : `<a href="/nokori/login" class="nk-submit-btn" style="display:block;text-align:center;padding:13px;">ログインする →</a>`}
    <div style="margin-top:16px;"><a href="/nokori" style="font-size:14px;color:#64748b;">TOPページへ戻る</a></div>
  </div>
</div>`;
  res.send(page("申請完了", body, { member }));
});

// ══════════════════════════════════════════════════════════════
// 8. パスワード再発行
// ══════════════════════════════════════════════════════════════
router.get("/nokori/password-reset", (req, res) => {
  const body = `
<div class="nk-form-page">
  <div class="nk-form-box">
    <h1>パスワード再設定</h1>
    <p class="nk-form-sub">登録済みのメールアドレスに再設定リンクを送信します</p>
    ${req.query.sent === "1" ? '<div class="nk-alert nk-alert-success">✅ メールを送信しました。受信トレイをご確認ください。</div>' : ""}
    <form method="POST" action="/nokori/password-reset">
      <div class="nk-field"><label>メールアドレス</label><input type="email" name="email" required placeholder="you@company.com" autofocus></div>
      <button type="submit" class="nk-submit-btn">送信する</button>
    </form>
    <div style="text-align:center;margin-top:20px;font-size:14px;color:#64748b;">
      <a href="/nokori/login" style="color:#0f4c81;">ログインページへ戻る</a>
    </div>
  </div>
</div>`;
  res.send(page("パスワード再設定", body));
});

router.post("/nokori/password-reset", async (req, res) => {
  try {
    const { email } = req.body;
    const member = await NokoriMember.findOne({ email: email.toLowerCase().trim() }).lean();
    if (member) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1時間
      await NokoriPasswordReset.create({ email: email.toLowerCase().trim(), token, expiresAt });
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
      const resetUrl = `${baseUrl}/nokori/password-reset/${token}`;
      try {
        await sendMail({
          to: email,
          subject: "【NOKORI】パスワード再設定",
          text: `パスワードの再設定リクエストを受け付けました。\n\n以下のリンクから1時間以内にパスワードを再設定してください。\n\n${resetUrl}\n\nこのリンクに心当たりがない場合は無視してください。\n\n--\nNOKORI チーム`,
        });
      } catch (e) { console.error("pw reset mail:", e.message); }
    }
    res.redirect("/nokori/password-reset?sent=1");
  } catch (e) {
    res.redirect("/nokori/password-reset?sent=1");
  }
});

router.get("/nokori/password-reset/:token", async (req, res) => {
  const record = await NokoriPasswordReset.findOne({
    token: req.params.token,
    expiresAt: { $gt: new Date() },
    usedAt: null,
  }).lean();
  if (!record) {
    const body = `<div class="nk-form-page"><div class="nk-form-box"><div class="nk-alert nk-alert-error">リンクが無効または期限切れです。</div><div style="text-align:center;"><a href="/nokori/password-reset" style="color:#0f4c81;">再度お試しください</a></div></div></div>`;
    return res.send(page("パスワード再設定", body));
  }
  const body = `
<div class="nk-form-page">
  <div class="nk-form-box">
    <h1>新しいパスワードを設定</h1>
    ${req.query.err === "pw" ? '<div class="nk-alert nk-alert-error">パスワードが一致しません。</div>' : ""}
    <form method="POST" action="/nokori/password-reset/${req.params.token}">
      <div class="nk-field"><label>新しいパスワード</label><input type="password" name="password" required minlength="8" placeholder="8文字以上"></div>
      <div class="nk-field"><label>新しいパスワード（確認）</label><input type="password" name="passwordConfirm" required minlength="8"></div>
      <button type="submit" class="nk-submit-btn">パスワードを変更する</button>
    </form>
  </div>
</div>`;
  res.send(page("新しいパスワードを設定", body));
});

router.post("/nokori/password-reset/:token", async (req, res) => {
  const { password, passwordConfirm } = req.body;
  if (password !== passwordConfirm) return res.redirect(`/nokori/password-reset/${req.params.token}?err=pw`);
  try {
    const record = await NokoriPasswordReset.findOne({
      token: req.params.token,
      expiresAt: { $gt: new Date() },
      usedAt: null,
    });
    if (!record) return res.redirect("/nokori/password-reset?err=expired");
    const hashed = await bcrypt.hash(password, 10);
    await NokoriMember.updateOne({ email: record.email }, { password: hashed, updatedAt: new Date() });
    record.usedAt = new Date();
    await record.save();
    try {
      await sendMail({ to: record.email, subject: "【NOKORI】パスワードを再設定しました", text: "パスワードの再設定が完了しました。\n\nご自身での操作でない場合は、すぐにサポートへご連絡ください。\n\n--\nNOKORI チーム" });
    } catch (e) { console.error("pw reset done mail:", e.message); }
    res.redirect("/nokori/login?reset=1");
  } catch (e) {
    console.error("pw reset error:", e);
    res.redirect("/nokori/password-reset");
  }
});

// ══════════════════════════════════════════════════════════════
// デモアカウントログイン
// ══════════════════════════════════════════════════════════════
router.post("/nokori/demo-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // デモアカウント認証（常にメインDB）
    const demo = await NokoriDemoAccount.findOne({ email, isActive: true }).lean();
    if (!demo) return res.redirect("/nokori/demo?error=1");
    if (demo.expiresAt && new Date() > demo.expiresAt) return res.redirect("/nokori/demo?expired=1");
    const ok = await bcrypt.compare(password, demo.password);
    if (!ok) return res.redirect("/nokori/demo?error=1");

    // メインDBにセッション用 User を取得 or 作成（認証情報の保持のみに使用）
    const demoUsername = `demo_${demo._id}`;
    let demoUser = await User.findOne({ username: demoUsername }).lean();
    if (!demoUser) {
      const dummyHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      demoUser = await User.create({
        username: demoUsername,
        password: dummyHash,
        isAdmin: false,
        role: "employee",
        preferredLang: "ja",
        displayName: demo.name || "デモユーザー",
      });
    }

    // ── デモDB 専用データベースにサンプルデータを投入 ───────────────────
    // 初回ログイン時のみ実行。以降はキャッシュで即座に返る。
    // デモユーザーの全データはメインDBとは完全に分離される。
    await seedDemoData(demo._id, demoUser._id, {
      name:           demo.name,
      email:          demo.email,
      demoAccountId:  demo._id,
    });

    // ── セッションをセット ─────────────────────────────────────────────
    req.session.userId         = demoUser._id;
    req.session.isAdmin        = false;
    req.session.username       = demoUsername;
    req.session.orgRole        = "employee";
    req.session.lang           = "ja";
    req.session.isDemo         = true;             // デモフラグ
    req.session.demoAccountId  = demo._id.toString(); // デモDB切り替えキー
    req.session.nokoriDemo     = { email: demo.email, name: demo.name, expiresAt: demo.expiresAt };

    console.log(`デモログイン成功: ${demo.email} → DB: nokori-demo-${demo._id}`);
    res.redirect("/dashboard");
  } catch (e) {
    console.error("demo login:", e);
    res.redirect("/nokori/demo?error=1");
  }
});

module.exports = router;
