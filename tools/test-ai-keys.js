/* اختبار تدوير عدة مفاتيح Gemini (بلا متصفح):  node tools/test-ai-keys.js */
globalThis.window = globalThis;
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
require("../src/ai.js");
const A = globalThis.App.ai;
let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };
const dayErr = () => new Error("تم بلوغ حد الاستخدام المجاني لـ Gemini. (Quota exceeded ... requests per day limit exceeded)");
const minErr = () => new Error("تم بلوغ حد الاستخدام المجاني لـ Gemini. (Quota exceeded: requests per minute)");

(async () => {
  ok("قائمة المفاتيح: أسطر وفواصل ومسافات بلا تكرار", JSON.stringify(A.keyList("AIzaAAA111\n AIzaBBB222, AIzaAAA111 ;AIzaCCC333")) === JSON.stringify(["AIzaAAA111", "AIzaBBB222", "AIzaCCC333"]), A.keyList("AIzaAAA111\n AIzaBBB222, AIzaAAA111 ;AIzaCCC333"));
  ok("قائمة فارغة", A.keyList("  \n ").length === 0);

  A._setRR(0);
  const keys = "AIza-key-A-111111\nAIza-key-B-222222\nAIza-key-C-333333";
  let used = [];
  let r = await A._rotate(keys, async (k) => { used.push(k); if (k.endsWith("111111")) throw dayErr(); return "ok:" + k; });
  ok("الأول بلغ حده اليومي ← ينتقل إلى الثاني", r === "ok:AIza-key-B-222222" && used.length === 2, { r, used });

  used = [];
  r = await A._rotate(keys, async (k) => { used.push(k); return "ok:" + k; });
  ok("المفتاح الذي بلغ حده يُؤجَّل فلا يُجرَّب أولاً", !used[0].endsWith("111111") && used.length === 1, used);

  // كلها بلغت الحد
  const mem0 = Object.keys(mem); mem0.forEach((k) => delete mem[k]);
  let msg = "";
  try { await A._rotate(keys, async () => { throw dayErr(); }); } catch (e) { msg = e.message; }
  ok("نفدت كل المفاتيح: رسالة بعددها", /نفدت حصة كل مفاتيح Gemini \(3/.test(msg), msg);

  // خطأ غير حصة يُرمى فوراً بلا تجربة البقية
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0);
  used = [];
  let thrown = "";
  try { await A._rotate(keys, async (k) => { used.push(k); throw new Error("خطأ شبكة"); }); } catch (e) { thrown = e.message; }
  ok("خطأ آخر (شبكة) لا يُدوَّر عليه", used.length === 1 && thrown === "خطأ شبكة", { used, thrown });

  // الحد الدقيقي يُؤجَّل مدة قصيرة فقط
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0);
  await A._rotate(keys, async (k) => { if (k.endsWith("111111")) throw minErr(); return "x"; });
  const cool = JSON.parse(mem["tamkeen:gemini-cool"]), until = Object.values(cool)[0] - Date.now();
  ok("الحد الدقيقي: تأجيل نحو دقيقة لا ست ساعات", until > 30e3 && until < 120e3, until);

  // لا يُعاد الطلب بعد أن بدأ الإخراج
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0);
  used = []; let began = false, tr2 = "";
  try { await A._rotate(keys, async (k) => { used.push(k); began = true; throw dayErr(); }, () => began); } catch (e) { tr2 = e.message; }
  ok("بعد بدء الإخراج لا يُعاد الطلب بمفتاح آخر", used.length === 1, used);

  // مفتاح واحد: السلوك كما كان (يُرمى خطؤه الأصلي)
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0);
  let one = "";
  try { await A._rotate("AIza-only-key-9999", async () => { throw dayErr(); }); } catch (e) { one = e.message; }
  ok("مفتاح واحد: الخطأ الأصلي بلا عبارة «كل المفاتيح»", /بلوغ حد الاستخدام/.test(one) && !/كل مفاتيح/.test(one), one);

  ok("بلا مفاتيح: NO_KEY", await A._rotate("", async () => 1).then(() => false, (e) => e.message === "NO_KEY"));
  // توزيع بالتساوي بين المفاتيح (round-robin)
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0); A._setRR(0); A.resetKeyStats();
  const cnt = {};
  for (let i = 0; i < 9; i++) await A._rotate(keys, async (k) => { cnt[k.slice(-6)] = (cnt[k.slice(-6)] || 0) + 1; return i; });
  ok("9 طلبات على 3 مفاتيح ← 3 لكل مفتاح", Object.values(cnt).join() === "3,3,3", cnt);
  ok("إحصاء الطلبات لكل مفتاح", Object.values(A.keyStats()).join() === "3,3,3", A.keyStats());
  // بالتوازي أيضاً
  A._setRR(0); const cnt2 = {};
  await Promise.all(Array.from({ length: 6 }, () => A._rotate(keys, async (k) => { await new Promise((r) => setTimeout(r, 5)); cnt2[k.slice(-6)] = (cnt2[k.slice(-6)] || 0) + 1; })));
  ok("6 طلبات متوازية ← 2 لكل مفتاح", Object.values(cnt2).join() === "2,2,2", cnt2);
  // مفتاح مؤجَّل يُستبعد من التوزيع
  Object.keys(mem).forEach((k) => delete mem[k]); A._setRR(0); A._setRR(0);
  await A._rotate(keys, async (k) => { if (k.endsWith("111111")) throw dayErr(); return 1; });
  const cnt3 = {}; A._setRR(0);
  for (let i = 0; i < 6; i++) await A._rotate(keys, async (k) => { cnt3[k.slice(-6)] = (cnt3[k.slice(-6)] || 0) + 1; return 1; });
  ok("المفتاح الذي بلغ حده يُستبعد والباقيان يتقاسمان بالتساوي", !cnt3["111111"] && cnt3["222222"] === 3 && cnt3["333333"] === 3, cnt3);
  console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
})();
