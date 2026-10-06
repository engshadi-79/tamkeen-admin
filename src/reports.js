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
        { key: "cert", label: "رقم الشهادة" },
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

  /* ===== المعدل والتقدير بالبرمجة نفسها التي في محوّل كشوف الدرجات =====
     السلّم هناك هو المعتمد (٩٠ ممتاز، ٨٠ جيد جداً، ٧٥ جيد، دون ذلك راسب)، فنستدعي دالته
     نفسها لا نسخة منها، حتى لا يفترق الكشف عن التقرير يوماً. */
  const CALC = "calc:";
  const CALC_FIELDS = [{ key: CALC + "المعدل", label: "المعدل" }, { key: CALC + "التقدير", label: "التقدير" }];
  const calcGroup = () => [{ name: "المعدل والتقدير (كما في محوّل الكشوف)", fields: CALC_FIELDS.map((f) => ({ key: f.key, label: f.label })) }];

  const AVG_KEY = "tamkeen-admin:report-avg";
  let avgFrom = "", avgOutOf = 0;   // صفر: لم يُختر بعد، فيُقترح من البيانات
  try {
    const v = JSON.parse(localStorage.getItem(AVG_KEY) || "null");
    if (v) { avgFrom = v.from || ""; avgOutOf = Number(v.outOf) || 0; }
  } catch (e) { /* تخزين غير متاح */ }
  const saveAvg = () => { try { localStorage.setItem(AVG_KEY, JSON.stringify({ from: avgFrom, outOf: avgOutOf })); } catch (e) { /* ممتلئ */ } };

  const numOf = (v) => {
    if (v == null || v === "") return null;
    const t = String(v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[٫,]/g, ".").replace(/[%٪\s]/g, "");
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };

  /* مصدر المعدل: عمود اسمه «معدل» أو «النسبة» إن وُجد، وإلا «المجموع» */
  function guessAvg(list) {
    const fields = all();
    const named = fields.find((f) => /معدل|^النسبة$/.test(norm(f.label)));
    if (named && list.some((r) => numOf(r[named.key]) != null)) return named.key;
    return list.some((r) => numOf(r.total) != null) ? "total" : "";
  }

  /* المجموع قد يكون من ١٠٠ أو من ٢٠٠: نقترح الأصل من أكبر قيمة ونتركه قابلاً للتغيير */
  function guessOutOf(list, key) {
    const nums = list.map((r) => numOf(r[key])).filter((n) => n != null);
    if (!nums.length) return 100;
    const max = Math.max(...nums);
    if (max <= 1) return 1;            // نسب عشرية (0.86)
    if (max <= 100) return 100;
    return [110, 120, 150, 200, 250, 300, 400, 500, 1000].find((n) => max <= n) || Math.ceil(max / 50) * 50;
  }

  function withGrades(list) {
    if (!avgFrom) avgFrom = guessAvg(list);
    if (!avgFrom) return;
    if (!avgOutOf) { avgOutOf = guessOutOf(list, avgFrom); saveAvg(); }
    const grade = (App.converterCore && App.converterCore.gradeOf) || (() => "");
    list.forEach((r) => {
      const n = numOf(r[avgFrom]);
      if (n == null) return;
      const pct = Math.round((n * 100 / (avgOutOf || 100)) * 10) / 10;
      r[CALC + "المعدل"] = pct;
      r[CALC + "التقدير"] = grade(pct, false);
    });
  }

  /* بيانات الدورة التي يكتبها الموظف في «المسارات والرموز» (التواريخ والنوع والرمز):
     النظام الرسمي لا يعرفها، فتُكتب مرة لكل دورة وتلتصق هنا بكل طالب فيها. */
  const CRS = "crs:";
  const CRS_FIELDS = [
    { key: CRS + "رمز الدورة", pick: (r) => r.code },
    { key: CRS + "بداية الدورة", pick: (r) => r.start },
    { key: CRS + "نهاية الدورة", pick: (r) => r.end },
    { key: CRS + "نوع التدريب", pick: (r) => r.type },
  ];
  /* لكل مسار مدرّبان مسجّلان في «متابعة المسارات»: العمودان في النموذج الرسمي
     («اسم المدرب 1» و«اسم المدرب 2») يأخذ كلٌّ منهما مدرّبه لا المدرّب نفسه مرتين. */
  const TRK = "trk:";
  const TRK_FIELDS = [
    { key: TRK + "المدرب الأول", pick: (t) => t.trainer1 },
    { key: TRK + "المدرب الثاني", pick: (t) => t.trainer2 },
  ];
  const crsGroup = () => [{ name: "بيانات الدورة (من المسارات والرموز)",
    fields: CRS_FIELDS.map((f) => ({ key: f.key, label: f.key.slice(CRS.length) }))
      .concat(TRK_FIELDS.map((f) => ({ key: f.key, label: f.key.slice(TRK.length) }))) }];

  /* المطابقة بنفس دالة المحوّل (تطابق تام ثم احتواء)، فلا يفترق الكشف عن التقرير */
  function trackOf(row) {
    const tracks = (App.store && App.store.get().tracks) || [];
    if (!tracks.length) return null;
    const find = App.converterCore && App.converterCore.findTrack;
    if (find) return find(tracks, row.track);
    const k = norm(String(row.track || "").replace(/^مسار\s*/, ""));
    return tracks.find((t) => { const n = norm(String(t.name || "").replace(/^مسار\s*/, "")); return n && (n === k || n.includes(k) || k.includes(n)); }) || null;
  }

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

  /* ===== بيانات تكميلية تُكتب داخل تمكين =====
     نظام المركز لا يعرض تاريخ الميلاد ولا المستوى التعليمي ولا التخصص، وكشف الإكسل
     يحتاج تحديثاً يدوياً كل مرة. فتُكتب هنا مرة لكل طالب وتبقى، وتندمج مع كل لقطة جديدة. */
  const MAN = "man:";
  const MAN_FIELDS = ["تاريخ الميلاد", "المستوى التعليمي", "التخصص", "التجمع السكاني", "الجوال", "الجنس", "المحافظة"];
  const extraRows = () => { const v = (App.store && App.store.get().studentExtra) || []; return Array.isArray(v) ? v : []; };
  const manFields = () => {
    const seen = new Set();
    extraRows().forEach((r) => Object.keys((r && r.values) || {}).forEach((k) => { if (String(r.values[k] || "").trim()) seen.add(k); }));
    seen.delete("رقم الشهادة");   // تُدمج في حقل «رقم الشهادة» الواحد
    return [...seen];
  };
  const manGroup = () => (manFields().length
    ? [{ name: "بيانات تكميلية (مكتوبة في تمكين)", fields: manFields().map((k) => ({ key: MAN + k, label: k })) }]
    : []);

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
  const groups = () => GROUPS.concat(sysGroup(), crsGroup(), calcGroup(), manGroup(), exGroups());
  const all = () => groups().flatMap((g) => g.fields);
  const labelOf = (k) => (all().find((f) => f.key === k) || {}).label || String(k).replace(/^x:[^:]*:/, "").replace(/^(sys|crs|calc|trk|man):/, "");

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
    CRS_FIELDS.concat(TRK_FIELDS).forEach((f) => { if (few(f.key)) out.push(f.key); });
    manFields().forEach((k) => { if (few(MAN + k)) out.push(MAN + k); });
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
      picked = saved.picked.filter((k) => ALL.some((f) => f.key === k) || /^(x|sys|crs|calc|trk|man):/.test(String(k)));
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
    const trk = ((App.store && App.store.get().tracks) || []).map((t) => `${t.name}${t.trainer1}${t.trainer2}`).join("|");
    const man = extraRows().length + ":" + extraRows().reduce((a, r) => a + Object.keys(r.values || {}).length, 0);
    if (!extras.length && !codes.length && !trk && !extraRows().length) { const copy = list.map((r) => ({ ...r })); withGrades(copy); return copy; }
    const stamp = `${list.length}|${extras.map((t) => t.name + ":" + t.count).join(",")}|${codes.length}:${codes.map((c) => c.start + c.end + c.type).join("").length}|${avgFrom}:${avgOutOf}|${trk.length}|${man}`;
    if (merged && mergedFor === stamp) return merged;
    const out = list.map((r) => ({ ...r }));
    const byId = new Map(), byName = new Map();
    out.forEach((r) => {
      const id = idOf(r.nid);
      if (id) byId.set(id, r);
      const n = norm(r.name);
      if (n && !byName.has(n)) byName.set(n, r);
    });
    // بيانات الدورة من دليل الترميز، ومدربا المسار من صفحة المسارات
    out.forEach((r) => {
      const c = courseOf(r);
      if (c) CRS_FIELDS.forEach((f) => { const v = f.pick(c); if (v) r[f.key] = v; });
      const t = trackOf(r);
      if (t) TRK_FIELDS.forEach((f) => { const v = f.pick(t); if (v) r[f.key] = v; });
    });
    // رقم الشهادة حقل واحد لا حقلان: ما يصدره المركز هو الأصل، والمولَّد هنا بديلٌ
    // لمن لم يصدر له بعد. فلا يطغى مولَّدٌ على رسميٍّ لأنه أكثر عدداً.
    // البيانات التكميلية المكتوبة هنا
    const byKey = new Map();
    extraRows().forEach((r) => { if (r && r.id) byKey.set(String(r.id), r); });
    out.forEach((r) => {
      const rec = byKey.get(idOf(r.nid)) || byKey.get("n:" + norm(r.name));
      if (!rec) return;
      Object.entries(rec.values || {}).forEach(([k, v]) => { if (String(v || "").trim()) r[MAN + k] = v; });
    });
    out.forEach((r) => {
      if (String(r.cert || "").trim()) { r.certFrom = "system"; return; }
      if (r[MAN + CERT]) { r.cert = r[MAN + CERT]; r.certFrom = "tamkeen"; }
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
    withGrades(out);
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

  /* ===== تقارير محفوظة =====
     اختيار الحقول والفلاتر والتجميع ومصدر المعدل يُحفظ باسم في قسم مُزامَن،
     فيفتحه بقية المستخدمين من أجهزتهم كما حفظته. */
  const presets = () => { const v = (App.store && App.store.get().reportPresets) || []; return Array.isArray(v) ? v : []; };
  let presetId = "";

  function renderPresets() {
    const sel = $("rep-preset");
    if (!sel) return;
    const list = presets().filter((p) => p && p.id && !p.deletedAt).sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
    sel.innerHTML = `<option value="">— تقرير جديد —</option>`
      + list.map((p) => `<option value="${esc(p.id)}" ${presetId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const cur = list.find((p) => p.id === presetId);
    $("rep-preset-del").hidden = !cur;
    const note = $("rep-preset-note");
    if (note) note.textContent = cur ? `حفظه ${cur.owner || "—"}${cur.updatedAt ? ` · ${new Date(cur.updatedAt).toLocaleDateString("ar-EG")}` : ""}` : "";
    const name = $("rep-preset-name");
    if (name && cur && !name.value) name.value = cur.name;
  }

  function applyPreset(id) {
    presetId = id;
    const p = presets().find((x) => x.id === id);
    if (p) {
      picked = Array.isArray(p.picked) ? [...p.picked] : picked;
      filters = { ...(p.filters || {}) };
      groupBy = p.groupBy || "";
      hideBlank = p.hideBlank !== false;
      if (p.avgFrom !== undefined) { avgFrom = p.avgFrom; avgOutOf = Number(p.avgOutOf) || 0; merged = null; saveAvg(); }
      search = "";
      order();
      save();
      const name = $("rep-preset-name");
      if (name) name.value = p.name;
    }
    render();
  }

  function savePreset() {
    const field = $("rep-preset-name");
    const name = String(field.value || "").trim();
    if (!name) { ui.toast("اكتب اسماً للتقرير"); field.focus(); return; }
    if (!picked.length) { ui.toast("اختر حقلاً واحداً على الأقل قبل الحفظ"); return; }
    const list = presets();
    const me = (App.cloud && App.cloud.user && App.cloud.user()) || {};
    const now = new Date().toISOString();
    const same = list.find((p) => p && !p.deletedAt && norm(p.name) === norm(name));
    const rec = {
      id: (same && same.id) || (App.store.uid ? App.store.uid() : String(Date.now())),
      name, picked: [...picked], filters: { ...filters }, groupBy, hideBlank, avgFrom, avgOutOf,
      owner: (same && same.owner) || me.name || "", createdAt: (same && same.createdAt) || now, updatedAt: now,
    };
    const next = same ? list.map((p) => (p.id === rec.id ? rec : p)) : [...list, rec];
    App.store.get().reportPresets = next;
    App.store.save();
    presetId = rec.id;
    render();
    ui.toast(same ? "حُدِّث التقرير المحفوظ" : "حُفظ التقرير");
  }

  function dropPreset() {
    const p = presets().find((x) => x.id === presetId);
    if (!p) return;
    if (!confirm(`حذف التقرير المحفوظ «${p.name}»؟`)) return;
    App.store.get().reportPresets = presets().map((x) => (x.id === p.id ? { ...x, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : x));
    App.store.save();
    presetId = "";
    $("rep-preset-name").value = "";
    render();
    ui.toast("حُذف التقرير المحفوظ");
  }

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

  /* ماذا قرأ السكربت فعلاً من نظام المركز: صفحة صفحة، بأعمدتها وعدد صفوفها.
     حقل فارغ في النموذج سببه صفحة لم تُقرأ أو عمود لم يظهر، وهذا يكشفه. */
  function readLogCard() {
    const s = snap();
    const log = s && s.data && s.data.readLog;
    if (!log) return `<p class="conv-hint">اللقطة الحالية من نسخة قديمة من سكربت القراءة، فلا تحمل سجلّ ما قُرئ. أعد تشغيل السكربت لتراه هنا.</p>`;
    const keys = Object.keys(log);
    if (!keys.length) return `<p class="conv-hint">لم يُقرأ شيء في آخر جولة.</p>`;
    return `<table class="rep-map"><thead><tr><th>الصفحة</th><th>صفوف</th><th>الأعمدة التي قرأها</th></tr></thead><tbody>
      ${keys.map((k) => {
        const e = log[k] || {};
        const bad = e.error || !e.rows;
        return `<tr><td>${esc(k)}<div class="conv-hint" dir="ltr">${esc(e.path || "")}</div></td>
          <td class="${bad ? "rep-warn" : "rep-full"}">${e.error ? "✖" : ui.fmt(e.rows || 0)}</td>
          <td>${e.error ? `<span class="rep-warn">${esc(e.error)}</span>${(e.seen || []).map((x) => `<div class="conv-hint">${esc(x)}</div>`).join("")}`
            : esc((e.cols || []).join(" · "))}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  /* مصدر المعدل ظاهر وقابل للتغيير، كما هو في صفحة المحوّل، لا يجري بصمت */
  function renderCalc() {
    const box = $("rep-calc");
    if (!box) return;
    const list = base();
    if (!list.length) { box.innerHTML = ""; return; }
    const fields = all().filter((f) => !f.key.startsWith(CALC) && list.some((r) => numOf(r[f.key]) != null));
    const graded = students().filter((r) => r[CALC + "التقدير"]).length;
    box.innerHTML = `<label class="sc-f"><span>المعدل يُحسب من</span>
        <select id="rep-avg-from"><option value="">— لا شيء —</option>
        ${fields.map((f) => `<option value="${esc(f.key)}" ${avgFrom === f.key ? "selected" : ""}>${esc(f.label)}</option>`).join("")}</select></label>
      <label class="sc-f" style="width:120px"><span>من أصل</span><input type="number" id="rep-avg-out" min="1" step="1" value="${esc(avgOutOf)}"></label>
      <span class="conv-hint">${avgFrom
        ? `حُسب التقدير لـ <b>${ui.fmt(graded)}</b> من ${ui.fmt(list.length)} — بسلّم كشوف الدرجات نفسه: ٩٠ فأكثر ممتاز، ٨٠–٨٩ جيد جداً، ٧٥–٧٩ جيد، دون ٧٥ راسب.`
        : "اختر الحقل الذي يحمل درجة الطالب ليُحسب المعدل والتقدير."}</span>`;
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
          .concat(filterFields(list).filter((k) => k.startsWith(EX) || k.startsWith(SYS) || k.startsWith(CRS) || k.startsWith(TRK) || k.startsWith(MAN)))
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

  const TAB_KEY = "tamkeen-admin:report-tab";
  let tab = "report";
  try { tab = localStorage.getItem(TAB_KEY) || "report"; } catch (e) { /* تخزين غير متاح */ }

  function showTab(name) {
    tab = name;
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* ممتلئ */ }
    ["report", "form", "sources"].forEach((t) => {
      const pane = $(`rep-pane-${t}`);
      if (pane) pane.hidden = t !== name;
    });
    document.querySelectorAll("#rep-tabs [data-rep-tab]").forEach((b) => b.classList.toggle("active", b.dataset.repTab === name));
    if (name !== "sources") diagOpen = false;
    render();
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
    renderCalc();
    renderPresets();
    renderFilters();
    renderForm();
    renderSources();
    const sum = $("rep-pick-sum");
    if (sum) sum.textContent = picked.length ? `${countOf(picked.length, "حقول", "حقلاً", "حقل", "حقلان")}: ${picked.map(labelOf).slice(0, 4).join("، ")}${picked.length > 4 ? "…" : ""}` : "لم تختر حقلاً بعد";
    const diagBox = $("rep-diag-body");
    if (diagBox) diagBox.innerHTML = diagOpen ? diagCard() : "";
    $("rep-body").innerHTML = !students().length
      ? `<section class="card sc-empty"><h3>لا توجد بيانات طلاب بعد</h3>
          <p>هذه الصفحة تعرض بيانات نظام المركز التي يجلبها سكربت القراءة. افتح «شاشة إحصاءات المركز» واضغط «▶ تشغيل القراءة في النظام»، وبعد «أُرسلت ✔» عُد إلى هنا.</p>
          <p class="conv-hint">${s && s.at ? `آخر لقطة وصلت ${esc(new Date(s.at).toLocaleString("ar-EG"))} وليس فيها جدول طلاب — هذا يعني أن السكربت المُشغَّل نسخة قديمة. أعد تشغيله من زر «▶ تشغيل القراءة في النظام» ليأخذ النسخة الجديدة.` : "لم تصل أي لقطة إلى الخادم بعد."}</p>
          <div class="btn-row"><button type="button" class="btn" id="rep-pull"><span class="material-symbols-outlined btn-ico">refresh</span>اسحب آخر لقطة</button></div></section>`
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
  const MAX_IMPORT = 1_500_000;   // سقف الخادم للجدول الواحد

  /* الملف الشامل قد يوزّع دوراته على أوراق: نأخذ الورقة الأغنى بالبيانات لا أولاها */
  function bestSheet(wb) {
    let best = null, bestRows = -1, bestName = "";
    wb.worksheets.forEach((ws) => {
      let grid;
      try { grid = sheetRows(ws); } catch (e) { return; }
      let read;
      try { read = readGrid(grid); } catch (e) { return; }
      const n = read.mode === "fill" ? 0 : read.rows.length;
      if (n > bestRows) { bestRows = n; best = read; bestName = ws.name; }
    });
    if (!best) throw new Error("لم أجد في الملف ورقة فيها جدول");
    best.sheet = bestName;
    return best;
  }

  async function readFile(file) {
    if (typeof ExcelJS === "undefined") throw new Error("تعذّر تحميل مكتبة Excel");
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    if (!wb.worksheets.length) throw new Error("الملف لا يحتوي ورقة بيانات");
    const out = wb.worksheets.length === 1 ? readGrid(sheetRows(wb.worksheets[0])) : bestSheet(wb);
    out.name = file.name.replace(/\.(xlsx|xlsm|xls)$/i, "").trim().slice(0, 80) || "جدول";
    if (out.mode === "fill") {
      out.buf = buf;
      out.map = autoMap(out.cols);
      return out;
    }
    // عمود لا قيمة فيه لأي صف لا يُرفع: يثقل الجدول ويزحم قائمة الحقول
    const empty = out.fields.filter((c) => !out.rows.some((r) => String(r[c] == null ? "" : r[c]).trim() !== ""));
    if (empty.length) {
      out.dropped = empty;
      out.fields = out.fields.filter((c) => !empty.includes(c));
      out.rows.forEach((r) => empty.forEach((c) => delete r[c]));
    }
    if (!out.fields.length) throw new Error("كل أعمدة الملف فارغة عدا الاسم والهوية");
    // كم صفاً منها سيجد طالباً؟ وكم حجمه؟ نقولهما قبل الرفع لا بعد الرفض
    const list = base();
    const ids = new Set(list.map((r) => idOf(r.nid)).filter(Boolean));
    const names = new Set(list.map((r) => norm(r.name)).filter(Boolean));
    out.hits = out.rows.filter((r) => (r._id && ids.has(idOf(r._id))) || (r._name && names.has(norm(r._name)))).length;
    out.bytes = JSON.stringify(out.rows).length;
    if (out.bytes > MAX_IMPORT) {
      const heavy = [...out.fields].map((c) => ({ c, n: out.rows.reduce((a, r) => a + String(r[c] || "").length, 0) }))
        .sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.c).join("، ");
      throw new Error(`الجدول ${(out.bytes / 1048576).toFixed(1)} ميغا والسقف ١٫٥ — احذف من الملف أعمدة لا يحتاجها التقرير (أثقلها: ${heavy}) أو قسّمه إلى ملفين.`);
    }
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
      // «رقم الشهادة» صار حقلاً واحداً (cert)، فاختيارٌ قديم للحقل المنفصل يُستبدل به
      if (picked.includes(MAN + CERT)) picked = [...new Set(picked.filter((k) => k !== MAN + CERT).concat("cert"))];
      const kept = picked.filter((k) => !k.startsWith(EX) || live.has(k));
      if (kept.length !== picked.length) { picked = kept; save(); }
    } catch (e) { if (!quiet) ui.toast(e.message); }
  }

  /* الصفحة ثلاث وظائف: تقرير تبنيه، ونموذج رسمي تعبّئه، ومصادر تغذّيهما.
     فُصلت كلٌّ في تبويبها حتى لا تزدحم الشاشة بما لا يلزم الآن. */
  const uploadRow = (hint) => `<div class="rep-import-row">
      <label class="btn secondary" for="rep-file"><span class="material-symbols-outlined btn-ico">upload</span>اختر ملف إكسل</label>
      <input type="file" id="rep-file" accept=".xlsx,.xlsm" hidden>
      <span class="conv-hint">${hint}</span>
    </div>`;

  function renderForm() {
    const box = $("rep-form");
    if (!box) return;
    box.innerHTML = staged && staged.mode === "fill"
      ? fillCard()
      : `<h3>تعبئة نموذج رسمي</h3>
        <p class="conv-hint">ارفع النموذج <b>فارغاً</b> (عناوينه بلا صفوف)، فأقابل أعمدته بحقول النظام وأعيده إليك معبّأً بتنسيقه كما هو.</p>
        ${uploadRow("نموذج الوزارة مثلاً. إن كان الملف يحمل بيانات فسيُضاف مصدرَ حقول بدل أن يُعبَّأ.")}
        ${staged ? stagedImportCard() : ""}`;
  }

  const stagedImportCard = () => `<div class="rep-staged">
      <b>${esc(staged.name)}</b>${staged.sheet ? ` — ورقة «${esc(staged.sheet)}»` : ""} — ${countOf(staged.rows.length, "صفوف", "صفاً", "صف", "صفان")}، ${countOf(staged.fields.length, "حقول", "حقلاً", "حقل", "حقلان")}، المطابقة بـ${esc(staged.matchedBy)}${staged.bytes ? `، ${(staged.bytes / 1048576).toFixed(2)} ميغا` : ""}.
      ${staged.dropped ? `<div class="conv-hint">تُركت أعمدة فارغة تماماً: ${esc(staged.dropped.join("، "))}</div>` : ""}
      <span class="${staged.hits ? "" : "rep-warn"}">${staged.hits ? `طابق ${countOf(staged.hits, "طلاب", "طالباً", "طالب", "طالبان")} من اللقطة` : "لم يطابق أي طالب في اللقطة الحالية"}</span>
      <div class="rep-chips">${staged.fields.map((c) => `<span class="rep-chip">${esc(c)}</span>`).join("")}</div>
      <div class="btn-row"><button type="button" class="btn" id="rep-save-import">حفظ على الخادم</button>
      <button type="button" class="btn secondary" id="rep-cancel-import">إلغاء</button></div>
    </div>`;

  /* محرّر البيانات التكميلية: يعرض الناقص وحده، لا تسعمئة صف ليس فيها شيء */
  const MAN_KEY = "tamkeen-admin:man-field";
  let manField = "";
  let manPhase = "";
  let manSearch = "";
  const MAN_PAGE = 40;
  try { manField = localStorage.getItem(MAN_KEY) || ""; } catch (e) { /* تخزين غير متاح */ }

  function manMissing() {
    const field = manField || MAN_FIELDS[0];
    const list = students().filter((r) => !manPhase || norm(r.course) === norm(manPhase));
    const q = norm(manSearch);
    const alt = fullestFor(field, list);   // أي مصدر آخر يحمل هذا الحقل؟
    return list.filter((r) => {
      const has = String(r[MAN + field] || "").trim() || (alt && String(r[alt] || "").trim());
      if (has) return false;
      return !q || norm(r.name).includes(q) || idOf(r.nid).includes(q.replace(/\D/g, ""));
    });
  }

  function manCard() {
    if (!students().length) return "";
    const field = manField || MAN_FIELDS[0];
    const missing = manMissing();
    const phases = [...new Set(students().map((r) => String(r.course || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
    const shown = missing.slice(0, MAN_PAGE);
    return `<h4>بيانات تكميلية — ما لا يعرضه نظام المركز</h4>
      <p class="conv-hint">اكتبها مرة لكل طالب فتبقى محفوظة، وتندمج مع كل لقطة جديدة بلا رفع ملف.</p>
      <div class="rep-man-bar">
        <label class="sc-f"><span>الحقل</span><select id="rep-man-field">
          ${MAN_FIELDS.concat(manFields().filter((k) => !MAN_FIELDS.includes(k))).map((k) => `<option ${k === field ? "selected" : ""}>${esc(k)}</option>`).join("")}
        </select></label>
        <label class="sc-f"><span>المرحلة</span><select id="rep-man-phase"><option value="">الكل</option>
          ${phases.map((p) => `<option ${manPhase === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
        <label class="sc-f"><span>بحث</span><input type="search" id="rep-man-search" value="${esc(manSearch)}" placeholder="اسم أو هوية"></label>
        <span class="conv-hint">${missing.length ? `ينقص «${esc(field)}» لـ ${countOf(missing.length, "طلاب", "طالباً", "طالب", "طالبان")}` : `لا ينقص «${esc(field)}» أحداً`}</span>
      </div>
      ${shown.length ? `<table class="rep-map rep-man-table"><thead><tr><th>الطالب</th><th>الهوية</th><th>المرحلة</th><th>${esc(field)}</th></tr></thead>
        <tbody>${shown.map((r) => `<tr>
          <td>${esc(r.name)}</td><td dir="ltr">${esc(r.nid || "")}</td><td>${esc(r.course || "")}</td>
          <td><input type="${/تاريخ/.test(field) ? "date" : "text"}" data-man="${esc(idOf(r.nid) || "n:" + norm(r.name))}" data-man-name="${esc(r.name)}" value=""></td>
        </tr>`).join("")}</tbody></table>
        ${missing.length > shown.length ? `<p class="conv-hint">يُعرض ${ui.fmt(shown.length)} من ${ui.fmt(missing.length)} — املأ هؤلاء واحفظ، فيظهر التالون.</p>` : ""}
        <div class="btn-row"><button type="button" class="btn" id="rep-man-save"><span class="material-symbols-outlined btn-ico">save</span>احفظ المكتوب</button></div>`
        : `<p class="conv-hint">لا شيء ناقص هنا.</p>`}`;
  }

  function saveMan() {
    const field = manField || MAN_FIELDS[0];
    const inputs = [...document.querySelectorAll("[data-man]")].filter((i) => String(i.value || "").trim());
    if (!inputs.length) { ui.toast("لم تكتب شيئاً"); return; }
    const list = extraRows();
    const now = new Date().toISOString();
    const me = (App.cloud && App.cloud.user && App.cloud.user()) || {};
    inputs.forEach((i) => {
      const id = i.dataset.man;
      let rec = list.find((r) => r && String(r.id) === id);
      if (!rec) { rec = { id, name: i.dataset.manName || "", values: {}, createdAt: now }; list.push(rec); }
      rec.values = { ...(rec.values || {}), [field]: String(i.value).trim() };
      rec.by = me.name || rec.by || "";
      rec.updatedAt = now;
    });
    App.store.get().studentExtra = list;
    App.store.save();
    merged = null;
    render();
    ui.toast(`حُفظ «${field}» لـ ${ui.fmt(inputs.length)}`);
  }

  /* ===== أرقام الشهادات =====
     رقم ثابت لكل خريج: رمز دورته ثم تسلسل. يُحفظ مرة فلا يتغيّر بين كشف وآخر،
     ويملأ عمود «رقم الشهادة» في النماذج الرسمية كأي حقل. */
  const CERT = "رقم الشهادة";
  let certPrefix = "";

  const certGiven = () => {
    const m = new Map();
    extraRows().forEach((r) => { const v = ((r && r.values) || {})[CERT]; if (v) m.set(String(r.id), String(v)); });
    return m;
  };

  function certCard() {
    if (!students().length) return "";
    const given = certGiven();
    const list = rows();
    const without = list.filter((r) => !String(r.cert || "").trim());
    const fromSystem = list.filter((r) => r.certFrom === "system").length;
    const sample = list[0] ? (certPrefix || list[0]["crs:رمز الدورة"] || list[0].course || "CERT") + "-001" : "";
    const sheet = (certAll ? students() : list).filter((r) => String(r.cert || "").trim());
    const sheetTracks = new Set(sheet.map((r) => r.track || "—")).size;
    return `<h4>أرقام الشهادات</h4>
      <p class="conv-hint">أرقام نظام المركز (صفحة الشهادات) تُقرأ تلقائياً وهي الأصل؛ والتوليد هنا لمن لم يصدر له النظام رقماً بعد.</p>
      ${fromSystem ? "" : `<p class="conv-hint rep-warn">لم يصل أي رقم من نظام المركز في هذه اللقطة. أعد تشغيل سكربت القراءة (النسخة الجديدة تقرأ صفحة الشهادات)، وراجع «🩺 تشخيص البيانات» ← سطر «الشهادات».</p>`}
      <div class="rep-man-bar">
        <label class="sc-f"><span>البادئة (فارغة = رمز الدورة)</span><input type="text" id="rep-cert-prefix" value="${esc(certPrefix)}" placeholder="رمز الدورة"></label>
        <span class="conv-hint">${ui.fmt(fromSystem)} من النظام · ${ui.fmt(list.length - fromSystem - without.length)} مولَّدة هنا · ${countOf(without.length, "طلاب", "طالباً", "طالب", "طالبان")} بلا رقم من ${ui.fmt(list.length)} معروض${sample ? ` · مثال: <b dir="ltr">${esc(sample)}</b>` : ""}</span>
        <span class="conv-hint">سيضمّ الكشف ${countOf(sheet.length, "شهادات", "شهادة", "شهادة واحدة", "شهادتين")} من ${countOf(sheetTracks, "مسارات", "مساراً", "مسار واحد", "مسارين")}</span>
        <button type="button" class="btn" id="rep-cert-make" ${without.length ? "" : "disabled"}><span class="material-symbols-outlined btn-ico">school</span>ولّد للمعروضين</button>
        <label class="rep-chip ${certAll ? "on" : ""}"><input type="checkbox" id="rep-cert-all" ${certAll ? "checked" : ""}> كل المسارات (تجاهل الفلاتر)</label>
        <button type="button" class="btn secondary" id="rep-cert-excel"><span class="material-symbols-outlined btn-ico">download</span>كشف الشهادات</button>
        ${given.size ? `<button type="button" class="conv-link danger" id="rep-cert-clear">حذف الأرقام المولَّدة هنا (${ui.fmt(given.size)})</button>` : ""}
      </div>`;
  }

  /* كشف الشهادات: كل من صدرت له شهادة في كل المسارات، لا ما تعرضه الفلاتر وحده.
     ومن أراد مساراً بعينه يزيل علامة «كل المسارات». */
  let certAll = true;

  async function certExcel() {
    const source = certAll ? students() : rows();
    const list = source.map((r) => ({
      track: r.track || "— بلا مسار —",
      course: r.course || "",
      name: r.name || "",
      nid: r.nid || "",
      cert: String(r.cert || "").trim(),
    })).filter((r) => r.cert);
    if (!list.length) { ui.toast("لا توجد أرقام شهادات بعد — اقرأ من النظام أو ولّدها"); return; }
    if (typeof ExcelJS === "undefined") { ui.toast("تعذّر تحميل مكتبة Excel"); return; }
    // مرتّبة بالمسار ثم المرحلة ثم الاسم، فتُقرأ ككشف واحد لكل المركز
    list.sort((a, b) => a.track.localeCompare(b.track, "ar") || a.course.localeCompare(b.course, "ar") || a.name.localeCompare(b.name, "ar"));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("الشهادات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "المسار", key: "track", width: 30 },
      { header: "المرحلة", key: "course", width: 18 },
      { header: "اسم الطالب", key: "name", width: 34 },
      { header: "رقم الهوية", key: "nid", width: 18 },
      { header: "رقم الشهادة", key: "cert", width: 24 },
    ];
    list.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2332" } };
    ws.getColumn(4).alignment = { horizontal: "left" };
    ws.getColumn(5).alignment = { horizontal: "left" };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: 5 } };
    const buf = await wb.xlsx.writeBuffer();
    const tag = certAll ? "" : filters.course ? ` - ${filters.course}` : " - المعروضون";
    ui.download(`كشف الشهادات${tag}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const tracks = new Set(list.map((r) => r.track)).size;
    const missing = source.length - list.length;
    ui.toast(`صُدّر ${countOf(list.length, "شهادات", "شهادة", "شهادة واحدة", "شهادتان")} من ${countOf(tracks, "مسارات", "مساراً", "مسار واحد", "مسارين")}${missing ? ` · ${ui.fmt(missing)} بلا رقم لم تُدرج` : ""}`);
  }

  /* من ولّد أرقاماً ثم وصلته أرقام المركز: يمسح المولَّدة فتبقى الرسمية وحدها */
  function clearCerts() {
    const given = certGiven();
    if (!given.size) return;
    if (!confirm(`حذف ${given.size} رقم شهادة مولَّداً في تمكين؟ أرقام نظام المركز لا تُمسّ.`)) return;
    const recs = extraRows().map((r) => {
      if (!r || !r.values || !r.values[CERT]) return r;
      const values = { ...r.values };
      delete values[CERT];
      return { ...r, values, updatedAt: new Date().toISOString() };
    });
    App.store.get().studentExtra = recs;
    App.store.save();
    merged = null;
    render();
    ui.toast("حُذفت الأرقام المولَّدة");
  }

  function makeCerts() {
    const list = rows();
    const given = certGiven();
    const seq = new Map();
    given.forEach((v) => { const m = String(v).match(/^(.*)-(\d+)$/); if (m) seq.set(m[1], Math.max(seq.get(m[1]) || 0, Number(m[2]))); });
    const recs = extraRows();
    const now = new Date().toISOString();
    const me = (App.cloud && App.cloud.user && App.cloud.user()) || {};
    let made = 0;
    list.forEach((r) => {
      const id = idOf(r.nid) || "n:" + norm(r.name);
      if (String(r.cert || "").trim()) return;   // له رقم من النظام أو مولَّد سابقاً
      const base = String(certPrefix || r[CRS + "رمز الدورة"] || r.course || "CERT").trim();
      const n = (seq.get(base) || 0) + 1;
      seq.set(base, n);
      let rec = recs.find((x) => x && String(x.id) === id);
      if (!rec) { rec = { id, name: r.name || "", values: {}, createdAt: now }; recs.push(rec); }
      rec.values = { ...(rec.values || {}), [CERT]: `${base}-${String(n).padStart(3, "0")}` };
      rec.by = me.name || rec.by || "";
      rec.updatedAt = now;
      made++;
    });
    if (!made) { ui.toast("كل المعروضين لهم أرقام"); return; }
    App.store.get().studentExtra = recs;
    App.store.save();
    merged = null;
    render();
    ui.toast(`وُلِّد ${ui.fmt(made)} رقم شهادة`);
  }

  function renderSources() {
    const box = $("rep-sources");
    if (!box) return;
    const s = snap();
    const list = extras.map((t) => `<li><b>${esc(t.name)}</b>
        <span class="conv-hint">${countOf(t.count || (t.rows || []).length, "صفوف", "صفاً", "صف", "صفان")} · ${countOf((t.fields || []).length, "حقول", "حقلاً", "حقل", "حقلان")} · ${esc(t.by || "")} ${t.at ? esc(new Date(t.at).toLocaleDateString("ar-EG")) : ""}</span>
        <button type="button" class="conv-link" data-drop="${esc(t.name)}">حذف</button></li>`).join("");
    box.innerHTML = `<div class="page-head"><div><h3>مصادر البيانات</h3>
        <p class="conv-hint">${s && s.at ? `لقطة نظام المركز: ${esc(new Date(s.at).toLocaleString("ar-EG"))}` : "لم تصل لقطة من نظام المركز بعد"}</p></div>
        <div class="btn-row"><button type="button" class="btn secondary" id="rep-pull-src"><span class="material-symbols-outlined btn-ico">refresh</span>اسحب آخر لقطة</button>
        <button type="button" class="btn secondary" id="rep-diag"><span class="material-symbols-outlined btn-ico">monitor_heart</span>تشخيص البيانات</button></div></div>
      <h4>جداول إكسل مضافة</h4>
      ${staged && staged.mode !== "fill" ? stagedImportCard() : uploadRow("كشف فيه بيانات الطلاب؛ أعمدته تصير حقولاً تُستعمل في التقارير والنماذج.")}
      ${list ? `<ul class="rep-import-list">${list}</ul>` : `<p class="conv-hint">لا توجد جداول مستوردة بعد.</p>`}
      ${manCard()}
      ${certCard()}`;
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
    [/^المعدل$|النسبة المئوية/, CALC + "المعدل"],
    [/^التقدير$/, CALC + "التقدير"],
    [/الدرجة الكلية|^المجموع$/, "total"],
    [/^النتيجة$|^الحالة$/, "gradeStatus"],
    [/اسم (الدورة|البرنامج)|^الدورة$/, "track"],
    [/^المسار$/, "track"],
    [/^المرحلة$/, "course"],
    [/رقم الدورة|رمز الدورة/, CRS + "رمز الدورة"],
    [/بداية (الدورة|التدريب)|تاريخ البدء|من تاريخ/, CRS + "بداية الدورة"],
    [/نهاية (الدورة|التدريب)|تاريخ الانتهاء|إلى تاريخ|الى تاريخ/, CRS + "نهاية الدورة"],
    [/نوع التدريب|^النوع$/, CRS + "نوع التدريب"],
    [/شهاد/, "cert"],
    [/مدرب.*(2|٢|الثاني|الثانية)|الثاني.*مدرب/, TRK + "المدرب الثاني"],
    [/مدرب.*(1|١|الأول|الاول)|الأول.*مدرب/, TRK + "المدرب الأول"],
    [/مدرب/, "trainer"],
    [/^الجنس$|^النوع$/, "gender"],
    [/محافظة/, "governorate"],
    [/^المجموعة$/, "group"],
    [/نسبة الحضور|^الحضور$/, "attendance"],
  ];

  /* «البيانات الثابتة» التي يحفظها المستخدم في صفحة المحوّل (اسم المركز، نوع التدريب…)
     إعداد مشترك يصل الجميع، فنستعمله هنا بدل أن نطلب كتابته من جديد. */
  function fixedList() {
    if (App.converter && App.converter.fixedFields) { try { return App.converter.fixedFields() || []; } catch (e) { /* قبل تهيئة الصفحة */ } }
    const f = (App.store && App.store.get().fixedFields) || [];
    return Array.isArray(f) && f.length ? f : [{ name: "اسم المركز", value: "مركز مسارات التمكين للتدريب والتطوير" }];
  }

  /* حقول كثيرة قد تحمل الاسم نفسه: «تاريخ الميلاد» من ملف الدورة الثانية وآخر من ملف الأولى،
     و«الجوال» من النظام ومن ملف. نختار الأكثر امتلاءً في الصفوف المعروضة الآن. */
  /* «الجوال» و«رقم الجوال» و«رقم الهاتف» شيء واحد: نردّ الاسم إلى أصله قبل المقارنة،
     وإلا ظلّ عمود النموذج على مصدر فارغ وبجانبه مصدر مليء باسم آخر. */
  function canonOf(label) {
    const v = String(label || "");
    for (const [re, key] of SYNONYMS) if (key !== INDEX && key !== CONST && re.test(v)) return key;
    return norm(v);
  }

  function fullestFor(label, list) {
    const n = canonOf(label);
    const same = all().filter((f) => canonOf(f.label) === n);
    if (same.length < 2) return same[0] ? same[0].key : "";
    let best = same[0].key, bestN = -1;
    same.forEach((f) => {
      const c = list.filter((r) => String(r[f.key] == null ? "" : r[f.key]).trim() !== "").length;
      if (c > bestN) { bestN = c; best = f.key; }
    });
    return best;
  }

  /* بعد تغيير المرحلة قد يصير مصدرٌ فارغاً وآخرُ بالاسم نفسه مليئاً: ننتقل إليه
     ما لم يكن المستخدم قد اختار بنفسه. */
  function refreshMap(list) {
    if (!staged || staged.mode !== "fill" || !staged.map) return;
    staged.map.forEach((m) => {
      if (m.user || m.key === INDEX || m.key === CONST) return;
      const label = m.key ? labelOf(m.key) : m.col;
      const alt = fullestFor(label, list);
      if (alt && alt !== m.key) {
        const now = m.key ? list.filter((r) => String(r[m.key] == null ? "" : r[m.key]).trim() !== "").length : 0;
        const next = list.filter((r) => String(r[alt] == null ? "" : r[alt]).trim() !== "").length;
        if (next > now) m.key = alt;
      }
    });
  }

  function autoMap(cols) {
    const fields = all();
    const byLabel = new Map(fields.map((f) => [norm(f.label), f.key]));
    const fixed = new Map(fixedList().filter((f) => f && f.name).map((f) => [norm(f.name), String(f.value == null ? "" : f.value)]));
    const listNow = rows();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(FILL_KEY) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    return cols.map((c) => {
      const n = norm(c);
      // قيمة ثابتة محفوظة بالاسم نفسه تسبق كل شيء: هي ما يقصده النموذج حرفياً
      for (const [name, value] of fixed) if (n === name || n.includes(name)) return { col: c, key: CONST, value };
      if (byLabel.has(n)) return { col: c, key: fullestFor(c, listNow) || byLabel.get(n), value: "" };
      for (const [re, key] of SYNONYMS) {
        if (!re.test(c)) continue;
        if (key === INDEX || key === CONST) return { col: c, key, value: "" };
        return { col: c, key: fullestFor(c, listNow) || key, value: "" };
      }
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
    /* خانة منسّقة كنسبة مئوية تضرب ما فيها في مئة عند العرض: «١٠٠» تظهر «١٠٠٠٠٪».
       فنكتب فيها الكسر (١ تعني ١٠٠٪)، ونكتب الرقم كما هو في الخانة العادية. */
    const isPct = (c) => /%/.test((style[c] && style[c].numFmt) || "");
    const forCell = (v, c) => {
      const n = numOf(v);
      if (n == null) return v;
      if (isPct(c)) return n > 1 ? n / 100 : n;   // ٨٨ ← ٠٫٨٨، و٠٫٨٨ تبقى كما هي
      // رقم يبقى رقماً إن لم يتغيّر بكتابته رقماً؛ «٠٥٩١٠٠٠٠٠١» يبقى نصاً وإلا سقط صفره
      return String(n) === String(v).trim() ? n : v;
    };
    list.forEach((row, i) => {
      const r = ws.getRow(start + i);
      staged.map.forEach((m, c) => {
        const cell = r.getCell(c + 1);
        const raw = valueFor(row, m, i);
        cell.value = m.key === CONST ? raw : forCell(raw, c);
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
      ${fields.map((f) => `<option value="${esc(f.key)}" ${m.key === f.key ? "selected" : ""}>${esc(f.label + source(f.key))}</option>`).join("")}`;
    const list = rows();
    refreshMap(list);
    const done = staged.map.filter((m) => m.key).length;
    // المرحلة التي يخصّها هذا النموذج: اختيارها هنا أوضح من البحث عنها بين الفلاتر
    const phases = [...new Set(students().map((r) => String(r.course || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
    const phasePick = phases.length ? `<label class="sc-f rep-phase"><span>المرحلة التي يخصّها النموذج</span>
        <select id="rep-fill-phase"><option value="">كل المراحل</option>
        ${phases.map((p) => `<option ${filters.course === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>` : "";
    return `<div class="rep-staged">
      <b>${esc(staged.name)}</b> — نموذج بلا بيانات، أعبّئه لك من بيانات النظام.
      قابلتُ ${countOf(done, "أعمدة", "عموداً", "عموداً واحداً", "عمودين")} من ${countOf(staged.map.length, "أعمدة", "عموداً", "عموداً واحداً", "عمودين")}؛ راجع المقابلة وغيّر ما يلزم.
      <table class="rep-map"><thead><tr><th>عمود النموذج</th><th>يُملأ من</th><th>فيه بيانات</th></tr></thead><tbody>
      ${staged.map.map((m, i) => {
        const full = m.key === INDEX || m.key === CONST ? list.length
          : m.key ? list.filter((r) => String(r[m.key] == null ? "" : r[m.key]).trim() !== "").length : 0;
        const tone = !m.key ? "" : full === 0 ? "rep-warn" : full < list.length ? "rep-part" : "rep-full";
        return `<tr><td>${esc(m.col)}</td><td>
        <select data-map="${i}">${opt(m)}</select>
        ${m.key === CONST ? `<input type="text" data-const="${i}" value="${esc(m.value)}" placeholder="اكتب القيمة">` : ""}
      </td><td class="${tone}">${!m.key ? "—" : full === list.length ? "الكل" : `${ui.fmt(full)} من ${ui.fmt(list.length)}`}</td></tr>`;
      }).join("")}
      </tbody></table>
      ${phasePick}
      <div class="btn-row"><button type="button" class="btn" id="rep-fill"><span class="material-symbols-outlined btn-ico">download</span>نزّل النموذج معبّأً (${countOf(list.length, "صفوف", "صفاً", "صف واحد", "صفان")})</button>
      <button type="button" class="btn secondary" id="rep-cancel-import">إلغاء</button></div>
      ${(() => {
        const empty = staged.map.filter((m) => m.key && m.key !== INDEX && m.key !== CONST
          && !list.some((r) => String(r[m.key] == null ? "" : r[m.key]).trim() !== "")).map((m) => m.col);
        if (!empty.length) return "";
        const where = filters.course ? `في «${esc(filters.course)}»` : "في اللقطة";
        return `<p class="conv-hint rep-warn">لا بيانات ${where} لـ: ${esc(empty.join("، "))} — إن كان مصدرها ملفاً فهو يخصّ مرحلة أخرى (ارفع ملف هذه المرحلة)، وإن كان مصدرها النظام فأعد تشغيل سكربت القراءة. وإلا فاربطها بحقل آخر أو بقيمة ثابتة.</p>`;
      })()}
      <p class="conv-hint">يُعبّأ بما يظهر في التقرير الآن: المرحلة أعلاه وبقية الفلاتر تسري عليه.</p>
    </div>`;
  }

  const source = (k) => k.startsWith(SYS) ? " (من النظام)" : k.startsWith(MAN) ? " (مكتوب في تمكين)" : k.startsWith(CRS) || k.startsWith(TRK) ? " (من المسارات والرموز)"
    : k.startsWith(CALC) ? " (محسوب)" : k.startsWith(EX) ? ` (من ملف: ${String(k).slice(EX.length).split(":")[0]})` : "";

  /* التشخيص يُرسم داخل الصفحة نفسها لا في نافذة منبثقة: لا حاجب يحجبه */
  let diagOpen = false;
  function diagCard() {
    const list = students();
    const stat = all().map((f) => ({ label: f.label + source(f.key), key: f.key,
      filled: list.filter((r) => String(r[f.key] == null ? "" : r[f.key]).trim() !== "").length }))
      .sort((a, b) => a.filled - b.filled);
    return `<section class="card" id="rep-diag-card">
      <div class="page-head"><div><h3>🩺 تشخيص البيانات</h3>
        <p class="conv-hint">${ui.fmt(list.length)} طالباً في اللقطة. الحقول الفارغة أعلى القائمة.</p></div>
        <div class="btn-row"><button type="button" class="btn" id="rep-diag-copy"><span class="material-symbols-outlined btn-ico">content_copy</span>نسخ التشخيص</button>
        <button type="button" class="btn secondary" id="rep-diag-close"><span class="material-symbols-outlined btn-ico">close</span>إغلاق التشخيص</button></div></div>
      <h4>ما قرأه سكربت القراءة من نظام المركز</h4>
      ${readLogCard()}
      <h4>امتلاء الحقول</h4>
      <table class="rep-map"><thead><tr><th>الحقل</th><th>فيه بيانات</th></tr></thead><tbody>
        ${stat.map((x) => `<tr><td>${esc(x.label)}</td>
          <td class="${x.filled === 0 ? "rep-warn" : x.filled < list.length ? "rep-part" : "rep-full"}">${ui.fmt(x.filled)} من ${ui.fmt(list.length)}</td></tr>`).join("")}
      </tbody></table></section>`;
  }

  /* تشخيص يُنسخ ويُرسل عند استعصاء حقل: من أين يأتي كل حقل، وكم صفاً فيه قيمة */
  function copyDiagnostics() {
    const list = students();
    const fieldStat = all().map((f) => ({
      field: f.label, key: f.key,
      filled: list.filter((r) => String(r[f.key] == null ? "" : r[f.key]).trim() !== "").length,
    })).filter((x) => x.key !== "name" && x.key !== "nid");
    const s = snap();
    const out = {
      at: s && s.at, students: list.length,
      readLog: (s && s.data && s.data.readLog) || "لا سجلّ (سكربت قديم)",
      sysFields, imports: extras.map((t) => ({ name: t.name, fields: t.fields, rows: t.count })),
      fields: fieldStat,
    };
    ui.copyText(JSON.stringify(out, null, 1));
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
        <span class="btn-row"><button type="button" class="btn small" data-print><span class="material-symbols-outlined btn-ico">print</span>طباعة</button>
        <button type="button" class="btn small secondary" data-close>إغلاق</button></span></div>
      <iframe class="sc-sheet-frame" title="تقرير"></iframe></div>`;
    document.body.append(back);
    const frame = back.querySelector("iframe");
    frame.srcdoc = html;
    back.querySelector("[data-close]").addEventListener("click", () => back.remove());
    back.querySelector("[data-print]").addEventListener("click", () => { frame.contentWindow.focus(); frame.contentWindow.print(); });
  }

  /* ===== الأحداث ===== */
  /* مستمع واحد للقسم كله بدل مستمع لكل صندوق: الصناديق تُعاد كتابتها عند كل رسم،
     وتعليق المستمعات على الجذر يبقيها صالحة بلا إعادة ربط. */
  function init() {
    const root = document.getElementById("view-reports");
    if (!root) return;

    root.addEventListener("change", async (e) => {
      const t = e.target;

      if (t.closest("[data-field]")) {
        const k = t.dataset.field;
        picked = t.checked ? [...new Set([...picked, k])] : picked.filter((x) => x !== k);
        order(); save(); render();
        return;
      }
      if (t.id === "rep-preset") { applyPreset(t.value); return; }
      if (t.id === "rep-cert-all") { certAll = t.checked; renderSources(); return; }
      if (t.id === "rep-man-field") { manField = t.value; try { localStorage.setItem(MAN_KEY, manField); } catch (e) { /* ممتلئ */ } renderSources(); return; }
      if (t.id === "rep-man-phase") { manPhase = t.value; renderSources(); return; }
      if (t.id === "rep-avg-from") { avgFrom = t.value; avgOutOf = 0; merged = null; saveAvg(); render(); return; }
      if (t.id === "rep-avg-out") { avgOutOf = Math.max(1, Number(t.value) || 100); merged = null; saveAvg(); render(); return; }
      if (t.closest("[data-filter]")) { filters[t.dataset.filter] = t.value; save(); render(); return; }
      if (t.id === "rep-group-by") { groupBy = t.value; save(); render(); return; }
      if (t.id === "rep-fill-phase") { filters.course = t.value; save(); render(); return; }
      if (t.closest("[data-map]") && staged && staged.map) {
        const i = Number(t.dataset.map);
        staged.map[i].key = t.value;
        staged.map[i].user = true;
        saveMap();
        renderForm();
        return;
      }
      if (t.id === "rep-file") {
        const f = t.files && t.files[0];
        if (!f) return;
        try { staged = await readFile(f); } catch (err) { staged = null; ui.toast(err.message); }
        t.value = "";
        if (staged && staged.mode === "fill") showTab("form");
        else if (staged) showTab("sources");
        else render();
      }
    });

    root.addEventListener("click", (e) => {
      const tabBtn = e.target.closest("[data-rep-tab]");
      if (tabBtn) { showTab(tabBtn.dataset.repTab); return; }
      const drop = e.target.closest("[data-drop]");
      if (drop) { dropImport(drop.dataset.drop); return; }
      if (e.target.closest("#rep-save-import")) return void saveImport();
      if (e.target.closest("#rep-fill")) return void fillTemplate();
      if (e.target.closest("#rep-cancel-import")) { staged = null; render(); return; }
      if (e.target.closest("#rep-pull") || e.target.closest("#rep-pull-src")) return void pull(true);
      if (e.target.closest("#rep-diag")) { diagOpen = true; render(); const c = $("rep-diag-card"); if (c) c.scrollIntoView({ block: "start" }); return; }
      if (e.target.closest("#rep-diag-copy")) return void copyDiagnostics();
      if (e.target.closest("#rep-diag-close")) { diagOpen = false; render(); return; }
      if (e.target.closest("#rep-show-blank")) { hideBlank = false; save(); render(); return; }
      if (e.target.closest("#rep-hide-blank")) { hideBlank = true; save(); render(); return; }
      if (e.target.closest("#rep-cert-make")) return void makeCerts();
      if (e.target.closest("#rep-cert-excel")) return void certExcel();
      if (e.target.closest("#rep-cert-clear")) return void clearCerts();
      if (e.target.closest("#rep-man-save")) return void saveMan();
      if (e.target.closest("#rep-preset-save")) return void savePreset();
      if (e.target.closest("#rep-preset-del")) return void dropPreset();
      if (e.target.closest("#rep-clear")) { filters = {}; search = ""; groupBy = ""; hideBlank = true; save(); render(); return; }
      if (e.target.closest("#rep-excel")) return void toExcel();
      if (e.target.closest("#rep-print")) return void print();
      const all = e.target.closest("[data-all]"), none = e.target.closest("[data-none]");
      if (all || none) {
        const g = groups().find((x) => x.name === ((all && all.dataset.all) || (none && none.dataset.none)));
        if (!g) return;
        const keys = g.fields.map((f) => f.key);
        picked = all ? [...new Set([...picked, ...keys])] : picked.filter((k) => !keys.includes(k));
        order(); save(); render();
      }
    });

    let typing = null;
    root.addEventListener("input", (e) => {
      if (e.target.closest("[data-const]") && staged && staged.map) {
        staged.map[Number(e.target.dataset.const)].value = e.target.value;
        return;
      }
      if (e.target.id === "rep-cert-prefix") { certPrefix = e.target.value; return; }
      if (e.target.id === "rep-preset-name" || e.target.dataset.man !== undefined) return;
      if (e.target.id === "rep-man-search") {
        const v = e.target.value;
        clearTimeout(typing);
        typing = setTimeout(() => { manSearch = v; renderSources(); const q = $("rep-man-search"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300);
        return;
      }
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

    showTab(tab);
  }

  App.reports = { init, render: () => { render(); pull(false); loadImports(true).then(render); } };
})(window.App = window.App || {});
