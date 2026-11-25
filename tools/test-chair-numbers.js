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
ok("حجم الرقم (أكبر من قبل، ومقاس ليتّسع): خانتان 250، ثلاث 170، أربع 120", C.sizeFor(items(9)) === 250 && C.sizeFor(items(5, 100)) === 170 && C.sizeFor(items(3, 1000)) === 120);
ok("حجم الرقم في Word أصغر قليلاً (خط أعرض): 230، 160، 118", C.wordSizeFor(items(9)) === 230 && C.wordSizeFor(items(5, 100)) === 160 && C.wordSizeFor(items(3, 1000)) === 118);
ok("النص يُهرَّب", /&lt;b&gt;/.test(C.html([{ n: 1, name: "<b>", track: "" }], { names: true })));
(async () => {
  globalThis.JSZip = require("../vendor/jszip.min.js");
  const fs = require("fs"), logoBytes = { right: new Uint8Array(fs.readFileSync(__dirname + "/../assets/logo-maalam.png")), left: new Uint8Array(fs.readFileSync(__dirname + "/../assets/logo.png")) };
  const buf = await C.docx(items(6, 120), { logoBytes, type: "nodebuffer", names: true });
  const z = await JSZip.loadAsync(buf), doc = await z.file("word/document.xml").async("string");
  ok("Word: صفحة A4 بهوامش صغيرة", /<w:pgSz w:w="11906" w:h="16838"\/>/.test(doc));
  ok("Word: صف لكل رقمين (6 أرقام ← 3 صفوف بارتفاع ثابت)", (doc.match(/w:hRule="exact"/g) || []).length === 3);
  ok("Word: الأرقام 120..125 بحجم 160pt", [...doc.matchAll(/<w:sz w:val="320"\/><w:szCs w:val="320"\/><\/w:rPr><w:t>(\d+)</g)].map((m) => m[1]).join() === "120,121,122,123,124,125");
  ok("Word: الشعاران مضمّنان مرة واحدة ويُستعملان في كل بطاقة (12)", !!z.file("word/media/logo-right.png") && !!z.file("word/media/logo-left.png") && (doc.match(/<w:drawing>/g) || []).length === 12);
  ok("Word: الجدول من اليمين لليسار وخطوط القص متقطّعة", /<w:bidiVisual\/>/.test(doc) && /w:insideV w:val="dashed"/.test(doc));
  ok("Word: الاسم تحت الرقم", /طالب 1</.test(doc));
  const noLogo = await JSZip.loadAsync(await C.docx(items(2), { logos: false, type: "nodebuffer" }));
  ok("Word بلا شعارات: لا صور", !noLogo.file("word/media/logo-right.png") && !/<w:drawing>/.test(await noLogo.file("word/document.xml").async("string")));
  console.log(bad ? bad + " فشل" : "كل الاختبارات نجحت (" + n + ")"); process.exit(bad ? 1 : 0);
})();
