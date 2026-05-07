// ==============================
// public/call-sounds.js
// 着信音・発信音を Web Audio API で生成するユーティリティ
// window.CallSounds として公開
// ==============================
(function () {
    'use strict';

    let _ctx = null;
    function getCtx() {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Safari などで suspended になる場合は resume
        if (_ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    // ── 共通ユーティリティ ────────────────────────────────────
    function makeGain(ctx, value) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(value, ctx.currentTime);
        return g;
    }

    // ── 着信音（日本の電話風: 1秒ON → 2秒OFF を繰り返す） ──────
    // 425 Hz の正弦波。ビブラートなし。
    let _incomingInterval = null;

    function _playIncomingBeep() {
        try {
            const ctx = getCtx();
            const t   = ctx.currentTime;
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.connect(env); env.connect(ctx.destination);
            osc.type            = 'sine';
            osc.frequency.value = 425;          // 日本標準着信音の周波数
            env.gain.setValueAtTime(0,   t);
            env.gain.linearRampToValueAtTime(0.4, t + 0.02); // フェードイン
            env.gain.setValueAtTime(0.4, t + 0.9);
            env.gain.linearRampToValueAtTime(0,   t + 1.0);  // フェードアウト
            osc.start(t);
            osc.stop(t + 1.0);
        } catch (_) {}
    }

    function startIncoming() {
        stopIncoming();
        _playIncomingBeep();
        // 3秒ごとに再生（1秒鳴って2秒休止）
        _incomingInterval = setInterval(_playIncomingBeep, 3000);
    }

    function stopIncoming() {
        if (_incomingInterval) { clearInterval(_incomingInterval); _incomingInterval = null; }
    }

    // ── 発信音（海外風コール音: 400+450 Hz デュアルトーン） ─────
    // 2秒ON → 4秒OFF を繰り返す
    let _dialingInterval = null;

    function _playDialingBeep() {
        try {
            const ctx = getCtx();
            const t   = ctx.currentTime;
            const merger = ctx.createChannelMerger(1);
            const env    = ctx.createGain();
            merger.connect(env); env.connect(ctx.destination);

            [400, 450].forEach(freq => {
                const osc = ctx.createOscillator();
                const g   = ctx.createGain();
                osc.connect(g); g.connect(merger);
                osc.type            = 'sine';
                osc.frequency.value = freq;
                g.gain.value        = 0.2;
                osc.start(t);
                osc.stop(t + 2.0);
            });

            env.gain.setValueAtTime(0,   t);
            env.gain.linearRampToValueAtTime(1, t + 0.05);
            env.gain.setValueAtTime(1,   t + 1.9);
            env.gain.linearRampToValueAtTime(0, t + 2.0);
        } catch (_) {}
    }

    function startDialing() {
        stopDialing();
        _playDialingBeep();
        // 6秒ごとに再生（2秒鳴って4秒休止）
        _dialingInterval = setInterval(_playDialingBeep, 6000);
    }

    function stopDialing() {
        if (_dialingInterval) { clearInterval(_dialingInterval); _dialingInterval = null; }
    }

    // ── 通話終了音（短い2音） ────────────────────────────────────
    function playHangup() {
        try {
            const ctx = getCtx();
            [0, 0.18].forEach((delay, i) => {
                const t   = ctx.currentTime + delay;
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.connect(env); env.connect(ctx.destination);
                osc.type            = 'sine';
                osc.frequency.value = i === 0 ? 480 : 620;
                env.gain.setValueAtTime(0.3, t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.start(t);
                osc.stop(t + 0.15);
            });
        } catch (_) {}
    }

    // ── 着信拒否音（ビジートーン） ───────────────────────────────
    function playReject() {
        try {
            const ctx = getCtx();
            for (let i = 0; i < 3; i++) {
                const t   = ctx.currentTime + i * 0.4;
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.connect(env); env.connect(ctx.destination);
                osc.type            = 'sine';
                osc.frequency.value = 480;
                env.gain.setValueAtTime(0.3, t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
                osc.start(t);
                osc.stop(t + 0.3);
            }
        } catch (_) {}
    }

    // 公開API
    window.CallSounds = { startIncoming, stopIncoming, startDialing, stopDialing, playHangup, playReject };
})();
