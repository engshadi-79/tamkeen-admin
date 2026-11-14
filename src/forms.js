/* النماذج الجاهزة: نماذج فارغة تُحمَّل أو تُطبع عند الحاجة، على الترويسة الرسمية.
   كل نموذج دالة تُرجع كتلاً يرسمها محرك المستندات المشترك (طباعة/PDF وWord).
   الحقول الاختيارية العلوية (المسار، المجموعة، المدرب، التاريخ) تُكتب في النموذج إن مُلئت، وإلا تُترك نقاطاً للكتابة بالقلم. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const DOT = "………………………………";
  const LS = "tamkeen:my-forms";
  const loadMine = () => { try { const a = JSON.parse(localStorage.getItem(LS) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const saveMine = (a) => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) { ui.toast("تعذّر حفظ القائمة في المتصفح"); } };
  const state = { mine: loadMine(), q: "", cat: "all", rows: {}, ctx: { track: "", group: "", trainer: "", date: "" } };

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
  const CATS = [["all", "الكل"], ["trainees", "المتدربون"], ["eval", "التقييم والمتابعة"], ["admin", "الإدارة والمراسلات"], ["mine", "نماذجي"]];
  const byId = (id) => FORMS.find((f) => f.id === id);
  const rowsOf = (f) => Math.max(3, Math.min(80, Number(state.rows[f.id] || f.rows) || f.rows));
  const blocksOf = (f) => f.build({ ...state.ctx }, f.rows ? rowsOf(f) : 0);

  function render() {
    const host = $("frm-body");
    if (!host) return;
    const q = state.q.trim();
    const list = state.cat === "mine" ? [] : FORMS.filter((f) => (state.cat === "all" || f.cat === state.cat) && (!q || (f.title + f.desc).includes(q)));
    const mine = state.cat === "all" || state.cat === "mine" ? state.mine.filter((m) => !q || m.name.includes(q)) : [];
    const mineHtml = mine.map((m) => `<article class="frm-card frm-mine" data-id="${esc(m.id)}">
        <div class="frm-ico"><span class="material-symbols-outlined" aria-hidden="true">${/pdf$/i.test(m.file) ? "picture_as_pdf" : /xls/i.test(m.file) ? "table_chart" : /png|jpe?g|webp/i.test(m.file) ? "image" : "description"}</span></div>
        <div class="frm-main"><h3>${esc(m.name)}</h3><p>${esc(m.file)} · نموذج من إضافتك</p></div>
        <div class="frm-act no-print">
          <button type="button" class="btn navy" data-frm="m-get" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">download</span>تنزيل</button>
          <button type="button" class="btn secondary" data-frm="m-print" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">print</span>طباعة / PDF</button>
          <button type="button" class="btn secondary" data-frm="m-ren" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">edit</span>تسمية</button>
          <button type="button" class="btn secondary" data-frm="m-del" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">delete</span>حذف</button>
        </div></article>`).join("");
    $("frm-cats").innerHTML = CATS.map(([k, t]) => `<button type="button" class="frm-cat${state.cat === k ? " on" : ""}" data-frm-cat="${k}">${t}</button>`).join("");
    host.innerHTML = mineHtml + (list.length ? list.map((f) => `<article class="frm-card" data-id="${f.id}">
        <div class="frm-ico"><span class="material-symbols-outlined" aria-hidden="true">${f.ico}</span></div>
        <div class="frm-main"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p>
          ${f.rows ? `<label class="frm-rows">عدد الصفوف <input type="number" min="3" max="80" value="${rowsOf(f)}" data-frm-rows="${f.id}"></label>` : ""}
        </div>
        <div class="frm-act no-print">
          <button type="button" class="btn navy" data-frm="word" data-id="${f.id}"><span class="material-symbols-outlined btn-ico">download</span>Word</button>
          <button type="button" class="btn secondary" data-frm="print" data-id="${f.id}"><span class="material-symbols-outlined btn-ico">print</span>طباعة / PDF</button>
        </div></article>`).join("") : (mineHtml ? "" : `<p class="frm-empty">${state.cat === "mine" ? "لم تُضف نماذج بعد. اضغط «إضافة نموذج» أعلاه." : "لا نموذج يطابق البحث."}</p>`));
  }

  async function addMine() {
    const nm = $("frm-add-name"), fl = $("frm-add-file");
    const file = fl && fl.files && fl.files[0];
    if (!file) return ui.toast("اختر ملف النموذج أولاً");
    const name = (nm.value || "").trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      const fid = await App.filesStore.put(file, file.name);
      state.mine.unshift({ id: App.store.uid(), name, file: file.name, fid, at: new Date().toISOString() });
      saveMine(state.mine);
      nm.value = ""; fl.value = "";
      state.cat = "mine"; render();
      ui.toast("أُضيف النموذج «" + name + "»");
    } catch (e) { ui.toast("تعذّر حفظ الملف على هذا الجهاز"); }
  }

  /* طباعة ملف Word (docx): يُحوَّل إلى صفحة HTML قابلة للطباعة (فقرات وجداول وتنسيق الخط والمحاذاة والصور).
     التحويل تقريبي؛ للمطابقة التامة مع الأصل نزّل الملف واطبعه من Word. */
  async function printDocx(blob, title) {
    if (!window.JSZip) return ui.toast("مكتبة فتح الملفات غير متاحة");
    const w = window.open("", "_blank");
    if (!w) return ui.toast("اسمح بالنوافذ المنبثقة لطباعة النموذج");
    try {
      const zip = await window.JSZip.loadAsync(blob);
      const xml = await zip.file("word/document.xml").async("string");
      const relsF = zip.file("word/_rels/document.xml.rels");
      const rels = {};
      if (relsF) new DOMParser().parseFromString(await relsF.async("string"), "text/xml").querySelectorAll("Relationship").forEach((r) => { rels[r.getAttribute("Id")] = r.getAttribute("Target"); });
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const kids = (el, n) => [...el.children].filter((c) => c.localName === n);
      const kid = (el, n) => kids(el, n)[0];
      const val = (el) => (el ? el.getAttributeNS(NS, "val") || el.getAttribute("w:val") : null);
      const imgs = {};
      for (const id of Object.keys(rels)) {
        const f = zip.file("word/" + rels[id].replace(/^\//, "").replace(/^word\//, ""));
        if (f && /\.(png|jpe?g|gif|webp)$/i.test(rels[id])) imgs[id] = "data:image/" + rels[id].split(".").pop().toLowerCase().replace("jpg", "jpeg") + ";base64," + (await f.async("base64"));
      }
      const runHtml = (r) => {
        const pr = kid(r, "rPr");
        let out = "";
        r.querySelectorAll("*").forEach((n) => {
          if (n.localName === "t") out += esc(n.textContent);
          else if (n.localName === "tab") out += "&emsp;";
          else if (n.localName === "br") out += "<br>";
          else if (n.localName === "blip") { const id = n.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"); if (imgs[id]) out += `<img src="${imgs[id]}" style="max-width:100%">`; }
        });
        if (!out) return "";
        if (pr) {
          const sz = val(kid(pr, "sz")); let st = "";
          if (sz) st += `font-size:${Number(sz) / 2}pt;`;
          if (kid(pr, "b") && val(kid(pr, "b")) !== "0") out = `<b>${out}</b>`;
          if (kid(pr, "i") && val(kid(pr, "i")) !== "0") out = `<i>${out}</i>`;
          if (kid(pr, "u") && val(kid(pr, "u")) !== "none") out = `<u>${out}</u>`;
          if (st) out = `<span style="${st}">${out}</span>`;
        }
        return out;
      };
      const paraHtml = (p) => {
        const pr = kid(p, "pPr"); let st = "";
        const jc = pr && val(kid(pr, "jc"));
        const rtl = pr && kid(pr, "bidi");
        const al = { center: "center", both: "justify", left: rtl ? "right" : "left", right: rtl ? "left" : "right", start: "right", end: "left" }[jc];
        if (al) st += `text-align:${al};`;
        const h = (p.textContent || "").trim() === "" && !p.querySelector("blip") ? "&nbsp;" : [...p.querySelectorAll("r")].map(runHtml).join("");
        return `<p style="${st}">${h}</p>`;
      };
      const tblHtml = (t) => `<table>${kids(t, "tr").map((tr) => `<tr>${kids(tr, "tc").map((tc) => {
        const span = val(kid(kid(tc, "tcPr") || tc, "gridSpan"));
        return `<td${span ? ` colspan="${span}"` : ""}>${blocks(tc)}</td>`;
      }).join("")}</tr>`).join("")}</table>`;
      const blocks = (el) => kids(el, "p").length + kids(el, "tbl").length === 0 ? "" : [...el.children].map((c) => (c.localName === "p" ? paraHtml(c) : c.localName === "tbl" ? tblHtml(c) : "")).join("");
      const body = doc.getElementsByTagNameNS(NS, "body")[0] || doc.documentElement;
      w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
        @page{margin:15mm}body{font:14pt/1.6 "Sakkal Majalla","Traditional Arabic","Segoe UI",Tahoma,sans-serif;margin:0;color:#000}
        p{margin:0 0 2pt}table{border-collapse:collapse;width:100%;margin:4pt 0}td{border:1px solid #444;padding:3pt 6pt;vertical-align:top}
      </style></head><body>${blocks(body)}<script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
      w.document.close();
      ui.toast("الطباعة تقريبية؛ للمطابقة التامة نزّل الملف واطبعه من Word");
    } catch (e) {
      console.error(e); w.close();
      ui.toast("تعذّر تحويل الملف للطباعة، نُزّل واطبعه من Word");
    }
  }
  async function mineAct(kind, id) {
    const m = state.mine.find((x) => x.id === id);
    if (!m) return;
    if (kind === "m-get") return App.filesStore.open(m.fid);
    if (kind === "m-print") {
      const f = await App.filesStore.get(m.fid);
      if (!f) return ui.toast("الملف غير موجود على هذا الجهاز");
      if (/\.docx$/i.test(m.file)) return printDocx(f.blob, m.name);
      if (!/pdf|png|jpe?g|webp/i.test(m.file)) { ui.toast("ملفات Excel وWord القديمة (doc) لا تُطبع من المتصفح؛ نُزّل الملف وافتحه لطباعته"); return App.filesStore.open(m.fid); }
      const url = URL.createObjectURL(f.blob);
      if (/pdf$/i.test(m.file)) {
        /* PDF: يُفتح في تبويب جديد يعرض زر الطباعة المدمج */
        const w = window.open(url, "_blank");
        if (!w) ui.toast("اسمح بالنوافذ المنبثقة، أو نزّل الملف واطبعه");
        return;
      }
      /* صورة: صفحة طباعة مباشرة بمقاس الورقة */
      const w = window.open("", "_blank");
      if (!w) return ui.toast("اسمح بالنوافذ المنبثقة لطباعة النموذج");
      w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(m.name)}</title><style>@page{margin:8mm}body{margin:0}img{width:100%}</style></head><body><img src="${url}" onload="setTimeout(function(){window.print()},200)"></body></html>`);
      w.document.close();
      return;
    }
    if (kind === "m-ren") {
      const n = prompt("اسم النموذج", m.name);
      if (n && n.trim()) { m.name = n.trim(); saveMine(state.mine); render(); }
      return;
    }
    if (kind === "m-del") {
      if (!confirm("حذف النموذج «" + m.name + "» من هذا الجهاز؟")) return;
      try { await App.filesStore.remove(m.fid); } catch (e) { /* */ }
      state.mine = state.mine.filter((x) => x.id !== id); saveMine(state.mine); render();
    }
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
      if (b) { if (b.dataset.frm.startsWith("m-")) mineAct(b.dataset.frm, b.dataset.id); else act(b.dataset.frm, b.dataset.id); }
      if (e.target.closest("#frm-add")) addMine();
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
