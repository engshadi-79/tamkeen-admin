/* اختبار منطق أرشفة ملفات الزملاء في server/SupabaseBackup.gs بلا Google:
   يحاكي DriveApp وPropertiesService ويستدعي doPost كما يفعل الخادم.
   التشغيل: node tools/test-drop-script.js */
const fs = require("fs");
const path = require("path");

const KEY = "k1abcd";
const src = fs.readFileSync(path.join(__dirname, "..", "server", "SupabaseBackup.gs"), "utf8");

const props = { SB_ROOT_ID: "D", DROP_KEY: KEY };
const files = [];
let seq = 0;
const mkFile = (blob) => {
  const f = {
    id: "f" + (++seq), blob, desc: "", trashed: false, made: new Date(),
    getId() { return this.id; }, getName() { return blob.name; },
    setDescription(d) { this.desc = d; }, getDescription() { return this.desc; },
    getDateCreated() { return this.made; }, getSize() { return blob.bytes.length; },
    isTrashed() { return this.trashed; }, setTrashed(v) { this.trashed = v; },
    getBlob() { return { getContentType: () => blob.mime, getBytes: () => blob.bytes }; },
    getParents() { let d = false; return { hasNext: () => !d, next: () => { d = true; return folder; } }; },
  };
  files.push(f);
  return f;
};
const folder = {
  getId: () => "D", getUrl: () => "folderurl", createFile: mkFile, isTrashed: () => false,
  getFiles() { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
  searchFiles() { const t = files.filter((f) => f.trashed); let i = 0; return { hasNext: () => i < t.length, next: () => t[i++] }; },
  getFoldersByName() { return { hasNext: () => true, next: () => folder }; },
};
const fetchCalls = [];
const g = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
  DriveApp: { getFolderById: () => folder, getRootFolder: () => folder, getFileById: (id) => files.find((f) => f.id === id) },
  Utilities: {
    formatDate: () => "2026-11-16", sleep() {}, getUuid: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    base64Decode: (s) => Buffer.from(s, "base64"), base64Encode: (b) => Buffer.from(b).toString("base64"),
  },
  Session: { getScriptTimeZone: () => "UTC" },
  ScriptApp: { getOAuthToken: () => "tok" },
  UrlFetchApp: { fetch: (url, o) => { fetchCalls.push({ url, o }); return { getResponseCode: () => 200, getAllHeaders: () => ({ Location: "https://upload.example/sess" }) }; } },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 1 } },
};
const { doPost } = new Function(...Object.keys(g), src + "\nreturn { doPost };")(...Object.values(g));
const call = (o) => JSON.parse(doPost({ postData: { contents: JSON.stringify(o) } }));

let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : " — " + JSON.stringify(extra))); if (!cond) fails++; };
const b64 = (t) => Buffer.from(t).toString("base64");
const up = (name, by, cat, title) => call({ action: "dropUpload", name, by, cat, title, data: b64("x") });
const list = () => call({ action: "dropList", key: KEY });
const names = () => list().files.map((f) => `${f.name}|${f.by}|${f.cat}`).sort();

ok("الرفع بلا تصنيف مرفوض", /التصنيف/.test(up("a.pdf", "أحمد").error || ""));
ok("تصنيف غير موجود مرفوض", !!up("a.pdf", "أحمد", "وهمي").error);
ok("الرفع الصحيح", up("a.pdf", "أحمد", "تقارير", "عنوان").ok === true);
up("b.pdf", "أحمد", "كتب ومراجع"); up("c.pdf", "رشا", "نماذج");
ok("القائمة تُعيد التصنيف والعنوان", names().length === 3 && list().files.some((f) => f.title === "عنوان" && f.cat === "تقارير"));
ok("القائمة بلا رمز مرفوضة", !!call({ action: "dropList", key: "x" }).error);
ok("التصنيفات عامة بلا رمز", call({ action: "dropCats" }).cats.length === 6);

const id = list().files.find((f) => f.name === "c.pdf").id;
ok("تعديل العنوان والتصنيف والصاحب", call({ action: "dropEdit", key: KEY, id, title: "جديد", cat: "خطابات", by: "سعاد" }).ok);
ok("التعديل ظهر في القائمة", names().includes("c.pdf|سعاد|خطابات"));
ok("تعديل بتصنيف وهمي مرفوض", !!call({ action: "dropEdit", key: KEY, id, cat: "س" }).error);

