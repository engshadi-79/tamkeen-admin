/* التقرير الدوري للجهة الممولة: يجمع مؤشرات المسارات والمهام والاجتماعات والمراسلات للفترة تلقائياً،
   مع رسمين بيانيين، ويُصدَّر على الترويسة (Word / PDF / طباعة) ويُسجَّل في الصادر */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const ATTENDANCE_THRESHOLD = 80;
  const ORD = ["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً", "سابعاً", "ثامناً", "تاسعاً", "عاشراً"];
  const TEXTS = ["highlights", "challenges", "next", "analysis"];

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

    // الأرشيف خلال الفترة حسب نوع المستند (وارد / صادر)
    const regList = App.registry.live().filter((r) => (!v.from || r.date >= v.from) && (!v.to || r.date <= v.to));
    if (regList.length) {
      section("الوارد والصادر والأرشيف خلال الفترة");
      const cats = [...new Set(regList.map((r) => r.category || "أخرى"))];
      const count = (c, t) => regList.filter((r) => (r.category || "أخرى") === c && r.type === t).length;
      out.push({
        kind: "table",
        headers: ["نوع المستند", "الوارد", "الصادر", "الإجمالي"],
        widths: [0.4, 0.2, 0.2, 0.2],
        align: [null, "center", "center", "center"],
        rows: cats.map((c) => [c, ui.fmt(count(c, "in")), ui.fmt(count(c, "out")), ui.fmt(count(c, "in") + count(c, "out"))]),
      });
      const followUp = regList.filter((r) => r.type === "in" && r.dueDate && !r.done).length;
      if (followUp) out.push({ kind: "para", text: `وارد بحاجة إلى معالجة أو رد: ${ui.fmt(followUp)}.` });
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

    [["analysis", $("r-analysis-title").value.trim() || "تحليل الملفات المرفقة"], ["highlights", "أبرز الإنجازات"], ["challenges", "التحديات"], ["next", "الخطوات القادمة"]].forEach(([f, title]) => {
      if (!lines(v[f]).length) return;
      section(title);
      lines(v[f]).forEach((l) => out.push({ kind: "para", text: l }));
    });

    out.push({ kind: "para", text: "" }, { kind: "title", text: "وتقبلوا منا فائق الاحترام والتقدير،،،" }, { kind: "para", text: "" });
    out.push({ kind: "signature", lines: [store.get().signerTitle, store.get().signer].filter(Boolean).length ? [store.get().signerTitle, store.get().signer].filter(Boolean) : [App.templates.PLACEHOLDER] });
    return out;
  }

  /* ===== تحليل ملفات مرفوعة بالذكاء الاصطناعي ===== */
  let aiFiles = []; // { name, text, chars }
  const MAX_CHARS = 60000;

  /* استخراج نص كل نوع: Excel جدولاً، Word نصاً، PDF والصور عبر القراءة الضوئية على الخادم */
  async function extractText(file) {
    const name = file.name.toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(name)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      return wb.worksheets.slice(0, 5).map((ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: false }, (row, i) => {
          if (i > 400) return;
          rows.push(row.values.slice(1).map((c) => (c == null ? "" : String(c.text || c.result || c))).join(" | "));
        });
        return `### ورقة: ${ws.name}\n${rows.join("\n")}`;
      }).join("\n\n");
    }
    if (/\.docx$/.test(name)) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const xml = await zip.file("word/document.xml").async("string");
      return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
    }
    if (/\.(txt|csv|json|md)$/.test(name)) return file.text();
    if (/\.(pdf|jpe?g|png|tiff?|webp|heic)$/.test(name)) {
      if (!(App.cloud && App.cloud.ready())) throw new Error("قراءة PDF والصور تحتاج الاتصال بخادم المركز");
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1]);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const r = await App.cloud.ocr(data, file.type || "application/pdf", file.name);
      return r.text || "";
    }
    throw new Error("نوع غير مدعوم");
  }

  function renderAiFiles() {
    const total = aiFiles.reduce((n, f) => n + f.chars, 0);
    $("r-ai-list").innerHTML = aiFiles.length
      ? aiFiles.map((f, i) => `<li><b>${ui.esc(f.name)}</b> <span class="reg-kind">${ui.fmt(f.chars)} حرف</span>
          <button type="button" class="conv-link danger" data-ai-del="${i}">✕</button></li>`).join("")
      : `<li class="conv-hint">لم تُضف ملفات بعد.</li>`;
    $("r-ai-total").textContent = aiFiles.length ? `${ui.fmt(aiFiles.length)} ملف · ${ui.fmt(total)} حرف${total > MAX_CHARS ? ` (سيُرسل أول ${ui.fmt(MAX_CHARS)} حرف)` : ""}` : "";
    $("r-ai-run").disabled = !aiFiles.length;
  }

  async function addAiFiles(files) {
    for (const file of [...files]) {
      $("r-ai-status").textContent = `جارٍ قراءة ${file.name}…`;
      try {
        const text = String(await extractText(file)).trim();
        if (!text) throw new Error("لا يوجد نص قابل للقراءة");
        aiFiles.push({ name: file.name, text, chars: text.length });
      } catch (e) {
        ui.toast(`${file.name}: ${e.message}`);
      }
      renderAiFiles();
    }
    $("r-ai-status").textContent = "";
  }

  async function runAnalysis() {
    const provider = $("r-ai-provider").value || undefined;
    if (!App.ai.hasKey(provider)) {
      ui.toast(`أضف مفتاح ${provider === "claude" ? "Claude" : provider === "gemini" ? "Gemini" : "الذكاء الاصطناعي"} من صفحة المراسلات ← إعدادات`);
      return;
    }
    if (!aiFiles.length) return;
    const ask = $("r-ai-ask").value.trim() || "حلّل الملفات واكتب أهم النتائج والأرقام والملاحظات في صيغة تقرير رسمي.";
    let context = "";
    for (const f of aiFiles) {
      if (context.length >= MAX_CHARS) break;
      context += `\n\n===== ملف: ${f.name} =====\n${f.text.slice(0, MAX_CHARS - context.length)}`;
    }
    $("r-ai-run").disabled = true;
    $("r-ai-status").textContent = "جارٍ التحليل…";
    const target = $("r-analysis");
    target.value = "";
    try {
      await App.ai.generate({
        request: `${ask}\n\nاكتب النتيجة بالعربية الفصحى، بنداً في كل سطر، بلا عناوين ولا مقدمات ولا خاتمة، ولا تكتب تحية أو توقيعاً. اعتمد على أرقام الملفات كما هي.`,
        context,
        provider,
        onText: (t) => { target.value += t; renderPreview(); },
      });
      $("r-ai-status").textContent = target.value.trim() ? "تم التحليل — راجع النص وعدّله قبل التصدير" : "لم يصل رد من الخدمة";
      renderPreview();
    } catch (e) {
      $("r-ai-status").textContent = e.message;
    }
    $("r-ai-run").disabled = false;
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
    if (!$("r-ref").value.trim()) $("r-ref").value = await App.registry.assignNumber("out", $("r-date").value || ui.todayISO());
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

  function initAiFiles() {
    $("r-ai-files").addEventListener("change", (e) => { addAiFiles(e.target.files); e.target.value = ""; });
    $("r-ai-pick").addEventListener("click", () => $("r-ai-files").click());
    $("r-ai-run").addEventListener("click", runAnalysis);
    $("r-ai-clear").addEventListener("click", () => { aiFiles = []; renderAiFiles(); });
    $("r-ai-list").addEventListener("click", (e) => {
      const i = e.target.dataset.aiDel;
      if (i == null) return;
      aiFiles.splice(Number(i), 1);
      renderAiFiles();
    });
    const drop = $("r-ai-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) addAiFiles(e.dataTransfer.files); });
    renderAiFiles();
  }

  function init() {
    initAiFiles();
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
    $("r-ref-auto").addEventListener("click", async () => { $("r-ref").value = await App.registry.assignNumber("out", $("r-date").value || ui.todayISO()); renderPreview(); });
    $("r-word").addEventListener("click", () => exportAs("word"));
    $("r-pdf").addEventListener("click", () => exportAs("pdf"));
    $("r-print").addEventListener("click", () => exportAs("print"));
  }

  App.report = { init, render: renderPreview, blocks };
})(window.App = window.App || {});
