/* اختبار «بلا ملفات»: صفحة تمكين ← الإضافة ← نظام المركز الوهمي ← النتيجة تعود للصفحة. */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TAMKEEN = path.resolve(__dirname, "..", "..");
const EXT = process.env.KX_EXT || path.join(os.tmpdir(), "tamkeen-ext-test");   // تبنيه run.js
const PORT = 9334;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "kx-edge-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const steps = [];
const step = (n, ok, extra) => { steps.push((ok ? "✓ " : "✗ ") + n + (extra ? " — " + extra : "")); log(steps[steps.length - 1]); };

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.cb = new Map();
    this.ready = new Promise((r) => this.ws.addEventListener("open", r));
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.cb.has(m.id)) { const { res, rej } = this.cb.get(m.id); this.cb.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    });
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.cb.delete(id); rej(new Error("مهلة CDP: " + method)); }, 20000);
      this.cb.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* */ } }
}
const getJson = async (p) => (await fetch("http://127.0.0.1:" + PORT + p)).json();
async function waitFor(fn, ms, what) {
  const t0 = Date.now(); let last = "";
  for (;;) {
    const v = await fn().catch((e) => { last = e.message; return null; });
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("انتهت المهلة: " + what + (last ? " [" + last.slice(0, 140) + "]" : ""));
    await sleep(300);
  }
}
const students = async () => (await fetch("http://localhost:4197/__students")).json();

/* خادمان ثابتان: صفحة تمكين الحقيقية على 4180، وصفحة اختبار صغيرة على 4196 */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(TAMKEEN, u === "/" ? "index.html" : u);
  if (!f.startsWith(TAMKEEN) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(4180);
http.createServer((req, res) => {
  if (req.url.startsWith("/center-agent.js")) { res.writeHead(200, { "Content-Type": MIME[".js"] }); return res.end(fs.readFileSync(path.join(TAMKEEN, "src", "center-agent.js"))); }
  res.writeHead(200, { "Content-Type": MIME[".html"] });
  res.end('<!doctype html><meta charset="utf-8"><body>stub<script src="/center-agent.js"></script></body>');
}).listen(4196);

(async () => {
  const edge = spawn(process.env.BROWSER, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--load-extension=" + EXT, "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });
  try {
    const ver = await waitFor(() => getJson("/json/version"), 20000, "المتصفح");
    const browser = new CDP(ver.webSocketDebuggerUrl);
    const t = await browser.send("Target.createTarget", { url: "http://localhost:4196/" });
    const tt = await waitFor(async () => (await getJson("/json")).find((x) => x.id === t.targetId), 10000, "تبويب تمكين");
    const app = new CDP(tt.webSocketDebuggerUrl); await app.send("Runtime.enable");
    await waitFor(() => app.eval("typeof App !== 'undefined' && !!App.centerAgent"), 10000, "وحدة center-agent");
    await waitFor(() => app.eval("App.centerAgent.ready(1500)"), 12000, "الإضافة");
    const v = await app.eval("App.centerAgent.version()");
    step("إصدار الإضافة المختبَرة", true, v);

    // الخلفية: نقرأ حالة التبويبات من داخل الإضافة نفسها
    const sw = await waitFor(async () => (await getJson("/json")).find((x) => x.type === "service_worker" && /background\.js/.test(x.url) && /^chrome-extension/.test(x.url)), 15000, "service worker للإضافة");
    const swc = new CDP(sw.webSocketDebuggerUrl); await swc.send("Runtime.enable");
    const tabsNow = async () => JSON.parse(await swc.eval(`chrome.tabs.query({}).then(ts => JSON.stringify(ts.map(t => ({ id: t.id, url: (t.url || t.pendingUrl || "").slice(0, 45), active: t.active, win: t.windowId }))))`)).map((t) => Object.assign(t, { k: /4197/.test(t.url) ? "ksach" : /4196/.test(t.url) || t.url === "" ? "app" : "other" }));
    const before = await tabsNow();
    const appId = (before.find((x) => x.active) || {}).id;
    const beforeIds = new Set(before.map((x) => x.id));
    const ksachBefore = before.filter((x) => x.k === "ksach").length;
    step("لا تبويب نظام مفتوح قبل التنفيذ (متصفح نظيف)", ksachBefore === 0, ksachBefore + " تبويب");
    step("قبل التنفيذ: تبويبات", true, JSON.stringify(before));

    await app.eval(`window.__out = null; App.centerAgent.run([{type:'list',label:'l',params:{track_id:'2',per_page:'2'},details:true}], { onProgress: (t) => (window.__ev = (window.__ev || []).concat(t)) }).then((d) => { window.__out = d; }); 1`);
    let sawKsach = false, ksachActive = false, appActiveAlways = true, samples = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const ts = await tabsNow(); samples++;
      if (samples === 12) log("لقطة " + samples + ": " + JSON.stringify(ts.filter((x) => x.k !== "other")));
      const k = ts.find((x) => !beforeIds.has(x.id) && x.k !== "other"), a = ts.find((x) => x.id === appId);
      if (k) { sawKsach = true; if (k.active) ksachActive = true; }
      if (a && !a.active) appActiveAlways = false;
      if (await app.eval("!!window.__out")) break;
      await sleep(150);
    }
    step("فُتح تبويب نظام المركز للتنفيذ", sawKsach, samples + " قياساً");
    step("تبويب النظام لم يصبح نشطاً (لا انتقال)", sawKsach && !ksachActive);
    step("تبويب تمكين بقي نشطاً طوال التنفيذ", appActiveAlways);
    const out = JSON.parse(await app.eval("JSON.stringify(window.__out || null)"));
    step("النتيجة عادت إلى تمكين", !!(out && out.results && out.results[0] && out.results[0].rows.length), out && out.results && out.results[0] && out.results[0].rows.length + " صفاً");
    const ev = JSON.parse(await app.eval("JSON.stringify(window.__ev || [])"));
    step("وصلت رسائل التقدّم", ev.length >= 2, ev.length + " رسالة: " + (ev[ev.length - 1] || ""));
  } catch (e) {
    step("خطأ في الاختبار", false, e.message);
  } finally {
    try { edge.kill(); } catch (e) { /* */ }
    log("\n" + steps.filter((s) => s.startsWith("✗")).length + " إخفاق من " + steps.length);
    process.exit(0);
  }
})();
