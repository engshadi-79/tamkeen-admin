/* جدول الاختبارات: قالب Word الرسمي + ملف طلبة ← جدول لكل مسار.

   الطريقة: يُستنسخ ملف القالب كما هو (ترويسته وخطوطه وحدوده وتظليله)،
   ولا يُعاد بناء إلا صفوف الجداول. فيخرج الناتج مطابقاً للنموذج حرفياً
   بدل محاولة تقليده.

   في النموذج: جدول لكل مجموعة، صفّه الأول «المجموعة … | الاختبار النظري |
   الاختبار العملي»، وتحته أعمدة: م، اسم الطالب، رقم الهوية، ثم اليوم
   والتاريخ والساعة مرّتين. موعد النظري يُكتب في أول صف، ومواعيد العملي
   تُكتب واحداً تحت الآخر في عموديه. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const ORDINAL = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const dayOf = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? "" : DAYS[d.getDay()]; };
  const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

  const state = {
    tplBuf: null, tplName: "", tplSavedId: "",
    attBuf: null, attName: "", attSavedId: "",
    rows: [], headers: [],
    map: { name: "", nid: "", track: "", group: "" },
    oneFile: false,      // كل المسارات في ملف واحد
    withAtt: true,       // كشوف الحضور مع الجداول
    stage: "",           // المرحلة، تُكتب في عمود «المرحلة» بكشف الحضور
    trainers: {},        // لكل مسار: أسماء المدربين
    plan: {},            // لكل مجموعة: { theory:{date,time}, practical:[{date,time}] }
  };
  const trainersOf = (track) => (state.trainers[track] || "").split(/[,،\n]/).map(clean).filter(Boolean);

  /* المواعيد تُحدَّد لكل مجموعة داخل المسار، كما في النموذج:
     المجموعة الأولى لها نظريّها ومواعيد عمليها، والثانية غيرها. */
  const planKey = (track, group) => `${track}\u0000${group}`;
  function planOf(track, group) {
    const k = planKey(track, group);
    if (!state.plan[k]) state.plan[k] = { theory: { date: "", time: "" }, practical: [] };
    return state.plan[k];
  }

  /* ===== قراءة ملف الطلبة ===== */
  const GUESS = {
    name: [/^اسم الطالب$/, /^اسم المتقدم$/, /^الاسم$/, /اسم/],
    nid: [/^رقم الهوية$/, /هوي/],
    track: [/^المسار$/, /^المسار الحالي$/, /مسار/],
    group: [/^المجموعة$/, /^المجموعة الحالية$/, /مجموع|شعب/],
  };
  function guess(headers, key) {
    for (const re of GUESS[key]) { const h = headers.find((x) => re.test(clean(x))); if (h) return h; }
    return "";
  }

  /* ===== أدوات XML ===== */
  const tag = (el, name) => [...el.getElementsByTagNameNS(W, name)];
  const firstTag = (el, name) => el.getElementsByTagNameNS(W, name)[0] || null;

  /* يكتب نصاً في خلية مع إبقاء تنسيقها: يُستبقى أول نصّ ويُحذف ما بعده.
     خلايا الاسم والهوية فارغة في القالب — فلا نمط حرف فيها — فيُستعار
     نمط من خلية «م» في الصف نفسه حتى يبقى الخط والحجم كما في النموذج. */
  function setCell(tc, text, donor) {
    const ps = tag(tc, "p");
    if (!ps.length) return;
    const p = ps[0];
    let runs = tag(p, "r");
    if (!runs.length) {
      if (!donor) return;
      p.appendChild(donor.cloneNode(true));
      runs = tag(p, "r");
    }
    const keep = runs[0];
    runs.slice(1).forEach((r) => r.parentNode.removeChild(r));
    const ts = tag(keep, "t");
    if (!ts.length) return;
    ts.slice(1).forEach((t) => t.parentNode.removeChild(t));
    ts[0].textContent = text;
    ts[0].setAttribute("xml:space", "preserve");
    // فقرات زائدة في الخلية تُحذف حتى لا يرتفع الصف
    ps.slice(1).forEach((x) => x.parentNode.removeChild(x));
  }
  const cellsOf = (tr) => [...tr.children].filter((c) => c.localName === "tc");

  /* ترتيب عناصر ‎<w:tcPr>‎ مُلزِم في مخطط OOXML؛ الإدراج في غير موضعه يُفسد الملف */
  const TCPR_ORDER = ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd",
    "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"];
  function tcPrOf(doc, tc) {
    let pr = firstTag(tc, "tcPr");
    if (!pr) { pr = doc.createElementNS(W, "w:tcPr"); tc.insertBefore(pr, tc.firstChild); }
    return pr;
  }
  function putInPr(doc, tc, name, val) {
    const pr = tcPrOf(doc, tc);
    [...pr.children].filter((c) => c.localName === name).forEach((c) => pr.removeChild(c));
    const el = doc.createElementNS(W, "w:" + name);
    if (val) el.setAttribute("w:val", val);
    const rank = TCPR_ORDER.indexOf(name);
    const after = [...pr.children].find((c) => TCPR_ORDER.indexOf(c.localName) > rank);
    pr.insertBefore(el, after || null);
  }
  function dropFromPr(doc, tc, name) {
    const pr = firstTag(tc, "tcPr");
    if (pr) [...pr.children].filter((c) => c.localName === name).forEach((c) => pr.removeChild(c));
  }
  /* حدود الخلية: ترتيب الجهات داخل ‎<w:tcBorders>‎ مُلزِم هو الآخر */
  const SIDES = ["top", "left", "bottom", "right", "insideH", "insideV", "tl2br", "tr2bl"];
  function setBorder(doc, tc, side, val) {
    const pr = tcPrOf(doc, tc);
    let bs = firstTag(tc, "tcBorders");
    if (!bs) {
      bs = doc.createElementNS(W, "w:tcBorders");
      const rank = TCPR_ORDER.indexOf("tcBorders");
      pr.insertBefore(bs, [...pr.children].find((c) => TCPR_ORDER.indexOf(c.localName) > rank) || null);
    }
    [...bs.children].filter((c) => c.localName === side).forEach((c) => bs.removeChild(c));
    const el = doc.createElementNS(W, "w:" + side);
    el.setAttribute("w:val", val);
    if (val !== "nil") {
      el.setAttribute("w:sz", "4"); el.setAttribute("w:space", "0"); el.setAttribute("w:color", "auto");
    }
    const rank = SIDES.indexOf(side);
    bs.insertBefore(el, [...bs.children].find((c) => SIDES.indexOf(c.localName) > rank) || null);
  }

  /* يدمج خلايا عمود واحد من الصف a حتى b (غير شامل) في خلية واحدة متوسطة رأسياً،
     فتبقى القيمة في منتصف العمود مهما طال. صفّ القالب نفسه يحمل
     ‎vMerge restart‎ في أعمدة المواعيد، فلا بدّ من ضبط كل صف صراحةً. */
  function mergeDown(doc, cells, a, b) {
    if (b - a <= 0) return;
    putInPr(doc, cells[a], "vAlign", "center");
    if (b - a > 1) putInPr(doc, cells[a], "vMerge", "restart");
    else dropFromPr(doc, cells[a], "vMerge");
    for (let i = a + 1; i < b; i++) {
      putInPr(doc, cells[i], "vMerge", "continue");
      tag(cells[i], "r").forEach((r) => r.parentNode.removeChild(r));
    }
    setBorder(doc, cells[b - 1], "bottom", "single");   // يُغلق أسفل الكتلة
  }
  /* خلية مستقلة بحدّ أسفلها، كصفوف المواعيد العملية في النموذج */
  function standalone(doc, tc) {
    dropFromPr(doc, tc, "vMerge");
    putInPr(doc, tc, "vAlign", "center");
    setBorder(doc, tc, "top", "nil");
    setBorder(doc, tc, "bottom", "single");
  }

  /* فقرة فاصل صفحات: ‎<w:br w:type="page"/>‎ */
  function pageBreak(doc) {
    const p = doc.createElementNS(W, "w:p");
    const r = doc.createElementNS(W, "w:r");
    const br = doc.createElementNS(W, "w:br");
    br.setAttribute("w:type", "page");
    r.appendChild(br);
    p.appendChild(r);
    return p;
  }

  /* يكتب نصاً في فقرة مع إبقاء تنسيقها */
  function setPara(p, text) {
    const t = tag(p, "t");
    if (!t.length) return;
    t.slice(1).forEach((x) => { x.textContent = ""; });
    t[0].textContent = text;
    t[0].setAttribute("xml:space", "preserve");
  }

  /* ===== بناء الملف =====
     list: ‎[{ track, groups }]‎ — مسار واحد، أو عدة مسارات ورى بعض في ملف واحد */
  async function build(list) {
    const zip = await JSZip.loadAsync(state.tplBuf);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = firstTag(doc.documentElement, "body");
    const kids = [...body.children];
    const tables = kids.filter((k) => k.localName === "tbl");
    if (!tables.length) throw new Error("القالب بلا جداول — تأكّد أنه «قالب جدول الاختبارات»");
    const proto = tables[0];

    // الصفوف النموذجية من الجدول الأول
    const pr = [...proto.children].filter((c) => c.localName === "tr");
    const rowGroup = pr[0], rowHead = pr[1], rowData = pr[2];
    const paras = kids.filter((k) => k.localName === "p");
    const sig = paras[paras.length - 1];
    // فقرة «اسم المسار» نموذج يُستنسخ لكل مسار
    const trackProto = (paras.find((p) => /اسم المسار/.test(tag(p, "t").map((x) => x.textContent).join("")))
      || paras[1]).cloneNode(true);

    // يبقى العنوان الأعلى والتذييل فقط، وما عداهما يُعاد بناؤه
    const title = paras[0];
    const sectPr = kids.find((k) => k.localName === "sectPr");
    kids.forEach((k) => { if (k !== sectPr && k !== title && k !== sig) body.removeChild(k); });

    let firstPage = true;
    list.forEach(({ track, groups }) => {
      groups.forEach((g, gi) => {
        if (!firstPage) body.insertBefore(pageBreak(doc), sig);   // كل مجموعة في صفحة
        if (!gi) {
          const tp = trackProto.cloneNode(true);
          setPara(tp, `اسم المسار : ${track}`);
          body.insertBefore(tp, sig);
        }
        firstPage = false;
        buildTable(doc, { proto, rowGroup, rowHead, rowData }, track, g, gi, body, sig);
      });
    });

    // التوقيع كان يفصله عن الجدول في النموذج فقرات فارغة حُذفت، فيُعاد الفاصل
    body.insertBefore(doc.createElementNS(W, "w:p"), sig);
    body.insertBefore(doc.createElementNS(W, "w:p"), sig);

    return pack(zip, doc);
  }

  /* XMLSerializer يُخرج ترويسة ‎<?xml?>‎ بنفسه؛ إضافة ثانية تجعل Word يرفض الملف */
  function pack(zip, doc) {
    let outXml = new XMLSerializer().serializeToString(doc);
    if (!outXml.startsWith("<?xml")) {
      outXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + outXml;
    }
    zip.file("word/document.xml", outXml, { createFolders: false });
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  function buildTable(doc, protos, track, g, gi, body, sig) {
    const { proto, rowGroup, rowHead, rowData } = protos;
    {
      const plan = planOf(track, g.name);
      const tbl = proto.cloneNode(true);
      [...tbl.children].filter((c) => c.localName === "tr").forEach((tr) => tbl.removeChild(tr));
      // صفّ المجموعة
      const gr = rowGroup.cloneNode(true);
      setCell(cellsOf(gr)[0], `المجموعة ${ORDINAL[gi] || gi + 1}`);
      tbl.appendChild(gr);
      tbl.appendChild(rowHead.cloneNode(true));
      // صفوف الطلبة، وأعمدة المواعيد تُترك فارغة ثم تُملأ ودمجاً فيما بعد
      const rows = g.students.map((s, i) => {
        const tr = rowData.cloneNode(true);
        const c = cellsOf(tr);
        const donor = tag(c[0], "r")[0] || null;
        setCell(c[0], String(i + 1), donor);
        setCell(c[1], s.name, donor);
        setCell(c[2], s.nid, donor);
        for (let k = 3; k <= 8; k++) setCell(c[k], "", donor);
        tbl.appendChild(tr);
        return tr;
      });

      /* النظري موعد واحد في خلية تمتد على صفوف المجموعة كلها ومتوسّطة فيها.
         والعملي مواعيد متتالية صفاً تحت صف، وكتلتها في منتصف العمود — كما في
         النموذج: ثلاثة مواعيد في الصفوف 11–13 من 23. */
      const N = rows.length;
      const col = (ci) => rows.map((tr) => cellsOf(tr)[ci]);
      const write = (cols, i, day, date, time) => {
        const donor = tag(cellsOf(rows[i])[0], "r")[0] || null;
        const c = cols.map((ci) => col(ci)[i]);
        setCell(c[0], day, donor); setCell(c[1], date, donor); setCell(c[2], time, donor);
      };
      if (N) {
        const ps = (plan.practical || []).slice(0, N);
        const a = ps.length ? Math.max(0, Math.round((N - ps.length) / 2)) : 0;
        const b = ps.length ? a + ps.length : N;

        // النظري: خلية واحدة تمتد على كتلة المواعيد العملية نفسها فتتوسّطها
        const th = plan.theory || {};
        write([3, 4, 5], a, dayOf(th.date), fmtDate(th.date), clean(th.time));
        [3, 4, 5].forEach((ci) => {
          const cells = col(ci);
          mergeDown(doc, cells, 0, a);
          mergeDown(doc, cells, a, b);
          mergeDown(doc, cells, b, N);
        });

        // العملي: صفوف متتالية بحدودها، وفوقها وتحتها فراغ مدموج
        ps.forEach((p, j) => write([6, 7, 8], a + j, dayOf(p.date), fmtDate(p.date), clean(p.time)));
        [6, 7, 8].forEach((ci) => {
          const cells = col(ci);
          mergeDown(doc, cells, 0, a);
          ps.forEach((p, j) => standalone(doc, cells[a + j]));
          mergeDown(doc, cells, b, N);
        });
      }
      body.insertBefore(tbl, sig);
    }
  }

  /* ===== كشف الحضور والغياب =====
     النموذج صفحة واحدة: عنوان فيه اسم المسار، سطر اليوم والتاريخ، جدول
     بأسماء الطلبة، ثم أسماء المدربين بتوقيعاتهم. تُستنسخ الصفحة كاملةً
     لكل موعد امتحان (النظري ثم كل موعد عملي)، بترتيب الأسماء نفسه. */
  const runText = (r) => tag(r, "t").map((t) => t.textContent).join("");
  function setRun(r, text) {
    const ts = tag(r, "t");
    if (!ts.length) return;
    ts.slice(1).forEach((t) => t.parentNode.removeChild(t));
    ts[0].textContent = text;
    ts[0].setAttribute("xml:space", "preserve");
  }
  const paraText = (p) => tag(p, "t").map((t) => t.textContent).join("");
  /* اسم المدرب في القالب مقسّم على أكثر من run؛ يُكتب في الأول وتُفرَّغ بقيتها
     حتى نقاط التوقيع، وإلا بقي آخر القديم ملتصقاً بالجديد */
  function setName(runs, i, name) {
    if (!runs[i]) return;
    setRun(runs[i], name);
    for (let k = i + 1; k < runs.length; k++) {
      const t = runText(runs[k]);
      if (/\.{3,}/.test(t) || !t.trim()) break;
      setRun(runs[k], "");
    }
  }

  function attPage(doc, block, ctx) {
    const kids = block.map((k) => k.cloneNode(true));
    kids.forEach((k) => {
      if (k.localName === "tbl") return fillAttTable(doc, k, ctx);
      const txt = paraText(k);
      const runs = tag(k, "r");
      if (/كشف الحضور/.test(txt)) {
        setRun(runs[0], `كشف الحضور والغياب للامتحان النهائي (${ctx.kind}) - `);
        if (runs[1]) setRun(runs[1], ctx.track);
        else setRun(runs[0], `كشف الحضور والغياب للامتحان النهائي (${ctx.kind}) - ${ctx.track}`);
      } else if (/اليوم/.test(txt)) {
        const iDay = runs.findIndex((r) => /اليوم/.test(runText(r)));
        if (iDay >= 0 && runs[iDay + 1]) setRun(runs[iDay + 1], ` ${ctx.day} `);
        const iDate = runs.findIndex((r) => /التاريخ/.test(runText(r)));
        if (iDate >= 0) {
          setRun(runs[iDate], `التاريخ: ${ctx.date}م`);
          runs.slice(iDate + 1).forEach((r) => setRun(r, ""));
        }
      } else if (/^\s*1-/.test(txt) || /مدرب المسار/.test(txt)) {
        const i1 = runs.findIndex((r) => /^\s*1-\s*$/.test(runText(r)));
        if (i1 >= 0) setName(runs, i1 + 1, ctx.trainers[0] || "");
      } else if (/^\s*2-/.test(txt)) {
        setName(runs, 1, ctx.trainers[1] || "");
      }
    });
    // مدربون أكثر من اثنين: يُستنسخ سطر «2-» لكل واحد منهم
    const second = kids.find((k) => /^\s*2-/.test(paraText(k)));
    const out = [];
    kids.forEach((k) => {
      out.push(k);
      if (k !== second) return;
      ctx.trainers.slice(2).forEach((name, i) => {
        const p = second.cloneNode(true);
        const runs = tag(p, "r");
        setRun(runs[0], `${i + 3}- `);
        if (runs[1]) setRun(runs[1], name);
        out.push(p);
      });
    });
    if (ctx.trainers.length < 2 && second) out.splice(out.indexOf(second), 1);
    return out;
  }

  function fillAttTable(doc, tbl, ctx) {
    const trs = [...tbl.children].filter((c) => c.localName === "tr");
    const head = trs[0], proto = trs[1] || trs[0];
    trs.forEach((tr) => tbl.removeChild(tr));
    tbl.appendChild(head);
    ctx.students.forEach((s, i) => {
      const tr = proto.cloneNode(true);
      const c = cellsOf(tr);
      const donor = tag(c[0], "r")[0] || null;
      const vals = [String(i + 1), s.name, s.nid, ctx.stage, ctx.group, ""];
      vals.forEach((v, ci) => { if (c[ci]) setCell(c[ci], v, donor); });
      tbl.appendChild(tr);
    });
  }

  async function buildAtt(list) {
    const zip = await JSZip.loadAsync(state.attBuf);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = firstTag(doc.documentElement, "body");
    const sectPr = [...body.children].find((k) => k.localName === "sectPr");
    const block = [...body.children].filter((k) => k !== sectPr);
    if (!block.some((k) => k.localName === "tbl")) throw new Error("قالب كشف الحضور بلا جدول");
    block.forEach((k) => body.removeChild(k));

    let first = true;
    list.forEach(({ track, groups }) => {
      const trainers = trainersOf(track);
      groups.forEach((g, gi) => {
        const plan = planOf(track, g.name);
        const appts = [];
        if (plan.theory && plan.theory.date) appts.push({ kind: "نظري", date: plan.theory.date });
        (plan.practical || []).forEach((p) => { if (p.date) appts.push({ kind: "عملي", date: p.date }); });
        if (!appts.length) appts.push({ kind: "نظري", date: "" });
        appts.forEach((ap) => {
          if (!first) body.insertBefore(pageBreak(doc), sectPr);
          first = false;
          attPage(doc, block, {
            track, kind: ap.kind, day: dayOf(ap.date), date: fmtDate(ap.date),
            students: g.students, stage: state.stage,
            group: `المجموعة ${ORDINAL[gi] || gi + 1}`, trainers,
          }).forEach((k) => body.insertBefore(k, sectPr));
        });
      });
    });
    return pack(zip, doc);
  }

  /* ===== التجميع: مسار ← مجموعات ← طلبة ===== */
  function grouped() {
    const m = state.map;
    const byTrack = new Map();
    state.rows.forEach((r) => {
      const t = clean(r[m.track]) || "بلا مسار";
      const g = m.group ? (clean(r[m.group]) || "بلا مجموعة") : "الكل";
      if (!byTrack.has(t)) byTrack.set(t, new Map());
      const gs = byTrack.get(t);
      if (!gs.has(g)) gs.set(g, []);
      gs.get(g).push({ name: clean(r[m.name]), nid: clean(r[m.nid]) });
    });
    return [...byTrack].map(([track, gs]) => ({
      track,
      groups: [...gs].map(([name, students]) => ({ name, students })),
    }));
  }

  /* ===== القالب المحفوظ =====
     يُحفظ مرة واحدة في مخزن القوالب المشترك (بعلامة exam حتى لا يختلط بقوالب
     التحويل)، فيجده المستخدم جاهزاً في كل مرة وعلى كل جهاز. */
  const tplStore = () => App.converterStore;
  const KINDS = { tpl: "exam", att: "exam-att" };
  async function savedOf(which) {
    if (!tplStore()) return [];
    try { return (await tplStore().list()).filter((t) => t.kind === KINDS[which]); } catch (e) { return []; }
  }
  async function loadSaved(which) {
    const list = await savedOf(which);
    if (!list.length) return false;
    try {
      const t = await tplStore().get(list[0].id);
      state[which + "Buf"] = await t.file.arrayBuffer();
      state[which + "Name"] = t.name;
      state[which + "SavedId"] = t.id;
      return true;
    } catch (e) { return false; }
  }
  async function saveTpl(which, file) {
    if (!tplStore()) return;
    const old = await savedOf(which);
    state[which + "SavedId"] = await tplStore().save({
      name: file.name.replace(/\.docx$/i, ""), format: "docx", headers: [], kind: KINDS[which],
      file: new Blob([state[which + "Buf"]], { type: file.type }),
    });
    // القالب واحد؛ النسخ القديمة تُزال حتى لا تتراكم
    for (const t of old) { try { await tplStore().remove(t.id); } catch (e) { /* يكفي تجاهلها */ } }
  }

  /* ===== الواجهة ===== */
  function render() {
    const box = $("ex-body");
    if (!box) return;
    if (!state.rows.length) {
      box.innerHTML = state.tplBuf
        ? `<p class="conv-hint">✓ القالب محفوظ وجاهز: <b>${esc(state.tplName)}</b>${state.tplSavedId ? " — لا داعي لرفعه مرة أخرى" : ""}. ارفع ملف الطلبة.</p>`
        : "";
      return;
    }
    const m = state.map;
    const sel = (key, label) => `<label class="field"><span>${label}</span>
      <select data-ex-map="${key}">${["", ...state.headers].map((h) => `<option value="${esc(h)}" ${m[key] === h ? "selected" : ""}>${h ? esc(h) : "— اختر —"}</option>`).join("")}</select></label>`;
    const bits = [`<p class="conv-hint">${state.tplBuf ? `✓ القالب: ${esc(state.tplName)}` : "⚠ لم يُرفع القالب بعد"} · ملف الطلبة: <b>${ui.fmt(state.rows.length)}</b> صفاً</p>`,
      `<div class="inv-form">${sel("name", "عمود الاسم")}${sel("nid", "رقم الهوية")}${sel("track", "المسار")}${sel("group", "المجموعة (اختياري)")}</div>`];

    if (state.attBuf) {
      bits.push(`<p class="conv-hint">✓ قالب كشف الحضور جاهز: <b>${esc(state.attName)}</b></p>
        <label class="conv-check"><input type="checkbox" id="ex-withatt" ${state.withAtt ? "checked" : ""}>
          أنشئ كشوف توقيع المتدربين أيضاً — كشف لكل موعد امتحان بترتيب الأسماء نفسه</label>
        <div class="inv-form"><label class="field"><span>المرحلة (تُكتب في عمود «المرحلة»)</span>
          <input type="text" id="ex-stage" value="${esc(state.stage)}" placeholder="الثانية"></label></div>`);
    }

    if (m.name && m.track) {
      grouped().forEach((t) => {
        const total = t.groups.reduce((n, g) => n + g.students.length, 0);
        bits.push(`<h4 class="ex-head">${esc(t.track)} <span class="conv-hint">${ui.fmt(total)} طالباً · ${ui.fmt(t.groups.length)} مجموعة</span></h4>`);
        if (state.attBuf && state.withAtt) {
          bits.push(`<div class="inv-form ex-trainers" data-track="${esc(t.track)}"><label class="field">
            <span>مدربو المسار (افصل بينهم بفاصلة)</span>
            <input type="text" data-ex-trainers value="${esc(state.trainers[t.track] || "")}" placeholder="اسراء خليل، انسام سليمان"></label></div>`);
        }
        t.groups.forEach((g, gi) => {
          const plan = planOf(t.track, g.name);
          bits.push(`<div class="conv-grade-note ex-grp" data-track="${esc(t.track)}" data-grp="${esc(g.name)}">
            <b>المجموعة ${ORDINAL[gi] || gi + 1}</b> <span class="conv-hint">${esc(g.name)} · ${ui.fmt(g.students.length)} طالباً</span>
            <div class="inv-form" style="margin-top:8px">
              <label class="field"><span>الاختبار النظري — التاريخ</span><input type="date" data-ex-th-date value="${esc(plan.theory.date)}"></label>
              <label class="field"><span>الساعة</span><input type="text" data-ex-th-time value="${esc(plan.theory.time)}" placeholder="12:00 - 12:40"></label>
            </div>
            <div class="ex-prac">
              <b class="conv-label">مواعيد الاختبار العملي</b>
              ${plan.practical.map((p, i) => `<div class="inv-form ex-slot" data-i="${i}">
                  <label class="field"><span>التاريخ</span><input type="date" data-ex-pr-date value="${esc(p.date)}"></label>
                  <label class="field"><span>الساعة</span><input type="text" data-ex-pr-time value="${esc(p.time)}" placeholder="09:00 - 01:00"></label>
                  <button type="button" class="btn small danger" data-ex-del="${i}">حذف</button>
                </div>`).join("")}
              <button type="button" class="conv-link" data-ex-add>+ أضف موعداً</button>
            </div>
          </div>`);
        });
      });
      const many = grouped().length > 1;
      if (many) {
        bits.push(`<label class="conv-check"><input type="checkbox" id="ex-one" ${state.oneFile ? "checked" : ""}>
          كل المسارات في ملف Word واحد ورى بعض — بدل ملف لكل مسار</label>`);
      }
      bits.push(`<div class="btn-row"><button type="button" class="btn navy" id="ex-run" ${state.tplBuf ? "" : "disabled"}>
        <span class="material-symbols-outlined btn-ico">description</span>أنشئ جداول الاختبارات</button></div>`);
    }
    box.innerHTML = bits.join("");
  }

  async function run() {
    const list = grouped();
    if (!list.length) { ui.toast("لا بيانات"); return; }
    const att = state.withAtt && state.attBuf;
    const made = [];
    if (state.oneFile && list.length > 1) {
      made.push({ name: `جداول الاختبارات - ${ui.todayISO()}.docx`, blob: await build(list) });
      if (att) made.push({ name: `كشوف الحضور - ${ui.todayISO()}.docx`, blob: await buildAtt(list) });
    } else {
      for (const t of list) {
        made.push({ name: `جدول اختبارات - ${t.track}.docx`, blob: await build([t]) });
        if (att) made.push({ name: `كشف الحضور - ${t.track}.docx`, blob: await buildAtt([t]) });
      }
    }
    if (made.length === 1) ui.download(made[0].name, made[0].blob);
    else {
      const zip = new JSZip();
      made.forEach((x) => zip.file(x.name, x.blob));
      ui.download(`جداول الاختبارات - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    }
    ui.toast(`أُنشئ ${ui.fmt(made.length)} ملفاً`);
  }

  function init() {
    const tpl = $("ex-tpl"), data = $("ex-data"), body = $("ex-body");
    if (!tpl || !data || !body) return;

    const onTpl = (which, label) => async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      state[which + "Buf"] = await f.arrayBuffer();
      state[which + "Name"] = f.name;
      render();
      try { await saveTpl(which, f); ui.toast(`حُفظ ${label} — لن تحتاج رفعه مرة أخرى`); } catch (err) { ui.toast(err.message); }
      render();
    };
    tpl.addEventListener("change", onTpl("tpl", "قالب الاختبارات"));
    if ($("ex-att")) $("ex-att").addEventListener("change", onTpl("att", "قالب كشف الحضور"));

    /* القوالب المحفوظة تُحمَّل تلقائياً. المخزن قد لا يكون جاهزاً عند الإقلاع،
       ولا عند وصول المزامنة، فيُعاد السؤال مرات قليلة متباعدة. */
    const retry = (which) => (ms) => {
      if (state[which + "Buf"]) return;
      loadSaved(which).then((ok) => {
        if (ok) return render();
        const next = [500, 1500, 4000, 10000].find((d) => d > ms);
        if (next) setTimeout(() => retry(which)(next), next - ms);
      });
    };
    retry("tpl")(0);
    retry("att")(0);
    if (App.store && App.store.onChange) App.store.onChange(() => {
      if (!state.tplBuf) loadSaved("tpl").then((ok) => { if (ok) render(); });
      if (!state.attBuf) loadSaved("att").then((ok) => { if (ok) render(); });
    });

    data.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) { state.rows = []; return render(); }
      if (!state.tplBuf) await loadSaved("tpl");
      if (!state.attBuf) await loadSaved("att");
      try {
        const d = await App.converterCore.readDataFile(new Uint8Array(await f.arrayBuffer()));
        state.headers = d.headers;
        state.rows = d.rows;
        Object.keys(state.map).forEach((k) => { state.map[k] = guess(d.headers, k); });
      } catch (err) {
        body.innerHTML = `<p class="conv-error">${esc(err.message)}</p>`;
        return;
      }
      render();
    });

    body.addEventListener("change", (e) => {
      const key = e.target.dataset.exMap;
      if (key) { state.map[key] = e.target.value; return render(); }
      if (e.target.id === "ex-one") { state.oneFile = e.target.checked; return; }
      if (e.target.id === "ex-withatt") { state.withAtt = e.target.checked; return render(); }
      if (e.target.id === "ex-stage") { state.stage = e.target.value; return; }
      const tr = e.target.closest(".ex-trainers");
      if (tr) { state.trainers[tr.dataset.track] = e.target.value; return; }
      const card = e.target.closest(".ex-grp");
      if (!card) return;
      const plan = planOf(card.dataset.track, card.dataset.grp);
      if (e.target.matches("[data-ex-th-date]")) plan.theory.date = e.target.value;
      if (e.target.matches("[data-ex-th-time]")) plan.theory.time = e.target.value;
      const slot = e.target.closest(".ex-slot");
      if (slot) {
        const i = +slot.dataset.i;
        if (e.target.matches("[data-ex-pr-date]")) plan.practical[i].date = e.target.value;
        if (e.target.matches("[data-ex-pr-time]")) plan.practical[i].time = e.target.value;
      }
    });

    body.addEventListener("click", (e) => {
      const card = e.target.closest(".ex-grp");
      if (card) {
        const plan = planOf(card.dataset.track, card.dataset.grp);
        if (e.target.closest("[data-ex-add]")) { plan.practical.push({ date: "", time: "" }); return render(); }
        const del = e.target.closest("[data-ex-del]");
        if (del) { plan.practical.splice(+del.dataset.exDel, 1); return render(); }
      }
      if (e.target.closest("#ex-run")) run().catch((err) => ui.toast(err.message));
    });
  }

  App.examSheet = { init, build, buildAtt, grouped, render, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
