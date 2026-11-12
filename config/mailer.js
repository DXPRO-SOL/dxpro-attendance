const nodemailer = require('nodemailer');
const https = require('https');

// --- サービス判定 ---
const resendApiKey = process.env.RESEND_API_KEY || '';
const useResend = resendApiKey.startsWith('re_');

const rawApiKey = process.env.SENDGRID_API_KEY || '';
const useSendGrid = rawApiKey.startsWith('SG.');
const useBrevoApiKey = rawApiKey.startsWith('xkeysib-');

if (useResend) {
    const hasVerifiedDomain = (process.env.RESEND_VERIFIED_DOMAINS || '').trim().length > 0;
    if (hasVerifiedDomain) {
        console.log('メール送信: Resend を使用します（ドメイン認証済み）');
    } else {
        console.log('メール送信: Resend は未認証のため SMTP にフォールバックします');
    }
} else if (useSendGrid) {
    console.log('メール送信: SendGrid を使用します');
} else if (useBrevoApiKey) {
    console.log('メール送信: Brevo REST API を使用します（IP制限が無効化されている必要があります）');
} else {
    console.log('メール送信: SMTP を使用します');
}

// SMTP transporter（フォールバック用）
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    // 一時的なネットワーク断・応答遅延による誤送信失敗を減らすための設定
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
});

// --- HTTPSでREST APIを呼び出す共通関数 ---
function httpsPost(hostname, path, headers, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const req = https.request({
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`API エラー ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

async function sendMail({ to, from, subject, text, html, attachments } = {}) {
    const senderEmail = from || process.env.MAIL_FROM || process.env.EMAIL_USER || 'info@dxpro-sol.com';

    // 1) Resend（ドメイン認証済みの場合のみ使用）
    if (useResend) {
        const resendFromEnv = process.env.RESEND_FROM || '';
        const verifiedDomains = (process.env.RESEND_VERIFIED_DOMAINS || '').split(',').map(d => d.trim()).filter(Boolean);
        let resendFrom = null;
        if (resendFromEnv && verifiedDomains.length > 0) {
            const fromDomain = resendFromEnv.split('@')[1] || '';
            if (verifiedDomains.includes(fromDomain)) {
                resendFrom = resendFromEnv;
            }
        }

        if (resendFrom) {
            // ドメイン認証済み → Resend で任意のアドレスに送信可能
            await httpsPost('api.resend.com', '/emails', {
                'Authorization': `Bearer ${resendApiKey}`
            }, {
                from: resendFrom,
                to: [to],
                subject,
                html: html || text,
                text,
                ...(attachments && attachments.length > 0 ? {
                    attachments: attachments.map(a => ({
                        filename: a.filename,
                        content: Buffer.isBuffer(a.content)
                            ? a.content.toString('base64')
                            : Buffer.from(a.content).toString('base64'),
                    }))
                } : {})
            });
            console.log('Resend: メール送信成功', to);
            return;
        }

        // ドメイン未認証 → Resend は登録アカウントのメールにしか送れないため SMTP にフォールバック
        console.log('Resend: ドメイン未認証のため SMTP にフォールバックします');
    }

    // 2) SendGrid
    if (useSendGrid) {
        try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(rawApiKey);
            await sgMail.send({ to, from: senderEmail, subject, text, html, attachments });
            console.log('SendGrid: メール送信成功', to);
            return;
        } catch (e) {
            console.error('SendGrid エラー:', e.message);
            throw e;
        }
    }

    // 3) Brevo REST API（※Brevoダッシュボードでip制限を無効化が必要）
    if (useBrevoApiKey) {
        await httpsPost('api.brevo.com', '/v3/smtp/email', {
            'api-key': rawApiKey,
            'accept': 'application/json'
        }, {
            sender: { email: senderEmail },
            to: [{ email: to }],
            subject,
            htmlContent: html || text,
            textContent: text
        });
        console.log('Brevo REST API: メール送信成功', to);
        return;
    }

    // 4) SMTP フォールバック（一時的な接続断の場合は1回だけ自動リトライ）
    const mailOptions = { from: senderEmail, to, subject, text, html, attachments };
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('SMTP: メール送信成功', to, 'messageId=', info && info.messageId);
        return;
    } catch (e) {
        const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION'];
        if (transientCodes.includes(e.code)) {
            console.warn('SMTP: 一時的なエラーのため再送信します', to, e.code);
            await new Promise((r) => setTimeout(r, 1500));
            const info = await transporter.sendMail(mailOptions);
            console.log('SMTP: メール送信成功（リトライ）', to, 'messageId=', info && info.messageId);
            return;
        }
        throw e;
    }
}

module.exports = { sendMail, transporter };
