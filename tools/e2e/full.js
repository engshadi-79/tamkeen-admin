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
  const open = async (browser, url) => {
    const t = await browser.send("Target.createTarget", { url });
    const tt = await waitFor(async () => (await getJson("/json")).find((x) => x.id === t.targetId), 10000, "تبويب " + url);
    const c = new CDP(tt.webSocketDebuggerUrl);
    await c.send("Runtime.enable");
    return { c, id: t.targetId };
  };
  try {
    const ver = await waitFor(() => getJson("/json/version"), 20000, "المتصفح");
    const browser = new CDP(ver.webSocketDebuggerUrl);

    // ===== أ) صفحة اختبار تستعمل center-agent.js الحقيقي =====
    const stub = await open(browser, "http://localhost:4196/");
    await waitFor(() => stub.c.eval("typeof App !== 'undefined' && !!App.centerAgent"), 10000, "وحدة center-agent");
    const ready = await waitFor(() => stub.c.eval("App.centerAgent.ready(1500)"), 12000, "الإضافة تعلن جاهزيتها");
    // الحارس: بلا ضغطة مستخدم حقيقية لا تُرسَل أي قراءة إلى نظام المركز
    await stub.c.eval("window.__denied = null; App.centerAgent.run([{type:'list',label:'x',params:{track_id:'2'}}], {}).then(() => { window.__denied = 'ran'; }).catch((e) => { window.__denied = e.message; }); 1");
    const denied = await waitFor(() => stub.c.eval("window.__denied"), 5000, "رفض القراءة بلا ضغطة");
    step("القراءة بلا ضغطة حقيقية تُرفض قبل أن تصل إلى نظام المركز", /إلا بضغطة منك/.test(String(denied)), denied);
    await stub.c.eval("App.centerAgent.allowSynthetic = true; 1");   // الاختبار يستدعي run مباشرة بلا ضغطة حقيقية
    step("الصفحة تتعرّف على الإضافة تلقائياً", ready === true, "version=" + await stub.c.eval("App.centerAgent.version()"));

    const NID = "48" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    const before = (await students()).length;
    await stub.c.eval(`window.__ev = []; window.__plan = null;
      window.__p = App.centerAgent.run([{type:'register',label:'t',rows:[{full_name:'من الصفحة',gender:'female',national_id:'${NID}',phone_1:'0591111111',status:'active',track_id:'2'}]}],
        { onProgress: (t) => window.__ev.push(t), onPlan: (p) => new Promise((r) => { window.__plan = p; window.__approve = r; }) })
        .then((d) => { window.__out = d; return 'ok'; }).catch((e) => { window.__err = e.message; });
      'started'`);
    const plan = await waitFor(() => stub.c.eval("window.__plan && JSON.stringify({c:window.__plan.create,e:window.__plan.exists,i:window.__plan.invalid})"), 40000, "خطة التسجيل في الصفحة");
    step("الخطة وصلت إلى صفحة تمكين قبل أي كتابة", plan === '{"c":1,"e":0,"i":0}', plan);
    const mid = (await students()).length;
    step("لا كتابة قبل موافقة الصفحة", mid === before, before + " → " + mid);
    await stub.c.eval("window.__approve(true)");
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "النتائج");
    const out = await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})");
    const res = JSON.parse(out);
    const row = res.results && res.results[0].rows[0];
    step("النتيجة عادت إلى الصفحة وسُجّل الطالب", row && row.status === "created", out.slice(0, 110));
    step("طالب واحد أُضيف", (await students()).length === before + 1);
    const ev = JSON.parse(await stub.c.eval("JSON.stringify(window.__ev)"));
    step("وصل تقدّم التنفيذ إلى الصفحة وآخر رسالة منه لم تُسقَط", ev.length >= 2 && /تسجيل/.test(ev[ev.length - 1]), ev.length + " رسالة، آخرها: " + ev[ev.length - 1]);

    // رفض الموافقة: لا كتابة ويُسجَّل «لم يُنفَّذ»
    const NID2 = "48" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    const b2 = (await students()).length;
    await stub.c.eval(`window.__plan = null; window.__out = null; window.__err = null;
      window.__p = App.centerAgent.run([{type:'register',label:'t2',rows:[{full_name:'مرفوض',gender:'male',national_id:'${NID2}',phone_1:'0592222222',status:'active',track_id:'1'}]}],
        { onPlan: (p) => new Promise((r) => { window.__plan = p; window.__approve = r; }) })
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__plan"), 40000, "الخطة الثانية");
    await stub.c.eval("window.__approve(false)");
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "نتائج الرفض");
    const r2 = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    step("عند الرفض لم يُكتب شيء وسُجّل «لم يُنفَّذ»", (await students()).length === b2 && r2.results && r2.results[0].rows[0].status === "skipped", JSON.stringify(r2.results && r2.results[0].rows[0].status));

    // استعلام: يُنفَّذ مباشرة بلا موافقة
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'lookup',label:'q',items:[{q:'طالب تجريبي 3'}]}], {}).then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "نتائج الاستعلام");
    const r3 = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    step("الاستعلام يُنفَّذ بلا موافقة ويعود", r3.results && r3.results[0].items[0].count === 1, JSON.stringify(r3.results && r3.results[0].items[0].count));
    // صفحة تقرير (قياس الأثر): كل الجداول والأرقام وقائمة التصفية، بطلب GET واحد للرابط المسموح فقط
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'page',source:'impact',label:'أثر',params:{date_from:'2026-09-01',date_to:'2026-11-11'}}], {})
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "قراءة صفحة قياس الأثر");
    const rp = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const P = rp.results && rp.results[0];
    step("صفحة قياس الأثر: جدولان بعناوينهما وصفوفهما", P && P.type === "page" && P.tables.length === 2 && P.tables[0].title === "حسب المسار والمرحلة" && P.tables[0].rows.length === 4 && P.tables[0].heads.includes("المرحلة"), JSON.stringify(P && P.tables && P.tables.map((t) => t.title + ":" + t.rows.length)));
    step("وأرقام البطاقات وقائمة التصفية (الحالة)", P && P.stats.some((s) => s.value === "137") && P.stats.some((s) => s.value === "75%") && P.filters.some((f) => f.name === "status" && f.options.length === 2), JSON.stringify(P && { stats: P.stats, filters: P.filters.map((f) => f.name) }));
    const hp = JSON.parse(await (await fetch("http://localhost:4197/__hits")).text());
    step("طُلب الرابط المسموح وحده لقراءة التقرير (GET)", hp.filter((x) => /evaluation-impact-reports/.test(x)).length === 1 && hp.filter((x) => /^POST/.test(x) && /impact/.test(x)).length === 0, JSON.stringify(hp.filter((x) => /impact/.test(x))));
    // قبلي/بعدي: الصفحة تفتح بمرحلة افتراضية؛ الوكيل يوسّعها إلى «الكل» بقراءة إضافية واحدة
    await fetch("http://localhost:4197/__hits?reset=1").catch(() => {});
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'page',source:'pre-post',label:'قبلي',params:{date_from:'2026-09-01',date_to:'2026-11-11'}}], {})
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "قراءة صفحة قبلي/بعدي");
    const rq = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const Q = rq.results && rq.results[0];
    const hq = JSON.parse(await (await fetch("http://localhost:4197/__hits")).text()).filter((x) => /pre-post/.test(x));
    step("قبلي/بعدي: التصفية الافتراضية (مرحلة) تُوسَّع إلى الكل", Q && Q.params && Q.params.stage === "" && (Q.widened || []).length === 2 && Q.filters.some((f) => f.name === "stages[]" && f.type === "checkbox" && f.options.length === 3) && (Q.params["stages[]"] || []).length === 0 && hq.length >= 2, JSON.stringify({ params: Q && Q.params, widened: Q && Q.widened, hq }));
    // إحصائيات الأسئلة: بطاقة لكل سؤال تُحلَّل إلى صفوف
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'page',source:'questions',label:'أسئلة',params:{track_id:'2'}}], {})
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 40000, "قراءة صفحة الأسئلة");
    const rqs = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const QT = rqs.results && rqs.results[0] && rqs.results[0].tables && rqs.results[0].tables[0];
    step("إحصائيات الأسئلة: سؤالان بنصهما ونموذجهما وعدد الإجابات والمتوسط والتوزيع", QT && QT.rows.length === 2 && QT.rows[0].cells[0].includes("قصات الشعر") && /التسويق الرقمي - قبلي/.test(QT.rows[0].cells[1]) && QT.rows[0].cells[2] === "مقياس 1-5" && QT.rows[0].cells[3] === "105" && QT.rows[0].cells[4] === "2.91" && QT.rows[0].cells.slice(5, 10).join() === "13,18,46,21,7", JSON.stringify(QT && QT.rows));
    // الحضور والغياب: جلسات المجموعة ثم حضور كل جلسة، بقراءة GET فقط
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'attendance',label:'حضور',params:{date_from:'2026-11-01',date_to:'2026-11-12'},groupCodes:['G2'],trackNames:[],stages:['الثان']}], {})
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 60000, "قراءة الحضور");
    const ra = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const AT = ra.results && ra.results[0];
    step("الحضور: جلستان للمجموعة G2 بطلابهما وحالاتهم", AT && AT.type === "attendance" && AT.sessions.length === 2 && AT.sessions[0].rows.length === 3 && AT.sessions[0].rows[0].status === "absent" && AT.sessions[0].rows[0].sid === "10" && /STU-2026-111/.test(AT.sessions[0].rows[0].stu) && AT.sessions[1].rows[1].status === "excused", JSON.stringify(AT && AT.sessions && AT.sessions.map((s) => s.id + ":" + s.rows.map((r) => r.status).join(","))));
    const ha = JSON.parse(await (await fetch("http://localhost:4197/__hits")).text()).filter((x) => /training-attendances/.test(x));
    step("الحضور: كل الطلبات GET ولا POST إطلاقاً", ha.length >= 4 && ha.every((x) => /^GET/.test(x)), JSON.stringify(ha));
    // قائمة بكل البيانات: الأعمدة تتجاوز أعمدة الجدول إلى حقول نموذج التعديل
    await stub.c.eval(`window.__out = null; window.__err = null; window.__ev = [];
      App.centerAgent.run([{type:'list',label:'d',params:{track_id:'2',per_page:'3'},details:true}], { onProgress: (t) => window.__ev.push(t) })
        .then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 90000, "قائمة بكل البيانات");
    const rd = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const L = rd.results && rd.results[0];
    const heads = (L && L.heads) || [];
    const row0 = (L && L.rows && L.rows[0]) || { cells: [] };
    step("القائمة صارت تحمل بيانات كل طالب لا أعمدة الجدول فقط", heads.includes("تاريخ الميلاد") && heads.includes("المحافظة الحالية") && heads.includes("المستوى التعليمي"), heads.length + " عموداً");
    const ix = (h) => row0.cells[heads.indexOf(h)];
    step("القيم هي نص الخيار لا رمزه", ix("المحافظة الحالية") === "غزة" && ix("الجنس") === "أنثى" && ix("المستوى التعليمي") === "بكالوريوس", [ix("المحافظة الحالية"), ix("الجنس"), ix("المستوى التعليمي")].join(" | "));
    step("حقول مكتوبة (عنوان وتاريخ) قُرئت", ix("تاريخ الميلاد") === "1998-05-20" && /حي الرمال/.test(ix("عنوان السكن الحالي بالتفصيل") || ""), ix("تاريخ الميلاد"));
    step("لا كلمات مرور ولا رموز حماية في النتيجة", !heads.some((h) => /كلمة|password|token|إلزام/i.test(h)) && !JSON.stringify(L).includes("X\""), heads.filter((h) => /كلمة|password/i.test(h)).join(",") || "لا شيء");
    step("كل الصفوف اكتملت أعمدتها", L.rows.every((r) => r.cells.length === heads.length), L.rows.length + " صفاً");
    step("ملخّص القراءة الكاملة موجود", L.details && L.details.read === L.rows.length, JSON.stringify(L.details));
    // استعلام عن شخص مع «كل بياناته»
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'lookup',label:'q',items:[{q:'طالب تجريبي 6'}],details:true}], {}).then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 60000, "استعلام بكل البيانات");
    const q2 = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const it = q2.results && q2.results[0].items[0];
    step("الاستعلام عن شخص يعيد كل بياناته", it && it.count === 1 && it.heads.includes("تاريخ الميلاد") && it.rows[0].cells.length === it.heads.length, it && it.heads.length + " عموداً");
    // أمر «تصدير Excel»: طلب GET واحد يعيد الملف نفسه (بيانات الطالب والمتقدم)
    const hitsBefore = JSON.parse(await (await fetch("http://localhost:4197/__hits")).text()).length;
    await stub.c.eval(`window.__out = null; window.__err = null;
      App.centerAgent.run([{type:'export',label:'تصدير',params:{status:'active'}}], {}).then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
    await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 60000, "أمر التصدير");
    const q3 = JSON.parse(await stub.c.eval("JSON.stringify(window.__out || {err: window.__err})"));
    const E = q3.results && q3.results[0];
    step("أمر التصدير عبر الإضافة يعيد ملف xlsx حقيقياً (PK) بحجمه واسمه", !!E && E.type === "export" && E.bytes > 200 && Buffer.from(E.b64 || "", "base64").slice(0, 2).toString() === "PK" && /\.xlsx$/i.test(E.name || ""), E ? E.bytes + " بايت · " + E.name : JSON.stringify(q3).slice(0, 160));
    const hx = JSON.parse(await (await fetch("http://localhost:4197/__hits")).text()).slice(hitsBefore).filter((x) => !/__hits|favicon/.test(x));
    step("الإضافة طلبت التصدير مرة واحدة فقط وبـ GET فقط (لا قراءة صفحات ولا كتابة)", hx.filter((x) => /export-excel/.test(x)).length === 1 && hx.every((x) => /^GET /.test(x)), hx.join(" | ").slice(0, 160));

    // أمر «cancel»: إلغاء طلب الطالب («ملغي») ثم إخراجه من مجموعته — بعد معاينة وموافقة
    const runCancel = async (items, approve, extra) => {
      await stub.c.eval(`window.__out = null; window.__err = null; window.__plan = null;
        App.centerAgent.run([Object.assign({type:'cancel',label:'إلغاء',items:${JSON.stringify(items)},status:'cancelled',removeFromGroup:true}, ${JSON.stringify(extra || {})})], { onPlan: (p) => { window.__plan = p; return ${approve === false ? "false" : "true"}; } }).then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
      await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 90000, "أمر الإلغاء");
      return JSON.parse(await stub.c.eval("JSON.stringify({ out: window.__out, err: window.__err, plan: window.__plan })"));
    };
    const c1 = await runCancel([{ stu: "STU-20260101-00003", name: "طالب تجريبي 3" }, { stu: "STU-99999999-00000", name: "غير موجود" }]);
    const R1 = c1.out && c1.out.results && c1.out.results[0];
    step("المعاينة قبل الكتابة: سيُلغى 1 ولن يُنفَّذ 1 (غير موجود)", !!c1.plan && c1.plan.kind === "cancel" && c1.plan.cancel === 1 && c1.plan.invalid === 1, JSON.stringify(c1.plan && { c: c1.plan.cancel, i: c1.plan.invalid, err: c1.err }));
    const S3 = (await students()).find((x) => x.stu === "STU-20260101-00003");
    step("بعد الموافقة: الطلب «ملغي» في النظام والطالب أُخرج من مجموعته", S3 && S3.appStatus === "cancelled" && !S3.member && R1 && R1.rows.some((r) => r.stu === "STU-20260101-00003" && r.app === "cancelled" && r.group === "removed"), JSON.stringify({ s: S3 && { a: S3.appStatus, m: S3.member }, rows: R1 && R1.rows }));
    step("الطلاب الآخرون لم يُمسّوا (طلباتهم «مقبول» وعضوياتهم باقية)", (await students()).filter((x) => x.stu && x.stu !== "STU-20260101-00003").every((x) => x.appStatus === "accepted" && x.member), JSON.stringify((await students()).filter((x) => x.stu).map((x) => x.stu.slice(-2) + ":" + x.appStatus + ":" + x.member)));
    const c2 = await runCancel([{ stu: "STU-20260101-00003", name: "طالب تجريبي 3" }]);
    const R2 = c2.out && c2.out.results && c2.out.results[0];
    step("إعادة التنفيذ: «ملغي أصلاً» ولا عضوية — لا كتابة مكررة", R2 && R2.rows[0].app === "already" && R2.rows[0].group === "none", JSON.stringify(R2 && R2.rows));
    await fetch("http://localhost:4197/__cancelRemoves?on=1");
    const c3 = await runCancel([{ stu: "STU-20260101-00005", name: "طالب تجريبي 5" }]);
    const R3 = c3.out && c3.out.results && c3.out.results[0];
    step("نظام يُخرج تلقائياً عند الإلغاء: لا «إخراج» إضافي", R3 && R3.rows[0].app === "cancelled" && R3.rows[0].group === "none", JSON.stringify(R3 && R3.rows));
    await fetch("http://localhost:4197/__cancelRemoves?on=0");
    step("نتيجة الإلغاء تحمل رمز الحالة السابقة للتراجع (accepted)", R1 && R1.rows.some((r) => r.stu === "STU-20260101-00003" && r.wasCode === "accepted" && r.was === "مقبول"), JSON.stringify(R1 && R1.rows));
    // التراجع: إعادة الطلب إلى حالته السابقة (حالة لكل طالب)، بلا إخراج ولا إعادة إلى المجموعة
    const u1 = await runCancel([{ stu: "STU-20260101-00003", name: "طالب تجريبي 3", status: "accepted" }, { stu: "STU-20260101-00004", name: "طالب تجريبي 4", status: "bogus_state" }], true, { status: "", undo: true, removeFromGroup: false, label: "تراجع" });
    const U1 = u1.out && u1.out.results && u1.out.results[0], S3u = (await students()).find((x) => x.stu === "STU-20260101-00003");
    step("التراجع: المعاينة «undo» وحالة غير موجودة في النظام لا تُنفَّذ", !!u1.plan && u1.plan.undo === true && u1.plan.cancel === 1 && u1.plan.invalid === 1 && u1.plan.rows[0].to === "مقبول", JSON.stringify(u1.plan));
    step("التراجع: الطلب عاد «مقبول» في النظام، ولا كتابة على الطالب الآخر", S3u && S3u.appStatus === "accepted" && U1 && U1.rows.some((r) => r.stu === "STU-20260101-00003" && r.app === "cancelled" && r.group === "") && (await students()).find((x) => x.stu === "STU-20260101-00004").appStatus === "accepted", JSON.stringify({ a: S3u && S3u.appStatus, rows: U1 && U1.rows }));
    const c4 = await runCancel([{ stu: "STU-20260101-00006", name: "طالب تجريبي 6" }], false);
    const S6 = (await students()).find((x) => x.stu === "STU-20260101-00006");
    step("رفض الموافقة: لا كتابة إطلاقاً (الطلب «مقبول» والعضوية باقية)", S6 && S6.appStatus === "accepted" && !!S6.member && c4.out && c4.out.results[0].rows[0].app === "skipped", JSON.stringify({ s: S6 && { a: S6.appStatus, m: S6.member }, r: c4.out && c4.out.results[0].rows }));

    // أوامر كتابة 1.6.0: قائمة الطلبات، حالة الطلب، حالة الطالب، النقل بين المجموعات، تعديل البيانات — كلها بمعاينة وموافقة
    const runW = async (cmd, approve) => {
      await stub.c.eval(`window.__out = null; window.__err = null; window.__plan = null;
        App.centerAgent.run([${JSON.stringify(cmd)}], { onPlan: (p) => { window.__plan = p; return ${approve === false ? "false" : "true"}; } }).then((d) => { window.__out = d; }).catch((e) => { window.__err = e.message; }); 1`);
      await waitFor(() => stub.c.eval("!!window.__out || !!window.__err"), 120000, "أمر " + cmd.type);
      const o = JSON.parse(await stub.c.eval("JSON.stringify({ out: window.__out, err: window.__err, plan: window.__plan })"));
      o.R = o.out && o.out.results && o.out.results[0]; return o;
    };
    // البحث في الطلاب والمتقدمين والطلبات (1.6.1): متقدمة ليست طالبة تُوجد بجوالها، وبهويتها المقروءة بخطأ خانة
    const L1 = await runW({ type: "lookup", label: "بحث", sources: ["students", "applicants", "applications"], items: [{ q: "0599365506" }, { q: "904594889" }, { q: "0590000000" }] });
    const parts = (k) => ((L1.R && L1.R.items[k] && L1.R.items[k].parts) || []).map((p) => p.source + ":" + p.rows.length).join();
    step("البحث بالجوال: وُجدت في المتقدمين (حقل البحث «search» قُرئ من نموذج الصفحة)", /applicants:1/.test(parts(0)) && !/students/.test(parts(0)), parts(0) + " " + (L1.err || ""));
    step("البحث بهوية مقروءة بخطأ خانة (904594889): يُعاد صف المتقدمة 404594889", /applicants:1/.test(parts(1)), parts(1));
    step("رقم غير موجود: لا نتيجة في أي صفحة", !!L1.R && L1.R.items[2].count === 0, JSON.stringify(L1.R && L1.R.items[2]));
    const stuOf = async (n) => (await students()).find((x) => x.stu === "STU-20260101-0000" + n);
    const w0 = await runW({ type: "apps", label: "الطلبات", params: { status: "accepted" } });
    step("قراءة قائمة الطلبات: رقم الطلب والاسم والحالة لكل صف (قراءة فقط)", w0.R && w0.R.type === "apps" && w0.R.rows.length === (await students()).filter((x) => x.appStatus === "accepted").length && w0.R.rows.every((r) => /^\d+$/.test(r.app) && r.name && r.status === "مقبول"), JSON.stringify(w0.R && w0.R.rows.slice(0, 2)) + (w0.err || ""));
    const w1 = await runW({ type: "appstatus", label: "حالة", status: "waiting_list", items: [{ app: "5006", name: "طالب تجريبي 6" }, { app: "999999", name: "غير موجود" }] });
    step("حالة الطلب: معاينة «write» بالحالة قبل/بعد، وغير الموجود لا يُنفَّذ", !!w1.plan && w1.plan.kind === "write" && w1.plan.op === "appstatus" && w1.plan.todo === 1 && w1.plan.invalid === 1 && w1.plan.rows[0].from === "مقبول" && w1.plan.rows[0].to === "قائمة انتظار", JSON.stringify(w1.plan) + (w1.err || ""));
    step("حالة الطلب: صار «قائمة انتظار» في النظام، والنتيجة تحمل التراجع (accepted)", (await stuOf(6)).appStatus === "waiting_list" && w1.R.rows.some((r) => r.res === "done" && r.undo && r.undo.status === "accepted"), JSON.stringify(w1.R && w1.R.rows));
    const w1u = await runW({ type: "appstatus", undo: true, items: [w1.R.rows.find((r) => r.res === "done").undo] });
    step("التراجع عن حالة الطلب: عاد «مقبول»", (await stuOf(6)).appStatus === "accepted" && w1u.plan.undo === true, JSON.stringify(w1u.R && w1u.R.rows));
    const w2 = await runW({ type: "stustatus", label: "حالة الطالب", status: "withdrawn", items: [{ stu: "STU-20260101-00001", name: "طالب تجريبي 1" }] });
    step("حالة الطالب: معاينة «نشط ← منسحب» ثم صار «منسحب» فعلاً وطالب واحد فقط تغيّر", w2.plan && w2.plan.rows[0].from === "نشط" && w2.plan.rows[0].to === "منسحب" && (await stuOf(1)).status === "withdrawn" && (await students()).filter((x) => x.status === "withdrawn").length === 1 && w2.R.rows[0].res === "done" && w2.R.rows[0].undo.status === "active", JSON.stringify({ p: w2.plan && w2.plan.rows, r: w2.R && w2.R.rows, e: w2.err }));
    const w2b = await runW({ type: "stustatus", status: "withdrawn", items: [{ stu: "STU-20260101-00001", name: "طالب تجريبي 1" }] });
    step("حالة الطالب مكررة: «لا تغيير» ولا كتابة", w2b.R && w2b.R.rows[0].res === "same" && !w2b.plan, JSON.stringify(w2b.R && w2b.R.rows));
    await runW({ type: "stustatus", undo: true, items: [w2.R.rows[0].undo] });
    step("التراجع عن حالة الطالب: عاد «نشط»", (await stuOf(1)).status === "active", (await stuOf(1)).status);
    const w3 = await runW({ type: "move", label: "نقل", items: [{ stu: "STU-20260101-00001", name: "طالب تجريبي 1", group: "G2" }, { stu: "STU-20260101-00007", name: "طالب تجريبي 7", group: "X9" }] });
    step("النقل: معاينة «G1 ← G2»، ومجموعة غير موجودة لا تُنفَّذ", w3.plan && w3.plan.todo === 1 && w3.plan.invalid === 1 && w3.plan.rows[0].from === "G1" && w3.plan.rows[0].to === "G2", JSON.stringify(w3.plan) + (w3.err || ""));
    step("النقل: الطالب صار في G2 فعلاً، والتراجع يعيده إلى G1", (await stuOf(1)).group === "G2" && w3.R.rows.some((r) => r.res === "done" && r.undo && r.undo.group === "G1"), JSON.stringify(w3.R && w3.R.rows));
    await runW({ type: "move", undo: true, items: [w3.R.rows.find((r) => r.res === "done").undo] });
    step("التراجع عن النقل: عاد إلى G1", (await stuOf(1)).group === "G1", (await stuOf(1)).group);
    const w4 = await runW({ type: "edit", label: "تعديل", items: [{ stu: "STU-20260101-00002", name: "طالب تجريبي 2", fields: { notes: "ملاحظة تجريبية", governorate_id: "خانيونس", education_level: "دبلوم", national_id: "123", birth_date: "5/3/1999" } }] });
    const S2 = await stuOf(2);
    step("تعديل البيانات (الفارغ فقط): الملاحظات فقط تُكتب، والمُدخَل أصلاً لا يُستبدل، والهوية خارج المسموح", w4.plan && /ملاحظات/.test(w4.plan.rows[0].to) && !/المحافظة/.test(w4.plan.rows[0].to) && /لن يُستبدل/.test(w4.plan.rows[0].why) && S2.ed.notes === "ملاحظة تجريبية" && S2.ed.governorate_id === "4" && S2.nid === "400000002", JSON.stringify({ p: w4.plan && w4.plan.rows, ed: S2.ed, e: w4.err }));
    step("تعديل البيانات: بقية النموذج أُرسلت كما هي بلا كلمة مرور", S2.name === "طالب تجريبي 2" && !S2.pwSent && S2.ed.current_address === "حي الرمال - شارع الوحدة", JSON.stringify(S2));
    const w5 = await runW({ type: "edit", onlyEmpty: false, items: [{ stu: "STU-20260101-00002", name: "طالب تجريبي 2", fields: { governorate_id: "خانيونس", birth_date: "5/3/1999" } }] });
    const S2b = await stuOf(2);
    step("تعديل مع الاستبدال: المحافظة «خانيونس» والتاريخ 1999-03-05، والتراجع يحمل القيم السابقة", S2b.ed.governorate_id === "2" && S2b.ed.birth_date === "1999-03-05" && w5.R.rows[0].undo && w5.R.rows[0].undo.fields.governorate_id === "4" && w5.R.rows[0].undo.fields.birth_date === "1998-05-20", JSON.stringify({ ed: S2b.ed, r: w5.R && w5.R.rows }));
    await runW({ type: "edit", undo: true, items: [w5.R.rows[0].undo] });
    step("التراجع عن التعديل: عادت المحافظة والتاريخ", (await stuOf(2)).ed.governorate_id === "4" && (await stuOf(2)).ed.birth_date === "1998-05-20", JSON.stringify((await stuOf(2)).ed));
    const w6 = await runW({ type: "stustatus", status: "suspended", items: [{ stu: "STU-20260101-00003", name: "طالب تجريبي 3" }] }, false);
    step("رفض الموافقة على حالة الطالب: لا كتابة", (await stuOf(3)).status === "active" && w6.R.rows[0].res === "skipped", JSON.stringify(w6.R && w6.R.rows));
    stub.c.close();

    // ===== ب) واجهة تمكين الحقيقية من القرص =====
    const app = await open(browser, "http://localhost:4180/");
    await waitFor(() => app.c.eval("typeof App !== 'undefined' && !!App.centerCmd && !!App.centerAgent"), 30000, "تحميل تمكين");
    await app.c.eval(`(()=>{const ls=document.getElementById('login-screen'); if(ls) ls.remove(); document.body.classList.remove('locked');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); const v=document.getElementById('view-center'); v.classList.add('active'); v.style.display='block'; return 1})()`);
    await waitFor(() => app.c.eval("App.centerAgent.isReady()"), 12000, "الإضافة في صفحة تمكين الحقيقية");
    await app.c.eval("App.centerAgent.allowSynthetic = true; 1");   // ضغطات الاختبار برمجية لا حقيقية
    // الحالة تتحدّث بعد وصول إعلان الإضافة (وفي الاستعمال الحقيقي خلال لحظة)؛ ننتظرها
    const statusText = await waitFor(() => app.c.eval("(()=>{const t=(document.getElementById('cc-status')||{}).textContent||''; return /متصلة/.test(t)?t:''})()"), 20000, "إعلان الاتصال في واجهة تمكين");
    step("واجهة تمكين تعلن أن الإضافة متصلة", /متصلة/.test(statusText || ""), statusText);

    const NID3 = "48" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    const b3 = (await students()).length;
    await app.c.eval(`App.centerCmd.execute({type:'register',label:'من الواجهة',rows:[{full_name:'عبر الواجهة',gender:'female',national_id:'${NID3}',phone_1:'0593333333',status:'active',track_id:'2'}]}); 1`);
    await waitFor(() => app.c.eval("!!document.querySelector('.cc-plan [data-cc=plan-ok]')"), 40000, "بطاقة الموافقة في الواجهة");
    step("ظهرت بطاقة المعاينة في واجهة تمكين", true, (await app.c.eval("document.querySelector('.cc-plan .cc-card-h p').textContent")).trim());
    step("لا كتابة قبل ضغط «نفّذ» في الواجهة", (await students()).length === b3);
    await app.c.eval("document.querySelector('.cc-plan [data-cc=plan-ok]').click()");
    await waitFor(() => app.c.eval("/1\\s*سُجّل/.test(document.getElementById('cc-body').innerText)"), 40000, "نتيجة التسجيل في الواجهة");
    step("النتيجة ظهرت في الواجهة: سُجّل 1", true);
    step("الطالب موجود فعلاً في النظام", (await students()).length === b3 + 1);

    await app.c.eval("App.centerCmd.execute({type:'lookup',label:'q',items:[{q:'طالب تجريبي 4'}]}); 1");
    await waitFor(() => app.c.eval("/1 نتيجة/.test(document.getElementById('cc-body').innerText)"), 40000, "نتيجة الاستعلام في الواجهة");
    step("الاستعلام عاد وعُرض في الواجهة", true);
    app.c.close();
  } catch (e) {
    step("خطأ في الاختبار", false, e.message);
  } finally {
    try { edge.kill(); } catch (e) { /* */ }
    log("\n" + steps.filter((s) => s.startsWith("✗")).length + " إخفاق من " + steps.length);
    process.exit(0);
  }
})();
