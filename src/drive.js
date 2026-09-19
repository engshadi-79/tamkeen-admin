/* الأرشفة على Google Drive من المتصفح بحساب المستخدم نفسه (OAuth)، بلا خادم ولا ملف مفاتيح.
   الصلاحية drive.file: الأداة لا ترى من Drive إلا الملفات والمجلدات التي أنشأتها بنفسها.
   الرمز (token) صالح ساعة ويُحفظ في هذا المتصفح فقط، وحساب الجهاز يُتذكّر حتى لا تظهر شاشة اختيار الحساب. */
(function (App) {
  const { ui } = App;
  const STORAGE = "tamkeen-admin:drive";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const DEFAULT_CLIENT_ID = "535546605048-1b0fsog86g1einvpoehb06uf2uaho6h1.apps.googleusercontent.com";

  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    // مُعرّف عميل المركز مضمَّن حتى تعمل الأداة على أي جهاز مباشرة (مُعرّف عام وليس سراً)
    return Object.assign({ clientId: DEFAULT_CLIENT_ID, autoArchive: true, rootName: "أرشيف مساعد تمكين", folders: {}, users: [], projectId: "tamkeen-archive" }, s);
  }
  function saveSettings(patch) {
    const s = Object.assign(settings(), patch);
    try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch (e) { /* تخزين غير متاح */ }
    return s;
  }

  const viaCloud = () => !!(App.cloud && App.cloud.ready());
  const isConfigured = () => viaCloud() || !!settings().clientId;
  const supportedOrigin = () => location.protocol === "http:" || location.protocol === "https:";

  /* ===== تسجيل الدخول (Google Identity Services) ===== */
  let gisPromise = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gisPromise = null; reject(new Error("تعذّر تحميل خدمة تسجيل الدخول من Google. تحقق من الاتصال بالإنترنت.")); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  /* الرمز صالح ساعة واحدة؛ يُحفظ في هذا المتصفح حتى لا يُطلب الإذن مع كل تحديث للصفحة */
  const TOKEN_KEY = "tamkeen-admin:drive-token";
  let token = (() => {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      return t && t.clientId === settings().clientId && Date.now() < t.expiresAt - 60000 ? t : null;
    } catch (e) { return null; }
  })();
  const hasToken = () => viaCloud() || !!(token && Date.now() < token.expiresAt - 60000);
  function setToken(t) {
    token = t;
    try { if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* تخزين غير متاح */ }
  }

  /* تحميل خدمة Google مسبقاً حتى تفتح نافذة الإذن فوراً عند الضغط (المتصفح يمنعها إن تأخرت) */
  if (!viaCloud() && isConfigured() && supportedOrigin()) setTimeout(() => loadGis().catch(() => {}), 1500);

  /* يجب استدعاؤها من ضغطة زر (نافذة Google المنبثقة تحتاج تفاعل المستخدم) */
  async function connect() {
    if (!supportedOrigin()) throw new Error("الأرشفة على Drive تحتاج تشغيل الأداة من «تشغيل.bat» (عنوان http://localhost:4180) وليس بفتح الملف مباشرة.");
    const { clientId } = settings();
    if (!clientId) throw new Error("أدخل مُعرّف العميل (Client ID) أولاً من إعدادات Google Drive.");
    await loadGis();
    const { email } = settings();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        // حساب هذا الجهاز معروف: بلا شاشة اختيار حساب، والموافقة تظهر مرة واحدة فقط لكل حساب
        prompt: "",
        hint: email || undefined,
        callback: async (resp) => {
          if (resp.error) {
            reject(new Error(resp.error === "access_denied" ? "لم يُمنح الإذن بالوصول إلى Drive. إن ظهرت رسالة «Access blocked» فالحساب غير مضاف في قائمة المستخدمين في Google Cloud." : `تعذّر الاتصال: ${resp.error}`));
            return;
          }
          setToken({ value: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000, clientId });
          let who = "";
          try {
            const about = await api(`${API}/about?fields=user(emailAddress)`);
            who = (about.user && about.user.emailAddress) || "";
          } catch (e) { /* يُتحقق من الحساب إن أمكن */ }
          // قائمة المستخدمين المسموح لهم (إن لم تكن فارغة): أي حساب آخر يُرفض ويُلغى إذنه
          if (who && !isAllowed(who)) {
            disconnect();
            saveSettings({ email: "" });
            reject(new Error(`الحساب ${who} غير مسموح له. أضفه في «المستخدمون المسموح لهم» في إعدادات Google Drive.`));
            return;
          }
          if (who) saveSettings({ email: who });
          resolve();
        },
        error_callback: (err) => reject(new Error(err && err.type === "popup_closed" ? "أُغلقت نافذة تسجيل الدخول." : "تعذّر فتح نافذة تسجيل الدخول (قد يكون المتصفح منع النوافذ المنبثقة).")),
      });
      client.requestAccessToken();
    });
  }

  /* ===== المستخدمون المسموح لهم ===== */
  const normEmail = (e) => String(e || "").trim().toLowerCase();
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));
  const users = () => settings().users;
  const isAllowed = (email) => !users().length || users().some((u) => u.email === normEmail(email));

  function addUsers(text) {
    const list = users();
    // أول إضافة: يُضاف الحساب المتصل حالياً (صاحب الأداة) حتى لا يُمنع هو نفسه
    const me = normEmail(settings().email);
    if (!list.length && me) list.push({ email: me, addedAt: new Date().toISOString(), inGoogle: true });
    const found = String(text).split(/[\s,;،]+/).map(normEmail).filter(Boolean);
    const invalid = found.filter((e) => !validEmail(e));
    const added = found.filter((e) => validEmail(e) && !list.some((u) => u.email === e));
    [...new Set(added)].forEach((email) => list.push({ email, addedAt: new Date().toISOString(), inGoogle: false }));
    saveSettings({ users: list });
    return { added: [...new Set(added)], invalid };
  }
  function removeUser(email) { saveSettings({ users: users().filter((u) => u.email !== normEmail(email)) }); }
  function markInGoogle() { saveSettings({ users: users().map((u) => Object.assign(u, { inGoogle: true })) }); }
  const audienceUrl = () => `https://console.cloud.google.com/auth/audience?project=${encodeURIComponent(settings().projectId || "tamkeen-archive")}`;

  function disconnect() {
    if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
    setToken(null);
  }

  /* ===== طلبات Drive ===== */
  async function api(url, options = {}) {
    if (!hasToken()) throw new Error("NOT_CONNECTED");
    let res;
    try {
      res = await fetch(url, Object.assign({}, options, { headers: Object.assign({ Authorization: `Bearer ${token.value}` }, options.headers || {}) }));
    } catch (e) {
      throw new Error("تعذّر الاتصال بـ Google Drive. تحقق من الإنترنت.");
    }
    if (res.status === 401) { setToken(null); throw new Error("NOT_CONNECTED"); }
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error.message; } catch (e) { /* ليس JSON */ }
      throw new Error(`خطأ من Google Drive (${res.status})${msg ? `: ${msg}` : ""}`);
    }
    return res.json();
  }

  const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  async function folderId(name, parentId) {
    const cache = settings().folders;
    const key = `${parentId || "root"}/${name}`;
    if (cache[key]) return cache[key];
    const query = `name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false` + (parentId ? ` and '${q(parentId)}' in parents` : "");
    const found = await api(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`);
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const created = await api(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
      });
      id = created.id;
    }
    saveSettings({ folders: Object.assign(settings().folders, { [key]: id }) });
    return id;
  }

  /* مسار داخل مجلد الأرشيف، مثل ["الصادر", "2026", "09"] */
  async function ensurePath(path) {
    let parent = await folderId(settings().rootName, null);
    for (const part of path) parent = await folderId(part, parent);
    return parent;
  }

  async function upload(blob, name, path) {
    if (viaCloud()) return App.cloud.upload(blob, name, path);
    const parent = await ensurePath(path);
    const boundary = "tamkeen" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [parent] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const res = await api(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return { id: res.id, link: res.webViewLink, folderId: parent };
  }

  /* مسار الأرشيف حسب التاريخ: [المجلد، السنة، الشهر] */
  const datePath = (folder, dateISO) => {
    const d = String(dateISO || ui.todayISO());
    return [folder, d.slice(0, 4), d.slice(5, 7)];
  };

  const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

  App.drive = { viaCloud, users, addUsers, removeUser, markInGoogle, isAllowed, audienceUrl, validEmail, folderLink, settings, saveSettings, isConfigured, supportedOrigin, hasToken, connect, disconnect, upload, datePath };
})(window.App = window.App || {});
