/* يختبر الدالة الطرفية الحقيقية: يُنسخ index.ts كما هو ولا يُغيَّر فيه إلا سطر الاستيراد،
   ثم يُشغَّل فوق قاعدة بيانات وهمية في الذاكرة. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeDb } from "./fakedb.js";

const SRC = "D:/ai/Tamkeen/server/supabase/index.ts";
const here = new URL(".", import.meta.url).pathname.replace(/^\//, "");

let code = readFileSync(SRC, "utf8");
const before = code;
code = code.replace(/import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";/, 'import { createClient } from "./fakedb.js";');
if (code === before) { console.error("FAIL: لم يُستبدل سطر الاستيراد"); process.exit(1); }
mkdirSync(here, { recursive: true });
writeFileSync(here + "fn.ts", code);

let handler = null;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (k) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", ADMIN_KEY: "SECRET123" }[k]) },
};
globalThis.__fakeDb = makeDb();

await import("./fn.ts");
if (!handler) { console.error("FAIL: لم تُسجَّل الدالة"); process.exit(1); }

const post = async (body) => {
  const res = await handler(new Request("https://fn.test/tamkeen", { method: "POST", body: JSON.stringify(body) }));
  return await res.json();
};

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* ===== 1. الحالة والتأسيس ===== */
console.log("\n[1] الحالة والتأسيس");
check("لا يوجد مستخدمون بعد", (await post({ action: "status" })).hasUsers === false);
check("رمز مدير خاطئ يُرفض", (await post({ action: "setup", adminKey: "x", username: "admin", password: "123456" })).error === "رمز المدير غير صحيح");
const admin = await post({ action: "setup", adminKey: "SECRET123", username: "Admin", name: "شادي", password: "pass1234" });
check("أُنشئ المدير وعاد برمز جلسة", !!admin.token && admin.user.admin === true && admin.user.username === "admin", admin);
check("لا يُسمح بمدير ثانٍ", (await post({ action: "setup", adminKey: "SECRET123", username: "b", password: "123456" })).error?.includes("مسبقاً"));
const T = admin.token;

/* ===== 2. الدخول ===== */
console.log("\n[2] الدخول");
check("كلمة مرور خاطئة تُرفض", (await post({ action: "login", username: "admin", password: "wrong" })).error === "اسم المستخدم أو كلمة المرور غير صحيحة");
check("اسم غير موجود يعطي الرسالة نفسها", (await post({ action: "login", username: "nobody", password: "x" })).error === "اسم المستخدم أو كلمة المرور غير صحيحة");
const relog = await post({ action: "login", username: "ADMIN", password: "pass1234" });
check("الدخول ينجح ولا يتأثر بحالة الأحرف", !!relog.token);
check("رمز جلسة مزيّف يُرفض", (await post({ action: "ping", token: "zzz" })).error === "UNAUTHORIZED");
check("ping يعيد المستخدم", (await post({ action: "ping", token: T })).user.username === "admin");

/* ===== 3. مستخدم ثانٍ بصلاحيات ===== */
console.log("\n[3] المستخدمون");
const saved = await post({ action: "saveUser", token: T, user: { username: "sara", name: "سارة", password: "sara1234", views: ["registry"], perms: { upload: true } } });
check("أُضيفت سارة بصلاحياتها", saved.user.name === "سارة" && saved.user.views[0] === "registry", saved);
const sara = await post({ action: "login", username: "sara", password: "sara1234" });
check("سارة تدخل بحسابها", !!sara.token);
const S = sara.token;
check("غير المدير لا يضيف مستخدمين", (await post({ action: "saveUser", token: S, user: { username: "x", password: "123456" } })).error === "هذا الإجراء للمدير فقط");
check("المدير لا يحذف نفسه", (await post({ action: "deleteUser", token: T, username: "admin" })).error?.includes("لا يمكنك حذف حسابك"));
check("قائمة الأسماء تظهر الاثنين", (await post({ action: "people", token: T })).people.length === 2);

/* ===== 4. مزامنة الأقسام: الأحدث يفوز ===== */
console.log("\n[4] المزامنة العامة");
const tr = (id, name, at) => ({ id, name, updatedAt: at });
let r = await post({ action: "syncAll", token: T, cols: { tracks: { records: [tr("t1", "الحلاقة", iso(50000)), tr("t2", "التطريز", iso(50000))], deleted: {} } } });
check("رُفع مساران", r.tracks.records.length === 2, r.tracks.records);

r = await post({ action: "syncAll", token: S, cols: { tracks: { records: [tr("t1", "اسم أقدم", iso(90000))], deleted: {} } } });
check("التعديل الأقدم لا يفوز", r.tracks.records.find((x) => x.id === "t1").name === "الحلاقة");

r = await post({ action: "syncAll", token: S, cols: { tracks: { records: [tr("t1", "الحلاقة الرجالية", iso(100))], deleted: {} } } });
check("التعديل الأحدث يفوز", r.tracks.records.find((x) => x.id === "t1").name === "الحلاقة الرجالية");

r = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: {} } } });
check("القراءة بلا تغييرات تعيد القسم كاملاً", r.tracks.records.length === 2);

/* ===== 5. الحذف ومنع عودة المحذوف (العلّة التي أوجعتنا سابقاً) ===== */
console.log("\n[5] الحذف ومنع القيامة");
const delAt = new Date().toISOString();
r = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: { t2: delAt } } } });
check("حُذف المسار t2", !r.tracks.records.some((x) => x.id === "t2") && r.tracks.deleted.t2 === delAt);

r = await post({ action: "syncAll", token: S, cols: { tracks: { records: [tr("t2", "التطريز", new Date(Date.now() + 60000).toISOString())], deleted: {} } } });
check("جهاز قديم لا يُعيد المحذوف خلال 24 ساعة", !r.tracks.records.some((x) => x.id === "t2"), r.tracks.records);

r = await post({ action: "syncAll", token: S, cols: { tracks: { records: [tr("t2", "التطريز من جديد", new Date(Date.now() + 25 * 3600 * 1000).toISOString())], deleted: {} } } });
check("إنشاء حقيقي بعد 24 ساعة يعود", r.tracks.records.some((x) => x.id === "t2" && x.name === "التطريز من جديد"));

/* ===== 6. سجل الوارد والصادر: ملكية القيد ===== */
console.log("\n[6] ملكية قيود الوارد والصادر");
const reg = (id, extra, at) => ({ id, number: "م ت/2026/001", subject: "طلب", updatedAt: at, ...extra });
r = await post({ action: "sync", token: S, records: [reg("r1", {}, iso(5000))], deleted: {} });
check("القيد يُنسب لصاحبه تلقائياً", r.records[0].owner === "سارة", r.records[0]);

r = await post({ action: "sync", token: T, records: [reg("r2", {}, iso(5000))], deleted: {} });
check("قيد المدير باسمه", r.records.find((x) => x.id === "r2").owner === "شادي");

// مستخدم ثالث غير مدير يحاول تعديل قيد سارة
await post({ action: "saveUser", token: T, user: { username: "omar", name: "عمر", password: "omar1234" } });
const O = (await post({ action: "login", username: "omar", password: "omar1234" })).token;
r = await post({ action: "sync", token: O, records: [reg("r1", { subject: "اختراق" }, iso(10))], deleted: {} });
check("لا يعدّل قيد غيره", r.records.find((x) => x.id === "r1").subject === "طلب");

r = await post({ action: "sync", token: O, records: [reg("r1", { replyId: "r9", replyNumber: "م ت/2026/009" }, iso(5))], deleted: {} });
const r1 = r.records.find((x) => x.id === "r1");
check("لكنه يربط ردّه على القيد", r1.replyId === "r9" && r1.subject === "طلب" && r1.done === true, r1);

r = await post({ action: "sync", token: O, records: [], deleted: { r1: new Date().toISOString() } });
check("ولا يحذف قيد غيره", r.records.some((x) => x.id === "r1"));

r = await post({ action: "sync", token: T, records: [], deleted: { r1: new Date().toISOString() } });
check("والمدير يحذف أي قيد", !r.records.some((x) => x.id === "r1"));

/* ===== 7. حجز الأرقام ===== */
console.log("\n[7] حجز أرقام الصادر");
const a1 = await post({ action: "reserve", token: T, head: "م ت/2026/", count: 1 });
check("الرقم يبدأ بعد أعلى رقم مستعمل", a1.number === "م ت/2026/002", a1);
const a2 = await post({ action: "reserve", token: S, head: "م ت/2026/", count: 3 });
check("حجز متعدد متتابع بلا تكرار", a2.numbers.join(",") === "م ت/2026/003,م ت/2026/004,م ت/2026/005", a2);
const both = await Promise.all([post({ action: "reserve", token: T, head: "خ/", count: 1 }), post({ action: "reserve", token: S, head: "خ/", count: 1 })]);
check("طلبان متزامنان لا يأخذان الرقم نفسه", both[0].number !== both[1].number, both.map((x) => x.number));

/* ===== 8. الملفات ===== */
console.log("\n[8] الملفات");
const up = await post({ action: "upload", token: S, name: "خطاب.pdf", mime: "application/pdf", path: ["سارة", "2026", "09", "الوارد"], data: Buffer.from("مرحبا").toString("base64") });
check("رُفع الملف وعاد معرّفه", !!up.id && up.id.includes("سارة/2026/09/الوارد/"), up);
const got = await post({ action: "file", token: T, id: up.id });
check("ونُزّل بمحتواه", Buffer.from(got.data, "base64").toString("utf8") === "مرحبا" && got.name === "خطاب.pdf", got);
check("ملف غير موجود يعطي رسالة واضحة", (await post({ action: "file", token: T, id: "لا-يوجد" })).error?.includes("غير موجود"));
check("البحث يجد الملف باسمه", (await post({ action: "search", token: T, q: "خطاب" })).ids.includes(up.id));

