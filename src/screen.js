/* شاشة إحصاءات نظام المركز (tamkeen.ksach.org)
   اللقطة يدفعها سكربت القراءة الذي يشغّله الموظف داخل النظام، وتُحفظ على خادم المركز،
   وهذه الصفحة تقرأها وتعرضها وتُحدّثها وحدها كل دقيقة. لا تتصل هذه الصفحة بنظام المركز
   ولا تعرف كلمة مروره؛ هي تقرأ الأرقام المجمّعة وحدها. */
(function (App) {
  const { ui, store } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const REFRESH = 60000;
  const ROTATE = 15000;           // تبديل اللوحات في وضع العرض
  const CACHE = "tamkeen-admin:ksach-stats";

  let snap = null;                // { data, at, by }
  let timer = null, rotateTimer = null, panel = 0, showing = false;

  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; };
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const sum = (list, key) => (list || []).reduce((a, r) => a + num(r[key]), 0);

  const cached = () => { try { return JSON.parse(localStorage.getItem(CACHE) || "null"); } catch (e) { return null; } };
  const cache = (v) => { try { localStorage.setItem(CACHE, JSON.stringify(v)); } catch (e) { /* تخزين ممتلئ */ } };

  /* ===== جلب اللقطة ===== */
  async function load(quiet) {
    if (!App.cloud || !App.cloud.ready()) { render(); return; }
    try {
      const r = await App.cloud.stats();
      if (r.stats && r.stats.data) {
        snap = r.stats;
        cache(snap);
      }
      render();
      if (!quiet) ui.toast(snap ? "حُدّثت الأرقام" : "لا توجد لقطة بعد");
    } catch (e) {
      if (!quiet) ui.toast(e.message);
    }
  }

  /* ===== لبنات العرض ===== */
  const kpi = (label, value, sub, tone) =>
    `<div class="sc-kpi ${tone || ""}"><div class="sc-kpi-v">${esc(value)}</div><div class="sc-kpi-l">${esc(label)}</div>${sub ? `<div class="sc-kpi-s">${esc(sub)}</div>` : ""}</div>`;

  /* شريط أفقي بنسبة: الأخضر جيد، والأحمر دون الحد */
  function bars(rows, opts) {
    const o = opts || {};
    const low = o.lowBelow == null ? -1 : o.lowBelow;
    if (!rows.length) return `<p class="conv-hint">لا توجد بيانات</p>`;
    const top = Math.max(1, ...rows.map((r) => r.value));
    return `<div class="sc-bars">` + rows.map((r) => {
      const w = Math.max(2, Math.round((r.value / top) * 100));
      const bad = o.isPercent && r.value < low;
      return `<div class="sc-bar-row" title="${esc(r.label)}">
        <span class="sc-bar-label">${esc(r.label)}</span>
        <span class="sc-bar-track"><span class="sc-bar-fill ${bad ? "low" : ""}" style="width:${w}%"></span></span>
        <span class="sc-bar-val">${esc(ui.fmt(r.value))}${o.isPercent ? "%" : ""}${r.note ? ` <small>${esc(r.note)}</small>` : ""}</span>
      </div>`;
    }).join("") + `</div>`;
  }

  const card = (title, body, wide) => `<section class="card sc-card ${wide ? "wide" : ""}"><h3>${esc(title)}</h3>${body}</section>`;

  /* ===== اللوحات الأربع ===== */
  function panelTracks(d) {
    const t = d.tracks || [];
    const seats = sum(t, "seats"), students = sum(t, "students"), apps = sum(t, "applications");
    const accepted = sum(t, "accepted"), waiting = sum(t, "waiting");
    return `<div class="sc-kpis">
        ${kpi("المقاعد", ui.fmt(seats))}
        ${kpi("الطلاب المسجّلون", ui.fmt(students))}
        ${kpi("إشغال المقاعد", pct(students, seats) + "%", `${ui.fmt(students)} من ${ui.fmt(seats)}`, pct(students, seats) < 70 ? "warn" : "good")}
        ${kpi("الطلبات", ui.fmt(apps))}
        ${kpi("مقبول", ui.fmt(accepted), apps ? pct(accepted, apps) + "% من الطلبات" : "")}
        ${kpi("قائمة الانتظار", ui.fmt(waiting))}
      </div>`
      + card("إشغال المقاعد لكل مسار", bars(t.map((r) => ({
          label: r.track || r.name || "—",
          value: r.fill != null ? num(r.fill) : pct(num(r.students), num(r.seats)),
          note: `${ui.fmt(num(r.students))}/${ui.fmt(num(r.seats))}`,
        })), { isPercent: true, lowBelow: 70 }), true)
      + card("الطلبات لكل مسار", bars(t.map((r) => ({ label: r.track || r.name || "—", value: num(r.applications) }))), true);
  }

  function panelAttendance(d) {
    const a = d.attendance || [];
    const g = d.groups || [];
    const totalRows = sum(a, "total");
    const present = sum(a, "present");
    const rate = pct(present, totalRows);
    const trainers = d.trainers || [];
    return `<div class="sc-kpis">
        ${kpi("معدل الحضور", rate + "%", `${ui.fmt(present)} من ${ui.fmt(totalRows)} سجلاً`, rate < 80 ? "warn" : "good")}
        ${kpi("المجموعات", ui.fmt(g.length || a.length))}
        ${kpi("الغياب", ui.fmt(sum(a, "absent")))}
        ${kpi("المدربون", ui.fmt(trainers.length))}
        ${kpi("الجلسات المكتملة", ui.fmt(sum(trainers, "done")), `من ${ui.fmt(sum(trainers, "sessions"))}`)}
        ${kpi("الساعات", ui.fmt(sum(trainers, "hours")))}
      </div>`
      + card("معدل الحضور لكل مجموعة", bars(a.map((r) => ({
          label: r.group || "—",
          value: r.rate != null ? num(r.rate) : pct(num(r.present), num(r.total)),
          note: r.track ? String(r.track).slice(0, 22) : "",
        })), { isPercent: true, lowBelow: 80 }), true)
      + card("عبء المدربين (جلسات)", bars(trainers.map((r) => ({ label: r.name || "—", value: num(r.sessions), note: `${ui.fmt(num(r.hours))} ساعة` }))), true);
  }

  function panelGrades(d) {
    const gr = d.grades || {};
    const rows = gr.tracks || [];
    const passed = num(gr.passed), failed = num(gr.failed);
    return `<div class="sc-kpis">
        ${kpi("متوسط الدرجات", gr.average != null ? ui.fmt(Math.round(num(gr.average))) : "—")}
        ${kpi("ناجح", ui.fmt(passed), passed + failed ? pct(passed, passed + failed) + "%" : "", "good")}
        ${kpi("راسب", ui.fmt(failed), "", failed ? "warn" : "")}
        ${kpi("درجات معتمدة", ui.fmt(num(gr.approved)))}
        ${kpi("بانتظار الاعتماد", ui.fmt(num(gr.pending)), "", num(gr.pending) ? "warn" : "")}
        ${kpi("بانتظار التصحيح", ui.fmt(num(gr.awaitingGrading)))}
      </div>`
      + card("متوسط الدرجات لكل مسار", bars(rows.map((r) => ({ label: r.track || "—", value: Math.round(num(r.average)), note: `${ui.fmt(num(r.count))} طالباً` })), { isPercent: false }), true);
  }

  function panelPeople(d) {
    const p = d.demographics || [];
    const males = sum(p, "male"), females = sum(p, "female");
    const disabled = sum(p, "disabled"), healthy = sum(p, "healthy");
    const single = sum(p, "single"), married = sum(p, "married");
    const total = males + females || sum(p, "count");
    const share = (v) => `${ui.fmt(v)} · ${pct(v, total)}%`;
    return `<div class="sc-kpis">
        ${kpi("إجمالي المتدربين", ui.fmt(total))}
        ${kpi("ذكور", share(males))}
        ${kpi("إناث", share(females))}
        ${kpi("ذوو إعاقة", share(disabled), "", disabled ? "good" : "")}
        ${kpi("أعزب", share(single))}
        ${kpi("متزوج", share(married))}
      </div>`
      + card("المتدربون لكل مسار", bars(p.map((r) => ({ label: r.track || "—", value: num(r.count) || num(r.male) + num(r.female) }))), true)
      + card("ذوو الإعاقة لكل مسار", bars(p.map((r) => ({ label: r.track || "—", value: num(r.disabled), note: `من ${ui.fmt(num(r.count) || num(r.healthy) + num(r.disabled))}` }))), true);
  }

  const PANELS = [
    { name: "الطلبات والسعة", build: panelTracks },
    { name: "الحضور والمجموعات", build: panelAttendance },
    { name: "الدرجات والنتائج", build: panelGrades },
    { name: "خصائص المتدربين", build: panelPeople },
  ];

  /* ===== الرسم ===== */
  function render() {
    const box = $("sc-body");
    if (!box) return;
    if (!snap) snap = cached();
    const info = $("sc-updated");
    if (info) {
      info.textContent = snap
        ? `آخر تحديث: ${new Date(snap.at).toLocaleString("ar-EG")}${snap.by ? ` · ${snap.by}` : ""}`
        : "لم تصل لقطة بعد";
      info.className = "conv-hint" + (snap && Date.now() - new Date(snap.at).getTime() > 6 * 3600000 ? " sc-stale" : "");
    }
    $("sc-tabs").innerHTML = PANELS.map((p, i) => `<button type="button" data-panel="${i}" class="${i === panel ? "active" : ""}">${esc(p.name)}</button>`).join("");
    if (!snap || !snap.data) {
      box.innerHTML = `<section class="card sc-empty">
        <h3>لا توجد أرقام بعد</h3>
        <p>هذه الشاشة تعرض أرقام نظام المركز (tamkeen.ksach.org). تصل الأرقام إليها من سكربت القراءة الذي تشغّله داخل النظام،
           فيدفع لقطة مجمّعة كل فترة وتظهر هنا عند كل مستخدم.</p>
        <p class="conv-hint">افتح «طريقة التشغيل» من الأعلى لتعرف الخطوات.</p>
      </section>`;
      return;
    }
    box.innerHTML = PANELS[panel].build(snap.data || {});
  }

  /* ===== وضع العرض: ملء الشاشة وتبديل اللوحات ===== */
  function rotate(on) {
    clearInterval(rotateTimer);
    rotateTimer = null;
    if (!on) return;
    rotateTimer = setInterval(() => {
      panel = (panel + 1) % PANELS.length;
      render();
    }, ROTATE);
  }

  async function fullscreen() {
    const el = $("view-screen");
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        el.classList.add("sc-show");
        rotate(true);
      } else {
        await document.exitFullscreen();
      }
    } catch (e) { ui.toast("المتصفح لم يسمح بملء الشاشة"); }
  }

  document.addEventListener("fullscreenchange", () => {
    const el = $("view-screen");
    if (!el) return;
    if (!document.fullscreenElement) { el.classList.remove("sc-show"); rotate(false); }
  });

  /* ===== رمز الشاشة: يُنسخ للمدير بلا أن يظهر على الشاشة ===== */
  async function copyKey() {
    if (!App.profile.isAdmin()) { ui.toast("رمز الشاشة للمدير وحده"); return; }
    try {
      const r = await App.cloud.statsKey();
      await navigator.clipboard.writeText(r.key);
      ui.toast("نُسخ رمز الشاشة — الصقه في سكربت القراءة");
    } catch (e) {
      ui.toast(e.message || "تعذّر نسخ الرمز");
    }
  }

  function howTo() {
    const w = window.open("", "_blank", "noopener,width=820,height=720");
    if (!w) { ui.toast("اسمح بالنوافذ المنبثقة"); return; }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تشغيل شاشة إحصاءات المركز</title>
      <style>body{font-family:Tahoma,Arial;margin:26px;line-height:1.9;background:#f4f6fa;color:#1b2433}
      h1{font-size:17pt;background:#0b1f3a;color:#fff;padding:10px;border-radius:8px}
      li{margin:8px 0}code{background:#e7ecf3;padding:2px 6px;border-radius:4px}</style></head><body>
      <h1>كيف تعمل شاشة إحصاءات المركز؟</h1>
      <ol>
        <li>المدير يضغط <b>«نسخ رمز الشاشة»</b> في أعلى الصفحة (الرمز يُنسخ ولا يظهر).</li>
        <li>افتح ملف السكربت <code>إحصاءات-الشاشة.js</code> والصق الرمز في السطر الأول منه.</li>
        <li>افتح نظام المركز <code>tamkeen.ksach.org/admin</code> وأنت مسجّل دخولك، ثم <code>F12</code> ← <b>Console</b>، والصق السكربت واضغط Enter.</li>
        <li>يقرأ السكربت صفحات التقارير (قراءة فقط)، ويرسل لقطة أرقام مجمّعة إلى خادم تمكين، ثم يعيدها كل ١٥ دقيقة ما دام التبويب مفتوحاً.</li>
        <li>هذه الصفحة تُحدّث نفسها كل دقيقة عند كل مستخدم. زر <b>«ملء الشاشة»</b> يعرضها على شاشة القاعة ويبدّل اللوحات تلقائياً.</li>
      </ol>
      <p><b>ما لا يحدث:</b> لا تُرسل أسماء ولا أرقام هويات — أرقام مجمّعة فقط. ولا يعرف موقع تمكين كلمة مرور نظام المركز،
      ولا يفتح السكربت أي رابط تعديل أو حذف.</p>
      </body></html>`);
    w.document.close();
  }

  /* ===== التشغيل ===== */
  function show() {
    showing = true;
    snap = snap || cached();
    render();
    load(true);
    clearInterval(timer);
    timer = setInterval(() => { if (showing) load(true); }, REFRESH);
  }

  function hide() {
    showing = false;
    clearInterval(timer);
    rotate(false);
  }

  function init() {
    $("sc-refresh").addEventListener("click", () => load(false));
    $("sc-full").addEventListener("click", fullscreen);
    $("sc-key").addEventListener("click", copyKey);
    $("sc-how").addEventListener("click", howTo);
    $("sc-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-panel]");
      if (!b) return;
      panel = Number(b.dataset.panel);
      render();
    });
    App.nav && App.nav.onView && App.nav.onView("screen", show, hide);
  }

  App.screen = { init, render, show, hide, load };
})(window.App = window.App || {});
