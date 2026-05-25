// contracts-form.js - 新規契約登録フォーム用スクリプト
// TYPE_CONFIGS / STATUS_LABELS / CURRENT_VALS / selectedApprovers は
// インラインスクリプトで先に定義済み

function updateDynamicFields(typeKey) {
  var cfg = TYPE_CONFIGS.find(function (t) {
    return t.key === typeKey;
  });
  var section = document.getElementById("dynamicFieldsSection");
  var container = document.getElementById("dynamicFieldsContainer");
  if (!cfg || !cfg.fields || cfg.fields.length === 0) {
    section.style.display = "none";
    container.innerHTML = "";
    return;
  }
  section.style.display = "block";
  container.innerHTML = cfg.fields
    .map(function (f) {
      var reqMark = f.required ? '<span class="req">*</span>' : "";
      var fieldName = f.systemField
        ? f.systemField
        : "customFields[" + f.key + "]";
      var curVal = f.systemField
        ? CURRENT_VALS[f.systemField] !== undefined
          ? CURRENT_VALS[f.systemField]
          : ""
        : "";
      var input = "";
      if (f.fieldType === "select") {
        var opts = "";
        if (f.systemField === "status") {
          opts = Object.keys(STATUS_LABELS)
            .map(function (v) {
              return (
                '<option value="' +
                v +
                '"' +
                (curVal === v ? " selected" : "") +
                ">" +
                STATUS_LABELS[v] +
                "</option>"
              );
            })
            .join("");
        } else if (f.systemField === "autoRenew") {
          opts =
            '<option value="false"' +
            (curVal !== "true" ? " selected" : "") +
            '>なし</option><option value="true"' +
            (curVal === "true" ? " selected" : "") +
            ">あり</option>";
        } else {
          opts =
            '<option value="">-- 選択 --</option>' +
            (f.options || [])
              .map(function (o) {
                var oe = o.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
                return (
                  '<option value="' +
                  oe +
                  '"' +
                  (curVal === o ? " selected" : "") +
                  ">" +
                  oe +
                  "</option>"
                );
              })
              .join("");
        }
        input =
          '<select name="' +
          fieldName +
          '"' +
          (f.required ? " required" : "") +
          ">" +
          opts +
          "</select>";
      } else if (f.fieldType === "textarea") {
        input =
          '<textarea name="' +
          fieldName +
          '" rows="3"' +
          (f.required ? " required" : "") +
          ">" +
          (curVal || "") +
          "<\/textarea>";
      } else {
        var extra =
          f.systemField === "renewalPeriodMonths" ? ' min="1" max="120"' : "";
        var ph = f.label.replace(/"/g, "&quot;");
        input =
          '<input type="' +
          (f.fieldType || "text") +
          '" name="' +
          fieldName +
          '"' +
          (f.required ? " required" : "") +
          ' value="' +
          (curVal || "") +
          '" placeholder="' +
          ph +
          '"' +
          extra +
          ">";
      }
      var isFull = f.fieldType === "textarea" ? " full" : "";
      return (
        '<div class="ct-form-group' +
        isFull +
        '"><label>' +
        f.label +
        reqMark +
        "</label>" +
        input +
        "</div>"
      );
    })
    .join("");
}

function addApproverFromSelect() {
  var sel = document.getElementById("approver-select");
  if (!sel) return;
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  if (
    selectedApprovers.some(function (a) {
      return a.id === opt.value;
    })
  )
    return;
  selectedApprovers.push({
    id: opt.value,
    name: opt.getAttribute("data-name"),
  });
  renderSelected();
  sel.value = "";
}

function removeApprover(id) {
  selectedApprovers = selectedApprovers.filter(function (a) {
    return a.id !== id;
  });
  renderSelected();
}

function renderSelected() {
  var sel = document.getElementById("approver-selected");
  var inp = document.getElementById("approver-inputs");
  if (!sel || !inp) return;
  if (selectedApprovers.length === 0) {
    sel.innerHTML =
      '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">左から承認者を選んでください</div>';
    inp.innerHTML = "";
    return;
  }
  sel.innerHTML = selectedApprovers
    .map(function (a, i) {
      var n = a.name
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return (
        '<div class="ct-approver-sel-item">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:#2563eb;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">' +
        (i + 1) +
        "</span>" +
        '<div style="flex:1;font-size:13px;font-weight:600;color:#374151">' +
        n +
        "</div>" +
        '<button type="button" onclick="removeApprover(\'' +
        a.id +
        '\')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:0 4px;line-height:1" title="削除">\u00d7</button>' +
        "</div>"
      );
    })
    .join("");
  inp.innerHTML = selectedApprovers
    .map(function (a) {
      return '<input type="hidden" name="approvers" value="' + a.id + '">';
    })
    .join("");
}

// ドラッグ&ドロップ
(function () {
  var dz = document.getElementById("drop-zone");
  var fi = document.getElementById("fileInput");
  var prev = document.getElementById("file-preview");
  if (!dz || !fi || !prev) return;
  function renderPreview() {
    prev.innerHTML = "";
    Array.from(fi.files || []).forEach(function (f) {
      var d = document.createElement("div");
      d.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#eff6ff;border-radius:8px;font-size:12px;font-weight:600;color:#2563eb";
      d.textContent =
        "\uD83D\uDCCE " +
        f.name +
        " (" +
        (f.size > 1048576
          ? (f.size / 1048576).toFixed(1) + "MB"
          : (f.size / 1024).toFixed(0) + "KB") +
        ")";
      prev.appendChild(d);
    });
  }
  dz.addEventListener("dragover", function (e) {
    e.preventDefault();
    dz.classList.add("drag-over");
  });
  dz.addEventListener("dragleave", function () {
    dz.classList.remove("drag-over");
  });
  dz.addEventListener("drop", function (e) {
    e.preventDefault();
    dz.classList.remove("drag-over");
    var dt = new DataTransfer();
    Array.from(fi.files || [])
      .concat(Array.from(e.dataTransfer.files))
      .forEach(function (f) {
        dt.items.add(f);
      });
    fi.files = dt.files;
    renderPreview();
  });
  fi.addEventListener("change", renderPreview);
})();
