/* خادم مساعد تمكين على Supabase — دالة طرفية واحدة (Edge Function) تتكلم البروتوكول نفسه
   الذي يتكلمه خادم Apps Script، حرفياً: طلب POST فيه { token, action, ... } والرد JSON.
   لذلك لا يتغيّر أي سطر في الموقع؛ يكفي تغيير الرابط في إعدادات الأداة.

   الفرق الجوهري عن النسخة القديمة: كل قيد صفٌّ مستقل في Postgres، فلا قفل عام على ملف واحد،
   ولا «الخادم مشغول بمزامنة أخرى»، والتعديلات المتزامنة من عدة مستخدمين تمرّ معاً.

   النشر: Supabase ← Edge Functions ← Deploy a new function ← الاسم tamkeen ← ألصق هذا الملف
          ثم أوقف «Verify JWT» لأن التحقق عندنا برمز الجلسة لا بمفتاح Supabase. */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* مفتاح الخدمة: المشاريع القديمة تضع SUPABASE_SERVICE_ROLE_KEY،
   والجديدة تضع SUPABASE_SECRET_KEYS (خريطة JSON). نقبل الاثنين. */
function serviceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const map = JSON.parse(raw);
      return map.default || Object.values(map)[0] as string;
    } catch { /* تنسيق غير متوقّع */ }
  }
  throw new Error("مفتاح خدمة Supabase غير متاح للدالة");
}

/* المفتاح العام لقناة البث الفوري: مصمّم ليُستعمل في المتصفح، ولا يصل إلى الجداول (مقفلة بـ RLS) */
function publicKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const map = JSON.parse(raw);
      return (map.default || Object.values(map)[0]) as string;
    } catch { /* تنسيق غير متوقّع */ }
  }
  return "";
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  serviceKey(),
  { auth: { persistSession: false } },
);

const VERSION = 29;
const SESSION_DAYS = 30;
const RESURRECT_MS = 24 * 3600 * 1000;
const TOMBSTONE_DAYS = 90;   // شواهد الحذف تُنظّف بعدها
const BUCKET = "tamkeen";
const BACKUP_BUCKET = "tamkeen-backups";
const BACKUP_KEEP = 30;
const REVISION_DAYS = 180;   // سجل التعديلات يُحتفظ به ستة أشهر

/* ===== أدوات ===== */
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const norm = (u: unknown) => String(u ?? "").trim().toLowerCase();
const stampOf = (r: any) => r?.updatedAt || r?.createdAt || "";

/* مقارنة لا تكشف طول التطابق من زمن التنفيذ */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

/* ===== كلمات المرور =====
   الحسابات الجديدة: PBKDF2 بـ 150 ألف دورة (أقوى بكثير من القديم).
   الحسابات المنقولة من Apps Script: نفس خوارزميتها (300 دورة SHA-256) حتى تعمل كلماتها كما هي،
   وتُرقّى تلقائياً إلى PBKDF2 عند أول دخول ناجح. */
