/* النماذج الجاهزة: نماذج فارغة تُحمَّل أو تُطبع عند الحاجة، على الترويسة الرسمية.
   كل نموذج دالة تُرجع كتلاً يرسمها محرك المستندات المشترك (طباعة/PDF وWord).
   الحقول الاختيارية العلوية (المسار، المجموعة، المدرب، التاريخ) تُكتب في النموذج إن مُلئت، وإلا تُترك نقاطاً للكتابة بالقلم. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const DOT = "………………………………";
  const state = { q: "", cat: "all", rows: {}, ctx: { track: "", group: "", trainer: "", date: "" } };

  const v = (x, w) => (x && String(x).trim() ? String(x).trim() : w || DOT);
  const blank = (n, cols) => Array.from({ length: n }, (_, i) => [String(i + 1), ...Array(cols - 1).fill("")]);
  const T = (text) => ({ kind: "title", text });
  const B = (text) => ({ kind: "bold", text });
  const P = (text, sizePt) => ({ kind: "para", text: text || "", sizePt });
  const M = (text) => ({ kind: "meta", text, sizePt: 12 });
  const SP = () => P("");
  const grid = (headers, rows, widths, align) => ({ kind: "table", headers, rows, widths, align });
  /* جدول بيانات من عمودين: الحقل | القيمة (فارغة للكتابة) */
  const fields = (list) => grid(["البيان", "التفصيل"], list.map((f) => (Array.isArray(f) ? f : [f, ""])), [0.3, 0.7]);
  const ctxLines = (c) => [
    M(`المسار: ${v(c.track)}      المجموعة: ${v(c.group, "………")}`),
    M(`المدرب: ${v(c.trainer)}      التاريخ: ${v(c.date, "….. / ….. / …..…")}`),
  ];
  const sign = (a, b2) => [SP(), grid([a, b2], [["", ""]], [0.5, 0.5], ["center", "center"])];

  /* كل نموذج: id، العنوان، التصنيف، الوصف، الأيقونة، عدد الصفوف الافتراضي (إن وُجد جدول قابل للتمديد)، البناء */
  const FORMS = [
    {
      id: "att", cat: "trainees", ico: "how_to_reg", title: "كشف حضور المتدربين", rows: 25,
      desc: "كشف يومي لكل مجموعة: الاسم والهوية وتوقيع الحضور والانصراف.",
      build: (c, n) => [T("كشف حضور المتدربين"), ...ctxLines(c), SP(),
        grid(["م", "اسم المتدرب", "رقم الهوية", "توقيع الحضور", "توقيع الانصراف", "ملاحظات"], blank(n, 6), [0.06, 0.28, 0.17, 0.17, 0.17, 0.15], ["center"]),
        ...sign("توقيع المدرب", "اعتماد مسؤول المركز")],
    },
    {
      id: "absent", cat: "trainees", ico: "event_busy", title: "كشف الغياب والتأخر", rows: 15,
      desc: "رصد الغياب والتأخر مع سبب كل حالة والإجراء المتخذ.",
      build: (c, n) => [T("كشف الغياب والتأخر"), ...ctxLines(c), SP(),
        grid(["م", "اسم المتدرب", "النوع (غياب / تأخر)", "السبب", "بعذر؟ (نعم / لا)", "الإجراء المتخذ"], blank(n, 6), [0.06, 0.24, 0.16, 0.22, 0.14, 0.18], ["center"]),
        ...sign("المدرب", "المشرف")],
    },
    {
      id: "grades", cat: "trainees", ico: "grading", title: "كشف درجات الاختبار", rows: 25,
      desc: "رصد درجات الاختبار النظري والعملي والمجموع لكل مجموعة.",
      build: (c, n) => [T("كشف درجات الاختبار"), ...ctxLines(c), M("الاختبار: …………………………      الدرجة العظمى: ……….."), SP(),
        grid(["م", "اسم المتدرب", "رقم الهوية", "النظري", "العملي", "المجموع", "النتيجة"], blank(n, 7), [0.05, 0.27, 0.17, 0.11, 0.11, 0.12, 0.17], ["center"]),
        ...sign("المدرب", "رئيس اللجنة")],
    },
    {
      id: "receive", cat: "trainees", ico: "inventory", title: "كشف استلام (مواد / شهادات / حقائب)", rows: 25,
      desc: "توقيع كل متدرب باستلام ما وُزّع عليه مع التاريخ.",
      build: (c, n) => [T("كشف استلام"), ...ctxLines(c), M("المستلَم: ……………………………………………………"), SP(),
        grid(["م", "اسم المتدرب", "رقم الهوية", "الكمية", "التوقيع بالاستلام", "التاريخ"], blank(n, 6), [0.06, 0.28, 0.18, 0.1, 0.22, 0.16], ["center"]),
        ...sign("المسلِّم", "اعتماد المسؤول")],
    },
    {
      id: "reg", cat: "trainees", ico: "person_add", title: "استمارة تسجيل متدرب",
      desc: "بيانات المتدرب الشخصية والمسار المطلوب وتوقيعه.",
      build: () => [T("استمارة تسجيل متدرب"), SP(),
        fields(["الاسم الرباعي", "رقم الهوية", "تاريخ الميلاد", "الجنس", "الحالة الاجتماعية", "رقم الجوال", "رقم جوال بديل", "العنوان", "المؤهل الدراسي", "المسار المطلوب", "هل سبق التدرب؟ وأين؟", "ملاحظات"]),
        SP(), P("أقرّ بأن البيانات المذكورة أعلاه صحيحة، وأتعهد بالالتزام بأنظمة المركز."), ...sign("توقيع المتدرب", "اعتماد موظف التسجيل")],
    },
    {
      id: "pledge", cat: "trainees", ico: "handshake", title: "تعهد التزام متدرب",
      desc: "تعهد بالانتظام والالتزام بالسلوك وأنظمة المركز.",
      build: () => [T("تعهد والتزام"), SP(),
        P("أنا المتدرب/ة: " + DOT + "     رقم الهوية: " + DOT), P("المسار: " + DOT + "     المجموعة: ……….."), SP(),
        P("أتعهد بما يلي:"),
        P("١. الحضور في المواعيد المحددة والالتزام بساعات التدريب، وعدم تجاوز نسبة الغياب المسموح بها."),
        P("٢. المحافظة على أدوات المركز وتجهيزاته وحسن استخدامها، وتحمّل ما يتلف منها بسبب الإهمال."),
        P("٣. احترام المدربين والزملاء والالتزام بالآداب العامة وتعليمات المركز."),
        P("٤. عدم تصوير القاعات أو نشر أي محتوى منها دون إذن مسبق من إدارة المركز."),
        P("٥. إبلاغ إدارة المركز مسبقاً في حال الاعتذار عن حضور أي جلسة."),
        P("وأقرّ بأن مخالفة ما سبق تعرّضني للمساءلة وفق أنظمة المركز."), ...sign("اسم المتدرب وتوقيعه", "التاريخ")],
    },
    {
      id: "excuse", cat: "trainees", ico: "edit_calendar", title: "طلب استئذان / اعتذار متدرب",
      desc: "يقدّمه المتدرب لتبرير الغياب أو الاستئذان من جلسة.",
      build: (c) => [T("طلب استئذان / اعتذار"), SP(),
        fields(["اسم المتدرب", "رقم الهوية", ["المسار / المجموعة", [c.track, c.group].filter(Boolean).join(" / ")], "نوع الطلب (استئذان / اعتذار عن غياب)", "التاريخ المطلوب", "السبب", "المرفقات (تقرير طبي …)"]),
        SP(), B("رأي المدرب:  ☐ موافق     ☐ غير موافق"), P("ملاحظات: " + DOT), ...sign("توقيع المتدرب", "توقيع المدرب / المشرف")],
    },
    {
      id: "warn", cat: "trainees", ico: "report", title: "إنذار / ملاحظة سلوكية",
      desc: "توثيق مخالفة متدرب والإجراء المتخذ وتوقيعه بالعلم.",
      build: (c) => [T("نموذج إنذار / ملاحظة سلوكية"), SP(),
        fields(["اسم المتدرب", ["المسار / المجموعة", [c.track, c.group].filter(Boolean).join(" / ")], "تاريخ المخالفة", "وصف المخالفة", "رقم الإنذار (الأول / الثاني / الثالث)", "الإجراء المتخذ"]),
        SP(), P("تم إبلاغي بما ورد أعلاه وأتعهد بعدم تكراره."), ...sign("توقيع المتدرب بالعلم", "توقيع المشرف")],
    },
    {
      id: "trainer-eval", cat: "eval", ico: "star_rate", title: "استمارة تقييم المدرب (ورقية)",
      desc: "يعبّئها المتدرب بدرجات من ١ إلى ٥ لعناصر التدريب.",
      build: (c) => [T("استمارة تقييم المدرب"), ...ctxLines({ ...c, date: c.date }), P("ضع علامة (✓) في الخانة المناسبة: ٥ ممتاز … ١ ضعيف"), SP(),
        grid(["م", "عنصر التقييم", "٥", "٤", "٣", "٢", "١"], [
          ["١", "تمكّن المدرب من المادة العلمية", "", "", "", "", ""],
          ["٢", "وضوح الشرح وأسلوب العرض", "", "", "", "", ""],
          ["٣", "الالتزام بمواعيد الحضور والانصراف", "", "", "", "", ""],
          ["٤", "التطبيق العملي وتوفير الأدوات", "", "", "", "", ""],
          ["٥", "التعامل مع المتدربين والإجابة عن الأسئلة", "", "", "", "", ""],
          ["٦", "الاستفادة العامة من التدريب", "", "", "", "", ""],
        ], [0.06, 0.54, 0.08, 0.08, 0.08, 0.08, 0.08], ["center"]),
        SP(), P("ملاحظات واقتراحات: " + DOT), P(DOT + DOT)],
    },
    {
      id: "visit", cat: "eval", ico: "fact_check", title: "نموذج زيارة ميدانية / متابعة جلسة",
      desc: "يملؤه المشرف أثناء زيارة قاعة تدريبية: التجهيز والانضباط والملاحظات.",
      build: (c) => [T("نموذج متابعة جلسة تدريبية"), ...ctxLines(c), M("اسم الزائر: " + DOT + "      وقت الزيارة: ……….."), SP(),
        grid(["م", "بند المتابعة", "متحقق", "غير متحقق", "ملاحظات"], [
          ["١", "حضور المدرب في الموعد", "", "", ""], ["٢", "جاهزية القاعة والأدوات", "", "", ""],
          ["٣", "انتظام المتدربين وعددهم", "", "", ""], ["٤", "تنفيذ الخطة التدريبية", "", "", ""],
          ["٥", "النظافة والسلامة", "", "", ""], ["٦", "التزام المتدربين بالسلوك", "", "", ""],
        ], [0.06, 0.4, 0.14, 0.14, 0.26], ["center"]),
        SP(), P("التوصيات: " + DOT), P("عدد الحاضرين: ………      عدد الغائبين: ………"), ...sign("توقيع الزائر", "توقيع المدرب")],
    },
    {
      id: "minutes", cat: "admin", ico: "history_edu", title: "محضر اجتماع (فارغ)",
      desc: "محضر للكتابة اليدوية: الحضور وجدول الأعمال والقرارات والمهام.",
      build: () => [T("محضر اجتماع"), SP(),
        fields(["موضوع الاجتماع", "التاريخ واليوم", "المكان", "الوقت (من – إلى)", "رئيس الاجتماع", "مقرّر الاجتماع"]),
        SP(), B("الحضور:"), grid(["م", "الاسم", "الصفة", "التوقيع"], blank(8, 4), [0.06, 0.4, 0.3, 0.24], ["center"]),
        SP(), B("جدول الأعمال والقرارات:"), grid(["م", "البند", "القرار / التوصية"], blank(6, 3), [0.06, 0.4, 0.54], ["center"]),
        SP(), B("المهام المنبثقة:"), grid(["م", "المهمة", "المسؤول", "الموعد"], blank(5, 4), [0.06, 0.46, 0.26, 0.22], ["center"]),
        ...sign("مقرّر الاجتماع", "رئيس الاجتماع")],
    },
    {
      id: "tasks", cat: "admin", ico: "checklist", title: "كشف متابعة المهام", rows: 12,
      desc: "جدول مهام بمسؤول وموعد وحالة وملاحظات.",
      build: (c, n) => [T("كشف متابعة المهام"), M("الفترة: من ….. / ….. / ….. إلى ….. / ….. / …..…"), SP(),
        grid(["م", "المهمة", "المسؤول", "الموعد النهائي", "الحالة", "ملاحظات"], blank(n, 6), [0.06, 0.34, 0.18, 0.14, 0.12, 0.16], ["center"]),
        ...sign("المشرف", "المدير")],
    },
    {
      id: "hosp", cat: "admin", ico: "room_service", title: "كشف استلام الضيافة", rows: 15,
      desc: "توقيع الموظفين باستلام الضيافة اليومية.",
      build: (c, n) => [T("كشف استلام الضيافة"), M("التاريخ: ….. / ….. / …..…      اليوم: …………"), SP(),
        grid(["م", "الاسم", "الصفة", "العدد", "التوقيع"], blank(n, 5), [0.06, 0.34, 0.24, 0.1, 0.26], ["center"]),
        ...sign("المسؤول عن الضيافة", "اعتماد المدير")],
    },
    {
      id: "outgoing", cat: "admin", ico: "outbox", title: "سجل الصادر والوارد (ورقي)", rows: 15,
      desc: "سجل يدوي للمعاملات الصادرة والواردة برقم وتاريخ وجهة.",
      build: (c, n) => [T("سجل الصادر والوارد"), M("الشهر: …………………  السنة: …………"), SP(),
        grid(["م", "الرقم", "التاريخ", "النوع (وارد / صادر)", "الجهة", "الموضوع", "الإجراء"], blank(n, 7), [0.05, 0.1, 0.12, 0.13, 0.18, 0.25, 0.17], ["center"]),
        ...sign("أمين السجل", "المدير")],
    },
    {
      id: "custody", cat: "admin", ico: "construction", title: "نموذج استلام عهدة / أدوات", rows: 12,
      desc: "تسليم واستلام أدوات أو أجهزة بين موظفَين مع حالتها.",
      build: (c, n) => [T("نموذج استلام عهدة"), M("التاريخ: ….. / ….. / …..…"), SP(),
        fields(["اسم المستلِم", "الوظيفة / الجهة", "اسم المسلِّم"]), SP(),
        grid(["م", "الصنف", "الكمية", "الحالة", "ملاحظات"], blank(n, 5), [0.06, 0.38, 0.12, 0.18, 0.26], ["center"]),
        SP(), P("أقرّ باستلام الأصناف أعلاه بحالتها الموضحة وأتعهد بالمحافظة عليها وإعادتها عند الطلب."), ...sign("توقيع المستلِم", "توقيع المسلِّم")],
    },
    {
      id: "complaint", cat: "admin", ico: "feedback", title: "نموذج شكوى / مقترح",
      desc: "يقدّمه المتدرب أو الموظف لرفع شكوى أو اقتراح إلى الإدارة.",
      build: () => [T("نموذج شكوى / مقترح"), SP(),
        fields(["الاسم (اختياري)", "رقم الجوال (اختياري)", "المسار / الجهة", "النوع (شكوى / مقترح / ملاحظة)", "التاريخ"]),
        SP(), B("التفاصيل:"), P(DOT + DOT), P(DOT + DOT), P(DOT + DOT), SP(), B("رد الإدارة:"), P(DOT + DOT), P(DOT + DOT), ...sign("مقدّم الطلب", "اعتماد الإدارة")],
    },
  ];
  const CATS = [["all", "الكل"], ["trainees", "المتدربون"], ["eval", "التقييم والمتابعة"], ["admin", "الإدارة والمراسلات"]];
  const byId = (id) => FORMS.find((f) => f.id === id);
  const rowsOf = (f) => Math.max(3, Math.min(80, Number(state.rows[f.id] || f.rows) || f.rows));
  const blocksOf = (f) => f.build({ ...state.ctx }, f.rows ? rowsOf(f) : 0);

  function render() {
    const host = $("frm-body");
    if (!host) return;
    const q = state.q.trim();
    const list = FORMS.filter((f) => (state.cat === "all" || f.cat === state.cat) && (!q || (f.title + f.desc).includes(q)));
    $("frm-cats").innerHTML = CATS.map(([k, t]) => `<button type="button" class="frm-cat${state.cat === k ? " on" : ""}" data-frm-cat="${k}">${t}</button>`).join("");
    host.innerHTML = list.length ? list.map((f) => `<article class="frm-card" data-id="${f.id}">
        <div class="frm-ico"><span class="material-symbols-outlined" aria-hidden="true">${f.ico}</span></div>
        <div class="frm-main"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p>
          ${f.rows ? `<label class="frm-rows">عدد الصفوف <input type="number" min="3" max="80" value="${rowsOf(f)}" data-frm-rows="${f.id}"></label>` : ""}
        </div>
        <div class="frm-act no-print">
          <button type="button" class="btn navy" data-frm="word" data-id="${f.id}"><span class="material-symbols-outlined btn-ico">download</span>Word</button>
          <button type="button" class="btn secondary" data-frm="print" data-id="${f.id}"><span class="material-symbols-outlined btn-ico">print</span>طباعة / PDF</button>
        </div></article>`).join("") : `<p class="frm-empty">لا نموذج يطابق البحث.</p>`;
  }

  async function act(kind, id) {
    const f = byId(id);
    if (!f) return;
    const list = blocksOf(f);
    if (kind === "print") return App.docRender.print(list, f.title, false);
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* يُحمَّل عند الحاجة */ }
    App.docRender.exportWord(list, App.docRender.cleanFileName(f.title));
  }
  async function allZip() {
    if (!(window.JSZip)) return ui.toast("مكتبة الضغط غير متاحة");
    try { if (App.docx && App.docx.load) await App.docx.load(); } catch (e) { /* */ }
    const zip = new window.JSZip();
    FORMS.forEach((f) => { const b = App.docRender.exportWord(blocksOf(f), "", true); if (b) zip.file(App.docRender.cleanFileName(f.title) + ".docx", b); });
    ui.download("نماذج تمكين الجاهزة.zip", await zip.generateAsync({ type: "blob" }));
    ui.toast("نُزّلت كل النماذج في ملف مضغوط واحد");
  }

  function init() {
    const root = $("view-forms");
    if (!root || root.dataset.ready) return;
    root.dataset.ready = "1";
    root.addEventListener("click", (e) => {
      const c = e.target.closest("[data-frm-cat]");
      if (c) { state.cat = c.dataset.frmCat; return render(); }
      const b = e.target.closest("[data-frm]");
      if (b) act(b.dataset.frm, b.dataset.id);
      if (e.target.closest("#frm-zip")) allZip();
    });
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "frm-q") { state.q = t.value; render(); const q = $("frm-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      else if (t.dataset.frmCtx) state.ctx[t.dataset.frmCtx] = t.value;
      else if (t.dataset.frmRows) state.rows[t.dataset.frmRows] = t.value;
    });
  }

  App.forms = { render, init, FORMS, blocksOf };
})(window.App = window.App || {});
