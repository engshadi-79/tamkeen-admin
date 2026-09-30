/* إحصاءات شاشة العرض — من نظام المركز (tamkeen.ksach.org) إلى شاشة تمكين
   افتح النظام وأنت مسجّل دخولك، واضغط F12 ← تبويب Console، والصق هذا الملف كله واضغط Enter.
   سيطلب منك «رمز الشاشة» مرة واحدة (انسخه بزر «🔑 نسخ رمز الشاشة» في صفحة «شاشة إحصاءات المركز») ويحفظه.

   ماذا يفعل: يقرأ صفحات التقارير قراءةً فقط (طلبات GET)، ويحسب أرقاماً مجمّعة،
   ويرسلها إلى خادم تمكين، ثم يعيد ذلك كل ١٥ دقيقة ما دام هذا التبويب مفتوحاً.
   ويضع في لوحته زرّ «⬇ ملف المتأخرين» ينزّل على جهازك ملف Excel بأسماء من لم يوقّع
   التعهد ومن لم يعبّئ الاستبيان (الملف لا يمرّ بأي خادم).

   ما لا يفعل: لا يرسل أرقام هويات ولا جوالات — أسماء وأرقاماً مجمّعة فقط،
   ولا يضغط زراً ولا يفتح رابط تعديل أو حذف. */

