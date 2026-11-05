/* أوامر نظام المركز: يبني تمكين ملف أوامر، ويُنفّذه «وكيل» صغير داخل جلسة الموظف
   في نظام المركز نفسه (tools/ksach-runner.js)، ثم تعود النتائج إلى هنا.

   لماذا هكذا؟ نظام المركز صفحات تُرسم من الخادم ولا يصل إليه إلا متصفح الموظف
   وهو مسجّل دخوله؛ فلا كلمة مرور ولا رمز جلسة يمرّان بتمكين أبداً. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const core = () => App.converterCore;
  const SCHEMA = () => App.centerSchema;
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const norm = (v) => core().normalizeHeader(clean(v)).replace(/^مسار\s*/, "");
  const digits = (v) => String(v == null ? "" : v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");

  const state = {
    cmds: [],            // الأوامر المضافة
    adding: "",          // register | lookup | list
    reg: null,           // مُنشئ أمر التسجيل: { fileName, headers, rows, map }
    lookupText: "",
    listParams: {},
    results: null,       // نتائج التنفيذ المرفوعة
  };

  /* ===== أسماء الأعمدة المحتملة لكل حقل ===== */
  const GUESS = {
    full_name: /^(ال)?اسم(\s*ال(طالب|رباعي|كامل|متقدم))?$|الاسم الرباعي|full\s*name/,
    national_id: /هوي|national|\bid\b/,
    phone_1: /جوال|هاتف|تواصل\s*1|موبايل|phone|mobile/,
    phone_2: /تواصل\s*2|جوال\s*2|بديل|phone\s*2/,
    gender: /^(ال)?جنس$|gender|sex/,
    track_id: /مسار|track/,
    birth_date: /ميلاد|birth/,
    marital_status: /اجتماع|marital/,
    governorate_id: /محافظ/,
    current_address: /عنوان|سكن/,
    family_members_count: /افراد|أفراد|اسره|أسرة/,
    education_level: /تعليم|مؤهل/,
    specialization: /تخصص/,
    notes: /ملاحظ/,
    health_status: /صح/,
    employment_status: /عمل/,
    status: /^(ال)?حاله$|^(ال)?حالة$|status/,
  };
  function guessCol(field, headers) {
    const rx = GUESS[field.name];
    const label = norm(field.label);
    return headers.find((h) => norm(h) === label)
      || (rx && headers.find((h) => rx.test(norm(h)) || rx.test(clean(h)))) || "";
  }

  /* ===== ترجمة قيم Excel إلى قيم قوائم النظام ===== */
  const ALIAS = { male: /^(ذكر|male|m|ولد)$/i, female: /^(انثى|أنثى|انثي|female|f|بنت)$/i };
  function toOption(field, raw) {
    const v = clean(raw);
    if (!v) return "";
    const opts = field.options || [];
    const byVal = opts.find((o) => String(o.v).toLowerCase() === v.toLowerCase());
    if (byVal) return byVal.v;
    const n = norm(v);
    const exact = opts.find((o) => norm(o.t) === n);
    if (exact) return exact.v;
    if (field.name === "gender") { const k = Object.keys(ALIAS).find((x) => ALIAS[x].test(v)); if (k) return k; }
    const near = opts.filter((o) => norm(o.t).includes(n) || n.includes(norm(o.t)));
    return near.length === 1 ? near[0].v : "";
  }
  function toDate(raw) {
    if (raw instanceof Date && !isNaN(raw)) return raw.toISOString().slice(0, 10);
    const s = clean(raw).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
  }

  /* ===== بناء صفوف التسجيل من Excel والربط ===== */
  function buildRegister() {
    const r = state.reg;
    const fields = SCHEMA().createStudent.fields;
    const ok = [], bad = [];
    const seen = new Set();
    r.rows.forEach((src, i) => {
      const row = {};
      const why = [];
      fields.forEach((f) => {
        const m = r.map[f.name] || {};
        let raw = "";
        if (m.src === "fixed") raw = m.fixed;
        else if (m.src && m.src.startsWith("col:")) raw = src[m.src.slice(4)];
        if (raw == null || clean(raw) === "") return;
        let v;
        if (f.options && f.options.length) {
          v = toOption(f, raw);
          if (!v) why.push(`«${clean(raw)}» ليست من قائمة ${f.label}`);
        } else if (f.type === "date") {
          v = toDate(raw);
          if (!v) why.push(`تاريخ غير مفهوم في ${f.label}`);
        } else if (f.name === "national_id") v = digits(raw);
        else if (/^phone/.test(f.name)) v = digits(raw);
        else if (f.type === "number") v = digits(raw);
        else v = clean(raw);
        if (v !== undefined && v !== "") row[f.name] = v;
      });
      fields.filter((f) => f.required).forEach((f) => { if (!row[f.name] && !why.some((w) => w.includes(f.label))) why.push(`ناقص: ${f.label}`); });
      if (row.national_id && row.national_id.length !== 9) why.push("رقم الهوية ليس 9 أرقام");
      if (row.national_id && seen.has(row.national_id)) why.push("هوية مكررة في الملف");
      if (row.national_id) seen.add(row.national_id);
      if (why.length) bad.push({ n: i + 2, name: row.full_name || clean(src[Object.keys(src)[0]]), why: why.join("؛ ") });
      else ok.push(row);
    });
    return { ok, bad };
  }

  /* ===== الواجهة ===== */
  const optText = (f, v) => ((f.options || []).find((o) => String(o.v) === String(v)) || {}).t || v;

  function registerBuilder() {
    const r = state.reg;
    const fields = SCHEMA().createStudent.fields;
    if (!r) {
      return `<div class="conv-grade-note"><b class="conv-label">تسجيل طلاب من Excel</b>
        <label class="field"><span>ملف الطلبة (Excel)</span><input type="file" id="cc-reg-file" accept=".xlsx"></label></div>`;
    }
    const rows = fields.map((f) => {
      const m = r.map[f.name] || {};
      const cols = r.headers.map((h) => `<option value="col:${esc(h)}" ${m.src === "col:" + h ? "selected" : ""}>${esc(h)}</option>`).join("");
      let fixed = "";
      if (m.src === "fixed") {
        fixed = f.options && f.options.length
          ? `<select data-cc-fixed="${f.name}">${["", ...f.options.map((o) => o.v)].map((v) => `<option value="${esc(v)}" ${String(m.fixed) === String(v) ? "selected" : ""}>${v === "" ? "— اختر —" : esc(optText(f, v))}</option>`).join("")}</select>`
          : `<input data-cc-fixed="${f.name}" type="${f.type === "date" ? "date" : "text"}" value="${esc(m.fixed || "")}">`;
      }
      return `<tr><td>${esc(f.label)}${f.required ? ' <span class="cc-req">*</span>' : ""}</td>
        <td><select data-cc-src="${f.name}"><option value="">— غير مستخدم —</option><option value="fixed" ${m.src === "fixed" ? "selected" : ""}>قيمة ثابتة للجميع</option>${cols}</select> ${fixed}</td></tr>`;
    }).join("");
    const { ok, bad } = buildRegister();
    const tracks = (fields.find((f) => f.name === "track_id") || {}).options || [];
    const sample = ok.slice(0, 6).map((x) => `<tr><td>${esc(x.full_name)}</td><td>${esc(x.national_id)}</td><td>${esc(optText({ options: tracks }, x.track_id))}</td><td>${esc(x.gender === "male" ? "ذكر" : x.gender === "female" ? "أنثى" : "")}</td><td>${esc(x.phone_1 || "")}</td></tr>`).join("");
    return `<div class="conv-grade-note"><b class="conv-label">تسجيل طلاب — ${esc(r.fileName)}</b>
      <p class="conv-hint">${ui.fmt(r.rows.length)} صفاً في الملف. اربط أعمدة ملفك بحقول نظام المركز (الإلزامي بنجمة).</p>
      <table class="cc-table"><tbody>${rows}</tbody></table>
      <p class="${bad.length ? "conv-error" : "conv-hint"}">✓ صالح للإرسال: <b>${ui.fmt(ok.length)}</b>${bad.length ? ` · ⚠ به مشكلة: <b>${ui.fmt(bad.length)}</b> (لن يُرسل)` : ""}</p>
      ${bad.length ? `<details><summary>تفاصيل المشاكل (${ui.fmt(bad.length)})</summary><table class="cc-table"><tbody>${bad.slice(0, 40).map((b) => `<tr><td>صف ${b.n}</td><td>${esc(b.name || "")}</td><td>${esc(b.why)}</td></tr>`).join("")}</tbody></table></details>` : ""}
      ${sample ? `<table class="cc-table"><thead><tr><th>الاسم</th><th>الهوية</th><th>المسار</th><th>الجنس</th><th>الجوال</th></tr></thead><tbody>${sample}</tbody></table>` : ""}
      <div class="btn-row"><button type="button" class="btn navy" data-cc="reg-add" ${ok.length ? "" : "disabled"}>أضف ${ui.fmt(ok.length)} طالباً إلى الأوامر</button>
        <button type="button" class="conv-link" data-cc="cancel">إلغاء</button></div></div>`;
  }

  function lookupBuilder() {
    return `<div class="conv-grade-note"><b class="conv-label">استعلام عن طلاب</b>
      <label class="field"><span>اكتب في كل سطر: رقم هوية أو اسماً أو جوالاً</span>
        <textarea id="cc-lookup" rows="6" placeholder="401157938&#10;ملاك علاء الدين">${esc(state.lookupText)}</textarea></label>
      <div class="btn-row"><button type="button" class="btn navy" data-cc="lookup-add">أضف الاستعلام</button>
        <button type="button" class="conv-link" data-cc="cancel">إلغاء</button></div></div>`;
  }

  function listBuilder() {
    const fs = (SCHEMA().studentFilters.fields || []).filter((f) => f.name !== "per_page");
    const inputs = fs.map((f) => f.options
      ? `<label class="field"><span>${esc(f.label || f.name)}</span><select data-cc-lp="${f.name}">${f.options.map((o) => `<option value="${esc(o.v)}" ${(state.listParams[f.name] || "") === o.v ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>`
      : `<label class="field"><span>${esc(f.label || f.name)}</span><input data-cc-lp="${f.name}" value="${esc(state.listParams[f.name] || "")}"></label>`).join("");
    return `<div class="conv-grade-note"><b class="conv-label">استخراج قائمة الطلاب</b>
      <div class="inv-form">${inputs}</div>
      <div class="btn-row"><button type="button" class="btn navy" data-cc="list-add">أضف الاستخراج</button>
        <button type="button" class="conv-link" data-cc="cancel">إلغاء</button></div></div>`;
  }

  const cmdSummary = (c) => c.type === "register" ? `تسجيل ${ui.fmt(c.rows.length)} طالباً`
    : c.type === "lookup" ? `استعلام عن ${ui.fmt(c.items.length)}`
      : "استخراج قائمة الطلاب" + (Object.keys(c.params).length ? ` (${Object.keys(c.params).map((k) => `${k}=${c.params[k]}`).join("، ")})` : "");

  function resultsView() {
    const res = state.results;
    if (!res) return "";
    const tbl = (heads, rows) => `<div class="cc-scroll"><table class="cc-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const STATUS = { created: "✓ سُجّل", exists: "موجود أصلاً", invalid: "غير صالح", failed: "✗ فشل", unverified: "؟ تحقق يدوياً", skipped: "لم يُنفَّذ" };
    return res.results.map((r, i) => {
      if (r.error) return `<div class="conv-grade-note"><b>أمر ${i + 1}</b> <span class="conv-error">${esc(r.error)}</span></div>`;
      if (r.type === "register") {
        const cnt = (s) => r.rows.filter((x) => x.status === s).length;
        return `<div class="conv-grade-note"><b>تسجيل — ${esc(r.label)}</b>
          <p class="conv-hint">سُجّل ${ui.fmt(cnt("created"))} · موجود أصلاً ${ui.fmt(cnt("exists"))} · غير صالح ${ui.fmt(cnt("invalid"))} · فشل ${ui.fmt(cnt("failed"))} · تحقق يدوياً ${ui.fmt(cnt("unverified"))} · لم يُنفَّذ ${ui.fmt(cnt("skipped"))}</p>
          ${tbl(["الاسم", "الهوية", "النتيجة", "ملاحظة"], r.rows.map((x) => [x.name, x.nid, STATUS[x.status] || x.status, x.message || ""]))}
          <div class="btn-row"><button type="button" class="conv-link" data-cc="export-reg" data-i="${i}">تنزيل Excel</button></div></div>`;
      }
      if (r.type === "lookup") {
        return `<div class="conv-grade-note"><b>استعلام</b>${r.items.map((it) => `<p class="conv-hint"><b>${esc(it.q)}</b> — ${it.count ? ui.fmt(it.count) + " نتيجة" : "لا نتيجة"}</p>${it.count ? tbl(it.heads, it.rows.map((x) => x.cells)) : ""}`).join("")}</div>`;
      }
      return `<div class="conv-grade-note"><b>قائمة الطلاب</b> <span class="conv-hint">${ui.fmt(r.rows.length)} صفاً</span>
        ${tbl(r.heads, r.rows.slice(0, 100).map((x) => x.cells))}
        <div class="btn-row"><button type="button" class="conv-link" data-cc="export-list" data-i="${i}">تنزيل كل الصفوف Excel</button></div></div>`;
    }).join("");
  }

  function render() {
    const box = $("cc-body");
    if (!box) return;
    if (!SCHEMA()) { box.innerHTML = '<p class="conv-error">مخطط نظام المركز غير محمَّل.</p>'; return; }
    const adding = state.adding === "register" ? registerBuilder() : state.adding === "lookup" ? lookupBuilder() : state.adding === "list" ? listBuilder() : "";
    box.innerHTML = `
      <div class="cc-step"><span class="cv-step-tag">١</span> <b>ما الذي تريد من الوكيل أن يفعله؟</b></div>
      <div class="btn-row">
        <button type="button" class="btn navy" data-cc="add-register">+ تسجيل طلاب من Excel</button>
        <button type="button" class="btn" data-cc="add-lookup">+ استعلام</button>
        <button type="button" class="btn" data-cc="add-list">+ استخراج قائمة</button>
      </div>
      ${adding}
      ${state.cmds.length ? `<div class="conv-grade-note"><b class="conv-label">الأوامر (${ui.fmt(state.cmds.length)})</b>
        ${state.cmds.map((c, i) => `<p>${i + 1}. ${esc(cmdSummary(c))} <button type="button" class="conv-link danger" data-cc="del" data-i="${i}">حذف</button></p>`).join("")}
        <div class="btn-row"><button type="button" class="btn navy" data-cc="pack">⬇ أنشئ ملف الأوامر</button></div></div>` : ""}
      <div class="cc-step"><span class="cv-step-tag">٢</span> <b>شغّل الوكيل في نظام المركز</b></div>
      <ol class="cc-how">
        <li>نزّل <b>ملف الأوامر</b> أعلاه، ثم <button type="button" class="conv-link" data-cc="runner-dl">نزّل الوكيل</button> أو <button type="button" class="conv-link" data-cc="runner-copy">انسخه</button>.</li>
        <li>افتح نظام المركز وأنت <b>مسجّل دخولك</b>، واضغط F12 ← Console، والصق الوكيل ثم Enter.</li>
        <li>اختر ملف الأوامر في اللوحة التي تظهر. سترى <b>معاينة</b> بما سيُكتب، ولا يُكتب شيء حتى تضغط «نفّذ».</li>
        <li>ينزل ملف <b>ksach-results.json</b>؛ ارفعه هنا.</li>
      </ol>
      <p class="conv-hint">🔒 لا كلمة مرور ولا رمز جلسة يمرّان بتمكين؛ الوكيل يعمل في جلستك أنت، ولا يرسل إلا: قراءة قائمة الطلاب، وفتح نموذج الإضافة، وإضافة طالب. ويتجاوز المسجّل أصلاً (بالبحث برقم الهوية) ويتوقف بعد ثلاثة إخفاقات متتالية.</p>
      <div class="cc-step"><span class="cv-step-tag">٣</span> <b>النتائج</b></div>
      <label class="field"><span>ملف النتائج (ksach-results.json)</span><input type="file" id="cc-results" accept=".json"></label>
      ${resultsView()}`;
  }

  /* ===== التنزيل ===== */
  async function exportBook(name, heads, rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("النتائج");
    ws.views = [{ rightToLeft: true }];
    ws.addRow(heads);
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c) => { c.width = 24; });
    ui.download(name, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  async function runnerText() {
    const res = await fetch("tools/ksach-runner.js?v=" + Date.now());
    if (!res.ok) throw new Error("تعذّر تحميل الوكيل");
    return res.text();
  }

  /* ===== الأحداث ===== */
  function init() {
    const box = $("cc-body");
    if (!box) return;
    render();

    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cc]");
      if (!b) return;
      const act = b.dataset.cc;
      const i = Number(b.dataset.i);
      try {
        if (act === "add-register") { state.adding = "register"; state.reg = null; }
        else if (act === "add-lookup") { state.adding = "lookup"; }
        else if (act === "add-list") { state.adding = "list"; state.listParams = {}; }
        else if (act === "cancel") { state.adding = ""; state.reg = null; }
        else if (act === "del") state.cmds.splice(i, 1);
        else if (act === "reg-add") {
          const { ok } = buildRegister();
          state.cmds.push({ type: "register", label: state.reg.fileName, rows: ok });
          state.adding = ""; state.reg = null;
        } else if (act === "lookup-add") {
          const items = ($("cc-lookup").value || "").split(/\r?\n/).map(clean).filter(Boolean).map((q) => ({ q }));
          if (!items.length) return ui.toast("اكتب سطراً واحداً على الأقل");
          state.cmds.push({ type: "lookup", label: "استعلام", items });
          state.adding = ""; state.lookupText = "";
        } else if (act === "list-add") {
          const params = {};
          Object.keys(state.listParams).forEach((k) => { if (state.listParams[k]) params[k] = state.listParams[k]; });
          state.cmds.push({ type: "list", label: "قائمة الطلاب", params });
          state.adding = "";
        } else if (act === "pack") {
          const pack = { v: 1, created: new Date().toISOString(), commands: state.cmds };
          ui.download("ksach-commands.json", JSON.stringify(pack, null, 2), "application/json");
          return ui.toast("نُزّل ملف الأوامر — يحوي بيانات طلبة، فاحتفظ به عندك فقط");
        } else if (act === "runner-dl") { ui.download("ksach-runner.js", await runnerText(), "text/javascript"); return; }
        else if (act === "runner-copy") { ui.copyText(await runnerText()); return; }
        else if (act === "export-reg") {
          const r = state.results.results[i];
          return exportBook("نتائج التسجيل.xlsx", ["الاسم", "الهوية", "النتيجة", "ملاحظة"], r.rows.map((x) => [x.name, x.nid, x.status, x.message || ""]));
        } else if (act === "export-list") {
          const r = state.results.results[i];
          return exportBook("قائمة الطلاب.xlsx", r.heads, r.rows.map((x) => x.cells));
        }
        render();
      } catch (err) { ui.toast(err.message); }
    });

    box.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.id === "cc-reg-file") {
        const f = t.files[0];
        if (!f) return;
        try {
          const d = await core().readDataFile(new Uint8Array(await f.arrayBuffer()));
          const map = {};
          SCHEMA().createStudent.fields.forEach((fld) => {
            const col = guessCol(fld, d.headers);
            if (col) map[fld.name] = { src: "col:" + col };
          });
          // الحالة الافتراضية للطالب الجديد: نشط
          if (!map.status) map.status = { src: "fixed", fixed: "active" };
          state.reg = { fileName: f.name, headers: d.headers, rows: d.rows, map };
          render();
        } catch (err) { ui.toast(err.message); }
      } else if (t.dataset.ccSrc) {
        const m = (state.reg.map[t.dataset.ccSrc] = state.reg.map[t.dataset.ccSrc] || {});
        m.src = t.value;
        if (t.value === "fixed" && m.fixed == null) m.fixed = "";
        render();
      } else if (t.dataset.ccFixed) {
        (state.reg.map[t.dataset.ccFixed] = state.reg.map[t.dataset.ccFixed] || {}).fixed = t.value;
        render();
      } else if (t.dataset.ccLp) {
        state.listParams[t.dataset.ccLp] = t.value;
      } else if (t.id === "cc-results") {
        const f = t.files[0];
        if (!f) return;
        try {
          const j = JSON.parse(await f.text());
          if (!j || !Array.isArray(j.results)) throw new Error("ملف نتائج غير صالح");
          state.results = j;
          render();
        } catch (err) { ui.toast(err.message); }
      }
    });
    box.addEventListener("input", (e) => {
      if (e.target.id === "cc-lookup") state.lookupText = e.target.value;
      if (e.target.dataset && e.target.dataset.ccLp && e.target.tagName === "INPUT") state.listParams[e.target.dataset.ccLp] = e.target.value;
    });
  }

  App.centerCmd = { init, render, state, buildRegister, toOption };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
