/* اختبار أرقام الكراسي (بلا متصفح):  node tools/test-chair-numbers.js */
globalThis.window = globalThis;
require("../src/chair-numbers.js");
const C = globalThis.App.chairNumbers;
let n = 0, bad = 0;
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log("FAIL", name, x === undefined ? "" : JSON.stringify(x)); } };
const items = (k, start) => Array.from({ length: k }, (_, i) => ({ n: (start || 1) + i, name: "طالب " + (i + 1), track: "الحلاقة", sex: "ذكور" }));

ok("4 أرقام في الصفحة: 10 أرقام ← 3 صفحات (4+4+2)", C.pages(items(10)).map((p) => p.length).join() === "4,4,2");
const h = C.html(items(10), {});
ok("HTML: 3 صفحات A4", (h.match(/class="pg"/g) || []).length === 3 && /size: A4 portrait/.test(h));
ok("الصفحة الأخيرة: رقمان وربعان فارغان", (h.match(/class="q e"/g) || []).length === 2);
ok("الأرقام 1..10 بالترتيب", [...h.matchAll(/class="n">(\d+)</g)].map((m) => m[1]).join() === "1,2,3,4,5,6,7,8,9,10");
ok("بلا أسماء افتراضياً", !/class="nm"/.test(h));
ok("الشعاران افتراضياً في كل بطاقة: المركز السعودي يميناً وتمكين يساراً", (h.match(/class="lg r" src="[^"]*logo-maalam\.png"/g) || []).length === 10 && (h.match(/class="lg l" src="[^"]*logo\.png"/g) || []).length === 10);
ok("بلا شعارات عند إيقافها", !/class="lg/.test(C.html(items(4), { logos: false })));
const hn = C.html(items(2), { names: true, tags: true });
ok("مع الأسماء والمسار", /class="nm">طالب 1</.test(hn) && /class="tg">الحلاقة · ذكور</.test(hn));
ok("حجم الخط: خانتان 200، ثلاث 150، أربع 115", C.sizeFor(items(9)) === 200 && C.sizeFor(items(5, 100)) === 150 && C.sizeFor(items(3, 1000)) === 115);
ok("النص يُهرَّب", /&lt;b&gt;/.test(C.html([{ n: 1, name: "<b>", track: "" }], { names: true })));
console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