async function sha256b64(s: string) {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

async function gas300(password: string, salt: string) {
  let h = salt + "|" + password;
  for (let i = 0; i < 300; i++) h = await sha256b64(h + salt);
  return h;
}

async function pbkdf2(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 150000, hash: "SHA-256" },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

const hashWith = (algo: string, password: string, salt: string) =>
  algo === "gas300" ? gas300(password, salt) : pbkdf2(password, salt);

function checkPassword(password: unknown) {
  if (String(password ?? "").length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
}

const publicUser = (u: any) => ({
  username: u.username,
  name: u.name,
  email: u.email || "",
  admin: !!u.admin,
  active: u.active !== false,
  lastLogin: u.last_login || "",
  views: u.views || [],
  perms: u.perms || {},
});

async function getUser(username: string) {
  const { data } = await db.from("app_users").select("*").eq("username", norm(username)).maybeSingle();
  return data;
}

/* ===== الدخول والجلسات ===== */
async function login(username: unknown, password: unknown) {
  const u = await getUser(String(username ?? ""));
  const given = String(password ?? "");
  // رسالة واحدة للحالتين حتى لا يُكشف وجود اسم المستخدم
  const fail = () => new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  if (!u || u.active === false) {
    await new Promise((r) => setTimeout(r, 800));
    throw fail();
  }
  const computed = await hashWith(u.algo, given, u.salt);
  if (!sameSecret(computed, u.hash)) {
    await new Promise((r) => setTimeout(r, 800));
    throw fail();
  }
  // ترقية صامتة لكلمات المرور المنقولة من الخادم القديم
  if (u.algo === "gas300") {
    const salt = crypto.randomUUID();
    await db.from("app_users").update({ algo: "pbkdf2", salt, hash: await pbkdf2(given, salt) }).eq("username", u.username);
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.from("sessions").insert({ token, username: u.username, expires_at: expires });
  await db.from("app_users").update({ last_login: new Date().toISOString() }).eq("username", u.username);
  await db.from("sessions").delete().lt("expires_at", new Date().toISOString());
  return { token, user: publicUser(u) };
}

async function session(token: unknown) {
  if (!token) return null;
  const { data: s } = await db.from("sessions").select("username, expires_at").eq("token", String(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = await getUser(s.username);
  return u && u.active !== false ? u : null;
}

/* إنشاء أول حساب مدير برمز المدير — مرة واحدة فقط */
async function setup(req: any) {
  const adminKey = Deno.env.get("ADMIN_KEY") || "";
  const { count } = await db.from("app_users").select("username", { count: "exact", head: true });
  if (count) throw new Error("يوجد حساب مدير مسبقاً؛ سجّل الدخول به");
  if (!adminKey || req.adminKey !== adminKey) throw new Error("رمز المدير غير صحيح");
  const username = norm(req.username);
  if (username.length < 3) throw new Error("اسم المستخدم 3 أحرف على الأقل");
  checkPassword(req.password);
  const salt = crypto.randomUUID();
  await db.from("app_users").insert({
    username,
    name: String(req.name || username).trim(),
    email: String(req.email || "").trim(),
    admin: true,
    active: true,
    algo: "pbkdf2",
    salt,
    hash: await pbkdf2(String(req.password), salt),
  });
  return await login(req.username, req.password);
}

async function changePassword(user: any, current: unknown, password: unknown) {
  const computed = await hashWith(user.algo, String(current ?? ""), user.salt);
  if (!sameSecret(computed, user.hash)) throw new Error("كلمة المرور الحالية غير صحيحة");
  checkPassword(password);
  const salt = crypto.randomUUID();
  await db.from("app_users").update({ algo: "pbkdf2", salt, hash: await pbkdf2(String(password), salt) }).eq("username", user.username);
  return { ok: true };
}

async function saveUser(data: any, by: any) {
  const username = norm(data?.username);
  if (username.length < 3) throw new Error("اسم المستخدم 3 أحرف على الأقل");
  const existing = await getUser(username);
  if (!existing && !data.password) throw new Error("كلمة المرور مطلوبة للمستخدم الجديد");
  if (username === by.username && (data.admin === false || data.active === false)) {
    throw new Error("لا يمكنك إلغاء صلاحيتك أو إيقاف حسابك بنفسك");
  }
  const row: Record<string, unknown> = {
    username,
    name: String(data.name || existing?.name || username).trim(),
    admin: !!data.admin,
    active: data.active !== false,
  };
  if (data.email !== undefined) row.email = String(data.email || "").trim();
  if (data.views !== undefined) row.views = (data.views || []).map(String).slice(0, 40);
  if (data.perms !== undefined) row.perms = data.perms || {};
  if (data.password) {
    checkPassword(data.password);
    row.algo = "pbkdf2";
    row.salt = crypto.randomUUID();
    row.hash = await pbkdf2(String(data.password), row.salt as string);
  }
  if (!existing) row.email = row.email ?? "";
  // تعديل مستخدم موجود تحديثٌ صريح: «إدراج أو تحديث» يفحص فيه Postgres الأعمدة الإلزامية
  // (الملح وبصمة كلمة المرور) قبل أن يعرف أنه تحديث، فيفشل كل تعديل بلا كلمة مرور جديدة
  const { error } = existing
    ? await db.from("app_users").update(row).eq("username", username)
    : await db.from("app_users").insert(row);
  if (error) throw new Error(error.message);
  // كلمة مرور جديدة أو إيقاف الحساب: خروج من كل الأجهزة
  if (data.password || data.active === false) await db.from("sessions").delete().eq("username", username);
  return { user: publicUser(await getUser(username)) };
}

async function deleteUser(username: unknown, by: any) {
  const name = norm(username);
  if (name === by.username) throw new Error("لا يمكنك حذف حسابك بنفسك");
  await db.from("app_users").delete().eq("username", name);
  return { ok: true };
}

/* تصدير الحسابات لنقلها إلى خادم آخر: تُنقل بصمة كلمة المرور لا الكلمة نفسها */
async function exportUsers() {
  const { data } = await db.from("app_users").select("*").order("username");
  return {
    users: (data || []).map((u: any) => ({
      username: u.username, name: u.name, email: u.email || "", admin: !!u.admin,
      active: u.active !== false, salt: u.salt, hash: u.hash, algo: u.algo,
      views: u.views || [], perms: u.perms || {}, lastLogin: u.last_login || "",
    })),
  };
}

/* استيراد حسابات من خادم آخر: الموجود لا يُستبدل، وحساب المستورِد لا يُمسّ.
   يقبل تشفير Apps Script (gas300) كما هو، فيدخل كل مستخدم بكلمته القديمة،
   وتُرقّى كلمته تلقائياً إلى PBKDF2 عند أول دخول ناجح. */
async function importUsers(list: any[], by: any) {
  if (!Array.isArray(list) || !list.length) throw new Error("لا توجد حسابات في الملف");
  const { data: existing } = await db.from("app_users").select("username");
  const have = new Set((existing || []).map((u: any) => u.username));
  const skipped: any[] = [];
  const rows: any[] = [];
  for (const u of list) {
    const username = norm(u?.username);
    if (username.length < 3 || !u.salt || !u.hash) { skipped.push({ username: u?.username || "?", why: "بيانات ناقصة" }); continue; }
    if (have.has(username)) { skipped.push({ username, why: "موجود مسبقاً" }); continue; }
    const algo = u.algo === "pbkdf2" ? "pbkdf2" : "gas300";
    rows.push({
      username, name: String(u.name || username).trim(), email: String(u.email || "").trim(),
      admin: !!u.admin, active: u.active !== false, salt: u.salt, hash: u.hash, algo,
      views: u.views || [], perms: u.perms || {},
    });
    have.add(username);
  }
  if (rows.length) {
    const { error } = await db.from("app_users").insert(rows);
    if (error) throw new Error(error.message);
  }
  await log(by.name, "استيراد حسابات", `أُضيف ${rows.length}، وتُخطّي ${skipped.length}`);
  return { added: rows.length, skipped };
}

/* نسيت كلمة المرور: يحتاج مفتاح Resend للإرسال؛ بدونه يُنبَّه المستخدم لمراجعة المدير */
async function forgot(username: unknown) {
  const answer = { ok: true, message: "إن كان الحساب موجوداً وله بريد مسجّل فسيصلك رمز خلال دقائق." };
  const u = await getUser(String(username ?? ""));
  if (!u || !u.email || u.active === false) return answer;
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: true, message: "استعادة كلمة المرور بالبريد غير مفعّلة على هذا الخادم؛ اطلب من المدير تعيين كلمة مرور جديدة." };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.from("resets").upsert({ username: u.username, code, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") || "onboarding@resend.dev",
      to: u.email,
      subject: "مساعد تمكين: رمز استعادة كلمة المرور",
      html: `<div dir="rtl" style="font-family:Tahoma,Arial"><p>مرحباً ${u.name},</p>
        <p>رمز استعادة كلمة المرور: <b style="font-size:20px;letter-spacing:3px">${code}</b></p>
        <p>الرمز صالح 30 دقيقة. إن لم تطلبه فتجاهل الرسالة.</p></div>`,
    }),
  }).catch(() => {/* الفشل لا يكشف وجود الحساب */});
  return answer;
}

async function resetPassword(username: unknown, code: unknown, password: unknown) {
  const name = norm(username);
  const { data: saved } = await db.from("resets").select("*").eq("username", name).maybeSingle();
  if (!saved || new Date(saved.expires_at).getTime() < Date.now() || String(code ?? "").trim() !== saved.code) {
    throw new Error("الرمز غير صحيح أو منتهي الصلاحية");
  }
  checkPassword(password);
  const salt = crypto.randomUUID();
  await db.from("app_users").update({ algo: "pbkdf2", salt, hash: await pbkdf2(String(password), salt) }).eq("username", name);
  await db.from("resets").delete().eq("username", name);
  await db.from("sessions").delete().eq("username", name);
  return await login(name, password);
}

/* ===== المزامنة =====
   القاعدة كما هي في الخادم القديم: الأحدث تعديلاً يفوز، والمحذوف حديثاً لا يعود،
   والفرق أن الدمج يجري على الصفوف المعنية فقط بلا قفل على القسم كله. */
function resurrects(rec: any, delAt: string) {
  if (!delAt) return false;
  const t = Date.parse(stampOf(rec));
  const d = Date.parse(delAt);
  return !(t && d) || t - d < RESURRECT_MS;
}

/* ===== دمج الخانات (قائمة المستفيدين) =====
   كل خانة في values لها وقت تعديلها في valuesAt؛ تُؤخذ الأحدث لكل خانة على حدة.
   خانة بلا وقت (من جهاز بنسخة قديمة) أقدم من أي خانة لها وقت، وبين خانتين بلا وقت يُؤخذ القيد الأحدث.
   الملاحظات تُجمع من النسختين بلا تكرار. */
const FIELD_MERGE = new Set(["roster", "sheetRows"]);

function mergeFields(cur: any, inc: any) {
  const curNewer = stampOf(cur) >= stampOf(inc);
  const [newer, older] = curNewer ? [cur, inc] : [inc, cur];
  const out: any = { ...older, ...newer };
  const cv = cur.values || {}, iv = inc.values || {};
  const ca = cur.valuesAt || {}, ia = inc.valuesAt || {};
  const values: Record<string, unknown> = {}, at: Record<string, string> = {};
  for (const k of new Set([...Object.keys(cv), ...Object.keys(iv)])) {
    const a = ca[k] || "", b = ia[k] || "";
    let fromInc: boolean;
    if (!(k in cv)) fromInc = true;
    else if (!(k in iv)) fromInc = false;
    else if (a || b) fromInc = b > a;
    else fromInc = !curNewer;
    values[k] = fromInc ? iv[k] : cv[k];
    let t = a > b ? a : b;
    // تعديل قُبل من جهاز بلا أوقات خانات: يأخذ وقت قيده، فلا تمسحه لاحقاً نسخةٌ قديمة بلا أوقات
    if (fromInc && !b && k in cv && JSON.stringify(iv[k]) !== JSON.stringify(cv[k])) t = stampOf(inc) || t;
    if (t) at[k] = t;
  }
  out.values = values;
  if (Object.keys(at).length) out.valuesAt = at;
  const notes = [...(cur.notes || []), ...(inc.notes || [])];
  if (notes.length) {
    const seen = new Set<string>();
    out.notes = notes.filter((n: any) => {
      const key = n && (n.id || `${n.at}|${n.text}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((x: any, y: any) => String(x.at || "").localeCompare(String(y.at || "")));
  }
  out.updatedAt = stampOf(newer);
  return out;
}

/* نص مسطّح للبحث داخل قيم القيد */
function searchText(data: any) {
  const parts: string[] = [];
  const walk = (v: any, depth: number) => {
    if (depth > 3 || parts.length > 60) return;
    if (v == null) return;
    if (typeof v === "string") { if (v.length < 400) parts.push(v); return; }
    if (typeof v === "number" || typeof v === "boolean") { parts.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(data, 0);
  return parts.join(" ").slice(0, 4000);
}

const COL_NAME = /^[A-Za-z][A-Za-z0-9]{2,24}$/;

/* الطلبات تُقسَّم دفعات: قائمة معرّفات طويلة تتجاوز حدّ طول الرابط */
function chunk<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function mergeCol(col: string, incoming: any[], deleted: Record<string, string>, user: any, ownerRules: boolean) {
  const delIds = Object.keys(deleted || {});
  const ids = [...new Set([...incoming.filter((r) => r?.id).map((r) => String(r.id)), ...delIds])];

  if (ids.length) {
    // الصفوف المعنية وحدها، لا القسم كله
    const cur = new Map<string, any>();
    const tomb = new Map<string, string>();
    for (const part of chunk(ids, 100)) {
      const [{ data: curRows, error: e1 }, { data: delRows, error: e2 }] = await Promise.all([
        db.from("records").select("id, owner, stamp, data").eq("col", col).in("id", part),
        db.from("deletions").select("id, at").eq("col", col).in("id", part),
      ]);
      if (e1) throw new Error(e1.message);
      if (e2) throw new Error(e2.message);
      (curRows || []).forEach((r: any) => cur.set(r.id, r));
      (delRows || []).forEach((r: any) => tomb.set(r.id, r.at));
    }

    // المستخدم يعدّل ويحذف قيوده فقط، والمدير كل القيود (والقيد بلا صاحب للمدير)
    const mayEdit = (row: any) => !ownerRules || user.admin || (row.owner && row.owner === user.name);
    const canApproveLetters = !!user.admin || !!(user.perms || {}).approve;

    // سجل التعديلات: القيمة قبل كل تعديل وبعده، لمعرفة من غيّر ماذا والتراجع عنه
    const revs: any[] = [];
    const body = (d: any) => { if (!d) return ""; const { updatedAt: _u, ...rest } = d; return JSON.stringify(rest); };
    const approvalContent = (d: any) => {
      const copy = { ...(d || {}) };
      ["approvalStatus", "approvalBy", "approvalAt", "approvalNote", "issuedAt", "updatedAt"].forEach((k) => delete copy[k]);
      return JSON.stringify(copy);
    };

    const newTombs: any[] = [];
    for (const id of delIds) {
      const row = cur.get(id);
      if (row && !mayEdit(row)) continue;
      if (col === "letterApprovals" && row && !user.admin && ["approved", "issued"].includes(row.data?.approvalStatus)) continue;
      const at = String(deleted[id]);
      const prev = tomb.get(id);
      if (!prev || at > prev) { tomb.set(id, at); newTombs.push({ col, id, at }); }
    }
    for (const part of chunk(newTombs, 500)) {
      const { error } = await db.from("deletions").upsert(part, { onConflict: "col,id" });
      if (error) throw new Error(error.message);
    }

    const writes: any[] = [];
    for (const rec of incoming) {
      if (!rec?.id) continue;
      const id = String(rec.id);
      const at = tomb.get(id);
      if (at && resurrects(rec, at)) continue;   // قيد محذوف حديثاً لا يعود
      const row = cur.get(id);
      let next = rec;
      if (!row) {
        if (ownerRules && (!user.admin || !rec.owner)) next = { ...rec, owner: user.name };
        if (col === "letterApprovals") next = { ...next, approvalStatus: "pending", approvalBy: "", approvalAt: "", approvalNote: "", issuedAt: "" };
      } else if (FIELD_MERGE.has(col)) {
        // دمج على مستوى الخانة: لا تمسح نسخةُ جهازٍ قديمة خانةً عدّلها غيره بعد آخر مزامنة له
        next = mergeFields(row.data, rec);
        if (body(next) === body(row.data)) continue;
      } else if (stampOf(rec) <= row.stamp) {
        continue;
      } else if (ownerRules && col === "letterApprovals" && row.owner === user.name && row.data?.approvalStatus === "approved" && !user.admin) {
        if (rec.approvalStatus === "issued" && approvalContent(rec) === approvalContent(row.data)) {
          next = { ...row.data, approvalStatus: "issued", issuedAt: rec.issuedAt || rec.updatedAt, updatedAt: rec.updatedAt };
        } else continue;
      } else if (ownerRules && col === "letterApprovals" && row.owner === user.name && row.data?.approvalStatus === "pending" && ["approved", "rejected"].includes(rec.approvalStatus) && !user.admin) {
        continue;
      } else if (!mayEdit(row)) {
        // قيد شخص آخر: يُقبل ربط الرد أو رابط الأرشفة فقط
        if (col === "letterApprovals" && canApproveLetters && row.data?.approvalStatus === "pending" && ["approved", "rejected"].includes(rec.approvalStatus) && approvalContent(rec) === approvalContent(row.data)) {
          next = { ...row.data, approvalStatus: rec.approvalStatus, approvalBy: user.name, approvalAt: rec.approvalAt || rec.updatedAt, approvalNote: rec.approvalNote || "", updatedAt: rec.updatedAt };
        } else if (rec.replyId && !row.data.replyId) {
          next = { ...row.data, done: true, replyId: rec.replyId, replyNumber: rec.replyNumber, history: rec.history, updatedAt: rec.updatedAt };
        } else if (rec.driveId && !row.data.driveId) {
          next = { ...row.data, driveId: rec.driveId, driveLink: rec.driveLink, driveFolderId: rec.driveFolderId, drivePath: rec.drivePath, drivePending: false, updatedAt: rec.updatedAt };
        } else if (row.data.assignee && row.data.assignee === user.name && !!rec.done !== !!row.data.done) {
          // المحال إليه يعلّم الوارد «تمت المعالجة» (أو يلغيها) دون أن يملك باقي القيد
          next = { ...row.data, done: !!rec.done, history: Array.isArray(rec.history) ? rec.history.slice(-30) : row.data.history, updatedAt: rec.updatedAt };
        } else continue;
      }
      if (!row || body(row.data) !== body(next)) {
        revs.push({ col, rec_id: id, who: user.name, action: row ? "edit" : "add", before: row ? row.data : null, after: next });
      }
      writes.push({
        col,
        id,
        owner: String(next.owner || (row?.owner ?? "")),
        stamp: String(stampOf(next) || ""),
        data: next,
        search: searchText(next),
        updated_at: new Date().toISOString(),
      });
    }
    for (const part of chunk(writes, 500)) {
      const { error } = await db.from("records").upsert(part, { onConflict: "col,id" });
      if (error) throw new Error(error.message);
    }

    // قيد وُجد شاهد حذف أحدث منه: يُزال فعلياً
    const drop = ids.filter((id) => {
      const at = tomb.get(id);
      if (!at) return false;
      const w = writes.find((x) => x.id === id);
      const stamp = w ? w.stamp : cur.get(id)?.stamp;
      return stamp !== undefined && stamp <= at;
    });
    for (const part of chunk(drop, 100)) await db.from("records").delete().eq("col", col).in("id", part);
    const tombed = new Set(newTombs.map((t) => t.id));
    for (const id of drop) {
      const was = cur.get(id);
      if (was && tombed.has(id)) revs.push({ col, rec_id: id, who: user.name, action: "delete", before: was.data, after: null });
    }
    await saveRevisions(revs);
  }

  return await readCol(col);
}

/* يُحفظ السجل ولا يعطّل المزامنة إن تعذّر (مثلاً قبل إنشاء الجدول) */
async function saveRevisions(revs: any[]) {
  for (const part of chunk(revs, 200)) {
    const { error } = await db.from("revisions").insert(part);
    if (error) { console.warn("revisions:", error.message); return; }
  }
}

const REV_MISSING = "سجل التعديلات يحتاج تشغيل ملف revisions.sql في Supabase مرة واحدة";

async function history(req: any, user: any) {
  let q = db.from("revisions").select("id, at, col, rec_id, who, action, before, after, ref")
    .order("id", { ascending: false }).limit(Math.min(200, Math.max(1, Number(req.limit) || 100)));
  if (!user.admin) q = q.eq("who", user.name); // المستخدم يرى تعديلاته، والمدير يرى الجميع
  if (req.col) q = q.eq("col", String(req.col));
  if (req.recId) q = q.eq("rec_id", String(req.recId));
  if (req.who && user.admin) q = q.eq("who", String(req.who));
  if (req.beforeId) q = q.lt("id", Number(req.beforeId));
  const { data, error } = await q;
  if (error) throw new Error(/revisions/.test(error.message) ? REV_MISSING : error.message);
  return { revisions: data || [] };
}

/* التراجع عن تعديل: يعود القيد إلى ما كان عليه قبله (أو يُحذف إن كان التعديل إضافة).
   يُكتب بوقت جديد حتى تأخذه كل الأجهزة، ويُسجَّل التراجع نفسه فيمكن التراجع عنه أيضاً. */
async function revert(revId: unknown, user: any) {
  const { data: rev, error } = await db.from("revisions").select("*").eq("id", Number(revId)).maybeSingle();
  if (error) throw new Error(/revisions/.test(error.message) ? REV_MISSING : error.message);
  if (!rev) throw new Error("التعديل غير موجود");
  if (!user.admin && rev.who !== user.name) throw new Error("تستطيع التراجع عن تعديلاتك أنت فقط");
  const col = String(rev.col);
  const id = String(rev.rec_id);
  const { data: row } = await db.from("records").select("owner, data").eq("col", col).eq("id", id).maybeSingle();
  // أحدث دائماً من وقت القيد الحالي، حتى لو كانت ساعة جهاز ما متقدمة
  const curAt = Date.parse(stampOf(row?.data)) || 0;
  const now = new Date(Math.max(Date.now(), curAt + 1)).toISOString();
  if (!rev.before) {
    if (row) {
      await db.from("deletions").upsert({ col, id, at: now }, { onConflict: "col,id" });
      await db.from("records").delete().eq("col", col).eq("id", id);
    }
    await saveRevisions([{ col, rec_id: id, who: user.name, action: "revert", before: row?.data ?? null, after: null, ref: rev.id }]);
    await log(user.name, "تراجع عن إضافة", `${col}: ${id}`);
    return { col, id, removed: true };
  }
  const data = { ...rev.before, updatedAt: now };
  await db.from("deletions").delete().eq("col", col).eq("id", id);
  const { error: e2 } = await db.from("records").upsert({
    col, id, owner: String(data.owner || row?.owner || ""), stamp: now, data, search: searchText(data), updated_at: now,
  }, { onConflict: "col,id" });
  if (e2) throw new Error(e2.message);
  await saveRevisions([{ col, rec_id: id, who: user.name, action: "revert", before: row?.data ?? null, after: data, ref: rev.id }]);
  await log(user.name, "تراجع عن تعديل", `${col}: ${id}`);
  return { col, id, restored: true };
}

/* ===== شاشة إحصاءات نظام المركز =====
   سكربت القراءة (يشغّله الموظف داخل نظام المركز) يدفع لقطة الأرقام برمز خاص بالشاشة،
   والشاشة في الموقع تقرأها بجلسة المستخدم العادية. اللقطة أرقام مجمّعة، لا بيانات أفراد. */
const STATS_MAX = 1_500_000;   // حجم اللقطة الواحدة

async function statsKeyOf(create: boolean) {
  const cur = await kvGet("stats_key");
  if (cur) return String(cur);
  if (!create) return null;
  const key = crypto.randomUUID().replace(/-/g, "");
  await db.from("kv").upsert({ key: "stats_key", value: key });
  return key;
}

/* ===== جداول مستوردة من ملفات إكسل =====
   يرفعها المستخدم من «منشئ التقارير»، فتُدمج أعمدتها مع صفوف الطلاب بالهوية أو الاسم.
   كل ملف يُحفظ باسمه: رفعه ثانيةً يستبدل بياناته وحدها ويترك البقية. */
const IMPORT_MAX = 1_500_000;    // حجم الجدول الواحد
const IMPORTS_MAX = 20;          // عدد الجداول

const importsOf = async () => ((await kvGet("report_imports")) || []) as any[];

async function putImport(req: any, user: any) {
  const name = String(req.name || "").trim().slice(0, 80);
  if (!name) throw new Error("لا بد من اسم للجدول");
  const rows = Array.isArray(req.rows) ? req.rows : null;
  if (!rows) throw new Error("لا توجد صفوف في الطلب");
  const fields = (Array.isArray(req.fields) ? req.fields : []).map((f: any) => String(f || "").slice(0, 60)).filter(Boolean);
  if (!fields.length) throw new Error("لا توجد حقول في الجدول");
  const body = JSON.stringify(rows);
  if (body.length > IMPORT_MAX) throw new Error("الجدول أكبر مما يقبله الخادم");
  const list = await importsOf();
  const item = { name, fields, rows, by: user.name, at: new Date().toISOString(), count: rows.length };
  const i = list.findIndex((x: any) => x && x.name === name);
  if (i >= 0) list[i] = item;
  else {
    if (list.length >= IMPORTS_MAX) throw new Error(`لا يمكن تجاوز ${IMPORTS_MAX} جدولاً — احذف واحداً أولاً`);
    list.push(item);
  }
  await db.from("kv").upsert({ key: "report_imports", value: list });
  await log(user.name, "استيراد جدول للتقارير", `${name} — ${rows.length} صفاً`);
  return { ok: true, imports: list.map(summary) };
}

async function dropImport(req: any, user: any) {
  const name = String(req.name || "").trim();
  const list = (await importsOf()).filter((x: any) => x && x.name !== name);
  await db.from("kv").upsert({ key: "report_imports", value: list });
  await log(user.name, "حذف جدول تقارير", name);
  return { ok: true, imports: list.map(summary) };
}

const summary = (x: any) => ({ name: x.name, fields: x.fields, count: x.count, by: x.by, at: x.at });

/* المدة التي يختارها المستخدم في الشاشة: يقرأها سكربت القراءة في جولته التالية
   فيجلب أرقام تلك المدة من تقرير النظام. التاريخ بصيغة YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
async function setStatsPeriod(req: any, user: any) {
  const from = String(req.from || "").trim();
  const to = String(req.to || "").trim();
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw new Error("تاريخ غير صحيح");
  const value = from || to ? { from, to, at: new Date().toISOString(), by: user.name } : null;
  await db.from("kv").upsert({ key: "stats_period", value });
  return { ok: true, period: value };
}

async function statsPush(req: any) {
  const key = await statsKeyOf(false);
  if (!key || String(req.key || "") !== key) {
    await new Promise((r) => setTimeout(r, 1500));
    return { error: "رمز الشاشة غير صحيح" };
  }
  const data = req.data && typeof req.data === "object" ? req.data : null;
  if (!data) throw new Error("لا توجد بيانات في الطلب");
  const body = JSON.stringify(data);
  if (body.length > STATS_MAX) throw new Error("اللقطة أكبر مما تقبله الشاشة");
  const value = { data, at: new Date().toISOString(), by: String(req.by || "").slice(0, 80) };
  await db.from("kv").upsert({ key: "ksach_stats", value });
  return { ok: true, at: value.at, period: await kvGet("stats_period") };
}

/* ===== واتساب للأعمال (Meta Cloud API): إرسال مباشر من النظام =====
   الرمز ومعرّف الرقم أسرار في Supabase (WA_TOKEN وWA_PHONE_ID) لا تصل المتصفح ولا تظهر في أي رد.
   النص الحر لا يُقبل إلا داخل 24 ساعة من آخر رسالة للمستلم، وما قبل ذلك يلزمه قالب معتمد من Meta. */
const WA_LOG_KEEP = 200, WA_CHUNK = 3800;       // حد النص المباشر 4096 حرفاً؛ نقسم الأطول عند حدود الأسطر
const waEnv = () => ({ token: Deno.env.get("WA_TOKEN") || "", phoneId: Deno.env.get("WA_PHONE_ID") || "", ver: Deno.env.get("WA_API_VERSION") || "v21.0" });
const waDigits = (v: unknown) => String(v || "").replace(/\D/g, "");
function waChunks(text: string): string[] {
  const out: string[] = []; let cur = "";
  for (const line of text.split("\n")) {
    let l = line;
    while (l.length > WA_CHUNK) { if (cur) { out.push(cur); cur = ""; } out.push(l.slice(0, WA_CHUNK)); l = l.slice(WA_CHUNK); }
    if (cur && (cur + "\n" + l).length > WA_CHUNK) { out.push(cur); cur = l; } else cur = cur ? cur + "\n" + l : l;
  }
  if (cur) out.push(cur);
  return out;
}
async function waStatus() {
  const e = waEnv(), conf = (await kvGet("wa_config")) || {};
  return { ok: true, configured: !!(e.token && e.phoneId), template: String(conf.template || ""), lang: String(conf.lang || "ar"), withName: !!conf.withName };
}
async function waConfigSet(req: any) {
  const template = String(req.template || "").trim().slice(0, 100), lang = String(req.lang || "ar").trim().slice(0, 10) || "ar";
  if (template && !/^[a-z0-9_]+$/.test(template)) throw new Error("اسم القالب بحروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط (كما في WhatsApp Manager)");
  const withName = !!req.withName;          // هل في نص القالب متغير واحد {{1}} لاسم المستلم
  await db.from("kv").upsert({ key: "wa_config", value: { template, lang, withName } });
  return { ok: true, template, lang, withName };
}
async function waLogAdd(entry: Record<string, unknown>) {
  const l = ((await kvGet("wa_log")) as unknown[]) || [];
  l.push({ at: new Date().toISOString(), ...entry });
  await db.from("kv").upsert({ key: "wa_log", value: l.slice(-WA_LOG_KEEP) });
}
async function waGraph(body: Record<string, unknown>) {
  const e = waEnv();
  const r = await fetch(`https://graph.facebook.com/${e.ver}/${e.phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${e.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}
/* أخطاء Meta الشائعة بعبارة عربية واضحة */
function waHint(code: number, msg: string): { needTemplate?: boolean; message: string } {
  if (code === 131047 || code === 131051) return { needTemplate: true, message: "مرّت أكثر من 24 ساعة على آخر رسالة من المستلم؛ تلزم رسالة قالب معتمدة أولاً." };
  if (code === 131030) return { message: "هذا الرقم ليس في قائمة المستلمين المسموح بها للرقم التجريبي (أضفه في API Setup ← To)." };
  if (code === 190) return { message: "رمز الوصول منتهٍ أو غير صالح؛ ولّد رمزاً جديداً وحدّث WA_TOKEN في أسرار Supabase." };
  if (code === 132001) return { message: "اسم القالب أو لغته غير موجودين أو غير معتمدين في WhatsApp Manager." };
  if (code === 131056) return { message: "أُرسل إلى هذا الرقم كثيراً خلال وقت قصير؛ انتظر قليلاً." };
  return { message: "رفضت Meta الرسالة: " + String(msg || code).slice(0, 200) };
}
async function waSend(req: any, user: any) {
  const e = waEnv();
  if (!e.token || !e.phoneId) throw new Error("الإرسال المباشر غير مُعدّ: أضف WA_TOKEN وWA_PHONE_ID في أسرار Supabase");
  const to = waDigits(req.to);
  if (!/^\d{9,15}$/.test(to)) throw new Error("رقم المستلم غير صالح");
  const label = String(req.label || "").slice(0, 60), tail = "…" + to.slice(-4);
  const sent: string[] = [];
  const fail = async (code: number, msg: string) => {
    const h = waHint(code, msg);
    await waLogAdd({ by: user.name, to: label || tail, kind: req.kind || "text", ok: false, code });
    return { ok: false, code, needTemplate: !!h.needTemplate, message: h.message, sent: sent.length };
  };
  if (req.kind === "template") {
    const conf = (await kvGet("wa_config")) || {};
    const name = String(req.template || conf.template || "");
    if (!name) throw new Error("لم يُضبط اسم قالب الافتتاح بعد");
    const params = (Array.isArray(req.params) ? req.params : []).map((p: unknown) => String(p ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 900));
    const tpl: Record<string, unknown> = { name, language: { code: String(req.lang || conf.lang || "ar") } };
    if (params.length) tpl.components = [{ type: "body", parameters: params.map((text: string) => ({ type: "text", text })) }];
    const r = await waGraph({ messaging_product: "whatsapp", to, type: "template", template: tpl });
    if (!r.ok) return json(await fail(Number(r.j?.error?.code), r.j?.error?.message));
    await waLogAdd({ by: user.name, to: label || tail, kind: "template", ok: true, id: r.j?.messages?.[0]?.id || "" });
    return json({ ok: true, sent: 1, kind: "template" });
  }
  const text = String(req.text || "").trim();
  if (!text) throw new Error("لا نص لإرساله");
  if (text.length > 60000) throw new Error("النص أطول من حد واتساب (نحو 65 ألف حرف)");
  const chunks = waChunks(text);
  for (const body of chunks) {
    const r = await waGraph({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } });
    if (!r.ok) return json(await fail(Number(r.j?.error?.code), r.j?.error?.message));
    sent.push(r.j?.messages?.[0]?.id || "");
  }
  await waLogAdd({ by: user.name, to: label || tail, kind: "text", ok: true, parts: chunks.length, chars: text.length });
  return json({ ok: true, sent: chunks.length, kind: "text" });
}

/* ===== مساعد Google (سكربت Apps Script): القراءة الضوئية وإرسال الملخص اليومي ===== */
const kvGet = async (key: string) => (await db.from("kv").select("value").eq("key", key).maybeSingle()).data?.value ?? null;
const HELPER_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

/* يُقبل رابط المساعد فقط إن كان يخدم كود المساعد فعلاً (لا الخادم القديم ولا غيره) */
async function verifyHelper(url: string) {
  if (!HELPER_URL.test(url)) return false;
  try {
    const res = await fetch(url, { redirect: "follow" });
    const out = await res.json();
    return typeof out?.name === "string" && out.name.includes("مساعد Google");
  } catch { return false; }
}

async function ocrViaHelper(req: any) {
  const url = await kvGet("helper_url");
  if (!url) throw new Error("القراءة الضوئية تحتاج مساعد Google: حدّث سكربت Google وانشره ثم شغّل setupSupabaseBackup");
  const res = await fetch(String(url), {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key: Deno.env.get("BACKUP_KEY") || Deno.env.get("ADMIN_KEY") || "", action: "ocr", data: req.data, mime: req.mime, name: req.name, lang: req.lang || "ar" }),
    redirect: "follow",
  });
  let out: any = null;
  try { out = await res.json(); } catch { /* ردّ غير JSON */ }
  if (!out) throw new Error("مساعد Google لم يرد (" + res.status + ")");
  if (out.error) throw new Error(out.error);
  return { text: String(out.text || "") };
}

/* بيانات الملخص اليومي: المساعد يقرّر الساعة ويرسل من Gmail */
async function digestData(nowHour?: unknown) {
  const cfg = (await kvGet("digest")) || { enabled: false, hour: 7 };
  if (!cfg.enabled) return { enabled: false, hour: cfg.hour };
  // السكربت يفحص كل ساعة؛ في غير ساعة الإرسال لا حاجة لقراءة الوارد والمهام (توفير حصة النقل)
  if (nowHour !== undefined && nowHour !== null && nowHour !== "" && Number(nowHour) !== Number(cfg.hour)) return { enabled: true, hour: cfg.hour, notNow: true };
  const reg = (await readCol("registry")).records.filter((r: any) => r && !r.deletedAt && r.type === "in" && r.dueDate && !r.done)
    .map((r: any) => ({ number: r.number || "", subject: r.subject || "", party: r.party || "", dueDate: r.dueDate, owner: r.assignee || r.owner || "" }));
  const tasks = (await readCol("tasks")).records.filter((t: any) => t && !t.done && t.dueDate)
    .map((t: any) => ({ text: t.text || "", dueDate: t.dueDate, owner: t.owner || "" }));
  const { data: users } = await db.from("app_users").select("name, email, admin, active");
  return {
    enabled: true, hour: cfg.hour, lateIn: reg, lateTasks: tasks,
    users: (users || []).filter((u: any) => u.email && u.active !== false).map((u: any) => ({ name: u.name, email: u.email, admin: !!u.admin })),
  };
}

/* القسم كاملاً كما تتوقعه الأداة: { records, deleted } */
async function readCol(col: string) {
  const records: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // ترتيب ثابت: بدونه تعيد Postgres الصفوف بلا ترتيب (المعدَّل في موضع جديد)، وقد تتداخل الصفحات
    const { data, error } = await db.from("records").select("data").eq("col", col).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    records.push(...(data || []).map((r: any) => r.data));
    if (!data || data.length < PAGE) break;
  }
  const deleted: Record<string, string> = {};
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
  for (let from = 0; ; from += PAGE) {
    const { data } = await db.from("deletions").select("id, at").eq("col", col).gte("at", cutoff).order("id").range(from, from + PAGE - 1);
    (data || []).forEach((r: any) => { deleted[r.id] = r.at; });
    if (!data || data.length < PAGE) break;
  }
  return { records, deleted };
}

/* بصمة رخيصة لحالة قسم: عدد قيوده وأحدث كتابة فيها، وعدد شواهد الحذف وأحدثها.
   كل كتابة في records تضع updated_at = الآن، فأي إضافة أو تعديل أو حذف يغيّر البصمة.
   الغرض: طلب القراءة الدوري لقسم لم يتغيّر يعود بسطر واحد بدل القسم كله (كان يستنزف حصة النقل).
   تُحسب البصمة قبل قراءة البيانات: كتابة تقع بينهما تجعل بصمة الجهاز أقدم، فيقرأ كاملاً في الجولة التالية. */
async function colMark(col: string): Promise<string> {
  try {
    const r = await db.from("records").select("updated_at", { count: "exact" }).eq("col", col).order("updated_at", { ascending: false }).limit(1);
    if (r.error) return "";
    const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
    const d = await db.from("deletions").select("at", { count: "exact" }).eq("col", col).gte("at", cutoff).order("at", { ascending: false }).limit(1);
    if (d.error) return "";
    return [r.count ?? 0, r.data?.[0]?.updated_at || "", d.count ?? 0, d.data?.[0]?.at || ""].join("|");
  } catch (_e) { return ""; }
}
/* قراءة قسم مع بصمته؛ وإن طابقت بصمة الجهاز عاد «لم يتغيّر» بلا بيانات */
async function readColMarked(col: string, known: unknown) {
  const mark = await colMark(col);
  if (mark && known && String(known) === mark) return { same: true, mark };
  const data = await readCol(col);
  return mark ? { ...data, mark } : data;
}

async function syncAll(cols: Record<string, any>, user: any, marks: Record<string, unknown> = {}) {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(cols || {})) {
    if (!COL_NAME.test(name)) continue;
    const c = cols[name] || {};
    const recs = c.records || [];
    const del = c.deleted || {};
    result[name] = (recs.length || Object.keys(del).length)
      ? await mergeCol(name, recs, del, user, name === "letterApprovals")
      : await readColMarked(name, marks ? marks[name] : null);
  }
  return result;
}

/* اعتماد بيانات جهاز كاملة على هذا الخادم (للنقل بين الخوادم).
   بخلاف المزامنة: يُكتب كل سجل بلا مقارنة وقت، وتُزال شواهد الحذف عن معرّفاته
   حتى لا يمنعها حارس منع عودة المحذوف. للمدير وحده، وبتأكيد منه. */
async function adopt(cols: Record<string, any>, user: any, replace = false) {
  const adopted: Record<string, number> = {};
  const removed: Record<string, number> = {};
  for (const name of Object.keys(cols || {})) {
    if (!COL_NAME.test(name)) continue;
    const recs = (cols[name].records || []).filter((r: any) => r && r.id);
    const ids = recs.map((r: any) => String(r.id));
    adopted[name] = 0;
    if (replace) {
      // القسم يصبح نسخة مطابقة لما أُرسل: يُحذف ما ليس فيه، وتُمسح شواهد الحذف كلها
      const keep = new Set(ids);
      const stale: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db.from("records").select("id").eq("col", name).range(from, from + 999);
        (data || []).forEach((r: any) => { if (!keep.has(r.id)) stale.push(r.id); });
        if (!data || data.length < 1000) break;
      }
      for (const part of chunk(stale, 100)) await db.from("records").delete().eq("col", name).in("id", part);
      await db.from("deletions").delete().eq("col", name);
      removed[name] = stale.length;
    }
    if (!recs.length) continue;
    for (const part of chunk(ids, 100)) await db.from("deletions").delete().eq("col", name).in("id", part);
    const now = new Date().toISOString();
    const rows = recs.map((r: any) => {
      // قيد بلا صاحب يُنسب لمن اعتمد النقل، في السجل نفسه لا في العمود وحده
      const data = r.owner ? r : { ...r, owner: user.name };
      return {
        col: name,
        id: String(r.id),
        owner: String(data.owner),
        stamp: String(stampOf(data) || now),
        data,
        search: searchText(data),
        updated_at: now,
      };
    });
    for (const part of chunk(rows, 500)) {
      const { error } = await db.from("records").upsert(part, { onConflict: "col,id" });
      if (error) throw new Error(error.message);
    }
    adopted[name] = rows.length;
  }
  await log(user.name, replace ? "نقل كامل إلى هذا الخادم" : "اعتماد بيانات جهاز", Object.keys(adopted).map((k) => `${k}: ${adopted[k]}`).join(" · "));
  return { adopted, removed };
}

/* ===== حجز أرقام الصادر ===== */
async function reserve(head: unknown, count: unknown) {
  const n = Math.max(1, Math.min(500, Number(count) || 1));
  const prefix = String(head || "");
  if (!prefix) throw new Error("بادئة الرقم مطلوبة");
  const { data, error } = await db.rpc("reserve_numbers", { p_head: prefix, p_count: n });
  if (error) throw new Error(error.message);
  const max = Number(data);   // آخر رقم محجوز
  const fmt = (v: number) => prefix + (String(v).length < 3 ? ("00" + v).slice(-3) : String(v));
  const numbers: string[] = [];
  for (let i = n - 1; i >= 0; i--) numbers.push(fmt(max - i));
  return { number: numbers[0], numbers };
}

/* ===== الملفات ===== */
async function upload(req: any, user: any) {
  const bytes = unb64(String(req.data || ""));
  if (bytes.length > 45 * 1024 * 1024) throw new Error("الملف أكبر من 45 ميغابايت");
  const folder = (req.path || []).map((p: string) => String(p).replace(/[/\\]/g, "-")).join("/");
  const safe = String(req.name || "ملف").replace(/[/\\]/g, "-");
  // Supabase Storage لا يقبل إلا حروف S3 الآمنة في اسم الملف، فلا عربية فيه:
  // المفتاح لاتيني (الشهر ومعرّف عشوائي والامتداد)، والاسم والمجلد العربيان في جدول files
  const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(safe) || [])[1];
  const id = `f/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext ? "." + ext.toLowerCase() : ""}`;
  const { error } = await db.storage.from(BUCKET).upload(id, bytes, {
    contentType: req.mime || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error("تعذّر رفع الملف: " + error.message);
  await db.from("files").insert({
    id, name: safe, mime: req.mime || "application/octet-stream",
    size: bytes.length, folder, owner: user.name,
  });
  // الموقع يعتبر وجود الرابط علامةً على أن الملف مؤرشف، فيجب أن يبقى دائماً:
  // رابط موقّع ينتهي بعد أيام لا يصلح. العرض والتحميل يمرّان عبر إجراء file بمعرّف الملف.
  return { id, link: `supabase:${id}`, folderId: "" };
}

async function fileOf(id: unknown) {
  const path = String(id || "");
  const { data: meta } = await db.from("files").select("name, mime").eq("id", path).maybeSingle();
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (!error && data) {
    const bytes = new Uint8Array(await data.arrayBuffer());
    return { name: meta?.name || path.split("/").pop(), mime: meta?.mime || data.type, data: b64(bytes) };
  }
  // قيد يشير إلى ملف على Drive (من الخادم القديم): يُجلب عبر مساعد Google ويُحفظ هنا
  if (LEGACY_ID.test(path)) return await legacyFile(path, true);
  throw new Error("الملف غير موجود على الخادم");
}

/* ===== المرفقات القديمة على Google Drive =====
   معرّف Drive حروف لاتينية وأرقام بلا «/»، ومعرّفات Supabase تبدأ بـ f/.
   النسخة المحفوظة هنا مفتاحها legacy/<معرّف Drive>، فلا يتغيّر شيء في القيود نفسها. */
const LEGACY_ID = /^[A-Za-z0-9_-]{20,}$/;

async function legacyFile(driveId: string, withData: boolean) {
  const key = `legacy/${driveId}`;
  const { data: meta } = await db.from("files").select("name, mime").eq("id", key).maybeSingle();
  if (meta) {
    if (!withData) return { ok: true, copied: false };
    const { data } = await db.storage.from(BUCKET).download(key);
    if (data) return { name: meta.name, mime: meta.mime, data: b64(new Uint8Array(await data.arrayBuffer())) };
  }
  const url = await kvGet("helper_url");
  if (!url) throw new Error("الملف على Google Drive، وجلبه يحتاج مساعد Google");
  const res = await fetch(String(url), {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key: Deno.env.get("BACKUP_KEY") || Deno.env.get("ADMIN_KEY") || "", action: "driveFile", id: driveId }),
    redirect: "follow",
  });
  let out: any = null;
  try { out = await res.json(); } catch { /* ردّ غير JSON */ }
  if (!out) throw new Error("مساعد Google لم يرد (" + res.status + ")");
  if (out.error) throw new Error(/إجراء غير معروف/.test(out.error) ? "حدّث سكربت Google (إصدار جديد) ليجلب الملفات القديمة من Drive" : out.error);
  const bytes = unb64(String(out.data || ""));
  const mime = String(out.mime || "application/octet-stream");
  const { error } = await db.storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: true });
  if (!error) {
    await db.from("files").upsert({ id: key, name: String(out.name || driveId), mime, size: bytes.length, folder: "من Drive", owner: "" }, { onConflict: "id" });
  }
  return withData ? { name: String(out.name || driveId), mime, data: String(out.data || "") } : { ok: true, copied: !error, name: out.name };
}

