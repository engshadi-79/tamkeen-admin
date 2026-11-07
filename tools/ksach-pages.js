/* قراءة «بنية» صفحة من نظام المركز (قوائم، جداول، تصفية، ترقيم) — للقراءة فقط.

   يُشغَّل في Console داخل https://tamkeen.ksach.org وأنت مسجّل دخولك، على الصفحة المفتوحة
   حالياً (افتحها ثم شغّله). لا يضغط أي زر، ولا يرسل شيئاً، ولا يقرأ كوكيز ولا رموز الجلسة.

   حجب الخصوصية:
   • الأعمدة التي عنوانها اسم/هوية/جوال/هاتف/رقم لا تُسجَّل قيمها؛ تُحجب الحروف والأرقام
     وتبقى «شكل» الخلية فقط (مثلاً: xxxx xxxx - ######### ).
   • أي رقم من 7 خانات فأكثر يُستبدل بـ # في كل مكان.
   • القيم القصيرة في الأعمدة الأخرى (مثل «مكتمل» / «لم يُعبَّأ» / اسم الاستبيان) تُسجَّل،
     لأنها تبيّن لي كيف يعرّف النظام الحالة.
   • لا تُسجَّل أسماء أشخاص من القوائم المنسدلة؛ يُسجَّل عددها فقط.

   الناتج: ملف ‎ksach-page-….json‎ يُنزَّل على جهازك، ثم تعطيه لي. */
