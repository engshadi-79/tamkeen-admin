/* مُولَّد من tools/ksach-runner.js — لا تعدّله هنا. */
/* وكيل أوامر نظام المركز — يُشغَّل في Console داخل https://tamkeen.ksach.org
   وأنت مسجّل دخولك. يقرأ ملف الأوامر الذي ينشئه تمكين (ksach-commands.json)
   وينفّذه في جلستك أنت، ثم يُنزّل ملف النتائج (ksach-results.json).

   حدوده:
   - لا يطلب كلمة مرور ولا يقرأ كوكيز ولا يخزّن رمز الجلسة.
   - لا يرسل إلا أنواع طلبات محددة (انظر ALLOW) وأي غيرها يُرفض.
   - لا يكتب شيئاً قبل أن تضغط «نفّذ» بعد أن ترى جدول المعاينة.
   - يتجاوز من هو مسجَّل أصلاً (بالبحث برقم الهوية) فلا يُكرّر أحداً.
   - يتوقف عند ثلاثة إخفاقات متتالية، ويمكنك إيقافه في أي لحظة. */
window.__kxStart = async () => {
  if (!/(^|\.)ksach\.org$/.test(location.hostname) && !window.__KX_TEST) {
    alert("شغّل هذا السكربت داخل موقع نظام المركز.");
    return;
  }

  /* ===== حدود ما يُسمح بإرساله ===== */
  const ALLOW = [
    ["GET", /^\/admin\/students(\?[^#]*)?$/],     // قائمة الطلاب والبحث
    ["GET", /^\/admin\/students\/create$/],       // نموذج الإضافة (لجلب رمز الحماية طازجاً)
    ["GET", /^\/admin\/students\/\d+\/edit$/],   // بيانات طالب كاملة — قراءة فقط، لا يُرسَل منها شيء
    ["POST", /^\/admin\/students$/],              // إضافة طالب
    ["GET", /^\/admin\/student-pledges(\?[^#]*)?$/],         // قائمة تعهدات الطلاب (قراءة فقط)
    ["GET", /^\/admin\/evaluation-submissions(\?[^#]*)?$/],  // قائمة إرسالات الاستبيانات (قراءة فقط)
    ["GET", /^\/admin\/reports\/evaluation-missing-submissions(\?[^#]*)?$/],  // تقرير «لم يعبئوا الاستبيان» (قراءة فقط)
    ["GET", /^\/admin\/evaluation-impact-reports\/(summary|pre-post|impact|questions|responses)(\?[^#]*)?$/],  // إحصاءات قياس الأثر (قراءة فقط)
    ["GET", /^\/admin\/training-attendances(\?[^#]*)?$/],          // قائمة جلسات الحضور (قراءة فقط)
    ["GET", /^\/admin\/training-attendances\/\d+\/edit$/],       // حضور جلسة واحدة — قراءة فقط، لا يُحفَظ منه شيء
    ["GET", /^\/admin\/students\/export-excel(\?[^#]*)?$/],
    // إلغاء طلب طالب وإخراجه من مجموعته (أمر cancel — بعد معاينة وموافقة صريحة فقط)
    ["GET", /^\/admin\/applications\/\d+$/],                       // صفحة الطلب: الحالة الحالية ونموذج «تغيير الحالة السريع»
    ["POST", /^\/admin\/applications\/\d+\/change-status$/],      // تغيير حالة الطلب (PATCH عبر _method)
    ["GET", /^\/admin\/training-groups(\?[^#]*)?$/],                // صفحة المجموعات: عضوية الطالب ونموذج «إخراج»
    ["POST", /^\/admin\/training-groups\/members\/\d+$/],
    // أوامر كتابة 1.6.0 (كلها بعد معاينة وموافقة صريحة فقط)
    ["GET", /^\/admin\/applications(\?[^#]*)?$/],
    ["GET", /^\/admin\/applicants(\?[^#]*)?$/],                      // قائمة المتقدمين والبحث فيها (قراءة) — 1.6.1                    // قائمة الطلبات (قراءة)
    ["POST", /^\/admin\/students\/bulk-update-status$/],           // تغيير حالة الطالب (طالب واحد في كل طلب)
    ["POST", /^\/admin\/training-groups\/assign$/],                // نقل الطالب إلى مجموعة
    ["POST", /^\/admin\/students\/\d+$/],                          // حفظ نموذج «تعديل» الطالب (PUT عبر _method)          // إخراج الطالب من المجموعة (DELETE عبر _method)     // ملف «تصدير Excel» نفسه (بيانات الطالب والمتقدم) — قراءة فقط، طلب واحد بدل صفحة لكل طالب
  ];
  const guard = (method, path) => {
    const u = new URL(path, location.origin);
    const p = u.pathname + u.search;
    if (u.origin !== location.origin || !ALLOW.some(([m, re]) => m === method && re.test(p))) {
      throw new Error("طلب غير مسموح: " + method + " " + p);
    }
  };

  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  /* في تبويب خلفي تُبطئ Chrome مؤقتات الصفحة (حتى مرة في الدقيقة بعد خمس دقائق)، فمع الإضافة
     يُنفَّذ الانتظار في خلفية الإضافة التي لا تُبطَّأ. وفي Console العادي يبقى setTimeout. */
  const sleep = (ms) => {
    const local = () => new Promise((r) => setTimeout(r, ms));
    if (window.__kxRemote && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try { return Promise.resolve(chrome.runtime.sendMessage({ type: "sleep", ms })).then(() => {}, local); } catch (e) { return local(); }
    }
    return local();
  };
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const digits = (s) => String(s == null ? "" : s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  const GET_GAP = 700, POST_GAP = 1500, MAX_ROWS = 300, MAX_FAILS = 3, MAX_DETAILS = 400;

  /* ===== اللوحة ===== */
  let stopped = false;
  const h = (tag, props, kids) => {
    const el = document.createElement(tag);
    Object.assign(el, props || {});
    (kids || []).forEach((k) => el.append(k));
    return el;
  };
  const box = h("div");
  box.dir = "rtl";
  box.style.cssText = "position:fixed;inset-block-start:14px;inset-inline-start:14px;z-index:2147483647;" +
    "background:#14284B;color:#fff;font:14px/1.7 system-ui,'Segoe UI',sans-serif;padding:14px 16px;" +
    "border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);width:460px;max-height:86vh;overflow:auto";
  const title = h("b", { textContent: "وكيل أوامر تمكين" });
  title.style.fontSize = "15px";
  const sayEl = h("div"); sayEl.style.cssText = "margin-top:6px;opacity:.95";
  const logEl = h("div"); logEl.style.cssText = "margin-top:8px;font-size:12.5px;opacity:.88;max-height:120px;overflow:auto";
  const bodyEl = h("div"); bodyEl.style.marginTop = "8px";
  const actEl = h("div"); actEl.style.marginTop = "10px";
  box.append(title, sayEl, bodyEl, logEl, actEl);
  document.body.appendChild(box);
  // مع أكثر من أمر نبدأ الرسالة بـ [رقم/عدد] ليعرض تمكين شريط التقدّم الكلي
  const say = (t) => {
    sayEl.textContent = t;
    const c = window.__kxCmd;
    if (typeof window.__kxProgress === "function") window.__kxProgress(c && c.n > 1 ? "[" + c.i + "/" + c.n + "] " + t : t);
  };
  const log = (t) => { const d = h("div", { textContent: t }); logEl.prepend(d); };
  const btn = (label, fn, kind) => {
    const b = h("button", { textContent: label });
    b.style.cssText = "margin-inline-end:8px;padding:7px 14px;border:0;border-radius:8px;cursor:pointer;font:inherit;" +
      (kind === "go" ? "background:#1d8f85;color:#fff" : "background:#e6e9ef;color:#14284B");
    b.onclick = fn;
    return b;
  };
  const stopBtn = btn("إيقاف", () => { stopped = true; say("أُوقف. تُحفظ النتائج حتى هنا."); }, "");
  // يطلب تمكين الإيقاف عبر الإضافة (زر «إيقاف» في صفحة تمكين): نحفظ ما اكتمل ونعيده
  window.__kxStop = () => { stopped = true; say("أُوقف بطلبك. تُحفظ النتائج حتى هنا."); };
  const wait = (label, kind) => new Promise((resolve) => {
    const go = btn(label, () => { actEl.replaceChildren(stopBtn); resolve(true); }, kind || "go");
    const no = btn("تخطّي", () => { actEl.replaceChildren(stopBtn); resolve(false); }, "");
    actEl.replaceChildren(go, no, stopBtn);
  });

  /* ===== الشبكة ===== */
  async function http(method, path, body) {
    guard(method, path);
    const res = await fetch(path, { method, body, credentials: "same-origin", redirect: "follow" });
    if (/\/login/i.test(new URL(res.url).pathname)) throw new Error("انتهت الجلسة — سجّل الدخول ثم أعد التشغيل");
    if (res.status === 419) throw new Error("انتهى رمز الحماية (419) — أعد المحاولة");
    if (res.status === 404) throw new Error("الصفحة غير موجودة (404)");
    if (res.status === 403) throw new Error("ليست لديك صلاحية لهذه الصفحة (403)");
    if (res.status >= 500) throw new Error("خطأ من الخادم HTTP " + res.status);
    return { res, doc: parse(await res.text()) };
  }

  /* ===== قراءة جدول الطلاب ===== */
  const cellText = (td) => {
    const c = td.cloneNode(true);
    c.querySelectorAll("form,.modal,button,script,style,svg").forEach((x) => x.remove());
    return clean(c.textContent);
  };
  function tableRows(doc) {
    let best = null, bestN = 0;
    doc.querySelectorAll("table").forEach((t) => {
      const n = t.querySelectorAll("tbody tr").length;
      if (n > bestN) { best = t; bestN = n; }
    });
    if (!best) return { heads: [], rows: [] };
    const allHeads = [...best.querySelectorAll("thead th")].map((th) => clean(th.textContent));
    const keep = allHeads.map((h) => !/إجراء|عمليات|خيارات|actions?/i.test(h));     // أعمدة الأزرار بلا قيمة
    const heads = allHeads.filter((h, i) => keep[i]);
    const rows = [...best.querySelectorAll("tbody tr")].map((tr) => {
      const cells = [...tr.children].map(cellText).filter((c, i) => keep[i] !== false);
      let id = "";
      tr.querySelectorAll("a[href]").forEach((a) => {
        const m = a.getAttribute("href").match(/\/admin\/students\/(\d+)(?:[?#]|$)/);
        if (m && !id) id = m[1];
      });
      const by = {};
      if (heads.length === cells.length) heads.forEach((k, i) => { if (k && cells[i]) by[k] = cells[i]; });
      return { id, cells, by };
    }).filter((r) => r.cells.some(Boolean));
    return { heads, rows };
  }
  const nextPath = (doc) => {
    const a = doc.querySelector('a[rel="next"]');
    if (!a) return "";
    const u = new URL(a.getAttribute("href"), location.origin);
    return u.pathname + u.search;
  };
  const qs = (o) => Object.keys(o).filter((k) => o[k] !== "" && o[k] != null && !(Array.isArray(o[k]) && !o[k].length))
    .map((k) => (Array.isArray(o[k]) ? o[k].map((v) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&") : encodeURIComponent(k) + "=" + encodeURIComponent(o[k]))).join("&");

  /* ===== الأوامر ===== */
  /* بيانات الطالب من نموذج تعديله: لكل حقل عنوانه وقيمته كما تُعرض (نص الخيار المحدَّد
     لا رمزه). لا كلمات مرور ولا رموز حماية ولا ملفات. */
  const SKIP_FIELD = /^(_token|_method|password|password_confirmation|must_change_password|clear_password)$/;
  function fieldLabel(el, doc) {
    const id = el.getAttribute("id");
    let t = "";
    if (id) { const l = doc.querySelector('label[for="' + CSS.escape(id) + '"]'); if (l) t = clean(l.textContent); }
    if (!t) { const l = el.closest("label"); if (l && !l.querySelector("select,textarea")) t = clean(l.textContent); }
    if (!t) {
      const row = el.closest(".form-group, .mb-3, .col, td, div");
      const l = row && row.querySelector("label, .form-label, th");
      if (l) t = clean(l.textContent);
    }
    return t.replace(/\s*\*\s*$/, "").slice(0, 60);
  }
  function readStudentForm(doc) {
    const form = [...doc.querySelectorAll("form")].find((f) => f.querySelector('[name="full_name"]'));
    const out = {};
    if (!form) return out;
    const seenRadio = new Set();
    form.querySelectorAll("input,select,textarea").forEach((el) => {
      const name = el.getAttribute("name");
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (!name || SKIP_FIELD.test(name) || ["hidden", "file", "submit", "button", "image", "password"].includes(type)) return;
      const key = fieldLabel(el, doc) || name;
      let v = "";
      if (el.tagName === "SELECT") {
        const o = el.options[el.selectedIndex];
        v = o && o.value !== "" ? clean(o.textContent) : "";
      } else if (type === "checkbox") {
        v = el.checked ? "نعم" : "لا";
      } else if (type === "radio") {
        if (seenRadio.has(name)) return;
        seenRadio.add(name);
        const on = form.querySelector('input[type="radio"][name="' + CSS.escape(name) + '"]:checked');
        v = on ? clean((on.closest("label") || {}).textContent || on.value) : "";
      } else {
        v = clean(el.value);
      }
      if (key in out && out[key]) return;
      out[key] = v;
    });
    return out;
  }

  const results = [];
  const save = () => {
    const blob = new Blob([JSON.stringify({ v: 1, at: new Date().toISOString(), results }, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "ksach-results.json" });
    document.body.appendChild(a); a.click(); a.remove();
  };

  async function lookupByNid(nid) {
    await sleep(GET_GAP);
    const { doc } = await http("GET", "/admin/students?" + qs({ q: nid, per_page: "20" }));
    const t = tableRows(doc);
    return t.rows.filter((r) => digits(r.cells.join(" ")).includes(nid));
  }

  /* «كل البيانات»: صفحة تعديل كل طالب تُقرأ (GET فقط) وتُلحَق أعمدتها بالجدول.
     out = { heads, rows:[{id, cells}] }؛ يُعدَّل في مكانه ويُضاف out.details. */
  async function addDetails(out, max) {
    const targets = out.rows.filter((r) => r.id).slice(0, max);
    const extra = [];
    let fails = 0;
    for (let i = 0; i < targets.length && !stopped; i++) {
      say("قراءة بيانات الطالب " + (i + 1) + " من " + targets.length);
      try {
        await sleep(GET_GAP);
        const { doc } = await http("GET", "/admin/students/" + targets[i].id + "/edit");
        targets[i].detail = readStudentForm(doc);
        if (!Object.keys(targets[i].detail).length) { delete targets[i].detail; throw new Error("لا نموذج بيانات في الصفحة"); }
        Object.keys(targets[i].detail).forEach((k) => { if (!extra.includes(k)) extra.push(k); });
        fails = 0;
      } catch (e) {
        if (/الجلسة/.test(e.message)) throw e;
        fails++;
        log("تعذّرت بيانات الطالب " + targets[i].id + ": " + e.message);
        if (fails >= MAX_FAILS) { log("توقّفت القراءة بعد " + MAX_FAILS + " إخفاقات متتالية."); break; }
      }
    }
    // أعمدة التفاصيل بعد أعمدة الجدول، دون تكرار عنوان موجود فيه
    const read = targets.filter((r) => r.detail).length;
    const have = new Set(out.heads);
    const cols = extra.filter((k) => !have.has(k));
    out.heads = out.heads.concat(cols);
    out.rows.forEach((r) => { r.cells = r.cells.concat(cols.map((k) => (r.detail && r.detail[k]) || "")); delete r.detail; });
    out.details = { read, of: out.rows.length, capped: out.rows.length > max };
    if (!read && targets.length) out.details.error = "تعذّرت قراءة صفحات بيانات الطلاب (تحقق من صلاحياتك).";
    log("بيانات كاملة لـ" + read + " طالباً.");
  }

  /* ملف «تصدير Excel» من صفحة الطلاب كما ينزله زرّها، بالمرشحات نفسها (track_id/training_course_id/status/group_status).
     طلب GET واحد، يعيد الملف base64 لتمكين ليقرأه على جهازك. يُرفض ما ليس ملف xlsx. لا شيء يُكتب في النظام. */
  const MAX_EXPORT = 20 * 1024 * 1024;
  async function cmdExport(cmd, index) {
    const out = { index, type: "export", label: cmd.label || "", name: "students-export.xlsx", bytes: 0, b64: "" };
    say("جلب ملف التصدير…");
    await sleep(GET_GAP);
    const params = cmd.params || {}, path = "/admin/students/export-excel" + (Object.keys(params).length ? "?" + qs(params) : "");
    guard("GET", path);
    const res = await fetch(path, { credentials: "same-origin", redirect: "follow" });
    if (/\/login/i.test(new URL(res.url).pathname)) throw new Error("انتهت الجلسة — سجّل الدخول ثم أعد التشغيل");
    if (res.status === 404) throw new Error("الصفحة غير موجودة (404)");
    if (res.status === 403) throw new Error("ليست لديك صلاحية لتصدير الطلاب (403)");
    if (res.status >= 500) throw new Error("خطأ من الخادم HTTP " + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("لم يرجع النظام ملف Excel (قد يكون المرشح غير مدعوم أو انتهت الجلسة).");
    if (buf.length > MAX_EXPORT) throw new Error("ملف التصدير كبير جداً (" + Math.round(buf.length / 1048576) + " ميغابايت): ضيّق المرشح بالمسار أو الدورة.");
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out.b64 = btoa(bin); out.bytes = buf.length;
    const cd = res.headers.get("content-disposition") || "", m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd); if (m) { try { out.name = decodeURIComponent(m[1]); } catch (e) { out.name = m[1]; } }
    log("ملف التصدير: " + buf.length + " بايت");
    return out;
  }

  /* البحث في ثلاث صفحات (1.6.1): الطلاب، والمتقدمون، والطلبات. اسم حقل البحث يُقرأ من نموذج الصفحة نفسها */
  const LOOK_SRC = { students: { path: "/admin/students", label: "طالب" }, applicants: { path: "/admin/applicants", label: "متقدم" }, applications: { path: "/admin/applications", label: "طلب" } };
  const searchField = {};
  async function searchFieldOf(src) {
    if (searchField[src]) return searchField[src];
    let name = "q";
    if (src !== "students") {
      try {
        await sleep(GET_GAP);
        const { doc } = await http("GET", LOOK_SRC[src].path);
        const f = [...doc.querySelectorAll("form")].find((x) => (x.getAttribute("method") || "get").toLowerCase() === "get" && new URL(x.getAttribute("action") || LOOK_SRC[src].path, location.origin).pathname === LOOK_SRC[src].path);
        const inp = f && [...f.querySelectorAll("input[name]")].find((x) => /^(text|search|)$/i.test(x.getAttribute("type") || ""));
        if (inp) name = inp.getAttribute("name");
      } catch (e) { if (/الجلسة/.test(e.message)) throw e; }
    }
    return (searchField[src] = name);
  }
  /* رقم بفرق خانة واحدة (خطأ قراءة): نفس الطول ورقم واحد مختلف */
  const nearNum = (a, b) => { if (a.length !== b.length || a.length < 8) return false; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return true; };
  const rowNums = (r) => (r.cells.join(" ").match(/\d{8,}/g) || []).map((x) => (/^5\d{8}$/.test(x) ? "0" + x : x));
  async function cmdLookup(cmd, index) {
    const out = { index, type: "lookup", label: cmd.label || "", items: [] };
    for (const it of cmd.items || []) {
      if (stopped) break;
      const srcs = (it.sources || cmd.sources || ["students"]).filter((x) => LOOK_SRC[x]);
      const isNum = digits(it.q).length >= 9 && digits(it.q) === String(it.q).replace(/\s/g, ""), dq = digits(it.q);
      const item = { q: it.q, count: 0, heads: [], rows: [], parts: [] };
      for (const src of srcs) {
        if (stopped) break;
        say("استعلام: " + it.q + (srcs.length > 1 ? " — " + LOOK_SRC[src].label : ""));
        const field = await searchFieldOf(src);
        await sleep(GET_GAP);
        const { doc } = await http("GET", LOOK_SRC[src].path + "?" + qs(Object.assign({ [field]: it.q }, src === "applicants" ? {} : { per_page: "100" })));
        const t = tableRows(doc);
        // رقم: الطلاب بالرقم نفسه؛ والمتقدمون بالرقم أو بفرق خانة؛ والطلبات بلا أرقام في الجدول فيُعتمد بحث النظام نفسه
        const rows = !isNum ? t.rows : src === "applications" ? t.rows : t.rows.filter((r) => digits(r.cells.join(" ")).includes(dq) || (src === "applicants" && rowNums(r).some((n) => nearNum(n, dq))));
        if (src === "students") { item.heads = t.heads; item.rows = rows.slice(0, 30); }
        if (rows.length) item.parts.push({ source: src, heads: t.heads, rows: rows.slice(0, 30) });
        item.count += rows.length;
      }
      if (cmd.details && item.rows.length && !stopped) await addDetails(item, 10);
      out.items.push(item);
      log((item.count ? "وُجد " + item.count : "لا نتيجة") + " ← " + it.q);
    }
    return out;
  }

  async function cmdList(cmd, index) {
    const out = { index, type: "list", label: cmd.label || "", params: cmd.params || {}, heads: [], rows: [] };
    // المصدر: الطلاب (الافتراضي) أو التعهدات أو إرسالات الاستبيانات. الأخيران لا يُرسَل لهما per_page.
    const SOURCES = { students: "/admin/students", pledges: "/admin/student-pledges", submissions: "/admin/evaluation-submissions", missing: "/admin/reports/evaluation-missing-submissions" };
    const base = SOURCES[cmd.source || "students"];
    if (!base) throw new Error("مصدر قائمة غير معروف");
    let path = base + "?" + qs(Object.assign(base === SOURCES.students ? { per_page: "100" } : {}, cmd.params || {}));
    for (let page = 1; path && page <= 60 && !stopped; page++) {
      say("قراءة القائمة — صفحة " + page + " (" + out.rows.length + " صفاً)");
      await sleep(GET_GAP);
      const { doc } = await http("GET", path);
      const t = tableRows(doc);
      if (!out.heads.length) out.heads = t.heads;
      out.rows.push(...t.rows);
      path = nextPath(doc);
    }
    log("القائمة: " + out.rows.length + " صفاً");

    if (cmd.details && !stopped) await addDetails(out, MAX_DETAILS);
    return out;
  }

  /* ===== صفحات تقارير للقراءة فقط: كل جداولها وأرقامها وقوائم التصفية فيها =====
     لا نعرف بنية كل صفحة سلفاً، فنقرأ عامّاً: كل جدول بعنوانه، والأرقام الظاهرة في البطاقات، وحقول نموذج التصفية (لمعرفة
     معاملات الرابط المتاحة). الطلب GET واحد (مع متابعة ترقيم الصفحات على أكبر جدول)، وللرابط المسموح به فقط (ALLOW). */
  const PAGES = { impact: "/admin/evaluation-impact-reports/summary", "pre-post": "/admin/evaluation-impact-reports/pre-post", "impact-m": "/admin/evaluation-impact-reports/impact", questions: "/admin/evaluation-impact-reports/questions", responses: "/admin/evaluation-impact-reports/responses" };
  /* عنوان التبويب الذي يحوي الجدول (إن كان داخل لوح تبويب) */
  const paneLabel = (el) => {
    const pane = el.closest(".tab-pane, [role=tabpanel], .accordion-collapse, .collapse");
    if (!pane) return "";
    const doc = el.ownerDocument, id = pane.id; let a = null;
    if (id) a = doc.querySelector('[href="#' + CSS.escape(id) + '"], [data-bs-target="#' + CSS.escape(id) + '"], [data-target="#' + CSS.escape(id) + '"], [aria-controls="' + CSS.escape(id) + '"]');
    if (!a && pane.getAttribute("aria-labelledby")) a = doc.getElementById(pane.getAttribute("aria-labelledby"));
    return a ? clean(a.textContent).slice(0, 80) : "";
  };
  const headingOf = (el) => {
    const h = headingBase(el), p = paneLabel(el);
    return [p, h].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" — ").slice(0, 160);
  };
  /* أقرب نص يسبق العنصر في الصفحة (مثل نص السؤال فوق بطاقة أرقامه)، صعوداً عبر الحاويات */
  const prevText = (el, max) => {
    for (let n = el, d = 0; n && n.parentElement && d < 6; n = n.parentElement, d++) {
      for (let q = n.previousElementSibling, i = 0; q && i < 3; q = q.previousElementSibling, i++) {
        const t = clean(q.textContent);
        if (t && t.length >= 4 && t.length <= max && /[^\d\s.,%]/.test(t) && !q.querySelector("table, form, select, input")) return t;
      }
    }
    return "";
  };
  const headingBase = (el, max) => {
    max = max || 120;
    const cap = el.querySelector("caption");
    if (cap && clean(cap.textContent)) return clean(cap.textContent).slice(0, 120);
    const card = el.closest(".card, section, .box, .panel");
    if (card) { const t = card.querySelector(".card-header, .card-title, .box-title, h1, h2, h3, h4, h5, h6"); if (t && !t.contains(el)) return clean(t.textContent).slice(0, 120); }
    let p = el.previousElementSibling;
    for (let i = 0; p && i < 4; i++, p = p.previousElementSibling) { if (/^H[1-6]$/.test(p.tagName)) return clean(p.textContent).slice(0, 120); }
    /* احتياطاً: أقرب نص قصير قبل الجدول أو قبل حاويته (عنوان بلا وسم عنوان) */
    for (let n = el, d = 0; n && n.parentElement && d < 5; n = n.parentElement, d++) {
      for (let q = n.previousElementSibling, i = 0; q && i < 3; q = q.previousElementSibling, i++) {
        const t = clean(q.textContent);
        if (t && t.length <= max && !q.querySelector("table, form, select, input")) return t;
      }
    }
    return "";
  };
  function tablesOf(doc) {
    return [...doc.querySelectorAll("table")].map((t) => {
      let allHeads = [...t.querySelectorAll("thead th")].map((th) => clean(th.textContent));
      let trs = [...t.querySelectorAll("tbody tr")];
      if (!allHeads.length) { const first = t.querySelector("tr"); if (first) { allHeads = [...first.children].map((c) => clean(c.textContent)); trs = [...t.querySelectorAll("tr")].slice(1); } }
      const keep = allHeads.map((h) => !/إجراء|عمليات|خيارات|actions?/i.test(h));
      const heads = allHeads.filter((h, i) => keep[i]);
      const rows = trs.map((tr) => ({ cells: [...tr.children].map(cellText).filter((c, i) => keep[i] !== false) })).filter((r) => r.cells.some(Boolean));
      return { title: headingOf(t), heads, rows };
    }).filter((t) => t.heads.length && t.rows.length);
  }
  /* صفحة «إحصائيات الأسئلة»: بطاقة لكل سؤال (نص السؤال، النموذج، عدد الإجابات، المتوسط، النوع، وتوزيع الدرجات) */
  function questionsOf(doc) {
    const all = [...doc.querySelectorAll("body *")];
    const isLeaf = (el) => /عدد الإجابات/.test(el.textContent) && ![...el.children].some((c) => /عدد الإجابات/.test(c.textContent));
    const leaves = all.filter(isLeaf);
    const heads = ["السؤال", "النموذج", "النوع", "عدد الإجابات", "المتوسط", "1", "2", "3", "4", "5", "التوزيع"];
    const rows = [], seen = new Set();
    leaves.forEach((leaf) => {
      let card = leaf;
      while (card.parentElement && card.parentElement !== doc.body && leaves.filter((l) => card.parentElement.contains(l)).length === 1) card = card.parentElement;
      if (seen.has(card)) return; seen.add(card);
      const parts = [...card.querySelectorAll("*")].filter((e) => !e.children.length).map((e) => clean(e.textContent)).filter(Boolean);
      const txt = clean(card.textContent);
      const num = (re) => { const m = txt.match(re); return m ? m[1] : ""; };
      const question = parts[0] || "", form = parts[1] && !/عدد الإجابات|المتوسط|النوع/.test(parts[1]) ? parts[1] : "";
      const typeLeaf = (parts.find((x) => /^النوع/.test(x)) || "").replace(/^النوع\s*:?\s*/, "");
      const type = typeLeaf || (txt.match(/النوع\s*:\s*([^:]*?)(?=\s*(?:\d+\s+\d+|$))/) || [])[1] || "";
      const after = parts.slice(parts.findIndex((x) => /^النوع/.test(x)) + 1);
      const dist = [];
      for (let i = 0; i + 1 < after.length; i += 2) if (/^[\d٠-٩]+$/.test(after[i]) && /^[\d٠-٩.,%]+$/.test(after[i + 1])) dist.push([after[i], after[i + 1]]); else break;
      const g = (k) => (dist.find((d) => d[0] === k) || [])[1] || "";
      rows.push({ cells: [question, form, clean(type), num(/عدد الإجابات\s*:\s*([\d٠-٩.,]+)/), num(/المتوسط\s*:\s*([\d٠-٩.,]+)/), g("1"), g("2"), g("3"), g("4"), g("5"), dist.map((d) => d[0] + ": " + d[1]).join(" | ")] });
    });
    return { title: "الأسئلة ونتائجها", heads, rows };
  }
  function statsOf(doc) {
    const out = [], seen = new Set();
    doc.querySelectorAll(".card, .stat, .stats-card, .small-box, .info-box, .metric, [class*='stat-'], [class*='kpi']").forEach((el) => {
      if (el.querySelector("table")) return;
      const t = clean(el.textContent);
      if (!t || t.length > 90 || seen.has(t)) return;
      const m = t.match(/^(.*?)(-?[\d٠-٩][\d٠-٩.,]*%?)(.*)$/);
      if (!m) return;
      const label = clean(m[1] + " " + m[3]);
      if (!label) return;
      seen.add(t); out.push({ label: label.slice(0, 70), value: m[2] });
    });
    return out.slice(0, 40);
  }
  function filtersOf(doc) {
    const form = [...doc.querySelectorAll("form")].find((f) => (f.getAttribute("method") || "get").toLowerCase() === "get" && f.querySelector("select, input[type=date]"));
    if (!form) return [];
    const groups = {};
    const list = [...form.querySelectorAll("select, input")].map((el) => {
      const name = el.getAttribute("name"), type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (!name || name === "_token" || ["hidden", "submit", "button"].includes(type)) return null;
      if (type === "checkbox" || type === "radio") {
        const lab = el.closest("label"), id = el.getAttribute("id"), l2 = id && doc.querySelector('label[for="' + CSS.escape(id) + '"]');
        const opt = { v: el.value, t: clean((lab || l2 || {}).textContent || el.value), on: el.checked };
        if (!groups[name]) { const fs = el.closest("fieldset"), lg = fs && fs.querySelector("legend"); groups[name] = { name, label: (lg ? clean(lg.textContent) : "") || name, type: "checkbox", value: [], options: [] }; }
        groups[name].options.push(opt); if (el.checked) groups[name].value.push(el.value);
        return groups[name].options.length === 1 ? groups[name] : null;
      }
      const f = { name, label: fieldLabel(el, doc) || name, type: el.tagName === "SELECT" ? "select" : type, value: el.tagName === "SELECT" ? ((el.options[el.selectedIndex] || {}).value || "") : el.value };
      if (el.tagName === "SELECT") f.options = [...el.options].slice(0, 80).map((o) => ({ v: o.value, t: clean(o.textContent) }));
      return f;
    }).filter(Boolean).slice(0, 20);
    return list;
  }
  /* ===== الحضور والغياب: جلسات الفترة (الحاصلة على سجلات) ثم حضور كل جلسة. للقراءة فقط ===== */
  async function cmdAttendance(cmd, index) {
    const base = "/admin/training-attendances";
    const out = { index, type: "attendance", label: cmd.label || "", params: cmd.params || {}, sessions: [], listed: 0, truncated: false, note: "" };
    const cap = Math.max(1, Math.min(Number(cmd.max) || 80, 200));
    say("قراءة قائمة الجلسات…");
    await sleep(GET_GAP);
    let { doc } = await http("GET", base + "?" + qs(cmd.params || {}));
    const codes = (cmd.groupCodes || []).map(clean), names = (cmd.trackNames || []).map(clean), stages = cmd.stages || [];
    const stageOfCode = (c) => (/^S3/i.test(c) ? "الثالث" : /^G\d/i.test(c) ? "الثان" : "الاولى");
    const gsel = doc.querySelector('select[name="training_group_id"]');
    let targets = [null];
    if (gsel && (codes.length || names.length || stages.length)) {
      targets = [...gsel.options].filter((o) => {
        if (!o.value) return false;
        const t = clean(o.textContent), code = clean(t.split(" - ").pop());
        return (!codes.length || codes.includes(code)) && (!names.length || names.some((n) => t.includes(n))) && (!stages.length || stages.includes(stageOfCode(code)));
      }).map((o) => ({ v: o.value, t: clean(o.textContent) }));
      if (!targets.length) { out.note = "لا مجموعة في النظام تطابق الاختيار."; return out; }
    }
    const found = [];
    let pages = 0;
    for (const tg of targets) {
      if (stopped || pages >= 40) break;
      let d = doc;
      if (tg) { say("قراءة جلسات: " + tg.t); await sleep(GET_GAP); ({ doc: d } = await http("GET", base + "?" + qs(Object.assign({}, cmd.params || {}, { training_group_id: tg.v })))); }
      pages++;
      for (let pg = 1; d && pg <= 12 && pages <= 40 && !stopped; pg++) {
        const t = d.querySelector("table");
        if (t) [...t.querySelectorAll("tbody tr")].forEach((tr) => {
          const c = [...tr.children].map((x) => clean(x.textContent)), a = tr.querySelector('a[href*="/edit"]');
          if (!a || c.length < 6) return;
          const href = new URL(a.getAttribute("href"), location.origin).pathname;
          found.push({ id: (href.match(/\/(\d+)\/edit/) || [])[1], path: href, title: c[0], track: c[1], group: c[2], trainer: c[3], date: (c[4] || "").slice(0, 10), records: parseInt(c[5], 10) || 0 });
        });
        const nx = nextPath(d);
        if (!nx) break;
        say("قراءة قائمة الجلسات — صفحة " + (pg + 1)); await sleep(GET_GAP); pages++;
        ({ doc: d } = await http("GET", nx));
      }
    }
    const withRecs = found.filter((s) => s.records > 0 && s.id);
    out.listed = withRecs.length;
    const todo = withRecs.slice(0, cap);
    out.truncated = withRecs.length > todo.length;
    for (let i = 0; i < todo.length && !stopped; i++) {
      const s = todo[i];
      say("قراءة حضور الجلسة " + (i + 1) + " من " + todo.length);
      await sleep(GET_GAP);
      const { doc: sd } = await http("GET", s.path);
      const rows = [];
      sd.querySelectorAll('select[name$="[status]"]').forEach((sel) => {
        const tr = sel.closest("tr"); if (!tr) return;
        const sid = (tr.querySelector('input[name$="[student_id]"]') || {}).value || "";
        const cell = tr.children[0].cloneNode(true);
        cell.querySelectorAll("select, option, input, button, form, a.btn").forEach((n) => n.remove());
        const txt = clean(cell.textContent), stu = (txt.match(/STU-[\d-]+/) || [""])[0];
        rows.push({ sid, name: clean(txt.replace(stu, "")), stu, status: sel.value || ((sel.options[sel.selectedIndex] || {}).value) || "" });
      });
      out.sessions.push({ id: s.id, title: s.title, track: s.track, group: s.group, trainer: s.trainer, date: s.date, rows });
    }
    log("الحضور: " + out.sessions.length + " جلسة من " + out.listed);
    return out;
  }
  async function cmdPage(cmd, index) {
    const base = PAGES[cmd.source];
    if (!base) throw new Error("صفحة تقرير غير معروفة");
    const out = { index, type: "page", source: cmd.source, label: cmd.label || "", params: cmd.params || {}, tables: [], stats: [], filters: [], text: "" };
    say("قراءة التقرير…");
    await sleep(GET_GAP);
    let { doc } = await http("GET", base + "?" + qs(cmd.params || {}));
    /* الصفحة قد تفتح بتصفية افتراضية (مثل مرحلة معيّنة). نريد الجميع ما لم يحدد المستخدم غير ذلك:
       كل قائمة افتُرض لها قيمة غير فارغة ولم يُرسلها المستخدم وفيها خيار «الكل» تُعاد قراءتها بخيار «الكل» (قراءة إضافية واحدة) */
    const widen = {};
    filtersOf(doc).forEach((f) => {
      /* مربعات اختيار محدّدة افتراضياً (مثل مرحلة) ولم يرسلها المستخدم: نتركها كلها بلا تحديد لتشمل الجميع */
      if (f.type === "checkbox" && f.value.length && (cmd.params || {})[f.name] === undefined) { widen[f.name] = { v: [], was: f.options.filter((o) => o.on).map((o) => o.t).join("، "), label: f.label }; return; }
      if (f.type !== "select" || !f.value || (cmd.params || {})[f.name] !== undefined || /^date_(from|to)$/.test(f.name)) return;
      const all = (f.options || []).find((o) => o.v === "") || (f.options || []).find((o) => /^(الكل|جميع|كل)/.test(o.t));
      if (all) widen[f.name] = { v: all.v, was: ((f.options || []).find((o) => o.v === f.value) || {}).t || f.value, label: f.label };
    });
    if (Object.keys(widen).length) {
      say("توسيع التصفية الافتراضية إلى «الكل»…");
      const p2 = Object.assign({}, cmd.params || {});
      Object.keys(widen).forEach((k) => { p2[k] = widen[k].v; });
      await sleep(GET_GAP);
      ({ doc } = await http("GET", base + "?" + qs(p2)));
      out.params = p2;
      out.widened = Object.keys(widen).map((k) => widen[k].label + ": " + widen[k].was + " ← الكل");
    }
    const getTables = (d) => { if (cmd.source === "questions") { const q = questionsOf(d); if (q.rows.length) return [q]; } return tablesOf(d); };
    out.tables = getTables(doc); out.stats = statsOf(doc); out.filters = filtersOf(doc);
    /* نص المحتوى بلا القائمة الجانبية والتصفية */
    const body = (doc.querySelector("main, .content-wrapper, .content, .container-fluid, body") || doc.body).cloneNode(true);
    body.querySelectorAll("aside, nav, header, footer, .sidebar, .main-sidebar, .navbar, script, style, select, form").forEach((n) => n.remove());
    out.text = clean(body.textContent || "").slice(0, 3000);
    /* صفحة بلا جداول (بطاقات ورسوم): كل بطاقة طرفية تصير صفاً «العنوان | المحتوى» */
    if (!out.tables.length) {
      const rows = [];
      body.querySelectorAll(".card, .panel, .box, [class*='question']").forEach((el) => {
        if (el.querySelector(".card, .panel, .box")) return;
        const h = el.querySelector(".card-header, .card-title, .box-title, h1, h2, h3, h4, h5, h6, b, strong");
        const title = (h ? clean(h.textContent).slice(0, 300) : "") || prevText(el, 500);
        const txt = clean(el.textContent).replace(title, "").trim();
        if ((title || txt) && (title + txt).length > 3) rows.push({ cells: [title, txt.slice(0, 500)] });
      });
      if (rows.length) out.tables.push({ title: "محتوى الصفحة", heads: ["العنوان", "المحتوى"], rows: rows.slice(0, 200) });
    }
    const main = out.tables.length ? out.tables.reduce((a, b) => (b.rows.length > a.rows.length ? b : a)) : null;
    let next = nextPath(doc);
    for (let pg = 2; main && next && pg <= 30 && !stopped; pg++) {
      say("قراءة التقرير — صفحة " + pg + " (" + main.rows.length + " صفاً)");
      await sleep(GET_GAP);
      ({ doc } = await http("GET", next));
      const t = getTables(doc).find((x) => x.heads.join("|") === main.heads.join("|"));
      if (!t) break;
      main.rows.push(...t.rows); next = nextPath(doc);
    }
    log("التقرير: " + out.tables.length + " جدول، " + out.stats.length + " رقم");
    return out;
  }

  /* قيم الصف تُطابَق مع قوائم النموذج الحيّ قبل الإرسال */
  function liveForm(doc) {
    const form = [...doc.querySelectorAll("form")].find((f) =>
      (f.getAttribute("method") || "").toLowerCase() === "post" &&
      new URL(f.getAttribute("action") || "", location.origin).pathname === "/admin/students" &&
      f.querySelector('[name="full_name"]'));
    if (!form) throw new Error("لم أجد نموذج إضافة الطالب في الصفحة");
    return form;
  }
  function problems(row, form) {
    const bad = [];
    form.querySelectorAll("select").forEach((s) => {
      const name = s.getAttribute("name");
      if (!(name in row) || row[name] === "") return;
      const ok = [...s.options].some((o) => o.value === String(row[name]));
      if (!ok) bad.push("قيمة «" + row[name] + "» غير موجودة في قائمة " + name);
    });
    return bad;
  }
  function formData(form, row) {
    const fd = new FormData();
    form.querySelectorAll("input,select,textarea").forEach((el) => {
      const name = el.getAttribute("name");
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (!name || ["file", "submit", "button", "image"].includes(type)) return;
      if (/^password/.test(name) || name === "must_change_password") return;     // لا كلمات مرور من الأوامر
      if (type === "checkbox" || type === "radio") { if (el.checked) fd.set(name, el.value); return; }
      fd.set(name, el.value);
    });
    Object.keys(row).forEach((k) => {
      if (row[k] === "" || row[k] == null) return;
      if (/^password/.test(k) || k === "must_change_password" || k.startsWith("_")) return;   // لا كلمات مرور ولا حقول داخلية
      if (!form.querySelector('[name="' + CSS.escape(k) + '"]')) return;                      // لا حقل غير موجود في النموذج الحيّ
      fd.set(k, String(row[k]));
    });
    return fd;
  }

  async function cmdRegister(cmd, index) {
    const out = { index, type: "register", label: cmd.label || "", rows: [] };
    const rows = (cmd.rows || []).slice(0, MAX_ROWS);
    say("معاينة: فحص " + rows.length + " طالباً");

    // 1) معاينة بلا أي كتابة: من هو مسجّل أصلاً؟ ومن بياناته ناقصة؟
    const live = await http("GET", "/admin/students/create");
    const form0 = liveForm(live.doc);
    const plan = [];
    for (const r of rows) {
      if (stopped) break;
      const nid = digits(r.national_id);
      const item = { name: r.full_name || "", nid, state: "create", why: "" };
      const miss = ["full_name", "national_id", "track_id", "status", "gender", "phone_1"].filter((k) => !clean(r[k]));
      const bad = problems(r, form0);
      if (miss.length) { item.state = "invalid"; item.why = "ناقص: " + miss.join("، "); }
      else if (nid.length !== 9) { item.state = "invalid"; item.why = "رقم الهوية ليس 9 أرقام"; }
      else if (bad.length) { item.state = "invalid"; item.why = bad.join("؛ "); }
      else {
        const have = await lookupByNid(nid);
        if (have.length) { item.state = "exists"; item.why = "مسجّل أصلاً"; item.id = have[0].id; }
      }
      plan.push(item);
      say("معاينة " + plan.length + "/" + rows.length);
    }
    const n = (s) => plan.filter((p) => p.state === s).length;
    bodyEl.replaceChildren(h("div", { textContent: "سيُسجَّل: " + n("create") + " — مسجّل أصلاً: " + n("exists") + " — غير صالح: " + n("invalid") }));
    const tbl = h("table"); tbl.style.cssText = "width:100%;font-size:12px;border-collapse:collapse;margin-top:6px";
    plan.slice(0, 60).forEach((p) => {
      const tr = h("tr");
      [p.name, p.nid, p.state === "create" ? "سيُسجَّل" : p.state === "exists" ? "موجود" : "غير صالح: " + p.why]
        .forEach((t) => { const td = h("td", { textContent: t }); td.style.cssText = "padding:2px 6px;border-bottom:1px solid #ffffff26"; tr.append(td); });
      tbl.append(tr);
    });
    bodyEl.append(tbl);

    const todo = plan.filter((p) => p.state === "create");
    plan.forEach((p) => { if (p.state !== "create") out.rows.push({ name: p.name, nid: p.nid, status: p.state === "exists" ? "exists" : "invalid", message: p.why, id: p.id || "" }); });
    if (!todo.length) { log("لا جديد لتسجيله."); return out; }

    // 2) لا كتابة قبل موافقتك
    say("سيُكتب في نظام المركز " + todo.length + " طالباً. راجع الجدول ثم اضغط «نفّذ».");
    // موصول بتمكين عبر الإضافة؟ تظهر الخطة هناك وتُقبل منها، وتبقى أزرار هذه اللوحة بديلاً
    const summary = {
      total: plan.length, create: n("create"), exists: n("exists"), invalid: n("invalid"),
      rows: plan.slice(0, 80).map((p) => ({ name: p.name, nid: p.nid, state: p.state, why: p.why })),
    };
    const local = wait("نفّذ تسجيل " + todo.length + " طالباً", "go");
    const go = typeof window.__kxApprove === "function"
      ? await Promise.race([local, window.__kxApprove(summary)])
      : await local;
    actEl.replaceChildren(stopBtn);
    const markSkipped = (why) => todo.forEach((p) => {
      if (!out.rows.some((r) => r.nid === p.nid)) out.rows.push({ name: p.name, nid: p.nid, status: "skipped", message: why });
    });
    if (!go || stopped) { markSkipped("لم يُنفَّذ (تخطّيت أو أوقفت)"); log("لم يُنفَّذ."); return out; }

    let fails = 0;
    for (const p of todo) {
      if (stopped) break;
      if (fails >= MAX_FAILS) { log("توقّف بعد " + MAX_FAILS + " إخفاقات متتالية."); break; }
      const row = rows.find((r) => digits(r.national_id) === p.nid);
      say("تسجيل: " + p.name);
      try {
        await sleep(POST_GAP);
        const fresh = await http("GET", "/admin/students/create");      // رمز حماية طازج لكل طلب
        const form = liveForm(fresh.doc);
        const post = await http("POST", "/admin/students", formData(form, row));
        const errs = [...post.doc.querySelectorAll(".invalid-feedback,.text-danger,.alert-danger")]
          .map((e) => clean(e.textContent)).filter(Boolean);
        const have = await lookupByNid(p.nid);                           // التحقق الحقيقي: هل ظهر في القائمة؟
        if (have.length) { out.rows.push({ name: p.name, nid: p.nid, status: "created", message: "", id: have[0].id }); fails = 0; log("✓ " + p.name); }
        else if (errs.length) { out.rows.push({ name: p.name, nid: p.nid, status: "failed", message: [...new Set(errs)].slice(0, 4).join(" | ") }); fails++; log("✗ " + p.name + ": " + errs[0]); }
        else { out.rows.push({ name: p.name, nid: p.nid, status: "unverified", message: "لم يظهر في القائمة ولا أخطاء — تحقق يدوياً" }); fails++; log("؟ " + p.name); }
      } catch (e) {
        out.rows.push({ name: p.name, nid: p.nid, status: "failed", message: e.message });
        fails++; log("✗ " + p.name + ": " + e.message);
        if (/الجلسة/.test(e.message)) break;
      }
    }
    markSkipped("لم يُنفَّذ (توقّف الوكيل قبله)");
    return out;
  }

  /* ===== إلغاء طلب الطالب («ملغي») ثم إخراجه من مجموعته إن بقي فيها =====
     cmd = { type:"cancel", items:[{stu, name}], status:"cancelled", removeFromGroup:true }
     1) معاينة بلا كتابة: الطالب برقمه ← رابط طلبه ← حالته الحالية  2) موافقة صريحة (تمكين أو زر اللوحة)
     3) لكل طالب: نموذج الطلب طازجاً (رمز حماية جديد)، يُغيَّر حقل الحالة وحده، ثم تُعاد القراءة للتحقق
     4) يُبحث عنه في صفحة المجموعات؛ إن بقي يُخرج بنموذج «إخراج» نفسه ثم يُتحقَّق. ثلاثة إخفاقات متتالية توقف التنفيذ. */
  const statusOfApp = (doc) => { const f = [...doc.querySelectorAll("form")].find((x) => /\/change-status$/.test(new URL(x.getAttribute("action") || "", location.origin).pathname)); const sel = f && f.querySelector('select[name="status"]'); const o = sel && (sel.querySelector("option[selected]") || sel.options[sel.selectedIndex]); return { form: f, status: o ? o.value : "", label: o ? clean(o.textContent) : "" }; };
  async function findStudentApp(stu) {
    await sleep(GET_GAP);
    const { doc } = await http("GET", "/admin/students?" + qs({ q: stu, per_page: "20" }));
    const tr = [...doc.querySelectorAll("table tbody tr")].find((x) => x.textContent.includes(stu));
    if (!tr) return null;
    const app = [...tr.querySelectorAll("a[href]")].map((a) => new URL(a.getAttribute("href"), location.origin).pathname).find((h) => /^\/admin\/applications\/\d+$/.test(h));
    const sid = ([...tr.querySelectorAll("a[href]")].map((a) => (new URL(a.getAttribute("href"), location.origin).pathname.match(/^\/admin\/students\/(\d+)/) || [])[1]).find(Boolean)) || "";
    return { app: app || "", sid, rowText: clean(tr.textContent) };
  }
  /* عضوية الطالب في صفحة المجموعات: الصفحة الافتراضية ثم بمرشح مسار الطالب */
  async function findMembership(stu, trackHint) {
    const look = (doc) => {
      const f = [...doc.querySelectorAll("form")].find((x) => /\/training-groups\/members\/\d+$/.test(new URL(x.getAttribute("action") || "", location.origin).pathname) && x.closest("div.row, tr, li, .card") && (x.closest("div.row, tr, li, .card").textContent || "").includes(stu));
      return f || null;
    };
    await sleep(GET_GAP);
    let { doc } = await http("GET", "/admin/training-groups");
    let f = look(doc); if (f) return { form: f, url: "/admin/training-groups" };
    const opts = [...doc.querySelectorAll('select[name="track_id"] option')].filter((o) => o.value && trackHint && clean(trackHint).includes(clean(o.textContent).replace(/^مسار\s*/, "")));
    for (const o of opts.slice(0, 2)) {
      const url = "/admin/training-groups?" + qs({ track_id: o.value });
      await sleep(GET_GAP);
      ({ doc } = await http("GET", url));
      f = look(doc); if (f) return { form: f, url };
    }
    return null;
  }
  const formBody = (form, over) => {
    const fd = new FormData();
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
      const t = (el.getAttribute("type") || "").toLowerCase();
      if (/^(password|file|submit|button|image)$/.test(t)) return;
      if ((t === "checkbox" || t === "radio") && !el.checked && !el.hasAttribute("checked")) return;
      const v = el.tagName === "SELECT" ? ((el.querySelector("option[selected]") || el.options[el.selectedIndex] || {}).value || "") : (el.value != null ? el.value : el.getAttribute("value") || "");
      fd.append(el.name, v);
    });
    Object.keys(over || {}).forEach((k) => fd.set(k, over[k]));
    return fd;
  };

  /* ===== أوامر كتابة 1.6.0: حالة الطلب (بأرقام الطلبات)، حالة الطالب، النقل بين المجموعات، تعديل بيانات الطالب =====
     كلها بنفس المسار: معاينة بلا كتابة ← موافقة ← نموذج طازج لكل بند ← كتابة ← تحقّق بالقراءة ← توقف بعد 3 إخفاقات.
     كل صف ناتج يحمل «undo»: البند الذي يعيد الحال كما كان (يستعمله «تراجع» في تمكين). */
  const optName = (t) => clean(t).split(" (")[0].trim();
  const normV = (v) => clean(v).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
  async function writeFlow(cmd, index, type, title, plan, doOne) {
    const out = { index, type, label: cmd.label || "", rows: [] };
    const n = (st) => plan.filter((p) => p.state === st).length;
    plan.filter((p) => p.state !== "do").forEach((p) => out.rows.push({ name: p.name, stu: p.stu, res: p.state === "same" ? "same" : "invalid", from: p.from || "", to: p.to || "", message: p.why || "" }));
    const todo = plan.filter((p) => p.state === "do");
    bodyEl.replaceChildren(h("div", { textContent: title + ": سيُنفَّذ " + n("do") + " — لا تغيير " + n("same") + " — لن يُنفَّذ " + n("invalid") }));
    if (!todo.length) { log("لا شيء يُنفَّذ."); return out; }
    say("سيُكتب في نظام المركز لـ" + todo.length + ". راجع ثم اضغط «نفّذ».");
    const summary = { kind: "write", op: type, title, undo: !!cmd.undo, total: plan.length, todo: n("do"), same: n("same"), invalid: n("invalid"),
      rows: plan.slice(0, 150).map((p) => ({ name: p.name, nid: p.stu, state: p.state, from: p.from || "", to: p.to || "", why: p.why || "" })) };
    const local = wait("نفّذ (" + todo.length + ")", "go");
    const go = typeof window.__kxApprove === "function" ? await Promise.race([local, window.__kxApprove(summary)]) : await local;
    actEl.replaceChildren(stopBtn);
    if (!go || stopped) { todo.forEach((p) => out.rows.push({ name: p.name, stu: p.stu, res: "skipped", from: p.from || "", to: p.to || "", message: "لم يُنفَّذ (تخطّيت أو أوقفت)" })); log("لم يُنفَّذ."); return out; }
    let fails = 0;
    for (const p of todo) {
      if (stopped || fails >= MAX_FAILS) { out.rows.push({ name: p.name, stu: p.stu, res: "skipped", from: p.from || "", to: p.to || "", message: stopped ? "أُوقف قبله" : "توقّف بعد إخفاقات متتالية" }); continue; }
      const row = { name: p.name, stu: p.stu, res: "", from: p.from || "", to: p.to || "", message: "", undo: p.undo || null };
      say(title + ": " + p.name);
      try { await sleep(POST_GAP); row.res = (await doOne(p, row)) ? "done" : "failed"; }
      catch (e) { row.res = "failed"; row.message = e.message; if (/الجلسة/.test(e.message)) { out.rows.push(row); log("✗ " + p.name + ": " + e.message); break; } }
      if (row.res === "failed") { fails++; row.undo = null; } else fails = 0;
      log((row.res === "done" ? "✓ " : "✗ ") + p.name + (row.message ? ": " + row.message : ""));
      out.rows.push(row);
    }
    return out;
  }
  const preview = async (items, fn) => {
    const plan = [];
    for (const it of items) {
      if (stopped) break;
      const p = { name: clean(it.name), stu: clean(it.stu || it.app || ""), state: "do", why: "" };
      try { await fn(it, p); } catch (e) { if (/الجلسة/.test(e.message)) throw e; p.state = "invalid"; p.why = e.message; }
      plan.push(p); say("معاينة " + plan.length + "/" + items.length);
    }
    return plan;
  };

  /* (1) حالة الطلب لطلبات بأرقامها (من قائمة الطلبات): مقبول، مرفوض، قائمة انتظار… */
  async function cmdAppStatus(cmd, index) {
    const items = (cmd.items || []).slice(0, MAX_ROWS);
    const plan = await preview(items, async (it, p) => {
      const app = "/admin/applications/" + String(it.app || "").replace(/\D/g, "");
      if (!/\d$/.test(app)) throw new Error("رقم الطلب غير صالح");
      const tgt = /^[a-z_]{2,30}$/.test(it.status || "") ? it.status : cmd.status;
      await sleep(GET_GAP);
      const a = statusOfApp((await http("GET", app)).doc);
      const opt = a.form && [...a.form.querySelectorAll('select[name="status"] option')].find((o) => o.value === tgt);
      if (!a.form) throw new Error("لا نموذج لتغيير حالة الطلب");
      if (!opt) throw new Error("الحالة المطلوبة غير موجودة في النظام");
      Object.assign(p, { app, tgt, from: a.label, to: clean(opt.textContent), undo: { app: it.app, name: it.name, status: a.status } });
      if (a.status === tgt) { p.state = "same"; p.why = "حالته «" + a.label + "» أصلاً"; }
    });
    return writeFlow(cmd, index, "appstatus", cmd.undo ? "تراجع عن حالة الطلبات" : "تغيير حالة الطلبات", plan, async (p, row) => {
      const fresh = statusOfApp((await http("GET", p.app)).doc);
      if (!fresh.form) throw new Error("اختفى نموذج تغيير الحالة");
      await http("POST", new URL(fresh.form.getAttribute("action"), location.origin).pathname, formBody(fresh.form, { status: p.tgt }));
      await sleep(GET_GAP);
      const after = statusOfApp((await http("GET", p.app)).doc);
      if (after.status !== p.tgt) row.message = "بقيت الحالة «" + after.label + "»";
      return after.status === p.tgt;
    });
  }
  /* قراءة قائمة الطلبات (بمرشحات الصفحة نفسها) — قراءة فقط */
  async function cmdApps(cmd, index) {
    const out = { index, type: "apps", label: cmd.label || "", rows: [], total: 0 };
    const params = Object.assign({ per_page: "200" }, cmd.params || {});
    for (let page = 1; page <= 10 && !stopped; page++) {
      await sleep(GET_GAP);
      const { doc } = await http("GET", "/admin/applications?" + qs(Object.assign({}, params, { page: String(page) })));
      const heads = [...doc.querySelectorAll("table thead th")].map((t) => clean(t.textContent));
      const col = (rx) => heads.findIndex((x) => rx.test(x));
      const iNo = col(/^رقم الطلب$/), iName = col(/^المتقدم/), iTr = col(/^المسار$/), iSt = col(/^الحالة$/), iSc = col(/^الدرجة$/), iDt = col(/^تاريخ التقديم$/);
      const trs = [...doc.querySelectorAll("table tbody tr")].filter((tr) => tr.cells.length > 3);
      trs.forEach((tr) => {
        const link = [...tr.querySelectorAll("a[href]")].map((a) => new URL(a.getAttribute("href"), location.origin).pathname).find((x) => /^\/admin\/applications\/\d+$/.test(x));
        if (!link) return;
        const cell = (i) => (i >= 0 && tr.cells[i] ? clean(tr.cells[i].textContent) : "");
        out.rows.push({ app: link.split("/").pop(), no: cell(iNo), name: cell(iName), track: cell(iTr), status: cell(iSt), score: cell(iSc), date: cell(iDt) });
      });
      say("قراءة الطلبات: " + out.rows.length);
      const next = doc.querySelector('.pagination a[rel="next"], .pagination li:last-child a[href*="page="]');
      if (!trs.length || !next || out.rows.length >= 2000) break;
    }
    out.total = out.rows.length;
    return out;
  }

  /* (2) حالة الطالب: نشط، منسحب، موقوف، متخرج… (نموذج «تحديث الحالة للطلاب المحددين» لطالب واحد في كل طلب) */
  async function studentRow(stu) {
    await sleep(GET_GAP);
    const { doc } = await http("GET", "/admin/students?" + qs({ q: stu, per_page: "20" }));
    const heads = [...doc.querySelectorAll("table thead th")].map((t) => clean(t.textContent));
    const tr = [...doc.querySelectorAll("table tbody tr")].find((x) => x.textContent.includes(stu));
    if (!tr) return null;
    const sid = ([...tr.querySelectorAll("a[href]")].map((a) => (new URL(a.getAttribute("href"), location.origin).pathname.match(/^\/admin\/students\/(\d+)/) || [])[1]).find(Boolean)) || "";
    const cbx = tr.querySelector('input[name="student_ids[]"]');
    const iSt = heads.findIndex((x) => /^الحالة$/.test(x));
    const bulk = doc.querySelector('form[action$="/admin/students/bulk-update-status"]') || (cbx && cbx.getAttribute("form") && doc.getElementById(cbx.getAttribute("form")));
    return { doc, tr, sid: (cbx && cbx.value) || sid, statusText: iSt >= 0 && tr.cells[iSt] ? clean(tr.cells[iSt].textContent) : "", bulk };
  }
  async function cmdStuStatus(cmd, index) {
    const items = (cmd.items || []).slice(0, MAX_ROWS);
    const plan = await preview(items, async (it, p) => {
      const tgt = /^[a-z_]{2,30}$/.test(it.status || "") ? it.status : cmd.status;
      const st = await studentRow(clean(it.stu));
      if (!st) throw new Error("لم أجد الطالب برقمه");
      if (!st.bulk) throw new Error("لا نموذج لتغيير حالة الطالب (صلاحياتك؟)");
      const opts = [...st.bulk.querySelectorAll('select[name="status"] option')].filter((o) => o.value);
      const opt = opts.find((o) => o.value === tgt); if (!opt) throw new Error("الحالة المطلوبة غير موجودة في النظام");
      const cur = opts.find((o) => st.statusText && (st.statusText === clean(o.textContent) || st.statusText.includes(clean(o.textContent))));
      Object.assign(p, { sid: st.sid, tgt, tgtLabel: clean(opt.textContent), from: st.statusText || "—", to: clean(opt.textContent), undo: cur ? { stu: it.stu, name: it.name, status: cur.value } : null });
      if (!p.name) p.name = it.stu;
      if (cur && cur.value === tgt) { p.state = "same"; p.why = "حالته «" + p.from + "» أصلاً"; }
    });
    return writeFlow(cmd, index, "stustatus", cmd.undo ? "تراجع عن حالة الطلاب" : "تغيير حالة الطلاب", plan, async (p, row) => {
      const st = await studentRow(p.stu);                                      // رمز حماية طازج
      if (!st || !st.bulk) throw new Error("اختفى الطالب أو النموذج");
      const fd = new FormData();
      const tok = st.bulk.querySelector('input[name="_token"]') || st.doc.querySelector('input[name="_token"]');
      if (tok) fd.append("_token", tok.value);
      fd.append("status", p.tgt); fd.append("student_ids[]", st.sid || p.sid);
      await http("POST", "/admin/students/bulk-update-status", fd);
      const after = await studentRow(p.stu);                                   // التحقق الحقيقي
      const ok = !!after && (after.statusText === p.tgtLabel || after.statusText.includes(p.tgtLabel));
      if (!ok) row.message = "الحالة الآن «" + ((after && after.statusText) || "؟") + "»";
      return ok;
    });
  }

  /* (3) النقل بين المجموعات: نموذج «نقل» في صف الطالب بصفحة المجموعات */
  async function findAssign(stu, trackHint) {
    const look = (doc) => {
      const all = [...doc.querySelectorAll("form")].filter((x) => /\/training-groups\/assign$/.test(new URL(x.getAttribute("action") || "", location.origin).pathname));
      const f = all.find((x) => { const row = x.parentElement && x.parentElement.closest("div.row, tr, li"); return row && row.textContent.includes(stu); });
      if (!f) return null;
      const names = new Set(); all.forEach((x) => x.querySelectorAll('select[name="training_group_id"] option').forEach((o) => { if (o.value) names.add(optName(o.textContent)); }));
      const mine = [...f.querySelectorAll('select[name="training_group_id"] option')].filter((o) => o.value);
      const row = f.parentElement.closest("div.row, tr, li");
      const member = !!(row && row.querySelector('input[name="_method"][value="DELETE"]'));
      const rest = [...names].filter((x) => !mine.some((o) => optName(o.textContent) === x));
      return { form: f, opts: mine, current: member && rest.length === 1 ? rest[0] : member ? "" : "بلا مجموعة" };
    };
    await sleep(GET_GAP);
    let { doc } = await http("GET", "/admin/training-groups");
    let r = look(doc); if (r) return r;
    const tops = [...doc.querySelectorAll('select[name="track_id"] option')].filter((o) => o.value && trackHint && clean(trackHint).includes(clean(o.textContent).replace(/^مسار\s*/, "")));
    const all = tops.length ? tops : [...doc.querySelectorAll('select[name="track_id"] option')].filter((o) => o.value);
    for (const o of all.slice(0, 9)) {
      if (stopped) break;
      await sleep(GET_GAP);
      ({ doc } = await http("GET", "/admin/training-groups?" + qs({ track_id: o.value })));
      r = look(doc); if (r) return r;
    }
    return null;
  }
  const pickGroup = (opts, want) => { const w = normV(want); return opts.find((o) => normV(optName(o.textContent)) === w) || opts.find((o) => normV(o.textContent).includes("(" + w + ")")) || null; };
  async function cmdMove(cmd, index) {
    const items = (cmd.items || []).slice(0, MAX_ROWS);
    const plan = await preview(items, async (it, p) => {
      if (!clean(it.group)) throw new Error("لم تُحدَّد المجموعة الجديدة");
      const a = await findAssign(clean(it.stu), it.track);
      if (!a) throw new Error("لم أجد الطالب في صفحة المجموعات");
      Object.assign(p, { track: it.track || "", group: clean(it.group), from: a.current || "—", to: clean(it.group) });
      if (!p.name) p.name = it.stu;
      if (a.current && normV(a.current) === normV(it.group)) { p.state = "same"; p.why = "في المجموعة «" + a.current + "» أصلاً"; return; }
      const o = pickGroup(a.opts, it.group);
      if (!o) throw new Error("المجموعة «" + clean(it.group) + "» غير متاحة لهذا الطالب (مسار آخر أو غير موجودة)");
      p.to = optName(o.textContent);
      p.undo = a.current && a.current !== "بلا مجموعة" ? { stu: it.stu, name: it.name, track: it.track || "", group: a.current } : null;
    });
    return writeFlow(cmd, index, "move", cmd.undo ? "تراجع عن النقل" : "النقل بين المجموعات", plan, async (p, row) => {
      const a = await findAssign(p.stu, p.track);                              // رمز حماية طازج
      if (!a) throw new Error("اختفى الطالب من صفحة المجموعات");
      const o = pickGroup(a.opts, p.group); if (!o) throw new Error("المجموعة لم تعد متاحة");
      await http("POST", "/admin/training-groups/assign", formBody(a.form, { training_group_id: o.value }));
      const after = await findAssign(p.stu, p.track);                          // التحقق: المجموعة الجديدة هي الحالية
      const ok = !!after && !pickGroup(after.opts, p.group) && after.current !== "بلا مجموعة";
      if (!ok) row.message = "لم يتأكد النقل (المجموعة الآن: " + ((after && after.current) || "؟") + ")";
      return ok;
    });
  }

  /* (4) تعديل بيانات الطالب: حقول محددة فقط، من صفحة «تعديل» نفسها (بقية الحقول تُرسل كما هي) */
  const EDIT_OK = ["marital_status", "phone_2", "birth_date", "health_status", "governorate_id", "population_community_id", "displacement_status", "residence_type_id",
    "current_address", "family_members_count", "breadwinner_status", "employment_status", "income_type_id", "education_level", "specialization", "notes", "gender", "phone_1"];
  const fieldVal = (el) => (el.tagName === "SELECT" ? ((el.querySelector("option[selected]") || el.options[el.selectedIndex] || {}).value || "") : clean(el.tagName === "TEXTAREA" ? el.textContent : (el.getAttribute("value") || el.value || "")));
  const fieldText = (el, v) => (el.tagName === "SELECT" ? clean(([...el.options].find((o) => o.value === v) || {}).textContent || v) : v);
  function toFieldValue(el, given) {
    const g = clean(given); if (!g) return null;
    if (el.tagName === "SELECT") {
      const os = [...el.options].filter((o) => o.value), w = normV(g);
      const o = os.find((x) => x.value === g) || os.find((x) => normV(x.textContent) === w) || os.find((x) => normV(x.textContent).split("/").map((t) => t.trim()).includes(w)) || os.find((x) => normV(x.textContent).startsWith(w));
      if (!o) throw new Error("القيمة «" + g + "» ليست من خيارات «" + el.name + "»");
      return o.value;
    }
    if (el.type === "date") {
      const d = g.replace(/[٠-٩]/g, (x) => "٠١٢٣٤٥٦٧٨٩".indexOf(x)), m = d.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/) || d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (!m) throw new Error("تاريخ غير مفهوم «" + g + "»");
      const [y, mo, da] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
      return y + "-" + mo.padStart(2, "0") + "-" + da.padStart(2, "0");
    }
    if (el.type === "number") { const n = g.replace(/[٠-٩]/g, (x) => "٠١٢٣٤٥٦٧٨٩".indexOf(x)).replace(/\D/g, ""); if (!n) throw new Error("رقم غير صالح «" + g + "»"); return n; }
    return g;
  }
  async function editForm(sid) {
    await sleep(GET_GAP);
    const { doc } = await http("GET", "/admin/students/" + sid + "/edit");
    const f = [...doc.querySelectorAll("form")].find((x) => new RegExp("^/admin/students/" + sid + "$").test(new URL(x.getAttribute("action") || "", location.origin).pathname));
    if (!f) throw new Error("لا نموذج تعديل لهذا الطالب");
    return f;
  }
  async function cmdEdit(cmd, index) {
    const items = (cmd.items || []).slice(0, MAX_ROWS), onlyEmpty = cmd.onlyEmpty !== false && !cmd.undo;
    const plan = await preview(items, async (it, p) => {
      const st = await studentRow(clean(it.stu));
      if (!st || !st.sid) throw new Error("لم أجد الطالب برقمه");
      const f = await editForm(st.sid);
      const ch = {}, from = [], to = [], back = {}, kept = [];
      Object.keys(it.fields || {}).filter((k) => EDIT_OK.includes(k)).forEach((k) => {
        const el = f.elements[k]; if (!el || !el.tagName) return;
        const raw = it.fields[k]; if (raw == null || clean(raw) === "") return;
        const v = cmd.undo ? String(raw) : toFieldValue(el, raw); if (v == null) return;
        const cur = fieldVal(el);
        if (cur === v) return;
        if (onlyEmpty && cur) { kept.push(fieldLabel(el, f.ownerDocument) || el.name); return; }
        ch[k] = v; back[k] = cur; const lb = fieldLabel(el, f.ownerDocument) || el.name;
        from.push(lb + ": " + (cur ? fieldText(el, cur) : "—")); to.push(lb + ": " + fieldText(el, v));
      });
      if (!p.name) p.name = it.stu;
      Object.assign(p, { sid: st.sid, ch, from: from.join(" · "), to: to.join(" · "), undo: Object.keys(ch).length ? { stu: it.stu, name: it.name, fields: back } : null });
      if (!Object.keys(ch).length) { p.state = "same"; p.why = kept.length ? "مُدخَل أصلاً (لم يُستبدل): " + kept.join("، ") : "لا تغيير"; }
      else if (kept.length) p.why = "لن يُستبدل المُدخَل أصلاً: " + kept.join("، ");
    });
    return writeFlow(cmd, index, "edit", cmd.undo ? "تراجع عن تعديل البيانات" : "تعديل بيانات الطلاب", plan, async (p, row) => {
      const f = await editForm(p.sid);                                         // نموذج طازج بكل الحقول كما هي الآن
      await http("POST", "/admin/students/" + p.sid, formBody(f, p.ch));
      const g = await editForm(p.sid);                                         // التحقق: كل حقل غُيّر صار بالقيمة الجديدة
      const bad = Object.keys(p.ch).filter((k) => !g.elements[k] || fieldVal(g.elements[k]) !== p.ch[k]);
      if (bad.length) row.message = "لم يُحفظ: " + bad.map((k) => (g.elements[k] && fieldLabel(g.elements[k], g.ownerDocument)) || k).join("، ");
      return !bad.length;
    });
  }
  async function cmdCancel(cmd, index) {
    const out = { index, type: "cancel", label: cmd.label || "", rows: [] };
    const target = cmd.status || "cancelled", items = (cmd.items || []).slice(0, MAX_ROWS);
    say("معاينة: فحص " + items.length + " طالباً");
    const plan = [];
    for (const it of items) {
      if (stopped) break;
      // الحالة المطلوبة لكل طالب: من البند نفسه (للتراجع: حالته السابقة) وإلا حالة الأمر («ملغي»)
      const tgt = /^[a-z_]{2,30}$/.test(it.status || "") ? it.status : target;
      const p = { name: it.name || "", stu: clean(it.stu), track: it.track || "", state: "cancel", why: "", tgt, to: "" };
      try {
        const st = await findStudentApp(p.stu);
        if (!st) { p.state = "invalid"; p.why = "لم أجد الطالب برقمه"; }
        else if (!st.app) { p.state = "invalid"; p.why = "لا طلب تسجيل مرتبط به"; }
        else {
          p.app = st.app; await sleep(GET_GAP);
          const a = statusOfApp((await http("GET", st.app)).doc);
          const opt = a.form && [...a.form.querySelectorAll('select[name="status"] option')].find((o) => o.value === tgt);
          if (!a.form) { p.state = "invalid"; p.why = "لا نموذج لتغيير حالة الطلب"; }
          else if (!opt) { p.state = "invalid"; p.why = "الحالة المطلوبة غير موجودة في النظام"; }
          else { p.cur = a.label; p.curCode = a.status; p.to = clean(opt.textContent); if (a.status === tgt) { p.state = "already"; p.why = "طلبه «" + a.label + "» أصلاً"; } else p.why = "الحالة الآن «" + a.label + "»"; }
        }
      } catch (e) { if (/الجلسة/.test(e.message)) throw e; p.state = "invalid"; p.why = e.message; }
      plan.push(p); say("معاينة " + plan.length + "/" + items.length);
    }
    const n = (s) => plan.filter((p) => p.state === s).length;
    bodyEl.replaceChildren(h("div", { textContent: (cmd.undo ? "سيُعاد إلى حالته السابقة: " : "سيُلغى: ") + n("cancel") + " — ملغي أصلاً: " + n("already") + " — لن يُنفَّذ: " + n("invalid") }));
    const todo = plan.filter((p) => p.state !== "invalid");
    plan.filter((p) => p.state === "invalid").forEach((p) => out.rows.push({ name: p.name, stu: p.stu, app: "invalid", group: "", message: p.why }));
    if (!todo.length) { log("لا شيء يُنفَّذ."); return out; }
    say("سيُكتب في نظام المركز لـ" + todo.length + " طالباً. راجع ثم اضغط «نفّذ».");
    const summary = { kind: "cancel", undo: !!cmd.undo, total: plan.length, cancel: n("cancel"), already: n("already"), invalid: n("invalid"), removeFromGroup: cmd.removeFromGroup !== false,
      target, rows: plan.slice(0, 120).map((p) => ({ name: p.name, nid: p.stu, state: p.state, why: p.why, to: p.to })) };
    const local = wait((cmd.undo ? "نفّذ التراجع لـ" : "نفّذ الإلغاء لـ") + todo.length + " طالباً", "go");
    const go = typeof window.__kxApprove === "function" ? await Promise.race([local, window.__kxApprove(summary)]) : await local;
    actEl.replaceChildren(stopBtn);
    if (!go || stopped) { todo.forEach((p) => out.rows.push({ name: p.name, stu: p.stu, app: "skipped", group: "", message: "لم يُنفَّذ (تخطّيت أو أوقفت)" })); log("لم يُنفَّذ."); return out; }
    let fails = 0;
    for (const p of todo) {
      if (stopped) { out.rows.push({ name: p.name, stu: p.stu, app: "skipped", group: "", message: "أُوقف قبله" }); continue; }
      if (fails >= MAX_FAILS) { out.rows.push({ name: p.name, stu: p.stu, app: "skipped", group: "", message: "توقّف بعد إخفاقات متتالية" }); continue; }
      const row = { name: p.name, stu: p.stu, app: p.state === "already" ? "already" : "", group: "", message: "", was: p.cur || "", wasCode: p.curCode || "", to: p.to, toCode: p.tgt };
      say("إلغاء: " + p.name);
      try {
        if (p.state === "cancel") {
          await sleep(POST_GAP);
          const fresh = statusOfApp((await http("GET", p.app)).doc);          // رمز حماية طازج
          if (!fresh.form) throw new Error("اختفى نموذج تغيير الحالة");
          await http("POST", new URL(fresh.form.getAttribute("action"), location.origin).pathname, formBody(fresh.form, { status: p.tgt }));
          await sleep(GET_GAP);
          const after = statusOfApp((await http("GET", p.app)).doc);           // التحقق الحقيقي
          row.app = after.status === p.tgt ? "cancelled" : "failed";
          if (row.app === "failed") row.message = "بقيت الحالة «" + after.label + "»";
        }
        if (cmd.removeFromGroup !== false && row.app !== "failed") {
          const m = await findMembership(p.stu, p.track);
          if (!m) row.group = "none";
          else {
            await sleep(POST_GAP);
            await http("POST", new URL(m.form.getAttribute("action"), location.origin).pathname, formBody(m.form));
            const again = await findMembership(p.stu, p.track);                 // التحقق: لم يعد في المجموعة
            row.group = again ? "failed" : "removed";
            if (again) row.message = (row.message ? row.message + " · " : "") + "ما زال في المجموعة";
          }
        }
        if (row.app === "failed" || row.group === "failed") fails++; else fails = 0;
        log((row.app === "failed" || row.group === "failed" ? "✗ " : "✓ ") + p.name);
      } catch (e) {
        row.app = row.app || "failed"; row.message = e.message; fails++; log("✗ " + p.name + ": " + e.message);
        out.rows.push(row);
        if (/الجلسة/.test(e.message)) break;
        continue;
      }
      out.rows.push(row);
    }
    return out;
  }

  /* ===== التشغيل ===== */
  /* الأوامر إما مدمجة مع الوكيل (نسخة «الوكيل مع الأوامر») أو تُختار من ملف */
  let pack = window.__KX_PACK;
  try { delete window.__KX_PACK; } catch (e) { window.__KX_PACK = undefined; }   // لا تبقى بيانات الطلبة في الصفحة
  if (!pack) {
    say("اختر ملف الأوامر (ksach-commands.json) الذي أنشأه تمكين");
    const pick = h("input", { type: "file", accept: ".json" });
    actEl.replaceChildren(pick, stopBtn);
    pack = await new Promise((resolve) => {
      pick.onchange = async () => {
        try { resolve(JSON.parse(await pick.files[0].text())); } catch (e) { say("الملف غير صالح — اختر ksach-commands.json"); }
      };
    });
  }
  if (!pack || !Array.isArray(pack.commands)) { say("ملف أوامر غير صالح."); return; }
  actEl.replaceChildren(stopBtn);
  log("الأوامر: " + pack.commands.length);

  for (let i = 0; i < pack.commands.length && !stopped; i++) {
    const cmd = pack.commands[i];
    window.__kxCmd = { i: i + 1, n: pack.commands.length };
    try {
      const fn = { lookup: cmdLookup, list: cmdList, register: cmdRegister, page: cmdPage, attendance: cmdAttendance, export: cmdExport, cancel: cmdCancel, apps: cmdApps, appstatus: cmdAppStatus, stustatus: cmdStuStatus, move: cmdMove, edit: cmdEdit }[cmd.type];
      if (!fn) { results.push({ index: i, type: cmd.type, error: "نوع أمر غير معروف" }); continue; }
      results.push(await fn(cmd, i));
    } catch (e) {
      results.push({ index: i, type: cmd.type, label: cmd.label || "", error: e.message });
      log("خطأ: " + e.message);
      if (/الجلسة/.test(e.message)) break;
    }
    // نتيجة هذا الأمر تصل تمكين فوراً ليعرضها قبل انتهاء الباقي
    try { const last = results[results.length - 1]; if (last && typeof window.__kxPartial === "function") window.__kxPartial(i, last); } catch (e) { /* تمكين مغلق */ }
  }
  const payload = { v: 1, at: new Date().toISOString(), results };
  const sent = typeof window.__kxDone === "function" ? await window.__kxDone(payload) : false;
  if (!sent) save();                       // لا تمكين مفتوح يستلمها: تُنزَّل ملفاً كما كان
  say(sent ? "انتهى. أُرسلت النتائج إلى تمكين." : stopped ? "أُوقف. نُزّلت النتائج." : "انتهى. نُزّل ksach-results.json — ارفعه في تمكين.");
};
