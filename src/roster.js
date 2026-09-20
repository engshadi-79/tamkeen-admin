/* قوائم المستفيدين والتعهدات: يُرفع ملف Excel فتُنشأ القائمة بأعمدتها كما هي،
   وتُكمَّل البيانات داخل الصفحة وتُحفظ تلقائياً وتُزامَن مع بقية الأجهزة.
   رفع ملف جديد لاحقاً يقارن بالمفتاح (رقم الهوية) فيضيف الأسماء الجديدة ويحافظ على ما عُلِّم. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const rows = () => (store.get().roster = store.get().roster || []);
  const lines = (t) => String(t || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const meta = () => (store.get().rosterMeta = Object.assign({ columns: [], keyColumn: "", name: "", importedAt: "", lastImport: null }, store.get().rosterMeta));

  const TRUE_WORDS = ["true", "نعم", "تم", "موقع", "موقّع", "✓", "yes", "1"];
  const FALSE_WORDS = ["false", "لا", "لم", "غير", "no", "0", ""];
  const isBoolWord = (v) => TRUE_WORDS.includes(String(v).trim().toLowerCase()) || FALSE_WORDS.includes(String(v).trim().toLowerCase());
  const toBool = (v) => TRUE_WORDS.includes(String(v).trim().toLowerCase());

  /* مفتاح لاتيني ثابت لكل عمود حتى لا يتأثر بتغيّر صياغة العنوان */
  function slug(label, used) {
    let base = String(label).trim().replace(/\s+/g, "_").replace(/[^\w؀-ۿ]/g, "").slice(0, 24) || "col";
    let key = base;
    let i = 2;
    while (used.includes(key)) key = `${base}_${i++}`;
    return key;
  }

  /* نوع العمود: خانة تعليم إن كانت كل قيمه نعم/لا، وإلا نص */
  function columnType(label, values) {
    const filled = values.filter((v) => String(v).trim() !== "");
    if (filled.length && filled.every(isBoolWord)) return "check";
    if (/تعهد|توقيع|حضور|استلام|تسليم|تم |موافقة/.test(label) && filled.every((v) => isBoolWord(v) || v === "")) return "check";
    return "text";
  }

  const normId = (v) => String(v == null ? "" : v).replace(/[^\d٠-٩A-Za-z]/g, "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  const normName = (v) => String(v || "").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

  /* ===== الاستيراد ===== */
  let pending = null; // { columns, keyColumn, records, fileName }

  async function readFile(file) {
    const data = await App.converterCore.readDataFile(await file.arrayBuffer());
    const used = [];
    const columns = data.headers.map((h) => {
      const key = slug(h, used);
      used.push(key);
      return { key, label: h, type: columnType(h, data.rows.map((r) => r[h])) };
    });
    const keyCol = columns.find((c) => /هوية|هويه|رقم.*وطني|id/i.test(c.label)) || columns[0];
    const records = data.rows.map((r) => {
      const rec = { id: store.uid(), values: {} };
      columns.forEach((c) => {
        const raw = r[c.label];
        rec.values[c.key] = c.type === "check" ? toBool(raw) : String(raw == null ? "" : raw).trim();
      });
      return rec;
    });
    return { columns, keyColumn: keyCol ? keyCol.key : "", records, fileName: file.name.replace(/\.[^.]+$/, ""), count: records.length };
  }

  const keyOf = (rec, keyColumn, columns) => {
    const v = rec.values[keyColumn];
    const col = columns.find((c) => c.key === keyColumn);
    return col && /هوية|هويه|id|رقم/i.test(col.label) ? normId(v) : normName(v);
  };

  /* المقارنة مع القائمة الحالية: جديد، أو موجود، أو موجود ببيانات مختلفة */
  function compare(incoming) {
    const m = meta();
    const current = new Map(rows().map((r) => [keyOf(r, m.keyColumn, m.columns), r]));
    const added = [], same = [], changed = [];
    const shared = m.columns.filter((c) => incoming.columns.some((ic) => ic.key === c.key));
    incoming.records.forEach((rec) => {
      const k = keyOf(rec, m.keyColumn, incoming.columns);
      const old = k && current.get(k);
      if (!old) { added.push(rec); return; }
      const diffs = shared.filter((c) => c.type !== "check" && String(old.values[c.key] || "") !== String(rec.values[c.key] || "") && String(rec.values[c.key] || "") !== "");
      if (diffs.length) changed.push({ old, rec, diffs }); else same.push(rec);
    });
    const extraColumns = incoming.columns.filter((c) => !m.columns.some((x) => x.key === c.key));
    return { added, same, changed, extraColumns };
  }

  async function pickFile(file) {
    if (!file) return;
    $("ros-import-status").textContent = "جارٍ قراءة الملف…";
    try {
      const data = await readFile(file);
      pending = data;
      const m = meta();
      if (!rows().length) {
        $("ros-import-body").innerHTML = `<p><b>${esc(file.name)}</b>: ${ui.fmt(data.count)} سجل، ${ui.fmt(data.columns.length)} عمود.</p>
          <p class="conv-hint">الأعمدة: ${data.columns.map((c) => `${esc(c.label)}${c.type === "check" ? " (خانة تعليم)" : ""}`).join("، ")}</p>
          <label class="field"><span>عمود المطابقة (يمنع تكرار الأسماء عند الرفع القادم)</span>
            <select id="ros-key">${data.columns.map((c) => `<option value="${esc(c.key)}" ${c.key === data.keyColumn ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>`;
        $("ros-import-apply").textContent = `إنشاء القائمة (${ui.fmt(data.count)} سجل)`;
      } else {
        const cmp = compare(data);
        pending.cmp = cmp;
        $("ros-import-body").innerHTML = `<p><b>${esc(file.name)}</b>: ${ui.fmt(data.count)} سجل.</p>
          <ul class="ros-cmp">
            <li><b>${ui.fmt(cmp.added.length)}</b> اسم جديد سيُضاف</li>
            <li><b>${ui.fmt(cmp.same.length)}</b> موجود مسبقاً بلا تغيير</li>
            <li><b>${ui.fmt(cmp.changed.length)}</b> موجود ببيانات مختلفة في الملف</li>
          </ul>
          ${cmp.changed.length ? `<label class="conv-check strong"><input type="checkbox" id="ros-update-existing"> تحديث بيانات الموجودين من الملف (الاسم والجوال والمسار…)</label>` : ""}
          ${cmp.extraColumns.length ? `<label class="conv-check strong"><input type="checkbox" id="ros-add-columns"> إضافة أعمدة جديدة موجودة في الملف فقط: ${cmp.extraColumns.map((c) => esc(c.label)).join("، ")}</label>` : ""}
          <p class="conv-hint">تبقى أعمدة النظام كما هي، وأي عمود إضافي في الملف يُتجاهَل ما لم تختر إضافته. وخانات التعليم التي عُلِّمت داخل الأداة لا تتغيّر أبداً عند الرفع.</p>`;
        $("ros-import-apply").textContent = cmp.added.length ? `إضافة ${ui.fmt(cmp.added.length)} اسم جديد` : "تطبيق";
      }
      $("ros-import-apply").disabled = false;
      $("ros-import-status").textContent = "";
      $("ros-import-modal").classList.add("open");
    } catch (e) {
      $("ros-import-status").textContent = e.message;
      ui.toast(e.message);
    }
  }

  function applyImport() {
    if (!pending) return;
    const m = meta();
    if (!rows().length) {
      m.columns = pending.columns;
      m.keyColumn = ($("ros-key") && $("ros-key").value) || pending.keyColumn;
      m.name = pending.fileName;
      m.importedAt = new Date().toISOString();
      store.get().roster = pending.records.map((r) => Object.assign(r, { addedAt: m.importedAt, source: pending.fileName }));
      m.lastImport = { at: m.importedAt, file: pending.fileName, added: pending.records.length, changed: 0 };
      ui.toast(`أُنشئت القائمة بـ ${ui.fmt(pending.records.length)} سجل`);
    } else {
      const cmp = pending.cmp;
      const now = new Date().toISOString();
      // الأعمدة الجديدة في الملف تُضاف فقط إذا اختار المستخدم ذلك، وإلا تُتجاهَل
      if ($("ros-add-columns") && $("ros-add-columns").checked) {
        cmp.extraColumns.forEach((c) => {
          m.columns.push(c);
          rows().forEach((r) => { if (r.values[c.key] === undefined) r.values[c.key] = c.type === "check" ? false : ""; });
        });
      }
      cmp.added.forEach((rec) => {
        const values = {};
        m.columns.forEach((c) => { values[c.key] = rec.values[c.key] !== undefined ? rec.values[c.key] : (c.type === "check" ? false : ""); });
        rec.values = values;
        rows().push(Object.assign(rec, { addedAt: now, source: pending.fileName, isNew: true }));
      });
      const updateExisting = $("ros-update-existing") && $("ros-update-existing").checked;
      let updated = 0;
      if (updateExisting) {
        cmp.changed.forEach(({ old, rec, diffs }) => {
          diffs.forEach((c) => { old.values[c.key] = rec.values[c.key]; });
          old.updatedAt = now;
          updated++;
        });
      }
      m.lastImport = { at: now, file: pending.fileName, added: cmp.added.length, changed: updated };
      ui.toast(`أُضيف ${ui.fmt(cmp.added.length)} اسم جديد${updated ? ` وحُدّث ${ui.fmt(updated)}` : ""}`);
    }
    store.save();
    pending = null;
    closeImport();
    render();
  }

  const closeImport = () => { $("ros-import-modal").classList.remove("open"); $("ros-import-apply").disabled = true; };

  /* ===== التصفية ===== */
  const filter = { q: "", col: {}, only: "" };

  function checkColumns() { return meta().columns.filter((c) => c.type === "check"); }
  function facetColumns() {
    // أعمدة نصية قليلة القيم تصلح للتصفية (المسار، المجموعة…)
    return meta().columns.filter((c) => {
      if (c.type === "check") return false;
      const vals = new Set(rows().map((r) => String(r.values[c.key] || "").trim()).filter(Boolean));
      return vals.size > 1 && vals.size <= 30;
    });
  }

  function filtered() {
    const q = filter.q.trim();
    return rows().filter((r) => {
      if (q && !Object.values(r.values).some((v) => String(v).includes(q))) return false;
      for (const [key, val] of Object.entries(filter.col)) {
        if (!val) continue;
        const col = meta().columns.find((c) => c.key === key);
        if (!col) continue;
        if (col.type === "check") {
          if (val === "yes" && !r.values[key]) return false;
          if (val === "no" && r.values[key]) return false;
        } else if (String(r.values[key] || "") !== val) return false;
      }
      if (filter.only === "new" && !r.isNew) return false;
      if (filter.only === "incomplete" && checkColumns().every((c) => r.values[c.key])) return false;
      return true;
    });
  }

  /* ===== العرض ===== */
  function render() {
    const m = meta();
    const has = rows().length > 0;
    $("ros-empty").hidden = has;
    $("ros-main").hidden = !has;
    if (!has) return;

    $("ros-title").textContent = m.name || "قائمة المستفيدين";
    if (document.activeElement !== $("ros-intro")) $("ros-intro").value = m.intro || "";
    if (document.activeElement !== $("ros-closing")) $("ros-closing").value = m.closing || "";
    $("ros-sub").textContent = `${ui.fmt(rows().length)} سجل · ${ui.fmt(m.columns.length)} عمود`
      + (m.lastImport ? ` · آخر رفع: ${ui.formatDate(String(m.lastImport.at).slice(0, 10))} (${ui.fmt(m.lastImport.added)} جديد)` : "");

    // شريط التصفية
    const facets = facetColumns();
    $("ros-filters").innerHTML = `
      <div class="reg-search-box"><input type="text" id="ros-search" placeholder="بحث بالاسم أو الهوية أو الجوال" value="${esc(filter.q)}"></div>
      ${facets.map((c) => {
        const vals = [...new Set(rows().map((r) => String(r.values[c.key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
        return `<select data-facet="${esc(c.key)}"><option value="">${esc(c.label)}: الكل</option>${vals.map((v) => `<option ${filter.col[c.key] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
      }).join("")}
      ${checkColumns().map((c) => `<select data-facet="${esc(c.key)}">
          <option value="">${esc(c.label)}: الكل</option>
          <option value="yes" ${filter.col[c.key] === "yes" ? "selected" : ""}>✔ تم</option>
          <option value="no" ${filter.col[c.key] === "no" ? "selected" : ""}>✖ لم يتم</option>
        </select>`).join("")}
      <select id="ros-only">
        <option value="">كل السجلات</option>
        <option value="incomplete" ${filter.only === "incomplete" ? "selected" : ""}>الناقص فقط</option>
        <option value="new" ${filter.only === "new" ? "selected" : ""}>المضاف في آخر رفع</option>
      </select>`;

    // مؤشرات التعليم
    const list = filtered();
    $("ros-stats").innerHTML = checkColumns().map((c) => {
      const done = rows().filter((r) => r.values[c.key]).length;
      const pctAll = rows().length ? Math.round((done / rows().length) * 100) : 0;
      return `<div class="stat"><div class="label">${esc(c.label)}</div><div class="value">${ui.fmt(done)} / ${ui.fmt(rows().length)}</div>
        <div class="sub">${ui.fmt(pctAll)}% · المتبقي ${ui.fmt(rows().length - done)}</div></div>`;
    }).join("") || `<div class="stat"><div class="label">السجلات</div><div class="value">${ui.fmt(rows().length)}</div><div class="sub">لا توجد خانات تعليم</div></div>`;

    $("ros-count").textContent = list.length === rows().length ? `${ui.fmt(list.length)} سجل` : `${ui.fmt(list.length)} من ${ui.fmt(rows().length)}`;

    $("ros-head").innerHTML = `<tr><th>#</th>${m.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th></th></tr>`;
    $("ros-body").innerHTML = list.length ? list.map((r, i) => `<tr data-id="${r.id}" class="${r.isNew ? "ros-new" : ""}">
        <td class="nowrap">${ui.fmt(i + 1)}</td>
        ${m.columns.map((c) => `<td>${c.type === "check"
          ? `<input type="checkbox" data-k="${esc(c.key)}" ${r.values[c.key] ? "checked" : ""} aria-label="${esc(c.label)}">`
          : `<input type="text" data-k="${esc(c.key)}" value="${esc(r.values[c.key] || "")}">`}</td>`).join("")}
        <td class="reg-actions nowrap">
          <button class="act-btn edit" data-notes title="ملاحظات المتابعة">📝${(r.notes || []).length ? ` ${ui.fmt(r.notes.length)}` : ""}</button>
          <button class="act-btn del" data-del title="حذف السجل">🗑</button>
        </td>
      </tr>`).join("")
      : `<tr><td colspan="${m.columns.length + 2}" class="empty">لا توجد سجلات مطابقة.</td></tr>`;
  }

  /* ===== ملاحظات المتابعة: عدة ملاحظات لكل شخص، لكل واحدة تاريخ وكاتب ===== */
  let notesId = null;

  const notesOf = (rec) => (rec.notes = rec.notes || []);
  const nameOf = (rec) => {
    const col = meta().columns.find((c) => /اسم/.test(c.label)) || meta().columns[0];
    return col ? rec.values[col.key] || "" : "";
  };

  function openNotes(rec) {
    notesId = rec.id;
    $("ros-notes-title").textContent = `📝 ملاحظات: ${nameOf(rec)}`;
    $("ros-note-text").value = "";
    renderNotes();
    $("ros-notes-modal").classList.add("open");
    setTimeout(() => $("ros-note-text").focus(), 50);
  }
  const closeNotes = () => { $("ros-notes-modal").classList.remove("open"); notesId = null; };

  function renderNotes() {
    const rec = rows().find((r) => r.id === notesId);
    if (!rec) return;
    const list = notesOf(rec).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    $("ros-notes-list").innerHTML = list.length ? list.map((n) => `<li>
        <span class="act-when">${esc(ui.formatDate(String(n.at).slice(0, 10)))}${n.by ? ` · ${esc(n.by)}` : ""}</span>
        <span>${esc(n.text)}</span>
        <button type="button" class="conv-link danger" data-note-del="${esc(n.id)}" title="حذف الملاحظة">✕</button>
      </li>`).join("") : `<li class="conv-hint">لا توجد ملاحظات بعد.</li>`;
  }

  function addNote() {
    const rec = rows().find((r) => r.id === notesId);
    const text = $("ros-note-text").value.trim();
    if (!rec || !text) { $("ros-note-text").focus(); return; }
    notesOf(rec).push({ id: store.uid(), text, at: new Date().toISOString(), by: App.profile ? App.profile.name() : "" });
    rec.updatedAt = new Date().toISOString();
    store.save();
    $("ros-note-text").value = "";
    renderNotes();
    render();
    ui.toast("أُضيفت الملاحظة");
  }

  /* ===== الإضافة اليدوية ===== */
  function addRecord() {
    const m = meta();
    const rec = { id: store.uid(), values: {}, addedAt: new Date().toISOString(), source: "إضافة يدوية", isNew: true };
    m.columns.forEach((c) => { rec.values[c.key] = c.type === "check" ? false : ""; });
    rows().unshift(rec);
    store.save();
    filter.q = "";
    filter.only = "";
    render();
    // التركيز على أول خانة كتابة في السطر الجديد
    const tr = document.querySelector(`#ros-body tr[data-id="${rec.id}"]`);
    const first = tr && tr.querySelector('input[type="text"]');
    if (first) { first.focus(); tr.scrollIntoView({ block: "center" }); }
    ui.toast("أُضيف سجل جديد — اكتب بياناته");
  }

  function addColumn() {
    const label = prompt("اسم العمود الجديد (مثال: تعهد استلام الأدوات)");
    if (!label || !label.trim()) return;
    const type = confirm("هل هذا العمود خانة تعليم (نعم/لا)؟\nموافق = خانة تعليم، إلغاء = حقل كتابة") ? "check" : "text";
    const m = meta();
    const key = slug(label, m.columns.map((c) => c.key));
    m.columns.push({ key, label: label.trim(), type });
    rows().forEach((r) => { r.values[key] = type === "check" ? false : ""; });
    store.save();
    render();
    ui.toast(`أُضيف عمود «${label.trim()}»`);
  }

  /* ===== الحفظ التلقائي ===== */
  let saveTimer = null;
  const autoSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { store.save(); $("ros-saved").textContent = "✓ حُفظ"; setTimeout(() => { $("ros-saved").textContent = ""; }, 1500); }, 400); };

  function onEdit(e) {
    const tr = e.target.closest("tr[data-id]");
    const key = e.target.dataset.k;
    if (!tr || !key) return;
    const rec = rows().find((r) => r.id === tr.dataset.id);
    if (!rec) return;
    rec.values[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = App.profile ? App.profile.name() : "";
    autoSave();
    if (e.target.type === "checkbox") {
      // تحديث المؤشرات فقط، دون إعادة بناء الجدول أثناء الكتابة
      const m = meta();
      $("ros-stats").innerHTML = m.columns.filter((c) => c.type === "check").map((c) => {
        const done = rows().filter((r) => r.values[c.key]).length;
        return `<div class="stat"><div class="label">${esc(c.label)}</div><div class="value">${ui.fmt(done)} / ${ui.fmt(rows().length)}</div>
          <div class="sub">${ui.fmt(rows().length ? Math.round((done / rows().length) * 100) : 0)}% · المتبقي ${ui.fmt(rows().length - done)}</div></div>`;
      }).join("");
    }
  }

  /* ===== التصدير ===== */
  async function exportExcel() {
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const m = meta();
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet(m.name ? m.name.slice(0, 28) : "القائمة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    sh.columns = m.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === "check" ? 14 : 24 }))
      .concat([{ header: "ملاحظات المتابعة", key: "__notes", width: 40 }]);
    filtered().forEach((r) => {
      const row = {};
      m.columns.forEach((c) => { row[c.key] = c.type === "check" ? (r.values[c.key] ? "تم" : "لم يتم") : r.values[c.key] || ""; });
      row.__notes = (r.notes || []).map((n) => `${ui.formatDate(String(n.at).slice(0, 10))}: ${n.text}`).join(" | ");
      sh.addRow(row);
    });
    sh.getRow(1).font = { bold: true };
    sh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDFF4F4" } };
    ui.download(`${m.name || "قائمة المستفيدين"} - ${ui.todayISO()}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* تقرير على الترويسة: نسب التعليم ثم أسماء الناقصين */
  function reportBlocks() {
    const m = meta();
    const list = filtered();
    const checks = checkColumns();
    const intro = lines($("ros-intro").value);
    const closing = lines($("ros-closing").value);
    const out = [
      { kind: "title", text: "بسم الله الرحمن الرحيم" },
      { kind: "meta", text: `التاريخ: ${ui.formatDate(ui.todayISO())}`, sizePt: 12 },
      { kind: "para", text: "" },
      { kind: "title", text: `تقرير ${m.name || "قائمة المستفيدين"}` },
      { kind: "para", text: "" },
    ];
    if (intro.length) {
      intro.forEach((t) => out.push({ kind: "para", text: t }));
      out.push({ kind: "para", text: "" });
    }
    if (checks.length) {
      out.push({ kind: "bold", text: "أولاً: ملخص الإنجاز" });
      out.push({
        kind: "table",
        headers: ["البند", "تم", "لم يتم", "النسبة"],
        widths: [0.46, 0.18, 0.18, 0.18],
        align: [null, "center", "center", "center"],
        rows: checks.map((c) => {
          const done = list.filter((r) => r.values[c.key]).length;
          return [c.label, ui.fmt(done), ui.fmt(list.length - done), `${ui.fmt(list.length ? Math.round((done / list.length) * 100) : 0)}%`];
        }),
      });
    }
    const nameCol = m.columns.find((c) => /اسم/.test(c.label)) || m.columns[0];
    checks.forEach((c) => {
      const missing = list.filter((r) => !r.values[c.key]);
      if (!missing.length) return;
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `الذين لم يُنجزوا: ${c.label} (${ui.fmt(missing.length)})` });
      out.push({
        kind: "table",
        headers: ["م", nameCol.label, ...m.columns.filter((x) => x.type !== "check" && x !== nameCol).slice(0, 3).map((x) => x.label)],
        widths: null,
        rows: missing.map((r, i) => [String(i + 1), r.values[nameCol.key] || "", ...m.columns.filter((x) => x.type !== "check" && x !== nameCol).slice(0, 3).map((x) => String(r.values[x.key] || ""))]),
      });
    });
    const withNotes = list.filter((r) => (r.notes || []).length);
    if ($("ros-notes-in-report").checked && withNotes.length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `ملاحظات المتابعة (${ui.fmt(withNotes.length)})` });
      out.push({
        kind: "table",
        headers: ["م", nameCol.label, "الملاحظة", "التاريخ"],
        widths: [0.07, 0.3, 0.45, 0.18],
        align: ["center", null, null, "center"],
        rows: withNotes.flatMap((r, i) => (r.notes || []).map((n, j) => [j ? "" : String(i + 1), j ? "" : r.values[nameCol.key] || "", n.text, ui.formatDate(String(n.at).slice(0, 10))])),
      });
    }
    if (closing.length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: "التوصيات" });
      closing.forEach((t) => out.push({ kind: "para", text: t }));
    }
    out.push({ kind: "para", text: "" }, { kind: "signature", lines: [store.get().signerTitle, store.get().signer].filter(Boolean) });
    return out;
  }

  function init() {
    $("ros-file").addEventListener("change", (e) => { pickFile(e.target.files[0]); e.target.value = ""; });
    document.querySelectorAll("[data-ros-import]").forEach((b) => b.addEventListener("click", () => $("ros-file").click()));
    $("ros-import-apply").addEventListener("click", applyImport);
    $("ros-import-cancel").addEventListener("click", closeImport);
    $("ros-import-modal").addEventListener("click", (e) => { if (e.target.id === "ros-import-modal") closeImport(); });
    $("ros-body").addEventListener("input", onEdit);
    $("ros-body").addEventListener("change", onEdit);
    $("ros-body").addEventListener("click", (e) => {
      const tr0 = e.target.closest("tr[data-id]");
      if (e.target.closest("[data-notes]")) { openNotes(rows().find((r) => r.id === tr0.dataset.id)); return; }
      if (!e.target.closest("[data-del]")) return;
      const tr = e.target.closest("tr[data-id]");
      const rec = rows().find((r) => r.id === tr.dataset.id);
      const m = meta();
      const nameCol = m.columns.find((c) => /اسم/.test(c.label)) || m.columns[0];
      if (!confirm(`حذف السجل «${rec.values[nameCol.key] || ""}»؟`)) return;
      store.get().roster = rows().filter((r) => r.id !== rec.id);
      store.save();
      render();
    });
    $("ros-filters").addEventListener("input", (e) => {
      if (e.target.id === "ros-search") { filter.q = e.target.value; render(); $("ros-search").focus(); }
    });
    $("ros-filters").addEventListener("change", (e) => {
      if (e.target.dataset.facet) filter.col[e.target.dataset.facet] = e.target.value;
      if (e.target.id === "ros-only") filter.only = e.target.value;
      render();
    });
    ["intro", "closing"].forEach((k) => $("ros-" + k).addEventListener("input", (e) => { meta()[k] = e.target.value; autoSave(); }));
    $("ros-add").addEventListener("click", addRecord);
    $("ros-add-col").addEventListener("click", addColumn);
    $("ros-note-add").addEventListener("click", addNote);
    $("ros-notes-close").addEventListener("click", closeNotes);
    $("ros-notes-modal").addEventListener("click", (e) => { if (e.target.id === "ros-notes-modal") closeNotes(); });
    $("ros-notes-list").addEventListener("click", (e) => {
      const id = e.target.dataset.noteDel;
      if (!id) return;
      const rec = rows().find((r) => r.id === notesId);
      rec.notes = notesOf(rec).filter((n) => n.id !== id);
      store.save();
      renderNotes();
      render();
    });
    $("ros-export").addEventListener("click", exportExcel);
    $("ros-report").addEventListener("click", () => App.docRender.print(reportBlocks(), `تقرير ${meta().name || "المستفيدين"} - ${ui.todayISO()}`, false));
    $("ros-report-word").addEventListener("click", () => App.docRender.exportWord(reportBlocks(), `تقرير ${meta().name || "المستفيدين"} - ${ui.todayISO()}`));
    $("ros-clear").addEventListener("click", () => {
      if (!confirm("حذف القائمة كاملة من الأداة؟ لا يمكن التراجع.")) return;
      store.get().roster = [];
      store.get().rosterMeta = { columns: [], keyColumn: "", name: "", importedAt: "", lastImport: null };
      store.save();
      render();
    });
  }

  App.roster = { init, render };
})(window.App = window.App || {});
