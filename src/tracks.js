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
        <td class="reg-actions">${!App.profile.can || App.profile.can("delete") ? `<button class="act-btn del" data-del title="حذف المسار">🗑</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty">لا توجد مسارات. اضغط «+ مسار جديد».</td></tr>`;

    renderFoot();
  }

  function renderFoot() {
    const tracks = ordered();
    const s = summary(tracks);
    document.getElementById("tracks-foot").innerHTML = `
      <tr>
        <th>الإجمالي / المتوسط (${ui.fmt(tracks.length)} مسار)</th><th></th>
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

    if (f === "name" || f === "type") {
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

  function init() {
    const body = document.getElementById("tracks-body");
    body.addEventListener("input", onInput);
    body.addEventListener("change", (e) => { onInput(e); renderFoot(); });
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del]");
      if (btn) removeTrack(btn.closest("tr").dataset.id);
    });
    document.getElementById("tracks-add").addEventListener("click", addTrack);
  }

  App.tracks = { init, render, ordered, summary, hoursPct, textSummary, TYPE_LABEL };
})(window.App = window.App || {});