(async () => {
  const TAMKEEN = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen";
  const EVERY = 15 * 60 * 1000;   // كل ربع ساعة
  const DELAY = 350;              // مهلة بين الطلبات حتى لا نثقل على الخادم
  const MAX_PAGES = 60;

  /* رمز الشاشة: يُطلب مرة واحدة ويُحفظ في هذا المتصفح
     (لمسحه: localStorage.removeItem("tamkeen-screen-key")) */
  const KEY_STORE = "tamkeen-screen-key";
  const goodKey = (k) => /^[a-f0-9]{16,}$/i.test(String(k || "").trim());
  let KEY = "";
  try { KEY = localStorage.getItem(KEY_STORE) || ""; } catch (e) { KEY = ""; }
  if (!goodKey(KEY)) {
    KEY = String(prompt("الصق رمز الشاشة (انسخه من صفحة «شاشة إحصاءات المركز» في موقع تمكين بزر 🔑):") || "").trim();
    if (!goodKey(KEY)) { alert("الرمز غير صحيح أو فارغ. انسخه من الموقع وأعد التشغيل."); return; }
    try { localStorage.setItem(KEY_STORE, KEY); } catch (e) { /* تخزين غير متاح */ }
  }

  const origin = location.origin;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660);

  /* الخانة قد تحوي أكثر من رقم («88% 176 / 200»)، فنأخذ أول رقم فيها لا أرقامها ملصقة.
     والشرطة الطويلة «—» تعني «لا قيمة»، لا رقماً سالباً. */
  function firstNum(v) {
    const s = toLatin(clean(v)).replace(/[–—]/g, " ");
    const m = s.match(/-?\d+(?:[.,]\d+)?/);
    return m ? Number(m[0].replace(",", ".")) : NaN;
  }
  const num = (v) => { const n = firstNum(v); return isNaN(n) ? 0 : n; };

  /* لوحة صغيرة تبيّن ما يجري */
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;bottom:16px;left:16px;width:380px;background:#0b1f3a;color:#fff;font:13px/1.7 Tahoma,Arial;border-radius:12px;padding:12px;direction:rtl;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  const BTN = "background:#0f8b8d;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit";
  box.innerHTML = `<b>📺 إحصاءات شاشة العرض</b>
    <div data-s style="margin-top:6px;white-space:pre-line"></div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <button data-csv style="${BTN}" disabled>⬇ ملف المتأخرين</button>
      <button data-stop style="background:#c0392b;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit">إيقاف</button>
    </div>`;
  document.body.appendChild(box);
  const say = (m) => { box.querySelector("[data-s]").textContent = m; };
  let stopped = false;
  box.querySelector("[data-stop]").addEventListener("click", () => { stopped = true; box.remove(); });

  /* آخر ما قُرئ بأسمائه كاملة: للملف على الجهاز فقط، لا يُرسل */
  let lastDetail = null;
  const csvBtn = box.querySelector("[data-csv]");
  csvBtn.addEventListener("click", () => {
    if (!lastDetail) return;
    const rows = [["النوع", "الاسم", "المسار", "المرحلة", "المجموعة", "الاستبيان"]];
    lastDetail.pledges.forEach((g) => (g.names || []).forEach((n) => rows.push(["لم يوقّع التعهد", n, g.track, g.course, g.group, ""])));
    lastDetail.surveys.forEach((g) => (g.names || []).forEach((n) => rows.push(["لم يعبّئ الاستبيان", n, g.track, g.course, g.group, g.form])));
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `المتأخرون-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  async function getDoc(path) {
    const res = await fetch(origin + path, { credentials: "include" });
    if (/login|signin/i.test(res.url)) throw new Error("انتهت الجلسة؛ ادخل من جديد وأعد التشغيل");
    if (!res.ok) throw new Error(`${res.status} عند ${path}`);
    await sleep(DELAY);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  /* عناوين الأعمدة: بعض التقارير لها صفّا عناوين (مجموعات وأعمدة فرعية)،
     فنفرد الشبكة حسب colspan/rowspan ونأخذ العنوان الورقي لكل عمود. */
  function headOf(table) {
    const trs = [...table.querySelectorAll("thead tr")];
    if (!trs.length) return [];
    if (trs.length === 1) return [...trs[0].children].map((c) => clean(c.textContent));
    const grid = [];
    trs.forEach((tr, r) => {
      let c = 0;
      [...tr.children].forEach((cellEl) => {
        while (grid[r] && grid[r][c] !== undefined) c++;
        const cs = Number(cellEl.colSpan) || 1;
        const rs = Number(cellEl.rowSpan) || 1;
        const text = clean(cellEl.textContent);
        for (let i = 0; i < rs; i++) {
          for (let j = 0; j < cs; j++) {
            grid[r + i] = grid[r + i] || [];
            grid[r + i][c + j] = text;
          }
        }
        c += cs;
      });
    });
    const leaf = grid[grid.length - 1] || [];
    const top = grid[0] || [];
    return leaf.map((v, i) => v || top[i] || "");
  }

  function tables(doc) {
    return [...doc.querySelectorAll("table")].map((t) => {
      let head = headOf(t);
      let trs = [...t.querySelectorAll("tr")].filter((r) => !r.closest("thead"));
      if (!head.length && trs.length) { head = [...trs[0].children].map((c) => clean(c.textContent)); trs = trs.slice(1); }
      const rows = trs.map((tr) => [...tr.children].map((c) => clean(c.textContent))).filter((r) => r.length > 1);
      return { head, rows };
    }).filter((t) => t.rows.length);
  }
  const pick = (list, ...need) => list.find((t) => need.every((re) => t.head.some((h) => re.test(h))));
  const at = (head, re) => head.findIndex((h) => re.test(h));
  const cell = (row, head, re) => { const i = at(head, re); return i < 0 ? "" : row[i]; };

  /* ===== تفكيك خانة «المسار / الدورة / المجموعة» بأشكالها في النظام =====
     «مسار الحلاقة الرجالية - G2»
     «مسار التجميل النسائي - كوافير المرحلة الثانية · G2»
     «مسار التطريز والخياطة المرحلة الاولى ·»
     «مسار الحلاقة الرجالية بدون دورة · بدون» */
  const PHASE_RE = /(?:المرحلة|الدورة)\s+[^·|,\-–—]+/;
  const GROUP_TAIL = /(?:^|[\s·\-])(G\s?\d+|المجموعة\s+\S+|مجموعة\s*\S*|الاولى|الأولى|الثانية|الثالثة|الرابعة)\s*$/;
  const NONE = /^(بدون|بلا|—|-)$/;

  function decompose(v) {
    let s = clean(v);
    let course = "";
    const p = s.match(PHASE_RE);
    if (p) {
      course = clean(p[0]);
      s = clean(s.slice(0, p.index) + " " + s.slice(p.index + p[0].length));
    }
    if (/بدون|بلا/.test(course)) course = "";
    let group = "";
    const bySep = s.split(/\s*·\s*|\s\/\s|\s\|\s/).map(clean).filter(Boolean);
    if (bySep.length > 1) {
      group = bySep.pop();
      s = bySep.join(" - ");
    } else {
      s = bySep[0] || "";
      const g = s.match(GROUP_TAIL);
      if (g) { group = clean(g[1]); s = clean(s.slice(0, g.index)); }
    }
    if (NONE.test(group)) group = "";
    const track = clean(s).replace(/[·\-–—]+$/, "").trim();
    return { track, course, group };
  }

  /* اسم الطالب ورقم هويته من خانة «الطالب»: الرقم للمطابقة داخل المتصفح فقط ولا يُرسل */
  /* خانة «المجموعة / المدرب» قد تكون سطرين يلتصقان بعد التنظيف:
     «المجموعة الاولى اسراء خليل مرشد» — فنأخذ اسم المجموعة وحده والباقي مدرّبها. */
  const GROUP_HEAD = /^\s*(بدون\s+مجموعة|غير\s+موزع|المجموعة\s+\S+|مجموعة\s+\S+|G\s?\d+|الاولى|الأولى|الثانية|الثالثة|الرابعة)/;
  const NO_GROUP = /^(بدون\s*مجموعة|غير\s*موزع|بدون|—|-)$/;
  function groupAndTrainer(v) {
    const s = clean(v);
    const m = s.match(GROUP_HEAD);
    if (m) {
      const g = clean(m[1]);
      // «بدون مجموعة» و«غير موزع» ليست مجموعات: تُترك فارغة فلا تظهر في القوائم
      return { group: NO_GROUP.test(g) ? "" : g, trainer: clean(s.slice(m[0].length)).replace(/^[\/|·\-–—,،\s]+/, "") };
    }
    const p = s.split(/\s\/\s|\s\|\s|\s·\s/).map(clean).filter(Boolean);
    return { group: p[0] || "", trainer: p[1] || "" };
  }

  const NAME_CUT = /STU-[\d-]+|\b\d{6,}\b|[|·]/;
  const nameOf = (v) => clean(String(clean(v)).split(NAME_CUT)[0]).replace(/[-–—,،]+$/, "").trim();
  const nidOf = (v) => (toLatin(clean(v)).match(/\b\d{9}\b/) || [""])[0];
  const NAMES_MAX = 80;   // أكثر ما يُرسل من الأسماء لكل مجموعة

  /* كل صفحات جدول واحد: تتوقف عند الفراغ أو تكرار أول صف */
  async function eachPage(path, label, need, onRows) {
    let seenFirst = "";
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (stopped) return;
      const sep = path.includes("?") ? "&" : "?";
      const doc = await getDoc(`${path}${sep}page=${page}`);
      const t = pick(tables(doc), ...need);
      if (!t || !t.rows.length) return;
      const first = t.rows[0].join("|");
      if (first === seenFirst) return;
      seenFirst = first;
      say(`${label} — صفحة ${page}`);
      onRows(t);
    }
  }

  const debug = (label, t) => {
    if (!window.TAMKEEN_DEBUG || !t) return;
    console.log("🔎 " + label, { head: t.head, firstRow: t.rows[0] });
  };

  /* ===== ١) المسارات والسعة والطلبات (لوحة التحكم) ===== */
  async function readTracks() {
    const doc = await getDoc("/admin/dashboard");
    const t = pick(tables(doc), /المسار/, /المقاعد/, /طلاب|الطلاب/);
    debug("واقع المسارات والسعة", t);
    if (!t) return [];
    return t.rows.map((r) => {
      const seats = num(cell(r, t.head, /المقاعد/));
      const students = num(cell(r, t.head, /^طلاب$|الطلاب/));
      const fill = num(cell(r, t.head, /إشغال/));
      return {
        track: decompose(cell(r, t.head, /المسار/)).track,
        seats, students,
        applications: num(cell(r, t.head, /الطلبات/)),
        accepted: num(cell(r, t.head, /مقبول/)),
        waiting: num(cell(r, t.head, /انتظار/)),
        groups: num(cell(r, t.head, /مجموعات/)),
        fill: fill > 0 && fill <= 100 ? fill : (seats ? Math.round((students / seats) * 100) : 0),
      };
    }).filter((r) => r.track && !/الإجمالي|^المجموع/.test(r.track));
  }

  /* ===== ٢) الحضور والمجموعات والمدربون (تقرير التدريب) ===== */
  async function readTraining() {
    const doc = await getDoc("/admin/reports/training");
    const list = tables(doc);
    const att = pick(list, /المجموعة/, /غياب/);
    const tr = pick(list, /^المدرب$/, /^الجلسات$/, /الساعات/);
    const gr = pick(list, /المجموعة/, /إنجاز/);
    debug("أداء المجموعات", gr);
    debug("الحضور حسب المجموعة", att);

    const groups = gr ? gr.rows.map((r) => {
      const gt = groupAndTrainer(cell(r, gr.head, /المجموعة/));
      const a = decompose(gt.group);
      const b = decompose(cell(r, gr.head, /المسار/));
      return {
        group: a.group || a.track || gt.group || b.group,
        track: b.track || a.track,
        course: b.course || a.course,
        trainer: clean(cell(r, gr.head, /المدرب/)) || gt.trainer,
        students: num(cell(r, gr.head, /الطلاب/)),
      };
    }).filter((r) => r.group) : [];

    const attendance = att ? att.rows.map((r) => {
      const raw = cell(r, att.head, /المجموعة/);
      const a = decompose(raw);
      if (!a.group) { const gt = groupAndTrainer(raw); if (gt.group) a.group = gt.group; }
      const total = num(cell(r, att.head, /إجمالي/));
      const present = num(cell(r, att.head, /حاضر/));
      const absent = num(cell(r, att.head, /غياب/));
      const rate = num(cell(r, att.head, /معدل/));
      return {
        group: a.group || a.track, track: a.track, course: a.course,
        total, present, absent,
        rate: rate > 0 && rate <= 100 ? rate : (total ? Math.round((present / total) * 100) : 0),
      };
    }).filter((r) => r.group) : [];

    const trainers = tr ? tr.rows.map((r) => ({
      name: clean(cell(r, tr.head, /المدرب/)),
      sessions: num(cell(r, tr.head, /الجلسات/)),
      done: num(cell(r, tr.head, /مكتمل/)),
      hours: num(cell(r, tr.head, /الساعات/)),
    })).filter((r) => r.name && r.name !== "-") : [];

    /* ما نقص من المرحلة أو المدرب في جدول يُكمَّل من الجدول الآخر.
       المفتاح «المسار + المجموعة» لأن G1 و G2 متكررتان في كل المسارات. */
    const byPair = new Map();   // مسار|مجموعة
    const byName = new Map();   // مجموعة وحدها، ولا تُستعمل إلا إن كانت في مسار واحد
    [...groups, ...attendance].forEach((r) => {
      if (!r.group) return;
      if (r.track) {
        const k = r.track + "|" + r.group;
        const cur = byPair.get(k) || {};
        byPair.set(k, { course: cur.course || r.course, trainer: cur.trainer || r.trainer });
      }
      const seen = byName.get(r.group);
      if (!seen) byName.set(r.group, { track: r.track, course: r.course, trainer: r.trainer, one: true });
      else if (r.track && seen.track && r.track !== seen.track) seen.one = false;
    });
    [...groups, ...attendance].forEach((r) => {
      const pair = (r.track && byPair.get(r.track + "|" + r.group)) || null;
      const solo = byName.get(r.group);
      const info = pair || (solo && solo.one ? solo : {});
      r.track = r.track || (solo && solo.one ? solo.track : "") || "";
      r.course = r.course || info.course || "";
      if (r.trainer !== undefined) r.trainer = r.trainer || info.trainer || "";
    });

    return { attendance, trainers, groups };
  }

  /* ===== ٣) الدرجات (سجل الدرجات، صفحة صفحة) ===== */
  async function readGrades() {
    const per = new Map();
    let approved = 0, pending = 0, total = 0, graded = 0, sumAll = 0, passed = 0, failed = 0;
    await eachPage("/admin/student-grades", "الدرجات", [/الطالب/, /^المجموع$/], (t) => {
      debug("سجل الدرجات", t);
      t.rows.forEach((r) => {
        const score = firstNum(cell(r, t.head, /^المجموع$/));
        const has = !isNaN(score);
        const d = decompose(cell(r, t.head, /المسار/));
        const status = cell(r, t.head, /^الحالة$/);
        const appr = cell(r, t.head, /^الاعتماد$/);
        total++;
        if (has) { graded++; sumAll += score; }
        if (/ناجح/.test(status)) passed++;
        else if (/راسب|رسوب/.test(status)) failed++;
        if (/معتمد/.test(appr) && !/غير/.test(appr)) approved++; else pending++;
        if (d.track) {
          const key = `${d.track}|${d.course}|${d.group}`;
          const g = per.get(key) || { track: d.track, course: d.course, group: d.group, sum: 0, count: 0, graded: 0, passed: 0, failed: 0, approved: 0, pending: 0 };
          g.count++;
          if (has) { g.graded++; g.sum += score; }
          if (/ناجح/.test(status)) g.passed++;
          else if (/راسب|رسوب/.test(status)) g.failed++;
          if (/معتمد/.test(appr) && !/غير/.test(appr)) g.approved++; else g.pending++;
          per.set(key, g);
        }
      });
    });
    let awaitingGrading = 0;
    try {
      const doc = await getDoc("/admin/exam-manual-grading");
      const t = pick(tables(doc), /الطالب/, /الاختبار/);
      awaitingGrading = t ? t.rows.filter((r) => clean(r.join("")).length > 3).length : 0;
    } catch (e) { /* صفحة غير متاحة لهذا المستخدم */ }
    return {
      average: graded ? Math.round(sumAll / graded) : 0,
      passed, failed, approved, pending, awaitingGrading, students: total, graded,
      tracks: [...per.values()].map((g) => ({
        track: g.track, course: g.course, group: g.group,
        average: g.graded ? Math.round(g.sum / g.graded) : 0,
        count: g.count, graded: g.graded,
        passed: g.passed, failed: g.failed, approved: g.approved, pending: g.pending,
      })),
    };
  }

  /* المدة التي اختارها المستخدم في شاشة تمكين (من / إلى) */
  let period = null;
  async function readPeriod() {
    try {
      const res = await fetch(TAMKEEN, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "statsPeriod", key: KEY }),
      });
      const out = await res.json();
      period = out && out.period && (out.period.from || out.period.to) ? out.period : null;
    } catch (e) { /* الشبكة: تبقى المدة السابقة */ }
    return period;
  }

  /* ===== ٤) خصائص المتدربين (تقرير إحصاءات حضور المسارات) ===== */
  async function readPeople() {
    const base = "/admin/reports/track-attendance-statistics";
    let path = base;
    const firstDoc = await getDoc(base);
    // حقول التاريخ في التقرير نفسه: نملأها بالمدة المطلوبة إن وُجدت
    const dateFields = [...firstDoc.querySelectorAll("input[name]")]
      .filter((i) => i.type === "date" || /date|from|to|start|end|تاريخ|من|إلى/i.test(i.getAttribute("name") || ""))
      .map((i) => i.getAttribute("name"));
    if (window.TAMKEEN_DEBUG) console.log("🔎 حقول تاريخ التقرير", dateFields);
    if (period && dateFields.length) {
      const q = [];
      const fromField = dateFields.find((n) => /from|start|_from|من/i.test(n)) || dateFields[0];
      const toField = dateFields.find((n) => n !== fromField && /to|end|_to|إلى/i.test(n)) || dateFields[1];
      if (period.from && fromField) q.push(`${encodeURIComponent(fromField)}=${encodeURIComponent(period.from)}`);
      if (period.to && toField) q.push(`${encodeURIComponent(toField)}=${encodeURIComponent(period.to)}`);
      if (q.length) path = `${base}?${q.join("&")}`;
    }
    const doc = path === base ? firstDoc : await getDoc(path);
    const t = pick(tables(doc), /المسار/);
    debug("إحصاءات حضور المسارات", t);
    if (!t) return [];
    return t.rows.map((r) => {
      const male = num(cell(r, t.head, /^ذكر/));
      const female = num(cell(r, t.head, /^أنثى|^انثى/));
      const counted = num(cell(r, t.head, /عدد الحضور|^المجموع$/));
      return {
        track: decompose(cell(r, t.head, /المسار/)).track,
        count: counted || male + female,
        male, female,
        healthy: num(cell(r, t.head, /^سليم/)),
        disabled: num(cell(r, t.head, /إعاقة/)),
        single: num(cell(r, t.head, /^أعزب|^اعزب/)),
        married: num(cell(r, t.head, /^متزوج/)),
      };
    }).filter((r) => r.track && !/^المجموع|الإجمالي|الاجمالي/.test(r.track));
  }

  /* قائمة الطلاب: الاسم والمجموعة (والهوية للمطابقة داخل المتصفح، ولا تُرسل).
     إن لم تعرض الصفحة صفوفاً بلا فلتر، نمرّ على خيارات فلتر الدورة. */
  async function readStudents() {
    const out = [];
    const seen = new Set();
    const eat = (t) => {
      debug("قائمة الطلاب", t);
      t.rows.forEach((r) => {
        const raw = cell(r, t.head, /الطالب/);
        const name = nameOf(raw);
        if (!name) return;
        // عمود «المسار / الدورة» وعمود «المجموعة / المدرب» منفصلان: يُقرأ كلٌّ من مكانه
        const dt = decompose(cell(r, t.head, /المسار/));
        const gt = groupAndTrainer(cell(r, t.head, /المجموعة/));
        const dg = decompose(gt.group);
        const group = dg.group || dg.track || gt.group;
        const nid = nidOf(raw);
        const id = nid || name + "|" + group;
        if (seen.has(id)) return;
        seen.add(id);
        out.push({
          name, nid, group,
          track: dt.track || dg.track,
          course: dt.course || dg.course || clean(cell(r, t.head, /الدورة|المرحلة/)),
        });
      });
    };

    const first = await getDoc("/admin/students");
    const t0 = pick(tables(first), /الطالب/);
    if (window.TAMKEEN_DEBUG) {
      console.log("🔎 فلاتر صفحة الطلاب", [...first.querySelectorAll("select[name]")].map((sel) => ({
        name: sel.getAttribute("name"),
        options: [...sel.options].filter((o) => o.value).map((o) => clean(o.textContent)),
      })));
    }
    if (t0 && t0.rows.length) {
      await eachPage("/admin/students", "الطلاب", [/الطالب/], eat);
      if (out.length) return out;
    }

    // لا صفوف بلا فلتر: نقرأ كل دورة على حدة
    const sel = [...first.querySelectorAll("select[name]")]
      .find((s) => /course|training|دورة|مرحلة/i.test(s.getAttribute("name") || ""));
    if (sel) {
      const opts = [...sel.options].filter((o) => o.value);
      for (let i = 0; i < opts.length && !stopped; i++) {
        const label = clean(opts[i].textContent);
        say(`الطلاب — ${label.slice(0, 26)} (${i + 1}/${opts.length})`);
        await eachPage(`/admin/students?${encodeURIComponent(sel.getAttribute("name"))}=${encodeURIComponent(opts[i].value)}`,
          `طلاب ${i + 1}/${opts.length}`, [/الطالب/], eat);
      }
    }
    return out;
  }

  /* ===== ٥) المتابعات: من لم يقدّم تعهداً، ومن لم يعبّئ الاستبيان ===== */
  async function readFollowUps(groups) {
    const pledged = new Map();
    const signed = new Set();   // هويات وأسماء من وقّع، للمطابقة داخل المتصفح
    const keyOf = (d) => `${d.track}|${d.group}`;
    try {
      await eachPage("/admin/student-pledges", "التعهدات", [/الطالب/, /تاريخ الاعتماد/], (t) => {
        debug("تعهدات الطلاب", t);
        t.rows.forEach((r) => {
          const raw = cell(r, t.head, /الطالب/);
          const d = decompose(cell(r, t.head, /المسار|المجموعة/));
          const k = keyOf(d);
          const g = pledged.get(k) || { track: d.track, course: d.course, group: d.group, pledged: 0 };
          g.pledged++;
          pledged.set(k, g);
          const nid = nidOf(raw);
          if (nid) signed.add(nid);
          const nm = nameOf(raw);
          if (nm) signed.add("n:" + nm);
        });
      });
    } catch (e) { console.warn("التعهدات:", e.message); }

    /* أسماء من لم يوقّع: كل الطلاب ناقص الموقّعين (المطابقة بالهوية، وإلا بالاسم) */
    const namesByGroup = new Map();
    let students = [];
    try {
      students = await readStudents();
      students.forEach((s) => {
        if ((s.nid && signed.has(s.nid)) || signed.has("n:" + s.name)) return;
        const k = `${s.track}|${s.group}`;
        const list = namesByGroup.get(k) || [];
        list.push(s.name);
        namesByGroup.set(k, list);
      });
    } catch (e) { console.warn("الطلاب:", e.message); }

    const pledges = [];
    const used = new Set();
    (groups || []).forEach((g) => {
      if (!g.group) return;   // حاوية بلا مجموعة: لا تُحسب
      const k = keyOf(g);
      const done = (pledged.get(k) || {}).pledged || 0;
      used.add(k);
      const names = namesByGroup.get(k) || [];
      pledges.push({
        track: g.track || "", course: g.course || "", group: g.group,
        students: num(g.students), pledged: done,
        missing: names.length || Math.max(0, num(g.students) - done),
        names: names.slice(0, NAMES_MAX),
      });
    });
    pledged.forEach((v, k) => {
      if (used.has(k)) return;
      const names = namesByGroup.get(k) || [];
      pledges.push({ track: v.track, course: v.course, group: v.group, students: 0, pledged: v.pledged, missing: names.length, names: names.slice(0, NAMES_MAX) });
    });
    // مجموعات لها متأخرون ولم تُذكر في تقرير التدريب
    namesByGroup.forEach((names, k) => {
      if (pledges.some((p) => `${p.track}|${p.group}` === k)) return;
      const [track, group] = k.split("|");
      pledges.push({ track, course: "", group, students: 0, pledged: 0, missing: names.length, names: names.slice(0, NAMES_MAX) });
    });

    /* تقرير «الاستبيانات غير المعبّأة» لا يعرض صفوفاً حتى يُختار استبيان،
       فنقرأ فلاتر الصفحة نفسها ونمرّ على خياراتها واحداً واحداً. */
    const surveys = new Map();
    let formName = "";   // اسم الاستبيان الجاري، يُستعمل إن لم يذكره الجدول
    const SURVEY_PATH = "/admin/reports/evaluation-missing-submissions";
    const eatRows = (t) => {
      debug("الاستبيانات غير المعبّأة", t);
      t.rows.forEach((r) => {
        const g = decompose(cell(r, t.head, /المجموعة/));
        const trk = decompose(cell(r, t.head, /^المسار/));
        const course = clean(cell(r, t.head, /الدورة|المرحلة/)) || g.course || trk.course;
        const group = g.group || g.track;
        const form = clean(cell(r, t.head, /الاستبيان|النموذج|التقييم/)) || formName;
        if (!group && !trk.track) return;
        const key = `${trk.track}|${course}|${group}|${form}`;
        const s = surveys.get(key) || { track: trk.track, course, group, form, missing: 0, names: [] };
        s.missing++;
        const nm = nameOf(cell(r, t.head, /الطالب/));
        if (nm && s.names.length < NAMES_MAX) s.names.push(nm);
        surveys.set(key, s);
      });
    };
    try {
      const first = await getDoc(SURVEY_PATH);
      const selects = [...first.querySelectorAll("select[name]")].map((sel) => ({
        name: sel.getAttribute("name"),
        options: [...sel.options].filter((o) => o.value).map((o) => ({ value: o.value, text: clean(o.textContent) })),
      }));
      if (window.TAMKEEN_DEBUG) console.log("🔎 فلاتر تقرير الاستبيانات", selects);
      const found = pick(tables(first), /الطالب/, /الاستبيان/);
      if (found && found.rows.length) eatRows(found);

      // القائمة التي تختار الاستبيان (النموذج): نمرّ على خياراتها
      const forms = selects.find((s) => /form|evaluation|استبيان|نموذج/i.test(s.name));
      if (forms && forms.options.length) {
        const list = forms.options.slice(0, 30);
        for (let i = 0; i < list.length && !stopped; i++) {
          const o = list[i];
          say(`الاستبيانات — ${i + 1} من ${list.length}: ${o.text.slice(0, 28)}`);
          formName = o.text;
          await eachPage(`${SURVEY_PATH}?${encodeURIComponent(forms.name)}=${encodeURIComponent(o.value)}`,
            `استبيان ${i + 1}/${list.length}`, [/الطالب/, /الاستبيان/], eatRows);
        }
      } else if (!found || !found.rows.length) {
        await eachPage(SURVEY_PATH, "الاستبيانات", [/الطالب/, /الاستبيان/], eatRows);
      }
    } catch (e) { console.warn("الاستبيانات:", e.message); }

    const surveyRows = [...surveys.values()];
    // نسخة كاملة الأسماء تبقى في المتصفح للملف، والمرسَل محدود بـ NAMES_MAX
    const full = {
      pledges: pledges.map((p) => ({ ...p, names: (namesByGroup.get(`${p.track}|${p.group}`) || []).slice() })),
      surveys: surveyRows.map((s) => ({ ...s, names: (s.names || []).slice() })),
    };
    return { pledges, surveys: surveyRows, full };
  }

  /* ===== الإرسال ===== */
  async function push(data) {
    const res = await fetch(TAMKEEN, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "statsPush", key: KEY, by: "نظام المركز", data }),
    });
    const out = await res.json();
    if (out.error) throw new Error(out.error);
    return out;
  }

  async function round() {
    say("قراءة المدة المطلوبة…");
    await readPeriod();
    say("قراءة المسارات والسعة…");
    const tracks = await readTracks();
    say("قراءة الحضور والمدربين…");
    const training = await readTraining();
    say("قراءة الدرجات…");
    const grades = await readGrades();
    say("قراءة خصائص المتدربين…");
    const demographics = await readPeople();
    say("قراءة التعهدات والاستبيانات…");
    const followUps = await readFollowUps(training.groups);
    lastDetail = followUps.full || { pledges: followUps.pledges, surveys: followUps.surveys };
    csvBtn.disabled = false;
    delete followUps.full;   // لا تُرسل النسخة الكاملة
    const data = { tracks, attendance: training.attendance, trainers: training.trainers, groups: training.groups, grades, demographics, followUps, period };
    say("إرسال إلى شاشة تمكين…");
    await push(data);
    const when = new Date().toLocaleTimeString("ar-EG");
    const noPledge = followUps.pledges.reduce((a, r) => a + r.missing, 0);
    const noSurvey = followUps.surveys.reduce((a, r) => a + r.missing, 0);
    const span = period ? `\nمدة الإحصاء: ${period.from || "—"} إلى ${period.to || "—"}` : "";
    say(`أُرسلت ✔ ${when}\n${tracks.length} مساراً · ${training.groups.length} مجموعة · ${grades.students} درجة\nبلا تعهد ${noPledge} · بلا استبيان ${noSurvey}${span}\nللأسماء على جهازك: زر «⬇ ملف المتأخرين»\nالتحديث القادم بعد ١٥ دقيقة`);
  }

  for (let once = 0; !stopped; once++) {
    try {
      await round();
    } catch (e) {
      say("تعذّر التحديث: " + e.message + "\nسيُعاد بعد ١٥ دقيقة");
      console.warn("إحصاءات الشاشة:", e);
    }
    for (let i = 0; i < EVERY / 1000 && !stopped; i++) await sleep(1000);
  }
})();
