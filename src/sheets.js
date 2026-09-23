/* جداول البيانات: عدة جداول مستقلة، كل جدول يبدأ من ملف Excel (أو فارغاً) ثم يُكمَّل هنا.
   الجداول وصفوفها مزامنة بين المستخدمين (sheets للتعريف، sheetRows للصفوف)، وكل خانة لها وقت
   تعديلها فيدمج الخادم الخانات ولا يمسح مستخدمٌ عمل غيره. المخرجات: Excel، وطباعة، ومحوّل القوالب. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const TYPES = { text: "نص", number: "رقم", date: "تاريخ", select: "قائمة", check: "✔/✘" };
  const DONE = "✔";
  const NOT_DONE = "✘";
  const MAX_ROWS = 5000;

  const sheets = () => (store.get().sheets = store.get().sheets || []);
  const allRows = () => (store.get().sheetRows = store.get().sheetRows || []);
  const rowsOf = (id) => allRows().filter((r) => r.sheet === id);
  const current = () => sheets().find((s) => s.id === currentId) || sheets()[0] || null;

  let currentId = null;
  let filter = { q: "", col: "", value: "" };
  let pending = null; // ملف Excel مقروء بانتظار التأكيد

  const nowISO = () => new Date().toISOString();
  const touch = (rec, key) => {
    rec.updatedAt = nowISO();
    rec.updatedBy = App.profile ? App.profile.name() : "";
    if (key) rec.valuesAt = Object.assign({}, rec.valuesAt, { [key]: rec.updatedAt });
  };

  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(), 400); };

  /* ===== قراءة ملف Excel ===== */
  async function readExcel(file) {
    if (typeof ExcelJS === "undefined") throw new Error("تعذّر تحميل مكتبة Excel");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("الملف بلا أوراق");
    const cell = (c) => {
      const v = c && c.value;
      if (v == null) return "";
      if (typeof v === "object") {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (v.text) return String(v.text);
        if (v.result !== undefined) return String(v.result);
        if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
        return "";
      }
      return String(v).trim();
    };
    // صف العناوين: أول صف فيه خليتان غير فارغتين على الأقل
    let headerRow = 0;
    const rows = [];
    ws.eachRow((row, n) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { values[i - 1] = cell(c); });
      if (!headerRow && values.filter((v) => v && v.trim()).length >= 2) { headerRow = n; rows.push({ n, values }); return; }
      if (headerRow && values.some((v) => v && v.trim())) rows.push({ n, values });
    });
    if (!rows.length) throw new Error("لم أجد صفوفاً في الملف");
    const head = rows[0].values.map((v, i) => clean(v) || `عمود ${i + 1}`);
    const used = head.map((h, i) => (rows.slice(1).some((r) => (r.values[i] || "").trim()) || clean(rows[0].values[i]) ? i : -1)).filter((i) => i >= 0);
    const columns = used.map((i) => ({ key: "c" + (i + 1), label: head[i], type: guessType(rows.slice(1).map((r) => r.values[i])) }));
    const data = rows.slice(1, MAX_ROWS + 1).map((r) => {
      const values = {};
      used.forEach((i, k) => { values[columns[k].key] = r.values[i] || ""; });
      return values;
    });
    return { name: file.name.replace(/\.[^.]+$/, ""), columns, rows: data, more: rows.length - 1 > MAX_ROWS };
  }
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  function guessType(values) {
    const vals = values.map(clean).filter(Boolean).slice(0, 40);
    if (!vals.length) return "text";
    if (vals.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
    if (vals.every((v) => /^-?[\d٠-٩]+([.,][\d٠-٩]+)?$/.test(v))) return "number";
    const uniq = [...new Set(vals)];
    if (uniq.length <= 6 && vals.length >= 6) return "select";
    return "text";
  }

  /* ===== إنشاء وحذف الجداول ===== */
  function addSheet(name, columns, rows) {
    const sheet = { id: store.uid(), name, columns, createdAt: nowISO(), updatedAt: nowISO(), by: App.profile ? App.profile.name() : "" };
    sheets().push(sheet);
    (rows || []).forEach((values) => allRows().push({ id: store.uid(), sheet: sheet.id, values, createdAt: nowISO(), updatedAt: nowISO() }));
    currentId = sheet.id;
    store.save();
    render();
    return sheet;
  }

  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      pending = await readExcel(file);
      const s = current();
      const same = s && pending.columns.length === s.columns.length && pending.columns.every((c, i) => clean(c.label) === clean(s.columns[i].label));
      const msg = `«${pending.name}»: ${ui.fmt(pending.rows.length)} صفاً و${ui.fmt(pending.columns.length)} عموداً.` +
        (same ? `\n\nاضغط «موافق» لإضافة الصفوف إلى الجدول الحالي «${s.name}»، أو «إلغاء» لإنشاء جدول جديد.` : "\n\nسيُنشأ جدول جديد.");
      if (same && confirm(msg)) {
        pending.rows.forEach((values) => allRows().push({ id: store.uid(), sheet: s.id, values, createdAt: nowISO(), updatedAt: nowISO() }));
        store.save();
        render();
        ui.toast(`أُضيف ${ui.fmt(pending.rows.length)} صفاً إلى «${s.name}»`);
      } else {
        addSheet(pending.name, pending.columns, pending.rows);
        ui.toast(`أُنشئ جدول «${pending.name}»${pending.more ? ` — اكتُفي بأول ${ui.fmt(MAX_ROWS)} صف` : ""}`);
      }
    } catch (err) { ui.toast(err.message); }
    pending = null;
  }

  function deleteSheet() {
    const s = current();
    if (!s) return;
    const n = rowsOf(s.id).length;
    if (!confirm(`حذف جدول «${s.name}» و${ui.fmt(n)} صفاً فيه؟ لا يمكن التراجع إلا من سجل التعديلات.`)) return;
    store.get().sheets = sheets().filter((x) => x.id !== s.id);
    store.get().sheetRows = allRows().filter((r) => r.sheet !== s.id);
    currentId = (sheets()[0] || {}).id || null;
    store.save();
    render();
  }

  /* ===== الأعمدة ===== */
  function addColumn() {
    const s = current();
    if (!s) return;
    const label = prompt("اسم العمود الجديد:");
    if (!label || !label.trim()) return;
    const type = prompt(`نوع العمود؟ اكتب واحداً من: ${Object.values(TYPES).join(" / ")}`, TYPES.text) || TYPES.text;
    const key = Object.keys(TYPES).find((k) => TYPES[k] === clean(type)) || "text";
    s.columns.push(Object.assign({ key: store.uid(), label: label.trim(), type: key }, key === "select" ? { options: [DONE, NOT_DONE] } : {}));
    s.updatedAt = nowISO();
    store.save();
    render();
  }

  function editColumn(colKey) {
    const s = current();
    const col = s && s.columns.find((c) => c.key === colKey);
    if (!col) return;
    const label = prompt("اسم العمود:", col.label);
    if (label === null) return;
    if (!label.trim()) {
      if (!confirm(`حذف عمود «${col.label}» وقيمه من كل الصفوف؟`)) return;
      s.columns = s.columns.filter((c) => c.key !== colKey);
      rowsOf(s.id).forEach((r) => { if (r.values && colKey in r.values) { delete r.values[colKey]; touch(r, colKey); } });
    } else col.label = label.trim();
    s.updatedAt = nowISO();
    store.save();
    render();
  }

  /* ===== الصفوف ===== */
  function addRow() {
    const s = current();
    if (!s) return;
    allRows().push({ id: store.uid(), sheet: s.id, values: {}, createdAt: nowISO(), updatedAt: nowISO() });
    store.save();
    render();
    const last = $("sh-body").querySelector("tr:last-child input, tr:last-child select");
    if (last) last.focus();
  }

  function deleteRow(id) {
    const rec = allRows().find((r) => r.id === id);
    if (!rec || !confirm("حذف هذا الصف؟")) return;
    store.get().sheetRows = allRows().filter((r) => r.id !== id);
    store.save();
    render();
  }

  /* ===== العرض ===== */
  const visible = () => {
    const s = current();
    if (!s) return [];
    const q = filter.q.trim();
    return rowsOf(s.id).filter((r) => {
      if (filter.col && filter.value && clean((r.values || {})[filter.col]) !== filter.value) return false;
      if (!q) return true;
      return Object.values(r.values || {}).some((v) => String(v == null ? "" : v).includes(q));
    });
  };

  function cellHtml(row, col) {
    const v = (row.values || {})[col.key];
    const a = `data-row="${esc(row.id)}" data-col="${esc(col.key)}"`;
    if (col.type === "check") {
      const on = clean(v) === DONE;
      return `<td class="sh-check"><button type="button" class="sh-tick ${on ? "on" : ""}" ${a} aria-pressed="${on}">${on ? DONE : ""}</button></td>`;
    }
    if (col.type === "select") {
      const opts = col.options && col.options.length ? col.options : [DONE, NOT_DONE];
      return `<td><select class="sh-sel ${clean(v) === DONE ? "done" : clean(v) ? "not" : ""}" ${a}><option value=""></option>${opts.map((o) => `<option ${clean(v) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></td>`;
    }
    const type = col.type === "number" ? "number" : col.type === "date" ? "date" : "text";
    return `<td><input type="${type}" ${a} value="${esc(v == null ? "" : v)}"></td>`;
  }

  function stats(s, list) {
    const parts = [`${ui.fmt(list.length)} صفاً${list.length !== rowsOf(s.id).length ? ` من ${ui.fmt(rowsOf(s.id).length)}` : ""}`];
    s.columns.filter((c) => c.type === "check" || c.type === "select").forEach((c) => {
      const done = list.filter((r) => clean((r.values || {})[c.key]) === DONE).length;
      const empty = list.filter((r) => !clean((r.values || {})[c.key])).length;
      parts.push(`${c.label}: ✔ ${ui.fmt(done)}${empty ? ` · فارغ ${ui.fmt(empty)}` : ""}`);
    });
    return parts.join(" · ");
  }

  function render() {
    const view = $("view-sheets");
    if (!view) return;
    const list = sheets();
    if (!list.length) {
      $("sh-empty").hidden = false;
      $("sh-main").hidden = true;
      $("sh-tabs").innerHTML = "";
      return;
    }
    if (!current()) currentId = list[0].id;
    const s = current();
    $("sh-empty").hidden = true;
    $("sh-main").hidden = false;
    $("sh-tabs").innerHTML = list.map((x) => `<button type="button" class="sh-tab ${x.id === s.id ? "active" : ""}" data-sheet="${esc(x.id)}">${esc(x.name)} <small>${ui.fmt(rowsOf(x.id).length)}</small></button>`).join("");

    const rows = visible();
    $("sh-stats").textContent = stats(s, rows);
    const filterCols = s.columns.filter((c) => c.type === "select" || c.type === "check");
    $("sh-filter-col").innerHTML = `<option value="">كل الأعمدة</option>` + filterCols.map((c) => `<option value="${esc(c.key)}" ${filter.col === c.key ? "selected" : ""}>${esc(c.label)}</option>`).join("");
    const col = s.columns.find((c) => c.key === filter.col);
    const values = col ? [...new Set(rowsOf(s.id).map((r) => clean((r.values || {})[col.key])).filter(Boolean))] : [];
    $("sh-filter-value").hidden = !values.length;
    $("sh-filter-value").innerHTML = `<option value="">الكل</option>` + values.map((v) => `<option ${filter.value === v ? "selected" : ""}>${esc(v)}</option>`).join("");

    $("sh-head").innerHTML = `<tr><th class="sh-n">#</th>${s.columns.map((c) => `<th><button type="button" class="sh-col" data-edit-col="${esc(c.key)}" title="تعديل اسم العمود أو حذفه">${esc(c.label)}</button><small>${TYPES[c.type] || c.type}</small></th>`).join("")}<th></th></tr>`;
    $("sh-body").innerHTML = rows.length
      ? rows.map((r, i) => `<tr data-id="${esc(r.id)}"><td class="sh-n">${ui.fmt(i + 1)}</td>${s.columns.map((c) => cellHtml(r, c)).join("")}<td><button type="button" class="act-btn del" data-del-row="${esc(r.id)}">🗑</button></td></tr>`).join("")
      : `<tr><td colspan="${s.columns.length + 2}" class="empty">${rowsOf(s.id).length ? "لا صفوف مطابقة للبحث" : "لا صفوف بعد — ارفع ملف Excel أو أضف صفاً"}</td></tr>`;
    $("sh-title").textContent = s.name;
  }

  /* ===== المخرجات ===== */
  async function exportExcel() {
    const s = current();
    if (!s) return;
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(s.name.slice(0, 28) || "جدول", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === "check" ? 12 : 22 }));
    visible().forEach((r) => ws.addRow(s.columns.reduce((o, c) => Object.assign(o, { [c.key]: (r.values || {})[c.key] || "" }), {})));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    const buf = await wb.xlsx.writeBuffer();
    ui.download(`${s.name}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function printSheet() {
    const s = current();
    if (!s) return;
    const rows = visible();
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(s.name)}</title>
      <style>@page{size:A4 landscape;margin:10mm}
        body{font-family:Arial,Tahoma,sans-serif;margin:0;color:#111}
        h1{font-size:15pt;text-align:center;background:#1F3864;color:#fff;padding:6px;margin:0 0 8px}
        p.meta{font-size:8pt;color:#555;text-align:center;margin:0 0 8px}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}
        th,td{border:1px solid #999;padding:3px 4px;text-align:center}
        thead th{background:#1F3864;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        tbody tr:nth-child(even) td{background:#f2f5fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      </style></head><body>
      <h1>${esc(s.name)}</h1><p class="meta">${esc(stats(s, rows))} · ${esc(ui.formatDate(ui.todayISO()))}</p>
      <table><thead><tr><th>#</th>${s.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td>${ui.fmt(i + 1)}</td>${s.columns.map((c) => `<td>${esc((r.values || {})[c.key] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </body></html>`;
    const old = $("sh-print-frame");
    if (old) old.remove();
    const frame = document.createElement("iframe");
    frame.id = "sh-print-frame";
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:0;bottom:0;visibility:hidden";
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 150);
  }

  function toConverter() {
    const s = current();
    if (!s || !App.converter || !App.converter.useData) return;
    const rows = visible().map((r) => s.columns.reduce((o, c) => Object.assign(o, { [c.label]: (r.values || {})[c.key] || "" }), {}));
    if (!rows.length) { ui.toast("لا صفوف لإرسالها"); return; }
    App.converter.useData(s.columns.map((c) => c.label), rows, s.name);
    location.hash = "#converter";
  }

  /* ===== الأحداث ===== */
  function init() {
    $("sh-file").addEventListener("change", onFile);
    $("sh-new").addEventListener("click", () => {
      const name = prompt("اسم الجدول الجديد:", "جدول جديد");
      if (name && name.trim()) addSheet(name.trim(), [{ key: "c1", label: "الاسم", type: "text" }], []);
    });
    $("sh-upload").addEventListener("click", () => $("sh-file").click());
    $("sh-upload2").addEventListener("click", () => $("sh-file").click());
    $("sh-add-col").addEventListener("click", addColumn);
    $("sh-add-row").addEventListener("click", addRow);
    $("sh-del").addEventListener("click", deleteSheet);
    $("sh-rename").addEventListener("click", () => {
      const s = current();
      if (!s) return;
      const name = prompt("اسم الجدول:", s.name);
      if (name && name.trim()) { s.name = name.trim(); s.updatedAt = nowISO(); store.save(); render(); }
    });
    $("sh-export").addEventListener("click", () => exportExcel().catch((e) => ui.toast(e.message)));
    $("sh-print").addEventListener("click", printSheet);
    $("sh-to-conv").addEventListener("click", toConverter);
    $("sh-search").addEventListener("input", (e) => { filter.q = e.target.value; render(); $("sh-search").focus(); });
    $("sh-filter-col").addEventListener("change", (e) => { filter.col = e.target.value; filter.value = ""; render(); });
    $("sh-filter-value").addEventListener("change", (e) => { filter.value = e.target.value; render(); });
    $("sh-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sheet]");
      if (b) { currentId = b.dataset.sheet; filter = { q: "", col: "", value: "" }; $("sh-search").value = ""; render(); }
    });
    $("sh-head").addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit-col]");
      if (b) editColumn(b.dataset.editCol);
    });
    $("sh-body").addEventListener("input", (e) => {
      const el = e.target;
      if (!el.dataset.row) return;
      const rec = allRows().find((r) => r.id === el.dataset.row);
      if (!rec) return;
      rec.values = Object.assign({}, rec.values, { [el.dataset.col]: el.value });
      touch(rec, el.dataset.col);
      save();
      $("sh-stats").textContent = stats(current(), visible());
    });
    $("sh-body").addEventListener("change", (e) => {
      if (e.target.tagName === "SELECT" && e.target.dataset.row) {
        e.target.className = `sh-sel ${e.target.value === DONE ? "done" : e.target.value ? "not" : ""}`;
      }
    });
    $("sh-body").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-row]");
      if (del) { deleteRow(del.dataset.delRow); return; }
      const tick = e.target.closest(".sh-tick");
      if (!tick) return;
      const rec = allRows().find((r) => r.id === tick.dataset.row);
      if (!rec) return;
      const on = !tick.classList.contains("on");
      tick.classList.toggle("on", on);
      tick.textContent = on ? DONE : "";
      tick.setAttribute("aria-pressed", String(on));
      rec.values = Object.assign({}, rec.values, { [tick.dataset.col]: on ? DONE : NOT_DONE });
      touch(rec, tick.dataset.col);
      save();
      $("sh-stats").textContent = stats(current(), visible());
    });
  }

  App.sheets = { init, render };
})(window.App = window.App || {});
