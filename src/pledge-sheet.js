/* كشف تعهّد استلام الحقيبة التدريبية: ديباجة ثم جدول (م، الاسم، رقم الهوية، المرحلة، التوقيع) على الترويسة الرسمية.
   هذا الملف يبني «كتل المستند» فقط (نفس صيغة المراسلات والتقارير)، فيُطبع أو يُصدَّر Word بمحرّك المستندات المشترك.
   لا يعرف مصدر الطلاب ولا الواجهة. */
(function (App) {
  const DEFAULTS = {
    title: "تعهد استلام الحقيبة التدريبية",
    announcerTitle: "كشف أسماء الخريجين",   // عنوان نسخة المذيع
    announcerSizePt: 14,                    // خط جدول نسخة المذيع (يصغَّر تلقائياً إن لزم ليتّسع نفس عدد صفوف كشف التوقيع)
    preamble: "أقرّ أنا المتدرب/ـة الموقِّع/ـة أدناه بأنني استلمتُ الحقيبة التدريبية الخاصة بي كاملةً وبحالة سليمة، وأتعهّد باستعمالها في مشروعي الخاص، وبعدم بيعها أو التنازل عنها أو التصرف فيها بأي صورة لأي جهة أو شخص، وأتحمّل كامل المسؤولية عن مخالفة ذلك.",
    prefixMode: "count",     // count: (عدد أوراق المجموعة-الرقم) | all: (عدد كل الأوراق-الرقم) | fixed: رقم يكتبه المستخدم | none: (الرقم) فقط
    prefix: "1",
    autoFit: true,           // عدد الصفوف يُقاس تلقائياً ليلائم الصفحة المطبوعة (يعتمد طول الديباجة)
    perPage: 12,    // معايرة الطباعة على الترويسة: 13 صفاً تتّسع و14 لا؛ 12 هامش أمان للديباجة الأطول
    repeatPreamble: true,    // الديباجة في أعلى كل ورقة (لتكون كل ورقة موقَّعة مكتملة)
    split: "track",          // track: أسماء كل مسار معاً (حتى لو أكثر من مرحلة أو مجموعة) | group: ورقة لكل مجموعة | none: كشف واحد
    genderSplit: false,      // كشف للذكور وكشف للإناث داخل كل مسار/مجموعة (ترقيم أوراق مستقل لكلٍّ منهما)
    chairStart: 1,           // أرقام الكراسي: أول رقم
    chairNames: false,       // اسم الطالب تحت رقم كرسيه
    chairTags: false,        // المسار والجنس بخط صغير تحت الرقم
    chairLogos: true,        // شعار المركز السعودي (يمين) وتمكين (يسار) أعلى كل بطاقة
    chairCol: true,          // عمود «رقم الكرسي» قبل التوقيع في كشف التوقيع (نفس أرقام البطاقات)
  };
  /* «ذكر/أنثى» بأي صيغة ← ذكور / إناث / غير محدد */
  const SEX_ORDER = ["ذكور", "إناث", "غير محدد"];
  const sexOf = (g) => { const t = clean(g).replace(/[أإآ]/g, "ا"); return /^(ذكر|ذكور|male|m)$/i.test(t) ? "ذكور" : /^(انثى|انثي|اناث|female|f)$/i.test(t) ? "إناث" : "غير محدد"; };
  const SEX_TITLE = { "ذكور": "كشف الذكور", "إناث": "كشف الإناث", "غير محدد": "جنس غير محدد" };

  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const HEADERS = ["م", "الاسم", "رقم الهوية", "المرحلة", "التوقيع"];
  const WIDTHS = [0.07, 0.38, 0.17, 0.15, 0.23];
  const ALIGN = ["center", "left", "center", "center", "center"];
  // مع عمود «رقم الكرسي» قبل التوقيع (نفس أرقام بطاقات الكراسي)
  const C_HEADERS = ["م", "الاسم", "رقم الهوية", "المرحلة", "الكرسي", "التوقيع"];
  const C_WIDTHS = [0.05, 0.38, 0.15, 0.15, 0.07, 0.20];
  const C_ALIGN = ["center", "left", "center", "center", "center", "center"];
  // نسخة المذيع: الترتيب نفسه، بجدول (م، الاسم، المرحلة) بخط أكبر ليُقرأ على المنصة
  const A_HEADERS = ["م", "الاسم", "المرحلة"], A_WIDTHS = [0.1, 0.62, 0.28], A_ALIGN = ["center", "left", "center"];

  /* ترتيب أبجدي عربي يتجاهل «ال» والهمزات (نفس منطق ترتيب المحوّل) */
  const sortKey = (n) => clean(n).replace(/^ال/, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "");
  const byName = (a, b) => sortKey(a.name).localeCompare(sortKey(b.name), "ar");

  /* students: [{name,id,stage,group,course}] ← كتل المستند. options تُدمَج فوق DEFAULTS.
     ترقيم الأوراق (prefixMode):
       count: (عدد أوراق المجموعة-رقم الورقة) مثل (5-1) (5-2)… وهو الافتراضي
       all:   (عدد كل الأوراق-رقم الورقة) على الكشف كله
       fixed: (رقم يكتبه المستخدم-رقم الورقة)
       none:  (رقم الورقة) فقط
     والورقة الوحيدة في نطاق ترقيمها لا رقم لها (عدا الرقم الثابت). */
  /* ===== عرض كل عمود حسب أطول نص فيه، و«التوقيع» يأخذ الباقي حتى حافة الجدول =====
     measure(text, bold, sizePt) ← عرض النص بالنقاط (يُمرَّر من المتصفح بقياس الخط الفعلي؛ وإلا تقدير محافظ) */
  const TABLE_PT = 468;          // عرض منطقة النص بين هامشَي الترويسة (6.5 إنش)
  const CELL_PAD = 24;           // هوامش الخلية الداخلية (9 نقاط لكل جانب في الطباعة، 5.8 في Word) + أمان
  const SIGN_EXTEND = 36;        // امتداد جدول الكشف في الهامش الأيسر (نقطة ≈ 1.3 سم؛ يبقى هامش 1.3 سم)
  const MIN_PAD = 20;            // أقل هامش يتّسع فيه النص بلا التفاف (18 هامش الطباعة + 2)
  const SIG_MIN = 0.15;          // أقل عرض لخانة التوقيع (الاسم المقروء أولى؛ في الكشوف العادية يأخذ التوقيع أكثر بكثير)
  // تقدير احتياطي (حين لا يتوفر قياس الخط): Sakkal Majalla ضيّق — قِيس الحرف العربي نحو 0.31 من حجم الخط، فنأخذ 0.36 بهامش
  const estimate = (text, bold, size) => [...String(text == null ? "" : text)].reduce((a, ch) => a + (/[0-9٠-٩]/.test(ch) ? 0.5 : /\s/.test(ch) ? 0.25 : 0.36), 0) * size * (bold ? 1.08 : 1);
  function fitWidths(headers, rows, opts) {
    const meas = opts.measure || estimate, n = headers.length, sig = n - 1, nameI = headers.indexOf("الاسم");
    const style = opts.colStyle || [];
    const text = headers.map((h, i) => (i === sig ? 0 : Math.max(meas(h, true, 12), ...rows.map((r) => meas(r[i], !!(style[i] && style[i].bold), (style[i] && style[i].sizePt) || 12)))));
    const need = text.map((t, i) => (i === sig ? 0 : t + CELL_PAD));
    const room = TABLE_PT * (1 - SIG_MIN), used = need.reduce((a, b) => a + b, 0);
    if (used > room && nameI >= 0) need[nameI] = Math.max(TABLE_PT * 0.22, need[nameI] - (used - room));   // الاسم وحده يلتفّ إن ضاق المكان
    let tot = need.reduce((a, b) => a + b, 0);
    if (tot > room) { const f = room / tot; need.forEach((w, i) => { need[i] = w * f; }); tot = room; }
    /* توقيع أعرض (sigBoost، افتراضياً +30% من باقي منطقة النص). مصدر الزيادة بالترتيب:
       1) امتداد الجدول في الهامش الأيسر (widthPt، نهاية السطر في العربية) 2) هوامش الأمان في الأعمدة (بلا مساس بنصّها)
       3) عمود الاسم وحده (قد يلتفّ أطول الأسماء). لا تقصير للنصوص ولا تصغير للخط */
    const W = Math.max(TABLE_PT, opts.widthPt || TABLE_PT);
    const target = (TABLE_PT - tot) * (opts.sigBoost == null ? 1.3 : opts.sigBoost);
    let extra = Math.max(0, target - (W - tot));
    for (let i = 0; i < n && extra > 0; i++) {
      if (i === sig) continue;
      const take = Math.min(extra, Math.max(0, need[i] - (text[i] + MIN_PAD)));
      need[i] -= take; extra -= take;
    }
    if (extra > 0 && nameI >= 0) { const take = Math.min(extra, Math.max(0, need[nameI] - TABLE_PT * 0.18)); need[nameI] -= take; extra -= take; }
    tot = need.reduce((a, b, i) => a + (i === sig ? 0 : b), 0);
    need[sig] = W - tot;
    return need.map((w) => w / W);
  }

  /* ترتيب الكشوف (مشترك بين كشف التوقيع ونسخة المذيع وأرقام الكراسي): مجموعات بحسب المسار/المجموعة (والجنس)، وأبجدياً داخل كل مجموعة.
     يعيد [{ base, sex, rows }] بالترتيب الذي تُطبع به الأوراق */
  function arrange(students, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const list = (students || []).filter((s) => clean(s.name)), groups = new Map();
    const keyOf0 = o.split === "group" ? (s) => clean(s.group) || "—" : o.split === "none" ? () => "" : (s) => clean(s.track) || "—";
    const SEP = "\u0001", keyOf = o.genderSplit ? (s) => keyOf0(s) + SEP + sexOf(s.gender) : keyOf0;
    list.forEach((s) => { const k = keyOf(s); (groups.get(k) || groups.set(k, []).get(k)).push(s); });
    const keys = [...groups.keys()].sort((a, b) => { const [ab, as] = a.split(SEP), [bb, bs] = b.split(SEP); return ab.localeCompare(bb, "ar", { numeric: true }) || SEX_ORDER.indexOf(as) - SEX_ORDER.indexOf(bs); });
    return keys.map((k) => { const [base, sex] = k.split(SEP); return { base, sex: sex || "", rows: groups.get(k).slice().sort(byName) }; });
  }
  function build(students, options, mode) {
    const ann = mode === "announcer";
    const o = Object.assign({}, DEFAULTS, options || {});
    const perPage = Math.max(5, Math.min(40, Math.round(Number(o.perPage)) || DEFAULTS.perPage));
    const list = students.filter((s) => clean(s.name));
    const blocks = [], sheets = [];   // sheets: لكل ورقة { meta, k (داخل مجموعتها), gTotal }
    const bySex = {}; if (o.genderSplit) list.forEach((s) => { const x = sexOf(s.gender); bySex[x] = (bySex[x] || 0) + 1; });

    // رقم الكرسي: عدّاد متصل عبر كل المجموعات بترتيب الطباعة نفسه (يطابق بطاقات الكراسي chairs())
    const chairCol = !ann && !!o.chairCol;
    let seatNext = Math.max(1, Math.round(Number(o.chairStart)) || 1);
    // كشف التوقيع: رقم الكرسي غامق بحجم 16، وعرض الأعمدة حسب أطول نص فيها (واحد لكل الأوراق ليتطابق شكلها)
    const signHeads = chairCol ? C_HEADERS : HEADERS;
    const colStyle = chairCol ? [null, null, null, null, { bold: true, sizePt: 16 }, null] : null;
    let signWidths = chairCol ? C_WIDTHS : WIDTHS;
    // جدول كشف التوقيع يمتد في الهامش الأيسر بمقدار SIGN_EXTEND ليأخذ التوقيع مساحته حتى حافة الورقة تقريباً
    const signWidthPt = !ann && o.fitCols !== false ? TABLE_PT + (o.signExtend == null ? SIGN_EXTEND : Number(o.signExtend) || 0) : 0;
    if (!ann && o.fitCols !== false) {
      const all = []; let sx = seatNext;
      arrange(list, o).forEach((g) => g.rows.forEach((s, i) => all.push([String(i + 1), clean(s.name), clean(s.id), clean(s.stage)].concat(chairCol ? [String(sx++)] : [], [""]))));
      if (all.length) signWidths = fitWidths(signHeads, all, { measure: o.measure, colStyle, sigBoost: o.sigBoost, widthPt: signWidthPt });
    }
    arrange(list, o).forEach(({ base: gk, sex: gSex, rows }) => {
      const seat = seatNext; seatNext += rows.length;
      const chunks = []; for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
      chunks.forEach((chunk, ci) => {
        if (sheets.length > 0) blocks.push({ kind: "pagebreak" });
        const meta = { kind: "pagenum", text: "" };   // رقم الورقة: أسفل الصفحة في الوسط، يُضاف بعد الجدول
        sheets.push({ meta, k: ci + 1, gTotal: chunks.length });
        blocks.push({ kind: "title", text: clean(ann ? o.announcerTitle : o.title) });
        // اسم المسار في الوسط تحت العنوان؛ وعند التقسيم بالمجموعة يُذكر اسمها (بلا اسم المدرب) تحته
        const trackName = o.split === "track" ? (gk !== "—" ? gk : "") : clean(chunk[0] && chunk[0].track);
        if (trackName) blocks.push({ kind: "title", text: trackName, sizePt: 13 });
        if (o.split === "group" && gk && gk !== "—") blocks.push({ kind: "title", text: "المجموعة: " + gk, sizePt: 12 });
        if (o.genderSplit && gSex) blocks.push({ kind: "title", text: SEX_TITLE[gSex] || gSex, sizePt: 12 });
        if (!ann && (ci === 0 || o.repeatPreamble)) blocks.push({ kind: "para", text: clean(o.preamble) });
        blocks.push(ann ? {
          kind: "table", headers: A_HEADERS, widths: A_WIDTHS, align: A_ALIGN, rowHeightTw: Math.round((Number(o.announcerSizePt) || 14) * 30), sizePt: Number(o.announcerSizePt) || 14,
          rows: chunk.map((s, i) => [String(ci * perPage + i + 1), clean(s.name), clean(s.stage)]),
        } : {
          kind: "table", headers: signHeads, widths: signWidths, align: chairCol ? C_ALIGN : ALIGN, rowHeightTw: 480, colStyle, widthPt: signWidthPt || undefined,
          rows: chunk.map((s, i) => [String(ci * perPage + i + 1), clean(s.name), clean(s.id), clean(s.stage)].concat(chairCol ? [String(seat + ci * perPage + i)] : [], [""])),
        });
        blocks.push(meta);
      });
    });

    const total = sheets.length, fixed = clean(o.prefix);
    sheets.forEach((sh, i) => {
      const g = i + 1;
      sh.meta.text = o.prefixMode === "count" ? (sh.gTotal > 1 ? `(${sh.gTotal}-${sh.k})` : "")
        : o.prefixMode === "all" ? (total > 1 ? `(${total}-${g})` : "")
        : o.prefixMode === "fixed" ? (fixed ? (total > 1 ? `(${fixed}-${g})` : `(${fixed})`) : (total > 1 ? `(${g})` : ""))
        : (total > 1 ? `(${g})` : "");
    });
    return { blocks, pages: total, students: list.length, bySex };
  }

  /* أوراق الطلاب ← استخراج المرحلة من نص الدورة/المجموعة */
  /* أرقام الكراسي للاحتفال: بترتيب الكشوف نفسه، متسلسلة من start. يعيد [{ n, name, track, sex }] */
  function chairs(students, options, start) {
    let n = Math.max(1, Math.round(Number(start)) || 1);
    const out = [];
    arrange(students, options).forEach((g) => g.rows.forEach((s) => out.push({ n: n++, name: clean(s.name), id: clean(s.id), group: clean(s.group), stage: clean(s.stage), track: g.base && g.base !== "—" ? g.base : clean(s.track), sex: g.sex || (s.gender ? sexOf(s.gender) : "") })));
    return out;
  }
  App.pledgeSheet = { DEFAULTS, HEADERS, C_HEADERS, build, sexOf, arrange, chairs };
})(window.App = window.App || {});
