/* مولّد المراسلات والتقارير على الترويسة الرسمية — معاينة بالصفحات، نسخ، تصدير Word و PDF، وقوالب مخصصة */
(function (App) {
  const { store, ui, templates } = App;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ["subject", "recipient", "recipientTitle", "date", "ref", "attachments", "signer", "signerTitle", "details"];
  const REMEMBERED = ["signer", "signerTitle"];

  function allTemplates() {
    return templates.BUILT_IN.concat(store.get().customTemplates || []);
  }
  const current = () => allTemplates().find((t) => t.id === $("tpl-select").value) || templates.BUILT_IN[0];
  const isCustom = (t) => (store.get().customTemplates || []).some((c) => c.id === t.id);

  function values() {
    const v = {};
    FIELDS.forEach((f) => (v[f] = $("l-" + f).value.trim()));
    v.date = ui.formatDate(v.date);
    v.project = store.PROJECT.name;
    v.org = store.PROJECT.org;
    v.funders = store.PROJECT.funders;
    v.tracksSummary = App.tracks.textSummary(store.get().tracks);
    return v;
  }

  /* كتل المستند: البسملة، ثم الرقم والتاريخ والمرفقات، ثم نص القالب */
  function blocks() {
    const v = values();
    const meta = [{ kind: "title", text: "بسم الله الرحمن الرحيم" }];
    if (v.ref) meta.push({ kind: "meta", text: `الرقم: ${v.ref}` });
    meta.push({ kind: "meta", text: `التاريخ: ${v.date || templates.PLACEHOLDER}`, sizePt: 12 });
    if (v.attachments) meta.push({ kind: "meta", text: `المرفقات: ${v.attachments}` });
    meta.push({ kind: "para", text: "" });
    return meta.concat(templates.toBlocks(templates.render(current().bodyTemplate, v)));
  }

  const plainText = () => blocks().map((b) => b.text).join("\n");

  /* ===== المعاينة مقسّمة إلى صفحات بحجم الورقة الفعلي ===== */
  function blockEl(b) {
    if (b.kind === "signature") {
      // نفس مواضع ملف Word: كل سطر في منتصف أطول سطر، والكتلة عند الهامش الأيسر
      const starts = templates.signatureLayout(b.lines);
      const el = document.createElement("div");
      el.className = "lb lb-addressee";
      b.lines.forEach((t, i) => {
        const row = document.createElement("div");
        row.className = "addr-line";
        const s = document.createElement("span");
        s.textContent = t;
        s.style.insetInlineStart = `${(starts[i] / 612) * 100}cqw`;
        row.append(s);
        el.append(row);
      });
      return el;
    }
    if (b.kind === "addressee") {
      // نفس مواضع ملف Word: الاسم ثابت، «المحترم» بعده، والصفة في منتصفه
      const pos = templates.addresseeLayout(b);
      const cqw = (pt) => `${(pt / 612) * 100}cqw`;
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
    if (b.sizePt) el.style.fontSize = `${(b.sizePt / 612) * 100}cqw`;
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

  function paginate(container, list) {
    container.innerHTML = "";
    let body = newPage(container);
    list.forEach((b) => {
      const el = blockEl(b);
      body.appendChild(el);
      if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
        el.remove();
        body = newPage(container);
        body.appendChild(el);
      }
    });
    return container.children.length;
  }

  function renderPreview() {
    const count = paginate($("preview"), blocks());
    $("page-count").textContent = count === 1 ? "صفحة واحدة" : count === 2 ? "صفحتان" : `${count} صفحات`;
    const custom = isCustom(current());
    $("tpl-edit").hidden = !custom;
    $("tpl-delete").hidden = !custom;
  }

  function renderSelect(selectedId) {
    const sel = $("tpl-select");
    const keep = selectedId || sel.value;
    const custom = store.get().customTemplates || [];
    sel.innerHTML =
      `<optgroup label="القوالب الجاهزة">${templates.BUILT_IN.map((t) => `<option value="${t.id}">${ui.esc(t.name)}</option>`).join("")}</optgroup>` +
      (custom.length ? `<optgroup label="قوالبي">${custom.map((t) => `<option value="${t.id}">${ui.esc(t.name)}</option>`).join("")}</optgroup>` : "");
    if (keep && allTemplates().some((t) => t.id === keep)) sel.value = keep;
    renderPreview();
  }

  /* ===== التصدير ===== */
  function fileBase() {
    const clean = (t) => t.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60).trim();
    return [clean(current().name), clean(values().subject), $("l-date").value || ui.todayISO()].filter(Boolean).join(" - ");
  }

  function exportWord() {
    try {
      ui.download(fileBase() + ".docx", App.docx.build(blocks()));
      ui.toast("تم تصدير ملف Word على الترويسة الرسمية");
    } catch (e) {
      console.error(e);
      ui.toast("تعذّر إنشاء ملف Word");
    }
  }

  function exportPDF() {
    const root = $("print-root");
    // صفحات الطباعة بالمقاس الفعلي تُقسَّم من جديد لضمان مطابقة المعاينة
    root.innerHTML = "";
    document.body.classList.add("printing");
    paginate(root, blocks());
    const title = document.title;
    document.title = fileBase(); // يُقترح اسماً لملف PDF
    const cleanup = () => {
      document.body.classList.remove("printing");
      root.innerHTML = "";
      document.title = title;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // انتظار تحميل صورة الترويسة قبل فتح نافذة الطباعة
    const img = new Image();
    img.onload = img.onerror = () => setTimeout(() => window.print(), 50);
    img.src = "assets/letterhead/page.jpg?v=5";
    ui.toast("اختر «حفظ بتنسيق PDF» ومقاس الورق Letter بدون هوامش");
  }

  /* ===== إدارة القوالب المخصصة ===== */
  let editingId = null;

  function openEditor(tpl) {
    editingId = tpl && isCustom(tpl) ? tpl.id : null;
    $("tpl-modal-title").textContent = editingId ? "تعديل قالب" : "قالب جديد";
    $("tpl-name").value = tpl ? (editingId ? tpl.name : `${tpl.name} (نسخة)`) : "";
    $("tpl-body").value = tpl ? tpl.bodyTemplate : "@@ {{recipient}} | {{recipientTitle}} | المحترم،،،\n## السلام عليكم ورحمة الله وبركاته، وبعد:\n\n# الموضوع: {{subject}}\n\n{{details}}\n\n# وتقبلوا منا فائق الاحترام والتقدير،،،\n\n>> {{signerTitle}}\n>> {{signer}}";
    $("tpl-modal").classList.add("open");
    $("tpl-name").focus();
  }
  const closeEditor = () => $("tpl-modal").classList.remove("open");

  function saveTemplate(e) {
    e.preventDefault();
    const name = $("tpl-name").value.trim();
    const bodyTemplate = $("tpl-body").value;
    if (!name || !bodyTemplate.trim()) { ui.toast("يُرجى إدخال اسم القالب ونصه"); return; }
    const s = store.get();
    s.customTemplates = s.customTemplates || [];
    let id = editingId;
    if (id) {
      Object.assign(s.customTemplates.find((t) => t.id === id), { name, bodyTemplate });
    } else {
      id = "custom-" + store.uid();
      s.customTemplates.push({ id, name, bodyTemplate });
    }
    store.save();
    closeEditor();
    renderSelect(id);
    ui.toast("تم حفظ القالب");
  }

  function deleteTemplate() {
    const tpl = current();
    if (!isCustom(tpl) || !confirm(`هل تريد حذف القالب «${tpl.name}»؟`)) return;
    const s = store.get();
    s.customTemplates = s.customTemplates.filter((t) => t.id !== tpl.id);
    store.save();
    renderSelect(templates.BUILT_IN[0].id);
    ui.toast("تم حذف القالب");
  }

  /* ===== التوليد بالذكاء الاصطناعي ===== */
  let aiController = null;

  function aiStatus(text, isError) {
    $("ai-status").textContent = text;
    $("ai-status").classList.toggle("error", !!isError);
  }

  const syncProviderFields = () => {
    const claude = $("ai-provider").value === "claude";
    $("ai-gemini-fields").hidden = claude;
    $("ai-claude-fields").hidden = !claude;
  };

  const openAiSettings = () => {
    const s = App.ai.settings();
    $("ai-provider").value = s.provider;
    $("ai-gemini-key").value = s.geminiKey;
    $("ai-claude-key").value = s.claudeKey;
    syncProviderFields();
    $("ai-modal").classList.add("open");
    $(s.provider === "claude" ? "ai-claude-key" : "ai-gemini-key").focus();
  };
  const closeAiSettings = () => $("ai-modal").classList.remove("open");

  async function aiGenerate() {
    const request = $("ai-request").value.trim();
    if (!request) { aiStatus("اكتب أولاً ما تريد أن يتضمنه نص المراسلة.", true); $("ai-request").focus(); return; }
    if (!App.ai.hasKey()) { aiStatus("أدخل مفتاح الذكاء الاصطناعي أولاً.", true); openAiSettings(); return; }

    const details = $("l-details");
    if (details.value.trim() && !confirm("سيُستبدل النص الموجود في «تفاصيل إضافية» بالنص المولَّد. هل تريد المتابعة؟")) return;

    const v = values();
    const previous = details.value;
    details.value = "";
    let text = "";
    let frame = 0;
    aiController = new AbortController();
    $("ai-generate").disabled = true;
    $("ai-stop").hidden = false;
    aiStatus("جارٍ الكتابة…");

    try {
      const stop = await App.ai.generate({
        request,
        signal: aiController.signal,
        context: {
          "نوع المراسلة": current().name,
          "الموضوع": v.subject,
          "المرسل إليه": v.recipient,
          "صفة المرسل إليه": v.recipientTitle,
          "المسمى الوظيفي للموقّع": v.signerTitle,
        },
        onText: (chunk) => {
          text += chunk;
          details.value = text.replace(/^\s+/, "");
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderPreview(); });
        },
      });
      details.value = text.trim();
      renderPreview();
      if (stop === "refusal") aiStatus("اعتذر النموذج عن كتابة هذا الطلب. أعد صياغته.", true);
      else if (stop === "max_tokens") aiStatus("توقف النص قبل اكتماله لطوله. راجعه وأكمله.", true);
      else aiStatus("تم التوليد. راجع النص وعدّله قبل التصدير.");
    } catch (e) {
      if (e.name === "AbortError") {
        details.value = text.trim();
        renderPreview();
        aiStatus("أُوقف التوليد.");
      } else {
        if (!text) details.value = previous;
        renderPreview();
        aiStatus(e.message === "NO_KEY" ? "أدخل مفتاح الذكاء الاصطناعي أولاً." : e.message, true);
      }
    } finally {
      aiController = null;
      $("ai-generate").disabled = false;
      $("ai-stop").hidden = true;
    }
  }

  function initAi() {
    $("ai-generate").addEventListener("click", aiGenerate);
    $("ai-stop").addEventListener("click", () => aiController && aiController.abort());
    $("ai-settings").addEventListener("click", openAiSettings);
    $("ai-provider").addEventListener("change", syncProviderFields);
    $("ai-cancel").addEventListener("click", closeAiSettings);
    $("ai-modal").addEventListener("click", (e) => { if (e.target.id === "ai-modal") closeAiSettings(); });
    $("ai-form").addEventListener("submit", (e) => {
      e.preventDefault();
      App.ai.saveSettings({
        provider: $("ai-provider").value,
        geminiKey: $("ai-gemini-key").value.trim(),
        claudeKey: $("ai-claude-key").value.trim(),
      });
      closeAiSettings();
      aiStatus(App.ai.hasKey() ? "تم حفظ الإعدادات." : "");
      ui.toast("تم حفظ الإعدادات");
    });
    $("ai-key-delete").addEventListener("click", () => {
      if (!confirm("حذف مفاتيح الذكاء الاصطناعي من هذا الجهاز؟")) return;
      App.ai.saveSettings({ provider: $("ai-provider").value, geminiKey: "", claudeKey: "" });
      closeAiSettings();
      ui.toast("تم حذف المفاتيح من هذا الجهاز");
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAiSettings(); });
  }

  function init() {
    initAi();
    const s = store.get();
    $("l-date").value = ui.todayISO();
    REMEMBERED.forEach((f) => ($("l-" + f).value = s[f] || ""));

    FIELDS.forEach((f) => $("l-" + f).addEventListener("input", renderPreview));
    REMEMBERED.forEach((f) =>
      $("l-" + f).addEventListener("change", () => { store.get()[f] = $("l-" + f).value.trim(); store.save(); })
    );
    $("tpl-select").addEventListener("change", renderPreview);

    $("btn-copy").addEventListener("click", () => ui.copyText(plainText()));
    $("btn-word").addEventListener("click", exportWord);
    $("btn-pdf").addEventListener("click", exportPDF);

    $("tpl-new").addEventListener("click", () => openEditor(null));
    $("tpl-dup").addEventListener("click", () => openEditor(current()));
    $("tpl-edit").addEventListener("click", () => openEditor(current()));
    $("tpl-delete").addEventListener("click", deleteTemplate);
    $("tpl-form").addEventListener("submit", saveTemplate);
    $("tpl-cancel").addEventListener("click", closeEditor);
    $("tpl-modal").addEventListener("click", (e) => { if (e.target.id === "tpl-modal") closeEditor(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEditor(); });
    window.addEventListener("resize", () => { if ($("view-letters").classList.contains("active")) renderPreview(); });

    $("vars-hint").innerHTML =
      "المتغيرات: " + templates.VARS.map((v) => `<code>{{${v}}}</code>`).join(" ") +
      "<br>التنسيق في بداية السطر: <code>#</code> عنوان في الوسط · <code>##</code> خط عريض · <code>&gt;&gt;</code> محاذاة لليسار (التوقيع) · <code>@@ الاسم | الصفة | المحترم</code> سطر المرسل إليه";
    renderSelect(templates.BUILT_IN[0].id);
  }

  App.letters = { init, render: renderPreview, blocks };
})(window.App = window.App || {});
