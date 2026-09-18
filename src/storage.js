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
    return { tracks: defaultTracks(), tasks: [], customTemplates: [], signer: "" };
  }

  let state;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.warn("تعذّر قراءة البيانات المحفوظة، سيتم استخدام القيم الافتراضية.", e);
      state = defaultState();
    }
    return state;
  }

  const listeners = [];

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
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

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));

  App.store = {
    KEY, TOTAL_HOURS, PROJECT, uid, clamp,
    load, save, reset, exportJSON, importJSON,
    get: () => state,
    onChange: (fn) => listeners.push(fn),
  };
})(window.App = window.App || {});
