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
  let period = null;              // { from, to } المدة التي اخترناها للإحصاء
  let timer = null, rotateTimer = null, panel = 0, showing = false;

  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; };

  /* ===== الفلاتر: تسري على كل اللوحات ===== */
  const FILTER_KEY = "tamkeen-admin:screen-filters";
  const FIELDS = ["course", "group", "track", "trainer", "form"];
  let filters = { track: "", course: "", group: "", trainer: "", form: "", q: "" };
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
  let phaseOfGroup = new Map();   // المجموعة ← مرحلتها، من أي جدول ذكرهما معاً

  /* مرحلة كل مجموعة: المفتاح «المسار + المجموعة» لأن G1 و G2 تتكرران في كل المسارات،
     ويُكتفى باسم المجموعة وحده إن لم يكن له إلا مرحلة واحدة في كل اللقطة. */
  function groupPhases(d) {
    const src = [(d.groups || []), (d.attendance || []), ((d.grades || {}).tracks || []),
      ((d.followUps || {}).pledges || []), ((d.followUps || {}).surveys || [])].flat();
    const map = new Map();
    const solo = new Map();
    src.forEach((r) => {
      if (!r || !r.group || !r.course) return;
      const g = String(r.group), c = String(r.course);
      if (r.track) { const k = String(r.track) + "|" + g; if (!map.has(k)) map.set(k, c); }
      const seen = solo.get(g);
      if (!seen) solo.set(g, { course: c, one: true });
      else if (seen.course !== c) seen.one = false;
    });
    solo.forEach((v, g) => { if (v.one) map.set("|" + g, v.course); });
    return map;
  }

  function tracksOfPhase(d) {
    if (!filters.course) return [];
    const src = [(d.groups || []), (d.attendance || []), ((d.grades || {}).tracks || []),
      ((d.followUps || {}).pledges || []), ((d.followUps || {}).surveys || [])].flat();
    const out = new Set();
    src.forEach((r) => { if (r && r.course && like(r.course, filters.course) && r.track) out.add(String(r.track)); });
    return [...out];
  }

  /* صف يمر إن طابق كل فلتر يعنيه؛ والصف الذي لا يحمل المرحلة يُقاس بمسارات المرحلة */
  /* مرحلة الصف: من الصف نفسه، أو من مجموعته إن عرفناها من جدول آخر */
  const phaseOf = (row) => row.course
    || (row.group && row.track ? phaseOfGroup.get(String(row.track) + "|" + String(row.group)) : "")
    || (row.group ? phaseOfGroup.get("|" + String(row.group)) : "")
    || "";

  function keep(row) {
    if (!hits(row)) return false;
    if (!FIELDS.filter((f) => f !== "course").every((f) => !filters[f] || row[f] === undefined || like(row[f], filters[f]))) return false;
    if (!filters.course) return true;
    const phase = phaseOf(row);
    if (phase) return like(phase, filters.course);
    // لا مرحلة ولا مجموعة معروفة: يُقاس بمسارات المرحلة إن أمكن
    if (row.track && scope.length) return scope.some((t) => like(row.track, t));
    return true;
  }
  const rows = (list) => (list || []).filter(keep);
  const anyFilter = () => !!(filters.q || FIELDS.some((f) => filters[f]));

  /* قيم القوائم المنسدلة: كل قائمة تعرض ما يتوافق مع بقية الفلاتر المختارة،
     فاختيار المرحلة يُبقي مجموعاتها وحدها، واختيار المسار يُبقي مدرّبيه. */
  function choices(d) {
    const out = { track: new Set(), course: new Set(), group: new Set(), trainer: new Set(), form: new Set() };
    // صف يمر بكل الفلاتر عدا الحقل الذي نبني قائمته؛ ومسارات المرحلة تُحترم هنا أيضاً
    const fits = (row, skip) => {
      if (!hits(row)) return false;
      if (!FIELDS.filter((f) => f !== "course" && f !== skip).every((f) => !filters[f] || row[f] === undefined || like(row[f], filters[f]))) return false;
      if (skip === "course" || !filters.course) return true;
      const phase = phaseOf(row);
      if (phase) return like(phase, filters.course);
      if (row.track && scope.length) return scope.some((t) => like(row.track, t));
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
    return { track: merge(out.track), course: sort(out.course), group: sort(out.group), trainer: sort(out.trainer), form: sort(out.form) };
  }

  /* النظام يسمّيها «الدورة»، والمستخدم يسمّيها «المرحلة» — تُعرض بتسميته وتُطابَق بقيمتها */
  const shown = (f, v) => (f === "course" ? String(v).replace(/الدورة/g, "المرحلة") : String(v));
  const TITLE = { course: "المرحلة", group: "المجموعة", track: "المسار", trainer: "المدرب", form: "الاستبيان" };
  const ALL = { course: "كل المراحل", group: "كل المجموعات", track: "كل المسارات", trainer: "كل المدربين", form: "كل الاستبيانات" };

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
      period = r.period || null;
      showPeriod();
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
      + card("لم يعبّئوا الاستبيان — لكل مجموعة واستبيان", bars(sv.filter((r) => num(r.missing) > 0).map((r) => ({
          label: [r.form, r.group].filter(Boolean).join(" — ") || r.track || "—",
          value: num(r.missing),
          note: [r.track, r.course].filter(Boolean).join(" · "),
        })), {}), true)
      + namesCard("أسماء من لم يوقّع التعهد", pl)
      + namesCard("أسماء من لم يعبّئ الاستبيان", sv, true);
  }

  /* أسماء المتأخرين: للمدير وحده، ومطويّة، وتختفي في وضع ملء الشاشة (شاشة القاعة).
     اللقطة لا تحمل أرقام هوية ولا جوالات — أسماء فقط. */
  let printing = false;   // التقرير المطبوع بلا أسماء
  function namesCard(title, list, withForm) {
    if (printing || !App.profile || !App.profile.isAdmin()) return "";
    const withNames = (list || []).filter((r) => (r.names || []).length);
    if (!withNames.length) return "";
    const blocks = withNames.map((r) => {
      const head = [withForm ? r.form : "", r.group, r.track].filter(Boolean).join(" · ") || "—";
      const chips = (r.names || []).map((n) => `<span class="sc-name">${esc(n)}</span>`).join("");
      const more = num(r.missing) > (r.names || []).length
        ? `<span class="conv-hint"> ومعهم ${ui.fmt(num(r.missing) - r.names.length)} غيرهم</span>` : "";
      return `<details class="sc-names-group"><summary>${esc(head)} <b>${ui.fmt((r.names || []).length)}</b></summary>
        <div class="sc-names-list">${chips}</div>${more}</details>`;
    }).join("");
    const kind = withForm ? "survey" : "pledge";
    const total = withNames.reduce((a, r) => a + (r.names || []).length, 0);
    return `<section class="card sc-card sc-names wide">
      <div class="sc-names-head"><h3>${esc(title)} <span class="conv-hint">(${ui.fmt(total)})</span></h3>
        <button type="button" class="btn small" data-export="${kind}">⬇ تصدير Excel</button></div>
      <p class="conv-hint">تظهر للمدير فقط، وتختفي في وضع ملء الشاشة. التصدير يتبع الفلاتر المختارة.</p>${blocks}</section>`;
  }

  /* تصدير الأسماء الظاهرة (بعد الفلترة) إلى ملف Excel */
  async function exportNames(kind) {
    const d = (snap && snap.data) || {};
    const f = d.followUps || {};
    const list = rows(kind === "survey" ? f.surveys : f.pledges).filter((r) => (r.names || []).length);
    if (!list.length) { ui.toast("لا توجد أسماء لتصديرها"); return; }
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const title = kind === "survey" ? "لم يعبّئوا الاستبيان" : "لم يوقّعوا التعهد";
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(title.slice(0, 28), { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "الاسم", key: "name", width: 28 },
      { header: "المجموعة", key: "group", width: 18 },
      { header: "المسار", key: "track", width: 30 },
      { header: "المرحلة", key: "course", width: 16 },
      { header: "الاستبيان", key: "form", width: 22 },
    ];
    list.forEach((r) => (r.names || []).forEach((n) => ws.addRow({ name: n, group: r.group || "", track: r.track || "", course: r.course || "", form: r.form || "" })));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
    const buf = await wb.xlsx.writeBuffer();
    const tag = [filters.course, filters.track, filters.group].filter(Boolean).join(" - ");
    ui.download(`${title}${tag ? " - " + tag : ""}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    ui.toast(`صُدّر ${ui.fmt(ws.rowCount - 1)} اسماً`);
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
    phaseOfGroup = groupPhases(snap.data || {});
    scope = tracksOfPhase(snap.data || {});
    showPeriod();
    renderFilters(snap.data || {});
    const html = PANELS[panel].build(snap.data || {});
    box.innerHTML = html;
    // فلترة لم تُبقِ شيئاً: نقولها صراحة بدل لوحة فارغة
    if (anyFilter() && !box.querySelector(".sc-bar-row") && !box.querySelector(".sc-empty")) {
      box.insertAdjacentHTML("afterbegin", `<section class="card sc-empty"><h3>لا نتائج لهذه الفلترة</h3><p class="conv-hint">جرّب مسح بعض الفلاتر من الشريط أعلاه.</p></section>`);
    }
  }

  /* ===== مدة الإحصاء: تُحفظ على الخادم، ويقرأها سكربت القراءة في جولته التالية ===== */
  function showPeriod() {
    const from = $("sc-from"), to = $("sc-to"), note = $("sc-period-note");
    if (!from || !to) return;
    from.value = (period && period.from) || "";
    to.value = (period && period.to) || "";
    const applied = snap && snap.data && snap.data.period;
    if (!note) return;
    note.textContent = applied
      ? `الأرقام المعروضة لمدة: ${applied.from || "البداية"} إلى ${applied.to || "اليوم"}`
      : period && (period.from || period.to)
        ? "المدة محفوظة — ستُطبَّق في الجولة القادمة لسكربت القراءة (خلال ١٥ دقيقة)"
        : "الأرقام لكل المدة المتاحة في النظام";
  }

  async function savePeriod(clear) {
    if (!App.profile.isAdmin()) { ui.toast("تحديد المدة للمدير وحده"); return; }
    const from = clear ? "" : $("sc-from").value;
    const to = clear ? "" : $("sc-to").value;
    if (from && to && from > to) { ui.toast("تاريخ البداية بعد النهاية"); return; }
    try {
      const r = await App.cloud.setStatsPeriod(from, to);
      period = r.period || null;
      showPeriod();
      ui.toast(clear ? "أُلغيت المدة" : "حُفظت المدة — تُطبَّق في الجولة القادمة");
    } catch (e) { ui.toast(e.message); }
  }

  /* ===== تقرير شامل: كل اللوحات في صفحة واحدة مع أشرطتها، جاهزة للطباعة ===== */
  function fullReport() {
    if (!snap || !snap.data) { ui.toast("لا توجد أرقام بعد"); return; }
    const d = snap.data;
    const w = window.open("", "_blank", "noopener,width=1000,height=800");
    if (!w) { ui.toast("اسمح بالنوافذ المنبثقة لعرض التقرير"); return; }
    const applied = d.period;
    const head = [
      filters.course ? `المرحلة: ${filters.course}` : "",
      filters.track ? `المسار: ${filters.track}` : "",
      filters.group ? `المجموعة: ${filters.group}` : "",
      applied ? `المدة: ${applied.from || "البداية"} إلى ${applied.to || "اليوم"}` : "المدة: كل المتاح",
    ].filter(Boolean).join(" · ");
    const section = (title, html) => `<section><h2>${esc(title)}</h2>${html}</section>`;
    printing = true;
    const body = PANELS.map((p) => section(p.name, p.build(d))).join("");
    printing = false;
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <title>تقرير إحصاءات المركز</title>
      <link rel="stylesheet" href="${location.origin}${location.pathname.replace(/[^/]*$/, "")}styles/theme.css">
      <style>@page{size:A4;margin:12mm}
        body{font-family:"Cairo",Tahoma,Arial;margin:18px;background:#fff;color:#1b2433}
        h1{font-size:18pt;background:#0b1f3a;color:#fff;padding:10px;border-radius:8px;margin:0 0 6px}
        p.meta{color:#5f6b7d;margin:0 0 16px;font-size:11pt}
        section{break-inside:avoid;margin-bottom:18px}
        section > h2{font-size:14pt;border-bottom:2px solid #0f8b8d;padding-bottom:4px}
        .sc-names, .no-print, .sc-filters{display:none!important}
        .sc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .card{border:1px solid #dde3ec;border-radius:10px;padding:10px;margin:8px 0}
      </style></head><body>
      <h1>تقرير إحصاءات المركز</h1>
      <p class="meta">${esc(head)} — أُخذت الأرقام ${esc(new Date(snap.at).toLocaleString("ar-EG"))}</p>
      ${body}
      <script>setTimeout(() => window.print(), 600);<\/script>
      </body></html>`);
    w.document.close();
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
    $("sc-report").addEventListener("click", fullReport);
    $("sc-period-apply").addEventListener("click", () => savePeriod(false));
    $("sc-period-clear").addEventListener("click", () => savePeriod(true));
    showPeriod();
    $("sc-copy").addEventListener("click", async () => {
      if (!snap) { ui.toast("لا توجد لقطة بعد"); return; }
      try {
        await navigator.clipboard.writeText(JSON.stringify(snap, null, 1));
        ui.toast("نُسخت اللقطة — أرقام مجمّعة بلا أسماء");
      } catch (e) { ui.toast("تعذّر النسخ: " + e.message); }
    });
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
      filters = { track: "", course: "", group: "", trainer: "", form: "", q: "" };
      saveFilters();
      render();
    });
    $("sc-body").addEventListener("click", (e) => {
      const b = e.target.closest("[data-export]");
      if (!b) return;
      exportNames(b.dataset.export);
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
