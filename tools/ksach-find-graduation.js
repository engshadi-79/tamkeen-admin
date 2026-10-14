/* البحث عن «تخريج الطلاب» أو زرّ التخرّج في نظام المركز (tamkeen.ksach.org)
   ────────────────────────────────────────────────────────────────────────
   افتح النظام وأنت مسجّل دخولك، ثم F12 ← تبويب Console، والصق هذا الملف كله واضغط Enter.

   ماذا يفعل: يزور صفحات لوحة الإدارة قراءةً فقط (طلبات GET)، ويبحث في كل صفحة عن
   أي ذكر للتخرّج: زرّ، أو رابط، أو خيار في قائمة، أو عمود في جدول، أو نصّ عادي.
   ثم يعرض النتائج مرتّبة: الأزرار والروابط أولاً (لأنها هي «زرّ التخرّج» المطلوب)،
   ثم الخيارات والأعمدة، ثم النصوص.

   ما لا يفعل: لا يضغط أي زرّ، ولا يرسل أي نموذج، ولا يفتح رابط حذف أو تعديل أو خروج،
   ولا يرسل شيئاً إلى أي خادم خارجي. النتيجة تبقى عندك: تُعرض، وتُنسخ، وتُنزَّل ملفاً. */

(async () => {
  const DELAY = 300;        // مهلة بين الطلبات حتى لا نثقل على الخادم
  const MAX_PAGES = 90;     // سقف الصفحات المزارة
  const origin = location.origin;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  /* تطبيع عربي: الهمزات والتاء المربوطة والتشكيل، حتى يتطابق «تخرُّج» و«التخرج» */
  const norm = (s) => clean(s).toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

  /* ما نبحث عنه */
  const WORDS = [/تخرج/, /تخريج/, /متخرج/, /خريج/, /graduat/i, /\bgrad\b/i];
  const hit = (s) => { const n = norm(s); return WORDS.some((re) => re.test(n)); };

  /* روابط لا تُفتح أبداً: تغيّر البيانات أو تُنهي الجلسة */
  const UNSAFE = /logout|signout|sign-out|delete|destroy|remove|revoke|reset|export|download|print|\.pdf|\.xlsx|\.csv/i;
  /* صفحات يُرجَّح أن يكون التخرّج فيها، تُجرَّب ولو لم ترد في القائمة */
  const SEEDS = [
    "/admin/dashboard", "/admin/students", "/admin/student-grades", "/admin/certificates",
    "/admin/courses", "/admin/groups", "/admin/tracks", "/admin/reports",
    "/admin/graduates", "/admin/graduation", "/admin/student-graduation", "/admin/graduate-students",
  ];

  /* ===== لوحة صغيرة تبيّن ما يجري ===== */
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;inset-inline-end:16px;bottom:16px;width:min(560px,94vw);max-height:80vh;overflow:auto;background:#14284b;color:#eaf0f8;font:13px/1.8 Tahoma,Arial;border-radius:12px;padding:14px;direction:rtl;box-shadow:0 10px 40px rgba(0,0,0,.45)";
  const BTN = "background:#0f8b8d;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;margin-inline-start:6px";
  box.innerHTML = `<b>🎓 البحث عن التخرّج في النظام</b>
    <div data-s style="margin-top:6px;white-space:pre-line;color:#b9c9e2"></div>
    <div data-out style="margin-top:10px"></div>
    <div style="margin-top:10px">
      <button data-copy style="${BTN}" disabled>نسخ النتيجة</button>
      <button data-save style="${BTN}" disabled>تنزيل ملف</button>
      <button data-close style="background:#b93a2e;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit">إغلاق</button>
    </div>`;
  document.body.appendChild(box);
  const say = (m) => { box.querySelector("[data-s]").textContent = m; };
  let stopped = false;
  box.querySelector("[data-close]").addEventListener("click", () => { stopped = true; box.remove(); });

  /* ===== القراءة ===== */
  async function getDoc(path) {
    const res = await fetch(origin + path, { credentials: "include" });
    if (/login|signin/i.test(res.url)) throw new Error("انتهت الجلسة — سجّل الدخول وأعد التشغيل");
    if (!res.ok) throw new Error(`${res.status}`);
    await sleep(DELAY);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  /* مسار داخلي نظيف بلا ترقيم صفحات ولا وسوم */
  function pathOf(href) {
    try {
      const u = new URL(href, origin);
      if (u.origin !== origin) return "";
      if (!/^\/admin\b/.test(u.pathname)) return "";
      u.searchParams.delete("page");
      return u.pathname + (u.search || "");
    } catch (e) { return ""; }
  }

  /* صفّ الجدول الذي يقع فيه العنصر: يبيّن على أي طالب يعمل الزرّ */
  function rowOf(el) {
    const tr = el.closest("tr");
    if (!tr) return "";
    const cells = [...tr.children].slice(0, 3).map((td) => clean(td.textContent)).filter(Boolean);
    return cells.join(" · ").slice(0, 90);
  }

  /* النموذج الذي يتبعه الزرّ: يبيّن ماذا سيُرسل ولأي مسار */
  function formOf(el) {
    const f = el.closest("form");
    if (!f) return null;
    const action = f.getAttribute("action") || "";
    const method = clean((f.getAttribute("method") || "GET")).toUpperCase();
    const fields = [...f.querySelectorAll("input[name],select[name],textarea[name]")]
      .map((i) => i.getAttribute("name")).filter((n) => n && !/^_/.test(n)).slice(0, 8);
    return { action, method, fields };
  }

  const found = [];
  const add = (o) => { if (!found.some((x) => x.page === o.page && x.kind === o.kind && x.text === o.text && x.href === o.href)) found.push(o); };

  /* البحث داخل صفحة واحدة */
  function scan(doc, path) {
    const title = clean((doc.querySelector("h1,h2,.page-title,title") || {}).textContent || "");

    // ١) الأزرار والروابط: هي المطلوب الأول
    doc.querySelectorAll("a,button,input[type=submit],input[type=button]").forEach((el) => {
      const label = clean(el.textContent) || clean(el.getAttribute("value") || "")
        || clean(el.getAttribute("aria-label") || "") || clean(el.getAttribute("title") || "");
      const href = el.tagName === "A" ? (el.getAttribute("href") || "") : "";
      if (!hit(label) && !hit(href)) return;
      add({
        kind: el.tagName === "A" ? "رابط" : "زرّ",
        page: path, pageTitle: title, text: label || "(بلا نص)",
        href: href ? pathOf(href) || href : "",
        row: rowOf(el), form: formOf(el),
        html: clean(el.outerHTML).slice(0, 220),
      });
    });

    // ٢) خيارات القوائم المنسدلة: «الحالة: متخرج» مثلاً
    doc.querySelectorAll("select").forEach((sel) => {
      const opts = [...sel.options].filter((o) => hit(o.textContent) || hit(o.value));
      if (!opts.length) return;
      add({
        kind: "خيار في قائمة", page: path, pageTitle: title,
        text: opts.map((o) => `${clean(o.textContent)}${o.value ? ` = ${o.value}` : ""}`).join(" | "),
        href: "", row: clean((sel.closest("label") || sel.parentElement || {}).textContent || "").slice(0, 60),
        select: sel.getAttribute("name") || "", form: formOf(sel), html: "",
      });
    });

    // ٣) رؤوس الأعمدة: عمود اسمه «تاريخ التخرّج» مثلاً
    doc.querySelectorAll("th").forEach((th) => {
      if (!hit(th.textContent)) return;
      add({ kind: "عمود في جدول", page: path, pageTitle: title, text: clean(th.textContent), href: "", row: "", html: "" });
    });

    // ٤) نصوص عادية: بطاقات ورسائل وعناوين
    doc.querySelectorAll("h1,h2,h3,h4,h5,label,span,p,td,div,li").forEach((el) => {
      if (el.children.length) return;                 // أصغر عنصر يحمل النص
      const t = clean(el.textContent);
      if (!t || t.length > 160 || !hit(t)) return;
      add({ kind: "نصّ", page: path, pageTitle: title, text: t, href: "", row: rowOf(el), html: "" });
    });

    // روابط الصفحة للزيارة لاحقاً
    const links = new Set();
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (UNSAFE.test(href)) return;
      const p = pathOf(href);
      if (p) links.add(p);
    });
    return [...links];
  }

  /* ===== الزحف المحدود: البذور ثم روابط لوحة الإدارة ===== */
  const queue = [...SEEDS];
  const seen = new Set();
  const failed = [];
  let visited = 0;

  while (queue.length && visited < MAX_PAGES && !stopped) {
    const path = queue.shift();
    const key = path.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    say(`يقرأ (${visited + 1}): ${path}\nوُجد حتى الآن: ${found.length}`);
    let doc = null;
    try { doc = await getDoc(path); }
    catch (e) { failed.push(`${path} — ${e.message}`); continue; }
    visited++;
    const links = scan(doc, path);
    // من صفحة اللوحة وحدها نأخذ كل روابطها (القائمة الجانبية)، ومن غيرها ما يذكر التخرّج
    if (/dashboard/.test(path)) links.forEach((l) => { if (!seen.has(l.split("?")[0])) queue.push(l); });
    else links.forEach((l) => { if (hit(l) && !seen.has(l.split("?")[0])) queue.push(l); });
  }
  if (stopped) return;

  /* ===== العرض ===== */
  const ORDER = { "زرّ": 0, "رابط": 1, "خيار في قائمة": 2, "عمود في جدول": 3, "نصّ": 4 };
  found.sort((a, b) => (ORDER[a.kind] - ORDER[b.kind]) || a.page.localeCompare(b.page));

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const out = box.querySelector("[data-out]");
  if (!found.length) {
    out.innerHTML = `<div style="background:#3a1a17;border-radius:8px;padding:10px">
      لم يُعثر على أي ذكر للتخرّج في ${visited} صفحة.
      <div style="color:#b9c9e2;margin-top:6px">قد تكون الصفحة خلف رابط لم تُزَر. افتح الصفحة التي تظنّها وأعد تشغيل السكربت منها.</div></div>`;
  } else {
    const groups = {};
    found.forEach((f) => { (groups[f.kind] = groups[f.kind] || []).push(f); });
    out.innerHTML = Object.keys(groups).map((k) => `
      <div style="margin-bottom:10px">
        <div style="color:#7fd6d8;font-weight:700">${esc(k)} — ${groups[k].length}</div>
        ${groups[k].slice(0, 12).map((f) => `
          <div style="background:#1d3866;border-radius:8px;padding:8px 10px;margin-top:6px">
            <div><b>${esc(f.text)}</b></div>
            <div style="color:#b9c9e2;font-size:12px">في: ${esc(f.pageTitle || f.page)} — <code style="direction:ltr;display:inline-block">${esc(f.page)}</code></div>
            ${f.href ? `<div style="color:#9fd6d7;font-size:12px;direction:ltr">↪ ${esc(f.href)}</div>` : ""}
            ${f.form ? `<div style="color:#e3a646;font-size:12px;direction:ltr">${esc(f.form.method)} ${esc(f.form.action)} ${f.form.fields.length ? `(${esc(f.form.fields.join(", "))})` : ""}</div>` : ""}
            ${f.row ? `<div style="color:#b9c9e2;font-size:12px">الصف: ${esc(f.row)}</div>` : ""}
          </div>`).join("")}
        ${groups[k].length > 12 ? `<div style="color:#b9c9e2;font-size:12px;margin-top:4px">و${groups[k].length - 12} غيرها في الملف</div>` : ""}
      </div>`).join("");
  }
  say(`انتهى: ${visited} صفحة مقروءة، ${found.length} نتيجة${failed.length ? `، ${failed.length} صفحة تعذّرت` : ""}`);

  const report = { site: origin, at: new Date().toISOString(), visited, failed, found };
  const text = JSON.stringify(report, null, 1);
  const copy = box.querySelector("[data-copy]"), save = box.querySelector("[data-save]");
  copy.disabled = save.disabled = false;
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "نُسخت ✓"; }
    catch (e) { console.log(text); copy.textContent = "طُبعت في Console"; }
  });
  save.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = `بحث-التخرج-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  console.log("%c🎓 نتيجة البحث عن التخرّج", "font:700 14px Tahoma", report);
})();
