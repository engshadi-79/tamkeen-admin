/* جرد العُهد والمواد — منقول من «نظام جرد مركز التدريب» الذي أرسله المستخدم.
   النموذج كما هو: مواقع، وأصناف، وعدّ يومي بجلستين (صباحي ومسائي) لكل موقع،
   وحالة كل صنف: مطابق / نقص / زيادة / بلا كمية كلية، وحركات بسجلّ قابل للتراجع.
   الكمية الفعلية لليوم = المسائي إن وُجد وإلا الصباحي.
   الاختلاف الوحيد عن الأصل: البيانات في مخزن تمكين المزامَن لا في localStorage وحده. */
(function (App) {
  const { store, ui } = App;
  const esc = ui.esc;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  /* ===== ثوابت الأصل ===== */
  const CATS = { machine: "مكنة", tool: "أداة", material: "مادة مستهلكة", furniture: "أثاث وتجهيزات" };
  const MOVES = {
    in: { t: "توريد / إدخال", sign: 1, c: "ok" },
    issue: { t: "إخراج للاستخدام", sign: -1, c: "prog" },
    back: { t: "إرجاع إلى المخزون", sign: 1, c: "ok" },
    out: { t: "صرف / إخراج", sign: -1, c: "prog" },
    consume: { t: "استهلاك", sign: -1, c: "over" },
    damage: { t: "تالف", sign: -1, c: "short" },
    loss: { t: "فقد", sign: -1, c: "short" },
    transfer: { t: "نقل إلى موقع آخر", sign: -1, c: "prog" },
    adjust: { t: "تسوية الكمية", sign: 0, c: "idle" },
  };
  /* نوع القياس يحدّد الوحدات المعقولة للصنف: ما يُعدّ لا يُوزن.
     والكميات كلها تُخزَّن بالوحدة الأساسية، والعبوة مجرّد معامل تحويل:
     «دستة = 12 قطعة» تعني أن إخراج دستة يخصم 12 من المخزون. */
  const MEASURES = { count: "عدد", weight: "وزن", length: "طول", volume: "حجم", area: "مساحة" };
  const UNIT_HINTS = {
    count: ["قطعة", "حبة", "زوج", "طقم", "ورقة"],
    weight: ["كجم", "جم", "طن"],
    length: ["متر", "سم", "ملم"],
    volume: ["لتر", "مل", "جالون"],
    area: ["م²", "سم²"],
  };
  const PACK_HINTS = ["دستة", "كرتونة", "علبة", "عبوة", "كيس", "رزمة", "لفة", "بكرة", "ربطة", "طقم"];
  const measureOf = (i) => (i && MEASURES[i.measure]) ? i.measure : "count";
  const baseUnit = (i) => normName((i && i.unit) || "") || (measureOf(i) === "count" ? "قطعة" : "");

  /* سُلّم الوحدات: الوحدة الأساسية أولاً ثم ما فوقها، لكل مستوى كم يضمّ
     من المستوى الذي تحته. «دفتر فيه 20 عبوة، والعبوة فيها 10 شفرات»
     يصير: [شفرة ×1] [عبوة ×10 = 10] [دفتر ×20 = 200].
     كل الكميات تُخزَّن بالوحدة الأساسية، والسُلّم للعرض والتحويل فقط. */
  function ladder(i) {
    const out = [{ name: baseUnit(i), n: 1, factor: 1 }];
    const raw = Array.isArray(i && i.units) ? i.units : null;
    if (raw) {
      let f = 1;
      raw.forEach((lv, k) => {
        if (!k) return;                       // المستوى الأول هو الأساسية نفسها
        const n = Math.max(1, +lv.n || 1);
        f *= n;
        out.push({ name: normName(lv.name) || `وحدة ${k}`, n, factor: f });
      });
      return out;
    }
    // توافق مع الصيغة السابقة: عبوة واحدة بمعاملها
    if (i && i.pack && +i.packQty > 0) out.push({ name: i.pack, n: +i.packQty, factor: +i.packQty });
    return out;
  }
  const topUnit = (i) => { const L = ladder(i); return L[L.length - 1]; };
  const packOf = (i) => { const L = ladder(i); return L.length > 1 ? { name: L[L.length - 1].name, n: L[L.length - 1].factor } : null; };
  /* الكمية بوحدة الاستهلاك اليومي: «80 عبوة» بدل «800 شفرة» */
  function useText(i, v) {
    if (v == null) return "—";
    const ul = useLevel(i);
    return `${fmtN(r3(v / ul.factor))} ${ul.name}`;
  }
  /* السطر الصغير تحت الرقم: الكمية نفسها بوحدة أصغر مفهومة */
  function subText(i, v) {
    const L = ladder(i);
    if (L.length === 1 || !v) return "";
    const big = qtyParts(i, v);
    // المقابل بوحدة الاستهلاك، فإن كان هو نفسه فبالوحدة الأساسية
    const asUse = useText(i, v);
    if (big !== asUse && !/\./.test(asUse.split(" ")[0])) return asUse;
    const base = `${fmtN(v)} ${L[0].name}`;
    return big === base ? "" : base;
  }
  /* المستوى الذي يُكتب به استهلاك اليوم */
  function useLevel(i) {
    const L = ladder(i);
    const k = Math.min(Math.max(0, +(i && i.useUnit) || 0), L.length - 1);
    return Object.assign({ k }, L[k]);
  }

  /* تفكيك كمية أساسية إلى «4 دفتر، 15 عبوة، 5 شفرة» */
  function qtyParts(i, v) {
    if (v == null) return "—";
    const L = ladder(i);
    if (L.length === 1) return `${fmtN(v)}${L[0].name ? ` ${L[0].name}` : ""}`;
    let rest = v;
    const out = [];
    for (let k = L.length - 1; k >= 0; k--) {
      const f = L[k].factor;
      const n = k ? Math.floor(r3(rest) / f) : r3(rest / f);
      if (n > 0 || (!out.length && !k)) out.push(`${fmtN(n)} ${L[k].name}`);
      rest = r3(rest - n * f);
    }
    return out.length ? out.join("، ") : `0 ${L[0].name}`;
  }
  /* نصّ الكمية: التفكيك أولاً ومعه الأصل بالوحدة الأساسية */
  function qtyText(i, v) {
    if (v == null) return "—";
    const L = ladder(i);
    const parts = qtyParts(i, v);
    const base = `${fmtN(v)} ${L[0].name}`.trim();
    if (L.length === 1 || parts === base) return base;   // لا يُكرَّر الرقم نفسه بين قوسين
    return `${parts} (${base})`;
  }
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const SES = { m: "صباحي", e: "مسائي" };
  const NAV = [["dash", "لوحة المتابعة"], ["count", "الجرد اليومي"], ["week", "كشف الأسبوع"],
    ["items", "الأصناف"], ["moves", "الحركات"], ["settings", "الإعدادات"]];
  const NAVI = { dash: "space_dashboard", count: "fact_check", week: "calendar_view_week", items: "inventory_2", moves: "swap_horiz", settings: "settings" };
  /* سطر إرشاد لكل شاشة: من يستخدمها وما الخطوة المطلوبة فيها */
  const HINTS = {
    dash: "متابعة المشرف: أي موقع جرد اليوم وأي جلسة بقيت، ومعها نواقص اليوم والأصناف التي بلغت حدّها الأدنى.",
    count: "شاشة المدرّب اليومية: الأدوات تُعدّ (اكتب العدد أو اضغط «مطابق»)، والمواد المستهلكة تُخرَج من المخزون ثم يُسجَّل استهلاك اليوم منها. وفي النهاية أغلِق الجلسة.",
    week: "كشف جاهز للطباعة لكل موقع: صباحي ومسائي والكمية الفعلية لكل يوم عمل في الأسبوع.",
    items: "سجلّ الأصناف وكمياتها الكلية وحدودها الدنيا. الرفع المتكرر لملف الجرد يُحدِّث الأصناف ولا يكرّرها.",
    moves: "كل زيادة أو نقص في الكميات: توريد، صرف، استهلاك، تالف، فقد، نقل، تسوية. ولكل حركة تراجُع.",
    settings: "اسم المركز والدورة وأيام العمل والمواقع. حذف موقع يحتاج نقل أصنافه أولاً.",
  };

  /* ===== أدوات ===== */
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isoOf = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); };
  const today = () => isoOf(new Date());
  const pISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = pISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
  const fmtD = (s) => { if (!s) return ""; const [y, m, d] = String(s).split("-"); return `${+d}/${+m}/${y}`; };
  const dayName = (s) => DAYS[pISO(s).getDay()];
  const weekOf = (s) => { const d = pISO(s); d.setDate(d.getDate() - d.getDay()); return isoOf(d); };
  const num = (v) => (v === "" || v == null || isNaN(+v)) ? null : +v;
  /* الكميات الكسرية (نصف دستة مثلاً) تُقرَّب فلا تتراكم أخطاء الفاصلة العائمة */
  const r3 = (v) => Math.round((+v + Number.EPSILON) * 1000) / 1000;
  const fmtN = (v) => v == null ? "—" : (Math.round(v * 100) / 100).toLocaleString("en-US");
  const fmtIn = (v) => v == null ? "" : String(Math.round(v * 1000) / 1000);
  const fmtT = (ts) => new Date(ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  const normName = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const toast = (m) => ui.toast(m);

  /* ===== المخزن: أقسام مزامَنة بدل localStorage وحده ===== */
  const locs = () => (store.get().invLocs = store.get().invLocs || []);
  const items = () => (store.get().invItems = store.get().invItems || []);
  const counts = () => (store.get().invCounts = store.get().invCounts || []);
  const moves = () => (store.get().invMoves = store.get().invMoves || []);
  const meta = () => (store.get().invMeta = Object.assign(
    { center: "مركز مسارات التمكين", course: "الدورة الحالية", workDays: [0, 1, 2, 3, 4] },
    store.get().invMeta));
  const save = () => store.save();

  const locById = (id) => locs().find((l) => l.id === id);
  const itemById = (id) => items().find((i) => i.id === id);
  const itemsOf = (loc) => items().filter((i) => i.loc === loc && i.active !== false);
  const workDates = (ws) => [...meta().workDays].sort((a, b) => a - b).map((k) => addDays(ws, k));

  /* أول تشغيل: المواقع من مسارات تمكين، ومعها الإدارة والمخزن */
  function ensureLocs() {
    if (locs().length) return;
    (store.get().tracks || []).forEach((t) => { if (t.name) locs().push({ id: uid("l"), name: t.name, type: "track" }); });
    locs().push({ id: "admin", name: "غرفة الإدارة", type: "admin" }, { id: "store", name: "المخزن الرئيسي", type: "store" });
    save();
  }

  const countKeyOf = (date, loc) => `${date}|${loc}`;
  function cnt(date, loc, create) {
    let c = counts().find((x) => x.id === countKeyOf(date, loc));
    if (!c) {
      if (!create) return null;
      c = { id: countKeyOf(date, loc), date, loc, m: {}, e: {}, x: { m: {}, e: {} }, n: {}, done: {}, use: {} };
      counts().push(c);
    }
    c.x = c.x || { m: {}, e: {} }; c.n = c.n || {}; c.done = c.done || {}; c.use = c.use || {};
    return c;
  }

  /* المتوقع لحظة العدّ: ما ثُبِّت وقت التسجيل، وإلا الكمية الكلية الحالية */
  function expOf(c, ses, item) {
    if (c && c[ses] && c[ses][item.id] != null && c.x && c.x[ses] && item.id in c.x[ses]) return c.x[ses][item.id];
    return item.qty == null ? null : item.qty;
  }
  const st = (v, exp) => v == null ? "empty" : exp == null ? "nobase" : v === exp ? "ok" : v < exp ? "short" : "over";
  function actualInfo(date, loc, item) {
    const c = cnt(date, loc);
    if (!c) return null;
    const ses = c.e[item.id] != null ? "e" : c.m[item.id] != null ? "m" : null;
    if (!ses) return null;
    const v = c[ses][item.id], x = expOf(c, ses, item);
    return { v, x, ses, s: st(v, x) };
  }
  /* صنف يُصرف للاستخدام ثم يُستهلك منه يومياً: المواد المستهلكة افتراضاً،
     ويمكن تشغيله أو إطفاؤه لأي صنف من نافذة الصنف.
     المخزون (qty) ← إخراج للاستخدام ← قيد الاستخدام (inUse) ← استهلاك اليوم. */
  const isUse = (i) => (i && i.use != null) ? !!i.use : (i && i.cat === "material");
  const inUseOf = (i) => (i && i.inUse != null) ? i.inUse : 0;
  const usedOn = (date, loc, id) => { const c = cnt(date, loc); const v = c && c.use ? c.use[id] : null; return v == null ? null : v; };

  function progress(date, loc, ses) {
    const its = itemsOf(loc), c = cnt(date, loc);
    const r = { total: its.length, n: 0, ok: 0, short: 0, over: 0, nobase: 0, empty: 0, used: 0, useTotal: 0, done: (c && c.done[ses]) || null };
    its.forEach((i) => {
      // المواد المستهلكة تُسجَّل بالاستهلاك لا بالعدّ، فتُحسب مُنجزة متى سُجّل استهلاك اليوم
      if (isUse(i)) {
        r.useTotal++;
        if (usedOn(date, loc, i.id) != null) { r.n++; r.ok++; r.used++; }
        return;
      }
      const v = c ? c[ses][i.id] : null;
      if (v != null) { r.n++; r[st(v, expOf(c, ses, i))]++; }
    });
    return r;
  }

  /* ===== حالة الواجهة ===== */
  const u = {
    view: "dash", loc: null, date: today(), ses: "m", filter: "all", q: "",
    week: null, weekLoc: null, iLoc: "all", iCat: "all", iQ: "",
    mLoc: "all", mType: "all",
  };

  function go(v, opts) {
    Object.assign(u, opts || {});
    if (v) u.view = v;
    render();
  }

  /* ===== عناصر مشتركة ===== */
  const locOptions = (sel, withAll, allLabel) =>
    (withAll ? `<option value="all">${allLabel || "كل المواقع"}</option>` : "") +
    locs().map((l) => `<option value="${l.id}" ${sel === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("");
  const catOptions = (sel) => Object.keys(CATS).map((k) => `<option value="${k}" ${sel === k ? "selected" : ""}>${CATS[k]}</option>`).join("");
  function sesPill(p) {
    if (!p.total) return '<span class="pill idle">لا أصناف</span>';
    if (p.done) return `<span class="pill ok">مُغلق ${fmtT(p.done)}</span>`;
    if (p.n) return `<span class="pill prog">جارٍ ${p.n} من ${p.total}</span>`;
    return '<span class="pill idle">لم يبدأ</span>';
  }

  /* ===== الشاشات ===== */
  const VIEWS = {}, AFTER = {};

  /* --- لوحة المتابعة --- */
  VIEWS.dash = () => {
    const t = today(), ws = weekOf(t), wd = workDates(ws);
    const isWork = meta().workDays.includes(pISO(t).getDay());
    /* أول استخدام: ثلاث خطوات مرقَّمة بدل لوحة فارغة لا يُعرف من أين تُبدأ */
    if (!items().filter((i) => i.active !== false).length) {
      return `
      <div class="head"><div><h1>${esc(meta().center)}</h1><p class="lead">جرد العُهد والمواد — لم تُسجَّل أصناف بعد</p></div></div>
      <div class="card start-card">
        <h2 style="margin-top:0">ابدأ بثلاث خطوات</h2>
        <ol class="start-steps">
          <li><b>أدخِل الأصناف</b><span>ارفع ملف الجرد (مصنّف Excel فيه ورقة لكل مسار) فيُنشأ لكل ورقة موقعٌ بأصنافه، أو أضف الأصناف يدوياً.</span>
            <div class="bar"><button class="btn" type="button" data-act="import">ارفع ملف الجرد</button>
              <button class="btn secondary" type="button" data-go="items">إضافة يدوية</button></div></li>
          <li><b>راجع المواقع وأيام العمل</b><span>المواقع تُنشأ من مسارات تمكين، ومعها غرفة الإدارة والمخزن. عدّل الأسماء وأيام العمل من الإعدادات.</span>
            <div class="bar"><button class="btn secondary" type="button" data-go="settings">الإعدادات</button></div></li>
          <li><b>الجرد اليومي</b><span>كل مدرّب يفتح موقعه ويختار الجلسة، فيكتب العدد الموجود أو يضغط «مطابق»، ثم يُغلق الجلسة فتُسجَّل النواقص حركاتٍ تلقائياً.</span></li>
        </ol>
      </div>`;
    }
    const rows = locs().map((l) => {
      const pm = progress(t, l.id, "m"), pe = progress(t, l.id, "e");
      const short = itemsOf(l.id).filter((i) => { const a = actualInfo(t, l.id, i); return a && a.s === "short"; }).length;
      return `<tr><td><b>${esc(l.name)}</b></td><td>${sesPill(pm)}</td><td>${sesPill(pe)}</td>
        <td class="n">${short ? `<span class="pill short">${short}</span>` : '<span class="sub">—</span>'}</td>
        <td class="noprint"><button class="btn small" data-go="count" data-loc="${l.id}">فتح الجرد</button></td></tr>`;
    }).join("");
    let closedWeek = 0, totalWeek = 0;
    wd.forEach((d) => locs().forEach((l) => { if (!itemsOf(l.id).length) return; totalWeek += 2; const c = cnt(d, l.id); if (c && c.done.m) closedWeek++; if (c && c.done.e) closedWeek++; }));
    const alerts = [];
    locs().forEach((l) => itemsOf(l.id).forEach((i) => {
      const a = actualInfo(t, l.id, i);
      if (a && a.s === "short") alerts.push({ c: "var(--short)", h: `<b>${esc(i.name)}</b> ناقص ${fmtN(a.x - a.v)}`, s: `${esc(l.name)} — جلسة ${SES[a.ses]}` });
      const have = (i.qty == null ? 0 : i.qty) + inUseOf(i);
      if (i.min && i.qty != null && have <= i.min) alerts.push({ c: "var(--over)", h: `<b>${esc(i.name)}</b> بلغ الحدّ الأدنى`, s: `${esc(l.name)} — المتبقي ${qtyParts(i, have)} والحدّ ${qtyParts(i, i.min)}` });
      if (isUse(i) && inUseOf(i) === 0 && i.qty != null && i.qty > 0) alerts.push({ c: "var(--nobase)", h: `<b>${esc(i.name)}</b> انتهى ما هو قيد الاستخدام`, s: `${esc(l.name)} — في المخزون ${qtyParts(i, i.qty)}، أخرِج كمية جديدة` });
    }));
    const recent = moves().slice(0, 6);
    const wkGrid = `<div class="wk"><div class="c hd" style="display:grid;grid-template-columns:1fr repeat(${wd.length},auto);gap:6px">
        <span class="ln">الموقع</span>${wd.map((d) => `<span class="hd">${dayName(d).slice(0, 3)}</span>`).join("")}</div>
      ${locs().filter((l) => itemsOf(l.id).length).map((l) => `<div style="display:grid;grid-template-columns:1fr repeat(${wd.length},auto);gap:6px;align-items:center">
        <span class="ln">${esc(l.name)}</span>
        ${wd.map((d) => { const c = cnt(d, l.id); const n = (c && c.done.m ? 1 : 0) + (c && c.done.e ? 1 : 0);
          return `<span class="c"><i class="${n === 2 ? "d" : n === 1 ? "p" : ""}" title="${dayName(d)} ${fmtD(d)}"></i></span>`; }).join("")}
      </div>`).join("")}</div>`;
    return `
      <div class="head"><div><h1>${esc(meta().center)}</h1><p class="lead">${esc(meta().course)}، ${dayName(t)} ${fmtD(t)}${isWork ? "" : " — ليس يوم عمل"}</p></div>
        <div class="bar noprint"><button class="btn" data-go="count">جرد جديد</button><button class="btn secondary" data-go="moves">تسجيل حركة</button></div></div>
      <div class="card"><div class="stats">
        <div><b>${items().filter((i) => i.active !== false).length}</b>صنف مسجّل</div>
        <div><b>${locs().length}</b>موقع</div>
        <div><b>${closedWeek} / ${totalWeek}</b>جلسات أُغلقت هذا الأسبوع</div>
        <div><b>${moves().length}</b>حركة مسجّلة</div>
      </div></div>
      <div class="inv-grid2">
        <div class="inv-stack">
          <div class="card"><h2>جرد اليوم</h2>
            <div class="table-wrap"><table><thead><tr><th>الموقع</th><th>صباحي</th><th>مسائي</th><th class="n">نواقص</th><th class="noprint"></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">لا مواقع بعد.</td></tr>'}</tbody></table></div>
          </div>
          <div class="card"><h2>سجل جلسات الأسبوع</h2>${wkGrid}</div>
        </div>
        <div class="inv-stack">
          <div class="card"><h2>تنبيهات</h2>${alerts.length
            ? `<ul class="alerts">${alerts.slice(0, 12).map((a) => `<li><span class="dot" style="background:${a.c}"></span><div style="flex:1">${a.h}<div class="sub">${a.s}</div></div></li>`).join("")}</ul>`
            : '<div class="empty">لا توجد تنبيهات اليوم.</div>'}</div>
          <div class="card"><h2>آخر الحركات</h2>${recent.length
            ? `<ul class="alerts">${recent.map((m) => `<li><span class="pill ${MOVES[m.type].c}">${MOVES[m.type].t}</span><div style="flex:1"><b>${esc(m.itemName)}</b> <span class="muted">${moveQtyText(m)}</span><div class="sub">${esc((locById(m.loc) || {}).name || "")} ${fmtD(m.date)}</div></div></li>`).join("")}</ul>`
            : '<div class="empty">لم تُسجّل أي حركة بعد.</div>'}</div>
        </div>
      </div>`;
  };

  /* --- الجرد اليومي: الشاشة الأساسية --- */
  VIEWS.count = () => {
    if (!locById(u.loc)) u.loc = (locs().find((l) => itemsOf(l.id).length) || locs()[0] || {}).id;
    const loc = locById(u.loc);
    const c = cnt(u.date, u.loc), closed = !!(c && c.done[u.ses]);
    const all = u.loc ? itemsOf(u.loc) : [];
    return `
      <div class="count-top">
        <div class="head" style="margin-bottom:10px"><div><h1>الجرد اليومي</h1>
          <p class="lead">${esc((loc || {}).name || "—")}، جلسة ${SES[u.ses]} ليوم ${dayName(u.date)} ${fmtD(u.date)}</p></div>
          <div class="bar noprint pick-bar">
            <label class="pick"><small>الموقع</small><select data-set="loc" aria-label="الموقع">${locOptions(u.loc)}</select></label>
            <label class="pick"><small>التاريخ</small><input type="date" value="${u.date}" data-set="date" aria-label="التاريخ"></label>
            <label class="pick"><small>الجلسة</small>
              <div class="seg">${Object.keys(SES).map((k) => `<button type="button" class="${u.ses === k ? "on" : ""}" data-ses="${k}">${SES[k]}</button>`).join("")}</div></label>
          </div>
        </div>
        <div id="inv-prog"></div>
        <div class="next-step carry-step" id="inv-carry" hidden></div>
        <div class="next-step base-step" id="inv-base" hidden></div>
        <div class="next-step" id="inv-next" hidden></div>
        <div class="bar noprint" style="margin-top:10px">
          <div class="search"><input type="search" placeholder="ابحث عن صنف" value="${esc(u.q)}" id="inv-q"></div>
          <span id="inv-chips" class="bar"></span>
          <span class="spacer"></span>
          ${closed ? `<button class="btn secondary" data-act="reopen">إعادة فتح الجلسة</button>` : `
            ${u.ses === "e" ? `<button class="btn secondary" data-act="copym">نسخ من الصباحي</button>` : ""}
            <button class="btn secondary" data-act="fill">تعبئة المتبقي بالمتوقع</button>
            <button class="btn navy" data-act="close">إغلاق الجلسة</button>`}
        </div>
        ${closed ? `<div class="closed-banner">الجلسة مغلقة منذ ${fmtT(c.done[u.ses])}. لتعديل الأرقام أعد فتحها.</div>` : ""}
      </div>
      <div id="inv-rows" class="${closed ? "locked" : ""}">${all.length ? "" : `<div class="card empty">
        <p style="margin:0 0 4px">لا توجد أصناف في <b>${esc((loc || {}).name || "هذا الموقع")}</b>، فلا شيء يُجرد بعد.</p>
        <p class="sub" style="margin:0 0 12px">أضف أصنافه يدوياً، أو ارفع ملف الجرد وفيه ورقة لكل مسار.</p>
        <button class="btn" data-go="items">أضف أصنافاً</button>
        <button class="btn secondary" data-act="import">ارفع ملف Excel</button></div>`}</div>`;
  };
  AFTER.count = () => { drawProgress(); drawRows(); };

  function drawProgress() {
    const p = progress(u.date, u.loc, u.ses);
    const w = (k) => p.total ? (p[k] / p.total * 100) : 0;
    const box = $("#inv-prog");
    if (!box) return;
    box.innerHTML = `
      <div class="meter" role="img" aria-label="تقدم الجرد"><i class="m-ok" style="width:${w("ok")}%"></i><i class="m-short" style="width:${w("short")}%"></i><i class="m-over" style="width:${w("over")}%"></i><i class="m-nb" style="width:${w("nobase")}%"></i></div>
      <div class="meter-legend"><span>تم جرد <b>${p.n}</b> من <b>${p.total}</b></span>
        <span style="color:var(--c-ok)">مطابق <b>${p.ok}</b></span>
        <span style="color:var(--short)">نقص <b>${p.short}</b></span>
        <span style="color:var(--over)">زيادة <b>${p.over}</b></span>
        ${p.nobase ? `<span>بلا كمية كلية <b>${p.nobase}</b></span>` : ""}</div>`;
    const chips = [["all", "الكل", p.total], ["todo", "لم يُجرد", p.total - p.n], ["diff", "الفروقات", p.short + p.over]];
    $("#inv-chips").innerHTML = chips.map(([k, t, n]) => `<button type="button" class="chip ${u.filter === k ? "on" : ""}" data-chip="${k}">${t}<b>${n}</b></button>`).join("");
    /* يوم جديد: يُسأل عن مصير ما بقي قيد الاستخدام قبل أن يبدأ التسجيل */
    const cb = $("#inv-carry");
    if (cb) {
      const st = carryState();
      cb.hidden = !st;
      if (st) {
        const sum = st.left.map((i) => `<b>${esc(i.name)}</b> ${esc(qtyParts(i, inUseOf(i)))}`).slice(0, 3).join("، ");
        cb.innerHTML = `<span class="material-symbols-outlined">wb_twilight</span>
          <div>${st.left.length
            ? `بقي من آخر يوم عمل قيد الاستخدام: ${sum}${st.left.length > 3 ? ` وغيرها (${st.left.length - 3})` : ""}.`
            : `لا شيء قيد الاستخدام في ${st.mats.length} مادة.`}
            <small>${st.left.length ? "يستمر كما هو ما لم تُخرج كمية جديدة من المخزون." : "أخرِج كميات اليوم من المخزون ليُسجَّل استهلاكها."}</small></div>
          <button class="btn secondary noprint" type="button" data-act="carry-keep">أبقِ ما بقي</button>
          <button class="btn navy noprint" type="button" data-act="carry-dlg">أخرِج كمية جديدة</button>`;
      }
    }
    /* أصناف بلا كمية كلية: لا يعرف لها النظام متوقَّعاً فتظهر «جديد» ولا
       تُحسب نقصاً ولا زيادة. يُعرض الطريق إلى اعتمادها بدل تركه مجهولاً. */
    const base = $("#inv-base");
    if (base) {
      const its = itemsOf(u.loc).filter((i) => !isUse(i));
      const none = its.filter((i) => i.qty == null);
      const counted = none.filter((i) => rowState(i).v != null);
      base.hidden = !none.length || !!p.done;
      if (!base.hidden) {
        base.innerHTML = `<span class="material-symbols-outlined">help</span>
          <div><b>${none.length}</b> صنفاً بلا كمية كلية مسجّلة، فلا يعرف النظام المتوقَّع منها وتظهر «جديد».
            <small>${counted.length
              ? `عُدَّ منها ${counted.length}. اعتمد الأرقام المعدودة كمياتٍ كلية الآن، أو اتركها لتُعتمد عند إغلاق الجلسة.`
              : "عُدَّها اليوم ثم اعتمد أرقامها، أو اكتب كمياتها في شاشة «الأصناف»."}</small></div>
          ${counted.length ? `<button class="btn secondary noprint" type="button" data-act="set-base">اعتمد ${counted.length} رقماً</button>` : ""}`;
      }
    }
    /* الخطوة التالية مكتوبة صراحة، فلا يحتاج المدرّب أن يخمّن ماذا يفعل بعد العدّ */
    const nx = $("#inv-next");
    if (nx) {
      const closed = !!p.done;
      nx.hidden = !p.total || closed;
      if (!nx.hidden) {
        nx.className = "next-step " + (p.n === p.total ? "ready" : "");
        nx.innerHTML = p.n === p.total
          ? `<span class="material-symbols-outlined">task_alt</span>
             <div>عُدَّت كل الأصناف (${p.total})${p.short + p.over ? ` ومعها ${p.short + p.over} فرقاً` : " وكلها مطابقة"}.
               <small>الخطوة الأخيرة: إغلاق الجلسة لتثبيت الأرقام وتسجيل النواقص.</small></div>
             <button class="btn navy noprint" type="button" data-act="close">إغلاق الجلسة</button>`
          : `<span class="material-symbols-outlined">pending_actions</span>
             <div>بقي <b>${p.total - p.n}</b> صنفاً لم يُعدّ في جلسة ${SES[u.ses]}.
               <small>اعرض المتبقي فقط ثم اكتب العدد أو اضغط «مطابق» في كل صف.</small></div>
             <button class="btn secondary noprint" type="button" data-chip="todo">اعرض المتبقي</button>`;
      }
    }
  }

  function rowState(item) {
    const c = cnt(u.date, u.loc);
    const v = c ? (c[u.ses][item.id] == null ? null : c[u.ses][item.id]) : null;
    const x = expOf(c, u.ses, item);
    return { v, x, m: c ? (c.m[item.id] == null ? null : c.m[item.id]) : null, note: (c && c.n[item.id]) || "", s: st(v, x) };
  }

  /* صفّ المادة المستهلكة: ثلاث خانات متتابعة — المخزون، ثم قيد الاستخدام،
     ثم استهلاك اليوم الذي يُخصم من قيد الاستخدام لا من المخزون. */
  function useRowHTML(item) {
    const c = cnt(u.date, u.loc);
    const note = (c && c.n[item.id]) || "";
    const used = usedOn(u.date, u.loc, item.id);
    const inU = inUseOf(item);
    const stock = item.qty == null ? null : item.qty;
    const L = ladder(item), multi = L.length > 1, ul = useLevel(item), top = L[L.length - 1];
    const low = item.min && stock != null && stock + inU <= item.min;
    return `<div class="row use ${used != null ? "st-ok" : ""} ${low ? "is-low" : ""}" data-id="${item.id}">
      <div class="nm"><b>${esc(item.name)}</b><span class="uu">${L.map((lv, k) => k ? `${esc(lv.name)} = ${fmtN(lv.n)} ${esc(L[k - 1].name)}` : esc(lv.name)).join(" — ")}${item.group ? `، ${esc(item.group)}` : ""}</span>${item.desc ? `<span class="d" title="${esc(item.desc)}">${esc(item.desc)}</span>` : ""}${note ? `<span class="nt">ملاحظة: ${esc(note)}</span>` : ""}</div>
      <div class="kv"><small>في المخزون</small><b>${multi ? qtyParts(item, stock) : fmtN(stock)}</b>${multi ? `<i>${esc(subText(item, stock))}</i>` : ""}</div>
      <div class="kv in-use"><small>قيد الاستخدام</small><b>${multi ? qtyParts(item, inU) : fmtN(inU)}</b>${multi ? `<i>${esc(subText(item, inU))}</i>` : ""}
        ${multi && top.factor > ul.factor ? `<span class="use-bar" title="ما بقي من ${esc(top.name)} المُخرَج"><i style="width:${Math.max(0, Math.min(100, (inU % top.factor || (inU ? top.factor : 0)) / top.factor * 100))}%"></i></span>` : ""}</div>
      <button type="button" class="okb issue" data-issue title="إخراج كمية من المخزون إلى قيد الاستخدام">أخرِج</button>
      <div class="step"><button type="button" data-ubump="-1" aria-label="إنقاص">−</button><input type="number" inputmode="decimal" min="0" step="any" value="${used == null ? "" : fmtIn(used / ul.factor)}" placeholder="—" aria-label="استهلاك اليوم من ${esc(item.name)} بوحدة ${esc(ul.name)}" data-use><button type="button" data-ubump="1" aria-label="زيادة">+</button></div>
      <div class="diff">${used == null ? `<span class="sub">استهلاك اليوم<br>${esc(ul.name)}</span>`
        : used === 0 ? '<span class="pill ok">بلا استهلاك</span>'
        : `<span class="pill over">−${fmtN(used / ul.factor)} ${esc(ul.name)}</span>`}${low ? '<span class="pill short">بلغ الحدّ</span>' : ""}</div>
      <div class="row-tools">
        <button type="button" class="icon-btn ${note ? "has" : ""}" data-note title="ملاحظة على هذا الصنف" aria-label="ملاحظة"><span class="material-symbols-outlined btn-ico">sticky_note_2</span></button>
        ${inU > 0 ? '<button type="button" class="icon-btn" data-back title="إرجاع ما بقي قيد الاستخدام إلى المخزون" aria-label="إرجاع"><span class="material-symbols-outlined btn-ico">undo</span></button>' : "<span></span>"}
        <button type="button" class="icon-btn on" data-totool title="أعِده أداةً تُعدّ وتُطابَق" aria-label="أعِده أداة"><span class="material-symbols-outlined btn-ico">water_drop</span></button>
      </div>
    </div>`;
  }

  function rowHTML(item) {
    if (isUse(item)) return useRowHTML(item);
    const r = rowState(item);
    const diff = r.s === "short" || r.s === "over"
      ? `<span class="pill ${r.s}">${r.s === "short" ? "−" : "+"}${fmtN(Math.abs(r.v - r.x))}</span>`
      : r.s === "ok" ? '<span class="pill ok">مطابق</span>'
      : r.s === "nobase" ? '<span class="pill nobase">جديد</span>' : '<span class="sub">—</span>';
    return `<div class="row ${u.ses === "e" ? "eve" : ""} st-${r.s}" data-id="${item.id}">
      <div class="nm"><b>${esc(item.name)}</b><span class="uu">${esc(item.unit || "")}${item.note ? `، ${esc(item.note)}` : ""}</span>${item.desc ? `<span class="d" title="${esc(item.desc)}">${esc(item.desc)}</span>` : ""}${r.note ? `<span class="nt">ملاحظة: ${esc(r.note)}</span>` : ""}</div>
      <div class="kv"><small>المتوقع</small><b>${fmtN(r.x)}</b></div>
      ${u.ses === "e" ? `<div class="kv"><small>الصباحي</small><b>${fmtN(r.m)}</b></div>` : "<div></div>"}
      <div class="step"><button type="button" data-bump="-1" aria-label="إنقاص">−</button><input type="number" inputmode="decimal" min="0" value="${r.v == null ? "" : r.v}" placeholder="—" aria-label="العدد الفعلي ${esc(item.name)}" data-val><button type="button" data-bump="1" aria-label="زيادة">+</button></div>
      ${r.x != null ? `<button type="button" class="okb ${r.s === "ok" ? "done" : ""}" data-same="${r.x}" title="تسجيل العدد المتوقع ${fmtN(r.x)}">مطابق</button>` : "<span></span>"}
      <div class="diff">${diff}</div>
      <div class="row-tools">
        <button type="button" class="icon-btn ${r.note ? "has" : ""}" data-note title="ملاحظة على هذا الصنف" aria-label="ملاحظة"><span class="material-symbols-outlined btn-ico">sticky_note_2</span></button>
        ${r.v != null ? '<button type="button" class="icon-btn" data-clear title="مسح العدد" aria-label="مسح العدد"><span class="material-symbols-outlined btn-ico">backspace</span></button>' : "<span></span>"}
        <button type="button" class="icon-btn" data-tomat title="حوّله إلى مادة مستهلكة: مخزون، وقيد استخدام، واستهلاك يومي" aria-label="حوّله إلى مادة مستهلكة"><span class="material-symbols-outlined btn-ico">water_drop</span></button>
      </div>
    </div>`;
  }

  function drawRows() {
    const wrap = $("#inv-rows");
    if (!wrap) return;
    const all = u.loc ? itemsOf(u.loc) : [];
    if (!all.length) return;
    const q = normName(u.q);
    const list = all.filter((i) => {
      if (q && !(i.name.includes(q) || String(i.group || "").includes(q))) return false;
      if (u.filter === "all") return true;
      if (isUse(i)) return u.filter === "todo" ? usedOn(u.date, u.loc, i.id) == null : false;
      const s = rowState(i).s;
      return u.filter === "todo" ? s === "empty" : (s === "short" || s === "over");
    });
    if (!list.length) {
      wrap.innerHTML = `<div class="card empty">${u.filter === "todo" ? "تم جرد كل الأصناف في هذه الجلسة." : u.filter === "diff" ? "لا توجد فروقات حتى الآن." : "لا يوجد صنف بهذا الاسم."}</div>`;
      return;
    }
    const secs = new Map();
    list.forEach((i) => { const k = i.group ? i.group : CATS[i.cat] || "أخرى"; if (!secs.has(k)) secs.set(k, []); secs.get(k).push(i); });
    wrap.innerHTML = [...secs].map(([k, its]) => {
      const n = its.filter((i) => isUse(i) ? usedOn(u.date, u.loc, i.id) != null : rowState(i).v != null).length;
      const bad = its.filter((i) => { if (isUse(i)) return false; const s = rowState(i).s; return s === "short" || s === "over"; }).length;
      const shut = folded.has(k);
      const full = n === its.length;
      return `<div class="section-h ${full ? "full" : ""}" data-sec="${esc(k)}">
          <button type="button" class="sec-tog" data-fold="${esc(k)}" aria-expanded="${shut ? "false" : "true"}" title="${shut ? "إظهار" : "إخفاء"}">
            <span class="material-symbols-outlined">${shut ? "chevron_right" : "expand_more"}</span></button>
          <h3>${esc(k)}</h3>
          <span class="sec-count">${n} من ${its.length}</span>
          <span class="sec-state">${bad ? `<span class="pill short">${bad} فرق</span>` : full ? '<span class="pill ok">مكتملة</span>' : ""}</span>
          <span class="spacer"></span>
          ${its.every(isUse) ? "" : `<button type="button" class="btn small secondary noprint" data-allok="${esc(k)}" ${full ? "hidden" : ""}>الكل مطابق</button>`}
        </div>
        <div class="rows" ${shut ? "hidden" : ""}>${shut ? "" : its.map(rowHTML).join("")}</div>`;
    }).join("");
  }
  const folded = new Set();

  function refreshRow(id) {
    const el = document.querySelector(`#inv-rows .row[data-id="${id}"]`);
    const it = itemById(id);
    if (el && it) el.outerHTML = rowHTML(it);
    refreshSections();
    drawProgress();
  }

  /* عدّادات المجموعات تُحسب عند الرسم، فكانت تبقى قديمة بعد كل إدخال.
     تُحدَّث هنا وحدها حتى لا تُعاد كتابة الصفوف ويضيع تركيز الحقل. */
  function refreshSections() {
    $$("#inv-rows .section-h[data-sec]").forEach((h) => {
      const k = h.dataset.sec;
      const its = itemsOf(u.loc).filter((i) => (i.group ? i.group : CATS[i.cat] || "أخرى") === k);
      if (!its.length) return;
      const n = its.filter((i) => isUse(i) ? usedOn(u.date, u.loc, i.id) != null : rowState(i).v != null).length;
      const bad = its.filter((i) => { if (isUse(i)) return false; const st2 = rowState(i).s; return st2 === "short" || st2 === "over"; }).length;
      const cnt2 = h.querySelector(".sec-count");
      if (cnt2) cnt2.textContent = `${n} من ${its.length}`;
      const full = n === its.length;
      h.classList.toggle("full", full);
      const state = h.querySelector(".sec-state");
      if (state) state.innerHTML = bad ? `<span class="pill short">${bad} فرق</span>` : full ? '<span class="pill ok">مكتملة</span>' : "";
      const allok = h.querySelector("[data-allok]");
      if (allok) allok.hidden = full;
    });
  }
  const sessionClosed = () => {
    const c = cnt(u.date, u.loc);
    if (c && c.done[u.ses]) { toast("الجلسة مغلقة — أعد فتحها للتعديل"); return true; }
    return false;
  };
  function setVal(id, raw) {
    if (sessionClosed()) return;
    const item = itemById(id);
    let n = num(raw);
    if (n != null && n < 0) n = 0;
    const c = cnt(u.date, u.loc, true);
    if (n == null) { delete c[u.ses][id]; delete c.x[u.ses][id]; }
    else { c[u.ses][id] = n; c.x[u.ses][id] = item.qty == null ? null : item.qty; }
    save(); refreshRow(id);
  }
  function bump(id, d) {
    const r = rowState(itemById(id));
    const base = r.v == null ? (d > 0 ? (r.x == null ? 0 : r.x) - 1 : (r.x == null ? 1 : r.x)) : r.v;
    setVal(id, Math.max(0, base + d));
  }
  /* مفتاح الحركة اليومية للصنف: حركة استهلاك واحدة لكل صنف في اليوم،
     تُحدَّث بدل أن تتكرّر، فيبقى السجلّ مقروءاً وقابلاً للتراجع. */
  const useKeyOf = (date, loc, id) => `use|${date}|${loc}|${id}`;

  /* استهلاك اليوم: يُخصم من «قيد الاستخدام» وحده، ولا يمسّ المخزون */
  /* الرقم المكتوب بوحدة الاستهلاك يُحوَّل إلى الوحدة الأساسية قبل الخصم */
  function setUse(id, raw, inBase) {
    if (sessionClosed()) return;
    const it = itemById(id);
    if (!it) return;
    const ul = useLevel(it);
    const c = cnt(u.date, u.loc, true);
    const prev = c.use[id] == null ? 0 : c.use[id];
    const avail = r3(inUseOf(it) + prev);      // ما كان قيد الاستخدام قبل تسجيل اليوم
    let next = num(raw);
    if (next == null) {                    // مُسح الحقل: يُلغى استهلاك اليوم
      it.inUse = r3(avail);
      delete c.use[id];
      dropUseMove(id);
      save(); refreshRow(id); return;
    }
    next = r3(Math.max(0, next) * (inBase ? 1 : ul.factor));
    if (next > avail) {
      // ما هو قيد الاستخدام لا يكفي: يُعرض سحب وحدة أكبر من المخزون وإكمال الخصم
      const L = ladder(it), top = L[L.length - 1];
      const stock = it.qty == null ? 0 : it.qty;
      const packs = Math.ceil(r3(next - avail) / top.factor);
      if (L.length > 1 && stock >= packs * top.factor) {
        return ask("انتهى ما هو قيد الاستخدام",
          `<p style="margin:0 0 10px">المطلوب <b>${useText(it, next)}</b>، وقيد الاستخدام <b>${qtyParts(it, avail)}</b> فقط.</p>
           <div class="note-box">يُخرَج <b>${fmtN(packs)} ${esc(top.name)}</b> من المخزون فيبقى فيه <b>${qtyParts(it, r3(stock - packs * top.factor))}</b>، ثم يُخصم استهلاك اليوم كاملاً.</div>`,
          `أخرِج ${fmtN(packs)} ${top.name} وأكمل`, () => {
            addMove({ type: "issue", loc: it.loc, itemId: id, qty: packs * top.factor, date: u.date, note: "إخراج عند نفاد ما هو قيد الاستخدام" }, true);
            setUse(id, next, true);
            render();
          });
      }
      next = avail;
      toast(`قيد الاستخدام ${qtyParts(it, avail)} فقط — أخرِج كمية جديدة من المخزون أولاً`);
    }
    it.inUse = r3(avail - next);
    c.use[id] = r3(next);
    logUseMove(it, next);
    save(); refreshRow(id);
  }
  function bumpUse(id, d) {
    const it = itemById(id);
    const ul = useLevel(it);
    const cur = usedOn(u.date, u.loc, id);
    setUse(id, Math.max(0, r3((cur == null ? 0 : cur) / ul.factor) + d));
  }
  function dropUseMove(id) {
    const k = useKeyOf(u.date, u.loc, id);
    store.get().invMoves = moves().filter((m) => m.dayKey !== k);
  }
  function logUseMove(it, qty) {
    const k = useKeyOf(u.date, u.loc, it.id);
    const old = moves().find((m) => m.dayKey === k);
    if (!qty) { dropUseMove(it.id); return; }
    if (old) { old.qty = qty; old.ts = Date.now(); old.deltas = [{ itemId: it.id, d: -qty, f: "inUse" }]; return; }
    moves().unshift({
      id: uid("m"), ts: Date.now(), date: u.date, type: "consume", loc: u.loc, dayKey: k,
      itemId: it.id, itemName: it.name, unit: it.unit || "", qty, to: "",
      note: `استهلاك ${dayName(u.date)} من الجرد اليومي`,
      by: (App.profile && App.profile.name) ? App.profile.name() : "",
      deltas: [{ itemId: it.id, d: -qty, f: "inUse" }],
    });
  }

  /* إخراج من المخزون إلى قيد الاستخدام */
  function issueDlg(id) {
    const it = itemById(id);
    const b = baseUnit(it), L = ladder(it);
    openModal(`إخراج للاستخدام — ${esc(it.name)}`,
      `<p class="sub" style="margin:0 0 10px">في المخزون <b>${qtyParts(it, it.qty)}</b>، وقيد الاستخدام <b>${qtyParts(it, inUseOf(it))}</b>.
        ${L.length > 1 ? `<br>السُلّم: ${L.map((lv, k) => k ? `<b>${esc(lv.name)}</b> = ${fmtN(lv.n)} ${esc(L[k - 1].name)}` : "").filter(Boolean).join("، و")}.` : ""}</p>
       <div class="inv-form">
         <label class="field"><span>الكمية المُخرَجة</span>
           <input type="number" id="inv-issue-qty" min="0" step="any" value="1"></label>
         ${L.length > 1 ? `<label class="field"><span>بأي وحدة</span><select id="inv-issue-unit">
             ${L.map((lv, k) => `<option value="${k}" ${k === L.length - 1 ? "selected" : ""}>${esc(lv.name)}${k ? ` (= ${fmtN(lv.factor)} ${esc(L[0].name)})` : ""}</option>`).reverse().join("")}
           </select></label>` : ""}
       </div>
       <div class="note-box" style="margin-top:12px" id="inv-issue-pv"></div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button>
       <button class="btn navy" type="button" data-act="do-issue" data-id="${id}">أخرِج</button>`);
    const q = document.getElementById("inv-issue-qty");
    const sync = () => {
      const n = issueBase(it);
      const pv = document.getElementById("inv-issue-pv");
      const stock = it.qty == null ? 0 : it.qty;
      pv.innerHTML = !n ? "اكتب كمية أكبر من صفر."
        : n > stock ? `<span style="color:var(--short)">المخزون ${qtyParts(it, stock)} فقط، ولا يكفي لإخراج ${qtyParts(it, n)}.</span>`
        : `يُخرَج <b>${qtyParts(it, n)}</b> فيبقى في المخزون <b>${qtyParts(it, r3(stock - n))}</b>،
           ويصير قيد الاستخدام <b>${qtyParts(it, r3(inUseOf(it) + n))}</b>.`;
    };
    ["inv-issue-qty", "inv-issue-unit"].forEach((k) => {
      const el = document.getElementById(k);
      if (el) { el.addEventListener("input", sync); el.addEventListener("change", sync); }
    });
    sync();
    if (q) { q.focus(); q.select(); }
  }
  /* الكمية المطلوبة محوَّلة إلى الوحدة الأساسية */
  function issueBase(it) {
    const box = document.getElementById("inv-issue-qty");
    const n = Math.max(0, num(box ? box.value : 0) || 0);
    const L = ladder(it);
    const sel = document.getElementById("inv-issue-unit");
    const k = sel ? Math.min(+sel.value || 0, L.length - 1) : L.length - 1;
    return r3(n * L[k].factor);
  }
  function doIssue(id) {
    const it = itemById(id);
    const n = issueBase(it);
    if (!n) { toast("اكتب كمية أكبر من صفر"); return; }
    if (it.qty != null && n > it.qty) { toast(`المخزون ${qtyText(it, it.qty)} فقط`); return; }
    addMove({ type: "issue", loc: it.loc, itemId: id, qty: n, date: u.date, note: "إخراج من المخزون إلى قيد الاستخدام" }, true);
    save(); closeModal(); render();
    toast(`أُخرج ${qtyParts(it, n)} — صار قيد الاستخدام ${qtyParts(it, inUseOf(it))}`);
  }
  function backToStock(id) {
    const it = itemById(id);
    const n = inUseOf(it);
    if (!n) return toast("لا شيء قيد الاستخدام");
    ask("إرجاع إلى المخزون",
      `<p style="margin:0 0 10px">إرجاع <b>${fmtN(n)}</b> ${esc(it.unit || "")} من «${esc(it.name)}» إلى المخزون.</p>
       <div class="note-box">يُستعمل حين يُغلق المسار أو تُعاد الكمية غير المستهلكة إلى مكانها.</div>`,
      "أرجِعها", () => {
        addMove({ type: "back", loc: it.loc, itemId: id, qty: n, date: u.date, note: "إرجاع ما بقي قيد الاستخدام" }, true);
        save(); render(); toast("أُعيدت إلى المخزون");
      });
  }

  function fillRemaining() {
    const its = itemsOf(u.loc).filter((i) => !isUse(i) && rowState(i).v == null && i.qty != null);
    if (!its.length) return toast("لا توجد أصناف متبقية لها كمية متوقعة");
    ask("تعبئة المتبقي بالمتوقع",
      `<p style="margin:0 0 10px">سيُسجَّل <b>${its.length}</b> صنفاً غير معدود بقيمته المتوقعة، أي كأنه مطابق.</p>
       <div class="note-box">استخدم هذا بعد التأكد الفعلي من وجود الأصناف على الأرض، لا لتسريع الإغلاق.</div>`,
      `نعم، سجّلها مطابقة`, () => {
        const c = cnt(u.date, u.loc, true);
        its.forEach((i) => { c[u.ses][i.id] = i.qty; c.x[u.ses][i.id] = i.qty; });
        save(); render(); toast(`سُجّل ${its.length} صنفاً كمطابق`);
      });
  }

  /* ضبط الوحدات: نوع القياس، والوحدة الأساسية، والعبوة ومعاملها.
     تُفتح لصنف واحد، أو للأصناف المعروضة كلها بعد التصفية. */
  let unitTarget = null, unitRows = [];
  function unitsDlg(id) {
    const many = !id;
    const list = many ? shownItems() : [itemById(id)].filter(Boolean);
    if (!list.length) return toast("لا أصناف معروضة");
    unitTarget = many ? "__shown__" : id;
    const i = list[0];
    const L = ladder(i);
    unitRows = L.map((lv, k) => ({ name: lv.name, n: k ? lv.n : 1 }));
    openModal(many ? `وحدات ${list.length} صنفاً معروضاً` : `وحدات «${esc(i.name)}»`,
      `${many ? `<div class="note-box" style="margin-bottom:12px">سيُطبَّق على <b>${list.length}</b> صنفاً معروضاً الآن. صفِّ القائمة بالموقع أو بالبحث أولاً إن أردت جزءاً منها.</div>` : ""}
       <label class="field" style="max-width:220px"><span>نوع القياس</span>
         <select id="un-measure">${Object.keys(MEASURES).map((k) => `<option value="${k}" ${measureOf(i) === k ? "selected" : ""}>${MEASURES[k]}</option>`).join("")}</select></label>
       <h3 style="margin:16px 0 4px">سُلّم الوحدات</h3>
       <p class="sub" style="margin:0 0 10px">ابدأ بأصغر وحدة تُستعمل فعلاً، ثم أضف ما يضمّها فوقها. مثال شفرات الحلاقة: <b>شفرة</b>، ثم <b>عبوة</b> فيها 10 شفرات، ثم <b>دفتر</b> فيه 20 عبوة.</p>
       <div id="un-rows"></div>
       <div class="bar" style="margin-top:8px"><button class="btn small secondary" type="button" id="un-add">أضف وحدة أكبر</button></div>
       <label class="field" style="max-width:260px;margin-top:14px"><span>وحدة الاستهلاك اليومي — بها يكتب المدرّب رقم اليوم</span>
         <select id="un-useunit"></select></label>
       <div class="note-box" style="margin-top:12px" id="un-preview"></div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button>
       <button class="btn navy" type="button" data-act="save-units">حفظ</button>`);
    unitRowsDraw(+(i.useUnit || 0));
  }

  function unitRowsDraw(useIdx) {
    const box = document.getElementById("un-rows");
    if (!box) return;
    const m = document.getElementById("un-measure").value;
    box.innerHTML = unitRows.map((lv, k) => `<div class="unit-row" data-k="${k}">
      <span class="unit-lvl">${k ? `يضمّ` : "الوحدة الأساسية"}</span>
      ${k ? `<input type="number" class="unit-n" min="1" step="any" value="${lv.n || ""}" data-un-n="${k}" placeholder="10">
             <span class="unit-of">من «${esc(unitRows[k - 1].name || "…")}»، واسمها</span>` : ""}
      <input type="text" class="unit-name" value="${esc(lv.name || "")}" data-un-name="${k}" list="un-hints-${k}" placeholder="${k ? "عبوة" : "قطعة"}">
      <datalist id="un-hints-${k}">${(k ? PACK_HINTS : UNIT_HINTS[m]).map((x) => `<option value="${x}">`).join("")}</datalist>
      ${k ? `<button type="button" class="icon-btn" data-un-del="${k}" title="احذف هذا المستوى"><span class="material-symbols-outlined btn-ico">close</span></button>` : "<span></span>"}
    </div>`).join("");
    const sel = document.getElementById("un-useunit");
    const cur = useIdx == null ? +sel.value || 0 : useIdx;
    sel.innerHTML = unitRows.map((lv, k) => `<option value="${k}" ${k === Math.min(cur, unitRows.length - 1) ? "selected" : ""}>${esc(lv.name || "…")}</option>`).join("");
    unitPreview();
  }

  function unitReadRows() {
    $$("#un-rows [data-un-name]").forEach((el) => { unitRows[+el.dataset.unName].name = normName(el.value); });
    $$("#un-rows [data-un-n]").forEach((el) => { unitRows[+el.dataset.unN].n = Math.max(1, num(el.value) || 1); });
  }

  function unitPreview() {
    const box = document.getElementById("un-preview");
    if (!box) return;
    const fake = { unit: unitRows[0].name, units: unitRows.map((lv, k) => k ? { name: lv.name, n: lv.n } : { name: lv.name }) };
    const L = ladder(fake);
    if (L.length === 1) { box.innerHTML = `الكميات كلها بوحدة <b>${esc(L[0].name || "…")}</b>، والإخراج بها مباشرة بلا تحويل.`; return; }
    const top = L[L.length - 1];
    const uk = Math.min(+document.getElementById("un-useunit").value || 0, L.length - 1);
    box.innerHTML = `${L.slice(1).map((lv, k) => `<b>${esc(lv.name)}</b> = ${fmtN(lv.n)} ${esc(L[k].name)}`).join("، و")}
      — أي أن <b>${esc(top.name)}</b> واحداً = <b>${fmtN(top.factor)} ${esc(L[0].name)}</b>.
      <br>إخراج <b>${esc(top.name)}</b> واحد يضع <b>${fmtN(top.factor / L[uk].factor)} ${esc(L[uk].name)}</b> قيد الاستخدام، يُخصم منها استهلاك كل يوم حتى تنتهي.
      ${uk === L.length - 1 && L.length > 1 ? `<br><span style="color:var(--over)">وحدة الاستهلاك اليومي الآن <b>${esc(L[uk].name)}</b> وهي الأكبر في السُلّم — غالباً يُستهلك يومياً بوحدة أصغر مثل <b>${esc(L[uk - 1].name)}</b>، وإلا ظهرت أرقام كسرية.</span>` : ""}`;
  }

  function saveUnits() {
    unitReadRows();
    const m = document.getElementById("un-measure").value;
    const useUnit = Math.min(+document.getElementById("un-useunit").value || 0, unitRows.length - 1);
    const rows = unitRows.filter((lv, k) => !k || lv.name);
    if (!rows[0].name) return toast("اكتب اسم الوحدة الأساسية");
    const list = unitTarget === "__shown__" ? shownItems() : [itemById(unitTarget)].filter(Boolean);
    list.forEach((i) => {
      i.measure = m;
      i.unit = rows[0].name;
      i.units = rows.map((lv, k) => k ? { name: lv.name, n: lv.n } : { name: lv.name });
      i.useUnit = useUnit;
      delete i.pack; delete i.packQty;      // الصيغة القديمة استُبدلت بالسُلّم
    });
    save(); closeModal(); render();
    toast(`ضُبطت وحدات ${list.length} صنفاً`);
  }

  /* تحويل صنف واحد من مكانه في الجرد: أسرع من الذهاب إلى شاشة الأصناف،
     وهو أكثر ما يُحتاج لأن الملفات تأتي بلا عمود «النوع». */
  function switchKind(id, toMat) {
    const it = itemById(id);
    if (!it) return;
    it.cat = toMat ? "material" : "tool";
    delete it.use;
    save(); drawRows(); drawProgress();
    toast(toMat ? `«${it.name}» صار مادة مستهلكة — أخرِج منها للاستخدام` : `«${it.name}» عاد أداةً تُعدّ`);
  }

  /* بداية يوم جديد: ما بقي قيد الاستخدام من أمس يستمر ما لم يُقرَّر غير ذلك.
     يُسأل المدرّب مرة واحدة في اليوم: أبقِ ما بقي، أو أخرِج كمية جديدة. */
  function carryState() {
    const mats = itemsOf(u.loc).filter(isUse);
    if (!mats.length) return null;
    const c = cnt(u.date, u.loc);
    if (c && (c.carry || Object.keys(c.use || {}).length)) return null;  // قُرِّر، أو بدأ التسجيل
    if (c && c.done[u.ses]) return null;
    const left = mats.filter((i) => inUseOf(i) > 0);
    return { mats, left };
  }

  function carryKeep() {
    const c = cnt(u.date, u.loc, true);
    c.carry = Date.now();
    save(); render();
    toast("استمرّ ما بقي قيد الاستخدام من آخر يوم");
  }

  function carryDlg() {
    const st = carryState();
    if (!st) return;
    const rows = st.mats.map((i) => {
      const L = ladder(i), top = L[L.length - 1];
      return `<tr data-cid="${i.id}">
        <td><b>${esc(i.name)}</b>${i.group ? `<div class="sub">${esc(i.group)}</div>` : ""}</td>
        <td class="n">${inUseOf(i) ? `<b>${esc(qtyParts(i, inUseOf(i)))}</b>` : '<span class="sub">لا شيء</span>'}</td>
        <td class="n">${esc(qtyParts(i, i.qty))}</td>
        <td><div class="qty-cell">
          <input type="number" min="0" step="any" data-carryqty placeholder="0">
          <select data-carryunit>${L.map((lv, k) => `<option value="${k}" ${k === L.length - 1 ? "selected" : ""}>${esc(lv.name)}</option>`).reverse().join("")}</select>
        </div></td>
      </tr>`;
    }).join("");
    openModal(`بداية يوم جديد — ${esc(locById(u.loc).name)}، ${dayName(u.date)} ${fmtD(u.date)}`,
      `<p class="sub" style="margin:0 0 10px">ما بقي قيد الاستخدام من آخر يوم عمل يستمر كما هو. اترك خانة «أخرِج اليوم» فارغة لتُبقيه، أو اكتب كمية جديدة تُخرَج من المخزون وتُضاف إليه.</p>
       <div class="table-wrap"><table><thead><tr><th>المادة</th><th class="n">بقي قيد الاستخدام</th><th class="n">في المخزون</th><th>أخرِج اليوم</th></tr></thead>
       <tbody>${rows}</tbody></table></div>`,
      `<button class="btn secondary" type="button" data-act="carry-keep">أبقِ الكل كما هو</button>
       <button class="btn navy" type="button" data-act="carry-run">نفّذ</button>`);
  }

  function carryRun() {
    let n = 0;
    $$("#inv-modal tr[data-cid]").forEach((tr) => {
      const it = itemById(tr.dataset.cid);
      const v = num(tr.querySelector("[data-carryqty]").value);
      if (!it || !v || v <= 0) return;
      const L = ladder(it);
      const k = Math.min(+tr.querySelector("[data-carryunit]").value || 0, L.length - 1);
      const base = r3(v * L[k].factor);
      if (it.qty != null && base > it.qty) { toast(`${it.name}: المخزون ${qtyParts(it, it.qty)} فقط`); return; }
      addMove({ type: "issue", loc: it.loc, itemId: it.id, qty: base, date: u.date, note: `إخراج بداية ${dayName(u.date)}` }, true);
      n++;
    });
    const c = cnt(u.date, u.loc, true);
    c.carry = Date.now();
    save(); closeModal(); render();
    toast(n ? `أُخرجت كميات ${n} مادة` : "استمرّ ما بقي قيد الاستخدام");
  }

  /* اعتماد الأرقام المعدودة ككميات كلية للأصناف التي لا كمية لها */
  function setBaseFromCount() {
    const c = cnt(u.date, u.loc, true);
    const list = itemsOf(u.loc).filter((i) => !isUse(i) && i.qty == null && rowState(i).v != null);
    if (!list.length) return toast("لا صنف معدود بلا كمية كلية");
    ask("اعتماد الأرقام المعدودة",
      `<p style="margin:0 0 10px">ستصير الأرقام المعدودة اليوم هي <b>الكمية الكلية</b> لـ <b>${list.length}</b> صنفاً.</p>
       <div class="note-box">بعدها يعرف النظام المتوقَّع من كل صنف، فتظهر النواقص والزيادات في الأيام التالية. تأكّد أن العدّ تمّ على الأرض أولاً.</div>`,
      `اعتمد ${list.length} رقماً`, () => {
        list.forEach((i) => { const v = c[u.ses][i.id]; i.qty = v; c.x[u.ses][i.id] = v; });
        save(); render(); toast(`اعتُمد ${list.length} صنفاً`);
      });
  }

  /* «الكل مطابق» لمجموعة واحدة: أسرع طريق لمدرّب أصنافه سليمة */
  function fillGroup(key) {
    const its = itemsOf(u.loc).filter((i) => (i.group ? i.group : CATS[i.cat] || "أخرى") === key);
    const todo = its.filter((i) => { if (isUse(i)) return false; const r = rowState(i); return r.v == null && r.x != null; });
    if (!todo.length) return toast("لا صنف متبقٍ في هذه المجموعة");
    const c = cnt(u.date, u.loc, true);
    todo.forEach((i) => { c[u.ses][i.id] = i.qty; c.x[u.ses][i.id] = i.qty; });
    save(); drawProgress(); drawRows();
    toast(`${key}: سُجّل ${todo.length} صنفاً كمطابق`);
  }
  function copyMorning() {
    const c = cnt(u.date, u.loc, true);
    const its = itemsOf(u.loc).filter((i) => c.e[i.id] == null && c.m[i.id] != null);
    if (!its.length) return toast("لا توجد قيم صباحية لنسخها");
    its.forEach((i) => { c.e[i.id] = c.m[i.id]; c.x.e[i.id] = i.qty == null ? null : i.qty; });
    save(); render(); toast(`نُسخت ${its.length} قيمة من الجلسة الصباحية`);
  }
  function reopenSession() {
    ask("إعادة فتح الجلسة",
      `<p style="margin:0 0 10px">ستتمكن من تعديل الأرقام من جديد.</p>
       <div class="note-box">الحركات التي سُجّلت عند الإغلاق تبقى كما هي؛ إن أردت إلغاءها فمن شاشة «الحركات».</div>`,
      "أعد فتحها", () => {
        const c = cnt(u.date, u.loc, true);
        delete c.done[u.ses];
        save(); render(); toast("أُعيد فتح الجلسة");
      });
  }

  /* إغلاق الجلسة: يعرض النواقص والزيادات ويحوّلها حركات */
  function closeSessionDlg() {
    const its = itemsOf(u.loc).filter((i) => !isUse(i));
    const mats = itemsOf(u.loc).filter(isUse);
    const usedToday = mats.map((i) => ({ i, n: usedOn(u.date, u.loc, i.id) })).filter((x) => x.n);
    const noUse = mats.filter((i) => usedOn(u.date, u.loc, i.id) == null);
    const rs = its.map((i) => Object.assign({ i }, rowState(i)));
    const todo = rs.filter((r) => r.s === "empty"), shorts = rs.filter((r) => r.s === "short"),
      overs = rs.filter((r) => r.s === "over"), nob = rs.filter((r) => r.s === "nobase");
    const tbl = (rows, head) => `<div class="table-wrap" style="margin:8px 0 16px"><table><thead><tr><th>الصنف</th><th class="n">المتوقع</th><th class="n">المعدود</th><th class="n">الفرق</th><th>${head}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const shortRows = shorts.map((r) => `<tr><td>${esc(r.i.name)}<div class="sub">${CATS[r.i.cat] || ""}</div></td>
      <td class="n">${fmtN(r.x)}</td><td class="n">${fmtN(r.v)}</td><td class="n"><span class="pill short">−${fmtN(r.x - r.v)}</span></td>
      <td><select data-short="${r.i.id}"><option value="">إبقاء كفرق مفتوح</option>
        <option value="consume" ${r.i.cat === "material" ? "selected" : ""}>استهلاك</option>
        <option value="loss">فقد</option><option value="damage">تالف</option><option value="out">صرف / إخراج</option></select></td></tr>`).join("");
    const overRows = overs.map((r) => `<tr><td>${esc(r.i.name)}</td><td class="n">${fmtN(r.x)}</td><td class="n">${fmtN(r.v)}</td>
      <td class="n"><span class="pill over">+${fmtN(r.v - r.x)}</span></td>
      <td><label class="conv-check"><input type="checkbox" data-over="${r.i.id}"> تعديل الكمية الكلية</label></td></tr>`).join("");
    openModal(`إغلاق جلسة ${SES[u.ses]} — ${esc(locById(u.loc).name)}`,
      `${todo.length ? `<div class="note-box" style="margin-bottom:14px;color:var(--short)">لم يُجرد <b>${todo.length}</b> صنفاً بعد. يمكنك الإغلاق وستظهر فارغة في الكشف.</div>` : ""}
       ${usedToday.length ? `<h3>استهلاك اليوم (${usedToday.length})</h3><p class="sub">مخصوم من «قيد الاستخدام»، ومسجَّل في الحركات.</p>
         <ul class="alerts" style="margin-bottom:16px">${usedToday.map((x) => `<li><span class="pill over">−${esc(useText(x.i, x.n))}</span><div style="flex:1"><b>${esc(x.i.name)}</b><div class="sub">بقي قيد الاستخدام ${esc(qtyParts(x.i, inUseOf(x.i)))}، وفي المخزون ${esc(qtyParts(x.i, x.i.qty))}</div></div></li>`).join("")}</ul>` : ""}
       ${noUse.length ? `<div class="note-box" style="margin-bottom:14px"><b>${noUse.length}</b> مادة لم يُسجَّل استهلاكها اليوم. إن لم يُستهلك منها شيء فاكتب صفراً ليُعرف أنها رُوجعت.</div>` : ""}
       ${shorts.length ? `<h3>أصناف بها نقص (${shorts.length})</h3><p class="sub">اختر سبب النقص لتُخصم الكمية من الكمية الكلية، أو اتركه فرقاً مفتوحاً.</p>${tbl(shortRows, "الإجراء")}` : ""}
       ${overs.length ? `<h3>أصناف بها زيادة (${overs.length})</h3>${tbl(overRows, "الإجراء")}` : ""}
       ${nob.length ? `<label class="conv-check note-box"><input type="checkbox" id="inv-setbase" checked> اعتماد الأرقام المعدودة ككمية كلية لـ <b>${nob.length}</b> صنفاً ليس لها كمية مسجّلة</label>` : ""}
       ${!shorts.length && !overs.length && !nob.length ? "<p>كل الأصناف المعدودة مطابقة.</p>" : ""}`,
      `<button class="btn secondary" type="button" data-modal-close>رجوع</button><button class="btn navy" type="button" data-act="do-close">إغلاق الجلسة</button>`);
  }
  function closeSession() {
    const c = cnt(u.date, u.loc, true);
    let nMoves = 0;
    $$("[data-short]").forEach((s) => {
      if (!s.value) return;
      const it = itemById(s.dataset.short), r = rowState(it);
      addMove({ type: s.value, loc: it.loc, itemId: it.id, qty: r.x - r.v, date: u.date, note: `من جرد ${SES[u.ses]} ${fmtD(u.date)}` }, true);
      c.x[u.ses][it.id] = it.qty; nMoves++;
    });
    $$("[data-over]").forEach((cb) => {
      if (!cb.checked) return;
      const it = itemById(cb.dataset.over), r = rowState(it);
      addMove({ type: "adjust", loc: it.loc, itemId: it.id, newQty: r.v, date: u.date, note: `زيادة في جرد ${SES[u.ses]} ${fmtD(u.date)}` }, true);
      c.x[u.ses][it.id] = it.qty; nMoves++;
    });
    const setBase = $("#inv-setbase");
    if (setBase && setBase.checked) {
      itemsOf(u.loc).forEach((it) => { const v = c[u.ses][it.id]; if (it.qty == null && v != null) { it.qty = v; c.x[u.ses][it.id] = v; } });
    }
    c.done[u.ses] = Date.now();
    save(); closeModal(); render();
    toast(`أُغلقت الجلسة${nMoves ? ` وسُجّلت ${nMoves} حركة` : ""}`);
  }

  /* --- كشف الأسبوع --- */
  VIEWS.week = () => {
    const ws = u.week || weekOf(u.date); u.week = ws;
    if (!locById(u.weekLoc)) u.weekLoc = (u.loc && locById(u.loc)) ? u.loc : (locs()[0] || {}).id;
    const loc = locById(u.weekLoc), wd = workDates(ws), all = u.weekLoc ? itemsOf(u.weekLoc) : [];
    // المواد المستهلكة لها كشفها: استهلاك كل يوم ومجموع الأسبوع
    const mats = all.filter(isUse), its = all.filter((i) => !isUse(i));
    const useBody = mats.map((i, k) => {
      const ul = useLevel(i);
      const per = wd.map((d) => usedOn(d, u.weekLoc, i.id));
      const sum = per.reduce((a, v) => a + (v || 0), 0);
      return `<tr><td>${k + 1}</td><td class="nm">${esc(i.name)}</td><td>${esc(ul.name)}</td>
        <td><b>${qtyParts(i, i.qty)}</b></td><td><b>${qtyParts(i, inUseOf(i))}</b></td>
        ${per.map((v) => `<td class="${v ? "a st-over" : ""}">${v == null ? "" : fmtN(v / ul.factor)}</td>`).join("")}
        <td><b>${sum ? fmtN(sum / ul.factor) : ""}</b></td></tr>`;
    }).join("");
    const useTbl = mats.length ? `<h2 style="margin:4px 0 8px">استهلاك المواد خلال الأسبوع</h2>
      <div class="table-wrap" style="margin-bottom:22px"><table class="sheet"><thead>
        <tr><th>م</th><th>المادة</th><th>وحدة الاستهلاك</th><th>المخزون</th><th>قيد الاستخدام</th>${wd.map((d) => `<th class="day">${dayName(d).slice(0, 3)}<br>${fmtD(d).slice(0, 5)}</th>`).join("")}<th>مجموع الأسبوع</th></tr>
      </thead><tbody>${useBody}</tbody></table></div>` : "";
    let lastGroup = null;
    const body = its.map((i, k) => {
      let g = "";
      const gk = i.group || "";
      if (gk !== lastGroup) { lastGroup = gk; if (gk) g = `<tr><td class="grp" colspan="${4 + wd.length * 3}">${esc(gk)}</td></tr>`; }
      return g + `<tr><td>${k + 1}</td><td class="nm" title="${esc(i.desc || "")}">${esc(i.name)}</td><td>${esc(i.unit || "")}</td><td><b>${fmtN(i.qty)}</b></td>` +
        wd.map((d) => {
          const c = cnt(d, i.loc), m = c ? c.m[i.id] : undefined, e = c ? c.e[i.id] : undefined;
          const a = actualInfo(d, i.loc, i), note = c ? c.n[i.id] : "";
          return `<td>${m == null ? "" : m}</td><td>${e == null ? "" : e}</td><td class="a st-${a ? a.s : ""}" ${note ? `title="${esc(note)}"` : ""}>${a ? fmtN(a.v) : ""}${note ? " *" : ""}</td>`;
        }).join("") + "</tr>";
    }).join("");
    return `
      <div class="head"><div><h1>كشف الأسبوع</h1><p class="lead">${esc((loc || {}).name || "")}، من ${fmtD(wd[0])} إلى ${fmtD(wd[wd.length - 1])}</p></div>
        <div class="bar noprint">
          <select data-set="weekLoc">${locOptions(u.weekLoc)}</select>
          <button class="btn secondary" data-week="-7">الأسبوع السابق</button>
          <button class="btn secondary" data-week="0">هذا الأسبوع</button>
          <button class="btn secondary" data-week="7">الأسبوع التالي</button>
        </div></div>
      <div class="bar noprint" style="margin-bottom:12px"><span class="sub">الكمية الفعلية = المسائي إن وُجد وإلا الصباحي. العلامة * تعني وجود ملاحظة.</span><span class="spacer"></span>
        <button class="btn secondary" data-act="print">طباعة</button>
        <button class="btn" data-act="export-week">تصدير الأسبوع إلى Excel</button></div>
      ${useTbl}
      ${its.length ? `${mats.length ? '<h2 style="margin:4px 0 8px">جرد الأدوات والأجهزة</h2>' : ""}<div class="table-wrap"><table class="sheet"><thead>
        <tr><th rowspan="2">م</th><th rowspan="2">اسم الأداة</th><th rowspan="2">الوحدة</th><th rowspan="2">الكمية الكلية</th>${wd.map((d) => `<th class="day" colspan="3">${dayName(d)} ${fmtD(d)}</th>`).join("")}</tr>
        <tr>${wd.map(() => "<th>صباحي</th><th>مسائي</th><th>الفعلية</th>").join("")}</tr></thead><tbody>${body}</tbody></table></div>`
        : (mats.length ? "" : '<div class="card empty">لا توجد أصناف في هذا الموقع.</div>')}`;
  };

  /* --- الأصناف --- */
  VIEWS.items = () => {
    const list = shownItems();
    const rows = list.map((i) => `<tr data-id="${i.id}">
      <td><b>${esc(i.name)}</b>${i.group ? `<div class="sub">${esc(i.group)}</div>` : ""}</td>
      <td class="sub">${esc((locById(i.loc) || {}).name || "")}</td>
      <td><select class="inv-cell cat-cell" data-cat aria-label="نوع ${esc(i.name)}">${catOptions(i.cat)}</select>
        ${isUse(i) ? '<span class="pill ok" style="margin-top:4px;display:inline-block">يُستهلك</span>' : ""}</td>
      <td><button class="btn small secondary unit-btn" type="button" data-act="units" data-id="${i.id}" title="ضبط نوع القياس وسُلّم الوحدات">
        ${esc(baseUnit(i)) || "بلا وحدة"}${ladder(i).length > 1
          ? `<small>${ladder(i).slice(1).map((lv, k) => `${esc(lv.name)} = ${fmtN(lv.n)} ${esc(ladder(i)[k].name)}`).join("، ")}</small>`
          : `<small>${MEASURES[measureOf(i)]}</small>`}</button></td>
      <td class="n">${unitCell(i, "qty", i.qty)}</td>
      <td class="n">${isUse(i) ? unitCell(i, "inuse", inUseOf(i)) : '<span class="sub">—</span>'}</td>
      <td class="n">${unitCell(i, "min", i.min || 0)}</td>
      <td class="noprint"><button class="btn small secondary" data-edit>تعديل</button> <button class="btn small danger" data-del>حذف</button></td>
    </tr>`).join("");
    return `
      <div class="head"><div><h1>الأصناف</h1><p class="lead">${list.length} صنفاً معروضاً من ${items().filter((i) => i.active !== false).length}</p></div>
        <div class="bar noprint">
          <button class="btn" data-act="new-item">صنف جديد</button>
          <label class="btn secondary" for="inv-file" style="cursor:pointer">رفع ملف Excel</label>
          <button class="btn secondary" data-act="export-items">تصدير الأصناف</button>
        </div></div>
      <div class="note-box" style="margin-bottom:12px">
        <b>نوع الصنف يحدّد شكله في الجرد اليومي:</b> «مادة مستهلكة» تظهر بثلاث خانات (المخزون، قيد الاستخدام، استهلاك اليوم)، وبقية الأنواع تُعدّ وتُطابَق.
        غيّره من العمود، أو حوّل المعروض كلّه دفعة واحدة:
        <span class="bar" style="margin-top:8px">
          <button class="btn small secondary" type="button" data-act="bulk-mat">اجعل المعروض (${list.length}) مواد مستهلكة</button>
          <button class="btn small secondary" type="button" data-act="bulk-tool">اجعله أدوات تُعدّ</button>
        </span>
      </div>
      <div class="note-box" style="margin-bottom:12px">
        <b>الوحدة تُحسب بها كل كميات الصنف</b>، ويمكن بناء سُلّم فوقها بأي عدد من المستويات: <span dir="rtl">شفرة ← عبوة فيها 10 شفرات ← دفتر فيه 20 عبوة</span>.
        عندها يسألك زرّ «أخرِج» بأي وحدة تُخرج، ويُكتب الاستهلاك اليومي بالوحدة التي تختارها، وإذا نفد ما هو قيد الاستخدام عُرض عليك إخراج وحدة جديدة.
        اضغط الوحدة في الجدول لضبط صنف واحد، أو:
        <span class="bar" style="margin-top:8px">
          <button class="btn small secondary" type="button" data-act="units">اضبط وحدات المعروض (${list.length})</button>
        </span>
      </div>
      <label class="inv-drop" for="inv-file" id="inv-drop">
        <b>اسحب ملف الجرد هنا، أو اضغط لاختياره</b>
        <span>مصنّف Excel ‎.xlsx‎ فيه ورقة لكل مسار (أو ملف ‎.csv‎ لمسار واحد)</span>
      </label>
      <div class="reg-toolbar">
        <div class="reg-search-box"><input type="search" id="inv-iq" placeholder="بحث باسم الصنف أو المكنة" value="${esc(u.iQ)}"></div>
        <select data-set="iLoc">${locOptions(u.iLoc, true)}</select>
        <select data-set="iCat"><option value="all">كل الأنواع</option>${catOptions(u.iCat)}</select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الموقع</th><th>النوع</th><th>الوحدة والعبوة</th><th class="n">المخزون</th><th class="n">قيد الاستخدام</th><th class="n">الحدّ الأدنى</th><th class="noprint"></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">لا أصناف مطابقة.</td></tr>'}</tbody></table></div>`;
  };

  /* --- الحركات --- */
  VIEWS.moves = () => {
    const list = moves().filter((m) => (u.mLoc === "all" || m.loc === u.mLoc) && (u.mType === "all" || m.type === u.mType));
    const rows = list.slice(0, 200).map((m) => `<tr data-id="${m.id}">
      <td class="sub">${fmtD(m.date)}</td>
      <td><span class="pill ${MOVES[m.type].c}">${MOVES[m.type].t}</span></td>
      <td><b>${esc(m.itemName)}</b><div class="sub">${esc((locById(m.loc) || {}).name || "")}</div></td>
      <td class="n">${moveQtyText(m)}</td>
      <td class="sub">${esc(m.note || "")}</td>
      <td class="noprint"><button class="btn small danger" data-undo>تراجع</button></td>
    </tr>`).join("");
    return `
      <div class="head"><div><h1>الحركات</h1><p class="lead">${moves().length} حركة مسجّلة</p></div>
        <div class="bar noprint"><button class="btn" data-act="new-move">تسجيل حركة</button></div></div>
      <div class="reg-toolbar">
        <select data-set="mLoc">${locOptions(u.mLoc, true)}</select>
        <select data-set="mType"><option value="all">كل الأنواع</option>${Object.keys(MOVES).map((k) => `<option value="${k}" ${u.mType === k ? "selected" : ""}>${MOVES[k].t}</option>`).join("")}</select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الصنف</th><th class="n">الكمية</th><th>ملاحظة</th><th class="noprint"></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">لا حركات.</td></tr>'}</tbody></table></div>`;
  };

  /* --- الإعدادات --- */
  VIEWS.settings = () => `
    <div class="head"><div><h1>الإعدادات</h1><p class="lead">اسم المركز والدورة وأيام العمل والمواقع</p></div></div>
    <div class="card">
      <div class="inv-form">
        <label class="field"><span>اسم المركز</span><input type="text" id="inv-center" value="${esc(meta().center)}"></label>
        <label class="field"><span>الدورة</span><input type="text" id="inv-course" value="${esc(meta().course)}"></label>
      </div>
      <h3 style="margin-top:14px">أيام العمل</h3>
      <div class="bar">${DAYS.map((d, k) => `<label class="conv-check"><input type="checkbox" data-day="${k}" ${meta().workDays.includes(k) ? "checked" : ""}> ${d}</label>`).join("")}</div>
    </div>
    <div class="card"><h3>المواقع</h3>
      <div class="table-wrap"><table><thead><tr><th>الموقع</th><th>النوع</th><th class="n">الأصناف</th><th class="noprint"></th></tr></thead><tbody>
        ${locs().map((l) => `<tr data-loc="${l.id}"><td><input type="text" class="inv-cell" style="width:auto;min-width:180px;text-align:start" data-locname value="${esc(l.name)}"></td>
          <td class="sub">${l.type === "track" ? "مسار" : l.type === "admin" ? "إدارة" : "مخزن"}</td>
          <td class="n">${itemsOf(l.id).length}</td>
          <td class="noprint"><button class="btn small danger" data-delloc>حذف</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="bar" style="margin-top:10px"><input type="text" id="inv-newloc" placeholder="اسم موقع جديد"><button class="btn" data-act="add-loc">إضافة موقع</button></div>
    </div>`;

  /* ===== الحركات: التسجيل والتراجع ===== */
  function moveQtyText(m) {
    const it = itemById(m.itemId);
    const txt = it ? (m.type === "consume" ? useText(it, m.qty) : qtyParts(it, m.qty)) : `${fmtN(m.qty)} ${esc(m.unit || "")}`;
    return m.type === "adjust" ? `إلى ${txt}` : `${MOVES[m.type].sign > 0 ? "+" : "−"}${txt}`;
  }
  function addMove(m, silent) {
    const it = itemById(m.itemId);
    if (!it) return;
    const deltas = [];
    if (m.type === "adjust") {
      const before = it.qty == null ? 0 : it.qty;
      const after = num(m.newQty) || 0;
      deltas.push({ itemId: it.id, d: after - before });
      it.qty = after;
      m.qty = after;
    } else if (m.type === "issue" || m.type === "back") {
      // نقل داخلي بين المخزون وقيد الاستخدام: مجموع الصنف لا يتغيّر
      const q = Math.abs(num(m.qty) || 0);
      const sign = m.type === "issue" ? -1 : 1;   // issue: من المخزون، back: إليه
      deltas.push({ itemId: it.id, d: sign * q, f: "qty" }, { itemId: it.id, d: -sign * q, f: "inUse" });
      it.qty = r3(Math.max(0, (it.qty == null ? 0 : it.qty) + sign * q));
      it.inUse = r3(Math.max(0, inUseOf(it) - sign * q));
      m.qty = q;
    } else if (m.type === "consume" && isUse(it)) {
      // استهلاك مادة مُخرَجة: يُخصم من قيد الاستخدام لا من المخزون
      const q = Math.abs(num(m.qty) || 0);
      deltas.push({ itemId: it.id, d: -q, f: "inUse" });
      it.inUse = r3(Math.max(0, inUseOf(it) - q));
      m.qty = q;
    } else {
      const q = Math.abs(num(m.qty) || 0);
      const sign = MOVES[m.type].sign;
      deltas.push({ itemId: it.id, d: sign * q });
      it.qty = Math.max(0, (it.qty == null ? 0 : it.qty) + sign * q);
      m.qty = q;
      if (m.type === "transfer" && m.to) {
        const twin = items().find((x) => x.loc === m.to && normName(x.name) === normName(it.name));
        if (twin) { twin.qty = (twin.qty == null ? 0 : twin.qty) + q; deltas.push({ itemId: twin.id, d: q }); }
        else {
          const copy = Object.assign({}, it, { id: uid("i"), loc: m.to, qty: q });
          items().push(copy);
          deltas.push({ itemId: copy.id, d: q });
        }
      }
    }
    moves().unshift({
      id: uid("m"), ts: Date.now(), date: m.date || today(), type: m.type, loc: m.loc,
      itemId: it.id, itemName: it.name, unit: it.unit || "", qty: m.qty, to: m.to || "",
      note: m.note || "", by: (App.profile && App.profile.name) ? App.profile.name() : "", deltas,
    });
    if (moves().length > 4000) moves().length = 4000;
    if (!silent) { save(); render(); toast("سُجّلت الحركة"); }
  }
  function undoMove(id) {
    const m = moves().find((x) => x.id === id);
    if (!m) return;
    ask("التراجع عن حركة",
      `<p style="margin:0 0 10px"><b>${MOVES[m.type].t}</b> — ${esc(m.itemName)} ${moveQtyText(m)}، ${fmtD(m.date)}.</p>
       <div class="note-box">التراجع يعيد الكميات كما كانت قبل هذه الحركة، ويحذفها من السجل.</div>`,
      "تراجَع", () => {
        (m.deltas || []).forEach((d) => {
          const it = itemById(d.itemId);
          if (!it) return;
          if (d.f === "inUse") it.inUse = Math.max(0, inUseOf(it) - d.d);
          else it.qty = Math.max(0, (it.qty == null ? 0 : it.qty) - d.d);
        });
        // حركة استهلاك يومي: يُمحى أثرها من سجلّ اليوم أيضاً
        if (m.dayKey) { const c = counts().find((x) => x.id === `${m.date}|${m.loc}`); if (c && c.use) delete c.use[m.itemId]; }
        store.get().invMoves = moves().filter((x) => x.id !== id);
        save(); render(); toast("تم التراجع عن الحركة");
      }, true);
  }
  function moveDlg() {
    const its = items().filter((i) => i.active !== false);
    openModal("تسجيل حركة", `
      <div class="inv-form">
        <label class="field"><span>النوع</span><select id="mv-type">${Object.keys(MOVES).map((k) => `<option value="${k}">${MOVES[k].t}</option>`).join("")}</select></label>
        <label class="field"><span>التاريخ</span><input type="date" id="mv-date" value="${today()}"></label>
        <label class="field" style="grid-column:1/-1"><span>الصنف</span><select id="mv-item">${its.map((i) => `<option value="${i.id}">${esc(i.name)} — ${esc((locById(i.loc) || {}).name || "")}</option>`).join("")}</select></label>
        <label class="field"><span>الكمية</span><input type="number" id="mv-qty" min="0" step="1" value="1"></label>
        <label class="field" id="mv-to-wrap" hidden><span>إلى موقع</span><select id="mv-to">${locOptions("")}</select></label>
        <label class="field" style="grid-column:1/-1"><span>ملاحظة</span><input type="text" id="mv-note" placeholder="اختياري"></label>
      </div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button><button class="btn" type="button" data-act="save-move">حفظ الحركة</button>`);
    const t = $("#mv-type");
    const sync = () => {
      $("#mv-to-wrap").hidden = t.value !== "transfer";
      $("#mv-qty").previousElementSibling.textContent = t.value === "adjust" ? "الكمية الجديدة" : "الكمية";
    };
    t.addEventListener("change", sync); sync();
  }
  function saveMove() {
    const type = $("#mv-type").value, itemId = $("#mv-item").value;
    const qty = $("#mv-qty").value;
    if (!itemId) return toast("اختر الصنف");
    const it = itemById(itemId);
    addMove({ type, loc: it.loc, itemId, qty, newQty: qty, date: $("#mv-date").value || today(), to: $("#mv-to").value, note: $("#mv-note").value.trim() });
    closeModal();
  }

  /* خلية كمية مع منتقي وحدتها: الكميات تُخزَّن بالوحدة الأساسية، لكن
     المستخدم يكتبها بالوحدة التي يشتري بها — «5 دفتر» لا «100 عبوة». */
  function unitCell(i, field, v) {
    const L = ladder(i);
    const k = Math.min(Math.max(0, +((i.cellUnit || {})[field] ?? (L.length - 1))), L.length - 1);
    const f = L[k].factor;
    return `<div class="qty-cell">
      <input type="number" class="inv-cell" data-${field} value="${v == null ? "" : fmtIn(r3(v / f))}" placeholder="—">
      ${L.length > 1 ? `<select class="inv-cell qty-unit" data-cellunit="${field}" aria-label="وحدة ${field}">
        ${L.map((lv, n) => `<option value="${n}" ${n === k ? "selected" : ""}>${esc(lv.name)}</option>`).reverse().join("")}
      </select>` : `<span class="qty-unit-txt">${esc(L[0].name)}</span>`}
    </div>${L.length > 1 && v ? `<div class="sub">${qtyParts(i, v)}</div>` : ""}`;
  }
  const cellFactor = (i, field) => {
    const L = ladder(i);
    const k = Math.min(Math.max(0, +((i.cellUnit || {})[field] ?? (L.length - 1))), L.length - 1);
    return L[k].factor;
  };

  /* الأصناف المعروضة الآن في شاشة الأصناف: ما تراه هو ما يتغيّر */
  function shownItems() {
    const q = normName(u.iQ);
    return items().filter((i) => i.active !== false)
      .filter((i) => u.iLoc === "all" || i.loc === u.iLoc)
      .filter((i) => u.iCat === "all" || i.cat === u.iCat)
      .filter((i) => !q || i.name.includes(q) || String(i.group || "").includes(q));
  }
  /* تحويل جماعي: الملفات تأتي بلا عمود نوع، فتُستورد كلها «أداة»
     ويحتاج المركز أن يحوّل المواد دفعة واحدة بعد التصفية */
  function bulkCat(toMat) {
    const list = shownItems();
    if (!list.length) return toast("لا أصناف معروضة");
    const names = list.slice(0, 6).map((i) => i.name).join("، ");
    ask(toMat ? "تحويل إلى مواد مستهلكة" : "تحويل إلى أدوات تُعدّ",
      `<p style="margin:0 0 10px">سيتغيّر نوع <b>${list.length}</b> صنفاً من المعروض الآن.</p>
       <div class="note-box">${esc(names)}${list.length > 6 ? ` وغيرها (${list.length - 6})` : ""}</div>
       <p class="sub" style="margin:10px 0 0">${toMat
        ? "ستظهر في الجرد اليومي بثلاث خانات: المخزون، وقيد الاستخدام، واستهلاك اليوم. الكميات المسجَّلة لا تتأثّر."
        : "ستظهر في الجرد اليومي للعدّ والمطابقة. ما كان قيد الاستخدام منها يبقى مسجَّلاً كما هو."}</p>
       <p class="sub" style="margin:8px 0 0">صفِّ القائمة أولاً بالموقع أو بالبحث إن أردت تحويل جزء منها فقط.</p>`,
      `حوِّل ${list.length} صنفاً`, () => {
        list.forEach((i) => { i.cat = toMat ? "material" : "tool"; delete i.use; });
        save(); render(); toast(`حُوّل ${list.length} صنفاً`);
      });
  }

  /* ===== الأصناف: تحرير وحذف ===== */
  function itemDlg(id) {
    const i = id ? itemById(id) : { name: "", loc: (locs()[0] || {}).id, cat: "tool", unit: "", qty: "", min: 0, inUse: 0, group: "", desc: "", note: "" };
    openModal(id ? "تعديل صنف" : "صنف جديد", `
      <div class="inv-form">
        <label class="field" style="grid-column:1/-1"><span>اسم الصنف</span><input type="text" id="it-name" value="${esc(i.name)}"></label>
        <label class="field"><span>الموقع</span><select id="it-loc">${locOptions(i.loc)}</select></label>
        <label class="field"><span>النوع</span><select id="it-cat">${catOptions(i.cat)}</select></label>
        <label class="field"><span>الوحدة الأساسية</span><input type="text" id="it-unit" value="${esc(i.unit || "")}" placeholder="قطعة، متر، كجم"></label>
        <label class="field"><span>نوع القياس</span><select id="it-measure">${Object.keys(MEASURES).map((k) => `<option value="${k}" ${measureOf(i) === k ? "selected" : ""}>${MEASURES[k]}</option>`).join("")}</select></label>
        ${id ? `<div class="field" style="grid-column:1/-1"><span>سُلّم الوحدات</span>
          <div class="note-box">${esc(ladder(i).map((lv, k) => k ? `${lv.name} = ${fmtN(lv.n)} ${ladder(i)[k - 1].name}` : lv.name).join(" ← "))}
          <br><button class="btn small secondary" type="button" style="margin-top:8px" data-act="units" data-id="${id}">عدّل سُلّم الوحدات</button></div></div>` : ""}
        <label class="field"><span>المكنة التابع لها</span><input type="text" id="it-group" value="${esc(i.group || "")}" placeholder="اختياري"></label>
        <label class="field"><span>المخزون بـ«${esc(baseUnit(i))}»</span><input type="number" id="it-qty" value="${i.qty == null ? "" : i.qty}" placeholder="اتركها فارغة إن لم تُعرف"></label>
        <label class="field"><span>قيد الاستخدام بـ«${esc(baseUnit(i))}»</span><input type="number" id="it-inuse" value="${inUseOf(i)}" min="0"></label>
        <label class="field"><span>الحدّ الأدنى بـ«${esc(baseUnit(i))}»</span><input type="number" id="it-min" value="${i.min || 0}"></label>
        <label class="conv-check note-box" style="grid-column:1/-1"><input type="checkbox" id="it-use" ${isUse(i) ? "checked" : ""}>
          صنف يُصرف للاستخدام ويُستهلك منه يومياً — يظهر في الجرد بثلاث خانات: المخزون، وقيد الاستخدام، واستهلاك اليوم. أطفِئه للأجهزة والأدوات التي تُعدّ ولا تُستهلك.</label>
        <label class="field" style="grid-column:1/-1"><span>الوصف</span><input type="text" id="it-desc" value="${esc(i.desc || "")}"></label>
      </div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button><button class="btn" type="button" data-act="save-item" data-id="${id || ""}">حفظ</button>`);
  }
  function saveItem(id) {
    const name = normName($("#it-name").value);
    if (!name) return toast("اكتب اسم الصنف");
    const data = {
      name, loc: $("#it-loc").value, cat: $("#it-cat").value, unit: normName($("#it-unit").value),
      group: normName($("#it-group").value), qty: num($("#it-qty").value), min: num($("#it-min").value) || 0,
      inUse: Math.max(0, num($("#it-inuse").value) || 0), use: $("#it-use").checked,
      measure: $("#it-measure").value,
      desc: normName($("#it-desc").value),
    };
    if (id) Object.assign(itemById(id), data);
    else items().push(Object.assign({ id: uid("i"), active: true, note: "" }, data));
    save(); closeModal(); render(); toast(id ? "حُفظ الصنف" : "أُضيف الصنف");
  }
  function delItem(id) {
    const it = itemById(id);
    if (!it) return;
    ask("حذف صنف",
      `<p style="margin:0 0 10px">حذف <b>${esc(it.name)}</b> من ${esc((locById(it.loc) || {}).name || "")}؟</p>
       <div class="note-box">سجلّ حركاته وجرده السابق يبقى محفوظاً، ويختفي الصنف من الجرد القادم فقط.</div>`,
      "احذفه", () => { it.active = false; save(); render(); toast("حُذف الصنف"); }, true);
  }

  /* ===== نافذة بسيطة داخل الصفحة ===== */
  function openModal(title, body, actions) {
    const back = document.getElementById("inv-modal");
    if (!back) { step("نافذة الجرد غير موجودة في الصفحة", true); return; }
    back.innerHTML = `<div class="modal"><h3>${title}</h3><div class="inv-modal-body">${body}</div><div class="btn-row">${actions}</div></div>`;
    back.hidden = false;
    back.classList.add("open");
    step(`فُتحت نافذة: ${title}`);
  }
  function closeModal() {
    const back = document.getElementById("inv-modal");
    back.classList.remove("open");
    back.innerHTML = "";
    pending = null;
  }

  /* سؤال تأكيد داخل النظام بدل نافذة المتصفح: نصّه عربي، وأزراره واضحة */
  let pending = null;
  function ask(title, html, label, fn, danger) {
    pending = fn;
    openModal(title, html,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button>
       <button class="btn ${danger ? "danger" : "navy"}" type="button" data-act="ask-yes">${label}</button>`);
  }

  /* ملاحظة الصنف: نافذة بحقل نصّ بدل prompt الذي لا يُقرأ ولا يُنسَّق */
  function noteDlg(id) {
    const it = itemById(id), c = cnt(u.date, u.loc);
    const cur = (c && c.n[id]) || "";
    openModal(`ملاحظة على «${esc(it.name)}»`,
      `<p class="sub" style="margin:0 0 8px">تُحفظ مع جرد ${dayName(u.date)} ${fmtD(u.date)} وتظهر في الصف وفي كشف الأسبوع.</p>
       <textarea id="inv-note-txt" rows="3" style="width:100%" placeholder="مثال: المفتاح مكسور، أُبلغ المشرف">${esc(cur)}</textarea>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button>
       ${cur ? '<button class="btn danger" type="button" data-act="note-del">حذف الملاحظة</button>' : ""}
       <button class="btn" type="button" data-act="note-save">حفظ</button>`);
    const box = document.getElementById("inv-note-txt");
    if (box) { box.focus(); box.setSelectionRange(cur.length, cur.length); }
    noteFor = id;
  }
  let noteFor = null;
  function noteSave(text) {
    const id = noteFor, c = cnt(u.date, u.loc, true);
    if (!id) return closeModal();
    const v = String(text || "").trim();
    if (v) c.n[id] = v; else delete c.n[id];
    save(); closeModal(); refreshRow(id);
    toast(v ? "حُفظت الملاحظة" : "حُذفت الملاحظة");
  }

  /* ===== التصدير ===== */
  async function exportWeek() {
    if (typeof ExcelJS === "undefined") return toast("تعذّر تحميل مكتبة Excel");
    const ws = u.week || weekOf(u.date), wd = workDates(ws);
    const wb = new ExcelJS.Workbook();
    locs().forEach((l) => {
      const all = itemsOf(l.id);
      if (!all.length) return;
      const mats = all.filter(isUse), its = all.filter((i) => !isUse(i));
      // ورقة استهلاك المواد لكل موقع: يوم بيوم ومجموع الأسبوع
      if (mats.length) {
        const ms = wb.addWorksheet(`استهلاك ${l.name}`.slice(0, 28));
        ms.views = [{ rightToLeft: true }];
        ms.addRow([`استهلاك المواد — ${l.name}`]);
        ms.addRow(["م", "المادة", "وحدة الاستهلاك", "المخزون", "قيد الاستخدام", ...wd.map((d) => `${dayName(d)} ${fmtD(d)}`), "مجموع الأسبوع"]);
        mats.forEach((i, k) => {
          const ul = useLevel(i);
          const per = wd.map((d) => usedOn(d, l.id, i.id));
          ms.addRow([k + 1, i.name, ul.name, qtyParts(i, i.qty), qtyParts(i, inUseOf(i)),
            ...per.map((v) => (v == null ? "" : r3(v / ul.factor))), r3(per.reduce((a, v) => a + (v || 0), 0) / ul.factor)]);
        });
        ms.columns.forEach((c) => { c.width = 14; });
      }
      if (!its.length) return;
      const sh = wb.addWorksheet(l.name.slice(0, 28));
      sh.views = [{ rightToLeft: true }];
      const r1 = ["م", "اسم الأداة", "الوحدة", "الكمية الكلية"], r2 = ["", "", "", ""];
      wd.forEach((d) => { r1.push(`${dayName(d)} ${fmtD(d)}`, "", ""); r2.push("صباحي", "مسائي", "الكمية الفعلية"); });
      sh.addRow([`جرد الأدوات — ${l.name}`]);
      sh.addRow(r1); sh.addRow(r2);
      its.forEach((i, k) => {
        const row = [k + 1, i.group && i.group !== i.name ? `${i.name} (${i.group})` : i.name, i.unit || "", i.qty == null ? "" : i.qty];
        wd.forEach((d) => { const c = cnt(d, l.id), a = actualInfo(d, l.id, i); row.push(c && c.m[i.id] != null ? c.m[i.id] : "", c && c.e[i.id] != null ? c.e[i.id] : "", a ? a.v : ""); });
        sh.addRow(row);
      });
      sh.columns.forEach((c) => { c.width = 14; });
    });
    ui.download(`كشف جرد الأسبوع ${ws}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  async function exportItems() {
    if (typeof ExcelJS === "undefined") return toast("تعذّر تحميل مكتبة Excel");
    const wb = new ExcelJS.Workbook(), sh = wb.addWorksheet("الأصناف");
    sh.views = [{ rightToLeft: true }];
    sh.addRow(["الموقع", "الصنف", "النوع", "الوحدة", "الكمية الكلية", "الحدّ الأدنى", "المكنة", "الوصف"]);
    items().filter((i) => i.active !== false).forEach((i) => sh.addRow([(locById(i.loc) || {}).name || "", i.name, CATS[i.cat] || "", i.unit || "", i.qty == null ? "" : i.qty, i.min || 0, i.group || "", i.desc || ""]));
    sh.columns.forEach((c) => { c.width = 18; });
    ui.download(`أصناف الجرد ${today()}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* ===== الاستيراد: مصنّف فيه ورقة لكل مسار =====
     كل ورقة = موقع باسمها، وصفوفها = أصنافه. تُكتشف صفوف العناوين داخل كل
     ورقة (فقد يسبقها عنوان)، وتُطابَق الأعمدة بالمرادفات، وتُعرض معاينة
     بورقة/موقع/عدد قبل التنفيذ. الرفع المتكرر يُحدِّث ولا يكرّر. */
  const normHead = (v) => String(v || "").trim().toLowerCase()
    .replace(/[\u064B-\u0652]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/(^|\s)ال/g, "$1").replace(/[\s_\d().:\-\/]/g, "");
  const HEADER_ROW = /^(اسم|الاسم|صنف|الصنف|اسم الصنف|اسم الاداه|اسم الأداة|اسم الجهاز|البند|البيان|الماده|المادة|الوصف|م|#|الرقم|التسلسل|العدد|الكميه|الكمية|نوع|النوع|الوحده|الوحدة|ملاحظات|الاجمالي|الإجمالي|المجموع)$/;
  /* لكل حقل قائمة تعبيرات مرتّبة: يُجرَّب الأدقّ أولاً.
     المهم هنا أن «الكمية الكلية» تسبق «الكمية الفعلية» و«عدد المكن»،
     وأن «اسم الأداة» يسبق أي عمود فيه كلمة «اسم». */
  const COLS = {
    name: [/^اسم(ال)?اداه$|^اسم(ال)?صنف$|^اسم(ال)?جهاز$|^(ال)?صنف$|^(ال)?بند$/, /^اسم/, /صنف|بند|ماده|اداه|جهاز|مسمي/],
    unit: [/^(ال)?وحده$/, /وحده|قياس/],
    qty: [/^(ال)?كميه(ال)?كليه$|^(ال)?كميه$/, /كميه(ال)?كليه|رصيد|متوفر|موجود/, /^(ال)?عدد$|اجمالي|مجموع/],
    min: [/^(ال)?حد(ال)?ادني$|^(ال)?حد$/, /^(ال)?حد|ادني|اعاده(ال)?طلب/],
    cat: [/^(ال)?نوع$|^(ال)?تصنيف$/, /نوع|تصنيف|فئه/],
    group: [/^(ال)?مكن/, /مكن|ماكين|مجموعه|تابع/],
    desc: [/^(ال)?وصف$|^(ال)?ملاحظات$/, /وصف|ملاحظ|بيان/],
  };
  /* أعمدة الجدول اليومي لا تصلح حقولاً للصنف */
  const DAY_COL = /^صباحي$|^مسائي$|^(ال)?كميه(ال)?فعليه$|^(ال)?يوم$|^(ال)?تاريخ$|^م$|^#$/;
  /* وحدات تدلّ وحدها على مادة تُستهلك: الملفات الواقعية بلا عمود «النوع»،
     فكانت كل الأصناف تُستورد «أداة» ويُطلب عدّ الورق بدل تسجيل استهلاكه. */
  const MAT_UNIT = /^(دسته|لفه|عبوه|علبه|كيس|اكياس|رزمه|باكيت|كرتون|كرتونه|حزمه|ربطه|متر|سم|كيلو|كغم|جرام|غرام|لتر|مل|جالون|طن|ورقه|اوراق|زجاجه|انبوب|تيوب|بكره|رول|شريط|قلم|طقم استهلاكي)$/;
  const MAT_NAME = /^(ورق|صمغ|غراء|لاصق|شريط لاصق|خيط|خيوط|شمع|كحول|صابون|قطن|حبر|بطاري|قفاز|كمام|منديل|مناديل|اكياس|كيس|دهان|بوي|صبغ|ملون|فوم|قماش|جلد|خرز|اسلاك|مسامير|براغي|غراء)/;
  function pickCol(headers, key) {
    for (const re of COLS[key]) {
      const hit = headers.find((h) => !DAY_COL.test(normHead(h)) && re.test(normHead(h)));
      if (hit) return hit;
    }
    return "";
  }

  /* شريط العناوين: قد يكون أكثر من صفّ فوق بعضه (اليوم/التاريخ/صباحي-مسائي).
     يُلتقط الصفّ الأول الذي فيه عمود اسم الصنف، ثم يُمدّ ما دامت الصفوف
     التالية تحمل عنواناً أيضاً، وتُدمج: لكل عمود أول قيمة غير فارغة. */
  const looksHeader = (vals) => vals.some((t) => COLS.name[0].test(normHead(t)) || COLS.name[1].test(normHead(t)))
    || vals.some((t) => DAY_COL.test(normHead(t)));
  function headerBandOf(sheet, cols, read) {
    const rowVals = (r) => { const v = []; for (let c = 1; c <= cols; c++) v.push(read(sheet.getRow(r).getCell(c))); return v; };
    let from = 0;
    const max = Math.min(sheet.rowCount, 12);
    for (let r = 1; r <= max; r++) {
      const vals = rowVals(r).filter((t) => t);
      if (!vals.length) continue;
      if (new Set(vals).size === 1) continue;            // عنوان الورقة الممدود
      if (vals.some((t) => COLS.name[0].test(normHead(t)) || COLS.name[1].test(normHead(t)))) { from = r; break; }
    }
    if (!from) {                                          // لا عمود اسم صريح: أكثر الصفوف تمايزاً
      let best = 1, bestScore = -1;
      for (let r = 1; r <= max; r++) {
        const vals = rowVals(r).filter((t) => t);
        const score = new Set(vals).size - (vals.length && new Set(vals).size === 1 ? 5 : 0);
        if (score > bestScore) { bestScore = score; best = r; }
      }
      from = best;
    }
    let to = from;
    while (to + 1 <= max && looksHeader(rowVals(to + 1).filter((t) => t))) to++;
    const headers = [];
    for (let c = 1; c <= cols; c++) {
      let v = "";
      for (let r = from; r <= to && !v; r++) v = read(sheet.getRow(r).getCell(c));
      headers.push(v || `عمود ${c}`);
    }
    return { from, to, headers };
  }

  const cellText = (cell) => {
    const v = cell.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if (v.text != null) return String(v.text).trim();
      if (v.result != null) return String(v.result).trim();
      if (v.richText) return v.richText.map((p) => p.text).join("").trim();
      return "";
    }
    return String(v).trim();
  };

  /* تحليل صفّ CSV يحترم علامات الاقتباس */
  function csvRow(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  }

  /* ملف CSV: ورقة واحدة باسم الملف */
  async function readCsv(file) {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) throw new Error("الملف فارغ");
    const head = lines[0];
    const sep = [",", ";", "\t"].sort((a, b) => head.split(b).length - head.split(a).length)[0];
    const grid = lines.map((l) => csvRow(l, sep));
    return [{ grid, name: file.name.replace(/\.[^.]+$/, "") }];
  }

  /* يقرأ المصنّف ورقةً ورقة، ويشرح الصيغ غير المدعومة بالعربية */
  async function readWorkbook(file) {
    const name = String(file.name || "").toLowerCase();
    const buf = await file.arrayBuffer();
    const sig = new Uint8Array(buf.slice(0, 8));
    // D0 CF 11 E0: صيغة Excel 97‑2003 القديمة، ولا تقرؤها المكتبة
    if (sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0) {
      throw new Error("هذا ملف بصيغة ‎.xls‎ القديمة ولا يمكن قراءتها. افتحه في Excel ثم «حفظ باسم» واختر ‎Excel Workbook (.xlsx)‎ وأعد رفعه.");
    }
    if (name.endsWith(".csv") || (sig[0] !== 0x50 && sig[1] !== 0x4B)) {
      // ليس ملف zip (أي ليس xlsx): يُعامَل نصّاً مفصولاً بفواصل
      const sheets = await readCsv(file);
      return sheets.map((sh) => gridToSheet(sh.grid, sh.name));
    }
    if (typeof ExcelJS === "undefined") throw new Error("تعذّر تحميل مكتبة Excel — تحقّق من الاتصال وأعد المحاولة");
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); }
    catch (e) { throw new Error("تعذّرت قراءة الملف. تأكّد أنه مصنّف Excel بصيغة ‎.xlsx‎ غير محمي بكلمة مرور."); }
    const sheets = [];
    wb.eachSheet((sheet) => {
      const cols = Math.max(sheet.columnCount || 0, 1);
      const band = headerBandOf(sheet, cols, cellText);
      const headers = band.headers;
      const map = {};
      Object.keys(COLS).forEach((k) => { map[k] = pickCol(headers, k); });
      const rows = [];
      sheet.eachRow((row, n) => {
        if (n <= band.to || rows.length >= 2000) return;
        const rec = {};
        let has = false;
        for (let c = 1; c <= cols; c++) {
          const t = cellText(row.getCell(c));
          if (t) has = true;
          rec[headers[c - 1]] = t;
        }
        if (has) rows.push(rec);
      });
      const nameCol = map.name || headers[0];
      const valid = rows.filter((r) => {
        const nm = normName(r[nameCol]);
        return nm && !HEADER_ROW.test(nm);
      });
      // كم صنفاً بلا كمية كلية: ورقة كلها بلا كميات غالباً نموذج فارغ لم يُعبَّأ
      const noQty = map.qty ? valid.filter((r) => num(String(r[map.qty] == null ? "" : r[map.qty]).trim()) == null).length : valid.length;
      sheets.push({ name: sheet.name.trim(), headers, map, rows, valid: valid.length, noQty, nameCol });
    });
    if (!sheets.length) throw new Error("لا توجد أوراق في هذا المصنّف");
    if (!sheets.some((sh) => sh.valid)) {
      throw new Error("قُرئت الأوراق لكن لم يُعثر على صفوف أصناف. تأكّد أن في كل ورقة عموداً لاسم الصنف وصفوفاً تحته.");
    }
    return sheets;
  }

  /* يحوّل شبكة نصوص (من CSV) إلى الشكل نفسه الذي تنتجه أوراق Excel */
  function gridToSheet(grid, sheetName) {
    const fake = { rowCount: Math.min(grid.length, 12), getRow: (r) => ({ getCell: (c) => (grid[r - 1] || [])[c - 1] || "" }) };
    const cols = Math.max(...grid.slice(0, 12).map((r) => r.length), 1);
    const band = headerBandOf(fake, cols, (v) => String(v || "").trim());
    const headers = band.headers;
    const map = {};
    Object.keys(COLS).forEach((k) => { map[k] = pickCol(headers, k); });
    const rows = grid.slice(band.to).filter((r) => r.some((t) => t)).map((r) => {
      const rec = {};
      headers.forEach((h, i) => { rec[h] = r[i] == null ? "" : r[i]; });
      return rec;
    });
    const nameCol = map.name || headers[0];
    const valid = rows.filter((r) => { const nm = normName(r[nameCol]); return nm && !HEADER_ROW.test(nm); });
    return { name: sheetName, headers, map, rows, valid: valid.length, nameCol };
  }

  let imp = null;   // [{name, map, rows, valid, nameCol, locId}]

  /* سجلّ خطوات الرفع: يُرى في الصفحة، فلا يبقى أي فشل صامتاً */
  function step(msg, bad) {
    const box = document.getElementById("inv-steps");
    if (!box) return;
    /* يُكتب دائماً، ولا يظهر إلا عند خطأ: في الحالة الطبيعية النافذة تكفي */
    if (bad) box.hidden = false;
    const t = new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const li = document.createElement("div");
    li.className = bad ? "bad" : "";
    li.textContent = `${t} — ${msg}`;
    box.appendChild(li);
    while (box.children.length > 12) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  let lastPick = 0;
  /* يلتقط الملف من الحقل مرة واحدة ولو وصل الحدث من مسارين */
  function pickFrom(input, how) {
    const f = input.files && input.files[0];
    if (!f) { step("لم يصل أي ملف من المنتقي", true); return; }
    const now = Date.now();
    if (now - lastPick < 400) return;
    lastPick = now;
    handleFile(f, how);
    setTimeout(() => { input.value = ""; }, 0);
  }

  /* المسار الوحيد لمعالجة ملف مختار، أياً كان مصدره */
  function handleFile(f, how) {
    step(`وصل الملف (${how}): ${f.name} — ${Math.round(f.size / 1024)} ك.ب`);
    openModal("قراءة الملف", `<p style="margin:0">جارٍ قراءة <b>${esc(f.name)}</b>…</p>`, "");
    readWorkbook(f).then((sheets) => {
      step(`قُرئت ${sheets.length} ورقة`);
      importDlg(sheets);
    }).catch((err) => {
      step(`فشلت القراءة: ${err && err.message ? err.message : err}`, true);
      importError(err);
    });
  }

  /* خطأ الاستيراد يُعرض في نافذة: التنبيه الخاطف يمرّ دون أن يُقرأ */
  function importError(err) {
    openModal("تعذّر استيراد الملف",
      `<p style="margin:0 0 10px">${esc(err && err.message ? err.message : "خطأ غير معروف")}</p>
       <div class="note-box">الصيغة المدعومة: ‎.xlsx‎ (ومعها ‎.csv‎ لورقة واحدة). كل ورقة في المصنّف تُستورد موقعاً باسمها، ويلزم في كل ورقة عمود لاسم الصنف.
       <br>تفاصيل ما جرى تظهر في سجلّ الخطوات أسفل الصفحة.</div>`,
      `<button class="btn" type="button" data-modal-close>حسناً</button>`);
  }

  function importDlg(sheets) {
    /* اسم الورقة بلا «مسار» ولا اللاحقة «(2)»: المصنّفات الحقيقية فيها نسخ
       مكرّرة قديمة من الورقة نفسها، واستيرادها يُنشئ مواقع وهمية */
    const bare = (v) => normName(String(v || "").replace(/^مسار\s+/, "").replace(/\s*\(\d+\)\s*$/, ""));
    const seen = [];
    imp = sheets.map((sh) => {
      const key = bare(sh.name);
      // Excel يقصّ اسم الورقة عند 31 حرفاً، فنسخة «… (2)» تأتي باسم مبتور:
      // تُعدّ مكرّرة إذا كان اسمها بداية اسم ورقة سابقة أو العكس
      const dup = !!key && seen.some((p) => p === key || (p.length > 6 && key.length > 6 && (p.startsWith(key) || key.startsWith(p))));
      seen.push(key);
      const empty = !sh.valid;
      // ورقة لم يُعرف فيها عمود اسم الصنف ولا كمية واحدة: بقايا جدول قديم
      const weak = !sh.map.name && sh.noQty === sh.valid;
      const hit = locs().find((l) => bare(l.name) === key)
        || locs().find((l) => bare(l.name) && (key.includes(bare(l.name)) || bare(l.name).includes(key)));
      return Object.assign({}, sh, {
        dup, empty, weak,
        locId: (dup || empty || weak) ? "__skip__" : hit ? hit.id : "__new__",
      });
    });
    const take = () => imp.filter((s) => s.locId !== "__skip__");
    const total = take().reduce((a, s) => a + s.valid, 0);
    const noQty = take().reduce((a, s) => a + s.noQty, 0);
    const rows = imp.map((sh, k) => `<tr>
        <td><b>${esc(sh.name)}</b><div class="sub">عمود الاسم: ${esc(sh.nameCol)}${sh.dup ? " — نسخة مكرّرة" : sh.empty ? " — بلا أصناف" : sh.weak ? " — عمود الاسم غير مؤكّد" : ""}</div></td>
        <td class="n">${sh.valid}</td>
        <td class="n">${!sh.valid ? '<span class="sub">—</span>'
          : sh.noQty === sh.valid ? '<span class="pill short">كلها بلا كمية</span>'
          : sh.noQty ? `<span class="pill over">${sh.noQty}</span>` : '<span class="pill ok">مكتملة</span>'}</td>
        <td><select data-sheet="${k}">
          <option value="__new__" ${sh.locId === "__new__" ? "selected" : ""}>موقع جديد باسم الورقة</option>
          <option value="__skip__" ${sh.locId === "__skip__" ? "selected" : ""}>تجاهل هذه الورقة</option>
          ${locs().map((l) => `<option value="${l.id}" ${sh.locId === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
        </select></td>
      </tr>`).join("");
    const skipped = imp.length - take().length;
    openModal("استيراد أصناف من مصنّف Excel",
      `<p class="sub">وُجدت <b>${imp.length}</b> ورقة، وسيُستورد منها <b>${total}</b> صنفاً${skipped ? ` بعد تجاهل <b>${skipped}</b> ورقة مكرّرة أو فارغة أو غير مفهومة — راجِعها في الجدول إن أردت ضمّها` : ""}. الرفع المتكرر يُحدِّث الأصناف ولا يكرّرها.</p>
       ${noQty === total && total ? '<div class="note-box" style="color:var(--short);margin-top:10px">تنبيه: لا توجد <b>كمية كلية</b> لأي صنف في هذا المصنّف — غالباً هذا نموذج فارغ لم يُعبَّأ. الاستيراد سينجح لكن الجرد لن يعرف الكمية المتوقعة لأي صنف، فلن تظهر نواقص ولا زيادات.</div>'
        : noQty ? `<div class="note-box" style="margin-top:10px"><b>${noQty}</b> صنفاً بلا كمية كلية؛ تُستورد وتبقى كميتها فارغة حتى تُكتب يدوياً أو تُعتمد من أول جرد.</div>` : ""}
       <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>الورقة</th><th class="n">أصناف</th><th class="n">بلا كمية</th><th>الموقع</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button><button class="btn" type="button" id="inv-do-import" data-act="do-import">استيراد ${total} صنفاً</button>`);
  }

  /* تغيير وجهة ورقة يُحدِّث العدد على الزرّ فوراً، فلا يضغط المستخدم على رقم قديم */
  function importTotals() {
    const b = document.getElementById("inv-do-import");
    if (!b || !imp) return;
    const n = imp.filter((s) => s.locId !== "__skip__").reduce((a, s) => a + s.valid, 0);
    b.textContent = n ? `استيراد ${n} صنفاً` : "لا ورقة مختارة";
    b.disabled = !n;
  }

  function runImport() {
    let added = 0, updated = 0, newLocs = 0, skipped = 0, keptQty = 0;
    imp.forEach((sh) => {
      if (sh.locId === "__skip__") return;
      let locId = sh.locId;
      if (locId === "__new__") {
        const hit = locs().find((l) => normName(l.name) === normName(sh.name));
        if (hit) locId = hit.id;
        else { const l = { id: uid("l"), name: sh.name, type: "track" }; locs().push(l); locId = l.id; newLocs++; }
      }
      const g = (r, k) => sh.map[k] ? String(r[sh.map[k]] == null ? "" : r[sh.map[k]]).trim() : "";
      sh.rows.forEach((r) => {
        const name = normName(r[sh.nameCol]);
        if (!name || HEADER_ROW.test(name)) { skipped++; return; }
        const catText = normHead(g(r, "cat"));
        const unitText = normHead(g(r, "unit"));
        const nameNorm = normHead(name);
        const cat = /مكن|ماكين/.test(catText) ? "machine"
          : /ماده|مستهلك|خام/.test(catText) ? "material"
          : /اثاث|تجهيز|كرسي|طاوله/.test(catText) ? "furniture"
          // بلا عمود نوع: الوحدة ثم الاسم يرجّحان أنها مادة تُستهلك
          : (MAT_UNIT.test(unitText) || MAT_NAME.test(nameNorm)) ? "material" : "tool";
        // الصنف يتميّز بموقعه واسمه ومكنته: «النمر 1+3» لماكنتين مختلفتين صنفان
        const grp = normName(g(r, "group"));
        const old = items().find((x) => x.loc === locId && normName(x.name) === name && normName(x.group || "") === grp);
        const qty = num(g(r, "qty"));
        const min = num(g(r, "min")) || 0;
        let unit = g(r, "unit");
        // «دستة» في عمود الوحدة: تُسجَّل عبوةً لا وحدةً أساسية، ويبقى معاملها
        // فارغاً حتى يكتبه المستخدم من «الوحدة والعبوة»
        let pack = "", measure = "count";
        if (unit && PACK_HINTS.includes(normName(unit))) { pack = normName(unit); unit = ""; }
        else if (/^(كجم|كغم|كيلو|جم|غرام|جرام|طن)$/.test(normHead(unit))) measure = "weight";
        else if (/^(متر|سم|ملم)$/.test(normHead(unit))) measure = "length";
        else if (/^(لتر|مل|جالون)$/.test(normHead(unit))) measure = "volume";
        const group = grp, desc = normName(g(r, "desc"));
        if (old) {
          if (unit) old.unit = unit;
          if (pack && !old.pack) old.pack = pack;
          if (measure !== "count") old.measure = measure;
          // خانة كمية فارغة تعني «لا معلومة» لا «صفر»: رفع نموذج فارغ فوق
          // بيانات قائمة كان يمحو كل الكميات المسجَّلة
          if (qty != null) old.qty = qty;
          else if (old.qty != null) keptQty++;
          if (min) old.min = min;
          if (group) old.group = group;
          if (desc) old.desc = desc;
          old.active = true;
          updated++;
        } else {
          items().push({ id: uid("i"), loc: locId, name, unit, qty, min, cat, group, desc, measure, pack, packQty: 0, note: "", active: true });
          added++;
        }
      });
    });
    save(); closeModal(); render();
    toast(`الاستيراد: ${added} صنفاً جديداً و${updated} محدَّثاً${newLocs ? ` و${newLocs} موقعاً جديداً` : ""}${skipped ? ` و${skipped} صفاً متجاوَزاً` : ""}${keptQty ? ` — وأُبقيت كمية ${keptQty} صنفاً كما هي لأن الملف جاء بخانة فارغة` : ""}`);
  }

  /* ===== الرسم والأحداث ===== */
  function render() {
    // إعادة الرسم تُؤجَّل ما دامت نافذة مفتوحة (معاينة استيراد أو إغلاق جلسة)
    const back = document.getElementById("inv-modal");
    if (back && back.classList.contains("open")) return;
    ensureLocs();
    const nav = document.getElementById("inv-nav");
    if (!nav) return;
    nav.innerHTML = NAV.map(([k, t]) => `<button type="button" class="${u.view === k ? "on" : ""}" data-view="${k}"><span class="material-symbols-outlined">${NAVI[k]}</span>${t}</button>`).join("");
    const hint = document.getElementById("inv-hint");
    if (hint) {
      hint.hidden = !HINTS[u.view];
      hint.innerHTML = HINTS[u.view] ? `<span class="material-symbols-outlined">info</span><span>${HINTS[u.view]}</span>` : "";
    }
    document.getElementById("inv-main").innerHTML = (VIEWS[u.view] || VIEWS.dash)();
    if (AFTER[u.view]) AFTER[u.view]();
  }

  /* نسخة الصفحة المخزّنة قد تسبق نسخة الوحدة، فتختفي عناصر الجرد
     وتبدو الأزرار بلا أثر. يُكتشف ذلك ويُعرض زرّ تحديث صريح. */
  function staleShell(root) {
    root.innerHTML = `<div class="card" style="text-align:center;padding:30px">
        <h3 style="margin:0 0 8px">نسخة الصفحة المحفوظة في متصفحك قديمة</h3>
        <p class="sub" style="margin:0 0 14px">صفحة الجرد تحدّثت، والنسخة المخزّنة على جهازك سابقة لها، لذلك لا تستجيب الأزرار.</p>
        <button class="btn" type="button" id="inv-force">↻ تحديث النسخة الآن</button>
      </div>`;
    const b = document.getElementById("inv-force");
    if (b) b.addEventListener("click", async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { /* متصفح بلا تخزين مؤقت */ }
      location.reload(true);
    });
  }

  function init() {
    const root = document.getElementById("view-inventory");
    if (!root) return;
    if (!document.getElementById("inv-main") || !document.getElementById("inv-nav")) { staleShell(root); return; }

    const onClick = (e) => {
      const t = e.target;
      const view = t.closest("[data-view]"); if (view) return go(view.dataset.view);
      const goBtn = t.closest("[data-go]"); if (goBtn) return go(goBtn.dataset.go, goBtn.dataset.loc ? { loc: goBtn.dataset.loc } : {});
      const ses = t.closest("[data-ses]"); if (ses) return go(null, { ses: ses.dataset.ses });
      const chip = t.closest("[data-chip]"); if (chip) { u.filter = chip.dataset.chip; drawProgress(); drawRows(); return; }
      const fold = t.closest("[data-fold]");
      if (fold) { const k = fold.dataset.fold; folded.has(k) ? folded.delete(k) : folded.add(k); drawRows(); return; }
      const allok = t.closest("[data-allok]"); if (allok) { if (sessionClosed()) return; return fillGroup(allok.dataset.allok); }
      const wk = t.closest("[data-week]"); if (wk) return go("week", { week: wk.dataset.week === "0" ? weekOf(today()) : addDays(u.week || weekOf(u.date), +wk.dataset.week) });
      if (t.closest("[data-modal-close]")) return closeModal();

      const row = t.closest(".row[data-id]");
      if (row) {
        const id = row.dataset.id;
        const b = t.closest("[data-bump]"); if (b) return bump(id, +b.dataset.bump);
        const same = t.closest("[data-same]"); if (same) return setVal(id, same.dataset.same);
        const ub = t.closest("[data-ubump]"); if (ub) return bumpUse(id, +ub.dataset.ubump);
        if (t.closest("[data-issue]")) return issueDlg(id);
        if (t.closest("[data-back]")) return backToStock(id);
        if (t.closest("[data-tomat]")) return switchKind(id, true);
        if (t.closest("[data-totool]")) return switchKind(id, false);
        if (t.closest("[data-clear]")) return setVal(id, "");
        if (t.closest("[data-note]")) return noteDlg(id);
      }
      const tr = t.closest("tr[data-id]");
      if (tr) {
        if (t.closest("[data-edit]")) return itemDlg(tr.dataset.id);
        if (t.closest("[data-del]")) return delItem(tr.dataset.id);
        if (t.closest("[data-undo]")) return undoMove(tr.dataset.id);
      }
      const locRow = t.closest("tr[data-loc]");
      if (locRow && t.closest("[data-delloc]")) {
        const id = locRow.dataset.loc, l = locById(id);
        if (itemsOf(id).length) return toast("انقل أصناف الموقع أو احذفها أولاً");
        ask("حذف موقع", `<p style="margin:0">حذف <b>${esc((l || {}).name || "")}</b>؟ لا أصناف فيه.</p>`, "احذفه", () => {
          store.get().invLocs = locs().filter((x) => x.id !== id);
          save(); render(); toast("حُذف الموقع");
        }, true);
        return;
      }

      const act = t.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "ask-yes") { const f = pending; pending = null; closeModal(); if (f) f(); return; }
      if (a === "note-save") { const b = document.getElementById("inv-note-txt"); return noteSave(b ? b.value : ""); }
      if (a === "note-del") return noteSave("");
      if (a === "fill") return fillRemaining();
      if (a === "copym") return copyMorning();
      if (a === "reopen") return reopenSession();
      if (a === "close") return closeSessionDlg();
      if (a === "do-close") return closeSession();
      if (a === "print") return window.print();
      if (a === "export-week") return exportWeek().catch((err) => toast(err.message));
      if (a === "export-items") return exportItems().catch((err) => toast(err.message));
      if (a === "carry-dlg") return carryDlg();
      if (a === "carry-keep") { closeModal(); return carryKeep(); }
      if (a === "carry-run") return carryRun();
      if (a === "units") return unitsDlg(act.dataset.id || "");
      if (a === "save-units") return saveUnits();
      if (a === "set-base") return setBaseFromCount();
      if (a === "bulk-mat" || a === "bulk-tool") return bulkCat(a === "bulk-mat");
      if (a === "new-item") return itemDlg("");
      if (a === "save-item") return saveItem(act.dataset.id || "");
      if (a === "new-move") return moveDlg();
      if (a === "save-move") return saveMove();
      if (a === "import") return document.getElementById("inv-file").click();
      if (a === "do-import") return runImport();
      if (a === "do-issue") return doIssue(act.dataset.id);
      if (a === "add-loc") {
        const v = normName(document.getElementById("inv-newloc").value);
        if (!v) return toast("اكتب اسم الموقع");
        locs().push({ id: uid("l"), name: v, type: "track" });
        save(); render(); toast("أُضيف الموقع");
      }
    };
    root.addEventListener("click", onClick);

    const onChange = (e) => {
      const t = e.target;
      const set = t.closest("[data-set]");
      if (set) { const k = set.dataset.set; return go(null, { [k]: set.value }); }
      if (t.id === "inv-file") { pickFrom(t, "تفويض"); return; }
      const sh = t.closest("[data-sheet]");
      if (sh && imp) { imp[+sh.dataset.sheet].locId = sh.value; importTotals(); return; }
      const row = t.closest(".row[data-id]");
      if (row && t.matches("[data-val]")) return setVal(row.dataset.id, t.value);
      if (row && t.matches("[data-use]")) return setUse(row.dataset.id, t.value);
      const tr = t.closest("tr[data-id]");
      if (tr) {
        const it = itemById(tr.dataset.id);
        if (it && t.matches("[data-cellunit]")) {
          it.cellUnit = Object.assign({}, it.cellUnit, { [t.dataset.cellunit]: +t.value });
          save(); render(); return;
        }
        if (it && t.matches("[data-qty]")) { const v = num(t.value); it.qty = v == null ? null : r3(v * cellFactor(it, "qty")); save(); render(); return; }
        if (it && t.matches("[data-cat]")) { it.cat = t.value; delete it.use; save(); render(); return; }
        if (it && t.matches("[data-inuse]")) { it.inUse = r3(Math.max(0, num(t.value) || 0) * cellFactor(it, "inuse")); save(); render(); return; }
        if (it && t.matches("[data-min]")) { it.min = r3((num(t.value) || 0) * cellFactor(it, "min")); save(); render(); return; }
      }
      const locRow = t.closest("tr[data-loc]");
      if (locRow && t.matches("[data-locname]")) {
        const l = locById(locRow.dataset.loc);
        if (l) { l.name = normName(t.value) || l.name; save(); }
        return;
      }
      const day = t.closest("[data-day]");
      if (day) {
        const k = +day.dataset.day, s = new Set(meta().workDays);
        day.checked ? s.add(k) : s.delete(k);
        if (!s.size) { day.checked = true; return toast("يجب اختيار يوم عمل واحد على الأقل"); }
        meta().workDays = [...s].sort(); save(); return;
      }
      if (t.id === "inv-center") { meta().center = normName(t.value); save(); return; }
      if (t.id === "inv-course") { meta().course = normName(t.value); save(); return; }
    };
    root.addEventListener("change", onChange);

    root.addEventListener("input", (e) => {
      if (e.target.id === "inv-q") { u.q = e.target.value; drawRows(); }
      if (e.target.id === "inv-iq") { u.iQ = e.target.value; render(); const el = document.getElementById("inv-iq"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    });

    /* الإدخال بلوحة المفاتيح: Enter وسهم لأسفل ينتقلان للصنف التالي،
       وسهم لأعلى للسابق، فيُجرد المسار كلّه دون لمس الفأرة */
    root.addEventListener("keydown", (e) => {
      if (!e.target.matches("[data-val],[data-use]")) return;
      const isU = e.target.matches("[data-use]");
      const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const row = e.target.closest(".row[data-id]");
      const ids = $$("#inv-rows .row[data-id]").map((r) => r.dataset.id);
      const to = ids[ids.indexOf(row.dataset.id) + step];
      if (isU) setUse(row.dataset.id, e.target.value); else setVal(row.dataset.id, e.target.value);
      if (!to) { if (step > 0) toast("آخر صنف في القائمة"); return; }
      const el = document.querySelector(`#inv-rows .row[data-id="${to}"] input[data-val], #inv-rows .row[data-id="${to}"] input[data-use]`);
      if (el) { el.focus(); el.select(); }
    });

    /* النافذة صارت خارج ‎#view-inventory‎ (في جذر الصفحة) حتى لا يحجبها شيء،
       ولذلك لا تصل أحداثها إلى مستمع الشاشة: تُربط هنا على المستمعين نفسيهما. */
    const modal = document.getElementById("inv-modal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target.id === "inv-modal") return closeModal();
        const add = e.target.closest("#un-add");
        if (add) { unitReadRows(); unitRows.push({ name: "", n: 10 }); unitRowsDraw(null); return; }
        const del = e.target.closest("[data-un-del]");
        if (del) { unitReadRows(); unitRows.splice(+del.dataset.unDel, 1); unitRowsDraw(null); return; }
        onClick(e);
      });
      modal.addEventListener("change", onChange);
      modal.addEventListener("input", (e) => {
        if (e.target.closest("#un-rows") || e.target.id === "un-useunit" || e.target.id === "un-measure") {
          unitReadRows();
          if (e.target.id === "un-measure") return unitRowsDraw(null);
          // الاسم المكتوب يظهر في «يضمّ … من» وفي قائمة وحدة الاستهلاك
          const sel = document.getElementById("un-useunit");
          if (sel && e.target.matches("[data-un-name]")) {
            const keep = +sel.value || 0;
            sel.innerHTML = unitRows.map((lv, k) => `<option value="${k}" ${k === keep ? "selected" : ""}>${esc(lv.name || "…")}</option>`).join("");
            $$("#un-rows .unit-of").forEach((el, k) => { el.textContent = `من «${unitRows[k].name || "…"}»، واسمها`; });
          }
          unitPreview();
        }
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !modal || !modal.classList.contains("open")) return;
      closeModal();
    });

    /* ربط مباشر على حقل الملف: لا يعتمد على تفويض الأحداث ولا على بقاء
       العنصر في شجرة الصفحة، فيعمل حتى لو تعطّل أحدهما */
    const file = document.getElementById("inv-file");
    if (file) {
      file.addEventListener("click", () => step("فُتح منتقي الملفات"));
      file.addEventListener("change", () => pickFrom(file, "مباشر"));
      file.addEventListener("cancel", () => step("أُغلق المنتقي بلا اختيار"));
    } else {
      step("حقل الملف غير موجود في الصفحة", true);
    }

    // الإفلات: مسار ثانٍ للرفع لا يمرّ بزرّ ولا بمنتقي الملفات
    ["dragenter", "dragover"].forEach((ev) => root.addEventListener(ev, (e) => {
      if (!e.target.closest("#inv-drop")) return;
      e.preventDefault(); e.target.closest("#inv-drop").classList.add("over");
    }));
    ["dragleave", "drop"].forEach((ev) => root.addEventListener(ev, (e) => {
      const z = e.target.closest("#inv-drop");
      if (z) z.classList.remove("over");
    }));
    root.addEventListener("drop", (e) => {
      const z = e.target.closest("#inv-drop");
      if (!z) return;
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) { step("أُفلت شيء ليس ملفاً", true); return; }
      handleFile(f, "إفلات");
    });
  }

  /* للوحة الرئيسية: الأصناف تحت الحدّ الأدنى والفروقات المفتوحة اليوم */
  function alerts() {
    const low = items().filter((i) => i.active !== false && i.min && i.qty != null && (i.qty + inUseOf(i)) <= i.min);
    const t = today();
    const bad = [];
    locs().forEach((l) => itemsOf(l.id).forEach((i) => { const a = actualInfo(t, l.id, i); if (a && a.s === "short") bad.push(i); }));
    return { low, bad };
  }

  App.inventory = { init, render, alerts };
})(window.App = window.App || {});
