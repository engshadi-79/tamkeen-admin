/* يُحقَن في صفحات نظام المركز بعد agent.js (وكيل التنفيذ).
   يسأل الخلفية عن أوامر منتظرة؛ فإن وُجدت شغّل الوكيل بها.

   وحين تكون الأوامر قادمة من تمكين (remote) يربط الوكيل بتمكين: يرسل التقدّم،
   ويطلب الموافقة من هناك قبل أي كتابة، ويسلّم النتائج إليه بدل تنزيل ملف. */
(() => {
  if (window.__kxBooted) return;
  window.__kxBooted = true;
  let running = false;
  let approvalResolve = null;

  const bind = (remote) => {
    window.__kxRemote = !!remote;
    if (!remote) { window.__kxProgress = window.__kxApprove = window.__kxDone = undefined; return; }
    // لا نغرق الصفحة بتحديثات: رسالة كل 150ms على الأكثر، لكن **آخر** رسالة تصل دائماً:
    // مؤقت لاحق (قد يتأخر في التبويب الخلفي، وهذا مقبول لأن الرسائل تتتابع كل ثانية تقريباً)
    // ويُرسَل الأخير حتماً قبل النتائج في __kxDone.
    let last = 0, timer = null, latest = "", sent = "";
    const flush = () => {
      timer = null; last = Date.now(); sent = latest;
      chrome.runtime.sendMessage({ type: "progress", text: latest }).catch(() => {});
    };
    window.__kxProgress = (text) => {
      latest = text;
      const wait = 150 - (Date.now() - last);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
    window.__kxFlush = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (latest !== sent) { sent = latest; try { await chrome.runtime.sendMessage({ type: "progress", text: latest }); } catch (e) { /* تمكين مغلق */ } }
    };
    window.__kxApprove = (plan) => new Promise((resolve) => {
      approvalResolve = resolve;
      chrome.runtime.sendMessage({ type: "plan", plan }).then((r) => { if (!r || !r.ok) { /* تمكين مغلق: تبقى الموافقة المحلية */ } }).catch(() => {});
    });
    window.__kxDone = async (data) => {
      if (window.__kxFlush) await window.__kxFlush();                  // آخر رسالة تقدّم قبل النتائج
      return chrome.runtime.sendMessage({ type: "results", data }).then((r) => !!(r && r.delivered)).catch(() => false);
    };
  };

  async function start() {
    if (running || typeof window.__kxStart !== "function") return;
    let r;
    try { r = await chrome.runtime.sendMessage({ type: "getPending" }); } catch (e) { return; }
    if (!r || !r.pack) return;
    running = true;
    bind(!!r.remote);
    window.__KX_PACK = r.pack;                      // يقرؤها الوكيل ثم يمسحها من الصفحة
    try { await window.__kxStart(); } finally { running = false; bind(false); }
  }

  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (!m) return;
    if (m.type === "start") { start(); reply({ ok: true }); }
    else if (m.type === "approval" && approvalResolve) { const r = approvalResolve; approvalResolve = null; r(!!m.ok); }
  });
  start();                                          // عند تحميل الصفحة
})();
