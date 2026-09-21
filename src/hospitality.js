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
  const ym = () => `${current.year}-${String(current.month + 1).padStart(2, "0")}`;

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
    </tbody>`;
    $("hos-summary").textContent = `${ui.fmt(days.length)} يوم دوام · ${ui.fmt(t.sum(t.trainees))} وجبة للمتدربين · ${ui.fmt(t.sum(t.staff))} للموظفين · المجموع ${ui.fmt(t.sum(t.all))}`;
    const m = mode();
    $("hos-day").hidden = m !== "day";
    $("hos-wrap").hidden = m === "day";
    $("hos-mode-day").classList.toggle("active", m === "day");
    $("hos-mode-month").classList.toggle("active", m !== "day");
    if (m === "day") renderDay();
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
    el.innerHTML = `<span>المتدربون <b>${ui.fmt(tr)}</b></span><span>الموظفون <b>${ui.fmt(st)}</b></span><span>مجموع اليوم <b>${ui.fmt(tr + st)}</b></span>`;
  }

  /* تحديث المجاميع وحدها بعد كل إدخال، دون إعادة بناء الجدول (فلا يضيع موضع الكتابة) */
  function refreshTotals() {
    const month = ym();
    const days = workdays(current.year, current.month);
    const def = rowsDef();
    const t = totals(month, days);
    const set = (sel, v) => { const el = $("hos-table").querySelector(sel); if (el) el.textContent = v || ""; };
    def.tracks.concat(def.staff).forEach((r) => set(`[data-rowtotal="${CSS.escape(r.key)}"]`, t.rowTotal(r.key)));
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
      const n = Math.max(0, Math.floor(Number(el.value) || 0));
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

  App.hospitality = { init, render, workdays, printSheet, rows: rowsDef, monthTotals, MONTHS };
})(window.App = window.App || {});
