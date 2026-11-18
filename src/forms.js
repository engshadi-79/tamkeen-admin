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

  const catsHtml = (people) => CATS.map(([k, t]) => `<button type="button" class="frm-cat${state.cat === k ? " on" : ""}" data-frm-cat="${k}">${t}</button>`).join("") +
    people.map((n) => `<button type="button" class="frm-cat frm-person${state.cat === "by:" + n ? " on" : ""}" data-frm-cat="${esc("by:" + n)}"><span class="material-symbols-outlined" aria-hidden="true">person</span>${esc(n)} <b>${visibleDropFiles().filter((f) => (f.by || "بلا اسم") === n).length}</b></button>`).join("");
  function render() {
    const host = $("frm-body");
    if (!host) return;
    const q = state.q.trim();
    const person = state.cat.indexOf("by:") === 0 ? state.cat.slice(3) : null;
    const people = [...new Set(visibleDropFiles().map((f) => f.by || "بلا اسم"))].sort((a, b) => a.localeCompare(b, "ar"));
    const icoOf = (n) => (/pdf$/i.test(n) ? "picture_as_pdf" : /xlsx?$/i.test(n) ? "table_chart" : /(png|jpe?g|webp)$/i.test(n) ? "image" : /(zip|rar|7z)$/i.test(n) ? "folder_zip" : "description");
    const cardOf = (f) => `<article class="frm-card frm-mine">
        <div class="frm-ico"><span class="material-symbols-outlined" aria-hidden="true">${icoOf(f.name)}</span></div>
        <div class="frm-main"><h3>${esc(f.title || f.name.replace(/\.[^.]+$/, ""))}</h3><p>${esc(f.name)} · ${fmtSize(f.size)}</p><p><select class="frm-catsel no-print" data-drop-cat="${esc(f.id)}" aria-label="التصنيف">${catOpts(f.cat)}</select></p><p class="frm-date" title="${esc('تاريخ الرفع: ' + new Date(f.at).toLocaleString('ar'))}"><span class="material-symbols-outlined" aria-hidden="true">event</span>${esc(fileDateLabel(f))}: ${esc(new Date(fileDate(f)).toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" }))} · ${esc(new Date(fileDate(f)).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }))}</p></div>
        <div class="frm-act no-print">
          <button type="button" class="btn navy" data-drop="get" data-id="${esc(f.id)}"><span class="material-symbols-outlined btn-ico">download</span>تنزيل</button>
          <button type="button" class="btn secondary" data-drop="print" data-id="${esc(f.id)}"><span class="material-symbols-outlined btn-ico">print</span>طباعة / PDF</button>
          <button type="button" class="btn secondary" data-drop="edit" data-id="${esc(f.id)}"><span class="material-symbols-outlined btn-ico">edit</span>تعديل</button>
          <button type="button" class="btn secondary" data-drop="del" data-id="${esc(f.id)}"><span class="material-symbols-outlined btn-ico">delete</span>حذف</button>
        </div></article>`;
    const mineFiles = person === null ? [] : visibleDropFiles().filter((f) => (f.by || "بلا اسم") === person && (!q || (f.name + (f.title || "")).includes(q))).sort(compareFileDates);
    const catOf = (f) => (drop.cats.indexOf(f.cat) >= 0 ? f.cat : "غير مصنّف");
    const catNames = drop.cats.concat(mineFiles.some((f) => catOf(f) === "غير مصنّف") ? ["غير مصنّف"] : []);
    const countIn = (c) => mineFiles.filter((f) => catOf(f) === c).length;
    const shown = catNames.filter((c) => (!drop.dcat || drop.dcat === c) && countIn(c));
    const dropHtml = !mineFiles.length ? "" :
      `<div class="frm-catchips no-print"><button type="button" class="frm-cat${!drop.dcat ? " on" : ""}" data-drop="dcat" data-id="">الكل <b>${mineFiles.length}</b></button>` +
      catNames.filter(countIn).map((c) => `<button type="button" class="frm-cat${drop.dcat === c ? " on" : ""}" data-drop="dcat" data-id="${esc(c)}">${esc(c)} <b>${countIn(c)}</b></button>`).join("") + `</div>` +
      shown.map((c) => `<h3 class="frm-grouphead"><span class="material-symbols-outlined" aria-hidden="true">folder</span>${esc(c)} <small>${countIn(c)}</small></h3>` + `<div class="frm-groupgrid">` + mineFiles.filter((f) => catOf(f) === c).map(cardOf).join("") + `</div>`).join("");
    if (person !== null) {
      $("frm-cats").innerHTML = catsHtml(people);
      host.innerHTML = `<div class="frm-personbar no-print"><b><span class="material-symbols-outlined" aria-hidden="true">person</span>${esc(person)}</b>
          <button type="button" class="btn secondary" data-drop="p-ren" data-id="${esc(person)}"><span class="material-symbols-outlined btn-ico">edit</span>تعديل الاسم</button>
          <button type="button" class="btn secondary frm-danger" data-drop="p-del" data-id="${esc(person)}"><span class="material-symbols-outlined btn-ico">delete</span>حذف الشخص وكل ملفاته</button></div>` +
        (drop.sourceDates[person] ? `<p class="frm-note">مرتبة داخل كل تصنيف من الأحدث إنشاءً إلى الأقدم. عند غياب تاريخ الإنشاء الأصلي يُستخدم آخر تعديل؛ ويظل تاريخ الرفع محفوظاً في سجل الملفات أدناه.</p>` : "") +
        (dropHtml || `<p class="frm-empty">لا ملفات لهذا الشخص${q ? " تطابق البحث" : ""}.</p>`);
      return renderDrop();
    }
    const list = state.cat === "mine" ? [] : FORMS.filter((f) => (state.cat === "all" || f.cat === state.cat) && (!q || (f.title + f.desc).includes(q)));
    const mine = state.cat === "all" || state.cat === "mine" ? state.mine.filter((m) => !q || m.name.includes(q)) : [];
    const mineHtml = mine.map((m) => `<article class="frm-card frm-mine" data-id="${esc(m.id)}">
        <div class="frm-ico"><span class="material-symbols-outlined" aria-hidden="true">${/pdf$/i.test(m.file) ? "picture_as_pdf" : /xls/i.test(m.file) ? "table_chart" : /png|jpe?g|webp/i.test(m.file) ? "image" : "description"}</span></div>
        <div class="frm-main"><h3>${esc(m.name)}</h3><p>${esc(m.file)} · ${m.pid ? "الطباعة من نسخة PDF مرفقة" : "نموذج من إضافتك"}</p></div>
        <div class="frm-act no-print">
          <button type="button" class="btn navy" data-frm="m-get" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">download</span>تنزيل</button>
          <button type="button" class="btn secondary" data-frm="m-print" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">print</span>طباعة / PDF</button>
          ${/\.docx?$/i.test(m.file) ? `<button type="button" class="btn secondary" data-frm="m-pdf" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">picture_as_pdf</span>${m.pid ? "تغيير PDF" : "إرفاق PDF"}</button>` : ""}
          <button type="button" class="btn secondary" data-frm="m-ren" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">edit</span>تسمية</button>
          <button type="button" class="btn secondary" data-frm="m-del" data-id="${esc(m.id)}"><span class="material-symbols-outlined btn-ico">delete</span>حذف</button>
        </div></article>`).join("");
    renderDrop();
    $("frm-cats").innerHTML = catsHtml(people);
    if (dropKey() && drop.files === null && !drop.busy && !drop.tried) { drop.tried = true; dropAct("load"); }
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
      const pf = $("frm-add-pdf") && $("frm-add-pdf").files[0];
      const pid = pf ? await App.filesStore.put(pf, pf.name) : "";
      state.mine.unshift({ id: App.store.uid(), name, file: file.name, fid, pid, at: new Date().toISOString() });
      saveMine(state.mine);
      nm.value = ""; fl.value = ""; if ($("frm-add-pdf")) $("frm-add-pdf").value = "";
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
  /* طباعة ملف بحسب نوعه: PDF يُفتح بزر الطباعة المدمج، الصورة صفحة طباعة، docx يُحوَّل، وغير ذلك يُنزَّل */
  function printBlob(blob, file, title) {
    if (/\.docx$/i.test(file)) return printDocx(blob, title);
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file)) { ui.toast("هذا النوع لا يُطبع من المتصفح؛ نُزّل الملف وافتحه لطباعته"); return ui.download(file, blob); }
    if (/pdf$/i.test(file)) {
      const w = window.open(URL.createObjectURL(new Blob([blob], { type: "application/pdf" })), "_blank");
      if (!w) ui.toast("اسمح بالنوافذ المنبثقة، أو نزّل الملف واطبعه");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) return ui.toast("اسمح بالنوافذ المنبثقة لطباعة النموذج");
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:8mm}body{margin:0}img{width:100%}</style></head><body><img src="${URL.createObjectURL(blob)}" onload="setTimeout(function(){window.print()},200)"></body></html>`);
    w.document.close();
  }
  async function mineAct(kind, id) {
    const m = state.mine.find((x) => x.id === id);
    if (!m) return;
    if (kind === "m-get") return App.filesStore.open(m.fid);
    if (kind === "m-print") {
      const f = await App.filesStore.get(m.pid || m.fid);
      if (!f) return ui.toast("الملف غير موجود على هذا الجهاز");
      if (m.pid) { const w2 = window.open(URL.createObjectURL(f.blob), "_blank"); if (!w2) ui.toast("اسمح بالنوافذ المنبثقة، أو نزّل الملف واطبعه"); return; }
      return printBlob(f.blob, m.file, m.name);
    }
    if (kind === "m-pdf") {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".pdf";
      inp.onchange = async () => {
        const pf = inp.files[0]; if (!pf) return;
        try { if (m.pid) await App.filesStore.remove(m.pid); m.pid = await App.filesStore.put(pf, pf.name); saveMine(state.mine); render(); ui.toast("أُرفقت نسخة PDF؛ ستُطبع منها"); } catch (e) { ui.toast("تعذّر حفظ ملف PDF"); }
      };
      inp.click(); return;
    }
    if (kind === "m-ren") {
      const n = prompt("اسم النموذج", m.name);
      if (n && n.trim()) { m.name = n.trim(); saveMine(state.mine); render(); }
      return;
    }
    if (kind === "m-del") {
      if (!confirm("حذف النموذج «" + m.name + "» من هذا الجهاز؟")) return;
      try { await App.filesStore.remove(m.fid); if (m.pid) await App.filesStore.remove(m.pid); } catch (e) { /* */ }
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
      const d = e.target.closest("[data-drop]");
      if (d) dropAct(d.dataset.drop, d.dataset.id);
      if (e.target.closest("#frm-zip")) allZip();
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.dropCat) dropAct("setcat", t.dataset.dropCat, t.value);
    });
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "frm-q") { state.q = t.value; render(); const q = $("frm-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      else if (t.id === "frm-drop-key") { try { localStorage.setItem(DROP_LS, t.value.trim()); } catch (er) { /* */ } }
      else if (t.dataset.catI !== undefined && drop.draft) { drop.draft[Number(t.dataset.catI)].name = t.value; }
      else if (t.dataset.frmCtx) state.ctx[t.dataset.frmCtx] = t.value;
      else if (t.dataset.frmRows) state.rows[t.dataset.frmRows] = t.value;
    });
  }

  /* ===== ملفات الزملاء: يرفعها الزميل من صفحة drop.html إلى Drive (خادم Apps Script)، وتُعرض هنا برمز القراءة ===== */
  const DROP_LS = "tamkeen:drop-key";
  const drop = { files: null, busy: false, err: "", folder: "", cats: ["تقارير", "كتب ومراجع", "نماذج", "خطابات", "صور", "أخرى"], dcat: "", draft: null, sourceDates: Object.create(null), dateCache: Object.create(null), dateErr: "" };
  // Date manifests stay in the same private Drive folder and use its existing read key.
  const DATE_MANIFEST = "tamkeen-original-dates.v1.json";
  const visibleDropFiles = () => (drop.files || []).filter((f) => f.name !== DATE_MANIFEST);
  const sourceDate = (f) => drop.sourceDates[f.by || ""]?.get(JSON.stringify([f.name, Number(f.size)]));
  const fileDate = (f) => sourceDate(f)?.date || f.at;
  const fileDateLabel = (f) => sourceDate(f) ? (sourceDate(f).source === "created" ? "تاريخ الإنشاء الأصلي" : "آخر تعديل (بديل الإنشاء)") : "تاريخ الرفع";
  const compareFileDates = (a, b) => (Date.parse(fileDate(b)) || 0) - (Date.parse(fileDate(a)) || 0) || String(a.name).localeCompare(String(b.name), "ar") || String(a.id).localeCompare(String(b.id));
  async function loadSourceDates() {
    drop.sourceDates = Object.create(null); drop.dateErr = "";
    const seen = new Set();
    const manifests = (drop.files || []).filter((f) => f.name === DATE_MANIFEST).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const f of manifests) {
      if (seen.has(f.by)) continue;
      seen.add(f.by);
      try {
        if (Number(f.size) > 2097152) throw new Error("بيانات التواريخ أكبر من المتوقع");
        let map = drop.dateCache[f.id];
        if (!map) {
          const payload = await dropCall("dropFile", { id: f.id });
          const raw = atob(payload.data || "");
          const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
          if (data.schema !== "tamkeen-source-dates/v1" || typeof data.by !== "string" || !Array.isArray(data.files)) throw new Error("بيانات تواريخ غير صالحة");
          map = new Map();
          for (const entry of data.files) {
            if (typeof entry.name !== "string" || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isFinite(Date.parse(entry.date)) || !["created", "modified"].includes(entry.source)) continue;
            map.set(JSON.stringify([entry.name, entry.size]), { date: entry.date, source: entry.source });
          }
          drop.dateCache[f.id] = map;
        }
        drop.sourceDates[f.by] = map;
      } catch (e) { drop.dateErr = "تعذّر تحميل التواريخ الأصلية؛ تُعرض تواريخ الرفع مؤقتاً. أعد تحديث القائمة."; }
    }
  }
  const dropUrl = () => (App.cloud && App.cloud.oldUrl) || "";
  const dropKey = () => { try { return localStorage.getItem(DROP_LS) || ""; } catch (e) { return ""; } };
  async function dropCall(action, extra) {
    const res = await fetch(dropUrl(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action, key: dropKey() }, extra || {})) });
    const d = await res.json();
    if (d.error) throw new Error((d.error === "UNAUTHORIZED" || d.error === "رمز غير صحيح") ? "مساعد Google لم يُحدَّث بعد (الصق SupabaseBackup.gs الجديد وانشره)" : d.error);
    return d;
  }
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " م.ب" : Math.max(1, Math.round(n / 1024)) + " ك.ب");
  const catOpts = (cur) => `<option value=""${drop.cats.indexOf(cur) < 0 ? " selected" : ""}>غير مصنّف</option>` + drop.cats.map((c) => `<option${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("");
  function catManager() {
    if (!drop.draft) return "";
    return `<div class="frm-catman no-print"><b>إدارة التصنيفات</b>
      <p class="frm-note">غيّر الاسم فتنتقل ملفاته معه، أو أضف تصنيفاً. حذف تصنيف لا يحذف ملفاته، بل تظهر تحت «غير مصنّف» حتى تصنّفها.</p>
      ${drop.draft.map((c, i) => `<div class="frm-catrow"><input type="text" maxlength="30" value="${esc(c.name)}" data-cat-i="${i}" aria-label="اسم التصنيف"><button type="button" class="btn secondary" data-drop="cat-del" data-id="${i}" aria-label="حذف التصنيف"><span class="material-symbols-outlined btn-ico">delete</span></button></div>`).join("")}
      <div class="btn-row"><button type="button" class="btn secondary" data-drop="cat-add"><span class="material-symbols-outlined btn-ico">add</span>تصنيف جديد</button>
      <button type="button" class="btn navy" data-drop="cat-save"><span class="material-symbols-outlined btn-ico">check</span>حفظ التصنيفات</button>
      <button type="button" class="btn secondary" data-drop="cat-cancel">إلغاء</button></div></div>`;
  }
  function renderDrop() {
    const host = $("frm-drop");
    if (!host) return;
    const link = location.origin + location.pathname.replace(/[^/]*$/, "") + "drop.html";
    const q = state.q.trim();
    const list = visibleDropFiles().filter((f) => !q || (f.name + f.by).includes(q)).sort(compareFileDates);
    host.innerHTML = `<div class="frm-drophead"><h3>ملفات الزملاء</h3>
        <div class="btn-row"><button type="button" class="btn secondary" data-drop="cats"><span class="material-symbols-outlined btn-ico">sell</span>إدارة التصنيفات</button><button type="button" class="btn secondary" data-drop="copy"><span class="material-symbols-outlined btn-ico">link</span>نسخ رابط الرفع</button>
        <button type="button" class="btn navy" data-drop="load"><span class="material-symbols-outlined btn-ico">refresh</span>${drop.busy ? "جارٍ التحميل…" : drop.files ? "تحديث القائمة" : "عرض الملفات"}</button></div></div>
      <p class="frm-note">أرسل «رابط الرفع» لزميلك: يفتحه ويرفع ملفاته بلا دخول، فتُحفظ في Drive عندك داخل «أرشيف مساعد تمكين ← ملفات الزملاء». <span dir="ltr">${esc(link)}</span></p>
      <label class="frm-key">رمز القراءة (يظهر في السجل بعد تشغيل setupDropKey) <input type="password" id="frm-drop-key" value="${esc(dropKey())}" autocomplete="off"></label>
      ${drop.err || drop.dateErr ? `<p class="frm-err">${esc(drop.err || drop.dateErr)}</p>` : ""}${catManager()}
      ${drop.files ? (list.length ? `<table class="cc-table"><thead><tr><th>الملف</th><th>التصنيف</th><th>رفعه</th><th>تاريخ الملف</th><th>تاريخ الرفع</th><th>الحجم</th><th></th></tr></thead><tbody>${list.map((f) => `<tr><td>${f.title ? `<b>${esc(f.title)}</b><br>` : ""}${esc(f.name)}</td><td>${esc(drop.cats.indexOf(f.cat) >= 0 ? f.cat : "غير مصنّف")}</td><td>${esc(f.by || "—")}</td><td>${esc(new Date(fileDate(f)).toLocaleString("ar"))}<br><small>${esc(fileDateLabel(f))}</small></td><td>${esc(new Date(f.at).toLocaleString("ar"))}</td><td>${fmtSize(f.size)}</td><td><button type="button" class="cc-link" data-drop="get" data-id="${esc(f.id)}">تنزيل</button></td></tr>`).join("")}</tbody></table>${drop.folder ? `<p class="frm-note"><a href="${esc(drop.folder)}" target="_blank" rel="noopener">فتح المجلد في Google Drive</a></p>` : ""}` : `<p class="frm-empty">لا ملفات مرفوعة بعد.</p>`) : ""}`;
  }
  async function dropAct(kind, id, extra) {
    if (kind === "copy") { ui.copyText(location.origin + location.pathname.replace(/[^/]*$/, "") + "drop.html"); return ui.toast("نُسخ رابط الرفع"); }
    if (kind === "load") {
      if (drop.busy) return;
      if (!dropKey()) return ui.toast("اكتب رمز القراءة أولاً");
      drop.busy = true; drop.err = ""; renderDrop();
      try { const d = await dropCall("dropList"); drop.files = d.files || []; drop.folder = d.folder || ""; if (d.cats && d.cats.length) drop.cats = d.cats; await loadSourceDates(); } catch (e) { drop.err = (e && e.message) || "تعذّر الاتصال بخادم Drive"; }
      drop.busy = false; return render();
    }
    const NEED = "هذه الميزة تحتاج تحديث سكربت Google إلى الإصدار الجديد";
    const run = async (action, extra, okMsg) => {
      try {
        await dropCall(action, extra);
        const d = await dropCall("dropList"); drop.files = d.files || []; await loadSourceDates();
        if (state.cat.indexOf("by:") === 0 && !drop.files.some((f) => (f.by || "بلا اسم") === state.cat.slice(3))) state.cat = extra && extra.to ? "by:" + extra.to : "all";
        render(); ui.toast(okMsg);
      } catch (e) { ui.toast(/غير معروف/.test((e && e.message) || "") ? NEED : (e && e.message) || "تعذّر التنفيذ"); }
    };
    if (kind === "dcat") { drop.dcat = id || ""; return render(); }
    if (kind === "cats") { drop.draft = drop.draft ? null : drop.cats.map((c) => ({ orig: c, name: c })); return renderDrop(); }
    if (kind === "cat-add") { drop.draft.push({ orig: "", name: "" }); renderDrop(); const ins = document.querySelectorAll("#frm-drop [data-cat-i]"); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (kind === "cat-del") { drop.draft.splice(Number(id), 1); return renderDrop(); }
    if (kind === "cat-cancel") { drop.draft = null; return renderDrop(); }
    if (kind === "cat-save") {
      const names = drop.draft.map((c) => c.name.trim()).filter(Boolean);
      if (!names.length) return ui.toast("أبقِ تصنيفاً واحداً على الأقل");
      if (new Set(names).size !== names.length) return ui.toast("في القائمة اسمان متشابهان");
      const renames = {};
      drop.draft.forEach((c) => { if (c.orig && c.name.trim() && c.name.trim() !== c.orig) renames[c.orig] = c.name.trim(); });
      try {
        await dropCall("dropCatsSave", { cats: names, renames });
        drop.draft = null;
        const d = await dropCall("dropList"); drop.files = d.files || []; if (d.cats) drop.cats = d.cats; await loadSourceDates();
        render(); ui.toast("حُفظت التصنيفات");
      } catch (e) { ui.toast(/غير معروف/.test((e && e.message) || "") ? NEED : (e && e.message) || "تعذّر الحفظ"); }
      return;
    }
    if (kind === "setcat") {
      return run("dropEdit", { id, cat: extra || "" }, "نُقل الملف إلى التصنيف");
    }
    const fileOf = () => (drop.files || []).find((f) => f.id === id);
    if (kind === "edit") {
      const f = fileOf(); if (!f) return;
      const title = prompt("عنوان الملف (اتركه فارغاً ليظهر اسم الملف)", f.title || "");
      if (title === null) return;
      const by = prompt("اسم صاحب الملف (غيّره لنقل الملف إلى شخص آخر)", f.by || "");
      if (by === null) return;
      return run("dropEdit", { id, title: title.trim(), by: by.trim() || f.by, to: by.trim() || f.by }, "حُفظ التعديل");
    }
    if (kind === "del") {
      const f = fileOf(); if (!f) return;
      if (!confirm("حذف الملف «" + (f.title || f.name) + "»؟\nيُنقل إلى سلة مهملات Google Drive ويمكن استعادته منها خلال 30 يوماً.")) return;
      return run("dropDelete", { id }, "نُقل الملف إلى سلة مهملات Drive");
    }
    if (kind === "p-ren") {
      const to = prompt("الاسم الجديد", id);
      if (!to || !to.trim() || to.trim() === id) return;
      return run("dropRenameBy", { from: id === "بلا اسم" ? "" : id, to: to.trim() }, "عُدّل الاسم على كل ملفاته");
    }
    if (kind === "p-del") {
      const n = visibleDropFiles().filter((f) => (f.by || "بلا اسم") === id).length;
      if (!confirm("حذف «" + id + "» وكل ملفاته (" + n + ")؟\nتُنقل الملفات إلى سلة مهملات Google Drive ويمكن استعادتها منها خلال 30 يوماً.")) return;
      return run("dropDeleteBy", { by: id === "بلا اسم" ? "" : id }, "حُذف الشخص ونُقلت ملفاته إلى سلة المهملات");
    }
    if (kind === "get" || kind === "print") {
      ui.toast(kind === "print" ? "جارٍ تجهيز الملف للطباعة…" : "جارٍ التنزيل…");
      try {
        const d = await dropCall("dropFile", { id });
        const bin = atob(d.data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: d.mime || "application/octet-stream" });
        if (kind === "print") printBlob(blob, d.name, d.name.replace(/\.[^.]+$/, ""));
        else ui.download(d.name, blob);
      } catch (e) { ui.toast((e && e.message) || "تعذّر التنزيل"); }
    }
  }

  App.forms = { render, init, FORMS, blocksOf };
})(window.App = window.App || {});
