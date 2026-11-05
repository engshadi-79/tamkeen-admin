/* قناة تمكين إلى إضافة «وكيل تمكين» في المتصفح.

   تتحدث الصفحة مع الإضافة برسائل window.postMessage التي تنقلها الإضافة
   (extension/bridge.js). لا شيء يمرّ بخادم، ولا كلمة مرور ولا رمز جلسة.

   الاستعمال:
     await App.centerAgent.ready()        // هل الإضافة مثبّتة؟
     const out = await App.centerAgent.run([أمر…], { onProgress, onPlan })
        onProgress(text)       تقدّم التنفيذ في نظام المركز
        onPlan(plan) → bool    خطة التسجيل قبل الكتابة؛ true للموافقة، false للرفض
        out = { results: […] } نتائج الأوامر بالترتيب */
(function (App) {
  const ORIGIN = location.origin;
  let version = "";
  const listeners = new Set();

  const post = (m) => window.postMessage(Object.assign({}, m, { source: "tamkeen-app" }), ORIGIN);

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "tamkeen-agent") return;
    if (e.data.type === "ready") version = e.data.version || "1";
    listeners.forEach((fn) => fn(e.data));
  });

  /* هل الإضافة موصولة؟ تسأل ثم تنتظر ردّها لحظة */
  function ready(ms) {
    if (version) return Promise.resolve(true);
    return new Promise((resolve) => {
      const fn = (m) => { if (m.type === "ready") { listeners.delete(fn); clearTimeout(t); resolve(true); } };
      const t = setTimeout(() => { listeners.delete(fn); resolve(false); }, ms || 800);
      listeners.add(fn);
      post({ type: "ping" });
    });
  }

  function run(commands, hooks) {
    hooks = hooks || {};
    return new Promise((resolve, reject) => {
      let started = false, idle;
      const done = (fn, v) => { clearTimeout(idle); clearTimeout(startT); listeners.delete(onMsg); fn(v); };
      // لا حركة لدقيقتين بعد البدء: غالباً لم يسجّل المستخدم دخوله في نظام المركز
      const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(() => { post({ type: "cancel" }); done(reject, new Error("لم يبدأ التنفيذ في نظام المركز. سجّل دخولك فيه ثم أعد المحاولة.")); }, 120000);
      };
      const startT = setTimeout(() => done(reject, new Error("لم تردّ الإضافة. تأكد أنها مثبّتة ومفعّلة ثم حدّث الصفحة (F5).")), 8000);

      async function onMsg(m) {
        if (m.type === "started") {
          clearTimeout(startT);
          if (!m.ok) return done(reject, new Error(m.error || "رفضت الإضافة البدء."));
          started = true; arm();
        } else if (!started) {
          return;
        } else if (m.type === "progress") {
          arm();
          if (hooks.onProgress) hooks.onProgress(m.text);
        } else if (m.type === "plan") {
          clearTimeout(idle);                                // الانتظار هنا موافقة المستخدم لا عطل
          let ok = false;
          try { ok = hooks.onPlan ? !!(await hooks.onPlan(m.plan)) : false; } catch (e) { ok = false; }
          post({ type: "approve", ok });
          arm();
        } else if (m.type === "results") {
          done(resolve, m.data);
        }
      }
      listeners.add(onMsg);
      post({ type: "run", pack: { v: 1, created: new Date().toISOString(), commands } });
    });
  }

  App.centerAgent = { ready, run, isReady: () => !!version, version: () => version };
  ready(1500);                                               // يتعرّف على الإضافة عند فتح الصفحة
})(window.App = window.App || {});
