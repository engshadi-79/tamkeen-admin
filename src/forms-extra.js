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

      if (bar && cards.length) {
        let tb = document.querySelector("#frm-body .fx-bulk");
        if (!tb) {
          tb = document.createElement("div");
          tb.className = "fx-bulk no-print";
          bar.insertAdjacentElement("afterend", tb);
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

  /* ===== الأحداث ===== */
  function init() {
    const root = $("view-forms");
    if (!root || root.dataset.fxReady) return;
    root.dataset.fxReady = "1";
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fx]");
      if (!b) return;
      if (b.dataset.fx === "preview") preview(b.dataset.id);
      else if (b.dataset.fx === "bulkdel") bulkDelete();
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
    fresh(true).then(decorate);
    // تحديث هادئ كل دقيقتين ما دام التاب مفتوحاً ومرئياً
    st.timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !root.classList.contains("active")) return;
      await fresh(true); decorate();
    }, POLL_MS);
  }

  App.formsExtra = { init, refresh: () => fresh(true).then(decorate) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window.App = window.App || {});
