/* أرقام كراسي الاحتفال: ورقة A4 مقسّمة إلى أربعة أرباع (2×2)، في كل ربع رقم كبير، بخطوط قصّ متقطّعة.
   الأرقام تأتي جاهزة بترتيبها (App.pledgeSheet.chairs). يُطبع من إطار مستقل بمقاس A4 بلا ترويسة،
   فلا يتأثر بإعدادات طباعة المستندات الرسمية (Letter). */
(function (App) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const PER_PAGE = 4;

  /* items ← صفحات من أربعة (ترتيب القراءة من اليمين: أعلى يمين، أعلى يسار، أسفل يمين، أسفل يسار) */
  function pages(items) {
    const out = [];
    for (let i = 0; i < (items || []).length; i += PER_PAGE) out.push(items.slice(i, i + PER_PAGE));
    return out;
  }
  /* حجم الرقم بحسب أطول رقم (عدد الخانات) ليبقى داخل الربع (105×148 مم) */
  const sizeFor = (items) => { const d = Math.max(1, ...(items || []).map((x) => String(x.n).length)); return d <= 2 ? 200 : d === 3 ? 150 : 115; };

  function html(items, opts) {
    const o = opts || {}, pt = sizeFor(items);
    const cell = (x) => (x
      ? `<div class="q"><div class="n">${esc(x.n)}</div>${o.names && x.name ? `<div class="nm">${esc(x.name)}</div>` : ""}${o.tags && (x.track || x.sex) ? `<div class="tg">${esc([x.track, x.sex].filter(Boolean).join(" · "))}</div>` : ""}</div>`
      : '<div class="q e"></div>');
    const body = pages(items).map((p) => `<section class="pg">${[0, 1, 2, 3].map((i) => cell(p[i])).join("")}</section>`).join("");
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.title || "أرقام الكراسي")}</title><style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: "Tajawal", "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; }
      .pg { width: 210mm; height: 297mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; page-break-after: always; break-after: page; overflow: hidden; }
      .pg:last-child { page-break-after: auto; break-after: auto; }
      .q { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8mm; border: 0 dashed #9aa3af; }
      .q:nth-child(1) { border-left-width: .3mm; border-bottom-width: .3mm; }
      .q:nth-child(2) { border-bottom-width: .3mm; }
      .q:nth-child(3) { border-left-width: .3mm; }
      .n { font-size: ${pt}pt; font-weight: 800; line-height: 1; letter-spacing: -.02em; font-variant-numeric: lining-nums; direction: ltr; }
      .nm { font-size: 18pt; font-weight: 700; margin-top: 7mm; line-height: 1.35; max-width: 90mm; }
      .tg { font-size: 12pt; margin-top: 3mm; color: #555; }
      @media screen { body { background: #e5e7eb; } .pg { background: #fff; margin: 8mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }
    </style></head><body>${body}</body></html>`;
  }

  /* يطبع من إطار مخفي (لا نافذة منبثقة تُحجب) */
  function print(items, opts) {
    if (!items || !items.length) return false;
    const fr = document.createElement("iframe");
    fr.setAttribute("aria-hidden", "true");
    fr.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.open(); d.write(html(items, opts)); d.close();
    const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } finally { setTimeout(() => fr.remove(), 60000); } };
    const ready = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
    ready.then(() => setTimeout(go, 50), () => setTimeout(go, 50));
    return true;
  }

  App.chairNumbers = { PER_PAGE, pages, html, print, sizeFor };
})(window.App = window.App || {});
