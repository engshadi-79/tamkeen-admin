/* إضافات تاب «النماذج الجاهزة» لملفات الزملاء، في ملف مستقل لا يعدّل forms.js:
   - حذف عدة ملفات دفعة واحدة (تحديد ثم «حذف المحدد»)
   - معاينة PDF والصور والنصوص داخل الصفحة
   - مؤشر «جديد» على تاب كل شخص حين يصل ملف لم تره
   - بحث موحّد: كلمة في مربع البحث تُظهر الملفات المطابقة من ملفات الزملاء أيضاً
   تعمل بعد رسم الصفحة (تراقب التغيّر) وبقائمتها الخاصة من الخادم، ولا تعتمد على داخل forms.js. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const KEY_LS = "tamkeen:drop-key";
  const SEEN_LS = "tamkeen:drop-seen";
  const MANIFEST = "tamkeen-original-dates.v1.json";
  const POLL_MS = 120000;

  const st = { files: [], at: 0, busy: false, sel: new Set(), seen: null, timer: null };
  const key = () => { try { return localStorage.getItem(KEY_LS) || ""; } catch (e) { return ""; } };
  const url = () => (App.cloud && App.cloud.oldUrl) || "";
  const who = (f) => f.by || "بلا اسم";
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " م.ب" : Math.max(1, Math.round(n / 1024)) + " ك.ب");
  const previewable = (n) => /\.(pdf|png|jpe?g|webp|gif|txt|csv|md)$/i.test(n || "");

  async function call(action, extra) {
    const r = await fetch(url(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action, key: key() }, extra || {})) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }

  /* ===== الذاكرة المشتركة للقائمة (مرة كل دقيقتين كحدّ أقصى ما لم يُطلب التحديث) ===== */
  async function fresh(force) {
    if (!key() || !url() || st.busy) return st.files;
    if (!force && Date.now() - st.at < POLL_MS - 5000) return st.files;
    st.busy = true;
    try { st.files = ((await call("dropList")).files || []).filter((f) => f.name !== MANIFEST); st.at = Date.now(); } catch (e) { /* يبقى ما في الذاكرة */ }
    st.busy = false;
    return st.files;
  }

  /* ===== «جديد»: آخر ما رأيتَه لكل شخص ===== */
  const loadSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_LS) || "null"); } catch (e) { return null; } };
  const saveSeen = () => { try { localStorage.setItem(SEEN_LS, JSON.stringify(st.seen)); } catch (e) { /* ممتلئ */ } };
  const newest = (list) => list.reduce((m, f) => (f.at > m ? f.at : m), "");
  function ensureSeen() {
    if (st.seen) return;
    st.seen = loadSeen();
    if (!st.seen) {                          // أول مرة: كل الموجود يُعدّ مقروءاً حتى لا تظهر مئات العلامات
      st.seen = {};
      st.files.forEach((f) => { if (!st.seen[who(f)] || st.seen[who(f)] < f.at) st.seen[who(f)] = f.at; });
      if (st.files.length) saveSeen(); else st.seen = null;
    }
  }
  const newCount = (name) => (st.seen ? st.files.filter((f) => who(f) === name && f.at > (st.seen[name] || "")).length : 0);
  function markSeen(name) {
    if (!st.seen) return;
    const top = newest(st.files.filter((f) => who(f) === name));
    if (top && top > (st.seen[name] || "")) { st.seen[name] = top; saveSeen(); }
  }

  /* ===== التزيين بعد كل رسم ===== */
  let busyDeco = false;
  function decorate() {
    if (busyDeco) return;
    busyDeco = true;
    try {
      const view = $("view-forms");
      if (!view || !view.classList.contains("active")) return;
      ensureSeen();
      const personBtn = document.querySelector("#frm-cats .frm-person.on");
      const personName = personBtn ? (personBtn.dataset.frmCat || "").replace(/^by:/, "") : "";
      if (personName) markSeen(personName);

      document.querySelectorAll("#frm-cats .frm-person").forEach((b) => {
        const name = (b.dataset.frmCat || "").replace(/^by:/, "");
        const n = b.classList.contains("on") ? 0 : newCount(name);
        let tag = b.querySelector(".fx-new");
        if (!n) { if (tag) tag.remove(); return; }
        if (!tag) { tag = document.createElement("i"); tag.className = "fx-new"; b.appendChild(tag); }
        if (tag.textContent !== "جديد " + n) tag.textContent = "جديد " + n;
      });

      const bar = document.querySelector("#frm-body .frm-personbar");
      const cards = [...document.querySelectorAll("#frm-body .frm-card.frm-mine")].filter((c) => c.querySelector('[data-drop="get"]'));
      cards.forEach((c) => {
        const id = c.querySelector('[data-drop="get"]').dataset.id;
        if (!c.querySelector(".fx-sel")) {
          const l = document.createElement("label");
          l.className = "fx-sel no-print"; l.title = "تحديد للحذف";
          l.innerHTML = `<input type="checkbox" data-fx-sel="${esc(id)}" aria-label="تحديد الملف">`;
          c.insertBefore(l, c.firstChild);
        }
        const cb = c.querySelector("[data-fx-sel]");
        cb.checked = st.sel.has(id);
        c.classList.toggle("fx-picked", cb.checked);
        const f = st.files.find((x) => x.id === id);
        if (f && previewable(f.name) && !c.querySelector('[data-fx="preview"]')) {
          const act = c.querySelector(".frm-act");
          const b = document.createElement("button");
          b.type = "button"; b.className = "btn secondary"; b.dataset.fx = "preview"; b.dataset.id = id;
          b.innerHTML = '<span class="material-symbols-outlined btn-ico">visibility</span>معاينة';
          act.insertBefore(b, act.children[1] || null);
        }
        if (f && who(f) && st.seen && f.at > (st.seen[who(f)] || "") && !c.querySelector(".fx-badge")) { /* العلامة على التاب تكفي */ }
      });

      if (bar && personName) latestStrip(bar, personName);
      if (bar && cards.length) {
        let tb = document.querySelector("#frm-body .fx-bulk");
        if (!tb) {
          tb = document.createElement("div");
          tb.className = "fx-bulk no-print";
          (document.querySelector("#frm-body .fx-latest") || bar).insertAdjacentElement("afterend", tb);
        }
        const ids = cards.map((c) => c.querySelector('[data-drop="get"]').dataset.id);
        const picked = ids.filter((i) => st.sel.has(i)).length;
        const html = `<label><input type="checkbox" data-fx="all" ${picked === ids.length ? "checked" : ""}> تحديد الكل (${ids.length})</label>` +
          `<button type="button" class="btn secondary frm-danger" data-fx="bulkdel" ${picked ? "" : "disabled"}><span class="material-symbols-outlined btn-ico">delete</span>حذف المحدد (${picked})</button>`;
        if (tb.dataset.sig !== html) { tb.dataset.sig = html; tb.innerHTML = html; }
      }

      unifiedSearch();
    } finally { busyDeco = false; }
  }

  /* ===== «آخر ما أُضيف»: أحدث ما رُفع لهذا الشخص في أعلى صفحته مهما كان تصنيفه ===== */
  const whenLabel = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const t = d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? "اليوم " + t : d.toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" }) + " " + t;
  };
  function latestStrip(bar, name) {
    const mine = st.files.filter((f) => who(f) === name).sort((a, b) => ((b.up || b.at) > (a.up || a.at) ? 1 : (b.up || b.at) < (a.up || a.at) ? -1 : 0)).slice(0, 6);
    let box = document.querySelector("#frm-body .fx-latest");
    if (!mine.length) { if (box) box.remove(); return; }
    const sig = name + "|" + mine.map((f) => f.id + (f.up || f.at)).join(",");
    if (box && box.dataset.sig === sig) return;
    if (!box) {
      box = document.createElement("div");
      box.className = "fx-latest no-print";
      bar.insertAdjacentElement("afterend", box);
    }
    box.dataset.sig = sig;
    box.innerHTML = `<h3 class="frm-grouphead"><span class="material-symbols-outlined" aria-hidden="true">schedule</span>آخر ما أُضيف <small>${mine.length}</small></h3>` +
      mine.map((f) => `<div class="fx-hit"><b>${esc(f.title || f.name)}</b><small>${esc(f.cat || "غير مصنّف")} · ${size(f.size)} · أُضيف ${esc(whenLabel(f.up || f.at))}</small>
        <span>${previewable(f.name) ? `<button type="button" class="cc-link" data-fx="preview" data-id="${esc(f.id)}">معاينة</button>` : ""}<button type="button" class="cc-link" data-drop="get" data-id="${esc(f.id)}">تنزيل</button></span></div>`).join("");
  }

  /* ===== البحث الموحّد ===== */
  function unifiedSearch() {
    const host = $("frm-body");
    const q = (($("frm-q") || {}).value || "").trim();
    const old = host && host.querySelector(".fx-found");
    if (!host || !q || document.querySelector("#frm-cats .frm-person.on") || !st.files.length) { if (old) old.remove(); return; }
    const hits = st.files.filter((f) => (f.name + " " + (f.title || "") + " " + (f.by || "") + " " + (f.cat || "")).includes(q)).slice(0, 30);
    const sig = q + "|" + hits.map((f) => f.id).join(",");
    if (old && old.dataset.sig === sig) return;
    if (old) old.remove();
    const box = document.createElement("div");
    box.className = "fx-found no-print";
    box.dataset.sig = sig;
    box.innerHTML = `<h3 class="frm-grouphead"><span class="material-symbols-outlined" aria-hidden="true">search</span>في ملفات الزملاء <small>${hits.length}</small></h3>` +
      (hits.length ? hits.map((f) => `<div class="fx-hit"><b>${esc(f.title || f.name)}</b><small>${esc(f.name)} · ${esc(who(f))} · ${esc(f.cat || "غير مصنّف")} · ${size(f.size)} · ${esc(new Date(f.at).toLocaleDateString("ar"))}</small>
          <span>${previewable(f.name) ? `<button type="button" class="cc-link" data-fx="preview" data-id="${esc(f.id)}">معاينة</button>` : ""}<button type="button" class="cc-link" data-drop="get" data-id="${esc(f.id)}">تنزيل</button></span></div>`).join("") : `<p class="frm-empty">لا ملف مطابق في ملفات الزملاء.</p>`);
    host.appendChild(box);
  }

  /* ===== المعاينة ===== */
  async function preview(id) {
    const f = st.files.find((x) => x.id === id);
    if (!f) return;
    if (f.size > 60 * 1048576) return ui.toast("الملف كبير للمعاينة، نزّله لفتحه");
    ui.toast("جارٍ تجهيز المعاينة…");
    try {
      const d = await call("dropFile", { id });
      const bin = atob(d.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = d.mime && d.mime !== "application/octet-stream" ? d.mime : /\.pdf$/i.test(f.name) ? "application/pdf" : /\.txt|\.csv|\.md$/i.test(f.name) ? "text/plain" : "image/" + (f.name.split(".").pop().toLowerCase().replace("jpg", "jpeg"));
      const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const m = document.createElement("div");
      m.className = "fx-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "معاينة " + f.name);
      const body = /^image\//.test(mime) ? `<img src="${u}" alt="${esc(f.name)}">` : `<iframe src="${u}" title="${esc(f.name)}"></iframe>`;
      m.innerHTML = `<div class="fx-box"><div class="fx-head"><b>${esc(f.title || f.name)}</b><button type="button" class="btn secondary" data-fx="close">إغلاق</button></div>${body}</div>`;
      const close = () => { m.remove(); URL.revokeObjectURL(u); document.removeEventListener("keydown", onKey); };
      const onKey = (e) => { if (e.key === "Escape") close(); };
      m.addEventListener("click", (e) => { if (e.target === m || e.target.closest('[data-fx="close"]')) close(); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(m);
    } catch (e) { ui.toast((e && e.message) || "تعذّرت المعاينة"); }
  }

  /* ===== الحذف الجماعي ===== */
  async function bulkDelete() {
    const ids = [...st.sel];
    if (!ids.length) return;
    if (!confirm("حذف " + ids.length + " ملفاً؟\nتُنقل إلى سلة مهملات Google Drive ويمكن استعادتها منها خلال 30 يوماً.")) return;
    let done = 0, fail = 0;
    for (const id of ids) {
      try { await call("dropDelete", { id }); done++; st.sel.delete(id); } catch (e) { fail++; }
      ui.toast("جارٍ الحذف… " + (done + fail) + " من " + ids.length);
    }
    ui.toast(fail ? "حُذف " + done + " وتعذّر " + fail : "حُذف " + done + " ملفاً ونُقلت إلى سلة المهملات");
    const reload = document.querySelector('#frm-drop [data-drop="load"]');
    await fresh(true);
    if (reload) reload.click(); else decorate();
  }

  /* ===== نسخة «نماذجي» على Drive: رفع واستعادة، لتظهر نماذجك على كل أجهزتك ===== */
  const MINE_LS = "tamkeen:my-forms";
  const readMine = () => { try { const a = JSON.parse(localStorage.getItem(MINE_LS) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  async function putSession(sessionUrl, blob) {
    const total = blob.size, CH = 8 * 1048576;
    for (let start = 0; start < total; start += CH) {
      const end = Math.min(start + CH, total);
      let ok = false, last = null;
      for (let t = 0; t < 4 && !ok; t++) {
        try {
          const r = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + total }, body: blob.slice(start, end) });
          if (r.status === 200 || r.status === 201 || r.status === 308) ok = true; else last = new Error("رفض الخادم الدفعة (" + r.status + ")");
        } catch (e) { last = e; }
        if (!ok) await new Promise((r) => setTimeout(r, 1200 * (t + 1)));
      }
      if (!ok) throw last || new Error("انقطع الرفع");
    }
  }
  async function pushOne(blob, name, meta) {
    const init = await call("mineInit", Object.assign({ name, size: blob.size, mime: blob.type || "application/octet-stream", origin: location.origin }, meta));
    await putSession(init.url, blob);
  }
  function cloudMsg(t) { const el = document.querySelector(".fx-cloud small"); if (el) el.textContent = t; }

  async function mineBackup() {
    const items = readMine();
    if (!items.length) return ui.toast("لا نماذج في «نماذجي» لتُنسخ");
    if (!key()) return ui.toast("اكتب رمز القراءة في قسم «ملفات الزملاء» أولاً");
    try {
      cloudMsg("جارٍ قراءة ما على Drive…");
      const remote = (await call("mineList")).files || [];
      let up = 0, skip = 0;
      for (let i = 0; i < items.length; i++) {
        const m = items[i];
        for (const part of [["main", m.fid], ["pdf", m.pid]]) {
          if (!part[1]) continue;
          const rec = await App.filesStore.get(part[1]);
          if (!rec || !rec.blob) continue;
          const old = remote.filter((r) => r.mid === m.id && r.kind === part[0]);
          if (old.some((r) => r.size === rec.blob.size && (part[0] === "pdf" || r.title === (m.name || "")))) { skip++; continue; }
          cloudMsg("رفع " + (i + 1) + " من " + items.length + "…");
          await pushOne(rec.blob, rec.name || m.file, { mid: m.id, kind: part[0], title: m.name || "", of: part[0] === "pdf" ? m.id : "" });
          for (const r of old) { try { await call("mineDelete", { id: r.id }); } catch (e) { /* يبقى القديم */ } }
          up++;
        }
      }
      cloudMsg(up ? "رُفع " + up + " ملفاً إلى Drive" + (skip ? " (وتخطّي " + skip + " محفوظاً)" : "") : "كل نماذجك محفوظة على Drive أصلاً");
      ui.toast(up ? "نُسخت نماذجك إلى Drive" : "لا جديد للنسخ");
    } catch (e) { cloudMsg(""); ui.toast(/غير معروف/.test((e && e.message) || "") ? "هذه الميزة تحتاج تحديث سكربت Google ونشره" : (e && e.message) || "تعذّر النسخ"); }
  }
  async function mineRestore() {
    if (!key()) return ui.toast("اكتب رمز القراءة في قسم «ملفات الزملاء» أولاً");
    try {
      cloudMsg("جارٍ قراءة ما على Drive…");
      const remote = (await call("mineList")).files || [];
      const have = new Set(readMine().map((m) => m.id));
      const mains = remote.filter((r) => r.kind === "main" && r.mid && !have.has(r.mid));
      if (!mains.length) { cloudMsg("لا جديد على Drive: كل ما هناك موجود عندك"); return ui.toast("لا جديد للاستعادة"); }
      const list = readMine();
      const get = async (id) => {
        const d = await call("mineFile", { id });
        const bin = atob(d.data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: d.mime || "application/octet-stream" });
      };
      for (let i = 0; i < mains.length; i++) {
        const r = mains[i];
        cloudMsg("استعادة " + (i + 1) + " من " + mains.length + "…");
        const fid = await App.filesStore.put(await get(r.id), r.name);
        const pdf = remote.find((x) => x.kind === "pdf" && x.of === r.mid);
        const pid = pdf ? await App.filesStore.put(await get(pdf.id), pdf.name) : "";
        list.unshift({ id: r.mid, name: r.title || r.name.replace(/\.[^.]+$/, ""), file: r.name, fid, pid, at: r.at });
      }
      localStorage.setItem(MINE_LS, JSON.stringify(list));
      ui.toast("استُعيد " + mains.length + " نموذجاً، وتُعاد الصفحة لتظهر");
      setTimeout(() => location.reload(), 1200);
    } catch (e) { cloudMsg(""); ui.toast(/غير معروف/.test((e && e.message) || "") ? "هذه الميزة تحتاج تحديث سكربت Google ونشره" : (e && e.message) || "تعذّرت الاستعادة"); }
  }
  function mountCloud() {
    const bar = document.querySelector("#view-forms .frm-addbar");
    if (!bar || bar.parentNode.querySelector(".fx-cloud")) return;
    const d = document.createElement("div");
    d.className = "fx-cloud no-print";
    d.innerHTML = `<b>نماذجي على Drive</b><span>احفظ نماذجك في Drive لتظهر على كل أجهزتك، أو استعدها على هذا الجهاز.</span>
      <button type="button" class="btn secondary" data-fx="mine-up"><span class="material-symbols-outlined btn-ico">cloud_upload</span>نسخ نماذجي إلى Drive</button>
      <button type="button" class="btn secondary" data-fx="mine-down"><span class="material-symbols-outlined btn-ico">cloud_download</span>استعادة من Drive</button><small></small>`;
    bar.insertAdjacentElement("afterend", d);
  }

/* ===== نسخة احتياطية ثانية إلى مجلد على جهازك (مثلاً مجلد Mega المتزامن) =====
   يكتب ملفات الزملاء ونماذجك في مجلد تختاره: «ملفات الزملاء / الشخص / التصنيف / الملف» و«نماذجي».
   الملف الموجود بالحجم نفسه يُتخطّى، فالتكرار يكمّل ما نقص فقط. Chrome وEdge فقط (واجهة الوصول إلى المجلدات). */
  const BIG = 40 * 1048576;                       // ما فوقه لا يمرّ عبر سكربت Google؛ يُسجَّل في الفهرس ليُنزَّل من Drive
  const safe = (t, d) => String(t || d || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || d || "بلا اسم";
  async function sub(dir, name) { return dir.getDirectoryHandle(name, { create: true }); }
  async function existingSize(dir, name) { try { return (await (await dir.getFileHandle(name)).getFile()).size; } catch (e) { return -1; } }
  async function writeFile(dir, name, blob) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
  async function uniqueName(dir, name, size, id) {
    const have = await existingSize(dir, name);
    if (have < 0 || have === size) return { name, same: have === size };
    const dot = name.lastIndexOf(".");
    const alt = dot > 0 ? name.slice(0, dot) + " (" + String(id).slice(-4) + ")" + name.slice(dot) : name + " (" + String(id).slice(-4) + ")";
    return { name: alt, same: (await existingSize(dir, alt)) === size };
  }
  async function toBlob(d) {
    const bin = atob(d.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: d.mime || "application/octet-stream" });
  }
  async function folderBackup(pick) {
    if (!key()) return ui.toast("اكتب رمز القراءة في قسم «ملفات الزملاء» أولاً");
    if (!(pick || window.showDirectoryPicker)) return ui.toast("هذا المتصفح لا يدعم الكتابة في مجلد. استعمل Chrome أو Edge");
    let root;
    try { root = await (pick || window.showDirectoryPicker)({ id: "tamkeen-backup", mode: "readwrite" }); } catch (e) { return; }   // أُلغي الاختيار
    return runBackup(root, false);
  }
  let backing = false;
  async function runBackup(root, silent) {
    if (backing) return null;
    backing = true;
    const rep = { done: 0, skipped: 0, big: [], failed: [] };
    try {
      cloudMsg2("جارٍ قراءة قائمة الملفات…");
      const files = await fresh(true);
      const colleagues = await sub(root, "ملفات الزملاء");
      const index = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        cloudMsg2("ملفات الزملاء " + (i + 1) + " من " + files.length + "…");
        const dir = await sub(colleagues, safe(f.cat, "غير مصنّف"));
        const day = String(f.at || "").slice(0, 10) || "بلا تاريخ";
        const label = day + " — " + safe(who(f), "بلا اسم") + " — " + (f.title ? safe(f.title) + " — " + safe(f.name) : safe(f.name, "ملف"));
        const u = await uniqueName(dir, label, Number(f.size), f.id);
        index.push({ person: who(f), cat: f.cat || "", file: u.name, size: f.size, title: f.title || "", at: f.at });
        if (u.same) { rep.skipped++; continue; }
        if (Number(f.size) > BIG) { rep.big.push(f.name + " (" + who(f) + ")"); continue; }
        try { await writeFile(dir, u.name, await toBlob(await call("dropFile", { id: f.id }))); rep.done++; } catch (e) { rep.failed.push(f.name); }
      }
      const mine = readMine();
      if (mine.length) {
        const md = await sub(root, "نماذجي");
        for (let i = 0; i < mine.length; i++) {
          const m = mine[i];
          cloudMsg2("نماذجي " + (i + 1) + " من " + mine.length + "…");
          for (const idKey of ["fid", "pid"]) {
            if (!m[idKey]) continue;
            const rec = await App.filesStore.get(m[idKey]);
            if (!rec || !rec.blob) continue;
            const nm = safe(idKey === "pid" ? (m.name || "") + " (PDF).pdf" : (m.name || "") + (rec.name && rec.name.lastIndexOf(".") > 0 ? rec.name.slice(rec.name.lastIndexOf(".")) : ""), rec.name);
            const u = await uniqueName(md, nm, rec.blob.size, m.id);
            if (u.same) { rep.skipped++; continue; }
            try { await writeFile(md, u.name, rec.blob); rep.done++; } catch (e) { rep.failed.push(nm); }
          }
        }
      }
      await writeFile(root, "فهرس-النسخة-الاحتياطية.json", new Blob([JSON.stringify({ at: new Date().toISOString(), colleagues: index, bigNotCopied: rep.big, failed: rep.failed }, null, 1)], { type: "application/json" }));
      const parts = ["نُسخ " + rep.done + " ملفاً", rep.skipped ? "تخطّي " + rep.skipped + " موجوداً" : "", rep.big.length ? rep.big.length + " كبير لم يُنسخ" : "", rep.failed.length ? "تعذّر " + rep.failed.length : ""].filter(Boolean);
      cloudMsg2(parts.join(" · ") + (silent ? " — " + new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : ""));
      if (!silent) ui.toast(rep.failed.length || rep.big.length ? "انتهى النسخ مع ملاحظات، راجع الفهرس في المجلد" : "اكتملت النسخة الاحتياطية");
      else if (rep.done) ui.toast("نُسخ " + rep.done + " ملفاً جديداً إلى المجلد");
      return rep;
    } catch (e) { cloudMsg2(""); if (!silent) ui.toast((e && e.message) || "تعذّرت النسخة الاحتياطية"); }
    finally { backing = false; }
  }

  /* ===== المزامنة التلقائية: مجلد يُحفظ مرة واحدة وتُنسخ إليه الملفات الجديدة كل دقيقتين ما دام التاب مفتوحاً ===== */
  const KV = { db: null };
  function kv() {
    if (KV.db) return KV.db;
    KV.db = new Promise((res, rej) => {
      const r = indexedDB.open("tamkeen-fx", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return KV.db;
  }
  const kvGet = async (k) => { const d = await kv(); return new Promise((res) => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); };
  const kvSet = async (k, v) => {
    try {
      const d = await kv();
      return await new Promise((res) => {
        const t = d.transaction("kv", "readwrite");
        if (v == null) t.objectStore("kv").delete(k); else t.objectStore("kv").put(v, k);
        t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res();
      });
    } catch (e) { /* يبقى في الذاكرة لهذه الجلسة */ }
  };
  const auto = { handle: null, granted: false };

  async function autoPerm(ask) {
    if (!auto.handle) return false;
    try {
      let p = await auto.handle.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && ask) p = await auto.handle.requestPermission({ mode: "readwrite" });
      auto.granted = p === "granted";
    } catch (e) { auto.granted = false; }
    return auto.granted;
  }
  function autoPaint() {
    const el = document.querySelector(".fx-auto");
    if (!el) return;
    const on = !!auto.handle;
    el.innerHTML = (on
      ? `<span>المزامنة التلقائية إلى المجلد <b>${esc(auto.handle.name)}</b>: ${auto.granted ? "تعمل (ما دام هذا التاب مفتوحاً)" : "بانتظار إذنك لهذه الجلسة"}</span>` +
        (auto.granted ? "" : `<button type="button" class="btn navy" data-fx="auto-allow">تفعيل لهذه الجلسة</button>`) +
        `<button type="button" class="btn secondary" data-fx="auto-now">مزامنة الآن</button><button type="button" class="btn secondary" data-fx="auto-off">إيقاف التلقائية</button>`
      : `<span>اختر مجلداً مرة واحدة، فتُنسخ إليه الملفات الجديدة تلقائياً ضمن تصنيفها وبتاريخ إضافتها.</span><button type="button" class="btn navy" data-fx="auto-pick"><span class="material-symbols-outlined btn-ico">sync</span>اختيار مجلد المزامنة التلقائية</button>`);
  }
  async function autoInit() {
    if (!window.showDirectoryPicker) return;
    auto.handle = await kvGet("autoDir");
    await autoPerm(false);
    autoPaint();
  }
  async function autoPick() {
    if (!window.showDirectoryPicker) return ui.toast("هذا المتصفح لا يدعم الكتابة في مجلد. استعمل Chrome أو Edge");
    if (!key()) return ui.toast("اكتب رمز القراءة في قسم «ملفات الزملاء» أولاً");
    let h;
    try { h = await window.showDirectoryPicker({ id: "tamkeen-auto", mode: "readwrite" }); } catch (e) { return; }
    auto.handle = h; await kvSet("autoDir", h); auto.granted = true; autoPaint();
    ui.toast("ستُنسخ إليه الملفات الجديدة تلقائياً");
    runBackup(h, true);
  }
  async function autoTick() {
    if (!auto.handle || !key()) return;
    if (!(await autoPerm(false))) { autoPaint(); return; }      // الإذن يُفحص في كل دورة: قد يسحبه المتصفح بين الجلسات
    await runBackup(auto.handle, true);
  }
  function cloudMsg2(t) { const el = document.querySelector(".fx-cloud2 small"); if (el) el.textContent = t; }
  function mountFolderBackup() {
    const c = document.querySelector("#view-forms .fx-cloud");
    if (!c || document.querySelector(".fx-cloud2")) return;
    const d = document.createElement("div");
    d.className = "fx-cloud fx-cloud2 no-print";
    d.innerHTML = `<b>نسخة احتياطية ثانية</b><span>انسخ ملفات الزملاء ونماذجك إلى مجلد على جهازك (اختر مجلد Mega المتزامن مثلاً). التكرار يكمّل الناقص فقط.</span>
      <button type="button" class="btn secondary" data-fx="folder-backup"><span class="material-symbols-outlined btn-ico">folder_zip</span>نسخ احتياطي إلى مجلد</button><small></small>
      <div class="fx-auto" style="flex-basis:100%;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px dashed #cfd6e0;padding-top:8px;margin-top:4px"></div>`;
    c.insertAdjacentElement("afterend", d);
    autoInit();
  }

  /* ===== الأحداث ===== */
  function init() {
    const root = $("view-forms");
    if (!root || root.dataset.fxReady) return;
    root.dataset.fxReady = "1";
    mountCloud();
    mountFolderBackup();
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fx]");
      if (!b) return;
      if (b.dataset.fx === "preview") preview(b.dataset.id);
      else if (b.dataset.fx === "bulkdel") bulkDelete();
      else if (b.dataset.fx === "mine-up") mineBackup();
      else if (b.dataset.fx === "mine-down") mineRestore();
      else if (b.dataset.fx === "folder-backup") folderBackup();
      else if (b.dataset.fx === "auto-pick") autoPick();
      else if (b.dataset.fx === "auto-allow") { autoPerm(true).then((ok) => { autoPaint(); if (ok) runBackup(auto.handle, true); }); }
      else if (b.dataset.fx === "auto-now") { autoPerm(true).then((ok) => { autoPaint(); if (ok) runBackup(auto.handle, false); }); }
      else if (b.dataset.fx === "auto-off") { auto.handle = null; auto.granted = false; kvSet("autoDir", null).then(autoPaint); ui.toast("أُوقفت المزامنة التلقائية، وما نُسخ يبقى في المجلد"); }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.fxSel !== undefined) {
        if (t.checked) st.sel.add(t.dataset.fxSel); else st.sel.delete(t.dataset.fxSel);
        decorate();
      } else if (t.dataset.fx === "all") {
        document.querySelectorAll("#frm-body [data-fx-sel]").forEach((c) => { if (t.checked) st.sel.add(c.dataset.fxSel); else st.sel.delete(c.dataset.fxSel); });
        decorate();
      }
    });
    root.addEventListener("input", (e) => { if (e.target.id === "frm-q") setTimeout(unifiedSearch, 0); });
    // إعادة التزيين بعد كل رسم تقوم به الصفحة
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!busyDeco) decorate(); }, 60); })
      .observe(root, { childList: true, subtree: true });
    fresh(true).then(() => { decorate(); autoTick(); });
    // تحديث هادئ كل دقيقتين ما دام التاب مفتوحاً ومرئياً
    st.timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !root.classList.contains("active")) return;
      await fresh(true); decorate();
    }, POLL_MS);
    // المزامنة التلقائية تعمل في أي صفحة من التطبيق ما دام مفتوحاً، لا في هذا التاب وحده
    setInterval(autoTick, POLL_MS);
  }

  App.formsExtra = { init, refresh: () => fresh(true).then(decorate), folderBackup, runBackup, autoTick };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window.App = window.App || {});
