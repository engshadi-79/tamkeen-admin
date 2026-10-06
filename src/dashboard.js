/* اللوحة الرئيسية */
(function (App) {
  const { store, ui } = App;
  const ATTENDANCE_THRESHOLD = 80;

  /* بطاقات الأرقام ببنية القالب: أيقونة، ثم عنوان وقيمة وفرق، ثم أعمدة صغيرة.
     الأعمدة ليست زينة: كل عمود مسارٌ وارتفاعه قيمته في هذا المؤشر. */
  const SVG = {
    people: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    pledge: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
    form: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
  };
  const icon = (tone, path) => `<div class="stat-icon ${tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${path}</svg></div>`;

  /* شريط صغير لكل مسار، ارتفاعه نسبته إلى أكبر قيمة، مع عنوانه عند التحويم */
  function spark(values, labels, tone) {
    const nums = values.map((v) => Number(v) || 0);
    const max = Math.max(...nums, 1);
    return `<div class="stat-spark">${nums.slice(-12).map((v, i) => {
      const h = Math.max(8, Math.round((v / max) * 100));
      const title = labels && labels[i] ? `${labels[i]}: ${ui.fmt(v)}` : ui.fmt(v);
      return `<div class="bar" style="height:${h}%${tone ? `;background:var(--${tone})` : ""}" title="${ui.esc(title)}"></div>`;
    }).join("")}</div>`;
  }

  const statCard = (tone, path, label, value, badge, sub, bars) => `<div class="card">
      <div class="stat">
        ${icon(tone, path)}
        <div class="stat-content">
          <div class="stat-label">${ui.esc(label)}</div>
          <div class="stat-value-row"><span class="stat-value">${value}</span>${badge || ""}</div>
          <div class="stat-subtext">${sub}</div>
        </div>
        ${bars || ""}
      </div>
    </div>`;

  /* ===== حال المركز من لقطة نظام المركز =====
     الأرقام التي يعيش عليها المركز (طلاب وحضور وتعهدات واستبيانات ودرجات) تصل مع اللقطة
     نفسها التي تغذّي الشاشة ومنشئ التقارير، فتُقرأ هنا بلا طلب جديد. */
  const snapshot = () => (App.screen && App.screen.snapshot ? App.screen.snapshot() : null);
  const centreRows = () => { const s = snapshot(); return (s && s.data && s.data.students) || []; };
  const numOf = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
  const mean = (list) => { const n = list.filter((v) => v != null); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
  const isNo = (v) => String(v || "").trim() === "لا";
  // «غير معتمد» تحتوي كلمة «معتمد»، فالاحتواء وحده يعدّها معتمدة: نشترط أن تبدأ بها
  const notApproved = (r) => String(r.total || "").trim() !== "" && !/^معتمد/.test(String(r.approval || "").trim());

  /* لقطة قديمة تُقرأ كأنها اليوم: نقول عمرها، ونحذّر بعد يوم كامل */
  function snapAge() {
    const s = snapshot();
    const at = s && s.at ? new Date(s.at).getTime() : 0;
    if (!at) return "";
    const hours = (Date.now() - at) / 3600000;
    const text = hours < 1 ? "قبل أقل من ساعة"
      : hours < 24 ? `قبل ${ui.fmt(Math.round(hours))} ساعة`
      : `قبل ${ui.fmt(Math.round(hours / 24))} يوم`;
    const stale = hours >= 24;
    return `<span class="dash-snap-age ${stale ? "stale" : ""}" title="وقت آخر قراءة من نظام المركز">${stale ? "⚠ " : ""}آخر قراءة ${text}</span>`;
  }

  function centreStats() {
    const rows = centreRows();
    if (!rows.length) return null;
    return {
      students: rows.length,
      attendance: mean(rows.map((r) => numOf(r.attendance))),
      noPledge: rows.filter((r) => isNo(r.pledged)).length,
      noSurvey: rows.filter((r) => String(r.missingSurveys || "").trim()).length,
      unapproved: rows.filter(notApproved).length,
      phases: [...new Set(rows.map((r) => String(r.course || "").trim()).filter(Boolean))],
    };
  }

  /* صف لكل مسار: طلابه ونِسبه. النسبة تُعرض رقماً وشريطاً معاً، فلا يُفهم اللون وحده. */
  function centreByTrack() {
    const rows = centreRows();
    const map = new Map();
    rows.forEach((r) => {
      const k = String(r.track || "").trim() || "— بلا مسار —";
      const g = map.get(k) || { track: k, n: 0, att: [], pledged: 0, survey: 0 };
      g.n++;
      const a = numOf(r.attendance);
      if (a != null) g.att.push(a);
      if (!isNo(r.pledged) && String(r.pledged || "").trim()) g.pledged++;
      if (!String(r.missingSurveys || "").trim()) g.survey++;
      map.set(k, g);
    });
    return [...map.values()].map((g) => ({
      track: g.track, n: g.n,
      attendance: mean(g.att),
      pledgePct: g.n ? (g.pledged / g.n) * 100 : null,
      surveyPct: g.n ? (g.survey / g.n) * 100 : null,
    })).sort((a, b) => b.n - a.n);
  }

  /* الحضور دون الحد خطر أحمر، والتعهد والاستبيان تقصير يُنبَّه عليه بالكهرماني لا بالأحمر */
  const meter = (v, warn, tone) => v == null ? "—"
    : `<span class="dash-meter"><i style="width:${Math.max(0, Math.min(100, v))}%${v < warn ? `;background:${tone || "#c0392b"}` : ""}"></i></span><b>${ui.fmt(v, 0)}%</b>`;

  function centreCards(pending, overdue) {
    const box = document.getElementById("dash-centre");
    if (!box) return;
    const c = centreStats();
    if (!c) {
      box.innerHTML = `<section class="card dash-centre-empty"><h3>حال المركز</h3>
        <p class="conv-hint">أرقام المركز (الطلاب والحضور والتعهدات والاستبيانات) تصل مع لقطة نظام المركز.
        افتح «شاشة إحصاءات المركز» وشغّل القراءة، فتظهر هنا تلقائياً.</p>
        <div class="btn-row"><a class="btn secondary" href="#screen">فتح شاشة الإحصاءات</a></div></section>`;
      return;
    }
    const tracks = centreByTrack();
    const need = actionItems(c, tracks, overdue);
    box.innerHTML = `
      <section class="card dash-centre-card">
        <div class="dash-section-head">
          <div><span class="dash-section-kicker">من نظام المركز</span><h3>المسارات</h3>
            <p>${ui.fmt(c.students)} طالباً في ${ui.fmt(c.phases.length)} مراحل</p></div>
          <span class="dash-head-side">${snapAge()}<a class="dash-text-link" href="#screen">الشاشة <span aria-hidden="true">←</span></a></span>
        </div>
        <div class="table-wrap dash-table-wrap">
          <table class="dash-table dash-centre-table">
            <thead><tr><th>المسار</th><th>الطلاب</th><th>الحضور</th><th>وقّعوا التعهد</th><th>عبّأوا الاستبيان</th></tr></thead>
            <tbody>${tracks.map((t) => `<tr>
              <td>${ui.esc(t.track)}</td>
              <td>${ui.fmt(t.n)}</td>
              <td>${meter(t.attendance, ATTENDANCE_THRESHOLD)}</td>
              <td>${meter(t.pledgePct, 90, "#b7791f")}</td>
              <td>${meter(t.surveyPct, 90, "#b7791f")}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
      <section class="card dash-need-card">
        <div class="dash-section-head"><div><span class="dash-section-kicker">الأولويات</span><h3>يحتاج إجراءً</h3></div>
          <span class="dash-alert-count">${ui.fmt(need.length)}</span></div>
        <ul class="dash-need">${need.length ? need.map((x) => `<li class="${x.tone}">
            <span class="dash-need-n">${ui.fmt(x.n)}</span>
            <span class="dash-need-t">${x.text}</span>
            ${x.href ? `<a href="${x.href}">${x.action}</a>` : ""}</li>`).join("")
          : `<li class="ok"><span class="dash-need-t">لا شيء متأخر — كل المؤشرات ضمن الحد.</span></li>`}</ul>
      </section>`;
  }

  /* قائمة واحدة مرتّبة بالأهم بدل ثلاث لوحات متفرّقة */
  function actionItems(c, tracks, overdue) {
    const out = [];
    if (c.noPledge) out.push({ n: c.noPledge, tone: "danger", text: "طالباً لم يوقّعوا التعهد", href: "#reports", action: "التقارير" });
    if (c.noSurvey) out.push({ n: c.noSurvey, tone: "warn", text: "طالباً لم يعبّئوا استبياناً", href: "#reports", action: "التقارير" });
    if (c.unapproved) out.push({ n: c.unapproved, tone: "warn", text: "درجة غير معتمدة", href: "#screen", action: "الشاشة" });
    const low = tracks.filter((t) => t.attendance != null && t.attendance < ATTENDANCE_THRESHOLD);
    if (low.length) out.push({ n: low.length, tone: "danger", text: `مساراً حضورها دون ${ATTENDANCE_THRESHOLD}% (${ui.esc(low.map((t) => t.track).slice(0, 2).join("، "))}${low.length > 2 ? "…" : ""})`, href: "#screen", action: "الشاشة" });
    if (overdue.length) out.push({ n: overdue.length, tone: "danger", text: "مهمة متأخرة عن موعدها", href: "#tasks", action: "المهام" });
    const late = (App.registry ? App.registry.followUps() : []).filter((x) => x.days < 0).length;
    if (late) out.push({ n: late, tone: "warn", text: "وارداً تجاوز موعد معالجته", href: "#registry", action: "السجل" });
    // الجرد: الأصناف التي بلغت حدّها الأدنى والأجهزة المعطلة أو المفقودة
    const inv = App.inventory ? App.inventory.alerts() : { low: [], bad: [] };
    if (inv.low.length) out.push({ n: inv.low.length, tone: "warn", text: `صنفاً بلغ حدّه الأدنى في الجرد (${ui.esc(inv.low.map((x) => x.name).slice(0, 2).join("، "))}${inv.low.length > 2 ? "…" : ""})`, href: "#inventory", action: "الجرد" });
    if (inv.bad.length) out.push({ n: inv.bad.length, tone: "danger", text: "جهازاً معطلاً أو مفقوداً في المسارات", href: "#inventory", action: "الجرد" });
    return out.sort((a, b) => (a.tone === b.tone ? b.n - a.n : a.tone === "danger" ? -1 : 1));
  }

  function statCards(trackList, s, pending, overdue) {
    const names = trackList.map((t) => t.name);
    const c = centreStats();
    const pct = (v) => v == null ? "—" : `${ui.fmt(v, 1)}%`;
    const cards = [];

    if (c) {
      // أرقام المركز الحيّة أولاً: هي ما يسأل عنه الناس
      const byPhase = {};
      centreRows().forEach((r) => { const k = String(r.course || "").trim() || "—"; byPhase[k] = (byPhase[k] || 0) + 1; });
      cards.push(statCard("teal", SVG.people, "طلاب المركز", ui.fmt(c.students), "",
        `في ${ui.fmt(c.phases.length)} مراحل`, spark(Object.values(byPhase), Object.keys(byPhase))));
      cards.push(statCard(c.attendance != null && c.attendance >= ATTENDANCE_THRESHOLD ? "green" : "yellow", SVG.check,
        "حضور المجموعات", pct(c.attendance),
        c.attendance == null ? "" : `<span class="stat-change ${c.attendance >= ATTENDANCE_THRESHOLD ? "up" : "down"}">المستهدف ${ATTENDANCE_THRESHOLD}%</span>`,
        "متوسط مجموعات الطلاب", ""));
      cards.push(statCard(c.noPledge ? "red" : "green", SVG.pledge, "بلا تعهد موقَّع", ui.fmt(c.noPledge), "",
        c.students ? `${ui.fmt((c.noPledge / c.students) * 100, 0)}% من الطلاب` : "", ""));
      cards.push(statCard(c.noSurvey ? "yellow" : "green", SVG.form, "استبيان ناقص", ui.fmt(c.noSurvey), "",
        c.students ? `${ui.fmt((c.noSurvey / c.students) * 100, 0)}% من الطلاب` : "", ""));
    } else {
      cards.push(statCard("teal", SVG.people, "المستفيدون", ui.fmt(s.beneficiaries), "",
        `موزعون على ${ui.fmt(trackList.length)} مسارات`, spark(trackList.map((t) => t.beneficiaries), names)));
      cards.push(statCard("blue", SVG.clock, "إنجاز الساعات", pct(s.completionPct), "",
        `من ${store.TOTAL_HOURS} ساعة لكل مسار`, spark(trackList.map((t) => App.tracks.hoursPct(t)), names)));
      cards.push(statCard(Number(s.attendancePct) >= ATTENDANCE_THRESHOLD ? "green" : "yellow", SVG.check,
        "متوسط الحضور", pct(s.attendancePct), "", `المستهدف ${ATTENDANCE_THRESHOLD}%`,
        spark(trackList.map((t) => t.attendancePct), names)));
      cards.push(statCard("blue", SVG.clock, "المسارات", ui.fmt(trackList.length), "", "في صفحة متابعة المسارات", ""));
    }

    // ثم ما يخصّ عمل المكتب
    cards.push(statCard(overdue.length ? "red" : "purple", SVG.tasks, "مهام مفتوحة", ui.fmt(pending.length),
      overdue.length ? `<span class="stat-change down">${ui.fmt(overdue.length)} متأخرة</span>` : "",
      overdue.length ? "تحتاج متابعة اليوم" : "لا توجد مهام متأخرة", ""));
    const follow = App.registry ? App.registry.followUps() : [];
    const late = follow.filter((x) => x.days < 0).length;
    cards.push(statCard(late ? "red" : "blue", SVG.mail, "وارد يحتاج معالجة", ui.fmt(follow.length),
      late ? `<span class="stat-change down">${ui.fmt(late)} متأخر</span>` : "",
      follow.length ? "مستحق خلال ٣ أيام أو متأخر" : "لا يوجد وارد مستحق", ""));

    return cards.join("");
  }


  /* ===== لوحة على هيئة «منجز»: بطل + بلاطات + توزيع + منحنى + قوائم =====
     الأشكال مقتبسة من نظام منجز، والألوان تبقى على هوية تمكين الخمسة. */
  const DAY = 86400000;
  const dayISO = (d) => new Date(d).toISOString().slice(0, 10);

  /* قيود الوارد والصادر في آخر n يوماً، يوماً بيوم */
  function registryTrend(days) {
    const recs = store.get().registry || [];
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const iso = dayISO(Date.now() - i * DAY);
      out.push({ iso, n: recs.filter((r) => String(r.date || "").slice(0, 10) === iso).length });
    }
    return out;
  }
  const countBetween = (fromIso, toIso) =>
    (store.get().registry || []).filter((r) => {
      const d = String(r.date || "").slice(0, 10);
      return d && d >= fromIso && d <= toIso;
    }).length;

  const pctDelta = (now, before) => (before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 100));
  const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

  function heroCard() {
    const today = dayISO(Date.now());
    const weekAgo = dayISO(Date.now() - 6 * DAY);
    const prevFrom = dayISO(Date.now() - 13 * DAY);
    const prevTo = dayISO(Date.now() - 7 * DAY);
    const week = countBetween(weekAgo, today);
    const prev = countBetween(prevFrom, prevTo);
    const d = pctDelta(week, prev);
    const { tasks } = store.get();
    const done = tasks.filter((t) => t.done).length;
    const open = tasks.length - done;
    return `<section class="mj-hero">
        <h2>نشاط هذا الأسبوع</h2>
        <div class="mj-hero-n">${ui.fmt(week)} معاملة</div>
        <div class="mj-hero-delta">${d >= 0 ? "▲" : "▼"} ${ui.fmt(Math.abs(d))}٪ مقارنة بالأسبوع الماضي</div>
        <div class="mj-hero-split">
          <div><span>المهام المنجزة</span><b>${ui.fmt(done)} منجزة</b></div>
          <div><span>المهام المفتوحة</span><b>${ui.fmt(open)} قيد التنفيذ</b></div>
        </div>
        <a class="mj-hero-cta" href="#report">عرض التقرير الدوري</a>
      </section>`;
  }

  const kpiTile = (tone, title, value, progress, foot) => `<section class="mj-kpi mj-${tone}">
      <h3>${title}</h3>
      <div class="mj-kpi-n">${value}</div>
      <div class="mj-kpi-bar"><i style="width:${clampPct(progress)}%"></i></div>
      <div class="mj-kpi-foot">${foot}</div>
    </section>`;

  function kpiTiles() {
    const c = centreStats();
    const { tasks } = store.get();
    const done = tasks.filter((t) => t.done).length;
    const taskPct = tasks.length ? (done / tasks.length) * 100 : 0;
    if (!c) {
      const trackList = App.tracks.ordered();
      const sum = App.tracks.summary(trackList);
      return [
        kpiTile("gold", "المستفيدون", ui.fmt(sum.beneficiaries), 100, `موزعون على ${ui.fmt(trackList.length)} مسارات`),
        kpiTile("green", "نسبة الحضور", `${ui.fmt(sum.attendancePct)}٪`, sum.attendancePct, `المعيار ${ATTENDANCE_THRESHOLD}٪`),
        kpiTile("amber", "إنجاز الساعات", `${ui.fmt(sum.completionPct)}٪`, sum.completionPct, `من ${store.TOTAL_HOURS} ساعة لكل مسار`),
        kpiTile("info", "المهام المنجزة", ui.fmt(done), taskPct, `من ${ui.fmt(tasks.length)} مهمة`),
      ].join("");
    }
    const pledged = c.students - c.noPledge;
    const surveyed = c.students - c.noSurvey;
    return [
      kpiTile("gold", "طلاب المركز", ui.fmt(c.students), 100, `في ${ui.fmt(c.phases.length)} مراحل`),
      kpiTile("green", "الحضور التراكمي", c.attendance == null ? "—" : `${ui.fmt(c.attendance, 1)}٪`, c.attendance || 0, `المعيار ${ATTENDANCE_THRESHOLD}٪`),
      kpiTile("amber", "التعهدات الموقّعة", ui.fmt(pledged), c.students ? (pledged / c.students) * 100 : 0, `المتبقي ${ui.fmt(c.noPledge)} طالباً`),
      kpiTile("info", "الاستبيانات المكتملة", ui.fmt(surveyed), c.students ? (surveyed / c.students) * 100 : 0, `الناقص ${ui.fmt(c.noSurvey)} استبياناً`),
    ].join("");
  }

  /* شريط مقسوم بنسب المسارات مع مفتاح ألوان، كلوحة التوزيع في منجز */
  function distributionPanel() {
    const rows = centreByTrack().slice(0, 6);
    const total = rows.reduce((a, r) => a + r.n, 0);
    const body = !total
      ? `<p class="mj-empty">لا توجد بيانات كافية بعد</p>`
      : `<div class="mj-seg">${rows.map((r, i) => `<i class="mj-c${i % 5}" style="width:${(r.n / total) * 100}%" title="${ui.esc(r.track)}"></i>`).join("")}</div>
         <div class="mj-legend">${rows.map((r, i) => `<div>
             <span><i class="mj-c${i % 5}"></i>${ui.esc(r.track)}</span>
             <b>${ui.fmt((r.n / total) * 100, 0)}٪</b>
           </div>`).join("")}</div>`;
    return `<section class="card mj-panel">
        <div class="mj-panel-head"><h4>توزيع الطلاب</h4><small>حسب المسار التدريبي</small></div>
        ${body}
      </section>`;
  }

  /* منحنى آخر سبعة أيام: خط ومساحة ونقطة على آخر يوم */
  function trendPanel() {
    const data = registryTrend(7);
    const max = Math.max(...data.map((d) => d.n), 1);
    const W = 320, H = 130, step = W / Math.max(data.length - 1, 1);
    const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(H - (d.n / max) * (H - 20) - 10).toFixed(1)}`);
    const last = pts[pts.length - 1].split(",");
    return `<section class="card mj-panel">
        <div class="mj-panel-head"><h4>حركة المراسلات</h4><small>القيود المسجّلة آخر ٧ أيام</small></div>
        <svg class="mj-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="منحنى القيود آخر سبعة أيام">
          <polyline points="${pts.join(" ")} ${W},${H} 0,${H}" fill="var(--gold)" opacity=".14" stroke="none"></polyline>
          <polyline points="${pts.join(" ")}" fill="none" stroke="var(--gold-bright)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
          <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="var(--gold-bright)"></circle>
        </svg>
        <div class="mj-trend-foot"><span>${ui.formatDate(data[0].iso)}</span><span>${ui.formatDate(data[data.length - 1].iso)}</span></div>
      </section>`;
  }

  const miniPanel = (title, caption, href, rows, empty) => `<section class="card mj-panel">
      <div class="mj-panel-head">
        <div><h4>${title}</h4><small>${caption}</small></div>
        <a class="mj-all" href="${href}">عرض الكل</a>
      </div>
      ${rows.length ? `<div class="mj-rows">${rows.map((r) => `<div><span>${r.label}</span><b>${r.value}</b></div>`).join("")}</div>`
        : `<p class="mj-empty">${empty}</p>`}
    </section>`;

  function miniPanels() {
    const byTrack = centreByTrack();
    const top = byTrack.filter((t) => t.attendance != null).sort((a, b) => b.attendance - a.attendance).slice(0, 5)
      .map((t) => ({ label: ui.esc(t.track), value: `${ui.fmt(t.attendance, 0)}٪` }));

    const recs = (store.get().registry || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 5)
      .map((r) => ({ label: ui.esc(r.subject || r.party || r.number || "قيد"), value: ui.formatDate(String(r.date || "").slice(0, 10)) }));

    const inv = App.inventory ? App.inventory.alerts() : { low: [], bad: [] };
    const low = inv.low.slice(0, 5).map((it) => ({ label: `${ui.esc(it.name)} <small>${ui.esc(it.track)}</small>`, value: `${ui.fmt(it.qty)} / ${ui.fmt(it.min)}` }));

    return [
      miniPanel("أعلى المسارات حضوراً", "ترتيب تنازلي بنسبة الحضور", "#screen", top, "لا توجد لقطة من نظام المركز بعد"),
      miniPanel("آخر المعاملات", "أحدث قيود الوارد والصادر", "#registry", recs, "لا قيود مسجّلة بعد"),
      miniPanel("أصناف تحتاج توريداً", "بلغت حدّها الأدنى في الجرد", "#inventory", low, "لا صنف تحت الحدّ"),
    ].join("");
  }

  function munjaz() {
    const box = document.getElementById("dash-munjaz");
    if (!box) return;
    box.innerHTML = `
      <div class="mj-top">${heroCard()}${kpiTiles()}</div>
      <div class="mj-mid">${distributionPanel()}${trendPanel()}</div>
      <div class="mj-mini">${miniPanels()}</div>`;
  }

  function render() {
    const { tasks } = store.get();
    const trackList = App.tracks.ordered();
    const s = App.tracks.summary(trackList);
    const pending = tasks.filter((t) => !t.done);
    const overdue = pending.filter(ui.isOverdue);
    const dateEl = document.getElementById("dash-date");
    if (dateEl) dateEl.textContent = new Intl.DateTimeFormat("ar-PS", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());

    munjaz();
    document.getElementById("stats").innerHTML = statCards(trackList, s, pending, overdue);
    centreCards(pending, overdue);

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
