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
    out: { t: "صرف / إخراج", sign: -1, c: "prog" },
    consume: { t: "استهلاك", sign: -1, c: "over" },
    damage: { t: "تالف", sign: -1, c: "short" },
    loss: { t: "فقد", sign: -1, c: "short" },
    transfer: { t: "نقل إلى موقع آخر", sign: -1, c: "prog" },
    adjust: { t: "تسوية الكمية", sign: 0, c: "idle" },
  };
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const SES = { m: "صباحي", e: "مسائي" };
  const NAV = [["dash", "لوحة المتابعة"], ["count", "الجرد اليومي"], ["week", "كشف الأسبوع"],
    ["items", "الأصناف"], ["moves", "الحركات"], ["settings", "الإعدادات"]];

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
  const fmtN = (v) => v == null ? "—" : (Math.round(v * 100) / 100).toLocaleString("en-US");
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
      c = { id: countKeyOf(date, loc), date, loc, m: {}, e: {}, x: { m: {}, e: {} }, n: {}, done: {} };
      counts().push(c);
    }
    c.x = c.x || { m: {}, e: {} }; c.n = c.n || {}; c.done = c.done || {};
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
  function progress(date, loc, ses) {
    const its = itemsOf(loc), c = cnt(date, loc);
    const r = { total: its.length, n: 0, ok: 0, short: 0, over: 0, nobase: 0, empty: 0, done: (c && c.done[ses]) || null };
    its.forEach((i) => { const v = c ? c[ses][i.id] : null; if (v != null) { r.n++; r[st(v, expOf(c, ses, i))]++; } });
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
      if (i.min && i.qty != null && i.qty <= i.min) alerts.push({ c: "var(--over)", h: `<b>${esc(i.name)}</b> بلغ الحدّ الأدنى`, s: `${esc(l.name)} — المتبقي ${fmtN(i.qty)} والحدّ ${fmtN(i.min)}` });
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
          <div class="bar noprint">
            <select data-set="loc" aria-label="الموقع">${locOptions(u.loc)}</select>
            <input type="date" value="${u.date}" data-set="date" aria-label="التاريخ">
            <div class="seg">${Object.keys(SES).map((k) => `<button type="button" class="${u.ses === k ? "on" : ""}" data-ses="${k}">${SES[k]}</button>`).join("")}</div>
          </div>
        </div>
        <div id="inv-prog"></div>
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
      <div id="inv-rows" class="${closed ? "locked" : ""}">${all.length ? "" : `<div class="card empty">لا توجد أصناف في هذا الموقع.<br><button class="btn" style="margin-top:10px" data-go="items">أضف صنفاً</button></div>`}</div>`;
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
  }

  function rowState(item) {
    const c = cnt(u.date, u.loc);
    const v = c ? (c[u.ses][item.id] == null ? null : c[u.ses][item.id]) : null;
    const x = expOf(c, u.ses, item);
    return { v, x, m: c ? (c.m[item.id] == null ? null : c.m[item.id]) : null, note: (c && c.n[item.id]) || "", s: st(v, x) };
  }

  function rowHTML(item) {
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
      ${r.x != null ? `<button type="button" class="okb" data-same="${r.x}">مطابق</button>` : "<span></span>"}
      <div class="diff">${diff}</div>
      <button type="button" class="icon-btn ${r.note ? "has" : ""}" data-note title="ملاحظة" aria-label="ملاحظة"><span class="material-symbols-outlined btn-ico">sticky_note_2</span></button>
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
      const s = rowState(i).s;
      return u.filter === "todo" ? s === "empty" : (s === "short" || s === "over");
    });
    if (!list.length) {
      wrap.innerHTML = `<div class="card empty">${u.filter === "todo" ? "تم جرد كل الأصناف في هذه الجلسة." : u.filter === "diff" ? "لا توجد فروقات حتى الآن." : "لا يوجد صنف بهذا الاسم."}</div>`;
      return;
    }
    const secs = new Map();
    list.forEach((i) => { const k = i.group ? i.group : CATS[i.cat] || "أخرى"; if (!secs.has(k)) secs.set(k, []); secs.get(k).push(i); });
    wrap.innerHTML = [...secs].map(([k, its]) =>
      `<div class="section-h"><h3>${esc(k)}</h3><span>${its.length} صنف</span></div><div class="rows">${its.map(rowHTML).join("")}</div>`).join("");
  }

  function refreshRow(id) {
    const el = document.querySelector(`#inv-rows .row[data-id="${id}"]`);
    const it = itemById(id);
    if (el && it) el.outerHTML = rowHTML(it);
    drawProgress();
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
  function fillRemaining() {
    const its = itemsOf(u.loc).filter((i) => rowState(i).v == null && i.qty != null);
    if (!its.length) return toast("لا توجد أصناف متبقية لها كمية متوقعة");
    if (!confirm(`سيُسجَّل ${its.length} صنفاً غير معدود بقيمته المتوقعة (مطابق). استخدمها بعد التأكد الفعلي من وجودها.`)) return;
    const c = cnt(u.date, u.loc, true);
    its.forEach((i) => { c[u.ses][i.id] = i.qty; c.x[u.ses][i.id] = i.qty; });
    save(); render(); toast(`سُجّل ${its.length} صنفاً كمطابق`);
  }
  function copyMorning() {
    const c = cnt(u.date, u.loc, true);
    const its = itemsOf(u.loc).filter((i) => c.e[i.id] == null && c.m[i.id] != null);
    if (!its.length) return toast("لا توجد قيم صباحية لنسخها");
    its.forEach((i) => { c.e[i.id] = c.m[i.id]; c.x.e[i.id] = i.qty == null ? null : i.qty; });
    save(); render(); toast(`نُسخت ${its.length} قيمة من الجلسة الصباحية`);
  }
  function reopenSession() {
    if (!confirm("ستتمكن من تعديل الأرقام. الحركات التي سُجّلت عند الإغلاق تبقى كما هي.")) return;
    const c = cnt(u.date, u.loc, true);
    delete c.done[u.ses];
    save(); render(); toast("أُعيد فتح الجلسة");
  }

  /* إغلاق الجلسة: يعرض النواقص والزيادات ويحوّلها حركات */
  function closeSessionDlg() {
    const its = itemsOf(u.loc);
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
    const loc = locById(u.weekLoc), wd = workDates(ws), its = u.weekLoc ? itemsOf(u.weekLoc) : [];
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
      ${its.length ? `<div class="table-wrap"><table class="sheet"><thead>
        <tr><th rowspan="2">م</th><th rowspan="2">اسم الأداة</th><th rowspan="2">الوحدة</th><th rowspan="2">الكمية الكلية</th>${wd.map((d) => `<th class="day" colspan="3">${dayName(d)} ${fmtD(d)}</th>`).join("")}</tr>
        <tr>${wd.map(() => "<th>صباحي</th><th>مسائي</th><th>الفعلية</th>").join("")}</tr></thead><tbody>${body}</tbody></table></div>`
        : '<div class="card empty">لا توجد أصناف في هذا الموقع.</div>'}`;
  };

  /* --- الأصناف --- */
  VIEWS.items = () => {
    const q = normName(u.iQ);
    const list = items().filter((i) => i.active !== false)
      .filter((i) => u.iLoc === "all" || i.loc === u.iLoc)
      .filter((i) => u.iCat === "all" || i.cat === u.iCat)
      .filter((i) => !q || i.name.includes(q) || String(i.group || "").includes(q));
    const rows = list.map((i) => `<tr data-id="${i.id}">
      <td><b>${esc(i.name)}</b>${i.group ? `<div class="sub">${esc(i.group)}</div>` : ""}</td>
      <td class="sub">${esc((locById(i.loc) || {}).name || "")}</td>
      <td class="sub">${CATS[i.cat] || ""}</td>
      <td class="sub">${esc(i.unit || "")}</td>
      <td class="n"><input type="number" class="inv-cell" data-qty value="${i.qty == null ? "" : i.qty}" placeholder="—"></td>
      <td class="n"><input type="number" class="inv-cell" data-min value="${i.min || 0}"></td>
      <td class="noprint"><button class="btn small secondary" data-edit>تعديل</button> <button class="btn small danger" data-del>حذف</button></td>
    </tr>`).join("");
    return `
      <div class="head"><div><h1>الأصناف</h1><p class="lead">${list.length} صنفاً معروضاً من ${items().filter((i) => i.active !== false).length}</p></div>
        <div class="bar noprint">
          <button class="btn" data-act="new-item">صنف جديد</button>
          <label class="btn secondary" for="inv-file" style="cursor:pointer">رفع ملف Excel</label>
          <button class="btn secondary" data-act="export-items">تصدير الأصناف</button>
        </div></div>
      <label class="inv-drop" for="inv-file" id="inv-drop">
        <b>اسحب ملف الجرد هنا، أو اضغط لاختياره</b>
        <span>مصنّف Excel ‎.xlsx‎ فيه ورقة لكل مسار (أو ملف ‎.csv‎ لمسار واحد)</span>
      </label>
      <div class="reg-toolbar">
        <div class="reg-search-box"><input type="search" id="inv-iq" placeholder="بحث باسم الصنف أو المكنة" value="${esc(u.iQ)}"></div>
        <select data-set="iLoc">${locOptions(u.iLoc, true)}</select>
        <select data-set="iCat"><option value="all">كل الأنواع</option>${catOptions(u.iCat)}</select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الموقع</th><th>النوع</th><th>الوحدة</th><th class="n">الكمية الكلية</th><th class="n">الحدّ الأدنى</th><th class="noprint"></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">لا أصناف مطابقة.</td></tr>'}</tbody></table></div>`;
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
    return m.type === "adjust" ? `إلى ${fmtN(m.qty)} ${esc(m.unit || "")}` : `${MOVES[m.type].sign > 0 ? "+" : "−"}${fmtN(m.qty)} ${esc(m.unit || "")}`;
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
    if (!m || !confirm("التراجع يعيد الكميات كما كانت قبل هذه الحركة. متابعة؟")) return;
    (m.deltas || []).forEach((d) => { const it = itemById(d.itemId); if (it) it.qty = Math.max(0, (it.qty == null ? 0 : it.qty) - d.d); });
    store.get().invMoves = moves().filter((x) => x.id !== id);
    save(); render(); toast("تم التراجع عن الحركة");
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

  /* ===== الأصناف: تحرير وحذف ===== */
  function itemDlg(id) {
    const i = id ? itemById(id) : { name: "", loc: (locs()[0] || {}).id, cat: "tool", unit: "", qty: "", min: 0, group: "", desc: "", note: "" };
    openModal(id ? "تعديل صنف" : "صنف جديد", `
      <div class="inv-form">
        <label class="field" style="grid-column:1/-1"><span>اسم الصنف</span><input type="text" id="it-name" value="${esc(i.name)}"></label>
        <label class="field"><span>الموقع</span><select id="it-loc">${locOptions(i.loc)}</select></label>
        <label class="field"><span>النوع</span><select id="it-cat">${catOptions(i.cat)}</select></label>
        <label class="field"><span>الوحدة</span><input type="text" id="it-unit" value="${esc(i.unit || "")}" placeholder="قطعة، متر"></label>
        <label class="field"><span>المكنة التابع لها</span><input type="text" id="it-group" value="${esc(i.group || "")}" placeholder="اختياري"></label>
        <label class="field"><span>الكمية الكلية</span><input type="number" id="it-qty" value="${i.qty == null ? "" : i.qty}" placeholder="اتركها فارغة إن لم تُعرف"></label>
        <label class="field"><span>الحدّ الأدنى</span><input type="number" id="it-min" value="${i.min || 0}"></label>
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
      desc: normName($("#it-desc").value),
    };
    if (id) Object.assign(itemById(id), data);
    else items().push(Object.assign({ id: uid("i"), active: true, note: "" }, data));
    save(); closeModal(); render(); toast(id ? "حُفظ الصنف" : "أُضيف الصنف");
  }
  function delItem(id) {
    const it = itemById(id);
    if (!it || !confirm(`حذف «${it.name}»؟ سجل حركته وجرده يبقى محفوظاً.`)) return;
    it.active = false;
    save(); render();
  }

  /* ===== نافذة بسيطة داخل الصفحة ===== */
  function openModal(title, body, actions) {
    const back = document.getElementById("inv-modal");
    back.innerHTML = `<div class="modal"><h3>${title}</h3><div class="inv-modal-body">${body}</div><div class="btn-row">${actions}</div></div>`;
    back.classList.add("open");
  }
  function closeModal() {
    const back = document.getElementById("inv-modal");
    back.classList.remove("open");
    back.innerHTML = "";
  }

  /* ===== التصدير ===== */
  async function exportWeek() {
    if (typeof ExcelJS === "undefined") return toast("تعذّر تحميل مكتبة Excel");
    const ws = u.week || weekOf(u.date), wd = workDates(ws);
    const wb = new ExcelJS.Workbook();
    locs().forEach((l) => {
      const its = itemsOf(l.id);
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
    .replace(/^ال/, "").replace(/[\s_\d().:\-\/]/g, "");
  const HEADER_ROW = /^(اسم|الاسم|صنف|الصنف|اسم الصنف|اسم الاداه|اسم الأداة|اسم الجهاز|البند|البيان|الماده|المادة|الوصف|م|#|الرقم|التسلسل|العدد|الكميه|الكمية|نوع|النوع|الوحده|الوحدة|ملاحظات|الاجمالي|الإجمالي|المجموع)$/;
  /* لكل حقل قائمة تعبيرات مرتّبة: يُجرَّب الأدقّ أولاً.
     المهم هنا أن «الكمية الكلية» تسبق «الكمية الفعلية» و«عدد المكن»،
     وأن «اسم الأداة» يسبق أي عمود فيه كلمة «اسم». */
  const COLS = {
    name: [/^اسمالاداه$|^اسمالصنف$|^اسمالجهاز$|^الصنف$|^البند$/, /^اسم/, /صنف|بند|ماده|اداه|جهاز|مسمى/],
    unit: [/^وحده$/, /وحده|قياس/],
    qty: [/^كميهكليه$|^كميه$/, /كميهكليه|رصيد|متوفر|موجود/, /^عدد$|اجمالي|مجموع/],
    min: [/^حدادنى$|^حد$/, /^حد|ادنى|اعادهالطلب/],
    cat: [/^نوع$|^تصنيف$/, /نوع|تصنيف|فئه/],
    group: [/^المكن$|^مكن/, /مكن|ماكين|مجموعه|تابع/],
    desc: [/^وصف$|^ملاحظات$/, /وصف|ملاحظ|بيان/],
  };
  /* أعمدة الجدول اليومي لا تصلح حقولاً للصنف */
  const DAY_COL = /^صباحي$|^مسائي$|^كميهفعليه$|^اليوم$|^التاريخ$|^م$|^#$/;
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
      sheets.push({ name: sheet.name.trim(), headers, map, rows, valid: valid.length, nameCol });
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

  /* خطأ الاستيراد يُعرض في نافذة: التنبيه الخاطف يمرّ دون أن يُقرأ */
  function importError(err) {
    openModal("تعذّر استيراد الملف",
      `<p style="margin:0 0 10px">${esc(err && err.message ? err.message : "خطأ غير معروف")}</p>
       <div class="note-box">الصيغة المدعومة: ‎.xlsx‎ (ومعها ‎.csv‎ لورقة واحدة). كل ورقة في المصنّف تُستورد موقعاً باسمها، ويلزم في كل ورقة عمود لاسم الصنف.</div>`,
      `<button class="btn" type="button" data-modal-close>حسناً</button>`);
  }

  function importDlg(sheets) {
    imp = sheets.map((sh) => {
      const bare = (v) => normName(String(v || "").replace(/^مسار\s+/, ""));
      const hit = locs().find((l) => bare(l.name) === bare(sh.name))
        || locs().find((l) => bare(l.name) && (bare(sh.name).includes(bare(l.name)) || bare(l.name).includes(bare(sh.name))));
      return Object.assign({}, sh, { locId: hit ? hit.id : "__new__" });
    });
    const total = imp.reduce((a, s) => a + s.valid, 0);
    const rows = imp.map((sh, k) => `<tr>
        <td><b>${esc(sh.name)}</b><div class="sub">عمود الاسم: ${esc(sh.nameCol)}</div></td>
        <td class="n">${sh.valid}</td>
        <td><select data-sheet="${k}">
          <option value="__new__" ${sh.locId === "__new__" ? "selected" : ""}>موقع جديد باسم الورقة</option>
          <option value="__skip__">تجاهل هذه الورقة</option>
          ${locs().map((l) => `<option value="${l.id}" ${sh.locId === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
        </select></td>
      </tr>`).join("");
    openModal("استيراد أصناف من مصنّف Excel",
      `<p class="sub">وُجدت <b>${imp.length}</b> ورقة و<b>${total}</b> صنفاً. كل ورقة تُستورد موقعاً باسمها ما لم تختر غير ذلك. الرفع المتكرر يُحدِّث الأصناف ولا يكرّرها.</p>
       <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>الورقة</th><th class="n">أصناف</th><th>الموقع</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<button class="btn secondary" type="button" data-modal-close>إلغاء</button><button class="btn" type="button" data-act="do-import">استيراد ${total} صنفاً</button>`);
  }

  function runImport() {
    let added = 0, updated = 0, newLocs = 0, skipped = 0;
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
        const cat = /مكن|ماكين/.test(catText) ? "machine"
          : /ماده|مستهلك|خام/.test(catText) ? "material"
          : /اثاث|تجهيز|كرسي|طاوله/.test(catText) ? "furniture" : "tool";
        // الصنف يتميّز بموقعه واسمه ومكنته: «النمر 1+3» لماكنتين مختلفتين صنفان
        const grp = normName(g(r, "group"));
        const old = items().find((x) => x.loc === locId && normName(x.name) === name && normName(x.group || "") === grp);
        const qty = num(g(r, "qty"));
        const min = num(g(r, "min")) || 0;
        const unit = g(r, "unit"), group = grp, desc = normName(g(r, "desc"));
        if (old) {
          if (unit) old.unit = unit;
          old.qty = qty;
          if (min) old.min = min;
          if (group) old.group = group;
          if (desc) old.desc = desc;
          old.active = true;
          updated++;
        } else {
          items().push({ id: uid("i"), loc: locId, name, unit, qty, min, cat, group, desc, note: "", active: true });
          added++;
        }
      });
    });
    save(); closeModal(); render();
    toast(`الاستيراد: ${added} صنفاً جديداً و${updated} محدَّثاً${newLocs ? ` و${newLocs} موقعاً جديداً` : ""}${skipped ? ` و${skipped} صفاً متجاوَزاً` : ""}`);
  }

  /* ===== الرسم والأحداث ===== */
  function render() {
    // إعادة الرسم تُؤجَّل ما دامت نافذة مفتوحة (معاينة استيراد أو إغلاق جلسة)
    const back = document.getElementById("inv-modal");
    if (back && back.classList.contains("open")) return;
    ensureLocs();
    const nav = document.getElementById("inv-nav");
    if (!nav) return;
    nav.innerHTML = NAV.map(([k, t]) => `<button type="button" class="${u.view === k ? "on" : ""}" data-view="${k}">${t}</button>`).join("");
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

    root.addEventListener("click", (e) => {
      const t = e.target;
      const view = t.closest("[data-view]"); if (view) return go(view.dataset.view);
      const goBtn = t.closest("[data-go]"); if (goBtn) return go(goBtn.dataset.go, goBtn.dataset.loc ? { loc: goBtn.dataset.loc } : {});
      const ses = t.closest("[data-ses]"); if (ses) return go(null, { ses: ses.dataset.ses });
      const chip = t.closest("[data-chip]"); if (chip) { u.filter = chip.dataset.chip; drawProgress(); drawRows(); return; }
      const wk = t.closest("[data-week]"); if (wk) return go("week", { week: wk.dataset.week === "0" ? weekOf(today()) : addDays(u.week || weekOf(u.date), +wk.dataset.week) });
      if (t.closest("[data-modal-close]")) return closeModal();

      const row = t.closest(".row[data-id]");
      if (row) {
        const id = row.dataset.id;
        const b = t.closest("[data-bump]"); if (b) return bump(id, +b.dataset.bump);
        const same = t.closest("[data-same]"); if (same) return setVal(id, same.dataset.same);
        if (t.closest("[data-note]")) {
          const c = cnt(u.date, u.loc);
          const cur = (c && c.n[id]) || "";
          const v = prompt(`ملاحظة على «${itemById(id).name}» ليوم ${fmtD(u.date)}:`, cur);
          if (v === null) return;
          const cc = cnt(u.date, u.loc, true);
          if (v.trim()) cc.n[id] = v.trim(); else delete cc.n[id];
          save(); refreshRow(id); toast("حُفظت الملاحظة");
          return;
        }
      }
      const tr = t.closest("tr[data-id]");
      if (tr) {
        if (t.closest("[data-edit]")) return itemDlg(tr.dataset.id);
        if (t.closest("[data-del]")) return delItem(tr.dataset.id);
        if (t.closest("[data-undo]")) return undoMove(tr.dataset.id);
      }
      const locRow = t.closest("tr[data-loc]");
      if (locRow && t.closest("[data-delloc]")) {
        const id = locRow.dataset.loc;
        if (itemsOf(id).length) return toast("انقل أصناف الموقع أو احذفها أولاً");
        if (!confirm("حذف الموقع؟")) return;
        store.get().invLocs = locs().filter((l) => l.id !== id);
        save(); render(); return;
      }

      const act = t.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "fill") return fillRemaining();
      if (a === "copym") return copyMorning();
      if (a === "reopen") return reopenSession();
      if (a === "close") return closeSessionDlg();
      if (a === "do-close") return closeSession();
      if (a === "print") return window.print();
      if (a === "export-week") return exportWeek().catch((err) => toast(err.message));
      if (a === "export-items") return exportItems().catch((err) => toast(err.message));
      if (a === "new-item") return itemDlg("");
      if (a === "save-item") return saveItem(act.dataset.id || "");
      if (a === "new-move") return moveDlg();
      if (a === "save-move") return saveMove();
      if (a === "import") return document.getElementById("inv-file").click();
      if (a === "do-import") return runImport();
      if (a === "add-loc") {
        const v = normName(document.getElementById("inv-newloc").value);
        if (!v) return toast("اكتب اسم الموقع");
        locs().push({ id: uid("l"), name: v, type: "track" });
        save(); render(); toast("أُضيف الموقع");
      }
    });

    root.addEventListener("change", (e) => {
      const t = e.target;
      const set = t.closest("[data-set]");
      if (set) { const k = set.dataset.set; return go(null, { [k]: set.value }); }
      if (t.id === "inv-file") {
        const f = t.files && t.files[0]; t.value = "";
        if (f) {
          openModal("قراءة الملف", `<p style="margin:0">جارٍ قراءة <b>${esc(f.name)}</b> (${Math.round(f.size / 1024)} ك.ب)…</p>`, "");
          readWorkbook(f).then(importDlg).catch((err) => importError(err));
        }
        return;
      }
      const sh = t.closest("[data-sheet]");
      if (sh && imp) { imp[+sh.dataset.sheet].locId = sh.value; return; }
      const row = t.closest(".row[data-id]");
      if (row && t.matches("[data-val]")) return setVal(row.dataset.id, t.value);
      const tr = t.closest("tr[data-id]");
      if (tr) {
        const it = itemById(tr.dataset.id);
        if (it && t.matches("[data-qty]")) { it.qty = num(t.value); save(); return; }
        if (it && t.matches("[data-min]")) { it.min = num(t.value) || 0; save(); return; }
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
    });

    root.addEventListener("input", (e) => {
      if (e.target.id === "inv-q") { u.q = e.target.value; drawRows(); }
      if (e.target.id === "inv-iq") { u.iQ = e.target.value; render(); const el = document.getElementById("inv-iq"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    });

    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches("[data-val]")) return;
      e.preventDefault();
      const row = e.target.closest(".row[data-id]");
      const ids = $$("#inv-rows .row[data-id]").map((r) => r.dataset.id);
      const next = ids[ids.indexOf(row.dataset.id) + 1];
      setVal(row.dataset.id, e.target.value);
      if (next) { const el = document.querySelector(`#inv-rows .row[data-id="${next}"] input[data-val]`); if (el) el.focus(); }
    });

    document.getElementById("inv-modal").addEventListener("click", (e) => { if (e.target.id === "inv-modal") closeModal(); });

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
      if (!f) return;
      openModal("قراءة الملف", `<p style="margin:0">جارٍ قراءة <b>${esc(f.name)}</b>…</p>`, "");
      readWorkbook(f).then(importDlg).catch((err) => importError(err));
    });
  }

  /* للوحة الرئيسية: الأصناف تحت الحدّ الأدنى والفروقات المفتوحة اليوم */
  function alerts() {
    const low = items().filter((i) => i.active !== false && i.min && i.qty != null && i.qty <= i.min);
    const t = today();
    const bad = [];
    locs().forEach((l) => itemsOf(l.id).forEach((i) => { const a = actualInfo(t, l.id, i); if (a && a.s === "short") bad.push(i); }));
    return { low, bad };
  }

  App.inventory = { init, render, alerts };
})(window.App = window.App || {});
