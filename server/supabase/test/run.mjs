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

// حالة يزن: المدير يعدّل صفحات مستخدم موجود دون تغيير كلمة مروره
const grant = await post({ action: "saveUser", token: T, user: { username: "sara", name: "سارة", views: ["registry", "roster", "meetings"], perms: { upload: true, delete: false } } });
check("تعديل صفحات مستخدم موجود بلا كلمة مرور يُحفظ", !grant.error && grant.user.views.join(",") === "registry,roster,meetings", grant);
const saraAgain = await post({ action: "login", username: "sara", password: "sara1234" });
check("ويظهر له عند الدخول دون أن تتغيّر كلمة مروره", !!saraAgain.token && saraAgain.user.views.includes("meetings") && saraAgain.user.perms.delete === false, saraAgain);
const pingSara = await post({ action: "ping", token: saraAgain.token });
check("والتحديث بعد الدخول يعيد الصفحات نفسها", pingSara.user.views.join(",") === "registry,roster,meetings", pingSara.user);

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
check("رُفع ملف باسم ومجلد عربيين", !!up.id, up);
check("ومفتاحه في التخزين لاتيني خالص", /^[\x20-\x7e]+$/.test(up.id) && up.id.endsWith(".pdf"), up.id);
check("والمجلد العربي محفوظ في جدول الملفات", globalThis.__fakeDb._tables.files.some((f) => f.id === up.id && f.folder === "سارة/2026/09/الوارد"));
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
check("أُنشئت نسخة احتياطية يومية", bk.backups.length === 1 && bk.backups[0].name.startsWith("backup-"), bk.backups);

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
check("القراءة الضوئية بلا مساعد ترد برسالة مفهومة", (await post({ action: "ocr", token: T, data: "" })).error?.includes("مساعد Google"));
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

/* ===== 13. اعتماد بيانات جهاز (نقل بين الخوادم) ===== */
console.log("\n[13] اعتماد بيانات جهاز");
// مسار محذوف للتوّ: المزامنة العادية ترفض إعادته، والاعتماد يقبلها
const gone = { id: "t9", name: "مسار محذوف", updatedAt: new Date().toISOString() };
await post({ action: "syncAll", token: T, cols: { tracks: { records: [gone], deleted: {} } } });
await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: { t9: new Date().toISOString() } } } });
let revived = await post({ action: "syncAll", token: T, cols: { tracks: { records: [{ ...gone, updatedAt: new Date().toISOString() }], deleted: {} } } });
check("المزامنة العادية ترفض إعادة المحذوف", !revived.tracks.records.some((x) => x.id === "t9"));

check("غير المدير لا يعتمد بيانات", (await post({ action: "adopt", token: O, cols: {} })).error === "هذا الإجراء للمدير فقط");

const ad = await post({ action: "adopt", token: T, cols: {
  tracks: { records: [gone, { id: "t10", name: "مسار جديد", updatedAt: new Date().toISOString() }] },
  registry: { records: [{ id: "g1", number: "ج/001", subject: "منقول", updatedAt: new Date().toISOString() }] },
} });
check("اعتُمدت الأقسام بأعدادها", ad.adopted.tracks === 2 && ad.adopted.registry === 1, ad);

const after = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: {} } } });
check("المحذوف عاد بعد الاعتماد", after.tracks.records.some((x) => x.id === "t9"), after.tracks.records.map((x) => x.id));
check("وشاهد الحذف أُزيل", !after.tracks.deleted.t9);
const moved = await post({ action: "sync", token: T, records: [], deleted: {} });
check("وسجل الوارد والصادر استُقبل", moved.records.some((r) => r.id === "g1"));
check("والقيد المنقول نُسب لصاحبه", moved.records.find((r) => r.id === "g1").owner === "شادي");
check("الاعتماد مسجّل في الأحداث", (await post({ action: "events", token: T, days: 1, limit: 80 })).events.some((e) => e.action === "اعتماد بيانات جهاز"));

