#!/usr/bin/env node
// Patch routes/schedule.js with full i18n support for all 7 requested areas

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "routes", "schedule.js");
let src = fs.readFileSync(filePath, "utf8");
// Normalize line endings to LF for cross-platform matching
src = src.replace(/\r\n/g, "\n");
// Convert Unicode escape sequences to actual characters for matching
src = src.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
  String.fromCharCode(parseInt(hex, 16)),
);
// Replace escaped template literal syntax with placeholders so old/new strings can use them directly
const _BT = "\x00BT\x00"; // placeholder for \`
const _TD = "\x00TD\x00"; // placeholder for \${
src = src.replace(/\\`/g, _BT).replace(/\\\$\{/g, _TD);

let errors = 0;
function rep(old, nw, required = true) {
  if (src.includes(old)) {
    src = src.replace(old, nw);
    return true;
  }
  if (required) {
    console.error("NOT FOUND:", JSON.stringify(old.substring(0, 100)));
    errors++;
  }
  return false;
}

// ── 1. Server-side: Add fcLocale computation ──────────────────────────────
rep(
  `  const lang = req.lang || req.session?.lang || "ja";`,
  `  const lang = req.lang || req.session?.lang || "ja";
  const fcLocaleMap = { ja: 'ja', en: 'en', vi: 'vi', ko: 'ko', zh: 'zh-cn' };
  const fcLocale = fcLocaleMap[lang] || 'ja';`,
);

// ── 2. Inject _schI18n object + helper before IIFE ────────────────────────
rep(
  `<script>
(function(){`,
  `<script>
var _schI18n = {
  fcToday:           \${JSON.stringify(t("schedule.fc_today", lang))},
  fcMonth:           \${JSON.stringify(t("schedule.fc_month", lang))},
  fcWeek:            \${JSON.stringify(t("schedule.fc_week", lang))},
  fcDay:             \${JSON.stringify(t("schedule.fc_day", lang))},
  typeMeeting:       \${JSON.stringify(t("schedule.type_meeting_label", lang))},
  typeEvent:         \${JSON.stringify(t("schedule.type_event_label", lang))},
  typeOther:         \${JSON.stringify(t("schedule.type_other_label", lang))},
  visPublic:         \${JSON.stringify(t("schedule.vis_public", lang))},
  visPrivate:        \${JSON.stringify(t("schedule.vis_private", lang))},
  allDay:            \${JSON.stringify(t("schedule.all_day", lang))},
  organizer:         \${JSON.stringify(t("schedule.organizer", lang))},
  attendeesN:        \${JSON.stringify(t("schedule.attendees_n", lang))},
  statusPending:     \${JSON.stringify(t("schedule.status_pending", lang))},
  statusAccepted:    \${JSON.stringify(t("schedule.status_accepted", lang))},
  statusDeclined:    \${JSON.stringify(t("schedule.status_declined", lang))},
  respondAccept:     \${JSON.stringify(t("schedule.respond_accept", lang))},
  respondDecline:    \${JSON.stringify(t("schedule.respond_decline", lang))},
  respondJoinCall:   \${JSON.stringify(t("schedule.respond_join_call", lang))},
  attLabel:          \${JSON.stringify(t("schedule.att_label", lang))},
  attNone:           \${JSON.stringify(t("schedule.att_none", lang))},
  attAddUrl:         \${JSON.stringify(t("schedule.att_add_url", lang))},
  attAddFile:        \${JSON.stringify(t("schedule.att_add_file", lang))},
  attUrlNamePh:      \${JSON.stringify(t("schedule.att_url_name_ph", lang))},
  attUrlAddBtn:      \${JSON.stringify(t("schedule.att_url_add_btn", lang))},
  extCalAdd:         \${JSON.stringify(t("schedule.ext_cal_add", lang))},
  extCalNote:        \${JSON.stringify(t("schedule.ext_cal_note", lang))},
  extCalGoogle:      \${JSON.stringify(t("schedule.ext_cal_google", lang))},
  extCalIcal:        \${JSON.stringify(t("schedule.ext_cal_ical", lang))},
  commentThread:     \${JSON.stringify(t("schedule.comment_thread", lang))},
  commentPh:         \${JSON.stringify(t("schedule.comment_placeholder", lang))},
  commentSend:       \${JSON.stringify(t("schedule.comment_send", lang))},
  commentLoading:    \${JSON.stringify(t("schedule.comment_loading", lang))},
  commentEmpty:      \${JSON.stringify(t("schedule.comment_empty", lang))},
  commentJustNow:    \${JSON.stringify(t("schedule.comment_just_now", lang))},
  commentMinAgo:     \${JSON.stringify(t("schedule.comment_min_ago", lang))},
  commentHourAgo:    \${JSON.stringify(t("schedule.comment_hour_ago", lang))},
  commentEdit:       \${JSON.stringify(t("schedule.comment_edit", lang))},
  commentDelete:     \${JSON.stringify(t("schedule.comment_delete", lang))},
  commentSaveBtn:    \${JSON.stringify(t("schedule.comment_save", lang))},
  commentCancel:     \${JSON.stringify(t("schedule.comment_cancel", lang))},
  commentEdited:     \${JSON.stringify(t("schedule.comment_edited", lang))},
  commentNoMatch:    \${JSON.stringify(t("schedule.comment_no_match", lang))},
  formNewTitle:      \${JSON.stringify(t("schedule.form_new_title", lang))},
  formEditTitle:     \${JSON.stringify(t("schedule.form_edit_title", lang))},
  formCloneTitle:    \${JSON.stringify(t("schedule.form_clone_title", lang))},
  cloneSuffix:       \${JSON.stringify(t("schedule.clone_suffix", lang))},
  attendeesPh:       \${JSON.stringify(t("schedule.attendees_placeholder", lang))},
  attendeesSearchPh: \${JSON.stringify(t("schedule.attendees_search_ph", lang))},
  loadingText:       \${JSON.stringify(t("schedule.loading", lang))},
  upcomingEmpty:     \${JSON.stringify(t("schedule.upcoming_empty", lang))},
  seriesTitleEdit:   \${JSON.stringify(t("schedule.series_title_edit", lang))},
  seriesTitleDelete: \${JSON.stringify(t("schedule.series_title_delete", lang))},
  seriesSubEdit:     \${JSON.stringify(t("schedule.series_sub_edit", lang))},
  seriesSubDelete:   \${JSON.stringify(t("schedule.series_sub_delete", lang))},
  delConfirm:        \${JSON.stringify(t("schedule.del_confirm", lang))},
  delConfirmSingle:  \${JSON.stringify(t("schedule.del_confirm_single", lang))},
  delFutureLbl:      \${JSON.stringify(t("schedule.del_series_future_lbl", lang))},
  delAllLbl:         \${JSON.stringify(t("schedule.del_series_all_lbl", lang))},
  delSeriesConfirm:  \${JSON.stringify(t("schedule.del_series_confirm", lang))},
  delCountOk:        \${JSON.stringify(t("schedule.del_count_ok", lang))},
  delBulkConfirm:    \${JSON.stringify(t("schedule.del_bulk_confirm", lang))},
  bulkSelectedN:     \${JSON.stringify(t("schedule.bulk_selected_n", lang))},
  bulkSaved:         \${JSON.stringify(t("schedule.bulk_saved", lang))},
  colorChangeOk:     \${JSON.stringify(t("schedule.color_change_ok", lang))},
  invalidColor:      \${JSON.stringify(t("schedule.invalid_color", lang))},
  errDateOrder:      \${JSON.stringify(t("schedule.err_date_order", lang))},
  errCallNeedAtt:    \${JSON.stringify(t("schedule.err_call_need_attendee", lang))},
  errRepeatUntilReq: \${JSON.stringify(t("schedule.err_repeat_until_required", lang))},
  errRepeatUntilPast:\${JSON.stringify(t("schedule.err_repeat_until_past", lang))},
  errRepeatDaysReq:  \${JSON.stringify(t("schedule.err_repeat_days_required", lang))},
  saveFailed:        \${JSON.stringify(t("schedule.save_failed", lang))},
  networkError:      \${JSON.stringify(t("schedule.network_error", lang))},
  errCallNoRoom:     \${JSON.stringify(t("schedule.err_call_no_room", lang))},
  errDateUpdate:     \${JSON.stringify(t("schedule.err_date_update", lang))},
  errDataFetch:      \${JSON.stringify(t("schedule.err_data_fetch", lang))},
  errGeneral:        \${JSON.stringify(t("schedule.err_general", lang))},
  attUploadFailed:   \${JSON.stringify(t("schedule.att_upload_failed", lang))},
  attUrlAddFailed:   \${JSON.stringify(t("schedule.att_url_add_failed", lang))},
  attDelConfirm:     \${JSON.stringify(t("schedule.att_del_confirm", lang))},
  attDelFailed:      \${JSON.stringify(t("schedule.att_del_failed", lang))},
  attUrlInvalid:     \${JSON.stringify(t("schedule.att_url_invalid", lang))},
  attUrlInvalidScheme: \${JSON.stringify(t("schedule.att_url_invalid_scheme", lang))},
  cmtDelConfirm:     \${JSON.stringify(t("schedule.comment_del_confirm", lang))},
  cmtSendFailed:     \${JSON.stringify(t("schedule.comment_send_failed", lang))},
  cmtDelFailed:      \${JSON.stringify(t("schedule.comment_del_failed", lang))},
  cmtEditFailed:     \${JSON.stringify(t("schedule.comment_edit_failed", lang))},
  respondFailed:     \${JSON.stringify(t("schedule.respond_failed", lang))},
};
function _schTpl(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, function(m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
}
(function(){`,
);

// ── 3. FullCalendar: locale and buttonText ────────────────────────────────
rep(`            locale: 'ja',`, `            locale: '\${fcLocale}',`);

rep(
  `            buttonText: { today:'今日', month:'月', week:'週', day:'日' },`,
  `            buttonText: { today: _schI18n.fcToday, month: _schI18n.fcMonth, week: _schI18n.fcWeek, day: _schI18n.fcDay },`,
);

// ── 4. HTML: Select mode button ───────────────────────────────────────────
rep(
  `<button class="sch-select-btn" id="sch-select-btn" onclick="toggleSelectMode()">☑ 複数選択</button>`,
  `<button class="sch-select-btn" id="sch-select-btn" onclick="toggleSelectMode()">\${t("schedule.select_mode_btn", lang)}</button>`,
);

// ── 5. HTML: Upcoming loading text ────────────────────────────────────────
rep(
  `<div style="color:#94a3b8;font-size:13px;padding:12px 0;">読み込み中...</div>`,
  `<div style="color:#94a3b8;font-size:13px;padding:12px 0;">\${t("schedule.loading", lang)}</div>`,
);

// ── 6. HTML: Series scope modal ───────────────────────────────────────────
rep(
  `    <div class="sch-scope-title" id="sch-scope-title">繰り返し予定の操作</div>
    <div class="sch-scope-subtitle" id="sch-scope-subtitle">どの範囲の予定に適用しますか？</div>
    <div class="sch-scope-options">
      <div class="sch-scope-option" onclick="confirmSeriesScope('only')">
        <span class="sch-scope-icon">📅</span>この予定だけ
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('future')">
        <span class="sch-scope-icon">📆</span>この予定以降の同じシリーズ
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('all')">
        <span class="sch-scope-icon">🗓</span>同じシリーズのすべての予定
      </div>
    </div>
    <button onclick="closeSeriesModal()" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">キャンセル</button>`,
  `    <div class="sch-scope-title" id="sch-scope-title">\${t("schedule.series_title_general", lang)}</div>
    <div class="sch-scope-subtitle" id="sch-scope-subtitle">\${t("schedule.series_sub_general", lang)}</div>
    <div class="sch-scope-options">
      <div class="sch-scope-option" onclick="confirmSeriesScope('only')">
        <span class="sch-scope-icon">📅</span>\${t("schedule.series_opt_only", lang)}
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('future')">
        <span class="sch-scope-icon">📆</span>\${t("schedule.series_opt_future", lang)}
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('all')">
        <span class="sch-scope-icon">🗓</span>\${t("schedule.series_opt_all", lang)}
      </div>
    </div>
    <button onclick="closeSeriesModal()" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">\${t("schedule.series_cancel", lang)}</button>`,
);

// ── 7. HTML: Bulk bar ─────────────────────────────────────────────────────
rep(
  `  <span class="sch-bulk-count" id="sch-bulk-count">0件選択中</span>
  <div class="sch-bulk-actions">
    <button class="sch-bulk-btn sch-bulk-btn-color" onclick="bulkColorChange()">🎨 色変更</button>
    <button class="sch-bulk-btn sch-bulk-btn-delete" onclick="bulkDelete()">🗑 一括削除</button>
    <button class="sch-bulk-btn sch-bulk-btn-cancel" onclick="toggleSelectMode(false)">選択解除</button>
  </div>`,
  `  <span class="sch-bulk-count" id="sch-bulk-count"></span>
  <div class="sch-bulk-actions">
    <button class="sch-bulk-btn sch-bulk-btn-color" onclick="bulkColorChange()">\${t("schedule.bulk_color_btn", lang)}</button>
    <button class="sch-bulk-btn sch-bulk-btn-delete" onclick="bulkDelete()">\${t("schedule.bulk_delete_btn", lang)}</button>
    <button class="sch-bulk-btn sch-bulk-btn-cancel" onclick="toggleSelectMode(false)">\${t("schedule.bulk_cancel_btn", lang)}</button>
  </div>`,
);

// ── 8. HTML: Color modal ─────────────────────────────────────────────────
rep(
  `      <div style="font-size:15px;font-weight:700;color:#0f172a;">🎨 色の変更</div>`,
  `      <div style="font-size:15px;font-weight:700;color:#0f172a;">\${t("schedule.color_modal_title", lang)}</div>`,
);

rep(
  `    <div style="font-size:13px;color:#64748b;margin-bottom:14px;">プリセットから選ぶか、カスタムカラーで指定してください</div>`,
  `    <div style="font-size:13px;color:#64748b;margin-bottom:14px;">\${t("schedule.color_modal_sub", lang)}</div>`,
);

// Color modal custom label (there are two: bulk modal and form modal — match the bulk one first)
rep(
  `      <label style="font-size:13px;color:#475569;flex-shrink:0;">カスタム：</label>`,
  `      <label style="font-size:13px;color:#475569;flex-shrink:0;">\${t("schedule.color_custom_label", lang)}</label>`,
);

rep(
  `      <button onclick="closeBulkColorModal()" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">キャンセル</button>
      <button onclick="applyBulkColor()" id="sch-color-apply-btn" style="padding:8px 18px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">✓ 適用する</button>`,
  `      <button onclick="closeBulkColorModal()" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">\${t("schedule.cancel", lang)}</button>
      <button onclick="applyBulkColor()" id="sch-color-apply-btn" style="padding:8px 18px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">\${t("schedule.color_apply", lang)}</button>`,
);

// ── 9. HTML: Form modal ───────────────────────────────────────────────────
rep(
  `        <div class="sch-form-header" id="sch-form-title">スケジュール登録</div>`,
  `        <div class="sch-form-header" id="sch-form-title">\${t("schedule.form_new_title", lang)}</div>`,
);

rep(
  `                        <label>タイトル <span style="color:#ef4444;">*</span></label>
                        <input type="text" class="form-control" id="sch-title" maxlength="100" required placeholder="例: 週次定例ミーティング">`,
  `                        <label>\${t("schedule.field_title", lang)} <span style="color:#ef4444;">*</span></label>
                        <input type="text" class="form-control" id="sch-title" maxlength="100" required placeholder="\${t("schedule.title_placeholder", lang)}">`,
);

rep(
  `                        <label>種別 <span style="color:#ef4444;">*</span></label>
                        <select class="form-control" id="sch-type">
                            <option value="meeting">🤝 会議</option>
                            <option value="event">🎉 イベント</option>
                            <option value="other">📌 その他</option>
                        </select>`,
  `                        <label>\${t("schedule.field_type", lang)} <span style="color:#ef4444;">*</span></label>
                        <select class="form-control" id="sch-type">
                            <option value="meeting">\${t("schedule.type_opt_meeting", lang)}</option>
                            <option value="event">\${t("schedule.type_opt_event", lang)}</option>
                            <option value="other">\${t("schedule.type_opt_other", lang)}</option>
                        </select>`,
);

rep(
  `                        <label>表示色</label>`,
  `                        <label>\${t("schedule.field_color", lang)}</label>`,
);

// Form color picker custom label
rep(
  `                            <label>カスタム：</label>`,
  `                            <label>\${t("schedule.color_custom_label", lang)}</label>`,
);

rep(
  `                        <label>開始日時 <span style="color:#ef4444;">*</span></label>`,
  `                        <label>\${t("schedule.field_start", lang)} <span style="color:#ef4444;">*</span></label>`,
);

rep(
  `                        <label>終了日時 <span style="color:#ef4444;">*</span></label>`,
  `                        <label>\${t("schedule.field_end", lang)} <span style="color:#ef4444;">*</span></label>`,
);

rep(
  `                            <input type="checkbox" id="sch-allday" onchange="toggleAllDay(this)"> 終日`,
  `                            <input type="checkbox" id="sch-allday" onchange="toggleAllDay(this)"> \${t("schedule.field_allday", lang)}`,
);

rep(
  `                        <label>場所</label>
                        <input type="text" class="form-control" id="sch-location" placeholder="例: 会議室A / Zoom">`,
  `                        <label>\${t("schedule.field_location", lang)}</label>
                        <input type="text" class="form-control" id="sch-location" placeholder="\${t("schedule.location_placeholder", lang)}">`,
);

rep(
  `                        <label>参加者</label>
                        <div class="attendee-sel-list" id="attendee-chips" onclick="toggleAttendeeDropdown(event)">
                            <span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">クリックして参加者を選択...</span>
                        </div>
                        <div class="attendee-dropdown" id="attendee-dropdown">
                            <div class="attendee-search">
                                <input type="text" id="attendee-search-input" placeholder="名前で検索..." oninput="filterAttendees(this.value)">`,
  `                        <label>\${t("schedule.field_attendees", lang)}</label>
                        <div class="attendee-sel-list" id="attendee-chips" onclick="toggleAttendeeDropdown(event)">
                            <span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">\${t("schedule.attendees_placeholder", lang)}</span>
                        </div>
                        <div class="attendee-dropdown" id="attendee-dropdown">
                            <div class="attendee-search">
                                <input type="text" id="attendee-search-input" placeholder="\${t("schedule.attendees_search_ph", lang)}" oninput="filterAttendees(this.value)">`,
);

rep(
  `                        <label>詳細・メモ</label>
                        <textarea class="form-control" id="sch-desc" rows="3" placeholder="会議の詳細、議題など"></textarea>`,
  `                        <label>\${t("schedule.field_desc", lang)}</label>
                        <textarea class="form-control" id="sch-desc" rows="3" placeholder="\${t("schedule.desc_placeholder", lang)}"></textarea>`,
);

rep(
  `                        <label>タグ <span style="font-size:11.5px;color:#94a3b8;">（任意・Enterで追加）</span></label>
                        <div id="sch-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:38px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:text;" onclick="document.getElementById('sch-tag-input').focus()">
                            <input type="text" id="sch-tag-input" maxlength="30" placeholder="例: 重要、採用面接..."`,
  `                        <label>\${t("schedule.field_tags", lang)} <span style="font-size:11.5px;color:#94a3b8;">\${t("schedule.tags_hint", lang)}</span></label>
                        <div id="sch-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:38px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:text;" onclick="document.getElementById('sch-tag-input').focus()">
                            <input type="text" id="sch-tag-input" maxlength="30" placeholder="\${t("schedule.tags_placeholder", lang)}"`,
);

rep(
  `                        <label>公開設定</label>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <label id="sch-vis-private-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #3b82f6;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-private" value="private" checked onchange="updateVisLabel()"> 🔒 非公開（参加者のみ）
                            </label>
                            <label id="sch-vis-public-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #e2e8f0;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-public" value="public" onchange="updateVisLabel()"> 🌐 公開（全員に表示）
                            </label>
                        </div>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;">公開にすると参加者以外の全メンバーのカレンダーにも表示されます。</div>`,
  `                        <label>\${t("schedule.field_visibility", lang)}</label>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <label id="sch-vis-private-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #3b82f6;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-private" value="private" checked onchange="updateVisLabel()"> \${t("schedule.vis_private", lang)}
                            </label>
                            <label id="sch-vis-public-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #e2e8f0;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-public" value="public" onchange="updateVisLabel()"> \${t("schedule.vis_public", lang)}
                            </label>
                        </div>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;">\${t("schedule.vis_public_note", lang)}</div>`,
);

rep(
  `                            <input type="checkbox" id="sch-use-call">
                            📞 アプリ内通話を設定する（会議用チャットルームを自動生成）
                        </label>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;padding-left:22px;">ONにすると参加者と通話できる専用ルームが作成されます（参加者1名以上必要）</div>`,
  `                            <input type="checkbox" id="sch-use-call">
                            \${t("schedule.call_option", lang)}
                        </label>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;padding-left:22px;">\${t("schedule.call_option_note", lang)}</div>`,
);

rep(
  `                            <input type="checkbox" id="sch-repeat-enable" onchange="toggleRepeat(this)">
                            🔁 繰り返し登録`,
  `                            <input type="checkbox" id="sch-repeat-enable" onchange="toggleRepeat(this)">
                            \${t("schedule.repeat_option", lang)}`,
);

rep(
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">繰り返しタイプ</label>
                                <select id="sch-repeat-mode" class="form-control" onchange="onRepeatModeChange(this.value)">
                                    <option value="daily">📅 連続登録（期間内毎日）</option>
                                    <option value="weekly">📆 曜日指定</option>
                                </select>`,
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">\${t("schedule.repeat_type_label", lang)}</label>
                                <select id="sch-repeat-mode" class="form-control" onchange="onRepeatModeChange(this.value)">
                                    <option value="daily">\${t("schedule.repeat_daily_opt", lang)}</option>
                                    <option value="weekly">\${t("schedule.repeat_weekly_opt", lang)}</option>
                                </select>`,
);

rep(
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">繰り返す曜日</label>
                                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="0"> 日</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="1"> 月</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="2"> 火</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="3"> 水</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="4"> 木</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="5"> 金</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="6"> 土</label>
                                </div>`,
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">\${t("schedule.repeat_days_label", lang)}</label>
                                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="0"> \${t("schedule.day_sun", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="1"> \${t("schedule.day_mon", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="2"> \${t("schedule.day_tue", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="3"> \${t("schedule.day_wed", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="4"> \${t("schedule.day_thu", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="5"> \${t("schedule.day_fri", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="6"> \${t("schedule.day_sat", lang)}</label>
                                </div>`,
);

rep(
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">繰り返し終了日 <span style="color:#ef4444;">*</span></label>`,
  `                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">\${t("schedule.repeat_until_label", lang)} <span style="color:#ef4444;">*</span></label>`,
);

rep(
  `                            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">※ 繰り返し登録時はアプリ内通話連携は無効になります。最大100件まで登録可能。</div>`,
  `                            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">\${t("schedule.repeat_note", lang)}</div>`,
);

rep(
  `                    <label><i class="fa-solid fa-paperclip" style="color:#94a3b8;"></i> 添付資料</label>`,
  `                    <label><i class="fa-solid fa-paperclip" style="color:#94a3b8;"></i> \${t("schedule.att_section", lang)}</label>`,
);

rep(
  `                        <button type="button" class="sch-att-add-btn" onclick="openEditAddUrl()"><i class="fa-solid fa-link"></i> URLを追加</button>
                        <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> ファイルを添付`,
  `                        <button type="button" class="sch-att-add-btn" onclick="openEditAddUrl()"><i class="fa-solid fa-link"></i> \${t("schedule.att_add_url", lang)}</button>
                        <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> \${t("schedule.att_add_file", lang)}`,
);

rep(
  `                        <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-link" style="color:#3b82f6;"></i> URLを追加</div>
                        <div class="sch-att-url-row">
                            <input type="text" id="sch-form-att-url-name" class="sch-att-url-input" placeholder="表示名（省略可）" style="max-width:160px;">
                            <input type="url" id="sch-form-att-url-val" class="sch-att-url-input" placeholder="https://...">
                            <button type="button" class="sch-att-url-submit" onclick="submitEditUrl()">追加</button>`,
  `                        <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-link" style="color:#3b82f6;"></i> \${t("schedule.att_add_url", lang)}</div>
                        <div class="sch-att-url-row">
                            <input type="text" id="sch-form-att-url-name" class="sch-att-url-input" placeholder="\${t("schedule.att_url_name_ph", lang)}" style="max-width:160px;">
                            <input type="url" id="sch-form-att-url-val" class="sch-att-url-input" placeholder="https://...">
                            <button type="button" class="sch-att-url-submit" onclick="submitEditUrl()">\${t("schedule.att_url_add_btn", lang)}</button>`,
);

rep(
  `                    <button type="button" class="btn" style="background:#f1f5f9;color:#475569;" onclick="closeFormModal()">キャンセル</button>
                    <button type="submit" class="btn btn-primary" id="sch-submit-btn"><i class="fa-solid fa-check"></i> 保存</button>`,
  `                    <button type="button" class="btn" style="background:#f1f5f9;color:#475569;" onclick="closeFormModal()">\${t("schedule.cancel", lang)}</button>
                    <button type="submit" class="btn btn-primary" id="sch-submit-btn"><i class="fa-solid fa-check"></i> \${t("schedule.save", lang)}</button>`,
);

// ── 10. JS: loadUpcoming — type labels and empty message ──────────────────
rep(
  `                if (!events.length) { el.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px 0;">直近30日間に予定はありません</div>'; return; }
                el.innerHTML = events.map(ev => {
                    const typeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
                    const typeLabel = { meeting:'会議', event:'イベント', other:'その他' };`,
  `                if (!events.length) { el.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px 0;">' + _schI18n.upcomingEmpty + '</div>'; return; }
                el.innerHTML = events.map(ev => {
                    const typeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
                    const typeLabel = { meeting: _schI18n.typeMeeting, event: _schI18n.typeEvent, other: _schI18n.typeOther };`,
);

// ── 11. JS: renderDetail — typeLabelMap, STATUS_LABEL_JP ─────────────────
rep(
  `        const typeLabelMap = { meeting:'会議', event:'イベント', other:'その他' };`,
  `        const typeLabelMap = { meeting: _schI18n.typeMeeting, event: _schI18n.typeEvent, other: _schI18n.typeOther };`,
);

rep(
  `    const STATUS_LABEL_JP = { pending:'未返答', accepted:'承諾', declined:'辞退' };`,
  `    const STATUS_LABEL_JP = { pending: _schI18n.statusPending, accepted: _schI18n.statusAccepted, declined: _schI18n.statusDeclined };`,
);

// attendee status fallback
rep(
  `            const statusStr = st ? (\`\${STATUS_ICON[st.status]||'⏳'} \${STATUS_LABEL_JP[st.status]||''}\`) : '⏳ 未返答';`,
  `            const statusStr = st ? (\`\${STATUS_ICON[st.status]||'⏳'} \${STATUS_LABEL_JP[st.status]||''}\`) : '⏳ ' + _schI18n.statusPending;`,
);

// ── 12. JS: renderDetail — vis HTML ──────────────────────────────────────
rep(
  `        const visHtml = \`<div class="sch-modal-row"><div class="sch-modal-row-icon">\${s.visibility === 'public' ? '<i class="fa-solid fa-globe" style="color:#22c55e;"></i>' : '<i class="fa-solid fa-lock" style="color:#94a3b8;"></i>'}</div><div style="font-size:13px;color:#64748b;">\${s.visibility === 'public' ? '🌐 公開（全員に表示）' : '🔒 非公開（参加者のみ）'}</div></div>\`;`,
  `        const visHtml = \`<div class="sch-modal-row"><div class="sch-modal-row-icon">\${s.visibility === 'public' ? '<i class="fa-solid fa-globe" style="color:#22c55e;"></i>' : '<i class="fa-solid fa-lock" style="color:#94a3b8;"></i>'}</div><div style="font-size:13px;color:#64748b;">\${s.visibility === 'public' ? _schI18n.visPublic : _schI18n.visPrivate}</div></div>\`;`,
);

// ── 13. JS: renderDetail — respond buttons ────────────────────────────────
rep(
  `        const respondHtml = (!isCreator && isAttendee) ? \`
        <div class="sch-respond-row">
            <button class="btn btn-success" style="flex:1;font-size:13px;" onclick="respondSchedule('\${s._id}','accepted')"><i class="fa-solid fa-check"></i> 参加する</button>
            <button class="btn" style="flex:1;background:#fee2e2;color:#b91c1c;font-size:13px;" onclick="respondSchedule('\${s._id}','declined')"><i class="fa-solid fa-xmark"></i> 辞退する</button>
        </div>\` : '';`,
  `        const respondHtml = (!isCreator && isAttendee) ? \`
        <div class="sch-respond-row">
            <button class="btn btn-success" style="flex:1;font-size:13px;" onclick="respondSchedule('\${s._id}','accepted')"><i class="fa-solid fa-check"></i> \${_schI18n.respondAccept}</button>
            <button class="btn" style="flex:1;background:#fee2e2;color:#b91c1c;font-size:13px;" onclick="respondSchedule('\${s._id}','declined')"><i class="fa-solid fa-xmark"></i> \${_schI18n.respondDecline}</button>
        </div>\` : '';`,
);

// ── 14. JS: renderDetail — call button ────────────────────────────────────
rep(
  `        const callHtml = s.chatRoomId ? \`
        <button class="sch-call-btn" onclick="joinScheduleCall('\${s.chatRoomId}', '\${_declinedIds}')">
            <i class="fa-solid fa-phone"></i> 通話に参加する
        </button>\` : '';`,
  `        const callHtml = s.chatRoomId ? \`
        <button class="sch-call-btn" onclick="joinScheduleCall('\${s.chatRoomId}', '\${_declinedIds}')">
            <i class="fa-solid fa-phone"></i> \${_schI18n.respondJoinCall}
        </button>\` : '';`,
);

// ── 15. JS: renderDetail — external calendar export ──────────────────────
rep(
  `            '<i class="fa-solid fa-calendar-arrow-up" style="font-size:11px;"></i>&nbsp;外部カレンダーに追加&nbsp;<i class="fa-solid fa-chevron-down" style="font-size:10px;"></i></button>' +`,
  `            '<i class="fa-solid fa-calendar-arrow-up" style="font-size:11px;"></i>&nbsp;' + _schI18n.extCalAdd + '&nbsp;<i class="fa-solid fa-chevron-down" style="font-size:10px;"></i></button>' +`,
);

rep(
  `            '<p style="font-size:11px;color:#94a3b8;margin:0 0 6px 0;">連携先を選んでください（意図した連携のみ実行してください）</p>' +`,
  `            '<p style="font-size:11px;color:#94a3b8;margin:0 0 6px 0;">' + _schI18n.extCalNote + '</p>' +`,
);

rep(
  `            '<i class="fa-brands fa-google"></i> Google カレンダーに追加</a>' +`,
  `            '<i class="fa-brands fa-google"></i> ' + _schI18n.extCalGoogle + '</a>' +`,
);

rep(
  `            '<i class="fa-regular fa-calendar-plus"></i> iCal / Outlook / Apple Calendar (.ics) をダウンロード</a>' +`,
  `            '<i class="fa-regular fa-calendar-plus"></i> ' + _schI18n.extCalIcal + '</a>' +`,
);

// ── 16. JS: renderDetail — attachment HTML ───────────────────────────────
rep(
  `        }).join('') : '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">添付資料はありません</div>';`,
  `        }).join('') : '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">' + _schI18n.attNone + '</div>';`,
);

rep(
  `                <button class="sch-att-add-btn" onclick="openAddUrl('\${s._id}')"><i class="fa-solid fa-link"></i> URLを追加</button>
                <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> ファイルを添付`,
  `                <button class="sch-att-add-btn" onclick="openAddUrl('\${s._id}')"><i class="fa-solid fa-link"></i> \${_schI18n.attAddUrl}</button>
                <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> \${_schI18n.attAddFile}`,
);

rep(
  `                    <input type="text" id="sch-att-url-name-\${s._id}" class="sch-att-url-input" placeholder="表示名（省略可）" style="max-width:160px;">`,
  `                    <input type="text" id="sch-att-url-name-\${s._id}" class="sch-att-url-input" placeholder="\${_schI18n.attUrlNamePh}" style="max-width:160px;">`,
);

rep(
  `                    <button class="sch-att-url-submit" onclick="submitAddUrl('\${s._id}')">追加</button>`,
  `                    <button class="sch-att-url-submit" onclick="submitAddUrl('\${s._id}')">\${_schI18n.attUrlAddBtn}</button>`,
);

rep(
  `        <div style="font-weight:600;margin-bottom:8px;font-size:13px;">添付資料（\${_atts.length}件）</div>`,
  `        <div style="font-weight:600;margin-bottom:8px;font-size:13px;">\${_schTpl(_schI18n.attLabel, {n: _atts.length})}</div>`,
);

// ── 17. JS: renderDetail — detail modal body labels ──────────────────────
rep(
  `            <div>\${startStr} 〜 \${endStr}\${s.allDay ? ' （終日）' : ''}</div>`,
  `            <div>\${startStr} 〜 \${endStr}\${s.allDay ? ' （' + _schI18n.allDay + '）' : ''}</div>`,
);

rep(
  `                <div>主催者: \${escHtml(s.createdByName||'')} &nbsp;`,
  `                <div>\${_schI18n.organizer}: \${escHtml(s.createdByName||'')} &nbsp;`,
);

rep(
  `                    <div style="margin-bottom:6px;font-weight:600;">参加者（\${s.attendees.length}名）</div>`,
  `                    <div style="margin-bottom:6px;font-weight:600;">\${_schTpl(_schI18n.attendeesN, {n: s.attendees.length})}</div>`,
);

// ── 18. JS: renderDetail — comment HTML (Unicode escapes) ────────────────
rep(
  `                <div style="font-weight:600;margin-bottom:8px;font-size:13px;">\u30b9\u30ec\u30c3\u30c9 <span id="sch-cmt-badge-\${s._id}" class="sch-cmt-badge" style="display:none;"></span></div>`,
  `                <div style="font-weight:600;margin-bottom:8px;font-size:13px;">\${_schI18n.commentThread} <span id="sch-cmt-badge-\${s._id}" class="sch-cmt-badge" style="display:none;"></span></div>`,
);

rep(
  `                    <div id="sch-cmt-list-\${s._id}" class="sch-cmt-list"><div style="color:#94a3b8;font-size:13px;padding:8px 0;">\u8aad\u307f\u8fbc\u307f\u4e2d\u2026</div></div>`,
  `                    <div id="sch-cmt-list-\${s._id}" class="sch-cmt-list"><div style="color:#94a3b8;font-size:13px;padding:8px 0;">\${_schI18n.commentLoading}</div></div>`,
);

rep(
  `                    <textarea id="sch-cmt-body-\${s._id}" class="sch-cmt-textarea" placeholder="\u30b3\u30e1\u30f3\u30c8\u3092\u5165\u529b\u2026 @\u540d\u524d\u3067\u30e1\u30f3\u30b7\u30e7\u30f3\uff08Ctrl+Enter\u3067\u9001\u4fe1\uff09"`,
  `                    <textarea id="sch-cmt-body-\${s._id}" class="sch-cmt-textarea" placeholder="\${_schI18n.commentPh}"`,
);

rep(
  `                        <button type="button" class="btn btn-primary" style="padding:4px 14px;font-size:12px;" data-action="submit-comment" data-sched-id="\${s._id}"><i class="fa-solid fa-paper-plane"></i> \u9001\u4fe1</button>`,
  `                        <button type="button" class="btn btn-primary" style="padding:4px 14px;font-size:12px;" data-action="submit-comment" data-sched-id="\${s._id}"><i class="fa-solid fa-paper-plane"></i> \${_schI18n.commentSend}</button>`,
);

// ── 19. JS: comment functions (Unicode escapes) ───────────────────────────
// fmtCmtTime
rep(
  `        if (diff < 60000)   return '\u305f\u3063\u305f\u4eca';
        if (diff < 3600000) return Math.floor(diff / 60000) + '\u5206\u524d';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '\u6642\u9593\u524d';`,
  `        if (diff < 60000)   return _schI18n.commentJustNow;
        if (diff < 3600000) return _schTpl(_schI18n.commentMinAgo, { n: Math.floor(diff / 60000) });
        if (diff < 86400000) return _schTpl(_schI18n.commentHourAgo, { n: Math.floor(diff / 3600000) });`,
);

// renderCommentList — empty message
rep(
  `        list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:8px 0;">\u30b3\u30e1\u30f3\u30c8\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002</div>';`,
  `        list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:8px 0;">' + _schI18n.commentEmpty + '</div>';`,
);

// renderCommentList — edit/delete buttons
rep(
  `                  + '<button class="sch-cmt-act-btn" data-action="edit-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">\u7de8\u96c6</button>'
                  + '<button class="sch-cmt-act-btn" style="color:#b91c1c;" data-action="delete-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">\u524a\u9664</button>'`,
  `                  + '<button class="sch-cmt-act-btn" data-action="edit-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">' + _schI18n.commentEdit + '</button>'
                  + '<button class="sch-cmt-act-btn" style="color:#b91c1c;" data-action="delete-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">' + _schI18n.commentDelete + '</button>'`,
);

// renderCommentList — edited mark
rep(
  `            var editedMark = c.editedAt ? ' <span class="sch-cmt-edited">(\u7de8\u96c6\u6e08\u307f)</span>' : '';`,
  `            var editedMark = c.editedAt ? ' <span class="sch-cmt-edited">' + _schI18n.commentEdited + '</span>' : '';`,
);

// startEditComment — cancel/save buttons
rep(
  `            + '<button class="sch-cmt-act-btn" data-action="cancel-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">\u30ad\u30e3\u30f3\u30bb\u30eb</button>'
            + '<button class="sch-cmt-act-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6;" data-action="save-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">\u4fdd\u5b58</button>'`,
  `            + '<button class="sch-cmt-act-btn" data-action="cancel-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">' + _schI18n.commentCancel + '</button>'
            + '<button class="sch-cmt-act-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6;" data-action="save-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">' + _schI18n.commentSaveBtn + '</button>'`,
);

// submitComment — error
rep(
  `            if (!d.ok) return alert(d.error || '\u9001\u4fe1\u306b\u5931\u6557\u3057\u307e\u3057\u305f');`,
  `            if (!d.ok) return alert(d.error || _schI18n.cmtSendFailed);`,
);

// deleteComment — confirm and error
rep(
  `        if (!confirm('\u3053\u306e\u30b3\u30e1\u30f3\u30c8\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f')) return;
        fetch('/api/schedule/' + schedId + '/comments/' + cmtId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => { if (!d.ok) alert(d.error || '\u524a\u9664\u306b\u5931\u6557'); else loadComments(schedId); });`,
  `        if (!confirm(_schI18n.cmtDelConfirm)) return;
        fetch('/api/schedule/' + schedId + '/comments/' + cmtId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => { if (!d.ok) alert(d.error || _schI18n.cmtDelFailed); else loadComments(schedId); });`,
);

// saveEditComment — error
rep(
  `            if (!d.ok) return alert(d.error || '\u7de8\u96c6\u306b\u5931\u6557\u3057\u307e\u3057\u305f');`,
  `            if (!d.ok) return alert(d.error || _schI18n.cmtEditFailed);`,
);

// ── 20. JS: renderEditFormAtts — empty message ────────────────────────────
rep(
  `        list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">添付資料はありません</div>';`,
  `        list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">' + _schI18n.attNone + '</div>';`,
);

// ── 21. JS: deleteAttachment — confirm and error ─────────────────────────
rep(
  `        if (!confirm('この添付を削除しますか？')) return;
        fetch('/api/schedule/' + schedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || '削除に失敗しました');
                openDetail(schedId);
            });`,
  `        if (!confirm(_schI18n.attDelConfirm)) return;
        fetch('/api/schedule/' + schedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);
                openDetail(schedId);
            });`,
);

// ── 22. JS: deleteEditAtt — confirm and error ────────────────────────────
rep(
  `        if (!confirm('この添付を削除しますか？')) return;
        fetch('/api/schedule/' + _editFormSchedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || '削除に失敗しました');`,
  `        if (!confirm(_schI18n.attDelConfirm)) return;
        fetch('/api/schedule/' + _editFormSchedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);`,
);

// ── 23. JS: submitAddUrl — errors (detail modal URL add) ─────────────────
rep(
  `        if (!url) { alert('URLを入力してください'); return; }
        if (url.indexOf('http') !== 0) { alert('http:// または https:// で始まるURLを入力してください'); return; }
        if (!name) name = url;
        fetch('/api/schedule/' + schedId + '/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachType: 'url', name: name, url: url }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || '追加に失敗しました');
            openDetail(schedId);
        });`,
  `        if (!url) { alert(_schI18n.attUrlInvalid); return; }
        if (url.indexOf('http') !== 0) { alert(_schI18n.attUrlInvalidScheme); return; }
        if (!name) name = url;
        fetch('/api/schedule/' + schedId + '/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachType: 'url', name: name, url: url }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.attUrlAddFailed);
            openDetail(schedId);
        });`,
);

// ── 24. JS: uploadAttachFiles — error (detail modal) ─────────────────────
rep(
  `        fetch('/api/schedule/' + schedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || 'アップロードに失敗しました');
                openDetail(schedId);
            });`,
  `        fetch('/api/schedule/' + schedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attUploadFailed);
                openDetail(schedId);
            });`,
);

// ── 25. JS: submitEditUrl — errors ────────────────────────────────────────
rep(
  `        if (!url) { alert('URLを入力してください'); return; }
        if (url.indexOf('http') !== 0) { alert('http:// または https:// で始まるURLを入力してください'); return; }
        if (!name) name = url;
        if (!_editFormSchedId) {`,
  `        if (!url) { alert(_schI18n.attUrlInvalid); return; }
        if (url.indexOf('http') !== 0) { alert(_schI18n.attUrlInvalidScheme); return; }
        if (!name) name = url;
        if (!_editFormSchedId) {`,
);

rep(
  `        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || '追加に失敗しました');
            if (nameEl) nameEl.value = '';`,
  `        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.attUrlAddFailed);
            if (nameEl) nameEl.value = '';`,
);

// ── 26. JS: uploadEditFiles — error ──────────────────────────────────────
rep(
  `        fetch('/api/schedule/' + _editFormSchedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || 'アップロードに失敗しました');`,
  `        fetch('/api/schedule/' + _editFormSchedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attUploadFailed);`,
);

// ── 27. JS: openDetail — error ───────────────────────────────────────────
rep(
  `            .catch(() => alert('データの取得に失敗しました'));`,
  `            .catch(() => alert(_schI18n.errDataFetch));`,
);

rep(
  `                if (!data.ok) return alert(data.error || 'エラーが発生しました');`,
  `                if (!data.ok) return alert(data.error || _schI18n.errGeneral);`,
);

// ── 28. JS: respondSchedule — error ──────────────────────────────────────
rep(
  `            if (!d.ok) return alert(d.error || 'エラー');
            openDetail(id);`,
  `            if (!d.ok) return alert(d.error || _schI18n.respondFailed);
            openDetail(id);`,
);

// ── 29. JS: joinScheduleCall — no call ───────────────────────────────────
rep(
  `        if (!chatRoomId) { alert('この予定にはアプリ内通話が設定されていません。'); return; }`,
  `        if (!chatRoomId) { alert(_schI18n.errCallNoRoom); return; }`,
);

// ── 30. JS: deleteSchedule — series scope and confirm ────────────────────
rep(
  `            document.getElementById('sch-scope-title').textContent = '繰り返し予定の削除';
            document.getElementById('sch-scope-subtitle').textContent = 'どの範囲の予定を削除しますか？';`,
  `            document.getElementById('sch-scope-title').textContent = _schI18n.seriesTitleDelete;
            document.getElementById('sch-scope-subtitle').textContent = _schI18n.seriesSubDelete;`,
);

rep(
  `        if (!confirm('このスケジュールを削除しますか？')) return;`,
  `        if (!confirm(_schI18n.delConfirm)) return;`,
);

rep(
  `                if (!d.ok) return alert(d.error || 'エラー');
                document.getElementById('sch-detail-modal').classList.remove('open');
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
            });
    };

    // ── 新規フォーム`,
  `                if (!d.ok) return alert(d.error || _schI18n.errGeneral);
                document.getElementById('sch-detail-modal').classList.remove('open');
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
            });
    };

    // ── 新規フォーム`,
);

// ── 31. JS: openEditForm — series scope ──────────────────────────────────
rep(
  `                    document.getElementById('sch-scope-title').textContent = '繰り返し予定の編集';
                    document.getElementById('sch-scope-subtitle').textContent = 'どの範囲の予定を編集しますか？';`,
  `                    document.getElementById('sch-scope-title').textContent = _schI18n.seriesTitleEdit;
                    document.getElementById('sch-scope-subtitle').textContent = _schI18n.seriesSubEdit;`,
);

rep(
  `                if (!data.ok) return alert(data.error || 'エラー');`,
  `                if (!data.ok) return alert(data.error || _schI18n.errGeneral);`,
);

// ── 32. JS: openNewForm — form title ─────────────────────────────────────
rep(
  `        document.getElementById('sch-form-title').textContent = 'スケジュール登録';`,
  `        document.getElementById('sch-form-title').textContent = _schI18n.formNewTitle;`,
);

// ── 33. JS: _fillAndOpenEditForm — form title ────────────────────────────
rep(
  `        document.getElementById('sch-form-title').textContent = 'スケジュール編集';`,
  `        document.getElementById('sch-form-title').textContent = _schI18n.formEditTitle;`,
);

// ── 34. JS: renderAttendeeChips — placeholder ────────────────────────────
rep(
  `        container.innerHTML = '<span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">クリックして参加者を選択...</span>';`,
  `        container.innerHTML = '<span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">' + _schI18n.attendeesPh + '</span>';`,
);

// ── 35. JS: renderAttendeeOpts — no match ────────────────────────────────
rep(
  `        if (!filtered.length) { container.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">該当なし</div>'; return; }`,
  `        if (!filtered.length) { container.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">' + _schI18n.commentNoMatch + '</div>'; return; }`,
);

// ── 36. JS: openCloneForm — title, clone suffix, error ───────────────────
rep(
  `                document.getElementById('sch-form-title').textContent = 'スケジュール複製（新規作成）';`,
  `                document.getElementById('sch-form-title').textContent = _schI18n.formCloneTitle;`,
);

rep(
  `                document.getElementById('sch-title').value = s.title + '（複製）';`,
  `                document.getElementById('sch-title').value = s.title + _schI18n.cloneSuffix;`,
);

rep(
  `            .catch(() => alert('データの取得に失敗しました'));`,
  `            .catch(() => alert(_schI18n.errDataFetch));`,
);

// ── 37. JS: submitSchedule — validation and alerts ───────────────────────
rep(
  `        if (new Date(startVal) >= new Date(endVal)) {
            alert('終了日時は開始日時より後に設定してください。');
            return;
        }`,
  `        if (new Date(startVal) >= new Date(endVal)) {
            alert(_schI18n.errDateOrder);
            return;
        }`,
);

rep(
  `        if (useAppCall && selectedAttendees.length === 0) {
            alert('通話を設定するには参加者を1名以上選択してください。');
            return;
        }`,
  `        if (useAppCall && selectedAttendees.length === 0) {
            alert(_schI18n.errCallNeedAtt);
            return;
        }`,
);

rep(
  `            if (!repeatUntil) { alert('繰り返し終了日を設定してください。'); return; }
            if (new Date(repeatUntil) < new Date(startVal.substring(0, 10))) {
                alert('繰り返し終了日は開始日以降に設定してください。'); return;
            }
            if (repeatMode === 'weekly' && repeatDays.length === 0) {
                alert('繰り返す曜日を1つ以上選択してください。'); return;
            }`,
  `            if (!repeatUntil) { alert(_schI18n.errRepeatUntilReq); return; }
            if (new Date(repeatUntil) < new Date(startVal.substring(0, 10))) {
                alert(_schI18n.errRepeatUntilPast); return;
            }
            if (repeatMode === 'weekly' && repeatDays.length === 0) {
                alert(_schI18n.errRepeatDaysReq); return;
            }`,
);

rep(
  `                if (!d.ok) return alert(d.error || '保存に失敗しました');`,
  `                if (!d.ok) return alert(d.error || _schI18n.saveFailed);`,
);

rep(
  `                    if (d.count && d.count > 1) alert(d.count + '件のスケジュールを一括登録しました。');`,
  `                    if (d.count && d.count > 1) alert(_schTpl(_schI18n.bulkSaved, {n: d.count}));`,
);

rep(
  `            .catch(() => { btn.disabled = false; alert('通信エラーが発生しました'); });`,
  `            .catch(() => { btn.disabled = false; alert(_schI18n.networkError); });`,
);

// ── 38. JS: updateScheduleTime — errors ──────────────────────────────────
rep(
  `                    alert(d.error || '日時の更新に失敗しました');`,
  `                    alert(d.error || _schI18n.errDateUpdate);`,
);

rep(
  `            .catch(() => { alert('通信エラーが発生しました'); revert(); });`,
  `            .catch(() => { alert(_schI18n.networkError); revert(); });`,
);

// ── 39. JS: updateBulkBar — count text ───────────────────────────────────
rep(
  `            cnt.textContent = selectedEventIds.size + '件選択中';`,
  `            cnt.textContent = _schTpl(_schI18n.bulkSelectedN, {n: selectedEventIds.size});`,
);

// ── 40. JS: confirmSeriesScope — confirm and alert ────────────────────────
rep(
  `                if (scope === 'only') {
                if (!confirm('この予定を削除しますか？')) return;`,
  `                if (scope === 'only') {
                if (!confirm(_schI18n.delConfirmSingle)) return;`,
);

rep(
  `                const label = scope === 'future' ? 'この予定以降の同じシリーズ' : '同じシリーズのすべての予定';
                if (!confirm(label + 'を削除しますか？')) return;`,
  `                const label = scope === 'future' ? _schI18n.delFutureLbl : _schI18n.delAllLbl;
                if (!confirm(_schTpl(_schI18n.delSeriesConfirm, {label: label}))) return;`,
);

rep(
  `                        if (!d.ok) return alert(d.error || 'エラー');
                        document.getElementById('sch-detail-modal').classList.remove('open');
                        if (calendar) calendar.refetchEvents();
                        loadUpcoming();
                        alert(d.count + '件のスケジュールを削除しました。');`,
  `                        if (!d.ok) return alert(d.error || _schI18n.errGeneral);
                        document.getElementById('sch-detail-modal').classList.remove('open');
                        if (calendar) calendar.refetchEvents();
                        loadUpcoming();
                        alert(_schTpl(_schI18n.delCountOk, {n: d.count}));`,
);

// ── 41. JS: bulkDelete — confirm and alerts ───────────────────────────────
rep(
  `        if (!confirm(ids.length + '件のスケジュールを削除しますか？')) return;`,
  `        if (!confirm(_schTpl(_schI18n.delBulkConfirm, {n: ids.length}))) return;`,
);

rep(
  `                if (!d.ok) return alert(d.error || '削除に失敗しました');
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
                alert(d.count + '件のスケジュールを削除しました。');`,
  `                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
                alert(_schTpl(_schI18n.delCountOk, {n: d.count}));`,
);

// ── 42. JS: applyBulkColor — errors and success ───────────────────────────
rep(
  `        if (!/^#[0-9a-fA-F]{6}$/.test(color)) { alert('カラーコードの形式が正しくありません'); return; }`,
  `        if (!/^#[0-9a-fA-F]{6}$/.test(color)) { alert(_schI18n.invalidColor); return; }`,
);

rep(
  `                if (!d.ok) return alert(d.error || '色変更に失敗しました');
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                alert(d.count + '件のスケジュールの色を変更しました。');`,
  `                if (!d.ok) return alert(d.error || _schI18n.invalidColor);
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                alert(_schTpl(_schI18n.colorChangeOk, {n: d.count}));`,
);

// ── Write output ──────────────────────────────────────────────────────────
if (errors > 0) {
  console.warn(
    `\n${errors} replacement(s) skipped (will be handled by phase2).`,
  );
}
// Restore escaped template literal syntax
src = src
  .replace(new RegExp(_BT.replace(/\x00/g, "\\x00"), "g"), "\\`")
  .replace(new RegExp(_TD.replace(/\x00/g, "\\x00"), "g"), "\\${");
fs.writeFileSync(filePath, src, "utf8");
console.log("✓ routes/schedule.js phase1 patched (partial).");
