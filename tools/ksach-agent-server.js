/* Local companion for the Tamkeen command agent.
   Keeps the authenticated portal session in a dedicated Edge profile and exposes
   a small same-origin API to the local Tamkeen UI. Never stores portal credentials. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PORT = Number(process.env.TAMKEEN_PORT || 4180);
const PORTAL = "https://tamkeen.ksach.org";
const PROFILE = path.join(process.env.LOCALAPPDATA || os.homedir(), "TamkeenAgent", "EdgeProfile");
const MAX_BODY = 8 * 1024 * 1024;
const FILTERS = new Set(["q", "track_id", "training_course_id", "status", "group_status"]);
const REGISTER_FIELDS = new Set(["track_id", "student_number", "status", "full_name", "national_id", "gender", "marital_status", "phone_1", "phone_2", "birth_date", "health_status", "governorate_id", "population_community_id", "displacement_status", "residence_type_id", "current_address", "family_members_count", "breadwinner_status", "employment_status", "income_type_id", "education_level", "specialization", "notes"]);

let context = null;
let systemPage = null;
let bootError = "";
let busy = false;

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname) && Number(u.port || 80) === PORT;
  } catch { return false; }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("حجم الطلب أكبر من الحد المسموح.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("صيغة الأمر غير صالحة.");
  if (command.type === "lookup") {
    if (!Array.isArray(command.items) || !command.items.length || command.items.length > 50) throw new Error("حدّد من 1 إلى 50 اسماً أو رقم هوية.");
    for (const item of command.items) if (!item || typeof item.q !== "string" || !item.q.trim() || item.q.length > 180) throw new Error("قيمة البحث غير صالحة.");
    return;
  }
  if (command.type === "list") {
    if (!command.params || typeof command.params !== "object" || Array.isArray(command.params)) throw new Error("مرشحات القائمة غير صالحة.");
    for (const [key, value] of Object.entries(command.params)) {
      if (!FILTERS.has(key) || typeof value !== "string" || value.length > 120) throw new Error("مرشح القائمة غير مسموح.");
    }
    return;
  }
  if (command.type === "register") {
    if (!Array.isArray(command.rows) || !command.rows.length || command.rows.length > 80) throw new Error("اختر ملفاً فيه من طالب واحد إلى 80 طالباً.");
    for (const row of command.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("صف طالب غير صالح.");
      for (const [key, value] of Object.entries(row)) if (!REGISTER_FIELDS.has(key) || typeof value !== "string" || value.length > 500) throw new Error("حقل تسجيل غير مسموح أو أطول من الحد.");
    }
    return;
  }
  throw new Error("الأمر غير مدعوم.");
}

async function startBrowser() {
  try {
    fs.mkdirSync(PROFILE, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE, {
      channel: process.env.TAMKEEN_BROWSER || "msedge",
      headless: false,
      acceptDownloads: false,
      viewport: null,
      args: ["--new-window"],
    });
    systemPage = context.pages()[0] || await context.newPage();
    await systemPage.goto(PORTAL + "/admin/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
    systemPage.on("close", () => { systemPage = null; });
    bootError = "";
    console.log("Agent browser ready. Sign in to the portal in the opened Edge window.");
  } catch (error) {
    bootError = error && error.message ? error.message : String(error);
    console.error("Could not start Edge agent browser:", bootError);
  }
}

async function status() {
  const page = systemPage;
  if (!page || page.isClosed()) return { ready: false, loggedIn: false, message: bootError ? "تعذّر فتح Edge: " + bootError : "نافذة الوكيل غير مفتوحة." };
  let url = "";
  try { url = page.url(); } catch { }
  const onPortal = url.startsWith(PORTAL + "/") || url === PORTAL;
  const loggedIn = onPortal && !/\/login(?:[/?#]|$)/i.test(url);
  return { ready: true, loggedIn, busy, message: loggedIn ? "متصل بالنظام." : "سجّل الدخول في نافذة Edge التي فتحها الوكيل." };
}

async function runInPortal(command) {
  if (!systemPage || systemPage.isClosed()) throw new Error("نافذة الوكيل غير مفتوحة. أعد تشغيل تشغيل.bat.");
  if (!systemPage.url().startsWith(PORTAL)) {
    await systemPage.goto(PORTAL + "/admin/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  if (!(await status()).loggedIn) throw new Error("سجّل الدخول أولاً في نافذة Edge التي فتحها الوكيل.");
  if (busy) throw new Error("الوكيل ينفّذ أمراً آخر الآن.");
  busy = true;
  try {
    return await systemPage.evaluate(async (cmd) => {
      const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      const digits = (s) => String(s == null ? "" : s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
      const parse = (html) => new DOMParser().parseFromString(html, "text/html");
      const allowed = (method, path) => {
        const u = new URL(path, location.origin);
        if (u.origin !== location.origin) throw new Error("حُظر طلب خارج النظام.");
        const p = u.pathname + u.search;
        const ok = method === "GET"
          ? /^\/admin\/students(?:\?[^#]*)?$/.test(p) || p === "/admin/students/create"
          : method === "POST" && p === "/admin/students";
        if (!ok) throw new Error("هذا الإجراء غير متاح للوكيل.");
        return p;
      };
      const http = async (method, path, body) => {
        const target = allowed(method, path);
        const res = await fetch(target, { method, body, credentials: "same-origin", redirect: "follow" });
        if (/\/login(?:[/?#]|$)/i.test(new URL(res.url).pathname)) throw new Error("انتهت الجلسة؛ سجّل الدخول ثم أعد الأمر.");
        if (res.status === 419) throw new Error("انتهت صلاحية نموذج النظام؛ أعد المحاولة.");
        if (!res.ok) throw new Error("رفض النظام الطلب (HTTP " + res.status + ").");
        return { doc: parse(await res.text()), status: res.status };
      };
      const tableRows = (doc) => {
        let best = null, bestN = 0;
        doc.querySelectorAll("table").forEach((t) => {
          const n = t.querySelectorAll("tbody tr").length;
          if (n > bestN) { best = t; bestN = n; }
        });
        if (!best) return { heads: [], rows: [] };
        const allHeads = [...best.querySelectorAll("thead th")].map((th) => clean(th.textContent));
        const keep = allHeads.map((h) => !/إجراء|عمليات|خيارات|actions?/i.test(h));
        const heads = allHeads.filter((h, i) => keep[i]);
        const rows = [...best.querySelectorAll("tbody tr")].map((tr) => {
          const cells = [...tr.children].map((td, i) => {
            if (keep[i] === false) return null;
            const c = td.cloneNode(true);
            c.querySelectorAll("form,.modal,button,script,style,svg").forEach((x) => x.remove());
            return clean(c.textContent);
          }).filter((x) => x !== null);
          let id = "";
          tr.querySelectorAll("a[href]").forEach((a) => {
            const m = (a.getAttribute("href") || "").match(/\/admin\/students\/(\d+)(?:[?#]|$)/);
            if (m && !id) id = m[1];
          });
          return { id, cells };
        }).filter((r) => r.cells.some(Boolean));
        return { heads, rows };
      };
      const qs = (o) => Object.keys(o).filter((k) => o[k] !== "" && o[k] != null)
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])).join("&");
      const findStudent = async (q) => {
        const { doc } = await http("GET", "/admin/students?" + qs({ q, per_page: "100" }));
        const table = tableRows(doc);
        const nid = digits(q);
        const rows = nid.length === 9 && !/[^\d٠-٩\s-]/.test(String(q))
          ? table.rows.filter((r) => digits(r.cells.join(" ")).includes(nid)) : table.rows;
        return { q, count: rows.length, heads: table.heads, rows: rows.slice(0, 50) };
      };

      if (cmd.type === "lookup") {
        const items = [];
        for (const item of cmd.items) items.push(await findStudent(item.q));
        return { type: "lookup", items };
      }
      if (cmd.type === "list") {
        const params = { per_page: "100" };
        for (const [key, value] of Object.entries(cmd.params || {})) {
          if (!["track_id", "training_course_id", "status", "group_status", "q"].includes(key)) throw new Error("مرشح قائمة غير مسموح.");
          if (typeof value !== "string" || value.length > 120) throw new Error("قيمة مرشح غير صالحة.");
          params[key] = value;
        }
        let path = "/admin/students?" + qs(params);
        const out = { type: "list", heads: [], rows: [], pages: 0 };
        while (path && out.pages < 60) {
          const { doc } = await http("GET", path);
          const table = tableRows(doc);
          if (!out.heads.length) out.heads = table.heads;
          out.rows.push(...table.rows);
          out.pages++;
          const next = doc.querySelector('a[rel="next"]');
          if (!next) break;
          const u = new URL(next.getAttribute("href"), location.origin);
          if (u.origin !== location.origin || u.pathname !== "/admin/students") throw new Error("رابط صفحة تالية غير متوقع.");
          path = u.pathname + u.search;
        }
        return out;
      }
      if (cmd.type === "register") {
        if (!Array.isArray(cmd.rows) || !cmd.rows.length || cmd.rows.length > 80) throw new Error("ملف التسجيل يجب أن يحتوي من طالب واحد إلى 80 طالباً.");
        const live = await http("GET", "/admin/students/create");
        const form = [...live.doc.querySelectorAll("form")].find((f) =>
          (f.getAttribute("method") || "").toLowerCase() === "post" &&
          new URL(f.getAttribute("action") || "", location.origin).pathname === "/admin/students" && f.querySelector('[name="full_name"]'));
        if (!form) throw new Error("تعذّر العثور على نموذج إضافة الطالب.");
        const formNames = new Set([...form.querySelectorAll("input,select,textarea")].map((el) => el.getAttribute("name")).filter(Boolean));
        const required = [...form.querySelectorAll("[required]")].map((el) => el.getAttribute("name")).filter(Boolean);
        const results = [];
        let fails = 0;
        for (const row of cmd.rows) {
          const name = clean(row.full_name), nid = digits(row.national_id);
          const missing = required.filter((k) => !clean(row[k]) && !/^password/.test(k) && k !== "must_change_password");
          if (!name || nid.length !== 9 || missing.length) {
            results.push({ name, nid, status: "invalid", message: !name ? "الاسم مطلوب" : nid.length !== 9 ? "رقم الهوية يجب أن يتكون من 9 أرقام" : "حقول مطلوبة ناقصة: " + missing.join("، ") });
            continue;
          }
          let badOption = "";
          form.querySelectorAll("select[name]").forEach((select) => {
            const k = select.name;
            if (row[k] != null && row[k] !== "" && ![...select.options].some((o) => o.value === String(row[k]))) badOption = k;
          });
          if (badOption) { results.push({ name, nid, status: "invalid", message: "قيمة غير موجودة في قائمة " + badOption }); continue; }
          try {
            const existing = await findStudent(nid);
            if (existing.count) { results.push({ name, nid, status: "exists", message: "مسجّل مسبقاً" }); continue; }
            const fresh = await http("GET", "/admin/students/create");
            const liveForm = [...fresh.doc.querySelectorAll("form")].find((f) =>
              (f.getAttribute("method") || "").toLowerCase() === "post" &&
              new URL(f.getAttribute("action") || "", location.origin).pathname === "/admin/students" && f.querySelector('[name="full_name"]'));
            if (!liveForm) throw new Error("نموذج الإضافة غير متاح.");
            const fd = new FormData(liveForm);
            for (const key of [...fd.keys()]) if (/^password/i.test(key) || key === "must_change_password") fd.delete(key);
            for (const [key, value] of Object.entries(row)) {
              if (!formNames.has(key) || value == null || value === "" || key.startsWith("_") || /^password/.test(key) || key === "must_change_password") continue;
              fd.set(key, String(value));
            }
            const post = await http("POST", "/admin/students", fd);
            const errors = [...post.doc.querySelectorAll(".invalid-feedback,.text-danger,.alert-danger")].map((e) => clean(e.textContent)).filter(Boolean);
            const verified = await findStudent(nid);
            if (verified.count) { results.push({ name, nid, status: "created", message: "تم التسجيل والتحقق منه" }); fails = 0; }
            else if (errors.length) { results.push({ name, nid, status: "failed", message: errors.slice(0, 3).join(" | ") }); fails++; }
            else { results.push({ name, nid, status: "unverified", message: "أُرسل الطلب لكن لم يظهر الطالب؛ تحقّق من النظام" }); fails++; }
          } catch (error) {
            results.push({ name, nid, status: "failed", message: error.message || String(error) });
            fails++;
            if (fails >= 3) {
              for (const rest of cmd.rows.slice(results.length)) results.push({ name: clean(rest.full_name), nid: digits(rest.national_id), status: "skipped", message: "توقف الوكيل بعد ثلاثة إخفاقات" });
              break;
            }
          }
        }
        return { type: "register", label: "من ملف Excel", rows: results };
      }
      throw new Error("نوع أمر غير مدعوم.");
    }, command);
  } finally { busy = false; }
}

function serveStatic(req, res, pathname) {
  let requested;
  try { requested = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); }
  catch { res.writeHead(400).end("Bad request"); return; }
  const file = path.resolve(ROOT, "." + requested);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end("Forbidden"); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end("Not found"); return; }
    const ext = path.extname(file).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "no-store" });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/api/status" && req.method === "GET") return json(res, 200, await status());
  if (url.pathname === "/api/command" && req.method === "POST") {
    let originHost = "";
    try { originHost = new URL(req.headers.origin || "").hostname; } catch { }
    if (!allowedOrigin(req) || req.headers.host !== `${originHost}:${PORT}` || !/^application\/json\b/i.test(req.headers["content-type"] || "")) return json(res, 403, { error: "طلب محلي غير مسموح." });
    if (busy) return json(res, 409, { error: "الوكيل ينفّذ أمراً آخر الآن." });
    try {
      const command = await readJson(req);
      validateCommand(command);
      const result = await runInPortal(command);
      return json(res, 200, { ok: true, result });
    } catch (error) { return json(res, 400, { ok: false, error: error.message || String(error) }); }
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end("Method not allowed"); return; }
  serveStatic(req, res, url.pathname);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Close the older Tamkeen server and run تشغيل.bat again.`);
  else console.error("The local agent server could not start:", error.message || String(error));
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Tamkeen local agent is ready at http://localhost:${PORT}/`);
  console.log("The agent runs only on this computer and only uses the authenticated portal page.");
  execFile("powershell.exe", ["-NoProfile", "-Command", `Start-Process 'http://localhost:${PORT}/'`], { windowsHide: true }, () => {});
  startBrowser();
});

async function stop() {
  server.close();
  if (context) await context.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
