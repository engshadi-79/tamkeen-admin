/* قراءة «بنية» نماذج نظام المركز — للقراءة فقط.

   يُشغَّل في Console داخل https://tamkeen.ksach.org وأنت مسجّل دخولك.
   يسجّل أسماء الحقول وعناوينها وخياراتها (مثل قوائم المسارات) ليُبنى عليها
   تنفيذ الأوامر لاحقاً. لا يُرسل أي نموذج، ولا يضغط حفظاً أو حذفاً، ولا يقرأ
   كوكيز ولا رموز الجلسة، ولا يسجّل قيم الحقول المكتوبة (فلا أسماء طلبة
   ولا أرقام هوية). يفتح بطلبات GET فقط صفحات «إضافة/تسجيل/بحث».

   الناتج: ملف ‎ksach-forms.json‎ يُنزَّل على جهازك، ثم تعطيه لي. */
(async () => {
  if (!/(^|\.)ksach\.org$/.test(location.hostname) && !window.__KX_TEST) {
    alert("شغّل هذا السكربت داخل موقع نظام المركز.");
    return;
  }
  const UNSAFE = /logout|signout|delete|destroy|remove|revoke|reset|export|download|print|\.pdf|\.xlsx|\.csv|approve|reject|publish|send/i;
  const WANT = /create|new|add|register|search|filter|إضافة|تسجيل|جديد|إنشاء|بحث|استعلام/i;
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pathOf = (href) => { try { const u = new URL(href, location.href); return u.origin === location.origin ? u.pathname : ""; } catch (e) { return ""; } };

  let stopped = false;
  const box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "position:fixed;inset-block-start:14px;inset-inline-start:14px;z-index:2147483647;" +
    "background:#14284B;color:#fff;font:14px/1.7 system-ui,'Segoe UI',sans-serif;padding:14px 16px;" +
    "border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:420px";
  box.innerHTML = '<b style="font-size:15px">قراءة بنية النماذج (للقراءة فقط)</b>' +
    '<div id="kf-say" style="margin-top:6px;opacity:.92"></div>' +
    '<button id="kf-stop" style="margin-top:10px;padding:6px 12px;border:0;border-radius:8px;cursor:pointer">إيقاف</button>';
  document.body.appendChild(box);
  const say = (t) => { box.querySelector("#kf-say").textContent = t; };
  box.querySelector("#kf-stop").onclick = () => { stopped = true; say("أُوقف."); };

  /* عنوان الحقل: label المرتبط، أو الأب، أو placeholder، أو خلية العنوان المجاورة */
  function labelOf(el, doc) {
    const id = el.getAttribute("id");
    let t = "";
    if (id) { const l = doc.querySelector('label[for="' + CSS.escape(id) + '"]'); if (l) t = clean(l.textContent); }
    if (!t) { const l = el.closest("label"); if (l) t = clean(l.textContent); }
    if (!t) t = clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "");
    if (!t) {
      const row = el.closest("tr, .form-group, .mb-3, .col, div");
      const l = row && row.querySelector("label, th, .form-label");
      if (l) t = clean(l.textContent);
    }
    return t.slice(0, 80);
  }

  function formsOf(doc, path) {
    return [...doc.querySelectorAll("form")].map((f) => {
      const method = (f.getAttribute("method") || "get").toLowerCase();
      const fields = [];
      const seen = new Set();
      f.querySelectorAll("input, select, textarea").forEach((el) => {
        const type = (el.getAttribute("type") || el.tagName).toLowerCase();
        const name = el.getAttribute("name") || "";
        if (!name || type === "submit" || type === "button" || type === "image") return;
        if (type === "hidden") {
          // الاسم فقط: قيمة الرمز تُجلب طازجة وقت التنفيذ ولا تُسجَّل
          fields.push({ name, type: "hidden", token: /token|csrf|_method|authenticity/i.test(name) });
          return;
        }
        if ((type === "radio" || type === "checkbox") && seen.has(name + type)) return;
        seen.add(name + type);
        const o = { name, type, label: labelOf(el, doc), required: el.hasAttribute("required") };
        if (el.tagName === "SELECT") {
          const all = [...el.options];
          // قائمة أشخاص (فيها أرقام هوية) أو طويلة جداً: يُسجَّل عددها فقط، لا أسماؤها
          const people = all.some((op) => /\d{8,}/.test(clean(op.textContent).replace(/\s/g, "")));
          if (people || all.length > 120) {
            o.options = [];
            o.omitted = people ? "قائمة أشخاص — لم تُسجَّل" : "قائمة طويلة — لم تُسجَّل";
            o.count = all.length;
          } else {
            o.options = all.map((op) => ({ v: op.value, t: clean(op.textContent).slice(0, 60) }));
          }
        } else if (type === "radio" || type === "checkbox") {
          o.options = [...f.querySelectorAll('input[name="' + CSS.escape(name) + '"]')].slice(0, 20).map((i) => ({
            v: i.value, t: labelOf(i, doc) || i.value,
          }));
        }
        fields.push(o);
      });
      const submit = [...f.querySelectorAll('button, input[type="submit"]')].map((b) => clean(b.textContent || b.value)).filter(Boolean).slice(0, 4);
      return { page: path, action: pathOf(f.getAttribute("action") || path), method, id: f.id || "", fields, buttons: submit };
    });
  }

  const linksOf = (doc) => {
    const out = new Map();
    doc.querySelectorAll("a[href]").forEach((a) => {
      const p = pathOf(a.getAttribute("href"));
      if (!p || !/^\/admin/.test(p)) return;
      if (!out.has(p)) out.set(p, clean(a.textContent).slice(0, 60));
    });
    return out;
  };

  async function getDoc(path) {
    const res = await fetch(path, { credentials: "same-origin", redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (/login/i.test(new URL(res.url).pathname)) throw new Error("طُلب تسجيل الدخول");
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  const report = { at: new Date().toISOString(), origin: location.origin, pages: [], links: [], skipped: [] };

  // الصفحة الحالية أولاً: افتح صفحة «إضافة طالب» ثم شغّل السكربت لتُقرأ مباشرة
  say("قراءة الصفحة الحالية…");
  const here = location.pathname;
  report.pages.push({ path: here, title: clean(document.title), forms: formsOf(document, here) });
  const all = linksOf(document);

  // صفحات «إضافة/بحث» من القائمة، بطلبات GET فقط
  const todo = [...all].filter(([p, t]) => p !== here && !UNSAFE.test(p) && WANT.test(p + " " + t)).slice(0, 30);
  let i = 0;
  for (const [p, t] of todo) {
    if (stopped) break;
    i++;
    say("(" + i + "/" + todo.length + ") " + (t || p));
    try {
      const doc = await getDoc(p);
      report.pages.push({ path: p, title: clean(doc.title), linkText: t, forms: formsOf(doc, p) });
      linksOf(doc).forEach((tt, pp) => { if (!all.has(pp)) all.set(pp, tt); });
    } catch (e) { report.skipped.push({ path: p, why: e.message }); }
    await sleep(500);
  }
  report.links = [...all].map(([path, text]) => ({ path, text }));

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ksach-forms.json";
  document.body.appendChild(a);
  a.click();
  const nForms = report.pages.reduce((n, p) => n + p.forms.length, 0);
  say("تم: " + report.pages.length + " صفحة، " + nForms + " نموذج، " + report.links.length + " رابطاً. نُزّل ksach-forms.json");
})();
