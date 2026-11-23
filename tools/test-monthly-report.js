/* اختبار بناء التقرير الشهري الموحّد (بلا متصفح):  node tools/test-monthly-report.js */
globalThis.window = globalThis;
require("../src/monthly-report.js");
const M = globalThis.App.monthlyReport;
let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };
const flagged = (k) => Array.from({ length: k }, (_, i) => ({ name: "طالب " + (i + 1), group: "G1", absent: 4 + (i % 3), streak: 3 }));
const D = {
  month: "2026-11", from: "2026-11-01", to: "2026-11-22", scope: "المرحلة الثالثة", thr: 3, generated: "2026-11-22", forms: 2,
  sources: { att: true, mis: true, sig: true },
  tracks: [
    { name: "الحلاقة الرجالية", att: { students: 30, sessions: 12, absent: 41, excused: 3, late: 5, flagged: flagged(2) }, mis: { count: 5, by: { "قبلي": 3, "بعدي": 2 }, rows: [{ name: "سامي", group: "G2", items: "قبلي، بعدي" }] }, sig: { total: 30, lacking: [{ name: "خالد", group: "G1", forms: "كشف حضور" }] } },
    { name: "التطريز والخياطة", att: { students: 25, sessions: 10, absent: 12, excused: 0, late: 1, flagged: [] }, mis: { count: 0, by: {}, rows: [] }, sig: { total: 25, lacking: [] } },
  ],
};
const r = M.build(D);
const kinds = r.blocks.map((b) => b.kind);
ok("العنوان بالشهر بالعربية", r.blocks[0].kind === "title" && r.blocks[0].text === "التقرير الشهري — نوفمبر 2026", r.blocks[0]);
ok("ملخص المسارات: جدول بصف لكل مسار وصف إجمالي", (() => { const t = r.blocks.find((b) => b.kind === "table"); return t.rows.length === 3 && t.rows[2][0] === "الإجمالي" && t.rows[2][1] === "55" && t.rows[2][3] === "53"; })(), r.blocks.find((b) => b.kind === "table").rows);
ok("ترتيب المسارات أبجدياً (التطريز قبل الحلاقة)", r.blocks.find((b) => b.kind === "table").rows[0][0] === "التطريز والخياطة");
ok("صفحة لكل مسار: فاصل صفحة وعنوان المسار", kinds.filter((k) => k === "pagebreak").length === 2 && r.blocks.filter((b) => b.kind === "title" && b.sizePt === 16).map((b) => b.text).join() === "التطريز والخياطة,الحلاقة الرجالية", kinds);
ok("جداول التفصيل للمسار الذي فيه نواقص فقط", r.blocks.filter((b) => b.kind === "table").length === 1 + 3, r.blocks.filter((b) => b.kind === "table").length);
ok("سطر المسار: الحضور والاستبيانات والتوقيعات بالأرقام", r.blocks.some((b) => b.kind === "para" && /41/.test(b.text) && /وبعذر 3/.test(b.text)) && r.blocks.some((b) => b.kind === "para" && /قبلي 3، بعدي 2/.test(b.text)) && r.blocks.some((b) => b.kind === "para" && /ينقصهم توقيع/.test(b.text)));
// تقطيع الجداول الطويلة
const long = M.build(Object.assign({}, D, { tracks: [Object.assign({}, D.tracks[0], { att: Object.assign({}, D.tracks[0].att, { flagged: flagged(60) }) })] }));
ok("الجدول التفصيلي الطويل يُقتطع عند 40 مع ذكر الباقي", long.blocks.filter((b) => b.kind === "table")[1].rows.length === 40 && long.blocks.some((b) => b.kind === "para" && /وغيرهم 20/.test(b.text)), long.blocks.filter((b) => b.kind === "table")[1].rows.length);
// مصادر مستبعدة
const only = M.build(Object.assign({}, D, { sources: { att: true } }));
ok("بدون استبيانات وتوقيعات: أعمدة الملخص للحضور فقط", only.blocks.find((b) => b.kind === "table").headers.join("|") === "المسار|الطلاب|الجلسات|الغياب|منذَرون", only.blocks.find((b) => b.kind === "table").headers);
ok("بدون التوقيعات: لا قسم توقيع في المسارات", !only.blocks.some((b) => b.kind === "bold" && /التوقيع/.test(b.text)));
// Excel
const sh = M.sheets(D);
ok("Excel: ملخص ثم المنذَرون ثم ناقصو التقييمات ثم ناقصو التوقيع", sh.map((x) => x.name).join() === "ملخص المسارات,المنذَرون بالغياب,ناقصو التقييمات,ناقصو التوقيع", sh.map((x) => x.name));
ok("Excel: كل المنذَرين بلا حدّ للصفوف", M.sheets(Object.assign({}, D, { tracks: [Object.assign({}, D.tracks[0], { att: Object.assign({}, D.tracks[0].att, { flagged: flagged(60) }) })] })).find((x) => x.name === "المنذَرون بالغياب").rows.length === 60);
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
