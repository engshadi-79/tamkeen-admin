/* وكيل تمكين — الخلفية.

   تستلم ملف الأوامر من نافذة الإضافة فقط (لا من أي صفحة ويب)، وتحفظه في ذاكرة
   الجلسة (storage.session: لا يُكتب على القرص ويُمسح عند إغلاق المتصفح)،
   ثم تفتح نظام المركز أو تعيد استعمال تبويبه المفتوح. وسكربت الوكيل في صفحة
   النظام يطلب الأوامر مرة واحدة ثم تُمحى.

   لا كلمة مرور ولا كوكيز ولا رمز جلسة تمرّ من هنا ولا تُقرأ. */
const KSACH = "https://tamkeen.ksach.org/";
const TTL = 10 * 60 * 1000;                       // الأوامر لا تنتظر أكثر من عشر دقائق
const POPUP = chrome.runtime.getURL("popup.html");

async function openSystem() {
  const tabs = await chrome.tabs.query({ url: KSACH + "*" });
  if (tabs.length) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: "start" });
      if (r && r.ok) return "reused";
    } catch (e) { /* السكربت غير محقون: فُتح التبويب قبل تثبيت الإضافة */ }
    await chrome.tabs.reload(t.id);
    return "reloaded";
  }
  await chrome.tabs.create({ url: KSACH + "admin/dashboard" });
  return "opened";
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg && msg.type === "run") {
      // من نافذة الإضافة فقط
      if (!sender.url || !sender.url.startsWith(POPUP)) return reply({ ok: false, error: "مصدر غير مسموح" });
      const pack = msg.pack;
      if (!pack || !Array.isArray(pack.commands) || !pack.commands.length) return reply({ ok: false, error: "ملف الأوامر غير صالح" });
      await chrome.storage.session.set({ pending: { pack, at: Date.now() } });
      return reply({ ok: true, how: await openSystem() });
    }
    if (msg && msg.type === "getPending") {
      // من صفحة نظام المركز فقط
      if (!sender.tab || !sender.url || !sender.url.startsWith(KSACH)) return reply({ pack: null });
      const { pending } = await chrome.storage.session.get("pending");
      if (!pending) return reply({ pack: null });
      if (Date.now() - pending.at > TTL) { await chrome.storage.session.remove("pending"); return reply({ pack: null }); }
      // صفحة الدخول: تبقى الأوامر منتظرة حتى يسجّل المستخدم دخوله وتُحمَّل صفحة داخلية
      if (/\/login/i.test(new URL(sender.url).pathname)) return reply({ pack: null });
      await chrome.storage.session.remove("pending");
      return reply({ pack: pending.pack });
    }
    reply({});
  })().catch((e) => reply({ ok: false, error: e.message }));
  return true;                                      // الرد غير متزامن
});
