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
    await app.eval("App.centerAgent.allowSynthetic = true; 1");   // الاختبار يستدعي run مباشرة بلا ضغطة حقيقية
    const v = await app.eval("App.centerAgent.version()");
    step("إصدار الإضافة", /^1\.[45]/.test(v), v);
    step("الصفحة تعرض دالة الإيقاف", await app.eval("typeof App.centerAgent.stop === 'function'"));

    // ===== نتائج تباعاً =====
    await app.eval(`window.__pt = []; window.__done = null; window.__t0 = Date.now();
      App.centerAgent.run([
        {type:'list',label:'a',params:{track_id:'2',per_page:'2'},details:true},
        {type:'list',label:'b',params:{track_id:'1',per_page:'2'}},
        {type:'lookup',label:'c',items:[{q:'طالب تجريبي 3'}]}],
        { onPartial: (i, r) => window.__pt.push({ i, type: r && r.type, at: Date.now() - window.__t0 }) })
        .then((d) => { window.__done = { at: Date.now() - window.__t0, n: d.results.length }; }); 1`);
    await waitFor(() => app.eval("!!window.__done"), 60000, "انتهاء الأوامر الثلاثة");
    const pt = JSON.parse(await app.eval("JSON.stringify(window.__pt)")), done = JSON.parse(await app.eval("JSON.stringify(window.__done)"));
    step("وصلت نتيجة كل أمر تباعاً (3 نتائج جزئية)", pt.length === 3 && pt.map((x) => x.i).join() === "0,1,2", JSON.stringify(pt.map((x) => x.i + ":" + x.type + "@" + x.at)));
    step("النتيجة الأولى وصلت قبل انتهاء الباقي", pt[0].at < done.at - 300, "الأولى " + pt[0].at + "ms، النهاية " + done.at + "ms");
    step("النتائج النهائية 3", done.n === 3);

    // ===== الإيقاف أثناء قراءة طويلة =====
    await app.eval(`window.__done2 = null; window.__pt2 = []; window.__t1 = Date.now();
      App.centerAgent.run([{type:'list',label:'long',params:{track_id:'2',per_page:'3'},details:true}],
        { onPartial: (i, r) => window.__pt2.push(i) })
        .then((d) => { window.__done2 = { at: Date.now() - window.__t1, d }; }); 1`);
    await sleep(3500);
    const beforeStop = await app.eval("!!window.__done2");
    await app.eval("App.centerAgent.stop(); 1");
    await waitFor(() => app.eval("!!window.__done2"), 30000, "نتائج بعد الإيقاف");
    const d2 = JSON.parse(await app.eval("JSON.stringify(window.__done2)"));
    const L = d2.d.results && d2.d.results[0];
    step("لم تكن القراءة قد انتهت وقت الإيقاف", beforeStop === false);
    step("بعد الإيقاف عادت نتائج جزئية (لا ضياع)", !!(L && L.rows && L.rows.length), L && (L.rows.length + " صفاً"));
    step("توقفت قراءة البيانات الكاملة قبل اكتمالها", !!(L && L.details && L.details.read < L.rows.length), L && L.details && (L.details.read + " من " + L.rows.length));
    step("انتهى بسرعة بعد الإيقاف", d2.at < 12000, d2.at + "ms");
  } catch (e) {
    step("خطأ في الاختبار", false, e.message);
  } finally {
    try { edge.kill(); } catch (e) { /* */ }
    log("\n" + steps.filter((s) => s.startsWith("✗")).length + " إخفاق من " + steps.length);
    process.exit(0);
  }
})();
