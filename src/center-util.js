/* أدوات «أوامر المركز» التي لا تعتمد على حالة الصفحة: نصوص وأرقام، تقسيم خلايا النظام، تنسيق Excel،
   حسابات اللقطات والالتزام والتذكير. فُصلت عن center-cmd.js ليصغر ملفه، وليمكن اختبارها في Node مباشرة
   (node tools/test-center-util.js). لا تقرأ DOM ولا ui ولا state. */
(function (App) {
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const digits = (v) => String(v == null ? "" : v).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\D/g, "");
  const cellStr = (c) => String(c == null ? "" : c);
  const phoneNorm = (v) => { const d = digits(v); return /^5\d{8}$/.test(d) ? "0" + d : d; };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* وضع التصفح الخاص */ } };
  const maskCell = (v) => { const t = cellStr(v); return /^\d{9,10}$/.test(t) ? t.slice(0, 2) + "*".repeat(t.length - 4) + t.slice(-2) : t; };
  const verNum = (v) => String(v || "").split(".").map(Number);
  const verLess = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };

  /* رقم دولي لرابط wa.me: 059… ← 97059… ، ويُبقى الرقم الذي يبدأ بـ + أو 00 كما هو */
  const waIntl = (raw, cc) => {
    const t = String(raw || "").trim(), d = digits(t);
    if (!d) return "";
    if (t.startsWith("+")) return d;
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith(cc) && d.length >= cc.length + 8) return d;
    return d.startsWith("0") ? cc + d.slice(1) : cc + d;
  };
  /* تقسيم الرسالة عند حدود الأسطر إلى أجزاء مرقمة إن تجاوزت max (الافتراضي: لا تجزئة) */
  function waParts(text, max) {
    const lim = max == null ? Infinity : max, t = String(text || "").trim();
    if (t.length <= lim) return [t];
    const out = []; let cur = "";
    t.split("\n").forEach((line) => { if (cur && (cur + "\n" + line).length > lim) { out.push(cur); cur = line; } else cur = cur ? cur + "\n" + line : line; });
    if (cur) out.push(cur);
    return out.map((x, i) => "(" + (i + 1) + "/" + out.length + ")\n" + x);
  }

  /* ورقة منسّقة: اتجاه يمين لليسار، ترويسة مثبّتة ملوّنة، فلاتر، وعرض أعمدة بحسب المحتوى */
  function fmtSheet(ws, heads, rows) {
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
    ws.addRow(heads);
    rows.forEach((r) => ws.addRow(r));
    const hr = ws.getRow(1);
    hr.font = { bold: true };
    hr.alignment = { vertical: "middle", horizontal: "right" };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, heads.length) } };
    heads.forEach((h, i) => {
      let w = cellStr(h).length;
      rows.forEach((r) => { w = Math.max(w, cellStr(r[i]).length); });
      ws.getColumn(i + 1).width = Math.min(45, Math.max(10, w + 3));
    });
  }

  /* جدول النظام يدمج عدة بيانات في خلية واحدة (الطالب، المسار/الدورة، المجموعة/المدرب).
     نفصلها إلى أعمدة مستقلة، لكل نوع بيانات عموده، ونحتفظ بنص الدورة الأصلي لأغراض التصفية. */
  function splitStudentCell(raw) {
    let t = clean(raw);
    const stu = (t.match(/STU-[\d-]+/) || [""])[0];
    if (stu) t = t.replace(stu, " ");
    const NO_EN = "لا يوجد اسم إنجليزي";
    let name, en = "";
    const k = t.indexOf(NO_EN);
    if (k >= 0) { name = t.slice(0, k); t = t.slice(k + NO_EN.length); }
    else {
      const m = t.match(/[A-Za-z][A-Za-z .'\-]*[A-Za-z]/);
      if (m) { const at = t.indexOf(m[0]); name = t.slice(0, at); en = m[0]; t = t.slice(at + m[0].length); }
      else { const d = t.search(/\d/); name = d < 0 ? t : t.slice(0, d); t = d < 0 ? "" : t.slice(d); }
    }
    // ما بقي: «الهوية - الجوال» بفاصل بينهما. نقسمه بالفواصل لا بشكل الرقم، فالجوال قد يأتي بلا صفر أوله
    const parts = t.split(/\s*[-–—·]\s*/).map(digits).filter(Boolean);
    let id = "", phone = "";
    if (parts.length >= 2) { id = parts[0]; phone = parts[parts.length - 1]; }
    else if (parts.length === 1) { if (/^0?5\d{8}$/.test(parts[0])) phone = parts[0]; else id = parts[0]; }
    if (/^5\d{8}$/.test(phone)) phone = "0" + phone;
    // الاسم العربي يفصله النظام عمّا بعده بـ « / » أو شرطة: نزيل الفواصل من طرفيه (والإنجليزي كذلك)
    const trimSep = (v) => clean(v).replace(/^[\s\/\|·\-–—،,:]+|[\s\/\|·\-–—،,:]+$/g, "");
    return [trimSep(name), trimSep(en), stu, id, phone];
  }
  /* خلية «المجموعة / المدرب»: «S3G2 -» (بلا مدرب)، «G1 - د. أحمد»، أو «S3G1 اسراء خليل…» (رمز المجموعة ثم المدرب بلا فاصل) */
  function splitGroupCell(raw) {
    const d = clean(raw).split(/\s+-\s*/);
    let g = clean(d[0]), tr = clean(d.slice(1).join(" - "));
    if (!tr) {
      let m = g.match(/^([A-Za-z]+\d*[A-Za-z]*\d*)\s+(.+)$/);              // رمز لاتيني: G1، S3G2
      if (!m) m = g.match(/^(المجموعة\s+\S+)\s+(.+)$/);                   // المجموعة الاولى
      if (!m) m = g.match(/^(ال(?:[اأإ]ول[ىي]|ثاني[ةه]|ثالث[ةه]|رابع[ةه]|خامس[ةه]|سادس[ةه]|سابع[ةه]|ثامن[ةه]|تاسع[ةه]|عاشر[ةه]))\s+(.+)$/);   // «الاولى ورود بركات…»: اسم المجموعة ثم المدرب
      if (m) { g = m[1]; tr = clean(m[2]); }
    }
    return [g, tr.replace(/^[-–—]+$/, "")];
  }
  function expandResult(r) {
    if (!r || !Array.isArray(r.heads) || !Array.isArray(r.rows)) return r;
    const at = (rx) => r.heads.findIndex((h) => rx.test(clean(h)));
    const iS = at(/^الطالب$/), iC = at(/^المسار\s*\/\s*الدورة$/), iG = at(/^المجموعة\s*\/\s*المدرب$/);
    if (iS < 0 && iC < 0 && iG < 0) return r;
    const heads = [], plan = [];
    r.heads.forEach((h, i) => {
      if (i === iS) {
        const hasPhone = r.heads.some((x) => clean(x) === "الجوال");   // تقرير له عمود جوال خاص: لا نكرره
        heads.push("الاسم", "الاسم الإنجليزي", "رقم الطالب", "رقم الهوية"); if (!hasPhone) heads.push("الجوال");
        plan.push((c) => { const v = splitStudentCell(c); return hasPhone ? v.slice(0, 4) : v; });
      }
      else if (i === iC) {
        heads.push("المسار", "المرحلة");
        plan.push((c) => { const t = clean(c); const m = t.match(/المرحلة\s*\S+/); return [clean(m ? t.replace(m[0], "") : t), m ? m[0] : ""]; });
      } else if (i === iG) {
        heads.push("المجموعة", "المدرب");
        plan.push((c) => splitGroupCell(c));
      } else { heads.push(h); plan.push((c) => [c]); }
    });
    const rows = r.rows.map((x) => ({ cells: [].concat(...plan.map((f, i) => f(x.cells[i]))), course: iC >= 0 ? clean(x.cells[iC]) : "", raw: x.cells }));
    return Object.assign({}, r, { heads, rows, rawHeads: r.heads });
  }

  /* ===== لقطات الناقصين: خط الأساس والفرق ===== */
  const DAY = 86400000, HOUR = 3600000;
  /* خط الأساس: أحدث لقطة عمرها 6 أيام فأكثر؛ وإلا أقدم لقطة عمرها ساعة فأكثر (نسبةً إلى nowMs) */
  function pickBase(list, nowMs) {
    const aged = (list || []).map((e) => ({ e, age: nowMs - Date.parse(e.at) })).filter((x) => x.age >= HOUR);
    const week = aged.filter((x) => x.age >= 6 * DAY).sort((a, b) => a.age - b.age)[0];
    return week || aged.sort((a, b) => b.age - a.age)[0] || null;
  }
  /* صفوف اللقطة [مفتاح، اسم، مسار]: من أكمل (كانوا ناقصين) ومن نقص جديداً */
  function diffRows(baseRows, curRows) {
    const old = new Map((baseRows || []).map((r) => [r[0], r])), cur = new Map((curRows || []).map((r) => [r[0], r]));
    return {
      before: old.size, now: cur.size,
      done: [...old.entries()].filter(([k]) => !cur.has(k)).map(([, r]) => ({ name: r[1], track: r[2] })),
      added: [...cur.entries()].filter(([k]) => !old.has(k)).map(([, r]) => ({ name: r[1], track: r[2] })),
    };
  }
  /* آخر لقطة مقابل خط الأساس قبلها (لشاشة «ما الجديد»؛ تحتاج لقطتين على الأقل) */
  function compareLatest(list) {
    if (!list || list.length < 2) return null;
    const latest = list[list.length - 1], base = pickBase(list.slice(0, -1), Date.parse(latest.at));
    if (!base) return null;
    return Object.assign({ baseAt: base.e.at, latestAt: latest.at }, diffRows(base.e.rows, latest.rows));
  }

  /* ===== الالتزام بالمتطلبات لكل مجموعة ومدرب =====
     students: طلاب النظام {id, stu, name, track, stage, group, trainer}؛ missing: صفوف الناقصين {id, stu, flags:{pre,post,impact,pledge}}.
     الطالب «مكتمل» إن لم يرد في الناقصين بأي من الأربعة. الترتيب: الأقل التزاماً أولاً. */
  const REQ = ["pre", "post", "impact", "pledge"];
  function rankCompliance(students, missing) {
    const byId = new Map(), byStu = new Map();
    (missing || []).forEach((m) => { if (m.id) byId.set(String(m.id), m); if (m.stu) byStu.set(String(m.stu), m); });
    const find = (st) => (st.id && byId.get(String(st.id))) || (st.stu && byStu.get(String(st.stu))) || null;
    const gm = new Map(), tm = new Map();
    const empty = () => ({ n: 0, complete: 0, pre: 0, post: 0, impact: 0, pledge: 0 });
    const add = (e, m) => { e.n++; const lacks = REQ.filter((k) => m && m.flags && m.flags[k]); if (!lacks.length) e.complete++; lacks.forEach((k) => { e[k]++; }); };
    (students || []).forEach((st) => {
      const m = find(st), group = st.group || "(غير موزع)", trainer = st.trainer || "(بلا مدرب)";
      const gk = st.track + "|" + st.stage + "|" + group;
      add(gm.get(gk) || gm.set(gk, Object.assign(empty(), { track: st.track, stage: st.stage, group, trainer: st.trainer || "" })).get(gk), m);
      const g = gm.get(gk); if (st.trainer && !g.trainer) g.trainer = st.trainer;
      add(tm.get(trainer) || tm.set(trainer, Object.assign(empty(), { name: trainer, groups: new Set(), tracks: new Set() })).get(trainer), m);
      const t = tm.get(trainer); t.groups.add(gk); t.tracks.add(st.track);
    });
    const pct = (e) => (e.n ? Math.round((e.complete / e.n) * 100) : 0);
    const worstFirst = (a, b) => a.pct - b.pct || b.n - a.n || String(a.group || a.name).localeCompare(String(b.group || b.name), "ar");
    const groups = [...gm.values()].map((e) => Object.assign(e, { pct: pct(e) })).sort(worstFirst);
    const trainers = [...tm.values()].map((e) => Object.assign(e, { pct: pct(e), groups: e.groups.size, tracks: [...e.tracks] })).sort(worstFirst);
    const total = groups.reduce((a, g) => a + g.n, 0), complete = groups.reduce((a, g) => a + g.complete, 0);
    return { groups, trainers, total, complete, pct: total ? Math.round((complete / total) * 100) : 0 };
  }

  /* ===== التذكير الأسبوعي =====
     rec: { at } آخر تقرير شامل؛ snoozeUntil: وقت (ms) أجّل التذكير إليه. due: انقضت 7 أيام أو لم يُشغَّل قط. */
  function weeklyDue(rec, snoozeUntil, nowMs) {
    const last = rec && rec.at ? Date.parse(rec.at) : 0;
    const days = last ? Math.floor((nowMs - last) / DAY) : null;
    const overdue = !last || nowMs - last >= 7 * DAY;
    return { due: overdue && !(snoozeUntil && nowMs < snoozeUntil), days, never: !last };
  }

  /* رقم من خلية: «49.54%» أو «109» أو «٢٫٩١»؛ غير رقمي ← NaN */
  const numOf = (v) => {
    const t = String(v == null ? "" : v).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٫/g, ".").replace(/[,٬\s%]/g, "");
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  };
  /* مقارنة جدولين متماثلي الأعمدة: الأعمدة غير الرقمية مفتاح، والرقمية يُحسب فرقها */
  function diffTables(cur, old) {
    const heads = cur.heads, n = heads.length;
    const isNum = heads.map((h, i) => { const vals = cur.rows.map((r) => r[i]).filter((x) => String(x).trim() !== ""); return vals.length > 0 && vals.filter((x) => !isNaN(numOf(x))).length >= vals.length * 0.8; });
    const keyIdx = heads.map((h, i) => i).filter((i) => !isNum[i]), numIdx = heads.map((h, i) => i).filter((i) => isNum[i]);
    const keyOf = (r) => keyIdx.map((i) => clean(r[i])).join("");
    const oldBy = new Map(); (old.rows || []).forEach((r) => oldBy.set(keyOf(r), r));
    const outHeads = keyIdx.map((i) => heads[i]);
    numIdx.forEach((i) => outHeads.push(heads[i] + " (الآن)", heads[i] + " (السابق)", heads[i] + " (الفرق)"));
    const fmt = (d) => (d === 0 ? "0" : (d > 0 ? "▲ +" : "▼ ") + (Math.round(d * 100) / 100));
    const rows = cur.rows.map((r) => {
      const o = oldBy.get(keyOf(r));
      const cells = keyIdx.map((i) => r[i]);
      numIdx.forEach((i) => { const a = numOf(r[i]), b = o ? numOf(o[i]) : NaN; cells.push(r[i], o ? o[i] : "جديد", isNaN(a) || isNaN(b) ? "" : fmt(a - b)); });
      return cells;
    });
    return { heads: outHeads, rows, matched: rows.filter((_, k) => oldBy.has(keyOf(cur.rows[k]))).length };
  }
  /* ===== مطابقة الأسماء العربية (قراءة الصور تخطئ حرفاً أو تُسقط جزءاً) ===== */
  const arKey = (v) => String(v == null ? "" : v)
    .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/[ىئ]/g, "ي").replace(/ؤ/g, "و")
    .replace(/[٠-٩0-9.,،؛:()\[\]/\\_*#\-]+/g, " ").replace(/\s+/g, " ").trim();
  const nameTokens = (v) => arKey(v).split(" ").map((t) => t.replace(/^ال(?=.{3,})/, "")).filter((t) => t && !/^(بن|ابن|بنت|ابو|ام)$/.test(t));
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function tokSim(a, b) {
    if (a === b) return 1;
    const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
    if (short.length >= 3 && long.startsWith(short)) return 0.88;
    const r = 1 - lev(a, b) / Math.max(a.length, b.length);
    return r >= 0.75 ? r : 0;
  }
  /* تشابه اسمين 0..1: أفضل تقابل رمز برمز (بلا تكرار)، ويُشترط أن يتطابق رمزان على الأقل متى كان في الاسم ثلاثة فأكثر */
  function nameScore(x, y) {
    const A = nameTokens(x), B = nameTokens(y);
    if (!A.length || !B.length) return 0;
    const used = new Set(); let sum = 0, strong = 0;
    for (const t of A) {
      let best = 0, at = -1;
      B.forEach((u, i) => { if (used.has(i)) return; const sc = tokSim(t, u); if (sc > best) { best = sc; at = i; } });
      if (at >= 0) { used.add(at); sum += best; if (best >= 0.85) strong++; }
    }
    const score = (2 * sum) / (A.length + B.length);
    if (Math.min(A.length, B.length) >= 3 && strong < 2) return Math.min(score, 0.55);
    if (Math.min(A.length, B.length) === 2 && strong < 1) return Math.min(score, 0.55);
    return score;
  }
  /* يقابل المسجلين بما قُرئ من الأوراق: كل مسجّل بأفضل اسم مقروء (واحد لواحد). strict ≥ 0.8 مطابق، وبين 0.62 و0.8 «يحتاج مراجعة» */
  /* يقابل المسجلين بالمقروء: الهوية أولاً ثم الجوال (تطابق تام = جزم)، ثم الاسم للباقين.
     اتفاق الاسم مع اختلاف الهوية/الجوال المقروءين يُعلَّم «mismatch» ويحتاج مراجعة. */
  /* مسافة تحرير بين رقمين مع التبديل المتجاور (خطأ قراءة خانة: استبدال/حذف/زيادة/تبديل خانتين متجاورتين) */
  function digitDist(a, b) {
    a = String(a || ""); b = String(b || "");
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  /* مفتاح المسار للمقارنة: بلا «مسار» ولا «المرحلة …» وموحَّد الهمزات */
  const trackKey = (t) => arKey(String(t || "").replace(/\s*[-–—]?\s*المرحل[ةه].*$/, "")).replace(/(^|\s)مسار(\s|$)/g, " ").replace(/\s+/g, " ").trim();
  /* هل المساران واحد؟ true / false / null (غير معروف) */
  function sameTrack(a, b) {
    const x = trackKey(a), y = trackKey(b);
    if (!x || !y) return null;
    if (x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return true;
    return nameScore(x, y) >= 0.75;
  }

  /* يقابل المسجلين بالمقروء من الأوراق بكل الأدلة معاً (واحد لواحد):
     1) هوية مطابقة  2) جوال مطابق  3) تبادل الخانتين (الجوال في خانة الهوية أو العكس)
     4) هوية/جوال بفرق خانة واحدة (خطأ قراءة) لمرشح وحيد، يؤكّده الاسم
     5) الاسم، مع تعزيز من المسار ومن الأرقام الجزئية (آخر 4 خانات، أو هوية بفرق خانتين) وخفض عند اختلاف المسار
     الأرقام المتعارضة بوضوح تُعلَّم «mismatch» وتحتاج مراجعة. registered/found: { name, id, phone, track? } */
  function matchNames(registered, found, opts) {
    const hi = (opts && opts.hi) || 0.8, lo = (opts && opts.lo) || 0.62;
    const idOf = (x) => { const d = digits(x && x.id); return d.length >= 8 ? d : ""; };
    const phOf = (x) => { const d = phoneNorm(x && x.phone); return d.length >= 9 ? d.slice(-9) : ""; };
    const ri = new Set(), fj = new Set(), out = [];
    const take = (i, j, score, sure, by, mismatch) => { ri.add(i); fj.add(j); out.push({ reg: i, found: j, score, sure, by, mismatch: !!mismatch }); };
    const nameless = (f) => !nameTokens(f && f.name).length || /^\(بلا اسم/.test(String(f && f.name || ""));
    // 1-2) تطابق تام
    ["id", "phone"].forEach((by) => {
      const key = by === "id" ? idOf : phOf, idx = new Map();
      found.forEach((f, j) => { const k = key(f); if (k && !fj.has(j) && !idx.has(k)) idx.set(k, j); });
      registered.forEach((r, i) => { if (ri.has(i)) return; const k = key(r), j = k ? idx.get(k) : undefined; if (j !== undefined && !fj.has(j)) take(i, j, 1, true, by, false); });
    });
    // 3) تبادل الخانتين: رقم الهوية المقروء هو جوال المسجّل، أو الجوال المقروء هو هويته
    found.forEach((f, j) => {
      if (fj.has(j)) return;
      const fid = digits(f.id), fph = phoneNorm(f.phone);
      const i = registered.findIndex((r, k) => !ri.has(k) && ((fid.length >= 9 && phOf(r) && fid.slice(-9) === phOf(r)) || (fph.length >= 8 && idOf(r) && digits(fph) === idOf(r))));
      if (i >= 0) take(i, j, 1, true, "swap", false);
    });
    // 4) فرق خانة واحدة (خطأ قراءة) — مرشح وحيد فقط، والاسم يؤكّد (أو لا اسم مقروء)
    [["id~", idOf], ["phone~", phOf]].forEach(([by, key]) => {
      found.forEach((f, j) => {
        if (fj.has(j)) return;
        const k = key(f); if (!k) return;
        const cand = registered.map((r, i) => ({ i, d: !ri.has(i) && key(r) ? digitDist(k, key(r)) : 9 })).filter((x) => x.d === 1);
        if (cand.length !== 1) return;
        const r = registered[cand[0].i], ns = nameless(f) ? 1 : nameScore(r.name, f.name);
        if (ns < 0.45) return;                                  // الرقم قريب لكن الاسم مختلف تماماً: لا نخمّن
        take(cand[0].i, j, Math.max(ns, 0.9), ns >= 0.6, by, false);
      });
    });
    // 5) الاسم معزَّزاً بالمسار والأرقام الجزئية
    const evidence = (r, f) => {
      let sc = nameScore(r.name, f.name), mis = false;
      const st = sameTrack(r.track, f.track);
      if (st === true) sc += 0.05; else if (st === false) sc *= 0.8;
      const ir = idOf(r), ifd = idOf(f), pr = phOf(r), pf = phOf(f);
      if (ir && ifd) { const d = digitDist(ir, ifd); if (d <= 2) sc += 0.08; else mis = true; }
      if (pr && pf) { if (pr.slice(-4) === pf.slice(-4) || digitDist(pr, pf) <= 2) sc += 0.08; else mis = true; }
      return { sc: Math.min(1, sc), mis, st };
    };
    const pairs = [];
    registered.forEach((r, i) => { if (ri.has(i)) return; found.forEach((f, j) => { if (fj.has(j)) return; const e = evidence(r, f); if (e.sc >= lo) pairs.push({ i, j, sc: e.sc, mis: e.mis, st: e.st }); }); });
    pairs.sort((a, b) => b.sc - a.sc);
    for (const p of pairs) {
      if (ri.has(p.i) || fj.has(p.j)) continue;
      take(p.i, p.j, p.sc, p.sc >= hi && !p.mis && p.st !== false, "name", p.mis);
    }
    return { pairs: out, unmatchedReg: registered.map((_, i) => i).filter((i) => !ri.has(i)), unmatchedFound: found.map((_, j) => j).filter((j) => !fj.has(j)) };
  }
  App.ccUtil = { arKey, nameTokens, nameScore, matchNames, digitDist, trackKey, sameTrack, numOf, diffTables, clean, digits, cellStr, phoneNorm, lsGet, lsSet, maskCell, verNum, verLess, waIntl, waParts, fmtSheet, splitStudentCell, splitGroupCell, expandResult, pickBase, diffRows, compareLatest, rankCompliance, weeklyDue };
})(window.App = window.App || {});
