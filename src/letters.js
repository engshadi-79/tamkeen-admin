/* مولّد المراسلات والتقارير على الترويسة الرسمية — معاينة بالصفحات، نسخ، تصدير Word و PDF، وقوالب مخصصة */
(function (App) {
  const { store, ui, templates } = App;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ["subject", "recipient", "recipientTitle", "date", "ref", "attachments", "signer", "signerTitle", "details"];
  const REMEMBERED = ["signer", "signerTitle"];
  let activeApproval = null;
  let approvalTemplate = null;

  function allTemplates() {
    return templates.BUILT_IN.concat(store.get().customTemplates || []);
  }
  const current = () => approvalTemplate || allTemplates().find((t) => t.id === $("tpl-select").value) || templates.BUILT_IN[0];
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
    return [{ kind: "title", text: "بسم الله الرحمن الرحيم" }]
      .concat(metaBlocks(v), templates.toBlocks(templates.render(current().bodyTemplate, v)), qrBlocks(v));
  }

  /* رمز QR للتحقق: يُولَّد من معرّف عشوائي يُحفظ مع قيد الصادر، ويفتح صفحة التحقق على الخادم */
  let verifyId = "";
  const newVerifyId = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);

  function verifyUrl(id) {
    const base = (App.cloud && App.cloud.settings().url) || "";
    return base ? `${base}?v=${id}` : "";
  }

  /* صورة الرمز كـ PNG لإدراجها في المعاينة وملف Word */
  function qrImage(url, sizePt) {
    if (typeof qrcode === "undefined" || !url) return null;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const scale = 6;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = count * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1f3a";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
    }
    return { src: canvas.toDataURL("image/png"), widthPt: sizePt, heightPt: sizePt };
  }

  function qrBlocks(v) {
    if (!$("l-qr").checked || !v.ref) return [];
    if (!verifyId) verifyId = newVerifyId();
    const img = qrImage(verifyUrl(verifyId), 64);
    if (!img) return [];
    return [{ kind: "image", src: img.src, widthPt: img.widthPt, heightPt: img.heightPt },
      { kind: "meta", text: "للتحقق من صحة الخطاب امسح الرمز", sizePt: 9 }];
  }

  /* سطور الرقم والتاريخ والمرفقات فوق متن الخطاب */
  function metaBlocks(v) {
    const meta = [];
    if (v.ref) meta.push({ kind: "meta", text: `الرقم: ${v.ref}` });
    meta.push({ kind: "meta", text: `التاريخ: ${v.date || templates.PLACEHOLDER}`, sizePt: 12 });
    if (v.attachments) meta.push({ kind: "meta", text: `المرفقات: ${v.attachments}` });
    meta.push({ kind: "para", text: "" });
    return meta;
  }

  const plainText = () => blocks().map((b) => b.text).join("\n");

  function renderPreview() {
    const count = App.docRender.paginate($("preview"), blocks());
    $("page-count").textContent = App.docRender.pageCountLabel(count);
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

  /* ===== التصدير (كل تصدير يُسجَّل في الصادر) ===== */
  function fileBase() {
    const clean = App.docRender.cleanFileName;
    return [clean(current().name), clean(values().subject), $("l-date").value || ui.todayISO()].filter(Boolean).join(" - ");
  }

  /* يضمن وجود رقم صادر (يُولَّد تلقائياً إن كان الحقل فارغاً) ثم يسجّل الخطاب في الصادر */
  /* الرد على وارد: يُفتح خطاب جاهز مربوط بالوارد، ويُعلَّم الوارد «رُدّ عليه» عند التصدير */
  let replyTo = null;
  function startReply(rec) {
    replyTo = rec.id;
    const sel = $("tpl-select");
    if ([...sel.options].some((o) => o.value === "official")) sel.value = "official";
    const [name, ...title] = String(rec.party || "").split(" - ");
    $("l-recipient").value = name || "";
    $("l-recipientTitle").value = title.join(" - ");
    $("l-subject").value = rec.subject ? `رد على: ${rec.subject}` : "رد على كتابكم";
    $("l-ref").value = "";
    $("l-date").value = ui.todayISO();
    $("l-details").value = `إشارة إلى كتابكم رقم (${rec.number}) بتاريخ ${ui.formatDate(rec.date)}${rec.subject ? ` بشأن ${rec.subject}` : ""}، نفيدكم بما يلي:

`;
    $("reply-note").hidden = false;
    $("reply-note-text").textContent = `رد على الوارد ${rec.number}${rec.subject ? ` — ${rec.subject}` : ""}`;
    location.hash = "letters";
    setTimeout(() => { renderPreview(); $("l-details").focus(); }, 50);
  }
  function cancelReply() { replyTo = null; $("reply-note").hidden = true; }

  async function ensureRef() {
    if (App.registry && !$("l-ref").value.trim()) {
      $("l-ref").value = await App.registry.assignNumber("out", $("l-date").value || ui.todayISO());
      renderPreview();
    }
  }

  const approvals = () => (store.get().letterApprovals = store.get().letterApprovals || []);
  const approvalStatus = { pending: "بانتظار المراجعة", approved: "معتمد — بانتظار الإصدار", rejected: "يحتاج إلى تعديل", issued: "صادر" };
  const approvalOwner = (r) => r.owner === (App.profile && App.profile.name());
  const canIssueApproval = () => !!(activeApproval && activeApproval.approvalStatus === "approved" && approvalOwner(activeApproval) && App.profile.can("export"));

  function renderApprovals() {
    const host = $("letter-approvals");
    if (!host) return;
    const items = approvals().slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 60);
    if (!items.length) { host.innerHTML = `<p class="empty">لا توجد طلبات اعتماد بعد.</p>`; return; }
    host.innerHTML = items.map((r) => {
      const own = approvalOwner(r);
      const kind = r.kind === "bulk" ? "إصدار جماعي" : "مراسلة";
      let action = "";
      if (r.approvalStatus === "pending") {
        action = `<button class="btn small secondary" data-approval-action="preview" data-approval-id="${ui.esc(r.id)}">معاينة المسودة</button>`;
        if (App.profile && App.profile.can("approve") && (!own || App.profile.isAdmin())) action += `<button class="btn small" data-approval-action="approve" data-approval-id="${ui.esc(r.id)}">اعتماد</button>
          <button class="btn small danger" data-approval-action="reject" data-approval-id="${ui.esc(r.id)}">إعادة للتعديل</button>`;
      } else if (r.approvalStatus === "approved" && own) {
        action = `<button class="btn small navy" data-approval-action="issue" data-approval-id="${ui.esc(r.id)}">إصدار النسخة المعتمدة</button>`;
      } else if (r.approvalStatus === "rejected" && own) {
        action = `<button class="btn small secondary" data-approval-action="edit" data-approval-id="${ui.esc(r.id)}">تعديل وإعادة الإرسال</button>`;
      }
      return `<article class="approval-item">
        <div class="approval-copy"><b>${ui.esc(r.fields && r.fields.subject || r.template && r.template.name || kind)}</b>
          <span>${ui.esc(kind)} · ${ui.esc(r.owner || "")}${r.createdAt ? ` · ${ui.formatDate(r.createdAt.slice(0, 10))}` : ""}</span>
          ${r.approvalNote ? `<small>${ui.esc(r.approvalNote)}</small>` : ""}</div>
        <span class="approval-status ${ui.esc(r.approvalStatus)}">${ui.esc(approvalStatus[r.approvalStatus] || "غير محدد")}</span>
        ${action ? `<div class="approval-actions">${action}</div>` : ""}
      </article>`;
    }).join("");
  }

  function captureFields() {
    return Object.fromEntries(FIELDS.map((f) => [f, $("l-" + f).value]));
  }

  function requestApproval(extra) {
    if (activeApproval) { ui.toast("أغلق معاينة الطلب الحالي قبل إرسال مسودة أخرى"); return; }
    if (!App.cloud || !App.cloud.ready()) { ui.toast("سجّل الدخول إلى حساب المركز لإرسال طلب اعتماد مشترك"); return; }
    const isBulk = extra && extra.kind === "bulk";
    if (isBulk ? !(extra.rows || []).length : (!$("l-subject").value.trim() || !$("l-details").value.trim())) { ui.toast(isBulk ? "لا توجد صفوف لإرسالها للاعتماد" : "أدخل الموضوع ومتن المراسلة قبل إرسالها للاعتماد"); return; }
    const request = Object.assign({
      id: store.uid(), owner: App.profile.name(), approvalStatus: "pending", kind: "single",
      fields: captureFields(), template: { id: current().id, name: current().name, bodyTemplate: current().bodyTemplate },
      replyTo, qr: $("l-qr").checked, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }, extra || {});
    approvals().push(request);
    store.save();
    renderApprovals();
    ui.toast("أُرسلت المسودة إلى قائمة الاعتماد");
  }

  function lockComposer(locked) {
    FIELDS.forEach((f) => { $("l-" + f).readOnly = locked; });
    $("tpl-select").disabled = locked;
    $("l-qr").disabled = locked;
  }

  function loadApprovalPreview(request) {
    activeApproval = request;
    approvalTemplate = request.template;
    FIELDS.forEach((f) => { $("l-" + f).value = request.fields && request.fields[f] || ""; });
    if (request.template && allTemplates().some((t) => t.id === request.template.id)) $("tpl-select").value = request.template.id;
    replyTo = request.replyTo || null;
    $("l-qr").checked = !!request.qr;
    verifyId = "";
    lockComposer(true);
    $("letter-approval-clear").hidden = false;
    renderPreview();
    if (request.kind === "bulk") {
      bulkRows = request.rows || [];
      $("lb-file").disabled = true;
      $("lb-go").hidden = true;
      $("lb-register").closest("label").hidden = true;
      $("lb-info").innerHTML = `<p><b>${ui.fmt(bulkRows.length)}</b> خطاباً في هذا الطلب:</p><div class="approval-bulk-preview">${bulkRows.map((row, i) => `<article><b>${ui.fmt(i + 1)}.</b> ${Object.entries(row).map(([key, value]) => `<span><b>${ui.esc(key)}:</b> ${ui.esc(value)}</span>`).join(" · ")}</article>`).join("")}</div>`;
      $("lb-modal").classList.add("open");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearApprovalPreview() {
    activeApproval = null;
    approvalTemplate = null;
    replyTo = null;
    $("reply-note").hidden = true;
    $("letter-approval-clear").hidden = true;
    lockComposer(false);
    renderSelect();
  }

  function editRejected(request) {
    if (!request || request.approvalStatus !== "rejected" || !approvalOwner(request)) return;
    activeApproval = null;
    approvalTemplate = request.template || null;
    FIELDS.forEach((f) => { $("l-" + f).value = request.fields && request.fields[f] || ""; });
    if (request.template) {
      let option = [...$("tpl-select").options].find((o) => o.value === request.template.id);
      if (!option) { option = document.createElement("option"); option.value = request.template.id; option.textContent = `قالب الطلب: ${request.template.name}`; $("tpl-select").append(option); }
      $("tpl-select").value = request.template.id;
    }
    replyTo = request.replyTo || null;
    $("l-qr").checked = !!request.qr;
    lockComposer(false);
    $("letter-approval-clear").hidden = true;
    if (request.kind === "bulk") {
      openBulk();
      $("lb-register").checked = !!request.register;
      $("lb-info").innerHTML = `<p>أُعيد الطلب للمراجعة: ${ui.esc(request.approvalNote || "")}</p><p class="conv-hint">ارفع ملف Excel بعد تعديله ثم أرسل الطلب مرة أخرى.</p>`;
    }
    renderPreview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function issueApproval(request) {
    if (!request || request.approvalStatus !== "approved" || !approvalOwner(request) || !App.profile.can("export")) { ui.toast("لا يمكن إصدار هذا الطلب من هذا الحساب"); return; }
    loadApprovalPreview(request);
    if (request.kind === "bulk") {
      bulkRows = request.rows || [];
      $("lb-register").checked = !!request.register;
      $("lb-progress").textContent = "";
      $("lb-modal").classList.add("open");
      await runBulk(true);
      return;
    }
    ui.toast("تم تحميل النسخة المعتمدة؛ أزرار الإصدار أصبحت متاحة");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function markIssued(requestId) {
    const req = approvals().find((r) => r.id === requestId);
    if (!req) return;
    req.approvalStatus = "issued";
    req.issuedAt = new Date().toISOString();
    req.updatedAt = req.issuedAt;
    store.save();
    activeApproval = null;
    approvalTemplate = null;
    lockComposer(false);
    $("letter-approval-clear").hidden = true;
    renderSelect();
    renderApprovals();
  }

  async function approvalClick(e) {
    const b = e.target.closest("[data-approval-action]");
    if (!b) return;
    const req = approvals().find((r) => r.id === b.dataset.approvalId);
    if (!req) return;
    if (b.dataset.approvalAction === "preview") { loadApprovalPreview(req); return; }
    if (b.dataset.approvalAction === "issue") { await issueApproval(req); return; }
    if (b.dataset.approvalAction === "edit") { editRejected(req); return; }
    if (!App.profile.can("approve") || req.approvalStatus !== "pending" || (approvalOwner(req) && !App.profile.isAdmin())) return;
    const action = b.dataset.approvalAction;
    const note = action === "reject" ? prompt("ملاحظة للمُعدّ تساعده على التعديل:", "") : "";
    if (action === "reject" && note === null) return;
    req.approvalStatus = action === "approve" ? "approved" : "rejected";
    req.approvalBy = App.profile.name();
    req.approvalAt = new Date().toISOString();
    req.approvalNote = note || "";
    req.updatedAt = req.approvalAt;
    store.save();
    renderApprovals();
    ui.toast(action === "approve" ? "اعتُمدت المسودة" : "أُعيدت المسودة للتعديل");
  }

  async function registerOutgoing(file, approvalId) {
    if (!App.registry) return;
    await ensureRef();
    const v = values();
    const number = await App.registry.upsertOutgoing({
      number: v.ref,
      date: $("l-date").value || ui.todayISO(),
      party: [v.recipient, v.recipientTitle].filter(Boolean).join(" - "),
      subject: v.subject || current().name,
      kind: current().name,
      category: "خطابات",
      verifyId: $("l-qr").checked ? verifyId : "",
      file,
      replyTo,
      approvalId,
    });
    if (number) {
      if (approvalId) markIssued(approvalId);
      ui.toast(replyTo ? `سُجّل في الصادر برقم ${number} وربُط بالوارد` : `سُجّل في الصادر برقم ${number}`);
    }
    if (number && replyTo) cancelReply();
  }

  async function exportWord() {
    if (!canIssueApproval()) { ui.toast("أرسل المسودة للاعتماد أولاً، ثم أصدر النسخة بعد الموافقة"); return; }
    await ensureRef();
    const base = fileBase();
    const blob = App.docRender.exportWord(blocks(), base);
    if (blob) await registerOutgoing({ blob, name: base + ".docx" }, activeApproval.id);
  }

  async function exportPDF(asPdf) {
    if (!canIssueApproval()) { ui.toast("أرسل المسودة للاعتماد أولاً، ثم أصدر النسخة بعد الموافقة"); return; }
    await registerOutgoing(null, activeApproval.id);
    App.docRender.print(blocks(), fileBase(), asPdf);
  }

  /* ===== الإصدار الجماعي: صف واحد في Excel = خطاب أو شهادة =====
     أعمدة الملف تُطابق متغيرات القالب ({{recipient}} أو «المرسل إليه»)، والباقي يُؤخذ من الحقول الحالية. */
  const VAR_LABELS = { recipient: "المرسل إليه", recipientTitle: "صفة المرسل إليه", subject: "الموضوع", details: "التفاصيل", attachments: "المرفقات", date: "التاريخ", ref: "رقم الصادر" };
  let bulkRows = [];

  const normKey = (s) => String(s || "").trim().replace(/[\u064B-\u0652]/g, "").replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").toLowerCase();

  /* يربط عمود الملف بمتغير القالب: بالاسم الإنجليزي أو بالمسمى العربي */
  function columnToVar(header) {
    const n = normKey(header);
    if (templates.VARS.includes(String(header).trim())) return String(header).trim();
    const hit = Object.keys(VAR_LABELS).find((k) => normKey(VAR_LABELS[k]) === n || normKey(k) === n);
    return hit || null;
  }

  async function readBulkFile(file) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("لا توجد ورقة في الملف");
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { headers[col - 1] = String(cell.text || "").trim(); });
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1 || rows.length >= 500) return;
      const rec = {};
      headers.forEach((h, idx) => { if (h) rec[h] = String(row.getCell(idx + 1).text || "").trim(); });
      if (Object.values(rec).some((v) => v)) rows.push(rec);
    });
    return { headers: headers.filter(Boolean), rows };
  }

  function openBulk() {
    $("lb-file").value = "";
    $("lb-file").disabled = false;
    bulkRows = [];
    $("lb-info").innerHTML = `<p class="conv-hint">ارفع ملف Excel صفه الأول عناوين الأعمدة، ثم صف لكل خطاب أو شهادة. الأعمدة المفهومة: ${Object.values(VAR_LABELS).map((v) => `«${v}»`).join("، ")}، أو أسماء المتغيرات نفسها مثل {{recipient}}. أي حقل غير موجود في الملف يؤخذ من القيم المكتوبة في الصفحة الآن.</p>`;
    $("lb-go").disabled = true;
    $("lb-go").hidden = false;
    $("lb-register").closest("label").hidden = false;
    $("lb-register").checked = false;
    $("lb-progress").textContent = "";
    $("lb-modal").classList.add("open");
  }
  const closeBulk = () => $("lb-modal").classList.remove("open");

  async function pickBulkFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { headers, rows } = await readBulkFile(file);
      if (!rows.length) throw new Error("لا توجد صفوف بيانات في الملف");
      bulkRows = rows;
      const mapped = headers.map((h) => ({ h, v: columnToVar(h) }));
      const known = mapped.filter((m) => m.v);
      const unknown = mapped.filter((m) => !m.v);
      $("lb-info").innerHTML = `<p><b>${ui.fmt(rows.length)}</b> صفاً جاهزاً للإرسال للاعتماد بقالب «${ui.esc(current().name)}».</p>
        <p class="conv-hint">أعمدة مفهومة: ${known.length ? known.map((m) => `«${ui.esc(m.h)}»`).join("، ") : "لا شيء"}.
        ${unknown.length ? `<br>أعمدة إضافية تُستخدم كمتغيرات داخل القالب: ${unknown.map((m) => `{{${ui.esc(m.h)}}}`).join("، ")}.` : ""}</p>`;
      $("lb-go").disabled = false;
    } catch (err) {
      $("lb-info").innerHTML = `<p class="conv-warn">${ui.esc(err.message)}</p>`;
      $("lb-go").disabled = true;
    }
  }

  async function runBulk(fromApproval) {
    if (!bulkRows.length) return;
    if (!fromApproval) {
      requestApproval({ kind: "bulk", rows: bulkRows, register: $("lb-register").checked, fields: captureFields(), template: { id: current().id, name: current().name, bodyTemplate: current().bodyTemplate } });
      closeBulk();
      return;
    }
    if (!canIssueApproval() || activeApproval.kind !== "bulk") { ui.toast("هذا الإصدار الجماعي لا يحمل اعتماداً صالحاً"); return; }
    if (typeof JSZip === "undefined") { ui.toast("تعذّر تحميل مكتبة الضغط"); return; }
    const register = $("lb-register").checked;
    $("lb-go").disabled = true;
    const zip = new JSZip();
    const base = values();
    let numbers = [];
    try {
      if (register) numbers = await App.registry.assignNumbers("out", $("l-date").value || ui.todayISO(), bulkRows.length);
      for (let i = 0; i < bulkRows.length; i++) {
        $("lb-progress").textContent = `جارٍ التوليد ${ui.fmt(i + 1)} من ${ui.fmt(bulkRows.length)}…`;
        const row = bulkRows[i];
        const v = Object.assign({}, base);
        Object.keys(row).forEach((h) => { const k = columnToVar(h); v[k || h] = row[h]; });
        if (register) v.ref = numbers[i];
        const list = [{ kind: "title", text: "بسم الله الرحمن الرحيم" }]
          .concat(metaBlocks(v), templates.toBlocks(templates.render(current().bodyTemplate, v)));
        const name = App.docRender.cleanFileName([current().name, v.recipient || v.subject || i + 1].filter(Boolean).join(" - ")) + ".docx";
        const blob = App.docRender.exportWord(list, name.replace(/\.docx$/, ""), true);
        if (blob) {
          zip.file(name, blob);
          if (register) {
            await App.registry.upsertOutgoing({
              number: v.ref, date: $("l-date").value || ui.todayISO(),
              party: [v.recipient, v.recipientTitle].filter(Boolean).join(" - "),
              subject: v.subject || current().name, kind: current().name, category: "خطابات",
              file: { blob, name },
              approvalId: activeApproval.id,
            });
          }
        }
      }
      ui.download(`${App.docRender.cleanFileName(current().name)} - ${ui.fmt(bulkRows.length)} ملف - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
      markIssued(activeApproval.id);
      ui.toast(register ? `صدر ${ui.fmt(bulkRows.length)} خطاباً وسُجّلت في الصادر` : `صدر ${ui.fmt(bulkRows.length)} ملفاً`);
      closeBulk();
    } catch (e) {
      console.error(e);
      $("lb-progress").textContent = e.message;
    }
    $("lb-go").disabled = false;
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
    $("ai-share").checked = s.share !== false;
    $("ai-claude-model").innerHTML = App.ai.CLAUDE_MODELS
      .map((m) => `<option value="${m.id}"${m.id === s.claudeModel ? " selected" : ""}>${ui.esc(m.label)}</option>`).join("");
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
      const share = $("ai-share").checked;
      App.ai.saveSettings({
        provider: $("ai-provider").value,
        geminiKey: $("ai-gemini-key").value.trim(),
        claudeKey: $("ai-claude-key").value.trim(),
        claudeModel: $("ai-claude-model").value,
        share,
      });
      closeAiSettings();
      aiStatus(App.ai.hasKey() ? "تم حفظ الإعدادات." : "");
      ui.toast(share ? "حُفظ المفتاح لكل مستخدمي المركز" : "حُفظ المفتاح على هذا الجهاز فقط");
    });
    $("ai-key-delete").addEventListener("click", () => {
      if (!confirm("حذف مفاتيح الذكاء الاصطناعي من هذا الجهاز؟")) return;
      App.ai.saveSettings({ provider: $("ai-provider").value, geminiKey: "", claudeKey: "", share: $("ai-share").checked });
      closeAiSettings();
      ui.toast($("ai-share").checked ? "حُذفت المفاتيح من إعدادات المركز" : "حُذفت المفاتيح من هذا الجهاز");
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
    $("tpl-select").addEventListener("change", () => {
      if (approvalTemplate && $("tpl-select").value !== approvalTemplate.id) approvalTemplate = null;
      renderPreview();
    });
    $("l-qr").addEventListener("change", () => { verifyId = ""; renderPreview(); });

    $("lb-open").addEventListener("click", openBulk);
    $("lb-file").addEventListener("change", pickBulkFile);
    $("lb-go").addEventListener("click", runBulk);
    $("lb-cancel").addEventListener("click", closeBulk);
    $("lb-modal").addEventListener("click", (e) => { if (e.target.id === "lb-modal") closeBulk(); });
    $("letter-approval-request").addEventListener("click", () => requestApproval());
    $("letter-approval-clear").addEventListener("click", clearApprovalPreview);
    $("letter-approvals").addEventListener("click", approvalClick);
    $("btn-copy").addEventListener("click", () => {
      if (!canIssueApproval()) { ui.toast("اعتمد المسودة قبل نسخ النص النهائي"); return; }
      ui.copyText(plainText());
    });
    $("btn-word").addEventListener("click", exportWord);
    $("btn-pdf").addEventListener("click", () => exportPDF(true));
    $("btn-print").addEventListener("click", () => exportPDF(false));
    $("l-ref-auto").addEventListener("click", async () => {
      $("l-ref").value = await App.registry.assignNumber("out", $("l-date").value || ui.todayISO());
      renderPreview();
    });
    $("reply-cancel").addEventListener("click", cancelReply);

    $("tpl-new").addEventListener("click", () => openEditor(null));
    $("tpl-dup").addEventListener("click", () => openEditor(current()));
    $("tpl-edit").addEventListener("click", () => openEditor(current()));
    $("tpl-delete").addEventListener("click", deleteTemplate);
    $("tpl-form").addEventListener("submit", saveTemplate);
    $("tpl-cancel").addEventListener("click", closeEditor);
    $("tpl-modal").addEventListener("click", (e) => { if (e.target.id === "tpl-modal") closeEditor(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEditor(); });
    window.addEventListener("resize", () => { if ($("view-letters").classList.contains("active")) renderPreview(); });
    store.onChange(renderApprovals);
    store.onExternal(renderApprovals);

    $("vars-hint").innerHTML =
      "المتغيرات: " + templates.VARS.map((v) => `<code>{{${v}}}</code>`).join(" ") +
      "<br>التنسيق في بداية السطر: <code>#</code> عنوان في الوسط · <code>##</code> خط عريض · <code>&gt;&gt;</code> محاذاة لليسار (التوقيع) · <code>@@ الاسم | الصفة | المحترم</code> سطر المرسل إليه";
    renderSelect(templates.BUILT_IN[0].id);
    renderApprovals();
  }

  App.letters = { init, render: renderPreview, blocks, startReply, openAiSettings, refreshTemplates: () => { renderSelect(); renderApprovals(); } };
})(window.App = window.App || {});