/* بحث داخل أسماء الملفات ومحتوى القيود (بدل فهرسة Drive لمحتوى الملفات) */
async function search(q: unknown) {
  const text = String(q || "").trim();
  if (text.length < 2) return { ids: [] };
  const like = `%${text}%`;
  const [{ data: byName }, { data: byRec }] = await Promise.all([
    db.from("files").select("id").ilike("name", like).limit(100),
    db.from("records").select("data").eq("col", "registry").ilike("search", like).limit(200),
  ]);
  const ids = new Set<string>((byName || []).map((f: any) => f.id));
  (byRec || []).forEach((r: any) => { if (r.data?.driveId) ids.add(r.data.driveId); });
  return { ids: [...ids].slice(0, 100) };
}

/* ===== سجل الأحداث ===== */
async function log(who: string, action: string, details: string) {
  try { await db.from("events").insert({ who, action, details }); } catch { /* السجل لا يعطّل العمل */ }
}

async function logRequest(user: any, req: any) {
  const a = req.action;
  if (["ping", "status", "people", "events", "backups", "history", "revert"].includes(a)) return;
  if (a === "sync") {
    const n = (req.records || []).length;
    const d = Object.keys(req.deleted || {}).length;
    if (n || d) await log(user.name, "تعديل سجل الوارد والصادر", `${n} قيد مُرسل، ${d} حذف`);
    return;
  }
  if (a === "syncAll") {
    const parts: string[] = [];
    for (const k of Object.keys(req.cols || {})) {
      const n = (req.cols[k].records || []).length;
      const d = Object.keys(req.cols[k].deleted || {}).length;
      if (n || d) parts.push(`${k}: ${n} سجل${d ? ` و${d} حذف` : ""}`);
    }
    if (parts.length) await log(user.name, "تعديل الأقسام", parts.join(" · "));
    return;
  }
  const labels: Record<string, string> = {
    upload: "رفع ملف", file: "فتح ملف", ocr: "قراءة ضوئية", reserve: "حجز رقم", search: "بحث في المحتوى",
    logout: "خروج", logoutAll: "خروج من كل الأجهزة", password: "تغيير كلمة المرور",
    saveUser: "حفظ مستخدم", deleteUser: "حذف مستخدم", digest: "إعداد الملخص اليومي",
  };
  const details = a === "upload" ? `${req.name || ""} → ${(req.path || []).join("/")}`
    : a === "saveUser" ? (req.user || {}).username || ""
    : a === "deleteUser" ? req.username || ""
    : a === "search" ? req.q || ""
    : a === "ocr" ? req.name || "" : "";
  await log(user.name, labels[a] || a, details);
}