/* ===== 14. النقل الكامل: وضع الاستبدال ===== */
console.log("\n[14] النقل الكامل (استبدال)");
// على الخادم مسارات زائدة وشاهد حذف قديم، كما حدث أمس
await post({ action: "syncAll", token: T, cols: { tracks: { records: [
  { id: "dup1", name: "مكرر", updatedAt: new Date().toISOString() },
  { id: "dup2", name: "مكرر", updatedAt: new Date().toISOString() },
], deleted: { r77: new Date().toISOString() } } } });
const before14 = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: {} } } });
check("قبل النقل: المكررات والشاهد موجودة", before14.tracks.records.some((x) => x.id === "dup1") && !!before14.tracks.deleted.r77);

const eight = Array.from({ length: 8 }, (_, i) => ({ id: "k" + i, name: "مسار " + i, updatedAt: new Date().toISOString() }));
const rep = await post({ action: "adopt", token: T, replace: true, cols: { tracks: { records: eight }, meetings: { records: [] } } });
check("الاستبدال كتب 8 مسارات", rep.adopted.tracks === 8, rep);
check("وحذف كل ما ليس في المُرسَل", rep.removed.tracks > 0, rep.removed);
const after14 = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: {} } } });
check("القسم صار نسخة مطابقة تماماً", after14.tracks.records.map((x) => x.id).sort().join() === eight.map((x) => x.id).sort().join(), after14.tracks.records.map((x) => x.id));
check("وشواهد الحذف القديمة مُسحت", !Object.keys(after14.tracks.deleted).length, after14.tracks.deleted);
const other = await post({ action: "sync", token: T, records: [], deleted: {} });
check("والأقسام غير المُرسَلة لم تُمسّ", other.records.some((r) => r.id === "g1"));

const up14 = await post({ action: "upload", token: T, name: "م.pdf", mime: "application/pdf", path: ["شادي"], data: Buffer.from("x").toString("base64") });
check("رابط الملف دائم لا ينتهي", up14.link === "supabase:" + up14.id && up14.folderId === "", up14);

/* ===== 15. النسخة الخارجية على Drive والاستعادة ===== */
console.log("\n[15] النسخ إلى Drive والاستعادة");
check("رمز نسخ خاطئ يُرفض", (await post({ action: "driveSnapshot", key: "nope" })).error === "رمز النسخ غير صحيح");
const snap15 = await post({ action: "driveSnapshot", key: "SECRET123" });
check("اللقطة فيها الأقسام والحسابات والملفات", !!snap15.data.tracks && snap15.users.length >= 1 && snap15.files.some((f) => f.id === up14.id), Object.keys(snap15));
const urls15 = await post({ action: "driveFileUrls", key: "SECRET123", ids: [up14.id] });
check("رابط موقّع لكل ملف", !!urls15.urls[up14.id], urls15);
await post({ action: "driveDone", key: "SECRET123", info: { ok: true, files: 1 } });
check("آخر نسخة Drive تظهر في لوحة المدير", (await post({ action: "backups", token: T })).drive.files === 1);

// نسخة يوم سابق فيها مسار حُذف اليوم
const day15 = "2026-01-15";
const blob15 = new Blob([JSON.stringify({ tracks: { records: [{ id: "lost1", name: "مفقود", updatedAt: "2026-01-15T10:00:00Z" }, { id: "k0", name: "قديم" }], deleted: {} } })]);
await globalThis.__fakeDb.storage.from("tamkeen-backups").upload(`backup-${day15}.json`, blob15, { upsert: true });
const days15 = await post({ action: "backupDays", token: T });
check("أيام النسخ تظهر بعدد سجلاتها", days15.days.some((d) => d.day === day15 && d.records === 2), days15);
const res15 = await post({ action: "restoreDay", token: T, day: day15 });
check("استُعيد الناقص فقط", res15.restored.tracks === 1, res15);
const after15 = await post({ action: "syncAll", token: T, cols: { tracks: { records: [], deleted: {} } } });
check("المفقود عاد والموجود لم يُستبدل", after15.tracks.records.some((x) => x.id === "lost1") && after15.tracks.records.find((x) => x.id === "k0").name === "مسار 0");
check("غير المدير لا يستعيد", (await post({ action: "restoreDay", token: (await post({ action: "saveUser", token: T, user: { username: "omar15", name: "o", password: "omar1234" } }), await post({ action: "login", username: "omar15", password: "omar1234" })).token, day: day15 })).error === "هذا الإجراء للمدير فقط");

