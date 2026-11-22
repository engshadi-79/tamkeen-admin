/* إنشاء ملف Word (docx) على الترويسة الرسمية داخل المتصفح بلا مكتبات خارجية */
(function (App) {
  const FONT = "Sakkal Majalla";

  /* ===== ZIP بطريقة التخزين (بدون ضغط) ===== */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    files.forEach(({ name, data }) => {
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // أسماء بترميز UTF-8
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      chunks.push(local.buffer, nameBytes, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    const centralSize = central.reduce((s, c) => s + c.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, end.buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  /* ===== محتوى المستند ===== */
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // في الفقرات ثنائية الاتجاه: left = بداية السطر (اليمين)، right = نهايته (اليسار)
  const ALIGN = { para: "both", title: "center", bold: "left", end: "right", meta: "right" };
  const SIZE = 28; // 14pt لنصوص المراسلات والتقارير (والكتلة قد تحدد حجمها بـ sizePt)
  const DEFAULT_SIZE = SIZE;

  const run = (text, bold) => text
    ? `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>${bold ? "<w:b/><w:bCs/>" : ""}` +
      `<w:sz w:val="${SIZE}"/><w:szCs w:val="${SIZE}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`
    : "";

  const TAB = `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="${SIZE}"/><w:szCs w:val="${SIZE}"/><w:rtl/></w:rPr><w:tab/></w:r>`;

  // سطر يبدأ من الهامش الأيمن مع موضع جدولة (بالنقاط من بداية السطر)
  const tabbedPara = (runs, tabPt) =>
    // ترتيب عناصر pPr إلزامي في Word: tabs قبل bidi
    `<w:p><w:pPr>${tabPt ? `<w:tabs><w:tab w:val="left" w:pos="${Math.round(tabPt * 20)}"/></w:tabs>` : ""}<w:bidi/>` +
    `<w:spacing w:before="0" w:after="0" w:line="264" w:lineRule="auto"/><w:jc w:val="left"/>` +
    `<w:rPr><w:rtl/><w:b/><w:bCs/><w:sz w:val="${SIZE}"/><w:szCs w:val="${SIZE}"/></w:rPr></w:pPr>${runs}</w:p>`;

  /* سطر المرسل إليه: الاسم ثابت عند بداية السطر، «المحترم» بعده، والصفة في منتصفه تحته */
  function addressee(block) {
    const pos = App.templates.addresseeLayout(block);
    let out = tabbedPara(run(block.name, true) + (block.honorific ? TAB + run(block.honorific, true) : ""), block.honorific ? pos.honorificStart : 0);
    if (block.title) {
      out += pos.titleStart > 0.5
        ? tabbedPara(TAB + run(block.title, true), pos.titleStart)
        : tabbedPara(run(block.title, true), 0);
    }
    return out;
  }

  /* ===== الجداول ===== */
  const TEXT_WIDTH_TWIPS = 9360; // عرض منطقة النص (6.5 إنش) بين هامشَي الترويسة
  const TABLE_SIZE = 24; // 12pt داخل الجداول

  const cellPara = (text, jc, bold) =>
    `<w:p><w:pPr><w:bidi/><w:spacing w:before="20" w:after="20"/><w:jc w:val="${jc}"/>` +
    `<w:rPr><w:rtl/><w:sz w:val="${TABLE_SIZE}"/><w:szCs w:val="${TABLE_SIZE}"/></w:rPr></w:pPr>` +
    (text === "" || text == null ? "" :
      `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>${bold ? "<w:b/><w:bCs/>" : ""}` +
      `<w:sz w:val="${TABLE_SIZE}"/><w:szCs w:val="${TABLE_SIZE}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`) +
    `</w:p>`;

  function table(block) {
    const n = block.headers.length;
    const widths = (block.widths || Array(n).fill(1 / n)).map((f) => Math.round(f * TEXT_WIDTH_TWIPS));
    const border = ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="7F8C9D"/>`).join("");
    const cell = (text, i, header) =>
      `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="DFF4F4"/>' : ""}<w:vAlign w:val="center"/></w:tcPr>` +
      cellPara(text == null ? "" : String(text), header || (block.align && block.align[i] === "center") ? "center" : "left", header) + `</w:tc>`;
    const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.headers.map((h, i) => cell(h, i, true)).join("")}</w:tr>`;
    const rowH = block.rowHeightTw ? `<w:trHeight w:val="${Math.round(block.rowHeightTw)}" w:hRule="atLeast"/>` : "";   // ارتفاع أدنى للصف (مثلاً خانة توقيع)
    const rows = block.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/>${rowH}</w:trPr>${r.map((c, i) => cell(c, i, false)).join("")}</w:tr>`).join("");
    return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${TEXT_WIDTH_TWIPS}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr>` +
      `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${headerRow}${rows}</w:tbl>` +
      // Word يدمج جدولين متتاليين؛ فقرة فارغة صغيرة بعده
      `<w:p><w:pPr><w:bidi/><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="12"/></w:rPr></w:pPr></w:p>`;
  }

  /* ===== الصور (الرسوم البيانية) ===== */
  const EMU_PER_PT = 12700;
  let imageSeq = 0;

  function image(block, media) {
    const idx = media.length + 1;
    const relId = `rIdTkImg${idx}`;
    media.push({ relId, name: `word/media/tamkeen_img${idx}.png`, data: dataUrlToBytes(block.src) });
    const cx = Math.round(block.widthPt * EMU_PER_PT);
    const cy = Math.round(block.heightPt * EMU_PER_PT);
    const docPrId = 90000 + (++imageSeq);
    return `<w:p><w:pPr><w:bidi/><w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Chart ${idx}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="tamkeen_img${idx}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  function dataUrlToBytes(dataUrl) {
    return base64ToBytes(String(dataUrl).split(",")[1] || "");
  }

  function paragraph(block, media) {
    if (block.kind === "table") return table(block);
    if (block.kind === "pagebreak") return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>`;
    if (block.kind === "image") return image(block, media);
    if (block.kind === "addressee") return addressee(block);
    if (block.kind === "signature") {
      // التوقيع: كل سطر في منتصف أطول سطر، والكتلة عند الهامش الأيسر
      const starts = App.templates.signatureLayout(block.lines);
      return block.lines.map((t, i) => tabbedPara(TAB + run(t, true), starts[i] || 0.01)).join("");
    }
    const bold = block.kind === "title" || block.kind === "bold" || block.kind === "end";
    const size = block.sizePt ? block.sizePt * 2 : DEFAULT_SIZE;
    const textRun = block.text
      ? `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>${bold ? "<w:b/><w:bCs/>" : ""}` +
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xmlEsc(block.text)}</w:t></w:r>`
      : "";
    return `<w:p><w:pPr><w:bidi/><w:spacing w:before="0" w:after="0" w:line="264" w:lineRule="auto"/>` +
      `<w:jc w:val="${ALIGN[block.kind] || "both"}"/><w:rPr><w:rtl/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>${textRun}</w:p>`;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  let cachedParts;

  /* ملف الترويسة ١٫٢ ميغا ولا يلزم إلا عند تصدير Word، فلا يُحمَّل مع الصفحة بل بعد
     أن تصير جاهزة للعمل. ومن ضغط «تصدير» في أول ثانيتين يُطلب منه إعادة المحاولة
     بدل أن يرى خطأً غامضاً. */
  let loading = null;
  function load() {
    if (App.letterheadDocx) return Promise.resolve(true);
    if (!loading) {
      loading = new Promise((done) => {
        const mine = document.querySelector('script[src*="src/docx.js"]');
        const v = (String(mine && mine.src).match(/[?&]v=(\d+)/) || [])[1];
        const el = document.createElement("script");
        el.src = `src/letterhead-docx.js${v ? `?v=${v}` : ""}`;
        el.addEventListener("load", () => done(true));
        el.addEventListener("error", () => { loading = null; done(false); });
        document.head.appendChild(el);
      });
    }
    return loading;
  }
  // بعد أن تهدأ الصفحة: يكون جاهزاً قبل أن يحتاجه أحد غالباً
  if (typeof window !== "undefined") {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    window.addEventListener("load", () => idle(() => load()), { once: true });
  }

  function build(blocks) {
    const tpl = App.letterheadDocx;
    if (!tpl) { load(); throw new Error("ملف الترويسة قيد التحميل — أعد المحاولة بعد لحظة"); }
    if (!cachedParts) {
      cachedParts = Object.entries(tpl.parts).map(([name, b64]) => ({ name, data: base64ToBytes(b64) }));
    }
    const media = [];
    const documentXml = tpl.documentPrefix + blocks.map((b) => paragraph(b, media)).join("") + tpl.documentSuffix;
    const enc = new TextEncoder();

    // الصور تُضاف كملفات وسائط مع علاقاتها في document.xml.rels
    const RELS = "word/_rels/document.xml.rels";
    let parts = cachedParts;
    if (media.length) {
      const relsPart = cachedParts.find((p) => p.name === RELS);
      const relsXml = new TextDecoder().decode(relsPart.data).replace("</Relationships>",
        media.map((m) => `<Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name.replace("word/", "")}"/>`).join("") +
        "</Relationships>");
      parts = cachedParts.filter((p) => p.name !== RELS)
        .concat({ name: RELS, data: enc.encode(relsXml) }, media.map((m) => ({ name: m.name, data: m.data })));
    }

    // [Content_Types].xml يُفضَّل أن يكون أول ملف في الحزمة
    const types = parts.filter((p) => p.name === "[Content_Types].xml");
    const others = parts.filter((p) => p.name !== "[Content_Types].xml");
    return zip([...types, { name: "word/document.xml", data: enc.encode(documentXml) }, ...others]);
  }

  App.docx = { build, crc32, load };
})(window.App = window.App || {});
