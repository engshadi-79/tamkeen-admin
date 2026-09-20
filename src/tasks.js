/* المهام والمتابعات */
(function (App) {
  const { store, ui } = App;

  /* غير المنجز أولاً، ثم حسب تاريخ الاستحقاق (بلا تاريخ في النهاية) */
  function sorted(tasks) {
    return tasks.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
  }

  // المهام المنشأة من قرارات المحاضر تحمل اسم الاجتماع
  function meetingLabel(id) {
    const m = (store.get().meetings || []).find((x) => x.id === id);
    return m ? `📋 من محضر: ${ui.esc(m.title || ui.formatDate(m.date))}` : "";
  }

  function itemHTML(t, { actions = true } = {}) {
    const overdue = ui.isOverdue(t);
    const cls = ["task-item", t.done ? "done" : "", overdue ? "overdue" : ""].join(" ");
    const date = t.dueDate ? `${overdue ? "متأخرة — " : ""}${ui.formatDate(t.dueDate)}` : "بدون موعد";
    return `
      <li class="${cls}" data-id="${t.id}">
        ${actions ? `<input type="checkbox" ${t.done ? "checked" : ""} aria-label="تعليم كمنجزة">` : ""}
        <span class="t-text">${ui.esc(t.text)}${t.owner || t.meetingId ? `<span class="t-meta">${t.owner ? `👤 ${ui.esc(t.owner)}` : ""}${t.meetingId ? ` ${meetingLabel(t.meetingId)}` : ""}</span>` : ""}</span>
        <span class="t-date">${date}</span>
        ${actions ? `<button class="btn danger small" data-del title="حذف المهمة">حذف</button>` : ""}
      </li>`;
  }

  /* التصفية: الكل، أو مهامي (المسؤول = اسم حسابي)، أو المتأخرة */
  let filter = "all";
  const me = () => (App.profile ? App.profile.name() : "");
  const mine = (t) => (t.owner || "") === me();

  function visible(tasks) {
    if (filter === "mine") return tasks.filter(mine);
    if (filter === "late") return tasks.filter(ui.isOverdue);
    return tasks;
  }

  function render() {
    const all = sorted(store.get().tasks);
    const tasks = visible(all);
    const list = document.getElementById("task-list");
    list.innerHTML = tasks.length ? tasks.map((t) => itemHTML(t)).join("")
      : `<li class="empty">${filter === "mine" ? "لا توجد مهام مسندة إليك." : filter === "late" ? "لا توجد مهام متأخرة." : "لا توجد مهام بعد. أضف أول مهمة من النموذج أعلاه."}</li>`;

    const pending = all.filter((t) => !t.done).length;
    const overdue = all.filter(ui.isOverdue).length;
    const myPending = all.filter((t) => !t.done && mine(t)).length;
    document.getElementById("task-counts").textContent =
      `${ui.fmt(pending)} قيد الانتظار · ${ui.fmt(overdue)} متأخرة · ${ui.fmt(all.length - pending)} منجزة${me() ? ` · ${ui.fmt(myPending)} عليك` : ""}`;
    document.querySelectorAll("[data-task-filter]").forEach((b) => b.classList.toggle("active", b.dataset.taskFilter === filter));
  }

  function init() {
    document.querySelectorAll("[data-task-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.taskFilter; render(); }));
    if (App.profile) App.profile.onChange(render);
    const form = document.getElementById("task-form");
    const dueInput = document.getElementById("task-due");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const textInput = document.getElementById("task-text");
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const ownerInput = document.getElementById("task-owner");
      store.get().tasks.push({ id: store.uid(), text, owner: ownerInput.value.trim(), dueDate: dueInput.value || null, done: false, createdAt: new Date().toISOString() });
      store.save();
      form.reset();
      textInput.focus();
      ui.toast("تمت إضافة المهمة");
    });

    const list = document.getElementById("task-list");
    list.addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      const task = store.get().tasks.find((t) => t.id === e.target.closest("li").dataset.id);
      if (task) {
        task.done = e.target.checked;
        task.doneAt = task.done ? `${ui.todayISO()}T${new Date().toTimeString().slice(0, 8)}` : null; // تاريخ محلي، للتقرير الدوري
        store.save();
      }
    });
    list.addEventListener("click", (e) => {
      if (!e.target.closest("[data-del]")) return;
      const id = e.target.closest("li").dataset.id;
      const s = store.get();
      const task = s.tasks.find((t) => t.id === id);
      if (task && confirm(`هل تريد حذف المهمة: «${task.text}»؟`)) {
        s.tasks = s.tasks.filter((t) => t.id !== id);
        store.save();
        ui.toast("تم حذف المهمة");
      }
    });
  }

  App.tasks = { init, render, sorted, itemHTML };
})(window.App = window.App || {});
