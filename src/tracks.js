/* متابعة المسارات */
(function (App) {
  const { store, ui } = App;

  const TYPE_LABEL = { craft: "حرفي / مهني", digital: "رقمي / تقني" };

  const hoursPct = (t) => (store.clamp(t.hoursCompleted, 0, store.TOTAL_HOURS) / store.TOTAL_HOURS) * 100;

  function summary(tracks) {
    const n = tracks.length || 1;
    return {
      beneficiaries: tracks.reduce((s, t) => s + (Number(t.beneficiaries) || 0), 0),
      completionPct: tracks.reduce((s, t) => s + hoursPct(t), 0) / n,
      attendancePct: tracks.reduce((s, t) => s + (Number(t.attendancePct) || 0), 0) / n,
    };
  }

  /* نص مختصر يُدرج في تقرير الإنجاز الدوري */
  function textSummary(tracks) {
    const s = summary(tracks);
    const lines = tracks.map((t, i) =>
      `${i + 1}. ${t.name} (${TYPE_LABEL[t.type]}): ${ui.fmt(t.beneficiaries)} مستفيد، نسبة الحضور ${ui.fmt(t.attendancePct)}%، الساعات المكتملة ${ui.fmt(t.hoursCompleted)} من ${store.TOTAL_HOURS} ساعة (${ui.fmt(hoursPct(t))}%).`
    );
    lines.push("");
    lines.push(`الإجمالي: ${ui.fmt(s.beneficiaries)} مستفيد، متوسط الحضور ${ui.fmt(s.attendancePct, 1)}%، نسبة الإنجاز العامة ${ui.fmt(s.completionPct, 1)}%.`);
    return lines.join("\n");
  }

  /* الترتيب الذي يحدده المستخدم (حقل order)، ثم الأقدم إضافةً */
  function ordered() {
    const list = store.get().tracks || [];
    return list.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  function render() {
    const tracks = ordered();
    const body = document.getElementById("tracks-body");
    body.innerHTML = tracks.map((t) => `
      <tr data-id="${t.id}">
        <td><input type="text" data-f="name" value="${ui.esc(t.name)}" aria-label="اسم المسار"></td>
        <td><input type="text" data-f="trainer1" value="${ui.esc(t.trainer1 || "")}" placeholder="—" aria-label="المدرب الأول"></td>
        <td><input type="text" data-f="trainer2" value="${ui.esc(t.trainer2 || "")}" placeholder="—" aria-label="المدرب الثاني"></td>
        <td>
          <select data-f="type" aria-label="نوع المسار">
            <option value="craft" ${t.type === "craft" ? "selected" : ""}>${TYPE_LABEL.craft}</option>
            <option value="digital" ${t.type === "digital" ? "selected" : ""}>${TYPE_LABEL.digital}</option>
          </select>
        </td>
        <td><input type="number" min="0" data-f="beneficiaries" value="${t.beneficiaries}" aria-label="عدد المستفيدين"></td>
        <td><input type="number" min="0" max="100" data-f="attendancePct" value="${t.attendancePct}" aria-label="نسبة الحضور"></td>
        <td><input type="number" min="0" max="${store.TOTAL_HOURS}" data-f="hoursCompleted" value="${t.hoursCompleted}" aria-label="الساعات المكتملة"></td>
        <td style="min-width:150px" data-progress>${ui.progressBar(hoursPct(t))}</td>
        <td class="reg-actions">${!App.profile.can || App.profile.can("delete") ? `<button class="act-btn del" data-del title="حذف المسار"><span class="material-symbols-outlined btn-ico">delete</span></button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="empty">لا توجد مسارات. اضغط «+ مسار جديد».</td></tr>`;

    renderFoot();
    renderCatalog();
  }

  function renderCatalog() {
    const records = store.get().trackCodes || [];
    const paths = records.filter((r) => r.kind === "path");
    const codes = records.filter((r) => r.kind === "phaseCode");
    const query = String((document.getElementById("track-catalog-search") || {}).value || "").trim().toLowerCase();
    const matches = (r) => !query || [r.name, r.englishName, r.code, r.phase, r.trackName, r.trackCode, r.group].some((v) => String(v || "").toLowerCase().includes(query));
    const pathBody = document.getElementById("track-paths-body");
    const codeBody = document.getElementById("track-codes-body");
    if (!pathBody || !codeBody) return;
    pathBody.innerHTML = paths.filter(matches).map((r) => `<tr><td>${ui.esc(r.name)}</td><td dir="ltr">${ui.esc(r.englishName)}</td><td><span class="track-code-pill">${ui.esc(r.code)}</span></td></tr>`).join("") || `<tr><td colspan="3" class="empty">لا توجد نتائج مطابقة</td></tr>`;
    /* بيانات الدورة التي لا يعرفها نظام المركز (تواريخها ونوعها) تُكتب هنا مرة واحدة،
       فتدخل التقارير والنماذج الرسمية لكل طالب في تلك الدورة. */
    codeBody.innerHTML = codes.filter(matches).map((r) => `<tr data-code-id="${ui.esc(r.id)}">
        <td>${ui.esc(r.phase)}</td><td>${ui.esc(r.trackName)}</td><td>${ui.esc(r.group)}</td>
        <td><span class="track-code-pill">${ui.esc(r.code)}</span></td>
        <td><input type="date" data-code-f="start" value="${ui.esc(r.start || "")}"></td>
        <td><input type="date" data-code-f="end" value="${ui.esc(r.end || "")}"></td>
        <td><input type="text" data-code-f="type" list="track-train-types" value="${ui.esc(r.type || "")}" placeholder="دورة"></td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty">لا توجد نتائج مطابقة</td></tr>`;
    const count = document.getElementById("track-catalog-count");
    if (count) count.textContent = `${ui.fmt(paths.length)} مسارات · ${ui.fmt(codes.length)} رمز مرحلة ومجموعة`;
    fillPhases(codes);
  }

  /* المرحلة الواحدة فيها كل المسارات ومجموعاتها، وتواريخها واحدة غالباً:
     تُكتب مرة هنا فتنزل على صفوفها كلها. */
  function fillPhases(codes) {
    const sel = document.getElementById("track-bulk-phase");
    if (!sel) return;
    const phases = [...new Set(codes.map((r) => r.phase).filter(Boolean))];
    const keep = sel.value;
    sel.innerHTML = phases.map((p) => `<option ${p === keep ? "selected" : ""}>${ui.esc(p)}</option>`).join("");
  }

  function applyToPhase() {
    const phase = (document.getElementById("track-bulk-phase") || {}).value || "";
    const start = document.getElementById("track-bulk-start").value;
    const end = document.getElementById("track-bulk-end").value;
    const type = document.getElementById("track-bulk-type").value.trim();
    if (!phase) { ui.toast("اختر المرحلة"); return; }
    if (!start && !end && !type) { ui.toast("اكتب تاريخاً أو نوعاً لتطبيقه"); return; }
    const rows = (store.get().trackCodes || []).filter((r) => r.kind === "phaseCode" && r.phase === phase);
    const now = new Date().toISOString();
    rows.forEach((r) => {
      if (start) r.start = start;
      if (end) r.end = end;
      if (type) r.type = type;
      r.updatedAt = now;
    });
    store.save();
    renderCatalog();
    const what = [start && "بداية", end && "نهاية", type && "نوع التدريب"].filter(Boolean).join(" و");
    ui.toast(`طُبّق ${what} على ${ui.fmt(rows.length)} ${rows.length <= 10 ? "صفوف" : "صفاً"} في ${phase}`);
  }

  function renderFoot() {
    const tracks = ordered();
    const s = summary(tracks);
    document.getElementById("tracks-foot").innerHTML = `
      <tr>
        <th>الإجمالي / المتوسط (${ui.fmt(tracks.length)} مسار)</th><th></th><th></th><th></th>
        <th>${ui.fmt(s.beneficiaries)}</th>
        <th>${ui.fmt(s.attendancePct, 1)}%</th>
        <th>${ui.fmt(tracks.reduce((a, t) => a + Number(t.hoursCompleted || 0), 0))} / ${ui.fmt(store.TOTAL_HOURS * tracks.length)}</th>
        <th>${ui.progressBar(s.completionPct)}</th><th></th>
      </tr>`;
  }

  function onInput(e) {
    const input = e.target;
    const f = input.dataset.f;
    if (!f) return;
    const row = input.closest("tr");
    const track = store.get().tracks.find((t) => t.id === row.dataset.id);
    if (!track) return;

    if (f === "name" || f === "type" || f === "trainer1" || f === "trainer2") {
      track[f] = input.value;
    } else {
      const max = f === "attendancePct" ? 100 : f === "hoursCompleted" ? store.TOTAL_HOURS : Infinity;
      track[f] = store.clamp(input.value, 0, max);
      if (e.type === "change") input.value = track[f];
    }
    row.querySelector("[data-progress]").innerHTML = ui.progressBar(hoursPct(track));
    store.save();
    renderFoot();
  }

  /* إضافة مسار جديد فارغ، والتركيز على اسمه */
  function addTrack() {
    const list = store.get().tracks;
    const t = { id: store.uid(), name: "", type: "craft", beneficiaries: 0, attendancePct: 0, hoursCompleted: 0, order: list.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0) + 1 };
    store.get().tracks.push(t);
    store.save();
    render();
    const input = document.querySelector(`#tracks-body tr[data-id="${t.id}"] [data-f="name"]`);
    if (input) { input.focus(); input.scrollIntoView({ block: "center" }); }
    ui.toast("أُضيف مسار جديد — اكتب اسمه");
  }

  function removeTrack(id) {
    const s = store.get();
    const t = s.tracks.find((x) => x.id === id);
    if (!t) return;
    const used = (s.roster || []).filter((r) => Object.values(r.values || {}).includes(t.name)).length;
    const msg = `حذف المسار «${t.name || "بلا اسم"}»؟`
      + (used ? `\nمرتبط بـ ${ui.fmt(used)} مستفيداً في القائمة (بياناتهم تبقى كما هي).` : "")
      + "\nيُحذف عند كل المستخدمين، ولا يمكن التراجع.";
    if (!confirm(msg)) return;
    s.tracks = s.tracks.filter((x) => x.id !== id);
    store.save();
    render();
    App.dashboard.render();
    ui.toast("حُذف المسار");
  }

  const normName = (t) => String(t || "").replace(/^مسار\s*/, "").replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

  /* عدد المستفيدين لكل مسار من قائمة التعهدات */
  function rosterCounts() {
    const s = store.get();
    const col = ((s.rosterMeta || {}).columns || []).find((c) => /مسار/.test(c.label));
    const counts = {};
    if (!col) return counts;
    (s.roster || []).forEach((r) => {
      const v = String((r.values || {})[col.key] || "").trim();
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
    return counts;
  }

  /* حذف المسارات المكررة بالاسم، مع الإبقاء على الصف الذي فيه بيانات */
  function dedupe() {
    const list = store.get().tracks || [];
    const best = new Map();
    list.forEach((t) => {
      const k = normName(t.name);
      const score = (Number(t.attendancePct) || 0) + (Number(t.hoursCompleted) || 0);
      const cur = best.get(k);
      if (!cur || score > cur.score) best.set(k, { track: t, score });
    });
    const keep = [...best.values()].map((x) => x.track);
    const removed = list.length - keep.length;
    if (!removed) { ui.toast("لا توجد مسارات مكررة"); return; }
    if (!confirm(`حذف ${ui.fmt(removed)} مساراً مكرراً والإبقاء على ${ui.fmt(keep.length)}؟\nيُطبَّق عند كل المستخدمين.`)) return;
    if (App.shared) App.shared.allowWipe("tracks");
    store.get().tracks = keep;
    store.save();
    render();
    App.dashboard.render();
    ui.toast(`حُذف ${ui.fmt(removed)} مساراً مكرراً`);
  }

  /* اعتماد قائمة مسارات مكتوبة: تحلّ محل الموجود، مع الاحتفاظ ببيانات المسار المطابق بالاسم */
  function openList() {
    const current = ordered().map((t) => t.name).filter(Boolean);
    document.getElementById("trk-list").value = current.join("\n");
    document.getElementById("trk-counts").checked = true;
    document.getElementById("trk-modal").classList.add("open");
    setTimeout(() => document.getElementById("trk-list").focus(), 50);
  }

  function applyList() {
    const names = document.getElementById("trk-list").value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!names.length) { ui.toast("اكتب أسماء المسارات، كل اسم في سطر"); return; }
    const old = store.get().tracks || [];
    const counts = document.getElementById("trk-counts").checked ? rosterCounts() : null;
    const rosterKeys = counts ? Object.keys(counts) : [];
    const next = names.map((name, i) => {
      const prev = old.find((t) => normName(t.name) === normName(name));
      const rosterName = rosterKeys.find((k) => normName(k) === normName(name));
      return {
        id: (prev && prev.id) || store.uid(),
        name,
        type: (prev && prev.type) || (/تصميم|تسويق|رقم|حاسب|برمج|ترجمة|افتراضي/.test(name) ? "digital" : "craft"),
        beneficiaries: rosterName ? counts[rosterName] : (prev ? Number(prev.beneficiaries) || 0 : 0),
        attendancePct: prev ? Number(prev.attendancePct) || 0 : 0,
        hoursCompleted: prev ? Number(prev.hoursCompleted) || 0 : 0,
        trainer1: prev ? prev.trainer1 || "" : "",
        trainer2: prev ? prev.trainer2 || "" : "",
        order: i + 1,
      };
    });
    const removed = old.length - next.filter((t) => old.some((o) => o.id === t.id)).length;
    if (!confirm(`اعتماد ${ui.fmt(next.length)} مساراً وحذف ما عداها (${ui.fmt(Math.max(0, removed))} مساراً)؟\nيُطبَّق عند كل المستخدمين، ولا يمكن التراجع.`)) return;
    if (App.shared) App.shared.allowWipe("tracks");
    store.get().tracks = next;
    store.save();
    document.getElementById("trk-modal").classList.remove("open");
    render();
    App.dashboard.render();
    ui.toast(`اعتُمدت ${ui.fmt(next.length)} مسارات`);
    if (App.shared) App.shared.sync(true);
  }

  function init() {
    const body = document.getElementById("tracks-body");
    document.getElementById("tracks-dedupe").addEventListener("click", dedupe);
    document.getElementById("tracks-list").addEventListener("click", openList);
    document.getElementById("trk-apply").addEventListener("click", applyList);
    document.getElementById("trk-cancel").addEventListener("click", () => document.getElementById("trk-modal").classList.remove("open"));
    document.getElementById("trk-modal").addEventListener("click", (e) => { if (e.target.id === "trk-modal") e.currentTarget.classList.remove("open"); });
    body.addEventListener("input", onInput);
    body.addEventListener("change", (e) => { onInput(e); renderFoot(); });
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del]");
      if (btn) removeTrack(btn.closest("tr").dataset.id);
    });
    document.getElementById("tracks-add").addEventListener("click", addTrack);
    document.getElementById("track-catalog-search").addEventListener("input", renderCatalog);
    const apply = document.getElementById("track-bulk-apply");
    if (apply) apply.addEventListener("click", applyToPhase);
    const codeBody = document.getElementById("track-codes-body");
    if (codeBody) codeBody.addEventListener("change", (e) => {
      const input = e.target.closest("[data-code-f]");
      if (!input) return;
      const id = input.closest("tr").dataset.codeId;
      const row = (store.get().trackCodes || []).find((r) => r.id === id);
      if (!row) return;
      row[input.dataset.codeF] = input.value;
      row.updatedAt = new Date().toISOString();
      store.save();
      ui.toast("حُفظ");
    });
  }

  App.tracks = { init, render, ordered, summary, hoursPct, textSummary, TYPE_LABEL, renderCatalog };
})(window.App = window.App || {});
