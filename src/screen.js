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

  /* ===== الفلاتر: تسري على كل اللوحات ===== */
  const FILTER_KEY = "tamkeen-admin:screen-filters";
  const FIELDS = ["course", "group", "track", "trainer"];
  let filters = { track: "", course: "", group: "", trainer: "", q: "" };
  try { filters = Object.assign(filters, JSON.parse(localStorage.getItem(FILTER_KEY) || "{}")); } catch (e) { /* تخزين غير متاح */ }
  const saveFilters = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch (e) { /* تخزين ممتلئ */ } };

  /* أسماء المسارات تختلف قليلاً بين الجداول («الخياطة» و«الخياطة والتفصيل»)، فالمطابقة بالاحتواء */
  const norm = (v) => String(v == null ? "" : v).replace(/[\u064B-\u0652]/g, "").replace(/[إأآا]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
  function like(value, wanted) {
    if (!wanted) return true;
    const a = norm(value), b = norm(wanted);
    if (!a) return false;
    return a.includes(b) || b.includes(a);
  }
  /* البحث الحر: يطابق أي خانة نصية في الصف */
  const hits = (row) => {
    if (!filters.q) return true;
    const text = norm(Object.values(row || {}).filter((v) => typeof v === "string").join(" "));
    return text.includes(norm(filters.q));
  };
  /* مسارات المرحلة المختارة: جداول النظام لا تذكر المرحلة في كل صف،
     فنستنتجها من الصفوف التي تحملها (المجموعات والحضور والدرجات والمتابعات). */
  let scope = [];
  function tracksOfPhase(d) {
    if (!filters.course) return [];
    const src = [(d.groups || []), (d.attendance || []), ((d.grades || {}).tracks || []),
      ((d.followUps || {}).pledges || []), ((d.followUps || {}).surveys || [])].flat();
    const out = new Set();
    src.forEach((r) => { if (r && r.course && like(r.course, filters.course) && r.track) out.add(String(r.track)); });
    return [...out];
  }

  /* صف يمر إن طابق كل فلتر يعنيه؛ والصف الذي لا يحمل المرحلة يُقاس بمسارات المرحلة */
  function keep(row) {
    if (!hits(row)) return false;
    if (!FIELDS.every((f) => !filters[f] || row[f] === undefined || like(row[f], filters[f]))) return false;
    if (filters.course && row.course === undefined && row.track && scope.length) {
      return scope.some((t) => like(row.track, t));
    }
    return true;
  }
  const rows = (list) => (list || []).filter(keep);
  const anyFilter = () => !!(filters.q || FIELDS.some((f) => filters[f]));

  /* قيم القوائم المنسدلة: كل قائمة تعرض ما يتوافق مع بقية الفلاتر المختارة،
     فاختيار المرحلة يُبقي مجموعاتها وحدها، واختيار المسار يُبقي مدرّبيه. */
  function choices(d) {
    const out = { track: new Set(), course: new Set(), group: new Set(), trainer: new Set() };
    // صف يمر بكل الفلاتر عدا الحقل الذي نبني قائمته؛ ومسارات المرحلة تُحترم هنا أيضاً
    const fits = (row, skip) => {
      if (!hits(row)) return false;
      if (!FIELDS.every((f) => f === skip || !filters[f] || row[f] === undefined || like(row[f], filters[f]))) return false;
      if (skip !== "course" && filters.course && row.course === undefined && row.track && scope.length) {
        return scope.some((t) => like(row.track, t));
      }
      return true;
    };
    const feed = (list) => (list || []).forEach((r) => FIELDS.forEach((f) => { if (r[f] && fits(r, f)) out[f].add(String(r[f])); }));
    feed(d.tracks); feed(d.attendance); feed(d.groups); feed(d.demographics); feed((d.grades || {}).tracks);
    feed((d.followUps || {}).pledges); feed((d.followUps || {}).surveys);
    // المدرب يُستمد من المجموعات الباقية، فقائمة المدربين تتبع المرحلة والمسار
    const kept = new Set((d.groups || []).filter((g) => fits(g, "trainer")).map((g) => norm(g.trainer)).filter(Boolean));
    (d.trainers || []).forEach((t) => { if (t.name && (!kept.size || kept.has(norm(t.name)))) out.trainer.add(t.name); });
    // ما اخترته يبقى ظاهراً في قائمته حتى لو ضيّقته فلاتر أخرى
    FIELDS.forEach((f) => { if (filters[f]) out[f].add(filters[f]); });
    const sort = (set) => [...set].sort((a, b) => a.localeCompare(b, "ar"));
    /* «الخياطة» و«الخياطة والتفصيل» اسمان لمسار واحد في جدولين: يُبقى الأطول */
    const merge = (set) => {
      const all = sort(set);
      return all.filter((v) => !all.some((o) => o !== v && norm(o).includes(norm(v)) && norm(o).length > norm(v).length));
    };
    return { track: merge(out.track), course: sort(out.course), group: sort(out.group), trainer: sort(out.trainer) };
  }

  /* النظام يسمّيها «الدورة»، والمستخدم يسمّيها «المرحلة» — تُعرض بتسميته وتُطابَق بقيمتها */
  const shown = (f, v) => (f === "course" ? String(v).replace(/الدورة/g, "المرحلة") : String(v));
  const TITLE = { course: "المرحلة", group: "المجموعة", track: "المسار", trainer: "المدرب" };
  const ALL = { course: "كل المراحل", group: "كل المجموعات", track: "كل المسارات", trainer: "كل المدربين" };

  function renderFilters(d) {
    const bar = $("sc-filters");
    if (!bar) return;
    const c = choices(d || {});
    // المرحلة والمجموعة أولاً وبحجم أبرز، ثم بقية الفلاتر.
    // فلتر بلا قيم في اللقطة يظهر معطّلاً بسبب ظاهر، لا يختفي بلا تفسير.
    const main = (f) => f === "course" || f === "group";
    const box = (f) => {
      if (!c[f].length && !main(f)) return "";
      const off = !c[f].length;
      // سطر واحد بلا فراغات بين الوسوم: الفراغ داخل عنصر flex يصير صفاً فارغاً
      const opts = `<option value="">${off ? "لا توجد في اللقطة" : esc(ALL[f])}</option>`
        + c[f].map((v) => `<option value="${esc(v)}" ${v === filters[f] ? "selected" : ""}>${esc(shown(f, v))}</option>`).join("");
      return `<label class="sc-f ${main(f) ? "sc-main" : ""} ${off ? "off" : ""}"><span>${esc(TITLE[f])}</span><select data-f="${f}" aria-label="${esc(TITLE[f])}" ${off ? "disabled" : ""}>${opts}</select></label>`;
    };
    bar.innerHTML = FIELDS.map(box).join("")
      + `<label class="sc-f"><span>بحث</span><input type="search" id="sc-q" placeholder="اسم مجموعة أو مدرب…" value="${esc(filters.q)}"></label>`
      + (anyFilter() ? `<button type="button" class="btn small secondary" id="sc-clear">✕ مسح الفلاتر</button>` : "");
  }
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
    const t = rows(d.tracks);
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
    const a = rows(d.attendance);
    const g = rows(d.groups);
    const totalRows = sum(a, "total");
    const present = sum(a, "present");
    const rate = pct(present, totalRows);
    // المدربون: يُفلترون باسمهم وبالمجموعات الباقية بعد الفلترة
    const names = new Set(g.map((x) => norm(x.trainer)).filter(Boolean));
    const trainers = (d.trainers || []).filter((t) => like(t.name, filters.trainer) && hits(t)
      && (!names.size || !(filters.track || filters.course || filters.group) || names.has(norm(t.name))));
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
    const list = rows(gr.tracks);
    // مع الفلترة تُحسب الأرقام من الصفوف الباقية، وبلا فلترة من إجماليات اللقطة
    const on = anyFilter() && (gr.tracks || []).length;
    const students = sum(list, "count");
    const avg = on ? (students ? Math.round(list.reduce((a, r) => a + num(r.average) * num(r.count), 0) / students) : 0) : num(gr.average);
    const pick = (key) => (on ? sum(list, key) : num(gr[key]));
    const passed = pick("passed"), failed = pick("failed");
    return `<div class="sc-kpis">
        ${kpi("متوسط الدرجات", avg ? ui.fmt(avg) : "—", on ? `${ui.fmt(students)} طالباً بعد الفلترة` : "")}
        ${kpi("ناجح", ui.fmt(passed), passed + failed ? pct(passed, passed + failed) + "%" : "", "good")}
        ${kpi("راسب", ui.fmt(failed), "", failed ? "warn" : "")}
        ${kpi("درجات معتمدة", ui.fmt(pick("approved")))}
        ${kpi("بانتظار الاعتماد", ui.fmt(pick("pending")), "", pick("pending") ? "warn" : "")}
        ${kpi("بانتظار التصحيح", on ? "—" : ui.fmt(num(gr.awaitingGrading)), on ? "لا يُفلتر" : "")}
      </div>`
      + card("متوسط الدرجات", bars(list.map((r) => ({ label: [r.track, r.group].filter(Boolean).join(" — ") || "—", value: Math.round(num(r.average)), note: `${ui.fmt(num(r.count))} طالباً` })), { isPercent: false }), true);
  }

  function panelPeople(d) {
    const p = rows(d.demographics);
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

  /* المتابعات: من لم يوقّع تعهداً ومن لم يعبّئ الاستبيان — أعداد لكل مجموعة، بلا أسماء */
  function panelFollowUps(d) {
    const f = d.followUps || {};
    const pl = rows(f.pledges);
    const sv = rows(f.surveys);
    const students = sum(pl, "students");
    const signed = sum(pl, "pledged");
    const noPledge = sum(pl, "missing");
    const noSurvey = sum(sv, "missing");
    if (!pl.length && !sv.length) {
      return `<section class="card sc-empty"><h3>لا توجد بيانات متابعة</h3>
        <p>هذه اللوحة تحتاج لقطة من سكربت القراءة بعد تحديثه: يقرأ صفحتَي «تعهدات الطلاب» و«الاستبيانات غير المعبّأة».</p></section>`;
    }
    return `<div class="sc-kpis">
        ${kpi("لم يوقّع التعهد", ui.fmt(noPledge), students ? `من ${ui.fmt(students)} متدرباً` : "", noPledge ? "warn" : "good")}
        ${kpi("وقّع التعهد", ui.fmt(signed), students ? pct(signed, students) + "%" : "", "good")}
        ${kpi("لم يعبّئ الاستبيان", ui.fmt(noSurvey), "", noSurvey ? "warn" : "good")}
        ${kpi("مجموعات فيها متأخرون", ui.fmt(pl.filter((r) => num(r.missing) > 0).length + sv.filter((r) => num(r.missing) > 0).length))}
      </div>`
      + card("لم يوقّعوا التعهد — لكل مجموعة", bars(pl.filter((r) => num(r.missing) > 0).map((r) => ({
          label: [r.group, r.track].filter(Boolean).join(" · ") || "—",
          value: num(r.missing),
          note: num(r.students) ? `من ${ui.fmt(num(r.students))}` : "",
        })), {}), true)
      + card("لم يعبّئوا الاستبيان — لكل مجموعة", bars(sv.filter((r) => num(r.missing) > 0).map((r) => ({
          label: [r.group, r.track].filter(Boolean).join(" · ") || "—",
          value: num(r.missing),
          note: r.course || "",
        })), {}), true);
  }

  const PANELS = [
    { name: "الطلبات والسعة", build: panelTracks },
    { name: "الحضور والمجموعات", build: panelAttendance },
    { name: "الدرجات والنتائج", build: panelGrades },
    { name: "خصائص المتدربين", build: panelPeople },
    { name: "المتابعات", build: panelFollowUps },
  ];

  /* ===== الرسم ===== */
  function render() {
    const box = $("sc-body");
    if (!box) return;
    if (!snap) snap = cached();
    const info = $("sc-updated");
    if (info) {
      // ما الذي وصل فعلاً في اللقطة: يكشف بسرعة أي جدول لم يُقرأ
      const d = (snap && snap.data) || {};
      const counts = snap ? ` · ${ui.fmt((d.tracks || []).length)} مسار · ${ui.fmt((d.groups || []).length)} مجموعة`
        + ` · ${ui.fmt([...new Set((d.groups || []).map((g) => g.course).filter(Boolean))].length)} مرحلة`
        + ` · ${ui.fmt(((d.followUps || {}).pledges || []).length)} صف متابعة` : "";
      info.textContent = snap
        ? `آخر تحديث: ${new Date(snap.at).toLocaleString("ar-EG")}${snap.by ? ` · ${snap.by}` : ""}${counts}`
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
    scope = tracksOfPhase(snap.data || {});
    renderFilters(snap.data || {});
    const html = PANELS[panel].build(snap.data || {});
    box.innerHTML = html;
    // فلترة لم تُبقِ شيئاً: نقولها صراحة بدل لوحة فارغة
    if (anyFilter() && !box.querySelector(".sc-bar-row") && !box.querySelector(".sc-empty")) {
      box.insertAdjacentHTML("afterbegin", `<section class="card sc-empty"><h3>لا نتائج لهذه الفلترة</h3><p class="conv-hint">جرّب مسح بعض الفلاتر من الشريط أعلاه.</p></section>`);
    }
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
        <li>افتح نظام المركز <code>tamkeen.ksach.org/admin</code> في تبويب جديد وأنت مسجّل دخولك.</li>
        <li>اضغط <code>F12</code> ← تبويب <b>Console</b> (نافذة المطوّر في المتصفح).</li>
        <li>افتح ملف <code>إحصاءات-الشاشة.js</code> بالمفكرة، حدّد كل شيء (Ctrl+A) وانسخه (Ctrl+C)، ثم الصقه في Console واضغط Enter.</li>
        <li>سيسألك عن «رمز الشاشة» مرة واحدة: الصقه واضغط موافق — ويُحفظ في هذا المتصفح فلا يُسأل ثانية.</li>
        <li>يقرأ السكربت صفحات التقارير (قراءة فقط)، ويرسل لقطة أرقام مجمّعة إلى خادم تمكين، ثم يعيدها كل ١٥ دقيقة ما دام التبويب مفتوحاً.</li>
        <li>اللوحات خمس: الطلبات والسعة، الحضور والمجموعات، الدرجات والنتائج، خصائص المتدربين، والمتابعات (من لم يوقّع التعهد ومن لم يعبّئ الاستبيان — أعداد لكل مجموعة بلا أسماء).</li>
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
    // نسخة قديمة من الصفحة في مخزن المتصفح: لا نكسر بقية النظام
    if (!$("sc-body") || !$("sc-refresh")) return;
    $("sc-refresh").addEventListener("click", () => load(false));
    $("sc-full").addEventListener("click", fullscreen);
    $("sc-key").addEventListener("click", copyKey);
    $("sc-how").addEventListener("click", howTo);
    $("sc-filters").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-f]");
      if (!sel) return;
      filters[sel.dataset.f] = sel.value;
      saveFilters();
      render();
    });
    let typing = null;
    $("sc-filters").addEventListener("input", (e) => {
      if (e.target.id !== "sc-q") return;
      const v = e.target.value;
      clearTimeout(typing);
      typing = setTimeout(() => { filters.q = v; saveFilters(); render(); const q = $("sc-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300);
    });
    $("sc-filters").addEventListener("click", (e) => {
      if (!e.target.closest("#sc-clear")) return;
      filters = { track: "", course: "", group: "", trainer: "", q: "" };
      saveFilters();
      render();
    });
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
