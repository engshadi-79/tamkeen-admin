/* منشئ التقارير: جدول الطلاب القادم من نظام المركز، تختار حقوله وتصفّيه فيخرج تقريرك.
   البيانات تصل مع لقطة «شاشة إحصاءات المركز» نفسها (سكربت القراءة يدفعها)، فلا اتصال من هنا بالنظام. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const PICK_KEY = "tamkeen-admin:report-fields";
  const MAX_ROWS = 400;          // ما يُعرض على الشاشة؛ التصدير يأخذ الكل

  /* الحقول المتاحة، مجموعة كما يفهمها المستخدم */
  const GROUPS = [
    {
      name: "بيانات التدريب",
      fields: [
        { key: "name", label: "الاسم", on: true },
        { key: "track", label: "المسار", on: true },
        { key: "course", label: "المرحلة", on: true },
        { key: "group", label: "المجموعة", on: true },
        { key: "trainer", label: "المدرب" },
        { key: "status", label: "حالة الطالب" },
        { key: "stu", label: "رقم الطالب" },
      ],
    },
    {
      name: "البيانات الشخصية",
      fields: [
        { key: "gender", label: "الجنس" },
        { key: "governorate", label: "المحافظة" },
        { key: "health", label: "الحالة الصحية" },
        { key: "marital", label: "الحالة الاجتماعية" },
        { key: "income", label: "مستوى الدخل" },
        { key: "nid", label: "رقم الهوية" },
        { key: "phone", label: "الجوال" },
      ],
    },
    {
      name: "الدرجات والنتيجة",
      fields: [
        { key: "practical", label: "العملي" },
        { key: "theory", label: "النظري" },
        { key: "activities", label: "الأنشطة" },
        { key: "total", label: "المجموع" },
        { key: "gradeStatus", label: "حالة الدرجة" },
        { key: "approval", label: "الاعتماد" },
      ],
    },
    {
      name: "الالتزام والمتابعة",
      fields: [
        { key: "pledged", label: "وقّع التعهد" },
        { key: "missingSurveys", label: "استبيانات لم تُعبّأ" },
        { key: "attendance", label: "حضور المجموعة %" },
      ],
    },
  ];
  const ALL = GROUPS.flatMap((g) => g.fields);
  const labelOf = (k) => (ALL.find((f) => f.key === k) || {}).label || k;

  /* الفلاتر: حقول قليلة القيم تصلح قوائمَ منسدلة */
  const FILTERS = ["course", "track", "group", "gender", "status", "pledged", "approval"];

  let picked = ALL.filter((f) => f.on).map((f) => f.key);
  let filters = {};
  let search = "";
  let groupBy = "";
  try {
    const saved = JSON.parse(localStorage.getItem(PICK_KEY) || "null");
    if (saved && saved.picked && saved.picked.length) {
      picked = saved.picked.filter((k) => ALL.some((f) => f.key === k));
      filters = saved.filters || {};
      groupBy = saved.groupBy || "";
      picked = ALL.map((f) => f.key).filter((k) => picked.includes(k));
    }
  } catch (e) { /* تخزين غير متاح */ }
  /* الأعمدة تتبع ترتيب المجموعات أعلاه لا ترتيب النقر */
  const order = () => { picked = ALL.map((f) => f.key).filter((k) => picked.includes(k)); };
  const save = () => { try { localStorage.setItem(PICK_KEY, JSON.stringify({ picked, filters, groupBy })); } catch (e) { /* ممتلئ */ } };

  const snap = () => {
    if (App.screen && App.screen.snapshot) return App.screen.snapshot();
    try { return JSON.parse(localStorage.getItem("tamkeen-admin:ksach-stats") || "null"); } catch (e) { return null; }
  };
  const students = () => {
    const s = snap();
    return (s && s.data && s.data.students) || [];
  };

  const norm = (v) => String(v == null ? "" : v).replace(/[ً-ْ]/g, "").replace(/[إأآا]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

  function rows() {
    const q = norm(search);
    return students().filter((r) => {
      for (const f of FILTERS) {
        if (filters[f] && norm(r[f]) !== norm(filters[f])) return false;
      }
      if (!q) return true;
      return norm(Object.values(r).join(" ")).includes(q);
    });
  }

  /* ===== الواجهة ===== */
  function renderFields() {
    $("rep-fields").innerHTML = GROUPS.map((g) => `<div class="rep-group">
        <div class="rep-group-head"><b>${esc(g.name)}</b>
          <button type="button" class="conv-link" data-all="${esc(g.name)}">الكل</button>
          <button type="button" class="conv-link" data-none="${esc(g.name)}">لا شيء</button>
        </div>
        <div class="rep-chips">${g.fields.map((f) => `<label class="rep-chip ${picked.includes(f.key) ? "on" : ""}">
          <input type="checkbox" data-field="${esc(f.key)}" ${picked.includes(f.key) ? "checked" : ""}> ${esc(f.label)}
        </label>`).join("")}</div>
      </div>`).join("");
  }

  function renderFilters() {
    const list = students();
    const vals = (key) => [...new Set(list.map((r) => String(r[key] == null ? "" : r[key]).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")).slice(0, 60);
    $("rep-filters").innerHTML = FILTERS.map((f) => {
      const options = vals(f);
      if (!options.length) return "";
      return `<label class="sc-f"><span>${esc(labelOf(f))}</span>
        <select data-filter="${esc(f)}"><option value="">الكل</option>
        ${options.map((v) => `<option ${filters[f] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
    }).join("")
      + `<label class="sc-f"><span>بحث</span><input type="search" id="rep-search" placeholder="اسم أو رقم…" value="${esc(search)}"></label>`
      + `<label class="sc-f"><span>تجميع حسب</span><select id="rep-group-by"><option value="">بلا تجميع (كل السجلات)</option>
        ${["track", "course", "group", "gender", "governorate", "health", "status", "pledged", "approval", "trainer"].map((k) => `<option value="${k}" ${groupBy === k ? "selected" : ""}>${esc(labelOf(k))}</option>`).join("")}</select></label>`;
  }

  function summary(list) {
    const map = new Map();
    list.forEach((r) => {
      const key = String(r[groupBy] == null ? "" : r[groupBy]).trim() || "— بلا قيمة —";
      map.set(key, (map.get(key) || 0) + 1);
    });
    const total = list.length || 1;
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return `<table class="rep-table"><thead><tr><th>${esc(labelOf(groupBy))}</th><th>العدد</th><th>النسبة</th></tr></thead>
      <tbody>${sorted.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${ui.fmt(n)}</td><td>${Math.round((n / total) * 100)}%</td></tr>`).join("")}
      <tr class="rep-total"><td>المجموع</td><td>${ui.fmt(list.length)}</td><td>100%</td></tr></tbody></table>`;
  }

  function table(list) {
    if (!picked.length) return `<p class="conv-hint">اختر حقلاً واحداً على الأقل.</p>`;
    const shown = list.slice(0, MAX_ROWS);
    return `<div class="table-wrap"><table class="rep-table">
      <thead><tr><th>#</th>${picked.map((k) => `<th>${esc(labelOf(k))}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr><td>${ui.fmt(i + 1)}</td>${picked.map((k) => `<td>${esc(r[k] == null ? "" : r[k])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`
      + (list.length > shown.length ? `<p class="conv-hint">يُعرض ${ui.fmt(shown.length)} من ${ui.fmt(list.length)} — التصدير يأخذها كلها.</p>` : "");
  }

  function render() {
    if (!$("rep-body")) return;
    const s = snap();
    const list = rows();
    $("rep-meta").textContent = s && s.at
      ? `${ui.fmt(students().length)} طالباً في آخر لقطة (${new Date(s.at).toLocaleString("ar-EG")}) · الظاهر الآن ${ui.fmt(list.length)}`
      : "لا توجد بيانات بعد — شغّل سكربت القراءة من صفحة «شاشة إحصاءات المركز»";
    renderFields();
    renderFilters();
    $("rep-body").innerHTML = !students().length
      ? `<section class="card sc-empty"><h3>لا توجد بيانات طلاب بعد</h3>
          <p>هذه الصفحة تعرض بيانات نظام المركز التي يجلبها سكربت القراءة. افتح «شاشة إحصاءات المركز» واضغط «▶ تشغيل القراءة في النظام»، وبعد «أُرسلت ✔» عُد إلى هنا.</p></section>`
      : `<section class="card">${groupBy ? summary(list) : table(list)}</section>`;
  }

  /* ===== التصدير والطباعة ===== */
  async function toExcel() {
    const list = rows();
    if (!list.length) { ui.toast("لا توجد سجلات"); return; }
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("تقرير", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    if (groupBy) {
      ws.columns = [{ header: labelOf(groupBy), key: "k", width: 30 }, { header: "العدد", key: "n", width: 12 }, { header: "النسبة", key: "p", width: 12 }];
      const map = new Map();
      list.forEach((r) => { const k = String(r[groupBy] || "").trim() || "— بلا قيمة —"; map.set(k, (map.get(k) || 0) + 1); });
      [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => ws.addRow({ k, n, p: Math.round((n / list.length) * 100) + "%" }));
    } else {
      ws.columns = picked.map((k) => ({ header: labelOf(k), key: k, width: k === "name" ? 28 : k === "track" ? 30 : 16 }));
      list.forEach((r) => ws.addRow(picked.reduce((o, k) => Object.assign(o, { [k]: r[k] == null ? "" : r[k] }), {})));
    }
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2332" } };
    const buf = await wb.xlsx.writeBuffer();
    const tag = Object.values(filters).filter(Boolean).join(" - ");
    ui.download(`تقرير المركز${tag ? " - " + tag : ""}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    ui.toast(`صُدّر ${ui.fmt(list.length)} سجلاً`);
  }

  function print() {
    const list = rows();
    if (!list.length) { ui.toast("لا توجد سجلات"); return; }
    const head = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${labelOf(k)}: ${v}`).join(" · ");
    const body = groupBy ? summary(list) : table(list);
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير المركز</title>
      <style>@page{size:A4 landscape;margin:10mm}
        body{font-family:Tahoma,Arial;margin:14px;color:#1e2633}
        h1{font-size:15pt;background:#1a2332;color:#fff;padding:8px;border-radius:6px;margin:0 0 6px}
        p.meta{font-size:9pt;color:#626d7d;margin:0 0 10px}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}
        th,td{border:1px solid #c9ced6;padding:3px 5px;text-align:center}
        th{background:#eff0f3}
        .rep-total td{font-weight:bold;background:#f5f7fb}
        .conv-hint{display:none}
      </style></head><body>
      <h1>تقرير بيانات المركز</h1>
      <p class="meta">${esc(head || "كل السجلات")} — ${ui.fmt(list.length)} سجلاً — ${esc(new Date().toLocaleString("ar-EG"))}</p>
      ${body}
      </body></html>`;
    const w = window.open("", "_blank", "width=1100,height=800");
    if (w && w.document) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); return; }
    const back = document.createElement("div");
    back.className = "modal-backdrop open sc-sheet";
    back.innerHTML = `<div class="modal sc-sheet-box"><div class="modal-head"><b>تقرير المركز</b>
        <span class="btn-row"><button type="button" class="btn small" data-print>🖨 طباعة</button>
        <button type="button" class="btn small secondary" data-close>إغلاق</button></span></div>
      <iframe class="sc-sheet-frame" title="تقرير"></iframe></div>`;
    document.body.append(back);
    const frame = back.querySelector("iframe");
    frame.srcdoc = html;
    back.querySelector("[data-close]").addEventListener("click", () => back.remove());
    back.querySelector("[data-print]").addEventListener("click", () => { frame.contentWindow.focus(); frame.contentWindow.print(); });
  }

  /* ===== الأحداث ===== */
  function init() {
    if (!$("rep-body")) return;
    $("rep-fields").addEventListener("change", (e) => {
      const b = e.target.closest("[data-field]");
      if (!b) return;
      const k = b.dataset.field;
      picked = b.checked ? [...new Set([...picked, k])] : picked.filter((x) => x !== k);
      order();
      save();
      render();
    });
    $("rep-fields").addEventListener("click", (e) => {
      const all = e.target.closest("[data-all]"), none = e.target.closest("[data-none]");
      const g = GROUPS.find((x) => x.name === ((all && all.dataset.all) || (none && none.dataset.none)));
      if (!g) return;
      const keys = g.fields.map((f) => f.key);
      picked = all ? [...new Set([...picked, ...keys])] : picked.filter((k) => !keys.includes(k));
      order();
      save();
      render();
    });
    $("rep-filters").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-filter]");
      if (sel) { filters[sel.dataset.filter] = sel.value; save(); render(); return; }
      if (e.target.id === "rep-group-by") { groupBy = e.target.value; save(); render(); }
    });
    let typing = null;
    $("rep-filters").addEventListener("input", (e) => {
      if (e.target.id !== "rep-search") return;
      const v = e.target.value;
      clearTimeout(typing);
      typing = setTimeout(() => {
        search = v;
        render();
        const q = $("rep-search");
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }, 300);
    });
    $("rep-clear").addEventListener("click", () => { filters = {}; search = ""; groupBy = ""; save(); render(); });
    $("rep-excel").addEventListener("click", toExcel);
    $("rep-print").addEventListener("click", print);
  }

  App.reports = { init, render };
})(window.App = window.App || {});
