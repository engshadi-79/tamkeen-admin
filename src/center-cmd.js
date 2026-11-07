/* واجهة الوكيل المحلي. يتولى tools/ksach-agent-server.js تشغيل Edge وربط الأوامر
   المسموحة بصفحة النظام المفتوحة في جلسة المستخدم. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const core = () => App.converterCore;
  const SCHEMA = () => App.centerSchema;
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const norm = (v) => core().normalizeHeader(clean(v)).replace(/^مسار\s*/, "");
  const digits = (v) => String(v == null ? "" : v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");

  /* الوضع الافتراضي لكل تقرير: الطلاب النشطون الموزَّعون على مجموعات */
  const defaultSel = () => ({ tracks: [], stages: [], status: "active", group_status: "assigned", details: false, extra: {} });

  const state = {
    adding: "",          // register
    reg: null,           // مُنشئ أمر التسجيل: { fileName, headers, rows, map }
    requestText: "",
    proposal: null,
    results: null,
    resultError: "",
    busy: false,
    thinking: false,
    autoRunRegister: false,
    needsAiKey: false,
    agentStatus: null,
    sel: defaultSel(), // «تقارير جاهزة»
    labels: [],          // عنوان كل نتيجة في الدفعة الأخيرة
    hiddenCols: new Set(), // أعمدة أخفاها المستخدم من العرض والتنزيل (بأسمائها)
    cmp: { tracks: [], status: "", multiOnly: true, out: null }, // مقارنة المراحل
    sib: { tracks: [], status: "", phone: true, name: true, loose: false, both: false, stageMode: false, out: null }, // مقارنة الإخوة
    mis: { kind: "pre", tracks: [], stages: [], status: "active", verify: true, out: null }, // استبيانات وتعهدات
    mode: "report",      // report: تقرير جاهز | ask: اكتب طلبك
    open: { adv: false, cols: false, forms: true }, // حالة الأقسام القابلة للطي
    extraNote: "",
    tpls: null,          // القوالب المحفوظة في المحوّل
    tplPick: [],         // القوالب المختارة لإخراج النماذج
    fallbackNote: "",    // سبب عدم استعمال الذاكرة في آخر تنفيذ
    cache: null,         // نسخة محمّلة من كل البيانات في ذاكرة الصفحة فقط: { at, details, items:[{trackId,heads,rows}] }
    groupFilter: "",     // تصفية العرض بعمود «المجموعة» إن وُجد في النتائج
  };

  /* ===== تقارير جاهزة: اختيار مسارات/مراحل/حالة ثم تنفيذ =====
     المسارات والدورات من مخطط النظام. «المرحلة» = دورة تدريبية (مسار + مرحلة)،
     فنربط كل دورة بمسارها ومرحلتها من نصها. */
  const STAGES = [{ k: "الاولى", t: "المرحلة الأولى" }, { k: "الثان", t: "المرحلة الثانية" }, { k: "الثالث", t: "المرحلة الثالثة" }];
  const filterField = (name) => ((SCHEMA().studentFilters.fields || []).find((f) => f.name === name) || { options: [] });
  const trackOpts = () => filterField("track_id").options.filter((o) => o.v);
  function courseOpts() {
    const tracks = trackOpts();
    return filterField("training_course_id").options.filter((o) => o.v).map((o) => {
      const t = norm(o.t);
      const track = tracks.filter((k) => t.startsWith(norm(k.t))).sort((a, b) => b.t.length - a.t.length)[0];
      const stage = STAGES.find((s) => t.includes(norm(s.k)));
      return { v: String(o.v), t: o.t, track: track ? String(track.v) : "", stage: stage ? stage.k : "" };
    });
  }
  const optLabel = (field, v) => ((filterField(field).options.find((o) => String(o.v) === String(v)) || {}).t) || v;

  /* تصفية إضافية بحقول الطالب (الجنس، الوضع الصحي…): من حقول نموذج التسجيل ذات الخيارات.
     تُطبَّق على صفوف النتيجة بأعمدتها، لذلك تتطلب «كل بيانات الطالب» وتُفعَّل تلقائياً. */
  const EXTRA_SKIP = new Set(["track_id", "status"]);
  const extraFields = () => (SCHEMA().createStudent.fields || []).filter((f) => f.type === "select" && !EXTRA_SKIP.has(f.name) && (f.options || []).filter((o) => o.v !== "").length);
  const extraActive = () => Object.entries(state.sel.extra || {}).filter(([, v]) => v);
  function applyExtras(r) {
    const act = extraActive();
    if (!act.length || !r || r.type !== "list") return r;
    let rows = r.rows;
    for (const [name, v] of act) {
      const f = extraFields().find((x) => x.name === name);
      const o = f && f.options.find((x) => String(x.v) === String(v));
      if (!f || !o) continue;
      const i = r.heads.findIndex((h) => norm(h) === norm(f.label));
      if (i < 0) { state.extraNote = `لم أجد عمود «${f.label}» في النتيجة فلم تُطبَّق هذه التصفية. تأكد أن «كل بيانات الطالب» محمّلة.`; continue; }
      rows = rows.filter((x) => norm(x.cells[i]) === norm(o.t));
    }
    return Object.assign({}, r, { rows });
  }

  /* يحوّل الاختيار إلى أوامر: دورة لكل (مسار × مرحلة) حين تُختار مراحل، وإلا أمر لكل مسار */
  function buildSelection() {
    const s = state.sel;
    const common = {};
    if (s.status) common.status = s.status;
    if (s.group_status) common.group_status = s.group_status;
    const extra = [s.status && optLabel("status", s.status), s.group_status && optLabel("group_status", s.group_status)].filter(Boolean).join(" · ");
    const ex = extraActive().map(([k, v]) => { const f = extraFields().find((x) => x.name === k); const o = f && f.options.find((x) => String(x.v) === String(v)); return f && o ? f.label + ": " + o.t : ""; }).filter(Boolean).join(" · ");
    const needDetails = s.details || extraActive().length > 0;
    const mk = (params, label) => ({
      command: Object.assign({ type: "list", label, params: Object.assign({}, params, common) }, needDetails ? { details: true } : {}),
      label: label + (extra ? " — " + extra : "") + (ex ? " — " + ex : ""),
    });
    let out;
    if (s.stages.length) {
      const courses = courseOpts().filter((c) => s.stages.includes(c.stage) && (!s.tracks.length || s.tracks.includes(c.track)));
      if (!courses.length) throw new Error("لا توجد دورة تجمع المسار والمرحلة المختارين.");
      out = courses.map((c) => mk({ training_course_id: c.v }, c.t));
    } else if (s.tracks.length) {
      out = s.tracks.map((id) => mk({ track_id: id }, optLabel("track_id", id)));
    } else {
      if (!Object.keys(common).length) out = [mk({}, "كل الطلاب")];
      else out = [mk({}, "الطلاب")];
    }
    return out;
  }

  /* ملخص الاختيار بجملة واحدة تظهر بجانب زر التنفيذ */
  function selSummary() {
    const s = state.sel, parts = [];
    if (s.tracks.length) parts.push("المسارات: " + s.tracks.map((id) => optLabel("track_id", id).replace(/^مسار\s*/, "")).join("، "));
    if (s.stages.length) parts.push("المراحل: " + s.stages.map((k) => (STAGES.find((g) => g.k === k) || {}).t).filter(Boolean).join("، "));
    if (s.status) parts.push(optLabel("status", s.status));
    if (s.group_status) parts.push(optLabel("group_status", s.group_status));
    const ex = extraActive().length;
    if (ex) parts.push(ui.fmt(ex) + " تصفية متقدمة");
    return parts.length ? parts.join(" · ") : "كل الطلاب (بلا تصفية)";
  }

  function scriptsView() {
    const s = state.sel;
    const chk = (kind, v, text, on) => `<label class="cc-chk"><input type="checkbox" data-sel="${kind}" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const sel = (name) => `<label class="cc-field"><span>${esc(filterField(name).label || name)}</span><select data-sel="${name}">${filterField(name).options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === s[name] ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>`;
    let n = 0, err = "";
    try { n = buildSelection().length; } catch (e) { n = 0; err = e.message; }
    const exN = extraActive().length;
    const cacheRows = state.cache ? state.cache.items.reduce((a, it) => a + it.rows.length, 0) : 0;
    return `<section class="cc-card" id="cc-scripts">
      <header class="cc-card-h"><h3>تقرير جاهز</h3><p>اترك أي قائمة بلا اختيار لتشمل الكل. للقراءة فقط — لا يُكتب شيء في نظام المركز.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs"><legend>المسارات${s.tracks.length ? ` <em>${ui.fmt(s.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk("tracks", o.v, o.t.replace(/^مسار\s*/, ""), s.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>المراحل${s.stages.length ? ` <em>${ui.fmt(s.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => chk("stages", g.k, g.t, s.stages.includes(g.k))).join("")}</div></fieldset>
          <fieldset class="cc-fs cc-wide"><legend>الحالة والتوزيع</legend><div class="cc-two">${sel("status")}${sel("group_status")}</div></fieldset>
        </div>
        <details class="cc-adv" data-open="adv" ${state.open.adv || exN ? "open" : ""}>
          <summary><span>تصفية متقدمة بحقول الطالب</span>${exN ? `<span class="cc-badge on">${ui.fmt(exN)}</span>` : ""}<small>الجنس، الوضع الصحي، المحافظة…</small></summary>
          <p class="cc-note">اختيار أي حقل هنا يفعّل «كل بيانات الطالب» تلقائياً.</p>
          <div class="cc-three">${extraFields().map((f) => `<label class="cc-field"><span>${esc(f.label)}</span><select data-sel="x:${esc(f.name)}"><option value="">الكل</option>${f.options.filter((o) => o.v !== "").map((o) => `<option value="${esc(o.v)}" ${String((s.extra || {})[f.name]) === String(o.v) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>`).join("")}</div>
        </details>
        <div class="cc-opts">
          <div class="cc-opt">${chk("details", "1", "كل بيانات الطالب (الميلاد، العنوان…) — أبطأ، حتى 400 طالب لكل أمر", s.details)}</div>
          <div class="cc-opt cc-cache">${state.cache
            ? `<span class="cc-badge ok">⚡ محمّل</span><span class="cc-note">${ui.fmt(cacheRows)} طالباً${state.cache.details ? " ببياناتهم الكاملة" : ""} · ${esc(state.cache.at.toLocaleTimeString("ar"))} — التقارير فورية</span><button type="button" class="cc-link" data-cc="preload" ${state.busy ? "disabled" : ""}>تحديث</button><button type="button" class="cc-link" data-cc="drop-cache">مسح</button>`
            : `<button type="button" class="btn secondary small" data-cc="preload" ${state.busy ? "disabled" : ""}>⚡ حمّل كل البيانات مرة واحدة</button><span class="cc-note">اختياري — تُحفظ في هذه الصفحة فقط فتصير التقارير فورية.</span>`}</div>
        </div>
        ${err ? `<p class="cc-alert warn" role="status">${esc(err)}</p>` : ""}
        ${state.extraNote ? `<p class="cc-alert warn" role="status">${esc(state.extraNote)}</p>` : ""}
        ${state.fallbackNote ? `<p class="cc-alert warn" role="status">نُفِّذ من الموقع لا من الذاكرة — ${esc(state.fallbackNote)}</p>${state.fallbackNote.includes("بدون") ? '<button type="button" class="btn secondary small" data-cc="preload-details">⚡ أعد التحميل ببيانات كاملة الآن</button>' : ""}` : ""}
      </div>
      <footer class="cc-actions">
        <div class="cc-sum"><b>${n ? `سيُنفَّذ ${n === 1 ? "أمر واحد" : n === 2 ? "أمران" : ui.fmt(n) + (n < 11 ? " أوامر" : " أمراً")}` : "لا شيء للتنفيذ"}</b><span>${esc(selSummary())}</span></div>
        <div class="cc-act"><button type="button" class="cc-link" data-cc="clear-selection">مسح الاختيار</button><button type="button" class="btn navy" data-cc="run-selection" ${state.busy || !n ? "disabled" : ""}>${state.busy ? "جارٍ التنفيذ…" : "نفّذ التقرير"}</button></div>
      </footer></section>`;
  }

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
      <p class="${bad.length || ok.length > 80 ? "conv-error" : "conv-hint"}">✓ صالح للإرسال: <b>${ui.fmt(ok.length)}</b>${bad.length ? ` · ⚠ به مشكلة: <b>${ui.fmt(bad.length)}</b> (لن يُرسل)` : ""}${ok.length > 80 ? " · الحد 80 طالباً في الدفعة؛ قسّم الملف." : ""}</p>
      ${bad.length ? `<details><summary>تفاصيل المشاكل (${ui.fmt(bad.length)})</summary><table class="cc-table"><tbody>${bad.slice(0, 40).map((b) => `<tr><td>صف ${b.n}</td><td>${esc(b.name || "")}</td><td>${esc(b.why)}</td></tr>`).join("")}</tbody></table></details>` : ""}
      ${sample ? `<table class="cc-table"><thead><tr><th>الاسم</th><th>الهوية</th><th>المسار</th><th>الجنس</th><th>الجوال</th></tr></thead><tbody>${sample}</tbody></table>` : ""}
      <div class="btn-row">${!state.autoRunRegister ? `<button type="button" class="btn navy" data-cc="register-run" ${ok.length && ok.length <= 80 && !bad.length && !state.busy ? "" : "disabled"}>أرسل الملف وسجّل ${ui.fmt(ok.length)} طالباً</button>` : ""}
        <button type="button" class="conv-link" data-cc="cancel">إلغاء</button></div></div>`;
  }

  const cmdSummary = (c) => c.type === "register" ? `تسجيل ${ui.fmt(c.rows.length)} طالباً`
    : c.type === "lookup" ? `استعلام عن ${ui.fmt(c.items.length)}`
      : "استخراج قائمة الطلاب" + (Object.keys(c.params).length ? ` (${Object.keys(c.params).map((k) => `${k}=${c.params[k]}`).join("، ")})` : "");

  const INTENT_SYSTEM = `أنت تفهم أوامر موظف عربي لنظام إدارة متدربين. افهم الفصحى والعامية واللهجات الفلسطينية والشامية، ثم أعد كائن JSON واحداً فقط دون Markdown.
الأعمال المسموحة فقط:
1) lookup: البحث عن طالب محدد. الصيغة {"type":"lookup"}.
2) list: استخراج قائمة طلاب. الصيغة {"type":"list","filters":{"track_id":"قيمة","status":"قيمة"},"all":false}. أرسل فقط المرشحات التي طلبها المستخدم صراحة، واستخدم القيم المرمزة الواردة في خيارات الحقول. اجعل all=true فقط إذا طلب صراحة كل الطلاب.
3) register: تسجيل طلاب من ملف Excel يرفقه المستخدم. الصيغة {"type":"register"}.
إذا كان الطلب غامضاً، أو يطلب حذفاً أو تعديلاً أو اعتماداً أو أي عمل آخر، أعد {"type":"clarify","message":"سؤال قصير باللهجة المناسبة"} ولا تخمّن.
في lookup أعد {"type":"lookup"} فقط؛ هدف البحث محجوب عنك وسيضيفه التطبيق محلياً. لا تطلب الاسم أو الهوية إذا كانت ظاهرة كـ[هدف محجوب].
لا تكتب شرحاً خارج JSON ولا تنفذ أي شيء بنفسك.`;

  function privateSearchTarget(raw) {
    const match = raw.match(/(?:دور(?:لي)?|فتش(?:لي)?|ابحث(?:لي)?|اشوف|شوف(?:لي)?|اجيب(?:لي)?|جيب(?:لي)?|هات(?:لي)?|اطلع(?:لي)?|طلع(?:لي)?|لقي(?:لي)?|اعرف(?:لي)?|عرفني|خبرني|احكيلي|سيرش(?:لي)?|search|استعلم|تحقق|اعثر)\s+(?:(?:عن|على|ع|بخصوص|لي|لنا)\s+)*(.+)$/iu)
      || raw.match(/(?:شو|كيف|وين|ايش|إيش)\s+(?:(?:وضع|حاله|حالة|بيانات)\s+)?(.+)$/iu);
    if (!match) return [];
    let target = clean(match[1]);
    target = target.replace(/^(?:(?:كل|جميع|كامل)\s+)?(?:ال)?(?:بيانات|معلومات|تفاصيل)\s*/iu, "");     // قبل فحص «قائمة أم شخص؟»
    if (/^(?:قائمه|القائمه|لسته|اللسته|كشف|كشوف|تقرير|سجل|كل|جميع|طلاب|الطلاب|طلبه|الطلبه|طالبات|الطالبات|المتدربين|المتدربات|المستفيدين|المستفيدات|المتخرجين|المتخرجات|الخريجين|الخريجات|المسجلين|المسجلات|الناجحين|الناجحات|المنسحبين|المنسحبات|النشطين|النشطات)(?:\s|$)/iu.test(norm(target))) return [];
    target = target.replace(/^(?:اذا|إذا|هل|لو|ان|إن)\s+/iu, "");
    for (let i = 0; i < 3; i++) target = target.replace(/^(?:(?:ال)?(?:طالب|طالبه|متدرب|متدربه|مستفيد|مستفيده)|اسم|بيانات|معلومات|ملف|حاله|حالة|هويه|هوية|رقم\s*(?:الهويه|الهوية|الجوال|التواصل))\s*[:：-]?\s*/iu, "");
    target = target.split(/\s+(?:اللي|الذي|التي|في\s+مسار|بمسار|ضمن\s+مسار|في\s+دوره|في\s+الدوره|في\s+الدورة|متى|شو|وضعه|رقمه|رقمها|متخرج|متخرجه|متخرجين|متخرجات|ناجح|ناجحه|مسجل|مسجله|حضر|حاضره|قدم)(?:\s|$)/iu)[0];
    const numberRuns = target.match(/[0-9٠-٩]{9,}/g);
    if (numberRuns && numberRuns.length) return [...new Set(numberRuns.map(digits))].filter(Boolean).slice(0, 50);
    return target.split(/[\n,،;؛]+/).map(clean).filter((x) => x.length >= 2).slice(0, 50);
  }

  function sanitizedIntentText(raw, privateTargets) {
    let safe = raw;
    privateTargets.forEach((target) => { if (target) safe = safe.replaceAll(target, "[هدف بحث محجوب]"); });
    safe = safe.replace(/[0-9٠-٩]{7,}/g, "[رقم محجوب]");
    safe = safe.replace(/((?:الطالب|الطالبة|المتدرب|المتدربة|المستفيد|المستفيدة)\s+)([\p{L}][\p{L}\s-]{1,50})/gu, "$1[اسم محجوب]");
    return safe;
  }

  function normalizeFilters(rawFilters) {
    const fields = (SCHEMA().studentFilters.fields || []).filter((f) => f.name !== "per_page");
    const params = {};
    for (const [key, rawValue] of Object.entries(rawFilters || {})) {
      const field = fields.find((f) => f.name === key);
      if (!field || !field.options) throw new Error("اختار المحلل مرشحاً غير متاح؛ أعد صياغة الطلب.");
      if (rawValue == null) continue;
      const value = String(rawValue);
      const exact = field.options.find((o) => String(o.v) === value);
      const byLabel = field.options.filter((o) => norm(o.t) === norm(value));
      const found = exact || (byLabel.length === 1 ? byLabel[0] : null);
      if (!found || !found.v) throw new Error(`لم أستطع تحديد خيار «${field.label}» بدقة. أعد صياغة الطلب مع اسم المسار أو الحالة كما تظهر في النظام.`);
      params[key] = String(found.v);
    }
    return params;
  }

  /* ===== فهم محلي للأوامر الشائعة =====
     البحث والقوائم والتسجيل تُفهم هنا دون أي خدمة خارجية: أسرع، ولا تتعطل إن تعذّر
     الوصول لمزوّد الذكاء الاصطناعي، ولا يخرج نص الطلب من المتصفح. وما لا يُفهم
     محلياً أو يحتمل أكثر من معنى يُترك للذكاء الاصطناعي. */
  const STOP_WORDS = new Set(["مسار", "عن", "بعد", "في", "من", "علي", "الي"]);
  const wordsOf = (v) => norm(v).split(/[\s\-–—/،,.:()]+/)
    .map((w) => w.replace(/^(ال|و)(?=.{3,})/, "")).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const STATUS_WORDS = [
    ["graduated", /(متخرج|خريج|خريجين|خريجات|تخرج|ناجح)/],
    ["withdrawn", /(منسحب|انسحب|انسحاب)/],
    ["suspended", /(موقوف|ايقاف|وقف)/],
    ["under_review", /(قيد المراجعه|تحت المراجعه)/],
    ["active", /(نشط|نشيط|فعال|على راس عمله|مستمر)/],
  ];

  function localIntent(raw) {
    const n = norm(raw);
    // تسجيل طلاب: يحتاج ملف Excel يرفقه المستخدم
    if (/(سجل|تسجيل|ضيف|اضف|اضافه|ادخل|ادراج)/.test(n) && /(طلاب|طالب|متدرب|اكسل|excel|ملف|كشف|اسماء)/.test(n)) {
      return { type: "register-needed", message: "أرفق ملف Excel؛ سيقرأ الوكيل الأعمدة ثم تراجع المعاينة وتوافق قبل أن يُكتب شيء." };
    }
    // استعلام عن شخص محدد
    const targets = privateSearchTarget(raw);
    const searchVerb = /(دور|فتش|ابحث|بحث|اشوف|شوف|اجيب|جيب|هات|اطلع|طلع|لقي|اعرف|عرفني|خبرني|احكيلي|سيرش|search|استعلم|تحقق|اعثر)/.test(n);
    const askAbout = /(شو|ايش|كيف|وين)\s+(وضع|حاله|بيانات|معلومات|رقم)/.test(n);
    const wantsDetails = /(بيانات|معلومات|تفاصيل|تفصيل)/.test(n);       // «كل بيانات …» لا أعمدة الجدول فقط
    if (targets.length && (searchVerb || askAbout)) {
      return Object.assign({ type: "lookup", label: "استعلام من الطلب", items: targets.map((q) => ({ q })) }, wantsDetails ? { details: true } : {});
    }
    // قائمة طلاب
    if (!/(طلاب|طلبه|طالبات|متدرب|متخرج|خريج|منسحب|نشط|مسجل|موقوف|مستفيد|قائمه|لسته|كشف)/.test(n)) return null;
    const f = SCHEMA().studentFilters.fields;
    const field = (name) => f.find((x) => x.name === name) || { options: [] };
    const params = {};

    const st = STATUS_WORDS.find(([, rx]) => rx.test(n));
    if (st) params.status = st[0];

    // المسار: يُختار إن كان أفضل تطابق وحيداً، وإلا يُترك لفهم أدق
    const textWords = new Set(wordsOf(raw));
    const scored = field("track_id").options.filter((o) => o.v).map((o) => ({ o, hit: wordsOf(o.t).filter((w) => textWords.has(w)).length }))
      .filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit);
    if (scored.length) {
      if (scored.length > 1 && scored[0].hit === scored[1].hit) return null;       // «الرقمي» تطابق مساراً أكثر من واحد
      params.track_id = String(scored[0].o.v);
      // المرحلة (الدورة): «المرحلة الثانية» مع المسار نفسه
      const sm = n.match(/(?:مرحله|دوره)\s*(?:ال)?(اولي|ثانيه|ثالثه)/);
      if (sm) {
        const trackWords = wordsOf(scored[0].o.t);
        const course = field("training_course_id").options.filter((o) => o.v &&
          norm(o.t).includes(sm[1]) && trackWords.every((w) => wordsOf(o.t).includes(w)));
        if (course.length === 1) params.training_course_id = String(course[0].v);
        else return null;
      }
    }
    if (/غير\s*(ال)?موزع/.test(n) || /(بدون|بلا|ما عندهم|ليس لهم)\s*(مجموعه|توزيع)/.test(n)) params.group_status = "unassigned";
    else if (/(ال)?موزع/.test(n)) params.group_status = "assigned";

    const all = /(كل|جميع|كافه)\s*(ال)?(طلاب|طلبه|متدرب)/.test(n);
    if (!Object.keys(params).length && !all) {
      return { error: "هل تريد قائمة كل الطلاب؟ حدّد المسار أو الحالة، أو قل صراحة «كل الطلاب»." };
    }
    return Object.assign({ type: "list", label: "قائمة من الطلب", params }, wantsDetails ? { details: true } : {});
  }

  async function interpretRequest(raw) {
    const text = clean(raw);
    if (!text) throw new Error("اكتب طلبك باللهجة التي تفضلها.");
    const understood = localIntent(text);
    if (understood) return understood;                 // مفهوم محلياً: لا حاجة للذكاء الاصطناعي
    if (!App.ai || !App.ai.hasKey()) throw new Error("NO_KEY");
    const targets = privateSearchTarget(text);
    const options = (SCHEMA().studentFilters.fields || []).filter((f) => f.name !== "per_page").map((f) => ({ name: f.name, label: f.label, options: f.options || [] }));
    const context = `طلب الموظف بعد حجب اسم/رقم البحث: ${sanitizedIntentText(text, targets)}\nخيارات المرشحات الرسمية:\n${JSON.stringify(options)}`;
    let output = "";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      await App.ai.generate({
        request: "حلل الطلب وأعد JSON حسب التعليمات. إذا كان بحثاً فاستخدم type=lookup فقط.",
        context,
        systemPrompt: INTENT_SYSTEM,
        signal: controller.signal,
        onText: (part) => { output += part; },
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("تأخر مزوّد الذكاء الاصطناعي في الرد (ربما لا يصل إليه اتصالك، أو مفتاحه لا يعمل). الأوامر المباشرة تُفهم دونه، مثل: «دورلي على أحمد» أو «هاتلي المتخرجين بمسار الحلاقة» أو «سجّل طلاب».");
      throw error;
    } finally { window.clearTimeout(timeout); }
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("لم أفهم صيغة النتيجة من محلل الطلب. جرّب صياغة أقصر.");
    let intent;
    try { intent = JSON.parse(output.slice(start, end + 1)); }
    catch { throw new Error("تعذّر تحليل الأمر. أعد صياغته بجملة قصيرة."); }
    if (intent.type === "clarify") return { error: clean(intent.message) || "هل توضح المطلوب أكثر؟" };
    if (intent.type === "register") return { type: "register-needed", message: "أرفق ملف Excel؛ سيقرأ الوكيل الأعمدة محلياً ثم يسجل الصفوف الصالحة." };
    if (intent.type === "lookup") {
      if (!targets.length) return { error: "من تقصد؟ اذكر اسماً أو رقم هوية، مثلاً: «دورلي على [الاسم]»." };
      return { type: "lookup", label: "استعلام من الطلب", items: targets.map((q) => ({ q })) };
    }
    if (intent.type === "list") {
      const params = normalizeFilters(intent.filters);
      if (!Object.keys(params).length && intent.all !== true) return { error: "هل تريد قائمة كل الطلاب؟ حدّد المسار أو الحالة، أو قل صراحة «كل الطلاب»." };
      return { type: "list", label: "قائمة من الطلب", params };
    }
    return { error: "هذا الأمر غير متاح حالياً. أستطيع البحث، استخراج القوائم، أو تسجيل طلاب من Excel." };
  }

  function assistantView() {
    const p = state.proposal;
    let preview = "";
    if (p && p.type === "register-needed") preview = `<p class="cc-note">${esc(p.message)}</p>`;
    else if (p && p.error) preview = `<p class="cc-alert warn" role="status">${esc(p.error)}</p>${state.needsAiKey ? '<button type="button" class="btn secondary small" data-cc="ai-settings">إعداد الذكاء الاصطناعي</button>' : ""}`;
    return `<section class="cc-card cc-assistant">
      <header class="cc-card-h"><h3>اكتب طلبك بالعربية</h3><p>بحث عن طالب، قوائم، أو تسجيل طلاب من ملف Excel.</p></header>
      <div class="cc-card-b">
        <label class="cc-field"><span>مثلاً: «دورلي على أحمد» أو «هاتلي المتخرجين بمسار التسويق»</span>
          <textarea id="cc-request" rows="3" placeholder="ماذا تريد من الوكيل؟">${esc(state.requestText)}</textarea></label>
        <p class="cc-note">الأوامر الشائعة تُفهم داخل المتصفح دون إرسال شيء. وما عداها يحلّله مزوّد الذكاء الاصطناعي المحدد في إعداداتك، بعد حجب هدف البحث والأرقام؛ ولا تُرسل نتائج النظام أو ملف Excel.</p>
        <div data-cc-preview>${preview}</div>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><span>اكتب الطلب ثم اضغط «نفّذ الأمر»</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="interpret" ${state.busy || state.thinking ? "disabled" : ""}>${state.thinking ? "جارٍ الفهم…" : "نفّذ الأمر"}</button></div></footer></section>`;
  }

  /* خطة التسجيل القادمة من الوكيل: تُراجَع هنا ولا يُكتب شيء قبل «نفّذ» */
  function planView() {
    const p = state.plan;
    if (!p) return "";
    const L = { create: "سيُسجَّل", exists: "موجود أصلاً — سيُتجاوز", invalid: "غير صالح — لن يُرسل" };
    return `<section class="cc-card cc-plan"><header class="cc-card-h"><h3>معاينة قبل الكتابة في نظام المركز</h3>
      <p>سيُسجَّل <b>${ui.fmt(p.create)}</b> · مسجّل أصلاً ${ui.fmt(p.exists)} · غير صالح ${ui.fmt(p.invalid)} — من ${ui.fmt(p.total)}. لا يُكتب شيء قبل موافقتك.</p></header>
      <div class="cc-card-b"><div class="cc-scroll"><table class="cc-table"><tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.nid)}</td><td>${esc(L[r.state] || r.state)}${r.why ? " — " + esc(r.why) : ""}</td></tr>`).join("")}</tbody></table></div></div>
      <footer class="cc-actions"><div class="cc-sum"></div><div class="cc-act"><button type="button" class="cc-link" data-cc="plan-no">إلغاء</button><button type="button" class="btn navy" data-cc="plan-ok" ${p.create ? "" : "disabled"}>نفّذ تسجيل ${ui.fmt(p.create)} طالباً</button></div></footer></section>`;
  }

  /* ===== اختيار الأعمدة: تنطبق على الجدول المعروض وعلى كل ملفات Excel ===== */
  function resultHeads() {
    const seen = [];
    ((state.results && state.results.results) || []).forEach((r) => {
      const lists = r.type === "lookup" ? (r.items || []) : r.type === "list" ? [r] : [];
      lists.forEach((l) => (l.heads || []).forEach((h) => { if (!seen.includes(h)) seen.push(h); }));
    });
    return seen;
  }
  /* يعيد [أعمدة، صفوف] بعد حذف المخفي؛ إن أُخفيت كلها نُظهرها كلها بدل ملف فارغ */
  function shown(heads, cellRows) {
    let idx = heads.map((h, i) => i).filter((i) => !state.hiddenCols.has(heads[i]));
    if (!idx.length) idx = heads.map((h, i) => i);
    return [idx.map((i) => heads[i]), cellRows.map((c) => idx.map((i) => c[i]))];
  }
  /* أعمدة فارغة في كل الصفوف المعروضة (لا قيمة فيها لأي طالب) */
  function emptyHeads() {
    const filled = new Set();
    const all = resultHeads();
    ((state.results && state.results.results) || []).forEach((r) => {
      const lists = r.type === "lookup" ? (r.items || []) : r.type === "list" ? [r] : [];
      lists.forEach((l) => (l.rows || []).forEach((x) => (l.heads || []).forEach((h, i) => { if (clean(x.cells[i])) filled.add(h); })));
    });
    return all.filter((h) => !filled.has(h));
  }
  function colsBar() {
    const heads = resultHeads();
    if (!heads.length) return "";
    const on = heads.filter((h) => !state.hiddenCols.has(h)).length;
    const e = emptyHeads().filter((h) => !state.hiddenCols.has(h));
    return `<details class="cc-adv" data-open="cols" ${state.open.cols ? "open" : ""}>
      <summary><span>الأعمدة الظاهرة</span><span class="cc-badge">${ui.fmt(on)} من ${ui.fmt(heads.length)}</span><small>تنطبق على الجدول وملفات Excel</small></summary>
      <div class="cc-chips">${heads.map((h) => `<label class="cc-chk"><input type="checkbox" data-col="${esc(h)}" ${state.hiddenCols.has(h) ? "" : "checked"}> <span>${esc(h)}</span></label>`).join("")}</div>
      ${e.length ? `<p class="cc-note">${ui.fmt(e.length)} عموداً فارغ عند كل الطلاب المعروضين: ${esc(e.join("، "))}. إما أنها غير مُعبَّأة في النظام، أو لا يحملها نموذج التعديل.</p>` : ""}
      <div class="cc-row"><button type="button" class="cc-link" data-cc="cols-all">إظهار الكل</button><button type="button" class="cc-link" data-cc="cols-none">إخفاء الكل</button><button type="button" class="cc-link" data-cc="cols-empty">إخفاء الأعمدة الفارغة</button></div>
      ${on === 0 ? '<p class="cc-note">لم تبقِ عموداً؛ سيُعرض كل شيء حتى تختار.</p>' : ""}</details>`;
  }

  /* ===== إخراج النماذج من البيانات المجلوبة =====
     بدل رفع ملف Excel: تُسلَّم الصفوف الظاهرة إلى «تحويل حسب قالب» كملف بيانات، مع القالب
     المحفوظ المختار، فيخرج النموذج بتنسيقه نفسه. تُرسل الأعمدة الأصلية للجدول (الطالب،
     المسار / الدورة…) والأعمدة المفصولة معاً كي يجد القالب ما يطابقه. */
  function feedData() {
    const headers = [], rows = [];
    ((state.results && state.results.results) || []).filter((r) => r.type === "list").forEach((r) => {
      const raw = r.rawHeads || r.heads;
      [...raw, ...r.heads].forEach((h) => { if (!headers.includes(h)) headers.push(h); });
      visibleRows(r).forEach((x) => {
        const o = {};
        raw.forEach((h, i) => { o[h] = (x.raw || x.cells)[i]; });
        r.heads.forEach((h, i) => { if (!(h in o)) o[h] = x.cells[i]; });
        // عمود «الطالب» الأصلي يجمع الاسم والاسم الإنجليزي والأرقام؛ القوالب تريد الاسم وحده
        const iName = r.heads.indexOf("الاسم");
        if (iName >= 0 && "الطالب" in o && raw.includes("الطالب")) o["الطالب"] = x.cells[iName];
        rows.push(o);
      });
    });
    return { headers, rows };
  }
  async function loadTemplates() {
    try { state.tpls = (await App.converterStore.list()).filter((t) => t.kind !== "exam"); }
    catch (e) { state.tpls = []; }
    if (state.results) render();
  }
  function formsCard() {
    if (!((state.results && state.results.results) || []).some((r) => r.type === "list")) return "";
    if (state.tpls == null) { loadTemplates(); return `<details class="cc-adv" data-open="forms" ${state.open.forms ? "open" : ""}><summary><span>إخراج النماذج</span></summary><p class="cc-note">جارٍ تحميل القوالب المحفوظة…</p></details>`; }
    const { rows } = feedData();
    return `<details class="cc-adv" data-open="forms" ${state.open.forms ? "open" : ""}>
      <summary><span>إخراج النماذج من هذه البيانات</span><span class="cc-badge">${ui.fmt(rows.length)} صفاً</span><small>بدل رفع ملف Excel</small></summary>
      ${state.tpls.length ? `<p class="cc-note">اختر قالباً أو عدة قوالب (ملف لكل قالب). تنتقل البيانات إلى «تحويل حسب قالب» وتخرج النماذج بتنسيقها المحفوظ نفسه.</p>
        <div class="cc-chips">${state.tpls.map((t) => `<label class="cc-chk"><input type="checkbox" data-tpl="${esc(t.id)}" ${state.tplPick.includes(t.id) ? "checked" : ""}> <span>${esc(t.name)} <small>${t.format === "docx" ? "Word" : "Excel"}</small></span></label>`).join("")}</div>
        <div class="cc-row"><button type="button" class="btn navy small" data-cc="to-forms" ${state.tplPick.length && rows.length ? "" : "disabled"}>جهّز النماذج${state.tplPick.length > 1 ? ` (${ui.fmt(state.tplPick.length)} قوالب)` : ""} ←</button></div>`
      : '<p class="cc-note">لا قوالب محفوظة بعد. احفظ قالباً من «تحويل حسب قالب» أولاً.</p>'}</details>`;
  }

  function resultsView() {
    const res = state.results;
    if (!res) return "";
    const tbl = (heads, rows) => `<div class="cc-scroll"><table class="cc-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const STATUS = { created: "✓ سُجّل", exists: "موجود أصلاً", invalid: "غير صالح", failed: "✗ فشل", unverified: "؟ تحقق يدوياً", skipped: "لم يُنفَّذ" };
    const dnote = (d) => d && d.error ? `<p class="cc-alert warn">${esc(d.error)}</p>` : d ? `<p class="cc-note">بيانات كاملة لـ${ui.fmt(d.read)} من ${ui.fmt(d.of)}${d.capped ? " (الحد الأقصى للقراءة الكاملة؛ قسّم الطلب)" : ""}.</p>` : "";
    const lists = res.results.filter((r) => r.type === "list");
    const total = lists.reduce((a, r) => a + visibleRows(r).length, 0);
    const head = lists.length ? `<div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(total)}</b> صفاً</span><span class="cc-stat"><b>${ui.fmt(lists.length)}</b> ${lists.length === 1 ? "جدول" : "جداول"}</span>${lists.length > 1 ? '<button type="button" class="btn secondary small" data-cc="export-all">تنزيل الكل في ملف واحد</button>' : ""}</div>` : "";
    const tools = colsBar() + formsCard();
    const body = res.results.map((r, i) => {
      if (r.error) return `<article class="cc-res"><header class="cc-res-h"><h4>أمر ${i + 1}</h4></header><p class="cc-alert warn">${esc(r.error)}</p></article>`;
      if (r.type === "register") {
        const cnt = (s) => r.rows.filter((x) => x.status === s).length;
        return `<article class="cc-res"><header class="cc-res-h"><h4>تسجيل — ${esc(r.label)}</h4><div class="cc-res-act"><button type="button" class="btn secondary small" data-cc="export-reg" data-i="${i}">تنزيل Excel</button></div></header>
          <div class="cc-stats"><span class="cc-stat ok"><b>${ui.fmt(cnt("created"))}</b> سُجّل</span><span class="cc-stat"><b>${ui.fmt(cnt("exists"))}</b> موجود أصلاً</span><span class="cc-stat"><b>${ui.fmt(cnt("invalid"))}</b> غير صالح</span><span class="cc-stat bad"><b>${ui.fmt(cnt("failed"))}</b> فشل</span><span class="cc-stat"><b>${ui.fmt(cnt("unverified"))}</b> تحقق يدوياً</span><span class="cc-stat"><b>${ui.fmt(cnt("skipped"))}</b> لم يُنفَّذ</span></div>
          ${tbl(["الاسم", "الهوية", "النتيجة", "ملاحظة"], r.rows.map((x) => [x.name, x.nid, STATUS[x.status] || x.status, x.message || ""]))}</article>`;
      }
      if (r.type === "lookup") {
        return `<article class="cc-res"><header class="cc-res-h"><h4>استعلام</h4></header>${r.items.map((it) => `<p class="cc-note"><b>${esc(it.q)}</b> — ${it.count ? ui.fmt(it.count) + " نتيجة" : "لا نتيجة"}</p>${dnote(it.details)}${it.count ? tbl(...shown(it.heads, it.rows.map((x) => x.cells))) : ""}`).join("")}</article>`;
      }
      const gi = groupCol(r);
      const rows = visibleRows(r);
      const gsel = gi < 0 ? "" : `<label class="cc-field cc-group"><span>المجموعة</span><select data-sel="groupFilter"><option value="">كل المجموعات</option>${groupValues(r, gi).map((g) => `<option value="${esc(g)}" ${g === state.groupFilter ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>`;
      return `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${esc(state.labels[i] || "قائمة الطلاب")}</h4><span class="cc-badge">${ui.fmt(rows.length)}${rows.length !== r.rows.length ? " من " + ui.fmt(r.rows.length) : ""} صفاً</span></div>
        <div class="cc-res-act">${gsel}<button type="button" class="btn secondary small" data-cc="export-list" data-i="${i}">تنزيل ${rows.length > 100 ? "كل الصفوف " : ""}Excel</button></div></header>
        ${dnote(r.details)}${rows.length > 100 ? '<p class="cc-note">يُعرض أول 100 صف؛ الملف المنزَّل يشمل الكل.</p>' : ""}
        ${tbl(...shown(r.heads, rows.slice(0, 100).map((x) => x.cells)))}</article>`;
    }).join("");
    return head + (tools ? `<div class="cc-tools">${tools}</div>` : "") + body;
  }

  /* عمود «المجموعة» إن وُجد في جدول النظام: يتيح تصفية العرض والتنزيل بمجموعة */
  const groupCol = (r) => (r.heads || []).findIndex((h) => /مجموع/.test(h));
  const groupValues = (r, gi) => [...new Set(r.rows.map((x) => clean(x.cells[gi])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  function visibleRows(r) {
    const gi = groupCol(r);
    return gi < 0 || !state.groupFilter ? r.rows : r.rows.filter((x) => clean(x.cells[gi]) === state.groupFilter);
  }

  /* ===== مقارنة المراحل: من سجّل في أكثر من مرحلة =====
     يُجلب طلاب كل دورة على حدة (أمر قراءة لكل دورة) ثم يُطابَقون برقم الهوية. */
  async function runCompare() {
    const c = state.cmp;
    state.busy = true; state.resultError = ""; c.out = null; state.progress = "";
    render(); refreshStatus();
    try {
      const courses = courseOpts().filter((x) => x.stage && (!c.tracks.length || c.tracks.includes(x.track)));
      if (!courses.length) throw new Error("لا دورات للمسارات المختارة.");
      const results = await runCommands(courses.map((x) => ({ type: "list", label: x.t, params: Object.assign({ training_course_id: x.v }, c.status ? { status: c.status } : {}) })));
      const people = new Map();
      const failed = [];
      results.forEach((r, i) => {
        const course = courses[i];
        if (!r || r.error || r.type !== "list") { failed.push(course.t + (r && r.error ? " — " + r.error : "")); return; }
        const at = (h) => r.heads.indexOf(h);
        const iId = at("رقم الهوية"), iName = at("الاسم"), iPhone = at("الجوال"), iGroup = at("المجموعة"), iNo = at("رقم الطالب");
        if (iId < 0 || iName < 0) throw new Error("تعذّر تحديد عمودي الاسم والهوية في جدول النظام؛ لا يمكن المطابقة.");
        r.rows.forEach((x) => {
          const id = digits(x.cells[iId]), no = clean(x.cells[iNo]), name = clean(x.cells[iName]);
          const key = id || no || name;
          if (!key) return;
          const p = people.get(key) || { name, id, phone: "", enr: [] };
          if (!p.phone && iPhone >= 0) p.phone = clean(x.cells[iPhone]);
          if (!p.id) p.id = id;
          if (!p.enr.some((e) => e.course === course.v)) p.enr.push({ course: course.v, stage: course.stage, track: course.track, group: iGroup >= 0 ? clean(x.cells[iGroup]) : "" });
          people.set(key, p);
        });
      });
      const list = [...people.values()].map((p) => Object.assign(p, { stages: [...new Set(p.enr.map((e) => e.stage))] }));
      const dist = {}; list.forEach((p) => { dist[p.stages.length] = (dist[p.stages.length] || 0) + 1; });
      const perStage = STAGES.map((g) => ({ k: g.k, t: g.t, n: list.filter((p) => p.stages.includes(g.k)).length }));
      const pairs = [];
      for (let i = 0; i < STAGES.length; i++) for (let j = i + 1; j < STAGES.length; j++) pairs.push({ a: STAGES[i], b: STAGES[j], n: list.filter((p) => p.stages.includes(STAGES[i].k) && p.stages.includes(STAGES[j].k)).length });
      c.out = { list, dist, perStage, pairs, failed, courses: courses.length, total: list.length, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }

  const trackShort = (id) => optLabel("track_id", id).replace(/^مسار\s*/, "");
  const cmpCell = (p, g) => p.enr.filter((e) => e.stage === g.k).map((e) => trackShort(e.track) + (e.group && e.group !== "-" ? " — " + e.group : "")).join(" + ");
  const cmpRows = () => {
    const o = state.cmp.out;
    const base = state.cmp.multiOnly ? o.list.filter((p) => p.stages.length > 1) : o.list;
    return base.slice().sort((a, b) => b.stages.length - a.stages.length || a.name.localeCompare(b.name, "ar"));
  };
  const cmpHeads = () => ["الاسم", "رقم الهوية", "الجوال", "عدد المراحل"].concat(STAGES.map((g) => g.t));
  const cmpTable = () => cmpRows().map((p) => [p.name, p.id, p.phone, String(p.stages.length)].concat(STAGES.map((g) => cmpCell(p, g))));

  function compareView() {
    const c = state.cmp;
    const chk = (v, text, on) => `<label class="cc-chk"><input type="checkbox" data-cmp="tracks" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const n = courseOpts().filter((x) => x.stage && (!c.tracks.length || c.tracks.includes(x.track))).length;
    return `<section class="cc-card" id="cc-compare">
      <header class="cc-card-h"><h3>مقارنة المراحل</h3><p>من سجّل في أكثر من مرحلة؟ تُقرأ قائمة كل دورة ثم يُطابَق الطلاب برقم الهوية. للقراءة فقط.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk(o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>تصفية</legend>
            <label class="cc-field"><span>حالة الطالب</span><select data-cmp="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>
            <label class="cc-chk" style="margin-top:8px"><input type="checkbox" data-cmp="multi" ${c.multiOnly ? "checked" : ""}> <span>المسجلون في أكثر من مرحلة فقط</span></label></fieldset>
        </div>
        ${state.resultError ? "" : ""}
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>سيُقرأ ${ui.fmt(n)} ${n === 1 ? "دورة" : n === 2 ? "دورتان" : n < 11 ? "دورات" : "دورة"}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.status ? " · " + esc(optLabel("status", c.status)) : " · كل الحالات"}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-compare" ${state.busy || !n ? "disabled" : ""}>${state.busy ? "جارٍ الجلب والمقارنة…" : "اجلب وقارن"}</button></div></footer></section>`;
  }

  function compareResult() {
    const o = state.cmp.out;
    if (!o) return "";
    const rows = cmpTable();
    const multi = o.list.filter((p) => p.stages.length > 1).length;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> نتيجة المقارنة</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total)}</b> طالباً مختلفاً</span><span class="cc-stat ok"><b>${ui.fmt(multi)}</b> في أكثر من مرحلة</span>${o.perStage.map((g) => `<span class="cc-stat"><b>${ui.fmt(g.n)}</b> ${esc(g.t)}</span>`).join("")}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-cmp">تنزيل Excel</button>' : ""}</div>
      <div class="cc-tools"><div class="cc-res"><header class="cc-res-h"><h4>التقاطع بين المراحل</h4></header>
        <div class="cc-stats">${o.pairs.map((x) => `<span class="cc-stat"><b>${ui.fmt(x.n)}</b> في ${esc(x.a.t)} و${esc(x.b.t)}</span>`).join("")}
          ${Object.keys(o.dist).sort().map((k) => `<span class="cc-stat"><b>${ui.fmt(o.dist[k])}</b> في ${k === "1" ? "مرحلة واحدة" : ui.fmt(k) + " مراحل"}</span>`).join("")}</div></div></div>
      ${o.failed.length ? `<p class="cc-alert warn">تعذّرت قراءة ${ui.fmt(o.failed.length)} دورة: ${esc(o.failed.join("؛ "))}</p>` : ""}
      ${!multi ? '<p class="cc-alert warn">لم يظهر أي طالب في أكثر من مرحلة. إما لا يوجد تكرار فعلاً، أو أن قائمة النظام تعرض الطالب تحت دورته الحالية فقط، فتحقق من طالب تعرف أنه سُجّل في مرحلتين.</p>' : ""}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${state.cmp.multiOnly ? "المسجلون في أكثر من مرحلة" : "كل الطلاب"}</h4><span class="cc-badge">${ui.fmt(rows.length)} صفاً</span></div></header>
        ${rows.length ? `<div class="cc-scroll"><table class="cc-table"><thead><tr>${cmpHeads().map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 300).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${rows.length > 300 ? '<p class="cc-note">يُعرض أول 300 صف؛ الملف المنزَّل يشمل الكل.</p>' : ""}` : '<p class="cc-note">لا صفوف.</p>'}</article></section>`;
  }

  /* ===== مقارنة الإخوة =====
     لا يوجد في النظام عمود «إخوة»، فيُستدل عليهم بالتطابق: رقم الهاتف نفسه، و/أو الاسم بعد
     الاسم الأول (الأب والجد والعائلة). تُجمَّع كل سلسلة طلاب متصلين بهذه الروابط في «عائلة». */
  const normName = (v) => clean(v).replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
  const phoneKey = (v) => { const d = digits(v); return d.length >= 9 ? d.slice(-9) : ""; };

  async function runSiblings() {
    const c = state.sib;
    state.busy = true; state.resultError = ""; c.out = null; state.progress = "";
    render(); refreshStatus();
    try {
      if (!c.phone && !c.name && !c.loose) throw new Error("اختر معياراً واحداً على الأقل للمقارنة.");
      const tracks = trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v)));
      // الذاكرة المحمّلة تغني عن الجلب؛ إلا مع تصفية بالحالة فنجلب (لا عمود حالة في الجدول)
      let lists;
      if (state.cache && !c.status) lists = state.cache.items.filter((it) => tracks.some((o) => String(o.v) === it.trackId));
      else lists = (await runCommands(tracks.map((o) => ({ type: "list", label: o.t, params: Object.assign({ track_id: String(o.v) }, c.status ? { status: c.status } : {}) })))).filter((r) => r && r.type === "list");
      const people = new Map();
      lists.forEach((r) => {
        const at = (h) => r.heads.indexOf(h);
        const iId = at("رقم الهوية"), iName = at("الاسم"), iPhone = at("الجوال"), iP2 = r.heads.findIndex((h) => /تواصل\s*2|جوال\s*2/.test(h)), iGroup = at("المجموعة"), iTrack = at("المسار");
        if (iName < 0) throw new Error("تعذّر تحديد عمود الاسم في جدول النظام.");
        r.rows.forEach((x) => {
          const id = iId >= 0 ? digits(x.cells[iId]) : "", name = clean(x.cells[iName]);
          const key = id || name; if (!key) return;
          const stage = (STAGES.find((g) => norm(x.course || "").includes(norm(g.k))) || {}).t || "";
          const p = people.get(key) || { name, id, phones: new Set(), places: [], stages: new Set() };
          if (stage) p.stages.add(stage);
          [iPhone, iP2].forEach((i) => { if (i >= 0) { const k = phoneKey(x.cells[i]); if (k) p.phones.add(k); } });
          const place = [iTrack >= 0 ? clean(x.cells[iTrack]).replace(/^مسار\s*/, "") : "", stage, iGroup >= 0 && clean(x.cells[iGroup]) !== "-" ? clean(x.cells[iGroup]) : ""].filter(Boolean).join(" · ");
          if (place && !p.places.includes(place)) p.places.push(place);
          people.set(key, p);
        });
      });
      const list = [...people.values()];
      // مفاتيح الاسم
      list.forEach((p) => {
        const t = normName(p.name).split(" ").filter(Boolean);
        p.nameKeys = [];
        if (c.name && t.length >= 3) p.nameKeys.push("s:" + t.slice(1).join(" "));
        if (c.loose && t.length >= 3) p.nameKeys.push("l:" + t[1] + " " + t[t.length - 1]);
        p.phoneKeys = c.phone ? [...p.phones] : [];
      });
      // اتحاد-بحث: كل مفتاح مشترك يربط أصحابه (أو، في وضع «كلاهما»، مفتاح الهاتف مع الاسم معاً)
      const par = list.map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const buckets = new Map();
      const bind = (k, i) => { if (buckets.has(k)) par[find(i)] = find(buckets.get(k)); else buckets.set(k, i); };
      list.forEach((p, i) => {
        if (c.both && c.phone && (c.name || c.loose)) { p.phoneKeys.forEach((pk) => p.nameKeys.forEach((nk) => bind(pk + "|" + nk, i))); }
        else { p.phoneKeys.forEach((k) => bind("p:" + k, i)); p.nameKeys.forEach((k) => bind(k, i)); }
      });
      const groups = new Map();
      list.forEach((p, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(p); });
      let fams = [...groups.values()].filter((g) => g.length > 1);
      const LAST = STAGES[STAGES.length - 1].t;
      let stageStats = null;
      if (c.stageMode) {
        // عائلة فيها طالب بالمرحلة الأخيرة وأخ/أخت (شخص آخر) سُجّل في مرحلة سابقة
        fams = fams.filter((g) => {
          const last = g.filter((p) => p.stages.has(LAST));
          const early = g.filter((p) => [...p.stages].some((x) => x !== LAST));
          return last.some((a) => early.some((b) => b !== a));
        });
        fams.forEach((g) => g.sort((a, b) => Number(b.stages.has(LAST)) - Number(a.stages.has(LAST))));
        const lastSet = new Set(), earlySet = new Set();
        fams.forEach((g) => g.forEach((p) => { if (p.stages.has(LAST)) lastSet.add(p); if ([...p.stages].some((x) => x !== LAST)) earlySet.add(p); }));
        stageStats = { last: lastSet.size, early: earlySet.size, lastLabel: LAST };
      }
      fams = fams.sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name, "ar"));
      const rows = [];
      fams.forEach((g, gi) => {
        const cnt = (f) => { const m = new Map(); g.forEach((p) => f(p).forEach((k) => m.set(k, (m.get(k) || 0) + 1))); return m; };
        const ph = cnt((p) => p.phoneKeys), nm = cnt((p) => p.nameKeys);
        g.forEach((p) => {
          const why = [p.phoneKeys.some((k) => ph.get(k) > 1) ? "هاتف" : "", p.nameKeys.some((k) => nm.get(k) > 1) ? "اسم" : ""].filter(Boolean).join(" + ");
          rows.push([String(gi + 1), p.name, p.id, [...p.phones].map((k) => "0" + k).join(" / "), [...p.stages].join("، "), p.places.join(" ؛ "), why]);
        });
      });
      const sizes = {}; fams.forEach((g) => { sizes[g.length] = (sizes[g.length] || 0) + 1; });
      c.out = { rows, families: fams.length, siblings: fams.reduce((a, g) => a + g.length, 0), total: list.length, largest: fams[0] ? fams[0].length : 0, sizes, stageStats, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  const sibHeads = () => ["العائلة", "الاسم", "رقم الهوية", "الهاتف", "المرحلة", "المسار · المرحلة · المجموعة", "سبب الربط"];

  function siblingsView() {
    const c = state.sib;
    const chk = (v, text, on) => `<label class="cc-chk"><input type="checkbox" data-sib="tracks" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const opt = (k, text, on) => `<label class="cc-chk"><input type="checkbox" data-sib="${k}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const n = trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v))).length;
    return `<section class="cc-card" id="cc-sib">
      <header class="cc-card-h"><h3>مقارنة الإخوة</h3><p>يجمع الطلاب الذين تربطهم قرابة محتملة: رقم هاتف واحد، أو الاسم نفسه بعد الاسم الأول. للقراءة فقط.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk(o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>تصفية</legend><label class="cc-field"><span>حالة الطالب</span><select data-sib="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></fieldset>
          <fieldset class="cc-fs cc-wide"><legend>معيار الربط</legend><div class="cc-chips">
            ${opt("phone", "نفس رقم الهاتف", c.phone)}${opt("name", "نفس الاسم بعد الاسم الأول (الأب والجد والعائلة)", c.name)}${opt("loose", "الأب والعائلة فقط (أوسع، أخطاؤه أكثر)", c.loose)}${opt("both", "يجب تحقق الهاتف والاسم معاً (أدق)", c.both)}</div>
            <div class="cc-chips" style="margin-top:8px">${opt("stageMode", "قارن المرحلة الأخيرة بالمراحل السابقة: من له أخ أو أخت سُجّل في مرحلة سابقة", c.stageMode)}</div>
            <p class="cc-note">الهاتف وحده قد يجمع غير الإخوة (هاتف مشترك لجهة أو قريب). و«معاً» يُظهر الأرجح فقط. عمود «سبب الربط» في النتيجة يبيّن ما جمعهم.</p></fieldset>
        </div>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${state.cache && !c.status ? "⚡ من الذاكرة المحمّلة" : `سيُقرأ ${ui.fmt(n)} ${n === 1 ? "مسار" : n === 2 ? "مساران" : n < 11 ? "مسارات" : "مساراً"}`}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.status ? " · " + esc(optLabel("status", c.status)) : " · كل الحالات"}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-sib" ${state.busy || !n ? "disabled" : ""}>${state.busy ? "جارٍ الجلب والمقارنة…" : "اجلب وقارن"}</button></div></footer></section>`;
  }

  function siblingsResult() {
    const o = state.sib.out;
    if (!o) return "";
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> نتيجة مقارنة الإخوة${o.stageStats ? " — " + esc(o.stageStats.lastLabel) + " مقابل المراحل السابقة" : ""}</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total)}</b> طالباً مختلفاً</span><span class="cc-stat ok"><b>${ui.fmt(o.families)}</b> عائلة</span><span class="cc-stat ok"><b>${ui.fmt(o.siblings)}</b> طالباً لهم إخوة</span><span class="cc-stat"><b>${ui.fmt(o.largest)}</b> أكبر عائلة</span>${o.stageStats ? `<span class="cc-stat ok"><b>${ui.fmt(o.stageStats.last)}</b> طالباً في ${esc(o.stageStats.lastLabel)} لهم إخوة في مراحل سابقة</span><span class="cc-stat"><b>${ui.fmt(o.stageStats.early)}</b> من الإخوة في المراحل السابقة</span>` : ""}
        ${Object.keys(o.sizes).sort((a, b) => a - b).map((k) => `<span class="cc-stat"><b>${ui.fmt(o.sizes[k])}</b> من ${ui.fmt(k)}</span>`).join("")}
        ${o.rows.length ? '<button type="button" class="btn secondary small" data-cc="export-sib">تنزيل Excel</button>' : ""}</div>
      ${o.rows.length ? "" : '<p class="cc-alert warn">لم أجد طلاباً يجمعهم المعيار المختار. جرّب إلغاء «معاً» أو تفعيل المعيار الأوسع.</p>'}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>العائلات المحتملة</h4><span class="cc-badge">${ui.fmt(o.rows.length)} صفاً</span></div></header>
        ${o.rows.length ? `<div class="cc-scroll"><table class="cc-table"><thead><tr>${sibHeads().map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${o.rows.slice(0, 400).map((r, i, a) => `<tr${i && a[i - 1][0] !== r[0] ? ' class="cc-sep"' : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${o.rows.length > 400 ? '<p class="cc-note">يُعرض أول 400 صف؛ الملف المنزَّل يشمل الكل.</p>' : ""}` : ""}</article></section>`;
  }

  /* ===== استبيانات وتعهدات: من لم يعبّئ ولم يوقّع =====
     الاستبيانات: تقرير النظام نفسه «الطلاب الذين لم يعبئوا الاستبيان» (قراءة فقط).
     التعهدات: لا تقرير «من لم يوقّع» في النظام، فيُحسب: طلاب النظام ناقص الموقّعين، بالهوية. */
  const MIS_KINDS = [{ k: "pre", t: "استبيان قبلي" }, { k: "post", t: "استبيان بعدي" }, { k: "impact", t: "استبيان قياس الأثر" }, { k: "pledge", t: "تعهد الطالب" }];
  const misHeads = () => ["الاسم", "رقم الهوية", "رقم الطالب", "الجوال", "المسار", "المرحلة", "المجموعة", "ملاحظة"];
  const stageOf = (text) => { const t = norm(text || ""); const g = STAGES.find((x) => t.includes(norm(x.k))); return g ? g.t : ""; };
  const stageFromGroup = (g) => /^S3/i.test(g) ? "المرحلة الثالثة" : /^G\d/i.test(g) ? "المرحلة الثانية" : /المجموعة|الاولى|الأولى/.test(g) ? "المرحلة الأولى" : "";
  const misCell = (r, x, h) => { const i = r.heads.indexOf(h); return i < 0 ? "" : clean(x.cells[i]); };

  /* التقارير الجديدة (التعهدات والإرسالات وتقرير النواقص) تحتاج وكيل الإضافة 1.2.0 فأحدث.
     الوكيل القديم لا يرفض المصدر الجديد بل يتجاهله ويقرأ قائمة الطلاب، فنمنع ذلك صراحةً. */
  function requireAgent12() {
    const v = String((App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version()) || "");
    const n = v.split(".").map(Number);
    const ok = n.length >= 2 && (n[0] > 1 || (n[0] === 1 && n[1] >= 2));
    if (!ok) throw new Error(v
      ? `إضافة «وكيل تمكين» في متصفحك قديمة (الإصدار ${v}) ولا تدعم هذا التقرير. أعد تنزيلها (الإصدار 1.2.0) من https://tamkeen-admin.vercel.app/extension/tamkeen-center-agent.zip ثم اضغط 🔄 على بطاقتها في chrome://extensions وأعد المحاولة.`
      : "هذا التقرير يعمل عبر إضافة «وكيل تمكين» (الإصدار 1.2.0 فأحدث) ولا تدعمه الجلسة المحلية.");
  }
  /* يتأكد أن ما وصل هو القائمة المطلوبة (لها العمود المميِّز) لا قائمة طلاب متنكّرة */
  function needHead(r, head, what) {
    if (r && r.type === "list" && !r.heads.some((x) => clean(x) === head)) {
      throw new Error(`وصلت قائمة غير متوقعة لـ«${what}» (لا عمود «${head}»). غالباً إضافة «وكيل تمكين» قديمة؛ حدّثها إلى 1.2.0.`);
    }
  }

  async function runMissing() {
    const c = state.mis;
    state.busy = true; state.resultError = ""; c.out = null; state.progress = "";
    render(); refreshStatus();
    try {
      requireAgent12();
      const trackIds = trackOpts().map((o) => String(o.v)).filter((id) => !c.tracks.length || c.tracks.includes(id));
      const statusOk = ["active", "withdrawn", "graduated", "suspended"].includes(c.status) ? c.status : "all";
      let rows = [], note = "", extra = {};
      if (c.kind !== "pledge") {
        let cmds;
        if (c.stages.length) {
          const courses = courseOpts().filter((x) => c.stages.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track)));
          if (!courses.length) throw new Error("لا دورة تجمع المسار والمرحلة المختارين.");
          cmds = courses.map((x) => ({ label: x.t, params: { training_course_id: x.v } }));
        } else if (c.tracks.length) cmds = c.tracks.map((id) => ({ label: optLabel("track_id", id), params: { track_id: id } }));
        else cmds = [{ label: "كل المسارات", params: {} }];
        const results = await runCommands(cmds.map((x) => ({ type: "list", source: "missing", label: x.label, params: Object.assign({ evaluation_type: c.kind, student_status: statusOk }, x.params) })));
        const seen = new Set();
        results.forEach((r) => {
          if (!r || r.type !== "list") return;
          needHead(r, "حالة تعبئة الاستبيان", "تقرير الطلاب الذين لم يعبئوا الاستبيان");
          r.rows.forEach((x) => {
            const row = { name: misCell(r, x, "الاسم") || misCell(r, x, "الطالب"), id: misCell(r, x, "رقم الهوية"), stu: misCell(r, x, "رقم الطالب"), phone: misCell(r, x, "الجوال"), track: misCell(r, x, "المسار").replace(/^مسار\s*/, ""), stage: stageOf(misCell(r, x, "الدورة")) || stageFromGroup(misCell(r, x, "المجموعة")), group: misCell(r, x, "المجموعة"), note: [misCell(r, x, "الاستبيان"), misCell(r, x, "حالة تعبئة الاستبيان")].filter(Boolean).join(" — ") };
            const key = row.id || row.stu || row.name + "|" + row.track + "|" + row.stage + "|" + row.note;
            if (!row.name || /^(لا يوجد|اختر)/.test(row.name) || seen.has(key)) return;     // صف الرسالة حين لا نواقص
            seen.add(key); rows.push(row);
          });
        });
        // التحقق: من عدّه التقرير ناقصاً لكن له إرسال من هذا النوع في «نتائج الاستبيانات» يُستبعد
        if (c.verify && rows.length) {
          const need = trackOpts().filter((o) => rows.some((x) => norm(x.track) === norm(o.t))).map((o) => String(o.v));
          const ids = need.length ? need : trackIds;
          const subs = await runCommands(ids.map((id) => ({ type: "list", source: "submissions", label: "إرسالات " + optLabel("track_id", id), params: { track_id: id } })));
          const doneStu = new Set(), doneName = new Set(); let failedSubs = 0, seenSubs = 0, allSubs = 0;
          const anyByStu = new Map(), anyByName = new Map(), sample = []; let subHeads = [];
          subs.forEach((r) => {
            if (!r || r.type !== "list") { failedSubs++; return; }
            needHead(r, "النموذج", "إرسالات الاستبيانات");
            if (!subHeads.length) subHeads = r.heads.slice();
            r.rows.forEach((x) => {
              allSubs++;
              const form = misCell(r, x, "النموذج");
              const kind = /قبلي/.test(form) ? "pre" : /بعدي/.test(form) ? "post" : "impact";
              const stu = misCell(r, x, "رقم الطالب"), nk = normName(misCell(r, x, "الاسم")) + "|" + norm(misCell(r, x, "المسار"));
              const info = ({ pre: "قبلي", post: "بعدي", impact: "قياس أثر" })[kind] + (misCell(r, x, "الدورة") ? " (" + misCell(r, x, "الدورة") + ")" : "");
              if (stu) anyByStu.set(stu, (anyByStu.get(stu) || []).concat(info));
              anyByName.set(nk, (anyByName.get(nk) || []).concat(info));
              if (sample.length < 3) sample.push((stu || "بلا رقم طالب") + " ← " + (form || "؟").slice(0, 60) + " ← " + kind);
              if (kind !== c.kind) return;
              seenSubs++;
              if (stu) doneStu.add(stu);
              doneName.add(nk);
            });
          });
          const reported = rows.length;
          rows = rows.filter((x) => !(x.stu ? doneStu.has(x.stu) : doneName.has(normName(x.name) + "|" + norm(x.track))));
          // بجانب كل من بقي: ما وجدناه من إرساله (أي نوع) ليظهر لك سبب بقائه
          let withOther = 0;
          rows.forEach((x) => {
            const f = (x.stu && anyByStu.get(x.stu)) || anyByName.get(normName(x.name) + "|" + norm(x.track));
            if (f && f.length) { withOther++; x.note = (x.note ? x.note + " | " : "") + "له إرسال: " + [...new Set(f)].join("، "); }
          });
          extra = { reported, excluded: reported - rows.length, submissions: seenSubs, allSubs, withOther, subHeads, sample };
          if (!allSubs) note += "لم تُقرأ أي إرسالات من «نتائج الاستبيانات»، فالتحقق غير فعّال. ";
          else if (!seenSubs) note += "قُرئ " + ui.fmt(allSubs) + " إرسالاً لكن لا شيء منها من نوع «" + ((MIS_KINDS.find((k) => k.k === c.kind) || {}).t || "") + "» حسب اسم النموذج؛ التحقق غير فعّال. ";
          if (failedSubs) note += "تعذّرت قراءة إرسالات " + ui.fmt(failedSubs) + " مسار للتحقق؛ قد تظهر أسماء عبّأت فعلاً. ";
        }
        // إن لم يعرض التقرير رقم الهوية نكمله من قائمة الطلاب (بالمطابقة برقم الطالب ثم بالاسم)
        if (rows.length && rows.every((x) => !x.id)) {
          const sl = await runCommands(trackIds.map((id) => ({ type: "list", label: optLabel("track_id", id), params: { track_id: id } })));
          const byStu = new Map(), byName = new Map();
          sl.forEach((r) => {
            if (!r || r.type !== "list") return;
            const iS = r.heads.indexOf("رقم الطالب"), iI = r.heads.indexOf("رقم الهوية"), iN = r.heads.indexOf("الاسم");
            if (iI < 0) return;
            r.rows.forEach((x) => {
              const id = digits(x.cells[iI]);
              if (iS >= 0 && clean(x.cells[iS])) byStu.set(clean(x.cells[iS]), id);
              const nk = normName(x.cells[iN]); byName.set(nk, byName.has(nk) ? "" : id);
            });
          });
          rows.forEach((x) => { x.id = (x.stu && byStu.get(x.stu)) || byName.get(normName(x.name)) || ""; });
          note += "لم يعرض التقرير رقم الهوية، فأُكمل من قائمة الطلاب (بمطابقة رقم الطالب أو الاسم).";
        }
      } else {
        const cmds = trackIds.map((id) => ({ type: "list", label: optLabel("track_id", id), params: Object.assign({ track_id: id }, c.status ? { status: c.status } : {}) }));
        cmds.push({ type: "list", source: "pledges", label: "التعهدات", params: {} });
        const res = await runCommands(cmds);
        const pl = res[res.length - 1];
        if (!pl || pl.type !== "list") throw new Error((pl && pl.error) || "تعذّرت قراءة قائمة التعهدات.");
        needHead(pl, "تاريخ الاعتماد", "التعهدات");
        const iPI = pl.heads.indexOf("رقم الهوية");
        if (iPI < 0) throw new Error("تعذّر تحديد رقم الهوية في قائمة التعهدات.");
        const pledged = new Set(pl.rows.map((x) => digits(x.cells[iPI])).filter(Boolean));
        const seen = new Set(); let targets = 0;
        res.slice(0, -1).forEach((r, i) => {
          if (!r || r.type !== "list") return;
          const iI = r.heads.indexOf("رقم الهوية");
          if (iI < 0) throw new Error("تعذّر تحديد رقم الهوية في قائمة الطلاب.");
          r.rows.forEach((x) => {
            const id = digits(x.cells[iI]);
            const stage = stageOf(x.course || misCell(r, x, "المسار / الدورة"));
            if (c.stages.length && !c.stages.some((k) => (STAGES.find((g) => g.k === k) || {}).t === stage)) return;
            if (!id || seen.has(id)) return;
            seen.add(id); targets++;
            if (pledged.has(id)) return;
            rows.push({ name: misCell(r, x, "الاسم"), id, stu: misCell(r, x, "رقم الطالب"), phone: misCell(r, x, "الجوال"), track: trackShort(trackIds[i]), stage, group: misCell(r, x, "المجموعة").replace(/^[-–—]$/, "") || "غير موزع", note: "" });
          });
        });
        extra = { targets, pledged: pledged.size };
      }
      const per = {}; rows.forEach((x) => { const k = (x.track || "—") + (x.stage ? " · " + x.stage : ""); per[k] = (per[k] || 0) + 1; });
      rows.sort((a, b) => (a.track + a.stage + a.group).localeCompare(b.track + b.stage + b.group, "ar") || a.name.localeCompare(b.name, "ar"));
      c.out = { kind: c.kind, rows, per, note, extra, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  const misTable = () => ((state.mis.out && state.mis.out.rows) || []).map((x) => [x.name, x.id, x.stu, x.phone, x.track, x.stage, x.group, x.note]);

  function missingView() {
    const c = state.mis;
    const chk = (k, v, text, on) => `<label class="cc-chk"><input type="checkbox" data-mis="${k}" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const kindT = (MIS_KINDS.find((x) => x.k === c.kind) || {}).t;
    const n = c.kind === "pledge" ? trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v))).length + 1 : (c.stages.length ? courseOpts().filter((x) => c.stages.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track))).length : Math.max(1, c.tracks.length));
    return `<section class="cc-card" id="cc-mis">
      <header class="cc-card-h"><h3>استبيانات وتعهدات — من لم يُكمل؟</h3><p>يستخرج الطلاب الذين لم يعبّئوا الاستبيان أو لم يوقّعوا التعهد، باسمهم وهويتهم ومسارهم ومجموعتهم. للقراءة فقط.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs cc-wide"><legend>ما المطلوب؟</legend><div class="cc-chips">${MIS_KINDS.map((x) => `<label class="cc-chk"><input type="radio" name="mis-kind" data-mis="kind" value="${x.k}" ${c.kind === x.k ? "checked" : ""}> <span>${esc(x.t)}</span></label>`).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk("tracks", o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>المراحل${c.stages.length ? ` <em>${ui.fmt(c.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => chk("stages", g.k, g.t, c.stages.includes(g.k))).join("")}</div>
            <label class="cc-field" style="margin-top:10px"><span>حالة الطالب</span><select data-mis="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></fieldset>
        </div>
        ${c.kind === "pledge" ? "" : `<label class="cc-chk"><input type="checkbox" data-mis="verify" ${c.verify ? "checked" : ""}> <span>تحقّق من الإرسالات الفعلية (يستبعد من عبّأ ولم يحتسبه التقرير) — أدق وأبطأ</span></label>`}
        <p class="cc-note">${c.kind === "pledge" ? "التعهد: يقرأ قائمة الطلاب وقائمة التعهدات ويطابقها برقم الهوية؛ والباقي هم من لم يوقّعوا." : "الاستبيان: يقرأ تقرير النظام «الطلاب الذين لم يعبئوا الاستبيان» بالمسار والمرحلة المختارين."}</p>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${esc(kindT || "")}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.stages.length ? " · " + esc(c.stages.map((k) => (STAGES.find((g) => g.k === k) || {}).t).join("، ")) : ""} · ${esc(optLabel("status", c.status) || "كل الحالات")} · ${ui.fmt(n)} ${n === 1 ? "طلب قراءة" : "طلبات قراءة"}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-mis" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ الاستخراج…" : "استخرج التقرير"}</button></div></footer></section>`;
  }

  function missingResult() {
    const o = state.mis.out;
    if (!o) return "";
    const rows = misTable();
    const title = (MIS_KINDS.find((x) => x.k === o.kind) || {}).t || "";
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> لم يُكمل: ${esc(title)}</h3>
      <div class="cc-stats"><span class="cc-stat bad"><b>${ui.fmt(rows.length)}</b> طالباً لم يُكمل</span>
        ${o.kind !== "pledge" && o.extra.reported != null ? `<span class="cc-stat"><b>${ui.fmt(o.extra.reported)}</b> عدّهم تقرير النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.excluded)}</b> استُبعدوا (لهم إرسال فعلي)</span><span class="cc-stat"><b>${ui.fmt(o.extra.allSubs || 0)}</b> إرسالاً قُرئ (${ui.fmt(o.extra.submissions || 0)} من هذا النوع)</span>${o.extra.withOther ? `<span class="cc-stat"><b>${ui.fmt(o.extra.withOther)}</b> منهم لهم إرسال من نوع آخر</span>` : ""}` : ""}
        ${o.kind === "pledge" ? `<span class="cc-stat"><b>${ui.fmt(o.extra.targets)}</b> طالباً في النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.pledged)}</b> وقّعوا</span>` : ""}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-mis">تنزيل Excel</button>' : ""}</div>
      ${o.note ? `<p class="cc-alert warn">${esc(o.note)}</p>` : ""}
      ${o.extra && o.extra.sample ? `<details class="cc-adv"><summary><span>تشخيص التحقق</span><small>ماذا قُرئ من «نتائج الاستبيانات»</small></summary><p class="cc-note">أعمدة صفحة الإرسالات كما وصلت: ${esc((o.extra.subHeads || []).join("، ") || "—")}</p><p class="cc-note">عيّنة من الإرسالات المقروءة (رقم الطالب ← اسم النموذج ← النوع المستنتج):<br>${(o.extra.sample || []).map(esc).join("<br>") || "لا شيء"}</p></details>` : ""}
      ${Object.keys(o.per).length > 1 ? `<div class="cc-stats">${Object.keys(o.per).map((k) => `<span class="cc-stat"><b>${ui.fmt(o.per[k])}</b> ${esc(k)}</span>`).join("")}</div>` : ""}
      ${!rows.length ? '<p class="cc-alert warn">لا طلاب بهذا الشرط. إما أن الجميع أكمل، أو أن الاختيار لا يطابق شيئاً.</p>' : ""}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الطلاب الذين لم يُكملوا</h4><span class="cc-badge">${ui.fmt(rows.length)} صفاً</span></div></header>
        ${rows.length ? `<div class="cc-scroll"><table class="cc-table"><thead><tr>${misHeads().map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 400).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${rows.length > 400 ? '<p class="cc-note">يُعرض أول 400 صف؛ الملف المنزَّل يشمل الكل.</p>' : ""}` : ""}</article></section>`;
  }

  /* حالة الوكيل في جملة ولون واحدين: busy | ok | bad */
  function statusInfo() {
    const st = state.agentStatus;
    if (state.thinking) return { st: "busy", text: "أحلل صياغة طلبك…" };
    if (state.busy) return { st: "busy", text: state.progress || "الوكيل ينفّذ طلبك الآن…" };
    if (!st) return { st: "bad", text: "جارٍ الاتصال بالوكيل…" };
    return { st: st.loggedIn ? "ok" : "bad", text: st.message };
  }

  function render() {
    const box = $("cc-body");
    if (!box) return;
    if (!SCHEMA()) { box.innerHTML = '<p class="cc-alert warn">مخطط نظام المركز غير محمَّل.</p>'; return; }
    const mode = state.adding || state.proposal ? "ask" : state.mode;
    const info = statusInfo();
    const viaExt = App.centerAgent && App.centerAgent.isReady();
    box.innerHTML = `<div class="cc-app">
      <div class="cc-top" data-st="${info.st}"><span class="cc-dot" aria-hidden="true"></span><span id="cc-status" role="status">${esc(info.text)}</span></div>
      ${state.busy ? '<div class="cc-progress" aria-hidden="true"><i></i></div>' : ""}
      <nav class="cc-modes" role="tablist" aria-label="نوع الأمر">
        <button type="button" role="tab" class="${mode === "report" ? "on" : ""}" aria-selected="${mode === "report"}" data-cc="mode" data-m="report"><b>تقرير جاهز</b><small>اختر المسار والمرحلة ثم نفّذ</small></button>
        <button type="button" role="tab" class="${mode === "compare" ? "on" : ""}" aria-selected="${mode === "compare"}" data-cc="mode" data-m="compare"><b>مقارنة المراحل</b><small>من سجّل في أكثر من مرحلة</small></button>
        <button type="button" role="tab" class="${mode === "siblings" ? "on" : ""}" aria-selected="${mode === "siblings"}" data-cc="mode" data-m="siblings"><b>مقارنة الإخوة</b><small>طلاب يجمعهم هاتف أو عائلة</small></button>
        <button type="button" role="tab" class="${mode === "missing" ? "on" : ""}" aria-selected="${mode === "missing"}" data-cc="mode" data-m="missing"><b>استبيانات وتعهدات</b><small>من لم يعبّئ أو يوقّع</small></button>
        <button type="button" role="tab" class="${mode === "ask" ? "on" : ""}" aria-selected="${mode === "ask"}" data-cc="mode" data-m="ask"><b>اكتب طلبك</b><small>بحث، أو تسجيل طلاب من Excel</small></button>
      </nav>
      ${mode === "report" ? scriptsView() : mode === "compare" ? compareView() : mode === "siblings" ? siblingsView() : mode === "missing" ? missingView() : assistantView() + (state.adding === "register" ? registerBuilder() : "")}
      ${state.resultError ? `<p class="cc-alert err" role="alert">${esc(state.resultError)}</p>` : ""}
      ${planView()}
      ${mode === "compare" ? compareResult() : mode === "siblings" ? siblingsResult() : mode === "missing" ? missingResult() : state.results ? `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> النتيجة</h3>${resultsView()}</section>` : ""}
      <details class="cc-help"><summary>كيف تعمل الأوامر؟</summary><p>${viaExt
        ? "تعمل الأوامر في متصفحك عبر إضافة «وكيل تمكين». سجّل دخولك في نظام المركز مرة واحدة؛ والبحث والقوائم تُنفَّذ مباشرة، أما التسجيل فتراجع معاينته هنا وتوافق قبل أن يُكتب شيء. لا تصل كلمة مرورك أو جلستك إلى تمكين."
        : "تعمل الجلسة في نافذة Edge المحلية. سجّل الدخول فيها مرة واحدة؛ بعدها ينفّذ الوكيل البحث والقوائم والتسجيل ويعرض النتيجة هنا. أو ثبّت إضافة «وكيل تمكين» في Chrome لتعمل دون خادم محلي."}</p></details>
    </div>`;
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

  async function refreshStatus() {
    if (App.centerAgent && App.centerAgent.isReady()) {
      // إضافة المتصفح موصولة: لا حاجة للخادم المحلي
      state.agentStatus = { ready: true, loggedIn: true, message: "إضافة «وكيل تمكين» متصلة ✓ — عند التنفيذ يفتح نظام المركز في متصفحك؛ سجّل دخولك فيه إن طُلب." };
    } else {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        state.agentStatus = await res.json();
      } catch (err) { state.agentStatus = { ready: false, loggedIn: false, message: "لا وكيل متصل. ثبّت إضافة «وكيل تمكين» في Chrome، أو شغّل الوكيل المحلي (تشغيل.bat)." }; }
    }
    const el = $("cc-status");
    if (el) {
      const info = statusInfo();
      el.textContent = info.text;
      if (el.parentElement) el.parentElement.dataset.st = info.st;
    }
  }

  /* جدول النظام يدمج عدة بيانات في خلية واحدة (الطالب، المسار/الدورة، المجموعة/المدرب).
     نفصلها هنا إلى أعمدة مستقلة، لكل نوع بيانات عموده، ونحتفظ بنص الدورة الأصلي لأغراض التصفية. */
  function splitStudentCell(raw) {
    let t = clean(raw);
    const stu = (t.match(/STU-[\d-]+/) || [""])[0];
    if (stu) t = t.replace(stu, " ");
    const NO_EN = "لا يوجد اسم إنجليزي";
    let name, en = "";
    const k = t.indexOf(NO_EN);
    if (k >= 0) { name = t.slice(0, k); t = t.slice(k + NO_EN.length); }
    else {
      const m = t.match(/[A-Za-z][A-Za-z .'\-]*[A-Za-z]/);
      if (m) { const at = t.indexOf(m[0]); name = t.slice(0, at); en = m[0]; t = t.slice(at + m[0].length); }
      else { const d = t.search(/\d/); name = d < 0 ? t : t.slice(0, d); t = d < 0 ? "" : t.slice(d); }
    }
    // ما بقي: «الهوية - الجوال» بفاصل بينهما. نقسمه بالفواصل لا بشكل الرقم، فالجوال قد يأتي بلا صفر أوله
    const parts = t.split(/\s*[-–—·]\s*/).map(digits).filter(Boolean);
    let id = "", phone = "";
    if (parts.length >= 2) { id = parts[0]; phone = parts[parts.length - 1]; }
    else if (parts.length === 1) { if (/^0?5\d{8}$/.test(parts[0])) phone = parts[0]; else id = parts[0]; }
    if (/^5\d{8}$/.test(phone)) phone = "0" + phone;
    return [clean(name).replace(/[-–]\s*$/, "").trim(), en, stu, id, phone];
  }
  function expandResult(r) {
    if (!r || !Array.isArray(r.heads) || !Array.isArray(r.rows)) return r;
    const at = (rx) => r.heads.findIndex((h) => rx.test(clean(h)));
    const iS = at(/^الطالب$/), iC = at(/^المسار\s*\/\s*الدورة$/), iG = at(/^المجموعة\s*\/\s*المدرب$/);
    if (iS < 0 && iC < 0 && iG < 0) return r;
    const heads = [], plan = [];
    r.heads.forEach((h, i) => {
      if (i === iS) {
        const hasPhone = r.heads.some((x) => clean(x) === "الجوال");   // تقرير له عمود جوال خاص: لا نكرره
        heads.push("الاسم", "الاسم الإنجليزي", "رقم الطالب", "رقم الهوية"); if (!hasPhone) heads.push("الجوال");
        plan.push((c) => { const v = splitStudentCell(c); return hasPhone ? v.slice(0, 4) : v; });
      }
      else if (i === iC) {
        heads.push("المسار", "المرحلة");
        plan.push((c) => { const t = clean(c); const m = t.match(/المرحلة\s*\S+/); return [clean(m ? t.replace(m[0], "") : t), m ? m[0] : ""]; });
      } else if (i === iG) {
        heads.push("المجموعة", "المدرب");
        plan.push((c) => { const parts = clean(c).split(/\s+-\s*/); return [clean(parts[0]), clean(parts.slice(1).join(" - "))]; });
      } else { heads.push(h); plan.push((c) => [c]); }
    });
    const rows = r.rows.map((x) => ({ cells: [].concat(...plan.map((f, i) => f(x.cells[i]))), course: iC >= 0 ? clean(x.cells[iC]) : "", raw: x.cells }));
    return Object.assign({}, r, { heads, rows, rawHeads: r.heads });
  }

  async function runCommands(commands) {
    let results;
    if (App.centerAgent && await App.centerAgent.ready(500)) {
      // إضافة المتصفح: تفتح نظام المركز وتنفّذ، والموافقة على الكتابة هنا في الصفحة
      const out = await App.centerAgent.run(commands, {
        onProgress: (t) => { state.progress = t; const el = $("cc-status"); if (el && !state.plan) el.textContent = t; },
        onPlan: (plan) => new Promise((resolve) => { state.plan = plan; state.planResolve = resolve; render(); }),
      });
      results = out.results || [];
    } else {
      results = [];
      for (const command of commands) {
        const res = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error || "تعذّر تنفيذ الأمر.");
        results.push(body.result);
      }
    }
    return results.map((r) => {
      if (r && r.type === "lookup" && Array.isArray(r.items)) return Object.assign({}, r, { items: r.items.map((it) => expandResult(it)) });
      return expandResult(r);
    });
  }

  /* ===== تحميل كل البيانات مرة واحدة (اختياري) =====
     يجلب طلاب كل مسار (أمر لكل مسار) ويحفظهم في ذاكرة الصفحة فقط — لا على القرص ولا في
     أي خدمة — ثم تُحسب التقارير بالتصفية محلياً فتظهر فوراً. إن لم تكفِ أعمدة الجدول
     للتصفية المطلوبة (مثل المرحلة أو المجموعة) يُنفَّذ الأمر مباشرة على النظام. */
  async function preloadAll() {
    const details = state.sel.details;
    const tracks = trackOpts();
    state.busy = true; state.resultError = ""; state.results = null; state.progress = ""; state.labels = [];
    render(); refreshStatus();
    try {
      const results = await runCommands(tracks.map((o) => Object.assign({ type: "list", label: o.t, params: { track_id: String(o.v) } }, details ? { details: true } : {})));
      const items = [];
      results.forEach((r, k) => { if (r && r.type === "list") items.push({ trackId: String(tracks[k].v), heads: r.heads, rawHeads: r.rawHeads, rows: r.rows, details: r.details }); });
      if (!items.length) throw new Error("لم تصل بيانات من الوكيل.");
      state.cache = { at: new Date(), details, items };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }

  /* يحاول حساب أمر قائمة من الذاكرة؛ يعيد null إن تعذّر (فيُنفَّذ مباشرة) */
  let cacheWhy = "";
  function localList(p) {
    cacheWhy = "";
    const c = state.cache;
    if (!c) return null;
    const cmd = p.command, q = cmd.params || {};
    if (cmd.details && !c.details) { cacheWhy = "الذاكرة محمّلة بدون «كل بيانات الطالب»؛ فعّل الخيار وأعد التحميل."; return null; }
    let items = c.items;
    let course = null;
    if (q.training_course_id) course = courseOpts().find((x) => x.v === q.training_course_id);
    const wantTrack = q.track_id || (course && course.track);
    if (wantTrack) items = items.filter((it) => it.trackId === String(wantTrack));
    if (!items.length) { cacheWhy = "لم يُحمَّل هذا المسار في الذاكرة."; return null; }
    const heads = items[0].heads;
    const col = (rx) => heads.findIndex((h) => rx.test(norm(h)));
    const lack = (what) => { cacheWhy = `لا يوجد في الجدول عمود «${what}» للتصفية به. الأعمدة المتاحة: ${heads.join("، ")}`; return null; };
    const tests = [];
    if (q.training_course_id) {
      const hasCourse = items.some((it) => it.rows.some((x) => x.course));
      const i = col(/دور|مرحل/);
      if (!course || (!hasCourse && i < 0)) return lack("الدورة/المرحلة");
      const flat = (v) => norm(v).replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
      tests.push((cells, row) => flat(hasCourse ? (row.course || "") : cells[i]).includes(flat(course.t)));
    }
    if (q.status) {
      const i = col(/حال/);
      if (i < 0) return lack("الحالة");
      const t = norm(optLabel("status", q.status));
      tests.push((cells) => norm(cells[i]) === t || norm(cells[i]).includes(t));
    }
    if (q.group_status) {
      const i = col(/مجموع/);
      if (i < 0) return lack("المجموعة/التوزيع");
      const unassigned = (cells) => { const v = clean(cells[i]); return !v || /^[-–—]+$/.test(v) || /غير\s*موزع|لا يوجد/.test(v); };
      tests.push((cells) => (q.group_status === "unassigned" ? unassigned(cells) : !unassigned(cells)));
    }
    const rows = [];
    for (const it of items) {
      // أعمدة العناصر قد تختلف إن اختلفت حقول النموذج: نعيد ترتيبها على أعمدة الأول بالاسم
      const map = heads.map((h) => it.heads.indexOf(h));
      for (const r of it.rows) {
        const cells = it === items[0] ? r.cells : map.map((k) => (k < 0 ? "" : r.cells[k]));
        if (tests.every((f) => f(cells, r))) rows.push({ cells, course: r.course, raw: r.raw });
      }
    }
    return { type: "list", heads, rows, rawHeads: items[0].rawHeads };
  }

  const executeCommand = (command) => executeBatch([command], []);

  /* ينفّذ أمراً أو عدة أوامر بالتتابع. labels: عنوان كل نتيجة (اختياري) */
  async function executeBatch(commands, labels, useExtras) {
    state.busy = true; state.autoRunRegister = false; state.resultError = ""; state.results = null; state.adding = ""; state.proposal = null;
    state.progress = ""; state.plan = null; state.planResolve = null; state.labels = labels || []; state.groupFilter = "";
    render(); refreshStatus();
    try {
      const results = await runCommands(commands);
      if (!results.length) throw new Error("لم تصل نتيجة من الوكيل.");
      if (commands.length === 1 && results[0].error) throw new Error(results[0].error);
      state.results = { results: useExtras ? results.map(applyExtras) : results };
      state.requestText = "";
      state.reg = null;
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; state.plan = null; state.planResolve = null; render(); refreshStatus(); }
  }

  /* ===== الأحداث ===== */
  function init() {
    const box = $("cc-body");
    if (!box) return;
    render();
    refreshStatus();
    window.setInterval(refreshStatus, 8000);
    if (App.centerAgent) App.centerAgent.ready(1500).then((ok) => { if (ok) { refreshStatus(); if (!state.busy && !state.thinking && !state.plan) render(); } });

    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cc]");
      if (!b) return;
      const act = b.dataset.cc;
      const i = Number(b.dataset.i);
      try {
        if (act === "interpret") {
          state.requestText = $("cc-request").value;
          state.thinking = true; state.proposal = null; state.needsAiKey = false; state.resultError = "";
          render();
          let command;
          try { command = await interpretRequest(state.requestText); }
          catch (err) {
            state.needsAiKey = err.message === "NO_KEY";
            command = { error: state.needsAiKey ? "فعّل Gemini أو Claude أولاً كي يفهم الوكيل الصياغة العامية." : err.message };
          }
          state.thinking = false;
          if (command.error) { state.proposal = command; render(); return; }
          if (command.type === "register-needed") { state.proposal = command; state.adding = "register"; state.autoRunRegister = true; render(); return; }
          await executeCommand(command); return;
        } else if (act === "ai-settings") {
          if (App.letters && App.letters.openAiSettings) App.letters.openAiSettings();
          else ui.toast("افتح إعدادات الذكاء الاصطناعي من صفحة المراسلات");
          return;
        } else if (act === "register-run") {
          const { ok, bad } = buildRegister();
          if (bad.length || !ok.length) return ui.toast("صحّح ربط الحقول قبل إرسال الملف");
          if (ok.length > 80) return ui.toast("الحد الأقصى للإرسال الواحد 80 طالباً");
          await executeCommand({ type: "register", rows: ok }); return;
        } else if (act === "plan-ok" || act === "plan-no") {
          const r = state.planResolve; state.plan = null; state.planResolve = null;
          if (r) r(act === "plan-ok");
        } else if (act === "cancel") { state.adding = ""; state.reg = null; state.proposal = null; state.autoRunRegister = false; }
        else if (act === "export-reg") {
          const r = state.results.results[i];
          return exportBook("نتائج التسجيل.xlsx", ["الاسم", "الهوية", "النتيجة", "ملاحظة"], r.rows.map((x) => [x.name, x.nid, x.status, x.message || ""]));
        } else if (act === "export-list") {
          const r = state.results.results[i];
          return exportBook((state.labels[i] || "قائمة الطلاب").replace(/[\\/:*?"<>|]/g, " ").slice(0, 80) + ".xlsx", ...shown(r.heads, visibleRows(r).map((x) => x.cells)));
        } else if (act === "export-all") {
          const wb = new ExcelJS.Workbook();
          const used = new Set();
          state.results.results.forEach((r, k) => {
            if (r.type !== "list") return;
            let name = (state.labels[k] || "قائمة " + (k + 1)).replace(/^مسار\s*/, "").replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "ورقة";
            while (used.has(name)) name = name.slice(0, 26) + " " + (used.size + 1);
            used.add(name);
            const ws = wb.addWorksheet(name);
            ws.views = [{ rightToLeft: true }];
            const [hh, rr] = shown(r.heads, visibleRows(r).map((x) => x.cells));
            ws.addRow(hh); ws.getRow(1).font = { bold: true };
            rr.forEach((c) => ws.addRow(c));
            ws.columns.forEach((c) => { c.width = 22; });
          });
          return ui.download("تقرير المركز.xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        } else if (act === "run-selection") {
          const plan = buildSelection();
          state.fallbackNote = ""; state.extraNote = "";
          const local = [];
          if (state.cache) for (const x of plan) { const r = localList(x); if (!r) { state.fallbackNote = cacheWhy; break; } local.push(r); }
          if (local.length && local.length === plan.length) {
            state.resultError = ""; state.groupFilter = ""; state.labels = plan.map((x) => x.label + " ⚡");
            state.results = { results: local.map(applyExtras) };
            render(); return;
          }
          return executeBatch(plan.map((p) => p.command), plan.map((p) => p.label), true);
        } else if (act === "mode") {
          state.mode = b.dataset.m; state.adding = ""; state.proposal = null; state.autoRunRegister = false; state.reg = null; state.resultError = "";
        } else if (act === "run-mis") { return runMissing();
        } else if (act === "export-mis") {
          const o = state.mis.out; const t = (MIS_KINDS.find((x) => x.k === o.kind) || {}).t || "";
          return exportBook("لم يُكمل - " + t + ".xlsx", misHeads(), misTable());
        } else if (act === "run-sib") { return runSiblings();
        } else if (act === "export-sib") {
          return exportBook("مقارنة الإخوة.xlsx", sibHeads(), state.sib.out.rows);
        } else if (act === "run-compare") { return runCompare();
        } else if (act === "export-cmp") {
          return exportBook("مقارنة المراحل.xlsx", cmpHeads(), cmpTable());
        } else if (act === "cols-all") { state.hiddenCols = new Set();
        } else if (act === "to-forms") {
          const { headers, rows } = feedData();
          if (!rows.length) return ui.toast("لا صفوف لإخراجها");
          const label = (state.labels[0] || "بيانات نظام المركز") + (state.results.results.length > 1 ? " وغيرها" : "");
          // التقسيم الافتراضي: المجموعة، ويسبقها المسار إن اجتمع أكثر من مسار (رمز المجموعة يتكرر بين المسارات)
          const distinct = (h) => new Set(rows.map((o) => clean(o[h])).filter(Boolean)).size;
          const groupBy = [];
          if (headers.includes("المسار") && distinct("المسار") > 1) groupBy.push("المسار");
          if (headers.includes("المجموعة")) groupBy.push("المجموعة");
          App.converter.useData(headers, rows, label, { templateIds: state.tplPick.slice(), autoParse: true, groupBy });
          return;
        } else if (act === "cols-empty") { emptyHeads().forEach((h) => state.hiddenCols.add(h));
        } else if (act === "cols-none") { state.hiddenCols = new Set(resultHeads());
        } else if (act === "preload") { return preloadAll();
        } else if (act === "preload-details") { state.sel.details = true; state.fallbackNote = ""; return preloadAll();
        } else if (act === "drop-cache") { state.cache = null;
        } else if (act === "clear-selection") {
          state.sel = defaultSel(); state.extraNote = "";
        }
        render();
      } catch (err) { ui.toast(err.message); }
    });

    box.addEventListener("toggle", (e) => {
      const d = e.target;
      if (d && d.dataset && d.dataset.open) state.open[d.dataset.open] = d.open;
    }, true);

    box.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.dataset.mis) {
        const k = t.dataset.mis, c = state.mis;
        if (k === "kind") c.kind = t.value;
        else if (k === "verify") c.verify = t.checked;
        else if (k === "status") c.status = t.value;
        else { const a = c[k], v = String(t.value), at = a.indexOf(v); if (t.checked && at < 0) a.push(v); else if (!t.checked && at >= 0) a.splice(at, 1); }
        render(); return;
      }
      if (t.dataset.sib) {
        const k = t.dataset.sib, c = state.sib;
        if (k === "tracks") { const v = String(t.value), at = c.tracks.indexOf(v); if (t.checked && at < 0) c.tracks.push(v); else if (!t.checked && at >= 0) c.tracks.splice(at, 1); }
        else if (k === "status") c.status = t.value;
        else c[k] = t.checked;
        render(); return;
      }
      if (t.dataset.cmp) {
        const k = t.dataset.cmp, c = state.cmp;
        if (k === "tracks") { const v = String(t.value), at = c.tracks.indexOf(v); if (t.checked && at < 0) c.tracks.push(v); else if (!t.checked && at >= 0) c.tracks.splice(at, 1); }
        else if (k === "status") c.status = t.value;
        else if (k === "multi") c.multiOnly = t.checked;
        render(); return;
      }
      if (t.dataset.tpl) {
        const a = state.tplPick, at = a.indexOf(t.dataset.tpl);
        if (t.checked && at < 0) a.push(t.dataset.tpl); else if (!t.checked && at >= 0) a.splice(at, 1);
        render(); return;
      }
      if (t.dataset.col != null) {
        if (t.checked) state.hiddenCols.delete(t.dataset.col); else state.hiddenCols.add(t.dataset.col);
        render(); return;
      }
      if (t.dataset.sel) {
        const k = t.dataset.sel;
        if (k === "groupFilter") { state.groupFilter = t.value; render(); return; }
        if (k.startsWith("x:")) { state.sel.extra = state.sel.extra || {}; state.sel.extra[k.slice(2)] = t.value; const h = $("cc-scripts"); if (h) h.outerHTML = scriptsView(); return; }
        if (k === "tracks" || k === "stages") {
          const a = state.sel[k], v = String(t.value), at = a.indexOf(v);
          if (t.checked && at < 0) a.push(v); else if (!t.checked && at >= 0) a.splice(at, 1);
        } else if (k === "details") state.sel.details = t.checked;
        else state.sel[k] = t.value;
        const holder = $("cc-scripts");
        if (holder) holder.outerHTML = scriptsView();
        return;
      }
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
          if (!maybeAutoRegister()) render();
        } catch (err) { ui.toast(err.message); }
      } else if (t.dataset.ccSrc) {
        const m = (state.reg.map[t.dataset.ccSrc] = state.reg.map[t.dataset.ccSrc] || {});
        m.src = t.value;
        if (t.value === "fixed" && m.fixed == null) m.fixed = "";
        if (!maybeAutoRegister()) render();
      } else if (t.dataset.ccFixed) {
        (state.reg.map[t.dataset.ccFixed] = state.reg.map[t.dataset.ccFixed] || {}).fixed = t.value;
        if (!maybeAutoRegister()) render();
      }
    });
    box.addEventListener("input", (e) => {
      if (e.target.id === "cc-request") {
        state.requestText = e.target.value;
        state.proposal = null;
        state.needsAiKey = false;
        const preview = box.querySelector("[data-cc-preview]");
        if (preview) preview.replaceChildren();
      }
    });
  }

  function maybeAutoRegister() {
    if (!state.autoRunRegister || !state.reg || state.busy) return false;
    const { ok, bad } = buildRegister();
    if (bad.length || !ok.length) return false;
    if (ok.length > 80) { state.resultError = "قسّم الملف؛ الحد الأقصى 80 طالباً في المرة الواحدة."; return false; }
    executeCommand({ type: "register", rows: ok });
    return true;
  }

  App.centerCmd = { init, render, state, buildRegister, toOption, execute: executeCommand, localIntent, expand: expandResult };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
