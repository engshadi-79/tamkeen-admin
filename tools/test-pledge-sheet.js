/* اختبار بناء كشف تعهد استلام الحقيبة (بلا متصفح):  node tools/test-pledge-sheet.js */
globalThis.window = globalThis;
require("../src/pledge-sheet.js");
const P = globalThis.App.pledgeSheet;
let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };
const mk = (k, g) => Array.from({ length: k }, (_, i) => ({ name: "طالب " + String(i + 1).padStart(2, "0"), id: "10" + String(i).padStart(8, "0"), stage: "المرحلة الأولى", group: g || "S3G1", course: "مسار الحلاقة" }));
const metas = (r) => r.blocks.filter((b) => b.kind === "pagenum").map((b) => b.text).join();

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
ok("رؤوس الجدول (افتراضياً مع «رقم الكرسي» قبل التوقيع)", tables[0].headers.join("|") === "م|الاسم|رقم الهوية|المرحلة|الكرسي|التوقيع", tables[0].headers);
ok("عدد الصفوف 15 ثم 5 وترقيم م متصل", tables[0].rows.length === 15 && tables[1].rows.length === 5 && tables[1].rows[0][0] === "16", [tables[0].rows.length, tables[1].rows[0]]);
ok("خانة التوقيع (الأخيرة) فارغة وارتفاع الصف مضبوط", tables[0].rows.every((x) => x[x.length - 1] === "") && tables[0].rowHeightTw > 300);
ok("رقم الكرسي متصل عبر الأوراق: 1..15 ثم 16..20", tables[0].rows.map((x) => x[4]).join() === Array.from({ length: 15 }, (_, i) => i + 1).join() && tables[1].rows.map((x) => x[4]).join() === "16,17,18,19,20", [tables[0].rows[0][4], tables[1].rows[0][4]]);
const r5 = P.build(mk(3), { chairCol: false }).blocks.find((b) => b.kind === "table");
ok("بإيقاف «رقم الكرسي» يعود الجدول خمسة أعمدة", r5.headers.join("|") === "م|الاسم|رقم الهوية|المرحلة|التوقيع" && r5.rows[0].length === 5, r5.headers);
const rs = P.build(mk(3), { chairStart: 101 }).blocks.find((b) => b.kind === "table");
ok("رقم الكرسي يبدأ من «ابدأ الترقيم من» (101)", rs.rows.map((x) => x[4]).join() === "101,102,103", rs.rows.map((x) => x[4]));
{   // عرض الأعمدة حسب النص، والتوقيع يأخذ الباقي
  const meas = (t) => String(t || "").length * 4;   // 4 نقاط للحرف (قياس ثابت للاختبار)
  const stu = [{ name: "اسلام اسماعيل عودة بدوان", id: "801850660", stage: "المرحلة الثانية", track: "ت" }, { name: "اخلاص حسين", id: "803540020", stage: "المرحلة الأولى", track: "ت" }];
  const tb = P.build(stu, { measure: meas }).blocks.find((b) => b.kind === "table"), W = tb.widths.map((x) => Math.round(x * tb.widthPt));
  const old = 468 - ((1 * 4 + 24) + (24 * 4 + 24) + (10 * 4 + 24) + (15 * 4 + 24) + (6 * 4 + 24));   // التوقيع قبل الزيادة = باقي منطقة النص
  ok("الجدول يمتد 36 نقطة في الهامش الأيسر (504)", tb.widthPt === 504, tb.widthPt);
  ok("التوقيع أعرض بنسبة 30% (" + old + " ← " + Math.round(old * 1.3) + ")", W[5] === Math.round(old * 1.3), W);
  ok("الاسم والهوية والمرحلة والكرسي بعرض نصّها كما هي (لا مساس)", W[1] === 24 * 4 + 24 && W[2] === 10 * 4 + 24 && W[3] === 15 * 4 + 24 && W[4] === 6 * 4 + 24, W);
  ok("المجموع = عرض الجدول", Math.abs(tb.widths.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const plain = P.build(stu, { measure: meas, sigBoost: 1, signExtend: 0 }).blocks.find((b) => b.kind === "table");
  ok("بلا امتداد ولا زيادة: التوقيع = الباقي فقط", Math.round(plain.widths[5] * plain.widthPt) === old, plain.widths.map((x) => Math.round(x * plain.widthPt)));
  const tight = P.build(stu, { measure: meas, signExtend: 0 }).blocks.find((b) => b.kind === "table").widths.map((x) => Math.round(x * 468));
  ok("بلا امتداد: الزيادة من هوامش الأمان ثم الاسم وحده، والتوقيع 30% أعرض", tight[5] === Math.round(old * 1.3) && tight[2] === 10 * 4 + 20 && tight[1] < 24 * 4 + 24, tight);
  ok("رقم الكرسي غامق بحجم 16", tb.colStyle && tb.colStyle[4].bold === true && tb.colStyle[4].sizePt === 16 && !tb.colStyle[1]);
  const longN = P.build([{ name: "اسم طويل جداً جداً جداً جداً جداً جداً جداً جداً جداً جداً جداً جداً", id: "1", stage: "م", track: "ت" }], { measure: meas }).blocks.find((b) => b.kind === "table");
  ok("أسماء طويلة جداً: التوقيع لا يقل عن 15% والاسم وحده يلتفّ", longN.widths[5] >= 0.15 - 1e-9 && Math.abs(longN.widths.reduce((a, b) => a + b, 0) - 1) < 1e-9, longN.widths.map((x) => x.toFixed(2)));
  const fixedW = P.build(stu, { measure: meas, fitCols: false }).blocks.find((b) => b.kind === "table").widths;
  ok("fitCols:false يعيد العرض الثابت", fixedW.join() === [0.05, 0.38, 0.15, 0.15, 0.07, 0.20].join(), fixedW);
  ok("كل أوراق الكشف بالعرض نفسه", (() => { const ts = P.build(mk(30), { perPage: 10, measure: meas }).blocks.filter((b) => b.kind === "table"); return ts.every((t) => t.widths.join() === ts[0].widths.join()); })());
}
const wsum = P.build(mk(2)).blocks.find((b) => b.kind === "table").widths.reduce((a, b) => a + b, 0);
ok("عرض الأعمدة الستة = 100%", Math.abs(wsum - 1) < 0.001, wsum);
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
// الديباجة المعتمدة
ok("الديباجة المعتمدة: استعمال الحقيبة في المشروع الخاص وعدم البيع", /في مشروعي الخاص/.test(P.DEFAULTS.preamble) && /بعدم بيعها/.test(P.DEFAULTS.preamble) && !/في التدريب فقط/.test(P.DEFAULTS.preamble), P.DEFAULTS.preamble);
// نسخة المذيع: الترتيب نفسه، وجدول (م، الاسم، المرحلة) بلا ديباجة ولا توقيع
const ST = [...mt(5, "مسار الحلاقة", "المرحلة الأولى", "الاولى"), ...mt(4, "مسار الحلاقة", "المرحلة الثانية", "الثانية"), ...mt(3, "مسار التطريز", "المرحلة الأولى", "الاولى")];
const sign = P.build(ST, { perPage: 20 }), ann = P.build(ST, { perPage: 20 }, "announcer");
const at = ann.blocks.filter((b) => b.kind === "table"), stb = sign.blocks.filter((b) => b.kind === "table");
ok("المذيع: رؤوس الجدول م|الاسم|المرحلة", at[0].headers.join("|") === "م|الاسم|المرحلة", at[0].headers);
ok("المذيع: بلا ديباجة ولا عمود توقيع أو هوية", !ann.blocks.some((b) => b.kind === "para") && at.every((t) => t.rows.every((r) => r.length === 3)));
ok("المذيع: الأسماء والمراحل بالترتيب نفسه وبترقيم م نفسه", at.length === stb.length && at.every((t, k) => t.rows.every((r, j) => r[0] === stb[k].rows[j][0] && r[1] === stb[k].rows[j][1] && r[2] === stb[k].rows[j][3])), at.map((t) => t.rows.length));
ok("المذيع: اسم المسار في الوسط وعنوان النسخة", ann.blocks.filter((b) => b.kind === "title").map((b) => b.text).join("|").includes("كشف أسماء الخريجين") && ann.blocks.some((b) => b.kind === "title" && b.text === "مسار الحلاقة"));
ok("المذيع: خط أكبر في الجدول", at[0].sizePt >= 14);
const ann2 = P.build(mk(30), { perPage: 10 }, "announcer");
ok("المذيع: ترقيم الأوراق نفسه (3-1) (3-2) (3-3)", ann2.blocks.filter((b) => b.kind === "pagenum").map((b) => b.text).join() === "(3-1),(3-2),(3-3)", ann2.blocks.filter((b) => b.kind === "pagenum").map((b) => b.text));
// رقم الورقة أسفل الصفحة: كتلة pagenum بعد الجدول، لا في أعلاها
const pn = P.build(mk(20), { perPage: 10 }).blocks;
const kinds = pn.map((b) => b.kind);
ok("رقم الورقة بعد الجدول لا قبله", kinds.indexOf("pagenum") > kinds.indexOf("table") && !kinds.includes("meta"), kinds);
ok("كل ورقة لها كتلة رقم واحدة (2)", kinds.filter((k) => k === "pagenum").length === 2, kinds);
// خط المذيع قابل للتصغير ويتبعه ارتفاع الصف
const small = P.build(mk(5), { announcerSizePt: 12 }, "announcer").blocks.find((b) => b.kind === "table");
ok("خط المذيع 12 ← ارتفاع صف أصغر", small.sizePt === 12 && small.rowHeightTw === 360, [small.sizePt, small.rowHeightTw]);
// كشف للذكور وكشف للإناث في كل مسار
{
  const S = (name, track, gender) => ({ name, id: "1", stage: "المرحلة الأولى", group: "G1", track, gender });
  const st = [S("أحمد", "الحلاقة", "ذكر"), S("سارة", "الحلاقة", "أنثى"), S("خالد", "الحلاقة", "ذكر"), S("منى", "التجميل", "انثى"), S("ريم", "التجميل", "female"), S("مجهول", "التجميل", "")];
  const g = P.build(st, { perPage: 10, genderSplit: true });
  const titles = g.blocks.filter((b) => b.kind === "title" && b.sizePt === 12).map((b) => b.text);
  const tracks = g.blocks.filter((b) => b.kind === "title" && b.sizePt === 13).map((b) => b.text);
  ok("4 أوراق: التجميل (إناث، غير محدد) والحلاقة (ذكور، إناث)", g.pages === 4, g.pages);
  ok("ترتيب الأوراق: المسارات أبجدياً، وفي كل مسار الذكور ثم الإناث ثم غير المحدد", titles.join() === "كشف الإناث,جنس غير محدد,كشف الذكور,كشف الإناث" && tracks.join() === "التجميل,التجميل,الحلاقة,الحلاقة", { titles, tracks });
  const tables = g.blocks.filter((b) => b.kind === "table").map((t) => t.rows.map((r) => r[1]).join("،"));
  ok("كل ورقة فيها جنس واحد فقط", JSON.stringify(tables) === JSON.stringify(["ريم،منى", "مجهول", "أحمد،خالد", "سارة"]), tables);
  ok("عدّ الجنسين: ذكور 2، إناث 3، غير محدد 1", g.bySex["ذكور"] === 2 && g.bySex["إناث"] === 3 && g.bySex["غير محدد"] === 1, g.bySex);
  const many = P.build([...Array.from({ length: 12 }, (_, i) => S("ذ" + i, "الحلاقة", "ذكر")), ...Array.from({ length: 4 }, (_, i) => S("ث" + i, "الحلاقة", "أنثى"))], { perPage: 10, genderSplit: true });
  ok("الترقيم مستقل لكل جنس: (2-1) (2-2) للذكور وورقة الإناث الوحيدة بلا رقم", metas(many) === "(2-1),(2-2),", metas(many));
  ok("بلا genderSplit لا يتغيّر شيء", P.build(st, { perPage: 10 }).pages === 2);
  const ann = P.build(st, { perPage: 10, genderSplit: true }, "announcer");
  const annSubs = ann.blocks.filter((b) => b.kind === "title" && b.sizePt === 12).map((b) => b.text);
  const annRows = ann.blocks.filter((b) => b.kind === "table").map((t) => t.rows.map((r) => r[1]).join("،"));
  ok("نسخة المذيع مقسّمة ذكوراً وإناثاً بالترتيب نفسه لكشف التوقيع", ann.pages === g.pages && annSubs.join() === titles.join() && JSON.stringify(annRows) === JSON.stringify(tables), { annSubs, annRows });
  ok("نسخة المذيع بجدول (م، الاسم، المرحلة)", ann.blocks.filter((b) => b.kind === "table").every((t) => t.headers.join() === "م,الاسم,المرحلة"));
  // أرقام الكراسي: بترتيب الكشوف نفسه، متسلسلة
  const ch = P.chairs(st, { genderSplit: true }, 1);
  ok("أرقام الكراسي بترتيب الكشوف (التجميل إناث، غير محدد، ثم الحلاقة ذكور، إناث) ومتسلسلة 1..6", ch.map((x) => x.n + ":" + x.name).join() === "1:ريم,2:منى,3:مجهول,4:أحمد,5:خالد,6:سارة", ch.map((x) => x.n + ":" + x.name).join());
  ok("كل رقم يحمل مساره وجنسه", ch[0].track === "التجميل" && ch[0].sex === "إناث" && ch[3].track === "الحلاقة" && ch[3].sex === "ذكور", ch[0]);
  {   // التطابق: رقم الكرسي في كشف التوقيع = رقم بطاقة الطالب نفسه (مع الفصل بالجنس وعدة مسارات وأوراق)
    const big = [...Array.from({ length: 14 }, (_, i) => S("ذكر" + i, "الحلاقة", "ذكر")), ...Array.from({ length: 9 }, (_, i) => S("أنثى" + i, "الحلاقة", "أنثى")), ...Array.from({ length: 7 }, (_, i) => S("تجميل" + i, "التجميل", "أنثى"))];
    const opt = { perPage: 6, genderSplit: true, chairStart: 51 };
    const fromSheet = P.build(big, opt).blocks.filter((b) => b.kind === "table").flatMap((t) => t.rows.map((r) => r[1] + "=" + r[4]));
    const fromCards = P.chairs(big, opt, opt.chairStart).map((x) => x.name + "=" + x.n);
    ok("رقم الكرسي في الكشف يطابق بطاقة كل طالب (30 طالباً، عدة أوراق، فصل بالجنس، يبدأ من 51)", fromSheet.join() === fromCards.join() && fromSheet.length === 30, { s: fromSheet.slice(0, 4), c: fromCards.slice(0, 4) });
  }
  ok("بدء الترقيم من 101", P.chairs(st, {}, 101).map((x) => x.n).join() === "101,102,103,104,105,106");
  ok("بلا فصل بالجنس: الترتيب = ترتيب الكشف العادي", P.chairs(st, {}, 1).map((x) => x.name).join() === P.build(st, { perPage: 40 }).blocks.filter((b) => b.kind === "table").flatMap((t) => t.rows.map((r) => r[1])).join());
  ok("sexOf يفهم الصيغ", P.sexOf("أنثى") === "إناث" && P.sexOf("انثى") === "إناث" && P.sexOf("ذكر") === "ذكور" && P.sexOf("Male") === "ذكور" && P.sexOf("") === "غير محدد");
}
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
