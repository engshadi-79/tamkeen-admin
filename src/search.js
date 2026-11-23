/* بحث شامل من مكان واحد (Ctrl+K أو زر 🔍): الوارد والصادر، والمستفيدون، والمهام، والمحاضر،
   والمسارات، وكشف الضيافة. يبحث في البيانات المزامنة على الجهاز، فالنتائج فورية وتعمل بلا إنترنت.
   المطابقة تتجاهل الهمزات والتاء المربوطة والتشكيل والأرقام العربية/الهندية. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const norm = (s) => String(s == null ? "" : s)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .toLowerCase().replace(/\s+/g, " ").trim();

  const canSee = (view) => !App.profile || App.profile.canView(view);

  /* كل ما يمكن البحث فيه، مسطّحاً: { group, view, title, sub, text, q, open } */
  function index() {
    const out = [];
    const data = store.get() || {};
    if (canSee("registry") && App.registry) {
      App.registry.live().forEach((r) => out.push({
        group: "الوارد والصادر", view: "registry", icon: r.type === "out" ? "📤" : "📥",
        title: `${r.number || ""} — ${r.subject || "بلا موضوع"}`,
        sub: [r.type === "out" ? "صادر" : "وارد", r.party, ui.formatDate(r.date), r.assignee ? `محال إلى ${r.assignee}` : ""].filter(Boolean).join(" · "),
        text: [r.number, r.subject, r.party, r.notes, r.fileName, r.assignee, r.owner].join(" "), q: r.number,
      }));
    }
    if (canSee("roster")) {
      const cols = ((data.rosterMeta || {}).columns || []);
      (data.roster || []).forEach((r) => {
        const vals = r.values || {};
        const all = Object.values(vals).map((v) => String(v == null ? "" : v));
        const nameCol = cols.find((c) => /اسم/.test(c.label || c.name || "")) || cols[0];
        const title = (nameCol && vals[nameCol.key]) || all.find((v) => v.trim()) || "مستفيد";
        out.push({ group: "المستفيدون", view: "roster", icon: "👤", title, sub: all.filter((v) => v && v !== title).slice(0, 3).join(" · "), text: all.join(" "), q: title });
      });
    }
    if (canSee("tasks")) {
      (data.tasks || []).forEach((t) => out.push({
        group: "المهام", view: "tasks", icon: t.done ? "✅" : "☑", title: t.text || "مهمة",
        sub: [t.owner ? `👤 ${t.owner}` : "", t.dueDate ? `حتى ${ui.formatDate(t.dueDate)}` : "", t.done ? "منجزة" : ""].filter(Boolean).join(" · "),
        text: [t.text, t.owner].join(" "),
      }));
    }
    if (canSee("meetings")) {
      (data.meetings || []).forEach((m) => out.push({
        group: "محاضر الاجتماعات", view: "meetings", icon: "📋", title: m.title || "محضر", sub: [ui.formatDate(m.date), m.place, m.chair].filter(Boolean).join(" · "),
        text: [m.title, m.place, m.chair, m.writer, m.org, m.attendees, (m.decisions || []).map((d) => d.text).join(" ")].join(" "),
        open: () => App.meetings.openById && App.meetings.openById(m.id),
      }));
    }
    if (canSee("tracks")) {
      (data.tracks || []).forEach((t) => out.push({
        group: "المسارات", view: "tracks", icon: "◧", title: t.name, sub: [t.trainer1, t.trainer2].filter(Boolean).join(" · ") || `${ui.fmt(t.beneficiaries)} مستفيد`,
        text: [t.name, t.trainer1, t.trainer2].join(" "),
      }));
    }
    if (canSee("hospitality") && App.hospitality && App.hospitality.rows) {
      const def = App.hospitality.rows();
      [].concat(def.tracks || [], def.staff || []).forEach((r) => out.push({
        group: "كشف الضيافة", view: "hospitality", icon: "☕", title: r.name, sub: "صف في كشف الضيافة", text: r.name,
      }));
    }
    if (canSee("center") && App.centerCmd && App.centerCmd.searchIndex) { try { out.push(...App.centerCmd.searchIndex()); } catch (e) { /* لا يُسقط البحث */ } }
    return out;
  }

  let results = [];
  let active = 0;

  function run() {
    const q = norm($("gs-input").value);
    if (q.length < 2) {
      results = [];
      $("gs-results").innerHTML = `<p class="gs-hint">اكتب حرفين على الأقل. يبحث في الوارد والصادر والمستفيدين والمهام والمحاضر والمسارات.</p>`;
      return;
    }
    const words = q.split(" ");
    results = index().filter((it) => { const t = norm(it.title + " " + it.text); return words.every((w) => t.includes(w)); });
    active = 0;
    if (!results.length) { $("gs-results").innerHTML = `<p class="gs-hint">لا نتائج لـ «${esc($("gs-input").value)}»</p>`; return; }
    const groups = new Map();
    results.forEach((r, i) => { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push([r, i]); });
    $("gs-results").innerHTML = [...groups.entries()].map(([g, list]) => `
      <div class="gs-group"><h4>${esc(g)} <small>${ui.fmt(list.length)}</small></h4>
        ${list.slice(0, 8).map(([r, i]) => `<button type="button" class="gs-item${i === active ? " active" : ""}" data-i="${i}">
          <span class="gs-ico">${r.icon}</span><span><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span></button>`).join("")}
        ${list.length > 8 ? `<p class="gs-more">و${ui.fmt(list.length - 8)} نتيجة أخرى في ${esc(g)}</p>` : ""}
      </div>`).join("");
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    close();
    location.hash = "#" + r.view;
    setTimeout(() => {
      if (r.open) r.open();
      if (r.view === "registry" && r.q && $("reg-search")) {
        $("reg-search").value = r.q;
        $("reg-search").dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (r.view === "roster" && r.q && $("ros-search")) {
        $("ros-search").value = r.q;
        $("ros-search").dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, 60);
  }

  function move(delta) {
    const btns = [...$("gs-results").querySelectorAll(".gs-item")];
    if (!btns.length) return;
    const pos = Math.max(0, btns.findIndex((b) => b.classList.contains("active")));
    const next = btns[(pos + delta + btns.length) % btns.length];
    btns.forEach((b) => b.classList.remove("active"));
    next.classList.add("active");
    next.scrollIntoView({ block: "nearest" });
  }

  function open() {
    $("gs-modal").classList.add("open");
    $("gs-input").value = "";
    run();
    setTimeout(() => $("gs-input").focus(), 30);
  }
  const close = () => $("gs-modal").classList.remove("open");

  function init() {
    $("gs-open").addEventListener("click", open);
    $("gs-input").addEventListener("input", run);
    $("gs-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        const a = $("gs-results").querySelector(".gs-item.active");
        if (a) pick(Number(a.dataset.i));
      }
    });
    $("gs-results").addEventListener("click", (e) => { const b = e.target.closest(".gs-item"); if (b) pick(Number(b.dataset.i)); });
    $("gs-modal").addEventListener("click", (e) => { if (e.target.id === "gs-modal") close(); });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.code === "KeyK")) { e.preventDefault(); open(); }
      else if (e.key === "Escape" && $("gs-modal").classList.contains("open")) close();
    });
  }

  App.search = { init, open, norm, index };
})(window.App = window.App || {});
