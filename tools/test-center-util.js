/* اختبار الأدوات الصرفة لـ«أوامر المركز» مباشرة في Node بلا متصفح:  node tools/test-center-util.js */
globalThis.window = globalThis;
globalThis.localStorage = (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })();
require("../src/center-util.js");
const U = globalThis.App.ccUtil;
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); } };
const now = Date.parse("2026-11-10T08:00:00Z"), day = 86400000, iso = (ms) => new Date(now - ms).toISOString();

console.log("[1] تقسيم الخلايا والأرقام");
check("رقم دولي", U.waIntl("0599123456", "970") === "970599123456" && U.waIntl("+970 599-123-456", "970") === "970599123456" && U.waIntl("00972599123456", "970") === "972599123456");
check("جوال بلا صفر يُصحَّح", U.phoneNorm("599123456") === "0599123456");
check("خلية الطالب: الاسم والهوية والجوال", JSON.stringify(U.splitStudentCell("سمر فريد / STU-2026-11 لا يوجد اسم إنجليزي 401234567 - 0599123456")) === JSON.stringify(["سمر فريد", "", "STU-2026-11", "401234567", "0599123456"]), U.splitStudentCell("سمر فريد / STU-2026-11 لا يوجد اسم إنجليزي 401234567 - 0599123456"));
check("خلية المجموعة والمدرب", JSON.stringify(U.splitGroupCell("S3G1 اسراء خليل")) === JSON.stringify(["S3G1", "اسراء خليل"]) && JSON.stringify(U.splitGroupCell("G2 -")) === JSON.stringify(["G2", ""]));
check("إخفاء الهوية", U.maskCell("401234567") === "40*****67" && U.maskCell("اسم") === "اسم");
check("مقارنة النسخ", U.verLess("1.3.0", "1.4.0") && !U.verLess("1.4.0", "1.4.0"));
check("الرسالة كاملة بلا تجزئة افتراضياً", U.waParts("أ\nب\nج").length === 1 && U.waParts("أ".repeat(50) + "\n" + "ب".repeat(50), 60).length === 2);

console.log("\n[2] لقطات الناقصين");
const S = (ageMs, keys) => ({ at: iso(ageMs), rows: keys.map((k) => [k, "ط" + k, "مسار"]) });
check("خط الأساس: لقطة عمرها 8 أيام تُفضَّل على الأحدث", U.pickBase([S(8 * day, ["1", "2"]), S(2 * day, ["1"])], now).e.rows.length === 2);
check("بلا لقطة قديمة: أقدم لقطة عمرها ساعة فأكثر", U.pickBase([S(3 * day, ["1"]), S(2 * day, ["1", "2"])], now).e.at === iso(3 * day));
check("لا أساس إن كانت اللقطة أحدث من ساعة", U.pickBase([S(1000, ["1"])], now) === null);
const dr = U.diffRows([["1", "ط1", "م"], ["2", "ط2", "م"], ["3", "ط3", "م"]], [["3", "ط3", "م"], ["4", "ط4", "م"]]);
check("الفرق: من أكمل ومن نقص جديداً", dr.before === 3 && dr.now === 2 && dr.done.map((x) => x.name).join() === "ط1,ط2" && dr.added.map((x) => x.name).join() === "ط4", dr);
const cl = U.compareLatest([S(9 * day, ["1", "2", "3"]), S(1 * day, ["3", "4"])]);
check("آخر لقطة مقابل الأساس", cl && cl.done.length === 2 && cl.added.length === 1 && cl.before === 3 && cl.now === 2, cl);
check("لقطة واحدة: لا مقارنة", U.compareLatest([S(day, ["1"])]) === null);

