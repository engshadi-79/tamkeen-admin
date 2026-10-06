/* محاضر الاجتماعات: كل قرار يتحول إلى مهمة لها مسؤول وموعد، ويُصدَّر المحضر على الترويسة */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const FIELDS = ["org", "title", "ref", "date", "time", "endTime", "place", "chair", "writer",
    "attendees", "apologies", "absent", "agenda", "discussion", "consensus", "tasks",
    "nextDate", "nextItems", "notes"];

  const meetings = () => (store.get().meetings = store.get().meetings || []);
  let currentId = null;
  let decisions = []; // [{ id, text, owner, due, taskId }]

  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

  function formValues() {
    const v = {};
    FIELDS.forEach((f) => (v[f] = $("m-" + f).value.trim()));
    v.signAttendees = $("m-signAttendees").checked ? "yes" : "";
    return v;
  }

  /* ===== المستند ===== */
  const ORD = ["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً", "سابعاً", "ثامناً", "تاسعاً", "عاشراً"];

  function blocks() {
    const v = formValues();
    const out = [
      { kind: "title", text: "بسم الله الرحمن الرحيم" },
    ];
    if (v.ref) out.push({ kind: "meta", text: `رقم المحضر: ${v.ref}` });
    out.push({ kind: "meta", text: `التاريخ: ${ui.formatDate(v.date) || App.templates.PLACEHOLDER}`, sizePt: 12 }, { kind: "para", text: "" });
    if (v.org) out.push({ kind: "title", text: v.org });
    out.push({ kind: "title", text: "محضر اجتماع" });
    if (v.title) out.push({ kind: "title", text: v.title });
    out.push({ kind: "para", text: "" });

    // الترويسة: كل سطر يظهر إن كُتب فقط
    const when = [ui.formatDate(v.date), v.time ? `الساعة ${v.time}` : "", v.endTime ? `وتنتهي ${v.endTime}` : ""].filter(Boolean).join(" - ");
    if (when) out.push({ kind: "bold", text: `موعد الاجتماع: ${when}` });
    if (v.place) out.push({ kind: "bold", text: `المكان: ${v.place}` });
    if (v.chair) out.push({ kind: "bold", text: `رئيس الاجتماع: ${v.chair}` });
    if (v.writer) out.push({ kind: "bold", text: `مُحرِّر المحضر: ${v.writer}` });

    let n = 0;
    const section = (head, rows) => {
      if (!rows.length) return;
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: ${head}` });
      rows.forEach((r) => out.push({ kind: "para", text: r }));
    };
    const numbered = (text) => lines(text).map((p, i) => `${i + 1}. ${p}`);

    /* جدول الأسماء: كل سطر «الاسم - الصفة» أو «الاسم | الصفة» يصبح صفاً بعمودين */
    const nameRows = (text) => lines(text).map((l) => {
      const parts = l.split(/\s*[|\-–—]\s*/);
      return [parts[0].trim(), parts.slice(1).join(" - ").trim()];
    });

    function peopleTable(head, text, extraCol) {
      const rows = nameRows(text);
      if (!rows.length) return;
      const withTitle = rows.some((r) => r[1]);
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: ${head}` });
      out.push({
        kind: "table",
        headers: withTitle ? ["م", "الاسم", extraCol || "الصفة"] : ["م", "الاسم"],
        widths: withTitle ? [0.08, 0.47, 0.45] : [0.1, 0.9],
        align: withTitle ? ["center", null, null] : ["center", null],
        rows: rows.map((r, i) => (withTitle ? [String(i + 1), r[0], r[1] || "—"] : [String(i + 1), r[0]])),
      });
    }

    peopleTable("الحاضرون", v.attendees);
    peopleTable("المعتذرون عن الحضور", v.apologies, "سبب الاعتذار");
    peopleTable("المدعوون الذين لم يحضروا", v.absent);
    section("جدول الأعمال", lines(v.agenda));
    section("ما تمت مناقشته", lines(v.discussion));
    section("نقاط التوافق والخلاف", lines(v.consensus));

    const ds = decisions.filter((d) => d.text.trim());
    if (ds.length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: القرارات والتوصيات` });
      const hasVote = ds.some((d) => d.vote);
      out.push({
        kind: "table",
        headers: hasVote ? ["م", "القرار / التوصية", "طريقة الإقرار", "المسؤول", "الموعد"] : ["م", "القرار / التوصية", "المسؤول", "الموعد"],
        widths: hasVote ? [0.06, 0.42, 0.16, 0.2, 0.16] : [0.07, 0.55, 0.22, 0.16],
        align: hasVote ? ["center", null, "center", "center", "center"] : ["center", null, "center", "center"],
        rows: ds.map((d, i) => hasVote
          ? [String(i + 1), d.text.trim(), d.vote || "—", d.owner || "—", d.due ? ui.formatDate(d.due) : "—"]
          : [String(i + 1), d.text.trim(), d.owner || "—", d.due ? ui.formatDate(d.due) : "—"]),
      });
    }

    // المهام: جدول المهمة والمسؤول والموعد (سطر لكل مهمة: المهمة | المسؤول | الموعد)
    const taskRows = lines(v.tasks).map((l) => l.split("|").map((c) => c.trim()));
    if (taskRows.length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: المهام والمسؤوليات` });
      out.push({
        kind: "table",
        headers: ["م", "المهمة", "المسؤول", "الموعد النهائي"],
        widths: [0.07, 0.5, 0.25, 0.18],
        align: ["center", null, "center", "center"],
        rows: taskRows.map((c, i) => [String(i + 1), c[0] || "", c[1] || "—", c[2] || "—"]),
      });
    }

    const follow = [];
    if (v.nextDate) follow.push(`موعد الاجتماع القادم: ${ui.formatDate(v.nextDate)}`);
    lines(v.nextItems).forEach((t) => follow.push(t));
    section("مواعيد المتابعة والبنود المؤجلة", follow);
    section("التوصيات الختامية", lines(v.notes));

    // التوقيعات: رئيس الاجتماع ومُحرر المحضر جنباً إلى جنب إن وُجدا
    out.push({ kind: "para", text: "" });
    if (v.chair && v.writer) {
      out.push({
        kind: "table",
        headers: ["رئيس الاجتماع", "مُحرِّر المحضر"],
        widths: [0.5, 0.5],
        align: ["center", "center"],
        rows: [[v.chair, v.writer], ["التوقيع: ................", "التوقيع: ................"]],
      });
    } else {
      out.push({ kind: "signature", lines: ["مُعِدّ المحضر", v.writer || v.chair || App.templates.PLACEHOLDER] });
    }
    if (v.signAttendees === "yes" && lines(v.attendees).length) {
      out.push({ kind: "para", text: "" }, { kind: "bold", text: "إقرار الحاضرين بصحة ما ورد في المحضر" });
      out.push({
        kind: "table",
        headers: ["م", "الاسم", "التوقيع"],
        widths: [0.08, 0.52, 0.4],
        align: ["center", null, "center"],
        rows: nameRows(v.attendees).map((r, i) => [String(i + 1), r[1] ? `${r[0]} - ${r[1]}` : r[0], ""]),
      });
    }
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
        <input type="text" data-f="text" value="${esc(d.text)}" placeholder="نص القرار أو التوصية" data-ai-polish="قرار أو توصية في محضر اجتماع">
        <input type="text" data-f="owner" value="${esc(d.owner || "")}" placeholder="المسؤول">
        <input type="date" data-f="due" value="${esc(d.due || "")}" title="موعد التنفيذ">
        <select data-f="vote" title="طريقة الإقرار">
          <option value="">طريقة الإقرار…</option>
          <option ${d.vote === "بالإجماع" ? "selected" : ""}>بالإجماع</option>
          <option ${d.vote === "بالأغلبية" ? "selected" : ""}>بالأغلبية</option>
          <option ${d.vote === "بالتصويت" ? "selected" : ""}>بالتصويت</option>
        </select>
        ${status}
        <button type="button" class="conv-link danger" data-del title="حذف القرار"><span class="material-symbols-outlined btn-ico">close</span></button>
      </div>`;
    }).join("") : `<p class="conv-hint">لا توجد قرارات بعد.</p>`;
    if (App.aiAssist) App.aiAssist.attach($("m-decisions"));
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
    $("m-signAttendees").checked = !!(m && m.signAttendees === "yes");
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
    const onDecisionEdit = (e) => {
      const row = e.target.closest("[data-i]");
      if (!row || !e.target.dataset.f) return;
      decisions[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
      renderPreview();
    };
    $("m-decisions").addEventListener("input", onDecisionEdit);
    $("m-decisions").addEventListener("change", onDecisionEdit); // قوائم الاختيار (طريقة الإقرار)
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
  const decisionVote = (d) => d.vote || "";

  const openById = (id) => { const m = meetings().find((x) => x.id === id); if (m) load(m); };

  App.meetings = { isIdle, init, render: () => { renderDecisions(); renderPreview(); }, inPeriod, openById };
})(window.App = window.App || {});