/* ===== 16. سجل التعديلات والتراجع، ومساعد Google ===== */
console.log("\n[16] سجل التعديلات والتراجع ومساعد Google");
const ts = (m) => new Date(Date.now() + m * 1000).toISOString();
await post({ action: "syncAll", token: T, cols: { tasks: { records: [{ id: "h1", text: "أصل", updatedAt: ts(1) }], deleted: {} } } });
await post({ action: "syncAll", token: T, cols: { tasks: { records: [{ id: "h1", text: "معدّل", updatedAt: ts(2) }], deleted: {} } } });
await post({ action: "syncAll", token: T, cols: { tasks: { records: [{ id: "h1", text: "معدّل", updatedAt: (globalThis.last16 = ts(3)) }], deleted: {} } } });
let h16 = (await post({ action: "history", token: T, col: "tasks", recId: "h1" })).revisions;
check("الإضافة والتعديل مسجّلان، ولمس الوقت وحده لا يُسجَّل", h16.length === 2 && h16[0].action === "edit" && h16[1].action === "add", h16.map((r) => r.action));
check("التعديل يحفظ القيمة قبله وبعده", h16[0].before.text === "أصل" && h16[0].after.text === "معدّل" && h16[0].who === "شادي", h16[0]);

const editId = h16[0].id;
const rv = await post({ action: "revert", token: T, revId: editId });
check("التراجع أعاد القيمة السابقة", rv.restored === true, rv);
let t16 = (await post({ action: "syncAll", token: T, cols: { tasks: { records: [], deleted: {} } } })).tasks.records.find((x) => x.id === "h1");
check("والقيد صار «أصل» بوقت جديد", t16.text === "أصل" && t16.updatedAt > globalThis.last16, t16);
h16 = (await post({ action: "history", token: T, col: "tasks", recId: "h1" })).revisions;
check("التراجع نفسه مسجّل ويشير إلى الأصل", h16[0].action === "revert" && h16[0].ref === editId, h16[0]);

await post({ action: "syncAll", token: T, cols: { tasks: { records: [], deleted: { h1: ts(10) } } } });
h16 = (await post({ action: "history", token: T, col: "tasks", recId: "h1" })).revisions;
check("الحذف مسجّل بقيمته", h16[0].action === "delete" && h16[0].before.text === "أصل", h16[0]);
await post({ action: "revert", token: T, revId: h16[0].id });
t16 = (await post({ action: "syncAll", token: T, cols: { tasks: { records: [], deleted: {} } } })).tasks;
check("التراجع عن الحذف أعاد القيد وأزال شاهد الحذف", t16.records.some((x) => x.id === "h1") && !t16.deleted.h1);

await post({ action: "syncAll", token: T, cols: { tasks: { records: [{ id: "h2", text: "جديد", updatedAt: ts(20) }], deleted: {} } } });
const add16 = (await post({ action: "history", token: T, col: "tasks", recId: "h2" })).revisions[0];
await post({ action: "revert", token: T, revId: add16.id });
t16 = (await post({ action: "syncAll", token: T, cols: { tasks: { records: [], deleted: {} } } })).tasks;
check("التراجع عن إضافة يحذفها", !t16.records.some((x) => x.id === "h2") && !!t16.deleted.h2);

await post({ action: "saveUser", token: T, user: { username: "lina16", name: "لينا", password: "lina1234" } });
const L = (await post({ action: "login", username: "lina16", password: "lina1234" })).token;
check("المستخدم لا يرى تعديلات غيره", (await post({ action: "history", token: L })).revisions.length === 0);
check("ولا يتراجع عنها", (await post({ action: "revert", token: L, revId: add16.id })).error === "تستطيع التراجع عن تعديلاتك أنت فقط");
await post({ action: "syncAll", token: L, cols: { tasks: { records: [{ id: "h3", text: "للينا", updatedAt: ts(30) }], deleted: {} } } });
check("ويرى تعديلاته هو", (await post({ action: "history", token: L })).revisions.some((r) => r.rec_id === "h3"));