console.log("\n[3] الالتزام بالمتطلبات");
const mk = (id, g, tr, track) => ({ id, stu: "S" + id, name: "ط" + id, track: track || "التجميل", stage: "الثانية", group: g, trainer: tr });
const students = [mk("1", "G1", "أحمد"), mk("2", "G1", "أحمد"), mk("3", "G1", "أحمد"), mk("4", "G2", "سلمى"), mk("5", "G2", "سلمى"), mk("6", "", "")];
const missing = [{ id: "1", stu: "S1", flags: { post: true, impact: true } }, { id: "2", stu: "S2", flags: { pledge: true } }, { id: "4", stu: "S4", flags: { post: true } }, { id: "5", stu: "S5", flags: { pre: true } }, { id: "99", stu: "S99", flags: { post: true } }];
const rk = U.rankCompliance(students, missing);
const g1 = rk.groups.find((g) => g.group === "G1"), g2 = rk.groups.find((g) => g.group === "G2");
check("مجموعة G1: 3 طلاب، مكتمل واحد (33%) وناقصها مفصّل", g1.n === 3 && g1.complete === 1 && g1.pct === 33 && g1.post === 1 && g1.impact === 1 && g1.pledge === 1, g1);
check("مجموعة G2: مكتمل 0 من 2 (0%)", g2.n === 2 && g2.complete === 0 && g2.pct === 0, g2);
check("غير الموزع يظهر مجموعة مستقلة مكتملة (لا ناقص له)", rk.groups.some((g) => g.group === "(غير موزع)" && g.pct === 100));
check("الترتيب: الأقل التزاماً أولاً", rk.groups[0].group === "G2" && rk.groups[rk.groups.length - 1].group === "(غير موزع)", rk.groups.map((g) => g.group + ":" + g.pct));
const ta = rk.trainers.find((t) => t.name === "أحمد");
check("المدرب: يجمع مجموعاته", ta.n === 3 && ta.groups === 1 && ta.pct === 33, ta);
check("ناقص من غير طلاب القائمة (99) لا يدخل الحساب", rk.total === 6 && rk.complete === 2 && rk.pct === 33, [rk.total, rk.complete, rk.pct]);
check("مطابقة بالرقم التسلسلي عند غياب الهوية", U.rankCompliance([{ id: "", stu: "S4", name: "م", track: "ت", stage: "ث", group: "G", trainer: "" }], [{ id: "", stu: "S4", flags: { post: true } }]).complete === 0);

console.log("\n[4] التذكير الأسبوعي");
check("لم يُشغَّل قط: مستحق", U.weeklyDue(null, 0, now).due && U.weeklyDue(null, 0, now).never);
check("قبل 3 أيام: غير مستحق", !U.weeklyDue({ at: iso(3 * day) }, 0, now).due && U.weeklyDue({ at: iso(3 * day) }, 0, now).days === 3);
check("قبل 8 أيام: مستحق", U.weeklyDue({ at: iso(8 * day) }, 0, now).due);
check("التأجيل يخفيه حتى موعده", !U.weeklyDue({ at: iso(8 * day) }, now + day, now).due && U.weeklyDue({ at: iso(8 * day) }, now - 1, now).due);

