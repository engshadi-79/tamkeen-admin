/* التنبيهات داخل النظام: جرس في أعلى الصفحة بعدد ما يخص المستخدم الآن.
   - مهامه المتأخرة أو المستحقة خلال يومين، ومهمة جديدة أُسندت إليه.
   - الوارد المحال إليه (أو الذي أنشأه بلا إحالة) المتأخر أو المستحق خلال 3 أيام، ووارد جديد أُحيل إليه.
   المدير يرى كل الوارد المتأخر. كل شيء يُحسب من البيانات المزامنة على الجهاز، فيصل مع التحديث الفوري.
   إشعار المتصفح اختياري: يظهر عند وصول بند جديد والصفحة مفتوحة. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const SEEN_KEY = "tamkeen-admin:notif-seen";
  const PUSH_KEY = "tamkeen-admin:notif-push";
  const DAY = 86400000;

  const readSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch (e) { return new Set(); } };
  const writeSet = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s].slice(-500))); } catch (e) { /* تخزين غير متاح */ } };
  let seen = readSet(SEEN_KEY);
  let pushed = null; // ما أُرسل عنه إشعار متصفح في هذه الجلسة (يُملأ عند أول حساب حتى لا تنهال القديمة)

  const me = () => (App.profile && App.profile.name()) || "";
  const admin = () => !!(App.profile && App.profile.isAdmin());
  const daysTo = (iso) => Math.round((Date.parse(iso + "T00:00:00") - Date.parse(ui.todayISO() + "T00:00:00")) / DAY);
  const whenText = (d) => (d < 0 ? `متأخر ${ui.fmt(-d)} يوم` : d === 0 ? "اليوم" : d === 1 ? "غداً" : `خلال ${ui.fmt(d)} أيام`);

  /* قائمة التنبيهات الحالية لهذا المستخدم */
  function items() {
    const name = me();
    if (!name) return [];
    const out = [];
    const recent = (iso) => iso && Date.now() - Date.parse(iso) < 7 * DAY;

    (store.get().tasks || []).filter((t) => !t.done && (t.owner || "") === name).forEach((t) => {
      if (t.dueDate) {
        const d = daysTo(t.dueDate);
        if (d <= 2) out.push({ id: `task-due:${t.id}:${t.dueDate}`, kind: d < 0 ? "danger" : "warn", icon: "☑", text: `مهمة: ${t.text}`, sub: `${whenText(d)} (${ui.formatDate(t.dueDate)})`, view: "tasks" });
      }
      if (recent(t.createdAt)) out.push({ id: `task-new:${t.id}`, kind: "info", icon: "✚", text: `مهمة جديدة لك: ${t.text}`, sub: t.dueDate ? `حتى ${ui.formatDate(t.dueDate)}` : "بلا موعد", view: "tasks", fresh: true });
    });

    const reg = App.registry ? App.registry.live() : [];
    reg.filter((r) => r.type === "in" && !r.done).forEach((r) => {
      const mine = r.assignee ? r.assignee === name : r.owner === name;
      const label = `الوارد ${r.number || ""}${r.subject ? ` «${r.subject}»` : ""}`;
      if (r.dueDate && (mine || admin())) {
        const d = daysTo(r.dueDate);
        if (d <= 3) out.push({ id: `reg-due:${r.id}:${r.dueDate}`, kind: d < 0 ? "danger" : "warn", icon: "🗂", text: label, sub: `${whenText(d)}${r.assignee && r.assignee !== name ? ` · محال إلى ${r.assignee}` : ""}`, view: "registry", q: r.number });
      }
      if (r.assignee === name && r.owner !== name && recent(r.assignedAt || r.createdAt)) {
        out.push({ id: `reg-new:${r.id}`, kind: "info", icon: "📥", text: `أُحيل إليك ${label}`, sub: `من ${r.owner || "—"}${r.party ? ` · ${r.party}` : ""}`, view: "registry", q: r.number, fresh: true });
      }
    });

    const rank = { danger: 0, info: 1, warn: 2 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  }

  /* البنود الجديدة تُحسب غير مقروءة حتى تُفتح القائمة؛ المتأخرة والمستحقة تبقى ما دامت قائمة */
  const unread = (list) => list.filter((i) => !seen.has(i.id));

  function refresh() {
    const bell = $("notif-bell");
    if (!bell) return;
    const list = items();
    const n = unread(list).length;
    bell.hidden = !me();
    $("notif-count").textContent = n > 99 ? "99+" : String(n);
    $("notif-count").hidden = !n;
    bell.classList.toggle("has-danger", list.some((i) => i.kind === "danger"));
    bell.title = list.length ? `${ui.fmt(list.length)} تنبيه` : "لا توجد تنبيهات";
    if (!$("notif-panel").hidden) paint(list);
    push(list);
  }

  function paint(list) {
    $("notif-list").innerHTML = list.length ? list.map((i) => `<li class="notif-${i.kind}${seen.has(i.id) ? "" : " unread"}">
        <button type="button" data-go="${esc(i.view)}" data-q="${esc(i.q || "")}">
          <span class="notif-ico">${i.icon}</span>
          <span><b>${esc(i.text)}</b><small>${esc(i.sub)}</small></span>
        </button></li>`).join("")
      : `<li class="notif-empty">لا توجد تنبيهات — كل شيء في موعده ✓</li>`;
    const canPush = "Notification" in window;
    $("notif-push").hidden = !canPush || Notification.permission === "denied";
    $("notif-push").textContent = canPush && Notification.permission === "granted" && localStorage.getItem(PUSH_KEY) === "on"
      ? "🔕 إيقاف إشعارات المتصفح" : "🔔 تفعيل إشعارات المتصفح";
  }

  function open() {
    const list = items();
    $("notif-panel").hidden = false;
    paint(list);
    // تُعلَّم مقروءة بعد لحظة من الفتح، فيبقى تمييز الجديد ظاهراً الآن
    setTimeout(() => { list.forEach((i) => seen.add(i.id)); writeSet(SEEN_KEY, seen); refresh(); }, 1500);
  }
  const close = () => { $("notif-panel").hidden = true; };

  /* إشعار المتصفح لبند لم يُرَ ولم يُشعَر به في هذه الجلسة */
  function push(list) {
    if (pushed === null) { pushed = new Set(list.map((i) => i.id)); return; }
    const on = "Notification" in window && Notification.permission === "granted" && localStorage.getItem(PUSH_KEY) === "on";
    list.filter((i) => !pushed.has(i.id) && !seen.has(i.id)).forEach((i) => {
      pushed.add(i.id);
      if (!on) return;
      try {
        const n = new Notification("مساعد تمكين", { body: `${i.text}\n${i.sub}`, tag: i.id, icon: "assets/icon-192.png" });
        n.onclick = () => { window.focus(); go(i.view, i.q); n.close(); };
      } catch (e) { /* بعض المتصفحات تمنع الإشعار خارج عامل الخدمة */ }
    });
  }

  async function togglePush() {
    if (!("Notification" in window)) return;
    if (localStorage.getItem(PUSH_KEY) === "on" && Notification.permission === "granted") {
      localStorage.setItem(PUSH_KEY, "off");
      ui.toast("أُوقفت إشعارات المتصفح على هذا الجهاز");
    } else {
      const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (p !== "granted") { ui.toast("لم يُسمح بالإشعارات من المتصفح"); return; }
      localStorage.setItem(PUSH_KEY, "on");
      ui.toast("ستصلك إشعارات المتصفح عند وصول بند جديد والنظام مفتوح");
    }
    paint(items());
  }

  /* الانتقال إلى القسم، مع البحث عن القيد إن وُجد */
  function go(view, q) {
    close();
    location.hash = "#" + view;
    if (q && view === "registry") {
      setTimeout(() => {
        const box = $("reg-search");
        if (!box) return;
        box.value = q;
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }, 60);
    }
  }

  function init() {
    $("notif-bell").addEventListener("click", (e) => { e.stopPropagation(); if ($("notif-panel").hidden) open(); else close(); });
    $("notif-panel").addEventListener("click", (e) => {
      e.stopPropagation();
      const b = e.target.closest("[data-go]");
      if (b) go(b.dataset.go, b.dataset.q);
    });
    $("notif-push").addEventListener("click", togglePush);
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    refresh();
    setInterval(refresh, 5000);
    if (App.profile && App.profile.onChange) App.profile.onChange(refresh);
  }

  App.notify = { init, refresh, items };
})(window.App = window.App || {});
