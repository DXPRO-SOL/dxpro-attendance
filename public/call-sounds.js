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
        if (_ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    // ── 共通: デジタルベル1音 ────────────────────────────────
    // 倍音を重ねてベルらしい音色を作る。瞬時立ち上がり→ゆっくり減衰。
    function _bell(ctx, freq, startTime, volume) {
        const harmonics = [1, 2, 3, 4.2];
        const gains     = [0.5, 0.25, 0.12, 0.06];
        const master    = ctx.createGain();
        master.connect(ctx.destination);
        master.gain.setValueAtTime(0, startTime);
        master.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        master.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);
        harmonics.forEach((h, i) => {
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.connect(g); g.connect(master);
            osc.type = 'sine';
            osc.frequency.value = freq * h;
            g.gain.value = gains[i];
            osc.start(startTime);
            osc.stop(startTime + 1.3);
        });
    }

    // ── 着信音（Teams 風: ミ→ソ→ド 上昇3音） ───────────────────
    let _incomingInterval = null;

    function _playIncomingBeep() {
        try {
            const ctx = getCtx();
            const t   = ctx.currentTime;
            // Teams 風: ミ(659Hz) → ソ(784Hz) → ド(1047Hz) の上昇3音
            _bell(ctx, 659,  t,        0.22);
            _bell(ctx, 784,  t + 0.22, 0.22);
            _bell(ctx, 1047, t + 0.44, 0.26);
        } catch (_) {}
    }

    function startIncoming() {
        stopIncoming();
        _playIncomingBeep();
        // 2.8秒ごとに繰り返す
        _incomingInterval = setInterval(_playIncomingBeep, 2800);
    }

    function stopIncoming() {
        if (_incomingInterval) { clearInterval(_incomingInterval); _incomingInterval = null; }
    }

    // ── 発信音（ディズニー風 魔法のきらきら音） ──────────────────
    // C→E→G→C の上昇アルペジオ＋余韻でキラキラ感を演出
    let _dialingInterval = null;

    function _sparkle(ctx, freq, startTime, vol) {
        // 基音 + 3倍音で透明感のある音色
        [1, 3, 6].forEach((h, i) => {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            osc.connect(env); env.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq * h;
            const v = vol / (i + 1);
            env.gain.setValueAtTime(0, startTime);
            env.gain.linearRampToValueAtTime(v, startTime + 0.008); // 瞬間的に立ち上がる
            env.gain.exponentialRampToValueAtTime(0.001, startTime + 0.7); // キラッと消える
            osc.start(startTime);
            osc.stop(startTime + 0.72);
        });
    }

    function _playDialingBeep() {
        try {
            const ctx = getCtx();
            const t   = ctx.currentTime;
            // ド(C5)→ミ(E5)→ソ(G5)→ド(C6) きらきらアルペジオ
            const notes = [523, 659, 784, 1047];
            notes.forEach((freq, i) => {
                _sparkle(ctx, freq, t + i * 0.13, 0.18);
            });
            // 最後にキラーン余韻（高めのCを少し遅らせてもう一度）
            _sparkle(ctx, 1047, t + notes.length * 0.13 + 0.05, 0.09);
        } catch (_) {}
    }

    function startDialing() {
        stopDialing();
        _playDialingBeep();
        // 2.5秒ごとに繰り返す
        _dialingInterval = setInterval(_playDialingBeep, 2500);
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
