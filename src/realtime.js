/* التحديث الفوري بين المستخدمين عبر قناة بث في Supabase Realtime.
   كل جهاز يغيّر شيئاً يرسل بعد مزامنته «تغيّر القسم كذا» بلا أي بيانات، فتسحب بقية الأجهزة
   المفتوحة التغيير من الخادم فوراً. البيانات لا تمرّ في القناة: القراءة تبقى عبر الدالة بجلسة
   المستخدم، والمفتاح المستعمل هو المفتاح العام الذي لا يصل إلى الجداول (مقفلة بـ RLS).
   المزامنة الدورية كل 60 ثانية تبقى احتياطاً إن انقطع البث. */
(function (App) {
  const CHANNEL = "tamkeen-changes";
  let client = null;
  let channel = null;
  let live = false;
  let connectedKey = "";

  const config = () => ((App.cloud && App.cloud.settings()) || {}).realtime || null;

  async function connect() {
    if (!App.cloud || !App.cloud.ready() || !window.supabase || !window.supabase.createClient) return;
    let c = config();
    if (!c) {
      // الخادم يعطي بيانات القناة في ping؛ الخادم القديم (Drive) لا يعطيها فلا بثّ عليه
      try { await App.cloud.refreshUser(); } catch (e) { return; }
      c = config();
    }
    if (!c || !c.url || !c.key) return;
    const key = `${c.url}|${c.key}`;
    if (channel && connectedKey === key) return;
    disconnect();
    connectedKey = key;
    client = window.supabase.createClient(c.url, c.key, { auth: { persistSession: false, autoRefreshToken: false } });
    channel = client.channel(CHANNEL, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "changed" }, (msg) => onRemote((msg && msg.payload) || {}));
    channel.subscribe((status) => { live = status === "SUBSCRIBED"; });
  }

  function disconnect() {
    if (client && channel) { try { client.removeChannel(channel); } catch (e) { /* القناة مغلقة أصلاً */ } }
    client = null;
    channel = null;
    live = false;
    connectedKey = "";
  }

  /* إشارات متتابعة من أجهزة أخرى تُجمع في مزامنة واحدة */
  let pending = new Set();
  let timer = null;
  function onRemote(payload) {
    (payload.cols || []).forEach((c) => pending.add(String(c)));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const cols = [...pending];
      pending = new Set();
      if (cols.includes("registry") && App.registry) App.registry.syncShared(false);
      if (cols.some((c) => c !== "registry") && App.shared) App.shared.sync(false);
    }, 250);
  }

  /* بعد مزامنة أرسلت تغييرات فعلية: إشارة لبقية الأجهزة.
     حماية من الدوران: الإشارات المتقاربة تُجمع (واحدة كل 1.5 ثانية على الأكثر)، وإن أرسل الجهاز
     أكثر من 10 إشارات في 30 ثانية يتوقف البث دقيقة كاملة — المزامنة الدورية تكمل في أثنائها. */
  let outgoing = new Set();
  let sendTimer = null;
  let lastSent = 0;
  let recent = [];
  let pausedUntil = 0;

  function flush() {
    sendTimer = null;
    const cols = [...outgoing];
    outgoing = new Set();
    if (!cols.length || !live || !channel) return;
    const now = Date.now();
    if (now < pausedUntil) return;
    recent = recent.filter((t) => now - t < 30000);
    if (recent.length >= 10) { pausedUntil = now + 60000; recent = []; console.warn("البث الفوري: إشارات كثيرة متتابعة، أُوقف دقيقة"); return; }
    recent.push(now);
    lastSent = now;
    try {
      const p = channel.send({ type: "broadcast", event: "changed", payload: { cols, at: now } });
      if (p && p.catch) p.catch(() => { /* البث احتياطي؛ المزامنة الدورية تكمل */ });
    } catch (e) { /* كذلك */ }
  }

  function notify(cols) {
    if (!live || !channel || !cols || !cols.length) return;
    cols.forEach((c) => outgoing.add(String(c)));
    if (sendTimer) return;
    sendTimer = setTimeout(flush, Math.max(0, 1500 - (Date.now() - lastSent)));
  }

  function init() {
    connect();
    if (App.cloud) App.cloud.onAuth((kind) => { if (kind === "login") setTimeout(connect, 500); else disconnect(); });
  }

  App.realtime = { init, notify, connect, isLive: () => live };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