/* ===== 9. السجل والنسخ الاحتياطية ===== */
console.log("\n[9] سجل الأحداث");
const ev = await post({ action: "events", token: T, days: 2, limit: 50 });
check("الدخول مسجَّل", ev.events.some((e) => e.action === "دخول"));
check("رفع الملف مسجَّل باسم صاحبه", ev.events.some((e) => e.action === "رفع ملف" && e.user === "سارة"), ev.events.slice(0, 3));
check("القراءة فقط لا تُسجَّل", !ev.events.some((e) => e.action === "ping"));
const bk = await post({ action: "backups", token: T });
check("أُنشئت نسخة احتياطية يومية", bk.backups.length === 1 && bk.backups[0].name.startsWith("نسخة "), bk.backups);

/* ===== 10. تغيير كلمة المرور والخروج ===== */
console.log("\n[10] كلمة المرور والجلسات");
check("كلمة حالية خاطئة تُرفض", (await post({ action: "password", token: S, current: "غلط", password: "new12345" })).error?.includes("الحالية غير صحيحة"));
check("كلمة قصيرة تُرفض", (await post({ action: "password", token: S, current: "sara1234", password: "123" })).error?.includes("6 أحرف"));
check("تغيير كلمة المرور ينجح", (await post({ action: "password", token: S, current: "sara1234", password: "sara9999" })).ok === true);
check("الجلسة القديمة ما زالت صالحة", (await post({ action: "ping", token: S })).ok === true);
check("الدخول بالكلمة الجديدة", !!(await post({ action: "login", username: "sara", password: "sara9999" })).token);
check("إيقاف الحساب يُخرجه من كل الأجهزة", (await post({ action: "saveUser", token: T, user: { username: "sara", name: "سارة", active: false } })).user.active === false
  && (await post({ action: "ping", token: S })).error === "UNAUTHORIZED");

/* ===== 11. ما ليس متاحاً على النسخة التجريبية ===== */
console.log("\n[11] حدود النسخة التجريبية");
check("القراءة الضوئية ترد برسالة مفهومة", (await post({ action: "ocr", token: T, data: "" })).error?.includes("غير متاحة"));
check("إجراء غير معروف", (await post({ action: "بلا", token: T })).error === "إجراء غير معروف");

/* ===== 12. ناقل الحسابات ===== */
console.log("\n[12] نقل الحسابات بين الخادمين");
/* حساب كما يُصدّره خادم Apps Script: بصمة 300 دورة SHA-256 */
async function gas300(password, salt) {
  const enc = new TextEncoder();
  const b64 = (b) => Buffer.from(b).toString("base64");
  let h = salt + "|" + password;
  for (let i = 0; i < 300; i++) h = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(h + salt))));
  return h;
}
const oldSalt = "salt-from-apps-script";
const legacy = {
  username: "huda", name: "هدى", email: "h@x.com", admin: false, active: true,
  salt: oldSalt, hash: await gas300("huda1234", oldSalt), algo: "gas300",
  views: ["registry", "roster"], perms: { upload: true, delete: false },
};
check("غير المدير لا يصدّر الحسابات", (await post({ action: "exportUsers", token: O })).error === "هذا الإجراء للمدير فقط");
const imp = await post({ action: "importUsers", token: T, users: [legacy] });
check("استُوردت هدى", imp.added === 1 && imp.skipped.length === 0, imp);
const huda = await post({ action: "login", username: "huda", password: "huda1234" });
check("تدخل بكلمتها القديمة نفسها", !!huda.token, huda);
check("وصلاحياتها انتقلت معها", huda.user && huda.user.views.join(",") === "registry,roster" && huda.user.perms.upload === true, huda.user);
check("وكلمة خاطئة ما زالت تُرفض", (await post({ action: "login", username: "huda", password: "huda9999" })).error.includes("غير صحيحة"));

const again = await post({ action: "importUsers", token: T, users: [legacy] });
check("إعادة الاستيراد لا تستبدل الموجود", again.added === 0 && again.skipped[0].why === "موجود مسبقاً", again);
check("حساب ناقص يُتخطّى بسبب مفهوم", (await post({ action: "importUsers", token: T, users: [{ username: "زائف" }] })).skipped[0].why === "بيانات ناقصة");

const exported = await post({ action: "exportUsers", token: T });
const back = exported.users.find((u) => u.username === "huda");
check("التصدير يعيد البصمة لا كلمة المرور", !!back.hash && !!back.salt && back.password === undefined, Object.keys(back));
check("وكلمتها رُقّيت تلقائياً بعد أول دخول", back.algo === "pbkdf2", back.algo);
check("والتصدير يشمل كل الحسابات", exported.users.length >= 4, exported.users.map((u) => u.username));

console.log(`\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