const save = call({ action: "dropCatsSave", key: KEY, cats: ["التقارير", "كتب ومراجع", "عقود", "خطابات"], renames: { "تقارير": "التقارير" } });
ok("حفظ التصنيفات مع إعادة تسمية", save.ok && save.moved === 1, save);
ok("الملف انتقل مع الاسم الجديد", names().includes("a.pdf|أحمد|التقارير"));
ok("قائمة فارغة مرفوضة", !!call({ action: "dropCatsSave", key: KEY, cats: [] }).error);
ok("الحفظ بلا رمز مرفوض", !!call({ action: "dropCatsSave", key: "x", cats: ["س"] }).error);

const ren = call({ action: "dropRenameBy", key: KEY, from: "أحمد", to: "أحمد علي" });
ok("تعديل اسم شخص يشمل كل ملفاته", ren.ok && ren.count === 2 && names().every((n) => !/\|أحمد\|/.test(n)));
ok("الحذف إلى سلة المهملات", call({ action: "dropDelete", key: KEY, id }).ok && !names().some((n) => n.startsWith("c.pdf")) && files.find((f) => f.id === id).trashed);
ok("حذف شخص وملفاته", call({ action: "dropDeleteBy", key: KEY, by: "أحمد علي" }).count === 2 && names().length === 0);

// الرفع المباشر للملفات الكبيرة
const init = (o) => call(Object.assign({ action: "dropInit", name: "big.zip", mime: "application/zip", size: 1024, by: "رشا", cat: "عقود", origin: "https://tamkeen-admin.vercel.app" }, o));
const r = init({});
ok("فتح جلسة رفع مباشر", r.ok && r.url === "https://upload.example/sess" && r.chunk === 8388608, r);
const meta = JSON.parse(fetchCalls[0].o.payload);
ok("الجلسة تُنشأ داخل مجلد الزملاء بوصف التصنيف", meta.parents[0] === "D" && JSON.parse(meta.description).cat === "عقود");
init({ createdTime: "2025-03-05T10:00:00.000Z" });
const cm = JSON.parse(fetchCalls[fetchCalls.length - 1].o.payload);
ok("تاريخ الإنشاء الأصلي يصير createdTime في Drive", cm.createdTime === "2025-03-05T10:00:00.000Z" && cm.modifiedTime === cm.createdTime, cm);
init({ createdTime: "2999-01-01T00:00:00Z" });
ok("تاريخ مستقبلي يُتجاهل", !JSON.parse(fetchCalls[fetchCalls.length - 1].o.payload).createdTime);
ok("رأس Origin مسموح فقط للموقع", fetchCalls[0].o.headers.Origin === "https://tamkeen-admin.vercel.app");
init({ origin: "https://evil.example" });
ok("Origin غريب يُستبدل بالموقع", fetchCalls[1].o.headers.Origin === "https://tamkeen-admin.vercel.app");
ok("حدّ 1 غيغابايت", /1024/.test(init({ size: 1025 * 1024 * 1024 }).error || ""));
ok("ملف فارغ مرفوض", !!init({ size: 0 }).error);
ok("الرفع المباشر بلا تصنيف مرفوض", !!init({ cat: "" }).error);

// تاريخ الرفع الفعلي محفوظ مستقلاً عن تاريخ إنشاء الملف
init({ name: "u.pdf", createdTime: "2025-03-05T10:00:00.000Z" });
const upMeta = JSON.parse(JSON.parse(fetchCalls[fetchCalls.length - 1].o.payload).description);
ok("الوصف يحمل تاريخ الرفع up", /^20\d\d-/.test(upMeta.up || ""), upMeta);
const f0 = mkFile({ name: "z.pdf", mime: "a/b", bytes: Buffer.from("x") }); f0.setDescription(JSON.stringify({ by: "ب", cat: "أخرى", up: "2026-11-17T05:00:00.000Z" }));
ok("القائمة تُعيد up", call({ action: "dropList", key: KEY }).files.some((f) => f.name === "z.pdf" && f.up === "2026-11-17T05:00:00.000Z"));

