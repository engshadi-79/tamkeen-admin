/* اختبار بناء كشف تعهد استلام الحقيبة (بلا متصفح):  node tools/test-pledge-sheet.js */
globalThis.window = globalThis;
require("../src/pledge-sheet.js");
const P = globalThis.App.pledgeSheet;
let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };
const mk = (k, g) => Array.from({ length: k }, (_, i) => ({ name: "طالب " + String(i + 1).padStart(2, "0"), id: "10" + String(i).padStart(8, "0"), stage: "المرحلة الأولى", group: g || "S3G1", course: "مسار الحلاقة" }));
const metas = (r) => r.blocks.filter((b) => b.kind === "meta").map((b) => b.text).join();

// الافتراضي «حسب عدد الأوراق»: 5 أوراق ← (5-1) … (5-5)
let r = P.build(mk(50), { perPage: 10 });
ok("5 أوراق: (5-1) إلى (5-5)", r.pages === 5 && metas(r) === "(5-1),(5-2),(5-3),(5-4),(5-5)", metas(r));
r = P.build(mk(20), { perPage: 15 });
ok("ورقتان: (2-1) ثم (2-2)", r.pages === 2 && metas(r) === "(2-1),(2-2)", metas(r));
r = P.build(mk(8), { perPage: 15 });
ok("ورقة وحيدة: بلا رقم", r.pages === 1 && metas(r) === "", metas(r));
ok("فاصل صفحة بين الورقتين", P.build(mk(20), { perPage: 15 }).blocks.filter((b) => b.kind === "pagebreak").length === 1);
// مجموعتان: عدّاد كل مجموعة مستقل
r = P.build([...mk(25, "S3G1"), ...mk(4, "S3G2")], { perPage: 10, split: "group" });
ok("مجموعتان: (3-1) (3-2) (3-3) ثم ورقة المجموعة الثانية الوحيدة بلا رقم", metas(r) === "(3-1),(3-2),(3-3),", metas(r));
r = P.build([...mk(25, "S3G1"), ...mk(14, "S3G2")], { perPage: 10, split: "group" });
ok("مجموعتان متعددتا الأوراق: (3-1) (3-2) (3-3) (2-1) (2-2)", metas(r) === "(3-1),(3-2),(3-3),(2-1),(2-2)", metas(r));
// «كل الأوراق»
r = P.build([...mk(25, "S3G1"), ...mk(14, "S3G2")], { perPage: 10, prefixMode: "all", split: "group" });
ok("حسب كل الأوراق: (5-1) … (5-5)", metas(r) === "(5-1),(5-2),(5-3),(5-4),(5-5)", metas(r));
// رقم ثابت
r = P.build(mk(20), { perPage: 10, prefixMode: "fixed", prefix: "7" });
ok("رقم ثابت: (7-1) (7-2)", metas(r) === "(7-1),(7-2)", metas(r));
r = P.build(mk(5), { prefixMode: "fixed", prefix: "7" });
ok("رقم ثابت وورقة وحيدة: (7)", metas(r) === "(7)", metas(r));
// بلا بادئة
r = P.build(mk(30, ""), { prefixMode: "none", split: "none", perPage: 10 });
ok("تسلسل فقط: (1) (2) (3)", metas(r) === "(1),(2),(3)", metas(r));
// الجدول
r = P.build(mk(20), { perPage: 15 });
const tables = r.blocks.filter((b) => b.kind === "table");
ok("رؤوس الجدول", tables[0].headers.join("|") === "م|الاسم|رقم الهوية|المرحلة|التوقيع", tables[0].headers);
ok("عدد الصفوف 15 ثم 5 وترقيم م متصل", tables[0].rows.length === 15 && tables[1].rows.length === 5 && tables[1].rows[0][0] === "16", [tables[0].rows.length, tables[1].rows[0]]);
ok("خانة التوقيع فارغة وارتفاع الصف مضبوط", tables[0].rows.every((x) => x[4] === "") && tables[0].rowHeightTw > 300);
ok("الديباجة في كل ورقة افتراضياً", r.blocks.filter((b) => b.kind === "para").length === 2);
r = P.build(mk(20), { perPage: 15, repeatPreamble: false });
ok("الديباجة في الأولى فقط عند الإلغاء", r.blocks.filter((b) => b.kind === "para").length === 1);
r = P.build([{ name: "ياسمين" }, { name: "أحمد" }, { name: "الجوهرة" }, { name: "إسراء" }, { name: "بشرى" }], {});
ok("الأسماء مرتبة أبجدياً", r.blocks.find((b) => b.kind === "table").rows.map((x) => x[1]).join() === "أحمد,إسراء,بشرى,الجوهرة,ياسمين", r.blocks.find((b) => b.kind === "table").rows.map((x) => x[1]));
ok("أسماء فارغة تُهمَل", P.build([{ name: "" }, { name: "  " }, { name: "س" }], {}).students === 1);

// التقسيم بالمسار: طلاب مسار واحد من مراحل ومجموعات مختلفة معاً، واسم المسار في الوسط
const mt = (k, track, stage, g) => Array.from({ length: k }, (_, i) => ({ name: track + " " + stage + " " + (i + 1), id: "1" + i, stage, group: g, track }));
r = P.build([...mt(6, "مسار الحلاقة", "المرحلة الأولى", "الاولى"), ...mt(6, "مسار الحلاقة", "المرحلة الثانية", "الثانية"), ...mt(5, "مسار التطريز", "المرحلة الأولى", "الاولى")], { perPage: 20 });
const trTitles = r.blocks.filter((b) => b.kind === "title" && /^مسار/.test(b.text)).map((b) => b.text);
ok("ورقة لكل مسار (مسارا حلاقة وتطريز) والمراحل معاً", r.pages === 2 && trTitles.join() === "مسار التطريز,مسار الحلاقة" && r.blocks.filter((b) => b.kind === "table")[1].rows.length === 12, { p: r.pages, trTitles });
ok("اسم المسار في الوسط: كتلة title وليست bold", r.blocks.some((b) => b.kind === "title" && b.text === "مسار الحلاقة") && !r.blocks.some((b) => b.kind === "bold"));
ok("المرحلة في عمودها لكل طالب (أولى وثانية في الجدول نفسه)", new Set(r.blocks.filter((b) => b.kind === "table")[1].rows.map((x) => x[3])).size === 2);
ok("لا اسم مجموعة في ورقة المسار", !r.blocks.some((b) => /^المجموعة/.test(b.text || "")));
r = P.build(mt(4, "مسار الحلاقة", "المرحلة الأولى", "الاولى"), { split: "group" });
ok("التقسيم بالمجموعة: المسار في الوسط ثم «المجموعة: الاولى» بلا مدرب", r.blocks.filter((b) => b.kind === "title").map((b) => b.text).join("|").includes("مسار الحلاقة|المجموعة: الاولى"), r.blocks.filter((b) => b.kind === "title").map((b) => b.text));
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
