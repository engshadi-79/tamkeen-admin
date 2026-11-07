/* وكيل أوامر نظام المركز — يُشغَّل في Console داخل https://tamkeen.ksach.org
   وأنت مسجّل دخولك. يقرأ ملف الأوامر الذي ينشئه تمكين (ksach-commands.json)
   وينفّذه في جلستك أنت، ثم يُنزّل ملف النتائج (ksach-results.json).

   حدوده:
   - لا يطلب كلمة مرور ولا يقرأ كوكيز ولا يخزّن رمز الجلسة.
   - لا يرسل إلا أربعة أنواع طلبات (انظر ALLOW) وأي غيرها يُرفض.
   - لا يكتب شيئاً قبل أن تضغط «نفّذ» بعد أن ترى جدول المعاينة.
   - يتجاوز من هو مسجَّل أصلاً (بالبحث برقم الهوية) فلا يُكرّر أحداً.
   - يتوقف عند ثلاثة إخفاقات متتالية، ويمكنك إيقافه في أي لحظة. */
(async () => {
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
  const qs = (o) => Object.keys(o).filter((k) => o[k] !== "" && o[k] != null)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(o[k])).join("&");

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

  async function cmdLookup(cmd, index) {
    const out = { index, type: "lookup", label: cmd.label || "", items: [] };
    for (const it of cmd.items || []) {
      if (stopped) break;
      say("استعلام: " + it.q);
      await sleep(GET_GAP);
      const { doc } = await http("GET", "/admin/students?" + qs({ q: it.q, per_page: "100" }));
      const t = tableRows(doc);
      const isNid = digits(it.q).length >= 9 && digits(it.q) === String(it.q).replace(/\s/g, "");
      const rows = isNid ? t.rows.filter((r) => digits(r.cells.join(" ")).includes(digits(it.q))) : t.rows;
      const item = { q: it.q, count: rows.length, heads: t.heads, rows: rows.slice(0, 30) };
      if (cmd.details && item.rows.length && !stopped) await addDetails(item, 10);
      out.items.push(item);
      log((rows.length ? "وُجد " + rows.length : "لا نتيجة") + " ← " + it.q);
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
      const fn = { lookup: cmdLookup, list: cmdList, register: cmdRegister }[cmd.type];
      if (!fn) { results.push({ index: i, type: cmd.type, error: "نوع أمر غير معروف" }); continue; }
      results.push(await fn(cmd, i));
    } catch (e) {
      results.push({ index: i, type: cmd.type, label: cmd.label || "", error: e.message });
      log("خطأ: " + e.message);
      if (/الجلسة/.test(e.message)) break;
    }
  }
  const payload = { v: 1, at: new Date().toISOString(), results };
  const sent = typeof window.__kxDone === "function" ? await window.__kxDone(payload) : false;
  if (!sent) save();                       // لا تمكين مفتوح يستلمها: تُنزَّل ملفاً كما كان
  say(sent ? "انتهى. أُرسلت النتائج إلى تمكين." : stopped ? "أُوقف. نُزّلت النتائج." : "انتهى. نُزّل ksach-results.json — ارفعه في تمكين.");
})();
