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
    selectedSavedId: "",
    extraSavedIds: [], // قوالب محفوظة إضافية: يُولَّد ملف لكل قالب من نفس البيانات
    parsed: null, // { templateHeaders, dataHeaders, dataRows, truncated, templateBuffer, templateIsDocx, templateName, savedId }
    mapping: {},
    constants: {}, // قيمة ثابتة لكل حقل لا يوجد له عمود في ملف البيانات
    missingOpen: false, // مربع الحقول الناقصة مطوي حتى يفتحه المستخدم
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
      state.savedTemplates = await store().list();
    } catch (e) {
      state.savedTemplates = [];
      console.error(e);
    }
    renderSource();
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

  /* ملف بيانات واحد، أو عدة ملفات لنفس الأشخاص تُدمج في صف واحد لكل شخص */
  async function readData(files) {
    state.merge = null;
    if (files.length === 1) return core().readDataFile(await readFile(files[0]));
    const list = [];
    for (const f of files) {
      let d;
      try { d = await core().readDataFile(await readFile(f)); } catch (e) { throw new Error(`«${f.name}»: ${e.message}`); }
      list.push({ name: f.name.replace(/\.xlsx$/i, ""), headers: d.headers, rows: d.rows, truncated: d.truncated });
    }
    const m = core().mergeDataFiles(list);
    state.merge = { files: list, key: m.key, keys: m.keys, stats: m.stats };
    return { headers: m.headers, rows: m.rows, truncated: list.some((x) => x.truncated) };
  }

  /* تغيير عمود الربط: تتغيّر الصفوف وحدها، وتبقى الأعمدة والربط والقيم المكتوبة كما هي */
  function remerge(key) {
    const m = core().mergeDataFiles(state.merge.files, key);
    state.merge = Object.assign(state.merge, { key: m.key, keys: m.keys, stats: m.stats });
    state.parsed.dataRows = m.rows;
    renderResult();
  }

  function mergeSummary() {
    const m = state.merge;
    if (!m) return "";
    const st = m.stats;
    const files = st.perFile.map((f) => `<li><b>${esc(f.name)}</b>: ${ui.fmt(f.rows)} صفاً${f.missing
      ? ` — <span class="warn">ليس فيه ${ui.fmt(f.missing)} شخصاً</span>: ${f.missingNames.map(esc).join("، ")}${f.missing > f.missingNames.length ? "…" : ""}`
      : " — فيه كل الأشخاص"}</li>`).join("");
    return `<div class="conv-section conv-merge">
      <h3>📎 دُمجت ${ui.fmt(m.files.length)} ملفات لنفس الأشخاص</h3>
      <label class="conv-merge-key">الربط بين الملفات بعمود
        <select data-merge-key>${m.keys.map((k) => opt(k, k, k === m.key)).join("")}</select></label>
      <p><b>${ui.fmt(st.total)}</b> شخصاً، منهم <b>${ui.fmt(st.inAll)}</b> موجودون في كل الملفات.</p>
      <ul>${files}</ul>
      ${st.conflicts ? `<p class="warn">⚠ ${ui.fmt(st.conflicts)} قيمة مختلفة للشخص نفسه بين الملفات؛ أُخذت قيمة الملف الأول.</p>` : ""}
      ${st.noKey ? `<p class="warn">⚠ ${ui.fmt(st.noKey)} صفاً بلا قيمة في عمود الربط؛ أُضيفت كما هي دون دمج.</p>` : ""}
    </div>`;
  }

  async function handleParse() {
    setError("");
    if (!librariesReady()) { setError("تعذّر تحميل مكتبات Excel/Word من مجلد vendor."); return; }
    const dataFiles = [...$("conv-data-file").files];
    if (!dataFiles.length) { setError("اختر ملف البيانات"); return; }

    let templateBuffer, templateIsDocx, templateName, savedId = null, templateHeaders = null;
    if (state.mode === "upload") {
      const templateFile = $("conv-template-file").files[0];
      if (!templateFile) { setError("اختر ملف القالب"); return; }
      templateBuffer = await readFile(templateFile);
      templateIsDocx = core().isDocxName(templateFile.name);
      templateName = templateFile.name.replace(/\.[^.]+$/, "") || "converted";
    } else {
      let saved;
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
      state.mapping = core().suggestColumnMapping(templateHeaders, data.headers);
      state.constants = {};
      const placeholders = await core().readTemplatePlaceholders(templateBuffer, templateIsDocx);
      // حقول القالب التي لا يوجد لها عمود في ملف البيانات ولا في عناوين القالب
      const norm = core().normalizeHeader;
      const dataNorm = data.headers.map(norm);
      state.extraFields = placeholders.filter((ph) => {
        const n = norm(ph);
        return !dataNorm.some((d) => d === n || d.includes(n) || n.includes(d)) && !templateHeaders.some((h) => norm(h) === n) && !/^تاريخ\d+$/.test(ph);
      });
      state.outputFormat = templateIsDocx ? "docx" : "xlsx";
      await prepareExtras(data);

      const defaults = (savedId && selectedSaved() && selectedSaved().defaultGroupBy) || [];
      const usable = defaults.map((h) => core().resolveDefaultColumn(h, data.headers)).filter(Boolean);
      state.groupBy1 = usable[0] || "";
      state.groupBy2 = usable[1] || "";
      state.autoNumberHeader = "";
      state.sortRowsBy = "";
      state.groupWeekdays = {};
      state.datesWeekdays = [];
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
      const mapping = core().suggestColumnMapping(headers, data.headers);
      const placeholders = await core().readTemplatePlaceholders(buffer, isDocx);
      const extraFields = placeholders.filter((ph) => {
        const n = norm(ph);
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
    let html = mergeSummary();
    if (missing.length || extra.length) {
      const field = (name, hint) => `
        <div class="conv-map-row">
          <span>${esc(name)}${hint ? `<small class="conv-hint"> ${esc(hint)}</small>` : ""}</span>
          <input type="text" data-const="${esc(name)}" value="${esc(state.constants[name] || "")}" placeholder="اكتب القيمة لتُوضع في كل الصفوف">
        </div>`;
      const filledCount = missing.concat(extra).filter((f) => state.constants[f]).length;
      html += `<details class="conv-section conv-missing" id="conv-missing" ${state.missingOpen ? "open" : ""}>
        <summary>⚠ حقول لم نجد لها بيانات في ملفك (${ui.fmt(missing.length + extra.length)})${filledCount ? ` — عُبِّئ ${ui.fmt(filledCount)}` : ""} — اضغط للعرض</summary>
        <p class="conv-hint">اكتب قيمة كل حقل هنا، فتُوضع كما هي في كل صفوف القالب. أو اتركه فارغاً ليبقى فارغاً، أو اربطه بعمود من ملف البيانات في القائمة أدناه. وأعمدة التسلسل مثل «م» تُملأ من خيار «ترقيم تلقائي لعمود» أسفل الصفحة.</p>
        <div class="conv-mapping">
          ${missing.map((h) => field(h, "عمود في جدول القالب")).join("")}
          ${extra.map((ph) => field(ph, "حقل في ترويسة القالب")).join("")}
        </div>
      </details>`;
    }
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

      if (state.outputFormat === "xlsx") {
        html += `
      <div class="conv-section">
        <span class="conv-label">ترتيب الصفوف أبجدياً حسب عمود (اختياري)</span>
        <select id="conv-sort">${dataOptions(state.sortRowsBy, "بدون ترتيب (نفس ترتيب ملف البيانات)")}</select>
        <p class="conv-hint">يرتّب الصفوف أبجدياً حسب هذا العمود من ملف البيانات (مثل اسم الطالب)${state.groupBy1 ? "، كل مجموعة تُرتَّب بمفردها." : "."}</p>
      </div>`;
      }
    }

    html += `<button type="button" class="btn" id="conv-generate">⬇ توليد الملف وتنزيله</button>`;
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

    // القيم الثابتة تُضاف كأعمدة إلى كل صف ثم تُربط بحقول القالب
    const filled = (() => {
      const mapping = Object.assign({}, state.mapping);
      const keys = Object.keys(state.constants).filter((k) => String(state.constants[k]).length);
      const rows = p.dataRows.map((r) => {
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
        templateName: p.templateName,
        templateHeaders: p.templateHeaders,
        mapping: filled.mapping,
        // نسخة من الصفوف: التوليد يرتّبها داخل المجموعات
        dataRows: filled.rows,
        outputFormat: state.outputFormat,
        groupByColumns: sameFormat && groups.length ? groups : undefined,
        autoNumberHeader: sameFormat ? state.autoNumberHeader || undefined : undefined,
        sortRowsBy: sameFormat && state.outputFormat === "xlsx" ? state.sortRowsBy || undefined : undefined,
        fitGroupToOnePage: sameFormat && (state.outputFormat === "xlsx" || groups.length > 0) && state.fitGroupToOnePage,
        sessionDates,
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
    if (t.dataset.mergeKey != null) { remerge(t.value); return; }
    if (t.dataset.map != null) {
      state.mapping[p.templateHeaders[Number(t.dataset.map)]] = t.value;
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
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.out) { state.outputFormat = t.dataset.out; renderResult(); return; }
    if (t.id === "conv-generate") { handleGenerate(); return; }
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

  function init() {
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

    refreshSaved().then(() => {
      if (state.savedTemplates.length > 0) { state.mode = "saved"; renderSource(); }
    });
  }

  App.converter = { init, render: renderSource, refresh: refreshSaved };
})(window.App = window.App || {});
