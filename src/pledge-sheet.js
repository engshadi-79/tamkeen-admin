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
  };
  /* «ذكر/أنثى» بأي صيغة ← ذكور / إناث / غير محدد */
  const SEX_ORDER = ["ذكور", "إناث", "غير محدد"];
  const sexOf = (g) => { const t = clean(g).replace(/[أإآ]/g, "ا"); return /^(ذكر|ذكور|male|m)$/i.test(t) ? "ذكور" : /^(انثى|انثي|اناث|female|f)$/i.test(t) ? "إناث" : "غير محدد"; };
  const SEX_TITLE = { "ذكور": "كشف الذكور", "إناث": "كشف الإناث", "غير محدد": "جنس غير محدد" };

  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const HEADERS = ["م", "الاسم", "رقم الهوية", "المرحلة", "التوقيع"];
  const WIDTHS = [0.07, 0.38, 0.17, 0.15, 0.23];
  const ALIGN = ["center", "left", "center", "center", "center"];
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
  function build(students, options, mode) {
    const ann = mode === "announcer";
    const o = Object.assign({}, DEFAULTS, options || {});
    const perPage = Math.max(5, Math.min(40, Math.round(Number(o.perPage)) || DEFAULTS.perPage));
    const list = students.filter((s) => clean(s.name));
    const groups = new Map();
    const keyOf0 = o.split === "group" ? (s) => clean(s.group) || "—" : o.split === "none" ? () => "" : (s) => clean(s.track) || "—";
    const SEP = "\u0001", keyOf = o.genderSplit ? (s) => keyOf0(s) + SEP + sexOf(s.gender) : keyOf0;
    list.forEach((s) => { const k = keyOf(s); (groups.get(k) || groups.set(k, []).get(k)).push(s); });
    const keys = [...groups.keys()].sort((a, b) => { const [ab, as] = a.split(SEP), [bb, bs] = b.split(SEP); return ab.localeCompare(bb, "ar", { numeric: true }) || SEX_ORDER.indexOf(as) - SEX_ORDER.indexOf(bs); });
    const blocks = [], sheets = [];   // sheets: لكل ورقة { meta, k (داخل مجموعتها), gTotal }
    const bySex = {}; if (o.genderSplit) list.forEach((s) => { const x = sexOf(s.gender); bySex[x] = (bySex[x] || 0) + 1; });

    keys.forEach((gkFull) => {
      const [gk, gSex] = gkFull.split(SEP);
      const rows = groups.get(gkFull).slice().sort(byName);
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
          kind: "table", headers: HEADERS, widths: WIDTHS, align: ALIGN, rowHeightTw: 480,
          rows: chunk.map((s, i) => [String(ci * perPage + i + 1), clean(s.name), clean(s.id), clean(s.stage), ""]),
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
  App.pledgeSheet = { DEFAULTS, HEADERS, build, sexOf };
})(window.App = window.App || {});
