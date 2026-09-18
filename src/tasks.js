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

  function itemHTML(t, { actions = true } = {}) {
    const overdue = ui.isOverdue(t);
    const cls = ["task-item", t.done ? "done" : "", overdue ? "overdue" : ""].join(" ");
    const date = t.dueDate ? `${overdue ? "متأخرة — " : ""}${ui.formatDate(t.dueDate)}` : "بدون موعد";
    return `
      <li class="${cls}" data-id="${t.id}">
        ${actions ? `<input type="checkbox" ${t.done ? "checked" : ""} aria-label="تعليم كمنجزة">` : ""}
        <span class="t-text">${ui.esc(t.text)}</span>
        <span class="t-date">${date}</span>
        ${actions ? `<button class="btn danger small" data-del title="حذف المهمة">حذف</button>` : ""}
      </li>`;
  }

  function render() {
    const tasks = sorted(store.get().tasks);
    const list = document.getElementById("task-list");
    list.innerHTML = tasks.length ? tasks.map((t) => itemHTML(t)).join("") : `<li class="empty">لا توجد مهام بعد. أضف أول مهمة من النموذج أعلاه.</li>`;

    const pending = tasks.filter((t) => !t.done).length;
    const overdue = tasks.filter(ui.isOverdue).length;
    document.getElementById("task-counts").textContent =
      `${ui.fmt(pending)} قيد الانتظار · ${ui.fmt(overdue)} متأخرة · ${ui.fmt(tasks.length - pending)} منجزة`;
  }

  function init() {
    const form = document.getElementById("task-form");
    const dueInput = document.getElementById("task-due");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const textInput = document.getElementById("task-text");
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      store.get().tasks.push({ id: store.uid(), text, dueDate: dueInput.value || null, done: false });
      store.save();
      form.reset();
      textInput.focus();
      ui.toast("تمت إضافة المهمة");
    });

    const list = document.getElementById("task-list");
    list.addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      const task = store.get().tasks.find((t) => t.id === e.target.closest("li").dataset.id);
      if (task) { task.done = e.target.checked; store.save(); }
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
