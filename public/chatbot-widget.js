(function () {
  "use strict";
  var fab = document.getElementById("cb-fab");
  var panel = document.getElementById("cb-panel");
  var closeBtn = document.getElementById("cb-close");
  var resetBtn = document.getElementById("cb-reset");
  var msgs = document.getElementById("cb-messages");
  var input = document.getElementById("cb-input");
  var sendBtn = document.getElementById("cb-send");
  var suggs = document.querySelectorAll(".cb-sug-btn");
  var opened = false;

  // 確認待ちアクション（2ステップ確認フロー）
  var pendingAction = null;
  // 会話履歴（OpenAIコンテキスト用、最大6メッセージ）
  var chatHistory = [];

  if (!fab || !panel) {
    console.error("[Chatbot] #cb-fab or #cb-panel not found in DOM");
    return;
  }

  var WELCOME_TEXT =
    "こんにちは！\n\n**DXPRO AIアシスタント**です。\n勤怠・目標・休暇・給与・評価など何でも聞いてください。\n\n🚀 **実行型コマンド例：**\n• 「来週月曜10時に営業会議を登録して」\n• 「来週金曜に有休申請して」\n• 「承認待ちを承認して」\n\n💡 「**今日の状況は？**」で全体サマリーを確認できます！";
  var WELCOME_QR = [
    "今日の状況は？",
    "予定を登録する",
    "有休申請する",
    "承認する",
  ];

  function renderText(t) {
    return String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function attachQrHandlers(container) {
    container.querySelectorAll(".cb-qr-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendMessage(btn.textContent.trim());
      });
    });
  }

  function appendMsg(role, text, links, quickReplies) {
    var w = document.createElement("div");
    w.className = "cb-msg cb-" + role;
    if (role === "bot") {
      var linksHtml = "";
      if (links && links.length) {
        linksHtml =
          '<div class="cb-links">' +
          links
            .map(function (l) {
              return (
                '<a href="' +
                l.url +
                '" class="cb-link-btn">' +
                renderText(l.label) +
                "</a>"
              );
            })
            .join("") +
          "</div>";
      }
      var qrHtml = "";
      if (quickReplies && quickReplies.length) {
        qrHtml =
          '<div class="cb-qr-row">' +
          quickReplies
            .map(function (qr) {
              return (
                '<button class="cb-qr-btn" type="button">' +
                renderText(qr) +
                "</button>"
              );
            })
            .join("") +
          "</div>";
      }
      w.innerHTML =
        '<div class="cb-bot-icon"><i class="fa-solid fa-robot"></i></div>' +
        '<div><div class="cb-bubble">' +
        renderText(text) +
        "</div>" +
        linksHtml +
        qrHtml +
        "</div>";
      attachQrHandlers(w);
    } else {
      w.innerHTML = '<div class="cb-bubble">' + renderText(text) + "</div>";
    }
    msgs.appendChild(w);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTyping() {
    var w = document.createElement("div");
    w.className = "cb-msg cb-bot";
    w.id = "cb-typ";
    w.innerHTML =
      '<div class="cb-bot-icon"><i class="fa-solid fa-robot"></i></div>' +
      '<div class="cb-bubble cb-typing"><span></span><span></span><span></span></div>';
    msgs.appendChild(w);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideTyping() {
    var e = document.getElementById("cb-typ");
    if (e) e.remove();
  }

  function resetChat() {
    msgs.innerHTML = "";
    pendingAction = null;
    chatHistory = [];
    var sa = document.getElementById("cb-suggestions");
    if (sa) sa.style.display = "";
    appendMsg("bot", WELCOME_TEXT, [], WELCOME_QR);
    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
  }

  function sendMessage(text) {
    text = (text || "").trim();
    if (!text) return;
    appendMsg("user", text, []);
    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
    if (sendBtn) sendBtn.disabled = true;
    var sa = document.getElementById("cb-suggestions");
    if (sa) sa.style.display = "none";
    showTyping();
    // pendingAction・chatHistoryをcontextとして渡す
    var ctx = {};
    if (pendingAction) ctx.pendingAction = pendingAction;
    if (chatHistory.length) ctx.chatHistory = chatHistory;
    pendingAction = null; // 送信時にリセット
    fetch("/api/chatbot", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, context: ctx }),
    })
      .then(function (r) {
        if (r.status === 302 || r.redirected) {
          throw new Error("session_expired");
        }
        var ct = r.headers.get("Content-Type") || "";
        if (!ct.includes("application/json")) {
          throw new Error("not_json");
        }
        return r.json();
      })
      .then(function (d) {
        hideTyping();
        if (d.ok) {
          // pendingAction・chatHistoryを保存
          if (d.reply.pendingAction) {
            pendingAction = d.reply.pendingAction;
          }
          if (d.reply.chatHistory) {
            chatHistory = d.reply.chatHistory;
          }
          appendMsg("bot", d.reply.text, d.reply.links, d.reply.quickReplies);
        } else {
          appendMsg("bot", "⚠️ " + (d.error || "エラーが発生しました"), []);
        }
      })
      .catch(function (err) {
        hideTyping();
        pendingAction = null;
        if (
          err &&
          (err.message === "session_expired" || err.message === "not_json")
        ) {
          appendMsg(
            "bot",
            "⚠️ セッションが切れました。ページを再読み込みしてください。",
            [],
          );
        } else {
          appendMsg(
            "bot",
            "⚠️ 通信エラーが発生しました。再度お試しください。",
            [],
          );
        }
      })
      .finally(function () {
        if (sendBtn) sendBtn.disabled = false;
        if (input) input.focus();
      });
  }

  fab.addEventListener("click", function () {
    if (!opened) {
      panel.classList.add("cb-open");
      opened = true;
      if (msgs.childElementCount === 0) {
        appendMsg("bot", WELCOME_TEXT, [], WELCOME_QR);
      }
      setTimeout(function () {
        if (input) input.focus();
      }, 100);
    } else {
      panel.classList.remove("cb-open");
      opened = false;
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      panel.classList.remove("cb-open");
      opened = false;
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      resetChat();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", function () {
      sendMessage(input ? input.value : "");
    });
  }

  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
    input.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 80) + "px";
    });
  }

  suggs.forEach(function (b) {
    b.addEventListener("click", function () {
      sendMessage(b.textContent.trim());
    });
  });
})();