console.log("[N] مقارنة اللقطات");
check("أرقام عربية وفاصلة ونسبة", U.numOf("٢٫٩١") === 2.91 && U.numOf("49.54%") === 49.54 && isNaN(U.numOf("نص")));
const dt = U.diffTables({ heads: ["المسار", "أجابوا", "المتوسط"], rows: [["الحلاقة", "54", "2.71"], ["التسويق", "10", "3.5"]] }, { heads: ["المسار", "أجابوا", "المتوسط"], rows: [["الحلاقة", "50", "2.91"]] });
check("الفرق بين لقطتين", dt.heads.join("|") === "المسار|أجابوا (الآن)|أجابوا (السابق)|أجابوا (الفرق)|المتوسط (الآن)|المتوسط (السابق)|المتوسط (الفرق)" && dt.rows[0][3] === "▲ +4" && dt.rows[0][6] === "▼ -0.2" && dt.rows[1][2] === "جديد" && dt.matched === 1, dt);
console.log("[مطابقة الأسماء] قراءة الصور بأخطائها");
{
  const reg = [{ name: "أمل ياسر عبد ربه أبو بكرة" }, { name: "ملك أحمد السيد أبو القرايا" }, { name: "رولا يوسف إسماعيل أبو غديان" }, { name: "مرفت إسماعيل يونس النيرب" }, { name: "سونيه محمد ابراهيم شبط" }, { name: "محمد خالد عوض" }];
  const found = [{ name: "امال ياسر عبد ربه ابو بكره" }, { name: "ملك احمد السيد ابو القرايا" }, { name: "رولا يوسف اسماعيل ابو غديان" }, { name: "مرفت اسماعيل النيرب" }, { name: "سونية ابراهيم شبط" }, { name: "خالد محمد عوض" }, { name: "نور حسن علي" }];
  const m = U.matchNames(reg, found);
  const byReg = Object.fromEntries(m.pairs.map((p) => [p.reg, p]));
  check("اختلاف همزة وتاء مربوطة وألف: مطابق مؤكد", byReg[0] && byReg[0].found === 0 && byReg[0].sure);
  check("اسم ناقص جزءاً (رباعي ← ثلاثي) مطابق", byReg[3] && byReg[3].found === 3 && byReg[3].score >= 0.62);
  check("خطأ حرف في «سونيه/سونية»", byReg[4] && byReg[4].found === 4);
  check("اسم شخص آخر لا يطابق (نور حسن علي)", m.unmatchedFound.length === 1 && found[m.unmatchedFound[0]].name === "نور حسن علي");
  check("لا يكرر المقروء لمسجَّلَين", new Set(m.pairs.map((p) => p.found)).size === m.pairs.length);
  check("اسم مقلوب الترتيب يُطابَق ثلاثياً", byReg[5] && byReg[5].found === 5);
  check("اسمان مختلفان تماماً درجتهما صفر", U.nameScore("أمل ياسر عبد ربه", "نور حسن علي") === 0);
  check("اسم واحد من رمزين مختلفين في الأب لا يُقبل بسهولة", U.nameScore("محمد أحمد علي حسن", "محمد خالد سعيد يوسف") < 0.62);
  // المطابقة بالهوية والجوال
  {
    const R = [{ name: "سامي عمر", id: "1012345678", phone: "0501112222" }, { name: "ليلى حسن", id: "1099999999", phone: "0503334444" }, { name: "خالد سعيد", id: "1055555555", phone: "" }];
    const F = [{ name: "سمي عمرو", id: "١٠١٢٣٤٥٦٧٨", phone: "" }, { name: "ليلى حسن", id: "", phone: "966503334444" }, { name: "خالد سعيد", id: "1077777777", phone: "" }];
    const m2 = U.matchNames(R, F), by2 = Object.fromEntries(m2.pairs.map((p) => [p.reg, p]));
    check("الهوية تجزم رغم تشوّه الاسم", by2[0] && by2[0].found === 0 && by2[0].sure && by2[0].by === "id");
    check("الجوال (مع مفتاح الدولة) يجزم", by2[1] && by2[1].found === 1 && by2[1].sure && by2[1].by === "phone");
    check("اسم يتفق وهوية تختلف: مراجعة لا جزم", by2[2] && by2[2].found === 2 && !by2[2].sure && by2[2].mismatch);
  }
  // اسم المجموعة العربي (الاولى…) ثم المدرب بلا فاصل
  check("«الاولى ورود بركات علي أبو شمالة»: المجموعة الاولى والمدرب الباقي", JSON.stringify(U.splitGroupCell("الاولى ورود بركات علي أبو شمالة")) === JSON.stringify(["الاولى", "ورود بركات علي أبو شمالة"]), U.splitGroupCell("الاولى ورود بركات علي أبو شمالة"));
  check("«الثانية سمر فريد»", U.splitGroupCell("الثانية سمر فريد")[0] === "الثانية");
  check("«الأولى» وحدها لا تتغيّر", U.splitGroupCell("الأولى")[0] === "الأولى");
}

console.log(`\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
