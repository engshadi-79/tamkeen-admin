/* كشف توزيع الضيافة اليومية — صفحة مستقلة على نمط ملف «كشف_توزيع_الضيافة_2026».
   لكل شهر: أيام الدوام (الأحد إلى الخميس) أعمدةً، والمسارات ثم الموظفون صفوفاً.
   خانة المسار = عدد المتدربين، وخانة الموظف = (1) إن استلم الضيافة ذلك اليوم.
   كل صف في شهر سجلٌّ مزامَن مستقل (hospitality)، فتعديل مستخدمَين لصفّين مختلفين لا يتعارض.
   قائمة الصفوف إعداد مشترك (hospitalityRows)؛ الافتراضية من الملف ولا تُحفظ إلا عند التعديل. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const WORKDAYS = [0, 1, 2, 3, 4]; // الأحد إلى الخميس
  const CENTER = "مركز التدريب";
  const NOTE = "ملاحظة: يُدخل عدد المتدربين يدوياً في خلية تقاطع كل مسار مع تاريخ اليوم. وتوضع (1) في خلية تقاطع اسم الموظف مع تاريخ اليوم عند استلامه الضيافة، وتترك الخانة فارغة في حال عدم الاستلام. صفوف وأعمدة الإجمالي محسوبة تلقائياً بمعادلات ولا يجب تعديلها يدوياً.";

  // مفاتيح الصفوف الافتراضية ثابتة (لا عشوائية) حتى تتطابق خانات الأجهزة كلها قبل أي تعديل
  const DEFAULT_ROWS = {
    tracks: ["الحلاقة الرجالية", "التجميل النسائي", "التطريز والخياطة", "صناعة الإكسسوارات", "المساعد الافتراضي"]
      .map((name, i) => ({ key: `t${i + 1}`, name })),
    staff: ["م.شادي القططي", "د.يوسف جربوع", "أميرة ابو ريدة", "رشا بركة", "طلعت بركة", "عائد الوزير", "وردة ابو عيادة", "ايه زعرب", "علاء ابو صلاح", "ابو العبد فروانة", "رجال الامن", "ضيوف + أطفال"]
      .map((name, i) => (name === "ضيوف + أطفال" ? { key: `s${i + 1}`, name, variable: true } : { key: `s${i + 1}`, name, value: name === "رجال الامن" ? 2 : 1 })),
  };
  // قيمة الاستلام للموظف: 1 افتراضياً، ولبعض الصفوف أكثر (رجال الأمن = 2)
  // صف متغيّر (ضيوف + أطفال): يُكتب العدد يدوياً كل يوم بدل الضغط
  const isVariable = (r) => !!(r && (r.variable || (r.variable === undefined && r.value === undefined && /ضيوف/.test(r.name))));
  const staffValue = (r) => Math.max(1, Math.floor(Number(r && r.value) || (r && /رجال\s*ال[اأ]من/.test(r.name) ? 2 : 1)));

  const rowsDef = () => {
    const r = store.get().hospitalityRows;
    return r && Array.isArray(r.tracks) && Array.isArray(r.staff) ? r : DEFAULT_ROWS;
  };
  const records = () => (store.get().hospitality = store.get().hospitality || []);

  const today = new Date();
  let current = { year: today.getFullYear(), month: today.getMonth() }; // month: 0..11
  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const ym = () => monthKey(current.year, current.month);

  /* أيام الدوام في الشهر: [{ key: "2026-01-04", label: "الأحد\n04/01" }] */
  function workdays(year, month) {
    const days = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      if (WORKDAYS.includes(d.getDay())) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(month + 1).padStart(2, "0");
        days.push({ key: `${year}-${mm}-${dd}`, day: WEEKDAYS[d.getDay()], date: `${dd}/${mm}` });
      }
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  /* ===== المخزون: المستلَم كراتين، والمصروف من الكشف، والمتبقي =====
     المستلَم يُحفظ في صفّ خاص (__in) بعدد الكراتين لكل يوم، ورصيد أول الشهر في (__open).
     عدد القطع في الكرتونة إعداد مشترك، والافتراضي 24. */
  const IN_KEY = "__in";
  const OPEN_KEY = "__open";
  const DEFAULT_PER_CARTON = 24;
  const perCarton = () => {
    const n = Number((store.get().hospitalitySettings || {}).perCarton);
    return n > 0 ? n : DEFAULT_PER_CARTON;
  };

  const recId = (month, rowKey) => `${month}|${rowKey}`;
  const findRec = (month, rowKey) => records().find((r) => r.id === recId(month, rowKey));
  const cellValue = (month, rowKey, dayKey) => {
    const r = findRec(month, rowKey);
    const v = r && r.days ? r.days[dayKey] : undefined;
    return typeof v === "number" && v > 0 ? v : 0;
  };

  function setCell(month, rowKey, dayKey, value) {
    let r = findRec(month, rowKey);
    if (!r) {
      if (!value) return;
      r = { id: recId(month, rowKey), month, row: rowKey, days: {}, createdAt: new Date().toISOString() };
      records().push(r);
    }
    r.days = Object.assign({}, r.days);
    if (value) r.days[dayKey] = value; else delete r.days[dayKey];
    r.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  let saveTimer = null;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(), 400); };

  /* ===== المجاميع ===== */
  function totals(month, days) {
    const def = rowsDef();
    const rowTotal = (key) => days.reduce((a, d) => a + cellValue(month, key, d.key), 0);
    const colTotal = (list, dayKey) => list.reduce((a, r) => a + cellValue(month, r.key, dayKey), 0);
    const trainees = days.map((d) => colTotal(def.tracks, d.key));
    const staff = days.map((d) => colTotal(def.staff, d.key));
    return {
      rowTotal,
      trainees,
      staff,
      all: days.map((_, i) => trainees[i] + staff[i]),
      sum: (arr) => arr.reduce((a, b) => a + b, 0),
    };
  }

  /* المصروف في يوم = مجموع المتدربين والموظفين */
  function spentOn(month, dayKey) {
    const def = rowsDef();
    return [].concat(def.tracks, def.staff).reduce((a, r) => a + cellValue(month, r.key, dayKey), 0);
  }
  const cartonsOn = (month, dayKey) => cellValue(month, IN_KEY, dayKey);

  /* 62 قطعة ← «2 كرتونة و14 قطعة» */
  function asBoxes(pieces) {
    const per = perCarton();
    const neg = pieces < 0;
    const n = Math.abs(pieces);
    const boxes = Math.floor(n / per);
    const rest = n % per;
    const txt = boxes && rest ? `${ui.fmt(boxes)} كرتونة و${ui.fmt(rest)} قطعة`
      : boxes ? `${ui.fmt(boxes)} كرتونة`
      : `${ui.fmt(rest)} قطعة`;
    return (neg ? "ناقص " : "") + txt;
  }

  /* رصيد أول الشهر: المكتوب يدوياً، وإلا متبقي الشهر السابق إن كانت فيه بيانات */
  function openingOf(year, month, depth) {
    const key = monthKey(year, month);
    const rec = findRec(key, OPEN_KEY);
    const manual = rec && rec.days ? rec.days.v : undefined;
    if (typeof manual === "number") return manual;
    if ((depth || 0) > 12) return 0;
    const pm = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
    const used = records().some((r) => r.month === monthKey(pm.y, pm.m) && Object.keys(r.days || {}).length);
    return used ? stockOf(pm.y, pm.m, (depth || 0) + 1).closing : 0;
  }

  /* حركة المخزون يوماً بيوم */
  function stockOf(year, month, depth) {
    const key = monthKey(year, month);
    const days = workdays(year, month);
    const per = perCarton();
    const opening = openingOf(year, month, depth);
    let balance = opening;
    const list = days.map((d) => {
      const cartons = cartonsOn(key, d.key);
      const inPieces = Math.round(cartons * per);
      const spent = spentOn(key, d.key);
      balance += inPieces - spent;
      return { day: d, cartons, inPieces, spent, balance };
    });
    return {
      opening, per, days: list,
      inCartons: list.reduce((a, x) => a + x.cartons, 0),
      inPieces: list.reduce((a, x) => a + x.inPieces, 0),
      spent: list.reduce((a, x) => a + x.spent, 0),
      closing: balance,
    };
  }

  /* صفوف المخزون تحت الكشف: المستلَم بالكراتين، وما يعادله قطعاً، والمتبقي بعد الصرف */
  function stockRows(month, days) {
    const st = stockOf(current.year, current.month);
    const cell = (d) => `<td><input type="number" min="0" step="0.5" inputmode="decimal" data-row="${IN_KEY}" data-day="${d.key}" value="${cartonsOn(month, d.key) || ""}" placeholder="—" aria-label="كراتين ${d.date}"></td>`;
    return `<tr class="hos-in"><th class="hos-name">المستلَم (كرتونة × ${ui.fmt(st.per)})</th>${days.map(cell).join("")}<td class="hos-total" data-stock="in">${st.inCartons ? ui.fmt(st.inCartons, 1) : ""}</td></tr>
      <tr class="hos-in"><th class="hos-name">المستلَم (قطعة)</th>${st.days.map((x, i) => `<td data-stock="p${i}">${x.inPieces || ""}</td>`).join("")}<td class="hos-total" data-stock="pieces">${st.inPieces ? ui.fmt(st.inPieces) : ""}</td></tr>
      <tr class="hos-bal"><th class="hos-name">المتبقي (قطعة)${st.opening ? ` <small>(أول الشهر ${ui.fmt(st.opening)})</small>` : ""}</th>${st.days.map((x, i) => `<td data-stock="b${i}" class="${x.balance < 0 ? "hos-neg" : ""}" title="${esc(asBoxes(x.balance))}">${ui.fmt(x.balance)}</td>`).join("")}<td class="hos-total ${st.closing < 0 ? "hos-neg" : ""}" data-stock="closing">${ui.fmt(st.closing)}</td></tr>`;
  }

  /* أرقام المخزون بعد كل إدخال، دون إعادة بناء الجدول */
  function refreshStock() {
    if (!$("hos-table")) return;
    const st = stockOf(current.year, current.month);
    const set = (k, v, neg) => {
      const el = $("hos-table").querySelector(`[data-stock="${k}"]`);
      if (!el) return;
      el.textContent = v === "" ? "" : ui.fmt(v, 1);
      if (neg !== undefined) el.classList.toggle("hos-neg", neg);
    };
    set("in", st.inCartons || "");
    set("pieces", st.inPieces || "");
    set("closing", st.closing, st.closing < 0);
    st.days.forEach((x, i) => {
      set("p" + i, x.inPieces || "");
      set("b" + i, x.balance, x.balance < 0);
      const cell = $("hos-table").querySelector('[data-stock="b' + i + '"]');
      if (cell) cell.title = asBoxes(x.balance); // «2 كرتونة و14 قطعة» عند مرور المؤشر
    });
    const box = $("hos-stock");
    if (box) {
      box.innerHTML = st.inCartons || st.spent || st.opening
        ? `📦 استُلم <b>${ui.fmt(st.inCartons, 1)}</b> كرتونة (${ui.fmt(st.inPieces)} قطعة) · صُرف <b>${ui.fmt(st.spent)}</b> · المتبقي <b class="${st.closing < 0 ? "hos-neg" : ""}">${ui.fmt(st.closing)} قطعة</b> = ${esc(asBoxes(st.closing))}${st.opening ? ` · رصيد أول الشهر ${ui.fmt(st.opening)}` : ""}`
        : "📦 اكتب الكراتين المستلمة في صف «المستلَم» أسفل الكشف، فيُحسب المتبقي يوماً بيوم.";
    }
  }

  /* ===== العرض ===== */
  function render() {
    const view = $("view-hospitality");
    if (!view) return;
    const month = ym();
    const days = workdays(current.year, current.month);
    const def = rowsDef();
    const t = totals(month, days);

    $("hos-month").value = String(current.month);
    $("hos-year").value = String(current.year);
    $("hos-title").textContent = `كشف توزيع الضيافة اليومية - ${MONTHS[current.month]} ${current.year} - ${CENTER}`;

    const head = `<tr><th class="hos-name">المسار / الموظف</th>${days.map((d) => `<th>${esc(d.day)}<br><small>${esc(d.date)}</small></th>`).join("")}<th class="hos-total">الإجمالي الشهري</th></tr>`;
    const trackRow = (r) => `<tr class="hos-track"><th class="hos-name">${esc(r.name)}</th>${days.map((d) => {
        const v = cellValue(month, r.key, d.key);
        return `<td><input type="number" min="0" inputmode="numeric" data-row="${esc(r.key)}" data-day="${d.key}" value="${v || ""}" aria-label="${esc(r.name)} ${d.date}"></td>`;
      }).join("")}<td class="hos-total" data-rowtotal="${esc(r.key)}">${t.rowTotal(r.key) || ""}</td></tr>`;
    const staffRow = (r) => `<tr class="hos-staff"><th class="hos-name">${esc(r.name)}</th>${days.map((d) => {
        const v = cellValue(month, r.key, d.key);
        if (isVariable(r)) return `<td><input type="number" min="0" inputmode="numeric" data-row="${esc(r.key)}" data-day="${d.key}" value="${v || ""}" placeholder="—" aria-label="${esc(r.name)} ${d.date}"></td>`;
        return `<td><button type="button" class="hos-tick ${v ? "on" : ""}" data-toggle="${esc(r.key)}" data-value="${staffValue(r)}" data-day="${d.key}" aria-pressed="${v ? "true" : "false"}" title="${esc(r.name)} — ${d.day} ${d.date} (${staffValue(r)})">${v || ""}</button></td>`;
      }).join("")}<td class="hos-total" data-rowtotal="${esc(r.key)}">${t.rowTotal(r.key) || ""}</td></tr>`;
    const sumRow = (label, arr, id, cls) => `<tr class="${cls}"><th class="hos-name">${label}</th>${arr.map((v, i) => `<td data-${id}="${i}">${v || ""}</td>`).join("")}<td data-${id}="all">${t.sum(arr) || ""}</td></tr>`;

    $("hos-table").innerHTML = `<thead>${head}</thead><tbody>
      ${def.tracks.map(trackRow).join("")}
      ${sumRow("إجمالي المتدربين", t.trainees, "tt", "hos-sum")}
      ${def.staff.map(staffRow).join("")}
      ${sumRow("إجمالي الموظفين", t.staff, "st", "hos-sum")}
      ${sumRow("الإجمالي الكلي (متدربين + موظفين)", t.all, "gt", "hos-grand")}
      ${stockRows(month, days)}
    </tbody>`;
    $("hos-summary").textContent = `${ui.fmt(days.length)} يوم دوام · ${ui.fmt(t.sum(t.trainees))} وجبة للمتدربين · ${ui.fmt(t.sum(t.staff))} للموظفين · المجموع ${ui.fmt(t.sum(t.all))}`;
    const m = mode();
    $("hos-day").hidden = m !== "day";
    $("hos-wrap").hidden = m === "day";
    $("hos-mode-day").classList.toggle("active", m === "day");
    $("hos-mode-month").classList.toggle("active", m !== "day");
    if (m === "day") renderDay();
    $("hos-per").value = String(perCarton());
    const openRec = findRec(month, OPEN_KEY);
    $("hos-open").value = openRec && openRec.days && typeof openRec.days.v === "number" ? String(openRec.days.v) : "";
    $("hos-open").placeholder = `تلقائي (${ui.fmt(stockOf(current.year, current.month).opening)})`;
    refreshStock();
  }

  /* ===== إدخال يوم واحد: بطاقات كبيرة تناسب الجوال ===== */
  const MODE_KEY = "tamkeen-admin:hos-mode";
  let pickedDay = "";
  const mode = () => {
    try { const m = localStorage.getItem(MODE_KEY); if (m) return m; } catch (e) { /* تخزين غير متاح */ }
    return window.innerWidth < 760 ? "day" : "month";
  };
  function setMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* تخزين غير متاح */ }
    render();
  }

  /* اليوم الافتراضي: اليوم إن كان يوم دوام في الشهر المعروض، وإلا أقرب يوم دوام قبله، وإلا أول الشهر */
  function defaultDay(days) {
    const today = ui.todayISO();
    const before = days.filter((d) => d.key <= today);
    return (days.find((d) => d.key === today) || before[before.length - 1] || days[0] || {}).key || "";
  }

  function renderDay() {
    const box = $("hos-day");
    const days = workdays(current.year, current.month);
    const month = ym();
    if (!days.some((d) => d.key === pickedDay)) pickedDay = defaultDay(days);
    const d = days.find((x) => x.key === pickedDay);
    if (!d) { box.innerHTML = `<p class="empty">لا توجد أيام دوام في هذا الشهر.</p>`; return; }
    const def = rowsDef();
    const trackCard = (r) => {
      const v = cellValue(month, r.key, d.key);
      return `<label class="hd-row hd-track"><span>${esc(r.name)}</span>
        <input type="number" min="0" inputmode="numeric" data-row="${esc(r.key)}" data-day="${d.key}" value="${v || ""}" placeholder="0"></label>`;
    };
    const staffCard = (r) => {
      const v = cellValue(month, r.key, d.key);
      if (isVariable(r)) return `<label class="hd-row hd-staff"><span>${esc(r.name)}</span>
        <input type="number" min="0" inputmode="numeric" data-row="${esc(r.key)}" data-day="${d.key}" value="${v || ""}" placeholder="0"></label>`;
      return `<button type="button" class="hd-row hd-staff hd-tick ${v ? "on" : ""}" data-toggle="${esc(r.key)}" data-value="${staffValue(r)}" data-day="${d.key}" aria-pressed="${v ? "true" : "false"}">
        <span>${esc(r.name)}</span><b>${v ? `✓ ${v}` : staffValue(r) > 1 ? `+${staffValue(r)}` : "+"}</b></button>`;
    };
    box.innerHTML = `
      <div class="hd-bar">
        <button type="button" class="btn secondary" data-day-step="-1" aria-label="اليوم السابق">→</button>
        <select id="hos-day-pick" aria-label="اليوم">${days.map((x) => `<option value="${x.key}" ${x.key === d.key ? "selected" : ""}>${x.day} ${x.date}${x.key === ui.todayISO() ? " (اليوم)" : ""}</option>`).join("")}</select>
        <button type="button" class="btn secondary" data-day-step="1" aria-label="اليوم التالي">←</button>
      </div>
      <h4 class="hd-head">المسارات — عدد المتدربين</h4>
      <div class="hd-list">${def.tracks.map(trackCard).join("")}</div>
      <h4 class="hd-head">الموظفون — اضغط عند الاستلام</h4>
      <div class="hd-list">${def.staff.map(staffCard).join("")}</div>
      <div class="hd-row hd-in"><span>المستلَم اليوم (كرتونة × ${ui.fmt(perCarton())})</span>
        <input type="number" min="0" step="0.5" inputmode="decimal" data-row="${IN_KEY}" data-day="${d.key}" value="${cartonsOn(month, d.key) || ""}" placeholder="0"></div>
      <div class="hd-total" id="hos-day-total"></div>`;
    dayTotal();
  }

  function dayTotal() {
    const el = $("hos-day-total");
    if (!el || !pickedDay) return;
    const def = rowsDef();
    const month = ym();
    const sum = (list) => list.reduce((a, r) => a + cellValue(month, r.key, pickedDay), 0);
    const tr = sum(def.tracks);
    const st = sum(def.staff);
    const stock = stockOf(current.year, current.month);
    const today = stock.days.find((x) => x.day.key === pickedDay);
    el.innerHTML = `<span>المتدربون <b>${ui.fmt(tr)}</b></span><span>الموظفون <b>${ui.fmt(st)}</b></span><span>مجموع اليوم <b>${ui.fmt(tr + st)}</b></span>`
      + (today ? `<span>المستلَم اليوم <b>${ui.fmt(today.cartons, 1)}</b> كرتونة = <b>${ui.fmt(today.inPieces)}</b> قطعة</span><span>المتبقي بعد اليوم <b class="${today.balance < 0 ? "hos-neg" : ""}">${ui.fmt(today.balance)} قطعة</b> (${esc(asBoxes(today.balance))})</span>` : "");
  }

  /* تحديث المجاميع وحدها بعد كل إدخال، دون إعادة بناء الجدول (فلا يضيع موضع الكتابة) */
  function refreshTotals() {
    const month = ym();
    const days = workdays(current.year, current.month);
    const def = rowsDef();
    const t = totals(month, days);
    const set = (sel, v) => { const el = $("hos-table").querySelector(sel); if (el) el.textContent = v || ""; };
    def.tracks.concat(def.staff).forEach((r) => set(`[data-rowtotal="${CSS.escape(r.key)}"]`, t.rowTotal(r.key)));
    refreshStock();
    dayTotal();
    [["tt", t.trainees], ["st", t.staff], ["gt", t.all]].forEach(([id, arr]) => {
      arr.forEach((v, i) => set(`[data-${id}="${i}"]`, v));
      set(`[data-${id}="all"]`, t.sum(arr));
    });
    $("hos-summary").textContent = `${ui.fmt(days.length)} يوم دوام · ${ui.fmt(t.sum(t.trainees))} وجبة للمتدربين · ${ui.fmt(t.sum(t.staff))} للموظفين · المجموع ${ui.fmt(t.sum(t.all))}`;
  }

  /* ===== تعديل الصفوف ===== */
  function openRows() {
    const def = rowsDef();
    $("hos-rows-tracks").value = def.tracks.map((r) => r.name).join("\n");
    $("hos-rows-staff").value = def.staff.map((r) => (isVariable(r) ? `${r.name} = ؟` : staffValue(r) > 1 ? `${r.name} = ${staffValue(r)}` : r.name)).join("\n");
    $("hos-rows-modal").classList.add("open");
  }

  function applyRows() {
    const def = rowsDef();
    const norm = (s) => String(s || "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ");
    // الاسم الباقي يحتفظ بمفتاحه (فتبقى أرقامه)، والجديد يأخذ مفتاحاً جديداً
    // «الاسم = 2» تجعل استلام هذا الصف بقيمة 2 بدل 1، و«الاسم = ؟» تجعل العدد يُكتب يدوياً كل يوم
    const build = (text, old, withValue) => text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = withValue && line.match(/^(.*?)\s*=\s*([0-9\u0660-\u0669]+|[?؟]|متغير)\s*$/);
      const name = m ? m[1].trim() : line;
      const variable = !!m && /^([?؟]|متغير)$/.test(m[2]);
      const value = m && !variable ? Number(m[2].replace(/[\u0660-\u0669]/g, (c) => c.charCodeAt(0) - 0x660)) : 1;
      const prev = old.find((r) => norm(r.name) === norm(name));
      const row = { key: prev ? prev.key : store.uid(), name };
      if (withValue && variable) row.variable = true;
      else if (withValue) { row.value = Math.max(1, value || 1); row.variable = false; }
      return row;
    });
    const tracks = build($("hos-rows-tracks").value, def.tracks);
    const staff = build($("hos-rows-staff").value, def.staff, true);
    if (!tracks.length && !staff.length) { ui.toast("اكتب صفاً واحداً على الأقل"); return; }
    store.get().hospitalityRows = { tracks, staff };
    store.save();
    $("hos-rows-modal").classList.remove("open");
    render();
    ui.toast("حُفظت الصفوف، وتظهر لكل المستخدمين");
  }

  /* ===== التصدير بنفس شكل الملف الأصلي ===== */
  const NAVY = "FF1F3864";
  const BLUE = "FF2E75B6";
  const LIGHT = "FFDDEBF7";
  const GREEN = "FF548235";
  const YELLOW = "FFFFE699";
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const center = { horizontal: "center", vertical: "middle", wrapText: true };

  function addMonthSheet(wb, year, month) {
    const mKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const days = workdays(year, month);
    const def = rowsDef();
    const t = totals(mKey, days);
    const ws = wb.addWorksheet(MONTHS[month], {
      views: [{ rightToLeft: true, state: "frozen", xSplit: 1, ySplit: 4 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.3, footer: 0.3 }, printTitlesRow: "4:4" },
    });
    const lastCol = days.length + 2;
    const L = (c) => ws.getColumn(c).letter;
    ws.getColumn(1).width = 24;
    for (let c = 2; c <= days.length + 1; c++) ws.getColumn(c).width = 8.5;
    ws.getColumn(lastCol).width = 14;

    const style = (cell, font, fill) => {
      cell.font = Object.assign({ name: "Arial", size: 11 }, font);
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.alignment = center;
      cell.border = border;
    };

    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = `كشف توزيع الضيافة اليومية - ${MONTHS[month]} ${year} - ${CENTER}`;
    title.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    title.alignment = center;
    ws.getRow(1).height = 27.75;
    ws.mergeCells(2, 1, 3, lastCol);
    const note = ws.getCell(2, 1);
    note.value = NOTE;
    note.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF7F7F7F" } };
    note.alignment = center;

    const head = ws.getRow(4);
    head.height = 31.5;
    head.getCell(1).value = "المسار / الموظف";
    days.forEach((d, i) => { head.getCell(i + 2).value = `${d.day}\n${d.date}`; });
    head.getCell(lastCol).value = "الإجمالي الشهري";
    for (let c = 1; c <= lastCol; c++) style(head.getCell(c), { size: 10, bold: true, color: { argb: "FFFFFFFF" } }, NAVY);

    let r = 5;
    const dataRow = (row, nameFill, nameFont) => {
      const x = ws.getRow(r);
      x.height = 19.5;
      x.getCell(1).value = row.name;
      style(x.getCell(1), Object.assign({ bold: true }, nameFont), nameFill);
      days.forEach((d, i) => {
        const v = cellValue(mKey, row.key, d.key);
        const cell = x.getCell(i + 2);
        cell.value = v || null;
        style(cell, {}, LIGHT);
      });
      const tot = x.getCell(lastCol);
      tot.value = { formula: `SUM(${L(2)}${r}:${L(days.length + 1)}${r})`, result: t.rowTotal(row.key) };
      style(tot, { bold: true }, LIGHT);
      r++;
    };
    const sumRow = (label, from, to, fill, fontExtra, values) => {
      const x = ws.getRow(r);
      x.height = 19.5;
      x.getCell(1).value = label;
      style(x.getCell(1), Object.assign({ bold: true }, fontExtra), fill);
      for (let c = 2; c <= lastCol; c++) {
        const cell = x.getCell(c);
        const L0 = L(c);
        cell.value = { formula: typeof from === "function" ? from(L0) : `SUM(${L0}${from}:${L0}${to})`, result: c === lastCol ? values.reduce((a, b) => a + b, 0) : values[c - 2] };
        style(cell, Object.assign({ bold: true }, fontExtra), fill);
      }
      return r++;
    };

    const tStart = r;
    def.tracks.forEach((row) => dataRow(row, BLUE, { color: { argb: "FFFFFFFF" } }));
    const traineeRow = sumRow("إجمالي المتدربين", tStart, r - 1, YELLOW, {}, t.trainees);
    const sStart = r;
    def.staff.forEach((row) => dataRow(row, GREEN, { color: { argb: "FFFFFFFF" } }));
    const staffRow = sumRow("إجمالي الموظفين", sStart, r - 1, YELLOW, {}, t.staff);
    sumRow("الإجمالي الكلي (متدربين + موظفين)", (L0) => `${L0}${traineeRow}+${L0}${staffRow}`, null, NAVY, { size: 12, color: { argb: "FFFFFFFF" } }, t.all);

    // المخزون: المستلَم بالكراتين وبالقطع، ثم المتبقي المتراكم
    const st = stockOf(year, month);
    const stockRow = (label, values, fill, font) => {
      const x = ws.getRow(r);
      x.height = 19.5;
      x.getCell(1).value = label;
      style(x.getCell(1), Object.assign({ bold: true }, font), fill);
      values.forEach((v, i) => { const c = x.getCell(i + 2); c.value = v || null; style(c, Object.assign({ bold: true }, font), fill); });
      const tot = x.getCell(lastCol);
      tot.value = values.reduce((a, b) => a + (Number(b) || 0), 0) || null;
      style(tot, Object.assign({ bold: true }, font), fill);
      r++;
    };
    stockRow(`المستلَم (كرتونة × ${st.per})`, st.days.map((x) => x.cartons), "FFDDEBF7", {});
    stockRow("المستلَم (قطعة)", st.days.map((x) => x.inPieces), "FFDDEBF7", {});
    // المتبقي تراكمي: إجماليه لا معنى له، فيُكتب الرصيد الأخير
    const bal = ws.getRow(r);
    bal.height = 19.5;
    bal.getCell(1).value = st.opening ? `المتبقي (أول الشهر ${st.opening})` : "المتبقي";
    style(bal.getCell(1), { bold: true }, YELLOW);
    st.days.forEach((x, i) => { const c = bal.getCell(i + 2); c.value = x.balance; style(c, { bold: true }, YELLOW); });
    const last = bal.getCell(lastCol);
    last.value = st.closing;
    style(last, { bold: true }, YELLOW);
    r++;
    return ws;
  }

  async function exportXlsx(allYear) {
    if (!window.ExcelJS) { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    if (allYear) for (let m = 0; m < 12; m++) addMonthSheet(wb, current.year, m);
    else addMonthSheet(wb, current.year, current.month);
    const buf = await wb.xlsx.writeBuffer();
    const name = allYear ? `كشف توزيع الضيافة ${current.year}.xlsx` : `كشف توزيع الضيافة - ${MONTHS[current.month]} ${current.year}.xlsx`;
    ui.download(name, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* طباعة الكشف وحده: صفحة A4 أفقية فيها العنوان والملاحظة والجدول فقط، في إطار مخفي */
  function printSheet() {
    const table = $("hos-table").cloneNode(true);
    table.querySelectorAll("input").forEach((i) => { i.replaceWith(document.createTextNode(i.value || "")); });
    table.querySelectorAll("button").forEach((b) => { b.replaceWith(document.createTextNode(b.textContent || "")); });
    table.removeAttribute("id");
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc($("hos-title").textContent)}</title>
      <style>
        @page { size: A4 landscape; margin: 7mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; font-family: Arial, "Segoe UI", Tahoma, sans-serif; color: #111; }
        h1 { margin: 0; padding: 6px; background: #1F3864; color: #fff; text-align: center; font-size: 14pt; }
        .note { margin: 4px 0 6px; color: #7F7F7F; font-style: italic; font-size: 7.5pt; text-align: center; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5pt; }
        th, td { border: 1px solid #8c8c8c; text-align: center; padding: 2px 1px; height: 19px; overflow: hidden; }
        thead th { background: #1F3864; color: #fff; font-weight: 700; line-height: 1.15; }
        thead th small { font-weight: 400; }
        .hos-name { width: 130px; text-align: right; padding: 0 5px; white-space: nowrap; font-weight: 700; }
        thead th:last-child, td.hos-total, tr > td:last-child { width: 52px; }
        .hos-track .hos-name { background: #2E75B6; color: #fff; }
        .hos-staff .hos-name { background: #548235; color: #fff; }
        .hos-track td, .hos-staff td { background: #DDEBF7; }
        td.hos-total { font-weight: 700; }
        .hos-sum th, .hos-sum td { background: #FFE699; font-weight: 700; }
        .hos-grand th, .hos-grand td { background: #1F3864; color: #fff; font-weight: 700; }
      </style></head><body>
      <h1>${esc($("hos-title").textContent)}</h1>
      <p class="note">${esc(NOTE)}</p>
      ${table.outerHTML}
    </body></html>`;
    const old = document.getElementById("hos-print-frame");
    if (old) old.remove();
    const frame = document.createElement("iframe");
    frame.id = "hos-print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:0;bottom:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 150);
  }

  /* تقرير الشهر: المستلَم والمصروف والمتبقي يوماً بيوم، للطباعة */
  function stockReport() {
    const st = stockOf(current.year, current.month);
    const t = totals(ym(), workdays(current.year, current.month));
    const title = `تقرير استلام وصرف الضيافة - ${MONTHS[current.month]} ${current.year} - ${CENTER}`;
    const rows = st.days.map((x) => `<tr>
        <td>${esc(x.day.day)}</td><td>${esc(x.day.date)}</td>
        <td>${x.cartons ? ui.fmt(x.cartons, 1) : ""}</td><td>${x.inPieces || ""}</td>
        <td>${x.spent || ""}</td><td class="${x.balance < 0 ? "neg" : ""}">${ui.fmt(x.balance)}</td><td class="${x.balance < 0 ? "neg" : ""}">${esc(asBoxes(x.balance))}</td></tr>`).join("");
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>@page{size:A4;margin:12mm}
        body{font-family:Arial,Tahoma,sans-serif;margin:0;color:#111}
        h1{font-size:15pt;text-align:center;background:#1F3864;color:#fff;padding:8px;margin:0 0 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        table{width:100%;border-collapse:collapse;font-size:10pt}
        th,td{border:1px solid #999;padding:4px 6px;text-align:center}
        thead th{background:#1F3864;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        tbody tr:nth-child(even) td{background:#f2f5fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        tfoot td{background:#FFE699;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .neg{color:#c0392b;font-weight:700}
        .sum{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin:10px 0;font-size:10.5pt}
        .sum b{font-size:12pt}
        .sign{margin-top:26px;display:flex;justify-content:space-between;font-size:10.5pt}
      </style></head><body>
      <h1>${esc(title)}</h1>
      <div class="sum">
        <span>رصيد أول الشهر <b>${ui.fmt(st.opening)}</b></span>
        <span>المستلَم <b>${ui.fmt(st.inCartons, 1)}</b> كرتونة = <b>${ui.fmt(st.inPieces)}</b> قطعة</span>
        <span>المصروف <b>${ui.fmt(st.spent)}</b> (متدربون ${ui.fmt(t.sum(t.trainees))} · موظفون ${ui.fmt(t.sum(t.staff))})</span>
        <span>المتبقي آخر الشهر <b class="${st.closing < 0 ? "neg" : ""}">${ui.fmt(st.closing)}</b> قطعة = <b>${esc(asBoxes(st.closing))}</b></span>
        <span>القطع في الكرتونة: ${ui.fmt(st.per)}</span>
      </div>
      <table>
        <thead><tr><th>اليوم</th><th>التاريخ</th><th>المستلَم (كرتونة)</th><th>المستلَم (قطعة)</th><th>المصروف</th><th>المتبقي (قطعة)</th><th>المتبقي (كراتين وقطع)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">الإجمالي</td><td>${ui.fmt(st.inCartons, 1)}</td><td>${ui.fmt(st.inPieces)}</td><td>${ui.fmt(st.spent)}</td><td>${ui.fmt(st.closing)}</td><td>${esc(asBoxes(st.closing))}</td></tr></tfoot>
      </table>
      <div class="sign"><span>أمين المستودع: ..............................</span><span>مدير المركز: ..............................</span></div>
      </body></html>`;
    const old = $("hos-report-frame");
    if (old) old.remove();
    const frame = document.createElement("iframe");
    frame.id = "hos-report-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:0;bottom:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 150);
  }

  function init() {
    $("hos-month").innerHTML = MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    $("hos-month").addEventListener("change", (e) => { current.month = Number(e.target.value); render(); });
    $("hos-year").addEventListener("change", (e) => {
      const y = Number(e.target.value);
      if (y >= 2020 && y <= 2100) { current.year = y; render(); }
    });
    $("hos-prev").addEventListener("click", () => { current.month--; if (current.month < 0) { current.month = 11; current.year--; } render(); });
    $("hos-next").addEventListener("click", () => { current.month++; if (current.month > 11) { current.month = 0; current.year++; } render(); });

    // خانة مسار أو صف متغيّر: عدد
    const onInput = (e) => {
      const el = e.target;
      if (!el.dataset.row) return;
      const raw = Number(el.value) || 0;
      const n = el.dataset.row === IN_KEY ? Math.max(0, Math.round(raw * 2) / 2) : Math.max(0, Math.floor(raw));
      setCell(ym(), el.dataset.row, el.dataset.day, n);
      refreshTotals();
    };
    // خانة موظف: قيمته أو فارغة
    const onClick = (e) => {
      const step = e.target.closest("[data-day-step]");
      if (step) {
        const days = workdays(current.year, current.month);
        const i = days.findIndex((d) => d.key === pickedDay) + Number(step.dataset.dayStep);
        if (i >= 0 && i < days.length) { pickedDay = days[i].key; renderDay(); }
        return;
      }
      const b = e.target.closest("[data-toggle]");
      if (!b) return;
      const on = !b.classList.contains("on");
      b.classList.toggle("on", on);
      const val = Number(b.dataset.value) || 1;
      if (b.classList.contains("hd-tick")) b.querySelector("b").textContent = on ? `✓ ${val}` : val > 1 ? `+${val}` : "+";
      else b.textContent = on ? String(val) : "";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      setCell(ym(), b.dataset.toggle, b.dataset.day, on ? val : 0);
      refreshTotals();
    };
    $("hos-table").addEventListener("input", onInput);
    $("hos-table").addEventListener("click", onClick);
    $("hos-day").addEventListener("input", onInput);
    $("hos-day").addEventListener("click", onClick);
    $("hos-day").addEventListener("change", (e) => { if (e.target.id === "hos-day-pick") { pickedDay = e.target.value; renderDay(); } });
    $("hos-mode-day").addEventListener("click", () => setMode("day"));
    $("hos-mode-month").addEventListener("click", () => setMode("month"));

    $("hos-export").addEventListener("click", () => exportXlsx(false).catch((e) => ui.toast(e.message)));
    $("hos-export-year").addEventListener("click", () => exportXlsx(true).catch((e) => ui.toast(e.message)));
    $("hos-print").addEventListener("click", printSheet);
    $("hos-report").addEventListener("click", stockReport);
    $("hos-per").addEventListener("change", (e) => {
      const n = Math.max(1, Math.floor(Number(e.target.value) || DEFAULT_PER_CARTON));
      store.get().hospitalitySettings = Object.assign({}, store.get().hospitalitySettings, { perCarton: n });
      store.save();
      render();
      ui.toast(`القطع في الكرتونة: ${ui.fmt(n)} — تسري على كل الأشهر`);
    });
    $("hos-open").addEventListener("change", (e) => {
      const raw = e.target.value.trim();
      const rec = findRec(ym(), OPEN_KEY);
      if (!raw) {
        if (rec) { rec.days = {}; rec.updatedAt = new Date().toISOString(); store.save(); }
      } else setCell(ym(), OPEN_KEY, "v", Math.max(0, Math.floor(Number(raw) || 0)));
      render();
    });
    $("hos-rows").addEventListener("click", openRows);
    $("hos-rows-apply").addEventListener("click", applyRows);
    $("hos-rows-cancel").addEventListener("click", () => $("hos-rows-modal").classList.remove("open"));
    $("hos-rows-modal").addEventListener("click", (e) => { if (e.target.id === "hos-rows-modal") e.currentTarget.classList.remove("open"); });
  }

  /* مجاميع شهر لكل يوم دوام (للّوحة الرئيسية) */
  function monthTotals(year, month) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const days = workdays(year, month);
    const t = totals(key, days);
    return days.map((d, i) => ({ date: d.date, day: d.day, trainees: t.trainees[i], staff: t.staff[i] }));
  }

  App.hospitality = { init, render, workdays, printSheet, rows: rowsDef, monthTotals, MONTHS, stockOf, perCarton };
})(window.App = window.App || {});
