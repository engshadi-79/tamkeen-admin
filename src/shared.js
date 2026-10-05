/* مزامنة بقية الأقسام مع خادم المركز: المسارات والمهام والمحاضر والقوالب والإعدادات،
   حتى يرى كل المستخدمين البيانات نفسها. القاعدة كما في سجل الوارد والصادر: الأحدث تعديلاً يفوز،
   والعنصر المحذوف على جهاز يُحذف عند الجميع. سجل الوارد والصادر له مزامنته الخاصة في registry.js. */
(function (App) {
  const { store, ui } = App;
  const SNAP_KEY = "tamkeen-admin:sync2";
  const SETTINGS_KEYS = ["registrySettings", "reportSettings", "rosterMeta", "aiSettings", "signer", "signerTitle", "fixedFields", "convDefaults", "hospitalityRows", "reportModel"];
  const COLS = ["tracks", "trackCodes", "tasks", "meetings", "customTemplates", "roster", "settings", "convTemplates", "hospitality", "sheets", "sheetRows", "letterApprovals", "reportPresets"];
  let syncing = false, again = false, timer = null, people = [];
  const LABELS = { tracks: "المسارات", trackCodes: "دليل ترميز المسارات والمراحل", tasks: "المهام", meetings: "المحاضر", customTemplates: "القوالب", roster: "قائمة المستفيدين", settings: "الإعدادات", convTemplates: "قوالب التحويل", hospitality: "كشف الضيافة", sheets: "جداول البيانات", sheetRows: "صفوف الجداول", letterApprovals: "طلبات اعتماد المراسلات", reportPresets: "التقارير المحفوظة" };
  const confirmedWipe = {}; // أقسام وافق المستخدم على حذفها الجماعي من هذا الجهاز
  const blocked = {};

  /* يسمح بحذف جماعي متعمّد (مثل «حذف القائمة») لمرة واحدة */
  function allowWipe(name) { confirmedWipe[name] = true; }

  /* الإعدادات ليست مصفوفة: تُعامل كعناصر { id: اسم الإعداد, value } */
  function readCol(name) {
    if (name !== "settings") return (store.get()[name] = store.get()[name] || []);
    return SETTINGS_KEYS
      // إعداد فارغ لا يُرفع فوق إعداد موجود (مثل تعريف أعمدة القائمة)
      .filter((k) => store.get()[k] !== undefined && !(k === "rosterMeta" && !(store.get()[k].columns || []).length))
      .map((k) => ({ id: k, value: store.get()[k], updatedAt: (store.get().settingsAt || {})[k] || "" }));
  }

  function writeCol(name, records) {
    if (name !== "settings") { store.get()[name] = records; return; }
    const at = (store.get().settingsAt = store.get().settingsAt || {});
    records.forEach((r) => {
      // تعريف أعمدة القائمة لا يُستبدل بنسخة فارغة
      if (r.id === "rosterMeta" && !((r.value || {}).columns || []).length && ((store.get().rosterMeta || {}).columns || []).length) return;
      store.get()[r.id] = r.value;
      at[r.id] = r.updatedAt || "";
    });
  }

  function fingerprint(r) {
    const copy = Object.assign({}, r);
    delete copy.updatedAt;
    const s = JSON.stringify(copy);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }
  /* ردّ الخادم لا يحفظ الترتيب (تعديل سجل يغيّر موضعه في قاعدة البيانات)، فيُعاد ترتيبه
     على ترتيب الجهاز، ويُلحق ما لا يعرفه الجهاز في آخر القائمة بترتيب وصوله */
  function keepOrder(records, local) {
    const pos = new Map(local.map((r, i) => [r.id, i]));
    return records
      .map((r, i) => [r, pos.has(r.id) ? pos.get(r.id) : local.length + i])
      .sort((a, b) => a[1] - b[1])
      .map((x) => x[0]);
  }
  const loadSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "{}"); } catch (e) { return {}; } };
  const saveSnap = (snap) => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) { /* تخزين غير متاح */ } };

  /* أول مزامنة على هذا الجهاز: تُقرأ بيانات الخادم أولاً ثم يُحسم مصدر كل قسم */
  async function firstSync() {
    const server = await App.cloud.syncAll({});
    const snap = {};
    const push = {};
    COLS.forEach((name) => {
      const local = readCol(name);
      if (!server[name] || !Array.isArray(server[name].records)) { push[name] = true; return; } // قسم لا يعرفه الخادم
      const remote = server[name].records;
      const takeServer = () => { writeCol(name, remote); snap[name] = {}; remote.forEach((r) => { snap[name][r.id] = fingerprint(r); }); };
      if (!remote.length) { push[name] = true; return; } // الخادم فارغ: تُرفع بيانات هذا الجهاز
      if (name === "tracks" || name === "settings") { takeServer(); return; }
      // بقية الأقسام: تُعتمد نسخة الخادم، ويُحتفظ فقط بما أنشئ على هذا الجهاز خلال 24 ساعة
      const fresh = Date.now() - 24 * 3600 * 1000;
      const ids = new Set(remote.map((r) => r.id));
      const mine = local.filter((r) => !ids.has(r.id) && Date.parse(r.createdAt || r.addedAt || 0) > fresh);
      writeCol(name, keepOrder(remote.concat(mine), local));
      snap[name] = {};
      remote.forEach((r) => { snap[name][r.id] = fingerprint(r); });
    });
    saveSnap(snap);
    store.save();
    return push;
  }

  async function sync(showErrors) {
    if (!App.cloud || !App.cloud.ready()) return;
    if (syncing) { again = true; return; }
    syncing = true;
    clearTimeout(timer);
    try {
      // بيانات أحدث حفظها تبويب آخر تُؤخذ قبل حساب المحذوف
      store.reloadIfChanged();
      let snap = loadSnap();
      if (!Object.keys(snap).length) { await firstSync(); snap = loadSnap(); }
      const now = new Date().toISOString();
      const cols = {};
      const sentPrints = {};
      COLS.forEach((name) => {
        const local = readCol(name);
        const mine = snap[name] || {};
        const changed = local.filter((r) => mine[r.id] !== fingerprint(r));
        changed.forEach((r) => { r.updatedAt = now; });
        const ids = new Set(local.map((r) => r.id));
        const deleted = {};
        Object.keys(mine).forEach((id) => { if (!ids.has(id)) deleted[id] = now; });
        // حماية: حذف جماعي مفاجئ (جهاز فُتح بنسخة قديمة أو مُسحت بياناته) لا يُرسل إلا بتأكيد
        const count = Object.keys(deleted).length;
        const known = Object.keys(mine).length;
        if (count > 10 && known && count >= known * 0.5 && !confirmedWipe[name]) {
          console.warn(`مزامنة ${name}: أُوقف حذف ${count} عنصراً من ${known} على هذا الجهاز`);
          ui.toast(`أُوقفت مزامنة حذف ${ui.fmt(count)} عنصراً من «${LABELS[name] || name}» على هذا الجهاز حمايةً للبيانات`);
          cols[name] = { records: local, deleted: {} };
          blocked[name] = count;
          return;
        }
        // قسم بلا تغييرات يُرسل فارغاً: الخادم يرجعه للقراءة فقط بلا كتابة
        cols[name] = changed.length || Object.keys(deleted).length ? { records: local, deleted } : { records: [], deleted: {} };
        // بصمة ما أُرسل: ما يتغيّر بعدها (نقر المستخدم أثناء الطلب) يُحافظ عليه عند وصول الرد
        sentPrints[name] = {};
        local.forEach((r) => { sentPrints[name][r.id] = fingerprint(r); });
      });
      const merged = await App.cloud.syncAll(cols);
      const next = {};
      const skipped = [];
      COLS.forEach((name) => {
        if (!merged[name] || !Array.isArray(merged[name].records)) {
          // الخادم لا يعرف هذا القسم بعد: تبقى بيانات الجهاز كما هي
          next[name] = snap[name] || {};
          skipped.push(name);
          return;
        }
        const records = merged[name].records;
        // خادم أعاد قسماً فارغاً بلا أي شاهد حذف، ونحن لم نرسل شيئاً: خادم جديد أو فارغ،
        // فلا تُمسح بيانات الجهاز بردّه — تُترك كما هي وتُرفع في الجولة التالية.
        const sentNothing = !(cols[name].records || []).length && !Object.keys(cols[name].deleted || {}).length;
        if (!records.length && !Object.keys(merged[name].deleted || {}).length && readCol(name).length && sentNothing) {
          next[name] = {};
          schedule(1500);
          return;
        }
        // تعديلات جرت أثناء الطلب: تبقى نسخة الجهاز وتُرفع في المزامنة التالية
        const liveNow = new Map(readCol(name).map((r) => [r.id, r]));
        const sent = sentPrints[name] || {};
        const kept = [];
        const removed = []; // حُذف على الجهاز أثناء الطلب: لا يُعيده ردّ الخادم
        const final = [];
        records.forEach((r) => {
          const live = liveNow.get(r.id);
          if (!live && sent[r.id] !== undefined) { removed.push(r.id); return; }
          if (live && sent[r.id] !== undefined && fingerprint(live) !== sent[r.id]) { kept.push(r.id); final.push(live); return; }
          final.push(r);
        });
        // سجل أُضيف أثناء الطلب ولم يصل الخادم بعد
        liveNow.forEach((live, id) => { if (sent[id] === undefined && !final.some((r) => r.id === id)) { final.push(live); kept.push(id); } });
        writeCol(name, keepOrder(final, readCol(name)));
        if (kept.length) schedule(1200); // التعديلات التي حدثت أثناء الطلب تُرفع في الجولة التالية
        next[name] = {};
        final.forEach((r) => { if (kept.indexOf(r.id) === -1) next[name][r.id] = fingerprint(r); });
        // يبقى المحذوف في البصمات حتى تُرسل الجولة التالية حذفه إلى الخادم
        removed.forEach((id) => { next[name][id] = sent[id]; });
        if (removed.length) schedule(1200);
      });
      if (skipped.length) console.warn("أقسام لا يدعمها الخادم بعد:", skipped.join("، "));
      saveSnap(next);
      store.save();
      rerender();
      // إشارة فورية لبقية الأجهزة بالأقسام التي أرسلنا تغييراتها
      const sentCols = COLS.filter((n) => cols[n] && ((cols[n].records || []).length || Object.keys(cols[n].deleted || {}).length));
      if (sentCols.length && App.realtime) App.realtime.notify(sentCols);
    } catch (e) {
      console.warn("مزامنة الأقسام:", e.message);
      // الخادم مشغول: إعادة محاولة تلقائية بعد قليل
      if (/مشغول|مهلة|Lock|timed out/i.test(e.message)) schedule(8000);
      else if (showErrors) ui.toast(e.message);
    } finally {
      syncing = false;
      if (again) { again = false; schedule(500); }
    }
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(() => sync(false), ms); };

  const active = (view) => document.getElementById("view-" + view).classList.contains("active");

  /* حقل يكتب فيه المستخدم الآن: إعادة رسم الصفحة تنتظر حتى يخرج منه، لا تسحبه من تحت يده */
  function editingIn(viewId) {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#" + viewId) && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && !/^(checkbox|radio|button|file)$/.test(a.type))));
  }
  // يُفحص كل 0.7 ثانية لا عند حدث الخروج من الحقل وحده: ذلك الحدث قد لا يصل (نافذة أخرى في الواجهة)
  const idleWaits = {};
  function renderWhenIdle(viewId, fn) {
    if (!editingIn(viewId)) { fn(); return; }
    if (idleWaits[viewId]) return; // انتظار واحد لكل صفحة يكفي: الرسم يأخذ آخر البيانات
    idleWaits[viewId] = setInterval(() => {
      if (editingIn(viewId)) return;
      clearInterval(idleWaits[viewId]);
      delete idleWaits[viewId];
      fn();
    }, 700);
  }

  function rerender() {
    App.dashboard.render();
    App.tasks.render();
    if (active("tracks")) renderWhenIdle("view-tracks", () => App.tracks.render());
    if (active("meetings") && App.meetings.isIdle && App.meetings.isIdle()) App.meetings.render();
    if (active("letters") && App.letters.refreshTemplates) App.letters.refreshTemplates();
    if (active("roster")) renderWhenIdle("view-roster", () => App.roster.render());
    if (active("converter") && App.converter.refresh) App.converter.refresh();
    if (active("hospitality")) renderWhenIdle("view-hospitality", () => App.hospitality.render());
    if (active("sheets")) renderWhenIdle("view-sheets", () => App.sheets.render());
  }

  /* أسماء المستخدمين لاختيار المسؤول عن المهام والقرارات */
  async function loadPeople() {
    try {
      people = await App.cloud.people();
      const list = document.getElementById("people-list");
      if (list) list.innerHTML = people.map((p) => `<option value="${ui.esc(p.name)}"></option>`).join("");
    } catch (e) { /* بلا إنترنت */ }
  }
  const names = () => people.map((p) => p.name);

  function init() {
    if (!App.cloud) return;
    store.onChange(() => { if (!syncing) schedule(1500); });
    store.onExternal(() => rerender());
    App.cloud.onAuth((kind) => {
      if (kind === "login") { saveSnap({}); sync(true); loadPeople(); }
      else { try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* تخزين غير متاح */ } }
    });
    if (App.cloud.ready()) { setTimeout(() => { sync(false); loadPeople(); }, 1200); }
    setInterval(() => { if (document.visibilityState === "visible") sync(false); }, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(1000); });
  }

  /* كل الأقسام كما تُرسل للخادم، بما فيها الإعدادات */
  function collect() {
    const out = {};
    COLS.forEach((name) => { out[name] = { records: readCol(name) }; });
    return out;
  }

  /* بعد اعتماد البيانات على خادم جديد: تُمسح البصمات لتبدأ مزامنة نظيفة */
  function resetSnap() {
    try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* تخزين غير متاح */ }
  }

  App.shared = { init, sync, names, loadPeople, allowWipe, collect, resetSnap };
})(window.App = window.App || {});
