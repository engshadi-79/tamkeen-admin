/* تدقيق بيانات المستفيدين: المكرّر برقم الهوية، والهوية غير الصحيحة (خانة التحقق)،
   والجوال بصيغة غير صحيحة، والحقول الأساسية الناقصة. يُفتح من زر في صفحة المستفيدين،
   ويُعرض تلقائياً قبل التصدير إن وُجدت مشكلات. لا يعدّل شيئاً: يعرض فقط، والضغط على الاسم يبحث عنه. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const digits = (s) => String(s == null ? "" : s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/\D/g, "");

  /* رقم الهوية الفلسطيني: 9 أرقام، وآخرها خانة تحقق (خوارزمية Luhn) */
  function validId(raw) {
    const d = digits(raw);
    if (d.length !== 9) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let n = Number(d[i]) * (i % 2 ? 2 : 1);
      if (n > 9) n -= 9;
      sum += n;
    }
    return sum % 10 === 0;
  }

  /* الجوال: 059 أو 056 وبعدها 7 أرقام، ويُقبل بمفتاح 970 أو 972 */
  function validPhone(raw) {
    let d = digits(raw);
    if (!d) return false;
    if (/^(00)?97[02]/.test(d)) d = "0" + d.replace(/^(00)?97[02]/, "");
    return /^05[69]\d{7}$/.test(d);
  }

  /* الأعمدة من أسمائها */
  function columns() {
    const cols = ((store.get().rosterMeta || {}).columns || []);
    const find = (re) => cols.find((c) => re.test(c.label || ""));
    return {
      name: find(/الاسم|اسم/),
      id: find(/هوية|الهويه|رقم الهوية/),
      phone: find(/جوال|هاتف|موبايل|تواصل/),
      all: cols,
    };
  }

  function audit() {
    const rows = (store.get().roster || []);
    const c = columns();
    const val = (r, col) => (col ? String((r.values || {})[col.key] == null ? "" : r.values[col.key]).trim() : "");
    const label = (r) => val(r, c.name) || val(r, c.id) || "بلا اسم";

    const dup = new Map();
    const badId = [], badPhone = [], missing = [];
    rows.forEach((r) => {
      const id = digits(val(r, c.id));
      if (id) { if (!dup.has(id)) dup.set(id, []); dup.get(id).push(r); }
      if (c.id && val(r, c.id) && !validId(val(r, c.id))) badId.push({ r, v: val(r, c.id) });
      if (c.phone && val(r, c.phone)) {
        // قد تحوي الخانة رقمين: يكفي أن يصح أحدهما
        const parts = val(r, c.phone).split(/[\s,،/\\|-]+/).filter((p) => digits(p).length >= 9);
        if (!parts.length || !parts.some(validPhone)) badPhone.push({ r, v: val(r, c.phone) });
      }
      const empty = [c.name, c.id, c.phone].filter((col) => col && !val(r, col)).map((col) => col.label);
      if (empty.length) missing.push({ r, v: empty.join("، ") });
    });
    const dups = [...dup.entries()].filter(([, list]) => list.length > 1).map(([id, list]) => ({ id, list }));
    return { c, label, dups, badId, badPhone, missing, total: rows.length, count: dups.length + badId.length + badPhone.length + missing.length };
  }

  function section(title, hint, items) {
    if (!items.length) return "";
    return `<div class="au-sec"><h4>${title} <span class="au-n">${ui.fmt(items.length)}</span></h4><p class="conv-hint">${hint}</p>
      <ul class="au-list">${items.slice(0, 200).join("")}</ul>${items.length > 200 ? `<p class="conv-hint">و${ui.fmt(items.length - 200)} أخرى</p>` : ""}</div>`;
  }

  function render(forExport) {
    const a = audit();
    const item = (r, extra) => `<li><button type="button" class="conv-link" data-find="${esc(a.label(r))}">${esc(a.label(r))}</button>${extra ? ` <span class="au-v">${esc(extra)}</span>` : ""}</li>`;
    const noCols = [!a.c.name && "الاسم", !a.c.id && "رقم الهوية", !a.c.phone && "الجوال"].filter(Boolean);
    $("au-body").innerHTML = `
      <p class="au-summary">${a.count ? `⚠ ${ui.fmt(a.count)} ملاحظة في ${ui.fmt(a.total)} سجلاً` : `✓ لا توجد ملاحظات في ${ui.fmt(a.total)} سجلاً`}</p>
      ${noCols.length ? `<p class="conv-hint">لم أجد عموداً باسم: ${noCols.join("، ")} — فلا يُدقَّق.</p>` : ""}
      ${section("مكرّر برقم الهوية", "السجل نفسه أكثر من مرة: احذف المكرّر أو ادمج ملاحظاته.", a.dups.map((d) => `<li><b dir="ltr">${esc(d.id)}</b> × ${d.list.length}: ${d.list.map((r) => `<button type="button" class="conv-link" data-find="${esc(d.id)}">${esc(a.label(r))}</button>`).join("، ")}</li>`))}
      ${section("رقم هوية غير صحيح", "ليس 9 أرقام، أو خانة التحقق الأخيرة لا تطابق.", a.badId.map((x) => item(x.r, x.v)))}
      ${section("جوال بصيغة غير صحيحة", "المتوقع 059 أو 056 وبعدها 7 أرقام (يُقبل +970 و+972).", a.badPhone.map((x) => item(x.r, x.v)))}
      ${section("حقول أساسية ناقصة", "الاسم أو الهوية أو الجوال فارغ.", a.missing.map((x) => item(x.r, x.v)))}`;
    $("au-export").hidden = !forExport;
    $("au-modal").classList.add("open");
    return a;
  }

  let onContinue = null;

  /* قبل التصدير: إن لم توجد ملاحظات يُصدَّر مباشرة، وإلا تُعرض ويختار المستخدم */
  function beforeExport(go) {
    const a = audit();
    if (!a.count) { go(); return; }
    onContinue = go;
    render(true);
  }

  function init() {
    $("ros-audit").addEventListener("click", () => render(false));
    $("au-close").addEventListener("click", () => $("au-modal").classList.remove("open"));
    $("au-export").addEventListener("click", () => {
      $("au-modal").classList.remove("open");
      if (onContinue) { const f = onContinue; onContinue = null; f(); }
    });
    $("au-modal").addEventListener("click", (e) => {
      if (e.target.id === "au-modal") { $("au-modal").classList.remove("open"); return; }
      const b = e.target.closest("[data-find]");
      if (!b) return;
      $("au-modal").classList.remove("open");
      const box = $("ros-search");
      if (box) { box.value = b.dataset.find; box.dispatchEvent(new Event("input", { bubbles: true })); }
    });
  }

  App.rosterAudit = { init, audit, beforeExport, validId, validPhone };
})(window.App = window.App || {});