async function readLog(days: number, limit: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  const { data } = await db.from("events").select("at, who, action, details")
    .gte("at", since).order("at", { ascending: false }).limit(Math.min(1000, limit));
  return (data || []).map((e: any) => ({
    at: String(e.at).replace("T", " ").slice(0, 19),
    user: e.who, action: e.action, details: e.details || "",
  }));
}

/* ===== النسخ الاحتياطية: لقطة JSON يومية في حاوية خاصة ===== */
async function backupDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: last } = await db.from("kv").select("value").eq("key", "last_backup").maybeSingle();
  if (last?.value === today) return;
  await db.from("kv").upsert({ key: "last_backup", value: today });
  const { data: cols } = await db.from("records").select("col");
  const names = [...new Set((cols || []).map((c: any) => c.col))];
  const snapshot: Record<string, unknown> = {};
  for (const name of names) snapshot[name] = await readCol(name);
  await db.storage.from(BACKUP_BUCKET).upload(
    `backup-${today}.json`, // لاتيني: Supabase Storage يرفض الحروف العربية في أسماء الملفات
    new Blob([JSON.stringify(snapshot)], { type: "application/json" }),
    { upsert: true },
  );
  const { data: old } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 500, sortBy: { column: "name", order: "desc" } });
  const extra = (old || []).slice(BACKUP_KEEP).map((f: any) => f.name);
  if (extra.length) await db.storage.from(BACKUP_BUCKET).remove(extra);
  const cut = new Date(Date.now() - REVISION_DAYS * 86400000).toISOString();
  await db.from("revisions").delete().lt("at", cut);
}