// نسخة «نماذجي» على Drive
const mi = (o) => call(Object.assign({ action: "mineInit", key: KEY, name: "نموذج.docx", size: 2048, mime: "application/x-test", mid: "m1", kind: "main", title: "نموذجي", origin: "https://tamkeen-admin.vercel.app" }, o));
ok("mineInit بلا رمز مرفوض", !!call({ action: "mineInit", key: "x", name: "a", size: 5 }).error);
const m1 = mi({});
ok("mineInit يفتح جلسة", m1.ok && !!m1.url, m1);
const mmeta = JSON.parse(fetchCalls[fetchCalls.length - 1].o.payload);
ok("الجلسة في مجلد نماذجي بوصف mid/kind", JSON.parse(mmeta.description).mid === "m1" && JSON.parse(mmeta.description).kind === "main");
ok("mineInit يرفض فوق 200 ميغابايت", !!mi({ size: 201 * 1048576 }).error);
ok("mineInit يرفض فارغاً", !!mi({ size: 0 }).error);
const mf = mkFile({ name: "نموذج.docx", mime: "application/x-test", bytes: Buffer.from("abc") });
mf.setDescription(JSON.stringify({ mid: "m1", kind: "main", title: "نموذجي" }));
const ml = call({ action: "mineList", key: KEY });
ok("mineList يُعيد mid والعنوان", ml.files.some((f) => f.mid === "m1" && f.title === "نموذجي" && f.kind === "main"), ml);
ok("mineFile يُعيد المحتوى", Buffer.from(call({ action: "mineFile", key: KEY, id: mf.id }).data, "base64").toString() === "abc");
ok("mineDelete إلى سلة المهملات", call({ action: "mineDelete", key: KEY, id: mf.id }).ok && mf.trashed);

// نبضة المراقب، قواعد التصنيف، الرمز السري، سلة المحذوفات
ok("النبضة تُحفظ وتظهر في القائمة", call({ action: "dropBeat", by: "د.يوسف", host: "PC", folders: 2, lastName: "x.pdf", lastAt: "2026-11-18T08:00:00Z", uploaded: 3 }).ok && list().beat && list().beat.by === "د.يوسف" && list().beat.uploaded === 3, list().beat);
ok("نبضة متقاربة تُتجاهل", call({ action: "dropBeat", by: "آخر", lastName: "x.pdf" }).skipped === true);
ok("القواعد: حفظ بالرمز فقط", !!call({ action: "dropRulesSave", key: "x", rules: [] }).error);
const rs = call({ action: "dropRulesSave", key: KEY, rules: [{ match: "تقرير|report", cat: "التقارير" }, { match: "(", cat: "التقارير" }, { match: "ok", cat: "تصنيف-وهمي" }] });
ok("القواعد: تعبير غير صالح يُرفض", /غير صالح/.test(rs.error || ""), rs);
const rs2 = call({ action: "dropRulesSave", key: KEY, rules: [{ match: "تقرير|report", cat: "التقارير" }, { match: "ok", cat: "تصنيف-وهمي" }] });
ok("القواعد: تُحفظ الصالحة فقط وتُقرأ بلا رمز", rs2.ok && rs2.rules.length === 1 && call({ action: "dropRules" }).rules.length === 1, rs2);
const tk = call({ action: "dropTokenSet", key: KEY });
ok("الرمز السري يُولَّد", tk.ok && tk.token.length === 16, tk);
ok("مع الرمز: الرفع بلا رمز مرفوض", /غير صالح/.test(up("t.pdf", "ب", "عقود").error || ""));
ok("مع الرمز: dropInit بلا رمز مرفوض", /غير صالح/.test(call({ action: "dropInit", name: "t", size: 5, cat: "أخرى" }).error || ""));
ok("مع الرمز: الرفع بالرمز مقبول", call({ action: "dropUpload", name: "t.pdf", by: "ب", cat: "عقود", token: tk.token, data: b64("x") }).ok === true);
ok("dropCats تعلن القفل", call({ action: "dropCats" }).locked === true);
ok("إلغاء الرمز", call({ action: "dropTokenSet", key: KEY, clear: true }).ok && up("t2.pdf", "ب", "عقود").ok === true);
const tf = mkFile({ name: "محذوف.pdf", mime: "a/b", bytes: Buffer.from("x") }); tf.setDescription(JSON.stringify({ by: "ب", cat: "أخرى" })); tf.trashed = true;
const tr = call({ action: "dropTrash", key: KEY });
ok("السلة تعرض المحذوف", tr.files.some((f) => f.name === "محذوف.pdf"), tr);
ok("الاستعادة تُخرجه من السلة", call({ action: "dropRestore", key: KEY, id: tf.id }).ok && !tf.trashed);
ok("السلة والاستعادة بالرمز فقط", !!call({ action: "dropTrash", key: "x" }).error && !!call({ action: "dropRestore", key: "x", id: tf.id }).error);
ok("الحقول المطلوبة من Drive للتحقق من الحجم", /fields=id,name,size/.test(fetchCalls[fetchCalls.length - 1] ? fetchCalls.map((c) => c.url).join(" ") : ""));

// الحد اليومي
props.DROP_COUNT = JSON.stringify({ day: "2026-11-16", n: 1000 });
ok("الحد اليومي 1000 يُوقف الرفع", /الحدّ اليومي|حدّه اليومي/.test(init({}).error || ""));

console.log(fails ? `${fails} إخفاق` : "نجحت كل الاختبارات");
process.exit(fails ? 1 : 0);
