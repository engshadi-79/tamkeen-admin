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
    const dateEl = document.getElementById("dash-date");
    if (dateEl) dateEl.textContent = new Intl.DateTimeFormat("ar-PS", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());

    document.getElementById("stats").innerHTML = `
      <div class="stat stat-beneficiaries"><div class="stat-top"><span class="stat-icon" aria-hidden="true">♙</span><span class="stat-period">إجمالي</span></div><div class="label">المستفيدون</div><div class="value">${ui.fmt(s.beneficiaries)}</div><div class="sub">موزعون على ${ui.fmt(trackList.length)} مسارات</div></div>
      <div class="stat stat-completion"><div class="stat-top"><span class="stat-icon" aria-hidden="true">◔</span><span class="stat-period">التدريب</span></div><div class="label">إنجاز الساعات</div><div class="value">${ui.fmt(s.completionPct, 1)}%</div><div class="stat-meter"><i style="width:${Math.max(0, Math.min(100, Number(s.completionPct) || 0))}%"></i></div><div class="sub">من إجمالي ${store.TOTAL_HOURS} ساعة لكل مسار</div></div>
      <div class="stat stat-attendance"><div class="stat-top"><span class="stat-icon" aria-hidden="true">✓</span><span class="stat-period">الحضور</span></div><div class="label">متوسط الحضور</div><div class="value">${ui.fmt(s.attendancePct, 1)}%</div><div class="stat-meter"><i style="width:${Math.max(0, Math.min(100, Number(s.attendancePct) || 0))}%"></i></div><div class="sub">المستهدف ${ATTENDANCE_THRESHOLD}%</div></div>
      <div class="stat stat-tasks ${overdue.length ? "has-overdue" : ""}"><div class="stat-top"><span class="stat-icon" aria-hidden="true">☑</span><span class="stat-period">المتابعة</span></div><div class="label">مهام مفتوحة</div><div class="value">${ui.fmt(pending.length)}</div><div class="sub">${overdue.length ? `${ui.fmt(overdue.length)} مهام متأخرة وتحتاج متابعة` : "لا توجد مهام متأخرة"}</div></div>`;

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
    const alertCount = document.getElementById("dash-alert-count");
    if (alertCount) { alertCount.textContent = ui.fmt(alerts.length); alertCount.classList.toggle("is-clear", alerts.length === 0); }

    const team = new Map();
    tasks.forEach((task) => {
      const owner = String(task.owner || "").trim() || "بلا مسؤول";
      const row = team.get(owner) || { open: 0, overdue: 0, done: 0, nextDate: "", nextDistance: Infinity };
      if (task.done) row.done++;
      else {
        row.open++;
        if (ui.isOverdue(task)) row.overdue++;
        if (task.dueDate) {
          const distance = Math.abs(Date.parse(`${task.dueDate}T00:00:00Z`) - Date.parse(`${ui.todayISO()}T00:00:00Z`));
          if (Number.isFinite(distance) && distance < row.nextDistance) {
            row.nextDate = task.dueDate;
            row.nextDistance = distance;
          }
        }
      }
      team.set(owner, row);
    });
    const teamRows = [...team.entries()].sort((a, b) =>
      b[1].overdue - a[1].overdue || b[1].open - a[1].open || a[0].localeCompare(b[0], "ar")
    );
    document.getElementById("dash-team").innerHTML = teamRows.length
      ? teamRows.map(([owner, row]) => `<tr>
          <td><span class="dash-person"><i aria-hidden="true">${ui.esc(Array.from(owner)[0] || "؟")}</i><b>${ui.esc(owner)}</b></span></td>
          <td><span class="dash-number">${ui.fmt(row.open)}</span></td>
          <td><span class="dash-number ${row.overdue ? "is-late" : "is-zero"}">${ui.fmt(row.overdue)}</span></td>
          <td><span class="dash-number ${row.done ? "is-done" : ""}">${ui.fmt(row.done)}</span></td>
          <td>${row.nextDate ? ui.formatDate(row.nextDate) : "—"}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" class="empty">لا توجد مهام مسجلة بعد.</td></tr>`;

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

    charts();

    const next = App.tasks.sorted(pending).slice(0, 5);
    document.getElementById("dash-tasks").innerHTML = next.length
      ? next.map((t) => App.tasks.itemHTML(t, { actions: false })).join("")
      : `<li class="empty">لا توجد مهام غير منجزة.</li>`;
  }

  /* ===== الرسوم البيانية (SVG بلا مكتبات) ===== */
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  /* أعمدة رأسية، مجمّعة أو مكدّسة. الترتيب من اليمين (الأقدم) إلى اليسار كقراءة العربية */
  function bars({ labels, series, stacked, height }) {
    const H = height || 190;
    const slot = Math.max(28, Math.min(64, 640 / Math.max(1, labels.length)));
    const W = Math.max(300, slot * labels.length + 40);
    const top = 16, bottom = 34, left = 30;
    const plotH = H - top - bottom;
    const totals = labels.map((_, i) => (stacked ? series.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(0, ...series.map((s) => s.values[i] || 0))));
    const max = Math.max(1, ...totals);
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const nice = Math.ceil(max / step) * step;
    const y = (v) => top + plotH - (v / nice) * plotH;
    let out = "";
    for (let g = 0; g <= 4; g++) {
      const v = (nice / 4) * g;
      out += `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${left - 4}" y="${y(v) + 4}" class="ch-axis" text-anchor="end">${ui.fmt(v)}</text>`;
    }
    labels.forEach((lab, i) => {
      const x0 = W - (i + 1) * slot; // اليمين أولاً
      const inner = slot * 0.72;
      const bx = x0 + (slot - inner) / 2;
      if (stacked) {
        let acc = 0;
        series.forEach((s) => {
          const v = s.values[i] || 0;
          if (!v) return;
          out += `<rect x="${bx}" y="${y(acc + v)}" width="${inner}" height="${y(acc) - y(acc + v)}" fill="${s.color}" rx="2"><title>${ui.esc(lab)} — ${ui.esc(s.name)}: ${ui.fmt(v)}</title></rect>`;
          acc += v;
        });
        if (acc) out += `<text x="${bx + inner / 2}" y="${y(acc) - 3}" class="ch-val" text-anchor="middle">${ui.fmt(acc)}</text>`;
      } else {
        const w = inner / series.length;
        series.forEach((s, k) => {
          const v = s.values[i] || 0;
          const x = bx + inner - (k + 1) * w; // السلسلة الأولى يميناً
          if (v) out += `<rect x="${x}" y="${y(v)}" width="${w - 1}" height="${y(0) - y(v)}" fill="${s.color}" rx="2"><title>${ui.esc(lab)} — ${ui.esc(s.name)}: ${ui.fmt(v)}</title></rect><text x="${x + w / 2}" y="${y(v) - 3}" class="ch-val" text-anchor="middle">${ui.fmt(v)}</text>`;
        });
      }
      out += `<text x="${x0 + slot / 2}" y="${H - bottom + 16}" class="ch-axis" text-anchor="middle">${ui.esc(lab)}</text>`;
    });
    const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${ui.esc(s.name)}</span>`).join("");
    return `<div class="ch-legend">${legend}</div><div class="ch-scroll"><svg viewBox="0 0 ${W} ${H}" class="ch-svg" style="min-width:${Math.min(W, 560)}px" role="img">${out}</svg></div>`;
  }

  function charts() {
    const el = document.getElementById("dash-charts");
    if (!el) return;
    const now = new Date();

    // ١. الوارد والصادر آخر 12 شهراً
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()].slice(0, 5) });
    }
    const reg = App.registry ? App.registry.live() : [];
    const count = (type) => months.map((m) => reg.filter((r) => r.type === type && String(r.date || "").startsWith(m.key)).length);
    const inC = count("in"), outC = count("out");
    const regHtml = reg.length ? bars({
      labels: months.map((m) => m.label),
      series: [{ name: "الوارد", color: "#1c3a66", values: inC }, { name: "الصادر", color: "#14a3a5", values: outC }],
    }) : `<p class="empty">لا توجد قيود بعد.</p>`;

    // ٢. الضيافة هذا الشهر
    let hosHtml = `<p class="empty">لا توجد بيانات.</p>`;
    let hosSum = "";
    if (App.hospitality && App.hospitality.monthTotals) {
      const days = App.hospitality.monthTotals(now.getFullYear(), now.getMonth());
      const tr = days.reduce((a, d) => a + d.trainees, 0);
      const st = days.reduce((a, d) => a + d.staff, 0);
      hosSum = `${ui.fmt(tr + st)} وجبة (${ui.fmt(tr)} متدربون · ${ui.fmt(st)} موظفون)`;
      if (tr + st) {
        hosHtml = bars({
          labels: days.map((d) => d.date.slice(0, 2)),
          series: [{ name: "المتدربون", color: "#2E75B6", values: days.map((d) => d.trainees) }, { name: "الموظفون", color: "#548235", values: days.map((d) => d.staff) }],
          stacked: true,
        });
      }
    }

    // ٣. المهام غير المنجزة حسب المسؤول
    const pending = (store.get().tasks || []).filter((t) => !t.done);
    const byOwner = new Map();
    pending.forEach((t) => {
      const k = t.owner || "بلا مسؤول";
      const e = byOwner.get(k) || { late: 0, open: 0 };
      if (ui.isOverdue(t)) e.late++; else e.open++;
      byOwner.set(k, e);
    });
    const owners = [...byOwner.entries()].sort((a, b) => (b[1].late + b[1].open) - (a[1].late + a[1].open)).slice(0, 8);
    const maxT = Math.max(1, ...owners.map(([, e]) => e.late + e.open));
    const taskHtml = owners.length ? `<div class="ch-legend"><span><i style="background:var(--danger)"></i>متأخرة</span><span><i style="background:#1c3a66"></i>في موعدها</span></div>
      <div class="hbars">${owners.map(([name, e]) => `<div class="hbar">
        <span class="hbar-name" title="${ui.esc(name)}">${ui.esc(name)}</span>
        <span class="hbar-track"><span class="late" style="width:${(e.late / maxT) * 100}%"></span><span class="open" style="width:${(e.open / maxT) * 100}%"></span></span>
        <span class="hbar-n">${ui.fmt(e.late + e.open)}${e.late ? ` <small>(${ui.fmt(e.late)} متأخرة)</small>` : ""}</span>
      </div>`).join("")}</div>` : `<p class="empty">لا توجد مهام غير منجزة.</p>`;

    el.innerHTML = `
      <div class="card ch-card ch-wide"><h3>الوارد والصادر — آخر 12 شهراً <small>${ui.fmt(inC.reduce((a, b) => a + b, 0))} وارد · ${ui.fmt(outC.reduce((a, b) => a + b, 0))} صادر</small></h3>${regHtml}</div>
      <div class="card ch-card"><h3>الضيافة — ${MONTHS[now.getMonth()]} <small>${hosSum}</small> <a href="#hospitality" class="ch-link">فتح الكشف</a></h3>${hosHtml}</div>
      <div class="card ch-card"><h3>المهام غير المنجزة حسب المسؤول <a href="#tasks" class="ch-link">فتح المهام</a></h3>${taskHtml}</div>`;
  }

  App.dashboard = { render };
})(window.App = window.App || {});