/* الأيام التي لها نسخة، وعدد سجلات كل نسخة (لنافذة الاستعادة) */
async function backupDays() {
  const { data } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 60, sortBy: { column: "name", order: "desc" } });
  const days = [];
  for (const f of data || []) {
    const m = /^backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
    if (!m) continue;
    let records = 0;
    try {
      const { data: blob } = await db.storage.from(BACKUP_BUCKET).download(f.name);
      const snap = JSON.parse(await blob!.text());
      for (const k of Object.keys(snap)) records += ((snap[k] || {}).records || []).length;
    } catch { /* نسخة تالفة تُعرض بلا عدد */ }
    days.push({ day: m[1], files: 1, records });
  }
  return { days };
}

/* استعادة نسخة يوم: تُضاف السجلات الناقصة فقط، ولا يُحذف أو يُستبدل شيء موجود.
   المستعاد تُزال عنه شواهد الحذف (عبر adopt) حتى لا تعود المزامنة فتحذفه. */
async function restoreDay(day: unknown, user: any) {
  const d = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("اختر تاريخ النسخة");
  const { data: blob, error } = await db.storage.from(BACKUP_BUCKET).download(`backup-${d}.json`);
  if (error || !blob) throw new Error("لا توجد نسخة بهذا التاريخ");
  const snap = JSON.parse(await blob.text());
  const missing: Record<string, any> = {};
  for (const name of Object.keys(snap || {})) {
    if (!COL_NAME.test(name)) continue;
    const recs = ((snap[name] || {}).records || []).filter((r: any) => r && r.id);
    const have = new Set((await readCol(name)).records.map((r: any) => String(r.id)));
    missing[name] = { records: recs.filter((r: any) => !have.has(String(r.id))) };
  }
  const { adopted } = await adopt(missing, user);
  await log(user.name, "استعادة نسخة احتياطية", d + " — " + Object.keys(adopted).map((k) => `${k}: ${adopted[k]}`).join(" · "));
  return { day: d, restored: adopted };
}

