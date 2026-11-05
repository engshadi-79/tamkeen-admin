/* يُحقَن في صفحات نظام المركز بعد agent.js (وكيل التنفيذ).
   يسأل الخلفية عن أوامر منتظرة؛ فإن وُجدت شغّل الوكيل بها. */
(() => {
  if (window.__kxBooted) return;
  window.__kxBooted = true;
  let running = false;

  async function start() {
    if (running || typeof window.__kxStart !== "function") return;
    let r;
    try { r = await chrome.runtime.sendMessage({ type: "getPending" }); } catch (e) { return; }
    if (!r || !r.pack) return;
    running = true;
    window.__KX_PACK = r.pack;                      // يقرؤها الوكيل ثم يمسحها من الصفحة
    try { await window.__kxStart(); } finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m && m.type === "start") { start(); reply({ ok: true }); }
  });
  start();                                          // عند تحميل الصفحة
})();
