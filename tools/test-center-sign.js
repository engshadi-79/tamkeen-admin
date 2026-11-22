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
  // دفعات: 5 صور بـ3 في الطلب ← طلبان لا خمسة، والأسماء تُنسَب لصورتها
  let calls = 0;
  const fb = { vision: async ({ images }) => { calls++; return JSON.stringify({ sheets: images.map((_, k) => ({ image: k + 1, title: "ورقة", rows: [{ name: "اسم " + calls + "-" + (k + 1), signed: true, confidence: 0.9 }] })) }); } };
  const ims = [1, 2, 3, 4, 5].map((n) => ({ name: "img" + n + ".jpg", mime: "image/jpeg", data: "x" }));
  const rb = await S.readSheets(ims, { ai: fb, batch: 3 });
  ok("دفعات: طلبان لخمس صور", calls === 2 && rb.rows.length === 5, { calls, rows: rb.rows.length });
  ok("دفعات: كل اسم يُنسَب لصورته (file)", rb.rows.map((r) => r.file).sort().join() === "img1.jpg,img2.jpg,img3.jpg,img4.jpg,img5.jpg", rb.rows.map((r) => r.file));
  // دفعة بلا sheets ← تُسجَّل أخطاء ولا يتعطل الباقي
  const fbad = { vision: async () => "{\"rows\":[]}" };
  const rbad = await S.readSheets(ims.slice(0, 2), { ai: fbad, batch: 2 });
  ok("دفعة بشكل خاطئ: صورتان فاشلتان ولا استثناء", rbad.failed.length === 2 && rbad.rows.length === 0, rbad.failed);
  // الحد اليومي: يتوقف الباقي فوراً
  let qc = 0;
  const fq = { vision: async () => { qc++; throw new Error("You exceeded your current quota: Generate content requests per day limit exceeded on Free Tier"); } };
  const many = Array.from({ length: 12 }, (_, i) => ({ name: "q" + i + ".jpg", mime: "image/jpeg", data: "x" }));
  const rq = await S.readSheets(many, { ai: fq, batch: 1 });
  ok("الحد اليومي: quota=true وتوقف الطلبات (≤4 لا 12)", rq.quota === true && qc <= 4 && rq.failed.length === 12, { qc, quota: rq.quota, failed: rq.failed.length });
  ok("الحد اليومي: كل الصور مسجّلة غير مقروءة بسبب الحد", rq.failed.every((x) => x.error === "حد الاستخدام اليومي"), rq.failed[0]);
  ok("isDayQuota يميّز الحد اليومي لا الدقيقة", S.isDayQuota(new Error("limit exceeded per day")) && !S.isDayQuota(new Error("rate limit per minute")), "isDayQuota");
  console.log(bad ? bad + " فشل" : "كل اختبارات الجداول نجحت"); process.exit(bad ? 1 : 0);
})();

