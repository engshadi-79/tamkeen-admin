/* واجهة «تحويل ملف حسب قالب»: قالب Excel أو Word + ملف بيانات Excel ← ملف مطابق للقالب */
(function (App) {
  const { ui } = App;
  const core = () => App.converterCore;
  const store = () => App.converterStore;
  const $ = (id) => document.getElementById(id);

  const WEEKDAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const WEEKDAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // السبت أولاً

  const state = {
    mode: "upload",
    savedTemplates: [],
    mg: { files: [], merged: null }, // الخطوة ①: ملفات الدمج ونتيجته
    qx: null,                        // الاستخراج السريع: ملف وحقوله المختارة
    fx: { sys: null, mine: [], map: {}, showAll: false, cur: "", judge: true },  // إكمال الناقص من نظام المركز
    mergedData: null,                // الملف المدموج المعتمد كملف بيانات
    selectedSavedId: "",
    extraSavedIds: [], // قوالب محفوظة إضافية: يُولَّد ملف لكل قالب من نفس البيانات
    parsed: null, // { templateHeaders, dataHeaders, dataRows, truncated, templateBuffer, templateIsDocx, templateName, savedId }
    mapping: {},
    constants: {}, // قيمة ثابتة لكل حقل لا يوجد له عمود في ملف البيانات
    missingOpen: true,  // الحقول التي تُكتب يدوياً تظهر مفتوحة عند التحليل
    outputFormat: "xlsx",
    groupBy1: "",
    groupBy2: "",
    autoNumberHeader: "",
    sortRowsBy: "",
    fitGroupToOnePage: false,
    datesEnabled: false,
    datesStart: "",
    datesEnd: "",
    datesWeekdays: [],
    groupWeekdays: {},
    busy: false,
  };

  const esc = ui.esc;
  const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;

  function librariesReady() {
    return typeof window.ExcelJS !== "undefined" && typeof window.JSZip !== "undefined";
  }

  function setError(message) {
    $("conv-error").textContent = message || "";
    $("conv-error").hidden = !message;
  }

  const selectedSaved = () => state.savedTemplates.find((t) => t.id === state.selectedSavedId);

  /* ===== القسم العلوي: مصدر القالب وملف البيانات ===== */
  function renderSource() {
    document.querySelectorAll("[data-conv-mode]").forEach((b) => b.classList.toggle("active", b.dataset.convMode === state.mode));
    $("conv-upload-box").hidden = state.mode !== "upload";
    $("conv-saved-box").hidden = state.mode !== "saved";
    $("conv-save-area").hidden = state.mode !== "upload";

    const hasSaved = state.savedTemplates.length > 0;
    if (hasSaved && !selectedSaved()) state.selectedSavedId = state.savedTemplates[0].id;
    $("conv-saved-empty").hidden = hasSaved;
    $("conv-saved-row").hidden = !hasSaved;
    $("conv-saved-select").innerHTML = state.savedTemplates
      .map((t) => opt(t.id, `${t.name} (${t.format === "docx" ? "Word" : "Excel"})`, t.id === state.selectedSavedId))
      .join("");
    renderExtraTemplates();
  }

  /* قوالب إضافية: نفس ملف البيانات يُطبَّق على كل قالب مختار ويخرج ملف لكل واحد */
  function renderExtraTemplates() {
    const others = state.savedTemplates.filter((t) => t.id !== state.selectedSavedId);
    $("conv-multi-box").hidden = state.mode !== "saved" || others.length === 0;
    state.extraSavedIds = state.extraSavedIds.filter((id) => others.some((t) => t.id === id));
    $("conv-multi-list").innerHTML = others.map((t) => `
      <label class="conv-check">
        <input type="checkbox" data-extra-tpl="${esc(t.id)}" ${state.extraSavedIds.includes(t.id) ? "checked" : ""}>
        ${esc(t.name)} <span class="reg-kind">(${t.format === "docx" ? "Word" : "Excel"})</span>
      </label>`).join("");
    $("conv-multi-count").textContent = state.extraSavedIds.length
      ? `سيخرج ${ui.fmt(state.extraSavedIds.length + 1)} ملف في ملف مضغوط واحد`
      : "";
  }

  async function refreshSaved() {
    try {
      // قوالب جدول الاختبارات لها بطاقتها الخاصة، فلا تظهر في قائمة قوالب التحويل
      state.savedTemplates = (await store().list()).filter((t) => t.kind !== "exam");
    } catch (e) {
      state.savedTemplates = [];
      console.error(e);
    }
    renderSource();
    renderFixed();
    await renderShareStatus();
  }

  /* هل وصلت القوالب إلى الخادم؟ الحالة ظاهرة بدل أن تجري في الخلفية بصمت */
  async function renderShareStatus() {
    const box = $("conv-share");
    if (!box) return;
    const st = await store().status();
    const server = App.cloud && App.cloud.isTrial && App.cloud.isTrial() ? "الخادم التجريبي (Supabase)" : "الخادم الأساسي";
    let text, cls = "";
    if (!st.signedIn && st.waiting) { text = `⚠ على هذا الجهاز ${ui.fmt(st.waiting)} قالباً لم يُرفع، ولن يُرفع قبل تسجيل الدخول.`; cls = "warn"; }
    else if (!st.signedIn) { text = "سجّل الدخول لترى القوالب المشتركة."; }
    else if (st.waiting) { text = `⏳ ${ui.fmt(st.waiting)} قالباً على هذا الجهاز لم يصل ${server} بعد.`; cls = "warn"; }
    else { text = `✓ كل القوالب (${ui.fmt(st.total)}) على ${server}.`; cls = "ok"; }
    if (st.signedIn && st.remoteMissing) text += ` و${ui.fmt(st.remoteMissing)} قالباً بانتظار أن يرفعه جهاز من حفظه.`;
    if (st.signedIn && st.orphans) {
      const note = `⚠ على هذا الجهاز ${ui.fmt(st.orphans)} قالباً حُذف من القائمة المشتركة، ويمكن إعادة مشاركته.`;
      text = st.waiting ? `${text} ${note}` : note;
      cls = "warn";
    }
    $("conv-share-again").hidden = !(st.signedIn && st.orphans);
    $("conv-share-text").textContent = text;
    box.className = `conv-share ${cls}`;
    $("conv-share-now").hidden = !st.waiting;
  }

  async function shareNow() {
    const btn = $("conv-share-now");
    btn.disabled = true;
    btn.textContent = "…جارٍ الرفع";
    try {
      const r = await store().reconcile();
      if (r.skipped) ui.toast(r.skipped);
      else if (r.errors.length) ui.toast(`تعذّر رفع بعض القوالب: ${r.errors[0]}`);
      else ui.toast(`رُفع ${ui.fmt(r.uploaded)} قالباً إلى الخادم`);
      if (App.shared) await App.shared.sync(true);
    } catch (e) { ui.toast(e.message); }
    btn.disabled = false;
    btn.textContent = "☁ رفع الآن";
    await refreshSaved();
  }

  const readFile = (file) => file.arrayBuffer();

  /* ===== التقدير من المعدل: ظاهر وقابل للتغيير بدل أن يجري بصمت =====
     يظهر إن كان في القالب عمود تقدير: من أي عمود يُحسب، وكم صفاً حُسب وكم تعذّر ولماذا. */
  /* عمود العمر: يظهر متى وُجد في القالب حقل «العمر»، أو وُجد عمود ميلاد في البيانات */
  function ageControl() {
    const p = state.parsed;
    const norm = core().normalizeHeader;
    const col = p.templateHeaders.find((h) => /العمر|السن/.test(norm(h)));
    const a = state.age || { from: "", ok: 0, bad: 0 };
    if (!col && !a.from) return "";
    const choices = p.dataHeaders.filter((h) => h !== core().AGE_COLUMN);
    const status = !a.from
      ? `<span class="warn">لم نجد عمود تاريخ ميلاد في بياناتك؛ اختره من القائمة ليُحسب العمر.</span>`
      : `حُسب العمر لـ <b>${ui.fmt(a.ok)}</b> صفاً${a.bad ? `، <span class="warn">وتعذّر في ${ui.fmt(a.bad)} صفاً لأن التاريخ فيها غير مفهوم</span>` : ""}.`;
    return `<div class="conv-grade-note">
      <label><span class="material-symbols-outlined btn-ico">info</span>«${esc(col || core().AGE_COLUMN)}» يُحسب من عمود
        <select data-age-from>${opt("", "— لا تحسبه —", !a.from)}${choices.map((h) => opt(h, h, h === a.from)).join("")}</select></label>
      <div>${status}</div>
      <small>العمر بالسنوات الكاملة حتى تاريخ اليوم. يقبل 1998-05-20 و20/05/1998 وتواريخ Excel.</small>
    </div>`;
  }

  function gradeControl() {
    const p = state.parsed;
    const norm = core().normalizeHeader;
    const col = p.templateHeaders.find((h) => /تقدير/.test(norm(h)));
    if (!col) return "";
    const g = state.grade || { from: "" };
    const choices = p.dataHeaders.filter((h) => h !== core().GRADE_COLUMN);
    const status = !g.from
      ? `<span class="warn">لم نجد عموداً اسمه «المعدل» في بياناتك؛ اختره من القائمة ليُحسب التقدير.</span>`
      : `حُسب التقدير لـ <b>${ui.fmt(g.ok)}</b> صفاً${g.bad ? `، <span class="warn">وتعذّر في ${ui.fmt(g.bad)} صفاً لأن المعدل فيها ليس رقماً (مثل «-» أو «غائب»)</span>` : ""}.${g.fraction ? " المعدل مكتوب كنسبة (0.86) فعومل كـ 86." : ""}${g.ok === 0 && !g.bad ? ` <span class="warn">العمود المختار فارغ.</span>` : ""}`;
    return `<div class="conv-grade-note">
      <label><span class="material-symbols-outlined btn-ico">info</span>«${esc(col)}» يُحسب من عمود
        <select data-grade-from>${opt("", "— لا تحسبه —", !g.from)}${choices.map((h) => opt(h, h, h === g.from)).join("")}</select></label>
      <div>${status}</div>
      <small>السلّم: 90 فأكثر ممتاز، 80–89 جيد جداً، 75–79 جيد، أقل من 75 راسب.</small>
    </div>`;
  }

  /* ===== البيانات الثابتة: تُحفظ مرة وتُعبّأ في كل كشف فيه حقل بالاسم نفسه =====
     القائمة إعداد مشترك (fixedFields) يصل كل المستخدمين. القيم الافتراضية في الكود لا تُحفظ
     إلا عند أول تعديل، حتى لا يكتب جهاز قديم فوق قائمة عدّلها غيره. */
  const DEFAULT_FIXED = [
    { name: "اسم المركز", value: "مركز مسارات التمكين للتدريب والتطوير" },
    { name: "نوع التدريب", value: "دورة" },
  ];
  const fixedFields = () => { const f = (App.store.get() || {}).fixedFields; return Array.isArray(f) ? f : DEFAULT_FIXED; };
  let fixedTimer = null;
  const saveFixed = (list) => {
    App.store.get().fixedFields = list;
    App.store.save();
    clearTimeout(fixedTimer);
    fixedTimer = setTimeout(() => { if (state.parsed) { reapplyFixed(); renderResult(); } }, 500);
  };

  // «نوع التدريب» يطابق «نوع التدريب(دورة - دبلوم)»: تطابق تام أو احتواء لاسمين غير قصيرين
  function sameField(a, b) {
    const n = core().normalizeHeader;
    const x = n(a);
    const y = n(b);
    return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
  }
  const columnEmpty = (col) => !state.parsed.dataRows.some((r) => r[col] != null && String(r[col]).trim() !== "");

  /* حقل يطابق بياناً ثابتاً يأخذ قيمته، إلا إن كان في ملف البيانات عمود مربوط به فيه قيم */
  // قيمة من البيانات الثابتة لا تحلّ محل قيمة كتبها المستخدم بنفسه لهذا الكشف
  function setFixedConstant(key, value) {
    const cur = state.constants[key];
    if (cur != null && cur !== "" && cur !== state.fixedOrigin[key]) return false;
    state.constants[key] = value;
    state.fixedOrigin[key] = value;
    return true;
  }

  function applyFixed(headers, mapping, placeholders) {
    state.fixedOrigin = state.fixedOrigin || {};
    const used = [];
    fixedFields().filter((f) => f && f.name && String(f.value || "").trim()).forEach((f) => {
      const value = String(f.value).trim();
      headers.forEach((h) => {
        if (!sameField(h, f.name)) return;
        if (mapping[h] && !columnEmpty(mapping[h])) return; // بيانات الملف أولى
        mapping[h] = "";
        if (setFixedConstant(h, value)) used.push(f.name);
      });
      (placeholders || []).forEach((ph) => {
        if (!sameField(ph, f.name)) return;
        const col = state.parsed.dataHeaders.find((d) => sameField(d, ph));
        if (col && !columnEmpty(col)) return;
        if (setFixedConstant(ph, value)) used.push(f.name);
      });
    });
    return [...new Set(used)];
  }

  /* إعادة تطبيق البيانات الثابتة على الكشف المحلَّل حالياً: حقل أُضيف أو عُدِّل أو حُذف بعد التحليل.
     ما جاء من القائمة سابقاً يُزال ثم يُطبَّق من جديد، وما غيّره المستخدم بنفسه يبقى. */
  function reapplyFixed() {
    const p = state.parsed;
    if (!p) return;
    state.fixedOrigin = state.fixedOrigin || {};
    Object.keys(state.fixedOrigin).forEach((k) => {
      if (state.constants[k] === state.fixedOrigin[k]) delete state.constants[k];
      delete state.fixedOrigin[k];
    });
    state.fixedUsed = applyFixed(p.templateHeaders, state.mapping, state.placeholders);
    (state.extras || []).forEach((t) => applyFixed(t.headers, t.mapping, []));
  }

  function renderFixed() {
    const box = $("fx-list");
    if (!box) return;
    box.innerHTML = fixedFields().map((f, i) => `<div class="fx-row">
        <input type="text" data-fx-name="${i}" value="${esc(f.name || "")}" placeholder="اسم الحقل كما في القالب">
        <input type="text" data-fx-value="${i}" value="${esc(f.value || "")}" placeholder="القيمة">
        <button type="button" class="act-btn del" data-fx-del="${i}" title="حذف الحقل"><span class="material-symbols-outlined btn-ico">delete</span></button>
      </div>`).join("") || `<p class="conv-hint">لا توجد بيانات ثابتة بعد.</p>`;
  }

  /* ===== اختيار المسارات التي تظهر في الكشف =====
     تصفية الصفوف حسب قيم عمود (عمود المسار افتراضياً). يُحفظ المستبعَد لا المختار، فكل قيمة جديدة تدخل افتراضياً. */
  const FILTER_MAX = 40;
  const filterKey = (v) => (v == null ? "" : String(v).trim());
  const keepRow = (r) => !state.filterCol || !state.filterOut || !state.filterOut.has(filterKey(r[state.filterCol]));

  function filterValues() {
    const counts = new Map();
    state.parsed.dataRows.forEach((r) => { const k = filterKey(r[state.filterCol]); counts.set(k, (counts.get(k) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }

  const filterCountText = () => {
    const total = state.parsed.dataRows.length;
    const kept = state.parsed.dataRows.filter(keepRow).length;
    return kept === total ? `كل الصفوف (${ui.fmt(total)}) في الكشف` : `سيظهر في الكشف ${ui.fmt(kept)} صفاً من ${ui.fmt(total)}`;
  };

  function filterControl() {
    const p = state.parsed;
    const hidden = Object.values(core().TRAINER_COLS).concat(core().TRACK_DATA_HEADERS || [], core().GRADE_COLUMN);
    const cols = p.dataHeaders.filter((h) => !hidden.includes(h));
    let body = "";
    if (state.filterCol) {
      const values = filterValues();
      body = values.length > FILTER_MAX
        ? `<p class="warn">هذا العمود فيه ${ui.fmt(values.length)} قيمة مختلفة؛ اختر عمود المسار.</p>`
        : `<div class="conv-filter-list">${values.map(([v, n]) => `<label class="conv-check">
              <input type="checkbox" data-filter-val="${esc(v)}" ${state.filterOut.has(v) ? "" : "checked"}> ${v ? esc(v) : "<i>(بلا مسار)</i>"} <small>(${ui.fmt(n)})</small>
            </label>`).join("")}</div>
          <div><button type="button" class="conv-link" data-filter-all>تحديد الكل</button> · <button type="button" class="conv-link" data-filter-none>إلغاء الكل</button> — <b id="conv-filter-count">${filterCountText()}</b></div>`;
    }
    return `<div class="conv-grade-note conv-filter">
      <label><span class="material-symbols-outlined btn-ico">adjust</span>المسارات التي تظهر في الكشف — حسب عمود
        <select data-filter-col>${opt("", "— كل الصفوف، بلا تصفية —", !state.filterCol)}${cols.map((h) => opt(h, h, h === state.filterCol)).join("")}</select></label>
      ${body}
    </div>`;
  }

  /* ===== الإعدادات الافتراضية لكل قالب =====
     تُحفظ مرتبطة بأعمدة القالب (لا باسم ملفه)، فتُطبَّق على القالب المحفوظ وعلى نسخة مرفوعة منه من جديد،
     وتُزامَن لكل المستخدمين (إعداد مشترك convDefaults). */
  const templateSig = (headers) => headers.map((h) => core().normalizeHeader(h)).join("|");
  const profiles = () => (App.store.get() || {}).convDefaults || {};
  const currentProfile = () => state.parsed && profiles()[templateSig(state.parsed.templateHeaders)];

  function applyProfile() {
    const p = state.parsed;
    const prof = currentProfile();
    state.profileApplied = false;
    if (!prof) return;
    const col = (name) => (name ? core().resolveDefaultColumn(name, p.dataHeaders) || "" : "");
    const data = { headers: p.dataHeaders, rows: p.dataRows };
    if (prof.gradeFrom !== undefined) {
      const from = col(prof.gradeFrom);
      state.grade = from ? core().addComputedGrade(data, from) : { from: "" };
    }
    if (prof.trainerFrom !== undefined) {
      const v = prof.trainerFrom || "";
      const source = v.startsWith("track:") ? { track: v.slice(6) } : v.startsWith("col:") ? { column: col(v.slice(4)) } : {};
      state.trainers = core().addTrainerColumns(data, tracksList(), source);
      if (prof.trackDataFrom === undefined) {
        state.trackDataSource = source;
        state.trackData = core().addTrackDataColumns(data, tracksList(), source, store().get().trackCodes || []);
      }
    }
    if (prof.trackDataFrom !== undefined) {
      const v = prof.trackDataFrom || "";
      state.trackDataSource = v.startsWith("track:") ? { track: v.slice(6) } : v.startsWith("col:") ? { column: col(v.slice(4)) } : {};
      state.trackData = core().addTrackDataColumns(data, tracksList(), state.trackDataSource, store().get().trackCodes || []);
    }
    const virtual = [core().GRADE_COLUMN].concat(Object.values(core().TRAINER_COLS), core().TRACK_DATA_HEADERS || []);
    Object.keys(prof.mapping || {}).forEach((h) => {
      if (!p.templateHeaders.includes(h)) return;
      const src = prof.mapping[h];
      state.userMappings = state.userMappings || {};
      state.userMappings[h] = !!src && !(core().TRACK_DATA_HEADERS || []).includes(src) && !virtual.slice(0, 1 + Object.values(core().TRAINER_COLS).length).includes(src);
      if (!src) { state.mapping[h] = ""; return; }
      const c = virtual.includes(src) ? (p.dataHeaders.includes(src) ? src : "") : col(src);
      if (c) state.mapping[h] = c; // عمود غير موجود في هذا الملف: يبقى الربط التلقائي
    });
    if (prof.ageFrom !== undefined) {
      const from = col(prof.ageFrom);
      state.age = core().addAgeColumn(data, from || "");
    }
    // ترتيب أعمدة التصدير والمخفي منها: تُستعاد بأسماء الأعمدة الموجودة في هذا الملف
    const known = (list) => (list || []).map((h) => (p.dataHeaders.includes(h) ? h : col(h))).filter(Boolean);
    if (prof.pickOrder) state.pickOrder = known(prof.pickOrder);
    if (prof.pickHidden) state.pickHidden = new Set(known(prof.pickHidden));
    state.groupBy1 = col(prof.groupBy1);
    state.groupBy2 = col(prof.groupBy2);
    if (prof.autoNumberHeader && p.templateHeaders.includes(prof.autoNumberHeader)) state.autoNumberHeader = prof.autoNumberHeader;
    state.sortRowsBy = col(prof.sortRowsBy);
    if (prof.filterCol !== undefined) { state.filterCol = col(prof.filterCol); state.filterOut = new Set(); }
    reapplyFixed();
    state.profileApplied = true;
  }

  function saveProfile() {
    const p = state.parsed;
    const r = state.trainers || {};
    const mapping = {};
    p.templateHeaders.forEach((h) => { mapping[h] = state.mapping[h] || ""; });
    const all = Object.assign({}, profiles());
    all[templateSig(p.templateHeaders)] = {
      mapping,
      gradeFrom: (state.grade || {}).from || "",
      trainerFrom: r.track ? `track:${r.track}` : r.column ? `col:${r.column}` : "",
      trackDataFrom: state.trackDataSource && state.trackDataSource.track ? `track:${state.trackDataSource.track}` : state.trackDataSource && state.trackDataSource.column ? `col:${state.trackDataSource.column}` : "",
      groupBy1: state.groupBy1 || "",
      groupBy2: state.groupBy2 || "",
      autoNumberHeader: state.autoNumberHeader || "",
      sortRowsBy: state.sortRowsBy || "",
      filterCol: state.filterCol || "",
      ageFrom: (state.age || {}).from || "",
      pickOrder: (state.pickOrder || []).slice(),
      pickHidden: [...(state.pickHidden || [])],
      template: p.templateName,
      savedAt: new Date().toISOString(),
      by: ((App.cloud && App.cloud.user()) || {}).name || "",
    };
    App.store.get().convDefaults = all;
    App.store.save();
    state.profileApplied = true;
    renderResult();
    ui.toast("حُفظت الإعدادات كافتراضية لهذا القالب — تُطبَّق تلقائياً في كل مرة ولكل المستخدمين");
  }

  function deleteProfile() {
    if (!confirm("حذف الإعدادات الافتراضية لهذا القالب؟ يعود الربط التلقائي من التحليل القادم.")) return;
    const all = Object.assign({}, profiles());
    delete all[templateSig(state.parsed.templateHeaders)];
    App.store.get().convDefaults = all;
    App.store.save();
    state.profileApplied = false;
    renderResult();
    ui.toast("حُذفت الإعدادات الافتراضية لهذا القالب");
  }

  function profileNote() {
    const prof = currentProfile();
    if (!prof) return "";
    const when = prof.savedAt ? ui.formatDate(String(prof.savedAt).slice(0, 10)) : "";
    return `<p class="conv-grade-note">⚙ طُبِّقت الإعدادات الافتراضية المحفوظة لهذا القالب${prof.by ? ` (${esc(prof.by)}${when ? "، " + esc(when) : ""})` : ""}: الربط، والتجميع، والترقيم، والترتيب، ومصدر التقدير والمدربين. ما تغيّره الآن لهذا الكشف فقط حتى تحفظه. <button type="button" class="conv-link danger" id="conv-profile-delete">حذفها</button></p>`;
  }

  const tracksList = () => ((App.store.get() || {}).tracks || []).filter((t) => t && t.name);

  /* المدربون من صفحة المسارات: يظهر إن كان في القالب عمود أو حقل ترويسة فيه «مدرب» */
  function trainerControl() {
    const p = state.parsed;
    const wants = p.templateHeaders.concat(state.placeholders || []).filter((h) => core().trainerColumnFor(h));
    if (!wants.length) return "";
    const r = state.trainers || {};
    const current = r.track ? `track:${r.track}` : r.column ? `col:${r.column}` : "";
    const tracks = tracksList();
    const cols = p.dataHeaders.filter((h) => !Object.values(core().TRAINER_COLS).includes(h) && !(core().TRACK_DATA_HEADERS || []).includes(h) && h !== core().GRADE_COLUMN);
    const options = opt("", "— لا تضف المدربين —", !current)
      + `<optgroup label="حسب عمود المسار في البيانات">${cols.map((h) => opt(`col:${h}`, h, `col:${h}` === current)).join("")}</optgroup>`
      + `<optgroup label="مسار واحد لكل الصفوف">${tracks.map((t) => opt(`track:${t.id}`, t.name, `track:${t.id}` === current)).join("")}</optgroup>`;
    let status;
    if (!current) {
      status = `<span class="warn">القالب يطلب المدرب (${wants.map(esc).join("، ")})، ولم نجد عموداً اسمه «المسار» في بياناتك؛ اختر العمود أو المسار من القائمة.</span>`;
    } else {
      status = `عُبّئ المدربون لـ <b>${ui.fmt(r.filled)}</b> صفاً${r.trackName ? ` من مسار «${esc(r.trackName)}»` : ""}.`;
      if (r.noTrainers && r.noTrainers.length) status += ` <span class="warn">لم يُحدَّد مدربون بعد لـ: ${r.noTrainers.map(esc).join("، ")} — أضفهم من <a href="#tracks">صفحة المسارات</a>.</span>`;
      if (r.unmatched && r.unmatched.length) status += ` <span class="warn">مسارات في بياناتك ليست في صفحة المسارات: ${r.unmatched.map(esc).join("، ")}.</span>`;
    }
    return `<div class="conv-grade-note">
      <label><span class="material-symbols-outlined btn-ico">person</span>‍🏫 المدربون من صفحة المسارات <select data-trainer-from>${options}</select></label>
      <div>${status}</div>
      <small>«المدرب الأول» و«المدرب الثاني» يأخذ كلٌّ مدرّبه، و«اسم المدرب» يأخذ الاثنين — في الجدول وفي حقول الترويسة مثل {{اسم المدرب}}.</small>
    </div>`;
  }

  /* استكمال الحقول الغائبة من سجل المسار؛ الاختيار الافتراضي هو عمود المسار في ملف البيانات */
  function trackDataControl() {
    const p = state.parsed;
    const wants = p.templateHeaders.concat(state.placeholders || []).filter((h) => core().trackDataFieldFor(h));
    if (!wants.length) return "";
    const r = state.trackData || {};
    const source = state.trackDataSource || (r.column ? { column: r.column } : {});
    const current = source.track ? `track:${source.track}` : source.column ? `col:${source.column}` : "";
    const tracks = tracksList();
    const excluded = Object.values(core().TRAINER_COLS).concat(core().TRACK_DATA_HEADERS || [], core().GRADE_COLUMN);
    const cols = p.dataHeaders.filter((h) => !excluded.includes(h));
    const options = opt("", "— بدون مصدر —", !current)
      + `<optgroup label="تحديد المسار من كل صف">${cols.map((h) => opt(`col:${h}`, h, `col:${h}` === current)).join("")}</optgroup>`
      + `<optgroup label="مسار واحد لكل الصفوف">${tracks.map((t) => opt(`track:${t.id}`, t.name, `track:${t.id}` === current)).join("")}</optgroup>`;
    const status = current
      ? `تُملأ الحقول المرتبطة بالمسار تلقائياً لـ <b>${ui.fmt(r.filled || 0)}</b> صفاً${r.unmatched && r.unmatched.length ? ` <span class="warn">— لم تُطابق هذه القيم: ${r.unmatched.map(esc).join("، ")}</span>` : ""}`
      : `<span class="warn">اختر عمود المسار من ملف البيانات أو مساراً واحداً إذا كان الكشف خاصاً بمسار واحد.</span>`;
    return `<div class="conv-grade-note"><label><span class="material-symbols-outlined btn-ico">explore</span>استكمال البيانات من صفحة المسارات <select data-track-data-from>${options}</select></label><div>${status}</div><small>تُستخدم بيانات المسار للحقول غير المربوطة، مثل الاسم والرمز والنوع وعدد المستفيدين والحضور والساعات. بيانات الأفراد الموجودة في الملف تبقى كما هي.</small></div>`;
  }

  function setTrainerSource(value) {
    const p = state.parsed;
    const source = value.startsWith("track:") ? { track: value.slice(6) } : value.startsWith("col:") ? { column: value.slice(4) } : {};
    state.trainers = core().addTrainerColumns({ headers: p.dataHeaders, rows: p.dataRows }, tracksList(), source);
    const T = Object.values(core().TRAINER_COLS);
    Object.keys(state.mapping).forEach((k) => { if (T.includes(state.mapping[k])) state.mapping[k] = ""; });
    core().preferTrainers(state.mapping, p.templateHeaders, p.dataHeaders);
    (state.extras || []).forEach((t) => {
      Object.keys(t.mapping).forEach((k) => { if (T.includes(t.mapping[k])) t.mapping[k] = ""; });
      core().preferTrainers(t.mapping, t.headers, p.dataHeaders);
    });
    renderResult();
  }

  function setTrackDataSource(value) {
    const p = state.parsed;
    const source = value.startsWith("track:") ? { track: value.slice(6) } : value.startsWith("col:") ? { column: value.slice(4) } : {};
    state.trackDataSource = source;
    state.trackData = core().addTrackDataColumns({ headers: p.dataHeaders, rows: p.dataRows }, tracksList(), source, store().get().trackCodes || []);
    Object.keys(state.trackDataAutoMapped || {}).forEach((k) => { if (state.mapping[k] === state.trackDataAutoMapped[k]) delete state.mapping[k]; });
    core().preferTrackData(state.mapping, p.templateHeaders.filter((h) => !state.userMappings?.[h] && !String(state.constants[h] || "").trim()), p.dataHeaders, p.dataRows, true);
    state.trackDataAutoMapped = Object.fromEntries(p.templateHeaders.filter((h) => core().trackDataFieldFor(h) && state.mapping[h] === core().trackDataFieldFor(h)).map((h) => [h, state.mapping[h]]));
    refreshTrackPlaceholders();
    (state.extras || []).forEach((t) => {
      core().preferTrackData(t.mapping, t.headers, p.dataHeaders, p.dataRows);
    });
    renderResult();
  }

  function refreshTrackPlaceholders() {
    const p = state.parsed;
    if (!p) return;
    const placeholders = state.placeholders || [];
    placeholders.forEach((ph) => {
      if (p.dataHeaders.includes(ph)) return;
      const source = core().trackDataFieldFor(ph);
      if (source && p.dataHeaders.includes(source)) p.dataRows.forEach((row) => { row[ph] = row[source] == null ? "" : row[source]; });
    });
    const norm = core().normalizeHeader;
    const dataNorm = p.dataHeaders.map(norm);
    state.extraFields = placeholders.filter((ph) => {
      const n = norm(ph);
      const source = core().trackDataFieldFor(ph);
      if (source && p.dataHeaders.includes(source) && p.dataRows.some((r) => r[source] != null && String(r[source]).trim())) return false;
      return !dataNorm.some((d) => d === n || d.includes(n) || n.includes(d)) && !p.templateHeaders.some((h) => norm(h) === n) && !/^تاريخ\d+$/.test(ph);
    });
  }

  function setGradeSource(header) {
    const p = state.parsed;
    const G = core().GRADE_COLUMN;
    if (header) {
      state.grade = core().addComputedGrade({ headers: p.dataHeaders, rows: p.dataRows }, header);
      core().preferComputedGrade(state.mapping, p.templateHeaders, p.dataHeaders);
      (state.extras || []).forEach((t) => core().preferComputedGrade(t.mapping, t.headers, p.dataHeaders));
    } else {
      state.grade = { from: "" };
      Object.keys(state.mapping).forEach((k) => { if (state.mapping[k] === G) state.mapping[k] = ""; });
    }
    renderResult();
  }

  /* ملف البيانات: الملف المدموج في الخطوة ① إن اعتُمد، وإلا الملف المختار هنا */
  async function readData(files) {
    if (state.mergedData) {
      // نسخة مستقلة: التحليل يضيف أعمدة محسوبة (التقدير) ولا يُمس المدموج
      return { headers: state.mergedData.headers.slice(), rows: state.mergedData.rows.map((r) => Object.assign({}, r)), truncated: false };
    }
    if (files.length > 1) throw new Error("لدمج أكثر من ملف استخدم الخطوة «① دمج ملفات البيانات» أعلى الصفحة");
    return core().readDataFile(await readFile(files[0]));
  }

  /* ===== إكمال الناقص من نظام المركز =====
     المتصفح لا يسمح لموقع تمكين بقراءة صفحات نظام المركز (سياسة المصدر
     الواحد)، فتُجلب بسكربت يشغّله المستخدم في النظام نفسه، ثم يُرفع ناتجه
     هنا مع ملفه الناقص. المطابقة برقم الهوية، والملء للخانات الفارغة فقط. */
  const digits = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "");
  const NID_COL = /هوي|identity/i;

  async function onFxSystem(fileList) {
    const f = [...fileList][0];
    if (!f) { state.fx.sys = null; renderFill(); return; }
    try {
      const j = JSON.parse(await f.text());
      const rows = Array.isArray(j) ? j : (j.rows || []);
      if (!rows.length) throw new Error("الملف بلا صفوف");
      const cols = [];
      rows.forEach((r) => Object.keys(r).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
      const byNid = new Map();
      rows.forEach((r) => {
        const n = digits(r["رقم الهوية"] || r.nid || r.id);
        if (n && !byNid.has(n)) byNid.set(n, r);
      });
      state.fx.sys = { name: f.name, rows, cols, byNid };
      fxGuess();
    } catch (e) {
      state.fx.sys = null;
      $("fx-body").innerHTML = `<p class="conv-error">تعذّرت قراءة ملف النظام: ${esc(e.message)}</p>`;
      return;
    }
    renderFill();
  }

  /* عدّة ملفات: لكل ملف سجلّه ومخرجه المستقل. الملفات ذات الأعمدة نفسها
     تتشارك ربطاً واحداً، فلا يُعاد الضبط لكل كشف مسار. */
  async function onFxMine(fileList) {
    const files = [...fileList];
    if (!files.length) { state.fx.mine = []; renderFill(); return; }
    $("fx-body").innerHTML = `<p class="conv-hint">…جارٍ قراءة ${ui.fmt(files.length)} ملفاً</p>`;
    const out = [];
    for (const f of files) {
      try {
        const d = await core().readDataFile(await readFile(f));
        out.push({
          name: f.name.replace(/\.xlsx$/i, ""),
          headers: d.headers,
          rows: d.rows,
          nidCol: d.headers.find((h) => NID_COL.test(h)) || "",
          sig: d.headers.join("|"),
        });
      } catch (e) {
        out.push({ name: f.name, error: e.message, headers: [], rows: [], nidCol: "", sig: "" });
      }
    }
    state.fx.mine = out;
    fxGuess();
    renderFill();
  }

  /* مجموعات الملفات بحسب تطابق الأعمدة */
  function fxGroups() {
    const groups = [];
    (state.fx.mine || []).filter((m) => !m.error).forEach((m) => {
      const g = groups.find((x) => x.sig === m.sig);
      if (g) g.files.push(m); else groups.push({ sig: m.sig, headers: m.headers, nidCol: m.nidCol, files: [m] });
    });
    return groups;
  }

  /* ===== ربط أعمدة ملف المستخدم بحقول النظام =====
     الأسماء لا تتطابق حرفياً في الواقع: «اسم المتقدم» عند المستخدم و«الاسم»
     في النظام، و«الجوال 1» و«الجوال». فيُقترح الربط تلقائياً ويبقى تغييره
     بيد المستخدم. */
  const fxNorm = (h) => String(h == null ? "" : h)
    .replace(/[\u064B-\u0652]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/(^|\s)ال/g, "$1").replace(/[\s_\-()[\]./\\]/g, "").trim();

  /* مرادفات شائعة بين كشوف المركز وأسماء النظام */
  const FX_SYN = [
    ["اسم", "اسممتقدم", "اسمطالب", "طالب", "اسمالمستفيد", "مستفيد"],
    ["جوال", "جوال1", "هاتف", "رقمجوال", "موبايل"],
    ["مسار", "برنامج"],
    ["مجموعه", "شعبه"],
    ["حاله", "حالهطلب"],
    ["هويه", "رقمهويه"],
    ["دوره", "مرحله"],
    ["مدرب", "معلم"],
  ];
  const fxGroup = (n) => FX_SYN.findIndex((g) => g.includes(n));

  function fxScore(mineCol, sysCol) {
    const a2 = fxNorm(mineCol), b2 = fxNorm(sysCol);
    if (!a2 || !b2) return 0;
    if (a2 === b2) return 100;
    const ga = fxGroup(a2), gb = fxGroup(b2);
    if (ga >= 0 && ga === gb) return 85;
    // الاحتواء وحده يخدع: «الحالة الاجتماعية» تحتوي «الحالة» وليست هي.
    // يُشترط أن يكون الأقصر جُلّ الأطول، لا جزءاً صغيراً منه.
    const [sh, lo] = a2.length <= b2.length ? [a2, b2] : [b2, a2];
    if (lo.includes(sh) && sh.length / lo.length >= 0.75) return 70;
    return 0;
  }

  /* أفضل حقل من النظام لكل عمود، مرة واحدة عند رفع الملفين */
  function fxGuess() {
    const sys = state.fx.sys;
    if (!sys || !(state.fx.mine || []).length) return;
    state.fx.map = state.fx.map || {};
    fxGroups().forEach((g) => {
      if (state.fx.map[g.sig]) return;         // ربط هذه المجموعة مضبوط سلفاً
      const cand = [];
      g.headers.forEach((h) => {
        if (h === g.nidCol) return;
        let best = "", score = 0;
        sys.cols.forEach((c) => {
          const sc = fxScore(h, c);
          if (sc > score) { score = sc; best = c; }
        });
        if (score >= 70) cand.push({ col: h, from: best, score });
      });
      cand.sort((x, y) => y.score - x.score);
      const map = {}, used = new Set();
      cand.forEach((c) => { if (used.has(c.from)) return; used.add(c.from); map[c.col] = c.from; });
      state.fx.map[g.sig] = map;
    });
  }

  /* كم خانة فارغة في كل عمود عبر ملفات المجموعة كلها */
  function fxGaps(g) {
    const out = {};
    g.headers.forEach((h) => {
      out[h] = g.files.reduce((n, m) => n + m.rows.filter((r) => !String(r[h] == null ? "" : r[h]).trim()).length, 0);
    });
    return out;
  }

  /* خطة ملف واحد: ماذا سيُملأ فيه */
  function fxPlan(m, g) {
    const sys = state.fx.sys;
    if (!sys || !g.nidCol) return null;
    const map = (state.fx.map || {})[g.sig] || {};
    const chosen = Object.keys(map).filter((k) => map[k]);
    let matched = 0, missing = 0, fills = 0;
    const filled = m.rows.map((r) => {
      const nid = digits(r[g.nidCol]);
      const src = nid ? sys.byNid.get(nid) : null;
      if (!src) { missing++; return { row: Object.assign({}, r), got: {}, nid, found: false }; }
      matched++;
      const copy = Object.assign({}, r);
      const got = {};
      chosen.forEach((col) => {
        const cur = String(copy[col] == null ? "" : copy[col]).trim();
        const val = String(src[map[col]] == null ? "" : src[map[col]]).trim();
        if (cur || !val) return;               // لا يُستبدل ما كتبه المستخدم
        copy[col] = val;
        got[col] = true;
        fills++;
      });
      return { row: copy, got, nid, found: true };
    });
    return { chosen, filled, matched, missing, fills, headers: m.headers, nidCol: g.nidCol };
  }

  function renderFill() {
    const box = $("fx-body");
    const sys = state.fx.sys, mine = state.fx.mine || [];
    if (!sys && !mine.length) { box.innerHTML = ""; return; }
    const bits = [];
    const bad = mine.filter((m) => m.error);
    bits.push(`<p class="conv-hint">${sys ? `✓ ملف النظام: <b>${ui.fmt(sys.rows.length)}</b> شخصاً، <b>${ui.fmt(sys.byNid.size)}</b> برقم هوية، و<b>${ui.fmt(sys.cols.length)}</b> حقلاً.` : "في انتظار ملف النظام."}
      ${mine.length ? `<br>✓ ملفاتك: <b>${ui.fmt(mine.length - bad.length)}</b> ملفاً، مجموع صفوفها <b>${ui.fmt(mine.reduce((n, m) => n + m.rows.length, 0))}</b>.` : "<br>في انتظار ملفاتك."}</p>`);
    bad.forEach((m) => bits.push(`<p class="conv-error">${esc(m.name)}: ${esc(m.error)}</p>`));

    const groups = fxGroups();
    if (sys && groups.length) {
      groups.forEach((g, gi) => {
        const gaps = fxGaps(g);
        const map = (state.fx.map || {})[g.sig] || {};
        const all = state.fx.showAll;
        const rows = g.headers
          .filter((h) => h !== g.nidCol)
          .filter((h) => all || gaps[h] || map[h])
          .map((h) => `<tr>
            <td><b>${esc(h)}</b></td>
            <td class="n">${gaps[h] ? `<span class="pill over">${ui.fmt(gaps[h])}</span>` : '<span class="sub">—</span>'}</td>
            <td><select data-fx-map="${esc(h)}" data-fx-sig="${gi}">
              ${opt("", "— لا تملأ —", !map[h])}
              ${sys.cols.map((c) => opt(c, c, map[h] === c)).join("")}
            </select></td>
          </tr>`).join("");
        bits.push(`<div class="conv-grade-note"><b>🔗 ربط الأعمدة${groups.length > 1 ? ` — مجموعة ${gi + 1}` : ""}</b>
          <p class="conv-hint" style="margin:6px 0">${g.files.length > 1
            ? `تنطبق على <b>${ui.fmt(g.files.length)}</b> ملفات متطابقة الأعمدة: ${g.files.slice(0, 4).map((m) => esc(m.name)).join("، ")}${g.files.length > 4 ? "…" : ""}`
            : esc(g.files[0].name)}</p>
          <label class="field" style="max-width:280px"><span>عمود رقم الهوية</span>
            <select data-fx-nid="${gi}">${opt("", "— اختر —", !g.nidCol)}${g.headers.map((h) => opt(h, h, h === g.nidCol)).join("")}</select></label>
          ${g.nidCol ? `<div class="table-wrap"><table><thead><tr><th>العمود في ملفك</th><th class="n">خانات فارغة</th><th>يُملأ من حقل النظام</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="empty">لا أعمدة ناقصة.</td></tr>'}</tbody></table></div>`
            : '<p class="warn">اختر عمود رقم الهوية.</p>'}</div>`);
      });
      bits.push(`<button type="button" class="conv-link" id="fx-toggle-all">${state.fx.showAll ? "اعرض الأعمدة الناقصة فقط" : "اعرض كل الأعمدة"}</button>`);

      // الدورة الجارية تُستثنى من «سبق أن التحق»، وإلا عُدّت التحاقاً سابقاً
      const courses = fxCourses();
      if (courses.length) {
        bits.push(`<label class="field" style="max-width:340px;margin-top:12px"><span>الدورة الجارية — تُستثنى من «سبق أن التحق»</span>
          <select id="fx-cur">${opt("", "— لا تستثنِ شيئاً —", !state.fx.cur)}${courses.map((c) => opt(c, c, c === state.fx.cur)).join("")}</select></label>`);
      } else if (sys) {
        bits.push('<p class="conv-hint">ملف النظام بلا سجلّ دورات — أعد تشغيل السكربت لتظهر «سبق أن التحق».</p>');
      }

      // حصيلة كل ملف على حدة
      const lines = [];
      let anyFill = 0;
      groups.forEach((g) => g.files.forEach((m) => {
        const plan = fxPlan(m, g);
        if (!plan) return;
        anyFill += plan.fills;
        const prevN = fxCompare(m, g).filter((x) => x.nCourses > 0).length;
        lines.push(`<tr><td><b>${esc(m.name)}</b></td><td class="n">${ui.fmt(m.rows.length)}</td>
          <td class="n">${ui.fmt(plan.matched)}</td><td class="n">${plan.missing ? `<span class="pill short">${ui.fmt(plan.missing)}</span>` : "0"}</td>
          <td class="n">${plan.fills ? `<span class="pill ok">${ui.fmt(plan.fills)}</span>` : "0"}</td>
          <td class="n">${prevN ? `<span class="pill over">${ui.fmt(prevN)}</span>` : "0"}</td></tr>`);
      }));
      if (lines.length) {
        bits.push(`<div class="table-wrap"><table><thead><tr><th>الملف</th><th class="n">صفوف</th><th class="n">تطابَق</th><th class="n">تعذّر</th><th class="n">خانات تُملأ</th><th class="n">سبق أن التحق</th></tr></thead>
          <tbody>${lines.join("")}</tbody></table></div>`);
        bits.push(`<label class="conv-check" style="margin-top:12px"><input type="checkbox" id="fx-judge" ${state.fx.judge ? "checked" : ""}>
          أضف إلى الملف المكتمل أعمدة الحكم: <b>سبق أن التحق؟</b> وفي النظام؟ والدورات السابقة وسجلّ الالتحاق</label>`);
        bits.push('<p class="conv-hint" style="margin-top:10px"><b>مخرجان:</b> «الملف المكتمل» يملأ الفراغات، ويضيف أعمدة الحكم إن أشّرت أعلاه · «تقرير المقارنة» لا يملأ شيئاً، بل يعرض الحكم كاملاً ومعه أوراق «قيم مختلفة» و«ليسوا في النظام» و«ليسوا في أي كشف».</p>');
        bits.push(`<div class="btn-row"><button type="button" class="btn navy" id="fx-run"${anyFill ? "" : " disabled"}>
          <span class="material-symbols-outlined btn-ico">download</span>${mine.length > 1 ? `نزّل ${ui.fmt(mine.length)} ملفات مكتملة (مضغوطة)` : "نزّل الملف المكتمل"}</button>
          <button type="button" class="btn secondary" id="fx-cmp"><span class="material-symbols-outlined btn-ico">compare_arrows</span>تقرير المقارنة بالنظام</button></div>`);
      }
    }
    box.innerHTML = bits.join("");
  }

  async function fxBook(m, g) {
    const plan = fxPlan(m, g);
    const cmp = state.fx.judge ? fxCompare(m, g) : null;      // أعمدة الحكم اختيارية
    const extra = ["سبق أن التحق؟", "في النظام؟", "عدد الدورات السابقة", "الدورات السابقة", "سجلّ الالتحاق"];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("البيانات المكتملة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.addRow(cmp ? m.headers.concat(extra) : m.headers);
    ws.getRow(1).font = { bold: true };
    const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } };
    const GREEN = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8F0E2" } };
    const RED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7D4D0" } };
    plan.filled.forEach((x, i) => {
      const base = m.headers.map((h) => (x.row[h] == null ? "" : x.row[h]));
      const c = cmp ? cmp[i] : null;
      const row = ws.addRow(c
        ? base.concat([c.nCourses > 0 ? "نعم" : "لا", c.src ? "نعم" : "لا", c.nCourses, c.courses, c.history])
        : base);
      m.headers.forEach((h, k) => { if (x.got[h]) row.getCell(k + 1).fill = YELLOW; });
      if (c) {
        const b = m.headers.length;
        row.getCell(b + 1).fill = c.nCourses > 0 ? YELLOW : GREEN;
        row.getCell(b + 1).font = { bold: true };
        row.getCell(b + 2).fill = c.src ? GREEN : RED;
      }
    });
    ws.columns.forEach((c, i) => { c.width = i >= m.headers.length ? 28 : 20; });
    // ورقة من لم يُطابَق: ليُكمل يدوياً أو يُراجَع رقم هويته
    const miss = plan.filled.filter((x) => !x.found);
    if (miss.length) {
      const ms = wb.addWorksheet("لم يُطابَق", { views: [{ rightToLeft: true }] });
      ms.addRow(["رقم الهوية كما في ملفك", "السبب"].concat(m.headers.slice(0, 3)));
      ms.getRow(1).font = { bold: true };
      miss.forEach((x) => ms.addRow([x.row[g.nidCol] == null ? "" : x.row[g.nidCol],
        x.nid ? "لا يوجد في ملف النظام" : "بلا رقم هوية"].concat(m.headers.slice(0, 3).map((h) => (x.row[h] == null ? "" : x.row[h])))));
      ms.columns.forEach((c) => { c.width = 26; });
    }
    // من سبق أن التحق: ورقة مستقلة في الملف المكتمل كذلك
    if (cmp) {
      const old2 = cmp.filter((x) => x.nCourses > 0);
      if (old2.length) {
        const os = wb.addWorksheet("سبق أن التحق", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
        os.addRow([g.nidCol, "الاسم في ملفك", "عدد الدورات", "الدورات السابقة", "سجلّ الالتحاق"]);
        os.getRow(1).font = { bold: true };
        const nameCol = m.headers.find((h) => /اسم/.test(h)) || "";
        old2.forEach((x) => os.addRow([x.r[g.nidCol] == null ? "" : x.r[g.nidCol],
          nameCol ? (x.r[nameCol] == null ? "" : x.r[nameCol]) : "", x.nCourses, x.courses, x.history]));
        os.columns.forEach((c) => { c.width = 30; });
      }
    }
    return { blob: new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), plan };
  }

  async function fxDownload() {
    const groups = fxGroups().filter((g) => g.nidCol);
    if (!groups.length) return;
    const made = [];
    for (const g of groups) {
      for (const m of g.files) {
        const r = await fxBook(m, g);
        made.push({ name: `${m.name} - مكتمل.xlsx`, blob: r.blob, plan: r.plan });
      }
    }
    if (!made.length) return;
    const fills = made.reduce((n, x) => n + x.plan.fills, 0);
    const miss = made.reduce((n, x) => n + x.plan.missing, 0);
    if (made.length === 1) {
      ui.download(made[0].name, made[0].blob);
    } else {
      const zip = new JSZip();
      made.forEach((x) => zip.file(x.name, x.blob));
      ui.download(`ملفات مكتملة ${ui.fmt(made.length)} - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    }
    ui.toast(`مُلئت ${ui.fmt(fills)} خانة في ${ui.fmt(made.length)} ملفاً${miss ? `، و${ui.fmt(miss)} صفاً لم يُطابَق` : ""}`);
  }

  /* ===== تقرير المقارنة بالنظام =====
     ثلاثة أسئلة يجيب عنها: من في كشفك وليس في النظام، ومن في النظام
     وليس في أي كشف، وأين تختلف القيم. ومعها سجلّ الدورات السابقة لكل
     شخص — وهو ما يُعرف به من سبق أن التحق. */
  /* كل الدورات التي ذكرها النظام، لاختيار الدورة الجارية منها */
  function fxCourses() {
    const sys = state.fx.sys;
    if (!sys) return [];
    const set = new Set();
    sys.rows.forEach((r) => {
      (r["_التحاقات"] || []).forEach((e) => { if (e["الدورة"]) set.add(clean(e["الدورة"])); });
      String(r["الدورات السابقة"] || "").split("،").forEach((c) => { const v = clean(c); if (v) set.add(v); });
    });
    return [...set].sort();
  }
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  /* التحاقات الشخص في دورات غير الجارية: هذا هو «سبق أن التحق» */
  function fxPrev(src) {
    if (!src) return { prev: [], history: [] };
    const cur = clean(state.fx.cur || "");
    const en = (src["_التحاقات"] || []).filter((e) => clean(e["الدورة"]));
    const hist = en.map((e) => ({
      course: clean(e["الدورة"]),
      line: [e["الدورة"], e["المسار"], e["الحالة"]].filter(Boolean).map(clean).join(" — "),
    }));
    // لا سجلّ التحاقات (ملف نظام قديم): يُرجع إلى حقل «الدورات السابقة» النصّي
    if (!hist.length) {
      String(src["الدورات السابقة"] || "").split("،").map(clean).filter(Boolean)
        .forEach((c) => hist.push({ course: c, line: c }));
    }
    const prev = hist.filter((h) => !cur || h.course !== cur);
    return { prev, history: hist };
  }

  function fxCompare(m, g) {
    const sys = state.fx.sys;
    const map = (state.fx.map || {})[g.sig] || {};
    const pairs = Object.keys(map).filter((k) => map[k]);
    const rows = m.rows.map((r) => {
      const nid = digits(r[g.nidCol]);
      const src = nid ? sys.byNid.get(nid) : null;
      const diffs = [];
      if (src) {
        pairs.forEach((col) => {
          const mine = String(r[col] == null ? "" : r[col]).trim();
          const theirs = String(src[map[col]] == null ? "" : src[map[col]]).trim();
          if (mine && theirs && fxSame(mine, theirs) === false) diffs.push(`${col}: عندك «${mine}» وفي النظام «${theirs}»`);
        });
      }
      const h = fxPrev(src);
      return {
        r, nid, src, diffs,
        courses: h.prev.map((x) => x.course).filter((c, i, a) => a.indexOf(c) === i).join("، "),
        nCourses: h.prev.map((x) => x.course).filter((c, i, a) => a.indexOf(c) === i).length,
        history: h.history.map((x) => x.line).join(" ؛ "),
      };
    });
    return rows;
  }

  /* مقارنة قيمتين بتسامح: الفروق الشكلية ليست اختلافاً */
  function fxSame(a, b) {
    const n = (v) => String(v).replace(/[\s\u200f\u200e]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
    if (n(a) === n(b)) return true;
    const da = digits(a), db = digits(b);
    if (da && db && da.replace(/^0+/, "") === db.replace(/^0+/, "")) return true;
    return false;
  }

  async function fxCompareBook(m, g) {
    const sys = state.fx.sys;
    const rows = fxCompare(m, g);
    const wb = new ExcelJS.Workbook();
    const RED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7D4D0" } };
    const GREEN = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8F0E2" } };
    const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } };

    const ws = wb.addWorksheet("المقارنة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    const extra = ["سبق أن التحق؟", "في النظام؟", "عدد الدورات السابقة", "الدورات السابقة", "سجلّ الالتحاق", "قيم مختلفة"];
    ws.addRow(m.headers.concat(extra));
    ws.getRow(1).font = { bold: true };
    rows.forEach((x) => {
      const was = x.nCourses > 0;
      const row = ws.addRow(m.headers.map((h) => (x.r[h] == null ? "" : x.r[h]))
        .concat([was ? "نعم" : "لا", x.src ? "نعم" : "لا", x.nCourses, x.courses, x.history, x.diffs.join(" | ")]));
      const base = m.headers.length;
      const bold = { bold: true };
      row.getCell(base + 1).fill = was ? YELLOW : GREEN;       // سبق أن التحق
      row.getCell(base + 1).font = bold;
      row.getCell(base + 2).fill = x.src ? GREEN : RED;        // في النظام
      if (x.diffs.length) row.getCell(base + 6).fill = RED;
    });
    ws.columns.forEach((c, i) => { c.width = i >= m.headers.length ? 30 : 20; });

    // من سبق أن التحق: ورقة مستقلة ليراها المقابِل بسرعة
    const old = rows.filter((x) => x.nCourses > 0);
    if (old.length) {
      const os = wb.addWorksheet("سبق أن التحق", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      os.addRow([g.nidCol, "الاسم", "عدد الدورات", "الدورات السابقة", "سجلّ الالتحاق"]);
      os.getRow(1).font = { bold: true };
      old.forEach((x) => os.addRow([x.r[g.nidCol] == null ? "" : x.r[g.nidCol],
        x.src ? x.src["الاسم"] : "", x.nCourses, x.courses, x.history]));
      os.columns.forEach((c) => { c.width = 30; });
    }

    // ليسوا في النظام
    const none = rows.filter((x) => !x.src);
    if (none.length) {
      const ns = wb.addWorksheet("ليسوا في النظام", { views: [{ rightToLeft: true }] });
      ns.addRow([g.nidCol, "السبب"].concat(m.headers.slice(0, 3)));
      ns.getRow(1).font = { bold: true };
      none.forEach((x) => ns.addRow([x.r[g.nidCol] == null ? "" : x.r[g.nidCol],
        x.nid ? "لا يوجد في ملف النظام" : "بلا رقم هوية"].concat(m.headers.slice(0, 3).map((h) => (x.r[h] == null ? "" : x.r[h])))));
      ns.columns.forEach((c) => { c.width = 26; });
    }

    // اختلاف القيم
    const diff = rows.filter((x) => x.diffs.length);
    if (diff.length) {
      const ds = wb.addWorksheet("قيم مختلفة", { views: [{ rightToLeft: true }] });
      ds.addRow([g.nidCol, "الاسم", "الاختلاف"]);
      ds.getRow(1).font = { bold: true };
      diff.forEach((x) => ds.addRow([x.r[g.nidCol] == null ? "" : x.r[g.nidCol], x.src["الاسم"] || "", x.diffs.join(" | ")]));
      ds.columns.forEach((c, i) => { c.width = i === 2 ? 70 : 26; });
    }
    return { blob: new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      stats: { total: rows.length, inSys: rows.length - none.length, none: none.length, old: old.length, diff: diff.length } };
  }

  /* من في النظام ولم يرد في أي كشف رُفع */
  async function fxLeftoverBook(seenIds) {
    const sys = state.fx.sys;
    const left = sys.rows.filter((r) => { const n = digits(r["رقم الهوية"] || ""); return n && !seenIds.has(n); });
    if (!left.length) return null;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ليسوا في أي كشف", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    const cols = sys.cols.filter((c) => c !== "_التحاقات").slice(0, 14);
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    left.forEach((r) => ws.addRow(cols.map((c) => {
      const v = r[c];
      return v == null ? "" : (typeof v === "object" ? "" : v);
    })));
    ws.columns.forEach((c) => { c.width = 22; });
    return { blob: new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), count: left.length };
  }

  async function fxCompareDownload() {
    const groups = fxGroups().filter((g) => g.nidCol);
    if (!groups.length) return;
    const made = [];
    const seenIds = new Set();
    let sum = { total: 0, inSys: 0, none: 0, old: 0, diff: 0 };
    for (const g of groups) {
      for (const m of g.files) {
        m.rows.forEach((r) => { const n = digits(r[g.nidCol]); if (n) seenIds.add(n); });
        const r = await fxCompareBook(m, g);
        made.push({ name: `${m.name} - مقارنة.xlsx`, blob: r.blob });
        Object.keys(sum).forEach((k) => { sum[k] += r.stats[k]; });
      }
    }
    const left = await fxLeftoverBook(seenIds);
    if (left) made.push({ name: "ليسوا في أي كشف.xlsx", blob: left.blob });
    if (made.length === 1) {
      ui.download(made[0].name, made[0].blob);
    } else {
      const zip = new JSZip();
      made.forEach((x) => zip.file(x.name, x.blob));
      ui.download(`تقرير المقارنة - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    }
    ui.toast(`${ui.fmt(sum.inSys)} في النظام، و${ui.fmt(sum.none)} ليسوا فيه، و${ui.fmt(sum.old)} سبق أن التحقوا${sum.diff ? `، و${ui.fmt(sum.diff)} باختلاف قيم` : ""}`);
  }

  /* ===== استخراج سريع: ملف Excel ← اختيار الحقول ← طباعة أو Excel أو Word =====
     لا يحتاج قالباً: كثير من الكشوف تُطلب بأعمدة معيّنة فقط، وكان لا بدّ من
     قالب جاهز لكل تشكيلة. */
  async function onQuickFile(fileList) {
    const f = [...fileList][0];
    if (!f) { state.qx = null; renderQuick(); return; }
    $("qx-body").innerHTML = '<p class="conv-hint">…جارٍ قراءة الملف</p>';
    try {
      const d = await core().readDataFile(await readFile(f));
      state.qx = {
        name: f.name.replace(/\.xlsx$/i, ""),
        headers: d.headers,
        rows: d.rows,
        hidden: new Set(),
        q: "",
      };
    } catch (e) {
      state.qx = null;
      $("qx-body").innerHTML = `<p class="conv-error">${esc(e.message)}</p>`;
      return;
    }
    renderQuick();
  }

  const qxCols = () => state.qx.headers.filter((h) => !state.qx.hidden.has(h));
  function qxRows() {
    const q = String(state.qx.q || "").trim();
    if (!q) return state.qx.rows;
    const cols = qxCols();
    return state.qx.rows.filter((r) => cols.some((h) => String(r[h] == null ? "" : r[h]).includes(q)));
  }

  function renderQuick() {
    const box = $("qx-body");
    if (!state.qx) { box.innerHTML = ""; return; }
    const x = state.qx;
    const cols = qxCols();
    const rows = qxRows();
    const shown = rows.slice(0, 12);
    const wide = cols.length > 8;
    box.innerHTML = `
      <div class="conv-grade-note conv-filter">
        <b>🧩 الحقول التي تظهر</b>
        <div class="conv-filter-list">${x.headers.map((h) => `<label class="conv-check">
            <input type="checkbox" data-qx-col="${esc(h)}" ${x.hidden.has(h) ? "" : "checked"}> ${esc(h)}
          </label>`).join("")}</div>
        <div><button type="button" class="conv-link" data-qx-all>تحديد الكل</button> · <button type="button" class="conv-link" data-qx-none>إلغاء الكل</button>
          — <b>${ui.fmt(cols.length)} حقلاً من ${ui.fmt(x.headers.length)}</b></div>
      </div>
      <div class="reg-toolbar" style="margin:10px 0">
        <div class="reg-search-box"><input type="search" id="qx-q" placeholder="تصفية الصفوف بكلمة" value="${esc(x.q)}"></div>
        <span class="conv-hint">${ui.fmt(rows.length)} صفاً من ${ui.fmt(x.rows.length)}</span>
      </div>
      ${cols.length ? `<div class="table-wrap mg-preview"><table>
          <thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${shown.map((r) => `<tr>${cols.map((h) => `<td>${esc(String(r[h] == null ? "" : r[h]))}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <p class="conv-hint">${rows.length > shown.length ? `تُعرض أول ${ui.fmt(shown.length)} صفاً، والمخرجات فيها كل الصفوف المطابقة. ` : ""}${wide ? "عدد الحقول كبير على عرض صفحة Word — الطباعة وExcel أنسب." : ""}</p>`
        : '<p class="warn">لم تختر أي حقل.</p>'}
      <div class="btn-row">
        <button type="button" class="btn secondary" data-qx-print><span class="material-symbols-outlined btn-ico">print</span>طباعة</button>
        <button type="button" class="btn secondary" data-qx-xlsx><span class="material-symbols-outlined btn-ico">download</span>تصدير Excel</button>
        <button type="button" class="btn navy" data-qx-docx><span class="material-symbols-outlined btn-ico">description</span>تصدير Word</button>
      </div>`;
  }

  function qxCheck() {
    if (!state.qx) return null;
    const cols = qxCols();
    if (!cols.length) { ui.toast("اختر حقلاً واحداً على الأقل"); return null; }
    const rows = qxRows();
    if (!rows.length) { ui.toast("لا صفوف مطابقة"); return null; }
    return { cols, rows };
  }

  async function qxExcel() {
    const d = qxCheck();
    if (!d) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(state.qx.name.slice(0, 28) || "البيانات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.addRow(d.cols);
    d.rows.forEach((r) => ws.addRow(d.cols.map((h) => (r[h] == null ? "" : r[h]))));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 20; });
    const buf = await wb.xlsx.writeBuffer();
    ui.download(`${state.qx.name} - مختصر.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function qxWord() {
    const d = qxCheck();
    if (!d) return;
    if (!App.docx) { ui.toast("مولّد Word غير جاهز"); return; }
    try {
      const blob = App.docx.build([
        { kind: "title", text: state.qx.name },
        { kind: "table", headers: d.cols, rows: d.rows.map((r) => d.cols.map((h) => (r[h] == null ? "" : String(r[h])))) },
      ]);
      ui.download(`${state.qx.name}.docx`, blob);
    } catch (e) { ui.toast(e.message); }
  }

  function qxPrint() {
    const d = qxCheck();
    if (!d) return;
    const root = document.getElementById("print-root");
    root.innerHTML = `<div class="qx-print"><h2>${esc(state.qx.name)}</h2>
      <table><thead><tr>${d.cols.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${d.cols.map((h) => `<td>${esc(String(r[h] == null ? "" : r[h]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    document.body.classList.add("printing");
    const title = document.title;
    document.title = state.qx.name;
    const cleanup = () => {
      document.body.classList.remove("printing");
      root.innerHTML = "";
      document.title = title;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 60);
  }

  /* ===== الخطوة ①: دمج عدة ملفات لنفس الأشخاص في ملف واحد =====
     تُرفع الملفات، ويُختار في كل ملف عمود الربط، فيظهر الملف المدموج للمراجعة والتنزيل،
     ثم يُستخدم كملف بيانات واحد في المقارنة مع القالب. */
  async function onMergeFiles(fileList) {
    state.mg = { files: [], merged: null };
    const files = [...fileList];
    if (!files.length) { renderMerge(); return; }
    $("mg-body").innerHTML = `<p class="conv-hint">…جارٍ قراءة ${ui.fmt(files.length)} ملفات</p>`;
    try {
      for (const f of files) {
        let d;
        try { d = await core().readDataFile(await readFile(f)); } catch (e) { throw new Error(`«${f.name}»: ${e.message}`); }
        const file = { name: f.name.replace(/\.xlsx$/i, ""), headers: d.headers, rows: d.rows };
        file.key = core().guessKey(file);
        state.mg.files.push(file);
      }
    } catch (e) {
      state.mg = { files: [], merged: null };
      $("mg-body").innerHTML = `<p class="conv-error">${esc(e.message)}</p>`;
      return;
    }
    renderMerge();
  }

  function runMerge() {
    const mg = state.mg;
    if (mg.files.length < 2) { ui.toast("اختر ملفين أو أكثر للدمج"); return; }
    const noKey = mg.files.filter((f) => !f.key).map((f) => f.name);
    if (noKey.length) { ui.toast(`اختر عمود الربط في: ${noKey.join("، ")}`); return; }
    try { mg.merged = core().mergeDataFiles(mg.files); } catch (e) { ui.toast(e.message); return; }
    mg.hidden = new Set();
    renderMerge();
    $("mg-result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* الحقول المختارة في الملف المدموج (يُحفظ المستبعَد، والترتيب ترتيب الدمج) */
  const mgCols = () => state.mg.merged.headers.filter((h) => !(state.mg.hidden || new Set()).has(h));
  const mgColCount = () => {
    const all = state.mg.merged.headers.length;
    const n = mgCols().length;
    return n === all ? `كل الحقول (${ui.fmt(all)})` : `${ui.fmt(n)} حقلاً من ${ui.fmt(all)}`;
  };

  /* شكل التمييز في المعاينة وفي الملف المنزَّل */
  const MARKS = { fill: "خلفية صفراء", red: "خط أحمر", both: "خلفية صفراء وخط أحمر" };
  const markClass = () => `mk-${(state.mg && state.mg.mark) || "fill"}`;
  function mgMarkPicker() {
    const cur = (state.mg && state.mg.mark) || "fill";
    return `<div class="conv-grade-note">
      <b>🎨 تمييز ما جاء من الملفات الأخرى</b>
      <p class="conv-hint" style="margin:6px 0">يظهر في المعاينة وفي ملف Excel المنزَّل: كل خلية جاءت من ملف غير الأول، وكل صفّ لشخص ليس في الملف الأول أصلاً.</p>
      <div class="conv-filter-list">${Object.keys(MARKS).map((k) => `<label class="conv-check">
        <input type="radio" name="mg-mark" value="${k}" ${cur === k ? "checked" : ""}> ${MARKS[k]}</label>`).join("")}</div>
    </div>`;
  }

  function mgPreview() {
    const m = state.mg.merged;
    const cols = mgCols();
    if (!cols.length) return `<p class="warn">لم تختر أي حقل.</p>`;
    const shown = m.rows.slice(0, 15);
    const base = state.mg.files[0] ? state.mg.files[0].name : "الملف الأساسي";
    const org = m.origins || [];
    const mark = markClass();
    const cell = (v, i, h) => {
      if (v == null || v === "") return `<td class="mg-empty">—</td>`;
      const from = org[i] ? org[i][h] : 0;
      if (!from) return `<td>${esc(String(v))}</td>`;
      const src = state.mg.files[from] ? state.mg.files[from].name : "ملف آخر";
      return `<td class="mg-new ${mark}" title="من «${esc(src)}»">${esc(String(v))}</td>`;
    };
    return `<div class="table-wrap mg-preview"><table>
        <thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${shown.map((r, i) => `<tr class="${(m.fromBase && !m.fromBase[i]) ? "mg-newrow " + mark : ""}">${cols.map((h) => cell(r[h], i, h)).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <p class="conv-hint">${m.rows.length > shown.length ? `تُعرض أول ${ui.fmt(shown.length)} صفاً من ${ui.fmt(m.rows.length)}، والملف المنزَّل فيه كل الصفوف. ` : ""}الخلايا المميَّزة جاءت من ملف غير «${esc(base)}»، والصفّ المميَّز كلّه شخص ليس في «${esc(base)}».</p>`;
  }

  function mgFieldPicker() {
    const m = state.mg.merged;
    const hidden = state.mg.hidden || new Set();
    // من أي ملف جاء كل حقل: يساعد على الاختيار عند تشابه الأسماء
    const norm = core().normalizeHeader;
    const origin = (h) => state.mg.files.filter((f) => f.headers.some((x) => x === h || norm(x) === norm(h) || x === f.key && h === m.key)).map((f) => f.name);
    return `<div class="conv-grade-note conv-filter">
        <b>🧩 الحقول في الملف المدموج</b>
        <div class="conv-filter-list">${m.headers.map((h) => `<label class="conv-check" title="${esc(origin(h).join("، "))}">
            <input type="checkbox" data-mg-col="${esc(h)}" ${hidden.has(h) ? "" : "checked"}> ${esc(h)}${h === m.key ? " <small>(الربط)</small>" : ""}
          </label>`).join("")}</div>
        <div><button type="button" class="conv-link" data-mg-all>تحديد الكل</button> · <button type="button" class="conv-link" data-mg-none>إلغاء الكل</button> — <b id="mg-col-count">${mgColCount()}</b></div>
      </div>`;
  }

  function renderMerge() {
    const box = $("mg-body");
    const mg = state.mg;
    if (!mg.files.length) { box.innerHTML = ""; return; }
    const files = mg.files.map((f, i) => `<div class="mg-file${i ? "" : " mg-base"}">
        <span class="mg-name">${i ? "📄" : "⭐"} ${esc(f.name)}${i ? "" : ' <b class="mg-base-tag">الملف الأساسي</b>'} <small>(${ui.fmt(f.rows.length)} صفاً، ${ui.fmt(f.headers.length)} عموداً)</small></span>
        <label>عمود الربط <select data-mg-key="${i}">${opt("", "— اختر —", !f.key)}${f.headers.map((h) => opt(h, h, h === f.key)).join("")}</select></label>
      </div>`).join("");
    let html = `<p class="conv-hint">اختر في كل ملف العمود الذي يحدّد الشخص (رقم الهوية عادةً)، ولو اختلف اسمه بين الملفات.
      <br><b>الملف الأول هو الأساس</b>: ترتيب أعمدته يُتَّبع، وقيمه تُقدَّم عند الاختلاف، وما يأتي من غيره يُميَّز بلون في الملف المنزَّل.</p>
      <div class="mg-files">${files}</div>
      <button type="button" class="btn" id="mg-run"><span class="material-symbols-outlined btn-ico">link</span>دمج الملفات</button>`;
    const m = mg.merged;
    if (m) {
      const st = m.stats;
      const perFile = st.perFile.map((f) => `<li><b>${esc(f.name)}</b>: ${ui.fmt(f.rows)} صفاً${f.missing
        ? ` — <span class="warn">ليس فيه ${ui.fmt(f.missing)} شخصاً</span>: ${f.missingNames.map(esc).join("، ")}${f.missing > f.missingNames.length ? "…" : ""}`
        : " — فيه كل الأشخاص"}</li>`).join("");
      html += `<div class="conv-merge" id="mg-result">
        <h3>✓ الملف المدموج: ${ui.fmt(st.total)} شخصاً · ${ui.fmt(m.headers.length)} عموداً</h3>
        <p>منهم <b>${ui.fmt(st.inAll)}</b> موجودون في كل الملفات.</p>
        <ul>${perFile}</ul>
        ${st.conflicts ? `<p class="warn">⚠ ${ui.fmt(st.conflicts)} قيمة مختلفة للشخص نفسه بين الملفات؛ أُخذت قيمة الملف الأول.</p>` : ""}
        ${st.noKey ? `<p class="warn">⚠ ${ui.fmt(st.noKey)} صفاً بلا قيمة في عمود الربط؛ أُضيفت كما هي دون دمج.</p>` : ""}
        ${mgFieldPicker()}
        ${mgMarkPicker()}
        <div id="mg-preview-box">${mgPreview()}</div>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="mg-download"><span class="material-symbols-outlined btn-ico">download</span>تنزيل الملف المدموج</button>
          <button type="button" class="btn navy" id="mg-use">➜ استخدامه في المقارنة مع القالب</button>
        </div>
      </div>`;
    }
    box.innerHTML = html;
  }

  async function downloadMerged() {
    const m = state.mg.merged;
    const cols = mgCols();
    if (!cols.length) { ui.toast("اختر حقلاً واحداً على الأقل"); return; }
    const mark = (state.mg && state.mg.mark) || "fill";
    const base = state.mg.files[0] ? state.mg.files[0].name : "الملف الأساسي";
    const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } };
    const RED = { color: { argb: "FFC00000" }, bold: true };
    /* التمييز نفسه في المعاينة وفي الملف: ما جاء من غير الملف الأول */
    const paint = (cell) => {
      if (mark === "fill" || mark === "both") cell.fill = YELLOW;
      if (mark === "red" || mark === "both") cell.font = RED;
    };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("البيانات المدموجة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.addRow(cols);
    const org = m.origins || [];
    m.rows.forEach((r, i) => {
      const row = ws.addRow(cols.map((h) => (r[h] == null ? "" : r[h])));
      const newRow = m.fromBase && !m.fromBase[i];
      cols.forEach((h, c) => {
        const from = org[i] ? org[i][h] : 0;
        if (newRow || from) paint(row.getCell(c + 1));
      });
    });
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 20; });
    // ورقة تشرح معنى اللون حتى لا يُنسى بعد أيام
    const lg = wb.addWorksheet("دليل الألوان", { views: [{ rightToLeft: true }] });
    lg.addRow(["المعنى", "الشكل"]);
    lg.getRow(1).font = { bold: true };
    const r1 = lg.addRow([`قيمة جاءت من ملف غير «${base}»`, "مميَّزة"]);
    paint(r1.getCell(2));
    const r2 = lg.addRow([`صفّ كامل لشخص ليس في «${base}»`, "مميَّز"]);
    paint(r2.getCell(2));
    lg.addRow([`قيمة من «${base}» نفسه`, "بلا تمييز"]);
    lg.columns.forEach((c) => { c.width = 44; });
    const buf = await wb.xlsx.writeBuffer();
    ui.download(`ملف مدموج - ${ui.todayISO()}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function useMerged() {
    const m = state.mg.merged;
    const cols = mgCols();
    if (!cols.length) { ui.toast("اختر حقلاً واحداً على الأقل"); return; }
    const pick = (r) => { const o = {}; cols.forEach((h) => { o[h] = r[h]; }); return o; };
    state.mergedData = { headers: cols.slice(), rows: m.rows.map(pick), count: m.rows.length };
    $("conv-data-file").value = "";
    renderMergedChip();
    ui.toast("سيُستخدم الملف المدموج كملف بيانات — اختر القالب ثم اضغط «تحليل الملفين»");
    $("conv-parse").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderMergedChip() {
    const on = !!state.mergedData;
    $("conv-merged-chip").hidden = !on;
    $("conv-data-field").hidden = on;
    if (on) $("conv-merged-text").textContent = `ملف البيانات: ${state.mergedData.label || "الملف المدموج"} (${ui.fmt(state.mergedData.count)} صفاً، ${ui.fmt(state.mergedData.headers.length)} عموداً)`;
  }

  /* الزر يُظهر أنه يعمل من اللحظة الأولى، وأي خطأ في أي مرحلة (حتى تحميل القالب من الخادم) يظهر تحته */
  let parsing = false;
  async function handleParse() {
    if (parsing) return;
    parsing = true;
    setError("");
    setBusy("conv-parse", true, "جارٍ التحضير…");
    try {
      await parseFiles();
    } catch (e) {
      console.error(e);
      setError(e && e.message ? e.message : "تعذّر التحليل؛ أعد المحاولة");
    } finally {
      setBusy("conv-parse", false, "تحليل الملفين");
      parsing = false;
      if (!$("conv-error").hidden) $("conv-error").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function parseFiles() {
    if (!librariesReady()) { setError("تعذّر تحميل مكتبات Excel/Word من مجلد vendor."); return; }
    const dataFiles = [...$("conv-data-file").files];
    if (!dataFiles.length && !state.mergedData) { setError("اختر ملف البيانات، أو ادمج عدة ملفات في الخطوة ①"); return; }

    let templateBuffer, templateIsDocx, templateName, savedId = null, templateHeaders = null;
    if (state.mode === "upload") {
      const templateFile = $("conv-template-file").files[0];
      if (!templateFile) { setError("اختر ملف القالب"); return; }
      templateBuffer = await readFile(templateFile);
      templateIsDocx = core().isDocxName(templateFile.name);
      templateName = templateFile.name.replace(/\.[^.]+$/, "") || "converted";
    } else {
      let saved;
      // القالب قد لا يكون على هذا الجهاز بعد، فيُحمَّل من الخادم أولاً
      setBusy("conv-parse", true, "جارٍ تحميل القالب…");
      try { saved = state.selectedSavedId && (await store().get(state.selectedSavedId)); } catch (e) { setError(e.message); return; }
      if (!saved) { setError("اختر قالباً محفوظاً"); return; }
      templateBuffer = await saved.file.arrayBuffer();
      templateIsDocx = saved.format === "docx";
      templateName = saved.name;
      templateHeaders = saved.headers;
      savedId = saved.id;
    }

    setBusy("conv-parse", true, "جارٍ التحليل...");
    try {
      if (!templateHeaders) templateHeaders = await core().readTemplateHeaders(templateBuffer, templateIsDocx);
      const data = await readData(dataFiles);

      state.parsed = { templateHeaders, dataHeaders: data.headers, dataRows: data.rows, truncated: data.truncated, templateBuffer, templateIsDocx, templateName, savedId };
      state.grade = core().addComputedGrade(data);
      state.trainers = core().addTrainerColumns(data, tracksList());
      state.age = core().addAgeColumn(data);
      state.trackDataSource = state.trainers.track ? { track: state.trainers.track } : state.trainers.column ? { column: state.trainers.column } : undefined;
      state.trackData = core().addTrackDataColumns(data, tracksList(), state.trackDataSource, store().get().trackCodes || []);
      state.userMappings = {};
      state.mapping = core().suggestColumnMapping(templateHeaders, data.headers);
      core().preferComputedGrade(state.mapping, templateHeaders, data.headers);
      core().preferTrainers(state.mapping, templateHeaders, data.headers);
      core().preferTrackData(state.mapping, templateHeaders, data.headers, data.rows, true);
      core().preferAge(state.mapping, templateHeaders, data.headers);
      state.trackDataAutoMapped = Object.fromEntries(templateHeaders.filter((h) => core().trackDataFieldFor(h) && state.mapping[h] === core().trackDataFieldFor(h)).map((h) => [h, state.mapping[h]]));
      state.constants = {};
      const placeholders = await core().readTemplatePlaceholders(templateBuffer, templateIsDocx);
      state.placeholders = placeholders;
      placeholders.forEach((ph) => {
        const source = core().trackDataFieldFor(ph);
        if (!source || !data.headers.includes(source)) return;
        data.rows.forEach((row) => { if (row[source] != null) row[ph] = row[source]; });
      });
      // حقول القالب التي لا يوجد لها عمود في ملف البيانات ولا في عناوين القالب
      const norm = core().normalizeHeader;
      const dataNorm = data.headers.map(norm);
      state.extraFields = placeholders.filter((ph) => {
        const n = norm(ph);
        const trackSource = core().trackDataFieldFor(ph);
        if (trackSource && data.headers.includes(trackSource) && data.rows.some((r) => r[trackSource] != null && String(r[trackSource]).trim())) return false;
        return !dataNorm.some((d) => d === n || d.includes(n) || n.includes(d)) && !templateHeaders.some((h) => norm(h) === n) && !/^تاريخ\d+$/.test(ph);
      });
      state.outputFormat = templateIsDocx ? "docx" : "xlsx";
      // نصوص القالب خارج الجدول (اليوم، التاريخ، اسم المسار…): يملؤها المستخدم هنا
      state.textFields = templateIsDocx
        ? (await core().readTemplateTextFields(templateBuffer, tracksList().map((t) => t.name))).map((f) => Object.assign({}, f, { value: "" }))
        : [];
      await prepareExtras(data);
      state.fixedOrigin = {};
      state.filterCol = core().guessTrackColumn(data.headers.filter((h) => !Object.values(core().TRAINER_COLS).includes(h) && !(core().TRACK_DATA_HEADERS || []).includes(h)));
      state.filterOut = new Set();
      state.pickOrder = [];
      state.pickHidden = new Set();
      state.fixedUsed = applyFixed(templateHeaders, state.mapping, placeholders);
      (state.extras || []).forEach((t) => applyFixed(t.headers, t.mapping, []));

      const defaults = (savedId && selectedSaved() && selectedSaved().defaultGroupBy) || [];
      const usable = defaults.map((h) => core().resolveDefaultColumn(h, data.headers)).filter(Boolean);
      state.groupBy1 = usable[0] || "";
      state.groupBy2 = usable[1] || "";
      state.autoNumberHeader = "";
      state.sortRowsBy = "";
      state.groupWeekdays = {};
      state.datesWeekdays = [];
      applyProfile();
      core().preferTrackData(state.mapping, templateHeaders.filter((h) => !state.userMappings?.[h] && !String(state.constants[h] || "").trim()), data.headers, data.rows, true);
      state.trackDataAutoMapped = Object.fromEntries(templateHeaders.filter((h) => core().trackDataFieldFor(h) && state.mapping[h] === core().trackDataFieldFor(h)).map((h) => [h, state.mapping[h]]));
      refreshTrackPlaceholders();
      renderResult();
      $("conv-result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error(e);
      state.parsed = null;
      renderResult();
      setError(e && e.message && /[؀-ۿ]/.test(e.message)
        ? e.message
        : "تعذّر قراءة أحد الملفين - تأكد أن القالب Excel أو Word صحيح وأن ملف البيانات بصيغة Excel (.xlsx)");
    } finally {
      setBusy("conv-parse", false, "تحليل الملفين");
    }
  }

  /* لكل قالب إضافي: عناوينه وربطه التلقائي وحقوله الناقصة */
  async function prepareExtras(data) {
    state.extras = [];
    const norm = core().normalizeHeader;
    const dataNorm = data.headers.map(norm);
    for (const id of state.extraSavedIds) {
      const saved = await store().get(id);
      if (!saved) continue;
      const buffer = await saved.file.arrayBuffer();
      const isDocx = saved.format === "docx";
      const headers = saved.headers && saved.headers.length ? saved.headers : await core().readTemplateHeaders(buffer, isDocx);
      const mapping = core().preferTrackData(core().preferTrainers(core().preferComputedGrade(core().suggestColumnMapping(headers, data.headers), headers, data.headers), headers, data.headers), headers, data.headers, data.rows, true);
      const placeholders = await core().readTemplatePlaceholders(buffer, isDocx);
      const extraFields = placeholders.filter((ph) => {
        const n = norm(ph);
        const trackSource = core().trackDataFieldFor(ph);
        if (trackSource && data.headers.includes(trackSource) && data.rows.some((r) => r[trackSource] != null && String(r[trackSource]).trim())) return false;
        return !dataNorm.some((d) => d === n || d.includes(n) || n.includes(d)) && !headers.some((h) => norm(h) === n) && !/^تاريخ\d+$/.test(ph);
      });
      state.extras.push({ id, name: saved.name, buffer, isDocx, headers, mapping, defaultGroupBy: saved.defaultGroupBy || [], missing: headers.filter((h) => !mapping[h]).concat(extraFields) });
    }
  }

  function setBusy(buttonId, busy, label) {
    const b = $(buttonId);
    if (!b) return;
    b.disabled = busy;
    b.textContent = label;
  }

  async function handleSaveTemplate() {
    const errBox = $("conv-save-error");
    errBox.textContent = "";
    const file = $("conv-template-file").files[0];
    const name = $("conv-save-name").value.trim();
    if (!file) { errBox.textContent = "اختر ملف القالب أولاً"; return; }
    if (!name) { errBox.textContent = "اسم القالب مطلوب"; return; }
    if (!librariesReady()) { errBox.textContent = "تعذّر تحميل مكتبات Excel/Word."; return; }

    setBusy("conv-save-btn", true, "جارٍ الحفظ...");
    try {
      const buffer = await readFile(file);
      const isDocx = core().isDocxName(file.name);
      const headers = await core().readTemplateHeaders(buffer, isDocx);
      const id = await store().save({ name, format: isDocx ? "docx" : "xlsx", headers, file: new Blob([buffer], { type: file.type }) });
      $("conv-save-form").hidden = true;
      $("conv-save-toggle").hidden = false;
      $("conv-save-name").value = "";
      state.selectedSavedId = id;
      await refreshSaved();
      ui.toast("حُفظ القالب، ويظهر لكل المستخدمين");
    } catch (e) {
      console.error(e);
      errBox.textContent = e && e.message && /[؀-ۿ]/.test(e.message) ? e.message : "تعذّر العثور على صف عناوين في هذا الملف";
    } finally {
      setBusy("conv-save-btn", false, "حفظ");
    }
  }

  async function handleDeleteSaved() {
    const t = selectedSaved();
    if (!t || !confirm(`حذف القالب المحفوظ «${t.name}»؟`)) return;
    await store().remove(t.id);
    state.selectedSavedId = "";
    await refreshSaved();
    ui.toast("تم حذف القالب");
  }

  async function handleDownloadSaved() {
    try {
      const t = state.selectedSavedId && (await store().get(state.selectedSavedId));
      if (t) ui.download(`${t.name}.${t.format}`, t.file);
    } catch (e) { ui.toast(e.message); }
  }

  /* ===== قسم الربط والخيارات ===== */
  const activeGroupColumns = () => [state.groupBy1, state.groupBy2].filter(Boolean);

  function distinctGroups() {
    const p = state.parsed;
    const cols = activeGroupColumns();
    if (!p || cols.length === 0) return [];
    const seen = new Map();
    for (const row of p.dataRows) {
      const key = core().computeGroupKey(cols, row);
      if (!seen.has(key)) seen.set(key, cols.map((c) => String(row[c] == null ? "" : row[c])).join(" - "));
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }

  const weekdayBoxes = (checked, attrs) => WEEKDAY_DISPLAY_ORDER.map((day) =>
    `<label class="conv-check"><input type="checkbox" ${attrs(day)} ${checked.includes(day) ? "checked" : ""}> ${WEEKDAY_NAMES[day]}</label>`
  ).join("");

  /* نصوص القالب القابلة للتعبئة: اليوم والتاريخ واسم المسار وما شابهها */
  const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const isDayField = (label) => /^اليوم$/.test(String(label).trim());
  const isDateField = (label) => /تاريخ/.test(label);
  const isTimeField = (label) => /ساعة|وقت/.test(label);
  const isTrackField = (label) => /مسار/.test(label);

  /* 2026-10-05 ← 05/10/2026م، ومعها اسم يومها */
  const dateArabic = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}م`;
  };
  const dayOfIso = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? "" : WEEKDAYS[d.getDay()];
  };
  /* 09:00 ← 09:00 ص */
  const timeArabic = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return String(hhmm || "");
    const h = Number(m[1]);
    const suffix = h < 12 ? "ص" : "م";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, "0")}:${m[2]} ${suffix}`;
  };

  function textFieldsControl() {
    const list = state.textFields || [];
    if (!list.length) {
      return state.parsed && state.parsed.templateIsDocx
        ? `<p class="conv-hint">لم أجد في ترويسة القالب نصوصاً قابلة للتعبئة (مثل «اليوم:» و«التاريخ:»). القيم التي في ترويسة قالبك تبقى كما هي.</p>`
        : "";
    }
    const today = new Date();
    const todayIso = ui.todayISO();
    const input = (f, i) => {
      if (isDayField(f.label)) {
        return `<select data-tf="${i}"><option value="">— كما في القالب (${esc(f.current)}) —</option>${WEEKDAYS.map((d) => `<option ${f.value === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>`;
      }
      if (isDateField(f.label)) {
        return `<input type="date" data-tf="${i}" data-kind="date" value="${esc(f.iso || "")}" title="يُكتب في الكشف ${esc(f.value || dateArabic(todayIso))}، ويملأ اسم اليوم تلقائياً">`;
      }
      if (isTimeField(f.label)) {
        return `<input type="time" data-tf="${i}" data-kind="time" value="${esc(f.raw || "")}">`;
      }
      if (isTrackField(f.label)) {
        const names = tracksList().map((t) => t.name).filter(Boolean);
        if (names.length) return `<select data-tf="${i}"><option value="">— كما في القالب (${esc(f.current)}) —</option>${names.map((n) => `<option ${f.value === n ? "selected" : ""}>${esc(n)}</option>`).join("")}${f.value && !names.includes(f.value) ? `<option selected>${esc(f.value)}</option>` : ""}</select>`;
      }
      return `<input type="text" data-tf="${i}" value="${esc(f.value || "")}" placeholder="${esc(f.current)}">`;
    };
    const shown = (f) => (f.value ? ` <b>← ${esc(f.value)}</b>` : "");
    const filled = list.filter((f) => f.value).length;
    return `<details class="conv-section conv-fields" open>
      <summary><span class="material-symbols-outlined btn-ico">edit</span>اليوم والتاريخ وبيانات الترويسة (${ui.fmt(list.length)})${filled ? ` — عُبِّئ ${ui.fmt(filled)}` : ""}</summary>
      <p class="conv-hint">هذه نصوص مكتوبة في القالب نفسه. حدّد البديل ليظهر في الكشف، واتركه فارغاً ليبقى كما هو. واختيار التاريخ يملأ اسم اليوم تلقائياً.</p>
      <div class="conv-mapping">${list.map((f, i) => `
        <div class="conv-map-row">
          <span>${esc(f.label)}<small class="conv-hint"> في القالب: ${esc(f.current)}${shown(f)}</small></span>
          ${input(f, i)}
        </div>`).join("")}</div>
    </details>`;
  }

  /* ===== تصدير Excel بالأعمدة التي يختارها المستخدم =====
     يأخذ الصفوف نفسها التي في الكشف: بعد تصفية المسارات، وبالقيم الثابتة، وبالترتيب المختار. */
  /* ترتيب الأعمدة: ما رتّبه المستخدم أولاً، ثم الباقي كما جاء من الملف */
  const allExportCols = () => {
    const p = state.parsed;
    if (!p) return [];
    const all = p.dataHeaders.concat(Object.keys(state.constants).filter((k) => String(state.constants[k]).length && !p.dataHeaders.includes(k)));
    const order = (state.pickOrder || []).filter((h) => all.includes(h));
    return order.concat(all.filter((h) => !order.includes(h)));
  };

  /* نقل عمود خطوةً، أو إلى موضع آخر بالسحب */
  function moveExportCol(name, target) {
    const cols = allExportCols();
    const from = cols.indexOf(name);
    if (from < 0) return;
    let to = typeof target === "number" ? from + target : cols.indexOf(target);
    if (to < 0 || to >= cols.length || to === from) return;
    cols.splice(to, 0, cols.splice(from, 1)[0]);
    state.pickOrder = cols;
    state.exportOpen = true;
    renderResult();
  }

  function exportControl() {
    const all = allExportCols();
    if (!all.length) return "";
    const hidden = state.pickHidden || new Set();
    const n = all.filter((h) => !hidden.has(h)).length;
    return `<details class="conv-section conv-export" ${state.exportOpen ? "open" : ""}>
      <summary><span class="material-symbols-outlined btn-ico">download</span>تصدير Excel بالأعمدة التي تختارها (${ui.fmt(n)} من ${ui.fmt(all.length)})</summary>
      <p class="conv-hint">ملف Excel فيه الصفوف نفسها التي في الكشف (بعد تصفية المسارات والترتيب)، وبالأعمدة المحدَّدة فقط.</p>
      <p class="conv-hint">الترتيب هنا هو ترتيب الأعمدة في الملف. اسحب الحقل إلى موضعه، أو استعمل السهمين.</p>
      <ol class="conv-order">${all.map((h, i) => `<li class="conv-order-row${hidden.has(h) ? " off" : ""}" draggable="true" data-col="${esc(h)}">
        <span class="conv-grip" title="اسحب لتغيير الترتيب">⠿</span>
        <label class="conv-check"><input type="checkbox" data-pick="${esc(h)}" ${hidden.has(h) ? "" : "checked"}> ${esc(h)}</label>
        <span class="conv-order-btns">
          <button type="button" class="conv-link" data-col-up="${esc(h)}" ${i === 0 ? "disabled" : ""} title="أعلى"><span class="material-symbols-outlined btn-ico">arrow_drop_up</span></button>
          <button type="button" class="conv-link" data-col-down="${esc(h)}" ${i === all.length - 1 ? "disabled" : ""} title="أسفل"><span class="material-symbols-outlined btn-ico">arrow_drop_down</span></button>
        </span>
      </li>`).join("")}</ol>
      <div class="btn-row">
        <button type="button" class="conv-link" data-pick-all>تحديد الكل</button>
        <button type="button" class="conv-link" data-pick-none>إلغاء الكل</button>
        <button type="button" class="btn small" id="conv-export-xlsx"><span class="material-symbols-outlined btn-ico">download</span>تنزيل Excel</button>
      </div>
    </details>`;
  }

  async function exportPickedXlsx() {
    const p = state.parsed;
    if (!p) return;
    const hidden = state.pickHidden || new Set();
    const cols = allExportCols().filter((h) => !hidden.has(h));
    if (!cols.length) { ui.toast("اختر عموداً واحداً على الأقل"); return; }
    const keys = Object.keys(state.constants).filter((k) => String(state.constants[k]).length);
    const rows = p.dataRows.filter(keepRow).map((r) => {
      const copy = Object.assign({}, r);
      keys.forEach((k) => { copy[k] = state.constants[k]; });
      return copy;
    });
    if (!rows.length) { ui.toast("لا صفوف للتصدير"); return; }
    if (state.sortRowsBy) core().sortRowsByColumn(rows, state.sortRowsBy);
    setBusy("conv-export-xlsx", true, "جارٍ التصدير…");
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("البيانات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      ws.columns = cols.map((h) => ({ header: h, key: h, width: Math.min(34, Math.max(12, h.length + 6)) }));
      rows.forEach((r) => ws.addRow(cols.reduce((o, h) => Object.assign(o, { [h]: r[h] == null ? "" : r[h] }), {})));
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      head.height = 24;
      head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } }; });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      const buf = await wb.xlsx.writeBuffer();
      ui.download(`${outputName()}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      ui.toast(`نُزّل ${ui.fmt(rows.length)} صفاً و${ui.fmt(cols.length)} عموداً`);
    } catch (e) {
      ui.toast(e.message);
    } finally {
      setBusy("conv-export-xlsx", false, "⬇ تنزيل Excel");
    }
  }

  /* ===== اسم الملف المخرج: اسم القالب + المسار =====
     المسار يُؤخذ مما حدّده المستخدم في حقول القالب، وإلا من تصفية المسارات،
     وإلا من عمود المسار في البيانات إن كانت كل صفوفه لمسار واحد. */
  function currentTrackName() {
    const p = state.parsed;
    if (!p) return "";
    const norm = core().normalizeHeader;
    const field = (state.textFields || []).find((f) => /مسار/.test(norm(f.label)) && f.value);
    if (field) return field.value;
    const col = state.filterCol;
    if (col) {
      const kept = [...new Set(p.dataRows.filter(keepRow).map((r) => String(r[col] == null ? "" : r[col]).trim()).filter(Boolean))];
      if (kept.length === 1) return kept[0];
      if (kept.length > 1) return "";
    }
    const guess = core().guessTrackColumn(p.dataHeaders);
    if (guess) {
      const vals = [...new Set(p.dataRows.map((r) => String(r[guess] == null ? "" : r[guess]).trim()).filter(Boolean))];
      if (vals.length === 1) return vals[0];
    }
    return "";
  }

  /* اسم ملف صالح على ويندوز: بلا \ / : * ? " < > | */
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);

  function outputName() {
    const p = state.parsed;
    const base = safeName((p && p.templateName) || "converted");
    const track = safeName(currentTrackName());
    return track && !base.includes(track) ? `${base} - ${track}` : base;
  }

  function renderResult() {
    const box = $("conv-result");
    const p = state.parsed;
    if (!p) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;

    const sameFormat = (state.outputFormat === "docx") === p.templateIsDocx;
    const groups = activeGroupColumns();
    const dataOptions = (selected, placeholder, exclude) =>
      opt("", placeholder, !selected) + p.dataHeaders.filter((h) => h !== exclude).map((h) => opt(h, h, h === selected)).join("");

    const missing = p.templateHeaders.filter((h) => !state.mapping[h]);
    const fromExtras = (state.extras || []).reduce((all, t) => all.concat(t.missing), []);
    const extra = [...new Set((state.extraFields || []).concat(fromExtras))].filter((f) => !missing.includes(f));
    let html = profileNote();
    // قالب جدول الاختبارات ليس قالباً عادياً: مواعيده تختلف من مجموعة لأخرى،
    // فلا تصلح له تعبئة قيمة واحدة لكل الصفوف. له بطاقته أعلى الصفحة.
    if (p.templateHeaders.includes("الاختبار النظري") && p.templateHeaders.includes("الاختبار العملي")) {
      html += `<p class="conv-grade-note">📋 يبدو أن هذا <b>قالب جدول الاختبارات</b> — استخدم بطاقة «<b>جدول الاختبارات</b>» في أعلى هذه الصفحة بدل هذه البطاقة، فهي تعطيك موعد النظري ومواعيد العملي لكل مجموعة على حدة.</p>`;
    }
    if (state.fixedUsed && state.fixedUsed.length) {
      html += `<p class="conv-grade-note">📌 عُبّئ من البيانات الثابتة: ${state.fixedUsed.map(esc).join("، ")} — تظهر قيمها في «حقول لم نجد لها بيانات» ويمكن تغييرها هناك لهذا الكشف فقط.</p>`;
    }
    html += textFieldsControl();
    html += gradeControl();
    html += ageControl();
    html += trainerControl();
    html += trackDataControl();
    html += filterControl();
    if (missing.length || extra.length) {
      const field = (name, hint) => {
        const val = state.constants[name] || "";
        // «ساعة الحضور» و«ساعة الانصراف» وأمثالها: منتقي وقت يُكتب 09:00 ص
        const box = isTimeField(name)
          ? `<input type="time" data-const-time="${esc(name)}" value="${esc(state.constTimes && state.constTimes[name] ? state.constTimes[name] : "")}" title="${esc(val || "يوضع في كل الصفوف")}">`
          : `<input type="text" data-const="${esc(name)}" value="${esc(val)}" placeholder="اكتب القيمة لتُوضع في كل الصفوف">`;
        return `
        <div class="conv-map-row">
          <span>${esc(name)}${hint ? `<small class="conv-hint"> ${esc(hint)}</small>` : ""}${isTimeField(name) && val ? ` <b>← ${esc(val)}</b>` : ""}</span>
          ${box}
        </div>`;
      };
      const filledCount = missing.concat(extra).filter((f) => state.constants[f]).length;
      html += `<details class="conv-section conv-missing" id="conv-missing" ${state.missingOpen ? "open" : ""}>
        <summary><span class="material-symbols-outlined btn-ico">warning</span>حقول تُكتب يدوياً: ساعة الحضور والانصراف وغيرها (${ui.fmt(missing.length + extra.length)})${filledCount ? ` — عُبِّئ ${ui.fmt(filledCount)}` : ""}</summary>
        <p class="conv-hint">اكتب قيمة كل حقل هنا، فتُوضع كما هي في كل صفوف القالب. أو اتركه فارغاً ليبقى فارغاً، أو اربطه بعمود من ملف البيانات في القائمة أدناه. وأعمدة التسلسل مثل «م» تُملأ من خيار «ترقيم تلقائي لعمود» أسفل الصفحة.</p>
        <div class="conv-mapping">
          ${missing.map((h) => field(h, "عمود في جدول القالب")).join("")}
          ${extra.map((ph) => field(ph, "حقل في ترويسة القالب")).join("")}
        </div>
      </details>`;
    }
    html += exportControl();
    html += `<h3>اربط كل عمود في القالب بالعمود المقابل له في ملف البيانات</h3>
      <div class="conv-mapping">
        ${p.templateHeaders.map((h, i) => `
          <div class="conv-map-row">
            <span>${esc(h)}</span>
            <select data-map="${i}">${opt("", "— بدون —", !state.mapping[h])}${p.dataHeaders.map((dh) => opt(dh, dh, state.mapping[h] === dh)).join("")}</select>
          </div>`).join("")}
      </div>
      <p class="conv-hint">${ui.fmt(p.dataRows.length)} صف من ملف البيانات${p.truncated ? ` (تم الاقتصار على أول ${ui.fmt(core().MAX_ROWS)} صف)` : ""}</p>

      <div class="conv-tabs">
        <button type="button" data-out="xlsx" class="${state.outputFormat === "xlsx" ? "active" : ""}">مخرج Excel</button>
        <button type="button" data-out="docx" class="${state.outputFormat === "docx" ? "active" : ""}">مخرج Word</button>
      </div>
      <p class="conv-hint">${sameFormat
        ? "المخرج بنفس صيغة القالب، فسيحافظ على تنسيقه وترويسته كما هي."
        : "المخرج بصيغة مختلفة عن القالب، فسيُنشأ ملف جديد بجدول بسيط بدون تنسيق القالب الأصلي."}</p>`;

    if (sameFormat) {
      html += `
      <div class="conv-section">
        <span class="conv-label">تجميع الصفوف وتكرار العنوان عند كل مجموعة (اختياري)</span>
        <div class="conv-inline">
          <select id="conv-group1">${dataOptions(state.groupBy1, "بدون تجميع")}</select>
          ${state.groupBy1 ? `<select id="conv-group2">${dataOptions(state.groupBy2, "+ مستوى تجميع ثانٍ (اختياري، مثلاً المجموعة)", state.groupBy1)}</select>` : ""}
        </div>
        ${state.mode === "saved" && p.savedId ? `<button type="button" class="conv-link" id="conv-save-default">احفظ هذا التجميع كافتراضي لهذا القالب</button>` : ""}
        ${state.groupBy1 && !state.groupBy2 ? `<p class="conv-warn">⚠ اخترت مستوى تجميع واحداً فقط (${esc(state.groupBy1)}). لو كانت الصفوف التي تشترك في نفس القيمة تنتمي لأعمدة أخرى مختلفة (مثل مسارات مختلفة)، سيتم دمجها كلها في قسم واحد، وسيظهر عنوان القسم بقيمة أول صف فقط. أضف المستوى الثاني لو أردت فصلها أيضاً.</p>` : ""}
        <p class="conv-hint">اختر عمود المجموعة من ملف البيانات نفسه (وليس من أعمدة القالب) - يفيد هذا حتى لو كانت المجموعة تظهر بالقالب فقط داخل عنوان مثل {{المجموعة}}. يرتّب الصفوف بحيث تكون كل مجموعة معاً، ويكرر ترويسة القالب مع فاصل صفحة حقيقي عند بداية كل مجموعة جديدة.${state.outputFormat === "docx" ? " أي محتوى بعد الجدول في القالب (مثل توقيع أو اعتماد) يتكرر أيضاً مع كل مجموعة." : ""}</p>
      </div>`;

      if (state.outputFormat === "docx" && groups.length > 0) {
        html += `
      <div class="conv-section conv-boxed">
        <label class="conv-check strong"><input type="checkbox" id="conv-fit" ${state.fitGroupToOnePage ? "checked" : ""}> تقليص ارتفاع الصفوف وحجم الخط تلقائياً لتقريب كل مجموعة من صفحة واحدة</label>
        <p class="conv-hint">يقلّص حجم الخط وارتفاع الصفوف حسب عدد صفوف كل مجموعة، بحد أدنى مقروء. هذا تقدير وليس ضماناً لصفحة واحدة في كل الحالات.</p>
      </div>`;
      }

      if (state.outputFormat === "xlsx") {
        html += `
      <div class="conv-section conv-boxed">
        <label class="conv-check strong"><input type="checkbox" id="conv-fit" ${state.fitGroupToOnePage ? "checked" : ""}> طباعة ${groups.length > 0 ? "كل مجموعة" : "الكشف"} في صفحة واحدة تتسع لجميع الصفوف</label>
        <p class="conv-hint">يضبط مقياس الطباعة تلقائياً حسب ${groups.length > 0 ? "أطول مجموعة" : "عدد الصفوف"} وعرض الأعمدة، ويوسّع ارتفاع الصفوف لتملأ الصفحة${groups.length > 0 ? "، مع بقاء كل مجموعة في صفحة مستقلة" : ""}. مقياس الطباعة واحد للورقة كلها، لكن ارتفاع الصفوف يُحسب لكل مجموعة على حدة.</p>
      </div>`;
      }

      if (state.outputFormat === "xlsx") {
        const dg = distinctGroups();
        html += `
      <div class="conv-section conv-boxed">
        <label class="conv-check strong"><input type="checkbox" id="conv-dates" ${state.datesEnabled ? "checked" : ""}> توليد تواريخ الحضور تلقائياً (اختياري)</label>
        ${state.datesEnabled ? `
          <div class="conv-inline">
            <label class="conv-check">من تاريخ <input type="date" id="conv-dates-start" value="${esc(state.datesStart)}"></label>
            <label class="conv-check">إلى تاريخ <input type="date" id="conv-dates-end" value="${esc(state.datesEnd)}"></label>
          </div>
          <p class="conv-hint">يمكن تحديد أي مدى (مثلاً نصف الشهر الأول) - يحسب أول 7 تواريخ داخل المدى توافق الأيام المحددة، ويستبدل بها صف التواريخ الموجود في القالب.</p>
          ${dg.length > 0
            ? `<p class="conv-label">حدد أيام الأسبوع الخاصة بكل مجموعة موجودة فعلياً في ملف البيانات:</p>
               ${dg.map((g, gi) => `<div class="conv-group-days"><b>${esc(g.label)}</b><div class="conv-inline">${weekdayBoxes(state.groupWeekdays[g.key] || [], (d) => `data-gday="${gi}" data-day="${d}"`)}</div></div>`).join("")}`
            : `<div class="conv-inline">${weekdayBoxes(state.datesWeekdays, (d) => `data-day-all="${d}"`)}</div>`}
        ` : ""}
      </div>`;
      }

      html += `
      <div class="conv-section">
        <span class="conv-label">ترقيم تلقائي لعمود (اختياري)</span>
        <select id="conv-autonum">${opt("", "بدون ترقيم تلقائي", !state.autoNumberHeader)}${p.templateHeaders.map((h) => opt(h, h, h === state.autoNumberHeader)).join("")}</select>
        <p class="conv-hint">يملأ هذا العمود بأرقام تسلسلية (1، 2، 3...) بدل قيمة من ملف البيانات${state.groupBy1 ? "، ويبدأ الترقيم من 1 من جديد مع كل مجموعة." : "."}</p>
      </div>`;

      {
        html += `
      <div class="conv-section">
        <span class="conv-label">ترتيب الصفوف أبجدياً حسب عمود (اختياري)</span>
        <select id="conv-sort">${dataOptions(state.sortRowsBy, "بدون ترتيب (نفس ترتيب ملف البيانات)")}</select>
        <p class="conv-hint">يرتّب الصفوف أبجدياً حسب هذا العمود من ملف البيانات (مثل اسم الطالب)${state.groupBy1 ? "، كل مجموعة تُرتَّب بمفردها." : "."}</p>
      </div>`;
      }
    }

    html += `<div class="btn-row conv-final">
      <button type="button" class="btn" id="conv-generate"><span class="material-symbols-outlined btn-ico">download</span>توليد الملف وتنزيله</button>
      <button type="button" class="btn secondary" id="conv-profile-save" title="الربط والتجميع والترقيم والترتيب ومصدر التقدير والمدربين — تُطبَّق تلقائياً مع هذا القالب"><span class="material-symbols-outlined btn-ico">save</span>اعتماد هذه الإعدادات كافتراضية لهذا القالب</button>
    </div>`;
    box.innerHTML = html;
    lastDistinctGroups = distinctGroups();
  }

  let lastDistinctGroups = [];

  async function handleGenerate() {
    const p = state.parsed;
    if (!p) return;
    setError("");
    const groups = activeGroupColumns();
    const sameFormat = (state.outputFormat === "docx") === p.templateIsDocx;

    let sessionDates;
    if (sameFormat && state.datesEnabled && state.outputFormat === "xlsx") {
      if (!state.datesStart || !state.datesEnd) { setError("حدد تاريخ البداية وتاريخ النهاية لتوليد التواريخ"); return; }
      sessionDates = { startDate: state.datesStart, endDate: state.datesEnd };
      if (groups.length > 0) sessionDates.weekdaysByGroup = state.groupWeekdays;
      else if (state.datesWeekdays.length > 0) sessionDates.weekdays = state.datesWeekdays;
    }

    if (!p.dataRows.some(keepRow)) { setError("لم تختر أي مسار؛ حدّد مساراً واحداً على الأقل في «المسارات التي تظهر في الكشف»"); return; }
    reapplyFixed(); // حقول ثابتة أُضيفت أو عُدِّلت بعد التحليل
    // القيم الثابتة تُضاف كأعمدة إلى كل صف ثم تُربط بحقول القالب
    const filled = (() => {
      const mapping = Object.assign({}, state.mapping);
      const keys = Object.keys(state.constants).filter((k) => String(state.constants[k]).length);
      const rows = p.dataRows.filter(keepRow).map((r) => {
        const copy = Object.assign({}, r);
        keys.forEach((k) => { copy[k] = state.constants[k]; });
        return copy;
      });
      keys.forEach((k) => { if (p.templateHeaders.includes(k) && !mapping[k]) mapping[k] = k; });
      return { mapping, rows };
    })();

    setBusy("conv-generate", true, "جارٍ التوليد...");
    try {
      const { blob, filename } = await core().generate({
        templateBuffer: p.templateBuffer,
        templateIsDocx: p.templateIsDocx,
        templateName: outputName(),
        templateHeaders: p.templateHeaders,
        mapping: filled.mapping,
        // نسخة من الصفوف: التوليد يرتّبها داخل المجموعات
        dataRows: filled.rows,
        outputFormat: state.outputFormat,
        groupByColumns: sameFormat && groups.length ? groups : undefined,
        autoNumberHeader: sameFormat ? state.autoNumberHeader || undefined : undefined,
        sortRowsBy: sameFormat ? state.sortRowsBy || undefined : undefined,
        fitGroupToOnePage: sameFormat && (state.outputFormat === "xlsx" || groups.length > 0) && state.fitGroupToOnePage,
        sessionDates,
        textFields: state.textFields,
      });
      const extras = state.extras || [];
      if (!extras.length) {
        ui.download(filename, blob);
        ui.toast("تم توليد الملف");
      } else {
        const zip = new JSZip();
        zip.file(filename, blob);
        for (let i = 0; i < extras.length; i++) {
          const t = extras[i];
          setBusy("conv-generate", true, `جارٍ التوليد ${ui.fmt(i + 2)} من ${ui.fmt(extras.length + 1)}...`);
          const mapping = Object.assign({}, t.mapping);
          Object.keys(state.constants).forEach((k) => { if (t.headers.includes(k) && !mapping[k]) mapping[k] = k; });
          const groupsForExtra = t.defaultGroupBy && t.defaultGroupBy.length
            ? t.defaultGroupBy.map((h) => core().resolveDefaultColumn(h, p.dataHeaders)).filter(Boolean)
            : groups;
          const out = await core().generate({
            templateBuffer: t.buffer,
            templateIsDocx: t.isDocx,
            templateName: t.name,
            templateHeaders: t.headers,
            mapping,
            dataRows: filled.rows.map((r) => Object.assign({}, r)),
            outputFormat: t.isDocx ? "docx" : "xlsx",
            groupByColumns: groupsForExtra.length ? groupsForExtra : undefined,
            autoNumberHeader: t.headers.find((h) => h === state.autoNumberHeader) || undefined,
            fitGroupToOnePage: state.fitGroupToOnePage,
            sessionDates: t.isDocx ? undefined : sessionDates,
          });
          zip.file(out.filename, out.blob);
        }
        ui.download(`قوالب ${ui.fmt(extras.length + 1)} - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
        ui.toast(`تم توليد ${ui.fmt(extras.length + 1)} ملف`);
      }
    } catch (e) {
      console.error(e);
      setError(e && e.message ? e.message : "تعذّر توليد الملف");
    } finally {
      setBusy("conv-generate", false, "⬇ توليد الملف وتنزيله");
    }
  }

  /* ===== الأحداث ===== */
  function onResultChange(e) {
    const t = e.target;
    const p = state.parsed;
    if (t.dataset.gradeFrom != null) { setGradeSource(t.value); return; }
    if (t.dataset.trainerFrom != null) { setTrainerSource(t.value); return; }
    if (t.dataset.trackDataFrom != null) { setTrackDataSource(t.value); return; }
    if (t.dataset.filterCol != null) { state.filterCol = t.value; state.filterOut = new Set(); renderResult(); return; }
    if (t.dataset.filterVal != null) {
      if (t.checked) state.filterOut.delete(t.dataset.filterVal); else state.filterOut.add(t.dataset.filterVal);
      const c = $("conv-filter-count");
      if (c) c.textContent = filterCountText();
      return;
    }
    if (t.dataset.map != null) {
      const header = p.templateHeaders[Number(t.dataset.map)];
      state.mapping[header] = t.value;
      state.userMappings = state.userMappings || {};
      state.userMappings[header] = true;
      renderResult();
      return;
    }
    if (t.dataset.tf != null) {
      const list = state.textFields || [];
      const f = list[Number(t.dataset.tf)];
      if (!f) return;
      if (t.dataset.kind === "date") {
        f.iso = t.value;
        f.value = t.value ? dateArabic(t.value) : "";
        // اسم اليوم يُملأ من التاريخ نفسه ما لم يختره المستخدم يدوياً
        const dayField = list.find((x) => isDayField(x.label));
        if (dayField && t.value) dayField.value = dayOfIso(t.value);
      } else if (t.dataset.kind === "time") {
        f.raw = t.value;
        f.value = t.value ? timeArabic(t.value) : "";
      } else f.value = t.value.trim();
      renderResult();
      return;
    }
    if (t.dataset.ageFrom !== undefined) {
      const p = state.parsed;
      const data = { headers: p.dataHeaders, rows: p.dataRows };
      state.age = core().addAgeColumn(data, t.value);
      p.dataHeaders = data.headers;
      // حقل العمر في القالب يتبع الاختيار
      const norm = core().normalizeHeader;
      p.templateHeaders.forEach((h) => {
        if (!/العمر|السن/.test(norm(h))) return;
        if (state.age.from) state.mapping[h] = core().AGE_COLUMN;
        else if (state.mapping[h] === core().AGE_COLUMN) delete state.mapping[h];
      });
      renderResult();
      return;
    }
    if (t.dataset.pick != null) {
      state.exportOpen = true;
      state.pickHidden = state.pickHidden || new Set();
      if (t.checked) state.pickHidden.delete(t.dataset.pick); else state.pickHidden.add(t.dataset.pick);
      renderResult();
      return;
    }
    if (t.dataset.constTime != null) {
      state.missingOpen = true;
      state.constTimes = state.constTimes || {};
      const key = t.dataset.constTime;
      if (t.value) { state.constTimes[key] = t.value; state.constants[key] = timeArabic(t.value); }
      else { delete state.constTimes[key]; delete state.constants[key]; }
      renderResult();
      return;
    }
    if (t.dataset.const != null) {
      state.missingOpen = true;
      const key = t.dataset.const;
      if (t.value.trim()) state.constants[key] = t.value.trim(); else delete state.constants[key];
      return;
    }
    switch (t.id) {
      case "conv-group1": state.groupBy1 = t.value; if (!t.value || t.value === state.groupBy2) state.groupBy2 = ""; state.groupWeekdays = {}; break;
      case "conv-group2": state.groupBy2 = t.value; state.groupWeekdays = {}; break;
      case "conv-fit": state.fitGroupToOnePage = t.checked; return;
      case "conv-dates": state.datesEnabled = t.checked; break;
      case "conv-dates-start": state.datesStart = t.value; return;
      case "conv-dates-end": state.datesEnd = t.value; return;
      case "conv-autonum": state.autoNumberHeader = t.value; break;
      case "conv-sort": state.sortRowsBy = t.value; return;
      default:
        if (t.dataset.gday != null) {
          const key = lastDistinctGroups[Number(t.dataset.gday)].key;
          const day = Number(t.dataset.day);
          const current = state.groupWeekdays[key] || [];
          state.groupWeekdays[key] = t.checked ? [...current, day].sort() : current.filter((d) => d !== day);
          return;
        }
        if (t.dataset.dayAll != null) {
          const day = Number(t.dataset.dayAll);
          state.datesWeekdays = t.checked ? [...state.datesWeekdays, day].sort() : state.datesWeekdays.filter((d) => d !== day);
          return;
        }
        return;
    }
    renderResult();
  }

  async function onResultClick(e) {
    const up = e.target.closest("[data-col-up]");
    if (up) { moveExportCol(up.dataset.colUp, -1); return; }
    const down = e.target.closest("[data-col-down]");
    if (down) { moveExportCol(down.dataset.colDown, 1); return; }
    if (e.target.closest("[data-pick-all]")) { state.exportOpen = true; state.pickHidden = new Set(); renderResult(); return; }
    if (e.target.closest("[data-pick-none]")) {
      state.exportOpen = true;
      state.pickHidden = new Set(allExportCols());
      renderResult();
      return;
    }
    if (e.target.closest("[data-filter-all]")) { state.filterOut = new Set(); renderResult(); return; }
    if (e.target.closest("[data-filter-none]")) { state.filterOut = new Set(filterValues().map(([v]) => v)); renderResult(); return; }
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.out) { state.outputFormat = t.dataset.out; renderResult(); return; }
    if (t.id === "conv-export-xlsx") { exportPickedXlsx(); return; }
    if (t.id === "conv-generate") { handleGenerate(); return; }
    if (t.id === "conv-profile-save") { saveProfile(); return; }
    if (t.id === "conv-profile-delete") { deleteProfile(); return; }
    if (t.id === "conv-save-default") {
      try {
        await store().setDefaultGroupBy(state.parsed.savedId, activeGroupColumns());
        await refreshSaved();
        ui.toast("تم حفظ التجميع الافتراضي لهذا القالب");
      } catch (err) {
        setError(err.message);
      }
    }
  }

  /* تبويبات الصفحة: كل أداة في تبويب باسمها، ويُحفظ آخر تبويب فُتح */
  const TAB_KEY = "tamkeen-conv-tab";
  function initTabs() {
    const tabs = [...document.querySelectorAll("[data-cv-tab]")];
    const panes = [...document.querySelectorAll("[data-cv-pane]")];
    if (!tabs.length) return;
    const show = (key) => {
      const k = panes.some((p) => p.dataset.cvPane === key) ? key : panes[0].dataset.cvPane;
      tabs.forEach((t) => {
        const on = t.dataset.cvTab === k;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panes.forEach((p) => { p.hidden = p.dataset.cvPane !== k; });
      try { localStorage.setItem(TAB_KEY, k); } catch (e) { /* وضع التصفح الخاص */ }
    };
    tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.cvTab)));
    let last = "";
    try { last = localStorage.getItem(TAB_KEY) || ""; } catch (e) { /* يكفي الأول */ }
    show(last || panes[0].dataset.cvPane);
  }

  function init() {
    initTabs();
    document.querySelectorAll("[data-conv-mode]").forEach((b) =>
      b.addEventListener("click", () => { state.mode = b.dataset.convMode; renderSource(); })
    );
    $("conv-saved-select").addEventListener("change", (e) => { state.selectedSavedId = e.target.value; renderExtraTemplates(); });
    $("conv-multi-list").addEventListener("change", (e) => {
      const id = e.target.dataset.extraTpl;
      if (!id) return;
      if (e.target.checked) state.extraSavedIds.push(id);
      else state.extraSavedIds = state.extraSavedIds.filter((x) => x !== id);
      // تحديث العدّاد فقط؛ إعادة بناء القائمة هنا تُفقد بقية المربعات
      $("conv-multi-count").textContent = state.extraSavedIds.length
        ? `سيخرج ${ui.fmt(state.extraSavedIds.length + 1)} ملف في ملف مضغوط واحد`
        : "";
    });
    $("conv-saved-download").addEventListener("click", handleDownloadSaved);
    $("conv-saved-delete").addEventListener("click", handleDeleteSaved);
    $("conv-save-toggle").addEventListener("click", () => { $("conv-save-form").hidden = false; $("conv-save-toggle").hidden = true; $("conv-save-name").focus(); });
    $("conv-save-cancel").addEventListener("click", () => { $("conv-save-form").hidden = true; $("conv-save-toggle").hidden = false; $("conv-save-error").textContent = ""; });
    $("conv-save-btn").addEventListener("click", handleSaveTemplate);
    $("conv-parse").addEventListener("click", handleParse);
    // الخطوة ①: دمج الملفات
    $("mg-files").addEventListener("change", (e) => onMergeFiles(e.target.files));
    // إكمال الناقص من نظام المركز
    $("fx-sys").addEventListener("change", (e) => onFxSystem(e.target.files));
    $("fx-mine").addEventListener("change", (e) => onFxMine(e.target.files));
    $("fx-copy-script").addEventListener("click", async () => {
      try {
        const txt = await (await fetch("tools/ksach-students.js")).text();
        await navigator.clipboard.writeText(txt);
        ui.toast("نُسخ السكربت — الصقه في Console داخل نظام المركز");
      } catch (e) { ui.toast("تعذّر النسخ؛ استعمل «أو نزّله ملفاً»"); }
    });
    $("fx-body").addEventListener("change", (e) => {
      if (e.target.id === "fx-judge") { state.fx.judge = e.target.checked; return; }
      if (e.target.id === "fx-cur") { state.fx.cur = e.target.value; return renderFill(); }
      const gi = e.target.dataset.fxNid;
      if (gi != null) {
        const g = fxGroups()[Number(gi)];
        if (g) { g.files.forEach((m) => { m.nidCol = e.target.value; }); delete state.fx.map[g.sig]; fxGuess(); }
        return renderFill();
      }
      const col = e.target.dataset.fxMap;
      if (col == null) return;
      const g2 = fxGroups()[Number(e.target.dataset.fxSig)];
      if (!g2) return;
      state.fx.map[g2.sig] = state.fx.map[g2.sig] || {};
      if (e.target.value) state.fx.map[g2.sig][col] = e.target.value; else delete state.fx.map[g2.sig][col];
      renderFill();
    });
    $("fx-body").addEventListener("click", (e) => {
      if (e.target.closest("#fx-toggle-all")) { state.fx.showAll = !state.fx.showAll; return renderFill(); }
      if (e.target.closest("#fx-run")) fxDownload().catch((err) => ui.toast(err.message));
      if (e.target.closest("#fx-cmp")) fxCompareDownload().catch((err) => ui.toast(err.message));
    });
    // الاستخراج السريع
    $("qx-file").addEventListener("change", (e) => onQuickFile(e.target.files));
    $("qx-body").addEventListener("change", (e) => {
      if (!state.qx) return;
      const col = e.target.dataset.qxCol;
      if (col == null) return;
      if (e.target.checked) state.qx.hidden.delete(col); else state.qx.hidden.add(col);
      renderQuick();
    });
    $("qx-body").addEventListener("input", (e) => {
      if (!state.qx || e.target.id !== "qx-q") return;
      state.qx.q = e.target.value;
      renderQuick();
      const el = $("qx-q");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
    $("qx-body").addEventListener("click", (e) => {
      if (!state.qx) return;
      if (e.target.closest("[data-qx-all]")) { state.qx.hidden.clear(); return renderQuick(); }
      if (e.target.closest("[data-qx-none]")) { state.qx.headers.forEach((h) => state.qx.hidden.add(h)); return renderQuick(); }
      if (e.target.closest("[data-qx-print]")) return qxPrint();
      if (e.target.closest("[data-qx-xlsx]")) return qxExcel().catch((err) => ui.toast(err.message));
      if (e.target.closest("[data-qx-docx]")) return qxWord();
    });
    // البيانات الثابتة: تُحفظ أثناء الكتابة، ويُعاد الرسم عند الإضافة والحذف فقط
    $("fx-list").addEventListener("input", (e) => {
      const i = e.target.dataset.fxName != null ? e.target.dataset.fxName : e.target.dataset.fxValue;
      if (i == null) return;
      const list = fixedFields().map((f) => Object.assign({}, f));
      list[Number(i)][e.target.dataset.fxName != null ? "name" : "value"] = e.target.value;
      saveFixed(list);
    });
    $("fx-list").addEventListener("click", (e) => {
      const i = e.target.dataset.fxDel;
      if (i == null) return;
      const list = fixedFields().map((f) => Object.assign({}, f));
      list.splice(Number(i), 1);
      saveFixed(list);
      renderFixed();
    });
    $("fx-add").addEventListener("click", () => {
      saveFixed(fixedFields().map((f) => Object.assign({}, f)).concat({ name: "", value: "" }));
      renderFixed();
      const inputs = $("fx-list").querySelectorAll("[data-fx-name]");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    renderFixed();
    $("mg-body").addEventListener("change", (e) => {
      if (e.target.name === "mg-mark") {
        state.mg.mark = e.target.value;
        $("mg-preview-box").innerHTML = mgPreview();
        return;
      }
      const col = e.target.dataset.mgCol;
      if (col != null) {
        if (e.target.checked) state.mg.hidden.delete(col); else state.mg.hidden.add(col);
        $("mg-col-count").textContent = mgColCount();
        $("mg-preview-box").innerHTML = mgPreview();
        return;
      }
      const i = e.target.dataset.mgKey;
      if (i == null) return;
      state.mg.files[Number(i)].key = e.target.value;
      state.mg.merged = null; // عمود ربط جديد يحتاج دمجاً جديداً
      renderMerge();
    });
    $("mg-body").addEventListener("click", (e) => {
      if (e.target.closest("[data-mg-all]")) { state.mg.hidden = new Set(); renderMerge(); return; }
      if (e.target.closest("[data-mg-none]")) { state.mg.hidden = new Set(state.mg.merged.headers); renderMerge(); return; }
      if (e.target.id === "mg-run") runMerge();
      else if (e.target.id === "mg-download") downloadMerged().catch((err) => ui.toast(err.message));
      else if (e.target.id === "mg-use") useMerged();
    });
    $("conv-merged-clear").addEventListener("click", () => { state.mergedData = null; renderMergedChip(); });
    $("conv-data-file").addEventListener("change", () => { if ($("conv-data-file").files.length) { state.mergedData = null; renderMergedChip(); } });
    $("conv-share-now").addEventListener("click", shareNow);
    $("conv-share-again").addEventListener("click", async () => {
      if (!confirm("إعادة القوالب المحذوفة من القائمة المشتركة من نسخة هذا الجهاز؟ ستظهر لكل المستخدمين من جديد.")) return;
      const b = $("conv-share-again");
      b.disabled = true;
      try {
        const n = await store().reshare();
        ui.toast(`أُعيدت مشاركة ${ui.fmt(n)} قالباً`);
        if (App.shared) await App.shared.sync(true);
      } catch (e) { ui.toast(e.message); }
      b.disabled = false;
      await refreshSaved();
    });
    $("conv-result").addEventListener("change", onResultChange);
    $("conv-result").addEventListener("input", (e) => { if (e.target.dataset.const != null) onResultChange(e); });
    $("conv-result").addEventListener("click", onResultClick);
    // سحب حقول التصدير لتغيير ترتيب الأعمدة
    let dragCol = "";
    $("conv-result").addEventListener("dragstart", (e) => {
      const li = e.target.closest("[data-col]");
      if (!li) return;
      dragCol = li.dataset.col;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    $("conv-result").addEventListener("dragover", (e) => { if (dragCol && e.target.closest("[data-col]")) e.preventDefault(); });
    $("conv-result").addEventListener("drop", (e) => {
      const li = e.target.closest("[data-col]");
      if (!dragCol || !li) return;
      e.preventDefault();
      const target = li.dataset.col;
      const from = dragCol;
      dragCol = "";
      if (from !== target) moveExportCol(from, target);
    });
    $("conv-result").addEventListener("dragend", () => {
      dragCol = "";
      const el = $("conv-result").querySelector(".dragging");
      if (el) el.classList.remove("dragging");
    });

    refreshSaved().then(() => {
      if (state.savedTemplates.length > 0) { state.mode = "saved"; renderSource(); }
    });
  }

  /* بيانات جاهزة من صفحة «جداول البيانات» تُعتمد ملفَ بيانات هنا */
  async function useData(headers, rows, label, opts) {
    state.mergedData = { headers: headers.slice(), rows: rows.map((r) => Object.assign({}, r)), count: rows.length, label };
    $("conv-data-file").value = "";
    renderMergedChip();
    // من «أوامر المركز»: القالب (أو القوالب) محدد مسبقاً فنفتح خطوة المطابقة مباشرة
    const want = (opts && opts.templateIds) || [];
    if (want.some((id) => !state.savedTemplates.some((t) => t.id === id))) await refreshSaved();
    const ids = want.filter((id) => state.savedTemplates.some((t) => t.id === id));
    if (ids.length) {
      state.mode = "saved";
      state.selectedSavedId = ids[0];
      state.extraSavedIds = ids.slice(1);
      renderSource();
      const tab = document.querySelector('[data-cv-tab="tpl"]');
      if (tab) tab.click();
      if (opts.autoParse) { handleParse(); return; }
    }
    ui.toast("اختر القالب ثم اضغط «تحليل الملفين»");
    $("conv-parse").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  App.converter = { init, render: renderSource, refresh: refreshSaved, useData, fixedFields };
})(window.App = window.App || {});
