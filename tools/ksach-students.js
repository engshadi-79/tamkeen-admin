/* قارئ بيانات الطلاب — من نظام المركز (tamkeen.ksach.org) إلى موقع تمكين

   الاستعمال: افتح النظام وأنت مسجّل دخولك، واضغط F12 ← تبويب Console،
   والصق هذا الملف كله واضغط Enter. سينزّل على جهازك ملفاً باسم
   «نظام-المركز-الطلاب.json»، ترفعه في صفحة «محوّل القوالب» ← «إكمال الناقص
   من نظام المركز» مع ملفك الناقص، فيُكمَل بالمطابقة برقم الهوية.

   ماذا يفعل: يقرأ صفحة الطلاب قراءةً فقط (طلبات GET)، ويأخذ كل أعمدتها كما
   سمّاها النظام. لا يضغط زراً، ولا يفتح رابط تعديل أو حذف أو تصدير،
   ولا يرسل شيئاً إلى أي خادم — الملف ينزل على جهازك وحدك. */

(async () => {
  const origin = location.origin;
  const DELAY = 280;            // مهلة بين الطلبات حتى لا يُثقَل النظام
  const MAX_PAGES = 200;
  const PER_PAGE = 200;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  /* ===== لوحة صغيرة تُظهر ما يجري ===== */
  const box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "position:fixed;inset-block-start:14px;inset-inline-start:14px;z-index:2147483647;" +
    "background:#14284B;color:#fff;font:14px/1.7 system-ui,'Segoe UI',sans-serif;padding:14px 16px;" +
    "border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:380px";
  box.innerHTML = '<b style="font-size:15px">قراءة طلاب النظام</b><div id="kx-say" style="margin-top:6px;opacity:.9"></div><div id="kx-act" style="margin-top:10px"></div>';
  document.body.appendChild(box);
  const say = (t) => { box.querySelector("#kx-say").textContent = t; };
  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "margin-inline-end:8px;margin-top:6px;padding:8px 14px;border:0;border-radius:8px;" +
      "background:#0F8B8D;color:#fff;font:600 13px system-ui;cursor:pointer";
    b.onclick = fn;
    box.querySelector("#kx-act").appendChild(b);
    return b;
  };

  /* ===== قراءة الصفحات ===== */
  async function getDoc(path) {
    const res = await fetch(origin + path, { credentials: "include" });
    if (/login|signin/i.test(res.url)) throw new Error("انتهت الجلسة؛ ادخل من جديد وأعد التشغيل");
    if (!res.ok) throw new Error(`${res.status} عند ${path}`);
    await sleep(DELAY);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  /* ترويسة الجدول ولو كانت على صفّين مدموجين */
  function headOf(table) {
    const trs = [...table.querySelectorAll("thead tr")];
    if (!trs.length) return [];
    if (trs.length === 1) return [...trs[0].children].map((c) => clean(c.textContent));
    const grid = [];
    trs.forEach((tr, r) => {
      let c = 0;
      [...tr.children].forEach((el) => {
        while (grid[r] && grid[r][c] !== undefined) c++;
        const cs = Number(el.colSpan) || 1, rs = Number(el.rowSpan) || 1, text = clean(el.textContent);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { grid[r + i] = grid[r + i] || []; grid[r + i][c + j] = text; }
        c += cs;
      });
    });
    const leaf = grid[grid.length - 1] || [], top = grid[0] || [];
    return leaf.map((v, i) => v || top[i] || "");
  }

  function tables(doc) {
    return [...doc.querySelectorAll("table")].map((t) => {
      let head = headOf(t);
      let trs = [...t.querySelectorAll("tr")].filter((r) => !r.closest("thead"));
      if (!head.length && trs.length) { head = [...trs[0].children].map((c) => clean(c.textContent)); trs = trs.slice(1); }
      const rows = trs.map((tr) => [...tr.children].map((c) => clean(c.textContent))).filter((r) => r.length > 1);
      return { head, rows };
    }).filter((t) => t.rows.length);
  }
  const pick = (list, ...need) => list.find((t) => need.every((re) => t.head.some((h) => re.test(h))));

  /* رقم الهوية: تسعة أرقام أو أكثر في الخلية */
  const nidOf = (s) => (clean(s).match(/\b\d{9,}\b/) || [""])[0];
  /* الاسم: أول سطر غير رقمي في الخلية */
  const nameOf = (s) => clean(String(s).split(/\n|\s{2,}/).find((x) => clean(x) && !/^\d+$/.test(clean(x))) || s);

  const seen = new Set();
  const out = [];
  const cols = new Set();

  function eat(t) {
    const idx = t.head.findIndex((h) => /الطالب|الاسم/.test(h));
    t.rows.forEach((r) => {
      const raw = idx >= 0 ? r[idx] : r[0];
      const name = nameOf(raw);
      if (!name) return;
      // الهوية قد تكون في عمودها أو داخل خلية الاسم
      let nid = "";
      t.head.forEach((h, i) => { if (!nid && /هوية|الهويه|رقم الهوية/.test(h)) nid = nidOf(r[i]); });
      if (!nid) nid = nidOf(raw);
      const key = nid || name;
      if (seen.has(key)) return;
      seen.add(key);
      const rec = { "رقم الهوية": nid, "الاسم": name };
      t.head.forEach((h, i) => {
        const k = clean(h);
        const v = clean(r[i]);
        if (!k || !v || v === "-" || v === "—") return;
        if (/^(#|م|إجراءات|العمليات|خيارات)$/.test(k)) return;
        if (rec[k] === undefined) { rec[k] = v; cols.add(k); }
      });
      out.push(rec);
    });
  }

  async function eachPage(path, label, need) {
    let lastFirst = "";
    let wide = true;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const url = (w) => `${path}${sep}${w ? `per_page=${PER_PAGE}&` : ""}page=${page}`;
      let t = null;
      for (const w of wide ? [true, false] : [false]) {
        let doc;
        try { doc = await getDoc(url(w)); } catch (e) { if (w) continue; throw e; }
        t = pick(tables(doc), ...need);
        if (t && t.rows.length) { wide = w; break; }
        if (!w) break;
      }
      if (!t || !t.rows.length) return;
      const first = t.rows[0].join("|");
      if (first === lastFirst) return;          // النظام يعيد الصفحة نفسها: انتهى
      lastFirst = first;
      say(`${label} — صفحة ${page} · ${out.length} طالباً`);
      eat(t);
    }
  }

  /* ===== التشغيل ===== */
  try {
    say("جارٍ فتح صفحة الطلاب…");
    const first = await getDoc("/admin/students");
    const t0 = pick(tables(first), /الطالب|الاسم/);
    if (t0 && t0.rows.length) {
      await eachPage("/admin/students", "الطلاب", [/الطالب|الاسم/]);
    }
    // لا صفوف بلا فلتر: تُقرأ كل دورة على حدة
    if (!out.length) {
      const sel = [...first.querySelectorAll("select[name]")]
        .find((s) => /course|training|دورة|مرحلة/i.test(s.getAttribute("name") || ""));
      if (sel) {
        const opts = [...sel.options].filter((o) => o.value);
        for (let i = 0; i < opts.length; i++) {
          say(`الدورة ${i + 1} من ${opts.length}…`);
          await eachPage(`/admin/students?${encodeURIComponent(sel.getAttribute("name"))}=${encodeURIComponent(opts[i].value)}`,
            `دورة ${i + 1}/${opts.length}`, [/الطالب|الاسم/]);
        }
      }
    }

    if (!out.length) {
      say("لم يُعثر على جدول طلاب. افتح صفحة الطلاب يدوياً ثم أعد التشغيل.");
      return;
    }

    const withNid = out.filter((r) => r["رقم الهوية"]).length;
    say(`تمّ: ${out.length} طالباً، منهم ${withNid} برقم هوية · ${cols.size} حقلاً`);

    const payload = { source: "tamkeen.ksach.org", at: new Date().toISOString(), count: out.length, rows: out };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const dl = document.createElement("a");
    dl.href = url;
    dl.download = "نظام-المركز-الطلاب.json";
    document.body.appendChild(dl);
    dl.click();

    btn("⬇ تنزيل الملف مرة أخرى", () => dl.click());
    btn("إغلاق", () => { URL.revokeObjectURL(url); box.remove(); });
    console.log("طلاب النظام:", out);
  } catch (e) {
    say("تعذّر: " + e.message);
    btn("إغلاق", () => box.remove());
  }
})();
