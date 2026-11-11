/* قناة تمكين إلى إضافة «وكيل تمكين» في المتصفح.

   تتحدث الصفحة مع الإضافة برسائل window.postMessage التي تنقلها الإضافة
   (extension/bridge.js). لا شيء يمرّ بخادم، ولا كلمة مرور ولا رمز جلسة.

   الاستعمال:
     await App.centerAgent.ready()        // هل الإضافة مثبّتة؟
     const out = await App.centerAgent.run([أمر…], { onProgress, onPlan })
        onProgress(text)       تقدّم التنفيذ في نظام المركز
        onPlan(plan) → bool    خطة التسجيل قبل الكتابة؛ true للموافقة، false للرفض
        onPartial(i, نتيجة)    نتيجة أمر انتهى قبل غيره (إضافة 1.4.0+)
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

  /* ===== لا قراءة من نظام المركز إلا بطلب منك =====
     run() هي الممرّ الوحيد إلى نظام المركز، وتُرفض ما لم تسبقها ضغطة مستخدم حقيقية (isTrusted) خلال 90 ثانية،
     أو انتهاء خطوة سابقة من العملية نفسها خلال 90 ثانية (للحزم متعددة الخطوات).
     فلا يبدأ مؤقّت ولا خطأ برمجي قراءةً من تلقاء نفسه. allowSynthetic للاختبارات الآلية وحدها. */
  const GRACE = 90000;
  let lastClick = 0, chainUntil = 0;
  document.addEventListener("click", (e) => { if (e.isTrusted) lastClick = Date.now(); }, true);
  const authorized = () => { const t = Date.now(); return api.allowSynthetic || t - lastClick <= GRACE || t <= chainUntil; };

  function run(commands, hooks) {
    hooks = hooks || {};
    if (!authorized()) return Promise.reject(new Error("لم تُقرأ أي بيانات من نظام المركز: القراءة لا تبدأ إلا بضغطة منك على زر التنفيذ."));
    return new Promise((resolve, reject) => {
      let started = false, idle;
      const done = (fn, v) => { clearTimeout(idle); clearTimeout(startT); listeners.delete(onMsg); chainUntil = Date.now() + GRACE; fn(v); };
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
        } else if (m.type === "partial") {
          arm();
          if (hooks.onPartial) hooks.onPartial(m.index, m.result);        // نتيجة أمر انتهى (إضافة 1.4.0 فأحدث)
        } else if (m.type === "results") {
          done(resolve, m.data);
        }
      }
      listeners.add(onMsg);
      post({ type: "run", pack: { v: 1, created: new Date().toISOString(), commands } });
    });
  }

  /* إيقاف التنفيذ الجاري: يحفظ الوكيل ما اكتمل ويعيده كنتائج (إضافة 1.4.0 فأحدث) */
  const stop = () => post({ type: "stop" });

  const api = { ready, run, stop, isReady: () => !!version, version: () => version, allowSynthetic: false };
  App.centerAgent = api;
  ready(1500);                                               // يتعرّف على الإضافة عند فتح الصفحة
})(window.App = window.App || {});