/* ===== نسخة خارجية يومية على Google Drive =====
   سكربت Google (SupabaseBackup.gs) يطلب كل ليلة لقطة كاملة ويحفظها في Drive، ثم ينسخ الملفات
   الجديدة عبر روابط موقّعة قصيرة العمر. الدخول برمز النسخ (BACKUP_KEY) أو رمز المدير. */
function backupKeyOk(key: unknown) {
  const want = Deno.env.get("BACKUP_KEY") || Deno.env.get("ADMIN_KEY") || "";
  const got = String(key || "");
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function driveSnapshot() {
  const { data: cols } = await db.from("records").select("col");
  const names = [...new Set((cols || []).map((c: any) => c.col))];
  const data: Record<string, unknown> = {};
  for (const name of names) data[name] = await readCol(name);
  const files: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: part } = await db.from("files").select("id, name, mime, size, folder, created_at").order("id").range(from, from + 999);
    files.push(...(part || []));
    if (!part || part.length < 1000) break;
  }
  return { ok: true, version: VERSION, at: new Date().toISOString(), data, users: (await exportUsers()).users, files };
}

async function driveFileUrls(ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).slice(0, 50).map(String);
  const urls: Record<string, string> = {};
  for (const id of list) {
    const { data } = await db.storage.from(BUCKET).createSignedUrl(id, 3600);
    if (data?.signedUrl) urls[id] = data.signedUrl;
  }
  return { urls };
}

