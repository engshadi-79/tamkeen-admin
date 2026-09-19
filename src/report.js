/* التقرير الدوري للجهة الممولة: يجمع مؤشرات المسارات والمهام والاجتماعات والمراسلات للفترة تلقائياً،
   مع رسمين بيانيين، ويُصدَّر على الترويسة (Word / PDF / طباعة) ويُسجَّل في الصادر */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const ATTENDANCE_THRESHOLD = 80;
  const ORD = ["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً", "سابعاً", "ثامناً", "تاسعاً", "عاشراً"];
  const TEXTS = ["highlights", "challenges", "next"];

  const settings = () => (store.get().reportSettings = Object.assign({
    recipient: "مركز الملك سلمان للإغاثة والأعمال الإنسانية",
    recipientTitle: "",
    trainingStart: "",
    trainingEnd: "",
  }, store.get().reportSettings));

  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const pct = (n) => `${Math.round(n * 10) / 10}%`;

  function values() {
    const v = {};
    ["from", "to", "ref", "date", "recipient", "recipientTitle", "subject", "trainingStart", "trainingEnd", ...TEXTS].forEach((f) => (v[f] = $("r-" + f).value.trim()));
    v.charts = $("r-charts").checked;
    v.tasksList = $("r-tasks").checked;
    return v;
  }

  /* نسبة الإنجاز المخطط حتى نهاية الفترة (خطية بين بداية التدريب ونهايته) */
  function plannedPct(v) {
    if (!v.trainingStart || !v.trainingEnd || !v.to) return null;
    const s = new Date(v.trainingStart), e = new Date(v.trainingEnd), t = new Date(v.to);
    if (!(e > s)) return null;
    return Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
  }

  function compute(v) {
    const tracks = store.get().tracks;
    const sum = App.tracks.summary(tracks);
    const inRange = (d) => d && (!v.from || d >= v.from) && (!v.to || d <= v.to);
    const tasks = store.get().tasks;
    const doneTasks = tasks.filter((t) => t.done && inRange(String(t.doneAt || "").slice(0, 10)))
      .sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)));
    const endDate = v.to || ui.todayISO();
    const overdue = tasks.filter((t) => !t.done && t.dueDate && t.dueDate < endDate);
    const meetings = App.meetings.inPeriod(v.from, v.to);
    const reg = App.registry.countInPeriod(v.from, v.to);
    return { tracks, sum, doneTasks, overdue, meetings, reg, planned: plannedPct(v) };
  }

  let chartCache = { key: "", images: [] };

  function chartImages(tracks) {
    const key = JSON.stringify(tracks.map((t) => [t.name, t.attendancePct, t.hoursCompleted]));
    if (chartCache.key === key) return chartCache.images;
    const labels = tracks.map((t) => t.name);
    chartCache = {
      key,
      images: [
        App.charts.horizontalBars({ title: "نسبة الحضور حسب المسار", labels, values: tracks.map((t) => t.attendancePct), threshold: ATTENDANCE_THRESHOLD, lowBelow: ATTENDANCE_THRESHOLD }),
        App.charts.horizontalBars({ title: "نسبة إنجاز الساعات التدريبية حسب المسار", labels, values: tracks.map(App.tracks.hoursPct) }),
      ],
    };
    return chartCache.images;
  }

  function blocks() {
    const v = values();
    const d = compute(v);
    const period = `${ui.formatDate(v.from) || "…"} إلى ${ui.formatDate(v.to) || "…"}`;
    const out = [{ kind: "title", text: "بسم الله الرحمن الرحيم" }];
    if (v.ref) out.push({ kind: "meta", text: `الرقم: ${v.ref}` });
    out.push({ kind: "meta", text: `التاريخ: ${ui.formatDate(v.date) || App.templates.PLACEHOLDER}`, sizePt: 12 }, { kind: "para", text: "" });
    out.push({ kind: "addressee", name: v.recipient || App.templates.PLACEHOLDER, title: v.recipientTitle, honorific: "المحترم،،،" });
    out.push({ kind: "bold", text: "السلام عليكم ورحمة الله وبركاته، وبعد:" }, { kind: "para", text: "" });
    out.push({ kind: "title", text: `الموضوع: ${v.subject || `تقرير الإنجاز الدوري للفترة من ${period}`}` }, { kind: "para", text: "" });

    let n = 0;
    const section = (title) => out.push({ kind: "para", text: "" }, { kind: "bold", text: `${ORD[n++]}: ${title}` });

    section("المؤشرات العامة");
    const kpis = [
      ["إجمالي المستفيدين", ui.fmt(d.sum.beneficiaries)],
      ["عدد المسارات التدريبية", ui.fmt(d.tracks.length)],
      ["متوسط نسبة الحضور", pct(d.sum.attendancePct)],
      ["نسبة الإنجاز الفعلي للساعات التدريبية", pct(d.sum.completionPct)],
    ];
    if (d.planned != null) kpis.push(["نسبة الإنجاز المخطط حتى نهاية الفترة", pct(d.planned)], ["الفرق عن الخطة", `${d.sum.completionPct - d.planned >= 0 ? "+" : ""}${pct(d.sum.completionPct - d.planned)}`]);
    kpis.push(
      ["المهام المنجزة خلال الفترة", ui.fmt(d.doneTasks.length)],
      ["المهام المتأخرة حتى نهاية الفترة", ui.fmt(d.overdue.length)],
      ["الاجتماعات المنعقدة", ui.fmt(d.meetings.length)],
      ["المراسلات الصادرة / الواردة", `${ui.fmt(d.reg.out)} / ${ui.fmt(d.reg.in)}`],
    );
    out.push({ kind: "table", headers: ["المؤشر", "القيمة"], widths: [0.65, 0.35], align: [null, "center"], rows: kpis });

    section("مؤشرات المسارات التدريبية");
    out.push({
      kind: "table",
      headers: ["المسار", "النوع", "المستفيدون", "الحضور", "الساعات المنجزة", "الإنجاز"],
      widths: [0.32, 0.15, 0.13, 0.12, 0.15, 0.13],
      align: [null, "center", "center", "center", "center", "center"],
      rows: d.tracks.map((t) => [t.name, App.tracks.TYPE_LABEL[t.type], ui.fmt(t.beneficiaries), pct(Number(t.attendancePct) || 0), `${ui.fmt(t.hoursCompleted)} / ${store.TOTAL_HOURS}`, pct(App.tracks.hoursPct(t))]),
    });
    const low = d.tracks.filter((t) => Number(t.attendancePct) < ATTENDANCE_THRESHOLD);
    if (low.length) out.push({ kind: "para", text: `مسارات حضورها أقل من ${ATTENDANCE_THRESHOLD}%: ${low.map((t) => t.name).join("، ")}.` });

    if (v.charts) {
      section("الرسوم البيانية");
      chartImages(d.tracks).forEach((img) => out.push({ kind: "image", src: img.src, widthPt: img.widthPt, heightPt: img.heightPt }));
    }

    if (d.meetings.length) {
      section("الاجتماعات والقرارات");
      out.push({
        kind: "table",
        headers: ["التاريخ", "الاجتماع", "القرارات", "المنجز منها"],
        widths: [0.18, 0.5, 0.14, 0.18],
        align: ["center", null, "center", "center"],
        rows: d.meetings.map((m) => {
          const ds = m.decisions || [];
          const done = ds.filter((x) => { const t = store.get().tasks.find((k) => k.id === x.taskId); return t && t.done; }).length;
          return [ui.formatDate(m.date), m.title || "—", ui.fmt(ds.length), ui.fmt(done)];
        }),
      });
    }

    if (v.tasksList && d.doneTasks.length) {
      section("المهام المنجزة خلال الفترة");
      out.push({
        kind: "table",
        headers: ["م", "المهمة", "المسؤول", "تاريخ الإنجاز"],
        widths: [0.07, 0.55, 0.2, 0.18],
        align: ["center", null, "center", "center"],
        rows: d.doneTasks.map((t, i) => [String(i + 1), t.text, t.owner || "—", ui.formatDate(String(t.doneAt).slice(0, 10))]),
      });
    }

    [["highlights", "أبرز الإنجازات"], ["challenges", "التحديات"], ["next", "الخطوات القادمة"]].forEach(([f, title]) => {
      if (!lines(v[f]).length) return;
      section(title);
      lines(v[f]).forEach((l) => out.push({ kind: "para", text: l }));
    });

    out.push({ kind: "para", text: "" }, { kind: "title", text: "وتقبلوا منا فائق الاحترام والتقدير،،،" }, { kind: "para", text: "" });
    out.push({ kind: "signature", lines: [store.get().signerTitle, store.get().signer].filter(Boolean).length ? [store.get().signerTitle, store.get().signer].filter(Boolean) : [App.templates.PLACEHOLDER] });
    return out;
  }

  const fileBase = () => {
    const v = values();
    return ["التقرير الدوري", v.from && v.to ? `${v.from} إلى ${v.to}` : "", v.date].filter(Boolean).join(" - ");
  };

  let timer = 0;
  function renderPreview() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      const count = App.docRender.paginate($("r-preview"), blocks());
      $("r-page-count").textContent = App.docRender.pageCountLabel(count);
    }, 30);
  }

  function persistSettings() {
    const v = values();
    Object.assign(settings(), { recipient: v.recipient, recipientTitle: v.recipientTitle, trainingStart: v.trainingStart, trainingEnd: v.trainingEnd });
    store.save();
  }

  async function exportAs(kind) {
    if (!$("r-ref").value.trim()) $("r-ref").value = App.registry.nextOutgoingNumber($("r-date").value || ui.todayISO());
    const v = values();
    const list = blocks();
    const base = fileBase();
    let file = null;
    if (kind === "word") {
      const blob = App.docRender.exportWord(list, base);
      if (!blob) return;
      file = { blob, name: base + ".docx" };
    }
    await App.registry.upsertOutgoing({
      number: v.ref, date: v.date || ui.todayISO(),
      party: [v.recipient, v.recipientTitle].filter(Boolean).join(" - "),
      subject: v.subject || `تقرير الإنجاز الدوري للفترة من ${ui.formatDate(v.from)} إلى ${ui.formatDate(v.to)}`,
      kind: "تقرير دوري", category: "تقارير", file,
    });
    if (kind !== "word") App.docRender.print(list, base, kind === "pdf");
    renderPreview();
  }

  /* الفترة الافتراضية: الشهر الحالي حتى اليوم */
  function defaultPeriod() {
    const today = ui.todayISO();
    $("r-from").value = today.slice(0, 8) + "01";
    $("r-to").value = today;
    $("r-date").value = today;
  }

  function init() {
    const s = settings();
    defaultPeriod();
    $("r-recipient").value = s.recipient;
    $("r-recipientTitle").value = s.recipientTitle;
    $("r-trainingStart").value = s.trainingStart;
    $("r-trainingEnd").value = s.trainingEnd;

    document.querySelectorAll("#view-report input, #view-report textarea").forEach((el) => {
      el.addEventListener(el.type === "checkbox" || el.type === "date" ? "change" : "input", renderPreview);
    });
    ["r-recipient", "r-recipientTitle", "r-trainingStart", "r-trainingEnd"].forEach((id) => $(id).addEventListener("change", persistSettings));
    $("r-ref-auto").addEventListener("click", () => { $("r-ref").value = App.registry.nextOutgoingNumber($("r-date").value || ui.todayISO()); renderPreview(); });
    $("r-word").addEventListener("click", () => exportAs("word"));
    $("r-pdf").addEventListener("click", () => exportAs("pdf"));
    $("r-print").addEventListener("click", () => exportAs("print"));
  }

  App.report = { init, render: renderPreview, blocks };
})(window.App = window.App || {});
