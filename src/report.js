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
    v.compare = $("r-compare").value;
    v.trackFilter = $("r-track-filter").value;
    v.metrics = [...document.querySelectorAll("[data-report-metric]:checked")].map((el) => el.dataset.reportMetric);
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
    const allTracks = App.tracks.ordered();
    const tracks = v.trackFilter && v.trackFilter !== "all" ? allTracks.filter((t) => t.id === v.trackFilter) : allTracks;
    const sum = App.tracks.summary(tracks);
    const inRange = (d) => d && (!v.from || d >= v.from) && (!v.to || d <= v.to);
    const tasks = store.get().tasks;
    const doneTasks = tasks.filter((t) => t.done && inRange(String(t.doneAt || "").slice(0, 10)))
      .sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)));
    const endDate = v.to || ui.todayISO();
    const overdue = tasks.filter((t) => !t.done && t.dueDate && t.dueDate < endDate);
    const meetings = App.meetings.inPeriod(v.from, v.to);
    const reg = App.registry.countInPeriod(v.from, v.to);
    return { tracks, allTracks, sum, doneTasks, overdue, meetings, reg, planned: plannedPct(v) };
  }

  const metricNames = { beneficiaries: "المستفيدون", attendance: "الحضور %", hours: "إنجاز الساعات %", tasks: "المهام المنجزة", meetings: "الاجتماعات", registry: "الوارد / الصادر" };
  function comparisonRows(v, d) {
    if (v.compare === "tracks") return d.tracks.map((t) => ({ label: t.name, values: {
      beneficiaries: ui.fmt(t.beneficiaries), attendance: pct(Number(t.attendancePct) || 0), hours: pct(App.tracks.hoursPct(t)),
    } }));
    if (v.compare !== "months") return [];
    if (!v.from || !v.to || v.from > v.to) return [];
    const start = new Date(`${v.from}T00:00:00`), end = new Date(`${v.to}T00:00:00`), months = [];
    for (let cur = new Date(start.getFullYear(), start.getMonth(), 1); cur <= end && months.length < 48; cur.setMonth(cur.getMonth() + 1)) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
      const within = (date) => String(date || "").slice(0, 7) === key && String(date || "").slice(0, 10) >= v.from && String(date || "").slice(0, 10) <= v.to;
      months.push({ label: key, values: {
        tasks: ui.fmt(d.doneTasks.filter((t) => within(t.doneAt)).length),
        meetings: ui.fmt(d.meetings.filter((m) => within(m.date)).length),
        registry: `${ui.fmt(App.registry.live().filter((r) => within(r.date) && r.type === "in").length)} / ${ui.fmt(App.registry.live().filter((r) => within(r.date) && r.type === "out").length)}`,
      } });
    }
    return months;
  }
  function selectedMetricNames(v) {
    return v.metrics.filter((key) => (v.compare === "months" ? ["tasks", "meetings", "registry"].includes(key) : v.compare === "tracks" ? ["beneficiaries", "attendance", "hours"].includes(key) : true));
  }
  function filteredRows(rows, v) {
    const keys = selectedMetricNames(v);
    return rows.map((row) => [row.label, ...keys.map((key) => row.values[key] ?? "—")]);
  }

  let chartCache = { key: "", images: [] };

  function chartImages(tracks, metrics) {
    const key = JSON.stringify([tracks.map((t) => [t.name, t.attendancePct, t.hoursCompleted]), metrics]);
    if (chartCache.key === key) return chartCache.images;
    const labels = tracks.map((t) => t.name);
    chartCache = {
      key,
      images: [
        ...(metrics.includes("attendance") ? [App.charts.horizontalBars({ title: "نسبة الحضور حسب المسار", labels, values: tracks.map((t) => t.attendancePct), threshold: ATTENDANCE_THRESHOLD, lowBelow: ATTENDANCE_THRESHOLD })] : []),
        ...(metrics.includes("hours") ? [App.charts.horizontalBars({ title: "نسبة إنجاز الساعات التدريبية حسب المسار", labels, values: tracks.map(App.tracks.hoursPct) })] : []),
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
    const kpis = [];
    if (v.metrics.includes("beneficiaries")) kpis.push(["إجمالي المستفيدين", ui.fmt(d.sum.beneficiaries)]);
    kpis.push(["عدد المسارات التدريبية", ui.fmt(d.tracks.length)]);
    if (v.metrics.includes("attendance")) kpis.push(["متوسط نسبة الحضور", pct(d.sum.attendancePct)]);
    if (v.metrics.includes("hours")) kpis.push(["نسبة الإنجاز الفعلي للساعات التدريبية", pct(d.sum.completionPct)]);
    if (v.metrics.includes("hours") && d.planned != null) kpis.push(["نسبة الإنجاز المخطط حتى نهاية الفترة", pct(d.planned)], ["الفرق عن الخطة", `${d.sum.completionPct - d.planned >= 0 ? "+" : ""}${pct(d.sum.completionPct - d.planned)}`]);
    if (v.metrics.includes("tasks")) kpis.push(["المهام المنجزة خلال الفترة", ui.fmt(d.doneTasks.length)], ["المهام المتأخرة حتى نهاية الفترة", ui.fmt(d.overdue.length)]);
    if (v.metrics.includes("meetings")) kpis.push(["الاجتماعات المنعقدة", ui.fmt(d.meetings.length)]);
    if (v.metrics.includes("registry")) kpis.push(["المراسلات الصادرة / الواردة", `${ui.fmt(d.reg.out)} / ${ui.fmt(d.reg.in)}`]);
    if (kpis.length) out.push({ kind: "table", headers: ["المؤشر", "القيمة"], widths: [0.65, 0.35], align: [null, "center"], rows: kpis });

    const compare = comparisonRows(v, d), metricKeys = selectedMetricNames(v);
    if (compare.length && metricKeys.length) {
      section(v.compare === "tracks" ? "مقارنة المسارات" : "مقارنة الأشهر");
      out.push({ kind: "table", headers: [v.compare === "tracks" ? "المسار" : "الشهر", ...metricKeys.map((key) => metricNames[key])], widths: [0.3, ...metricKeys.map(() => 0.7 / metricKeys.length)], align: [null, ...metricKeys.map(() => "center")], rows: filteredRows(compare, v) });
    }

    if (v.metrics.some((key) => ["beneficiaries", "attendance", "hours"].includes(key))) {
    section("مؤشرات المسارات التدريبية");
    out.push({
      kind: "table",
      headers: ["المسار", "النوع", ...(v.metrics.includes("beneficiaries") ? ["المستفيدون"] : []), ...(v.metrics.includes("attendance") ? ["الحضور"] : []), ...(v.metrics.includes("hours") ? ["الساعات المنجزة", "الإنجاز"] : [])],
      widths: [0.35, 0.18, ...Array(Math.max(1, v.metrics.filter((key) => ["beneficiaries", "attendance", "hours"].includes(key)).length + (v.metrics.includes("hours") ? 1 : 0))).fill(0.47 / Math.max(1, v.metrics.filter((key) => ["beneficiaries", "attendance", "hours"].includes(key)).length + (v.metrics.includes("hours") ? 1 : 0)))],
      align: [null, "center", ...Array(Math.max(1, v.metrics.filter((key) => ["beneficiaries", "attendance", "hours"].includes(key)).length + (v.metrics.includes("hours") ? 1 : 0))).fill("center")],
    rows: d.tracks.map((t) => [t.name, App.tracks.TYPE_LABEL[t.type], ...(v.metrics.includes("beneficiaries") ? [ui.fmt(t.beneficiaries)] : []), ...(v.metrics.includes("attendance") ? [pct(Number(t.attendancePct) || 0)] : []), ...(v.metrics.includes("hours") ? [`${ui.fmt(t.hoursCompleted)} / ${store.TOTAL_HOURS}`, pct(App.tracks.hoursPct(t))] : [])]),
    });
    }
    if (v.metrics.some((key) => ["beneficiaries", "attendance", "hours"].includes(key))) {
      const catalog = (store.get().trackCodes || []).filter((r) => r.kind === "phaseCode");
      if (catalog.length) {
        section("مرجع ترميز المراحل والمجموعات");
        out.push({ kind: "table", headers: ["المرحلة", "المسار", "المجموعة", "الرمز"], widths: [0.2, 0.42, 0.2, 0.18], align: [null, null, null, "center"], rows: catalog.map((r) => [r.phase, r.trackName, r.group, r.code]) });
      }
    }
    const low = v.metrics.includes("attendance") ? d.tracks.filter((t) => Number(t.attendancePct) < ATTENDANCE_THRESHOLD) : [];
    if (low.length) out.push({ kind: "para", text: `مسارات حضورها أقل من ${ATTENDANCE_THRESHOLD}%: ${low.map((t) => t.name).join("، ")}.` });

    if (v.charts && v.metrics.some((key) => ["attendance", "hours"].includes(key))) {
      section("الرسوم البيانية");
      chartImages(d.tracks, v.metrics).forEach((img) => out.push({ kind: "image", src: img.src, widthPt: img.widthPt, heightPt: img.heightPt }));
    }

    if (v.metrics.includes("meetings") && d.meetings.length) {
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
    if (v.metrics.includes("registry") && regList.length) {
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

    if (v.metrics.includes("tasks") && v.tasksList && d.doneTasks.length) {
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

  /* ===== نموذج التقرير: يُرفع مرة ويُحفظ للجميع (إعداد مشترك reportModel) ===== */
  const MODEL_CHARS = 20000;
  const model = () => App.store.get().reportModel || null;

  function renderModel() {
    const m = model();
    const has = !!(m && m.text);
    $("r-model-info").textContent = has
      ? `${m.name} · ${ui.fmt(m.chars || m.text.length)} حرف${m.by ? ` · رفعه ${m.by}` : ""}`
      : "لم يُرفع نموذج بعد";
    $("r-model-view").hidden = !has;
    $("r-model-del").hidden = !has;
    $("r-model-use-wrap").hidden = !has;
    $("r-model-pick").innerHTML = has ? `<span class="material-symbols-outlined btn-ico">upload</span> استبدال النموذج` : `<span class="material-symbols-outlined btn-ico">upload</span> رفع نموذج`;
  }

  async function addModel(file) {
    if (!file) return;
    $("r-ai-status").textContent = `جارٍ قراءة ${file.name}…`;
    try {
      const text = (await extractText(file)).trim();
      if (!text) throw new Error("لم أستخرج نصاً من الملف");
      App.store.get().reportModel = {
        name: file.name,
        text: text.slice(0, MODEL_CHARS),
        chars: text.length,
        at: new Date().toISOString(),
        by: (App.profile && App.profile.name()) || "",
      };
      App.store.save();
      renderModel();
      $("r-ai-status").textContent = `حُفظ النموذج «${file.name}» — يظهر لكل المستخدمين`;
    } catch (e) {
      $("r-ai-status").textContent = e.message;
    }
  }

  function viewModel() {
    const m = model();
    if (!m) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { ui.toast("اسمح بالنوافذ المنبثقة لعرض النموذج"); return; }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${ui.esc(m.name)}</title>
      <style>body{font-family:Tahoma,Arial;margin:24px;line-height:1.9;white-space:pre-wrap;background:#f4f6fa;color:#1b2433}
      h1{font-size:16pt;background:#0b1f3a;color:#fff;padding:8px;border-radius:8px}</style></head>
      <body><h1>${ui.esc(m.name)}</h1>${ui.esc(m.text)}</body></html>`);
    w.document.close();
  }

  function deleteModel() {
    if (!model() || !confirm("حذف نموذج التقرير المحفوظ؟ يُحذف عند كل المستخدمين.")) return;
    delete App.store.get().reportModel;
    App.store.save();
    renderModel();
    $("r-ai-status").textContent = "حُذف النموذج";
  }

  function renderAiFiles() {
    const total = aiFiles.reduce((n, f) => n + f.chars, 0);
    $("r-ai-list").innerHTML = aiFiles.length
      ? aiFiles.map((f, i) => `<li><b>${ui.esc(f.name)}</b> <span class="reg-kind">${ui.fmt(f.chars)} حرف</span>
          <button type="button" class="conv-link danger" data-ai-del="${i}"><span class="material-symbols-outlined btn-ico">close</span></button></li>`).join("")
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
    const m = model();
    const useModel = !!(m && m.text && $("r-model-use") && $("r-model-use").checked);
    let context = "";
    if (useModel) {
      context += `===== نموذج التقرير المطلوب اتباعه (${m.name}) =====\n${m.text}\n\n===== انتهى النموذج =====\n`;
    }
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
        request: useModel
          ? `${ask}\n\nاتبع «نموذج التقرير» الموجود في بداية السياق حرفياً: الأقسام نفسها وبترتيبها، والعناوين نفسها، والأسلوب نفسه، وطريقة عرض الأرقام والنسب والجداول نفسها. املأه بأرقام الجداول المرفقة بعده لا بأرقام النموذج، واحذف أي قسم لا تتوفر له بيانات. اكتب بالعربية الفصحى واعتمد على الأرقام كما هي، بلا تحية ولا توقيع.`
          : `${ask}\n\nاكتب النتيجة بالعربية الفصحى، بنداً في كل سطر، بلا عناوين ولا مقدمات ولا خاتمة، ولا تكتب تحية أو توقيعاً. اعتمد على أرقام الملفات كما هي.`,
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
    Object.assign(settings(), { recipient: v.recipient, recipientTitle: v.recipientTitle, trainingStart: v.trainingStart, trainingEnd: v.trainingEnd, from: v.from, to: v.to, compare: v.compare, trackFilter: v.trackFilter, metrics: v.metrics, charts: v.charts, tasksList: v.tasksList });
    store.save();
  }

  async function exportExcel() {
    if (!window.ExcelJS) { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const v = values(), d = compute(v), wb = new ExcelJS.Workbook();
    wb.creator = "مساعد تمكين الإداري";
    const sheet = wb.addWorksheet("المؤشرات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
    sheet.addRow(["تقرير المؤشرات الدوري"]);
    sheet.addRow(["الفترة", `${v.from || "—"} إلى ${v.to || "—"}`]);
    sheet.addRow(["المؤشر", "القيمة"]);
    const summary = [];
    if (v.metrics.includes("beneficiaries")) summary.push(["إجمالي المستفيدين", d.sum.beneficiaries]);
    if (v.metrics.includes("attendance")) summary.push(["متوسط الحضور %", d.sum.attendancePct]);
    if (v.metrics.includes("hours")) summary.push(["إنجاز الساعات %", d.sum.completionPct]);
    if (v.metrics.includes("tasks")) summary.push(["المهام المنجزة", d.doneTasks.length], ["المهام المتأخرة", d.overdue.length]);
    if (v.metrics.includes("meetings")) summary.push(["الاجتماعات", d.meetings.length]);
    if (v.metrics.includes("registry")) summary.push(["الوارد", d.reg.in], ["الصادر", d.reg.out]);
    summary.forEach((row) => sheet.addRow(row));
    const trackKeys = v.metrics.filter((key) => ["beneficiaries", "attendance", "hours"].includes(key));
    if (trackKeys.length) {
      const trackSheet = wb.addWorksheet("بيانات المسارات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      trackSheet.addRow(["المسار", "النوع", ...trackKeys.map((key) => metricNames[key]), ...(v.metrics.includes("hours") ? ["الساعات المكتملة"] : [])]);
      d.tracks.forEach((t) => trackSheet.addRow([t.name, App.tracks.TYPE_LABEL[t.type], ...trackKeys.map((key) => key === "beneficiaries" ? t.beneficiaries : key === "attendance" ? Number(t.attendancePct) || 0 : App.tracks.hoursPct(t)), ...(v.metrics.includes("hours") ? [t.hoursCompleted] : [])]));
      trackSheet.columns.forEach((col) => { col.width = 22; });
      trackSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, trackSheet.rowCount), column: trackSheet.columnCount } };
      trackSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      trackSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
      const catalog = (store.get().trackCodes || []).filter((r) => r.kind === "phaseCode");
      if (catalog.length) {
        const codeSheet = wb.addWorksheet("ترميز المراحل", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
        codeSheet.addRow(["المرحلة", "المسار", "المجموعة", "رمز المسار", "الرمز"]);
        catalog.forEach((r) => codeSheet.addRow([r.phase, r.trackName, r.group, r.trackCode, r.code]));
        codeSheet.columns = [{ width: 20 }, { width: 40 }, { width: 20 }, { width: 16 }, { width: 24 }];
        codeSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: codeSheet.rowCount, column: codeSheet.columnCount } };
        codeSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        codeSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
      }
    }
    const comparison = comparisonRows(v, d), keys = selectedMetricNames(v);
    if (comparison.length && keys.length) {
      const cmp = wb.addWorksheet(v.compare === "tracks" ? "مقارنة المسارات" : "مقارنة الأشهر", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      cmp.addRow([v.compare === "tracks" ? "المسار" : "الشهر", ...keys.map((key) => metricNames[key])]);
      filteredRows(comparison, v).forEach((row) => cmp.addRow(row));
      cmp.columns.forEach((col) => { col.width = 22; });
      cmp.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, cmp.rowCount), column: keys.length + 1 } };
      cmp.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      cmp.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    }
    sheet.columns = [{ width: 34 }, { width: 24 }];
    sheet.mergeCells("A1:B1");
    sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    sheet.getRow(3).font = { bold: true };
    sheet.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, sheet.rowCount), column: 2 } };
    ui.download(fileBase() + ".xlsx", new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
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
    $("r-model-pick").addEventListener("click", () => $("r-model-file").click());
    $("r-model-file").addEventListener("change", (e) => { addModel(e.target.files[0]); e.target.value = ""; });
    $("r-model-view").addEventListener("click", viewModel);
    $("r-model-del").addEventListener("click", deleteModel);
    renderModel();
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
    if (s.from) $("r-from").value = s.from;
    if (s.to) $("r-to").value = s.to;
    $("r-compare").value = s.compare || "none";
    const trackSelect = $("r-track-filter");
    App.tracks.ordered().forEach((t) => trackSelect.add(new Option(t.name, t.id)));
    trackSelect.value = s.trackFilter || "all";
    document.querySelectorAll("[data-report-metric]").forEach((el) => { el.checked = !Array.isArray(s.metrics) || s.metrics.includes(el.dataset.reportMetric); });
    if (typeof s.charts === "boolean") $("r-charts").checked = s.charts;
    if (typeof s.tasksList === "boolean") $("r-tasks").checked = s.tasksList;
    $("r-recipient").value = s.recipient;
    $("r-recipientTitle").value = s.recipientTitle;
    $("r-trainingStart").value = s.trainingStart;
    $("r-trainingEnd").value = s.trainingEnd;

    document.querySelectorAll("#view-report input, #view-report textarea, #view-report select").forEach((el) => {
      el.addEventListener(el.type === "checkbox" || el.type === "date" || el.tagName === "SELECT" ? "change" : "input", renderPreview);
      el.addEventListener("change", persistSettings);
    });
    ["r-recipient", "r-recipientTitle", "r-trainingStart", "r-trainingEnd"].forEach((id) => $(id).addEventListener("change", persistSettings));
    $("r-ref-auto").addEventListener("click", async () => { $("r-ref").value = await App.registry.assignNumber("out", $("r-date").value || ui.todayISO()); renderPreview(); });
    $("r-word").addEventListener("click", () => exportAs("word"));
    $("r-excel").addEventListener("click", exportExcel);
    $("r-pdf").addEventListener("click", () => exportAs("pdf"));
    $("r-print").addEventListener("click", () => exportAs("print"));
  }

  App.report = { init, render: renderPreview, blocks };
})(window.App = window.App || {});
