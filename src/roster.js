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

  const DONE = "تم";
  const NOT_DONE = "لم يتم";
  const TRUE_WORDS = ["true", "نعم", "تم", "موقع", "موقّع", "✓", "yes", "1"];
  const FALSE_WORDS = ["false", "لا", "لم", "لم يتم", "غير", "no", "0", ""];
  const isBoolWord = (v) => TRUE_WORDS.includes(String(v).trim().toLowerCase()) || FALSE_WORDS.includes(String(v).trim().toLowerCase());
  const toBool = (v) => v === true || TRUE_WORDS.includes(String(v).trim().toLowerCase());
  /* قيمة خلية القائمة: نص أحد الخيارات (القيم القديمة صح/خطأ تُترجم) */
  const cellValue = (v, col) => {
    if (v === true) return col.doneValue || DONE;
    if (v === false) return (col.options || []).find((o) => o !== (col.doneValue || DONE)) || NOT_DONE;
    return String(v == null ? "" : v);
  };
  const isDone = (rec, col) => cellValue(rec.values[col.key], col) === (col.doneValue || DONE);

  /* مفتاح لاتيني ثابت لكل عمود حتى لا يتأثر بتغيّر صياغة العنوان */
  function slug(label, used) {
    let base = String(label).trim().replace(/\s+/g, "_").replace(/[^\w؀-ۿ]/g, "").slice(0, 24) || "col";
    let key = base;
    let i = 2;
    while (used.includes(key)) key = `${base}_${i++}`;
    return key;
  }

  /* نوع العمود: قائمة اختيار إن كانت قيمه محدودة (نعم/لا أو خيارات قليلة)، وإلا حقل كتابة */
  function columnMeta(label, values) {
    const filled = values.map((v) => String(v == null ? "" : v).trim()).filter((v) => v !== "");
    const pledge = /تعهد|توقيع|حضور|استلام|تسليم|موافقة|حالة/.test(label);
    if ((filled.length && filled.every(isBoolWord)) || (pledge && filled.every((v) => isBoolWord(v)))) {
      return { type: "select", options: [DONE, NOT_DONE], doneValue: DONE };
    }
    const distinct = [...new Set(filled)];
    if (pledge && distinct.length && distinct.length <= 6 && distinct.every((v) => v.length <= 20)) {
      return { type: "select", options: distinct, doneValue: distinct.find((v) => toBool(v)) || distinct[0] };
    }
    return { type: "text" };
  }

  const normId = (v) => String(v == null ? "" : v).replace(/[^\d٠-٩A-Za-z]/g, "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  const normName = (v) => String(v || "").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

  /* مطابقة عنوان عمود في الملف بعمود في النظام: تجاهل المسافات والأرقام والهمزات */
  const normHead = (s) => String(s || "").trim().toLowerCase()
    .replace(/[\u064B-\u0652]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/^ال/, "").replace(/[\s_\d().-]/g, "");

  function matchColumn(label, columns) {
    const n = normHead(label);
    return columns.find((c) => normHead(c.label) === n)
      || columns.find((c) => { const m = normHead(c.label); return m.length > 3 && (m.includes(n) || n.includes(m)); })
      || null;
  }

  /* ===== الاستيراد ===== */
  let pending = null; // { columns, keyColumn, records, fileName }

  async function readFile(file) {
    const data = await App.converterCore.readDataFile(await file.arrayBuffer());
    const system = meta().columns;
    const used = system.map((c) => c.key);
    const columns = data.headers.map((h) => {
      const hit = system.length ? matchColumn(h, system) : null;
      if (hit) return Object.assign({}, hit, { fileHeader: h });
      const key = slug(h, used);
      used.push(key);
      return Object.assign({ key, label: h, fileHeader: h }, columnMeta(h, data.rows.map((r) => r[h])));
    });
    const keyCol = columns.find((c) => /هوية|هويه|رقم.*وطني|id/i.test(c.label)) || columns[0];
    const records = data.rows.map((r) => {
      const rec = { id: store.uid(), values: {} };
      columns.forEach((c) => {
        const raw = r[c.fileHeader || c.label];
        if (c.type !== "select") { rec.values[c.key] = String(raw == null ? "" : raw).trim(); return; }
        const text = String(raw == null ? "" : raw).trim();
        // قيم الملف (true/نعم/تم…) تُترجم إلى أحد خيارات العمود
        rec.values[c.key] = isBoolWord(text) ? (toBool(text) ? (c.doneValue || DONE) : (c.options || []).find((o) => o !== (c.doneValue || DONE)) || NOT_DONE)
          : (c.options || []).includes(text) ? text : text;
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
        $("ros-import-body").innerHTML = `<p><b>${esc(file.name)}</b>: ${ui.fmt(data.count)} سجل، ${ui.fmt(data.columns.length)} عمود في الملف.</p>
          <p class="conv-hint">اختر الأعمدة التي تريدها في النظام. هذه الأعمدة تصبح ثابتة، وأي ملف ترفعه لاحقاً يُقرأ عليها فقط.</p>
          <div class="conv-multi" id="ros-pick-cols">${data.columns.map((c) => `
            <label class="conv-check"><input type="checkbox" data-col="${esc(c.key)}" checked> ${esc(c.label)}${c.type === "check" ? " <span class=\"reg-kind\">(خانة تعليم)</span>" : ""}</label>`).join("")}</div>
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
      const picked = [...document.querySelectorAll("#ros-pick-cols [data-col]")].filter((b) => b.checked).map((b) => b.dataset.col);
      m.columns = pending.columns.filter((c) => !picked.length || picked.includes(c.key)).map((c) => ({ key: c.key, label: c.label, type: c.type }));
      if (!m.columns.some((c) => c.key === pending.keyColumn) && m.columns.length) pending.keyColumn = m.columns[0].key;
      m.keyColumn = ($("ros-key") && $("ros-key").value) || pending.keyColumn;
      m.name = pending.fileName;
      m.importedAt = new Date().toISOString();
      store.get().roster = pending.records.map((r) => {
        const values = {};
        m.columns.forEach((c) => { values[c.key] = r.values[c.key] !== undefined ? cellValue(r.values[c.key], c) : ""; });
        return Object.assign(r, { values, addedAt: m.importedAt, source: pending.fileName });
      });
      m.lastImport = { at: m.importedAt, file: pending.fileName, added: pending.records.length, changed: 0 };
      ui.toast(`أُنشئت القائمة بـ ${ui.fmt(pending.records.length)} سجل`);
    } else {
      const cmp = pending.cmp;
      const now = new Date().toISOString();
      // الأعمدة الجديدة في الملف تُضاف فقط إذا اختار المستخدم ذلك، وإلا تُتجاهَل
      if ($("ros-add-columns") && $("ros-add-columns").checked) {
        cmp.extraColumns.forEach((c) => {
          m.columns.push(c);
          rows().forEach((r) => { if (r.values[c.key] === undefined) r.values[c.key] = ""; });
        });
      }
      cmp.added.forEach((rec) => {
        const values = {};
        m.columns.forEach((c) => { values[c.key] = rec.values[c.key] !== undefined ? cellValue(rec.values[c.key], c) : (c.type === "select" ? (c.options || []).find((o) => o !== (c.doneValue || DONE)) || "" : ""); });
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

  function checkColumns() { return meta().columns.filter((c) => c.type === "select"); }
  function facetColumns() {
    // أعمدة نصية قليلة القيم تصلح للتصفية (المسار، المجموعة…)
    return meta().columns.filter((c) => {
      if (c.type === "select") return false;
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
        if (col.type === "select") {
          if (cellValue(r.values[key], col) !== val) return false;
        } else if (String(r.values[key] || "") !== val) return false;
      }
      if (filter.only === "new" && !r.isNew) return false;
      if (filter.only === "incomplete" && checkColumns().every((c) => isDone(r, c))) return false;
      return true;
    });
  }

  /* ترقية القوائم القديمة: أعمدة الصح/الخطأ أو التي قيمها «تم / لم يتم» تصبح قوائم اختيار */
  function migrate() {
    const m = meta();
    let changed = false;
    m.columns.forEach((c) => {
      if (c.type === "select") {
        if (!c.options || !c.options.length) { c.options = [DONE, NOT_DONE]; c.doneValue = c.doneValue || DONE; changed = true; }
        return;
      }
      const vals = rows().map((r) => r.values[c.key]);
      const boolish = vals.length && vals.every((v) => v === true || v === false || isBoolWord(v));
      if (c.type === "check" || boolish) {
        c.type = "select";
        c.options = [DONE, NOT_DONE];
        c.doneValue = DONE;
        rows().forEach((r) => { r.values[c.key] = cellValue(r.values[c.key], c); });
        changed = true;
      }
    });
    if (changed) store.save();
  }

  /* ===== العرض ===== */
  function render() {
    migrate();
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
          ${(c.options || []).map((o) => `<option ${filter.col[c.key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
        </select>`).join("")}
      <select id="ros-only">
        <option value="">كل السجلات</option>
        <option value="incomplete" ${filter.only === "incomplete" ? "selected" : ""}>الناقص فقط</option>
        <option value="new" ${filter.only === "new" ? "selected" : ""}>المضاف في آخر رفع</option>
      </select>`;

    // مؤشرات التعليم
    const list = filtered();
    $("ros-stats").innerHTML = checkColumns().map((c) => {
      const done = rows().filter((r) => isDone(r, c)).length;
      const pctAll = rows().length ? Math.round((done / rows().length) * 100) : 0;
      return `<div class="stat"><div class="label">${esc(c.label)}</div><div class="value">${ui.fmt(done)} / ${ui.fmt(rows().length)}</div>
        <div class="sub">${ui.fmt(pctAll)}% · المتبقي ${ui.fmt(rows().length - done)}</div></div>`;
    }).join("") || `<div class="stat"><div class="label">السجلات</div><div class="value">${ui.fmt(rows().length)}</div><div class="sub">لا توجد خانات تعليم</div></div>`;

    $("ros-count").textContent = list.length === rows().length ? `${ui.fmt(list.length)} سجل` : `${ui.fmt(list.length)} من ${ui.fmt(rows().length)}`;

    $("ros-head").innerHTML = `<tr><th>#</th>${m.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th></th></tr>`;
    $("ros-body").innerHTML = list.length ? list.map((r, i) => `<tr data-id="${r.id}" class="${r.isNew ? "ros-new" : ""}">
        <td class="nowrap">${ui.fmt(i + 1)}</td>
        ${m.columns.map((c) => {
          if (c.type !== "select") return `<td><input type="text" data-k="${esc(c.key)}" value="${esc(r.values[c.key] || "")}"></td>`;
          const v = cellValue(r.values[c.key], c);
          const opts = [...new Set([...(c.options || []), v].filter(Boolean))];
          return `<td><select data-k="${esc(c.key)}" class="ros-sel ${v === (c.doneValue || DONE) ? "done" : v ? "not" : ""}" aria-label="${esc(c.label)}">
            <option value=""></option>
            ${opts.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}
          </select></td>`;
        }).join("")}
        <td class="reg-actions nowrap">
          <button class="act-btn edit" data-notes title="ملاحظات المتابعة">📝${(r.notes || []).length ? ` ${ui.fmt(r.notes.length)}` : ""}</button>
          <button class="act-btn del" data-del title="حذف السجل">🗑</button>
        </td>
      </tr>`).join("")
      : `<tr><td colspan="${m.columns.length + 2}" class="empty">لا توجد سجلات مطابقة.</td></tr>`;
  }

  /* ===== إدارة أعمدة النظام ===== */
  function renderColumns() {
    const m = meta();
    $("ros-cols-list").innerHTML = m.columns.map((c, i) => `<li data-key="${esc(c.key)}">
        <input type="text" data-col-label value="${esc(c.label)}" aria-label="اسم العمود">
        <select data-col-type>
          <option value="text" ${c.type === "text" ? "selected" : ""}>حقل كتابة</option>
          <option value="select" ${c.type === "select" ? "selected" : ""}>قائمة اختيار</option>
        </select>
        ${c.type === "select" ? `<input type="text" data-col-options value="${esc((c.options || []).join("، "))}" title="الخيارات مفصولة بفاصلة" placeholder="تم، لم يتم">
          <select data-col-done title="القيمة التي تعني الإنجاز">${(c.options || []).map((o) => `<option ${o === (c.doneValue || DONE) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
        ${c.key === m.keyColumn ? `<span class="reg-kind">عمود المطابقة</span>` : `<button type="button" class="conv-link" data-col-key title="اجعله عمود المطابقة">🔑</button>`}
        <button type="button" class="conv-link" data-col-up ${i === 0 ? "disabled" : ""} title="تحريك لأعلى">▲</button>
        <button type="button" class="conv-link danger" data-col-del title="حذف العمود من النظام">✕</button>
      </li>`).join("") || `<li class="conv-hint">لا توجد أعمدة بعد.</li>`;
  }

  function onColumnsClick(e) {
    const li = e.target.closest("li[data-key]");
    if (!li) return;
    const m = meta();
    const key = li.dataset.key;
    const idx = m.columns.findIndex((c) => c.key === key);
    if (e.target.closest("[data-col-del]")) {
      const col = m.columns[idx];
      if (!confirm(`حذف العمود «${col.label}» وكل قيمه من ${ui.fmt(rows().length)} سجل؟`)) return;
      m.columns.splice(idx, 1);
      rows().forEach((r) => { delete r.values[key]; });
      if (m.keyColumn === key) m.keyColumn = m.columns.length ? m.columns[0].key : "";
    } else if (e.target.closest("[data-col-up]")) {
      m.columns.splice(idx - 1, 0, m.columns.splice(idx, 1)[0]);
    } else if (e.target.closest("[data-col-key]")) {
      m.keyColumn = key;
    } else return;
    store.save();
    renderColumns();
    render();
  }

  function onColumnsEdit(e) {
    const li = e.target.closest("li[data-key]");
    if (!li) return;
    const col = meta().columns.find((c) => c.key === li.dataset.key);
    if (!col) return;
    if (e.target.hasAttribute("data-col-label")) col.label = e.target.value;
    if (e.target.hasAttribute("data-col-type")) {
      col.type = e.target.value;
      if (col.type === "select") {
        col.options = col.options && col.options.length ? col.options : [DONE, NOT_DONE];
        col.doneValue = col.doneValue || col.options[0];
      }
      rows().forEach((r) => { r.values[col.key] = cellValue(r.values[col.key], col); });
      renderColumns();
    }
    if (e.target.hasAttribute("data-col-options")) {
      col.options = e.target.value.split(/[،,]/).map((o) => o.trim()).filter(Boolean);
      if (!col.options.includes(col.doneValue)) col.doneValue = col.options[0] || DONE;
    }
    if (e.target.hasAttribute("data-col-done")) col.doneValue = e.target.value;
    autoSave();
    render();
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
    m.columns.forEach((c) => { rec.values[c.key] = c.type === "select" ? (c.options || []).find((o) => o !== (c.doneValue || DONE)) || "" : ""; });
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
    const isSelect = confirm("هل هذا العمود قائمة اختيار (تم / لم يتم)؟\nموافق = قائمة اختيار، إلغاء = حقل كتابة");
    const m = meta();
    const key = slug(label, m.columns.map((c) => c.key));
    m.columns.push(isSelect ? { key, label: label.trim(), type: "select", options: [DONE, NOT_DONE], doneValue: DONE } : { key, label: label.trim(), type: "text" });
    rows().forEach((r) => { r.values[key] = isSelect ? NOT_DONE : ""; });
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
    rec.values[key] = e.target.value;
    if (e.target.tagName === "SELECT") {
      const col = meta().columns.find((c) => c.key === key);
      e.target.className = `ros-sel ${e.target.value === (col.doneValue || DONE) ? "done" : e.target.value ? "not" : ""}`;
    }
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = App.profile ? App.profile.name() : "";
    autoSave();
    if (e.target.tagName === "SELECT") {
      // تحديث المؤشرات فقط، دون إعادة بناء الجدول أثناء الكتابة
      const m = meta();
      $("ros-stats").innerHTML = m.columns.filter((c) => c.type === "select").map((c) => {
        const done = rows().filter((r) => isDone(r, c)).length;
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
      m.columns.forEach((c) => { row[c.key] = c.type === "select" ? cellValue(r.values[c.key], c) : r.values[c.key] || ""; });
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
          const done = list.filter((r) => isDone(r, c)).length;
          return [c.label, ui.fmt(done), ui.fmt(list.length - done), `${ui.fmt(list.length ? Math.round((done / list.length) * 100) : 0)}%`];
        }),
      });
    }
    const nameCol = m.columns.find((c) => /اسم/.test(c.label)) || m.columns[0];
    checks.forEach((c) => {
      const missing = list.filter((r) => !isDone(r, c));
      if (!missing.length) return;
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `الذين لم يُنجزوا: ${c.label} (${ui.fmt(missing.length)})` });
      out.push({
        kind: "table",
        headers: ["م", nameCol.label, ...m.columns.filter((x) => x.type !== "select" && x !== nameCol).slice(0, 3).map((x) => x.label)],
        widths: null,
        rows: missing.map((r, i) => [String(i + 1), r.values[nameCol.key] || "", ...m.columns.filter((x) => x.type !== "select" && x !== nameCol).slice(0, 3).map((x) => String(r.values[x.key] || ""))]),
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
    $("ros-cols").addEventListener("click", () => { renderColumns(); $("ros-cols-modal").classList.add("open"); });
    $("ros-cols-close").addEventListener("click", () => $("ros-cols-modal").classList.remove("open"));
    $("ros-cols-modal").addEventListener("click", (e) => { if (e.target.id === "ros-cols-modal") $("ros-cols-modal").classList.remove("open"); });
    $("ros-cols-list").addEventListener("click", onColumnsClick);
    $("ros-cols-list").addEventListener("input", onColumnsEdit);
    $("ros-cols-list").addEventListener("change", onColumnsEdit);
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
