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
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
