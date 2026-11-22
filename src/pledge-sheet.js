/* كشف تعهّد استلام الحقيبة التدريبية: ديباجة ثم جدول (م، الاسم، رقم الهوية، المرحلة، التوقيع) على الترويسة الرسمية.
   هذا الملف يبني «كتل المستند» فقط (نفس صيغة المراسلات والتقارير)، فيُطبع أو يُصدَّر Word بمحرّك المستندات المشترك.
   لا يعرف مصدر الطلاب ولا الواجهة. */
(function (App) {
  const DEFAULTS = {
    title: "تعهد استلام الحقيبة التدريبية",
    preamble: "أقرّ أنا المتدرب/ـة الموقِّع/ـة أدناه بأنني استلمتُ الحقيبة التدريبية الخاصة بي كاملةً وبحالة سليمة، وأتعهّد باستعمالها في التدريب فقط، وبعدم بيعها أو التنازل عنها أو التصرف فيها بأي صورة لأي جهة أو شخص، وأتحمّل كامل المسؤولية عن مخالفة ذلك.",
    prefixMode: "count",     // count: (عدد أوراق المجموعة-الرقم) | all: (عدد كل الأوراق-الرقم) | fixed: رقم يكتبه المستخدم | none: (الرقم) فقط
    prefix: "1",
    perPage: 12,    // معايرة الطباعة على الترويسة: 13 صفاً تتّسع و14 لا؛ 12 هامش أمان للديباجة الأطول
    repeatPreamble: true,    // الديباجة في أعلى كل ورقة (لتكون كل ورقة موقَّعة مكتملة)
    byGroup: true,           // ورقة (أو أكثر) مستقلة لكل مجموعة
  };

  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const HEADERS = ["م", "الاسم", "رقم الهوية", "المرحلة", "التوقيع"];
  const WIDTHS = [0.07, 0.38, 0.17, 0.15, 0.23];
  const ALIGN = ["center", "left", "center", "center", "center"];

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
  function build(students, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const perPage = Math.max(5, Math.min(40, Math.round(Number(o.perPage)) || DEFAULTS.perPage));
    const list = students.filter((s) => clean(s.name));
    const groups = new Map();
    if (o.byGroup) list.forEach((s) => { const k = clean(s.group) || "—"; (groups.get(k) || groups.set(k, []).get(k)).push(s); });
    else groups.set("", list.slice());
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "ar", { numeric: true }));
    const blocks = [], sheets = [];   // sheets: لكل ورقة { meta, k (داخل مجموعتها), gTotal }

    keys.forEach((gk) => {
      const rows = groups.get(gk).slice().sort(byName);
      const chunks = []; for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
      chunks.forEach((chunk, ci) => {
        if (sheets.length > 0) blocks.push({ kind: "pagebreak" });
        const meta = { kind: "meta", text: "" };
        blocks.push(meta);
        sheets.push({ meta, k: ci + 1, gTotal: chunks.length });
        blocks.push({ kind: "title", text: clean(o.title) });
        const info = [chunk[0] && chunk[0].course ? clean(chunk[0].course) : "", o.byGroup && gk && gk !== "—" ? "المجموعة: " + gk : ""].filter(Boolean).join(" — ");
        if (info) blocks.push({ kind: "bold", text: info });
        if (ci === 0 || o.repeatPreamble) blocks.push({ kind: "para", text: clean(o.preamble) });
        blocks.push({
          kind: "table", headers: HEADERS, widths: WIDTHS, align: ALIGN, rowHeightTw: 480,
          rows: chunk.map((s, i) => [String(ci * perPage + i + 1), clean(s.name), clean(s.id), clean(s.stage), ""]),
        });
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
    return { blocks, pages: total, students: list.length };
  }

  /* أوراق الطلاب ← استخراج المرحلة من نص الدورة/المجموعة */
  App.pledgeSheet = { DEFAULTS, HEADERS, build };
})(window.App = window.App || {});
