/* نظام مركز وهمي يحاكي سلوك Laravel: رمز حماية، تحقق، رفض مكرر، ترقيم صفحات، وأخطاء تُعرض مرة واحدة. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = 4197;
const ROOT = process.argv[2];                 // مجلد يحوي سكربتات الاختبار (ksach-runner.js)

const students = [];
for (let i = 1; i <= 7; i++) {
  students.push({ id: 1400 + i, name: "طالب تجريبي " + i, nid: "40000000" + i, phone: "059000000" + i, track: "2", status: "active" });
}
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
  let rows = students.filter((s) => (!q || s.name.includes(q) || s.nid.includes(q) || s.phone.includes(q)) && (!trk || s.track === trk));
  const total = rows.length;
  rows = rows.slice((page - 1) * per, page * per);
  const tr = rows.map((s, i) => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${s.nid}</td><td>${TRACKS[s.track] || ""}</td><td>${s.status}</td>
    <td><a href="/admin/students/${s.id}">تفاصيل</a>
      <div class="modal"><form method="post" action="/admin/students/${s.id}/english-name"><input type="hidden" name="_token" value="X">الاسم الإنجليزي <input name="full_name_en"><button>حفظ</button></form></div></td></tr>`).join("");
  const next = page * per < total ? `<a rel="next" href="/admin/students?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), page: page + 1 })}">التالي</a>` : "";
  return layout(`<form method="get" action="/admin/students"><input name="q"><button>عرض النتائج</button></form>
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
    return send(200, layout(`<form method="post" action="/admin/students/${st.id}">
      <input type="hidden" name="_token" value="X"><input type="hidden" name="_method" value="PUT">
      <div class="form-group"><label for="fn">الاسم الرباعي *</label><input id="fn" name="full_name" value="${esc(st.name)}"></div>
      <div class="form-group"><label for="ni">رقم الهوية *</label><input id="ni" name="national_id" value="${st.nid}"></div>
      <div class="form-group"><label for="gd">الجنس *</label><select id="gd" name="gender"><option value="">اختر</option>${opt([["male", "ذكر"], ["female", "أنثى"]], "female")}</select></div>
      <div class="form-group"><label for="p1">رقم تواصل 1 *</label><input id="p1" name="phone_1" value="${st.phone}"></div>
      <div class="form-group"><label for="bd">تاريخ الميلاد</label><input type="date" id="bd" name="birth_date" value="1998-05-20"></div>
      <div class="form-group"><label for="gv">المحافظة الحالية</label><select id="gv" name="governorate_id"><option value="">اختر</option>${opt([["4", "غزة"], ["2", "خانيونس"]], "4")}</select></div>
      <div class="form-group"><label for="ed">المستوى التعليمي</label><select id="ed" name="education_level"><option value="">اختر</option>${opt([["bachelor", "بكالوريوس"], ["diploma", "دبلوم"]], "bachelor")}</select></div>
      <div class="form-group"><label for="ad">عنوان السكن الحالي بالتفصيل</label><textarea id="ad" name="current_address">حي الرمال - شارع الوحدة</textarea></div>
      <div class="form-group"><label for="nt">ملاحظات</label><textarea id="nt" name="notes"></textarea></div>
      <input type="password" name="password"><input type="password" name="password_confirmation">
      <label><input type="checkbox" name="must_change_password" value="1" checked> إلزام</label>
      <button>حفظ</button></form>`));
  }
  if (req.method === "GET" && /^\/admin\/evaluation-impact-reports\/(summary|pre-post|impact|questions|responses)$/.test(url.pathname)) {
    const rows = [["الحلاقة الرجالية", "الأولى", "40", "8.5"], ["الحلاقة الرجالية", "الثانية", "30", "9.1"], ["التجميل النسائي - كوافير", "الثانية", "55", "7.8"], ["التطريز والخياطة", "الثالثة", "12", "9.4"]];
    const body = rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("");
    return send(200, layout(`<h1>ملخص قياس الأثر</h1>
      <form method="get" action="/admin/evaluation-impact-reports/summary"><label for="st">الحالة</label><select id="st" name="status"><option value="">الكل</option><option value="completed">مكتمل</option></select><input type="date" name="date_from"><input type="date" name="date_to"><button>عرض</button></form>
      <div class="card"><b>137</b> إرسالاً</div><div class="card"><b>75%</b> نسبة الاستكمال</div>
      <div class="card"><div class="card-header">حسب المسار والمرحلة</div><table><thead><tr><th>المسار</th><th>المرحلة</th><th>عدد الإرسالات</th><th>متوسط الدرجة</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="card"><div class="card-header">حسب الحالة</div><table><thead><tr><th>الحالة</th><th>العدد</th></tr></thead><tbody><tr><td>مكتمل</td><td>100</td></tr><tr><td>جزئي</td><td>37</td></tr></tbody></table></div>`));
  }
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
