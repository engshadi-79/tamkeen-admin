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
    cmp: { tracks: [], status: "", multiOnly: true, goal: "multi", out: null }, // مقارنة المراحل
    sib: { tracks: [], status: "", phone: true, name: true, loose: false, both: false, stageMode: false, stages: [], baseStage: "المرحلة الثالثة", cmpStages: [], out: null }, // مقارنة الإخوة
    mis: { kind: "pre", tracks: [], stages: [], status: "active", verify: true, msg: "", out: null }, // استبيانات وتعهدات
    dq: { tracks: [], stages: [], status: "active", checks: { dupId: true, badId: true, noPhone: true, noGroup: true, shortName: true, dupName: true, dupPhone: false }, out: null, rows: null, diff: null },
    mask: false, idleMin: 20, lastAct: Date.now(), extLatest: "", errors: [],
    grp: { tracks: [], stages: [], status: "active", out: null },
    stu: { q: "", out: null, pick: null },
    bundle: { open: false, pick: [], msg: "" },
    saved: [], runLog: [], notify: false, stopping: false, _wasBusy: false, _runStart: 0, _runMode: "",
    mode: "report",      // report: تقرير جاهز | ask: اكتب طلبك
    open: { adv: false, cols: false, forms: true, remind: false, log: false, snap: false, sec: false, errs: false }, // حالة الأقسام القابلة للطي
    extraNote: "",
    tpls: null,          // القوالب المحفوظة في المحوّل
    tplPick: [],         // القوالب المختارة لإخراج النماذج
    fallbackNote: "",    // سبب عدم استعمال الذاكرة في آخر تنفيذ
    progStart: 0,        // وقت بدء التنفيذ الجاري (للعدّاد)
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
    // تقارير النواقص: «كم طالب لم يعبّئ القبلي في الحلاقة؟» / «من لم يوقّع التعهد؟»
    if (/(لم\s*ي?عب|ما\s*ي?عب|لم\s*ي?وق|ما\s*ي?وق|ناقص|نواقص|غير\s*(مكمل|معبا|موقع))/.test(n) && /(استبيان|استبانه|قبلي|بعدي|اثر|تعهد|نواقص)/.test(n)) {
      const kind = /تعهد/.test(n) ? "pledge" : /قبلي/.test(n) ? "pre" : /بعدي/.test(n) ? "post" : /اثر/.test(n) ? "impact" : "all";
      const cfg = { kind, status: "active", tracks: [], stages: [], out: null };
      const tw = new Set(wordsOf(raw));
      const sc = (SCHEMA().studentFilters.fields.find((x) => x.name === "track_id") || { options: [] }).options.filter((o) => o.v).map((o) => ({ o, hit: wordsOf(o.t).filter((w) => tw.has(w)).length })).filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit);
      if (sc.length && !(sc.length > 1 && sc[0].hit === sc[1].hit)) cfg.tracks = [String(sc[0].o.v)];
      const sm = n.match(/(?:مرحله|دوره)\s*(?:ال)?(اولي|ثانيه|ثالثه)/);
      if (sm) cfg.stages = [({ اولي: "الاولى", ثانيه: "الثان", ثالثه: "الثالث" })[sm[1]]];
      return { type: "mode-intent", mode: "missing", cfg, run: true };
    }
    if (/(اخوه|اخوات|اشقاء|اخ\s*او\s*اخت)/.test(n)) return { type: "mode-intent", mode: "siblings", run: false };
    if (/(فحص|تدقيق|جوده)/.test(n) && /(بيانات|طلاب)/.test(n)) return { type: "mode-intent", mode: "dq", run: false };
    if (/(حمل|توزيع)\s*(ال)?(مدرب|مجموعات)|(المجموعات|المدربين)\s*(و|ال)/.test(n) && /(مدرب|مجموع)/.test(n) && !/(طلاب|طلبه)\s*(ال)?(غير)?\s*موزع/.test(n)) return { type: "mode-intent", mode: "groups", run: false };
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
        <div class="cc-row"><button type="button" class="btn navy small" data-cc="to-forms" ${state.tplPick.length && rows.length ? "" : "disabled"}>جهّز النماذج${state.tplPick.length > 1 ? ` (${ui.fmt(state.tplPick.length)} قوالب)` : ""} ←</button>
          <button type="button" class="btn secondary small" data-cc="to-exam" ${rows.length && App.examSheet && App.examSheet.useData ? "" : "disabled"} title="يملأ جدول الاختبارات بهذه الصفوف بدل رفع Excel">أرسلها إلى «جدول الاختبارات» ←</button></div>`
      : '<p class="cc-note">لا قوالب محفوظة بعد. احفظ قالباً من «تحويل حسب قالب» أولاً.</p>'}</details>`;
  }

  /* ===== جدول بيانات موحّد: بحث، فرز بالعمود، ترقيم صفحات، ونسخ إلى الحافظة ===== */
  const TBL_SIZE = 50;
  const tblState = {}, tblData = {};
  const tblSt = (k) => tblState[k] || (tblState[k] = { q: "", sort: -1, dir: 1, page: 0 });
  const cellStr = (c) => String(c == null ? "" : c);
  function tblRows(k) {
    const d = tblData[k], st = tblSt(k);
    let rows = d.rows;
    const q = normName(st.q);
    if (q) rows = rows.filter((r) => r.some((c) => normName(cellStr(c)).includes(q)));
    if (st.sort >= 0) rows = rows.slice().sort((a, b) => st.dir * cellStr(a[st.sort]).localeCompare(cellStr(b[st.sort]), "ar", { numeric: true }));
    return rows;
  }
  function tblBody(k) {
    const d = tblData[k], st = tblSt(k);
    const rows = tblRows(k);
    const pages = Math.max(1, Math.ceil(rows.length / TBL_SIZE));
    st.page = Math.max(0, Math.min(st.page, pages - 1));
    const part = rows.slice(st.page * TBL_SIZE, (st.page + 1) * TBL_SIZE);
    const pager = pages > 1 ? `<div class="cc-pager"><button type="button" class="cc-link" data-tbl-page="${esc(k)}" data-d="-1" ${st.page === 0 ? "disabled" : ""}>السابق</button><span>صفحة ${ui.fmt(st.page + 1)} من ${ui.fmt(pages)}</span><button type="button" class="cc-link" data-tbl-page="${esc(k)}" data-d="1" ${st.page >= pages - 1 ? "disabled" : ""}>التالي</button></div>` : "";
    return `<div class="cc-scroll"><table class="cc-table"><thead><tr>${d.heads.map((h, i) => `<th data-tbl-sort="${i}" data-tbl="${esc(k)}" class="cc-sortable ${st.sort === i ? (st.dir > 0 ? "asc" : "desc") : ""}" title="اضغط للفرز">${esc(h)}</th>`).join("")}</tr></thead><tbody>${part.map((r) => `<tr>${r.map((c) => `<td>${esc(showCell(c))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${d.heads.length}" class="cc-empty">لا نتائج مطابقة للبحث</td></tr>`}</tbody></table></div>${pager}`;
  }
  function dataTable(k, heads, rows) {
    tblData[k] = { heads, rows };
    const st = tblSt(k);
    return `<div class="cc-tbl" data-tblbox="${esc(k)}"><div class="cc-tbl-bar"><input type="search" class="cc-tbl-q" data-tbl-q="${esc(k)}" placeholder="بحث في الجدول…" value="${esc(st.q)}"><span class="cc-tbl-n" data-tbl-n>${ui.fmt(tblRows(k).length)} من ${ui.fmt(rows.length)}</span><button type="button" class="cc-link" data-tbl-copy="${esc(k)}">نسخ للحافظة</button></div><div class="cc-tbl-body">${tblBody(k)}</div></div>`;
  }
  function tblRefresh(k) {
    const box = $("cc-body") && $("cc-body").querySelector(`[data-tblbox="${CSS.escape(k)}"]`);
    if (!box) return;
    box.querySelector(".cc-tbl-body").innerHTML = tblBody(k);
    const n = box.querySelector("[data-tbl-n]");
    if (n) n.textContent = ui.fmt(tblRows(k).length) + " من " + ui.fmt(tblData[k].rows.length);
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
      if (r.type === "pending") return `<article class="cc-res"><p class="cc-note">⏳ قيد التنفيذ… ${esc(state.labels[i] || "أمر " + (i + 1))}</p></article>`;
      if (r.error) return `<article class="cc-res"><header class="cc-res-h"><h4>أمر ${i + 1}</h4></header><p class="cc-alert warn">${esc(r.error)}</p></article>`;
      if (r.type === "register") {
        const cnt = (s) => r.rows.filter((x) => x.status === s).length;
        return `<article class="cc-res"><header class="cc-res-h"><h4>تسجيل — ${esc(r.label)}</h4><div class="cc-res-act"><button type="button" class="btn secondary small" data-cc="export-reg" data-i="${i}">تنزيل Excel</button></div></header>
          <div class="cc-stats"><span class="cc-stat ok"><b>${ui.fmt(cnt("created"))}</b> سُجّل</span><span class="cc-stat"><b>${ui.fmt(cnt("exists"))}</b> موجود أصلاً</span><span class="cc-stat"><b>${ui.fmt(cnt("invalid"))}</b> غير صالح</span><span class="cc-stat bad"><b>${ui.fmt(cnt("failed"))}</b> فشل</span><span class="cc-stat"><b>${ui.fmt(cnt("unverified"))}</b> تحقق يدوياً</span><span class="cc-stat"><b>${ui.fmt(cnt("skipped"))}</b> لم يُنفَّذ</span></div>
          ${tbl(["الاسم", "الهوية", "النتيجة", "ملاحظة"], r.rows.map((x) => [x.name, x.nid, STATUS[x.status] || x.status, x.message || ""]))}</article>`;
      }
      if (r.type === "lookup") {
        return `<article class="cc-res"><header class="cc-res-h"><h4>استعلام</h4></header>${r.items.map((it, j) => `<p class="cc-note"><b>${esc(it.q)}</b> — ${it.count ? ui.fmt(it.count) + " نتيجة" : "لا نتيجة"}</p>${dnote(it.details)}${it.count ? dataTable("look" + i + "_" + j, ...shown(it.heads, it.rows.map((x) => x.cells))) : ""}`).join("")}</article>`;
      }
      const gi = groupCol(r);
      const rows = visibleRows(r);
      const gsel = gi < 0 ? "" : `<label class="cc-field cc-group"><span>المجموعة</span><select data-sel="groupFilter"><option value="">كل المجموعات</option>${groupValues(r, gi).map((g) => `<option value="${esc(g)}" ${g === state.groupFilter ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>`;
      return `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${esc(state.labels[i] || "قائمة الطلاب")}</h4><span class="cc-badge">${ui.fmt(rows.length)}${rows.length !== r.rows.length ? " من " + ui.fmt(r.rows.length) : ""} صفاً</span></div>
        <div class="cc-res-act">${gsel}<button type="button" class="btn secondary small" data-cc="export-list" data-i="${i}">تنزيل Excel</button></div></header>
        ${dnote(r.details)}
        ${dataTable("list" + i, ...shown(r.heads, rows.map((x) => x.cells)))}</article>`;
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
    if (c.goal === "siblings") {
      // الإخوة: المرحلة الأخيرة مقابل السابقة — يستعمل محرك الإخوة بمسارات المقارنة وحالتها
      const sb = state.sib;
      sb.tracks = c.tracks.slice(); sb.status = c.status; sb.stageMode = true;
      return runSiblings();
    }
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
      <header class="cc-card-h"><h3>مقارنة المراحل</h3><p>${c.goal === "siblings" ? "من له أخ أو أخت سُجّل في مرحلة سابقة؟ يُقارَن طلاب المرحلة الأخيرة بإخوتهم في المراحل الأولى." : "من سجّل في أكثر من مرحلة؟ تُقرأ قائمة كل دورة ثم يُطابَق الطلاب برقم الهوية."} للقراءة فقط.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs cc-wide"><legend>ما المطلوب؟</legend><div class="cc-chips">
            <label class="cc-chk"><input type="radio" name="cmp-goal" data-cmp="goal" value="multi" ${c.goal === "multi" ? "checked" : ""}> <span>طلاب سجّلوا في أكثر من مرحلة</span></label>
            <label class="cc-chk"><input type="radio" name="cmp-goal" data-cmp="goal" value="siblings" ${c.goal === "siblings" ? "checked" : ""}> <span>إخوة: المرحلة الأخيرة مقابل المراحل السابقة</span></label></div>
            ${c.goal === "siblings" ? `<div class="cc-pick"><b>طلاب المرحلة</b><div class="cc-chips">${STAGES.map((g) => `<label class="cc-chk"><input type="radio" name="sib-base" data-sib="baseStage" value="${esc(g.t)}" ${state.sib.baseStage === g.t ? "checked" : ""}> <span>${esc(g.t)}</span></label>`).join("")}</div></div>
            <div class="cc-pick"><b>هل لهم إخوة في</b><div class="cc-chips">${STAGES.map((g) => `<label class="cc-chk"><input type="checkbox" data-sib="cmpStages" value="${esc(g.t)}" ${state.sib.cmpStages.includes(g.t) ? "checked" : ""}> <span>${esc(g.t)}</span></label>`).join("")}<label class="cc-chk"><input type="checkbox" data-sib="cmpStages" value="__same" ${state.sib.cmpStages.includes("__same") ? "checked" : ""}> <span>نفس المرحلة (بين طلابها)</span></label></div><p class="cc-note">اترك الخيارات فارغة لتشمل كل المراحل الأخرى غير المرحلة المختارة أعلاه. وللمقارنة داخل مرحلة واحدة اختر «نفس المرحلة».</p></div>
            <div class="cc-chips" style="margin-top:8px">${["phone:نفس رقم الهاتف", "name:نفس الاسم بعد الاسم الأول", "loose:الأب والعائلة فقط (أوسع)", "both:يجب تحقق الهاتف والاسم معاً (أدق)"].map((x) => { const [k, t] = x.split(":"); return `<label class="cc-chk"><input type="checkbox" data-sib="${k}" ${state.sib[k] ? "checked" : ""}> <span>${esc(t)}</span></label>`; }).join("")}</div>
            <p class="cc-note">معيار الربط بين الإخوة. الهاتف وحده قد يجمع غير الإخوة؛ و«معاً» أدق. تبقى العائلات التي فيها طالب بالمرحلة الأخيرة وأخ أو أخت في مرحلة سابقة.</p>` : ""}</fieldset>
          <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk(o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>تصفية</legend>
            <label class="cc-field"><span>حالة الطالب</span><select data-cmp="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>
            ${c.goal === "siblings" ? "" : `<label class="cc-chk" style="margin-top:8px"><input type="checkbox" data-cmp="multi" ${c.multiOnly ? "checked" : ""}> <span>المسجلون في أكثر من مرحلة فقط</span></label>`}</fieldset>
        </div>
        ${state.resultError ? "" : ""}
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${c.goal === "siblings" ? "قائمة الطلاب لكل مسار" : `سيُقرأ ${ui.fmt(n)} ${n === 1 ? "دورة" : n === 2 ? "دورتان" : n < 11 ? "دورات" : "دورة"}`}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.status ? " · " + esc(optLabel("status", c.status)) : " · كل الحالات"}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-compare" ${state.busy || !n ? "disabled" : ""}>${state.busy ? "جارٍ الجلب والمقارنة…" : "اجلب وقارن"}</button></div></footer></section>`;
  }

  function compareResult() {
    if (state.cmp.goal === "siblings") return siblingsResult(true);
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
        ${rows.length ? dataTable("cmp", cmpHeads(), rows) : '<p class="cc-note">لا صفوف.</p>'}</article></section>`;
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
          if (!c.stageMode && c.stages.length && !c.stages.includes(stage)) return;       // المقارنة داخل المراحل المختارة فقط
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
      let stageStats = null;
      if (c.stageMode) {
        // طلاب «المرحلة المرجعية» الذين لهم أخ/أخت (شخص آخر) في المراحل المختارة للمقارنة (الافتراضي: كل المراحل الأخرى)
        const base = c.baseStage || STAGES[STAGES.length - 1].t;
        const picked = c.cmpStages.filter((x) => x !== "__same");
        const sameOn = c.cmpStages.includes("__same");           // «نفس المرحلة»: إخوة داخل مرحلة واحدة
        const targets = new Set(picked.length || sameOn ? picked : STAGES.map((g) => g.t).filter((t) => t !== base));
        if (sameOn) targets.add(base);
        const inTarget = (p) => [...p.stages].some((x) => targets.has(x));
        fams = fams.filter((g) => {
          const mine = g.filter((p) => p.stages.has(base));
          const others = g.filter(inTarget);
          return mine.some((a) => others.some((b) => b !== a));
        });
        fams.forEach((g) => g.sort((a, b) => Number(b.stages.has(base)) - Number(a.stages.has(base))));
        const mineSet = new Set(), otherSet = new Set();
        fams.forEach((g) => g.forEach((p) => { if (p.stages.has(base)) mineSet.add(p); if (inTarget(p)) otherSet.add(p); }));
        const cmpLabel = c.cmpStages.length ? c.cmpStages.map((x) => x === "__same" ? "نفس المرحلة" : x).join(" و") : "باقي المراحل";
        stageStats = { last: mineSet.size, early: otherSet.size, lastLabel: base, cmpLabel };
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
          <fieldset class="cc-fs"><legend>المراحل${c.stages.length ? ` <em>${ui.fmt(c.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => `<label class="cc-chk"><input type="checkbox" data-sib="stages" value="${esc(g.t)}" ${c.stages.includes(g.t) ? "checked" : ""}> <span>${esc(g.t)}</span></label>`).join("")}</div><p class="cc-note">تُقارَن الإخوة بين طلاب المراحل المختارة فقط. اتركها فارغة لتشمل كل المراحل.</p></fieldset>
          <fieldset class="cc-fs"><legend>تصفية</legend><label class="cc-field"><span>حالة الطالب</span><select data-sib="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></fieldset>
          <fieldset class="cc-fs cc-wide"><legend>معيار الربط</legend><div class="cc-chips">
            ${opt("phone", "نفس رقم الهاتف", c.phone)}${opt("name", "نفس الاسم بعد الاسم الأول (الأب والجد والعائلة)", c.name)}${opt("loose", "الأب والعائلة فقط (أوسع، أخطاؤه أكثر)", c.loose)}${opt("both", "يجب تحقق الهاتف والاسم معاً (أدق)", c.both)}</div>
            <p class="cc-note">الهاتف وحده قد يجمع غير الإخوة (هاتف مشترك لجهة أو قريب). و«معاً» يُظهر الأرجح فقط. عمود «سبب الربط» في النتيجة يبيّن ما جمعهم.</p></fieldset>
        </div>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${state.cache && !c.status ? "⚡ من الذاكرة المحمّلة" : `سيُقرأ ${ui.fmt(n)} ${n === 1 ? "مسار" : n === 2 ? "مساران" : n < 11 ? "مسارات" : "مساراً"}`}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.stages.length ? " · " + esc(c.stages.join("، ")) : " · كل المراحل"}${c.status ? " · " + esc(optLabel("status", c.status)) : " · كل الحالات"}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-sib" ${state.busy || !n ? "disabled" : ""}>${state.busy ? "جارٍ الجلب والمقارنة…" : "اجلب وقارن"}</button></div></footer></section>`;
  }

  function siblingsResult(fromCompare) {
    const o = state.sib.out;
    // نتيجة وضع «المرحلة الأخيرة مقابل السابقة» تظهر في تبويب مقارنة المراحل فقط، ونتيجة الإخوة العامة في تبويبها
    if (!o || !!o.stageStats !== !!fromCompare) return "";
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> نتيجة مقارنة الإخوة${o.stageStats ? " — " + esc(o.stageStats.lastLabel) + " مقابل " + esc(o.stageStats.cmpLabel) : ""}</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total)}</b> طالباً مختلفاً</span><span class="cc-stat ok"><b>${ui.fmt(o.families)}</b> عائلة</span><span class="cc-stat ok"><b>${ui.fmt(o.siblings)}</b> طالباً لهم إخوة</span><span class="cc-stat"><b>${ui.fmt(o.largest)}</b> أكبر عائلة</span>${o.stageStats ? `<span class="cc-stat ok"><b>${ui.fmt(o.stageStats.last)}</b> طالباً في ${esc(o.stageStats.lastLabel)} لهم إخوة في ${esc(o.stageStats.cmpLabel)}</span><span class="cc-stat"><b>${ui.fmt(o.stageStats.early)}</b> من الإخوة في ${esc(o.stageStats.cmpLabel)}</span>` : ""}
        ${Object.keys(o.sizes).sort((a, b) => a - b).map((k) => `<span class="cc-stat"><b>${ui.fmt(o.sizes[k])}</b> من ${ui.fmt(k)}</span>`).join("")}
        ${o.rows.length ? '<button type="button" class="btn secondary small" data-cc="export-sib">تنزيل Excel</button>' : ""}</div>
      ${o.rows.length ? "" : '<p class="cc-alert warn">لم أجد طلاباً يجمعهم المعيار المختار. جرّب إلغاء «معاً» أو تفعيل المعيار الأوسع.</p>'}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>العائلات المحتملة</h4><span class="cc-badge">${ui.fmt(o.rows.length)} صفاً</span></div></header>
        ${o.rows.length ? dataTable("sib", sibHeads(), o.rows) : ""}</article></section>`;
  }

  /* ===== استبيانات وتعهدات: من لم يعبّئ ولم يوقّع =====
     الاستبيانات: تقرير النظام نفسه «الطلاب الذين لم يعبئوا الاستبيان» (قراءة فقط).
     التعهدات: لا تقرير «من لم يوقّع» في النظام، فيُحسب: طلاب النظام ناقص الموقّعين، بالهوية. */
  const MIS_KINDS = [{ k: "pre", t: "استبيان قبلي" }, { k: "post", t: "استبيان بعدي" }, { k: "impact", t: "استبيان قياس الأثر" }, { k: "pledge", t: "تعهد الطالب" }, { k: "all", t: "تقرير شامل (الكل معاً)" }, { k: "risk", t: "أولوية المتابعة (الأكثر نواقص)" }];
  const SURVEY_KINDS = ["pre", "post", "impact"];
  const KIND_ITEM = { pre: "الاستبيان القبلي", post: "الاستبيان البعدي", impact: "استبيان قياس الأثر", pledge: "التعهد" };
  const KIND_SHORT = { pre: "قبلي", post: "بعدي", impact: "قياس أثر", pledge: "التعهد" };
  const DEFAULT_MSG = "عزيزي المتدرب {الاسم}، نذكّرك بإكمال {النقص} في نظام مركز مسارات التمكين. شكراً لتعاونك.";
  const misHeads = () => (state.mis.out && state.mis.out.kind === "risk")
    ? ["الاسم", "رقم الهوية", "رقم الطالب", "الجوال", "المسار", "المرحلة", "المجموعة", "استبيان قبلي", "استبيان بعدي", "قياس أثر", "التعهد", "بلا مجموعة", "جوال غير صالح", "درجة الأولوية"]
    : (state.mis.out && state.mis.out.kind === "all")
    ? ["الاسم", "رقم الهوية", "رقم الطالب", "الجوال", "المسار", "المرحلة", "المجموعة", "استبيان قبلي", "استبيان بعدي", "قياس أثر", "التعهد", "عدد النواقص"]
    : ["الاسم", "رقم الهوية", "رقم الطالب", "الجوال", "المسار", "المرحلة", "المجموعة", "ملاحظة"];
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

  /* ----- مصادر البيانات (كل دالة تقرأ ولا تكتب) ----- */
  const missKey = (x) => x.stu || x.id || x.name + "|" + x.track + "|" + x.stage;

  /* تقرير النظام «لم يعبئوا الاستبيان» لنوع واحد، بالمسار/المرحلة المختارين */
  async function fetchSurveyMissing(kind, c, statusOk) {
    let cmds;
    if (c.stages.length) {
      const courses = courseOpts().filter((x) => c.stages.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track)));
      if (!courses.length) throw new Error("لا دورة تجمع المسار والمرحلة المختارين.");
      cmds = courses.map((x) => ({ label: x.t, params: { training_course_id: x.v } }));
    } else if (c.tracks.length) cmds = c.tracks.map((id) => ({ label: optLabel("track_id", id), params: { track_id: id } }));
    else cmds = [{ label: "كل المسارات", params: {} }];
    const results = await runCommands(cmds.map((x) => ({ type: "list", source: "missing", label: x.label, params: Object.assign({ evaluation_type: kind, student_status: statusOk }, x.params) })));
    const rows = [], seen = new Set();
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
    return rows;
  }

  /* فهرس الإرسالات الفعلية من «نتائج الاستبيانات» لكل نوع، للتحقق من تقرير النظام */
  async function loadSubmissionsIndex(trackIds) {
    const subs = await runCommands(trackIds.map((id) => ({ type: "list", source: "submissions", label: "إرسالات " + optLabel("track_id", id), params: { track_id: id } })));
    const mk = () => ({ stu: new Set(), name: new Set(), n: 0 });
    const idx = { byKind: { pre: mk(), post: mk(), impact: mk() }, anyByStu: new Map(), anyByName: new Map(), allSubs: 0, failed: 0, sample: [], subHeads: [] };
    subs.forEach((r) => {
      if (!r || r.type !== "list") { idx.failed++; return; }
      needHead(r, "النموذج", "إرسالات الاستبيانات");
      if (!idx.subHeads.length) idx.subHeads = r.heads.slice();
      r.rows.forEach((x) => {
        idx.allSubs++;
        const form = misCell(r, x, "النموذج");
        const kind = /قبلي/.test(form) ? "pre" : /بعدي/.test(form) ? "post" : "impact";
        const stu = misCell(r, x, "رقم الطالب"), nk = normName(misCell(r, x, "الاسم")) + "|" + norm(misCell(r, x, "المسار"));
        const info = KIND_SHORT[kind] + (misCell(r, x, "الدورة") ? " (" + misCell(r, x, "الدورة") + ")" : "");
        if (stu) idx.anyByStu.set(stu, (idx.anyByStu.get(stu) || []).concat(info));
        idx.anyByName.set(nk, (idx.anyByName.get(nk) || []).concat(info));
        if (idx.sample.length < 3) idx.sample.push((stu || "بلا رقم طالب") + " ← " + (form || "؟").slice(0, 60) + " ← " + kind);
        const k = idx.byKind[kind]; k.n++;
        if (stu) k.stu.add(stu);
        k.name.add(nk);
      });
    });
    return idx;
  }
  /* يستبعد من له إرسال فعلي من هذا النوع، ويكتب بجانب من بقي ما وُجد من إرساله (أي نوع) */
  function applyVerify(kind, rows, idx) {
    const k = idx.byKind[kind];
    const kept = rows.filter((x) => !(x.stu ? k.stu.has(x.stu) : k.name.has(normName(x.name) + "|" + norm(x.track))));
    let withOther = 0;
    kept.forEach((x) => {
      const f = (x.stu && idx.anyByStu.get(x.stu)) || idx.anyByName.get(normName(x.name) + "|" + norm(x.track));
      if (f && f.length) { withOther++; x.note = (x.note ? x.note + " | " : "") + "له إرسال: " + [...new Set(f)].join("، "); }
    });
    return { rows: kept, extra: { reported: rows.length, excluded: rows.length - kept.length, submissions: k.n, allSubs: idx.allSubs, withOther, subHeads: idx.subHeads, sample: idx.sample } };
  }
  function verifyNotes(kind, idx) {
    let n = "";
    if (!idx.allSubs) n += "لم تُقرأ أي إرسالات من «نتائج الاستبيانات»، فالتحقق غير فعّال. ";
    else if (kind !== "all" && !idx.byKind[kind].n) n += "قُرئ " + ui.fmt(idx.allSubs) + " إرسالاً لكن لا شيء منها من نوع «" + KIND_ITEM[kind] + "» حسب اسم النموذج؛ التحقق غير فعّال. ";
    if (idx.failed) n += "تعذّرت قراءة إرسالات " + ui.fmt(idx.failed) + " مسار للتحقق؛ قد تظهر أسماء عبّأت فعلاً. ";
    return n;
  }
  /* إن لم يعرض التقرير رقم الهوية نكمله من قائمة الطلاب (بالمطابقة برقم الطالب ثم بالاسم) */
  async function enrichIds(rows, trackIds) {
    if (!rows.length || !rows.every((x) => !x.id)) return "";
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
    return "لم يعرض التقرير رقم الهوية، فأُكمل من قائمة الطلاب (بمطابقة رقم الطالب أو الاسم). ";
  }
  /* التعهدات: طلاب النظام ناقص الموقّعين (بالهوية) */
  async function fetchPledgeMissing(c, trackIds) {
    const cmds = trackIds.map((id) => ({ type: "list", label: optLabel("track_id", id), params: Object.assign({ track_id: id }, c.status ? { status: c.status } : {}) }));
    cmds.push({ type: "list", source: "pledges", label: "التعهدات", params: {} });
    const res = await runCommands(cmds);
    const pl = res[res.length - 1];
    if (!pl || pl.type !== "list") throw new Error((pl && pl.error) || "تعذّرت قراءة قائمة التعهدات.");
    needHead(pl, "تاريخ الاعتماد", "التعهدات");
    const iPI = pl.heads.indexOf("رقم الهوية");
    if (iPI < 0) throw new Error("تعذّر تحديد رقم الهوية في قائمة التعهدات.");
    const pledged = new Set(pl.rows.map((x) => digits(x.cells[iPI])).filter(Boolean));
    const rows = [], seen = new Set(), students = []; let targets = 0;
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
        const grp = misCell(r, x, "المجموعة").replace(/^[-–—]$/, "");
        students.push({ name: misCell(r, x, "الاسم"), id, stu: misCell(r, x, "رقم الطالب"), phone: misCell(r, x, "الجوال"), track: trackShort(trackIds[i]), stage, group: grp });
        if (pledged.has(id)) return;
        rows.push({ name: misCell(r, x, "الاسم"), id, stu: misCell(r, x, "رقم الطالب"), phone: misCell(r, x, "الجوال"), track: trackShort(trackIds[i]), stage, group: grp || "غير موزع", note: "" });
      });
    });
    return { rows, students, extra: { targets, pledged: pledged.size } };
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
      if (c.kind === "pledge") {
        const r = await fetchPledgeMissing(c, trackIds); rows = r.rows; extra = r.extra;
      } else if (c.kind === "all" || c.kind === "risk") {
        // الاستبيانات الثلاثة من تقرير النظام + التعهد بالحساب، مدموجة في صف لكل طالب
        const byKind = {};
        for (const k of SURVEY_KINDS) byKind[k] = await fetchSurveyMissing(k, c, statusOk);
        const vx = {};
        if (c.verify && SURVEY_KINDS.some((k) => byKind[k].length)) {
          const names = new Set(); SURVEY_KINDS.forEach((k) => byKind[k].forEach((x) => names.add(norm(x.track))));
          const need = trackOpts().filter((o) => names.has(norm(o.t))).map((o) => String(o.v));
          const idx = await loadSubmissionsIndex(need.length ? need : trackIds);
          SURVEY_KINDS.forEach((k) => { const v = applyVerify(k, byKind[k], idx); byKind[k] = v.rows; vx[k] = v.extra; });
          note += verifyNotes("all", idx);
        }
        const pl = await fetchPledgeMissing(c, trackIds);
        const m = new Map();
        const add = (x, flag) => {
          const key = missKey(x);
          const e = m.get(key) || Object.assign({}, x, { flags: {}, note: "" });
          e.flags[flag] = true;
          if (!e.phone && x.phone) e.phone = x.phone;
          if (!e.id && x.id) e.id = x.id;
          m.set(key, e);
        };
        SURVEY_KINDS.forEach((k) => byKind[k].forEach((x) => add(x, k)));
        pl.rows.forEach((x) => add(x, "pledge"));
        // أولوية المتابعة: نضيف إشارات من قائمة الطلاب نفسها (بلا مجموعة، جوال غير صالح) لمن ليس ناقصاً غيرها
        if (c.kind === "risk") {
          pl.students.forEach((st) => {
            const key = missKey(st), e = m.get(key) || Object.assign({}, st, { flags: {}, note: "" });
            if (!/^05\d{8}$/.test(phoneNorm(st.phone))) e.flags.noPhone = true;
            if (!st.group) e.flags.noGroup = true;
            if (Object.keys(e.flags).length) m.set(key, e);
          });
        }
        rows = [...m.values()];
        rows.forEach((x) => { x.count = Object.keys(x.flags).length; });
        note += await enrichIds(rows, trackIds);
        const targetsBy = {}; pl.students.forEach((st) => { const k = st.track + "|" + st.stage; targetsBy[k] = (targetsBy[k] || 0) + 1; });
        extra = { all: true, vx, pledge: pl.extra, targetsBy, counts: { pre: byKind.pre.length, post: byKind.post.length, impact: byKind.impact.length, pledge: pl.rows.length, noGroup: rows.filter((x) => x.flags.noGroup).length, noPhone: rows.filter((x) => x.flags.noPhone).length } };
      } else {
        rows = await fetchSurveyMissing(c.kind, c, statusOk);
        if (c.verify && rows.length) {
          const need = trackOpts().filter((o) => rows.some((x) => norm(x.track) === norm(o.t))).map((o) => String(o.v));
          const idx = await loadSubmissionsIndex(need.length ? need : trackIds);
          const v = applyVerify(c.kind, rows, idx);
          rows = v.rows; extra = v.extra; note += verifyNotes(c.kind, idx);
        }
        note += await enrichIds(rows, trackIds);
      }
      const per = {}; rows.forEach((x) => { const k = (x.track || "—") + (x.stage ? " · " + x.stage : ""); per[k] = (per[k] || 0) + 1; });
      rows.sort((a, b) => (b.count || 0) - (a.count || 0) || (a.track + a.stage + a.group).localeCompare(b.track + b.stage + b.group, "ar") || a.name.localeCompare(b.name, "ar"));
      c.out = { kind: c.kind, rows, per, note, extra, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }

  /* ----- ملف التذكير: اسم، جوال، رسالة جاهزة. لا شيء يُرسَل من هنا ----- */
  const phoneNorm = (v) => { const d = digits(v); return /^5\d{8}$/.test(d) ? "0" + d : d; };
  const itemsOf = (x, kind) => (kind === "all" || kind === "risk" ? Object.keys(x.flags || {}).filter((k) => KIND_ITEM[k]).sort((a, b) => ["pre", "post", "impact", "pledge"].indexOf(a) - ["pre", "post", "impact", "pledge"].indexOf(b)).map((k) => KIND_ITEM[k]) : [KIND_ITEM[kind]]).join(" و");
  const msgTemplate = () => state.mis.msg || DEFAULT_MSG;
  function remindRows() {
    const o = state.mis.out; if (!o) return { rows: [], noPhone: 0 };
    const tpl = msgTemplate(); let noPhone = 0;
    const rows = [];
    o.rows.forEach((x) => {
      const ph = phoneNorm(x.phone);
      if (!itemsOf(x, o.kind)) return;                    // لا استبيان ولا تعهد ناقص: لا تذكير
      if (!ph) { noPhone++; return; }
      rows.push([x.name, x.id, ph, x.track, x.group, tpl.replace(/\{الاسم\}/g, x.name.split(" ")[0] || x.name).replace(/\{الاسم الكامل\}/g, x.name).replace(/\{النقص\}/g, itemsOf(x, o.kind))]);
    });
    return { rows, noPhone };
  }
  const remindHeads = () => ["الاسم", "رقم الهوية", "الجوال", "المسار", "المجموعة", "نص الرسالة"];

  const misTable = () => ((state.mis.out && state.mis.out.rows) || []).map((x) => (state.mis.out.kind === "risk"
    ? [x.name, x.id, x.stu, x.phone, x.track, x.stage, x.group, x.flags.pre ? "ناقص" : "", x.flags.post ? "ناقص" : "", x.flags.impact ? "ناقص" : "", x.flags.pledge ? "ناقص" : "", x.flags.noGroup ? "نعم" : "", x.flags.noPhone ? "نعم" : "", String(x.count)]
    : state.mis.out.kind === "all"
    ? [x.name, x.id, x.stu, x.phone, x.track, x.stage, x.group, x.flags.pre ? "ناقص" : "", x.flags.post ? "ناقص" : "", x.flags.impact ? "ناقص" : "", x.flags.pledge ? "ناقص" : "", String(x.count)]
    : [x.name, x.id, x.stu, x.phone, x.track, x.stage, x.group, x.note]));

  function missingView() {
    const c = state.mis;
    const chk = (k, v, text, on) => `<label class="cc-chk"><input type="checkbox" data-mis="${k}" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const kindT = (MIS_KINDS.find((x) => x.k === c.kind) || {}).t;
    const n = c.kind === "all" || c.kind === "risk" ? 0 : c.kind === "pledge" ? trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v))).length + 1 : (c.stages.length ? courseOpts().filter((x) => c.stages.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track))).length : Math.max(1, c.tracks.length));
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
        <p class="cc-note">${c.kind === "pledge" ? "التعهد: يقرأ قائمة الطلاب وقائمة التعهدات ويطابقها برقم الهوية؛ والباقي هم من لم يوقّعوا." : c.kind === "risk" ? "أولوية المتابعة: التقرير الشامل مع إشارتين من قائمة الطلاب (بلا مجموعة، جوال غير صالح)، مرتّباً بعدد النواقص تنازلياً فتتابع الأخطر أولاً." : c.kind === "all" ? "الشامل: يقرأ تقرير النظام للاستبيانات الثلاثة (قبلي وبعدي وقياس الأثر) ويحسب التعهد، ويجمعها في صف لكل طالب ينقصه شيء. أبطأ لأنه يقرأ أكثر." : "الاستبيان: يقرأ تقرير النظام «الطلاب الذين لم يعبئوا الاستبيان» بالمسار والمرحلة المختارين."}</p>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${esc(kindT || "")}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.stages.length ? " · " + esc(c.stages.map((k) => (STAGES.find((g) => g.k === k) || {}).t).join("، ")) : ""} · ${esc(optLabel("status", c.status) || "كل الحالات")} · ${c.kind === "all" || c.kind === "risk" ? "عدة طلبات قراءة" : ui.fmt(n) + " " + (n === 1 ? "طلب قراءة" : "طلبات قراءة")}</span></div>
        <div class="cc-act"><button type="button" class="btn secondary" data-cc="manager-print" ${state.busy ? "disabled" : ""} title="يشغّل التقرير الشامل ثم يطبع موجزاً على ترويسة المركز">تقرير المدير ← طباعة / PDF</button><button type="button" class="btn secondary" data-cc="manager-word" ${state.busy ? "disabled" : ""} title="يشغّل التقرير الشامل ثم يصدّر Word على ترويسة المركز">Word</button><button type="button" class="btn navy" data-cc="run-mis" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ الاستخراج…" : "استخرج التقرير"}</button></div></footer></section>`;
  }

  function remindCard() {
    const r = remindRows();
    return `<details class="cc-adv" data-open="remind" ${state.open.remind ? "open" : ""}>
      <summary><span>ملف تذكير جاهز للإرسال</span><span class="cc-badge">${ui.fmt(r.rows.length)} رسالة</span><small>لا يُرسَل شيء من هنا</small></summary>
      <label class="cc-field"><span>نص الرسالة (يمكنك التعديل؛ المتغيرات: {الاسم} الاسم الأول، {الاسم الكامل}، {النقص})</span>
        <textarea data-mis="msg" rows="3">${esc(msgTemplate())}</textarea></label>
      <p class="cc-note">مثال: ${esc((r.rows[0] && r.rows[0][5]) || msgTemplate())}</p>
      ${r.noPhone ? `<p class="cc-note">${ui.fmt(r.noPhone)} طالباً بلا رقم جوال في النتيجة فلم يدخلوا الملف.</p>` : ""}
      <div class="cc-row"><button type="button" class="btn navy small" data-cc="export-remind" ${r.rows.length ? "" : "disabled"}>تنزيل ملف التذكير (Excel)</button><button type="button" class="cc-link" data-cc="reset-msg">استرجاع النص الافتراضي</button></div>
    </details>`;
  }

  function missingResult() {
    const o = state.mis.out;
    if (!o) return "";
    const rows = misTable();
    const title = (MIS_KINDS.find((x) => x.k === o.kind) || {}).t || "";
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> لم يُكمل: ${esc(title)}</h3>
      <div class="cc-stats"><span class="cc-stat bad"><b>${ui.fmt(rows.length)}</b> طالباً لم يُكمل</span>
        ${o.kind === "all" || o.kind === "risk" ? SURVEY_KINDS.concat("pledge").map((k) => `<span class="cc-stat"><b>${ui.fmt(o.extra.counts[k])}</b> ناقصهم ${esc(KIND_SHORT[k])}</span>`).join("") : ""}
        ${o.kind === "risk" ? `<span class="cc-stat"><b>${ui.fmt(o.extra.counts.noGroup)}</b> بلا مجموعة</span><span class="cc-stat"><b>${ui.fmt(o.extra.counts.noPhone)}</b> جوال غير صالح</span>` : ""}
        ${o.kind === "all" || o.kind === "risk" ? '<button type="button" class="btn secondary small" data-cc="print-summary" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF موجز المدير</button><button type="button" class="btn secondary small" data-cc="word-summary" title="ملف Word على ترويسة المركز الرسمية">Word على الترويسة</button>' : ""}
        ${o.kind !== "pledge" && o.kind !== "all" && o.kind !== "risk" && o.extra.reported != null ? `<span class="cc-stat"><b>${ui.fmt(o.extra.reported)}</b> عدّهم تقرير النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.excluded)}</b> استُبعدوا (لهم إرسال فعلي)</span><span class="cc-stat"><b>${ui.fmt(o.extra.allSubs || 0)}</b> إرسالاً قُرئ (${ui.fmt(o.extra.submissions || 0)} من هذا النوع)</span>${o.extra.withOther ? `<span class="cc-stat"><b>${ui.fmt(o.extra.withOther)}</b> منهم لهم إرسال من نوع آخر</span>` : ""}` : ""}
        ${o.kind === "pledge" ? `<span class="cc-stat"><b>${ui.fmt(o.extra.targets)}</b> طالباً في النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.pledged)}</b> وقّعوا</span>` : ""}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-mis">تنزيل Excel</button>' : ""}</div>
      ${o.note ? `<p class="cc-alert warn">${esc(o.note)}</p>` : ""}
      ${rows.length ? remindCard() : ""}
      ${o.extra && o.extra.sample ? `<details class="cc-adv"><summary><span>تشخيص التحقق</span><small>ماذا قُرئ من «نتائج الاستبيانات»</small></summary><p class="cc-note">أعمدة صفحة الإرسالات كما وصلت: ${esc((o.extra.subHeads || []).join("، ") || "—")}</p><p class="cc-note">عيّنة من الإرسالات المقروءة (رقم الطالب ← اسم النموذج ← النوع المستنتج):<br>${(o.extra.sample || []).map(esc).join("<br>") || "لا شيء"}</p></details>` : ""}
      ${Object.keys(o.per).length > 1 ? `<div class="cc-stats">${Object.keys(o.per).map((k) => `<span class="cc-stat"><b>${ui.fmt(o.per[k])}</b> ${esc(k)}</span>`).join("")}</div>` : ""}
      ${!rows.length ? '<p class="cc-alert warn">لا طلاب بهذا الشرط. إما أن الجميع أكمل، أو أن الاختيار لا يطابق شيئاً.</p>' : ""}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الطلاب الذين لم يُكملوا</h4><span class="cc-badge">${ui.fmt(rows.length)} صفاً</span></div></header>
        ${rows.length ? dataTable("mis", misHeads(), rows) : ""}</article></section>`;
  }

  /* ===== شريط التقدّم: يبقى المستخدم على شاشة تمكين ويرى أن العمل جارٍ =====
     الوكيل يبدأ رسائله بـ [رقم/عدد] حين تتعدد الأوامر، وبعضها يحمل «س من ص» (قراءة بيانات الطالب 12 من 46). */
  function progressInfo() {
    const t = state.progress || "";
    const m = t.match(/^\[(\d+)\/(\d+)\]\s*/);
    const i = m ? Number(m[1]) : 1, n = m ? Number(m[2]) : 1;
    const text = m ? t.slice(m[0].length) : t;
    const d = text.match(/(\d+)\s*من\s*(\d+)/);
    const inner = d && Number(d[2]) ? Math.min(1, Number(d[1]) / Number(d[2])) : null;
    let pct = null;
    if (n > 1) pct = Math.max(3, ((i - 1 + (inner == null ? 0 : inner)) / n) * 100);
    else if (inner != null) pct = Math.max(3, inner * 100);
    return { i, n, text, pct };
  }
  const fmtElapsed = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function busyBanner() {
    const pi = progressInfo();
    const viaExt = App.centerAgent && App.centerAgent.isReady();
    return `<div class="cc-busy" id="cc-busy" role="status" aria-live="polite">
      <div class="cc-busy-h"><span class="cc-spin" aria-hidden="true"></span><b>جارٍ جلب البيانات من نظام المركز…</b><span class="cc-elapsed" id="cc-elapsed">${fmtElapsed(Date.now() - (state.progStart || Date.now()))}</span></div>
      <div class="cc-bar ${pi.pct == null ? "ind" : ""}"><i id="cc-bar-i" style="${pi.pct == null ? "" : "width:" + pi.pct.toFixed(1) + "%"}"></i></div>
      <div class="cc-busy-t" id="cc-busy-t">${esc(busyLine(pi))}</div>
      <div class="cc-busy-act"><label class="cc-chk"><input type="checkbox" data-cc-notify ${state.notify ? "checked" : ""}> <span>نبّهني عند الانتهاء</span></label>${viaExt ? `<button type="button" class="cc-link danger" data-cc="stop-run" ${state.stopping ? "disabled" : ""}>${state.stopping ? "جارٍ الإيقاف…" : "إيقاف"}</button>` : ""}</div>
      <p class="cc-note">${!viaExt ? "ينفّذ الوكيل المحلي الأمر؛ سيظهر الناتج هنا." : bgSupported() ? "أنت باقٍ في هذه الشاشة: يعمل الوكيل في تبويب خلفي ولا تحتاج الانتقال إليه." : "إضافتك أقدم من 1.3.0 فقد يفتح التنفيذ شاشة النظام. حدّثها (أعد تنزيلها من صفحة الإضافة) ليعمل في الخلفية وتبقى هنا."}</p></div>`;
  }
  const bgSupported = () => { const n = String((App.centerAgent && App.centerAgent.version && App.centerAgent.version()) || "").split(".").map(Number); return n.length >= 2 && (n[0] > 1 || (n[0] === 1 && n[1] >= 3)); };
  const busyLine = (pi) => (state.stopping ? "جارٍ الإيقاف وحفظ ما اكتمل… · " : "") + (pi.n > 1 ? "الأمر " + pi.i + " من " + pi.n + " · " : "") + (pi.text || "يجهّز الوكيل الطلب…");
  /* تحديث الشريط دون إعادة رسم الصفحة */
  function updateProgressUI() {
    const pi = progressInfo();
    const bar = $("cc-bar-i"), t = $("cc-busy-t");
    if (bar) { bar.parentElement.classList.toggle("ind", pi.pct == null); bar.style.width = pi.pct == null ? "" : pi.pct.toFixed(1) + "%"; }
    if (t) t.textContent = busyLine(pi);
  }

  /* ===== تخزين محلي (هذا المتصفح فقط): التقارير المحفوظة، سجل العمليات، الإشعار، لقطة البيانات ===== */
  const SV_KEY = "tamkeen-admin:cc-saved", LOG_KEY = "tamkeen-admin:cc-log", NOTIFY_KEY = "tamkeen-admin:cc-notify", SNAP_KEY = "tamkeen-admin:cc-snap";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* وضع التصفح الخاص */ } };
  const CFG = { report: "sel", compare: "cmp", siblings: "sib", missing: "mis", dq: "dq", groups: "grp" };
  const MODE_NAME = { report: "تقرير جاهز", compare: "مقارنة المراحل", siblings: "مقارنة الإخوة", missing: "استبيانات وتعهدات", dq: "فحص البيانات", groups: "المجموعات والمدربون", student: "ملف الطالب", ask: "اكتب طلبك" };
  const RUN_BTN = { report: "run-selection", compare: "run-compare", siblings: "run-sib", missing: "run-mis", dq: "run-dq", groups: "run-grp" };
  /* نسخة من إعدادات التبويب بلا نتائجه ولا بياناته */
  const cfgOf = (mode) => JSON.parse(JSON.stringify(state[CFG[mode]], (key, v) => (key === "out" || key === "rows" || key === "msg" || key === "diff" ? undefined : v)));
  function applyCfg(mode, cfg) {
    const k = CFG[mode];
    state[k] = Object.assign({}, state[k], cfg, { out: null });
    if (k === "dq") { state.dq.rows = null; state.dq.diff = null; }
  }
  function savedBar(mode) {
    if (!CFG[mode]) return "";
    const mine = state.saved.filter((x) => x.mode === mode);
    return `<div class="cc-saved"><span class="cc-saved-t">تقاريري المحفوظة:</span>${mine.map((x) => `<span class="cc-sv"><button type="button" class="cc-sv-n" data-cc="sv-load" data-id="${x.id}" title="تحميل هذا الاختيار">${esc(x.name)}</button><button type="button" class="cc-sv-b" data-cc="sv-run" data-id="${x.id}" title="تحميل وتنفيذ" aria-label="تنفيذ">▶</button><button type="button" class="cc-sv-b" data-cc="sv-del" data-id="${x.id}" title="حذف" aria-label="حذف">×</button></span>`).join("") || '<span class="cc-note">لا شيء بعد</span>'}<button type="button" class="cc-link" data-cc="sv-save">＋ احفظ هذا الاختيار</button>${state.saved.length > 1 ? '<button type="button" class="cc-link" data-cc="bundle-toggle">📦 حزمة تقارير</button>' : ""}</div>
      ${state.bundle.open && state.saved.length ? `<div class="cc-bundle"><b>شغّل عدة تقارير محفوظة معاً في ملف Excel واحد:</b><div class="cc-chips">${state.saved.map((x) => `<label class="cc-chk"><input type="checkbox" data-bundle value="${esc(x.id)}" ${state.bundle.pick.includes(x.id) ? "checked" : ""}> <span>${esc(x.name)} <small>${esc(MODE_NAME[x.mode] || "")}</small></span></label>`).join("")}</div>
        <div class="cc-row"><button type="button" class="btn navy small" data-cc="bundle-run" ${state.busy ? "disabled" : ""}>شغّل الحزمة وحمّل Excel</button><span class="cc-note">${esc(state.bundle.msg || "تُشغَّل بالتتابع ولا تغيّر اختياراتك الحالية.")}</span></div></div>` : ""}`;
  }

  function runSummary(mode) {
    if (state.resultError) return "خطأ: " + state.resultError.slice(0, 80);
    if (mode === "report" || mode === "ask") {
      const r = state.results && state.results.results; if (!r) return "";
      return r.length + " أمر، " + r.reduce((a, x) => a + ((x && x.rows && x.rows.length) || 0), 0) + " صفاً";
    }
    if (mode === "compare") {
      if (state.cmp.goal === "siblings") { const o = state.sib.out; return o ? o.families + " عائلة" : ""; }
      const o = state.cmp.out; return o ? o.total + " طالباً، " + o.list.filter((p) => p.stages.length > 1).length + " في أكثر من مرحلة" : "";
    }
    if (mode === "siblings") { const o = state.sib.out; return o ? o.families + " عائلة، " + o.siblings + " طالباً" : ""; }
    if (mode === "missing") { const o = state.mis.out; return o ? o.rows.length + " طالباً لم يُكمل (" + ((MIS_KINDS.find((k) => k.k === o.kind) || {}).t || "") + ")" : ""; }
    if (mode === "dq") { const o = state.dq.out; return o ? o.issues.length + " ملاحظة من " + o.total + " طالباً" : ""; }
    if (mode === "groups") { const o = state.grp.out; return o ? o.groups.length + " مجموعة، " + o.unassigned + " غير موزع" : ""; }
    if (mode === "student") { const o = state.stu.out; return o ? "ملف طالب" : ""; }
    return "";
  }
  /* سجل بلا بيانات شخصية: التبويب والزمن والعدد فقط */
  function logRun(mode, ms) {
    const e = { at: new Date().toISOString(), mode, ms, info: runSummary(mode), ok: !state.resultError, by: (curUser() || {}).name || "" };
    state.runLog = [e].concat(state.runLog).slice(0, 40);
    lsSet(LOG_KEY, state.runLog);
  }
  function notifyDone(mode, ms) {
    if (!state.notify || typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    try { new Notification("انتهى التنفيذ — " + (MODE_NAME[mode] || ""), { body: (runSummary(mode) || "اكتمل") + " · " + fmtElapsed(ms), tag: "cc-done" }); } catch (e) { /* غير مدعوم */ }
  }
  function logCard() {
    const rows = state.runLog.slice(0, 15);
    return `<details class="cc-help" data-open="log" ${state.open.log ? "open" : ""}><summary>سجل العمليات (${ui.fmt(state.runLog.length)})</summary>
      ${rows.length ? `<table class="cc-table"><thead><tr><th>الوقت</th><th>بواسطة</th><th>التبويب</th><th>النتيجة</th><th>المدة</th></tr></thead><tbody>${rows.map((e) => `<tr><td>${esc(new Date(e.at).toLocaleString("ar"))}</td><td>${esc(e.by || "—")}</td><td>${esc(MODE_NAME[e.mode] || e.mode)}</td><td>${e.ok ? "" : "✗ "}${esc(e.info || "—")}</td><td>${esc(fmtElapsed(e.ms || 0))}</td></tr>`).join("")}</tbody></table>
      <button type="button" class="cc-link" data-cc="clear-log">مسح السجل</button>` : '<p class="cc-note">لا عمليات مسجّلة بعد.</p>'}
      <p class="cc-note">يُحفظ في هذا المتصفح فقط، ولا يحوي أسماء ولا أرقاماً شخصية.</p></details>`;
  }
  const stopSupported = () => { const n = String((App.centerAgent && App.centerAgent.version && App.centerAgent.version()) || "").split(".").map(Number); return n.length >= 2 && (n[0] > 1 || (n[0] === 1 && n[1] >= 4)); };

  /* ===== فحص البيانات: ملاحظات الجودة + مقارنة بلقطة سابقة ===== */
  const DQ_CHECKS = [["dupId", "هوية مكررة لطالبين مختلفين"], ["badId", "هوية ليست 9 أرقام"], ["noPhone", "جوال ناقص أو غير صالح"], ["noGroup", "بلا مجموعة"], ["shortName", "اسم أقل من رباعي"], ["dupName", "اسم مكرر بهويات مختلفة"], ["dupPhone", "جوال مشترك بين طلاب (قد يكونون إخوة)"]];
  const DQ_LABEL = Object.fromEntries(DQ_CHECKS);
  const dqHeads = () => ["نوع الملاحظة", "الاسم", "رقم الهوية", "رقم الطالب", "الجوال", "المسار", "المرحلة", "المجموعة", "تفاصيل"];
  const dqTable = () => ((state.dq.out && state.dq.out.issues) || []).map((x) => [DQ_LABEL[x.type], x.s.name, x.s.id, x.s.stu, x.s.phone, x.s.track, x.s.stage, x.s.group, x.detail]);

  async function runDq() {
    const c = state.dq;
    state.busy = true; state.resultError = ""; c.out = null; c.diff = null; state.progress = "";
    render(); refreshStatus();
    try {
      const trackIds = trackOpts().map((o) => String(o.v)).filter((id) => !c.tracks.length || c.tracks.includes(id));
      let lists;
      if (state.cache && !c.status) lists = state.cache.items.filter((it) => trackIds.includes(it.trackId)).map((it) => ({ heads: it.heads, rows: it.rows, tid: it.trackId }));
      else {
        const res = await runCommands(trackIds.map((id) => ({ type: "list", label: optLabel("track_id", id), params: Object.assign({ track_id: id }, c.status ? { status: c.status } : {}) })));
        lists = res.map((r, i) => (r && r.type === "list" ? { heads: r.heads, rows: r.rows, tid: trackIds[i] } : null)).filter(Boolean);
      }
      let students = [];
      lists.forEach((l) => {
        const at = (h) => l.heads.indexOf(h);
        const iI = at("رقم الهوية"), iN = at("الاسم"), iP = at("الجوال"), iG = at("المجموعة"), iS = at("رقم الطالب");
        if (iI < 0 || iN < 0) throw new Error("تعذّر تحديد عمودي الاسم والهوية في جدول النظام.");
        l.rows.forEach((x) => students.push({ name: clean(x.cells[iN]), id: digits(x.cells[iI]), stu: iS >= 0 ? clean(x.cells[iS]) : "", phone: iP >= 0 ? phoneNorm(x.cells[iP]) : "", track: trackShort(l.tid), stage: stageOf(x.course || ""), group: iG >= 0 ? clean(x.cells[iG]).replace(/^[-–—]$/, "") : "" }));
      });
      if (c.stages.length) students = students.filter((st) => c.stages.includes(st.stage));      // الفحص داخل المراحل المختارة فقط
      const uniq = new Map();
      students.forEach((st) => { const k = st.stu || st.id + "|" + st.name; if (!uniq.has(k)) uniq.set(k, st); });
      students = [...uniq.values()];
      const issues = [];
      const push = (type, st, detail) => issues.push({ type, s: st, detail: detail || "" });
      const groupBy = (keyFn) => { const m = new Map(); students.forEach((st) => { const k = keyFn(st); if (k) (m.get(k) || m.set(k, []).get(k)).push(st); }); return m; };
      if (c.checks.dupId) groupBy((st) => st.id).forEach((arr) => { if (arr.length > 1) arr.forEach((st) => push("dupId", st, "نفس الهوية عند: " + arr.filter((x) => x !== st).map((x) => x.name).join("، "))); });
      if (c.checks.badId) students.forEach((st) => { if (!/^\d{9}$/.test(st.id)) push("badId", st, st.id ? "طولها " + st.id.length + " خانات" : "بلا هوية"); });
      if (c.checks.noPhone) students.forEach((st) => { if (!/^05\d{8}$/.test(st.phone)) push("noPhone", st, st.phone ? "الرقم: " + st.phone : "بلا جوال"); });
      if (c.checks.noGroup) students.forEach((st) => { if (!st.group) push("noGroup", st); });
      if (c.checks.shortName) students.forEach((st) => { if (normName(st.name).split(" ").filter(Boolean).length < 4) push("shortName", st, "عدد أجزاء الاسم: " + normName(st.name).split(" ").filter(Boolean).length); });
      if (c.checks.dupName) groupBy((st) => normName(st.name)).forEach((arr) => { if (new Set(arr.map((x) => x.id)).size > 1) arr.forEach((st) => push("dupName", st, "نفس الاسم بهوية مختلفة عند " + (arr.length - 1) + " آخر")); });
      if (c.checks.dupPhone) groupBy((st) => st.phone).forEach((arr) => { if (new Set(arr.map((x) => x.id)).size > 1) arr.forEach((st) => push("dupPhone", st, "الجوال نفسه عند: " + arr.filter((x) => x !== st).slice(0, 3).map((x) => x.name).join("، "))); });
      const order = DQ_CHECKS.map((x) => x[0]);
      issues.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.s.name.localeCompare(b.s.name, "ar"));
      const byType = {}; issues.forEach((x) => { byType[x.type] = (byType[x.type] || 0) + 1; });
      c.out = { issues, total: students.length, byType, at: new Date() };
      c.rows = students;
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }

  const snapKey = (st) => st.stu || st.id + "|" + st.name;
  function dqSnapshotSave() {
    const c = state.dq;
    if (!c.rows || !c.rows.length) return ui.toast("افحص البيانات أولاً ثم احفظ اللقطة");
    if (!confirm("ستُحفظ لقطة بأسماء الطلاب وهوياتهم في هذا المتصفح فقط (لا تُرسل إلى أي مكان) لتقارنها لاحقاً. هل تريد الحفظ؟")) return;
    lsSet(SNAP_KEY, { at: new Date().toISOString(), rows: c.rows.map((st) => [snapKey(st), st.id, st.name, st.track, st.stage, st.group]) });
    ui.toast("حُفظت اللقطة (" + ui.fmt(c.rows.length) + " طالباً)");
  }
  function dqSnapshotCompare() {
    const c = state.dq, snap = lsGet(SNAP_KEY, null);
    if (!snap) return ui.toast("لا لقطة محفوظة بعد");
    if (!c.rows) return ui.toast("افحص البيانات أولاً ثم قارن");
    const old = new Map(snap.rows.map((r) => [r[0], r])), cur = new Map(c.rows.map((st) => [snapKey(st), st]));
    const diff = [];
    cur.forEach((st, k) => {
      const o = old.get(k);
      if (!o) diff.push(["جديد", st.name, st.id, "—", [st.track, st.stage, st.group].filter(Boolean).join(" · ")]);
      else if (o[3] !== st.track || o[4] !== st.stage || o[5] !== st.group) diff.push(["تغيّر مكانه", st.name, st.id, [o[3], o[4], o[5]].filter(Boolean).join(" · "), [st.track, st.stage, st.group].filter(Boolean).join(" · ")]);
    });
    old.forEach((o, k) => { if (!cur.has(k)) diff.push(["لم يعد في القائمة", o[2], o[1], [o[3], o[4], o[5]].filter(Boolean).join(" · "), "—"]); });
    c.diff = { at: snap.at, rows: diff, n: { added: diff.filter((d) => d[0] === "جديد").length, moved: diff.filter((d) => d[0] === "تغيّر مكانه").length, gone: diff.filter((d) => d[0] === "لم يعد في القائمة").length } };
  }

  function dqView() {
    const c = state.dq;
    const chk = (v, text, on) => `<label class="cc-chk"><input type="checkbox" data-dq="tracks" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const n = trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v))).length;
    return `<section class="cc-card" id="cc-dq">
      <header class="cc-card-h"><h3>فحص جودة البيانات</h3><p>يقرأ قوائم الطلاب ويكشف: هويات مكررة أو غير صالحة، جوالات ناقصة، طلاباً بلا مجموعة، وأسماء ناقصة. للقراءة فقط.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk(o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
          <fieldset class="cc-fs"><legend>المراحل${c.stages.length ? ` <em>${ui.fmt(c.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => `<label class="cc-chk"><input type="checkbox" data-dq="stages" value="${esc(g.t)}" ${c.stages.includes(g.t) ? "checked" : ""}> <span>${esc(g.t)}</span></label>`).join("")}</div><p class="cc-note">اتركها فارغة لتشمل كل المراحل.</p></fieldset>
          <fieldset class="cc-fs"><legend>حالة الطالب</legend><label class="cc-field"><select data-dq="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></fieldset>
          <fieldset class="cc-fs cc-wide"><legend>ما الذي يُفحص؟</legend><div class="cc-chips">${DQ_CHECKS.map(([k, t]) => `<label class="cc-chk"><input type="checkbox" data-dq="chk:${k}" ${c.checks[k] ? "checked" : ""}> <span>${esc(t)}</span></label>`).join("")}</div></fieldset>
        </div>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${state.cache && !c.status ? "⚡ من الذاكرة المحمّلة" : "سيُقرأ " + ui.fmt(n) + " " + (n === 1 ? "مسار" : "مسارات")}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.stages.length ? " · " + esc(c.stages.join("، ")) : " · كل المراحل"} · ${esc(optLabel("status", c.status) || "كل الحالات")}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-dq" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ الفحص…" : "افحص البيانات"}</button></div></footer></section>`;
  }

  function dqResult() {
    const o = state.dq.out;
    if (!o) return "";
    const rows = dqTable(), snap = lsGet(SNAP_KEY, null), d = state.dq.diff;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> نتيجة الفحص</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total)}</b> طالباً فُحص</span><span class="cc-stat ${rows.length ? "bad" : "ok"}"><b>${ui.fmt(rows.length)}</b> ملاحظة</span>
        ${DQ_CHECKS.filter(([k]) => o.byType[k]).map(([k, t]) => `<span class="cc-stat"><b>${ui.fmt(o.byType[k])}</b> ${esc(t)}</span>`).join("")}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-dq">تنزيل Excel</button>' : ""}</div>
      ${!rows.length ? '<p class="cc-alert warn">لا ملاحظات بحسب الفحوص المختارة.</p>' : `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الملاحظات</h4><span class="cc-badge">${ui.fmt(rows.length)} صفاً</span></div></header>${dataTable("dq", dqHeads(), rows)}</article>`}
      <details class="cc-adv" data-open="snap" ${state.open.snap ? "open" : ""}><summary><span>لقطة البيانات ومقارنتها</span><small>تغيّر منذ آخر لقطة</small></summary>
        <p class="cc-note">${snap ? "آخر لقطة محفوظة: " + esc(new Date(snap.at).toLocaleString("ar")) + " (" + ui.fmt(snap.rows.length) + " طالباً)." : "لا لقطة محفوظة بعد."} اللقطة تُحفظ في هذا المتصفح فقط.</p>
        <div class="cc-row"><button type="button" class="btn secondary small" data-cc="snap-save">احفظ لقطة الآن</button><button type="button" class="btn secondary small" data-cc="snap-compare" ${snap ? "" : "disabled"}>قارن مع اللقطة المحفوظة</button></div>
        ${d ? `<div class="cc-stats"><span class="cc-stat ok"><b>${ui.fmt(d.n.added)}</b> جديد</span><span class="cc-stat"><b>${ui.fmt(d.n.moved)}</b> تغيّر مكانه</span><span class="cc-stat bad"><b>${ui.fmt(d.n.gone)}</b> لم يعد في القائمة</span></div>${d.rows.length ? dataTable("dqdiff", ["التغيّر", "الاسم", "رقم الهوية", "قبل", "بعد"], d.rows) : '<p class="cc-note">لا فرق عن اللقطة.</p>'}` : ""}
      </details></section>`;
  }

  /* ===== الخصوصية والأمان: إخفاء الأرقام، مسح البيانات بعد الخمول وبعد مدة، سجل الأخطاء، تنبيه تحديث الإضافة ===== */
  const MASK_KEY = "tamkeen-admin:cc-mask", IDLE_KEY = "tamkeen-admin:cc-idle", ERR_KEY = "tamkeen-admin:cc-errors";
  const CACHE_TTL = 2 * 3600 * 1000;
  const maskCell = (v) => { const t = cellStr(v); return /^\d{9,10}$/.test(t) ? t.slice(0, 2) + "*".repeat(t.length - 4) + t.slice(-2) : t; };
  const showCell = (v) => (state.mask ? maskCell(v) : cellStr(v));
  const verNum = (v) => String(v || "").split(".").map(Number);
  const verLess = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
  const curUser = () => { try { return (App.cloud && App.cloud.user && App.cloud.user()) || null; } catch (e) { return null; } };
  /* حصر التبويب بمدير النظام (إعداد مشترك يحفظه المدير) */
  const centerAllowed = () => { const st = (App.store && App.store.get && App.store.get()) || {}; const u = curUser(); return !st.centerAdminOnly || !u || !!u.admin; };
  const hasSensitive = () => !!(state.results || state.cmp.out || state.sib.out || state.mis.out || state.dq.out || state.dq.rows || state.cache || state.grp.out || state.stu.out);
  function wipeData(why) {
    state.results = null; state.cmp.out = null; state.sib.out = null; state.mis.out = null; state.dq.out = null; state.dq.rows = null; state.dq.diff = null;
    state.cache = null; state.grp.out = null; state.stu.out = null; state.stu.pick = null;
    Object.keys(tblData).forEach((k) => delete tblData[k]); Object.keys(tblState).forEach((k) => delete tblState[k]);
    render();
    if (why) ui.toast(why);
  }
  const pushErr = (msg, where) => {
    if (!msg) return;
    state.errors = [{ at: new Date().toISOString(), msg: String(msg).slice(0, 200), where: String(where || "").slice(-60) }].concat(state.errors).slice(0, 30);
    lsSet(ERR_KEY, state.errors);
  };
  function updateBanner() {
    const cur = App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version();
    if (!cur || !state.extLatest || !verLess(cur, state.extLatest)) return "";
    return `<div class="cc-alert warn" role="status">🔄 <b>تحديث متاح لإضافة «وكيل تمكين»</b>: عندك ${esc(cur)} والمنشور ${esc(state.extLatest)}. <a href="extension/tamkeen-center-agent.zip" download>تنزيل الإضافة</a> ثم فكّ الضغط فوق مجلدها واضغط 🔄 على بطاقتها في chrome://extensions.</div>`;
  }
  function settingsCard() {
    const u = curUser();
    const st = (App.store && App.store.get && App.store.get()) || {};
    return `<details class="cc-help" data-open="sec" ${state.open.sec ? "open" : ""}><summary>الخصوصية والأمان</summary>
      <label class="cc-chk"><input type="checkbox" data-set="mask" ${state.mask ? "checked" : ""}> <span>إخفاء الهوية والجوال جزئياً في العرض والنسخ (للمشاركة بالشاشة)</span></label>
      <label class="cc-field" style="max-width:320px"><span>مسح النتائج من الشاشة بعد خمول</span><select data-set="idle">${[[10, "10 دقائق"], [20, "20 دقيقة"], [60, "ساعة"], [0, "لا تمسح"]].map(([v, t]) => `<option value="${v}" ${state.idleMin === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${u && u.admin ? `<label class="cc-chk"><input type="checkbox" data-set="adminonly" ${st.centerAdminOnly ? "checked" : ""}> <span>حصر هذا التبويب بمدير النظام (يسري على كل المستخدمين)</span></label>` : ""}
      <div class="cc-row"><button type="button" class="cc-link danger" data-cc="wipe-now">مسح كل بيانات هذه الشاشة الآن</button></div>
      <p class="cc-note">الذاكرة المحمّلة (⚡) تُمسح تلقائياً بعد ساعتين. وكل ما تعرضه هذه الشاشة يبقى في المتصفح ولا يُرسل إلى أي خدمة.</p></details>
      <details class="cc-help" data-open="errs" ${state.open.errs ? "open" : ""}><summary>أخطاء الصفحة (${ui.fmt(state.errors.length)})</summary>
      ${state.errors.length ? `<table class="cc-table"><thead><tr><th>الوقت</th><th>الخطأ</th><th>الموضع</th></tr></thead><tbody>${state.errors.slice(0, 10).map((e) => `<tr><td>${esc(new Date(e.at).toLocaleString("ar"))}</td><td>${esc(e.msg)}</td><td>${esc(e.where)}</td></tr>`).join("")}</tbody></table><div class="cc-row"><button type="button" class="cc-link" data-cc="copy-errs">نسخ للإرسال إلى المطوّر</button><button type="button" class="cc-link" data-cc="clear-errs">مسح</button></div>` : '<p class="cc-note">لا أخطاء مسجّلة.</p>'}</details>`;
  }

  /* ===== موجز للمدير: صفحة طباعة (احفظها PDF من نافذة الطباعة) ===== */
  function printHtml(title, bodyHtml) {
    const w = window.open("", "_blank");
    if (!w) { ui.toast("اسمح بالنوافذ المنبثقة لطباعة الموجز"); return; }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:14px/1.7 "Segoe UI",Tahoma,sans-serif;margin:24px;color:#18202D}
      h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 6px} .meta{color:#5B687A;font-size:12px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%;margin:6px 0 14px} th,td{border:1px solid #cfd6e0;padding:5px 8px;text-align:right;font-size:12.5px}
      th{background:#eef2f8} .n{font-variant-numeric:tabular-nums} .bad{color:#b42318;font-weight:700} .note{color:#5B687A;font-size:12px}
      @media print{body{margin:10mm} button{display:none}}
    </style></head><body>${bodyHtml}<p class="note">أُعدّ هذا الموجز من نظام المركز عبر مساعد تمكين الإداري بتاريخ ${esc(new Date().toLocaleString("ar"))}. القيم «ناقص» تعني عدم وجود إرسال/توقيع في النظام.</p><script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    w.document.close();
  }
  /* موجز المدير على الترويسة الرسمية للمركز: كتل تُرسَم بمحرك المستندات المشترك (طباعة/PDF وWord) */
  function summaryBlocks() {
    const o = state.mis.out;
    if (!o || !o.extra || !o.extra.targetsBy) return null;
    const by = new Map();
    Object.keys(o.extra.targetsBy).forEach((k) => by.set(k, { total: o.extra.targetsBy[k], pre: 0, post: 0, impact: 0, pledge: 0, any: 0 }));
    o.rows.forEach((x) => {
      const k = x.track + "|" + x.stage;
      const e = by.get(k) || by.set(k, { total: 0, pre: 0, post: 0, impact: 0, pledge: 0, any: 0 }).get(k);
      ["pre", "post", "impact", "pledge"].forEach((f) => { if (x.flags[f]) e[f]++; });
      if (["pre", "post", "impact", "pledge"].some((f) => x.flags[f])) e.any++;
    });
    const keys = [...by.keys()].sort((a, b) => a.localeCompare(b, "ar"));
    const tot = { total: 0, pre: 0, post: 0, impact: 0, pledge: 0, any: 0 };
    keys.forEach((k) => Object.keys(tot).forEach((f) => { tot[f] += by.get(k)[f]; }));
    const pct = (a, b2) => (b2 ? Math.round((a / b2) * 100) + "%" : "—");
    const rowOf = (name, st) => [name, ui.fmt(st.total), ui.fmt(st.pre), ui.fmt(st.post), ui.fmt(st.impact), ui.fmt(st.pledge), ui.fmt(st.any), pct(st.total - st.any, st.total)];
    const scope = (state.mis.tracks.length ? state.mis.tracks.map(trackShort).join("، ") : "كل المسارات") + " · " + (optLabel("status", state.mis.status) || "كل الحالات");
    return [
      { kind: "title", text: "موجز متابعة الطلاب — الاستبيانات والتعهدات" },
      { kind: "meta", text: "التاريخ: " + (ui.formatDate(ui.todayISO()) || ui.todayISO()), sizePt: 12 },
      { kind: "para", text: "" },
      { kind: "bold", text: "نطاق الموجز: " + scope },
      { kind: "para", text: "" },
      { kind: "table", headers: ["المسار · المرحلة", "الطلاب", "ناقصهم القبلي", "ناقصهم البعدي", "ناقصهم قياس الأثر", "لم يوقّعوا", "ينقصهم شيء", "مكتملون تماماً"],
        widths: [0.26, 0.09, 0.12, 0.12, 0.12, 0.12, 0.085, 0.085], align: [null, "center", "center", "center", "center", "center", "center", "center"],
        rows: keys.map((k) => rowOf(k.replace("|", " · ").replace(/ · $/, ""), by.get(k))).concat([rowOf("المجموع", tot)]) },
      { kind: "para", text: "" },
      { kind: "para", text: "«مكتملون تماماً» = لا ينقصهم استبيان قبلي ولا بعدي ولا قياس أثر ولا تعهد. وقد لا يكون كل نوع مطلوباً من كل مرحلة، فتُقرأ النسب إرشاداً لا حكماً. مصدر البيانات: نظام المركز." },
    ];
  }
  /* الترويسة الرسمية غير متاحة: صفحة طباعة بسيطة بديلة */
  function printSummary() {
    const list = summaryBlocks();
    if (!list) return ui.toast("نفّذ التقرير الشامل أو أولوية المتابعة أولاً");
    if (App.docRender && App.docRender.print) return App.docRender.print(list, "موجز متابعة الطلاب", false);
    const t = list.find((x) => x.kind === "table");
    printHtml("موجز متابعة الطلاب", `<h1>${esc(list[0].text)}</h1><table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  }
  async function wordSummary() {
    const list = summaryBlocks();
    if (!list) return ui.toast("نفّذ التقرير الشامل أو أولوية المتابعة أولاً");
    if (!(App.docRender && App.docRender.exportWord)) return ui.toast("محرك المستندات غير متاح");
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* يُحمَّل عند الحاجة */ }
    App.docRender.exportWord(list, "موجز متابعة الطلاب " + ui.todayISO());
  }

  /* تقرير المدير بنقرة: يشغّل التقرير الشامل (إن لم تكن نتيجته حاضرة) ثم يطبع/يصدّر Word على الترويسة */
  async function managerReport(how) {
    const c = state.mis;
    if (state.busy) return ui.toast("هناك عملية جارية الآن؛ انتظر انتهاءها.");
    if (c.out && c.out.extra && c.out.extra.targetsBy) ui.toast("يُعدّ الموجز من النتيجة الظاهرة دون إعادة جلب");
    else {
      ui.toast("لا نتيجة شاملة جاهزة: سأشغّل التقرير الشامل أولاً ثم أفتح الموجز");
      c.kind = "all"; c.verify = c.verify !== false;
      await runMissing();
      if (state.resultError || !(c.out && c.out.extra && c.out.extra.targetsBy)) return;
    }
    return how === "word" ? wordSummary() : printSummary();
  }

  /* ===== المجموعات والمدربون + اقتراح توزيع غير الموزعين ===== */
  const grpGroupHeads = () => ["المسار", "المرحلة", "المجموعة", "المدرب", "عدد الطلاب", "الفرق عن المتوسط", "ملاحظة"];
  const grpTrainerHeads = () => ["المدرب", "عدد المجموعات", "عدد الطلاب", "المسارات"];
  const grpPropHeads = () => ["الطالب", "رقم الهوية", "المسار", "المرحلة", "المجموعة المقترحة", "مدرب المجموعة", "حجمها بعد التوزيع"];

  async function runGroups() {
    const c = state.grp;
    state.busy = true; state.resultError = ""; c.out = null; state.progress = "";
    render(); refreshStatus();
    try {
      const trackIds = trackOpts().map((o) => String(o.v)).filter((id) => !c.tracks.length || c.tracks.includes(id));
      const res = await runCommands(trackIds.map((id) => ({ type: "list", label: optLabel("track_id", id), params: Object.assign({ track_id: id }, c.status ? { status: c.status } : {}) })));
      let students = [];
      res.forEach((r, i) => {
        if (!r || r.type !== "list") return;
        const at = (h) => r.heads.indexOf(h);
        const iN = at("الاسم"), iI = at("رقم الهوية"), iG = at("المجموعة"), iT = at("المدرب"), iS = at("رقم الطالب");
        if (iN < 0 || iG < 0) throw new Error("تعذّر تحديد عمودي الاسم والمجموعة في جدول النظام.");
        r.rows.forEach((x) => students.push({ name: clean(x.cells[iN]), id: iI >= 0 ? digits(x.cells[iI]) : "", stu: iS >= 0 ? clean(x.cells[iS]) : "", track: trackShort(trackIds[i]), stage: stageOf(x.course || ""), group: clean(x.cells[iG]).replace(/^[-–—]$/, ""), trainer: iT >= 0 ? clean(x.cells[iT]) : "" }));
      });
      if (c.stages.length) students = students.filter((st) => c.stages.includes(st.stage));
      const uniq = new Map(); students.forEach((st) => { const k = st.stu || st.id + "|" + st.name; if (!uniq.has(k)) uniq.set(k, st); }); students = [...uniq.values()];
      const gm = new Map(), tm = new Map(), unBy = new Map(); let unassigned = 0;
      students.forEach((st) => {
        if (!st.group) { unassigned++; const k = st.track + "|" + st.stage; unBy.set(k, (unBy.get(k) || 0) + 1); return; }
        const gk = st.track + "|" + st.stage + "|" + st.group;
        const g = gm.get(gk) || gm.set(gk, { track: st.track, stage: st.stage, group: st.group, trainer: "", n: 0 }).get(gk);
        g.n++; if (st.trainer && !g.trainer) g.trainer = st.trainer;
      });
      const groups = [...gm.values()];
      const avg = new Map(); groups.forEach((g) => { const k = g.track + "|" + g.stage; const a = avg.get(k) || avg.set(k, { s: 0, n: 0 }).get(k); a.s += g.n; a.n++; });
      groups.forEach((g) => { const a = avg.get(g.track + "|" + g.stage), m = a.s / a.n; g.diff = Math.round((g.n - m) * 10) / 10; g.note = a.n > 1 && g.n > m * 1.25 ? "أكبر من المتوسط" : a.n > 1 && g.n < m * 0.75 ? "أصغر من المتوسط" : ""; });
      groups.sort((a, b) => (a.track + a.stage + a.group).localeCompare(b.track + b.stage + b.group, "ar"));
      groups.forEach((g) => { const key = g.trainer || "(بلا مدرب)"; const t = tm.get(key) || tm.set(key, { name: key, groups: 0, n: 0, tracks: new Set() }).get(key); t.groups++; t.n += g.n; t.tracks.add(g.track); });
      const trainers = [...tm.values()].sort((a, b) => b.n - a.n);
      c.out = { students, groups, trainers, unassigned, unBy, total: students.length, prop: null, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* توازن عددي فقط: يضع كل غير موزع في أصغر مجموعة من مجموعات مساره ومرحلته القائمة */
  function proposeDistribution(o) {
    const byTS = new Map(), rows = [], notes = [];
    o.students.forEach((st) => {
      const k = st.track + "|" + st.stage;
      const e = byTS.get(k) || byTS.set(k, { track: st.track, stage: st.stage, groups: new Map(), un: [] }).get(k);
      if (st.group) { const g = e.groups.get(st.group) || e.groups.set(st.group, { n: 0, trainer: "" }).get(st.group); g.n++; if (st.trainer && !g.trainer) g.trainer = st.trainer; }
      else e.un.push(st);
    });
    byTS.forEach((e) => {
      if (!e.un.length) return;
      if (!e.groups.size) { notes.push(e.track + " · " + (e.stage || "بلا مرحلة") + ": لا توجد مجموعات قائمة لاقتراح التوزيع عليها (" + e.un.length + " طالباً)."); return; }
      const gs = [...e.groups.entries()].map(([name, g]) => ({ name, n: g.n, trainer: g.trainer }));
      e.un.sort((a, b) => a.name.localeCompare(b.name, "ar")).forEach((st) => {
        gs.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name, "ar"));
        const g = gs[0]; g.n++;
        rows.push([st.name, st.id, st.track, st.stage, g.name, g.trainer, g.n]);
      });
    });
    return { rows, notes };
  }
  const grpGroupTable = () => ((state.grp.out && state.grp.out.groups) || []).map((g) => [g.track, g.stage, g.group, g.trainer, g.n, g.diff > 0 ? "+" + g.diff : String(g.diff), g.note]);
  const grpTrainerTable = () => ((state.grp.out && state.grp.out.trainers) || []).map((t) => [t.name, t.groups, t.n, [...t.tracks].join("، ")]);
  async function exportGrpBook() {
    const o = state.grp.out; if (!o) return;
    const wb = new ExcelJS.Workbook();
    fmtSheet(wb.addWorksheet("المجموعات"), grpGroupHeads(), grpGroupTable());
    fmtSheet(wb.addWorksheet("المدربون"), grpTrainerHeads(), grpTrainerTable());
    if (o.prop) fmtSheet(wb.addWorksheet("اقتراح التوزيع"), grpPropHeads(), o.prop.rows);
    ui.download("المجموعات والمدربون.xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function grpView() {
    const c = state.grp;
    const chk = (k, v, text, on) => `<label class="cc-chk"><input type="checkbox" data-grp="${k}" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const n = trackOpts().filter((o) => !c.tracks.length || c.tracks.includes(String(o.v))).length;
    return `<section class="cc-card" id="cc-grp">
      <header class="cc-card-h"><h3>المجموعات والمدربون</h3><p>حجم كل مجموعة ومدربها وتوازنها، وحمل كل مدرب، وعدد غير الموزعين، مع <b>اقتراح توزيع عددي</b> لهم. للقراءة فقط.</p></header>
      <div class="cc-card-b"><div class="cc-grid">
        <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => chk("tracks", o.v, o.t.replace(/^مسار\s*/, ""), c.tracks.includes(String(o.v)))).join("")}</div></fieldset>
        <fieldset class="cc-fs"><legend>المراحل${c.stages.length ? ` <em>${ui.fmt(c.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => chk("stages", g.t, g.t, c.stages.includes(g.t))).join("")}</div>
          <label class="cc-field" style="margin-top:10px"><span>حالة الطالب</span><select data-grp="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></fieldset>
      </div></div>
      <footer class="cc-actions"><div class="cc-sum"><b>سيُقرأ ${ui.fmt(n)} ${n === 1 ? "مسار" : n === 2 ? "مساران" : n < 11 ? "مسارات" : "مساراً"}</b><span>${c.tracks.length ? esc(c.tracks.map(trackShort).join("، ")) : "كل المسارات"}${c.stages.length ? " · " + esc(c.stages.join("، ")) : " · كل المراحل"} · ${esc(optLabel("status", c.status) || "كل الحالات")}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-grp" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اعرض المجموعات"}</button></div></footer></section>`;
  }
  function grpResult() {
    const o = state.grp.out;
    if (!o) return "";
    const gt = grpGroupTable(), tt = grpTrainerTable();
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> المجموعات والمدربون</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total)}</b> طالباً</span><span class="cc-stat"><b>${ui.fmt(o.groups.length)}</b> مجموعة</span><span class="cc-stat"><b>${ui.fmt(o.trainers.filter((t) => t.name !== "(بلا مدرب)").length)}</b> مدرباً</span><span class="cc-stat ${o.unassigned ? "bad" : "ok"}"><b>${ui.fmt(o.unassigned)}</b> غير موزع</span>
        <button type="button" class="btn secondary small" data-cc="export-grp">تنزيل Excel</button></div>
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>المجموعات</h4><span class="cc-badge">${ui.fmt(gt.length)}</span></div></header>${gt.length ? dataTable("grp-g", grpGroupHeads(), gt) : '<p class="cc-note">لا مجموعات.</p>'}</article>
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>حمل المدربين</h4><span class="cc-badge">${ui.fmt(tt.length)}</span></div></header>${tt.length ? dataTable("grp-t", grpTrainerHeads(), tt) : ""}</article>
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>اقتراح توزيع غير الموزعين</h4></div><div class="cc-res-act"><button type="button" class="btn secondary small" data-cc="grp-propose" ${o.unassigned ? "" : "disabled"}>اقترح توزيعاً</button></div></header>
        <p class="cc-note">توازن عددي فقط: يضع كل غير موزع في أصغر مجموعة من مجموعات مساره ومرحلته القائمة. لا يراعي السعة المسموحة للمجموعة ولا الجنس ولا مواعيد المجموعات، فراجعه قبل أي تطبيق. ولا يُكتب شيء في النظام.</p>
        ${o.prop ? `${o.prop.notes.map((n) => `<p class="cc-alert warn">${esc(n)}</p>`).join("")}${o.prop.rows.length ? dataTable("grp-p", grpPropHeads(), o.prop.rows) : '<p class="cc-note">لا اقتراحات.</p>'}` : ""}</article></section>`;
  }

  /* ===== ملف الطالب الشامل: كل ما يخصّ طالباً في بطاقة واحدة ===== */
  const stuFrom = (it, x) => {
    const g = (h) => { const i = it.heads.indexOf(h); return i < 0 ? "" : clean(x.cells[i]); };
    return { name: g("الاسم"), id: digits(g("رقم الهوية")), stu: g("رقم الطالب"), phone: phoneNorm(g("الجوال")), track: g("المسار").replace(/^مسار\s*/, ""), stage: g("المرحلة"), group: g("المجموعة"), trainer: g("المدرب") };
  };
  const sameStu = (s0, r, x) => {
    const stu = misCell(r, x, "رقم الطالب"), id = digits(misCell(r, x, "رقم الهوية")), nm = normName(misCell(r, x, "الاسم") || misCell(r, x, "الطالب"));
    return (s0.stu && stu && s0.stu === stu) || (s0.id && id && s0.id === id) || (!stu && !id && nm && nm === normName(s0.name));
  };

  async function runStudent(chosen) {
    const c = state.stu, q = clean(c.q);
    if (!chosen && !q) return ui.toast("اكتب اسماً أو رقم هوية أو جوالاً أو رقم طالب");
    state.busy = true; state.resultError = ""; c.out = null; c.pick = null; state.progress = "";
    render(); refreshStatus();
    try {
      requireAgent12();
      let s0 = chosen;
      if (!s0) {
        const r0 = (await runCommands([{ type: "lookup", label: "بحث", items: [{ q }] }]))[0];
        const it = r0 && r0.items && r0.items[0];
        if (!it || !it.count) throw new Error("لا نتيجة لهذا البحث.");
        const list = it.rows.map((x) => stuFrom(it, x));
        if (list.length > 1) { c.pick = list; return; }                 // أكثر من مطابق: يختار المستخدم
        s0 = list[0];
      }
      const key = s0.id || s0.stu;
      const cmds = [{ type: "lookup", label: "بياناته", items: [{ q: key }], details: true }]
        .concat(SURVEY_KINDS.map((k) => ({ type: "list", source: "missing", label: "نواقص " + KIND_SHORT[k], params: { evaluation_type: k, student_status: "all", q: key } })))
        .concat([{ type: "list", source: "pledges", label: "التعهد", params: { q: key } }, { type: "list", source: "submissions", label: "إرسالاته", params: { q: key } }]);
      const parts = clean(s0.name).split(" ").filter(Boolean);
      const sibCmds = [];
      if (s0.phone) sibCmds.push({ kind: "phone", cmd: { type: "list", label: "نفس الهاتف", params: { q: s0.phone } } });
      if (parts.length >= 3) sibCmds.push({ kind: "name", cmd: { type: "list", label: "نفس الاسم", params: { q: parts.slice(1).join(" ") } } });
      const res = await runCommands(cmds.concat(sibCmds.map((x) => x.cmd)));
      res.slice(1, 6).forEach((r, i) => { if (i < 3) needHead(r, "حالة تعبئة الاستبيان", "تقرير النواقص"); else if (i === 3) needHead(r, "تاريخ الاعتماد", "التعهدات"); else needHead(r, "النموذج", "إرسالات الاستبيانات"); });
      // البيانات الأساسية والتفصيلية
      const d0 = res[0] && res[0].items && res[0].items[0];
      const kv = [];
      if (d0 && d0.rows[0]) {
        const skip = new Set(["الطالب", "المسار / الدورة", "المجموعة / المدرب", "الاسم الإنجليزي"]);    // الأعمدة المدموجة فُصلت وتظهر أعلاه
        d0.heads.forEach((h, i) => { const v = clean(d0.rows[0].cells[i]); if (v && !skip.has(h)) kv.push([h, v]); });
      }
      // الاستبيانات: ناقص (في تقرير النظام) / مكتمل (له إرسال) / غير معروف
      const subs = [];
      const sr = res[5];
      (sr.rows || []).forEach((x) => { if (sameStu(s0, sr, x)) subs.push([misCell(sr, x, "النموذج"), misCell(sr, x, "الدورة"), misCell(sr, x, "الدرجة"), misCell(sr, x, "تاريخ الإرسال")]); });
      const kindOf = (form) => (/قبلي/.test(form) ? "pre" : /بعدي/.test(form) ? "post" : "impact");
      const surveys = SURVEY_KINDS.map((k, i) => {
        const r = res[1 + i];
        const missing = (r.rows || []).some((x) => !/^(لا يوجد|اختر)/.test(misCell(r, x, "الطالب") || misCell(r, x, "الاسم")) && sameStu(s0, r, x));
        const mine = subs.filter((x) => kindOf(x[0]) === k);
        if (missing) return { label: KIND_ITEM[k], state: "ناقص", detail: "يظهر في تقرير «لم يعبئوا الاستبيان»", bad: true };
        if (mine.length) return { label: KIND_ITEM[k], state: "مكتمل", detail: mine.map((x) => x[3] + (x[2] ? " (الدرجة " + x[2] + ")" : "")).join("؛ ") };
        return { label: KIND_ITEM[k], state: "غير مطلوب أو لا بيانات", detail: "ليس في تقرير النواقص ولا له إرسال من هذا النوع" };
      });
      const pr = res[4];
      const pRow = (pr.rows || []).find((x) => sameStu(s0, pr, x));
      const pledge = pRow ? { label: KIND_ITEM.pledge, state: "موقّع", detail: misCell(pr, pRow, "تاريخ الاعتماد") } : { label: KIND_ITEM.pledge, state: "لم يوقّع", detail: "لا تعهد له في قائمة التعهدات", bad: true };
      // الإخوة المحتملون
      const nk = normName(parts.slice(1).join(" "));
      const sibs = new Map();
      sibCmds.forEach((sc, i) => {
        const r = res[6 + i];
        if (!r || r.type !== "list") return;
        const at = (h) => r.heads.indexOf(h);
        r.rows.forEach((x) => {
          const o = { name: clean(x.cells[at("الاسم")]), id: digits(x.cells[at("رقم الهوية")] || ""), stu: at("رقم الطالب") >= 0 ? clean(x.cells[at("رقم الطالب")]) : "", track: at("المسار") >= 0 ? clean(x.cells[at("المسار")]).replace(/^مسار\s*/, "") : "", stage: at("المرحلة") >= 0 ? clean(x.cells[at("المرحلة")]) : "", group: at("المجموعة") >= 0 ? clean(x.cells[at("المجموعة")]) : "" };
          if ((o.stu && o.stu === s0.stu) || (o.id && o.id === s0.id)) return;
          if (sc.kind === "name" && normName(o.name).split(" ").slice(1).join(" ") !== nk) return;      // تطابق صارم بعد الاسم الأول
          const k = o.stu || o.id || o.name;
          const e = sibs.get(k) || sibs.set(k, Object.assign(o, { why: new Set() })).get(k);
          e.why.add(sc.kind === "phone" ? "هاتف" : "اسم");
        });
      });
      const quality = [];
      if (!/^\d{9}$/.test(s0.id)) quality.push("الهوية ليست 9 أرقام (" + (s0.id || "بلا هوية") + ")");
      if (!/^05\d{8}$/.test(s0.phone)) quality.push("الجوال ناقص أو غير صالح (" + (s0.phone || "بلا جوال") + ")");
      if (!s0.group) quality.push("بلا مجموعة");
      if (parts.length < 4) quality.push("الاسم أقل من رباعي");
      c.out = { s: s0, kv, surveys, pledge, subs, sibs: [...sibs.values()].map((e) => [e.name, e.id, e.track, e.stage, e.group, [...e.why].join(" + ")]), quality, at: new Date() };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  const stuSibHeads = () => ["الاسم", "رقم الهوية", "المسار", "المرحلة", "المجموعة", "سبب الربط"];

  function stuView() {
    const c = state.stu;
    return `<section class="cc-card" id="cc-stu">
      <header class="cc-card-h"><h3>ملف الطالب الشامل</h3><p>ابحث عن طالب واحد فتظهر لك بطاقة واحدة: بياناته ومجموعته، وحالة الاستبيانات الثلاثة والتعهد، وإرسالاته، وإخوته المحتملون، وملاحظات جودة بياناته. للقراءة فقط.</p></header>
      <div class="cc-card-b"><label class="cc-field"><span>اسم الطالب، أو رقم الهوية، أو الجوال، أو رقم الطالب (STU)</span><input type="search" class="cc-tbl-q" style="max-width:none" data-stu="q" value="${esc(c.q)}" placeholder="مثال: 401878814"></label>
        ${c.pick ? `<div class="cc-pick"><b>أكثر من مطابق (${ui.fmt(c.pick.length)})، اختر الطالب:</b><div class="cc-chips">${c.pick.slice(0, 30).map((x, i) => `<button type="button" class="btn secondary small" data-cc="stu-pick" data-i="${i}">${esc(x.name)} · ${esc(showCell(x.id))}</button>`).join("")}</div></div>` : ""}
      </div>
      <footer class="cc-actions"><div class="cc-sum"><span>يقرأ الوكيل نحو 8 صفحات صغيرة (قراءة فقط)</span></div><div class="cc-act"><button type="button" class="btn navy" data-cc="run-stu" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ البحث…" : "اعرض الملف"}</button></div></footer></section>`;
  }
  function stuResult() {
    const o = state.stu.out;
    if (!o) return "";
    const s0 = o.s, line = (a, b) => `<tr><th>${esc(a)}</th><td>${esc(showCell(b) || "—")}</td></tr>`;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> ${esc(s0.name)}</h3>
      <div class="cc-stats">${o.quality.length ? `<span class="cc-stat bad"><b>${ui.fmt(o.quality.length)}</b> ملاحظة جودة</span>` : '<span class="cc-stat ok"><b>0</b> ملاحظة جودة</span>'}${o.sibs.length ? `<span class="cc-stat"><b>${ui.fmt(o.sibs.length)}</b> أخ/أخت محتمل</span>` : ""}<button type="button" class="btn secondary small" data-cc="print-stu" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF</button><button type="button" class="btn secondary small" data-cc="word-stu">Word على الترويسة</button></div>
      <article class="cc-res"><header class="cc-res-h"><h4>البيانات</h4></header><table class="cc-table"><tbody>${line("الاسم", s0.name)}${line("رقم الهوية", s0.id)}${line("رقم الطالب", s0.stu)}${line("الجوال", s0.phone)}${line("المسار", s0.track)}${line("المرحلة", s0.stage)}${line("المجموعة", s0.group)}${line("المدرب", s0.trainer)}${o.kv.map(([a, b]) => line(a, b)).join("")}</tbody></table></article>
      <article class="cc-res"><header class="cc-res-h"><h4>الاستبيانات والتعهد</h4></header><table class="cc-table"><thead><tr><th>البند</th><th>الحالة</th><th>تفصيل</th></tr></thead><tbody>${o.surveys.concat([o.pledge]).map((x) => `<tr><td>${esc(x.label)}</td><td class="${x.bad ? "cc-bad" : ""}">${x.state === "مكتمل" || x.state === "موقّع" ? "✓ " : x.bad ? "✗ " : ""}${esc(x.state)}</td><td>${esc(x.detail)}</td></tr>`).join("")}</tbody></table></article>
      ${o.subs.length ? `<article class="cc-res"><header class="cc-res-h"><h4>إرسالات الاستبيانات</h4></header>${dataTable("stu-subs", ["النموذج", "الدورة", "الدرجة", "تاريخ الإرسال"], o.subs)}</article>` : ""}
      ${o.sibs.length ? `<article class="cc-res"><header class="cc-res-h"><h4>إخوة محتملون</h4></header>${dataTable("stu-sibs", stuSibHeads(), o.sibs)}</article>` : ""}
      ${o.quality.length ? `<article class="cc-res"><header class="cc-res-h"><h4>ملاحظات جودة البيانات</h4></header><ul>${o.quality.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></article>` : ""}</section>`;
  }
  function studentBlocks() {
    const o = state.stu.out; if (!o) return null;
    const s0 = o.s, v = (x) => showCell(x) || "—";
    const out = [
      { kind: "title", text: "ملف الطالب: " + s0.name },
      { kind: "meta", text: "التاريخ: " + (ui.formatDate(ui.todayISO()) || ui.todayISO()), sizePt: 12 },
      { kind: "para", text: "" },
      { kind: "bold", text: "البيانات" },
      { kind: "table", headers: ["البند", "القيمة"], widths: [0.35, 0.65], align: [null, null],
        rows: [["رقم الهوية", v(s0.id)], ["رقم الطالب", v(s0.stu)], ["الجوال", v(s0.phone)], ["المسار", v(s0.track)], ["المرحلة", v(s0.stage)], ["المجموعة", v(s0.group)], ["المدرب", v(s0.trainer)]].concat(o.kv.map(([a, b2]) => [a, v(b2)])) },
      { kind: "para", text: "" },
      { kind: "bold", text: "الاستبيانات والتعهد" },
      { kind: "table", headers: ["البند", "الحالة", "تفصيل"], widths: [0.3, 0.2, 0.5], align: [null, "center", null], rows: o.surveys.concat([o.pledge]).map((x) => [x.label, x.state, x.detail]) },
    ];
    if (o.sibs.length) out.push({ kind: "para", text: "" }, { kind: "bold", text: "إخوة محتملون" }, { kind: "table", headers: stuSibHeads(), widths: [0.3, 0.14, 0.18, 0.12, 0.1, 0.16], align: [null, "center", null, null, "center", "center"], rows: o.sibs.map((r) => r.map((c) => v(c))) });
    if (o.quality.length) out.push({ kind: "para", text: "" }, { kind: "bold", text: "ملاحظات جودة البيانات" }, ...o.quality.map((q) => ({ kind: "para", text: "• " + q })));
    return out;
  }
  function printStudent() {
    const list = studentBlocks(); if (!list) return;
    if (App.docRender && App.docRender.print) return App.docRender.print(list, "ملف الطالب", false);
    printHtml("ملف الطالب", "<h1>" + esc(list[0].text) + "</h1>");
  }
  async function wordStudent() {
    const list = studentBlocks(); if (!list) return;
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* */ }
    App.docRender.exportWord(list, "ملف الطالب " + state.stu.out.s.name.split(" ")[0]);
  }

  /* ===== حزمة التقارير: عدة تقارير محفوظة تُشغَّل معاً في ملف Excel واحد، ورقة لكل تقرير ===== */
  async function runForMode(mode) {
    if (mode === "report") { const plan = buildSelection(); return executeBatch(plan.map((x) => x.command), plan.map((x) => x.label), true); }
    if (mode === "compare") return runCompare();
    if (mode === "siblings") { state.sib.stageMode = false; return runSiblings(); }
    if (mode === "missing") return runMissing();
    if (mode === "dq") return runDq();
    if (mode === "groups") return runGroups();
  }
  function collectSheets(mode, name) {
    if (mode === "report") return ((state.results && state.results.results) || []).map((r, i) => (r && r.type === "list" ? (() => { const [h, rr] = shown(r.heads, r.rows.map((x) => x.cells)); return { name: state.labels[i] || name, heads: h, rows: rr }; })() : null)).filter(Boolean);
    if (mode === "compare") return state.cmp.goal === "siblings" ? (state.sib.out ? [{ name, heads: sibHeads(), rows: state.sib.out.rows }] : []) : (state.cmp.out ? [{ name, heads: cmpHeads(), rows: cmpTable() }] : []);
    if (mode === "siblings") return state.sib.out ? [{ name, heads: sibHeads(), rows: state.sib.out.rows }] : [];
    if (mode === "missing") return state.mis.out ? [{ name, heads: misHeads(), rows: misTable() }] : [];
    if (mode === "dq") return state.dq.out ? [{ name, heads: dqHeads(), rows: dqTable() }] : [];
    if (mode === "groups") return state.grp.out ? [{ name: name + " - مجموعات", heads: grpGroupHeads(), rows: grpGroupTable() }, { name: name + " - مدربون", heads: grpTrainerHeads(), rows: grpTrainerTable() }] : [];
    return [];
  }
  async function runBundle() {
    const ids = state.bundle.pick.filter((id) => state.saved.some((x) => x.id === id));
    if (!ids.length) return ui.toast("اختر تقريراً واحداً على الأقل");
    const backup = {}; Object.values(CFG).forEach((k) => { backup[k] = state[k]; });
    const origMode = state.mode;
    const sheets = [], notes = [];
    for (let i = 0; i < ids.length; i++) {
      const it = state.saved.find((x) => x.id === ids[i]);
      state.bundle.msg = "الحزمة: " + (i + 1) + " من " + ids.length + " — " + it.name;
      state.mode = it.mode; state.adding = ""; applyCfg(it.mode, it.cfg);
      try {
        await runForMode(it.mode);
        if (state.resultError) notes.push([it.name, "خطأ: " + state.resultError]);
        else { const got = collectSheets(it.mode, it.name); if (!got.length) notes.push([it.name, "لا نتائج"]); got.forEach((g) => sheets.push(g)); }
      } catch (e) { notes.push([it.name, "خطأ: " + (e.message || e)]); }
    }
    Object.keys(backup).forEach((k) => { state[k] = backup[k]; });                // لا نمحو اختياراتك الحالية
    state.mode = origMode; state.bundle.msg = "";
    if (!sheets.length) { render(); return ui.toast("لم تنتج الحزمة نتائج"); }
    const wb = new ExcelJS.Workbook(), used = new Set();
    sheets.forEach((g, i) => {
      let nm = (String(i + 1) + "-" + g.name).replace(/^مسار\s*/, "").replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
      while (used.has(nm)) nm = nm.slice(0, 28) + "·" + used.size;
      used.add(nm); fmtSheet(wb.addWorksheet(nm), g.heads, g.rows);
    });
    if (notes.length) fmtSheet(wb.addWorksheet("ملاحظات"), ["التقرير", "ملاحظة"], notes);
    ui.download("حزمة التقارير " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    render();
    ui.toast("نُزّلت الحزمة: " + ui.fmt(sheets.length) + " ورقة" + (notes.length ? "، وفيها ملاحظات" : ""));
  }

  /* حالة الوكيل في جملة ولون واحدين: busy | ok | bad */
  function statusInfo() {
    const st = state.agentStatus;
    if (state.thinking) return { st: "busy", text: "أحلل صياغة طلبك…" };
    if (state.busy) return { st: "busy", text: (state.progress || "").replace(/^\[\d+\/\d+\]\s*/, "") || "الوكيل ينفّذ طلبك الآن…" };
    if (!st) return { st: "bad", text: "جارٍ الاتصال بالوكيل…" };
    return { st: st.loggedIn ? "ok" : "bad", text: st.message };
  }

  function render() {
    const box = $("cc-body");
    if (!box) return;
    if (!SCHEMA()) { box.innerHTML = '<p class="cc-alert warn">مخطط نظام المركز غير محمَّل.</p>'; return; }
    if (!centerAllowed()) { box.innerHTML = '<p class="cc-alert warn">هذا التبويب مخصّص لمدير النظام. اطلب من المدير إتاحته لك.</p>'; return; }
    if (state.cache && Date.now() - state.cache.at.getTime() > CACHE_TTL) { state.cache = null; ui.toast("مُسحت الذاكرة المحمّلة لمرور ساعتين؛ حمّلها من جديد عند الحاجة"); }
    const mode = state.adding || state.proposal ? "ask" : state.mode;
    const info = statusInfo();
    const viaExt = App.centerAgent && App.centerAgent.isReady();
    if (state.busy && !state._wasBusy) { state._runStart = Date.now(); state._runMode = mode; state.stopping = false; }
    if (!state.busy && state._wasBusy) { const ms = Date.now() - state._runStart; logRun(state._runMode, ms); notifyDone(state._runMode, ms); }
    state._wasBusy = !!state.busy;
    if (state.busy && !state.progStart) { state.progStart = Date.now(); Object.keys(tblState).forEach((k) => delete tblState[k]); }
    if (!state.busy) state.progStart = 0;
    box.innerHTML = `<div class="cc-app">
      <div class="cc-top" data-st="${info.st}"><span class="cc-dot" aria-hidden="true"></span><span id="cc-status" role="status">${esc(info.text)}</span><button type="button" class="cc-link cc-mask-btn" data-cc="toggle-mask" aria-pressed="${state.mask}" title="يخص العرض والنسخ، لا ملفات Excel">${state.mask ? "👁 إظهار الأرقام" : "🙈 إخفاء الهوية والجوال"}</button></div>
      ${updateBanner()}
      ${state.busy ? busyBanner() : ""}
      <nav class="cc-modes" role="tablist" aria-label="نوع الأمر">
        <button type="button" role="tab" class="${mode === "report" ? "on" : ""}" aria-selected="${mode === "report"}" data-cc="mode" data-m="report"><b>تقرير جاهز</b><small>اختر المسار والمرحلة ثم نفّذ</small></button>
        <button type="button" role="tab" class="${mode === "compare" ? "on" : ""}" aria-selected="${mode === "compare"}" data-cc="mode" data-m="compare"><b>مقارنة المراحل</b><small>من سجّل في أكثر من مرحلة</small></button>
        <button type="button" role="tab" class="${mode === "siblings" ? "on" : ""}" aria-selected="${mode === "siblings"}" data-cc="mode" data-m="siblings"><b>مقارنة الإخوة</b><small>طلاب يجمعهم هاتف أو عائلة</small></button>
        <button type="button" role="tab" class="${mode === "missing" ? "on" : ""}" aria-selected="${mode === "missing"}" data-cc="mode" data-m="missing"><b>استبيانات وتعهدات</b><small>من لم يعبّئ أو يوقّع</small></button>
        <button type="button" role="tab" class="${mode === "dq" ? "on" : ""}" aria-selected="${mode === "dq"}" data-cc="mode" data-m="dq"><b>فحص البيانات</b><small>أخطاء الجودة وتغيّر القوائم</small></button>
        <button type="button" role="tab" class="${mode === "groups" ? "on" : ""}" aria-selected="${mode === "groups"}" data-cc="mode" data-m="groups"><b>المجموعات والمدربون</b><small>التوازن، حمل المدربين، التوزيع</small></button>
        <button type="button" role="tab" class="${mode === "student" ? "on" : ""}" aria-selected="${mode === "student"}" data-cc="mode" data-m="student"><b>ملف الطالب</b><small>كل شيء عن طالب واحد</small></button>
        <button type="button" role="tab" class="${mode === "ask" ? "on" : ""}" aria-selected="${mode === "ask"}" data-cc="mode" data-m="ask"><b>اكتب طلبك</b><small>بحث، أو تسجيل طلاب من Excel</small></button>
      </nav>
      ${savedBar(mode)}
      ${mode === "report" ? scriptsView() : mode === "compare" ? compareView() : mode === "siblings" ? siblingsView() : mode === "missing" ? missingView() : mode === "dq" ? dqView() : mode === "groups" ? grpView() : mode === "student" ? stuView() : assistantView() + (state.adding === "register" ? registerBuilder() : "")}
      ${state.resultError ? `<p class="cc-alert err" role="alert">${esc(state.resultError)}</p>` : ""}
      ${planView()}
      ${mode === "compare" ? compareResult() : mode === "siblings" ? siblingsResult() : mode === "missing" ? missingResult() : mode === "dq" ? dqResult() : mode === "groups" ? grpResult() : mode === "student" ? stuResult() : state.results ? `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> النتيجة</h3>${resultsView()}</section>` : ""}
      ${logCard()}
      ${settingsCard()}
      <details class="cc-help"><summary>كيف تعمل الأوامر؟</summary><p>${viaExt
        ? "تعمل الأوامر في متصفحك عبر إضافة «وكيل تمكين». سجّل دخولك في نظام المركز مرة واحدة؛ والبحث والقوائم تُنفَّذ مباشرة، أما التسجيل فتراجع معاينته هنا وتوافق قبل أن يُكتب شيء. لا تصل كلمة مرورك أو جلستك إلى تمكين."
        : "تعمل الجلسة في نافذة Edge المحلية. سجّل الدخول فيها مرة واحدة؛ بعدها ينفّذ الوكيل البحث والقوائم والتسجيل ويعرض النتيجة هنا. أو ثبّت إضافة «وكيل تمكين» في Chrome لتعمل دون خادم محلي."}</p></details>
    </div>`;
  }

  /* ===== التنزيل ===== */
  /* ورقة منسّقة: اتجاه يمين لليسار، ترويسة مثبّتة ملوّنة، فلاتر، وعرض أعمدة بحسب المحتوى */
  function fmtSheet(ws, heads, rows) {
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
    ws.addRow(heads);
    rows.forEach((r) => ws.addRow(r));
    const hr = ws.getRow(1);
    hr.font = { bold: true };
    hr.alignment = { vertical: "middle", horizontal: "right" };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, heads.length) } };
    heads.forEach((h, i) => {
      let w = cellStr(h).length;
      rows.forEach((r) => { w = Math.max(w, cellStr(r[i]).length); });
      ws.getColumn(i + 1).width = Math.min(45, Math.max(10, w + 3));
    });
  }
  async function exportBook(name, heads, rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("النتائج");
    fmtSheet(ws, heads, rows);
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
    // الاسم العربي يفصله النظام عمّا بعده بـ « / » أو شرطة: نزيل الفواصل من طرفيه (والإنجليزي كذلك)
    const trimSep = (v) => clean(v).replace(/^[\s\/\|·\-–—،,:]+|[\s\/\|·\-–—،,:]+$/g, "");
    return [trimSep(name), trimSep(en), stu, id, phone];
  }
  /* خلية «المجموعة / المدرب»: «S3G2 -» (بلا مدرب)، «G1 - د. أحمد»، أو «S3G1 اسراء خليل…» (رمز المجموعة ثم المدرب بلا فاصل) */
  function splitGroupCell(raw) {
    const d = clean(raw).split(/\s+-\s*/);
    let g = clean(d[0]), tr = clean(d.slice(1).join(" - "));
    if (!tr) {
      let m = g.match(/^([A-Za-z]+\d*[A-Za-z]*\d*)\s+(.+)$/);              // رمز لاتيني: G1، S3G2
      if (!m) m = g.match(/^(المجموعة\s+\S+)\s+(.+)$/);                   // المجموعة الاولى
      if (m) { g = m[1]; tr = clean(m[2]); }
    }
    return [g, tr.replace(/^[-–—]+$/, "")];
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
        plan.push((c) => splitGroupCell(c));
      } else { heads.push(h); plan.push((c) => [c]); }
    });
    const rows = r.rows.map((x) => ({ cells: [].concat(...plan.map((f, i) => f(x.cells[i]))), course: iC >= 0 ? clean(x.cells[iC]) : "", raw: x.cells }));
    return Object.assign({}, r, { heads, rows, rawHeads: r.heads });
  }

  async function runCommands(commands, hooks) {
    hooks = hooks || {};
    let results;
    if (App.centerAgent && await App.centerAgent.ready(500)) {
      // إضافة المتصفح: تفتح نظام المركز وتنفّذ، والموافقة على الكتابة هنا في الصفحة
      const out = await App.centerAgent.run(commands, {
        onProgress: (t) => { state.progress = t; const el = $("cc-status"); if (el && !state.plan) el.textContent = t.replace(/^\[\d+\/\d+\]\s*/, ""); updateProgressUI(); },
        onPlan: (plan) => new Promise((resolve) => { state.plan = plan; state.planResolve = resolve; render(); }),
        onPartial: hooks.onPartial ? (i, r) => hooks.onPartial(i, expandResult(r)) : undefined,
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
      // كل أمر ينتهي تظهر نتيجته فوراً (إضافة 1.4.0 فأحدث)، والباقي «قيد التنفيذ»
      const partial = new Array(commands.length).fill(null);
      const results = await runCommands(commands, { onPartial: (i, r) => { partial[i] = r; state.results = { results: partial.map((x) => x || { type: "pending" }) }; render(); } });
      if (!results.length) throw new Error("لم تصل نتيجة من الوكيل.");
      if (commands.length === 1 && results[0] && results[0].error) throw new Error(results[0].error);
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
    try { const m = localStorage.getItem("tamkeen-admin:cc-msg"); if (m) state.mis.msg = m; } catch (e) { /* خاص */ }
    state.saved = lsGet(SV_KEY, []); state.runLog = lsGet(LOG_KEY, []); state.errors = lsGet(ERR_KEY, []);
    try { state.mask = localStorage.getItem(MASK_KEY) === "1"; const im = localStorage.getItem(IDLE_KEY); if (im !== null && im !== "") state.idleMin = Number(im); } catch (e) { /* خاص */ }
    ["click", "keydown", "input", "change"].forEach((ev) => box.addEventListener(ev, () => { state.lastAct = Date.now(); }, true));
    window.setInterval(() => {                                      // مسح النتائج بعد خمول (لا أثناء تنفيذ)
      if (!state.idleMin || state.busy || !hasSensitive()) return;
      if (Date.now() - state.lastAct > state.idleMin * 60000) wipeData("مُسحت النتائج من الشاشة لخمولك " + state.idleMin + " دقيقة؛ أعد التنفيذ عند الحاجة");
    }, 30000);
    window.addEventListener("error", (e) => pushErr(e.message, (e.filename || "").split("/").pop() + ":" + e.lineno));
    window.addEventListener("unhandledrejection", (e) => pushErr((e.reason && e.reason.message) || e.reason, "promise"));
    fetch("extension/manifest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m && m.version) { state.extLatest = m.version; if (!state.busy) render(); } }).catch(() => {});
    try { state.notify = localStorage.getItem(NOTIFY_KEY) === "1"; } catch (e) { /* خاص */ }
    window.setInterval(() => { const e = $("cc-elapsed"); if (e && state.busy && state.progStart) e.textContent = fmtElapsed(Date.now() - state.progStart); }, 1000);
    render();
    refreshStatus();
    window.setInterval(refreshStatus, 8000);
    if (App.centerAgent) App.centerAgent.ready(1500).then((ok) => { if (ok) { refreshStatus(); if (!state.busy && !state.thinking && !state.plan) render(); } });

    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cc]");
      if (!b) return;
      const act = b.dataset.cc;
      const i = Number(b.dataset.i);
      // لا يبدأ تنفيذ جديد أثناء تنفيذ جارٍ (يمنع عمليتين متداخلتين على الوكيل)
      if (state.busy && ["run-selection", "run-compare", "run-sib", "run-mis", "run-dq", "run-grp", "run-stu", "stu-pick", "manager-print", "manager-word", "preload", "preload-details", "interpret", "bundle-run", "register-run"].includes(act)) {
        return ui.toast("هناك عملية جارية الآن؛ انتظر انتهاءها أو اضغط «إيقاف».");
      }
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
          if (command.type === "mode-intent") {
            state.proposal = null; state.mode = command.mode; if (command.cfg) applyCfg(command.mode, command.cfg);
            render();
            if (command.run) { const rb = box.querySelector('[data-cc="' + RUN_BTN[command.mode] + '"]'); if (rb && !rb.disabled) rb.click(); }
            return;
          }
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
            const [hh, rr] = shown(r.heads, visibleRows(r).map((x) => x.cells));
            fmtSheet(ws, hh, rr);
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
        } else if (act === "run-stu") { return runStudent();
        } else if (act === "stu-pick") { return runStudent(state.stu.pick[i]);
        } else if (act === "print-stu") { return printStudent();
        } else if (act === "word-stu") { return wordStudent();
        } else if (act === "bundle-toggle") { state.bundle.open = !state.bundle.open;
        } else if (act === "bundle-run") { return runBundle();
        } else if (act === "run-grp") { return runGroups();
        } else if (act === "export-grp") { return exportGrpBook();
        } else if (act === "grp-propose") { state.grp.out.prop = proposeDistribution(state.grp.out);
        } else if (act === "manager-print") { return managerReport("print");
        } else if (act === "manager-word") { return managerReport("word");
        } else if (act === "print-summary") { return printSummary();
        } else if (act === "word-summary") { return wordSummary();
        } else if (act === "run-dq") { return runDq();
        } else if (act === "export-dq") { return exportBook("فحص جودة البيانات.xlsx", dqHeads(), dqTable());
        } else if (act === "snap-save") { dqSnapshotSave(); return render();
        } else if (act === "snap-compare") { dqSnapshotCompare(); state.open.snap = true; render(); return;
        } else if (act === "sv-save") {
          const m = state.mode === "ask" ? "report" : state.mode;
          if (!CFG[m]) return;
          const name = (window.prompt("اسم هذا التقرير المحفوظ:", "") || "").trim();
          if (!name) return;
          state.saved.push({ id: String(Date.now()), name: name.slice(0, 40), mode: m, cfg: cfgOf(m) });
          lsSet(SV_KEY, state.saved); ui.toast("حُفظ «" + name + "»");
        } else if (act === "sv-load" || act === "sv-run") {
          const it = state.saved.find((x) => x.id === b.dataset.id);
          if (!it) return;
          state.mode = it.mode; state.adding = ""; state.proposal = null; applyCfg(it.mode, it.cfg);
          render();
          if (act === "sv-run") { const rb = box.querySelector('[data-cc="' + RUN_BTN[it.mode] + '"]'); if (rb && !rb.disabled) rb.click(); }
          return;
        } else if (act === "sv-del") {
          state.saved = state.saved.filter((x) => x.id !== b.dataset.id); lsSet(SV_KEY, state.saved);
        } else if (act === "toggle-mask") {
          state.mask = !state.mask; try { localStorage.setItem(MASK_KEY, state.mask ? "1" : ""); } catch (e) { /* خاص */ }
        } else if (act === "wipe-now") { return wipeData("مُسحت بيانات هذه الشاشة");
        } else if (act === "clear-errs") { state.errors = []; lsSet(ERR_KEY, []);
        } else if (act === "copy-errs") {
          try { await navigator.clipboard.writeText(state.errors.map((e) => e.at + " | " + e.msg + " | " + e.where).join("\n")); ui.toast("نُسخ سجل الأخطاء"); } catch (err) { ui.toast("تعذّر النسخ"); }
          return;
        } else if (act === "clear-log") { state.runLog = []; lsSet(LOG_KEY, []);
        } else if (act === "stop-run") {
          if (!stopSupported()) return ui.toast("إضافتك لا تدعم الإيقاف؛ حدّثها إلى 1.4.0 أو أحدث");
          state.stopping = true; App.centerAgent.stop();
          const bt = $("cc-busy-t"); if (bt) bt.textContent = "جارٍ الإيقاف وحفظ ما اكتمل…";
          const sb = box.querySelector('[data-cc="stop-run"]'); if (sb) { sb.disabled = true; sb.textContent = "جارٍ الإيقاف…"; }
          return;
        } else if (act === "run-mis") { return runMissing();
        } else if (act === "export-remind") {
          const r = remindRows();
          return exportBook("ملف تذكير.xlsx", remindHeads(), r.rows);
        } else if (act === "reset-msg") { state.mis.msg = ""; try { localStorage.removeItem("tamkeen-admin:cc-msg"); } catch (e) { /* خاص */ }
        } else if (act === "export-mis") {
          const o = state.mis.out; const t = (MIS_KINDS.find((x) => x.k === o.kind) || {}).t || "";
          return exportBook("لم يُكمل - " + t + ".xlsx", misHeads(), misTable());
        } else if (act === "run-sib") { state.sib.stageMode = false; return runSiblings();
        } else if (act === "export-sib") {
          return exportBook("مقارنة الإخوة.xlsx", sibHeads(), state.sib.out.rows);
        } else if (act === "run-compare") { return runCompare();
        } else if (act === "export-cmp") {
          return exportBook("مقارنة المراحل.xlsx", cmpHeads(), cmpTable());
        } else if (act === "cols-all") { state.hiddenCols = new Set();
        } else if (act === "to-exam") {
          const { headers, rows } = feedData();
          if (!rows.length) return ui.toast("لا صفوف");
          await App.examSheet.useData(headers, rows);
          const tab = document.querySelector('[data-cv-tab="exam"]'); if (tab) tab.click();
          return;
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

    box.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.stu === "q") state.stu.q = e.target.value; });
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.stu === "q") { state.stu.q = e.target.value; runStudent(); } });
    box.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.tblQ;
      if (k == null) return;
      const st = tblSt(k); st.q = e.target.value; st.page = 0; tblRefresh(k);
    });
    box.addEventListener("click", async (e) => {
      const th = e.target.closest("[data-tbl-sort]");
      if (th) { const k = th.dataset.tbl, st = tblSt(k), i = Number(th.dataset.tblSort); if (st.sort === i) st.dir = -st.dir; else { st.sort = i; st.dir = 1; } st.page = 0; return tblRefresh(k); }
      const pg = e.target.closest("[data-tbl-page]");
      if (pg) { const k = pg.dataset.tblPage; tblSt(k).page += Number(pg.dataset.d); return tblRefresh(k); }
      const cp = e.target.closest("[data-tbl-copy]");
      if (cp) {
        const k = cp.dataset.tblCopy, d = tblData[k];
        const txt = [d.heads, ...tblRows(k)].map((r) => r.map((c) => showCell(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
        try { await navigator.clipboard.writeText(txt); ui.toast("نُسخ " + ui.fmt(tblRows(k).length) + " صفاً؛ الصقه في Excel"); } catch (err) { ui.toast("تعذّر النسخ؛ استعمل زر التنزيل"); }
      }
    });
    box.addEventListener("toggle", (e) => {
      const d = e.target;
      if (d && d.dataset && d.dataset.open) state.open[d.dataset.open] = d.open;
    }, true);

    box.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.dataset.set) {
        const k = t.dataset.set;
        if (k === "mask") { state.mask = t.checked; try { localStorage.setItem(MASK_KEY, state.mask ? "1" : ""); } catch (e) { /* خاص */ } }
        else if (k === "idle") { state.idleMin = Number(t.value); try { localStorage.setItem(IDLE_KEY, String(state.idleMin)); } catch (e) { /* خاص */ } return; }
        else if (k === "adminonly" && App.store && App.store.get) { App.store.get().centerAdminOnly = t.checked; if (App.store.save) App.store.save(); }
        render(); return;
      }
      if (t.dataset.ccNotify != null) {
        state.notify = t.checked; try { localStorage.setItem(NOTIFY_KEY, state.notify ? "1" : ""); } catch (e) { /* خاص */ }
        if (t.checked && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
        return;
      }
      if (t.dataset.bundle != null) {
        const a = state.bundle.pick, at = a.indexOf(t.value);
        if (t.checked && at < 0) a.push(t.value); else if (!t.checked && at >= 0) a.splice(at, 1);
        return;
      }
      if (t.dataset.grp) {
        const k = t.dataset.grp, c = state.grp;
        if (k === "tracks" || k === "stages") { const v = String(t.value), at = c[k].indexOf(v); if (t.checked && at < 0) c[k].push(v); else if (!t.checked && at >= 0) c[k].splice(at, 1); }
        else if (k === "status") c.status = t.value;
        render(); return;
      }
      if (t.dataset.dq) {
        const k = t.dataset.dq, c = state.dq;
        if (k === "tracks" || k === "stages") { const v = String(t.value), at = c[k].indexOf(v); if (t.checked && at < 0) c[k].push(v); else if (!t.checked && at >= 0) c[k].splice(at, 1); }
        else if (k === "status") c.status = t.value;
        else if (k.startsWith("chk:")) c.checks[k.slice(4)] = t.checked;
        render(); return;
      }
      if (t.dataset.mis) {
        const k = t.dataset.mis, c = state.mis;
        if (k === "msg") { c.msg = t.value; try { localStorage.setItem("tamkeen-admin:cc-msg", t.value); } catch (e) { /* خاص */ } return; }
        if (k === "kind") c.kind = t.value;
        else if (k === "verify") c.verify = t.checked;
        else if (k === "status") c.status = t.value;
        else { const a = c[k], v = String(t.value), at = a.indexOf(v); if (t.checked && at < 0) a.push(v); else if (!t.checked && at >= 0) a.splice(at, 1); }
        render(); return;
      }
      if (t.dataset.sib) {
        const k = t.dataset.sib, c = state.sib;
        if (k === "tracks" || k === "cmpStages" || k === "stages") { const v = String(t.value), at = c[k].indexOf(v); if (t.checked && at < 0) c[k].push(v); else if (!t.checked && at >= 0) c[k].splice(at, 1); }
        else if (k === "baseStage") { c.baseStage = t.value; c.cmpStages = c.cmpStages.filter((x) => x !== t.value); }
        else if (k === "status") c.status = t.value;
        else c[k] = t.checked;
        render(); return;
      }
      if (t.dataset.cmp) {
        const k = t.dataset.cmp, c = state.cmp;
        if (k === "tracks") { const v = String(t.value), at = c.tracks.indexOf(v); if (t.checked && at < 0) c.tracks.push(v); else if (!t.checked && at >= 0) c.tracks.splice(at, 1); }
        else if (k === "status") c.status = t.value;
        else if (k === "multi") c.multiOnly = t.checked;
        else if (k === "goal") { c.goal = t.value; state.resultError = ""; }
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

  App.centerCmd = { init, render, state, buildRegister, toOption, execute: executeCommand, localIntent, expand: expandResult, fmtSheet };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
