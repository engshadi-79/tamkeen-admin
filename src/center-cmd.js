/* واجهة الوكيل المحلي. يتولى tools/ksach-agent-server.js تشغيل Edge وربط الأوامر
   المسموحة بصفحة النظام المفتوحة في جلسة المستخدم. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const core = () => App.converterCore;
  const SCHEMA = () => App.centerSchema;
  /* الأدوات التي لا تعتمد على حالة الصفحة في center-util.js (وتُختبر في Node: tools/test-center-util.js) */
  const { clean, digits, cellStr, phoneNorm, lsGet, lsSet, maskCell, verNum, verLess, waIntl, waParts: waPartsOf, fmtSheet, splitStudentCell, splitGroupCell, expandResult, pickBase, diffRows, compareLatest, rankCompliance, weeklyDue } = App.ccUtil;
  const norm = (v) => core().normalizeHeader(clean(v)).replace(/^مسار\s*/, "");

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
    dq: { tracks: [], stages: [], status: "active", checks: { dupId: true, badId: true, noPhone: true, noGroup: true, shortName: true, dupName: true, dupPhone: false, twoGroups: true }, out: null, rows: null, diff: null },
    mask: false, idleMin: 20, lastAct: Date.now(), extLatest: "", errors: [],
    grp: { tracks: [], stages: [], status: "active", out: null, comp: null },
    imp: { respThr: 50, from: "2026-09-01", to: "", extra: "", track: "", stage: "", tracks: [], stages: [], cmpWith: "", hideZero: true, known: [], page: "impact", pages: ["impact"], outs: {}, course: "", srv: {}, out: null },   // إحصاءات قياس الأثر
    stu: { q: "", out: null, pick: null },
    gaps: { tracks: [], stages: [], status: "active", fields: null, out: null },
    wr: { op: "stu", text: "", status: "withdrawn", group: "", appStatus: "accepted", appTrack: "", appFilter: "submitted", apps: null, onlyEmpty: true, edit: null, editFile: "", out: null },
    enrich: null, enrichErr: "", enrichAuto: (() => { try { return localStorage.getItem("tamkeen:cc-enrich-auto") !== "0"; } catch (e) { return true; } })(),
    monthly: { tracks: [], stages: [], status: "", month: (new Date().toISOString().slice(0, 7)), mis: true, sig: false, out: null },
    pledge: { tracks: [], stages: [], status: "graduated", students: null, source: "", opts: null, fit: 0 },
    img: { files: [], fast: false, tables: null, reading: false, prog: "", failed: [], took: "" },
    grad: { from: "", to: "", maxAbs: 3, minRate: 75, countExcused: false, requireEval: false, out: null },
    morning: { mis: true },
    xl: { tracks: [], stages: [], status: "", name: "", sheets: [], sheet: 0, map: {}, reg: null, out: null },
    sig: { tracks: [], stages: [], status: "", files: [], batch: (() => { try { return Number(localStorage.getItem("tamkeen:sig-batch")) || 3; } catch (e) { return 3; } })(), fast: (() => { try { return localStorage.getItem("tamkeen:sig-fast") === "1"; } catch (e) { return false; } })(), rows: null, reg: null, regScope: null, regAt: "", manual: {}, lookups: {}, fileKeys: [], done: [], savedAt: "", reading: false, prog: "", failed: [], titles: [] },
    att: { alwaysToday: false, from: "", to: "", thr: 3, excused: false, max: 80, tracks: [], stages: [], out: null },   // الحضور والغياب
    bundle: { open: false, pick: [], msg: "" },
    wa: { contact: "", phone: "", breakdown: true, names: true, texts: {}, dirty: {}, part: {}, cc: "970" }, contacts: [],
    groups: [], gopen: "", wide: null, wideOk: false, wideLimit: 0, saved: [], runLog: [], notify: false, stopping: false, _wasBusy: false, _runStart: 0, _runMode: "",
    mode: "report",      // report: تقرير جاهز | ask: اكتب طلبك
    open: { adv: false, cols: false, forms: true, remind: false, log: false, snap: false, sec: false, errs: false, wa: false }, // حالة الأقسام القابلة للطي
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
  /* قوائم التصفية المتقدمة مأخوذة من لقطة نموذج «إضافة طالب» وقد تنقصها قيم موجودة فعلاً في بيانات الطلاب (نظام المركز يتغيّر).
     فتُضاف إليها القيم الفعلية التي وُجدت في البيانات المحمّلة أو في النتيجة الحالية، بقيمة «~النص». */
  function extraSeen(f) {
    const have = new Set((f.options || []).map((o) => norm(o.t))), seen = new Map(), key = norm(f.label);
    const take = (heads, rows) => { const i = (heads || []).findIndex((h) => norm(h) === key); if (i < 0) return; (rows || []).forEach((r) => { const t = clean(r.cells ? r.cells[i] : r[i]); if (t && !have.has(norm(t)) && !seen.has(norm(t))) seen.set(norm(t), t); }); };
    ((state.cache && state.cache.items) || []).forEach((it) => take(it.heads, it.rows));
    ((state.results && state.results.results) || []).filter((r) => r && r.type === "list").forEach((r) => take(r.heads, r.rows));
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ar"));
  }
  const extraOptText = (f, v) => { const s = String(v); if (s.startsWith("~")) return s.slice(1); const o = (f.options || []).find((x) => String(x.v) === s); return o ? o.t : ""; };
  function applyExtras(r) {
    const act = extraActive();
    if (!act.length || !r || r.type !== "list") return r;
    let rows = r.rows;
    for (const [name, v] of act) {
      const f = extraFields().find((x) => x.name === name);
      const oT = f ? extraOptText(f, v) : "";
      if (!f || !oT) continue;
      const o = { t: oT };
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
    const ex = extraActive().map(([k, v]) => { const f = extraFields().find((x) => x.name === k), t = f ? extraOptText(f, v) : ""; return f && t ? f.label + ": " + t : ""; }).filter(Boolean).join(" · ");
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
          <div class="cc-three">${extraFields().map((f) => `<label class="cc-field"><span>${esc(f.label)}</span><select data-sel="x:${esc(f.name)}"><option value="">الكل</option>${f.options.filter((o) => o.v !== "").map((o) => `<option value="${esc(o.v)}" ${String((s.extra || {})[f.name]) === String(o.v) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}${extraSeen(f).map((t) => `<option value="${esc("~" + t)}" ${String((s.extra || {})[f.name]) === "~" + t ? "selected" : ""}>${esc(t)} (من البيانات)</option>`).join("")}</select></label>`).join("")}</div>
          ${extraFields().some((f) => extraSeen(f).length) ? `<p class="cc-note">القيم المكتوب بجانبها «(من البيانات)» ليست في قائمة نموذج النظام المحفوظة لدينا لكنها موجودة فعلاً عند طلابك، فأُضيفت للتصفية.</p>` : ""}
        </details>
        <div class="cc-opts">
          <div class="cc-opt">${chk("details", "1", "كل بيانات الطالب (الميلاد، العنوان…) — أبطأ، حتى 400 طالب لكل أمر", s.details)}</div>
          <div class="cc-opt cc-cache">${state.cache
            ? `<span class="cc-badge ok">⚡ محمّل</span><span class="cc-note">${ui.fmt(cacheRows)} طالباً${state.cache.details ? " ببياناتهم الكاملة" : ""} · ${esc(state.cache.at.toLocaleTimeString("ar"))} — التقارير فورية</span><button type="button" class="cc-link" data-cc="preload" ${state.busy ? "disabled" : ""}>تحديث</button><button type="button" class="cc-link" data-cc="drop-cache">مسح</button>`
            : `<button type="button" class="btn secondary small" data-cc="preload" ${state.busy ? "disabled" : ""}>⚡ حمّل كل البيانات مرة واحدة</button><span class="cc-note">اختياري — تُحفظ في هذه الصفحة فقط فتصير التقارير فورية.</span>`}</div>
        </div>
        ${enrichCard()}
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
    if (p.kind === "write") {
      const lc = (r) => (r.state === "do" ? (r.from ? esc(r.from) + " ← " : "") + "<b>" + esc(r.to) + "</b>" : r.state === "same" ? "لا تغيير" : "لن يُنفَّذ");
      return `<section class="cc-card cc-plan cc-plan-danger"><header class="cc-card-h"><h3>معاينة قبل الكتابة في نظام المركز: ${esc(p.title || "")}</h3>
      <p>سيُنفَّذ <b>${ui.fmt(p.todo)}</b> · لا تغيير ${ui.fmt(p.same)} · لن يُنفَّذ ${ui.fmt(p.invalid)} — من ${ui.fmt(p.total)}. <b>لا يُكتب شيء قبل موافقتك.</b></p></header>
      <div class="cc-card-b"><div class="cc-scroll"><table class="cc-table"><thead><tr><th>الطالب</th><th>الرقم</th><th>قبل ← بعد</th><th>ملاحظة</th></tr></thead><tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.nid)}</td><td>${lc(r)}</td><td>${esc(r.why || "")}</td></tr>`).join("")}</tbody></table></div></div>
      <footer class="cc-actions"><div class="cc-sum"></div><div class="cc-act"><button type="button" class="cc-link" data-cc="plan-no">إلغاء</button><button type="button" class="btn danger" data-cc="plan-ok" ${p.todo ? "" : "disabled"}>نفّذ في النظام (${ui.fmt(p.todo)})</button></div></footer></section>`;
    }
    if (p.kind === "cancel" && p.undo) {
      const todo = (p.cancel || 0);
      const lc = (r) => (r.state === "cancel" ? "سيُعاد طلبه إلى «" + (r.to || "حالته السابقة") + "»" : r.state === "already" ? "على حالته السابقة أصلاً" : "لن يُنفَّذ");
      return `<section class="cc-card cc-plan cc-plan-danger"><header class="cc-card-h"><h3>معاينة قبل الكتابة في نظام المركز: التراجع عن الإلغاء</h3>
      <p>سيُعاد <b>${ui.fmt(p.cancel)}</b> طلباً إلى حالته السابقة · على حالته أصلاً ${ui.fmt(p.already)} · لن يُنفَّذ ${ui.fmt(p.invalid)} — من ${ui.fmt(p.total)}. لا يُعاد أحد إلى مجموعته تلقائياً. <b>لا يُكتب شيء قبل موافقتك.</b></p></header>
      <div class="cc-card-b"><div class="cc-scroll"><table class="cc-table"><tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.nid)}</td><td>${esc(lc(r))}${r.why ? " — " + esc(r.why) : ""}</td></tr>`).join("")}</tbody></table></div></div>
      <footer class="cc-actions"><div class="cc-sum"></div><div class="cc-act"><button type="button" class="cc-link" data-cc="plan-no">إلغاء</button><button type="button" class="btn danger" data-cc="plan-ok" ${todo ? "" : "disabled"}>نفّذ التراجع في النظام (${ui.fmt(todo)})</button></div></footer></section>`;
    }
    if (p.kind === "cancel") {
      const LC = { cancel: "سيُغيَّر طلبه إلى «ملغي»" + (p.removeFromGroup ? " ثم يُخرج من مجموعته" : ""), already: "طلبه ملغي أصلاً" + (p.removeFromGroup ? " — يُخرج من مجموعته إن بقي" : ""), invalid: "لن يُنفَّذ" };
      const todo = (p.cancel || 0) + (p.already || 0);
      return `<section class="cc-card cc-plan cc-plan-danger"><header class="cc-card-h"><h3>معاينة قبل الكتابة في نظام المركز: إلغاء طلبات${p.removeFromGroup ? " وإخراج من المجموعات" : ""}</h3>
      <p>سيُلغى <b>${ui.fmt(p.cancel)}</b> · ملغي أصلاً ${ui.fmt(p.already)} · لن يُنفَّذ ${ui.fmt(p.invalid)} — من ${ui.fmt(p.total)}. <b>لا يُكتب شيء قبل موافقتك.</b></p></header>
      <div class="cc-card-b"><div class="cc-scroll"><table class="cc-table"><tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.nid)}</td><td>${esc(LC[r.state] || r.state)}${r.why ? " — " + esc(r.why) : ""}</td></tr>`).join("")}</tbody></table></div></div>
      <footer class="cc-actions"><div class="cc-sum"></div><div class="cc-act"><button type="button" class="cc-link" data-cc="plan-no">إلغاء</button><button type="button" class="btn danger" data-cc="plan-ok" ${todo ? "" : "disabled"}>نفّذ في النظام (${ui.fmt(todo)})</button></div></footer></section>`;
    }
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
  function tblRows(k) {
    const d = tblData[k], st = tblSt(k);
    let rows = d.rows;
    if (d.tc >= 0 && st.track && d.tracks.includes(st.track)) rows = rows.filter((r) => cellStr(r[d.tc]).trim() === st.track);
    const q = normName(st.q);
    if (q) rows = rows.filter((r) => r.some((c) => normName(cellStr(c)).includes(q)));
    if (st.sort >= 0) rows = rows.slice().sort((a, b) => st.dir * cellStr(a[st.sort]).localeCompare(cellStr(b[st.sort]), "ar", { numeric: true }));
    return rows;
  }
  /* قيمة نسبة (٪) في عمود «نسبة الاستجابة» دون عتبة التنبيه: تُلوَّن الخلية وتُعدّ في التنبيه أعلى النتيجة */
  const pctOf = (v) => { const m = String(v == null ? "" : v).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٫/g, ".").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const lowCell = (head, v) => /نسبة الاستجابة/.test(String(head || "")) && String(v || "").trim() !== "" && pctOf(v) < Number(state.imp.respThr || 0);
  function tblBody(k) {
    const d = tblData[k], st = tblSt(k);
    const rows = tblRows(k);
    const pages = Math.max(1, Math.ceil(rows.length / TBL_SIZE));
    st.page = Math.max(0, Math.min(st.page, pages - 1));
    const part = rows.slice(st.page * TBL_SIZE, (st.page + 1) * TBL_SIZE);
    const pager = pages > 1 ? `<div class="cc-pager"><button type="button" class="cc-link" data-tbl-page="${esc(k)}" data-d="-1" ${st.page === 0 ? "disabled" : ""}>السابق</button><span>صفحة ${ui.fmt(st.page + 1)} من ${ui.fmt(pages)}</span><button type="button" class="cc-link" data-tbl-page="${esc(k)}" data-d="1" ${st.page >= pages - 1 ? "disabled" : ""}>التالي</button></div>` : "";
    const sk = d.sel != null, set = sk ? selOf(k) : null;
    return `<div class="cc-scroll"><table class="cc-table"><thead><tr>${sk ? `<th class="cc-selcol"><input type="checkbox" data-tbl-all="${esc(k)}" title="حدّد كل المعروض (بعد البحث)" aria-label="حدّد الكل"></th>` : ""}${d.heads.map((h, i) => `<th data-tbl-sort="${i}" data-tbl="${esc(k)}" class="cc-sortable ${st.sort === i ? (st.dir > 0 ? "asc" : "desc") : ""}" title="اضغط للفرز">${esc(h)}</th>`).join("")}</tr></thead><tbody>${part.map((r) => `<tr>${sk ? `<td class="cc-selcol"><input type="checkbox" data-tbl-sel="${esc(k)}" value="${esc(cellStr(r[d.sel]))}" ${set.has(cellStr(r[d.sel])) ? "checked" : ""} aria-label="تحديد"></td>` : ""}${r.map((c, ci) => `<td${lowCell(d.heads[ci], c) ? ' class="cc-low" title="دون العتبة"' : ""}>${esc(showCell(c))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${d.heads.length + (sk ? 1 : 0)}" class="cc-empty">لا نتائج مطابقة للبحث</td></tr>`}</tbody></table></div>${pager}`;
  }
  /* التحديد في الجداول: state.tblSel[k] = Set من قيم عمود المفتاح */
  const selOf = (k) => { state.tblSel = state.tblSel || {}; return state.tblSel[k] || (state.tblSel[k] = new Set()); };
  function selSync(k) {
    const n = selOf(k).size, box = $("cc-body"); if (!box) return;
    box.querySelectorAll(`[data-selcount="${CSS.escape(k)}"]`).forEach((e) => { e.textContent = ui.fmt(n); });
    box.querySelectorAll(`[data-selbtn="${CSS.escape(k)}"]`).forEach((e) => { e.disabled = !n || state.busy; });
  }
  /* عمود المسار يُكتشف من عنوانه؛ تظهر القائمة حين يكون في الجدول أكثر من مسار */
  const TRACK_HEAD = /^(المسار|المسار \/ الدورة|المسار · المرحلة|المسار والمرحلة|المسار الحالي)$/;
  function dataTable(k, heads, rows, opts) {
    const tc = opts && opts.track === false ? -1 : heads.findIndex((h) => TRACK_HEAD.test(String(h || "").trim()));
    const tracks = tc >= 0 ? [...new Set(rows.map((r) => cellStr(r[tc]).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")) : [];
    const useT = tracks.length > 1 && tracks.length <= 40;
    tblData[k] = { heads, rows, sel: opts && opts.sel != null ? opts.sel : null, tc: useT ? tc : -1, tracks: useT ? tracks : [] };
    const st = tblSt(k);
    const tsel = useT ? `<select class="cc-tbl-track" data-tbl-track="${esc(k)}" aria-label="المسار"><option value="">كل المسارات (${ui.fmt(rows.length)})</option>${tracks.map((t) => `<option value="${esc(t)}" ${st.track === t ? "selected" : ""}>${esc(t)} (${ui.fmt(rows.filter((r) => cellStr(r[tc]).trim() === t).length)})</option>`).join("")}</select>` : "";
    return `<div class="cc-tbl" data-tblbox="${esc(k)}"><div class="cc-tbl-bar">${tsel}<input type="search" class="cc-tbl-q" data-tbl-q="${esc(k)}" placeholder="بحث في الجدول…" value="${esc(st.q)}"><span class="cc-tbl-n" data-tbl-n>${ui.fmt(tblRows(k).length)} من ${ui.fmt(rows.length)}</span><button type="button" class="cc-link" data-tbl-copy="${esc(k)}">نسخ للحافظة</button></div><div class="cc-tbl-body">${tblBody(k)}</div></div>`;
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
    const head = lists.length ? `<div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(total)}</b> صفاً</span><span class="cc-stat"><b>${ui.fmt(lists.length)}</b> ${lists.length === 1 ? "جدول" : "جداول"}</span>${lists.length > 1 ? '<button type="button" class="btn secondary small" data-cc="export-all" title="ملف Excel لكل مسار، مجمّعة في ملف مضغوط واحد">تنزيل الكل (ملف Excel لكل مسار في ملف مضغوط)</button>' : ""}</div>` : "";
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
    const enrN = lists.reduce((a, r) => a + (r.enriched || 0), 0);
    return head + (enrN ? `<p class="cc-alert ok" role="status">✓ أُكملت <b>${ui.fmt(enrN)}</b> خلية فارغة من بيانات المتقدم (ملف التصدير: ${esc(state.enrich ? state.enrich.name : "")}).</p>` : "") + (lists.length ? gapNote(lists) : "") + (tools ? `<div class="cc-tools">${tools}</div>` : "") + body;
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
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-cmp">تنزيل Excel</button>' : ""}<button type="button" class="btn secondary small" data-cc="print-cmp" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF على الترويسة</button><button type="button" class="btn secondary small" data-cc="word-cmp">Word</button></div>
      <div class="cc-tools"><div class="cc-res"><header class="cc-res-h"><h4>التقاطع بين المراحل</h4></header>
        <div class="cc-stats">${o.pairs.map((x) => `<span class="cc-stat"><b>${ui.fmt(x.n)}</b> في ${esc(x.a.t)} و${esc(x.b.t)}</span>`).join("")}
          ${Object.keys(o.dist).sort().map((k) => `<span class="cc-stat"><b>${ui.fmt(o.dist[k])}</b> في ${k === "1" ? "مرحلة واحدة" : ui.fmt(k) + " مراحل"}</span>`).join("")}</div></div></div>
      ${waCard("compare")}
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
      if (state.cache && !c.status && !state.forceFresh) { lists = state.cache.items.filter((it) => tracks.some((o) => String(o.v) === it.trackId)).map((it) => Object.assign({}, it, { rows: grpRows(it.heads, it.rows) })); runStats.cached += lists.length; }
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
        ${o.rows.length ? '<button type="button" class="btn secondary small" data-cc="export-sib">تنزيل Excel</button>' : ""}<button type="button" class="btn secondary small" data-cc="print-sib" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF على الترويسة</button><button type="button" class="btn secondary small" data-cc="word-sib">Word</button></div>
      ${waCard("siblings")}
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

  /* التقرير الشامل: الاستبيانات الثلاثة من تقرير النظام + التعهد بالحساب، مدموجة في صف لكل طالب ينقصه شيء.
     تُرجع أيضاً students (كل طلاب النطاق) لمن يحتاج المقام، كترتيب الالتزام. */
  async function fetchAllMissing(c, trackIds, statusOk) {
    let rows = [], note = "", extra = {};
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
    return { rows, note, extra, students: pl.students };
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
        const r = await fetchAllMissing(c, trackIds, statusOk); rows = r.rows; note += r.note; extra = r.extra;
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
      c.out.diff = misDiffAndSave(c, rows);
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }

  /* ----- مقارنة مع تشغيل سابق: لقطات محلية بالمتصفح للناقصين (الاسم والمفتاح فقط) لكل نوع ونطاق ----- */
  const MISNAP_KEY = "tamkeen-admin:cc-missnap", MISNAP_KEEP = 12, DAY = 86400000;
  const misScopeKey = (c) => [c.kind, c.tracks.slice().sort().join(","), c.stages.slice().sort().join(","), c.status].join("|");
  function misDiffAndSave(c, rows) {
    const all = lsGet(MISNAP_KEY, {}), key = misScopeKey(c), list = Array.isArray(all[key]) ? all[key] : [];
    const now = Date.now();
    const snapRows = rows.map((x) => [missKey(x), x.name, x.track]);
    const base = pickBase(list, now);
    const diff = base ? Object.assign({ at: base.e.at }, diffRows(base.e.rows, snapRows)) : null;
    /* نحتفظ بلقطة جديدة؛ وإن كانت الأخيرة عمرها أقل من ساعة نستبدلها حتى لا تتراكم */
    const kept = list.filter((e) => now - Date.parse(e.at) >= 3600000);
    kept.push({ at: new Date(now).toISOString(), rows: snapRows }); all[key] = kept.slice(-MISNAP_KEEP);
    lsSet(MISNAP_KEY, all);
    return diff;
  }
  const diffDate = (iso) => ui.formatDate(String(iso).slice(0, 10)) || String(iso).slice(0, 10);
  function diffStats(o) {
    const d = o.diff;
    if (!d) return '<span class="cc-stat"><small>لا مقارنة بعد: هذا أول استخراج لهذا النطاق، وتظهر المقارنة في المرة القادمة.</small></span>';
    const list = (arr) => arr.length ? `<details class="cc-adv"><summary><span>${ui.fmt(arr.length)} طالباً</span></summary><div class="cc-note">${arr.slice(0, 200).map((x) => esc(x.name) + (x.track ? " — " + esc(x.track) : "")).join("<br>")}</div></details>` : "";
    return `<span class="cc-stat ok"><b>${ui.fmt(d.done.length)}</b> أكملوا منذ ${esc(diffDate(d.at))}</span><span class="cc-stat ${d.added.length ? "bad" : ""}"><b>${ui.fmt(d.added.length)}</b> نقص جديد</span><span class="cc-stat"><small>كان ${ui.fmt(d.before)} فأصبح ${ui.fmt(d.now)}</small></span>${list(d.done) ? `<div class="cc-wide">أكملوا: ${list(d.done)}</div>` : ""}`;
  }

  /* ----- ملف التذكير: اسم، جوال، رسالة جاهزة. لا شيء يُرسَل من هنا ----- */
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
        <div class="cc-act"><button type="button" class="btn secondary" data-cc="manager-print" ${state.busy ? "disabled" : ""} title="يعدّ موجزاً من النتيجة الظاهرة (أو يشغّل الشامل إن لم تكن هناك نتيجة) ويطبعه على ترويسة المركز">تقرير المدير ← طباعة / PDF</button><button type="button" class="btn secondary" data-cc="manager-word" ${state.busy ? "disabled" : ""} title="موجز Word على ترويسة المركز من النتيجة الظاهرة">Word</button><button type="button" class="btn navy" data-cc="run-mis" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ الاستخراج…" : "استخرج التقرير"}</button></div></footer></section>`;
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
        ${diffStats(o)}
        ${o.kind === "all" || o.kind === "risk" ? SURVEY_KINDS.concat("pledge").map((k) => `<span class="cc-stat"><b>${ui.fmt(o.extra.counts[k])}</b> ناقصهم ${esc(KIND_SHORT[k])}</span>`).join("") : ""}
        ${o.kind === "risk" ? `<span class="cc-stat"><b>${ui.fmt(o.extra.counts.noGroup)}</b> بلا مجموعة</span><span class="cc-stat"><b>${ui.fmt(o.extra.counts.noPhone)}</b> جوال غير صالح</span>` : ""}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="print-summary" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF موجز المدير</button><button type="button" class="btn secondary small" data-cc="word-summary" title="ملف Word على ترويسة المركز الرسمية">Word على الترويسة</button>' : ""}
        ${o.kind !== "pledge" && o.kind !== "all" && o.kind !== "risk" && o.extra.reported != null ? `<span class="cc-stat"><b>${ui.fmt(o.extra.reported)}</b> عدّهم تقرير النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.excluded)}</b> استُبعدوا (لهم إرسال فعلي)</span><span class="cc-stat"><b>${ui.fmt(o.extra.allSubs || 0)}</b> إرسالاً قُرئ (${ui.fmt(o.extra.submissions || 0)} من هذا النوع)</span>${o.extra.withOther ? `<span class="cc-stat"><b>${ui.fmt(o.extra.withOther)}</b> منهم لهم إرسال من نوع آخر</span>` : ""}` : ""}
        ${o.kind === "pledge" ? `<span class="cc-stat"><b>${ui.fmt(o.extra.targets)}</b> طالباً في النظام</span><span class="cc-stat ok"><b>${ui.fmt(o.extra.pledged)}</b> وقّعوا</span>` : ""}
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-mis">تنزيل Excel</button>' : ""}</div>
      ${o.note ? `<p class="cc-alert warn">${esc(o.note)}</p>` : ""}
      ${rows.length ? remindCard() : ""}
      ${rows.length ? waCard("missing") : ""}
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
  const CFG = { attend: "att", impact: "imp", report: "sel", compare: "cmp", siblings: "sib", missing: "mis", dq: "dq", gaps: "gaps", groups: "grp" };
  const MODE_NAME = { attend: "الحضور والغياب", impact: "قياس الأثر", report: "تقرير جاهز", compare: "مقارنة المراحل", siblings: "مقارنة الإخوة", missing: "استبيانات وتعهدات", dq: "فحص البيانات", groups: "المجموعات والمدربون", student: "ملف الطالب", ask: "اكتب طلبك" };
  const RUN_BTN = { sign: "run-sig", xl: "run-xl", morning: "run-morning", grad: "run-grad", pledge: "run-pledge", monthly: "run-monthly", gaps: "run-gaps", attend: "run-att", impact: "run-imp", report: "run-selection", compare: "run-compare", siblings: "run-sib", missing: "run-mis", dq: "run-dq", groups: "run-grp" };
  /* نسخة من إعدادات التبويب بلا نتائجه ولا بياناته */
  const cfgOf = (mode) => JSON.parse(JSON.stringify(state[CFG[mode]], (key, v) => (key === "out" || key === "rows" || key === "msg" || key === "diff" ? undefined : v)));
  function applyCfg(mode, cfg) {
    const k = CFG[mode];
    state[k] = Object.assign({}, state[k], cfg, { out: null });
    if (k === "att" && state.att.alwaysToday) state.att.from = state.att.to = ui.todayISO();   // تقرير يومي محفوظ: يقرأ اليوم لا تاريخ الحفظ
    if (k === "dq") { state.dq.rows = null; state.dq.diff = null; }
  }
  function savedBar(mode) {
    if (!CFG[mode]) return "";
    const mine = state.saved.filter((x) => x.mode === mode);
    return `<div class="cc-saved"><span class="cc-saved-t">تقاريري المحفوظة:</span>${mine.map((x) => `<span class="cc-sv"><button type="button" class="cc-sv-n" data-cc="sv-load" data-id="${x.id}" title="تحميل هذا الاختيار">${esc(x.name)}</button><button type="button" class="cc-sv-b" data-cc="sv-run" data-id="${x.id}" title="تحميل وتنفيذ" aria-label="تنفيذ">▶</button><button type="button" class="cc-sv-b" data-cc="sv-remind" data-id="${x.id}" title="${x.every ? "يُذكّرك كل " + x.every + " يوماً (اضغط للتغيير)" : "ذكّرني بتشغيله دورياً"}" aria-label="تذكير">${x.every ? "⏰" + x.every : "⏰"}</button><button type="button" class="cc-sv-b" data-cc="sv-del" data-id="${x.id}" title="حذف" aria-label="حذف">×</button></span>`).join("") || '<span class="cc-note">لا شيء بعد</span>'}<button type="button" class="cc-link" data-cc="sv-save">＋ احفظ هذا الاختيار</button>${state.saved.length > 1 ? '<button type="button" class="cc-link" data-cc="bundle-toggle">📦 حزمة تقارير</button>' : ""}</div>
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
    if (mode === "attend") { const o = state.att.out; return o ? o.students.length + " طالباً من " + o.sessions + " جلسة" : ""; }
    if (mode === "impact") { const o = state.imp.out; return o ? (o.tables || []).length + " جدولاً" : ""; }
    if (mode === "student") { const o = state.stu.out; return o ? "ملف طالب" : ""; }
    return "";
  }
  /* سجل بلا بيانات شخصية: التبويب والزمن والعدد فقط */
  function logRun(mode, ms) {
    const e = { at: new Date().toISOString(), mode, ms, info: runSummary(mode), ok: !state.resultError, by: (curUser() || {}).name || "", sent: runStats.sent, cached: runStats.cached };
    state.runLog = [e].concat(state.runLog).slice(0, 40);
    lsSet(LOG_KEY, state.runLog);
    if (e.ok && (e.sent || e.cached)) ui.toast("اكتمل: " + (e.sent ? "قُرئ " + ui.fmt(e.sent) + " أمراً من نظام المركز" : "بلا قراءة من نظام المركز") + (e.cached ? (e.sent ? "، و" : "، ") + ui.fmt(e.cached) + " من الذاكرة" + (state.cache ? " (محمّلة منذ " + ui.fmt(Math.max(0, Math.round((Date.now() - state.cache.at.getTime()) / 60000))) + " دقيقة)" : "") : ""));
    if (e.ok && mode === "missing" && state.mis.out && (state.mis.out.kind === "all" || state.mis.out.kind === "risk")) markWeekly();
  }
  function notifyDone(mode, ms) {
    if (!state.notify || typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    try { new Notification("انتهى التنفيذ — " + (MODE_NAME[mode] || ""), { body: (runSummary(mode) || "اكتمل") + " · " + fmtElapsed(ms), tag: "cc-done" }); } catch (e) { /* غير مدعوم */ }
  }
  function logCard() {
    const rows = state.runLog.slice(0, 15);
    return `<details class="cc-help" data-open="log" ${state.open.log ? "open" : ""}><summary>سجل العمليات (${ui.fmt(state.runLog.length)})</summary>
      ${rows.length ? `<table class="cc-table"><thead><tr><th>الوقت</th><th>بواسطة</th><th>التبويب</th><th>النتيجة</th><th>المدة</th><th>أوامر القراءة</th></tr></thead><tbody>${rows.map((e) => `<tr><td>${esc(new Date(e.at).toLocaleString("ar"))}</td><td>${esc(e.by || "—")}</td><td>${esc(MODE_NAME[e.mode] || e.mode)}</td><td>${e.ok ? "" : "✗ "}${esc(e.info || "—")}</td><td>${esc(fmtElapsed(e.ms || 0))}</td><td>${e.sent == null ? "—" : ui.fmt(e.sent) + (e.cached ? ` <small>(+${ui.fmt(e.cached)} من الذاكرة)</small>` : "")}</td></tr>`).join("")}</tbody></table>
      <button type="button" class="cc-link" data-cc="clear-log">مسح السجل</button>` : '<p class="cc-note">لا عمليات مسجّلة بعد.</p>'}
      <p class="cc-note">«أوامر القراءة» = ما أُرسل إلى نظام المركز في ذلك التشغيل (قد يقرأ الأمر الواحد عدة صفحات)، وبين القوسين ما خُدم من الذاكرة. يُحفظ في هذا المتصفح فقط، ولا يحوي أسماء ولا أرقاماً شخصية.</p></details>`;
  }
  const stopSupported = () => { const n = String((App.centerAgent && App.centerAgent.version && App.centerAgent.version()) || "").split(".").map(Number); return n.length >= 2 && (n[0] > 1 || (n[0] === 1 && n[1] >= 4)); };

  /* ===== ما الجديد منذ آخر مرة: من لقطات الناقصين المحفوظة في المتصفح، بلا أي قراءة من النظام ===== */
  const agoDays = (iso) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? "اليوم" : d === 1 ? "أمس" : "قبل " + d + " أيام"; };
  function whatsNew() {
    const all = lsGet(MISNAP_KEY, {}), out = [];
    Object.keys(all).forEach((key) => {
      const list = all[key]; if (!Array.isArray(list) || !list.length) return;
      const [kind, tr, st, status] = key.split("|");
      const scope = [tr ? tr.split(",").map(trackShort).join("، ") : "كل المسارات", st ? st.split(",").map((k) => (STAGES.find((g) => g.k === k) || {}).t || k).join("، ") : "", status ? optLabel("status", status) : "كل الحالات"].filter(Boolean).join(" · ");
      const last = list[list.length - 1];
      out.push({ key, kind, tracks: tr ? tr.split(",") : [], stages: st ? st.split(",") : [], status: status || "", label: (MIS_KINDS.find((k) => k.k === kind) || {}).t || kind, scope, lastAt: last.at, now: last.rows.length, cmp: compareLatest(list) });
    });
    return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).slice(0, 8);
  }
  function newsCard() {
    const items = whatsNew(), dq = lsGet(SNAP_KEY, null);
    if (!items.length && !dq) return "";
    const changed = items.filter((x) => x.cmp && (x.cmp.done.length || x.cmp.added.length)).length;
    const open = !!state.open.news;                       // مغلقة دائماً حتى تفتحها بنفسك
    return `<details class="cc-adv cc-news" data-open="news" ${open ? "open" : ""}><summary><span>ما الجديد منذ آخر مرة</span><span class="cc-badge">${ui.fmt(items.length + (dq ? 1 : 0))}</span><small>${changed ? ui.fmt(changed) + " تقرير تغيّر" : "لا تغيّر بعد"}</small></summary>
      <div class="cc-news-list">${items.map((x) => `<div class="cc-news-row"><div class="cc-news-t"><b>${esc(x.label)}</b><span class="cc-note">${esc(x.scope)}</span></div>
        <div class="cc-news-v">${x.cmp ? `<span class="cc-stat ok"><b>${ui.fmt(x.cmp.done.length)}</b> أكملوا</span><span class="cc-stat ${x.cmp.added.length ? "bad" : ""}"><b>${ui.fmt(x.cmp.added.length)}</b> نقص جديد</span><span class="cc-note">كان ${ui.fmt(x.cmp.before)} وأصبح ${ui.fmt(x.cmp.now)} منذ ${esc(diffDate(x.cmp.baseAt))}</span>` : `<span class="cc-note">${ui.fmt(x.now)} ناقصاً في لقطة واحدة؛ المقارنة من التشغيل القادم</span>`}<span class="cc-note">آخر تشغيل ${esc(agoDays(x.lastAt))}</span></div>
        <button type="button" class="cc-link" data-cc="news-load" data-key="${esc(x.key)}">افتح هذا التقرير</button></div>`).join("")}
        ${dq ? `<div class="cc-news-row"><div class="cc-news-t"><b>فحص البيانات</b><span class="cc-note">آخر لقطة ${esc(agoDays(dq.at))} (${ui.fmt(dq.rows.length)} طالباً)</span></div><div class="cc-news-v"></div><button type="button" class="cc-link" data-cc="news-dq">افتح فحص البيانات</button></div>` : ""}</div>
      <p class="cc-note">تُحسب من اللقطات المحفوظة في هذا المتصفح، فلا تقرأ شيئاً من نظام المركز.</p></details>`;
  }
  /* ===== تنبيه قبل القراءة الواسعة: تقدير عدد أوامر القراءة قبل التنفيذ؛ فوق الحد يُطلب تأكيد (غير حاجب) ===== */
  const WIDE_LIMIT = 15;
  const RUN_ACTS = ["run-gaps", "run-monthly", "run-pledge", "run-grad", "run-morning", "run-xl", "run-sig", "run-att", "att-today", "load-groups", "run-imp", "imp-apply", "run-selection", "run-compare", "run-sib", "run-mis", "run-dq", "run-grp", "grp-compliance"];
  function estimateReads(act) {
    const T = (tracks) => (tracks && tracks.length ? tracks.length : trackOpts().length);
    const hasCache = !!state.cache;
    try {
      if (act === "run-selection") {
        const plan = buildSelection();
        if (hasCache && plan.every((x) => localList(x))) return 0;
        return plan.length;
      }
      if (act === "load-groups") return 1;
      if (act === "run-sig") return Math.max(1, sigCommands(true).length);
      if (act === "run-monthly") { const r = monthlyRange(state.monthly.month), d = r ? Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1) : 1; return 1 + Math.min(Number(state.att.max) || 80, d * 2) + (state.monthly.mis ? (estimateReads("run-mis") || 0) : 0); }
      if (act === "run-pledge") return Math.max(1, sigCommands(true, state.pledge).length);
      if (act === "run-grad") { const c = state.grad, d = Math.max(1, Math.round((Date.parse(c.to || ui.todayISO()) - Date.parse(c.from || ui.todayISO())) / 86400000) + 1); return 1 + Math.min(Number(state.att.max) || 80, d * 2) + (c.requireEval ? (estimateReads("run-mis") || 0) : 0); }
      if (act === "run-morning") return (estimateReads("att-today") || 0) + (state.morning.mis ? (estimateReads("run-mis") || 0) : 0);
      if (act === "run-xl") return Math.max(1, sigCommands(true, state.xl).length);
      if (act === "run-att" || act === "att-today") { const c = state.att, d = Math.max(1, Math.round((Date.parse(c.to || ui.todayISO()) - Date.parse(c.from || ui.todayISO())) / 86400000) + 1); return 1 + Math.min(Number(c.max) || 80, d * Math.max(1, (state.groups || []).length || (c.tracks.length || 5))); }
      if (act === "run-imp" || act === "imp-apply") { const c = state.imp, cv = impCourseVariants(c.known), tv = impTrackVariants(c.known); let n = 0; (c.pages.length ? c.pages : ["impact"]).forEach((pg) => { n += cv ? Math.max(1, cv.list.length) : pg === "questions" && tv ? Math.max(1, tv.list.length) : 1; }); return n + ((c.stages || []).length && !cv || c.pages.includes("questions") && !tv ? 1 : 0); }
      if (act === "run-compare") { if (hasCache) return 0; const c = state.cmp; return c.goal === "siblings" ? T(c.tracks) : courseOpts().filter((x) => !c.tracks.length || c.tracks.includes(x.track)).length; }
      if (act === "run-sib") { if (hasCache) return 0; const c = state.sib; return c.stageMode ? courseOpts().filter((x) => !c.tracks.length || c.tracks.includes(x.track)).length : T(c.tracks); }
      if (act === "run-dq") return hasCache ? 0 : T(state.dq.tracks);
      if (act === "run-gaps" && canExport()) { try { return gapsExportPlan().length; } catch (e) { return 1; } }
      if (act === "run-gaps") { const c = state.gaps; if (hasCache && state.cache.details && !c.status) return 0; const sk = (c.stages || []).length; return sk ? courseOpts().filter((x) => (c.stages || []).map((t) => stageK(t) || t).includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track))).length * 41 : T(c.tracks) * 201; }
      if (act === "run-grp") return hasCache ? 0 : T(state.grp.tracks);
      if (act === "run-mis" || act === "grp-compliance") {
        const c = act === "run-mis" ? state.mis : { kind: "all", tracks: state.grp.tracks, stages: STAGES.filter((x) => state.grp.stages.includes(x.t)).map((x) => x.k), verify: true };
        const t = T(c.tracks);
        const survey = c.stages.length ? courseOpts().filter((x) => c.stages.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track))).length : Math.max(1, c.tracks.length);
        const pledge = (hasCache ? 0 : t) + 1, verify = c.verify ? t : 0;
        if (c.kind === "all" || c.kind === "risk") return 3 * survey + pledge + verify;
        if (c.kind === "pledge") return pledge;
        return survey + verify;
      }
    } catch (e) { /* تقدير فقط: لا يمنع التنفيذ */ }
    return 0;
  }
  function wideBanner() {
    const w = state.wide;
    if (!w) return "";
    return `<div class="cc-alert warn cc-wide-warn" role="alert"><span>عملية واسعة: ستُنفَّذ نحو <b>${ui.fmt(w.n)}</b> أمر قراءة على نظام المركز. حدّد المسار أو المرحلة لتقليلها، أو حمّل البيانات مرة واحدة في «تقرير جاهز» فتُخدم التقارير التالية من الذاكرة.</span><span class="cc-row"><button type="button" class="btn secondary small" data-cc="wide-edit">حدّد النطاق</button><button type="button" class="btn navy small" data-cc="wide-go">تابع على أي حال</button></span></div>`;
  }

  /* ===== التذكير الأسبوعي بالتقرير الشامل ===== */
  const WEEKLY_KEY = "tamkeen-admin:cc-weekly", SNOOZE_KEY = "tamkeen-admin:cc-weekly-snooze";
  const markWeekly = () => { lsSet(WEEKLY_KEY, { at: new Date().toISOString() }); renderDash(); try { if (App.dashboard && App.dashboard.render) App.dashboard.render(); } catch (e) { /* اللوحة غير جاهزة */ } };
  const weeklyNow = () => weeklyDue(lsGet(WEEKLY_KEY, null), lsGet(SNOOZE_KEY, 0), Date.now());
  const weeklyText = (w) => (w.never ? "لم تشغّل التقرير الشامل الأسبوعي بعد." : "مرّت " + ui.fmt(w.days) + " أيام على آخر تقرير شامل.") + " حان موعد المتابعة.";
  function weeklyBanner() {
    const w = weeklyNow();
    if (!w.due || state.busy) return "";
    return `<div class="cc-alert warn cc-weekly" role="status"><span>${esc(weeklyText(w))}</span><span class="cc-row"><button type="button" class="btn navy small" data-cc="weekly-run">شغّل التقرير الشامل الآن</button><button type="button" class="cc-link" data-cc="weekly-snooze">ذكّرني بعد يومين</button></span></div>`;
  }
  function runWeekly() {
    state.mode = "missing"; state.adding = ""; state.proposal = null; state.mis.kind = "all"; state.mis.out = null;
    render();
    const rb = $("cc-body").querySelector('[data-cc="run-mis"]'); if (rb && !rb.disabled) rb.click();
  }
  /* تقارير محفوظة لها تذكير دوري (every أيام) ومرّت مدته منذ آخر تشغيل (ran) أو منذ حفظها */
  function savedDue() {
    const now = Date.now();
    return (state.saved || []).filter((x) => Number(x.every) > 0).map((x) => {
      const base = x.ran ? Date.parse(x.ran) : Number(x.id) || now;
      return { x, days: Math.floor((now - base) / 86400000), never: !x.ran };
    }).filter((d) => d.days >= Number(d.x.every));
  }
  function markRan(id) { const it = state.saved.find((x) => x.id === id); if (!it) return; it.ran = new Date().toISOString(); lsSet(SV_KEY, state.saved); renderDash(); }
  function runSavedById(id) {
    const it = state.saved.find((x) => x.id === id); if (!it) return ui.toast("التقرير المحفوظ غير موجود");
    markRan(id);
    state.mode = it.mode; state.adding = ""; state.proposal = null; applyCfg(it.mode, it.cfg);
    render();
    const rb = $("cc-body").querySelector('[data-cc="' + RUN_BTN[it.mode] + '"]'); if (rb && !rb.disabled) rb.click();
  }
  /* ===== اللوحة الرئيسية: تقاريري المحفوظة بنقرة + تذكير الأسبوع ===== */
  function renderDash() {
    const el = document.getElementById("dash-saved"); if (!el) return;
    let w = { due: false };
    try { w = weeklyNow(); } catch (e) { /* لا يضرّ */ }
    const saved = (state.saved || []).slice(-4).reverse(), due = savedDue();
    if (!centerAllowed() || (!saved.length && !w.due && !due.length)) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<div class="dash-section-head"><div><span class="dash-section-kicker">نظام المركز</span><h3>تقارير المركز</h3><p>تُشغَّل بنقرة، وتظهر النتيجة في «أوامر المركز»</p></div></div>
      ${due.map((d) => `<div class="dash-weekly"><span>«${esc(d.x.name)}»: ${d.never ? "لم يُشغَّل بعد" : "مرّت " + ui.fmt(d.days) + " أيام على آخر تشغيل"} (تذكير كل ${ui.fmt(d.x.every)} يوماً)</span><button type="button" class="dash-saved-btn" data-dash-saved="${esc(d.x.id)}">شغّله الآن</button></div>`).join("")}
      ${w.due ? `<div class="dash-weekly"><span>${esc(weeklyText(w))}</span><button type="button" class="dash-saved-btn" data-dash-weekly>شغّل التقرير الشامل</button></div>` : ""}
      ${saved.length ? `<div class="dash-saved-list">${saved.map((x) => `<button type="button" class="dash-saved-btn" data-dash-saved="${esc(x.id)}"><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span><span>${esc(x.name)}<small>${esc(MODE_NAME[x.mode] || "")}</small></span></button>`).join("")}</div>` : ""}`;
  }
  /* يفتح تبويب «أوامر المركز» في المحوّل ثم ينفّذ */
  function openCenterThen(fn) {
    location.hash = "#center";
    window.setTimeout(fn, 250);
  }

  /* ===== فحص البيانات: ملاحظات الجودة + مقارنة بلقطة سابقة ===== */
  const DQ_CHECKS = [["dupId", "هوية مكررة لطالبين مختلفين"], ["badId", "هوية ليست 9 أرقام"], ["noPhone", "جوال ناقص أو غير صالح"], ["noGroup", "بلا مجموعة"], ["shortName", "اسم أقل من رباعي"], ["dupName", "اسم مكرر بهويات مختلفة"], ["dupPhone", "جوال مشترك بين طلاب (قد يكونون إخوة)"], ["twoGroups", "طالب مسجَّل في أكثر من مجموعة"]];
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
      if (state.cache && !c.status && !state.forceFresh) { lists = state.cache.items.filter((it) => trackIds.includes(it.trackId)).map((it) => ({ heads: it.heads, rows: grpRows(it.heads, it.rows), tid: it.trackId })); runStats.cached += lists.length; }
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
      const uniq = new Map(), grpsBy = new Map();
      students.forEach((st) => { const k = st.stu || st.id + "|" + st.name; if (!uniq.has(k)) uniq.set(k, st); if (st.group) (grpsBy.get(k) || grpsBy.set(k, new Set()).get(k)).add(st.group); });
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
      if (c.checks.twoGroups) students.forEach((st) => { const g = grpsBy.get(st.stu || st.id + "|" + st.name); if (g && g.size > 1) push("twoGroups", st, "المجموعات: " + [...g].join("، ")); });
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
        ${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-dq">تنزيل Excel</button>' : ""}<button type="button" class="btn secondary small" data-cc="print-dq" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF على الترويسة</button><button type="button" class="btn secondary small" data-cc="word-dq">Word</button></div>
      ${waCard("dq")}
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
  const showCell = (v) => (state.mask ? maskCell(v) : cellStr(v));
  const curUser = () => { try { return (App.cloud && App.cloud.user && App.cloud.user()) || null; } catch (e) { return null; } };
  /* حصر التبويب بمدير النظام (إعداد مشترك يحفظه المدير) */
  const centerAllowed = () => { const st = (App.store && App.store.get && App.store.get()) || {}; const u = curUser(); return !st.centerAdminOnly || !u || !!u.admin; };
  const hasSensitive = () => !!(state.results || state.cmp.out || state.sib.out || state.mis.out || state.dq.out || state.dq.rows || state.gaps.out || state.enrich || state.cache || state.grp.out || state.stu.out || state.att.out);
  /* ===== حفظ نتائج الأدوات على هذا الجهاز (IndexedDB) =====
     آخر نتيجة لكل أداة تُحفظ وحدها، وتظهر عند فتح الصفحة بلا قراءة من النظام. الجلب الجديد بضغطتك فقط («نفّذ» أو «حدّث»)،
     ونتيجته تحلّ محل نتيجة تلك الأداة وحدها. الخمول يُخفيها من الشاشة ولا يحذفها؛ «مسح بيانات هذه الشاشة» يحذفها. */
  const SNAP_DB = "tamkeen-center", SNAP_ST = "snap", SNAP_K = "v1";
  const SNAP_FIELDS = [
    ["results", () => state.results, (v) => { state.results = v; }, "report"],
    ["labels", () => (state.results ? state.labels : null), (v) => { state.labels = v || []; }],
    ["att", () => state.att.out, (v) => { state.att.out = v; }, "attend"],
    ["mis", () => state.mis.out, (v) => { state.mis.out = v; }, "missing"],
    ["cmp", () => state.cmp.out, (v) => { state.cmp.out = v; }, "compare"],
    ["sib", () => state.sib.out, (v) => { state.sib.out = v; }, "siblings"],
    ["dq", () => state.dq.out, (v) => { state.dq.out = v; }, "dq"],
    ["dqRows", () => state.dq.rows, (v) => { state.dq.rows = v; }],
    ["grp", () => state.grp.out, (v) => { state.grp.out = v; }, "groups"],
    ["imp", () => state.imp.out, (v) => { state.imp.out = v; }, "impact"],
    ["impOuts", () => (state.imp.outs && Object.keys(state.imp.outs).length ? state.imp.outs : null), (v) => { state.imp.outs = v || {}; }],
    ["grad", () => state.grad.out, (v) => { state.grad.out = v; }, "grad"],
    ["xl", () => state.xl.out, (v) => { state.xl.out = v; }, "xl"],
    ["monthly", () => state.monthly.out, (v) => { state.monthly.out = v; }, "monthly"],
    ["gaps", () => state.gaps.out, (v) => { state.gaps.out = v; }, "gaps"],
    ["pledgeStu", () => state.pledge.students, (v) => { state.pledge.students = v; }, "pledge"],
    ["pledgeSrc", () => (state.pledge.students ? state.pledge.source : null), (v) => { state.pledge.source = v || ""; }],
    ["enrich", () => state.enrich, (v) => { state.enrich = v; }],
    ["cache", () => state.cache, (v) => { state.cache = v; }],
    ["stu", () => state.stu.out, (v) => { state.stu.out = v; }, "student"],
  ];
  let snapData = null, snapRefs = [], snapTimer = 0, snapReady = false;
  const idbOpen = () => new Promise((res, rej) => { try { const q = indexedDB.open(SNAP_DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(SNAP_ST); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); } catch (e) { rej(e); } });
  const idbDo = async (mode, fn) => { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction(SNAP_ST, mode), st = tx.objectStore(SNAP_ST); const q = fn(st); tx.oncomplete = () => { res(q && q.result); db.close(); }; tx.onerror = () => { rej(tx.error); db.close(); }; }); };
  const snapGet = () => idbDo("readonly", (st) => st.get(SNAP_K)).catch(() => null);
  const snapPut = (v) => idbDo("readwrite", (st) => st.put(v, SNAP_K));
  const snapClear = () => { snapData = { v: 1, at: {}, data: {} }; return idbDo("readwrite", (st) => st.delete(SNAP_K)).catch(() => {}); };
  const snapCur = () => SNAP_FIELDS.map((f) => f[1]());
  /* بعد كل عرض (والأداة ليست مشغولة): ما تغيّر من النتائج يُدمج في المحفوظ ويُكتب */
  function snapMaybeSave() {
    if (!snapReady || state.busy || state.snapPaused) return;
    const cur = snapCur();
    if (cur.every((v, i) => v === snapRefs[i])) return;
    snapRefs = cur;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      snapData = snapData || { v: 1, at: {}, data: {} };
      const now = new Date();
      SNAP_FIELDS.forEach(([k, get]) => { const v = get(); if (v != null) { if (snapData.data[k] !== v) snapData.at[k] = now; snapData.data[k] = v; } });
      snapData.savedAt = now;
      try { await snapPut(snapData); }
      catch (e) {   // حقل لا يُنسخ (نادراً): يُحذف ذلك الحقل وحده
        Object.keys(snapData.data).forEach((k) => { try { structuredClone(snapData.data[k]); } catch (e2) { delete snapData.data[k]; } });
        try { await snapPut(snapData); } catch (e3) { /* التخزين غير متاح */ }
      }
    }, 700);
  }
  /* استرجاع المحفوظ: لا يكتب فوق نتيجة في الذاكرة (onlyEmpty) */
  function snapApply(onlyEmpty) {
    if (!snapData || !snapData.data) return 0;
    let n = 0;
    SNAP_FIELDS.forEach(([k, get, set]) => { const v = snapData.data[k]; if (v != null && (!onlyEmpty || get() == null)) { set(v); n++; } });
    if (state.monthly.out && state.monthly.out.d && !state.monthly.out.doc && App.monthlyReport) state.monthly.out.doc = App.monthlyReport.build(state.monthly.out.d);
    snapRefs = snapCur();
    return n;
  }
  async function snapLoad() {
    const v = await snapGet();
    snapData = v && v.data ? v : { v: 1, at: {}, data: {} };
    const n = snapApply(true);
    snapReady = true;
    if (n) render();
  }
  /* للأداة الحالية: هل لها نتيجة محفوظة غير معروضة؟ (بعد الخمول) */
  const snapHiddenFor = (mode) => { const f = SNAP_FIELDS.find((x) => x[3] === mode || (mode === "morning" && x[0] === "att")); return f && snapData && snapData.data[f[0]] != null && f[1]() == null ? snapData.at[f[0]] || snapData.savedAt : null; };
  function wipeData(why) {
    state.results = null; state.cmp.out = null; state.sib.out = null; state.mis.out = null; state.dq.out = null; state.dq.rows = null; state.dq.diff = null; state.gaps.out = null; state.enrich = null;
    state.cache = null; state.grp.out = null; state.imp.out = null; state.imp.outs = {}; state.att.out = null; state.cancelLog = null; state.attHist = null; state.att.undoOut = null; state.stu.out = null; state.stu.pick = null; state.wa.texts = {}; state.wa.dirty = {};
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
      <div class="cc-row"><button type="button" class="cc-link danger" data-cc="wipe-now">مسح كل بيانات هذه الشاشة الآن (ومعها النتائج المحفوظة على هذا الجهاز)</button></div>
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
    if (!o) return null;
    if (!(o.extra && o.extra.targetsBy)) return singleSummaryBlocks(o);          // نتيجة من نوع واحد: لا إعادة جلب
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
  /* موجز من نتيجة نوع واحد (قبلي/بعدي/قياس أثر/تعهد): أعداد المتأخرين لكل مسار ومرحلة */
  function singleSummaryBlocks(o) {
    const by = new Map();
    o.rows.forEach((x) => { const k = (x.track || "—") + (x.stage ? " · " + x.stage : ""); by.set(k, (by.get(k) || 0) + 1); });
    const keys = [...by.keys()].sort((a, b) => a.localeCompare(b, "ar"));
    const total = o.rows.length, label = KIND_SHORT[o.kind] || "";
    const verb = o.kind === "pledge" ? "لم يوقّعوا" : "لم يعبّئوا";
    const scope = (state.mis.tracks.length ? state.mis.tracks.map(trackShort).join("، ") : "كل المسارات") + " · " + (optLabel("status", state.mis.status) || "كل الحالات");
    const out = [
      { kind: "title", text: "موجز متابعة الطلاب — " + (KIND_ITEM[o.kind] || "") },
      { kind: "meta", text: "التاريخ: " + (ui.formatDate(ui.todayISO()) || ui.todayISO()), sizePt: 12 },
      { kind: "para", text: "" },
      { kind: "bold", text: "نطاق الموجز: " + scope },
      { kind: "para", text: "" },
      { kind: "table", headers: ["المسار · المرحلة", "عدد الذين " + verb + " (" + label + ")"], widths: [0.62, 0.38], align: [null, "center"], rows: keys.map((k) => [k, ui.fmt(by.get(k))]).concat([["المجموع", ui.fmt(total)]]) },
      { kind: "para", text: "" },
    ];
    if (o.kind === "pledge" && o.extra && o.extra.targets != null) out.push({ kind: "para", text: "من أصل " + ui.fmt(o.extra.targets) + " طالباً في النظام، وقّع منهم " + ui.fmt(o.extra.pledged) + "." });
    out.push({ kind: "para", text: "لتقرير أشمل (الاستبيانات الثلاثة والتعهد معاً) اختر «تقرير شامل». مصدر البيانات: نظام المركز." });
    return out;
  }
  /* الترويسة الرسمية غير متاحة: صفحة طباعة بسيطة بديلة */
  function printSummary() {
    const list = summaryBlocks();
    if (!list) return ui.toast("نفّذ تقريراً أولاً");
    if (App.docRender && App.docRender.print) return App.docRender.print(list, "موجز متابعة الطلاب", false);
    const t = list.find((x) => x.kind === "table");
    printHtml("موجز متابعة الطلاب", `<h1>${esc(list[0].text)}</h1><table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  }
  async function wordSummary() {
    const list = summaryBlocks();
    if (!list) return ui.toast("نفّذ تقريراً أولاً");
    if (!(App.docRender && App.docRender.exportWord)) return ui.toast("محرك المستندات غير متاح");
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* يُحمَّل عند الحاجة */ }
    App.docRender.exportWord(list, "موجز متابعة الطلاب " + ui.todayISO());
  }

  /* ===== الترويسة الرسمية لبقية التقارير: فحص البيانات، المجموعات والمدربون (والالتزام)، مقارنة المراحل، الإخوة ===== */
  const lhDate = () => ({ kind: "meta", text: "التاريخ: " + (ui.formatDate(ui.todayISO()) || ui.todayISO()), sizePt: 12 });
  const lhScope = (c) => (c.tracks && c.tracks.length ? c.tracks.map(trackShort).join("، ") : "كل المسارات") + " · " + (optLabel("status", c.status) || "كل الحالات");
  const gap = () => ({ kind: "para", text: "" });
  function lhPrint(list, title) {
    if (!list) return ui.toast("نفّذ التقرير أولاً");
    if (App.docRender && App.docRender.print) return App.docRender.print(list, title, false);
    const t = list.find((x) => x.kind === "table");
    printHtml(title, `<h1>${esc(list[0].text)}</h1>` + (t ? `<table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""));
  }
  async function lhWord(list, base) {
    if (!list) return ui.toast("نفّذ التقرير أولاً");
    if (!(App.docRender && App.docRender.exportWord)) return ui.toast("محرك المستندات غير متاح");
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* يُحمَّل عند الحاجة */ }
    App.docRender.exportWord(list, base + " " + ui.todayISO());
  }
  /* بلا هويات ولا جوالات: التقرير الرسمي يُرسَل للإدارة، فالأسماء والمواقع تكفي */
  function dqBlocks() {
    const o = state.dq.out; if (!o) return null;
    const sum = DQ_CHECKS.filter(([k]) => o.byType[k]).map(([k, t]) => [t, ui.fmt(o.byType[k])]);
    const MAX = 60, shownIssues = o.issues.slice(0, MAX);
    const out = [{ kind: "title", text: "تقرير جودة بيانات الطلاب" }, lhDate(), gap(), { kind: "bold", text: "نطاق الفحص: " + lhScope(state.dq) }, { kind: "para", text: "فُحص " + ui.fmt(o.total) + " طالباً، وظهرت " + ui.fmt(o.issues.length) + " ملاحظة." }, gap()];
    if (sum.length) out.push({ kind: "table", headers: ["نوع الملاحظة", "العدد"], widths: [0.75, 0.25], align: [null, "center"], rows: sum.concat([["المجموع", ui.fmt(o.issues.length)]]) }, gap());
    if (shownIssues.length) {
      out.push({ kind: "bold", text: "أمثلة على الملاحظات" + (o.issues.length > MAX ? " (أول " + MAX + " من " + ui.fmt(o.issues.length) + ")" : "") });
      out.push({ kind: "table", headers: ["النوع", "الاسم", "المسار", "المرحلة", "المجموعة", "التفصيل"], widths: [0.17, 0.25, 0.17, 0.11, 0.09, 0.21], align: [null, null, null, null, "center", null],
        rows: shownIssues.map((x) => [DQ_LABEL[x.type] || x.type, x.s.name, x.s.track, x.s.stage, x.s.group || "—", x.detail || ""]) });
    } else out.push({ kind: "para", text: "لا ملاحظات بحسب الفحوص المختارة." });
    out.push(gap(), { kind: "para", text: "مصدر البيانات: نظام المركز. هوية الطالب وجواله غير مدرجين في هذا التقرير حمايةً للخصوصية." });
    return out;
  }
  function groupsBlocks() {
    const o = state.grp.out; if (!o) return null;
    const out = [{ kind: "title", text: "تقرير المجموعات والمدربين" }, lhDate(), gap(), { kind: "bold", text: "النطاق: " + lhScope(state.grp) },
      { kind: "para", text: ui.fmt(o.total) + " طالباً في " + ui.fmt(o.groups.length) + " مجموعة، مع " + ui.fmt(o.trainers.filter((t) => t.name !== "(بلا مدرب)").length) + " مدرباً. غير الموزعين: " + ui.fmt(o.unassigned) + "." }, gap(),
      { kind: "bold", text: "المجموعات" },
      { kind: "table", headers: ["المسار", "المرحلة", "المجموعة", "المدرب", "الطلاب", "ملاحظة"], widths: [0.22, 0.14, 0.12, 0.24, 0.1, 0.18], align: [null, null, "center", null, "center", null],
        rows: o.groups.map((g) => [g.track, g.stage, g.group, g.trainer || "—", ui.fmt(g.n), g.note || ""]) }, gap(),
      { kind: "bold", text: "حمل المدربين" },
      { kind: "table", headers: ["المدرب", "المجموعات", "الطلاب", "المسارات"], widths: [0.34, 0.14, 0.14, 0.38], align: [null, "center", "center", null], rows: o.trainers.map((t) => [t.name, ui.fmt(t.groups), ui.fmt(t.n), [...t.tracks].join("، ")]) }];
    const comp = state.grp.comp;
    if (comp) {
      const lack = (x) => [x.pre ? "قبلي " + x.pre : "", x.post ? "بعدي " + x.post : "", x.impact ? "أثر " + x.impact : "", x.pledge ? "تعهد " + x.pledge : ""].filter(Boolean).join("، ") || "—";
      out.push(gap(), { kind: "bold", text: "الالتزام بالمتطلبات — الأقل التزاماً أولاً (العام " + comp.pct + "%)" },
        { kind: "table", headers: ["المسار · المرحلة", "المجموعة", "المدرب", "الطلاب", "المكتملون", "الالتزام", "الناقص"], widths: [0.24, 0.09, 0.2, 0.08, 0.1, 0.09, 0.2], align: [null, "center", null, "center", "center", "center", null],
          rows: comp.groups.map((g) => [g.track + " · " + g.stage, g.group, g.trainer || "—", ui.fmt(g.n), ui.fmt(g.complete), g.pct + "%", lack(g)]) }, gap(),
        { kind: "table", headers: ["المدرب", "المجموعات", "الطلاب", "المكتملون", "الالتزام", "الناقص"], widths: [0.3, 0.12, 0.1, 0.12, 0.11, 0.25], align: [null, "center", "center", "center", "center", null],
          rows: comp.trainers.map((t) => [t.name, ui.fmt(t.groups), ui.fmt(t.n), ui.fmt(t.complete), t.pct + "%", lack(t)]) },
        { kind: "para", text: "«مكتمل» = لا ينقصه استبيان قبلي ولا بعدي ولا قياس أثر ولا تعهد؛ فتُقرأ النسب إرشاداً لا حكماً." });
    }
    out.push(gap(), { kind: "para", text: "مصدر البيانات: نظام المركز." });
    return out;
  }
  function compareBlocks() {
    const o = state.cmp.out; if (!o) return null;
    const multi = o.list.filter((p) => p.stages.length > 1).length;
    const out = [{ kind: "title", text: "تقرير مقارنة المراحل" }, lhDate(), gap(), { kind: "bold", text: "النطاق: " + lhScope(state.cmp) },
      { kind: "para", text: ui.fmt(o.total) + " طالباً مختلفاً، منهم " + ui.fmt(multi) + " سجّلوا في أكثر من مرحلة." }, gap()];
    const rows = o.pairs.map((x) => [x.a.t + " و" + x.b.t, ui.fmt(x.n)]).concat(Object.keys(o.dist).sort().map((k) => [k === "1" ? "في مرحلة واحدة" : "في " + ui.fmt(k) + " مراحل", ui.fmt(o.dist[k])]));
    if (rows.length) out.push({ kind: "table", headers: ["الحالة", "عدد الطلاب"], widths: [0.7, 0.3], align: [null, "center"], rows });
    out.push(gap(), { kind: "para", text: "مصدر البيانات: نظام المركز." });
    return out;
  }
  function siblingsBlocks() {
    const o = state.sib.out; if (!o) return null;
    const out = [{ kind: "title", text: "تقرير مقارنة الإخوة" }, lhDate(), gap(), { kind: "bold", text: "النطاق: " + lhScope(state.sib) },
      { kind: "para", text: ui.fmt(o.families) + " عائلة، تضم " + ui.fmt(o.siblings) + " طالباً من أصل " + ui.fmt(o.total) + "." }];
    if (o.stageStats) out.push({ kind: "para", text: o.stageStats.lastLabel + " مقابل " + o.stageStats.cmpLabel + ": " + ui.fmt(o.stageStats.last) + " طالباً لهم إخوة." });
    out.push(gap(), { kind: "para", text: "الإخوة محتملون بمطابقة الجوال والاسم، فتُراجَع القائمة قبل أي إجراء. مصدر البيانات: نظام المركز." });
    return out;
  }

  /* تقرير المدير بنقرة: يشغّل التقرير الشامل (إن لم تكن نتيجته حاضرة) ثم يطبع/يصدّر Word على الترويسة */
  async function managerReport(how) {
    const c = state.mis;
    if (state.busy) return ui.toast("هناك عملية جارية الآن؛ انتظر انتهاءها.");
    if (c.out && c.out.rows) {
      // نتيجة ظاهرة من أي نوع: يُبنى الموجز منها دون إعادة جلب
      ui.toast("يُعدّ الموجز من النتيجة الظاهرة (" + ((MIS_KINDS.find((k) => k.k === c.out.kind) || {}).t || "") + ") دون إعادة جلب");
    } else {
      ui.toast("لا نتيجة ظاهرة: سأشغّل التقرير الشامل أولاً ثم أفتح الموجز");
      c.kind = "all"; c.verify = c.verify !== false;
      await runMissing();
      if (state.resultError || !c.out) return;
    }
    return how === "word" ? wordSummary() : printSummary();
  }

  /* ===== إحصاءات قياس الأثر: صفحة تقرير النظام بجداولها كلها، مع تصفية محلية بالمسار والمرحلة ===== */
  const impHasCol = (heads, rx) => heads.findIndex((h) => rx.test(clean(h)));
  /* نفكّ عمود «المسار / الدورة» المدمج إن وُجد ليصير مساراً ومرحلة، كما في بقية التقارير */
  const impTables = () => ((state.imp.out && state.imp.out.tables) || []).map((t, i) => {
    const e = expandResult({ heads: t.heads, rows: t.rows.map((r) => ({ cells: r.cells })) });
    return { i, title: t.title || "جدول " + (i + 1), heads: e.heads, rows: e.rows.map((r) => r.cells) };
  });
  const trackIdx = (heads) => impHasCol(heads, /^(ال)?مسار$/);
  const stageIdx = (heads) => { const a = impHasCol(heads, /^(ال)?مرحلة$/); return a >= 0 ? a : impHasCol(heads, /دور|مرحل/); };
  const stageOfCell = (v) => stageOf(v) || clean(v);
  const courseIdx = (heads) => impHasCol(heads, /^(ال)?(مساق|دورة|الدورة)$/);
  function impOptions() {
    const tr = new Set(), st = new Set(), co = new Set();
    impTables().forEach((t) => {
      const a = trackIdx(t.heads), b = stageIdx(t.heads), k = courseIdx(t.heads);
      t.rows.forEach((r) => { if (k >= 0 && clean(r[k])) co.add(clean(r[k])); if (a >= 0 && clean(r[a])) tr.add(clean(r[a]).replace(/^مسار\s*/, "")); if (b >= 0 && clean(r[b])) st.add(stageOfCell(r[b])); });
    });
    return { courses: [...co].sort((x, y) => x.localeCompare(y, "ar")), tracks: [...tr].sort((x, y) => x.localeCompare(y, "ar")), stages: [...st].sort((x, y) => x.localeCompare(y, "ar")) };
  }
  /* الجداول بعد التصفية. جدول بلا عمود المسار/المرحلة لا يُصفّى بالمعيار الذي ليس فيه */
  function impFiltered() {
    const f = state.imp;
    const trNames = (f.tracks || []).map((id) => { const o = trackOpts().find((x) => String(x.v) === String(id)); return o ? o.t.replace(/^مسار\s*/, "") : ""; }).filter(Boolean);
    return impTables().map((t) => {
      const a = trackIdx(t.heads), b = stageIdx(t.heads), k = courseIdx(t.heads);
      const anyStage = b < 0 && t.rows.some((r) => r.some((c) => stageOf(c)));
      const anyTrack = a < 0 && trNames.length && t.rows.some((r) => r.some((c) => trNames.some((n) => clean(c).includes(n))));
      const tStage = stageOf(t.title);   // المرحلة قد تكون في عنوان الجدول لا في أعمدته
      const okStage = (r) => !(f.stages || []).length || (b >= 0 ? f.stages.includes(stageOfCell(r[b])) : anyStage ? r.some((c) => f.stages.includes(stageOf(c))) : tStage ? f.stages.includes(tStage) : true);
      const okTrack = (r) => !trNames.length || (a >= 0 ? trNames.includes(clean(r[a]).replace(/^مسار\s*/, "")) : anyTrack ? r.some((c) => trNames.some((n) => clean(c).includes(n))) : true);
      const z = impHasCol(t.heads, /^عدد الإجابات$/);
      const rows = t.rows.filter((r) => (!f.course || k < 0 || clean(r[k]) === f.course) && okTrack(r) && okStage(r) && !(f.hideZero && z >= 0 && Number(String(r[z]).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/,/g, "")) === 0));
      const iq = impHasCol(t.heads, /^السؤال$/), im = impHasCol(t.heads, /^المتوسط$/);
      if (iq >= 0 && im >= 0) rows.sort((a, b) => { const x = App.ccUtil.numOf(a[im]), y = App.ccUtil.numOf(b[im]); return (isNaN(x) ? 99 : x) - (isNaN(y) ? 99 : y); });   // الأضعف أولاً
      return Object.assign({}, t, { rows, noTrack: trNames.length > 0 && a < 0 && !anyTrack, noStage: (f.stages || []).length > 0 && b < 0 && !anyStage && !tStage });
    });
  }
  const IMP_PAGES = [["impact", "الملخص"], ["pre-post", "قبلي / بعدي"], ["impact-m", "قياس الأثر"], ["questions", "إحصائيات الأسئلة"], ["responses", "نسب الاستجابة"]];
  const IMP_PATH = { impact: "summary", "pre-post": "pre-post", "impact-m": "impact", questions: "questions", responses: "responses" };
  function requireAgent15() {
    const v = String((App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version()) || "");
    const n = v.split(".").map(Number), need = state.mode === "attend" ? 7 : 6;
    const ok = n.length >= 2 && (n[0] > 1 || (n[0] === 1 && (n[1] > 5 || (n[1] === 5 && (n[2] || 0) >= need))));
    if (!ok) throw new Error(v
      ? `إضافة «وكيل تمكين» في متصفحك قديمة (الإصدار ${v}) ولا تدعم هذا التقرير. أعد تنزيلها (الإصدار 1.5.${need}) من https://tamkeen-admin.vercel.app/extension/tamkeen-center-agent.zip ثم اضغط 🔄 على بطاقتها في chrome://extensions وأعد المحاولة.`
      : "هذا التقرير يعمل عبر إضافة «وكيل تمكين» (الإصدار 1.5.${need} فأحدث) ولا تدعمه الجلسة المحلية.");
  }
  const impTrackNames = () => (state.imp.tracks || []).map((id) => { const o = trackOpts().find((x) => String(x.v) === String(id)); return o ? o.t.replace(/^مسار\s*/, "") : ""; }).filter(Boolean);
  /* الدورات التدريبية (قائمة صفحة النظام: «المرحلة الثانية - مسار …») المطابقة للمراحل والمسارات المختارة */
  const impCourseFilter = (filters) => (filters || []).find((f) => f.type === "select" && (/course/i.test(f.name) || /دورة/.test(f.label || "")) && (f.options || []).some((o) => stageOf(o.t)));
  function impCourseVariants(filters) {
    const st = state.imp.stages || [], f = impCourseFilter(filters), tn = impTrackNames();
    if (!st.length || !f) return null;
    return { name: f.name, list: f.options.filter((o) => o.v !== "" && st.includes(stageOf(o.t)) && (!tn.length || tn.some((n) => o.t.includes(n)))).map((o) => ({ v: o.v, t: o.t })) };
  }
  /* دمج نتائج عدة دورات في جداول واحدة مع عمود «الدورة التدريبية» */
  /* قائمة «المسار» في صفحة النظام: خيار لكل مسار مختار (أو كل المسارات إن لم تختر) */
  function impTrackVariants(filters) {
    const f = (filters || []).find((x) => x.type === "select" && (/^track/i.test(x.name) || /^المسار$/.test(clean(x.label || ""))));
    if (!f) return null;
    const tn = impTrackNames();
    return { name: f.name, list: f.options.filter((o) => o.v !== "" && (!tn.length || tn.some((n) => o.t.includes(n)))).map((o) => ({ v: o.v, t: o.t.replace(/^مسار\s*/, "") })) };
  }
  function impMerge(parts, col) {
    const tables = [];
    parts.forEach(({ label, r }) => (r.tables || []).forEach((t) => {
      let m = tables.find((x) => x.title === t.title && x.heads.slice(0, -1).join("|") === t.heads.join("|"));
      if (!m) { m = { title: t.title, heads: t.heads.concat([col || "الدورة التدريبية"]), rows: [] }; tables.push(m); }
      t.rows.forEach((row) => m.rows.push({ cells: row.cells.concat([label]) }));
    }));
    return Object.assign({}, parts[0].r, { tables, stats: [], courses: parts.map((x) => x.label) });
  }
  const impParams = () => {
    const c = state.imp, p = {};
    if (c.from) p.date_from = c.from;
    p.date_to = c.to || ui.todayISO();
    Object.keys(c.srv || {}).forEach((k) => { if (/^[A-Za-z_][\w\[\]]*$/.test(k) && c.srv[k] !== "" && !(Array.isArray(c.srv[k]) && !c.srv[k].length) && !/^date_(from|to)$/.test(k)) p[k] = c.srv[k]; });
    String(c.extra || "").split(/[&\n]+/).map((x) => x.trim()).filter(Boolean).forEach((kv) => { const [k, ...v] = kv.split("="); if (/^[a-z_][a-z0-9_]*(\[\])?$/i.test(k.trim())) p[k.trim()] = v.join("=").trim(); });
    return p;
  };
  async function runImpact() {
    const c = state.imp;
    state.busy = true; state.resultError = ""; c.out = null; c.outs = {}; c.course = ""; state.progress = "";
    render(); refreshStatus();
    try {
      requireAgent15();
      const pages = c.pages.length ? c.pages.slice() : ["impact"];
      const lab = (pg) => "إحصاءات: " + ((IMP_PAGES.find((x) => x[0] === pg) || [])[1] || pg);
      let known = c.known || [];
      const needCourse = (c.stages || []).length > 0, needTrack = pages.includes("questions"), needGroup = (state.groups || []).length > 0;
      const hasGroupF = (k) => (k || []).some((f) => f.type === "select" && (/group/i.test(f.name || "") || /مجموعة/.test(f.label || "")));
      /* خيارات قوائم النظام (الدورة، المسار) تُعرف بقراءة واحدة أولى إن لم تكن محفوظة */
      if ((needGroup && !hasGroupF(known)) || (needCourse && !impCourseFilter(known)) || (needTrack && !(known || []).some((x) => /^track/i.test(x.name)))) {
        const r0 = await runCommands([{ type: "page", source: pages[0], label: lab(pages[0]), params: impParams() }]);
        if (r0[0] && r0[0].type === "page") known = c.known = r0[0].filters || [];
      }
      const cv = impCourseVariants(known);
      if (needCourse && impCourseFilter(known) && !(cv && cv.list.length)) throw new Error("لا توجد في النظام دورة تدريبية تطابق المراحل والمسارات المختارة.");
      const gf = needGroup ? (known || []).find((f) => f.type === "select" && (/group/i.test(f.name || "") || /مجموعة/.test(f.label || ""))) : null;
      const gvars = gf ? { col: "المجموعة", name: gf.name, list: gf.options.filter((o) => o.v !== "" && state.groups.includes(grpCode(o.t))).map((o) => ({ v: o.v, t: o.t })) } : null;
      if (needGroup && gf && !gvars.list.length) throw new Error("لا توجد في صفحة النظام مجموعة تطابق المجموعات المختارة.");
      const varsFor = (pg) => {
        if (gvars) return gvars;
        if (cv) return { col: "الدورة التدريبية", name: cv.name, list: cv.list };
        const tv = pg === "questions" ? impTrackVariants(known) : null;
        return tv && tv.list.length ? { col: "المسار", name: tv.name, list: tv.list } : null;
      };
      const cmds = [];
      pages.forEach((pg) => { const v = varsFor(pg); if (v) v.list.forEach((o) => cmds.push({ pg, col: v.col, o, cmd: { type: "page", source: pg, label: lab(pg) + " — " + o.t, params: Object.assign(impParams(), { [v.name]: o.v }) } })); else cmds.push({ pg, cmd: { type: "page", source: pg, label: lab(pg), params: impParams() } }); });
      const rs = await runCommands(cmds.map((x) => x.cmd));
      pages.forEach((pg) => {
        const mine = cmds.map((x, i) => ({ x, r: rs[i] })).filter((y) => y.x.pg === pg && y.r && y.r.type === "page");
        if (!mine.length) return;
        if (mine[0].x.o) c.outs[pg] = Object.assign({ at: new Date(), stagesAtFetch: c.stages.slice() }, impMerge(mine.map((y) => ({ label: y.x.o.t, r: y.r })), mine[0].x.col));
        else c.outs[pg] = Object.assign({ at: new Date() }, mine[0].r);
      });
      if (!Object.keys(c.outs).length) throw new Error("لم يصل التقرير من الوكيل.");
      c.view = pages.find((pg) => c.outs[pg]);
      c.known = (c.outs[c.view].filters || []).length ? c.outs[c.view].filters : known;
      c.out = c.outs[c.view];
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* ===== الحضور والغياب: تجميع حضور الجلسات لكل طالب وتنبيه عند تجاوز الحد ===== */
  const ATT_ST = { present: "حاضر", late: "متأخر", absent: "غائب", excused: "بعذر" };
  const attTrackName = (t) => String(t || "").replace(/\s*المرحلة.*$/, "").replace(/^مسار\s*/, "");
  const trackNamesOf = (ids) => (ids || []).map((id) => { const o = trackOpts().find((x) => String(x.v) === String(id)); return o ? o.t.replace(/^مسار\s*/, "") : ""; }).filter(Boolean);
  function attAggregate(sessions) {
    const by = new Map();
    sessions.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((se) => (se.rows || []).forEach((r) => {
      const key = r.sid || r.name;
      const e = by.get(key) || by.set(key, { name: r.name, stu: r.stu, track: attTrackName(se.track), group: se.group, present: 0, late: 0, absent: 0, excused: 0, sessions: 0, lastAbsent: "", streak: 0, maxStreak: 0 }).get(key);
      e.sessions++; if (e[r.status] != null) e[r.status]++;
      if (r.status === "absent") { e.streak++; if (e.streak > e.maxStreak) e.maxStreak = e.streak; } else e.streak = 0;   // الغياب المتتالي بترتيب التاريخ
      if (r.status === "absent" && se.date > e.lastAbsent) e.lastAbsent = se.date;
    }));
    return [...by.values()];
  }
  const attCount = (e) => e.absent + (state.att.excused ? e.excused : 0);
  const attFlagged = () => ((state.att.out && state.att.out.students) || []).filter((e) => attCount(e) > Number(state.att.thr || 3));
  const attNear = () => ((state.att.out && state.att.out.students) || []).filter((e) => attCount(e) === Number(state.att.thr || 3));
  const attFlaggedShown = () => { const tf = attTF(); return attFlagged().filter((e) => attInTrack(e, tf)); };
  const attHeads = () => ["الطالب", "الرقم", "المسار", "المجموعة", "غائب", "بعذر", "متأخر", "حاضر", "الجلسات", "آخر غياب", "أطول غياب متتالٍ", "التنبيه"];
  /* تصفية جدول «الغياب لكل طالب» بمسار (قائمة منسدلة فوق الجدول) */
  const attTracksList = () => [...new Set(((state.att.out && state.att.out.students) || []).map((e) => e.track || "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  // المسار المختار فعّال فقط إن وُجد في القراءة الحالية (قراءة جديدة بلا هذا المسار تعرض الكل)
  const attTF = () => { const t = state.att.trackFilter || ""; return t && ((state.att.out && state.att.out.students) || []).some((e) => e.track === t) ? t : ""; };
  const attInTrack = (e, tf) => { const f = tf === undefined ? attTF() : tf; return !f || (e.track || "") === f; };
  const attShown = () => { const tf = attTF(); return ((state.att.out && state.att.out.students) || []).filter((e) => attInTrack(e, tf)); };
  const attTable = () => attShown().slice().sort((a, b) => attCount(b) - attCount(a) || a.name.localeCompare(b.name, "ar"))
    .map((e) => [e.name, e.stu, e.track, e.group, e.absent, e.excused, e.late, e.present, e.sessions, e.lastAbsent || "—", e.maxStreak || 0, [attCount(e) > Number(state.att.thr || 3) ? "⚠ تجاوز " + state.att.thr : attCount(e) === Number(state.att.thr || 3) ? "🔔 على الحد" : "", e.maxStreak >= 3 ? "⚠ " + e.maxStreak + " جلسات متتالية" : ""].filter(Boolean).join(" · ")]);
  /* غائبو آخر يوم مقروء مجمّعين بالمسار والمجموعة، لكل مجموعة نص واتساب جاهز */
  function attGroups() {
    const o = state.att.out; if (!o || !o.lastDay) return [];
    const by = new Map();
    (o.raw || []).filter((se) => se.date === o.lastDay).forEach((se) => {
      const key = attTrackName(se.track) + "|" + se.group;
      const e = by.get(key) || by.set(key, { track: attTrackName(se.track), group: se.group, absent: [], excused: [], all: new Set() }).get(key);
      (se.rows || []).forEach((r) => {
        e.all.add(r.sid || r.name);
        if (r.status === "absent" && !e.absent.includes(r.name)) e.absent.push(r.name);
        else if (r.status === "excused" && !e.excused.includes(r.name)) e.excused.push(r.name);
      });
    });
    return [...by.values()].map((e) => Object.assign(e, { total: e.all.size }))
      .filter((e) => e.absent.length || (state.att.excused && e.excused.length))
      .sort((a, b) => b.absent.length - a.absent.length || a.track.localeCompare(b.track, "ar"));
  }
  function attGroupText(e, day) {
    const num = (i) => String(i + 1).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
    const names = e.absent.slice().sort((a, b) => a.localeCompare(b, "ar"));
    let t = `*غياب ${day} — ${e.track}${e.group ? " (" + e.group + ")" : ""}*\n` + names.map((n, i) => `${num(i)}. ${n}`).join("\n");
    if (e.excused.length) t += `\n\n*بعذر (${e.excused.length}):* ` + e.excused.join("، ");
    return t + `\n\nالغائبون ${e.absent.length}${e.total ? " من " + e.total : ""}.`;
  }
  const attDayHeads = () => ["الطالب", "المسار", "المجموعة", "الجلسة", "الحالة", "التاريخ"];
  const attDayTable = () => {
    const o = state.att.out; if (!o || !o.lastDay) return [];
    const rows = [];
    o.raw.filter((se) => se.date === o.lastDay).forEach((se) => se.rows.filter((r) => r.status === "absent" || r.status === "excused").forEach((r) => rows.push([r.name, attTrackName(se.track), se.group, se.title, ATT_ST[r.status], se.date])));
    return rows;
  };
  function attSheets(name) {
    if (!state.att.out) return [];
    return [{ name: name + " - لكل طالب", heads: attHeads(), rows: attTable() }, { name: name + " - غائبو آخر يوم", heads: attDayHeads(), rows: attDayTable() }].filter((x) => x.rows.length);
  }
  async function runAttend() {
    const c = state.att;
    state.busy = true; state.resultError = ""; c.out = null; state.progress = "";
    render(); refreshStatus();
    try {
      requireAgent15();
      const today = ui.todayISO();
      const params = { date_from: c.from || today, date_to: c.to || today };
      const r = (await runCommands([{ type: "attendance", label: "الحضور والغياب", params, groupCodes: state.groups || [], trackNames: trackNamesOf(c.tracks), stages: (state.groups || []).length ? [] : (c.stages || []).map(stageK).filter(Boolean), max: Number(c.max) || 80 }]))[0];   // المجموعة المحدَّدة تغني عن المرحلة
      if (!r || r.type !== "attendance") throw new Error((r && r.error) || "لم تصل نتيجة الحضور من الوكيل.");
      const days = r.sessions.map((x) => x.date).sort();
      c.out = { at: new Date(), raw: r.sessions, students: attAggregate(r.sessions), sessions: r.sessions.length, listed: r.listed, truncated: r.truncated, note: r.note, lastDay: days[days.length - 1] || "", from: params.date_from, to: params.date_to };
      histAdd(c.out).catch(() => {});
      const n = attFlagged().length;
      if (n) ui.toast("⚠ " + ui.fmt(n) + " طالباً تجاوزوا " + c.thr + " غيابات");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* ===== مطابقة التوقيعات: صور الأوراق ← قراءة بالذكاء الاصطناعي ← مقارنة بالمسجلين ===== */
  function sigCommands(soft, cfg) {
    const c = cfg || state.sig, groups = (state.groups || []).length;
    if (!c.stages.length && !c.tracks.length && !groups) { if (soft) return []; throw new Error("اختر المرحلة (والمسار والمجموعة إن شئت) من شريط «النطاق» أولاً، فالمقارنة تكون مع المسجلين في المرحلة نفسها."); }
    const common = c.status ? { status: c.status } : {};
    const mk = (params, label) => ({ type: "list", label, params: Object.assign({}, params, common) });
    if (c.stages.length) {
      const stageKeys = STAGES.filter((x) => c.stages.includes(x.t)).map((x) => x.k);
      const courses = courseOpts().filter((x) => stageKeys.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track)));
      if (!courses.length) { if (soft) return []; throw new Error("لا توجد دورة تجمع المسار والمرحلة المختارين."); }
      return courses.map((x) => mk({ training_course_id: x.v }, x.t));
    }
    if (c.tracks.length) return c.tracks.map((id) => mk({ track_id: String(id) }, optLabel("track_id", id)));
    return [mk({}, "الطلاب")];
  }
  const sigHead = (heads, rx) => heads.findIndex((h) => rx.test(clean(h)));
  function sigRegistered(results) {
    const out = [], seen = new Set();
    (results || []).filter((r) => r && r.type === "list").forEach((r) => {
      const iN = sigHead(r.heads, /^(الاسم|اسم الطالب)$/), iS = sigHead(r.heads, /^رقم الطالب$/), iI = sigHead(r.heads, /^رقم الهوية$/), iP = sigHead(r.heads, /^الجوال$/), iG = sigHead(r.heads, /^المجموعة/);
      if (iN < 0) return;
      r.rows.forEach((x) => {
        const name = clean(x.cells[iN]); if (!name) return;
        const key = (iS >= 0 && clean(x.cells[iS])) || (iI >= 0 && clean(x.cells[iI])) || name;
        if (seen.has(key)) return; seen.add(key);
        out.push({ key, name, stu: iS >= 0 ? clean(x.cells[iS]) : "", id: iI >= 0 ? clean(x.cells[iI]) : "", phone: iP >= 0 ? clean(x.cells[iP]) : "", group: iG >= 0 ? clean(x.cells[iG]) : "", course: r.label || "" });
      });
    });
    return out;
  }
  /* ما لم يُطابَق أو طُوبق بالاسم وحده يُبحث عنه في نظام المركز بالهوية (أو الجوال إن لم تُقرأ الهوية). قراءة فقط، ضمن ضغطتك على «اجلب المسجلين وقارن» */
  async function sigResolve() {
    const c = state.sig; c.lookups = c.lookups || {};
    const targets = sigPendingLookups();
    const slice = targets.slice(0, 40);
    if (!slice.length) return;
    const r = (await runCommands([{ type: "lookup", label: "بحث بالهوية/الجوال", items: slice.map((t) => ({ q: t.q })) }], { noCache: true }))[0];
    ((r && r.items) || []).forEach((it, i) => {
      const t = slice[i]; if (!t) return;
      c.lookups[t.f.id] = !it || !it.count ? { q: t.q, list: [], none: true } : { q: t.q, list: it.rows.map((x) => stuFrom(it, x)) };
    });
    c.lookupCapped = targets.length > slice.length;
  }
  /* ===== جلسة المطابقة المحفوظة على هذا الجهاز: المقروء من الصور، والمسجلون المجلوبون، والبحث والقرارات، والصور التي قُرئت =====
     كل صور جديدة تُقرأ وتُضاف، ولا يُعاد جلب المسجلين إلا بطلبك. الصور نفسها لا تُحفظ، والجلسة تُمسح بزر «امسح الجلسة». */
  const SIG_SES = "tamkeen:sig-session";
  function sigLoad() {
    try {
      const d = JSON.parse(localStorage.getItem(SIG_SES) || "null"); if (!d || d.v !== 1) return;
      const c = state.sig; ["rows", "reg", "regScope", "regAt", "manual", "lookups", "nameHits", "fileKeys", "done", "titles", "savedAt"].forEach((k) => { if (d[k] !== undefined && d[k] !== null) c[k] = d[k]; });
    } catch (e) { /* لا جلسة */ }
  }
  function sigSaveNow() {
    const c = state.sig; if (!c.rows && !c.reg) return;
    try { c.savedAt = new Date().toISOString(); localStorage.setItem(SIG_SES, JSON.stringify({ v: 1, savedAt: c.savedAt, rows: c.rows, reg: c.reg, regScope: c.regScope, regAt: c.regAt, manual: c.manual, lookups: c.lookups, nameHits: c.nameHits, fileKeys: c.fileKeys, done: c.done, titles: c.titles })); } catch (e) { /* التخزين ممتلئ أو غير متاح */ }
  }
  let sigTimer = 0;
  const sigSaveSoon = () => { clearTimeout(sigTimer); sigTimer = setTimeout(sigSaveNow, 400); };
  function sigClear() {
    try { localStorage.removeItem(SIG_SES); } catch (e) { /* */ }
    Object.assign(state.sig, { rows: null, reg: null, regScope: null, regAt: "", manual: {}, lookups: {}, nameHits: {}, fileKeys: [], done: [], titles: [], files: [], failed: [], savedAt: "" });
  }
  const sigFileKey = (f) => { const d = f.data || ""; let h = 0; const st = Math.max(1, Math.floor(d.length / 4000)); for (let i = 0; i < d.length; i += st) h = (h * 31 + d.charCodeAt(i)) | 0; return d.length + ":" + (h >>> 0).toString(36); };
  const sigScopeNow = () => { const sc = scopeNow(); return JSON.stringify({ t: sc.tracks.slice().sort(), s: sc.stages.slice().sort(), g: (state.groups || []).slice().sort(), st: state.sig.status || "" }); };
  const sigScopeText = (raw) => { try { const o = JSON.parse(raw); return [o.s.length ? o.s.join("، ") : "", o.t.length ? "مسارات: " + trackNamesOf(o.t).join("، ") : "", o.g.length ? "مجموعات: " + o.g.join("، ") : ""].filter(Boolean).join(" · ") || "كل النطاق"; } catch (e) { return ""; } };
  /* من يحتاج بحثاً في النظام ولم يُبحث عنه بعد (بهويته أو جواله) */
  function sigPendingLookups() {
    const c = state.sig; if (!c.reg || !c.rows) return [];
    const need = [];
    sigForms().forEach((fm) => { const o = sigCompute(fm); if (o) need.push(...o.orphans, ...o.items.filter((x) => x.st === "review" && x.found).map((x) => x.found)); });
    const seen = new Set(), out = [];
    need.forEach((f) => { if (seen.has(f.id) || (c.lookups || {})[f.id]) return; seen.add(f.id); const nid = digits(f.nid), ph = phoneNorm(f.phone); const q = nid.length >= 9 ? nid : ph.length >= 9 ? ph : ""; if (q) out.push({ f, q }); });
    return out;
  }
  const sigAllHeads = () => ["الاسم", "رقم الهوية", "الجوال", "المجموعة", "الدورة", "الحالة", "الاسم المقروء من الورقة", "الورقة", "المطابقة"];
  const sigAllRow = (x) => [x.reg.name, x.reg.id, x.reg.phone, grpCode(x.reg.group) || x.reg.group, x.reg.course, SIG_ST[x.st], x.found ? x.found.name : "", x.found ? sigShort(x.found.file) : "", x.how];
  const sigShort = (t) => { t = String(t || ""); return t.length > 22 ? t.slice(0, 10) + "…" + t.slice(-8) : t; };
  const sigFoundHeads = () => ["الاسم في النظام", "الاسم المقروء من الورقة", "رقم الهوية", "الجوال", "المرحلة", "المجموعة", "المسار", "الحكم", "طريقة التعرّف"];
  const sigFoundRow = (x) => [x.s.name, x.f.name, x.s.id || x.f.nid || "", x.s.phone || x.f.phone || "", x.s.stage, x.s.group, x.s.track, x.f.signed === true ? "موقّع" : "غير محسوم", ((state.sig.lookups || {})[x.f.id] || {}).by === "name" ? "بالاسم" : "بالهوية/الجوال"];
  const sigLookupText = (f) => {
    const lk = (state.sig.lookups || {})[f.id];
    if (!lk || (lk.none && ((state.sig.nameHits || {})[f.id] || {}).list)) { const nh = (state.sig.nameHits || {})[f.id]; if (!nh) return ""; if (!nh.list.length) return "بحثتُ عن اسمه في كل النظام فلم أجد شبيهاً"; return "بالاسم في النظام: " + nh.list.map((x) => x.s.name + [x.s.stage, x.s.group ? "مجموعة " + x.s.group : "", x.s.track].filter(Boolean).map((y) => " · " + y).join("") + " (" + Math.round(x.score * 100) + "%)").join(" ‖ "); }
    if (lk.none) return "بحثتُ عنه بـ" + (digits(f.nid).length >= 9 ? "الهوية" : "الجوال") + " في النظام فلم أجد طالباً";
    if (lk.list.length > 1) return "وُجد " + lk.list.length + " طلاب بهذا الرقم في النظام: " + lk.list.slice(0, 3).map((s) => s.name).join("، ");
    const s = lk.list[0];
    return "في النظام: " + s.name + [s.stage, s.group ? "مجموعة " + s.group : "", s.track].filter(Boolean).map((x) => " · " + x).join("");
  };
  /* ===== ذاكرة تصحيحات المطابقة: ما ربطتَه بيدك (أو دلّت عليه الهوية/الجوال) لا تصحّحه ثانية =====
     اسم مقروء (موحَّد الهمزات) ← مسجّل؛ و«ليس هو» يُحفظ حظراً. تبقى على هذا الجهاز بين الجلسات، وتُمسح بزر خاص. */
  const SIG_LEARN_KEY = "tamkeen:sig-learn", SIG_BLOCK_KEY = "tamkeen:sig-block", SIG_LEARN_MAX = 3000;
  const sigAk = (name) => App.ccUtil.arKey(name);
  const sigLearnGet = () => { const o = lsGet(SIG_LEARN_KEY, {}); return o && typeof o === "object" ? o : {}; };
  const sigBlockGet = () => { const o = lsGet(SIG_BLOCK_KEY, {}); return o && typeof o === "object" ? o : {}; };
  function sigLearnAdd(readName, reg) {
    const ak = sigAk(readName); if (!ak || !reg || ak === sigAk(reg.name)) return;
    const L = sigLearnGet();
    if (L[ak] && L[ak].r === reg.key) return;
    L[ak] = { r: reg.key, n: reg.name, t: Date.now() };
    const ks = Object.keys(L); if (ks.length > SIG_LEARN_MAX) ks.sort((a, b) => L[a].t - L[b].t).slice(0, ks.length - SIG_LEARN_MAX).forEach((k) => delete L[k]);
    lsSet(SIG_LEARN_KEY, L);
    const B = sigBlockGet(); if (B[ak + "|" + reg.key]) { delete B[ak + "|" + reg.key]; lsSet(SIG_BLOCK_KEY, B); }
  }
  function sigLearnBlock(readName, reg) {
    const ak = sigAk(readName); if (!ak || !reg) return;
    const B = sigBlockGet(); B[ak + "|" + reg.key] = 1; lsSet(SIG_BLOCK_KEY, B);
    const L = sigLearnGet(); if (L[ak] && L[ak].r === reg.key) { delete L[ak]; lsSet(SIG_LEARN_KEY, L); }
  }
  const sigLearnClear = () => { lsSet(SIG_LEARN_KEY, {}); lsSet(SIG_BLOCK_KEY, {}); };
  /* ما ثبت بالهوية أو الجوال أو البحث وكان الاسم المقروء مختلفاً: يُحفظ ليُعرَف الاسم نفسه لاحقاً بلا رقم */
  function sigLearnAuto() {
    if (!state.sig.reg || !state.sig.rows) return;
    sigForms().forEach((fm) => {
      const o = sigCompute(fm); if (!o) return;
      o.items.forEach((x) => { if (x.found && /^(طابقت الهوية|طابق الجوال|عُثر عليه)/.test(x.how) && App.ccUtil.nameScore(x.reg.name, x.found.name) < 0.9) sigLearnAdd(x.found.name, x.reg); });
    });
  }
  /* ===== نماذج متعددة في الصور (مثل تعهد الحقيبة وكشف الحضور): لكل نموذج مقارنته وتقريره ===== */
  const SIG_DEF_FORM = "النموذج 1";
  const sigFormOf = (r) => clean(r && r.form) || SIG_DEF_FORM;
  function sigForms() {
    const seen = [];
    ((state.sig.rows) || []).forEach((r) => { if (r.keep === false) return; const f = sigFormOf(r); if (!seen.includes(f)) seen.push(f); });
    return seen.length ? seen : [SIG_DEF_FORM];
  }
  /* اسم نموذج الدفعة: ما كتبه المستخدم، وإلا ما استخرجه الذكاء الاصطناعي من الترويسة موحَّداً مع نموذج سابق قريب الاسم */
  function sigAssignForm(r, userForm) {
    const user = clean(userForm); if (user) return user;
    const auto = clean(r.formAuto); if (!auto) return "";
    const known = sigForms().filter((f) => f !== SIG_DEF_FORM);
    const near = known.map((f) => ({ f, sc: App.ccUtil.nameScore(f, auto) })).sort((a, b) => b.sc - a.sc)[0];
    return near && near.sc >= 0.7 ? near.f : auto;
  }
  function sigRenameForm(from, to) {
    const c = state.sig; to = clean(to); if (!to || to === from) return;
    (c.rows || []).forEach((r) => { if (sigFormOf(r) === from) r.form = to; });
    Object.keys(c.manual || {}).forEach((k) => { if (k.startsWith(from + "|")) { c.manual[to + "|" + k.slice(from.length + 1)] = c.manual[k]; delete c.manual[k]; } });
  }
  /* يقابل المسجلين بالأسماء المقروءة (لنموذج واحد)، ويطبّق قرارات المراجعة اليدوية */
  function sigCompute(form) {
    const c = state.sig; if (!c.reg || !c.rows) return null;
    const found = c.rows.filter((r) => r.keep !== false && (form === undefined || sigFormOf(r) === form));
    const m = App.ccUtil.matchNames(c.reg.map((x) => ({ name: x.name, id: x.id, phone: x.phone, track: pledgeTrackOf(x.course) })), found.map((f) => ({ name: f.name, id: f.nid, phone: f.phone, track: sigTrackOf(f) })));
    /* نتائج البحث في نظام المركز بالهوية/الجوال لما لم يُطابَق (أو طُوبق بالاسم وحده): إن دلّ على مسجّل في القائمة اعتُمد الربط */
    const blocks = sigBlockGet(), learned = sigLearnGet();
    m.pairs = m.pairs.filter((p) => !blocks[sigAk(found[p.found].name) + "|" + c.reg[p.reg].key]);   // «ليس هو» سابق
    const foundIdx = new Map(found.map((f, j) => [f.id, j]));
    const regOf = (s) => c.reg.findIndex((r) => (s.stu && r.stu && s.stu === r.stu) || (s.id && r.id && String(s.id) === String(r.id)));
    const usedReg = new Set(), usedFoundIdx = new Set();
    m.pairs.forEach((p) => { if (p.sure) { usedReg.add(p.reg); usedFoundIdx.add(p.found); } });
    Object.keys(c.lookups || {}).forEach((fid) => {
      const lk = c.lookups[fid], j = foundIdx.get(fid);
      if (j === undefined || !lk || !lk.list || lk.list.length !== 1) return;
      const ri = regOf(lk.list[0]); if (ri < 0 || usedReg.has(ri)) return;
      const at = m.pairs.findIndex((p) => p.found === j || p.reg === ri);
      const np = { reg: ri, found: j, score: lk.by === "name" || lk.by === "retrack" ? lk.score : 1, sure: true, by: lk.by === "name" ? "lookupname" : lk.by === "retrack" ? "retrack" : "lookup", mismatch: false };
      if (at >= 0) m.pairs[at] = np; else m.pairs.push(np);
      usedReg.add(ri); usedFoundIdx.add(j);
    });
    // تصحيحات سابقة: اسم مقروء ربطتَه بمسجّل من قبل
    found.forEach((f, j) => {
      if (usedFoundIdx.has(j)) return;
      const Lr = learned[sigAk(f.name)]; if (!Lr) return;
      const ri = c.reg.findIndex((r) => r.key === Lr.r); if (ri < 0 || usedReg.has(ri) || blocks[sigAk(f.name) + "|" + Lr.r]) return;
      const at = m.pairs.findIndex((p) => p.found === j || p.reg === ri), np = { reg: ri, found: j, score: 1, sure: true, by: "learned", mismatch: false };
      if (at >= 0) m.pairs[at] = np; else m.pairs.push(np);
      usedReg.add(ri); usedFoundIdx.add(j);
    });
    const byReg = new Map(m.pairs.map((p) => [p.reg, p]));
    const usedFound = new Set();
    const items = c.reg.map((r, i) => {
      const man = c.manual[(form === undefined ? "" : form) + "|" + r.key];
      let f = null, how = "", score = 0, state1, rev = false;
      if (man && man !== "none") { f = found.find((x) => x.id === man) || null; how = f ? "مراجعتك" : ""; score = 1; }
      else if (man === "none") { how = "رفضتَ المطابقة"; }
      else { const p = byReg.get(i); if (p) { f = found[p.found]; score = p.score; rev = !p.sure; how = p.by === "learned" ? "من تصحيح سابق لك" : p.by === "lookupname" ? "عُثر عليه بالاسم في النظام" : p.by === "retrack" ? "عُرف بالمقارنة مع طلاب مساره في النظام" : p.by === "lookup" ? "عُثر عليه بالهوية/الجوال في النظام" : p.by === "id" ? "طابقت الهوية" : p.by === "phone" ? "طابق الجوال" : p.by === "swap" ? "الجوال مكتوب في خانة الهوية (أو العكس)" : p.by === "id~" ? "هوية بفرق خانة واحدة (خطأ قراءة) ويؤكّدها الاسم" : p.by === "phone~" ? "جوال بفرق خانة واحدة (خطأ قراءة) ويؤكّده الاسم" : p.mismatch ? "الاسم يتفق لكن رقم الهوية/الجوال يختلف" : p.sure ? "" : "تحتاج مراجعة"; } }
      if (f) usedFound.add(f.id);
      if (!f) state1 = "absent";
      else if (rev) state1 = "review";
      else if (f.signed === true) state1 = "signed";
      else if (f.signed === false) state1 = "blank";
      else state1 = "review";
      return { reg: r, found: f, score, how, st: state1 };
    });
    const orphans = [], resolved = [];
    found.filter((f) => !usedFound.has(f.id) && f.signed !== false).forEach((f) => {
      const lk = (c.lookups || {})[f.id];
      if (lk && lk.list && lk.list.length === 1) resolved.push({ f, s: lk.list[0] }); else orphans.push(f);   // عُرف بالهوية/الجوال في النظام: يُعرض باسمه في النظام
    });
    /* مقروء لا يطابق أحداً وبلا توقيع: لا يُعرض للربط (لا قيمة لتوقيعه) لكنه يُذكر في قائمة «غير المعروفة» ولا يضيع */
    const lost = found.filter((f) => !usedFound.has(f.id) && f.signed === false && !((c.lookups || {})[f.id] && ((c.lookups || {})[f.id].list || []).length === 1));
    return { items, orphans, resolved, found, lost };
  }
  const SIG_ST = { signed: "وقّع", blank: "اسمه في الورقة بلا توقيع", absent: "لا يظهر اسمه في الأوراق", review: "يحتاج مراجعة" };
  function sigUnsignedRows(form) { const o = sigCompute(form); return o ? o.items.filter((x) => x.st === "absent" || x.st === "blank") : []; }
  const sigHeads = () => ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المجموعة", "الدورة", "الحالة"];
  const sigRowCells = (x) => [x.reg.name, x.reg.stu, x.reg.id, x.reg.phone, x.reg.group, x.reg.course, SIG_ST[x.st]];
  function sigSheets() {
    const forms = sigForms(), multi = forms.length > 1, out = [];
    if (multi) { const m = sigMatrix(); if (m) out.push({ name: "ما ينقص كل طالب", heads: sigMatrixHeads(m), rows: m.rows.map(sigMatrixRow) }); }
    if (multi) out.push({ name: "النماذج", heads: ["الرقم", "اسم النموذج", "عدد الأسماء المقروءة"], rows: forms.map((f, i) => [String(i + 1), f, String((state.sig.rows || []).filter((r) => r.keep !== false && sigFormOf(r) === f).length)]) });
    forms.forEach((fm, i) => sigSheetsFor(fm).forEach((x) => out.push(multi ? Object.assign({}, x, { name: ("ن" + (i + 1) + " - " + x.name).slice(0, 31) }) : x)));
    return out;
  }
  function sigSheetsFor(form) {
    const o = sigCompute(form); if (!o) return [];
    const by = (st) => o.items.filter((x) => st.includes(x.st));
    return [
      { name: "المتابعة (الكل)", heads: sigAllHeads(), rows: o.items.map(sigAllRow) },
      { name: "لم يوقّعوا", heads: sigHeads(), rows: by(["absent", "blank"]).map(sigRowCells) },
      { name: "تحتاج مراجعة", heads: ["الاسم المسجّل", "الاسم المقروء", "الهوية المقروءة", "الجوال المقروء", "درجة التشابه", "ملاحظة", "الدورة"], rows: by(["review"]).map((x) => [x.reg.name, x.found ? x.found.name : "", x.found ? x.found.nid || "" : "", x.found ? x.found.phone || "" : "", x.found ? Math.round(x.score * 100) + "%" : "", x.how, x.reg.course]) },
      { name: "عُرفوا بالبحث", heads: sigFoundHeads(), rows: o.resolved.map(sigFoundRow) },
      { name: "أسماء في الأوراق", heads: ["الاسم المقروء", "الهوية", "الجوال", "نتيجة البحث في النظام", "الورقة", "الحكم", "الثقة"], rows: o.orphans.concat(o.lost).map((f) => [f.name, f.nid || "", f.phone || "", sigLookupText(f), f.file, f.signed === true ? "موقّع" : "غير محسوم", Math.round(f.conf * 100) + "%"]) },
      { name: "وقّعوا", heads: sigHeads(), rows: by(["signed"]).map(sigRowCells) },
    ].filter((x) => x.rows.length);
  }
  const QUOTA_HELP = (read, left) => "بلغتَ الحد اليومي المجاني لمزوّد الذكاء الاصطناعي (Gemini المجاني: نحو 20 طلباً في اليوم لكل نموذج)" + (read ? "؛ قُرئ ما أمكن (" + ui.fmt(read) + ") وبقي " + ui.fmt(left) + " صورة." : ".") + " الحلول: ١) اختر «٥» في «صور في الطلب» فتُقرأ عدة صور بطلب واحد وتتسع الحصة، ٢) جرّب «سريع (نموذج أخف)» فحصته منفصلة، ٣) بدّل المزوّد إلى Claude إن كان مفتاحه مضبوطاً، ٤) فعّل الفوترة لمفتاح Gemini فيزول الحد، ٥) أو أكمل غداً.";
  async function sigReadImages() {
    const c = state.sig;
    if (!c.files.length) throw new Error("أضف صور الأوراق أولاً.");
    if (!App.ai || !App.ai.hasKey()) throw new Error("NO_KEY");
    c.files.forEach((f) => { if (!f.key) f.key = sigFileKey(f); });
    const pending = c.files.filter((f) => !(c.fileKeys || []).includes(f.key));
    const skipped = c.files.length - pending.length;
    if (!pending.length) { c.files = []; state.resultError = "هذه الصور سبق قراءتها في الجلسة الحالية، فلم أقرأها مرة ثانية."; return render(); }
    if (skipped) ui.toast("تُجوِّزت " + ui.fmt(skipped) + " صورة سبق قراءتها");
    c.reading = true; c.prog = "جارٍ قراءة الصور…"; c.failed = []; render();
    if (App.ai && App.ai.resetKeyStats) App.ai.resetKeyStats();
    const t0 = Date.now(); let dn = 0, tot = pending.length;
    const tick = setInterval(() => { c.prog = (dn ? "قُرئت " + dn + " من " + tot + " صورة" : "جارٍ قراءة " + tot + " صورة" + (App.ai && App.ai.keyCount && App.ai.keyCount() > 1 ? " بـ " + App.ai.keyCount() + " مفاتيح" : "")) + " · " + Math.round((Date.now() - t0) / 1000) + " ث"; const el = document.getElementById("cc-sig-prog"); if (el) el.textContent = c.prog; }, 1000);
    try {
      const r = await App.centerSign.readSheets(pending, { fast: c.fast, batch: c.batch, onProgress: (d, n) => { dn = d; tot = n; c.prog = "قُرئت " + d + " من " + n + " صورة…"; const el = document.getElementById("cc-sig-prog"); if (el) el.textContent = c.prog; } });
      const failedNames = new Set(r.failed.map((x) => x.name)), keyOf = new Map(pending.map((f) => [f.name, f.key]));
      const add = r.rows.map((x) => Object.assign({ keep: true }, x, { form: "" }, { id: String(keyOf.get(x.file) || "").replace(/\W/g, "").slice(-6) + "|" + x.id }));
      add.forEach((x) => { x.form = sigAssignForm(x, c.formName); });
      c.rows = (c.rows || []).concat(add); c.failed = r.failed; c.titles = (c.titles || []).concat(r.titles);
      c.fileKeys = c.fileKeys || []; c.done = c.done || [];
      pending.forEach((f) => { if (!failedNames.has(f.name)) { c.fileKeys.push(f.key); c.done.push({ name: f.name, key: f.key, rows: add.filter((x) => x.file === f.name).length, at: new Date().toISOString() }); } });
      c.files = c.files.filter((f) => failedNames.has(f.name));   // ما قُرئ يُزال من الانتظار، وما أخفق يبقى لإعادة المحاولة
      if (r.quota) state.resultError = QUOTA_HELP(add.length, r.failed.length);
      else if (!add.length && !r.failed.length) state.resultError = "لم أجد أسماء في الصور. تأكد أن الصورة واضحة وتظهر فيها قائمة الأسماء.";
      else state.resultError = "";
    } finally { clearInterval(tick); c.reading = false; c.prog = ""; const vl = App.ai && App.ai.visionLast; c.took = Math.round((Date.now() - t0) / 1000) + " ث" + (vl && vl.model ? " · " + vl.model : "") + sigKeysNote(); try { sigLearnAuto(); } catch (e) { /* */ } render(); }
  }
  /* توزيع الطلبات على المفاتيح بعد القراءة، مثل « · 3 مفاتيح (4/4/3 طلبات)» */
  function sigKeysNote() {
    const st = App.ai && App.ai.keyStats ? Object.values(App.ai.keyStats()) : [], n = App.ai && App.ai.keyCount ? App.ai.keyCount() : 1;
    return n > 1 && st.length ? " · " + n + " مفاتيح (" + st.sort((a, b) => b - a).join("/") + " طلبات)" : "";
  }
  /* ===== بحث بالاسم في كل النظام عمّن لا هوية ولا جوال له ولم يُطابَق =====
     القراءة بالهوية/الجوال لا تنفع مع اسم بلا رقم، فيُبحث بالاسم في النظام كله (لا في المرحلة المختارة وحدها) بصيغ متعددة
     لأن البحث نصٌّ متصل: الاسم كاملاً، ثم أول اسمين، ثم آخر اسمين (يلتقط خطأً في الوسط). المرشحون يُقيَّمون بتشابه الأسماء. قراءة فقط. */
  const NAME_Q_MAX = 260;
  /* البحث في النظام حرفي: «أحمد» لا تجد «احمد»، و«نادر الطويل» لا تجد «نادر صابر الطويل». فتُجرَّب صيغ الاسم بهمزاته وبتوحيدها،
     وإن لم يظهر مرشح قوي بعد المرحلة الأولى فتُجرَّب كلماته منفردة (يُقيَّم المرشحون بالتشابه فلا يضرّ اتساع النتائج) */
  const sigNorm = (t) => String(t || "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  const sigToks = (name) => clean(name).split(" ").filter((x) => x.length > 1);
  const uniq = (a) => a.filter((q, i) => q && a.indexOf(q) === i);
  function sigNameQueries(name, wide) {
    const t = sigToks(name); if (!t.length) return [];
    if (wide) return uniq(t.filter((x) => x.length >= 3).flatMap((x) => [x, sigNorm(x)]));
    const forms = [t.join(" ")];
    if (t.length > 2) forms.push(t.slice(0, 2).join(" "), t.slice(-2).join(" "));
    if (t.length > 3) forms.push(t.slice(0, 3).join(" "));
    return uniq(forms.flatMap((q) => [q, sigNorm(q)]));
  }
  function sigPendingNameSearch() {
    const c = state.sig; if (!c.reg || !c.rows) return [];
    const seen = new Set(), out = [];
    sigForms().forEach((fm) => { const o = sigCompute(fm); if (o) o.orphans.forEach((f) => { if (seen.has(f.id) || (c.nameHits || {})[f.id]) return; const lk = (c.lookups || {})[f.id]; if (lk && lk.list && lk.list.length) return; seen.add(f.id); out.push(f); }); });
    return out;
  }
  /* أجزاء أرقام الصف للبحث: أول 6 وآخر 6 من الهوية، وآخر 7 من الجوال (البحث في النظام نصّي) */
  function sigDigitQueries(f) {
    const id = digits(f.nid), ph = phoneNorm(f.phone), out = [];
    if (id.length >= 8) out.push(id.slice(0, 6), id.slice(-6));
    if (ph.length >= 9) out.push(ph.slice(-7));
    return out.filter((q, i) => out.indexOf(q) === i);
  }
  /* تقييم مرشح من النظام لصف مقروء بكل الأدلة: الاسم + أرقام بفرق خانة + المسار */
  function sigCandScore(f, s) {
    const U = App.ccUtil, nameless = /^\(بلا اسم/.test(f.name) || !U.nameTokens(f.name).length;
    let sc = nameless ? 0 : U.nameScore(f.name, s.name);
    const id = digits(f.nid), ph = phoneNorm(f.phone), sid = digits(s.id), sph = phoneNorm(s.phone);
    const idNear = id.length >= 8 && sid.length >= 8 && U.digitDist(id, sid) <= 1, phNear = ph.length >= 9 && sph.length >= 9 && U.digitDist(ph.slice(-9), sph.slice(-9)) <= 1;
    if ((idNear || phNear) && (nameless || sc >= 0.45)) sc = Math.max(sc, 0.93);
    const st = U.sameTrack(sigTrackOf(f), s.track);
    if (st === true) sc = Math.min(1, sc + 0.05); else if (st === false) sc *= 0.8;
    return sc;
  }
  async function sigNameSearch() {
    const c = state.sig; c.nameHits = c.nameHits || {};
    const targets = sigPendingNameSearch().slice(0, 40);
    if (!targets.length) return 0;
    const cand = new Map(targets.map((f) => [f.id, new Map()]));
    const pass = async (people, wide) => {
      const qs = new Map();   // الاستعلام ← من يحتاجه
      const add = (q, f) => { if (!qs.has(q) && qs.size < NAME_Q_MAX) qs.set(q, []); if (qs.has(q) && !qs.get(q).includes(f)) qs.get(q).push(f); };
      people.forEach((f) => {
        if (!/^\(بلا اسم/.test(f.name)) sigNameQueries(f.name, wide).forEach((q) => add(q, f));
        if (!wide) sigDigitQueries(f).forEach((q) => add(q, f));   // أجزاء الهوية/الجوال: تلتقط رقماً مقروءاً بخطأ خانة
      });
      const list = [...qs.keys()]; if (!list.length) return;
      const r = (await runCommands([{ type: "lookup", label: "بحث بالاسم في كل النظام", items: list.map((q) => ({ q })) }], { noCache: true }))[0];
      ((r && r.items) || []).forEach((it, i) => {
        if (!it || !it.count) return;
        const ppl = it.rows.map((x) => stuFrom(it, x));
        (qs.get(list[i]) || []).forEach((f) => ppl.forEach((s) => { const sc = sigCandScore(f, s); if (sc >= 0.62) { const k = s.stu || s.id || s.name, m = cand.get(f.id); if (!m.has(k) || m.get(k).score < sc) m.set(k, { s, score: sc }); } }));
      });
    };
    await pass(targets, false);
    const weak = (f) => { let b = 0; cand.get(f.id).forEach((x) => { if (x.score > b) b = x.score; }); return b < 0.8; };
    await pass(targets.filter(weak), true);
    targets.forEach((f) => {
      const list = [...cand.get(f.id).values()].sort((a, b) => b.score - a.score).slice(0, 4);
      c.nameHits[f.id] = { list, at: Date.now() };
      /* مرشح واحد قوي وبعيد عن الثاني: يُعتمد (بالاسم) فيظهر باسمه في النظام أو يُربط بمسجّل إن كان في القائمة */
      if (list.length && list[0].score >= 0.85 && (list.length === 1 || list[0].score - list[1].score >= 0.1)) { c.lookups = c.lookups || {}; c.lookups[f.id] = { q: f.name, list: [list[0].s], by: "name", score: list[0].score }; }
    });
    return targets.length;
  }
  async function runSigNameSearch() {
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const n = await sigNameSearch(), found = Object.values(state.sig.nameHits || {}).filter((h) => h.list.length).length;
      ui.toast(n ? "بحثتُ عن " + ui.fmt(n) + " اسماً في النظام، وجدتُ مرشحين لـ" + ui.fmt(found) : "لا أسماء تحتاج بحثاً");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  async function runSigLookup() {
    const c = state.sig;
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      await sigResolve(); sigLearnAuto();
      ui.toast("انتهى البحث في النظام");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  async function runSign() {
    const c = state.sig;
    if (!c.rows || !c.rows.length) { state.resultError = "اقرأ الصور أولاً، ثم اجلب المسجلين."; return render(); }
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const cmds = sigCommands();
      const results = await runCommands(cmds);
      c.reg = sigRegistered(results); c.regScope = sigScopeNow(); c.regAt = new Date().toISOString();
      if (!c.reg.length) throw new Error("لم أجد مسجلين في المرحلة المختارة. تحقق من المرحلة والمسار وحالة الطالب.");
      c.manual = c.manual || {};
      state.progress = "أبحث في النظام بالهوية أو الجوال عمّن لم يُطابَق…";
      try { await sigResolve(); } catch (e) { if (/الجلسة|NO_AGENT/.test(String(e && e.message))) throw e; /* البحث مكمِّل: إخفاقه لا يُسقط المقارنة */ }
      sigLearnAuto();
      const n = sigUnsignedRows().length;
      ui.toast(n ? "⚠ " + ui.fmt(n) + " مسجّلاً لم يوقّعوا" : "كل المسجلين وقّعوا ✓");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  function sigSessionBar() {
    const c = state.sig; if (!(c.rows && c.rows.length) && !c.reg) return "";
    const nImg = (c.done || []).length, nRows = (c.rows || []).filter((r) => r.keep !== false).length;
    const when = (iso) => { try { return new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }); } catch (e) { return ""; } };
    const stale = c.reg && c.regScope && c.regScope !== sigScopeNow();
    return `<div class="cc-alert ok cc-sig-ses" role="status"><span>💾 <b>جلسة محفوظة</b> على هذا الجهاز: ${ui.fmt(nImg)} صورة مقروءة · ${ui.fmt(nRows)} اسماً${c.reg ? " · " + ui.fmt(c.reg.length) + " مسجّلاً جُلبوا" + (c.regAt ? " (" + esc(when(c.regAt)) + ")" : "") + (c.regScope ? " من: " + esc(sigScopeText(c.regScope)) : "") : " · لم تُجلب قائمة المسجلين بعد"}.</span><button type="button" class="btn secondary small" data-cc="sig-clear">امسح الجلسة وابدأ من جديد</button></div>
      <p class="cc-note">🧠 ذاكرة التصحيحات: <b>${ui.fmt(Object.keys(sigLearnGet()).length)}</b> اسماً مقروءاً رُبط بمسجّل سابقاً (يُعرَف تلقائياً في الأوراق القادمة) · ${ui.fmt(Object.keys(sigBlockGet()).length)} حظر «ليس هو» <button type="button" class="cc-link" data-cc="sig-learn-clear">امسح الذاكرة</button></p>
      ${stale ? '<p class="cc-alert warn">النطاق المختار الآن يختلف عن النطاق الذي جُلب منه المسجلون المحفوظون. اضغط «حدّث المسجلين من النظام» إن أردت المقارنة بالنطاق الجديد.</p>' : ""}
      ${sigForms().length > 1 || sigForms()[0] !== SIG_DEF_FORM ? `<details class="cc-help"><summary>النماذج (${ui.fmt(sigForms().length)}) — غيّر الاسم لتوحيد نموذجين أو تصحيحه</summary><div class="cc-grid">${sigForms().map((f) => `<label class="cc-field"><span>${ui.fmt((c.rows || []).filter((r) => r.keep !== false && sigFormOf(r) === f).length)} اسماً</span><input type="text" data-sig-fname="${esc(f)}" value="${esc(f)}"></label>`).join("")}</div></details>` : ""}
      ${nImg ? `<details class="cc-help"><summary>الصور التي قُرئت (${ui.fmt(nImg)})</summary><div class="cc-note">${c.done.map((d) => esc(sigShort(d.name)) + " — " + ui.fmt(d.rows) + " اسم").join("<br>")}</div></details>` : ""}`;
  }

  /* ===== مصدر ثانٍ لمطابقة التوقيعات: ملف Excel بأسماء (بدل الصور أو معها) ===== */
  const SIG_NO_RX = /^(لا|لم|غير|بدون|no|false|0|-|—|×|✗|x)$/i;
  function sigTrackOf(f) {
    if (!f) return "";
    const direct = clean(f.track || f.trackAuto);
    if (direct) return direct;
    const text = App.ccUtil.arKey([f.titleAuto, f.formAuto, f.form].filter(Boolean).join(" "));
    if (!text) return "";
    const hit = trackOpts().map((o) => o.t).find((t) => { const k = App.ccUtil.trackKey(t); return k.length >= 4 && text.includes(k); });
    return hit || "";
  }
  const sigXlTrackCol = (heads) => heads.findIndex((h) => /^(ال)?مسار|المسار الحالي|^track/i.test(clean(h)));
  const sigXlFormCol = (heads) => heads.findIndex((h) => /نوع النموذج|اسم النموذج|^النموذج|^نموذج/.test(h));
  function sigXlView() {
    const x = state.sig.xl, opt = (i, cur, txt) => `<option value="${i}" ${Number(cur) === i ? "selected" : ""}>${esc(txt)}</option>`;
    const head = `<details class="cc-help cc-sigxl" ${x || state.sig.xlErr ? "open" : ""}><summary><b>أو ملف Excel بأسماء</b> — مصدر ثانٍ يُضاف إلى المقارنة نفسها (بدل الصور أو معها)</summary>
      <label class="cc-field cc-wide"><span>ملف Excel (.xlsx) فيه أسماء من وقّعوا أو حضروا</span><input type="file" id="cc-sig-xl" accept=".xlsx"></label>`;
    const err = state.sig.xlErr ? `<p class="cc-alert err" role="alert">⚠ ${esc(state.sig.xlErr)}</p>` : "";
    if (!x) return head + err + `<p class="cc-note">يُقرأ الملف على جهازك فقط. تختار بعدها عمود الاسم (والهوية والجوال إن وُجدا) وكيف يُعدّ التوقيع.</p></details>`;
    const sh = x.sheets[x.sheet] || x.sheets[0], hs = sh.heads, m = x.map;
    const colSel = (k, none) => `<label class="cc-field"><span>${{ name: "عمود الاسم", id: "عمود الهوية", phone: "عمود الجوال", sign: "عمود التوقيع", form: "عمود النموذج (اختياري)", track: "عمود المسار (يحسّن الدقة)" }[k]}</span><select data-sigxl="${k}">${k === "sign" ? opt(-1, m.sign, "لا عمود: كل من في الملف موقّع") : opt(-1, m[k], none)}${hs.map((h, i) => opt(i, m[k], h)).join("")}</select></label>`;
    const n = sh.rows.filter((r) => clean(r[m.name]) || digits(r[m.id]).length >= 8 || phoneNorm(r[m.phone]).length >= 9).length;
    return head + `<p class="cc-note">الملف: <b>${esc(x.name)}</b> · ${ui.fmt(n)} اسماً في الورقة المختارة. <button type="button" class="cc-link" data-cc="sig-xl-clear">إزالة الملف</button></p>
      <div class="cc-grid">${x.sheets.length > 1 ? `<label class="cc-field"><span>الورقة</span><select data-sigxl="sheet">${x.sheets.map((s, i) => opt(i, x.sheet, s.name)).join("")}</select></label>` : ""}${colSel("name", "— اختر —")}${colSel("id", "— بلا —")}${colSel("phone", "— بلا —")}${colSel("form", "— بلا: نموذج واحد —")}${colSel("track", "— بلا —")}${colSel("sign", "")}</div>
      <p class="cc-note">عمود التوقيع (إن اخترتَه): الخلية الفارغة أو «لا / غير / ×» تعني <b>لم يوقّع</b>، وغير ذلك <b>وقّع</b>.</p>
      <div class="cc-row"><button type="button" class="btn navy" data-cc="sig-xl-add" ${m.name >= 0 && n ? "" : "disabled"}>أضف أسماء الملف إلى المقارنة</button></div></details>`;
  }
  function sigXlAdd() {
    const c = state.sig, x = c.xl; if (!x) return;
    const sh = x.sheets[x.sheet] || x.sheets[0], m = x.map; if (m.name < 0) return ui.toast("اختر عمود الاسم");
    const key = "xl:" + x.name + ":" + x.size + ":" + sh.name + ":" + m.name + ":" + m.sign + ":" + m.form + ":" + m.track;
    c.fileKeys = c.fileKeys || []; c.done = c.done || [];
    if (c.fileKeys.includes(key)) { state.resultError = "هذا الملف بهذه الأعمدة سبقت إضافته في الجلسة."; return render(); }
    const tag = String(key.length) + sh.rows.length, add = [];
    sh.rows.forEach((r, i) => {
      const nid0 = m.id >= 0 ? digits(r[m.id]) : "", ph0 = m.phone >= 0 ? phoneNorm(r[m.phone]) : "";
      let name = clean(r[m.name]);
      if (!name) { if (nid0.length >= 8 || ph0.length >= 9) name = "(بلا اسم" + (nid0 ? " — هوية " + nid0 : " — جوال " + ph0) + ")"; else return; }   // يُطابَق بالهوية/الجوال
      const sv = m.sign >= 0 ? clean(r[m.sign]) : "";
      const signed = m.sign < 0 ? true : !!sv && !SIG_NO_RX.test(sv);
      const row = { id: "xl" + tag + "|" + x.name + ":" + i, file: x.name, name, nid: nid0, phone: ph0, signed, conf: 1, keep: true, formAuto: m.form >= 0 ? clean(r[m.form]) : "", track: m.track >= 0 ? clean(r[m.track]) : "" };
      row.form = sigAssignForm(row, m.form >= 0 ? "" : c.formName); add.push(row);
    });
    if (!add.length) { state.resultError = "لا أسماء في العمود المختار."; return render(); }
    c.rows = (c.rows || []).concat(add); c.fileKeys.push(key); c.done.push({ name: x.name, key, rows: add.length, at: new Date().toISOString() });
    c.xl = null; c.xlErr = ""; state.resultError = ""; try { sigLearnAuto(); } catch (e) { /* */ }
    sigSaveSoon(); ui.toast("أُضيف " + ui.fmt(add.length) + " اسماً من الملف"); render();
  }
  function sigView() {
    const c = state.sig, ai = App.ai && App.ai.settings ? App.ai.settings() : {};
    const hasKey = App.ai && App.ai.hasKey && App.ai.hasKey();
    const provider = ai.provider === "claude" ? "Claude" : "Gemini";
    const statusOpts = (filterField("status").options || []);
    return `<section class="cc-card" id="cc-sig">
      <header class="cc-card-h"><h3>مطابقة التوقيعات</h3><p>ارفع صور أوراق التوقيع، فيقرأ الذكاء الاصطناعي الأسماء ويحكم أيوجد توقيع، ثم تُقارَن بالمسجلين في المرحلة التي تختارها من «النطاق» لتعرف من لم يوقّع. للقراءة فقط، والمقارنة بطلب منك وحدك.</p></header>
      <div class="cc-card-b">
        ${sigSessionBar()}
        <datalist id="cc-sig-forms">${sigForms().filter((f) => f !== SIG_DEF_FORM).map((f) => `<option value="${esc(f)}">`).join("")}</datalist>
        <label class="cc-field cc-wide"><span>اسم النموذج لهذه الدفعة (اختياري)</span><input type="text" list="cc-sig-forms" data-sig="form" value="${esc(c.formName || "")}" placeholder="اتركه فارغاً ليُستخرج من عنوان كل ورقة"></label>
        <label class="cc-field cc-wide"><span>١. صور الأوراق (JPG أو PNG، أضف دفعة بعد دفعة؛ تُضاف إلى ما قُرئ سابقاً)</span><input type="file" id="cc-sig-files" accept="image/*" multiple></label>
        ${c.files.length ? `<div class="cc-sig-thumbs">${c.files.map((f, i) => `<figure><img src="${f.thumb}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption><button type="button" class="cc-link" data-cc="sig-rm" data-i="${i}">إزالة</button></figure>`).join("")}</div>` : ""}
        ${sigXlView()}
        <p class="cc-note">🔒 تُرسَل الصور إلى <b>${provider}</b> بمفتاحك لقراءتها فقط، ولا تُحفظ في تمكين ولا تُرفع إلى أي مكان آخر. وفيها أسماء متدربين.${hasKey ? "" : ' <b class="cc-bad">لا يوجد مفتاح ذكاء اصطناعي: أضفه من صفحة «المراسلات والتقارير» ← إعدادات الذكاء الاصطناعي.</b>'}</p>
        <div class="cc-row"><button type="button" class="btn navy" data-cc="sig-read" ${c.files.length && !c.reading ? "" : "disabled"}>${c.reading ? "جارٍ القراءة…" : "٢. اقرأ الصور"}</button><label class="cc-field" style="min-width:0"><span>السرعة</span><select data-sig="speed"><option value="" ${c.fast ? "" : "selected"}>دقيق (افتراضي)</option><option value="fast" ${c.fast ? "selected" : ""}>سريع (نموذج أخف)</option></select></label><label class="cc-field" style="min-width:0" title="إرسال عدة صور في طلب واحد يوفّر الحصة المجانية اليومية"><span>صور في الطلب</span><select data-sig="batch">${[1, 2, 3, 5].map((n) => `<option value="${n}" ${Number(c.batch) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><span class="cc-note" id="cc-sig-prog">${esc(c.prog || (c.took ? "آخر قراءة: " + c.took : ""))}</span></div>
        ${c.failed.length ? `<p class="cc-alert warn">تعذّرت قراءة ${ui.fmt(c.failed.length)} صورة: ${c.failed.map((x) => esc(x.name + " (" + x.error + ")")).join("، ")}</p>` : ""}
        ${c.rows ? (c.reg ? `<details class="cc-help cc-sig-rows-fold"><summary><b>الأسماء المقروءة من الأوراق</b> (${ui.fmt((c.rows || []).filter((x) => x.keep !== false).length)}) — لتصحيح اسم أو توقيع</summary>${sigRowsEditor()}</details>` : sigRowsEditor()) : ""}
        <div class="cc-grid"><label class="cc-field"><span>حالة الطالب في المقارنة</span><select data-sig="status"><option value="">كل الحالات</option>${statusOpts.filter((o) => o.v !== "").map((o) => `<option value="${esc(o.v)}" ${String(c.status) === String(o.v) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></div>
        <p class="cc-note">٣. اختر <b>المرحلة</b> (والمسار والمجموعة إن شئت) من شريط «النطاق» أعلاه، ثم اضغط «${c.reg ? "حدّث المسجلين من النظام" : "اجلب المسجلين وقارن"}». ${c.reg ? "المسجلون محفوظون فلا حاجة لجلبهم في كل مرة: أضف صوراً جديدة واقرأها فتُحدَّث النتيجة فوراً." : ""}</p>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-sig"))} أمر قراءة</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-sig" ${state.busy || !(c.rows && c.rows.length) ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : c.reg ? "حدّث المسجلين من النظام" : "اجلب المسجلين وقارن"}</button>${c.reg && sigPendingNameSearch().length ? `<button type="button" class="btn secondary" data-cc="sig-namesearch" ${state.busy ? "disabled" : ""} title="قراءة من نظام المركز بالاسم في كل المراحل، لمن لا هوية ولا جوال له ولم يُطابَق">ابحث بالاسم في كل النظام (${ui.fmt(sigPendingNameSearch().length)})</button>` : ""}${c.reg && sigPendingLookups().length ? `<button type="button" class="btn secondary" data-cc="sig-lookup" ${state.busy ? "disabled" : ""} title="قراءة من النظام بالهوية أو الجوال فقط، لمن لم يُطابَق">ابحث في النظام عمّن لم يُطابَق (${ui.fmt(sigPendingLookups().length)})</button>` : ""}</div></footer></section>`;
  }
  const scopeSummaryText = () => { const sc = scopeNow(); return [sc.stages.length ? "المراحل: " + sc.stages.join("، ") : "", sc.tracks.length ? "مسارات: " + trackNamesOf(sc.tracks).join("، ") : "", (state.groups || []).length ? "مجموعات: " + state.groups.join("، ") : ""].filter(Boolean).join(" · ") || "اختر النطاق"; };
  function sigRowsEditor() {
    const c = state.sig, rows = c.rows;
    const signed = rows.filter((r) => r.keep !== false && r.signed === true).length, unsure = rows.filter((r) => r.keep !== false && (r.signed === null || r.conf < 0.6)).length;
    return `<div class="cc-sig-rows"><h4>الأسماء المقروءة <small>${ui.fmt(rows.filter((r) => r.keep !== false).length)} اسماً · ${ui.fmt(signed)} موقّعاً${unsure ? " · " + ui.fmt(unsure) + " تحتاج نظرتك" : ""}</small></h4>
      <p class="cc-note">راجع القراءة قبل المقارنة: صحّح الاسم، وفعّل «وقّع» إن رأيتَ توقيعاً لم يُلتقط، واحذف ما ليس متدرباً. السطور الصفراء قراءتها غير مؤكدة.</p>
      <div class="cc-scroll"><table class="cc-table"><thead><tr><th>الاسم كما قُرئ</th><th>النموذج</th><th>رقم الهوية</th><th>الجوال</th><th>وقّع</th><th>الثقة</th><th>الورقة</th><th></th></tr></thead><tbody>${rows.map((r, i) => r.keep === false ? "" : `<tr class="${r.signed === null || r.conf < 0.6 ? "cc-sig-unsure" : ""}"><td><input type="text" value="${esc(r.name)}" data-sig-name="${i}" aria-label="الاسم"></td><td><input type="text" list="cc-sig-forms" value="${esc(r.form || "")}" placeholder="${esc(SIG_DEF_FORM)}" data-sig-form="${i}" aria-label="النموذج" size="12"></td><td><input type="text" inputmode="numeric" value="${esc(r.nid || "")}" data-sig-nid="${i}" aria-label="رقم الهوية" size="11"></td><td><input type="text" inputmode="numeric" value="${esc(r.phone || "")}" data-sig-phone="${i}" aria-label="الجوال" size="10"></td><td><input type="checkbox" data-sig-signed="${i}" ${r.signed === true ? "checked" : ""} aria-label="وقّع">${r.signed === null ? ' <small>؟</small>' : ""}</td><td>${Math.round(r.conf * 100)}%</td><td><small>${esc(r.file)}</small></td><td><button type="button" class="cc-link" data-cc="sig-del" data-i="${i}">حذف</button></td></tr>`).join("")}</tbody></table></div>
      <div class="cc-row"><button type="button" class="btn secondary small" data-cc="sig-add">+ اسم ناقص</button></div></div>`;
  }
  function sigResultFor(form, idx, multi) {
    const c = state.sig, o = sigCompute(form), K = (k) => k + (multi ? "-" + idx : ""), FM = esc(form);
    if (!o) return "";
    const cnt = (st) => o.items.filter((x) => x.st === st).length;
    const miss = o.items.filter((x) => x.st === "absent" || x.st === "blank"), review = o.items.filter((x) => x.st === "review");
    const tbl = (k, items) => dataTable(k, sigHeads(), items.map(sigRowCells));
    /* الخلاصة البسيطة: أربع قوائم واضحة بأعدادها، قائمة واحدة تُعرض في كل مرة */
    const TABS = [["absent", "لا يظهر اسمهم في الأوراق", o.items.filter((x) => x.st === "absent").length], ["blank", "اسمهم في الورقة بلا توقيع", o.items.filter((x) => x.st === "blank").length], ["signed", "وقّعوا", cnt("signed")], ["orph", "أسماء في الأوراق غير معروفة", o.orphans.length + o.lost.length]];
    c.view = c.view || {}; const vk = String(idx || 0);
    let cur = c.view[vk]; if (!TABS.some((t) => t[0] === cur)) cur = (TABS.find((t) => t[2] > 0) || TABS[0])[0];
    const tabBody = cur === "orph" ? dataTable(K("sv-orph"), ["الاسم المقروء", "الحكم", "الورقة", "نتيجة البحث في النظام"], o.orphans.concat(o.lost).map((f) => [f.name, f.signed === true ? "موقّع" : f.signed === false ? "بلا توقيع" : "غير محسوم", sigShort(f.file), sigLookupText(f)]))
      : tbl(K("sv-" + cur), o.items.filter((x) => x.st === cur));
    /* تدقيق: كل اسم مقروء يجب أن يكون في موضع واحد معروف؛ غير المحسوب (بلا توقيع ولا يطابق أحداً) يُذكر صراحةً */
    const nMatched = o.items.filter((x) => x.found).length, nUnk = o.orphans.length + o.lost.length, nLost = o.found.length - nMatched - o.resolved.length - nUnk;
    const audit = `تدقيق: قُرئ <b>${ui.fmt(o.found.length)}</b> اسماً في الأوراق ← طابق مسجّلين <b>${ui.fmt(nMatched)}</b>، وعُرف بالبحث من خارج القائمة <b>${ui.fmt(o.resolved.length)}</b>، وغير معروف <b>${ui.fmt(nUnk)}</b>${o.lost.length ? ` (منهم <b>${ui.fmt(o.lost.length)}</b> بلا توقيع)` : ""}${nLost > 0 ? `، و<b>${ui.fmt(nLost)}</b> غير محسوب (راجع «الأسماء المقروءة»)` : ""}. ${nUnk ? "بقي أسماء غير معروفة: في زر «أسماء في الأوراق غير معروفة» أعلاه." : "✓ كل الأسماء المقروءة معروفة."}`;
    const summary = `<div class="cc-sigsum"><div class="cc-sigsum-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" aria-selected="${t[0] === cur}" class="cc-sigsum-tab${t[0] === cur ? " on" : ""}${t[0] === "signed" ? " ok" : t[0] === "orph" ? "" : " bad"}" data-cc="sig-view" data-v="${t[0]}" data-idx="${idx || 0}"><b>${ui.fmt(t[2])}</b> ${t[1]}</button>`).join("")}</div>
      ${TABS.find((t) => t[0] === cur)[2] ? tabBody : '<p class="cc-note">لا أحد في هذه القائمة.</p>'}
      ${review.length ? `<p class="cc-note">و<b>${ui.fmt(review.length)}</b> يحتاجون مراجعتك: افتح «التفاصيل والمراجعة» أدناه.</p>` : ""}
      <p class="cc-note cc-sigaudit">${audit}</p></div>`;
    /* ===== العرض المبسّط: ثلاثة جداول فقط ===== */
    const okItems = o.items.filter((x) => x.st === "signed" || x.st === "review");
    const t1 = okItems.map((x) => [x.reg.name, x.reg.id, x.reg.phone, grpCode(x.reg.group) || x.reg.group, x.found ? x.found.name : "", x.how, x.st === "signed" ? "✓ وقّع" : "؟ يحتاج مراجعة"])
      .concat(o.resolved.map((x) => [x.s.name, x.s.id || x.f.nid || "", x.s.phone || x.f.phone || "", x.s.group || "", x.f.name, "من النظام (خارج قائمة المرحلة المختارة)", x.f.signed === true ? "✓ وقّع" : "غير محسوم"]));
    const t2 = miss.map((x) => [x.reg.name, x.reg.id, x.reg.phone, grpCode(x.reg.group) || x.reg.group, x.st === "blank" ? "اسمه في الورقة بلا توقيع" : "لا يظهر اسمه في الأوراق"]);
    const unk = o.orphans.concat(o.lost).sort((a, b) => (sigTrackOf(a) || "ي").localeCompare(sigTrackOf(b) || "ي", "ar")), t3 = unk.map((f) => [f.name, f.nid || "", f.phone || "", (sigTrackOf(f) || "—").replace(/^مسار\s*/, ""), f.signed === true ? "موقّع" : f.signed === false ? "بلا توقيع" : "غير محسوم", sigShort(f.file), sigLookupText(f)]);
    const box3 = (k, title, badge, bad, heads, rows, empty, top) => `<article class="cc-res cc-sig3"><header class="cc-res-h"><div class="cc-res-t"><h4>${title}</h4><span class="cc-badge${bad && rows.length ? " bad" : ""}">${ui.fmt(rows.length)}</span></div></header>${top || ""}${rows.length ? dataTable(K(k), heads, rows) : `<p class="cc-note">${empty}</p>`}</article>`;
    const simple = `<div class="cc-sig-simple">
      ${box3("s3-found", "١. من وُجدوا في الأوراق", 0, false, ["الاسم", "رقم الهوية", "الجوال", "المجموعة", "الاسم في الورقة", "كيف عُرف", "الحالة"], t1, "لم يُطابَق أحد بعد.")}
      ${box3("s3-miss", "٢. المتبقون الذين لم يوقّعوا", 0, true, ["الاسم", "رقم الهوية", "الجوال", "المجموعة", "السبب"], t2, "✓ كل المسجلين وقّعوا.")}
      ${box3("s3-unk", "٣. أسماء من الأوراق لم تُعرف", 0, true, ["الاسم المقروء", "رقم الهوية", "الجوال", "المسار", "التوقيع", "الورقة", "نتيجة البحث في النظام"], t3, "✓ كل الأسماء المقروءة عُرفت.", multi ? "" : sigRetrackBar(unk))}
      ${review.length ? `<p class="cc-note">منهم <b>${ui.fmt(review.length)}</b> «يحتاج مراجعة» في الجدول الأول: أكّدهم أو ارفضهم من «التفاصيل والأدوات» أدناه.</p>` : ""}
      <div class="cc-stats"><button type="button" class="btn secondary small" data-cc="export-sig">تنزيل Excel</button></div></div>`;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٣</span> ${multi ? "النموذج: " + FM + " <small>(" + ui.fmt(o.found.length) + " اسماً مقروءاً)</small>" : "نتيجة المطابقة"}</h3>
      ${simple}
      <details class="cc-help cc-sigall"><summary><b>التفاصيل والأدوات</b> — المراجعة والتأكيد، ربط الأسماء غير المعروفة، البحث في النظام، والتدقيق</summary>
      ${summary}
      <details class="cc-help cc-sigall-in"><summary><b>التفاصيل والمراجعة</b> — كل المسجلين، ما يحتاج مراجعتك (${ui.fmt(review.length)})، وربط الأسماء غير المعروفة</summary>
      <details class="cc-help" open><summary><b>جدول المتابعة</b> — كل المسجلين (${ui.fmt(o.items.length)}) بحالة توقيع كل منهم؛ يكتمل كلما أضفتَ صوراً</summary>${dataTable(K("sig-all"), sigAllHeads(), o.items.map(sigAllRow))}</details>
      ${miss.length ? `<div class="cc-alert err" role="alert"><span>⚠ <b>${ui.fmt(miss.length)}</b> من ${ui.fmt(o.items.length)} مسجّلاً لم يوقّعوا.</span><button type="button" class="btn secondary small" data-cc="sig-copy" data-form="${FM}">نسخ قائمة غير الموقّعين</button></div>` : '<p class="cc-alert ok">✓ كل المسجلين وقّعوا.</p>'}
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.items.length)}</b> مسجّلاً</span><span class="cc-stat"><b>${ui.fmt(cnt("signed"))}</b> وقّعوا</span>${o.resolved.length ? `<span class="cc-stat"><b>${ui.fmt(o.resolved.length)}</b> عُرفوا بالهوية/الجوال (خارج القائمة)</span>` : ""}<span class="cc-stat"><b>${ui.fmt(cnt("absent"))}</b> لا يظهرون في الأوراق</span><span class="cc-stat"><b>${ui.fmt(cnt("blank"))}</b> بلا توقيع</span><span class="cc-stat"><b>${ui.fmt(review.length)}</b> تحتاج مراجعة</span><span class="cc-stat"><b>${ui.fmt(o.orphans.length)}</b> أسماء لا تطابق أحداً</span>
        <button type="button" class="btn secondary small" data-cc="export-sig">تنزيل Excel</button></div>
      ${review.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>تحتاج مراجعتك</h4><span class="cc-badge">${ui.fmt(review.length)}</span></div></header><p class="cc-note">تشابه جزئي بين اسم مسجّل واسم مقروء. أكّد أو ارفض.</p>
        <div class="cc-sig-rev">${review.map((x) => `<div class="cc-sig-r"><span><b>${esc(x.reg.name)}</b> ↔ ${x.found ? esc(x.found.name) : "—"} <small>${x.found ? Math.round(x.score * 100) + "%" + (x.found.signed === true ? " · موقّع" : x.found.signed === false ? " · بلا توقيع" : " · توقيع غير محسوم") + (x.how ? " · " + esc(x.how) : "") + (x.found.nid ? " · هوية " + esc(x.found.nid) : "") + (x.found.phone ? " · جوال " + esc(x.found.phone) : "") + (sigLookupText(x.found) ? " · <b>" + esc(sigLookupText(x.found)) + "</b>" : "") : ""}</small></span><span><button type="button" class="btn secondary small" data-cc="sig-ok" data-form="${FM}" data-k="${esc(x.reg.key)}" data-f="${x.found ? esc(x.found.id) : ""}">نعم هو</button> <button type="button" class="btn secondary small" data-cc="sig-no" data-form="${FM}" data-k="${esc(x.reg.key)}" data-f="${x.found ? esc(x.found.id) : ""}">ليس هو</button></span></div>`).join("")}</div></article>` : ""}
      ${miss.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>لم يوقّعوا</h4><span class="cc-badge bad">${ui.fmt(miss.length)}</span></div></header>${tbl(K("sig-miss"), miss)}</article>` : ""}
      ${o.resolved.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>عُرفوا بالهوية أو الجوال أو الاسم من نظام المركز</h4><span class="cc-badge">${ui.fmt(o.resolved.length)}</span></div></header><p class="cc-note">رقم الهوية أو الجوال المقروء (أو الاسم إن لم يكن له رقم وتشابه تشابهاً قوياً واضحاً) دلّ على طالب في النظام ليس ضمن قائمة المرحلة/الحالة المختارة، فعُرض باسمه في النظام ولو كان اسمه في الورقة مكتوباً خطأً.</p>${dataTable(K("sig-found"), sigFoundHeads(), o.resolved.map(sigFoundRow))}</article>` : ""}
      ${o.orphans.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>أسماء في الأوراق لا تطابق مسجّلاً في هذه المرحلة</h4><span class="cc-badge">${ui.fmt(o.orphans.length)}</span></div></header><p class="cc-note">قد تكون قراءة خاطئة أو متدرباً من مرحلة أخرى. إن كان أحدها لمسجّل فاختره:</p>
        <div class="cc-sig-rev">${o.orphans.map((f) => `<div class="cc-sig-r"><span><b>${esc(f.name)}</b> <small>${f.signed === true ? "موقّع" : "غير محسوم"} · ${esc(sigShort(f.file))}${sigLookupText(f) ? " · <b>" + esc(sigLookupText(f)) + "</b>" : ""}</small></span><select data-sig-assign="${esc(f.id)}" data-form="${FM}"><option value="">— ليس من المسجلين —</option>${miss.map((x) => `<option value="${esc(x.reg.key)}">${esc(x.reg.name)}</option>`).join("")}</select>${(((state.sig.nameHits || {})[f.id] || {}).list || []).map((x, k) => `<button type="button" class="btn secondary small" data-cc="sig-pick" data-f="${esc(f.id)}" data-k="${k}" title="اعتمد هذا الطالب من النظام">هو: ${esc(x.s.name)}${x.s.stage ? " · " + esc(x.s.stage) : ""}</button>`).join(" ")}</div>`).join("")}</div></article>` : ""}
      <details class="cc-help"><summary>الذين وقّعوا (${ui.fmt(cnt("signed"))})</summary>${cnt("signed") ? tbl(K("sig-ok"), o.items.filter((x) => x.st === "signed")) : '<p class="cc-note">لا أحد.</p>'}</details>
      </details>
      </details>
      <p class="cc-note">القراءة بالذكاء الاصطناعي قد تخطئ في الأسماء المكتوبة بخط اليد أو الصور غير الواضحة، فراجع «تحتاج مراجعتك» قبل أن تعتمد القائمة. لا يُكتب شيء في نظام المركز.</p></section>`;
  }

  /* ===== مقارنة ملف Excel خارجي بالمسجلين (هوية ← جوال ← اسم) ===== */
  const XL_COLS = [["name", "الاسم"], ["id", "رقم الهوية"], ["phone", "الجوال"], ["group", "المجموعة"]];
  const xlSheet = () => state.xl.sheets[state.xl.sheet] || null;
  function xlView() {
    const c = state.xl, sh = xlSheet(), statusOpts = (filterField("status").options || []);
    const colSel = (k, t) => `<label class="cc-field"><span>عمود ${t}</span><select data-xl="map-${k}"><option value="-1">— لا يوجد —</option>${sh.heads.map((h, i) => `<option value="${i}" ${Number(c.map[k]) === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`;
    return `<section class="cc-card" id="cc-xl">
      <header class="cc-card-h"><h3>مقارنة ملف Excel</h3><p>ارفع كشفاً من جهة أخرى (متدربون أو دفعات أو شهادات)، فيُقارَن بالمسجلين في المرحلة: من ينقص النظام، ومن ليس في الكشف، ومن اختلفت بياناته.</p></header>
      <div class="cc-card-b">
        <label class="cc-field cc-wide"><span>١. ملف الكشف (.xlsx)</span><input type="file" id="cc-xl-file" accept=".xlsx"></label>
        ${sh ? `<p class="cc-note">الملف: <b>${esc(c.name)}</b> · ${ui.fmt(sh.rows.length)} صفاً</p>
        <div class="cc-grid">${c.sheets.length > 1 ? `<label class="cc-field"><span>الورقة</span><select data-xl="sheet">${c.sheets.map((x, i) => `<option value="${i}" ${i === c.sheet ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}${XL_COLS.map(([k, t]) => colSel(k, t)).join("")}
        <label class="cc-field"><span>حالة الطالب في المقارنة</span><select data-xl="status"><option value="">كل الحالات</option>${statusOpts.filter((o) => o.v !== "").map((o) => `<option value="${esc(o.v)}" ${String(c.status) === String(o.v) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label></div>
        <p class="cc-note">راجع تخمين الأعمدة أعلاه (الهوية والجوال يجزمان المطابقة، والاسم وحده أضعف). ٢. اختر <b>المرحلة</b> من شريط «النطاق»، ثم اضغط «اجلب المسجلين وقارن».</p>` : ""}
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-xl"))} أمر قراءة</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-xl" ${state.busy || !sh ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اجلب المسجلين وقارن"}</button></div></footer>
    </section>`;
  }
  async function runXl() {
    const c = state.xl, sh = xlSheet();
    if (!sh) { state.resultError = "ارفع ملف Excel أولاً."; return render(); }
    if (Number(c.map.name) < 0 && Number(c.map.id) < 0 && Number(c.map.phone) < 0) { state.resultError = "اختر عمود الاسم أو الهوية أو الجوال على الأقل."; return render(); }
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const results = await runCommands(sigCommands(false, c));
      c.reg = sigRegistered(results);
      if (!c.reg.length) throw new Error("لم أجد مسجلين في المرحلة المختارة. تحقق من المرحلة والمسار وحالة الطالب.");
      const map = {}; XL_COLS.forEach(([k]) => { map[k] = Number(c.map[k]); if (isNaN(map[k])) map[k] = -1; });
      c.out = App.centerXl.compare(c.reg, sh, map); c.out.at = new Date();
      ui.toast("قورن " + ui.fmt(c.out.total.file) + " في الكشف بـ " + ui.fmt(c.out.total.system) + " مسجّلاً");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  function xlTables(o) {
    return {
      missing: { heads: ["الاسم", "الهوية", "الجوال", "المجموعة", "الصف في الكشف"], rows: o.missingInSystem.map((f) => [f.name, f.id, f.phone, f.group, String(f.n + 2)]) },
      notInFile: { heads: ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المجموعة", "الدورة"], rows: o.notInFile.map((r) => [r.name, r.stu, r.id, r.phone, r.group, r.course]) },
      diffs: { heads: ["الاسم في النظام", "الاسم في الكشف", "الهوية (نظام)", "الهوية (كشف)", "الجوال (نظام)", "الجوال (كشف)", "الفرق"], rows: o.diffs.map((d) => [d.reg.name, d.ext.name, d.reg.id, d.ext.id, d.reg.phone, d.ext.phone, d.why.join(" + ")]) },
    };
  }
  function xlResult() {
    const o = state.xl.out; if (!o) return "";
    const t = xlTables(o);
    const blk = (key, title, bad, hint) => t[key].rows.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${title}</h4><span class="cc-badge ${bad ? "bad" : ""}">${ui.fmt(t[key].rows.length)}</span></div></header><p class="cc-note">${hint}</p>${dataTable("xl-" + key, t[key].heads, t[key].rows)}</article>` : "";
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٣</span> نتيجة المقارنة</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.total.file)}</b> في الكشف</span><span class="cc-stat"><b>${ui.fmt(o.total.system)}</b> في النظام</span><span class="cc-stat"><b>${ui.fmt(o.matched.length)}</b> متطابقون</span><span class="cc-stat"><b>${ui.fmt(o.missingInSystem.length)}</b> ناقصون في النظام</span><span class="cc-stat"><b>${ui.fmt(o.notInFile.length)}</b> ليسوا في الكشف</span><span class="cc-stat"><b>${ui.fmt(o.diffs.length)}</b> بيانات مختلفة</span>
        <button type="button" class="btn secondary small" data-cc="export-xl">تنزيل Excel</button></div>
      ${blk("missing", "في الكشف ولا يظهرون في النظام", true, "لم يُطابَق أحد منهم بهوية ولا جوال ولا اسم قريب في هذه المرحلة. قد يكونون في مرحلة أخرى أو لم يُسجَّلوا بعد.")}
      ${blk("diffs", "مطابقون لكن بياناتهم مختلفة", false, "الفرق مبيَّن في العمود الأخير؛ ما اختلف بين الكشف والنظام يحتاج مراجعتك.")}
      ${blk("notInFile", "في النظام وليسوا في الكشف", false, "مسجّلون في هذه المرحلة ولم يردوا في الملف.")}
      ${!o.missingInSystem.length && !o.notInFile.length && !o.diffs.length ? '<p class="cc-alert ok">الكشف والنظام متطابقان تماماً ✓</p>' : ""}
    </section>`;
  }
  function xlExport() {
    const o = state.xl.out; if (!o) return;
    const t = xlTables(o), wb = new ExcelJS.Workbook();
    [["ناقص في النظام", t.missing], ["بيانات مختلفة", t.diffs], ["ليسوا في الكشف", t.notInFile]].forEach(([n, x]) => { if (x.rows.length) fmtSheet(wb.addWorksheet(n), x.heads, x.rows); });
    if (!wb.worksheets.length) return ui.toast("لا فروق لتنزيلها");
    return wb.xlsx.writeBuffer().then((b) => ui.download("مقارنة الكشف " + ui.todayISO() + ".xlsx", new Blob([b], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })));
  }

  /* ===== تقرير الصباح: حضور اليوم + الناقصون في تقييماتهم، وملخص واحد بنص واتساب ===== */
  function morningView() {
    const c = state.morning, today = ui.todayISO();
    return `<section class="cc-card" id="cc-morning">
      <header class="cc-card-h"><h3>تقرير الصباح</h3><p>بضغطة واحدة: يقرأ جلسات <b>اليوم</b> وغائبيها بحسب المجموعة، ويضيف (اختيارياً) من لم يكمل تقييماته، ثم يجمع الكل في ملخص ونص واتساب جاهز.</p></header>
      <div class="cc-card-b"><label class="cc-chk"><input type="checkbox" data-morning="mis" ${c.mis ? "checked" : ""}> <span>أضف الناقصين في التقييمات (قراءات أكثر)</span></label>
        <p class="cc-note">النطاق من شريط «النطاق» أعلاه؛ بلا اختيار تُقرأ كل المسارات. اليوم: ${esc(today)}.</p></div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-morning"))} أمر قراءة (تقدير أقصى)</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-morning" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "ابدأ تقرير الصباح"}</button></div></footer>
    </section>`;
  }
  async function runMorning() {
    state.att.from = state.att.to = ui.todayISO();
    await runAttend();
    if (state.morning.mis && !state.resultError && state.att.out) { state.mis.kind = "all"; await runMissing(); }
    render();
  }
  function morningText() {
    const o = state.att.out; if (!o) return "";
    const day = o.lastDay || ui.todayISO(), parts = [];
    const gs = attGroups();
    parts.push(`*تقرير الصباح — ${day}*`);
    parts.push(gs.length ? "*الغياب بحسب المجموعة:*\n" + gs.map((e) => `• ${e.track}${e.group ? " (" + e.group + ")" : ""}: ${e.absent.length}${e.total ? " من " + e.total : ""}`).join("\n") : "لا غياب مسجّل في آخر يوم.");
    const mo = state.mis.out;
    if (state.morning.mis && mo) parts.push(mo.rows.length ? `*ناقصو التقييمات (${mo.rows.length}):*\n` + Object.keys(mo.per).map((k) => `• ${k}: ${mo.per[k]}`).join("\n") : "كل الطلاب أكملوا التقييمات ✓");
    if (gs.length) parts.push("*أسماء الغائبين:*\n" + gs.map((e) => attGroupText(e, day)).join("\n\n"));
    return parts.join("\n\n");
  }
  function morningResult() {
    const o = state.att.out; if (!o) return "";
    const gs = attGroups(), sum = gs.reduce((n, e) => n + e.absent.length, 0), mo = state.morning.mis ? state.mis.out : null;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> ملخص الصباح</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.sessions || 0)}</b> جلسة</span><span class="cc-stat ${sum ? "bad" : "ok"}"><b>${ui.fmt(sum)}</b> غائباً آخر يوم</span>${mo ? `<span class="cc-stat ${mo.rows.length ? "bad" : "ok"}"><b>${ui.fmt(mo.rows.length)}</b> ناقصاً في التقييمات</span>` : ""}
        <button type="button" class="btn secondary small" data-cc="morning-copy">نسخ ملخص واتساب</button></div>
      ${attResult()}${mo ? missingResult() : ""}</section>`;
  }

  /* ===== جاهزية التخرج: الحضور والتقييمات ← من يستوفي الشروط ومن ينقصه شيء ===== */
  function gradView() {
    const c = state.grad, today = ui.todayISO();
    return `<section class="cc-card" id="cc-grad">
      <header class="cc-card-h"><h3>جاهزية التخرج</h3><p>يقرأ حضور الفترة (وتقييمات الطلاب إن شئت) ويحكم من يستوفي شروطك ومن ينقصه شيء وسبب النقص. الشروط تضعها أنت، ولا يُغيَّر شيء في نظام المركز.</p></header>
      <div class="cc-card-b"><div class="cc-grid">
        <label class="cc-field"><span>من تاريخ (بداية الدورة)</span><input type="date" data-grad="from" value="${esc(c.from || "")}"></label>
        <label class="cc-field"><span>إلى تاريخ</span><input type="date" data-grad="to" value="${esc(c.to || today)}"></label>
        <label class="cc-field"><span>أقصى عدد غيابات مسموح</span><input type="number" min="0" max="50" data-grad="maxAbs" value="${esc(c.maxAbs)}"></label>
        <label class="cc-field"><span>أدنى نسبة حضور %</span><input type="number" min="0" max="100" data-grad="minRate" value="${esc(c.minRate)}"></label>
        <label class="cc-chk"><input type="checkbox" data-grad="countExcused" ${c.countExcused ? "checked" : ""}> <span>احسب «غياب بعذر» ضمن الغياب</span></label>
        <label class="cc-chk"><input type="checkbox" data-grad="requireEval" ${c.requireEval ? "checked" : ""}> <span>اشترط إكمال الاستبيانات والتعهد (قراءات أكثر)</span></label>
      </div><p class="cc-note">اختر المسار والمرحلة من شريط «النطاق». الفترة الطويلة تعني قراءات كثيرة (قراءة لكل جلسة)، فاختر مجموعة أو مساراً إن أمكن.</p></div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-grad"))} أمر قراءة (تقدير أقصى)</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-grad" ${state.busy || !c.from ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "افحص الجاهزية"}</button></div></footer>
    </section>`;
  }
  async function runGrad() {
    const c = state.grad;
    if (!c.from) { state.resultError = "حدّد بداية الفترة."; return render(); }
    state.att.from = c.from; state.att.to = c.to || ui.todayISO(); state.att.excused = !!c.countExcused;
    await runAttend();
    if (state.resultError || !state.att.out) return render();
    if (c.requireEval) { state.mis.kind = "all"; await runMissing(); if (state.resultError) return render(); }
    const missing = c.requireEval && state.mis.out ? state.mis.out.rows.map((x) => ({ stu: x.stu || "", id: x.id || "", name: x.name, items: itemsOf(x, "all") })) : [];
    c.out = { at: new Date(), rows: App.centerXl.gradEval(state.att.out.students, missing, c), sessions: state.att.out.sessions, from: state.att.from, to: state.att.to, evalRead: !!(c.requireEval && state.mis.out) };
    render();
  }
  const GRAD_HEADS = ["الطالب", "الرقم", "المسار", "المجموعة", "غياب", "نسبة الحضور", "الحالة", "السبب"];
  const gradRow = (g) => [g.s.name, g.s.stu, g.s.track, g.s.group, g.abs, g.rate + "%", g.ok ? "مستوفٍ" : "غير مستوفٍ", g.reasons.join(" · ")];
  function gradResult() {
    const o = state.grad.out; if (!o) return "";
    const no = o.rows.filter((g) => !g.ok), yes = o.rows.filter((g) => g.ok);
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> نتيجة الجاهزية</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.rows.length)}</b> طالباً · ${ui.fmt(o.sessions)} جلسة</span><span class="cc-stat ok"><b>${ui.fmt(yes.length)}</b> مستوفون</span><span class="cc-stat ${no.length ? "bad" : "ok"}"><b>${ui.fmt(no.length)}</b> غير مستوفين</span>
        <button type="button" class="btn secondary small" data-cc="grad-copy" ${no.length ? "" : "disabled"}>نسخ قائمة غير المستوفين</button><button type="button" class="btn secondary small" data-cc="export-grad">تنزيل Excel</button></div>
      ${o.evalRead ? "" : '<p class="cc-note">لم تُفحص التقييمات (الحكم على الحضور فقط).</p>'}
      ${no.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>غير مستوفين</h4><span class="cc-badge bad">${ui.fmt(no.length)}</span></div></header>${dataTable("grad-no", GRAD_HEADS, no.map(gradRow))}</article>` : '<p class="cc-alert ok">كل الطلاب يستوفون الشروط ✓</p>'}
      ${yes.length ? `<details class="cc-help"><summary>المستوفون (${ui.fmt(yes.length)})</summary>${dataTable("grad-yes", GRAD_HEADS, yes.map(gradRow))}</details>` : ""}
      <p class="cc-note">الحكم مبني على جلسات الفترة المقروءة وعلى شروطك أعلاه؛ تأكد أن الفترة تغطي الدورة كلها قبل الاعتماد.</p>
    </section>`;
  }
  function gradExport() {
    const o = state.grad.out; if (!o) return;
    const wb = new ExcelJS.Workbook();
    fmtSheet(wb.addWorksheet("غير مستوفين"), GRAD_HEADS, o.rows.filter((g) => !g.ok).map(gradRow));
    fmtSheet(wb.addWorksheet("مستوفون"), GRAD_HEADS, o.rows.filter((g) => g.ok).map(gradRow));
    return wb.xlsx.writeBuffer().then((b) => ui.download("جاهزية التخرج " + ui.todayISO() + ".xlsx", new Blob([b], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })));
  }

  /* ===== صورة إلى جدول: كشف أو درجات أو هويات مصوّرة ← جدول يُنزَّل Excel أو يُقارَن بالمسجلين ===== */
  function imgView() {
    const c = state.img, ai = App.ai && App.ai.settings ? App.ai.settings() : {}, provider = ai.provider === "claude" ? "Claude" : "Gemini";
    return `<section class="cc-card" id="cc-img">
      <header class="cc-card-h"><h3>صورة إلى جدول</h3><p>صوّر كشف أسماء أو درجات أو هويات، فيقرأه الذكاء الاصطناعي جدولاً تراجعه وتنزّله Excel، أو ترسله مباشرة إلى «مقارنة ملف Excel» لمقارنته بالمسجلين.</p></header>
      <div class="cc-card-b">
        <label class="cc-field cc-wide"><span>١. صور الجداول (JPG أو PNG، صورة أو أكثر)</span><input type="file" id="cc-img-files" accept="image/*" multiple></label>
        ${c.files.length ? `<div class="cc-sig-thumbs">${c.files.map((f, i) => `<figure><img src="${f.thumb}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption><button type="button" class="cc-link" data-cc="img-rm" data-i="${i}">إزالة</button></figure>`).join("")}</div>` : ""}
        <p class="cc-note">🔒 تُرسَل الصور إلى <b>${provider}</b> بمفتاحك لقراءتها فقط، ولا تُحفظ في تمكين. قد تحوي أسماء وهويات متدربين، فاستعملها بحسب سياسة المركز.</p>
        <div class="cc-row"><button type="button" class="btn navy" data-cc="img-read" ${c.files.length && !c.reading ? "" : "disabled"}>${c.reading ? "جارٍ القراءة…" : "٢. اقرأ الصور"}</button>
          <label class="cc-field" style="min-width:0"><span>السرعة</span><select data-img="speed"><option value="" ${c.fast ? "" : "selected"}>دقيق (افتراضي)</option><option value="fast" ${c.fast ? "selected" : ""}>سريع (نموذج أخف)</option></select></label>
          <span class="cc-note" id="cc-img-prog">${esc(c.prog || (c.took ? "آخر قراءة: " + c.took : ""))}</span></div>
        ${c.failed.length ? `<p class="cc-alert warn">تعذّرت قراءة ${ui.fmt(c.failed.length)} صورة: ${c.failed.map((x) => esc(x.name + " (" + x.error + ")")).join("، ")}</p>` : ""}
      </div>
    </section>`;
  }
  async function imgRead() {
    const c = state.img;
    if (!c.files.length) throw new Error("أضف صور الجداول أولاً.");
    if (!App.ai || !App.ai.hasKey()) throw new Error("NO_KEY");
    c.reading = true; c.failed = []; c.prog = "جارٍ قراءة الصور…"; state.resultError = ""; render();
    const t0 = Date.now(); let dn = 0, tot = c.files.length;
    const tick = setInterval(() => { c.prog = (dn ? "قُرئت " + dn + " من " + tot : "جارٍ قراءة " + tot + " صورة") + " · " + Math.round((Date.now() - t0) / 1000) + " ث"; const el = document.getElementById("cc-img-prog"); if (el) el.textContent = c.prog; }, 1000);
    try {
      const r = await App.centerSign.readTables(c.files, { fast: c.fast, onProgress: (d, n) => { dn = d; tot = n; } });
      c.tables = r.tables; c.failed = r.failed;
      if (r.quota) state.resultError = QUOTA_HELP(c.tables.length, r.failed.length);
      else if (!c.tables.length && !r.failed.length) state.resultError = "لم أجد جدولاً في الصور.";
    } finally { clearInterval(tick); c.reading = false; c.prog = ""; const vl = App.ai && App.ai.visionLast; c.took = Math.round((Date.now() - t0) / 1000) + " ث" + (vl && vl.model ? " · " + vl.model : ""); render(); }
  }
  /* جداول الصور المتطابقة الرؤوس تُدمَج في واحد؛ وإلا يبقى لكل صورة جدولها */
  function imgMerged() {
    const ts = (state.img.tables || []).filter((t) => t.rows.length);
    if (ts.length > 1 && ts.every((t) => t.heads.length === ts[0].heads.length)) return [{ name: "كل الصور", title: ts.map((t) => t.name).join("، "), heads: ts[0].heads, rows: ts.flatMap((t) => t.rows) }];
    return ts;
  }
  function imgResult() {
    const c = state.img; if (!c.tables) return "";
    const ts = imgMerged();
    if (!ts.length) return '<section class="cc-results"><p class="cc-alert warn">لم تُقرأ أي صفوف من الصور.</p></section>';
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٣</span> الجدول المقروء</h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(ts.reduce((n, t) => n + t.rows.length, 0))}</b> صفاً</span><button type="button" class="btn secondary small" data-cc="export-img">تنزيل Excel</button><button type="button" class="btn secondary small" data-cc="img-xl">قارنه بالمسجلين ←</button></div>
      <p class="cc-note">القراءة الآلية قد تخطئ في الأرقام والخط اليدوي، فراجع الجدول قبل الاعتماد عليه.</p>
      ${ts.map((t, i) => `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${esc(t.title || t.name)}</h4><span class="cc-badge">${ui.fmt(t.rows.length)}</span></div></header>${dataTable("img-" + i, t.heads, t.rows)}</article>`).join("")}</section>`;
  }
  function imgExport() {
    const ts = imgMerged(); if (!ts.length) return;
    const wb = new ExcelJS.Workbook(), used = new Set();
    ts.forEach((t, i) => { let n = (t.name || "ورقة " + (i + 1)).replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "ورقة"; while (used.has(n)) n += "'"; used.add(n); fmtSheet(wb.addWorksheet(n), t.heads, t.rows); });
    return wb.xlsx.writeBuffer().then((b) => ui.download("جدول من صورة " + ui.todayISO() + ".xlsx", new Blob([b], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })));
  }
  function imgToCompare() {
    const ts = imgMerged(); if (!ts.length) return;
    const c = state.xl;
    c.sheets = ts.map((t) => ({ name: t.name, heads: t.heads, rows: t.rows })); c.sheet = 0; c.name = "من صورة"; c.out = null;
    c.map = App.centerXl.detect(c.sheets[0].heads, c.sheets[0].rows);
    state.mode = "xl"; state.resultError = ""; render();
  }

  /* ===== كشف تعهد استلام الحقيبة: ديباجة + جدول توقيع على الترويسة، بترقيم الأوراق (5-1) (5-2) ===== */
  const PLEDGE_KEY = "tamkeen:pledge-opts";
  const pledgeOpts = () => Object.assign({}, App.pledgeSheet.DEFAULTS, lsGet(PLEDGE_KEY, {}));
  const pledgeSave = () => lsSet(PLEDGE_KEY, state.pledge.opts);
  function pledgeStudents() {
    const c = state.pledge; return c.students || [];
  }
  /* جنس كل طالب في الكشف: من ملف التصدير في الذاكرة (بالهوية) إن لم يكن معروفاً */
  function pledgeFillGender() {
    let n = 0;
    (state.pledge.students || []).forEach((s) => { if (!s.gender) { const e = enrichOf(digits(s.id), ""); if (e && e.sex) { s.gender = e.sex; n++; } } });
    return n;
  }
  const pledgeUnknownSex = () => (state.pledge.students || []).filter((s) => App.pledgeSheet.sexOf(s.gender) === "غير محدد").length;
  async function pledgeGenderFetch() {
    state.busy = true; state.resultError = ""; render(); refreshStatus();
    try { await enrichFromSystem(gapsExportPlan(state.pledge)); const n = pledgeFillGender(); ui.toast("عُرف جنس " + ui.fmt(n) + " طالباً"); }
    catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* أكبر عدد صفوف يتّسع في الورقة الواحدة المطبوعة على الترويسة مع الديباجة الحالية (يُقاس فعلياً بالتقسيم إلى صفحات) */
  const fitCache = {};
  function pledgeFitRows(o, mode) {
    const key = JSON.stringify([mode || "", o.title, o.announcerTitle, o.preamble, o.repeatPreamble]);
    if (fitCache[key]) return fitCache[key];
    const sample = Array.from({ length: 40 }, (_, i) => ({ name: "اسم متدرب رباعي طويل نسبياً " + (i + 1), id: "1000000000", stage: "المرحلة الثالثة", group: "S3G1", course: "" }));
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size";
    document.body.appendChild(host);
    let fit = 5;
    try {
      for (let k = 6; k <= 36; k++) {
        const pages = App.docRender.paginate(host, App.pledgeSheet.build(sample.slice(0, k), Object.assign({}, o, { perPage: k, split: "none" }), mode).blocks);
        if (pages > 1) break;
        fit = k;
      }
    } finally { host.remove(); }
    return (fitCache[key] = Math.max(5, fit - 1));   // هامش صف واحد لاختلاف Word عن الطباعة
  }
  /* قياس عرض النص بخط المستندات نفسه (Sakkal Majalla في Word والطباعة) ← بالنقاط، لضبط عرض أعمدة الكشف حسب نصّها */
  let measureCtx = null;
  const pledgeMeasure = (text, bold, sizePt) => {
    try { measureCtx = measureCtx || document.createElement("canvas").getContext("2d"); } catch (e) { measureCtx = null; }
    if (!measureCtx) return String(text || "").length * sizePt * 0.55;
    measureCtx.font = (bold ? "700 " : "") + sizePt + 'pt "Sakkal Majalla", "Traditional Arabic", "Segoe UI", Tahoma, sans-serif';
    return measureCtx.measureText(String(text == null ? "" : text)).width * 0.75;   // px ← pt
  };
  function pledgeBlocks(mode) {
    const st = pledgeStudents(); if (!st.length) return null;
    if (!state.pledge.opts) state.pledge.opts = pledgeOpts();
    const o = Object.assign({}, state.pledge.opts, { measure: pledgeMeasure });
    // عدد الصفوف في الورقة واحد للنسختين، فتتطابق الأسماء في كل صفحة وعدد الصفحات والترقيم
    if (o.autoFit) { state.pledge.fit = pledgeFitRows(o); o.perPage = state.pledge.fit; }
    if (mode !== "announcer") return App.pledgeSheet.build(st, o);
    // نسخة المذيع: نصغّر خط الجدول إن لزم حتى تتّسع الصفوف نفسها في صفحة واحدة لكل ورقة
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size";
    document.body.appendChild(host);
    let res = null;
    try {
      for (const size of [Number(o.announcerSizePt) || 14, 13, 12, 11, 10]) {
        res = App.pledgeSheet.build(st, Object.assign({}, o, { announcerSizePt: size }), "announcer");
        if (App.docRender.paginate(host, res.blocks) === res.pages) break;
      }
    } finally { host.remove(); }
    return res;
  }
  function pledgeView() {
    const c = state.pledge; if (!c.opts) c.opts = pledgeOpts();
    const o = c.opts, n = pledgeStudents().length, built = n ? pledgeBlocks() : null;
    const sel = (v, cur) => (v === cur ? " selected" : "");
    return `<section class="cc-card" id="cc-pledge">
      <header class="cc-card-h"><h3>كشف تعهد استلام الحقيبة</h3><p>كشف يوقّع عليه المتدربون على الترويسة الرسمية: ديباجة التعهد ثم جدول (م، الاسم، رقم الهوية، المرحلة، التوقيع). وعند تعدد الأوراق تُرقَّم (5-1) (5-2) وهكذا.</p></header>
      <div class="cc-card-b">
        <div class="cc-grid">
          <label class="cc-field cc-wide"><span>عنوان الكشف</span><input type="text" data-pl="title" value="${esc(o.title)}"></label>
          <label class="cc-field cc-wide"><span>عنوان نسخة المذيع</span><input type="text" data-pl="announcerTitle" value="${esc(o.announcerTitle)}"></label>
          <label class="cc-field cc-wide"><span>الديباجة (نص التعهد)</span><textarea data-pl="preamble" rows="4">${esc(o.preamble)}</textarea></label>
          <label class="cc-field"><span>ترقيم الأوراق</span><select data-pl="prefixMode"><option value="count"${sel("count", o.prefixMode)}>حسب عدد أوراق المجموعة: (5-1) (5-2)…</option><option value="all"${sel("all", o.prefixMode)}>حسب عدد كل الأوراق</option><option value="fixed"${sel("fixed", o.prefixMode)}>رقم ثابت أكتبه</option><option value="none"${sel("none", o.prefixMode)}>تسلسل فقط: (1) (2)…</option></select></label>
          <label class="cc-field"><span>الرقم الثابت (مثل 5)</span><input type="text" data-pl="prefix" value="${esc(o.prefix)}" ${o.prefixMode === "fixed" ? "" : "disabled"}></label>
          <label class="cc-field"><span>صفوف في الورقة</span><input type="number" min="5" max="40" data-pl="perPage" value="${esc(o.autoFit && c.fit ? c.fit : o.perPage)}" ${o.autoFit ? "disabled" : ""}></label>
          <label class="cc-chk"><input type="checkbox" data-pl="autoFit" ${o.autoFit ? "checked" : ""}> <span>عدد الصفوف يلائم الصفحة تلقائياً</span></label>
          <label class="cc-field"><span>حالة الطالب</span><select data-pledge="status">${(filterField("status").options || []).map((x) => `<option value="${esc(x.v)}" ${String(c.status) === String(x.v) ? "selected" : ""}>${esc(x.t)}</option>`).join("")}</select></label>
          <label class="cc-chk"><input type="checkbox" data-pl="repeatPreamble" ${o.repeatPreamble ? "checked" : ""}> <span>كرّر الديباجة في أعلى كل ورقة</span></label>
          <label class="cc-chk"><input type="checkbox" data-pl="genderSplit" ${o.genderSplit ? "checked" : ""}> <span>كشف للذكور وكشف للإناث في كل مسار</span></label>
          <label class="cc-field"><span>تقسيم الأوراق</span><select data-pl="split"><option value="track"${sel("track", o.split)}>بحسب المسار (كل المراحل والمجموعات معاً)</option><option value="group"${sel("group", o.split)}>بحسب المجموعة</option><option value="none"${sel("none", o.split)}>كشف واحد للجميع</option></select></label>
        </div>
        <p class="cc-note">الرقم الأول هو عدد الأوراق يحسبه التطبيق، والثاني رقم الورقة: مجموعة من خمس أوراق تُرقَّم (5-1) إلى (5-5). الورقة الوحيدة بلا رقم. الأسماء مرتبة أبجدياً.</p>
        <label class="cc-field cc-wide"><span>أو ارفع قائمة من Excel (أعمدة: الاسم، الهوية، وأيضاً المرحلة والمجموعة إن وُجدت)</span><input type="file" id="cc-pledge-file" accept=".xlsx"></label>
        <p class="cc-note">أو اختر <b>المرحلة</b> (والمسار والمجموعة) من شريط «النطاق» ثم اضغط «اجلب الطلاب من المركز».</p>
        ${n ? `<p class="cc-alert ok">${ui.fmt(n)} طالباً (${esc(c.source)}) ← ${ui.fmt(built.pages)} ${built.pages === 1 ? "ورقة" : "ورقة/أوراق"}.${o.genderSplit ? " ذكور " + ui.fmt(built.bySex["ذكور"] || 0) + " · إناث " + ui.fmt(built.bySex["إناث"] || 0) + (built.bySex["غير محدد"] ? " · غير محدد " + ui.fmt(built.bySex["غير محدد"]) : "") : ""}</p>` : ""}
        ${n && o.genderSplit && pledgeUnknownSex() ? `<p class="cc-alert warn" role="status"><span>⚠ لا أعرف جنس <b>${ui.fmt(pledgeUnknownSex())}</b> طالباً فوُضعوا في ورقة «جنس غير محدد». الجنس يأتي من ملف «تصدير Excel» في النظام${canExport() ? "" : " (يحتاج إضافة وكيل تمكين 1.5.8)"}، أو من عمود «الجنس» في ملف Excel الذي ترفعه.</span> <button type="button" class="btn secondary small" data-cc="pledge-gender" ${canExport() && !state.busy ? "" : "disabled"}>اجلب الجنس من النظام</button></p>` : ""}
        <fieldset class="cc-fs cc-wide cc-chairs"><legend>🪑 أرقام الكراسي للاحتفال</legend>
          <p class="cc-note">ورقة A4 مقسّمة إلى أربعة أرباع، في كل ربع رقم كبير، بخطوط قصّ متقطّعة. الأرقام متسلسلة <b>بترتيب الكشوف نفسه</b> (المسار${o.genderSplit ? " ثم الذكور والإناث" : ""} ثم الاسم أبجدياً)، فرقم كرسي كل طالب هو ترتيبه في الكشف.</p>
          <div class="cc-row"><label class="cc-field" style="min-width:0"><span>ابدأ الترقيم من</span><input type="number" min="1" data-pl="chairStart" value="${esc(o.chairStart || 1)}" style="width:7em"></label>
            <label class="cc-chk"><input type="checkbox" data-pl="chairCol" ${o.chairCol !== false ? "checked" : ""}> <span>عمود «الكرسي» (رقم كرسي الطالب) قبل التوقيع في الكشف</span></label>
            <label class="cc-chk"><input type="checkbox" data-pl="chairLogos" ${o.chairLogos !== false ? "checked" : ""}> <span>الشعاران أعلى كل بطاقة (المركز السعودي يميناً، تمكين يساراً)</span></label>
            <label class="cc-chk"><input type="checkbox" data-pl="chairNames" ${o.chairNames ? "checked" : ""}> <span>اسم الطالب تحت الرقم</span></label>
            <label class="cc-chk"><input type="checkbox" data-pl="chairTags" ${o.chairTags ? "checked" : ""}> <span>المسار${o.genderSplit ? " والجنس" : ""} بخط صغير</span></label></div>
          ${n ? `<p class="cc-note">${ui.fmt(n)} رقماً (من ${ui.fmt(Math.max(1, Number(o.chairStart) || 1))} إلى ${ui.fmt(Math.max(1, Number(o.chairStart) || 1) + n - 1)}) على ${ui.fmt(Math.ceil(n / 4))} ورقة A4.</p>` : ""}
          <div class="cc-row"><button type="button" class="btn navy" data-cc="pledge-chairs" ${n ? "" : "disabled"}>طباعة أرقام الكراسي (A4)</button>
            <button type="button" class="btn secondary" data-cc="pledge-chairs-word" ${n ? "" : "disabled"} title="ملف Word بالشكل نفسه (A4، أربعة أرقام في الصفحة) لتعدّله أو تطبعه من Word">تنزيل Word</button>
            <button type="button" class="btn secondary" data-cc="pledge-chairs-xlsx" ${n ? "" : "disabled"} title="قائمة: رقم الكرسي والاسم والهوية والمسار والجنس والمجموعة والمرحلة">تنزيل Excel (القائمة)</button></div>
        </fieldset>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-pledge"))} أمر قراءة</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn secondary small" data-cc="pledge-reset">الديباجة الافتراضية</button>
          <button type="button" class="btn secondary" data-cc="run-pledge" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اجلب الطلاب من المركز"}</button>
          <button type="button" class="btn secondary" data-cc="pledge-ann-word" ${n ? "" : "disabled"} title="الترتيب نفسه بجدول (م، الاسم، المرحلة) بخط أكبر ليقرأه المذيع">نسخة المذيع — Word</button>
          <button type="button" class="btn secondary" data-cc="pledge-ann-print" ${n ? "" : "disabled"} title="الترتيب نفسه بجدول (م، الاسم، المرحلة) بخط أكبر ليقرأه المذيع">نسخة المذيع — طباعة</button>
          <button type="button" class="btn secondary" data-cc="pledge-word" ${n ? "" : "disabled"}>تنزيل Word</button>
          <button type="button" class="btn navy" data-cc="pledge-print" ${n ? "" : "disabled"}>طباعة على الترويسة</button></div></footer>
    </section>`;
  }
  async function runPledge() {
    const c = state.pledge;
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const results = await runCommands(sigCommands(false, c));
      const reg = sigRegistered(results);
      if (!reg.length) throw new Error("لم أجد مسجلين في المرحلة المختارة. تحقق من المرحلة والمسار وحالة الطالب.");
      c.students = reg.map((r) => { const g = grpCode(r.group) || ""; return { name: r.name, id: r.id, group: g, course: r.course, track: pledgeTrackOf(r.course), stage: stageOf(r.course) || stageFromGroup(g) || "" }; });
      c.source = "نظام المركز";
      if (c.opts && c.opts.genderSplit) {
        pledgeFillGender();
        if (pledgeUnknownSex() && canExport()) { try { await enrichFromSystem(gapsExportPlan(c)); pledgeFillGender(); } catch (e) { state.resultError = "جُلب الطلاب، لكن تعذّر جلب الجنس: " + (e.message || e); } }
      }
      ui.toast("جُلب " + ui.fmt(c.students.length) + " طالباً");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* اسم المسار من عنوان الدورة: «مسار الحلاقة الرجالية - المرحلة الثالثة» ← «مسار الحلاقة الرجالية» */
  const pledgeTrackOf = (course) => { const t = clean(course), m = t.match(/\s*[-–—]?\s*المرحلة\s*\S+/); return clean((m ? t.replace(m[0], "") : t).replace(/[-–—\s]+$/, "")); };
  async function pledgeFromFile(f) {
    const wb = await App.centerXl.readWorkbook(f);
    if (!wb.sheets.length) throw new Error("الملف فارغ.");
    const sh = wb.sheets[0], m = App.centerXl.detect(sh.heads, sh.rows), iS = sh.heads.findIndex((h) => /مرحلة|stage/i.test(h)), iT = sh.heads.findIndex((h) => /^(ال)?مسار|track/i.test(h)), iG = sh.heads.findIndex((h) => /^(ال)?جنس$|gender|sex/i.test(clean(h)));
    if (m.name < 0) throw new Error("لم أجد عمود الاسم في الملف.");
    const get = (r, i) => (i >= 0 ? clean(r[i]) : "");
    state.pledge.students = sh.rows.map((r) => { const g = get(r, m.group); return { name: get(r, m.name), id: get(r, m.id), group: g, course: "", track: get(r, iT), gender: get(r, iG), stage: get(r, iS) || stageFromGroup(g) || "" }; }).filter((s) => s.name);
    state.pledge.source = "ملف " + f.name;
  }
  async function pledgeOutput(kind, mode) {
    const b = pledgeBlocks(mode); if (!b) return;
    const title = mode === "announcer" ? (state.pledge.opts.announcerTitle || "كشف أسماء الخريجين") : (state.pledge.opts.title || "تعهد استلام الحقيبة");
    if (kind === "print") return App.docRender.print(b.blocks, title, false);
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* يُحمَّل عند الحاجة */ }
    App.docRender.exportWord(b.blocks, App.docRender.cleanFileName(title + " " + ui.todayISO()));
  }

  /* ما ينقص كل طالب: صفّه في كل نموذج (وقّع/لم يوقّع/مراجعة) وقائمة النماذج التي لم يوقّعها */
  const SIG_CELL = { signed: "✓ وقّع", blank: "✗ ناقص (بلا توقيع)", absent: "✗ ناقص", review: "؟ مراجعة" };
  function sigMatrix() {
    const forms = sigForms(), os = forms.map((f) => sigCompute(f));
    if (!os.length || os.some((o) => !o)) return null;
    const rows = os[0].items.map((it, i) => {
      const sts = os.map((o) => o.items[i].st);
      return { reg: it.reg, sts, miss: forms.filter((f, k) => sts[k] === "absent" || sts[k] === "blank"), rev: forms.filter((f, k) => sts[k] === "review") };
    });
    rows.sort((a, b) => b.miss.length - a.miss.length || a.reg.name.localeCompare(b.reg.name, "ar"));
    return { forms, rows };
  }
  /* الأعمدة: بيانات الطالب (مع المسار والمرحلة والمجموعة)، ثم عمود مستقل لكل نموذج، ثم عدد الناقص وملخّصه */
  const sigMatrixHeads = (m) => ["الاسم", "رقم الهوية", "الجوال", "المسار", "المرحلة", "المجموعة", ...m.forms, "عدد الناقص", "ينقصه"];
  const sigMatrixRow = (x) => [x.reg.name, x.reg.id, x.reg.phone, pledgeTrackOf(x.reg.course), stageOf(x.reg.course) || stageFromGroup(grpCode(x.reg.group) || "") || "", grpCode(x.reg.group) || x.reg.group, ...x.sts.map((s) => SIG_CELL[s]), x.miss.length, x.miss.length ? x.miss.join("، ") : x.rev.length ? "مكتمل (يحتاج مراجعة: " + x.rev.join("، ") + ")" : "مكتمل ✓"];
  /* ===== رسالة واتساب بالنواقص: رسالة واحدة لكل مسار فيها كل طلابه الناقصين مرقّمين =====
     «١- الاسم / المسار · المرحلة · المجموعة / ينقصه: النماذج». لا إرسال تلقائي: تُنسخ أو تُفتح في واتساب ويرسلها المستخدم بنفسه. */
  const SIG_WA_HEAD_KEY = "tamkeen:sig-wa-head", SIG_WA_DETAIL_KEY = "tamkeen:sig-wa-detail", SIG_WA_MAX = 1800;
  const SIG_WA_HEAD_DEF = "*نواقص التوقيع — {المسار} ({العدد})*", SIG_WA_SEP = "──────────────";
  const sigWaHead = () => { try { const v = localStorage.getItem(SIG_WA_HEAD_KEY); return v === null ? SIG_WA_HEAD_DEF : v; } catch (e) { return SIG_WA_HEAD_DEF; } };
  const sigWaDetail = () => { try { return localStorage.getItem(SIG_WA_DETAIL_KEY) !== "0"; } catch (e) { return true; } };
  function sigWaMsgs() {
    const m = sigMatrix(); if (!m) return [];
    const by = new Map();
    m.rows.filter((x) => x.miss.length).forEach((x) => { const tr = (pledgeTrackOf(x.reg.course) || "").replace(/^مسار\s*/, "") || "بلا مسار"; (by.get(tr) || by.set(tr, []).get(tr)).push(x); });
    const head = sigWaHead(), detail = sigWaDetail();
    const stageOfX = (x) => stageOf(x.reg.course) || stageFromGroup(grpCode(x.reg.group) || "") || "";
    return [...by.keys()].sort((p, q) => p.localeCompare(q, "ar")).map((tr) => {
      const list = by.get(tr).slice().sort((p, q) => stageOfX(p).localeCompare(stageOfX(q), "ar") || String(grpCode(p.reg.group) || p.reg.group).localeCompare(String(grpCode(q.reg.group) || q.reg.group), "ar", { numeric: true }) || p.reg.name.localeCompare(q.reg.name, "ar"));
      // النواقص تحت بعضها (نقطة لكل نموذج)، وبين كل طالب وطالب خط فاصل؛ ونموذج واحد ناقص يبقى في سطر الطالب نفسه
      const entries = list.map((x, i) => (i + 1) + "- " + x.reg.name + (detail ? "\n   " + [tr, stageOfX(x), grpCode(x.reg.group) || x.reg.group].filter(Boolean).join(" · ") : "") + (x.miss.length === 1 ? "\n   ينقصه: " + x.miss[0] : "\n   ينقصه:\n" + x.miss.map((f) => "   • " + f).join("\n")));
      const headText = (k, total) => head.replace(/\{المسار\}/g, tr).replace(/\{العدد\}/g, String(list.length)) + (total > 1 ? " — جزء " + k + "/" + total : "");
      const SEP = "\n" + SIG_WA_SEP + "\n";
      const full = (head ? headText(1, 1) + "\n\n" : "") + entries.join(SEP);
      // رسالة طويلة: تُقسَّم عند حدود الطلاب (لا يُقطع طالب بين جزأين) وتتكرر الترويسة في كل جزء
      let parts = [full];
      if (full.length > SIG_WA_MAX) {
        const chunks = []; let cur = [], len = 0;
        entries.forEach((en) => { if (cur.length && len + en.length > SIG_WA_MAX) { chunks.push(cur); cur = []; len = 0; } cur.push(en); len += en.length + SEP.length; });
        if (cur.length) chunks.push(cur);
        parts = chunks.map((c, k) => (head ? headText(k + 1, chunks.length) + "\n\n" : "") + c.join(SEP));
      }
      return { tr, n: list.length, msg: full, parts };
    });
  }
  function sigWaBlock() {
    const ms = sigWaMsgs(), total = ms.reduce((n, x) => n + x.n, 0);
    return `<details class="cc-help cc-sigwa" open><summary><b>رسالة واتساب بالنواقص</b> — ${ui.fmt(ms.length)} ${ms.length === 1 ? "مسار" : "مسارات"} · ${ui.fmt(total)} طالباً ناقصاً</summary>
      <div class="cc-grid">
        <label class="cc-field cc-wide"><span>سطر العنوان (المتغيرات: {المسار} {العدد}؛ اتركه فارغاً لحذفه)</span><input type="text" data-sigwa="head" value="${esc(sigWaHead())}"></label>
        <label class="cc-chk"><input type="checkbox" data-sigwa="detail" ${sigWaDetail() ? "checked" : ""}> <span>اذكر المسار والمرحلة والمجموعة تحت كل اسم</span></label>
      </div>
      <div class="cc-row"><button type="button" class="btn secondary small" data-cc="sigwa-copy-all" ${ms.length ? "" : "disabled"}>نسخ رسائل كل المسارات</button><button type="button" class="btn secondary small" data-cc="sigwa-xlsx" ${ms.length ? "" : "disabled"}>تنزيل Excel</button></div>
      <p class="cc-note">رسالة واحدة لكل مسار. لا يُرسَل شيء تلقائياً: انسخ الرسالة أو افتحها في واتساب (تختار المحادثة بنفسك) ثم أرسلها.</p>
      ${ms.length ? ms.map((x, i) => `<div class="cc-sigwa-card"><div class="cc-sigwa-h"><b>${esc(x.tr)}</b> <span class="cc-badge bad">${ui.fmt(x.n)}</span></div><pre class="cc-sigwa-pre" dir="rtl">${esc(x.msg)}</pre>
        <div class="cc-row"><button type="button" class="btn secondary small" data-cc="sigwa-copy" data-i="${i}">نسخ الرسالة</button>${x.parts.map((pt, k) => `<a class="btn secondary small" href="https://wa.me/?text=${encodeURIComponent(pt)}" target="_blank" rel="noopener">واتساب${x.parts.length > 1 ? " (" + (k + 1) + "/" + x.parts.length + ")" : ""}</a>`).join("")}</div></div>`).join("") : '<p class="cc-note">لا طالب ناقص.</p>'}
    </details>`;
  }
  function sigMatrixBlock() {
    const m = sigMatrix(); if (!m || m.forms.length < 2) return "";
    const lacking = m.rows.filter((x) => x.miss.length).length, done = m.rows.length - lacking;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٣</span> ما ينقص كل طالب <small>(${ui.fmt(m.forms.length)} نماذج)</small></h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(m.rows.length)}</b> مسجّلاً</span><span class="cc-stat ok"><b>${ui.fmt(done)}</b> أكملوا كل النماذج</span><span class="cc-stat ${lacking ? "bad" : "ok"}"><b>${ui.fmt(lacking)}</b> ينقصهم نموذج أو أكثر</span>
        <button type="button" class="btn secondary small" data-cc="sig-copy-miss" ${lacking ? "" : "disabled"}>نسخ قائمة الناقصين</button><button type="button" class="btn secondary small" data-cc="export-sig">تنزيل Excel</button></div>
      <p class="cc-note">الأكثر نقصاً أولاً. العمود «ينقصه» يذكر النماذج التي لم يوقّعها الطالب (غاب اسمه عنها أو ورد بلا توقيع).</p>
      ${sigWaBlock()}
      ${dataTable("sig-matrix", sigMatrixHeads(m), m.rows.map(sigMatrixRow))}</section>`;
  }
  /* ===== غير المعروفين: فصلهم حسب المسار ومقارنتهم من جديد بكل طلاب مسارهم في النظام (كل المراحل والحالات) =====
     غالباً هم من مرحلة أو حالة أخرى في المسار نفسه فلا يظهرون في قائمة المرحلة المختارة. أمر قراءة واحد لكل مسار،
     ومن لا مسار له يُقارَن بكل الطلاب. ما يُجزم به يُعرف (lookups)، والقريب غير المؤكَّد يصير مرشحاً بزر «هو: …». قراءة فقط. */
  function sigUnknownAll() {
    const seen = new Set(), out = [];
    sigForms().forEach((fm) => { const o = sigCompute(fm); if (o) o.orphans.concat(o.lost).forEach((f) => { if (!seen.has(f.id)) { seen.add(f.id); out.push(f); } }); });
    return out;
  }
  const trackIdOf = (name) => { if (!name) return ""; const o = trackOpts().find((t) => App.ccUtil.sameTrack(t.t, name) === true); return o ? String(o.v) : ""; };
  function sigRetrackPlan() {
    const groups = new Map();
    sigUnknownAll().forEach((f) => { const k = trackIdOf(sigTrackOf(f)) || "*"; (groups.get(k) || groups.set(k, []).get(k)).push(f); });
    return groups;
  }
  /* «التجميل 5 · الحلاقة 3 · بلا مسار 2» */
  function sigUnknownByTrack(list) {
    const m = new Map();
    list.forEach((f) => { const t = (sigTrackOf(f) || "بلا مسار").replace(/^مسار\s*/, ""); m.set(t, (m.get(t) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => esc(t) + " <b>" + ui.fmt(n) + "</b>").join(" · ");
  }
  function sigRetrackBar(list) {
    if (!list.length) return "";
    const n = sigRetrackPlan().size;
    return `<div class="cc-sig-retrack"><p class="cc-note">حسب المسار: ${sigUnknownByTrack(list)}</p>
      <div class="cc-row"><button type="button" class="btn navy small" data-cc="sig-retrack" ${state.busy ? "disabled" : ""}>افصلهم حسب المسار وقارن مرة أخرى (${ui.fmt(n)} ${n === 1 ? "أمر قراءة" : "أوامر قراءة"})</button>
      <span class="cc-note">يجلب كل طلاب مسار كل اسم من النظام (كل المراحل والحالات) ويقارن بالاسم والهوية والجوال وأخطاء القراءة. قراءة فقط.</span></div></div>`;
  }
  async function sigRetrack() {
    const c = state.sig, groups = sigRetrackPlan(); if (!groups.size) return;
    state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const keys = [...groups.keys()];
      const res = await runCommands(keys.map((k) => (k === "*" ? { type: "list", label: "كل الطلاب", params: {} } : { type: "list", label: optLabel("track_id", k), params: { track_id: k } })), { noGroup: true });
      c.lookups = c.lookups || {}; c.nameHits = c.nameHits || {};
      let sure = 0, maybe = 0;
      keys.forEach((k, i) => {
        const r = res[i]; if (!r || r.type !== "list" || !Array.isArray(r.rows)) return;
        const pool = r.rows.map((x) => stuFrom(r, x)).filter((x) => x.name), fs = groups.get(k);
        const m = App.ccUtil.matchNames(pool.map((x) => ({ name: x.name, id: x.id, phone: x.phone, track: x.track })), fs.map((f) => ({ name: f.name, id: f.nid, phone: f.phone, track: sigTrackOf(f) })));
        m.pairs.forEach((p) => {
          const f = fs[p.found], st = pool[p.reg];
          if (p.sure) { c.lookups[f.id] = { q: "", list: [st], by: "retrack", score: p.score }; sure++; }
          else { c.nameHits[f.id] = { list: [{ s: st, score: p.score }], at: Date.now() }; maybe++; }
        });
      });
      sigLearnAuto(); sigSaveSoon();
      ui.toast("عُرف " + ui.fmt(sure) + " اسماً بالمقارنة حسب المسار" + (maybe ? "، و" + ui.fmt(maybe) + " مرشحاً للمراجعة" : ""));
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* عدة نماذج: جدول واحد لكل الطلاب بعمود لكل نموذج (وقّع أم لا)، وجدول واحد يجمع الأسماء غير المعروفة من كل النماذج */
  function sigMultiSimple(forms) {
    const m = sigMatrix(); if (!m) return "";
    const heads = ["الاسم", "رقم الهوية", "الجوال", "المجموعة", ...forms, "الحالة"];
    const rows = m.rows.map((x) => [x.reg.name, x.reg.id, x.reg.phone, grpCode(x.reg.group) || x.reg.group, ...x.sts.map((st) => SIG_CELL[st]),
      x.miss.length ? "✗ ينقصه: " + x.miss.join("، ") : x.rev.length ? "؟ مراجعة: " + x.rev.join("، ") : "✓ وقّع " + (forms.length === 2 ? "النموذجين" : "كل النماذج")]);
    const full = m.rows.filter((x) => !x.miss.length && !x.rev.length).length, lack = m.rows.filter((x) => x.miss.length).length;
    // غير المعروفين من كل النماذج في جدول واحد: الاسم نفسه في عدة نماذج صفّ واحد بعمود «النماذج»
    const unk = new Map();
    forms.forEach((f) => {
      const o = sigCompute(f); if (!o) return;
      o.orphans.concat(o.lost).forEach((x) => {
        const k = App.ccUtil.arKey(x.name) + "|" + digits(x.nid);
        const e = unk.get(k) || unk.set(k, { f: x, forms: [], signed: [] }).get(k);
        if (!e.forms.includes(f)) e.forms.push(f);
        e.signed.push(x.signed === true ? "موقّع" : x.signed === false ? "بلا توقيع" : "غير محسوم");
      });
    });
    const uVals = [...unk.values()].sort((a, b) => (sigTrackOf(a.f) || "ي").localeCompare(sigTrackOf(b.f) || "ي", "ar"));
    const uRows = uVals.map((e) => [e.f.name, e.f.nid || "", e.f.phone || "", (sigTrackOf(e.f) || "—").replace(/^مسار\s*/, ""), e.forms.join("، "), [...new Set(e.signed)].join("، "), sigShort(e.f.file), sigLookupText(e.f)]);
    const box = (k, title, bad, hs, rs, empty, stats) => `<article class="cc-res cc-sig3"><header class="cc-res-h"><div class="cc-res-t"><h4>${title}</h4><span class="cc-badge${bad && rs.length ? " bad" : ""}">${ui.fmt(rs.length)}</span></div></header>${stats || ""}${rs.length ? dataTable(k, hs, rs) : `<p class="cc-note">${empty}</p>`}</article>`;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٣</span> نتيجة المطابقة <small>(${ui.fmt(forms.length)} نماذج: ${forms.map(esc).join("، ")})</small></h3>
      <div class="cc-sig-simple">
      ${box("sm-all", "١. كل الطلاب في النماذج", false, heads, rows, "لا مسجلين.", `<div class="cc-stats"><span class="cc-stat ok"><b>${ui.fmt(full)}</b> وقّع ${forms.length === 2 ? "النموذجين" : "كل النماذج"}</span><span class="cc-stat bad"><b>${ui.fmt(lack)}</b> ينقصه نموذج أو أكثر</span>${m.rows.length - full - lack ? `<span class="cc-stat"><b>${ui.fmt(m.rows.length - full - lack)}</b> يحتاج مراجعة</span>` : ""}</div>`)}
      ${box("sm-unk", "٢. أسماء من الأوراق لم تُعرف (كل النماذج)", true, ["الاسم المقروء", "رقم الهوية", "الجوال", "المسار", "النماذج", "التوقيع", "الورقة", "نتيجة البحث في النظام"], uRows, "✓ كل الأسماء المقروءة عُرفت.", sigRetrackBar(uVals.map((e) => e.f)))}
      <div class="cc-stats"><button type="button" class="btn secondary small" data-cc="export-sig">تنزيل Excel</button></div></div></section>`;
  }
  function sigResult() {
    const forms = sigForms(), multi = forms.length > 1;
    const extra = sigMatrixBlock() + (!multi && state.sig.reg && state.sig.rows ? `<section class="cc-results">${sigWaBlock()}</section>` : "");
    if (multi) return sigMultiSimple(forms) + (extra ? `<details class="cc-help cc-sig-tools"><summary><b>أدوات إضافية</b> — ما ينقص كل طالب بتفصيله، ورسالة واتساب بالنواقص</summary>${extra}</details>` : "")
      + `<details class="cc-help cc-sig-perform"><summary><b>تفاصيل كل نموذج على حدة</b> — المراجعة والتأكيد وربط الأسماء لكل نموذج</summary>${forms.map((f, i) => sigResultFor(f, i, true)).join("")}</details>`;
    return (extra ? `<details class="cc-help cc-sig-tools"><summary><b>أدوات إضافية</b> — ما ينقص كل طالب في كل النماذج، ورسالة واتساب بالنواقص</summary>${extra}</details>` : "") + (multi ? `<section class="cc-results"><p class="cc-alert ok">في الصور ${ui.fmt(forms.length)} نماذج: ${forms.map((f) => "<b>" + esc(f) + "</b>").join("، ")}. لكل نموذج مقارنته وتقريره أدناه، ويضمّها ملف Excel في ورقات منفصلة.</p></section>` : "") + forms.map((f, i) => sigResultFor(f, i, multi)).join("");
  }
  /* ===== بيانات ناقصة في سجل الطالب بنظام المركز (حقول فارغة في صفحة تعديل الطالب) =====
     الأداة تنقل صفحة تعديل كل طالب كما هي، فالفراغ هنا فراغ في النظام نفسه لا في الأداة. تتطلب «كل بيانات الطالب» (قراءة صفحة لكل طالب). */
  const GAP_SKIP = new Set(["track_id", "student_number", "status", "full_name", "national_id", "gender", "phone_1", "notes"]);
  const GAP_DEFAULT = ["marital_status", "birth_date", "current_address", "governorate_id", "education_level"];
  const gapFieldList = () => (SCHEMA().createStudent.fields || []).filter((f) => !GAP_SKIP.has(f.name) && /^(text|select|date|textarea|number)$/.test(f.type));
  const gapSelected = () => { const c = state.gaps, all = gapFieldList().map((f) => f.name); return (c.fields || GAP_DEFAULT).filter((n) => all.includes(n)); };
  /* فارغ = لا شيء، أو شَرطة بأي شكل («-» «--» «–» «—» «ـ»)، أو نقطة/شرطة سفلية، أو null / N/A — كلها تُعدّ ناقصة وتحتاج تعبئة */
  const isBlankCell = (v) => { const t = clean(v); return !t || /^[\s\-‐-―−ـ_.\/\\]+$/.test(t) || /^(null|undefined|n\/?a|none)$/i.test(t); };
  /* عمود الحقل في جدول التفاصيل: تطابق التسمية ثم احتواؤها (تسميات نموذج التعديل قد تختلف قليلاً عن لقطة الإضافة) */
  function gapCol(heads, f) {
    const k = norm(f.label); let i = heads.findIndex((h) => norm(h) === k);
    if (i < 0) i = heads.findIndex((h) => { const n = norm(h); return n.length >= 4 && (n.includes(k) || k.includes(n)); });
    return i;
  }
  /* ===== إكمال الفراغ من ملف «تصدير Excel» (بيانات المتقدم) =====
     حقول مثل «الحالة الاجتماعية» تُحفظ في سجل المتقدم لا في سجل الطالب، فتظهر فارغة في صفحة الطالب. ملف «تصدير Excel» من صفحة الطلاب
     يضم أعمدة الطالب وأعمدة المتقدم معاً، فيُقرأ على الجهاز وتُكمَّل به الخلايا الفارغة (بالهوية أو رقم الطالب). في ذاكرة الصفحة فقط. */
  const EXPORT_MAP = {   // حقل الطالب ← [عمود الطالب في التصدير، عمود المتقدم]
    marital_status: ["الحالة الاجتماعية", "الحالة الاجتماعية للمتقدم"], phone_2: ["الجوال 2", "جوال المتقدم 2"], birth_date: ["تاريخ الميلاد", "تاريخ ميلاد المتقدم"],
    health_status: ["الحالة الصحية", "الوضع الصحي للمتقدم"], governorate_id: ["المحافظة", "محافظة المتقدم"], population_community_id: ["التجمع السكاني", "تجمع المتقدم"],
    displacement_status: ["حالة النزوح", "حالة نزوح المتقدم"], residence_type_id: ["نوع الإقامة", "نوع إقامة المتقدم"], current_address: ["العنوان الحالي", "عنوان المتقدم"],
    family_members_count: ["عدد أفراد الأسرة", "عدد أفراد أسرة المتقدم"], breadwinner_status: ["معيل الأسرة", "معيل أسرة المتقدم"], employment_status: ["حالة العمل", "حالة عمل المتقدم"],
    income_type_id: ["مستوى الدخل", "دخل المتقدم"], education_level: ["المستوى التعليمي", "تعليم المتقدم"], specialization: ["التخصص", "تخصص المتقدم"],
  };
  const fieldLabelOf = (name) => ((gapFieldList().find((f) => f.name === name) || {}).label) || name;
  async function enrichLoad(file) {
    const wb = await App.centerXl.readWorkbook(file);
    const sh = wb.sheets.find((s) => s.heads.some((h) => clean(h) === "رقم الهوية")) || wb.sheets[0];
    const H = sh.heads.map(clean), ix = (n) => H.indexOf(n), iId = ix("رقم الهوية");
    if (iId < 0) throw new Error("لا عمود «رقم الهوية» في الملف. استعمل ملف «تصدير Excel» من صفحة «الطلاب المعتمدون» في نظام المركز.");
    const fields = Object.keys(EXPORT_MAP).map((name) => ({ name, s: ix(EXPORT_MAP[name][0]), a: ix(EXPORT_MAP[name][1]) })).filter((f) => f.s >= 0 || f.a >= 0);
    if (!fields.some((f) => f.a >= 0)) throw new Error("الملف بلا أعمدة «المتقدم» (مثل «الحالة الاجتماعية للمتقدم»)، فلا يُكمل شيئاً. صدّر الملف من صفحة الطلاب بالزر «تصدير Excel» نفسه.");
    const iN = ix("اسم الطالب"), iS = ix("رقم الطالب"), iP = ix("الجوال 1"), iG = ix("المجموعة الحالية"), iC = ix("الدورة الحالية"), iT = ix("المسار الحالي"), iSex = ix("الجنس"), iH = ix("هوية المتقدم");
    const byId = new Map(), byStu = new Map(), list = [];
    sh.rows.forEach((r) => {
      const id = digits(r[iId]) || (iH >= 0 ? digits(r[iH]) : ""), stu = iS >= 0 ? clean(r[iS]) : "";
      if (!id && !stu) return;
      const e = { name: iN >= 0 ? clean(r[iN]) : "", id, stu, phone: iP >= 0 ? phoneNorm(r[iP]) : "", group: iG >= 0 ? clean(r[iG]) : "", course: iC >= 0 ? clean(r[iC]) : "", track: iT >= 0 ? clean(r[iT]) : "", sex: iSex >= 0 ? clean(r[iSex]) : "", v: {} };
      fields.forEach((f) => { e.v[f.name] = { s: f.s >= 0 ? clean(r[f.s]) : "", a: f.a >= 0 ? clean(r[f.a]) : "" }; });
      list.push(e); if (id) byId.set(id, e); if (stu) byStu.set(stu, e);
    });
    if (!list.length) throw new Error("لا طلاب في الملف.");
    return { name: file.name, at: new Date(), list, byId, byStu, fields: fields.map((f) => f.name), n: list.length };
  }
  const enrichOf = (id, stu) => state.enrich && ((id && state.enrich.byId.get(id)) || (stu && state.enrich.byStu.get(stu))) || null;
  const enrichVal = (e, name) => { const v = e && e.v[name]; return !v ? "" : !isBlankCell(v.s) ? v.s : !isBlankCell(v.a) ? v.a : ""; };
  /* جدول نتيجة ← نسخة تُكمَّل خلاياه الفارغة من الملف (لا تغيّر ما فيه قيمة) */
  function enrichResult(r) {
    if (!state.enrich || !r || r.type !== "list") return r;
    const heads = r.heads || [], iI = heads.indexOf("رقم الهوية"), iS = heads.indexOf("رقم الطالب");
    if (iI < 0 && iS < 0) return r;
    const cols = gapFieldList().map((f) => ({ f, c: gapCol(heads, f) })).filter((x) => x.c >= 0 && state.enrich.fields.includes(x.f.name));
    if (!cols.length) return r;
    let n = 0;
    const rows = r.rows.map((x) => {
      const cells = x.cells, en = enrichOf(iI >= 0 ? digits(cells[iI]) : "", iS >= 0 ? clean(cells[iS]) : ""); if (!en) return x;
      let ch = null; cols.forEach(({ f, c }) => { if (isBlankCell(cells[c])) { const v = enrichVal(en, f.name); if (v) { ch = ch || cells.slice(); ch[c] = v; n++; } } });
      return ch ? Object.assign({}, x, { cells: ch }) : x;
    });
    return Object.assign({}, r, { rows, enriched: (r.enriched || 0) + n });
  }
  function enrichCard() {
    const e = state.enrich;
    return `<details class="cc-adv cc-enrich" data-open="enrich" ${state.open.enrich || e || state.enrichErr ? "open" : ""}><summary><span>إكمال الفراغ من ملف «تصدير Excel»</span>${e ? `<span class="cc-badge on">${ui.fmt(e.n)}</span>` : ""}<small>الحالة الاجتماعية وغيرها من بيانات المتقدم</small></summary>
      <p class="cc-note">حقول مثل «الحالة الاجتماعية» محفوظة في سجل <b>المتقدم</b> لا في سجل الطالب، فتظهر فارغة في صفحة الطالب وفي هذه التقارير. زر «تصدير Excel» في صفحة الطلاب بنظام المركز يضمها كلها. ارفع ملفه هنا فتُكمَّل به الخلايا الفارغة (بالهوية أو رقم الطالب). يُقرأ على جهازك فقط ويُمسح بإغلاق الصفحة.</p>
      <div class="cc-row"><label class="cc-chk"><input type="checkbox" data-enr="auto" ${state.enrichAuto ? "checked" : ""}> <span>أكمل تلقائياً من النظام عند تنفيذ التقرير (طلب واحد لكل دورة أو مسار)</span></label>
        <button type="button" class="btn secondary small" data-cc="enrich-now" ${canExport() && !state.busy ? "" : "disabled"} title="يجلب ملف التصدير من نظام المركز الآن بالمرشحات المختارة">اجلب الآن من النظام</button></div>
      <p class="cc-note">${canExport() ? "✓ إضافة «وكيل تمكين» عندك تدعم الجلب التلقائي (" + esc(App.centerAgent.version()) + ")." : (App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version() ? "⚠ إضافتك (" + esc(App.centerAgent.version()) + ") قديمة: حدّثها إلى 1.5.8 لتفعيل الجلب التلقائي، أو ارفع الملف يدوياً أدناه." : "الجلب التلقائي يعمل عبر إضافة «وكيل تمكين» (1.5.8 فأحدث)؛ ويمكنك رفع الملف يدوياً أدناه.")}</p>
      <label class="cc-field cc-wide"><span>أو ارفع ملف التصدير يدوياً (.xlsx)</span><input type="file" id="cc-enrich-file" accept=".xlsx"></label>
      ${state.enrichErr ? `<p class="cc-alert err" role="alert">⚠ ${esc(state.enrichErr)}</p>` : ""}
      ${e ? `<p class="cc-note">الملف: <b>${esc(e.name)}</b> · ${ui.fmt(e.n)} طالباً · تُكمَّل: ${esc(e.fields.map(fieldLabelOf).join("، "))} <button type="button" class="cc-link" data-cc="enrich-clear">إزالة الملف</button></p>` : ""}</details>`;
  }
  /* ===== جلب ملف التصدير تلقائياً من نظام المركز (إضافة 1.5.8 فأحدث): طلب واحد لكل دورة/مسار بدل صفحة لكل طالب ===== */
  const agentHas = (min) => {
    const v = String((App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version()) || ""), n = v.split(".").map(Number);
    return n.length >= 3 && (n[0] > 1 || (n[0] === 1 && (n[1] > 5 || (n[1] === 5 && n[2] >= min))));
  };
  const canExport = () => agentHas(8);
  function enrichMerge(a, b) {
    if (!a) return b; if (!b) return a;
    const m = new Map(); [a.list, b.list].forEach((arr) => arr.forEach((e) => m.set(e.id || "S:" + e.stu, e)));
    const list = [...m.values()], byId = new Map(), byStu = new Map();
    list.forEach((e) => { if (e.id) byId.set(e.id, e); if (e.stu) byStu.set(e.stu, e); });
    return { name: b.name, at: new Date(), list, byId, byStu, fields: [...new Set(a.fields.concat(b.fields))], n: list.length };
  }
  const b64File = (b64, name) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name || "students-export.xlsx"); };
  /* plan = [{params, label}] ← أوامر تصدير؛ يضمّ الناتج إلى state.enrich ويعيد { all, fresh } (fresh = ما جُلب الآن فقط) */
  async function enrichFromSystem(plan) {
    if (!canExport()) {
      const v = (App.centerAgent && App.centerAgent.isReady() && App.centerAgent.version()) || "";
      throw new Error(v ? "جلب ملف التصدير تلقائياً يحتاج إضافة «وكيل تمكين» بالإصدار 1.5.8 فأحدث (عندك " + v + "). حدّثها من تنبيه التحديث، أو ارفع ملف التصدير يدوياً." : "جلب ملف التصدير تلقائياً يعمل عبر إضافة «وكيل تمكين» (1.5.8 فأحدث)؛ أو ارفع الملف يدوياً.");
    }
    const res = await runCommands(plan.map((p) => ({ type: "export", label: p.label, params: p.params })), { noCache: true, noGroup: true });
    let fresh = null;
    for (const r of res) {
      if (!r) continue;
      if (r.error) throw new Error(r.error);
      if (r.type !== "export" || !r.b64) throw new Error("لم يرجع الوكيل ملف تصدير. إن كانت إضافتك قديمة فحدّثها إلى 1.5.8.");
      fresh = enrichMerge(fresh, await enrichLoad(b64File(r.b64, r.name)));
    }
    if (!fresh) throw new Error("لم يرجع النظام ملف تصدير.");
    fresh.name = "نظام المركز (جُلب تلقائياً)";
    state.enrich = enrichMerge(state.enrich, fresh); state.enrich.name = "نظام المركز (جُلب تلقائياً)";
    return { all: state.enrich, fresh };
  }
  /* هل يكفي ما في الذاكرة لهذه النتائج؟ (≥98% من طلابها موجودون) */
  function enrichCovers(results) {
    if (!state.enrich) return false;
    let n = 0, hit = 0;
    (results || []).filter((r) => r && r.type === "list").forEach((r) => { const iI = (r.heads || []).indexOf("رقم الهوية"); if (iI < 0) return; r.rows.forEach((x) => { n++; if (state.enrich.byId.has(digits(x.cells[iI]))) hit++; }); });
    return n > 0 && hit / n >= 0.98;
  }
  const needsEnrich = (results) => (results || []).some((r) => r && r.type === "list" && gapFieldList().some((f) => gapCol(r.heads || [], f) >= 0));
  function gapsExportPlan(cfg) {
    const c = cfg || state.gaps, common = c.status ? { status: c.status } : {}, stageKeys = (c.stages || []).map((t) => stageK(t) || t);
    if (stageKeys.length) {
      const courses = courseOpts().filter((x) => stageKeys.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track)));
      if (!courses.length) throw new Error("لا توجد دورة تجمع المسار والمرحلة المختارين.");
      return courses.map((x) => ({ params: Object.assign({}, common, { training_course_id: x.v }), label: x.t }));
    }
    if (!c.tracks.length) return [{ params: Object.assign({}, common), label: "كل الطلاب" }];
    return trackOpts().map((o) => String(o.v)).filter((id) => c.tracks.includes(id)).map((id) => ({ params: Object.assign({}, common, { track_id: id }), label: optLabel("track_id", id) }));
  }
  function gapsListsFrom(e) {
    const fs = gapFieldList().filter((f) => e.fields.includes(f.name)), lab = fs.map((f) => f.label);
    const heads = ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المجموعة", "الدورة", "المسار", "الجنس"].concat(lab);
    return [{ heads, label: "", rows: e.list.map((x) => ({ cells: [x.name, x.stu, x.id, x.phone, x.group, x.course, x.track || "", x.sex || "(غير محدد)"].concat(fs.map((f) => (x.v[f.name] || {}).s || "")) })) }];
  }
  async function enrichNow() {
    state.busy = true; state.resultError = ""; state.enrichErr = ""; state.progress = ""; render(); refreshStatus();
    try {
      const plan = state.mode === "gaps" ? gapsExportPlan() : buildSelection().map((x) => ({ params: x.command.params, label: x.label }));
      await enrichFromSystem(plan);
      if (state.results) state.results = Object.assign({}, state.results, { results: state.results.results.map(enrichResult) });
      ui.toast("أُكمل الفراغ من بيانات المتقدم (" + ui.fmt(state.enrich.n) + " طالباً في الذاكرة)");
    } catch (err) { state.enrichErr = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* من قوائم نتائج (heads/rows) ← إحصاء الحقول الفارغة. المقروء = من له «الجنس» (حقل مطلوب فلا يُترك فارغاً) فمن لم تُقرأ بياناته لا يُعدّ ناقصاً */
  function gapStats(lists, fields) {
    const per = fields.map((f) => ({ f, blank: 0, filled: 0, viaApp: 0, found: !!(state.enrich && state.enrich.fields.includes(f.name)) })), rows = new Map();
    let total = 0, unread = 0;
    lists.forEach((l) => {
      const heads = l.heads || [], cols = fields.map((f) => gapCol(heads, f)), gi = heads.findIndex((h) => norm(h) === norm("الجنس"));
      const at = (h) => heads.indexOf(h), iN = at("الاسم"), iI = at("رقم الهوية"), iP = at("الجوال"), iG = at("المجموعة"), iS = at("رقم الطالب"), iC = at("الدورة"), iT = at("المسار");
      cols.forEach((c, k) => { if (c >= 0) per[k].found = true; });
      (l.rows || []).forEach((x) => {
        const cells = x.cells || x, key = (iS >= 0 && clean(cells[iS])) || (iI >= 0 && digits(cells[iI])) + "|" + (iN >= 0 ? clean(cells[iN]) : "");
        if (rows.has(key)) return;
        total++;
        const read = gi >= 0 ? !isBlankCell(cells[gi]) : cols.some((c) => c >= 0 && !isBlankCell(cells[c]));
        if (!read) { unread++; rows.set(key, null); return; }
        const miss = [], vals = fields.map(() => ""), en = enrichOf(iI >= 0 ? digits(cells[iI]) : "", iS >= 0 ? clean(cells[iS]) : "");
        cols.forEach((c, k) => {
          if (c < 0 && !per[k].found) return;
          let blank = c < 0 ? true : isBlankCell(cells[c]);
          if (!blank) vals[k] = clean(cells[c]);
          else if (en && enrichVal(en, fields[k].name)) { blank = false; vals[k] = enrichVal(en, fields[k].name); per[k].viaApp++; }
          if (blank) { per[k].blank++; miss.push(fields[k].label); } else per[k].filled++;
        });
        rows.set(key, { name: iN >= 0 ? clean(cells[iN]) : "", id: iI >= 0 ? digits(cells[iI]) : "", phone: iP >= 0 ? phoneNorm(cells[iP]) : "", stu: iS >= 0 ? clean(cells[iS]) : "", group: iG >= 0 ? clean(cells[iG]) : "", course: (iC >= 0 ? clean(cells[iC]) : "") || l.label || "", track: iT >= 0 ? clean(cells[iT]) : "", vals, missing: miss });
      });
    });
    const list = [...rows.values()].filter(Boolean);
    return { per, total, read: list.length, unread, list, withGaps: list.filter((r) => r.missing.length) };
  }
  /* تنبيه في «تقرير جاهز»: أي حقل فارغ في النظام نفسه (فلا يُظنّ عطلاً في الأداة) */
  function gapNote(lists) {
    const fs = gapFieldList(), st = gapStats(lists.map((r) => ({ heads: r.heads, rows: visibleRows(r), label: r.label })), fs);
    if (!st.read) return "";
    const hit = st.per.filter((p) => p.found && p.blank).sort((a, b) => b.blank - a.blank);
    if (!hit.length) return "";
    const pct = (p) => Math.round((p.blank / st.read) * 100);
    return `<div class="cc-alert warn cc-gapnote" role="status"><span>ℹ️ <b>حقول فارغة في نظام المركز نفسه</b> (الأداة تنقل صفحة تعديل الطالب كما هي، فالفراغ ليس عطلاً فيها): ${hit.slice(0, 6).map((p) => `«${esc(p.f.label)}» عند <b>${ui.fmt(p.blank)}</b> من ${ui.fmt(st.read)} (${pct(p)}%)`).join(" · ")}${hit.length > 6 ? " …" : ""}.${st.unread ? ` لم تُقرأ بيانات ${ui.fmt(st.unread)} طالباً فلم يُحسبوا.` : ""}${state.enrich ? "" : " <b>تنبيه:</b> بعض هذه الحقول (كالحالة الاجتماعية) محفوظة في سجل «المتقدم»؛ ارفع ملف «تصدير Excel» من صفحة الطلاب لإكمالها."}</span><button type="button" class="btn secondary small" data-cc="go-gaps">من هم الناقصون؟ ← أداة «بيانات ناقصة»</button></div>`;
  }
  function gapsView() {
    const c = state.gaps, sel = new Set(gapSelected());
    const n = estimateReads("run-gaps");
    return `<section class="cc-card" id="cc-gaps">
      <header class="cc-card-h"><h3>بيانات ناقصة في النظام</h3><p>يقرأ صفحة تعديل كل طالب ويعدّ الحقول الفارغة في <b>نظام المركز نفسه</b>، ثم يعرض من ينقصه أي حقل لتُكمل بياناته. للقراءة فقط — لا يُكتب شيء في النظام.</p></header>
      <div class="cc-card-b">
        <fieldset class="cc-fs cc-wide"><legend>الحقول المطلوب فحصها <em>${ui.fmt(sel.size)}</em></legend>
          <div class="cc-chips">${gapFieldList().map((f) => `<label class="cc-chk"><input type="checkbox" data-gaps="f:${esc(f.name)}" ${sel.has(f.name) ? "checked" : ""}> <span>${esc(f.label)}</span></label>`).join("")}</div>
          <div class="cc-row"><button type="button" class="cc-link" data-cc="gaps-all">تحديد الكل</button><button type="button" class="cc-link" data-cc="gaps-none">إلغاء الكل</button></div></fieldset>
        ${enrichCard()}
        <label class="cc-field"><span>حالة الطالب</span><select data-gaps="status">${filterField("status").options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === c.status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>
        <p class="cc-note">اختر المسار والمرحلة من شريط «النطاق» أعلاه (بلا اختيار تُقرأ كل المسارات). تُقرأ صفحة لكل طالب، بحد أقصى 400 طالب في كل مسار أو دورة، فاختر المرحلة لتضييق القراءة. بعد القراءة تغيير الحقول المحددة يُحدّث النتيجة فوراً بلا قراءة جديدة.</p>
      </div>
      <footer class="cc-actions"><div class="cc-sum"><b>${canExport() ? ui.fmt(n) + (n === 1 ? " طلب تصدير واحد" : " طلبات تصدير") : state.cache && state.cache.details && !c.status ? "⚡ من الذاكرة المحمّلة" : "تقدير القراءة: حتى " + ui.fmt(n) + " أمر"}</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act">${state.enrich ? `<button type="button" class="btn secondary" data-cc="gaps-file" ${sel.size ? "" : "disabled"} title="يحلّل ملف التصدير نفسه بلا أي قراءة من نظام المركز">حلّل ملف التصدير مباشرة (بلا قراءة)</button>` : ""}<button type="button" class="btn navy" data-cc="run-gaps" ${state.busy || !sel.size ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اقرأ وابحث عن الناقص"}</button></div></footer>
    </section>`;
  }
  async function runGaps() {
    const c = state.gaps; c.out = null; state.busy = true; state.resultError = ""; state.progress = ""; render(); refreshStatus();
    try {
      if (canExport()) {   // الأسرع والأدق: ملف «تصدير Excel» نفسه (طلب لكل دورة/مسار) بدل صفحة لكل طالب
        const { fresh } = await enrichFromSystem(gapsExportPlan());
        c.out = { at: new Date(), file: true, src: "system", lists: gapsListsFrom(fresh) };
        return;
      }
      requireAgent15();
      const common = c.status ? { status: c.status } : {}, mk = (params, label) => ({ type: "list", label, params: Object.assign({}, params, common), details: true });
      let cmds;
      const stageKeys = (c.stages || []).map((t) => stageK(t) || t);
      if (stageKeys.length) {
        const courses = courseOpts().filter((x) => stageKeys.includes(x.stage) && (!c.tracks.length || c.tracks.includes(x.track)));
        if (!courses.length) throw new Error("لا توجد دورة تجمع المسار والمرحلة المختارين.");
        cmds = courses.map((x) => mk({ training_course_id: x.v }, x.t));
      } else cmds = trackOpts().map((o) => String(o.v)).filter((id) => !c.tracks.length || c.tracks.includes(id)).map((id) => mk({ track_id: id }, optLabel("track_id", id)));
      const res = await runCommands(cmds, { noGroup: true });
      const lists = res.filter((r) => r && r.type === "list").map((r, i) => ({ heads: r.heads, rows: r.rows, label: r.label || cmds[i].label, details: r.details }));
      if (!lists.length) throw new Error("لم تُرجع القراءة قوائم طلاب.");
      c.out = { at: new Date(), lists };
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  const gapRowsOut = (st) => st.withGaps.slice().sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name, "ar")).map((r) => [r.name, r.id, r.phone, r.course, r.group, r.missing.join("، "), String(r.missing.length)]);
  function gapsResult() {
    const o = state.gaps.out; if (!o) return "";
    const fs = gapFieldList().filter((f) => gapSelected().includes(f.name)), st = gapStats(o.lists, fs);
    const miss = st.per.filter((p) => !p.found).map((p) => p.f.label), capped = o.lists.some((l) => l.details && l.details.capped);
    const sumRows = st.per.filter((p) => p.found).map((p) => [p.f.label, ui.fmt(p.filled), ui.fmt(p.viaApp), ui.fmt(p.blank), st.read ? Math.round((p.blank / st.read) * 100) + "%" : "—"]);
    const GH = ["الاسم", "رقم الهوية", "الجوال", "المسار / الدورة", "المجموعة", "ينقصه", "عدد الناقص"];
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> بيانات ناقصة <small>(${ui.fmt(st.read)} طالباً مقروءاً)</small></h3>
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(st.read)}</b> طالباً ${o.file ? "في الملف" : "قُرئت بياناته"}</span>${st.per.some((p) => p.viaApp) ? `<span class="cc-stat ok"><b>${ui.fmt(st.per.reduce((a, p) => a + p.viaApp, 0))}</b> خلية أُكملت من بيانات المتقدم</span>` : ""}<span class="cc-stat ${st.withGaps.length ? "bad" : "ok"}"><b>${ui.fmt(st.withGaps.length)}</b> ينقصهم حقل أو أكثر</span>${st.unread ? `<span class="cc-stat"><b>${ui.fmt(st.unread)}</b> لم تُقرأ بياناتهم</span>` : ""}
        <button type="button" class="btn secondary small" data-cc="gaps-xlsx">تنزيل Excel</button><button type="button" class="btn secondary small" data-cc="gaps-copy">نسخ الملخص</button></div>
      ${o.file ? `<p class="cc-note">المصدر: ${o.src === "system" ? "ملف «تصدير Excel» جُلب من نظام المركز بطلب واحد لكل دورة أو مسار" : "ملف التصدير الذي رفعتَه (بلا قراءة من النظام)"}. الخلية الفارغة في سجل الطالب تُكمَّل من سجل المتقدم قبل أن تُحسب ناقصة.</p>` : ""}
      ${miss.length ? `<p class="cc-alert warn">لم أجد عمود: ${esc(miss.join("، "))} في بيانات النظام، فلم تُحسب.</p>` : ""}
      ${st.unread || capped ? `<p class="cc-alert warn">قُرئت بيانات بعض الطلاب فقط (الحد الأقصى ٤٠٠ في كل مسار أو دورة، أو تعذّرت قراءة صفحاتهم): من لم تُقرأ بياناته لا يُعدّ ناقصاً. ضيّق النطاق بالمرحلة لتشمل القراءة الجميع.</p>` : ""}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الحقول: كم فارغ في النظام؟</h4></div></header>${dataTable("gap-sum", ["الحقل", "مُدخَل", "منه من المتقدم", "فارغ", "نسبة الفارغ"], sumRows)}</article>
      ${st.withGaps.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>من ينقصه؟</h4><span class="cc-badge bad">${ui.fmt(st.withGaps.length)}</span></div></header>${dataTable("gap-list", GH, gapRowsOut(st))}</article>` : '<p class="cc-alert ok">✓ لا ينقص أحداً شيء في الحقول المختارة.</p>'}
      <p class="cc-note">الفراغ هو فراغ في نظام المركز نفسه، وتكمله من صفحة «تعديل» الطالب هناك.</p></section>`;
  }
  async function gapsOutput(kind) {
    const o = state.gaps.out; if (!o) return;
    const fs = gapFieldList().filter((f) => gapSelected().includes(f.name)), st = gapStats(o.lists, fs);
    if (kind === "copy") {
      const lines = st.per.filter((p) => p.found).map((p) => "• " + p.f.label + ": فارغ عند " + p.blank + " من " + st.read);
      return ui.copyText("*بيانات ناقصة في نظام المركز*\n" + lines.join("\n") + "\nينقصهم شيء: " + st.withGaps.length + " طالباً").then(() => ui.toast("نُسخ الملخص"));
    }
    const wb = new ExcelJS.Workbook();
    fmtSheet(wb.addWorksheet("ملخص الحقول"), ["الحقل", "مُدخَل", "منه من المتقدم", "فارغ"], st.per.filter((p) => p.found).map((p) => [p.f.label, p.filled, p.viaApp, p.blank]));
    /* ورقة للتعبئة: بيانات الطالب ثم عمود لكل حقل مختار؛ الموجود يظهر، والناقص خلية فارغة مظلّلة تملؤها أنت */
    const fl = st.per.filter((p) => p.found).map((p) => p.f), fk = fl.map((f) => fs.indexOf(f));
    const base = ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المسار", "الدورة", "المجموعة"];
    const list = st.withGaps.slice().sort((a, b) => (a.track || a.course).localeCompare(b.track || b.course, "ar") || (a.group || "").localeCompare(b.group || "", "ar") || a.name.localeCompare(b.name, "ar"));
    const ws = wb.addWorksheet("من ينقصه (للتعبئة)");
    fmtSheet(ws, base.concat(fl.map((f) => f.label), ["عدد الناقص"]), list.map((x) => [x.name, x.stu, x.id, x.phone, x.track || "", x.course, x.group].concat(fk.map((k) => x.vals[k] || ""), [x.missing.length])));
    const edge = { style: "thin", color: { argb: "FFE0B000" } };
    list.forEach((x, i) => fk.forEach((k, j) => { if (!x.vals[k]) { const cell = ws.getRow(i + 2).getCell(base.length + j + 1); cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }; cell.border = { top: edge, bottom: edge, left: edge, right: edge }; } }));
    fl.forEach((f, j) => { const col = ws.getColumn(base.length + j + 1); col.width = Math.max(col.width || 0, 16); });
    return ui.download("بيانات ناقصة " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* ===== التقرير الشهري الموحّد: حضور وتقييمات وتوقيعات لكل مسار في مستند واحد على الترويسة ===== */
  const MON_KEY = "tamkeen:cc-monthly";
  function monthlyRange(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym || ""); if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), last = new Date(y, mo, 0).getDate(), pad = (n) => String(n).padStart(2, "0"), today = ui.todayISO();
    const to = y + "-" + pad(mo) + "-" + pad(last);
    return { from: y + "-" + pad(mo) + "-01", to: to > today ? today : to };
  }
  function monthlyCompose() {
    const c = state.monthly, ao = state.att.out; if (!ao) return null;
    const mo = c.mis ? state.mis.out : null, hasSig = !!(c.sig && state.sig.reg && state.sig.rows);
    const ntr = (t) => String(t || "").replace(/\s*[-–]?\s*المرحلة.*$/, "").replace(/^مسار\s*/, "").trim() || "بلا مسار";
    const tracks = new Map(), thr = Number(state.att.thr || 3);
    const T = (n) => tracks.get(n) || (tracks.set(n, { name: n, att: { students: 0, sessions: 0, absent: 0, excused: 0, late: 0, flagged: [] }, mis: null, sig: null }), tracks.get(n));
    (ao.students || []).forEach((s) => { const t = T(ntr(s.track)); t.att.students++; t.att.absent += s.absent; t.att.excused += s.excused; t.att.late += s.late; if (s.absent > thr) t.att.flagged.push({ name: s.name, group: grpCode(s.group) || s.group || "", absent: s.absent, streak: s.maxStreak || 0 }); });
    (ao.raw || []).forEach((se) => { T(ntr(se.track)).att.sessions++; });
    tracks.forEach((t) => t.att.flagged.sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name, "ar")));
    if (mo) mo.rows.forEach((x) => {
      const items = itemsOf(x, "all"); if (!items) return;
      const t = T(ntr(x.track)); t.mis = t.mis || { count: 0, by: {}, rows: [] };
      t.mis.count++; Object.keys(x.flags || {}).filter((k) => KIND_ITEM[k]).forEach((k) => { t.mis.by[KIND_SHORT[k]] = (t.mis.by[KIND_SHORT[k]] || 0) + 1; });
      t.mis.rows.push({ name: x.name, group: grpCode(x.group) || x.group || "", items });
    });
    if (hasSig) { const m = sigMatrix(); if (m) m.rows.forEach((r) => { const t = T(ntr(pledgeTrackOf(r.reg.course))); t.sig = t.sig || { total: 0, lacking: [] }; t.sig.total++; if (r.miss.length) t.sig.lacking.push({ name: r.reg.name, group: grpCode(r.reg.group) || r.reg.group || "", forms: r.miss.join("، ") }); }); }
    return { month: c.month, from: ao.from, to: ao.to, scope: scopeSummaryText(), thr, generated: ui.todayISO(), forms: sigForms().length, sources: { att: true, mis: !!mo, sig: hasSig }, tracks: [...tracks.values()] };
  }
  function monthlyView() {
    const c = state.monthly, r = monthlyRange(c.month), sigOk = !!(state.sig.reg && state.sig.rows);
    return `<section class="cc-card" id="cc-monthly">
      <header class="cc-card-h"><h3>تقرير الشهر</h3><p>يجمع في مستند واحد على الترويسة، لكل مسار: الحضور والغياب (والمنذَرون)، ومن لم يكمل الاستبيانات والتعهد، ومن لم يوقّع. تطبعه أو تنزّله Word أو Excel.</p></header>
      <div class="cc-card-b"><div class="cc-grid">
        <label class="cc-field"><span>الشهر</span><input type="month" data-mon="month" value="${esc(c.month)}"></label>
        <label class="cc-field"><span>يُنذَر الطالب إن زاد غيابه عن</span><input type="number" min="1" max="30" data-mon="thr" value="${esc(state.att.thr)}"></label>
        <label class="cc-chk"><input type="checkbox" data-mon="mis" ${c.mis ? "checked" : ""}> <span>أضف الناقصين في الاستبيانات والتعهد (قراءات أكثر)</span></label>
        <label class="cc-chk"><input type="checkbox" data-mon="sig" ${c.sig ? "checked" : ""} ${sigOk ? "" : "disabled"}> <span>أضف ناقصي التوقيع ${sigOk ? "(من جلسة التوقيعات المحفوظة)" : "(تتوفر بعد مطابقة التوقيعات)"}</span></label>
      </div><p class="cc-note">الفترة: ${esc(r ? r.from + " ← " + r.to : "—")}. اختر المرحلة والمسار من شريط «النطاق» (بلا اختيار تُقرأ كل المسارات)، والقراءة جلسة لكل جلسة تدريب في الشهر.</p></div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-monthly"))} أمر قراءة (تقدير أقصى)</b><span>${esc(scopeSummaryText())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-monthly" ${state.busy || !r ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "أعدّ تقرير الشهر"}</button></div></footer>
    </section>`;
  }
  async function runMonthly() {
    const c = state.monthly, r = monthlyRange(c.month);
    if (!r) { state.resultError = "اختر الشهر."; return render(); }
    c.out = null; state.att.from = r.from; state.att.to = r.to; state.att.excused = false;
    await runAttend();
    if (state.resultError || !state.att.out) return render();
    if (c.mis) { state.mis.kind = "all"; await runMissing(); if (state.resultError) return render(); }
    const d = monthlyCompose(); if (!d) return render();
    c.out = { at: new Date(), d, doc: App.monthlyReport.build(d) };
    render();
  }
  function monthlyResult() {
    const o = state.monthly.out; if (!o) return "";
    const d = o.d, sum = o.doc.blocks.find((b) => b.kind === "table");
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> تقرير ${esc(App.monthlyReport.monthLabel(d.month))} <small>(${ui.fmt(o.doc.tracks)} ${o.doc.tracks === 1 ? "مسار" : "مسارات"})</small></h3>
      <div class="cc-stats"><button type="button" class="btn navy small" data-cc="mon-print">طباعة على الترويسة</button><button type="button" class="btn secondary small" data-cc="mon-word">تنزيل Word</button><button type="button" class="btn secondary small" data-cc="mon-xlsx">تنزيل Excel</button><button type="button" class="btn secondary small" data-cc="mon-copy">نسخ الملخص</button></div>
      <p class="cc-note">مصادر التقرير: الحضور${d.sources.mis ? "، الاستبيانات والتعهد" : ""}${d.sources.sig ? "، التوقيعات" : ""}. التفاصيل (المنذَرون والناقصون بأسمائهم) في صفحة لكل مسار داخل المستند وفي ملف Excel.</p>
      ${dataTable("mon-sum", sum.headers, sum.rows)}</section>`;
  }
  async function monthlyOutput(kind) {
    const o = state.monthly.out; if (!o) return;
    const title = "التقرير الشهري " + App.monthlyReport.monthLabel(o.d.month);
    if (kind === "print") return App.docRender.print(o.doc.blocks, title, false);
    if (kind === "word") { try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* */ } return App.docRender.exportWord(o.doc.blocks, App.docRender.cleanFileName(title)); }
    if (kind === "xlsx") { const sh = App.monthlyReport.sheets(o.d); if (!sh.length) return; const wb = new ExcelJS.Workbook(); sh.forEach((x) => fmtSheet(wb.addWorksheet(x.name.slice(0, 31)), x.heads, x.rows)); return ui.download(title + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); }
    if (kind === "copy") { const sum = o.doc.blocks.find((b) => b.kind === "table"); const t = "*" + title + "*\n" + sum.rows.map((r) => r.map((x, i) => (i === 0 ? "• " + x : sum.headers[i] + " " + x)).join(" · ")).join("\n"); return ui.copyText(t).then(() => ui.toast("نُسخ الملخص")); }
  }

  function attView() {
    const c = state.att, today = ui.todayISO();
    return `<section class="cc-card" id="cc-att">
      <header class="cc-card-h"><h3>الحضور والغياب</h3><p>يقرأ جلسات التدريب التي سُجّل حضورها في الفترة، ثم حضور كل جلسة، ويجمع غياب كل طالب. يُعلَّم من تجاوز الحد ويُنبَّه إليه. للقراءة فقط، وبطلب منك وحدك. حدّد المسار والمرحلة والمجموعة من شريط «النطاق».</p></header>
      <div class="cc-card-b"><div class="cc-grid">
        <label class="cc-field"><span>من تاريخ</span><input type="date" data-att="from" value="${esc(c.from || today)}"></label>
        <label class="cc-field"><span>إلى تاريخ</span><input type="date" data-att="to" value="${esc(c.to || today)}"></label>
        <label class="cc-field"><span>يُنبَّه إن زاد الغياب عن</span><input type="number" min="1" max="30" data-att="thr" value="${esc(c.thr)}"></label>
        <label class="cc-field"><span>أقصى عدد جلسات تُقرأ</span><input type="number" min="1" max="200" data-att="max" value="${esc(c.max)}"></label>
        <label class="cc-chk"><input type="checkbox" data-att="excused" ${c.excused ? "checked" : ""}> <span>احسب «غياب بعذر» ضمن الغياب</span></label>
        <label class="cc-chk"><input type="checkbox" data-att="alwaysToday" ${c.alwaysToday ? "checked" : ""}> <span>عند تشغيله من «تقاريري المحفوظة» اقرأ <b>تاريخ اليوم</b> دائماً (للتقرير اليومي)</span></label>
      </div><p class="cc-note">تُقرأ جلسات المجموعات المطابقة للنطاق (الكل إن لم تحدّد)، وقراءة لكل جلسة، فاجعل الفترة قصيرة. للتقرير اليومي اجعل التاريخين اليوم.</p></div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(estimateReads("run-att"))} أمر قراءة (تقدير أقصى)</b><span>${esc(c.from || today)} ← ${esc(c.to || today)}</span></div>
        <div class="cc-act"><button type="button" class="btn secondary" data-cc="att-today" ${state.busy ? "disabled" : ""} title="يضبط الفترة على اليوم ويقرأ جلساته">تقرير اليوم</button><button type="button" class="btn navy" data-cc="run-att" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اجلب الحضور"}</button></div></footer></section>`;
  }
  /* ===== إلغاء طلبات طلاب محددين من جدول الحضور («ملغي») ثم إخراجهم من مجموعاتهم — كتابة بعد معاينة وموافقة ===== */
  function attCancelBar() {
    const n = selOf("att-0").size;
    const trs = attTracksList(), all = ((state.att.out && state.att.out.students) || []);
    const trackSel = trs.length > 1 ? `<label class="cc-field cc-att-track"><span>المسار</span><select data-att-track="1"><option value="">كل المسارات (${ui.fmt(all.length)})</option>${trs.map((t) => `<option value="${esc(t)}" ${state.att.trackFilter === t ? "selected" : ""}>${esc(t)} (${ui.fmt(all.filter((e) => e.track === t).length)})</option>`).join("")}</select></label>` : "";
    return `${trackSel}<div class="cc-cancelbar"><div class="cc-row"><span class="cc-note"><b data-selcount="att-0">${ui.fmt(n)}</b> محدداً</span>
        <button type="button" class="cc-link" data-cc="att-sel-flag">حدّد المنذَرين</button><button type="button" class="cc-link" data-cc="att-sel-none">إلغاء التحديد</button>
        <button type="button" class="btn danger small" data-cc="att-cancel" data-selbtn="att-0" ${n && !state.busy ? "" : "disabled"}>اجعل طلباتهم «ملغي» ثم أخرجهم من مجموعاتهم</button></div>
      <p class="cc-note">⚠ كتابة في نظام المركز: تظهر أولاً معاينة بالأسماء وحالة طلب كل منهم، ولا يُكتب شيء قبل موافقتك. لكل طالب: يُغيَّر طلبه إلى «ملغي» ويُتحقَّق، ثم يُخرج من مجموعته إن بقي فيها. ${agentHas(9) ? "" : "<b>يحتاج إضافة «وكيل تمكين» 1.5.9.</b>"}</p></div>`;
  }
  const CANCEL_APP = { cancelled: "✓ أُلغي", already: "كان ملغي أصلاً", failed: "✗ تعذّر", invalid: "✗ لم يُنفَّذ", skipped: "لم يُنفَّذ" };
  const CANCEL_GRP = { removed: "✓ أُخرج", none: "ليس في مجموعة", failed: "✗ ما زال فيها", "": "—" };
  function attCancelResult() {
    const o = state.att.cancelOut; if (!o || !o.rows) return "";
    const ok = o.rows.filter((x) => (x.app === "cancelled" || x.app === "already") && x.group !== "failed").length;
    return `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>نتيجة الإلغاء في نظام المركز</h4><span class="cc-badge${ok < o.rows.length ? " bad" : ""}">${ui.fmt(ok)} من ${ui.fmt(o.rows.length)}</span></div></header>
      ${dataTable("att-cancel", ["الطالب", "الرقم", "الطلب", "المجموعة", "ملاحظة"], o.rows.map((x) => [x.name, x.stu, CANCEL_APP[x.app] || x.app, CANCEL_GRP[x.group] || x.group, x.message || (x.was ? "كانت حالته «" + x.was + "»" : "")]))}
      <p class="cc-note">أعد تحميل الحضور لاحقاً لترى أثر الإلغاء. للتراجع: غيّر حالة الطلب من صفحة الطلب في النظام (الحالة السابقة في عمود الملاحظة).</p></article>`;
  }
  async function attCancelRun() {
    const set = selOf("att-0"); if (!set.size) return;
    if (!agentHas(9)) { state.resultError = "إلغاء الطلبات يحتاج إضافة «وكيل تمكين» بالإصدار 1.5.9 فأحدث: حدّثها من تنبيه التحديث ثم أعد المحاولة."; return render(); }
    const studs = (state.att.out && state.att.out.students) || [];
    const items = [...set].map((stu) => { const e = studs.find((x) => x.stu === stu) || {}; return { stu, name: e.name || "", track: e.track || "" }; });
    state.busy = true; state.resultError = ""; state.progress = ""; state.att.cancelOut = null; render(); refreshStatus();
    try {
      const res = await runCommands([{ type: "cancel", label: "إلغاء طلبات وإخراج من المجموعات", items, status: "cancelled", removeFromGroup: true }], { noCache: true, noGroup: true });
      const r0 = res[0]; if (!r0 || r0.error) throw new Error((r0 && r0.error) || "لم تصل نتيجة الإلغاء.");
      state.att.cancelOut = r0;
      await logAdd(r0.rows, studs);
      r0.rows.filter((x) => x.app === "cancelled" || x.app === "already").forEach((x) => set.delete(x.stu));
      ui.toast("انتهى: " + ui.fmt(r0.rows.filter((x) => x.app === "cancelled").length) + " أُلغي، " + ui.fmt(r0.rows.filter((x) => x.group === "removed").length) + " أُخرج من مجموعته");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* ===== سجل الإلغاءات وتاريخ قراءات الحضور: على هذا الجهاز فقط (IndexedDB) =====
     السجل لا يُحذف بـ«مسح بيانات هذه الشاشة» (هو أثر ما كُتب في النظام)، ويُمسح من زرّه. الخمول يُخفيه ولا يحذفه. */
  const LOG_K = "cancelLog", HIST_K = "attHist", HIST_MAX = 12;
  const APP_CODE = { "مقدم": "submitted", "قيد المراجعة": "under_review", "مقبول": "accepted", "مرفوض": "rejected", "ملغي": "cancelled" };
  const kvGet = (k) => idbDo("readonly", (st) => st.get(k)).catch(() => null);
  const kvPut = (k, v) => idbDo("readwrite", (st) => st.put(v, k)).catch(() => {});
  async function extLoad() {
    const [lg, hs] = await Promise.all([kvGet(LOG_K), kvGet(HIST_K)]);
    state.cancelLog = Array.isArray(lg) ? lg : []; state.attHist = Array.isArray(hs) ? hs : [];
  }
  const logSave = () => kvPut(LOG_K, state.cancelLog || []);
  const histSave = () => kvPut(HIST_K, state.attHist || []);
  const dtText = (v) => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }); };
  const logUndoable = (x) => !x.undone && (x.op && x.op !== "cancel" ? !!x.undoItem : x.app === "cancelled" && !!x.wasCode && x.wasCode !== "cancelled");
  const OP_L = { stustatus: "حالة الطالب", move: "نقل", appstatus: "حالة الطلب", edit: "تعديل بيانات" };
  async function logAddW(op, rows) {
    if (!state.cancelLog) await extLoad();
    const now = new Date().toISOString(), studs = (state.att.out && state.att.out.students) || [];
    rows.filter((x) => x.res === "done").forEach((x) => {
      const e = studs.find((s2) => s2.stu === x.stu) || {};
      state.cancelLog.unshift({ id: op + ":" + x.stu + "@" + now, at: now, op, name: x.name || e.name || "", stu: x.stu, track: e.track || "", group: e.group || "", was: x.from || "", now: x.to || "", app: "", grp: "", undoItem: x.undo || null, undone: null });
    });
    await logSave();
  }
  async function logAdd(rows, studs) {
    if (!state.cancelLog) await extLoad();
    const now = new Date().toISOString();
    rows.filter((x) => x.app === "cancelled" || x.group === "removed").forEach((x) => {
      const e = studs.find((s) => s.stu === x.stu) || {};
      state.cancelLog.unshift({ id: x.stu + "@" + now, at: now, name: x.name || e.name || "", stu: x.stu, track: e.track || "", group: e.group || "", was: x.was || "", wasCode: x.wasCode || APP_CODE[x.was] || "", app: x.app, grp: x.group || "", undone: null });
    });
    await logSave();
  }
  async function logUndoRun() {
    const set = selOf("att-log"); if (!set.size) return;
    if (!agentHas(10)) { state.resultError = "التراجع عن الإلغاء يحتاج إضافة «وكيل تمكين» بالإصدار 1.5.10 فأحدث: حدّثها من تنبيه التحديث ثم أعد المحاولة."; return render(); }
    const L = state.cancelLog || [];
    const ents = [...set].map((stu) => L.find((x) => x.stu === stu && logUndoable(x))).filter(Boolean);
    if (!ents.length) { ui.toast("لا شيء قابل للتراجع في المحدد"); return; }
    const canc = ents.filter((x) => !x.op || x.op === "cancel"), other = ents.filter((x) => x.op && x.op !== "cancel");
    if (other.length && !agentWrite()) { state.resultError = "التراجع عن هذه الأوامر يحتاج إضافة «وكيل تمكين» بالإصدار 1.6.0 فأحدث: حدّثها من تنبيه التحديث ثم أعد المحاولة."; return render(); }
    state.busy = true; state.resultError = ""; state.progress = ""; state.att.undoOut = null; render(); refreshStatus();
    try {
      const now = new Date().toISOString(); let ok = 0; const rowsAll = [];
      if (canc.length) {
        const res = await runCommands([{ type: "cancel", label: "تراجع عن الإلغاء", undo: true, items: canc.map((x) => ({ stu: x.stu, name: x.name, track: x.track, status: x.wasCode })), status: "", removeFromGroup: false }], { noCache: true, noGroup: true });
        const r0 = res[0]; if (!r0 || r0.error) throw new Error((r0 && r0.error) || "لم تصل نتيجة التراجع.");
        rowsAll.push(...r0.rows);
        r0.rows.forEach((row) => { const e = canc.find((x) => x.stu === row.stu); if (e && (row.app === "cancelled" || row.app === "already")) { e.undone = { at: now, to: row.to || e.was }; set.delete(e.stu); ok++; } });
      }
      for (const op of [...new Set(other.map((x) => x.op))]) {
        const grp = other.filter((x) => x.op === op);
        const res = await runCommands([{ type: op, label: "تراجع: " + (OP_L[op] || op), undo: true, items: grp.map((x) => x.undoItem) }], { noCache: true, noGroup: true });
        const r0 = res[0]; if (!r0 || r0.error) throw new Error((r0 && r0.error) || "لم تصل نتيجة التراجع.");
        rowsAll.push(...r0.rows.map((x) => Object.assign({}, x, { app: x.res === "done" || x.res === "same" ? "cancelled" : x.res })));
        r0.rows.forEach((row) => { const e = grp.find((x) => x.stu === row.stu || (x.undoItem && (x.undoItem.stu === row.stu || String(x.undoItem.app) === row.stu))); if (e && (row.res === "done" || row.res === "same")) { e.undone = { at: now, to: e.was }; set.delete(e.stu); ok++; } });
      }
      state.att.undoOut = { rows: rowsAll };
      await logSave();
      ui.toast("أُعيد " + ui.fmt(ok) + " من " + ui.fmt(ents.length) + " إلى ما كان عليه");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  function attLogCard() {
    if (state.mode !== "attend" && state.mode !== "write") return "";
    const L = state.cancelLog;
    if (L == null) return state.snapPaused ? `<p class="cc-note">🗂 سجل الإلغاءات مخفي بعد الخمول. <button type="button" class="cc-link" data-cc="log-show">أظهره</button></p>` : "";
    if (!L.length) return "";
    const n = selOf("att-log").size, live = L.filter((x) => !x.undone).length, u = state.att.undoOut;
    const bad = u && u.rows ? u.rows.filter((x) => x.app !== "cancelled" && x.app !== "already") : [];
    const ACT = (x) => x.op && x.op !== "cancel" ? (OP_L[x.op] || x.op) + ": " + (x.was ? x.was + " ← " : "") + x.now : [x.app === "cancelled" ? "أُلغي" : x.app === "already" ? "كان ملغي" : "", x.grp === "removed" ? "أُخرج من مجموعته" : ""].filter(Boolean).join(" · ");
    const rows = L.map((x) => [dtText(x.at), x.name, x.stu, x.track, x.group, x.was || "—", ACT(x), x.undone ? "↩ أُعيد" + (x.undone.to ? " إلى «" + x.undone.to + "»" : "") + " " + dtText(x.undone.at) : logUndoable(x) ? "" : "لا يُتراجع عنه هنا"]);
    return `<article class="cc-res cc-log"><header class="cc-res-h"><div class="cc-res-t"><h4>🗂 سجل ما نُفّذ في النظام (على هذا الجهاز)</h4><span class="cc-badge">${ui.fmt(live)} قائماً${L.length > live ? " · " + ui.fmt(L.length - live) + " تُراجع عنه" : ""}</span></div>
        <div class="cc-act"><button type="button" class="btn secondary small" data-cc="log-word">تقرير Word</button><button type="button" class="btn secondary small" data-cc="log-print">طباعة / PDF</button><button type="button" class="btn secondary small" data-cc="log-xlsx">Excel</button></div></header>
      ${bad.length ? `<p class="cc-alert warn">تعذّر التراجع عن: ${esc(bad.map((x) => x.name + (x.message ? " (" + x.message + ")" : "")).join("، "))}</p>` : ""}
      <div class="cc-cancelbar cc-undobar"><div class="cc-row"><span class="cc-note"><b data-selcount="att-log">${ui.fmt(n)}</b> محدداً</span><button type="button" class="cc-link" data-cc="log-sel-none">إلغاء التحديد</button>
        <button type="button" class="btn danger small" data-cc="log-undo" data-selbtn="att-log" ${n && !state.busy ? "" : "disabled"}>تراجع: أعدهم إلى ما كانوا عليه</button><button type="button" class="cc-link" data-cc="log-clear">مسح السجل</button></div>
        <p class="cc-note">⚠ التراجع كتابة في نظام المركز: معاينة أولاً ولا يُكتب شيء قبل موافقتك. للإلغاء يُعيد حالة الطلب وحدها (الإعادة إلى المجموعة من صفحة المجموعات في النظام)، وللأوامر الأخرى يُعيد القيمة السابقة نفسها. ${agentHas(10) ? "" : "<b>يحتاج إضافة «وكيل تمكين» 1.5.10.</b>"}</p></div>
      ${dataTable("att-log", ["التاريخ", "الطالب", "الرقم", "المسار", "المجموعة", "الحالة السابقة", "ما نُفّذ", "التراجع"], rows, { sel: 2 })}</article>`;
  }
  /* تقرير الإلغاءات للإدارة: بحسب المسار والمجموعة ثم الأسماء (بلا هويات) */
  const logLive = () => (state.cancelLog || []).filter((x) => !x.undone && (x.app === "cancelled" || x.grp === "removed"));
  function logByGroup(L) {
    const m = new Map();
    L.forEach((x) => { const k = (x.track || "بلا مسار") + "\u0000" + (x.group || ""); const g = m.get(k) || { track: x.track || "بلا مسار", group: x.group || "", n: 0, out: 0 }; g.n++; if (x.grp === "removed") g.out++; m.set(k, g); });
    return [...m.values()].sort((a, b) => a.track.localeCompare(b.track, "ar") || a.group.localeCompare(b.group, "ar"));
  }
  function cancelBlocks() {
    const L = logLive(); if (!L.length) { ui.toast("لا إلغاءات قائمة في السجل"); return null; }
    const days = L.map((x) => String(x.at).slice(0, 10)).sort(), G = logByGroup(L), out = L.filter((x) => x.grp === "removed").length;
    const fd = (d) => ui.formatDate(d) || d;
    return [{ kind: "title", text: "تقرير الطلبات الملغاة" }, lhDate(), gap(),
      { kind: "para", text: "أُلغي " + ui.fmt(L.filter((x) => x.app === "cancelled").length) + " طلباً" + (days[0] === days[days.length - 1] ? " في " + fd(days[0]) : " بين " + fd(days[0]) + " و" + fd(days[days.length - 1])) + "، وأُخرج " + ui.fmt(out) + " منهم من مجموعاتهم، وذلك لتجاوز حدّ الغياب." },
      { kind: "bold", text: "بحسب المسار والمجموعة" },
      { kind: "table", headers: ["المسار", "المجموعة", "الملغاة", "أُخرجوا من المجموعة"], widths: [0.46, 0.18, 0.16, 0.2], align: [null, "center", "center", "center"],
        rows: G.map((g) => [g.track, g.group || "—", ui.fmt(g.n), ui.fmt(g.out)]).concat([["المجموع", "", ui.fmt(L.length), ui.fmt(out)]]) }, gap(),
      { kind: "bold", text: "الأسماء" },
      { kind: "table", headers: ["م", "الاسم", "المسار", "المجموعة", "تاريخ الإلغاء", "الحالة السابقة"], widths: [0.06, 0.32, 0.22, 0.1, 0.15, 0.15], align: ["center", null, null, "center", "center", "center"],
        rows: L.slice().sort((a, b) => (a.track || "").localeCompare(b.track || "", "ar") || (a.group || "").localeCompare(b.group || "", "ar") || a.name.localeCompare(b.name, "ar")).map((x, i) => [ui.fmt(i + 1), x.name, x.track || "—", x.group || "—", fd(String(x.at).slice(0, 10)), x.was || "—"]) }, gap(),
      { kind: "para", text: "مصدر البيانات: الإلغاءات المنفّذة في نظام المركز من «مساعد تمكين». هوية الطالب وجواله غير مدرجين حمايةً للخصوصية." }];
  }
  async function logXlsx() {
    const L = logLive(); if (!L.length) return ui.toast("لا إلغاءات قائمة في السجل");
    const wb = new ExcelJS.Workbook();
    fmtSheet(wb.addWorksheet("بحسب المجموعة"), ["المسار", "المجموعة", "الملغاة", "أُخرجوا من المجموعة"], logByGroup(L).map((g) => [g.track, g.group, g.n, g.out]));
    fmtSheet(wb.addWorksheet("الأسماء"), ["التاريخ", "الاسم", "رقم الطالب", "المسار", "المجموعة", "الحالة السابقة", "ما نُفّذ"], L.map((x) => [dtText(x.at), x.name, x.stu, x.track, x.group, x.was, [x.app === "cancelled" ? "أُلغي" : "", x.grp === "removed" ? "أُخرج من مجموعته" : ""].filter(Boolean).join(" · ")]));
    return ui.download("الطلبات الملغاة " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  /* (5) كل قراءة حضور تُحفظ ملخّصة؛ قراءة الفترة نفسها تحلّ محل سابقتها */
  async function histAdd(o) {
    if (!state.attHist) await extLoad();
    const rec = { id: String(Date.now()), at: new Date().toISOString(), from: o.from, to: o.to, sessions: o.sessions,
      students: o.students.map((e) => ({ stu: e.stu, name: e.name, track: e.track, group: e.group, absent: e.absent, excused: e.excused, sessions: e.sessions })) };
    o.histId = rec.id;
    state.attHist = [rec].concat(state.attHist.filter((h) => !(h.from === rec.from && h.to === rec.to))).slice(0, HIST_MAX);
    await histSave();
  }
  const ATT_VERD = { worse: "↑ ساء", better: "↓ تحسّن", same: "= كما هو", new: "جديد في الأحدث", gone: "غير موجود في الأحدث" };
  function attCompare(A, B) {   // A الأقدم، B الأحدث؛ المقارنة بنسبة الغياب من الجلسات لأن الفترتين قد تختلفان طولاً
    const cnt = (e) => e.absent + (state.att.excused ? e.excused : 0), rate = (e) => (e && e.sessions ? cnt(e) / e.sessions : null);
    const pa = new Map(A.students.map((e) => [e.stu, e])), pb = new Map(B.students.map((e) => [e.stu, e]));
    const tf = attTF(), keys = [...new Set([...pa.keys(), ...pb.keys()])];
    return keys.map((k) => {
      const a = pa.get(k), b = pb.get(k), e = b || a, ra = rate(a), rb = rate(b);
      const d = ra != null && rb != null ? rb - ra : null;
      const v = !a ? "new" : !b ? "gone" : Math.abs(d) < 0.05 ? "same" : d > 0 ? "worse" : "better";
      return { e, a, b, ra, rb, d, v };
    }).filter((x) => attInTrack(x.e, tf));
  }
  function attCmpCard() {
    const o = state.att.out; if (!o) return "";
    const H = (state.attHist || []).filter((h) => h.id !== o.histId && !(h.from === o.from && h.to === o.to));
    if (!H.length) return `<p class="cc-note">📊 تُحفظ كل قراءة حضور على هذا الجهاز: اقرأ فترة أخرى (مثل الأسبوع الماضي) وستقارن بينهما هنا، من تحسّن حضوره ومن ساء.</p>`;
    const pick = H.find((h) => h.id === state.att.cmpWith);
    const sel = `<label class="cc-field cc-att-track"><span>قارن بقراءة سابقة</span><select data-att-cmp="1"><option value="">اختر…</option>${H.map((h) => `<option value="${esc(h.id)}" ${pick === h ? "selected" : ""}>${esc(h.from)} ← ${esc(h.to)} · ${ui.fmt(h.students.length)} طالباً · ${ui.fmt(h.sessions)} جلسة</option>`).join("")}</select></label>`;
    if (!pick) return `<article class="cc-res cc-attcmp"><header class="cc-res-h"><div class="cc-res-t"><h4>📊 مقارنة فترتين</h4></div></header>${sel}</article>`;
    const cur = { from: o.from, to: o.to, students: o.students }, older = pick.from <= cur.from ? pick : cur, newer = older === pick ? cur : pick;
    const L = attCompare(older, newer), c = (v) => L.filter((x) => x.v === v).length;
    const pc = (r) => (r == null ? "—" : Math.round(r * 100) + "%"), ab = (e) => (e ? (e.absent + (state.att.excused ? e.excused : 0)) + " من " + e.sessions : "—");
    const ord = { worse: 0, new: 1, better: 2, same: 3, gone: 4 };
    const rows = L.sort((x, y) => ord[x.v] - ord[y.v] || (y.d || 0) - (x.d || 0) || x.e.name.localeCompare(y.e.name, "ar"))
      .map((x) => [x.e.name, x.e.stu, x.e.track, x.e.group, ab(x.a), pc(x.ra), ab(x.b), pc(x.rb), x.d == null ? "—" : (x.d > 0 ? "+" : "") + Math.round(x.d * 100) + " نقطة", ATT_VERD[x.v]]);
    return `<article class="cc-res cc-attcmp"><header class="cc-res-h"><div class="cc-res-t"><h4>📊 مقارنة فترتين: ${esc(older.from)} ← ${esc(older.to)} ثم ${esc(newer.from)} ← ${esc(newer.to)}</h4></div></header>${sel}
      <div class="cc-stats"><span class="cc-stat bad"><b>${ui.fmt(c("worse"))}</b> ساء حضوره</span><span class="cc-stat ok"><b>${ui.fmt(c("better"))}</b> تحسّن</span><span class="cc-stat"><b>${ui.fmt(c("same"))}</b> كما هو</span>${c("new") ? `<span class="cc-stat"><b>${ui.fmt(c("new"))}</b> جديد في الأحدث</span>` : ""}${c("gone") ? `<span class="cc-stat"><b>${ui.fmt(c("gone"))}</b> غير موجود في الأحدث</span>` : ""}</div>
      ${dataTable("att-cmp", ["الطالب", "الرقم", "المسار", "المجموعة", "غياب الأقدم", "نسبته", "غياب الأحدث", "نسبته", "التغيّر", "الحكم"], rows)}
      <p class="cc-note">المقارنة بنسبة الغياب من جلسات كل فترة (لأن الفترتين قد تختلفان طولاً)، وفرق أقل من 5 نقاط يُعدّ «كما هو». القراءات محفوظة على هذا الجهاز فقط (آخر ${HIST_MAX}).</p></article>`;
  }

  /* ===== «تنفيذ في النظام»: أوامر كتابة من هنا إلى نظام المركز (إضافة «وكيل تمكين» 1.6.0) =====
     كل أمر: معاينة في هذه الصفحة ← موافقتك ← كتابة بنموذج طازج ← تحقّق بالقراءة، ويُسجَّل في «سجل ما نُفّذ» مع التراجع. */
  const agentWrite = () => agentHas(99);   // 1.6.0 فأحدث
  const WR_OPS = [["stu", "حالة الطالب"], ["move", "النقل بين المجموعات"], ["app", "قبول/رفض الطلبات"], ["edit", "تعديل بيانات الطلاب"]];
  const STU_ST = [["active", "نشط"], ["under_review", "قيد المراجعة"], ["withdrawn", "منسحب"], ["graduated", "متخرج"], ["suspended", "موقوف"]];
  const APP_ST = [["submitted", "مقدم"], ["under_review", "قيد المراجعة"], ["interview_pending", "قيد المقابلة"], ["accepted", "مقبول"], ["rejected", "مرفوض"], ["waiting_list", "قائمة انتظار"], ["cancelled", "ملغي"]];
  /* أعمدة Excel ← حقول نموذج «تعديل» الطالب (الترتيب مهم: العنوان قبل نوع السكن) */
  const EDIT_COLS = [["current_address", /عنوان/], ["marital_status", /الحالة الاجتماعية/], ["phone_2", /(تواصل|جوال|هاتف)\s*(2|٢|الثاني|البديل)/], ["birth_date", /تاريخ الميلاد/],
    ["health_status", /الوضع الصحي|الحالة الصحية/], ["governorate_id", /المحافظة/], ["population_community_id", /التجمع/], ["displacement_status", /النزوح/],
    ["residence_type_id", /نوع السكن|طبيعة السكن/], ["family_members_count", /عدد أفراد/], ["breadwinner_status", /المعيل|معيل/], ["employment_status", /حالة العمل|العمل الحالي/],
    ["income_type_id", /الدخل/], ["education_level", /المستوى التعليمي|التحصيل/], ["specialization", /التخصص/], ["notes", /^ملاحظات$/]];
  const wrSel = (name, list, cur, attr) => `<select ${attr}>${list.map(([v, t]) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const wrLines = () => String(state.wr.text || "").split(/\r?\n/).map((l) => l.split(/[,\t;،]/).map((x) => clean(x))).filter((a) => a[0]);
  const attName = (stu) => { const e = ((state.att.out && state.att.out.students) || []).find((x) => x.stu === stu); return e || null; };
  function writeView() {
    const w = state.wr, n = wrLines().length, need = agentWrite() ? "" : `<p class="cc-alert warn">هذه الأوامر تحتاج إضافة «وكيل تمكين» بالإصدار <b>1.6.0</b> فأحدث. <a href="extension/tamkeen-center-agent.zip" download>نزّلها</a> وفكّ ضغطها فوق مجلدها القديم ثم اضغط ↻ في صفحة الإضافات.</p>`;
    const fromAtt = selOf("att-0").size ? `<button type="button" class="cc-link" data-cc="wr-from-att">أدرج المحددين في جدول الحضور (${ui.fmt(selOf("att-0").size)})</button>` : "";
    const tabs = `<div class="cc-chips" role="tablist">${WR_OPS.map(([k, t]) => `<button type="button" class="cc-pill ${w.op === k ? "on" : ""}" data-cc="wr-op" data-op="${k}">${esc(t)}</button>`).join("")}</div>`;
    let body = "", act = "";
    if (w.op === "stu" || w.op === "move") {
      const mv = w.op === "move";
      body = `<label class="cc-field cc-wide"><span>${mv ? "رقم الطالب (STU) أو هويته، ثم فاصلة والمجموعة الجديدة — طالب في كل سطر. سطر بلا مجموعة يأخذ «المجموعة للكل»" : "أرقام الطلاب (STU) أو أرقام هوياتهم — واحد في كل سطر"}</span>
          <textarea rows="6" data-wr="text" dir="ltr" placeholder="${mv ? "STU-20260101-00001, G2" : "STU-20260101-00001"}">${esc(w.text)}</textarea></label>
        <div class="cc-row">${fromAtt}<span class="cc-note">${ui.fmt(n)} سطراً</span></div>
        ${mv ? `<label class="cc-field"><span>المجموعة للكل (لمن لا مجموعة في سطره)</span><input type="text" data-wr="group" value="${esc(w.group)}" placeholder="مثل G2 أو S3G1"></label>`
          : `<label class="cc-field"><span>الحالة الجديدة</span>${wrSel("status", STU_ST, w.status, 'data-wr="status"')}</label>`}`;
      act = `<button type="button" class="btn danger" data-cc="wr-run" ${!state.busy ? "" : "disabled"}>معاينة ثم تنفيذ</button>`;
    } else if (w.op === "app") {
      const ts = [["", "كل المسارات"]].concat(trackOpts().map((o) => [String(o.v), o.t]));
      body = `<div class="cc-grid"><label class="cc-field"><span>المسار</span>${wrSel("t", ts, w.appTrack, 'data-wr="appTrack"')}</label>
          <label class="cc-field"><span>الطلبات التي حالتها</span>${wrSel("f", [["", "كل الحالات"]].concat(APP_ST), w.appFilter, 'data-wr="appFilter"')}</label>
          <div class="cc-field"><span>&nbsp;</span><button type="button" class="btn secondary" data-cc="wr-apps" ${state.busy ? "disabled" : ""}>اقرأ الطلبات</button></div></div>
        ${w.apps ? `<div class="cc-cancelbar"><div class="cc-row"><span class="cc-note"><b data-selcount="wr-apps">${ui.fmt(selOf("wr-apps").size)}</b> محدداً</span>
          <label class="cc-field"><span>اجعل حالتها</span>${wrSel("s", APP_ST, w.appStatus, 'data-wr="appStatus"')}</label>
          <button type="button" class="btn danger small" data-cc="wr-run" data-selbtn="wr-apps" ${selOf("wr-apps").size && !state.busy ? "" : "disabled"}>معاينة ثم تنفيذ</button></div></div>
          ${dataTable("wr-apps", ["رقم الطلب", "المتقدم", "المسار", "الحالة", "الدرجة", "تاريخ التقديم", "#"], w.apps.map((a) => [a.no, a.name, a.track, a.status, a.score, a.date, a.app]), { sel: 6 })}` : ""}`;
    } else {
      const items = w.edit || [], cols = [...new Set(items.flatMap((x) => Object.keys(x.fields)))];
      body = `<p class="cc-note">ارفع ملف Excel فيه عمود <b>رقم الطالب</b> (أو <b>رقم الهوية</b>) وأعمدة بأسماء الحقول (مثل الحالة الاجتماعية، تاريخ الميلاد، المحافظة، العنوان…). ملف «بيانات ناقصة» الذي تنزّله من أداة النواقص وتملؤه يصلح كما هو.</p>
        <label class="cc-field"><span>ملف Excel</span><input type="file" accept=".xlsx" id="cc-wr-file"></label>
        <label class="cc-chk"><input type="checkbox" data-wr="onlyEmpty" ${w.onlyEmpty ? "checked" : ""}> <span>املأ الفارغ فقط (لا تستبدل ما هو مُدخَل في النظام) — موصى به</span></label>
        ${items.length ? `<p class="cc-note">📄 ${esc(w.editFile)}: <b>${ui.fmt(items.length)}</b> طالباً، والحقول: ${esc(cols.map((k) => (EDIT_COLS.find((c) => c[0] === k) ? k : k)).map((k) => ({ current_address: "العنوان", marital_status: "الحالة الاجتماعية", phone_2: "رقم تواصل 2", birth_date: "تاريخ الميلاد", health_status: "الوضع الصحي", governorate_id: "المحافظة", population_community_id: "التجمع السكاني", displacement_status: "النزوح", residence_type_id: "نوع السكن", family_members_count: "عدد أفراد الأسرة", breadwinner_status: "المعيل", employment_status: "حالة العمل", income_type_id: "الدخل", education_level: "المستوى التعليمي", specialization: "التخصص", notes: "ملاحظات" }[k] || k)).join("، "))}</p>` : ""}`;
      act = `<button type="button" class="btn danger" data-cc="wr-run" ${items.length && !state.busy ? "" : "disabled"}>معاينة ثم تنفيذ (${ui.fmt(items.length)})</button>`;
    }
    return `<section class="cc-card" id="cc-write"><header class="cc-card-h"><h3>تنفيذ في نظام المركز</h3><p>أوامر تُكتب في النظام من هنا. تظهر معاينة بكل طالب وما سيتغيّر (قبل ← بعد)، ولا يُكتب شيء قبل موافقتك؛ وبعد كل كتابة يُقرأ النظام للتحقق، ويتوقف بعد 3 إخفاقات متتالية. كل ما نُفّذ يُسجَّل أسفل الصفحة مع زر «تراجع».</p></header>
      <div class="cc-card-b">${need}${tabs}${body}</div>
      ${act ? `<footer class="cc-actions"><div class="cc-sum"><span>⚠ كتابة في نظام المركز بعد موافقتك</span></div><div class="cc-act">${act}</div></footer>` : ""}</section>`;
  }
  const WR_RES = { done: "✓ نُفّذ", same: "لا تغيير", invalid: "✗ لن يُنفَّذ", failed: "✗ تعذّر", skipped: "لم يُنفَّذ" };
  function writeResult() {
    const o = state.wr.out;
    const res = o && o.rows ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>نتيجة التنفيذ: ${esc(o.label || "")}</h4><span class="cc-badge${o.rows.some((x) => x.res === "failed") ? " bad" : ""}">${ui.fmt(o.rows.filter((x) => x.res === "done").length)} نُفّذ من ${ui.fmt(o.rows.length)}</span></div></header>
      ${dataTable("wr-out", ["الطالب", "الرقم", "النتيجة", "قبل", "بعد", "ملاحظة"], o.rows.map((x) => [x.name, x.stu, WR_RES[x.res] || x.res, x.from || "", x.to || "", x.message || ""]))}</article>` : "";
    return `<section class="cc-results">${res}${attLogCard()}</section>`;
  }
  async function wrApps() {
    if (!agentWrite()) { state.resultError = "قراءة الطلبات وتغيير حالتها تحتاج إضافة «وكيل تمكين» 1.6.0 فأحدث."; return render(); }
    const w = state.wr; state.busy = true; state.resultError = ""; render(); refreshStatus();
    try {
      const params = {}; if (w.appTrack) params.track_id = w.appTrack; if (w.appFilter) params.status = w.appFilter;
      const r = (await runCommands([{ type: "apps", label: "قائمة الطلبات", params }], { noCache: true, noGroup: true }))[0];
      if (!r || r.error) throw new Error((r && r.error) || "لم تصل قائمة الطلبات.");
      w.apps = r.rows; selOf("wr-apps").clear();
      if (!r.rows.length) ui.toast("لا طلبات بهذا الشرط");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  function wrCommand() {
    const w = state.wr;
    if (w.op === "stu") return { type: "stustatus", label: "حالة الطالب ← " + (STU_ST.find((x) => x[0] === w.status) || [])[1], status: w.status, items: wrLines().map((a) => { const e = attName(a[0]); return { stu: a[0], name: (e && e.name) || "" }; }) };
    if (w.op === "move") {
      const items = wrLines().map((a) => { const e = attName(a[0]); return { stu: a[0], name: (e && e.name) || "", track: (e && e.track) || "", group: a[1] || w.group }; });
      if (items.some((x) => !x.group)) throw new Error("حدّد المجموعة الجديدة لكل سطر، أو اكتبها في «المجموعة للكل».");
      return { type: "move", label: "النقل بين المجموعات", items };
    }
    if (w.op === "app") {
      const set = selOf("wr-apps"), apps = w.apps || [];
      return { type: "appstatus", label: "حالة الطلبات ← " + (APP_ST.find((x) => x[0] === w.appStatus) || [])[1], status: w.appStatus, items: apps.filter((a) => set.has(String(a.app))).map((a) => ({ app: a.app, name: a.name })) };
    }
    return { type: "edit", label: "تعديل بيانات الطلاب", onlyEmpty: !!w.onlyEmpty, items: (w.edit || []).map((x) => ({ stu: x.stu, name: x.name, fields: x.fields })) };
  }
  async function wrRun() {
    if (!agentWrite()) { state.resultError = "هذه الأوامر تحتاج إضافة «وكيل تمكين» بالإصدار 1.6.0 فأحدث: نزّلها من الرابط أعلى الأداة ثم أعد المحاولة."; return render(); }
    let cmd; try { cmd = wrCommand(); } catch (e) { state.resultError = e.message; return render(); }
    if (!cmd.items.length) return ui.toast("لا طلاب في الأمر");
    state.busy = true; state.resultError = ""; state.progress = ""; state.wr.out = null; render(); refreshStatus();
    try {
      const r0 = (await runCommands([cmd], { noCache: true, noGroup: true }))[0];
      if (!r0 || r0.error) throw new Error((r0 && r0.error) || "لم تصل نتيجة التنفيذ.");
      state.wr.out = r0;
      await logAddW(cmd.type, r0.rows);
      if (cmd.type === "appstatus") { const done = new Set(r0.rows.filter((x) => x.res === "done").map((x) => x.stu)); (state.wr.apps || []).forEach((a) => { if (done.has(String(a.app))) { a.status = (r0.rows.find((x) => x.stu === String(a.app)) || {}).to || a.status; selOf("wr-apps").delete(String(a.app)); } }); }
      ui.toast("انتهى: نُفّذ " + ui.fmt(r0.rows.filter((x) => x.res === "done").length) + " من " + ui.fmt(r0.rows.length));
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* ملف Excel ← بنود تعديل: عمود رقم الطالب أو الهوية، وأعمدة الحقول بأسمائها */
  async function wrReadEdit(file) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const txt = (c) => clean(c && c.text != null ? c.text : c && c.value != null ? c.value : "");
    for (const ws of wb.worksheets) {
      for (let hr = 1; hr <= Math.min(6, ws.rowCount); hr++) {
        const heads = []; ws.getRow(hr).eachCell({ includeEmpty: true }, (c, i) => { heads[i] = txt(c); });
        const iS = heads.findIndex((h) => /^رقم الطالب$/.test(h || "")), iI = heads.findIndex((h) => /رقم الهوية|^الهوية$/.test(h || "")), iN = heads.findIndex((h) => /^(الاسم|اسم الطالب|الاسم الرباعي)$/.test(h || ""));
        if (iS < 0 && iI < 0) continue;
        const map = []; heads.forEach((h, i) => { if (!h || i === iS || i === iI || i === iN) return; const f = EDIT_COLS.find(([, rx]) => rx.test(h)); if (f && !map.some((m) => m[0] === f[0])) map.push([f[0], i]); });
        if (!map.length) throw new Error("لم أجد في الملف أعمدة حقول معروفة (مثل الحالة الاجتماعية، تاريخ الميلاد، المحافظة، العنوان).");
        const items = [];
        for (let ri = hr + 1; ri <= ws.rowCount; ri++) {
          const row = ws.getRow(ri), key = (iS >= 0 && txt(row.getCell(iS))) || (iI >= 0 && txt(row.getCell(iI)));
          if (!key) continue;
          const fields = {}; map.forEach(([k, i]) => { const v = txt(row.getCell(i)); if (v) fields[k] = v; });
          if (Object.keys(fields).length) items.push({ stu: key, name: iN >= 0 ? txt(row.getCell(iN)) : "", fields });
        }
        return items;
      }
    }
    throw new Error("لم أجد في الملف عمود «رقم الطالب» أو «رقم الهوية».");
  }
  function attResult() {
    const o = state.att.out;
    if (!o) return attLogCard();
    const fl = attFlagged(), rows = attTable(), day = attDayTable(), near = attNear();
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> الحضور والغياب</h3>
      ${o.note ? `<p class="cc-alert warn">${esc(o.note)} ${(state.groups || []).length && (state.att.tracks || []).length ? "جرّب إزالة اختيار المسارات، فقد لا توجد المجموعات المختارة في تلك المسارات." : ""} (G1 وG2 للمرحلة الثانية، وS3G1 وS3G2 للثالثة.)</p>` : ""}
      ${fl.length ? `<div class="cc-alert err" role="alert"><span>⚠ <b>${ui.fmt(fl.length)}</b> طالباً تجاوزوا ${esc(state.att.thr)} غيابات${state.att.excused ? " (بالعذر)" : ""}. يظهرون أولاً في الجدول بعلامة «⚠ تجاوز».</span><button type="button" class="btn secondary small" data-cc="att-copy">نسخ قائمة المتجاوزين</button></div>` : `<p class="cc-note">لا طالب تجاوز ${esc(state.att.thr)} غيابات في هذه الفترة.</p>`}
      ${near.length ? `<div class="cc-alert warn cc-att-near" role="status"><span>🔔 <b>${ui.fmt(near.length)}</b> طالباً وصلوا إلى الحد (${esc(state.att.thr)} غيابات)${state.att.excused ? " بالعذر" : ""}: غياب واحد آخر يتجاوزونه. علامتهم في الجدول «🔔 على الحد».</span><button type="button" class="btn secondary small" data-cc="att-near-copy">نسخ قائمتهم</button><button type="button" class="cc-link" data-cc="att-sel-near">حدّدهم في الجدول</button></div>` : ""}
      ${(() => {
        const gs = attGroups();
        if (!gs.length) return "";
        const sum = gs.reduce((a, e) => a + e.absent.length, 0);
        return `<article class="cc-res cc-att-groups"><header class="cc-res-h"><div class="cc-res-t"><h4>غائبو ${esc(o.lastDay)} بحسب المجموعة</h4><span class="cc-badge">${ui.fmt(sum)} غائباً في ${ui.fmt(gs.length)} مجموعة</span></div><button type="button" class="btn secondary small" data-cc="att-wa-all">نسخ نصوص كل المجموعات</button></header>
          <div class="cc-att-gl">${gs.map((e, i) => `<div class="cc-att-g"><div><b>${esc(e.track)}</b>${e.group ? ` <small>${esc(e.group)}</small>` : ""}<span class="cc-badge ${e.absent.length > 3 ? "bad" : ""}">${ui.fmt(e.absent.length)}${e.total ? " / " + ui.fmt(e.total) : ""}</span></div>
            <p>${esc(e.absent.slice(0, 6).join("، "))}${e.absent.length > 6 ? " … و" + ui.fmt(e.absent.length - 6) + " آخرون" : ""}</p><button type="button" class="cc-link" data-cc="att-wa" data-i="${i}">نسخ نص واتساب</button></div>`).join("")}</div></article>`;
      })()}
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(o.sessions)}</b> جلسة قُرئت${o.truncated ? ` من ${ui.fmt(o.listed)} (اقتُصر على الحد الأقصى؛ ارفعه أو قصّر الفترة)` : ""}</span><span class="cc-stat"><b>${ui.fmt(o.students.length)}</b> طالباً</span><span class="cc-stat"><b>${ui.fmt(o.students.reduce((a, e) => a + e.absent, 0))}</b> غياباً</span>${rows.length ? '<button type="button" class="btn secondary small" data-cc="export-att">تنزيل Excel</button>' : ""}</div>
      ${rows.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الغياب لكل طالب (${esc(o.from)} ← ${esc(o.to)})</h4><span class="cc-badge">${ui.fmt(rows.length)} طالباً</span></div></header>${attCancelBar()}${dataTable("att-0", attHeads(), rows, { sel: 1, track: false })}</article>${attCancelResult()}` : '<p class="cc-note">لا جلسات بسجلات حضور في هذه الفترة والنطاق.</p>'}
      ${day.length ? `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>غائبو آخر يوم (${esc(o.lastDay)})</h4><span class="cc-badge">${ui.fmt(day.length)}</span></div></header>${dataTable("att-1", attDayHeads(), day)}</article>` : ""}
      ${attCmpCard()}${attLogCard()}
      <p class="cc-note">قُرئت ${esc(new Date(o.at).toLocaleString("ar"))}. لا يُكتب شيء في نظام المركز.</p></section>`;
  }
  function impView() {
    const c = state.imp;
    return `<section class="cc-card" id="cc-imp">
      <header class="cc-card-h"><h3>إحصاءات قياس الأثر</h3><p>يقرأ صفحة «ملخص قياس الأثر» في نظام المركز لفترة تحددها، بكل جداولها وأرقامها، ثم تصفّيها هنا بالمسار والمرحلة. للقراءة فقط، وبطلب منك وحدك.</p></header>
      <div class="cc-card-b"><div class="cc-chips" role="tablist" aria-label="التقارير المطلوبة">${IMP_PAGES.map(([k, t]) => `<label class="cc-chk"><input type="checkbox" data-imp="pages" value="${k}" ${c.pages.includes(k) ? "checked" : ""}> <span>${esc(t)}</span></label>`).join("")}</div>
      <div class="cc-grid">
        <label class="cc-field"><span>من تاريخ</span><input type="date" data-imp="from" value="${esc(c.from)}"></label>
        <label class="cc-field"><span>إلى تاريخ (فارغ = اليوم)</span><input type="date" data-imp="to" value="${esc(c.to)}"></label>
        <label class="cc-field cc-wide"><span>معاملات إضافية للرابط (اختياري، مثل <code>status=all</code>؛ كلٌّ في سطر أو يفصلها &amp;)</span><input type="text" data-imp="extra" value="${esc(c.extra)}" placeholder="status=all"></label>
        <fieldset class="cc-fs"><legend>المسارات${c.tracks.length ? ` <em>${ui.fmt(c.tracks.length)}</em>` : ""}</legend><div class="cc-chips">${trackOpts().map((o) => `<label class="cc-chk"><input type="checkbox" data-imp="tracks" value="${esc(o.v)}" ${c.tracks.includes(String(o.v)) ? "checked" : ""}> <span>${esc(o.t.replace(/^مسار\s*/, ""))}</span></label>`).join("")}</div></fieldset>
        <fieldset class="cc-fs"><legend>المراحل${c.stages.length ? ` <em>${ui.fmt(c.stages.length)}</em>` : ""}</legend><div class="cc-chips">${STAGES.map((g) => `<label class="cc-chk"><input type="checkbox" data-imp="stages" value="${esc(g.t)}" ${c.stages.includes(g.t) ? "checked" : ""}> <span>${esc(g.t)}</span></label>`).join("")}</div><p class="cc-note">اتركها فارغة لتشمل كل المراحل. تُطبَّق على الجداول بعد الجلب دون قراءة جديدة.</p></fieldset>
      </div><p class="cc-note">الرابط المقروء: <code dir="ltr">/admin/evaluation-impact-reports/${IMP_PATH[c.pages[0]] || "summary"}?${esc(new URLSearchParams(impParams()).toString())}</code>${c.pages.length > 1 ? " وغيره من التقارير المختارة" : ""}. اختر أكثر من تقرير فيُنزَّل الناتج ملفاً مضغوطاً فيه ملف Excel لكل تقرير. «كل الحالات» هي الوضع الافتراضي لهذه الصفحة؛ وبعد القراءة تُعرض لك قوائم التصفية التي في صفحة النظام لتعرف معاملاتها.</p></div>
      <footer class="cc-actions"><div class="cc-sum"><b>${ui.fmt(c.pages.length || 1)} ${c.pages.length > 2 || !c.pages.length ? "أوامر" : c.pages.length === 2 ? "أمرا" : "أمر"} قراءة</b><span>${esc(c.from || "…")} ← ${esc(c.to || ui.todayISO())}</span></div>
        <div class="cc-act"><button type="button" class="btn navy" data-cc="run-imp" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ القراءة…" : "اجلب الإحصاءات"}</button></div></footer></section>`;
  }
  /* اختيار المرحلة/المسار/المساق/الحالة من قوائم صفحة النظام نفسها، ثم إعادة الجلب بضغطة منك */
  function impServerFilters(o) {
    const fs = (o.filters || []).filter((x) => x.name && !/^date_(from|to)$/.test(x.name) && (x.type === "select" || x.type === "checkbox") && (x.options || []).length > 1);
    if (!fs.length) return "";
    const cur = (x) => (x.name in state.imp.srv ? state.imp.srv[x.name] : x.value || "");
    const grp = (x) => { const cv = x.name in state.imp.srv ? state.imp.srv[x.name] : (x.value || []); return `<fieldset class="cc-fs"><legend>${esc(x.label)}${cv.length ? ` <em>${ui.fmt(cv.length)}</em>` : ""}</legend><div class="cc-chips">${x.options.map((q) => `<label class="cc-chk"><input type="checkbox" data-impsrvc="${esc(x.name)}" value="${esc(q.v)}" ${cv.map(String).includes(String(q.v)) ? "checked" : ""}> <span>${esc(q.t)}</span></label>`).join("")}</div></fieldset>`; };
    return `<details class="cc-adv" open><summary><span>اختر من قوائم النظام</span><small>${fs.map((x) => esc(x.label)).join("، ")}</small></summary>
      <div class="cc-grid">${fs.map((x) => x.type === "checkbox" ? grp(x) : `<label class="cc-field"><span>${esc(x.label)}</span><select data-impsrv="${esc(x.name)}">${x.options.map((q) => `<option value="${esc(q.v)}" ${String(cur(x)) === String(q.v) ? "selected" : ""}>${esc(q.t || "الكل")}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="cc-row"><button type="button" class="btn navy small" data-cc="imp-apply" ${state.busy ? "disabled" : ""}>طبّق وأعد الجلب</button><span class="cc-note">يُرسَل اختيارك إلى صفحة النظام فتعيد حسابها، ويُقرأ أمر واحد.</span></div></details>`;
  }
  function impResult() {
    const o = state.imp.out;
    if (!o) return "";
    const opt = impOptions(), tabs = impFiltered(), f = state.imp;
    const sel = (k, list, label) => `<label class="cc-field"><span>${label}</span><select data-imp="${k}"><option value="">الكل</option>${list.map((x) => `<option value="${esc(x)}" ${f[k] === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`;
    const hasFilter = opt.courses.length > 0;
    return `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> إحصاءات قياس الأثر</h3>
      ${Object.keys(state.imp.outs).length > 1 ? `<div class="cc-chips" role="tablist" aria-label="التقرير المعروض">${IMP_PAGES.filter(([k]) => state.imp.outs[k]).map(([k, t]) => `<label class="cc-chk"><input type="radio" name="imp-view" data-imp="view" value="${k}" ${state.imp.view === k ? "checked" : ""}> <span>${esc(t)}</span></label>`).join("")}</div>` : ""}
      ${(o.widened || []).length ? `<p class="cc-note">وُسِّعت التصفية الافتراضية في صفحة النظام إلى الجميع: ${o.widened.map(esc).join("، ")}.</p>` : ""}
      <div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(tabs.length)}</b> جدولاً</span><span class="cc-stat"><b>${ui.fmt(tabs.reduce((a, t) => a + t.rows.length, 0))}</b> صفاً بعد التصفية</span>
        ${(o.stats || []).slice(0, 12).map((x) => `<span class="cc-stat"><b>${esc(x.value)}</b> ${esc(x.label)}</span>`).join("")}
        ${tabs.some((t) => t.rows.length) ? '<button type="button" class="btn secondary small" data-cc="export-imp">تنزيل Excel</button>' : ""}</div>
      ${hasFilter ? `<div class="cc-grid">${opt.courses.length ? sel("course", opt.courses, "المساق") : ""}</div>` : '<p class="cc-note">التصفية بالمسارات والمراحل المختارة أعلاه تُطبَّق على كل جدول فيه عمود أو نص يدل عليها.</p>'}
      ${(() => {
        const low = [];
        tabs.forEach((t) => { const ci = t.heads.findIndex((h) => /نسبة الاستجابة/.test(h)); if (ci < 0) return; const ni = t.heads.findIndex((h) => /النموذج|المسار/.test(h)); t.rows.forEach((r) => { if (lowCell(t.heads[ci], r[ci])) low.push({ name: ni >= 0 ? r[ni] : "", pct: pctOf(r[ci]) }); }); });
        if (!low.length) return "";
        low.sort((a, b) => a.pct - b.pct);
        return `<div class="cc-alert err" role="alert"><span>⚠ <b>${ui.fmt(low.length)}</b> صفاً نسبة استجابته دون ${ui.fmt(state.imp.respThr)}%. أدنى النسب: ${low.slice(0, 4).map((x) => esc((x.name || "—") + " (" + x.pct + "%)")).join("، ")}.</span></div>`;
      })()}
      <label class="cc-field cc-thr"><span>يُنبَّه إن قلّت نسبة الاستجابة عن (%)</span><input type="number" min="0" max="100" data-imp="respThr" value="${esc(state.imp.respThr)}"></label>
      ${!tabs.length ? `<p class="cc-alert warn">لم أجد جداول في الصفحة${o.text ? ". هذا مقتطف مما قرأتُه: " + esc(o.text.slice(0, 300)) : ""}. أرسل لي بنية الصفحة (سكربت tools/ksach-pages.js) لأضبط قراءتها.</p>` : ""}
      ${tabs.map((t) => `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${esc(t.title)}</h4><span class="cc-badge">${ui.fmt(t.rows.length)} صفاً</span></div></header>
        ${t.noTrack || t.noStage ? `<p class="cc-alert warn">لا أجد في هذا الجدول ما يدل على ${t.noTrack && t.noStage ? "المسار والمرحلة" : t.noTrack ? "المسار" : "المرحلة"} (لا عمود ولا نص في الصفوف ولا في عنوانه «${esc(t.title)}»)، فلا يمكن تصفيته وهو يظهر كاملاً.</p>` : ""}
        ${t.rows.length ? dataTable("imp-" + t.i, t.heads, t.rows) : '<p class="cc-note">لا صفوف مطابقة للتصفية.</p>'}</article>`).join("")}
      ${(() => { const sn = impSnaps(); return `<div class="cc-row cc-imp-tools"><button type="button" class="btn secondary small" data-cc="imp-snap-save">احفظ لقطة للمقارنة</button>${impWaText() ? '<button type="button" class="btn secondary small" data-cc="imp-copy-wa">نسخ ملخص واتساب</button>' : ""}${sn.length ? `<label class="cc-field cc-inline"><span>قارن مع لقطة</span><select data-imp="cmpWith"><option value="">بلا مقارنة</option>${sn.map((x) => `<option value="${esc(x.id)}" ${state.imp.cmpWith === x.id ? "selected" : ""}>${esc(snapLabel(x))}</option>`).join("")}</select></label>${state.imp.cmpWith ? '<button type="button" class="cc-link" data-cc="imp-snap-del">احذف اللقطة</button>' : ""}` : ""}</div>`; })()}
      ${(o.courses || []).length ? `<p class="cc-note">دُمجت ${ui.fmt(o.courses.length)} قراءة من صفحة النظام (مضاف عمود «${esc(o.tables[0] && o.tables[0].heads[o.tables[0].heads.length - 1] || "الدورة التدريبية")}»): ${o.courses.map(esc).join("، ")}. بطاقات الأرقام العلوية لا تُدمج.</p>` : ""}
      ${(o.tables || []).some((t) => t.heads.includes("عدد الإجابات")) ? `<label class="cc-chk"><input type="checkbox" data-imp="hideZero" ${state.imp.hideZero ? "checked" : ""}> <span>إخفاء الأسئلة التي لا إجابات عليها (${ui.fmt((o.tables || []).reduce((a, t) => { const z = t.heads.indexOf("عدد الإجابات"); return a + (z < 0 ? 0 : t.rows.filter((r) => Number(String(r.cells[z]).replace(/,/g, "")) === 0).length); }, 0))} سؤالاً)</span></label><p class="cc-note">سبب الأصفار: صفحة النظام تعرض أسئلة كل النماذج لكل دورة، فتظهر أسئلة نموذج مسار آخر بلا إجابات في هذه الدورة.</p>` : ""}
      ${(o.stagesAtFetch && o.stagesAtFetch.join() !== (state.imp.stages || []).join()) ? '<p class="cc-alert warn" role="alert">غيّرتَ المراحل بعد الجلب؛ اضغط «اجلب الإحصاءات» ليُقرأ ما يطابق اختيارك الجديد.</p>' : ""}
      ${impServerFilters(o)}
      ${(o.filters || []).length ? `<details class="cc-adv" ${(state.imp.stages || []).length && tabs.some((t) => t.noStage) ? "open" : ""}><summary><span>قوائم التصفية في صفحة النظام</span><small>معاملات الرابط المتاحة</small></summary><div class="cc-note">${o.filters.map((x) => `<div><code dir="ltr">${esc(x.name)}</code> — ${esc(x.label)}${x.options ? ": " + x.options.slice(0, 12).map((p) => esc(p.t) + ` (<code dir="ltr">${esc(p.v)}</code>)`).join("، ") : ""}</div>`).join("")}</div></details>` : ""}
      ${impCompareView()}
      <p class="cc-note">قُرئت ${esc(new Date(o.at).toLocaleString("ar"))}. التصفية هنا محلية في صفحتك، فلا تُرسل شيئاً إلى النظام.</p></section>`;
  }
  async function impWorkbook(tabs) {
    const wb = new ExcelJS.Workbook(), used = new Set();
    tabs.forEach((t, i) => { let nm = (String(i + 1) + "-" + t.title).replace(/[\/?*[\]:]/g, " ").slice(0, 31); while (used.has(nm)) nm = nm.slice(0, 28) + "·" + used.size; used.add(nm); fmtSheet(wb.addWorksheet(nm), t.heads, t.rows); });
    return wb.xlsx.writeBuffer();
  }
  async function exportImpZip() {
    const c = state.imp, keep = { out: c.out, view: c.view, course: c.course }, zip = new JSZip();
    try {
      for (const [k, t] of IMP_PAGES) {
        if (!c.outs[k]) continue;
        c.out = c.outs[k]; c.view = k;
        const tabs = impFiltered().filter((x) => x.rows.length);
        if (tabs.length) zip.file(t.replace(/[\/?*:"<>|]/g, " ") + ".xlsx", await impWorkbook(tabs));
      }
    } finally { c.out = keep.out; c.view = keep.view; c.course = keep.course; }
    if (!Object.keys(zip.files).length) { ui.toast("لا صفوف للتنزيل بعد التصفية."); return; }
    ui.download("تقارير قياس الأثر " + ui.todayISO() + ".zip", await zip.generateAsync({ type: "blob" }));
  }
  /* لقطات قياس الأثر: تُحفظ في هذا المتصفح للمقارنة لاحقاً بلا قراءة جديدة */
  const IMP_SNAP_KEY = "tamkeen-admin:cc-imp-snaps";
  const impSnaps = () => { const a = lsGet(IMP_SNAP_KEY, []); return Array.isArray(a) ? a : []; };
  function impSnapSave() {
    const c = state.imp, keep = { out: c.out, view: c.view }, pages = {};
    try { Object.keys(c.outs).forEach((k) => { c.out = c.outs[k]; pages[k] = impTables().map((t) => ({ title: t.title, heads: t.heads, rows: t.rows.slice(0, 500) })); }); } finally { c.out = keep.out; c.view = keep.view; }
    const list = impSnaps(); list.unshift({ id: String(Date.now()), at: new Date().toISOString(), from: c.from, to: c.to || ui.todayISO(), pages });
    lsSet(IMP_SNAP_KEY, list.slice(0, 6));
    ui.toast("حُفظت لقطة قياس الأثر للمقارنة لاحقاً");
  }
  const snapLabel = (sn) => new Date(sn.at).toLocaleDateString("ar") + " (" + sn.from + " ← " + sn.to + ")";
  function impCompareView() {
    const c = state.imp, sn = c.cmpWith && impSnaps().find((x) => x.id === c.cmpWith);
    if (!sn) return "";
    const old = sn.pages[c.view] || [];
    const blocks = impFiltered().map((t, i) => {
      const o = old.find((x) => x.title === t.title && x.heads.join("|") === t.heads.join("|"));
      if (!o || !t.rows.length) return "";
      const d = App.ccUtil.diffTables({ heads: t.heads, rows: t.rows }, o);
      return `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>${esc(t.title)} — الآن مقابل السابق</h4><span class="cc-badge">${ui.fmt(d.matched)} صفاً متطابقاً</span></div></header>${dataTable("impcmp-" + i, d.heads, d.rows)}</article>`;
    }).join("");
    return `<h3 class="cc-results-title">المقارنة مع لقطة ${esc(snapLabel(sn))}</h3>${blocks || '<p class="cc-note">لا جداول مطابقة في هذه اللقطة لهذا التقرير (يلزم أن تكون اللقطة محفوظة من الصفحة نفسها بأعمدتها نفسها).</p>'}`;
  }
  /* ملخص جاهز للصق في واتساب من جدول الملخص (نسبة الاستجابة لكل مسار ونوع) */
  function impWaText() {
    const t = impFiltered().find((x) => impHasCol(x.heads, /نسبة الاستجابة/) >= 0 && impHasCol(x.heads, /^(ال)?مسار$/) >= 0 && x.rows.length);
    if (!t) return "";
    const I = (rx) => impHasCol(t.heads, rx), iT = I(/^(ال)?مسار$/), iK = I(/^النوع$/), iR = I(/نسبة الاستجابة/), iA = I(/أجابوا/), iG = I(/المستهدفون/), iM = I(/المتوسط|متوسط/);
    const cell = (r, i) => (i >= 0 ? clean(r[i]) : "");
    const by = new Map(); t.rows.forEach((r) => { const k = cell(r, iT).replace(/^مسار\s*/, ""); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    const c = state.imp, lines = ["*ملخص قياس الأثر*", "الفترة: " + (c.from || "…") + " إلى " + (c.to || ui.todayISO())];
    if ((c.stages || []).length) lines.push("المرحلة: " + c.stages.join("، "));
    by.forEach((rows, k) => { lines.push("", "*" + k + "*"); rows.forEach((r) => lines.push("• " + (cell(r, iK) || "—") + ": استجابة " + cell(r, iR) + (iA >= 0 && iG >= 0 ? " (" + cell(r, iA) + " من " + cell(r, iG) + ")" : "") + (iM >= 0 && cell(r, iM) ? "، متوسط " + cell(r, iM) : ""))); });
    return lines.join("\n");
  }
  async function exportImp() {
    if (Object.keys(state.imp.outs).length > 1) return exportImpZip();
    const tabs = impFiltered().filter((t) => t.rows.length); if (!tabs.length) return;
    const wb = new ExcelJS.Workbook(), used = new Set();
    tabs.forEach((t, i) => { let nm = (String(i + 1) + "-" + t.title).replace(/[\\/?*[\]:]/g, " ").slice(0, 31); while (used.has(nm)) nm = nm.slice(0, 28) + "·" + used.size; used.add(nm); fmtSheet(wb.addWorksheet(nm), t.heads, t.rows); });
    ui.download("إحصاءات قياس الأثر " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* ===== المجموعات والمدربون + اقتراح توزيع غير الموزعين ===== */
  const grpGroupHeads = () => ["المسار", "المرحلة", "المجموعة", "المدرب", "عدد الطلاب", "الفرق عن المتوسط", "ملاحظة"];
  const grpTrainerHeads = () => ["المدرب", "عدد المجموعات", "عدد الطلاب", "المسارات"];
  const grpPropHeads = () => ["الطالب", "رقم الهوية", "المسار", "المرحلة", "المجموعة المقترحة", "مدرب المجموعة", "حجمها بعد التوزيع"];

  async function runGroups() {
    const c = state.grp;
    state.busy = true; state.resultError = ""; c.out = null; c.comp = null; state.progress = "";
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
  /* ===== الالتزام بالمتطلبات: نسبة المكتملين (القبلي والبعدي وقياس الأثر والتعهد) لكل مجموعة ومدرب ===== */
  const grpCompHeads = () => ["الترتيب", "المسار", "المرحلة", "المجموعة", "المدرب", "الطلاب", "المكتملون", "الالتزام", "ناقصهم القبلي", "ناقصهم البعدي", "ناقصهم قياس الأثر", "لم يوقّعوا"];
  const grpCompTrainerHeads = () => ["الترتيب", "المدرب", "المجموعات", "الطلاب", "المكتملون", "الالتزام", "ناقصهم القبلي", "ناقصهم البعدي", "ناقصهم قياس الأثر", "لم يوقّعوا"];
  const grpCompGroupTable = () => ((state.grp.comp && state.grp.comp.groups) || []).map((g, i) => [i + 1, g.track, g.stage, g.group, g.trainer || "—", g.n, g.complete, g.pct + "%", g.pre, g.post, g.impact, g.pledge]);
  const grpCompTrainerTable = () => ((state.grp.comp && state.grp.comp.trainers) || []).map((t, i) => [i + 1, t.name, t.groups, t.n, t.complete, t.pct + "%", t.pre, t.post, t.impact, t.pledge]);
  async function runCompliance() {
    const g = state.grp;
    if (!g.out) return ui.toast("اعرض المجموعات أولاً");
    if (state.busy) return ui.toast("هناك عملية جارية الآن؛ انتظر انتهاءها.");
    state.busy = true; state.resultError = ""; g.comp = null; state.progress = "";
    render(); refreshStatus();
    try {
      requireAgent12();
      const trackIds = trackOpts().map((o) => String(o.v)).filter((id) => !g.tracks.length || g.tracks.includes(id));
      const statusOk = ["active", "withdrawn", "graduated", "suspended"].includes(g.status) ? g.status : "all";
      /* مراحل المجموعات تُحفظ بعناوينها، ومراحل الاستبيانات بمفاتيحها */
      const cfg = { kind: "all", tracks: g.tracks, stages: STAGES.filter((x) => g.stages.includes(x.t)).map((x) => x.k), status: g.status, verify: true };
      const r = await fetchAllMissing(cfg, trackIds, statusOk);
      g.comp = Object.assign(rankCompliance(g.out.students, r.rows), { at: new Date(), note: r.note || "" });
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  function compCard() {
    const g = state.grp, comp = g.comp;
    const tbl = (k, heads, rows) => (rows.length ? dataTable(k, heads, rows) : "");
    return `<article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>الالتزام بالمتطلبات — الأقل التزاماً أولاً</h4>${comp ? `<span class="cc-badge">${ui.fmt(comp.pct)}% عموماً</span>` : ""}</div><div class="cc-res-act"><button type="button" class="btn secondary small" data-cc="grp-compliance" ${state.busy ? "disabled" : ""}>${comp ? "أعد الحساب" : "احسب الالتزام"}</button></div></header>
      ${comp ? `<div class="cc-stats"><span class="cc-stat"><b>${ui.fmt(comp.total)}</b> طالباً</span><span class="cc-stat ok"><b>${ui.fmt(comp.complete)}</b> مكتملون تماماً</span><span class="cc-stat ${comp.pct < 70 ? "bad" : "ok"}"><b>${ui.fmt(comp.pct)}%</b> الالتزام العام</span></div>
        <p class="cc-note">«مكتمل» = لا ينقصه استبيان قبلي ولا بعدي ولا قياس أثر ولا تعهد. وقد لا يكون كل نوع مطلوباً من كل مرحلة، فتُقرأ النسب إرشاداً لا حكماً.</p>
        <h5 class="cc-sub">المجموعات</h5>${tbl("grp-cg", grpCompHeads(), grpCompGroupTable())}
        <h5 class="cc-sub">المدربون</h5>${tbl("grp-ct", grpCompTrainerHeads(), grpCompTrainerTable())}`
      : '<p class="cc-note">يقرأ الاستبيانات الثلاثة والتعهدات لطلاب هذا العرض، ويحسب نسبة المكتملين لكل مجموعة ولكل مدرب، فتعرف أين تتابع. أبطأ من عرض المجموعات لأنه يقرأ أكثر. للقراءة فقط.</p>'}
    </article>`;
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
    if (state.grp.comp) { fmtSheet(wb.addWorksheet("الالتزام - المجموعات"), grpCompHeads(), grpCompGroupTable()); fmtSheet(wb.addWorksheet("الالتزام - المدربون"), grpCompTrainerHeads(), grpCompTrainerTable()); }
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
        <button type="button" class="btn secondary small" data-cc="export-grp">تنزيل Excel</button><button type="button" class="btn secondary small" data-cc="print-grp" title="يُطبع على ترويسة المركز الرسمية">طباعة / PDF على الترويسة</button><button type="button" class="btn secondary small" data-cc="word-grp">Word</button></div>
      ${waCard("groups")}
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>المجموعات</h4><span class="cc-badge">${ui.fmt(gt.length)}</span></div></header>${gt.length ? dataTable("grp-g", grpGroupHeads(), gt) : '<p class="cc-note">لا مجموعات.</p>'}</article>
      <article class="cc-res"><header class="cc-res-h"><div class="cc-res-t"><h4>حمل المدربين</h4><span class="cc-badge">${ui.fmt(tt.length)}</span></div></header>${tt.length ? dataTable("grp-t", grpTrainerHeads(), tt) : ""}</article>
      ${compCard()}
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
    if (mode === "report") { const plan = buildSelection(); return executeBatch(plan.map((x) => x.command), plan.map((x) => x.label), true, plan.map((x) => ({ params: x.command.params, label: x.label }))); }
    if (mode === "compare") return runCompare();
    if (mode === "siblings") { state.sib.stageMode = false; return runSiblings(); }
    if (mode === "missing") return runMissing();
    if (mode === "dq") return runDq();
    if (mode === "groups") return runGroups();
    if (mode === "impact") return runImpact();
    if (mode === "attend") return runAttend();
  }
  function collectSheets(mode, name) {
    if (mode === "report") return ((state.results && state.results.results) || []).map((r, i) => (r && r.type === "list" ? (() => { const [h, rr] = shown(r.heads, r.rows.map((x) => x.cells)); return { name: state.labels[i] || name, heads: h, rows: rr }; })() : null)).filter(Boolean);
    if (mode === "compare") return state.cmp.goal === "siblings" ? (state.sib.out ? [{ name, heads: sibHeads(), rows: state.sib.out.rows }] : []) : (state.cmp.out ? [{ name, heads: cmpHeads(), rows: cmpTable() }] : []);
    if (mode === "siblings") return state.sib.out ? [{ name, heads: sibHeads(), rows: state.sib.out.rows }] : [];
    if (mode === "missing") return state.mis.out ? [{ name, heads: misHeads(), rows: misTable() }] : [];
    if (mode === "dq") return state.dq.out ? [{ name, heads: dqHeads(), rows: dqTable() }] : [];
    if (mode === "attend") return attSheets(name);
    if (mode === "impact") return impFiltered().filter((t) => t.rows.length).map((t, i) => ({ name: name + " - " + (t.title || "جدول " + (i + 1)), heads: t.heads, rows: t.rows }));
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
    markWeekly();
    render();
    ui.toast("نُزّلت الحزمة: " + ui.fmt(sheets.length) + " ورقة" + (notes.length ? "، وفيها ملاحظات" : ""));
  }

  /* ===== رسالة واتساب: تُفتح جاهزة في واتساب ويرسلها المستخدم بنفسه (رابط wa.me) =====
     لا حساب ولا مفتاح ولا إرسال تلقائي: الضغط على «إرسال» في واتساب يبقى بيدك. */
  const CONTACT_KEY = "tamkeen-admin:cc-contacts", CC_KEY = "tamkeen-admin:cc-cc";
  const waScope = () => (state.mis.tracks.length ? state.mis.tracks.map(trackShort).join("، ") : "كل المسارات") + " · " + (optLabel("status", state.mis.status) || "كل الحالات");
  /* ===== صيغة التقرير الرسمي لواتساب: استبيانات وتعهدات ===== */
  const WA_ITEM = { pre: "التقييم القبلي", post: "التقييم البعدي", impact: "قياس الأثر", pledge: "التعهد" };
  const WA_SEP = "━━━━━━━━━━━━━━";
  function waMissingReport(o, contact, opts) {
    const w = state.wa, cur = contact !== undefined ? contact : state.contacts.find((c) => c.id === w.contact), L = [];
    const showNames = opts && opts.names !== undefined ? opts.names : w.names;
    const multi = o.kind === "all" || o.kind === "risk";
    const tracks = [...new Set(o.rows.map((x) => x.track).filter(Boolean))];
    const trackNames = tracks.length ? tracks : (state.mis.tracks.length ? state.mis.tracks.map(trackShort) : []);
    const stages = [...new Set(o.rows.map((x) => x.stage).filter(Boolean))];
    /* مؤنث إن كانت كل المسارات نسائية (مثل «التجميل النسائي»)؛ وإلا صيغة المذكر الجامع */
    const fem = trackNames.length > 0 && trackNames.every((t) => /نسائ/.test(t));
    const S = fem ? "الطالبات" : "الطلاب", sPl = fem ? "طالبات" : "طلاب";
    const done = fem ? "استكملن" : "استكملوا", left = fem ? "المستكملات" : "المستكملين";
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const dateStr = d.toLocaleDateString("ar", { weekday: "long" }) + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + "م";
    /* ما تبقّى وما اكتمل: للشامل من العدّادات، وللنوع الواحد هو النوع نفسه */
    const kinds = multi ? ["pre", "post", "impact", "pledge"] : [o.kind];
    const cnt = (k) => (multi ? (o.extra.counts && o.extra.counts[k]) || 0 : o.rows.length);
    const remaining = kinds.filter((k) => cnt(k) > 0), complete = multi ? kinds.filter((k) => cnt(k) === 0) : [];
    const items = (x) => (multi ? kinds.filter((k) => x.flags && x.flags[k]) : [o.kind]).map((k) => WA_ITEM[k]).join(" و");
    const joinAr = (arr) => arr.join(" و");

    L.push("السلام عليكم ورحمة الله وبركاته،");
    if (cur && cur.link) L.push("السادة أعضاء " + (/^مجموعة/.test(cur.name) ? "" : "مجموعة ") + cur.name + "،");
    else if (cur) L.push((cur.fem === true ? "الأستاذة/ " : cur.fem === false ? "الأستاذ/ " : "الأستاذ/ة ") + cur.name + (cur.role ? " – " + cur.role : "") + "،");
    L.push("📊 تقرير متابعة استكمال المتطلبات التدريبية", "📅 " + dateStr);
    if (trackNames.length) L.push("📚 المسار: " + trackNames.join("، "));
    if (stages.length) L.push("📍 المرحلة: " + stages.join("، "));
    L.push("", "أولاً: الملخص الإحصائي");
    const dg = o.diff;
    if (dg) {
      if (dg.done.length) L.push("* ✅ " + ui.fmt(dg.done.length) + " " + sPl + " " + (multi ? done + " جميع المتطلبات" : "أنجزوا".replace("وا", fem ? "ن" : "وا") + " " + WA_ITEM[o.kind]) + " منذ " + diffDate(dg.at) + ".");
      if (dg.now < dg.before) L.push("* 📉 انخفض عدد " + S + " غير " + left + " من " + ui.fmt(dg.before) + " إلى " + ui.fmt(dg.now) + ".");
      else if (dg.now > dg.before) L.push("* 📈 ارتفع عدد " + S + " غير " + left + " من " + ui.fmt(dg.before) + " إلى " + ui.fmt(dg.now) + ".");
    } else L.push("* 📌 عدد " + S + " غير " + left + ": " + ui.fmt(o.rows.length) + ".");
    if (!o.rows.length) L.push("* ✅ لا متطلبات متبقية؛ جميع " + S + " " + left.replace("غير ", "") + ".");
    else if (remaining.length === 1) L.push("* ⚠️ المتطلب المتبقي: " + WA_ITEM[remaining[0]] + " فقط.");
    else if (remaining.length > 1) L.push("* ⚠️ المتطلبات المتبقية: " + remaining.map((k) => WA_ITEM[k] + " (" + ui.fmt(cnt(k)) + ")").join("، ") + ".");
    if (complete.length) L.push("* ✅ " + joinAr(complete.map((k) => WA_ITEM[k])) + ": مكتملة لدى الجميع.");
    if (w.breakdown && o.per && Object.keys(o.per).length > 1) Object.entries(o.per).forEach(([k, n]) => L.push("* " + k + ": " + ui.fmt(n)));

    if (showNames && o.rows.length) {
      L.push("", "ثانياً: قائمة " + S + " المطلوب متابعت" + (fem ? "هن" : "هم"), WA_SEP);
      /* كل مسار (ومرحلة إن تعدّدت المراحل) له عنوان قبل طلابه، وترقيم الطلاب يبدأ من 1 في كل مسار */
      const multiStage = stages.length > 1, groups = new Map();
      o.rows.forEach((x) => { const k = (x.track || "—") + (multiStage && x.stage ? " · " + x.stage : ""); (groups.get(k) || groups.set(k, []).get(k)).push(x); });
      [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar")).forEach(([k, list]) => {
        L.push("📚 المسار: " + k + " (" + ui.fmt(list.length) + ")", WA_SEP);
        list.forEach((x, i) => {
          L.push((i + 1) + ". " + x.name);
          if (x.group) L.push("المجموعة: " + x.group);
          const it = items(x); if (it) L.push("المطلوب: " + it + ".");
          L.push("", WA_SEP);
        });
      });
    }
    if (o.rows.length) {
      const need = remaining.length ? joinAr(remaining.map((k) => WA_ITEM[k])) : "المتطلبات";
      L.push("الإجراء المطلوب:", "يرجى متابعة " + S + " المذكور" + (fem ? "ات" : "ين") + " واستكمال " + need + "، لإغلاق جميع المتطلبات التدريبية.");
    }
    L.push("مع خالص الشكر والتقدير لجهودكم وتعاونكم.");
    return L.join("\n");
  }
  function waBuild(mode) {
    const w = state.wa, today = ui.formatDate(ui.todayISO()) || ui.todayISO(), L = [];
    const NAMES_MAX = 100000;                          // كل الأسماء الظاهرة في التقرير؛ الرسالة الطويلة تُقسَّم إلى أجزاء
    if (mode === "missing") {
      const o = state.mis.out; if (!o) return "";
      return waMissingReport(o);
    } else if (mode === "dq") {
      const o = state.dq.out; if (!o) return "";
      L.push("🔎 فحص جودة البيانات — " + today, "الفحص: " + ui.fmt(o.total) + " طالباً · الملاحظات: " + ui.fmt(o.issues.length));
      if (w.breakdown) DQ_CHECKS.filter(([k]) => o.byType[k]).forEach(([k, t]) => L.push("• " + t + ": " + ui.fmt(o.byType[k])));
      if (w.names) { L.push("", "الملاحظات (" + o.issues.length + "):"); o.issues.slice(0, NAMES_MAX).forEach((x) => L.push("- " + x.s.name + (x.s.group ? " — مجموعة " + x.s.group : "") + ": " + DQ_LABEL[x.type])); }
    } else if (mode === "groups") {
      const o = state.grp.out; if (!o) return "";
      L.push("👥 المجموعات والمدربون — " + today, ui.fmt(o.total) + " طالباً في " + ui.fmt(o.groups.length) + " مجموعة · غير موزعين: " + ui.fmt(o.unassigned));
      if (w.breakdown) { [...o.unBy.entries()].forEach(([k, n]) => L.push("• غير موزعين " + k.replace("|", " · ").replace(/ · $/, "") + ": " + ui.fmt(n))); o.groups.filter((g) => g.note).forEach((g) => L.push("• " + g.track + " · " + g.group + ": " + ui.fmt(g.n) + " (" + g.note + ")")); }
    } else if (mode === "siblings") {
      const o = state.sib.out; if (!o) return "";
      L.push("👨‍👩‍👧 مقارنة الإخوة — " + today, ui.fmt(o.families) + " عائلة، " + ui.fmt(o.siblings) + " طالباً من " + ui.fmt(o.total));
      if (o.stageStats) L.push(o.stageStats.lastLabel + " مقابل " + o.stageStats.cmpLabel + ": " + ui.fmt(o.stageStats.last) + " طالباً لهم إخوة");
    } else if (mode === "compare") {
      const o = state.cmp.out; if (!o) return "";
      L.push("📊 مقارنة المراحل — " + today, ui.fmt(o.total) + " طالباً، منهم " + ui.fmt(o.list.filter((p) => p.stages.length > 1).length) + " سجّلوا في أكثر من مرحلة");
      if (w.breakdown) o.perStage.forEach((g) => L.push("• " + g.t + ": " + ui.fmt(g.n)));
    }
    return L.join("\n");
  }
  /* رابط wa.me محدود الطول، فتُقسَّم الرسالة الطويلة عند حدود الأسطر إلى أجزاء مرقمة */
  const WA_PART_MAX = Infinity;                       // لا تجزئة: الرسالة كاملة تُنسخ وتُلصق (حد واتساب نحو 65 ألف حرف)
  const WA_MODE_KEY = "tamkeen-admin:wa-mode";
  const waMode = () => (lsGet(WA_MODE_KEY, "paste") === "link" ? "link" : "paste");
  const waParts = (text) => waPartsOf(text, WA_PART_MAX);
  const waText = (mode) => { const w = state.wa; if (!w.dirty[mode]) w.texts[mode] = waBuild(mode); return w.texts[mode] || ""; };
  function waCard(mode) {
    const w = state.wa, text = waText(mode);
    if (!text) return "";
    const cur = state.contacts.find((c) => c.id === w.contact);
    const hasNames = mode === "missing" || mode === "dq";
    return `<details class="cc-adv" data-open="wa" ${state.open.wa ? "open" : ""}>
      <summary><span>إرسال عبر واتساب</span><small>يفتح واتساب برسالة جاهزة وترسلها أنت</small></summary>
      <div class="cc-two">
        <label class="cc-field"><span>المستلم (جهة اتصال محفوظة)</span><select data-wa="contact"><option value="">— اختر، أو اكتب رقماً —</option>${state.contacts.map((c) => `<option value="${esc(c.id)}" ${c.id === w.contact ? "selected" : ""}>${esc(c.name)}${c.link ? " (مجموعة)" : c.role ? " — " + esc(c.role) : ""}</option>`).join("")}</select></label>
        <label class="cc-field"><span>أو رقم آخر</span><input type="tel" inputmode="tel" data-wa="phone" value="${esc(w.phone)}" placeholder="059xxxxxxx" ${cur ? "disabled" : ""}></label>
      </div>
      <div class="cc-chips"><label class="cc-chk"><input type="checkbox" data-wa="breakdown" ${w.breakdown ? "checked" : ""}> <span>أرقام لكل مسار / تفصيل</span></label>${`<label class="cc-chk"><input type="checkbox" data-wa="linkmode" ${waMode() === "link" ? "checked" : ""}> <span>إدراج النص في الرابط (للقصير فقط؛ الافتراضي نسخ الرسالة كاملة ولصقها)</span></label>`}${hasNames ? `<label class="cc-chk"><input type="checkbox" data-wa="names" ${w.names ? "checked" : ""}> <span>أسماء الطلاب (كلهم) — بيانات شخصية</span></label>` : ""}</div>
      ${waParts(w.texts[mode] || text).length > 1 ? `<p class="cc-note">الرسالة طويلة فقُسّمت إلى ${waParts(w.texts[mode] || text).length} أجزاء (حد رابط واتساب). اضغط الزر مرة بعد مرة: يفتح كل جزء بالترتيب، وأرسله في واتساب ثم ارجع واضغط للجزء التالي.</p>` : ""}<label class="cc-field"><span>نص الرسالة (يمكنك تعديله قبل الفتح)</span><textarea rows="8" data-wa-text="${mode}">${esc(text)}</textarea></label>
      ${w.names && hasNames ? '<p class="cc-alert warn">النص يتضمن أسماء طلاب. واتساب يمرّر الرسالة عبر خوادمه؛ أرسلها فقط لمن له صلاحية الاطّلاع على هذه البيانات.</p>' : ""}
      <div class="cc-row"><button type="button" class="btn navy small" data-cc="wa-open" data-mode="${mode}">${(() => { const n = waParts(w.texts[mode] || text).length, i = Math.min(w.part[mode] || 0, n - 1); return n > 1 ? "افتح الجزء " + (i + 1) + " من " + n : "افتح واتساب بالرسالة"; })()}</button><button type="button" class="cc-link" data-cc="wa-copy" data-mode="${mode}">نسخ النص</button><button type="button" class="cc-link" data-cc="wa-regen" data-mode="${mode}">إعادة توليد النص</button><button type="button" class="cc-link" data-cc="wa-addc">＋ جهة اتصال</button><button type="button" class="cc-link" data-cc="wa-addg">＋ مجموعة</button>${cur ? '<button type="button" class="cc-link danger" data-cc="wa-delc">حذف هذه الجهة</button>' : ""}</div>
      <p class="cc-note">لا يُرسَل شيء تلقائياً: يفتح واتساب (ويب أو تطبيق) والرسالة جاهزة، وتضغط أنت «إرسال». الأرقام دولية تلقائياً بإضافة ${esc(w.cc)} إن بدأ الرقم بصفر. جهات الاتصال تُحفظ في هذا المتصفح فقط.</p>
    </details>`;
  }
  function waOpen(mode) {
    const w = state.wa, text = (w.texts[mode] || waText(mode)).trim();
    if (!text) return ui.toast("لا نص لإرساله");
    const cur = state.contacts.find((c) => c.id === w.contact);
    const isGroup = !!(cur && cur.link);
    const num = isGroup ? "" : waIntl(cur ? cur.phone : w.phone, (cur && cur.cc) || w.cc);
    if (!num && !isGroup && (cur || w.phone)) return ui.toast("رقم غير صالح");
    if (w.names && !confirm("الرسالة تتضمن أسماء طلاب. هل تريد فتح واتساب بها؟")) return;
    const ps = waParts(text), idx = Math.min(w.part[mode] || 0, ps.length - 1);
    if (App.whatsapp && App.whatsapp.log) App.whatsapp.log({ to: cur ? cur.name : w.phone, page: "أوامر المركز — " + mode, part: ps.length > 1 ? (idx + 1) + "/" + ps.length : "", chars: ps[idx].length });
    if (isGroup) {
      /* رابط دعوة المجموعة لا يقبل نصاً جاهزاً: ننسخ الرسالة ونفتح المجموعة لتلصقها */
      (navigator.clipboard ? navigator.clipboard.writeText(ps[idx]) : Promise.reject()).then(
        () => ui.toast("نُسخت الرسالة. الصقها في المجموعة (Ctrl+V) ثم أرسلها"),
        () => ui.toast("تعذّر النسخ تلقائياً؛ استعمل زر «نسخ النص» ثم الصق في المجموعة"));
      window.open(cur.link, "_blank", "noopener");
    } else if (waMode() === "link") {
      const url = "https://wa.me/" + num + "?text=" + encodeURIComponent(ps[idx]);
      if (url.length > 1900) ui.toast("الرسالة طويلة؛ قد يقطعها واتساب. ألغِ «إدراج النص في الرابط» لتُنسخ كاملة.");
      window.open(url, "_blank", "noopener");
    } else {
      /* الافتراضي: ننسخ الرسالة كاملة ونفتح المحادثة فقط. اللصق يحفظ الرموز ولا يحدّ بطول الرابط */
      (navigator.clipboard ? navigator.clipboard.writeText(ps[idx]) : Promise.reject()).then(
        () => ui.toast("نُسخت الرسالة كاملة. الصقها في المحادثة (Ctrl+V) ثم أرسل"),
        () => ui.toast("تعذّر النسخ تلقائياً؛ استعمل زر «نسخ النص» ثم الصق في المحادثة"));
      window.open(num ? "https://wa.me/" + num : "https://web.whatsapp.com/", "_blank", "noopener");
    }
    if (ps.length > 1) {
      w.part[mode] = idx + 1 >= ps.length ? 0 : idx + 1;
      ui.toast(idx + 1 >= ps.length ? "فُتح الجزء الأخير (" + ps.length + " من " + ps.length + ")" : "فُتح الجزء " + (idx + 1) + " من " + ps.length + ". أرسله ثم ارجع واضغط للجزء التالي");
      state.open.wa = true; render();
    }
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
    noteMode(state.mode);
    if (mode === "sign") sigSaveSoon();
    const info = statusInfo();
    const viaExt = App.centerAgent && App.centerAgent.isReady();
    if (state.busy && !state._wasBusy) { state._runStart = Date.now(); state._runMode = mode; state.stopping = false; runStats = { sent: 0, cached: 0 }; }
    if (!state.busy && state._wasBusy) { state.forceFresh = false; const ms = Date.now() - state._runStart; logRun(state._runMode, ms); notifyDone(state._runMode, ms); }
    state._wasBusy = !!state.busy;
    if (state.busy && !state.progStart) { state.progStart = Date.now(); Object.keys(tblState).forEach((k) => delete tblState[k]); }
    if (!state.busy) state.progStart = 0;
    box.innerHTML = `<div class="cc-app">
      <div class="cc-top" data-st="${info.st}"><span class="cc-dot" aria-hidden="true"></span><span id="cc-status" role="status">${esc(info.text)}</span><button type="button" class="cc-link cc-mask-btn" data-cc="toggle-mask" aria-pressed="${state.mask}" title="يخص العرض والنسخ، لا ملفات Excel">${state.mask ? "👁 إظهار الأرقام" : "🙈 إخفاء الهوية والجوال"}</button></div>
      ${updateBanner()}
      ${state.busy ? busyBanner() : ""}
      ${weeklyBanner()}
      ${wideBanner()}
      ${newsCard()}
      ${quickBar()}
      ${modesNav(mode)}
      ${savedBar(mode)}
      ${mode === "write" ? "" : groupBar()}
      ${mode === "write" ? writeView() : mode === "report" ? scriptsView() : mode === "compare" ? compareView() : mode === "siblings" ? siblingsView() : mode === "missing" ? missingView() : mode === "attend" ? attView() : mode === "sign" ? sigView() : mode === "xl" ? xlView() : mode === "morning" ? morningView() : mode === "grad" ? gradView() : mode === "pledge" ? pledgeView() : mode === "monthly" ? monthlyView() : mode === "gaps" ? gapsView() : mode === "img" ? imgView() : mode === "impact" ? impView() : mode === "dq" ? dqView() : mode === "groups" ? grpView() : mode === "student" ? stuView() : assistantView() + (state.adding === "register" ? registerBuilder() : "")}
      ${state.resultError ? `<p class="cc-alert err" role="alert">${esc(state.resultError)}</p>` : ""}
      ${freshBar()}
      ${planView()}
      ${mode === "write" ? writeResult() : mode === "compare" ? compareResult() : mode === "siblings" ? siblingsResult() : mode === "missing" ? missingResult() : mode === "attend" ? attResult() : mode === "sign" ? sigResult() : mode === "xl" ? xlResult() : mode === "morning" ? morningResult() : mode === "grad" ? gradResult() : mode === "monthly" ? monthlyResult() : mode === "gaps" ? gapsResult() : mode === "img" ? imgResult() : mode === "impact" ? impResult() : mode === "dq" ? dqResult() : mode === "groups" ? grpResult() : mode === "student" ? stuResult() : state.results ? `<section class="cc-results"><h3 class="cc-results-title"><span class="cv-step-tag">٢</span> النتيجة</h3>${resultsView()}</section>` : ""}
      ${logCard()}
      ${settingsCard()}
      <details class="cc-help"><summary>كيف تعمل الأوامر؟</summary><p>${viaExt
        ? "تعمل الأوامر في متصفحك عبر إضافة «وكيل تمكين». سجّل دخولك في نظام المركز مرة واحدة؛ والبحث والقوائم تُنفَّذ مباشرة، أما التسجيل فتراجع معاينته هنا وتوافق قبل أن يُكتب شيء. لا تصل كلمة مرورك أو جلستك إلى تمكين."
        : "تعمل الجلسة في نافذة Edge المحلية. سجّل الدخول فيها مرة واحدة؛ بعدها ينفّذ الوكيل البحث والقوائم والتسجيل ويعرض النتيجة هنا. أو ثبّت إضافة «وكيل تمكين» في Chrome لتعمل دون خادم محلي."}</p></details>
    </div>`;
    hideScopeDupes(box);
    snapMaybeSave();
  }

  /* ===== التنزيل ===== */
  async function exportBook(name, heads, rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("النتائج");
    fmtSheet(ws, heads, rows);
    ui.download(name, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  async function refreshStatus() {
    if (App.centerAgent && App.centerAgent.isReady()) {
      // إضافة المتصفح موصولة: لا حاجة للخادم المحلي
      state.agentStatus = { ready: true, loggedIn: true, message: "إضافة «وكيل تمكين» متصلة ✓ — لا يُقرأ شيء من نظام المركز إلا بضغطتك على زر التنفيذ؛ وعندها يفتح في متصفحك (سجّل دخولك فيه إن طُلب)." };
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

  /* ===== عدّاد أوامر القراءة لكل تشغيل: ما أُرسل إلى نظام المركز وما خُدم من ذاكرة الصفحة =====
     «أمر» = قراءة قائمة أو تقرير واحد؛ وقد يقرأ الأمر الواحد عدة صفحات من النظام. */
  /* ===== تصفية بالمجموعة تُطبَّق على كل التقارير (محلياً على عمود «المجموعة») ===== */
  const grpCode = (cell) => App.ccUtil.splitGroupCell(cell)[0];
  function grpRows(heads, rows) {
    if (!(state.groups || []).length) return rows;
    const i = (heads || []).findIndex((h) => /^المجموعة/.test(clean(h)));
    if (i < 0) return rows;
    const S = new Set(state.groups);
    return rows.filter((x) => S.has(grpCode(x.cells[i])));
  }
  const gfResult = (r) => (r && r.type === "list" && Array.isArray(r.rows) && (state.groups || []).length ? Object.assign({}, r, { rows: grpRows(r.heads, r.rows) }) : r);
  const GRPLIST_KEY = "tamkeen_cc_group_list";
  function groupOptions() {
    const stored = lsGet(GRPLIST_KEY, []);
    const set = new Set(Array.isArray(stored) ? stored : []);
    if (state.cache) state.cache.items.forEach((it) => { const i = it.heads.findIndex((h) => /^المجموعة/.test(clean(h))); if (i >= 0) it.rows.forEach((x) => { const g = grpCode(x.cells[i]); if (g) set.add(g); }); });
    ((state.imp.known || []).find((f) => /group/i.test(f.name || "") || /مجموعة/.test(f.label || "")) || { options: [] }).options.forEach((o) => { if (o.v !== "" && o.t) set.add(grpCode(o.t)); });
    (state.groups || []).forEach((g) => set.add(g));
    if (set.size !== (Array.isArray(stored) ? stored.length : 0)) lsSet(GRPLIST_KEY, [...set].filter(Boolean));   // تُحفظ القائمة فتظهر في كل زيارة
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "ar", { numeric: true }));
  }
  async function loadGroups() {
    state.busy = true; state.resultError = ""; render(); refreshStatus();
    try {
      requireAgent15();
      const r = (await runCommands([{ type: "page", source: "impact", label: "قائمة المجموعات", params: { date_from: state.imp.from || "", date_to: state.imp.to || ui.todayISO() } }], { noGroup: true }))[0];
      if (!r || r.type !== "page") throw new Error((r && r.error) || "لم تصل الصفحة من الوكيل.");
      state.imp.known = r.filters || state.imp.known;
      const f = (r.filters || []).find((x) => x.type === "select" && (/group/i.test(x.name || "") || /مجموعة/.test(x.label || "")));
      if (!f) throw new Error("لا توجد قائمة مجموعات في صفحة النظام.");
      const names = f.options.filter((o) => o.v !== "" && o.t).map((o) => grpCode(o.t));
      lsSet(GRPLIST_KEY, [...new Set(names)].filter(Boolean));
      ui.toast("حُفظت " + ui.fmt(new Set(names).size) + " مجموعة.");
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; render(); refreshStatus(); }
  }
  /* شريط التبويبات الأفقي: عناوين قصيرة في صف واحد مجمّعة، والشرح في التلميح */
  const MODE_GROUPS = [
    [["report", "تقرير جاهز", "اختر المسار والمرحلة ثم نفّذ"], ["monthly", "تقرير الشهر", "حضور وتقييمات وتوقيعات لكل مسار في مستند واحد"], ["sign", "مطابقة التوقيعات", "من لم يوقّع في صور الأوراق"], ["xl", "مقارنة ملف Excel", "قارن كشفاً خارجياً بالمسجلين"], ["morning", "تقرير الصباح", "حضور اليوم والناقصون في صفحة واحدة"], ["grad", "جاهزية التخرج", "من يستوفي شروط الحضور والتقييمات"], ["img", "صورة إلى جدول", "حوّل صورة كشف أو درجات إلى Excel"], ["pledge", "كشف تعهد الحقيبة", "كشف توقيع على الترويسة بترقيم الأوراق"], ["attend", "الحضور والغياب", "غياب كل طالب وتنبيه عند تجاوز الحد"], ["impact", "قياس الأثر", "إحصاءات الاستبيان بتصفية المسار والمرحلة"], ["missing", "استبيانات وتعهدات", "من لم يعبّئ أو يوقّع"]],
    [["compare", "مقارنة المراحل", "من سجّل في أكثر من مرحلة"], ["siblings", "مقارنة الإخوة", "طلاب يجمعهم هاتف أو عائلة"], ["dq", "فحص البيانات", "أخطاء الجودة وتغيّر القوائم"], ["gaps", "بيانات ناقصة", "حقول فارغة في سجل الطالب بالنظام"], ["groups", "المجموعات والمدربون", "التوازن وحمل المدربين والتوزيع"]],
    [["student", "ملف الطالب", "كل شيء عن طالب واحد"], ["ask", "اكتب طلبك", "بحث، أو تسجيل طلاب من Excel"]],
    [["write", "تنفيذ في النظام", "تغيير الحالات والنقل وتعديل البيانات"]],
  ];
  /* شرح كل تبويب: يظهر في فقاعة عند مرور المؤشر (src/tips.js) */
  const MODE_TIPS = {
    "gaps": "يقرأ صفحة تعديل كل طالب ويعدّ الحقول الفارغة في نظام المركز نفسه (الحالة الاجتماعية، تاريخ الميلاد، العنوان، المحافظة، التعليم…)، ثم يعرض من ينقصه شيء لتكمل بياناته هناك. تنزّل النتيجة Excel أو تنسخ ملخصها.",
  "monthly": "مستند شهري واحد على الترويسة لكل مسار: الحضور والغياب والمنذَرون، ومن لم يكمل الاستبيانات والتعهد، ومن لم يوقّع (من جلسة التوقيعات). تطبعه أو تنزّله Word أو Excel.",
  "report": "تقارير جاهزة من قوائم الطلاب: اختر المسار والمرحلة (والمجموعة وحالة الطالب) ثم نفّذ، فيُجلب الجدول من نظام المركز لتراجعه وتنزّله Excel أو تطبعه.",
    "sign": "ارفع صور أوراق التوقيع فيقرؤها الذكاء الاصطناعي (الأسماء والهوية والجوال ووجود التوقيع) وتُقارَن بالمسجلين: من لم يوقّع، وما ينقص كل طالب من نماذج، مع رسالة واتساب بالنواقص لكل مسار. الصور لا تُحفظ، وجلسة العمل تُحفظ على جهازك.",
    "xl": "ارفع كشفاً من جهة أخرى (Excel) وقارنه بمسجلي المرحلة: من ينقص النظام، ومن ليس في الكشف، ومن اختلفت بياناته. المطابقة بالهوية ثم الجوال ثم الاسم.",
    "morning": "بضغطة واحدة: غائبو اليوم بحسب المجموعة، والناقصون في تقييماتهم، في ملخص واحد مع نص واتساب جاهز.",
    "grad": "يقرأ حضور فترة (وتقييمات الطلاب اختيارياً) ويحكم من يستوفي شروطك (أقصى غياب، أدنى نسبة حضور، إكمال الاستبيانات) مع سبب عدم الاستيفاء لكل طالب.",
    "write": "أوامر تُكتب في نظام المركز من هنا: حالة الطالب (منسحب، موقوف…)، النقل بين المجموعات، قبول الطلبات أو رفضها، وتعديل بيانات الطلاب من Excel. معاينة أولاً ولا يُكتب شيء قبل موافقتك، مع سجل وتراجع.",
    "img": "حوّل صورة كشف أو درجات أو هويات إلى جدول بالذكاء الاصطناعي، تنزّله Excel أو ترسله مباشرة إلى «مقارنة ملف Excel».",
    "pledge": "كشف توقيع على الترويسة: ديباجة التعهد وجدول (م، الاسم، الهوية، المرحلة، التوقيع)، ورقة لكل مسار بترقيم (5-1)، مع نسخة للمذيع بالأسماء والمراحل. طباعة أو Word.",
    "attend": "يقرأ جلسات التدريب في فترة تختارها ويجمع غياب كل طالب وأطول غياب متتالٍ، وينبّه عند تجاوز الحد، مع غائبي آخر يوم بحسب المجموعة ونص واتساب.",
    "impact": "إحصاءات استبيان قياس الأثر بتصفية المسار والمرحلة (والمجموعة) التي تختارها.",
    "missing": "يستخرج الطلاب الذين لم يعبّئوا الاستبيانات (القبلي والبعدي وقياس الأثر) أو لم يوقّعوا التعهد، مع مقارنة بما سبق وملف تذكير جاهز.",
    "compare": "يبيّن من سجّل في أكثر من مرحلة، ويقارن أعداد المراحل لكل مسار.",
    "siblings": "يجمع الطلاب الذين يشتركون في رقم هاتف أو في العائلة لتتبّع الإخوة.",
    "dq": "يفحص جودة البيانات: هويات مكررة أو خاطئة، جوال ناقص، طالب بلا مجموعة أو في أكثر من مجموعة، أسماء قصيرة أو مكررة. ويقارن بلقطة سابقة ليُظهر ما تغيّر.",
    "groups": "يعرض توازن المجموعات وحمل المدربين، ويقترح توزيعاً للطلاب غير الموزعين، ويحسب التزام كل مجموعة ومدرب.",
    "student": "ابحث عن طالب واحد (باسمه أو هويته أو جواله) فترى كل بياناته: الاستبيانات والتعهد والإرسالات والإخوة وجودة بياناته.",
    "ask": "اكتب طلبك بجملة عادية (مثلاً: «دورلي على أحمد» أو «هاتلي المتخرجين بمسار التسويق»)، أو سجّل طلاباً من ملف Excel."
  };
  const MODE_ICO = { gaps: "🕳️", monthly: "🗂️", pledge: "🎒", img: "📷", grad: "🎓", morning: "🌅", xl: "📑", sign: "🖊️", attend: "🗓️", report: "📋", impact: "📈", missing: "✅", compare: "⚖️", siblings: "👪", dq: "🔍", groups: "👥", student: "🧑", ask: "✍️" };
  /* ===== متى جُلبت البيانات؟ وتحديث الأداة الحالية فقط (بقراءة جديدة لا من الذاكرة) ===== */
  const FRESH_AT = {
    report: () => state.results && state.results.at, attend: () => state.att.out && state.att.out.at, morning: () => state.att.out && state.att.out.at,
    missing: () => state.mis.out && state.mis.out.at, compare: () => state.cmp.out && state.cmp.out.at, siblings: () => state.sib.out && state.sib.out.at,
    dq: () => state.dq.out && state.dq.out.at, gaps: () => state.gaps.out && state.gaps.out.at, groups: () => state.grp.out && state.grp.out.at, impact: () => state.imp.out && state.imp.out.at,
    grad: () => state.grad.out && state.grad.out.at, xl: () => state.xl.out && state.xl.out.at, sign: () => state.sig.reg && state.sig.regAt,
  };
  function agoText(d) {
    const ms = Date.now() - new Date(d).getTime(); if (isNaN(ms)) return "";
    const m = Math.round(ms / 60000);
    if (m < 1) return "الآن"; if (m < 60) return "قبل " + ui.fmt(m) + " دقيقة";
    const h = Math.round(m / 60); if (h < 24) return "قبل " + ui.fmt(h) + " ساعة";
    return "قبل " + ui.fmt(Math.round(h / 24)) + " يوماً";
  }
  function freshBar() {
    const hid = snapHiddenFor(state.mode);
    if (hid && RUN_BTN[state.mode]) return `<div class="cc-fresh" role="status"><span>💾 لهذه الأداة نتيجة محفوظة على هذا الجهاز من <b>${esc(agoText(hid))}</b> (أُخفيت من الشاشة)</span><button type="button" class="cc-link" data-cc="snap-restore">أظهرها</button></div>`;
    const f = FRESH_AT[state.mode], at = f && f(); if (!at || !RUN_BTN[state.mode]) return "";
    const stale = Date.now() - new Date(at).getTime() > 60 * 60000;
    return `<div class="cc-fresh${stale ? " stale" : ""}" role="status"><span>🕒 جُلبت البيانات <b>${esc(agoText(at))}</b>${stale ? " — قد تكون قديمة" : ""} · 💾 محفوظة على هذا الجهاز، ولا جلب جديد إلا بطلبك</span><button type="button" class="cc-link" data-cc="refresh-mode" ${state.busy ? "disabled" : ""} title="يعيد قراءة هذه الأداة وحدها من نظام المركز بقراءة جديدة">↻ حدّث هذه الأداة فقط</button></div>`;
  }
  /* ===== البحث الشامل (Ctrl+K): أدوات المركز، وطلاب الذاكرة المحمّلة ===== */
  function openMode(k) {
    if (!MODE_FLAT[k]) return;
    state.mode = k; state.adding = ""; state.proposal = null; state.autoRunRegister = false; state.reg = null; state.resultError = "";
    render();
  }
  function centerSearchIndex() {
    if (!centerAllowed()) return [];
    const out = MODE_SECTIONS.flatMap(([grp, keys]) => keys.filter((k) => MODE_FLAT[k]).map((k) => ({
      group: "أدوات المركز", view: "center", icon: MODE_ICO[k] || "🧰", title: MODE_FLAT[k][1], sub: grp + " — " + MODE_FLAT[k][2],
      text: [MODE_FLAT[k][1], MODE_FLAT[k][2], MODE_TIPS[k] || "", grp].join(" "), open: () => openMode(k),
    })));
    // طلاب الذاكرة المحمّلة فقط (لا قراءة جديدة): الاسم والهوية والجوال للبحث، ويُعرض المسار والمجموعة
    if (state.cache) {
      const seen = new Set();
      state.cache.items.forEach((it) => {
        const at = (rx) => it.heads.findIndex((h) => rx.test(clean(h)));
        const iN = at(/^الاسم$/), iS = at(/^الطالب$/), iI = at(/^رقم الهوية$/), iP = at(/^الجوال$/), iG = at(/^المجموعة/), iT = at(/^المسار$/);
        it.rows.forEach((x) => {
          const sp = iN < 0 && iS >= 0 ? splitStudentCell(x.cells[iS]) : null;
          const name = clean(iN >= 0 ? x.cells[iN] : sp ? sp[0] : ""); if (!name) return;
          const id = digits(iI >= 0 ? x.cells[iI] : sp ? sp[3] : ""), phone = iP >= 0 ? digits(x.cells[iP]) : sp ? digits(sp[4]) : "";
          const key = id || name; if (seen.has(key) || seen.size > 4000) return; seen.add(key);
          out.push({ group: "طلاب (الذاكرة المحمّلة)", view: "center", icon: "🧑", title: name, sub: [iT >= 0 ? clean(x.cells[iT]) : "", iG >= 0 ? (grpCode(x.cells[iG]) || "") : ""].filter(Boolean).join(" · ") || "اضغط لفتح «ملف الطالب»",
            text: [name, id, phone].join(" "), open: () => { state.stu.q = name; openMode("student"); } });
        });
      });
    }
    return out;
  }
  /* ===== الأكثر استعمالاً: أدواتك المفضلة (نجمة) وآخر ما فتحتَه، لتصل إليها بنقرة ===== */
  const RECENT_KEY = "tamkeen:cc-recent", FAV_KEY = "tamkeen:cc-fav";
  function noteMode(m) {
    if (!m || !MODE_FLAT[m] || state._noted === m) return;
    state._noted = m;
    lsSet(RECENT_KEY, [m, ...lsGet(RECENT_KEY, []).filter((x) => x !== m)].slice(0, 8));
  }
  function quickBar() {
    const cur = state.mode, fav = lsGet(FAV_KEY, []).filter((k) => MODE_FLAT[k]);
    const rec = lsGet(RECENT_KEY, []).filter((k) => k !== cur && !fav.includes(k) && MODE_FLAT[k]).slice(0, 3);
    const chip = (k, isFav) => `<button type="button" class="cc-chip${isFav ? " fav" : ""}" data-cc="mode" data-m="${k}" data-tip-t="${esc(MODE_FLAT[k][1])}" data-tip="${esc(MODE_TIPS[k] || MODE_FLAT[k][2])}">${isFav ? "★ " : ""}${esc(MODE_FLAT[k][1])}</button>`;
    const items = fav.filter((k) => k !== cur).map((k) => chip(k, true)).join("") + rec.map((k) => chip(k, false)).join("");
    const isFav = fav.includes(cur);
    return `<div class="cc-quick"><span class="cc-q-t">الأكثر استعمالاً</span>${items || '<span class="cc-note">تظهر هنا آخر أدواتك ومفضلتك.</span>'}<button type="button" class="cc-link cc-fav" data-cc="fav-toggle" data-m="${esc(cur)}" aria-pressed="${isFav}">${isFav ? "★ في المفضلة (إزالة)" : "☆ ثبّت هذه الأداة في المفضلة"}</button></div>`;
  }
  /* الأدوات مجمّعة بحسب المهمة (بدل صف واحد من 16 تبويباً): لكل مجموعة عنوان، وتحتها أدواتها */
  const MODE_SECTIONS = [
    ["الطلاب والتقارير", ["report", "monthly", "student", "ask", "groups"]],
    ["المتابعة اليومية", ["morning", "attend", "missing", "impact", "grad"]],
    ["التوقيعات والكشوف", ["sign", "pledge", "img", "xl"]],
    ["فحص وجودة", ["dq", "gaps", "compare", "siblings"]],
    ["تنفيذ في النظام", ["write"]],
  ];
  const MODE_FLAT = Object.fromEntries(MODE_GROUPS.flat().map(([k, t, h]) => [k, [k, t, h]]));
  const modeBtn = (mode, [k, t, h]) => `<button type="button" role="tab" class="${mode === k ? "on" : ""}" aria-selected="${mode === k}" data-cc="mode" data-m="${k}" data-tip-t="${esc(t)}" data-tip="${esc(MODE_TIPS[k] || h)}"><span class="cc-ico" aria-hidden="true">${MODE_ICO[k] || ""}</span><b>${esc(t)}</b></button>`;
  const modesNav = (mode) => `<nav class="cc-modes" role="tablist" aria-label="نوع الأمر">${MODE_SECTIONS.map(([title, keys]) => `<div class="cc-mgroup" role="presentation"><span class="cc-mg-t" aria-hidden="true">${esc(title)}</span><div class="cc-mg-b" role="presentation">${keys.filter((k) => MODE_FLAT[k]).map((k) => modeBtn(mode, MODE_FLAT[k])).join("")}</div></div>`).join("")}</nav>`;
  /* ===== النطاق الموحّد: المسارات والمراحل والمجموعات في شريط واحد يسري على كل التبويبات ===== */
  const stageK = (t) => (STAGES.find((g) => g.t === t) || {}).k;
  const scopeCfg = (mode) => ({ report: state.sel, missing: state.mis, compare: state.cmp, siblings: state.sib, dq: state.dq, groups: state.grp, impact: state.imp, attend: state.att, sign: state.sig, xl: state.xl, morning: state.att, grad: state.att, pledge: state.pledge, monthly: state.monthly, gaps: state.gaps }[mode] || state.sel);
  function scopeNow() {
    const c = scopeCfg(state.adding || state.proposal ? "ask" : state.mode);
    const byK = c === state.sel || c === state.mis;
    const stages = (c.stages || []).map((x) => (byK ? (STAGES.find((g) => g.k === x) || {}).t : x)).filter(Boolean);
    return { tracks: (c.tracks || []).map(String), stages, hasStages: "stages" in c };
  }
  /* ===== النطاق التعاقبي: المرحلة تحدّد المسارات والمجموعات المرتبطة بها فقط ===== */
  function trackStageMap() {   // رقم المسار ← مراحله (عناوين) من دورات النظام
    const m = new Map();
    courseOpts().forEach((c) => { const st = (STAGES.find((g) => g.k === c.stage) || {}).t; if (!c.track || !st) return; (m.get(c.track) || m.set(c.track, new Set()).get(c.track)).add(st); });
    return m;
  }
  function groupLinks() {      // رمز المجموعة ← { مراحل، مسارات } من الذاكرة المحمّلة إن وُجدت
    const m = new Map(), ensure = (g) => m.get(g) || m.set(g, { stages: new Set(), tracks: new Set() }).get(g);
    if (state.cache) state.cache.items.forEach((it) => {
      const iG = it.heads.findIndex((h) => /^المجموعة/.test(clean(h))), iC = it.heads.findIndex((h) => /(دورة|الدورة|مساق)/.test(clean(h)));
      if (iG < 0) return;
      it.rows.forEach((x) => { const g = grpCode(x.cells[iG]); if (!g) return; const e = ensure(g); if (it.trackId != null) e.tracks.add(String(it.trackId)); const st = iC >= 0 ? stageOf(x.cells[iC]) : ""; if (st) e.stages.add(st); });
    });
    return m;
  }
  /* ما يُعرض في الشريط بعد تطبيق المرحلة (والمسار للمجموعات). ما لا يُعرف ارتباطه يبقى ظاهراً */
  function scopeAvail() {
    const sc = scopeNow(), tsm = trackStageMap(), gl = groupLinks();
    const tracks = trackOpts().filter((o) => { if (!sc.stages.length || !tsm.size) return true; const st = tsm.get(String(o.v)); return !!st && [...st].some((x) => sc.stages.includes(x)); });
    const groups = groupOptions().filter((g) => {
      const e = gl.get(g), fb = stageFromGroup(g);
      const stages = e && e.stages.size ? e.stages : fb ? new Set([fb]) : null;
      if (sc.stages.length && stages && ![...stages].some((x) => sc.stages.includes(x))) return false;
      if (sc.tracks.length && e && e.tracks.size && ![...e.tracks].some((t) => sc.tracks.includes(t))) return false;
      return true;
    });
    return { tracks, groups };
  }
  /* بعد تغيير المرحلة أو المسار: يُسقَط من الاختيار ما لم يعد مرتبطاً */
  function pruneScope() {
    const av = scopeAvail(), okT = new Set(av.tracks.map((o) => String(o.v))), okG = new Set(av.groups);
    [state.sel, state.mis, state.cmp, state.sib, state.dq, state.grp, state.imp, state.att, state.sig, state.xl, state.pledge, state.monthly, state.gaps].forEach((c) => { if (c.tracks && c.tracks.length) c.tracks = c.tracks.filter((t) => okT.has(String(t))); });
    if ((state.groups || []).length) state.groups = state.groups.filter((g) => okG.has(g));
  }
  function scopeSet(kind, value, on) {
    const upd = (c, key, v) => { const arr = (c[key] = c[key] || []); const at = arr.indexOf(v); if (on && at < 0) arr.push(v); else if (!on && at >= 0) arr.splice(at, 1); };
    if (kind === "tracks") [state.sel, state.mis, state.cmp, state.sib, state.dq, state.grp, state.imp, state.att, state.sig, state.xl, state.pledge, state.monthly, state.gaps].forEach((c) => upd(c, "tracks", String(value)));
    else {
      [state.sel, state.mis].forEach((c) => upd(c, "stages", stageK(value)));
      [state.sib, state.dq, state.grp, state.imp, state.att, state.sig, state.xl, state.pledge, state.monthly, state.gaps].forEach((c) => upd(c, "stages", value));
    }
    pruneScope();
    scopeSave();
  }
  function scopeClear() {
    [state.sel, state.mis, state.cmp, state.sib, state.dq, state.grp, state.imp, state.att, state.sig, state.xl, state.pledge, state.monthly, state.gaps].forEach((c) => { c.tracks = []; if ("stages" in c) c.stages = []; });
    state.groups = [];
    scopeSave();
  }
  /* آخر نطاق (مراحل/مسارات/مجموعات) يُحفظ على هذا الجهاز ويعود عند فتح الصفحة؛ «مسح الكل» يمسحه */
  const SCOPE_KEY = "tamkeen:cc-scope";
  function scopeSave() {
    try { const sc = scopeNow(); lsSet(SCOPE_KEY, { t: sc.tracks, s: sc.stages, g: (state.groups || []).slice() }); } catch (e) { /* لا يضرّ */ }
  }
  function scopeLoad() {
    const d = lsGet(SCOPE_KEY, null); if (!d || typeof d !== "object") return;
    try {
      (Array.isArray(d.t) ? d.t : []).forEach((v) => scopeSet("tracks", v, true));
      (Array.isArray(d.s) ? d.s : []).forEach((v) => scopeSet("stages", v, true));
      state.groups = Array.isArray(d.g) ? d.g.slice() : [];
      scopeSave();
    } catch (e) { /* نطاق محفوظ تالف: يُتجاهل */ }
  }
  /* القوائم المكررة داخل التبويبات (المسارات/المراحل) تُخفى لأن الشريط يتولاها */
  function hideScopeDupes(box) {
    const own = 'input[data-sel="tracks"],input[data-sel="stages"],input[data-mis="tracks"],input[data-mis="stages"],input[data-cmp="tracks"],input[data-sib="tracks"],input[data-sib="stages"],input[data-dq="tracks"],input[data-dq="stages"],input[data-grp="tracks"],input[data-grp="stages"],input[data-imp="tracks"],input[data-imp="stages"]';
    box.querySelectorAll("fieldset.cc-fs").forEach((f) => {
      if (f.closest(".cc-gbar")) return;
      const ins = f.querySelectorAll('input[type="checkbox"], input[type="radio"]');
      if (ins.length && [...ins].every((i) => i.matches(own))) f.hidden = true;
    });
  }
  function groupBar() {
    const av = scopeAvail(), opts = av.groups, on = state.groups || [], sc = scopeNow();
    const sum = (list, all) => (list.length ? list.slice(0, 2).join("، ") + (list.length > 2 ? " +" + (list.length - 2) : "") : all);
    const trNames = sc.tracks.map((id) => { const o = trackOpts().find((x) => String(x.v) === id); return o ? o.t.replace(/^مسار\s*/, "") : id; });
    const open = state.gopen;   // اللوح مفتوح؛ الأقراص تبدّله
    const pill = (key, label, list, all, has) => has === false ? "" : `<button type="button" class="cc-pill ${list.length ? "on" : ""}" data-cc="gtoggle" data-gk="${key}" aria-expanded="${open === key}">${label}: <b>${esc(sum(list, all))}</b> <span aria-hidden="true">${open === key ? "▴" : "▾"}</span></button>`;
    const chips = (name, items, onList) => `<div class="cc-chips">${items.map(([v, t]) => `<label class="cc-chk"><input type="checkbox" ${name} value="${esc(v)}" ${onList.includes(String(v)) ? "checked" : ""}> <span>${esc(t)}</span></label>`).join("")}</div>`;
    let panel = "";
    if (open === "tracks") panel = (av.tracks.length ? chips("data-sc=\"tracks\"", av.tracks.map((o) => [o.v, o.t.replace(/^مسار\s*/, "")]), sc.tracks) : '<p class="cc-note">لا مسارات مرتبطة بالمرحلة المختارة.</p>') + (sc.stages.length ? '<p class="cc-note">تظهر المسارات المرتبطة بالمرحلة المختارة فقط.</p>' : "");
    else if (open === "stages") panel = chips("data-sc=\"stages\"", STAGES.map((g) => [g.t, g.t]), sc.stages) + '<p class="cc-note">اتركها فارغة لتشمل كل المراحل. باختيار مرحلة تظهر المسارات والمجموعات المرتبطة بها فقط.</p>';
    else if (open === "groups") panel = `${opts.length ? chips("data-gf", opts.map((g) => [g, g]), on) : '<p class="cc-note">لا مجموعات محفوظة بعد. اضغط «حمّل قائمة المجموعات» (قراءة واحدة) فتُحفظ وتظهر في كل زيارة.</p>'}
        <div class="cc-row"><button type="button" class="btn secondary small" data-cc="load-groups" ${state.busy ? "disabled" : ""}>${opts.length ? "حدّث قائمة المجموعات" : "حمّل قائمة المجموعات"}</button><span class="cc-note">في «قياس الأثر» تُقرأ كل مجموعة على حدة من صفحة النظام.</span></div>`;
    const any = sc.tracks.length || sc.stages.length || on.length;
    return `<div class="cc-gbar"><span class="cc-gl">النطاق</span>
      ${pill("stages", "المراحل", sc.stages.map((t) => t.replace(/^المرحلة\s*/, "")), "الكل", sc.hasStages)}${pill("tracks", "المسارات", trNames, "الكل")}${pill("groups", "المجموعات", on, "الكل")}
      ${any ? '<button type="button" class="cc-link" data-cc="gclear">مسح الكل</button>' : ""}${panel ? `<div class="cc-gpanel">${panel}</div>` : ""}</div>`;
  }
  let runStats = { sent: 0, cached: 0 };
  /* قوائم الطلاب (بلا مصدر خاص) تُحسب من الذاكرة المحمّلة إن كفت، فلا تُرسَل إلى النظام */
  const cachedResult = (cmd) => {
    if (!state.cache || !cmd || cmd.type !== "list" || cmd.source) return null;
    try { return localList({ command: cmd }); } catch (e) { return null; }
  };
  async function runCommands(commands, hooks) {
    hooks = hooks || {};
    state.snapPaused = false;   // جلب جديد بطلبك: يُستأنف الحفظ على الجهاز
    const local = commands.map((c) => (hooks.noCache || state.forceFresh ? null : cachedResult(c)));
    const idx = [], todo = [];
    commands.forEach((c, i) => { if (!local[i]) { idx.push(i); todo.push(c); } });
    runStats.sent += todo.length; runStats.cached += commands.length - todo.length;
    const results = new Array(commands.length);
    local.forEach((r, i) => { if (r) { results[i] = r; if (hooks.onPartial) hooks.onPartial(i, r); } });
    if (todo.length) {
      const got = await sendCommands(todo, Object.assign({}, hooks, { onPartial: hooks.onPartial ? (i, r) => hooks.onPartial(idx[i], r) : undefined }));
      idx.forEach((orig, k) => { results[orig] = got[k]; });
    }
    return hooks.noGroup ? results : results.map(gfResult);
  }

  async function sendCommands(commands, hooks) {
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
      const results = await runCommands(tracks.map((o) => Object.assign({ type: "list", label: o.t, params: { track_id: String(o.v) } }, details ? { details: true } : {})), { noCache: true, noGroup: true });
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
  async function executeBatch(commands, labels, useExtras, exportPlan) {
    state.busy = true; state.autoRunRegister = false; state.resultError = ""; state.results = null; state.adding = ""; state.proposal = null;
    state.progress = ""; state.plan = null; state.planResolve = null; state.labels = labels || []; state.groupFilter = "";
    render(); refreshStatus();
    try {
      // كل أمر ينتهي تظهر نتيجته فوراً (إضافة 1.4.0 فأحدث)، والباقي «قيد التنفيذ»
      const partial = new Array(commands.length).fill(null);
      const results = await runCommands(commands, { onPartial: (i, r) => { partial[i] = r; state.results = { results: partial.map((x) => x || { type: "pending" }) }; render(); } });
      if (!results.length) throw new Error("لم تصل نتيجة من الوكيل.");
      if (commands.length === 1 && results[0] && results[0].error) throw new Error(results[0].error);
      state.results = { at: new Date(), results: (useExtras ? results.map(applyExtras) : results).map(enrichResult) };
      /* إكمال تلقائي من بيانات المتقدم: يلي تنفيذ التقرير بالضغطة نفسها، فقط إن كان في الجداول أعمدة تستفيد، ولم تكفِ الذاكرة */
      if (exportPlan && state.enrichAuto && canExport() && needsEnrich(state.results.results) && !enrichCovers(state.results.results)) {
        try {
          state.progress = "إكمال الفراغ من بيانات المتقدم…"; render();
          await enrichFromSystem(exportPlan);
          state.results = Object.assign({}, state.results, { results: state.results.results.map(enrichResult) }); state.enrichErr = "";
        } catch (e) { state.enrichErr = "تعذّر الإكمال التلقائي من النظام: " + (e.message || e); }
      }
      state.requestText = "";
      state.reg = null;
    } catch (err) { state.resultError = err.message || String(err); }
    finally { state.busy = false; state.plan = null; state.planResolve = null; render(); refreshStatus(); }
  }

  /* ===== الأحداث ===== */
  function init() {
    const box = $("cc-body");
    if (!box) return;
    scopeLoad();
    snapLoad().catch(() => { snapReady = true; });
    extLoad().then(() => { if (state.mode === "attend" && state.cancelLog.length) render(); }).catch(() => { state.cancelLog = []; state.attHist = []; });
    try { const m = localStorage.getItem("tamkeen-admin:cc-msg"); if (m) state.mis.msg = m; } catch (e) { /* خاص */ }
    state.saved = lsGet(SV_KEY, []); state.runLog = lsGet(LOG_KEY, []); state.errors = lsGet(ERR_KEY, []); state.contacts = lsGet(CONTACT_KEY, []);
    try { const cc = localStorage.getItem(CC_KEY); if (cc) state.wa.cc = cc; } catch (e) { /* خاص */ }
    try { state.mask = localStorage.getItem(MASK_KEY) === "1"; const im = localStorage.getItem(IDLE_KEY); if (im !== null && im !== "") state.idleMin = Number(im); } catch (e) { /* خاص */ }
    ["click", "keydown", "input", "change"].forEach((ev) => box.addEventListener(ev, () => { state.lastAct = Date.now(); }, true));
    window.setInterval(() => {                                      // مسح النتائج بعد خمول (لا أثناء تنفيذ)
      if (!state.idleMin || state.busy || !hasSensitive()) return;
      if (Date.now() - state.lastAct > state.idleMin * 60000) (state.snapPaused = true, wipeData)("مُسحت النتائج من الشاشة لخمولك " + state.idleMin + " دقيقة؛ أعد التنفيذ عند الحاجة");
    }, 30000);
    window.addEventListener("error", (e) => pushErr(e.message, (e.filename || "").split("/").pop() + ":" + e.lineno));
    window.addEventListener("unhandledrejection", (e) => pushErr((e.reason && e.reason.message) || e.reason, "promise"));
    fetch("extension/manifest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m && m.version) { state.extLatest = m.version; if (!state.busy) render(); } }).catch(() => {});
    try { state.notify = localStorage.getItem(NOTIFY_KEY) === "1"; } catch (e) { /* خاص */ }
    window.setInterval(() => { const e = $("cc-elapsed"); if (e && state.busy && state.progStart) e.textContent = fmtElapsed(Date.now() - state.progStart); }, 1000);
    render();
    refreshStatus();
    window.setInterval(refreshStatus, 8000);
    /* اللوحة الرئيسية: تقارير محفوظة بنقرة وتذكير الأسبوع (المتجر يُحمَّل بعد هذا السكربت، فنؤخّر الرسم) */
    window.setTimeout(renderDash, 1500);
    window.addEventListener("hashchange", () => { if (location.hash === "#dashboard" || location.hash === "") renderDash(); });
    document.addEventListener("click", (e) => {
      const sv = e.target.closest && e.target.closest("[data-dash-saved]"), wk = e.target.closest && e.target.closest("[data-dash-weekly]");
      if (sv) openCenterThen(() => runSavedById(sv.dataset.dashSaved));
      else if (wk) openCenterThen(runWeekly);
    });
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
      /* قراءة واسعة: نتوقف ونُظهر التنبيه مرة، وبـ«تابع على أي حال» نعيد النقر على الزر نفسه مرة واحدة */
      if (act === "wide-edit") { state.wide = null; render(); const card = box.querySelector(".cc-card"); if (card && card.scrollIntoView) card.scrollIntoView({ block: "start" }); return; }
      if (act === "wide-go") { const go = state.wide && state.wide.act; state.wide = null; state.wideOk = true; render(); const rb = go && box.querySelector('[data-cc="' + go + '"]'); if (rb && !rb.disabled) rb.click(); else state.wideOk = false; return; }
      if (act === "att-today") state.att.from = state.att.to = ui.todayISO();   // قبل تقدير القراءة
      if (RUN_ACTS.includes(act)) {
        if (state.wideOk) state.wideOk = false;
        else { const n = estimateReads(act); if (n >= (state.wideLimit || WIDE_LIMIT)) { state.wide = { act, n }; render(); const bn = box.querySelector(".cc-wide-warn"); if (bn && bn.scrollIntoView) bn.scrollIntoView({ block: "center" }); return; } }
        state.wide = null;
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
          /* ملف Excel مستقل لكل مسار/قائمة، مجمّعة في ملف مضغوط واحد */
          const zip = new JSZip(), used = new Set();
          for (const [k, r] of state.results.results.entries()) {
            if (r.type !== "list") continue;
            let name = (state.labels[k] || "قائمة " + (k + 1)).replace(/^مسار\s*/, "").replace(/[\/:*?"<>|]/g, " ").trim().slice(0, 80) || "قائمة";
            const base = name; let n = 2; while (used.has(name)) name = base + " " + (n++);
            used.add(name);
            const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(name.slice(0, 28).replace(/[\[\]]/g, " "));
            const [hh, rr] = shown(r.heads, visibleRows(r).map((x) => x.cells));
            fmtSheet(ws, hh, rr);
            zip.file(name + ".xlsx", await wb.xlsx.writeBuffer());
          }
          if (!Object.keys(zip.files).length) return;
          return ui.download("تقرير المركز " + ui.todayISO() + ".zip", await zip.generateAsync({ type: "blob" }));
        } else if (act === "run-selection") {
          const plan = buildSelection();
          state.fallbackNote = ""; state.extraNote = "";
          const local = [];
          if (state.cache) for (const x of plan) { const r = localList(x); if (!r) { state.fallbackNote = cacheWhy; break; } local.push(r); }
          if (local.length && local.length === plan.length) {
            state.resultError = ""; state.groupFilter = ""; state.labels = plan.map((x) => x.label + " ⚡");
            state.results = { results: local.map(applyExtras).map(enrichResult) };
            render(); return;
          }
          return executeBatch(plan.map((p) => p.command), plan.map((p) => p.label), true, plan.map((p) => ({ params: p.command.params, label: p.label })));
        } else if (act === "refresh-mode") { const rb = box.querySelector('[data-cc="' + RUN_BTN[state.mode] + '"]'); if (!rb || rb.disabled) return; state.forceFresh = true; return rb.click();
        } else if (act === "fav-toggle") { const k = b.dataset.m, f = lsGet(FAV_KEY, []); lsSet(FAV_KEY, f.includes(k) ? f.filter((x) => x !== k) : [...f, k]); return render();
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
        } else if (act === "run-imp" || act === "imp-apply") { return runImpact();
        } else if (act === "gtoggle") { const k = b.dataset.gk; state.gopen = state.gopen === k ? "" : k; render(); return;
        } else if (act === "gclear") { scopeClear(); render(); return;
        } else if (act === "run-att") { return runAttend();
        } else if (act === "export-att") { const sh = attSheets("الحضور والغياب"); if (!sh.length) return; const wb = new ExcelJS.Workbook(); sh.forEach((x) => fmtSheet(wb.addWorksheet(x.name.slice(0, 31)), x.heads, x.rows)); return ui.download("الحضور والغياب " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        } else if (act === "sig-read") { try { return await sigReadImages(); } catch (e) { state.resultError = e.message === "NO_KEY" ? "أضف مفتاح الذكاء الاصطناعي أولاً (صفحة «المراسلات والتقارير» ← إعدادات الذكاء الاصطناعي)." : (e.message || String(e)); state.sig.reading = false; return render(); }
        } else if (act === "run-sig") { return runSign();
        } else if (act === "run-xl") { return runXl();
        } else if (act === "run-morning") { return runMorning();
        } else if (act === "run-gaps") { return runGaps();
        } else if (act === "gaps-file") {
          const e = state.enrich; if (!e) return;
          state.gaps.out = { at: new Date(), file: true, lists: gapsListsFrom(e) };
          return render();
        } else if (act === "att-cancel") { return attCancelRun();
        } else if (act === "att-sel-flag") { const set = selOf("att-0"); attFlaggedShown().forEach((e) => set.add(e.stu)); tblRefresh("att-0"); return selSync("att-0");
        } else if (act === "att-sel-near") { const set = selOf("att-0"), tf = attTF(); attNear().filter((e) => attInTrack(e, tf)).forEach((e) => set.add(e.stu)); tblRefresh("att-0"); return selSync("att-0");
        } else if (act === "att-near-copy") { const t = "*طلاب على حد الغياب (" + state.att.thr + " غيابات) — غياب آخر يتجاوزونه*\n" + attNear().sort((a, b) => (a.track || "").localeCompare(b.track || "", "ar") || a.name.localeCompare(b.name, "ar")).map((e) => "• " + e.name + " — " + (e.track || "") + (e.group ? " · " + e.group : "") + " (" + attCount(e) + ")").join("\n"); return ui.copyText(t).then(() => ui.toast("نُسخت القائمة"));
        } else if (act === "wr-op") { state.wr.op = b.dataset.op; state.wr.out = null; return render();
        } else if (act === "wr-run") { return wrRun();
        } else if (act === "wr-apps") { return wrApps();
        } else if (act === "wr-from-att") { const w = state.wr, have = new Set(wrLines().map((a) => a[0])); const add = [...selOf("att-0")].filter((x) => !have.has(x)); w.text = (w.text && !/\n$/.test(w.text) ? w.text + "\n" : w.text || "") + add.map((x) => (w.op === "move" ? x + ", " : x)).join("\n"); return render();
        } else if (act === "log-undo") { return logUndoRun();
        } else if (act === "log-show") { await extLoad(); return render();
        } else if (act === "log-word") { return lhWord(cancelBlocks(), "تقرير الطلبات الملغاة");
        } else if (act === "log-print") { return lhPrint(cancelBlocks(), "تقرير الطلبات الملغاة");
        } else if (act === "log-xlsx") { return logXlsx();
        } else if (act === "log-sel-none") { selOf("att-log").clear(); tblRefresh("att-log"); return selSync("att-log");
        } else if (act === "log-clear") { if (!window.confirm("يُمسح سجل الإلغاءات من هذا الجهاز (لا يتغيّر شيء في نظام المركز)، ولا يمكن استرجاعه. متابعة؟")) return; state.cancelLog = []; await logSave(); return render();
        } else if (act === "att-sel-none") { selOf("att-0").clear(); tblRefresh("att-0"); return selSync("att-0");
        } else if (act === "pledge-chairs-word" || act === "pledge-chairs-xlsx") {
          const st = pledgeStudents(); if (!st.length) return;
          const o = state.pledge.opts || pledgeOpts(), items = App.pledgeSheet.chairs(st, o, o.chairStart), base = "أرقام الكراسي " + ui.todayISO();
          try {
            if (act === "pledge-chairs-word") { ui.download(base + ".docx", await App.chairNumbers.docx(items, { names: !!o.chairNames, tags: !!o.chairTags, logos: o.chairLogos !== false })); return ui.toast("نُزّل ملف Word (" + ui.fmt(Math.ceil(items.length / 4)) + " صفحة A4)"); }
            const wb = new ExcelJS.Workbook();
            fmtSheet(wb.addWorksheet("أرقام الكراسي"), ["رقم الكرسي", "الاسم", "رقم الهوية", "المسار", "الجنس", "المجموعة", "المرحلة"], items.map((x) => [x.n, x.name, x.id, x.track, x.sex, x.group, x.stage]));
            ui.download(base + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            return ui.toast("نُزّلت قائمة الكراسي Excel (" + ui.fmt(items.length) + " رقماً)");
          } catch (e) { state.resultError = "تعذّر التصدير: " + (e.message || e); return render(); }
        } else if (act === "pledge-chairs") {
          const st = pledgeStudents(); if (!st.length) return;
          const o = state.pledge.opts || pledgeOpts(), items = App.pledgeSheet.chairs(st, o, o.chairStart);
          App.chairNumbers.print(items, { names: !!o.chairNames, tags: !!o.chairTags, logos: o.chairLogos !== false, title: "أرقام الكراسي" });
          return ui.toast("اختر الطابعة ومقاس الورق A4 بدون هوامش (" + ui.fmt(items.length) + " رقماً على " + ui.fmt(Math.ceil(items.length / 4)) + " ورقة)");
        } else if (act === "pledge-gender") { return pledgeGenderFetch();
        } else if (act === "enrich-now") { return enrichNow();
        } else if (act === "enrich-clear") { state.enrich = null; state.enrichErr = ""; if (state.results) state.results = Object.assign({}, state.results); return render();
        } else if (act === "gaps-xlsx") { return gapsOutput("xlsx");
        } else if (act === "gaps-copy") { return gapsOutput("copy");
        } else if (act === "gaps-all") { state.gaps.fields = gapFieldList().map((f) => f.name); return render();
        } else if (act === "gaps-none") { state.gaps.fields = []; return render();
        } else if (act === "go-gaps") { return openMode("gaps");
        } else if (act === "run-monthly") { return runMonthly();
        } else if (act === "mon-print") { return monthlyOutput("print");
        } else if (act === "mon-word") { return monthlyOutput("word");
        } else if (act === "mon-xlsx") { return monthlyOutput("xlsx");
        } else if (act === "mon-copy") { return monthlyOutput("copy");
        } else if (act === "run-grad") { return runGrad();
        } else if (act === "run-pledge") { return runPledge();
        } else if (act === "pledge-print") { return pledgeOutput("print");
        } else if (act === "pledge-word") { return pledgeOutput("word");
        } else if (act === "pledge-ann-print") { return pledgeOutput("print", "announcer");
        } else if (act === "pledge-ann-word") { return pledgeOutput("word", "announcer");
        } else if (act === "pledge-reset") { state.pledge.opts.preamble = App.pledgeSheet.DEFAULTS.preamble; state.pledge.opts.title = App.pledgeSheet.DEFAULTS.title; pledgeSave(); return render();
        } else if (act === "img-read") { try { return await imgRead(); } catch (e) { state.resultError = e.message === "NO_KEY" ? "أضف مفتاح الذكاء الاصطناعي أولاً (صفحة «المراسلات والتقارير» ← الإعدادات)." : (e.message || String(e)); return render(); }
        } else if (act === "img-rm") { state.img.files.splice(Number(b.dataset.i), 1); return render();
        } else if (act === "export-img") { return imgExport();
        } else if (act === "img-xl") { return imgToCompare();
        } else if (act === "export-grad") { return gradExport();
        } else if (act === "grad-copy") { const o = state.grad.out; if (!o) return; const no = o.rows.filter((g) => !g.ok); const t = "*غير مستوفين للتخرج (" + no.length + ")*\n" + no.map((g, i) => (i + 1) + ". " + g.s.name + (g.s.group ? " — " + g.s.group : "") + " (" + g.reasons.join("، ") + ")").join("\n"); return ui.copyText(t).then(() => ui.toast("نُسخت القائمة"));
        } else if (act === "morning-copy") { const t = morningText(); if (!t) return; return ui.copyText(t).then(() => ui.toast("نُسخ تقرير الصباح"));
        } else if (act === "export-xl") { return xlExport();
        } else if (act === "sigwa-copy") { const x = sigWaMsgs()[Number(b.dataset.i)]; if (!x) return; return ui.copyText(x.msg).then(() => ui.toast("نُسخت رسالة " + x.tr));
        } else if (act === "sigwa-copy-all") { const ms = sigWaMsgs(); if (!ms.length) return; return ui.copyText(ms.map((x) => x.msg).join("\n\n————————\n\n")).then(() => ui.toast("نُسخت رسائل " + ui.fmt(ms.length) + " مسارات"));
        } else if (act === "sigwa-xlsx") { const ms = sigWaMsgs(); if (!ms.length) return; const wb = new ExcelJS.Workbook(); fmtSheet(wb.addWorksheet("رسائل المسارات"), ["المسار", "عدد الطلاب", "الرسالة"], ms.map((x) => [x.tr, x.n, x.msg])); return ui.download("رسائل نواقص التوقيع " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        } else if (act === "sig-copy-miss") { const m = sigMatrix(); if (!m) return; const lack = m.rows.filter((x) => x.miss.length); const t = "*ناقصو التوقيع (" + lack.length + " من " + m.rows.length + ")*\n" + lack.map((x, i) => (i + 1) + ". " + x.reg.name + " — ينقصه: " + x.miss.join("، ")).join("\n"); return ui.copyText(t).then(() => ui.toast("نُسخت قائمة الناقصين"));
        } else if (act === "sig-clear") { if (!window.confirm("تُمسح الجلسة المحفوظة (المقروء من الصور والمسجلون المجلوبون ونتائج البحث) ولا يمكن التراجع. متابعة؟")) return; sigClear(); return render();
        } else if (act === "sig-learn-clear") { if (!window.confirm("تُمسح ذاكرة التصحيحات (ما ربطتَه وما حظرتَه) ولا يمكن التراجع. متابعة؟")) return; sigLearnClear(); return render();
        } else if (act === "sig-view") { state.sig.view = state.sig.view || {}; state.sig.view[b.dataset.idx || "0"] = b.dataset.v; return render();
        } else if (act === "sig-pick") {
          const c = state.sig, fid = b.dataset.f, h = ((c.nameHits || {})[fid] || {}).list, x = h && h[Number(b.dataset.k)];
          if (x) { c.lookups = c.lookups || {}; c.lookups[fid] = { q: "", list: [x.s], by: "name", score: x.score }; sigLearnAuto(); sigSaveSoon(); render(); }
          return;
        } else if (act === "sig-retrack") { return sigRetrack();
        } else if (act === "sig-namesearch") { return runSigNameSearch();
        } else if (act === "sig-lookup") { return runSigLookup();
        } else if (act === "sig-xl-add") { return sigXlAdd();
        } else if (act === "sig-xl-clear") { state.sig.xl = null; state.sig.xlErr = ""; return render();
        } else if (act === "sig-rm") { state.sig.files.splice(Number(b.dataset.i), 1); return render();
        } else if (act === "sig-del") { const r = state.sig.rows[Number(b.dataset.i)]; if (r) r.keep = false; return render();
        } else if (act === "sig-add") { state.sig.rows = state.sig.rows || []; state.sig.rows.push({ id: "m:" + Date.now(), file: "(أضفتَه)", name: "", nid: "", phone: "", signed: false, conf: 1, keep: true }); return render();
        } else if (act === "sig-ok") { state.sig.manual[(b.dataset.form || "") + "|" + b.dataset.k] = b.dataset.f || "none"; { const f = (state.sig.rows || []).find((r) => r.id === b.dataset.f), rg = (state.sig.reg || []).find((r) => r.key === b.dataset.k); if (f && rg) sigLearnAdd(f.name, rg); } return render();
        } else if (act === "sig-no") { state.sig.manual[(b.dataset.form || "") + "|" + b.dataset.k] = "none"; { const f = (state.sig.rows || []).find((r) => r.id === b.dataset.f), rg = (state.sig.reg || []).find((r) => r.key === b.dataset.k); if (f && rg) sigLearnBlock(f.name, rg); } return render();
        } else if (act === "sig-copy") { const fm = b.dataset.form, un = sigUnsignedRows(fm); const t = "*لم يوقّعوا" + (sigForms().length > 1 ? " — " + fm : "") + " (" + un.length + ")*\n" + un.map((x, i) => (i + 1) + ". " + x.reg.name + (x.reg.group ? " — " + x.reg.group : "")).join("\n"); return ui.copyText(t).then(() => ui.toast("نُسخت القائمة"));
        } else if (act === "export-sig") { const sh = sigSheets(); if (!sh.length) return; const wb = new ExcelJS.Workbook(); sh.forEach((x) => { const ws = wb.addWorksheet(x.name.slice(0, 31)); fmtSheet(ws, x.heads, x.rows); if (x.name === "ما ينقص كل طالب") ws.eachRow((r, n) => { if (n > 1) r.eachCell((cell) => { const v = String(cell.value == null ? "" : cell.value); if (v.startsWith("✗")) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } }; else if (v.startsWith("✓")) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F6EA" } }; }); }); }); return ui.download("مطابقة التوقيعات " + ui.todayISO() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        } else if (act === "att-today") { return runAttend();
        } else if (act === "att-wa") { const e = attGroups()[Number(b.dataset.i)]; if (!e) return; return ui.copyText(attGroupText(e, state.att.out.lastDay)).then(() => ui.toast("نُسخ نص مجموعة " + e.track + (e.group ? " " + e.group : "")));
        } else if (act === "att-wa-all") { const day = state.att.out && state.att.out.lastDay; const t = attGroups().map((e) => attGroupText(e, day)).join("\n\n━━━━━━━━\n\n"); if (!t) return; return ui.copyText(t).then(() => ui.toast("نُسخت نصوص كل المجموعات"));
        } else if (act === "att-copy") { const t = "*طلاب تجاوزوا " + state.att.thr + " غيابات*\n" + attFlagged().sort((a, b) => attCount(b) - attCount(a)).map((e) => "• " + e.name + " — " + e.track + " (" + e.group + "): " + attCount(e) + " غيابات").join("\n"); try { await navigator.clipboard.writeText(t); ui.toast("نُسخت القائمة"); } catch (err) { ui.toast("تعذّر النسخ"); } return;
        } else if (act === "imp-snap-save") { impSnapSave(); render(); return;
        } else if (act === "imp-snap-del") { lsSet(IMP_SNAP_KEY, impSnaps().filter((x) => x.id !== state.imp.cmpWith)); state.imp.cmpWith = ""; render(); return;
        } else if (act === "imp-copy-wa") { try { await navigator.clipboard.writeText(impWaText()); ui.toast("نُسخ ملخص قياس الأثر؛ الصقه في واتساب"); } catch (err) { ui.toast("تعذّر النسخ"); } return;
        } else if (act === "load-groups") { return loadGroups();
        } else if (act === "export-imp") { return exportImp();
        } else if (act === "grp-compliance") { return runCompliance();
        } else if (act === "print-dq") { return lhPrint(dqBlocks(), "تقرير جودة بيانات الطلاب");
        } else if (act === "word-dq") { return lhWord(dqBlocks(), "تقرير جودة بيانات الطلاب");
        } else if (act === "print-grp") { return lhPrint(groupsBlocks(), "تقرير المجموعات والمدربين");
        } else if (act === "word-grp") { return lhWord(groupsBlocks(), "تقرير المجموعات والمدربين");
        } else if (act === "print-cmp") { return lhPrint(compareBlocks(), "تقرير مقارنة المراحل");
        } else if (act === "word-cmp") { return lhWord(compareBlocks(), "تقرير مقارنة المراحل");
        } else if (act === "print-sib") { return lhPrint(siblingsBlocks(), "تقرير مقارنة الإخوة");
        } else if (act === "word-sib") { return lhWord(siblingsBlocks(), "تقرير مقارنة الإخوة");
        } else if (act === "news-load") {
          const it = whatsNew().find((x) => x.key === b.dataset.key); if (!it) return;
          state.mode = "missing"; state.adding = ""; state.proposal = null;
          Object.assign(state.mis, { kind: it.kind, tracks: it.tracks, stages: it.stages, status: it.status, out: null });
        } else if (act === "news-dq") { state.mode = "dq"; state.adding = ""; state.proposal = null;
        } else if (act === "weekly-run") { return runWeekly();
        } else if (act === "weekly-snooze") { lsSet(SNOOZE_KEY, Date.now() + 2 * 86400000); ui.toast("سأذكّرك بعد يومين"); renderDash();
        } else if (act === "grp-propose") { state.grp.out.prop = proposeDistribution(state.grp.out);
        } else if (act === "wa-open") { waOpen(b.dataset.mode); return;
        } else if (act === "wa-copy") {
          try { await navigator.clipboard.writeText(state.wa.texts[b.dataset.mode] || waText(b.dataset.mode)); ui.toast("نُسخ نص الرسالة"); } catch (err) { ui.toast("تعذّر النسخ"); }
          return;
        } else if (act === "wa-regen") { state.wa.dirty[b.dataset.mode] = false; state.open.wa = true;
        } else if (act === "wa-addc") {
          const name = (window.prompt("اسم جهة الاتصال (مثال: مدير المركز):", "") || "").trim(); if (!name) return;
          const role = (window.prompt("الصفة (اختياري، مثال: مسؤول البيانات):", "") || "").trim();
          const phone = (window.prompt("رقم الجوال (مثال 0599xxxxxx أو +970599xxxxxx):", "") || "").trim();
          if (!waIntl(phone, state.wa.cc)) return ui.toast("رقم غير صالح");
          const fem = window.confirm("هل المستلم أنثى؟ (موافق = «الأستاذة»، إلغاء = «الأستاذ»)");
          const id = String(Date.now());
          state.contacts.push({ id, name: name.slice(0, 40), role: role.slice(0, 40), phone, cc: state.wa.cc, fem }); lsSet(CONTACT_KEY, state.contacts);
          state.wa.contact = id; state.open.wa = true;
        } else if (act === "wa-addg") {
          const name = (window.prompt("اسم المجموعة (مثال: مجموعة منسقي المساحات):", "") || "").trim(); if (!name) return;
          const link = (window.prompt("رابط دعوة المجموعة (من واتساب: معلومات المجموعة ← الدعوة عبر رابط)، ويبدأ بـ https://chat.whatsapp.com/", "") || "").trim();
          if (!/^https:\/\/chat\.whatsapp\.com\/[\w-]{10,}/i.test(link)) return ui.toast("رابط الدعوة غير صالح");
          const id = String(Date.now());
          state.contacts.push({ id, name: name.slice(0, 40), role: "", link: link.slice(0, 200) }); lsSet(CONTACT_KEY, state.contacts);
          state.wa.contact = id; state.open.wa = true;
        } else if (act === "wa-delc") {
          state.contacts = state.contacts.filter((x) => x.id !== state.wa.contact); lsSet(CONTACT_KEY, state.contacts); state.wa.contact = ""; state.open.wa = true;
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
          lsSet(SV_KEY, state.saved); ui.toast("حُفظ «" + name + "»"); renderDash();
        } else if (act === "sv-load" || act === "sv-run") {
          const it = state.saved.find((x) => x.id === b.dataset.id);
          if (!it) return;
          state.mode = it.mode; state.adding = ""; state.proposal = null; applyCfg(it.mode, it.cfg);
          render();
          if (act === "sv-run") { markRan(it.id); const rb = box.querySelector('[data-cc="' + RUN_BTN[it.mode] + '"]'); if (rb && !rb.disabled) rb.click(); }
          return;
        } else if (act === "sv-remind") {
          const it = state.saved.find((x) => x.id === b.dataset.id); if (!it) return;
          const v = window.prompt("ذكّرني بتشغيل «" + it.name + "» كل كم يوم؟ (اكتب 0 لإلغاء التذكير)", it.every || "7");
          if (v === null) return;
          const n = Math.max(0, Math.min(365, Math.round(Number(v)) || 0));
          it.every = n; lsSet(SV_KEY, state.saved); ui.toast(n ? "سيُذكَّرك كل " + n + " يوماً على اللوحة الرئيسية" : "أُلغي التذكير"); renderDash();
        } else if (act === "sv-del") {
          state.saved = state.saved.filter((x) => x.id !== b.dataset.id); lsSet(SV_KEY, state.saved); renderDash();
        } else if (act === "toggle-mask") {
          state.mask = !state.mask; try { localStorage.setItem(MASK_KEY, state.mask ? "1" : ""); } catch (e) { /* خاص */ }
        } else if (act === "wipe-now") { snapClear(); kvPut(HIST_K, []); return wipeData("مُسحت بيانات هذه الشاشة والنتائج المحفوظة على هذا الجهاز (سجل الإلغاءات باقٍ حتى تمسحه منه)");
        } else if (act === "snap-restore") { state.snapPaused = false; snapApply(true); await extLoad(); return render();
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
          location.hash = "#converter"; window.setTimeout(() => { const tab = document.querySelector('[data-cv-tab="exam"]'); if (tab) tab.click(); }, 250);
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
          // صفحة «المحوّل» منفصلة عن صفحة أوامر المركز: ننتقل إليها أولاً ليرى المستخدم خطوة المطابقة والنتيجة
          location.hash = "#converter";
          ui.toast("جارٍ تجهيز النماذج في «المحوّل»…");
          await App.converter.useData(headers, rows, label, { templateIds: state.tplPick.slice(), autoParse: true, groupBy });
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

    box.addEventListener("input", (e) => {
      if (e.target.dataset && e.target.dataset.stu === "q") state.stu.q = e.target.value;
      const wm = e.target.dataset && e.target.dataset.waText;
      if (wm) { state.wa.texts[wm] = e.target.value; state.wa.dirty[wm] = true; }          // تعديلك يُحفظ ولا يُستبدل
      if (e.target.dataset && e.target.dataset.wa === "phone") state.wa.phone = e.target.value;
      if (e.target.dataset && (e.target.dataset.wr === "text" || e.target.dataset.wr === "group")) state.wr[e.target.dataset.wr] = e.target.value;
    });
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
      if (t.dataset.wa) {
        const k = t.dataset.wa, w = state.wa;
        if (k === "contact") w.contact = t.value;
        else if (k === "phone") { w.phone = t.value; return; }
        else if (k === "breakdown") { w.breakdown = t.checked; w.dirty = {}; }
        else if (k === "names") { w.names = t.checked; w.dirty = {}; }
        else if (k === "linkmode") lsSet(WA_MODE_KEY, t.checked ? "link" : "paste");
        state.open.wa = true; render(); return;
      }
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
      if (t.dataset.impsrvc) { const k = t.dataset.impsrvc, o = state.imp.out, f = o && (o.filters || []).find((x) => x.name === k); let cur = Array.isArray(state.imp.srv[k]) ? state.imp.srv[k].slice() : (f && f.value ? f.value.slice() : []); const v = String(t.value), at = cur.indexOf(v); if (t.checked && at < 0) cur.push(v); else if (!t.checked && at >= 0) cur.splice(at, 1); state.imp.srv[k] = cur; render(); return; }
      if (t.dataset.impsrv) { state.imp.srv[t.dataset.impsrv] = t.value; return; }
      if (t.dataset.imp === "pages") { const c = state.imp, v = t.value, at = c.pages.indexOf(v); if (t.checked && at < 0) c.pages.push(v); else if (!t.checked && at >= 0 && c.pages.length > 1) c.pages.splice(at, 1); c.page = c.pages[0]; c.srv = {}; render(); return; }
      if (t.dataset.imp === "view") { const c = state.imp; if (c.outs[t.value]) { c.view = t.value; c.out = c.outs[t.value]; c.course = ""; } render(); return; }
      if (t.id === "cc-img-files") {
        const files = [...(t.files || [])].filter((f) => /^image\//.test(f.type));
        if (!files.length) return;
        const add = [];
        for (const f of files) { try { add.push(await App.centerSign.prepare(f)); } catch (e) { state.resultError = e.message; } }
        state.img.files.push(...add); t.value = ""; return render();
      }
      if (t.dataset.img === "speed") { state.img.fast = t.value === "fast"; return; }
      if (t.id === "cc-pledge-file") {
        const f = (t.files || [])[0]; if (!f) return;
        try { await pledgeFromFile(f); state.resultError = ""; } catch (e) { state.resultError = "تعذّرت قراءة الملف: " + (e.message || e); }
        t.value = ""; return render();
      }
      if (t.dataset.gaps) {
        const k = t.dataset.gaps, c = state.gaps;
        if (k === "status") { c.status = t.value; c.out = null; }
        else if (k.startsWith("f:")) { const set = new Set(gapSelected()); if (t.checked) set.add(k.slice(2)); else set.delete(k.slice(2)); c.fields = [...set]; }
        return render();
      }
      if (t.dataset.mon) { const k = t.dataset.mon; if (k === "thr") state.att.thr = Number(t.value) || 3; else if (k === "month") { state.monthly.month = t.value; state.monthly.out = null; } else state.monthly[k] = !!t.checked; return render(); }
      if (t.dataset.pledge === "status") { state.pledge.status = t.value; state.pledge.students = null; return render(); }
      if (t.dataset.pl) {
        const k = t.dataset.pl, o = state.pledge.opts;
        o[k] = t.type === "checkbox" ? !!t.checked : t.value; pledgeSave();
        if (k === "genderSplit" && t.checked) pledgeFillGender();
        if (k === "prefixMode" || k === "split" || t.type === "checkbox" || k === "perPage" || k === "preamble" || k === "title" || k === "chairStart") render();
        return;
      }
      if (t.dataset.grad) { const k = t.dataset.grad; state.grad[k] = t.type === "checkbox" ? !!t.checked : (k === "from" || k === "to" ? t.value : t.value); return render(); }
      if (t.dataset.morning === "mis") { state.morning.mis = !!t.checked; return render(); }
      if (t.id === "cc-xl-file") {
        const f = (t.files || [])[0]; if (!f) return;
        try {
          const wb = await App.centerXl.readWorkbook(f), c = state.xl;
          if (!wb.sheets.length) throw new Error("الملف فارغ.");
          c.sheets = wb.sheets; c.sheet = 0; c.name = f.name; c.map = App.centerXl.detect(wb.sheets[0].heads, wb.sheets[0].rows); c.out = null; state.resultError = "";
        } catch (e) { state.resultError = "تعذّرت قراءة الملف: " + (e.message || e); }
        t.value = ""; return render();
      }
      if (t.dataset.xl) {
        const c = state.xl, k = t.dataset.xl;
        if (k === "sheet") { c.sheet = Number(t.value) || 0; const sh = xlSheet(); c.map = App.centerXl.detect(sh.heads, sh.rows); c.out = null; }
        else if (k === "status") c.status = t.value;
        else if (k.startsWith("map-")) c.map[k.slice(4)] = Number(t.value);
        return render();
      }
      if (t.dataset.enr === "auto") { state.enrichAuto = !!t.checked; try { localStorage.setItem("tamkeen:cc-enrich-auto", t.checked ? "1" : "0"); } catch (e) { /* خاص */ } return render(); }
      if (t.dataset.wr) { const k = t.dataset.wr; state.wr[k] = t.type === "checkbox" ? !!t.checked : t.value; return k === "text" || k === "group" ? null : render(); }
      if (t.id === "cc-wr-file" && t.files && t.files[0]) { const f = t.files[0]; wrReadEdit(f).then((items) => { state.wr.edit = items; state.wr.editFile = f.name; state.resultError = ""; if (!items.length) ui.toast("لا صفوف فيها قيم لحقول معروفة"); render(); }).catch((e) => { state.resultError = e.message || String(e); render(); }); return; }
      if (t.dataset.tblTrack) { const st = tblSt(t.dataset.tblTrack); st.track = t.value; st.page = 0; return tblRefresh(t.dataset.tblTrack); }
      if (t.dataset.attCmp != null) { state.att.cmpWith = t.value; return render(); }
      if (t.dataset.attTrack) { state.att.trackFilter = t.value; const st = tblSt("att-0"); st.page = 0; return render(); }
      if (t.dataset.tblSel) { const set = selOf(t.dataset.tblSel); if (t.checked) set.add(t.value); else set.delete(t.value); return selSync(t.dataset.tblSel); }
      if (t.dataset.tblAll) { const k = t.dataset.tblAll, set = selOf(k), d = tblData[k]; if (d && d.sel != null) tblRows(k).forEach((row) => { const v = cellStr(row[d.sel]); if (t.checked) set.add(v); else set.delete(v); }); tblRefresh(k); return selSync(k); }
      if (t.id === "cc-enrich-file") {
        const f = (t.files || [])[0]; if (!f) return;
        state.enrichErr = "";
        try {
          if (!/\.xlsx$/i.test(f.name)) throw new Error("الملف ليس بصيغة .xlsx. استعمل ملف «تصدير Excel» كما نزل من نظام المركز.");
          state.enrich = await enrichLoad(f);
          if (state.results) state.results = Object.assign({}, state.results, { results: state.results.results.map(enrichResult) });
          if (state.gaps.out && !state.gaps.out.file) state.gaps.out = Object.assign({}, state.gaps.out);
          ui.toast("حُمّل ملف التصدير: " + ui.fmt(state.enrich.n) + " طالباً");
        } catch (e) { state.enrich = null; state.enrichErr = "تعذّرت قراءة الملف «" + f.name + "»: " + (e.message || e); ui.toast("تعذّرت قراءة ملف التصدير"); }
        t.value = ""; return render();
      }
      if (t.id === "cc-sig-xl") {
        const f = (t.files || [])[0]; if (!f) return;
        state.sig.xlErr = "";
        try {
          if (/\.xls$/i.test(f.name)) throw new Error("الملف بصيغة .xls القديمة. افتحه في Excel واحفظه باسم جديد بصيغة .xlsx (Excel Workbook) ثم ارفعه.");
          if (!/\.xlsx$/i.test(f.name)) throw new Error("الملف ليس بصيغة .xlsx. المدعوم: ملف Excel بامتداد .xlsx فقط (للجداول: احفظه من Excel بهذه الصيغة).");
          if (typeof ExcelJS === "undefined") throw new Error("مكتبة قراءة Excel لم تُحمَّل بعد. حدّث الصفحة (Ctrl+F5) وأعد المحاولة.");
          const wb = await App.centerXl.readWorkbook(f); if (!wb.sheets.length) throw new Error("الملف لا يحوي أي ورقة فيها بيانات.");
          const s0 = wb.sheets[0], d = App.centerXl.detect(s0.heads, s0.rows);
          state.sig.xl = { name: f.name, size: f.size, sheets: wb.sheets, sheet: 0, map: { name: d.name, id: d.id, phone: d.phone, sign: -1, form: sigXlFormCol(s0.heads), track: sigXlTrackCol(s0.heads) } };
        } catch (e) { state.sig.xl = null; state.sig.xlErr = "تعذّرت قراءة الملف «" + f.name + "»: " + (e.message || e); ui.toast("تعذّرت قراءة ملف Excel"); }
        t.value = ""; return render();
      }
      if (t.dataset.sigxl) {
        const x = state.sig.xl, k = t.dataset.sigxl; if (!x) return;
        if (k === "sheet") { x.sheet = Number(t.value) || 0; const s = x.sheets[x.sheet], d = App.centerXl.detect(s.heads, s.rows); x.map = { name: d.name, id: d.id, phone: d.phone, sign: -1, form: sigXlFormCol(s.heads), track: sigXlTrackCol(s.heads) }; }
        else x.map[k] = Number(t.value);
        return render();
      }
      if (t.id === "cc-sig-files") {
        const files = [...(t.files || [])].filter((f) => /^image\//.test(f.type));
        if (!files.length) return;
        state.progress = "";
        const add = [];
        for (const f of files) { try { const im = await App.centerSign.prepare(f); im.key = sigFileKey(im); add.push(im); } catch (e) { state.resultError = e.message; } }
        state.sig.files.push(...add); t.value = ""; return render();
      }
      if (t.dataset.sig === "batch") { state.sig.batch = Number(t.value) || 1; try { localStorage.setItem("tamkeen:sig-batch", String(state.sig.batch)); } catch (e) { /* */ } return; }
      if (t.dataset.sig === "speed") { state.sig.fast = t.value === "fast"; try { localStorage.setItem("tamkeen:sig-fast", state.sig.fast ? "1" : ""); } catch (e) { /* */ } return; }
      if (t.dataset.sig === "status") { state.sig.status = t.value; return render(); }
      if (t.dataset.sigwa === "head") { try { localStorage.setItem(SIG_WA_HEAD_KEY, t.value); } catch (e) { /* */ } return render(); }
      if (t.dataset.sigwa === "detail") { try { localStorage.setItem(SIG_WA_DETAIL_KEY, t.checked ? "1" : "0"); } catch (e) { /* */ } return render(); }
      if (t.dataset.sig === "form") { state.sig.formName = t.value; return; }
      if (t.dataset.sigFname !== undefined) { sigRenameForm(t.dataset.sigFname, t.value); sigSaveSoon(); return render(); }
      if (t.dataset.sigForm !== undefined) { const r = state.sig.rows[Number(t.dataset.sigForm)]; if (r) r.form = clean(t.value); sigSaveSoon(); return render(); }
      if (t.dataset.sigName !== undefined) { const r = state.sig.rows[Number(t.dataset.sigName)]; if (r) r.name = t.value; sigSaveSoon(); return; }
      if (t.dataset.sigNid !== undefined) { const r = state.sig.rows[Number(t.dataset.sigNid)]; if (r) r.nid = t.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""); sigSaveSoon(); return; }
      if (t.dataset.sigPhone !== undefined) { const r = state.sig.rows[Number(t.dataset.sigPhone)]; if (r) r.phone = t.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""); sigSaveSoon(); return; }
      if (t.dataset.sigSigned !== undefined) { const r = state.sig.rows[Number(t.dataset.sigSigned)]; if (r) { r.signed = !!t.checked; } return render(); }
      if (t.dataset.sigAssign !== undefined) { const k = t.value, fid = t.dataset.sigAssign; if (k) { state.sig.manual[(t.dataset.form || "") + "|" + k] = fid; const f = (state.sig.rows || []).find((r) => r.id === fid), rg = (state.sig.reg || []).find((r) => r.key === k); if (f && rg) sigLearnAdd(f.name, rg); } return render(); }
      if (t.dataset.att) { const k = t.dataset.att; state.att[k] = t.type === "checkbox" ? !!t.checked : (k === "thr" || k === "max" ? Number(t.value) || 0 : t.value); if (t.type === "checkbox" || k === "thr") render(); return; }
      if (t.dataset.sc) { scopeSet(t.dataset.sc, t.value, t.checked); render(); return; }
      if (t.hasAttribute("data-gf")) { const v = String(t.value), at = state.groups.indexOf(v); if (t.checked && at < 0) state.groups.push(v); else if (!t.checked && at >= 0) state.groups.splice(at, 1); scopeSave(); render(); return; }
      if (t.dataset.imp === "respThr") { state.imp.respThr = Math.max(0, Math.min(100, Number(t.value) || 0)); render(); return; }
      if (t.dataset.imp === "hideZero") { state.imp.hideZero = !!t.checked; render(); return; }
      if (t.dataset.imp === "tracks" || t.dataset.imp === "stages") { const c = state.imp, k = t.dataset.imp, v = String(t.value), at = c[k].indexOf(v); if (t.checked && at < 0) c[k].push(v); else if (!t.checked && at >= 0) c[k].splice(at, 1); render(); return; }
      if (t.dataset.imp) { state.imp[t.dataset.imp] = t.value; render(); return; }
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

  /* صيغة التقرير الرسمي للنافذة العامة: النتيجة الظاهرة في «استبيانات وتعهدات» فقط */
  const missingReportFor = (contact, opts) => { const o = state.mis.out; return o ? waMissingReport(o, contact || null, opts) : ""; };
  sigLoad();   // جلسة التوقيعات المحفوظة تُستعاد عند فتح الأداة
  App.centerCmd = { allowed: centerAllowed, renderDash, searchIndex: () => centerSearchIndex(), openMode: (k) => openMode(k), _scope: { save: scopeSave, load: scopeLoad }, _monthly: { range: monthlyRange, compose: monthlyCompose },
    _gaps: { stats: gapStats, fields: gapFieldList, col: gapCol, enrichResult, blank: isBlankCell },
    _extras: { apply: applyExtras, seen: extraSeen },
    _wr: { readEdit: wrReadEdit, cmd: wrCommand, agentWrite: () => agentWrite() },
    _att: { sel: () => selOf("att-0"), blocks: () => cancelBlocks(), log: () => state.cancelLog, hist: () => state.attHist, extLoad, kvPut, histKeys: [LOG_K, HIST_K] },
    _snap: { get: () => snapData, load: snapLoad, clear: snapClear, flush: () => { snapRefs = []; snapMaybeSave(); } },
    _sig: { compute: (f) => sigCompute(f), unknownAll: sigUnknownAll, retrackPlan: sigRetrackPlan, trackOf: sigTrackOf, candScore: sigCandScore, digitQueries: sigDigitQueries, learn: { get: sigLearnGet, add: sigLearnAdd, block: sigLearnBlock, clear: sigLearnClear }, save: sigSaveNow, load: sigLoad, clear: sigClear, key: sigFileKey, forms: sigForms, sheets: sigSheets }, pledgeBlocks: (m) => pledgeBlocks(m), missingReport: missingReportFor, tableRows: (k) => (tblData[k] ? { heads: tblData[k].heads, rows: tblRows(k) } : null), init, render, state, buildRegister, toOption, execute: executeCommand, localIntent, expand: expandResult, fmtSheet };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
