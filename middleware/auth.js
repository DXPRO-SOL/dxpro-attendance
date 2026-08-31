function wantsJson(req) {
    const accept = (req.headers && req.headers.accept) ? String(req.headers.accept) : '';
    const xrw = (req.headers && req.headers['x-requested-with']) ? String(req.headers['x-requested-with']) : '';
    // API path or XHR or explicit JSON accept
    return req.path && req.path.startsWith('/api/') || req.xhr || xrw.toLowerCase() === 'xmlhttprequest' || accept.includes('application/json');
}

// アクセス拒否・権限エラーを専用のアラート画面として表示する
function sendAccessDenied(req, res, message, options = {}) {
    if (wantsJson(req)) {
        return res.status(403).json({ error: message });
    }
    const { renderErrorPage } = require('../lib/renderPage');
    return renderErrorPage(req, res, {
        statusCode: 403,
        icon: 'fa-lock',
        title: 'アクセス権限がありません',
        message,
        backHref: options.backHref || '/dashboard',
        backLabel: options.backLabel || 'ダッシュボードに戻る',
    });
}

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        if (wantsJson(req)) return res.status(401).json({ error: '認証が必要です' });
        return res.redirect('/login');
    }
    next();
}

function isAdmin(req, res, next) {
    console.log('管理者権限確認:', {
        userId: req.session.userId,
        isAdmin: req.session.isAdmin,
        username: req.session.username
    });
    if (req.session.isAdmin) {
        return next();
    }
    return sendAccessDenied(req, res, '管理者権限が必要です');
}

// Issue #19: 中間ロール対応ミドルウェア
// 'admin' | 'manager' | 'team_leader' | 'employee'
const ROLE_LEVEL = { admin: 4, manager: 3, team_leader: 2, employee: 1 };

function requireRole(...roles) {
    return function (req, res, next) {
        if (!req.session.userId) {
            if (wantsJson(req)) return res.status(401).json({ error: '認証が必要です' });
            return res.redirect('/login');
        }
        const userRole = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
        if (req.session.isAdmin || roles.includes(userRole)) return next();
        // ロールレベルで判定
        const userLevel = ROLE_LEVEL[userRole] || 1;
        const minRequired = Math.min(...roles.map(r => ROLE_LEVEL[r] || 1));
        if (userLevel >= minRequired) return next();
        return sendAccessDenied(req, res, 'この操作には権限が必要です（必要ロール: ' + roles.join(', ') + '）');
    };
}

// 部門長以上（manager or admin）
function isManagerOrAdmin(req, res, next) {
    if (!req.session.userId) {
        if (wantsJson(req)) return res.status(401).json({ error: '認証が必要です' });
        return res.redirect('/login');
    }
    const role = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
    if (req.session.isAdmin || role === 'admin' || role === 'manager') return next();
    return sendAccessDenied(req, res, '部門長以上の権限が必要です');
}

// チームリーダー以上
function isLeaderOrAbove(req, res, next) {
    if (!req.session.userId) {
        if (wantsJson(req)) return res.status(401).json({ error: '認証が必要です' });
        return res.redirect('/login');
    }
    const role = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
    if (req.session.isAdmin || ROLE_LEVEL[role] >= ROLE_LEVEL['team_leader']) return next();
    return sendAccessDenied(req, res, 'チームリーダー以上の権限が必要です');
}

// テストユーザーを書き込み操作からブロック
function blockTestUser(req, res, next) {
    if (req.session.isTestUser) {
        return res.status(403).json({ error: 'テストユーザーはこの操作を実行できません' });
    }
    next();
}

module.exports = { requireLogin, isAdmin, requireRole, isManagerOrAdmin, isLeaderOrAbove, blockTestUser, ROLE_LEVEL };

