/* اختبارات واجهة «أوامر المركز» — تُنفَّذ داخل الصفحة نفسها بوكيل وهمي (بلا إضافة ولا نظام مركز).
   يقرؤها ui.js كنص ويشغّلها. كل فحص: ok(الاسم، الشرط، تفصيل). */
async function suite() {
  const R = []; window.__R = R;
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
    isReady: () => true, ready: async () => true, version: () => "1.5.7", stop() { calls.push("stop"); },
    run: async (cmds, opts) => {
      const res = cmds.map((cm) => {
        calls.push((cm.source || cm.type) + (cm.params && cm.params.status ? ":" + cm.params.status : ""));
        calls.last = cm.params;
        (calls.plist = calls.plist || []).push(cm.params);
        if (cm.type === "attendance") { const mkS = (id, d, st) => ({ id, title: "جلسة " + id, track: "مسار الحلاقة الرجالية المرحلة الثانية", group: "G2", trainer: "مدرب", date: d, rows: [{ sid: "1", name: "طالب كثير الغياب", stu: "STU-1-1", status: st }, { sid: "2", name: "طالب منتظم", stu: "STU-2-2", status: id === 4 ? "excused" : "present" }] }); return { type: "attendance", label: cm.label, params: cm.params, listed: 4, truncated: false, note: "", sessions: [mkS(1, "2026-11-08", "absent"), mkS(2, "2026-11-09", "absent"), mkS(3, "2026-11-10", "absent"), mkS(4, "2026-11-11", "absent")] }; }
        if (cm.type === "page") return { type: "page", source: cm.source, label: cm.label, params: cm.params, stats: [{ label: "إرسالاً", value: "137" }], filters: [{ name: "status", label: "الحالة", type: "select", value: "", options: [{ v: "", t: "الكل" }, { v: "completed", t: "مكتمل" }] }, { name: "training_group_id", label: "المجموعة", type: "select", value: "", options: [{ v: "", t: "كل المجموعات" }, { v: "5", t: "G1 - د. أحمد" }, { v: "6", t: "G2 - د. سارة" }] }, { name: "track_id", label: "المسار", type: "select", value: "", options: [{ v: "", t: "الكل" }, { v: "1", t: "مسار الحلاقة الرجالية" }, { v: "2", t: "مسار التسويق الرقمي" }] }, { name: "training_course_id", label: "الدورة التدريبية", type: "select", value: "", options: [{ v: "", t: "كل الدورات" }, { v: "9", t: "المرحلة الثانية - مسار الحلاقة الرجالية" }, { v: "10", t: "المرحلة الأولى - مسار الحلاقة الرجالية" }, { v: "11", t: "المرحلة الثانية - مسار التطريز والخياطة" }] }],
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
  c.state.imp.stages = []; c.state.imp.tracks = []; c.state.imp.known = []; c.render();
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
  ok("تقريران: الملخص بقراءة، والأسئلة بقراءة لكل مسار (2) ويصل ناتج كل منهما", calls.length === 3 && /^impact/.test(calls[0]) && calls.filter((x) => /^questions/.test(x)).length === 2 && Object.keys(c.state.imp.outs).length === 2, JSON.stringify(calls));
  ok("تقرير الأسئلة مدموج بعمود «المسار»", (c.state.imp.outs.questions.tables[0].heads.slice(-1)[0] === "المسار") && c.state.imp.outs.questions.courses.length === 2, JSON.stringify(c.state.imp.outs.questions.courses));
  ok("تبويب العرض بين التقريرين ظاهر", b.querySelectorAll('[data-imp="view"]').length === 2, b.querySelectorAll('[data-imp="view"]').length);
  let capZ = null; const odZ = App.ui.download; App.ui.download = (n, blob) => { capZ = { n, blob }; };
  b.querySelector('[data-cc="export-imp"]').click(); for (let i = 0; i < 60 && !capZ; i++) await wait(150); App.ui.download = odZ;
  const zz = capZ && await JSZip.loadAsync(await capZ.blob.arrayBuffer());
  ok("التنزيل ملف zip فيه ملف Excel لكل تقرير", !!zz && /\.zip$/.test(capZ.n) && Object.keys(zz.files).length === 2 && Object.keys(zz.files).every((n) => /\.xlsx$/.test(n)), capZ && capZ.n + " " + (zz ? Object.keys(zz.files).join("|") : ""));
  // المرحلة تُفصل بقائمة «الدورة التدريبية» في صفحة النظام: قراءة لكل دورة مطابقة ثم دمجها
  c.state.imp.stages = ["المرحلة الثانية"]; c.state.imp.srv = {}; c.state.imp.known = [];
  c.state.imp.pages = ["impact"]; c.state.imp.outs = {}; c.render();
  calls.length = 0; calls.plist = []; b.querySelector('[data-cc="run-imp"]').click();
  for (let i = 0; i < 80 && !(c.state.imp.out && c.state.imp.out.courses); i++) await wait(200); await wait(300);
  const cids = (calls.plist || []).map((p) => p.training_course_id).filter(Boolean).sort().join();
  ok("المرحلة الثانية: قراءة استكشاف ثم قراءة لكل دورة مطابقة (9 و11) فقط", calls.length === 3 && cids === "11,9", JSON.stringify({ n: calls.length, cids }));
  const mo = c.state.imp.out;
  ok("الجداول مدموجة بعمود «الدورة التدريبية» ودورتان", !!mo && mo.courses.length === 2 && mo.tables[0].heads.includes("الدورة التدريبية") && mo.tables[0].rows.length === 8, mo && JSON.stringify({ c: mo.courses, h: mo.tables[0].heads, n: mo.tables[0].rows.length }));
  c.state.imp.tracks = [String(([...b.querySelectorAll('[data-imp="tracks"]')].find((x) => x.parentNode.textContent.includes("الحلاقة الرجالية")) || {}).value)]; 
  calls.length = 0; calls.plist = []; b.querySelector('[data-cc="run-imp"]').click();
  for (let i = 0; i < 80 && !calls.plist.length; i++) await wait(200); await wait(400);
  ok("مع مسار الحلاقة: دورة واحدة فقط (9) بلا قراءة استكشاف", calls.length === 1 && (calls.plist[0] || {}).training_course_id === "9", JSON.stringify(calls.plist));
  // الأسئلة بلا إجابات تُخفى افتراضياً ويمكن إظهارها
  c.state.imp.out = { type: "page", at: new Date(), filters: [], stats: [], tables: [{ title: "أسئلة", heads: ["السؤال", "عدد الإجابات"], rows: [{ cells: ["س1", "105"] }, { cells: ["س2", "0"] }] }] }; c.state.imp.hideZero = true; c.render();
  ok("إخفاء الأسئلة بلا إجابات (افتراضياً)", rowsOf("imp-0") === 1, rowsOf("imp-0"));
  const hz = b.querySelector('[data-imp="hideZero"]'); hz.click(); await wait(100);
  ok("وإظهارها بإلغاء الخيار", rowsOf("imp-0") === 2, rowsOf("imp-0"));
  c.state.imp.hideZero = true; c.state.imp.out = null;
  // تصفية المجموعة تسري على كل التقارير
  DATA = [mk("طالب أ", "41", "059", "1", S2, "G1 - "), mk("طالب ب", "42", "059", "2", S2, "G2 - ")]; PARTIAL = false;
  c.state.gopen = "groups"; c.state.groups = ["G1"]; c.state.results = null; c.state.mode = "report"; c.state.sel = { tracks: ["1"], stages: [], status: "", group_status: "", details: false, extra: {} }; c.render();
  ok("شريط المجموعات ظاهر في التقارير", !!b.querySelector("[data-gf]") || /تظهر المجموعات بعد/.test(b.textContent), "bar");
  b.querySelector('[data-cc="run-selection"]').click();
  for (let i = 0; i < 60 && !c.state.results; i++) await wait(200); await wait(300);
  const gr = c.state.results && c.state.results.results && c.state.results.results[0];
  ok("المجموعة G1 وحدها: طالب واحد من اثنين", !!gr && gr.rows.length === 1, gr && JSON.stringify(gr.rows.map((x) => x.cells[2])));
  c.state.groups = []; c.state.results = null;
  // قائمة المجموعات: قراءة واحدة بضغطة، وتُحفظ فتظهر مربعات
  c.state.gopen = "groups"; localStorage.removeItem("tamkeen_cc_group_list"); c.state.imp.known = []; c.state.cache = null; c.state.mode = "report"; c.render();
  ok("بلا مجموعات محفوظة: زر التحميل ظاهر", !!b.querySelector('[data-cc="load-groups"]') && b.querySelectorAll("[data-gf]").length === 0, b.querySelectorAll("[data-gf]").length);
  calls.length = 0; b.querySelector('[data-cc="load-groups"]').click();
  for (let i = 0; i < 60 && b.querySelectorAll("[data-gf]").length === 0; i++) await wait(200); await wait(200);
  ok("«حمّل قائمة المجموعات»: قراءة واحدة تُظهر G1 وG2 وتُحفظ", calls.length === 1 && b.querySelectorAll("[data-gf]").length === 2 && /G1/.test(localStorage.getItem("tamkeen_cc_group_list") || ""), JSON.stringify({ calls, n: b.querySelectorAll("[data-gf]").length }));
  c.state.imp.stages = []; c.state.imp.tracks = []; c.state.imp.known = [];
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
  // لقطات قياس الأثر: حفظ ثم مقارنة، وملخص واتساب، وترتيب الأسئلة من الأضعف
  localStorage.removeItem("tamkeen-admin:cc-imp-snaps");
  const sumTab = (a54, avg) => ({ title: "ملخص", heads: ["النموذج", "المسار", "النوع", "الطلاب المستهدفون", "أجابوا", "نسبة الاستجابة", "متوسط الدرجة"], rows: [{ cells: ["استبانة الحلاقة - قبلي", "مسار الحلاقة الرجالية", "تقييم قبلي", "109", String(a54), "49.54%", avg] }] });
  c.state.imp.page = "impact"; c.state.imp.pages = ["impact"]; c.state.imp.view = "impact"; c.state.imp.tracks = []; c.state.imp.stages = []; c.state.imp.cmpWith = "";
  c.state.imp.outs = { impact: { type: "page", at: new Date(), filters: [], stats: [], tables: [sumTab(54, "2.71")] } }; c.state.imp.out = c.state.imp.outs.impact; c.state.mode = "impact"; c.render();
  b.querySelector('[data-cc="imp-snap-save"]').click(); await wait(150);
  ok("تنبيه نسبة الاستجابة: 49.54% دون 50%", /نسبة استجابته دون 50%/.test(b.textContent) && !!b.querySelector("td.cc-low"), b.textContent.slice(0, 80));
  c.state.imp.respThr = 40; c.render();
  ok("عتبة 40%: لا تنبيه ولا تلوين", !/نسبة استجابته دون/.test(b.textContent) && !b.querySelector("td.cc-low"), "thr40");
  c.state.imp.respThr = 50; c.render();
  ok("حفظ لقطة قياس الأثر", JSON.parse(localStorage.getItem("tamkeen-admin:cc-imp-snaps") || "[]").length === 1, localStorage.getItem("tamkeen-admin:cc-imp-snaps") && "saved");
  c.state.imp.outs = { impact: { type: "page", at: new Date(), filters: [], stats: [], tables: [sumTab(60, "2.91")] } }; c.state.imp.out = c.state.imp.outs.impact; c.render();
  const snSel = b.querySelector('[data-imp="cmpWith"]'); snSel.value = snSel.options[1].value; snSel.dispatchEvent(new Event("change", { bubbles: true })); await wait(150);
  ok("المقارنة مع اللقطة: الفرق ▲ +6 في أجابوا", /▲ \+6/.test(b.textContent) && /الآن مقابل السابق/.test(b.textContent), "diff");
  let waTxt2 = ""; const oc = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { waTxt2 = x; } }, configurable: true });
  b.querySelector('[data-cc="imp-copy-wa"]').click(); await wait(150);
  ok("ملخص واتساب: مسار ونوع ونسبة ومتوسط", /\*مسار الحلاقة الرجالية\*|\*الحلاقة الرجالية\*/.test(waTxt2) && /تقييم قبلي: استجابة 49.54%/.test(waTxt2) && /متوسط 2.91/.test(waTxt2), waTxt2.slice(0, 160));
  try { Object.defineProperty(navigator, "clipboard", { value: oc, configurable: true }); } catch (e) { /* */ }
  c.state.imp.cmpWith = ""; c.state.imp.outs = { questions: { type: "page", at: new Date(), filters: [], stats: [], tables: [{ title: "أسئلة", heads: ["السؤال", "المتوسط"], rows: [{ cells: ["قوي", "4.5"] }, { cells: ["ضعيف", "1.2"] }, { cells: ["وسط", "3.0"] }] }] } };
  c.state.imp.view = "questions"; c.state.imp.pages = ["questions"]; c.state.imp.out = c.state.imp.outs.questions; c.render();
  ok("الأسئلة مرتبة من الأضعف إلى الأقوى", [...b.querySelectorAll('[data-tblbox="imp-0"] tbody tr')].map((r) => r.cells[0].textContent.trim()).join() === "ضعيف,وسط,قوي", [...b.querySelectorAll('[data-tblbox="imp-0"] tbody tr')].map((r) => r.cells[0].textContent.trim()).join());
  c.state.imp.pages = ["impact"]; c.state.imp.view = "impact"; c.state.imp.outs = {}; c.state.imp.out = null; localStorage.removeItem("tamkeen-admin:cc-imp-snaps");
  // الحضور والغياب: تجميع لكل طالب وتنبيه عند تجاوز 3 غيابات
  c.state.mode = "attend"; c.state.att = Object.assign(c.state.att, { from: "2026-11-08", to: "2026-11-11", thr: 3, excused: false, max: 80, tracks: [], stages: [], out: null }); c.state.groups = []; c.render();
  ok("تبويب الحضور والغياب: حقول وزر الجلب", !!b.querySelector('[data-att="from"]') && !!b.querySelector('[data-att="thr"]') && !!b.querySelector('[data-cc="run-att"]'), "view");
  c.state.wideLimit = 1000; c.state.wide = null;
  calls.length = 0; b.querySelector('[data-cc="run-att"]').click();
  for (let i = 0; i < 60 && !c.state.att.out && !c.state.resultError; i++) await wait(200); await wait(300);
  const ao = c.state.att.out;
  ok("الحضور: طالبان من أربع جلسات، وأمر قراءة واحد", !!ao && ao.students.length === 2 && ao.sessions === 4 && calls.length === 1 && /^attendance/.test(calls[0]), JSON.stringify({ calls, err: c.state.resultError, n: ao && ao.students.length }));
  const attRows = [...b.querySelectorAll('[data-tblbox="att-0"] tbody tr')].map((r) => r.textContent.replace(/\s+/g, " "));
  ok("الطالب الذي غاب 4 مرات يظهر أولاً بعلامة التنبيه", attRows.length === 2 && /طالب كثير الغياب/.test(attRows[0]) && /⚠ تجاوز 3/.test(attRows[0]) && !/⚠/.test(attRows[1]), JSON.stringify(attRows));
  ok("الغياب المتتالي يظهر في جدول الطالب كثير الغياب", /أطول غياب متتالٍ/.test(b.querySelector('[data-tblbox="att-0"] thead').textContent) && /جلسات متتالية/.test(attRows[0]), attRows[0]);
  ok("شريط التنبيه: طالب واحد تجاوز 3 غيابات", /طالباً تجاوزوا 3 غيابات/.test(b.textContent) && !!b.querySelector('[data-cc="att-copy"]'), "banner");
  // غائبو آخر يوم بحسب المجموعة + نص واتساب
  let waAtt = ""; const ocA = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { waAtt = x; } }, configurable: true });
  const grpBox = b.querySelector(".cc-att-groups");
  ok("غائبو آخر يوم بحسب المجموعة", !!grpBox && grpBox.querySelectorAll(".cc-att-g").length >= 1 && !!b.querySelector('[data-cc="att-wa"]') && !!b.querySelector('[data-cc="att-wa-all"]'), grpBox && grpBox.textContent.slice(0, 120));
  b.querySelector('[data-cc="att-wa"]').click(); await wait(150);
  ok("نص واتساب لمجموعة: عنوان وأسماء وعدد", /^\*غياب 20\d\d-\d\d-\d\d — /.test(waAtt) && /١\. /.test(waAtt) && /الغائبون \d+/.test(waAtt), waAtt.slice(0, 160));
  b.querySelector('[data-cc="att-wa-all"]').click(); await wait(150);
  ok("نسخ نصوص كل المجموعات", /━━━━|^\*غياب/.test(waAtt), waAtt.slice(0, 80));
  try { Object.defineProperty(navigator, "clipboard", { value: ocA, configurable: true }); } catch (e) { /* */ }
  c.state.att.thr = 5; c.render();
  ok("رفع الحد إلى 5: لا تنبيه", !/⚠ تجاوز/.test(b.textContent) && /لا طالب تجاوز 5/.test(b.textContent), "thr");
  // تقرير حضور محفوظ بخيار «اليوم دائماً»: يقرأ تاريخ اليوم لا تاريخ الحفظ
  c.state.att.from = "2026-01-01"; c.state.att.to = "2026-01-05"; c.state.att.alwaysToday = true; c.state.att.out = null; c.render();
  c.state.saved = [{ id: "sv-att", name: "حضور اليوم", mode: "attend", cfg: JSON.parse(JSON.stringify(Object.assign({}, c.state.att, { from: "2026-01-01", to: "2026-01-05", out: null }))) }];
  c.render(); calls.length = 0; b.querySelector('[data-cc="sv-run"][data-id="sv-att"]').click();
  for (let i = 0; i < 60 && !c.state.att.out && !c.state.resultError; i++) await wait(200); await wait(200);
  ok("تقرير الحضور المحفوظ (اليوم دائماً): التاريخ اليوم وقراءة", c.state.att.from === App.ui.todayISO() && c.state.att.to === App.ui.todayISO() && calls.length >= 1, JSON.stringify({ f: c.state.att.from, calls: calls.length }));
  c.state.att.alwaysToday = false; c.state.saved = [];
  // زر «تقرير اليوم» يضبط الفترة على اليوم ويقرأ
  c.state.att.from = "2026-01-01"; c.state.att.to = "2026-01-05"; c.state.att.out = null; c.render();
  calls.length = 0; b.querySelector('[data-cc="att-today"]').click();
  for (let i = 0; i < 60 && !c.state.att.out && !c.state.resultError; i++) await wait(200); await wait(200);
  ok("تقرير اليوم: الفترة اليوم وأمر قراءة", c.state.att.from === App.ui.todayISO() && c.state.att.to === App.ui.todayISO() && calls.length >= 1, JSON.stringify({ f: c.state.att.from, calls: calls.length }));
  c.state.att.thr = 3; c.state.att.out = null; c.state.mode = "report"; c.state.wideLimit = 0;
  // أقراص النطاق تُفتح وتُغلق بالنقر (النقر على النص الداخلي أيضاً)
  c.state.mode = "report"; c.state.gopen = ""; c.render();
  b.querySelector('.cc-pill[data-gk="stages"] b').click(); await wait(100);
  ok("النقر على قرص «المراحل» يفتح قائمته", c.state.gopen === "stages" && b.querySelectorAll('[data-sc="stages"]').length === 3, c.state.gopen);
  b.querySelector('.cc-pill[data-gk="tracks"]').click(); await wait(100);
  ok("النقر على قرص «المسارات» ينقل الفتح إليه", c.state.gopen === "tracks" && b.querySelectorAll('[data-sc="tracks"]').length > 3, c.state.gopen);
  b.querySelector('.cc-pill[data-gk="tracks"]').click(); await wait(100);
  ok("النقر مرة ثانية يغلقها", c.state.gopen === "", c.state.gopen);
  // النطاق الموحّد: اختيار مسار ومرحلة من الشريط يسري على كل التبويبات
  c.state.groups = []; [c.state.sel, c.state.mis, c.state.cmp, c.state.sib, c.state.dq, c.state.grp, c.state.imp].forEach((x) => { x.tracks = []; if ("stages" in x) x.stages = []; });
  c.state.mode = "report"; c.state.gopen = "tracks"; c.render();
  const sc1 = b.querySelector('[data-sc="tracks"]'); sc1.click(); await wait(100);
  c.state.gopen = "stages"; c.render(); b.querySelector('[data-sc="stages"][value="المرحلة الثانية"]').click(); await wait(100);
  ok("النطاق: المسار والمرحلة يسريان على كل التبويبات", c.state.dq.tracks.length === 1 && c.state.imp.tracks.length === 1 && c.state.sel.tracks.length === 1 && c.state.sel.stages.join() === "الثان" && c.state.dq.stages.join() === "المرحلة الثانية" && c.state.mis.stages.join() === "الثان", JSON.stringify({ dq: c.state.dq.stages, sel: c.state.sel.stages, mis: c.state.mis.stages }));
  ok("القوائم المكررة داخل التبويب مخفية والشريط ظاهر", [...b.querySelectorAll("fieldset.cc-fs")].filter((f) => !f.closest(".cc-gbar") && /^(المسارات|المراحل)/.test((f.querySelector("legend") || {}).textContent || "")).every((f) => f.hidden) && !!b.querySelector(".cc-gbar"), "dupes");
  b.querySelector('[data-cc="gclear"]').click(); await wait(100);
  ok("«مسح الكل» يفرّغ النطاق في كل التبويبات", c.state.dq.tracks.length === 0 && c.state.sel.stages.length === 0 && c.state.imp.stages.length === 0, "clear");
  c.state.gopen = "";
  // «تنزيل الكل»: ملف Excel لكل مسار داخل ملف مضغوط واحد
  c.state.mode = "report"; c.state.labels = ["مسار الحلاقة الرجالية", "مسار التسويق الرقمي"];
  c.state.results = { results: [{ type: "list", heads: ["الاسم", "المجموعة"], rows: [{ cells: ["أ", "G1"] }] }, { type: "list", heads: ["الاسم", "المجموعة"], rows: [{ cells: ["ب", "G2"] }, { cells: ["ج", "G2"] }] }] }; c.render();
  let capA = null; const odA = App.ui.download; App.ui.download = (n, blob) => { capA = { n, blob }; };
  b.querySelector('[data-cc="export-all"]').click(); for (let i = 0; i < 60 && !capA; i++) await wait(150); App.ui.download = odA;
  const za = capA && await JSZip.loadAsync(await capA.blob.arrayBuffer());
  const namesA = za ? Object.keys(za.files).sort() : [];
  ok("تنزيل الكل: zip فيه ملف Excel لكل مسار", !!capA && /\.zip$/.test(capA.n) && namesA.length === 2 && namesA.includes("الحلاقة الرجالية.xlsx") && namesA.includes("التسويق الرقمي.xlsx"), JSON.stringify(namesA));
  c.state.results = null;
  ok("جدول الاختبارات يقبل بيانات المركز", typeof (App.examSheet || {}).useData === "function");
  // أعمدة الوقت اليدوية (ساعة الحضور/الخروج) لا تُملأ بعدد ساعات المسار
  const tdf = App.converterCore.trackDataFieldFor;
  ok("«ساعة الخروج» و«ساعة الحضور» و«الانصراف» لا تُربط بساعات المسار", !tdf("ساعة الخروج") && !tdf("ساعة الحضور") && !tdf("ساعة الانصراف") && !tdf("وقت الخروج"), [tdf("ساعة الخروج"), tdf("ساعة الحضور")].join("|"));
  ok("«عدد الساعات» و«الساعات المكتملة» ما زالتا تُربطان بساعات المسار", !!tdf("عدد الساعات التدريبية") && tdf("الساعات المكتملة") === App.converterCore.TRACK_DATA_COLS.hoursCompleted, tdf("عدد الساعات التدريبية"));

  // ===== إضافات تاب النماذج (forms-extra): ملفات الزملاء والأدوات =====
  if (App.formsExtra) {
    const day = 86400000, t0 = Date.now();
    let ffiles = [
      { id: "f1", name: "أقدم رفعاً.pdf", cat: "تقارير", by: "د.يوسف", at: new Date(t0 - 30 * day).toISOString(), up: new Date(t0 - 30 * day).toISOString(), size: 2048 },
      { id: "f2", name: "أنشأته قبل أشهر ورفعته اليوم.docx", cat: "تقارير", by: "د.يوسف", at: new Date(t0 - 200 * day).toISOString(), up: new Date(t0).toISOString(), size: 2048 },
      { id: "f3", name: "اختبار-قديم.txt", cat: "أخرى", by: "د.يوسف", at: new Date(t0 - 2 * day).toISOString(), up: "", size: 10 },
      { id: "f4", name: "لشخص آخر.pdf", cat: "تقارير", by: "رشا", at: new Date(t0).toISOString(), up: new Date(t0).toISOString(), size: 5 },
    ];
    let fbeat = { at: new Date(t0 - 60000).toISOString(), by: "د.يوسف", host: "PC", lastName: "x.pdf", lastAt: new Date(t0).toISOString(), uploaded: 1 };
    let frules = [{ match: "فاتورة", cat: "تقارير" }], ftrash = [{ id: "t1", name: "محذوف.pdf", by: "رشا", cat: "تقارير", size: 100, at: new Date().toISOString() }], flocked = false;
    const fsent = [];
    const ofetch = window.fetch;
    window.fetch = async (u, o) => {
      if (!String(u).includes("script.google.com")) return ofetch(u, o);
      const q = JSON.parse(o.body); fsent.push(q.action + (q.id ? ":" + q.id : ""));
      let d = { ok: true };
      if (q.action === "dropList") d = { files: JSON.parse(JSON.stringify(ffiles)), cats: ["تقارير", "أخرى"], folder: "x", beat: fbeat, locked: flocked };
      else if (q.action === "dropCats") d = { cats: ["تقارير", "أخرى"], locked: flocked };
      else if (q.action === "dropRules") d = { rules: frules };
      else if (q.action === "dropRulesSave") { frules = q.rules; d = { ok: true, rules: frules }; }
      else if (q.action === "dropTrash") d = { files: ftrash };
      else if (q.action === "dropRestore") { ftrash = ftrash.filter((x) => x.id !== q.id); }
      else if (q.action === "dropDelete") { ffiles = ffiles.filter((x) => x.id !== q.id); }
      else if (q.action === "dropFile") d = { name: "x.png", mime: "image/png", data: btoa("x") };
      else if (q.action === "dropTokenSet") { flocked = !q.clear; d = { ok: true, token: q.clear ? "" : "TOKEN1234567890A" }; }
      return { json: async () => d };
    };
    localStorage.setItem("tamkeen:drop-key", "k"); localStorage.removeItem("tamkeen:drop-seen");
    location.hash = "#forms"; await wait(400);
    for (let i = 0; i < 40 && document.querySelector("#frm-drop [data-drop=\"load\"]") === null; i++) await wait(150);
    await App.formsExtra.refresh(); await wait(500);
    const loadBtn = document.querySelector('#frm-drop [data-drop="load"]'); if (loadBtn) { loadBtn.click(); await wait(900); }
    ok("شارة المراقب: يعمل بنبضة حديثة", /المراقب يعمل/.test((document.querySelector(".fx-watch") || {}).textContent || "") && !!document.querySelector(".fx-watch .fx-dot.green"), (document.querySelector(".fx-watch") || {}).textContent);
    ok("الصفحة ثلاثة أقسام: الجاهزة ونماذجي وملفات الزملاء", [...document.querySelectorAll(".frm-sec")].length === 3 && document.getElementById("view-forms").dataset.sec === "forms" && document.querySelectorAll("#frm-body .frm-card").length === App.forms.FORMS.length, document.getElementById("view-forms").dataset.sec);
    ok("قسم الجاهزة يعرض شرائح التصنيف بأعدادها", [...document.querySelectorAll("#frm-cats .frm-cat")].length === 4 && /\d/.test((document.querySelector("#frm-cats .frm-cat b") || {}).textContent || ""), [...document.querySelectorAll("#frm-cats .frm-cat")].map((x) => x.textContent).join("|"));
    document.querySelector('[data-frm-sec="people"]').click(); await wait(700);
    ok("قسم ملفات الزملاء: بطاقة لكل شخص", document.getElementById("view-forms").dataset.sec === "people" && document.querySelectorAll(".frm-pcard").length === 2, document.querySelectorAll(".frm-pcard").length);
    const personBtn = document.querySelector('[data-frm-cat="by:د.يوسف"]'); personBtn && personBtn.click(); await wait(900);
    ok("آخر ما أُضيف: ملف أُنشئ قديماً ورُفع اليوم أولاً", (document.querySelector(".fx-latest .fx-hit b") || {}).textContent === "أنشأته قبل أشهر ورفعته اليوم.docx", (document.querySelector(".fx-latest .fx-hit b") || {}).textContent);
    const gridNames = [...document.querySelectorAll("#frm-body .frm-groupgrid .frm-card h3")].map((h) => h.textContent);
    ok("ترتيب التصنيف بتاريخ الرفع: الأحدث رفعاً أولاً", gridNames.indexOf("أنشأته قبل أشهر ورفعته اليوم") >= 0 && gridNames.indexOf("أنشأته قبل أشهر ورفعته اليوم") < gridNames.indexOf("أقدم رفعاً"), JSON.stringify(gridNames));
    document.querySelector('[data-fx="pick-test"]').click(); await wait(300);
    ok("تحديد ملفات الاختبار", /\(1\)/.test(document.querySelector('[data-fx="bulkdel"]').textContent), document.querySelector('[data-fx="bulkdel"]').textContent);
    window.confirm = () => true; document.querySelector('[data-fx="bulkdel"]').click(); await wait(1500);
    ok("الحذف الجماعي أرسل dropDelete لملف الاختبار", fsent.includes("dropDelete:f3") && !ffiles.some((x) => x.id === "f3"), JSON.stringify(fsent.filter((x) => /Delete/.test(x))));
    // المعاينة
    const pv = document.querySelector('[data-fx="preview"]'); if (pv) { pv.click(); await wait(800); }
    ok("المعاينة تفتح نافذة بالصورة", !!document.querySelector(".fx-modal"), "modal"); const cl = document.querySelector('.fx-modal [data-fx="close"]'); if (cl) cl.click();
    // قواعد التصنيف
    document.querySelector('[data-fx-op="rules"]').click(); await wait(900);
    document.querySelector('[data-fx="rule-add"]').click(); await wait(200);
    const rin = [...document.querySelectorAll("[data-fx-rm]")].pop(); rin.value = "كتاب|book"; rin.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-fx="rule-save"]').click(); await wait(700);
    ok("حفظ قاعدة تصنيف جديدة", frules.length === 2 && frules[1].match === "كتاب|book", JSON.stringify(frules));
    // السلة
    document.querySelector('[data-fx-op="trash"]').click(); await wait(900);
    document.querySelector('[data-fx="restore"]').click(); await wait(1200);
    ok("استعادة ملف من سلة المحذوفات", fsent.includes("dropRestore:t1") && ftrash.length === 0, JSON.stringify(fsent.filter((x) => /Restore/.test(x))));
    // حماية الرابط
    document.querySelector('[data-fx-op="token"]').click(); await wait(400);
    document.querySelector('[data-fx="tk-new"]').click(); await wait(700);
    ok("حماية الرابط: رمز جديد يظهر في الرابط", flocked && /drop\.html\?k=TOKEN1234567890A/.test(document.querySelector(".fx-ops-panel").textContent), document.querySelector(".fx-ops-panel").textContent.slice(0, 80));
    document.querySelector('[data-fx="tk-clear"]').click(); await wait(600);
    ok("إلغاء الحماية", !flocked, "clear");
    window.fetch = ofetch; localStorage.removeItem("tamkeen:drop-key"); localStorage.removeItem("tamkeen:drop-seen");
    location.hash = "#dashboard";
  }

  // مطابقة أوراق التوقيع: قراءة بالذكاء الاصطناعي (مُحاكاة) ← مراجعة ← مقارنة بالمسجلين ← قائمة من لم يوقّع
  {
    const oldVision = App.ai.vision, oldHas = App.ai.hasKey, oldRun = agent.run;
    App.ai.hasKey = () => true;
    App.ai.vision = async () => JSON.stringify({ title: "ورقة 1", rows: [
      { name: "أحمد علي محمد", signed: true, confidence: 0.95 },
      { name: "خالد سعيد", signed: false, confidence: 0.9 },
      { name: "محمود يوسف حسن", signed: true, confidence: 0.9 },
      { name: "اسم غريب تماما", signed: true, confidence: 0.9 },
      { name: "سمي عمرو", id: "٢٠٢٠٢٠٢٠٢٠", signed: true, confidence: 0.9 },
    ] });
    agent.run = async (cmds) => ({ results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية"], rows: [
      { cells: ["أحمد علي محمد", "101", "G1"] }, { cells: ["خالد سعيد", "102", "G1"] }, { cells: ["سامي عمر", "103", "G1", "2020202020"] }, { cells: ["محمود يوسف حسين", "104", "G1"] },
    ] })) });
    c.state.mode = "sign"; c.state.groups = []; c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "9", files: [{ name: "ورقة1.jpg", mime: "image/jpeg", data: "AAAA", thumb: "data:image/jpeg;base64,AAAA", w: 10, h: 10 }], rows: null, reg: null, manual: {} });
    c.render();
    ok("تبويب مطابقة التوقيعات: حقل الصور وزر القراءة", !!b.querySelector("#cc-sig-files") && !!b.querySelector('[data-cc="sig-read"]') && !!b.querySelector('[data-cc="run-sig"]'), "view");
    b.querySelector('[data-cc="sig-read"]').click();
    for (let i = 0; i < 40 && !c.state.sig.rows; i++) await wait(100); await wait(150);
    ok("قراءة الصورة: خمسة أسماء في المحرّر", !!c.state.sig.rows && c.state.sig.rows.length === 5 && [...b.querySelectorAll("#cc-sig input")].some((i) => /أحمد علي محمد/.test(i.value)), JSON.stringify(c.state.sig.rows && c.state.sig.rows.length));
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 40 && !c.state.sig.reg; i++) await wait(100); await wait(300);
    const sg = c.state.sig;
    ok("المسجلون من نظام المركز: أربعة", !!sg.reg && sg.reg.length === 4, JSON.stringify(sg.reg && sg.reg.length) + " " + c.state.resultError);
    let sgCopy = ""; const ocS = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { sgCopy = x; } }, configurable: true });
    const unsigned = b.querySelector('[data-tblbox="sig-miss"]') ? b.querySelector('[data-tblbox="sig-miss"]').textContent : b.textContent;
    ok("من لم يوقّع: خالد فقط (ورقته فارغة)؛ سامي طابقته الهوية رغم تشوّه اسمه", /خالد سعيد/.test(unsigned) && !/سامي عمر/.test(unsigned) && !/أحمد علي محمد/.test(unsigned), unsigned.replace(/\s+/g, " ").slice(0, 200));
    ok("تقارب الأسماء (حسين/حسن) يُطابَق ولا يُعدّ غائباً", !/محمود يوسف حسين/.test(unsigned), "fuzzy");
    const cp = b.querySelector('[data-cc="sig-copy"]'); if (cp) { cp.click(); await wait(150); }
    ok("نسخ قائمة من لم يوقّعوا", /لم يوقّعوا/.test(sgCopy) && /خالد سعيد/.test(sgCopy) && sgCopy.includes("\n"), sgCopy.slice(0, 120));
    try { Object.defineProperty(navigator, "clipboard", { value: ocS, configurable: true }); } catch (e) { /* */ }
    ok("زر تنزيل Excel للمطابقة", !!b.querySelector('[data-cc="export-sig"]'), "xlsx");
    // اختيار كل المراحل (بعناوينها) يجب أن يُترجَم إلى دورات لا إلى خطأ «لا توجد دورة»
    c.state.sig.tracks = []; c.state.sig.stages = ["المرحلة الأولى", "المرحلة الثانية", "المرحلة الثالثة"]; c.state.sig.reg = null; c.state.resultError = ""; c.render();
    calls.length = 0; calls.plist = []; let sent = [];
    const runB = agent.run; agent.run = async (cmds) => { sent = cmds.map((x) => x.params); return runB(cmds); };
    c.state.wideLimit = 1000; c.state.wide = null;
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 40 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(200);
    ok("كل المراحل: تُجلب المسجلون بلا خطأ «لا توجد دورة»", !/لا توجد دورة/.test(c.state.resultError || "") && !!c.state.sig.reg && c.state.sig.reg.length >= 1, JSON.stringify({ err: c.state.resultError, sent, wide: !!c.state.wide, busy: c.state.busy }));
    agent.run = runB;
    App.ai.vision = oldVision; App.ai.hasKey = oldHas; agent.run = oldRun; c.state.mode = "report"; c.state.sig.rows = null; c.state.sig.reg = null; c.render();
  }

  // مقارنة ملف Excel خارجي بالمسجلين
  {
    const oldRun = agent.run;
    agent.run = async (cmds) => ({ results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [
      { cells: ["أحمد علي محمد", "201", "G1", "1012345678", "0501112222"] }, { cells: ["ليلى حسن", "202", "G1", "1099999999", "0500000000"] }, { cells: ["فهد منصور", "203", "G1", "1088888888", "0505555555"] },
    ] })) });
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("كشف");
    ws.addRow(["كشف متدربين"]); ws.addRow(["م", "اسم المتدرب", "رقم الهوية", "الجوال"]);
    ws.addRow([1, "أحمد علي محمد", "1012345678", "0501112222"]); ws.addRow([2, "ليلى حسن", "1099999999", "0503334444"]); ws.addRow([3, "نورة خالد", "1066666666", "0507776666"]);
    const file = new File([await wb.xlsx.writeBuffer()], "كشف.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    c.state.mode = "xl"; c.state.groups = []; c.state.xl = Object.assign(c.state.xl, { tracks: ["1"], stages: [], status: "8", sheets: [], out: null, reg: null }); c.render();
    ok("تبويب مقارنة Excel: حقل الملف", !!b.querySelector("#cc-xl-file") && !!b.querySelector('[data-cc="run-xl"]'), "view");
    const inp = b.querySelector("#cc-xl-file"), dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 40 && !c.state.xl.sheets.length; i++) await wait(100); await wait(200);
    const xm = c.state.xl.map;
    ok("قراءة الملف وتخمين الأعمدة", c.state.xl.sheets.length === 1 && c.state.xl.sheets[0].rows.length === 3 && xm.name === 1 && xm.id === 2 && xm.phone === 3, JSON.stringify({ n: c.state.xl.sheets.length, m: xm, err: c.state.resultError }));
    c.state.wideLimit = 1000; c.state.wide = null;
    b.querySelector('[data-cc="run-xl"]').click();
    for (let i = 0; i < 40 && !c.state.xl.out && !c.state.resultError; i++) await wait(100); await wait(200);
    const xo = c.state.xl.out;
    ok("نتيجة المقارنة: ناقص في النظام (نورة) وليس في الكشف (فهد) وفرق جوال (ليلى)", !!xo && xo.missingInSystem.length === 1 && xo.missingInSystem[0].name === "نورة خالد" && xo.notInFile.length === 1 && xo.notInFile[0].name === "فهد منصور" && xo.diffs.length === 1 && xo.diffs[0].why.includes("الجوال"), JSON.stringify({ o: xo && [xo.missingInSystem.length, xo.notInFile.length, xo.diffs.length], err: c.state.resultError }));
    ok("عرض الجداول وزر التنزيل", !!b.querySelector('[data-tblbox="xl-missing"]') && !!b.querySelector('[data-cc="export-xl"]') && /نورة خالد/.test(b.querySelector('[data-tblbox="xl-missing"]').textContent), "tables");
    agent.run = oldRun; c.state.mode = "report"; c.state.xl.out = null; c.state.xl.reg = null; c.state.xl.sheets = []; c.render();
  }

  // تقرير الصباح: حضور اليوم + الناقصون، وملخص واحد
  {
    c.state.mode = "morning"; c.state.groups = []; c.state.att = Object.assign(c.state.att, { tracks: [], stages: [], out: null, alwaysToday: false, thr: 3 }); c.state.mis.out = null; c.state.morning.mis = true; c.state.wideLimit = 100000; c.state.wide = null; c.render();
    ok("تبويب تقرير الصباح: زر البدء وخيار الناقصين", !!b.querySelector('[data-cc="run-morning"]') && !!b.querySelector('[data-morning="mis"]'), "view");
    calls.length = 0; b.querySelector('[data-cc="run-morning"]').click();
    for (let i = 0; i < 80 && !(c.state.att.out && c.state.mis.out) && !c.state.resultError; i++) await wait(200); await wait(300);
    ok("تقرير الصباح: قُرئ الحضور بتاريخ اليوم والناقصون", c.state.att.from === App.ui.todayISO() && c.state.att.to === App.ui.todayISO() && !!c.state.att.out && !!c.state.mis.out, JSON.stringify({ f: c.state.att.from, a: !!c.state.att.out, m: !!c.state.mis.out, err: c.state.resultError }));
    let morTxt = ""; const ocM = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { morTxt = x; } }, configurable: true });
    const mb = b.querySelector('[data-cc="morning-copy"]'); if (mb) { mb.click(); await wait(200); }
    ok("ملخص واتساب لتقرير الصباح", /^\*تقرير الصباح — /.test(morTxt) && /الغياب بحسب المجموعة|لا غياب/.test(morTxt) && /ناقصو التقييمات|أكملوا التقييمات/.test(morTxt), morTxt.slice(0, 200));
    try { Object.defineProperty(navigator, "clipboard", { value: ocM, configurable: true }); } catch (e) { /* */ }
    c.state.mode = "report"; c.state.att.out = null; c.state.mis.out = null; c.state.wideLimit = 0; c.render();
  }

  // جاهزية التخرج: حضور الفترة (+ التقييمات) ← مستوفون وغير مستوفين بأسبابهم
  {
    c.state.mode = "grad"; c.state.groups = []; c.state.att = Object.assign(c.state.att, { tracks: [], stages: [], out: null }); c.state.mis.out = null;
    c.state.grad = Object.assign(c.state.grad, { from: "2026-11-08", to: "2026-11-11", maxAbs: 1, minRate: 0, countExcused: false, requireEval: false, out: null }); c.state.wideLimit = 100000; c.state.wide = null; c.render();
    ok("تبويب الجاهزية: الحقول وزر الفحص", !!b.querySelector('[data-grad="maxAbs"]') && !!b.querySelector('[data-cc="run-grad"]') && !b.querySelector('[data-cc="run-grad"]').disabled, "view");
    b.querySelector('[data-cc="run-grad"]').click();
    for (let i = 0; i < 80 && !c.state.grad.out && !c.state.resultError; i++) await wait(200); await wait(300);
    const go = c.state.grad.out;
    ok("الجاهزية: طالبان، أحدهما غاب أكثر من الحد (1)", !!go && go.rows.length === 2 && go.rows.filter((g) => !g.ok).length >= 1 && go.rows.some((g) => g.reasons.some((x) => /غياب/.test(x))), JSON.stringify({ n: go && go.rows.length, err: c.state.resultError }));
    ok("عرض غير المستوفين وزر التنزيل والنسخ", !!b.querySelector('[data-tblbox="grad-no"]') && !!b.querySelector('[data-cc="export-grad"]') && !!b.querySelector('[data-cc="grad-copy"]'), "view2");
    let gTxt = ""; const ocG = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { gTxt = x; } }, configurable: true });
    b.querySelector('[data-cc="grad-copy"]').click(); await wait(200);
    ok("نسخ قائمة غير المستوفين", /^\*غير مستوفين للتخرج/.test(gTxt) && /غياب/.test(gTxt), gTxt.slice(0, 120));
    try { Object.defineProperty(navigator, "clipboard", { value: ocG, configurable: true }); } catch (e) { /* */ }
    c.state.mode = "report"; c.state.att.out = null; c.state.grad.out = null; c.state.wideLimit = 0; c.render();
  }

  // تذكير دوري بالتقارير المحفوظة
  {
    const oldPrompt = window.prompt;
    c.state.mode = "report"; c.state.saved = [{ id: String(Date.now() - 5 * 86400000), name: "تقرير اختبار التذكير", mode: "report", cfg: JSON.parse(JSON.stringify(c.state.sel)) }]; c.render();
    window.prompt = () => "2";
    const rb = b.querySelector('[data-cc="sv-remind"]');
    ok("زر التذكير الدوري بجانب التقرير المحفوظ", !!rb, "btn");
    if (rb) { rb.click(); await wait(200); }
    ok("ضبط التذكير كل يومين", c.state.saved[0].every === 2, JSON.stringify(c.state.saved[0].every));
    App.centerCmd.renderDash(); await wait(100);
    const dsh = document.getElementById("dash-saved");
    ok("اللوحة الرئيسية تعرض التقرير المستحق (مضى 5 أيام > 2)", !!dsh && !dsh.hidden && /تقرير اختبار التذكير/.test(dsh.textContent) && /شغّله الآن/.test(dsh.textContent) && /تذكير كل/.test(dsh.textContent), dsh && dsh.textContent.slice(0, 160));
    c.state.saved[0].ran = new Date().toISOString(); App.centerCmd.renderDash(); await wait(100);
    ok("بعد التشغيل لا يظهر تنبيه الاستحقاق", !/شغّله الآن/.test((document.getElementById("dash-saved") || {}).textContent || ""), "after-run");
    window.prompt = oldPrompt; c.state.saved = []; App.centerCmd.renderDash(); c.render();
  }

  // صورة إلى جدول: قراءة (مُحاكاة) ← جدول ← تحويله إلى مقارنة Excel
  {
    const oldVision = App.ai.vision, oldHas = App.ai.hasKey;
    App.ai.hasKey = () => true;
    App.ai.vision = async () => JSON.stringify({ title: "كشف", heads: ["الاسم", "رقم الهوية", "الجوال"], rows: [["أحمد علي محمد", "1012345678", "0501112222"], ["ليلى حسن", "1099999999", "0503334444"], ["نورة خالد", "1066666666", "0507776666"]] });
    c.state.mode = "img"; c.state.img = Object.assign(c.state.img, { files: [{ name: "كشف.jpg", mime: "image/jpeg", data: "AAAA", thumb: "data:image/jpeg;base64,AAAA", w: 10, h: 10 }], tables: null, failed: [] }); c.render();
    ok("تبويب صورة إلى جدول: حقل الصور وزر القراءة", !!b.querySelector("#cc-img-files") && !!b.querySelector('[data-cc="img-read"]'), "view");
    b.querySelector('[data-cc="img-read"]').click();
    for (let i = 0; i < 40 && !c.state.img.tables; i++) await wait(100); await wait(200);
    ok("الجدول المقروء يظهر بصفوفه الثلاثة", !!c.state.img.tables && c.state.img.tables[0].rows.length === 3 && !!b.querySelector('[data-tblbox="img-0"]') && /نورة خالد/.test(b.querySelector('[data-tblbox="img-0"]').textContent), JSON.stringify(c.state.img.tables && c.state.img.tables.length));
    b.querySelector('[data-cc="img-xl"]').click(); await wait(200);
    ok("«قارنه بالمسجلين»: ينتقل إلى مقارنة Excel ومعه الأعمدة المخمّنة", c.state.mode === "xl" && c.state.xl.sheets.length === 1 && c.state.xl.map.name === 0 && c.state.xl.map.id === 1 && c.state.xl.map.phone === 2, JSON.stringify({ m: c.state.mode, map: c.state.xl.map }));
    App.ai.vision = oldVision; App.ai.hasKey = oldHas; c.state.mode = "report"; c.state.img.tables = null; c.state.img.files = []; c.state.xl.sheets = []; c.render();
  }

  // الترتيب الأبجدي في توليد القوالب (الأساسي) يجب أن يعطي أسماء مرتّبة
  {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("ورقة");
    ws.addRow(["م", "الطالب"]); ws.addRow(["1", "مثال"]);
    const buf = await wb.xlsx.writeBuffer();
    const names = ["سمر فريد", "أحمد علي", "ياسمين", "إسراء حسن", "بشرى سعد", "الجوهرة محمد", "ليلى"];
    const gen = await App.converterCore.generate({ templateBuffer: buf, templateIsDocx: false, templateName: "اختبار", templateHeaders: ["م", "الطالب"], mapping: { "م": "", "الطالب": "الطالب" }, dataRows: names.map((n) => ({ "الطالب": n })), outputFormat: "xlsx", autoNumberHeader: "م", sortRowsBy: "الطالب" });
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await gen.blob.arrayBuffer());
    const got = []; wb2.worksheets[0].eachRow((r, n) => { if (n > 1) got.push(String(r.getCell(2).value)); });
    const want = ["أحمد علي", "إسراء حسن", "بشرى سعد", "الجوهرة محمد", "سمر فريد", "ليلى", "ياسمين"];
    ok("توليد القالب مع ترتيب أبجدي حسب «الطالب»", JSON.stringify(got) === JSON.stringify(want), got);
  }

  // الشريط التعاقبي: اختيار المرحلة يقصر المسارات على المرتبطة بها ويُسقط ما لم يعد مرتبطاً
  {
    c.state.mode = "report"; c.state.gopen = ""; c.state.groups = [];
    [c.state.sel, c.state.mis, c.state.cmp, c.state.sib, c.state.dq, c.state.grp, c.state.imp, c.state.att, c.state.sig, c.state.xl].forEach((x) => { x.tracks = []; if ("stages" in x) x.stages = []; });
    const trF = App.centerSchema.studentFilters.fields.find((f) => f.name === "track_id").options;
    const trAr = trF.find((o) => /الترجمة/.test(o.t)).v;      // مسار ليس له دورة في المرحلة الثالثة
    c.render();
    b.querySelector('.cc-pill[data-gk="tracks"]').click(); await wait(100);
    const allTracks = [...b.querySelectorAll('[data-sc="tracks"]')].map((x) => x.nextElementSibling.textContent);
    ok("بلا مرحلة: كل المسارات تظهر (بينها الترجمة)", allTracks.length >= 6 && allTracks.some((n) => /الترجمة/.test(n)), allTracks);
    c.state.sel.tracks = [String(trAr)]; c.state.att.tracks = [String(trAr)];
    b.querySelector('.cc-pill[data-gk="stages"]').click(); await wait(100);
    const s3 = [...b.querySelectorAll('[data-sc="stages"]')].find((x) => x.value === "المرحلة الثالثة");
    s3.click(); await wait(150);
    ok("اختيار المرحلة الثالثة يُسقط مسار الترجمة المحدَّد (لا دورة له فيها)", !c.state.sel.tracks.includes(String(trAr)) && !c.state.att.tracks.includes(String(trAr)), JSON.stringify(c.state.sel.tracks));
    b.querySelector('.cc-pill[data-gk="tracks"]').click(); await wait(100);
    const t3 = [...b.querySelectorAll('[data-sc="tracks"]')].map((x) => x.nextElementSibling.textContent);
    ok("المرحلة الثالثة: المسارات المرتبطة بها فقط (خمسة بلا الترجمة)", t3.length === 5 && !t3.some((n) => /الترجمة/.test(n)) && t3.some((n) => /الحلاقة/.test(n)), t3);
    ok("ترتيب الأقراص: المراحل ثم المسارات ثم المجموعات", (() => { const k = [...b.querySelectorAll(".cc-gbar .cc-pill")].map((x) => x.dataset.gk); return k.join() === "stages,tracks,groups"; })(), [...b.querySelectorAll(".cc-gbar .cc-pill")].map((x) => x.dataset.gk));
    c.state.gopen = ""; [c.state.sel, c.state.mis, c.state.cmp, c.state.sib, c.state.dq, c.state.grp, c.state.imp, c.state.att, c.state.sig, c.state.xl].forEach((x) => { x.tracks = []; if ("stages" in x) x.stages = []; }); c.render();
  }

  // إعدادات توليد تواريخ الحضور تُحفظ وتعود في كل مرة
  {
    const D = App.converter._dates, st = D.state(), key = "tamkeen-admin:conv-sticky";
    const old = localStorage.getItem(key);
    localStorage.removeItem(key);
    Object.assign(st, { datesEnabled: true, datesStart: "2026-12-01", datesEnd: "2026-12-15", datesWeekdays: [0, 2], groupWeekdays: { "S3G1": [0, 2, 4] } });
    D.save();
    Object.assign(st, { datesEnabled: false, datesStart: "", datesEnd: "", datesWeekdays: [], groupWeekdays: {} });
    D.restore();
    ok("التواريخ المحفوظة تعود: التفعيل والمدى وأيام الأسبوع", st.datesEnabled === true && st.datesStart === "2026-12-01" && st.datesEnd === "2026-12-15" && JSON.stringify(st.datesWeekdays) === "[0,2]", JSON.stringify([st.datesEnabled, st.datesStart, st.datesEnd, st.datesWeekdays]));
    ok("أيام كل مجموعة تعود", JSON.stringify(st.groupWeekdays) === JSON.stringify({ "S3G1": [0, 2, 4] }), JSON.stringify(st.groupWeekdays));
    // تعديل مجموعة أخرى لا يمحو المحفوظة، والتعديل يُحفظ
    st.groupWeekdays = { "S3G2": [1, 3] }; st.datesEnd = "2026-12-20"; D.save();
    st.groupWeekdays = {}; D.restore();
    ok("التعديل يُحفظ ولا يمحو مجموعات سبق ضبطها", st.datesEnd === "2026-12-20" && JSON.stringify(st.groupWeekdays["S3G1"]) === "[0,2,4]" && JSON.stringify(st.groupWeekdays["S3G2"]) === "[1,3]", JSON.stringify(st.groupWeekdays));
    // إلغاء كل أيام مجموعة يُحفظ فعلاً
    st.groupWeekdays = { "S3G1": [] }; D.save(); st.groupWeekdays = {}; D.restore();
    ok("إلغاء أيام مجموعة يتغلّب على المحفوظ", JSON.stringify(st.groupWeekdays["S3G1"]) === "[]", JSON.stringify(st.groupWeekdays));
    Object.assign(st, { datesEnabled: false, datesStart: "", datesEnd: "", datesWeekdays: [], groupWeekdays: {} });
    if (old === null) localStorage.removeItem(key); else localStorage.setItem(key, old);
  }

  // كشف تعهد استلام الحقيبة: الطلاب من النظام ← أوراق مرقّمة (5-1) (5-2) ← Word وطباعة
  {
    const oldRun = agent.run; let plSentStatus = "";
    const names = ["ياسمين خالد", "أحمد علي", "الجوهرة محمد", "إسراء حسن", "بشرى سعد", "سمر فريد", "ليلى حسن", "نورة خالد", "هدى سالم", "منى يوسف", "رنا عادل", "دانة ماجد", "ريم فهد", "جود سامر", "لجين ناصر", "تالا بسام", "غدير نايف", "سارة مازن", "عبير وليد", "فرح زياد"];
    agent.run = async (cmds) => { plSentStatus = (cmds[0].params || {}).status; return { results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية"], rows: names.map((n, k) => ({ cells: [n, String(300 + k), "G1", "10" + String(10000000 + k)] })) })) }; };
    c.state.mode = "pledge"; c.state.groups = []; c.state.pledge = Object.assign(c.state.pledge, { tracks: ["1"], stages: [], status: "graduated", students: null, opts: null }); c.state.wideLimit = 100000; c.state.wide = null; c.render();
    ok("تبويب كشف التعهد: الحقول والأزرار", !!b.querySelector('[data-pl="preamble"]') && !!b.querySelector('[data-cc="run-pledge"]') && b.querySelector('[data-cc="pledge-print"]').disabled, "view");
    b.querySelector('[data-cc="run-pledge"]').click();
    for (let i = 0; i < 40 && !c.state.pledge.students && !c.state.resultError; i++) await wait(100); await wait(200);
    ok("الطلبة المتخرجون فقط: يُرسَل status=graduated", plSentStatus === "graduated" && !!b.querySelector('[data-pledge="status"]') && b.querySelector('[data-pledge="status"]').value === "graduated", plSentStatus);
    ok("جُلب 20 طالباً من النظام", !!c.state.pledge.students && c.state.pledge.students.length === 20, JSON.stringify({ n: c.state.pledge.students && c.state.pledge.students.length, err: c.state.resultError }));
    // الافتراضي: ترقيم حسب عدد الأوراق. 20 طالباً بـ15 صفاً في الورقة ← ورقتان (2-1) و(2-2)
    c.state.pledge.opts = Object.assign({}, App.pledgeSheet.DEFAULTS, { perPage: 15, autoFit: false }); c.render();
    ok("المعاينة النصية: 20 طالباً ← ورقتان", /20 طالباً/.test(b.querySelector("#cc-pledge").textContent) && /2 ورقة/.test(b.querySelector("#cc-pledge").textContent), b.querySelector("#cc-pledge .cc-alert") && b.querySelector("#cc-pledge .cc-alert").textContent);
    const built = App.pledgeSheet.build(c.state.pledge.students, c.state.pledge.opts);
    const mt = built.blocks.filter((x) => x.kind === "pagenum").map((x) => x.text).join();
    ok("ترقيم الورقتين (2-1) و(2-2) حسب عدد الأوراق", mt === "(2-1),(2-2)", mt);
    const tb = built.blocks.filter((x) => x.kind === "table");
    ok("الترتيب الأبجدي والمرحلة من الدورة/المجموعة", tb[0].rows[0][1] === "أحمد علي" && tb[0].rows.length === 15 && tb[1].rows.length === 5, tb[0].rows[0]);
    // الطباعة على الترويسة: لا تفيض الورقة (ورقتان مطبوعتان بالضبط)
    const host = document.createElement("div"); host.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(host);
    const pc = App.docRender.paginate(host, built.blocks); host.remove();
    // معايرة: أكبر عدد صفوف يتّسع في الورقة الواحدة مع الديباجة المكررة (يُعرض للمراجعة)
    const fit = {};
    for (const k of [8, 9, 10, 11, 12, 13, 14, 15]) {
      const h = document.createElement("div"); h.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(h);
      fit[k] = App.docRender.paginate(h, App.pledgeSheet.build(c.state.pledge.students.slice(0, k), { perPage: k, split: "none" }).blocks); h.remove();
    }
    ok("معايرة الصفوف في الورقة المطبوعة (صفحات لكل عدد)", true, JSON.stringify(fit));
    {   // عمود «الكرسي» لا يكسر «المرحلة الثالثة» ولا الاسم الطويل إلى سطرين، فلا يقلّ عدد الصفوف في الورقة
      const one = [{ name: "عبد الرحمن محمد عبد الله أبو العلا", id: "400123401", stage: "المرحلة الثالثة", group: "G", track: "م" }];
      const hc = document.createElement("div"); hc.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hc);
      App.docRender.paginate(hc, App.pledgeSheet.build(one, { perPage: 3, split: "none", chairCol: true }).blocks);
      const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; };
      const cellsL = [...hc.querySelectorAll("tr")[1].children].map(lines), headL = [...hc.querySelectorAll("tr")[0].children].map(lines); hc.remove();
      ok("مع عمود «الكرسي»: كل خلية (والعناوين) في سطر واحد", cellsL.every((n) => n <= 1) && headL.every((n) => n <= 1), JSON.stringify({ cellsL, headL }));
    }
    const dk = App.pledgeSheet.DEFAULTS.perPage, h2 = document.createElement("div"); h2.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(h2);
    const pcd = App.docRender.paginate(h2, App.pledgeSheet.build(c.state.pledge.students.concat(c.state.pledge.students), { perPage: dk, split: "group" }).blocks); h2.remove();
    ok("الصفوف الافتراضية في الورقة تتّسع بلا فيض (كل ورقة تطبع صفحة واحدة)", pcd === App.pledgeSheet.build(c.state.pledge.students.concat(c.state.pledge.students), { perPage: dk, split: "group" }).pages, { pcd, dk });
    // عدد الصفوف يلائم الصفحة تلقائياً: كل ورقة تُطبع صفحة واحدة بلا فيض، ويتغيّر مع طول الديباجة
    c.state.pledge.opts = Object.assign({}, App.pledgeSheet.DEFAULTS, { autoFit: true }); c.render();
    const fit1 = c.state.pledge.fit;
    const hostA = document.createElement("div"); hostA.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hostA);
    const bl = App.pledgeSheet.build(c.state.pledge.students.concat(c.state.pledge.students, c.state.pledge.students), Object.assign({}, c.state.pledge.opts, { perPage: fit1, split: "none" }));
    const pcA = App.docRender.paginate(hostA, bl.blocks); hostA.remove();
    ok("الملاءمة التلقائية: صفوف الورقة تتّسع بلا فيض (كل ورقة صفحة)", fit1 >= 8 && pcA === bl.pages, { fit1, pcA, pages: bl.pages });
    ok("الخانة تعرض العدد المحسوب وتُعطَّل", b.querySelector('[data-pl="perPage"]').disabled && Number(b.querySelector('[data-pl="perPage"]').value) === fit1, b.querySelector('[data-pl="perPage"]').value);
    c.state.pledge.opts.preamble = App.pledgeSheet.DEFAULTS.preamble + " " + App.pledgeSheet.DEFAULTS.preamble + " " + App.pledgeSheet.DEFAULTS.preamble; c.render();
    ok("ديباجة أطول ← صفوف أقل في الورقة", c.state.pledge.fit < fit1, { before: fit1, after: c.state.pledge.fit });
    c.state.pledge.opts = Object.assign({}, App.pledgeSheet.DEFAULTS, { perPage: 15, autoFit: false }); c.render();
    // رقم الورقة: أسفل الصفحة في الوسط (طباعة) وإطار مثبّت في Word
    const hostN = document.createElement("div"); hostN.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hostN);
    App.docRender.paginate(hostN, built.blocks);
    const pnEl = hostN.querySelector(".lh-pagenum"), pgEl = hostN.querySelector(".lh-page");
    const rN = pnEl && pnEl.getBoundingClientRect(), rP = pgEl && pgEl.getBoundingClientRect();
    ok("رقم الورقة (2-1) يظهر أسفل الصفحة في الوسط", !!pnEl && /\(2-1\)/.test(pnEl.textContent) && Math.abs((rN.left + rN.width / 2) - (rP.left + rP.width / 2)) < 3 && rN.top > rP.top + rP.height * 0.82, pnEl && { n: pnEl.textContent, top: rN.top - rP.top, h: rP.height });
    const pnTop = hostN.querySelector(".lh-body") && hostN.querySelector(".lh-body").getBoundingClientRect();
    ok("الرقم لا يتداخل مع نص الصفحة (تحت حافة النص السفلية)", !!pnTop && rN.top >= pnTop.bottom - 1, pnTop && { numTop: rN.top, bodyBottom: pnTop.bottom });
    hostN.remove();
    // النسختان: الصفوف والأسماء والترقيم نفسها في كل صفحة
    c.state.pledge.students = [...c.state.pledge.students, ...Array.from({ length: 30 }, (_, k) => ({ name: "إضافي " + String(k + 1).padStart(2, "0"), id: "2000" + k, group: "G1", course: "مسار الحلاقة", track: "مسار الحلاقة", stage: "المرحلة الثانية" }))];
    c.state.pledge.opts = Object.assign({}, App.pledgeSheet.DEFAULTS, { autoFit: true }); c.render();
    const sg = App.centerCmd.pledgeBlocks(), an = App.centerCmd.pledgeBlocks("announcer");
    const rowsOf = (r) => r.blocks.filter((x) => x.kind === "table").map((tb) => tb.rows.map((rw) => rw[0] + ":" + rw[1] + ":" + (rw.length >= 5 ? rw[3] : rw[2])));
    ok("النسختان: عدد الصفحات نفسه (توقيع = مذيع)", sg.pages === an.pages && sg.pages >= 3, { sign: sg.pages, ann: an.pages });
    ok("النسختان: الأسماء والمراحل ورقم م نفسها في كل صفحة", JSON.stringify(rowsOf(sg)) === JSON.stringify(rowsOf(an)), { s: rowsOf(sg).map((x) => x.length), a: rowsOf(an).map((x) => x.length) });
    ok("النسختان: ترقيم الصفحات نفسه", sg.blocks.filter((x) => x.kind === "pagenum").map((x) => x.text).join() === an.blocks.filter((x) => x.kind === "pagenum").map((x) => x.text).join(), "pagenum");
    const hostM = document.createElement("div"); hostM.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hostM);
    const pcM = App.docRender.paginate(hostM, an.blocks); hostM.remove();
    ok("نسخة المذيع تُطبع صفحة واحدة لكل ورقة بلا فيض", pcM === an.pages, { pcM, pages: an.pages });
    // نسخة المذيع: لا فيض في الطباعة، وWord بجدول (م، الاسم، المرحلة) بلا توقيع
    c.state.pledge.opts = Object.assign({}, App.pledgeSheet.DEFAULTS, { autoFit: true }); c.render();
    const annB = App.pledgeSheet.build(c.state.pledge.students.concat(c.state.pledge.students), Object.assign({}, c.state.pledge.opts, { perPage: 9, split: "none" }), "announcer");
    const hostB = document.createElement("div"); hostB.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hostB);
    const pcB = App.docRender.paginate(hostB, annB.blocks); hostB.remove();
    ok("نسخة المذيع: 9 صفوف بخط 14 تتّسع في كل ورقة بلا فيض", pcB === annB.pages, { pcB, pages: annB.pages });
    ok("أزرار نسخة المذيع ظاهرة وفعّالة", !!b.querySelector('[data-cc="pledge-ann-print"]') && !b.querySelector('[data-cc="pledge-ann-word"]').disabled, "btns");
    await App.docx.load();
    const annBytes = new Uint8Array(await App.docx.build(annB.blocks).arrayBuffer()); const annTxt = new TextDecoder("utf-8", { fatal: false }).decode(annBytes);
    ok("Word المذيع: رؤوس م/الاسم/المرحلة وبلا «التوقيع» وخط 28 نصف نقطة", />المرحلة</.test(annTxt) && !/>التوقيع</.test(annTxt) && /w:sz w:val="28"/.test(annTxt), { len: annBytes.length });
    // Word على الترويسة: الملف يحوي الرقمين والأسماء
    await App.docx.load();
    const blob = App.docx.build(built.blocks); const bytes = new Uint8Array(await blob.arrayBuffer());
    const txt = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    ok("ملف Word: فيه (2-1) و(2-2) وفاصل الصفحة واسم طالب", /\(2-1\)/.test(txt) && /\(2-2\)/.test(txt) && /w:br w:type="page"/.test(txt) && /أحمد علي/.test(txt), { len: bytes.length });
    ok("ملف Word: رقم الورقة إطار مثبّت أسفل الصفحة في الوسط", /w:framePr[^>]*w:xAlign="center"[^>]*w:y="14000"/.test(txt) && /\(2-1\)/.test(txt), "framePr");
    ok("ملف Word: ارتفاع صف التوقيع مضبوط", /w:trHeight/.test(txt), "trHeight");
    // حفظ الخيارات
    const ta = b.querySelector('[data-pl="preamble"]'); ta.value = "ديباجة اختبار"; ta.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    ok("الديباجة المعدّلة تُحفظ للمرة القادمة", /ديباجة اختبار/.test(localStorage.getItem("tamkeen:pledge-opts") || ""), localStorage.getItem("tamkeen:pledge-opts"));
    localStorage.removeItem("tamkeen:pledge-opts");
    {   // كشف للذكور وكشف للإناث في كل مسار: الجنس من ملف «تصدير Excel» (إضافة 1.5.8)
      const keepV = agent.version, keepRun2 = agent.run, seenP = [];
      const wbP = new ExcelJS.Workbook(), wsP = wbP.addWorksheet("الطلاب");
      wsP.addRow(["بيانات الطلاب الكاملة مع بيانات طلب التقديم"]); wsP.addRow(["رقم الطالب", "اسم الطالب", "رقم الهوية", "الجنس", "الحالة الاجتماعية للمتقدم"]);
      wsP.addRow(["S1", "أحمد", "500000001", "ذكر", "أعزب"]); wsP.addRow(["S2", "سارة", "500000002", "أنثى", "أعزب"]); wsP.addRow(["S3", "خالد", "500000003", "ذكر", "-"]);
      const u8P = new Uint8Array(await wbP.xlsx.writeBuffer()); let binP = ""; u8P.forEach((x) => { binP += String.fromCharCode(x); });
      agent.version = () => "1.5.8";
      agent.run = async (cmds) => ({ results: cmds.map((cm) => { seenP.push(cm.type); return cm.type === "export" ? { type: "export", label: cm.label, name: "x.xlsx", bytes: u8P.length, b64: btoa(binP) }
        : { type: "list", label: "مسار الحلاقة - المرحلة الأولى", params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية"], rows: [{ cells: ["أحمد", "S1", "S1G1", "500000001"] }, { cells: ["سارة", "S2", "S1G1", "500000002"] }, { cells: ["خالد", "S3", "S1G1", "500000003"] }, { cells: ["مجهول", "S4", "S1G1", "500000004"] }] }; }) });
      c.state.enrich = null; c.state.mode = "pledge"; c.state.pledge.students = null; c.state.pledge.opts = null; c.render();
      const gs = b.querySelector('[data-pl="genderSplit"]');
      ok("خيار «كشف للذكور وكشف للإناث في كل مسار» موجود", !!gs, "opt");
      gs.checked = true; gs.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
      b.querySelector('[data-cc="run-pledge"]').click(); for (let i = 0; i < 80 && (!c.state.pledge.students || c.state.busy); i++) await wait(100); await wait(300);
      const stP = c.state.pledge.students || [];
      ok("الجلب: قائمة الطلاب ثم طلب تصدير واحد للجنس، والجنس عُرف بالهوية", seenP.includes("export") && stP.find((s) => s.name === "سارة").gender === "أنثى" && stP.find((s) => s.name === "أحمد").gender === "ذكر", JSON.stringify({ seenP, g: stP.map((s) => s.name + ":" + (s.gender || "")) }));
      const alP = (b.querySelector("#cc-pledge .cc-alert.ok") || {}).textContent || "";
      ok("العدّاد: ذكور 2 · إناث 1 · غير محدد 1", /ذكور 2/.test(alP) && /إناث 1/.test(alP) && /غير محدد 1/.test(alP), alP);
      ok("تنبيه «لا أعرف جنس 1 طالباً» مع زر الجلب", /لا أعرف جنس/.test(b.textContent) && !!b.querySelector('[data-cc="pledge-gender"]'), "warn");
      const pt = c.state.pledge.opts; const built = App.pledgeSheet.build(stP, Object.assign({}, pt, { perPage: 12 }));
      const subs = built.blocks.filter((x) => x.kind === "title" && x.sizePt === 12).map((x) => x.text);
      ok("المستند: ورقة «كشف الذكور» ثم «كشف الإناث» ثم «جنس غير محدد» للمسار", subs.join() === "كشف الذكور,كشف الإناث,جنس غير محدد" && built.pages === 3, JSON.stringify({ subs, pages: built.pages }));
      // أرقام الكراسي: الزر يرسل الأرقام بترتيب الكشوف
      ok("قسم «أرقام الكراسي» وزر الطباعة مع العدد (4 أرقام على ورقة A4 واحدة)", !!b.querySelector('[data-cc="pledge-chairs"]:not([disabled])') && /4 رقماً \(من 1 إلى 4\) على 1 ورقة A4/.test((b.querySelector(".cc-chairs") || {}).textContent || ""), (b.querySelector(".cc-chairs") || {}).textContent);
      {   // عرض الأعمدة حسب النص (بقياس الخط الفعلي)، والتوقيع يأخذ الباقي، والكرسي غامق 16، ولا خلية تنكسر
        const keepSt = c.state.pledge.students;
        c.state.pledge.students = ["اخلاص حسين احمد نعنع", "اريج محمود عبد النبي فياض", "اسلام اسماعيل عودة بدوان", "اسماء محمد ابراهيم الرباطي"].map((n, i) => ({ name: n, id: "80354002" + i, stage: i % 2 ? "المرحلة الثانية" : "المرحلة الأولى", group: "G1", track: "مسار التجميل", gender: "أنثى" }));
        const blk = App.centerCmd.pledgeBlocks(), tbk = blk.blocks.find((x) => x.kind === "table");
        const hw = document.createElement("div"); hw.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hw);
        App.docRender.paginate(hw, blk.blocks);
        const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; };
        const wrapped = [...hw.querySelectorAll("tbody td, thead th")].filter((x) => lines(x) > 1).map((x) => x.textContent);
        const chairTd = hw.querySelector("tbody tr td:nth-child(5)"), cst = chairTd ? { fontWeight: getComputedStyle(chairTd).fontWeight, fontSize: getComputedStyle(chairTd).fontSize } : null;
        const tEl = hw.querySelector("table.lb-table"), bEl = hw.querySelector(".lh-body"), pEl = hw.querySelector(".lh-page");
        const tR = tEl.getBoundingClientRect(), bR = bEl.getBoundingClientRect(), pR = pEl.getBoundingClientRect(), k = 612 / pR.width;
        ok("الطباعة: الجدول يبدأ عند الهامش الأيمن ويمتد ~36 نقطة في الهامش الأيسر دون قصّ، ويبقى داخل الورقة", Math.abs(tR.right - bR.right) < 2 && Math.abs((bR.left - tR.left) * k - 36) < 2 && tR.left > pR.left + 20 && getComputedStyle(bEl).overflowX === "visible", JSON.stringify({ extendPt: Math.round((bR.left - tR.left) * k), leftMarginPt: Math.round((tR.left - pR.left) * k), ox: getComputedStyle(bEl).overflowX }));
        hw.remove();
        const wsg = tbk.widths;
        ok("الكشف: عرض الأعمدة حسب النص والتوقيع الأعرض (يأخذ الباقي)، ولا خلية تنكسر إلى سطرين", wrapped.length === 0 && Math.abs(wsg.reduce((a, x) => a + x, 0) - 1) < 1e-9 && wsg[5] === Math.max(...wsg) && wsg[5] >= 0.15, JSON.stringify({ wrapped, w: wsg.map((x) => Math.round(x * 100)) }));
        ok("رقم الكرسي في الطباعة غامق بحجم 16 (16 نقطة بمقياس صفحة 8.5 إنش = 21.3 بكسل)", !!cst && Number(cst.fontWeight) >= 700 && Math.abs(parseFloat(cst.fontSize) - 16 * 816 / 612) < 0.6, cst && cst.fontWeight + " " + cst.fontSize);
        await App.docx.load(); const zz = await JSZip.loadAsync(await App.docx.build(blk.blocks).arrayBuffer()), dd = await zz.file("word/document.xml").async("string");
        const grid = [...dd.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].slice(0, 6).map((m) => +m[1]);
        ok("Word: الأعمدة تملأ عرض الجدول الممتد (504 نقطة = 10080)، والكرسي غامق 16", Math.abs(grid.reduce((a, x) => a + x, 0) - 10080) <= 6 && /<w:tblW w:w="10080" w:type="dxa"\/>/.test(dd) && grid[5] === Math.max(...grid) && /<w:b\/><w:bCs\/><w:sz w:val="32"\/><w:szCs w:val="32"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve">1</.test(dd), JSON.stringify(grid));
        c.state.pledge.students = keepSt;
      }
      ok("خيار «عمود رقم الكرسي قبل التوقيع» مفعّل افتراضياً والكشف بستة أعمدة", !!b.querySelector('[data-pl="chairCol"]:checked') && App.pledgeSheet.build(stP, c.state.pledge.opts).blocks.find((x) => x.kind === "table").headers.join() === "م,الاسم,رقم الهوية,المرحلة,الكرسي,التوقيع", "col");
      const keepPr = App.chairNumbers.print; let gotCh = null; App.chairNumbers.print = (items, o) => { gotCh = { items, o }; return true; };
      b.querySelector('[data-cc="pledge-chairs"]').click(); await wait(100); App.chairNumbers.print = keepPr;
      ok("الأرقام 1..4 بترتيب الكشوف (الذكور ثم الإناث ثم غير المحدد)", !!gotCh && gotCh.items.map((x) => x.n + ":" + x.name).join() === "1:أحمد,2:خالد,3:سارة,4:مجهول", gotCh && gotCh.items.map((x) => x.n + ":" + x.name).join());
      {   // تنزيل Word وExcel لأرقام الكراسي
        const keepDl = App.ui.download, got = {}; App.ui.download = (name, blob) => { got[/\.docx$/.test(name) ? "w" : "x"] = { name, blob }; };
        b.querySelector('[data-cc="pledge-chairs-word"]').click(); for (let i = 0; i < 60 && !got.w; i++) await wait(100);
        b.querySelector('[data-cc="pledge-chairs-xlsx"]').click(); for (let i = 0; i < 60 && !got.x; i++) await wait(100);
        App.ui.download = keepDl;
        const zw = got.w ? await JSZip.loadAsync(await got.w.blob.arrayBuffer()) : null, dx = zw ? await zw.file("word/document.xml").async("string") : "";
        const perr = dx ? new DOMParser().parseFromString(dx, "application/xml").getElementsByTagName("parsererror").length : 1;
        ok("«تنزيل Word»: ملف docx سليم البنية فيه الأرقام 1..4 والشعاران", !!got.w && perr === 0 && [...dx.matchAll(/<w:t>(\d+)<\/w:t>/g)].map((m) => m[1]).join() === "1,2,3,4" && !!zw.file("word/media/logo-right.png"), JSON.stringify({ name: got.w && got.w.name, perr }));
        const wbx = new ExcelJS.Workbook(); if (got.x) await wbx.xlsx.load(await got.x.blob.arrayBuffer());
        const wsx = wbx.worksheets[0], hx2 = wsx ? wsx.getRow(1).values.slice(1).map(String) : [], r2 = wsx ? wsx.getRow(2).values.slice(1).map(String) : [];
        ok("«تنزيل Excel»: قائمة الكراسي بأعمدتها وبترتيب الكشوف", hx2.join() === "رقم الكرسي,الاسم,رقم الهوية,المسار,الجنس,المجموعة,المرحلة" && wsx.rowCount === 5 && r2[0] === "1" && r2[1] === "أحمد" && r2[2] === "500000001" && r2[4] === "ذكور", JSON.stringify({ hx2, r2, rows: wsx && wsx.rowCount }));
      }
      const cs = b.querySelector('[data-pl="chairStart"]'); cs.value = "101"; cs.dispatchEvent(new Event("change", { bubbles: true })); await wait(150);
      ok("«ابدأ الترقيم من 101» يحدّث المدى (101 إلى 104)", /من 101 إلى 104/.test((b.querySelector(".cc-chairs") || {}).textContent || ""), (b.querySelector(".cc-chairs") || {}).textContent);
      // قياس فعلي: الرقم والاسم يتّسعان داخل الربع على A4 (3 و4 خانات)
      for (const start of [998, 9998]) {
        const fr = document.createElement("iframe"); fr.style.cssText = "position:absolute;left:-3000px;top:0;width:210mm;height:297mm;border:0"; document.body.appendChild(fr);
        const its = [0, 1, 2, 3].map((i) => ({ n: start + i, name: "عبد الرحمن محمد عبد الله أبو العلا", track: "الحلاقة الرجالية", sex: "ذكور" }));
        fr.contentDocument.open(); fr.contentDocument.write(App.chairNumbers.html(its, { names: true, tags: true })); fr.contentDocument.close();
        for (let i = 0; i < 40 && [...fr.contentDocument.images].some((im) => !im.complete); i++) await wait(100); await wait(150);
        const q0 = fr.contentDocument.querySelector(".q"), qr = q0.getBoundingClientRect(), lr = q0.querySelector(".lg.r").getBoundingClientRect(), ll = q0.querySelector(".lg.l").getBoundingClientRect(), nr = q0.querySelector(".n").getBoundingClientRect();
        ok("الشعاران محمّلان: المركز السعودي في الزاوية العليا اليمنى وتمكين في اليسرى، والرقم تحتهما بلا تداخل (" + String(start).length + " خانات)", [...fr.contentDocument.images].every((im) => im.naturalWidth > 0) && lr.right > qr.right - 30 && ll.left < qr.left + 30 && lr.top - qr.top < 40 && ll.top - qr.top < 40 && nr.top >= Math.max(lr.bottom, ll.bottom) - 1, JSON.stringify({ loaded: [...fr.contentDocument.images].map((im) => im.naturalWidth), lr: [Math.round(lr.left - qr.left), Math.round(lr.top - qr.top)], ll: [Math.round(ll.left - qr.left), Math.round(ll.top - qr.top)], nTop: Math.round(nr.top - qr.top), logoBottom: Math.round(Math.max(lr.bottom, ll.bottom) - qr.top) }));
        const qs = [...fr.contentDocument.querySelectorAll(".q")], fits = qs.every((q) => { const r = q.getBoundingClientRect(); return [...q.children].every((ch) => { const c2 = ch.getBoundingClientRect(); return c2.left >= r.left - 1 && c2.right <= r.right + 1 && c2.top >= r.top - 1 && c2.bottom <= r.bottom + 1; }); });
        const pg = fr.contentDocument.querySelector(".pg").getBoundingClientRect();
        ok("A4 بأربعة أرباع والرقم (" + String(start).length + " خانات) والاسم داخل كل ربع", qs.length === 4 && fits && Math.abs(pg.height / pg.width - 297 / 210) < 0.02, JSON.stringify({ n: qs.length, fits, ratio: (pg.height / pg.width).toFixed(3) }));
        fr.remove();
      }
      {   // الملاءمة على الجهاز: حتى لو فُرض حجم ضخم، تُصغَّر الأرقام كلها بالنسبة نفسها حتى تتّسع
        const its = [0, 1, 2, 3].map((i) => ({ n: 1996 + i, name: "عبد الرحمن محمد عبد الله أبو العلا", track: "الحلاقة", sex: "ذكور" }));
        const huge = App.chairNumbers.html(its, { names: true, tags: true }).replace(/\.n \{ font-size: \d+pt;/, ".n { font-size: 400pt;");
        const fr = document.createElement("iframe"); fr.style.cssText = "position:absolute;left:-3000px;top:0;width:210mm;height:297mm;border:0"; document.body.appendChild(fr);
        fr.contentDocument.open(); fr.contentDocument.write(huge); fr.contentDocument.close();
        for (let i = 0; i < 40 && [...fr.contentDocument.images].some((im) => !im.complete); i++) await wait(100); await wait(300);
        const ns = [...fr.contentDocument.querySelectorAll(".n")], sizes = [...new Set(ns.map((n) => getComputedStyle(n).fontSize))];
        const fitsAll = ns.every((n) => { const q = n.parentElement, r = q.getBoundingClientRect(), nr = n.getBoundingClientRect(); return n.scrollWidth <= q.clientWidth && nr.left >= r.left - 1 && nr.right <= r.right + 1 && q.scrollHeight <= q.clientHeight + 1; });
        fr.remove();
        ok("حجم مفروض 400pt: صُغّرت الأرقام الأربعة بالحجم نفسه وتتّسع كلها", sizes.length === 1 && parseFloat(sizes[0]) < 400 * 1.333 && fitsAll, JSON.stringify({ sizes, fitsAll }));
      }
      agent.version = keepV; agent.run = keepRun2; c.state.enrich = null; localStorage.removeItem("tamkeen:pledge-opts");
    }
    agent.run = oldRun; c.state.mode = "report"; c.state.pledge.students = null; c.state.pledge.opts = null; c.state.wideLimit = 0; c.render();
  }

  // مطابقة التوقيعات: ما لم يُطابَق يُبحث عنه في النظام بالجوال أو الهوية (الاسم المقروء قد يكون خاطئاً)
  {
    const oldRun = agent.run; const lookups = [];
    agent.run = async (cmds) => ({ results: cmds.map((cm) => {
      if (cm.type === "lookup") return { type: "lookup", label: cm.label, items: (cm.items || []).map((it) => { lookups.push(it.q);
        const d = String(it.q).replace(/\D/g, "");
        const row = d === "0597636723" ? ["نداء أبو الكاس", "7001", "المرحلة الثانية", "الاولى", "مسار الحلاقة", "0597636723", "1000000001"] : d === "0500000001" ? ["ريم سالم", "7002", "المرحلة الثالثة", "S3G1", "مسار الحلاقة", "0500000001", "9000000001"] : null;
        return row ? { q: it.q, count: 1, heads: ["الاسم", "رقم الطالب", "المرحلة", "المجموعة", "المسار", "الجوال", "رقم الهوية"], rows: [{ cells: row }] } : { q: it.q, count: 0, heads: [], rows: [] }; }) };
      return { type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [{ cells: ["ريم سالم", "7002", "S3G1", "9000000001", ""] }, { cells: ["سلمى ياسر", "7003", "S3G1", "9000000003", "0507777777"] }] };
    }) });
    c.state.mode = "sign"; c.state.groups = [];
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "5", files: [], manual: {}, lookups: {}, reg: null,
      rows: [
        { id: "a:0", file: "a", name: "نداء أبو بكر", nid: "", phone: "0597636723", signed: true, conf: 0.9, keep: true },        // الاسم مقروء خطأ، والجوال لمسجّل خارج المرحلة
        { id: "a:1", file: "a", name: "اسم مشوّه جداً", nid: "", phone: "0500000001", signed: true, conf: 0.4, keep: true },      // الجوال لمسجّل في المرحلة لا يحمل جوالاً في القائمة
        { id: "a:2", file: "a", name: "سلمى ياسر", nid: "", phone: "", signed: true, conf: 0.95, keep: true },
      ] });
    c.state.wideLimit = 100000; c.state.wide = null; c.render();
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 60 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(500);
    ok("البحث في النظام بالجوال لما لم يُطابَق", lookups.some((q) => /0597636723/.test(q)) && lookups.some((q) => /0500000001/.test(q)), JSON.stringify({ lookups, err: c.state.resultError }));
    ok("الاسم غير الواضح يُعرَف بجواله: يظهر الاسم الحقيقي والمرحلة", /نداء أبو الكاس/.test(b.textContent) && /المرحلة الثانية/.test(b.textContent), b.querySelector("#cc-sig") ? "" : "no view");
    const sgItems = c.state.sig.reg ? [...b.querySelectorAll(".cc-results")].map((x) => x.textContent).join(" ") : "";
    const fnd = b.querySelector('[data-tblbox="sig-found"]');
    ok("المعرَّف بالجوال من خارج القائمة: جدول «عُرفوا» باسمه في النظام ومرحلته، لا اسم الورقة الخاطئ أولاً", !!fnd && /نداء أبو الكاس/.test(fnd.textContent) && /المرحلة الثانية/.test(fnd.textContent) && fnd.querySelector("tbody tr td").textContent.trim() === "نداء أبو الكاس", fnd && fnd.textContent.slice(0, 160));
    ok("لا يبقى المعرَّف في «أسماء لا تطابق مسجّلاً»", ![...b.querySelectorAll(".cc-sig-r")].some((x) => /نداء أبو بكر/.test(x.textContent)), [...b.querySelectorAll(".cc-sig-r")].map((x) => x.textContent.slice(0, 40)));
    ok("الاسم المشوّه يُربط بمسجّل عبر جواله في النظام (ريم سالم وقّعت)", !/ريم سالم/.test((b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || "") , (b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent);
    ok("لا بحث لمن طُوبق سليماً (سلمى بلا رقم)", !lookups.some((q) => /سلمى/.test(q)), lookups);
    agent.run = oldRun; c.state.mode = "report"; c.state.sig.reg = null; c.state.sig.rows = null; c.state.sig.lookups = {}; c.state.wideLimit = 0; c.render();
  }

  // بيانات ناقصة في النظام: تنبيه في «تقرير جاهز» + أداة «بيانات ناقصة»
  {
    const H = ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المجموعة", "الجنس", "الحالة الاجتماعية", "تاريخ الميلاد", "المحافظة الحالية"];
    const ROWS = [
      { cells: ["أحمد علي", "S1", "400000001", "0591111111", "S3G1", "ذكر", "أعزب", "2000-01-01", "غزة"] },
      { cells: ["خالد سعيد", "S2", "400000002", "0592222222", "S3G1", "ذكر", "", "", "غزة"] },
      { cells: ["سامي عمر", "S3", "400000003", "0593333333", "S3G2", "ذكر", "", "1999-05-05", ""] },
      { cells: ["ريم ناصر", "S4", "400000004", "0594444444", "S3G2", "", "", "", ""] },   // لم تُقرأ بياناته (بلا جنس) فلا يُعدّ ناقصاً
    ];
    const oldRun = agent.run; let gcalls = 0; agent.run = async (cmds) => (gcalls++, { results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: H, rows: ROWS, details: { read: 3, of: 4 } })) });
    c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null; c.state.mode = "report";
    // الخيار 2: تنبيه في نتيجة «تقرير جاهز»
    c.state.results = { at: new Date(), results: [{ type: "list", label: "كل الطلاب", heads: H, rows: ROWS }] }; c.render();
    const gn = b.querySelector(".cc-gapnote");
    ok("«تقرير جاهز»: تنبيه أن الحقول الفارغة في النظام نفسه مع الأعداد (حالة اجتماعية 2 من 3)", !!gn && /«الحالة الاجتماعية» عند 2 من 3/.test(gn.textContent) && /نظام المركز نفسه/.test(gn.textContent) && /لم تُقرأ بيانات 1 طالباً/.test(gn.textContent), gn && gn.textContent.slice(0, 260));
    ok("التنبيه فيه زر يفتح أداة «بيانات ناقصة»", !!b.querySelector('.cc-gapnote [data-cc="go-gaps"]'), "btn");
    b.querySelector('.cc-gapnote [data-cc="go-gaps"]').click(); await wait(200);
    ok("الزر يفتح الأداة", c.state.mode === "gaps" && !!b.querySelector("#cc-gaps"), c.state.mode);
    // الخيار 3: الأداة
    ok("«بيانات ناقصة» ضمن مجموعة «فحص وجودة» بشرحها", !!b.querySelector('.cc-mgroup button[data-m="gaps"]') && /صفحة تعديل كل طالب/.test(b.querySelector('.cc-mgroup button[data-m="gaps"]').dataset.tip), "tab");
    ok("قائمة الحقول ومنها الحالة الاجتماعية محدَّدة افتراضياً", !!b.querySelector('[data-gaps="f:marital_status"]:checked') && !!b.querySelector('[data-gaps="f:birth_date"]:checked') && !b.querySelector('[data-gaps="f:specialization"]:checked'), "fields");
    c.state.gaps.out = null; gcalls = 0; b.querySelector('[data-cc="run-gaps"]').click();
    for (let i = 0; i < 80 && !c.state.gaps.out && !c.state.resultError; i++) await wait(100); await wait(300);
    ok("القراءة تطلب «كل بيانات الطالب» (details)", c.state.gaps.out && c.state.gaps.out.lists.length >= 1 && !c.state.resultError, c.state.resultError);
    const sumT = (b.querySelector('[data-tblbox="gap-sum"]') || {}).textContent || "";
    ok("جدول الحقول: الحالة الاجتماعية فارغة عند 2 وتاريخ الميلاد عند 1 (من 3 مقروءين)", /الحالة الاجتماعية\s*1\s*2\s*67%/.test(sumT.replace(/\s+/g, " ").replace(/(\D)\s+(\d)/g, "$1 $2")) || (/الحالة الاجتماعية/.test(sumT) && /67%/.test(sumT) && /33%/.test(sumT)), sumT.replace(/\s+/g, " ").slice(0, 200));
    const listT = (b.querySelector('[data-tblbox="gap-list"]') || {}).textContent || "";
    ok("من ينقصه: خالد وسامي فقط، لا أحمد (مكتمل) ولا ريم (لم تُقرأ بياناتها)", /خالد سعيد/.test(listT) && /سامي عمر/.test(listT) && !/أحمد علي/.test(listT) && !/ريم ناصر/.test(listT), listT.replace(/\s+/g, " ").slice(0, 220));
    ok("خالد ينقصه حقلان (الحالة الاجتماعية وتاريخ الميلاد)", /خالد سعيد[\s\S]*الحالة الاجتماعية، تاريخ الميلاد/.test(listT), listT.replace(/\s+/g, " ").slice(0, 200));
    ok("تنبيه أن من لم تُقرأ بياناتهم لا يُعدّون ناقصين", /لا يُعدّ ناقصاً/.test(b.textContent), "unread");
    const BL = App.centerCmd._gaps.blank;
    ok("«-» وكل أشكال الشَّرطة و N/A تُعدّ فارغة تحتاج تعبئة، والقيم الحقيقية لا", ["", "-", "--", "–", "—", "ـ", " - ", ".", "N/A", "null"].every(BL) && !["أعزب", "0", "2005-06-21", "دير البلح - شارع"].some(BL), "blank");
    {
      const fM = App.centerCmd._gaps.fields().filter((f) => f.name === "marital_status");
      const stD = App.centerCmd._gaps.stats([{ heads: ["الاسم", "رقم الطالب", "الجنس", "الحالة الاجتماعية"], rows: [{ cells: ["أ", "D1", "ذكر", "-"] }, { cells: ["ب", "D2", "ذكر", "–"] }, { cells: ["ج", "D3", "ذكر", "--"] }, { cells: ["د", "D4", "ذكر", "أعزب"] }], label: "" }], fM);
      ok("الحالة الاجتماعية «-» أو «–» أو «--» تُحسب ناقصة (3 من 4)", stD.per[0].blank === 3 && stD.per[0].filled === 1 && stD.withGaps.length === 3, JSON.stringify(stD.per[0]));
    }
    ok("أزرار Excel ونسخ الملخص", !!b.querySelector('[data-cc="gaps-xlsx"]') && !!b.querySelector('[data-cc="gaps-copy"]'), "btns");
    // تغيير الحقول يُعيد الحساب بلا قراءة جديدة
    const n0 = gcalls; const gi = b.querySelector('[data-gaps="f:birth_date"]'); gi.checked = false; gi.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    const listT2 = (b.querySelector('[data-tblbox="gap-list"]') || {}).textContent || "";
    ok("إلغاء حقل يُحدّث النتيجة فوراً بلا قراءة جديدة (لم يعد «تاريخ الميلاد» ينقص أحداً في القائمة)", !/تاريخ الميلاد/.test(listT2) && /خالد سعيد/.test(listT2) && /سامي عمر/.test(listT2) && gcalls === n0 && n0 >= 1, [n0, gcalls]);
    agent.run = oldRun; c.state.results = null; c.state.gaps.out = null; c.state.gaps.fields = null; c.state.wideLimit = 0; c.state.mode = "report"; c.render();
  }

  // إكمال الفراغ من ملف «تصدير Excel» (الحالة الاجتماعية محفوظة عند المتقدم لا الطالب)
  {
    const mkFile = async () => {
      const wbE = new ExcelJS.Workbook(), wsE = wbE.addWorksheet("الطلاب");
      wsE.addRow(["بيانات الطلاب الكاملة مع بيانات طلب التقديم"]);
      wsE.addRow(["رقم الطالب", "اسم الطالب", "رقم الهوية", "الجوال 1", "الجنس", "الحالة الاجتماعية", "المحافظة", "المجموعة الحالية", "الدورة الحالية", "هوية المتقدم", "الحالة الاجتماعية للمتقدم", "محافظة المتقدم"]);
      wsE.addRow(["STU-1", "أحمد علي", "400000001", "0591111111", "ذكر", "-", "الوسطى", "S3G1", "المرحلة الثالثة", "400000001", "أعزب", "الوسطى"]);
      wsE.addRow(["STU-2", "خالد سعيد", "400000002", "0592222222", "ذكر", "-", "", "S3G1", "المرحلة الثالثة", "400000002", "متزوج", "خانيونس"]);
      wsE.addRow(["STU-3", "سامي عمر", "400000003", "0593333333", "ذكر", "أرمل", "الوسطى", "S3G2", "المرحلة الثالثة", "400000003", "", "الوسطى"]);
      wsE.addRow(["STU-4", "ريم ناصر", "400000004", "0594444444", "أنثى", "-", "الوسطى", "S3G2", "المرحلة الثالثة", "400000004", "-", "الوسطى"]);
      return new File([await wbE.xlsx.writeBuffer()], "students-basic-data.xlsx");
    };
    c.state.mode = "report"; c.state.enrich = null; c.state.enrichErr = ""; c.state.gaps.out = null; c.state.gaps.fields = null;
    const HR = ["الاسم", "رقم الطالب", "رقم الهوية", "الحالة الاجتماعية", "الجنس"];
    c.state.results = { at: new Date(), results: [{ type: "list", label: "كل", heads: HR, rows: [{ cells: ["أحمد علي", "STU-1", "400000001", "", "ذكر"] }, { cells: ["خالد سعيد", "STU-2", "400000002", "-", "ذكر"] }, { cells: ["سامي عمر", "STU-3", "400000003", "أرمل", "ذكر"] }, { cells: ["ريم ناصر", "STU-4", "400000004", "", "أنثى"] }] }] };
    c.render();
    ok("«تقرير جاهز»: بطاقة «إكمال الفراغ من ملف تصدير Excel» وفيها حقل الملف", !!b.querySelector("#cc-enrich-file") && /المتقدم/.test(b.querySelector(".cc-enrich").textContent), "card");
    const inpEn = b.querySelector("#cc-enrich-file"), dtEn = new DataTransfer(); dtEn.items.add(await mkFile()); inpEn.files = dtEn.files; inpEn.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && !c.state.enrich && !c.state.enrichErr; i++) await wait(100); await wait(300);
    ok("الملف يُقرأ (صف العنوان الأول يُتجاوز) ويُستخرج 4 طلاب وحقول المتقدم", !!c.state.enrich && c.state.enrich.n === 4 && c.state.enrich.fields.includes("marital_status") && c.state.enrich.fields.includes("governorate_id"), JSON.stringify({ err: c.state.enrichErr, n: c.state.enrich && c.state.enrich.n, f: c.state.enrich && c.state.enrich.fields }));
    const cellsE = c.state.results.results[0].rows.map((x) => x.cells[3]);
    ok("الخلايا الفارغة تُكمَّل من المتقدم بالهوية، وما فيه قيمة لا يُمسّ", cellsE[0] === "أعزب" && cellsE[1] === "متزوج" && cellsE[2] === "أرمل" && cellsE[3] === "", JSON.stringify(cellsE));
    ok("شريط يذكر عدد الخلايا المكمَّلة (2) من الملف", /أُكملت 2 خلية فارغة من بيانات المتقدم/.test(b.textContent), (b.querySelector(".cc-alert.ok") || {}).textContent);
    // أداة «بيانات ناقصة» من الملف مباشرة
    c.state.mode = "gaps"; c.state.gaps.fields = ["marital_status", "governorate_id"]; c.render();
    ok("في «بيانات ناقصة» زر تحليل الملف مباشرة بلا قراءة", !!b.querySelector('[data-cc="gaps-file"]'), "btn");
    b.querySelector('[data-cc="gaps-file"]').click(); await wait(300);
    const sumE = (b.querySelector('[data-tblbox="gap-sum"]') || {}).textContent.replace(/\s+/g, " ") || "";
    const listE = (b.querySelector('[data-tblbox="gap-list"]') || {}).textContent || "";
    ok("الحالة الاجتماعية: مُدخَل 3 (منها 2 من المتقدم) وفارغ 1 فقط (ريم)", /الحالة الاجتماعية 3 2 1/.test(sumE) || (/الحالة الاجتماعية/.test(sumE) && /25%/.test(sumE)), sumE.slice(0, 200));
    ok("من ينقصه: ريم فقط (الحالة الاجتماعية)؛ خالد محافظته من المتقدم فلا ينقصه شيء", /ريم ناصر/.test(listE) && !/خالد سعيد/.test(listE) && !/أحمد علي/.test(listE) && !/سامي عمر/.test(listE), listE.replace(/\s+/g, " ").slice(0, 200));
    ok("عدّاد «خلية أُكملت من بيانات المتقدم» يظهر", /خلية أُكملت من بيانات المتقدم/.test(b.textContent), "stat");
    // ملف غير مناسب يُشرح
    c.state.enrich = null; c.state.mode = "report"; c.render();
    const wbBad = new ExcelJS.Workbook(); wbBad.addWorksheet("x").addRow(["الاسم", "الجوال"]);
    const inpB = b.querySelector("#cc-enrich-file"), dtB = new DataTransfer(); dtB.items.add(new File([await wbBad.xlsx.writeBuffer()], "x.xlsx")); inpB.files = dtB.files; inpB.dispatchEvent(new Event("change", { bubbles: true })); await wait(500);
    ok("ملف بلا «رقم الهوية» يُشرح خطؤه تحت الخانة", !c.state.enrich && /رقم الهوية/.test((b.querySelector(".cc-enrich .cc-alert") || {}).textContent || ""), c.state.enrichErr);
    c.state.enrich = null; c.state.enrichErr = ""; c.state.results = null; c.state.gaps.out = null; c.state.gaps.fields = null; c.state.mode = "report"; c.render();
  }

  // الجلب التلقائي لملف «تصدير Excel» من النظام (إضافة 1.5.8): بعد التقرير، وفي «بيانات ناقصة» بطلب واحد
  {
    const keepV = agent.version, keepRun = agent.run, seen = [];
    const wbA = new ExcelJS.Workbook(), wsA = wbA.addWorksheet("الطلاب");
    wsA.addRow(["بيانات الطلاب الكاملة مع بيانات طلب التقديم"]);
    wsA.addRow(["رقم الطالب", "اسم الطالب", "رقم الهوية", "الجوال 1", "الجنس", "الحالة الاجتماعية", "الحالة الاجتماعية للمتقدم"]);
    wsA.addRow(["STU-1", "أحمد علي", "400000001", "0591111111", "ذكر", "-", "أعزب"]); wsA.addRow(["STU-2", "خالد سعيد", "400000002", "0592222222", "ذكر", "-", "متزوج"]); wsA.addRow(["STU-3", "ريم ناصر", "400000003", "0593333333", "أنثى", "-", "-"]);
    const u8 = new Uint8Array(await wbA.xlsx.writeBuffer()); let bin = ""; u8.forEach((x) => { bin += String.fromCharCode(x); }); const B64 = btoa(bin);
    const HL = ["الاسم", "رقم الطالب", "رقم الهوية", "الجنس", "الحالة الاجتماعية"];
    const LROWS = [{ cells: ["أحمد علي", "STU-1", "400000001", "ذكر", ""] }, { cells: ["خالد سعيد", "STU-2", "400000002", "ذكر", "-"] }, { cells: ["ريم ناصر", "STU-3", "400000003", "أنثى", ""] }];
    const mockRun = async (cmds) => ({ results: cmds.map((cm) => { seen.push(cm.type + (cm.params && Object.keys(cm.params).length ? ":" + JSON.stringify(cm.params) : "")); return cm.type === "export" ? { type: "export", label: cm.label, name: "students-basic-data.xlsx", bytes: u8.length, b64: B64 } : { type: "list", label: cm.label, params: cm.params, heads: HL, rows: LROWS }; }) });
    c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null; c.state.enrichAuto = true; c.state.enrich = null; c.state.enrichErr = ""; c.state.results = null;
    // إضافة قديمة (1.5.7): لا أمر تصدير ولا خطأ
    agent.version = () => "1.5.7"; agent.run = mockRun; c.state.mode = "report"; c.state.sel.details = true; c.render();
    ok("إضافة 1.5.7: تنبيه أنها قديمة وزر «اجلب الآن» معطّل", /قديمة/.test((b.querySelector(".cc-enrich") || {}).textContent || "") && !!b.querySelector('[data-cc="enrich-now"][disabled]'), (b.querySelector(".cc-enrich") || {}).textContent);
    b.querySelector('[data-cc="run-selection"]').click(); for (let i = 0; i < 60 && (!c.state.results || c.state.busy); i++) await wait(100); await wait(300);
    ok("إضافة 1.5.7: التقرير يعمل بلا أمر تصدير ولا خطأ", seen.length === 1 && seen[0].startsWith("list") && !c.state.resultError && !c.state.enrich, JSON.stringify(seen));
    // إضافة 1.5.8: يلي التقرير جلب تلقائي لملف التصدير بالمرشحات نفسها
    agent.version = () => "1.5.8"; seen.length = 0; c.state.results = null; c.state.enrich = null; c.render();
    ok("إضافة 1.5.8: البطاقة تعلن دعم الجلب التلقائي وخيار «أكمل تلقائياً» مفعّل", /تدعم الجلب التلقائي/.test((b.querySelector(".cc-enrich") || {}).textContent || "") && !!b.querySelector('[data-enr="auto"]:checked'), "card");
    b.querySelector('[data-cc="run-selection"]').click(); for (let i = 0; i < 80 && (!c.state.results || c.state.busy); i++) await wait(100); await wait(400);
    ok("بعد التقرير: أمر list واحد ثم أمر export واحد (طلب واحد لكل أمر)", seen.length === 2 && seen[0].startsWith("list") && seen[1].startsWith("export"), JSON.stringify(seen));
    const cellsA = (c.state.results && c.state.results.results[0].rows.map((x) => x.cells[4])) || [];
    ok("الحالة الاجتماعية تُكمَّل تلقائياً من المتقدم (أعزب / متزوج) وتبقى فارغة لمن لا قيمة له", cellsA[0] === "أعزب" && cellsA[1] === "متزوج" && cellsA[2] === "", JSON.stringify(cellsA));
    ok("شريط «أُكملت 2 خلية» يظهر", /أُكملت 2 خلية فارغة/.test(b.textContent), (b.querySelector(".cc-alert.ok") || {}).textContent);
    seen.length = 0; b.querySelector('[data-cc="run-selection"]').click(); for (let i = 0; i < 80 && c.state.busy; i++) await wait(100); await wait(300);
    ok("إعادة التنفيذ: الذاكرة تكفي فلا أمر تصدير ثانٍ", !seen.some((x) => x.startsWith("export")), JSON.stringify(seen));
    // إيقاف الخيار
    c.state.enrich = null; c.state.enrichAuto = false; c.state.results = null; seen.length = 0; c.render();
    b.querySelector('[data-cc="run-selection"]').click(); for (let i = 0; i < 60 && (!c.state.results || c.state.busy); i++) await wait(100); await wait(300);
    ok("إلغاء «أكمل تلقائياً»: لا أمر تصدير", seen.length === 1 && seen[0].startsWith("list"), JSON.stringify(seen));
    // «اجلب الآن»
    c.state.enrichAuto = true; c.state.enrich = null; seen.length = 0; c.render();
    b.querySelector('[data-cc="enrich-now"]').click(); for (let i = 0; i < 60 && (!c.state.enrich || c.state.busy); i++) await wait(100); await wait(300);
    ok("«اجلب الآن من النظام»: أمر تصدير واحد ويُملأ ما في الذاكرة (3 طلاب)", seen.length === 1 && seen[0].startsWith("export") && c.state.enrich && c.state.enrich.n === 3, JSON.stringify({ seen, n: c.state.enrich && c.state.enrich.n }));
    // أداة «بيانات ناقصة»: طلبات تصدير فقط، بلا قراءة صفحة لكل طالب
    c.state.enrich = null; c.state.mode = "gaps"; c.state.gaps.fields = ["marital_status"]; c.state.gaps.out = null; c.state.gaps.tracks = []; c.state.gaps.stages = []; seen.length = 0; c.render();
    ok("«بيانات ناقصة»: التقدير «طلب تصدير واحد»", /طلب تصدير واحد/.test((b.querySelector("#cc-gaps .cc-sum") || {}).textContent || ""), (b.querySelector("#cc-gaps .cc-sum") || {}).textContent);
    b.querySelector('[data-cc="run-gaps"]').click(); for (let i = 0; i < 80 && !c.state.gaps.out && !c.state.resultError; i++) await wait(100); await wait(300);
    ok("«بيانات ناقصة»: أمر export واحد فقط (لا list ولا details)", seen.length === 1 && seen[0].startsWith("export") && c.state.gaps.out && c.state.gaps.out.src === "system", JSON.stringify({ seen, err: c.state.resultError }));
    const gl = (b.querySelector('[data-tblbox="gap-list"]') || {}).textContent || "";
    ok("الناقص الحقيقي بعد الإكمال: ريم فقط", /ريم ناصر/.test(gl) && !/أحمد علي/.test(gl) && !/خالد سعيد/.test(gl), gl.replace(/\s+/g, " ").slice(0, 160));
    {   // ملف Excel للتعبئة: عمود لكل حقل، والناقص فارغ مظلّل
      const keepDl = App.ui.download; let got = null; App.ui.download = (name, blob) => { got = { name, blob }; };
      c.state.gaps.fields = ["marital_status", "birth_date"]; c.render();
      b.querySelector('[data-cc="gaps-xlsx"]').click(); for (let i = 0; i < 40 && !got; i++) await wait(100);
      App.ui.download = keepDl;
      const wbX = new ExcelJS.Workbook(); if (got) await wbX.xlsx.load(await got.blob.arrayBuffer());
      const wsX = wbX.getWorksheet("من ينقصه (للتعبئة)"), hx = wsX ? wsX.getRow(1).values.slice(1).map(String) : [];
      ok("ورقة «من ينقصه (للتعبئة)»: الاسم والمسار والمجموعة ثم عمود لكل حقل", !!wsX && ["الاسم", "رقم الطالب", "رقم الهوية", "الجوال", "المسار", "الدورة", "المجموعة"].every((h, i) => hx[i] === h) && hx.includes("الحالة الاجتماعية") && hx[hx.length - 1] === "عدد الناقص", JSON.stringify(hx));
      const mi = hx.indexOf("الحالة الاجتماعية") + 1, r2 = wsX && wsX.getRow(2), cM = r2 && r2.getCell(mi);
      ok("صف ريم: خلية الحالة الاجتماعية فارغة ومظلّلة للتعبئة", !!r2 && String(r2.getCell(1).value) === "ريم ناصر" && !cM.value && cM.fill && cM.fill.fgColor && cM.fill.fgColor.argb === "FFFFF2CC", JSON.stringify(r2 && r2.values));
    }
    agent.version = keepV; agent.run = keepRun; c.state.enrich = null; c.state.results = null; c.state.gaps.out = null; c.state.gaps.fields = null; c.state.sel.details = false; c.state.wideLimit = 0; c.state.mode = "report"; c.render();
  }

  // مصدر ثانٍ لمطابقة التوقيعات: ملف Excel بأسماء (بجانب الصور)
  {
    c.state.mode = "sign"; c.state.groups = [];
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "5", files: [], manual: {}, lookups: {}, nameHits: {}, reg: null, rows: null, fileKeys: [], done: [], xl: null });
    c.render();
    ok("خيار «أو ملف Excel بأسماء» يظهر بجانب رفع الصور", !!b.querySelector("#cc-sig-xl") && !!b.querySelector("#cc-sig-files") && /أو ملف Excel بأسماء/.test(b.querySelector(".cc-sigxl").textContent), "view");
    {   // رفع ملف حقيقي عبر حدث الاختيار (لا ضبط الحالة مباشرة)
      const wbT = new ExcelJS.Workbook(), wsT = wbT.addWorksheet("كشف");
      wsT.addRow(["م", "الاسم", "رقم الهوية", "الجوال"]); wsT.addRow([1, "سعيد علي أحمد", "1000000001", "0501112222"]); wsT.addRow([2, "ريم سالم محمد", "1000000002", "0503334444"]); wsT.addRow([3, "خالد عمر", "1000000003", ""]);
      const bufT = await wbT.xlsx.writeBuffer(), fT = new File([bufT], "كشف حقيقي.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const inpT = b.querySelector("#cc-sig-xl"), dtT = new DataTransfer(); dtT.items.add(fT); inpT.files = dtT.files; inpT.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 40 && !c.state.sig.xl && !c.state.resultError; i++) await wait(100); await wait(200);
      ok("رفع الملف عبر الاختيار يعرض لوحة الأعمدة (الاسم والهوية والجوال مخمَّنة)", !!c.state.sig.xl && !!b.querySelector('[data-sigxl="name"]') && c.state.sig.xl.map.name === 1 && c.state.sig.xl.map.id === 2 && c.state.sig.xl.map.phone === 3, JSON.stringify({ err: c.state.resultError, map: c.state.sig.xl && c.state.sig.xl.map }));
      {   // ملف يتعثّر به ExcelJS (مسار workbook غير قياسي ونصوص inline): القارئ المباشر يقرؤه
        const zip = new JSZip();
        zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
        zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/book.xml"/></Relationships>');
        zip.file("xl/book.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="النماذج" sheetId="1" r:id="rId9"/></sheets></workbook>');
        zip.file("xl/_rels/book.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/sheets/s1.xml"/></Relationships>');
        zip.file("xl/sharedStrings.xml", '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>الاسم</t></si><si><t>الهوية</t></si><si><r><t>سعيد </t></r><r><t>علي</t></r></si></sst>');
        zip.file("xl/sheets/s1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1000000001</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>ريم سالم</t></is></c><c r="C3"><v>1000000002</v></c></row></sheetData></worksheet>');
        const blobR = await zip.generateAsync({ type: "arraybuffer" }), fR = new File([blobR], "غير قياسي.xlsx");
        let rr = null, rerr = ""; try { rr = await App.centerXl.readWorkbook(fR); } catch (e) { rerr = e.message; }
        ok("ملف غير قياسي لا تقرؤه ExcelJS يُقرأ بالقارئ المباشر: الأوراق والنصوص المشتركة والأعمدة المتباعدة", !!rr && rr.sheets.length === 1 && rr.sheets[0].name === "النماذج" && rr.sheets[0].heads.join("|") === "الاسم|عمود 2|الهوية" && rr.sheets[0].rows.length === 2 && rr.sheets[0].rows[0][0] === "سعيد علي" && rr.sheets[0].rows[1][2] === "1000000002", JSON.stringify({ rerr, rr }));
      }
      {   // ملفات تُسمّى .xlsx وهي ليست xlsx: جدول HTML (تصدير نظام) / Excel XML 2003 / قديم OLE / نص
        const rd = async (parts, name) => { try { return { r: await App.centerXl.readWorkbook(new File(parts, name)) }; } catch (e) { return { e: e.message }; } };
        const h = await rd(['﻿<html><body><table><tr><th>الاسم</th><th>الهوية</th></tr><tr><td>سعيد علي</td><td>١٠٠٠٠٠٠٠٠١</td></tr><tr><td>ريم سالم</td><td>1000000002</td></tr></table></body></html>'], "تصدير.xlsx");
        ok("جدول HTML بامتداد xlsx يُقرأ (تصدير الأنظمة)", !!h.r && h.r.sheets.length === 1 && h.r.sheets[0].heads.join("|") === "الاسم|الهوية" && h.r.sheets[0].rows.length === 2 && h.r.sheets[0].rows[0][0] === "سعيد علي", JSON.stringify(h));
        const x2 = await rd(['<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="كشف"><Table><Row><Cell><Data ss:Type="String">الاسم</Data></Cell><Cell><Data ss:Type="String">الجوال</Data></Cell></Row><Row><Cell><Data ss:Type="String">خالد عمر</Data></Cell><Cell><Data ss:Type="String">0501234567</Data></Cell></Row></Table></Worksheet></Workbook>'], "قديم.xlsx");
        ok("Excel XML 2003 بامتداد xlsx يُقرأ", !!x2.r && x2.r.sheets[0].name === "كشف" && x2.r.sheets[0].rows[0][1] === "0501234567", JSON.stringify(x2));
        const ole = await rd([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])], "محمي.xlsx");
        ok("ملف OLE (xls قديم أو محمي بكلمة سر) يُشرح سببه", /\.xls/.test(ole.e || "") && /كلمة سر/.test(ole.e || ""), JSON.stringify(ole));
        const tx = await rd(["name,id; أ,1"], "csv.xlsx");
        ok("نص CSV بامتداد xlsx يُشرح أنه ليس xlsx", /ليس ملف xlsx/.test(tx.e || ""), JSON.stringify(tx));
      }
      const inpE = b.querySelector("#cc-sig-xl"), dtE = new DataTransfer(); dtE.items.add(new File(["x"], "قديم.xls")); inpE.files = dtE.files; inpE.dispatchEvent(new Event("change", { bubbles: true })); await wait(300);
      ok("ملف بصيغة .xls يُشرح سبب رفضه تحت خانة الملف نفسها", !c.state.sig.xl && /\.xlsx/.test((b.querySelector(".cc-sigxl .cc-alert") || {}).textContent || ""), (b.querySelector(".cc-sigxl") || {}).textContent);
      const inpB = b.querySelector("#cc-sig-xl"), dtB = new DataTransfer(); dtB.items.add(new File(["ليس xlsx حقيقياً"], "تالف.xlsx")); inpB.files = dtB.files; inpB.dispatchEvent(new Event("change", { bubbles: true })); await wait(500);
      ok("ملف .xlsx تالف يظهر خطأ قراءته تحت الخانة بدل الصمت", !c.state.sig.xl && /تعذّرت قراءة الملف/.test((b.querySelector(".cc-sigxl .cc-alert") || {}).textContent || ""), (b.querySelector(".cc-sigxl") || {}).textContent);
      c.state.sig.xlErr = "";
      c.state.sig.xl = null; c.state.resultError = ""; c.render();
    }
    c.state.sig.xl = { name: "كشف.xlsx", size: 10, sheets: [{ name: "ورقة1", heads: ["الاسم", "الهوية", "التوقيع"], rows: [["سعيد علي", "١٠٠٠٠٠٠٠٠١", "وقّع"], ["ريم سالم", "1000000002", "لا"], ["خالد", "", "✓"], ["", "", ""]] }], sheet: 0, map: { name: 0, id: 1, phone: -1, sign: 2 } };
    c.render();
    ok("بعد الاختيار: أعمدة الاسم والهوية والجوال والتوقيع وزر الإضافة", ["name", "id", "phone", "sign"].every((k) => !!b.querySelector('[data-sigxl="' + k + '"]')) && !!b.querySelector('[data-cc="sig-xl-add"]:not([disabled])') && /3 اسماً/.test(b.querySelector(".cc-sigxl").textContent), b.querySelector(".cc-sigxl").textContent.slice(0, 160));
    b.querySelector('[data-cc="sig-xl-add"]').click(); await wait(300);
    const xr = c.state.sig.rows || [];
    ok("أسماء الملف تُضاف كصفوف مقروءة: الهوية العربية تُوحَّد وعمود التوقيع يُفهم", xr.length === 3 && xr[0].nid === "1000000001" && xr[0].signed === true && xr[1].signed === false && xr[2].signed === true, JSON.stringify(xr.map((x) => [x.name, x.nid, x.signed])));
    ok("لا يُضاف الملف نفسه مرتين", (() => { c.state.sig.xl = { name: "كشف.xlsx", size: 10, sheets: [{ name: "ورقة1", heads: ["الاسم", "الهوية", "التوقيع"], rows: [["سعيد علي", "1", "وقّع"]] }], sheet: 0, map: { name: 0, id: 1, phone: -1, sign: 2 } }; return true; })() && (c.render(), b.querySelector('[data-cc="sig-xl-add"]').click(), await wait(200), (c.state.sig.rows || []).length === 3), (c.state.sig.rows || []).length);
    {   // عمود النموذج + صف بلا اسم له هوية/جوال (كشف تفريغ نماذج)
      c.state.sig.rows = null; c.state.sig.fileKeys = []; c.state.sig.done = [];
      c.state.sig.xl = { name: "نماذج.xlsx", size: 7, sheets: [{ name: "بيانات", heads: ["مرجع", "نوع النموذج", "الاسم", "رقم الهوية", "الجوال"], rows: [["1", "إخلاء مسؤولية", "تسنيم أحمد", "406037630", "0594541899"], ["2", "إخلاء مسؤولية", "", "404137440", "0592130478"], ["3", "موافقة تصوير", "تسنيم أحمد", "406037630", ""], ["4", "موافقة تصوير", "", "", ""]] }], sheet: 0, map: { name: 2, id: 3, phone: 4, sign: -1, form: 1 } };
      c.render();
      ok("لوحة الأعمدة فيها «عمود النموذج» ويُعدّ الصف بلا اسم (له هوية) دون الفارغ كلياً", !!b.querySelector('[data-sigxl="form"]') && /3 اسماً/.test(b.querySelector(".cc-sigxl").textContent), b.querySelector(".cc-sigxl").textContent.slice(0, 200));
      b.querySelector('[data-cc="sig-xl-add"]').click(); await wait(300);
      const fr = c.state.sig.rows || [];
      ok("كل صف يذهب إلى نموذجه، والصف بلا اسم يُضاف باسم بديل وهويته", fr.length === 3 && fr.filter((x) => x.form === "إخلاء مسؤولية").length === 2 && fr.filter((x) => x.form === "موافقة تصوير").length === 1 && /^\(بلا اسم/.test(fr[1].name) && fr[1].nid === "404137440" && fr[1].phone === "0592130478", JSON.stringify(fr.map((x) => [x.name, x.nid, x.form])));
      c.state.sig.rows = null; c.state.sig.fileKeys = []; c.state.sig.done = [];
    }
    c.state.sig.xl = null; c.state.sig.rows = null; c.state.sig.fileKeys = []; c.state.sig.done = []; c.state.mode = "report"; c.render();
  }

  // أسماء بلا هوية ولا جوال لم تطابق: البحث بالاسم في كل النظام (خارج المرحلة) بصيغ متعددة
  {
    const oldRun = agent.run; const qs = [];
    agent.run = async (cmds) => ({ results: cmds.map((cm) => {
      if (cm.type === "lookup") return { type: "lookup", label: cm.label, items: (cm.items || []).map((it) => { qs.push(it.q);
        /* بحث حرفي كالنظام الحقيقي: «احمد» بلا همزة لا تجدها «أحمد»، و«العمري» وحدها تجد «ليث حسن العمري» */
        const H = ["الاسم", "رقم الطالب", "المرحلة", "المجموعة", "المسار"];
        if (it.q === "احمد نادر") return { q: it.q, count: 2, heads: H, rows: [{ cells: ["احمد نادر صابر الطويل", "8001", "المرحلة الثالثة", "S3G2", "مسار الحلاقة"] }, { cells: ["سامر نادر العلي", "8002", "المرحلة الأولى", "S1G1", "مسار الحلاقة"] }] };
        if (it.q === "العمري") return { q: it.q, count: 1, heads: H, rows: [{ cells: ["ليث حسن العمري", "8003", "المرحلة الثالثة", "S3G1", "مسار الحلاقة"] }] };
        return { q: it.q, count: 0, heads: [], rows: [] }; }) };
      return { type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [{ cells: ["ريم سالم", "7002", "S3G1", "9000000001", ""] }] };
    }) });
    c.state.mode = "sign"; c.state.groups = [];
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "5", files: [], manual: {}, lookups: {}, nameHits: {}, reg: null,
      rows: [{ id: "n:0", file: "n", name: "أحمد نادر الطويل", nid: "", phone: "", signed: true, conf: 0.9, keep: true }, { id: "n:1", file: "n", name: "زيد القاسم الغريب", nid: "", phone: "", signed: true, conf: 0.9, keep: true }, { id: "n:2", file: "n", name: "ليث العمري", nid: "", phone: "", signed: true, conf: 0.9, keep: true }] });
    c.state.wideLimit = 100000; c.state.wide = null; c.render();
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 60 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(500);
    const nb = b.querySelector('[data-cc="sig-namesearch"]');
    ok("زر «ابحث بالاسم في كل النظام» يظهر لأسماء بلا رقم", !!nb && /\(3\)/.test(nb.textContent), nb && nb.textContent);
    qs.length = 0; nb.click();
    for (let i = 0; i < 60 && !Object.keys(c.state.sig.nameHits || {}).length && !c.state.resultError; i++) await wait(100); await wait(400);
    ok("يُبحث بصيغ الاسم: كاملاً وأول اسمين وآخر اسمين", qs.includes("أحمد نادر الطويل") && qs.includes("أحمد نادر") && qs.includes("نادر الطويل"), qs);
    const hits = c.state.sig.nameHits || {}, h0 = hits["n:0"], h1 = hits["n:1"];
    ok("المرشح الصحيح يظهر أولاً بتشابه مرتفع، والبعيد لا يُقترح", !!h0 && h0.list.length >= 1 && h0.list[0].s.name === "احمد نادر صابر الطويل" && h0.list[0].score >= 0.8 && !h0.list.some((x) => /سامر/.test(x.s.name)), JSON.stringify(h0 && h0.list.map((x) => [x.s.name, x.score])));
    ok("من لا شبيه له يُكتب أنه بُحث عنه ولم يوجد", !!h1 && h1.list.length === 0 && /فلم أجد شبيهاً/.test(b.textContent), h1);
    const fn2 = b.querySelector('[data-tblbox="sig-found"]');
    ok("المرشح الواحد القوي يُعتمد بالاسم: يظهر في «عُرفوا» باسمه في النظام ومرحلته وطريقة التعرّف", !!fn2 && /احمد نادر صابر الطويل/.test(fn2.textContent) && /المرحلة الثالثة/.test(fn2.textContent) && /بالاسم/.test(fn2.textContent), fn2 && fn2.textContent.slice(0, 200));
    const h2 = hits["n:2"];
    ok("اسم لا يوجد إلا بكلمة منفردة (المرحلة الثانية من البحث) يُقترح ولا يُعتمد تلقائياً (80%)", !!h2 && h2.list.length === 1 && h2.list[0].s.name === "ليث حسن العمري" && !(c.state.sig.lookups || {})["n:2"], JSON.stringify(h2 && h2.list.map((x) => [x.s.name, x.score])));
    const pk = b.querySelector('[data-cc="sig-pick"]');
    ok("زر «هو: …» يظهر للمرشح غير المحسوم", !!pk && /ليث حسن العمري/.test(pk.textContent), pk && pk.textContent);
    if (pk) { pk.click(); await wait(300); }
    ok("اعتماد المرشح بالزر ينقله إلى «عُرفوا»", /ليث حسن العمري/.test((b.querySelector('[data-tblbox="sig-found"]') || {}).textContent || "") && !b.querySelector('[data-cc="sig-pick"]'), (b.querySelector('[data-tblbox="sig-found"]') || {}).textContent);
    ok("ولا يبقى بين «أسماء لا تطابق أحداً»", ![...b.querySelectorAll(".cc-sig-r")].some((x) => /أحمد نادر الطويل/.test(x.textContent)), "orph");
    const tabs = [...b.querySelectorAll('[data-cc="sig-view"]')];
    ok("خلاصة بأربع قوائم بأعدادها (لا يظهر اسمهم/بلا توقيع/وقّعوا/غير معروفة)", tabs.length === 4 && /لا يظهر اسمهم/.test(tabs[0].textContent) && /بلا توقيع/.test(tabs[1].textContent) && /وقّعوا/.test(tabs[2].textContent) && /غير معروفة/.test(tabs[3].textContent), tabs.map((x) => x.textContent));
    const tOrph = tabs.find((x) => x.dataset.v === "orph"); if (tOrph) { tOrph.click(); await wait(200); }
    ok("قائمة «غير معروفة» تعرض الاسم المقروء ونتيجة البحث", !!b.querySelector('[data-tblbox="sv-orph"]') && /زيد القاسم الغريب/.test(b.querySelector('[data-tblbox="sv-orph"]').textContent), "orph");
    const tAbs = [...b.querySelectorAll('[data-cc="sig-view"]')].find((x) => x.dataset.v === "absent"); if (tAbs) { tAbs.click(); await wait(200); }
    ok("التبديل بين القوائم يعرض جدول المسجلين الغائبين", !!b.querySelector('[data-tblbox="sv-absent"]') || /لا أحد في هذه القائمة/.test(b.textContent), "abs");
    ok("سطر التدقيق يحصي الأسماء المقروءة ويذكر غير المعروف", /تدقيق: قُرئ 3 اسماً/.test(b.querySelector(".cc-sigaudit").textContent) && /بقي أسماء غير معروفة|لم تُعرف/.test(b.querySelector(".cc-sigaudit").textContent), b.querySelector(".cc-sigaudit").textContent);
    {   // نتيجة ضخمة (مئات الأسماء ومرشحون بأسماء طويلة) لا توسّع الصفحة أفقياً
      const Sg = c.state.sig; Sg.nameHits = Sg.nameHits || {};
      for (let i = 0; i < 60; i++) { Sg.rows.push({ id: "w|" + i, file: "WhatsApp Image 2026-11-24 at 10.18.54 AM (" + i + ").jpeg", name: "اسم مجهول طويل جداً جداً لا يطابق أحداً أبداً " + i, nid: "", phone: "", signed: true, conf: 0.9, keep: true, form: "" }); Sg.nameHits["w|" + i] = { list: [{ s: { name: "منصور جمال منصور غبن الطويل جداً جداً جداً", stage: "المرحلة الثالثة", group: "S3G2", track: "الحلاقة الرجالية" }, score: 0.7 }], at: 1 }; }
      c.render(); await wait(300);
      const outside = [...b.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 4 || r.left < -4) && !e.closest(".cc-scroll"); });
      ok("نتيجة كبيرة لا يخرج منها عنصر مرئي عن عرض الشاشة (خارج صناديق التمرير)", outside.length === 0, JSON.stringify({ n: outside.length, iw: innerWidth, s: outside.slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 30) + " L" + Math.round(e.getBoundingClientRect().left) + " R" + Math.round(e.getBoundingClientRect().right)) }));
      ok("حاوية النتيجة لا تتجاوز عرض الصفحة", [...b.querySelectorAll(".cc-results")].every((x) => x.getBoundingClientRect().width <= b.getBoundingClientRect().width + 2), "res");
    }
    {   // التصفية المتقدمة: قيمة موجودة في بيانات الطلاب وناقصة من لقطة نموذج النظام (الحالة الاجتماعية)
      const keepCache = c.state.cache, keepSel = c.state.sel.extra, keepMode = c.state.mode;
      c.state.cache = { at: new Date(), details: true, items: [{ trackId: "1", heads: ["الاسم", "الحالة الاجتماعية"], rows: [{ cells: ["أ", "أعزب"] }, { cells: ["ب", "منفصلة"] }, { cells: ["ج", "منفصلة"] }, { cells: ["د", "الزوج"] }] }] };
      c.state.mode = "report"; c.state.sel.extra = {}; c.render();
      const optsM = [...b.querySelectorAll('select[data-sel="x:marital_status"] option')].map((o) => o.textContent.trim());
      ok("«الحالة الاجتماعية»: القيمة الفعلية الناقصة من النموذج تظهر في التصفية «(من البيانات)»", optsM.some((t) => /منفصلة \(من البيانات\)/.test(t)) && optsM.includes("أعزب") && !optsM.some((t) => /أعزب \(من/.test(t)), JSON.stringify(optsM));
      const rr = c.state.cache.items[0], applied = App.centerCmd._extras.apply({ type: "list", heads: rr.heads, rows: rr.rows }) ;
      c.state.sel.extra = { marital_status: "~منفصلة" };
      const filt = App.centerCmd._extras.apply({ type: "list", heads: rr.heads, rows: rr.rows });
      ok("التصفية بالقيمة الفعلية تُبقي أصحابها فقط", filt.rows.length === 2 && filt.rows.every((x) => x.cells[1] === "منفصلة"), JSON.stringify(filt.rows.map((x) => x.cells)));
      c.state.sel.extra = { marital_status: "single" };
      const filt2 = App.centerCmd._extras.apply({ type: "list", heads: rr.heads, rows: rr.rows });
      ok("وقيم النموذج المعتادة تعمل كما كانت", filt2.rows.length === 1 && filt2.rows[0].cells[1] === "أعزب", JSON.stringify(filt2.rows.map((x) => x.cells)));
      c.state.cache = keepCache; c.state.sel.extra = keepSel || {}; c.state.mode = keepMode; c.render();
    }
    ok("لا زر بعد البحث (لا تكرار للقراءة)", !b.querySelector('[data-cc="sig-namesearch"]'), "btn");
    agent.run = oldRun; c.state.mode = "report"; c.state.sig.reg = null; c.state.sig.rows = null; c.state.sig.lookups = {}; c.state.sig.nameHits = {}; c.state.wideLimit = 0; c.render();
  }

  // إعدادات الذكاء الاصطناعي: عدة مفاتيح Gemini في حقل متعدد الأسطر
  {
    const gk = document.getElementById("ai-gemini-key");
    ok("حقل مفاتيح Gemini متعدد الأسطر", !!gk && gk.tagName === "TEXTAREA", gk && gk.tagName);
    ok("قائمة المفاتيح تُستخرج من الأسطر", App.ai.keyList("AIza111\nAIza222").length === 2 && typeof App.ai.generate === "function", "keyList");
  }

  // جلسة التوقيعات المحفوظة: تُضاف الصور تباعاً بلا إعادة جلب المسجلين، وتُستعاد بعد إعادة الفتح
  {
    const oldRun = agent.run, oldVision = App.ai.vision, oldHas = App.ai.hasKey, oldConfirm = window.confirm;
    let listCalls = 0, visionCalls = 0;
    App.ai.hasKey = () => true;
    App.ai.vision = async () => { visionCalls++; return JSON.stringify({ title: "ورقة " + visionCalls, rows: visionCalls === 1 ? [{ name: "أحمد علي محمد", signed: true, confidence: 0.95 }] : [{ name: "خالد سعيد", signed: true, confidence: 0.95 }] }); };
    agent.run = async (cmds) => ({ results: cmds.map((cm) => { if (cm.type === "list") listCalls++; return { type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [
      { cells: ["أحمد علي محمد", "101", "G1", "1012345678", "0501112222"] }, { cells: ["خالد سعيد", "102", "G1", "1055555555", "0503334444"] }, { cells: ["سامي عمر", "103", "G1", "1066666666", "0509998888"] } ] }; }) });
    window.confirm = () => true;
    App.centerCmd._sig.clear();
    const fileOf = (nm, data) => ({ name: nm, mime: "image/jpeg", data, thumb: "data:image/jpeg;base64,AAAA", w: 10, h: 10 });
    c.state.mode = "sign"; c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null;
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "6", files: [fileOf("ورقة-1.jpg", "AAAA1111")], failed: [] }); c.render();
    b.querySelector('[data-cc="sig-read"]').click();
    for (let i = 0; i < 40 && !(c.state.sig.rows && c.state.sig.rows.length); i++) await wait(100); await wait(200);
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 60 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(400);
    ok("الجلسة: بعد الدفعة الأولى وُجد المسجلون (3) وقراءة اسم واحد وخالد غير موقّع", !!c.state.sig.reg && c.state.sig.reg.length === 3 && c.state.sig.rows.length === 1 && /خالد سعيد/.test((b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || ""), JSON.stringify({ reg: c.state.sig.reg && c.state.sig.reg.length, rows: c.state.sig.rows && c.state.sig.rows.length, err: c.state.resultError }));
    ok("جدول المتابعة الكامل يعرض كل المسجلين بحالتهم", !!b.querySelector('[data-tblbox="sig-all"]') && b.querySelectorAll('[data-tblbox="sig-all"] tbody tr').length === 3, b.querySelector('[data-tblbox="sig-all"]') && b.querySelector('[data-tblbox="sig-all"]').textContent.slice(0, 100));
    const listsAfterFirst = listCalls;
    // محاكاة إغلاق الأداة وفتحها: الحفظ ثم المسح من الذاكرة ثم الاستعادة
    App.centerCmd._sig.save();
    const keep = { rows: c.state.sig.rows.length, reg: c.state.sig.reg.length };
    Object.assign(c.state.sig, { rows: null, reg: null, regScope: null, fileKeys: [], done: [], manual: {}, lookups: {} });
    App.centerCmd._sig.load(); c.render();
    ok("الاستعادة بعد إعادة الفتح: الأسماء والمسجلون والصور المقروءة", c.state.sig.rows && c.state.sig.rows.length === keep.rows && c.state.sig.reg && c.state.sig.reg.length === keep.reg && c.state.sig.done.length === 1 && /جلسة محفوظة/.test(b.textContent), JSON.stringify({ rows: c.state.sig.rows && c.state.sig.rows.length, done: c.state.sig.done.length }));
    // دفعة ثانية: تُضاف، ولا يُعاد جلب المسجلين
    c.state.sig.files = [fileOf("ورقة-2.jpg", "BBBB2222")]; c.render();
    b.querySelector('[data-cc="sig-read"]').click();
    for (let i = 0; i < 40 && c.state.sig.rows.length < 2; i++) await wait(100); await wait(300);
    ok("الدفعة الثانية تُضاف إلى السابقة (اسمان)", c.state.sig.rows.length === 2 && c.state.sig.done.length === 2, c.state.sig.rows.length);
    ok("لم يُعد جلب المسجلين من النظام عند إضافة الصور", listCalls === listsAfterFirst, { before: listsAfterFirst, after: listCalls });
    ok("النتيجة تتحدّث فوراً: خالد صار موقّعاً ولا قسم «لم يوقّعوا» له", !/خالد سعيد/.test((b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || "") && /سامي عمر/.test((b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || ""), (b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent);
    // إعادة إضافة صورة قُرئت من قبل: تُتجاوز
    c.state.sig.files = [fileOf("نسخة-من-ورقة-1.jpg", "AAAA1111")]; c.render();
    const vBefore = visionCalls;
    b.querySelector('[data-cc="sig-read"]').click(); await wait(500);
    ok("الصورة المكرّرة لا تُقرأ ثانية ولا تضيف أسماء", visionCalls === vBefore && c.state.sig.rows.length === 2 && /سبق قراءتها/.test(c.state.resultError || ""), { visionCalls, vBefore, err: c.state.resultError });
    // مسح الجلسة
    b.querySelector('[data-cc="sig-clear"]').click(); await wait(200);
    ok("مسح الجلسة يفرّغ الذاكرة ومخزن الجهاز", !c.state.sig.rows && !c.state.sig.reg && !localStorage.getItem("tamkeen:sig-session"), JSON.stringify([!!c.state.sig.rows, !!c.state.sig.reg, !!localStorage.getItem("tamkeen:sig-session")]));
    agent.run = oldRun; App.ai.vision = oldVision; App.ai.hasKey = oldHas; window.confirm = oldConfirm; c.state.mode = "report"; c.state.wideLimit = 0; c.render();
  }

  // نموذجان في الصور: لكل نموذج مقارنته وتقريره
  {
    const oldRun = agent.run, oldConfirm = window.confirm;
    agent.run = async (cmds) => ({ results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [
      { cells: ["أحمد علي محمد", "101", "G1", "1012345678", "0501112222"] }, { cells: ["خالد سعيد", "102", "G1", "1055555555", "0503334444"] }, { cells: ["سامي عمر", "103", "G1", "1066666666", "0509998888"] } ] })) });
    window.confirm = () => true; App.centerCmd._sig.clear();
    const mk = (id, name, form) => ({ id, file: "f", name, nid: "", phone: "", signed: true, conf: 0.95, keep: true, form });
    c.state.mode = "sign"; c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null;
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "4", files: [], failed: [], manual: {}, lookups: {}, reg: null, rows: [
      mk("p1", "أحمد علي محمد", "تعهد الحقيبة"), mk("p2", "خالد سعيد", "تعهد الحقيبة"),
      mk("h1", "أحمد علي محمد", "كشف حضور"),
    ] }); c.render();
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 60 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(400);
    ok("نموذجان في الصور: النماذج المعروفة", JSON.stringify(App.centerCmd._sig.forms()) === JSON.stringify(["تعهد الحقيبة", "كشف حضور"]), App.centerCmd._sig.forms());
    const t0 = b.querySelector('[data-tblbox="sig-miss-0"]'), t1 = b.querySelector('[data-tblbox="sig-miss-1"]');
    ok("نموذج التعهد: لم يوقّع سامي فقط", !!t0 && /سامي عمر/.test(t0.textContent) && !/خالد سعيد/.test(t0.textContent) && !/أحمد علي/.test(t0.textContent), t0 && t0.textContent.slice(0, 120));
    ok("نموذج الحضور: لم يوقّع خالد وسامي", !!t1 && /خالد سعيد/.test(t1.textContent) && /سامي عمر/.test(t1.textContent) && !/أحمد علي/.test(t1.textContent), t1 && t1.textContent.slice(0, 120));
    ok("عنوان لكل نموذج وجدول متابعة لكل منهما", /النموذج: تعهد الحقيبة/.test(b.textContent) && /النموذج: كشف حضور/.test(b.textContent) && !!b.querySelector('[data-tblbox="sig-all-0"]') && !!b.querySelector('[data-tblbox="sig-all-1"]'), "titles");
    const mx = b.querySelector('[data-tblbox="sig-matrix"]');
    const mrow = (nm) => [...(mx ? mx.querySelectorAll("tbody tr") : [])].find((r) => r.textContent.includes(nm));
    ok("ما ينقص كل طالب: جدول بكل المسجلين (3) مرتباً بالأكثر نقصاً", !!mx && mx.querySelectorAll("tbody tr").length === 3 && /سامي عمر/.test(mx.querySelector("tbody tr").textContent), mx && mx.textContent.slice(0, 200));
    ok("سامي ينقصه النموذجان، وخالد ينقصه «كشف حضور» فقط، وأحمد مكتمل", !!mrow("سامي عمر") && /تعهد الحقيبة، كشف حضور|كشف حضور، تعهد الحقيبة/.test(mrow("سامي عمر").textContent) && /ينقصه|كشف حضور/.test(mrow("خالد سعيد").textContent) && !/تعهد الحقيبة\s*$/.test("") && /مكتمل ✓/.test(mrow("أحمد علي محمد").textContent), [mrow("سامي عمر"), mrow("خالد سعيد"), mrow("أحمد علي محمد")].map((r) => r && r.textContent.replace(/\s+/g, " ").slice(0, 160)));
    const mh = App.centerCmd._sig.sheets()[0];
    const iT = mh.heads.indexOf("المسار"), iS = mh.heads.indexOf("المرحلة"), iG = mh.heads.indexOf("المجموعة"), iN = mh.heads.indexOf("عدد الناقص"), iM = mh.heads.indexOf("ينقصه");
    ok("Excel «ما ينقص كل طالب»: أعمدة المسار والمرحلة والمجموعة موجودة", iT >= 0 && iS >= 0 && iG >= 0 && iT < iG, mh.heads);
    ok("Excel: عمود مستقل لكل نموذج، قبل «عدد الناقص» و«ينقصه»", mh.heads.indexOf("تعهد الحقيبة") > iG && mh.heads.indexOf("كشف حضور") > iG && mh.heads.indexOf("كشف حضور") < iN && iN < iM, mh.heads);
    const sam = App.centerCmd._sig.sheets()[0].rows.find((r) => r[0] === "سامي عمر");
    ok("صف سامي: مسار ومجموعة، ونموذجان ناقصان في عمودين مستقلين، وعددهما 2", !!sam && sam[iG] === "G1" && String(sam[iT]).length > 0 && /ناقص/.test(sam[mh.heads.indexOf("تعهد الحقيبة")]) && /ناقص/.test(sam[mh.heads.indexOf("كشف حضور")]) && sam[iN] === 2, sam);
    // رسالة واتساب واحدة لكل مسار فيها طلابه الناقصون مرقّمين
    const cards = [...b.querySelectorAll(".cc-sigwa-card")], pre = cards[0] && cards[0].querySelector(".cc-sigwa-pre");
    ok("رسالة واحدة للمسار (كل المسجلين في مسار واحد)", cards.length === 1 && !b.querySelector(".cc-sigwa-r"), cards.length);
    ok("صيغة الرسالة: ترقيم، ثم المسار · المرحلة · المجموعة، ثم «ينقصه»", !!pre && /^\*نواقص التوقيع — الحلاقة الرجالية \(2\)\*/.test(pre.textContent) && /1- خالد سعيد\n {3}الحلاقة الرجالية · المرحلة الثانية · G1\n {3}ينقصه: كشف حضور/.test(pre.textContent) && /ينقصه: كشف حضور\n──────────────\n2- سامي عمر\n {3}الحلاقة الرجالية · المرحلة الثانية · G1\n {3}ينقصه:\n {3}• تعهد الحقيبة\n {3}• كشف حضور$/.test(pre.textContent) && !/أحمد علي/.test(pre.textContent), pre && pre.textContent);
    const wl = [...b.querySelectorAll(".cc-sigwa-card a")];
    ok("زر واتساب يفتح الرسالة جاهزة في تبويب جديد بلا إرسال تلقائي", wl.length === 1 && /^https:\/\/wa\.me\/\?text=/.test(wl[0].href) && wl[0].target === "_blank" && /خالد سعيد/.test(decodeURIComponent(wl[0].href)), wl.map((x) => x.href.slice(0, 50)));
    // نسخ رسالة المسار
    let cpw = ""; const ocW = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { cpw = x; } }, configurable: true });
    const bw = b.querySelector('[data-cc="sigwa-copy"]'); if (bw) { bw.click(); await wait(200); }
    ok("نسخ رسالة المسار يعطي النص نفسه", cpw === (pre && pre.textContent), cpw.slice(0, 60));
    try { Object.defineProperty(navigator, "clipboard", { value: ocW, configurable: true }); } catch (e) { /* */ }
    // تعديل العنوان وإخفاء التفاصيل
    const hd = b.querySelector('[data-sigwa="head"]'); hd.value = "تذكير: {المسار}"; hd.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    ok("العنوان المعدّل يظهر ويُحفظ", /^تذكير: الحلاقة الرجالية\n/.test(b.querySelector(".cc-sigwa-pre").textContent) && localStorage.getItem("tamkeen:sig-wa-head") === "تذكير: {المسار}", localStorage.getItem("tamkeen:sig-wa-head"));
    const dt = b.querySelector('[data-sigwa="detail"]'); dt.checked = false; dt.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    ok("إخفاء المسار والمرحلة والمجموعة تحت الأسماء", !/المرحلة الثانية/.test(b.querySelector(".cc-sigwa-pre").textContent) && /1- خالد سعيد\n {3}ينقصه: كشف حضور/.test(b.querySelector(".cc-sigwa-pre").textContent), b.querySelector(".cc-sigwa-pre").textContent);
    localStorage.removeItem("tamkeen:sig-wa-head"); localStorage.removeItem("tamkeen:sig-wa-detail"); c.render(); await wait(100);
    let cpm = ""; const ocP = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { cpm = x; } }, configurable: true });
    const cb = b.querySelector('[data-cc="sig-copy-miss"]'); if (cb) { cb.click(); await wait(200); }
    ok("نسخ قائمة الناقصين: لكل طالب ما ينقصه", /^\*ناقصو التوقيع \(2 من 3\)/.test(cpm) && /سامي عمر — ينقصه: .*كشف حضور/.test(cpm) && /خالد سعيد — ينقصه: كشف حضور/.test(cpm) && !/أحمد علي محمد —/.test(cpm), cpm);
    try { Object.defineProperty(navigator, "clipboard", { value: ocP, configurable: true }); } catch (e) { /* */ }
    const sh = App.centerCmd._sig.sheets();
    ok("Excel: ورقة «ما ينقص كل طالب» ثم «النماذج» وورقات لكل نموذج ببادئة ن1/ن2", sh[0].name === "ما ينقص كل طالب" && sh[1].name === "النماذج" && sh.some((x) => /^ن1 - /.test(x.name)) && sh.some((x) => /^ن2 - /.test(x.name)) && sh.every((x) => x.name.length <= 31), sh.map((x) => x.name));
    // إعادة تسمية نموذج بنفس اسم آخر تدمجهما
    const fn = b.querySelector('[data-sig-fname="كشف حضور"]');
    fn.value = "تعهد الحقيبة"; fn.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    ok("توحيد اسمي النموذجين يدمجهما في نموذج واحد", App.centerCmd._sig.forms().length === 1 && !!b.querySelector('[data-tblbox="sig-miss"]'), App.centerCmd._sig.forms());
    App.centerCmd._sig.clear(); agent.run = oldRun; window.confirm = oldConfirm; c.state.mode = "report"; c.state.wideLimit = 0; c.render();
  }

  // فقاعات الشرح عند مرور المؤشر على تبويبات «تحويل ملف حسب قالب»
  {
    const tabs = [...document.querySelectorAll(".cv-tab")];
    ok("للتبويبات الأربعة شرح (عنوان ونص مفصّل)", tabs.length === 4 && tabs.every((t) => (t.dataset.tip || "").length > 60 && !!t.dataset.tipT), tabs.map((t) => (t.dataset.tip || "").length));
    const hover = async (el) => { el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); await wait(350); };
    const tip = () => document.getElementById("tk-tip");
    location.hash = "#converter"; await wait(300);
    const t1 = document.querySelector('.cv-tab[data-cv-tab="tpl"]');
    await hover(t1);
    ok("المرور على «تحويل حسب قالب» يُظهر فقاعة بعنوانها وشرحها", !!tip() && !tip().hidden && /تحويل حسب قالب/.test(tip().textContent) && /اربط أعمدة القالب/.test(tip().textContent), tip() && tip().textContent.slice(0, 80));
    const rt = tip().getBoundingClientRect();
    ok("الفقاعة داخل حدود الشاشة", rt.left >= 0 && rt.right <= window.innerWidth && rt.top >= 0 && rt.bottom <= window.innerHeight, JSON.stringify([rt.left, rt.right, rt.top, rt.bottom, window.innerWidth, window.innerHeight]));
    t1.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); await wait(50);
    ok("تختفي الفقاعة بخروج المؤشر", tip().hidden, "hidden");
    for (const k of ["fill", "exam", "quick"]) {
      const t = document.querySelector('.cv-tab[data-cv-tab="' + k + '"]'); await hover(t);
      ok("فقاعة تبويب «" + t.dataset.tipT + "»", !tip().hidden && tip().textContent.includes(t.dataset.tipT) && tip().textContent.length > 80, tip().textContent.slice(0, 60));
      t.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); await wait(30);
    }
    // تبويبات «أوامر المركز» الداخلية
    c.state.mode = "report"; c.render();
    const modes = [...b.querySelectorAll('.cc-modes button[data-m]')];
    ok("كل تبويب داخل «أوامر المركز» له شرح مفصّل بلا title مكرر", modes.length >= 15 && modes.every((x) => (x.dataset.tip || "").length > 40 && !x.hasAttribute("title")), modes.filter((x) => (x.dataset.tip || "").length <= 40).map((x) => x.dataset.m));
    const sg = b.querySelector('.cc-modes button[data-m="sign"]'); await hover(sg);
    ok("فقاعة «مطابقة التوقيعات» تشرح مهامها", !tip().hidden && /مطابقة التوقيعات/.test(tip().textContent) && /ما ينقص كل طالب/.test(tip().textContent), tip().textContent.slice(0, 80));
    sg.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); await wait(30);
    // التركيز بلوحة المفاتيح يُظهر الفقاعة أيضاً، وEsc يخفيها
    t1.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); await wait(50);
    ok("التركيز بلوحة المفاتيح يُظهر الفقاعة", !tip().hidden, "focus");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(30);
    ok("Esc يُخفي الفقاعة", tip().hidden, "esc");
    location.hash = "#dashboard";
  }

  // أوامر المركز صفحة مستقلة، وأدواتها مجمّعة في أربع مجموعات بعناوين
  {
    const nb = document.querySelector('.sidebar [data-view="center"]');
    ok("زر «أوامر نظام المركز» في القائمة الجانبية", !!nb && /أوامر نظام المركز/.test(nb.textContent), nb && nb.textContent);
    ok("لا تبويب «أوامر المركز» في صفحة التحويل", !document.querySelector('#view-converter [data-cv-tab="center"]') && !document.querySelector('#view-converter #cc-body'), "no-tab");
    ok("المحتوى في صفحة مستقلة view-center", !!document.querySelector("#view-center #cc-body") && !!document.querySelector("#view-center .cv-intro h2"), "view");
    location.hash = "#center"; await wait(400);
    ok("المسار #center يعرض الصفحة المستقلة", document.getElementById("view-center").classList.contains("active") && !document.getElementById("view-converter").classList.contains("active"), [...document.querySelectorAll(".view.active")].map((x) => x.id));
    c.state.mode = "report"; c.render();
    const groupsEl = [...b.querySelectorAll(".cc-modes .cc-mgroup")];
    ok("أربع مجموعات بعناوينها", groupsEl.length === 4 && groupsEl.map((g) => g.querySelector(".cc-mg-t").textContent).join("|") === "الطلاب والتقارير|المتابعة اليومية|التوقيعات والكشوف|فحص وجودة", groupsEl.map((g) => g.querySelector(".cc-mg-t").textContent));
    ok("كل الأدوات الـ18 موزّعة بلا تكرار ولا نقص", groupsEl.reduce((n, g) => n + g.querySelectorAll("button[data-m]").length, 0) === 18 && new Set([...b.querySelectorAll(".cc-modes button[data-m]")].map((x) => x.dataset.m)).size === 18, groupsEl.map((g) => g.querySelectorAll("button").length));
    ok("المطابقة والتعهد والصورة والمقارنة في مجموعة «التوقيعات والكشوف»", [...groupsEl[2].querySelectorAll("button[data-m]")].map((x) => x.dataset.m).join() === "sign,pledge,img,xl", [...groupsEl[2].querySelectorAll("button")].map((x) => x.dataset.m));
    groupsEl[2].querySelector('button[data-m="pledge"]').click(); await wait(200);
    ok("النقر على أداة داخل مجموعتها يفتحها", c.state.mode === "pledge" && !!b.querySelector("#cc-pledge"), c.state.mode);
    c.state.mode = "report"; c.render();
    const ou2 = App.cloud.user, oReady = App.cloud.ready; App.cloud.ready = () => true; App.cloud.user = () => ({ name: "موظف", views: ["converter"] });
    ok("صلاحية «تحويل ملف» تشمل «أوامر المركز» (حسابات قائمة لا تفقدها)", App.profile.canView("center") === true && App.profile.canView("converter") === true && App.profile.canView("forms") === false, "perm");
    App.cloud.user = () => ({ name: "موظف", views: ["letters"] });
    ok("من لا يملكها لا يرى الصفحة", App.profile.canView("center") === false, "perm2");
    App.cloud.user = ou2; App.cloud.ready = oReady;
    location.hash = "#dashboard";
  }

  // شريط النطاق الثابت + حفظ النطاق + الأكثر استعمالاً (المفضلة وآخر الأدوات)
  {
    location.hash = "#center"; await wait(400);
    ["tamkeen:cc-scope", "tamkeen:cc-recent", "tamkeen:cc-fav"].forEach((k) => localStorage.removeItem(k));
    c.state._noted = ""; c.state.mode = "report"; c.state.gopen = ""; c.state.groups = [];
    [c.state.sel, c.state.mis, c.state.cmp, c.state.sib, c.state.dq, c.state.grp, c.state.imp, c.state.att, c.state.sig, c.state.xl, c.state.pledge].forEach((x) => { x.tracks = []; if ("stages" in x) x.stages = []; });
    c.render();
    // ثبات الشريط عند التمرير
    const gb = b.querySelector(".cc-gbar");
    ok("شريط النطاق ثابت (position: sticky) تحت الشريط العلوي", !!gb && getComputedStyle(gb).position === "sticky", gb && getComputedStyle(gb).position);
    const sp = document.createElement("div"); sp.id = "tk-spacer"; sp.style.height = "3000px"; (b.querySelector(".cc-app") || b).appendChild(sp);   // داخل حاوية الشريط ليثبت عند التمرير
    window.scrollTo(0, 2200); await wait(250);   // أبعد من موضع الشريط الأصلي ليبلغ حدّ الثبات
    const gr = b.querySelector(".cc-gbar").getBoundingClientRect(), tb = document.querySelector(".topbar"), tbh = tb ? tb.getBoundingClientRect().height : 0;
    ok("بعد التمرير يبقى الشريط ظاهراً أعلى الصفحة", gr.top >= 0 && gr.top <= tbh + 40 && window.scrollY > 300, JSON.stringify({ top: gr.top, tbh, y: window.scrollY }));
    sp.remove(); window.scrollTo(0, 0);
    // حفظ النطاق واستعادته
    b.querySelector('.cc-pill[data-gk="stages"]').click(); await wait(100);
    [...b.querySelectorAll('[data-sc="stages"]')].find((x) => x.value === "المرحلة الثالثة").click(); await wait(150);
    const saved = JSON.parse(localStorage.getItem("tamkeen:cc-scope") || "null");
    ok("اختيار المرحلة يُحفظ على الجهاز", !!saved && saved.s.includes("المرحلة الثالثة"), JSON.stringify(saved));
    [c.state.sel, c.state.mis, c.state.cmp, c.state.sib, c.state.dq, c.state.grp, c.state.imp, c.state.att, c.state.sig, c.state.xl, c.state.pledge].forEach((x) => { x.tracks = []; if ("stages" in x) x.stages = []; }); c.state.groups = [];
    App.centerCmd._scope.load(); c.render();
    ok("يعود النطاق المحفوظ عند فتح الصفحة (المرحلة الثالثة في الشريط وفي إعدادات الأدوات)", /الثالثة/.test(b.querySelector('.cc-pill[data-gk="stages"]').textContent) && c.state.att.stages.includes("المرحلة الثالثة") && c.state.sel.stages.includes("الثالث"), JSON.stringify([c.state.att.stages, c.state.sel.stages]));
    b.querySelector('[data-cc="gclear"]').click(); await wait(150);
    ok("«مسح الكل» يمسح النطاق المحفوظ أيضاً", (JSON.parse(localStorage.getItem("tamkeen:cc-scope") || "{}").s || []).length === 0, localStorage.getItem("tamkeen:cc-scope"));
    // الأكثر استعمالاً
    const go = async (m) => { b.querySelector('.cc-modes button[data-m="' + m + '"]').click(); await wait(150); };
    await go("dq"); await go("sign"); await go("morning");
    let chips = [...b.querySelectorAll(".cc-quick .cc-chip")].map((x) => x.dataset.m);
    ok("آخر الأدوات (الأحدث أولاً، بلا الحالية): sign ثم dq ثم report", chips.join() === "sign,dq,report", chips);
    b.querySelector('[data-cc="fav-toggle"]').click(); await wait(150);
    ok("تثبيت الأداة الحالية في المفضلة يحفظها", JSON.parse(localStorage.getItem("tamkeen:cc-fav") || "[]").join() === "morning" && /في المفضلة/.test(b.querySelector(".cc-fav").textContent), localStorage.getItem("tamkeen:cc-fav"));
    await go("attend");
    chips = [...b.querySelectorAll(".cc-quick .cc-chip")].map((x) => (x.classList.contains("fav") ? "★" : "") + x.dataset.m);
    ok("المفضلة تظهر أولاً بنجمة ثم آخر الأدوات (ثلاث)", chips.join() === "★morning,morning,sign,dq" || chips.join() === "★morning,sign,dq,morning" || (chips[0] === "★morning" && chips.length === 4), chips);
    ok("المفضلة لا تتكرر بين الأخيرة", chips.filter((x) => /morning/.test(x)).length === 1, chips);
    b.querySelector('.cc-quick .cc-chip.fav').click(); await wait(150);
    ok("النقر على مفضّلة يفتحها", c.state.mode === "morning", c.state.mode);
    b.querySelector('[data-cc="fav-toggle"]').click(); await wait(150);
    ok("إزالة النجمة تحذفها من المفضلة", JSON.parse(localStorage.getItem("tamkeen:cc-fav") || "[]").length === 0, localStorage.getItem("tamkeen:cc-fav"));
    ["tamkeen:cc-scope", "tamkeen:cc-recent", "tamkeen:cc-fav"].forEach((k) => localStorage.removeItem(k));
    c.state.mode = "report"; c.render(); location.hash = "#dashboard";
  }

  // متى جُلبت البيانات + «حدّث هذه الأداة فقط» بقراءة جديدة لا من الذاكرة
  {
    location.hash = "#center"; await wait(300);
    c.state.wideLimit = 100000; c.state.wide = null; c.state.groups = [];
    c.state.mode = "dq"; c.state.dq = Object.assign(c.state.dq, { tracks: ["1"], stages: [], status: "", out: null, rows: null, diff: null }); c.render();
    c.state.mode = "report"; c.render(); b.querySelector('[data-cc="preload"]').click();
    for (let i = 0; i < 100 && !c.state.cache && !c.state.resultError; i++) await wait(200);
    c.state.mode = "dq"; c.render();
    b.querySelector('[data-cc="run-dq"]').click();
    for (let i = 0; i < 50 && !c.state.dq.out; i++) await wait(200); await wait(300);
    const fb = b.querySelector(".cc-fresh");
    ok("شريط «جُلبت البيانات قبل…» يظهر بعد التنفيذ", !!fb && /جُلبت البيانات/.test(fb.textContent) && /الآن|قبل/.test(fb.textContent) && !fb.classList.contains("stale"), fb && fb.textContent);
    const lgA = c.state.runLog[0] || {};
    ok("التنفيذ الأول خدمته الذاكرة المحمّلة (لا قراءة جديدة)", lgA.mode === "dq" && lgA.sent === 0, JSON.stringify(lgA));
    c.state.dq.out.at = new Date(Date.now() - 3 * 3600e3); c.render();
    ok("بيانات عمرها 3 ساعات: «قبل 3 ساعة» وتنبيه قد تكون قديمة", /قبل 3 ساعة/.test(b.querySelector(".cc-fresh").textContent) && b.querySelector(".cc-fresh").classList.contains("stale") && /قد تكون قديمة/.test(b.querySelector(".cc-fresh").textContent), b.querySelector(".cc-fresh").textContent);
    const before = c.state.dq.out;
    b.querySelector('[data-cc="refresh-mode"]').click();
    for (let i = 0; i < 50 && (c.state.dq.out === before || c.state.busy); i++) await wait(200); await wait(400);
    const lgB = c.state.runLog[0] || {};
    ok("«حدّث هذه الأداة فقط» يقرأ من النظام (sent ≥ 1) لا من الذاكرة", lgB.mode === "dq" && lgB.sent >= 1 && c.state.dq.out !== before, JSON.stringify(lgB));
    ok("بعد التحديث يعود الشريط «الآن» وتُصفَّر علامة القراءة الجديدة", /الآن/.test(b.querySelector(".cc-fresh").textContent) && c.state.forceFresh === false, [b.querySelector(".cc-fresh").textContent, c.state.forceFresh]);
    c.state.cache = null; c.state.wideLimit = 0; c.state.mode = "report"; c.render(); location.hash = "#dashboard";
  }

  // البحث الشامل (Ctrl+K) يشمل أدوات المركز وطلاب الذاكرة المحمّلة
  {
    const gsInput = document.getElementById("gs-input"), typeQ = async (q) => { gsInput.value = q; gsInput.dispatchEvent(new Event("input", { bubbles: true })); await wait(150); };
    App.search.open(); await wait(100);
    await typeQ("تقرير الصباح");
    const tool = [...document.querySelectorAll("#gs-results .gs-item")].find((x) => /تقرير الصباح/.test(x.textContent));
    ok("Ctrl+K يجد أداة «تقرير الصباح» ضمن «أدوات المركز»", !!tool && /أدوات المركز/.test(document.getElementById("gs-results").textContent), document.getElementById("gs-results").textContent.slice(0, 120));
    if (!tool) ok("تشخيص: نتائج البحث الفعلية", false, { html: document.getElementById("gs-results").textContent.slice(0, 300), idx: App.search.index().filter((x) => /أدوات/.test(x.group)).length, mode: c.state.mode, allowed: App.centerCmd.allowed() });
    else tool.click(); await wait(400);
    ok("اختيار الأداة يفتح صفحة المركز على أداتها", location.hash === "#center" && c.state.mode === "morning", JSON.stringify([location.hash, c.state.mode]));
    await typeQ("") ; document.getElementById("gs-modal").classList.remove("open");
    // بحث بمعنى الأداة لا باسمها فقط
    App.search.open(); await wait(100); await typeQ("مطابقة التوقيعات");
    ok("البحث بوصف الأداة (نماذج الناقصين) يجد مطابقة التوقيعات", [...document.querySelectorAll("#gs-results .gs-item")].some((x) => /مطابقة التوقيعات/.test(x.textContent)), "tip-search");
    document.getElementById("gs-modal").classList.remove("open");
    // طلاب الذاكرة المحمّلة
    c.state.wideLimit = 100000; c.state.wide = null; c.state.mode = "report"; c.render();
    b.querySelector('[data-cc="preload"]').click();
    for (let i = 0; i < 100 && !c.state.cache && !c.state.resultError; i++) await wait(200);
    const first = c.state.cache && c.state.cache.items[0] && c.state.cache.items[0].rows[0];
    const idx = c.state.cache ? App.centerCmd.searchIndex().filter((x) => /طلاب/.test(x.group)) : [];
    ok("طلاب الذاكرة المحمّلة يظهرون في فهرس البحث بلا قراءة جديدة", idx.length > 0, idx.length);
    if (idx.length) {
      App.search.open(); await wait(100); await typeQ(idx[0].title.split(" ")[0] + " " + (idx[0].title.split(" ")[1] || ""));
      const st = [...document.querySelectorAll("#gs-results .gs-item")].find((x) => /طلاب \(الذاكرة/.test(x.closest(".gs-group").textContent));
      ok("بحث باسم طالب في الذاكرة يجده", !!st, document.getElementById("gs-results").textContent.slice(0, 120));
      if (st) { st.click(); await wait(400); ok("اختيار الطالب يفتح «ملف الطالب» مع اسمه في خانة البحث (بلا قراءة تلقائية)", c.state.mode === "student" && !!c.state.stu.q && c.state.stu.q.includes(idx[0].title.split(" ")[0]) && !c.state.stu.out, JSON.stringify([c.state.mode, c.state.stu.q, !!c.state.stu.out])); }
      document.getElementById("gs-modal").classList.remove("open");
    }
    c.state.cache = null; c.state.wideLimit = 0; c.state.mode = "report"; c.render(); location.hash = "#dashboard";
  }

  // ذاكرة تصحيحات المطابقة: ما ربطتَه يدوياً يُعرَف تلقائياً في الأوراق التالية، و«ليس هو» يُحظر
  {
    const oldRun = agent.run, oldConfirm = window.confirm; window.confirm = () => true;
    agent.run = async (cmds) => ({ results: cmds.map((cm) => ({ type: "list", label: cm.label, params: cm.params, heads: ["الاسم", "رقم الطالب", "المجموعة", "رقم الهوية", "الجوال"], rows: [
      { cells: ["ريم سالم", "7002", "G1", "9000000001", ""] }, { cells: ["سلمى ياسر", "7003", "G1", "9000000003", ""] } ] })) });
    App.centerCmd._sig.clear(); App.centerCmd._sig.learn.clear();
    const mk = (id, name) => ({ id, file: "f", name, nid: "", phone: "", signed: true, conf: 0.9, keep: true });
    c.state.mode = "sign"; c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null;
    c.state.sig = Object.assign(c.state.sig, { tracks: ["1"], stages: [], status: "3", files: [], failed: [], manual: {}, lookups: {}, reg: null, rows: [mk("a1", "نجود ابو العلا")] }); c.render();
    b.querySelector('[data-cc="run-sig"]').click();
    for (let i = 0; i < 60 && !c.state.sig.reg && !c.state.resultError; i++) await wait(100); await wait(400);
    const sel = b.querySelector('[data-sig-assign="a1"]');
    ok("الاسم المقروء الخاطئ يظهر غير مطابق (يمكن ربطه يدوياً)", !!sel && /ريم سالم/.test(b.querySelector('[data-tblbox="sig-miss"]').textContent), "orphan");
    sel.value = c.state.sig.reg.find((r) => r.name === "ريم سالم").key; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(250);
    const lr = App.centerCmd._sig.learn.get();
    ok("الربط اليدوي يُحفظ في ذاكرة التصحيحات", Object.values(lr).some((x) => x.n === "ريم سالم"), JSON.stringify(lr));
    // ورقة جديدة بالاسم المقروء نفسه: تُربط تلقائياً بلا تدخل
    c.state.sig.manual = {}; c.state.sig.rows = [mk("b1", "نجود ابو العلا")]; c.render(); await wait(150);
    const missTxt = (b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || "";
    ok("الاسم نفسه في ورقة لاحقة يُعرَف تلقائياً (ريم وقّعت، وسلمى فقط لم توقّع)", !/ريم سالم/.test(missTxt) && /سلمى ياسر/.test(missTxt) && /من تصحيح سابق لك/.test(b.querySelector('[data-tblbox="sig-all"]').textContent), missTxt.slice(0, 100));
    // حظر «ليس هو»
    const reg1 = c.state.sig.reg.find((r) => r.name === "ريم سالم");
    App.centerCmd._sig.learn.block("نجود ابو العلا", reg1); c.render(); await wait(150);
    ok("بعد «ليس هو» لا يُربط الاسم بها ثانية", /ريم سالم/.test((b.querySelector('[data-tblbox="sig-miss"]') || {}).textContent || ""), "blocked");
    ok("الحظر يلغي التعلّم السابق لذلك الربط", !Object.values(App.centerCmd._sig.learn.get()).some((x) => x.r === reg1.key), JSON.stringify(App.centerCmd._sig.learn.get()));
    // مسح الذاكرة
    b.querySelector('[data-cc="sig-learn-clear"]').click(); await wait(200);
    ok("زر «امسح الذاكرة» يفرّغها", Object.keys(App.centerCmd._sig.learn.get()).length === 0, "cleared");
    App.centerCmd._sig.clear(); agent.run = oldRun; window.confirm = oldConfirm; c.state.mode = "report"; c.state.wideLimit = 0; c.render();
  }

  // تقرير الشهر الموحّد: حضور + استبيانات (+ توقيعات) لكل مسار في مستند واحد
  {
    location.hash = "#center"; await wait(300);
    c.state.groups = []; c.state.wideLimit = 100000; c.state.wide = null; c.state.mode = "monthly";
    c.state.monthly = Object.assign(c.state.monthly, { tracks: [], stages: [], month: "2026-11", mis: true, sig: false, out: null });
    c.state.att = Object.assign(c.state.att, { tracks: [], stages: [], out: null, thr: 3 }); c.state.mis.out = null; c.state.sig.reg = null; c.state.sig.rows = null; c.render();
    const mbtn = b.querySelector('.cc-mgroup button[data-m="monthly"]');
    ok("تبويب «تقرير الشهر» في مجموعة «الطلاب والتقارير» مع الشرح", !!mbtn && /مستند شهري/.test(mbtn.dataset.tip || "") && !!b.querySelector('[data-mon="month"]') && !!b.querySelector('[data-cc="run-monthly"]'), JSON.stringify({ btn: !!mbtn, tip: mbtn && (mbtn.dataset.tip || "").slice(0, 40), month: !!b.querySelector('[data-mon="month"]'), run: !!b.querySelector('[data-cc="run-monthly"]'), mode: c.state.mode }));
    const rg = App.centerCmd._monthly.range("2026-11");
    ok("فترة الشهر: من أوله إلى آخره (أو اليوم إن لم ينتهِ)", rg.from === "2026-11-01" && (rg.to === "2026-11-30" || rg.to <= App.ui.todayISO()), JSON.stringify(rg));
    calls.length = 0; b.querySelector('[data-cc="run-monthly"]').click();
    for (let i = 0; i < 120 && !c.state.monthly.out && !c.state.resultError; i++) await wait(200); await wait(400);
    const mo = c.state.monthly.out;
    ok("التقرير يُعدّ من الحضور والاستبيانات بلا خطأ", !!mo && mo.doc.tracks >= 1 && mo.d.sources.att && mo.d.sources.mis && !mo.d.sources.sig, JSON.stringify({ err: c.state.resultError, tracks: mo && mo.doc.tracks }));
    ok("جدول الملخص والأزرار تظهر", !!b.querySelector('[data-tblbox="mon-sum"]') && ["mon-print", "mon-word", "mon-xlsx", "mon-copy"].every((a) => !!b.querySelector('[data-cc="' + a + '"]')), "result");
    const sumRows = b.querySelectorAll('[data-tblbox="mon-sum"] tbody tr').length;
    ok("صف لكل مسار وصف الإجمالي", sumRows === mo.doc.tracks + 1, [sumRows, mo.doc.tracks]);
    ok("المستند: عنوان بالشهر العربي وفاصل صفحة لكل مسار", mo.doc.blocks[0].text === "التقرير الشهري — نوفمبر 2026" && mo.doc.blocks.filter((x) => x.kind === "pagebreak").length === mo.doc.tracks, mo.doc.blocks[0].text);
    // Word على الترويسة + الطباعة بلا خلل
    await App.docx.load();
    const bytes = new Uint8Array(await App.docx.build(mo.doc.blocks).arrayBuffer()), txt = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    ok("ملف Word يحوي العنوان والملخص", /التقرير الشهري/.test(txt) && /نوفمبر 2026/.test(txt) && /الإجمالي/.test(txt), { len: bytes.length });
    const hostM = document.createElement("div"); hostM.style.cssText = "position:absolute;left:-12000px;top:0;width:8.5in;container-type:inline-size"; document.body.appendChild(hostM);
    const pcM = App.docRender.paginate(hostM, mo.doc.blocks); hostM.remove();
    ok("التقسيم إلى صفحات: لا أقل من صفحة لكل مسار وملخص", pcM >= mo.doc.tracks + 1, pcM);
    // نسخ الملخص
    let cpS = ""; const ocS = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (x) => { cpS = x; } }, configurable: true });
    b.querySelector('[data-cc="mon-copy"]').click(); await wait(200);
    ok("نسخ الملخص: عنوان وسطر لكل مسار", /^\*التقرير الشهري نوفمبر 2026\*/.test(cpS) && /• /.test(cpS), cpS.slice(0, 120));
    try { Object.defineProperty(navigator, "clipboard", { value: ocS, configurable: true }); } catch (e) { /* */ }
    // تغيير الشهر يمسح النتيجة
    const mi = b.querySelector('[data-mon="month"]'); mi.value = "2026-10"; mi.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    ok("تغيير الشهر يمسح التقرير السابق", !c.state.monthly.out && !b.querySelector('[data-tblbox="mon-sum"]'), c.state.monthly.month);
    c.state.wideLimit = 0; c.state.mode = "report"; c.render(); location.hash = "#dashboard";
  }

  return R;
}
