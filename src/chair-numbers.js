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
  /* حجم الرقم بحسب أطول رقم (عدد الخانات) ليبقى داخل الربع (105×148 مم). مُقاس فعلياً بهامش أمان نحو 8 مم:
     الحدّ الأقصى 265 (خانة/خانتان)، 175 (ثلاث)، 125 (أربع) */
  const digitsOf = (items) => Math.max(1, ...(items || []).map((x) => String(x.n).length));
  const sizeFor = (items) => { const d = digitsOf(items); return d <= 2 ? 250 : d === 3 ? 170 : 120; };
  /* في Word: خط Arial أعرض قليلاً، فأحجام أصغر تمنع كسر الرقم إلى سطرين (عرض الخانة 96 مم) */
  const wordSizeFor = (items) => { const d = digitsOf(items); return d <= 2 ? 230 : d === 3 ? 160 : 118; };

  /* شعارا الزاويتين العلويتين لكل بطاقة: المركز السعودي يميناً وتمكين يساراً (روابط مطلقة لأن الإطار المطبوع وثيقة مستقلة) */
  const abs = (p) => { try { return new URL(p, location.href).href; } catch (e) { return p; } };
  const LOGOS = { right: "assets/logo-maalam.png", left: "assets/logo.png" };
  /* ملاءمة على الجهاز نفسه: عرض الأرقام يختلف باختلاف الخطوط المثبّتة، فبعد تحميل الخطوط تُقاس الأرقام؛
     إن فاض أحدها عرضاً أو طولاً صُغّرت كلها بالنسبة نفسها (تبقى متساوية الحجم)، فلا يُقصّ رقم أبداً */
  const FIT_JS = "(function(){function fit(){var ns=[].slice.call(document.querySelectorAll('.n'));if(!ns.length)return;" +
    "ns.forEach(function(n){n.style.fontSize='';});var s=1;" +
    "ns.forEach(function(n){var q=n.parentElement,w=q.clientWidth-24;if(n.scrollWidth>w)s=Math.min(s,w/n.scrollWidth);" +
    "var over=q.scrollHeight-q.clientHeight;if(over>0){var h=n.getBoundingClientRect().height;s=Math.min(s,Math.max(.3,(h-over-6)/h));}});" +
    "if(s<1){var fs=parseFloat(getComputedStyle(ns[0]).fontSize)*s*.98;ns.forEach(function(n){n.style.fontSize=fs+'px';});}}" +
    "fit();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);window.addEventListener('load',fit);})();";
  function html(items, opts) {
    const o = opts || {}, pt = sizeFor(items), logos = o.logos !== false;
    const lg = logos ? `<img class="lg r" src="${esc(abs(LOGOS.right))}" alt="المركز السعودي للثقافة والتراث"><img class="lg l" src="${esc(abs(LOGOS.left))}" alt="تمكين">` : "";
    const cell = (x) => (x
      ? `<div class="q${logos ? " wl" : ""}">${lg}<div class="n">${esc(x.n)}</div>${o.names && x.name ? `<div class="nm">${esc(x.name)}</div>` : ""}${o.tags && (x.track || x.sex) ? `<div class="tg">${esc([x.track, x.sex].filter(Boolean).join(" · "))}</div>` : ""}</div>`
      : '<div class="q e"></div>');
    const body = pages(items).map((p) => `<section class="pg">${[0, 1, 2, 3].map((i) => cell(p[i])).join("")}</section>`).join("");
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.title || "أرقام الكراسي")}</title><style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: "Tajawal", "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; }
      .pg { width: 210mm; height: 297mm; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); page-break-after: always; break-after: page; overflow: hidden; }
      .pg:last-child { page-break-after: auto; break-after: auto; }
      .q { position: relative; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6mm 4mm; border: 0 dashed #9aa3af; }
      .q.wl { padding-top: 32mm; }
      .lg { position: absolute; top: 6mm; height: 22mm; width: auto; max-width: 40mm; object-fit: contain; }
      .lg.r { right: 6mm; }
      .lg.l { left: 6mm; height: 17mm; top: 8mm; }
      .q:nth-child(1) { border-left-width: .3mm; border-bottom-width: .3mm; }
      .q:nth-child(2) { border-bottom-width: .3mm; }
      .q:nth-child(3) { border-left-width: .3mm; }
      .n { font-size: ${pt}pt; font-weight: 800; line-height: 1; letter-spacing: -.04em; font-variant-numeric: lining-nums; direction: ltr; white-space: nowrap; }
      .nm { font-size: 18pt; font-weight: 700; margin-top: 7mm; line-height: 1.35; max-width: 90mm; }
      .tg { font-size: 12pt; margin-top: 3mm; color: #555; }
      @media screen { body { background: #e5e7eb; } .pg { background: #fff; margin: 8mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }
    </style></head><body>${body}<script>${FIT_JS}</script></body></html>`;
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
    // ننتظر الخطوط والشعارات قبل الطباعة (وإلا خرجت الأوراق بلا شعار)
    const imgs = [...d.images].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; })));
    const ready = Promise.all([d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve()].concat(imgs));
    ready.then(() => setTimeout(go, 50), () => setTimeout(go, 50));
    return true;
  }

  /* ===== ملف Word (.docx): A4، جدول بعمودين وصفّين بارتفاع ثابت لكل صفحة، فيمكن تعديله وطباعته من Word ===== */
  const xe = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const pngSize = (u8) => (u8 && u8.length > 24 && u8[1] === 0x50 ? { w: (u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19]) >>> 0, h: (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0 } : { w: 1, h: 1 });
  async function logoBytes(path) { const r = await fetch(abs(path)); if (!r.ok) throw new Error("تعذّر تحميل الشعار " + path); return new Uint8Array(await r.arrayBuffer()); }
  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 284, COL = Math.floor((PAGE_W - 2 * MARGIN) / 2), ROW = 8100;
  async function docx(items, opts) {
    const o = opts || {}, logos = o.logos !== false, pt = wordSizeFor(items), EMU = 36000;   // 1 مم = 36000 EMU
    const zip = new JSZip(), media = [];
    let pid = 1;
    if (logos) {
      const right = o.logoBytes ? o.logoBytes.right : await logoBytes(LOGOS.right), left = o.logoBytes ? o.logoBytes.left : await logoBytes(LOGOS.left);
      media.push({ rid: "rIdLogoR", file: "logo-right.png", bytes: right, hmm: 22 }, { rid: "rIdLogoL", file: "logo-left.png", bytes: left, hmm: 17 });
      media.forEach((m) => { const s = pngSize(m.bytes); m.cy = Math.round(m.hmm * EMU); m.cx = Math.round(m.cy * s.w / s.h); zip.file("word/media/" + m.file, m.bytes); });
    }
    const img = (m) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${m.cx}" cy="${m.cy}"/><wp:docPr id="${pid++}" name="شعار ${pid}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${m.file}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const nil = (tags) => tags.map((t) => `<w:${t} w:val="nil"/>`).join("");
    const half = Math.floor((COL - 226) / 2);
    const logoTbl = () => `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${COL - 226}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${nil(["top", "left", "bottom", "right", "insideH", "insideV"])}</w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="170" w:after="0"/></w:pPr>${img(media[0])}</w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="280" w:after="0"/></w:pPr>${img(media[1])}</w:p></w:tc></w:tr></w:tbl>`;
    const numLine = Math.round(pt * 20 * 1.05), logoH = logos ? 1450 : 0;
    const cell = (x) => {
      let body = "";
      if (x) {
        const extra = (o.names && x.name ? 760 : 0) + (o.tags && (x.track || x.sex) ? 420 : 0);
        const before = Math.max(120, Math.round((ROW - logoH - numLine - extra) / 2) - 120);
        if (logos) body += logoTbl();
        body += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="${before}" w:after="0" w:line="${numLine}" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:spacing w:val="-${Math.round(pt * 20 * 0.04)}"/><w:sz w:val="${pt * 2}"/><w:szCs w:val="${pt * 2}"/></w:rPr><w:t>${xe(x.n)}</w:t></w:r></w:p>`;
        if (o.names && x.name) body += `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/><w:spacing w:before="260" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:rtl/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr><w:t xml:space="preserve">${xe(x.name)}</w:t></w:r></w:p>`;
        if (o.tags && (x.track || x.sex)) body += `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/><w:spacing w:before="80" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl/><w:color w:val="555555"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${xe([x.track, x.sex].filter(Boolean).join(" · "))}</w:t></w:r></w:p>`;
      } else body = "<w:p/>";
      return `<w:tc><w:tcPr><w:tcW w:w="${COL}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${body}</w:tc>`;
    };
    const rows = [];
    for (let i = 0; i < items.length; i += 2) rows.push(`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${ROW}" w:hRule="exact"/></w:trPr>${cell(items[i])}${cell(items[i + 1])}</w:tr>`);
    const dash = (t) => `<w:${t} w:val="dashed" w:sz="4" w:space="0" w:color="9AA3AF"/>`;
    const tbl = `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${COL * 2}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblBorders>${nil(["top", "left", "bottom", "right"])}${dash("insideH")}${dash("insideV")}</w:tblBorders><w:tblCellMar><w:left w:w="113" w:type="dxa"/><w:right w:w="113" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${COL}"/><w:gridCol w:w="${COL}"/></w:tblGrid>${rows.join("")}</w:tbl>`;
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${tbl}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p><w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="0" w:footer="0" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
    zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.file}"/>`).join("") + "</Relationships>");
    zip.file("word/document.xml", doc);
    return zip.generateAsync({ type: o.type || "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  App.chairNumbers = { PER_PAGE, pages, html, print, sizeFor, wordSizeFor, docx, LOGOS };
})(window.App = window.App || {});
