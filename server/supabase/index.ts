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

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  serviceKey(),
  { auth: { persistSession: false } },
);

const VERSION = 10;
const SESSION_DAYS = 30;
const RESURRECT_MS = 24 * 3600 * 1000;
const TOMBSTONE_DAYS = 90;   // شواهد الحذف تُنظّف بعدها
const BUCKET = "tamkeen";
const BACKUP_BUCKET = "tamkeen-backups";
const BACKUP_KEEP = 30;

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
  const { error } = await db.from("app_users").upsert(row, { onConflict: "username" });
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

    const newTombs: any[] = [];
    for (const id of delIds) {
      const row = cur.get(id);
      if (row && !mayEdit(row)) continue;
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
      } else if (stampOf(rec) <= row.stamp) {
        continue;
      } else if (!mayEdit(row)) {
        // قيد شخص آخر: يُقبل ربط الرد أو رابط الأرشفة فقط
        if (rec.replyId && !row.data.replyId) {
          next = { ...row.data, done: true, replyId: rec.replyId, replyNumber: rec.replyNumber, history: rec.history, updatedAt: rec.updatedAt };
        } else if (rec.driveId && !row.data.driveId) {
          next = { ...row.data, driveId: rec.driveId, driveLink: rec.driveLink, driveFolderId: rec.driveFolderId, drivePath: rec.drivePath, drivePending: false, updatedAt: rec.updatedAt };
        } else continue;
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
  }

  return await readCol(col);
}

/* القسم كاملاً كما تتوقعه الأداة: { records, deleted } */
async function readCol(col: string) {
  const records: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("records").select("data").eq("col", col).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    records.push(...(data || []).map((r: any) => r.data));
    if (!data || data.length < PAGE) break;
  }
  const deleted: Record<string, string> = {};
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
  for (let from = 0; ; from += PAGE) {
    const { data } = await db.from("deletions").select("id, at").eq("col", col).gte("at", cutoff).range(from, from + PAGE - 1);
    (data || []).forEach((r: any) => { deleted[r.id] = r.at; });
    if (!data || data.length < PAGE) break;
  }
  return { records, deleted };
}

async function syncAll(cols: Record<string, any>, user: any) {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(cols || {})) {
    if (!COL_NAME.test(name)) continue;
    const c = cols[name] || {};
    const recs = c.records || [];
    const del = c.deleted || {};
    result[name] = (recs.length || Object.keys(del).length)
      ? await mergeCol(name, recs, del, user, false)
      : await readCol(name);
  }
  return result;
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
  const id = `${folder ? folder + "/" : ""}${crypto.randomUUID()}-${safe}`;
  const { error } = await db.storage.from(BUCKET).upload(id, bytes, {
    contentType: req.mime || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error("تعذّر رفع الملف: " + error.message);
  await db.from("files").insert({
    id, name: safe, mime: req.mime || "application/octet-stream",
    size: bytes.length, folder, owner: user.name,
  });
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(id, 60 * 60 * 24 * 7);
  return { id, link: signed?.signedUrl || "", folderId: folder };
}

async function fileOf(id: unknown) {
  const path = String(id || "");
  const { data: meta } = await db.from("files").select("name, mime").eq("id", path).maybeSingle();
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("الملف غير موجود على الخادم التجريبي (المرفقات القديمة ما زالت على Drive)");
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { name: meta?.name || path.split("/").pop(), mime: meta?.mime || data.type, data: b64(bytes) };
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
  if (["ping", "status", "people", "events", "backups"].includes(a)) return;
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
    `نسخة ${today}.json`,
    new Blob([JSON.stringify(snapshot)], { type: "application/json" }),
    { upsert: true },
  );
  const { data: old } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 500, sortBy: { column: "name", order: "desc" } });
  const extra = (old || []).slice(BACKUP_KEEP).map((f: any) => f.name);
  if (extra.length) await db.storage.from(BACKUP_BUCKET).remove(extra);
}

async function listBackups() {
  const { data } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 60, sortBy: { column: "name", order: "desc" } });
  const backups = [];
  for (const f of data || []) {
    const { data: signed } = await db.storage.from(BACKUP_BUCKET).createSignedUrl(f.name, 3600);
    backups.push({ name: f.name, link: signed?.signedUrl || "", at: f.created_at || "" });
  }
  const { data: d } = await db.from("kv").select("value").eq("key", "digest").maybeSingle();
  return { folder: "", logFolder: "", backups, digest: d?.value || { enabled: false, hour: 7 } };
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
      case "reset": return json(await resetPassword(req.username, req.code, req.password));
    }

    const user = await session(req.token);
    if (!user) return json({ error: "UNAUTHORIZED" });
    await logRequest(user, req);

    switch (req.action) {
      case "ping":
        return json({ ok: true, owner: "Supabase", root: "قاعدة بيانات Supabase", version: VERSION, user: publicUser(user), webUrl: httpReq.url });
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
          : await readCol("registry"));
      }
      case "syncAll": return json(await syncAll(req.cols || {}, user));
      case "people": {
        const { data } = await db.from("app_users").select("name, username").eq("active", true);
        return json({ people: data || [] });
      }
      case "upload": return json(await upload(req, user));
      case "file": return json(await fileOf(req.id));
      case "reserve": return json(await reserve(req.head, req.count));
      case "search": return json(await search(req.q));
      case "backups": return json(await listBackups());
      case "events": return json({ events: await readLog(Number(req.days) || 3, Number(req.limit) || 300) });
      case "ocr":
        throw new Error("القراءة الضوئية غير متاحة على الخادم التجريبي؛ استخدمها من الخادم الأساسي.");
    }

    if (!user.admin) return json({ error: "هذا الإجراء للمدير فقط" });
    switch (req.action) {
      case "users": {
        const { data } = await db.from("app_users").select("*").order("username");
        return json({ users: (data || []).map(publicUser) });
      }
      case "saveUser": return json(await saveUser(req.user, user));
      case "deleteUser": return json(await deleteUser(req.username, user));
      case "digest": {
        const hour = Math.min(23, Math.max(0, Number(req.hour) || 7));
        const value = { enabled: !!req.enabled, hour };
        await db.from("kv").upsert({ key: "digest", value });
        if (value.enabled) throw new Error("الملخص اليومي بالبريد غير مفعّل على الخادم التجريبي؛ يحتاج مفتاح بريد (Resend).");
        return json(value);
      }
    }
    return json({ error: "إجراء غير معروف" });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) });
  }
});
