/* طبقة الحفظ — localStorage حالياً، ويمكن استبدالها بقاعدة بيانات لاحقاً دون تعديل بقية الوحدات */
(function (App) {
  const KEY = "tamkeen-admin:v1";
  const TOTAL_HOURS = 130;

  const PROJECT = {
    name: "مشروع تمكين (PP-003)",
    org: "مركز مسارات التمكين للتدريب والتطوير",
    funders: "مركز الملك سلمان للإغاثة والأعمال الإنسانية والمركز السعودي للأعمال الإنسانية",
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultTracks() {
    const rows = [
      ["الخياطة والتفصيل", "craft"],
      ["صيانة الأجهزة الكهربائية", "craft"],
      ["النجارة والأثاث", "craft"],
      ["الطهي وصناعة الحلويات", "craft"],
      ["التجميل والعناية الشخصية", "craft"],
      ["التصميم الجرافيكي", "digital"],
      ["التسويق الرقمي", "digital"],
      ["صيانة الحاسب والشبكات", "digital"],
    ];
    return rows.map(([name, type]) => ({
      id: uid(), name, type, beneficiaries: 125, attendancePct: 0, hoursCompleted: 0,
    }));
  }

  function defaultState() {
    return { tracks: defaultTracks(), trackCodes: App.trackCatalog ? [...App.trackCatalog.paths, ...App.trackCatalog.codes] : [], tasks: [], customTemplates: [], signer: "", registry: [], meetings: [], letterApprovals: [] };
  }

  let state;
  let lastRaw = null; // آخر نسخة محفوظة قرأها أو كتبها هذا التبويب

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      lastRaw = raw;
      state = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.warn("تعذّر قراءة البيانات المحفوظة، سيتم استخدام القيم الافتراضية.", e);
      state = defaultState();
    }
    return state;
  }

  const listeners = [];
  const external = [];

  function save() {
    try {
      const raw = JSON.stringify(state);
      localStorage.setItem(KEY, raw);
      lastRaw = raw;
    } catch (e) {
      App.ui && App.ui.toast("تعذّر حفظ البيانات في المتصفح");
    }
    listeners.forEach((fn) => fn(state));
  }

  function exportJSON() {
    return JSON.stringify({ app: "tamkeen-admin", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.tasks)) {
      throw new Error("ملف غير صالح");
    }
    state = Object.assign(defaultState(), data);
    save();
  }

  function reset() {
    state = defaultState();
    save();
  }

  /* تبويب آخر من الموقع حفظ بعدنا: تُؤخذ نسخته. بدون هذا يبقى هذا التبويب ببيانات قديمة في الذاكرة،
     بينما بصمات المزامنة (المشتركة بين التبويبات) تعرف سجلات لا يملكها، فيُرسلها للخادم محذوفة.
     تُستدعى قبل كل مزامنة، وعند كل حفظ من تبويب آخر. التحديث في المكان نفسه حتى تبقى المراجع صحيحة. */
  function reloadIfChanged() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
    if (!raw || raw === lastRaw || !state) return false;
    let next;
    try { next = JSON.parse(raw); } catch (e) { return false; }
    Object.keys(state).forEach((k) => { delete state[k]; });
    const base = defaultState();
    delete base.tracks; // المسارات الافتراضية بمعرّفات جديدة تُرفع كمسارات إضافية
    Object.assign(state, base, { tracks: [] }, next);
    lastRaw = raw;
    external.forEach((fn) => { try { fn(state); } catch (e) { console.warn(e); } });
    return true;
  }
  try { window.addEventListener("storage", (e) => { if (e.key === KEY) reloadIfChanged(); }); } catch (e) { /* بيئة بلا نافذة */ }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));

  App.store = {
    KEY, TOTAL_HOURS, PROJECT, uid, clamp,
    load, save, reset, exportJSON, importJSON,
    get: () => state,
    onChange: (fn) => listeners.push(fn),
    // لإعادة الرسم فقط عند حفظ تبويب آخر؛ لا تُطلق مزامنة حتى لا يتقاذف التبويبان الطلبات
    onExternal: (fn) => external.push(fn),
    reloadIfChanged,
  };
})(window.App = window.App || {});
