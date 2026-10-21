/* مسح شامل لبيانات الأشخاص — من نظام المركز (tamkeen.ksach.org) إلى موقع تمكين

   الاستعمال: افتح النظام وأنت مسجّل دخولك، واضغط F12 ← تبويب Console،
   والصق هذا الملف كله واضغط Enter. سينزّل على جهازك ملف
   «نظام-المركز-الطلاب.json» ترفعه في صفحة «محوّل القوالب» ← «إكمال الناقص
   من نظام المركز».

   ماذا يفعل: يمرّ على صفحات النظام التي فيها جداول أشخاص (الطلاب،
   المتقدمون، المستفيدون، التسجيلات…)، ويقرأ كل صفحاتها، ثم يعيد القراءة
   لكل خيار في فلاتر الصفحة (الدورة، المرحلة، المسار، الحالة) حتى لا تفوته
   دفعة. ويدمج ما يجده برقم الهوية، فيصير لكل شخص سجلّ واحد فيه كل الحقول
   التي ذكرها النظام عنه في أي صفحة.

   قراءة فقط: طلبات GET لا غير. لا يضغط زراً، ولا يفتح رابط تعديل أو حذف
   أو تصدير، ولا يرسل شيئاً إلى أي خادم — الملف ينزل على جهازك وحدك. */

