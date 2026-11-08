/* خدمة واتساب العامة: زر عائم في كل تبويبات المساعد يفتح نافذة إرسال.
   - النص يُولَّد من الصفحة الحالية (عناوين وأرقام وأول صفوف الجداول) أو من النص المحدَّد.
   - يمكن لأي تبويب تسجيل مولّد نص خاص: App.whatsapp.register("viewId", () => "نص").
   - عدة مستلمين: زر فتح لكل مستلم (واتساب لا يسمح بغير محادثة واحدة لكل رابط)، ولا إرسال تلقائي.
   - جهات الاتصال مشتركة مع تبويب أوامر المركز (نفس مفتاح التخزين). */
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  const CONTACT_KEY = "tamkeen-admin:cc-contacts", CC = "970";
  const providers = {};
  const st = { open: false, text: "", sel: new Set(), extra: "", opened: new Set(), view: "" };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* التخزين غير متاح */ } };
  const toast = (m) => { if (App.ui && App.ui.toast) App.ui.toast(m); else alert(m); };
  const contacts = () => lsGet(CONTACT_KEY, []);
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const intl = (raw, cc) => {
    const t = String(raw || "").trim(), d = digits(t);
    if (!d) return "";
    if (t.startsWith("+")) return d;
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith(cc) && d.length >= cc.length + 8) return d;
    return d.startsWith("0") ? cc + d.slice(1) : cc + d;
  };

  const visible = (el) => !!(el && (el.offsetParent || el.getClientRects().length));
  function currentView() {
    const v = [...document.querySelectorAll("section.view")].find(visible);
    return v || null;
  }
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* نص عام من الصفحة المعروضة */
  function genericText(view) {
    if (!view) return "";
    const today = new Date().toLocaleDateString("ar", { year: "numeric", month: "numeric", day: "numeric" });
    const L = [];
    const h = view.querySelector("h1, h2");
    L.push("📌 " + clean(h ? h.textContent : document.title) + " — " + today);
    /* بطاقات الأرقام: عنصر فيه رقم وتسمية */
    const stats = [...view.querySelectorAll(".stat, .kpi, .card-stat, .cc-stat, [data-stat]")].filter(visible).slice(0, 10);
    stats.forEach((s) => { const k = s.cloneNode(true); k.querySelectorAll("button, .material-symbols-outlined").forEach((n) => n.remove()); const t = clean(k.textContent); if (t && t.length < 80) L.push("• " + t); });
    /* أول جدول ظاهر: أول 8 صفوف، بلا أعمدة الهوية والجوال */
    const tb = [...view.querySelectorAll("table")].find(visible);
    if (tb) {
      const heads = [...tb.querySelectorAll("thead th")].map((x) => clean(x.textContent));
      const skip = heads.map((x) => /هوية|جوال|هاتف|رقم الطالب|رقم الطلب|^id$/i.test(x));
      const rows = [...tb.querySelectorAll("tbody tr")].filter(visible);
      L.push("", "الجدول (" + rows.length + " صفاً" + (rows.length > 8 ? "، أول 8" : "") + "):");
      rows.slice(0, 8).forEach((r) => {
        /* خلية «ناقص»: نكتب اسم عمودها (قبلي/بعدي/تعهد…) بدل كلمة ناقص المجردة */
        const lack = [];
        const cells = [...r.children].map((c, i) => {
          if (skip[i]) return "";
          const k = c.cloneNode(true);
          const live = [...c.querySelectorAll("input, select, textarea")].map((n) => (n.tagName === "SELECT" ? (n.selectedOptions[0] || {}).textContent : n.value) || "");
          k.querySelectorAll("button, .material-symbols-outlined, .ico, input, select, textarea, script, style").forEach((n) => n.remove());
          if (live.length) return clean(live.join(" ") + " " + k.textContent);
          const t = clean(k.textContent);
          /* رقم الطالب (STU-…) لا يُرسَل أبداً ولو لم يُعرف عنوان عموده */
          if (/^(ناقص|لم يعبّئ|لم يوقّع|لم يعبئ|لم يوقع|نعم)$/.test(t) && heads[i] && !/^(نعم)$/.test(t)) { lack.push(heads[i].replace(/^(ال)?(استبيان|استمارة)\s*/, "") || heads[i]); return ""; }
          return t === "—" || t === "-" || /^STU-\d/i.test(t) ? "" : t;
        }).filter(Boolean);
        /* عمود عدد النواقص: رقم مجرد في آخر الصف بعد أن عرفنا النواقص، فيصبح مكرراً */
        if (lack.length && /^\d+$/.test(cells[cells.length - 1] || "")) cells.pop();
        if (lack.length) cells.push("ينقصه: " + lack.join("، "));
        if (cells.length) L.push("- " + cells.join(" · ").slice(0, 200));
      });
    }
    /* لا بطاقات ولا جدول: نأخذ النص الظاهر للصفحة مختصراً بلا أزرار */
    if (L.length === 1) {
      const k = view.cloneNode(true);
      k.querySelectorAll("button, .material-symbols-outlined, input, select, textarea, script, style, nav, [hidden]").forEach((n) => n.remove());
      const t = (k.innerText || k.textContent || "").split("\n").map(clean).filter((x) => x && x !== clean(h ? h.textContent : "")).slice(0, 25).join("\n");
      if (t) L.push("", t.slice(0, 900));
    }
    return L.join("\n");
  }
  function buildText() {
    const sel = clean(String(window.getSelection ? window.getSelection() : ""));
    const v = currentView(), id = v ? v.id.replace(/^view-/, "") : "";
    st.view = id;
    if (sel.length > 3) return "📌 " + clean((v && v.querySelector("h1,h2") || {}).textContent || document.title) + "\n" + sel;
    if (providers[id]) { try { const t = providers[id](); if (t) return String(t); } catch (e) { /* نرجع للنص العام */ } }
    return genericText(v);
  }

  function ensureStyle() {
    if (document.getElementById("wa-style")) return;
    const s = document.createElement("style"); s.id = "wa-style";
    s.textContent = `
#wa-fab{position:fixed;inset-block-end:18px;inset-inline-start:18px;z-index:900;width:52px;height:52px;border-radius:50%;border:0;background:#1f8f4e;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
#wa-fab:focus-visible{outline:3px solid #fff;outline-offset:2px}
#wa-dlg{position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:12px}
#wa-dlg.open{display:flex}
#wa-box{background:var(--surface,#fff);color:var(--text,#1a1a1a);width:min(640px,100%);max-height:92vh;overflow:auto;border-radius:14px;padding:16px;display:grid;gap:10px}
#wa-box h3{margin:0;font-size:1.1rem}
#wa-box textarea,#wa-box input[type=tel]{width:100%;box-sizing:border-box;padding:8px;border:1px solid #9994;border-radius:8px;font:inherit;background:transparent;color:inherit}
#wa-box .wa-list{display:grid;gap:6px;max-height:190px;overflow:auto}
#wa-box .wa-r{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid #9993;border-radius:8px}
#wa-box .wa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#wa-box .wa-warn{background:#fff3cd;color:#664d03;padding:8px;border-radius:8px;font-size:.85rem}
#wa-box button{cursor:pointer}`;
    document.head.appendChild(s);
  }

  function listHtml() {
    const cs = contacts();
    if (!cs.length) return '<p class="wa-note">لا جهات محفوظة بعد. أضف جهة أو اكتب رقماً أدناه.</p>';
    return cs.map((c) => `<label class="wa-r"><span><input type="checkbox" data-wa-sel="${esc(c.id)}" ${st.sel.has(c.id) ? "checked" : ""}> ${esc(c.name)}${c.role ? " — " + esc(c.role) : ""}</span>${st.sel.has(c.id) ? `<button type="button" class="btn small" data-wa-go="${esc(c.id)}">${st.opened.has(c.id) ? "✓ فُتح" : "فتح واتساب"}</button>` : ""}</label>`).join("");
  }
  function render() {
    const d = document.getElementById("wa-dlg");
    d.classList.toggle("open", st.open);
    if (!st.open) return;
    const extraNum = intl(st.extra, CC);
    document.getElementById("wa-box").innerHTML = `
      <h3>إرسال عبر واتساب</h3>
      <div class="wa-note">الصفحة: ${esc(st.view || "—")} — يفتح واتساب برسالة جاهزة وترسلها أنت.</div>
      <div class="wa-list">${listHtml()}</div>
      <div class="wa-row"><input type="tel" inputmode="tel" data-wa-extra placeholder="أو رقم آخر 059xxxxxxx" value="${esc(st.extra)}" style="flex:1;min-width:160px">${extraNum ? `<button type="button" class="btn small" data-wa-go="__extra">${st.opened.has("__extra") ? "✓ فُتح" : "فتح واتساب"}</button>` : ""}<button type="button" class="btn small secondary" data-wa-add>＋ جهة اتصال</button></div>
      <label>نص الرسالة (يمكنك تعديله)<textarea rows="9" data-wa-text>${esc(st.text)}</textarea></label>
      <p class="wa-warn">قد يتضمن النص أسماء أو بيانات طلاب. واتساب يمرّر الرسالة عبر خوادمه؛ أرسلها فقط لمن له صلاحية الاطّلاع عليها.</p>
      <div class="wa-row"><button type="button" class="btn small secondary" data-wa-regen>إعادة توليد من الصفحة</button><button type="button" class="btn small secondary" data-wa-copy>نسخ النص</button><button type="button" class="btn small" data-wa-close>إغلاق</button></div>
      <p class="wa-note">لكل مستلم زر فتح مستقل؛ واتساب لا يتيح إرسال رسالة واحدة لعدة محادثات برابط واحد.</p>`;
  }
  function open() {
    st.text = buildText();
    if (!st.text) return toast("لا محتوى في هذه الصفحة لإرساله");
    st.open = true; st.opened = new Set(); render();
  }
  function go(id) {
    const text = st.text.trim();
    if (!text) return toast("لا نص لإرساله");
    let num = "";
    if (id === "__extra") num = intl(st.extra, CC);
    else { const c = contacts().find((x) => x.id === id); num = c ? intl(c.phone, c.cc || CC) : ""; }
    if (!num) return toast("رقم غير صالح");
    const url = "https://wa.me/" + num + "?text=" + encodeURIComponent(text);
    if (url.length > 1900) toast("الرسالة طويلة؛ قد لا تُحمَّل كاملة. اختصرها أو انسخها.");
    window.open(url, "_blank", "noopener");
    st.opened.add(id); render();
  }

  function init() {
    if (document.getElementById("wa-fab")) return;
    ensureStyle();
    const fab = document.createElement("button");
    fab.id = "wa-fab"; fab.type = "button"; fab.title = "إرسال عبر واتساب"; fab.setAttribute("aria-label", "إرسال عبر واتساب"); fab.textContent = "💬";
    /* لا يسحب التحديد قبل أن نقرأه */
    fab.addEventListener("mousedown", (e) => e.preventDefault());
    fab.addEventListener("click", open);
    const dlg = document.createElement("div"); dlg.id = "wa-dlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true");
    dlg.innerHTML = '<div id="wa-box"></div>';
    document.body.append(fab, dlg);
    dlg.addEventListener("click", (e) => {
      const t = e.target;
      if (t === dlg || t.closest("[data-wa-close]")) { st.open = false; return render(); }
      const g = t.closest("[data-wa-go]"); if (g) return go(g.dataset.waGo);
      if (t.closest("[data-wa-regen]")) { st.text = buildText(); return render(); }
      if (t.closest("[data-wa-copy]")) { (navigator.clipboard ? navigator.clipboard.writeText(st.text) : Promise.reject()).then(() => toast("نُسخ النص"), () => toast("تعذّر النسخ")); return; }
      if (t.closest("[data-wa-add]")) {
        const name = (window.prompt("اسم جهة الاتصال (مثال: مدير المركز):", "") || "").trim(); if (!name) return;
        const role = (window.prompt("الصفة (اختياري):", "") || "").trim();
        const phone = (window.prompt("رقم الجوال (0599xxxxxx أو +970599xxxxxx):", "") || "").trim();
        if (!intl(phone, CC)) return toast("رقم غير صالح");
        const cs = contacts(), id = String(Date.now());
        cs.push({ id, name: name.slice(0, 40), role: role.slice(0, 40), phone, cc: CC }); lsSet(CONTACT_KEY, cs);
        st.sel.add(id); render();
      }
    });
    dlg.addEventListener("change", (e) => {
      const s = e.target.closest && e.target.closest("[data-wa-sel]");
      if (s) { s.checked ? st.sel.add(s.dataset.waSel) : st.sel.delete(s.dataset.waSel); render(); }
    });
    dlg.addEventListener("input", (e) => {
      if (e.target.matches("[data-wa-text]")) st.text = e.target.value;
      else if (e.target.matches("[data-wa-extra]")) {
        st.extra = e.target.value;
        /* نعيد الرسم فقط عند ظهور/اختفاء زر الفتح حتى لا نفقد المؤشر */
        const has = !!intl(st.extra, CC), btn = dlg.querySelector('[data-wa-go="__extra"]');
        if (has !== !!btn) { render(); const i = dlg.querySelector("[data-wa-extra]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) { st.open = false; render(); } });
  }

  App.whatsapp = { init, open, register: (viewId, fn) => { providers[viewId] = fn; }, intl };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
