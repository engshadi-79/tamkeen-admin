/* اللوحة الرئيسية */
(function (App) {
  const { store, ui } = App;
  const ATTENDANCE_THRESHOLD = 80;

  function render() {
    const { tasks } = store.get();
    const trackList = App.tracks.ordered();
    const s = App.tracks.summary(trackList);
    const pending = tasks.filter((t) => !t.done);
    const overdue = pending.filter(ui.isOverdue);

    document.getElementById("stats").innerHTML = `
      <div class="stat"><div class="label">إجمالي المستفيدين</div><div class="value">${ui.fmt(s.beneficiaries)}</div><div class="sub">عبر ${ui.fmt(trackList.length)} مسارات تدريبية</div></div>
      <div class="stat"><div class="label">نسبة الإنجاز العامة</div><div class="value">${ui.fmt(s.completionPct, 1)}%</div><div class="sub">متوسط الساعات المكتملة من ${store.TOTAL_HOURS}</div></div>
      <div class="stat"><div class="label">متوسط نسبة الحضور</div><div class="value">${ui.fmt(s.attendancePct, 1)}%</div><div class="sub">الحد الأدنى المطلوب ${ATTENDANCE_THRESHOLD}%</div></div>
      <div class="stat"><div class="label">مهام قيد الانتظار</div><div class="value">${ui.fmt(pending.length)}</div><div class="sub">${overdue.length ? `منها ${ui.fmt(overdue.length)} متأخرة` : "لا توجد مهام متأخرة"}</div></div>`;

    const alerts = [];
    trackList.filter((t) => Number(t.attendancePct) < ATTENDANCE_THRESHOLD).forEach((t) => {
      alerts.push(`<li class="danger">نسبة الحضور في مسار <b>${ui.esc(t.name)}</b> بلغت ${ui.fmt(t.attendancePct)}%، وهي أقل من ${ATTENDANCE_THRESHOLD}%.</li>`);
    });
    overdue.forEach((t) => {
      alerts.push(`<li class="warn">المهمة «${ui.esc(t.text)}» متأخرة عن موعدها (${ui.formatDate(t.dueDate)}).</li>`);
    });
    // الوارد الذي يحتاج معالجة أو رداً: المتأخر والمستحق خلال 3 أيام
    (App.registry ? App.registry.followUps() : []).forEach(({ rec, days }) => {
      const when = days < 0 ? `متأخر ${ui.fmt(-days)} يوم` : days === 0 ? "مطلوب اليوم" : `مطلوب خلال ${ui.fmt(days)} يوم`;
      alerts.push(`<li class="${days < 0 ? "danger" : "warn"}">الوارد <b>${ui.esc(rec.number)}</b>${rec.subject ? ` «${ui.esc(rec.subject)}»` : ""}${rec.party ? ` من ${ui.esc(rec.party)}` : ""}: ${when} (${ui.formatDate(rec.dueDate)}). <a href="#registry">فتح السجل</a></li>`);
    });
    document.getElementById("alerts").innerHTML = alerts.length ? alerts.join("") : `<li class="ok">لا توجد تنبيهات حالياً — جميع المؤشرات ضمن الحدود المطلوبة.</li>`;

    const files = new Map();
    (App.registry ? App.registry.live() : []).forEach((r) => { if (r.track) files.set(r.track, (files.get(r.track) || 0) + 1); });
    document.getElementById("dash-tracks").innerHTML = trackList.map((t) => {
      const low = Number(t.attendancePct) < ATTENDANCE_THRESHOLD;
      return `<tr>
        <td>${ui.esc(t.name)}</td>
        <td><span class="badge ${t.type}">${App.tracks.TYPE_LABEL[t.type]}</span></td>
        <td>${ui.fmt(t.beneficiaries)}</td>
        <td><span class="badge ${low ? "low" : "good"}">${ui.fmt(t.attendancePct)}%</span></td>
        <td style="min-width:140px">${ui.progressBar(App.tracks.hoursPct(t))}</td>
        <td>${ui.fmt(files.get(t.name) || 0)}</td>
      </tr>`;
    }).join("");

    const next = App.tasks.sorted(pending).slice(0, 5);
    document.getElementById("dash-tasks").innerHTML = next.length
      ? next.map((t) => App.tasks.itemHTML(t, { actions: false })).join("")
      : `<li class="empty">لا توجد مهام غير منجزة.</li>`;
  }

  App.dashboard = { render };
})(window.App = window.App || {});
