// ==============================
// routes/chat.js - チャット機能 全面改版
// DM・グループチャット・ファイル添付・メッセージ編集・既読表示
// ==============================
'use strict';

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const mongoose  = require('mongoose');
const { requireLogin } = require('../middleware/auth');
const { User, Employee, ChatMessage, ChatRoom } = require('../models');
const { renderPage } = require('../lib/renderPage');

const UPLOAD_DIR = path.join(__dirname, '../uploads/chat');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const chatUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
        filename: (_req, file, cb) =>
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|txt|zip|csv|mp4|mov|mp3)$/.test(ext));
    },
});

const oid = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return id; }
};

function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mimeToType(mime) {
    mime = mime || '';
    if (/^image\//.test(mime)) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (/^video\//.test(mime)) return 'video';
    return 'file';
}

const STATUS_CLS   = { online: 'pip-online', break: 'pip-break', offline: 'pip-offline' };
const STATUS_LABEL = { online: 'オンライン', break: '休憩中', offline: 'オフライン' };

// サイドバーデータ構築
async function buildSidebarData(myId) {
    const myOid = oid(myId);
    const [users, employees, recentAgg, unreadDMAgg, rooms] = await Promise.all([
        User.find({ _id: { $ne: myId } }).select('username chatStatus lastSeenAt').lean(),
        Employee.find({}).select('userId name department').lean(),
        ChatMessage.aggregate([
            { $match: { $or: [{ fromUserId: myOid }, { toUserId: myOid }], roomId: null } },
            { $sort: { createdAt: -1 } },
            { $addFields: { otherId: { $cond: [{ $eq: ['$fromUserId', myOid] }, '$toUserId', '$fromUserId'] } } },
            { $group: { _id: '$otherId', lastAt: { $first: '$createdAt' }, lastMsg: { $first: '$content' } } },
            { $sort: { lastAt: -1 } },
            { $limit: 30 },
        ]),
        ChatMessage.aggregate([
            { $match: { toUserId: myOid, read: false, roomId: null } },
            { $group: { _id: '$fromUserId', count: { $sum: 1 } } },
        ]),
        ChatRoom.find({ members: myId }).sort({ lastMessageAt: -1 }).lean(),
    ]);

    const empMap = {};
    employees.forEach(e => { empMap[String(e.userId)] = e; });
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = { ...u, emp: empMap[String(u._id)] || null }; });

    const unreadDM = {};
    unreadDMAgg.forEach(u => { unreadDM[String(u._id)] = u.count; });

    const recentDMs = recentAgg.map(r => {
        const u = userMap[String(r._id)];
        if (!u) return null;
        return { ...u, lastAt: r.lastAt, lastMsg: r.lastMsg, unread: unreadDM[String(r._id)] || 0 };
    }).filter(Boolean);

    let unreadRoomMap = {};
    if (rooms.length) {
        const roomUnread = await ChatMessage.aggregate([
            { $match: { roomId: { $in: rooms.map(r => oid(r._id)) }, fromUserId: { $ne: myOid }, deleted: { $ne: true } } },
            { $project: { roomId: 1, isRead: { $in: [myOid, { $ifNull: ['$readBy.userId', []] }] } } },
            { $match: { isRead: false } },
            { $group: { _id: '$roomId', count: { $sum: 1 } } },
        ]);
        roomUnread.forEach(r => { unreadRoomMap[String(r._id)] = r.count; });
    }

    return {
        allUsers:  Object.values(userMap),
        recentDMs,
        roomList: rooms.map(r => ({ ...r, unread: unreadRoomMap[String(r._id)] || 0 })),
    };
}

// ── ページルート ──────────────────────────────────────────────

router.get('/chat', requireLogin, async (req, res) => {
    try {
        const myId = req.session.userId;
        const myOid = oid(myId);

        // 最後に使った会話を探して自動リダイレクト（Slack/Teams方式）
        const [lastDM, lastRoom] = await Promise.all([
            ChatMessage.findOne({
                $or: [{ fromUserId: myOid }, { toUserId: myOid }],
                roomId: null,
            }).sort({ createdAt: -1 }).lean(),
            ChatRoom.findOne({ members: myId }).sort({ lastMessageAt: -1 }).lean(),
        ]);

        // DM と グループ の最新をそれぞれ比較して直近のほうへ飛ばす
        const dmTime   = lastDM   ? new Date(lastDM.createdAt).getTime()       : 0;
        const roomTime = lastRoom ? new Date(lastRoom.lastMessageAt).getTime()  : 0;

        if (dmTime === 0 && roomTime === 0) {
            // 会話がない場合のみホーム画面を表示
            const [[cu, myEmp], sideData] = await Promise.all([
                Promise.all([
                    User.findById(myId).select('chatStatus').lean(),
                    Employee.findOne({ userId: myId }).select('name').lean(),
                ]),
                buildSidebarData(myId),
            ]);
            const myName = myEmp ? myEmp.name : req.session.username;
            return renderPage(req, res, 'チャット', 'チャット', buildPage({
                mode: 'home', myId: String(myId), myName,
                myInitial: (myName || '?').charAt(0).toUpperCase(),
                myStatus: cu ? cu.chatStatus : 'offline',
                ...sideData,
            }));
        }

        if (dmTime >= roomTime && lastDM) {
            // 最後のDM相手を特定してリダイレクト
            const otherId = String(lastDM.fromUserId) === String(myId)
                ? lastDM.toUserId
                : lastDM.fromUserId;
            return res.redirect('/chat/dm/' + otherId);
        } else if (lastRoom) {
            return res.redirect('/chat/room/' + lastRoom._id);
        }

        return res.redirect('/chat');
    } catch (e) { console.error('[chat/home]', e); res.status(500).send('エラー'); }
});

router.get('/chat/dm/:userId', requireLogin, async (req, res) => {
    try {
        const myId     = req.session.userId;
        const targetId = req.params.userId;
        const [targetUser, targetEmp, myEmp, cu, sideData] = await Promise.all([
            User.findById(targetId).select('username chatStatus lastSeenAt').lean(),
            Employee.findOne({ userId: targetId }).select('name department position').lean(),
            Employee.findOne({ userId: myId }).select('name').lean(),
            User.findById(myId).select('chatStatus').lean(),
            buildSidebarData(myId),
        ]);
        if (!targetUser) return res.status(404).send('ユーザーが見つかりません');
        await ChatMessage.updateMany(
            { fromUserId: targetId, toUserId: myId, read: false },
            { $set: { read: true, readAt: new Date() } }
        );
        const messages = await ChatMessage.find({
            $or: [{ fromUserId: myId, toUserId: targetId }, { fromUserId: targetId, toUserId: myId }],
            roomId: null,
        }).sort({ createdAt: 1 }).limit(100).lean();
        const myName     = myEmp ? myEmp.name : req.session.username;
        const targetName = targetEmp ? targetEmp.name : targetUser.username;
        renderPage(req, res, `チャット - ${targetName}`, 'チャット', buildPage({
            mode: 'dm', myId: String(myId), myName,
            myInitial: (myName || '?').charAt(0).toUpperCase(),
            myStatus: cu ? cu.chatStatus : 'offline',
            targetId: String(targetId), targetName,
            targetStatus: targetUser.chatStatus || 'offline',
            targetDept: targetEmp ? (targetEmp.department || '') : '',
            targetPos:  targetEmp ? (targetEmp.position  || '') : '',
            messages, ...sideData,
        }));
    } catch (e) { console.error('[chat/dm]', e); res.status(500).send('エラー'); }
});

router.get('/chat/room/:roomId', requireLogin, async (req, res) => {
    try {
        const myId   = req.session.userId;
        const roomId = req.params.roomId;
        const room   = await ChatRoom.findOne({ _id: roomId, members: myId }).lean();
        if (!room) return res.status(404).send('ルームが見つかりません');
        await ChatMessage.updateMany(
            { roomId: room._id, fromUserId: { $ne: myId }, 'readBy.userId': { $ne: myId } },
            { $push: { readBy: { userId: myId, readAt: new Date() } } }
        );
        const [messages, myEmp, cu, sideData, memberUsers, memberEmps] = await Promise.all([
            ChatMessage.find({ roomId: room._id }).sort({ createdAt: 1 }).limit(100).lean(),
            Employee.findOne({ userId: myId }).select('name').lean(),
            User.findById(myId).select('chatStatus').lean(),
            buildSidebarData(myId),
            User.find({ _id: { $in: room.members } }).select('username chatStatus').lean(),
            Employee.find({ userId: { $in: room.members } }).select('userId name department').lean(),
        ]);
        const memEmpMap = {};
        memberEmps.forEach(e => { memEmpMap[String(e.userId)] = e; });
        const members = memberUsers.map(u => ({ ...u, emp: memEmpMap[String(u._id)] || null }));
        const myName  = myEmp ? myEmp.name : req.session.username;
        renderPage(req, res, `${room.name} - チャット`, 'チャット', buildPage({
            mode: 'room', myId: String(myId), myName,
            myInitial: (myName || '?').charAt(0).toUpperCase(),
            myStatus: cu ? cu.chatStatus : 'offline',
            roomId: String(room._id), roomName: room.name,
            roomIcon: room.icon || '💬', roomDesc: room.description || '',
            isRoomAdmin: room.admins.some(a => String(a) === String(myId)),
            members, messages, ...sideData,
        }));
    } catch (e) { console.error('[chat/room]', e); res.status(500).send('エラー'); }
});

// ── API ────────────────────────────────────────────────────────

