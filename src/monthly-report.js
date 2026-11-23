/* التقرير الشهري الموحّد: حضور وتقييمات وتوقيعات لكل مسار في مستند واحد على الترويسة الرسمية.
   هذا الملف يبني «كتل المستند» من بيانات جاهزة (لا يقرأ من النظام ولا يعرف الواجهة)، ليُطبع أو يُصدَّر Word بمحرّك المستندات المشترك. */
(function (App) {
  const MAX_ROWS = 40;   // أقصى صفوف لكل جدول تفصيلي (الباقي يُذكر عدداً)
  const fmt = (n) => String(n == null ? 0 : n);
  const sum = (a, f) => a.reduce((n, x) => n + (Number(f(x)) || 0), 0);

  /* "2026-11" ← "نوفمبر 2026" بالعربية */
  function monthLabel(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "")); if (!m) return String(ym || "");
    const names = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return names[Number(m[2]) - 1] + " " + m[1];
  }

  /* d = { month, from, to, scope, thr, sources:{att,mis,sig}, forms,
           tracks:[{ name, att:{students,sessions,absent,excused,late,flagged:[{name,group,absent,streak}]},
                     mis:{count, by:{label:n}, rows:[{name,group,items}]}, sig:{total, lacking:[{name,group,forms}]} }] } */
  function build(d) {
    const src = d.sources || {}, tracks = (d.tracks || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
    const blocks = [];
    blocks.push({ kind: "title", text: "التقرير الشهري — " + monthLabel(d.month) });
    blocks.push({ kind: "bold", text: "الفترة: من " + (d.from || "") + " إلى " + (d.to || "") + (d.scope ? " — " + d.scope : "") });
    const used = [src.att ? "الحضور والغياب" : "", src.mis ? "الاستبيانات والتعهدات" : "", src.sig ? "التوقيعات (" + fmt(d.forms) + " نماذج)" : ""].filter(Boolean);
    blocks.push({ kind: "para", text: "مصادر التقرير: " + (used.join("، ") || "—") + ". أُعدّ بتاريخ " + (d.generated || "") + (src.att ? "، وحدّ التنبيه على الغياب " + fmt(d.thr) + " غيابات." : ".") });

    // ملخص المسارات
    const heads = ["المسار"]; const widths = [0.28];
    if (src.att) { heads.push("الطلاب", "الجلسات", "الغياب", "منذَرون"); }
    if (src.mis) heads.push("ناقصو التقييم");
    if (src.sig) heads.push("ناقصو التوقيع");
    const rest = (1 - widths[0]) / (heads.length - 1);
    while (widths.length < heads.length) widths.push(rest);
    const rowOf = (t) => [t.name].concat(
      src.att ? [fmt(t.att && t.att.students), fmt(t.att && t.att.sessions), fmt(t.att && t.att.absent), fmt(t.att && t.att.flagged && t.att.flagged.length)] : [],
      src.mis ? [fmt(t.mis && t.mis.count)] : [],
      src.sig ? [fmt(t.sig && t.sig.lacking && t.sig.lacking.length)] : []);
    const total = ["الإجمالي"].concat(
      src.att ? [fmt(sum(tracks, (t) => t.att && t.att.students)), fmt(sum(tracks, (t) => t.att && t.att.sessions)), fmt(sum(tracks, (t) => t.att && t.att.absent)), fmt(sum(tracks, (t) => t.att && t.att.flagged && t.att.flagged.length))] : [],
      src.mis ? [fmt(sum(tracks, (t) => t.mis && t.mis.count))] : [],
      src.sig ? [fmt(sum(tracks, (t) => t.sig && t.sig.lacking && t.sig.lacking.length))] : []);
    blocks.push({ kind: "table", headers: heads, widths, align: heads.map((h, i) => (i === 0 ? "left" : "center")), rows: tracks.map(rowOf).concat([total]) });

    // تفصيل كل مسار في صفحة
    tracks.forEach((t) => {
      blocks.push({ kind: "pagebreak" });
      blocks.push({ kind: "title", text: t.name, sizePt: 16 });
      const lines = [];
      if (src.att && t.att) lines.push("الحضور: " + fmt(t.att.students) + " طالباً في " + fmt(t.att.sessions) + " جلسة، إجمالي الغياب " + fmt(t.att.absent) + (t.att.excused ? " (وبعذر " + fmt(t.att.excused) + ")" : "") + "، والمنذَرون " + fmt(t.att.flagged && t.att.flagged.length) + ".");
      if (src.mis && t.mis) lines.push("الاستبيانات والتعهدات: " + fmt(t.mis.count) + " طالباً ناقصاً" + (t.mis.by && Object.keys(t.mis.by).length ? " (" + Object.keys(t.mis.by).map((k) => k + " " + fmt(t.mis.by[k])).join("، ") + ")" : "") + ".");
      if (src.sig && t.sig) lines.push("التوقيعات: " + fmt(t.sig.total) + " مسجّلاً، " + fmt(t.sig.lacking && t.sig.lacking.length) + " ينقصهم توقيع.");
      lines.forEach((l) => blocks.push({ kind: "para", text: l }));
      const part = (title, headers, widths2, rows, noun) => {
        if (!rows || !rows.length) return;
        blocks.push({ kind: "bold", text: title + " (" + fmt(rows.length) + ")" });
        blocks.push({ kind: "table", headers, widths: widths2, align: headers.map((h, i) => (i === 0 ? "left" : "center")), rows: rows.slice(0, MAX_ROWS) });
        if (rows.length > MAX_ROWS) blocks.push({ kind: "para", text: "وغيرهم " + fmt(rows.length - MAX_ROWS) + " " + noun + " (التفاصيل الكاملة في ملف Excel)." });
      };
      if (src.att && t.att) part("المنذَرون بالغياب", ["الاسم", "المجموعة", "الغياب", "أطول غياب متتالٍ"], [0.46, 0.18, 0.14, 0.22], (t.att.flagged || []).map((x) => [x.name, x.group || "", fmt(x.absent), fmt(x.streak)]), "طالباً");
      if (src.mis && t.mis) part("الناقصون في التقييمات", ["الاسم", "المجموعة", "ينقصه"], [0.38, 0.14, 0.48], (t.mis.rows || []).map((x) => [x.name, x.group || "", x.items || ""]), "طالباً");
      if (src.sig && t.sig) part("الناقصون في التوقيع", ["الاسم", "المجموعة", "ينقصه"], [0.38, 0.14, 0.48], (t.sig.lacking || []).map((x) => [x.name, x.group || "", x.forms || ""]), "طالباً");
    });
    return { blocks, tracks: tracks.length };
  }

  /* أوراق Excel: ملخص ثم أوراق التفاصيل بلا حدّ للصفوف */
  function sheets(d) {
    const src = d.sources || {}, tracks = (d.tracks || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
    const out = [{ name: "ملخص المسارات", heads: ["المسار", "الطلاب", "الجلسات", "الغياب", "منذَرون", "ناقصو التقييم", "ناقصو التوقيع"], rows: tracks.map((t) => [t.name, t.att ? t.att.students : "", t.att ? t.att.sessions : "", t.att ? t.att.absent : "", t.att && t.att.flagged ? t.att.flagged.length : "", t.mis ? t.mis.count : "", t.sig && t.sig.lacking ? t.sig.lacking.length : ""]) }];
    if (src.att) out.push({ name: "المنذَرون بالغياب", heads: ["المسار", "الاسم", "المجموعة", "الغياب", "أطول غياب متتالٍ"], rows: tracks.flatMap((t) => ((t.att && t.att.flagged) || []).map((x) => [t.name, x.name, x.group || "", x.absent, x.streak])) });
    if (src.mis) out.push({ name: "ناقصو التقييمات", heads: ["المسار", "الاسم", "المجموعة", "ينقصه"], rows: tracks.flatMap((t) => ((t.mis && t.mis.rows) || []).map((x) => [t.name, x.name, x.group || "", x.items || ""])) });
    if (src.sig) out.push({ name: "ناقصو التوقيع", heads: ["المسار", "الاسم", "المجموعة", "ينقصه"], rows: tracks.flatMap((t) => ((t.sig && t.sig.lacking) || []).map((x) => [t.name, x.name, x.group || "", x.forms || ""])) });
    return out.filter((s) => s.rows.length);
  }

  App.monthlyReport = { build, sheets, monthLabel, MAX_ROWS };
})(window.App = window.App || {});
