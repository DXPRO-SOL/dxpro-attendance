(function () {
    'use strict';
    var fab = document.getElementById('cb-fab');
    var panel = document.getElementById('cb-panel');
    var closeBtn = document.getElementById('cb-close');
    var msgs = document.getElementById('cb-messages');
    var input = document.getElementById('cb-input');
    var sendBtn = document.getElementById('cb-send');
    var suggs = document.querySelectorAll('.cb-sug-btn');
    var opened = false;

    if (!fab || !panel) {
        console.error('[Chatbot] #cb-fab or #cb-panel not found in DOM');
        return;
    }

    function renderText(t) {
        return t
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function appendMsg(role, text, links) {
        var w = document.createElement('div');
        w.className = 'cb-msg cb-' + role;
        if (role === 'bot') {
            var linksHtml = '';
            if (links && links.length) {
                linksHtml = '<div class="cb-links">' +
                    links.map(function (l) {
                        return '<a href="' + l.url + '" class="cb-link-btn">' + l.label + '</a>';
                    }).join('') + '</div>';
            }
            w.innerHTML =
                '<div class="cb-bot-icon"><i class="fa-solid fa-robot"></i></div>' +
                '<div><div class="cb-bubble">' + renderText(text) + '</div>' + linksHtml + '</div>';
        } else {
            w.innerHTML = '<div class="cb-bubble">' + renderText(text) + '</div>';
        }
        msgs.appendChild(w);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function showTyping() {
        var w = document.createElement('div');
        w.className = 'cb-msg cb-bot';
        w.id = 'cb-typ';
        w.innerHTML =
            '<div class="cb-bot-icon"><i class="fa-solid fa-robot"></i></div>' +
            '<div class="cb-bubble cb-typing"><span></span><span></span><span></span></div>';
        msgs.appendChild(w);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function hideTyping() {
        var e = document.getElementById('cb-typ');
        if (e) e.remove();
    }

    function sendMessage(text) {
        text = (text || '').trim();
        if (!text) return;
        appendMsg('user', text, []);
        if (input) { input.value = ''; input.style.height = 'auto'; }
        if (sendBtn) sendBtn.disabled = true;
        var sa = document.getElementById('cb-suggestions');
        if (sa) sa.style.display = 'none';
        showTyping();
        fetch('/api/chatbot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            hideTyping();
            if (d.ok) {
                appendMsg('bot', d.reply.text, d.reply.links);
            } else {
                appendMsg('bot', '\u26a0\ufe0f ' + (d.error || '\u30a8\u30e9\u30fc'), []);
            }
        })
        .catch(function () {
            hideTyping();
            appendMsg('bot', '\u26a0\ufe0f \u901a\u4fe1\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f', []);
        })
        .finally(function () {
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        });
    }

    fab.addEventListener('click', function () {
        if (!opened) {
            panel.classList.add('cb-open');
            opened = true;
            if (msgs.childElementCount === 0) {
                appendMsg('bot', 'こんにちは！👋\n\nDXPRO AIアシスタントです。勤怠・目標・休暇・評価などについて何でも聞いてください。', []);
            }
            setTimeout(function () { if (input) input.focus(); }, 100);
        } else {
            panel.classList.remove('cb-open');
            opened = false;
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            panel.classList.remove('cb-open');
            opened = false;
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', function () {
            sendMessage(input ? input.value : '');
        });
    }

    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input.value);
            }
        });
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 80) + 'px';
        });
    }

    suggs.forEach(function (b) {
        b.addEventListener('click', function () {
            sendMessage(b.textContent.trim());
        });
    });
})();