// チャット未読件数（トップバーバッジ用）
router.get('/api/chat/unread-count', requireLogin, async (req, res) => {
    try {
        const myOid = oid(req.session.userId);
        const [dmCount, roomCount] = await Promise.all([
            ChatMessage.countDocuments({ toUserId: myOid, read: false, roomId: null, deleted: { $ne: true } }),
            ChatMessage.aggregate([
                { $match: { fromUserId: { $ne: myOid }, deleted: { $ne: true }, roomId: { $ne: null } } },
                { $match: { 'readBy.userId': { $ne: myOid } } },
                { $lookup: { from: 'chatrooms', localField: 'roomId', foreignField: '_id', as: 'room' } },
                { $match: { 'room.members': myOid } },
                { $count: 'n' },
            ]).then(r => (r[0] ? r[0].n : 0)),
        ]);
        res.json({ count: dmCount + roomCount });
    } catch (e) { res.json({ count: 0 }); }
});

router.post('/api/chat/status', requireLogin, async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
        const { status } = body;
        if (!['online', 'offline', 'break'].includes(status))
            return res.status(400).json({ error: '無効なステータス' });
        await User.findByIdAndUpdate(req.session.userId, { chatStatus: status, lastSeenAt: new Date() });
        req.session.chatStatus = status; // セッションにも保存してサイドバーに反映
        global.io && global.io.emit('status_change', { userId: String(req.session.userId), status });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/upload', requireLogin, chatUpload.array('files', 5), (req, res) => {
    try {
        const files = (req.files || []).map(f => ({
            name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
            url: '/uploads/chat/' + f.filename,
            mimeType: f.mimetype, size: f.size,
        }));
        res.json({ ok: true, files });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/send', requireLogin, async (req, res) => {
    try {
        const { toUserId, roomId, content, replyToId, attachments } = req.body;
        if (!toUserId && !roomId)
            return res.status(400).json({ error: 'toUserId か roomId が必要です' });
        if (!(content && content.trim()) && !(attachments && attachments.length))
            return res.status(400).json({ error: 'コンテンツが空です' });
        let replyPreview = null;
        if (replyToId) {
            const orig = await ChatMessage.findById(replyToId).select('content').lean();
            if (orig && !orig.deleted) replyPreview = (orig.content || '').slice(0, 80);
        }
        const msgData = {
            fromUserId: req.session.userId,
            content: (content && content.trim()) || '',
            replyTo: replyToId || null,
            replyPreview,
            attachments: attachments || [],
        };
        if (toUserId) msgData.toUserId = toUserId;
        if (roomId)   msgData.roomId   = roomId;
        const msg = await ChatMessage.create(msgData);
        const [senderEmp, senderUser] = await Promise.all([
            Employee.findOne({ userId: req.session.userId }).select('name').lean(),
            User.findById(req.session.userId).select('username').lean(),
        ]);
        const senderName = senderEmp ? senderEmp.name : ((senderUser && senderUser.username) || '');
        const payload = {
            _id: String(msg._id),
            fromUserId: String(req.session.userId),
            toUserId:  toUserId ? String(toUserId) : null,
            roomId:    roomId   ? String(roomId)   : null,
            content: msg.content,
            attachments: msg.attachments,
            replyTo: replyToId || null,
            replyPreview,
            createdAt: msg.createdAt,
            reactions: [],
            senderName,
        };
        if (toUserId && global.io) {
            global.io.to('u_' + String(toUserId))
                     .to('u_' + String(req.session.userId))
                     .emit('new_message', payload);
        }
        if (roomId && global.io) {
            global.io.to('r_' + String(roomId)).emit('new_message', payload);
            await ChatRoom.findByIdAndUpdate(roomId, { lastMessageAt: new Date() });
        }
        res.json({ ok: true, msg: payload });
    } catch (e) { console.error('[chat/send]', e); res.status(500).json({ error: e.message }); }
});

