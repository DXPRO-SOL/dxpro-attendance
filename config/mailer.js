const nodemailer = require('nodemailer');

const rawApiKey = process.env.SENDGRID_API_KEY || '';
const useSendGrid = typeof rawApiKey === 'string' && rawApiKey.startsWith('SG.');
const useBrevoApiKey = typeof rawApiKey === 'string' && rawApiKey.startsWith('xkeysib-');

let sgMail = null;
if (useSendGrid) {
    try {
        sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(rawApiKey);
        console.log('メール送信: SendGrid を使用します');
    } catch (e) {
        console.warn('SendGrid モジュール初期化エラー:', e.message);
        sgMail = null;
    }
} else if (useBrevoApiKey) {
    console.log('メール送信: Brevo APIキーが設定されています（SMTP/RESTどちらでも利用可）。SMTP情報を優先します。');
} else {
    console.log('メール送信: SendGrid/Brevo の API キーが見つかりません。SMTP フォールバックを使用します。');
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendMail({ to, from, subject, text, html, attachments } = {}) {
    const msg = { to, from, subject, text, html, attachments };
    try {
        if (useSendGrid && sgMail) {
            await sgMail.send(msg);
            console.log('SendGrid: メール送信成功', to);
            return;
        }
        if (useBrevoApiKey) {
            try {
                const https = require('https');
                const senderEmail = from || process.env.MAIL_FROM || process.env.EMAIL_USER || 'info@dxpro-sol.com';
                const body = JSON.stringify({
                    sender: { email: senderEmail },
                    to: [{ email: to }],
                    subject: subject,
                    htmlContent: html || text,
                    textContent: text
                });
                await new Promise((resolve, reject) => {
                    const req = https.request({
                        hostname: 'api.brevo.com',
                        path: '/v3/smtp/email',
                        method: 'POST',
                        headers: {
                            'accept': 'application/json',
                            'api-key': rawApiKey,
                            'content-type': 'application/json',
                            'content-length': Buffer.byteLength(body)
                        }
                    }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                resolve(data);
                            } else {
                                reject(new Error(`Brevo API エラー: ${res.statusCode} ${data}`));
                            }
                        });
                    });
                    req.on('error', reject);
                    req.write(body);
                    req.end();
                });
                console.log('Brevo REST API: メール送信成功', to);
                return;
            } catch (brevoErr) {
                console.warn('Brevo REST送信エラー、SMTPへフォールバックします:', brevoErr && (brevoErr.response || brevoErr.message) || brevoErr);
            }
        }
        const smtpFrom = from || process.env.MAIL_FROM || process.env.EMAIL_USER || 'info@dxpro-sol.com';
        const info = await transporter.sendMail({ from: smtpFrom, to, subject, text, html, attachments });
        console.log('SMTP: メール送信成功', to, 'messageId=', info && info.messageId, 'response=', info && info.response);
    } catch (err) {
        console.error('メール送信エラー:', err && (err.response || err.message) || err);
        throw err;
    }
}

module.exports = { sendMail, transporter };
