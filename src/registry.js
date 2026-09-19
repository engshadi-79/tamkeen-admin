/* سجل الوارد والصادر: ترقيم تلقائي، تسجيل تلقائي للخطابات المُصدَّرة، رفع ملفات دفعة واحدة وترتيبها
   حسب التاريخ ونوع المستند، والأرشفة على Google Drive، وتصدير Excel */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const TYPE_LABEL = { out: "صادر", in: "وارد" };
  const DIR_FOLDER = { out: "الصادر", in: "الوارد" };
  const CATEGORIES = ["خطابات", "تقارير", "محاضر اجتماعات", "كشوف وجداول", "عقود واتفاقيات", "فواتير ومالية", "صور", "أخرى"];
  const IN_PREFIX = "و";

  const records = () => (store.get().registry = store.get().registry || []);
  const settings = () => (store.get().registrySettings = Object.assign({ prefix: "م ت" }, store.get().registrySettings));

  /* ===== الترقيم: «البادئة/السنة/التسلسل» ويبدأ التسلسل من 1 كل سنة ===== */
  function nextNumber(type, dateISO) {
    const year = String(dateISO || ui.todayISO()).slice(0, 4);
    const prefix = type === "out" ? settings().prefix.trim() : IN_PREFIX;
    const head = `${prefix}/${year}/`;
    const max = records()
      .filter((r) => r.type === type && String(r.number).startsWith(head))
      .map((r) => parseInt(String(r.number).slice(head.length), 10))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return head + String(max + 1).padStart(3, "0");
  }
  const nextOutgoingNumber = (dateISO) => nextNumber("out", dateISO);

  /* ===== نوع المستند وتاريخه ===== */
  const categoryOf = (r) => r.category || (r.source === "letters" ? (/تقرير/.test(r.kind || "") ? "تقارير" : "خطابات") : "أخرى");

  function guessCategory(name) {
    const n = String(name).toLowerCase();
    if (/محضر|محاضر|اجتماع|minutes|meeting/.test(n)) return "محاضر اجتماعات";
    if (/تقرير|تقارير|report/.test(n)) return "تقارير";
    if (/عقد|عقود|اتفاقي|تفاهم|contract|agreement|mou/.test(n)) return "عقود واتفاقيات";
    if (/فاتور|فواتير|سند|سندات|مالي|ايصال|إيصال|invoice|receipt/.test(n)) return "فواتير ومالية";
    if (/كشف|كشوف|جدول|حضور|درجات|قائمة|\.(xlsx?|xlsm|csv|ods)$/.test(n)) return "كشوف وجداول";
    if (/خطاب|كتاب|مراسل|رسالة|تعميم|letter/.test(n)) return "خطابات";
    if (/\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$|^(صور|الصور|images|photos|pictures)$/.test(n)) return "صور";
    return "أخرى";
  }

  const pad = (n) => String(n).padStart(2, "0");
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const validDate = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

  /* التاريخ من اسم الملف إن وُجد (2026-09-18 أو 18-09-2026)، وإلا تاريخ آخر تعديل للملف */
  function dateFromText(text) {
    const n = String(text).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
    let m = n.match(/(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/);
    if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = n.match(/(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/);
    if (m && validDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return null;
  }
  const guessDate = (name, lastModified) => dateFromText(name) || (lastModified ? localISO(new Date(lastModified)) : ui.todayISO());

  /* مسار المجلد في Drive: السنة / الشهر / الوارد أو الصادر / نوع المستند */
  const archivePath = (r) => {
    const d = String(r.date || ui.todayISO());
    return [d.slice(0, 4), d.slice(5, 7), DIR_FOLDER[r.type], categoryOf(r)];
  };
  const pathText = (path) => path.join(" / ");

  /* يُستدعى عند تصدير خطاب أو تقرير: يضيف قيداً صادراً أو يحدّث القيد الموجود بنفس الرقم */
  async function upsertOutgoing({ number, date, party, subject, kind, category, file }) {
    if (!number) return null;
    let rec = records().find((r) => r.type === "out" && r.number === number);
    if (!rec) {
      rec = { id: store.uid(), type: "out", number, createdAt: new Date().toISOString() };
      records().push(rec);
    }
    Object.assign(rec, { date, party, subject, kind: kind || rec.kind || "", source: "letters" });
    rec.category = category || rec.category || categoryOf(rec);
    if (file) await attachFile(rec, file.blob, file.name, ui.todayISO());
    store.save();
    if ($("view-registry").classList.contains("active")) render();
    if (file) autoArchive(rec);
    return number;
  }

  async function attachFile(rec, blob, name, fileDate) {
    if (rec.fileId) await App.filesStore.remove(rec.fileId).catch(() => {});
    rec.fileId = await App.filesStore.put(blob, name);
    Object.assign(rec, { fileName: name, fileDate, driveId: null, driveLink: null, driveFolderId: null, drivePath: null }); // نسخة جديدة تُؤرشف من جديد
  }

  /* ===== الأرشفة على Google Drive ===== */
  const autoArchiveOn = () => App.drive && App.drive.isConfigured() && App.drive.settings().autoArchive;

  async function archiveRecord(rec) {
    const f = (rec.localFileId && (await App.filesStore.get(rec.localFileId))) || (rec.fileId && (await App.filesStore.get(rec.fileId)));
    if (!f) return false;
    const safeNum = String(rec.number).replace(/[\\/:*?"<>|]+/g, "-");
    const path = archivePath(rec);
    const res = await App.drive.upload(f.blob, `${safeNum} - ${f.name}`, path);
    Object.assign(rec, { driveId: res.id, driveLink: res.link, driveFolderId: res.folderId, drivePath: path, drivePending: false });
    store.save();
    return true;
  }

  /* بعد حفظ ملف مرفق: يُؤرشف فوراً إن كانت الجلسة متصلة، وإلا يُعلَّم «بانتظار الأرشفة» */
  async function autoArchive(rec) {
    if (!rec.fileId || !autoArchiveOn()) return;
    if (!App.drive.hasToken()) {
      rec.drivePending = true;
      store.save();
      if ($("view-registry").classList.contains("active")) render();
      return;
    }
    try {
      await archiveRecord(rec);
      ui.toast(`أُرشف ${rec.number} في Google Drive`);
    } catch (e) {
      rec.drivePending = true;
      store.save();
      console.warn("Drive:", e.message);
    }
    if ($("view-registry").classList.contains("active")) render();
  }

  /* يرفع قائمة قيود مع عرض التقدّم؛ عند انقطاع الجلسة يبقى الباقي «بانتظار الأرشفة» */
  async function archiveList(list, onProgress) {
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (onProgress) onProgress(i, list.length);
      try {
        if (await archiveRecord(list[i])) ok++;
      } catch (e) {
        list.slice(i).forEach((r) => { r.drivePending = true; });
        store.save();
        ui.toast(e.message === "NOT_CONNECTED" ? "انتهت جلسة Drive؛ اضغط «أرشفة المعلّق» لإكمال الرفع" : e.message);
        break;
      }
    }
    return ok;
  }

  /* من ضغطة زر: اتصال ثم أرشفة كل المعلّق أو قيد واحد */
  async function archiveNow(list) {
    if (!(await App.driveUI.ensureConnected())) return;
    const ok = await archiveList(list);
    render();
    if (ok) ui.toast(ok === 1 ? "تمت الأرشفة في Google Drive" : `أُرشف ${ui.fmt(ok)} ملفاً في Google Drive`);
  }

  /* ===== السجل المشترك على خادم المركز =====
     لا حاجة لتعليم كل تعديل: يُقارن كل قيد ببصمته عند آخر مزامنة، فالمتغيّر يأخذ updatedAt جديداً،
     والقيد الذي اختفى محلياً يُرسَل كحذف. الخادم يدمج (الأحدث يفوز) ويعيد السجل الكامل. */
  const SNAP_KEY = "tamkeen-admin:reg-sync";
  let syncing = false, syncAgain = false, syncTimer = null, lastSync = 0;

  function fingerprint(r) {
    const copy = Object.assign({}, r);
    delete copy.updatedAt;
    const s = JSON.stringify(copy);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }
  const loadSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "{}"); } catch (e) { return {}; } };
  const saveSnap = (list) => {
    const snap = {};
    list.forEach((r) => { snap[r.id] = fingerprint(r); });
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) { /* تخزين غير متاح */ }
  };

  async function syncShared(showErrors) {
    if (!App.cloud || !App.cloud.ready()) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    clearTimeout(syncTimer);
    try {
      const now = new Date().toISOString();
      const snap = loadSnap();
      const local = records();
      local.forEach((r) => { if (snap[r.id] !== fingerprint(r)) r.updatedAt = now; });
      const ids = new Set(local.map((r) => r.id));
      const deleted = {};
      Object.keys(snap).forEach((id) => { if (!ids.has(id)) deleted[id] = now; });
      const merged = await App.cloud.sync(local, deleted);
      // الملف المحلي (fileId) يخص هذا الجهاز فقط: يُحتفظ به إن كان القيد نفسه
      const localFiles = new Map(local.filter((r) => r.fileId).map((r) => [r.id, r]));
      merged.records.forEach((r) => {
        const mine = localFiles.get(r.id);
        if (mine && mine.fileName === r.fileName && mine.fileId !== r.fileId) r.localFileId = mine.fileId;
      });
      store.get().registry = merged.records;
      saveSnap(merged.records);
      lastSync = Date.now();
      store.save();
      if ($("view-registry").classList.contains("active")) render();
      if (App.dashboard && document.getElementById("view-dashboard").classList.contains("active")) App.dashboard.render();
    } catch (e) {
      console.warn("مزامنة السجل:", e.message);
      if (showErrors) ui.toast(e.message);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
    }
  }
  const scheduleSync = (ms) => { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncShared(false), ms); };

  /* فتح المرفق: من هذا الجهاز إن وُجد، وإلا من خادم المركز */
  async function openFile(rec) {
    for (const id of [rec.localFileId, rec.fileId]) {
      const f = id && (await App.filesStore.get(id).catch(() => null));
      if (f) { ui.download(f.name, f.blob); return; }
    }
    if (rec.driveId && App.cloud && App.cloud.ready()) {
      ui.toast("جارٍ جلب الملف من أرشيف المركز…");
      try {
        const f = await App.cloud.download(rec.driveId);
        ui.download(rec.fileName || f.name, f.blob);
      } catch (e) { ui.toast(e.message); }
      return;
    }
    if (rec.driveLink) { window.open(rec.driveLink, "_blank", "noopener"); return; }
    ui.toast("الملف غير موجود على هذا الجهاز");
  }

  /* للإحصاء في التقرير الدوري */
  function countInPeriod(from, to) {
    const inRange = (r) => (!from || r.date >= from) && (!to || r.date <= to);
    const list = records().filter(inRange);
    return { out: list.filter((r) => r.type === "out").length, in: list.filter((r) => r.type === "in").length };
  }

  /* ===== الواجهة ===== */
  const filter = { type: "all", q: "", year: "", cat: "" };
  const catOptions = (selected, withAll) =>
    (withAll ? `<option value="">كل الأنواع</option>` : "") + CATEGORIES.map((c) => `<option ${c === selected ? "selected" : ""}>${c}</option>`).join("");

  function filtered() {
    const q = filter.q.trim();
    return records()
      .filter((r) => filter.type === "all" || r.type === filter.type)
      .filter((r) => !filter.year || String(r.date || "").startsWith(filter.year))
      .filter((r) => !filter.cat || categoryOf(r) === filter.cat)
      .filter((r) => !q || [r.number, r.party, r.subject, r.notes, r.kind, r.fileName, categoryOf(r)].some((f) => String(f || "").includes(q)))
      .sort(compare);
  }

  /* ===== الترتيب والتصنيف (يُحفظ اختيار العرض في هذا المتصفح) ===== */
  const VIEW_KEY = "tamkeen-admin:reg-view";
  const view = (() => {
    const def = { sort: "date-desc", group: "month" };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(VIEW_KEY) || "{}")); } catch (e) { return def; }
  })();
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* تخزين غير متاح */ } };
  const collapsed = new Set();

  const displayName = (r) => r.fileName || r.subject || "";
  const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.number).localeCompare(String(b.number), "ar", { numeric: true });
  const byName = (a, b) => displayName(a).localeCompare(displayName(b), "ar", { numeric: true, sensitivity: "base" });
  const byCat = (a, b) => CATEGORIES.indexOf(categoryOf(a)) - CATEGORIES.indexOf(categoryOf(b));

  function compare(a, b) {
    switch (view.sort) {
      case "date-asc": return byDate(a, b);
      case "name": return byName(a, b) || byDate(b, a);
      case "category": return byCat(a, b) || byDate(b, a);
      default: return byDate(b, a);
    }
  }

  /* التصنيف: مفتاح كل مجموعة، وعنوانها، وترتيب المجموعات */
  const GROUPS = {
    month: {
      key: (r) => String(r.date || "").slice(0, 7) || "—",
      label: (k) => (k === "—" ? "بدون تاريخ" : `📅 ${k.slice(5, 7)}/${k.slice(0, 4)}م`),
      order: (a, b) => (view.sort === "date-asc" ? a.localeCompare(b) : b.localeCompare(a)),
    },
    category: { key: (r) => categoryOf(r), label: (k) => `🗂 ${k}`, order: (a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b) },
    type: { key: (r) => r.type, label: (k) => (k === "out" ? "📤 الصادر" : "📥 الوارد"), order: (a, b) => (a === "out" ? -1 : 1) - (b === "out" ? -1 : 1) },
    initial: { key: (r) => (displayName(r).trim()[0] || "—").toUpperCase(), label: (k) => `🔤 ${k}`, order: (a, b) => a.localeCompare(b, "ar") },
  };

  function rowHtml(r) {
    return `
      <tr data-id="${r.id}">
        <td><span class="badge ${r.type === "out" ? "digital" : "craft"}">${TYPE_LABEL[r.type]}</span></td>
        <td class="reg-num">${esc(r.number)}</td>
        <td class="nowrap">${esc(ui.formatDate(r.date))}</td>
        <td>${esc(r.party || "")}</td>
        <td>${esc(r.subject || "")}<div class="reg-kind">${esc(categoryOf(r))}${r.kind && r.kind !== categoryOf(r) ? ` · ${esc(r.kind)}` : ""}</div></td>
        <td class="reg-file">${fileCell(r)}</td>
        <td class="nowrap">${r.fileId && r.fileDate ? esc(ui.formatDate(r.fileDate)) : "—"}</td>
        <td>${folderCell(r)}</td>
        <td class="reg-actions"><button class="conv-link" data-edit>تعديل</button> <button class="conv-link danger" data-del>حذف</button></td>
      </tr>`;
  }

  function bodyHtml(list) {
    const g = GROUPS[view.group];
    if (!g) return list.map(rowHtml).join("");
    const groups = new Map();
    list.forEach((r) => { const k = g.key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    return [...groups.keys()].sort(g.order).map((k) => {
      const items = groups.get(k);
      const id = `${view.group}:${k}`;
      const closed = collapsed.has(id);
      return `<tr class="reg-group" data-group="${esc(id)}"><td colspan="9"><span class="reg-caret">${closed ? "◂" : "▾"}</span> ${esc(g.label(k))} <span class="reg-group-count">${ui.fmt(items.length)}</span></td></tr>`
        + (closed ? "" : items.map(rowHtml).join(""));
    }).join("");
  }

  /* خلية المجلد: المسار الفعلي بعد الرفع (مع رابط للمجلد)، أو المسار المتوقّع قبل الرفع */
  function folderCell(r) {
    if (!r.fileId) return "—";
    if (r.driveLink) {
      const path = r.drivePath || [DIR_FOLDER[r.type], String(r.date).slice(0, 4), String(r.date).slice(5, 7)]; // أرشفة سابقة بالترتيب القديم
      const text = esc(pathText(path));
      return r.driveFolderId ? `<a class="conv-link reg-path" href="${esc(App.drive.folderLink(r.driveFolderId))}" target="_blank" rel="noopener" title="فتح المجلد في Google Drive">📁 ${text}</a>` : `<span class="reg-path">📁 ${text}</span>`;
    }
    return `<span class="reg-path pending" title="لم يُرفع بعد إلى Drive">📁 ${esc(pathText(archivePath(r)))}</span>`;
  }

  /* اسم الملف مع عزل الامتداد حتى لا ينقلب ترتيبه داخل النص العربي */
  function nameHtml(name) {
    const m = String(name || "ملف").match(/^(.*?)(\.[A-Za-z0-9]{1,6})$/);
    if (!/[؀-ۿ]/.test(String(name || "ملف"))) return `<bdi dir="ltr">${esc(name)}</bdi>`; // اسم لاتيني يُعرض كما هو
    return m ? `<bdi>${esc(m[1])}</bdi><bdi dir="ltr">${esc(m[2])}</bdi>` : `<bdi>${esc(name || "ملف")}</bdi>`;
  }

  function fileCell(r) {
    if (!r.fileId) return "—";
    const drive = r.driveLink
      ? `<a class="conv-link" href="${esc(r.driveLink)}" target="_blank" rel="noopener" title="فتح في Google Drive">☁ Drive</a>`
      : App.drive && App.drive.isConfigured() ? `<button class="conv-link" data-archive title="${r.drivePending ? "بانتظار الأرشفة" : "أرشفة في Google Drive"}">${r.drivePending ? "⏳" : "☁"} أرشفة</button>` : "";
    return `<div class="reg-fname" title="${esc(r.fileName || "")}">${nameHtml(r.fileName)}</div>
      <div class="reg-file-btns"><button class="conv-link" data-open>📎 فتح</button> ${drive}</div>`;
  }

  function render() {
    const all = records();
    const years = [...new Set(all.map((r) => String(r.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    $("reg-year").innerHTML = `<option value="">كل السنوات</option>` + years.map((y) => `<option ${y === filter.year ? "selected" : ""}>${y}</option>`).join("");
    $("reg-cat").innerHTML = catOptions(filter.cat, true);
    document.querySelectorAll("[data-reg-type]").forEach((b) => b.classList.toggle("active", b.dataset.regType === filter.type));
    $("reg-counts").textContent = `${ui.fmt(all.filter((r) => r.type === "out").length)} صادر · ${ui.fmt(all.filter((r) => r.type === "in").length)} وارد`;
    $("reg-prefix").value = settings().prefix;
    const pending = all.filter((r) => r.drivePending && r.fileId && !r.driveLink);
    $("reg-archive-pending").hidden = !pending.length;
    $("reg-archive-pending").textContent = `☁ أرشفة المعلّق (${ui.fmt(pending.length)})`;

    $("reg-sort").value = view.sort;
    $("reg-group").value = view.group;
    document.querySelectorAll("[data-sort-col]").forEach((th) => {
      const col = th.dataset.sortCol;
      const on = col === "date" ? view.sort.startsWith("date") : view.sort === col;
      th.classList.toggle("sorted", on);
      th.dataset.arrow = !on ? "" : view.sort === "date-desc" ? "▼" : "▲";
    });
    const list = filtered();
    $("reg-body").innerHTML = list.length ? bodyHtml(list)
      : `<tr><td colspan="9" class="empty">لا توجد قيود${filter.q || filter.type !== "all" || filter.year || filter.cat ? " مطابقة" : " بعد. الخطابات المصدَّرة من «المراسلات» تُسجَّل هنا تلقائياً، أو ارفع ملفاتك من «رفع ملفات»"}.</td></tr>`;
  }

  /* ===== نموذج الإضافة والتعديل ===== */
  let editingId = null;

  function openForm(rec) {
    editingId = rec ? rec.id : null;
    $("reg-modal-title").textContent = rec ? "تعديل قيد" : "قيد جديد";
    $("reg-type").value = rec ? rec.type : "in";
    $("reg-date").value = rec ? rec.date : ui.todayISO();
    $("reg-category").innerHTML = catOptions(rec ? categoryOf(rec) : "خطابات");
    $("reg-number").value = rec ? rec.number : "";
    $("reg-party").value = rec ? rec.party || "" : "";
    $("reg-subject").value = rec ? rec.subject || "" : "";
    $("reg-notes").value = rec ? rec.notes || "" : "";
    $("reg-file").value = "";
    $("reg-file-current").textContent = rec && rec.fileId ? `المرفق الحالي: ${rec.fileName}` : "";
    syncNumberHint();
    $("reg-modal").classList.add("open");
    $("reg-party").focus();
  }
  const closeForm = () => $("reg-modal").classList.remove("open");

  function syncNumberHint() {
    $("reg-number").placeholder = `تلقائي: ${nextNumber($("reg-type").value, $("reg-date").value)}`;
  }

  async function saveForm(e) {
    e.preventDefault();
    const type = $("reg-type").value;
    const date = $("reg-date").value || ui.todayISO();
    const number = $("reg-number").value.trim() || nextNumber(type, date);
    const dup = records().find((r) => r.type === type && r.number === number && r.id !== editingId);
    if (dup) { ui.toast(`الرقم ${number} مسجّل مسبقاً في ${TYPE_LABEL[type]}`); return; }

    let rec = editingId && records().find((r) => r.id === editingId);
    if (!rec) {
      rec = { id: store.uid(), createdAt: new Date().toISOString() };
      records().push(rec);
    }
    const moved = rec.driveLink && pathText(archivePath(rec)) !== pathText(archivePath({ type, date, category: $("reg-category").value }));
    Object.assign(rec, { type, date, number, category: $("reg-category").value, party: $("reg-party").value.trim(), subject: $("reg-subject").value.trim(), notes: $("reg-notes").value.trim() });
    const file = $("reg-file").files[0];
    if (file) await attachFile(rec, file, file.name, localISO(new Date(file.lastModified)));
    store.save();
    closeForm();
    render();
    if (file) autoArchive(rec);
    ui.toast(`تم حفظ القيد ${number}${moved && !file ? " — الملف في Drive باقٍ في مجلده السابق" : ""}`);
  }

  async function deleteRecord(id) {
    const rec = records().find((r) => r.id === id);
    if (!rec || !confirm(`حذف القيد ${rec.number} (${TYPE_LABEL[rec.type]})؟${rec.driveLink ? "\nالنسخة في Google Drive لا تُحذف." : ""}`)) return;
    if (rec.fileId) await App.filesStore.remove(rec.fileId).catch(() => {});
    store.get().registry = records().filter((r) => r.id !== id);
    store.save();
    render();
    ui.toast("تم حذف القيد");
  }

  /* ===== رفع عدة ملفات دفعة واحدة ===== */
  let bulk = []; // { file, type, category, date, number, party, subject }
  let bulkBusy = false;

  // ملفات النظام والملفات المؤقتة داخل المجلدات لا تُسجَّل
  const SKIP_FILE = /^(\.|~\$)|^(thumbs\.db|desktop\.ini)$/i;
  const folderOf = (f) => (f.relPath || f.webkitRelativePath || "").split("/").slice(0, -1).join("/");

  /* نوع المستند من اسم الملف، وإلا من أقرب مجلد يدل عليه (مثل مجلد «تقارير») */
  function guessCategoryFor(file) {
    const own = guessCategory(file.name);
    if (own !== "أخرى") return own;
    const dirs = folderOf(file).split("/").filter(Boolean).reverse();
    for (const d of dirs) { const c = guessCategory(d); if (c !== "أخرى") return c; }
    return own;
  }

  /* التاريخ من اسم الملف، ثم من أسماء المجلدات، ثم تاريخ آخر تعديل */
  function guessDateFor(file) {
    const dirs = folderOf(file).split("/").filter(Boolean).reverse();
    for (const t of [file.name, ...dirs]) { const d = dateFromText(t); if (d) return d; }
    return localISO(new Date(file.lastModified));
  }

  function addBulkFiles(files) {
    const key = (f) => `${folderOf(f)}/${f.name}|${f.size}|${f.lastModified}`;
    const have = new Set(bulk.map((it) => key(it.file)));
    const all = [...files];
    const list = all.filter((f) => f.size > 0 && !SKIP_FILE.test(f.name) && !have.has(key(f)));
    if (!list.length) { if (all.length) ui.toast("لا توجد ملفات جديدة للإضافة"); return; }
    if (list.length > 150 && !confirm(`سيُضاف ${ui.fmt(list.length)} ملفاً. متابعة؟`)) return;
    const shared = bulk[0] ? { type: bulk[0].type, party: bulk[0].party } : { type: "in", party: "" };
    list.forEach((file) => bulk.push({
      file,
      type: shared.type,
      category: guessCategoryFor(file),
      date: guessDateFor(file),
      number: "",
      party: shared.party,
      subject: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim(),
    }));
    renderBulk();
    $("bulk-modal").classList.add("open");
    const folders = new Set(list.map(folderOf).filter(Boolean)).size;
    if (folders) ui.toast(`أُضيف ${ui.fmt(list.length)} ملفاً من ${ui.fmt(folders)} مجلد`);
  }

  /* قراءة مجلد مسحوب إلى الصفحة (مع مجلداته الفرعية) */
  function readEntry(entry, path) {
    if (entry.isFile) {
      return new Promise((resolve) => entry.file((f) => { f.relPath = path + f.name; resolve([f]); }, () => resolve([])));
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    const reader = entry.createReader();
    const entries = [];
    return new Promise((resolve) => {
      const next = () => reader.readEntries(async (batch) => {
        if (batch.length) { entries.push(...batch); next(); return; } // القراءة على دفعات حتى تنتهي
        const nested = await Promise.all(entries.map((e) => readEntry(e, `${path}${entry.name}/`)));
        resolve(nested.flat());
      }, () => resolve([]));
      next();
    });
  }

  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length || !entries.some((e) => e.isDirectory)) return [...dt.files];
    $("bulk-progress").textContent = "جارٍ قراءة المجلد…";
    const files = (await Promise.all(entries.map((e) => readEntry(e, "")))).flat();
    $("bulk-progress").textContent = "";
    return files;
  }

  function bulkRow(it, i) {
    return `<tr data-i="${i}">
      <td class="bulk-name" title="${esc(it.file.name)}">${nameHtml(it.file.name)}${folderOf(it.file) ? `<div class="reg-kind">📂 ${esc(folderOf(it.file))}</div>` : ""}<div class="reg-kind">${esc(ui.fmt(Math.max(1, Math.round(it.file.size / 1024))))} ك.ب · ${esc(ui.formatDate(localISO(new Date(it.file.lastModified))))}</div></td>
      <td><select data-k="type"><option value="in" ${it.type === "in" ? "selected" : ""}>وارد</option><option value="out" ${it.type === "out" ? "selected" : ""}>صادر</option></select></td>
      <td><select data-k="category">${catOptions(it.category)}</select></td>
      <td><input type="date" data-k="date" value="${esc(it.date)}"></td>
      <td><input type="text" data-k="number" value="${esc(it.number)}" placeholder="تلقائي"></td>
      <td><input type="text" data-k="party" value="${esc(it.party)}"></td>
      <td><input type="text" data-k="subject" value="${esc(it.subject)}"></td>
      <td class="bulk-path">📁 ${esc(pathText(archivePath(it)))}</td>
      <td><button class="conv-link danger" data-remove title="إزالة من القائمة">✕</button></td>
    </tr>`;
  }

  function renderBulk() {
    $("bulk-body").innerHTML = bulk.map(bulkRow).join("");
    $("bulk-count").textContent = `${ui.fmt(bulk.length)} ملف`;
    $("bulk-root").textContent = App.drive ? App.drive.settings().rootName : "";
    const canDrive = App.drive && App.drive.isConfigured();
    $("bulk-save-drive").textContent = canDrive ? "حفظ ورفع إلى Drive" : "حفظ ورفع إلى Drive (إعداد Drive أولاً)";
  }

  const closeBulk = () => { if (bulkBusy) return; bulk = []; $("bulk-modal").classList.remove("open"); $("bulk-progress").textContent = ""; };

  function setBulkBusy(busy) {
    bulkBusy = busy;
    ["bulk-save-drive", "bulk-save", "bulk-cancel", "bulk-more", "bulk-more-folder"].forEach((id) => { $(id).disabled = busy; });
  }

  async function saveBulk(toDrive) {
    if (!bulk.length || bulkBusy) return;
    // الأرقام المكتوبة يدوياً يجب ألا تتكرر
    const seen = new Set();
    for (const it of bulk) {
      const n = it.number.trim();
      if (!n) continue;
      const key = `${it.type}|${n}`;
      if (seen.has(key) || records().some((r) => r.type === it.type && r.number === n)) { ui.toast(`الرقم ${n} مكرر في ${TYPE_LABEL[it.type]}`); return; }
      seen.add(key);
    }
    // الاتصال أولاً وهو ما زال ضمن ضغطة الزر (نافذة Google تحتاج ذلك)
    if (toDrive && !(await App.driveUI.ensureConnected())) return;

    setBulkBusy(true);
    const created = [];
    try {
      // بالترتيب الزمني حتى تتسلسل الأرقام التلقائية مع التواريخ
      const ordered = bulk.slice().sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 0; i < ordered.length; i++) {
        const it = ordered[i];
        $("bulk-progress").textContent = `حفظ ${ui.fmt(i + 1)} من ${ui.fmt(ordered.length)}…`;
        const date = it.date || ui.todayISO();
        const rec = {
          id: store.uid(), createdAt: new Date().toISOString(), source: "upload",
          type: it.type, date, number: it.number.trim() || nextNumber(it.type, date),
          category: it.category, party: it.party.trim(), subject: it.subject.trim(), notes: "",
        };
        await attachFile(rec, it.file, it.file.name, localISO(new Date(it.file.lastModified)));
        records().push(rec);
        store.save();
        created.push(rec);
      }
      let ok = 0;
      if (toDrive) {
        ok = await archiveList(created, (i, n) => { $("bulk-progress").textContent = `رفع ${ui.fmt(i + 1)} من ${ui.fmt(n)} إلى Google Drive…`; });
      } else if (autoArchiveOn()) {
        created.forEach((r) => { r.drivePending = true; });
        store.save();
      }
      ui.toast(toDrive ? `حُفظ ${ui.fmt(created.length)} قيداً ورُفع ${ui.fmt(ok)} إلى Drive` : `حُفظ ${ui.fmt(created.length)} قيداً في السجل`);
    } catch (e) {
      console.error(e);
      ui.toast(`تعذّر الحفظ: ${e.message}`);
    } finally {
      setBulkBusy(false);
    }
    closeBulk();
    render();
  }

  function initBulk() {
    $("reg-bulk").addEventListener("click", () => $("reg-bulk-input").click());
    $("reg-bulk-input").addEventListener("change", (e) => { addBulkFiles(e.target.files); e.target.value = ""; });
    $("bulk-more-input").addEventListener("change", (e) => { addBulkFiles(e.target.files); e.target.value = ""; });
    $("bulk-more").addEventListener("click", () => $("bulk-more-input").click());
    $("reg-folder").addEventListener("click", () => $("reg-folder-input").click());
    $("bulk-more-folder").addEventListener("click", () => $("reg-folder-input").click());
    $("reg-folder-input").addEventListener("change", (e) => { addBulkFiles(e.target.files); e.target.value = ""; });

    // سحب الملفات وإفلاتها على صفحة السجل أو نافذة الرفع
    [$("view-registry"), $("bulk-modal")].forEach((zone) => {
      zone.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); zone.classList.add("drop-over"); } });
      zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop-over"); });
      zone.addEventListener("drop", async (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("drop-over");
        if (!bulkBusy) addBulkFiles(await filesFromDrop(e.dataTransfer));
      });
    });

    $("bulk-body").addEventListener("input", (e) => {
      const el = e.target.closest("[data-k]");
      const tr = e.target.closest("tr[data-i]");
      if (!el || !tr) return;
      const it = bulk[Number(tr.dataset.i)];
      it[el.dataset.k] = el.value;
      tr.querySelector(".bulk-path").textContent = `📁 ${pathText(archivePath(it))}`;
    });
    $("bulk-body").addEventListener("click", (e) => {
      if (!e.target.closest("[data-remove]") || bulkBusy) return;
      bulk.splice(Number(e.target.closest("tr[data-i]").dataset.i), 1);
      if (bulk.length) renderBulk(); else closeBulk();
    });
    // تطبيق قيمة على كل الملفات
    $("bulk-all").addEventListener("change", (e) => {
      const el = e.target.closest("[data-all]");
      if (!el || !el.value) return;
      bulk.forEach((it) => { it[el.dataset.all] = el.value; });
      el.value = "";
      renderBulk();
    });
    $("bulk-all-cat").innerHTML = `<option value="">نوع المستند للكل…</option>` + catOptions();
    $("bulk-save-drive").addEventListener("click", () => saveBulk(true));
    $("bulk-save").addEventListener("click", () => saveBulk(false));
    $("bulk-cancel").addEventListener("click", closeBulk);
    $("bulk-modal").addEventListener("click", (e) => { if (e.target.id === "bulk-modal") closeBulk(); });
  }

  async function exportExcel() {
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("الوارد والصادر", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    sh.columns = [
      { header: "النوع", key: "type", width: 9 }, { header: "الرقم", key: "number", width: 18 },
      { header: "التاريخ", key: "date", width: 13 }, { header: "الجهة", key: "party", width: 34 },
      { header: "الموضوع", key: "subject", width: 44 }, { header: "نوع المستند", key: "category", width: 18 },
      { header: "نوع المراسلة", key: "kind", width: 18 }, { header: "ملاحظات", key: "notes", width: 30 },
      { header: "اسم الملف", key: "fileName", width: 30 }, { header: "تاريخ الملف", key: "fileDate", width: 13 },
      { header: "المجلد في Drive", key: "folder", width: 40 }, { header: "رابط Drive", key: "driveLink", width: 40 },
    ];
    filtered().forEach((r) => sh.addRow(Object.assign({}, r, {
      type: TYPE_LABEL[r.type],
      category: categoryOf(r),
      folder: r.driveLink ? pathText(r.drivePath || [DIR_FOLDER[r.type], String(r.date).slice(0, 4), String(r.date).slice(5, 7)]) : "",
    })));
    sh.getRow(1).font = { bold: true };
    sh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDFF4F4" } };
    ui.download(`سجل الوارد والصادر - ${ui.todayISO()}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function init() {
    // السجل المشترك: مزامنة عند الفتح، وبعد كل تعديل، وكل دقيقة، وعند العودة إلى الصفحة
    if (App.cloud) {
      store.onChange(() => { if (!syncing) scheduleSync(1500); });
      setTimeout(() => syncShared(false), 800);
      setInterval(() => { if (document.visibilityState === "visible") syncShared(false); }, 60000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastSync > 15000) syncShared(false); });
    }
    document.querySelectorAll("[data-reg-type]").forEach((b) => b.addEventListener("click", () => { filter.type = b.dataset.regType; render(); }));
    $("reg-search").addEventListener("input", (e) => { filter.q = e.target.value; render(); });
    $("reg-year").addEventListener("change", (e) => { filter.year = e.target.value; render(); });
    $("reg-cat").addEventListener("change", (e) => { filter.cat = e.target.value; render(); });
    $("reg-sort").addEventListener("change", (e) => { view.sort = e.target.value; saveView(); render(); });
    $("reg-group").addEventListener("change", (e) => { view.group = e.target.value; saveView(); render(); });
    // الضغط على رأس العمود يرتّب به؛ والتاريخ يتبدّل بين الأحدث والأقدم
    document.querySelectorAll("[data-sort-col]").forEach((th) => th.addEventListener("click", () => {
      const col = th.dataset.sortCol;
      view.sort = col === "date" ? (view.sort === "date-desc" ? "date-asc" : "date-desc") : col;
      saveView();
      render();
    }));
    $("reg-add").addEventListener("click", () => openForm(null));
    $("reg-export").addEventListener("click", exportExcel);
    $("reg-archive-pending").addEventListener("click", () => archiveNow(records().filter((r) => r.drivePending && r.fileId && !r.driveLink)));
    if (App.driveUI) App.driveUI.onChange(() => { if ($("view-registry").classList.contains("active")) render(); });
    $("reg-prefix").addEventListener("change", (e) => {
      settings().prefix = e.target.value.trim() || "م ت";
      store.save();
      ui.toast(`بادئة الصادر: ${settings().prefix}`);
    });
    $("reg-body").addEventListener("click", (e) => {
      const groupRow = e.target.closest("tr[data-group]");
      if (groupRow) {
        const id = groupRow.dataset.group;
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        render();
        return;
      }
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const rec = records().find((r) => r.id === tr.dataset.id);
      if (e.target.closest("[data-open]")) openFile(rec);
      else if (e.target.closest("[data-archive]")) archiveNow([rec]);
      else if (e.target.closest("[data-edit]")) openForm(rec);
      else if (e.target.closest("[data-del]")) deleteRecord(rec.id);
    });
    $("reg-type").addEventListener("change", syncNumberHint);
    $("reg-date").addEventListener("change", syncNumberHint);
    $("reg-number-auto").addEventListener("click", () => { $("reg-number").value = nextNumber($("reg-type").value, $("reg-date").value); });
    $("reg-form").addEventListener("submit", saveForm);
    $("reg-cancel").addEventListener("click", closeForm);
    $("reg-modal").addEventListener("click", (e) => { if (e.target.id === "reg-modal") closeForm(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeForm(); closeBulk(); } });
    initBulk();
  }

  App.registry = { syncShared, init, render, nextOutgoingNumber, upsertOutgoing, countInPeriod, guessCategory, guessDate };
})(window.App = window.App || {});