router.put('/api/chat/msg/:id', requireLogin, async (req, res) => {
    try {
        const { content } = req.body;
        if (!(content && content.trim())) return res.status(400).json({ error: '内容が空です' });
        const msg = await ChatMessage.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: '見つかりません' });
        if (String(msg.fromUserId) !== String(req.session.userId))
            return res.status(403).json({ error: '権限がありません' });
        msg.content = content.trim(); msg.edited = true; msg.editedAt = new Date();
        await msg.save();
        const payload = { _id: String(msg._id), content: msg.content, editedAt: msg.editedAt };
        if (msg.toUserId && global.io)
            global.io.to('u_' + String(msg.toUserId)).to('u_' + String(msg.fromUserId)).emit('msg_edited', payload);
        if (msg.roomId && global.io)
            global.io.to('r_' + String(msg.roomId)).emit('msg_edited', payload);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/chat/msg/:id', requireLogin, async (req, res) => {
    try {
        const msg = await ChatMessage.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: '見つかりません' });
        if (String(msg.fromUserId) !== String(req.session.userId))
            return res.status(403).json({ error: '権限がありません' });
        msg.deleted = true; msg.deletedAt = new Date();
        msg.content = '（このメッセージは削除されました）';
        await msg.save();
        const payload = { _id: String(msg._id) };
        if (msg.toUserId && global.io)
            global.io.to('u_' + String(msg.toUserId)).to('u_' + String(msg.fromUserId)).emit('msg_deleted', payload);
        if (msg.roomId && global.io)
            global.io.to('r_' + String(msg.roomId)).emit('msg_deleted', payload);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/react', requireLogin, async (req, res) => {
    try {
        const { msgId, emoji } = req.body;
        const msg = await ChatMessage.findById(msgId);
        if (!msg || msg.deleted) return res.status(404).json({ error: '見つかりません' });
        const uid = req.session.userId;
        let reaction = msg.reactions.find(r => r.emoji === emoji);
        if (reaction) {
            const idx = reaction.userIds.findIndex(id => String(id) === String(uid));
            if (idx >= 0) reaction.userIds.splice(idx, 1); else reaction.userIds.push(uid);
            if (reaction.userIds.length === 0) msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
        } else { msg.reactions.push({ emoji, userIds: [uid] }); }
        await msg.save();
        const reactions = msg.reactions.map(r => ({
            emoji: r.emoji, count: r.userIds.length,
            mine: r.userIds.some(id => String(id) === String(uid)),
        }));
        const payload = { _id: String(msgId), reactions };
        if (msg.toUserId && global.io)
            global.io.to('u_' + String(msg.toUserId)).to('u_' + String(msg.fromUserId)).emit('msg_reaction', payload);
        if (msg.roomId && global.io)
            global.io.to('r_' + String(msg.roomId)).emit('msg_reaction', payload);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/read', requireLogin, async (req, res) => {
    try {
        const { msgId } = req.body;
        const msg = await ChatMessage.findById(msgId);
        if (!msg) return res.json({ ok: false });
        const uid = req.session.userId;
        if (msg.roomId) {
            if (!msg.readBy.some(r => String(r.userId) === String(uid))) {
                msg.readBy.push({ userId: uid, readAt: new Date() });
                await msg.save();
                if (global.io) global.io.to('r_' + String(msg.roomId))
                    .emit('read_receipt', { msgId: String(msgId), userId: String(uid), count: msg.readBy.length });
            }
        } else if (String(msg.toUserId) === String(uid) && !msg.read) {
            msg.read = true; msg.readAt = new Date(); await msg.save();
            if (global.io) global.io.to('u_' + String(msg.fromUserId))
                .emit('read_receipt', { msgId: String(msgId), userId: String(uid) });
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/room', requireLogin, async (req, res) => {
    try {
        const { name, description, icon, memberIds } = req.body;
        if (!(name && name.trim())) return res.status(400).json({ error: '名前が必要です' });
        const members = [...new Set([String(req.session.userId), ...(memberIds || [])])];
        const room = await ChatRoom.create({
            name: name.trim(), description: (description && description.trim()) || '',
            icon: icon || '💬', members, admins: [req.session.userId], createdBy: req.session.userId,
        });
        if (global.io) members.forEach(mid =>
            global.io.to('u_' + mid).emit('room_created', { roomId: String(room._id), name: room.name, icon: room.icon }));
        res.json({ ok: true, roomId: String(room._id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/missed-call', requireLogin, async (req, res) => {
    try {
        const { toUserId } = req.body;
        if (!toUserId) return res.status(400).json({ error: 'toUserId が必要です' });
        const fromId = req.session.userId;
        // 不在着信をシステムメッセージとして両者のDMに保存
        const msg = await ChatMessage.create({
            fromUserId: fromId,
            toUserId,
            content: '📵 不在着信',
            attachments: [],
            isMissedCall: true,
        });
        const payload = {
            _id: String(msg._id),
            fromUserId: String(fromId),
            toUserId:   String(toUserId),
            roomId:     null,
            content:    msg.content,
            attachments: [],
            isMissedCall: true,
            createdAt:  msg.createdAt,
            reactions:  [],
            senderName: '',
        };
        // リアルタイムで両者に通知
        if (global.io) {
            global.io.to('u_' + String(toUserId)).emit('new_message', payload);
            global.io.to('u_' + String(fromId)).emit('new_message', payload);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 通話履歴（通話終了時に保存）
router.post('/api/chat/call-history', requireLogin, async (req, res) => {
    try {
        const { toUserId, duration } = req.body;   // duration は秒
        if (!toUserId) return res.status(400).json({ error: 'toUserId が必要です' });
        const fromId = req.session.userId;
        const mins = Math.floor((duration || 0) / 60);
        const secs = (duration || 0) % 60;
        const durStr = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
        const msg = await ChatMessage.create({
            fromUserId: fromId,
            toUserId,
            content: `📞 通話終了 — ${durStr}`,
            attachments: [],
            isCallHistory: true,
            callDuration: duration || 0,
        });
        const payload = {
            _id: String(msg._id),
            fromUserId: String(fromId),
            toUserId:   String(toUserId),
            roomId:     null,
            content:    msg.content,
            attachments: [],
            isCallHistory: true,
            callDuration:  duration || 0,
            createdAt:  msg.createdAt,
            reactions:  [],
            senderName: '',
        };
        if (global.io) {
            global.io.to('u_' + String(toUserId)).emit('new_message', payload);
            global.io.to('u_' + String(fromId)).emit('new_message', payload);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 録画ファイルアップロード → チャットメッセージとして保存
router.post('/api/chat/recording', requireLogin, chatUpload.single('recording'), async (req, res) => {
    try {
        const { toUserId, roomId } = req.body;
        if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
        const fromId = req.session.userId;
        const attachment = {
            name:     req.file.originalname || `recording_${Date.now()}.webm`,
            url:      '/uploads/chat/' + req.file.filename,
            mimeType: req.file.mimetype || 'video/webm',
            size:     req.file.size,
        };
        const msgData = {
            fromUserId:  fromId,
            attachments: [attachment],
            content:     '🎥 通話録画',
        };
        if (toUserId)  msgData.toUserId = toUserId;
        if (roomId)    msgData.roomId   = roomId;
        const msg = await ChatMessage.create(msgData);
        const payload = {
            _id:         String(msg._id),
            fromUserId:  String(fromId),
            toUserId:    toUserId  ? String(toUserId)  : null,
            roomId:      roomId    ? String(roomId)    : null,
            content:     msg.content,
            attachments: [attachment],
            createdAt:   msg.createdAt,
            reactions:   [],
            senderName:  '',
        };
        if (global.io) {
            if (toUserId) {
                global.io.to('u_' + String(toUserId)).emit('new_message', payload);
                global.io.to('u_' + String(fromId)).emit('new_message', payload);
            }
            if (roomId) global.io.to('r_' + roomId).emit('new_message', payload);
        }
        res.json({ ok: true, url: attachment.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/chat/room/:id', requireLogin, async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ _id: req.params.id, admins: req.session.userId });
        if (!room) return res.status(403).json({ error: '権限がありません' });
        const { name, description, icon } = req.body;
        if (name) room.name = name.trim();
        if (description !== undefined) room.description = description.trim();
        if (icon) room.icon = icon;
        await room.save();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/chat/room/:id/members', requireLogin, async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ _id: req.params.id, admins: req.session.userId });
        if (!room) return res.status(403).json({ error: '権限がありません' });
        (req.body.userIds || []).forEach(uid => {
            if (!room.members.some(m => String(m) === uid)) room.members.push(uid);
        });
        await room.save();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/chat/room/:id/members/:userId', requireLogin, async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ _id: req.params.id, admins: req.session.userId });
        if (!room) return res.status(403).json({ error: '権限がありません' });
        room.members = room.members.filter(m => String(m) !== req.params.userId);
        await room.save();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HTML ビルダー ──────────────────────────────────────────────

function buildPage(data) {
    const { mode, myId, myName, myInitial, myStatus, recentDMs, roomList, allUsers } = data;
    const clientData = {
        mode, myId, myName, myInitial, myStatus,
        allUsers: allUsers.map(u => ({
            _id: String(u._id), username: u.username, chatStatus: u.chatStatus || 'offline',
            emp: u.emp ? { name: u.emp.name, department: u.emp.department || '' } : null,
        })),
        roomIds: roomList.map(r => String(r._id)),
    };
    if (mode === 'dm') {
        Object.assign(clientData, { targetId: data.targetId, targetName: data.targetName, targetStatus: data.targetStatus });
    }
    if (mode === 'room') {
        Object.assign(clientData, {
            roomId: data.roomId, roomName: data.roomName, isRoomAdmin: data.isRoomAdmin,
            members: (data.members || []).map(m => ({
                _id: String(m._id), username: m.username, chatStatus: m.chatStatus || 'offline',
                emp: m.emp ? { name: m.emp.name, department: m.emp.department || '' } : null,
            })),
        });
    }
    return `${chatStyles()}
<div class="sc-root">
    ${buildSidebarHtml(data)}
    <div class="sc-main" id="sc-main">${buildMainHtml(data)}</div>
</div>
${buildGroupCreateModal(allUsers)}
${buildRoomSettingsModal()}
${buildCallOverlay()}
<script type="application/json" id="sc-init">${JSON.stringify(clientData)}</script>
<script src="/socket.io/socket.io.js"></script>
<script src="/chat-app.js?v=4"></script>`;
}

function buildSidebarHtml(d) {
    const { myName, myInitial, myStatus, recentDMs, roomList, mode, targetId, roomId } = d;
    const dmRows = recentDMs.length ? recentDMs.map(u => {
        const name = u.emp ? u.emp.name : u.username;
        const dept = u.emp ? (u.emp.department || '') : '';
        const preview = u.lastMsg ? escHtml(u.lastMsg.slice(0, 26)) + (u.lastMsg.length > 26 ? '…' : '') : '';
        const active = mode === 'dm' && String(u._id) === targetId;
        return `<a href="/chat/dm/${u._id}" class="sc-nav-row${active ? ' active' : ''}" data-userid="${u._id}">
            <div class="sc-av-wrap sm"><div class="sc-av sm">${name.charAt(0).toUpperCase()}</div>
            <span class="sc-pip ${STATUS_CLS[u.chatStatus || 'offline']}" data-uid="${u._id}"></span></div>
            <div class="sc-nav-info"><span class="sc-nav-name">${escHtml(name)}</span>
            <span class="sc-nav-sub">${dept ? escHtml(dept) : preview}</span></div>
            ${u.unread ? '<span class="sc-badge">' + u.unread + '</span>' : ''}
        </a>`;
    }).join('') : '<div class="sc-empty-row">まだ会話がありません</div>';

    const roomRows = roomList.length ? roomList.map(r => {
        const active = mode === 'room' && String(r._id) === roomId;
        return `<a href="/chat/room/${r._id}" class="sc-nav-row${active ? ' active' : ''}">
            <div class="sc-room-icon">${escHtml(r.icon || '💬')}</div>
            <div class="sc-nav-info"><span class="sc-nav-name">${escHtml(r.name)}</span>
            <span class="sc-nav-sub">${(r.members && r.members.length) || 0}人</span></div>
            ${r.unread ? '<span class="sc-badge">' + r.unread + '</span>' : ''}
        </a>`;
    }).join('') : '<div class="sc-empty-row">グループはありません</div>';

    return `<div class="sc-side">
    <div class="sc-side-hd"><i class="fa-regular fa-comment-dots" style="color:#c9b5a0;font-size:.9rem;"></i><span class="sc-ws-name">DXPRO SOLUTIONS</span></div>
    <div class="sc-me-row">
        <div class="sc-av-wrap sm"><div class="sc-av sm sc-av-me">${myInitial}</div>
        <span class="sc-pip ${STATUS_CLS[myStatus || 'offline']}" id="my-pip"></span></div>
        <div class="sc-me-info">
            <span class="sc-me-name">${escHtml(myName)}</span>
            <div class="sc-st-btns">
                <button class="sc-st-btn${myStatus === 'online'  ? ' active' : ''}" data-st="online"   onclick="chatApp.setStatus('online',this)"><span class="sc-btn-pip pip-online"></span>オンライン</button>
                <button class="sc-st-btn${myStatus === 'break'   ? ' active' : ''}" data-st="break"    onclick="chatApp.setStatus('break',this)"><span class="sc-btn-pip pip-break"></span>休憩中</button>
                <button class="sc-st-btn${myStatus === 'offline' ? ' active' : ''}" data-st="offline"  onclick="chatApp.setStatus('offline',this)"><span class="sc-btn-pip pip-offline"></span>オフライン</button>
            </div>
        </div>
    </div>
    <div class="sc-search-wrap"><input type="text" id="sc-search" class="sc-search-inp" placeholder="🔍 ユーザーを検索..." autocomplete="off" oninput="chatApp.filterSidebar(this.value)"></div>
    <div class="sc-side-sec"><span class="sc-sec-label">ダイレクトメッセージ</span></div>
    <div class="sc-nav-list" id="sc-dm-list">${dmRows}</div>
    <div class="sc-nav-list" id="sc-search-list" style="display:none"></div>
    <div class="sc-side-sec"><span class="sc-sec-label">グループ</span><button class="sc-sec-btn" onclick="chatApp.openCreateRoom()" title="グループを作成">＋</button></div>
    <div class="sc-nav-list" id="sc-room-list">${roomRows}</div>
</div>`;
}

function buildMainHtml(data) {
    if (data.mode === 'home') {
        const { recentDMs = [], roomList = [], allUsers = [], myName } = data;

        // 最近のDM（最大6件）
        const recentRows = recentDMs.slice(0, 6).map(u => {
            const name    = u.emp ? u.emp.name : u.username;
            const dept    = u.emp ? (u.emp.department || '') : '';
            const preview = u.lastMsg ? escHtml(u.lastMsg.slice(0, 30)) + (u.lastMsg.length > 30 ? '…' : '') : 'メッセージを送る';
            const pip     = STATUS_CLS[u.chatStatus || 'offline'];
            const initial = (name || '?').charAt(0).toUpperCase();
            const unread  = u.unread ? `<span class="ch-badge">${u.unread}</span>` : '';
            return `<a href="/chat/dm/${u._id}" class="ch-card">
                <div class="ch-av-wrap"><div class="ch-av">${initial}</div><span class="ch-pip ${pip}"></span></div>
                <div class="ch-info">
                    <div class="ch-name">${escHtml(name)}${dept ? `<span class="ch-dept">${escHtml(dept)}</span>` : ''}</div>
                    <div class="ch-preview">${preview}</div>
                </div>
                ${unread}
            </a>`;
        }).join('');

        // グループ（最大4件）
        const roomRows = roomList.slice(0, 4).map(r => {
            const unread = r.unread ? `<span class="ch-badge">${r.unread}</span>` : '';
            return `<a href="/chat/room/${r._id}" class="ch-card">
                <div class="ch-room-icon">${escHtml(r.icon || '💬')}</div>
                <div class="ch-info">
                    <div class="ch-name">${escHtml(r.name)}</div>
                    <div class="ch-preview">${(r.members && r.members.length) || 0}人のメンバー</div>
                </div>
                ${unread}
            </a>`;
        }).join('');

        // オンラインユーザー
        const onlineUsers = allUsers.filter(u => u.chatStatus === 'online').slice(0, 8);
        const onlineHtml = onlineUsers.length ? onlineUsers.map(u => {
            const name    = u.emp ? u.emp.name : u.username;
            const initial = (name || '?').charAt(0).toUpperCase();
            return `<a href="/chat/dm/${u._id}" class="ch-online-chip" title="${escHtml(name)}">
                <div class="ch-av sm">${initial}</div>
                <span>${escHtml(name)}</span>
            </a>`;
        }).join('') : '<div class="ch-empty-sub">現在オンラインのユーザーはいません</div>';

        return `<div class="ch-home">
    <div class="ch-home-hd">
        <span class="ch-home-icon">💬</span>
        <div>
            <div class="ch-home-title">チャット</div>
            <div class="ch-home-sub">こんにちは、${escHtml(myName || '')}さん</div>
        </div>
    </div>

    <div class="ch-section-label">🟢 オンライン中</div>
    <div class="ch-online-row">${onlineHtml}</div>

    ${recentRows ? `<div class="ch-section-label">🕐 最近のメッセージ</div><div class="ch-cards">${recentRows}</div>
    <div style="text-align:right;margin-top:4px"><a href="#" onclick="document.getElementById('sc-search').focus();return false" class="ch-more-link">全ユーザーを検索 →</a></div>` : ''}

    ${roomRows ? `<div class="ch-section-label">👥 グループチャット</div><div class="ch-cards">${roomRows}</div>` : ''}

    ${!recentRows && !roomRows ? `<div class="ch-empty">
        <div style="font-size:2.5rem;margin-bottom:10px;">💬</div>
        <div style="font-weight:600;color:#1c1917;margin-bottom:6px;">まだ会話がありません</div>
        <div style="font-size:.85rem;color:#78716c;">左のリストからユーザーを選んで<br>メッセージを送ってみましょう。</div>
    </div>` : ''}
</div>`;
    }
    const isRoom = data.mode === 'room';
    const EMOJIS = ['👍','👎','❤️','😂','😮','🎉','🙏','💪','✅','❓','🔥','👀','😅','🤔','💯'];
    const headerHtml = isRoom
        ? `<div class="sc-main-hd">
            <div class="sc-hd-left"><div class="sc-room-icon-lg">${escHtml(data.roomIcon || '💬')}</div>
            <div><div class="sc-hd-name">${escHtml(data.roomName)}</div><div class="sc-hd-sub" id="room-sub">${data.members.length}人のメンバー</div></div></div>
            <div class="sc-hd-actions">
                <button class="sc-hd-btn" onclick="chatApp.toggleMemberPanel()" title="メンバー"><i class="fa-solid fa-users"></i></button>
                ${data.isRoomAdmin ? '<button class="sc-hd-btn" onclick="chatApp.openRoomSettings()" title="設定"><i class="fa-solid fa-gear"></i></button>' : ''}
                <div class="sc-hd-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="msg-search" placeholder="検索..." oninput="chatApp.filterMessages(this.value)"></div>
            </div>
        </div>`
        : `<div class="sc-main-hd">
            <div class="sc-hd-left"><div class="sc-av-wrap"><div class="sc-av sc-av-target">${escHtml(data.targetName || '?').charAt(0).toUpperCase()}</div>
            <span class="sc-pip ${STATUS_CLS[data.targetStatus || 'offline']}" id="target-pip"></span></div>
            <div><div class="sc-hd-name">${escHtml(data.targetName || '')}</div>
            <div class="sc-hd-sub" id="target-sub">${STATUS_LABEL[data.targetStatus || 'offline']}${data.targetDept ? ' · ' + escHtml(data.targetDept) : ''}</div></div></div>
            <div class="sc-hd-actions">
                <button class="sc-hd-btn sc-call-btn" id="call-btn" title="音声・ビデオ通話"><i class="fa-solid fa-phone"></i></button>
                <button class="sc-hd-btn sc-call-btn" id="screen-btn" title="画面共有"><i class="fa-solid fa-desktop"></i></button>
                <button class="sc-hd-btn sc-call-btn" id="remote-btn" title="遠隔操作リクエスト"><i class="fa-solid fa-mouse-pointer"></i></button>
                <div class="sc-hd-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="msg-search" placeholder="会話内を検索..." oninput="chatApp.filterMessages(this.value)"></div>
            </div>
        </div>`;
    return `${headerHtml}
<div class="sc-typing-bar" id="sc-typing"></div>
<div class="sc-body-wrap">
    <div class="sc-messages" id="sc-messages">
        ${buildThreadStart(data)}
        ${buildMessagesHtml(data)}
        <div id="sc-msg-bottom"></div>
    </div>
    ${isRoom ? buildMemberPanel(data) : ''}
</div>
<div class="sc-emoji-picker" id="sc-emoji-picker" style="display:none">${EMOJIS.map(e => '<button class="sc-emoji-btn" onclick="chatApp.pickEmoji(\'' + e + '\')">' + e + '</button>').join('')}</div>
<div class="sc-reply-bar" id="sc-reply-bar" style="display:none">
    <span class="sc-reply-icon">↩</span><span id="sc-reply-text" class="sc-reply-txt"></span>
    <button onclick="chatApp.cancelReply()" class="sc-reply-close">×</button>
</div>
<div class="sc-input-area">
    <div class="sc-input-tools">
        <button class="sc-tool-btn" title="ファイルを添付" onclick="document.getElementById('sc-file-input').click()"><i class="fa-solid fa-paperclip"></i></button>
        <button class="sc-tool-btn" title="絵文字を挿入" onclick="chatApp.toggleInputEmoji()"><i class="fa-regular fa-face-smile"></i></button>
        <input type="file" id="sc-file-input" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.csv,.mp4,.mov" style="display:none" onchange="chatApp.handleFileSelect(this)">
    </div>
    <div id="sc-file-preview" class="sc-file-preview-area"></div>
    <div class="sc-input-box" id="sc-input-box"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="chatApp.handleDrop(event)">
        <textarea id="sc-msg-input" placeholder="${isRoom ? escHtml(data.roomName) : escHtml(data.targetName || '')} へメッセージを送る... (Shift+Enter で改行)" rows="1" maxlength="4000" oninput="chatApp.onInput()" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chatApp.send();}"></textarea>
        <button class="sc-send-btn" id="sc-send-btn" disabled onclick="chatApp.send()"><i class="fa-solid fa-paper-plane"></i></button>
    </div>
    <div class="sc-input-hint">Enter で送信 · Shift+Enter で改行 · ファイルをドロップで添付</div>
</div>`;
}

function buildThreadStart(data) {
    if (data.mode === 'dm') {
        const initial = (data.targetName || '?').charAt(0).toUpperCase();
        return `<div class="sc-thread-start"><div class="sc-av sc-av-lg sc-av-target">${initial}</div>
        <div class="sc-thread-name">${escHtml(data.targetName || '')}</div>
        <div class="sc-thread-sub">${data.targetDept ? escHtml(data.targetDept) : ''}${data.targetPos ? ' · ' + escHtml(data.targetPos) : ''}</div>
        <p class="sc-thread-desc">${escHtml(data.targetName || '')} とのダイレクトメッセージです。</p></div>`;
    }
    return `<div class="sc-thread-start"><div class="sc-room-icon-xl">${escHtml(data.roomIcon || '💬')}</div>
    <div class="sc-thread-name">${escHtml(data.roomName || '')}</div>
    ${data.roomDesc ? '<div class="sc-thread-sub">' + escHtml(data.roomDesc) + '</div>' : ''}
    <p class="sc-thread-desc">${escHtml(data.roomName || '')} グループチャットへようこそ。</p></div>`;
}

function buildMemberPanel(data) {
    const rows = (data.members || []).map(m => {
        const name = m.emp ? m.emp.name : m.username;
        const dept = m.emp ? (m.emp.department || '') : '';
        return `<div class="sc-member-row">
            <div class="sc-av-wrap sm"><div class="sc-av sm">${name.charAt(0).toUpperCase()}</div>
            <span class="sc-pip ${STATUS_CLS[m.chatStatus || 'offline']}" data-uid="${m._id}"></span></div>
            <div class="sc-nav-info"><span class="sc-nav-name">${escHtml(name)}</span>${dept ? '<span class="sc-nav-sub">' + escHtml(dept) + '</span>' : ''}</div>
            ${data.isRoomAdmin && String(m._id) !== data.myId ? '<button class="sc-member-kick" onclick="chatApp.kickMember(\'' + m._id + '\',\'' + escHtml(name) + '\')" title="除外">×</button>' : ''}
        </div>`;
    }).join('');
    return `<div class="sc-member-panel" id="sc-member-panel" style="display:none">
        <div class="sc-member-hd"><span>メンバー (${data.members.length})</span><button onclick="chatApp.toggleMemberPanel()">×</button></div>
        <div class="sc-member-list">${rows}</div>
        ${data.isRoomAdmin ? '<div class="sc-member-add"><button class="sc-add-btn" onclick="chatApp.openAddMember()"><i class="fa-solid fa-user-plus"></i> メンバーを追加</button></div>' : ''}
    </div>`;
}

function buildMessagesHtml(data) {
    const { messages, myId, myName, mode } = data;
    if (!messages || !messages.length) return '';
    const isRoom = mode === 'room';
    const memberNameMap = {};
    if (isRoom && data.members) {
        data.members.forEach(m => { memberNameMap[String(m._id)] = m.emp ? m.emp.name : m.username; });
    }
    memberNameMap[String(myId)] = myName;

    let html = '';
    let prevFrom = null, prevDate = null;
    for (const m of messages) {
        if (m.deleted) {
            html += '<div class="sc-msg sc-msg-del" data-id="' + m._id + '"><span class="sc-del-icon">🗑</span><span class="sc-del-text">このメッセージは削除されました</span></div>';
            prevFrom = null; continue;
        }
        // 不在着信システムメッセージ
        if (m.isMissedCall) {
            const isMine = String(m.fromUserId) === String(myId);
            const dt2 = new Date(m.createdAt);
            const timeStr2 = dt2.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            html += '<div class="sc-missed-call" data-id="' + m._id + '">'
                + '<span class="sc-missed-icon">📵</span>'
                + (isMine ? '不在着信（発信）' : '不在着信')
                + '<span class="sc-missed-time">' + timeStr2 + '</span></div>';
            prevFrom = null; continue;
        }
        // 通話履歴システムメッセージ
        if (m.isCallHistory) {
            const dt2 = new Date(m.createdAt);
            const timeStr2 = dt2.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            const mins = Math.floor((m.callDuration || 0) / 60);
            const secs = (m.callDuration || 0) % 60;
            const durStr = mins > 0 ? mins + '分' + secs + '秒' : secs + '秒';
            html += '<div class="sc-call-history" data-id="' + m._id + '">'
                + '<span>📞</span> 通話 — ' + durStr
                + '<span class="sc-missed-time">' + timeStr2 + '</span></div>';
            prevFrom = null; continue;
        }
        const isMine     = String(m.fromUserId) === String(myId);
        const senderName = isRoom ? (memberNameMap[String(m.fromUserId)] || '不明') : (isMine ? myName : data.targetName);
        const initial    = (senderName || '?').charAt(0).toUpperCase();
        const colorIdx   = isMine ? 0 : (isRoom ? (([...String(m.fromUserId)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1) : 1);
        const dt      = new Date(m.createdAt);
        const dateStr = dt.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
        const timeStr = dt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        if (prevDate !== dateStr) {
            html += '<div class="sc-date-div"><span>' + dateStr + '</span></div>';
            prevDate = dateStr; prevFrom = null;
        }
        const isCont = prevFrom === String(m.fromUserId);
        prevFrom = String(m.fromUserId);
        const replyBlock = m.replyPreview
            ? '<div class="sc-reply-quote"><div class="sc-reply-stripe"></div><span>' + escHtml(m.replyPreview.slice(0, 60)) + (m.replyPreview.length > 60 ? '…' : '') + '</span></div>' : '';
        const attachHtml  = buildAttachmentsHtml(m.attachments || []);
        const reactHtml   = buildReactHtml(m, myId);
        const editedBadge = m.edited ? '<span class="sc-edited">（編集済み）</span>' : '';
        let readBadge = '';
        if (!isRoom && isMine) {
            readBadge = m.read
                ? '<span class="sc-read read" data-read="' + m._id + '">✓✓ 既読</span>'
                : '<span class="sc-read unread" data-read="' + m._id + '">✓ 未読</span>';
        } else if (isRoom && isMine) {
            const rc = (m.readBy || []).length;
            readBadge = rc > 0
                ? '<span class="sc-read read" data-read="' + m._id + '">既読 ' + rc + '</span>'
                : '<span class="sc-read unread" data-read="' + m._id + '"></span>';
        }
        const safeContent = escHtml(m.content || '').replace(/'/g, '\\x27').slice(0, 60);
        const toolbar = '<div class="sc-toolbar">'
            + '<button class="sc-tb" onclick="chatApp.startReply(\'' + m._id + '\',\'' + safeContent + '\')" title="返信">↩</button>'
            + '<button class="sc-tb sc-emoji-trig" data-mid="' + m._id + '" title="リアクション">😊</button>'
            + (isMine ? '<button class="sc-tb" onclick="chatApp.startEdit(\'' + m._id + '\')" title="編集">✏️</button>' : '')
            + (isMine ? '<button class="sc-tb sc-tb-del" onclick="chatApp.deleteMsg(\'' + m._id + '\')" title="削除">🗑</button>' : '')
            + '</div>';
        if (isCont) {
            html += '<div class="sc-msg sc-msg-cont" data-id="' + m._id + '">' + toolbar
                + '<div class="sc-ts-hover">' + timeStr + '</div>'
                + '<div class="sc-body-wrap2">' + replyBlock
                + '<div class="sc-msg-text" data-mid="' + m._id + '">' + escHtml(m.content || '') + '</div>'
                + editedBadge + attachHtml + reactHtml + readBadge + '</div></div>';
        } else {
            html += '<div class="sc-msg" data-id="' + m._id + '">' + toolbar
                + '<div class="sc-av sc-av-c' + colorIdx + '">' + initial + '</div>'
                + '<div class="sc-msg-right"><div class="sc-msg-meta"><span class="sc-sender">' + escHtml(senderName) + '</span><span class="sc-ts">' + timeStr + '</span></div>'
                + replyBlock + '<div class="sc-msg-text" data-mid="' + m._id + '">' + escHtml(m.content || '') + '</div>'
                + editedBadge + attachHtml + reactHtml + readBadge + '</div></div>';
        }
    }
    return html;
}

function buildAttachmentsHtml(attachments) {
    if (!attachments.length) return '';
    return '<div class="sc-atts">' + attachments.map(a => {
        const type = mimeToType(a.mimeType || '');
        if (type === 'image') return '<a href="' + a.url + '" target="_blank" class="sc-att-img-wrap"><img src="' + a.url + '" alt="' + escHtml(a.name) + '" class="sc-att-img" loading="lazy"></a>';
        const icon = type === 'pdf' ? '📄' : type === 'video' ? '🎬' : '📎';
        const sz   = a.size ? (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + 'MB' : Math.ceil(a.size / 1024) + 'KB') : '';
        return '<a href="' + a.url + '" target="_blank" download="' + escHtml(a.name) + '" class="sc-att-file"><span class="sc-att-icon">' + icon + '</span><div><div class="sc-att-name">' + escHtml(a.name) + '</div><div class="sc-att-size">' + sz + '</div></div></a>';
    }).join('') + '</div>';
}

function buildReactHtml(m, myId) {
    if (!m.reactions || !m.reactions.length) return '<div class="sc-reactions" data-mid="' + m._id + '"></div>';
    const chips = m.reactions.map(r => {
        const mine  = (r.userIds || []).some(id => String(id) === String(myId));
        const count = (r.userIds || []).length;
        return '<button class="sc-react-chip' + (mine ? ' mine' : '') + '" data-emoji="' + r.emoji + '" onclick="chatApp.toggleReact(\'' + m._id + '\',\'' + r.emoji + '\',this)">' + r.emoji + ' <span class="sc-react-n">' + count + '</span></button>';
    }).join('');
    return '<div class="sc-reactions" data-mid="' + m._id + '">' + chips + '</div>';
}

function buildGroupCreateModal(allUsers) {
    const opts = allUsers.map(u => {
        const name = u.emp ? u.emp.name : u.username;
        const dept = u.emp ? (u.emp.department || '') : '';
        return '<label class="sc-modal-user-row"><input type="checkbox" name="member" value="' + u._id + '"><div class="sc-av sm2">' + name.charAt(0).toUpperCase() + '</div><div><div class="sc-modal-uname">' + escHtml(name) + '</div>' + (dept ? '<div class="sc-modal-udept">' + escHtml(dept) + '</div>' : '') + '</div></label>';
    }).join('');
    return `<div class="sc-overlay" id="sc-modal-create" style="display:none" onclick="if(event.target===this)chatApp.closeModal('sc-modal-create')">
    <div class="sc-modal">
        <div class="sc-modal-hd"><h3>グループチャットを作成</h3><button onclick="chatApp.closeModal('sc-modal-create')">×</button></div>
        <div class="sc-modal-body">
            <div class="sc-form-row"><label>グループ名 <span style="color:red">*</span></label><input type="text" id="room-name" placeholder="例: プロジェクトチーム" maxlength="50"></div>
            <div class="sc-form-row"><label>説明（任意）</label><input type="text" id="room-desc" placeholder="グループの説明" maxlength="200"></div>
            <div class="sc-form-row"><label>アイコン絵文字</label><input type="text" id="room-icon" value="💬" maxlength="4" style="width:60px"></div>
            <div class="sc-form-row"><label>メンバーを追加</label>
                <input type="text" id="modal-user-search" placeholder="🔍 メンバーを検索..." oninput="chatApp.filterModalUsers(this.value)" style="margin-bottom:8px">
                <div class="sc-modal-user-list" id="sc-modal-user-list">${opts}</div>
            </div>
        </div>
        <div class="sc-modal-ft">
            <button class="sc-btn-cancel" onclick="chatApp.closeModal('sc-modal-create')">キャンセル</button>
            <button class="sc-btn-primary" onclick="chatApp.createRoom()">作成する</button>
        </div>
    </div>
</div>`;
}

function buildRoomSettingsModal() {
    return `<div class="sc-overlay" id="sc-modal-room-settings" style="display:none" onclick="if(event.target===this)chatApp.closeModal('sc-modal-room-settings')">
    <div class="sc-modal">
        <div class="sc-modal-hd"><h3>グループ設定</h3><button onclick="chatApp.closeModal('sc-modal-room-settings')">×</button></div>
        <div class="sc-modal-body">
            <div class="sc-form-row"><label>グループ名</label><input type="text" id="room-edit-name" maxlength="50"></div>
            <div class="sc-form-row"><label>説明</label><input type="text" id="room-edit-desc" maxlength="200"></div>
            <div class="sc-form-row"><label>アイコン絵文字</label><input type="text" id="room-edit-icon" maxlength="4" style="width:60px"></div>
        </div>
        <div class="sc-modal-ft">
            <button class="sc-btn-cancel" onclick="chatApp.closeModal('sc-modal-room-settings')">キャンセル</button>
            <button class="sc-btn-primary" onclick="chatApp.saveRoomSettings()">保存</button>
        </div>
    </div>
</div>`;
}

function chatStyles() {
    return `<style>
.sidebar{background:#1c1917!important}.sidebar a,.sidebar .nav-link{color:#c9bfb5!important}.sidebar a:hover{background:#2a2724!important;color:#e8e0d5!important}.sidebar .nav-link.active{background:#2e2b28!important;color:#e8e0d5!important}
#cb-fab,#cb-panel{display:none!important}
.main{padding:0!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;background:#f5f4f0!important;min-height:0}
.page-content{padding:0!important;margin:0!important;max-width:none!important;width:100%!important;flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.sc-root{display:flex;height:100%;width:100%;overflow:hidden;font-family:'Inter','Segoe UI',system-ui,sans-serif}
.sc-side{width:240px;min-width:240px;background:#1c1917;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
.sc-side-hd{padding:14px 16px 11px;border-bottom:1px solid #2c2a27;display:flex;align-items:center;gap:8px}
.sc-ws-name{color:#e8e0d5;font-weight:700;font-size:.9rem}
.sc-me-row{display:flex;align-items:flex-start;gap:9px;padding:10px 12px 9px;border-bottom:1px solid #2c2a27}
.sc-me-info{flex:1;min-width:0}
.sc-me-name{color:#c9bfb5;font-size:.79rem;font-weight:600;display:block;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-st-btns{display:flex;gap:4px;flex-wrap:wrap}
.sc-st-btn{display:flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;border:1px solid #3a3733;background:transparent;color:#9b948c;font-size:.69rem;cursor:pointer;transition:.15s}
.sc-st-btn:hover{background:#2a2724;color:#e8e0d5}.sc-st-btn.active{background:#2e2b28;color:#e8e0d5;border-color:#57534e}
.sc-btn-pip{display:inline-block;width:7px;height:7px;border-radius:50%}
.sc-search-wrap{padding:7px 10px 4px}
.sc-search-inp{width:100%;box-sizing:border-box;background:#2a2724;border:1px solid #3a3733;border-radius:6px;color:#f0ece7;padding:5px 10px;font-size:.78rem;outline:none}
.sc-search-inp::placeholder{color:#6b6460}.sc-search-inp:focus{border-color:#78716c;background:#322f2b}
.sc-side-sec{display:flex;align-items:center;justify-content:space-between;padding:11px 16px 3px}
.sc-sec-label{color:#57534e;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.sc-sec-btn{background:none;border:none;color:#57534e;cursor:pointer;font-size:.95rem;line-height:1;padding:0 2px;transition:.1s}
.sc-sec-btn:hover{color:#c9bfb5}
.sc-nav-list{overflow-y:auto;padding:2px 8px 4px}
.sc-nav-list::-webkit-scrollbar{width:3px}.sc-nav-list::-webkit-scrollbar-thumb{background:#3a3733}
.sc-nav-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;text-decoration:none;color:#9b948c;font-size:.83rem;transition:.1s}
.sc-nav-row:hover{background:#252220;color:#e8e0d5}.sc-nav-row.active{background:#2e2b28;color:#e8e0d5}
.sc-nav-info{flex:1;min-width:0;display:flex;flex-direction:column}
.sc-nav-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem}
.sc-nav-sub{font-size:.69rem;color:#57534e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-badge{background:#b45309;color:#fff;border-radius:10px;padding:1px 6px;font-size:.67rem;font-weight:700;min-width:17px;text-align:center;flex-shrink:0}
.sc-empty-row{color:#4b4744;font-size:.77rem;padding:6px 8px}
.sc-room-icon{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:1rem;border-radius:6px;background:#2a2724;flex-shrink:0}
.sc-av-wrap{position:relative;flex-shrink:0;width:36px;height:36px}
.sc-av-wrap.sm{width:28px;height:28px}
.sc-av{width:36px;height:36px;border-radius:7px;background:#44403c;color:#e8e0d5;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;user-select:none}
.sc-av.sm,.sc-av.sm2{width:28px;height:28px;font-size:.74rem;border-radius:5px}
.sc-av-me{background:#57534e!important}.sc-av-target{background:#78350f;color:#fef3c7}
.sc-av-lg{width:64px;height:64px;font-size:1.8rem;border-radius:12px}
.sc-av-c0{background:#44403c}.sc-av-c1{background:#78350f;color:#fef3c7}.sc-av-c2{background:#1e3a5f;color:#bfdbfe}
.sc-av-c3{background:#14532d;color:#bbf7d0}.sc-av-c4{background:#4a1d96;color:#ddd6fe}.sc-av-c5{background:#7c2d12;color:#fed7aa}
.sc-pip{position:absolute;bottom:-2px;right:-2px;width:10px;height:10px;border-radius:50%;border:2px solid #1c1917}
.sc-av-wrap:not(.sm) .sc-pip{width:11px;height:11px}
.sc-main-hd .sc-pip{border-color:#fff}
.pip-online{background:#22c55e}.pip-break{background:#f59e0b}.pip-offline{background:#52524e}
.sc-btn-pip.pip-online{background:#22c55e}.sc-btn-pip.pip-break{background:#f59e0b}.sc-btn-pip.pip-offline{background:#52524e}
.sc-main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#fafaf8;min-height:0}
.sc-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#78716c;text-align:center;padding:20px}
.sc-welcome-icon{font-size:3rem;margin-bottom:12px}.sc-welcome h2{margin:0 0 8px;color:#1c1917;font-size:1.3rem}.sc-welcome p{margin:0;font-size:.87rem;line-height:1.7}
/* ホーム画面 */
.ch-home{padding:20px 24px;overflow-y:auto;flex:1}
.ch-home-hd{display:flex;align-items:center;gap:14px;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #e7e5e0}
.ch-home-icon{font-size:2.2rem}
.ch-home-title{font-size:1.3rem;font-weight:700;color:#1c1917}
.ch-home-sub{font-size:.83rem;color:#78716c;margin-top:2px}
.ch-section-label{font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#a8a29e;margin:18px 0 8px}
.ch-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.ch-card{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e7e5e0;border-radius:10px;text-decoration:none;color:inherit;transition:.15s;position:relative}
.ch-card:hover{background:#f5f4f0;border-color:#d6d3d1;transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.ch-av-wrap{position:relative;flex-shrink:0}
.ch-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:.85rem;font-weight:700;display:flex;align-items:center;justify-content:center}
.ch-av.sm{width:28px;height:28px;font-size:.75rem}
.ch-pip{position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;border:1.5px solid #fff}
.ch-room-icon{width:36px;height:36px;border-radius:10px;background:#f5f4f0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
.ch-info{flex:1;min-width:0}
.ch-name{font-size:.85rem;font-weight:600;color:#1c1917;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ch-dept{font-size:.72rem;color:#a8a29e;margin-left:5px;font-weight:400}
.ch-preview{font-size:.75rem;color:#78716c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.ch-badge{background:#ef4444;color:#fff;border-radius:10px;font-size:.7rem;font-weight:700;padding:1px 6px;flex-shrink:0}
.ch-online-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
.ch-online-chip{display:flex;align-items:center;gap:6px;padding:5px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:20px;text-decoration:none;color:#15803d;font-size:.78rem;font-weight:500;transition:.15s}
.ch-online-chip:hover{background:#dcfce7;border-color:#4ade80}
.ch-empty-sub{font-size:.82rem;color:#a8a29e;padding:6px 0}
.ch-empty{text-align:center;padding:40px 20px;color:#78716c}
.ch-more-link{font-size:.78rem;color:#a8a29e;text-decoration:none}
.ch-more-link:hover{color:#78716c}
.sc-main-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:1px solid #e7e5e0;background:#fff;flex-shrink:0;gap:12px}
.sc-hd-left{display:flex;align-items:center;gap:10px}
.sc-hd-name{font-weight:700;font-size:1rem;color:#1c1917;line-height:1.2}.sc-hd-sub{font-size:.75rem;color:#78716c;margin-top:1px}
.sc-hd-actions{display:flex;align-items:center;gap:8px}
.sc-hd-btn{width:32px;height:32px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:#78716c;font-size:.88rem;display:flex;align-items:center;justify-content:center;transition:.1s}
.sc-hd-btn:hover{background:#f5f4f0;color:#1c1917}
.sc-hd-search{display:flex;align-items:center;gap:6px;background:#f5f4f0;border:1px solid #e7e5e0;border-radius:6px;padding:5px 10px}
.sc-hd-search i{color:#a8a29e;font-size:.76rem}.sc-hd-search input{border:none;background:transparent;outline:none;font-size:.79rem;color:#1c1917;width:130px}
.sc-hd-search input::placeholder{color:#a8a29e}
.sc-room-icon-lg{font-size:1.8rem;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#f5f4f0;border-radius:8px}
.sc-room-icon-xl{font-size:3rem;margin-bottom:12px}
.sc-typing-bar{height:18px;padding:0 18px;font-size:.73rem;color:#78716c;font-style:italic;flex-shrink:0;display:flex;align-items:center}
.sc-thread-start{display:flex;flex-direction:column;align-items:flex-start;padding:28px 18px 14px;border-bottom:1px solid #f0ede8;flex-shrink:0}
.sc-thread-name{font-size:1.3rem;font-weight:800;color:#1c1917;margin:10px 0 2px}
.sc-thread-sub{font-size:.79rem;color:#78716c;margin-bottom:4px}.sc-thread-desc{font-size:.84rem;color:#78716c;margin:0}
.sc-body-wrap{flex:1;display:flex;overflow:hidden;min-height:0}
.sc-messages{flex:1;overflow-y:auto;padding-bottom:8px;display:flex;flex-direction:column;min-height:0}
.sc-messages::-webkit-scrollbar{width:5px}.sc-messages::-webkit-scrollbar-thumb{background:#d6d3ce;border-radius:3px}
.sc-date-div{display:flex;align-items:center;margin:14px 18px 6px;gap:10px;flex-shrink:0}
.sc-date-div::before,.sc-date-div::after{content:'';flex:1;height:1px;background:#e7e5e0}
.sc-date-div span{font-size:.7rem;color:#a8a29e;font-weight:600;white-space:nowrap;padding:0 4px}
.sc-msg{display:flex;gap:10px;padding:4px 18px;position:relative;transition:background .1s}
.sc-msg:hover{background:#f5f4f0}.sc-msg:hover .sc-toolbar{opacity:1;pointer-events:all}
.sc-msg-cont{padding:2px 18px 2px 62px}
.sc-msg-del{display:flex;align-items:center;gap:8px;padding:4px 18px;color:#a8a29e;font-style:italic;font-size:.82rem}
.sc-msg-right{flex:1;min-width:0}.sc-body-wrap2{flex:1;min-width:0}
.sc-msg-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.sc-sender{font-weight:700;font-size:.87rem;color:#1c1917}.sc-ts{font-size:.7rem;color:#a8a29e}
.sc-ts-hover{position:absolute;left:18px;top:50%;transform:translateY(-50%);width:36px;text-align:center;font-size:.65rem;color:#a8a29e;opacity:0;pointer-events:none}
.sc-msg-cont:hover .sc-ts-hover{opacity:1}
.sc-msg-text{font-size:.87rem;color:#1c1917;line-height:1.65;word-break:break-word;white-space:pre-wrap}
.sc-msg-text[contenteditable="true"]{background:#fffbeb;border:1.5px solid #f59e0b;border-radius:6px;padding:4px 8px;outline:none}
.sc-edited{font-size:.67rem;color:#a8a29e;margin-left:4px}
.sc-read{font-size:.68rem;display:block;text-align:right;min-height:14px;margin-top:1px}
.sc-read.read{color:#22c55e}.sc-read.unread{color:#a8a29e}
.sc-reply-quote{display:flex;align-items:stretch;gap:8px;margin-bottom:4px;max-width:400px}
.sc-reply-stripe{width:3px;border-radius:3px;background:#a8a29e;flex-shrink:0}
.sc-reply-quote span{font-size:.77rem;color:#78716c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-atts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.sc-att-img{max-width:280px;max-height:220px;border-radius:8px;display:block;border:1px solid #e7e5e0;cursor:zoom-in}
.sc-att-file{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f5f4f0;border:1px solid #e7e5e0;border-radius:8px;text-decoration:none;color:#1c1917;transition:.1s;max-width:260px}
.sc-att-file:hover{background:#eeebe6}.sc-att-icon{font-size:1.4rem;flex-shrink:0}
.sc-att-name{font-size:.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.sc-att-size{font-size:.68rem;color:#78716c}
.sc-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;min-height:4px}
.sc-react-chip{display:flex;align-items:center;gap:3px;padding:2px 8px;border-radius:12px;border:1px solid #e7e5e0;background:#f5f4f0;font-size:.79rem;cursor:pointer;transition:.15s}
.sc-react-chip:hover{background:#e7e5e0}.sc-react-chip.mine{background:#fffbeb;border-color:#f59e0b}
.sc-react-n{font-size:.7rem;color:#78716c;font-weight:600}
.sc-toolbar{position:absolute;top:-14px;right:18px;display:flex;gap:2px;background:#fff;border:1px solid #e7e5e0;border-radius:8px;padding:3px 4px;box-shadow:0 2px 8px rgba(0,0,0,.1);opacity:0;pointer-events:none;z-index:10;transition:opacity .1s}
.sc-tb{width:26px;height:26px;border:none;background:transparent;border-radius:5px;cursor:pointer;font-size:.8rem;display:flex;align-items:center;justify-content:center;transition:.1s}
.sc-tb:hover{background:#f5f4f0}.sc-tb-del:hover{background:#fef2f2}
.sc-reply-bar{display:flex;align-items:center;gap:8px;padding:5px 18px;flex-shrink:0;background:#f5f4f0;border-top:1px solid #e7e5e0}
.sc-reply-icon{font-size:.9rem;color:#a8a29e}.sc-reply-txt{font-size:.8rem;color:#78716c;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-reply-close{background:none;border:none;cursor:pointer;color:#a8a29e;font-size:.95rem;padding:2px 5px}
.sc-reply-close:hover{color:#44403c}
.sc-emoji-picker{position:fixed;z-index:200;background:#fff;border:1px solid #e7e5e0;border-radius:10px;padding:8px;box-shadow:0 4px 20px rgba(0,0,0,.12);display:flex;flex-wrap:wrap;gap:4px;width:220px}
.sc-emoji-btn{width:32px;height:32px;border:none;background:transparent;border-radius:5px;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.sc-emoji-btn:hover{background:#f5f4f0}
.sc-input-area{padding:8px 18px 12px;flex-shrink:0;background:#fff;border-top:1px solid #e7e5e0}
.sc-input-tools{display:flex;gap:4px;margin-bottom:6px}
.sc-tool-btn{width:28px;height:28px;border:none;background:transparent;border-radius:5px;cursor:pointer;font-size:.9rem;color:#78716c;display:flex;align-items:center;justify-content:center;transition:.1s}
.sc-tool-btn:hover{background:#f5f4f0;color:#1c1917}
.sc-file-preview-area{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.sc-fp{position:relative}
.sc-fp img{width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #e7e5e0}
.sc-fp .sc-fp-card{width:110px;padding:5px 8px;background:#f5f4f0;border:1px solid #e7e5e0;border-radius:6px;font-size:.73rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-fp-rm{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:#44403c;color:#fff;font-size:.62rem;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center}
.sc-input-box{display:flex;align-items:flex-end;border:1.5px solid #d6d3ce;border-radius:8px;overflow:hidden;background:#fff;transition:border-color .2s,box-shadow .2s}
.sc-input-box.drag-over{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.15)}
.sc-input-box:focus-within{border-color:#78716c;box-shadow:0 0 0 3px rgba(120,113,108,.12)}
.sc-input-box textarea{flex:1;padding:10px 12px;border:none;outline:none;resize:none;font-size:.87rem;font-family:inherit;line-height:1.5;max-height:160px;background:transparent;color:#1c1917}
.sc-input-box textarea::placeholder{color:#c4bfba}
.sc-send-btn{width:36px;height:36px;margin:5px;border-radius:6px;border:none;background:#44403c;color:#fff;cursor:pointer;font-size:.82rem;display:flex;align-items:center;justify-content:center;transition:.15s;flex-shrink:0}
.sc-send-btn:disabled{background:#d6d3ce;cursor:default}.sc-send-btn:not(:disabled):hover{background:#1c1917}
.sc-input-hint{font-size:.69rem;color:#c4bfba;text-align:right;padding-top:3px}
.sc-member-panel{width:220px;min-width:220px;border-left:1px solid #e7e5e0;display:flex;flex-direction:column;background:#fff;overflow:hidden}
.sc-member-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e7e5e0;font-weight:600;font-size:.87rem;color:#1c1917}
.sc-member-hd button{background:none;border:none;cursor:pointer;color:#78716c;font-size:1rem}
.sc-member-list{flex:1;overflow-y:auto;padding:8px}
.sc-member-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px}
.sc-member-row:hover{background:#f5f4f0}
.sc-member-kick{margin-left:auto;background:none;border:none;cursor:pointer;color:#a8a29e;font-size:.79rem;padding:2px 5px;border-radius:4px}
.sc-member-kick:hover{background:#fef2f2;color:#ef4444}
.sc-member-add{padding:8px;border-top:1px solid #e7e5e0}
.sc-add-btn{width:100%;padding:7px;border:1.5px dashed #d6d3ce;background:transparent;border-radius:6px;cursor:pointer;font-size:.79rem;color:#78716c;display:flex;align-items:center;gap:6px;justify-content:center;transition:.1s}
.sc-add-btn:hover{border-color:#78716c;color:#1c1917}
.sc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px}
.sc-modal{background:#fff;border-radius:12px;width:100%;max-width:480px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.18)}
.sc-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e7e5e0}
.sc-modal-hd h3{margin:0;font-size:.98rem;color:#1c1917}.sc-modal-hd button{background:none;border:none;cursor:pointer;color:#78716c;font-size:1.1rem}
.sc-modal-body{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
.sc-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e7e5e0}
.sc-form-row{display:flex;flex-direction:column;gap:6px}.sc-form-row label{font-size:.81rem;font-weight:600;color:#44403c}
.sc-form-row input[type=text]{padding:8px 12px;border:1.5px solid #d6d3ce;border-radius:7px;font-size:.87rem;outline:none;transition:.2s}
.sc-form-row input[type=text]:focus{border-color:#78716c}
.sc-modal-user-list{max-height:200px;overflow-y:auto;border:1px solid #e7e5e0;border-radius:7px;padding:4px;display:flex;flex-direction:column;gap:2px}
.sc-modal-user-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:6px;cursor:pointer}
.sc-modal-user-row:hover{background:#f5f4f0}.sc-modal-user-row input{cursor:pointer}
.sc-modal-uname{font-size:.84rem;font-weight:600;color:#1c1917}.sc-modal-udept{font-size:.71rem;color:#78716c}
.sc-btn-cancel{padding:8px 18px;border:1.5px solid #d6d3ce;background:transparent;border-radius:7px;cursor:pointer;font-size:.85rem;color:#78716c;transition:.1s}
.sc-btn-cancel:hover{background:#f5f4f0}
.sc-btn-primary{padding:8px 18px;background:#44403c;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:.85rem;font-weight:600;transition:.15s}
.sc-btn-primary:hover{background:#1c1917}
.sc-missed-call{display:flex;align-items:center;gap:8px;padding:6px 18px;color:#78716c;font-size:.82rem;font-style:italic}
.sc-call-history{display:flex;align-items:center;gap:8px;padding:6px 18px;color:#4ade80;font-size:.82rem;justify-content:center}
.sc-missed-time{margin-left:auto;font-size:.75rem;opacity:.6}
.sc-missed-icon{font-size:1rem}
.sc-missed-time{margin-left:auto;font-size:.68rem;color:#a8a29e}
/* ── 通話UI ── */
.sc-call-btn{color:#22c55e!important}
.sc-call-btn:hover{background:#f0fdf4!important}
.call-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:center;justify-content:center}
.call-box{background:#1c1917;border-radius:16px;width:560px;max-width:96vw;box-shadow:0 8px 40px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column}
.call-header{display:flex;flex-direction:column;align-items:center;padding:14px 20px 6px;color:#e8e0d5;gap:2px}
.call-header span:first-child{font-size:.72rem;color:#78716c;letter-spacing:.04em}
.call-partner-name{font-size:1.1rem;font-weight:700}
.call-videos{position:relative;background:#111;height:280px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.call-vid-remote{width:100%;height:280px;object-fit:cover;background:#111;display:block}
.call-vid-local{position:absolute;bottom:10px;right:10px;width:100px;height:72px;object-fit:cover;border-radius:8px;border:2px solid #44403c;z-index:2}
.call-pointer-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none}
.call-controls{display:flex;justify-content:center;gap:12px;padding:14px 14px 10px}
.call-ctrl-btn{width:46px;height:46px;border-radius:50%;border:none;background:#2a2724;color:#e8e0d5;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.call-ctrl-btn:hover{background:#3a3733}.call-ctrl-btn.muted{background:#78350f;color:#fed7aa}
.call-ctrl-btn.active-feature{background:#1e3a5f;color:#bfdbfe}
.call-end-btn{background:#ef4444!important;color:#fff!important}
.call-end-btn:hover{background:#b91c1c!important}
.call-remote-bar{font-size:.75rem;color:#a8a29e;background:#0f0f0f;padding:6px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.call-inner-notice{background:#1e3a5f;color:#e0f0ff;padding:8px 16px;font-size:.82rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center}
.call-inner-notice button{padding:3px 12px;border:none;border-radius:5px;cursor:pointer;font-size:.8rem}
.call-record-dot{animation:blink 1s step-start infinite}
@keyframes blink{50%{opacity:0}}
.ctrl-recording{background:#ef4444!important;color:#fff!important}
.call-remote-bar button{background:none;border:1px solid #44403c;color:#a8a29e;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:.72rem}
.call-remote-bar button:hover{background:#2a2724;color:#e8e0d5}
/* 着信モーダル */
.call-incoming-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:600;display:flex;align-items:center;justify-content:center}
.call-incoming-box{background:#fff;border-radius:16px;padding:32px 40px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.2);min-width:280px}
.call-incoming-ring{font-size:3rem;margin-bottom:10px;animation:ring .6s ease-in-out infinite alternate}
@keyframes ring{from{transform:rotate(-15deg)}to{transform:rotate(15deg)}}
.call-incoming-name{font-size:1.3rem;font-weight:700;color:#1c1917;margin-bottom:4px}
.call-incoming-sub{font-size:.8rem;color:#78716c;margin-bottom:24px}
.call-incoming-btns{display:flex;gap:14px;justify-content:center}
.call-accept-btn{padding:12px 28px;background:#22c55e;color:#fff;border:none;border-radius:50px;font-size:.9rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;transition:.15s}
.call-accept-btn:hover{background:#16a34a}
.call-reject-btn{padding:12px 28px;background:#ef4444;color:#fff;border:none;border-radius:50px;font-size:.9rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;transition:.15s}
.call-reject-btn:hover{background:#b91c1c}
</style>`;
}

function buildCallOverlay() {
    return `
<!-- 通話UI オーバーレイ -->
<div id="call-overlay" style="display:none" class="call-overlay">
    <div class="call-box">
        <div class="call-header">
            <span id="call-status-label">通話中...</span>
            <span id="call-target-name" class="call-partner-name"></span>
        </div>
        <!-- 通話内通知バナー（遠隔操作承認など） -->
        <div id="call-inner-notice" style="display:none" class="call-inner-notice"></div>
        <div class="call-videos" id="call-videos">
            <video id="remote-video" autoplay playsinline class="call-vid call-vid-remote"></video>
            <canvas id="remote-pointer-canvas" class="call-pointer-canvas"></canvas>
            <video id="local-video"  autoplay playsinline muted class="call-vid call-vid-local"></video>
        </div>
        <div class="call-controls">
            <button class="call-ctrl-btn" id="ctrl-mic"    title="マイク ON/OFF"  onclick="window._chat_webrtc.toggleMic(this)"><i class="fa-solid fa-microphone"></i></button>
            <button class="call-ctrl-btn" id="ctrl-cam"    title="カメラ ON/OFF"  onclick="window._chat_webrtc.toggleCam(this)"><i class="fa-solid fa-video"></i></button>
            <button class="call-ctrl-btn" id="ctrl-screen" title="画面共有"        onclick="window._chat_webrtc.shareScreen()"><i class="fa-solid fa-desktop"></i></button>
            <button class="call-ctrl-btn" id="ctrl-remote" title="遠隔操作リクエスト" onclick="window._chat_webrtc.requestRemote()"><i class="fa-solid fa-mouse-pointer"></i></button>
            <button class="call-ctrl-btn" id="ctrl-record" title="録画 開始/停止"  onclick="window._chat_webrtc.toggleRecord(this)"><i class="fa-solid fa-circle-dot"></i></button>
            <button class="call-ctrl-btn call-end-btn" id="ctrl-hangup" title="通話終了" onclick="window._chat_webrtc.hangupCall()"><i class="fa-solid fa-phone-slash"></i></button>
        </div>
        <div id="remote-ctrl-bar" class="call-remote-bar" style="display:none">
            🖱 遠隔操作中 — 映像の上でマウスを動かすと相手に位置が表示されます
            <button onclick="window._chat_webrtc.stopRemote()">操作停止</button>
        </div>
    </div>
</div>

<!-- 着信モーダル -->
<div id="call-incoming-modal" style="display:none" class="call-incoming-modal">
    <div class="call-incoming-box">
        <div class="call-incoming-ring">📞</div>
        <div class="call-incoming-name" id="call-incoming-name">着信中...</div>
        <div class="call-incoming-sub">ビデオ通話の着信があります</div>
        <div class="call-incoming-btns">
            <button class="call-reject-btn"  onclick="window._chat_webrtc.rejectCall()"><i class="fa-solid fa-phone-slash"></i> 拒否</button>
            <button class="call-accept-btn"  onclick="window._chat_webrtc.acceptCall()"><i class="fa-solid fa-phone"></i> 応答</button>
        </div>
    </div>
</div>`;
}

module.exports = router;
