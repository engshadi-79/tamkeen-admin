/* اختبار واجهة «أوامر المركز» آلياً: صفحة تمكين الحقيقية ضد وكيل وهمي (بلا إضافة). يشغّل ui-suite.js داخل الصفحة. */
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
      const t = setTimeout(() => { this.cb.delete(id); rej(new Error("مهلة CDP: " + method)); }, 600000);
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
    "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=IntensiveWakeUpThrottling", "about:blank",
  ], { stdio: "ignore" });
  try {
    const ver = await waitFor(() => getJson("/json/version"), 20000, "المتصفح");
    const browser = new CDP(ver.webSocketDebuggerUrl);
    const t = await browser.send("Target.createTarget", { url: "http://localhost:4180/" });
    const tt = await waitFor(async () => (await getJson("/json")).find((x) => x.id === t.targetId), 10000, "تبويب تمكين");
    const app = new CDP(tt.webSocketDebuggerUrl); await app.send("Runtime.enable");
    await waitFor(() => app.eval("typeof App !== 'undefined' && !!App.centerCmd && !!App.centerAgent && !!App.converterStore"), 30000, "تحميل تمكين");
    // نعرض تبويب أوامر المركز بدل شاشة الدخول
    await app.eval(`(()=>{const ls=document.getElementById('login-screen'); if(ls) ls.remove(); document.body.classList.remove('locked');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); const v=document.getElementById('view-center'); v.classList.add('active'); v.style.display='block'; return 1})()`);
    await sleep(800);
    const suiteSrc = fs.readFileSync(path.join(__dirname, "ui-suite.js"), "utf8");
    const results = await app.eval("(" + suiteSrc + ")()");
    results.forEach((r) => { steps.push(r); log(r); });
  } catch (e) {
    step("خطأ في الاختبار", false, e.message);
  } finally {
    try { edge.kill(); } catch (e) { /* */ }
    log("\n" + steps.filter((s) => s.startsWith("✗")).length + " إخفاق من " + steps.length);
    process.exit(0);
  }
})();
