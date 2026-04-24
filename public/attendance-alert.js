// attendance-alert.js
// 打刻入力・編集ボタンのアラート表示用

document.addEventListener('DOMContentLoaded', function() {
  // 打刻追加ボタン
  const addBtn = document.querySelector('a[href="/add-attendance"]');
  if (addBtn) {
    addBtn.addEventListener('click', function(e) {
      if (!confirm('GPS打刻以外の操作です。\nこの操作は管理者に通知されます。\n続行しますか？')) {
        e.preventDefault();
      }
    });
  }

  // 編集ボタン（本日分）
  const editTodayBtn = document.querySelector('.attendance-today a.btn.btn--ghost[href^="/edit-attendance/"]');
  if (editTodayBtn) {
    editTodayBtn.addEventListener('click', function(e) {
      if (!confirm('この操作は管理者に通知されます。\n続行しますか？')) {
        e.preventDefault();
      }
    });
  }

  // 編集ボタン（一覧テーブル）
  document.querySelectorAll('.att-table a.btn.btn--ghost[href^="/edit-attendance/"]').forEach(function(editBtn) {
    editBtn.addEventListener('click', function(e) {
      if (!confirm('この操作は管理者に通知されます。\n続行しますか？')) {
        e.preventDefault();
      }
    });
  });
});