(() => {
  if (!/(^|\.)ksach\.org$/.test(location.hostname) && !window.__KX_TEST) {
    alert("شغّل هذا السكربت داخل موقع نظام المركز.");
    return;
  }
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const PERSONAL_HEAD = /اسم|طالب|هوي|جوال|هاتف|تواصل|رقم|بريد|عنوان|name|phone|id|email/i;
  const maskDigits = (s) => String(s).replace(/\d{7,}/g, (m) => "#".repeat(m.length));
  /* يُبقي شكل النص ويخفي حروفه وأرقامه */
  const shape = (s) => String(s).replace(/[؀-ۿA-Za-z]/g, "x").replace(/\d/g, "#");
  const pathOf = (href) => { try { const u = new URL(href, location.href); return u.origin === location.origin ? u.pathname + (u.search ? "?" + [...u.searchParams.keys()].map((k) => k + "=…").join("&") : "") : ""; } catch (e) { return ""; } };
  const idPattern = (p) => p.replace(/\/\d+(?=\/|$|\?)/g, "/{id}");

  const labelOf = (el) => {
    const id = el.getAttribute("id");
    let t = "";
    if (id) { const l = document.querySelector('label[for="' + CSS.escape(id) + '"]'); if (l) t = clean(l.textContent); }
    if (!t) { const l = el.closest("label"); if (l) t = clean(l.textContent); }
    if (!t) t = clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "");
    if (!t) { const row = el.closest(".form-group, .mb-3, .col, div"); const l = row && row.querySelector("label, .form-label"); if (l) t = clean(l.textContent); }
    return t.slice(0, 80);
  };

  const forms = [...document.querySelectorAll("form")].map((f) => {
    const fields = [];
    f.querySelectorAll("input, select, textarea").forEach((el) => {
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      const name = el.getAttribute("name") || "";
      if (!name || ["submit", "button", "image", "password"].includes(type)) return;
      if (type === "hidden") { fields.push({ name, type, token: /token|csrf|_method/i.test(name) }); return; }
      const o = { name, type, label: labelOf(el) };
      if (el.tagName === "SELECT") {
        const all = [...el.options];
        const people = all.some((op) => /\d{8,}/.test(clean(op.textContent).replace(/\s/g, "")));
        if (people || all.length > 150) { o.count = all.length; o.omitted = people ? "قائمة أشخاص" : "قائمة طويلة"; }
        else o.options = all.map((op) => ({ v: op.value, t: clean(op.textContent).slice(0, 70) }));
      }
      fields.push(o);
    });
    return { method: (f.getAttribute("method") || "get").toLowerCase(), action: pathOf(f.getAttribute("action") || location.pathname), id: f.id || "", fields };
  });

  const tables = [...document.querySelectorAll("table")].map((t, ti) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => clean(th.textContent));
    const hs = heads.length ? heads : [...(t.querySelector("tr") || { children: [] }).children].map((c) => clean(c.textContent));
    const rows = [...t.querySelectorAll("tbody tr")].filter((r) => r.children.length > 1);
    const cell = (r, i) => (r.children[i] ? clean(r.children[i].textContent) : "");
    const cols = hs.map((h, i) => {
      const vals = rows.map((r) => cell(r, i));
      const personal = PERSONAL_HEAD.test(h);
      const distinct = [...new Set(vals)];
      const out = { header: h, personal };
      if (!personal && distinct.length <= 25 && distinct.every((v) => v.length <= 40)) {
        // قيم قصيرة قليلة التنوع (حالات، أنواع): تُسجَّل مع تكرارها
        out.values = distinct.map((v) => ({ v: maskDigits(v), n: vals.filter((x) => x === v).length }));
      }
      return out;
    });
    const sample = rows.slice(0, 3).map((r) => hs.map((h, i) => {
      const v = cell(r, i);
      return PERSONAL_HEAD.test(h) || v.length > 40 ? shape(v).slice(0, 120) : maskDigits(v);
    }));
    const rowLinks = new Set();
    rows.slice(0, 5).forEach((r) => r.querySelectorAll("a[href]").forEach((a) => {
      const p = pathOf(a.getAttribute("href"));
      if (p) rowLinks.add(idPattern(p) + "  «" + clean(a.textContent).slice(0, 30) + "»");
    }));
    const iconActions = new Set();
    rows.slice(0, 5).forEach((r) => r.querySelectorAll("button, input[type=submit]").forEach((b) => iconActions.add(clean(b.textContent || b.value || b.getAttribute("title") || "").slice(0, 30))));
    return { index: ti, rows: rows.length, columns: cols, sample, rowLinks: [...rowLinks], rowButtons: [...iconActions].filter(Boolean) };
  });

  const paging = {
    next: [...document.querySelectorAll('a[rel="next"], .pagination a, ul.pagination a')].slice(0, 12).map((a) => pathOf(a.getAttribute("href")) + " «" + clean(a.textContent).slice(0, 12) + "»"),
    summary: (clean(document.body.innerText).match(/(?:عرض|Showing)[^.\n]{0,60}\d+[^.\n]{0,40}/) || [""])[0],
  };

  /* نصوص بارزة: عناوين وبطاقات ملخّص (أرقام العدّ مفيدة وليست شخصية) */
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,.card-title,.card-header,legend")].map((h) => maskDigits(clean(h.textContent))).filter((t) => t && t.length < 120).slice(0, 40);
  const cards = [...document.querySelectorAll(".card, .stat, .stats, .widget, .info-box, .small-box, [class*=card]")]
    .filter((c) => !c.querySelector("table"))
    .map((c) => maskDigits(clean(c.innerText)).slice(0, 160)).filter(Boolean).slice(0, 40);
  const tabs = [...document.querySelectorAll('[role=tab], .nav-tabs a, .nav-pills a')].map((a) => clean(a.textContent).slice(0, 40) + " → " + (pathOf(a.getAttribute("href") || "") || a.getAttribute("data-bs-target") || "")).slice(0, 20);
  const links = new Map();
  document.querySelectorAll("a[href]").forEach((a) => {
    const p = pathOf(a.getAttribute("href"));
    if (p && /^\/admin/.test(p)) { const k = idPattern(p); if (!links.has(k)) links.set(k, clean(a.textContent).slice(0, 50)); }
  });

  const report = {
    kind: "ksach-page-structure", v: 1, at: new Date().toISOString(), origin: location.origin,
    path: location.pathname + (location.search ? "?" + [...new URLSearchParams(location.search).keys()].map((k) => k + "=…").join("&") : ""),
    title: clean(document.title), headings, tabs, forms, tables, paging, cards,
    links: [...links].map(([path, text]) => ({ path, text })),
  };
  const slug = location.pathname.replace(/^\/admin\/?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ksach-page-" + slug + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  alert("تم: " + report.tables.length + " جدول، " + report.forms.length + " نموذج بحث/تصفية. نُزّل الملف ksach-page-" + slug + ".json — أرسله لي.");
})();
