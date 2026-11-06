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
    sel: { tracks: [], stages: [], status: "", group_status: "", details: false }, // «تقارير جاهزة»
    labels: [],          // عنوان كل نتيجة في الدفعة الأخيرة
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

  /* يحوّل الاختيار إلى أوامر: دورة لكل (مسار × مرحلة) حين تُختار مراحل، وإلا أمر لكل مسار */
  function buildSelection() {
    const s = state.sel;
    const common = {};
    if (s.status) common.status = s.status;
    if (s.group_status) common.group_status = s.group_status;
    const extra = [s.status && optLabel("status", s.status), s.group_status && optLabel("group_status", s.group_status)].filter(Boolean).join(" · ");
    const mk = (params, label) => ({
      command: Object.assign({ type: "list", label, params: Object.assign({}, params, common) }, s.details ? { details: true } : {}),
      label: label + (extra ? " — " + extra : ""),
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

  function scriptsView() {
    const s = state.sel;
    const chk = (kind, v, text, on) => `<label class="cc-chk"><input type="checkbox" data-sel="${kind}" value="${esc(v)}" ${on ? "checked" : ""}> <span>${esc(text)}</span></label>`;
    const sel = (name) => `<label class="field"><span>${esc(filterField(name).label || name)}</span><select data-sel="${name}">${filterField(name).options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === s[name] ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>`;
    let n = "";
    try { n = buildSelection().length; } catch (e) { n = 0; }
    return `<div class="conv-grade-note cc-scripts" id="cc-scripts"><b class="conv-label">تقارير جاهزة — اختر ثم نفّذ</b>
      <p class="conv-hint">اترك أي قائمة دون اختيار لتشمل الكل. يُنفَّذ أمر قراءة لكل (مسار أو مرحلة) تختارها، ولا يُكتب شيء في نظام المركز.</p>
      <div class="cc-pick"><b>المسارات</b><div class="cc-chips">${trackOpts().map((o) => chk("tracks", o.v, o.t.replace(/^مسار\s*/, ""), s.tracks.includes(String(o.v)))).join("")}</div></div>
      <div class="cc-pick"><b>المراحل</b><div class="cc-chips">${STAGES.map((g) => chk("stages", g.k, g.t, s.stages.includes(g.k))).join("")}</div></div>
      <div class="cc-pick cc-two">${sel("status")}${sel("group_status")}</div>
      <div class="cc-pick">${chk("details", "1", "كل بيانات الطالب (الجنس، الميلاد، العنوان…) — أبطأ، حتى 400 طالب لكل أمر", s.details)}</div>
      <div class="cc-pick cc-cache">${state.cache
        ? `<span class="conv-hint">⚡ البيانات محمّلة: ${ui.fmt(state.cache.items.reduce((n, it) => n + it.rows.length, 0))} طالباً${state.cache.details ? " ببياناتهم الكاملة" : ""} (${state.cache.at.toLocaleTimeString("ar")}) — التقارير تظهر فوراً. </span><button type="button" class="conv-link" data-cc="preload" ${state.busy ? "disabled" : ""}>تحديث</button> <button type="button" class="conv-link" data-cc="drop-cache">مسح الذاكرة</button>`
        : `<button type="button" class="btn secondary small" data-cc="preload" ${state.busy ? "disabled" : ""}>⚡ حمّل كل البيانات مرة واحدة (اختياري)</button> <span class="conv-hint">تُحفظ في هذه الصفحة فقط فتصير التقارير فورية. تُحمَّل «كل بيانات الطالب» إن فعّلت خيارها.</span>`}</div>
      ${state.fallbackNote ? `<p class="conv-error" role="status">نُفِّذ من الموقع لا من الذاكرة — ${esc(state.fallbackNote)}</p>` : ""}
      <div class="btn-row"><button type="button" class="btn navy" data-cc="run-selection" ${state.busy || !n ? "disabled" : ""}>نفّذ التقرير${n > 1 ? ` (${ui.fmt(n)} أوامر)` : ""}</button>
        <button type="button" class="conv-link" data-cc="clear-selection">مسح الاختيار</button></div></div>`;
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
    if (p && p.type === "register-needed") preview = `<p class="conv-hint">${esc(p.message)}</p>`;
    else if (p && p.error) preview = `<p class="conv-error" role="status">${esc(p.error)}</p>${state.needsAiKey ? '<button type="button" class="btn secondary small" data-cc="ai-settings">إعداد الذكاء الاصطناعي</button>' : ""}`;
    const status = state.agentStatus;
    const statusText = state.thinking ? "أحلل صياغة طلبك…" : state.busy ? (state.progress || "الوكيل ينفّذ طلبك الآن…") : status ? status.message : "جارٍ الاتصال بالوكيل المحلي…";
    const statusClass = state.thinking || state.busy || (status && status.loggedIn) ? "conv-hint" : "conv-error";
    return `<div class="conv-grade-note cc-assistant"><b class="conv-label">اكتب طلبك بالعربية</b>
      <p id="cc-status" class="${statusClass}" role="status">${esc(statusText)}</p>
      <label class="field"><span>اكتبها بطريقتك، مثلاً: «دورلي على أحمد» أو «هاتلي المتخرجين بمسار التسويق»</span>
        <textarea id="cc-request" rows="3" placeholder="ماذا تريد من الوكيل؟">${esc(state.requestText)}</textarea></label>
      <p class="conv-hint">يحلّل الطلب مزوّد الذكاء الاصطناعي المحدد في إعداداتك. يحاول الوكيل حجب هدف البحث والأرقام قبل الإرسال؛ لا يرسل نتائج النظام أو ملف Excel.</p>
      <div class="btn-row"><button type="button" class="btn navy" data-cc="interpret" ${state.busy || state.thinking ? "disabled" : ""}>${state.thinking ? "جارٍ الفهم…" : "نفّذ الأمر"}</button></div>
      <div data-cc-preview>${preview}</div>${state.resultError ? `<p class="conv-error" role="alert">${esc(state.resultError)}</p>` : ""}</div>`;
  }

  /* خطة التسجيل القادمة من الوكيل: تُراجَع هنا ولا يُكتب شيء قبل «نفّذ» */
  function planView() {
    const p = state.plan;
    if (!p) return "";
    const L = { create: "سيُسجَّل", exists: "موجود أصلاً — سيُتجاوز", invalid: "غير صالح — لن يُرسل" };
    return `<div class="conv-grade-note cc-plan"><b class="conv-label">معاينة قبل الكتابة في نظام المركز</b>
      <p class="conv-hint">سيُسجَّل <b>${ui.fmt(p.create)}</b> · مسجّل أصلاً ${ui.fmt(p.exists)} · غير صالح ${ui.fmt(p.invalid)} — من ${ui.fmt(p.total)}.</p>
      <div class="cc-scroll"><table class="cc-table"><tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.nid)}</td><td>${esc(L[r.state] || r.state)}${r.why ? " — " + esc(r.why) : ""}</td></tr>`).join("")}</tbody></table></div>
      <div class="btn-row"><button type="button" class="btn navy" data-cc="plan-ok" ${p.create ? "" : "disabled"}>نفّذ تسجيل ${ui.fmt(p.create)} طالباً</button>
        <button type="button" class="conv-link" data-cc="plan-no">إلغاء</button></div></div>`;
  }

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
      const dnote = (d) => d && d.error ? `<p class="conv-error">${esc(d.error)}</p>` : d ? `<p class="conv-hint">بيانات كاملة لـ${ui.fmt(d.read)} من ${ui.fmt(d.of)}${d.capped ? " (الحد الأقصى للقراءة الكاملة؛ قسّم الطلب)" : ""}.</p>` : "";
      if (r.type === "lookup") {
        return `<div class="conv-grade-note"><b>استعلام</b>${r.items.map((it) => `<p class="conv-hint"><b>${esc(it.q)}</b> — ${it.count ? ui.fmt(it.count) + " نتيجة" : "لا نتيجة"}</p>${dnote(it.details)}${it.count ? tbl(it.heads, it.rows.map((x) => x.cells)) : ""}`).join("")}</div>`;
      }
      const gi = groupCol(r);
      const rows = visibleRows(r);
      const gsel = gi < 0 ? "" : `<label class="field cc-group"><span>المجموعة</span><select data-sel="groupFilter"><option value="">كل المجموعات</option>${groupValues(r, gi).map((g) => `<option value="${esc(g)}" ${g === state.groupFilter ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>`;
      return `<div class="conv-grade-note"><b>${esc(state.labels[i] || "قائمة الطلاب")}</b> <span class="conv-hint">${ui.fmt(rows.length)}${rows.length !== r.rows.length ? " من " + ui.fmt(r.rows.length) : ""} صفاً</span>${dnote(r.details)}${gsel}
        ${tbl(r.heads, rows.slice(0, 100).map((x) => x.cells))}
        <div class="btn-row"><button type="button" class="conv-link" data-cc="export-list" data-i="${i}">تنزيل ${rows.length > 100 ? "كل الصفوف " : ""}Excel</button></div></div>`;
    }).join("") + (res.results.filter((r) => r.type === "list").length > 1 ? `<div class="btn-row"><button type="button" class="btn secondary" data-cc="export-all">تنزيل الكل في ملف واحد (ورقة لكل أمر)</button></div>` : "");
  }

  /* عمود «المجموعة» إن وُجد في جدول النظام: يتيح تصفية العرض والتنزيل بمجموعة */
  const groupCol = (r) => (r.heads || []).findIndex((h) => /مجموع/.test(h));
  const groupValues = (r, gi) => [...new Set(r.rows.map((x) => clean(x.cells[gi])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  function visibleRows(r) {
    const gi = groupCol(r);
    return gi < 0 || !state.groupFilter ? r.rows : r.rows.filter((x) => clean(x.cells[gi]) === state.groupFilter);
  }

  function render() {
    const box = $("cc-body");
    if (!box) return;
    if (!SCHEMA()) { box.innerHTML = '<p class="conv-error">مخطط نظام المركز غير محمَّل.</p>'; return; }
    const adding = state.adding === "register" ? registerBuilder() : "";
    box.innerHTML = `
      <div class="cc-step"><span class="cv-step-tag">١</span> <b>ما الذي تريد من الوكيل أن يفعله؟</b></div>
      ${scriptsView()}
      ${assistantView()}
      ${planView()}
      ${adding}
      ${App.centerAgent && App.centerAgent.isReady()
        ? '<p class="conv-hint">تعمل الأوامر في متصفحك عبر إضافة «وكيل تمكين». سجّل دخولك في نظام المركز مرة واحدة؛ والبحث والقوائم تُنفَّذ مباشرة، أما التسجيل فتراجع معاينته هنا وتوافق قبل أن يُكتب شيء.</p>'
        : '<p class="conv-hint">تعمل الجلسة في نافذة Edge المحلية. سجّل الدخول فيها مرة واحدة؛ بعدها ينفّذ الوكيل البحث والقوائم والتسجيل ويعرض النتيجة هنا. أو ثبّت إضافة «وكيل تمكين» في Chrome لتعمل دون خادم محلي.</p>'}
      <div class="cc-step"><span class="cv-step-tag">٢</span> <b>النتيجة</b></div>
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
      el.textContent = state.thinking ? "أحلل صياغة طلبك…" : state.busy ? (state.progress || "الوكيل ينفّذ طلبك الآن…") : state.agentStatus.message;
      el.className = state.thinking || state.busy || state.agentStatus.loggedIn ? "conv-hint" : "conv-error";
    }
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
    return results;
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
      results.forEach((r, k) => { if (r && r.type === "list") items.push({ trackId: String(tracks[k].v), heads: r.heads, rows: r.rows, details: r.details }); });
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
      const i = col(/دور|مرحل/);
      if (i < 0 || !course) return lack("الدورة/المرحلة");
      tests.push((cells) => norm(cells[i]).includes(norm(course.t)));
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
        if (tests.every((f) => f(cells))) rows.push({ cells });
      }
    }
    return { type: "list", heads, rows };
  }

  const executeCommand = (command) => executeBatch([command], []);

  /* ينفّذ أمراً أو عدة أوامر بالتتابع. labels: عنوان كل نتيجة (اختياري) */
  async function executeBatch(commands, labels) {
    state.busy = true; state.autoRunRegister = false; state.resultError = ""; state.results = null; state.adding = ""; state.proposal = null;
    state.progress = ""; state.plan = null; state.planResolve = null; state.labels = labels || []; state.groupFilter = "";
    render(); refreshStatus();
    try {
      const results = await runCommands(commands);
      if (!results.length) throw new Error("لم تصل نتيجة من الوكيل.");
      if (commands.length === 1 && results[0].error) throw new Error(results[0].error);
      state.results = { results };
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
          return exportBook((state.labels[i] || "قائمة الطلاب").replace(/[\\/:*?"<>|]/g, " ").slice(0, 80) + ".xlsx", r.heads, visibleRows(r).map((x) => x.cells));
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
            ws.addRow(r.heads); ws.getRow(1).font = { bold: true };
            visibleRows(r).forEach((x) => ws.addRow(x.cells));
            ws.columns.forEach((c) => { c.width = 22; });
          });
          return ui.download("تقرير المركز.xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        } else if (act === "run-selection") {
          const plan = buildSelection();
          state.fallbackNote = "";
          const local = [];
          if (state.cache) for (const x of plan) { const r = localList(x); if (!r) { state.fallbackNote = cacheWhy; break; } local.push(r); }
          if (local.length && local.length === plan.length) {
            state.resultError = ""; state.groupFilter = ""; state.labels = plan.map((x) => x.label + " ⚡");
            state.results = { results: local };
            render(); return;
          }
          return executeBatch(plan.map((p) => p.command), plan.map((p) => p.label));
        } else if (act === "preload") { return preloadAll();
        } else if (act === "drop-cache") { state.cache = null;
        } else if (act === "clear-selection") {
          state.sel = { tracks: [], stages: [], status: "", group_status: "", details: false };
        }
        render();
      } catch (err) { ui.toast(err.message); }
    });

    box.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.dataset.sel) {
        const k = t.dataset.sel;
        if (k === "groupFilter") { state.groupFilter = t.value; render(); return; }
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

  App.centerCmd = { init, render, state, buildRegister, toOption, execute: executeCommand, localIntent };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
