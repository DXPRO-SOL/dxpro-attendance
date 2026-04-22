function requireLogin(req, res, next) {
    if (!req.session.userId) {
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
    res.status(403).send('管理者権限が必要です');
}

// Issue #19: 中間ロール対応ミドルウェア
// 'admin' | 'manager' | 'team_leader' | 'employee'
const ROLE_LEVEL = { admin: 4, manager: 3, team_leader: 2, employee: 1 };

function requireRole(...roles) {
    return function (req, res, next) {
        if (!req.session.userId) return res.redirect('/login');
        const userRole = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
        if (req.session.isAdmin || roles.includes(userRole)) return next();
        // ロールレベルで判定
        const userLevel = ROLE_LEVEL[userRole] || 1;
        const minRequired = Math.min(...roles.map(r => ROLE_LEVEL[r] || 1));
        if (userLevel >= minRequired) return next();
        res.status(403).send('この操作には権限が必要です（必要ロール: ' + roles.join(', ') + '）');
    };
}

// 部門長以上（manager or admin）
function isManagerOrAdmin(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    const role = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
    if (req.session.isAdmin || role === 'admin' || role === 'manager') return next();
    res.status(403).send('部門長以上の権限が必要です');
}

// チームリーダー以上
function isLeaderOrAbove(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    const role = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
    if (req.session.isAdmin || ROLE_LEVEL[role] >= ROLE_LEVEL['team_leader']) return next();
    res.status(403).send('チームリーダー以上の権限が必要です');
}

// テストユーザーを書き込み操作からブロック
function blockTestUser(req, res, next) {
    if (req.session.isTestUser) {
        return res.status(403).json({ error: 'テストユーザーはこの操作を実行できません' });
    }
    next();
}

module.exports = { requireLogin, isAdmin, requireRole, isManagerOrAdmin, isLeaderOrAbove, blockTestUser, ROLE_LEVEL };
