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
  /* مسار المجلد في Drive: مجلد المستخدم / السنة / الشهر / الوارد أو الصادر / نوع المستند */
  const archivePath = (r) => {
    const d = String(r.date || ui.todayISO());
    const path = [d.slice(0, 4), d.slice(5, 7), DIR_FOLDER[r.type], categoryOf(r)];
    return r.owner ? [r.owner, ...path] : path;
  };
  const me = () => (App.profile ? App.profile.name() : "");
  const pathText = (path) => path.join(" / ");
  const nowISO = () => new Date().toISOString();
  const TRASH_DAYS = 30;

  /* سجل نشاط كل قيد: من فعل ماذا ومتى (آخر 30 حدثاً) */
  function logAction(rec, action) {
    rec.history = (rec.history || []).concat({ at: nowISO(), by: me() || "—", action }).slice(-30);
  }

  /* المدير يعدّل كل القيود؛ المستخدم يعدّل قيوده فقط */
  const canModify = (r) => !App.profile || App.profile.isAdmin() || (!!r.owner && r.owner === me());
  const live = () => records().filter((r) => !r.deletedAt);

  /* المسار التدريبي: يُقترح من اسم الملف أو مجلده بمطابقة أسماء المسارات */
  const trackNames = () => (store.get().tracks || []).map((t) => t.name);
  const GENERIC = new Set(["مسار", "والأثاث", "وصناعة", "والعناية", "والشبكات", "الشخصية"]);
  function guessTrack(text) {
    const t = String(text || "");
    let best = "", score = 0;
    trackNames().forEach((name) => {
      if (t.includes(name)) { if (name.length * 10 > score) { best = name; score = name.length * 10; } return; }
      const hits = name.split(/\s+/).filter((w) => w.length > 3 && !GENERIC.has(w) && t.includes(w.replace(/^ال/, ""))).length;
      if (hits > score) { best = name; score = hits; }
    });
    return best;
  }
  const trackOptions = (selected, allLabel) => `<option value="">${allLabel || "— بدون مسار —"}</option>`
    + trackNames().map((n) => `<option ${n === selected ? "selected" : ""}>${esc(n)}</option>`).join("");

  /* رقم تسلسلي محجوز من الخادم (لا يتكرر بين الأجهزة)، أو محلي بلا أرشيف مركز */
  const headOf = (type, date) => `${type === "out" ? settings().prefix.trim() : IN_PREFIX}/${String(date || ui.todayISO()).slice(0, 4)}/`;
  async function assignNumbers(type, date, count) {
    if (App.cloud && App.cloud.ready()) {
      try { return await App.cloud.reserve(headOf(type, date), count); } catch (e) { console.warn("حجز الرقم:", e.message); }
    }
    const first = parseInt(nextNumber(type, date).split("/").pop(), 10);
    return Array.from({ length: count }, (_, i) => headOf(type, date) + String(first + i).padStart(3, "0"));
  }
  const assignNumber = async (type, date) => (await assignNumbers(type, date, 1))[0];

  /* يُستدعى عند تصدير خطاب أو تقرير: يضيف قيداً صادراً أو يحدّث القيد الموجود بنفس الرقم */
  async function upsertOutgoing({ number, date, party, subject, kind, category, file, replyTo, verifyId }) {
    if (!number) return null;
    let rec = records().find((r) => r.type === "out" && r.number === number);
    if (!rec) {
      rec = { id: store.uid(), type: "out", number, owner: me(), createdAt: nowISO() };
      records().push(rec);
      logAction(rec, "تصدير خطاب");
    } else logAction(rec, "إعادة تصدير");
    Object.assign(rec, { date, party, subject, kind: kind || rec.kind || "", source: "letters", deletedAt: null });
    rec.category = category || rec.category || categoryOf(rec);
    if (!rec.track) rec.track = guessTrack(`${subject} ${party}`);
    if (verifyId) rec.verifyId = verifyId; // رمز التحقق المطبوع على الخطاب
    // الرد على وارد: يُربط الصادر بالوارد ويُعلَّم الوارد «تمت المعالجة»
    const original = replyTo && records().find((r) => r.id === replyTo);
    if (original) {
      rec.replyTo = original.id;
      Object.assign(original, { done: true, replyId: rec.id, replyNumber: number });
      logAction(original, `رُدّ عليه بالصادر ${number}`);
    }
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
    logAction(rec, "رُفع إلى الأرشيف");
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
      const changed = local.filter((r) => snap[r.id] !== fingerprint(r));
      changed.forEach((r) => { r.updatedAt = now; });
      const ids = new Set(local.map((r) => r.id));
      const deleted = {};
      Object.keys(snap).forEach((id) => { if (!ids.has(id)) deleted[id] = now; });
      // بصمة ما أُرسل: التعديلات التي تجري أثناء الطلب لا تُستبدل برد الخادم
      const sentPrints = {};
      local.forEach((r) => { sentPrints[r.id] = fingerprint(r); });
      // بلا تغييرات: طلب قراءة فقط، فلا يكتب الخادم شيئاً ولا يزدحم القفل
      const merged = await App.cloud.sync(changed.length || Object.keys(deleted).length ? local : [], deleted);
      // خادم أعاد سجلاً فارغاً بلا أي شاهد حذف، ونحن لم نرسل شيئاً:
      // خادم جديد أو فارغ، فلا تُمسح قيود الجهاز بردّه — تُرفع في الجولة التالية.
      if (!merged.records.length && !Object.keys(merged.deleted || {}).length && local.length
          && !changed.length && !Object.keys(deleted).length) {
        saveSnap([]);
        scheduleSync(1500);
        return;
      }
      // الملف المحلي (fileId) يخص هذا الجهاز فقط: يُحتفظ به إن كان القيد نفسه
      const localFiles = new Map(local.filter((r) => r.fileId).map((r) => [r.id, r]));
      merged.records.forEach((r) => {
        const mine = localFiles.get(r.id);
        if (mine && mine.fileName === r.fileName && mine.fileId !== r.fileId) r.localFileId = mine.fileId;
      });
      const liveNow = new Map(records().map((r) => [r.id, r]));
      const kept = [];
      const removed = []; // حُذف على الجهاز أثناء الطلب: لا يُعيده ردّ الخادم
      const final = [];
      merged.records.forEach((r) => {
        const live = liveNow.get(r.id);
        if (!live && sentPrints[r.id] !== undefined) { removed.push(r.id); return; }
        if (live && sentPrints[r.id] !== undefined && fingerprint(live) !== sentPrints[r.id]) { kept.push(r.id); final.push(live); return; }
        final.push(r);
      });
      liveNow.forEach((live, id) => { if (sentPrints[id] === undefined && !final.some((r) => r.id === id)) { final.push(live); kept.push(id); } });
      store.get().registry = final;
      saveSnap(final.filter((r) => kept.indexOf(r.id) === -1));
      if (removed.length) {
        // يبقى المحذوف في البصمات حتى تُرسل الجولة التالية حذفه
        const snap = loadSnap();
        removed.forEach((id) => { snap[id] = sentPrints[id]; });
        try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) { /* تخزين غير متاح */ }
        scheduleSync(1200);
      }
      if (kept.length) scheduleSync(1200); // ما بقي من تعديلات يُرفع في الجولة التالية
      lastSync = Date.now();
      store.save();
      if ($("view-registry").classList.contains("active")) render();
      if (App.dashboard && document.getElementById("view-dashboard").classList.contains("active")) App.dashboard.render();
      uploadPendingToCenter();
      purgeTrash();
    } catch (e) {
      console.warn("مزامنة السجل:", e.message);
      if (/مشغول|مهلة|Lock|timed out/i.test(e.message)) scheduleSync(8000);
      else if (showErrors) ui.toast(e.message);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
    }
  }
  /* مع أرشيف المركز لا يلزم تسجيل دخول: أي ملف على هذا الجهاز لم يصل إلى المركز بعد يُرفع تلقائياً،
     حتى يستطيع الجميع تحميله */
  let uploadingPending = false;
  async function uploadPendingToCenter() {
    if (uploadingPending || !App.cloud || !App.cloud.ready()) return;
    const candidates = records().filter((r) => !r.deletedAt && !r.driveLink && (r.fileId || r.localFileId));
    const local = [];
    for (const r of candidates) {
      const ids = [r.localFileId, r.fileId].filter(Boolean);
      for (const id of ids) { if (await App.filesStore.get(id).catch(() => null)) { local.push(r); break; } }
    }
    if (!local.length) return;
    uploadingPending = true;
    try {
      const ok = await archiveList(local);
      if (ok) ui.toast(ok === 1 ? "رُفع ملف معلّق إلى أرشيف المركز" : `رُفع ${ui.fmt(ok)} ملفاً معلّقاً إلى أرشيف المركز`);
      if ($("view-registry").classList.contains("active")) render();
    } finally {
      uploadingPending = false;
    }
  }

  const scheduleSync = (ms) => { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncShared(false), ms); };

  /* المرفق: من هذا الجهاز إن وُجد، وإلا من خادم المركز (مع ذاكرة مؤقتة حتى لا يُجلب مرتين) */
  const fetched = new Map();
  async function getFile(rec) {
    for (const id of [rec.localFileId, rec.fileId]) {
      const f = id && (await App.filesStore.get(id).catch(() => null));
      if (f) return { name: f.name, blob: f.blob };
    }
    if (rec.driveId && App.cloud && App.cloud.ready()) {
      if (!fetched.has(rec.driveId)) {
        ui.toast("جارٍ جلب الملف من أرشيف المركز…");
        const f = await App.cloud.download(rec.driveId);
        fetched.set(rec.driveId, { name: rec.fileName || f.name, blob: f.blob });
      }
      return fetched.get(rec.driveId);
    }
    return null;
  }

  const missingMsg = (rec) => rec.owner
    ? `الملف لم يصل إلى أرشيف المركز بعد؛ هو على جهاز ${rec.owner}، ويُرفع تلقائياً عند فتح الأداة على جهازه.`
    : "الملف لم يصل إلى أرشيف المركز بعد؛ هو على جهاز من رفعه، ويُرفع تلقائياً عند فتح الأداة على جهازه.";

  /* «تحميل»: تنزيل الملف دائماً. «عرض»: معاينة داخل الصفحة */
  async function openFile(rec, mode) {
    if (mode === "view") { openPreview(rec); return; }
    try {
      const f = await getFile(rec);
      if (f) { ui.download(f.name, f.blob); return; }
      if (rec.driveLink && !(App.cloud && App.cloud.ready())) window.open(rec.driveLink, "_blank", "noopener");
      else ui.toast(missingMsg(rec));
    } catch (e) { ui.toast(e.message); }
  }

  /* ===== معاينة الملف داخل الصفحة: PDF والصور والنصوص وWord وExcel ===== */
  let pvFile = null, pvUrl = null;
  const pvNote = (text) => `<p class="pv-note">${esc(text)}</p>`;

  async function openPreview(rec) {
    pvFile = null;
    $("pv-title").textContent = rec.fileName || rec.subject || "ملف";
    $("pv-body").innerHTML = pvNote("جارٍ تجهيز المعاينة…");
    $("pv-modal").classList.add("open");
    try {
      const f = await getFile(rec);
      if (!f) { $("pv-body").innerHTML = pvNote(missingMsg(rec)); return; }
      pvFile = f;
      const type = f.blob.type || "";
      const name = String(f.name || rec.fileName || "").toLowerCase();
      if (/pdf/.test(type) || name.endsWith(".pdf")) {
        pvUrl = URL.createObjectURL(new Blob([f.blob], { type: "application/pdf" }));
        $("pv-body").innerHTML = `<iframe src="${pvUrl}" title="معاينة"></iframe>`;
      } else if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) {
        pvUrl = URL.createObjectURL(f.blob);
        $("pv-body").innerHTML = `<img src="${pvUrl}" alt="">`;
      } else if (/^text\//.test(type) || /\.(txt|csv|json|md)$/.test(name)) {
        $("pv-body").innerHTML = `<div class="pv-doc" style="white-space:pre-wrap">${esc(await f.blob.text())}</div>`;
      } else if (name.endsWith(".docx")) {
        $("pv-body").innerHTML = `<div class="pv-doc">${await docxHtml(f.blob)}</div>`;
      } else if (/\.(xlsx|xlsm)$/.test(name)) {
        $("pv-body").innerHTML = await sheetHtml(f.blob);
      } else {
        $("pv-body").innerHTML = pvNote("لا يمكن معاينة هذا النوع من الملفات داخل المتصفح؛ استخدم «تحميل».");
      }
    } catch (e) {
      console.error(e);
      $("pv-body").innerHTML = pvNote(`تعذّرت المعاينة: ${e.message}`);
    }
  }

  function closePreview() {
    $("pv-modal").classList.remove("open");
    $("pv-body").innerHTML = "";
    if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
  }

  /* نص ملف Word مع الفقرات والجداول والخط العريض والمحاذاة (معاينة، لا تنسيق كامل) */
  async function docxHtml(blob) {
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const kids = (el, name) => [...el.childNodes].filter((n) => n.localName === name);
    const find = (el, name) => [...el.getElementsByTagNameNS("*", name)];
    const para = (p) => {
      const pPr = kids(p, "pPr")[0];
      const jc = pPr && find(pPr, "jc")[0];
      const align = jc ? { center: "center", both: "justify", left: "right", start: "right", right: "left", end: "left" }[jc.getAttribute("w:val")] : "";
      const html = find(p, "r").map((r) => {
        const text = kids(r, "t").map((t) => t.textContent).join("") + (kids(r, "tab").length ? " " : "") + (kids(r, "br").length ? "\n" : "");
        const rPr = kids(r, "rPr")[0];
        const bold = rPr && kids(rPr, "b").some((b) => !/^(0|false)$/.test(b.getAttribute("w:val") || ""));
        return bold ? `<b>${esc(text)}</b>` : esc(text);
      }).join("");
      return `<p${align ? ` style="text-align:${align}"` : ""}>${html || "&nbsp;"}</p>`;
    };
    const body = find(doc, "body")[0];
    if (!body) return "";
    return [...body.childNodes].map((n) => {
      if (n.localName === "p") return para(n);
      if (n.localName === "tbl") {
        return `<table>${kids(n, "tr").map((tr) => `<tr>${kids(tr, "tc").map((tc) => `<td>${kids(tc, "p").map(para).join("")}</td>`).join("")}</tr>`).join("")}</table>`;
      }
      return "";
    }).join("");
  }

  /* أول ثلاث أوراق من ملف Excel كجداول (حتى 300 صف و30 عموداً) */
  async function sheetHtml(blob) {
    if (typeof ExcelJS === "undefined") return pvNote("تعذّر تحميل مكتبة Excel.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb.worksheets.slice(0, 3).map((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row, i) => {
        if (i > 300) return;
        const cells = [];
        for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
          const v = row.getCell(c).text;
          cells.push(`<td>${esc(v == null ? "" : String(v))}</td>`);
        }
        rows.push(`<tr>${cells.join("")}</tr>`);
      });
      return `<h4 style="margin:12px">${esc(ws.name)}</h4><table class="pv-sheet" dir="rtl">${rows.join("")}</table>`;
    }).join("") || pvNote("الملف فارغ.");
  }

  /* المحذوفات تبقى 30 يوماً قابلة للاسترجاع، ثم تُحذف نهائياً من السجل (الملف في Drive يبقى) */
  function purgeTrash() {
    const limit = Date.now() - TRASH_DAYS * 86400000;
    const old = records().filter((r) => r.deletedAt && Date.parse(r.deletedAt) < limit);
    if (!old.length) return;
    old.forEach((r) => { if (r.fileId) App.filesStore.remove(r.fileId).catch(() => {}); });
    const ids = new Set(old.map((r) => r.id));
    store.get().registry = records().filter((r) => !ids.has(r.id));
    store.save();
  }

  /* ===== المتابعة: وارد يحتاج معالجة قبل موعد ===== */
  const daysLeft = (due) => Math.round((Date.parse(due) - Date.parse(ui.todayISO())) / 86400000);
  function followUps() {
    return live().filter((r) => r.dueDate && !r.done)
      .map((r) => ({ rec: r, days: daysLeft(r.dueDate) }))
      .filter((x) => x.days <= 3)
      .sort((a, b) => a.days - b.days);
  }
  function dueBadge(r) {
    if (r.done) return r.dueDate || r.replyNumber ? `<span class="due-badge ok" title="${r.replyNumber ? `رُدّ عليه بالصادر ${esc(r.replyNumber)}` : "تمت المعالجة"}">✓ ${r.replyNumber ? "رُدّ عليه" : "تمت المعالجة"}</span>` : "";
    if (!r.dueDate) return "";
    const d = daysLeft(r.dueDate);
    if (d < 0) return `<span class="due-badge late">متأخر ${ui.fmt(-d)} يوم</span>`;
    if (d <= 3) return `<span class="due-badge soon">${d === 0 ? "مطلوب اليوم" : `خلال ${ui.fmt(d)} يوم`}</span>`;
    return `<span class="due-badge">حتى ${esc(ui.formatDate(r.dueDate))}</span>`;
  }

  /* للإحصاء في التقرير الدوري */
  function countInPeriod(from, to) {
    const inRange = (r) => (!from || r.date >= from) && (!to || r.date <= to);
    const list = live().filter(inRange);
    return { out: list.filter((r) => r.type === "out").length, in: list.filter((r) => r.type === "in").length };
  }

  /* ===== الواجهة ===== */
  const filter = { type: "all", q: "", year: "", cat: "", owner: "", track: "", trash: false, content: null };
  const selected = new Set();
  const catOptions = (selected, withAll) =>
    (withAll ? `<option value="">كل الأنواع</option>` : "") + CATEGORIES.map((c) => `<option ${c === selected ? "selected" : ""}>${c}</option>`).join("");

  function filtered() {
    const q = filter.q.trim();
    return records()
      .filter((r) => (filter.trash ? !!r.deletedAt : !r.deletedAt))
      .filter((r) => filter.type === "all" || r.type === filter.type)
      .filter((r) => !filter.track || (r.track || "") === filter.track)
      .filter((r) => !filter.year || String(r.date || "").startsWith(filter.year))
      .filter((r) => !filter.cat || categoryOf(r) === filter.cat)
      .filter((r) => !filter.owner || (r.owner || "") === (filter.owner === "__me" ? me() : filter.owner))
      .filter((r) => !q || textMatch(r, q) || inContent(r))
      .sort(compare);
  }

  const textMatch = (r, q) => [r.number, r.party, r.subject, r.notes, r.kind, r.fileName, r.owner, r.track, categoryOf(r)].some((f) => String(f || "").includes(q));
  const inContent = (r) => !!(filter.content && r.driveId && filter.content.ids.has(r.driveId));

  /* البحث داخل محتوى الملفات عبر فهرسة Drive على الخادم */
  let contentTimer = null;
  function searchContent() {
    clearTimeout(contentTimer);
    const q = filter.q.trim();
    filter.content = null;
    if (q.length < 3 || !App.cloud || !App.cloud.ready()) { $("reg-content-status").textContent = ""; return; }
    $("reg-content-status").textContent = "…يبحث داخل محتوى الملفات";
    contentTimer = setTimeout(async () => {
      try {
        const ids = await App.cloud.search(q);
        if (filter.q.trim() !== q) return;
        filter.content = { q, ids: new Set(ids) };
        const extra = live().filter((r) => inContent(r) && !textMatch(r, q)).length;
        $("reg-content-status").textContent = extra ? `+ ${ui.fmt(extra)} في محتوى الملفات` : "لا نتائج إضافية داخل الملفات";
        render();
      } catch (e) { $("reg-content-status").textContent = ""; }
    }, 700);
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
    owner: { key: (r) => r.owner || "—", label: (k) => (k === "—" ? "👤 بدون مستخدم" : `👤 ${k}`), order: (a, b) => (a === me() ? -1 : b === me() ? 1 : a.localeCompare(b, "ar")) },
    track: { key: (r) => r.track || "—", label: (k) => (k === "—" ? "🎓 بدون مسار" : `🎓 ${k}`), order: (a, b) => (a === "—" ? 1 : b === "—" ? -1 : a.localeCompare(b, "ar")) },
    initial: { key: (r) => (displayName(r).trim()[0] || "—").toUpperCase(), label: (k) => `🔤 ${k}`, order: (a, b) => a.localeCompare(b, "ar") },
  };

  function rowHtml(r) {
    return `
      <tr data-id="${r.id}" class="${selected.has(r.id) ? "selected" : ""}">
        <td class="reg-sel">${r.fileId ? `<input type="checkbox" data-sel ${selected.has(r.id) ? "checked" : ""} aria-label="تحديد">` : ""}</td>
        <td><span class="badge ${r.type === "out" ? "digital" : "craft"}">${TYPE_LABEL[r.type]}</span></td>
        <td class="reg-num">${esc(r.number)}</td>
        <td class="nowrap">${esc(ui.formatDate(r.date))}</td>
        <td>${esc(r.party || "")}</td>
        <td>${esc(r.subject || "")}<div class="reg-kind">${esc(categoryOf(r))}${r.kind && r.kind !== categoryOf(r) ? ` · ${esc(r.kind)}` : ""}${r.track ? ` · 🎓 ${esc(r.track)}` : ""}</div>${r.type === "in" ? dueBadge(r) : ""}${r.summary ? `<details class="reg-summary"><summary>✨ الملخص</summary>${esc(r.summary)}</details>` : ""}${filter.content && inContent(r) && !textMatch(r, filter.content.q) ? `<span class="due-badge">📄 في المحتوى</span>` : ""}</td>
        <td class="reg-file">${fileCell(r)}</td>
        <td class="nowrap">${r.fileId && r.fileDate ? esc(ui.formatDate(r.fileDate)) : "—"}</td>
        <td>${folderCell(r)}</td>
        <td class="reg-actions">${actionsHtml(r)}</td>
      </tr>`;
  }

  function actionsHtml(r) {
    const mod = canModify(r);
    if (r.deletedAt) {
      return `<span class="reg-kind">حُذف ${esc(ui.formatDate(r.deletedAt.slice(0, 10)))}${r.deletedBy ? ` · ${esc(r.deletedBy)}` : ""}</span><br>`
        + (mod ? `<button class="act-btn edit" data-restore>↺ استرجاع</button>` : "")
        + (App.profile && App.profile.isAdmin() ? ` <button class="act-btn del" data-purge>✖ حذف نهائي</button>` : "");
    }
    const mayDelete = !App.profile.can || App.profile.can("delete");
    return (r.fileId ? `<button class="act-btn dl" data-download title="تحميل الملف إلى الجهاز">⬇ تحميل</button>` : "")
      + (r.type === "in" ? ` <button class="act-btn reply" data-reply title="إنشاء خطاب رد في المراسلات">↩ رد</button>` : "")
      + (r.type === "in" && App.ai && App.ai.hasKey() && (!App.profile.can || App.profile.can("ai")) ? ` <button class="act-btn ai" data-summarize title="تلخيص الخطاب بالذكاء الاصطناعي">✨ تلخيص</button>` : "")
      + (mod ? ` <button class="act-btn edit" data-edit title="تعديل القيد">✎ تعديل</button>${mayDelete ? ` <button class="act-btn del" data-del title="نقل إلى المحذوفات">🗑 حذف</button>` : ""}`
        : ` <span class="reg-kind" title="التعديل لصاحب القيد أو المدير">🔒</span>`);
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
      return `<tr class="reg-group" data-group="${esc(id)}"><td colspan="10"><span class="reg-caret">${closed ? "◂" : "▾"}</span> ${esc(g.label(k))} <span class="reg-group-count">${ui.fmt(items.length)}</span></td></tr>`
        + (closed ? "" : items.map(rowHtml).join(""));
    }).join("");
  }

  /* خلية المجلد: المسار الفعلي بعد الرفع (مع رابط للمجلد)، أو المسار المتوقّع قبل الرفع */
  function folderCell(r) {
    if (!r.fileId) return "—";
    if (r.driveLink) {
      const path = r.drivePath || [DIR_FOLDER[r.type], String(r.date).slice(0, 4), String(r.date).slice(5, 7)]; // أرشفة سابقة بالترتيب القديم
      const text = esc(pathText(path));
      // معرّف مجلد Drive وحده يُفتح في Drive؛ الملفات على خادم آخر تُعرض بمسارها فقط
      return /^[\w-]{20,}$/.test(r.driveFolderId || "") ? `<a class="conv-link reg-path" href="${esc(App.drive.folderLink(r.driveFolderId))}" target="_blank" rel="noopener" title="فتح المجلد في Google Drive">📁 ${text}</a>` : `<span class="reg-path">📁 ${text}</span>`;
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
      ? (/^https?:/.test(r.driveLink) ? `<a class="conv-link" href="${esc(r.driveLink)}" target="_blank" rel="noopener" title="فتح في Google Drive">☁ Drive</a>` : "")
      : App.cloud && App.cloud.ready() ? `<span class="reg-pending" title="الملف على جهاز من رفعه ولم يصل إلى أرشيف المركز بعد">⏳ بانتظار الرفع</span>`
      : App.drive && App.drive.isConfigured() ? `<button class="conv-link" data-archive title="${r.drivePending ? "بانتظار الأرشفة" : "أرشفة في Google Drive"}">${r.drivePending ? "⏳" : "☁"} أرشفة</button>` : "";
    return `<div class="reg-fname" title="${esc(r.fileName || "")}">${nameHtml(r.fileName)}</div>${r.owner ? `<div class="reg-owner">👤 ${esc(r.owner)}</div>` : ""}
      <div class="reg-file-btns"><button class="conv-link" data-open title="عرض الملف">📎 عرض</button> ${drive}</div>`;
  }

  function render() {
    const all = records();
    const years = [...new Set(all.map((r) => String(r.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    $("reg-year").innerHTML = `<option value="">كل السنوات</option>` + years.map((y) => `<option ${y === filter.year ? "selected" : ""}>${y}</option>`).join("");
    $("reg-cat").innerHTML = catOptions(filter.cat, true);
    const owners = [...new Set(all.map((r) => r.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
    const mine = me();
    $("reg-owner").innerHTML = `<option value="">كل المستخدمين</option>`
      + (mine ? `<option value="__me" ${filter.owner === "__me" ? "selected" : ""}>ملفاتي (${esc(mine)})</option>` : "")
      + owners.filter((o) => o !== mine).map((o) => `<option value="${esc(o)}" ${filter.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("");
    $("reg-track-filter").innerHTML = trackOptions(filter.track, "كل المسارات");
    const trashCount = all.filter((r) => r.deletedAt).length;
    $("reg-trash").textContent = filter.trash ? "↩ العودة إلى السجل" : `🗑 المحذوفات${trashCount ? ` (${ui.fmt(trashCount)})` : ""}`;
    $("reg-trash").classList.toggle("active", filter.trash);
    $("reg-trash-note").hidden = !filter.trash;
    document.querySelectorAll("[data-reg-type]").forEach((b) => b.classList.toggle("active", b.dataset.regType === filter.type));
    const alive = all.filter((r) => !r.deletedAt);
    const fu = followUps();
    $("reg-counts").textContent = `${ui.fmt(alive.filter((r) => r.type === "out").length)} صادر · ${ui.fmt(alive.filter((r) => r.type === "in").length)} وارد${fu.length ? ` · ${ui.fmt(fu.length)} بحاجة متابعة` : ""}`;
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
    [...selected].forEach((id) => { const r = records().find((x) => x.id === id); if (!r || r.deletedAt) selected.delete(id); });
    $("reg-body").innerHTML = list.length ? bodyHtml(list)
      : `<tr><td colspan="10" class="empty">${filter.trash ? "سلة المحذوفات فارغة." : `لا توجد قيود${filter.q || filter.type !== "all" || filter.year || filter.cat || filter.owner || filter.track ? " مطابقة" : " بعد. الخطابات المصدَّرة من «المراسلات» تُسجَّل هنا تلقائياً، أو ارفع ملفاتك من «رفع ملفات»"}.`}</td></tr>`;
    renderSelection();
    if ($("reg-stats").open) renderStats();
  }

  /* ===== قراءة خطاب ممسوح ضوئياً (OCR) وتعبئة الحقول منه ===== */
  const AR_DIGITS = /[٠-٩]/g;
  const toEn = (t) => String(t).replace(AR_DIGITS, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));

  /* استخراج الرقم والتاريخ والموضوع والجهة من نص الخطاب سطراً سطراً */
  const ORG = /(وزارة|مؤسسة|جمعية|شركة|مركز|هيئة|مديرية|إدارة|مكتب|بلدية|جامعة|كلية|مدرسة|مستشفى|نقابة)/;

  function parseLetter(raw) {
    const lines = toEn(raw).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
    const out = {};
    const find = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m; } return null; };

    let m = find(/(?:الرقم|رقم\s*(?:الكتاب|الخطاب|الصادر|الإشارة)?)\s*[:：]\s*(\S+)/);
    if (m) out.number = m[1].replace(/[.،؛]$/, "");
    m = find(/(?:التاريخ|بتاريخ)\s*[:：]?\s*(\d{1,4}[-\/.]\d{1,2}[-\/.]\d{2,4})/) || find(/(\d{1,4}[-\/.]\d{1,2}[-\/.]\d{2,4})/);
    if (m) out.date = dateFromText(m[1]) || "";
    m = find(/الموضوع\s*[:：]?\s*(.{3,120})/);
    if (m) out.subject = m[1].trim().replace(/[.،]$/, "");
    const org = lines.slice(0, 10).find((l) => ORG.test(l) && l.length < 80);
    if (org) out.party = org.replace(/[:：].*$/, "").trim();
    if (!out.subject) {
      const line = lines.find((l) => l.length > 15 && !ORG.test(l) && !/^(بسم|الحمد|السلام|المكرم|سعادة|تحية|الرقم|التاريخ)/.test(l));
      if (line) out.subject = line.slice(0, 100);
    }
    return out;
  }

  async function readScan() {
    const file = $("reg-file").files[0] || (editingId && (await getFile(records().find((r) => r.id === editingId)).catch(() => null)) || {}).blob;
    if (!file) { ui.toast("اختر ملف الخطاب الممسوح أولاً"); return; }
    if (!App.cloud || !App.cloud.ready()) { ui.toast("القراءة تحتاج الاتصال بأرشيف المركز"); return; }
    const btn = $("reg-ocr");
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "جارٍ القراءة…";
    try {
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1]);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const { text } = await App.cloud.ocr(data, file.type || "application/pdf", file.name || "scan");
      if (!String(text || "").trim()) { ui.toast("لم يُقرأ نص من الملف؛ تأكد من وضوح المسح"); return; }
      const f = parseLetter(text);
      const filled = [];
      if (f.number && !$("reg-number").value.trim()) { $("reg-number").value = f.number; filled.push("الرقم"); }
      if (f.date) { $("reg-date").value = f.date; filled.push("التاريخ"); }
      if (f.party && !$("reg-party").value.trim()) { $("reg-party").value = f.party; filled.push("الجهة"); }
      if (f.subject && !$("reg-subject").value.trim()) { $("reg-subject").value = f.subject; filled.push("الموضوع"); }
      $("reg-notes").value = ($("reg-notes").value ? $("reg-notes").value + "\n" : "") + "— نص الخطاب المقروء آلياً —\n" + String(text).trim().slice(0, 1500);
      syncNumberHint();
      ui.toast(filled.length ? `قُرئ الخطاب وعُبِّئ: ${filled.join("، ")}` : "قُرئ النص وأُضيف إلى الملاحظات");
    } catch (e) {
      ui.toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ===== نموذج الإضافة والتعديل ===== */
  let editingId = null;

  function openForm(rec) {
    editingId = rec ? rec.id : null;
    $("reg-modal-title").textContent = rec ? "تعديل قيد" : "قيد جديد";
    $("reg-type").value = rec ? rec.type : "in";
    $("reg-date").value = rec ? rec.date : ui.todayISO();
    $("reg-category").innerHTML = catOptions(rec ? categoryOf(rec) : "خطابات");
    $("reg-track").innerHTML = trackOptions(rec ? rec.track || "" : "");
    $("reg-due").value = rec ? rec.dueDate || "" : "";
    $("reg-done").checked = !!(rec && rec.done);
    syncFollowUp();
    $("reg-number").value = rec ? rec.number : "";
    $("reg-party").value = rec ? rec.party || "" : "";
    $("reg-subject").value = rec ? rec.subject || "" : "";
    $("reg-notes").value = rec ? rec.notes || "" : "";
    $("reg-file").value = "";
    syncOcrButton();
    $("reg-file-current").textContent = rec && rec.fileId ? `المرفق الحالي: ${rec.fileName}` : "";
    syncNumberHint();
    $("reg-modal").classList.add("open");
    $("reg-party").focus();
  }
  const closeForm = () => $("reg-modal").classList.remove("open");

  /* زر القراءة يظهر لملفات الصور و PDF فقط */
  function syncOcrButton() {
    const f = $("reg-file").files[0];
    const rec = editingId && records().find((r) => r.id === editingId);
    const name = (f && f.name) || (rec && rec.fileName) || "";
    const scan = /\.(pdf|jpe?g|png|tiff?|webp|heic)$/i.test(name);
    $("reg-ocr").hidden = !scan || !(App.cloud && App.cloud.ready());
  }

  function syncFollowUp() { $("reg-follow").hidden = $("reg-type").value !== "in"; }

  function syncNumberHint() {
    $("reg-number").placeholder = `تلقائي: ${nextNumber($("reg-type").value, $("reg-date").value)}`;
  }

  async function saveForm(e) {
    e.preventDefault();
    const type = $("reg-type").value;
    const date = $("reg-date").value || ui.todayISO();
    let rec = editingId && records().find((r) => r.id === editingId);
    if (rec && !canModify(rec)) { ui.toast("التعديل لصاحب القيد أو المدير فقط"); return; }
    const typed = $("reg-number").value.trim();
    const dup = typed && records().find((r) => r.type === type && r.number === typed && r.id !== editingId && !r.deletedAt);
    if (dup) { ui.toast(`الرقم ${typed} مسجّل مسبقاً في ${TYPE_LABEL[type]}`); return; }
    const number = typed || (await assignNumber(type, date));

    if (!rec) {
      rec = { id: store.uid(), owner: me(), createdAt: nowISO() };
      records().push(rec);
      logAction(rec, "إنشاء قيد");
    } else logAction(rec, "تعديل");
    const moved = rec.driveLink && pathText(archivePath(rec)) !== pathText(archivePath({ type, date, category: $("reg-category").value }));
    Object.assign(rec, { type, date, number, category: $("reg-category").value, track: $("reg-track").value, party: $("reg-party").value.trim(), subject: $("reg-subject").value.trim(), notes: $("reg-notes").value.trim() });
    if (type === "in") Object.assign(rec, { dueDate: $("reg-due").value || null, done: $("reg-done").checked });
    const file = $("reg-file").files[0];
    if (file) { await attachFile(rec, file, file.name, localISO(new Date(file.lastModified))); logAction(rec, `إرفاق ملف: ${file.name}`); }
    store.save();
    closeForm();
    render();
    if (file) autoArchive(rec);
    ui.toast(`تم حفظ القيد ${number}${moved && !file ? " — الملف في Drive باقٍ في مجلده السابق" : ""}`);
  }

  function deleteRecord(id) {
    const rec = records().find((r) => r.id === id);
    if (!rec) return;
    if (!canModify(rec)) { ui.toast("الحذف لصاحب القيد أو المدير فقط"); return; }
    if (!confirm(`نقل القيد ${rec.number} (${TYPE_LABEL[rec.type]}) إلى المحذوفات؟\nيمكن استرجاعه خلال ${TRASH_DAYS} يوماً.`)) return;
    Object.assign(rec, { deletedAt: nowISO(), deletedBy: me() || "—" });
    logAction(rec, "حذف (إلى المحذوفات)");
    selected.delete(id);
    store.save();
    render();
    ui.toast("نُقل القيد إلى المحذوفات");
  }

  function restoreRecord(rec) {
    if (!canModify(rec)) { ui.toast("الاسترجاع لصاحب القيد أو المدير فقط"); return; }
    Object.assign(rec, { deletedAt: null, deletedBy: null });
    logAction(rec, "استرجاع من المحذوفات");
    store.save();
    render();
    ui.toast(`استُرجع القيد ${rec.number}`);
  }

  async function purgeRecord(rec) {
    if (!App.profile.isAdmin()) return;
    if (!confirm(`حذف القيد ${rec.number} نهائياً من السجل؟ لا يمكن التراجع.${rec.driveLink ? "\nالملف في Drive المركز يبقى في مجلده." : ""}`)) return;
    if (rec.fileId) await App.filesStore.remove(rec.fileId).catch(() => {});
    store.get().registry = records().filter((r) => r.id !== rec.id);
    store.save();
    render();
    ui.toast("حُذف القيد نهائياً");
  }

  /* ===== الرد على وارد: خطاب جاهز في المراسلات مربوط برقم الوارد ===== */
  function replyTo(rec) {
    if (!App.letters || !App.letters.startReply) return;
    App.letters.startReply(rec);
  }

  /* ===== التحديد وتحميل عدة ملفات في ملف مضغوط ===== */
  function renderSelection() {
    const n = selected.size;
    $("reg-sel-bar").hidden = !n;
    $("reg-sel-count").textContent = `${ui.fmt(n)} ملف محدد`;
    const boxes = [...document.querySelectorAll("#reg-body [data-sel]")];
    $("reg-sel-all").checked = boxes.length > 0 && boxes.every((b) => b.checked);
    $("reg-sel-all").indeterminate = !$("reg-sel-all").checked && boxes.some((b) => b.checked);
  }

  async function downloadSelected() {
    if (typeof JSZip === "undefined") { ui.toast("تعذّر تحميل مكتبة الضغط"); return; }
    const recs = [...selected].map((id) => records().find((r) => r.id === id)).filter(Boolean);
    const zip = new JSZip();
    const used = new Set();
    let ok = 0;
    $("reg-sel-download").disabled = true;
    for (let i = 0; i < recs.length; i++) {
      $("reg-sel-count").textContent = `تجهيز ${ui.fmt(i + 1)} من ${ui.fmt(recs.length)}…`;
      try {
        const f = await getFile(recs[i]);
        if (!f) continue;
        let name = f.name || recs[i].fileName || "ملف";
        for (let k = 2; used.has(name); k++) name = name.replace(/(\.[^.]+)?$/, (ext) => ` (${k})${ext}`);
        used.add(name);
        zip.file(name, f.blob);
        ok++;
      } catch (e) { console.warn(e.message); }
    }
    $("reg-sel-download").disabled = false;
    renderSelection();
    if (!ok) { ui.toast("تعذّر جلب الملفات المحددة"); return; }
    ui.download(`ملفات الأرشيف - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
    ui.toast(ok === recs.length ? `حُمّل ${ui.fmt(ok)} ملفاً` : `حُمّل ${ui.fmt(ok)} من ${ui.fmt(recs.length)}؛ بعضها لم يصل إلى الأرشيف بعد`);
  }

  /* ===== تلخيص الوارد واقتراح الرد بالذكاء الاصطناعي ===== */
  async function letterText(rec) {
    const notes = String(rec.notes || "");
    const marker = notes.indexOf("— نص الخطاب المقروء آلياً —");
    if (marker >= 0) return notes.slice(marker);
    if (notes.trim()) return notes;
    // بلا نص محفوظ: يُقرأ الملف إن كان Word، وإلا يُطلب تشغيل القراءة الضوئية
    const f = await getFile(rec).catch(() => null);
    if (f && /\.docx$/i.test(f.name || "")) {
      const zip = await JSZip.loadAsync(f.blob);
      const xml = await zip.file("word/document.xml").async("string");
      return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").slice(0, 8000);
    }
    return "";
  }

  async function summarize(rec) {
    if (!App.ai.hasKey()) { ui.toast("أضف مفتاح الذكاء الاصطناعي من صفحة المراسلات ← إعدادات"); return; }
    ui.toast("جارٍ التلخيص…");
    try {
      const text = await letterText(rec);
      if (!text.trim()) { ui.toast("لا يوجد نص للخطاب؛ استخدم «📷 قراءة الخطاب الممسوح» أولاً"); return; }
      let outText = "";
      await App.ai.generate({
        request: "لخّص هذا الخطاب الوارد في ثلاث نقاط قصيرة بالعربية الفصحى: موضوعه، والمطلوب منا، والموعد إن وُجد. بلا مقدمات.",
        context: `الجهة: ${rec.party || "—"}\nالرقم: ${rec.number}\nالتاريخ: ${rec.date}\n\n${text.slice(0, 8000)}`,
        onText: (t) => { outText += t; },
      });
      if (!outText.trim()) { ui.toast("لم يصل رد من الخدمة"); return; }
      rec.summary = outText.trim().slice(0, 1200);
      logAction(rec, "تلخيص آلي");
      store.save();
      render();
      ui.toast("تم التلخيص");
    } catch (e) { ui.toast(e.message); }
  }

  /* ===== سجل النشاط ===== */
  function openActivity() {
    const items = [];
    records().forEach((r) => (r.history || []).forEach((h) => items.push(Object.assign({ rec: r }, h))));
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const who = $("act-user").value;
    const users = [...new Set(items.map((x) => x.by))].sort((a, b) => a.localeCompare(b, "ar"));
    $("act-user").innerHTML = `<option value="">كل المستخدمين</option>` + users.map((u) => `<option ${u === who ? "selected" : ""}>${esc(u)}</option>`).join("");
    const list = items.filter((x) => !who || x.by === who).slice(0, 400);
    $("act-list").innerHTML = list.length ? list.map((x) => `<li>
        <span class="act-when">${esc(ui.formatDate(String(x.at).slice(0, 10)))} ${esc(new Date(x.at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }))}</span>
        <b>${esc(x.by)}</b> — ${esc(x.action)}
        <span class="reg-kind">${esc(TYPE_LABEL[x.rec.type] || "")} ${esc(x.rec.number)}${x.rec.subject ? ` · ${esc(x.rec.subject)}` : ""}</span>
      </li>`).join("") : `<li class="empty">لا يوجد نشاط مسجّل بعد.</li>`;
    $("act-modal").classList.add("open");
  }

  /* ===== إحصاءات الأرشيف ===== */
  function countBy(list, key) {
    const m = new Map();
    list.forEach((r) => { const k = key(r); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  function statsCharts(list) {
    const chart = (title, pairs) => {
      const top = pairs.slice(0, 10);
      return top.length ? App.charts.horizontalBars({ title, labels: top.map((p) => p[0]), values: top.map((p) => p[1]), max: Math.max(...top.map((p) => p[1])), unit: "" }) : null;
    };
    const months = countBy(list, (r) => String(r.date || "").slice(0, 7)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).reverse()
      .map(([k, v]) => [`${k.slice(5, 7)}/${k.slice(0, 4)}`, v]);
    return [
      chart("الملفات حسب نوع المستند", countBy(list, categoryOf)),
      chart("الملفات حسب المستخدم", countBy(list, (r) => r.owner || "بدون مستخدم")),
      chart("الملفات حسب المسار التدريبي", countBy(list.filter((r) => r.track), (r) => r.track)),
      chart("القيود في آخر 6 أشهر", months),
    ].filter(Boolean);
  }
  function renderStats() {
    const list = live();
    const withFile = list.filter((r) => r.fileId).length;
    const fu = followUps();
    $("reg-stats-kpis").innerHTML = `
      <div class="stat"><div class="label">إجمالي القيود</div><div class="value">${ui.fmt(list.length)}</div><div class="sub">${ui.fmt(list.filter((r) => r.type === "in").length)} وارد · ${ui.fmt(list.filter((r) => r.type === "out").length)} صادر</div></div>
      <div class="stat"><div class="label">ملفات في الأرشيف</div><div class="value">${ui.fmt(list.filter((r) => r.driveLink).length)}</div><div class="sub">من ${ui.fmt(withFile)} ملفاً مرفقاً</div></div>
      <div class="stat"><div class="label">المستخدمون</div><div class="value">${ui.fmt(new Set(list.map((r) => r.owner).filter(Boolean)).size)}</div><div class="sub">رفعوا ملفات إلى الأرشيف</div></div>
      <div class="stat"><div class="label">بحاجة متابعة</div><div class="value">${ui.fmt(fu.length)}</div><div class="sub">${ui.fmt(fu.filter((x) => x.days < 0).length)} متأخر</div></div>`;
    $("reg-stats-charts").innerHTML = statsCharts(list).map((c) => `<img src="${c.src}" alt="">`).join("");
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
      owner: me(),
      type: shared.type,
      category: guessCategoryFor(file),
      date: guessDateFor(file),
      track: guessTrack(`${folderOf(file)} ${file.name}`),
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
      <td><select data-k="category">${catOptions(it.category)}</select><select data-k="track" class="bulk-track" title="المسار التدريبي">${trackOptions(it.track)}</select></td>
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
    // كل ملف يُسجَّل باسم صاحبه ويُحفظ في مجلده
    const owner = await App.profile.ensure();
    if (!owner) { ui.toast("أنشئ ملفك الشخصي أولاً"); return; }
    bulk.forEach((it) => { it.owner = owner; });

    setBulkBusy(true);
    const created = [];
    try {
      // بالترتيب الزمني حتى تتسلسل الأرقام التلقائية مع التواريخ، والأرقام محجوزة من الخادم دفعة واحدة
      const ordered = bulk.slice().sort((a, b) => a.date.localeCompare(b.date));
      $("bulk-progress").textContent = "حجز الأرقام…";
      const pools = new Map();
      ordered.filter((it) => !it.number.trim()).forEach((it) => {
        const head = headOf(it.type, it.date || ui.todayISO());
        if (!pools.has(head)) pools.set(head, { type: it.type, date: it.date || ui.todayISO(), count: 0, list: [] });
        pools.get(head).count++;
      });
      for (const p of pools.values()) p.list = await assignNumbers(p.type, p.date, p.count);
      for (let i = 0; i < ordered.length; i++) {
        const it = ordered[i];
        $("bulk-progress").textContent = `حفظ ${ui.fmt(i + 1)} من ${ui.fmt(ordered.length)}…`;
        const date = it.date || ui.todayISO();
        const rec = {
          id: store.uid(), createdAt: new Date().toISOString(), source: "upload", owner,
          type: it.type, date, number: it.number.trim() || pools.get(headOf(it.type, date)).list.shift(),
          category: it.category, track: it.track || "", party: it.party.trim(), subject: it.subject.trim(), notes: "",
        };
        logAction(rec, `رفع ملف: ${it.file.name}`);
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
    $("reg-camera").addEventListener("click", () => $("reg-camera-input").click());
    $("reg-camera-input").addEventListener("change", (e) => {
      const files = [...e.target.files].map((f, i) => {
        // اسم واضح للصورة الملتقطة: تاريخ اليوم ورقم اللقطة
        const name = /^image|^photo|\.jpe?g$/i.test(f.name) ? `خطاب وارد ${ui.todayISO()}${i ? ` (${i + 1})` : ""}.jpg` : f.name;
        return new File([f], name, { type: f.type, lastModified: f.lastModified });
      });
      addBulkFiles(files);
      e.target.value = "";
    });
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
      { header: "اسم الملف", key: "fileName", width: 30 }, { header: "المستخدم", key: "owner", width: 18 }, { header: "تاريخ الملف", key: "fileDate", width: 13 },
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
    $("reg-search").addEventListener("input", (e) => { filter.q = e.target.value; render(); searchContent(); });
    $("reg-year").addEventListener("change", (e) => { filter.year = e.target.value; render(); });
    $("reg-cat").addEventListener("change", (e) => { filter.cat = e.target.value; render(); });
    $("reg-owner").addEventListener("change", (e) => { filter.owner = e.target.value; render(); });
    $("reg-track-filter").addEventListener("change", (e) => { filter.track = e.target.value; render(); });
    $("reg-trash").addEventListener("click", () => { filter.trash = !filter.trash; selected.clear(); render(); });
    $("reg-activity").addEventListener("click", openActivity);
    $("act-user").addEventListener("change", openActivity);
    $("act-close").addEventListener("click", () => $("act-modal").classList.remove("open"));
    $("act-modal").addEventListener("click", (e) => { if (e.target.id === "act-modal") $("act-modal").classList.remove("open"); });
    $("reg-stats").addEventListener("toggle", () => { if ($("reg-stats").open) renderStats(); });
    $("reg-sel-all").addEventListener("change", (e) => {
      document.querySelectorAll("#reg-body tr[data-id]").forEach((tr) => {
        if (!tr.querySelector("[data-sel]")) return;
        if (e.target.checked) selected.add(tr.dataset.id); else selected.delete(tr.dataset.id);
      });
      render();
    });
    $("reg-sel-download").addEventListener("click", downloadSelected);
    $("pv-close").addEventListener("click", closePreview);
    $("pv-modal").addEventListener("click", (e) => { if (e.target.id === "pv-modal") closePreview(); });
    $("pv-download").addEventListener("click", () => { if (pvFile) ui.download(pvFile.name, pvFile.blob); });
    $("reg-sel-clear").addEventListener("click", () => { selected.clear(); render(); });
    $("reg-type").addEventListener("change", syncFollowUp);
    $("reg-file").addEventListener("change", syncOcrButton);
    $("reg-ocr").addEventListener("click", readScan);
    if (App.profile) App.profile.onChange(() => { if ($("view-registry").classList.contains("active")) render(); });
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
      if (e.target.closest("[data-sel]")) {
        if (e.target.checked) selected.add(rec.id); else selected.delete(rec.id);
        tr.classList.toggle("selected", e.target.checked);
        renderSelection();
        return;
      }
      if (e.target.closest("[data-restore]")) { restoreRecord(rec); return; }
      if (e.target.closest("[data-purge]")) { purgeRecord(rec); return; }
      if (e.target.closest("[data-reply]")) { replyTo(rec); return; }
      if (e.target.closest("[data-summarize]")) { summarize(rec); return; }
      if (e.target.closest("[data-open]")) openFile(rec, "view");
      else if (e.target.closest("[data-download]")) openFile(rec, "download");
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeForm(); closeBulk(); closePreview(); $("act-modal").classList.remove("open"); } });
    initBulk();
  }

  App.registry = { fileOf: getFile, assignNumber, assignNumbers, followUps, statsCharts, live, logAction, syncShared, init, render, nextOutgoingNumber, upsertOutgoing, countInPeriod, guessCategory, guessDate };
})(window.App = window.App || {});
