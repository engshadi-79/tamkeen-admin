/* نصوص قوالب المراسلات
   المتغيرات: {{subject}} {{recipient}} {{recipientTitle}} {{date}} {{ref}} {{attachments}} {{signer}} {{signerTitle}} {{details}}
              {{project}} {{org}} {{funders}} {{tracksSummary}}
   التنسيق (في بداية السطر):
     #  عنوان في الوسط بخط عريض
     ## سطر بخط عريض
     >> سطر محاذى إلى اليسار (للتوقيع)
     @@ الاسم | الصفة | المحترم  سطر المرسل إليه: الصفة في الوسط تحت الاسم
   الرقم والتاريخ والمرفقات تُطبع تلقائياً أعلى الصفحة تحت الترويسة. */
(function (App) {
  // عبارة الختام في الوسط بعد التفاصيل، ثم التوقيع
  const SIGNATURE = `# وتقبلوا منا فائق الاحترام والتقدير،،،

>> {{signerTitle}}
>> {{signer}}`;

  /* القوالب تحدد الشكل فقط؛ نص المراسلة كله يُكتب في «تفاصيل إضافية» */
  const TEMPLATES = [
    {
      id: "official",
      name: "خطاب رسمي",
      bodyTemplate:
`@@ {{recipient}} | {{recipientTitle}} | المحترم،،،
## السلام عليكم ورحمة الله وبركاته، وبعد:

# الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "circular",
      name: "تعميم إداري",
      bodyTemplate:
`# تعميم إداري

## إلى: {{recipient}}
## الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "minutes",
      name: "محضر اجتماع",
      bodyTemplate:
`# محضر اجتماع

## عنوان الاجتماع: {{subject}}
## الحاضرون: {{recipient}}

{{details}}

>> مُعِدّ المحضر
>> {{signer}}`,
    },
    {
      id: "thanks",
      name: "خطاب شكر",
      bodyTemplate:
`@@ {{recipient}} | {{recipientTitle}} | المحترم،،،
## السلام عليكم ورحمة الله وبركاته، وبعد:

# الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "request",
      name: "خطاب طلب",
      bodyTemplate:
`@@ {{recipient}} | {{recipientTitle}} | المحترم،،،
## السلام عليكم ورحمة الله وبركاته، وبعد:

# الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "invitation",
      name: "دعوة لحضور اجتماع",
      bodyTemplate:
`@@ {{recipient}} | {{recipientTitle}} | المحترم،،،
## السلام عليكم ورحمة الله وبركاته، وبعد:

# الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "progress",
      name: "تقرير إنجاز دوري",
      bodyTemplate:
`# تقرير إنجاز دوري

## مقدَّم إلى: {{recipient}}
## الموضوع: {{subject}}

## مؤشرات الإنجاز حسب المسارات
{{tracksSummary}}

{{details}}

>> مُعِدّ التقرير
>> {{signer}}`,
    },
    {
      id: "absence",
      name: "إشعار غياب لمستفيد",
      bodyTemplate:
`# إشعار غياب

## المستفيد / {{recipient}}
## السلام عليكم ورحمة الله وبركاته، وبعد:

# الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "memo",
      name: "مذكرة داخلية",
      bodyTemplate:
`# مذكرة داخلية

## من: {{signer}}
## إلى: {{recipient}}
## الموضوع: {{subject}}

{{details}}

${SIGNATURE}`,
    },
    {
      id: "certificate",
      name: "إفادة التحاق",
      bodyTemplate:
`# إفادة

{{details}}

${SIGNATURE}`,
    },
  ];

  const VARS = ["subject", "recipient", "recipientTitle", "date", "ref", "attachments", "signer", "signerTitle", "details", "project", "org", "funders", "tracksSummary"];

  const PLACEHOLDER = "…………";

  /* متغيرات اختيارية: إذا تُركت فارغة يُحذف السطر الذي لا يحتوي غيرها */
  const OPTIONAL = ["recipientTitle", "signerTitle"];

  function render(body, values) {
    const has = (key) => Object.prototype.hasOwnProperty.call(values, key) && values[key] !== "";
    return body.split("\n").filter((line) => {
      const vars = [...line.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
      const rest = line.replace(/\{\{\s*\w+\s*\}\}/g, "").replace(/^\s*(#{1,2}|>>)/, "").trim();
      return !(vars.length && !rest && vars.every((k) => OPTIONAL.includes(k) && !has(k)));
    }).join("\n").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
      has(key) ? values[key] : OPTIONAL.includes(key) ? "" : PLACEHOLDER
    );
  }

  /* تحويل النص إلى كتل منسقة؛ تُستخدم في المعاينة و Word و PDF */
  function toBlocks(text) {
    return text.split("\n").map((line) => {
      let m;
      if ((m = line.match(/^\s*#\s+(.*)$/))) return { kind: "title", text: m[1].trim() };
      if ((m = line.match(/^\s*##\s+(.*)$/))) return { kind: "bold", text: m[1].trim() };
      if ((m = line.match(/^\s*>>\s?(.*)$/))) return { kind: "end", text: m[1].trim() };
      if ((m = line.match(/^\s*@@\s?(.*)$/))) {
        const [name = "", title = "", honorific = ""] = m[1].split("|").map((x) => x.trim());
        return { kind: "addressee", name, title, honorific, text: [`${name}    ${honorific}`.trim(), title].filter(Boolean).join("\n") };
      }
      return { kind: "para", text: line.trimEnd() };
    }).reduce((out, b) => {
      // أسطر >> المتتالية تُجمع في كتلة توقيع واحدة (المسمى ثم الاسم)
      if (b.kind !== "end") return out.concat(b);
      const prev = out[out.length - 1];
      if (prev && prev.kind === "signature") {
        prev.lines.push(b.text);
        prev.text = prev.lines.join("\n");
        return out;
      }
      return out.concat({ kind: "signature", lines: [b.text], text: b.text });
    }, []);
  }

  /* قياس عرض النص بالنقاط بخط المراسلات (Sakkal Majalla 14 عريض) */
  const GAP_PT = 42; // المسافة بين الاسم و«المحترم»
  let ctx;
  function textWidthPt(text) {
    if (!text) return 0;
    if (typeof document === "undefined") return text.length * 5.2; // تقدير خارج المتصفح
    ctx = ctx || document.createElement("canvas").getContext("2d");
    ctx.font = '700 14pt "Sakkal Majalla", "Traditional Arabic", "Cairo", serif';
    return ctx.measureText(text).width * 0.75; // px → pt
  }

  /* مواضع سطر المرسل إليه بالنقاط من بداية السطر (الهامش الأيمن):
     الاسم ثابت، والصفة في منتصفه ما لم تكن أطول منه فتبدأ من الهامش */
  function addresseeLayout(block) {
    const nameW = textWidthPt(block.name);
    const titleW = textWidthPt(block.title);
    return { honorificStart: nameW + GAP_PT, titleStart: Math.max(0, (nameW - titleW) / 2) };
  }

  /* مواضع أسطر التوقيع بالنقاط من بداية السطر: الكتلة ملتصقة بالهامش الأيسر،
     وكل سطر في منتصف أطول سطر فيها */
  const TEXT_WIDTH_PT = 612 - 72 * 2; // عرض منطقة النص بين الهامشين
  function signatureLayout(lines) {
    const widths = lines.map(textWidthPt);
    const blockW = Math.max(0, ...widths);
    return widths.map((w) => Math.max(0, TEXT_WIDTH_PT - blockW + (blockW - w) / 2));
  }

  const toPlain = (text) => toBlocks(text).map((b) => b.text).join("\n");

  App.templates = { BUILT_IN: TEMPLATES, VARS, PLACEHOLDER, render, toBlocks, toPlain, addresseeLayout, signatureLayout };
})(window.App = window.App || {});
