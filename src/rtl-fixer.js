/* تصحيح اتجاه ملفات Word (.docx) الناتجة عن أدوات لا تضبط الاتجاه العربي — داخل المتصفح بمكتبة JSZip.
   يعالج: المستند، الترويسات والتذييلات، الحواشي. ويحافظ على ترتيب العناصر الذي يشترطه Word.

   ملاحظة المحاذاة: في الفقرة ثنائية الاتجاه (bidi) يفسّر Word القيمة left كبداية السطر (اليمين)
   و right كنهايته (اليسار). لذلك تُحوَّل right→left و end→start لتصبح الفقرة يمينية،
   وتبقى center و both (الضبط) كما هي. */
(function (App) {
  const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

  // العناصر التي يجب أن تأتي بعد العنصر المُدرج حسب مخطط Word
  const PPR_AFTER_BIDI = ["adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const RPR_AFTER_RTL = ["cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange"];
  const TBLPR_AFTER_BIDIVISUAL = ["tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription", "tblPrChange"];
  const SECTPR_AFTER_BIDI = ["rtlGutter", "docGrid", "printerSettings", "sectPrChange"];

  function insertOrdered(inner, element, laterTags) {
    const m = inner.match(new RegExp(`<w:(?:${laterTags.join("|")})\\b`));
    return m ? inner.slice(0, m.index) + element + inner.slice(m.index) : inner + element;
  }

  /* يضمن وجود عنصر (مثل bidi) مفعّلاً؛ يستبدل الصيغة المعطّلة w:val="0" إن وُجدت */
  function ensureFlag(inner, tag, laterTags, stats, key) {
    const re = new RegExp(`<w:${tag}(?:\\s[^>]*)?/>`);
    const m = inner.match(re);
    if (m) {
      if (/w:val="(0|false|off)"/.test(m[0])) { stats[key]++; return inner.replace(re, `<w:${tag}/>`); }
      return inner;
    }
    stats[key]++;
    return insertOrdered(inner, `<w:${tag}/>`, laterTags);
  }

  function fixJc(inner, stats) {
    return inner.replace(/<w:jc w:val="(right|end)"\/>/g, (_m, v) => { stats.align++; return `<w:jc w:val="${v === "right" ? "left" : "start"}"/>`; });
  }

  function fixXml(xml, stats) {
    // فقرات فارغة مختصرة (بسمات أو بدونها) تُفك إلى وسم مفتوح ومغلق لتعالَج مثل غيرها
    xml = xml.replace(/<w:p(\s[^>]*?)?\/>/g, (_m, attrs) => `<w:p${attrs || ""}></w:p>`);

    // خصائص الفقرات — الفقرة الإنجليزية الخالصة (فيها حروف لاتينية ولا عربية) تبقى يسارية
    xml = xml.replace(/(<w:p(?:\s[^>]*)?>)(<w:pPr\/>|<w:pPr>([\s\S]*?)<\/w:pPr>)?/g, (m, open, full, inner, offset, whole) => {
      const after = offset + m.length;
      const end = whole.indexOf("</w:p>", after);
      const text = (whole.slice(after, end === -1 ? after : end).match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || []).join("").replace(/<[^>]+>/g, "");
      if (!ARABIC.test(text) && /[A-Za-z]/.test(text)) return m;
      if (full == null) { stats.paragraphs++; return `${open}<w:pPr><w:bidi/></w:pPr>`; }
      let pPr = inner || "";
      pPr = ensureFlag(pPr, "bidi", PPR_AFTER_BIDI, stats, "paragraphs");
      pPr = fixJc(pPr, stats);
      return `${open}<w:pPr>${pPr}</w:pPr>`;
    });

    // النصوص العربية: rtl على الجزء النصي. وكذلك الأجزاء التي بلا حروف (أرقام وترقيم ومسافات مثل «1. »)
    // داخل فقرة عربية؛ وإلا عرضها Word يسارية فتنقلب النقطة والمسافة حول الرقم.
    const textOf = (s) => (s.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || []).join("").replace(/<[^>]+>/g, "");
    const paraArabic = new Map();
    const inArabicPara = (whole, offset) => {
      const start = Math.max(whole.lastIndexOf("<w:p>", offset), whole.lastIndexOf("<w:p ", offset));
      if (start === -1) return false;
      if (!paraArabic.has(start)) {
        const end = whole.indexOf("</w:p>", offset);
        paraArabic.set(start, ARABIC.test(textOf(whole.slice(start, end === -1 ? offset : end))));
      }
      return paraArabic.get(start);
    };
    xml = xml.replace(/(<w:r(?:\s[^>]*)?>)(<w:rPr>([\s\S]*?)<\/w:rPr>)?/g, (m, open, full, inner, offset, whole) => {
      const after = offset + m.length;
      const end = whole.indexOf("</w:r>", after);
      const runText = textOf(whole.slice(after, end === -1 ? after + 400 : end));
      const neutral = runText.trim() && !/[A-Za-z]/.test(runText) && inArabicPara(whole, offset);
      if (!ARABIC.test(runText) && !neutral) return m;
      if (full == null) { stats.runs++; return `${open}<w:rPr><w:rtl/></w:rPr>`; }
      return `${open}<w:rPr>${ensureFlag(inner, "rtl", RPR_AFTER_RTL, stats, "runs")}</w:rPr>`;
    });

    // الجداول: ترتيب الأعمدة من اليمين
    xml = xml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (m, inner) =>
      `<w:tblPr>${ensureFlag(inner, "bidiVisual", TBLPR_AFTER_BIDIVISUAL, stats, "tables")}</w:tblPr>`);
    xml = xml.replace(/<w:tbl>(?!<w:tblPr)/g, () => { stats.tables++; return "<w:tbl><w:tblPr><w:bidiVisual/></w:tblPr>"; });

    // اتجاه الأقسام
    xml = xml.replace(/(<w:sectPr(?:\s[^>]*)?>)([\s\S]*?)(<\/w:sectPr>)/g, (m, open, inner, close) =>
      `${open}${ensureFlag(inner, "bidi", SECTPR_AFTER_BIDI, stats, "sections")}${close}`);

    return xml;
  }

  const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

  /* يرجع { blob, stats } — stats تعدّ العناصر التي عُدّلت */
  async function fixDocx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file("word/document.xml")) throw new Error("الملف ليس مستند Word صالحاً (.docx)");
    const stats = { paragraphs: 0, runs: 0, tables: 0, sections: 0, align: 0, parts: 0 };
    for (const name of Object.keys(zip.files)) {
      if (!PARTS.test(name)) continue;
      const xml = await zip.file(name).async("string");
      const fixed = fixXml(xml, stats);
      if (fixed !== xml) { zip.file(name, fixed); stats.parts++; }
    }
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    return { blob, stats };
  }

  /* ===== PowerPoint =====
     الشرائح لغتها XML أخرى: الفقرة <a:p> واتجاهها في <a:pPr rtl="1">،
     والمحاذاة algn (l/ctr/r/just). وفي العرض ثنائي الاتجاه يفسّر PowerPoint
     القيمة l بداية السطر، فتُحوَّل r→l ليصير النص يمينياً، وتبقى ctr و just.
     الجداول: <a:tbl> يُقلب اتجاهها بـ rtl="1" في <a:tblPr>. */
  const PPTX_PARTS = /^ppt\/(slides|slideLayouts|slideMasters|notesSlides)\/[^/]+\.xml$/;

  /* المحاذاة في شرائح PowerPoint ليست كما في Word: قيمة algn تُفسَّر بحسب
     اتجاه الفقرة، فقلبها يفسد ما لم يكن فاسداً. الملفات المعطوبة تأتي بـ
     algn="l" مفروضة على كل فقرة، وحذفها يجعلها ترث الاتجاه الجديد فتصير
     يمينية. وما اختاره صاحب الملف صراحةً — توسيط أو ضبط أو يمين — يبقى. */
  function pptAlign(pPr) {
    return pPr.replace(/\s*algn="l"/g, "");
  }

  function fixPptXml(xml, stats) {
    let out = xml;

    // 1) كل فقرة فيها عربية: rtl="1" على <a:pPr>، وتُنشأ إن لم تكن
    out = out.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (whole, inner) => {
      if (!ARABIC.test(inner)) return whole;
      stats.paragraphs++;
      let body = inner;
      const has = /<a:pPr\b/.test(body);
      if (has) {
        body = body.replace(/<a:pPr\b([^>]*?)(\/?)>/, (m2, attrs, selfClose) => {
          let a = attrs;
          if (!/\brtl="/.test(a)) { a += ' rtl="1"'; stats.runs++; }
          else a = a.replace(/\brtl="0"/, 'rtl="1"');
          const before = a;
          a = pptAlign(a);
          if (a !== before) stats.align++;
          return `<a:pPr${a}${selfClose}>`;
        });
      } else {
        body = `<a:pPr rtl="1"/>${body}`;
        stats.runs++;
      }
      return `<a:p>${body}</a:p>`;
    });

    // 2) الجداول: ترتيب الأعمدة من اليمين
    out = out.replace(/<a:tblPr\b([^>]*?)(\/?)>/g, (m, attrs, selfClose) => {
      if (/\brtl="1"/.test(attrs)) return m;
      stats.tables++;
      return `<a:tblPr${attrs.replace(/\brtl="0"/, "")} rtl="1"${selfClose}>`;
    });

    return out;
  }

  async function fixPptx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file("ppt/presentation.xml")) throw new Error("الملف ليس عرض PowerPoint صالحاً (.pptx)");
    const stats = { paragraphs: 0, runs: 0, tables: 0, sections: 0, align: 0, parts: 0, slides: 0 };
    for (const name of Object.keys(zip.files)) {
      if (!PPTX_PARTS.test(name)) continue;
      if (/^ppt\/slides\//.test(name)) stats.slides++;
      const xml = await zip.file(name).async("string");
      const fixed = fixPptXml(xml, stats);
      if (fixed !== xml) { zip.file(name, fixed); stats.parts++; }
    }
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    return { blob, stats };
  }

  /* الوجهة تُختار من امتداد الملف */
  async function fixFile(buffer, name) {
    return /\.pptx$/i.test(name) ? fixPptx(buffer) : fixDocx(buffer);
  }

  App.rtlFixer = { fixDocx, fixPptx, fixFile, fixXml, fixPptXml };
})(window.App = window.App || {});
