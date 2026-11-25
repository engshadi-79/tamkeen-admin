/* محرك المستندات المشترك على الترويسة الرسمية: معاينة مقسّمة إلى صفحات، طباعة/PDF، وتصدير Word.
   يستخدمه المراسلات والتقرير الدوري ومحاضر الاجتماعات.
   أنواع الكتل: title, bold, meta, para, end, addressee, signature, table, image */
(function (App) {
  const { ui, templates } = App;
  const PAGE_PT = 612; // عرض صفحة Letter بالنقاط
  const TEXT_PT = 468; // عرض منطقة النص بين هامشَي الترويسة
  const cqw = (pt) => `${(pt / PAGE_PT) * 100}cqw`;

  /* ===== عناصر المعاينة ===== */
  function tableEl(b) {
    const table = document.createElement("table");
    table.className = "lb lb-table";
    if (b.sizePt) table.style.fontSize = cqw(b.sizePt);
    // جدول أعرض من منطقة النص (widthPt > 468): يمتد في الهامش الأيسر (نهاية السطر في العربية)
    if (b.widthPt && b.widthPt > TEXT_PT) { table.style.width = cqw(b.widthPt); table.style.maxWidth = "none"; table.style.marginInlineEnd = cqw(-(b.widthPt - TEXT_PT)); }
    if (b.widths) {
      const cg = document.createElement("colgroup");
      b.widths.forEach((w) => { const c = document.createElement("col"); c.style.width = `${w * 100}%`; cg.append(c); });
      table.append(cg);
    }
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    b.headers.forEach((h) => { const th = document.createElement("th"); th.textContent = h; hr.append(th); });
    thead.append(hr);
    table.append(thead, document.createElement("tbody"));
    return table;
  }

  function rowEl(cells, b) {
    const tr = document.createElement("tr");
    if (b.rowHeightTw) tr.style.height = cqw(b.rowHeightTw / 20);
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c == null ? "" : String(c);
      if (b.align && b.align[i] === "center") td.style.textAlign = "center";
      const st = b.colStyle && b.colStyle[i];   // تنسيق عمود بعينه (غامق/حجم)
      if (st && st.bold) td.style.fontWeight = "700";
      if (st && st.sizePt) { td.style.fontSize = cqw(st.sizePt); td.style.lineHeight = "1.1"; }   // سطر محكم: الرقم الأكبر لا يزيد ارتفاع الصف
      tr.append(td);
    });
    return tr;
  }

  function blockEl(b) {
    if (b.kind === "image") {
      const wrap = document.createElement("div");
      wrap.className = "lb lb-image";
      const img = document.createElement("img");
      img.src = b.src;
      img.alt = b.alt || "";
      img.style.width = cqw(b.widthPt);
      wrap.append(img);
      return wrap;
    }
    if (b.kind === "signature") {
      const starts = templates.signatureLayout(b.lines);
      const el = document.createElement("div");
      el.className = "lb lb-addressee";
      b.lines.forEach((t, i) => {
        const row = document.createElement("div");
        row.className = "addr-line";
        const s = document.createElement("span");
        s.textContent = t;
        s.style.insetInlineStart = cqw(starts[i]);
        row.append(s);
        el.append(row);
      });
      return el;
    }
    if (b.kind === "addressee") {
      const pos = templates.addresseeLayout(b);
      const el = document.createElement("div");
      el.className = "lb lb-addressee";
      const line = (text, startPt) => {
        const s = document.createElement("span");
        s.textContent = text;
        s.style.insetInlineStart = cqw(startPt);
        return s;
      };
      const first = document.createElement("div");
      first.className = "addr-line";
      first.append(line(b.name, 0));
      if (b.honorific) first.append(line(b.honorific, pos.honorificStart));
      el.append(first);
      if (b.title) {
        const second = document.createElement("div");
        second.className = "addr-line";
        second.append(line(b.title, pos.titleStart));
        el.append(second);
      }
      return el;
    }
    const el = document.createElement("p");
    el.className = "lb lb-" + b.kind;
    el.textContent = b.text || " ";
    if (b.sizePt) el.style.fontSize = cqw(b.sizePt);
    return el;
  }

  function newPage(container) {
    const page = document.createElement("div");
    page.className = "lh-page";
    const body = document.createElement("div");
    body.className = "lh-body";
    page.appendChild(body);
    container.appendChild(page);
    return body;
  }

  const overflows = (body) => body.scrollHeight > body.clientHeight + 1;
  // صفحة فيها جدول ممتد إلى الهامش: لا قصّ أفقياً (القصّ العمودي باقٍ لكشف الفيض)
  const allowWide = (body, b) => { if (b.widthPt && b.widthPt > TEXT_PT) { body.style.overflowX = "visible"; body.style.overflowY = "clip"; } };

  /* تقسيم الكتل على صفحات؛ الجدول الطويل يُقسَّم بين الصفحات مع تكرار صف عناوينه */
  function paginate(container, list) {
    container.innerHTML = "";
    let body = newPage(container);
    list.forEach((b) => {
      if (b.kind === "pagebreak") { if (body.children.length) body = newPage(container); return; }
      if (b.kind === "pagenum") {   // رقم الصفحة: أسفل الصفحة في الوسط فوق شريط التذييل، لا يدخل في تدفّق النص
        if (b.text) { const el = document.createElement("div"); el.className = "lh-pagenum"; el.textContent = b.text; body.parentElement.appendChild(el); }
        return;
      }
      if (b.kind === "table") {
        let table = tableEl(b);
        body.appendChild(table); allowWide(body, b);
        if (overflows(body) && body.children.length > 1) {
          table.remove();
          body = newPage(container);
          body.appendChild(table); allowWide(body, b);
        }
        b.rows.forEach((cells) => {
          const tr = rowEl(cells, b);
          table.tBodies[0].appendChild(tr);
          if (overflows(body) && table.tBodies[0].rows.length > 1) {
            tr.remove();
            body = newPage(container);
            table = tableEl(b);
            body.appendChild(table); allowWide(body, b);
            table.tBodies[0].appendChild(tr);
          }
        });
        return;
      }
      const el = blockEl(b);
      body.appendChild(el);
      if (overflows(body) && body.children.length > 1) {
        el.remove();
        body = newPage(container);
        body.appendChild(el);
      }
    });
    return container.children.length;
  }

  const pageCountLabel = (count) => (count === 1 ? "صفحة واحدة" : count === 2 ? "صفحتان" : `${count} صفحات`);

  /* ===== الطباعة و PDF ===== */
  function print(list, docTitle, asPdf) {
    const root = document.getElementById("print-root");
    root.innerHTML = "";
    document.body.classList.add("printing");
    paginate(root, list);
    const title = document.title;
    document.title = docTitle;
    const cleanup = () => {
      document.body.classList.remove("printing");
      root.innerHTML = "";
      document.title = title;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    const img = new Image();
    img.onload = img.onerror = () => setTimeout(() => window.print(), 50);
    img.src = "assets/letterhead/page.jpg?v=5";
    ui.toast(asPdf ? "اختر «حفظ بتنسيق PDF» ومقاس الورق Letter بدون هوامش" : "اختر الطابعة، ومقاس الورق Letter بدون هوامش");
  }

  function exportWord(list, fileBase, silent) {
    try {
      const blob = App.docx.build(list);
      if (silent) return blob; // الإصدار الجماعي: تُجمع الملفات في ملف مضغوط واحد
      ui.download(fileBase + ".docx", blob);
      ui.toast("تم تصدير ملف Word على الترويسة الرسمية");
      return blob;
    } catch (e) {
      console.error(e);
      ui.toast("تعذّر إنشاء ملف Word");
      return null;
    }
  }

  const cleanFileName = (t) => String(t || "").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60).trim();

  App.docRender = { paginate, pageCountLabel, print, exportWord, cleanFileName, PAGE_PT };
})(window.App = window.App || {});
