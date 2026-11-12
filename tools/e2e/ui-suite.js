/* اختبارات واجهة «أوامر المركز» — تُنفَّذ داخل الصفحة نفسها بوكيل وهمي (بلا إضافة ولا نظام مركز).
   يقرؤها ui.js كنص ويشغّلها. كل فحص: ok(الاسم، الشرط، تفصيل). */
async function suite() {
  const R = [];
  const ok = (n, c, d) => R.push((c ? "✓ " : "✗ ") + n + (d ? " — " + d : ""));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = App.centerCmd, b = document.getElementById("cc-body");
  localStorage.clear();

  const SH = ["الطالب", "المسار / الدورة", "المجموعة / المدرب", "الدرجات"];
  const MH = ["الطالب", "الاستبيان", "المسار", "الدورة", "المجموعة", "المحافظة", "الجوال", "حالة تعبئة الاستبيان", "حالة الطالب"];
  const S1 = "مسار الحلاقة الرجالية المرحلة الأولى", S2 = "مسار الحلاقة الرجالية المرحلة الثانية", S3 = "مسار الحلاقة الرجالية المرحلة الثالثة";
  const mk = (n, id, ph, stu, course, grp) => ({ cells: [n + " لا يوجد اسم إنجليزي STU-" + stu + " - " + id + " - " + ph, course, grp, "x"] });
  const calls = [];
  let DATA = [], MISSING = {}, PLEDGED = [], SUBS = [], PARTIAL = false;
  const agent = {
    isReady: () => true, ready: async () => true, version: () => "1.5.3", stop() { calls.push("stop"); },
    run: async (cmds, opts) => {
      const res = cmds.map((cm) => {
        calls.push((cm.source || cm.type) + (cm.params && cm.params.status ? ":" + cm.params.status : ""));
        if (cm.type === "page") return { type: "page", source: cm.source, label: cm.label, params: cm.params, stats: [{ label: "إرسالاً", value: "137" }], filters: [{ name: "status", label: "الحالة", type: "select", value: "", options: [{ v: "", t: "الكل" }, { v: "completed", t: "مكتمل" }] }],
          tables: [{ title: "حسب المسار والمرحلة", heads: ["المسار", "المرحلة", "عدد الإرسالات"], rows: [{ cells: ["الحلاقة الرجالية", "الأولى", "40"] }, { cells: ["الحلاقة الرجالية", "الثانية", "30"] }, { cells: ["التجميل النسائي - كوافير", "الثانية", "55"] }, { cells: ["التطريز والخياطة", "الثالثة", "12"] }] },
                   { title: "حسب الحالة", heads: ["الحالة", "العدد"], rows: [{ cells: ["مكتمل", "100"] }, { cells: ["جزئي", "37"] }] }], text: "" };
        if (cm.type === "lookup") {
          const rows = DATA.slice(0, 1);
          return { type: "lookup", label: "", items: [{ q: cm.items[0].q, count: rows.length, heads: SH.concat(cm.details ? ["تاريخ الميلاد"] : []), rows: rows.map((r) => ({ id: "1", cells: r.cells.concat(cm.details ? ["1998-05-20"] : []) })) }] };
        }
        if (cm.source === "missing") { const l = MISSING[cm.params.evaluation_type] || []; return { type: "list", heads: MH, rows: l.length ? l : [{ cells: ["لا يوجد طلاب مطابقون لم يعبئوا هذا النوع من الاستبيانات."] }] }; }
        if (cm.source === "pledges") return { type: "list", heads: ["الطالب", "المسار / المجموعة", "تاريخ الاعتماد", "مصدر الاعتماد"], rows: PLEDGED };
        if (cm.source === "submissions") return { type: "list", heads: ["الطالب", "النموذج", "المسار", "الدورة", "المجموعة", "الدرجة", "تاريخ الإرسال"], rows: SUBS };
        return { type: "list", heads: SH, rows: cm.params && cm.params.track_id === "1" ? DATA : cm.params && cm.params.q ? DATA : [] };
      });
      if (PARTIAL && opts && opts.onPartial) for (let i = 0; i < res.length; i++) { opts.onPartial(i, res[i]); await wait(40); }
      return { results: res };
    },
  };
  App.centerAgent = agent;
  const mrow = (n, id, ph, stu, g) => ({ cells: [n + " STU-" + stu + " - " + id + " - " + ph, "استبانة", "مسار الحلاقة الرجالية", "المرحلة الثانية", g, "غزة", ph, "لم يعبّئ", "نشط"] });
  const run = async (mode, btn, ms) => { c.state.mode = mode; c.render(); b.querySelector('[data-cc="' + btn + '"]').click(); await wait(ms || 700); };

  // ===== 1) الجدول الموحّد =====
  c.state.mode = "report";
  c.state.results = { results: [{ type: "list", heads: ["الاسم", "رقم الهوية"], rows: Array.from({ length: 130 }, (_, i) => ({ cells: ["طالب " + String(i + 1).padStart(3, "0") + (i % 10 === 0 ? " الشاعر" : ""), "40" + (1000000 + i)] })) }] };
  c.state.labels = ["اختبار"]; c.render();
  const body = () => b.querySelector(".cc-tbl-body");
  ok("الجدول: 50 صفاً في الصفحة و3 صفحات", body().querySelectorAll("tbody tr").length === 50 && /3/.test((b.querySelector(".cc-pager span") || {}).textContent || ""));
  const q = b.querySelector("[data-tbl-q]"); q.value = "الشاعر"; q.dispatchEvent(new Event("input", { bubbles: true }));
  ok("الجدول: البحث يحصر النتائج (13)", body().querySelectorAll("tbody tr").length === 13);
  q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true }));
  b.querySelectorAll("th[data-tbl-sort]")[0].click(); b.querySelectorAll("th[data-tbl-sort]")[0].click();
  ok("الجدول: الفرز التنازلي", /طالب 130/.test(body().querySelector("tbody td").textContent));

  // ===== 2) إخفاء الأرقام =====
  b.querySelector('[data-cc="toggle-mask"]').click();
  ok("إخفاء الهوية في العرض", /\*/.test(b.querySelector(".cc-results tbody td:nth-child(2)").textContent));
  b.querySelector('[data-cc="toggle-mask"]').click();

  // ===== 3) فصل المجموعة/المدرب =====
  const gs = c.expand({ type: "list", heads: SH, rows: ["S3G2 -", "G1 ورود بركات علي", "المجموعة الاولى", "G1 - د. أحمد"].map((g, i) => ({ cells: [" x STU-1 - 40" + i + " - 059", S2, g, "x"] })) });
  const gi = gs.heads.indexOf("المجموعة"), ti = gs.heads.indexOf("المدرب");
  ok("المجموعة والمدرب يُفصلان", gs.rows.map((x) => x.cells[gi] + "|" + x.cells[ti]).join(";") === "S3G2|;G1|ورود بركات علي;المجموعة الاولى|;G1|د. أحمد");

  // ===== 4) فحص البيانات =====
  DATA = [mk("أحمد خالد علي أبو نصير", "401000001", "0591000001", "1", S3, "S3G1 - "), mk("جلال سعيد", "403000003", "059", "3", S3, " - "), mk("هدى فؤاد حسين قاسم", "4050000", "0595000005", "5", S1, "G1 - "), mk("دينا نصر عمر الشاعر", "401000001", "0594000004", "4", S2, "G2 - ")];
  calls.length = 0; c.state.dq = Object.assign(c.state.dq, { tracks: ["1"], stages: [], out: null });
  ok("فحص البيانات: الحالة الافتراضية نشط", c.state.dq.status === "active");
  await run("dq", "run-dq");
  ok("فحص البيانات: يرسل status=active", calls.includes("list:active"));
  const dq = c.state.dq.out;
  ok("فحص البيانات: هوية مكررة (2) وقصيرة وجوال وبلا مجموعة واسم قصير", dq.byType.dupId === 2 && dq.byType.badId === 1 && dq.byType.noPhone === 1 && dq.byType.noGroup === 1 && dq.byType.shortName === 1, JSON.stringify(dq.byType));
  c.state.dq.stages = ["المرحلة الأولى"]; await run("dq", "run-dq");
  ok("فحص البيانات: المرحلة الأولى وحدها", c.state.dq.out.total === 1 && c.state.dq.out.byType.badId === 1);
  c.state.dq.stages = [];

  // ===== 5) التقرير الشامل وملف التذكير =====
  DATA = [mk("أحمد علي سالم الشاعر", "401", "0591", "1", S2, "G1 - "), mk("بسمة خالد سعيد حسن", "402", "597222222", "2", S2, "G1 - "), mk("جلال سعيد حسن الشاعر", "403", "0593", "3", S2, "G1 - "), mk("دينا نصر عمر الشاعر", "404", "0594", "4", S2, "G1 - ")];
  MISSING = { pre: [mrow("أحمد علي سالم الشاعر", "401", "0591", "1", "G1"), mrow("بسمة خالد سعيد حسن", "402", "597222222", "2", "G1")], post: [mrow("بسمة خالد سعيد حسن", "402", "597222222", "2", "G1"), mrow("جلال سعيد حسن الشاعر", "403", "0593", "3", "G1")] };
  PLEDGED = [{ cells: ["دينا نصر عمر الشاعر 404 · 0594", "x", "x", "x"] }];
  SUBS = [{ cells: ["بسمة خالد سعيد حسن STU-2", "استبانة - قبلي", "مسار الحلاقة الرجالية", "المرحلة الثانية", "G1", "4.5", "2026-11-01"] }];
  c.state.mis = Object.assign(c.state.mis, { kind: "all", tracks: ["1"], stages: [], status: "active", verify: true, out: null, msg: "" });
  await run("missing", "run-mis", 1100);
  const all = c.state.mis.out;
  const byName = (n) => (all.rows.find((x) => x.name.startsWith(n)) || { flags: {} }).flags;
  ok("الشامل: ثلاثة طلاب، والقبلي لبسمة استُبعد بالتحقق", all.rows.length === 3 && !byName("بسمة").pre && byName("بسمة").post && byName("أحمد").pre && byName("جلال").post, all.rows.map((x) => x.name.split(" ")[0] + ":" + Object.keys(x.flags).join("+")).join(" | "));
  const rd = b.querySelector("[data-open=remind]"); if (rd) { rd.open = true; rd.dispatchEvent(new Event("toggle")); }
  let cap = null; const od = App.ui.download; App.ui.download = (n, blob) => { cap = { n, blob }; };
  b.querySelector('[data-cc="export-remind"]').click(); await wait(500); App.ui.download = od;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await cap.blob.arrayBuffer());
  const rows = []; wb.worksheets[0].eachRow((r) => rows.push(r.values.slice(1).map(String)));
  ok("ملف التذكير: جوال بلا صفر يُصحَّح، ورسالة بالنواقص", rows.some((r) => r[2] === "0597222222" && /البعدي/.test(r[5])), rows.length - 1 + " رسالة");

  // ===== 6) أولوية المتابعة + موجز الطباعة =====
  c.state.mis.kind = "risk"; await run("missing", "run-mis", 1100);
  const risk = c.state.mis.out;
  ok("أولوية المتابعة: صفوف مرتبة بالأولوية تنازلياً", risk.rows.length >= 3 && risk.rows[0].count >= risk.rows[risk.rows.length - 1].count);
  const wp = window.print; let printed = 0; window.print = () => { printed++; };
  b.querySelector('[data-cc="print-summary"]').click(); await wait(500); window.print = wp;
  const proot = document.getElementById("print-root");
  ok("موجز المدير يُطبع على صفحة الترويسة بجدول ومجاميع", printed === 1 && proot.querySelectorAll(".lh-page").length >= 1 && /المجموع/.test(proot.textContent) && /letterhead\/page\.jpg/.test(getComputedStyle(proot.querySelector(".lh-page")).backgroundImage));
  let wcap = null; const wod = App.ui.download; App.ui.download = (n, blob) => { wcap = { n, size: blob.size }; };
  b.querySelector('[data-cc="word-summary"]').click(); for (let i = 0; i < 30 && !wcap; i++) await wait(200); App.ui.download = wod;
  ok("موجز المدير: ملف Word على الترويسة", !!wcap && /\.docx$/.test(wcap.n) && wcap.size > 50000, wcap && Math.round(wcap.size / 1024) + "KB");

  c.state.mis = Object.assign(c.state.mis, { kind: "pre", out: null }); c.render();
  ok("زر «تقرير المدير» ظاهر في البطاقة دائماً", !!b.querySelector('[data-cc="manager-print"]') && !!b.querySelector('[data-cc="manager-word"]'));
  printed = 0; window.print = () => { printed++; };
  b.querySelector('[data-cc="manager-print"]').click(); await wait(1600); window.print = wp;
  ok("«تقرير المدير» من بطاقة بلا نتيجة: يشغّل الشامل ثم يطبع", printed === 1 && c.state.mis.kind === "all" && !!c.state.mis.out);

  // ===== 6ب) موجز المدير من نتيجة نوع واحد + واتساب =====
  c.state.mis = Object.assign(c.state.mis, { kind: "post", tracks: ["1"], stages: [], status: "active", verify: false, out: null });
  await run("missing", "run-mis", 1000);
  calls.length = 0; printed = 0; window.print = () => { printed++; };
  b.querySelector('[data-cc="manager-print"]').click(); await wait(800); window.print = wp;
  ok("تقرير المدير من نتيجة «بعدي» ظاهرة: بلا إعادة جلب", calls.length === 0 && printed === 1 && c.state.mis.kind === "post" && /لم يعبّئوا/.test(document.getElementById("print-root").textContent));
  const wd = b.querySelector("[data-open=wa]"); if (wd) { wd.open = true; wd.dispatchEvent(new Event("toggle")); c.render(); }
  const op2 = window.prompt, ans = ["مدير المركز", "المدير", "0599123456"]; let ai = 0; window.prompt = () => ans[ai++];
  const cf0 = window.confirm; window.confirm = () => false;      // «هل المستلم أنثى؟» ← لا
  b.querySelector('[data-cc="wa-addc"]').click(); window.prompt = op2; window.confirm = cf0;
  ok("واتساب: تُحفظ جهة اتصال وتُختار", c.state.contacts.length === 1 && c.state.wa.contact === c.state.contacts[0].id && JSON.parse(localStorage.getItem("tamkeen-admin:cc-contacts")).length === 1);
  const nm0 = b.querySelector("[data-wa=names]"); nm0.checked = false; nm0.dispatchEvent(new Event("change", { bubbles: true }));   // الأسماء مفعّلة افتراضياً الآن
  // الوضع الافتراضي: نسخ الرسالة كاملة وفتح المحادثة بلا نص في الرابط
  let clip = ""; const wc0 = Object.getOwnPropertyDescriptor(navigator, "clipboard"); Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { clip = x; } }, configurable: true });
  let pasteUrl = ""; const wo0 = window.open; window.open = (u) => { pasteUrl = u; return null; };
  b.querySelector('[data-cc="wa-open"]').click(); await wait(100); window.open = wo0;
  ok("واتساب (الافتراضي): الرسالة كاملة تُنسخ والرابط بلا نص", /^https:\/\/wa\.me\/970599123456$/.test(pasteUrl) && /غير المستكمل/.test(clip) && !/%/.test(pasteUrl), pasteUrl);
  localStorage.setItem("tamkeen-admin:wa-mode", JSON.stringify("link"));                       // بقية الاختبارات على وضع إدراج النص في الرابط
  let waUrl = ""; const wo = window.open; window.open = (u) => { waUrl = u; return null; };
  b.querySelector('[data-cc="wa-open"]').click(); window.open = wo;
  const waTxt = decodeURIComponent(waUrl.split("?text=")[1] || "");
  ok("واتساب: رابط wa.me برقم دولي ونص يحوي الإجمالي بلا أسماء", /^https:\/\/wa\.me\/970599123456\?text=/.test(waUrl) && /غير المستكمل/.test(waTxt) && /الأستاذ\//.test(waTxt) && !/بسمة|جلال/.test(waTxt), waTxt.split(String.fromCharCode(10))[0]);
  const waNames = b.querySelector("[data-wa=names]"); waNames.checked = true; waNames.dispatchEvent(new Event("change", { bubbles: true }));
  const cf = window.confirm; window.confirm = () => true; window.open = (u) => { waUrl = u; return null; };
  b.querySelector('[data-cc="wa-open"]').click(); window.open = wo; window.confirm = cf;
  ok("واتساب: خيار الأسماء يضيفها بعد تأكيد", /بسمة|جلال/.test(decodeURIComponent(waUrl)));
  localStorage.removeItem("tamkeen-admin:wa-mode"); if (wc0) Object.defineProperty(navigator, "clipboard", wc0);
  const ed = b.querySelector("[data-wa-text]"); ed.value = "نص معدّل بيدي"; ed.dispatchEvent(new Event("input", { bubbles: true }));
  c.render(); ok("واتساب: تعديل النص يُحفظ ولا يُستبدل عند إعادة الرسم", /نص معدّل بيدي/.test(b.querySelector("[data-wa-text]").value));

  // ===== 7) المجموعات والمدربون =====
  DATA = [mk("طالب أول رباعي كامل", "401000001", "0591000001", "1", S2, "G1 مدرب أحمد"), mk("طالب ثان رباعي كامل", "401000002", "0591000002", "2", S2, "G1 مدرب أحمد"), mk("طالب ثالث رباعي كامل", "401000003", "0591000003", "3", S2, "G1 مدرب أحمد"), mk("طالب رابع رباعي كامل", "401000004", "0591000004", "4", S2, "G2 مدربة سلمى"), mk("وليد غير موزع رباعي", "401000005", "0591000005", "5", S2, " - "), mk("هدى غير موزعة رباعي", "401000006", "0591000006", "6", S2, "-")];
  c.state.grp = Object.assign(c.state.grp, { tracks: ["1"], stages: [], status: "active", out: null });
  await run("groups", "run-grp");
  const go = c.state.grp.out;
  ok("المجموعات: مجموعتان ومدربان و2 غير موزع", go.groups.length === 2 && go.trainers.length === 2 && go.unassigned === 2);
  b.querySelector('[data-cc="grp-propose"]').click();
  ok("اقتراح التوزيع: يوازن (الصغرى أولاً)", c.state.grp.out.prop.rows.length === 2 && c.state.grp.out.prop.rows[0][4] === "G2");
  b.querySelector('[data-cc="grp-compliance"]').click();
  for (let i = 0; i < 60 && !c.state.grp.comp && !c.state.resultError; i++) await wait(200);
  const cp = c.state.grp.comp;
  ok("الالتزام: يُحسب لكل مجموعة ومدرب بلا خطأ", !!cp && !c.state.resultError && cp.total === 6 && cp.groups.some((g) => g.group === "G1") && cp.groups.every((g) => Number.isInteger(g.pct)) && cp.trainers.length >= 2, cp && { total: cp.total, err: c.state.resultError });
  ok("الالتزام: جدولان في النتيجة وزر تنزيل", !!b.querySelector('[data-tblbox="grp-cg"]') && !!b.querySelector('[data-tblbox="grp-ct"]'));
  const pp7 = window.print; let printed7 = 0; window.print = () => { printed7++; };
  b.querySelector('[data-cc="print-grp"]').click(); await wait(800); window.print = pp7;
  const pr7 = (document.getElementById("print-root") || {}).textContent || "";
  ok("المجموعات: طباعة على الترويسة الرسمية بجدول الالتزام", printed7 === 1 && /تقرير المجموعات والمدربين/.test(pr7) && /الالتزام بالمتطلبات/.test(pr7), pr7.slice(0, 80));

  // ===== ٧ب) تنبيه القراءة الواسعة + عدّاد أوامر القراءة + استعمال الذاكرة في بقية التبويبات =====
  c.state.mis = Object.assign(c.state.mis, { kind: "all", tracks: [], stages: [], status: "active", verify: true, out: null });
  c.state.mode = "missing"; c.state.wide = null; c.state.wideLimit = 8; c.render();   // حدّ أصغر لأن النظام الوهمي فيه مسارات أقل من الحقيقي
  b.querySelector('[data-cc="run-mis"]').click(); await wait(300);
  ok("قراءة واسعة: يظهر تنبيه بتقدير الأوامر ولا يبدأ التنفيذ", !!b.querySelector(".cc-wide-warn") && !c.state.busy && Number((b.querySelector(".cc-wide-warn b") || {}).textContent.replace(/\D/g, "")) >= 8, (b.querySelector(".cc-wide-warn") || {}).textContent);
  b.querySelector('[data-cc="wide-edit"]').click(); await wait(100);
  ok("«حدّد النطاق» يخفي التنبيه ولا يبدأ شيئاً", !b.querySelector(".cc-wide-warn") && !c.state.busy, JSON.stringify({ wide: !!b.querySelector(".cc-wide-warn"), busy: c.state.busy, sw: c.state.wide, mode: c.state.mode, err: c.state.resultError }));
  b.querySelector('[data-cc="run-mis"]').click(); await wait(200); b.querySelector('[data-cc="wide-go"]').click();
  for (let i = 0; i < 100 && !(c.state.mis.out || c.state.resultError); i++) await wait(200);
  await wait(300);
  const lg = c.state.runLog[0] || {};
  ok("«تابع على أي حال» ينفّذ، والسجل يحفظ عدد أوامر القراءة", !!c.state.mis.out && lg.mode === "missing" && lg.sent >= 8 && lg.cached === 0, JSON.stringify({ out: !!c.state.mis.out, lg, err: c.state.resultError, busy: c.state.busy, wide: c.state.wide }));
  c.state.mode = "report"; c.render(); b.querySelector('[data-cc="preload"]').click();
  for (let i = 0; i < 100 && !c.state.cache && !c.state.resultError; i++) await wait(200);
  c.state.wideLimit = 0;
  c.state.dq = Object.assign(c.state.dq, { tracks: ["1"], stages: [], status: "", out: null, rows: null, diff: null });
  await run("dq", "run-dq", 900); for (let i = 0; i < 50 && c.state.busy; i++) await wait(200); await wait(300);
  const lg2 = c.state.runLog[0] || {};
  ok("الذاكرة المحمّلة تخدم فحص البيانات: لا أمر قراءة جديداً", !!c.state.cache && lg2.mode === "dq" && lg2.sent === 0 && lg2.cached >= 1 && !!c.state.dq.out, JSON.stringify({ cache: !!c.state.cache, lg2, dq: !!c.state.dq.out, err: c.state.resultError, wide: c.state.wide }));
  c.state.cache = null;

  // ===== ٧ج) إحصاءات قياس الأثر: قراءة صفحة التقرير ثم تصفية محلية بالمسار والمرحلة =====
  c.state.imp = Object.assign(c.state.imp, { from: "2026-09-01", to: "2026-11-11", extra: "status=all", track: "", stage: "", out: null });
  c.state.mode = "impact"; c.state.adding = ""; c.state.proposal = null; c.render();
  ok("قياس الأثر: تبويب بحقلي التاريخ وزر الجلب", !!b.querySelector('[data-imp="from"]') && !!b.querySelector('[data-imp="to"]') && !!b.querySelector('[data-cc="run-imp"]') && /date_from=2026-09-01/.test(([...b.querySelectorAll("#cc-imp code")].pop() || {}).textContent || "") && /status=all/.test(([...b.querySelectorAll("#cc-imp code")].pop() || {}).textContent || ""), JSON.stringify({ mode: c.state.mode, hasImp: !!b.querySelector("#cc-imp"), len: b.innerHTML.length }));
  calls.length = 0; b.querySelector('[data-cc="run-imp"]').click();
  for (let i = 0; i < 60 && !c.state.imp.out && !c.state.resultError; i++) await wait(200); await wait(200);
  const io0 = c.state.imp.out;
  ok("قياس الأثر: يصل التقرير بجدوليه وأرقامه وقائمة التصفية", !!io0 && io0.tables.length === 2 && io0.stats[0].value === "137" && io0.filters[0].name === "status" && calls.some((x) => /^impact/.test(x)), JSON.stringify({ out: !!io0, err: c.state.resultError, tables: io0 && io0.tables.length, stats: io0 && io0.stats, filters: io0 && io0.filters, calls: calls.slice(0, 5) }));
  const rowsOf = (k) => b.querySelectorAll('[data-tblbox="' + k + '"] tbody tr').length;
  ok("بلا تصفية: كل الصفوف", rowsOf("imp-0") === 4 && rowsOf("imp-1") === 2, [rowsOf("imp-0"), rowsOf("imp-1")]);
  const tick = (k, text) => { const lb = [...b.querySelectorAll('[data-imp="' + k + '"]')].find((x) => x.parentNode.textContent.includes(text)); if (lb) lb.click(); return !!lb; };
  ok("أزرار اختيار المسار والمرحلة (مربعات) موجودة", b.querySelectorAll('[data-imp="stages"]').length === 3 && b.querySelectorAll('[data-imp="tracks"]').length > 3, [b.querySelectorAll('[data-imp="stages"]').length, b.querySelectorAll('[data-imp="tracks"]').length]);
  tick("tracks", "الحلاقة الرجالية");
  ok("تصفية المسار: الجدول فيه عمود مسار يُصفّى، وجدول الحالة بلا عمود مسار يبقى كاملاً مع تنبيه", rowsOf("imp-0") === 2 && rowsOf("imp-1") === 2 && /ما يدل على المسار/.test(b.textContent), [rowsOf("imp-0"), rowsOf("imp-1")]);
  tick("stages", "المرحلة الثانية");
  ok("تصفية المسار والمرحلة معاً: صف واحد", rowsOf("imp-0") === 1, rowsOf("imp-0"));
  let capImp = null; const odImp = App.ui.download; App.ui.download = (n, blob) => { capImp = { n, blob }; };
  b.querySelector('[data-cc="export-imp"]').click(); for (let i = 0; i < 40 && !capImp; i++) await wait(150); App.ui.download = odImp;
  const wbI = new ExcelJS.Workbook(); await wbI.xlsx.load(await capImp.blob.arrayBuffer());
  ok("تنزيل Excel: الجدول المصفّى وحده بصف واحد (وجدول الحالة كاملاً)", wbI.worksheets.length === 2 && wbI.worksheets[0].rowCount === 2 && wbI.worksheets[1].rowCount === 3, wbI.worksheets.map((w) => w.rowCount));
  const sv = b.querySelector('[data-impsrv="status"]');
  ok("قياس الأثر: قائمة الحالة من النظام تظهر للاختيار", !!sv, "no select");
  if (sv) {
    sv.value = "completed"; sv.dispatchEvent(new Event("change", { bubbles: true }));
    calls.length = 0; b.querySelector('[data-cc="imp-apply"]').click();
    for (let i = 0; i < 60 && !c.state.imp.out && !c.state.resultError; i++) await wait(200); await wait(200);
    ok("«طبّق وأعد الجلب»: يُرسَل الاختيار معاملاً ويُقرأ أمر واحد", calls.length === 1 && !!c.state.imp.out, JSON.stringify(calls));
  }
  // تابات الصفحات الأخرى (قبلي/بعدي، إحصائيات الأسئلة…)
  const pg = [...b.querySelectorAll('[data-imp="pages"]')];
  ok("خمسة تقارير يمكن اختيار أكثر من واحد منها", pg.length === 5, pg.length);
  calls.length = 0; pg.find((x) => x.value === "questions").click(); await wait(100);
  ok("اختيار تقرير ثانٍ لا يقرأ شيئاً ويُبقي الأول", calls.length === 0 && c.state.imp.pages.join() === "impact,questions", c.state.imp.pages.join());
  calls.length = 0; b.querySelector('[data-cc="run-imp"]').click();
  for (let i = 0; i < 60 && !c.state.imp.out && !c.state.resultError; i++) await wait(200); await wait(200);
  ok("تقريران: أمران يُرسلان ويصل ناتج كل منهما", calls.length === 2 && /^impact/.test(calls[0]) && /^questions/.test(calls[1]) && Object.keys(c.state.imp.outs).length === 2, JSON.stringify(calls));
  ok("تبويب العرض بين التقريرين ظاهر", b.querySelectorAll('[data-imp="view"]').length === 2, b.querySelectorAll('[data-imp="view"]').length);
  let capZ = null; const odZ = App.ui.download; App.ui.download = (n, blob) => { capZ = { n, blob }; };
  b.querySelector('[data-cc="export-imp"]').click(); for (let i = 0; i < 60 && !capZ; i++) await wait(150); App.ui.download = odZ;
  const zz = capZ && await JSZip.loadAsync(await capZ.blob.arrayBuffer());
  ok("التنزيل ملف zip فيه ملف Excel لكل تقرير", !!zz && /\.zip$/.test(capZ.n) && Object.keys(zz.files).length === 2 && Object.keys(zz.files).every((n) => /\.xlsx$/.test(n)), capZ && capZ.n + " " + (zz ? Object.keys(zz.files).join("|") : ""));
  c.state.imp.pages = ["impact"]; c.state.imp.outs = {};
  c.state.imp.page = "impact";
  c.state.imp.tracks = []; c.state.imp.stages = []; c.state.imp.out = null;

  // ===== 8) الإخوة: اختيار المراحل والمقارنة بين المراحل =====
  DATA = [mk("أحمد خالد علي أبو نصير", "401", "0591000001", "1", S3, "G1 - "), mk("علي خالد علي أبو نصير", "402", "0591000001", "2", S1, "G1 - "), mk("منى فؤاد حسين قاسم", "407", "0594000004", "3", S3, "G1 - "), mk("سلمى فؤاد حسين قاسم", "409", "0594000004", "4", S3, "G1 - ")];
  const sibRun = async (cfg) => { c.state.mode = "siblings"; c.state.sib = Object.assign({ tracks: ["1"], status: "", phone: true, name: true, loose: false, both: false, stageMode: false, stages: [], baseStage: "المرحلة الثالثة", cmpStages: [], out: null }, cfg); c.render(); b.querySelector('[data-cc="run-sib"]').click(); await wait(700); return c.state.sib.out; };
  ok("الإخوة: كل المراحل = عائلتان", (await sibRun({})).families === 2);
  ok("الإخوة: المرحلة الثالثة وحدها = عائلة واحدة", (await sibRun({ stages: ["المرحلة الثالثة"] })).families === 1);
  c.state.mode = "compare"; c.state.cmp = { tracks: ["1"], status: "", multiOnly: true, goal: "siblings", out: null };
  c.state.sib = { tracks: [], status: "", phone: true, name: true, loose: false, both: false, stageMode: false, stages: [], baseStage: "المرحلة الثالثة", cmpStages: [], out: null }; c.render();
  b.querySelector('[data-cc="run-compare"]').click(); await wait(700);
  ok("مقارنة المراحل (إخوة): الثالثة مقابل الباقي = عائلة (أحمد وعلي)", c.state.sib.out.families === 1 && c.state.sib.out.stageStats.last === 1);
  c.state.sib.cmpStages = ["__same"]; b.querySelector('[data-cc="run-compare"]').click(); await wait(700);
  ok("مقارنة المراحل (إخوة): نفس المرحلة = عائلة (منى وسلمى)", c.state.sib.out.families === 1 && c.state.sib.out.stageStats.early >= 2);

  // ===== 9) ملف الطالب =====
  DATA = [mk("أحمد خالد علي أبو نصير", "401000001", "0591000001", "1", S2, "G1 مدرب أحمد")];
  MISSING = { pre: [mrow("أحمد خالد علي أبو نصير", "401000001", "0591000001", "1", "G1")] }; PLEDGED = []; SUBS = [{ cells: ["أحمد خالد علي أبو نصير STU-1", "استبانة - بعدي", "مسار الحلاقة الرجالية", "المرحلة الثانية", "G1", "4.5", "2026-11-02"] }];
  c.state.mode = "student"; c.state.stu.q = "401000001"; c.render(); b.querySelector('[data-cc="run-stu"]').click(); await wait(1000);
  const so = c.state.stu.out;
  ok("ملف الطالب: القبلي ناقص والبعدي مكتمل والتعهد غير موقّع", so && so.surveys[0].state === "ناقص" && so.surveys[1].state === "مكتمل" && so.pledge.state === "لم يوقّع");
  ok("ملف الطالب: حقول التفاصيل تظهر", so.kv.some((x) => x[0] === "تاريخ الميلاد"));

  // ===== 10) المحفوظات والحزمة =====
  const op = window.prompt; let nm = 0; window.prompt = () => ["أ تقرير", "ب فحص"][nm++];
  c.state.mode = "report"; c.state.sel = { tracks: ["1"], stages: [], status: "active", group_status: "", details: false, extra: {} }; c.render(); b.querySelector('[data-cc="sv-save"]').click();
  c.state.mode = "dq"; c.state.dq.tracks = ["1"]; c.render(); b.querySelector('[data-cc="sv-save"]').click(); window.prompt = op;
  ok("المحفوظات: حُفظ تقريران", c.state.saved.length === 2 && JSON.parse(localStorage.getItem("tamkeen-admin:cc-saved")).length === 2);
  const dsv = document.getElementById("dash-saved");
  ok("اللوحة الرئيسية: التقارير المحفوظة بأزرار تشغيل", !!dsv && !dsv.hidden && dsv.querySelectorAll("[data-dash-saved]").length === 2, dsv && dsv.innerHTML.length);
  localStorage.removeItem("tamkeen-admin:cc-weekly"); localStorage.removeItem("tamkeen-admin:cc-weekly-snooze"); c.render();
  ok("التذكير الأسبوعي: يظهر ما دام لا تقرير شامل أسبوعي", !!b.querySelector('[data-cc="weekly-run"]'));
  b.querySelector('[data-cc="weekly-snooze"]').click();
  ok("التأجيل يومين يخفي التذكير", !b.querySelector('[data-cc="weekly-run"]') && Number(localStorage.getItem("tamkeen-admin:cc-weekly-snooze")) > Date.now());
  ok("ما الجديد: بطاقة بتقارير الناقصين المحفوظة لقطاتها", !!b.querySelector(".cc-news") && b.querySelectorAll(".cc-news-row").length >= 1, b.querySelectorAll(".cc-news-row").length);
  b.querySelector('[data-cc="news-load"]').click();
  ok("«افتح هذا التقرير» يحمّل اختياراته في تبويب الاستبيانات", c.state.mode === "missing" && !c.state.mis.out);
  c.state.sel = { tracks: ["2"], stages: [], status: "", group_status: "", details: false, extra: {} };
  c.state.mode = "dq"; c.render(); b.querySelector('[data-cc="bundle-toggle"]').click();
  b.querySelectorAll("[data-bundle]").forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); });
  cap = null; App.ui.download = (n, blob) => { cap = { n, blob }; };
  b.querySelector('[data-cc="bundle-run"]').click(); for (let i = 0; i < 40 && !cap; i++) await wait(200); App.ui.download = od;
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await cap.blob.arrayBuffer());
  ok("الحزمة: ورقتان واختيارك الحالي لم يُمسح", wb2.worksheets.length === 2 && JSON.stringify(c.state.sel.tracks) === '["2"]', wb2.worksheets.map((w) => w.name).join(" | "));

  // ===== 11) النتائج التدريجية وزر الإيقاف =====
  DATA = [mk("طالب", "40", "059", "1", S2, "G1 - ")]; PARTIAL = true;
  c.state.mode = "report"; c.state.sel = { tracks: ["1", "2"], stages: [], status: "", group_status: "", details: false, extra: {} }; c.render();
  b.querySelector('[data-cc="run-selection"]').click(); await wait(900);
  ok("النتائج التدريجية: تنتهي بنتيجتين", c.state.results && c.state.results.results.length === 2 && c.state.results.results.every((r) => r.type === "list"));
  PARTIAL = false;
  let release, held = 0; const hold = new Promise((r) => { release = r; }); const prevRun = agent.run; agent.run = async (cmds) => { held++; await hold; return { results: cmds.map(() => ({ type: "list", heads: SH, rows: [] })) }; };
  c.state.mode = "report"; c.render(); b.querySelector('[data-cc="run-selection"]').click(); await wait(900);
  let stopBtn = null;                                           // الرسم قد يتأخر على جهاز بطيء: ننتظر الزر بدل افتراض ظهوره بعد زمن ثابت
  for (let i = 0; i < 60 && !stopBtn; i++) { stopBtn = b.querySelector('[data-cc="stop-run"]'); if (!stopBtn) { if (i % 6 === 5) c.render(); await wait(150); } }   // إعادة رسم دورية: حالة الوكيل قد تتأخر على جهاز مشغول
  ok("زر الإيقاف ومربع الإشعار يظهران أثناء التنفيذ", !!stopBtn && !!b.querySelector("[data-cc-notify]"));
  const fake = document.createElement("button"); fake.dataset.cc = "run-dq"; b.appendChild(fake);
  const heldBefore = held; fake.click(); await wait(150); fake.remove();
  ok("لا تبدأ عملية ثانية أثناء تنفيذ جارٍ", held === heldBefore && heldBefore === 1);
  calls.length = 0; stopBtn.click(); ok("زر الإيقاف يستدعي الإضافة", calls.includes("stop"));
  release(); await wait(400); agent.run = prevRun;

  // ===== 12) فهم الطلبات =====
  const li = (t) => c.localIntent(t);
  ok("الطلب: «كم طالب لم يعبئ القبلي في الحلاقة»", li("كم طالب لم يعبئ الاستبيان القبلي في الحلاقة").mode === "missing" && li("كم طالب لم يعبئ الاستبيان القبلي في الحلاقة").cfg.kind === "pre");
  ok("الطلب: الإخوة وفحص البيانات", li("اعطني الاخوة").mode === "siblings" && li("افحص جودة بيانات الطلاب").mode === "dq");
  ok("الطلب القديم لا ينكسر: غير الموزعين قائمة", li("هاتلي الطلاب غير الموزعين").type === "list");

  // ===== 13) الأمان =====
  c.state.results = { results: [{ type: "list", heads: ["ا"], rows: [{ cells: ["1"] }] }] }; c.render();
  b.querySelector("[data-open=sec]").open = true; b.querySelector("[data-open=sec]").dispatchEvent(new Event("toggle")); c.render();
  b.querySelector('[data-cc="wipe-now"]').click();
  ok("مسح البيانات يدوياً", !c.state.results && !c.state.cache);
  const st = App.store.get(); st.centerAdminOnly = true; const ou = App.cloud.user; App.cloud.user = () => ({ name: "موظف", admin: false }); c.render();
  const blocked = !b.querySelector(".cc-modes"); App.cloud.user = () => ({ name: "مدير", admin: true }); c.render();
  const allowed = !!b.querySelector(".cc-modes"); delete st.centerAdminOnly; App.cloud.user = ou;
  ok("حصر التبويب بالمدير", blocked && allowed);
  ok("جدول الاختبارات يقبل بيانات المركز", typeof (App.examSheet || {}).useData === "function");

  return R;
}
