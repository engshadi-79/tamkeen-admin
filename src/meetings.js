/* محاضر الاجتماعات: كل قرار يتحول إلى مهمة لها مسؤول وموعد، ويُصدَّر المحضر على الترويسة */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const FIELDS = ["title", "date", "time", "place", "chair", "attendees", "agenda", "discussion", "writer"];

  const meetings = () => (store.get().meetings = store.get().meetings || []);
  let currentId = null;
  let decisions = []; // [{ id, text, owner, due, taskId }]

  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

  function formValues() {
    const v = {};
    FIELDS.forEach((f) => (v[f] = $("m-" + f).value.trim()));
    return v;
  }

  /* ===== المستند ===== */
  function blocks() {
    const v = formValues();
    const out = [
      { kind: "title", text: "بسم الله الرحمن الرحيم" },
      { kind: "meta", text: `التاريخ: ${ui.formatDate(v.date) || App.templates.PLACEHOLDER}`, sizePt: 12 },
      { kind: "para", text: "" },
      { kind: "title", text: "محضر اجتماع" },
    ];
    if (v.title) out.push({ kind: "title", text: v.title });
    out.push({ kind: "para", text: "" });
    const when = [ui.formatDate(v.date), v.time ? `الساعة ${v.time}` : ""].filter(Boolean).join(" - ");
    if (when) out.push({ kind: "bold", text: `موعد الاجتماع: ${when}` });
    if (v.place) out.push({ kind: "bold", text: `المكان: ${v.place}` });
    if (v.chair) out.push({ kind: "bold", text: `رئيس الاجتماع: ${v.chair}` });

    const people = lines(v.attendees);
    const sections = [];
    if (people.length) sections.push(["الحاضرون", people.map((p, i) => `${i + 1}. ${p}`)]);
    if (lines(v.agenda).length) sections.push(["جدول الأعمال", lines(v.agenda)]);
    if (lines(v.discussion).length) sections.push(["ما تمت مناقشته", lines(v.discussion)]);
    const ORD = ["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً"];
    let n = 0;
    sections.forEach(([head, rows]) => {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: ${head}` });
      rows.forEach((r) => out.push({ kind: "para", text: r }));
    });

    const ds = decisions.filter((d) => d.text.trim());
    if (ds.length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: القرارات والتوصيات` });
      out.push({
        kind: "table",
        headers: ["م", "القرار / التوصية", "المسؤول", "الموعد"],
        widths: [0.07, 0.55, 0.22, 0.16],
        align: ["center", null, "center", "center"],
        rows: ds.map((d, i) => [String(i + 1), d.text.trim(), d.owner || "—", d.due ? ui.formatDate(d.due) : "—"]),
      });
    }
    out.push({ kind: "para", text: "" }, { kind: "signature", lines: ["مُعِدّ المحضر", v.writer || App.templates.PLACEHOLDER] });
    return out;
  }

  const fileBase = () => {
    const v = formValues();
    return ["محضر اجتماع", App.docRender.cleanFileName(v.title), v.date].filter(Boolean).join(" - ");
  };

  function renderPreview() {
    const count = App.docRender.paginate($("m-preview"), blocks());
    $("m-page-count").textContent = App.docRender.pageCountLabel(count);
  }

  /* ===== القرارات ===== */
  function taskFor(d) {
    return d.taskId && store.get().tasks.find((t) => t.id === d.taskId);
  }

  function renderDecisions() {
    $("m-decisions").innerHTML = decisions.length ? decisions.map((d, i) => {
      const task = taskFor(d);
      const status = task ? (task.done ? `<span class="badge good">منجز</span>` : ui.isOverdue(task) ? `<span class="badge low">متأخر</span>` : `<span class="badge craft">قيد التنفيذ</span>`) : "";
      return `<div class="m-dec" data-i="${i}">
        <span class="m-dec-n">${i + 1}</span>
        <input type="text" data-f="text" value="${esc(d.text)}" placeholder="نص القرار أو التوصية">
        <input type="text" data-f="owner" value="${esc(d.owner || "")}" placeholder="المسؤول">
        <input type="date" data-f="due" value="${esc(d.due || "")}" title="موعد التنفيذ">
        ${status}
        <button type="button" class="conv-link danger" data-del title="حذف القرار">✕</button>
      </div>`;
    }).join("") : `<p class="conv-hint">لا توجد قرارات بعد.</p>`;
  }

  /* ===== الحفظ ومزامنة المهام ===== */
  function save(silent) {
    const v = formValues();
    if (!v.title && !v.date) { if (!silent) ui.toast("أدخل عنوان الاجتماع أو تاريخه"); return false; }
    let m = currentId && meetings().find((x) => x.id === currentId);
    if (!m) {
      m = { id: store.uid(), createdAt: new Date().toISOString() };
      meetings().push(m);
      currentId = m.id;
    }
    decisions = decisions.filter((d) => d.text.trim());
    Object.assign(m, v, { decisions: decisions.map((d) => Object.assign({}, d)) });

    // كل قرار = مهمة مرتبطة بالمحضر
    const s = store.get();
    const keepTaskIds = new Set();
    m.decisions.forEach((d, i) => {
      let task = d.taskId && s.tasks.find((t) => t.id === d.taskId);
      if (!task) {
        task = { id: store.uid(), done: false, createdAt: new Date().toISOString() };
        s.tasks.push(task);
        d.taskId = task.id;
        decisions[i].taskId = task.id;
      }
      Object.assign(task, { text: d.text.trim(), owner: d.owner || "", dueDate: d.due || null, meetingId: m.id });
      keepTaskIds.add(task.id);
    });
    s.tasks = s.tasks.filter((t) => t.meetingId !== m.id || keepTaskIds.has(t.id));
    store.get().signer = store.get().signer || v.writer;
    store.save();
    renderList();
    renderDecisions();
    if (!silent) ui.toast(m.decisions.length ? `تم حفظ المحضر، و${m.decisions.length} قرار صارت مهاماً في «المهام والمتابعات»` : "تم حفظ المحضر");
    return true;
  }

  function load(m) {
    currentId = m ? m.id : null;
    FIELDS.forEach((f) => ($("m-" + f).value = m ? m[f] || "" : ""));
    if (!m) {
      $("m-date").value = ui.todayISO();
      $("m-writer").value = store.get().signer || "";
    }
    decisions = m ? (m.decisions || []).map((d) => Object.assign({}, d)) : [];
    renderList();
    renderDecisions();
    renderPreview();
  }

  function renderList() {
    const list = meetings().slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    $("m-select").innerHTML = `<option value="">— محضر جديد —</option>` + list.map((m) =>
      `<option value="${m.id}" ${m.id === currentId ? "selected" : ""}>${esc(ui.formatDate(m.date))} — ${esc(m.title || "بدون عنوان")}</option>`).join("");
    $("m-delete").hidden = !currentId;
  }

  function remove() {
    const m = meetings().find((x) => x.id === currentId);
    if (!m || !confirm(`حذف محضر «${m.title || ui.formatDate(m.date)}»؟ ستُحذف مهام قراراته غير المنجزة أيضاً.`)) return;
    const s = store.get();
    s.meetings = meetings().filter((x) => x.id !== m.id);
    s.tasks = s.tasks.filter((t) => t.meetingId !== m.id || t.done);
    store.save();
    load(null);
    ui.toast("تم حذف المحضر");
  }

  /* للإحصاء في التقرير الدوري */
  function inPeriod(from, to) {
    return meetings().filter((m) => (!from || m.date >= from) && (!to || m.date <= to))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function init() {
    FIELDS.forEach((f) => $("m-" + f).addEventListener("input", renderPreview));
    $("m-select").addEventListener("change", (e) => load(meetings().find((m) => m.id === e.target.value) || null));
    $("m-new").addEventListener("click", () => load(null));
    $("m-delete").addEventListener("click", remove);
    $("m-save").addEventListener("click", () => save(false));
    $("m-add-decision").addEventListener("click", () => {
      decisions.push({ id: store.uid(), text: "", owner: "", due: "" });
      renderDecisions();
      const inputs = $("m-decisions").querySelectorAll('[data-f="text"]');
      inputs[inputs.length - 1].focus();
    });
    $("m-decisions").addEventListener("input", (e) => {
      const row = e.target.closest("[data-i]");
      if (!row || !e.target.dataset.f) return;
      decisions[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
      renderPreview();
    });
    $("m-decisions").addEventListener("click", (e) => {
      if (!e.target.closest("[data-del]")) return;
      decisions.splice(Number(e.target.closest("[data-i]").dataset.i), 1);
      renderDecisions();
      renderPreview();
    });
    $("m-word").addEventListener("click", () => { if (save(true) !== false) App.docRender.exportWord(blocks(), fileBase()); });
    $("m-pdf").addEventListener("click", () => { save(true); App.docRender.print(blocks(), fileBase(), true); });
    $("m-print").addEventListener("click", () => { save(true); App.docRender.print(blocks(), fileBase(), false); });
    load(null);
  }

  const isIdle = () => !currentId && !$("m-title").value.trim() && !$("m-discussion").value.trim();

  App.meetings = { isIdle, init, render: () => { renderDecisions(); renderPreview(); }, inPeriod };
})(window.App = window.App || {});
