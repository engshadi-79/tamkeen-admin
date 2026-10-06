/* جرد المسارات: لكل مسار أصناف ثابتة (أجهزة وأدوات) وأصناف مستهلكة.
   المدرب يسجّل ما استُخدم اليوم فيُخصم من المتبقي، والمشرف يرى المسارات كلها.
   كل عملية تُقيَّد في سجل الحركة باسم من سجّلها ووقتها، ومنه يُبنى تقرير الفترة. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const items = () => (store.get().invItems = store.get().invItems || []);
  const moves = () => (store.get().invMoves = store.get().invMoves || []);
  const trackNames = () => (store.get().tracks || []).map((t) => t.name).filter(Boolean);
  const me = () => (App.profile && App.profile.name ? App.profile.name() : "");
  const canDelete = () => !App.profile || !App.profile.can || App.profile.can("delete");

  const TRACK_KEY = "tamkeen-admin:invTrack";   // مسار المدرب يُحفظ على جهازه فلا يختاره كل مرة
  const KIND = { consumable: "مستهلك", fixed: "ثابت" };
  const STATE = { ok: "سليم", broken: "معطل", lost: "مفقود" };

  const filter = { track: "", kind: "all", q: "", only: "" };
  let period = "week";

  const num = (v) => { const n = Number(String(v).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
  const now = () => new Date().toISOString();
  const dayOf = (iso) => String(iso || "").slice(0, 10);

  /* بداية الفترة: الأسبوع سبعة أيام، والشهر ثلاثون */
  function periodStart() {
    const d = new Date();
    d.setDate(d.getDate() - (period === "month" ? 30 : 7));
    return d.toISOString();
  }

  const ofTrack = (list) => (filter.track ? list.filter((x) => x.track === filter.track) : list);
  const isLow = (it) => it.kind === "consumable" && Number(it.min) > 0 && num(it.qty) <= num(it.min);
  const isBad = (it) => it.kind === "fixed" && it.state && it.state !== "ok";

  function visible() {
    const q = filter.q.trim();
    return ofTrack(items())
      .filter((it) => filter.kind === "all" || it.kind === filter.kind)
      .filter((it) => !q || String(it.name || "").includes(q))
      .filter((it) => filter.only !== "low" || isLow(it))
      .filter((it) => filter.only !== "bad" || isBad(it))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  }

  /* ===== الكتابة: كل تغيير يُقيَّد حركةً ===== */
  function logMove(item, type, qty, note) {
    moves().unshift({
      id: store.uid(), itemId: item.id, track: item.track, name: item.name,
      type, qty: num(qty), at: now(), by: me(), note: note || "",
    });
    if (moves().length > 4000) moves().length = 4000;   // سقف يمنع تضخّم الملف المزامَن
  }

  function use(id, qty) {
    const it = items().find((x) => x.id === id);
    const n = num(qty);
    if (!it || n <= 0) return;
    it.qty = Math.max(0, num(it.qty) - n);
    it.updatedAt = now();
    logMove(it, "use", n, "");
    store.save();
    render();
    ui.toast(`سُجّل استهلاك ${ui.fmt(n)} ${esc(it.unit || "")} من ${esc(it.name)} — المتبقي ${ui.fmt(it.qty)}`);
  }

  function setQty(id, qty, note) {
    const it = items().find((x) => x.id === id);
    if (!it) return;
    const before = num(it.qty);
    it.qty = Math.max(0, num(qty));
    it.updatedAt = now();
    logMove(it, "adjust", it.qty - before, note || "تعديل الكمية");
    store.save();
    render();
  }

  function setState(id, next) {
    const it = items().find((x) => x.id === id);
    if (!it) return;
    it.state = next;
    it.updatedAt = now();
    logMove(it, "fault", 0, `الحالة: ${STATE[next] || next}`);
    store.save();
    render();
  }

  function removeItem(id) {
    const it = items().find((x) => x.id === id);
    if (!it || !confirm(`حذف «${it.name}» من الجرد؟ سجل حركته يبقى محفوظاً.`)) return;
    store.get().invItems = items().filter((x) => x.id !== id);
    store.save();
    render();
  }

  function addItem(data) {
    const it = {
      id: store.uid(),
      track: data.track, name: data.name, kind: data.kind,
      unit: data.unit || "", qty: num(data.qty), min: num(data.min),
      state: data.kind === "fixed" ? "ok" : "", note: "", updatedAt: now(),
    };
    items().push(it);
    logMove(it, "adjust", it.qty, "إضافة صنف");
    store.save();
    render();
    ui.toast(`أُضيف «${esc(it.name)}» إلى جرد ${esc(it.track)}`);
  }

  /* ===== العرض ===== */
  function kpis() {
    const list = ofTrack(items());
    const con = list.filter((x) => x.kind === "consumable");
    const low = con.filter(isLow).length;
    const bad = list.filter(isBad).length;
    const today = dayOf(now());
    const used = ofTrack(moves()).filter((m) => m.type === "use" && dayOf(m.at) === today).length;
    const pod = (label, value, sub, tone, mark) => `<div class="stat">
        <div class="stat-row">
          <div><div class="label">${label}</div><div class="value">${ui.fmt(value)}</div></div>
          <span class="stat-mark ${tone} material-symbols-outlined">${mark}</span>
        </div>
        <div class="stat-foot"><span>${sub}</span></div>
      </div>`;
    $("inv-kpis").innerHTML = [
      pod("أصناف المستهلك", con.length, filter.track ? "في هذا المسار" : "في كل المسارات", "", "inventory_2"),
      pod("تحت الحدّ الأدنى", low, low ? "يلزم توريد" : "لا يوجد ناقص", low ? "is-warn" : "is-ok", low ? "priority_high" : "task_alt"),
      pod("أجهزة معطلة أو مفقودة", bad, bad ? "بلاغات مفتوحة" : "كل الأجهزة سليمة", bad ? "is-warn" : "is-ok", bad ? "build" : "task_alt"),
      pod("تسجيلات اليوم", used, used ? "عملية استهلاك" : "لم يُسجَّل شيء بعد", "", "today"),
    ].join("");
  }

  function consumables() {
    const list = visible().filter((x) => x.kind === "consumable");
    $("inv-con-head").innerHTML = `<tr><th>الصنف</th>${filter.track ? "" : "<th>المسار</th>"}<th>المتبقي</th><th>الحدّ الأدنى</th><th>استُخدم اليوم</th><th></th></tr>`;
    $("inv-con").innerHTML = list.length ? list.map((it) => `<tr data-id="${it.id}" class="${isLow(it) ? "inv-low" : ""}">
        <td><b>${esc(it.name)}</b>${it.unit ? `<small class="inv-unit">${esc(it.unit)}</small>` : ""}</td>
        ${filter.track ? "" : `<td class="inv-dim">${esc(it.track)}</td>`}
        <td><span class="inv-qty ${isLow(it) ? "is-low" : ""}">${ui.fmt(it.qty)}</span></td>
        <td class="inv-dim">${it.min ? ui.fmt(it.min) : "—"}</td>
        <td><input type="number" min="0" step="1" class="inv-use" data-use placeholder="0" aria-label="الكمية المستخدمة من ${esc(it.name)}"></td>
        <td class="reg-actions nowrap">
          <button class="btn small" data-log title="تسجيل الاستهلاك">سجّل</button>
          <button class="act-btn edit" data-edit title="تعديل الكمية (توريد أو تصحيح)"><span class="material-symbols-outlined btn-ico">edit</span></button>
          ${canDelete() ? `<button class="act-btn del" data-del title="حذف الصنف"><span class="material-symbols-outlined btn-ico">delete</span></button>` : ""}
        </td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="empty">لا توجد أصناف مستهلكة مطابقة.</td></tr>`;
  }

  function fixed() {
    const list = visible().filter((x) => x.kind === "fixed");
    $("inv-fix-head").innerHTML = `<tr><th>الجهاز أو الأداة</th>${filter.track ? "" : "<th>المسار</th>"}<th>العدد</th><th>الحالة</th><th></th></tr>`;
    $("inv-fix").innerHTML = list.length ? list.map((it) => {
      const st = it.state || "ok";
      return `<tr data-id="${it.id}">
        <td><b>${esc(it.name)}</b></td>
        ${filter.track ? "" : `<td class="inv-dim">${esc(it.track)}</td>`}
        <td>${ui.fmt(it.qty)}</td>
        <td><span class="badge ${st === "ok" ? "good" : "low"}">${STATE[st]}</span></td>
        <td class="reg-actions nowrap">
          <select class="inv-state" data-state aria-label="حالة ${esc(it.name)}">
            ${Object.keys(STATE).map((k) => `<option value="${k}" ${k === st ? "selected" : ""}>${STATE[k]}</option>`).join("")}
          </select>
          <button class="act-btn edit" data-edit title="تعديل العدد"><span class="material-symbols-outlined btn-ico">edit</span></button>
          ${canDelete() ? `<button class="act-btn del" data-del title="حذف الصنف"><span class="material-symbols-outlined btn-ico">delete</span></button>` : ""}
        </td>
      </tr>`;
    }).join("")
      : `<tr><td colspan="5" class="empty">لا توجد أجهزة أو أدوات مطابقة.</td></tr>`;
  }

  /* تقرير الفترة: الاستهلاك المجمّع لكل صنف خلال المدة */
  function reportRows() {
    const from = periodStart();
    const list = ofTrack(moves()).filter((m) => m.type === "use" && m.at >= from);
    const byItem = {};
    list.forEach((m) => {
      const k = m.itemId;
      byItem[k] = byItem[k] || { name: m.name, track: m.track, qty: 0, times: 0, last: "", by: "" };
      byItem[k].qty += num(m.qty);
      byItem[k].times += 1;
      if (!byItem[k].last || m.at > byItem[k].last) { byItem[k].last = m.at; byItem[k].by = m.by; }
    });
    return Object.keys(byItem).map((id) => {
      const it = items().find((x) => x.id === id);
      return Object.assign({ id, left: it ? num(it.qty) : null, unit: it ? it.unit : "" }, byItem[id]);
    }).sort((a, b) => b.qty - a.qty);
  }

  function report() {
    const rows = reportRows();
    const label = period === "month" ? "آخر ٣٠ يوماً" : "آخر ٧ أيام";
    $("inv-rep-head").innerHTML = `<tr><th>الصنف</th>${filter.track ? "" : "<th>المسار</th>"}<th>المستهلك (${label})</th><th>عدد التسجيلات</th><th>المتبقي</th><th>آخر تسجيل</th><th>آخر من سجّل</th></tr>`;
    $("inv-rep").innerHTML = rows.length ? rows.map((r) => `<tr>
        <td><b>${esc(r.name)}</b>${r.unit ? `<small class="inv-unit">${esc(r.unit)}</small>` : ""}</td>
        ${filter.track ? "" : `<td class="inv-dim">${esc(r.track)}</td>`}
        <td><b>${ui.fmt(r.qty)}</b></td>
        <td class="inv-dim">${ui.fmt(r.times)}</td>
        <td>${r.left == null ? "—" : ui.fmt(r.left)}</td>
        <td class="inv-dim">${ui.formatDate(dayOf(r.last))}</td>
        <td class="inv-dim">${esc(r.by || "—")}</td>
      </tr>`).join("")
      : `<tr><td colspan="7" class="empty">لا استهلاك مسجَّل في ${label}.</td></tr>`;
  }

  function log() {
    const ICON = { use: "south_east", adjust: "tune", fault: "build" };
    const WORD = { use: "استهلاك", adjust: "تعديل كمية", fault: "بلاغ حالة" };
    const list = ofTrack(moves()).slice(0, 50);
    $("inv-log").innerHTML = list.length ? list.map((m) => `<li class="inv-move inv-${m.type}">
        <span class="material-symbols-outlined inv-move-ico">${ICON[m.type] || "circle"}</span>
        <span class="inv-move-copy">
          <b>${esc(m.name || "")}</b>
          <small>${WORD[m.type] || ""}${m.qty ? ` · ${ui.fmt(Math.abs(m.qty))}` : ""}${m.note ? ` · ${esc(m.note)}` : ""}</small>
        </span>
        <span class="inv-move-meta">${esc(m.by || "—")} · ${ui.formatDate(dayOf(m.at))}</span>
      </li>`).join("")
      : `<li class="empty">لا حركة بعد.</li>`;
  }

  function fillTracks() {
    const names = trackNames();
    const sel = $("inv-track");
    sel.innerHTML = `<option value="">كل المسارات</option>${names.map((n) => `<option ${n === filter.track ? "selected" : ""}>${esc(n)}</option>`).join("")}`;
    const add = $("inv-f-track");
    if (add) add.innerHTML = names.map((n) => `<option ${n === filter.track ? "selected" : ""}>${esc(n)}</option>`).join("");
  }

  function render() {
    fillTracks();
    $("inv-q").value = filter.q;
    $("inv-kind").value = filter.kind;
    $("inv-only").value = filter.only;
    document.querySelectorAll("[data-inv-period]").forEach((b) => b.classList.toggle("active", b.dataset.invPeriod === period));
    const total = ofTrack(items()).length;
    $("inv-sub").textContent = `${ui.fmt(total)} صنفاً${filter.track ? ` في ${filter.track}` : " في كل المسارات"} · ${ui.fmt(ofTrack(moves()).length)} حركة مسجّلة`;
    kpis();
    consumables();
    fixed();
    report();
    log();
  }

  async function exportExcel() {
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet("الجرد");
    s1.views = [{ rightToLeft: true }];
    s1.addRow(["المسار", "الصنف", "النوع", "الوحدة", "المتبقي", "الحدّ الأدنى", "الحالة"]);
    ofTrack(items()).forEach((it) => s1.addRow([it.track, it.name, KIND[it.kind] || "", it.unit || "", num(it.qty), num(it.min), STATE[it.state] || ""]));
    const s2 = wb.addWorksheet(period === "month" ? "استهلاك الشهر" : "استهلاك الأسبوع");
    s2.views = [{ rightToLeft: true }];
    s2.addRow(["المسار", "الصنف", "المستهلك", "عدد التسجيلات", "المتبقي", "آخر تسجيل", "آخر من سجّل"]);
    reportRows().forEach((r) => s2.addRow([r.track, r.name, r.qty, r.times, r.left == null ? "" : r.left, dayOf(r.last), r.by || ""]));
    const s3 = wb.addWorksheet("سجل الحركة");
    s3.views = [{ rightToLeft: true }];
    s3.addRow(["التاريخ", "المسار", "الصنف", "العملية", "الكمية", "المسجِّل", "ملاحظة"]);
    ofTrack(moves()).forEach((m) => s3.addRow([dayOf(m.at), m.track, m.name, m.type === "use" ? "استهلاك" : m.type === "adjust" ? "تعديل" : "بلاغ", num(m.qty), m.by || "", m.note || ""]));
    [s1, s2, s3].forEach((s) => s.columns.forEach((c) => { c.width = 18; }));
    const name = `جرد ${filter.track || "المركز"} - ${ui.todayISO()}.xlsx`;
    ui.download(name, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }


  /* ===== استيراد ملف جرد (Excel أو CSV) =====
     الملف يأتي بأعمدة مختلفة من مركز لآخر، فتُطابَق بالمرادفات ثم يصحّحها
     المستخدم من قوائم المطابقة. الرفع المتكرر يُحدِّث ولا يُكرِّر. */
  const FIELDS = [
    { key: "track", label: "المسار", re: /مسار|قسم|قاعه|قاعة|ورشه|ورشة|برنامج|معمل/ },
    { key: "name", label: "اسم الصنف", re: /صنف|اسم|بند|ماده|مادة|اداه|أداة|جهاز|مستهلك|وصف/ },
    { key: "kind", label: "النوع (ثابت/مستهلك)", re: /نوع|تصنيف|فئه|فئة/ },
    { key: "unit", label: "الوحدة", re: /وحده|وحدة|قياس/ },
    { key: "qty", label: "الكمية الحالية", re: /كميه|كمية|عدد|رصيد|متوفر|متبقي|موجود/ },
    { key: "min", label: "الحدّ الأدنى", re: /^حد|ادنى|اعادهالطلب|نقطهالطلب/ },
    { key: "state", label: "الحالة", re: /حاله|حالة|وضع/ },
  ];
  const FIXED_WORDS = /ثابت|جهاز|اداه|أداة|عهده|عهدة|اصل|أصل|معدات|اثاث|أثاث/;
  const CONSUME_WORDS = /مستهلك|استهلاك|خامه|خامة|مواد/;
  const normHead = (v) => String(v || "").trim().toLowerCase()
    .replace(/[\u064B-\u0652]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/^ال/, "").replace(/[\s_\d().:\-\/]/g, "");
  const normName = (v) => String(v || "").trim().replace(/\s+/g, " ")
    .replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();

  let imp = null;   // { headers, rows, map, fileName }

  function guessMap(headers) {
    const map = {};
    const taken = [];
    // عمود واحد لا يُربط بحقلين: أول حقل يأخذه يحجزه
    FIELDS.forEach((f) => {
      const hit = headers.find((h) => !taken.includes(h) && f.re.test(normHead(h)));
      map[f.key] = hit || "";
      if (hit) taken.push(hit);
    });
    return map;
  }

  const kindOf = (v) => {
    const t = normHead(v);
    if (!t) return "";
    if (CONSUME_WORDS.test(t)) return "consumable";
    if (FIXED_WORDS.test(t)) return "fixed";
    return "";
  };
  const stateOf = (v) => {
    const t = normHead(v);
    if (!t) return "";
    if (/مفقود|ضائع|ناقص/.test(t)) return "lost";
    if (/معطل|تالف|خارج|لايعمل|صيانه/.test(t)) return "broken";
    if (/سليم|جيد|صالح|يعمل|جاهز/.test(t)) return "ok";
    return "";
  };

  /* صفوف الملف بعد تطبيق المطابقة الحالية */
  function mapped() {
    if (!imp) return [];
    const g = (r, key) => (imp.map[key] ? String(r[imp.map[key]] == null ? "" : r[imp.map[key]]).trim() : "");
    const fallbackTrack = $("inv-imp-track") ? $("inv-imp-track").value : "";
    return imp.rows.map((r) => {
      const name = g(r, "name");
      const kind = kindOf(g(r, "kind")) || (num(g(r, "min")) > 0 ? "consumable" : "consumable");
      return {
        track: g(r, "track") || fallbackTrack,
        name, kind,
        unit: g(r, "unit"),
        qty: num(g(r, "qty")),
        min: num(g(r, "min")),
        state: kind === "fixed" ? (stateOf(g(r, "state")) || "ok") : "",
      };
    }).filter((x) => x.name && x.track);
  }

  const itemKey = (track, name) => `${normName(track)}|${normName(name)}`;

  function importPreview() {
    const rows = mapped();
    const current = new Map(items().map((it) => [itemKey(it.track, it.name), it]));
    const add = rows.filter((r) => !current.has(itemKey(r.track, r.name)));
    const upd = rows.filter((r) => current.has(itemKey(r.track, r.name)));
    const skipped = imp ? imp.rows.length - rows.length : 0;
    $("inv-imp-sum").innerHTML = `
      <span class="badge good">${ui.fmt(add.length)} صنفاً جديداً</span>
      <span class="badge digital">${ui.fmt(upd.length)} سيُحدَّث</span>
      ${skipped ? `<span class="badge low">${ui.fmt(skipped)} صفاً بلا اسم أو مسار (يُتجاوَز)</span>` : ""}`;
    $("inv-imp-rows").innerHTML = rows.slice(0, 6).map((r) => `<tr>
        <td>${esc(r.track)}</td><td><b>${esc(r.name)}</b></td><td>${KIND[r.kind]}</td>
        <td>${esc(r.unit || "—")}</td><td>${ui.fmt(r.qty)}</td><td>${r.min ? ui.fmt(r.min) : "—"}</td>
        <td>${r.kind === "fixed" ? STATE[r.state] || "" : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty">لا صفوف صالحة بعد — راجع مطابقة الأعمدة.</td></tr>`;
    $("inv-imp-go").disabled = !rows.length;
  }

  function renderMapping() {
    const opts = (sel) => `<option value="">— لا يوجد —</option>` +
      imp.headers.map((h) => `<option ${h === sel ? "selected" : ""}>${esc(h)}</option>`).join("");
    $("inv-imp-map").innerHTML = FIELDS.map((f) => `<label class="field">
        <span>${f.label}</span>
        <select data-imp-field="${f.key}">${opts(imp.map[f.key])}</select>
      </label>`).join("") + `<label class="field">
        <span>المسار الافتراضي (لو لم يكن في الملف)</span>
        <select id="inv-imp-track">${trackNames().map((n) => `<option ${n === filter.track ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      </label>`;
    $("inv-imp-name").textContent = imp.fileName;
    importPreview();
  }

  async function readInventoryFile(file) {
    const data = await App.converterCore.readDataFile(await file.arrayBuffer());
    imp = { headers: data.headers, rows: data.rows, map: guessMap(data.headers), fileName: file.name };
    $("inv-import-card").hidden = false;
    $("inv-form").hidden = true;
    renderMapping();
  }

  function runImport() {
    const rows = mapped();
    if (!rows.length) return;
    const current = new Map(items().map((it) => [itemKey(it.track, it.name), it]));
    let added = 0, updated = 0;
    rows.forEach((r) => {
      const old = current.get(itemKey(r.track, r.name));
      if (old) {
        const before = num(old.qty);
        old.kind = r.kind;
        if (r.unit) old.unit = r.unit;
        old.qty = r.qty;
        if (r.min) old.min = r.min;
        if (r.kind === "fixed" && r.state) old.state = r.state;
        old.updatedAt = now();
        logMove(old, "adjust", old.qty - before, `استيراد: ${imp.fileName}`);
        updated += 1;
      } else {
        const it = {
          id: store.uid(), track: r.track, name: r.name, kind: r.kind,
          unit: r.unit, qty: r.qty, min: r.min,
          state: r.kind === "fixed" ? r.state || "ok" : "", note: "", updatedAt: now(),
        };
        items().push(it);
        current.set(itemKey(it.track, it.name), it);
        logMove(it, "adjust", it.qty, `استيراد: ${imp.fileName}`);
        added += 1;
      }
    });
    store.save();
    $("inv-import-card").hidden = true;
    imp = null;
    render();
    ui.toast(`تم الاستيراد: ${ui.fmt(added)} صنفاً جديداً و${ui.fmt(updated)} محدَّثاً`);
  }

  function initImport() {
    $("inv-import").addEventListener("click", () => $("inv-import-input").click());
    $("inv-import-input").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      readInventoryFile(file).catch((err) => ui.toast(err.message || "تعذّرت قراءة الملف"));
    });
    $("inv-imp-cancel").addEventListener("click", () => { $("inv-import-card").hidden = true; imp = null; });
    $("inv-imp-go").addEventListener("click", runImport);
    $("inv-imp-map").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-imp-field]");
      if (sel && imp) { imp.map[sel.dataset.impField] = sel.value; importPreview(); return; }
      if (e.target.id === "inv-imp-track") importPreview();
    });
  }

  function init() {
    try { filter.track = localStorage.getItem(TRACK_KEY) || ""; } catch (e) { /* تخزين غير متاح */ }

    $("inv-track").addEventListener("change", (e) => {
      filter.track = e.target.value;
      try { localStorage.setItem(TRACK_KEY, filter.track); } catch (e2) { /* تخزين غير متاح */ }
      render();
    });
    $("inv-q").addEventListener("input", (e) => { filter.q = e.target.value; consumables(); fixed(); });
    $("inv-kind").addEventListener("change", (e) => { filter.kind = e.target.value; consumables(); fixed(); });
    $("inv-only").addEventListener("change", (e) => { filter.only = e.target.value; consumables(); fixed(); });

    document.querySelectorAll("[data-inv-period]").forEach((b) => b.addEventListener("click", () => {
      period = b.dataset.invPeriod;
      document.querySelectorAll("[data-inv-period]").forEach((x) => x.classList.toggle("active", x === b));
      report();
    }));

    $("inv-add").addEventListener("click", () => {
      const box = $("inv-form");
      box.hidden = !box.hidden;
      if (!box.hidden) { fillTracks(); $("inv-f-name").focus(); }
    });
    $("inv-f-cancel").addEventListener("click", () => { $("inv-form").hidden = true; });
    $("inv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("inv-f-name").value.trim();
      const track = $("inv-f-track").value;
      if (!name || !track) { ui.toast("اكتب اسم الصنف واختر المسار"); return; }
      addItem({ name, track, kind: $("inv-f-kind").value, unit: $("inv-f-unit").value.trim(), qty: $("inv-f-qty").value, min: $("inv-f-min").value });
      $("inv-form").reset();
      $("inv-form").hidden = true;
    });

    $("inv-export").addEventListener("click", () => exportExcel().catch((e) => ui.toast(e.message)));

    // مستمع واحد للجدولين: التسجيل والتعديل والحذف وتغيير الحالة
    document.getElementById("view-inventory").addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-id]");
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest("[data-log]")) {
        const input = row.querySelector("[data-use]");
        const n = num(input && input.value);
        if (n <= 0) { ui.toast("اكتب الكمية المستخدمة أولاً"); return; }
        use(id, n);
      } else if (e.target.closest("[data-edit]")) {
        const it = items().find((x) => x.id === id);
        const next = prompt(`الكمية الحالية من «${it.name}»: ${it.qty}\nاكتب الكمية الجديدة (بعد التوريد أو التصحيح):`, it.qty);
        if (next !== null && String(next).trim() !== "") setQty(id, next, "تعديل يدوي");
      } else if (e.target.closest("[data-del]")) {
        removeItem(id);
      }
    });
    document.getElementById("view-inventory").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-state]");
      if (!sel) return;
      const row = sel.closest("tr[data-id]");
      if (row) setState(row.dataset.id, sel.value);
    });
    initImport();

    // Enter داخل خانة الاستهلاك يسجّل مباشرة
    document.getElementById("view-inventory").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.closest("[data-use]")) return;
      e.preventDefault();
      const row = e.target.closest("tr[data-id]");
      const n = num(e.target.value);
      if (row && n > 0) use(row.dataset.id, n);
    });
  }

  /* للوحة الرئيسية: الأصناف التي بلغت حدّها الأدنى والأجهزة المعطلة */
  function alerts() {
    const low = items().filter(isLow);
    const bad = items().filter(isBad);
    return { low, bad };
  }

  App.inventory = { init, render, alerts };
})(window.App = window.App || {});
