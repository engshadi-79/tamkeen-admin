/* نظام مركز وهمي يحاكي سلوك Laravel: رمز حماية، تحقق، رفض مكرر، ترقيم صفحات، وأخطاء تُعرض مرة واحدة. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = 4197;
const ROOT = process.argv[2];                 // مجلد يحوي سكربتات الاختبار (ksach-runner.js)

const students = [];
for (let i = 1; i <= 7; i++) {
  students.push({ id: 1400 + i, name: "طالب تجريبي " + i, nid: "40000000" + i, phone: "059000000" + i, track: "2", status: "active", stu: "STU-20260101-0000" + i, app: 5000 + i, appStatus: "accepted", member: 800 + i, group: i % 2 ? "G1" : "G2",
    ed: { gender: "female", birth_date: "1998-05-20", governorate_id: "4", education_level: "bachelor", current_address: "حي الرمال - شارع الوحدة", notes: "" } });
}
const ST_L = { active: "نشط", under_review: "قيد المراجعة", withdrawn: "منسحب", graduated: "متخرج", suspended: "موقوف" };
const GRPS = { G1: "71", G2: "72", S3G1: "73" };
let nextId = 1500;
const tokens = new Set();
let flashErrors = [];
const hits = [];                              // كل ما طُلب فعلاً، لنتأكد أن الوكيل لم يتجاوز حدّه

const TRACKS = { 1: "الحلاقة الرجالية", 2: "التجميل النسائي - كوافير", 3: "التطريز والخياطة" };
const sel = (name, opts, extra) => `<select name="${name}" ${extra || ""}>` + opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("") + "</select>";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function layout(body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>لوحة التحكم</title></head><body>
  <nav><a href="/admin/students">الطلاب</a> <a href="/admin/students/create">إضافة طالب</a></nav>${body}</body></html>`;
}

function listPage(url) {
  const q = (url.searchParams.get("q") || "").trim();
  const per = Math.max(1, Number(url.searchParams.get("per_page")) || 20);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const trk = url.searchParams.get("track_id");
  let rows = students.filter((s) => (!q || s.name.includes(q) || s.nid.includes(q) || s.phone.includes(q) || (s.stu || "").includes(q)) && (!trk || s.track === trk));
  const total = rows.length;
  rows = rows.slice((page - 1) * per, page * per);
  const tr = rows.map((s, i) => `<tr><td><input type="checkbox" name="student_ids[]" value="${s.id}" form="bulkStatusForm"> ${s.id}</td><td>${esc(s.name)}</td><td>${s.nid}</td><td>${TRACKS[s.track] || ""}</td><td>${ST_L[s.status] || s.status}</td>
    <td><span>${s.stu || ""}</span> <a href="/admin/students/${s.id}">تفاصيل</a>${s.app ? ` <a href="/admin/applications/${s.app}">عرض الطلب</a>` : ""}
      <div class="modal"><form method="post" action="/admin/students/${s.id}/english-name"><input type="hidden" name="_token" value="X">الاسم الإنجليزي <input name="full_name_en"><button>حفظ</button></form></div></td></tr>`).join("");
  const next = page * per < total ? `<a rel="next" href="/admin/students?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), page: page + 1 })}">التالي</a>` : "";
  const btk = "T" + Math.random().toString(36).slice(2); tokens.add(btk);
  return layout(`<form method="get" action="/admin/students"><input name="q"><button>عرض النتائج</button></form>
    <form id="bulkStatusForm" method="POST" action="/admin/students/bulk-update-status"><input type="hidden" name="_token" value="${btk}"><select name="status"><option value="">اختر الحالة</option>${Object.entries(ST_L).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select><button>تحديث الحالة للطلاب المحددين</button></form>
    <table><thead><tr><th>رقم الطالب</th><th>الاسم</th><th>الهوية</th><th>المسار</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${tr}</tbody></table>${next}`);
}

function createPage() {
  const t = "T" + Math.random().toString(36).slice(2);
  tokens.add(t);
  const errs = flashErrors.map((e) => `<div class="invalid-feedback">${esc(e)}</div>`).join("");
  flashErrors = [];
  return layout(`${errs}<form method="post" action="/admin/students">
    <input type="hidden" name="_token" value="${t}">
    <label>المسار *</label>${sel("track_id", [["", "اختر المسار"], ...Object.entries(TRACKS)], "required")}
    <input name="student_number">
    ${sel("status", [["active", "نشط"], ["under_review", "قيد المراجعة"]])}
    <input name="full_name" required><input name="national_id" required>
    ${sel("gender", [["", "اختر"], ["male", "ذكر"], ["female", "أنثى"]])}
    <input name="phone_1" required><input name="phone_2"><input type="date" name="birth_date">
    <input type="password" name="password"><input type="password" name="password_confirmation">
    <label><input type="checkbox" name="must_change_password" value="1"> إلزام</label>
    <button type="submit">حفظ الطالب</button></form>`);
}

function parseMultipart(buf, ct) {
  const m = /boundary=(.+)$/.exec(ct || "");
  if (!m) return {};
  const out = {};
  buf.toString("utf8").split("--" + m[1]).forEach((part) => {
    const mm = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n$/.exec(part);
    if (mm) out[mm[1]] = mm[2];
  });
  return out;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  hits.push(req.method + " " + url.pathname + (url.search ? "?…" : ""));
  const send = (code, body, type, headers) => { res.writeHead(code, Object.assign({ "Content-Type": type || "text/html; charset=utf-8" }, headers || {})); res.end(body); };

  if (url.pathname === "/__hits") return send(200, JSON.stringify(hits), "application/json");
  if (url.pathname === "/__students") return send(200, JSON.stringify(students), "application/json");
  if (req.method === "GET" && url.pathname === "/admin/students/export-excel") {   // «تصدير Excel»: أعمدة الطالب والمتقدم (الحالة الاجتماعية عند المتقدم فقط)
    const JSZip = require(path.join(__dirname, "..", "..", "vendor", "jszip.min.js"));
    const H = ["رقم الطالب", "اسم الطالب", "رقم الهوية", "الجوال 1", "الجنس", "الحالة الاجتماعية", "الحالة الاجتماعية للمتقدم"];
    const row = (cells, n) => `<row r="${n}">` + cells.map((v, i) => `<c r="${String.fromCharCode(65 + i)}${n}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("") + "</row>";
    const rows = [row(["بيانات الطلاب الكاملة مع بيانات طلب التقديم"], 1), row(H, 2)].concat(students.filter((s) => !url.searchParams.get("status") || s.status === url.searchParams.get("status")).map((s, i) => row(["STU-" + s.id, s.name, s.nid, s.phone, "أنثى", "-", i % 2 ? "أعزب" : "متزوج"], i + 3)));
    const z = new JSZip();
    z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الطلاب" sheetId="1" r:id="rId1"/></sheets></workbook>');
    z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    z.file("xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.join("") + "</sheetData></worksheet>");
    z.generateAsync({ type: "nodebuffer" }).then((buf) => send(200, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { "Content-Disposition": 'attachment; filename="students-basic-data-test.xlsx"' }));
    return;
  }
  if (url.pathname === "/__flaky") { global.flaky = url.searchParams.get("on") === "1"; return send(200, "ok", "text/plain"); }
  if (url.pathname.startsWith("/runner/")) {
    const f = path.join(ROOT, url.pathname.replace("/runner/", ""));
    return fs.existsSync(f) ? send(200, fs.readFileSync(f), "application/javascript; charset=utf-8") : send(404, "no");
  }
  const em = url.pathname.match(/^\/admin\/students\/(\d+)\/edit$/);
  if (req.method === "GET" && em) {
    const st = students.find((x) => String(x.id) === em[1]);
    if (!st) return send(404, layout("<p>غير موجود</p>"));
    const opt = (list, cur) => list.map(([v, t]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${t}</option>`).join("");
    const E = st.ed || {};
    return send(200, layout(`<form method="post" action="/admin/students/${st.id}">
      <input type="hidden" name="_token" value="${(() => { const t = "T" + Math.random().toString(36).slice(2); tokens.add(t); return t; })()}"><input type="hidden" name="_method" value="PUT">
      <div class="form-group"><label for="fn">الاسم الرباعي *</label><input id="fn" name="full_name" value="${esc(st.name)}"></div>
      <div class="form-group"><label for="ni">رقم الهوية *</label><input id="ni" name="national_id" value="${st.nid}"></div>
      <div class="form-group"><label for="gd">الجنس *</label><select id="gd" name="gender"><option value="">اختر</option>${opt([["male", "ذكر"], ["female", "أنثى"]], E.gender || "female")}</select></div>
      <div class="form-group"><label for="p1">رقم تواصل 1 *</label><input id="p1" name="phone_1" value="${st.phone}"></div>
      <div class="form-group"><label for="bd">تاريخ الميلاد</label><input type="date" id="bd" name="birth_date" value="${E.birth_date || ""}"></div>
      <div class="form-group"><label for="gv">المحافظة الحالية</label><select id="gv" name="governorate_id"><option value="">اختر</option>${opt([["4", "غزة"], ["2", "خانيونس"]], E.governorate_id || "")}</select></div>
      <div class="form-group"><label for="ed">المستوى التعليمي</label><select id="ed" name="education_level"><option value="">اختر</option>${opt([["bachelor", "بكالوريوس"], ["diploma", "دبلوم"]], E.education_level || "")}</select></div>
      <div class="form-group"><label for="ad">عنوان السكن الحالي بالتفصيل</label><textarea id="ad" name="current_address">${esc(E.current_address || "")}</textarea></div>
      <div class="form-group"><label for="nt">ملاحظات</label><textarea id="nt" name="notes">${esc(E.notes || "")}</textarea></div>
      <input type="password" name="password"><input type="password" name="password_confirmation">
      <label><input type="checkbox" name="must_change_password" value="1" checked> إلزام</label>
      <button>حفظ</button></form>`));
  }
  const ATT = { 1349: ["مسار التطريز والخياطة المرحلة الثانية", "G2", [["10", "ابتسام أحمد STU-2026-111", "absent"], ["11", "إخلاص محمد STU-2026-222", "present"], ["12", "سلمى علي STU-2026-333", "late"]]], 1350: ["مسار الحلاقة الرجالية المرحلة الثانية", "G2", [["10", "ابتسام أحمد STU-2026-111", "absent"], ["13", "منى سعيد STU-2026-444", "excused"]]], 1351: ["مسار التطريز والخياطة المرحلة الثالثة", "S3G1", []] };
  if (req.method === "GET" && url.pathname === "/admin/training-attendances") {
    const g = url.searchParams.get("training_group_id") || "";
    const map = { "22": "1349", "23": "1350", "24": "1351" };
    const ids = g ? [map[g]].filter(Boolean) : ["1349", "1350", "1351"];
    const rows = ids.map((id) => `<tr><td>جلسة تدريبية 12</td><td>${ATT[id][0]}</td><td>${ATT[id][1]}</td><td>مدرب</td><td>2026-11-11 09:00:00 - 14:00:00</td><td>${ATT[id][2].length}</td><td><a href="/admin/training-attendances/${id}/edit">تسجيل الحضور</a></td></tr>`).join("");
    return send(200, layout(`<h1>الحضور والانصراف</h1><form method="get" action="/admin/training-attendances"><select name="training_group_id"><option value="">الكل</option><option value="22">مسار التطريز والخياطة - G2</option><option value="23">مسار الحلاقة الرجالية - G2</option><option value="24">مسار التطريز والخياطة - S3G1</option></select><input type="date" name="date_from"><input type="date" name="date_to"><button>عرض</button></form><table><thead><tr><th>الجلسة</th><th>المسار / الدورة</th><th>المجموعة</th><th>المدرب</th><th>الموعد</th><th>سجلات الحضور</th><th></th></tr></thead><tbody>${rows}</tbody></table>`));
  }
  const attEdit = url.pathname.match(/^\/admin\/training-attendances\/(\d+)\/edit$/);
  if (req.method === "GET" && attEdit && ATT[attEdit[1]]) {
    const st = ATT[attEdit[1]][2];
    const rows = st.map((s, i) => `<tr><td><input type="hidden" name="attendances[${i}][student_id]" value="${s[0]}"><div>${s[1]}</div><select name="attendances[${i}][status]">${[["present", "حاضر"], ["late", "متأخر"], ["absent", "غائب"], ["excused", "غياب بعذر"]].map(([v, t]) => `<option value="${v}" ${s[2] === v ? "selected" : ""}>${t}</option>`).join("")}</select></td><td><input type="time" name="attendances[${i}][checked_in_at]"></td></tr>`).join("");
    return send(200, layout(`<h1>تسجيل الحضور</h1><form method="post" action="/admin/training-attendances/${attEdit[1]}"><input type="hidden" name="_token" value="x"><table><thead><tr><th>الطالب</th><th>دخول</th></tr></thead><tbody>${rows}</tbody></table></form>`));
  }
  if (req.method === "GET" && url.pathname === "/admin/evaluation-impact-reports/questions") {
    const tr = url.searchParams.get("track_id") || "";
    const card = (q, f, n, m, d) => `<div class="card"><div class="qh"><b>${q}</b><div class="sub">${f}</div></div><div class="st"><span>عدد الإجابات: ${n}</span><span>المتوسط: ${m}</span><span>النوع: مقياس 1-5</span></div><div class="bx">${d.map((v, i) => `<div><small>${i + 1}</small><b>${v}</b></div>`).join("")}</div></div>`;
    return send(200, layout(`<h1>ملخص أثر الاستبيانات</h1>
      <form method="get"><select name="track_id"><option value="">الكل</option><option value="1" ${tr === "1" ? "selected" : ""}>مسار الحلاقة الرجالية</option><option value="2" ${tr === "2" ? "selected" : ""}>مسار التسويق الرقمي</option></select><input type="date" name="date_from"><button>عرض</button></form>
      ${card("1. أعرف أنواع قصات الشعر الحديثة.", "استبانة مسار " + (tr === "2" ? "التسويق الرقمي" : "الحلاقة الرجالية") + " - قبلي", 105, "2.91", [13, 18, 46, 21, 7])}
      ${card("أستطيع استخدام ماكينة الحلاقة بكفاءة.", "استبانة مسار " + (tr === "2" ? "التسويق الرقمي" : "الحلاقة الرجالية") + " - قبلي", 105, "2.59", [25, 23, 33, 18, 6])}`));
  }
  if (req.method === "GET" && /^\/admin\/evaluation-impact-reports\/(summary|pre-post|impact|questions|responses)$/.test(url.pathname)) {
    const rows = [["الحلاقة الرجالية", "الأولى", "40", "8.5"], ["الحلاقة الرجالية", "الثانية", "30", "9.1"], ["التجميل النسائي - كوافير", "الثانية", "55", "7.8"], ["التطريز والخياطة", "الثالثة", "12", "9.4"]];
    const body = rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("");
    return send(200, layout(`<h1>ملخص قياس الأثر</h1>
      <form method="get" action="/admin/evaluation-impact-reports/summary"><label for="st">الحالة</label><select id="st" name="status"><option value="">الكل</option><option value="completed">مكتمل</option></select>${url.pathname.endsWith("pre-post") ? `<select name="stage"><option value="">كل المراحل</option><option value="2" ${url.searchParams.has("stage") ? (url.searchParams.get("stage") === "2" ? "selected" : "") : "selected"}>المرحلة الثانية</option></select>` : ""}${url.pathname.endsWith("pre-post") ? `<fieldset><legend>المراحل</legend>${[["1","الأولى"],["2","الثانية"],["3","الثالثة"]].map(([v, t]) => `<label><input type="checkbox" name="stages[]" value="${v}" ${url.searchParams.has("stages[]") ? (url.searchParams.getAll("stages[]").includes(v) ? "checked" : "") : (v === "2" ? "checked" : "")}> ${t}</label>`).join("")}</fieldset>` : ""}<input type="date" name="date_from"><input type="date" name="date_to"><button>عرض</button></form>
      <div class="card"><b>137</b> إرسالاً</div><div class="card"><b>75%</b> نسبة الاستكمال</div>
      <div class="card"><div class="card-header">حسب المسار والمرحلة</div><table><thead><tr><th>المسار</th><th>المرحلة</th><th>عدد الإرسالات</th><th>متوسط الدرجة</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="card"><div class="card-header">حسب الحالة</div><table><thead><tr><th>الحالة</th><th>العدد</th></tr></thead><tbody><tr><td>مكتمل</td><td>100</td></tr><tr><td>جزئي</td><td>37</td></tr></tbody></table></div>`));
  }
  // ===== طلبات التسجيل والمجموعات (لأمر cancel): تغيير حالة الطلب، وإخراج العضوية =====
  const newTok = () => { const t = "T" + Math.random().toString(36).slice(2); tokens.add(t); return t; };
  const readForm = (cb) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => cb(parseMultipart(Buffer.concat(chunks), req.headers["content-type"]))); };
  const APP_ST = [["submitted", "مقدم"], ["under_review", "قيد المراجعة"], ["accepted", "مقبول"], ["rejected", "مرفوض"], ["waiting_list", "قائمة انتظار"], ["cancelled", "ملغي"]];
  let am = url.pathname.match(/^\/admin\/applications\/(\d+)$/);
  if (req.method === "GET" && am) {
    const st = students.find((x) => String(x.app) === am[1]); if (!st) return send(404, layout("<p>غير موجود</p>"));
    return send(200, layout(`<h3>ملف الطلب</h3><p>${esc(st.name)}</p><form method="post" action="/admin/applications/${st.app}/change-status"><input type="hidden" name="_token" value="${newTok()}"><input type="hidden" name="_method" value="PATCH">
      <select name="status">${APP_ST.map(([v, t]) => `<option value="${v}"${v === st.appStatus ? " selected" : ""}>${t}</option>`).join("")}</select><textarea name="notes"></textarea><button>تحديث</button></form>`));
  }
  am = url.pathname.match(/^\/admin\/applications\/(\d+)\/change-status$/);
  if (req.method === "POST" && am) {
    return readForm((f) => {
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      if (f._method !== "PATCH" || !f.status) return send(422, layout("<p>طلب غير صالح</p>"));
      const st = students.find((x) => String(x.app) === am[1]); if (!st) return send(404, layout("<p>غير موجود</p>"));
      st.appStatus = f.status;
      if (f.status === "cancelled" && global.cancelRemoves) st.member = null;        // نظام يُخرج من المجموعة تلقائياً عند الإلغاء
      return send(302, "", "text/plain", { Location: "/admin/applications/" + st.app });
    });
  }
  if (req.method === "GET" && url.pathname === "/admin/training-groups") {
    const trk = url.searchParams.get("track_id");
    const rowsG = students.filter((x) => x.member && (!trk || x.track === trk)).map((x) => `<div class="row align-items-center g-2"><div class="col">${esc(x.name)} <small>${x.stu}</small></div><div class="col-md-2 text-md-end"><form method="POST" action="/admin/training-groups/members/${x.member}"><input type="hidden" name="_token" value="${newTok()}"><input type="hidden" name="_method" value="DELETE"><input type="hidden" name="track_id" value="${x.track}"><input type="hidden" name="training_course_id" value="1"><input type="hidden" name="training_group_id" value="1"><button onclick="return confirm('إخراج الطالب من هذه المجموعة؟')">إخراج</button></form>
      <form method="POST" action="/admin/training-groups/assign"><input type="hidden" name="_token" value="${newTok()}"><input type="hidden" name="student_id" value="${x.id}"><input type="hidden" name="track_id" value="${x.track}"><input type="hidden" name="training_course_id" value=""><input type="hidden" name="training_group_id_filter" value=""><select name="training_group_id"><option value="">اختر المجموعة</option>${Object.keys(GRPS).filter((g) => g !== x.group).map((g) => `<option value="${GRPS[g]}">${g}</option>`).join("")}</select><button>نقل</button></form></div></div>`).join("");
    return send(200, layout(`<form method="get" action="/admin/training-groups"><select name="track_id"><option value="">كل المسارات</option>${Object.entries(TRACKS).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></form><div class="card">${rowsG}</div>`));
  }
  if (req.method === "POST" && url.pathname === "/admin/training-groups/assign") {
    return readForm((f) => {
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      const st = students.find((x) => String(x.id) === String(f.student_id)), g = Object.keys(GRPS).find((k) => GRPS[k] === f.training_group_id);
      if (!st || !g) return send(422, layout("<p>طلب غير صالح</p>"));
      st.group = g; if (!st.member) st.member = 900 + st.id;
      return send(302, "", "text/plain", { Location: "/admin/training-groups" });
    });
  }
  if (req.method === "POST" && url.pathname === "/admin/students/bulk-update-status") {
    return readForm((f) => {
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      if (!ST_L[f.status]) return send(422, layout("<p>طلب غير صالح</p>"));
      const ids = [].concat(f["student_ids[]"] || []); if (!ids.length) return send(422, layout("<p>لا طلاب</p>"));
      ids.forEach((id) => { const st = students.find((x) => String(x.id) === String(id)); if (st) st.status = f.status; });
      return send(302, "", "text/plain", { Location: "/admin/students" });
    });
  }
  const sm = url.pathname.match(/^\/admin\/students\/(\d+)$/);
  if (req.method === "POST" && sm) {
    return readForm((f) => {
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      if (f._method !== "PUT" || !f.full_name || !f.national_id || !f.phone_1) return send(422, layout("<p>حقول إلزامية ناقصة</p>"));
      const st = students.find((x) => String(x.id) === sm[1]); if (!st) return send(404, layout("<p>غير موجود</p>"));
      st.ed = st.ed || {}; Object.keys(st.ed).concat(["marital_status"]).forEach((k) => { if (k in f) st.ed[k] = f[k]; });
      if ("password" in f) st.pwSent = true;
      return send(302, "", "text/plain", { Location: "/admin/students/" + st.id + "/edit" });
    });
  }
  if (req.method === "GET" && url.pathname === "/admin/applications") {
    const AL = { submitted: "مقدم", under_review: "قيد المراجعة", accepted: "مقبول", rejected: "مرفوض", cancelled: "ملغي", waiting_list: "قائمة انتظار" };
    const stq = url.searchParams.get("status");
    const rowsA = students.filter((x) => x.app && (!stq || x.appStatus === stq)).map((x) => `<tr><td><input type="checkbox" name="application_ids[]" value="${x.app}"></td><td>APP-2026-${x.app}</td><td>${esc(x.name)}</td><td>${TRACKS[x.track] || ""}</td><td>${AL[x.appStatus] || x.appStatus}</td><td>لم يتم التحليل</td><td>0</td><td>2026-11-20 10:00</td><td><a href="/admin/applications/${x.app}">عرض</a></td></tr>`).join("");
    return send(200, layout(`<table><thead><tr><th></th><th>رقم الطلب</th><th>المتقدم</th><th>المسار</th><th>الحالة</th><th>حالة التحليل</th><th>الدرجة</th><th>تاريخ التقديم</th><th>الإجراءات</th></tr></thead><tbody>${rowsA}</tbody></table>`));
  }
  am = url.pathname.match(/^\/admin\/training-groups\/members\/(\d+)$/);
  if (req.method === "POST" && am) {
    return readForm((f) => {
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      if (f._method !== "DELETE") return send(422, layout("<p>طلب غير صالح</p>"));
      const st = students.find((x) => String(x.member) === am[1]); if (st) st.member = null;
      return send(302, "", "text/plain", { Location: "/admin/training-groups" });
    });
  }
  if (url.pathname === "/__cancelRemoves") { global.cancelRemoves = url.searchParams.get("on") === "1"; return send(200, "ok", "text/plain"); }
  if (req.method === "GET" && url.pathname === "/admin/students") return send(200, listPage(url));
  if (req.method === "GET" && url.pathname === "/admin/students/create") return send(200, createPage());
  if (req.method === "POST" && url.pathname === "/admin/students") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const f = parseMultipart(Buffer.concat(chunks), req.headers["content-type"]);
      if (!tokens.has(f._token)) return send(419, "Page Expired");
      const errs = [];
      ["track_id", "full_name", "national_id", "gender", "phone_1"].forEach((k) => { if (!f[k]) errs.push("الحقل " + k + " مطلوب"); });
      if (f.national_id && !/^\d{9}$/.test(f.national_id)) errs.push("رقم الهوية يجب أن يكون 9 أرقام");
      if (students.some((s) => s.nid === f.national_id)) errs.push("رقم الهوية مسجّل مسبقاً");
      if (f.password) errs.push("لا يجب أن تصل كلمة مرور من الأوامر!");          // الوكيل لا يُرسلها أبداً
      if (global.flaky) return send(200, layout("<p>تم</p>"));                      // يردّ نجاحاً ولا يحفظ: يختبر «unverified»
      if (errs.length) { flashErrors = errs; return send(302, "", "text/plain", { Location: "/admin/students/create" }); }
      students.push({ id: nextId++, name: f.full_name, nid: f.national_id, phone: f.phone_1, track: f.track_id, status: f.status || "active" });
      return send(302, "", "text/plain", { Location: "/admin/students" });
    });
    return;
  }
  send(404, layout("<p>غير موجود</p>"));
}).listen(PORT, () => console.log("mock ksach on " + PORT));
