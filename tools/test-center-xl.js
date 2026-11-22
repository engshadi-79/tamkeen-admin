/* اختبار مقارنة الملف الخارجي (بلا متصفح):  node tools/test-center-xl.js */
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require("../src/center-util.js"); require("../src/center-xl.js");
const X = globalThis.App.centerXl; let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };

const grid = [["كشف متدربي الدورة"], [], ["م", "اسم المتدرب", "رقم الهوية", "الجوال", "المجموعة"],
  ["1", "أحمد علي محمد", "1012345678", "0501112222", "G1"], ["2", "ليلى حسن", "1099999999", "0503334444", "G1"], ["3", "سامي عمر", "1055555555", "0509998888", "G2"], ["4", "نورة خالد", "1066666666", "0507776666", "G2"]];
const sp = X.splitHeader(grid);
ok("صف الرؤوس يُكتشف رغم العنوان العلوي", sp.heads[1] === "اسم المتدرب" && sp.rows.length === 4, sp.heads);
const mp = X.detect(sp.heads, sp.rows);
ok("الأعمدة بالرؤوس", mp.name === 1 && mp.id === 2 && mp.phone === 3 && mp.group === 4, mp);
const mp2 = X.detect(["a", "b", "c"], [["أحمد علي محمد", "1012345678", "0501112222"], ["ليلى حسن علي", "1099999999", "0503334444"], ["سامي عمر خالد", "1055555555", "0509998888"], ["نورة خالد سعد", "1066666666", "0507776666"]]);
ok("الأعمدة بالقيم حين لا رؤوس مفهومة", mp2.name === 0 && mp2.id === 1 && mp2.phone === 2, mp2);

const reg = [
  { key: "1", name: "أحمد علي محمد", id: "1012345678", phone: "0501112222" },
  { key: "2", name: "ليلى حسن", id: "1099999999", phone: "0500000000" },     // جوال مختلف
  { key: "3", name: "سامر عمرو", id: "1055555555", phone: "0509998888" },     // اسم مختلف قليلاً، هوية تطابق
  { key: "9", name: "فهد منصور", id: "1088888888", phone: "0505555555" },     // ليس في الملف
];
const r = X.compare(reg, sp, mp);
ok("المطابقون ثلاثة", r.matched.length === 3, r.matched.length);
ok("ناقص في النظام: نورة", r.missingInSystem.length === 1 && r.missingInSystem[0].name === "نورة خالد", r.missingInSystem);
ok("غير موجود في الملف: فهد", r.notInFile.length === 1 && r.notInFile[0].name === "فهد منصور", r.notInFile);
const dl = r.diffs.find((d) => d.reg.key === "2");
ok("فرق الجوال يُرصد", dl && dl.why.includes("الجوال") && !dl.why.includes("الهوية"), r.diffs);
ok("الاسم المختلف مع هوية مطابقة لا يُعدّ فرقاً (الهوية حاسمة)", !r.diffs.find((d) => d.reg.key === "3"), r.diffs);

const G = X.gradEval([
  { name: "أحمد علي", stu: "1", absent: 1, excused: 0, late: 0, present: 9, sessions: 10 },
  { name: "ليلى حسن", stu: "2", absent: 5, excused: 0, late: 0, present: 5, sessions: 10 },
  { name: "سامي عمر", stu: "3", absent: 0, excused: 2, late: 0, present: 8, sessions: 10 },
  { name: "نورة خالد", stu: "4", absent: 0, excused: 0, late: 0, present: 10, sessions: 10 },
], [{ stu: "4", name: "نورة خالد", items: ["التعهد"] }, { stu: "", name: "أحمد  علي", items: ["الاستبيان البعدي"] }], { maxAbs: 3, minRate: 75, requireEval: true, countExcused: false });
const gb = Object.fromEntries(G.map((g) => [g.s.stu, g]));
ok("تخرج: غياب زائد يمنع", !gb["2"].ok && gb["2"].reasons.some((r) => /غياب 5/.test(r)) && gb["2"].reasons.some((r) => /نسبة الحضور 50/.test(r)), gb["2"]);
ok("تخرج: نقص تقييم يمنع (بالرقم)", !gb["4"].ok && /التعهد/.test(gb["4"].reasons[0]), gb["4"]);
ok("تخرج: نقص تقييم بالاسم عند غياب الرقم", !gb["1"].ok && /البعدي/.test(gb["1"].reasons.join()), gb["1"]);
ok("تخرج: الغياب بعذر لا يُحسب إن لم يُطلب", gb["3"].ok, gb["3"]);
ok("تخرج: غير المستحقين أولاً", !G[0].ok && G[G.length - 1].ok, G.map((g) => g.s.stu));
const G2 = X.gradEval([{ name: "سامي عمر", stu: "3", absent: 0, excused: 4, late: 0, present: 6, sessions: 10 }], [], { maxAbs: 3, minRate: 0, requireEval: false, countExcused: true });
ok("تخرج: احتساب الغياب بعذر عند الطلب", !G2[0].ok, G2[0]);
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
