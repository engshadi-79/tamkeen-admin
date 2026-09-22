/* سجل التعديلات: من غيّر ماذا ومتى في كل الأقسام، مع التراجع عن أي تعديل أو حذف.
   الخادم يحفظ القيمة قبل كل تعديل وبعده (جدول revisions). المدير يرى الجميع،
   والمستخدم يرى تعديلاته هو ويتراجع عنها. التراجع نفسه يُسجَّل فيمكن التراجع عنه. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  const COLS = {
    registry: "الوارد والصادر", tracks: "المسارات", tasks: "المهام", meetings: "المحاضر",
    customTemplates: "قوالب المراسلات", roster: "المستفيدون", settings: "الإعدادات",
    convTemplates: "قوالب التحويل", hospitality: "كشف الضيافة",
  };
  const ACTIONS = {
    add: ["إضافة", "add"], edit: ["تعديل", "edit"], delete: ["حذف", "del"], revert: ["تراجع", "rev"],
  };
  const SETTINGS = {
    registrySettings: "إعدادات الوارد والصادر", reportSettings: "إعدادات التقارير", rosterMeta: "أعمدة المستفيدين",
    aiSettings: "إعدادات الذكاء الاصطناعي", signer: "اسم الموقّع", signerTitle: "صفة الموقّع",
    fixedFields: "البيانات الثابتة", convDefaults: "افتراضيات التحويل", hospitalityRows: "صفوف كشف الضيافة",
  };
  const FIELDS = {
    name: "الاسم", text: "النص", title: "العنوان", subject: "الموضوع", party: "الجهة", number: "الرقم",
    date: "التاريخ", dueDate: "الموعد", done: "منجز", owner: "صاحب القيد", type: "النوع", notes: "ملاحظات",
    beneficiaries: "المستفيدون", attendancePct: "نسبة الحضور", hoursCompleted: "الساعات المكتملة",
    trainer1: "المدرب الأول", trainer2: "المدرب الثاني", days: "الأيام", value: "القيمة", body: "النص",
    status: "الحالة", phone: "الهاتف", track: "المسار", group: "المجموعة", decisions: "القرارات",
    attendees: "الحضور", replyNumber: "رقم الرد", category: "التصنيف", fileName: "الملف",
  };
  const SKIP = new Set(["updatedAt", "createdAt", "id", "history", "search", "addedAt", "pos", "valuesAt", "updatedBy", "isNew", "source"]);

  /* أسماء أعمدة قائمة المستفيدين من مفاتيحها */
  const rosterLabel = (key) => {
    const col = (((App.store.get() || {}).rosterMeta || {}).columns || []).find((c) => c.key === key);
    return col ? col.label : key;
  };
  const rosterName = (d) => {
    const cols = (((App.store.get() || {}).rosterMeta || {}).columns || []);
    const v = d.values || {};
    const nameCol = cols.find((c) => /اسم/.test(c.label || ""));
    return (nameCol && v[nameCol.key]) || Object.values(v).find((x) => typeof x === "string" && x.trim()) || "";
  };

  let rows = [];
  let recFilter = null; // { col, id, title } عند عرض سجل قيد واحد
  let lastId = null;
  let busy = false;

  /* اسم مقروء للقيد */
  function titleOf(col, d, recId) {
    if (!d) return recId;
    if (col === "registry") return [d.number, d.subject].filter(Boolean).join(" — ") || recId;
    if (col === "settings") return SETTINGS[d.id] || d.id || recId;
    if (col === "roster") return rosterName(d) || recId;
    if (col === "hospitality") {
      const [month, key] = String(recId).split("|");
      const def = App.hospitality && App.hospitality.rows ? App.hospitality.rows() : (App.store.get() || {}).hospitalityRows;
      const all = def ? [].concat(def.tracks || [], def.staff || []) : [];
      const row = all.find((r) => r.key === key);
      return `${row ? row.name : key} — ${month}`;
    }
    const first = Object.keys(d).find((k) => !SKIP.has(k) && typeof d[k] === "string" && d[k].trim());
    return d.name || d.title || d.text || d.subject || (first ? d[first] : "") || recId;
  }

  const show = (v) => {
    if (v === undefined || v === null || v === "") return "—";
    if (typeof v === "boolean") return v ? "نعم" : "لا";
    if (typeof v === "object") {
      const s = JSON.stringify(v);
      return s.length > 60 ? s.slice(0, 57) + "…" : s;
    }
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  };

  /* الحقول التي تغيّرت بين القيمتين */
  function changes(before, after) {
    const b = before || {};
    const a = after || {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !SKIP.has(k));
    const out = [];
    keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).forEach((k) => {
      if (k === "values" && (b[k] || a[k])) {
        const bv = b.values || {}, av = a.values || {};
        [...new Set([...Object.keys(bv), ...Object.keys(av)])]
          .filter((c) => JSON.stringify(bv[c]) !== JSON.stringify(av[c]))
          .forEach((c) => out.push({ key: c, label: rosterLabel(c), from: bv[c], to: av[c] }));
      } else if (k === "notes") {
        const had = new Set((b.notes || []).map((n) => n.id || n.at));
        (a.notes || []).filter((n) => !had.has(n.id || n.at)).forEach((n) => out.push({ key: "notes", label: "ملاحظة جديدة", from: "", to: n.text }));
      } else out.push({ key: k, label: FIELDS[k] || k, from: b[k], to: a[k] });
    });
    return out;
  }

  function when(at) {
    const d = new Date(at);
    return isNaN(d) ? "" : d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  }

  function rowHtml(r) {
    const [label, cls] = ACTIONS[r.action] || [r.action, ""];
    const data = r.after || r.before;
    let detail = "";
    if (r.action === "edit" || (r.action === "revert" && r.before && r.after)) {
      const list = changes(r.before, r.after);
      detail = list.slice(0, 4).map((c) => `<div><b>${esc(c.label)}:</b> <s>${esc(show(c.from))}</s> ← ${esc(show(c.to))}</div>`).join("")
        + (list.length > 4 ? `<div class="hist-more">و${ui.fmt(list.length - 4)} حقول أخرى</div>` : "");
    } else if (r.action === "add") detail = `<span class="hist-muted">قيد جديد</span>`;
    else if (r.action === "delete") detail = `<span class="hist-muted">حُذف القيد</span>`;
    else if (r.action === "revert") detail = `<span class="hist-muted">${r.after ? "أُعيد القيد" : "أُزيلت الإضافة"}</span>`;
    return `<tr>
      <td class="hist-when">${esc(when(r.at))}</td>
      <td>${esc(r.who)}</td>
      <td>${esc(COLS[r.col] || r.col)}</td>
      <td class="hist-title"><button type="button" class="conv-link" data-rec="${esc(r.rec_id)}" data-col="${esc(r.col)}" title="كل تعديلات هذا القيد من كل المستخدمين">${esc(titleOf(r.col, data, r.rec_id))}</button></td>
      <td><span class="hist-tag ${cls}">${label}</span></td>
      <td class="hist-detail">${detail}</td>
      <td><button type="button" class="btn small secondary" data-revert="${r.id}" title="إرجاع القيد إلى ما كان عليه قبل هذا التعديل">↶ تراجع</button></td>
    </tr>`;
  }

  function paint() {
    const q = $("hist-q").value.trim();
    const list = q ? rows.filter((r) => (titleOf(r.col, r.after || r.before, r.rec_id) + " " + r.who).includes(q)) : rows;
    $("hist-body").innerHTML = list.length ? list.map(rowHtml).join("")
      : `<tr><td colspan="7" class="empty">${rows.length ? "لا نتائج للبحث" : "لا توجد تعديلات مسجّلة بعد"}</td></tr>`;
    $("hist-more").hidden = !lastId;
  }

  async function load(more) {
    if (busy || !App.cloud || !App.cloud.ready()) return;
    busy = true;
    $("hist-status").textContent = "جارٍ التحميل…";
    try {
      const opts = recFilter
        ? { limit: 100, col: recFilter.col, recId: recFilter.id }
        : { limit: 100, col: $("hist-col").value || undefined, who: $("hist-who").value || undefined };
      if (more && lastId) opts.beforeId = lastId;
      const list = await App.cloud.history(opts);
      rows = more ? rows.concat(list) : list;
      lastId = list.length === 100 ? list[list.length - 1].id : null;
      $("hist-status").innerHTML = recFilter
        ? `سجل «${esc(recFilter.title)}» من كل المستخدمين — ${ui.fmt(rows.length)} تعديلاً · <button type="button" class="conv-link" data-rec-clear>↩ كل التعديلات</button>`
        : esc(`${ui.fmt(rows.length)} تعديلاً${App.profile.isAdmin() ? "" : " (تعديلاتك أنت)"}`);
      paint();
    } catch (e) {
      $("hist-status").textContent = "";
      $("hist-body").innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;
    }
    busy = false;
  }

  async function revert(id, btn) {
    const r = rows.find((x) => String(x.id) === String(id));
    if (!r) return;
    const what = titleOf(r.col, r.after || r.before, r.rec_id);
    const msg = !r.before ? `التراجع عن إضافة «${what}» يحذفه. متابعة؟`
      : `إرجاع «${what}» إلى ما كان عليه قبل ${ACTIONS[r.action] ? ACTIONS[r.action][0] : "هذا التعديل"} ${when(r.at)}؟`;
    if (!confirm(msg)) return;
    btn.disabled = true;
    try {
      await App.cloud.revert(id);
      ui.toast("تم التراجع، ويظهر عند كل المستخدمين");
      // الجهاز يأخذ القيمة المستعادة فوراً، وبقية الأجهزة عبر البث
      if (r.col === "registry") await App.registry.syncShared(true);
      else await App.shared.sync(true);
      if (App.realtime) App.realtime.notify([r.col === "registry" ? "registry" : r.col]);
      await load(false);
    } catch (e) {
      ui.toast(e.message);
      btn.disabled = false;
    }
  }

  function render() {
    const admin = App.profile.isAdmin();
    $("hist-who-wrap").hidden = !admin;
    if (admin && $("hist-who").options.length <= 1) {
      App.cloud.people().then((list) => {
        $("hist-who").innerHTML = `<option value="">كل المستخدمين</option>` + list.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
      }).catch(() => { /* بلا إنترنت */ });
    }
    load(false);
  }

  function init() {
    $("hist-col").innerHTML = `<option value="">كل الأقسام</option>` + Object.keys(COLS).map((c) => `<option value="${c}">${COLS[c]}</option>`).join("");
    $("hist-col").addEventListener("change", () => load(false));
    $("hist-who").addEventListener("change", () => load(false));
    $("hist-q").addEventListener("input", paint);
    $("hist-refresh").addEventListener("click", () => load(false));
    $("hist-more").addEventListener("click", () => load(true));
    $("hist-body").addEventListener("click", (e) => {
      const b = e.target.closest("[data-revert]");
      if (b) { revert(b.dataset.revert, b); return; }
      const rec = e.target.closest("[data-rec]");
      if (rec) {
        recFilter = { col: rec.dataset.col, id: rec.dataset.rec, title: rec.textContent.trim() };
        load(false);
      }
    });
    $("hist-status").addEventListener("click", (e) => {
      if (e.target.closest("[data-rec-clear]")) { recFilter = null; load(false); }
    });
  }

  App.history = { init, render, changes, titleOf };
})(window.App = window.App || {});
