/* وصلة بين صفحة تمكين والإضافة. تعمل في صفحة تمكين فقط.

   تنقل الرسائل بين الصفحة (window.postMessage) والخلفية (chrome.runtime) في
   الاتجاهين، ولا تقرأ من الصفحة شيئاً غير هذه الرسائل. */
(() => {
  const ORIGIN = location.origin;
  const VERSION = chrome.runtime.getManifest().version;
  const post = (m) => window.postMessage(Object.assign({}, m, { source: "tamkeen-agent" }), ORIGIN);
  const send = async (m) => {
    try { return await chrome.runtime.sendMessage(m); }
    catch (e) { return { ok: false, error: "أُعيد تحميل الإضافة — حدّث صفحة تمكين (F5)" }; }
  };

  post({ type: "ready", version: VERSION });

  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || e.data.source !== "tamkeen-app") return;
    const m = e.data;
    if (m.type === "ping") return post({ type: "ready", version: VERSION });
    if (m.type === "run") {
      const r = await send({ type: "run", pack: m.pack });
      return post({ type: "started", ok: !!(r && r.ok), error: (r && r.error) || "", how: (r && r.how) || "" });
    }
    if (m.type === "approve") { await send({ type: "approve", ok: !!m.ok }); return; }
    if (m.type === "cancel") { await send({ type: "cancel" }); return; }
    if (m.type === "stop") { await send({ type: "stop" }); return; }
  });

  // من الخلفية إلى الصفحة: التقدّم والخطة والنتائج
  chrome.runtime.onMessage.addListener((m) => {
    if (m && (m.type === "progress" || m.type === "plan" || m.type === "results" || m.type === "partial")) post(m);
  });
})();
