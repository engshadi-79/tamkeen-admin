/* مطابقة أوراق التوقيع: صور الأوراق ← ذكاء اصطناعي بصري يقرأ الأسماء ويحكم أيوجد توقيع ← مطابقة مع المسجلين.
   هذا الملف: تجهيز الصور (تصغير)، وطلب القراءة، وفهم الرد. لا يقرأ من نظام المركز ولا يعرف الواجهة.
   الصور تُرسَل إلى مزوّد الذكاء الاصطناعي المضبوط (Gemini أو Claude) بمفتاح المستخدم، ولا تُحفظ في أي مكان. */
(function (App) {
  const MAX_SIDE = 1800;     // أقصى بُعد بعد التصغير (بكسل)
  const QUALITY = 0.85;

  const SYSTEM = `أنت تقرأ صور أوراق حضور وتوقيع متدربين في مركز تدريب، وتعيد البيانات بصيغة JSON فقط.
القواعد:
- استخرج من الورقة كل صف فيه اسم متدرب (مطبوع أو مكتوب بخط اليد) بالترتيب الذي يظهر.
- لكل صف احكم هل يوجد توقيع المتدرب: signed=true إن وُجد في خانة التوقيع أي خط أو توقيع أو إمضاء أو اختصار بخط اليد أو علامة من المتدرب، وsigned=false إن كانت الخانة فارغة، وsigned=null إن لم تستطع الجزم.
- اقرأ الأسماء كما هي بالعربية بلا تصحيح ولا اجتهاد، وإن كان الاسم غير واضح فاكتب أقرب قراءة وخفّض الثقة.
- إن وُجد في الورقة عمود لرقم الهوية أو رقم الجوال فاقرأه لكل صف حرفياً كأرقام (id وphone)، وإن لم يوجد أو لم يُقرأ فاتركه فارغاً "". لا تخمّن أرقاماً.
- حدّد «اسم النموذج» من ترويسة الورقة أو عنوانها (كلمات قليلة تميّز نوع الوثيقة، مثل «تعهد استلام الحقيبة» أو «كشف حضور»)، وأعطِ الاسم نفسه لكل الأوراق من النوع ذاته.
- تجاهل العناوين والتواريخ والأختام وأسماء المدربين وصفوف الترويسة.
- لا تخترع أسماء غير موجودة في الصورة.
- الرد JSON وحده بلا شرح.`;

  const PROMPT = `اقرأ الورقة المرفقة وأعد JSON بهذا الشكل بالضبط:
{"title":"عنوان الورقة أو التاريخ إن ظهر","form":"اسم النموذج من الترويسة","rows":[{"name":"الاسم كما يظهر","id":"رقم الهوية إن وُجد","phone":"رقم الجوال إن وُجد","signed":true,"confidence":0.0}]}
حيث confidence رقم بين 0 و1 لثقتك في قراءة الاسم والحكم على التوقيع.`;

  const TABLE_SYSTEM = `أنت تحوّل صور الجداول (كشوف أسماء، درجات، هويات، حضور) إلى بيانات منظمة، وتعيد JSON فقط.
- أعد رؤوس الأعمدة كما تظهر في الصورة، ثم كل صف بنفس عدد الأعمدة وبالترتيب.
- انقل النص والأرقام حرفياً بلا تصحيح ولا اجتهاد، والأرقام بالصيغة الإنجليزية 0-9.
- الخلية الفارغة أو غير المقروءة اكتبها "" ولا تخترع قيماً.
- تجاهل العناوين والأختام خارج الجدول.
- الرد JSON وحده بلا شرح.`;
  const TABLE_PROMPT = 'حوّل الجدول في الصورة وأعد JSON بهذا الشكل بالضبط: {"title":"عنوان الجدول إن ظهر","heads":["عمود1","عمود2"],"rows":[["قيمة","قيمة"]]}';

  /* صورة جدول ← { title, heads, rows } (الصفوف تُوحَّد على عدد الرؤوس) */
  async function readTable(image, opts) {
    const ai = (opts && opts.ai) || App.ai;
    if (!ai || !ai.vision) throw new Error("خدمة قراءة الصور غير متاحة");
    const text = await ai.vision({ images: [{ mime: image.mime, data: image.data }], prompt: TABLE_PROMPT, system: TABLE_SYSTEM, signal: opts && opts.signal, fast: !!(opts && opts.fast) });
    const j = parseJson(text);
    const heads = (Array.isArray(j.heads) ? j.heads : []).map((h) => String(h == null ? "" : h).trim());
    let rows = (Array.isArray(j.rows) ? j.rows : []).filter(Array.isArray).map((r) => r.map((c) => String(c == null ? "" : c).replace(/\s+/g, " ").trim()));
    const n = Math.max(heads.length, ...rows.map((r) => r.length), 0);
    while (heads.length < n) heads.push("عمود " + (heads.length + 1));
    rows = rows.map((r) => { const o = r.slice(0, n); while (o.length < n) o.push(""); return o; }).filter((r) => r.some(Boolean));
    return { name: image.name, title: String(j.title || "").slice(0, 120), heads, rows };
  }
  async function readTables(images, opts) {
    const out = { tables: new Array(images.length), failed: [], quota: false };
    let next = 0, done = 0;
    const worker = async () => {
      while (next < images.length) {
        if ((opts && opts.signal && opts.signal.aborted) || out.quota) return;
        const k = next++, im = images[k];
        try { out.tables[k] = await readTable(im, opts); }
        catch (e) { if (e && e.message === "NO_KEY") throw e; if (isDayQuota(e)) out.quota = true; out.failed.push({ name: im.name, error: out.quota ? "حد الاستخدام اليومي" : (e && e.message) || String(e) }); }
        done++; if (opts && opts.onProgress) opts.onProgress(done, images.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    out.tables = out.tables.filter(Boolean);
    return out;
  }

  /* ملف صورة ← { mime, data(base64), thumb(dataURL صغيرة) } بعد تصغيره */
  function prepare(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
          const full = c.toDataURL("image/jpeg", QUALITY);
          const t = document.createElement("canvas"), tk = 120 / Math.max(w, h); t.width = Math.round(w * tk); t.height = Math.round(h * tk);
          t.getContext("2d").drawImage(img, 0, 0, t.width, t.height);
          URL.revokeObjectURL(url);
          resolve({ name: file.name, mime: "image/jpeg", data: full.split(",")[1], thumb: t.toDataURL("image/jpeg", 0.6), w, h });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذّر فتح الصورة «" + file.name + "». استعمل JPG أو PNG.")); };
      img.src = url;
    });
  }

  /* يستخرج JSON من رد النموذج حتى لو أحاطه بنص أو بسياج ``` */
  function parseJson(text) {
    let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("لم يرجع النموذج بيانات مفهومة.");
    t = t.slice(a, b + 1);
    try { return JSON.parse(t); } catch (e) { /* محاولة إصلاح الفواصل الزائدة */ }
    return JSON.parse(t.replace(/,\s*([}\]])/g, "$1"));
  }

  /* صف مقروء ← شكل موحّد */
  function normRow(r, file, i) {
    const name = String((r && r.name) || "").replace(/\s+/g, " ").trim();
    if (!name) return null;
    const s = r.signed;
    return {
      id: file + ":" + i, file, name,
      nid: String((r && r.id) || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""),
      phone: String((r && r.phone) || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""),
      signed: s === true || s === "true" ? true : s === false || s === "false" ? false : null,
      conf: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    };
  }

  /* قراءة صورة واحدة. image: ناتج prepare. يعيد { title, rows } */
  async function readSheet(image, opts) {
    const ai = (opts && opts.ai) || App.ai;
    if (!ai || !ai.vision) throw new Error("خدمة قراءة الصور غير متاحة");
    const text = await ai.vision({ images: [{ mime: image.mime, data: image.data }], prompt: PROMPT, system: SYSTEM, signal: opts && opts.signal, fast: !!(opts && opts.fast) });
    const j = parseJson(text);
    const rows = (Array.isArray(j.rows) ? j.rows : []).map((r, i) => normRow(r, image.name, i)).filter(Boolean);
    const form = String(j.form || "").replace(/\s+/g, " ").trim().slice(0, 80);
    rows.forEach((r) => { r.formAuto = form; });
    return { title: String(j.title || "").slice(0, 120), form, rows };
  }

  /* بلوغ الحد اليومي المجاني: لا جدوى من إعادة المحاولة، فتُوقَف بقية الطلبات فوراً */
  const isDayQuota = (e) => /per day|PerDay|requests per day|PerDayPerProject/i.test((e && e.message) || "");
  const QUOTA_MSG = "بلغتَ الحد اليومي المجاني لمزوّد الذكاء الاصطناعي فتوقّفت القراءة.";

  const MULTI_PROMPT = (n) => `أمامك ${n} صور لأوراق مختلفة بالترتيب (الصورة 1 ثم 2 … ثم ${n}). اقرأ كل ورقة على حدة وأعد JSON بهذا الشكل بالضبط:
{"sheets":[{"image":1,"title":"عنوان الورقة أو التاريخ إن ظهر","form":"اسم النموذج من الترويسة","rows":[{"name":"الاسم كما يظهر","id":"رقم الهوية إن وُجد","phone":"رقم الجوال إن وُجد","signed":true,"confidence":0.0}]}]}
عنصر واحد في sheets لكل صورة بنفس ترتيبها، ولا تخلط أسماء صورة بصورة أخرى. confidence بين 0 و1.`;

  /* عدة صور في طلب واحد (يوفّر حصة الطلبات): يعيد [{ title, rows }] بترتيب الصور */
  async function readBatch(images, opts) {
    if (images.length === 1) return [await readSheet(images[0], opts)];
    const ai = (opts && opts.ai) || App.ai;
    if (!ai || !ai.vision) throw new Error("خدمة قراءة الصور غير متاحة");
    const text = await ai.vision({ images: images.map((im) => ({ mime: im.mime, data: im.data })), prompt: MULTI_PROMPT(images.length), system: SYSTEM, signal: opts && opts.signal, fast: !!(opts && opts.fast) });
    const j = parseJson(text), sheets = Array.isArray(j.sheets) ? j.sheets : null;
    if (!sheets || !sheets.length) throw new Error("لم يرجع النموذج بيانات الصور المتعددة بالشكل المطلوب.");
    return images.map((im, k) => {
      const sh = sheets.find((x) => Number(x && x.image) === k + 1) || sheets[k] || { rows: [] };
      const rows = (Array.isArray(sh.rows) ? sh.rows : []).map((r, i) => normRow(r, im.name, i)).filter(Boolean);
      const form = String(sh.form || "").replace(/\s+/g, " ").trim().slice(0, 80);
      rows.forEach((r) => { r.formAuto = form; });
      return { title: String(sh.title || "").slice(0, 120), form, rows };
    });
  }

  /* عدة صور: opts.batch صورة في كل طلب (الافتراضي 1)، وأربعة طلبات معاً كحد أقصى. إخفاق طلب لا يوقف البقية،
     وبلوغ الحد اليومي يوقف الباقي ويضع out.quota */
  async function readSheets(images, opts) {
    const out = { rows: [], titles: [], failed: [], quota: false };
    const B = Math.max(1, Math.min(6, Math.round(Number(opts && opts.batch)) || 1));
    const groups = []; for (let i = 0; i < images.length; i += B) groups.push(images.slice(i, i + B));
    let next = 0, done = 0;
    const worker = async () => {
      while (next < groups.length) {
        if ((opts && opts.signal && opts.signal.aborted) || out.quota) return;
        const g = groups[next++];
        try {
          const rs = await readBatch(g, opts);
          rs.forEach((r, k) => { r.rows.forEach((x) => out.rows.push(x)); if (r.title) out.titles.push(g[k].name + ": " + r.title); });
        } catch (e) {
          if (e && e.message === "NO_KEY") throw e;
          if (isDayQuota(e)) out.quota = true;
          g.forEach((im) => out.failed.push({ name: im.name, error: out.quota ? "حد الاستخدام اليومي" : (e && e.message) || String(e) }));
        }
        done += g.length;
        if (opts && opts.onProgress) opts.onProgress(done, images.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // ما لم يُقرأ بسبب الحد اليومي يُسجَّل غير مقروء
    if (out.quota) { const have = new Set(out.failed.map((x) => x.name)); images.forEach((im) => { if (!have.has(im.name) && !out.rows.some((r) => r.file === im.name)) out.failed.push({ name: im.name, error: "حد الاستخدام اليومي" }); }); }
    return out;
  }

  App.centerSign = { prepare, readSheet, readBatch, readSheets, readTable, readTables, parseJson, normRow, isDayQuota, QUOTA_MSG, SYSTEM, PROMPT };
})(window.App = window.App || {});
