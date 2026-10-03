/* منشئ التقارير: جدول الطلاب القادم من نظام المركز، تختار حقوله وتصفّيه فيخرج تقريرك.
   البيانات تصل مع لقطة «شاشة إحصاءات المركز» نفسها (سكربت القراءة يدفعها)، فلا اتصال من هنا بالنظام.
   وتُضاف إليها جداول إكسل يرفعها المستخدم: تُحفظ على الخادم فيراها الجميع،
   وتُدمج أعمدتها مع صف الطالب بمطابقة رقم الهوية ثم الاسم. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const PICK_KEY = "tamkeen-admin:report-fields";
  const MAX_ROWS = 400;          // ما يُعرض على الشاشة؛ التصدير يأخذ الكل

  /* الحقول المتاحة، مجموعة كما يفهمها المستخدم */
  const GROUPS = [
    {
      name: "بيانات التدريب",
      fields: [
        { key: "name", label: "الاسم", on: true },
        { key: "track", label: "المسار", on: true },
        { key: "course", label: "المرحلة", on: true },
        { key: "group", label: "المجموعة", on: true },
        { key: "trainer", label: "المدرب" },
        { key: "status", label: "حالة الطالب" },
        { key: "stu", label: "رقم الطالب" },
      ],
    },
    {
      name: "البيانات الشخصية",
      fields: [
        { key: "gender", label: "الجنس" },
        { key: "governorate", label: "المحافظة" },
        { key: "health", label: "الحالة الصحية" },
        { key: "marital", label: "الحالة الاجتماعية" },
        { key: "income", label: "مستوى الدخل" },
        { key: "nid", label: "رقم الهوية" },
        { key: "phone", label: "الجوال" },
      ],
    },
    {
      name: "الدرجات والنتيجة",
      fields: [
        { key: "practical", label: "العملي" },
        { key: "theory", label: "النظري" },
        { key: "activities", label: "الأنشطة" },
        { key: "total", label: "المجموع" },
        { key: "gradeStatus", label: "حالة الدرجة" },
        { key: "approval", label: "الاعتماد" },
      ],
    },
    {
      name: "الالتزام والمتابعة",
      fields: [
        { key: "pledged", label: "وقّع التعهد" },
        { key: "missingSurveys", label: "استبيانات لم تُعبّأ" },
        { key: "attendance", label: "حضور المجموعة %" },
      ],
    },
  ];
  /* حقول يرسلها نظام المركز نفسه بأسماء أعمدته («sys:تاريخ الميلاد»)، فما يضيفه المركز
     في جداوله يظهر هنا بلا أن نسمّيه مسبقاً. */
  const SYS = "sys:";

  /* بيانات الدورة التي يكتبها الموظف في «المسارات والرموز» (التواريخ والنوع والرمز):
     النظام الرسمي لا يعرفها، فتُكتب مرة لكل دورة وتلتصق هنا بكل طالب فيها. */
  const CRS = "crs:";
  const CRS_FIELDS = [
    { key: CRS + "رمز الدورة", pick: (r) => r.code },
    { key: CRS + "بداية الدورة", pick: (r) => r.start },
    { key: CRS + "نهاية الدورة", pick: (r) => r.end },
    { key: CRS + "نوع التدريب", pick: (r) => r.type },
  ];
  const crsGroup = () => [{ name: "بيانات الدورة (من المسارات والرموز)", fields: CRS_FIELDS.map((f) => ({ key: f.key, label: f.key.slice(CRS.length) })) }];

  /* المطابقة فضفاضة: «مسار التطريز والخياطة» في اللقطة و«التطريز والخياطة» في الدليل،
     و«الدورة الثانية» و«المرحلة الثانية»، و«G1» و«المجموعة الأولى». */
  /* «\b» في جافاسكربت حدٌّ بين حرف لاتيني وغيره، فلا يصلح للعربية: نفصل النمطين */
  const ORDINALS = [
    { d: "1", re: /الاولى|\bG\s?1\b|(^|\s)1(\s|$)/i },
    { d: "2", re: /الثانيه|\bG\s?2\b|(^|\s)2(\s|$)/i },
    { d: "3", re: /الثالثه|\bG\s?3\b|(^|\s)3(\s|$)/i },
    { d: "4", re: /الرابعه|\bG\s?4\b|(^|\s)4(\s|$)/i },
  ];
  const ordinal = (v) => { const n = norm(v); for (const o of ORDINALS) if (o.re.test(n)) return o.d; return ""; };
  const near = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

  function courseOf(row) {
    const list = (App.store && App.store.get().trackCodes) || [];
    const codes = list.filter((r) => r && r.kind === "phaseCode");
    if (!codes.length) return null;
    const g = ordinal(row.group), c = ordinal(row.course);
    return codes.find((r) => near(row.track, r.trackName) && (!g || ordinal(r.group) === g) && (!c || ordinal(r.phase) === c))
      || codes.find((r) => near(row.track, r.trackName) && (!c || ordinal(r.phase) === c))
      || null;
  }
  let sysFields = [];
  function readSysFields(list) {
    const seen = new Map();
    for (const r of list) {
      for (const k of Object.keys(r)) {
        if (k.startsWith(SYS) && String(r[k] || "").trim()) seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    // الأكثر امتلاءً أولاً، فأهم الحقول في المقدمة
    sysFields = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }

  /* الجداول المستوردة: كل جدول يصير مجموعة حقول باسمه، ومفتاح الحقل «x:الجدول:العمود» */
  let extras = [];              // [{ name, fields, rows, count, by, at }]
  const EX = "x:";
  const exKey = (table, col) => `${EX}${table}:${col}`;
  const exGroups = () => extras.map((t) => ({
    name: `📄 ${t.name}`, table: t.name,
    fields: (t.fields || []).map((c) => ({ key: exKey(t.name, c), label: c })),
  }));
  const sysGroup = () => (sysFields.length
    ? [{ name: "من نظام المركز", fields: sysFields.map((k) => ({ key: k, label: k.slice(SYS.length) })) }]
    : []);
  const groups = () => GROUPS.concat(sysGroup(), crsGroup(), exGroups());
  const all = () => groups().flatMap((g) => g.fields);
  const labelOf = (k) => (all().find((f) => f.key === k) || {}).label || String(k).replace(/^x:[^:]*:/, "").replace(/^(sys|crs):/, "");

  const ALL = GROUPS.flatMap((g) => g.fields);

  /* الفلاتر: حقول قليلة القيم تصلح قوائمَ منسدلة. أعمدة الإكسل تنضمّ إليها
     ما دامت قيمها معدودة (لا نضع حقل ملاحظات حرّاً في قائمة منسدلة). */
  const BASE_FILTERS = ["course", "track", "group", "gender", "status", "pledged", "approval"];
  const FILTER_MAX = 40;
  function filterFields(list) {
    const out = [...BASE_FILTERS];
    const few = (k) => {
      const seen = new Set();
      for (const r of list) {
        const v = String(r[k] == null ? "" : r[k]).trim();
        if (v) seen.add(v);
        if (seen.size > FILTER_MAX) return 0;
      }
      return seen.size;
    };
    sysFields.forEach((k) => { if (few(k)) out.push(k); });
    CRS_FIELDS.forEach((f) => { if (few(f.key)) out.push(f.key); });
    extras.forEach((t) => (t.fields || []).forEach((c) => {
      const k = exKey(t.name, c);
      const seen = new Set();
      for (const r of list) {
        const v = String(r[k] == null ? "" : r[k]).trim();
        if (v) seen.add(v);
        if (seen.size > FILTER_MAX) return;
      }
      if (seen.size) out.push(k);
    }));
    return out;
  }

  let picked = ALL.filter((f) => f.on).map((f) => f.key);
  let filters = {};
  let search = "";
  let groupBy = "";
  let hideBlank = true;   // طالب لا قيمة له في أي حقل مختار لا يُعرض سطراً فارغاً
  try {
    const saved = JSON.parse(localStorage.getItem(PICK_KEY) || "null");
    if (saved && saved.picked && saved.picked.length) {
      picked = saved.picked.filter((k) => ALL.some((f) => f.key === k) || /^(x|sys|crs):/.test(String(k)));
      filters = saved.filters || {};
      groupBy = saved.groupBy || "";
      if (saved.hideBlank === false) hideBlank = false;

    }
  } catch (e) { /* تخزين غير متاح */ }
  /* الأعمدة تتبع ترتيب المجموعات أعلاه لا ترتيب النقر */
  const order = () => { const seq = all().map((f) => f.key); picked = seq.filter((k) => picked.includes(k)).concat(picked.filter((k) => !seq.includes(k))); };
  const save = () => { try { localStorage.setItem(PICK_KEY, JSON.stringify({ picked, filters, groupBy, hideBlank })); } catch (e) { /* ممتلئ */ } };

  const snap = () => {
    if (App.screen && App.screen.snapshot) return App.screen.snapshot();
    try { return JSON.parse(localStorage.getItem("tamkeen-admin:ksach-stats") || "null"); } catch (e) { return null; }
  };
  const base = () => {
    const s = snap();
    return (s && s.data && s.data.students) || [];
  };

  const norm = (v) => String(v == null ? "" : v).replace(/[ً-ْ]/g, "").replace(/[إأآا]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
  const idOf = (v) => String(v == null ? "" : v).replace(/[^\d]/g, "");

  /* صف الطالب + أعمدة كل جدول مستورد، بمطابقة الهوية ثم الاسم */
  let merged = null, mergedFor = "";
  function students() {
    const list = base();
    readSysFields(list);
    const codes = (App.store && App.store.get().trackCodes) || [];
    if (!extras.length && !codes.length) return list;
    const stamp = `${list.length}|${extras.map((t) => t.name + ":" + t.count).join(",")}|${codes.length}:${codes.map((c) => c.start + c.end + c.type).join("").length}`;
    if (merged && mergedFor === stamp) return merged;
    const out = list.map((r) => ({ ...r }));
    const byId = new Map(), byName = new Map();
    out.forEach((r) => {
      const id = idOf(r.nid);
      if (id) byId.set(id, r);
      const n = norm(r.name);
      if (n && !byName.has(n)) byName.set(n, r);
    });
    // بيانات الدورة من دليل الترميز
    out.forEach((r) => {
      const c = courseOf(r);
      if (c) CRS_FIELDS.forEach((f) => { const v = f.pick(c); if (v) r[f.key] = v; });
    });
    extras.forEach((t) => {
      (t.rows || []).forEach((row) => {
        const target = byId.get(idOf(row._id)) || byName.get(norm(row._name));
        if (!target) return;
        (t.fields || []).forEach((c) => {
          const v = row[c];
          if (v != null && String(v).trim() !== "") target[exKey(t.name, c)] = v;
        });
      });
    });
    merged = out;
    mergedFor = stamp;
    return out;
  }

  function rows() {
    const q = norm(search);
    const list = students();
    const keys = filterFields(list);
    return list.filter((r) => {
      for (const f of keys) {
        if (filters[f] && norm(r[f]) !== norm(filters[f])) return false;
      }
      if (!q) return true;
      return norm(Object.values(r).join(" ")).includes(q);
    });
  }

  /* الصفوف التي لا تحمل قيمة في أي حقل اخترته: عرضها سطوراً فارغة لا يفيد */
  const filled = (r) => picked.some((k) => String(r[k] == null ? "" : r[k]).trim() !== "");
  const shownRows = () => {
    const list = rows();
    return hideBlank && picked.length && !groupBy ? list.filter(filled) : list;
  };

  /* ===== الواجهة ===== */
  function renderFields() {
    $("rep-fields").innerHTML = groups().map((g) => `<div class="rep-group">
        <div class="rep-group-head"><b>${esc(g.name)}</b>
          <button type="button" class="conv-link" data-all="${esc(g.name)}">الكل</button>
          <button type="button" class="conv-link" data-none="${esc(g.name)}">لا شيء</button>
        </div>
        <div class="rep-chips">${g.fields.map((f) => `<label class="rep-chip ${picked.includes(f.key) ? "on" : ""}">
          <input type="checkbox" data-field="${esc(f.key)}" ${picked.includes(f.key) ? "checked" : ""}> ${esc(f.label)}
        </label>`).join("")}</div>
      </div>`).join("");
  }

  function renderFilters() {
    const list = students();
    const vals = (key) => [...new Set(list.map((r) => String(r[key] == null ? "" : r[key]).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")).slice(0, 60);
    $("rep-filters").innerHTML = filterFields(list).map((f) => {
      const options = vals(f);
      if (!options.length) return "";
      return `<label class="sc-f"><span>${esc(labelOf(f))}</span>
        <select data-filter="${esc(f)}"><option value="">الكل</option>
        ${options.map((v) => `<option ${filters[f] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
    }).join("")
      + `<label class="sc-f"><span>بحث</span><input type="search" id="rep-search" placeholder="اسم أو رقم…" value="${esc(search)}"></label>`
      + `<label class="sc-f"><span>تجميع حسب</span><select id="rep-group-by"><option value="">بلا تجميع (كل السجلات)</option>
        ${["track", "course", "group", "gender", "governorate", "health", "status", "pledged", "approval", "trainer"]
          .concat(filterFields(list).filter((k) => k.startsWith(EX) || k.startsWith(SYS) || k.startsWith(CRS)))
          .map((k) => `<option value="${k}" ${groupBy === k ? "selected" : ""}>${esc(labelOf(k))}</option>`).join("")}</select></label>`;
  }

  function summary(list) {
    const map = new Map();
    list.forEach((r) => {
      const key = String(r[groupBy] == null ? "" : r[groupBy]).trim() || "— بلا قيمة —";
      map.set(key, (map.get(key) || 0) + 1);
    });
    const total = list.length || 1;
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return `<table class="rep-table"><thead><tr><th>${esc(labelOf(groupBy))}</th><th>العدد</th><th>النسبة</th></tr></thead>
      <tbody>${sorted.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${ui.fmt(n)}</td><td>${Math.round((n / total) * 100)}%</td></tr>`).join("")}
      <tr class="rep-total"><td>المجموع</td><td>${ui.fmt(list.length)}</td><td>100%</td></tr></tbody></table>`;
  }

  function table(list) {
    if (!picked.length) return `<p class="conv-hint">اختر حقلاً واحداً على الأقل.</p>`;
    const shown = list.slice(0, MAX_ROWS);
    return `<div class="table-wrap"><table class="rep-table">
      <thead><tr><th>#</th>${picked.map((k) => `<th>${esc(labelOf(k))}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr><td>${ui.fmt(i + 1)}</td>${picked.map((k) => `<td>${esc(r[k] == null ? "" : r[k])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`
      + (list.length > shown.length ? `<p class="conv-hint">يُعرض ${ui.fmt(shown.length)} من ${ui.fmt(list.length)} — التصدير يأخذها كلها.</p>` : "");
  }

  /* اللقطة تصل من الخادم لا من هذه الصفحة: نسحب أحدثها عند كل دخول،
     وإلا بقينا على نسخة متصفحك القديمة. */
  let pulling = false;
  async function pull(say) {
    if (pulling || !App.screen || !App.screen.load) return;
    pulling = true;
    const before = students().length;
    try { await App.screen.load(true); } catch (e) { /* الشاشة تتولى التبليغ */ }
    pulling = false;
    render();
    if (say) ui.toast(students().length ? (students().length === before ? "لا جديد في اللقطة" : "وصلت بيانات جديدة") : "لا توجد لقطة فيها جدول طلاب");
  }

  function render() {
    if (!$("rep-body")) return;
    const s = snap();
    const list = shownRows();
    const blank = hideBlank && !groupBy ? rows().length - list.length : 0;
    $("rep-meta").innerHTML = s && s.at
      ? `${ui.fmt(students().length)} طالباً في آخر لقطة (${esc(new Date(s.at).toLocaleString("ar-EG"))}) · الظاهر الآن ${ui.fmt(list.length)}`
        + (blank ? ` · أُخفي ${ui.fmt(blank)} بلا قيمة في الحقول المختارة <button type="button" class="conv-link" id="rep-show-blank">أظهرها</button>` : "")
        + (!blank && !hideBlank ? ` <button type="button" class="conv-link" id="rep-hide-blank">أخفِ الفارغة</button>` : "")
      : "لا توجد بيانات بعد — شغّل سكربت القراءة من صفحة «شاشة إحصاءات المركز»";
    renderFields();
    renderFilters();
    renderImports();
    $("rep-body").innerHTML = !students().length
      ? `<section class="card sc-empty"><h3>لا توجد بيانات طلاب بعد</h3>
          <p>هذه الصفحة تعرض بيانات نظام المركز التي يجلبها سكربت القراءة. افتح «شاشة إحصاءات المركز» واضغط «▶ تشغيل القراءة في النظام»، وبعد «أُرسلت ✔» عُد إلى هنا.</p>
          <p class="conv-hint">${s && s.at ? `آخر لقطة وصلت ${esc(new Date(s.at).toLocaleString("ar-EG"))} وليس فيها جدول طلاب — هذا يعني أن السكربت المُشغَّل نسخة قديمة. أعد تشغيله من زر «▶ تشغيل القراءة في النظام» ليأخذ النسخة الجديدة.` : "لم تصل أي لقطة إلى الخادم بعد."}</p>
          <div class="btn-row"><button type="button" class="btn" id="rep-pull">🔄 اسحب آخر لقطة</button></div></section>`
      : `<section class="card">${groupBy ? summary(list) : table(list)}</section>`;
  }

  /* ===== استيراد ملفات إكسل =====
     نقرأ أول ورقة، نعدّ أول صف فيه خانتان نصيّتان أو أكثر ترويسةً،
     ونبحث عن عمود هوية (أرقام من ٩-١٠ خانات) أو عمود اسم للمطابقة. */
  const ID_COL = /هوية|الهويه|رقم.?وطني|identity|id\b/i;
  const NAME_COL = /^(الاسم|اسم|الطالب|المتدرب)|اسم (الطالب|المتدرب|الخريج|المستفيد)|الاسم الرباعي|full ?name|^name$/i;
  const SKIP_COL = /^(#|م|مسلسل|تسلسل|رقم)$/;

  function sheetRows(ws) {
    const grid = [];
    grid.nums = [];        // رقم كل صف في الورقة نفسها، فالصفوف الفارغة لا تُعدّ
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c); });
      grid.nums.push(row.number);
      grid.push(cells);
    });
    return grid;
  }
  function cellText(c) {
    const v = c && c.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if (v.richText) return v.richText.map((t) => t.text).join("");
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return "";
    }
    return String(v).trim();
  }

  /* صف العناوين ليس أول صف فيه خانتان: النماذج الرسمية تبدأ بعنوان ممدود على كل الأعمدة
     (خانة مدمجة تُقرأ خاناتٍ متكررة بالنص نفسه)، وقد يتلوه صف فارغ. فنبحث في أوائل الصفوف
     عن أكثرها شبهاً بترويسة: عناوين مختلفة، ويُرجَّح ما فيه اسم أو هوية. */
  function headerAt(grid) {
    let best = -1, bestScore = 0;
    grid.slice(0, 12).forEach((r, i) => {
      const cells = r.map((c) => String(c == null ? "" : c).trim()).filter(Boolean);
      const distinct = new Set(cells).size;
      if (distinct < 2) return;                       // عنوان ممدود: خانة واحدة مكرّرة
      let score = distinct;
      if (cells.some((c) => ID_COL.test(c))) score += 6;
      if (cells.some((c) => NAME_COL.test(c))) score += 6;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  function readGrid(grid) {
    const head = headerAt(grid);
    if (head < 0) throw new Error("لم أجد صف عناوين في الملف");
    const cols = grid[head].map((c, i) => String(c == null ? "" : c).trim() || `عمود ${i + 1}`);
    const body = grid.slice(head + 1).filter((r) => r.some((c) => String(c == null ? "" : c).trim()));
    // نموذج بترويسة بلا بيانات: لا يُرفض، بل نعبّئه نحن من بيانات النظام
    if (!body.length) return { mode: "fill", cols, headRow: (grid.nums || [])[head] || head + 1 };
    const idAt = cols.findIndex((c) => ID_COL.test(c));
    const nameAt = cols.findIndex((c) => NAME_COL.test(c));
    if (idAt < 0 && nameAt < 0) throw new Error("لا بد من عمود «رقم الهوية» أو «الاسم» لربط الصفوف بالطلاب");
    const fields = cols.filter((c, i) => i !== idAt && i !== nameAt && !SKIP_COL.test(c));
    const rows = body.map((r) => {
      const o = { _id: idAt >= 0 ? String(r[idAt] || "") : "", _name: nameAt >= 0 ? String(r[nameAt] || "") : "" };
      cols.forEach((c, i) => { if (i !== idAt && i !== nameAt && !SKIP_COL.test(c)) o[c] = String(r[i] == null ? "" : r[i]).trim(); });
      o._id = o._id.trim(); o._name = o._name.trim();
      return o;
    }).filter((o) => o._id || o._name);
    if (!rows.length) throw new Error("الصفوف تحت العناوين كلها بلا هوية ولا اسم");
    if (!fields.length) throw new Error("الملف لا يحمل أعمدة بيانات غير الاسم والهوية");
    return { fields, rows, matchedBy: idAt >= 0 ? "رقم الهوية" : "الاسم" };
  }

  /* تمييز العدد في العربية: واحد ومثنّى، ثم جمع القلة ٣-١٠، ثم المفرد المنصوب */
  const countOf = (n, few, many, one, two) => {
    if (n === 1) return one || few;
    if (n === 2) return two || (one ? one + "ان" : few);
    return `${ui.fmt(n)} ${n <= 10 ? few : many}`;
  };

  let staged = null;    // الملف المقروء قبل رفعه
  async function readFile(file) {
    if (typeof ExcelJS === "undefined") throw new Error("تعذّر تحميل مكتبة Excel");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("الملف لا يحتوي ورقة بيانات");
    const out = readGrid(sheetRows(ws));
    out.name = file.name.replace(/\.(xlsx|xlsm|xls)$/i, "").trim().slice(0, 80) || "جدول";
    if (out.mode === "fill") {
      out.buf = await file.arrayBuffer();
      out.map = autoMap(out.cols);
      return out;
    }
    // كم صفاً منها سيجد طالباً؟ نقولها للمستخدم قبل الرفع
    const list = base();
    const ids = new Set(list.map((r) => idOf(r.nid)).filter(Boolean));
    const names = new Set(list.map((r) => norm(r.name)).filter(Boolean));
    out.hits = out.rows.filter((r) => (r._id && ids.has(idOf(r._id))) || (r._name && names.has(norm(r._name)))).length;
    return out;
  }

  async function loadImports(quiet) {
    if (!App.cloud || !App.cloud.ready()) return;
    try {
      const r = await App.cloud.imports();
      extras = Array.isArray(r.imports) ? r.imports : [];
      merged = null;
      // عمود اختفى من ملف أُعيد رفعه لا يبقى عموداً فارغاً في التقرير
      const live = new Set(all().map((f) => f.key));
      const kept = picked.filter((k) => !k.startsWith(EX) || live.has(k));
      if (kept.length !== picked.length) { picked = kept; save(); }
    } catch (e) { if (!quiet) ui.toast(e.message); }
  }

  function renderImports() {
    const box = $("rep-imports");
    if (!box) return;
    const list = extras.map((t) => `<li><b>${esc(t.name)}</b>
        <span class="conv-hint">${countOf(t.count || (t.rows || []).length, "صفوف", "صفاً", "صف", "صفان")} · ${countOf((t.fields || []).length, "حقول", "حقلاً", "حقل", "حقلان")} · ${esc(t.by || "")} ${t.at ? esc(new Date(t.at).toLocaleDateString("ar-EG")) : ""}</span>
        <button type="button" class="conv-link" data-drop="${esc(t.name)}">حذف</button></li>`).join("");
    box.innerHTML = `<div class="rep-import-row">
        <label class="btn secondary" for="rep-file">⬆ اختر ملف إكسل</label>
        <input type="file" id="rep-file" accept=".xlsx,.xlsm" hidden>
        <span class="conv-hint">يُربط بالطلاب بعمود «رقم الهوية» أو «الاسم»، وبقية الأعمدة تصير حقولاً للاختيار والفلترة.</span>
      </div>
      ${staged && staged.mode === "fill" ? fillCard() : ""}
      ${staged && staged.mode !== "fill" ? `<div class="rep-staged">
        <b>${esc(staged.name)}</b> — ${countOf(staged.rows.length, "صفوف", "صفاً", "صف", "صفان")}، ${countOf(staged.fields.length, "حقول", "حقلاً", "حقل", "حقلان")}، المطابقة بـ${esc(staged.matchedBy)}.
        <span class="${staged.hits ? "" : "rep-warn"}">${staged.hits ? `طابق ${countOf(staged.hits, "طلاب", "طالباً", "طالب", "طالبان")} من اللقطة` : "لم يطابق أي طالب في اللقطة الحالية"}</span>
        <div class="rep-chips">${staged.fields.map((c) => `<span class="rep-chip">${esc(c)}</span>`).join("")}</div>
        <div class="btn-row"><button type="button" class="btn" id="rep-save-import">حفظ على الخادم</button>
        <button type="button" class="btn secondary" id="rep-cancel-import">إلغاء</button></div>
      </div>` : ""}
      ${list ? `<ul class="rep-import-list">${list}</ul>` : `<p class="conv-hint">لا توجد جداول مستوردة بعد.</p>`}`;
  }

  /* ===== تعبئة نموذج رسمي من بيانات النظام =====
     ترفع النموذج فارغاً، فنقابل كل عنوان عمود فيه بحقل من حقول النظام،
     ثم نكتب الصفوف تحته ونعيد الملف كما هو بتنسيقه وترويسته. */
  const FILL_KEY = "tamkeen-admin:report-fill-maps";
  const INDEX = "__index";     // عمود الترقيم
  const CONST = "__const";     // قيمة ثابتة يكتبها المستخدم

  /* مرادفات عناوين النماذج الرسمية لحقولنا */
  const SYNONYMS = [
    [/^(م|مسلسل|تسلسل|رقم)$/, INDEX],
    [/اسم.*(متدرب|طالب|خريج|مستفيد)|^الاسم/, "name"],
    [/هوية|الهويه|رقم.?وطني/, "nid"],
    [/جوال|هاتف|موبايل/, "phone"],
    [/^المعدل$|الدرجة الكلية|^المجموع$/, "total"],
    [/^التقدير$|^النتيجة$|^الحالة$/, "gradeStatus"],
    [/اسم (الدورة|البرنامج)|^الدورة$/, "track"],
    [/^المسار$/, "track"],
    [/^المرحلة$/, "course"],
    [/رقم الدورة|رمز الدورة/, CRS + "رمز الدورة"],
    [/بداية (الدورة|التدريب)|تاريخ البدء|من تاريخ/, CRS + "بداية الدورة"],
    [/نهاية (الدورة|التدريب)|تاريخ الانتهاء|إلى تاريخ|الى تاريخ/, CRS + "نهاية الدورة"],
    [/نوع التدريب|^النوع$/, CRS + "نوع التدريب"],
    [/مدرب/, "trainer"],
    [/^الجنس$|^النوع$/, "gender"],
    [/محافظة/, "governorate"],
    [/^المجموعة$/, "group"],
    [/نسبة الحضور|^الحضور$/, "attendance"],
  ];

  function autoMap(cols) {
    const fields = all();
    const byLabel = new Map(fields.map((f) => [norm(f.label), f.key]));
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(FILL_KEY) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    return cols.map((c) => {
      const n = norm(c);
      if (byLabel.has(n)) return { col: c, key: byLabel.get(n), value: "" };
      for (const [re, key] of SYNONYMS) if (re.test(c)) return { col: c, key, value: "" };
      // عنوان يحتوي اسم حقل أو العكس (الحقول القادمة من النظام تطابق غالباً بالاسم)
      const near = fields.find((f) => norm(f.label).length > 3 && (n.includes(norm(f.label)) || norm(f.label).includes(n)));
      return { col: c, key: near ? near.key : "", value: "" };
    }).map((m, i) => {
      const keep = (saved[staged && staged.name] || {})[i];
      return keep ? { ...m, ...keep } : m;
    });
  }

  function saveMap() {
    if (!staged || staged.mode !== "fill") return;
    try {
      const all = JSON.parse(localStorage.getItem(FILL_KEY) || "{}");
      all[staged.name] = Object.fromEntries(staged.map.map((m, i) => [i, { key: m.key, value: m.value }]));
      localStorage.setItem(FILL_KEY, JSON.stringify(all));
    } catch (e) { /* تخزين ممتلئ */ }
  }

  const valueFor = (row, m, i) => {
    if (m.key === INDEX) return i + 1;
    if (m.key === CONST) return m.value || "";
    if (!m.key) return "";
    const v = row[m.key];
    return v == null ? "" : v;
  };

  async function fillTemplate() {
    const list = rows();
    if (!list.length) { ui.toast("لا توجد سجلات لتعبئتها — راجع الفلاتر"); return; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(staged.buf);
    const ws = wb.worksheets[0];
    const start = staged.headRow + 1;
    // نمط الصف الأول تحت الترويسة (حدود وتوسيط النموذج) يُنسخ على بقية الصفوف
    const style = [];
    const first = ws.getRow(start);
    staged.map.forEach((m, c) => { style[c] = first.getCell(c + 1).style; });
    list.forEach((row, i) => {
      const r = ws.getRow(start + i);
      staged.map.forEach((m, c) => {
        const cell = r.getCell(c + 1);
        cell.value = valueFor(row, m, i);
        if (style[c]) cell.style = { ...style[c] };
      });
      r.commit && r.commit();
    });
    const buf = await wb.xlsx.writeBuffer();
    ui.download(`${staged.name} - معبّأ.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    ui.toast(`عُبّئ ${countOf(list.length, "صفوف", "صفاً", "صف", "صفان")}`);
    saveMap();
  }

  function fillCard() {
    const fields = all();
    const opt = (m) => `<option value="">— فارغ —</option>
      <option value="${INDEX}" ${m.key === INDEX ? "selected" : ""}>ترقيم تسلسلي</option>
      <option value="${CONST}" ${m.key === CONST ? "selected" : ""}>قيمة ثابتة</option>
      ${fields.map((f) => `<option value="${esc(f.key)}" ${m.key === f.key ? "selected" : ""}>${esc(f.label)}</option>`).join("")}`;
    const done = staged.map.filter((m) => m.key).length;
    // المرحلة التي يخصّها هذا النموذج: اختيارها هنا أوضح من البحث عنها بين الفلاتر
    const phases = [...new Set(students().map((r) => String(r.course || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
    const phasePick = phases.length ? `<label class="sc-f rep-phase"><span>المرحلة التي يخصّها النموذج</span>
        <select id="rep-fill-phase"><option value="">كل المراحل</option>
        ${phases.map((p) => `<option ${filters.course === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>` : "";
    return `<div class="rep-staged">
      <b>${esc(staged.name)}</b> — نموذج بلا بيانات، أعبّئه لك من بيانات النظام.
      قابلتُ ${countOf(done, "أعمدة", "عموداً", "عموداً واحداً", "عمودين")} من ${countOf(staged.map.length, "أعمدة", "عموداً", "عموداً واحداً", "عمودين")}؛ راجع المقابلة وغيّر ما يلزم.
      <table class="rep-map"><thead><tr><th>عمود النموذج</th><th>يُملأ من</th></tr></thead><tbody>
      ${staged.map.map((m, i) => `<tr><td>${esc(m.col)}</td><td>
        <select data-map="${i}">${opt(m)}</select>
        ${m.key === CONST ? `<input type="text" data-const="${i}" value="${esc(m.value)}" placeholder="اكتب القيمة">` : ""}
      </td></tr>`).join("")}
      </tbody></table>
      ${phasePick}
      <div class="btn-row"><button type="button" class="btn" id="rep-fill">⬇ نزّل النموذج معبّأً (${countOf(rows().length, "صفوف", "صفاً", "صف واحد", "صفان")})</button>
      <button type="button" class="btn secondary" id="rep-cancel-import">إلغاء</button></div>
      <p class="conv-hint">يُعبّأ بما يظهر في التقرير الآن: المرحلة أعلاه وبقية الفلاتر تسري عليه.</p>
    </div>`;
  }

  async function saveImport() {
    if (!staged) return;
    try {
      const r = await App.cloud.putImport(staged.name, staged.fields, staged.rows);
      if (r.error) throw new Error(r.error);
      staged = null;
      await loadImports();
      render();
      ui.toast("حُفظ الجدول — حقوله صارت متاحة للجميع");
    } catch (e) { ui.toast(e.message); }
  }

  async function dropImport(name) {
    if (!confirm(`حذف الجدول «${name}» وحقوله من التقارير؟`)) return;
    try {
      await App.cloud.dropImport(name);
      picked = picked.filter((k) => !k.startsWith(`${EX}${name}:`));
      save();
      await loadImports();
      render();
      ui.toast("حُذف الجدول");
    } catch (e) { ui.toast(e.message); }
  }

  /* ===== التصدير والطباعة ===== */
  async function toExcel() {
    const list = shownRows();
    if (!list.length) { ui.toast("لا توجد سجلات"); return; }
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("تقرير", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    if (groupBy) {
      ws.columns = [{ header: labelOf(groupBy), key: "k", width: 30 }, { header: "العدد", key: "n", width: 12 }, { header: "النسبة", key: "p", width: 12 }];
      const map = new Map();
      list.forEach((r) => { const k = String(r[groupBy] || "").trim() || "— بلا قيمة —"; map.set(k, (map.get(k) || 0) + 1); });
      [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => ws.addRow({ k, n, p: Math.round((n / list.length) * 100) + "%" }));
    } else {
      ws.columns = picked.map((k) => ({ header: labelOf(k), key: k, width: k === "name" ? 28 : k === "track" ? 30 : 16 }));
      list.forEach((r) => ws.addRow(picked.reduce((o, k) => Object.assign(o, { [k]: r[k] == null ? "" : r[k] }), {})));
    }
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2332" } };
    const buf = await wb.xlsx.writeBuffer();
    const tag = Object.values(filters).filter(Boolean).join(" - ");
    ui.download(`تقرير المركز${tag ? " - " + tag : ""}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    ui.toast(`صُدّر ${ui.fmt(list.length)} سجلاً`);
  }

  function print() {
    const list = shownRows();
    if (!list.length) { ui.toast("لا توجد سجلات"); return; }
    const head = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${labelOf(k)}: ${v}`).join(" · ");
    const body = groupBy ? summary(list) : table(list);
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير المركز</title>
      <style>@page{size:A4 landscape;margin:10mm}
        body{font-family:Tahoma,Arial;margin:14px;color:#1e2633}
        h1{font-size:15pt;background:#1a2332;color:#fff;padding:8px;border-radius:6px;margin:0 0 6px}
        p.meta{font-size:9pt;color:#626d7d;margin:0 0 10px}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}
        th,td{border:1px solid #c9ced6;padding:3px 5px;text-align:center}
        th{background:#eff0f3}
        .rep-total td{font-weight:bold;background:#f5f7fb}
        .conv-hint{display:none}
      </style></head><body>
      <h1>تقرير بيانات المركز</h1>
      <p class="meta">${esc(head || "كل السجلات")} — ${ui.fmt(list.length)} سجلاً — ${esc(new Date().toLocaleString("ar-EG"))}</p>
      ${body}
      </body></html>`;
    const w = window.open("", "_blank", "width=1100,height=800");
    if (w && w.document) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); return; }
    const back = document.createElement("div");
    back.className = "modal-backdrop open sc-sheet";
    back.innerHTML = `<div class="modal sc-sheet-box"><div class="modal-head"><b>تقرير المركز</b>
        <span class="btn-row"><button type="button" class="btn small" data-print>🖨 طباعة</button>
        <button type="button" class="btn small secondary" data-close>إغلاق</button></span></div>
      <iframe class="sc-sheet-frame" title="تقرير"></iframe></div>`;
    document.body.append(back);
    const frame = back.querySelector("iframe");
    frame.srcdoc = html;
    back.querySelector("[data-close]").addEventListener("click", () => back.remove());
    back.querySelector("[data-print]").addEventListener("click", () => { frame.contentWindow.focus(); frame.contentWindow.print(); });
  }

  /* ===== الأحداث ===== */
  function init() {
    if (!$("rep-body")) return;
    $("rep-fields").addEventListener("change", (e) => {
      const b = e.target.closest("[data-field]");
      if (!b) return;
      const k = b.dataset.field;
      picked = b.checked ? [...new Set([...picked, k])] : picked.filter((x) => x !== k);
      order();
      save();
      render();
    });
    $("rep-fields").addEventListener("click", (e) => {
      const all = e.target.closest("[data-all]"), none = e.target.closest("[data-none]");
      const g = groups().find((x) => x.name === ((all && all.dataset.all) || (none && none.dataset.none)));
      if (!g) return;
      const keys = g.fields.map((f) => f.key);
      picked = all ? [...new Set([...picked, ...keys])] : picked.filter((k) => !keys.includes(k));
      order();
      save();
      render();
    });
    $("rep-filters").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-filter]");
      if (sel) { filters[sel.dataset.filter] = sel.value; save(); render(); return; }
      if (e.target.id === "rep-group-by") { groupBy = e.target.value; save(); render(); }
    });
    let typing = null;
    $("rep-filters").addEventListener("input", (e) => {
      if (e.target.id !== "rep-search") return;
      const v = e.target.value;
      clearTimeout(typing);
      typing = setTimeout(() => {
        search = v;
        render();
        const q = $("rep-search");
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }, 300);
    });
    $("rep-body").addEventListener("click", (e) => { if (e.target.closest("#rep-pull")) pull(true); });
    $("rep-imports").addEventListener("change", async (e) => {
      if (e.target.id === "rep-fill-phase") { filters.course = e.target.value; save(); render(); return; }
      const m = e.target.closest("[data-map]");
      if (m && staged && staged.map) {
        staged.map[Number(m.dataset.map)].key = m.value;
        saveMap();
        renderImports();
        return;
      }
      const f = e.target.id === "rep-file" && e.target.files && e.target.files[0];
      if (!f) return;
      try { staged = await readFile(f); } catch (err) { staged = null; ui.toast(err.message); }
      e.target.value = "";
      renderImports();
    });
    $("rep-imports").addEventListener("click", (e) => {
      const drop = e.target.closest("[data-drop]");
      if (drop) { dropImport(drop.dataset.drop); return; }
      if (e.target.closest("#rep-save-import")) saveImport();
      if (e.target.closest("#rep-fill")) fillTemplate();
      if (e.target.closest("#rep-cancel-import")) { staged = null; renderImports(); }
    });
    $("rep-imports").addEventListener("input", (e) => {
      const k = e.target.closest("[data-const]");
      if (k && staged && staged.map) staged.map[Number(k.dataset.const)].value = e.target.value;
    });
    $("rep-meta").addEventListener("click", (e) => {
      if (e.target.closest("#rep-show-blank")) { hideBlank = false; save(); render(); }
      if (e.target.closest("#rep-hide-blank")) { hideBlank = true; save(); render(); }
    });
    $("rep-clear").addEventListener("click", () => { filters = {}; search = ""; groupBy = ""; hideBlank = true; save(); render(); });
    $("rep-excel").addEventListener("click", toExcel);
    $("rep-print").addEventListener("click", print);
  }

  App.reports = { init, render: () => { render(); pull(false); loadImports(true).then(render); } };
})(window.App = window.App || {});
