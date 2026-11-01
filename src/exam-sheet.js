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
    tplBuf: null, tplName: "",
    rows: [], headers: [],
    map: { name: "", nid: "", track: "", group: "" },
    plan: {},            // لكل مجموعة: { theory:{date,time}, practical:[{date,time}] }
  };

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

  /* ===== بناء الملف ===== */
  async function build(track, groups) {
    const zip = await JSZip.loadAsync(state.tplBuf);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = firstTag(doc.documentElement, "body");
    const kids = [...body.children];
    const tables = kids.filter((k) => k.localName === "tbl");
    if (!tables.length) throw new Error("القالب بلا جداول — تأكّد أنه «قالب جدول الاختبارات»");
    const proto = tables[0];

    // عنوان المسار: الفقرة التي فيها «اسم المسار»
    kids.filter((k) => k.localName === "p").forEach((p) => {
      const t = tag(p, "t");
      const whole = t.map((x) => x.textContent).join("");
      if (/اسم المسار/.test(whole)) {
        t.slice(1).forEach((x) => { x.textContent = ""; });
        if (t[0]) t[0].textContent = `اسم المسار : ${track}`;
      }
    });

    // الصفوف النموذجية من الجدول الأول
    const pr = [...proto.children].filter((c) => c.localName === "tr");
    const rowGroup = pr[0], rowHead = pr[1], rowData = pr[2];
    const sig = kids.filter((k) => k.localName === "p").slice(-1)[0];

    // كل الجداول القديمة وما بينها من فقرات فارغة تُزال، ويُبقى العنوانان والتذييل
    const titleP = kids.filter((k) => k.localName === "p").slice(0, 2);
    const sectPr = kids.find((k) => k.localName === "sectPr");
    kids.forEach((k) => { if (k !== sectPr && !titleP.includes(k) && k !== sig) body.removeChild(k); });

    groups.forEach((g, gi) => {
      const plan = planOf(track, g.name);
      const tbl = proto.cloneNode(true);
      [...tbl.children].filter((c) => c.localName === "tr").forEach((tr) => tbl.removeChild(tr));
      // صفّ المجموعة
      const gr = rowGroup.cloneNode(true);
      setCell(cellsOf(gr)[0], `المجموعة ${ORDINAL[gi] || gi + 1}`);
      tbl.appendChild(gr);
      tbl.appendChild(rowHead.cloneNode(true));
      // الصفوف
      g.students.forEach((s, i) => {
        const tr = rowData.cloneNode(true);
        const c = cellsOf(tr);
        const donor = tag(c[0], "r")[0] || null;
        setCell(c[0], String(i + 1), donor);
        setCell(c[1], s.name, donor);
        setCell(c[2], s.nid, donor);
        // النظري في أول صف فقط، كما في النموذج
        const th = i === 0 ? plan.theory || {} : {};
        setCell(c[3], i === 0 ? dayOf(th.date) : "", donor);
        setCell(c[4], i === 0 ? fmtDate(th.date) : "", donor);
        setCell(c[5], i === 0 ? clean(th.time) : "", donor);
        // مواعيد العملي: موعد في كل صف من أعلى الجدول
        const p2 = (plan.practical || [])[i];
        setCell(c[6], p2 ? dayOf(p2.date) : "", donor);
        setCell(c[7], p2 ? fmtDate(p2.date) : "", donor);
        setCell(c[8], p2 ? clean(p2.time) : "", donor);
        tbl.appendChild(tr);
      });
      body.insertBefore(tbl, sig);
      if (gi < groups.length - 1) body.insertBefore(doc.createElementNS(W, "w:p"), sig);
    });

    const outXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
      + new XMLSerializer().serializeToString(doc);
    zip.file("word/document.xml", outXml);
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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

  /* ===== الواجهة ===== */
  function render() {
    const box = $("ex-body");
    if (!box) return;
    if (!state.rows.length) {
      box.innerHTML = state.tplBuf ? '<p class="conv-hint">✓ القالب جاهز. ارفع ملف الطلبة.</p>' : "";
      return;
    }
    const m = state.map;
    const sel = (key, label) => `<label class="field"><span>${label}</span>
      <select data-ex-map="${key}">${["", ...state.headers].map((h) => `<option value="${esc(h)}" ${m[key] === h ? "selected" : ""}>${h ? esc(h) : "— اختر —"}</option>`).join("")}</select></label>`;
    const bits = [`<p class="conv-hint">${state.tplBuf ? `✓ القالب: ${esc(state.tplName)}` : "⚠ لم يُرفع القالب بعد"} · ملف الطلبة: <b>${ui.fmt(state.rows.length)}</b> صفاً</p>`,
      `<div class="inv-form">${sel("name", "عمود الاسم")}${sel("nid", "رقم الهوية")}${sel("track", "المسار")}${sel("group", "المجموعة (اختياري)")}</div>`];

    if (m.name && m.track) {
      grouped().forEach((t) => {
        const total = t.groups.reduce((n, g) => n + g.students.length, 0);
        bits.push(`<h4 class="ex-head">${esc(t.track)} <span class="conv-hint">${ui.fmt(total)} طالباً · ${ui.fmt(t.groups.length)} مجموعة</span></h4>`);
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
      bits.push(`<div class="btn-row"><button type="button" class="btn navy" id="ex-run" ${state.tplBuf ? "" : "disabled"}>
        <span class="material-symbols-outlined btn-ico">description</span>أنشئ جداول الاختبارات</button></div>`);
    }
    box.innerHTML = bits.join("");
  }

  async function run() {
    const list = grouped();
    if (!list.length) { ui.toast("لا بيانات"); return; }
    const made = [];
    for (const t of list) {
      made.push({ name: `جدول اختبارات - ${t.track}.docx`, blob: await build(t.track, t.groups) });
    }
    if (made.length === 1) ui.download(made[0].name, made[0].blob);
    else {
      const zip = new JSZip();
      made.forEach((x) => zip.file(x.name, x.blob));
      ui.download(`جداول الاختبارات - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    }
    ui.toast(`أُنشئ ${ui.fmt(made.length)} جدولاً`);
  }

  function init() {
    const tpl = $("ex-tpl"), data = $("ex-data"), body = $("ex-body");
    if (!tpl || !data || !body) return;

    tpl.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) { state.tplBuf = null; return render(); }
      state.tplBuf = await f.arrayBuffer();
      state.tplName = f.name;
      render();
    });

    data.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) { state.rows = []; return render(); }
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

  App.examSheet = { init, build, grouped, render, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.App = window.App || {});
