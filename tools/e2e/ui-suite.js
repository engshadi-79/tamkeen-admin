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
    isReady: () => true, ready: async () => true, version: () => "1.4.0", stop() { calls.push("stop"); },
    run: async (cmds, opts) => {
      const res = cmds.map((cm) => {
        calls.push((cm.source || cm.type) + (cm.params && cm.params.status ? ":" + cm.params.status : ""));
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

  // ===== 7) المجموعات والمدربون =====
  DATA = [mk("طالب أول رباعي كامل", "401000001", "0591000001", "1", S2, "G1 مدرب أحمد"), mk("طالب ثان رباعي كامل", "401000002", "0591000002", "2", S2, "G1 مدرب أحمد"), mk("طالب ثالث رباعي كامل", "401000003", "0591000003", "3", S2, "G1 مدرب أحمد"), mk("طالب رابع رباعي كامل", "401000004", "0591000004", "4", S2, "G2 مدربة سلمى"), mk("وليد غير موزع رباعي", "401000005", "0591000005", "5", S2, " - "), mk("هدى غير موزعة رباعي", "401000006", "0591000006", "6", S2, "-")];
  c.state.grp = Object.assign(c.state.grp, { tracks: ["1"], stages: [], status: "active", out: null });
  await run("groups", "run-grp");
  const go = c.state.grp.out;
  ok("المجموعات: مجموعتان ومدربان و2 غير موزع", go.groups.length === 2 && go.trainers.length === 2 && go.unassigned === 2);
  b.querySelector('[data-cc="grp-propose"]').click();
  ok("اقتراح التوزيع: يوازن (الصغرى أولاً)", c.state.grp.out.prop.rows.length === 2 && c.state.grp.out.prop.rows[0][4] === "G2");

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
  let release; const hold = new Promise((r) => { release = r; }); const prevRun = agent.run; agent.run = async (cmds) => { await hold; return { results: cmds.map(() => ({ type: "list", heads: SH, rows: [] })) }; };
  c.state.mode = "report"; c.render(); b.querySelector('[data-cc="run-selection"]').click(); await wait(300);
  const stopBtn = b.querySelector('[data-cc="stop-run"]');
  ok("زر الإيقاف ومربع الإشعار يظهران أثناء التنفيذ", !!stopBtn && !!b.querySelector("[data-cc-notify]"));
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
