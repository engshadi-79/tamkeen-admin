/* اختبار فهم رد الذكاء الاصطناعي في center-sign.js (بلا متصفح) */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = { window: {}, document: {}, Image: function () {}, URL: {} }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "center-sign.js"), "utf8"), ctx);
const S = ctx.App.centerSign; let bad = 0, n = 0;
const ok = (name, c) => { n++; if (!c) { bad++; console.log("FAIL", name); } };
ok("JSON عادي", S.parseJson('{"rows":[{"name":"أ"}]}').rows.length === 1);
ok("داخل سياج ```", S.parseJson("```json\n{\"rows\":[]}\n```").rows.length === 0);
ok("نص حول JSON", S.parseJson('إليك: {"title":"x","rows":[]} انتهى').title === "x");
ok("فاصلة زائدة", S.parseJson('{"rows":[{"name":"أ",},]}').rows.length === 1);
let thrown = false; try { S.parseJson("لا شيء"); } catch (e) { thrown = true; } ok("رد بلا JSON يرمي", thrown);
const r = S.normRow({ name: "  أحمد   علي ", signed: "true", confidence: 3 }, "f", 0);
ok("تطبيع الصف", r.name === "أحمد علي" && r.signed === true && r.conf === 1);
ok("صف بلا اسم يُهمَل", S.normRow({ name: " " }, "f", 1) === null);
ok("signed مجهول", S.normRow({ name: "س" }, "f", 2).signed === null);

(async () => {
  const fake = { vision: async () => '```json\n{"title":"كشف","heads":["الاسم","الهوية"],"rows":[["أحمد علي","1012345678"],["ليلى","1099999999","زائد"],[],["",""]]}\n```' };
  const t = await S.readTable({ name: "a.jpg", mime: "image/jpeg", data: "x" }, { ai: fake });
  ok("جدول من صورة: رؤوس وصفوف موحّدة العرض", t.heads.length === 3 && t.rows.length === 2 && t.rows.every((r) => r.length === 3) && t.title === "كشف", t);
  const fk = { n: 0, vision: async () => { if (fk.n++ === 1) throw new Error("boom"); return '{"heads":["أ"],"rows":[["1"]]}'; } };
  const m = await S.readTables([{ name: "1" }, { name: "2" }, { name: "3" }], { ai: fk });
  ok("قراءة عدة صور: إخفاق صورة لا يوقف البقية", m.tables.length === 2 && m.failed.length === 1, m);
  console.log(bad ? bad + " فشل" : "كل اختبارات الجداول نجحت"); process.exit(bad ? 1 : 0);
})();

