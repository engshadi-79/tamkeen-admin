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
    grdBuf: null, grdName: "", grdSavedId: "",
    rows: [], headers: [],
    map: { name: "", nid: "", track: "", group: "" },
    oneFile: false,      // كل المسارات في ملف واحد
    withAtt: true,       // كشوف الحضور مع الجداول
    withGrd: true,       // كشوف الدرجات مع الجداول
    stage: "",           // المرحلة، تُكتب في عمود «المرحلة» بكشف الحضور
    trainers: {},        // لكل مسار: أسماء المدربين
    evals: [],           // نماذج التقييم، لكل مسار نموذجه
    withEval: true,      // نماذج التقييم مع الجداول
    evalDate: true,      // اليوم والتاريخ في نماذج التقييم
    forms: [],           // القوالب المحفوظة المتاحة
    pickForms: [],       // ما اختاره المستخدم منها
    plan: {},            // لكل مجموعة: { theory:{date,time}, practical:[{date,time}] }
  };
  /* مدربو المسار من النظام (صفحة المسارات): اسم المسار في ملف الطلبة يُطابَق
     بمسارات النظام — مطابقةً مرنة كما في «تحويل حسب قالب» — فيُؤخذ منها
     المدربان. وللمستخدم أن يكتب غيرهما فيُعتمد ما كتب. */
  function sysTrainers(track) {
    try {
      const tracks = ((App.store.get() || {}).tracks || []).filter((t) => t && t.name);
      const t = App.converterCore.findTrack(tracks, track);
      if (!t) return "";
      return [clean(t.trainer1), clean(t.trainer2)].filter(Boolean).join("، ");
    } catch (e) { return ""; }
  }
  const trainersText = (track) => (track in state.trainers ? state.trainers[track] : sysTrainers(track));
  const trainersOf = (track) => trainersText(track).split(/[,،\n]/).map(clean).filter(Boolean);

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

    // سطر الاعتماد كما في بقية الكشوف: سطر تحت سطر
    signature(doc, sig, tag(sig, "r"));
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
  /* سطر المدرب يختلف شكله بين النماذج: في بعضها «1- » وحدها في رنّة والاسم
     في التالية، وفي بعضها «1- الاسم ... نقاط التوقيع» كلّها في رنّة واحدة.
     فيُعالَج نصّاً: يُبقى الرقم ونقاط التوقيع ويُستبدل ما بينهما. */
  function setTrainer(runs, findNum, name, showNum) {
    const i = runs.findIndex((r) => new RegExp("^\\s*" + findNum + "-").test(runText(r)));
    if (i < 0) return false;
    const m = runText(runs[i]).match(/^(\s*\d+-\s*)([\s\S]*?)(\s*\.{3,}[\s\S]*)?$/);
    const dots = (m && m[3]) || "";
    const inline = ((m && m[2]) || "").trim() || dots;
    if (inline) {
      setRun(runs[i], `${showNum || findNum}- ${name}${dots}`);
      for (let k = i + 1; k < runs.length; k++) {
        if (/\.{3,}/.test(runText(runs[k]))) break;
        setRun(runs[k], "");
      }
      return runs[i];
    }
    if (showNum) setRun(runs[i], `${showNum}- `);
    setName(runs, i + 1, name);
    return runs[i + 1] || runs[i];
  }

  function setName(runs, i, name) {
    if (!runs[i]) return;
    setRun(runs[i], name);
    for (let k = i + 1; k < runs.length; k++) {
      if (/\.{3,}/.test(runText(runs[k]))) break;   // نقاط التوقيع: حدّ الاسم
      setRun(runs[k], "");
    }
  }

  /* القالب يذيّله فقرات فارغة؛ استنساخها مع كل مجموعة يدفع الجدول لصفحة
     ثانية ويخلّف صفحة فارغة في آخر الملف */
  function trimTail(block) {
    const out = block.slice();
    while (out.length) {
      const k = out[out.length - 1];
      if (k.localName === "tbl" || paraText(k).trim()) break;
      out.pop();
    }
    return out;
  }

  /* سطر الاعتماد الموحَّد في كل الكشوف، بتنسيق قالب جدول الاختبارات:
     «رئيس المركز السعودي…» ثم سطرٌ فيه «مدير مركز…» و«د. عصام أبو خليل». */
  const SIGN_RE = /مدير مركز مسارات التمكين|اعتماد رئيس مجلس الإدارة|رئيس المركز السعودي/;
  const SIGN = ["رئيس المركز السعودي للثقافة والتراث",
    "مدير مركز مسارات التمكين للتدريب",
    "د. عصام أبو خليل"];
  /* خط موحَّد لأسماء المدربين وسطري التوقيع والاعتماد */
  const NAME_FONT = { name: "Sakkal Majalla", half: "24", bold: false };
  const SIGN_SHIFT = 0.58;   // نسبة الإزاحة من عرض النص؛ الأكبر أقرب لأقصى اليسار
  const SIG_FONT = { name: "Sakkal Majalla", half: "24", bold: true };   // 12 نقطة
  function applyFont(doc, r, f) {
    let rPr = tag(r, "rPr")[0];
    if (!rPr || rPr.parentNode !== r) {
      rPr = doc.createElementNS(W, "w:rPr");
      r.insertBefore(rPr, r.firstChild);
    }
    const put = (name, attrs) => {
      [...rPr.children].filter((c) => c.localName === name).forEach((c) => rPr.removeChild(c));
      const el = doc.createElementNS(W, "w:" + name);
      Object.keys(attrs || {}).forEach((k) => el.setAttribute("w:" + k, attrs[k]));
      rPr.appendChild(el);
    };
    put("rFonts", { ascii: f.name, hAnsi: f.name, cs: f.name });
    if (f.bold) { put("b", {}); put("bCs", {}); }
    else [...rPr.children].filter((c) => c.localName === "b" || c.localName === "bCs").forEach((c) => rPr.removeChild(c));
    put("sz", { val: f.half });
    put("szCs", { val: f.half });
  }
  const fontPara = (doc, p) => tag(p, "r").forEach((r) => applyFont(doc, r, SIG_FONT));

  function signature(doc, p, runs, styleRun) {
    const proto = styleRun ? styleRun.cloneNode(true) : runs[0];
    if (!proto) return;
    runs.forEach((r) => r.parentNode.removeChild(r));
    const piece = (text, kind) => {
      const r = proto.cloneNode(true);
      if (kind) {
        tag(r, "t").forEach((t) => t.parentNode.removeChild(t));
        r.appendChild(doc.createElementNS(W, "w:" + kind));
      } else {
        setRun(r, text);
      }
      p.appendChild(r);
    };
    // سطر تحت سطر، بلا جدولة ولا حشو مسافات
    SIGN.forEach((t, i) => { if (i) piece(null, "br"); piece(t); });
    fontPara(doc, p);
    /* الكتلة في يسار الصفحة وأسطرها متوسّطة بعضها تحت بعض: تُزاح بدايتها
       (وهي اليمين في العربية) نصفَ عرض النص، ثم تُتوسّط فيما بقي. */
    setBidi(doc, p);
    setIndent(doc, p, Math.round(usableTwips(doc) * SIGN_SHIFT));
    setJcPara(doc, p, "center");
  }

  /* عرض النص من إعدادات المقطع، بالتويب */
  function usableTwips(doc) {
    const sect = tag(doc.documentElement, "sectPr")[0];
    const sz = sect && tag(sect, "pgSz")[0];
    const mar = sect && tag(sect, "pgMar")[0];
    const n = (el, a) => (el ? Number(el.getAttribute("w:" + a)) || 0 : 0);
    const w = n(sz, "w") || 12240;
    const left = n(mar, "left") || 1440;
    const right = n(mar, "right") || 1440;
    return Math.max(2000, w - left - right);
  }

  function setIndent(doc, p, start) {
    let pPr = tag(p, "pPr")[0];
    if (!pPr || pPr.parentNode !== p) {
      pPr = doc.createElementNS(W, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    [...pPr.children].filter((c) => c.localName === "ind").forEach((c) => pPr.removeChild(c));
    const ind = doc.createElementNS(W, "w:ind");
    ind.setAttribute("w:start", String(start));
    ind.setAttribute("w:left", String(start));
    ind.setAttribute("w:end", "0");
    ind.setAttribute("w:right", "0");
    ind.setAttribute("w:firstLine", "0");
    const after = [...pPr.children].find((c) => ["jc", "textDirection", "textAlignment", "rPr", "sectPr"].includes(c.localName));
    pPr.insertBefore(ind, after || null);
  }

  function setBidi(doc, p) {
    let pPr = tag(p, "pPr")[0];
    if (!pPr || pPr.parentNode !== p) {
      pPr = doc.createElementNS(W, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    [...pPr.children].filter((c) => c.localName === "bidi").forEach((c) => pPr.removeChild(c));
    const el = doc.createElementNS(W, "w:bidi");
    const after = [...pPr.children].find((c) => ["spacing", "ind", "jc", "rPr", "sectPr"].includes(c.localName));
    pPr.insertBefore(el, after || null);
  }


  /* الإزاحة قد تأتي من نمط الفقرة لا منها، فتُصفَّر صراحةً */
  function setIndentZero(doc, p) {
    let pPr = tag(p, "pPr")[0];
    if (!pPr || pPr.parentNode !== p) {
      pPr = doc.createElementNS(W, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    [...pPr.children].filter((c) => c.localName === "ind").forEach((c) => pPr.removeChild(c));
    const ind = doc.createElementNS(W, "w:ind");
    ["left", "right", "firstLine", "start", "end"].forEach((k) => ind.setAttribute("w:" + k, "0"));
    const after = [...pPr.children].find((c) => ["jc", "textDirection", "textAlignment", "rPr", "sectPr"].includes(c.localName));
    pPr.insertBefore(ind, after || null);
  }

  /* محاذاة فقرة (setJc يعمل على خلايا الجداول) */
  function setJcPara(doc, p, val) {
    let pPr = tag(p, "pPr")[0];
    if (!pPr || pPr.parentNode !== p) {
      pPr = doc.createElementNS(W, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    [...pPr.children].filter((c) => c.localName === "jc").forEach((c) => pPr.removeChild(c));
    const jc = doc.createElementNS(W, "w:jc");
    jc.setAttribute("w:val", val);
    const rPr = [...pPr.children].find((c) => c.localName === "rPr" || c.localName === "sectPr");
    pPr.insertBefore(jc, rPr || null);
  }

  /* متغيّرات القالب: ‎{{المسار}}‎ و‎{{المرحلة}}‎ و‎{{المجموعة}}‎ و‎{{المدرب}}‎.
     «المدرب» يتكرر في الصفحة، فالأول للمدرّب الأول والثاني للثاني. */
  function fillVars(p, ctx, seq) {
    const runs = tag(p, "r");
    const texts = runs.map(runText);
    const joined = texts.join("");
    if (!/\{\{/.test(joined)) return false;
    const map = { "المسار": ctx.track, "المرحلة": ctx.stage, "الدورة": ctx.stage, "المجموعة": ctx.group };
    const hits = [];
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let m;
    while ((m = re.exec(joined))) {
      const k = m[1];
      const val = /^(ال)?مدرب/.test(k) ? (ctx.trainers[seq ? seq.i++ : 0] || "")
        : (k in map ? map[k] : m[0]);
      hits.push({ start: m.index, end: m.index + m[0].length, val, trainer: /^(ال)?مدرب/.test(k) });
    }
    // Word يقسّم المتغيّر على عدة وحدات نصّية، فيُحسب لكل وحدة نصيبها منه
    let at = 0;
    const bounds = texts.map((t) => { const b = [at, at + t.length]; at += t.length; return b; });
    texts.forEach((t, i) => {
      const [a, b] = bounds[i];
      let res = "", cur = a, touched = false;
      hits.forEach((h) => {
        const s = Math.max(a, h.start), e = Math.min(b, h.end);
        if (s >= e) return;
        touched = true;
        res += t.slice(cur - a, s - a);
        if (h.start >= a && h.start < b) {
          res += h.val;                                   // القيمة في أول وحدة تحوي بدايته
          if (h.trainer && seq && !seq.nameRun) seq.nameRun = runs[i];
        }
        cur = e;
      });
      if (touched) setRun(runs[i], res + t.slice(cur - a));
    });
    return true;
  }

  /* سطر «مدرب المسار : …» في بعض القوالب: ما بعد النقطتين موضعُ الاسم،
     أيّاً كان ما فيه الآن (رقم أو اسم قديم أو فراغ). */
  function setTrainerSlot(runs, name) {
    const texts = runs.map(runText);
    const joined = texts.join("");
    const at = joined.search(/مدرب/);
    if (at < 0) return false;
    const colon = joined.indexOf(":", at);
    if (colon < 0) return false;
    // الاسم ينتهي عند «التوقيع» أو نقاطه، وإلا فآخر الفقرة
    const stop = joined.slice(colon + 1).search(/التوقيع|\.{3,}/);
    const end = stop >= 0 ? colon + 1 + stop : joined.length;
    let pos = 0, hit = null;
    const bounds = texts.map((t) => { const b = [pos, pos + t.length]; pos += t.length; return b; });
    texts.forEach((t, i) => {
      const [a, b] = bounds[i];
      const s = Math.max(a, colon + 1), e = Math.min(b, end);
      if (s >= e) return;
      const put = colon + 1 >= a && colon + 1 < b ? " " + name : "";
      if (put) hit = runs[i];
      setRun(runs[i], t.slice(0, s - a) + put + t.slice(e - a));
    });
    return hit || true;
  }

  function attPage(doc, block, ctx) {
    const kids = block.map((k) => k.cloneNode(true));
    const drop = [];
    const sigs = [];
    const seq = { i: 0, t: 0, nameRun: null };
    // حجم خط سطر الاعتماد يتبع سطر «مدرب المسار» حتى لا يصغر عنه
    const styleRun = (() => {
      const line = kids.find((k) => k.localName === "p" && /مدرب\s*المسار/.test(paraText(k)));
      return line ? (tag(line, "r").find((r) => tag(r, "t").length) || null) : null;
    })();
    kids.forEach((k) => {
      if (k.localName === "tbl") return fillAttTable(doc, k, ctx);
      const txt = paraText(k);
      const runs = tag(k, "r");
      const subbed = fillVars(k, ctx, seq);   // متغيّرات القالب أينما وردت
      if (/كشف الحضور/.test(txt)) {
        const tail = ctx.track + (ctx.stage ? ` (المرحلة ${ctx.stage})` : "");
        setRun(runs[0], `كشف الحضور والغياب للامتحان النهائي (${ctx.kind}) - `);
        if (runs[1]) setRun(runs[1], tail);
        else setRun(runs[0], `كشف الحضور والغياب للامتحان النهائي (${ctx.kind}) - ${tail}`);
      } else if (/درجات التقييم/.test(txt)) {
        // «درجات التقييم النهائي العملي - <المسار>»: اسم المسار في آخر run
        setRun(runs[runs.length - 1], ctx.track);
      } else if (/كشف درجات/.test(txt)) {
        // قالب بلا متغيّر: اسم المسار يحلّ محلّ ما بعد الشرطة في العنوان
        if (!subbed) setRun(runs[runs.length - 1], ` ${ctx.track}`);
        // ثم المرحلة بعده
        if (ctx.stage && !/المرحلة/.test(paraText(k))) {
          const last = runs.filter((r) => tag(r, "t").length).pop();
          if (last) setRun(last, runText(last) + ` (المرحلة ${ctx.stage})`);
        }
      } else if (SIGN_RE.test(txt)) {
        sigs.push({ p: k, runs });          // يُؤجَّل حتى يُعرف خطّ اسم المدرب
      } else if (/^\s*د\.\s*عصام/.test(txt)) {
        drop.push(k);                       // اسم المدير صار ضمن سطر التوقيع
      } else if (/الدورة/.test(txt) && /المجموعة/.test(txt)) {
        // «الدورة الأولى – المجموعة الاولى» ← «المرحلة … – المجموعة …»
        setRun(runs[0], `المرحلة ${ctx.stage || "الأولى"} `);
        if (runs.length > 2) setRun(runs[runs.length - 1], ` ${ctx.group}`);
      } else if (/اليوم/.test(txt)) {
        // بلا موعد محدَّد يُترك سطر القالب بنقاطه بدل «التاريخ: م» فارغة
        if (ctx.noDate || !ctx.date) return;
        const iDay = runs.findIndex((r) => /اليوم/.test(runText(r)));
        if (iDay >= 0 && runs[iDay + 1]) setRun(runs[iDay + 1], ` ${ctx.day} `);
        const iDate = runs.findIndex((r) => /التاريخ/.test(runText(r)));
        if (iDate >= 0) {
          setRun(runs[iDate], `التاريخ: ${ctx.date}م`);
          runs.slice(iDate + 1).forEach((r) => setRun(r, ""));
        }
      } else if (/^\s*1-/.test(txt) || /مدرب\s*المسار/.test(txt)) {
        // قالب بسطر «1- الاسم»، أو بسطر «مدرب المسار : …» لكل مدرّب
        if (!subbed) {
          const r = setTrainer(runs, 1, ctx.trainers[0] || "")
            || setTrainerSlot(runs, ctx.trainers[seq.t++] || "");
          if (r && r.nodeType && !seq.nameRun) seq.nameRun = r;
        }
        fontPara(doc, k);
      } else if (/^\s*2-/.test(txt)) {
        if (!subbed) setTrainer(runs, 2, ctx.trainers[1] || "");
        fontPara(doc, k);
      } else if (/^\s*التوقيع/.test(txt)) {
        fontPara(doc, k);
      }
    });
    // خطّ سطر الاعتماد خطّ اسم المدرب نفسه
    sigs.forEach((x) => signature(doc, x.p, x.runs, seq.nameRun || styleRun));

    // مدربون أكثر من اثنين: يُستنسخ سطر «2-» لكل واحد منهم.
    // وسطرا المدرّبَين يبقيان دائماً — الفارغ منهما يُكتب بخط اليد.
    const second = kids.find((k) => /^\s*2-/.test(paraText(k)));
    const out = [];
    kids.forEach((k) => {
      if (drop.includes(k)) return;
      out.push(k);
      if (k !== second) return;
      ctx.trainers.slice(2).forEach((name, i) => {
        const p = second.cloneNode(true);
        setTrainer(tag(p, "r"), 2, name, i + 3);
        fontPara(doc, p);
        out.push(p);
      });
    });
    return out;
  }

  /* توسيط أفقي داخل الخلية */
  function setJc(doc, tc, val) {
    tag(tc, "p").forEach((p) => {
      let pPr = tag(p, "pPr")[0];
      if (!pPr || pPr.parentNode !== p) {
        pPr = doc.createElementNS(W, "w:pPr");
        p.insertBefore(pPr, p.firstChild);
      }
      [...pPr.children].filter((c) => c.localName === "jc").forEach((c) => pPr.removeChild(c));
      const jc = doc.createElementNS(W, "w:jc");
      jc.setAttribute("w:val", val);
      const rPr = [...pPr.children].find((c) => c.localName === "rPr" || c.localName === "sectPr");
      pPr.insertBefore(jc, rPr || null);
    });
  }

  /* عمود «المجموعة» في القالب 1094 نقطة فقط، فيلتفّ «المجموعة الأولى» سطرين.
     يُوسَّع من عمودَي الاسم والتوقيع، ومجموع العرض يبقى كما هو. */
  const ATT_W = [443, 2896, 1360, 1236, 1800, 2333];
  function widenGroup(doc, tbl) {
    const grid = firstTag(tbl, "tblGrid");
    if (grid) {
      [...grid.children].forEach((c, i) => { if (ATT_W[i]) c.setAttribute("w:w", String(ATT_W[i])); });
    }
    [...tbl.children].filter((c) => c.localName === "tr").forEach((tr) => {
      cellsOf(tr).forEach((tc, i) => {
        const w = firstTag(tc, "tcW");
        if (w && ATT_W[i]) w.setAttribute("w:w", String(ATT_W[i]));
      });
    });
  }

  /* نموذج التقييم يبدأ بصفّ عناوين ثم صفّ الدرجات القصوى (5، 10، … 50)؛
     يُعرف بأن خلاياه بعد الثالثة أرقام، وخاناته الأولى فارغة. يبقى كما هو. */
  function headRows(trs) {
    if (trs.length < 3) return 1;
    const c = cellsOf(trs[1]).map((tc) => tag(tc, "t").map((t) => t.textContent).join("").trim());
    const nums = c.slice(3).filter((v) => v && /^\d+$/.test(v)).length;
    return nums >= 2 && !c[0] && !c[1] ? 2 : 1;
  }

  /* القيمة تُوضع حسب اسم العمود لا موضعه، فيخدم ذلك النماذج كلها:
     كشف الحضور (المرحلة/المجموعة/التوقيع)، والتقييم (أعمدة المعايير)،
     وكشف الدرجات (الدورة/المجموعة/العملي/النظري/الأنشطة). */
  const isName = (head) => {
    const h = App.converterCore.normalizeHeader(head || "").replace(/\s*\(.*$/, "").trim();
    return /^(ال)?اسم$/.test(h) || /^اسم\s*(ال)?\S+$/.test(h);
  };

  function valueFor(head, s, i, ctx) {
    const h = App.converterCore.normalizeHeader(head).replace(/\s*\(.*$/, "").trim();
    /* مطابقة محكمة: «الهوية المؤسسية والتأسيس» عمود معيار لا عمود هوية،
       وكذلك أي عنوان أطول من عنوان البيانات المعتاد. */
    if (h === "م" || h === "ر.م" || h === "رقم") return String(i + 1);
    if (/^(ال)?اسم$/.test(h) || /^اسم\s*(ال)?\S+$/.test(h)) return s.name;
    if (/^(رقم\s*)?(ال)?هويه$/.test(h) || /^رقم\s*(ال)?هويه\s*(ال)?\S*$/.test(h)) return s.nid;
    if (/^(ال)?مرحله$/.test(h)) return ctx.stage;
    if (/^(ال)?دوره$/.test(h)) return "";        // المرحلة تُكتب في العنوان لا في عمود
    if (/^(ال)?مجموعه$/.test(h)) return ctx.group;
    return "";                                  // درجات وتوقيع: تُملأ بخط اليد
  }

  function fillAttTable(doc, tbl, ctx) {
    const trs = [...tbl.children].filter((c) => c.localName === "tr");
    const keep = headRows(trs);
    const heads = cellsOf(trs[0]).map((tc) => tag(tc, "t").map((t) => t.textContent).join(""));
    const proto = trs[keep] || trs[keep - 1];
    trs.forEach((tr) => tbl.removeChild(tr));
    trs.slice(0, keep).forEach((tr) => tbl.appendChild(tr));
    ctx.students.forEach((s, i) => {
      const tr = proto.cloneNode(true);
      const c = cellsOf(tr);
      const donor = tag(c[0], "r")[0] || null;
      c.forEach((tc, ci) => {
        const v = valueFor(heads[ci] || "", s, i, ctx);
        setCell(tc, v, donor);
        if (!ci || !v) return;
        // كشوف التقييم: اسم الطالب بـ Sakkal Majalla 12 عادي
        if (ctx.lean && isName(heads[ci])) tag(tc, "r").forEach((r) => applyFont(doc, r, NAME_FONT));
        // اسم الطالب يُحاذى يميناً كبقية النصّ العربي، وما عداه يُتوسّط
        // «البداية» في الخلية العربية هي اليمين الفيزيائي
        setJc(doc, tc, isName(heads[ci]) ? "left" : "center");
        putInPr(doc, tc, "vAlign", "center");
      });
      tbl.appendChild(tr);
    });
    // «الدورة» لا لزوم لها: المرحلة مكتوبة في العنوان
    const di = heads.findIndex((h) => /^(ال)?دوره$/.test(App.converterCore.normalizeHeader(h).trim()));
    if (di >= 0) dropColumn(doc, tbl, di);
  }

  /* حذف عمود من الجدول: من كل صفوفه ومن شبكته، وعرضه يُضاف إلى عمود
     الاسم حتى يبقى عرض الجدول كما هو */
  function dropColumn(doc, tbl, idx) {
    const grid = firstTag(tbl, "tblGrid");
    const cols = grid ? [...grid.children].filter((c) => c.localName === "gridCol") : [];
    const freed = cols[idx] ? Number(cols[idx].getAttribute("w:w")) || 0 : 0;
    const to = idx === 1 ? 0 : 1;                       // عمود الاسم غالباً
    if (cols[idx]) grid.removeChild(cols[idx]);
    if (cols[to]) cols[to].setAttribute("w:w", String((Number(cols[to].getAttribute("w:w")) || 0) + freed));
    [...tbl.children].filter((c) => c.localName === "tr").forEach((tr) => {
      const cells = cellsOf(tr);
      if (!cells[idx]) return;
      const w = cells[to] && firstTag(cells[to], "tcW");
      if (w) w.setAttribute("w:w", String((Number(w.getAttribute("w:w")) || 0) + freed));
      tr.removeChild(cells[idx]);
    });
  }

  const buildAtt = (list) => buildPages(state.attBuf, list, "att");
  const buildGrd = (list) => buildPages(state.grdBuf, list, "grd");

  async function buildPages(buf, list, which) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = firstTag(doc.documentElement, "body");
    const sectPr = [...body.children].find((k) => k.localName === "sectPr");
    const block = trimTail([...body.children].filter((k) => k !== sectPr));
    if (!block.some((k) => k.localName === "tbl")) throw new Error("القالب بلا جدول");
    if (which === "att") block.filter((k) => k.localName === "tbl").forEach((t) => widenGroup(doc, t));
    [...body.children].filter((k) => k !== sectPr).forEach((k) => body.removeChild(k));

    let first = true;
    list.forEach(({ track, groups }) => {
      const trainers = trainersOf(track);
      groups.forEach((g, gi) => {
        const plan = planOf(track, g.name);
        // كشف الحضور لكل موعد امتحان، وكشف الدرجات صفحة واحدة لكل مجموعة
        const appts = [];
        if (which === "att") {
          if (plan.theory && plan.theory.date) appts.push({ kind: "نظري", date: plan.theory.date });
          (plan.practical || []).forEach((p) => { if (p.date) appts.push({ kind: "عملي", date: p.date }); });
        }
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

  /* ===== نماذج التقييم: لكل مسار نموذجه بمعاييره =====
     المسار مكتوب في عنوان النموذج نفسه («درجات التقييم … - مسار كذا»)،
     فيُقرأ منه عند الرفع ويُطابَق بمسارات ملف الطلبة. */
  async function evalTrack(buf) {
    try {
      const zip = await JSZip.loadAsync(buf);
      const xml = await zip.file("word/document.xml").async("string");
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const p = tag(firstTag(doc.documentElement, "body"), "p")
        .find((x) => /درجات التقييم/.test(paraText(x)));
      if (!p) return "";
      const t = paraText(p);
      const i = t.lastIndexOf(" - ");
      return clean(i >= 0 ? t.slice(i + 3) : "");
    } catch (e) { return ""; }
  }
  /* مطابقة اسم المسار: findTrack لا يوحّد الشرطات، و«التجميل النسائي – كوافير»
     في النموذج تكتب بشرطة طويلة بينما ملف الطلبة يكتبها قصيرة. */
  const trackKey = (v) => App.converterCore.normalizeHeader(v == null ? "" : v)
    .replace(/[‐-―−\-_]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^مسار\s*/, "")
    .trim();
  const evalFor = (track) => {
    const k = trackKey(track);
    if (!k) return null;
    const list = state.evals.filter((e) => e.track).map((e) => ({ e, k: trackKey(e.track) }));
    const exact = list.find((x) => x.k === k);
    if (exact) return exact.e;
    const near = list.filter((x) => x.k.includes(k) || k.includes(x.k))
      .sort((a, b) => b.k.length - a.k.length);
    return near.length ? near[0].e : null;
  };

  async function buildEval(meta, track, groups) {
    const t = await tplStore().get(meta.id);
    const zip = await JSZip.loadAsync(await t.file.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = firstTag(doc.documentElement, "body");
    const sectPr = [...body.children].find((k) => k.localName === "sectPr");
    const block = trimTail([...body.children].filter((k) => k !== sectPr));
    [...body.children].filter((k) => k !== sectPr).forEach((k) => body.removeChild(k));

    const trainers = trainersOf(track);
    groups.forEach((g, gi) => {
      if (gi) body.insertBefore(pageBreak(doc), sectPr);
      const plan = planOf(track, g.name);
      // التقييم عمليّ، فتاريخه أول موعد عملي إن وُجد
      const ap = (plan.practical || []).find((p) => p.date) || plan.theory || {};
      attPage(doc, block, {
        track, kind: "عملي", day: dayOf(ap.date), date: fmtDate(ap.date),
        students: g.students, stage: state.stage,
        group: `المجموعة ${ORDINAL[gi] || gi + 1}`, trainers, lean: true,
        noDate: !state.evalDate,
      }).forEach((k) => body.insertBefore(k, sectPr));
    });
    return pack(zip, doc);
  }

  /* ===== نماذج محفوظة تُستخرج مع الجداول =====
     أي قالب في «قوالب التحويل» (ككشوف الدرجات النهائية) يُملأ بالطلبة أنفسهم
     وبترتيبهم نفسه، عبر آلية «تحويل حسب قالب» ذاتها. */
  async function savedForms() {
    if (!tplStore()) return [];
    try {
      const skip = Object.keys(KINDS).map((k) => KINDS[k]);
      return (await tplStore().list()).filter((t) => !skip.includes(t.kind));
    } catch (e) { return []; }
  }

  /* صفوف غنية بالأعمدة حتى تجد مطابقةُ القالب ما يلزمها */
  function formRows(track, groups) {
    const rows = [];
    groups.forEach((g, gi) => {
      const plan = planOf(track, g.name);
      const th = plan.theory || {};
      const [t1, t2] = trainersOf(track);
      const label = `المجموعة ${ORDINAL[gi] || gi + 1}`;
      g.students.forEach((s, i) => {
        rows.push({
          "م": String(i + 1),
          "اسم الطالب": s.name, "الاسم": s.name,
          "رقم الهوية": s.nid,
          "المسار": track, "المجموعة": label, "المرحلة": state.stage,
          "المدرب الأول": t1 || "", "المدرب الثاني": t2 || "",
          "المدربون": [t1, t2].filter(Boolean).join("، "),
          "اليوم": dayOf(th.date), "التاريخ": fmtDate(th.date), "الساعة": clean(th.time),
        });
      });
    });
    return rows;
  }

  /* يعرف نوع القالب من عنوانه: كشف درجات أو كشف حضور أو نموذج تقييم */
  const KIND_CACHE = new Map();
  async function sheetKind(meta) {
    if (KIND_CACHE.has(meta.id)) return KIND_CACHE.get(meta.id);
    let res = null;
    try {
      if ((meta.format || "docx") === "docx") {
        const t = await tplStore().get(meta.id);
        const buf = await t.file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        const xml = await zip.file("word/document.xml").async("string");
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const body = firstTag(doc.documentElement, "body");
        const head = tag(body, "p").slice(0, 6).map(paraText).join(" ");
        const which = /كشف درجات/.test(head) ? "grd"
          : /كشف الحضور/.test(head) ? "att"
            : /درجات التقييم/.test(head) ? "grd" : "";
        if (which) res = { which, buf };
      }
    } catch (e) { res = null; }
    KIND_CACHE.set(meta.id, res);
    return res;
  }

  async function buildForm(meta, track, groups) {
    const core = App.converterCore;
    const t = await tplStore().get(meta.id);
    const buffer = await t.file.arrayBuffer();
    const isDocx = (t.format || "docx") === "docx";
    const headers = (t.headers && t.headers.length) ? t.headers : await core.readTemplateHeaders(buffer, isDocx);
    const rows = formRows(track, groups);
    const dataHeaders = Object.keys(rows[0] || {});
    /* تطابق تام فقط: المطابقة المرنة تضع «المجموعة الأولى» في عمود «المجموع».
       وما لا نملك له قيمة (أعمدة الدرجات) يبقى فارغاً ليُملأ بخط اليد. */
    const norm = core.normalizeHeader;
    const mapping = {};
    headers.forEach((h) => {
      const hit = dataHeaders.find((d) => norm(d) === norm(h));
      if (hit) mapping[h] = hit;
    });
    const groupBy = headers.includes("المجموعة") || groups.length < 2 ? [] : ["المجموعة"];
    const out = await core.generate({
      templateBuffer: buffer, templateIsDocx: isDocx, templateName: `${t.name} - ${track}`,
      templateHeaders: headers, mapping, dataRows: rows,
      outputFormat: isDocx ? "docx" : "xlsx",
      groupByColumns: groupBy.length ? groupBy : undefined,
      autoNumberHeader: headers.find((h) => h === "م") || undefined,
      textFields: isDocx ? await trackTextFields(buffer, track, groups) : undefined,
    });
    return out;
  }

  /* نصوص ترويسة القالب (اسم المسار، اليوم، التاريخ) تُملأ من موعد المجموعة الأولى */
  async function trackTextFields(buffer, track, groups) {
    const core = App.converterCore;
    let fields = [];
    try { fields = await core.readTemplateTextFields(buffer, [track]); } catch (e) { return undefined; }
    if (!fields.length) return undefined;
    const th = (planOf(track, (groups[0] || {}).name || "") || {}).theory || {};
    return fields.map((f) => {
      const label = String(f.label || "");
      let value = "";
      if (/مسار/.test(label)) value = track;
      else if (/يوم/.test(label)) value = dayOf(th.date);
      else if (/تاريخ/.test(label)) value = fmtDate(th.date);
      return Object.assign({}, f, { value });
    });
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
  const KINDS = { tpl: "exam", att: "exam-att", grd: "exam-grades", eval: "exam-eval" };
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

    // بلا عمود مجموعة يصير الطلبة كلهم «المجموعة الأولى» — وهو سبب خفيّ لضياع المجموعات
    if (!state.map.group) {
      bits.push(`<p class="conv-error">⚠ لم تحدّد عمود «المجموعة» — سيخرج الطلبة كلهم في مجموعة واحدة.</p>`);
    }
    {
      bits.push(`<label class="conv-check"><input type="checkbox" id="ex-witheval" ${state.withEval ? "checked" : ""}>
        أنشئ نماذج التقييم أيضاً — ${state.evals.length
          ? `${ui.fmt(state.evals.length)} نموذجاً محفوظاً، لكل مسار معاييره`
          : "<b class=\"conv-error\">لم تُرفع نماذج تقييم بعد</b>"}</label>`);
      if (state.withEval) {
        bits.push(`<br><label class="conv-check"><input type="checkbox" id="ex-evaldate" ${state.evalDate ? "checked" : ""}>
          اكتب اليوم والتاريخ في نموذج التقييم — بلا تأشير تبقى نقاطاً تُملأ بخط اليد</label>`);
      }
    }
    if (state.grdBuf) {
      bits.push(`<p class="conv-hint">✓ قالب كشف الدرجات جاهز: <b>${esc(state.grdName)}</b></p>
        <label class="conv-check"><input type="checkbox" id="ex-withgrd" ${state.withGrd ? "checked" : ""}>
          أنشئ كشوف الدرجات أيضاً — كشف لكل مجموعة بأسمائها بالترتيب نفسه</label>`);
    }
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
        bits.push(`<h4 class="ex-head">${esc(t.track)} <span class="conv-hint">${ui.fmt(total)} طالباً · ${ui.fmt(t.groups.length)} مجموعة
          (${t.groups.map((g) => esc(g.name)).join("، ")})</span></h4>`);
        if (state.withEval) {
          const ev = evalFor(t.track);
          bits.push(ev
            ? `<p class="conv-hint">✓ نموذج التقييم: ${esc(ev.name)}</p>`
            : `<p class="conv-error">لا نموذج تقييم لهذا المسار — ارفعه في «نماذج التقييم»</p>`);
        }
        if (state.attBuf && state.withAtt) {
          const sys = sysTrainers(t.track);
          const val = trainersText(t.track);
          const note = !val ? ' <span class="conv-error">لا مدربين لهذا المسار في النظام — اكتبهم هنا</span>'
            : (t.track in state.trainers) ? "" : " <span class=\"conv-hint\">من النظام</span>";
          bits.push(`<div class="inv-form ex-trainers" data-track="${esc(t.track)}"><label class="field">
            <span>مدربو المسار (افصل بينهم بفاصلة)${note}</span>
            <input type="text" data-ex-trainers value="${esc(val)}" placeholder="${esc(sys || "اسراء خليل، انسام سليمان")}"></label></div>`);
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
      if (state.forms.length) {
        bits.push(`<div class="conv-grade-note"><b class="conv-label">نماذج محفوظة تُستخرج معها</b>
          <p class="conv-hint">تُملأ بالطلبة أنفسهم وبترتيبهم نفسه — من «قوالب التحويل».</p>
          ${state.forms.map((f) => `<label class="conv-check"><input type="checkbox" data-ex-form="${esc(f.id)}"
            ${state.pickForms.includes(f.id) ? "checked" : ""}> ${esc(f.name)} <span class="conv-hint">(${f.format === "docx" ? "Word" : "Excel"})</span></label>`).join("<br>")}
        </div>`);
      }
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
    const grd = state.withGrd && state.grdBuf;
    const made = [];
    if (state.oneFile && list.length > 1) {
      made.push({ name: `جداول الاختبارات - ${ui.todayISO()}.docx`, blob: await build(list) });
      if (att) made.push({ name: `كشوف الحضور - ${ui.todayISO()}.docx`, blob: await buildAtt(list) });
      if (grd) made.push({ name: `كشوف الدرجات - ${ui.todayISO()}.docx`, blob: await buildGrd(list) });
    } else {
      for (const t of list) {
        made.push({ name: `جدول اختبارات - ${t.track}.docx`, blob: await build([t]) });
        if (att) made.push({ name: `كشف الحضور - ${t.track}.docx`, blob: await buildAtt([t]) });
        if (grd) made.push({ name: `كشف الدرجات - ${t.track}.docx`, blob: await buildGrd([t]) });
      }
    }
    const noEval = [];
    if (state.withEval) {
      for (const t of list) {
        const ev = state.evals.length ? evalFor(t.track) : null;
        if (ev) made.push({ name: `التقييم - ${t.track}.docx`, blob: await buildEval(ev, t.track, t.groups) });
        else noEval.push(t.track);
      }
    }
    for (const id of state.pickForms) {
      const meta = state.forms.find((f) => f.id === id);
      if (!meta) continue;
      /* قالب محفوظ قد يكون كشفاً من كشوف الاختبارات (درجات أو حضور أو تقييم):
         يُبنى حينها ببانيها — بمدربيه وتوقيعه ومرحلته — لا بملء الأعمدة فقط. */
      const kind = await sheetKind(meta);
      for (const t of list) {
        if (kind) {
          made.push({ name: `${meta.name} - ${t.track}.docx`, blob: await buildPages(kind.buf, [t], kind.which) });
        } else {
          const out = await buildForm(meta, t.track, t.groups);
          made.push({ name: out.filename, blob: out.blob });
        }
      }
    }
    if (made.length === 1) ui.download(made[0].name, made[0].blob);
    else {
      const zip = new JSZip();
      made.forEach((x) => zip.file(x.name, x.blob));
      ui.download(`جداول الاختبارات - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    }
    // سكوتٌ عن نموذج تقييم مفقود يُوهم أن الملف خرج، فيُقال صراحةً
    ui.toast(noEval.length
      ? `أُنشئ ${ui.fmt(made.length)} ملفاً — بلا تقييم لـ: ${noEval.join("، ")}`
      : `أُنشئ ${ui.fmt(made.length)} ملفاً`);
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
    if ($("ex-grd")) $("ex-grd").addEventListener("change", onTpl("grd", "قالب كشف الدرجات"));

    /* نماذج التقييم: يُقرأ اسم المسار من كل نموذج ويُحفظ معه، وما كان
       لمسار سبق رفعه يحلّ محلّه بدل أن يتراكم. */
    if ($("ex-eval")) $("ex-eval").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      if (!files.length || !tplStore()) return;
      let done = 0, nameless = 0;
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const track = await evalTrack(buf);
        if (!track) { nameless++; continue; }
        const old = (await savedOf("eval")).filter((t) => t.track === track);
        await tplStore().save({
          name: f.name.replace(/\.docx$/i, ""), format: "docx", headers: [],
          kind: KINDS.eval, track, file: new Blob([buf], { type: f.type }),
        });
        for (const t of old) { try { await tplStore().remove(t.id); } catch (err) { /* يكفي تجاهلها */ } }
        done++;
      }
      state.evals = await savedOf("eval");
      render();
      ui.toast(nameless
        ? `حُفظ ${ui.fmt(done)} نموذجاً، و${ui.fmt(nameless)} بلا اسم مسار في عنوانه`
        : `حُفظ ${ui.fmt(done)} نموذج تقييم — لن تحتاج رفعها مرة أخرى`);
    });

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
    retry("grd")(0);
    const loadEvals = () => savedOf("eval").then((e) => {
      if (e.length === state.evals.length && e.every((x, i) => x.id === state.evals[i].id)) return;
      state.evals = e;
      render();
    });
    loadEvals();
    [1000, 3000, 8000].forEach((ms) => setTimeout(loadEvals, ms));
    const loadForms = () => savedForms().then((f) => {
      if (f.length === state.forms.length && f.every((x, i) => x.id === state.forms[i].id)) return;
      state.forms = f;
      render();
    });
    loadForms();
    [1000, 3000, 8000].forEach((ms) => setTimeout(loadForms, ms));
    if (App.store && App.store.onChange) App.store.onChange(() => {
      if (!state.tplBuf) loadSaved("tpl").then((ok) => { if (ok) render(); });
      if (!state.attBuf) loadSaved("att").then((ok) => { if (ok) render(); });
      if (!state.grdBuf) loadSaved("grd").then((ok) => { if (ok) render(); });
    });

    data.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) { state.rows = []; return render(); }
      if (!state.tplBuf) await loadSaved("tpl");
      if (!state.attBuf) await loadSaved("att");
      if (!state.grdBuf) await loadSaved("grd");
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
      if (e.target.id === "ex-withgrd") { state.withGrd = e.target.checked; return render(); }
      if (e.target.id === "ex-witheval") { state.withEval = e.target.checked; return render(); }
      if (e.target.id === "ex-evaldate") { state.evalDate = e.target.checked; return; }
      if (e.target.id === "ex-stage") { state.stage = e.target.value; return; }
      const fid = e.target.dataset.exForm;
      if (fid) {
        state.pickForms = e.target.checked
          ? state.pickForms.concat(fid)
          : state.pickForms.filter((x) => x !== fid);
        return;
      }
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

  App.examSheet = { init, build, buildAtt, buildGrd, buildEval, buildForm, evalFor, grouped, render, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
