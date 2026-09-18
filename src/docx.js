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

  function paragraph(block) {
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

  function build(blocks) {
    const tpl = App.letterheadDocx;
    if (!tpl) throw new Error("ملف الترويسة غير محمّل");
    if (!cachedParts) {
      cachedParts = Object.entries(tpl.parts).map(([name, b64]) => ({ name, data: base64ToBytes(b64) }));
    }
    const documentXml = tpl.documentPrefix + blocks.map(paragraph).join("") + tpl.documentSuffix;
    // [Content_Types].xml يُفضَّل أن يكون أول ملف في الحزمة
    const types = cachedParts.filter((p) => p.name === "[Content_Types].xml");
    const others = cachedParts.filter((p) => p.name !== "[Content_Types].xml");
    return zip([...types, { name: "word/document.xml", data: new TextEncoder().encode(documentXml) }, ...others]);
  }

  App.docx = { build, crc32 };
})(window.App = window.App || {});
