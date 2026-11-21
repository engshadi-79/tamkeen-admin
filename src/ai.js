/* توليد نص المراسلة بالذكاء الاصطناعي مباشرة من المتصفح بمفتاح يُدخله المستخدم.
   المزوّدان: Google Gemini (مجاني بحدود يومية) و Claude من Anthropic (مدفوع).
   لا توجد مكتبات خارجية ولا خادم؛ الطلب يُرسل إلى المزوّد المختار فقط عند الضغط على «توليد». */
(function (App) {
  const STORAGE = "tamkeen-admin:ai"; // منفصل عن بيانات النسخة الاحتياطية

  const SYSTEM = `أنت كاتب مراسلات إدارية رسمية في «مركز مسارات التمكين للتدريب والتطوير»، الجهة المنفذة لمشروع تمكين (PP-003) الممول من مركز الملك سلمان للإغاثة والأعمال الإنسانية والمركز السعودي للأعمال الإنسانية.

مهمتك كتابة متن المراسلة فقط بالعربية الفصحى الرسمية المناسبة للمراسلات الإدارية، بناءً على طلب المستخدم.

القالب يضيف تلقائياً: البسملة، والتاريخ، واسم المرسل إليه وصفته، والتحية («السلام عليكم ورحمة الله وبركاته، وبعد:»)، وسطر الموضوع، وعبارة الختام «وتقبلوا منا فائق الاحترام والتقدير»، والتوقيع. لذلك لا تكتب أياً منها.

- اكتب فقرات نصية عادية، كل فقرة في سطر مستقل، بلا عناوين ولا تنسيق Markdown ولا رموز مثل * أو #.
- إن احتاج المضمون إلى بنود فاكتبها مرقمة: 1. 2. 3. كل بند في سطر.
- لا تخترع أرقاماً أو تواريخ أو أسماء لم يذكرها المستخدم؛ إن كانت معلومة ضرورية ناقصة فضع مكانها «…………».
- اجعل النص موجزاً ومباشراً بقدر ما يحتاجه الطلب.
- أجب بنص المتن وحده، دون مقدمة أو تعليق منك.`;

  /* ===== الإعدادات ===== */
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    // ترحيل مفتاح Claude من الإصدار السابق
    try {
      const old = localStorage.getItem("tamkeen-admin:ai-key");
      if (old && !s.claudeKey) { s.claudeKey = old; localStorage.removeItem("tamkeen-admin:ai-key"); }
    } catch (e) { /* تخزين غير متاح */ }
    // إعدادات المركز المشتركة أولاً، ثم إعدادات هذا الجهاز إن وُجدت (الجهاز يتقدّم)
    const shared = (App.store && App.store.get().aiSettings) || {};
    const local = Object.keys(s).length ? s : {};
    return Object.assign({ provider: "gemini", geminiKey: "", claudeKey: "", claudeModel: CLAUDE_MODEL, share: true }, shared, local);
  }

  /* share=true: المفتاح يُحفظ في إعدادات المركز ويصل لكل المستخدمين بعد المزامنة */
  function saveSettings(s) {
    const share = s.share !== false;
    try {
      if (share) {
        localStorage.removeItem(STORAGE);
        if (App.store) {
          App.store.get().aiSettings = Object.assign({}, s, { share: true });
          App.store.save();
        }
      } else {
        localStorage.setItem(STORAGE, JSON.stringify(Object.assign({}, s, { share: false })));
      }
    } catch (e) { /* تخزين غير متاح */ }
  }
  const settings = () => loadSettings();
  const hasKey = (provider) => { const s = loadSettings(); return !!((provider || s.provider) === "claude" ? s.claudeKey : s.geminiKey); };

  /* ===== قراءة أحداث SSE ===== */
  async function readSSE(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("\n");
        if (!data) continue;
        let evt;
        try { evt = JSON.parse(data); } catch (e) { continue; }
        onEvent(evt);
      }
    }
  }

  async function post(url, headers, body, signal) {
    try {
      return await fetch(url, { method: "POST", signal, headers, body: JSON.stringify(body) });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error("تعذّر الاتصال بخدمة الذكاء الاصطناعي. تحقق من اتصال الإنترنت.");
    }
  }

  async function readError(res) {
    try { return await res.json(); } catch (e) { return null; }
  }

  /* ===== Google Gemini ===== */
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
  // نماذج مستقرة معروفة تُجرَّب إن لم تتوفر قائمة النماذج
  const GEMINI_KNOWN_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  let geminiCandidates = null; // تُجلب مرة واحدة في الجلسة
  let geminiWorking = null; // آخر نموذج نجح، يُجرَّب أولاً

  const versionOf = (id) => parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);

  // نماذج Flash المتاحة لهذا المفتاح: الأحدث أولاً، ثم نسخ lite، ثم النماذج المعروفة
  async function geminiModels(key, signal) {
    if (!geminiCandidates) {
      let ids = [];
      try {
        const res = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": key }, signal });
        if (res.ok) {
          const { models = [] } = await res.json();
          ids = models
            .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map((m) => m.name.replace(/^models\//, ""))
            .filter((id) => /^gemini-\d+(?:\.\d+)?-flash(?:-lite)?$/.test(id));
        }
      } catch (e) {
        if (e.name === "AbortError") throw e;
      }
      const flash = ids.filter((id) => !id.endsWith("-lite")).sort((a, b) => versionOf(b) - versionOf(a));
      const lite = ids.filter((id) => id.endsWith("-lite")).sort((a, b) => versionOf(b) - versionOf(a));
      if (ids.length) geminiCandidates = [...new Set([...flash, ...lite, ...GEMINI_KNOWN_MODELS])];
      else return GEMINI_KNOWN_MODELS; // لا تُحفظ؛ قد يكون المفتاح غير صالح بعد
    }
    return geminiWorking ? [geminiWorking, ...geminiCandidates.filter((m) => m !== geminiWorking)] : geminiCandidates;
  }

  function geminiError(status, body) {
    const msg = (body && body.error && body.error.message) || "";
    if (/API key not valid|API_KEY_INVALID/i.test(msg) || status === 401 || status === 403)
      return "مفتاح Gemini غير صحيح أو لا يملك صلاحية. تحقق منه من «الإعدادات».";
    if (status === 429) return "تم بلوغ حد الاستخدام المجاني لـ Gemini على كل النماذج المتاحة. انتظر دقيقة ثم حاول، أو أكمل غداً إن كان الحد اليومي." + (msg ? `\n(${msg})` : "");
    if (status >= 500) return `خدمة Gemini مشغولة حالياً على كل النماذج المتاحة (${status}). حاول بعد قليل.` + (msg ? `\n(${msg})` : "");
    return `تعذّر إتمام الطلب (${status})` + (msg ? `: ${msg}` : "");
  }

  // أخطاء تستدعي تجربة نموذج آخر: ازدحام، حد الحصة للنموذج، نموذج غير متاح
  const RETRY_WITH_OTHER_MODEL = (status) => status === 429 || status === 404 || status >= 500;
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

  async function generateGemini({ key, userContent, onText, signal, systemPrompt }) {
    const candidates = await geminiModels(key, signal);
    let res = null;
    let lastStatus = 0;
    let lastBody = null;
    for (let i = 0; i < candidates.length && i < 4; i++) {
      if (i > 0) await wait(700, signal);
      res = await post(
        `${GEMINI_BASE}/models/${encodeURIComponent(candidates[i])}:streamGenerateContent?alt=sse`,
        { "content-type": "application/json", "x-goog-api-key": key },
        {
          systemInstruction: { parts: [{ text: systemPrompt || SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: { maxOutputTokens: 8192 },
        },
        signal
      );
      if (res.ok) { geminiWorking = candidates[i]; break; }
      lastStatus = res.status;
      lastBody = await readError(res);
      console.warn(`Gemini ${candidates[i]} → ${res.status}`, lastBody && lastBody.error && lastBody.error.message);
      if (!RETRY_WITH_OTHER_MODEL(res.status)) break;
    }
    if (!res || !res.ok) throw new Error(geminiError(lastStatus, lastBody));

    let stop = null;
    await readSSE(res, (evt) => {
      if (evt.error) throw new Error(geminiError(evt.error.code || 0, evt));
      if (evt.promptFeedback && evt.promptFeedback.blockReason) stop = "refusal";
      const cand = (evt.candidates || [])[0];
      if (!cand) return;
      ((cand.content && cand.content.parts) || []).forEach((p) => { if (p.text && !p.thought) onText(p.text); });
      if (cand.finishReason === "MAX_TOKENS") stop = "max_tokens";
      else if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(cand.finishReason)) stop = "refusal";
    });
    return stop;
  }

  /* ===== Claude (Anthropic) ===== */
  // نماذج كلود: الأعلى جودة أولاً، والأوفر أخيراً
  const CLAUDE_MODELS = [
    { id: "claude-opus-5", label: "Opus 5 — الأقوى للتحليل الطويل" },
    { id: "claude-sonnet-5", label: "Sonnet 5 — متوازن وأوفر" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — الأسرع والأرخص" },
  ];
  const CLAUDE_MODEL = CLAUDE_MODELS[0].id;

  function claudeError(status, body) {
    const apiMsg = body && body.error && body.error.message ? ` (${body.error.message})` : "";
    if (status === 401) return "مفتاح Claude غير صحيح. تحقق منه من «الإعدادات».";
    if (status === 403) return "المفتاح لا يملك صلاحية استخدام هذا النموذج." + apiMsg;
    if (status === 429) return "تم تجاوز حد الاستخدام مؤقتاً. حاول بعد قليل.";
    if (status === 529 || status >= 500) return "خدمة Claude مشغولة حالياً. حاول بعد قليل.";
    return "تعذّر إتمام الطلب" + apiMsg;
  }

  async function generateClaude({ key, userContent, onText, signal, model, systemPrompt }) {
    const res = await post(
      "https://api.anthropic.com/v1/messages",
      {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      {
        model: model || CLAUDE_MODEL,
        max_tokens: 16000,
        stream: true,
        fallbacks: "default",
        output_config: { effort: "low" },
        system: systemPrompt || SYSTEM,
        messages: [{ role: "user", content: userContent }],
      },
      signal
    );
    if (!res.ok) throw new Error(claudeError(res.status, await readError(res)));

    let stop = null;
    await readSSE(res, (evt) => {
      if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") onText(evt.delta.text);
      else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason) stop = evt.delta.stop_reason;
      else if (evt.type === "error") throw new Error(evt.error && evt.error.type === "overloaded_error" ? claudeError(529) : claudeError(0, evt));
    });
    return stop;
  }

  /* يرسل الطلب ويستدعي onText مع كل جزء نصي يصل. يُرجع سبب التوقف: refusal | max_tokens | غير ذلك */
  async function generate({ request, context, onText, signal, provider, systemPrompt }) {
    const s = loadSettings();
    const use = provider || s.provider; // يمكن اختيار الخدمة لكل طلب (مثل تحليل ملفات التقرير)
    const key = use === "claude" ? s.claudeKey : s.geminiKey;
    if (!key) throw new Error("NO_KEY");

    // السياق إما نص جاهز (تحليل ملفات ومرفقات) أو حقول مراسلة
    const asText = typeof context === "string";
    const contextText = asText ? context
      : Object.entries(context || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
    const userContent = `${contextText ? `${asText ? "المحتوى" : "بيانات المراسلة"}:\n${contextText}\n\n` : ""}المطلوب كتابته:\n${request}`;

    const run = use === "claude" ? generateClaude : generateGemini;
    return run({ key, userContent, onText, signal, model: s.claudeModel, systemPrompt });
  }

  /* ===== قراءة صور (رؤية): يرسل صوراً مع تعليمات ويعيد نصاً (JSON غالباً) ===== */
  const visionNoThink = new Set();
  async function visionGemini({ key, prompt, images, system, signal }) {
    const candidates = await geminiModels(key, signal);
    const parts = [{ text: prompt }].concat(images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })));
    let lastStatus = 0, lastBody = null;
    for (let i = 0; i < candidates.length && i < 4; i++) {
      if (i > 0) await wait(700, signal);
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(candidates[i])}:generateContent`, hdr = { "content-type": "application/json", "x-goog-api-key": key };
      const mk = (think) => ({
        systemInstruction: { parts: [{ text: system || "" }] },
        contents: [{ role: "user", parts }],
        generationConfig: Object.assign({ maxOutputTokens: 16384, temperature: 0, responseMimeType: "application/json" }, think ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      });
      // إيقاف «التفكير» يسرّع القراءة كثيراً (استخراج نص لا يحتاج استدلالاً)؛ إن رفضه النموذج نعيد الطلب بدونه
      let res = visionNoThink.has(candidates[i]) ? await post(url, hdr, mk(false), signal) : await post(url, hdr, mk(true), signal);
      if (!res.ok && res.status === 400 && !visionNoThink.has(candidates[i])) { visionNoThink.add(candidates[i]); res = await post(url, hdr, mk(false), signal); }
      if (res.ok) {
        geminiWorking = candidates[i];
        const j = await res.json();
        const cand = (j.candidates || [])[0] || {};
        if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error("رفض Gemini قراءة هذه الصورة.");
        return ((cand.content && cand.content.parts) || []).map((x) => x.text || "").join("");
      }
      lastStatus = res.status; lastBody = await readError(res);
      if (!RETRY_WITH_OTHER_MODEL(res.status)) break;
    }
    throw new Error(geminiError(lastStatus, lastBody));
  }
  async function visionClaude({ key, prompt, images, system, signal, model }) {
    const content = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })).concat([{ type: "text", text: prompt }]);
    const res = await post("https://api.anthropic.com/v1/messages", {
      "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    }, { model: model || CLAUDE_MODEL, max_tokens: 16000, system: system || "", messages: [{ role: "user", content }] }, signal);
    if (!res.ok) throw new Error(claudeError(res.status, await readError(res)));
    const j = await res.json();
    return (j.content || []).filter((x) => x.type === "text").map((x) => x.text).join("");
  }
  /* images: [{ mime, data(base64) }]؛ يستعمل المزوّد والمفتاح المضبوطين في الإعدادات */
  async function vision({ images, prompt, system, signal, provider }) {
    const s = loadSettings();
    const use = provider || s.provider;
    const key = use === "claude" ? s.claudeKey : s.geminiKey;
    if (!key) throw new Error("NO_KEY");
    const run = use === "claude" ? visionClaude : visionGemini;
    return run({ key, prompt, images, system, signal, model: s.claudeModel });
  }

  /* ترحيل المفتاح القديم المحفوظ على هذا الجهاز إلى إعدادات المركز، ليعمل عند الجميع */
  function migrateToShared() {
    if (!App.store) return;
    let local = {};
    try { local = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (e) { return; }
    if (!local.geminiKey && !local.claudeKey) return;
    if (local.share === false) return; // المستخدم اختار إبقاءه على جهازه
    const shared = App.store.get().aiSettings || {};
    if (shared.geminiKey || shared.claudeKey) { try { localStorage.removeItem(STORAGE); } catch (e) { /* تخزين غير متاح */ } return; }
    App.store.get().aiSettings = Object.assign({ provider: "gemini", claudeModel: CLAUDE_MODEL }, local, { share: true });
    App.store.save();
    try { localStorage.removeItem(STORAGE); } catch (e) { /* تخزين غير متاح */ }
    if (App.ui) App.ui.toast("صار مفتاح الذكاء الاصطناعي موحّداً لكل مستخدمي المركز");
  }

  App.ai = { settings, saveSettings, hasKey, generate, vision, migrateToShared, CLAUDE_MODELS };
})(window.App = window.App || {});
