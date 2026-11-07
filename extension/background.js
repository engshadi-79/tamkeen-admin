/* وكيل تمكين — الخلفية.

   تستلم الأوامر من مصدرين فقط: نافذة الإضافة، أو صفحة تمكين نفسها (عبر bridge.js).
   وتحفظها في ذاكرة الجلسة (storage.session: لا تُكتب على القرص وتُمسح عند إغلاق
   المتصفح)، ثم تفتح نظام المركز أو تعيد استعمال تبويبه. وسكربت الوكيل في صفحة
   النظام يطلبها مرة واحدة ثم تُمحى.

   حين تأتي الأوامر من تمكين تنقل هذه الخلفية بين الصفحتين: التقدّم والخطة والنتائج
   إلى تمكين، وموافقة المستخدم من تمكين إلى نظام المركز.

   لا كلمة مرور ولا كوكيز ولا رمز جلسة تمرّ من هنا ولا تُقرأ. */
const KSACH = "https://tamkeen.ksach.org/";
const APPS = ["https://tamkeen-admin.vercel.app/"];       // الصفحات المسموح لها بإرسال أوامر
const TTL = 10 * 60 * 1000;                                // الأوامر لا تنتظر أكثر من عشر دقائق
const POPUP = chrome.runtime.getURL("popup.html");

const fromApp = (sender) => !!(sender.tab && sender.url && APPS.some((a) => sender.url.startsWith(a)));
const fromKsach = (sender) => !!(sender.tab && sender.url && sender.url.startsWith(KSACH));

/* background=true (الأوامر من تمكين): يعمل التنفيذ في تبويب خلفي لا يُفعَّل ولا تُرفَع نافذته،
   فيبقى المستخدم على شاشة تمكين. وإن احتاج تسجيل دخول يُظهَر التبويب حينها فقط (انظر getPending). */
async function openSystem(background, appTab) {
  const tabs = await chrome.tabs.query({ url: KSACH + "*" });
  if (tabs.length) {
    const t = tabs[0];
    if (!background) {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    }
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: "start" });
      if (r && r.ok) return "reused";
    } catch (e) { /* السكربت غير محقون: فُتح التبويب قبل تثبيت الإضافة */ }
    await chrome.tabs.reload(t.id);
    return "reloaded";
  }
  const opts = { url: KSACH + "admin/dashboard", active: !background };
  if (background && appTab && appTab.windowId != null) opts.windowId = appTab.windowId;   // في نافذة تمكين نفسها
  await chrome.tabs.create(opts);
  return "opened";
}

/* رسالة إلى صفحة تمكين التي طلبت التنفيذ؛ false إن أُغلقت */
async function toApp(msg) {
  const { ctx } = await chrome.storage.session.get("ctx");
  if (!ctx || ctx.from == null) return false;
  try { await chrome.tabs.sendMessage(ctx.from, msg); return true; } catch (e) { return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const type = msg && msg.type;

    // ===== بدء التنفيذ: من نافذة الإضافة أو من تمكين =====
    if (type === "run") {
      const popup = !!(sender.url && sender.url.startsWith(POPUP));
      if (!popup && !fromApp(sender)) return reply({ ok: false, error: "مصدر غير مسموح" });
      const pack = msg.pack;
      if (!pack || !Array.isArray(pack.commands) || !pack.commands.length) return reply({ ok: false, error: "ملف الأوامر غير صالح" });
      await chrome.storage.session.set({
        pending: { pack, at: Date.now(), remote: !popup },
        ctx: popup ? null : { from: sender.tab.id },
      });
      return reply({ ok: true, how: await openSystem(!popup, popup ? null : sender.tab) });
    }
    // انتظار لحساب الوكيل: مؤقتات الخلفية لا تُبطَّأ مثل مؤقتات التبويب الخلفي
    if (type === "sleep") {
      if (!fromKsach(sender)) return reply({});
      await new Promise((r) => setTimeout(r, Math.max(0, Math.min(Number(msg.ms) || 0, 10000))));
      return reply({ ok: true });
    }
    if (type === "cancel") {
      if (!fromApp(sender)) return reply({});
      await chrome.storage.session.remove("pending");
      return reply({ ok: true });
    }

    // ===== من صفحة نظام المركز =====
    if (type === "getPending") {
      if (!fromKsach(sender)) return reply({ pack: null });
      const { pending } = await chrome.storage.session.get("pending");
      if (!pending) return reply({ pack: null });
      if (Date.now() - pending.at > TTL) { await chrome.storage.session.remove("pending"); return reply({ pack: null }); }
      // صفحة الدخول: تبقى الأوامر منتظرة حتى يسجّل المستخدم دخوله وتُحمَّل صفحة داخلية
      if (/\/login/i.test(new URL(sender.url).pathname)) {
        // التنفيذ الخلفي يحتاج تسجيل دخول: نُظهر التبويب مرة واحدة ونُعلم تمكين
        if (pending.remote && !pending.shown) {
          await chrome.storage.session.set({ pending: Object.assign({}, pending, { shown: true }) });
          try { await chrome.tabs.update(sender.tab.id, { active: true }); await chrome.windows.update(sender.tab.windowId, { focused: true }); } catch (e) { /* أُغلق */ }
          await toApp({ type: "progress", text: "سجّل دخولك في نظام المركز (التبويب المفتوح)، وسيكمل التنفيذ تلقائياً ثم تعود إلى هنا." });
        }
        return reply({ pack: null });
      }
      await chrome.storage.session.remove("pending");
      // بعد تسجيل الدخول نعيد المستخدم إلى تمكين
      if (pending.remote && pending.shown) {
        const { ctx: c0 } = await chrome.storage.session.get("ctx");
        if (c0 && c0.from != null) {
          try { const at = await chrome.tabs.get(c0.from); await chrome.tabs.update(c0.from, { active: true }); await chrome.windows.update(at.windowId, { focused: true }); } catch (e) { /* أُغلق */ }
        }
      }
      if (pending.remote) {
        const { ctx } = await chrome.storage.session.get("ctx");
        await chrome.storage.session.set({ ctx: Object.assign({}, ctx, { ksach: sender.tab.id }) });
      }
      return reply({ pack: pending.pack, remote: !!pending.remote });
    }
    if (type === "progress" || type === "plan") {
      if (!fromKsach(sender)) return reply({});
      const ok = await toApp(type === "plan" ? { type: "plan", plan: msg.plan } : { type: "progress", text: String(msg.text || "") });
      return reply({ ok });
    }
    if (type === "results") {
      if (!fromKsach(sender)) return reply({ delivered: false });
      return reply({ delivered: await toApp({ type: "results", data: msg.data }) });
    }

    // ===== موافقة المستخدم من تمكين إلى نظام المركز =====
    if (type === "approve") {
      if (!fromApp(sender)) return reply({});
      const { ctx } = await chrome.storage.session.get("ctx");
      if (!ctx || ctx.from !== sender.tab.id || ctx.ksach == null) return reply({ ok: false });
      try { await chrome.tabs.sendMessage(ctx.ksach, { type: "approval", ok: !!msg.ok }); return reply({ ok: true }); }
      catch (e) { return reply({ ok: false }); }
    }

    reply({});
  })().catch((e) => reply({ ok: false, error: e.message }));
  return true;                                      // الرد غير متزامن
});