// مساعد Google
check("رابط مساعد غير صحيح لا يُحفظ", (await post({ action: "helperHello", key: "SECRET123", url: "https://evil.example/exec" })).helper === false);
const HURL = "https://script.google.com/macros/s/AKfy-test_1/exec";
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ error: "UNAUTHORIZED" })); // الخادم القديم لم يُحدَّث بعد
check("رابط لا يخدم المساعد يُرفض", (await post({ action: "helperHello", key: "SECRET123", url: HURL })).helper === false);
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, name: "مساعد Google لمساعد تمكين" }));
check("رابط المساعد المتحقَّق منه يُحفظ", (await post({ action: "helperHello", key: "SECRET123", url: HURL })).helper === true);
globalThis.fetch = realFetch;
let sent16 = null;
globalThis.fetch = async (url, init) => { sent16 = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ text: "نص مقروء" })); };
const o16 = await post({ action: "ocr", token: T, data: "QUJD", mime: "application/pdf", name: "خطاب" });
globalThis.fetch = realFetch;
check("القراءة الضوئية تمرّ عبر المساعد بالرمز", o16.text === "نص مقروء" && sent16.url === HURL && sent16.body.key === "SECRET123" && sent16.body.action === "ocr", { o16, sent16 });

check("الملخص المعطّل لا يعيد بيانات", (await post({ action: "digestData", key: "SECRET123" })).enabled === false);
await post({ action: "syncAll", token: T, cols: { tasks: { records: [{ id: "d1", text: "مستحقة", dueDate: "2026-01-01", owner: "شادي", done: false, updatedAt: ts(40) }], deleted: {} } } });
const dg = await post({ action: "digest", token: T, enabled: true, hour: 8 });
check("تفعيل الملخص يُحفظ", dg.enabled === true && dg.hour === 8 && !dg.error, dg);
const dd = await post({ action: "digestData", key: "SECRET123" });
check("بيانات الملخص فيها المهام المستحقة", dd.enabled && dd.hour === 8 && dd.lateTasks.some((t) => t.text === "مستحقة"), dd);
check("بيانات الملخص تحتاج الرمز", (await post({ action: "digestData", key: "x" })).error === "رمز النسخ غير صحيح");

/* ===== 17. الإحالة في الوارد ===== */
console.log("\n[17] الإحالة في الوارد");
const A = (await post({ action: "login", username: "lina16", password: "lina1234" })).token;
await post({ action: "sync", token: T, records: [{ id: "as1", type: "in", number: "و/1", subject: "محال", assignee: "لينا", dueDate: "2026-01-01", done: false, updatedAt: ts(50) }], deleted: {} });
let as = (await post({ action: "sync", token: A, records: [{ id: "as1", type: "in", number: "و/1", subject: "غيّرته", assignee: "لينا", dueDate: "2026-01-01", done: true, updatedAt: ts(51) }], deleted: {} })).records.find((r) => r.id === "as1");
check("المحال إليه يعلّم «تمت المعالجة»", as.done === true, as);
check("ولا يغيّر باقي القيد", as.subject === "محال" && as.owner === "شادي", as);
await post({ action: "sync", token: T, records: [{ id: "as2", type: "in", number: "و/2", subject: "غير محال", done: false, updatedAt: ts(52) }], deleted: {} });
as = (await post({ action: "sync", token: A, records: [{ id: "as2", type: "in", number: "و/2", done: true, updatedAt: ts(53) }], deleted: {} })).records.find((r) => r.id === "as2");
check("غير المحال إليه لا يستطيع", as.done === false, as);
await post({ action: "sync", token: T, records: [{ id: "as3", type: "in", number: "و/3", subject: "للمتابعة", assignee: "لينا", dueDate: "2026-01-01", done: false, updatedAt: ts(54) }], deleted: {} });
const dd17 = await post({ action: "digestData", key: "SECRET123" });
check("الملخص ينسب الوارد المحال إلى المحال إليه", dd17.lateIn.some((r) => r.number === "و/3" && r.owner === "لينا"), dd17.lateIn);

console.log(`\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