async function listBackups() {
  const { data } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 60, sortBy: { column: "name", order: "desc" } });
  const backups = [];
  for (const f of data || []) {
    const { data: signed } = await db.storage.from(BACKUP_BUCKET).createSignedUrl(f.name, 3600);
    backups.push({ name: f.name, link: signed?.signedUrl || "", at: f.created_at || "" });
  }
  const { data: d } = await db.from("kv").select("value").eq("key", "digest").maybeSingle();
  const { data: drive } = await db.from("kv").select("value").eq("key", "drive_backup").maybeSingle();
  return { folder: "", logFolder: "", backups, digest: d?.value || { enabled: false, hour: 7 }, drive: drive?.value || null, restore: true };
}

/* ===== التوجيه ===== */
Deno.serve(async (httpReq) => {
  if (httpReq.method === "OPTIONS") return json({ ok: true });
  let req: any;
  try { req = JSON.parse(await httpReq.text()); } catch { return json({ error: "طلب غير صالح" }); }
  if (!req) return json({ error: "طلب غير صالح" });

  try {
    // إجراءات قبل الدخول
    switch (req.action) {
      case "status": {
        const { count } = await db.from("app_users").select("username", { count: "exact", head: true });
        return json({ ok: true, version: VERSION, hasUsers: !!count, webUrl: httpReq.url });
      }
      case "setup": return json(await setup(req));
      case "login": {
        const res = await login(req.username, req.password);
        await log(res.user.name, "دخول", "");
        return json(res);
      }
      case "forgot": return json(await forgot(req.username));
      // لقطة إحصاءات نظام المركز: برمز الشاشة لا بجلسة مستخدم
      case "statsPush": return json(await statsPush(req));
      case "statsPeriod": {
        const key = await statsKeyOf(false);
        if (!key || String(req.key || "") !== key) return json({ error: "رمز الشاشة غير صحيح" });
        return json({ period: await kvGet("stats_period") });
      }
      case "reset": return json(await resetPassword(req.username, req.code, req.password));
      // النسخة الخارجية على Drive: برمز النسخ لا بجلسة مستخدم
      case "driveSnapshot":
      case "driveFileUrls":
      case "digestData":
      case "helperHello":
      case "driveDone": {
        if (!backupKeyOk(req.key)) {
          await new Promise((r) => setTimeout(r, 1500));
          return json({ error: "رمز النسخ غير صحيح" });
        }
        if (req.action === "driveSnapshot") return json(await driveSnapshot());
        if (req.action === "driveFileUrls") return json(await driveFileUrls(req.ids));
        if (req.action === "digestData") return json(await digestData(req.nowHour));
        const info = req.info && typeof req.info === "object" ? req.info : {};
        // رابط المساعد المنشور: يُحفظ ليستعمله الخادم في القراءة الضوئية
        const helper = String(req.url || info.helper || "");
        const good = !!helper && (helper === (await kvGet("helper_url")) || await verifyHelper(helper));
        if (good) await db.from("kv").upsert({ key: "helper_url", value: helper });
        if (req.action === "helperHello") return json({ ok: true, helper: good });
        await db.from("kv").upsert({ key: "drive_backup", value: { ...info, at: new Date().toISOString() } });
        return json({ ok: true });
      }
    }

    const user = await session(req.token);
    if (!user) return json({ error: "UNAUTHORIZED" });
    await logRequest(user, req);

    switch (req.action) {
      case "ping":
        return json({
          ok: true, owner: "Supabase", root: "قاعدة بيانات Supabase", version: VERSION, user: publicUser(user), webUrl: httpReq.url,
          // قناة التحديث الفوري بين الأجهزة (إشارات فقط، بلا بيانات)
          realtime: publicKey() ? { url: Deno.env.get("SUPABASE_URL"), key: publicKey() } : null,
        });
      case "logout":
        await db.from("sessions").delete().eq("token", String(req.token));
        return json({ ok: true });
      case "logoutAll":
        await db.from("sessions").delete().eq("username", user.username);
        return json({ ok: true });
      case "password": return json(await changePassword(user, req.current, req.password));
      case "sync": {
        const recs = req.records || [];
        const del = req.deleted || {};
        if (recs.length || Object.keys(del).length) await backupDaily();
        return json(recs.length || Object.keys(del).length
          ? await mergeCol("registry", recs, del, user, true)
          : await readColMarked("registry", req.mark));
      }
      case "syncAll": return json(await syncAll(req.cols || {}, user, req.marks || {}));
      case "people": {
        const { data } = await db.from("app_users").select("name, username").eq("active", true);
        return json({ people: data || [] });
      }
      case "upload": return json(await upload(req, user));
      case "file": return json(await fileOf(req.id));
      case "legacyCopy": {
        const id = String(req.id || "");
        if (!LEGACY_ID.test(id)) return json({ ok: true, skipped: true });
        return json(await legacyFile(id, false));
      }
      case "reserve": return json(await reserve(req.head, req.count));
      case "search": return json(await search(req.q));
      case "stats": return json({ stats: await kvGet("ksach_stats"), period: await kvGet("stats_period") });
      case "setStatsPeriod": return json(await setStatsPeriod(req, user));
      case "imports": return json({ imports: await importsOf() });
      case "putImport": return json(await putImport(req, user));
      case "dropImport": return json(await dropImport(req, user));
      case "statsKey": {
        if (!user.admin) throw new Error("رمز الشاشة للمدير وحده");
        return json({ key: await statsKeyOf(true) });
      }
      case "backups": return json(await listBackups());
      case "events": return json({ events: await readLog(Number(req.days) || 3, Number(req.limit) || 300) });
      case "ocr": return json(await ocrViaHelper(req));
      case "history": return json(await history(req, user));
      case "revert": {
        const r = await revert(req.revId, user);
        return json(r);
      }
    }

    if (!user.admin) return json({ error: "هذا الإجراء للمدير فقط" });
    switch (req.action) {
      case "users": {
        const { data } = await db.from("app_users").select("*").order("username");
        return json({ users: (data || []).map(publicUser) });
      }
      case "saveUser": return json(await saveUser(req.user, user));
      case "adopt": return json(await adopt(req.cols || {}, user, req.replace === true));
      case "exportUsers": return json(await exportUsers());
      case "backupDays": return json(await backupDays());
      case "restoreDay": return json(await restoreDay(req.day, user));
      case "importUsers": return json(await importUsers(req.users, user));
      case "deleteUser": return json(await deleteUser(req.username, user));
      case "waStatus": return json(await waStatus());
      case "waConfig": return json(await waConfigSet(req));
      case "waSend": return await waSend(req, user);
      case "waLog": return json({ log: ((await kvGet("wa_log")) as unknown[]) || [] });
      case "digest": {
        const hour = Math.min(23, Math.max(0, Number(req.hour) || 7));
        const value = { enabled: !!req.enabled, hour };
        await db.from("kv").upsert({ key: "digest", value });
        // الإرسال من مساعد Google (Gmail) كل ساعة يتحقق؛ بلا مساعد لا يصل شيء فننبّه
        if (value.enabled && !(await kvGet("helper_url"))) {
          return json({ ...value, warning: "حُفظ، لكن الإرسال يحتاج مساعد Google منشوراً (سكربت Google)" });
        }
        return json(value);
      }
    }
    return json({ error: "إجراء غير معروف" });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) });
  }
});
