/* مزامنة بقية الأقسام مع خادم المركز: المسارات والمهام والمحاضر والقوالب والإعدادات،
   حتى يرى كل المستخدمين البيانات نفسها. القاعدة كما في سجل الوارد والصادر: الأحدث تعديلاً يفوز،
   والعنصر المحذوف على جهاز يُحذف عند الجميع. سجل الوارد والصادر له مزامنته الخاصة في registry.js. */
(function (App) {
  const { store, ui } = App;
  const SNAP_KEY = "tamkeen-admin:sync2";
  const SETTINGS_KEYS = ["registrySettings", "reportSettings", "rosterMeta", "signer", "signerTitle"];
  const COLS = ["tracks", "tasks", "meetings", "customTemplates", "roster", "settings"];
  let syncing = false, again = false, timer = null, people = [];

  /* الإعدادات ليست مصفوفة: تُعامل كعناصر { id: اسم الإعداد, value } */
  function readCol(name) {
    if (name !== "settings") return (store.get()[name] = store.get()[name] || []);
    return SETTINGS_KEYS.filter((k) => store.get()[k] !== undefined).map((k) => ({ id: k, value: store.get()[k], updatedAt: (store.get().settingsAt || {})[k] || "" }));
  }

  function writeCol(name, records) {
    if (name !== "settings") { store.get()[name] = records; return; }
    const at = (store.get().settingsAt = store.get().settingsAt || {});
    records.forEach((r) => { store.get()[r.id] = r.value; at[r.id] = r.updatedAt || ""; });
  }

  function fingerprint(r) {
    const copy = Object.assign({}, r);
    delete copy.updatedAt;
    const s = JSON.stringify(copy);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }
  const loadSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "{}"); } catch (e) { return {}; } };
  const saveSnap = (snap) => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) { /* تخزين غير متاح */ } };

  // المسارات الافتراضية (بلا حضور ولا ساعات) لا تُصدَّر فوق بيانات حقيقية على الخادم
  const pristineTracks = (list) => list.every((t) => !Number(t.attendancePct) && !Number(t.hoursCompleted));

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
      if (name === "tracks") {
        if (pristineTracks(remote) && !pristineTracks(local)) { push[name] = true; return; } // بيانات الجهاز أحدث من الافتراضية
        takeServer();
        return;
      }
      if (name === "settings") { takeServer(); return; }
      push[name] = true; // المهام والمحاضر والقوالب: تُدمج مع ما في الخادم
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
      let snap = loadSnap();
      if (!Object.keys(snap).length) { await firstSync(); snap = loadSnap(); }
      const now = new Date().toISOString();
      const cols = {};
      COLS.forEach((name) => {
        const local = readCol(name);
        const mine = snap[name] || {};
        local.forEach((r) => { if (mine[r.id] !== fingerprint(r)) r.updatedAt = now; });
        const ids = new Set(local.map((r) => r.id));
        const deleted = {};
        Object.keys(mine).forEach((id) => { if (!ids.has(id)) deleted[id] = now; });
        cols[name] = { records: local, deleted };
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
        writeCol(name, records);
        next[name] = {};
        records.forEach((r) => { next[name][r.id] = fingerprint(r); });
      });
      if (skipped.length) console.warn("أقسام لا يدعمها الخادم بعد:", skipped.join("، "));
      saveSnap(next);
      store.save();
      rerender();
    } catch (e) {
      console.warn("مزامنة الأقسام:", e.message);
      if (showErrors) ui.toast(e.message);
    } finally {
      syncing = false;
      if (again) { again = false; schedule(500); }
    }
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(() => sync(false), ms); };

  const active = (view) => document.getElementById("view-" + view).classList.contains("active");

  function rerender() {
    App.dashboard.render();
    App.tasks.render();
    if (active("tracks")) App.tracks.render();
    if (active("meetings") && App.meetings.isIdle && App.meetings.isIdle()) App.meetings.render();
    if (active("letters") && App.letters.refreshTemplates) App.letters.refreshTemplates();
    if (active("roster")) App.roster.render();
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
    App.cloud.onAuth((kind) => {
      if (kind === "login") { saveSnap({}); sync(true); loadPeople(); }
      else { try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* تخزين غير متاح */ } }
    });
    if (App.cloud.ready()) { setTimeout(() => { sync(false); loadPeople(); }, 1200); }
    setInterval(() => { if (document.visibilityState === "visible") sync(false); }, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(1000); });
  }

  App.shared = { init, sync, names, loadPeople };
})(window.App = window.App || {});
