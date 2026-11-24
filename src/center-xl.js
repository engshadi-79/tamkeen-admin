/* مقارنة ملف Excel خارجي بالمسجلين في نظام المركز.
   هذا الملف: قراءة المصنَّف، تخمين الأعمدة، والمقارنة (هوية ← جوال ← اسم). لا يعرف الواجهة ولا يقرأ من النظام. */
(function (App) {
  const U = () => App.ccUtil;
  const clean = (v) => String(v == null ? "" : typeof v === "object" ? (v.text || v.result || (v.richText ? v.richText.map((x) => x.text).join("") : "") || "") : v).replace(/\s+/g, " ").trim();

  /* ملف .xlsx ← { sheets: [{ name, heads, rows }] } (الصف الأول ذو الرؤوس يُخمَّن) */
  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    let first = null;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheets = [];
      wb.eachSheet((ws) => {
        const grid = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const cells = [];
          for (let i = 1; i <= row.cellCount; i++) cells.push(clean(row.getCell(i).value));
          if (cells.some(Boolean)) grid.push(cells);
        });
        if (!grid.length) return;
        sheets.push(Object.assign({ name: ws.name }, splitHeader(grid)));
      });
      if (sheets.length) return { sheets };
    } catch (e) { first = e; }
    /* ExcelJS يتعثّر ببعض الملفات (مولَّدة من برامج أخرى): قراءة مباشرة لبنية xlsx بدلاً منه */
    try { const r = await readWorkbookRaw(buf); if (r.sheets.length) return r; } catch (e2) { if (first) throw first; throw e2; }
    if (first) throw first;
    return { sheets: [] };
  }

  /* قارئ xlsx مباشر (JSZip + DOMParser): أوراق، نصوص مشتركة، خلايا نصية/رقمية/inline. لا يقرأ صيغ الخلايا ولا التنسيق. */
  async function readWorkbookRaw(buf) {
    const zip = await JSZip.loadAsync(buf);
    const txt = async (path) => { const f = zip.file(path) || zip.file(path.replace(/^\//, "")); return f ? f.async("string") : ""; };
    const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
    const attr = (el, n) => el.getAttribute(n) || el.getAttribute("r:" + n) || "";
    const byTag = (doc, tag) => [...doc.getElementsByTagName(tag)];
    const rels = await txt("_rels/.rels"); let wbPath = "xl/workbook.xml";
    if (rels) { const rel = byTag(xml(rels), "Relationship").find((r) => /officeDocument/.test(r.getAttribute("Type") || "")); if (rel) wbPath = (rel.getAttribute("Target") || wbPath).replace(/^\//, ""); }
    const wbTxt = await txt(wbPath); if (!wbTxt) throw new Error("بنية الملف غير معروفة (لا workbook).");
    const dir = wbPath.replace(/[^/]+$/, ""), relsTxt = await txt(dir + "_rels/" + wbPath.split("/").pop() + ".rels");
    const relTarget = {}; byTag(xml(relsTxt), "Relationship").forEach((r) => { relTarget[r.getAttribute("Id")] = r.getAttribute("Target") || ""; });
    const shared = []; const ssTxt = await txt(dir + "sharedStrings.xml");
    if (ssTxt) byTag(xml(ssTxt), "si").forEach((si) => { shared.push(byTag(si, "t").filter((t) => !t.closest || !t.closest("rPh")).map((t) => t.textContent).join("")); });
    const colIdx = (ref) => { const m = /^([A-Z]+)/i.exec(ref || ""); if (!m) return -1; let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
    const sheets = [];
    for (const sh of byTag(xml(wbTxt), "sheet")) {
      const rid = attr(sh, "id"), target = relTarget[rid]; if (!target) continue;
      const path = target.startsWith("/") ? target.slice(1) : dir + target.replace(/^\.\//, "");
      const sx = await txt(path); if (!sx) continue;
      const grid = [];
      byTag(xml(sx), "row").forEach((row) => {
        const cells = [];
        [...row.children].filter((c) => c.tagName === "c").forEach((c, k) => {
          const i = colIdx(c.getAttribute("r")), at = i >= 0 ? i : k, t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0], is = c.getElementsByTagName("is")[0];
          let val = "";
          if (t === "s" && v) val = shared[Number(v.textContent)] || "";
          else if (t === "inlineStr" && is) val = byTag(is, "t").map((x) => x.textContent).join("");
          else if (v) val = v.textContent;
          while (cells.length < at) cells.push("");
          cells[at] = clean(val);
        });
        if (cells.some(Boolean)) grid.push(cells);
      });
      if (grid.length) sheets.push(Object.assign({ name: attr(sh, "name") || "ورقة" + (sheets.length + 1) }, splitHeader(grid)));
    }
    return { sheets };
  }

  const HEAD_RX = /اسم|الاسم|هوية|الهوية|جوال|الجوال|هاتف|موبايل|name|id|phone|mobile/i;
  /* يختار صف الرؤوس: أول صف (من أول 10) فيه كلمة رأس معروفة وخليتان نصيتان على الأقل */
  function splitHeader(grid) {
    let h = 0;
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const r = grid[i];
      if (r.filter((c) => c && !/^\d+$/.test(c)).length >= 2 && r.some((c) => HEAD_RX.test(c))) { h = i; break; }
    }
    const heads = grid[h].map((x, i) => x || "عمود " + (i + 1));
    return { heads, rows: grid.slice(h + 1).filter((r) => r.some(Boolean)) };
  }

  /* تخمين الأعمدة من رؤوسها ومن قيمها (هوية = 10 أرقام، جوال = 9-12 رقماً يبدأ بـ5/05/966) */
  function detect(heads, rows) {
    const idx = (rx) => heads.findIndex((h) => rx.test(h));
    const out = { name: idx(/^(الاسم|اسم الطالب|اسم المتدرب|اسم المتدربة|اسم|name)/i), id: idx(/هوية|إقامة|السجل المدني|national|\bid\b/i), phone: idx(/جوال|هاتف|موبايل|mobile|phone|تلفون/i), group: idx(/مجموعة|شعبة|group/i) };
    const D = U().digits;
    const col = (i) => rows.slice(0, 40).map((r) => D(r[i])).filter(Boolean);
    if (out.id < 0) for (let i = 0; i < heads.length; i++) { const v = col(i); if (v.length >= 3 && v.filter((x) => x.length === 10 && /^[12]/.test(x)).length >= v.length * 0.7) { out.id = i; break; } }
    if (out.phone < 0) for (let i = 0; i < heads.length; i++) { if (i === out.id) continue; const v = col(i); if (v.length >= 3 && v.filter((x) => /^(5\d{8}|05\d{8}|9665\d{8}|009665\d{8})$/.test(x)).length >= v.length * 0.7) { out.phone = i; break; } }
    if (out.name < 0) for (let i = 0; i < heads.length; i++) { if (i === out.id || i === out.phone) continue; const v = rows.slice(0, 40).map((r) => clean(r[i])).filter(Boolean); if (v.length >= 3 && v.filter((x) => /[؀-ۿ]+\s+[؀-ۿ]+/.test(x)).length >= v.length * 0.7) { out.name = i; break; } }
    return out;
  }

  /* registered: [{key,name,id,phone,group,course,stu}]  ext: {heads, rows}  map: {name,id,phone,group} (فهارس أو -1) */
  function compare(registered, ext, map) {
    const get = (r, i) => (i >= 0 ? clean(r[i]) : "");
    const found = ext.rows.map((r, k) => ({ n: k, name: get(r, map.name), id: get(r, map.id), phone: get(r, map.phone), group: get(r, map.group) })).filter((f) => f.name || f.id || f.phone);
    const m = U().matchNames(registered, found);
    const D = U().digits, P = U().phoneNorm;
    const sameId = (a, b) => D(a) === D(b), samePh = (a, b) => P(a).slice(-9) === P(b).slice(-9);
    const matched = [], diffs = [];
    m.pairs.forEach((p) => {
      const r = registered[p.reg], f = found[p.found], why = [];
      if (map.id >= 0 && D(r.id) && D(f.id) && !sameId(r.id, f.id)) why.push("الهوية");
      if (map.phone >= 0 && P(r.phone) && P(f.phone) && !samePh(r.phone, f.phone)) why.push("الجوال");
      if (p.by === "name" && p.score < 0.95) why.push("الاسم");
      const row = { reg: r, ext: f, score: p.score, by: p.by, why };
      matched.push(row); if (why.length) diffs.push(row);
    });
    return {
      matched, diffs,
      missingInSystem: m.unmatchedFound.map((j) => found[j]),
      notInFile: m.unmatchedReg.map((i) => registered[i]),
      total: { file: found.length, system: registered.length },
    };
  }

  /* جاهزية التخرج: حضور (غياب أقصى ونسبة حضور دنيا) + نواقص التقييمات.
     students: [{name,stu,track,group,absent,excused,late,present,sessions}]؛ missing: [{stu,id,name,items:[...]}] */
  function gradEval(students, missing, cfg) {
    const maxAbs = Number(cfg.maxAbs), minRate = Number(cfg.minRate) || 0;
    const key = (x) => (x.stu ? "s:" + x.stu : "n:" + U().arKey(x.name));
    const miss = new Map();
    (missing || []).forEach((m) => { if (m.stu) miss.set("s:" + m.stu, m); miss.set("n:" + U().arKey(m.name), m); });
    return students.map((s) => {
      const abs = s.absent + (cfg.countExcused ? s.excused : 0);
      const attended = s.present + s.late, rate = s.sessions ? Math.round((attended / s.sessions) * 100) : 100;
      const m = miss.get(key(s)) || miss.get("n:" + U().arKey(s.name));
      const items = m ? m.items.slice() : [], reasons = [];
      if (!isNaN(maxAbs) && abs > maxAbs) reasons.push("غياب " + abs + " (الحد " + maxAbs + ")");
      if (minRate && rate < minRate) reasons.push("نسبة الحضور " + rate + "% (الحد " + minRate + "%)");
      if (cfg.requireEval && items.length) reasons.push("ينقصه: " + items.join("، "));
      return { s, abs, rate, items, reasons, ok: !reasons.length };
    }).sort((a, b) => Number(a.ok) - Number(b.ok) || b.reasons.length - a.reasons.length || a.s.name.localeCompare(b.s.name, "ar"));
  }

  App.centerXl = { readWorkbook, readWorkbookRaw, splitHeader, detect, compare, gradEval, clean };
})(window.App = window.App || {});