(async () => {
  const origin = location.origin;
  const DELAY = 250;              // مهلة بين الطلبات حتى لا يُثقَل النظام
  const MAX_PAGES = 400;          // سقف أمان لكل قائمة
  const PER_PAGE = 200;
  const MAX_FILTER_OPTS = 60;     // فلتر فيه خيارات أكثر من هذا يُتجاوز

  /* صفحات يُحتمل أن فيها جداول أشخاص */
  const PATHS = [
    "/admin/students", "/admin/applicants", "/admin/applications",
    "/admin/beneficiaries", "/admin/trainees", "/admin/registrations",
    "/admin/student-profiles", "/admin/reports/students", "/admin/reports/applicants",
  ];
  /* لا يُفتح أي مسار فيه هذه الكلمات مهما كان */
  const UNSAFE = /logout|signout|delete|destroy|remove|revoke|reset|export|download|print|\.pdf|\.xlsx|\.csv/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const nidOf = (s) => (clean(s).match(/\b\d{9,}\b/) || [""])[0];

  /* ===== لوحة تُظهر ما يجري ===== */
  const box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "position:fixed;inset-block-start:14px;inset-inline-start:14px;z-index:2147483647;" +
    "background:#14284B;color:#fff;font:14px/1.7 system-ui,'Segoe UI',sans-serif;padding:14px 16px;" +
    "border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:420px";
  box.innerHTML = '<b style="font-size:15px">مسح بيانات النظام</b>' +
    '<div id="kx-say" style="margin-top:6px;opacity:.92"></div>' +
    '<div id="kx-sum" style="margin-top:8px;font-size:12.5px;opacity:.85;max-height:150px;overflow:auto"></div>' +
    '<div id="kx-act" style="margin-top:10px"></div>';
  document.body.appendChild(box);
  const say = (t) => { box.querySelector("#kx-say").textContent = t; };
  const sum = () => {
    box.querySelector("#kx-sum").innerHTML = Object.keys(report)
      .map((k) => `${k}: <b>${report[k].rows}</b>${report[k].note ? ` — ${report[k].note}` : ""}`).join("<br>");
  };
  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "margin-inline-end:8px;margin-top:6px;padding:8px 14px;border:0;border-radius:8px;" +
      "background:#0F8B8D;color:#fff;font:600 13px system-ui;cursor:pointer";
    b.onclick = fn;
    box.querySelector("#kx-act").appendChild(b);
    return b;
  };
  let stopped = false;

  /* ===== قراءة الصفحات ===== */
  async function getDoc(path) {
    if (UNSAFE.test(path)) throw new Error("مسار غير آمن: " + path);
    const res = await fetch(origin + path, { credentials: "include" });
    if (/login|signin/i.test(res.url)) throw new Error("انتهت الجلسة؛ ادخل من جديد وأعد التشغيل");
    if (!res.ok) throw new Error(`${res.status} عند ${path}`);
    await sleep(DELAY);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  function headOf(table) {
    const trs = [...table.querySelectorAll("thead tr")];
    if (!trs.length) return [];
    if (trs.length === 1) return [...trs[0].children].map((c) => clean(c.textContent));
    const grid = [];
    trs.forEach((tr, r) => {
      let c = 0;
      [...tr.children].forEach((el) => {
        while (grid[r] && grid[r][c] !== undefined) c++;
        const cs = Number(el.colSpan) || 1, rs = Number(el.rowSpan) || 1, text = clean(el.textContent);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { grid[r + i] = grid[r + i] || []; grid[r + i][c + j] = text; }
        c += cs;
      });
    });
    const leaf = grid[grid.length - 1] || [], top = grid[0] || [];
    return leaf.map((v, i) => v || top[i] || "");
  }

  function tables(doc) {
    return [...doc.querySelectorAll("table")].map((t) => {
      let head = headOf(t);
      let trs = [...t.querySelectorAll("tr")].filter((r) => !r.closest("thead"));
      if (!head.length && trs.length) { head = [...trs[0].children].map((c) => clean(c.textContent)); trs = trs.slice(1); }
      const rows = trs.map((tr) => [...tr.children].map((c) => clean(c.textContent))).filter((r) => r.length > 1);
      return { head, rows };
    }).filter((t) => t.rows.length);
  }

  /* جدول أشخاص: فيه عمود اسم أو هوية */
  const PERSON = /الطالب|المتقدم|المستفيد|الاسم|اسم/;
  const peopleTable = (list) => list.find((t) => t.head.some((h) => PERSON.test(h)));

  /* العدد الذي يعلنه النظام في سطر الترقيم: «من 1234» أو «of 1234» */
  function declaredTotal(doc) {
    const txt = clean(doc.body ? doc.body.textContent : "");
    const m = txt.match(/(?:من|of|مجموع|إجمالي)\s*([\d,]{2,})/);
    if (!m) return 0;
    const n = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  /* ===== التجميع: سجلّ واحد لكل شخص، تُضمّ إليه حقول كل الصفحات ===== */
  const byKey = new Map();
  const report = {};
  const SKIP_COL = /^(#|م|إجراءات|العمليات|خيارات|تحكم|الإجراء)$/;

  /* أعمدة تدلّ على الدورة أو المرحلة داخل الصف نفسه */
  const COURSE_COL = /دوره|دورة|مرحل|فصل دراسي|الفترة/;

  function eat(t, source, ctx) {
    let added = 0;
    const nameIdx = t.head.findIndex((h) => PERSON.test(h));
    t.rows.forEach((r) => {
      let nid = "";
      t.head.forEach((h, i) => { if (!nid && /هوي|هويه/.test(h)) nid = nidOf(r[i]); });
      const rawName = nameIdx >= 0 ? r[nameIdx] : r[0];
      if (!nid) nid = nidOf(rawName);
      const name = clean(String(rawName).split("\n").map(clean).find((x) => x && !/^\d+$/.test(x)) || rawName);
      if (!nid && !name) return;
      const key = nid || "اسم:" + name;
      let rec = byKey.get(key);
      if (!rec) {
        rec = { "رقم الهوية": nid, "الاسم": name, "_مصادر": [], "_التحاقات": [] };
        byKey.set(key, rec);
        added++;
      }
      if (!rec["رقم الهوية"] && nid) rec["رقم الهوية"] = nid;
      if (!rec["الاسم"] && name) rec["الاسم"] = name;
      if (rec["_مصادر"].indexOf(source) === -1) rec["_مصادر"].push(source);

      // الدورة: من عمود في الصف، وإلا من الفلتر الذي قرأنا به الصفحة
      let course = "";
      t.head.forEach((h, i) => { if (!course && COURSE_COL.test(h)) course = clean(r[i]); });
      if (!course && ctx) course = ctx;
      let track = "", status = "", group = "";
      t.head.forEach((h, i) => {
        if (!track && /مسار|برنامج/.test(h)) track = clean(r[i]);
        if (!status && /^الحاله$|^الحالة$|حاله الطلب|حالة الطلب|^الوضع$/.test(h)) status = clean(r[i]);
        if (!group && /مجموع|شعبه|شعبة/.test(h)) group = clean(r[i]);
      });
      // التحاق واحد لكل (دورة + مسار + مصدر): إعادة القراءة لا تكرّره
      const sig = [course, track, source].join("|");
      if (!rec["_التحاقات"].some((e) => e._sig === sig)) {
        rec["_التحاقات"].push({ _sig: sig, "الدورة": course, "المسار": track, "المجموعة": group, "الحالة": status, "المصدر": source });
      }

      t.head.forEach((h, i) => {
        const k = clean(h);
        const v = clean(r[i]);
        if (!k || !v || v === "-" || v === "—" || SKIP_COL.test(k)) return;
        if (!rec[k]) rec[k] = v;            // أول قيمة غير فارغة تبقى
      });
    });
    return added;
  }

  /* كل صفحات قائمة واحدة */
  async function readList(path, label, source, ctx) {
    let lastFirst = "";
    let wide = true;
    let got = 0;
    for (let page = 1; page <= MAX_PAGES && !stopped; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const url = (w) => `${path}${sep}${w ? `per_page=${PER_PAGE}&` : ""}page=${page}`;
      let t = null;
      for (const w of wide ? [true, false] : [false]) {
        let doc;
        try { doc = await getDoc(url(w)); } catch (e) { if (w) continue; throw e; }
        t = peopleTable(tables(doc));
        if (t && t.rows.length) { wide = w; break; }
        if (!w) break;
      }
      if (!t || !t.rows.length) break;
      const first = t.rows[0].join("|");
      if (first === lastFirst) break;        // النظام يعيد الصفحة نفسها
      lastFirst = first;
      got += t.rows.length;
      eat(t, source, ctx);
      say(`${label} — صفحة ${page} · ${byKey.size} شخصاً`);
    }
    return got;
  }

  /* فلاتر الصفحة: كل قائمة اختيار لها خيارات حقيقية */
  function filtersOf(doc) {
    return [...doc.querySelectorAll("select[name]")]
      .map((sel) => ({
        name: sel.getAttribute("name"),
        label: clean((sel.closest("label") || {}).textContent || sel.getAttribute("name")),
        options: [...sel.options].filter((o) => o.value && clean(o.textContent)).map((o) => ({ v: o.value, t: clean(o.textContent) })),
      }))
      .filter((f) => f.name && !/per_page|page|sort|order|length/i.test(f.name))
      .filter((f) => f.options.length > 1 && f.options.length <= MAX_FILTER_OPTS);
  }

  /* ===== التشغيل ===== */
  btn("إيقاف", () => { stopped = true; say("أُوقف بطلبك — سيُنزَّل ما جُمع"); });

  try {
    for (const path of PATHS) {
      if (stopped) break;
      const label = path.replace("/admin/", "");
      say(`فحص ${label}…`);
      let doc;
      try { doc = await getDoc(path); } catch (e) { report[label] = { rows: 0, note: e.message }; sum(); continue; }
      const t0 = peopleTable(tables(doc));
      if (!t0) { report[label] = { rows: 0, note: "لا جدول أشخاص" }; sum(); continue; }

      const before = byKey.size;
      const declared = declaredTotal(doc);
      let seen = await readList(path, label, label);
      report[label] = { rows: byKey.size - before, note: declared ? `النظام يعلن ${declared}` : "" };
      sum();

      // لم نبلغ ما يعلنه النظام: نعيد القراءة لكل خيار في كل فلتر
      const filters = filtersOf(doc);
      const short = declared && seen < declared * 0.95;
      if ((short || !seen) && filters.length) {
        for (const f of filters) {
          if (stopped) break;
          for (let i = 0; i < f.options.length && !stopped; i++) {
            const o = f.options[i];
            say(`${label} — ${f.label.slice(0, 20)}: ${o.t.slice(0, 22)} (${i + 1}/${f.options.length})`);
            const sep = path.includes("?") ? "&" : "?";
            try {
              seen += await readList(`${path}${sep}${encodeURIComponent(f.name)}=${encodeURIComponent(o.v)}`,
                `${label}/${o.t.slice(0, 14)}`, label, /دوره|دورة|مرحل/.test(f.label) ? o.t : "");
            } catch (e) { /* خيار لا يقبله النظام: يُتجاوز */ }
          }
          if (declared && seen >= declared) break;   // اكتمل العدد
        }
        report[label] = { rows: byKey.size - before, note: declared ? `النظام يعلن ${declared}، جُمع ${seen}` : `جُمع ${seen}` };
        sum();
      }
    }

    const out = [...byKey.values()].map((r) => {
      const en = (r["_التحاقات"] || []).filter((e) => e["الدورة"] || e["المسار"]);
      const courses = [...new Set(en.map((e) => e["الدورة"]).filter(Boolean))];
      return Object.assign({}, r, {
        "_مصادر": r["_مصادر"].join("، "),
        "_التحاقات": en.map((e) => ({ "الدورة": e["الدورة"], "المسار": e["المسار"], "المجموعة": e["المجموعة"], "الحالة": e["الحالة"], "المصدر": e["المصدر"] })),
        "عدد الدورات": courses.length,
        "الدورات السابقة": courses.join("، "),
      });
    });
    if (!out.length) {
      say("لم يُعثر على أي جدول أشخاص. افتح صفحة الطلاب أو المتقدمين يدوياً ثم أعد التشغيل.");
      return;
    }
    const withNid = out.filter((r) => r["رقم الهوية"]).length;
    const cols = new Set();
    out.forEach((r) => Object.keys(r).forEach((k) => cols.add(k)));
    const repeat = out.filter((r) => (r["عدد الدورات"] || 0) > 1).length;
    say(`تمّ: ${out.length} شخصاً، منهم ${withNid} برقم هوية · ${cols.size} حقلاً · ${repeat} التحقوا بأكثر من دورة`);
    sum();

    const blob = new Blob([JSON.stringify({ source: "tamkeen.ksach.org", at: new Date().toISOString(), count: out.length, rows: out })],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dl = document.createElement("a");
    dl.href = url;
    dl.download = "نظام-المركز-الطلاب.json";
    document.body.appendChild(dl);
    dl.click();

    btn("⬇ تنزيل مرة أخرى", () => dl.click());
    btn("إغلاق", () => { URL.revokeObjectURL(url); box.remove(); });
    console.log("أشخاص النظام:", out);
    console.log("تقرير القراءة:", report);
  } catch (e) {
    say("تعذّر: " + e.message);
    btn("إغلاق", () => box.remove());
  }
})();
